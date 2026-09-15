# Pormac — module change log

An AI chat assistant, built to run at **zero hosting cost**: inference happens IN THE
BROWSER (WebLLM over WebGPU), with a shared free hosted-model fallback for devices that
can't do that. One entry per prompt, newest first.

---

## 2026-09-14 (c) — The Portfolio checkbox is gone: scope now follows how the module was opened, with nothing to flip

Owner: *"remove the portfolio checkbox. when pormac is in project, discuss only based on project
data. when pormac is in portfolio, answer based on all projects. no need for the portfolio
checkbox."*

⚠️⚠️ **The checkbox was never the only signal — it was a REDUNDANT, reversible one sitting on top
of a signal that already existed and was already correct.** The 2026-09-14 (a) entry below built
`#pmc_scope=portfolio` on Pormac's own Portfolio-sidebar link (`ui.js`'s `pormacRow`) specifically
*because* `pd_project` sessionStorage is shared app-wide and cannot by itself say whether a
planner opened Pormac from a project's own module grid or from the cross-project Portfolio nav.
That hash was always the real answer to "which context is this"; the checkbox only ever set its
*default* state on load, and it happened to also let a planner turn Portfolio scope back off
mid-session — which the owner is now saying should not be possible at all. If Pormac is opened
from the Portfolio side, the answer should be portfolio-wide, full stop; there being a control
that could quietly leave it unchecked (or checked from a stale click) is the very failure mode
"no need for the checkbox" is naming.

- **`#pmc-portfolio` is deleted** from `index.html`, `module.js` and `module.css` — markup,
  `onchange` wiring, and the `.pmc-portfolio-toggle` styling all removed rather than left dead.
- **`loadProjects()` reads the hash once, on load, and calls `setPortfolioAll(true)` directly** —
  no checkbox left to check or read state from. There is no code path left that can set
  `portfolioAll` back to `false` once it is `true`; the only way to get project scope is to open
  Pormac from a project's own module grid in the first place, which is exactly the owner's rule.
- ⚠️ **`setPortfolioAll` now HIDES `#pmc-project` outright (`display:none`) rather than disabling
  it.** Disabling it was the checkbox-era answer — a visible-but-inert control still explained
  itself (*"why can't I pick a project? because Portfolio is ticked"*) to a planner who could
  un-tick it. With no toggle left to act on that explanation, a disabled select is just a dead
  control taking up the topbar; hiding it says the same thing (nothing to pick, because
  everything is in scope) without inviting a click that goes nowhere.
- **The empty-state hint** (`renderMessages`, no-project case) drops its *"tick Portfolio (all
  projects) for a portfolio-wide answer"* clause — nothing on screen can be ticked any more, and
  a planner reaching that empty state has already, by construction, opened Pormac from the
  project side (the portfolio branch of that same conditional is unreachable with the checkbox
  gone: `portfolioAll` is decided before the thread ever renders empty).
- ⚠️ **Everything downstream of `portfolioAll` is untouched, deliberately.** `loadConversation`,
  `clearHistory`, `moduleProviders`/`mirrorProviders`, `gatherContext`, `projectLabel` and
  `persistTurn` all already branched correctly on the flag; none of them cared HOW it got set.
  Removing the checkbox is entirely a UI change to the one place that set it, not a change to
  what the flag means anywhere it is read.
