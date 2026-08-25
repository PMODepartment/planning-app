// Edge Function: sync-wpm
// -----------------------------------------------------------------------------
// Copies the columns the Cash Flow module needs from the WPM (procurement) app's
// `work_packages` table into this project's `wpm_work_packages` mirror.
//
// SECURITY MODEL
//  - Reads WPM with the WPM SERVICE-ROLE key, held only as an Edge Function
//    secret (WPM_SERVICE_KEY) — never shipped to the browser.
//  - Writes the mirror with THIS project's service role (auto-injected
//    SUPABASE_SERVICE_ROLE_KEY), bypassing RLS.
//  - Callers must be an approved admin / super_admin / planner (JWT verified),
//    OR the invocation must present this project's service-role key (for cron).
//
// DEPLOY (from planning-app/):
//   supabase functions deploy sync-wpm --project-ref bgupuqnkqhixpuctyder
//   supabase secrets set WPM_URL=https://cayjeqeleenizbdzrums.supabase.co \
//     WPM_SERVICE_KEY=<WPM service_role key> --project-ref bgupuqnkqhixpuctyder
//
// (Optional) schedule a nightly sync from the Supabase dashboard → Edge Functions
// → Schedules, or via pg_cron calling this function's URL with the service key.
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Pull the FULL WPM work-package row (*) so we can auto-detect the trade / cost-code
// group column without knowing its exact name (WPM schema isn't fixed here). We only
// copy the known columns + the detected trade into the mirror below.
const WP_COLS = "*";

