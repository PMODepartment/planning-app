// Edge Function: push-packages
// -----------------------------------------------------------------------------
// Pushes this project's CONTRACT PACKAGES into the Procurement (WPM) and
// Engineering apps, so both can file their own records under the same contract
// lots the Planners app plans and bills against.
//
// A package is a scope division of ONE project — "Package 1 — Tower 1 and General
// Requirements", "Package 2 — Towers 2-7". Planners owns them (they come off the
// contract documents); procurement and engineering CONSUME them.
//
// ⚠️ THE THREE APPS ARE THREE SEPARATE SUPABASE PROJECTS. Planners
//    (bgupuqnkqhixpuctyder), WPM (cayjeqeleenizbdzrums) and Engineering
//    (zkxzaijznutmiueeurbb) share no tables, so "just read packages" is not
//    available to either app — hence a mirror, exactly like wpm_work_packages in
//    the other direction. See sync-wpm / sync-eng.
//
// SECURITY MODEL — the same shape as push-need-by:
//  - Reads Planners with the Planners service key (server-side only).
//  - Writes each target with ITS service-role key, held only as a Function secret.
//  - Callers must be an approved admin / super_admin / planner, or present the
//    Planners service key (cron).
//
// ⚠️ IT WRITES ONLY `planners_packages`, and only rows for this project. It never
//    touches a work package, a drawing or anything either team owns. One app
//    silently editing another's records is unrecoverable and unauditable — the
//    mirror is read-only reference data, and each app decides what to link to it.
//
// ⚠️ DELETES ARE MIRRORED AS A REPLACE OF THIS PROJECT'S ROWS, never a global
//    wipe: a package retired in Planners must disappear downstream, or a buyer
//    keeps filing purchases against a lot that no longer exists. Scoped by
//    project so one project's push can never blank another's.
//
// DEPLOY (from planning-app/):
//   supabase functions deploy push-packages --project-ref bgupuqnkqhixpuctyder
// Reuses the secrets sync-wpm and sync-eng already need (WPM_URL, WPM_SERVICE_KEY,
// ENG_URL, ENG_SERVICE_KEY, PL_SERVICE_KEY) — nothing new to set.
//
// REQUIRES, in the target projects:
//   wpm/MIGRATION_planners_packages.sql
//   engineering-app/migrations/2026-08-26-planners-packages.sql
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const PL_URL = Deno.env.get("SUPABASE_URL")!;
  // Same key caveat as sync-wpm: this project runs on the NEW API-key format, so the
  // auto-injected legacy SUPABASE_SERVICE_ROLE_KEY silently degrades to `anon`.
  const PL_SERVICE = Deno.env.get("PL_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const plKind = PL_SERVICE?.startsWith("sb_secret_") ? "new"
    : PL_SERVICE?.startsWith("ey") ? "legacy-jwt" : "unknown";
  if (plKind !== "new") return json({
    error: "PL_SERVICE_KEY must be the Planners project's new sb_secret_ key", pl_key_kind: plKind,
  }, 500);

  const targets = [
    { name: "wpm", url: Deno.env.get("WPM_URL"), key: Deno.env.get("WPM_SERVICE_KEY") },
    { name: "engineering", url: Deno.env.get("ENG_URL"), key: Deno.env.get("ENG_SERVICE_KEY") },
  ].filter((t) => !!t.url && !!t.key);
  // ⚠️ A missing target is reported, never silently skipped: "pushed successfully"
  //    while engineering received nothing is the worst possible outcome here.
  const missing = ["WPM", "ENG"].filter((p) =>
    !Deno.env.get(`${p}_URL`) || !Deno.env.get(`${p}_SERVICE_KEY`));
  if (!targets.length) return json({ error: "No target configured (WPM_URL/WPM_SERVICE_KEY, ENG_URL/ENG_SERVICE_KEY)" }, 500);

  // ---- Authorize the caller ------------------------------------------------
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!auth) return json({ error: "Missing Authorization" }, 401);
  const plAdmin = createClient(PL_URL, PL_SERVICE, { auth: { persistSession: false } });

  let allowed = auth === PL_SERVICE;   // service-role / cron invocation
  let uid: string | null = null;
  if (!allowed) {
    try {
      const seg = auth.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      uid = JSON.parse(atob(seg))?.sub || null;
    } catch { uid = null; }
    if (!uid) return json({ error: "Could not read user id from token" }, 401);
    const { data: prof } = await plAdmin.from("users").select("role,status").eq("id", uid).maybeSingle();
    allowed = !!prof && prof.status === "approved" &&
      ["super_admin", "admin", "planner"].includes(prof.role);
    if (!allowed) return json({ error: "Requires an approved admin/planner", role: prof?.role || null }, 403);
  }

  // ---- Scope ---------------------------------------------------------------
  // ⚠️ One project per call, deliberately. Pushing the whole portfolio would let a
  //    single bad project blank every other project's mirrored packages.
  let projectId: string | null = null;
  try { projectId = (await req.json())?.project_id || null; } catch { /* no body */ }
  if (!projectId) return json({ error: "project_id (the Planners project) is required" }, 400);

  // ---- Read the packages ---------------------------------------------------
  const { data: pkgs, error: pErr } = await plAdmin.from("packages")
    .select("id,project_id,code,name,description,status,sort_order,start_date,end_date,contract_amount,updated_at")
    .eq("project_id", projectId).order("sort_order");
  if (pErr) return json({ error: `Could not read packages: ${pErr.message}` }, 500);

  // Which downstream project id each app knows this project by. ⚠️ Reuses Cash
  // Flow's existing mapping so the mirror lands on the SAME project the work-package
  // picker and the Procurement WBS branch already resolve through; a second mapping
  // would file packages against a different project than the one buyers see.
  let wpmProjectId = projectId;
  {
    const { data } = await plAdmin.from("cash_flow_settings")
      .select("wpm_project_id").eq("project_id", projectId).limit(1);
    const v = data?.[0]?.wpm_project_id;
    if (v) wpmProjectId = String(v);
  }

  const results: Record<string, unknown> = {};
  for (const t of targets) {
    const cli = createClient(t.url!, t.key!, { auth: { persistSession: false } });
    // WPM knows the project by its own id; Engineering shares the Planners code.
    const targetProject = t.name === "wpm" ? wpmProjectId : projectId;
    const rows = (pkgs || []).map((k: any) => ({
      planners_package_id: k.id,
      planners_project_id: projectId,
      project_id: targetProject,
      code: k.code, name: k.name, description: k.description ?? null,
      status: k.status ?? "active", sort_order: k.sort_order ?? 0,
      start_date: k.start_date ?? null, end_date: k.end_date ?? null,
      contract_amount: k.contract_amount ?? null,
      synced_at: new Date().toISOString(),
    }));
    try {
      // ⚠️ REPLACE THIS PROJECT'S ROWS ONLY. Retiring a package in Planners must
      //    remove it downstream, or a buyer keeps filing against a lot that is gone.
      const del = await cli.from("planners_packages").delete().eq("planners_project_id", projectId);
      if (del.error) throw del.error;
      if (rows.length) {
        const ins = await cli.from("planners_packages").insert(rows);
        if (ins.error) throw ins.error;
      }
      results[t.name] = { written: rows.length, project_id: targetProject };
    } catch (e) {
      const msg = (e as any)?.message || String(e);
      results[t.name] = {
        error: msg,
        hint: /planners_packages/.test(msg)
          ? (t.name === "wpm" ? "Run wpm/MIGRATION_planners_packages.sql"
                              : "Run engineering-app/migrations/2026-08-26-planners-packages.sql")
          : undefined,
      };
    }
  }
  return json({ ok: true, project_id: projectId, packages: (pkgs || []).length, targets: results, not_configured: missing });
});
