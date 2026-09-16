# Module: portfolio-overview

## 2026-09-16 — The page IS the Overview: the last two duplicate views and the dropdown are gone — fmlozano

See the root `CLAUDE.md` (2026-09-16 (v)) for the full entry.

- **Stakeholder Map** and **Milestones** joined `PO_MOVED_VIEWS` — they redirect to
  `stakeholder-map` and `project-schedule`, both already in the sidebar. ⚠️ The read-only argument
  this file recorded against moving the Stakeholder Map was about MOUNTING it under
  `#pd_scope=portfolio`, not about redirecting to the module, which opens in its own scope.
- **`.po-tabs` is gone again**, one day after being reinstated. That reinstatement was reasonable
  for three views and is not for one.
- **1,016 lines of renderer deleted** (`ms*`, `dir*`, `sh*` and the person panel). The page is
  1,303 lines, from 2,407.
- `viewLoaders()` → `{ overview }`; `FILTER_PANEL` → `{ overview }`; `switchView` keeps only its
  role as the **deep-link resolver** `#po_view=` arrives through.
- `test-portfolio.js` updated to match and grew to **128 assertions** — including that each removed
  renderer no longer occurs in the file at all. ⚠️ Do not name those functions in a comment here:
  the check counts occurrences in the source, so a comment naming them keeps it red.

## 2026-09-16 (f) — The last four views leave, and what is left is not a module list

Owner, after the first wave: *"at a portfolio view, the dashboards of each corresponding module
must be revised. However your stored revisions are in the dashboard module, and then there is just
a dropdown to see the modules. Wrong. Those dashboards must be the landing page of each module
when under the portfolio view."*

⚠️⚠️ **2026-09-15 (x) MOVED SIX AND STOPPED**, which left the dropdown still listing S-Curve, Cash
Flow, Resources and Equipment — so from the owner's seat nothing had changed. The four heaviest
renderers on this page are now `assets/js/portfolio-dash.js` too, mounted by `s-curve`,
`cash-flow`, `resource-loading` and `equipment-loading`.

⚠️ **MOVED, NOT COPIED, AND THE TEST NOW PROVES THE STRONGER CLAIM.** `loadScurve`, `scRenderChart`,
`scComputeFromAgg`, `fetchScheduleForIds`, `loadCashflow`, `cfRenderChart`, `loadResources`,
`loadEquipment`, `eqBuild`, `eqRenderGrid` and `eqExport` occur **zero** times in this file — not
"are unreferenced", *absent*. A loader dropped from `viewLoaders()` and left in the source is a
second renderer waiting for the next reader to mistake it for the live one.