- ⚠️ **The 2026-09-14 (a) entry's own case for a checkbox over a sentinel `<select>` option is now
  moot rather than wrong** — that reasoning (a sentinel value being unreachable once a real
  project is picked, inside `UI.enhanceProjectSelect()`'s popover) explained why a *reversible*
  toggle needed its own control. With scope no longer reversible at all, there is nothing left
  needing either shape of control.

**Verified:** `node --check` on `module.js`; CSS brace balance holds (unchanged shape, minus the
removed rules); 0 NUL bytes; `node tools/wiring-check.js` **126/126, 0 failed**, 0 version splits
across 3,566 cross-module references. `grep` confirms zero remaining references to `#pmc-portfolio`
or `.pmc-portfolio-toggle` in any file.
⚠️ **Not verified signed in** — no live login is possible in this environment, so the hash-driven
scope has not been exercised against a real Portfolio-sidebar click; the hash detection itself
is unchanged from (a), which was already the load-bearing mechanism.

Pormac's own `module.js`/`module.css`/`index.html` → `?v=20260914zx`;
`assets/js/modules-grid.js` → `?v=20260914zx` (2 pages, MODULE_V fallback too; re-derived past
main's own concurrent `20260914zvs4` after rebasing this branch onto it).

## 2026-09-14 (b) — Clear history: a trash button, and it deletes every row this scope's thread merges

Owner: *"provide also option to clear history."*

A **🗑 trash** icon button in the topbar, beside the project select and the Portfolio checkbox,
that clears the CURRENT scope's conversation — this project, General, or Portfolio (General and
Portfolio still share the one NULL-`project_id` bucket, as everywhere else in this module).
Confirm-gated (`confirm()`, this app's standing convention for a destructive action with no
undo — risk-register and issues-lessons both use it the same way), then deletes and resets the
thread to the same empty-state message a brand-new project shows.

⚠️⚠️ **Deleting only `conversationId` would have left the thread coming back.** Since 2026-09-12
`loadConversation()` reads and merges **every** `pormac_conversations` row for this scope — a
leftover from before this module converged on "one conversation per project," kept so that
threads made by the old, removed "New chat" button still surface. Deleting just the row
`loadConversation()` currently treats as canonical and reopening the module would have silently
resurrected whichever older row was next by `updated_at`, which reads as "clear history did
nothing." `clearHistory()` therefore deletes with the **identical scope predicate**
`loadConversation()` reads with (`project_id = pid`, or `is null` for General/Portfolio) — the two
can never disagree about what "this conversation" means, because they are the same clause.

⚠️ **`pormac_messages` needs no delete call of its own.** Its FK is
`references pormac_conversations(id) on delete cascade`
(`migrations/2026-09-12-pormac.sql`), and a foreign-key cascade runs at the constraint level
rather than through the deleting role's own RLS — so removing the conversation rows here is
sufficient, and there is correctly no delete policy on `pormac_messages` for a client to need.

⚠️ **`.eq('created_by', profile.id)` is not redundant with the table's own delete policy**
(`created_by = auth.uid() OR is_admin()`) — without it, an admin's own "clear history" click
would delete every planner's conversation for that scope, not only their own. It is the same
guard `loadConversation()`'s read already carries, for the same reason.

⚠️ **Wired OUTSIDE the `loadProjects()` try block, beside the composer handlers, not beside the
project-select/Portfolio-checkbox handlers it sits next to on screen.** Those two *need* the
project list to have loaded; Clear needs only `pid`/`portfolioAll`/`profile`, none of which
depend on that fetch succeeding — this module's own log has now recorded twice that gating a
handler behind an `await` that can fail is how a control goes silently dead, and a failed
project fetch must not also take away the one way to clear a stuck or unwanted thread.

⚠️ A `.pmc-clearbtn` module-local rule repeats the exact fix `dashboard.css`'s own
`.pd-toolbar-right .pd-icon-btn` states for itself: an icon button with no explicit height
collapses to its bare glyph and rides high in a row of 34px controls. `.pmc-clearbtn` sits
outside that toolbar class, so it needs the same `height:34px` restated locally rather than
inheriting it.

**Verified:** `node --check` on `module.js`; CSS braces balanced (39/39) on `module.css`; 0 NUL
bytes; `node tools/wiring-check.js` — 126/126, 0 version splits; the delete's scope predicate
read side-by-side against `loadConversation()`'s and confirmed to be the identical clause,
statement for statement.
⚠️ **Not verified signed in** — no live login is possible in this environment, so no real
conversation has actually been cleared; the cascade-delete behaviour is argued from the FK
declaration in the migration, not observed.

Pormac's own `module.js`/`module.css`/`index.html` → `?v=20260914w`; `assets/js/modules-grid.js`
→ `?v=20260914w` (2 pages, MODULE_V fallback too — Pormac's `index.html` changed structurally).

---

## 2026-09-14 — Portfolio scope: Pormac can answer across every project, not just one

Owner: *"in portfolio, pormac should be able to answer based on data from all projects on the
list."*

### ⚠️⚠️ "NO PROJECT SELECTED" WAS THE ONLY STATE PORTFOLIO NAVIGATION COULD REACH, AND IT MEANT "NO GROUNDING"
Pormac's link renders first in **both** sidebars (2026-09-12) — but `ui.js`'s portfolio-mode branch
has no `PORTFOLIO_TAB` entry for `pormac`, so clicking it just opens the same module page project
mode does, with whatever `pd_project` sessionStorage happens to hold (a shared, app-wide key — often
still the last project the planner was looking at before switching to the Portfolio nav, sometimes
empty). Every context provider gates on `needsProject && !pid`, so a planner asking a portfolio
question from the Portfolio side of the app got either a stale single project's figures or nothing
grounded at all — never the portfolio.

### A checkbox, not a third `<select>` value
**New `#pmc-portfolio`** beside the project select — checking it sets `portfolioAll = true` and
disables the select (mutual exclusivity enforced by the browser, not by extra code).

⚠️⚠️ **Deliberately NOT a sentinel option inside `#pmc-project`.** That select goes through the
shared, app-wide `UI.enhanceProjectSelect()` — the same convention every other module's project
filter uses — which hides the native `<select>` (`display:none !important`) and replaces it with a
popover whose row list (`renderNavListInto`) is built from **real projects only**, plus a fixed
"Portfolio" row that **navigates away** to `portfolio-overview/index.html`. A sentinel value with no
matching project would render correctly as the button's *starting* label (exactly how "General (no
project selected)" already behaves today) but be **unreachable again once any real project had been
picked** — there is no row in the popover that could select it back. A plain checkbox beside the
select has none of that trap: always visible, always clickable, native keyboard/tap semantics, no
change to the widely-shared `enhanceProjectSelect`/`renderNavListInto` that fourteen other modules
also rely on.

### Arriving from the Portfolio sidebar defaults to Portfolio scope
`ui.js`'s `renderNav('portfolio', …)` now gives Pormac's own row a dedicated `pormacRow()` builder
(rather than the generic `pmodRow()` every other module's row goes through) that appends
`#pmc_scope=portfolio` to its href. `Pormac.init()` reads that hash once, at load, and pre-checks the
box — so the literal ask ("in portfolio…") is the *default* reached with zero clicks, not a control
the planner has to go find, while still leaving it a real toggle they can turn off.

⚠️ The hash is read **only** because nothing else distinguishes "arrived via the Portfolio sidebar"
from "arrived via a project's own module grid" — `pd_project` sessionStorage is shared and mutable,
and the shared sidebar renderer (`UI.renderNav`) always renders a MODULE page under `mode:'project'`
regardless of which nav family linked to it (MODULE_CONTRACT.md's own convention), so the page itself
carries no other signal.

### `PDb.moduleMetrics` accepts an array of project ids
`assets/js/db.js` — `projectId` may now be a single id (unchanged, every existing caller) **or** an
array, read via `.in(col, ids)` instead of `.eq(col, id)`. This is the one place that needed to change
to make portfolio-wide grounding possible at all: Pormac's context providers are built entirely from
`APP_CONFIG.MODULES`' own `dash` specs through `PDb.moduleMetrics`, so aggregating across the
portfolio is one array argument, not a second aggregation engine — the same `wavg`/`sum`/`groupSpan`
arithmetic runs over a wider row set, under the caller's own RLS (which already limits `.in(...)` to
projects the planner can see).

⚠️ A single-element array behaves byte-identically to the old bare-id call (`ids.length === 1 ?
q.eq(...) : q.in(...)`), so `dashboard.html`'s own tile — the only other caller — is untouched.

### Portfolio mode across every provider
- **`moduleProviders()`** (the `dash`-spec-derived providers — schedule, risk, contracts, cash flow,
  etc.): `portfolioAll ? allProjectIds() : pid`, and `summarizeDash` says *"recorded across every
  project you can see"* rather than a bare count that could be mistaken for one project's.
- **Procurement (WPM mirror)**: `needsProject:false` already, so it always ran; the single-project
  match attempt is now skipped outright when Portfolio is checked (asking for a match it was never
  going to want first is a wasted round trip), and the fallback wording distinguishes "portfolio-wide
  because nothing could be confirmed" from "portfolio-wide, as asked."
- **Engineering design progress**: the one provider that needed real thought. ⚠️⚠️ **Listing every
  row** (every tower of every project) would have been the single largest context block Pormac
  produces, on a portfolio with more than a couple of projects, crowding out every other module's
  context out of the same `ctxCap` budget. It groups by `project_id` instead — one line per project,
  that project's own average `percent_complete` — capped at 12 projects with a "+N more" tail, the
  same "top N" discipline `summarizeDash`'s own lists already use.
- **`gatherContext`'s `needsProject` gate**: Portfolio satisfies it too (`!pid && !portfolioAll`,
  not `!pid` alone) — Portfolio *is* a project scope (every project at once), not the absence of one.
- **`projectLabel()`**: checked first, before reading the (now disabled, and left showing whatever it
  last did) select — otherwise the context block's opening line would read a stale single project's
  name while every provider had already switched to answering across all of them. Prints `Scope:
  Portfolio — every project you can see (N projects)` rather than `Project: …`.

### Conversations: Portfolio shares the "no project" bucket, not a project_id of its own
`pormac_conversations.project_id` is a foreign key to `projects(id)` — there is no schema slot for
"this thread was asked across the portfolio," and adding one is a migration nobody asked for here.
Both `loadConversation()`'s read (`pid && !portfolioAll`) and `persistTurn()`'s write
(`portfolioAll ? null : pid`) treat Portfolio identically to General (no project selected): `pid`
could still be holding a stale real id while Portfolio is checked (the select is disabled, not reset —
see below), so every read of it for scoping purposes checks `portfolioAll` first, never `pid`'s own
truthiness alone.

⚠️ **The select is disabled, not reset to blank, when Portfolio is checked.** Turning Portfolio back
off returns the planner to whichever project they had chosen before, with nothing to re-pick. The
visible cost: while Portfolio is checked, the (greyed-out) select still shows that old project's name
rather than "General" — cosmetic only, since every functional read of scope already checks
`portfolioAll` ahead of `pid`.

### Verified
- `node --check` on `module.js`, `db.js`, `ui.js`, `modules-grid.js` — all parse.
- Brace/paren balance holds on every touched file; 0 NUL bytes.
- Traced every remaining `pid` reference in the file after the change (grep, by hand) and confirmed
  each site that scopes a query checks `portfolioAll` before falling back to `pid` — the one bug shape
  this change could plausibly introduce (a stale `pid` leaking through while Portfolio is checked) and
  the one deliberately guarded against everywhere.
- `PDb.moduleMetrics`'s array-vs-single-id branch reasoned through by hand for the one other caller
  (`dashboard.html`'s Project Dashboard tile, always a bare id — unaffected) and for an empty-array
  edge case (zero visible projects: `ids.length` guard returns `{}`, same as "no spec").
- `db.js`/`ui.js`/`modules-grid.js` version-audited: **one `?v=` each across every referencing page**
  (25 / 23 / 2), 0 splits, confirmed both before and after the bump.

⚠️⚠️ **Not verified signed in, and this is the change that most needs it.** No live login is possible
from here, so nothing above has been driven against a real portfolio: the `.in(project_id, ids)`
queries have never executed against a real database, the checkbox has never been clicked in a real
browser, and the `#pmc_scope=portfolio` hash has never been followed from a real Portfolio sidebar
click. The first real test: open Pormac from the Portfolio nav, confirm the checkbox is already
ticked and the select disabled, ask a schedule question, and check the reply's context chips and the
"Scope: Portfolio — every project you can see (N projects)" line both name more than one project's
worth of data.

⚠️ **Deliberately not built:** a per-project breakdown for every `dash`-spec provider (only the
engineering mirror groups by project; the rest report one portfolio-wide aggregate, matching how
`moduleMetrics` has always answered — one number, not a table); and resetting the project `<select>`'s
displayed value when Portfolio is checked (kept as-is so unchecking it needs no re-pick — see above).

`assets/js/db.js` → `?v=20260914d` (25 pages); `assets/js/ui.js` → `?v=20260914d` (23 pages);
`assets/js/modules-grid.js` → `?v=20260914d` (2 pages, MODULE_V fallback too); Pormac's own
`module.js`/`module.css`/`index.html` → `?v=20260914d`.

---

## 2026-09-13 (d) — The daily cloud-message cap is role-based, not flat

Owner: *"instead of 200 messages per user, limit this to 100 for admin and super-admin, while 50 for
others."* Follow-up to the flat 200/day cap from earlier this week (2026-09-12 — *"the better the
laptop, the worse the model"*), which was one number for every role sharing the one Groq account.

`DAILY_REMOTE_CAP` splits into **`DAILY_REMOTE_CAP_ADMIN`** (100, env `PORMAC_DAILY_CAP_ADMIN`) and
**`DAILY_REMOTE_CAP_USER`** (50, keeping the existing `PORMAC_DAILY_CAP` env name so nobody's already-set
override silently stops applying).

- ⚠️ **The role check goes through `is_admin()`, never a client-guessed or re-implemented rule.**
  `is_admin()` is the same `security definer` SQL helper every RLS policy in this repo already trusts
  for the admin/super_admin boundary (`u.role in ('admin','super_admin')`), called via
  `asUser.rpc('is_admin')` — **as the caller**, exactly how `pormac_can_use()` is already called two
  lines above it. Re-deriving the admin test inside the Edge Function would be a second copy of the
  rule that could disagree with the database about who is an admin.
- ⚠️ **Batched into the SAME `Promise.all` as the access check and the usage read** — `pormac_can_use`,
  `is_admin` and the `pormac_usage` row are all independent of each other, so this is still one round
  trip in front of the planner's first message, not three sequenced ones.
- ⚠️⚠️ **A failed role check fails CLOSED to the smaller cap, not the larger one.** This is a rate limit,
  not an authorization gate — the safe default when the role can't be determined is "assume the tighter
  allowance," never "assume admin and hand out the bigger one." `isAdmin = !adminErr && isAdminRaw ===
  true`, so an RPC error or a non-`true` value both land on `DAILY_REMOTE_CAP_USER`.
- Every place that read the flat cap — the quota-exceeded message, the `probe` response, and the
  success response's `remaining_today` — now reads the resolved `dailyCap` instead, so a viewer of the
  tier bar sees the number that actually applied to them, not a stale flat figure.

⚠️ **Still one shared Groq account underneath both tiers** — the split changes who gets how much of the
one pool, not the size of the pool itself. The math from the earlier per-role-cap discussion still
holds directionally: enough admins and users maxing out their own cap on the same day can still exceed
Groq's own account-level daily ceiling on `llama-3.3-70b-versatile`, at which point the model chain does
**not** paper over it (a 429/5xx from Groq does not advance to the next model, deliberately — see the
`MODEL_DEAD` comment). Nothing in this change addresses that; it only makes the per-user share smaller
and role-aware, which is what was asked.

**Verified:** brace/paren/bracket balance holds (128/128, 55/55, 9/9), 0 NUL bytes; grepped the client
module (`modules/pormac/module.js`) to confirm nothing there hardcodes the old flat 200 — it only ever
reads `remaining_today` off the response, so no client change was needed.
⚠️ **Not verified against a real deploy or a real request.** No `deno` binary is reachable from this
environment to type-check the file, and there is no live Supabase session to confirm `is_admin()` is
actually callable via PostgREST RPC for an `authenticated` caller — the repo's schema shows no `revoke`
on it (Postgres grants `EXECUTE` to `PUBLIC` by default, and `pormac_can_use()` is called the identical
way from the same file), so this is inferred from the schema rather than observed. The real test: once
deployed, an admin account and a non-admin account should report 100 and 50 respectively in the tier
bar's "N cloud messages left today," and the quota-exceeded message should name the right number for
each.

No migration — this is a code-only change to `pormac-chat`. Re-deploy the function
(`supabase functions deploy pormac-chat --project-ref bgupuqnkqhixpuctyder`, or the new Deploy Edge
Functions GitHub Action once merged) for it to take effect; the existing `pormac_usage` rows are
untouched, since the cap is compared against `remote_calls`, not stored per row.

---

## 2026-09-13 (c) — The deploy workflow this module's own log has flagged all week, actually built

Follow-up to the (b) entry's own closing line: *"the workflow has to reach `main` before it can run —
`workflow_dispatch` doesn't appear in the Actions tab while the file is only on a branch."* That file
never reached `main` — a prior session's `840577e` is unreachable from this checkout's history, and
`.github/workflows/` did not exist at all here. Rebuilt from scratch on a branch created for exactly
this (`claude/edge-functions-deploy-workflow-d89r3h`).

`.github/workflows/deploy-edge-functions.yml` — two ways in: **Actions → Deploy Edge Functions → Run
workflow** (a function name or `all`), or a merge to `main` touching `supabase/functions/**`, which
deploys only the functions that changed in that push.

- ⚠️⚠️ **The known-function list is read off the checkout's own `supabase/functions/` directory,
  never hardcoded.** A prior write-up of this same workflow named the eight functions in prose; a
  ninth function added later would have had no way to ask for `all` and include it. `find … -maxdepth
  1 -type d` is the single source, so the list can't drift from the repo.
- ⚠️⚠️ **Every `${{ }}` expression reaches the shell through `env:`, never interpolated into `run:`
  text.** GitHub substitutes an expression *before* bash sees the line, so a function name containing
  a quote would close the string and run whatever follows it — the standard Actions script-injection
  hole. Verified by feeding the step `x'; echo PWNED; '` as the function name: refused as an unknown
  name, and `PWNED` is never printed, over three separate runs of the extracted step script.
- ⚠️⚠️ **`--no-verify-jwt` is scoped to exactly one function, `reconstruction-webhook`, not a global
  flag.** Every other function in this repo deploys with the platform's default JWT check ON — several
  of them (`pormac-chat` included) trust the caller's `sub` claim *because* that check already ran.
  `reconstruction-webhook`'s own header explains why it's the one exception: it's called by RunPod,
  which has no Supabase session. Getting this backwards either rejects RunPod's callback or silently
  turns off a check a function is relying on.
- Seven cases run against the extracted step logic before shipping: one function, `all` (8), a typo
  (exit 1, naming what exists), a push diffed over two real commits from this repo's own history
  (`7a0a476..4426a9f`, correctly resolving to the one function that PR actually touched), a push
  touching none, an unreachable base commit, and the injection string above. The deploy loop itself
  ran against a stub `supabase` CLI: a missing token aborts after the first function (`set -e`),
  never half-deploying the rest.

⚠️ **Two owner actions still gate the hosted path, and neither can be done from here:** a
`SUPABASE_ACCESS_TOKEN` repo secret (Settings → Secrets and variables → Actions; generate at
supabase.com/dashboard/account/tokens) and `GROQ_API_KEY` in Supabase's own Edge Function secrets
(free at console.groq.com). The workflow deliberately does not touch the Groq key — it ships code, and
a provider key living in two places is a key that goes stale in one of them.

⚠️ **Not verified against a real Actions run** — no GitHub Actions runner is reachable from this
environment, so what's proven is the extracted step logic against real inputs (above) and that the
YAML parses; the workflow has not fired for real, and the two secrets above have not been set.

---

## 2026-09-13 (b) — "Simplify what you edited": one tier table, and two bugs that fell out of it

Owner, on the two changes above: *"can you simplify what you edited."* A quality pass over the same
diff — reuse, simplification, efficiency, altitude — not a bug hunt. **Two real defects came out of
it anyway, and both were invisible in the code as written.**

### ⚠️⚠️ THE TIER FACTS LIVED IN SIX PARALLEL TERNARY CHAINS, AND THAT SHAPE HID THE BUGS
`local-max` / `local-full` / `local-lite` / `remote` had their label, model patterns, VRAM ceiling,
context cap, history depth and downgrade position each written as its own independent
`tier === '…' ? … : tier === '…' ? …` chain, scattered across ~400 lines. Adding a rung meant editing
six places; every chain had its own silent `else`; and no single chain was wrong enough to notice.
They are now **one `TIERS` table, one row per rung**, read through one `rung(id)` lookup.

**Two defects were a direct consequence of that shape, not of any one line:**

- ⚠️⚠️ **`downgrade()` UPGRADED on an unrecognised tier.** It did `order.indexOf(tier)`, and
  `indexOf` answers **-1** for anything not in the list, so `Math.min(-1 + 1, 3)` is **0** — the
  heaviest 8B rung. A local failure could therefore promote a planner to the *largest* local model,
  which is the opposite of "slow down instead of crash" and would fail again immediately. Now
  `(i < 0 ? 0 : i) + 1`, clamped at `'remote'` — ⚠️ never past it into `'none'`, because a GPU
  running out of memory says nothing about whether the hosted path works.
- ⚠️⚠️ **A stale `pormac_tier_override` flowed in unvalidated.** `detectCapability()` returned
  `localStorage.getItem(...)` verbatim, so a key left by an older build (or hand-edited) became the
  tier and landed in every chain's else-branch while the bar read *"Choosing a model…"* forever. It
  is validated against `TIER_IDS` now, and `rung()` fails **closed** — an unknown id falls back to
  the **smallest** local rung, never the largest, because the safe guess when you do not know what a
  device can take is the one that asks least of it.

### ⚠️ `none` becomes a REAL tier, which closes a path that was already reachable
`tierBroken` was a boolean beside the tier, and **only the tier BAR honoured it**. `onSend` did not:
with no WebGPU and the hosted path unreachable, the bar correctly read *"No model available — the
cloud assistant has not been deployed yet"* and a send still went down a path already known to be
dead, replacing that diagnosis with a generic *"something went wrong"*. It is now a row in the table
with an `onSend` guard, so the planner keeps the one line that says what to fix.

### The rest, each a duplication or a waste rather than a defect
- **One Edge Function caller.** `probeRemote` and `sendRemote` carried the same six lines character
  for character — the session-token walk, the URL literal, both headers, the empty-object JSON guard
  — so the function's route name and that guard each had two owners. `callPormacChat(payload,
  timeoutMs)` is the one caller; each keeps only its own error mapping. ⚠️ The timeout is **not**
  applied to a real message: a 70B reply can legitimately take a while, and aborting one would be
  worse than waiting.
- ⚠️ **The probe is bounded at 3s, and `onSend` blocks on it.** Unbounded, a captive portal or a
  function that hangs rather than 404s stalls the first Enter press for the browser's whole network
  timeout — in a module whose whole point is that a local model can answer with no network at all.
- ⚠️⚠️ **`renderTierBar` stopped destroying the Quality control on every repaint, and that is a fix
  rather than an optimisation.** It rewrote the bar's whole `innerHTML` including the `<select>`, and
  WebLLM's `initProgressCallback` fires once per downloaded shard — so during a first-time load (a
  ~5GB download on the large rung) the control was rebuilt every few hundred milliseconds, dropping
  focus and closing its dropdown mid-click, at exactly the moment a planner would want to escape a
  slow local model. Status text and the busy dot are mutated in place; controls are re-emitted only
  when the preference or the downgrade flag genuinely differs.
- **`resolveTier` is an ordered walk, not nested ifs.** The preference chooses an ORDER (`['local',
  'remote']` or the reverse), so the probe call and the reason-building exist once instead of twice,
  and *"nothing worked"* falls out of exhausting the list rather than needing a separate flag. The
  reasons now compose: *"this device cannot run a local model — 197 cloud messages left today."*
- **Edge Function.** ⚠️⚠️ `MODEL_DEAD` matched the bare word **"model"** in the response prose, which
  appears in errors that have nothing to do with a dead id (`max_tokens exceeds the model's limit`, a
  malformed `messages` array). Those would have burned the whole three-model chain re-asking the same
  bad question and then reported the LAST model's error — turning a client-side bug into what looks
  like a provider outage. Groq is OpenAI-compatible and returns `{error:{code}}`, so the **code** is
  authoritative; the regex survives only as a fallback for a provider that sends none. The access
  check and the usage read are now `Promise.all` (independent — the usage row is keyed on the uid, not
  on anything the RPC returns), which takes two Postgres round trips out of the front of every probe;
  ⚠️ the uid is parsed **before** either query starts, so the 401 path cannot abandon an in-flight
  promise. The probe response drops `configured` / `model` / `used_today` / `cap` — no client read any
  of them, and `model` was a guess anyway (it named the head of the chain, not whichever model would
  actually answer).
- **CSS.** ⚠️⚠️ `.pmc-quality + button.pd-btn-sm { margin-left: 0 }` was **inert**: it ties on
  specificity with `.pmc-tierbar button.pd-btn-sm { margin-left: auto }`, which is declared later and
  wins. Two auto margins then split the free space — the "select floating in the middle" the comment
  above it claimed to have fixed. It only ever looked right because the reset button is absent unless
  the planner has been downgraded, and my own browser check never covered that state. The old rule is
  **deleted** rather than cancelled: the select renders unconditionally, so it is the only anchor
  needed.

### Verified
**41 context assertions, 0 failing** — including **21 new equivalence assertions** proving the
simplify pass left behaviour byte-identical to the pre-simplify commit (`promptMessages` history depth
and `gatherContext` module cap, per tier, against the old ternaries executed from that commit), plus
the **5 original contrast assertions** against the pre-feature commit, which still bite. ⚠️ Both bases
are pinned to **SHAs**, never `HEAD` — `HEAD` stopped meaning "before this work" the moment the
feature commit landed, and two assertions had quietly become self-comparison before that was caught.

**11 new browser assertions** on the three new behaviours: the `<select>` node **survives 50 repaints**
(witness attribute intact, exactly one select, controls signature recorded), the probe fetch carries an
`AbortSignal`, the composer is typable while the probe hangs, and `tier === 'none'` refuses the send
with the diagnosis while sending **0** messages. **All 9 tier-resolution paths** re-run green with
composing reasons and 0 page errors.

**The tier bar was measured before and after against the pre-simplify build** and is
**byte-identical** — same height (51px), same row count, same pill and Quality rects to the pixel, same
text. An always-present but empty `.pmc-tierwhy` collapses to width 0 and the Quality control stays
flush right, so the extra flex gap costs nothing.

`node --check` clean; the Edge Function parses (esbuild); `module.css` braces 29/29; 0 NUL bytes;
`tools/wiring-check.js` **126/126, 0 version splits**; `tools/dead-hooks.js` unchanged at its
documented 9-finding baseline.

⚠️ **Not verified signed in, and the owner action from the entry above still gates everything.** Until
`supabase functions deploy pormac-chat` has run and `GROQ_API_KEY` is set, the hosted path does not
exist and every planner falls back to the on-device model.

⚠️ **Skipped deliberately, with reasons:** querying Groq's `/models` catalogue to validate the chain
(adds a network call plus a cache to the Edge Function, and egress to Groq is blocked from here so it
could not be verified); re-reading `pormac_tier_override` as a *ceiling* rather than an override (a
behaviour change, and it adds more than it removes); caching the probe result in `sessionStorage` (a
cache-invalidation hazard exactly when the owner deploys the function); migrating to
`sb().functions.invoke()` (the probe needs the HTTP **status** and `body.code`, which `invoke()` does
not surface cleanly — the reuse review said so itself); and removing the `PORMAC_MAX_PROMPT_CHARS`
guard, which is a safety limit whose removal could not be verified here.

---

## 2026-09-13 — "The model is not so smart": the better the laptop, the worse the model

Owner: *"pormac is working already, but the model is not so smart."*

### ⚠️⚠️ THE ROUTING WAS BACKWARDS, AND THAT IS THE WHOLE FINDING
`detectCapability()` answers *"what can this device run?"* — and the first build used that answer as
the **entire** decision. WebGPU present → run locally. So a planner on a capable workstation was
routed to the largest model a browser tab can practically hold (**Llama-3.2-3B**), while the hosted
path they could have reached carries **llama-3.3-70b-versatile** — roughly 20× the parameters. The
hosted model was reserved, by design, for the devices that *could not* run anything locally. **The
better your machine, the worse the model answering you.** That is the reported symptom exactly, and
it is an architecture decision rather than a tuning problem.

Capability now decides only which **local rung** is used. The hosted model is **preferred whenever it
is actually reachable**.

⚠️ **It stays a visible choice rather than a silent reversal.** The original ask was explicitly
in-browser inference (*"totally free… in-browser inference"*). Both halves survive — Groq's free tier
costs nothing either, so "free" is untouched — but *"runs on your device"* is something somebody
chose on purpose, so it is a **Quality** control in the tier bar (`Best quality` / `On this device`),
remembered per device, not deleted. Switching it drops the loaded engine; otherwise the control would
look broken while the small model already in memory went on answering.

### ⚠️ The three ways the hosted path can be unusable are three different problems
A planner told only *"unavailable"* can act on none of them, so `probeRemote()` distinguishes them and
the tier bar names the remedy: **404** the function was never deployed · **503 `no_key`** deployed but
no provider key · **429 `quota`** today's allowance is spent. The probe runs once on load, costs **no
model call and no daily allowance** (the Edge Function answers `{probe:true}` before it reaches the
provider), so the bar is honest before the planner types anything — the alternative is a failed first
message with a 2GB model download starting underneath it.

⚠️ **`On this device` cannot conjure WebGPU.** A device that genuinely cannot run a local model still
goes remote — and that path is **probed too**, or the bar would read *"Best quality — large hosted
model"* on the one device with nothing to fall back to. When neither path works it reads **"No model
available"** and says why.

### The local ceiling was 3B for every capable machine
New **`local-max`** rung — Llama-3.1-8B / Qwen2.5-7B / Mistral-7B, 6500MB VRAM — above the existing
3B and 1B rungs. ⚠️ Offered only at `deviceMemory ≥ 16GB` on a desktop, never on a guess: it is a
~5GB one-time download. The downgrade ladder gains it at the top, so a failed 8B run steps to 3B
rather than straight to the cloud.

### The prompt and the grounding, which is the other half of "not smart"
- ⚠️ **The system prompt was three sentences of prohibitions** (*"don't guess, be concise"*). Told only
  what not to do, a small model hedges — which is most of what made replies read as evasive. It now
  says what a good answer looks like, and in particular **to quote the actual figures**: a planner
  asking *"how far behind are we"* wants the days and the dates, not a description of where to find
  them.
- ⚠️ **Conversation depth is a property of the MODEL, not the module.** `chatHistory.slice(-8)` was
  right for a 1B window and was throwing away the context that makes a follow-up answerable against a
  model that accepts 131k. Now 30 turns on remote, 12 on `local-max`, 8 below.
- ⚠️ **The context cap was 4 modules**, chosen for a 1B model, so a question spanning modules (*"are
  the delays on the critical path tied to any open claim?"*) was answered from a quarter of the
  project. Now 8 on remote, 5 on `local-max`, 4 below.
- ⚠️ **The context never named the project.** The model was reading a pile of figures with nothing
  saying what they described, and answered generically about "the project" because that was genuinely
  all it had been told. A `Project: …` header now leads, read off the live `<select>` so it cannot
  disagree with what is on screen.
- ⚠️ **Providers are fetched in PARALLEL.** Each is its own round trip, so eight in sequence put eight
  latencies between the question and the first token. **Measured: 6 providers × 60ms — 60ms parallel
  against 241ms sequential**, with the same per-provider error isolation the loop had.

### The Edge Function, reshaped for being the primary path
- ⚠️⚠️ **`GROQ_MODEL` was a single hard-coded id, and a retired id is a total outage.** Groq
  decommissions hosted models on its own schedule and then answers every request with a 400 naming the
  dead id. There is now a **model chain** (configured id first, then `llama-3.3-70b-versatile` →
  `openai/gpt-oss-120b` → `llama-3.1-8b-instant`). ⚠️ Only a **model-level** rejection advances — a 429
  or a 5xx is the provider saying stop, and retrying those spends the same quota to be refused again.
  ⚠️ The response reports the model that **actually answered**, never the one asked for; after a chain
  fallback those differ, and a tier bar naming a model no longer serving the planner is a lie the UI
  cannot detect on its own.
- **The daily cap was 30** — fine while this was a last resort for a handful of old phones, half a
  morning as the primary path. Now **200**, env-tunable (`PORMAC_DAILY_CAP`).
- **The prompt guard was 24,000 characters** (~6k tokens) against a model that accepts 131k — so it was
  discarding most of the grounding that makes an answer good, to protect a quota measured in
  **requests**. Now 120,000, env-tunable. `max_tokens` 1024 → 2048.
- ⚠️ **The 429 told every caller their device was too old** and pointed at a remedy that is not the
  remedy. It now names the Quality control.

### Verified
- **20 assertions, 0 failing**, executing `promptMessages` / `gatherContext` / `projectLabel` **sliced
  out of the shipped file by name** — history budget per tier, provider cap per tier, the project
  header, the no-project case, parallel timing, and a failing provider not taking the others with it.
  ⚠️ **Five are CONTRAST assertions against HEAD and all bite**: HEAD keeps 8 turns on remote, caps at
  4 providers, names no project, runs sequentially (241ms), and has a shorter prompt.
- **Nine tier-resolution paths driven in a real browser** (the shipped page, auth/DB/fetch stubbed,
  harness deleted): deployed+keyed → remote; 404 / no-key / quota → the right local rung **each naming
  its own cause**; `pref=device` → local with no probe at all; `pref=device` with no WebGPU → probes and
  goes remote; 8GB desktop → the 3B rung; no WebGPU **and** not deployed → **"No model available"**;
  and the Quality control switching best→device→best, persisting to localStorage. **0 page errors.**
- ⚠️ **Two of my own bugs, both found by the harness rather than by reading.** The harness stub
  clobbered the test's injected probe response, so the first run reported all four failure paths as
  successes — the same "stub overwrites the fixture" trap as the previous session's message-list test.
  And the `pref=device` + no-WebGPU path really did claim a working hosted model without probing it;
  that is now fixed, not just tested.
- `node --check` clean; the Edge Function parses as TypeScript; `module.css` braces 35/35; 0 NUL
  bytes; `tools/wiring-check.js` **126/126, 0 version splits**; `tools/dead-hooks.js` unchanged at its
  documented 9-finding baseline.

### ⚠️⚠️ NOT VERIFIED AGAINST A REAL MODEL, AND ONE OWNER ACTION GATES ALL OF IT
No message has been sent to Groq or to WebLLM from here: egress to both `console.groq.com` and this
project's own Supabase is blocked by this environment's proxy, so the probe, the model chain and the
70B answer itself are proved by executing the shipped code against stubs, never observed.

**Until `supabase functions deploy pormac-chat` has run AND `GROQ_API_KEY` is set, the hosted path
does not exist and every planner silently falls back to the on-device model** — which is the state
that produced the complaint. The module now says so on screen instead of hiding it, but saying so is
not the fix. That deploy is the single highest-impact action and only the owner can take it; the free
key is at console.groq.com, no card required. The exact commands are in
`supabase/functions/pormac-chat/index.ts`'s own header.

⚠️ **The model chain's second and third ids are not confirmed against a live Groq account.**
`llama-3.3-70b-versatile` is confirmed current; `openai/gpt-oss-120b` and `llama-3.1-8b-instant` are
reported available but were not verified (the docs host is blocked here). They are fallbacks behind a
confirmed id, and `GROQ_MODEL` overrides the lot — but if the owner wants a specific newer model as
the primary, set that env var rather than trusting this list.

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