// First non-empty value (trade auto-detection across likely WPM column names).
const pick = (...v: any[]) => {
  for (const x of v) if (x != null && String(x).trim() !== "") return String(x).trim();
  return null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const PL_URL = Deno.env.get("SUPABASE_URL")!;
  // Prefer an explicitly-set new-format secret key (PL_SERVICE_KEY, sb_secret_…).
  // The auto-injected legacy SUPABASE_SERVICE_ROLE_KEY is NOT honored once a
  // project migrates to the new API-key format — it silently degrades to `anon`
  // (→ "permission denied for table users" / failed mirror writes).
  const PL_SERVICE = Deno.env.get("PL_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const WPM_URL = Deno.env.get("WPM_URL");
  const WPM_SERVICE = Deno.env.get("WPM_SERVICE_KEY");
  if (!WPM_URL || !WPM_SERVICE) return json({ error: "WPM_URL / WPM_SERVICE_KEY not configured" }, 500);

  // This project runs on the NEW API-key format; the legacy service_role JWT is
  // disabled. The admin client MUST use a new-format `sb_secret_…` key or every
  // DB call silently degrades to `anon`. Guard + report what we actually hold.
  const plKind = PL_SERVICE?.startsWith("sb_secret_") ? "new"
    : PL_SERVICE?.startsWith("ey") ? "legacy-jwt" : "unknown";
  const wpmKind = WPM_SERVICE?.startsWith("sb_secret_") ? "new"
    : WPM_SERVICE?.startsWith("ey") ? "legacy-jwt" : "unknown";
  if (plKind !== "new") return json({
    error: "PL_SERVICE_KEY must be the Planners project's new sb_secret_ key",
    pl_key_kind: plKind, has_PL_SERVICE_KEY: !!Deno.env.get("PL_SERVICE_KEY"),
  }, 500);

  // ---- Authorize the caller ------------------------------------------------
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!auth) return json({ error: "Missing Authorization" }, 401);

  const plAdmin = createClient(PL_URL, PL_SERVICE, { auth: { persistSession: false } });

  let allowed = auth === PL_SERVICE; // service-role / cron invocation
  if (!allowed) {
    // The platform (verify_jwt=true) already validated the JWT signature, so we
    // can trust the `sub` claim — decode it directly (avoids a GoTrue getUser
    // call that trips over disabled legacy keys), then check role/status.
    let uid: string | null = null;
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
      uid, profile_found: !!prof, role: prof?.role || null,
      status: prof?.status || null, lookup_error: pErr?.message || null,
      pl_key_kind: plKind, wpm_key_kind: wpmKind,
    }, 403);
  }

  // Optional body: { wpm_project_id?: string } to scope the sync to one project.
  let scope: string | null = null;
  try { const b = await req.json(); scope = b?.wpm_project_id || null; } catch { /* no body */ }

  // ---- Read WPM (service role, server-side only) ----------------------------
  const wpm = createClient(WPM_URL, WPM_SERVICE, { auth: { persistSession: false } });
  let q = wpm.from("work_packages").select(WP_COLS);
  if (scope) q = q.eq("project_id", scope);
  const { data: wps, error: wErr } = await q;
  if (wErr) return json({ error: "WPM read failed: " + wErr.message }, 502);

  const now = new Date().toISOString();
  const rows = (wps || []).map((w: any) => ({
    wpm_project_id: w.project_id,
    wp_no: w.wp_no,
    description: w.description,
    trade: pick(w.trade, w.cost_code_category, w.cost_code_group, w.category,
                w.discipline, w.division, w.work_category, w.works, w.type_of_works,
                w.scope, w.cost_code),
    approved_budget_bcb: w.approved_budget_bcb,
    awarded_cost: w.awarded_cost,
    total_awarded: w.total_awarded,
    dp_percent: w.dp_percent,
    retention_percent: w.retention_percent,
    payment_terms_days: w.payment_terms_days,
    awarding_date: w.awarding_date,
    actual_awarding_date: w.actual_awarding_date,
    target_delivery: w.target_delivery,
    target_installation: w.target_installation,
    target_completion: w.target_completion,
    award_status: w.award_status,
    procurement_status: w.procurement_status,
    delivery_status: w.delivery_status,
    // ---- F1: WHO won the package ------------------------------------------
    // Column names are WPM's own (MIGRATION_vendor_merge.sql), not guessed.
    vendor_id: w.vendor_id ?? null,
    // WARNING: awarded_vendor_ids and awarded_vendor_amounts are INDEX-ALIGNED
    // in WPM and are mirrored as a PAIR, unsorted and un-deduplicated. Touching
    // one without the other silently reassigns money to the wrong vendor.
    awarded_vendor_ids: w.awarded_vendor_ids ?? null,
    awarded_vendor_amounts: w.awarded_vendor_amounts ?? null,
    contractor: w.contractor ?? null,
    source_id: w.id,
    synced_at: now,
  })).filter((r: any) => r.wpm_project_id && r.wp_no);

  // ---- Upsert into the mirror (chunked) ------------------------------------
  // Self-heal against a partially-migrated mirror: if a column (e.g. `trade` before
  // its migration is run) is missing, strip it from every row and retry so the sync
  // still lands; report which columns were dropped so the caller can run the migration.
  const dropped: string[] = [];
  async function upsertChunk(chunk: any[]): Promise<string | null> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const { error } = await plAdmin.from("wpm_work_packages").upsert(chunk, { onConflict: "wpm_project_id,wp_no" });
      if (!error) return null;
      const m = /Could not find the '([^']+)' column/i.exec(error.message || "");
      if (!m) return error.message;
      const col = m[1];
      if (!dropped.includes(col)) dropped.push(col);
      chunk.forEach((r) => { delete r[col]; });
    }
    return "too many missing columns";
  }

  // ---- F1: mirror the vendor directory ------------------------------------
  // WARNING: NAMES AND TRADES ONLY. contact_person / contact_number /
  // contact_email / address and every rate stay in WPM. This mirror exists so
  // the Planners app can say WHO did the work and in WHICH trade; widening it
  // turns a performance mirror into an unowned second contacts database.
  let vendorsWritten = 0;
  const vendorDropped: string[] = [];
  {
    const { data: vs, error: vErr } = await wpm
      .from("vendors")
      .select("id,name,vendor_code,trade_categories,accreditation,accreditation_date,status");
    if (vErr) {
      // Non-fatal: the work-package mirror is the load-bearing half, and a WPM
      // schema that predates vendor management must not fail the whole sync.
      vendorDropped.push("vendors: " + vErr.message);
    } else {
      const vrows = (vs || []).filter((v: any) => v.id && v.name).map((v: any) => ({
        id: v.id,
        name: v.name,
        vendor_code: v.vendor_code ?? null,
        trade_categories: v.trade_categories ?? [],
        accreditation: v.accreditation ?? null,
        accreditation_date: v.accreditation_date ?? null,
        status: v.status ?? null,
        synced_at: now,
      }));
      for (let i = 0; i < vrows.length; i += 500) {
        const chunk = vrows.slice(i, i + 500);
        let lastErr: string | null = null;
        for (let attempt = 0; attempt < 8; attempt++) {
          const { error } = await plAdmin.from("wpm_vendors").upsert(chunk, { onConflict: "id" });
          if (!error) { lastErr = null; break; }
          lastErr = error.message || "";
          const m = /Could not find the '([^']+)' column/i.exec(lastErr);
          if (!m) break;
          if (!vendorDropped.includes(m[1])) vendorDropped.push(m[1]);
          chunk.forEach((r: any) => { delete r[m[1]]; });
        }
        if (lastErr) { vendorDropped.push("write: " + lastErr); break; }
        vendorsWritten += chunk.length;
      }
    }
  }
  // WARNING: vendors are NOT pruned. A vendor row that leaves WPM is still cited
  // by historical productivity records here; deleting it would turn months of
  // site history into "unknown vendor" with no way back. Stale rows are
  // harmless — `status` already carries 'inactive'.

  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const err = await upsertChunk(chunk);
    if (err) return json({ error: "Mirror write failed: " + err, written }, 500);
    written += chunk.length;
  }

  return json({ ok: true, read: wps?.length || 0, written, dropped,
                vendors_written: vendorsWritten, vendors_dropped: vendorDropped,
                scope: scope || "all", synced_at: now });
});