### ⚠️ THREE VIEWS REMAIN, AND NONE OF THEM IS A MODULE
- **Overview** — this page's own subject.
- **Milestones** — no module exists to move it to. (Its sidebar row went on 2026-09-16: *"milestones
  are already seen within the schedule."* The tab is its only entry point now.)
- **Stakeholder Map** — ⚠️⚠️ and this one is a decision, not an oversight. Its portfolio view is an
  **authoring** directory (*+ Add person*, assign, favourite) and writes are refused at the shared
  Supabase chokepoint while the portfolio flag is set (`auth.js`). **This page is not in portfolio
  scope**, so those writes land here; moving the view into `stakeholder-map` under
  `#pd_scope=portfolio` would leave every one of those buttons raising a read-only toast. The scope
  question has to be answered before the view can follow the others.

### ⚠️ What went with them, and what deliberately did not
- `scopedProjectIds` and `scopeLabel` **stayed** — the Overview, the Milestone calendar and the
  Stakeholder Map all ask which projects are in scope. The shared layer answers the same question
  its own way (every project the planner can see; there is no in-page filter on a module page).
- `kpi2` / `clip` / `statePill` **stayed** — still used by the three remaining views.
- ⚠️ `scErrText` **left, and became `PDb.errText`**. The Overview still needs it for its own
  `schedule_scurve_status` read, so the choice was one shared copy or two drifting ones. The
  `[hidden]`-specificity and error-text assertions moved to the suites that own them now.
- ⚠️ `assets/js/scurve.js` **is no longer loaded by this page.** `scCompute` was the only consumer
  and it went with the S-Curve. A script tag for an engine nothing calls is a page paying for a
  dependency it does not have.
- The **Equipment filter panel** left `FILTER_PANEL` with the Equipment view; two views declare a
  panel now, and the funnel hides on the third.

### ⚠️ A deep link must not die with the tab — still true, now ten deep
`PO_MOVED_VIEWS` carries all ten. `#po_view=scurve` and its nine siblings resolve to the module
that owns them, **after** the super-admin gate (a planner who cannot see Equipment still lands on
the Overview, exactly as before) and with `location.replace` so a tab that no longer exists is not
a step in the Back history. ⚠️ The suite now also asserts every module named in that table
**exists on disk** — a typo there is a redirect to a 404 whose only symptom is a click.

### Verified
- `test-portfolio.js` **99/99**, rewritten to the new contract: `viewLoaders` names **three**,
  the ten that moved are asserted **absent from the file**, `PO_MOVED_VIEWS` resolves all ten to
  modules that exist, and the three that stayed are asserted **not** to be in it — a page that
  redirects to itself is an infinite reload.
- **158 assertions** in the new `tools/test-portfolio-dash.js`, which mounts every moved view
  against a fake DOM with the real `ui.js` / `db.js` / `scurve.js`, and gates against
  `origin/main`.
- `wiring-check` **139/139**, `dead-hooks` unchanged, the inline script parses.

⚠️ **Not verified signed in.**

`MODULE_V` → `20260916h`.

## 2026-09-16 (e) — The Overview becomes a decision surface, on a page that moved under it

Phase D of the portfolio plan. Owner's framing: the front page should support *"informed
decisions ... considering information obtained across multiple projects"*. What was there
reported **levels**: eight KPI cards (four of them money the portfolio has not captured), a
Schedule Health donut and budget-by-group bars. A level is not a decision.

### ⚠️⚠️ THE LIVE PAGE WAS THE ARGUMENT

On the real portfolio **four of the eight KPI cards read `—`** and the largest chart printed
*"No budget figures captured yet."* So half the strip and the biggest block were devoted to
money nobody has entered, while schedule — which the portfolio **does** have — got one card.

**Removed:** the donut (`renderDonut`), the budget bars (`renderBars`), the four money cards,
and with them `card()`, `portfolioProgress`, `progressBasisNote` and `groupLabel()` — deleted
rather than left dead, because a renderer nothing calls reads as working code to every tool.
⚠️ `HEALTH` **stays**: the table's per-row health dot reads it.

**Four figures, each triggering a different action:** Behind plan (duration-weighted
percentage points), Budget variance, Unrecovered exposure, Milestones due in 30 days.
⚠️ Anything that cannot be computed **says so** — a computed 0 and an absent figure are
different statements, and printing them alike is what made the old strip read as broken.

**Projects ranked by attention**, on all four inputs the owner chose: schedule slip and
overdue, behind plan in pp, budget variance, commercial and issues. Ties break on the **worst
slip in days**, never the name.
⚠️ **Healthy projects are still LISTED, at the bottom, showing dashes** — a management view
that hides them cannot be used to say *"these four are fine"*, which is half its job. The
same rule the Contracts portfolio view already follows.

**A coverage note** generalises what `progressBasisNote` did for one KPI: it counts the
projects with no schedule roll-up rather than dropping them, because a figure computed over
11 of 21 projects is a different statement from one computed over 21.

⚠️ **`loadOverview` issues four INDEPENDENT reads**, each repainting as it lands, so a slow or
failing read degrades one block instead of holding the page. The Overview gains an entry in
`viewLoaders()` — it had none before, because it had nothing to read — so the project filter
re-runs it exactly as it re-runs any other view's.

### ⚠️⚠️ AND THE PAGE MOVED UNDER IT MID-FLIGHT

This was written against a 13-view page and landed on a 7-view one: `1583eaf` moved six
portfolio dashboards into the modules they describe, and **moved this page's whole `<style>`
block into `assets/css/portfolio-dash.css`** — a module cannot reach a `<style>` inside
another page. Two of the three Phase D patch scripts therefore **aborted on their CSS
anchors** rather than writing, which is what the anchor counts are for.

Integrated by rebase, three conflict hunks, each resolved on its merits rather than by side:
- the `<style>` hunk → **theirs**, and Phase D's CSS delta re-applied to the new stylesheet
  (measured **+87 chars**, byte-identical to the delta it had in the old inline block);
- `viewLoaders` → the **union**: Overview's new loader joins the six views this page still
  hosts, and ⚠️ the six that MOVED do **not** come back — their loaders are not here any more;
- the suite → **theirs whole** (their six-moved and deep-link-redirect assertions are still
  true), with only the count moving 6 → 7 because Overview gained a loader.

⚠️⚠️ **`portfolio-dash.css` IS NOW SHARED by seven pages**, so deleting `.po-charts`,
`.po-donut-wrap`, `.po-legend` and `.po-bars svg` from it had to be checked rather than
assumed: **zero emissions repo-wide**, and `assets/js/portfolio-dash.js` — the six moved
dashboards — emits none of them either. `.po-legend2` and `.po-legend-proj` are the S-curve's
and survive.
⚠️ My first check of that was **wrong and would have cleared a live rule**: `grep -o` truncates
the match before `grep -v` can filter it, so it reported six bare `.po-legend` uses. Re-run on
word boundaries, the two remaining hits are `po-legend-proj` matching because `-` is a word
boundary — there are **no** genuine bare uses.

### Verified

**107 assertions, 0 failing**, every derivation sliced out of the shipped page and executed —
16 of them new for Phase D. ⚠️⚠️ **The ranking fixture is built so the alphabetical and
attention orders DISAGREE**, or the ordering could be right by accident: it ranks **Bravo ·
Alpha · Charlie** where the alphabet says the reverse. Also pinned: a zero-duration project
yields **null, not NaN and not a misleading "on plan"**; ahead of plan is positive; before the
read lands it is null rather than 0; and `claimsOf` keeps **exposure (money) and eotDays
(days) in separate fields** — money and days never meet.

**Rendered in a browser** against the shipped stylesheets, measured inside an iframe at 1400
and 390px in both themes, from markup the shipped renderers produced: **0 errors**, 4 KPI
cards, the ranked table in the order **Bravo · Alpha · Charlie**, the healthy project last
carrying **2 dashes**, **0** donut/bars/legend elements left, and **no sideways page scroll**
at either width. ⚠️ The inks resolve per theme — bad ink `rgb(196,33,39)` light against
`rgb(255,138,128)` dark, card ground `rgb(255,255,255)` against `rgb(43,44,43)` — which is
what proves the **relocated** stylesheet is genuinely in the cascade rather than the harness
reporting perfect geometry on unstyled elements.

⚠️ **Three of my own harness faults, recorded rather than smoothed over:** it stubbed `Fmt`
without `esc` (the real one is in `db.js`, now loaded); it lifted functions but not the
module-level `HEALTH`; and its dependency scan matched only call-shaped names, so `rankSort`
— passed **by reference** to `.sort()` — was invisible. Each surfaced as an error that reads
exactly like a defect in the shipped code. The generator now resolves transitively.

`wiring-check` 139/139 (every asset on one version), `dead-hooks` 0 findings in this module,
inline script parses, CSS braces 272/272, 0 NUL, pure LF. Harness deleted before committing.

⚠️ **Not verified signed in** — no live portfolio has been read, so the four enrichment reads
have never run against real data.
⚠️ **The owner must run `migrations/2026-09-15-scurve-status-per-project.sql`.** Until then the
Behind-plan card reads *unavailable* and names the file; nothing else changes.
⚠️ **Still to come:** the two trend charts and the 30/60/90 look-ahead (D4/D5), the Portfolio
Schedule cross-project Gantt (Phase E), and the `isBehind` decision (Phase F).

`portfolio-dash.css` → `?v=20260916e` across all **7** referencing pages; `MODULE_V` →
`20260916e`, sort-checked against the `20260915z` the live site is serving.


## 2026-09-15 (x) — Six of the thirteen views leave this page: a dashboard belongs to its module

Owner, with the view dropdown open: *"for the dashboard, you can see there is a dashboard module,
and there is a dropdown that links to each module. that is wrong. The idea of each dashboard (e.g.
s-curve, risk register etc.), the design of those dashboards must be pushed to each module
established on the left."*

### ⚠️⚠️ THE DROPDOWN WAS A SECOND SIDEBAR, AND A SECOND HOME FOR TWELVE MODULES
Since 2026-09-14 the sidebar opens every module's **own page** in portfolio scope
(`#pd_scope=portfolio`, read by `AppAuth.isPortfolioScope`). So "Risk Register" existed twice: once
as the module, and once as a view of a page called Portfolio Dashboard — two different screens over
the same rows, each with its own renderer to keep in step. That is the duplication this page has
already paid for once, when `scCompute` was a hand-copied `assets/js/scurve.js`.

**Six move in this pass** — Risk Register, Issues & Concerns, Meetings, Contracts & Claims, Progress
Photos, Productivity Rates. Their renderers are now `assets/js/portfolio-dash.js`, and the module
mounts its own when it is opened portfolio-wide.

⚠️ **MOVED, NOT COPIED.** This page no longer carries those six panes, their loaders, their tab
buttons or their filter panels — `loadRisks`, `loadIssues`, `loadMeetings`, `loadContracts`,
`loadPhotos` and `loadProductivity` occur **zero** times in this file now, and the test asserts it.
A second copy is how the two screens drift apart again.

### ⚠️ A DEEP LINK MUST NOT DIE WITH THE TAB
The sidebar carried `#po_view=` links into every one of these for months; they are in bookmarks and
in messages, and **every one of them arrives through `switchView`**. `PO_MOVED_VIEWS` resolves the
view name to the module that owns it now and `location.replace`s there in portfolio scope.
⚠️ **After** the super-admin gate, deliberately: a planner who cannot see Risk Register still lands
on the Overview exactly as before, rather than being redirected to a module page instead.
⚠️ `replace`, not `href` — a tab that no longer exists should not sit in the Back history.

### ⚠️⚠️ THE STAKEHOLDER MAP DID NOT MOVE, AND THE REASON IS THE READ-ONLY SCOPE
Its portfolio view carries an authoring **directory** — *+ Add person*, assign, merge — and writes
are refused at the shared Supabase chokepoint while the portfolio flag is set (`auth.js`). Moving it
into the module under `#pd_scope=portfolio` would have silently broken the one thing it does. It
stays here, with the Overview, Milestones (which has no module at all), the S-Curve, Cash Flow,
Resources and Equipment.

### ⚠️ The whole `<style>` block moved out, and that was the cheaper choice
The six dashboards are drawn with `po-*` classes and a module cannot reach a `<style>` block inside
another page. Splitting out "just the classes the six need" has to be re-judged every time a renderer
gains a class, and the first thing it misses is a rule nobody notices is missing until a table is
unreadable. So the block is now `assets/css/portfolio-dash.css`, character for character, linked by
this page and by the six modules.

### Verified
- `test-portfolio.js` **86/86** — updated to the new contract: `viewLoaders` names **six** lazy views,
  the six that moved are **asserted absent**, `PO_MOVED_VIEWS` names all six modules, and the
  `[hidden]` specificity assertion now reads the **stylesheet** rather than the page, because that is
  where the rule went. ⚠️ Left unchanged it would have passed against the HTML only until somebody
  looked.
- **89 assertions** in the shared layer's own harness (see the root log), including a gate that reads
  `origin/main`'s copies and asserts the six *were* panes here and that no module mounted anything.
- `wiring-check` **139/139** — which is what caught `Icons.paint`, a method that does not exist, in
  my own scaffolding.

⚠️ **Not verified signed in** — no dashboard has been mounted against a live project.
⚠️ **Still to come:** S-Curve, Cash Flow, Resources and Equipment. Their renderers are the four
heaviest on this page and each carries its own chart or server-side aggregate; they move on their own.

`MODULE_V` → `20260915x`.


## 2026-09-15 (v) — Phase B finished: one funnel, one KPI card, and the series switch stops being a fourth idiom

Continuing the owner's *"the UI needs complete rework… make sure the UI is consistent and
professional looking"*. (u) put the controls in the module bar; this is the rest.

### ⚠️⚠️ TWO FILTER SURFACES WERE ON SCREEN AT ONCE, AND FIVE FUNNELS EXISTED

The scope picker sat in its own bar and the Overview's toolbar carried a **second** funnel and a
**second** search box immediately below it, with nothing stating the relationship — and four other
views each had a funnel of their own. **Five `.pd-filttoggle` buttons, five `wireFilterToggle`
calls.** There is now **one**, in the tool cluster, pointed at whichever view has a panel.

- ⚠️ **`UI.wireFilterToggle` re-binds the button's onclick on every call**, which is exactly what
  lets one button serve N panels — and it re-syncs the has-active dot for the panel it is now
  pointed at, so the "something is filtered" signal follows the view instead of going stale.
- ⚠️ **Every other view's panel is closed on a switch.** One button cannot un-toggle a panel it is
  no longer pointed at, so a panel left open would still be open the next time that view came round,
  with the funnel showing no sign of it.
- ⚠️ Eight views have no panel; the button is **hidden** there rather than sitting inert.

### ⚠️⚠️ AND `hidden` DID NOTHING TO IT — THE SAME TIE, ON A DIFFERENT COMPONENT

`.pd-filttoggle` is `display:inline-flex` at specificity **(0,1,0)**, which **exactly ties** the user
agent's own `[hidden] { display:none }` — and an author rule beats the UA default at equal
specificity. `dashboard.css` carries the identical fix for `.pd-btn` (line ~634) and explains it at
length; `.pd-filttoggle` never got one.

**Measured, and the negative build is the proof:** with the rule, `hidden` computes `display:none`;
**with the rule deleted from the live stylesheet it computes `flex`** — the button stays on screen.
⚠️ **Fixed LOCALLY and reported rather than shipped app-wide:** the real repair belongs in
`dashboard.css`, which **31 pages** load, and that is its own change with its own bump. This page is
simply the first to need `hidden` on a filter toggle.

### ⚠️⚠️ THREE KPI TREATMENTS BECOME ONE — AND THE BEST ONE WAS UNUSED

`.po-kpi2` was **value weight 700** against the shared **800**, radius `md` against `lg`, padding
14/16 against 16/18. So the S-Curve, Milestones and Cash Flow strips did not match the Overview's,
and none matched the rest of the app — while `.pd-kpi`, with its accent bar, its semantic variants
and its AA-measured contrast, was used **nowhere on this page**. The 2026-09-10 (w2) pass converged
five modules onto it and this page was not among them.

⚠️ **The two producers changed; their SIGNATURES did not.** All **40 `kpi2` call sites** and 6
`msKpi` sites converge without being touched, so there is no chance of catching some and missing
others. ⚠️ The token maps to the shared **semantic variant**, not an inline colour, so the accent bar
is tinted too — and an **unrecognised** token still falls back to an inline colour, because silently
dropping a caller's meaning is the "silent nothing" this repo keeps paying for.
⚠️ The six private rules are **deleted**, not left beside the shared ones — a dead near-duplicate is
what the next editor changes by mistake. ⚠️ `--po-ms-*` **stays**: checked, and it still colours the
calendar chips, state pills and slip figures.

### The series switch is the app's own control

Three loose checkboxes become `.pd-seg.pd-seg-multi` — the shared multi-select segment, whose note in
`dashboard.css` explains why a multi choice is tint + underline rather than the solid red of a single
choice. ⚠️ A **disabled rung fires no click**, so Forecast cannot be turned on when nothing drawn
carries one: the refusal is the control's own rather than a guard bolted beside it. ⚠️ The note's
wording changed with the control ("Tick" → "Turn back on") — copy that describes a control it no
longer matches is worse than none.

### Verified — 96 assertions, and measured in a browser

**The KPI cards are executed through the REAL `UI.kpi`**, loaded the way `tools/wiring-check.js`
loads a browser script, so this proves the shipped page emits the shared card rather than that a stub
does. Both producers, every variant, the unknown-token fallback, and the empty sub-line.

Measured against the real stylesheets at 1400 and 390px, markup **produced by the shipped code**:

| | measured |
|---|---|
| KPI radius / padding / value | **12px · 16px 18px · 20px/800** (was 8px · 14/16 · 700) |
| accent bar | **4px**, `rgb(238,49,36)` — the shared card's signature, which `.po-kpi2` never had |
| semantic variant | bad value `rgb(239,83,80)`, distinct from the plain `rgb(240,239,239)` |
| segment, on | tint `rgb(61,26,25)` + ink `rgb(255,138,128)` + **2px inset red underline** |
| segment, disabled | opacity .55, `not-allowed` |
| funnels in the document | **1**, in `.pd-modulebar`, at both widths |
| sideways page scroll | **none** |

⚠️ **Three of the seven first-run failures were MY assertions, not the code** — they tested the
inline `<script>` for markup and CSS that live in the HTML outside it. Re-pointed at the document.
⚠️ The harness was **deleted before committing**, after confirming git could not see it.

`test-portfolio.js` **96/96**, `wiring-check` 136/136, `dead-hooks` **0 findings in this module**,
CSS braces 273/273, inline `<script>` parses.

⚠️ **Not verified signed in.**
⚠️ **Reported, not fixed:** `.pd-filttoggle[hidden]` belongs in `dashboard.css` for every module,
not just this page.
⚠️ **Phase B is now complete.** Next is the Overview rebuild — the four decision blocks, the
attention ranking, and the removals.

`MODULE_V` → `20260915v`, sort-checked against the `20260915u` the live site is serving.

## 2026-09-15 (u) — The chrome: one tool cluster, one scope control, and a filter panel that stops being a wall

Owner: *"the UI needs complete rework: refresh button is out of place let's just follow the
consistency of other modules first"*, then *"the filter and project select needs UI revamp and
proper placement including the export button."*

### ⚠️⚠️ THE PAGE HAD A MODULE BAR ALL ALONG. IT WAS EMPTY.

`UI.initModuleTopbar()` runs automatically on every page that loads `ui.js`, splitting `.pd-topbar`
into the fixed chrome row and a `.pd-modulebar` below carrying everything else. This page's topbar
held `#ctx-switcher`, an `<h1>`, the presence dot and `#user-bar` — the four fixed controls and
nothing else — so its module bar got a heading and a presence dot. **With nowhere to put a tool,
Refresh became an inline button inside a sentence and Export was buried in the Overview's own table
toolbar.** Nothing had to be invented: declaring the controls in the topbar markup lands them in the
module bar exactly where every other module puts them.

- **One cluster, one order, on all thirteen views: scope · filter · refresh · export.**
- ⚠️ **One Refresh replaces twelve.** Every view had its own, in three different shapes. It acts on
  the current view through the same `viewLoaders()` list (t) introduced. **The handlers went with
  the buttons** — a handler bound to an id nothing renders is the `#pk-boq` shape this repo has
  shipped once.
- ⚠️ **Refresh is IMMEDIATE, not debounced.** `renderCurrent()`'s 250ms wait exists so ticking five
  projects costs one fetch; a planner who presses Refresh has asked for it now, and a further
  quarter-second reads as a dead button.

### ⚠️⚠️ `placeScope` / `SCOPE_PANEL` ARE GONE, AND THAT IS THE POINT

They moved the one scope node between a bar of its own and four views' filter panels — so the
control that scopes **every** view sat somewhere different depending on where you were standing.
That is the inconsistency, not a cure for it. It lives in the module bar permanently now. ⚠️ Still
one node with its wiring, state and selection intact; what changed is that nothing moves it.

### ⚠️⚠️ THE SCOPE PANEL IS A POPOVER AGAIN — AND THIS IS NOT A REVERT

The 2026-09-10 (u3) pass made it expand inline because the absolute version **clipped**. It did:
it was `position:absolute; left:0; width:260px` hanging off a **right-aligned** button, so it opened
rightwards off the page. Inline cured that and bought a **full-width wall** — 21 projects in six
ragged columns, pushing the page down ~350px. Anchored to the **right** edge it opens leftwards,
into the page, and can do neither. ⚠️ Safe because `.pd-modulebar` is `overflow: visible` and its
own note in `dashboard.css` forbids making it a scroll container. The **list** scrolls, not the
panel, so the search and Select all / Clear stay reachable with 21 projects on screen — which is
exactly when they are needed.

### ⚠️⚠️ AND MEASURING FOUND A DEFECT THE DESKTOP VIEW COULD NOT SHOW

At **390px the right-anchored panel put its own left edge at −78px** — a third of the project list
off-screen and unreachable, with **no sideways page scroll to reveal it**, so nothing would have
said so. Below 700px it is pinned to the viewport (`position:fixed; left:12px; right:12px`) instead
of to the button. Anchoring to the button is right where there is room beside it and wrong when the
panel is wider than the gap.

### The view switcher returns — a named reversal, and not the same object

⚠️⚠️ The 2026-09-09 removal took out a **thirteen-button strip that duplicated the sidebar**. This
is **one compact trigger naming the view you are on**, which the sidebar cannot do and which every
other module has. The buttons behind it are never seen: `pd-tabsrc` hides them before the first
paint and `UI.tabsToDropdown` replaces them.
- ⚠️ **Built AFTER auth, deliberately.** Five views are super-admin-only and `window.__role` is not
  known until `requireLogin` resolves; building earlier would list five views a planner cannot open,
  and `tabsToDropdown` caches its button list at build time, so removing them afterwards would leave
  them in the menu. **Measured as a planner: 8 items, not 13.**
- ⚠️ `switchView` flips `.active` on the hidden source button and the trigger re-labels itself —
  `tabsToDropdown` watches with a MutationObserver. Writing the trigger's text directly would be a
  second place that has to know the view names.
- ⚠️ `opts.icon` is **not** passed: this page keeps its own `<h1>`, and the 2026-09-04 rule is that
  only a module whose title is hidden outright supplies the icon to the dropdown.

### The thirteen scope sentences go — but six paragraphs survive

⚠️⚠️ **Only the CLAUSE was removed, not the paragraph.** Six of them carry real content either side
of it — *"Closed items are left out, this is a worklist"*, *"Rate = output ÷ (crew or equipment ×
working days)"*, *"Aggregated server-side (safe at 27k+ assignments/project)"*, *"Priority is the
same 5×5 lookup the Risk Register itself uses"*. Deleting the paragraph would have deleted a fact a
planner acts on, which is the opposite of removing a restatement.

