// Edge Function: reconstruction-webhook
// -----------------------------------------------------------------------------
// Called BY RUNPOD (not by the browser, not by any Supabase-authenticated
// caller) when a reconstruction job finishes. RunPod has no Supabase session,
// so this function CANNOT require a Supabase JWT the way every other function
// in this repo does — it is instead protected by a per-request random token
// generated in submit-reconstruction and embedded in the webhook URL, checked
// against the row before anything is written.
//
// ⚠️ DEPLOY THIS ONE WITHOUT JWT VERIFICATION:
//   supabase functions deploy reconstruction-webhook --no-verify-jwt --project-ref bgupuqnkqhixpuctyder
// Every other function in this repo deploys with the platform's default JWT
// check ON. This is the one deliberate exception, and the reason is the
// paragraph above — get this flag right or RunPod's callback will be
// rejected before it ever reaches the token check.
//
// RunPod's serverless webhook POSTs its own job-result envelope:
//   { id, status: "COMPLETED"|"FAILED"|..., output?: {...}, error?: string }
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const PL_URL = Deno.env.get("SUPABASE_URL")!;
  const PL_SERVICE = Deno.env.get("PL_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(PL_URL, PL_SERVICE, { auth: { persistSession: false } });

  const url = new URL(req.url);
  const requestId = url.searchParams.get("request_id");
  const token = url.searchParams.get("token");
  if (!requestId || !token) return json({ error: "request_id and token query params are required" }, 400);

  const { data: reqRow, error: reqErr } = await admin
    .from("reconstruction_requests").select("id,webhook_token,status").eq("id", requestId).maybeSingle();
  if (reqErr) return json({ error: reqErr.message }, 500);
  if (!reqRow) return json({ error: "Request not found" }, 404);
  // ⚠️ THE ACTUAL SECURITY CHECK. Anyone who does not know this per-request
  // token cannot write a result onto this row, regardless of what they claim
  // to be. Constant-time comparison isn't used here (Deno's std doesn't ship
  // one by default) — a timing side-channel on a UUID-length token guessed
  // over the network is not a realistic threat model for this feature.
  if (reqRow.webhook_token !== token) return json({ error: "Invalid token" }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body */ }

  const status = String(body?.status || "").toUpperCase();
  const now = new Date().toISOString();

  if (status === "COMPLETED") {
    const out = body?.output || {};
    const { error: updErr } = await admin.from("reconstruction_requests").update({
      status: "done",
      result_pointcloud_url: out.pointcloud_url || null,
      result_splat_url: out.splat_url || null,
      result_stats: out.stats || null,
      updated_at: now,
    }).eq("id", requestId);
    if (updErr) return json({ error: updErr.message }, 500);
  } else if (status === "FAILED" || body?.error) {
    const { error: updErr } = await admin.from("reconstruction_requests").update({
      status: "failed",
      error_message: String(body?.error || "Reconstruction failed with no further detail"),
      updated_at: now,
    }).eq("id", requestId);
    if (updErr) return json({ error: updErr.message }, 500);
  } else {
    // An IN_PROGRESS or other intermediate ping — reflect it, don't fail it,
    // so an unrecognised RunPod status still shows movement rather than
    // looking like the row is stuck.
    await admin.from("reconstruction_requests").update({
      status: "processing", updated_at: now,
    }).eq("id", requestId).eq("status", "queued");
  }

  // RunPod expects a 2xx acknowledgement regardless of the job outcome above
  // (a non-2xx here means "the webhook failed", not "the job failed").
  return json({ ok: true });
});
