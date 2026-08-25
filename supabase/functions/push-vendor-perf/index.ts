// Edge Function: push-vendor-perf
// -----------------------------------------------------------------------------
// Pushes VENDOR SCHEDULE PERFORMANCE into the WPM (procurement) app, so buyers
// see whether a vendor is keeping to the construction programme next to the
// packages they awarded it.
//
// WHY A PUSH AND NOT A READ
//   `project_schedule` lives in the PLANNERS database. WPM cannot read it, and
//   giving WPM a Planners service key would put a cross-app secret in a second
//   codebase for no gain. So the numbers are computed HERE, by the same SQL the
//   Planners UI would call, and written into WPM's `planners_vendor_performance`.
//   Exact mirror of push-need-by, in the same direction.
//
// ⚠️ THEREFORE WHAT WPM SHOWS IS A SNAPSHOT, as fresh as the last push. Every row
// carries `pushed_at` and `data_date` for exactly that reason: a vendor's SPI is
// meaningless without saying when it was true, and a screen that omits the
// timestamp invites someone to quote a month-old figure in a negotiation.
//
// SECURITY MODEL — identical to push-need-by:
//  - Reads this project's schedule with THIS project's service key (server-side).
//  - Writes WPM with the WPM SERVICE-ROLE key, held only as a function secret.
//  - Callers must be an approved admin / super_admin / planner (JWT verified), OR
//    present this project's service-role key (for cron).
//
// ⚠️ IT WRITES ONLY `planners_vendor_performance`. It NEVER touches `vendors` or
// `work_packages`. Vendor rows are edited by staff and by vendors themselves;
// one app silently overwriting another team's records is unrecoverable and
// unauditable. The schedule REPORTS; the buyer judges.
//
// DEPLOY (from planning-app/):
//   supabase functions deploy push-vendor-perf --project-ref bgupuqnkqhixpuctyder
// Reuses the secrets sync-wpm / push-need-by already need (WPM_URL,
// WPM_SERVICE_KEY, PL_SERVICE_KEY) — nothing new to set if those work.
//
// REQUIRES:
//   - planning-app/migrations/2026-08-25-vendor-identity.sql     (Planners)
//   - planning-app/migrations/2026-08-25-vendor-performance.sql  (Planners)
//   - wpm/MIGRATION_planners_vendor_performance.sql              (WPM)
//   - sync-wpm redeployed AND run, so wpm_work_packages.vendor_id is populated —
//     it is the join key, and without it this pushes nothing at all.
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* Cumulative planned / actual at a month key, from the RPC's monthly buckets.
   ⚠️ The buckets are already cumulative-to-month-end (that is what the shared
   schedule_scurve_agg_multi body produces), so this SELECTS the month, it does
   not re-accumulate. Re-summing them would square the curve. */
function atMonth(months: any[], key: string) {
  let last: any = null;
  for (const m of months) { if (String(m.key) <= key) last = m; else break; }
  return last;
}

/* Trend = the sign of the last three months of variance movement, so a
   recovering vendor and a deteriorating one at the same SPI do not read alike.
   ⚠️ Needs four points to see three deltas; fewer is reported as 'flat' rather
   than guessed, because two months of noise is not a trend.
   ⚠️ IT MEASURES THE ABSOLUTE GAP (ad - pd), NOT THE RATIO, and that is
   deliberate: a vendor holding a steady 90% of plan loses MORE days every month
   as the plan grows, so it reads 'deteriorating' rather than 'flat'. For a buyer
   asking "is this getting better or worse?" the widening gap is the story. A
   ratio-based trend would call that vendor stable while it fell further behind. */
