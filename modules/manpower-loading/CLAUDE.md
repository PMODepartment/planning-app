# Manpower Loading — module change log

## Fix: the phone tab strip overlapped itself — `display:inline-flex` defeated the shared wrap rule (2026-09-02)

Found via a headless audit pass (mocked-Supabase Playwright harness rendering the real, unmodified
module at 375px) — screenshot showed "LoadingPositions", "RosterMobilizationActivities" running
together with no visible gap, unreadable.

⚠️ **Root cause: `.mp-tab` sets `display:inline-flex; gap:6px` — vestigial, these tabs carry no icon,
just bare text.** That turns each tab's own text into an anonymous flex item whose default
`min-width:auto` refuses to shrink below the width of its longest unbroken WORD — which defeats the
shared `dashboard.css` rule at ≤700px (`.pd-modulebar > [class$="-tabs"] > button { flex:1 1 0;
min-width:0; white-space:normal; ... }`), whose entire documented purpose is to wrap a long tab label
onto two lines instead of letting it overflow. That is the exact bug class already fixed once for
Contracts & Claims (2026-07-24 part 6) — reintroduced here by this module's own local CSS.

With 7 tabs at ~44px each, single unbreakable words ("Mobilization", "Positions", "Activities",
"Portfolio") don't wrap; they overflow past their own tab box and visibly overlap the neighbour on
both sides. Measured: "Mobilization"'s text ran **14px past its own tab's right edge**, into
"Activities"; every tab except "Org Chart" and "Roster" overflowed measurably.

⚠️ **Checked whether this is systemic** — Resource Loading (`.rl-tab`) and Portfolio Overview
(`.po-tab`) share the identical `display:inline-flex; gap:6px` boilerplate, but their tabs carry a
real icon *and* their words happen to be short enough (4–6 tabs vs. 7, no 12-character unbreakable
words) that the same latent defect never manifests in practice — confirmed by measuring both at
375px: all negative overflow, safely inside their own tab. Left untouched; nothing to fix there today.