### ⚠️⚠️ TWO THINGS THE COUNT GUARD CAUGHT BEFORE ANYTHING WAS WRITTEN

Every anchor in the patch is counted and the whole patch **refuses to write** if one is off. It
refused twice, and both would have been real damage:

1. A regex for "paragraphs my edits left empty" matched **six**, not five — the sixth was
   `<p class="po-ct-note" id="po-ct-ranknote">`, the **Contracts ranking note JS fills at runtime**,
   and the one thing stopping that ranked table being an unexplained ordering.
2. `po-sh-scopenote` is **shown and hidden per sub-view** by `module.js`. Deleting the markup alone
   would have thrown on the next Stakeholders render and taken that whole view down. Writer and
   reader went together.

### Verified — measured in a browser, not read

A throwaway harness with the topbar and Overview toolbar **lifted verbatim** out of the shipped file
(never retyped), served over HTTP so the real `dashboard.css` / `ui.js` / `icons.js` are in the
cascade, measured **inside an iframe** at 1400 / 820 / 390px:

| | 1400 | 820 | 390 |
|---|---|---|---|
| Refresh / Export / funnel in the document | **1 / 1 / 1** | — | 1 / 1 / 1 |
| all three inside `.pd-modulebar` | yes | yes | yes |
| scope panel | absolute, 560×460 | absolute, 560 | **fixed**, 366 wide |
| panel inside the viewport | yes | yes | **yes** (was −78px) |
| list scrolls, search + actions reachable | yes | yes | yes |
| page scrolls sideways | **no** | no | **no** |

⚠️ The module bar background is asserted as a **colour** (`rgb(43,44,43)` dark / `rgb(255,255,255)`
light) so the stylesheet is provably in the cascade — a harness that 404s its CSS reports perfect
geometry on unstyled elements, which this repo has been caught by.
⚠️ **Five of six sampled properties differ between themes**, so they resolve through tokens rather
than stuck literals; the sixth is the title icon at `--pd-red`, correctly fixed as a brand colour.
⚠️ At 282px the cluster still fits (scope 156 + refresh 41 + export 41 within 266) and every control
measures **44px** tall — the touch-target minimum.
⚠️ **The first attempt measured nothing and said so:** opened as a `file://` URL it rendered as a
`data:` snapshot, so every relative asset 404'd — `jsRan: false`, background transparent — and the
tab was `hidden` with `innerWidth: 0`. Both are recorded traps; the numbers above are from a real
server with the tab fronted.
⚠️ The harness was **deleted before committing** (name matched `.gitignore`'s `**/*harness*`, and
confirmed invisible to git first). This repo has shipped harness files to production twice.

`test-portfolio.js` 73/73, `wiring-check` 136/136, `dead-hooks` **0 findings in this module**, CSS
braces 281/281, inline `<script>` parses, 0 NUL bytes.

