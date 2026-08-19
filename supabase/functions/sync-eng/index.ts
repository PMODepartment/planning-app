// Edge Function: sync-eng
// -----------------------------------------------------------------------------
// Mirrors the Engineering App's design progress into this project's
// `eng_design_progress` table, which the Project Schedule's Design Development
// branch reads.
//
// The drawing register and material submittal log are AUTHORITATIVE in the
// Engineering App. This app's own `drawing_register` / `material_submittal`
// tables are the pre-cutover originals and are being retired — do not read them
// for Design Development.
//
// SECURITY MODEL (same as sync-wpm)
//  - Reads Engineering with its SERVICE-ROLE key, held only as an Edge Function
//    secret (ENG_SERVICE_KEY) — never shipped to the browser. Its anon key is
//    public in client JS, so a browser-side cross-project read would expose the
//    register to anyone holding that key.
//  - Writes the mirror with THIS project's service key, bypassing RLS.
//  - Callers must be an approved admin / super_admin / planner (JWT verified),
//    OR present this project's service key (the cron path).
//
// ⚠️ IT MIRRORS THE ROLL-UP, NOT THE ROWS, and it PRUNES. `sync-wpm` only ever
// upserts, so a work package deleted upstream lives in its mirror forever and
// keeps contributing to cash-out. Here each project's rows are DELETED and
// re-inserted, so a drawing type that disappears upstream disappears here.
//
// ⚠️ THE PROGRESS MATH LIVES IN ./aggregate.ts AND IS A PORT of the Engineering
// App's own engine, verified against it by a harness. The two bases are not
// interchangeable — For Construction / Concept / Schematic count 0-or-100
// tracking units at equal weight, Individual Services Drawings counts sheets with
// partial credit. Do not "simplify" that into one average.
//
// DEPLOY (from planning-app/):
//   supabase functions deploy sync-eng --project-ref bgupuqnkqhixpuctyder
//   supabase secrets set ENG_URL=https://zkxzaijznutmiueeurbb.supabase.co \
//     ENG_SERVICE_KEY=<Engineering sb_secret_ key> --project-ref bgupuqnkqhixpuctyder
//
// (Optional) nightly run: ⚠️ NOT via the dashboard's "Supabase Edge Function" job
// type — it hardcodes timeout_milliseconds := 1000 and this sync takes longer,
// which fails INTERMITTENTLY. Use a SQL Snippet calling net.http_post with a real
// timeout, the way the Engineering App's sync-projects cron is set up.
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aggregateDrawings, aggregateSubmittals, type Row } from "./aggregate.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const DR_COLS = "id,project_id,parent_id,node_kind,phase,title,status,no_of_sheets," +
  "approved_sheets,planned_approval,actual_approval,is_tracking_unit,track_mode";
const MS_COLS = "id,project_id,discipline,status,plan_approval_date,date_approved";