**Fix, phone-scoped, in this module's own `<style>`:** `.mp-tab { display:block; text-align:center;
overflow-wrap:break-word; word-break:break-word; }` at ≤700px. `display:block` removes the competing
flex-item `min-width:auto` (this button has no icon child, so nothing else depends on the inline-flex
layout), and `overflow-wrap`/`word-break` let a single long word actually break mid-word so it can
wrap within a ~44px column — the shared rule's `white-space:normal` alone cannot do that for text
with no spaces to break on.

**Verified:** every tab's text now measures comfortably inside its own button box (all overflow
values negative, was up to +14px). Screenshot confirms clean multi-line wrapping with no overlap.
Full regression sweep at both 375px and 1440px: 0 console errors, 0 page overflow, both unchanged
from before the fix except the tab strip itself.

⚠️ **Not verified signed in** — pure CSS specificity/layout fix, independent of any data, found and
fixed under a mocked backend; applies identically to a real session.

The HRD "Manpower Report" as a live module: what positions a project needs, how many heads of each
are planned / approved / forecast / actually deployed each month, who is filling them, and — across
every project the user can open — which job is most short.

## What it is
Four tabs:

| Tab | What it does |
|---|---|
| **Loading** | The HRD Manpower Curve: planned + actual as columns, the approved (B1) and forecast revisions as lines over the top, a cut-off month band, KPIs, and the editable Planned/Approved/Forecast/Actual matrix below it. A **Cost** mode redraws the chart as accumulated cost. |
| **Positions** | The requirement register — code, title, workforce, department, rank, cost per head-month, requirement vs actual vs filled, peak. |
| **Roster** | The employee masterlist: who fills which position, contract dates, TBH slots, and the **demobilisation summary** by contract-end month. |
| **Portfolio** | One month, every project the user can open, **ranked by how short of its own requirement it is** — the reason the module exists above project level. |

## Tables
`manpower_positions` (the requirement) · `manpower_loading` (one row per position per month, four
series) · `manpower_roster` (the people) · `manpower_months` (one row per project-month: the phase
label + the four typed costs).

Migration, to be run in the Supabase SQL editor:
`migrations/2026-08-27-manpower-loading.sql` — the four tables, indexes, RLS, touch triggers.

## Design notes
- **The month axis is the project schedule's**, not typed here — earliest activity start to latest
  finish, WBS-Summary rows excluded (they carry stale imported dates; one was 337 days out, which
  would stretch the axis by a year). Same rule and the same two indexed reads as Equipment Loading.
  The note under the controls always says which source the axis came from.
- ⚠️ **FOUR quantity columns on one row, not four rows with a `series` column.** The sheet's own
  bands are Planned / Revised / Proposed / Actual for the same (position, month), every reader wants
  all four together, and the unique index that stops two browsers double-inserting a month has to be
  on (position, month) — with a series column that index stops preventing the thing it exists for.
- ⚠️ **The governing requirement is `approved ?? planned`, computed PER POSITION and only then
  summed.** Summing the two series separately and picking one under-reports every project that is
  mid-revision, which is most of them. Asserted with a mixed fixture (one line revised to 8, one
  still on its original 5 → 13, not 10 and not 16).
- ⚠️ **Forecast never governs.** It is the "for approval" column; reporting an unapproved number as
  the requirement is how a project reads fully staffed against a plan nobody signed.
- ⚠️ **An approved ZERO is a real revision, not a missing value** — `govOf` tests for null, never
  falsiness, so a line revised down to nobody reads as 0 rather than falling back to the old plan.
- ⚠️ **Actuals after the cut-off month are blank, not zero.** "Not reported" and "nobody deployed"
  are different facts; drawing them the same makes every future month a shortfall. They are also
  excluded from the chart's y-scale, or one stray future entry rescales the whole curve.
- ⚠️ **Costs are PROJECT-MONTH, not per position.** They come off payroll, which is issued for the
  project as a whole and never equals rate × headcount (overtime, allowances, separation pay). A
  per-position cost column would force the module to invent a split nobody has. Rate × headcount is
  derived when a month has no typed figure, and **the screen says which of the two it is showing**.
- ⚠️ **A typed cost cannot be narrowed by a filter.** It is a project-wide payroll total, so while a
  department or workforce filter is on, the derived figure is used instead — showing project payroll
  against one department's headcount is exactly the number that ends up in a report.
- ⚠️ **Chart: bars for planned and actual, LINES for approved and forecast.** That is how the source
  sheet reads it, and the only arrangement in which four series fit a 48px month column without one
  hiding another. Cost mode plots **accumulated** cost (the sheet's own "ACCM." rows) — a monthly
  cost and a headcount on one axis are two different quantities sharing a scale.
- ⚠️ **The chart's left pad IS the matrix's two label columns and its bar pitch IS the matrix's month
  cell** (190 + 96, 48). The three numbers are duplicated in the CSS and cannot be read back at
  render time — the table may not be laid out on the first paint. Change one, change the other.
  Measured: **0px** offset on all 18 months, in both department and position mode, at 900 / 1280 /
  1440, and still 0px with both boxes scrolled in step.
- ⚠️ **`table-layout:fixed` and no `min-width:100%`.** With auto layout the browser widens every
  column to fill the pane and the chart lines up with nothing — measured on the equipment matrix as
  211/118 against a declared 150/84.
- ⚠️ **Department order is the org chart's, not the alphabet's.** OFFICE outranks HR; an invented
  department sorts after every seeded one. Sorting alphabetically puts HR above the Project Manager
  on every printout.
- ⚠️ **TBH is a vacancy, not a person.** The masterlist really does carry `TBH` / `TBA` / `Vacant`
  rows, and counting them as filled is how a project reports itself fully staffed. A roster entry
  also only counts inside its own contract window.
- ⚠️ **No roster at all reports vacancies as UNKNOWN, never zero.** A project that has not typed one
  has an unknown number of vacancies.
- ⚠️ **A roster row with no contract end is "open-ended" and is never folded into a demob month.** A
  blank end date is an unanswered question; putting it in the last month invents a demobilisation.
- ⚠️ **Position code is unique per PROJECT, case-insensitively; the TITLE is free to repeat.** A
  project legitimately has five rows called "Field Engineer". The clash is checked in the UI as well
  as by the index, because the index answers with a raw PostgREST error and "FE-01 is already used
  by …" is the only version a planner can act on.
- ⚠️ **The seed allocates codes against a list that GROWS as the batch is built.** "Safety Advisor"
  and "Survey Aide" are both SA; without that they would both be handed SA-01 and the unique index
  would refuse the insert with a constraint error for a button nobody typed into.
- ⚠️ **The skilled-worker seed is PROVISIONAL and the dialog says so.** The reference report for
  skilled workers has not been supplied yet, so those trades are taken from the staff report's own
  demobilisation summary (carpenter, foreman, steelman, painter, sealant applicator, tilesetter, site
  driver) plus the usual rest of a building job. Replace `SKILLED_SEED` when the real list arrives.
- ⚠️ **The Portfolio tab is NOT read on the way in.** It is the only view that queries every project
  the user can open; firing that on a tab click is a cost nobody asked for. The button says so.
- ⚠️ **Two reads for the whole portfolio, chunked at 100 ids.** The id list travels in the URL, so a
  portfolio of several hundred projects builds a request long enough for a proxy to refuse — which
  fails as an opaque network error, not as a message anyone can act on.
- ⚠️ **A project with no plan for the month is listed separately, never as 0% filled.** "No manpower
  plan this month" and "planned nobody" are different facts, and ranking the first as most critical
  buries the projects that really are short. A project that has not reported an actual sorts after
  the ones that have — an unknown is not a crisis.
- ⚠️ **A missing column is tolerated on write, nothing else is.** PostgREST answers an unmigrated
  column with PGRST204 and rejects the whole row — which on the equipment module lost every field a
  planner had just typed. `tolerantWrite` drops the named column, retries, and reports what was not
  stored plus the file to run; a constraint violation or an RLS refusal still fails loudly.
- ⚠️ **The import is round-trip only, and says so.** It reads the sheet THIS module exports, not the
  HRD workbook — that one carries a merged header block and a year band above the month row, and a
  reader that guessed at them would import headcount into the wrong months without ever failing.
  Rows are matched on **code first**, then department + title: a title gets re-typed ("QA/QC Engineer"
  vs "QAQC Engineer") and matching on it alone silently creates a duplicate position line. Derived
  rows in the export (department totals, OVERALL, COST) are never imported back.

## 2026-08-28 (d) — Portfolio: a cross-project curve, and a people Gantt that says who comes free

Owner: *"For portfolio I also want a curve showing planned vs actual across different projects to
show the manpower. There should also be a filter showing the gantt duration of the employee where
they can be assigned to another project depending on the planned of the selected projects."*
**No migration** — every column this needs already exists.

The Portfolio tab gains a **This month / Curve / People** switch. The snapshot table is untouched;
the two new views answer the questions the single-month table could not.

**Curve** — requirement (grey), under contract (blue dashed) and actual deployed (red) summed across
every readable project, over a month axis that is the **union of the loading months AND every
contract span**. A per-project table sits beneath it (requirement / under contract / deployed /
shortfall).

**People** — a gap strip (uncovered head-months per project per month) above a Gantt of every named
person: their contract bar, then an **available band** from the month after it ends, so "who can move
to another project, and when" is read off the picture. Filters: coming free within 3 / 6 / 12 months,
already off contract, plus a search over person, position and project name.

### The rules, each because the other way is wrong
- ⚠️ **The gap is requirement MINUS CONTRACTED, never minus actual.** Actual is what was deployed last
  month; the question here is what is *committed* going forward, and a person under contract but not
  yet mobilised is covered. Measuring against actual would report a shortfall for every future month
  of every project, which is not a shortfall, it is the future.
- ⚠️ **An open-ended contract is excluded from every "coming free" filter and given NO release month.**
  A blank end date is an unanswered question; treating the axis end as a release date would advertise
  a person as available on a date nobody agreed. They are still counted as covering their months, and
  the note says how many there are, so the omission is visible rather than silent.
- ⚠️ **TBH never appears in the people Gantt.** It is an unfilled requirement, which is exactly what
  the gap strip above it already reports — listing it as a person would double-count the vacancy and
  offer a placeholder for reassignment.
- ⚠️ **`byProject` is SPARSE by design** — a cell exists only where there is loading or a contract. A
  dense map over a multi-year union axis for twenty projects is tens of thousands of objects to carry
  a mostly-empty grid. Every consumer guards, and the contract is stated at the code.
- ⚠️ **The requirement is resolved PER POSITION (`approved ?? planned`) and only then summed**, the
  same rule as inside a project — the aggregate must not be able to disagree with the project screen
  it rolls up.
- ⚠️ **The actual line stops at `reportedThrough`** and the chart says so. Summing whatever actuals
  happen to exist makes the line dip in recent months simply because fewer projects have filed yet —
  a decline that is not happening, on the chart most likely to be shown to management.

### ⚠️ A real defect the two-project browser run found, which no single-project test could

`reportedThrough` is the earliest cut-off among contributing projects. Its fallback for a project with
**no declared data date** was **today** — which asserts that project has reported everything up to
now. That is the opposite of conservative: it let the summed line run a month past what a project had
actually filed, **reintroducing the exact dip the figure exists to prevent**.

Measured in the browser as the last plotted point of the actual line falling below its neighbour
(`prevY 144.9 → lastY 165.8`; higher y is a lower value). The fallback is now that project's **own
latest reported month**, and a project with neither a data date nor a single actual is **excluded from
the minimum** rather than dragging it to the start of time and erasing the line for everybody else.
After: 14 points stopping at Feb 2026, and the last point **rises** (`153.9 → 144.9`).

⚠️ **This is the class of defect a one-project fixture cannot express at all** — the whole rule is
about disagreement *between* projects.

### ⚠️ The suite was reading a stale snapshot and passing

`suite.js` sliced its functions out of `mp.js`, a copy of the module's inline script taken beside it.
The fix above landed in `index.html` and **the suite went on testing the old code and reporting
green** — it only surfaced because the new assertion failed against a value the fixed code cannot
produce. The snapshot is deleted; `slice.js` gained `extractInline()` and the suite now pulls the
inline `<script>` out of the **shipped `index.html` on every run**, so it cannot go stale again.

## Verified
**174 checks** (131 → 174) executing the shipped functions, now extracted from `index.html` itself.
The four new `reportedThrough` assertions **fail against the pre-fix code** (they returned Apr 2026
where the fix returns Feb 2026), so the section bites.

**Driven end to end in a real browser against a TWO-project fixture** (the first harness here that
has one), with only the shared app scripts stubbed and the stub honouring `.eq` / `.in`:
- 0 console errors; the three portfolio views switch correctly (`snapshot`/`curve` `display:none`,
  `people` block).
- Curve: 3 series, requirement and contracted 18 points each, actual 14 stopping at the cut-off, and
  the note naming **Feb 2026** as the earliest cut-off.
- People Gantt: 18-month axis **identical to the gap strip's, max column offset 0px**; Bravo, B's
  contract Jul 2025–Jun 2026 renders exactly 12 bars at indices 6–17 with a start cap; Bravo, A's
  7-month contract renders 6–12 with an end cap, then an `available` band 13–17; the open-ended person
  correctly gets no available band; the cut-off month carries `mp-now`.
- Filters narrow monotonically 15 → 12 → 12 → 8 → 1, and the **3 open-ended people never appear in
  any coming-free window** (no filter reaches past 12 of 15). Search "bravo" returns that project's
  group plus its three people.
- Contrast on the new surfaces: **min 6.43** across both themes (light 6.43–14.82, dark 7.02–14.85).
- Phone at 375px: media query matched, **0 page horizontal scroll**, **0 controls under 44px**, the
  Gantt scrolling inside its own 353px wrap and the curve holding its 862px minimum inside a 321px
  card rather than shrinking its labels.

**0 functions lost, 13 added**; 0 NUL bytes; the inline block parses.

## NOT verified
⚠️ **Not verified signed in.** The portfolio's real cross-project query has never hit PostgREST with
these two views on screen; the browser run is against a stub, and `reportedThrough` in particular
depends on `ps_datadate_<pid>` keys that only the Project Schedule module writes.
⚠️ **No screenshot** — every visual claim above is measured DOM/SVG geometry.
⚠️ The fixture's second project is synthetic; no real multi-project portfolio has been read.

## 2026-08-28 — A manpower profile, and its contract duration drives the months

Owner: *"Does this follow similar to the equipment loading by adding an equipment. But this time it
will add a profile of a manpower. The manpower profile should consider its contract duration."*

⚠️ **It did not, and the gap was total.** `contract_start` / `contract_end` were stored and displayed
but read by exactly one thing — `filledCount`, the vacancy readout. They did not touch the loading
grid, so Equipment Loading's whole point (an item's schedule link **deriving** its monthly
quantities) had no manpower equivalent. The months were typed by hand beside a roster that already
knew the answer.

**A profile is now the module's primary object.** "+ Add manpower" opens it from every tab; a
position (the requirement) is added from the Positions tab, which now says in one line how the two
differ. The form leads with a **Contract duration** section carrying a live readout that names what
the profile will contribute before anything is saved — *"12 months · Jan 2026 – Dec 2026 · Adds 1
head to Field Engineer for each of those months"* — plus a **months → end date** helper.

**The derivation** (topbar button → dialog) writes those months into `manpower_loading`.
⚠️ **Written, not computed at render time** — the chart, grid, export, portfolio and dashboard tile
all read that one table, and a second invisible source of headcount would make them disagree the
moment anything read it directly. Same call the equipment sync made.

### The rules, each because the other way is wrong
- ⚠️ **Actual stops at the cut-off, whatever the contract says.** A contract running to December does
  not report December's deployment. Forward series (Planned / Approved / Forecast) fill the whole
  span — the dialog states which it is doing and why.
- ⚠️ **An open-ended contract is skipped for a forward series, never run to the schedule's end.** "No
  end date recorded" is an unanswered question; projecting it invents a commitment. It still counts
  toward Actual up to the cut-off, where it is a fact.
- ⚠️ **TBH is excluded from every series**, not just Actual. Nobody is deployed against an unfilled
  slot, and adding it to a planned series would double-count it against the requirement the planner
  already typed. It drives the vacancy figure instead.
- ⚠️ **One profile is one head, whatever `allocation` says.** `SHARED` records that a person works
  across projects but records no fraction; turning that into 0.5 would invent precision nobody
  entered. An `fte` column is the honest fix and is deliberately not guessed at here.
- ⚠️ **A hand-typed month survives.** The derivation overwrites only a cell it already owns or an
  empty one. Ownership is `source = 'roster:<series>'`; editing that cell hands it to `'hand'` and it
  is never touched again. ⚠️ **Editing a DIFFERENT column must not release ownership** — `source` is
  per row and a row can carry a derived actual beside a hand-typed plan, so `setQty` only downgrades
  when the edited column is the owned one.
- ⚠️ **Take-over is an explicit tick, off by default, with the count printed on it.** It is the one
  setting that can destroy entered data. Found because the derive on a project that already has typed
  actuals correctly does *nothing* and says so — safe, but a dead end without a way through.
- ⚠️ **Switching series MOVES the derivation** rather than leaving two: the release pass and the write
  pass merge into one payload per month, so an upsert can never touch a row twice (which Postgres
  refuses outright).
- ⚠️ **Months outside the schedule's axis are written, not clipped.** The axis is the programme's, the
  contract is HR's; a contract reaching past it means the two disagree, and dropping those months
  hides exactly that. The count is reported.
- ⚠️ **The drift banner is read-only and never re-derives by itself** — a derivation that fired on its
  own would overwrite a grid someone is part-way through explaining.
- ⚠️ **Re-derives automatically only once a derivation exists.** The first one has to be the planner's
  explicit act; silently filling the grid the first time somebody adds a person would be a surprise.
- ⚠️ **One upsert per 400 months, not one write per month** — 27 positions × 18 months is 486
  sequential requests otherwise. Keyed on the `(position_id, period)` unique index.
- **No migration**: `contract_start`, `contract_end`, `position_id` and `source` already existed.

### 2026-08-28 (live) — Signed-in verification on the QADEMO sandbox; the upsert is real

Closes the standing caveat. Driven through the **deployed** site in the owner's own signed-in Chrome
(super_admin), against **QADEMO — QA Demo (sandbox)**, which held **0 positions / 0 loading / 0 roster**
before and after. ⚠️ **No live project was written to**; the whole-database count was 0 rows across all
three tables both before and after, so nothing anywhere else was touched.

**The migration is confirmed applied** — all three tables readable through PostgREST under normal RLS,
and the module loads with **no "needs its tables" banner**.

**What was exercised end to end, through the module's own UI:**
- A position saved with its auto-proposed code (**FE-01**) and every field persisted, `monthly_rate`
  included.
- Three profiles saved with contract durations, the live readout correct in all three states against
  real data — a 3-month span, an open-ended one, and a TBH.
- ⚠️ **THE UPSERT, which was the one thing a stub could not prove.** Contracts Aug–Oct and Sep–open,
  cut-off Sep: derived **Aug = 1, Sep = 2**, October (past the cut-off) correctly **not written**, TBH
  excluded and reported, `source = 'roster:actual'`. Exactly the predicted rows.
- ⚠️ **Idempotent against the real unique index** — three consecutive derives, row count **2 → 2 → 2**,
  so `onConflict: 'position_id,period'` updates rather than duplicating. This is the specific failure
  the harness could not rule out.
- **Ownership:** hand-editing the derived August cell wrote `source='hand'` **in the database**, dropped
  the derived marker, and the next derive reported *"1 hand-typed month(s) left untouched"* and left it
  at 7.
- **Automatic re-derive:** shortening a contract through the roster form took September **2 → 1** on its
  own, while the hand-held August stayed at 7 — and the drift banner correctly stayed hidden, because
  the auto re-derive had already resolved it.
- **Portfolio** read all **20 projects** live through the chunked `.in()`.

⚠️ **One real defect found, and only a live run could have surfaced it.** A project with positions and a
reported actual but no requirement read *"1 position line(s) exist, but no quantity is recorded for this
month."* A quantity **is** recorded — it is the **requirement** that is missing, and the wording sends a
planner looking for the wrong thing. Now three distinct messages: no positions at all · positions and
N deployed but no requirement to measure against · positions but nothing recorded. ⚠️ **The copy fix
itself is not live-verified** — it shipped after the sandbox was cleaned up.

⚠️ **Not exercised live:** the take-over tick (nothing hand-typed existed on a fresh sandbox to take
over), the months-outside-the-axis path, the Excel import, and the seed. All are covered by the suite,
none by a live write.

⚠️ **Screenshots were impossible** — `Page.captureScreenshot` timed out on every attempt, so every claim
above is a DOM/database read rather than a picture.

## Verified
**131 checks** (91 → 131) executing the shipped functions, sliced by brace-matching. ⚠️ **The suite
cannot load against the pre-change file at all** — it throws on the first missing symbol — so the
whole section is genuinely new behaviour rather than a restatement.

**Driven end to end in a browser** against the shipped page: 160 months derived, KPIs moving 31 → 19
as the roster takes over, all 160 cells marked in by-position mode (and correctly unmarked in the
by-department roll-up, where a per-cell marker would be meaningless); a hand edit taking its cell over
(text `9`, marker gone, 160 → 159) and the next derive reporting it as kept and leaving it; shortening
a contract raising the drift banner at 7 months and the re-derive taking that position 15 → 8; the
form's readout correct in all four states with 12 months from 1 Jan ending **31 Dec** (the inclusive
off-by-one that would otherwise add a month of headcount to every profile). Chart↔matrix alignment
still **0px** in both modes and after deriving; no console errors; new surfaces min **7.02 dark /
7.07 light**; at 375px every new control 44px with no page scroll. **0 functions lost, 17 added.**

⚠️ **A real staleness bug found by testing, not reading:** `setQty` wrote the new `source` to the
database but not to the in-memory row, so after a hand correction the cell kept its derived marker and
the next derive still counted it as owned — silently overwriting the correction until a reload.

⚠️ **Two harness artefacts, both of the hidden-tab family already recorded in this repo:** `blur()`
does not fire `onblur` in a non-focused tab, so the first edit test read as "nothing happened" when
the commit simply never ran (call `onblur` directly); and the stub needed a real mutating `upsert`,
or the test would have proved the *plan* was right without proving the button changes anything.

⚠️ **Still not verified signed in.** The upsert in particular has never hit PostgREST — it is the one
thing here most worth a live check, since `onConflict` behaviour is the server's, not the stub's.

## Verified
**91 checks executing the SHIPPED functions**, sliced out of `index.html` by brace-matching and never
reimplemented (`suite.js` + `slice.js` in the session scratchpad): the governing rule incl. the
approved-zero and forecast-never-governs cases, `aggregate`'s per-position governing on a mixed
fixture, a rate-less line contributing headcount but no cost, all three filters, typed-vs-derived
cost and the filter forcing derived, the TBH vocabulary and the contract-window bounds, surplus not
becoming a negative vacancy, no-roster reporting null, the seed's code collisions, org-chart ordering,
and the 27 staff positions matching the reference report.

**Driven end to end in a real browser** against the shipped HTML, CSS and inline script with only the
shared app scripts stubbed (`AppAuth` / `PDb` / `UI` / `Fmt` / `Icons`), the stub honouring `.eq` and
`.in` so the portfolio's month filter is actually exercised: renders with **0 console errors**;
chart↔matrix **0px** on all 18 months in both modes; 45 future actual cells all blank while past ones
are populated; cell edit opens, commits, and Escape restores; both scroll directions sync (each
verified from a fresh guard — `requestAnimationFrame` never fires in a hidden tab, so the guard cannot
clear and the second direction reads as broken); sticky label columns pinned at 0 and 190; register
and roster header/body cells aligned 10/10 and 9/9; demob grouped with open-ended entries named; and
the **portfolio's independent bulk read agrees exactly with the project tab's own aggregate**
(53 / 31 / −22 / 58%), which is two separate code paths reaching the same number.

**Contrast:** two real failures found and fixed — the Skilled badge at **2.98:1** and Filled at
**2.86:1** in dark mode (the dark rules restated the tint but not the ink), and the vacancy badge at
**3.60:1** in light mode, which is the exact figure the equipment module's picked-icon button was
fixed for. `var(--pd-red)` on `var(--pd-red-light)` is not a text pairing at 11px. After: **min 4.50
light / 6.73 dark** across all four badge kinds.

**Phone (375px):** row actions measured **20px**, segments 30px and tabs 33px — the shared CSS raises
`.pd-btn` and inputs to 44px but knows nothing about these three. All at 44px now, 0 page horizontal
scroll, KPIs at 2 columns, chart and matrix scrolling inside their own cards.

## NOT verified
⚠️ **Nothing has been exercised signed in** — the anon key has no grants on these tables, so every
write (the seed, the matrix edits, the roster, the import) ran against a stub rather than PostgREST,
and the portfolio's real `.in()` + `.eq('period')` query has never hit the server.
⚠️ **The migration has not been run.** Until it is, the module shows its "needs its tables" banner.
⚠️ **No screenshot** — the Browser pane was not compositing this session, so every visual claim above
is measured DOM geometry rather than a rendered image.
⚠️ **The skilled-worker reference file has not been supplied**, so `SKILLED_SEED` is provisional and
no real skilled-worker report has been reproduced.

## Cache
No `MODULE_V` bump: this module page is new, so no browser holds a stale copy of it. `config.js` —
which is what gates the tile appearing at all — was bumped app-wide to `?v=20260828b`.

## 2026-08-31 — Table of Organization, Mobilization dashboard, five categories, schedule/location
## tagging, the Activities×Subcontractor matrix, vertical stacking, and manhours

Owner's own list, verbatim:
1. A table of organization (planned vs actual), connected to the loading and steppable month by month.
2. A mobilization/demobilization dashboard, with contract-end alerts.
3. Five categories: Shared Staff, Project Staff, Skilled Admin, Skilled Self-Performed, Subcontractors.
4. Skilled Self-Performed and Subcontractors can be tagged to a schedule activity, with a location.
5. A matrix of activities to subcontractors.
6. Vertical stacking of subcontractors per activity.
7. Manhours, per subcontractor or per person.

**Run `migrations/2026-08-31-manpower-org-schedule-manhours.sql`** (after the 2026-08-27 one — it
only ADDS columns/a table to what that migration created). Two new tabs (**Org Chart**,
**Mobilization**), a third (**Activities**), and a persistent module-wide alert banner. Detail
below; the module's per-file design notes (§"Design notes" above) are unchanged and still hold.

### 1 — Table of Organization
New **Org Chart** tab: a month stepper (‹ / › / a `type=month` input / "Cut-off") plus a
**Planned vs Actual / Actual only** toggle, over a box tree read straight off `manpower_positions`
+ `manpower_loading` — no new aggregation, it calls the same `govOf`/`qtyOf` the Loading grid uses,
so the two views cannot disagree about a month's figures.

⚠️ **`reports_to_id` (new, self-referencing, optional) drives a real reporting-line tree — and
falls back to DEPARTMENT grouping the instant no position on the project has ever set it.** A
project that has never touched the field gets a usable chart on day one; setting it on enough
positions upgrades the view to a genuine org chart with no schema change and no migration to
"turn it on". Set from the position Add/Edit form's new **Reports to** field.

⚠️ **Cycle-guarded, not merely trusting the data.** `reports_to_id` carries no DB constraint
against a loop (Postgres has no easy "no cycles in this self-reference" check), so a manual
mis-edit (A reports to B, B reports to A) must degrade rather than hang the render. `orgHasCycle`
walks a position's own chain with a seen-set and a 200-iteration guard; any position on a detected
cycle renders as an unlinked root instead of vanishing or looping the tree builder forever.

⚠️ **A box's colour needs BOTH figures, and treats a missing one as unknown, not zero.** `req==null
|| act==null → no colour`. The trap this avoids: `null / positiveNumber` is `0` in JavaScript, so a
naive fill-rate calc on an unreported month would have painted it exactly like a genuine 0%
shortfall — "nobody has filed this month yet" and "this month has nobody deployed" are different
facts, and conflating them is precisely the failure this module's Portfolio tab was already fixed
for once (the `reportedThrough` bug, 2026-08-28d).

### 2 — Mobilization / Demobilization dashboard
New **Mobilization** tab: KPIs (mobilizing this month / demobilizing this month / ending within
30·60·90 days), and two grouped tables — heads coming ON contract (`contract_start`) and heads
coming OFF (`contract_end`) — reusing the exact grouping shape the Roster tab's existing demob
summary already had, now applied to both directions.

⚠️ **Alerts are measured against TODAY, deliberately not the schedule's cut-off date.** A contract
does not pause expiring because a planner has not refreshed the data date recently; anchoring the
alert to a possibly-stale `CUTOFF` would silently under- or over-report urgency depending on how
long ago the schedule was last touched.

⚠️ **A PERSISTENT, module-wide banner** (`#mp-mobbanner`, styled like the existing drift banner) —
rendered from `renderAll()` on every pass, so it shows regardless of which tab is open. An alert
that only appears on the Mobilization tab is one nobody sees until they go looking for the thing
it exists to warn about in the first place. Names up to 4 people + their end dates, with a "+N
more" and a link that jumps straight to the Mobilization tab.