⚠️ **Not verified signed in.**
⚠️ **Deliberately still to come:** the per-view filter panels are not yet unified behind the one
funnel (the Overview's own toolbar still carries Group by / status / behind-only / search), and
`.po-kpi2` has not yet been retired in favour of the shared `.pd-kpi`. Both are the rest of Phase B.

`MODULE_V` → `20260915u`, sort-checked against the `20260915t` the live site is serving.

## 2026-09-15 (t) — The portfolio never finished loading, and the filter offered to narrow it could not

Owner, with two screenshots: *"Right now it always fails loading the schedules across 21 projects"*,
then *"selected two projects only still fails"*. Both true, and the second screenshot is the
diagnosis: the filter button reads **"2 projects"** while the pane still reads **"Loading schedules
across 21 project(s)…"**.

### ⚠️⚠️ THE FILTER NEVER RE-RAN THE VIEW IT WAS FILTERING

`after()` — and both *Select all* and *Clear* — ended in `renderAll()`, which paints the **Overview
pane and nothing else**. The other twelve views each have their own `load<View>()` and **none was
called**. So ticking two projects on the S-Curve tab updated `projSel`, updated the button label,
repainted a hidden pane, and left the earlier 21-project load holding the screen. The scope
control's own comment claims it *"scopes EVERY view"*. It never did.

One `renderCurrent()` now repaints the Overview **and** re-runs the active view, through a single
`viewLoaders()` list that **`switchView` reads too** — two copies is how a view gets wired for
arrival and forgotten when the filter changes.
⚠️ **The Overview repaints immediately and only the network-bound load is debounced (250ms)**, so
ticking five projects is one fetch rather than five, and the page never feels stalled.
⚠️ The four Overview toolbar controls (Group by, status, behind-only, search) go through it as well
— they also change `filtered()`, and therefore also change every view's scope.

### ⚠️⚠️ AND A SUPERSEDED LOAD COULD WIN

`loadScurve` had no generation token, so two overlapping loads both painted and whichever finished
**last** committed `scData` / `scLoadedIds`. That is precisely why a stale *"across 21 project(s)"*
survived a change to two. A monotonic `_scGen` is re-checked after every `await` — the same device
`contracts-claims` and `notebook.js` already use.

### ⚠️⚠️ THE READ COULD NOT USE THE INDEX IT WAS BUILT FOR

`fetchScheduleForIds` paged with `.in('project_id', ids).order('id')`. The index is
`project_schedule_proj_id_idx (project_id, id)`, and `2026-07-20-schedule-scurve-agg.sql:92` says
what it is for in as many words: *"(where project_id = ? and id > ? order by id) — an indexed range
scan per page."* **One project.** Across 21 ids there is no single range to scan, the plan
degenerates, and a page can run past the ~8s `statement_timeout`. It now pages **per project**.
⚠️ **The `count:'exact'` pre-read is gone** — it counted every activity in the selection on every
load, to decide whether to show a warning toast.
⚠️ **One project failing no longer fails the view**: it is collected, **named**, and the other
twenty still draw. A partial portfolio that says which project is missing beats an empty one that
says nothing.

### ⚠️⚠️ IT FETCHED ~100k ROWS TO DRAW A CHART IT THEN REFUSED TO DRAW

`SC_FULL_MAX` is 5: above five projects the overlay already falls back to Actual-only, and 21 curves
are unreadable regardless. Meanwhile `schedule_scurve_agg_multi` returns the combined curve
**server-side in one call** and was already wired — used only to fill the KPI strip. The roll-up is
now the default render, and rows are read only at five projects or fewer.
⚠️ **The combined curve is fed in as a single series rather than given a second renderer** —
`scRenderChart` already draws N named series, and one of them being "the portfolio" costs nothing. A
parallel renderer is how two pictures of one dataset start disagreeing, which this page has already
paid for once with `scCompute`.
⚠️ **The Forecast toggle now refuses instead of lying.** The aggregate carries no SPI forecast, so
with the roll-up drawn the box would have sat **ticked over a chart with no forecast line**. It is
disabled, with the reason in its title.

### ⚠️ Every failure used to read the same

The RPC's error was swallowed (`catch (e) { roll = null; }`) and the row fetch printed **"Load
failed."** — a statement timeout, an un-run migration and an RLS refusal, all one sentence, none of
them actionable. `scErrText` names the cause: `57014` says it timed out and to narrow the filter,
`PGRST202` names the migration file, `42501` says permission.

### Verified — 73 assertions, 0 failing, and the negative build bites

New `modules/portfolio-overview/test-portfolio.js`. Every function is **sliced out of the shipped
`index.html` and executed**; a slice that will not parse **aborts** rather than quietly comparing
nothing. The contrast base is pinned to **`aae4752`**, never `HEAD`.

- The dispatch driven for **all twelve** lazy views plus Overview: each repaints immediately, each
  runs its own loader once, forced past the id cache — and **three rapid ticks produce one load**.
- ⚠️⚠️ **The race is executed, not asserted on source:** a 21-project load is started, superseded by
  a 2-project one, and the stale RPC then answers last. **One paint, and the surviving scope is the
  newer one.** Strip the guard out of the shipped function and the suite reports **two paints with
  the stale 21-project load winning — the owner's screenshot, reproduced.**
- The pager against a stub that fails project 7 with `57014`: the other twenty load, the failure is
  named, `.in(` is never used, and no `count` option is ever sent.
- All four error causes read differently, including recognised **from the message alone** when
  PostgREST sends no code.

⚠️ **Two of the failures on the first run were MY assertions, not the code**, and both are traps this
repo has recorded: the only `count:'exact'` left on the page is **inside the comment explaining that
it was removed**, and two of the three `"Load failed."` are comments quoting the message this change
deleted — the checker measuring its own explanation. Comments are stripped through `tools/scan.js`
now, and the *"Load failed."* assertion is **scoped to the S-curve loader**, because Cash Flow still
prints it and is a different view deliberately out of this change.

`node tools/wiring-check.js` **136/136**, `tools/scan.js` self-test 10/10, `selectall-key` 88 safe /
0 broken, inline `<script>` parses, CSS braces 278/278, 0 NUL bytes, LF throughout.

⚠️ **Not verified signed in** — no live portfolio has been loaded, so the roll-up RPC has never been
called against 21 real projects. That is the first thing to check: open the Portfolio Dashboard,
hard-refresh once, and the S-Curve should draw a single combined curve immediately instead of
counting to 21.
⚠️ **Deliberately NOT in this commit:** the chrome rework (the scope picker, the funnel, Refresh and
Export placement, one KPI component), the Overview rebuild, and the Portfolio Schedule view. This
one is the defect.

`MODULE_V` → `20260915t`, sort-checked against the `20260915s` the live site is serving.


## 2026-09-15 (r) — Three sidebar rows drew the same glyph, the collapsed rail lost its grouping, and "Avg Schedule %" was a mean

Owner: *"Portfolio overview dashboard needs work let's start on this. Side panel in portfolio
overview needs work as well especially when collapsed. Some icons are the same let's think of how
to solve this."*

### ⚠️⚠️ THE DUPLICATE ICONS ARE A COLLAPSED-RAIL DEFECT, AND THERE WERE THREE OF THEM

Measured by **rendering this nav through the shipped `UI.renderNav` and grouping the rows by the
geometry each icon actually DRAWS** — not by comparing names, because two different names can map
to identical paths (`grid`/`gridView` and `group`/`users` both do).

| collided | |
|---|---|
| `barChart` | **Dashboard** and **Productivity Rates** |
| `calendar` | **Milestones** and **Meetings** |
| `clipboard` | **Issues and Concerns** and **My Work** |

⚠️ This matters *because* the rail collapses. At 64px `.pd-navtxt` is `display:none` — asserted, not
assumed — so the glyph is the only thing left and two rows become indistinguishable. It is the same
defect class the Project Schedule's toolbar has already paid for twice
(`ps-lsmbtn`/`ps-outlinebtn`, `ps-progressbtn`/`ps-flowbtn`).

⚠️⚠️ **THE THREE ROWS CHANGED ARE THE THREE THAT EXIST ONLY HERE** — Dashboard → `layout`,
Milestones → a new `milestone`, My Work → `user`. A module's icon is its identity in the project
sidebar and the module grid as well, so moving one to settle a collision in *this* nav would change
two other screens to fix neither.

⚠️ `milestone` is the **diamond this app already draws a milestone with** (`.ps-mile` in the Gantt),
on a baseline — a bare diamond would collide with the drawing palette's own shape tools, and a
diamond *on a line* is a date rather than a shape. `user` is one figure against Manpower's `users`,
which is the distinction the two rows actually carry.

### The collapsed rail: the label folds, the grouping must not

Nineteen rows in a 64px column with the Portfolio / Personal / System headings dropped to nothing.
The heading is now a **rule** when collapsed — the words go, the boundary stays — with no rule above
the first row, where it would only separate the nav from a brand block that has its own border.

⚠️⚠️ **NOT `opacity: 0` any more, and that is the mechanism.** Opacity applies to the whole element,
border included, so an opacity-hidden heading cannot carry a visible divider. The text is collapsed
by `font-size` and `overflow` instead.

⚠️⚠️ **AND THE DIVIDER IS NOT `var(--pd-line)`** — found by rendering it, not by reading it. That
token is the **light-theme** divider (`rgb(220,219,219)`) and this rail is `#231F20` in both themes,
so it painted a near-white rule on a near-black column. The rail's own vocabulary is white at low
alpha (hover `.06`, scrollbar `.16`, the section label it replaces `.3`), and a divider must be
quieter than the text it stands in for. Measured painted: `rgb(66,62,63)` on `rgb(35,31,32)`.

### ⚠️⚠️ A PRE-EXISTING BUG THE SAME CHANGE EXPOSED

The mobile drawer's `.pd-navsec` rule restored `display` **and nothing else**, while the collapsed
rule above it zeroes height, padding and opacity — none of which a `display` resets. So the drawer
has been rendering **Portfolio / Personal / System at zero height and zero opacity**: present in the
DOM, invisible on screen. Every property is handed back now, restated from `.pd-sidebar .pd-navsec`
itself so the drawer looks exactly like the expanded rail rather than approximately like it.

### ⚠️⚠️ "Avg Schedule %" WAS A MEAN OF PROJECT PERCENTAGES

Two small finished projects and one huge one barely started — ₱50M at 100%, ₱50M at 100%, ₱2B at 5%
— read as **68% complete**. That is the figure this strip printed, on a page whose whole purpose is
informed decisions at portfolio level. Weighted by value it is **10%**.

Same fault and same fix as the Project Schedule's Summary view, which weights by duration and says
so. ⚠️ The weight is `original_budget` — the only measure of size the project row carries, and the
one the number is being read against. `schedule_activities` was the alternative and is worse: a row
count says how finely somebody broke the work down, not how much of it there is.

⚠️⚠️ **It degrades rather than lying.** Only projects carrying **both** a budget and a progress
figure can be weighted; with none, it falls back to the plain mean, and the basis is reported either
way, because a weighted and an unweighted figure look identical as a number. Projects reporting no
progress at all are **counted and named**, never silently dropped — "62%" over three of eleven
projects is a different statement from "62%".
⚠️ **The label changed with the arithmetic.** "Avg" over a weighted figure would be worse than
leaving the mean in place.

### ⚠️ And this page is finally cache-busted

`portfolio-overview` is not in `APP_CONFIG.MODULES` — it is a standalone page — so `pmodRow`'s
`ModulesGrid.href(m)` never reached it and every sidebar link was a bare `index.html`. That is why
this module's own log has had to end three entries with *"hard-refresh once"*. `poBase` now carries
`MODULE_V`, the same token every module page is stamped with, so one deploy busts them together.

### ⚠️ Checked and NOT changed: `isBehind` is right

`if (sf && ff && sf > ff)` reads backwards against its own comment ("slipped vs baseline finish") and
I was about to report it. Checking the **writers** settles it: `schedule_finish` is
`max(end_date)` written by the schedule module — the live programme's finish — and `forecast_finish`
is hand-entered on the project record. The live schedule running past the committed date **is**
behind. The comment's word "baseline" is loose; the logic is not.
⚠️ Reported, not changed: `isBehind` reads bare `forecast_finish` while the table column and
`projects.html` both read `forecast_finish || end_date`, so a project with a contract end date and no
typed forecast is never compared. Changing that changes what "behind" means portfolio-wide.

### Verified

**26 assertions** on `portfolioProgress` / `progressBasisNote`, sliced out of this page by name and
executed, with **HEAD's own mean lifted verbatim from `renderKPIs` as the control** — it prints 68%
where the weighted figure prints 10%, and both agree at 40% on equal budgets, which is the case
weighting cannot change. Plus the clamp (a stored −20 does not subtract), the zero-budget divide, and
the empty portfolio.
⚠️ **One assertion was MINE being wrong** — I asserted 7% and the answer is 10%, because I mis-read
2000×5. Recorded rather than quietly corrected.
⚠️ **And the control would not build at first:** `var avg = [^;]+;` stopped at the `;` inside
`return a + b;`, lifting a truncated statement. Same family as the `[^)]*` that could not cross a `)`
in the Project Schedule's suite.

**5 assertions** on the nav, rendered through the shipped `renderNav`: 19 rows, 19 distinct
geometries, every name resolving to a real glyph (an unknown `data-ico` renders an empty box,
silently), and the project sidebar's 14 rows checked as a regression guard.

**Measured in a browser** at a real 1400px viewport — ⚠️ inside an **iframe**, because the pane is a
few hundred pixels wide and a media query evaluated against *it* applies the phone rules, which is
exactly what happened on the first run and measured the drawer instead of the rail. Rail **64px**,
labels `display:none`, 19 icons drawn, **0 collisions**, first heading 0px with no border, the other
two a 1px rule, no horizontal page scroll, and the sidebar background asserted as a **colour**
(`rgb(35,31,32)`) so the stylesheet is provably in the cascade.

⚠️ **Not verified signed in** — no live portfolio has been loaded, so the weighted figure has never
been computed from real projects.
⚠️ **The rest of "the dashboard needs work" is deliberately NOT guessed at.** What is fixed here is
a figure that was wrong and a rail that was unreadable. Whether the Overview should also **rank
projects by attention** (the shape the Contracts portfolio view took on 2026-09-15 q) is a design
decision, and the owner's to make.

`MODULE_V` → `20260915r`.


## 2026-09-15 (q) — Contracts & Claims stops being a register and becomes a decision surface

Owner: *"in terms of portfolio-level contracts & claims there should be a proper dashboard as well
but should provide portfolio level information that can provide informed decisions for higher
management. UI in the portfolio-level needs work as well."*

What was here: four KPI tiles and **every row of every project's register in one flat table sorted by
project NAME**. That is a register, not a decision surface — the project that most needs attention was
wherever the alphabet happened to put it.

- **An exposure strip**: contract value · pending with client · shortfall · recovery · EOT pending ·
  oldest pending.
- **Projects ranked by unrecovered exposure** (pending + shortfall). ⚠️ Ties break on the **oldest
  pending**, not the name: two projects with the same exposure are not equally urgent if one has been
  waiting four months.
- ⚠️ **Projects with nothing outstanding are still listed, at the bottom.** A management view that
  hides the healthy projects cannot be used to say "these four are fine", which is half its job. They
  show **dashes, never zeros**.
- **A portfolio aging breakdown**, same buckets and same scaling rule as the register's own band.
- ⚠️ **The full register is KEPT**, behind a `<details>` that states its own count. The page is also
  used to find one specific row; deleting that to make room would trade one job for another. Shut by
  default — a summary that opens on 900 rows is not a summary.
- ⚠️⚠️ **Every rule comes from `PDClaims`**, never re-derived here. This page has already paid for
  a hand-copied duplicate once (`scCompute` vs `assets/js/scurve.js`).
- ⚠️ **Money and days stay apart.** EOT is its own column and is never added to the cash figures.

**22 assertions, 0 failing**, executing `ctRender` / `ctRenderRank` / `ctRenderAging` sliced out of
the page — over three projects built so the **alphabetical and exposure orders disagree**, otherwise
the ranking could be right by accident. It ranks Charlie · Bravo · Alpha where the alphabet says the
reverse. ⚠️ The suite also caught a defect in the *register's* band: its aging bars were measured on
`sub_amount` while its headline preferred `eval_amount`.

Rendered at 1280px and 390px against the real stylesheets: no horizontal page scroll, aging rows
wrapping on a phone, the ranked table scrolling inside its own box, tones resolving to real values.

⚠️ Not verified signed in.
⚠️⚠️ **This module's `index.html` is still NOT cache-busted** — plain sidebar href, `MODULE_V` does
not reach it. **Hard-refresh once** after the deploy.

## 2026-09-10 (u3) — The project filter stops clipping, and A–Z becomes a sticky rail

Owner, items 1 and 2 of six: *"The filter all projects can be combined with the other filter button
where its UI is clipping and bugging… let's just apply the existing UI from other modules so its
consistent"*, and *"when there are 1000+ stakeholders… the A-Z isn't sticky. I want to locate this at
the right side as well."*

### ⚠️⚠️ The clipping had one cause, and it was the positioning, not the width
`.po-projfilter-menu` was `position:absolute; left:0; width:260px` hanging off a **right-aligned**
button — so a 260px menu opened *rightwards* from a button already at the right edge of the page and
ran off it. Every other filter in this app expands **inline** and reflows the page
(`.pd-filtergroup`, `.po-toolbar-fields`), which cannot clip by construction. So it adopts that
idiom rather than being nudged to `right:0`, which would have fixed this one case and left the next
one to be discovered. The z-index and the drop shadow went with the absolute positioning — an inline
panel is in flow and has nothing to lift above.

⚠️ The list is now a `repeat(auto-fill, minmax(240px,1fr))` grid. A single 260px column of 40
projects was most of the reason it wanted to be a floating menu in the first place.

### ⚠️⚠️ One filter button where a view has one, and ONE NODE — never a copy
Four of the thirteen views have an expanding filter panel (Stakeholders, Risk, Issues, Equipment).
`placeScope` **moves** `#po-projfilter-wrap` into that panel, so in those views there is genuinely one
filter control, as asked. The other nine have no panel and the scope still has to be reachable from
every view, so it falls back to its own bar — which is then hidden rather than left as an empty
14px strip.

⚠️ It **moves the element**, so the wiring, the state and the selection travel with it: it is the
same DOM node, and nothing is re-bound. A copy per view is the thing that would need keeping in step.

⚠️ **The at-a-glance scope indication survives, and is the app's own convention.** `projSel` is empty
when every project is in scope, so nothing is ticked and `UI.wireFilterToggle`'s `has-active` state
is off; tick anything and the funnel goes red. **Measured both ways:** inactive with nothing checked,
active the moment one project is. The per-view scope note (*"3 of 40 projects"*) still spells it out.

### The A–Z index is a sticky vertical rail on the right
The owner's point is the one that matters at scale: with 1,000 stakeholders a strip that scrolls away
is useless exactly when you need it, because you are a long way down the list. It is now a 36px rail
beside the cards, `position:sticky`, and it is the iOS-contacts idiom rather than an invention.

- ⚠️ `align-self:flex-start` is **required** — a flex item stretches to the row height by default, and
  `position:sticky` on a full-height item has nothing to travel within. Without it the rail is
  correct in the cascade and does not stick.
- ⚠️ The per-letter **count** does not fit a 20px column, so it moves into the `title`.
  Dropping it outright would have removed the one thing that makes a letter worth clicking.
- ⚠️⚠️ **Restyled after the owner asked for it to look better, and the fault was layering.**
  The first cut bolted rail rules on top of the old horizontal-strip BUTTON styling, so every
  letter kept a border, a fill and 4px/7px padding — 27 stacked bordered boxes in a 34px column,
  which is what read as unfinished. The base rules are now written FOR a rail: no per-letter
  chrome at all, with weight and colour carrying the state. An "All" pill heads the column above
  a divider, and the scrollbar is suppressed because inside a 34px rail it would take a third of
  the width and reflow the letters.
- ⚠️ The 3px "has anybody" dot went with that: in a 20px column it was one more mark to read,
  and the letter already says it. **Measured** — a letter with people computes opacity 1 at
  weight 700, an empty one 0.26 and is disabled.
- ⚠️ The rail is a **sibling after** the cards in source order, so the tab sequence reaches the people
  before the index — the index is navigation, not content.
- ⚠️ **On a phone it reverts to a horizontal strip**, sticky to the top. A 22px column of 27 letters is
  far under the 44px touch target and there is no side channel when the page is one column.

### Verified
Driven in a browser against the real stylesheet, with the toolbar and scope-bar markup lifted
**byte-for-byte** out of the shipped page and `placeScope` **sliced out of it**, over a 224-person
fixture: the panel computes `position:static` and spans 60→771 in a 1265px viewport with **no
overflow either side and no horizontal page scroll** (it ran off the edge before); `placeScope` puts
the node in `po-sh-fields` on Stakeholders and back in `.po-scopebar` on Overview; the rail computes
`sticky`, sits to the right of the cards, and **after scrolling 1,200px it is pinned at `top: 8px`
and still on screen**.

⚠️ A first measurement pass reported `viewportW: 0` — the hidden-tab artefact again. Forced a paint
before re-measuring; the numbers above are from the second pass.
⚠️ **Not verified signed in.**

## 2026-09-10 (u2) — Directory Health: the dashboard half of the adoption

Owner: *"And a dashboard page that can also be adopted."* Asked what it should report, the choice was
**directory health, from our own data** — so this is not a copy of the other app's dashboard, it is
the same idea pointed at the register we actually hold. A third view beside Directory and By project.

⚠️⚠️ **IT ADDS NO QUERY AND WRITES NOTHING.** Every figure is derived from the `dirRows` and `dirUse`
the Directory view has already loaded, so switching to it costs nothing and it cannot disagree with
the list beside it. A duplicate is opened through the **same person panel that already owns Merge**,
rather than this view growing a second merge path that could drift from it — confirmed in a browser:
clicking a pair opens the person with **0 writes**.

Six panels: **Possible duplicates**, **Profile completeness** (per field, least-filled first),
**By sector**, **Organisations**, **People per project**, and **Loose ends**. KPIs above them: people,
completeness, on no project, possible duplicates.

- ⚠️ **The map read stopped filtering out the unlinked rows.** It read `stakeholder_map` with
  `stakeholder_id is not null`; it now reads the whole table and partitions, because rows with a NULL
  `stakeholder_id` are the *"loose ends"* worth counting. **One read answers both questions.**
- ⚠️ An unlinked row is **not breakage** and the panel says so — it is a register entry made before
  the shared directory existed. Left unexplained it reads as data loss.
- ⚠️ **The search box does not narrow this view.** Completeness over the rows matching a search is not
  the directory's completeness.
- ⚠️ Ties in every ranked list break on the **name**, so two organisations on the same count do not
  swap places between renders and read as data changing.

### ⚠️⚠️ Scoring every pair was too slow to ship, and I only knew because I measured it
The first cut compared every pair. **900 people is 404,550 pairs and 2.3 seconds of blocked main
thread** — measured, not estimated. The scan now lives in the shared `PDStakeholders.duplicatePairs`
and is **blocked**: only pairs that could possibly clear the matcher's surname gate are scored.

⚠️⚠️ **The blocking key is derived FROM that gate, never invented beside it.** A non-zero score needs
the two last tokens to be equal, within one edit, or one to be an initial of the other. Equality and
the one-edit case both fall out of the **deletion neighbourhood** (two strings within one edit always
share a member of it); the initial case needs a one-character last token, which no key can cover, so
those few people are compared against everyone.

**Two further cuts of the cap were both wrong, and both were caught by measuring rather than reading:**

| | 900 people, distinct surnames | 900 people, all one surname |
|---|---|---|
| every pair scored | 2,346 ms | 2,346 ms |
| cap checked *after* enumerating | 132 ms | **11,030 ms** to say *"not scanned"* |
| cost estimated from bucket sizes | 195 ms | 2 ms — but **refused 300 people that were 267ms of honest work** (a ~7× over-count) |
| **shipped:** exact decision, early abort | **208 ms** | **51 ms** |

A cap that only reports after paying the cost is not a cap; an estimate that over-counts sevenfold
refuses work it should do. The decision is now exact and the enumeration aborts the moment it passes
the cap, so **2,000 people with distinct surnames scan in 446ms** where 900 used to take 2.3s.

### Verified
**36 assertions** executing `dirHealth` **sliced out of this file**, plus **19** on `duplicatePairs` in
the shared suite — including the one that matters: ⚠️ **a wrong blocking key is invisible, it drops
duplicates and the screen reports "none found"**, so the suite asserts the blocked scan returns the
**exact pair set an exhaustive scan returns** over a directory built full of near-misses (a surname
typo in the *first* character, typos by insertion and deletion, a one-character surname, a match
reachable only through a nickname). **Three new contrast builds, all biting**; 11 of 11 overall.

Rendered in a browser against the real stylesheet, light and dark: six panels, 24 bars, correct
counts, no fill exceeding its track, no label widening a panel, no horizontal page scroll, and every
colour resolving through `--pd-*` in dark (warn fill → the dark `--pd-muted`, red → `#EE3124`).
Empty-directory and missing-table states both render their own message.

⚠️⚠️ **My harness reported a clean render of invisible bars.** It never loaded `dashboard.css`, so
every `--pd-*` token resolved to nothing and each fill computed to `rgba(0,0,0,0)` — with **perfect
widths**. The width checks passed and said nothing at all about whether a bar was painted. The
harness now loads the shared stylesheet and asserts the fills are **not transparent**. This is the
third time a harness in this repo has reported an unstyled page as a finding.

⚠️ The narrow-viewport check **did not run** — the pane refused to emulate 420px and reported
`clientWidth 980`, so what was measured is a 980px viewport (two columns, no horizontal scroll). The
one-column phone case rests on `repeat(auto-fit, minmax(330px,1fr))` collapsing by construction:
a cascade fact, not a rendered result.

⚠️ **Not verified signed in** — no health figure has been computed from the live directory.

## 2026-09-10 (u1) — The directory becomes a Universe: cards over the whole register, and clickable A–Z bands

Owner, pointing at a separate stakeholder app built by another developer: *"I want to adopt the
feature seeing the whole stakeholders rather than a table and seeing the clickable bands."* Two
things came across from those screenshots — a **card grid over the whole directory**, and an
**alphabet strip with counts** you can click to jump. Both are now the Directory's default.

- **Cards, not rows.** Initials avatar, name, organisation, role, project count, a status dot and a
  favourite star. The table is still there behind a **grid / list** toggle, because a table is the
  better answer to *"who is on more than one project"* and a card grid is the better answer to
  *"who do we know at DPWH"* — the two questions this screen gets asked.
- **The A–Z strip renders every letter, present or not.** A strip that shows only the letters in use
  jumps around as you type in the search box, and a **disabled** letter is the useful answer to *"is
  there anyone under Q?"*. Empty letters are disabled, never hidden. ⚠️ `#` (names not starting with
  a letter) sorts **last**, or a handful of odd rows would head a list of 240 people.
