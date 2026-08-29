// Edge Function: submit-reconstruction
// -----------------------------------------------------------------------------
// The ONLY path by which a reconstruction_requests row is allowed to reach the
// paid RunPod GPU service. Called from the client when an ADMIN clicks
// "Approve" on a pending request — never called directly by a requester.
//
// SECURITY MODEL:
//  - The database-level gate (reconstruction_requests' RLS: only an admin can
//    UPDATE the row's status past 'pending_approval') is the REAL enforcement.
//    This function additionally re-checks the caller's role itself, so a
//    request can never reach RunPod even if some future client-side bug let a
//    non-admin call this function directly — belt AND braces, not either/or.
//  - RunPod's API key never reaches the browser; it lives only as this
//    function's own secret.
//  - The worker gets a SHORT-LIVED SIGNED URL to the one video it needs, not a
//    service-role key — the narrowest credential that can do the job.
//
// DEPLOY (from planning-app/):
//   supabase functions deploy submit-reconstruction --project-ref bgupuqnkqhixpuctyder
//   supabase secrets set RUNPOD_API_KEY=... RUNPOD_ENDPOINT_ID=... --project-ref bgupuqnkqhixpuctyder
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const BUCKET = "progress-photos";
const VIDEO_SIGN_TTL = 60 * 60 * 24; // 24h — generous enough for a queued job to still be running when it finally fetches

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const PL_URL = Deno.env.get("SUPABASE_URL")!;
  const PL_SERVICE = Deno.env.get("PL_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const RUNPOD_API_KEY = Deno.env.get("RUNPOD_API_KEY");
  const RUNPOD_ENDPOINT_ID = Deno.env.get("RUNPOD_ENDPOINT_ID");
  if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
    return json({ error: "RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID not configured" }, 500);
  }

  // ---- Authorize the caller: admin/super_admin ONLY (tighter than the
  // admin/planner set most other Edge Functions here allow — this triggers
  // real money, so "planner" is deliberately not enough on its own). ----
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!auth) return json({ error: "Missing Authorization" }, 401);

  const admin = createClient(PL_URL, PL_SERVICE, { auth: { persistSession: false } });

  let uid: string | null = null;
  try {
    const seg = auth.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    uid = JSON.parse(atob(seg))?.sub || null;
  } catch { uid = null; }
  if (!uid) return json({ error: "Could not read user id from token" }, 401);

  const { data: prof, error: pErr } = await admin.from("users").select("role,status").eq("id", uid).maybeSingle();
  const allowed = !!prof && prof.status === "approved" && ["super_admin", "admin"].includes(prof.role);
  if (!allowed) {
    return json({
      error: "Only an admin may approve a 3D reconstruction request",
      uid, profile_found: !!prof, role: prof?.role || null, status: prof?.status || null,
      lookup_error: pErr?.message || null,
    }, 403);
  }

  // ---- Load + validate the request -----------------------------------------
  let requestId: string | null = null;
  try { requestId = (await req.json())?.request_id || null; } catch { /* no body */ }
  if (!requestId) return json({ error: "request_id is required" }, 400);

  const { data: reqRow, error: reqErr } = await admin
    .from("reconstruction_requests").select("*").eq("id", requestId).maybeSingle();
  if (reqErr) return json({ error: reqErr.message }, 500);
  if (!reqRow) return json({ error: "Request not found" }, 404);
  if (reqRow.status !== "pending_approval") {
    return json({ error: `Request is '${reqRow.status}', not 'pending_approval' — nothing to approve` }, 409);
  }
  if (!reqRow.video_url) return json({ error: "Request has no video attached" }, 400);

  // ⚠️ can_access_project() is a Postgres RLS helper (not directly callable
  // from Deno) — re-derived here the same way every other Edge Function in
  // this repo checks project access: the admin's OWN project assignment list,
  // read the same way AppAuth.canAccessProject() does client-side. A
  // super_admin/admin bypasses the assignment check entirely (matches the
  // app's own role model — admins see every project).
  if (!["super_admin", "admin"].includes(prof!.role)) {
    // (unreachable today — this endpoint already requires admin/super_admin —
    // kept as a second guard in case the role check above is ever loosened.)
    const { data: adminProf } = await admin.from("users").select("projects").eq("id", uid).maybeSingle();
    const projects: string[] = adminProf?.projects || [];
    if (!projects.includes(reqRow.project_id)) return json({ error: "Not assigned to this project" }, 403);
  }

  // ---- Sign a short-lived URL to the source video ---------------------------
  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET).createSignedUrl(reqRow.video_url, VIDEO_SIGN_TTL);
  if (signErr || !signed?.signedUrl) {
    return json({ error: "Could not sign the source video: " + (signErr?.message || "unknown") }, 500);
  }

  // ---- Submit to RunPod (async job + webhook) -------------------------------
  const webhookToken = crypto.randomUUID();
  const webhookUrl = `${PL_URL}/functions/v1/reconstruction-webhook?request_id=${requestId}&token=${webhookToken}`;

  const runpodRes = await fetch(`https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/run`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${RUNPOD_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      input: {
        request_id: requestId,
        project_id: reqRow.project_id,
        video_url: signed.signedUrl,
        // The worker uploads results back to OUR storage bucket under this
        // prefix using its own service-role key (a RunPod secret, not passed
        // in the payload) — the video URL above is the only per-job secret
        // that travels through RunPod's own systems.
        result_prefix: `${reqRow.project_id}/reconstructions/${requestId}/`,
      },
      webhook: webhookUrl,
    }),
  });
  const runpodJson = await runpodRes.json().catch(() => ({}));
  if (!runpodRes.ok || !runpodJson?.id) {
    return json({ error: "RunPod submission failed: " + JSON.stringify(runpodJson) }, 502);
  }

  const { error: updErr } = await admin.from("reconstruction_requests").update({
    status: "queued",
    approved_by: uid,
    approved_at: new Date().toISOString(),
    runpod_job_id: runpodJson.id,
    webhook_token: webhookToken,
    updated_at: new Date().toISOString(),
  }).eq("id", requestId).eq("status", "pending_approval"); // re-assert status hasn't moved under us
  if (updErr) return json({ error: updErr.message }, 500);

  return json({ ok: true, runpod_job_id: runpodJson.id, status: "queued" });
});