### 3 — Five categories
`WORKFORCES` widened from `['Staff','Skilled']` to `['Shared Staff','Project Staff','Skilled Admin',
'Skilled Self-Performed','Subcontractors']`. ⚠️ **Widened, not migrated** — `workforce` is a plain
text column with no CHECK constraint, so an old `'Staff'`/`'Skilled'` row on a project created
before this pass simply reads as an unrecognised category and sorts after every seeded one, the
exact rule an invented department already followed. One shared `workBadge()`/`workBadgeCls()`
renderer replaces three independent inline `p.workforce === 'Skilled' ? …` conditionals (matrix
rows, Positions register, Roster table) that would otherwise have to be found and fixed three
times to stay in step; Subcontractors gets its own badge colour (purple), distinct from the
skilled-trade blue.

⚠️ **`TAGGABLE_WORK = ['Skilled Self-Performed', 'Subcontractors']`, and it is a SHORTER list than
"skilled".** Skilled Admin is skilled labour on the company's own payroll, not deployed against a
specific site activity the way self-performed trades and subcontracted crews are — tagging it to a
schedule activity would invent a fact nobody has. The seed dialog now seeds **Project Staff** and
**Skilled Self-Performed** only (renamed from Staff/Skilled); Shared Staff, Skilled Admin and
Subcontractors have no standard headcount to propose and are added by hand, and the dialog says so.