// ⚠️ PostgREST caps an unbounded select at 1000 rows and reports no error. One
// live register is already 1,500 drawings, so an unpaginated read would mirror a
// wrong-but-plausible percentage against the register it claims to reproduce.
async function readAll(sb: any, table: string, cols: string, scope: string | null) {
  const out: any[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(cols).order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (scope) q = q.eq("project_id", scope);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const PL_URL = Deno.env.get("SUPABASE_URL")!;
  // The auto-injected legacy SUPABASE_SERVICE_ROLE_KEY is NOT honored once a
  // project is on the new API-key format — it silently degrades to `anon`, which
  // surfaces much later as a permission error. Guard, don't discover.
  const PL_SERVICE = Deno.env.get("PL_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ENG_URL = Deno.env.get("ENG_URL");
  const ENG_SERVICE = Deno.env.get("ENG_SERVICE_KEY");
  if (!ENG_URL || !ENG_SERVICE) return json({ error: "ENG_URL / ENG_SERVICE_KEY not configured" }, 500);

  const kindOf = (k?: string) =>
    k?.startsWith("sb_secret_") ? "new" : k?.startsWith("ey") ? "legacy-jwt" : "unknown";
  const plKind = kindOf(PL_SERVICE), engKind = kindOf(ENG_SERVICE);
  if (plKind !== "new") return json({
    error: "PL_SERVICE_KEY must be the Planners project's new sb_secret_ key",
    pl_key_kind: plKind, has_PL_SERVICE_KEY: !!Deno.env.get("PL_SERVICE_KEY"),
  }, 500);
  if (engKind !== "new") return json({
    error: "ENG_SERVICE_KEY must be the Engineering project's new sb_secret_ key " +
           "(the legacy service_role JWT degrades to anon there and the read returns nothing)",
    eng_key_kind: engKind,
  }, 500);

  // ---- Authorize the caller ------------------------------------------------
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!auth) return json({ error: "Missing Authorization" }, 401);
  const plAdmin = createClient(PL_URL, PL_SERVICE, { auth: { persistSession: false } });

  let allowed = auth === PL_SERVICE;          // service-role / cron invocation
  if (!allowed) {
    // The platform already validated the JWT signature (verify_jwt=true), so the
    // `sub` claim can be trusted — decode it rather than calling GoTrue, which
    // trips over disabled legacy keys.
    let uid: string | null = null;
    try {
      const seg = auth.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      uid = JSON.parse(atob(seg))?.sub || null;
    } catch { uid = null; }
    if (!uid) return json({ error: "Could not read user id from token" }, 401);
    const { data: prof } = await plAdmin.from("users").select("role,status").eq("id", uid).maybeSingle();
    allowed = !!prof && prof.status === "approved" &&
      ["super_admin", "admin", "planner"].includes(prof.role);
    if (!allowed) return json({
      error: "Requires an approved admin/planner",
      role: prof?.role || null, status: prof?.status || null,
    }, 403);
  }

  // Optional body: { project_id?: string } to scope the sync to one project.
  // ⚠️ Projects carry the SAME id in both apps — they are sourced FROM this app —
  // so there is no mapping table to consult, unlike the WPM mirror.
  let scope: string | null = null;
  try { const b = await req.json(); scope = b?.project_id || null; } catch { /* no body */ }

  // ---- Read Engineering (service role, server-side only) -------------------
  const eng = createClient(ENG_URL, ENG_SERVICE, { auth: { persistSession: false } });

  let drRows: Row[];
  try { drRows = await readAll(eng, "drawing_register", DR_COLS, scope) as Row[]; }
  catch (e) { return json({ error: "Engineering drawing_register read failed: " + (e as Error).message }, 502); }

  // ⚠️ A FAILED submittal read must NOT be treated as "zero submittals" — that
  // would delete every existing submittal row below and silently wipe the branch
  // on one timed-out query. `msOk` gates both the aggregation AND what may be
  // pruned.
  let msOk = true, msRows: any[] = [];
  try { msRows = await readAll(eng, "material_submittal", MS_COLS, scope); }
  catch { msOk = false; }

  // ---- Aggregate per project ----------------------------------------------
  const byProj: Record<string, { dr: Row[]; ms: any[] }> = {};
  const bucket = (pid: string) => (byProj[pid] = byProj[pid] || { dr: [], ms: [] });
  drRows.forEach((r) => { if (r.project_id) bucket(r.project_id).dr.push(r); });
  if (msOk) msRows.forEach((r) => { if (r.project_id) bucket(r.project_id).ms.push(r); });

  const now = new Date().toISOString();
  const rows: any[] = [];
  Object.keys(byProj).forEach((pid) => {
    const g = byProj[pid];
    aggregateDrawings(g.dr).forEach((a) => rows.push({
      project_id: pid, source: "drawing", top_level: a.top_level, basis: a.basis,
      percent_complete: a.percent_complete, units_total: a.units_total, units_done: a.units_done,
      min_planned: a.min_planned, max_planned: a.max_planned, max_actual: a.max_actual,
      fallback: a.fallback, synced_at: now,
    }));
    if (msOk) aggregateSubmittals(g.ms).forEach((a) => rows.push({
      project_id: pid, source: "submittal", top_level: a.top_level, basis: "items",
      percent_complete: a.percent_complete, units_total: a.units_total, units_done: a.units_done,
      min_planned: a.min_planned, max_planned: a.max_planned, max_actual: a.max_actual,
      fallback: false, synced_at: now,
    }));
  });

  // ---- Replace the mirror (delete-then-insert = pruning is inherent) -------
  // Scoped to the projects actually read: a project outside `scope` keeps its rows.
  const pids = scope ? [scope] : Object.keys(byProj);
  let deleted = 0;
  for (const pid of pids) {
    // `count` comes from the delete() options, not a chained .select() — a
    // head:true select on a delete returns no count.
    let del = plAdmin.from("eng_design_progress").delete({ count: "exact" }).eq("project_id", pid);
    // Only prune what this run can rebuild — see the msOk note above.
    if (!msOk) del = del.eq("source", "drawing");
    const { error, count } = await del;
    if (error) return json({ error: "Mirror prune failed: " + error.message }, 500);
    deleted += count || 0;
  }

  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await plAdmin.from("eng_design_progress").insert(chunk);
    if (error) return json({ error: "Mirror write failed: " + error.message, written }, 500);
    written += chunk.length;
  }

  return json({
    ok: true, scope: scope || "all",
    projects: pids.length, drawings_read: drRows.length,
    submittals_read: msOk ? msRows.length : null, submittals_ok: msOk,
    deleted, written, synced_at: now,
  });
});