- ⚠️ **Bands are cut on the same NORMALISED name the matcher uses**, so `Engr. Ana Reyes` lands
  under **A** with everyone else rather than under **E** on its honorific. One normaliser, so the
  band strip and the duplicate warning cannot disagree about who a person is.
- **Grouping is a choice** — A–Z, organisation, sector, or none. ⚠️ Switching it **clears the picked
  band**: a letter selected under A–Z means nothing under "group by organisation", and carrying it
  across would filter to an empty screen with a control that looks satisfied.
- ⚠️⚠️ **The favourite star is OPTIMISTIC AND REVERTS ON REFUSAL.** `is_favorite` only exists once
  `migrations/2026-09-10-stakeholder-profile-fields.sql` has been run, so on an un-migrated database
  every click **will** be refused — and RLS answers a refused UPDATE with **200 and zero rows**, the
  silent-success trap this log already records for the merge. Zero rows is treated as failure: the
  star goes back and it says, once, which migration is missing. A star that appears to stick and
  silently did not is worse than one that refuses.

### The list view is the same grouping, not a second one
`dirRender` became a dispatcher; the old table body is now `dirRenderList`, fed the **same band
groups** the grid draws. ⚠️ It gets its own container rather than swapping `innerHTML` on one node —
the two layouts share no structure, so one node would make each render pay for the other's markup.