⚠️ Portfolio's snapshot table dropped its hardcoded Staff/Skilled two-column split (`r.staff`/
`r.skilled`) for a dynamic `byCat` map keyed by the workforce string itself — a fixed pair would
have silently merged three of the five categories into whichever bucket the old code happened to
sort them.

### 4 — Schedule + location tagging (Skilled Self-Performed / Subcontractors only)
Reuses Equipment Loading's exact schedule-link shape (`link_mode`/`link_activity_id`/`link_wbs`/
`link_label`/`link_start`/`link_finish`/`link_synced_at`), added to `manpower_roster` instead of a
new table — a link belongs to the PROFILE (the specific crew/person), not the position (the
requirement line), since one position can be filled by several differently-located crews.
`location` (new jsonb) is the SAME shape `project_schedule.location` and Equipment Loading's site
plan already use — keyed by `location_levels.id` — reusing the existing `project_location_values`
RPC to populate each level's picker with real, counted values rather than free text.

⚠️ **A TAG, not a second source of derived months — stated three times in the code because it is
the decision most likely to be "improved" back into a bug.** `manpower_loading` is still driven
purely by the profile's own `contract_start`/`contract_end` (the 2026-08-28 derivation). Linking a
crew to an activity says WHERE they work, for the matrix and the stacking below; it never
recomputes a duration a second way that could disagree with the first.

