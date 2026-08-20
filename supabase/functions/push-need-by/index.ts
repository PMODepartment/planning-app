// Edge Function: push-need-by
// -----------------------------------------------------------------------------
// Pushes the SCHEDULE's need-by date for each procurement work package INTO the
// WPM (procurement) app, so buyers see what construction actually requires next to
// their own Target Installation.
//
// need-by(wp) = the earliest start among the Project Schedule activities linked to
//               that work package (project_schedule.work_package = wp_no) — the day
//               work that consumes the package begins.
//
// Per the PMO, that date corresponds to WPM's TARGET INSTALLATION field, which is
// what the Planners-side Procurement Alignment report compares against.
//
// SECURITY MODEL — the exact mirror of sync-wpm, in the other direction:
//  - Reads this project's schedule with THIS project's service key (server-side).
//  - Writes WPM with the WPM SERVICE-ROLE key, held only as an Edge Function secret
//    (WPM_SERVICE_KEY) — never shipped to the browser.
//  - Callers must be an approved admin / super_admin / planner (JWT verified), OR the
//    invocation must present this project's service-role key (for cron).
//
// ⚠️ IT WRITES ONLY `planners_need_by`. It NEVER touches work_packages — least of all
// target_installation, which is a procurement-owned field a buyer types and saves.
// One app silently overwriting another team's authoritative dates is unrecoverable and
// unauditable; the schedule proposes, the buyer adopts. See
// wpm/MIGRATION_planners_need_by.sql.
//
// DEPLOY (from planning-app/):
//   supabase functions deploy push-need-by --project-ref bgupuqnkqhixpuctyder
// Reuses the secrets sync-wpm already needs (WPM_URL, WPM_SERVICE_KEY, PL_SERVICE_KEY),
// so there is nothing new to set if sync-wpm works.
//
// REQUIRES: wpm/MIGRATION_planners_need_by.sql run in the WPM project first.
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// The module's own key normalization (index.html `_wpKey`) — trim + upper. Kept
// identical so a link the UI shows as resolved is the same link this groups on.
const wpKey = (v: unknown) => String(v ?? "").trim().toUpperCase();

// The module's `dispStart`: an actual start beats the planned one. Nothing else —
// forecasting applies to FINISH dates (forecastFin), never to the start.
const dispStart = (r: any): string | null => {
  const d = r.actual_start || r.start_date || null;
  return d ? String(d).slice(0, 10) : null;
};

