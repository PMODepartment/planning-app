# Manpower Loading — module change log

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