⚠️ **Only offered when the SELECTED POSITION's category is taggable**, checked live as the
Position field changes (`taggableNow()`), not fixed at modal-open time — switching a profile's
position from Subcontractors to Project Staff mid-edit hides the section immediately, matching
what will actually be readable about that profile once saved.

⚠️ **The activity search reuses Equipment Loading's exact filter-punctuation stripping**
(`replace(/[,()*%\\]/g, ' ')`) before building the `.or()` string — an unstripped comma or paren in
a typed search term ends PostgREST's filter early and silently answers a different question than
the one asked, the documented equipment-module trap.

⚠️ **Resolved and cached right after Save**, mirroring Equipment's "sync on save" — `resolveRosterLink`
does the same two indexed, capped reads (`activity_id`/`wbs` × `project_id`, excluding WBS-Summary
rows) and stamps `link_start`/`link_finish`/`link_synced_at`. Nothing re-syncs automatically beyond
that single stamp; there is no periodic drift check here (unlike Equipment Loading) because the
link's only consumers — the matrix and the stacking view — read the CURRENT schedule live on
render, not the cached span, so staleness in the cache costs nothing but an out-of-date informational
number, never a wrong picture on either downstream view.

### 5 — Activities × Subcontractor matrix
New **Activities** tab, **Matrix** sub-view: rows are the distinct schedule tags carried by
taggable, linked profiles (one row per `link_mode + activity_id/wbs`, not one row per schedule
activity the module has separately enumerated); columns are the profiles themselves — a crew or
person IS a column, by construction, since two different subcontractors are two different answers
to "who is doing this". A cell shows a checkmark plus its recorded manhours total when both exist.