function trendOf(months: any[], totDur: number): string {
  if (!totDur || months.length < 4) return "flat";
  const v = months.slice(-4).map((m) => (num(m.ad) - num(m.pd)) / totDur);
  let up = 0, down = 0;
  for (let i = 1; i < v.length; i++) { if (v[i] > v[i - 1] + 1e-9) up++; else if (v[i] < v[i - 1] - 1e-9) down++; }
  if (up > down) return "improving";
  if (down > up) return "deteriorating";
  return "flat";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const PL_URL = Deno.env.get("SUPABASE_URL")!;
  // Same key caveat as sync-wpm / push-need-by: this project runs on the NEW
  // API-key format, so the auto-injected legacy SUPABASE_SERVICE_ROLE_KEY
  // silently degrades to `anon` — which would read an empty schedule and push
  // "0% complete" for every vendor. Fail loudly instead.
  const PL_SERVICE = Deno.env.get("PL_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const WPM_URL = Deno.env.get("WPM_URL");
  const WPM_SERVICE = Deno.env.get("WPM_SERVICE_KEY");
  if (!WPM_URL || !WPM_SERVICE) return json({ error: "WPM_URL / WPM_SERVICE_KEY not configured" }, 500);

  const plKind = PL_SERVICE?.startsWith("sb_secret_") ? "new"
    : PL_SERVICE?.startsWith("ey") ? "legacy-jwt" : "unknown";
  if (plKind !== "new") return json({
    error: "PL_SERVICE_KEY must be the Planners project's new sb_secret_ key",
    pl_key_kind: plKind, has_PL_SERVICE_KEY: !!Deno.env.get("PL_SERVICE_KEY"),
  }, 500);

  // ---- Authorize the caller ------------------------------------------------
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!auth) return json({ error: "Missing Authorization" }, 401);

  const plAdmin = createClient(PL_URL, PL_SERVICE, { auth: { persistSession: false } });

  let allowed = auth === PL_SERVICE;
  let uid: string | null = null;
  if (!allowed) {
    try {
      const seg = auth.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      uid = JSON.parse(atob(seg))?.sub || null;
    } catch { uid = null; }
    if (!uid) return json({ error: "Could not read user id from token" }, 401);
    const { data: prof, error: pErr } = await plAdmin.from("users").select("role,status").eq("id", uid).maybeSingle();
    allowed = !!prof && prof.status === "approved" &&
      ["super_admin", "admin", "planner"].includes(prof.role);
    if (!allowed) return json({
      error: "Requires an approved admin/planner",
      uid, role: prof?.role || null, status: prof?.status || null, lookup_error: pErr?.message || null,
    }, 403);
  }

  // ---- Scope ---------------------------------------------------------------
  // ⚠️ ONE PLANNERS PROJECT PER CALL, required. Pushing the whole portfolio at
  //    once would let one stale or half-imported schedule overwrite every
  //    vendor's performance record in a single request.
  let projectId: string | null = null, dataDate: string | null = null;
  try {
    const b = await req.json();
    projectId = b?.project_id || null;
    dataDate = isDate(b?.data_date) ? b.data_date : null;   // the schedule data date lives in
  } catch { /* no body */ }                                 // localStorage, so the client sends it
  if (!projectId) return json({ error: "project_id (the Planners project) is required" }, 400);
  if (!dataDate) dataDate = new Date().toISOString().slice(0, 10);

  // Which WPM project this maps to. ⚠️ Cash Flow's mapping, the same one the
  // work-package picker and the Procurement WBS branch resolve through — a second
  // mapping would push a vendor's figures into the wrong WPM project.
  let wpmProjectId = projectId;
  {
    const { data: cs } = await plAdmin.from("cash_flow_settings")
      .select("wpm_project_id").eq("project_id", projectId).maybeSingle();
    if (cs?.wpm_project_id) wpmProjectId = cs.wpm_project_id;
  }

  // ---- The vendors that actually have packages on this project -------------
  const { data: mirror, error: mErr } = await plAdmin
    .from("wpm_work_packages")
    .select("vendor_id, awarded_vendor_ids")
    .eq("wpm_project_id", wpmProjectId)
    .not("vendor_id", "is", null);
  if (mErr) return json({
    error: "Could not read the work-package mirror: " + mErr.message,
    hint: /vendor_id/.test(mErr.message)
      ? "Run migrations/2026-08-25-vendor-identity.sql, then redeploy and run sync-wpm."
      : undefined,
  }, 500);

  const vendorIds = [...new Set((mirror || []).map((m: any) => m.vendor_id).filter(Boolean))];
  if (!vendorIds.length) {
    // ⚠️ Not an error, and deliberately NOT a write. An empty vendor set means the
    //    mirror has no awards yet (most likely sync-wpm has not run since the
    //    migration). Writing zero rows would be harmless; writing "0% complete"
    //    rows for vendors we cannot see would be a lie about their performance.
    return json({
      ok: true, project_id: projectId, wpm_project_id: wpmProjectId,
      vendors: 0, written: 0,
      note: "No awarded vendors in the mirror for this project — redeploy and run sync-wpm first.",
    });
  }

  // ---- Vendor names + the scorecard aggregate ------------------------------
  const nameOf: Record<string, string> = {};
  {
    const { data: vs } = await plAdmin.from("wpm_vendors").select("id,name").in("id", vendorIds);
    (vs || []).forEach((v: any) => { nameOf[v.id] = v.name; });
  }
  // vendor_scorecard_multi carries the need-by adherence, which the per-vendor
  // curve function does not. Computed once for the project rather than per vendor.
  const cardBy: Record<string, any> = {};
  {
    const { data: cards, error: cErr } = await plAdmin.rpc("vendor_scorecard_multi", { p_ids: [projectId] });
    if (cErr) return json({
      error: "vendor_scorecard_multi failed: " + cErr.message,
      hint: "Run migrations/2026-08-25-vendor-performance.sql in the Planners project.",
    }, 500);
    (cards || []).forEach((c: any) => { cardBy[c.vendor_id] = c; });
  }

  // ---- Thresholds — from the project's own table, never hard-coded ---------
  // ⚠️ F4's rule: two apps with two sets of thresholds would disagree about the
  //    same vendor. These are the Planners project's, and the status they produce
  //    is what WPM displays.
  // WARNING: 'spi_below' is NOT yet in schedule_thresholds' documented metric
  // vocabulary (float_below | finish_var_above | contract_var_above |
  // overdue_days), so until someone adds a row with that metric these defaults
  // ARE the thresholds. That is deliberate — inventing a metric name in the
  // table would be worse — but do not read the code below as "configured".
  let watchAt = 0.95, problemAt = 0.85;
  {
    const { data: th } = await plAdmin.from("schedule_thresholds")
      .select("metric,value,severity,enabled").eq("project_id", projectId).eq("enabled", true);
    (th || []).forEach((t: any) => {
      if (String(t.metric) !== "spi_below") return;
      const v = Number(t.value);
      if (!Number.isFinite(v)) return;
      if (String(t.severity).toLowerCase() === "high") problemAt = v; else watchAt = v;
    });
  }

  const nowIso = new Date().toISOString();
  const rows: any[] = [];
  const skipped: any[] = [];

  for (const vid of vendorIds) {
    const { data: agg, error: aErr } = await plAdmin
      .rpc("schedule_scurve_agg_vendor", { p_ids: [projectId], p_vendor_id: vid });
    if (aErr) return json({
      error: "schedule_scurve_agg_vendor failed: " + aErr.message,
      hint: "Run migrations/2026-08-25-vendor-performance.sql in the Planners project.",
    }, 500);

    const months: any[] = Array.isArray(agg?.months) ? agg.months : [];
    const totDur = num(agg?.totDur);
    const card = cardBy[vid] || {};

    // ⚠️ A vendor whose packages carry NO schedule activities is SKIPPED, not
    //    pushed as 0%. "Nobody has scheduled this vendor's work yet" and "this
    //    vendor has done none of its work" are opposite facts, and only one of
    //    them belongs on a scorecard.
    if (!totDur || !num(agg?.nAct)) {
      skipped.push({ vendor_id: vid, reason: "no scheduled activities under this vendor's packages" });
      continue;
    }

    const key = String(dataDate).slice(0, 7);
    const at = atMonth(months, key);
    const plannedPct = at ? num(at.pd) / totDur : null;
    const actualPct = num(agg?.doneDur) / totDur;
    // ⚠️ SPI is null, not 1, when the programme says nothing should have started
    //    yet — dividing by zero planned work reads as "perfectly on track" when
    //    the honest answer is "not comparable yet".
    const spi = plannedPct && plannedPct > 1e-9 ? actualPct / plannedPct : null;
    const status = spi == null ? "on_track"
      : spi < problemAt ? "problem" : spi < watchAt ? "watch" : "on_track";

    rows.push({
      vendor_id: vid,
      project_id: wpmProjectId,
      source_project_id: projectId,
      vendor_name: nameOf[vid] || card.vendor_name || null,
      n_packages: num(agg?.nPackages),
      n_activities: num(agg?.nAct),
      co_awarded: num(agg?.coAwarded),
      pct_complete: actualPct,
      planned_pct: plannedPct,
      spi: spi,
      slip_days: num(agg?.slipDays),
      n_slipped: num(agg?.nSlipped),
      n_finished: num(agg?.nFinished),
      needby_late: card.n_needby_late ?? null,
      needby_checked: card.n_needby_checked ?? null,
      trend: trendOf(months, totDur),
      status: status,
      months: months,
      data_date: dataDate,
      pushed_at: nowIso,
    });
  }

  // ---- Write WPM -----------------------------------------------------------
  const wpm = createClient(WPM_URL, WPM_SERVICE, { auth: { persistSession: false } });
  let written = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await wpm.from("planners_vendor_performance")
      .upsert(chunk, { onConflict: "vendor_id,project_id" });
    if (error) return json({
      error: "WPM write failed: " + error.message, written,
      hint: /planners_vendor_performance/.test(error.message)
        ? "Run wpm/MIGRATION_planners_vendor_performance.sql in the WPM project."
        : undefined,
    }, 500);
    written += chunk.length;
  }

  // ⚠️ Rows are NOT pruned. A vendor whose packages were reassigned keeps its last
  // snapshot with its own pushed_at, which a buyer can see is stale — better than
  // the record silently vanishing mid-negotiation.
  return json({
    ok: true, project_id: projectId, wpm_project_id: wpmProjectId,
    vendors: vendorIds.length, written, skipped,
    data_date: dataDate, thresholds: { watch_below: watchAt, problem_below: problemAt },
    pushed_at: nowIso,
  });
});
