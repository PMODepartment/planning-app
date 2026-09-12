// Edge Function: pormac-chat
// -----------------------------------------------------------------------------
// Hosted-model FALLBACK for the Pormac assistant module. Pormac's primary path
// runs entirely in the browser (WebLLM/WebGPU) at zero cost; this function
// exists only for devices the capability check (module.js `detectCapability`)
// finds cannot run that reliably — no WebGPU, or too little memory — and for a
// local model that fails to load or crashes at runtime. It proxies to a free
// hosted inference provider (Groq, an open model) so those devices are not
// simply told "no."
//
// SECURITY MODEL
//  - The caller's OWN JWT is used to check pormac_can_use() (a security-definer
//    SQL function keyed on auth.uid()) — this function does NOT re-implement
//    the access rule, so the DB and the Edge Function can never disagree about
//    who may use Pormac.
//  - The Groq API key is an Edge Function secret (GROQ_API_KEY) — never shipped
//    to the browser. A client-side key would be world-readable in this app's
//    static JS the moment anyone viewed source.
//  - This function does NOT read any app data itself. The calling module
//    assembles grounding context (schedule/risk/BOQ/etc. figures) client-side,
//    under the CALLER'S OWN RLS session, and sends it as ordinary chat
//    messages — exactly what the local WebLLM path also receives. An Edge
//    Function pulling context with the service role would answer with data
//    the signed-in user might not actually be allowed to see; keeping the
//    fetch client-side means this fallback can never see more than the user
//    already can.
//  - A per-user daily cap on `pormac_usage` (service role, bypasses RLS —
//    the browser can never write it) protects the SHARED free Groq quota:
//    without it, one user stuck on the cloud path could exhaust the org's
//    whole daily allowance.
//
// DEPLOY (from planning-app/):
//   supabase functions deploy pormac-chat --project-ref bgupuqnkqhixpuctyder
//   supabase secrets set GROQ_API_KEY=<your Groq API key> --project-ref bgupuqnkqhixpuctyder
//   # optional, defaults to a current Groq free-tier Llama model:
//   supabase secrets set GROQ_MODEL=llama-3.3-70b-versatile --project-ref bgupuqnkqhixpuctyder
//
// Get a free Groq API key at https://console.groq.com — no card required for
// the free tier at time of writing. Swap the provider by changing GROQ_URL/
// GROQ_MODEL and the Authorization scheme below if the org prefers a
// different free host (e.g. Cloudflare Workers AI).
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// The publishable ("anon") key — SAFE to hold here; it is the exact string
// already public in assets/js/config.js. It is what lets this function open a
// client THAT ACTS AS THE CALLER (via their JWT below) rather than as an
// admin, which is what makes the pormac_can_use() check trustworthy.
const DEFAULT_ANON_KEY = "sb_publishable_5NTpDRZcROZYrV-tZ5wXLg_f88eqUzs";

const DAILY_REMOTE_CAP = 30; // per-user, per-day calls into the shared free quota

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const PL_URL = Deno.env.get("SUPABASE_URL")!;
  const PL_ANON = Deno.env.get("SUPABASE_ANON_KEY") || DEFAULT_ANON_KEY;
  // Same "legacy JWT silently degrades to anon" trap this project's other
  // Edge Functions (sync-wpm, sync-eng) already document — guard rather than
  // discover it later as a usage-table write that mysteriously never lands.
  const PL_SERVICE = Deno.env.get("PL_SERVICE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const plKind = PL_SERVICE?.startsWith("sb_secret_") ? "new" : PL_SERVICE?.startsWith("ey") ? "legacy-jwt" : "unknown";
  if (plKind !== "new") return json({
    error: "PL_SERVICE_KEY must be the Planners project's new sb_secret_ key",
    pl_key_kind: plKind,
  }, 500);

  const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
  const GROQ_MODEL = Deno.env.get("GROQ_MODEL") || "llama-3.3-70b-versatile";
  if (!GROQ_KEY) return json({ error: "GROQ_API_KEY not configured — see this file's header for setup" }, 500);

  // ---- Authorize the caller, AS the caller ---------------------------------
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!auth) return json({ error: "Missing Authorization" }, 401);

  const asUser = createClient(PL_URL, PL_ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: "Bearer " + auth } },
  });
  const { data: canUse, error: cuErr } = await asUser.rpc("pormac_can_use");
  if (cuErr) return json({ error: "Access check failed: " + cuErr.message }, 500);
  if (!canUse) return json({ error: "Pormac is not enabled for your account yet." }, 403);

  // Trust the `sub` claim of a JWT the platform has already signature-checked
  // (verify_jwt=true) — the same shortcut sync-wpm/sync-eng take to avoid a
  // second GoTrue round trip that trips over disabled legacy keys.
  let uid: string | null = null;
  try {
    const seg = auth.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    uid = JSON.parse(atob(seg))?.sub || null;
  } catch { uid = null; }
  if (!uid) return json({ error: "Could not read user id from token" }, 401);

  // ---- Per-user daily cap (service role — the only writer of this table) ---
  const admin = createClient(PL_URL, PL_SERVICE, { auth: { persistSession: false } });
  const today = new Date().toISOString().slice(0, 10);
  const { data: usageRow } = await admin.from("pormac_usage")
    .select("remote_calls").eq("user_id", uid).eq("day", today).maybeSingle();
  const used = usageRow?.remote_calls || 0;
  if (used >= DAILY_REMOTE_CAP) return json({
    error: `Daily cloud-fallback limit reached (${DAILY_REMOTE_CAP} messages). This device can't run ` +
           `Pormac locally, so it shares a limited free quota with everyone else on that path — try again ` +
           `tomorrow, or use a newer device/laptop where Pormac runs on-device with no limit.`,
  }, 429);

  // ---- Read the request body -----------------------------------------------
  // { messages: [{role:'system'|'user'|'assistant', content: string}, …] } —
  // the module has ALREADY assembled any grounding context (schedule figures,
  // risk register, etc.) into these messages, under the caller's own RLS. This
  // function never fetches app data itself — see the header comment.
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages || !messages.length) return json({ error: "messages[] required" }, 400);

  // A crude but real guard on the shared quota: this is a free tier, not a
  // metered one, and an unbounded prompt from one caller must not be able to
  // burn the whole org's daily budget in a single request.
  const totalChars = messages.reduce((n: number, m: any) => n + String(m?.content || "").length, 0);
  if (totalChars > 24000) return json({ error: "That's too much context for the cloud fallback — try a shorter question or a fresh conversation." }, 413);

  // ---- Call the hosted model -----------------------------------------------
  let resp: Response;
  try {
    resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: GROQ_MODEL, messages, temperature: 0.3, max_tokens: 1024 }),
    });
  } catch (e) {
    return json({ error: "Could not reach the cloud model provider: " + (e as Error).message }, 502);
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    return json({ error: `Cloud model provider returned ${resp.status}: ${t.slice(0, 500)}` }, 502);
  }
  const out = await resp.json();
  const reply = out?.choices?.[0]?.message?.content || "";

  // Record usage AFTER a successful call — a failed call should not count
  // against the planner's daily allowance.
  await admin.from("pormac_usage")
    .upsert({ user_id: uid, day: today, remote_calls: used + 1 }, { onConflict: "user_id,day" });

  return json({ reply, tier: "remote", model: GROQ_MODEL, remaining_today: Math.max(0, DAILY_REMOTE_CAP - used - 1) });
});