⚠️ **A row exists even for a link the module has never resolved against a live schedule** — the
cached `link_label` is enough to identify it in the matrix. "Nothing has tagged this activity" and
"the schedule query for this activity failed" are different facts; a row disappearing because a
network call failed would read as the tag itself having vanished.

### 6 — Vertical stacking of subcontractors per activity
New **Activities** tab, **Vertical Stacking** sub-view: pick a location level (e.g. Tower), a value
(e.g. Tower 3), and optionally one linked activity; bands render for the NEXT location level down
(typically Floor), one band per distinct value among the matching tagged profiles, coloured by
which profile (reusing the existing `deptColor` hash-palette function rather than inventing a
second one) — a legend lists every profile shown.

⚠️ **Deliberately a SIMPLIFICATION of the schedule module's own vertical stacking, not a port of
it.** Project Schedule's stacking ranks floors structurally (basements negative, ground zero, roof
last) by walking the WBS/level tree; this module has no such tree to derive rank from, only
whatever text a roster entry's `location` value carries. `naturalCmp`/`naturalRank` order by
leading digit ("9th Floor" before "10th Floor" — plain alphabetical sort gets this wrong, asserted
in the test) and put anything with no leading number after every numbered value, alphabetically
among itself. Documented in the code as a simplification, not silently passed off as the real thing.

