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
                w.discipline, w.division, w.work_category, w.cost_code),
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
    source_id: w.id,
    synced_at: now,
  })).filter((r: any) => r.wpm_project_id && r.wp_no);

  // ---- Upsert into the mirror (chunked) ------------------------------------
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error: iErr } = await plAdmin
      .from("wpm_work_packages")
      .upsert(chunk, { onConflict: "wpm_project_id,wp_no" });
    if (iErr) return json({ error: "Mirror write failed: " + iErr.message, written }, 500);
    written += chunk.length;
  }

  return json({ ok: true, read: wps?.length || 0, written, scope: scope || "all", synced_at: now });
});
