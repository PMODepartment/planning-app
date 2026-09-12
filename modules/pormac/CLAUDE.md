# Pormac — module change log

An AI chat assistant, built to run at **zero hosting cost**: inference happens IN THE
BROWSER (WebLLM over WebGPU), with a shared free hosted-model fallback for devices that
can't do that. One entry per prompt, newest first.

---

## 2026-09-12 (f) — One conversation per project, and the composer a slow fetch could hide

Owner: *"no need for chat and history tab switcher. keep only 1 conversation per user per
project. history should be scrollable as needed. no need also for new chat since everything is
in one conversation"* and *"I cant type text to ask pormac. please fix"*.

### ⚠️⚠️ THE COMPOSER WAS `display:none`, BEHIND AN `await` — MEASURED, NOT GUESSED
`#pmc-chrome` — the tier bar, the thread, the composer and the hint, i.e. everything you can
type into — shipped as `style="display:none"` and was revealed by `switchView('chat')`, which
sat **below `await loadProjects()`**. So a project fetch that was slow, refused or simply never
resolved left the planner looking at a topbar and an empty page with **no input on it at all**
and nothing saying why. Reproduced in a browser against the shipped bytes with the fetch left
pending: `#pmc-input` renders **0×0** and a click on it times out; with the fetch resolving it
renders and accepts text. That is the reported symptom exactly.

⚠️ This is the (d) bug one layer up. That entry moved the *handlers* above the first `await`
for precisely this reason and left the *pane's visibility* below it. The pane is now visible in
the markup itself — there is only one screen, so there is nothing left for a switcher to reveal.

⚠️⚠️ **AND `module.js` / `module.css` HAD NO `?v=` AT ALL.** Every same-day fix to this module
since it launched — (b), (c), (d), (e) — changed those two files under a URL a browser had
already cached, so any of them may never have reached the owner's tab. That alone can look like
"the buttons don't work" long after they were fixed. Both now carry `?v=20260912r`.

