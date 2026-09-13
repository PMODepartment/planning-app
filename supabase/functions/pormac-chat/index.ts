// Edge Function: pormac-chat
// -----------------------------------------------------------------------------
// The hosted-model path for the Pormac assistant. It proxies to a free hosted
// inference provider (Groq, an open model) — still zero cost, on a free tier.
//
// ⚠️⚠️ THIS IS NOW THE PREFERRED PATH, NOT A FALLBACK FOR WEAK DEVICES, AND THE
// REVERSAL IS DELIBERATE (2026-09-12, owner: "the model is not so smart").
// The original design ran a 1–3B model in the browser and reached for this
// function only when that was impossible — so the BETTER the planner's laptop,
// the WORSE the model answering them. A 70B-class hosted model is roughly 20x
// the parameters of the largest model WebLLM can practically run in a tab, and
// the free tier costs the same as the browser path: nothing. The browser path
// is kept and is one click away (Pormac's Quality control) for offline use and
// for when this function is not configured — it is the fallback now.
//
// ⚠️ Because this is the primary path, the daily cap below is a quota guard
// rather than a rationing device, and is env-tunable. Set it back down if the
// org's free Groq allowance turns out to be the binding constraint.
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

// Per-user, per-day calls into the shared free quota. ⚠️ Was 30 while this was
// a last-resort fallback for a handful of old phones; as the primary path for
// every planner, 30 messages is half a morning. Env-tunable so the owner can
// retune it against the real Groq allowance without a redeploy of this file.
const DAILY_REMOTE_CAP = Number(Deno.env.get("PORMAC_DAILY_CAP") || 200);
// Prompt-size guard. ⚠️ Was 24,000 characters (~6k tokens) against a model that
// accepts 131k of context — so it was throwing away most of the grounding that
// makes an answer good, to protect a quota measured in REQUESTS, not tokens.
const MAX_PROMPT_CHARS = Number(Deno.env.get("PORMAC_MAX_PROMPT_CHARS") || 120000);

