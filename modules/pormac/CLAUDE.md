# Pormac — module change log

An AI chat assistant, built to run at **zero hosting cost**: inference happens IN THE
BROWSER (WebLLM over WebGPU), with a shared free hosted-model fallback for devices that
can't do that. One entry per prompt, newest first.

---

## 2026-09-12 — First build

Owner: *"add a new module open to all or selected users - an AI bot named Pormac... totally
free... in-browser inference... capacity detection and tiered fallback... connect to all
data linked to the planning app as well as data linked to the procurement app and
engineering app."*

### ⚠️⚠️ WHAT "CONNECT TO PROCUREMENT/ENGINEERING DATA" ACTUALLY MEANS HERE, AND WHY
Checked rather than assumed: `assets/js/config.js` in this app, `prc-app` (Procurement) and
`engineering-app` each point at a **different Supabase project** (three different URLs, three
different anon keys, confirmed by cloning both repos and grepping their own `config.js`). A
Planners-app login has no session in either of the other two, so a browser-side call from this
module to their REST endpoints would run as an anonymous stranger, governed only by THEIR RLS
for the `anon` role — which should refuse it, and if it didn't, that would be a leak in their
app, not a feature to build here. `MODULE_CONTRACT.md` §5 already states the rule for tables
*inside this one app* ("cross-module data comes later, through the main app owner"); it applies
with more force across genuinely separate applications with separate auth.

What actually answers the ask: this app **already maintains sanctioned mirrors** of exactly this
data, written server-side by `supabase/functions/sync-wpm` and `supabase/functions/sync-eng`
using each source app's service-role key (never exposed to a browser), read here under the
signed-in planner's own RLS — the same way Cash Flow and the Schedule's Design Development
branch already read them. Pormac's grounding reads those mirrors
(`wpm_work_packages`/`wpm_vendors`/`eng_design_progress`) rather than inventing a second,
unsafe path to the same data. Nothing new was built to make this possible; it was found, not
assumed, by reading the existing Edge Functions before writing any Pormac-specific code.

⚠️ `wpm_work_packages` is **not** mapped to this app's project id (its own migration says so
plainly) — only `wmp_project_id`, the WPM app's own id. The procurement context provider tries
an exact match on the current project id first (many projects share a code across both apps in
practice) and **falls back to a portfolio-wide summary, saying so explicitly**, rather than
silently mixing another project's figures into an answer about this one. `eng_design_progress`
has no such problem — its own comment states projects are sourced FROM this app, so the id is
the same in both — and its provider filters cleanly.

### Access control: "open to all or selected users" is a runtime setting, not a code flag
A `pormac_settings` singleton (`access_mode: 'all'|'selected'`) plus `pormac_allowed_users`, read
by one `pormac_can_use()` SQL function that both the DB (RLS) and the Edge Function trust —
never re-implemented in two places to drift apart. ⚠️ Defaults to `'selected'` with an **empty**
allow-list (admin/super_admin only) — the same safe-by-default posture new modules ship with
(`enabled:false` / `superAdminOnly:true`) rather than opening to everyone by default.
⚠️ `config.js`'s `enabled:true` only controls whether the **nav row** is visible — it is
deliberately NOT `superAdminOnly:true`, because the whole point of this access model is an
admin flipping "everyone" vs "selected users" from inside the module itself, without a code
change. Everyone sees the row; only allowed users get past the "not turned on for you yet"
screen.

### Capability detection is a heuristic, and says so
There is no reliable way to read a device's actual free VRAM from a web page —
`navigator.deviceMemory` doesn't exist on Safari or Firefox at all. `detectCapability()` is
therefore honestly a **conservative heuristic**: WebGPU adapter presence, `deviceMemory` where
available, and a mobile/desktop UA guess otherwise — always erring toward the lighter tier
rather than risking a crash on a device it can't actually measure. See the September 2026
back-and-forth with the owner on iPhone 14 Pro (6GB, iOS 26, WebGPU-capable) that this heuristic
is shaped around: it is placed in the `local-lite` tier, never `local-full`, on a guess alone.