const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const PL_URL = Deno.env.get("SUPABASE_URL")!;
  // Same key caveat as sync-wpm: this project runs on the NEW API-key format, so the
  // auto-injected legacy SUPABASE_SERVICE_ROLE_KEY silently degrades to `anon`.
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

  let allowed = auth === PL_SERVICE; // service-role / cron invocation
  let uid: string | null = null;
  if (!allowed) {
    // The platform (verify_jwt=true) already validated the signature, so the `sub`
    // claim is trustworthy — decode it rather than calling GoTrue (which trips over
    // disabled legacy keys). Same approach as sync-wpm.
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
      uid, profile_found: !!prof, role: prof?.role || null, status: prof?.status || null,
      lookup_error: pErr?.message || null,
    }, 403);
  }

  // ---- Scope ---------------------------------------------------------------
  // `project_id` is the PLANNERS project. Required: pushing every project at once
  // would let one stale schedule overwrite need-by dates across the whole portfolio.
  let projectId: string | null = null, bodyDataDate: string | null = null;
  try {
    const b = await req.json();
    projectId = b?.project_id || null;
    bodyDataDate = isDate(b?.data_date) ? b.data_date : null;   // the schedule's data date lives in
  } catch { /* no body */ }                                     // localStorage, so the client sends it
  if (!projectId) return json({ error: "project_id (the Planners project) is required" }, 400);

  // Which WPM project this maps to. ⚠️ Reuses Cash Flow's mapping
  // (cash_flow_settings.wpm_project_id) — the same one the Procurement WBS branch and
  // the work-package picker resolve through. A second mapping would let this push
  // need-by dates into a different WPM project than the one the picker read from.
  let wpmProjectId = projectId;
  {
    const { data } = await plAdmin.from("cash_flow_settings")
      .select("wpm_project_id").eq("project_id", projectId).limit(1);
    const v = data?.[0]?.wpm_project_id;
    if (v) wpmProjectId = String(v);
  }

  // ---- Read the schedule (paginated) --------------------------------------
  // ⚠️ Keyset-paginate by id. A plain select caps at 1000 rows and a 17k-activity
  // schedule would push need-by dates computed from the first 1000 activities —
  // silently too late for everything else. Same trap the module's selectAllPaged exists for.
  const acts: any[] = [];
  {
    let last: string | null = null;
    for (;;) {
      let q = plAdmin.from("project_schedule")
        .select("id,activity_id,activity_name,activity_type,work_package,start_date,actual_start")
        .eq("project_id", projectId)
        .not("work_package", "is", null)
        .order("id", { ascending: true })
        .limit(1000);
      if (last) q = q.gt("id", last);
      const { data, error } = await q;
      if (error) return json({ error: "Schedule read failed: " + error.message }, 502);
      const page = data || [];
      acts.push(...page);
      if (page.length < 1000) break;
      last = page[page.length - 1].id;
    }
  }

  // ---- Reduce to one need-by per work package ------------------------------
  type Agg = { wp_no: string; need_by: string | null; driver_id: string | null; driver_name: string | null; linked: number };
  const byWp = new Map<string, Agg>();
  for (const r of acts) {
    // ⚠️ WBS-Summary rows are projections of their children. Including them would
    // double-count the linked total and, worse, a rolled-up summary start could pull a
    // need-by EARLIER than any real activity needs it — telling a buyer to expedite for
    // no reason. The module's report excludes them the same way.
    if (r.activity_type === "WBS Summary") continue;
    const k = wpKey(r.work_package);
    if (!k) continue;
    let e = byWp.get(k);
    if (!e) { e = { wp_no: String(r.work_package).trim(), need_by: null, driver_id: null, driver_name: null, linked: 0 }; byWp.set(k, e); }
    e.linked++;
    const s = dispStart(r);
    if (!s) continue;
    if (!e.need_by || s < e.need_by) { e.need_by = s; e.driver_id = r.activity_id || null; e.driver_name = r.activity_name || null; }
  }

  const now = new Date().toISOString();
  const rows = [...byWp.values()].map((e) => ({
    project_id: wpmProjectId,
    wp_no: e.wp_no,
    need_by: e.need_by,
    driver_activity_id: e.driver_id,
    driver_activity_name: e.driver_name,
    linked_activities: e.linked,
    schedule_data_date: bodyDataDate,
    synced_at: now,
  }));

  // ---- Write WPM (service role, server-side only) -------------------------
  const wpm = createClient(WPM_URL, WPM_SERVICE, { auth: { persistSession: false } });

  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await wpm.from("planners_need_by").upsert(chunk, { onConflict: "project_id,wp_no" });
    if (error) return json({
      error: "WPM write failed: " + error.message, written,
      hint: /planners_need_by/i.test(error.message || "")
        ? "Run wpm/MIGRATION_planners_need_by.sql in the WPM project first."
        : undefined,
    }, 502);
    written += chunk.length;
  }

  // ---- Prune links the schedule no longer has ----------------------------
  // ⚠️ IT PRUNES, unlike the wpm_work_packages mirror (which only upserts, so a deleted
  // work package lives in it forever — see CLAUDE.md). A stale need-by is worse than a
  // stale package row: it tells a buyer to expedite for work that is no longer linked,
  // or holds an old date after the schedule moved. Deletion is scoped to THIS wpm project
  // and only ever removes rows this function owns — it cannot touch work_packages.
  //
  // ⚠️ A push that computed ZERO rows does NOT wipe the table. Zero means "nothing is
  // linked", which is indistinguishable from a mis-mapped project id or a schedule that
  // hasn't been linked up yet — and the same rule syncProcurement follows for its branch.
  let pruned = 0;
  if (rows.length) {
    const keep = rows.map((r) => r.wp_no);
    const { data: existing, error: exErr } = await wpm.from("planners_need_by")
      .select("wp_no").eq("project_id", wpmProjectId);
    if (!exErr && existing) {
      const keepSet = new Set(keep.map(wpKey));
      const stale = existing.map((r: any) => r.wp_no).filter((n: string) => !keepSet.has(wpKey(n)));
      for (let i = 0; i < stale.length; i += 200) {
        const { error } = await wpm.from("planners_need_by").delete()
          .eq("project_id", wpmProjectId).in("wp_no", stale.slice(i, i + 200));
        if (!error) pruned += Math.min(200, stale.length - i);
      }
    }
  }

  return json({
    ok: true, project_id: projectId, wpm_project_id: wpmProjectId,
    activities_linked: acts.length, work_packages: rows.length,
    written, pruned, data_date: bodyDataDate, synced_at: now,
  });
});