### New KPI: *On no project*
A person added and never assigned is the actionable state this screen exists to surface, and nothing
counted it. Counted, not hidden.

### Verified
The shipped directory code was **sliced out of `index.html` and driven in a browser** against the
real stylesheet: **27 bands rendered, 26 with people**, empty ones **disabled rather than hidden**,
`#` ordered last; clicking **F** filters to 3 cards and clicking an empty letter is refused;
group-by-organisation reproduces the right counts; no grouping gives 0 sections, 0 bands, 32 cards;
the list layout draws 26 band rows + 32 people = **58 rows**; and card heights are **uniform at
102px**.

⚠️ **Two of my own defects, both caught by measuring rather than reading.** Card heights came back
ragged (`[85, 102]`) because an empty role line collapsed — fixed with `min-height`, ⚠️ **not** the
`::after` escape I tried first, which wrote a **literal NUL byte** into this file and rendered as
mojibake on the card. And my first harness asserted `capOverflows: ? false : false` — a claim that
cannot fail — now a real clip-and-height check.

⚠️ **Not verified signed in.** No card has been drawn from the live directory, and no favourite has
been written.

## 2026-09-10 (s5) — The Stakeholders tab stops being read-only: a directory you can author

Owner: *"By Portfolio Overview and accessing the stakeholder map, planners can create stakeholders
from this and assign it to different projects."* The second half of Stage 4; the first half stopped
new duplicates at the point of entry, this one is the portfolio-level master list itself.

The tab had a search box and a table over the `stakeholder_map` **mirror** — no create, no assign,
no row click. It now carries two views:

- **Directory** — one row per `stakeholders` person: name, organisation, role, sector, and how many
  projects they are on. ⚠️ That count reads the FULL map, never the project-filtered one: "on N
  projects" is a fact about the person, and scoping it would make the same person read 3 on one
  screen and 1 on another. The scope note is hidden in this view for the same reason.
  ⚠️ A person on **0** projects shows `0`, not an em dash — it is a real and actionable state
  (someone in the directory nobody has assigned yet), and a dash would read as "unknown".
- **By project** — the existing mirror view, unchanged. It answers a different question.

**+ Add person** creates a directory row. ⚠️ The duplicate warning fires **while typing**, not after
saving: telling a planner they have made a duplicate once it exists is worse than useless, because by
then somebody has to merge it. It uses the same shared matcher as the module's save path, so the two
screens cannot propose different answers.

**Assign to projects** ticks projects and writes `stakeholder_map` rows carrying the link, the
`created_by` RLS needs, and the mirrored person fields. ⚠️ Projects the person is already on render
disabled and are skipped rather than inserted twice. ⚠️ The toast reports the count that came BACK —
`stakeholder_map_ins` requires `can_access_project`, so a project the planner cannot write to must
not be counted as done.

### ⚠️⚠️ Merge, and the two ways it refuses

`mergePeople` re-points the loser's project rows, fills only the winner's EMPTY fields, and deletes
the duplicate. It refuses in two situations rather than guessing:

- **Both people are on the same project.** Re-pointing would put two rows for one person on one
  project; deleting one would destroy that project's own assessment of them — influence, interest,
  engagement plan — which is real, unrecoverable work and not a merge dialog's decision. The message
  names the project.
- ⚠️⚠️ **Fewer rows moved than expected.** `stakeholder_map_upd` is
  `(created_by = auth.uid() or is_admin())`, and **PostgREST answers an RLS-filtered UPDATE with 200
  and zero rows** — the silent-success trap this repo has recorded since `boq_tag_activities`. So
  re-pointing rows another planner created returns success and changes nothing. Every write is
  `.select('id')`ed and counted; a shortfall **stops the merge and deletes nothing**, because
  deleting the loser then would orphan the rows that did not move (`on delete set null` turns them
  into unlinked legacy rows). The message says how many of how many moved and why.

⚠️ `photo_path` and `photo_thumb_path` are only ever taken **together, from one person** — a merge
that filled them independently would pair one person's photo with another's thumbnail, the identical
trap the backfill migration solves with `(array_agg(... order by ...))[1]`.
⚠️ A delete the policy refuses (`stakeholders_del` is `is_planner()`) is **reported**, not claimed:
the people are merged but the duplicate row survives, and the planner is told.

### Verified

**26 assertions on the shipped data operations**, executed against a Supabase-shaped stub that can be
told to behave like RLS — accept the call, return 200, hand back fewer rows than were asked for.
Plus the 41 matcher assertions, and **8 contrast builds, all biting**.

⚠️ **One contrast did not bite at first and the fixture was at fault, not the code:** the
"loser overwrites a field the winner has" build passed because the loser's `role_title` was `null`,
so an overwrite had nothing to overwrite with. The fixture now gives it a real conflicting value, and
the assertion checks the PATCH rather than only the report.
⚠️ **My first Supabase stub made `.select()` terminal**, so shipped code threw *"ilike is not a
function"* — a stub bug that reads exactly like a code bug. The real builder is chainable and
thenable, and the stub now is too.

**Driven in a browser** against the shipped stylesheet with the directory code sliced out of the
page: the list renders with correct per-person project counts; the person panel disables the projects
they are already on; assign writes exactly one row for the untouched project with the mirror fields;
a clean merge repoints, fills `email` + the photo pair, leaves `role_title` alone and deletes the
loser; the same-project refusal **writes nothing at all**; and the partial-repoint refusal leaves the
loser **undeleted** and the winner **un-updated**. The live duplicate warning surfaces both Fernandos
while typing and clears for an unrelated name — matching "Megawide Construction **Corp**" against
"…**Corporation**", which is the corporate-suffix folding working.

`stakeholders.js` → `?v=20260910s5`; `MODULE_V` → `20260910s5`.
⚠️ **Not verified signed in** — no person has been created, assigned or merged against the live
directory, and the RLS refusal paths above are reasoned from the policy text plus a stub, never
observed. The first real merge is the thing most worth watching.

## 2026-09-09 (p3) — The 13 in-page tabs go, the Group Head column goes, and the S-curve becomes per-project

Owner's three Portfolio Dashboard items.

### 1 — The tab strip was a second copy of the sidebar

*"The tabs in the page itself is redundant with the buttons of the side panel."* Correct:
`UI.renderNav`'s portfolio section already deep-links into every one of those views through
`#po_view=`. The 13-button `.po-tabs` strip is removed.

- ⚠️ **Routing survives untouched** — `switchView` is driven by `UI.bindHistoryState` off the URL hash,
  never by the buttons, so every existing deep link still works. The `.active` toggle, the click wiring
  and the role-gating loop are **deleted, not left dead**.
- ⚠️⚠️ **MILESTONES WOULD HAVE BECOME UNREACHABLE.** It has no module, so `PORTFOLIO_TAB` (which maps
  module keys) cannot produce it, and the strip was its only entry point. `ui.js` now lists it
  explicitly in the portfolio section. `overview` needs no row — the plain "Dashboard" link lands there.
- ⚠️⚠️ **THE PROJECT FILTER WAS A CHILD OF THE STRIP** and scopes *every* view, so it could not go with
  it. It keeps its own `.po-scopebar` rather than moving into the Overview toolbar, where the other
  twelve views could not reach it. ⚠️ That bar must never become an `overflow-x` container — the menu
  is `position:absolute` and would be clipped, which the removed comment recorded and this one keeps.
- ⚠️⚠️ **THE ROLE GATE MOVED INTO `switchView`, AND IT IS STRICTLY STRONGER THAN WHAT IT REPLACES.** It
  used to set `hidden` on five tab buttons — which never stopped anyone typing the `#po_view=` hash,
  because the hash goes straight to `switchView`. Gating the view closes the door the tabs never did.
  Same five as before, matching `superAdminOnly` in `config.js`, which is also what gates the sidebar.
  UI visibility only, no RLS change — unchanged from before.

### 2 — Group Head column removed

Redundant with the group-head row segregator. ⚠️ `groupHead()` itself **stays**: it feeds the search,
the row grouping and the Excel export. ⚠️ Removing a column means four other places must follow, and
they are the easy thing to miss — the `colspan="3"` group row's fillers, the TOTAL row's fillers, and
the empty state's `colspan`. **Asserted**: header, body row, group subtotal, TOTAL and empty state all
count **8**. ⚠️ The empty-state anchor was scoped to the projects table — the identical
`colspan="9" class="po-empty"` string appears in the Resources and Equipment tables, which still have
nine columns of their own and must not be touched. ⚠️ My first cell counter reported the subtotal row
as 6 against a header of 8; the row was correct and the COUNTER was wrong (an optional colspan group
with a lazy quantifier is simply skipped, so `colspan="3"` counted as 1). Rewritten before it was used
to justify anything.

### 3 — One chart, colour = project, line style = series

*"a chart s-curve showing the different s-curves of different projects … however, I am thinking how
this would look if there are even 2 projects with different s-curves (BL, Actual, Forecast)."*

- ⚠️⚠️ **`scCompute` WAS A HAND-COPIED DUPLICATE of `assets/js/scurve.js` and is now a wrapper over the
  shared engine.** That duplicate is exactly the drift the 2026-09-01 extraction into `PDScurve`
  existed to prevent, and it had already cost something real: the *"Overall Progress" ≡ "Actual to
  date"* identity bug has to be reasoned about in three places instead of one. Fixing the engine now
  fixes this page too — which is what makes the Stage-5 KPI work land once instead of three times.