// ⚠️⚠️ GROQ RETIRES MODEL IDS, AND A RETIRED ID IS A TOTAL OUTAGE OF THIS PATH.
// The provider decommissions hosted models on its own schedule and then answers
// every request with a 400 naming the dead id — so a single hard-coded model is
// a time bomb this function has no way to survive. GROQ_MODEL (if set) is tried
// first, then these in order, and the first that answers wins. Ordered by
// capability, largest first.
const MODEL_CHAIN = [
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-120b",
  "llama-3.1-8b-instant",
];
// A model-level rejection (dead id, no entitlement) is worth retrying on the
// next model; a rate limit or a server fault is NOT — retrying those just burns
// the same quota against a different model for the same result.
//
// ⚠️⚠️ CLASSIFIED BY THE PROVIDER'S OWN ERROR CODE, NOT BY ITS PROSE. The first
// cut matched /model|decommission|deprecat|…/ against the response text, and the
// bare word "model" appears in errors that have nothing to do with a dead id —
// `max_tokens exceeds the model's limit`, a malformed `messages` array naming
// the model. Those would burn the entire chain re-asking three models the same
// bad question and then report the LAST model's error, turning a client-side
// bug into what looks like a provider outage. Groq is OpenAI-compatible and
// returns {error:{code}}, so the code is authoritative; the regex survives only
// as a last resort for a provider that sends no code.
const MODEL_DEAD = (status: number, body: string) => {
  if (status !== 400 && status !== 404) return false;
  try {
    const code = JSON.parse(body)?.error?.code;
    if (code) return /model_not_found|model_decommissioned|does_not_exist/i.test(String(code));
  } catch { /* not JSON — fall through to the prose check below */ }
  return /decommission|deprecat|does not exist|no such model/i.test(body);
};

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
  // An explicitly configured model is tried FIRST, then the chain. Listing it
  // twice would just spend a retry re-asking a question already answered.
  const GROQ_MODEL = Deno.env.get("GROQ_MODEL") || "";
  const models = [GROQ_MODEL, ...MODEL_CHAIN].filter((m, i, a) => m && a.indexOf(m) === i);
  if (!GROQ_KEY) return json({
    code: "no_key",
    error: "GROQ_API_KEY not configured — see this file's header for setup",
  }, 503);

  // ---- Authorize the caller, AS the caller ---------------------------------
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!auth) return json({ error: "Missing Authorization" }, 401);

  const asUser = createClient(PL_URL, PL_ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: "Bearer " + auth } },
  });

  // Trust the `sub` claim of a JWT the platform has already signature-checked
  // (verify_jwt=true) — the same shortcut sync-wpm/sync-eng take to avoid a
  // second GoTrue round trip that trips over disabled legacy keys.
  // ⚠️ Parsed BEFORE either query starts. Starting the access-check RPC first
  // and then returning 401 here would abandon an in-flight promise nobody
  // awaits — a floating rejection on the one path that is already an error.
  let uid: string | null = null;
  try {
    const seg = auth.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    uid = JSON.parse(atob(seg))?.sub || null;
  } catch { uid = null; }
  if (!uid) return json({ error: "Could not read user id from token" }, 401);

  // ---- Per-user daily cap (service role — the only writer of this table) ---
  const admin = createClient(PL_URL, PL_SERVICE, { auth: { persistSession: false } });
  const today = new Date().toISOString().slice(0, 10);
  // ⚠️ The access check and the usage read are INDEPENDENT — the usage row is
  // keyed on the uid parsed above, not on anything the RPC returns. Sequenced,
  // they put two Postgres round trips end to end in front of every probe, which
  // is what the planner's first message blocks on.
  const [{ data: canUse, error: cuErr }, { data: usageRow }] = await Promise.all([
    asUser.rpc("pormac_can_use"),
    admin.from("pormac_usage").select("remote_calls").eq("user_id", uid).eq("day", today).maybeSingle(),
  ]);
  if (cuErr) return json({ error: "Access check failed: " + cuErr.message }, 500);
  if (!canUse) return json({ error: "Pormac is not enabled for your account yet." }, 403);
  const used = usageRow?.remote_calls || 0;
  if (used >= DAILY_REMOTE_CAP) return json({
    code: "quota",
    error: `You've used today's ${DAILY_REMOTE_CAP} cloud messages. Pormac shares one free quota across ` +
           `everyone — switch Quality to "On this device" to keep going with no limit (a smaller model, ` +
           `running in your browser), or come back tomorrow.`,
  }, 429);

  // ---- Read the request body -----------------------------------------------
  // { messages: [{role:'system'|'user'|'assistant', content: string}, …] } —
  // the module has ALREADY assembled any grounding context (schedule figures,
  // risk register, etc.) into these messages, under the caller's own RLS. This
  // function never fetches app data itself — see the header comment.
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  // ⚠️ PROBE: answers "is the hosted path usable for me right now?" without
  // calling the provider and WITHOUT counting against the caller's daily
  // allowance. Pormac calls this once on load so the Quality control can show
  // the real state (configured / not deployed / out of quota) before the
  // planner types anything — the alternative is a failed first message and a
  // 2GB model download starting underneath it.
  if (body?.probe) {
    // ⚠️ Only what a caller reads. This used to answer `configured`, `model`,
    // `used_today` and `cap` as well — none of which any client ever read, and
    // `model` was a guess anyway (it named the head of the chain, not whichever
    // model would actually end up answering).
    return json({ ok: true, remaining_today: Math.max(0, DAILY_REMOTE_CAP - used) });
  }

  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages || !messages.length) return json({ error: "messages[] required" }, 400);

  // A crude but real guard on the shared quota: this is a free tier, not a
  // metered one, and an unbounded prompt from one caller must not be able to
  // burn the whole org's daily budget in a single request.
  const totalChars = messages.reduce((n: number, m: any) => n + String(m?.content || "").length, 0);
  if (totalChars > MAX_PROMPT_CHARS) return json({ error: "That's more context than one message can carry — ask a narrower question, or start a fresh conversation." }, 413);

  // ---- Call the hosted model -----------------------------------------------
  // Walk the model chain: the first model that answers wins. ⚠️ Only a
  // model-level rejection advances to the next one — a 429 or a 5xx is the
  // provider telling us to stop, and re-asking with a different model would
  // spend the same quota to be refused again.
  let out: any = null, usedModel = "", lastErr = "", lastStatus = 502;  // 502 only if models[] were ever empty
  for (const model of models) {
    let resp: Response;
    try {
      resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 2048 }),
      });
    } catch (e) {
      return json({ error: "Could not reach the cloud model provider: " + (e as Error).message }, 502);
    }
    if (resp.ok) { out = await resp.json(); usedModel = model; break; }
    const t = await resp.text().catch(() => "");
    lastErr = t.slice(0, 500); lastStatus = resp.status;
    if (!MODEL_DEAD(resp.status, t)) break;   // not a dead id — stop, don't burn the chain
  }
  if (!out) return json({ error: `Cloud model provider returned ${lastStatus}: ${lastErr}` }, 502);
  const reply = out?.choices?.[0]?.message?.content || "";

  // Record usage AFTER a successful call — a failed call should not count
  // against the planner's daily allowance.
  await admin.from("pormac_usage")
    .upsert({ user_id: uid, day: today, remote_calls: used + 1 }, { onConflict: "user_id,day" });

  // ⚠️ Reports the model that ACTUALLY answered, never the one that was asked
  // for — after a chain fallback those are different, and the planner's tier
  // bar naming a model that is no longer serving them is a lie the UI cannot
  // detect on its own.
  return json({ reply, tier: "remote", model: usedModel, remaining_today: Math.max(0, DAILY_REMOTE_CAP - used - 1) });
});