⚠️ **A location level with no level below it degrades to a flat list, never an invented single
band.** Stacking requires two levels (the grouping axis and the thing stacked); a project with only
one level has nothing to stack, and the view says so rather than drawing one wide meaningless band.

### 7 — Manhours per subcontractor or per person
New `manpower_manhours` (one row per **roster entry** per month — profile-level, matching the ask
"per subcon or per person" exactly, as distinct from `manpower_loading`'s position-level headcount).
Entered from a mini-table inside an EXISTING profile's Edit form (`.mp-mon-tbl`, the same style the
Positions tab's own per-position month editor already uses), saved as part of that same Save click
— only the cells that actually changed are written, matching `openMonths`' own diff rule (saving
every month would touch `updated_at` on rows nobody edited).

⚠️ **Manhours are offered on EXISTING profiles only** (`r` truthy) — `manpower_manhours.roster_id`
is `not null references manpower_roster`, so there is nowhere to attach an hours row until the
profile itself has been saved and has an id. A brand-new profile: save it once, then re-open Edit
to record hours.

⚠️ **`mhTotal` returns `null`, never `0`, when nothing has been recorded** — "no hours logged yet"
and "logged zero hours" are different facts, the same rule this module already applies to vacancy
counts and unreported actuals everywhere else. Surfaced in three places that all read the one
table: a new **Manhours** column on the Roster table, the matrix cell in item 5, and the mini-table
itself — one number, three views, cannot disagree.