- ⚠️⚠️ **THE Y AXIS IS PER-PROJECT PERCENT, NOT A SHARED ABSOLUTE TOTAL.** Duration units are not
  comparable across projects: a 40,000-day programme would flatten a 2,000-day one into the axis and
  the comparison would say nothing. Every curve runs 0→100% of its own total.
- ⚠️ **`project_id` added to the lean select.** Its absence is precisely *why* a per-project overlay
  was impossible — every row arrived anonymous. The rest of the column list now mirrors `PDScurve.COLS`
  so the fetch and the engine cannot drift about which columns the maths needs.
- ⚠️ **The RPC fast path is kept, for the KPI strip only.** `schedule_scurve_agg_multi` returns one
  combined aggregate and cannot produce per-project series, so the overlay comes from rows — but
  rendering the roll-up KPIs off the RPC first means the strip still appears immediately instead of
  waiting on a 40k-row fetch, which is what it always did.
- ⚠️ **Above 5 projects the chart defaults to Actual-only and SAYS SO on screen.** N projects × 3
  series is 3N lines. It is a default, not a limit — three checkboxes bring Baseline and Forecast back,
  and **no project is ever silently dropped from a chart**.
- ⚠️ Series are drawn as runs split on nulls, not one polyline through the gaps — a single polyline
  would draw a straight line across months a project does not cover. Cumulative values carry forward
  after a project ends, because a gap there would read as progress going away.

**Verified** by slicing the shipped overlay out of the page and executing it against seven-, three- and
two-project fixtures built through the real `PDScurve.compute`: 2 projects → **6 polylines in 2
colours**; 3 → **9 in 3**; 7 → **7 solid lines with the note shown**; 7 with every series ticked →
**21 lines, 7 colours, note gone**; y-axis 0–100%; and **no drawn point outside the plot box**, which is
what proves the per-project percent normalisation. Rendered and screenshotted in dark mode.

⚠️ `.po-planned2` / `.po-actual2` deleted rather than left dead — they styled the two polylines of the
old single combined curve, and colour is per project now, so it cannot come from a static class.

`MODULE_V` → `20260909p3`; the page now loads `scurve.js`.
⚠️ **Not verified signed in** — no real project schedule has been drawn.

Cross-project **Portfolio Overview** dashboard (Phase 2). Unlike other modules it is
**project-agnostic** — it reads ALL projects the signed-in user can access (RLS-scoped) plus
the workspace tree, and does not use `pd_project`.

## Data
- `PDb.getProjects()` + `PDb.getWorkspaces()` only — no own table, no migration.
- Uses the same Workspace→Program→Group-Head tree model as `dashboard.html`
  (`ancestorOfType`, `groupHead`, `childrenMap`, `pathOf`).
- Reads existing `projects` fields: `status, workspace_id, group_head, original_budget,
  estimated_cost, schedule_progress, schedule_start/finish, forecast_start/finish,
  start_date/end_date` (the schedule_* rollups are written by the project-schedule module).

## Contents
- **KPI cards**: Projects, Active, Avg Schedule %, Original Budget, Estimated Cost, Budget
  Variance (est−orig), Over Budget count, Behind Schedule count.
- **Schedule Health donut** (SVG, no libs): On Track / Behind / No Schedule.
  `health(p)` = no schedule_progress → none; slipped vs baseline finish OR overdue-and-incomplete
  → behind; else on track.
- **Budget-by-group bars** (SVG): Original vs Estimated per group, top 8 by estimated.
- **Grouped, sortable portfolio table**: group by Workspace / Program / Group Head / Status /
  None; per-group subtotals + grand total; sort any column; collapse groups; click a project
  row to drill in (sets `pd_project`/name/workspace → `dashboard.html`).
- **Filters**: status, behind-schedule-only, text search. **Export** to Excel.

## Discovery
- Registered in `assets/js/config.js` MODULES (`enabled: true`) → appears on the Project Home
  module grid.
- Top-level nav link added in `projects.html` (sits with "All Projects").

## Notes
- Pure vanilla + shared APIs (AppAuth/PDb/Fmt/UI/Icons); XLSX from CDN for export.
- No schema changes.

## Project selector filter (2026-07-06)
The single "All projects / one project" dropdown became a **multi-select checklist**
(search + Select all/Clear); KPIs/donut/bars/table all narrow to the checked set (`projSel`
map; empty = all projects). Verified in a stubbed harness.

## Cross-project S-Curve + Cash Flow tabs (2026-07-06)
Added a tab strip (**Overview / S-Curve / Cash Flow**) above the existing dashboard, which
moved into a `#po-view-overview` container unchanged. The two new tabs are **real** cross-
project views (not just a nav shortcut) — decided after finding the actual data-cost tradeoffs
per module:
- **S-Curve**: fetches real `project_schedule` rows (paginated, `.in('project_id', ids)`)
  across whichever projects the Overview tab's project filter currently resolves to, and
  reuses the **exact duration-weighted math** the single-project S-Curve module computes
  with (`compute()` in `modules/s-curve/index.html`) — `project_id` doesn't matter to that
  math, so a combined multi-project activity list works without modification. Warns (toast)
  if a combined fetch exceeds 20,000 activities. **Not the vestigial `s_curve` table** — that
  table has no writer anywhere and isn't used by the real S-Curve module either.
- **Cash Flow**: fetches `cash_flow` rows across the same scoped project ids (cheap — one row
  per project per month), aggregates into monthly Planned/Actual bars + cumulative curves +
  a category breakdown table.
- Both tabs are lazy-loaded on first visit and cache by the current project-id scope; a
  Refresh button force-reloads (so changing the Overview filter while already on a data tab
  doesn't silently go stale, but also doesn't refire a heavy query on every keystroke).
- Verified in a stubbed harness (synthetic 2-project, multi-activity, multi-category fixture):
  hand-checked S-Curve math (TOT=186 duration-days, overall 33.2%, planned-to-date 57.9%,
  variance -24.7pp) and Cash Flow aggregation (₱1.15M planned / ₱990k actual across 4 entries,
  category breakdown to the peso) both matched exactly; confirmed the project filter narrows
  both new tabs identically to the Overview tab.

## Project selector moved to the tab bar (2026-07-11)
User feedback during live testing: on the S-Curve tab there was no project selector — it lived only in
the Overview toolbar, so you had to switch back to Overview to change scope. Moved `#po-projfilter-wrap`
out of the Overview toolbar into the always-visible `.po-tabs` bar (right-aligned, `margin-left:auto`),
so the same multi-select filter scopes Overview + S-Curve + Cash Flow from any tab. Handlers are keyed
by id (no JS change); the scope notes on the S-Curve/Cash Flow tabs now read "the project filter above"
instead of "set on the Overview tab". Behaviour unchanged: changing scope while on a data tab still needs
the tab's **Refresh** (cached by scope, per the 2026-07-06 note).

## Resources tab — cross-project resource demand (2026-07-11)
4th tab (Overview / S-Curve / Cash Flow / **Resources**), scoped by the same project filter. Because
`resource_assignments` can be 27k+ rows for ONE project, it does NOT fetch raw rows — it calls a new
**`portfolio_resource_summary(text[])` RPC** (migration `../../migrations/2026-07-11-portfolio-resource-rpc.sql`,
**USER MUST RUN**) that GROUP-BYs on the server and returns one compact row per resource identity
(name/type/uom) across the scoped projects: distinct projects, assignment count, Σ budgeted/actual/
remaining units, Σ budgeted/actual cost. UI = KPI row + a top-12-resources-by-budgeted-cost bar list
+ a full per-resource table with a TOTAL row. Lazy-loaded + cached by scope (Refresh button), same as
the S-Curve/Cash-Flow tabs. **Tolerant:** if the RPC isn't installed, shows a "run the migration"
nudge (verified live 2026-07-11 — tab opens, nudge shows). RPC is `security invoker` so the caller's
RLS (`resource_assignments` read = `is_approved`) applies.

## Live collaboration (presence) + offline read (2026-07-27) — fmlozano
Portfolio spans **all** projects and is a **read-only rollup**, so it gets **presence-only + offline
read-cache** — no per-project live stream (cross-project unfiltered would be broad) and no editing cursor.
- **Presence:** `PDCollab.join({ key:'portfolio', … })` with **no `tables`/`projectId`** (presence +
  broadcast only, no postgres_changes) — shows who else is viewing the portfolio right now, avatars in
  `#po-presence`. Live per-project data still arrives via the per-tab **Refresh** + the modules that
  write the rollups.
- **Offline:** the `PDb.getProjects()` + `getWorkspaces()` load is cached under `po:all`; on a failed
  fetch the last-cached portfolio renders so the dashboard still opens offline (the lazy S-Curve/Cash
  Flow/Resources tabs still need a connection).
- No migration (presence needs no server change). Verified: inline script parses. Live verification
  pending. Assets: `offline.js?v=20260726d` + `collab.js?v=20260727a`.

## Cash Flow module now real (2026-07-06)
Cash Flow was flipped to `enabled: true` in `config.js` because it stopped being a placeholder
— see `modules/cash-flow/CLAUDE.md`. This tab reads its `cash_flow` table.

## Equipment availability across the portfolio (2026-08-24) — fmlozano

A fifth tab, **Equipment**, answering the one question a project-scoped register cannot: *where is
each asset committed, and when does it come free?* No migration — it reads `equipment_items` +
`equipment_loading` for the scoped projects.

**The month grid is the answer, and availability is its negative space.** One row per asset, one
cell per month, coloured by the project that has it; an empty cell means free. A KPI band, four
availability filters (All / Free now / Free within 3 months / Double-booked), category + search, an
asset register below it, and an Excel export that emits **the same picture** (a column per month) so
the sheet and the screen cannot tell different stories.

⚠️ **The asset identity is `equipment_items.code`, and that column is unique per PROJECT — which is
exactly why the same code on two projects is reported, not judged.** It is either one asset that
moved between them or two projects that both numbered their first crane TC-01, and *nothing in the
data distinguishes those*. So a month where two projects both plan one code is marked "planned on two
projects" with both names in the tooltip; calling it an error would be a guess presented as a fact.
Codes are merged case- and space-insensitively, because "TC-01" and "tc-01" are the same asset to
every human reading the sheet.

⚠️ **Only PLANNED quantities drive the grid.** Actuals say where an asset *has been*; availability is
a forward question. A planned quantity of **0 or blank is not a commitment** — those are how the
Equipment Loading module records "not reported" and "none on site", and treating either as a booking
would report a free asset as busy.

⚠️ **`PDb.selectAll`, never a bare select.** One row per equipment per month across a whole portfolio
passes PostgREST's 1000-row cap easily, and a truncated read here would report an asset as free in
months it is actually committed — the most dangerous failure this screen has, and a silent one.

⚠️ **"Free from" is read off the same grid the planner is looking at**, so the number in the table and
the picture in the strip can never disagree. This month is always on the axis even when nothing is
committed near it — "free now" is a claim about the present and needs the present on screen to be
checkable. The window is capped at 48 months and **says so** when it truncates.

⚠️ **Project colours are keyed by project id, not by position in the filtered list** — otherwise
every filter change repaints the grid in different colours and the legend has to be re-read.