### Tiered fallback, and "slow down instead of crash"
Three tiers — `local-full` (a ~3B-class model), `local-lite` (~1B-class), `remote` (the hosted
Edge Function) — resolved by pattern-matching WebLLM's own `prebuiltAppConfig.model_list` at
runtime rather than hard-coding one model id that could 404 the day the upstream catalogue
changes. ⚠️ A runtime failure (OOM, WebGPU context lost, load error) steps the tier down
**and remembers it in `localStorage`** so the next visit on that device doesn't repeat a doomed
load — this is the concrete answer to "can it slow down instead of crashing."

### Grounding is deterministic retrieval, not tool-calling
A 1–3B in-browser model is not reliable at emitting well-formed tool calls (the earlier
discussion with the owner established this before any code was written). Rather than asking the
model which data to fetch, a keyword router matches the question against a fixed set of
**context providers** and includes up to four, always shown back to the planner as chips under
the reply — nothing is a black box about what an answer is grounded in.

⚠️⚠️ **The planning-app providers are not hand-written per module — they are derived from
`APP_CONFIG.MODULES`' own `dash` spec**, calling the exact same `PDb.moduleMetrics()` the
Project Dashboard tile already uses. This means Pormac's figures for the schedule, risk
register, stakeholder map, meetings, issues, contracts, cash flow, photos, productivity etc.
can never disagree with what the Dashboard already shows, because both read one declared spec —
and it means adding a `dash` spec to a future module gives Pormac that module's context for
free, with no Pormac-side change.

### The hosted fallback is a dumb proxy, not a second data path
`supabase/functions/pormac-chat` does **not** fetch app data itself. It only: checks
`pormac_can_use()` via the caller's OWN JWT (never re-implements the rule), enforces a per-user
daily cap on the shared free Groq quota (`pormac_usage`, service-role write only), and forwards
the messages the module already assembled client-side — under the caller's own RLS — to Groq.
An Edge Function fetching context with the service role would answer with data the signed-in
user might not actually be allowed to see; keeping the fetch client-side means the fallback can
never see more than the user already can.

### Verified
- `node --check` on `module.js`; brace balance on `module.css`; the new `botChat` icon resolves
  (`Icons.names` includes it) and is distinct from every icon already in use.
- `config.js`/`icons.js` are shared assets — bumped to a single new `?v=` across every
  referencing page (29 and 23 respectively), 0 version splits.
- `pormac_can_use()`'s three branches (admin bypass, `access_mode='all'`, allow-list) read
  correctly against the SQL as written; the singleton constraint on `pormac_settings.id`
  prevents a second settings row.
- The procurement provider's fallback-to-portfolio-wide behaviour and its caveat string were
  traced against the mirror's own "not mapped to a Planners project id" comment, not assumed.

⚠️⚠️ **Not verified signed in, and this is the big caveat.** No live login is possible from
here: `pormac_can_use()` has never actually been called against a real session, no WebGPU
device has loaded a real model through this code, and `supabase/functions/pormac-chat` has not
been deployed (see its own header for the `supabase functions deploy` / `supabase secrets set`
commands — this needs the app owner's Supabase CLI access and a Groq API key, neither of which
exist in this environment). The first real test is: run `migrations/2026-09-12-pormac.sql`,
deploy the Edge Function with a `GROQ_API_KEY` secret, open the module as an admin, and send one
message on both a WebGPU-capable laptop and an older phone.

⚠️ **Deliberately not built in this pass:** streaming for the remote tier (the local tier
streams token-by-token; the Edge Function returns one JSON response — a real UX gap on a slow
cloud reply, and a reasonable follow-up); a way for a planner to browse/delete past
conversations (they're saved, just not listed anywhere yet); and pinning a specific WebLLM
package version once the team has tested one release against real hardware, rather than always
resolving `+esm` "latest" (see the CDN import comment in `module.js`).