⚠️ **The month range offered is fixed to the profile's SAVED contract dates at modal-open time** —
it does not track live edits to the contract-start/end fields in the same sitting. Widening a
contract and typing hours into the newly-widened months in one edit is not supported; re-opening
Edit after Save picks up the new range. Documented in the code rather than silently accepted.

### Migration-degradation, extended
`missingColumn`'s error message names a column but not which of the two migrations it came from —
so a dropped `reports_to_id`/`link_mode`/`location`/etc. now resolves through a small `MP2_COLS`
lookup to the CORRECT file (`migrationFor(col)`), rather than pointing a planner at the original
2026-08-27 migration (already applied, would change nothing). The banner and the toast both list
every distinct file actually implicated, not just one. ⚠️ Table-level absence (`manpower_manhours`
not existing at all) is **not** caught by this same tolerant-write path — that failure mode is a
different PostgREST error shape (missing relation, not missing column) and surfaces as a loud,
un-friendly error toast rather than a named-migration message. Accepted rather than built out
further: it still fails LOUDLY (no silent data loss), just without the polish the column-level case
gets.

### Verified
**42 checks** executing functions sliced VERBATIM out of the shipped `index.html` (brace-matched,
never reimplemented) — `naturalRank`/`naturalCmp` including the case proving plain
`String.localeCompare` gets "9th Floor" vs "10th Floor" backwards; `daysUntil` at 0/+10/-5 days;
`orgSeverity`'s full colour matrix, explicitly including the `req!=null, act==null` trap that
naive JS division would have silently painted as a 0% crisis; `isTaggable`/`workBadgeCls` across
all five categories; `orgHasCycle` on a 2-node A↔B cycle (from both sides), a self-reference, a
normal chain, and a timing assertion that it returns promptly rather than hanging; `linkKey`;
`mhTotal`'s null-vs-zero handling. **0 functions lost** against the pre-change file (44 added);
inline script parses; 0 duplicate DOM ids; 0 NUL bytes; CSS braces balanced; every
`getElementById` target resolves in the markup.

### NOT verified
⚠️ **Nothing here has been exercised signed in.** The anon key has no grants in this environment,
so every write path (positions with `reports_to_id`, the roster form's Schedule & Location section,
the activity/WBS search against real `project_schedule` rows, the `project_location_values` RPC,
manhours upserts) is verified only as sliced pure logic, never against real PostgREST.
⚠️ **The migration has not been run.** Until it is, the new columns/table are silently dropped by
`tolerantWrite` on save and the module names the file to run.
⚠️ **No screenshot** — every visual claim above is a structural/markup check, not a rendered image.
⚠️ The vertical-stacking natural-sort simplification (documented above) has not been checked
against a real project's actual floor-naming conventions — only against the synthetic
"1st/2nd/9th/10th Floor/Roof Deck" style fixture the unit test uses.