**Four real defects found by measuring, none of which would have shown up in a code read.**
1. The inline `style="background:…"` shorthand **reset `background-image`**, so the diagonal hatch
   marking a double-booked month never rendered — measured as `background-image: none` on a cell that
   should carry it. It is `background-color` now.
2. `min-width:100%` with auto table layout let the browser widen the columns past their declared
   widths; with `table-layout:fixed; width:100%; min-width:max-content` the strip fills the card
   (it previously huddled in ~610px of a 1400px card) and still scrolls when the portfolio is long.
3. The brand red on the red tint used by the code chip reads **3.60:1** — under AA at 12px bold. Ink
   on the same tint is **14.25:1 light / 13.45:1 dark**, and a red left border keeps the brand cue
   (the same treatment as the PRC group-head chip).
4. In dark mode the "free now" green read **2.61:1** and the flag colour **4.02:1**. The dark
   overrides take those to 7.26 and 6.12. A single colour for both themes cannot satisfy either.

**Verified** — 24 checks executing the shipped `eqBuild` / `eqVisible` / `eqColorFor` (sliced from the
file, never reimplemented): codes merged case-insensitively into one asset, sequential months across
two projects **not** flagged while the same month **is**, zero and blank ignored, a registered but
unplanned asset carrying no months, an uncoded item kept + flagged + sorted last, "free from" landing
on the first uncommitted month, this month always on the axis, a 12-year span capped at 48 with the
truncation reported, and every filter. Plus a real browser against the shipped CSS at 1440 and a
375px layout viewport: 23 rows × 13 months, sticky asset column and header, the hatch present, all
five KPIs, 0 page horizontal scroll at either width, the grid and the register each scrolling inside
their own card, every control ≥44px on the phone, and light/dark contrast at **min 5.37:1**.

⚠️ **Not verified signed in** — the anon key has no grants on the equipment tables, so the
cross-project read itself is untested against real data.
⚠️ **This module's `index.html` is NOT cache-busted** (it is reached by a plain sidebar href, not
through `MODULE_V`), so hard-refresh once after the deploy.

## Milestone calendar (2026-08-26) — fmlozano

Owner: *"For portfolio dashboard, let's have a calendar view of the milestones as well."* A sixth
tab, **Milestones**, scoped by the same project filter as every other tab. **No migration** — it
reads `project_schedule` for the scoped projects.

**A month grid with an agenda under it.** Chips sit in day cells colour-coded achieved / overdue /
due; month arrows and a Today button move the window; clicking a chip opens the milestone with its
slip against baseline. Filters are project, state and a programme-milestones-only toggle. The KPI
band reads Milestones · Overdue · Next 30 days · Achieved · Undated.

⚠️ **A milestone is `activity_type ILIKE '%milestone%'` OR `program_milestone = true`, matched
server-side.** Both, because the two disagree in the real data: P6 exports type them (`Start
Milestone` / `Finish Milestone`) while the flag is set by hand here, and either test alone silently
drops a whole class of them. The `ILIKE` also catches the `Milestone`/`milestone` casing both spellings
appear in.

⚠️ **`PDb.selectAll`, never a bare select.** Milestones across a whole portfolio pass PostgREST's
1000-row cap, and a truncated read would report a project as having no milestones this month — a
silent wrong answer on the screen whose entire job is "what is due".

⚠️ **UNDATED MILESTONES ARE COUNTED AND NAMED, never dropped.** A milestone with no date cannot be
placed on a grid, so the tempting thing is to filter it out — but "no milestone this month" and
"nobody has dated this milestone" are opposite facts, and only the second is a reason to go and
look. It gets its own KPI reading "1 (cannot be placed on the calendar)".

⚠️ **Achieved is `actual_finish`, and it is reported against BASELINE, not against the current
plan.** Comparing an actual to `end_date` measures nothing — the plan moves, so a milestone that
slipped six months reads as on time the moment someone re-baselines the date. `bl_finish` is the
committed date and the slip is the variance from it. Falls back to the planned date only when there
is no baseline, and says which it used.

⚠️ **Overdue means past AND not achieved.** A date in the past is not by itself a problem.

⚠️ **All date arithmetic is UTC string maths** (`ymd`/`isoOf`/`addDays`), never `new Date(str)`.
Local parsing of a bare `YYYY-MM-DD` is midnight UTC rendered in local time, which east of Greenwich
is the previous day — the off-by-one that has bitten this repo repeatedly (see the drawing-register
importer and the MoM aging fixtures).

⚠️ **The grid is Monday-first with a fixed 42 cells** (`lead = (getUTCDay() + 6) % 7`). Six weeks
always, so the calendar does not change height as you page through months and the chips do not jump.

⚠️ **The `+N more` overflow is a BUTTON that opens the day, not a label.** The cap is 3 chips per
cell; a "+2 more" you cannot click is the same as hiding them.

**Two real contrast failures, found by measuring rather than reading.** The first measurement was
itself wrong — it ignored alpha, so a tint of the same hue read as ratio 1.00 and looked fine.
Compositing over the actual ancestor background surfaced `.po-cal-more` and `.po-ms-prog` at
**3.40:1 dark / 4.12:1 light**, under the AA floor for small bold text. Both now use body ink (with a
red border on the programme mark to keep the brand cue): **all 13 marks pass, min 4.86 light / 4.81
dark.**

⚠️ **A pre-existing phone defect, which I made worse and therefore fixed.** An A/B against my own
added tab measured `.po-tabs` at **573px in a 375px viewport before this change** and **685px
after** — it already overflowed, and the 6th tab widened it by 112px. It was `flex-wrap: nowrap;
overflow-x: visible`, so the later tabs simply spilled off-screen unreachable.
⚠️ **It now WRAPS rather than scrolling, and that is deliberate:** `#po-projfilter-wrap` is a *child*
of `.po-tabs` and its dropdown is `position:absolute`, so an `overflow-x` scroller here would
establish a clipping context and cut the project filter's own menu off — the exact trap the module
topbar hit in the 2026-07-24 part-6 pass. The filter takes its own full-width row. Measured after:
strip **355px**, all 6 tabs on screen over 2 rows, 44px targets, dropdown clipped by nothing.

**Verified in a browser harness against the shipped markup and CSS**, at a 375px layout viewport and
at 1280: 42 cells in a 7-column grid, Monday first / Sunday last, today highlighted; KPIs read
`12 / 1 overdue / 7 next-30 / 2 achieved (1 late) / 1 undated`; the `+2 more` overflow opens and
shows all 5; an empty month says *"Nothing in November 2026 — use the arrows, or Today, to move."*;
the agenda's first row reads `2026-08-11 | One Portwood Residences | Topping Off — Tower 1 program |
Construction | Achieved planned 2026-08-06 | +5d`. Desktop confirmed byte-for-byte unchanged
(`nowrap`, one row, 38px tabs, filter right-aligned, no page scroll). Inline script parses, CSS
braces balanced, **0 functions lost / 21 added**, and the BOQ (112), PMI (82) and push (22) suites
are still green.

⚠️ **Not verified signed in** — the anon key has no grants on `project_schedule`, so the query
itself is exercised against a fixture, not against real data. The `.or()` filter string in particular
is untested against PostgREST.
⚠️ **This module's `index.html` is NOT cache-busted** — it is not in the `MODULES` registry and all
five hrefs to it are plain links, so `MODULE_V` does not reach it. **Hard-refresh once after the
deploy** or the new tab will not appear.

### 2026-08-27 — "Parent project": AVR101 + AVR102 consolidate without becoming one project

Owner: *"Let's just consolidate the two into a portfolio view… similar to how procurement dashboard
works."* Avesta Residences is bought as **AVR101** (Tower 1 and General Requirements) and **AVR102**
(Towers 2-7). Both are real, separate projects here — and in Procurement and Engineering, which is the
constraint that decided the design.

⚠️ **A ROLLUP, NOT A MERGE, and that is the whole point.** Folding them into one Planners project holding
two `packages` rows is what produced the `AVR101 › {AVR101, AVR102}` nesting the owner reported, and it
breaks the cross-app link: `push-packages` resolves **one** downstream project per Planners project
(`cash_flow_settings.wpm_project_id`), while WPM and Engineering each hold AVR101 and AVR102 as their own
projects. Keeping the rows separate keeps that 1:1 intact and costs no data change.

**Ported from `wpm/index.html`** (`_progKey` / `_progLabel` / `_progTotals`) rather than re-invented — the
Procurement dashboard hit this first and its answer is already the one the buyers read.

- **`Group by → Parent project`**, alongside Group Head / Status / None. The key is the **leading letters
  of the project code** (AVR101, AVR102 → AVR), overridable by a `program` column if one is ever added.
  ⚠️ Not a guess: it is the convention every id here already follows (AVR, BAU, GPR, SLN, SLT), so it
  needs **no data entry** to start working, and a project with a unique prefix forms a group of one that
  reads exactly as it does today.
- **The group is named by the words its members' names actually share** — "Avesta Residences", not "AVR".
  ⚠️ Falls back to the code when they share fewer than 3 characters, which is the honest answer for an
  accidental prefix collision; inventing a shared name for two unrelated projects would be worse than
  showing the bare code.
- ⚠️ **The key groups, a separate function names.** Collapse state and sorting stay on the KEY, so
  renaming a project never loses a collapsed group.
- ⚠️ **GROUP PROGRESS IS WEIGHTED BY ACTIVITY COUNT, never a plain mean** — the single number that makes
  this rollup worth having. AVR101 carries ~4,393 activities and AVR102 far fewer; averaging 60% and 10%
  to **35%** describes no real project, where the weighted answer is **58%**. Same principle as WPM's note
  on award rate: *"a 2-WP package at 100% and a 200-WP package at 10% is not 55%."* Falls back to the
  unweighted mean only when no member reports a count, and the cell's tooltip **says which method it
  used** rather than presenting the two alike.
- **The project filter groups too**, so the consolidation reaches past the overview table: ticking
  **Avesta Residences** puts both packages into the S-curve, Cash Flow, Equipment, Milestones and
  Resources tabs at once. The parent checkbox is tri-state; searching "Avesta" keeps AVR102 even though
  its own name reads "Towers 2-7". ⚠️ A program of one renders **flat, with no parent header** — a
  hierarchy above a single project is the same invention this change exists to remove.
- **The label answers "what am I looking at?"** — one whole parent selected reads *"Avesta Residences
  (2 packages)"*, not *"2 projects"*.
- **The Excel export carries a `Parent project` column** so a pivot consolidates the same way.
  ⚠️ Computed over the whole portfolio, not the filtered list, or a filter hiding AVR102 would rename
  AVR101's parent to AVR101's own title.

**Verified 23/23 in Node against the shipped functions** (extracted from this file by brace-matching, not
re-typed): the AVR pair keys together; `program` overrides the prefix; the shared-name label, its
punctuation trim and its collision fallback; weighted 58% vs the naive 35%; a project with no progress
excluded rather than counted as zero; group ordering and membership; all four filter-label states.
Group-header and checklist markup rendered and inspected.

⚠️ **Not clicked through signed in** — the app is auth-gated and this session had no credentials. Class
audit clean (`po-pf-prog` / `po-pf-child` / `po-pf-count` all defined); the only undefined classes are the
pre-existing `po-scope` and `po-tablecard`.