### The layout was never docked, so the composer also drifted below the fold
`.pmc-main` asked for `height:100%` inside `.pd-content`, which the shared stylesheet declares
as `flex:1; min-width:0` with **no height** — so it resolved to `auto`, the thread grew with the
conversation, and the **page** scrolled rather than the thread. `.pd-content` now takes a
viewport height (`100vh`, then `100dvh`) and becomes the flex column, the same thing
project-schedule does for its docked details panel. The thread is the one thing that scrolls —
which is also what *"history should be scrollable as needed"* asks for — and the composer is
pinned where it can always be reached. ⚠️ `.pd-topbar` needs `flex:none` with it: a flex item
defaults to `flex-shrink:1`, so a height-constrained column crushes the bar below its own
content and paints it over the chat (the 2026-09-10 z5 defect, in this module's shape).

### One conversation per planner per project
`.pmc-tabs`, `#pmc-new` and the whole `#pmc-history` pane are gone, along with `switchView` /
`renderHistory` / `openConversation` / `deleteConversation`. Opening the module — or switching
project — resumes that project's single running thread through one new `loadConversation()`.

- ⚠️⚠️ **"ONE" IS ENFORCED BY WHAT THE CLIENT READS, NOT BY A UNIQUE INDEX, AND THAT IS A
  DELIBERATE CALL.** Rows already exist from before this change (every press of the old "New
  chat" made one), so a unique constraint could not be added without first destroying or merging
  real conversations. And the **General (no project)** case cannot be covered by a plain unique
  index at all: Postgres treats NULLs as distinct, so `(created_by, project_id)` would happily
  admit a second NULL-project row — the same trap `2026-09-10-boq-project-scope.sql` had to use
  a *partial* index for. So there is **no migration**: `loadConversation()` reads **every**
  conversation the planner has for this project and merges their messages into one chronological
  thread, so *"everything is in one conversation"* is true on screen from the first load,
  **including retroactively**, while new turns are written to the most recently updated row —
  which converges them over time without deleting anything.
- ⚠️ **`.eq('created_by', …)` is not redundant with RLS.** The select policy is
  `created_by = auth.uid() OR is_admin()`, so without it an admin would load every planner's
  conversations into their own thread.
- ⚠️ **The message read is newest-first + `limit`, then reversed.** An *ascending* limit would
  have returned the OLDEST 200 and silently dropped everything recent — the half a planner is
  actually reading. The cap is 200 and, when it bites, the thread says so at the top rather than
  letting a capped thread read as the start of the conversation. Older turns stay in the database.
- ⚠️ A **token guard** (`convToken`) drops a conversation load that lands after the planner has
  already switched project — otherwise the slower of two fetches wins and paints the wrong
  project's history.
- ⚠️ A failed history read **says so in the thread and leaves the chat usable**, rather than
  showing a blank thread that reads as "nothing was ever saved".
- ⚠️ `updated_at` is still bumped on every turn by `persistTurn()` — its role changed from
  sorting the History list to **choosing which row is canonical**, so it is still load-bearing.

### Verified
Driven in a real browser (Chromium, the shipped `index.html` with only auth/DB stubbed, harness
deleted afterwards), at 1440×900 and 390×740, light and dark:
- **The input is in the viewport, is the top element at its own centre, and accepts typed text
  in all five scenarios — including with the project fetch left permanently pending.** The same
  probe against the pre-fix bytes reports `0×0` and a click timeout, so it bites.
- 300 stored messages → the cap note, then `msg 101 … msg 300` in **chronological** order, the
  thread scrolling and pinned at the bottom. ⚠️ The first version of the probe stubbed the query
  builder without honouring `.order()`/`.limit()` and reported the thread reversed — a defect in
  the checker, not the code; the stub now applies both the way PostgREST does.
- Switching project reloads that project's own thread; a project with no conversation shows the
  empty state. 0 tabs, no New-chat button, no history pane, 0 page errors, no horizontal or
  vertical page scroll at either width.
- `node --check` clean; `module.css` braces 30/30; 0 NUL bytes; `tools/wiring-check.js`
  **126/126, 0 version splits**; `tools/dead-hooks.js` unchanged against its documented 9-finding
  baseline (`.pmc-tab` did not become a dead hook — the query went with the markup).
- `.pmc-muted` was only used by the History pane and is removed with it. ⚠️ `.pmc-meta` is dead
  too and is **left alone** — it has never been emitted since this module's first build, so it
  is pre-existing and outside this change.

⚠️ **Not verified signed in.** No real conversation has been loaded, merged or written; the
merge-across-old-rows behaviour in particular has only been exercised against a stub. **The
first thing to check on a real login is whether a project's earlier chats appear in one thread.**

---

## 2026-09-12 (e) — Chat history: a real second screen, and "New chat" made to work from it

Owner: *"include already the char history in this build. fix also new chat so it should
work."* The "not built in this pass" item from the first build — a screen to browse/delete
past conversations — lands here; `pormac_conversations`/`pormac_messages` already existed for
it (2026-09-12 first build), so no migration.

- **`Chat` / `History` is now a real, working tab pair**, using the same `UI.tabsToDropdown()`
  every other module's screen switcher already goes through — this is also why the lone
  `Chat` tab did nothing before: that helper bails outright below two buttons
  (`if (btns.length < 2) return;`), so it had never actually run.
- **History is personal, not project-scoped** — `pormac_conversations`' own `select` RLS is
  gated on `created_by = auth.uid() or is_admin()`, with no project clause, so the list spans
  every project a planner has ever chatted about, each row naming which one (from the
  `PROJECTS` array `loadProjects()` already caches, no second fetch). Clicking a row loads its
  messages and **restores the project it was grounded in** — but only if that project is still
  one the planner can see; one they've since lost access to falls back to General rather than
  pointing a context provider at an id RLS would refuse anyway.
- ⚠️⚠️ **`updated_at` was declared, indexed (`idx_pormac_conv_owner … updated_at desc`), and
  never once written.** Nothing bumped it after the first message, so every conversation would
  have sorted by its *creation* time forever — an ongoing chat sinking below a brand-new one
  the moment the newer one was opened. `persistTurn()` now updates it on every turn after the
  first (the insert already sets it via the column default).
- **Delete is per-row**, `confirm()`-gated to match this app's existing convention (risk-register,
  issues-lessons) rather than a bespoke dialog; `pormac_messages` cascades, so one delete is
  enough. Deleting the conversation currently open in Chat drops it back to blank.
- ⚠️⚠️ **"New chat" needed one more fix once History existed**: it reset `chatHistory` and
  `conversationId` correctly already, but clicking it while ON the History tab reset the thread
  invisibly behind the pane you were still looking at — indistinguishable from doing nothing.
  It now also switches back to Chat, so the reset is always seen.

⚠️ Not verified signed in — no live login is possible in this environment. The RLS scoping,
the `updated_at` write and the fallback-to-General path are argued from the migration's own
policy text and the shipped code, not observed against a real conversation.

---

## 2026-09-12 (d) — Chat/New chat "don't work": one was never wired, the other was a race

Owner: *"chat and new chat buttons dont work. what are they supposed to do."*

- **"Chat" is inert by design, not by bug.** It is the only tab in `.pmc-tabs` — a
  conversation-history browser was explicitly deferred when this module was first built (see
  the "not built in this pass" note below) — so it carries no click handler at all. Nothing
  changed here; it is correctly a no-op today.
- ⚠️⚠️ **"New chat" had a real bug: its handler was wired AFTER an `await`.** `#pmc-new` and
  `#pmc-send` are static markup in the topbar/composer — they paint and look clickable the
  instant the page loads, well before `init()` has run. Their `onclick` was previously set
  only once `await loadProjects()` resolved, so any hiccup fetching `projects` (RLS, a network
  blip, a slow connection) threw out of `init()` right there and **every handler below it —
  New chat, Send, Enter-to-send — never got attached, silently.** The buttons looked exactly
  as clickable as a moment before; nothing on screen said why they had stopped responding.
  Fixed by wiring all four handlers **before** the first `await`, and wrapping
  `loadProjects()` in its own try/catch with a toast on failure — a broken project fetch now
  costs only the project picker (grounding falls back to `pid === null`), never the chat
  itself.

⚠️ Not verified signed in — no live login is possible in this environment; the fix is argued
from the control flow (handlers now attach synchronously, before any `await`), not observed
against a real failing fetch.

---

## 2026-09-12 (c) — Pormac gets a face: a Megawide-branded avatar on every assistant bubble

Owner supplied a cartoon construction-worker illustration (white Megawide hardhat, black
polo, safety harness) and asked for it as the chatbot's profile photo, cropped to the upper
body only.

- **New `assets/img/pormac-avatar.png`** — a square bust crop (head, helmet, shoulders, top
  of collar) taken from the supplied full-figure illustration; the waist-down and both hands
  are deliberately cropped out, since a chat avatar is read at ~30px and a bust reads clearly
  at that size where a full standing figure would not.
- **Only `assistant` messages carry it.** `pushMessage()` in `module.js` now branches on
  `role`: an assistant bubble is wrapped in an avatar + `.pmc-msgcol` row
  (`.pmc-msg.assistant` becomes `flex-direction: row`), while `user` and `system` messages
  keep the plain column layout they already had. ⚠️ Putting the avatar on every role would
  have implied Pormac wrote the planner's own messages.
- `updateMessage()` needed no change — it still writes into the same `.pmc-bubble` node
  `pushMessage()` returns; the new wrapper markup sits around it, not inside it.
- `.pmc-avatar` is `30×30`, circular, `object-fit: cover` (so the square source crop reads
  round without a second, separately-cropped asset).

⚠️ Not verified signed in — no live conversation has rendered the avatar against a real
login; the layout is checked by reading the shipped CSS/markup, not by loading the page.

---

## 2026-09-12 (b) — Access control removed: Pormac is open to every approved user

Owner: *"pormac should be available to everyone. no need for the settings to define
accessibility of pormac."* Also: *"in the sidebar, put Pormac before dashboards as the very
first module."*

⚠️ **The "all vs selected users" toggle shipped in the first build (below) is gone, same
day.** `pormac_settings` and `pormac_allowed_users` are dropped; `pormac_can_use()` is kept
under its name (`supabase/functions/pormac-chat` already calls it) but its body is now just
`is_approved()`. The admin ⚙ Settings button, the whole allow-list modal, and the
"not turned on for you yet" blocked screen are deleted from the module — there was nothing
left for that screen to gate.

⚠️⚠️ **The client-side access check in `module.js` is removed outright, not merely
simplified, and that is a real observation, not a shortcut.** `AppAuth.requireLogin` already
redirects anyone whose `status !== 'approved'` to `pending.html` before `Pormac.init()` ever
runs (`assets/js/auth.js`) — so by the time this code executes, `pormac_can_use()` (now
`is_approved()`) is unconditionally true. Keeping the round-trip would have been a check that
can never fail, guarding nothing.

**Sidebar order**: Pormac now renders in `UI.renderNav` (`assets/js/ui.js`) as its own row,
pulled out of the ordinary module list and placed **before** the Dashboard link — in both
the project sidebar and the portfolio sidebar (the ask said "dashboards", plural, and both
modes hardcode their own Dashboard link ahead of the module list the same way). Every other
module still flows through `config.js`'s declared `MODULES` order unchanged; Pormac is the
one deliberate exception.

⚠️ **Not verified signed in.** `pormac_can_use()`'s new trivial body was read against the
SQL, not exercised against a live session; the sidebar reordering was checked by tracing the
render function's logic, not by loading a real page. The migration is safe to re-run even if
the original version (with the settings tables) was already applied — it drops them first.

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
