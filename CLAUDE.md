# Planners Dashboard — Main App Change Log

This file tracks the **main app** (shell) work, maintained by the Planning team
owner. Each module keeps its own `modules/<key>/CLAUDE.md`. One entry per prompt.

> ### ⚠️ How to add an entry, and the merge trap
> **Prepend your entry directly under `## Changelog`.** Older entries live in
> [`docs/changelog/`](docs/changelog/), one file per month, verbatim.
>
> ⚠️⚠️ **When this file conflicts on a merge or rebase, take ONLY the new entries from each
> side — never both copies of the whole log.** On 2026-09-07 a merge resolution kept both
> full changelogs and took this file from **13,752 to 27,561 lines**: 491 entries duplicated,
> every one of them byte-identical to its twin. Nothing was lost that time and the duplicates
> were removed, but the shape of the mistake is invisible in a diff — a doubled changelog
> looks exactly like a large honest append. **Check the line count after resolving.**

---

## 👋 START HERE if you are building a module (read before writing code)

If you are a developer (or a developer's Claude) assigned ONE module, do this:

1. **Read [`MODULE_CONTRACT.md`](MODULE_CONTRACT.md)** — the rules: folder layout,
   required HTML boilerplate, the shared APIs you must use (`AppAuth`, `PDb`,
   `Fmt`, `UI`), database rules, and the definition of done. This is mandatory.
2. **Read [`CONTRIBUTING.md`](CONTRIBUTING.md)** — git workflow: work on branch
   `module/<your-key>`, edit ONLY your `modules/<your-key>/` folder, PR to `main`.
3. **Copy a reference module** as your starting point:
   - `modules/risk-register/` — plain CRUD + filters + KPIs + a derived field.
   - `modules/drawing-register/` — same, PLUS the **file-upload** pattern
     (private Supabase Storage bucket + signed-URL viewing). ⚠️ **RETIRED as a live
     module** (2026-08-19) — it and Material Submittal moved to the **Engineering
     App**, which is now the single source for both registers; they are
     `enabled:false` here and their tables are stale history. Still fine to copy
     the upload pattern from; do NOT resume writing to them, and do not point
     anything at their tables. The Project Schedule's Design Development branch
     reads the `eng_design_progress` mirror instead (Edge Function `sync-eng`) —
     see `modules/project-schedule/CLAUDE.md`.
   - `modules/_template/` — the minimal skeleton.
4. **Do NOT edit** shared files (`assets/**`, other modules, the HTML shell).
   The only shared edits allowed: add YOUR table to `supabase-schema.sql`, and
   flip YOUR module's `enabled: true` in `assets/js/config.js`.
5. **Keep `modules/<your-key>/CLAUDE.md` updated** each PR (what you built, any
   columns/buckets you added).

Supabase URL + anon key are already in `assets/js/config.js`. Ask the app owner
for a test login. The shell (login, roles, project picker context via the
`pd_project` sessionStorage key, branding) is already done — just build your
module's screens against the shared APIs.

## Project summary
Consolidated dashboard for construction Planning Engineers (Megawide). Replaces
an existing Power Apps tool. Seven Phase-1 modules, each built by a separate
developer, plug into one shared shell.

**Architecture decisions (locked 2026-06-18):**
- Stack: vanilla HTML/CSS/JS, no build step, GitHub Pages hosting
- Backend: one shared **new** Supabase project (Postgres + Auth + Storage)
- Integration: shared shell + documented contract (`MODULE_CONTRACT.md`), single repo
- Auth: shared Supabase Auth + roles across all modules
  (`super_admin > admin > planner > user > viewer`)

**Reference:** Procurement WPM app —
`C:\Users\fmlozano\...\Procurement Dashboard\wpm\CLAUDE.md`
(same vanilla + Supabase + GitHub Pages pattern; Phase 2 will integrate with it).

## Key files
| File | Purpose |
|---|---|
| `assets/js/config.js` | Supabase creds + `MODULES` registry (flip `enabled` per module; `icon` = icon **name**) |
| `assets/js/auth.js` | `AppAuth` — login, roles, `requireLogin/requireRole/requireAdmin`. Login lands on `projects.html` |
| `assets/js/db.js` | `PDb` (projects/users/**workspaces**) + `Fmt` formatters |
| `assets/js/ui.js` | `UI` — toasts, avatar/user menu, modal, collapsible sidebar (`initShell`) |
| `assets/js/icons.js` | `Icons.svg(name,size)` + `data-ico` auto-hydration — the pro line-icon set (replaces emoji) |
| `assets/js/theme.js` | Dark mode (`html.pd-dark`), sun/moon toggle, FOUC guard |
| `assets/css/dashboard.css` | Global styles + design tokens (`--pd-*`) |
| `projects.html` | **Project Selector** (entry point): Workspace→Program→Project tree + project list |
| `dashboard.html` | **Project Home** for the selected project (Project/Program/Workspace tabs + module grid) |
| `admin.html` | User approval/roles/project-assignment + project & workspace management |
| `supabase-schema.sql` / `supabase-setup.sql` | All shared + module tables, RLS, grants, helpers, bootstrap |
| `MODULE_CONTRACT.md` | Rules every module developer must follow |

## Roles
| Role | Notes |
|---|---|
| `super_admin` | full control, only role that can set super_admin |
| `admin` | manage users/projects, all modules |
| `planner` | auto-approve writer, assigned projects only (may create new projects) |
| `user` | assigned projects only |
| `viewer` | read-only |

`status`: `pending` → `approved`/`rejected`. New sign-ups land in `pending`.

---

## Changelog

### The vertical stacking's full-screen window plays itself, and says which week it is showing (2026-09-10) — ethanrobles10

Owner: *"For the vertical stacking full screen, allow a play button to see the progress over time,
and allow users to set the playback speed (daily, weekly, monthly, quarterly etc.). But can you also
include a legend of the number of timeline on the upper right (example: week 1, week 2, week 3
etc...)"*

Project Schedule → **Vertical Stacking → expand a tower** (the window with the Full screen button).
Its scrubber already walked the programme; you had to walk it by hand, a month at a time, and
nothing said how far into the job the picture was.

- **Play / pause**, plus a **Daily / Weekly / Monthly / Quarterly / Yearly** speed. The speed *is*
  the step, so it also re-labels the two step arrows — one dial, not a playback speed and an arrow
  size that could disagree. Play from Live starts at the beginning; the finish is a stop, not a
  loop; and touching the handle, the arrows, Live or a legend row stops the run.
- A **timeline legend** in the stage's top-right: five period rows, the current one lit with its
  date range, `Week 91 of 105` beneath, each row clickable to jump there. ⚠️ Every number counts
  from **this building's own start** — "Week 1" is the week this tower starts, not ISO week 1.
- ⚠️ Playback deliberately bypasses the drag scheduler, which *drops* coalesced frames: a film that
  dropped frames would skip the periods it was asked to show. Each frame repaints, measures itself,
  then schedules the next.

⚠️ **Not verified against real data** — the anon key has no grants. The period arithmetic, the
control wiring and the paint pacing were measured in a gitignored harness running the shipped code
slices; how a 2,500-activity tower feels under a daily run has not been seen.

`MODULE_V` → `20260910zd`. Detail:
[`modules/project-schedule/CLAUDE.md`](modules/project-schedule/CLAUDE.md).

### The manual sheet becomes a trades × months matrix, with the curve live above it (2026-09-10) — ethanrobles10

Owner: *"i was thinking, what if it were the other way around. meaning the months are plotted as
columns and the trades are plotted as rows. And then while inputting, there would still be an
scurve displayed above the table."*

⚠️⚠️ **This reverses the shape I argued for hours earlier, and the argument was incomplete rather
than wrong.** I refused a trades × months matrix because eight trades over three years is 288 cells
and, at three kinds per cell, **864**. That arithmetic holds; what I missed is that **the third
dimension does not have to be in the grid** — Planned / Actual / Forecast is a **mode** now, so the
sheet is 8 × 36 for one kind at a time. That is the shape of the spreadsheet a planner is copying
from, and it does something the per-trade sheet could not do at all: comparing two trades in the
same month was two screens there and is a glance here.

⚠️ **The column footer is the project's WEIGHTED figure, not the sum of the column** — adding six
trades' percentages gives a number over 100 that means nothing, since each is a share of a different
scope. Weighted, it is exactly the height of that month's bar on the chart above, so the footer is a
cross-check between the sheet and the curve. ⚠️ The matrix is always **monthly** whatever the Period
control says: the stored grain is a month, and typing a quarter would mean inventing its split.

**The curve above the sheet is live, and that required one change.** `computeManual` read the saved
rows, so a chart above the sheet would have sat still while the planner typed and jumped on Save;
`manEffective()` now lays the unsaved edits over the saved ones and *every* reader goes through it,
so the chart, the row totals and the footer all describe the sheet as it is on screen. It is the
**same `renderChart`** the Curve tab uses, pointed at a second host, with its note carrying
*"Includes N unsaved edits"* — a chart drawn from numbers the database does not hold must say so.
⚠️⚠️ And a cell edit deliberately does **not** re-render the sheet: rebuilding the table drops the
focus out of the cell being typed in. Measured — after an edit the table node is unchanged and
`document.activeElement` is still the cell.

⚠️⚠️ **A defect this found in what shipped this morning: the Curve tab drew NO chart in Manual
mode.** `renderChart`'s manual branch set the basis note and then **`return`ed before any drawing**,
so selecting Manual left the sentence explaining the curve above an empty plot. Nothing errored and
the note made it look as though something had happened — which is why a browser check missed it:
that check only ever ran the automatic mode. Confirmed present in `HEAD` before touching it.

**`PDGrid` (`assets/js/xlgrid.js`) is adopted rather than re-implemented** — the cells carry its
`data-i` / `data-f` contract, which buys Tab/Enter/arrows, Ctrl+D fill-down, Ctrl+Z and **a paste
straight out of Excel** (measured: a four-cell TSV paste filled four months). ⚠️ Loaded at the
version the other page already uses, not a second one. ⚠️⚠️ Wiring that paste exposed the
`type="number"` trap **for the third time in this repo**: a number input reads back `""` for `12,5`,
so the value vanished with no error. Fixed as the BOQ grid and the nine Contracts & Claims money
fields were — `type="text"` + `inputmode="decimal"` — and a comma is now **refused rather than
stripped**, because stripping turns the European `12,5` into 125, a guess about locale that produces
a plausible wrong number. Two refusals, two messages: unreadable and out-of-range are different
mistakes.

**85 assertions across three suites, 0 failing** (14 new; the earlier 37 and 34 re-run), and driven
in a real browser in light and dark: 5 trades × 24 months, typing moved the row total 0 → 25%, the
weighted footer 22.7 → 29.5% and the curve's first point with it; the frozen corner holds after a
600px scroll; an over-100 row total is flagged. ⚠️ Not verified signed in, and
`migrations/2026-09-10-scurve-manual-poc.sql` still has to be run.

`MODULE_V` → `20260910zc`. Detail: [`modules/s-curve/CLAUDE.md`](modules/s-curve/CLAUDE.md).

### The manual-POC migration could not run: `projects.id` is text, not uuid (2026-09-10) — ethanrobles10

Owner, running `migrations/2026-09-10-scurve-manual-poc.sql`: **`ERROR: 42804 … Key columns
"project_id" and "id" are of incompatible types: uuid and text.`**

⚠️⚠️ **`projects.id` is `text`** — it is the project CODE (`AVR101`, `OPW101`), not a surrogate
uuid (`supabase-schema.sql:33`), and **26 tables in this schema already declare `project_id text
references projects(id)`**. I wrote the type I expected instead of the one the schema has.
⚠️ The module’s own JS was already right — `pid` is that text code — so nothing in the module
changed, which is also why no check I ran could have caught it: every one was against the shipped
JS, and the SQL is only exercised by being run. ⚠️ Nothing was created by the failed run (the FK is
inline, so the statement fails atomically), so the corrected file is safe to run as-is.

⚠️⚠️ **And the GRANTS were missing — the same omission this log records for the stakeholder-directory
migration on 2026-09-09.** A policy is not a grant: RLS filters rows for a role that already holds
the table privilege, so every query would have failed with *“permission denied for table
scurve_manual”* — which reads like an RLS problem and is not one. **That was the next error the
owner would have hit after fixing the type.** Also added: a guard that `raise exception`s when an
existing table has the wrong column type, because **`if not exists` is a silent no-op there** and
would have left the module broken with nothing to explain it.

Verified structurally (parens 24/24, `$` paired, 2 tables / 2 grants / 2 policies, **0**
occurrences of `project_id uuid`, 0 NUL bytes); the VERIFY block now checks all three project-id
columns read `text` in one query. ⚠️ **Not run against a database from here** — no SQL runner and no
grants, so the owner’s next run is the real test. ⚠️ **No `MODULE_V` bump**: only a `.sql` file and
the changelogs changed, and no module page is cache-busted by a migration.
Detail: [`modules/s-curve/CLAUDE.md`](modules/s-curve/CLAUDE.md).

### The S-curve gets a Manual data tab, a monthly/quarterly/yearly lens, and a chart you can interrogate (2026-09-10) — ethanrobles10

Owner: *"add a tab wherein users are able to put the data manually. And also for the landing page of
the s-curve, allow users the option to view monthly, quarterly, yearly etc. and when hovering over
data, pls show the contents like POC, amount. And then when clicked, what are the details in terms
of gen req, site works, structural works, etc."*

**The manual sheet becomes a screen.** It shipped this morning as a card stacked under the chart and
gated on the chart's own mode — so it was a scroll away from the control that opened it, and
entering next quarter's forecast meant first switching what the chart was claiming. It is a `Curve`
| `Manual data` tab now, through **`UI.tabsToDropdown`, the app's own convention** (fourteen other
modules use it, and `pd-tabsrc` puts it under the shared pre-JS boot-flash rule) rather than a
fifteenth navigation idiom. ⚠️ The tab and the mode stay **independent** — the tab is where you are,
the mode is where the curve's numbers come from — so the sheet states the combination out loud:
*"The Curve tab is drawing from the schedule, not from this sheet"*, with a button that switches it.

**Monthly / quarterly / yearly is a LENS, not a third engine run.** ⚠️⚠️ Cumulative takes the *last*
month of a bucket, periodic *sums* them — getting those the same way round is the whole correctness
of it, since Jan+Feb+Mar added up is roughly triple where the curve has actually reached and sails
past 100%. ⚠️ The bucket holding the data date reads its actual at `ti` (the engine anchors that one
month and zeroes the rest, so the bucket's last month would report **0% for the quarter we are
standing in**); a bucket entirely in the future carries `null`, not 0; a November start gives an
honest two-month Q4. ⚠️⚠️ The x-axis **stays in month space** at every granularity, which is what let
the SPI forecast S-curve — plotted from dates — go untouched. The data table reads the same lens,
never its own bucketing.

**Hover gives POC and amount.** ⚠️⚠️ On the duration basis there is no peso figure in the result at
all, and 40% of the duration is not 40% of the money — so a **companion cost series** is computed
alongside, aligned **by month key, never by index**: the two results can have different lengths
(the forecast finish is SPI-derived per basis), so reading it positionally would put March's money
under June's progress and look entirely plausible. Absent rather than faked when nothing is
cost-loaded.

**Click gives the trade breakdown.** Each trade is its own curve — splitting the project's figure by
weight would report every trade at the same percentage. ⚠️⚠️ Two columns that are routinely confused,
and the header says so: **Own %** is how far along that trade is, **Points of project** is what it
contributes. General Requirements at 100% of itself on a job where it is 6% of the scope contributes
6 points, not 100. The points column sums to the project's own figure, and measured in a browser it
does: 20.0 against planned 20%, 10.8 against actual 10.8%.

⚠️⚠️ **A real defect caught by looking at the render rather than by testing:** the amount column
first reported `projectAmount × durationShare`, and Structural Works came out at **₱585.3K where its
own cost curve says ₱1.9M** — a 3× error, with the column total still reconciling, so nothing on
screen would have given it away. Each trade now gets its own cost-basis series.

**Verified by execution** (37 assertions, 0 failing; the previous pass's 34 still pass) and **driven
in a real browser** in light and dark on a five-trade cost-loaded fixture — 27 bands / 9 / 3 across
the three granularities with the bar widths, axis titles and table columns following, and the chart
checked *against* the readout: the data-date quarter draws no actual bar and the readout omits that
row, so what is drawn and what is said agree. ⚠️ Not verified signed in; the manual tables still
need `migrations/2026-09-10-scurve-manual-poc.sql`.

`MODULE_V` → `20260910zb`. Detail: [`modules/s-curve/CLAUDE.md`](modules/s-curve/CLAUDE.md).

### 2026-09-10 (za3) — A class code the schedule has never heard of stops being a dead end — and the measurement that says it will not rescue OPW101

Owner: *"Let's make sure that the linking is easy as well. Put yourselves in the shoes of the
planner and think of how much time and effort would it take."*

**The dead end.** `candidatesFor` gates every proposal on the line's class code. On OPW101 the
Structural lines carry `03051`, nothing on the schedule carries `03051`, so the candidate set came
back **empty** — and an empty set is not a weak answer, it is *no* answer: the four rungs never ran.
All 21 lines read "not scheduled", and the only advice the screen could give was "tag the activities
first", which is 2,561 activities of manual work standing between the planner and any proposal at
all. Now, when the gate is set but matches nothing, the line falls back to **its own name across the
whole schedule**. Measured on an 18-floor fixture: **0 links before, 144 after, in 5ms**.

The bar is `TAG_FLOOR` — the **same 0.8** at which the tagger already pre-ticks — not a new
threshold, and not the 0.35 floor this file warns "would return hundreds". A preliminary keeps
returning nothing: no activity is named "Rental of Flat Bed Truck", so the derived
preliminary/mismatch distinction is untouched and **no fabricated link can reach `planned_cost`**.
⚠️ The code rung is never bumped on this path — those activities do not carry the line's code, and
writing "carries 03051" into `boq_allocations.matched_by` would be a false entry in an audit trail.
The dialog says which it is, because a proposal built from a name is a weaker claim than one built
from a code.

**⚠️⚠️ AND IT WILL NOT FIX THE OWNER'S 21 LINES, which measurement showed and the fixture had
hidden.** My suite used activities named "Rebar Works". The live schedule names them **"Rebar"**.
Probed against the shipped `matchAct`:

| activity | BOQ line | score |
|---|---|---|
| `Rebar` | Rebar Works | **no match** |
| `Rebar Works` | Rebar Works | 0.95 |
| `Formwork` | Formworks | 0.85 |
| `Concrete` | Ready Mix Concrete | 0.85 |

`Rebar` fails on one clause: rung 2 is `l3.indexOf(an) >= 0 && an.length > 6`, and "Rebar" is five
characters. That single guard is why the tagger reports *"no name resembles it"* for all 21 codes,
and why this fallback stays silent on the same data. The fixture agreed with the code because I
built it from the BOQ's vocabulary rather than the schedule's — a test passing for the wrong reason,
which is the trap this file already records three times.

**Relaxing the guard is NOT the fix, and that is a finding rather than a deferral.** `Rebar` scores
0.85 against *Rebar Works*, *Rebar Consumables* **and** *Rebar Coupler* — three different BOQ lines,
one activity name. The ambiguity is real and lives in the data: the schedule is less specific than
the bill. No threshold resolves it; only a human, or a more specific activity name, can. Lowering
`an.length` would convert "found nothing" into "confidently allocated the same 72 activities to
three different lines", which is worse.

**Also ruled out, on this repo's own evidence.** The activities are badged `HAS 3050` while the
lines carry `03051`, which looks like a leading-zero mismatch worth normalising. It is not:
`2026-08-21-class-codes.sql` states that **de-zeroing collides genuinely different items** —
`015051` (Earthmoving) with `15051` (Railings), `017151` with `17151` — and that the padded code is
the key. So no code normalisation was written.

Verified: **26 new assertions, 0 failing**, plus 34 + 36 + 24 + 29 — **149 total**. Pinned to
**3897c0f**. ⚠️ Three of my own expectations were wrong before the code was, all corrected in place
rather than deleted: I expected the plan count to be unchanged (it legitimately improves 1 → 2), I
expected the winning rung to change (it does not — inside a gated set `name` at 0.60 already beat
`code` at 0.10), and I expected `why` to read "carries 03051" (`why` carries the *winning* rung's
reason only; the code rung is a floor, not a label). Two assertions in the match-all suite also
encoded "un-chained C is 0"; it is 1 now, deliberately, and the contrast the test exists for is
still there at 1 against 3. `?v=` → `20260910za3`.

**Open, and now the critical path.** `matchAct`'s specificity gap is the real blocker for OPW101,
and the answer is a screen that says *"'Rebar' matches three lines — which is it?"* rather than a
threshold. The orchestrator is also the same three passes the individual buttons run, so the buttons
and the dialog want centralising; and WBS branch names, BOQ sheet names and the chart's own item
names come from three sources that nobody has reconciled. All three are next.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>


### 2026-09-10 (za2) — The picker was hiding activities two more ways, and both were opening filters nobody chose

Five things reported off the live OPW101 screen in one sitting: *"Let's fix the .cca-row tap
targets"*, *"This should be fixed as well"*, *"Pop-up for the UI needs fix as well and simplicity"*,
*"Structural works isn't viewing properly"*, *"Why can't I see rebar works now?"*

**⚠️⚠️ The ladder opened on a filter the planner never set.** `ladderOf` defaulted every rung to
its own first value, and the rungs cascade — so the picker opened on Tower 1 → 5TH Floor → Z1 → U1,
which on this project is **18 of 2,561 activities**. Structural Works was absent from the tree
entirely, because Structural is planned per zone and carries no Unit at all, so every one of its
activities was filtered out by a rung that had positioned itself. Measured on an 18-floor fixture:
before, **0 of 216** Structural activities and **0 of 72** Rebar Works survived the opening cursor;
after, all of them do. The default is now **All**, the rung below appears once a value is picked,
and the ladder is a drill-down instead of a guess. Nothing is selected either way — the ladder
positions the view, it never ticks a box. My own note in this file argued the opposite ("a ladder
opening on everything is a filter nobody chose"); it had it backwards, and the live screen is what
showed it: an opening *narrowing* is the filter nobody chose, and it reads as missing data.

**⚠️⚠️ The row cap deleted structure, not rows.** `slice(0, ROW_CAP)` was applied to the ACTIVITY
LIST before `treeOf` ran, and a branch only exists if some activity in the list puts it there. So
past activity 400 the floors did not exist in the tree at all — not scrolled off, absent — and no
amount of expanding could reach them. That is the whole of *"Why can't I see rebar works now?"*,
with the header reading `400+`. Measured: the top floor's Rebar Works rows were **not in the tree**
before, and are now. The cap moved to the **painted rows**, after the open/closed filter; branches
start closed, so the opening paint is **3 rows** — the three top-level WBS branches — against a
cap of 400. Fully expanded the same fixture is 705 rows, so the cap does still bite, and now says
so: **305 more rows not shown**. And the notice says what it
is holding back — a cap whose entire signal is a `+` is one a planner cannot act on, and it was read
as "there is no Rebar Works".

**The tap target was 13px, not the 30px I reported yesterday.** Re-measured with the markup
`affected.js` actually emits: every checkbox is **13×13** against a 44px `--pd-tap`, and
`.cca-row[data-act]` carried **no handler at all** — so the row's 30px bought nothing, and the one
row type a planner clicks hundreds of times was the smallest target in the dialog. The leaf rows now
answer a row click, as the ladder and branch rows always have. The box follows the class-code tree
next door (15px + brand accent) rather than inventing a second convention, and on a phone the row
meets `--pd-tap` with the bodies grown to match, so the same four and seven rows stay on screen
instead of the list becoming a keyhole.

**"Add lines from the schedule" was a five-column table in a 520px modal.** The Description column
came out about 90px and "not in the class-code chart — it will be filed under Others" wrapped to one
word per line in red, which reads as an error rather than the note it is. `.boq-widish` already
existed in this module for screens needing more than 520px; this dialog simply never opted in. The
three narrow columns are now pinned so the sentence gets the remainder.

**"Link to activities" said the same thing twice.** A paragraph explaining that a line with no
quantity still keeps its link sat above a `.boq-recon` line saying exactly that, with the count
filled in. The paragraph is deleted, not moved — the foot keeps it because it is the one that can
state **how many**. The two scope descriptions lost a clause each. The `Choose activities…` button
and its hint were an inline-flex button followed by a bare inline span, so the hint sat on the
button's baseline rather than its centre with only a collapsed text space between them; that row is
a flex row now.

Verified: **29 new assertions, 0 failing**, plus 33 + 36 + 24 unchanged. The new suite is pinned to
**17c3e8c** and asserts the BEFORE state as well as the after — that Structural really was absent,
that Rebar really was unreachable, that whole floors really were missing from the tree — so it fails
on the old file rather than passing on both. It loads the **real** `locmatch.js` rather than stubbing
`bestSpelling`, which would have made the suite test my stub's ordering instead of the app's. 44 JS
files + 32 inline blocks parse; 571/571 braces; 0 NUL bytes. `?v=` → `20260910za2` on `boq.js`,
`affected.js` and `module.css`.

**Not fixed, and it is the big one.** `candidatesFor` gates every proposal on the line's class code:
no activity carries `03051`, so the candidate set is empty, the four rungs never run, and all 21
Structural lines read "not scheduled" — while the schedule holds 72 activities literally named
"Rebar Works". The app's current answer is "tag the activities first", which is the manual work the
owner is asking about. A name-rung fallback for the gated-but-empty case is the next change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>


### 2026-09-10 (za1) — "Use 0 activit ies": a word split across two flex items, and a consistency review in which my own checker was wrong twice

Owner: *"I just noticed the Use x activit ies button has a UI error"*, then *"Let's follow the app
UI consistency review for this code change"*.

**The defect.** `.pd-btn` is `display:inline-flex; gap:6px`. A gap falls between **every** flex
item, and a bare text node inside a flex container becomes an *anonymous* flex item — it is not
exempt. The label was built as `Use <span id="sp-pn">0</span> activit<span id="sp-pys">ies</span>`,
which is four items, so the button rendered `Use 0 activit ies` — the gap landed **inside the
word**. Fixed by making the label a single text node (`useBtn.textContent = 'Use ' + n +
' activit' + (n===1?'y':'ies')`), which also deletes the two id lookups the counter used.

⚠️ **This repo had already recorded this exact trap**, on the sidebar brand: a bare text node
between two images took a gap on *both* sides and measured 18px where the rule said 9px. Same
mechanism, same stylesheet, and I walked into it anyway. The rule worth keeping: never split a word
across elements inside a flex row — build the string and set `textContent`.

`flexword.py` now sweeps for it (an opening tag glued to the end of a word inside a known
flex-with-gap class). Across all 44 JS files and every HTML file: **one** real instance, the one
above. The only other hit — `Months<span` in project-schedule — is a false positive of the sweep's
400-char window, and is reported as one rather than "fixed".

**The consistency review.** Of the 20 CSS rules this change added: **0** off-scale font sizes, **0**
off-scale weights, **0** off-scale radii, **0** non-token shadows. Three colour literals, all
judged and kept: `.boq-ma-n { color:#fff }` on `--pd-red` (the app's standing treatment — `.cc-tab.active`,
`.pd-btn-primary`, `.sbld-step.on .sbld-step-n` and 8 more do the same), and two neutral
`rgba(128,128,128,a)` separators, which composite identically on either theme and match the
surrounding `.cca-*` rules.

**Both themes, rendered against the real stylesheets, at 344px with the ≤700px block active.**
Every surface this change introduced clears AA: the step text 16.30/12.22, the mini text 7.07/7.02,
the scope option 14.25/13.45, the new ladder rows 7.07/7.02, the hint line 7.07/7.02. Within each
row that actually exists, buttons match exactly — picker toolbar 36h/36h, modal footer 44h/44h,
and the footer's primary button meets `--pd-tap` (44px) on the nose.

⚠️ **The checker was wrong twice, and both would have caused a "fix" that made things worse.**
(1) `bgOf` returned the first non-transparent `backgroundColor` and `lum()` then dropped the alpha
channel, so ink on the selected row's `rgba(238,49,36,.14)` tint was measured against **fully
saturated red** and reported 3.96 light / 3.59 dark. Composited properly it is **13.30 / 10.96** —
the failure was the harness's, not the CSS's, and the row is pre-existing anyway.
(2) The harness stood `Select all 9` (`.pd-btn-sm`) beside `Use 9 activities` (`.pd-btn`) in a row
that **does not exist in the app** — the owner saw the page and said *"Buttons are not the sized the
same"*, and he was right about the render and right that it was worth asking. They are 36h and 44h.
But `#cca-selall`'s real neighbours are `.cca-count` and `#cca-clear`, both `.pd-btn-sm`, and the
footer's real neighbour is `Back`, also `.pd-btn`. The harness now draws both real groupings, and a
size is judged against the row it truly sits in.

**Reported, not fixed — each is app-wide and pre-dates this change:**
- White on `--pd-red` is **4.12:1**, under AA's 4.5 for small text. It is identical for
  `.pd-btn-primary` everywhere, 11 `.*-tab.active` rules, and `.sbld-step-n` — so `.boq-ma-n`
  matches the app exactly. Darkening it for this one badge would make the badge inconsistent
  without making the app accessible; it is a brand decision (`--pd-red-dark` measures better) and
  needs its own sweep.
- `.cca-row` is **30px** tall on a phone against a 44px `--pd-tap`. Measured against a plain
  pre-existing row: also 30px. Every row in every picker shares it; raising only the two rows this
  change added would make them inconsistent with their 18 siblings, and raising all of them cuts how
  many fit on screen. Its own change.

Verified: 33 + 36 + 24 = **93 assertions, 0 failing**; `window.BOQ` assigns with 20 exported keys
and 48 `_internals`, none undefined (the check that would have caught the z6 outage); 44 JS files +
31 inline blocks parse; 0 brace mismatches; 0 NUL bytes. The match-all suite is pinned to
**8be5101**, the parent of the lift commit, not to HEAD — comparing HEAD with itself is the trap
this file already records. `?v=` → `20260910za1` on `boq.js` only, the one asset that changed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>


### A progress-photos viewer on the dashboard, and the S-curve gets periodic bars, a trade filter and a manual mode (2026-09-10) — ethanrobles10

Owner: *"can you input a progress photos viewer for the dashboard and make it visually pleasing."*
Then, for the S-Curve: *"currently there is cumulative. I want you to add a periodic bar chart, and
then a mode at the top to filter the trades being displayed. And then later on a filter for General
Requirements vs Measured Works."* Then: *"provide 2 options … Manual intervention or automatic
detecting … For the planned, this should be defined in the planning phase … and will be locked as
the project is actualized. For the actuals, allow users for manual intervention. For the forecast,
allow users to input POCs manually for the following months per trade."*

**The dashboard's photo panel was a contact sheet, not a viewer.** Six 112×74 thumbnails in a grid,
nothing clickable — at that size a site photo is a smudge, so you could see *that* photos existed
and not what was in one, and the only way to look at the work was to leave the dashboard. It is now
a 16:9 hero with its caption over the image, a rail of the rest, and a full lightbox (prev/next,
←/→, Esc, and the index you navigated to becomes the panel's hero on close). ⚠️ The image is
`contain`, never `cover`: a progress photo cropped to fill a frame is a photo with the thing being
reported cut out of it. ⚠️ **A real defect was caught by measuring, not looking**: `phPaint()` ran
before the rail existed, so the current thumbnail was never marked until the planner clicked
something — the index of the lit tile came back as −1 on a freshly rendered panel, which looks
exactly like a panel whose first photo simply is not current. The `recent` window went 6 → 12 so
there is something to browse.

**The S-curve gained periodic bars, a trade filter, and a manual mode.** The bars are *derived* —
period *n* = cumulative *n* − cumulative *n−1* — so they always add back up to the line, on their
own right-hand axis because a monthly increment on a 3-year programme is a few percent of the total
and plotting it on the 0–100% axis leaves unreadable stubs. ⚠️⚠️ **Looking at the chart caught a
wrong claim**: the data-date month's actual bar reached 97% of the axis on a project that had done
35%, because the engine deliberately *anchors* that point to the true recorded total while earlier
months are *modelled* — so the step absorbs the whole model-vs-reality discrepancy, which is right
for the cumulative line and is not one month's production. It is no longer drawn as one, and the
note says why.

The trade filter uses `work_type`, which is **the shell's own convention** (the dashboard's
programme panel already groups this table that way) rather than a second rule; Project Schedule's
WBS-walking fallback is deliberately *not* copied, and the cost is stated on screen instead of
hidden. ⚠️ Untraded activities pass neither General Requirements nor Measured Works — unknown is not
measured — and the count is stated so the split can be reconciled. ⚠️ The RPC monthly aggregate is
refused whenever a filter is on: it carries no trade, so it would draw the whole project under a
one-trade heading.

**Manual mode** is the planner's own monthly POC per trade, in a new table (`scurve_manual`,
`scurve_manual_meta` — `migrations/2026-09-10-scurve-manual-poc.sql`, additive and idempotent).
⚠️⚠️ **A trade is weighted by its share of the schedule, never an equal share** — a 2%-of-the-job
trade must not move the project as much as a 40% one, and the wrong version looks entirely
plausible. Planned is read-only once locked *or* once the schedule carries recorded progress
(*"locked as the project is actualized"*); actual is editable to the data date; forecast only after
it; every refusal is explained where it is refused. The two sources are never merged and the mode
travels into the card heading, because a manual curve read as a schedule-derived one is a claim
nobody made.

**Verified by execution** (34 assertions, 0 failing) and **in a real browser** against the app's own
CSS in light and dark — the shipped renderers on a six-trade fixture produced a sheet with 24
editable and 48 read-only cells, exactly what the editability rule predicts. ⚠️ **Not verified
against the database**: the anon key has no grants, so no row was written and the 42P01 fallback is
code, not observed. Until the migration is run, Manual mode says so and names the file; Automatic
is untouched.

`config.js` → `?v=20260910za` on **28 pages** (the photo window lives in it, and a cached copy would
keep asking for 6); `MODULE_V` → `20260910za`. ⚠️ Re-derived from the remote TWICE — it took `z9` for
the BOQ pass while this was in flight, and `za` sorts after it (`z10` would sort before). The fourth
collision this log has recorded today.
Detail: [`modules/s-curve/CLAUDE.md`](modules/s-curve/CLAUDE.md).


### 2026-09-10 (z9) — B: a line can be allocated to the PROJECT; and the picker was hiding activities, could not span floors, and made "Rebar everywhere" a manual deselect

**Run `migrations/2026-09-10-boq-project-scope.sql`.** Owner: *"Let's do B as well"*, then three
reports off the live picker — *"Structural works doesn't appear on some floors"*, *"Is there a way to
select all floors but select specific activities only from the selection"*, and *"Right now I have to
expand all WBS and manually deselect activities… its very tedious work."* All four fixed.

#### ⚠️⚠️ B · A PRELIMINARY HAD NOWHERE TO BE RECORDED, SO IT CONTRIBUTED ₱0
`boq_allocations.activity_id` was `not null`, so the only way to record Mobilization or a site office
was to attach it to an activity it does not belong to. Planners left them unallocated instead — and
`boqDerive` drops a line with no allocations outright (`if (!list.length) return;`). **Measured on the
fixture: today the preliminary contributes nothing and the basis is ₱3,000; with B it is ₱3,600.**

`scope in ('activity','project')`, `activity_id` nullable, and three guards:
- a CHECK making the two shapes exclusive, so a NULL can never read as "not filled in yet";
- ⚠️ a **partial unique index** — the existing unique is `(boq_item_id, activity_id)` and Postgres
  treats NULLs as **distinct**, so without it "the project as a whole" could be recorded twice and
  counted twice;
- ⚠️⚠️ a **trigger** against mixing activity and project rows on one line. A CHECK sees one row; the
  rule is about the set. Mixing would put the same money in the per-activity map *and* the
  project-wide spread, and the contract total would silently exceed itself.

⚠️ **`'wbs'` is deliberately NOT in the CHECK** — nothing in the UI can produce one, and this module's
own history records the trap of adding a pointer before the screen that sets it.

**The spread is pro-rata by duration**, which is what "time-related preliminary" means, and it is the
only way the money can reach the curve at all: `schedule_scurve_agg` reads
`coalesce(planned_cost, bl_cost, 0)` over **leaf activities**, and Cost Loading's Apply writes that
column per activity. There is nowhere else for a project-wide cost to live.
⚠️ **A synthetic "project-wide" cost line over all activities was the obvious design and it is wrong:
Apply writes `planned_cost = amount`, an OVERWRITE per activity, not a sum** — it would have wiped
every direct cost. Established by reading the write, before building on the assumption.
⚠️ The total is **reported separately as well as spread**, because once inside the per-activity map it
is invisible — a planner reading "Rebar Works · from the BOQ ₱X" cannot tell how much of X is the site
office. Cost Loading now names it.
⚠️ A project-scoped row **refuses rather than degrades** when the migration is absent: without `scope`
it is indistinguishable from an activity allocation, and `activity_id` is still NOT NULL there.

#### ⚠️⚠️ THE PICKER WAS HIDING ACTIVITIES, AND THE COUNTS SAID SO
*"Structural works doesn't appear on some floors."* `valuesAt` did `if (!v) return;` — an activity with
**no value at a level was dropped from every bucket**, and `ladderOf` then narrows with
`cand = chosen.acts`, so it vanished from every rung below and from the tree. Structural work on the
7th floor carries a Zone and **no Unit**, so all 24 activities disappeared the moment the Unit rung
auto-positioned on U1. The screenshot showed it if you added up: the floor held **240** and its zone
values summed to **236**. There is now a **`— no <level> recorded —`** bucket, last, labelled from the
level so it reads as a fact about the data rather than a place called "none".

#### All floors at once, and "Rebar everywhere" in one click
- **`All <level>s`** on every rung. ⚠️⚠️ **The rungs below an All are not rendered**, and that is the
  point rather than a limitation: `valuesAt`'s own note forbids a "every zone at once" mode without a
  composite key, and it is right — with Level on All, the 5th floor's Z1 and the 7th floor's Z1 are
  the same string and two different places. Resolution stays strictly top-down; the screen says why.
  ⚠️ The default is still the first value: a ladder opening on "everything" is a filter nobody chose,
  the mirror of the bug above.
- **`Select all N`** beside the search. A search already spans the whole project
  (`scope = hits || lad.cand`), so *"Rebar"* lists every Rebar activity on every floor — what was
  missing was a way to take them. It states the **count** (the tree is capped, so "all" alone could
  select more than is on screen), **toggles**, and is **additive** across searches.
  ⚠️ Ticking `All` includes the no-value bucket — those activities *are* part of "all of them", and
  excluding them would rebuild the hole the bucket was added to close.

#### ⚠️⚠️ TWO BUGS OF MY OWN, BOTH FOUND ONLY BY RENDERING
1. **A raw NUL byte shipped into `affected.js`.** I wrote the sentinel as a control character instead
   of the escape — the identical mistake this repo records for `exactKey` — and `grep` answered
   *"Binary file matches"*. Caught within a minute, but `verify.py` would have caught it at commit and
   I had not run it since the edit.
2. **⚠️⚠️ AND THE SENTINEL COULD NOT WORK ANYWAY: an HTML parser substitutes U+FFFD for U+0000**, so
   `data-v` read back `"�all"`, never matched, and the ladder fell through to the first value —
   **both new gestures rendered perfectly and did nothing when clicked.** Structural assertions would
   have passed. `normKey` ends `.replace(/[^a-z0-9]+/g,'')`, so every real key is `[a-z0-9]` only and
   `'*all*'` / `'*none*'` cannot collide while surviving an attribute.

#### Verified — 24 + 36 + 33 assertions, 0 failing, plus the picker driven in a browser
- **The money:** basis 3,000 → 3,600; spread **1200/2400** on durations 10:20 (**not** equal — a
  same-length fixture could not tell those apart); the zero-duration milestone takes none; the
  **money invariant** holds (basis == priced lines exactly, heading and exclusion never counted); a
  row with **no** `scope` reads as an activity allocation, so every pre-migration row is unchanged;
  no leaf with a duration → counted, spread nowhere, never divided by zero.
- **Driven, not asserted:** the floor-level activity is **invisible by default and reachable** through
  the new bucket; `All levels` collapses the rungs to `[Tower, Level]` and the tree holds **21**;
  search *"Rebar"* → **Select all 9** → 1 → **10 selected** in one click; it toggles back; and adding
  *"Concrete"* accumulates to **16**.
- 44 JS files + 30 inline blocks parse; 563/563 braces; **0 NUL bytes across 299 text files**;
  migration parens 12/12, `$$` paired.
- `boq.js` / `affected.js` / `module.css` → `?v=20260910z9`; `MODULE_V` → `20260910z9`.

⚠️ **Three of my own assertions were wrong before the code was**, each left in the suite: a 400-char
regex window failed on a correct handler because the explaining comment is longer than that; `.cca-rung`
was never a class; and a structural search matched the comment quoting the code it had removed.

⚠️ **NOT verified signed in, and the migration has not been run.** Until it does, the scope control
saves nothing and says so. The spread has never run against a real 2,561-activity schedule, and **the
first project-scoped line is the test** — the figure to watch is Cost Loading's new "of that is
project-wide" line against the BOQ's own General Requirements total.
⚠️ **A front-loaded preliminary is still not expressible.** Mobilization is spent in month one, but a
project-scoped line inherits each activity's own dates, so it spreads across the whole programme.
Recorded rather than guessed at.


### 2026-09-10 (z8) — The activity picker could not reach 69% of the schedule, and "0 activities" was answering three different questions

Owner, on OPW101 with the allocation dialog open: *"Right now the linking is still not easy."* Then,
on the bar: *"There are two buttons for match to schedule."* Then, on the disclosure: *"is lengthy and
wrap texts incorrectly."* Three reports, all correct, all fixed here.

#### ⚠️⚠️ A · THE PICKER WAS A RAW `<select>` OF `ACTS.slice(0, 800)`
On a project with **2,561 activities that is 1,761 — 69% — simply not in the list**, unreachable by
any amount of scrolling. No search, no grouping, no predictable order, and `onchange` added **one**
activity per interaction. Linking a line to a floor's worth of work meant forty passes through a list
that could not see two thirds of the project. The (z1) entry had named this exact gap and left it.

It is replaced by **`CCAffected`'s ladder + WBS tree + search** — the *same* picker the change-order
wizard uses, with its change-order half suppressed by a new `opts.preview:false`.
⚠️ **Suppressed, not rebuilt.** A second picker for the BOQ is the drift this module has already paid
for twice (two create dialogs, two import doors); `impactOf`/`ganttHTML` simply never run, and
`if (du)` already guarded the CO-duration wiring, so nothing could crash.
⚠️ The selection **starts from the parts already on the line**, so opening it to add one activity
cannot silently drop the nine already there.
⚠️ It **takes over the dialog body** rather than opening a modal on top of one — the trap this file
records — and widens to `boq-wide` while picking, because a ladder plus a tree inside `.pd-modal`'s
520px is the ~200px squeeze that class was added to fix.
⚠️ The footer's own handlers are **re-bound** on return: replacing `innerHTML` killed them, and
Cancel/Apply would have looked right and done nothing.

#### ⚠️⚠️ C · "0 ACTIVITIES" WAS THREE DIFFERENT FACTS WEARING ONE NUMBER
The screenshot was fully coded on both sides — **122 of 122 lines mapped, 2,561 of 2,561 activities
coded** — and every row still read `0`. That is not 122 failures. Mobilization, Demobilization,
Rental of Skidloader, Barracks, Site Office are **time-related preliminaries**, and a structural
programme has no activity called "Rental of Flat Bed Truck".

⚠️ **The distinction is DERIVED, never taken from the trade's name.** A hard-coded "General
Requirement" list would be a guess about Finance's chart and would rot the first time it was revised.
`tradeActivityCounts()` instead measures, off the chart: does **any** activity carry a code in this
line's trade? The column now says which of four situations a line is in:

| | shown |
|---|---|
| allocated | the count, as before |
| candidates exist | **`n` ready** |
| no activity carries the code, **and the whole trade is absent** | **not scheduled** — normal for preliminaries |
| no activity carries the code, but the trade IS on the programme | `0`, with *"14 of 320 activities are in Structural Works"* |

⚠️ The memo is cleared in `refreshActs()` and `reset()`. Without the first, a stale count would report
a trade as absent from a schedule **the planner had just tagged** — telling them their own work had no
effect.

#### The two buttons, and the caption that was also WRONG
- **`Match to the schedule…` → `Code, tag and allocate…`.** (z7) shipped it a tab-width away from the
  sub-tab **Match to schedule**. One is a place, one is an action over the whole bill, and two
  controls reading the same is how a planner learns to distrust both. The dialog heading follows the
  button, not the tab.
- **"How matching works" was stale, not merely long.** It described **three** rungs — *"location match
  first, then pro-rata by duration, then by hand"* — which is the behaviour **before** (z1)'s ladder.
  There are four, and pro-rata is now the **last**, not the second. A caption naming the wrong order
  teaches the planner to distrust the Method column, which reports the real one.
  ⚠️ And the wrap defect was a **unit** error: `max-width: 900px` does not track the font size, so at
  this scale a line ran ~115 characters, about double a comfortable measure. `70ch` does track it.
  ⚠️ The old last sentence — *"there is deliberately no quantity column on the activity"* — is a schema
  decision a planner never acts on; it lives in the migration and in `docs/`, not on screen.

  | rendered, against the real stylesheets | before | after |
  |---|---|---|
  | paragraphs | 1 | 3 |
  | characters | 344 | **262** |
  | measure | 898px | **472px** |
  | characters per line | ~115 | ~51 / 61 / 39 |

#### Verified — 36 assertions, 0 failing, plus two renders
- **The picker was MOUNTED, not just asserted**: the real `CCAffected` against stubbed loaders and the
  **real `PDLoc`**, in a browser. Ladder **2 rungs** (Tower, Level) carrying real values with
  indeterminate states, tree rows named, search present, `initial:['A1']` honoured and reported as
  *"1 selected"* — and **0 preview columns, 0 CO-duration boxes**, `.cca-lower` computing to a
  **single 840px column** with the tree taking 839 of it.
- The **merge rule** is executed: adding a third activity **keeps the typed 60/40**, new parts split
  only the remainder, de-selecting drops that part, a qty-less line links at 0, and an over-allocated
  line never yields a negative.
- The **four link states** are executed against a fixture shaped like OPW101 — the preliminary reports
  `notInSchedule`, the Structural line with no activity on its code reports `0` **with its trade's
  count**, and an allocated line reports `linked` whatever the trade says.
- 44 JS files + 30 inline blocks parse; 552/552 braces; 0 NUL bytes.
- `boq.js` / `affected.js` / `module.css` → `?v=20260910z8`; `MODULE_V` → `20260910z8`.

⚠️ **Three of my own checks were wrong before the code was**, each left in the suite: a structural
search found `slice(0, 800)` **in the comment explaining its removal** (the checker measuring the
changelog, not the code — comments are stripped now); `[^}]*` could not cross the `{}` literals inside
`reset()`'s own body and reported a call that is plainly there as missing; and `.cca-rung` was never a
class, so the ladder read as absent when it had rendered two rungs.

⚠️ **NOT verified signed in.** The picker is mounted against a fixture, not a real schedule, so the
one thing still unproven is `CCAffected`'s own read against a 2,561-activity project — which is
exactly where the old 800-cap hurt. **That is the first thing to try:** open a line, press *Choose
activities…*, and check the tree holds more than 800.

⚠️ **B is still not built** — a line still cannot be allocated to the project rather than an activity,
so those 122 preliminaries contribute **₱0** to the cost-loaded S-curve (`boqDerive` returns early on
a line with no allocations). The screen now says *why* they are unmatched; it does not yet let them
carry cost. That needs a migration and the owner's call on whether preliminaries belong in the curve.


### 2026-09-10 (z7) — Batching the BOQ onto the schedule: one action for three passes, and the dead end that made the third look broken

Owner: *"How would the planner easily batch the BOQ to the activities in the schedule?"* then *"Let's do
both."* ⚠️ **No matching logic is added here.** Every engine already existed; what did not exist was a way
to run them in the order they depend on, and a way to find out why the last one found nothing.

#### ⚠️⚠️ THE THIRD PASS WAS A DEAD END, AND THE SCREEN COULD NOT SAY WHY
`candidatesFor()` returns nothing unless the **activity** already carries the line's class code. So on a
schedule nobody has tagged, *every* line reports "cannot", and the modal said only:

> *N cannot — no activity on this project carries their class code.*

True, and useless: the fix is one button on the **previous tab**, and nothing on screen pointed at it.
`allocBlockReason()` now measures which of three situations it is and says the right one:

| measured | what the planner is told |
|---|---|
| **0 of N activities tagged** | it is a missing **prerequisite** — with a **Tag schedule activities…** button right there |
| no activities at all | there is nothing to allocate to |
| some tagged, not these | the general case, **with the count** (`14 of 320 tagged`) so "tag more" is actionable |

⚠️ The button **closes this modal before opening the tag dialog** — that one is a modal too, and stacking
it leaves the planner clicking a pane they cannot reach. Same rule the wizard's own hand-off follows.

#### The three passes as one action: **Match to the schedule…**
In the BOQ bar, not on a tab, because it spans three of them — two passes live on Class Codes and one on
Match to schedule, so a control that runs all three belongs to none of them. Writers only, and only once a
revision exists.

    A · code the BOQ lines        (from the suggestion library, above a confidence floor)
    B · tag the schedule activities  (≥80% name confidence, never moving an already-coded activity)
    C · allocate the quantities      (on the strongest rung that finds anything)

#### ⚠️⚠️ THE PREVIEW IS EXACT, NOT AN ESTIMATE — and that is the whole engineering problem
B's plan depends on what A would write, and C's on what B would write. A preview computed against
*today's* state would be **wrong about two of the three passes** — and would report **0** for pass C on
exactly the project this feature exists for. So `matchAllDryRun()` overlays the passes in memory, runs the
real planners, and restores in a `finally`. Nothing is written.

It is only possible because the three planners are **synchronous and pure over module state** — so nothing
can interleave between the overlay and the restore. ⚠️ The overlays **copy** (`CMAP` gets a fresh object,
each tagged activity a fresh row): mutating the real `ACTS` would leave the module holding codes that are
not in the database if anything threw.

⚠️ **The RUN re-plans from real state between passes rather than replaying the simulation.** A pass can
write fewer rows than it asked for — RLS refuses activities the planner did not import, and PostgREST
answers a filtered UPDATE with 200 and zero rows — so pass C is built from what pass B *achieved*.
Replaying the plan would allocate against tags that do not exist. Each pass reports what it actually did,
and a shortfall is named (`38 activity tag(s) of 41 asked`).

#### ⚠️ The engines are LIFTED, not copied
`planCodeMap` / `planTags` / `planAllocs` and `applyCodeMap` / `applyTagPlan` / `applyAllocPlans` are now
module-scope, and the three dialogs call them. A second copy would let the orchestrator's preview and a
dialog's own preview disagree about the same project — which is the failure this module has already paid
for twice (two create dialogs, two import doors).

#### Verified — **33 assertions, 0 failing**, executing the shipped file
The load-bearing one is not "the dry run returns numbers", it is:

> **dry-run pass C === the pass C you get after ACTUALLY applying A and B.**

Asserted on `ok`, `none`, the rung breakdown and the part count. Also:
- ⚠️ **The dry run restores state** — A, B and C all re-plan identically afterwards, and no activity object
  was mutated.
- ⚠️ **CONTRAST that bites:** un-chained, pass C plans **0** on this fixture while the chained preview
  plans **3**. If that ever stops differing, the dry run has stopped simulating.
- ⚠️ **The refactor is proved a MOVE:** HEAD is loaded in its own sandbox and its own inline expressions
  are evaluated against the same fixture using HEAD's own helpers — same lines, same codes, same
  confidences, same considered set. Two implementations compared, not one with itself.
- ⚠️ The fixture exercises **both rungs**: a line naming a place resolves on **location** and takes only
  the 3rd-floor activity, not both activities sharing its code — the money property the z1 entry records.
- The blocked-reason measurement across all three cases.
- 44 JS files + 30 inline blocks parse; 549/549 braces; 0 NUL bytes; all six new `boq-ma*` / `boq-blocked`
  classes resolve (`boq-clm` is undefined at HEAD too — pre-existing, already recorded).

⚠️ **Three of my own assertions were wrong before the code was**, each recorded in the suite: I expected
every split on the **location** rung when my fixture's descriptions named no place (the name rung is
correct there); I expected one activity per line when two activities legitimately shared a name; and I
compared what pass C *splits* against what HEAD *considers*, which differ when nothing is tagged. Asserting
the behaviour I assumed rather than the behaviour that occurs would have reported three bugs that do not
exist.

`boq.js` / `module.css` → `?v=20260910z7`; `MODULE_V` → `20260910z7`.
⚠️ **NOT verified signed in.** No pass has been run against a real project, so the three writes, the RLS
shortfall path and the between-pass re-plan are proved by execution against module state, never against
PostgREST. The first real run is the test — and the honest thing to watch is whether pass B's reported
count matches what it asked for.


### 2026-09-10 (z6) — ⚠️⚠️ HOTFIX: Contracts & Claims' entire BOQ has been dead in production since (z1). One deleted function, one line that still named it.

Owner, with a screenshot of the wizard's Trades step empty and a red toast: *"BOQ errors. Let's fix."*
Both symptoms, one cause, and it was live.

#### The bug
```
ReferenceError: locKey is not defined
  at boq.js?v=20260910z4:5270
```
`boq.js` is `window.BOQ = (function () { … })()`. Line 5270 sits in the `_internals` export — an
**object literal evaluated when the IIFE returns** — and still read `locKey: locKey`. (z1) deleted
that private function, replacing it with the shared `PDLoc`, and left the export naming it. So the
IIFE threw on the way out, **`window.BOQ` was never assigned**, and every feature that reads it went
down together:

| symptom in the screenshot | the line that produces it |
|---|---|
| red toast *"BOQ did not load."* | `createBoqDraft`: `if (!window.BOQ \|\| !BOQ.createDraft) throw` |
| **Trades step empty** | `addBoqTrades`: `if (window.BOQ && BOQ.addTrades)` — silently no-ops |
| the step could not tell which path it was on | `boqDraft()` returns null, so `boqPath()` cannot resolve |

⚠️ **Fixed by REMOVING the export, not by re-pointing it at `PDLoc.normKey`** — that is a different
function (it strips every separator, which is the whole reason the private one was retired for
missing *"Roof Deck"* vs *"Roofdeck"*), so keeping the old spelling would hand the next reader the
retired semantics under the retired name. Nothing in the repo reads `_internals.locKey`; checked.
⚠️ `affected.js` kept **thin delegates** through exactly this refactor, and its own (z1) entry says
why — *"keeping the local names so the `_internals` export its suite reads is untouched."* This file
deleted outright and missed the export. Same refactor, two files, one of them checked.

#### ⚠️⚠️ WHY THREE PASSES SHIPPED ON TOP OF A DEAD MODULE WITHOUT NOTICING
(z1), (z3) and (z4) all touched this file and all reported themselves verified. Every one of them
verified by **slicing a function out of the file and executing it** — which loads the slice, never
the module. And `node --check` **parses**; it cannot see a ReferenceError. This repo has recorded
that exact sentence twice before (the schedule's *"below is not defined"*, and stakeholder-map's
`canWrite`), and this is the third time it has cost a live module.

So the missing check is now written and run: **it EXECUTES each shipped browser script against a
minimal window stub and asserts the file's global actually gets assigned.**
- ⚠️ It does not stop at the first throw. It also reports **undefined-valued keys** in the public
  export and in `_internals`, which is what proves no *second* stale name is hiding behind the first.
  For boq.js: **20 exported keys, 39 `_internals` keys, 0 undefined.**
- ⚠️ One of my own stubs produced a false failure worth recording: `externals` is `Object.assign`'d
  over the window **last**, so listing `PDSync: {}` there silently overwrote the working stub above
  it and theme.js reported `sync.pendingCount is not a function` as if it were an app defect. A thin
  stub that shadows a good one is how a harness invents its own failures.

#### Verified
- **The bug reproduced twice before being touched** — in the browser off the deployed page, and
  outside it, both naming line 5270. Fixed, both clean.
- **38 shipped browser scripts executed: 0 throw at load.** (Three `test*.js` are Node files using
  `require` and are correctly excluded; `auth.js` and `theme.js` needed real stubs for
  `supabase.createClient` and `PDSync.pendingCount` and are clean with them.) **The defect is
  isolated to this one line** — that is measured across the app, not assumed.
- 44 JS files + 30 inline blocks parse, 0 failures; 0 brace mismatches; 0 NUL bytes.
- `boq.js` → `?v=20260910z6`, `MODULE_V` → `20260910z6`. ⚠️ `z6`, not `z5`: `z5` is dashboard.css's
  current token from the pass before this one.
- ⚠️ **Not verified signed in.** The load-time failure is fixed and proved by execution; whether the
  Trades ladder then *populates* depends on the class-code read behind it, which needs a real session.
  That is the thing to check first: open the wizard and confirm the trades list has rows.


### 2026-09-10 (z5) — Project Schedule's phone bar painted itself over the activity list, because chrome is allowed to be crushed

Owner, with a screenshot: *"UI is bugged for Project Schedule phone view."* The toolbar, the data-date
badge, the project title and the avatar were all drawn **on top of** the activity cards. Not a
z-index problem and not a wrapping problem — a flex-shrink one.

#### ⚠️⚠️ THE MODULE BAR WAS BEING SQUASHED BELOW ITS OWN CONTENT
Measured on the live signed-in page at 375px, before anything was changed:

| | |
|---|---|
| `.pd-modulebar` used height | **52px** — exactly its `min-height` |
| its `scrollHeight` | **244px** |
| its children's bottom edge | **y = 302** — the box ended at y = 110 |
| overflowing itself by | **192px** |

The bar wraps to five rows at 375px (title switch · freshness pill + data-date badge · tools · view
switcher) and reported a *used* height of one row.

⚠️ **The cause is not the wrapping and not the `min-height`.** Project Schedule sets
`.pd-content { height: 100vh; display: flex; flex-direction: column }` to dock its details panel into
the viewport — a deliberate desktop design, with its own comment. That makes the topbar and the module
bar **flex items of a height-constrained column**, and a flex item defaults to **`flex-shrink: 1`**. So
once the column's children exceed 100vh the browser shrinks them, `min-height` stops it at 52px, and
`overflow: visible` paints the other four rows downward over whatever follows. Exactly the screenshot.

**Fix: `flex-shrink: 0` on `.pd-topbar` and `.pd-modulebar`.** Chrome holds its own height and the
CONTENT area gives way instead — which is what the docking layout wanted all along.

#### The blast radius, measured rather than reasoned
Three modules turn `.pd-content` into a column flex container — project-schedule (`height:100vh`),
drawing-register (`body.dr-fit`) and material-submittal (`body.ms-fit`). Only the first has a **hard
height**, which is why only it shows the bug today; the other two are one `height` away from it.
⚠️ For **the other 13 modules `flex-shrink` is inert**, because `.pd-content` is not a flex container
there at all — and that is proven, not assumed (table below).

#### Verified — with the BEFORE pinned to a SHA, not to `HEAD`
⚠️ `git show HEAD:` silently becomes self-comparison the moment the fix is committed, so the contrast
is built from **`601ac2a`** explicitly.

| viewport | case | `flex-shrink` | bar box | bar content | children painting over content |
|---|---|---|---|---|---|
| 375 | **BEFORE**, project-schedule | 1 | **52** | 210 | **5** |
| 375 | **AFTER**, project-schedule | 0 | **221** | 220 | **0** |
| 375 | BEFORE / AFTER, no module css | 1 / 0 | 176 / **176** | 175 / 175 | 0 / 0 |
| 1400 | BEFORE, project-schedule | 1 | 52 | 51 | 0 |
| 1400 | **AFTER**, project-schedule | 0 | **55** | 54 | 0 |
| 1400 | BEFORE / AFTER, no module css | 1 / 0 | 55 / **55** | 54 / 54 | 0 / 0 |

- The five elements the harness names as painting over the content are the five in the owner's
  screenshot: the title switch, the data-date badge, the tools cluster, the view switcher and the
  freshness pill.
- **The other 13 modules are byte-identical** at both widths — the regression case that mattered.
- ⚠️ **Desktop project-schedule moves 52 → 55px, and that is a FIX, not a regression.** 55 is what
  every non-docking module already measures; the 52 was the same shrink happening quietly, with a
  wrapping flex container compressing its single line by 3px. The docking module now agrees with the
  rest of the app.
- ⚠️ **My first harness reproduced NOTHING** — it put a stub in `.pd-main`, so the column's children fit
  100vh, the flex algorithm had no reason to shrink anything, and BEFORE looked healthy. The crush
  needs a `.pd-main` that cannot give way, which is what the live page has (`clientHeight` 812 against
  `scrollHeight` 15042). It is now tested with `.pd-main` both shrinkable and not; **both crush.**
- 44 JS files + 30 inline blocks parse, 0 failures; dashboard.css 531/531 braces; 0 NUL bytes across
  31 files.
- `?v=` → `20260910z5` on dashboard.css (30 pages — `person.html` is new since `x1`).
  ⚠️ `z5`, re-derived from the remote **after** integrating: a concurrent session took `z1`–`z4` while
  this was in progress, and `x2` would have sorted *before* what a browser already holds.
- ⚠️ **Not verified on the live page**, and the reason is worth recording: the browser session signed
  out mid-investigation, and signing back in is not something I do. The measurements above are against
  the real shipped stylesheets in a real browser; the confirming look at the deployed page is not done.


### 2026-09-10 (z4) — The class-code library stops being de-zeroed, and a group code stops reading as an error

**Run `migrations/2026-09-10-class-code-group-names.sql`.** Owner: *"let's fix the CLASS_CODE_DB
de-zeroing next"* — the item (z3) named as reported-but-not-fixed. Detail, and the two harness
mistakes worth keeping:
[`modules/project-schedule/CLAUDE.md`](modules/project-schedule/CLAUDE.md).

- **43 codes padded.** `CLASS_CODE_DB` is Finance's Level-2 group chart, and all 197 entries now
  match a real `code_l2`. Applied by a script that edits only the first field of a line inside the
  literal and refuses any code that does not then resolve; **0 duplicates before or after**, line
  count unchanged, no name or trade altered.
- ⚠️⚠️ **Padding alone would have bought nothing, and that was the real defect.** `class_codes` is
  keyed on the ITEM code, so the resolver could never resolve a group however it was spelled —
  **197 of 197 library codes read as unrecognised**, which is every activity the Schedule Builder
  has ever pushed. An activity is coarser than a bill line by nature: a group ("Chilled Water AC
  Works") is the size of something you schedule, an item ("Chilled Water Condenser Riser (B.I
  Pipes)") the size of something you bill. `ccLevelOf` now answers **item | group | neither**,
  resolving the group side from `code_l2` / `desc_l2` — columns already on every loaded row, so no
  second fetch and no second source to keep in step.
- ⚠️ **The item index always wins.** Four of the 205 groups also exist as an L3 code, where the
  group's general item carries the group's own number; those read as the item, which is the more
  specific true answer.
- ⚠️ **A group code is toned, not coloured like an error** — the red is reserved for a code that
  resolves at neither level. Measured on the row it sits on: item **16.30 / 12.22**, group
  **7.07 / 7.02** light / dark, all three states distinguishable in both themes.
- **The BOQ allocator meets it halfway.** A line carries an item code and a builder-made activity a
  group code, so exact equality matched nothing between them and the allocator proposed nothing at
  all on such a schedule. It now falls back to the group — ⚠️ but **exact wins as a set**: the
  coarser candidates are never offered alongside an exact one, or a whole-group activity would
  dilute a split that had a precise answer. ⚠️ The group comes from the chart's `code_l2`, never
  from truncating the code, which would be de-zeroing in another costume.
- **The migration corrects two chart errors** the audit found: `25200` is labelled *Chilled Water AC
  Works* but holds only Fresh Air Duct items, `25550` is labelled *Stair Pressurization* but holds
  Kitchen Exhaust items — each the name of the group above it. ⚠️ Written **by `code_l2`, never by
  `code`**: `desc_l2` is denormalised across every item of the group, so a single-row update would
  leave the group answering two different names. ⚠️ 11 trade disagreements are **left alone** —
  choosing between the chart's *Others* and the library's *Site Works* is Finance's call.

**42 new assertions (240 across five suites), 0 failing**, with the pre-change revision executed as
the contrast — it leaves 43 codes unresolved, flags a group code as unknown, and returns **0
candidates** for a group-coded schedule.
⚠️ **Not verified signed in** — no activity has been pushed with a group code and read back, and the
migration has not been run.
⚠️ **Measured and deliberately not fixed:** `.ps-cctag.unknown` computes **3.40:1 on dark**, under
AA — it uses the brand surface red where `--pd-bad-text` exists. But `color:var(--pd-red)` appears
**120 times in project-schedule alone**, so fixing one is worse than fixing none. Its own sweep.

`MODULE_V` → `20260910z4`; contracts-claims `boq.js` with it.

### 2026-09-10 (z3) — The Schedule Builder seeds its activities from the project's own BOQ

Owner: *"let's do the schedule builder seeding from the high-level BOQ."* The last of the three
hand-offs, and the one that had nothing. Detail, the two pre-existing defects it exposed and the
layout defect measurement caught:
[`modules/project-schedule/CLAUDE.md`](modules/project-schedule/CLAUDE.md). What reaches beyond the
module:

- **`+ From BOQ`** in the Activities step's holding pane loads only the class codes this project's
  **current** BOQ revisions carry, reading `boq_revisions` + `boq_class_map` + `boq_items` under the
  caller's own RLS and writing nothing. It fills the same list `+ Library` does, so ticking and `←`
  are the accept step already there — ⚠️ deliberately not a second propose→preview→apply modal, since
  the holding list is the preview and ticking is the acceptance.
- ⚠️ The mapping is the **exact inverse of Contracts & Claims' `addAuthoredLines`** — `desc_l3` →
  activity name, `desc_l2` → the Construction Library grouping, Finance trade → builder group. The
  two directions have to agree on the string or a round trip renames everything.
- ⚠️⚠️ **`parseTrade` recognised three of Finance's seven trade values — 458 of 702 chart codes would
  have landed in Others.** `'Structural Works'`, `'Architectural Works'`, `'MEPF Works'` and
  `'Allied Services Works'` all returned null. It also meant this module could not read back the
  `work_type` labels it writes itself, so pasting a Trade column out of the schedule into this grid
  silently cleared four of eight trades. Both fixed by naming the vocabularies.
- ⚠️⚠️ **And the `+ Library` list cannot produce a valid class code at all.** `CLASS_CODE_DB` is
  Finance's **Level-2 group** chart with the leading zeros stripped — 197 entries, 43 of which match
  an L2 group only after zero-padding, and **zero** of which are valid Level-3 codes. The push writes
  `class_code = a.code`, so every library-seeded activity carries a code that resolves to nothing and
  the BOQ allocator can never gate on it. **Not fixed here** (padding makes them correct L2 codes and
  still not L3 — a different, larger decision); **reported on screen** instead, beside the button
  whose codes do resolve.
- **That is the payoff and it closes this morning's loop:** a BOQ-seeded activity arrives already
  carrying a resolvable Finance L3 code, so the four-rung matcher shipped in Contracts & Claims at
  `z1` matches it with no manual tagging step at all.

⚠️ **A correction to the 2026-09-08 (a) §4 audit table**, which lists *"detailed schedule → detailed
BOQ: ❌ nothing"*. That has not been true since 2026-09-07h. With this commit **all three of the
owner's hand-offs exist**; the middle one (tagging) has since August.

**56 assertions, 0 failing**, sliced out of the shipped file with the pre-change revision executed as
the contrast. ⚠️ A real layout defect caught by measuring: a second button in the `nowrap` header
shredded both labels (header 36 → 59px at the pane's 320px default, 81px with the label on **three**
lines at its 180px minimum). Fixed with nowrap + a wrapping header + a shorter label; the resting
state is back to one row at 36px, no overflow at any width, both themes.
⚠️ **Not verified signed in** — the loader's three reads have never run against a real BOQ.

`MODULE_V` → `20260910z3`, re-derived from the remote's `z2` **after** rebasing onto it — that commit
touched the same 44k-line file and the two sets of edits auto-merged, checked afterwards by asserting
both sides are present.

### The camera survives the scrubber, both compare panes turn together, and the per-zone question is answered (2026-09-10) — ethanrobles10

Owner: *"return the progress per zone, aligned with the schedule … whenever the progress bar is
moved, please retain the view being displayed … in planned vs actual, whenever there are view
changes on the right, please also change the left (planned) pane."*

⚠️⚠️ **Per-zone progress had been asked about three times and closed twice with an answer that
cannot be followed.** Measured on the shipped code: where a zone IS recorded, Detail 2 draws one
block per zone and each fills on its own schedule (Zone A 100% while Zone B is still 0% at the
same as-of date). Where **no** zone is recorded, `_vsRowCells` folds every activity into one `'—'`
bucket — the Detail 1 drawing, reporting the floor's number, under a Detail 2 label, with nothing
saying why. So "switch Detail to 2" changed nothing and the planner watched the whole floor move
as one. Nothing was wrong with the progress; **the zone column was empty and the view hid it.**
Detail levels nothing is filed under are now disabled and carry the reason, naming the level
(*Zone*, not "locations"); `_vsDetailNow()` clamps to the depth the data supports; a banner states
the gap; and the footer stops recommending a switch that would draw the identical building.

**The camera was thrown away on every frame of a scrub** — `renderVStack()` rebuilds each scene
and `_vs3Build` ends with `setView('iso')`. There is a camera memory per card now, harvested
before the dispose and replayed after the build, and `view()` was not enough on its own: it names
the last viewpoint *button*, so a hand-dragged angle came back as the nearest preset (the focus
window had the same half-fix). `cam()`/`setCam()` carry the orbit and the zoom — the zoom as a
**ratio** of each model's own default radius. The horizontal scroll is kept too.

**Planned vs Actual is one camera.** The viewpoint bar was per pane, deliberately; the owner
overruled it and is right, because 2D compare already drives both panes on hover, pan and zoom.
One bar above both panes, and every orbit or click on either model drives the other. ⚠️ The
`silent` flag on `setCam` is the re-entrancy guard — without it the first drag ping-pongs between
the panes forever.

**Verified by execution** (17 assertions, 0 failing) and, for the pane linking, in a real browser
against the shipped wiring: clicking the shared bar tells both scenes; orbiting the right pane
moves the left to the same azimuth with no echo back. ⚠️ Not verified signed in (no grants on the
anon key) — no WebGL scene was built against this project's data.

`MODULE_V` → `20260910z2` (⚠️ re-derived from the remote after a concurrent session took `z1`
mid-work — the exact collision this log records). Detail: [`modules/project-schedule/CLAUDE.md`](modules/project-schedule/CLAUDE.md).

### 2026-09-10 (z1) — Matching the BOQ to the schedule: four rungs instead of one, and a location key that was wrong twice

**Run `migrations/2026-09-10-boq-match-rung.sql`.** Owner: *"How should we match the BOQ to the
schedule?"* Full detail, every ⚠️ decision and the two of my own assertions that were wrong before
the code was: [`modules/contracts-claims/CLAUDE.md`](modules/contracts-claims/CLAUDE.md). What
reaches beyond the module:

- ⚠️⚠️ **New `assets/js/locmatch.js` (`PDLoc`) — there were THREE copies of the location normaliser
  and one of them was wrong.** The schedule's `_locNormKeyCalc`, `affected.js`'s deliberate
  cross-asserted duplicate, and `boq.js`'s own `locKey`. Executing the third against the first found
  two real defects: it **missed** `"Roof Deck"` vs `"Roofdeck"` (a real pair on the Jab schedule),
  and it **matched a 13th-floor leaf to `"3rd Floor"`** — it kept the spaces, so
  `"…at 13 floor".indexOf("3 floor")` is a hit. Measured on the fixture, HEAD hands a 13th-floor
  line **three** activities, two of them on the wrong floor. Both reproduced on HEAD in the suite.
- ⚠️⚠️ **That was a MONEY defect, which is why it is worth a shared file.** `boqDerive`
  (`project-schedule/index.html:38164`) splits a BOQ line's `amount` across exactly its allocations
  → `project_schedule.planned_cost` → `schedule_scurve_agg`'s `w_cost` → Cash Flow's cash-in. The
  old allocator offered ONE rung — every activity carrying the line's class code, a **tag** carried
  by forty floor-level activities — so a 3rd-floor line was smeared over forty floors by duration
  pro-rata and every screen downstream reported it as fact.
- ⚠️ **`PDLoc.contains` is not a one-line `indexOf`**, and that is the whole reason it is a function.
  `normKey` strips every separator (which is what fixes Roofdeck), so a plain containment test
  re-creates the digit-boundary bug in the other direction. It rejects a hit with a digit
  immediately outside a numeric edge of the needle — the "8th and 18th get merged" trap `locKey`'s
  own comment warned about.
- ⚠️ **`project-schedule`'s copy is deliberately NOT rewritten here.** It is a 43k-line file under
  concurrent edit and swapping the function that decides every location grouping in the Vertical
  Stacking is its own commit with its own verification. The suite asserts `PDLoc` agrees with it
  over a spelling corpus instead — the precedent `affected.js` already set for the same pair.
  ⚠️ So `locmatch.js` is loaded by **one** page today, not two. It is a shared asset by intent, not
  yet by use, and the schedule's adoption is the follow-up.
- **`affected.js`'s duplicate is retired** to thin delegates, keeping the local names so the
  `_internals` export its suite reads is untouched and the diff stays checkable.

Also fixed, both live and both found by measuring rather than reading: the allocation dialog's qty
field was **`type="number"`**, so `1,000` read back as `""` and wrote a silent **zero** into an
allocation (the trap fixed for the Lines grid in August and never carried across); and
`allocHTML`'s class-code cell was an unguarded `CMAP[r.id].class_code` that would have thrown on the
first heading-mapped row.

⚠️ **A correction to the 2026-09-08 (a) §4 audit table:** it lists *"detailed schedule → detailed
BOQ: ❌ nothing"*. That has not been true since 2026-09-07h — `openSeedFromSchedule()` /
`scheduleSeedPlan()` reads the tagged programme and writes the lines **born matched**. Nothing was
built for it here; it needs exercising, not writing.

**138 assertions across three suites, 0 failing**, every function sliced out of the shipped file and
**HEAD executed as the contrast** in all three. Rendered against the real stylesheets at 1440 and
918 in both themes: rung chip **6.76:1 light / 8.04:1 dark**, no page horizontal scroll.
⚠️ **Not verified signed in** — no allocation written against a real project and the migration has
not been run.

`boq.js` / `affected.js` / new `locmatch.js` → `?v=20260910z1`; `MODULE_V` → `20260910z1`.
⚠️ `z1`, not `y10` — `y10` sorts *before* `y9`. Re-derived from the remote **after** rebasing onto
its 7 commits, which is the rule this log has now arrived at five times.

### The stacking bar loses a row, and the Fit button it lost was already dead (2026-09-10) — ethanrobles10

Owner: *"cleanup the UI just below the header. i think it is too much. you can remove the Fit
button."*

⚠️⚠️ **The Fit button had been doing nothing for two weeks.** It toggled a flag whose only effects
were an `is-fit` class on the stage and a `--ps-vs-fith` property on the grid — measured by a
careful two-pass routine — and **neither was read by any CSS rule in the file**. Its own tooltip
still advertised the magnifier, deleted 2026-09-02, which is the clue nothing had exercised it
since. Removing it changes no pixel of the drawing: what fits the stack is `--ps-vs-paneh`, which
is live and untouched. The flag, both passes, the class and the `ps_vsfit` key all went with it;
the focus window's own Fit, which is wired to a real transform, stays.

**The legend was a paragraph parked in a row of buttons** — `flex:1 1 100%`, so it claimed a whole
row and wrapped inside it. Nothing deleted, demoted: the glance-level part stays visible (and the
DONE colours stay *in* their colours), the two long explanations move into its `title`. Visible
legend text **176 → 66 characters** in Actual, **360 → 87** in Planned vs Actual.

Measured in a browser against the app's real CSS, from the shipped builder sliced and executed:
at an 1798px pane the bar goes **65px → 58px** in Actual and **3 rows / 110px → 2 rows / 58px** in
Planned vs Actual; at 1200px, **4 rows / 97px → 3 rows / 71px**. Dividers 6 → 5. ⚠️ Not verified
signed in (no grants on the anon key) — the claims are about the bar's markup and layout.

`MODULE_V` → `20260910y9`. Detail: [`modules/project-schedule/CLAUDE.md`](modules/project-schedule/CLAUDE.md).

### ⚠️⚠️ The floor was drawn at a quarter of its size at Detail 1: the wrap grid was sizing the plan (2026-09-10) — jasantos2

Owner: *"the size of the floor is decreased when proceed with level 1 - detail. Like i said,
allow users to define in the floor plan the size of the floor."*

Measured before it was touched, by executing the shipped builder both ways on one traced plate:
**Detail 2 gave a 2 × 2 plate, Detail 1 gave 1 × 1 — the same plan at 25% of its area.** The
plate's size in world units was `cols × rows` of the **wrap grid**, the layout meant for cells
that have no plan, and that grid comes from the cell COUNT: four zones make 2×2, one cell makes
1×1. The traced plan had nothing to do with that number and was scaled by it anyway — the same
class of mistake as the two before it, a value describing the GUESS applied to the STATEMENT. A
traced card's plate is a constant now; an untraced one keeps the wrap sizing, which is what the
footer has always said it is.

And the **sheet was fixed at 1000 × 620 with no way to change it** — every plan, portrait or
landscape, traced on the same landscape rectangle, which *is* the floor's proportions as far as
the 3D is concerned. There is a **Sheet** control now (Wide 3:2 · Square · Tall 2:3 · Fit to the
image), attaching an image adopts its shape while nothing is drawn, ⚠️ changing it **rescales what
is already drawn** (points are stored in plan units, so raising the height without touching them
would bunch every zone against the top), and the sheet's ratio crosses the module boundary so the
3D plate is as deep as the drawing says.

**240 assertions across fourteen suites, 0 failing** — the size bug is asserted against the
revision before the fix, executed on the same input.

### The 3D card's controls collapse to one Display button, and the fill level gets a line (2026-09-10) — jasantos2

Owner: *"can you simplify the UI, i think too much buttons and information, propose a simplified
UI yet still pleasing to the eye. In addition, how come the progress per zone is removed? pls
bring that back."*

⚠️⚠️ **Twenty-one controls in one flat row, and the one used every few seconds was last.** The six
**viewpoints** stay out in the open (Iso lit, because that is where every scene starts) and
everything set once and then left alone — plan wrap, front edge, colour meaning, floor markers,
Sync — is behind one **Display** button that carries a count of how many are off their default,
so nothing hidden is a surprise. It is a `<details>`, not a hand-built popover: no outside-click
handler to leak, keyboard-reachable for free, and its open state survives the repaint every
control inside it triggers. The **footer** was six sentences under every card at once; it is one
line now — what a block is, whether the layout is real or guessed, and the schematic warning in
short form — with the standing explanation behind *What am I looking at?*. In the floor-plan
window, the two facts stated once per floor (which way it faces, and the floor's own shape) share
one row instead of two.

⚠️⚠️ **Per-zone progress: the maths never changed, the reading did.** Every zone has always filled
on its own percentage — but a horizontal split across a zone's *width* is tens of pixels, while
the vertical one inside a storey's *height* is about two on a twenty-storey tower, so per-zone
progress stopped being legible, which for the person looking at it is the same as gone. There is
now **a hairline at the fill level** — carved out of the done slice, never laid over it, so the
z-fighting fix still holds — in a light tint of the trade's own hue, measured at 65.0 / 40.3 ΔE
against remaining / done in the light theme and 53.4 / 28.3 in dark.

**230 assertions across thirteen suites, 0 failing.** ⚠️ The bar was also *looked at*: rendered in
a browser from the shipped `_vs3Bar` / `_vs3Foot` output against the app's real `dashboard.css`,
in both themes, through a throwaway gitignored harness.

### At Detail 1 the floor plan disappeared; the floor's shape is now its own control (2026-09-10) — jasantos2

Owner: *"how come when clicking level 1 detail, the floor plan size disappears? … can you add an
option of defining the shapes of the zones AND for the floors, so that way we can distinguish the
difference between them"* — and *"how come the progress per zone was removed?"*

⚠️⚠️ Detail 1 draws a storey as ONE cell with an empty label, so no zone can match it, and the
only thing that answered for a whole floor was an explicitly drawn outline — a control that had
shipped as a swatch at the end of the **zone** palette, where it reads as another zone. A planner
who traced four zones and no outline got a guessed box the moment they switched to Detail 1. **A
floor with zones and no outline now takes its shape from those zones**; an explicit outline still
wins, because a podium slab bigger than the zones on it can only be stated by drawing it.

The two shapes are now two controls: the outline is out of the zone palette and has its own
**Floor shape** row, which states which of three cases the floor is in (drawn as *n* areas, taken
from the *n* zone areas traced, or nothing traced yet) and carries the same double duty the zone
palette has — with an area selected it makes that area the outline, otherwise it loads the brush.

⚠️ On the progress: per-zone was not lost — the suite now pins it (Detail 2, a two-zone storey at
25% and 75%, builds two blocks filled to 0.138 and 0.413 of the storey height, each from its own
traced outline; Detail 1 is one block at the floor's own progress). What was missing is that the
card never SAID which grain it was drawing, and the footer now names it.

**219 assertions across thirteen suites, 0 failing** — the Detail-1 loss is asserted against a
control: the same plate through the previous revision returns no shape at all.

### ⚠️⚠️ Every trade was drawn with the first trade's floor plan (2026-09-10) — jasantos2

Owner: *"the defined section for structural is coinciding the defined floor plan and zoning
shapes with other trades … I have defined a new floor plan for architectural and yet this is
being shown."*

Zoning is **per trade** — a plate is pointed at a floor id, so Architectural's *Level 3* and
Structural's *Level 3* are two different floors that share a name. The map that crosses the
module boundary was keyed by that **name alone**, with `if (!out[k])`, so the project got one
plan per floor name from whichever trade came first in `cfg.zoning`'s key order and **every card
drew it**. Re-drawing the Architectural plan could not change what the Architectural card showed:
it was never being asked for.

The map is keyed **`trade|floor`** now, with the trade's aliases emitted at the source (the
canonical work label, the short label, the key) rather than guessed at the far end. ⚠️ The bare
floor key survives **only when every trade that named that floor points at the same plate** — it
is what a per-tower or consolidated card reads, and when the trades disagree it emits nothing so
that card falls back to the wrap instead of borrowing someone else's building. The card's trade
is derived in `_vsTowerModel` (a card whose activities are all one trade IS that trade), and the
footer now separates **"not traced"** from **"traced, but under another trade"** — a distinction
that could not even be expressed before.

**203 assertions across twelve suites, 0 failing.** ⚠️⚠️ HEAD is executed as the control: on the
same two-trade setup it hands both cards the same outline — the bug, reproduced — and this file
hands each card its own.


### 2026-09-10 (y5) — The edit form takes the read view's shape, and one Save becomes two scoped ones

Owner, four things at once: *"I don't think this pop up window is necessary anymore. We can have a
save globally or save project only to scope the edit. Under this view, it is not apparent that the
fields aren't editable. Check when I am editing the person it saves when I edit anything from the edit
page. Is it possible if the edit just follows the format of the view so the user doesn't see a new
arrangement of the fields."*

#### ⚠️⚠️ ONE PRIMITIVE MADE THE FORM MATCH THE VIEW
`.sm-frow` is the form's **only** layout element — 18 of them — and it was `display:flex`, packing
two or three controls per row while the read view stacks one per row with the label above. Stacking it
gives the whole form the read view's rhythm. **Measured: `fieldsPerRowMax` is 1**, and `.sm-frow`
computes `block`. Asked which way to reconcile it with the register's own form, the owner chose to
**restyle that form** rather than build a second one — so there is still one form and both callers get
the new arrangement. ⚠️ The accepted cost is a longer scroll in **+ Add**: 39 controls in one column.

#### Two scoped saves, and why "project only" cannot mean what it sounds like
*Save this project* / *Save for all projects* replace the single Save, and **"Edit person…" is gone** —
its fields were these fields.

⚠️⚠️ **The two scopes differ in WHICH TABLE is written, never in which project an identity belongs
to.** `overlayPeople()` copies every directory field over the row on load, so a name saved "to this
project only" would be **overwritten on the next read** — it would look saved and silently revert.
So: *this project* writes the assessment; *all projects* also writes the person.

**Measured both:** *all projects* produces **2 updates** (the directory identity and the project row);
*this project* produces **1**, and a name typed into the identity box **does not reach the directory** —
the mirror carries the *person's* name, not the typed one. That is the existing `shared ? person.name
: inputs` guard, and it is what stops a project save re-asserting a stale snapshot over somebody
else's directory edit.

⚠️ The identity write uses `.select('id')` **and a length check** — PostgREST answers an RLS-filtered
UPDATE with 200 and zero rows — and is **guarded on `window.PDStakeholders`**, matching how
`confirmPerson` already treats that helper as an optional script rather than assuming it loaded.

#### Autosave is off on the person page only
⚠️ It fires a debounced click of the real Save ~1.2s after any keystroke. With two scopes it would
have to **choose one on the planner's behalf**, and the one it would choose writes a different table
from the one they may have meant. **Measured: `autosaveWired` is false on the page.** The modal keeps
it — there is one scope there.

#### A locked field stops looking like an empty box
⚠️ It keeps its input (the value stays selectable and the layout does not shift) and becomes
unmistakably inert: no fill, **no border**, and a `🔒 PORTFOLIO` mark on the label. **Measured for a
viewer: 3 of 3 identity fields disabled, the badge present, and the input's border computes
`rgba(0,0,0,0)`.** ⚠️ Keyed on `.pd-field:has(input:disabled)` in CSS rather than a class threaded
through the markup — that would have meant a blanket replace across a 2,400-line file, putting a
variable into functions that never declare it, **which is exactly the ReferenceError shipped in (y4)
an hour earlier.** The same mistake, refused the second time.

`MODULE_V` → `20260910y5`; stakeholder-map `module.js`/`module.css` → `?v=20260910y5` on **both**
referencing pages.
⚠️ **Not verified signed in.**
⚠️ **NOT DONE, and asked for in the same message:** splitting *Name of stakeholder* into first and
last name. It needs its own migration, and a backfill rule that is genuinely ambiguous on Filipino
names — `Marco Dela Cruz` and `Maria Santos Cruz` do not split on the last space. It is the next piece.

### 2026-09-10 (y4) — ⚠️⚠️ HOTFIX: the register came up empty. I called a function that did not exist.

Owner, with a screenshot of a populated KPI strip over an empty page: *"A regression. The stakeholder
isn't shown in the page."* Correct, and it was live.

#### The bug
(y2)'s selection markup calls `canWrite()` in two places — the row's checkbox cell and the header's
select-all. **`canWrite` was never defined in that module.** It gates writes nowhere else; it relies
on RLS. So `renderTable()` threw a `ReferenceError` on every paint, and because `render()` runs
`renderKpis()` → `renderTable()` → `renderCards()` in that order, **the throw took the cards with
it**: the KPI strip painted, and everything below it did not. Exactly the screenshot.

#### ⚠️⚠️ Why the verification missed it, which is the part worth keeping
`node --check` cannot see a `ReferenceError` — it is a runtime fact, and this log already records that
lesson under *"below is not defined"*. Both harnesses were blind to it for **different** reasons:

- the **view harness stubbed `renderTable` out** — it was testing `switchView`, so it replaced the
  very function that throws;
- the **mount harness runs on `person.html`**, where (y2) deliberately guards `render()` off with
  `if (!document.getElementById('sm-table')) return;` — so the whole render path was skipped.

Two green harnesses, one broken function, and neither could have failed. **A new harness now carries
the register's real markup and runs `init()` end to end**, so `renderKpis` → `renderTable` →
`renderCards` all execute against the shipped module with only its externals stubbed.

⚠️⚠️ **And the contrast build BITES, which is what makes the green run mean anything.** The identical
harness pointed at `git show HEAD:` — the broken bytes — reports **4 KPIs, 0 cards, 0 table rows, 0
groups**: the owner's screenshot reproduced. Against the fix: **4 KPIs, 2 cards, 2 rows, 2 groups, 0
page errors.**

#### Also verified, now that the path actually runs
Select one → the bar reads *1 selected · Clear · Delete 1*; select-all ticks **2 of 2**; the bulk
delete issues **ONE statement carrying both ids** and toasts *"Deleted 2."*; a stubbed RLS shortfall
(2 asked, 1 removed) toasts **"Deleted 1 of 2 — the rest were refused"** rather than a false success;
and a **viewer** gets 0 checkboxes and no select-all while the cards still render.

#### ⚠️ Two version mistakes in the same round, both caught before pushing
- The (y2) bump rewrote `module.js` / `module.css` in **five unrelated modules** — every module has a
  file of that basename, the false-sharing trap this log already records for the `?v=` audit. Reverted.
- Then the (y3) attempt bumped `stakeholder-map/module.js` on **its own page only** and left
  `person.html` — which now loads that same module — on the previous token, producing a genuine
  **version split** the asset audit caught. Both pages are bumped together now.
- ⚠️ `MODULE_V` is **y4**: the concurrent session took `y3` while this was in progress. Re-derived
  from the remote **after** integrating, which is the rule this log arrived at the last four times.

`MODULE_V` → `20260910y4`; stakeholder-map `module.js` → `?v=20260910y4` on **both** referencing pages.
⚠️ **Not verified signed in** — the render path is executed against a stub, not a live project.
### Progress fills upward, the striped shading was z-fighting, every floor is named, the front is an object (2026-09-10) — jasantos2

Owner: *"hopefully there is a label for all floors … make it that the progress for the 3D version
is from bottom to top … the shades are like unstable or not uniform … remove the front faces etc.
I just want you to add a feature wherein users are just able to place an object and then you
would be able to identify which is the front face of the project."*

⚠️⚠️ **The "unstable shades" were Z-FIGHTING, and the vertical fill is the same fix.** The done
stretch was a second, narrower block sitting **inside** the dim one, lifted by a thousandth of a
unit to win the depth test — four of its six faces coplanar with the block around it. At this
camera's range the depth buffer cannot separate two surfaces that close, so which one is in front
is decided per pixel and changes as the model turns: that is the mottled, striped shading in the
owner's screenshot. A zone is now **two disjoint slices stacked in height** — done from the floor
of the storey up to its percentage, remaining above it. Nothing overlaps, no nudge is needed, and
the progress reads bottom to top. `_vsClipX`, which cut a traced outline at the progress fraction,
is deleted; the compare mark, a vertical blade at a fraction of the zone's *width*, became a
horizontal band at the baseline's *height*.

**A label for every floor**: the first cut dropped all but ~14 at build time, so a floor could not
be named however far you zoomed. Every storey has one now, and the only thinning is per frame —
⚠️ at a 17px threshold taken from the label's own height in the CSS, not guessed.

**The front is an object you place.** The four N/E/S/W buttons are gone from the floor-plan
window; the planner drops a marker on the frontage and the nearest edge of the sheet is the front,
derived and drawn back on the drawing. ⚠️ Stored and compared in fractions of the sheet, so
replacing the plan image cannot move it to another edge; ⚠️ setups that named their front on the
old screen are still read, the marker wins when there is one, and **Remove clears both** — "removed
but still facing east" is the one state the pair must never produce.

**181 assertions across ten suites, 0 failing** — the z-fighting fix is asserted on the geometry
the builder actually produces: two boxes, touching but not overlapping, same footprint, neither
nudged.


### 2026-09-10 (y2) — The register's form is folded onto the person page, and the row loses Edit and Delete

Owner: *"Fold the register form onto the person page… I also need an edit button from this page as
well. Remove the edit stakeholder from the register page. All edits should only be available at the
person page. Delete button shouldn't be here as well but we should consider bulk delete."*

#### ⚠️⚠️ THE FORM IS NOT EXTRACTED AND NOT COPIED — the modal became one of two hosts
`openForm` is **619 lines** carrying the photo well, six RCM bands, every derived preview and the
autosave wiring, and it reads ~38 things from the module around it. Lifting it into a shared file
would be a large rewrite of the most complex form in the app, verified against nothing; copying it
would leave two editors to keep in step — the failure this log keeps recording. But `openForm` uses
its modal handle **only as `{ el, close }`**: every field lookup goes through `m.el.querySelector`,
and `Autosave` takes `{ root, modal }`. So an element on another page satisfies the same contract.
`inlineHost()` is nine lines, the 619 are untouched, and the person page renders the **identical**
form. **Measured: mounting it opens 0 modals and 0 overlays**, and produces 39 inputs across all 8
bands with the identity fields disabled 3 of 3.

- ⚠️ `mountForm` deliberately does **not** call `init()` — that wires the register's toolbar, filters,
  collaboration presence and project picker, none of which exist on `person.html`. It sets the two
  pieces of state the form reads and loads the rows.
- ⚠️ `render()` gained a guard on `#sm-table`: `load()` ends in `render()`, which would reach
  `$('sm-clear').classList` and throw on a page with no toolbar. Guarded on the register markup
  itself rather than on a flag, because that markup **is** what render() needs.
- ⚠️ The host is told **before** the form closes — the page repaints from the saved row, and closing
  first would empty the element it is about to render into. **Measured: 1 UPDATE of 46 fields,
  `onSaved` fired, and Cancel empties the host and fires `onClose`.**

#### Editing leaves the register entirely
Row **Edit** and **Delete** are gone, and so is the card's Edit. ⚠️ `wireRowActions` is **deleted
rather than left dead** — a wiring function that matches nothing reads as a feature that exists, and
the next `data-edit` anyone adds would silently re-open a second editor. ⚠️ `+ Add stakeholder` still
uses the modal: adding is not editing, and the picker flow around it is the register's own.

#### Bulk delete, and where it goes
In the table's **own `.pd-dt-head` strip**, beside the row count. That component's note already says
a table's actions belong there rather than floating above the page, and a destructive action needs to
sit next to the number it will destroy.

- ⚠️ **Selection is table-only.** A card is a person; picking thirty of them by clicking cards is not
  a bulk gesture. The layout toggle is one click away.
- ⚠️ **"Select all" means the rows currently SHOWN**, never the whole register — anything else arms a
  delete over work the planner is not looking at. The selection is also **pruned on every render** and
  **not persisted**: one restored from localStorage a day later would arm a delete over invisible rows.
- ⚠️ **One statement, not N.** `.in('id', ids)` is a single round trip and a single RLS decision, and
  it **counts what came back** — PostgREST returns the rows it actually removed, so a shortfall is
  reported rather than rounded up to "Deleted 12". Deleting in a loop leaves a half-finished job on
  the first refusal with no way to say which half.
- ⚠️ The checkbox reuses the **same trailing cell** the two buttons had, so the band header's colspan
  arithmetic is untouched — a leading column would have shifted every band by one.

#### ⚠️ A pre-existing defect the fold exposed
The form printed **"1 · Identity & photo" twice**, with the scope banner sandwiched between the two.
**2 occurrences in HEAD before this change** — not introduced here, but found by rendering the form on
the page where it is now the first thing read. Removed; the band list measures 8, was 9.

#### The person page
An **Edit** button at project scope (writers only, and only when the person is actually on that
project), and ⚠️ `editing` and `projEditing` are separate flags because they edit different tables and
are gated differently. While the form is open the read view is **not drawn** — two copies of every
value on one page, one of them stale the moment you type, with the taller of the two on top.

⚠️⚠️ **The wide gutter with the sidebar collapsed was `.pp-wrap` being capped AND left-aligned.**
Collapsing the rail 240 → 64px handed all 176px of recovered width to one empty gutter on the right.
**Measured before: left 24 / right 172 at a collapsed rail, and 24 / 496 at 1700px. After: 28/28 and
190/190.** Centred, and the cap raised 1180 → 1320 since centring alone would have left two 88px
gutters.

`person.js`/`person.css` and stakeholder-map `module.js`/`module.css` → `?v=20260910y2`;
`MODULE_V` → `20260910y2` (re-derived from the remote after integrating, not guessed).
⚠️ **Not verified signed in** — the form is mounted and saved against a stub, never a real row.

### 2026-09-10 (y1) — A stakeholder has a page: one profile, two scopes, and identity locked to the portfolio

**New `person.html`, `assets/js/person.js`, `assets/css/person.css`.** Owner, items 3 and 4 of six:
*"When clicking on the stakeholder from the Portfolio View it just opens a pop-up for assigning a
project. I need to have the page where I will see the personal page of that stakeholder with details
and with user permissions I can edit that stakeholder"*, and on the project register *"instead let's
make use of the personal page as well. Information presented will be project-level only and view-only
for those items that are only should be editable in the portfolio level."*

Modelled on the separate Megawide Stakeholders app the owner pointed at — breadcrumb, a header card
carrying the face and one primary action, then **Personal details** beside an ownership panel, every
field label-above-value with an em dash where there is nothing.

- ⚠️⚠️ **ONE PAGE, TWO SCOPES, AND THE SCOPE IS IN THE URL** —
  `person.html#person=<id>` is the portfolio profile, `…&project=<PID>` is that project's view of the
  same person. A profile view built inside each module would exist twice and drift, which is the
  failure this log records for the S-curve maths and again for the identity matcher. One renderer;
  the scope decides only which blocks appear and which are editable.
- ⚠️⚠️ **WHAT IS EDITABLE WHERE IS A DATA FACT, NOT A UI PREFERENCE.** `stakeholders` is who a person
  *is*; `stakeholder_map` is one project's assessment of them. So identity is editable at portfolio
  scope only, and a project page renders those 13 fields **locked with a `PORTFOLIO` badge**. That is
  the owner's "view-only" ask, and it is also what stops two projects disagreeing about a name.
- ⚠️ **The save uses `.select('id')` and a LENGTH CHECK.** PostgREST answers an RLS-filtered UPDATE
  with **200 and zero rows** — the silent success recorded here since `boq_tag_activities`. **Measured:
  a refused save leaves the name unchanged on screen and warns, rather than reporting "Saved".**
- ⚠️ It writes through `PDStakeholders.writeTolerant`, so on a database without
  `2026-09-10-stakeholder-profile-fields.sql` the refused column is dropped and the rest still saves —
  **measured: two attempts, and the toast names what it gave up.**
- ⚠️ **A click now navigates; `openPersonPanel` is kept, not deleted.** Assigning to projects and
  merging duplicates act on the directory *around* a person rather than on the person, so they stay a
  dialog — reached from a new `⋯` button on the card and from the Health view's duplicate list.
- ⚠️ A register row with **no `stakeholder_id`** (written before the directory existed) has no profile
  to open, so it falls back to the register's own form rather than navigating to a dead page.

⚠️⚠️ **A defect the harness found and reading would not have:** `editing` is module state and the
project chips navigate to another scope of the *same* page, replacing no document — so leaving a
profile mid-edit opened the **next** person already in edit mode, over a form built from the previous
person's values. Reset on every load.

**Verified** by executing the shipped `person.js` against a stub that behaves like RLS: portfolio
scope renders 13 fields with **0 locked** and an *Edit profile* action for a planner and **none for a
viewer**; project scope renders **17 fields with 13 locked**, the Ownership panel and **6 OPS bands**,
and **0 inputs**; the editor gives 12 inputs and a 12-key patch; the refusal and the un-migrated
degrade both behave as above; two columns at 741/390px, the status dot resolving to `--pd-ok`, and no
horizontal page scroll.

⚠️ **Project-level fields are READ-ONLY on this page.** The register's own 31-column form already owns
writing them, with its derivations and autosave, and a second editor is a second set of rules to keep
in step — so the project page's primary action is *Open register*. Folding that form onto the page is
the remaining half of item 4 and is deliberately not in this commit.

New assets at `?v=20260910y1`; stakeholder-map `module.js`/`module.css` → `?v=20260910y1`;
`MODULE_V` → `20260910y1`. 30 pages, 50 assets, one version each.
⚠️ **Not verified signed in** — no real profile has been read or written.
### A floor with no zones can be shaped, the progress tones are measured, and the storeys are named (2026-09-10) — jasantos2

Owner: *"for floors without levels, there should also be an option for users to edit the shape of
that floor … look at the colors of the progress of the levels / zones, pls improve it … add like a
demarcation or floors that show which floor is this."*

⚠️⚠️ **A floor with no zones could not be given a shape at all.** The **Plan** button was only
emitted when the Activity level was Zone or Unit, and inside the window the Add/Trace row needed a
zone code to draw as — so on a floor-level project the shape of a storey was the one thing a
planner could not state, and the 3D drew a box. Both gates are gone: a reserved code (`*floor*`,
shown as "Whole floor") makes the outline an ordinary shape that every existing gesture already
handles, and the 3D extrudes it — ⚠️ only where the storey is a single cell, or a four-zone floor
would become four identical slabs in one place.

**The band with no floor** (activities carrying no level) can be given a plan too, ticked in the
window's *Also use this plan elsewhere…*, and it crosses the boundary under a ⚠️ **protocol key**
rather than under the words printed on the row, which are free to be reworded.

⚠️⚠️ **The progress colours were failing on the dark theme, and the light theme is why nobody saw
it.** Remaining was `colour × 0.42`, one walk toward black whatever the model stood on: measured
against the dark card, **9.5 ΔE** from the background — the same rule measures 69.6 on light. The
two tones are now **placed** on lightness rungs per theme, hue and saturation untouched: remaining
against its background goes 9.5 → **23.2** on dark, trade separation in the remaining tone 37.2 →
47.5 light / 60.1 dark, and done-vs-remaining — the progress read itself — is held at 26–28.5. ⚠️
The lights were also **clipping the model white** (top faces at 1.143 of full); 0.58 + 0.48 puts
them at 0.949 with a *larger* directional share.

**Floor markers**: a slab under every storey and an HTML label naming it, thinned to ~14 on a
forty-storey tower (top and bottom always kept, overlaps dropped), the grade line named, and a
`Floors · Labelled | Plain` toggle. **140 assertions across eight suites, 0 failing** — the colour
table above is the output of executing the old rule and the new one on the same palette, not a
description of them.
### 2026-09-10 (x2) — Frozen columns had eaten the phone table, and a sticky rail taller than the window cannot be scrolled to its end

Two owner reports in one pass: *"the table in the phone view can't be read properly due to the frozen
columns. Let's check for other modules as well"* and *"see side panel its short in the schedule setup
page. Let's do global check for this if there are cases that this is happening on other modules."*
Both asked for the same thing — the global check — and in both cases **the app already contained the
correct answer in other modules**; the fix is adoption, not invention.

#### ⚠️⚠️ THE FROZEN COLUMNS WERE CONSUMING THE DATA THEY EXIST TO LABEL
Measured on the live signed-in page at 375px, wrapper 353px:

| table | frozen | readable window | data columns visible |
|---|---|---|---|
| `.mp-mx` (Manpower) | 190 + 96 = **286px** | **67px** (19%) | **1 of 47** |
| `.mp-gt` (Manpower totals) | 210 + 150 = **360px** | **negative** | the data starts past the right edge |
| `.eq-mx` (Equipment) | 150 + 84 = **234px** | 119px | ~2 of 47 |

A frozen column exists so the label stays beside the data. At these widths it was replacing it.

⚠️ **Three modules had already solved this and these never adopted it** — material-submittal
(`.ms-fz2 { position: static }` + fz1 190→132), cash-flow (`.lbl` 200→118), portfolio-overview
(`.po-eq-c1` 236→150). All three do the same thing: **keep ONE frozen column, narrowed, and let the
second scroll away with the body.** Applied here with material-submittal's 132px reused rather than a
fourth number invented. Result at 375px: **frozen 286→132, readable window 89→243px** (harness), and
`.eq-mx` **234→132 / 141→243**.

Four more tables freeze `:first-child` with **no declared width**, so the frozen zone is as wide as its
longest label — the same failure, data-dependent instead of hard-coded: `.sc-table`, `.pr-ttable`,
`.pr-ed`, `.rl-matrix`. Capped at the same 132px with an ellipsis.
⚠️ **Those four are NOT measured live** — each sits behind a view I could not reach signed in. They are
the pattern applied, and a cap can only narrow, so it cannot make the current state worse. The
Manpower and Equipment numbers above *are* measured. `.rl-table`, the one actually on screen in
Resource Loading, measured **0 frozen columns** and correctly just scrolls — left alone.

#### ⚠️⚠️ A TALL STICKY COLUMN IS UNREACHABLE AT ITS BOTTOM
`position: sticky` does **not** scroll its own content. Once the element is taller than the window the
browser simply lets the page scroll past it, so the last items are only reachable if the *sibling*
column happens to be long enough to scroll that far. Schedule Setup's rail is 12 steps ≈ **578px**; on
a laptop window with browser chrome (~480px of viewport) steps 11–12 sit **98px below the window with
no way to reach them**. That is the "short side panel".

The fix is the **pair**, never `max-height` alone: `max-height: calc(100vh - 24px)` (derived from the
rail's own `top:12px`, not a magic number) **+ `overflow-y: auto`**, plus `overscroll-behavior: contain`
so reaching the rail's end does not start scrolling the page behind it.

#### The global check, and what it excluded
16 rules use `position: sticky` with a `top` offset. ⚠️ **11 of them are one-row BARS** — sticky table
headers, `.pd-topbar`, `.cca-gr-head`, `.pp-grid-head`, `.ps-net-head`, `.sbld-libL1` and the like —
which are one row tall and *cannot* have this bug; sweeping them in would have been 11 pointless edits.
**2 were already capped**, and they are the pattern: `.pd-sidebar` is `sticky; top:0; height:100vh;
overflow-y:auto`, `.po-dir-bands` uses max-height. ⚠️ My first classifier reported `.pd-sidebar` as a
defect because it only looked for `max-height` — `height:100vh` caps just as well. **The 3 genuine gaps
were all in project-schedule**: `.sbld-railcol`, `.sbld-rail` (Cost Loading's rail is not wrapped in a
railcol) and `.sbld-tower` (a tower card's zone list grows with the project).

#### Verified
- ⚠️ **The contrast case is built from `git show HEAD:`**, so the BEFORE genuinely fails: at a 480px
  window the old rail is 578px, `fitsWindow:false`, no scrollbar, **last step unreachable**. After:
  `max-height:456px`, `overflow-y:auto`, `clientHeight 456 ≤ 480`, `scrollHeight 578` → its own
  scrollbar, **last step reachable**.
- ⚠️ **My first rail test used a 600px window, where the 578px rail FITS — so BEFORE and AFTER both
  passed and it proved nothing.** Re-run at 480px, which is what the owner's screenshot shows.
- Frozen columns at 375px, both from the real module stylesheets: `.mp-mx` 286→132px frozen,
  `.eq-mx` 234→132px, each leaving 243px readable.
- 42 JS files + 29 inline blocks parse, 0 failures; 0 brace mismatches; 0 NUL bytes across 9 files.
- `MODULE_V` → `20260910x2` (six module pages changed; dashboard.css did not, so it stays at `x1`).
- ⚠️ **Not yet re-verified on the live site** — pushed and awaiting deploy at the time of writing.


### 2026-09-10 (x1) — Checking (w9) on the live signed-in page found three more targets and one dead line I had written

⚠️ (w9) was measured in an offline harness that rendered **only the topbar**. Opening the deployed
site signed in, at 375px, immediately produced things that harness could not see — plus a correction
to a claim I made in (w9)'s own changelog. Recorded because the lesson is the harness's blind spot,
not the pixels.

#### ⚠️⚠️ A CLAIM IN (w9) WAS WRONG: `min-*` DOES BEAT A FIXED `height`
(w9) added `.pd-filttoggle, .il-topfilttoggle, .pp-topfilttoggle { height: auto; width: auto; }` with
a comment asserting *"a `min-*` cannot beat a fixed `height`"*. **That is false.** `min-height` and
`min-width` always clamp the used size above `height`/`width` (CSS 2.1 §10.7). Measured on the live
page: forcing `height:34px !important; width:34px !important` back onto a real `.pd-filttoggle` at
375px still laid out **44×44**; stripping the `min-*` pair instead laid out **34×34**. The release was
also **unreachable** regardless — the base `.pd-filttoggle` rule sits *below* the phone media block in
the file, so at equal specificity it wins on source order. Line deleted, comment replaced with the
measurement. The (w9) fix itself was never in doubt; the `min-*` pair was doing all of the work.

#### Three real targets the topbar-only harness could not reach
| | was | now | why it was missed |
|---|---|---|---|
| `.pd-nav-sibling` | 40px | 44 | in the sidebar **drawer** — harness had no sidebar |
| `.pd-avatar` | 40px | 44 | phone block already grew it 36→40 and stopped 4px short |
| checkbox / radio `<label>` | **19px** | 44 | in module CONTENT, which needs data to render |

`.pd-sidebar nav a` already had `min-height: var(--pd-tap)` in the phone block; `.pd-nav-sibling` is
the same kind of row (the sibling-app links in `.pd-nav-foot`) and was never added to it — **the exact
omission pattern (w9) fixed for `.pd-filttoggle`**, one rule further up the same file.

#### ⚠️⚠️ THE CHECKBOX LABELS NEEDED A `display`, NOT JUST A `min-height`
A checkbox is ~13×13 and `font-size` cannot size it, so the **`<label>` is the tap target** — and those
measured **19px** tall, under this file's own 44px bar and under WCAG 2.5.8's 24px. `:has()` is what
makes them targetable at all (there is no parent selector otherwise) — verified supported before use.
⚠️ **`min-height` alone did nothing**: it does not apply to a non-replaced **inline** box, and a
`<label>` is inline by default. Measured: `min-height` computed as 44px while the label still laid out
at **17px**. Adding `display: inline-flex; align-items: center` made it 44. `inline-flex`, not `flex`,
so a row of labels still flows inline instead of each claiming its own line — and a label with **no**
checkbox inside is not matched and stays inline at 19px, checked as a control case rather than assumed.

#### Also confirmed on the live page, not just asserted
- **`.mp-mxwrap` is `overflow-x: auto`, 353px wide over a 2446px table, and scrolls.** The matrix
  columns *do* extend past the viewport — inside their own scroll container, which is why the page
  itself does not move. This is independent confirmation that (w9)'s "90 unwrapped tables" was noise.
- **The `NotFoundError` from `theme.js?v=…w4` in the console was a stale buffered entry** from the
  tab's previous page load, not a live failure: the page fetched `theme.js?v=20260910w7` and
  `.pd-theme-toggle` is present in the DOM. Checked `performance.getEntriesByType('resource')` rather
  than trusting the console line.

#### Verified
- **12 cases × 2 widths against the edited stylesheet. At 375px, 11 of 12 at ≥44px**; the 12th is the
  control (a plain `<label>` with no input, correctly left inline at 19px).
- **At 1200px every case is byte-identical to before**: filttoggle 34×34, avatar 36, nav-sibling 38,
  sidebar nav a 37, labels 19, bare input 22 @13.33px, `.pd-input` 32 @12.5px.
- Live signed-in home at 375px: **0 sideways scroll, 0 elements past the viewport, 0 small taps**, and
  the home search — a bare `<input>`, the exact case (w9) fixed — computes **16px / 44px**.
- 42 JS files + 29 inline blocks parse, 0 failures; 530/530 braces; 0 NUL bytes across 30 files.
- `?v=` → `20260910x1` on dashboard.css only (theme.js stays at `w7`, modules-grid.js at `w9` — neither
  changed). ⚠️ `x1`, not `w10`: `w10` sorts *before* `w9`.
- ⚠️ **Still not verified on a real device.** Real iOS Safari's zoom is the behaviour being designed
  around and an emulated viewport cannot exercise it.


### 2026-09-10 (w9) — Phone sweep: every form in the app zoomed iOS, and the filter funnel was the smallest target on screen

Owner: *"Let's now do a complete sweep for phone view UI."* ⚠️ The useful finding is not that the app
lacks a phone story — it has a good one (`body{overflow-x:clip}`, `.pd-tablewrap`, `--pd-tap:44px`, an
iOS zoom guard). It is **where that story was not being followed**, and two of my three suspicions
turned out to be my own noise.

#### ⚠️⚠️ THE REAL ONE: 10 OF 12 INPUT CONTEXTS ZOOMED THE PAGE ON iOS
iOS Safari zooms the whole page whenever a **focused** input computes under 16px. Measured at 390px
against the real shared + module stylesheets:

| construction | font-size | height |
|---|---|---|
| shared `.pd-input` / `.pd-select` | **16px** | 44 — the guard working |
| bare `<input>` (no `type`) | **13.33px** | 22 |
| `cc-form` · `boq-filters` · `eq-controls` | **13px** | 31–35 |
| `ccw-pkgs` · `cf-tr-row` · `eq-mx` | **12.5px** | 22–32 |
| `dr-subrow` | **12px** | 24 |

**Two independent causes, both proven, not guessed:**
1. ⚠️⚠️ **`input[type="text"]` CANNOT MATCH `<input>`.** A defaulted type is not a *present attribute*,
   so the guard's type list never applied to the **39 bare inputs** this app ships. The only form that
   cannot be outrun by new markup is to select `input` and exclude the few types that must *not* be
   16px (checkbox / radio / range / color / hidden).
2. ⚠️⚠️ **module.css LOADS AFTER dashboard.css**, so at equal specificity the module wins — and those
   module rules are not inside a phone media query at all, so they applied at phone width too.
   `.cc-form input` (0,1,1) beat `input[type="text"]` (0,1,1) on source order alone.

Hence **`!important`**, which this file otherwise avoids. iOS's zoom is a *platform behaviour*, not a
style preference — under 16px it zooms, and there is no value a module could legitimately prefer
instead. This is the one place a module does not get a vote. The same fields also measured **22–35px
tall**, so they now take the 44px minimum this block already enforces on `.pd-btn` — via `min-height`,
never `height`, so a textarea can still grow.

#### The filter funnel was the smallest control on a phone
`.pd-filttoggle` is a fixed **34×34** with no phone override — and the ≤700px block *already has* a
list of icon buttons that get 44px (`.pd-vt, .pd-icon-btn, .pd-theme-toggle, .pd-sidebar-toggle`). It
was simply never added to it. It is one of the most-tapped controls on a phone, in **six** modules
counting the two local copies (`.il-topfilttoggle`, `.pp-topfilttoggle`), which are named in the same
rule rather than left to drift.
⚠️ A `min-height` cannot beat a fixed `height`, so the 34px `height`/`width` are released to `auto`
first — otherwise the addition would have *looked* right and changed nothing.

Three module-local one-offs went with it, each an established shared decision a module's own copy
never inherited: `.sc-seg button` (32px, where dashboard.css already gives `.pd-seg > button` 44px),
and project-schedule's `.ps-title-btn` (28px) and `.ps-datadate-badge` (34px). ⚠️ Both of those are
real `<button>`s — the title is the **view switcher**, the badge **opens the Schedule dialog** —
checked in the markup rather than assumed from their names. Each fix went into that module's own
existing `@media (max-width: 700px)` block, not into the shared file.

#### ⚠️ Two suspicions that were MY noise, recorded so they are not re-raised
- **"90 tables with no scroll wrapper."** False. My detector looked back 240 characters for a wrapper
  keyword. The app does handle wide tables consistently, just through **several** mechanisms:
  `.mp-mxwrap` / `.eq-mxwrap` / `.cc-tablecard` / `.mw-tablewrap` — and `.rcm-tbl` is
  `display:block; overflow-x:auto`, i.e. **the table is its own scroll container**. Checked one by one.
- **`.cc-tablecard { overflow: visible }`** looked like an override that would make a wide table
  unreachable under `overflow-x: clip`. It is inside **`@media print`**. Correct as written.

#### Verified
- **14 modules at 390px, running the real `initModuleTopbar` + `tabsToDropdown`: 0 page-level sideways
  scroll, 0 elements past the viewport, 0 controls under 44px.** Before: 8 modules had small targets.
- **12 input contexts at 390px: 0 zooming, 0 under 44px** — from 10 and 10.
- ⚠️⚠️ **Desktop proved untouched, not assumed from the media query** — `!important` earns that check.
  At 1200px every measurement is byte-identical to before: `.pd-filttoggle` **34×34**, inputs
  12 / 12.5 / 13 / 13.33px at h=22–35, `.pd-seg` button 32px.
- **42 JS files + 29 inline blocks parse (`node --check`), 0 failures**; dashboard.css 530/530 braces,
  0 NUL bytes across all 31 changed files.
- `?v=` → `20260910w9` on dashboard.css (29 pages) + modules-grid.js, `MODULE_V` fallback bumped.
- ⚠️ **Not verified signed in, and not verified on a real device.** This is the *shell* — topbar,
  modulebar, form controls — measured in an emulated 390px viewport. A module's own CONTENT area needs
  data to render and is not covered; nor is real iOS Safari, whose zoom behaviour is the thing being
  designed around.



### 2026-09-10 (w8) — Two follow-ups to (w6): a doubled module icon, and a tab called "Loading"

Both reported by the owner off the live site, and both are (w6)'s doing.

#### ⚠️⚠️ THE DOUBLED ICON — I PASSED `opts.icon` TO MODULES THAT STILL SHOW THEIR `<h1>`
`UI.tabsToDropdown(sel, {icon})` inserts a module icon beside the trigger. That is correct **only
when the module's own `<h1>` is hidden**, and the split is documented in the 2026-09-04 entry:

- **`<h1>` hidden outright** → pass `opts.icon`: `issues-lessons` (its `module.js:884` sets
  `.il-title` to `display:none`), `progress-photos` (no standalone `<h1>` at all). **2 modules.**
- **`<h1>` stays in the bar** → pass **nothing**; its own icon rides beside the trigger.
  `risk-register`, `stakeholder-map`, `contracts-claims`, `minutes-of-meeting`. **4 modules.**

(w6) added the three new callers to the *first* group by passing an icon — but all three keep their
`<h1>`, so the bar drew the module mark **twice**. `opts.icon` removed from all three; they now match
the four-module pattern they belong to.

**Measured, with the real `initModuleTopbar` + `tabsToDropdown` + `Icons.hydrate` run per module:
every module renders exactly ONE module icon.** ⚠️ `issues-lessons` reports 2 in the harness because
`module.js` — which is what hides its `<h1>` — is not loaded there; verified against the shipped source
rather than waved away.

#### "Loading" reads as a spinner
Owner: *"the name 'Loading' should be renamed properly since it makes it seem that is loading."* The
first tab of Manpower and Equipment was literally `Loading`, and once (w6) collapsed the strip into a
dropdown the bar read **"⬛ Loading ▾"** — which looks exactly like a page that has not finished.
Renamed to **Overview**: it is the module's landing view, the sibling tabs are nouns (Positions, Org
Chart, Roster), and the module title already carries the word *Loading*.

⚠️⚠️ **`data-view="loading"` IS UNCHANGED — only the label moved.** That value is what the URL hash
carries (`#mp_view={"v":"loading"}`) and what `module.js` queries by
(`.mp-tab[data-view="loading"]`), so renaming it would break every link anyone has saved and the
module's own tab-activation. The visible word changed; the identifier did not.

#### Verified
- **9 modules, exactly 1 module icon each** (issues-lessons confirmed from source, see above).
- `data-view="loading"` still present in both modules; only the button text differs.
- **42 JS files + 30 inline blocks across 29 pages parse, 0 failures**; braces balanced, 0 NUL bytes.
- `MODULE_V` → `20260910w8`.
- ⚠️ **Three defects in my own harness on the way to this number**, all of which reported success or
  nonsense before being fixed — worth recording because each is a different shape:
  1. `eval`-ing `tabsToDropdown` across from the host lost its closure (`ReferenceError: esc is not
     defined`), which produced an **empty result array — and `[].every()` is `true`**. An audit that
     measures nothing reports a pass. Now ui.js is loaded *inside* the frame.
  2. Counting every `svg` in the bar swept up Export/refresh/filter and reported 4–10 icons.
  3. Counting `h1 [data-ico]` **and** `h1 svg` counted one icon twice — `Icons.hydrate()` puts the
     svg *inside* the placeholder.
- ⚠️ **Not verified signed in.**


### 2026-09-10 (w7) — The theme toggle has been missing on every logged-in module page

Found while verifying (w6) on the live site: the console carried
`NotFoundError: Failed to execute 'insertBefore' on 'Node'` at `theme.js`, on **every** module —
including ones that commit never touched.

#### ⚠️⚠️ IT IS A DESCENDANT vs DIRECT-CHILD MISMATCH, AND IT ONLY BITES WHEN LOGGED IN
```js
var ub = topbar.querySelector('#user-bar');      // DESCENDANT search - finds it however deep
if (ub) topbar.insertBefore(btn, ub);            // demands a DIRECT CHILD - throws otherwise
```
`UI.initModuleTopbar()` moves `#user-bar` down into `.pd-tb-main`. Whether it has done so before
`theme.js`'s `inject()` runs decides whether this line throws:

- **Logged out** — `AppAuth.requireLogin` redirects, `initModuleTopbar()` never runs, `#user-bar`
  is still a direct child, no throw. **This is every test I have run all session.**
- **Logged in with a cached session** — `requireLogin`'s callback resolves in a **microtask**, and
  microtasks flush *before* the `DOMContentLoaded` **task** that runs `inject()`. So the bar is
  already restructured, the insert throws, and **the throw kills the rest of `inject()` — the page
  ends up with no theme toggle at all.**

⚠️ That matches the owner's screenshots exactly: no sun/moon button beside the avatar, on both.
It is also why my own harnesses never saw it — they render the shell without a session.

#### It is NOT from this session's work
The offending line is **byte-identical** in the pre-(w4) `theme.js` (`git show aa3d19a~1`) — checked,
because `theme.js` is a file I edited today and the error surfaced right after that deploy, which
makes "I broke it" the obvious and wrong conclusion. What changed is that the `?v=` bump finally
delivered a *fresh* `theme.js` to a browser that had been serving the August bytes since August;
the bug was always in them.

**Fix:** insert relative to the node itself — `ub.parentNode.insertBefore(btn, ub)` — which is
correct whether `#user-bar` sits directly in `.pd-topbar` or inside `.pd-tb-main`, and puts the
toggle beside it either way.

#### Verified by a contrast build
The crash needs the logged-in ORDER, so the harness forces it: build the topbar, run the real
`UI.initModuleTopbar()`, *then* try both insertion strategies.

| | old code | fix |
|---|---|---|
| `#user-bar` still a direct child? | **false** | — |
| threw | **NotFoundError** | `null` |
| toggle in the DOM | **false** | **true** |
| placed next to `#user-bar` | — | **true** |

- `theme.js` → `?v=20260910w7` across all pages that load it; one version, 0 splits.
- **42 JS files + 30 inline blocks parse, 0 failures.**
- ⚠️ **Still not verified signed in** — the ordering is forced in a harness rather than observed on
  a real login. The owner's next module open is the real confirmation, and the tell is simply
  whether the sun/moon button is there.


### 2026-09-10 (w6) — Manpower's top bar was on two rows, the footer is renamed, and the rail's collapse stops snapping

Three owner items, one of them a real clipping bug the owner caught in a screenshot.

#### ⚠️⚠️ THE CLIPPING: SEVEN LABELLED TABS IN A `nowrap` BAR — EXACTLY WHAT THE CSS COMMENT PREDICTED
`.pd-modulebar` is `flex-wrap: nowrap` above 701px, and its own comment says why that is safe:

> *"This is only safe now that the tab strip is a single compact dropdown trigger rather than a row of
> N labelled buttons — before that, nowrap on a 4-tab module would have overflowed at laptop widths."*

**Three modules never made that move.** manpower-loading carries **seven** labelled tabs — 632px of
them — so its tools cluster was squeezed until it wrapped, taking the bar to two rows and pushing
"Portfolio" under the `+ Add manpower` button. Measured across every module at five widths, sidebar
open and collapsed:

| | @1600 | @1440 | @1366 | @1280 | @1152 |
|---|---|---|---|---|---|
| **manpower-loading** (7 tabs) | 55px | **75px** | **75px** · cut 48 | **75px** · cut 105 | **75px** · cut 183 |
| equipment-loading (4 tabs) | 55 | 55 | 55 | 55 | 55 |
| productivity-rates (3 tabs) | 56 | 56 | 56 | 56 | 56 |
| the other 11 (dropdown) | 52–55 everywhere | | | | |

⚠️ **The owner asked me to check Equipment Loading too, "since these two share the same UI" — and it
shares the construction but not the symptom.** Its 4 tabs are 353px and fit at every width tested,
down to a 912px content area. It is not broken today; it is one tab away from it. Same for
productivity-rates. All three are converted, so the answer is "fixed, and the other two were latent".

**All three now use `UI.tabsToDropdown()`**, matching the eleven modules that already did — 14 of 14.
The wiring is copied verbatim from risk-register **including its reasoning**: a *third*
`DOMContentLoaded` listener, because theme.js's topbar injection must run before
`initModuleTopbar()` restructures the bar, and registering last is what guarantees both have already
run. Calling `initModuleTopbar()` early was tried and reverted there.
⚠️ Their strips also gain `pd-tabsrc`, so the (w4) boot-flash rule covers them.

**Measured after: every module, every width, `barH` is 52 or 55 — one row — and zero squeezed
children.** manpower goes 75 → 55 at all five widths.

#### The sidebar footer
`Megawide Construction Corporation / EPC · PMO` → `Megawide Construction Corporation / PMO Department`,
across all **21** pages that carry it. ⚠️ The `<br>` is kept: the owner's text used a `·` as the
separator, and on a 240px rail the line break is what that separator has to be.

#### The collapse stops snapping
The rail animated `width`/`flex-basis`/`padding` over .2s — but **everything inside it vanished on
frame 1**, which is what read as a snap followed by a drift:
- `font-size: 0` on the nav rows was not in any transition list, so the labels disappeared instantly.
  `font-size` is now animated, so the text shrinks *with* the rail.
- `display: none` **cannot be transitioned at all**. The footer and the section labels now fold to
  `height: 0` instead, which reaches the identical end state animatedly.
- One easing curve for the shell (`--pd-ease`), `.22s`, replacing `ease` — which starts too fast and
  lands too softly for a 176px slide.
- ⚠️ `prefers-reduced-motion` turns the whole thing off, the rule the rest of this file already follows.

⚠️⚠️ **Swapping `display:none` for `height:0` is the kind of change that looks equivalent and is not
— an element folded to zero height still participates in layout.** So the end states were measured in
both states with transitions disabled (reading geometry mid-transition returns the START value, a trap
on file here twice): rail **240 / 64**, brand block **58 / 58** (the documented value, unchanged),
footer **61 / 0**, opacity **1 / 0**.
⚠️ And the first measurement caught a real slip: the folded footer came out **h = 1**, not 0, because
I had made its top border *transparent* rather than removing it — a transparent 1px border still
measures 1px. Fixed to `border-top-width: 0` and re-measured.

#### Verified
- **14 modules × 5 widths after the change: 0 multi-row bars, 0 squeezed children.**
- Sidebar end states measured in both states, transitions disabled — all match the documented values.
- **42 JS files + 30 inline blocks across 29 pages parse, 0 failures**; braces 523/523, 0 NUL bytes.
- ⚠️ A false positive in my own detector, worth recording: the first pass reported "wrapped" for
  **every** module, because it compared child `top` values — and a `|` separator with
  `align-self: stretch`, or an icon beside text, differ in `top` without anything having wrapped.
  Re-done against centre-Y with a 12px threshold, which left exactly one real offender.
- ⚠️ **Not verified signed in.** The tab dropdown is exercised through the real `UI.tabsToDropdown`
  against the real markup, but no module has been navigated with it on a live login.


### 2026-09-10 (w5) — A boot skeleton for the topbar's two JS-filled slots

Follow-on to (w4), which killed the tab-strip flash but explicitly did **not** fix the second half: the
topbar's *contents* still arrive after the auth round-trip. This is that half.

#### What was still popping in
- **`#user-bar`** is written by `UI.renderUserBar()` only after `AppAuth.requireLogin()` resolves —
  **two network round-trips**. ⚠️ While empty it is `width: 0`, so the avatar did not merely arrive
  late, **it shifted the whole topbar** when it landed.
- **The project `<select>`** already carries `min-width: 120px`, so its box was reserved — what it
  lacked was any sign it was still loading, so it read as an empty control rather than a pending one.

#### ⚠️⚠️ The skeleton keys off `:empty`, and that is the whole design
```css
html.pd-js #user-bar:empty { … shimmer … }
```
A slot is a skeleton **exactly while it has no children**, and the moment JS writes into it the
selector stops matching and the skeleton is gone. **No class to add, no class to remove, nothing to
coordinate, and nothing left behind if a render path changes later.** The alternative — an
`.is-loading` class someone has to remember to clear — is how a skeleton ends up stuck on screen
forever, and this app already has one bug of exactly that family on file (`ensureCodes` caching an
empty array because `[]` is truthy).

- ⚠️ Gated on **`html.pd-js`**, the marker (w4) that `theme.js` sets before first paint. Without JS the
  real, empty controls render — a shimmer that can never resolve would be worse than a blank box.
- ⚠️ `--pd-skel-base` / `--pd-skel-hi` are a **neutral wash, not brand red**: a shimmer means "not
  loaded yet", and tinting it with the brand would read as a *state*. Paired per theme like every
  other surface token.
- ⚠️ `prefers-reduced-motion` turns the sweep off and keeps the block, following the same rule
  `.pd-spin` already sets in this file.

#### Verified — rendered in both themes, empty and filled
| | empty | after JS fills it | |
|---|---|---|---|
| `#user-bar` (light + dark) | **36×36**, `pd-skel-sweep`, gradient present | **36×36**, animation `none`, gradient gone | **shift = 0px** |
| project `<select>` (light + dark) | gradient + sweep | gradient gone, animation `none` | |
| **no-JS control** (no `pd-js`) | **no gradient, no animation** | — | degradation correct |

**The 0px is the point**: the avatar's footprint is now reserved, so the topbar no longer jumps when
auth resolves. And the `:empty` self-clearing is measured rather than assumed — the same element is
read before and after `innerHTML` is written.

#### ⚠️ A flaw in my own version-bump script, caught here
The bump helper derives its asset list from `git diff --name-only` **and then edits
`assets/js/modules-grid.js`** (the `MODULE_V` fallback literal). On a round where that file was not
otherwise touched, it therefore changed the file's CONTENT while leaving its own `?v=` on the previous
token — **the exact stale-bytes trap that (w4) was written up for, reproduced by the tool meant to
prevent it.** Caught by reading the bump output (`modules-grid.js` absent from the asset list while
`MODULE_V fallback 1` was reported) and fixed by re-running once the file was dirty.
⚠️ The durable fix is to compute the list *after* every edit, or to always include `modules-grid.js`;
noted here because the next person will hit it the same way.

- `dashboard.css` + `modules-grid.js` → `?v=20260910w5` (29 / 2 pages), `MODULE_V` with them.
  `theme.js` correctly stays on `w4` — it did not change this round.
- **42 JS files + 30 inline blocks across 29 pages parse, 0 failures**; braces balanced 519/519,
  0 NUL bytes.
- ⚠️ **Not verified signed in** — the skeleton is proved by driving the same DOM the app produces
  (empty slot → `innerHTML` → re-measure), not by watching a real login resolve.

⚠️ **Deliberately not skeletoned:** the module `<h1>` and its icon are static markup and paint
immediately, and the module's own content area is the module's business — a shell skeleton that
guessed at a module's layout would be wrong on most of them.


### 2026-09-10 (w4) — The flash when you open a module: the raw tab strip painting before JS collapses it

Owner: *"When I open a module, for a split second it shows the previous UI."* Real, reproducible, and
**made far more visible by my own work today.**

#### What is actually on screen during that split second
Six modules ship a flat `<div class="x-tabs">` — a full-width row of tab buttons — that
`UI.tabsToDropdown()` collapses into the compact dropdown. It does that by adding
`.pd-tabsdrop-src`, which is `display:none !important`.

⚠️ **That class only lands at DOMContentLoaded.** Every module's scripts sit at the **end of
`<body>`**, so the body paints the raw tab row first and the conversion removes it afterwards.
Reproduced by rendering the module's own markup and stylesheets with the body scripts stripped: a
full-width `Register | Heat Map | Risk Universe | …` strip and an unassembled topbar — which is
exactly the frame being described.

**Measured on the live Risk Register:**

| | stylesheets ready | conversion runs (DCL) | raw row on screen for |
|---|---|---|---|
| warm cache | 66ms | 135ms | ~70ms |
| **cold cache** | — | **1601ms** | **~1.5s** |

⚠️⚠️ **And that is why it started being noticeable now.** Every `?v=` bump today invalidated every
asset, so each module open has been a **cold** load — moving this from an imperceptible 70ms to over a
second. The defect was always there; the cache-busting made it visible. Worth recording, because the
obvious reading — "the last CSS change broke something" — is wrong.

#### The fix
`theme.js` already runs in `<head>` **before first paint** (it is what applies `pd-dark` without a
flash), so it is the only place that can mark the document early enough. It now adds **`html.pd-js`**,
and `dashboard.css` carries `html.pd-js .pd-tabsrc { display: none }`. The six strips gain a shared
`pd-tabsrc` class. The row is therefore hidden on the **very first frame** and the dropdown simply
appears in its place.

⚠️⚠️ **The failsafe deliberately does NOT live in `ui.js`.** All six modules call the converter behind
`if (window.UI && UI.tabsToDropdown)` — they degrade to the raw tabs **on purpose** when `ui.js` is
missing. Hiding the strip from CSS would turn that graceful degradation into a module with no
navigation at all. So `theme.js` — which does not depend on `ui.js` — reveals anything still
unconverted on `window.load` and again on a 4s timer. **Verified by running the reproduction with the
module scripts stripped: the strip comes back**, which is the degradation path working.
⚠️ All six strips carry ≥2 buttons (4/3/2/3/3/3), and `tabsToDropdown` only bails below 2 — so none can
sit hidden waiting for the failsafe in normal use.

#### ⚠️⚠️ I nearly shipped a fix that could not work
The first test showed `pd-dark` applied but **`pd-js` absent**: theme.js had run, from a **cached
copy**. I had changed its contents without bumping `theme.js?v=`, which had sat on `20260812b` since
August. The browser keyed the old bytes to the same URL and served them. **This repo's single
most-recorded deploy failure, and I walked into it while fixing a caching-adjacent bug.**
`theme.js` → `?v=20260910w4` across all **30** pages.

#### Verified
- `html.pd-js .pd-tabsrc` measured directly: with the class the strip computes **`display: none`**,
  without it **`flex`** — the rule genuinely does the hiding.
- `pd-js` confirmed on `<html>` at parse time (the marker is set by the head script).
- The failsafe path exercised and confirmed to restore the strip.
- **42 JS files + 30 inline blocks across 29 pages parse, 0 failures** (bar the documented
  progress-photos false positive). Braces balanced, 0 NUL bytes.
- ⚠️ **Not verified signed in** — `requireLogin` redirects, so the settled dropdown was not observed
  on a live module; the mechanism is proved, the finished screen is not.

#### ⚠️ What this does NOT fix, honestly
The topbar's **contents** still populate after auth resolves — the project name and the user avatar are
a Supabase round-trip, not a CSS problem, and they will still fill in a moment after the page appears.
What is gone is the **layout jump**: a full-width row of buttons appearing and then vanishing. If the
remaining fill-in is still distracting, the fix is a skeleton placeholder in that bar, which is its own
piece of work.


### 2026-09-10 (w3) — A button and the input beside it had different corners, and "fully rounded" had three spellings

Last item of the second-pass audit, done under the rule the spacing pass arrived at: **fix components,
not pixels.** 460 off-scale `border-radius` declarations in 24 values sounds like a sweep; almost none
of it was worth sweeping, and the part that mattered was not in that number at all.

#### ⚠️⚠️ THE FINDING IS IN THE SHARED FILE, AND THE APP HAD ALREADY HALF-NOTICED IT
`.pd-btn` is **8px**. `.pd-input` / `.pd-select` / `.pd-textarea` are **7px**. So a Filter button and
the search box beside it — in every toolbar in this app — had different corners.

⚠️ And the phone block carried `.pd-btn { border-radius: 7px }`, pulling the **button down to match the
input** at ≤700px. Someone had already reached the same conclusion from the other end and fixed it in
one breakpoint only. Both are `--pd-radius-md` now, and that override is deleted rather than restated.

**Measured after, at 1440 and at 700:** button, input, select and `.pd-btn-sm` all report **8px at both
widths**. Before: 8 vs 7 on desktop, and 7 vs 7 on the phone — inconsistent in two different directions.

#### "Fully rounded" had three spellings
`999px` ×88, `99px` ×5, `20px` ×6 — plus `50%`. New `--pd-radius-pill`, **97 declarations converged**.
⚠️ `20px` is included because it is not really a different value here: all six uses are chips **18–22px
tall**, where the browser caps the radius at half the shorter side, so `20px` and `999px` render the
*same corner*. Measured on the two shipped chips: heights **20px and 23px**, both fully round before and
after.
⚠️ `50%` is deliberately NOT folded in — **67 declarations kept**. A percentage radius is an ellipse of
the box, which is what the avatar wants; on a non-square element it is genuinely different from a large
px radius, and collapsing the two would be wrong the first time someone uses it on a rectangle.

#### 157 rung values written as literals
`8px` ×92 → `--pd-radius-md`, `4px` ×53 → `--pd-radius`, `12px` ×13 → `--pd-radius-lg`. **Zero visual
change** — the values are identical, they just stop being literals, which is what makes the scale
enforceable rather than aspirational. Single-value declarations only: a compound `14px 14px 0 0` is a
shape, not a rung, and is left alone.

#### ⚠️⚠️ 278 off-scale declarations DELIBERATELY LEFT, and this is the third time that call has been made
`3px` ×84, `6px` ×68, `5px` ×33, `2px` ×32, `10px` ×26, `9px` ×18, `7px` ×11. The **2026-09-03 (r)**
entry decided this explicitly — *"pure diff noise with no visual effect, and PRC itself uses 8/10/20px
for the equivalent chrome"* — and that judgement still holds for a 3px chip corner. The one place it was
revisited (dropdown menus, earlier today) was because their spread had grown to **4→12px**, which is
visible; **a single pixel of corner is not.** Same reasoning as the spacing pass: the cost of the sweep
is real and the benefit is not.

#### Verified
- Rendered at **1440 and 700**: button / input / select / btn-sm all **8px, matching at both**.
- Pills measured fully round at their real heights (20px, 23px), unchanged by the token.
- **67 `50%` circle declarations survive** — checked explicitly, since the migration regex was
  px-only and folding them in would have been the easy mistake.
- Every `var(--pd-radius*)` used resolves to a token that exists.
- **42 JS files + 30 inline blocks across 29 pages parse, 0 failures** (bar the documented
  progress-photos false positive). Braces balanced, 0 NUL bytes.
- `?v=` → `20260910w3`.
- ⚠️ **Not verified signed in.**

#### The second-pass audit is closed
Everything found by looking rather than by being pointed at is now either fixed or recorded with a
reason: the **loading-veil z-index** (a toast painted behind the veil in three modules), the **focus
rings** (none on any button; three that existed and measured 1.10–1.90:1), the **box-shadow** scale, the
**spacing** decision, and this. What is knowingly left:
- `--boq-*` in contracts-claims — a fourth palette, private but **correct** (paired per theme and
  measured). Aliasing it to the shared tokens is a real cleanup and its own commit.
- `.pp-lightbox` shares `z-index: 900` with `.pd-modal-overlay`, so ties resolve by DOM order.
- The shared `.pd-kpi` is 4px taller than the module copies, from an inner `gap: 4px` they lack.
- `padding`'s 257 distinct values — per-component variation, and the same "fix components" rule applies.


### 2026-09-10 (w2) — A spacing scale, and the measurement that says NOT to sweep with it

Fourth item of the second-pass audit, and the one where the audit changed the plan. **924 `gap`
declarations in 42 distinct values**, plus 1,163 `padding` and 291 `margin`. The 42 looks like the type
scale's 29. **It is not the same problem**, and acting as if it were would have been the expensive
mistake here.

#### ⚠️⚠️ WHY THERE IS A SCALE BUT NO MIGRATION
- The app **already sits on a coherent 2px grid**: 8px ×207, 6px ×157, 10px ×137, 12px ×63, 5px ×71,
  4px ×56. **665 of 881 single-value gaps are already on a sensible rung.**
- Imposing a real 4-based scale would displace **535 declarations**, and **6px ×157 plus 10px ×137 are
  294 of them on their own**.
- And the payoff is not there. Half a pixel of type aggregates into a visible "built by different
  people" feel — that is why the type sweep was worth it. **Two pixels of gap between two buttons is
  imperceptible**, and every move risks re-wrapping a toolbar that only just fits.

So `--pd-space-2xs/xs/sm/md/lg/xl` (2/4/8/12/16/24) lands as a **target for new code and for components
being converged**, and the existing 6/10/14/18px values are left exactly where they are. ⚠️ 18px gets no
rung on purpose: it is `.pd-card`'s padding and `.pd-kpi`'s inline padding, both inherited from the PRC
reference app, and re-basing those is its own decision.

#### The thing that WAS actually costing consistency: the KPI card is six components
Same strip, one per module, measured:

| | grid floor | gap | padding | radius |
|---|---|---|---|---|
| shared `.pd-kpi` | 170px | 12px | **16px 18px** | **12px** |
| equipment · manpower · resource-loading | 160/150px | 12px | 13px 16px | 8px |
| productivity · s-curve | 160/150px | 12px | 14px 16px | 8px |
| cash-flow | flex | **14px** | 16px 18px | — |

Its **font-size (20px) and weight (800) were only normalised two commits ago**; padding and radius were
the remaining axis. All five grid modules now carry the shared `16px 18px` and `--pd-radius-lg`, and
cash-flow's odd 14px gap joins the other five on 12px.

⚠️⚠️ **`minmax` is deliberately NOT converged, and measuring is the only reason I know that.** Raising
the floor 150/160 → 170px looked like part of the same convergence. Measured at 8 cards / 1440px: the
shared 170px floor lays out **2 rows** where the modules' 150–160px floor gives **1**. `auto-fit` drops
a column when the floor rises, so that change **re-wraps the strip** — it is a per-module decision about
how many KPIs fit on a row, in the same category as the `repeat(2,1fr)` phone overrides, which are also
left alone. Only the visual properties were converged.

#### Verified
- **Rendered at 1440 / 1200 / 980 / 820px, before and after.**
  - **4 cards (the real case — these modules render 1–4):** all six strips now report **identical**
    `padding 16px 18px`, `border-radius 12px`, `gap 12px`, card width 346px, 1 row. Before, padding and
    radius differed in five of six.
  - **8 cards:** row counts **byte-identical to before** at every width (1r/2r/2r/2r for the modules,
    2r throughout for shared) — proof the wrapping behaviour was not touched.
- ⚠️ **One residual difference, measured and left:** the shared `.pd-kpi` is **79px** tall against the
  modules' **75px**, because it carries an inner `gap: 4px` between label and value that the module
  cards do not. Adding it would make them identical, but a module card with three children would gain
  more than 4px, so it is named rather than changed.
- **42 JS files + 30 inline blocks across 29 pages parse, 0 failures** (bar the documented
  progress-photos false positive). Braces balanced, 0 NUL bytes.
- `?v=` → `20260910w2`.

#### The second-pass audit is now closed. What remains, and why it is being left
- **`border-radius`: 460 off-scale declarations in 24 values** — but ~165 are rung values merely written
  as literals (a zero-visual-change cleanup), and the **2026-09-03 (r) decision to leave the small-chrome
  radii alone still stands** for the rest. Only the dropdown menus were revisited, and that was because
  their spread had grown to 4→12px, which is visible.
- **`padding`: 257 distinct values.** Inflated by being a compound property, and — like `gap` — the
  variation is per-component rather than systemic. The lesson from this entry applies: **fix components,
  not pixels.**
- `.pp-lightbox` shares `z-index: 900` with `.pd-modal-overlay`, so ties resolve by DOM order.
- `--boq-*` in contracts-claims is still a private, correctly-themed parallel palette.


### 2026-09-10 (w1) — 42 elevation recipes become 4 rungs, and the shadow scale grows the one it was missing

Third item of the second-pass audit. **174 box-shadow declarations, 97 distinct values** — but the
headline number is misleading, and that is the whole point of this entry.

#### ⚠️⚠️ A BOX-SHADOW IN THIS APP IS DOING FIVE DIFFERENT JOBS, AND ONLY ONE OF THEM IS ELEVATION
A blanket sweep onto `--pd-shadow*` would have deleted **every accent rail in the app**. Classified by
what the shadow actually does rather than by how it reads:

| job | shape | count | verdict |
|---|---|---|---|
| **elevation** | offset + blur, not inset | **50 decls / 42 values** | the only bucket the tokens are for |
| rail (accent bar) | `inset 3px 0 0 …` | 52 / 32 | a left rail, not a shadow — untouched |
| ring (outline substitute) | `0 0 0 Npx` | 14 / 10 | handled in the focus pass (v9) |
| hairline (border as shadow) | `inset 0 0 0 1px` | 13 / 10 | a border — untouched |
| already a token | | 45 | |

**After: elevation is 29 declarations / 26 values, and token use goes 45 → 65.**

#### The new rung is not invented
`--pd-shadow-xl: 0 20px 60px` — **`.pd-modal` already carried exactly those values**, at `.30` light and
`.60` dark, as a hand-maintained pair with its own `html.pd-dark` override. The scale stopped at `-lg`,
so the top surface in the app had nowhere to point. Promoting it is **zero visual change** and deletes
the override, because the token remaps for dark like every other one.
⚠️ **Verified rather than assumed** — that deletion is the one edit here that could fail silently, so
the modal was rendered in both themes: **`rgba(0,0,0,0.3) 0 20px 60px` light / `rgba(0,0,0,0.6)` dark**,
byte-for-byte what the deleted rule used to provide. The radius scale already ran to `-xl`; the shadow
scale now matches it.

#### 21 elevation shadows deliberately NOT migrated, each for a reason
Scoping this was most of the work. The excluded ones are not laziness — the token would be *wrong*:
- ⚠️ **Shadows drawn on PHOTOGRAPHS or a dark lightbox** (`.bim-pin`, `.pp-plancluster`, `.bim-regpt`,
  `.pp-lb-*`, `.ppr-kpoverlay`, `.ppr-keyplan`, `.ppr-stack*`, `.bim-*handle-el`). Their `.35–.50` alpha
  is deliberate: `--pd-shadow`'s `.07` is **invisible over an image**. Same reasoning that kept the
  white pin rings in the colour pass.
- ⚠️⚠️ **DIRECTIONAL shadows on slide-in panels** — `.mw-drawer` `-12px 0 34px`, `.ps-health-panel`
  `-8px 0 28px`, `.pd-sidebar` `0 0 40px`. Every token is vertical (`0 8px 24px`), so swapping them
  **moves the light source** and throws the shadow to the wrong side of a panel that slides in from the
  right. This is the one that would have looked like a rendering fault.
- ⚠️ **Chart furniture doing legibility work, not elevation** (`.ps-bar`, `.ps-mile-bl`,
  `.ps-vs-tlhandle`, `.ps-vs-fz-track .hd`) — separation against a busy gantt, where the token's alpha
  is roughly half what the job needs.
- Two-layer composites tuned to a specific look (`.ps-vs-tower`, `.sbld-stacktower`) and the
  `dev-mobile` device mockup (`.dv-shell`).

#### Verified
- **Rendered in both themes**: all 8 sampled migrated surfaces resolve to a real shadow and **all 8
  differ between light and dark**, so every one is going through the token rather than a stuck literal.
- Each edit is located **by selector** and replaces only that rule's `box-shadow` value, so a moved
  rule fails loudly instead of patching the wrong thing — **19 of 19 matched**.
- **42 JS files + 30 inline blocks across 29 pages parse, 0 failures** (bar the documented
  progress-photos false positive). Braces balanced, 0 NUL bytes.
- ⚠️ **A bug in my own classifier, caught because the answer was implausible.** The first run reported
  **zero** elevation shadows and 64 "other". Cause: in `0 8px 24px` the **first length is unitless**, so
  a `/(-?[\d.]+)px/` findall returned only two numbers and every elevation shadow fell through the
  `len(nums) >= 3` test. An audit that reports nothing in its main category is reporting on itself.
- `?v=` → `20260910w1`. ⚠️ **Not `v10`** — `v10` sorts *before* `v9` lexically, which is the sorting
  trap this log recorded two entries ago in its own right.
- ⚠️ **Not verified signed in.** Shadows are measured against the shipped stylesheets in a harness; no
  real card, menu or modal has been seen on a live page.

#### Still open from the second-pass audit
- **No spacing scale exists at all** — 924 `gap` declarations in **42 distinct values**, plus padding
  and margin untouched. The system has type, colour, radius, shadow and z-index tokens and **nothing
  for rhythm**, which is the largest remaining gap.
- **460 off-scale `border-radius` declarations in 24 values** — though ~165 are rung values merely
  written as literals, i.e. a no-visual-change cleanup, and the 2026-09-03 (r) decision to leave
  small-chrome radii alone still stands for the rest.
- `.pp-lightbox` shares `z-index: 900` with `.pd-modal-overlay`, so ties resolve by DOM order.

### Trace over another floor, front/rear on the drawing, zone colours, a 3D hover trace (2026-09-10) — jasantos2

Owner: *"For uniformity of the sizes of the floor plans … show the overview of the other floor
plans and trace it from there? but the overview from other floors should not be editable. Also …
defining from the floor plan which is the front, which is the rear. Also can you add option for
colors. As well as when hovering over the zones in the vertical stacking 3D, can you show like a
trace of the zone to distinguish it."*

**Trace over** in the floor-plan window shows another floor's outlines as a ghost — no ids, no
handles, `pointer-events:none` on the group *and* the polygons, so a click passes **through** it to
the real shape; ⚠️ deduped by plate, and it now offers **every plate in the project**, labelled by
trade, not only the floors of the trade being edited. **Copy these here** makes them ordinary
shapes.

**Front faces**, on the drawing itself: one field (the rear is derived — two would allow a building
whose front and rear are the same side), the edge drawn on the sheet, and ⚠️ the 3D card's own
buttons go **inert** with a note saying where the answer lives, rather than staying live and
ignored. It turns the camera, not just the labels.

**Zone colours**: a swatch beside the zone palette, ⚠️ keyed by zone **code project-wide** (`Zone 1`
is one zone, on every storey), with the automatic hue now a **hash of the code** instead of its
index in one floor's list — the index made the same zone two colours one storey apart. In the 3D
bar, **Colour · Trade | Zone**, ⚠️ opt-in and off by default: fill = trade is this card's primary
channel, and it falls back per cell so an untraced zone keeps its trade colour.

**Hovering a zone in 3D traces its outline** — ⚠️ with `depthTest` off, so the trace reads *through*
the building instead of being hidden by the storeys in front of the zone it is meant to pick out —
plus a readout of storey, zone, percent and finish. One raycaster serves hover and click.

⚠️⚠️ And a bug in this batch's own first half: `zonePlanFetch` now returns `{ byLabel, front }`, and
**Sync floor plans was still reading that envelope as the map** — so it reported "read the floor
plans for 2 floors" on every project and every lookup missed. **86 assertions across five suites,
0 failing**, executing sliced shipped code, with the pre-fix text run as the control.

### 2026-09-10 (v9) — The app had no keyboard focus ring, and three of the ones it did have were invisible

Second item of the second-pass audit. Focus visibility is the one UI inconsistency with a hard,
measurable floor — **WCAG 2.2 SC 1.4.11 asks for 3:1** on a focus indicator — so this is checkable
rather than arguable.

#### ⚠️⚠️ NO BUTTON, LINK, TAB, AVATAR OR ICON BUTTON IN THIS APP HAD A `:focus` RULE
Three classes carried one — `.pd-input` / `.pd-select` / `.pd-textarea`. **Everything else had
nothing**, so what a keyboard user saw was whatever their browser happened to draw: Chrome's
black-and-white double ring, Firefox's blue one, something else on Safari. Not invisible, but the app
had no focus identity of its own and no control over it.

New shared rule, and every part of it is load-bearing:

```css
:where(a[href], button, input, select, textarea, summary,
       [tabindex]:not([tabindex="-1"])):focus-visible {
  outline: 2px solid var(--pd-focus); outline-offset: 2px;
}
```

- ⚠️ **`:focus-visible`, never `:focus`.** A ring that also fires on mouse clicks is *why* people
  delete focus rings, and deleting them is how a control ends up with no indicator at all — which is
  precisely what had happened to three controls below.
- ⚠️⚠️ **`:where()` is what makes this safe.** It contributes **zero** specificity, so the rule sits at
  (0,1,0) and **every existing component rule still wins untouched**. Verified by resolving the real
  cascade: `.pd-input` reports *two* rules applying and `.pd-input:focus` (0,2,0) winning, so form
  fields keep their inset −1px ring; `.ps-wbs-row:focus { outline:none }` also still wins, so its
  documented suppression survives. A blanket ring at ordinary specificity would have silently
  overridden both.
- ⚠️⚠️ **`outline-offset: 2px` is the reason it works on the red `+ Add` button.** A red ring drawn
  *on* `--pd-red` is **1.00:1 — literally invisible**. Two pixels out it lands on the surface behind.
  Measured on every ground the app paints: white card **4.12**, app bg **3.74**, dark ground **4.14**,
  dark card **3.40**, sidebar **3.96**. The dark card is the tightest and still clears 3:1.
- ⚠️ `[tabindex="-1"]` is excluded: those are script-focusable only and never reached by Tab.

#### Three indicators that were there and could not be seen
| control | was | measured | now |
|---|---|---|---|
| `.sbld-xlwrap` (the spreadsheet, `tabindex="0"`) | `inset 0 0 0 2px var(--pd-red-light)` — its **only** indicator | **1.14** light / **1.10** dark | `--pd-focus` inset, 4.12 / 3.40 |
| `select.ps-status-pill` (schedule grid) | `outline:none` + `--pd-red-mid` inset | **1.90** | `--pd-focus` inset |
| `.pd-home-search input` | `outline:none` + a `--pd-red-light` halo | **1.14** | halo kept as decoration, the ring restored |
| `.pscl-in` | `outline:none`, nothing else — a transparent borderless input | **no indicator at all** | `--pd-focus`, inset |

⚠️ The three pale-tint rings that **remain** were checked and left: each pairs its halo with a
`border-color: var(--pd-red)` change, which is a visible 4.12:1 indicator in its own right. The tint is
decoration there, not the indicator.

⚠️ **`.ps-wbs-row:focus { outline:none }` is deliberately untouched, and checking it is the point.**
Its comment claims focus always coincides with `.selected`, whose tint and red rail are the indicator.
That claim is **true**: the rows are `tabindex="-1"` (never reached by Tab) and the only `.focus()` call
sits immediately after the selection is set. A suppression with a reason that holds is not a defect.
`.dr-grid:focus` likewise — drawing-register is `enabled:false` and its stub page does not even load
its stylesheet.

- **`--pd-focus` gets its own token** rather than reusing `--pd-red`: a focus indicator is an
  accessibility contract with a measured floor, while the brand accent is free to be re-tuned for
  looks. Tying them means a brand tweak could silently drop the ring under 3:1. Eleven rules now share
  it; it was **six different treatments** before.
- ⚠️ A ring at `outline-offset: 2px` **overlaps the neighbouring cell** in a table as dense as the
  BOQ/step-4 grid, so grid inputs pull it inside (`-2px`). Same ring, same colour, drawn within its own
  cell.

#### Verified
- **Cascade resolution against the shipped stylesheet**, control by control: **0 of 15 controls now
  have no focus rule**, down from 10 of 15.
- ⚠️⚠️ **The obvious harness DOES NOT WORK, and it lied confidently before I caught it.** `el.focus()`
  sets `document.activeElement`, but an automated browser pane never gives the document real focus
  (`document.hasFocus() === false`), so `:focus` never matches for style computation — **every control
  reported `outline: NONE`, including `.pd-input`, which provably has one.** Fronting the tab and
  calling `window.focus()` did not fix it. Hence resolving the cascade instead of trying to fake focus.
- ⚠️ **And the first cascade harness was wrong too**: it split `selectorText` on every comma, which
  shreds `:where(a, button, input)` into fragments and then reports that the new rule matches nothing —
  a bug in the checker that reads exactly like a bug in the CSS. Fixed to split on top-level commas
  only, and the specificity function fixed to treat `:where()` as zero.
- ⚠️ **The contrast numbers in the first draft of the CSS comment were WRONG** — asserted from memory
  (3.96 / 4.14 / 3.62) rather than computed. Re-measured and corrected in the file to 4.12 / 3.74 /
  4.14 / 3.40 / 3.96. Stating a number is a claim; this repo's standard is to measure it.
- **42 JS files + 30 inline blocks across 29 pages parse, 0 failures** (bar the documented
  progress-photos false positive). Braces balanced, 0 NUL bytes.
- `?v=` → `20260910v9`. ⚠️ **Not v8: the concurrent session had already taken it**, found by reading
  the remote's `MODULE_V` before pushing rather than after — the collision this log has now recorded
  five times.
- ⚠️ **Not verified signed in, and not verified by actually tabbing a live page** — the pane cannot
  give a document focus, which is the whole reason for the cascade approach. The rings are proved to
  apply and to clear 3:1; they have not been *seen*.


### 2026-09-10 (v7) — A toast was painted behind the loading veil in three modules, and z-index gets a scale

First item of the second-pass UI audit — the one the owner asked for *"since much of the UI fixes are
from my hints"*, i.e. found by looking rather than by being pointed at.

#### ⚠️⚠️ THE BUG: THE SAME COMPONENT SAT AT TWO DIFFERENT LAYERS, AND IT HID ERROR MESSAGES
Measured across the app: **26 distinct z-index values, 0 to 9999**, including four escape-hatch numbers
(999, 1000, 9000, 9999) — the signature of layering settled by escalation rather than by design. The
consequence was not cosmetic:

| | z-index | toast behaviour |
|---|---|---|
| `.ps-loading` · `.mp-loading` · `.eq-loading` | **9999** | toast painted **BEHIND** the veil |
| `.pr-loading` · `.sc-loading` | **999** | toast on top, correctly |

All five are the **same component** — the full-page busy veil — and ⚠️ **all five are direct `body`
children with `position: fixed`**, established with an ancestor-chain parse rather than by reading the
numbers, because a z-index only competes inside its own stacking context. So those values go head to
head with `.pd-toast` (1000) and `.pd-modal-overlay` (900).

⚠️ **A toast is how this app reports that a load FAILED.** So in three of five modules the message the
planner most needed was the one covered up, and which modules those were came down to nothing but which
number a developer happened to type.

#### The scale, and why the order is a behaviour rather than a preference
`--pd-z-modal: 900` · `--pd-z-escape: 920` · `--pd-z-loading: 950` · `--pd-z-toast: 1000`

- **loading is above modal** — a page-wide veil is meant to cover a dialog.
- **escape** is for a body-level menu that must clear the modal it was opened from
  (`.sbld-libmenu`, which `document.body.appendChild`s itself and carried **9000**, above the toast).
- **toast is always top.** Nothing may ever cover it.

⚠️ **Only the BODY-LEVEL layers are tokenised, deliberately.** The in-page ones (topbar 20, dropdowns
30/40, sidebar 50/70, scrim 60) live inside stacking contexts where their numbers are local and largely
inert — **`.pd-usermenu` carried `z-index: 9999` while sitting inside a `position:sticky; z-index:20`
topbar, so it could never rise above 20 no matter what it asked for.** It is left exactly as it is:
the number is misleading but harmless, and changing the one control that appears on all 29 pages
without a reason is how the *next* regression happens. Named here instead.

#### Verified by HIT-TESTING, not by reading z-index
The real question is not what the CSS says, it is which element owns the pixel. So the harness renders
the modal overlay, that module's own veil and a toast as **body children** (where all three genuinely
live) against `dashboard.css` + the module's real CSS, then asks `document.elementFromPoint` what is on
top at the toast's own centre.

**After: all five modules report `top-at-toast = toast`.** modal 900 < veil 950 < toast 1000.

⚠️⚠️ **And the contrast build BITES** — the identical harness built from `git show HEAD:` (the pre-fix
bytes) reports **`top-at-toast = LOADING VEIL` for project-schedule, manpower-loading and
equipment-loading**, and `toast` for the other two. That is the reported bug reproduced exactly, which
is what makes the green run afterwards mean something. A test that cannot fail is not evidence.

- ⚠️ **`node --check` over every inline `<script>` and every `.js` file was run this time** — 42 JS
  files + 30 inline blocks across 29 pages, **0 failures** (bar the documented progress-photos false
  positive, a `<script>` inside an HTML comment). That is the check whose absence let the (v6) outage
  ship, and it is now part of the routine rather than something remembered.
- Brace balance holds; 0 NUL bytes. `dashboard.css` → `?v=20260910v7` across all 29 pages, `MODULE_V`
  with it. One version each, 0 splits.
- ⚠️ **Not verified signed in** — the layering is proved by hit-test against the shipped stylesheets;
  no real load was made to fail in order to watch a real toast appear over a real veil.

#### Named, not fixed — the rest of the second-pass audit
- **`.pp-lightbox` is `z-index: 900`, the same layer as `.pd-modal-overlay`.** Ties resolve by DOM
  order, so this is decided by accident. Not a proven bug, so not touched blind.
- **57 distinct `box-shadow` recipes** across 69 non-token declarations, including inconsistent focus
  rings — an accessibility question as much as a visual one.
- **No spacing scale exists at all:** 924 `gap` declarations in **42 distinct values**. The system has
  type, colour, radius and shadow tokens and nothing for rhythm.
- **460 off-scale `border-radius` declarations in 24 values** — though ~165 of those are rung values
  merely written as literals, which is a no-visual-change cleanup.


### 2026-09-10 (v6) — ⚠️⚠️ HOTFIX: I broke Project Schedule and Cash Flow in production. A quote did it.

Owner, with a screenshot of a dead Schedule: *"Your fix has bugged the schedule module."* Correct, and
it was live. **Both modules were completely non-functional** — empty grid, *Total: 0 activities*, no
project context, nothing on the page working.

#### The bug
Yesterday's (uic) pass put the brandbook's document font into the two print/export stylesheets. Those
stylesheets are **JS string literals**, single-quoted:

```js
'<style>body{font-family:Arial,Helvetica,sans-serif;color:#231F20;margin:28px;}' +   // before
'<style>body{font-family:Calibri,'Segoe UI',Arial,Helvetica,sans-serif;...}' +       // after — BROKEN
```

⚠️⚠️ **`'Segoe UI'` TERMINATED THE SURROUNDING JS STRING.** CSS is happy with single quotes; JavaScript
is not, when the string is already single-quoted. The result is not a broken font — it is a
`SyntaxError`, and a syntax error anywhere in an inline `<script>` **kills the entire block**. In
`project-schedule/index.html` that block is **~35,000 lines**, i.e. the whole module. Cash Flow, same
edit, same outcome.

**Fixed** by using double quotes for the font name inside the single-quoted JS string —
`font-family:Calibri,"Segoe UI",Arial,Helvetica,sans-serif`. CSS accepts either; JS only accepts the
one that is not already doing a job.

#### ⚠️⚠️ Why my verification did not catch it, which is the part worth keeping
The (uic) commit ran, and *passed*: CSS brace balance, `<style>`/`<script>` tag balance, NUL-byte scan,
30 rendered contrast measurements, 10 rendered button measurements. **Every one of those was green on a
file whose entire script failed to parse.** Brace-and-tag balance is a check on the *shape* of the
document; it says nothing about whether the code inside it runs. And every browser measurement I took
was against a **harness** that inlines the stylesheets — no harness ever loads the module's own script,
so none of them could see it.

⚠️ **This repo already knew.** Its own changelog lists *"inline `<script>` parses"* as a standard check
in entry after entry. I did not run it. A `node --check` over every inline block takes seconds and is
the single check that would have caught this.

**Now enforced properly:** every inline `<script>` on all 29 pages plus all 42 `.js` files are parsed —
**42 JS files + 30 inline blocks across 29 pages, 0 failures.**
⚠️ One reported failure is the **documented pre-existing false positive** in
`progress-photos/index.html` (a `<script>` written inside an HTML *comment*, which a regex extractor
splits wrongly). Verified by running the same check against `b5d9aa5~1` — the commit *before* any of
this work — where it fails identically. Named rather than silently filtered.

#### The general trap, recorded
**Editing CSS that lives inside a JS string is not editing CSS.** The print/export stylesheets in
`cash-flow` and `project-schedule` are exactly this, and the type-scale pass (v5) already treats them
as a no-go zone for a *different* reason (they resolve no `--pd-*` variable, having no `:root`). That
same "js-built block" detector — a `<style>` block containing `' +` — should gate **every** edit to
them, not just token substitution. The v5 script had it; the uic Calibri edit was a hand-written
`.replace()` that bypassed it entirely.

`MODULE_V` → `20260910v6`. ⚠️ **Not verified signed in** — the fix is proved by parsing the shipped
bytes, which is precisely the check that was missing; the owner's own reload is the real confirmation.


### 2026-09-10 (v5) — The type scale stops being a suggestion: 892 font-sizes onto the eight rungs

The third and last of the owner's UI-consistency items, taken as its own commit so it can be reverted
on its own. The `--pd-fs-*` scale has existed since 2026-09-08 with the instruction *"Reach for a rung.
Never write a fresh literal"* — and **892 declarations across 14 files still carried a literal**, in
**25 distinct values**. Half a pixel is invisible alone and unmistakable in aggregate; it is most of
what reads as "each module was built by a different person".

**Measured after: 25 distinct values → 14, and 892 literal declarations → 43 — every one of the 43 an
exemption, 0 real leftovers.**

#### The mapping is explicit, and the three real ties are decided here rather than by a float compare

| from | to | | from | to |
|---|---|---|---|---|
| 8, 8.5, 9, 9.5 | `--pd-fs-micro` 10px | | 13.5 | `--pd-fs-base` 13px |
| 10.5, 11.5 | `--pd-fs-xs` 11px | | 15.5 | `--pd-fs-md` 15px |
| 12 | `--pd-fs-sm` 12.5px | | 17, 18 | `--pd-fs-lg` 16px |
| 14 | `--pd-fs-body` | | 19, 21, 22 | `--pd-fs-stat` 20px |
| | | | 23, 26 | `--pd-fs-hero` 24px |

⚠️ **10.5 goes UP to 11** — the more-used rung, and rounding small text down costs legibility.
⚠️ **18 goes DOWN to 16**, which the token's own comment calls *"the largest heading in the app"*.
⚠️ **22 goes DOWN to 20**, not up: `--pd-fs-hero` is reserved for *"the ONE biggest number on a screen"*.

#### ⚠️⚠️ The 22px cluster is the whole argument for a scale, in one finding
All **nine** `22px` declarations turned out to be `.eq-kpi-v`, `.mp-kpi-v`, `.pr-kpi-v`, `.rl-kpi-v`,
`.sc-kpi-v`, `.boq-poc-v`, `.ps-ck-kpi .v` … — **nine modules independently inventing 22px for a KPI
value**, while the shared `--pd-fs-stat` is 20px and its comment literally reads *"KPI / metric value"*.
Nobody was being careless; there was simply nothing stopping them. **Measured in a browser afterwards:
all eight KPI components render at 20px, one weight, zero overflow.**
⚠️ Two of them (`productivity-rates`, `s-curve`) were also **weight 700 where the shared component and
the other six are 800** — brought onto 800 in the same pass, since a KPI row that agrees on size and
disagrees on weight has not actually converged.

#### The two exemptions, detected rather than listed
The token block already names them, and both are **different MEDIA, not different opinions**:
- ⚠️ **A rule containing `fill:` is SVG**, where `font-size` is in **user units, not pixels**. That one
  test generalises what the comment names case-by-case (progress-photos' 3.2px plan label,
  project-schedule's 8px dependency tags) — **22 declarations left alone**, and it correctly caught
  ones nobody had listed, e.g. cash-flow's `.cf-donut-c2`.
- ⚠️ **A `<style>` block built by JS string concatenation is a print/export stylesheet**, laid out for
  paper. Detected by `' +` inside the block — **21 declarations left alone**. These could not have been
  converted even in principle: they are written into a fresh `document.write` window that has no
  `:root`, so every `var(--pd-fs-*)` would have resolved to nothing and the sheet would have printed at
  the browser default.

#### Verified
- **892 declarations converted; residual literals classified: 22 SVG, 21 print, `REAL LEFTOVER: 0`.**
- **Every `var(--pd-fs-*)` used in the app resolves** — the 10 token names used are exactly the 10
  defined in `dashboard.css`. A misspelt token drops the declaration silently at computed-value time,
  which is the failure this check exists for.
- **Rendered in a browser** against each module's real stylesheets: 8 KPI components, **one size
  (20px), one weight (800), 0 overflowing**.
- Brace balance holds; **0 NUL bytes**. ⚠️ project-schedule's `<script>` 16/14 is the documented
  false positive, byte-identical to HEAD.
- `?v=` → `20260910v5`, one version each, 0 splits. ⚠️ Four modules' `module.css` are bumped without
  having changed — the bump list is derived by basename from `git diff`, and **over-bumping is the safe
  direction** (one extra fetch) where under-bumping ships changed bytes under a cached version.
- ⚠️ **Not verified signed in.** The KPI row is measured; the ±0.5px shifts across the other ~880
  declarations are not individually rendered, and the screens most worth a glance are the dense ones —
  the **Schedule grid** and the **BOQ table**, where a 12 → 12.5px row could change wrapping.


### 2026-09-10 (v4) — `font-weight: 600` folds into Bold, and the ten hierarchies it would have flattened

Owner's decision, off the Brandbook question raised in the (uic) entry below: **map 600 → 700 (Bold)**.
Brandbook 2026 p.29 names five Gotham cuts — **Thin / Regular / Italic / Medium / Bold / Black** — and
there is **no Gotham Semibold**, so every `font-weight: 600` in this app addressed a cut of the primary
face that does not exist. **262 declarations across 22 files.**

⚠️ It was not visibly broken and that is worth stating plainly: Gotham is unlicensed here, so
essentially every user renders **Montserrat**, which *does* ship a 600. This was a latent divergence
that would have bitten the day a Gotham webfont licence landed — not a bug anyone could see.

#### ⚠️⚠️ TEN OF THE 262 WOULD HAVE BEEN DESTROYED BY THE OBVIOUS SED, INCLUDING ONE THIS LOG BUILT ON PURPOSE
A blanket `600 → 700` is a one-line change and it is **wrong**, because ten places use 600 and 700 as a
deliberate **two-level hierarchy** — the light half and the heavy half of the same component. Folding
both ends into 700 makes the two states **identical**:

| the pair | what the distinction means |
|---|---|
| `.pd-nt-portfolio` / `.pd-nt-portfolio.sel` | **selected vs unselected** in the project dropdown |
| `.ps-pkgtag.inherited` / `.ps-pkgtag.mixed` vs `.ps-pkgtag` | an inherited/mixed package tag vs an explicit one |
| `.boq-alloc.none` vs `.boq-alloc` | nothing allocated vs a real allocation |
| `.po-dir-band.is-empty` vs `.po-dir-band` | an empty A–Z band vs a populated one |
| `.pd-pv-n small`, `.pd-sc-tbl th small`, `.po-dir-sechead span`, `.po-dir-listband td span` | a sub-label inside its own heading |
| `.dr-stsel option` vs `.dr-stsel` | an option vs the closed select |

⚠️⚠️ **`.pd-nt-portfolio.sel` is a feature this changelog added deliberately** — 2026-09-03 (i), *"Portfolio
now renders bold when it's the selected row"*, bumped to 700 specifically so the selection was visible.
The obvious fold would have silently reverted it, and the diff would have looked like tidy-up.

**Those ten go to 500 (Medium), not 700.** The hierarchy survives, and it is now expressed as **500 vs
700 — two real Gotham cuts** — where it used to be 600 vs 700, one real and one synthesised. The
contrast is *wider* than before, not narrower.

⚠️ **Found by asking which selectors EXTEND which**, not by a shared class prefix: `.pd-tab` and
`.pd-avatar` share `pd-` and are unrelated, which is why a prefix-grouping first pass reported **56**
false candidates. The test that matters is whether one selector is the other plus a compound or
descendant part.

#### The webfont stops requesting a weight nothing uses
`@import` went `400;500;600;700;800` → **`400;500;700;800`**. One fewer face downloaded on every cold
load, and the list now mirrors the brandbook's cuts exactly, so the next `600` has nowhere to render
from. The app's weights are now **400 Regular · 500 Medium · 700 Bold · 800 Black** — measured: **813
declarations, 4 distinct values**, down from 5.

#### Verified
- **0 occurrences of `font-weight: 600`** remain in any `.css`, `.html` or `.js`.
- **All ten hierarchies asserted still two-level** — each reads `light=500 heavy=700`, **0 flattened**.
- Brace balance holds on every changed stylesheet and inline `<style>`; **0 NUL bytes**.
  ⚠️ Two `<script>` tag-count mismatches are reported and **both are byte-identical to HEAD** — the
  documented false positives (progress-photos' CDN `build/three.min.js` src, project-schedule's
  `<script` inside a JS string). Checked against HEAD rather than assumed.
- `dashboard.css`, `my-work.css`, `ppr.js`, `modules-grid.js` + `MODULE_V`, and six modules'
  `module.css` → `?v=20260910v4`. **One version each, 0 splits.** ⚠️ The bump list is derived from
  `git diff --name-only`, not hand-kept — a hand-kept list is how an asset ships changed under a
  version a browser already holds.
- ⚠️ **Not verified signed in**, and ⚠️ **not re-rendered**: this is one property, statically proven,
  and the only real risk (a flattened hierarchy) is asserted above rather than eyeballed. The screens
  worth a glance on the next real login are the **project dropdown** (selected row) and the
  **Schedule's package tags**.

### ⚠️⚠️ The floor plan never reached the Vertical Stacking at all, and a Sync button (2026-09-10) — jasantos2

Owner: *"can't there be a button that allows syncing the floor plans to the 3D? and nothing is still
being shown in the vertical stacking 3D."*

⚠️⚠️⚠️ **The guard could never pass.** The Project Schedule module is one IIFE, so
`var ScheduleBuilder` is a **closure local** and `window.ScheduleBuilder` is never assigned — and
`_vsZpAll` tested `window.ScheduleBuilder`. It returned `{}` unconditionally, so the traced floor
plan **never reached the Vertical Stacking**, in 2D or 3D, from the day the feature shipped. The
last two turns of work on this — the label join, the 2D layout, the cold-open fetch, the three-way
footer — were all correct and all sat behind a condition that is false by construction. ⚠️ Every
other consumer in that file already used `typeof ScheduleBuilder !== 'undefined'`.

⚠️ **Why the suites missed it:** they run `_vsZpAll` in a context where the bridge is *provided*,
which tests whether the map gets built, not whether the bridge is reachable. The new suite executes
it in a context shaped like the real one — a `window` that exists and has no `ScheduleBuilder` — and
**HEAD returns `{}` on the identical input**.

**Sync floor plans**, in the 3D bar: it clears the memo *and* the asked-flag (or it would respect
the cache it is meant to bypass), and it always reports what happened — synced, *n* of *m*, a plan
that matches no storey, or nothing found, with the empty case naming where to draw one and to save.
⚠️ The verdict is read from the **same fit function the footer prints**, so the two cannot
contradict each other, and ⚠️ a card with no storeys is not accused of a name mismatch.

**767 assertions across fourteen suites plus the runtime and extrusion checks, 0 failing**; 29 new.
⚠️ A structural assertion now forbids any **code** reader going through `window.`, while still
allowing the comment that explains the bug to quote it. ⚠️ **Not verified signed-in** — the database
round trip still has not run.

`MODULE_V` → `20260910v2`. Detail: [`modules/project-schedule/CLAUDE.md`](modules/project-schedule/CLAUDE.md).

### The 3D card could not see the floor plan unless the Setup tab had been opened (2026-09-10) — jasantos2

Owner: *"i want to use that defined floor plan and apply it to the vertical stacking 3D? it is not
reflecting? how do you make it reflect."*

⚠️⚠️ **The plan lives in the Schedule Setup config, and `ScheduleBuilder` only holds a config once
that tab has loaded one** — a caveat already written down for the schedule grid's default grouping
and never carried across to the stacking. Trace the zones, save, reload, open Vertical Stacking:
`cfg` is `null`, the bridge returns `{}`, and the card falls back to the guessed layout without
erroring or saying why.

- **The stacking now loads the saved setup itself** (`zonePlanFetch`), reading the setup row
  directly. ⚠️ It never assigns the builder's live `cfg` — that would hand it a setup nobody opened,
  which `isDirty()` and `save()` would then reason about. ⚠️ Most recently updated wins, matching the
  setup tab, or the two would draw different buildings. ⚠️ One implementation of the label map
  serves both paths, so they cannot index the plan two different ways.
- ⚠️⚠️ **A project with no plan is marked as asked**, or it would fetch, repaint, find nothing and
  fetch again on every repaint forever.
- ⚠️⚠️ **The footer now says which of three things is wrong.** It printed *"attach a floor plan"* for
  all of them — including when the plan exists and **no storey matches it**, which is almost always
  the floor's Code/Name not being what the activities carry as their level. That case now says the
  plan **is** traced, prints **both sides** of the join, and names the field to fix.

**738 assertions across thirteen suites plus the runtime and extrusion checks, 0 failing**; 45 new,
executed against a deliberately empty live config — the cold open itself. ⚠️ Controls run on HEAD:
no fallback at all, and one footer line for every case. ⚠️ Three suites needed their **slice lists**
extended rather than their expectations changed, and two **stubs were replaced with the real
functions** while I was in there. ⚠️ **Not verified signed-in, and this change most needs it** — the
fetch is a real query and the anon key has no grants, so the round trip has never run.

`MODULE_V` → `20260910v1`. Detail: [`modules/project-schedule/CLAUDE.md`](modules/project-schedule/CLAUDE.md).

### 2026-09-10 (uic) — A global UI consistency pass: status surfaces, the `+ Add` button, and one monospace family

Owner: *"Let's globally check the UI of all app and perform consistency fix"*, then *"Check also font
styles not just font sizes"*, *"I am pretty sure the +Add across all modules have different font styles
let's check globally"*, and *"Let's follow the brandbook."* Audited by measurement across all 27
stylesheet sources (12 `.css` files + the inline `<style>` of every page), never by eye.

#### ⚠️⚠️ THE SHARED STATUS PILL WAS ITSELF BELOW AA, WHICH IS WHY NINE MODULES REFUSED TO USE IT
Measured against the card surfaces before changing anything: **`--pd-ok` (#1f8f4e) is 4.12:1 on white
and `--pd-warn` (#C77700) is 3.46:1** — and `.pd-pill-ok` / `.pd-pill-warn` painted their label in
exactly those two. So the component every module was told to reuse failed the bar, and nine of them
hand-rolled a green/amber/red instead. **A reuse problem with a contrast cause.**

- **New status-surface tokens — a tint / border / text TRIPLE per status**, `--pd-{ok,warn,bad}-*`,
  remapped under `html.pd-dark`. ⚠️ The `-text` values are **not invented**: they are the ones the
  modules had already converged on by hand (`#12693a` in three modules, `#8A5300` in project-schedule),
  so migrating moves a module *toward* the rest of the app — the same rule the type scale follows.
- ⚠️ **The tints are `rgba`, not opaque hex, on purpose.** An rgba tint composites over whatever card it
  lands on, so one value is correct in both themes and a module cannot get a white pill on a dark card
  by forgetting an override. That forgotten override was the actual defect in six modules.
- ⚠️ **`--pd-info` is a FOURTH status and it is here because the app already had it** — measured **24
  blue declarations across five files in four spellings** (`#2F6FBF`×11, `#2f6fed`×5, `#2563EB`×6,
  `#1d4ed8`×1). `#2f6fed` measured **3.84:1** on its own tint, which is the argument for one token over
  four.
- **74 declarations swapped** from `--pd-{ok,warn,bad}` to their `-text` pair, across 15 files —
  `color:` only. `border-color`, `background` and every `color-mix()` surface keep the base token,
  because those are surfaces and the base value is right for them.
- **Nine modules' hand-rolled pills migrated.** ⚠️ Contracts & Claims and Manpower were **not broken** —
  both paired every literal with its own `html.pd-dark` override and both had done the measurement.
  What they had was a *private parallel palette*; the override pairs are deleted, not the reasoning.

#### The `+ Add` button, which the owner was right about
Measured, per module, with each module's real stylesheets inlined: the primary Add label computed
**12.5px in seven modules and 13px in four**, and the button hovered **two different ways**.
⚠️ **The sharpest case: issues-lessons and minutes-of-meeting use the SAME class names** and still
disagreed, because minutes-of-meeting excludes the labelled button from its 34×34 icon rule with
`:not(.il-tb-labeled)` and issues-lessons does not. **The fix already existed in this repo and had
never been applied to its own sibling.**

- ⚠️⚠️ **The hover is settled by the brandbook, not by taste.** Ten modules overrode the shared
  `.pd-btn-primary:hover` with `filter: brightness(.94)` at (0,4,0) against the shared rule's (0,2,0).
  That filter computes **#DF2E22 on #EE3124 — a colour that appears nowhere in Brandbook 2026.**
  `--pd-red-dark` (#C42127) is named there outright as a **Secondary** brand colour (p.14): a secondary
  brand colour for a secondary state. All ten overrides deleted, plus the ten
  `background/border/color` re-declarations beside them that only existed to raise specificity.
- ⚠️⚠️ **A REGRESSION I INTRODUCED, CAUGHT BY MEASURING AND NOT BY READING.** Adding `:not()` to the icon
  rule also removed the only source of `height:34px` for those buttons: three of them collapsed to
  **16px**. The font-size was right and the button was ruined. The labelled button now carries its own
  height — again copying minutes-of-meeting, which had it correct all along.
- **Measured after: all ten identical** — 12.5px / weight 500 / 8px radius / `0 12px` padding / 34px,
  with **10/10 painted `rgb(238,49,36)`** so the stylesheets are provably in the cascade.

#### ⚠️⚠️ A monospace bug that only shows up on Windows — which is what this app is used on
**12 hand-written monospace stacks across 7 files, in five spellings.** Five of them are
`ui-monospace, SFMono-Regular, Menlo, monospace` — an Apple system font, an Apple font and a generic,
with **no Windows font in the list at all**, so on Windows they fall through to the browser default
while the stacks naming Consolas get Consolas. Two faces, same screen.
⚠️ `--pd-mono` was **already defined and already correct** — inside `contracts-claims/module.css`, under
a comment warning that "a second definition is exactly how the two drift apart again". That warning was
right and was unenforceable from there: module.css loads only on its own page, so any other module
writing `var(--pd-mono)` got **nothing**. Promoted to `dashboard.css` unchanged; all 12 converged.
- **Brandbook p.29 names Calibri the *document* font.** Both print/export stylesheets were on Arial;
  they now lead with Calibri and keep Arial as the fallback. ⚠️ They take the literal stack, not
  `var(--pd-font-doc)` — a string written into a fresh `document.write` window cannot see this app's
  `:root`.

#### Dropdowns
Measured across every popover: **radius 4→12px in seven values, five literal shadows**, and
⚠️ **`var(--pd-shadow)` — the flat `0 1px 3px` CARD shadow — on four floating menus**, which reads as
glued to the page rather than above it. All converged to `--pd-radius-md` + `--pd-shadow-lg` (themed;
every literal was light-mode-only).
⚠️⚠️ **This deliberately revisits the 2026-09-03 (r) decision** to leave small-chrome radii alone as
"pure diff noise with no visual effect". That was correct for the 9-vs-10px it was judging; it is not
correct now, because `--pd-radius` (4px, the *smallest* rung) has since been applied to three menus and
4px against 12px on the same kind of surface is visible.
- **Three `<select>`s and three `<input>`s carried no class at all** — the bulk-update modal's whole row
  was raw browser chrome. ⚠️ Classing only the select would have made it disagree with its own
  siblings, so all four in that row were classed together.
- ⚠️ **A correction to my own first count:** I reported "32 unclassed selects". The real number is
  **three** — 29 of those were the literal text `<select>` inside code comments, which the grep counted.

#### One duplicated block, removed
`modules/project-schedule/index.html` carried **23 byte-identical lines twice** (`.ps-vs-warn`,
`.ps-vs-warnx`, `.ps-vs-seg`, `.ps-vs-badge-warn`). Safe to drop the later copy: the only rules between
the two set `transition`, which the block never declares. ⚠️ Located by **content, not line number** —
earlier edits in the same script collapse four lines into two, so any hardcoded index was already stale.
File 43,038 → 43,020 lines: −23 dedupe, +7 comment, −2 collapsed overrides, which is exactly −18.

#### Verified
- **30 contrast measurements, 15 pills × both themes, rendered against the real stylesheets: 0 below
  AA, minimum 4.57:1.** Every value matches the token arithmetic (ok 5.85/5.16, warn 5.55/4.57,
  bad 4.79/5.13, info 5.66/5.48).
- **10 `+ Add` buttons measured identical**, from each module's own shipped markup and CSS.
- `.ps-scopetag.co-strong` was `#fff` on `#E08A3C` = **2.56:1**, wrong in both themes because the fill is
  a fixed literal. Now `#231F20`, **measured 6.11:1**. ⚠️ The ink is a literal on purpose and must not
  become `var(--pd-ink)`, which remaps to `#F0EFEF` on dark and would reinstate the 2.56.
- Brace balance holds on all 9 changed stylesheets and every inline `<style>`; **0 NUL bytes**.
  ⚠️ project-schedule's `<script>` count is 16/14 — **identical to HEAD**, the documented
  `<script` -in-a-JS-string false positive, not something this change caused.
- font-family went **9 distinct values → 4**, all four legitimate.
- `dashboard.css` → `?v=20260910v3` across **all 29 pages**, `modules-grid.js` across 2 + its fallback
  literal, and the six edited modules' `module.css`. **One version each, 0 splits.**
- ⚠⚠ **THE VERSION IS `v3`, NOT THE `uic` THIS ENTRY WAS FIRST WRITTEN WITH, AND THAT IS THE COLLISION
  THIS LOG KEEPS RECORDING — the fourth time.** I picked a deliberately non-sequential token (`uic`) to
  avoid exactly this, and it did not help: the concurrent session pushed `20260910v2` while this work was
  in progress, and `uic` sorts BEFORE `v2`. A version that sorts *earlier* than one already served is worse
  than a collision — a browser holding `v2` would never fetch `uic`. Rebased and bumped past **both** sides
  to `v3`. ⚠️ The rule that actually works is not "pick an unusual letter", it is **re-derive the version
  AFTER integrating, from what the remote already has**.
- ⚠️ **20 of the 40 changed files are version-only, checked individually**, so no concurrent session's
  work is swept in.
- ⚠️ **Not verified signed in.** Everything above is a real browser measurement against the shipped
  stylesheets with auth/DB absent; no live project was loaded.

⚠️ **Rebased onto three commits from the concurrent project-schedule session** (floor-plan sync).
`CLAUDE.md` and `modules/project-schedule/index.html` **auto-merged**; the only conflicts were the three
version strings above. Checked after resolving: changelog **3,226 + 130 = 3,356 lines, 91 headings, 91
unique — no doubling**; my dedupe still holds (one `.ps-vs-warn` rule) and their Sync work is present.

#### Deliberately NOT done, each with a reason
- ⚠️ **`--boq-*` (Contracts & Claims) is left alone.** It is a *fourth* parallel palette and it is
  **correct** — paired per theme and measured, with its own note saying so. Aliasing it to the shared
  tokens is a real cleanup but it is a change to a working, documented system and belongs in its own
  commit with its own verification.
- ⚠️ **The type scale is NOT normalised here.** 485 declarations still sit off the eight rungs
  (12px×202, 11.5×86, 10.5×74, 9.5×23 …). That is the single largest remaining inconsistency and it
  changes rendering on every screen, so it needs its own measured pass — not the tail of this one.
- ⚠️⚠️ **`font-weight: 600` is flagged, not changed — and it needs an owner decision.** Brandbook p.29
  names five Gotham cuts: **Thin / Regular / Medium / Bold / Black**. There is **no Gotham Semibold**,
  and the app carries **233 declarations at 600**. It is not currently broken — the web fallback is
  Montserrat, which *does* have a 600, and essentially every user sees Montserrat because Gotham is
  unlicensed here — so this is a latent divergence that bites only if Gotham is ever installed.
  Resolving it means moving 233 declarations to **500 (Medium)** or **700 (Bold)**, which visibly
  changes the weight of the whole app in one direction or the other. That is the owner's call.
- ⚠️ `modules/material-submittal` and `modules/drawing-register` keep 36 of the 70 remaining colour
  literals: both are `enabled:false`, retired to the Engineering App, and their `index.html` stubs do
  not even load their `module.css`. The remaining 34 are the print stylesheets (paper is not themed),
  progress-photos' white pin rings on photographs (correct in both themes), and the one deliberate
  literal above.


### 2026-09-10 (u7) — A shared data-table layer, and the Stakeholder Map opens on cards

Item 6 of six owner items on the stakeholder screens. Detail in
[`modules/stakeholder-map/CLAUDE.md`](modules/stakeholder-map/CLAUDE.md). What reaches beyond the
module:

- ⚠️⚠️ **`dashboard.css` gains `.pd-dt`, and it is a PROMOTION rather than a new component.** The
  idiom is the Procurement app's `.data-table`, ported into Contracts & Claims on 2026-09-07 as
  `.cc-dt*` under its own note — *"divergent table styles is exactly what the UI-uniformity pass keeps
  having to rework"*. Stakeholder Map needed the same header strip, sortable headers, group rows and
  footer, and a **third hand-copy is how three tables end up disagreeing**. It layers over the shared
  `.pd-table`, and every value is a `--pd-*` token: the Procurement original hard-codes its colours and
  re-states them under `body.dark-mode`, so carrying the literals across gives a table that is right
  in light mode and unreadable in dark.
- ⚠️ **`.cc-dt*` is deliberately UNCHANGED.** Migrating Contracts & Claims onto the shared rules is its
  own change with its own verification; doing it here would put a module I was not asked to touch into
  this commit. Until then the two coexist, and the shared one is the successor.
- ⚠️ **Screen and layout stop being the same list.** The module's dropdown offered *Register* and
  *Cards* as two screens, so the card view and the table view of the same register were siblings and
  neither was "the register". Now one Register screen with a card/table switcher, cards by default —
  and **every hash ever issued still resolves**, because the old `list`/`cards` values normalise to the
  Register screen *and set the layout*.

**Verified** by slicing the shipped view logic out of `module.js` and driving it against the real
markup lifted byte-for-byte from `index.html`: exactly one pane visible in every state including an
unrecognised view, both legacy hashes landing on the right layout, and the band toggles rendering
inside the table card rather than the topbar. ⚠️⚠️ The first measurement of the new header strip
reported it transparent and border-less **while the CSS was correct** — the harness linked
`dashboard.css` with no `?v=` and got the browser's stale copy. That is the **second** harness this
session to report correct rules as missing; harness stylesheets are now cache-busted.

`dashboard.css` → `?v=20260910u7` (29 pages); stakeholder-map `module.js`/`module.css` and
`stakeholders.js` → `?v=20260910u7`; `MODULE_V` → `20260910u7`. ⚠️ Every one of the other 28 pages was
checked to carry **version-only** changes, so no concurrent session's work is swept in.
⚠️ **Not verified signed in.**

### 2026-09-10 (u6) — Gift Tier is removed from the app, and a migration drops the columns

Owner, on the project-level Stakeholder Map: *"Let's drop the Gift Tier as well."* Asked whether to
remove it from the UI only or to drop the columns outright, the owner chose to drop them.

**Run `migrations/2026-09-10-drop-gift-tier.sql`.**

- ⚠️⚠️ **IT DESTROYS DATA AND CANNOT BE UNDONE.** Every gift tier recorded on any stakeholder, on any
  project, is gone the moment it runs; re-adding the column afterwards gives you an empty one. The
  migration **counts the values it is about to destroy and `raise notice`s the number before the
  drop takes effect**, inside the transaction, so there is a moment to `rollback` — and its header
  carries a ready-made archive query for anyone who wants the values kept. This environment's key has
  no grants, so I could not read that count for the owner in advance.
- ⚠️ **Both tables are dropped in ONE transaction.** `gift_tier` was one of the 13 `PERSON_FIELDS`
  mirrored between `stakeholders` (the directory) and `stakeholder_map` (the per-project register);
  dropping one side alone leaves the mirror asymmetric and every insert naming the column fails
  against whichever table lost it.
- ⚠️ **The schema files are updated too** (`supabase-schema.sql`, `supabase-build.sql`,
  `supabase-setup.sql`, `migrations/VERIFY-schema.sql`). Dropping a column in a migration while the
  canonical schema still declares it means the next fresh deployment resurrects it — and the two then
  disagree silently. ⚠️ `migrations/2026-07-20-stakeholder-map-full.sql` is **history and is left
  alone**: it records what that migration did, and the drop is its own migration.
- The field is gone from both forms that carried it (the directory identity form and the register's
  own add/edit), from both copies of `PERSON_FIELDS`, and from the directory test's expectations.

**Verified by execution:** `PERSON_FIELDS` is 12, the two copies are **identical** (they are compared
element-wise, because a mirror that disagrees is the failure this contract exists to prevent), no
live file outside the migration history names the column, and the shared suites still pass — **41
matcher + 66 operations, 0 failing.** `stakeholders.js` → `?v=20260910u6`; stakeholder-map
`module.js`/`module.css` → `?v=20260910u6`; `MODULE_V` → `20260910u6`.
⚠️ **Not verified signed in, and the migration has not been run from here.**

### Snap to grid, and the traced layout finally reaches the Vertical Stacking (2026-09-10) — jasantos2

Owner: *"can you add snapping to grid. also how come the zones defined are not shown in the vertical
stacking? meaning the layout?"*

**Snap to grid** in the floor-plan window — Off / 10 / 20 / 25 / 50 / 100, remembered, drawn under
the shapes. ⚠️ The grid is in **plan units**, not pixels, so it survives a zoom and a re-upload.
⚠️ **Off is a real setting**: an as-built trace needs the corner where the drawing puts it.
⚠️⚠️ **A move snaps the box origin, not each corner** — snapping every point would *deform* the
outline as it travelled. ⚠️ A defect found by driving it: a new preset was grid-**placed** but not
grid-**sized**, so two zones added side by side did not meet; every corner of a new shape now snaps,
falling back to the rigid shape when a coarse grid would collapse it.

⚠️⚠️ **The zones were not showing for two reasons, both proved by execution — neither a rendering
problem.** The **2D card never read the floor plan at all**, and 2D is the default view. And even in
3D the join only held at **Detail 2**: deeper, the cell label becomes a location path (`Z1 · Unit A`)
while the plan stores bare zone codes, so every outline silently vanished. The matcher now tries the
whole label then each segment, left to right — the axis order, so a unit cannot outrank a zone.

**What an elevation can honestly say about a plan:** a section cannot draw a floor plan, so the 2D
card takes the two facts that *are* real — zones **ordered** left to right as drawn (⚠️ which is why
`Z10` used to sit between `Z1` and `Z2`) and **sized** by their share of traced floor **area**
(⚠️ shoelace, not bounding box). ⚠️ It degrades: no plan means the old equal shares, byte for byte,
and an untraced zone keeps its cell. ⚠️ A second defect found by testing — the minimum cell width
did not actually hold, because clamping then renormalising pushes a thin cell back under; replaced
with water-filling.

**693 assertions across twelve suites plus the runtime and extrusion checks, 0 failing**; 67 new, and
the controls run on HEAD and reproduce the reported bug. ⚠️ The window was **driven in a browser** —
all nine presets on grid, a move that snapped *and* left the shape undeformed, Off landing a corner
exactly. ⚠️ `vscheck` was taught to link module-level `var`s (the module's own declaration, never a
stub) and re-proved against the outage control: broken 0/10, fixed 10/10. ⚠️ harness12's reversal
proof is **retired on purpose** — it asserted this function never changes. ⚠️ **Not verified
signed-in** — the image upload still has never run against the real bucket.

`MODULE_V` → `20260910u3`. Detail: [`modules/project-schedule/CLAUDE.md`](modules/project-schedule/CLAUDE.md).

### 2026-09-10 (u3) — Portfolio toolbar: the project filter stops clipping, and A–Z becomes a sticky rail

Items 1 and 2 of six owner items on the stakeholder screens. Detail in
[`modules/portfolio-overview/CLAUDE.md`](modules/portfolio-overview/CLAUDE.md).

- ⚠️⚠️ **The clipping was the POSITIONING, not the width.** `.po-projfilter-menu` was
  `position:absolute; left:0; width:260px` hanging off a **right-aligned** button, so it opened
  rightwards from the right edge of the page and ran off it. It now expands **inline**, the idiom
  every other filter in this app already uses (`.pd-filtergroup`, `.po-toolbar-fields`), which cannot
  clip by construction — rather than being nudged to `right:0`, which fixes this one case and leaves
  the next to be found.
- ⚠️ **One filter button, one NODE.** Four of the thirteen views have a filter panel; `placeScope`
  *moves* the scope control into it so those views have a single control, and falls back to its own
  bar in the nine that do not. Moving the element carries its wiring, state and selection with it — a
  copy per view is what would need keeping in step.
- ⚠️ The **A–Z index is now a sticky vertical rail** beside the cards. `align-self:flex-start` is
  required or a stretched flex item gives `position:sticky` nothing to travel within — correct in the
  cascade and does not stick. On a phone it reverts to a horizontal strip: a 22px column of 27
  letters is far under the 44px touch target.

Measured in a browser with the toolbar markup lifted byte-for-byte from the shipped page and
`placeScope` sliced out of it: the panel spans 60→771 in a 1265px viewport with **no overflow and no
horizontal page scroll**, and the rail is **pinned at `top: 8px` after scrolling 1,200px**. The
funnel's `has-active` state was measured off and on, so a narrowed scope is still visible at a glance
with the panel shut. `MODULE_V` → `20260910u4`.
⚠️⚠️ **`MODULE_V` is `u4`, not `u3`: the concurrent session in this tree independently
picked `20260910u3` and pushed it first — the SAME two-sessions-same-letter collision this
log has already recorded twice.** ⚠️ It rebased **cleanly**, because both sides set the
identical string and git had nothing to conflict on, and that is the dangerous shape: my changes
would otherwise have shipped under a version a browser had already cached WITHOUT them. The
other session’s own entry above still reads `u3`, which is what it shipped.
⚠️ **Not verified signed in.**

### 2026-09-10 (u2) — Directory Health, and a duplicate scan that stops being quadratic

The dashboard half of the stakeholder-app adoption. Owner: *"And a dashboard page that can also be
adopted"*, scoped to **directory health from our own data** — so the same idea pointed at the register
we hold, not a copy of the other app's screen. Detail in
[`modules/portfolio-overview/CLAUDE.md`](modules/portfolio-overview/CLAUDE.md). What reaches beyond
the page:

- ⚠️⚠️ **`assets/js/stakeholders.js` gains `duplicatePairs`, and it is BLOCKED because scoring every
  pair was measurably too slow to ship: 900 people is 404,550 pairs and 2.3 SECONDS of blocked main
  thread.** The blocking key is derived **from the matcher's own surname gate**, never invented beside
  it — equality and the one-edit case both fall out of the deletion neighbourhood, and the
  initial-of-a-surname case needs a one-character token, so those few people are compared against
  everyone. It lives in the shared file rather than in the page because a whole-directory duplicate
  scan is exactly the thing that gets hand-copied next.
- ⚠️⚠️ **A wrong blocking key is INVISIBLE** — it drops duplicates and the screen reports *"none
  found"*. So the suite does not test the blocking, it asserts the blocked scan returns the **exact
  pair set an exhaustive scan returns**, over a directory built full of the near-misses blocking is
  most likely to lose. **Three new contrast builds, all biting.**
- ⚠️ **Two cuts of the cap were both wrong and measurement caught both.** The first enumerated every
  pair and checked the cap afterwards — 11 seconds to answer *"not scanned"*; a cap that only reports
  after paying the cost is not a cap. The second estimated cost from bucket sizes, which over-counts
  about sevenfold, and refused a 300-person directory that was 267ms of honest work. Shipped: the
  decision is exact and the enumeration aborts at the cap. **2,000 people now scan in 446ms.**
- ⚠️ The Directory's map read **stopped filtering out unlinked rows** — one read now answers both
  *"who is on which project"* and *"how many register rows predate the directory"*.

**143 assertions** across three suites (41 matcher + 66 operations + 36 health, the last two sliced
out of the shipped files), **11 of 11 contrast builds biting**. Rendered in a browser in both themes.
⚠️⚠️ **My harness reported a clean render of INVISIBLE bars** — it never loaded `dashboard.css`, so
every `--pd-*` token resolved to nothing and each fill computed transparent **with perfect widths**;
the width checks passed and said nothing about whether anything was painted. Fixed, and the harness
now asserts the fills are not transparent. ⚠️ The narrow-viewport check **did not run** (the pane
refused 420px and reported 980), so the phone case rests on the `auto-fit` rule, not on a render.

`stakeholders.js` → `?v=20260910u2`; `MODULE_V` → `20260910u2` (fallback literal included). 48 assets
on one version each, 0 splits, 0 missing; 0 NUL bytes.
⚠️ **Not verified signed in** — no health figure has been computed from the live directory, and
`migrations/2026-09-10-stakeholder-profile-fields.sql` still needs running.

### 2026-09-10 (u1) — The stakeholder directory becomes a card Universe with clickable A–Z bands

**Run `migrations/2026-09-10-stakeholder-profile-fields.sql`.** Owner, with screenshots of a separate
stakeholder app by another developer: *"I want to adopt the feature seeing the whole stakeholders
rather than a table and seeing the clickable bands. And a dashboard page that can also be adopted."*
Asked which to build first, the owner chose the **Universe view**; the dashboard follows. Detail in
[`modules/portfolio-overview/CLAUDE.md`](modules/portfolio-overview/CLAUDE.md). What reaches beyond
the page:

- ⚠️⚠️ **A CORRECTION TO YESTERDAY'S (s4) AND (s5) ENTRIES, BOTH MINE: `assets/js/stakeholders.js`
  SHIPPED WITH A NUL BYTE, AND BOTH ENTRIES CLAIMED "0 NUL bytes".** `exactKey` joins name and
  organisation with a separator that cannot occur in either — correct in intent, and written into the
  source as a **raw byte** rather than the escape `'\u0000'`. So the repo's own "0 NUL bytes" check was
  reported green against a file that failed it, twice. The byte is now the two-character escape;
  ⚠️ the runtime string is **unchanged, proved by executing both copies** — HEAD's `exactKey` and the
  fixed one agree on 7/7 inputs, the separator is still U+0000, and the collision a printable
  separator would create (`"A B" + ""` vs `"A" + " B"`) stays impossible.
- ⚠️ **The new profile columns are DELIBERATELY OUT of the `stakeholder_map` mirror.** Verified
  against the live database that `middle_initial`, `sub_sector`, `secondary_position`, `status` and
  `is_favorite` exist on **neither** table, so mirroring them would break every `stakeholder_map`
  insert. `PROFILE_ONLY` / `PROFILE_FIELDS` keep them on the directory alone, and `writeTolerant`
  **drops a refused column and retries**, reporting what it gave up — so a deployment that has not
  run the migration still creates people, minus the new fields, instead of failing.

**84 assertions** (41 matcher + 43 operations) executing the shipped file, **8 of 8 contrast builds
biting**. The Universe itself was **driven in a browser** against the real stylesheet — 27 bands, the
empty ones disabled rather than hidden, band-click filtering, all four groupings, both layouts, and
uniform card heights. `stakeholders.js` → `?v=20260910u1`; `MODULE_V` → `20260910u1` (fallback
literal included). 48 assets on one version each, 0 splits, 0 missing; 0 NUL bytes across every
tracked text file, this time actually measured - including the prose, because the same byte reappeared in
the DRAFT OF THIS ENTRY and turned the changelog into a file grep calls binary.
⚠️ **Not verified signed in** — no card drawn from the live directory, no favourite written, and the
migration has not been run.

### The floor plan window gets tools: shapes, undo, clipboard, and naming the zone (2026-09-10) — jasantos2

Owner: *"if there is no floor plan, how do i add shapes or create shapes? and how come this is the
only interactable things to do in the window."*

⚠️ **The question is the defect.** Yesterday's window could do one thing — trace a polygon corner by
corner over an attached image — so with no image there was nothing to click at all.

- **Nine shape presets** (rectangle, square, L, T, U, triangle, trapezoid, hexagon, circle), so a
  rectangular plate takes one click instead of four corners, and a floor with **no drawing yet** can
  still be laid out. ⚠️ The menu icon is drawn by the **same function that builds the shape**, so it
  cannot advertise an outline the button does not produce.
- ⚠️ **Undo (Ctrl+Z, 50 deep) is a snapshot, not an operation log** — one thing to get right instead
  of a correct inverse for each of seven gestures. ⚠️ The test is **derived from the window's own
  assignments**, so a new mutable field left out of the snapshot fails a test rather than quietly
  losing a planner's work.
- **Copy / paste / duplicate / delete**, with a deep-copied clipboard and an offset paste, and the
  zone palette doing **double duty**: it names the *next* shape, or **re-names the selected one** —
  the owner's *"defining which is zone 1 2 etc."*, which previously meant delete and re-draw.
- ⚠️ **Undoing back to nothing now drops the plate**, or an undone first shape would leave the floor
  still reading *"has a plan"*.

**104 assertions in the plan suite, 27 new, all passing**, plus the runtime and extrusion checks. The
presets are executed, not read. ⚠️⚠️ **The gestures were driven in a browser** — a preset added with
no plan image, a move by exactly the drag delta, a reshape touching one corner, the midpoint dot
adding a corner and Alt-click removing it, and four undos stepping back to an empty plate. ⚠️ Five
assertions were **retargeted** where this change rewrote the lines they described, each named and
each property unchanged or stricter. Whole set: **627 assertions, 0 failing**; ⚠️ three suites did
not run — one broken by the change-order refactor, one needing a BOQ file absent from this repo, and
one **obsolete** (it tests the zone grid replaced yesterday). ⚠️ **Not verified signed-in** — the
image upload still has never run against the real bucket.

`MODULE_V` → `20260910s5`. Detail: [`modules/project-schedule/CLAUDE.md`](modules/project-schedule/CLAUDE.md).
### 2026-09-10 (s5) — The Portfolio Stakeholders tab stops being read-only

Second half of Stage 4. The tab had a search box and a read-only table over the `stakeholder_map`
mirror; it now carries a **Directory** view over `stakeholders` itself with **+ Add person**,
**Assign to projects** and **Merge**. Detail in
[`modules/portfolio-overview/CLAUDE.md`](modules/portfolio-overview/CLAUDE.md). What reaches beyond
the page:

- ⚠️⚠️ **`assets/js/stakeholders.js` gains the data operations, and merge REFUSES rather than
  guessing.** `stakeholder_map_upd` is `(created_by = auth.uid() or is_admin())`, and PostgREST
  answers an RLS-filtered UPDATE with **200 and zero rows** — the silent-success trap recorded here
  since `boq_tag_activities`. Re-pointing rows another planner created would report success and
  change nothing. Every write is counted; a shortfall stops the merge and **deletes nothing**,
  because deleting the loser then would orphan the rows that did not move.
- ⚠️ It also refuses when both people are on the **same project** — resolving that means destroying
  one project's own assessment of them, which is not a merge dialog's decision.
- ⚠️ The duplicate warning in **+ Add person** fires *while typing*, not after saving, through the
  same shared matcher the module's save path uses — so the two screens cannot disagree.

**26 new assertions** on the shipped operations against a stub that behaves like RLS, plus the 41
matcher assertions and **8 contrast builds, all biting**. ⚠️ One contrast did not bite until the
fixture was fixed (the loser's field was null, so an overwrite build had nothing to overwrite), and
my first Supabase stub made `.select()` terminal, which threw out of shipped code that was fine.
Driven in a browser: assign, clean merge, and **both** refusal paths, with the same-project refusal
writing nothing at all. `stakeholders.js` → `?v=20260910s5`; `MODULE_V` → `20260910s5`.
⚠️ **Not verified signed in** — the RLS refusal paths are reasoned from the policy text and a stub,
never observed; the first real merge is the thing most worth watching.

### 2026-09-10 (s4) — A stakeholder typed twice under two spellings now gets caught, and asks before it links

**New `assets/js/stakeholders.js`.** Owner: *"there will be cases that at one point a stakeholder isn't
in the general database and two different planners of their respective projects will add the same
stakeholder and would have duplicate stakeholder register of the same person"* — and, when asked how
strict to be: *"let's also make sure that the warning can identify similarity in names. e.g. Fernando
Miguel Lozano vs Fernando Lozano etc."* Stage 4 of a five-stage pass.

#### ⚠️ Most of the directory already existed. What was missing was the matching.
`stakeholders`, `stakeholder_map.stakeholder_id`, the 13-field mirror, `findOrCreatePerson`, the
picker and "Save for all projects" all shipped on 2026-09-08 — and **the migration HAS been run**,
which this log said it had not. Established by probing the live database: PostgREST resolves column
names *before* the permission check, so every column of `stakeholders` and `stakeholder_map
.stakeholder_id` answers `42501` (exists, blocked by grants) against controls returning `PGRST205`
for a missing table and `42703` for a missing column. The gap was that matching was **exact**:
`lower(btrim(name))` + `lower(coalesce(btrim(organization),''))`, which cannot see the owner's case.

#### ⚠️⚠️ The matcher RANKS. It never links on its own.
An **exact** name+organisation hit still resolves silently, because the unique index makes it the only
possible outcome. A **fuzzy** hit is different in kind — "Fernando Miguel Lozano" and "Fernando
Lozano" are probably one person and might be two, and only the planner knows. Linking silently would
merge two real people into one record with no undo in the UI, which is strictly worse than the
duplicate it was preventing. So the save pauses and asks, once, with the reason on screen.

- ⚠️⚠️ **THE SURNAME GATE is what keeps it honest.** Every name rule requires the LAST token to agree
  (or be an initial of the other). Without it, "Juan Santos" and "Maria Santos" read as a near-miss on
  a shared surname, and a directory of Filipino names would surface false matches constantly.
- Rules: token-subset with a shared surname (the owner's case, 0.92), initial expansion, a
  single-token typo at edit distance ≤2 on tokens of ≥4 characters, and nickname **substituted for the
  given name** — the directory holds `Ana Reyes` nicknamed `Anne`, and the person gets typed as `Anne
  Reyes`. ⚠️ My first nickname rule only fired when the nickname equalled the *whole* other name, so
  that case scored zero. The suite caught it, not a reading.
- ⚠️ Organisation **adjusts, never decides**: agreement boosts, disagreement demotes but still
  surfaces — people change employer, and that is exactly the duplicate worth catching.
- ⚠️ `exactKey` deliberately does **not** normalise. It must agree with the DATABASE's index, not with
  the matcher, or a "find" that misses inserts a row the index then refuses and the save fails with a
  constraint error the planner cannot act on.
- ⚠️⚠️ **The prompt is gated on `isNew`, and that gate is load-bearing:** `Autosave.wire` clicks the
  same Save button on a debounce for existing rows, so prompting on edit would throw a modal up
  mid-keystroke.

#### ⚠️ A shared file, because this page has already made the other mistake
`portfolio-overview` carried a hand-copied duplicate of the S-curve maths until yesterday. Both it and
the Stakeholder Map need identity matching, so the logic lives in one file both load.

#### Verified
**41 assertions** executing the shipped file, including the owner's own case both directions, and a
**negative set** that must NOT match (two unrelated Santoses, `Jose Cruz` vs `Jose Cruzado`,
`Michael`/`Michelle Tan`, `Peter`/`Paul Lim`). **4 contrast builds, all biting.**
⚠️⚠️ **Two of them did NOT bite at first, and that was a real gap in the suite rather than proof the
code was fine.** Removing the surname gate entirely, and widening typo tolerance to two-letter tokens,
both left every assertion green — the negatives were passing for *other* reasons, so those two guards
were untested and I would have claimed them verified. Three cases were added that fail the moment
either guard is removed (`Maria Santos` vs `Maria Santos Cruz`; `Jo`/`Bo Cruz`; `Al`/`Ed Reyes`).

The dialog was **driven in a browser** against the shipped stylesheet with `confirmPerson` sliced out
of the module: Link returns the existing person, "someone else" creates, Cancel aborts the save, an
**exact** match and an **unrelated** name both raise no prompt at all, and — the safety property —
clicking Link with nothing selected **keeps the dialog open and warns** instead of silently creating.

- New `assets/js/stakeholders.js?v=20260910s4`, loaded by the two pages that need it; stakeholder-map
  `module.js`/`module.css` → `?v=20260910s4`; `MODULE_V` → `20260910s4`. 48 assets on one version
  each, 0 splits, 0 missing.
- ⚠️ **Not verified signed in** — no person has been linked or created against the live directory.
- ⚠️ **Deliberately NOT in this commit:** the portfolio-level Directory view (create a person and
  assign them to projects from the Portfolio Dashboard) and the merge tool for duplicates that already
  exist. The Stakeholders tab there is still read-only. Stopping the NEW duplicates is the half that
  prevents the problem getting worse; cleaning up existing ones is its own piece of work.

⚠️ **A correction to yesterday's (p3) entry, which was mine:** the row-level `.pd-perf-basis` line I
added to the dashboard KPI row carried `grid-column: 1/-1`, which **occupies every track** of a
`repeat(auto-fit, minmax(196px,1fr))` grid and so prevented auto-fit from collapsing the empty ones —
squeezing the four cards from 454px to 221px. Found and removed by another session three hours later
(`82e03f1`). I verified the card text and the projects table's cell arithmetic and never re-measured
the KPI grid itself, which is the one thing that change could break.

### Floor plans you can trace: attach the drawing, outline the zones on it (2026-09-10) — jasantos2

Owner: *"instead of doing this method for defining the zones / areas, i want a pop up window or space
dedicated for attaching images (like the floor plan) and tracing the zones or areas, similar to the
one in the equipment loading… that floor plan will be identified for a specific floor. Now there will
be options if that floor plan can also be applied to other floors."*

Yesterday's cell grid is replaced. A grid could say *"Zone 1 is the left third"*; a traced plan says
where Zone 1 **is**. Each floor row in **Floors & Zones** now has a **Plan** button — showing at a
glance how much of that floor is traced — which opens a window holding the drawing.

- **Modelled on the equipment site plan, deliberately**: polygons in virtual plan units (never
  pixels, so a trace survives a re-upload at another resolution), the image as a path in the
  **existing `site-plans` bucket** — so ⚠️ **no new migration** — and a fade slider for tracing over
  a busy drawing.
- ⚠️ **One plate, many floors, by reference.** "Also use this plan on other floors" is a pointer, so
  re-tracing once updates every floor sharing it. Copying would leave a forty-storey tower with
  thirty-nine stale copies after the first re-trace.
- ⚠️ **Nothing from yesterday is lost**: a grid plate is migrated to polygons on read, one rectangle
  per painted cell, and the per-type bag is carried across too.
- **The 3D card extrudes the real outline** — and ⚠️ the progress split stays *hard-edged* on a traced
  shape, because the polygon is genuinely **cut** at the done fraction rather than tinted. A zone
  traced in two pieces is drawn as two pieces.

⚠️⚠️ **Three defects came out of driving the window rather than reading it**: deleting the last area
left an empty plate in the setup (the exact rule the grid version had and this one lost); the "No plan
attached" prompt showed *through* the traced shapes; and a zero-area clip reached the geometry
builder, now guarded by a shoelace-area test rather than a point count. A fourth was caught by
inspection — the old per-storey plate comparison would have **thrown** on the new shape, so it is
deleted rather than left dead.

**779 assertions across thirteen suites plus the runtime check, all passing** (89 new, including a
suite that executes the extrusion against a recording stand-in for three.js). ⚠️ Five assertions
needed *retargeting* where this change rewrote the lines they described. ⚠️ Two suites remain broken
by the concurrent change-order refactor. ⚠️ **Not verified signed-in** — storage is stubbed in the
harness, so **the upload has never run against the real bucket**; that is the first thing to try.

`MODULE_V` → `20260910a`. Detail: [`modules/project-schedule/CLAUDE.md`](modules/project-schedule/CLAUDE.md).

### 2026-09-09 (y) — The brand mark grows 29%, the caption goes white, and the block does not get taller

Owner: *"Make the logo bigger and the Planning Suite color white. Optimize the space as well and make
sure everything looks professional looking."* Four asks, and the third is the one that constrains the
other three — a bigger mark that simply pushes the nav back down is not an optimisation.

#### ⚠️ The mark was smaller than its box, which is why 28px read small
`favicon-icon.png` is the M padded into a 256x256 canvas. **Measured off the file rather than eyeballed:
the opaque bounding box is 224x187, i.e. 87.5% x 73.0% fill.** So the 28px box was drawing a
**24.5 x 20.5** glyph — the mark was already losing ~4px to transparent padding before it sat down
next to the words. At **36px** the drawn glyph is **31.5 x 26.3**. That is the "bigger" that was asked
for, and it is bigger by more than the box numbers suggest.

#### ⚠️⚠️ It got bigger and the rail got SHORTER, which is the whole of "optimize the space"
Padding went 14/12 → **11/10**, so with a mark 8px taller the brand block measures **58px** against the
56px it measured before this round (and the **95px** it was two rounds ago). The nav starts at 58px.

⚠️ **The collapsed rail was re-padded to the same 11/10, and that fixed a jump nobody had reported.**
It carried `16px 8px`, so its brand block was 60px against the expanded rail's 56 — toggling the rail
nudged all 13 nav rows by 4px. Both states now measure **58px** and the rows hold still.

⚠️ **The mobile drawer went 28/22 → 22/18** for the same reason in reverse: left alone, the taller mark
would have added 8px to a drawer header that did not need it. It now measures **77px**, 2px *less* than
before, and `max()` still hands a notched phone its safe-area inset.

#### ⚠️ White is not only what was asked for — the red caption was failing contrast
`--pd-red` (#EE3124) on the rail (#231F20 light / #161717 dark) computes to **3.96:1 and 4.36:1**. At
10px that is small text, so the bar is **4.5:1**, and it was under it in both themes. `#fff` computes to
**16.30:1 and 17.96:1**. It also resolves a hierarchy problem: the mark and the words were both red, so
two things competed to be the brand; with the mark keeping the colour, the words become the brightest
*text* in the rail, above the nav rows' `rgba(255,255,255,.65)`.
- Caption sized 10 → **11px** (`--pd-fs-xs`) to hold its own beside a bigger mark, and tracking eased
  **.18 → .15em**, because the same tracking at a larger size ran the lockup wide.

#### Verified
Measured in a harness whose brand markup is lifted **byte-for-byte out of `dashboard.html`** (only the
`src` swapped for the real PNG's bytes as a data URI) with `dashboard.css` inlined, at 1440x820:
- **Expanded rail (240px):** block **58px**, mark **36x36**, lockup centred to **0.05px** (34.8 vs 34.75
  ideal), caption `rgb(255,255,255)` / 11px / 1.65px tracking, **18.7px** of slack before the inner edge.
- **Collapsed rail (64px):** block **58px** — identical to expanded — mark centred **32.0 vs 32.0**,
  **6px** clearance each side of the 48px inner width, caption and section labels `display:none`.
- **Mobile drawer (290px @ 718px):** block **77px**, mark 36px, caption shown.

⚠️ **The first attempt measured nothing.** The pane renders a file outside the project as a `data:`
snapshot, so the relative `<link>` to `dashboard.css` resolved to nothing and it reported black text and
a 702px sidebar — the *third* time this session a harness has reported an unstyled page as a finding.
Inlining the stylesheet is what made the numbers real. ⚠️ A `getBoundingClientRect` read issued in the
**same batch** as `resize_window` also returned 240px for a 64px rail. **Not pre-reflow geometry — it is
the first frame of a transition.** `.pd-sidebar` carries `transition: width .2s ease, flex-basis .2s
ease, padding .2s ease` (dashboard.css:135), so an immediate read returns the START value and looks
settled. The computed-style read said 64px while the rect said 240, which is the tell. The fix is not
to wait: inject `*{transition:none!important;animation:none!important}` and force a reflow before
measuring anything that animates — the trap is already on file from 2026-09-01 and 2026-09-09.

⚠️ Screenshots could not confirm the visual — the static snapshot does not re-render after DOM
mutation — so this rests on geometry and computed styles, not on a picture.

CSS-only across all 29 pages; no markup changed. `dashboard.css` → `?v=20260909y`. `MODULE_V` untouched,
because no module asset moved.

### 2026-09-09 (x) — The sidebar brand becomes the red M with PLANNING SUITE beside it

Owner: *"Instead of the Megawide Construction logo lets make it the red megawide m logo and beside
it is the Planning Suite."* **CSS only** — both `<img>`s were already in all 29 pages' markup (the
wordmark for the expanded rail, the mark for the collapsed one), so no HTML changed.

⚠ **The wordmark named the company; the mark can do that in 28px.** `MEGAWIDE CONSTRUCTION` is a
5.81:1 lockup, so it had to span most of a 240px rail to stay legible — spending the widest element
in the sidebar on something every page of this app already belongs to, while the thing it actually
identifies, the Planning Suite, was the small red line underneath. Now the mark carries the company
and the product name gets the row beside it.

| | before today | after (w) | **after (x)** |
|---|---|---|---|
| brand block | 95px | 79px | **56px** |
| first nav row | 131px | 109px | **87px** |

**44px reclaimed across the two changes**, a third of the original block, with the nav starting
where the logo used to end.

⚠⚠ **`gap` WAS THE WRONG TOOL AND MEASURING IS THE ONLY REASON I KNOW IT.** The markup carries a
bare `Planners Dashboard` text node between the two images — the thing `font-size: 0` exists to
hide. In a flex container that text node becomes an **anonymous flex item**: zero-width, but still
an item, so `gap: 9px` was applied on **both** sides of it and the measured space came out **18px**.
The spacing is a `margin-left` on the caption instead, which is exactly one gap however many empty
text nodes the markup carries. Re-measured: **10px**, lockup centred to within 0px.

⚠ **All three brand states move together, and two of them invert.** The mark was `display:none` by
default and shown only under `.pd-collapsed`; that default is now `block`, so the collapsed rail
drops only the *words* (verified: rail 64px, mark `block` and centred, words and wordmark `none`),
and the phone drawer — which re-expands `.pd-collapsed` — stops restoring the wordmark and stops
suppressing the mark. With one mark instead of two there is nothing left to stack.

⚠ **The phone drawer is verified by SOURCE, not by measurement, and that distinction is the point.**
The pane refused to emulate a narrow viewport for the second time today, reporting `clientWidth 980`
against a 375px request — so what that check measured was the *collapsed desktop rail*, not the
drawer. Verified instead against the shipped bytes: all three rules present verbatim, brace-matched
as **contained** in the `@media (max-width: 820px)` block at lines 1067–1118, and both base
declarations (176, 193) earlier in source order. That is a proof about the cascade; it is not a
rendered drawer, and it is worth checking on a real phone.

⚠ `logo-white.png` is **retired from the sidebar, not deleted** — it is still the login and home
mark (`.pd-auth-mark`), and its `<img>` stays in the markup, which is what kept this to one file.
⚠ `dashboard.css` is SHARED — `?v=` bumped across **all 29 pages**. `MODULE_V` → `20260909x`.
⚠ **Not verified signed in.**
### Zone layout in Floors & Zones — the prerequisite the 3D stacking reads (2026-09-09) — jasantos2

Owner: *"the pre-requisites for the 3D to be established is to define the location of the zones and
areas. in the schedule setup, in the step of defining the floors… per floor or type (type is the
basement, podium / commercial, typical, roof deck)."*

A floor's zones were an **ordered list and nothing more**, which is exactly why both stacking cards
drew them as equal slices. Floors & Zones now has a **Zone layout** editor: a coarse plan grid held
per floor **type**, with a per-floor override, saying which part of the plate each zone occupies.

- ⚠️⚠️ **A grid, not a polygon** — deliberately. It gives each zone its **position** and **relative
  size**, which is what the stacking views ask for. It is **not** a survey: no dimensions, and the
  editor and the 3D footer both say so.
- ⚠️ **Per type first**, because a forty-storey tower has four or five distinct plates, not forty.
  One floor that genuinely differs gets its own; "Use the type's plate" gives it back.
- ⚠️ **Keyed by zone code**, so one plate serves every trade that names its zones the same way — a
  floor has one physical shape, and a plan per trade would let two trades disagree about one slab.
- ⚠️ **The plate is created only when a cell is painted.** Arriving, switching type or nudging the
  grid write nothing, so "no plate yet" stays true.
- **The 3D card reads it**: zones sit where you put them, a zone spanning cells is drawn across them,
  and the footer says whether the positions are yours or a guess. ⚠️ One plate is drawn per tower, so
  storeys whose plates disagree fall back to the old wrap rather than squashing one onto the other.

⚠️⚠️ **Two defects came out of driving the editor in a browser**, not from reading it — both made a
planner's own layout look lost: picking a floor with no override drew an empty grid instead of the
plate that floor actually uses, and "Use the type's plate" then reported "no plate yet" over an empty
grid while the type's plate sat there intact.

**770 assertions across twelve suites plus the runtime check, all passing** (79 new). ⚠️ Three suites
needed *retargeting* where this change edited the lines they described — named, not quietly adjusted.
⚠️ Two suites remain broken by the concurrent change-order refactor. ⚠️ **Not verified signed-in**:
nothing was saved to a setup, so the 3D card has not been seen reading a real layout.

`MODULE_V` → `20260909x`. Detail: [`modules/project-schedule/CLAUDE.md`](modules/project-schedule/CLAUDE.md).

### 2026-09-09 (w) — The sidebar brand block gives 22px back to the nav

Owner: *"Reclaim the height so the nav starts higher, smoothen the placement of the Planning
Suite."* **Measured at 1440×820 before touching anything**: the brand block was **95px** and the
first nav row began at **131px** — 22 top padding + 30 logo + 9 + 15 wordmark + 18 bottom + 1 rule,
and then nav's own 16 before the PROJECT label. Nearly a fifth of a 13-item rail spent before the
first item.

| | before | after |
|---|---|---|
| brand block | 95px | **79px** |
| first nav row | 131px | **109px** |
| PROJECT label | 111px | **89px** |

⚠ **The wordmark is smoothed, not just squeezed.** The old rhythm ran **22 / 9 / 18** — the
wordmark sat nearer the logo than the rule beneath it while the outer margins disagreed by 4px, so
the lockup read as drifting rather than centred. It is now **14 / 7 / 13**: the pair stays tight
(the wordmark belongs to the mark) with outer margins that read as even. Measured, not eyeballed.
⚠ The `.18em` letter-spacing and the matching `padding-left` optical re-centre are untouched — that
hack is correct and its comment explains why.

⚠ **Both other brand states verified unchanged.** The collapsed icon rail keeps its own
`16px 8px` and still swaps the wordmark for the mark (measured: 63px, logo `display:none`, mark
`block`). The phone drawer keeps its safe-area padding because the `@media (max-width:820px)`
block restates `.pd-brand` at **line 1084**, after the rule edited at **line 154** and at equal
specificity — ⚠ confirmed by SOURCE ORDER rather than by measurement, because the pane refused to
emulate 420px and reported 980 instead. Saying which of the two it was matters: one is proof, the
other is a check that did not run.

⚠ `dashboard.css` is SHARED — `?v=` bumped across **all 29 pages** in one pass; a partial bump
leaves pages disagreeing about which copy they hold. `MODULE_V` → `20260909w`.
⚠ **Not verified signed in** — measured in a harness carrying the brand markup byte-for-byte from
`dashboard.html` and the real stylesheet.
### 2026-09-09 (v) — Progress Photos at 150+: the gallery was missing the collapse the LIST view already had

Owner: *"The progress photos UI need to be updated ... This needs to be properly compiled when
anticipating the photos database could reach up to 150+ photos."* Measured before changing anything,
by slicing the **shipped** `galleryHTML` / `groupRows` / `cardHTML` / `thumb` out of `module.js` and
running them over fixtures — so the markup under measurement is the real renderer's, not a copy.

| photos | DOM nodes | page height | **screens of scrolling** |
|---|---|---|---|
| 150 | 1,549 | 9,747px | **10.8** |
| 400 | 4,049 | 22,880px | **25.4** |

⚠⚠ **THE THROUGHPUT WAS NEVER THE PROBLEM, and it is worth saying because that is where a scale
complaint usually leads.** All 150 images already carry `loading="lazy"`; signing is already batched
through `createSignedUrls` with a transform-thumbnail path and an on-demand full-res fallback; the
DOM is small. Nothing here needed virtualising, paginating or caching.

⚠⚠ **What it lacked was a way to put a month away once you had looked at it — and the LIST view has
had exactly that all along.** `listHTML` emits `.pp-group` with `data-group`, reads `collapsed[g.key]`
and `saveUI()`s it; `galleryHTML` emitted a plain heading with none of it. So the view the owner was
complaining about was the one *without* the feature its sibling already shipped. That is an
asymmetry to close, not a feature to invent.

- **Gallery groups collapse**, reusing `collapsed{}` and the **same keys** the list writes — so a
  month closed in one view is closed in the other, and one wiring serves both
  (`.pp-group,.pp-gallerygrouphead[data-group]`) so they cannot drift apart.
  **Measured: collapsing 7 of 8 month groups takes 150 photos from 10.8 screens to 1.6 — −85%.**
- **The heading is sticky**, `top:0; z-index:2`, matching `.pp-grid-head` (the list view's own sticky
  header) rather than inventing a second convention. Measured mid-scroll at 4,200px: exactly **one**
  heading pinned, reading *June 2026 · 21*. Before, headings scrolled away and a tile wall said
  nothing about where you were.
- ⚠ The class stays `.pp-gallerygrouphead` rather than becoming `.pp-group`: the list's rule carries
  `min-width:980px` for its horizontally-scrolling grid, which would have forced a phantom scrollbar
  across the tile wall. Same behaviour, its own chrome.

⚠ **A cached stylesheet nearly produced a false negative.** The first measurement reported the head
as `position:static` with a transparent background — the harness linked `module.css` with no `?v=`
and the browser served the old copy. The rule was correct on disk the whole time. Cache-busted and
re-measured; this is the same class of thing this repo's own `?v=` discipline exists for.

`module.js` / `module.css` → `?v=20260909v`; `MODULE_V` → `20260909v`.
⚠ **Not verified signed in** — fixtures through sliced renderers, no real photo row rendered.
### Vertical Stacking restored after I broke it, plus 3D in full screen and under Planned vs Actual (2026-09-09) — jasantos2

Owner, with a screenshot: *"where is the 3D? and how come there is an error, no vertical stacking
now."* The live view read **"below is not defined"**.

- ⚠️⚠️ **I broke it.** Yesterday's refactor lifted the level ordering into `_vsTowerModel`; that
  region declares `above` and `below`, the drawing code still reads both, and the model did not hand
  them back — so the card threw on every project. Fixed by returning them.
- ⚠️⚠️ **And the proof I trusted could not see it.** I had verified that refactor by *reversing* it
  and diffing against HEAD statement for statement. That passed, and was worthless here by
  construction: reversing the extraction reassembles the whole function, so every variable resolves
  inside it regardless of the shipped scope. **A textual-equivalence proof cannot see a
  ReferenceError.** I checked the code was the same and never checked it still ran.
- **Two checks now exist.** A runtime check that *executes* the shipped renderer on all three bases
  and the trade-split path; ⚠️ its resolver links the **real** functions on demand and **refuses to
  stub** any name the module does not define as a function — otherwise it would have gone green on
  the broken file. Proved both ways: 10/10 fail naming `below` on the broken file, 10/10 pass on the
  fixed one. Plus a static check that no variable left in the model is still read by the renderer.
- **Where the 3D was:** already in the Vertical Stacking toolbar, `2D | 3D`, 2D default. It was
  invisible only because the view threw before the toolbar drew.
- **Planned vs Actual in 3D:** the 2D cell's three channels, unchanged — fill = the trade (⚠️ kept,
  because replacing it once made every trade unidentifiable), brightness = done, and the **slip on
  the block's edges**, plus a **baseline mark** at the planned fraction (absent when there is no
  baseline; a mark at 0 would claim something different).
- **Full screen in 3D:** the focus window builds the model, two side-by-side under compare, each
  with its own viewpoint bar. ⚠️ The SVG-only zoom/fit controls are **not emitted** rather than left
  dead — which created a null-dereference crash that the suite caught. Full screen **resizes** the
  canvas, and the scrubber rebuilds the scenes while keeping the chosen viewpoint and disposing the
  old GPU contexts.

**479 assertions across eleven suites plus the runtime check, all passing.** ⚠️ Two suites remain
broken by the concurrent change-order refactor (named again, not dropped). ⚠️ A `sed` prefix match
nearly shipped collateral damage to two unrelated version strings — caught by reading the diff.
⚠️ **Not verified signed-in**: the fix is proved by executing the shipped renderer, not by loading
the live page.

`MODULE_V` → `20260909v`. Detail: [`modules/project-schedule/CLAUDE.md`](modules/project-schedule/CLAUDE.md).

### 2026-09-09 (u) — The dashboard KPI cards were squeezed BY the line the owner asked to remove

Owner, two asks in one message: *"The 4 KPI cards should fit properly right now everything looks
squeezed"* and *"remove the ... tooltip since this is understood common sense."* **They were the
same bug**, which is not what either of us expected.

⚠⚠ **`grid-column:1/-1` OCCUPIES EVERY TRACK, SO `auto-fit` CAN NEVER COLLAPSE ONE.** The grid is
`repeat(auto-fit, minmax(196px, 1fr))`, which at 1900px lays down **eight** tracks and is supposed
to collapse the four with nothing in them. The basis paragraph spanned `1/-1`, so all eight counted
as occupied and the four cards were handed a quarter of the row each.

**Measured at 1900px, before and after, in a harness carrying the shipped rules:**

| | tracks | card width | caption lines |
|---|---|---|---|
| with the basis line | `221px × 8` | **221px** | 2–3 |
| without it | `454px × 4` + 4 collapsed | **454px** | 1–2 |

**+233px per card**, from deleting a sentence. No grid rule was touched — the auto-fit was correct
all along and was simply being prevented from doing its job.

⚠ **The prose was defensible when it was written** (a number with no stated basis gets trusted
further than it deserves) and the owner is right that EV ÷ PV and duration-weighting are common
ground for a planner. ⚠ The **empty** cards keep their own text: that is not an explanation of a
concept, it names a missing input and where to capture it, which is actionable — and it is the half
the earlier entry's reasoning actually protects.

The now-dead `.pd-perf-basis` rules went with it. `MODULE_V` → `20260909u`.
⚠ **Not verified signed in** — measured against the shipped rules in a harness, not on live data.
### Vertical Stacking gains a 3D view, with the plan layout and the four elevations as its prerequisites (2026-09-09) — jasantos2

Owner: *"establishing a 3D view of the 2D vertical stacking that is already established… the
pre-requisites is defining the section plan and how the layout of the zones and areas are. As well
as defining from the top view, which is the front, right side, left side and rear elevations."*

- **A `2D | 3D` switch on the Vertical Stacking toolbar.** The 3D card is the *same* storeys, the
  same grade line and the same cells as the 2D card — ⚠️ literally: the level ordering was lifted
  into one `_vsTowerModel` that both renderers read, because two renderers deriving their own order
  is how a 3D view ends up disagreeing with the 2D view of the same data.
- ⚠️⚠️ **The 2D card is proved untouched, not spot-checked.** It is the view read daily and this
  moved 28 lines out of the middle of its renderer, so the suite **reverses the refactor** and
  asserts the result equals HEAD's renderer statement for statement — a proof over every input.
- **The prerequisites**: *Plan columns* (how the zones wrap in plan) and *Front faces N/E/S/W*
  (which edge is the front). Right, rear and left are **derived** by rotation, never stored — a
  building cannot have two fronts. Six viewpoints follow: Front / Right / Rear / Left / Top / Iso,
  plus drag to orbit and click a block for its dates (the *same* panel the 2D cell opens).
- ⚠️⚠️ **Two geometry flaws that only measurement found**, both plausible on screen: per-storey grids
  drew a 2-zone floor at half the width of a 4-zone floor (a floor with two zones has the *same*
  plate, cut differently), and a storey whose cells did not fill its grid left a hole — three cells
  covering 4.5 of a 6-unit plate. Every storey now tiles the same plate exactly, asserted for every
  cell count on every plate up to twelve zones.
- ⚠️ **What it is not**: a survey. The schedule holds zones as an ordered list with no outlines,
  coordinates or areas, so the footprint is schematic and the card **says so on screen** — no length
  or area is implied. Cross-sections drawn off real plans remain a separate piece of work with a
  storage decision in it.
- three.js is the **same pinned r128 Progress Photos already ships**, loaded **lazily** so the grid
  does not pay 600KB for a card most sessions never open, and every repaint frees its WebGL contexts
  (a browser caps them, then silently kills the oldest).

**732 assertions across eleven suites, all passing** (73 new), and the card was **drawn, orbited and
picked in a real browser** with the real library. ⚠️ **Not verified signed-in** — it ran against a
fixture model, never inside the module with a live project's activities.

`MODULE_V` → `20260909a`. Detail: [`modules/project-schedule/CLAUDE.md`](modules/project-schedule/CLAUDE.md).

### 2026-09-09 (t) — Minutes of Meeting: the empty card above the table was one we emptied ourselves

Owner: *"There is a big empty space above the table let's fix the UI."* Self-inflicted, and the
history is in this log: on **2026-09-03** Filter, Export and **+ Add meeting** all moved OUT of that
in-page row into the secondary top bar, and the leading “3 meetings” count moved BELOW the table as
a footnote. Each move was right on its own. What none of them noticed is what was left: a bordered,
padded, full-width **card whose entire content was a 34px two-button toggle**.

⚠ **A card is a container for content.** With nothing left to contain it stops reading as a
container and starts reading as a rendering fault — which is exactly how it was reported. The chrome
is removed (no background, no border, no padding) and the row simply right-aligns its toggle above
the table. **Measured against the real stylesheet: 54px → 36px**, plus the bottom margin 14 → 10.

⚠ **The toggle STAYS in the content rather than following the other three into the topbar.** Item 6
of that same 2026-09-03 round moved view toggles deliberately *out* of the chrome and into the
content, “on top of the view they switch”. So the chrome goes and the control stays — removing the
card is not an invitation to undo that.

⚠ The `flex:1` spacer div went with it: the row right-aligns itself now, and a spacer whose only
job is to push one control across is a div somebody has to reason about the next time a second
control appears. ⚠ The **filters panel** below is untouched and keeps its own card — verified, since
stripping the wrong one would have left the open filters floating on the page background.

`module.js` / `module.css` → `?v=20260909t`; `MODULE_V` → `20260909t`.
⚠ **Not verified signed in** — measured in a harness carrying the real stylesheets, not on the live
module.
### 2026-09-09 (s) — Contracts & Claims: two duplicate buttons removed, and the export finally asks

Six owner items on the Contract tab, all of them about the same thing — controls sitting where they
do not belong.

- ⚠⚠ **"Add BOQ…" is gone from the BOQ toolbar.** *"There is an +Add button in the title bar and
  another Add BOQ at the bottom."* The topbar **+ Add** opens the same wizard, and that wizard's BOQ
  step creates a **new BOQ document** (`boqPath() === 'add'`), not only a revision on an existing
  one — checked before removing it, because deleting the only route to a second trade BOQ would
  have undone a feature asked for two days ago. The **empty-state** button stays: with no BOQ at all
  the section is otherwise a dead end, and a call to action is not a duplicate of a visible control.
- ⚠⚠ **`+ Lot` is gone from the Contract records head.** Also verified first: lots are created by
  the contract wizard's package step, and by **editing** the contract record afterwards (the pencil
  offers the same None / Define / Link choice). The `+ Lot` **inside** the Contract lots section
  stays — but that section only exists once a lot does, so it is an action within its own subject
  rather than an invitation on a screen where the right answer is almost always zero lots.
- **The keyboard hint moved to the FOOT of the grid.** In the filter bar it put a line of keyboard
  syntax between the planner and the first row on every open — read once, then in the way forever.
  ⚠ The `isDraft() && canWrite` comment travelled with it, because the `var`-hoisting trap it warns
  about travels with the line.
- ⚠⚠ **The topbar export now asks what to export.** *"There is an export button at the title bar we
  can have option to export to excel for which items contracts/boq/ or all."* It used to emit
  whichever register tab you were on, silently, so the BOQ needed a second Export button further
  down the page. That button is deleted and the topbar opens a chooser: **records / BOQ / both**,
  both sheets in one workbook.
  ⚠ **Each sheet is built by its own module** — `BOQ.sheet()` and `recordsSheet()`, both refactored
  to return rows and write nothing. A chooser that rebuilt either column set would be a second
  definition of what an export contains, and the two would drift the first time a column moved.
  ⚠ An option with nothing behind it is **disabled with its reason on screen**, not hidden — hiding
  it would leave the planner wondering whether the app can export a BOQ at all.
- **Contract records gets the section head the BOQ has.** *"The UI of Bill of Quantities title is
  okay. Let's adopt the same way for the contract records."* Bill of quantities and Contract lots
  are both announced by a `.cc-sechead`; this one carried its title inside the card, so three
  sections on one page were introduced two different ways. The card's own `<h3>` went with it —
  repeating the words directly under the heading is what made that header feel crowded.
- **The project selector drops "Group Head: ".** *"just leave who the group head is"*. In a
  two-line row the subtitle has room for the location and a name; the label spent a third of it
  restating a column heading the reader already understands. Three sites in the shared `ui.js`.

**Verified:** all six confirmed by static assertion (button ids gone, section head present, hint
under the grid, dead `pk-addfirst` wiring removed with its button); the new chooser **rendered
against the real stylesheets** in both themes — disabled option dimmed at 0.55 with `not-allowed`,
first enabled option pre-selected, every colour resolving through `--pd-*` in dark. Class audit
clean apart from the two pre-existing strays this log already records (`boq-clm`, `cc-listbar`).
41 JS files parse; CSS braces 555/555; every asset on one version.
⚠ `ui.js` is SHARED — `?v=` bumped across all 21 referencing pages in one pass.
contracts `boq.js` / `module.js` / `packages.js` / `module.css` / `ui.js` → `?v=20260909s`;
`MODULE_V` → `20260909s`. ⚠ **Not verified signed in** — no workbook has actually been written.
### 2026-09-09 (r) — The change-order engine becomes shared, and the wizard previews what it will create

**New `assets/js/co-insert.js`.** Owner: *"The per activity view doesn't bring much value ... I was
thinking that it would show the whole Gantt view of the schedule and it would see the relationships
per level/activity/wbs ... We should also consider when a change order not only affects existing
activities but will also add them. I believe there is a function already that is available in the
schedule module. Let's implement holistically."* All three are right, and the third is the one that
decided the shape of this.

#### ⚠️⚠️ The arithmetic moved out of project-schedule, and the reason its own comment gave for keeping it was half right
`splitPlan` / `splitBuild` / `bulkSplitPlan` lived inside `modules/project-schedule/index.html`, under
a comment stating: *"AND IT LIVES HERE, NOT IN CONTRACTS & CLAIMS ... inserting the work is this
module's job."* **True of the WRITES, which still happen only there. False of the READS.** Contracts
& Claims has to preview the same result — a planner raising a variation needs to see the activities
it will create before agreeing to it — and the only two ways to do that were to copy the arithmetic
or share it. `affected.js` already carried a comment refusing the copy: *"a second copy of the one
calculation a CO claim turns on."* So it is shared: **one implementation, two callers.**

⚠️⚠️ **THE DATE HELPERS ARE INJECTED, AND THAT IS WHAT MADE THE MOVE SAFE.** project-schedule's
`pd`/`dstr`/`addDays` are **local-time**; contracts-claims' are **UTC**, deliberately (in UTC+8 a
plain `YYYY-MM-DD` parsed locally lands on the previous day at 16:00 and every bar starts a day
early). Standardising the shared file on either would have silently moved the other module's dates.
The *arithmetic* is what must not be duplicated; the date representation is each module's own.

⚠️ **One deliberate behaviour change, recorded rather than left to be discovered:** the single-insert
id allocator now scans to 9999 rather than 999, because the bulk allocator (which threads a `taken`
map, without which 23 hosts under `CO-014` would every one be handed the id `CO-014`) is the survivor
of the two. It can only ever find *more* free ids.

**Proved identical, not asserted:** a suite slices the OLD `splitPlan`/`splitFreeId`/`splitBuild`/
`_bulkFreeId`/`bulkSplitPlan` out of **git HEAD** and executes them beside the shipped shared file
over the same inputs — 3 starts × 6 spans × 4 durations × 5 cut positions, plus id collisions,
1/5/23-host runs, a fixed cut date producing mixed refusals, and the undated / already-cites
branches. **370 results compared, 370 identical, 0 differing.** A refactor that cannot show this is a
rewrite with extra steps.

#### The preview is a Gantt, and it draws the work being ADDED
The per-activity strip is gone. In its place, grouped under their **WBS branches** (collapsible,
open by default): each host bar drawn to its **new** finish with the notch where work stops, and —
the half the old preview could not show at all — **the change-order activity that will be created**,
as its own red row beneath its host.

- ⚠️ Those rows come from `bulkSplitPlan`, **the same function the schedule runs when it performs the
  insert**. The ids are real (`CO-014`, `CO-014-2`, `CO-014-3` — the bulk allocator working), the
  dates are real, and the tooltip carries the actual predecessor string (`ST-5-1 SS+12`). The preview
  cannot drift from the insert, because there is nothing to drift from.
- ⚠️ **A refused host says so on its own row** — *"A 1-day activity cannot be split…"*, the engine's
  own message — rather than being quietly absent from a list the planner believes is complete.
- ⚠️ **An EOT plans nothing.** Its activities are the delay *basis*; the granted days move the
  contract completion date and are not added to the work. The schedule's bulk screen refuses one for
  the same reason, and proposing rows here would invite a planner to expect activities that will
  never exist.
- ⚠️ The Gantt is **not behind a `<details>` any more**. It was, while it was a strip of 240
  one-pixel bars — correct then, wrong now: it *is* the preview, and the impact headline above it is
  the summary of what it shows. The preview pane grew 300 → 360px to match, and the tree beside it
  with it.
- ⚠️ Preview branches keep their **own** open/closed map. Sharing one with the picker tree made
  collapsing in one pane silently reorganise the other; and a collapse stores `0` rather than
  deleting the key, or it would be indistinguishable from never-seen and spring open on the next
  repaint — which is every keystroke.

#### Verified
370 equivalence assertions (above) + the 18 on `impactOf`, all sliced from shipped files. Driven
through the real `CCWizard.open()` at 1440px in both themes: **21 activities created, 1 refused**,
ids allocated from the reference, WBS grouping correct, no page horizontal scroll, and every colour
resolving through `--pd-*` in dark (`.cca-gr-bar` → `#6f767d`, no hardcoded light grey). Class audit
clean **both** ways after deleting the now-dead `.cca-mg-*` strip rules and the `<details>` rules.
⚠️ Also brought the `MODULE_V` **fallback** literal current — it had drifted 4 versions behind. It is
only used by a page that omits the `?v=`, which is why the drift was invisible.
`co-insert.js` (new) / `affected.js` / `wizard.js` / contracts `module.css` → `?v=20260909r`;
`MODULE_V` → `20260909r`.
⚠️ **Not verified signed in** — fixture data through a stubbed layer. No activity has been inserted.

### 2026-09-09 (p3) — Portfolio's 13 in-page tabs go, the S-curve becomes per-project, and the KPI cards stop explaining themselves

Owner's three Portfolio Dashboard items and two Project Dashboard items. Stage 3 of a five-stage pass.
Detail in [`modules/portfolio-overview/CLAUDE.md`](modules/portfolio-overview/CLAUDE.md) and
[`modules/progress-photos/CLAUDE.md`](modules/progress-photos/CLAUDE.md). What reaches beyond a module:

- ⚠️⚠️ **`ui.js` gains a MILESTONES row, and without it the tab removal would have orphaned a whole
  view.** Milestones has no module, so `PORTFOLIO_TAB` — which maps module keys to portfolio views —
  cannot produce it, and the in-page strip was its only entry point. Found by enumerating what the
  sidebar can reach *before* deleting the thing being replaced, not after.
- ⚠️⚠️ **THE PORTFOLIO ROLE GATE MOVED FROM THE TAB BUTTONS INTO `switchView`, AND IS STRICTLY
  STRONGER.** It used to set `hidden` on five `.po-tab` buttons — which never stopped anyone typing the
  `#po_view=` hash, because the hash routes straight to `switchView`. Gating the view closes the entry
  point the tabs never covered. Same five modules, still matching `superAdminOnly` in `config.js`;
  UI visibility only, no RLS change.
- ⚠️⚠️ **`portfolio-overview` STOPS CARRYING ITS OWN COPY OF THE S-CURVE MATHS.** `scCompute` was a
  hand-copied duplicate of `assets/js/scurve.js` — the exact drift the 2026-09-01 extraction into
  `PDScurve` existed to prevent — and it is now a wrapper over the shared engine. This is a
  prerequisite, not tidying: the *"Overall Progress" ≡ "Actual to date"* identity bug exists in three
  places, and Stage 5 can only fix it once if this page reads the shared engine.
- **The portfolio S-curve draws one line per project**: colour = project, Baseline dashed, Actual
  solid, Forecast dotted. ⚠️ The y-axis is **per-project percent**, never a shared absolute total — a
  40,000-day programme would otherwise flatten a 2,000-day one into the axis. ⚠️ `project_id` had to be
  added to the lean select; its absence is precisely why this was impossible before. ⚠️ Above five
  projects it defaults to Actual-only **and says so on screen**; no project is ever silently dropped.
- **Project Dashboard: four KPI paragraphs become four short notes plus one row-level sentence.**
  Owner: *"There are too many text tooltips for each KPI card."* ⚠️ The load-bearing comment above
  `perfCard` still holds — POC is duration-weighted while SPI/CPI are cost ratios, and a row of bare
  numbers invites combining them — so the basis is still stated, **once, contrasting both bases in one
  sentence** instead of four cards each explaining themselves. ⚠️ Empty cards keep their own text:
  that one names a missing input and where to capture it, which is actionable rather than explanatory.
  The S-curve hint drops from three sentences to one, keeping only what the chart cannot show itself.
- **Progress Photos: the Explorer resemblance was the tile size, measured.** The default scale of 1/3
  resolved to a **125px card holding a 70px image**; it is now **263px / 158px**, and each tile carries
  a two-line caption where it previously carried no text at all.

**Verified** by slicing the shipped overlay and the shipped `galleryHTML` out of their files and
executing them against fixtures in a real browser, then measuring: 2/3/7-project overlays produce
6/9/7 polylines in 2/3/7 colours with no point outside the plot box; every photo caption line is
unclipped and unwrapped at the shipped scale. Portfolio table cell arithmetic **asserted** at 8 across
header, body, group subtotal, TOTAL and empty state. `node --check` clean; inline `<script>` parses
(⚠️ progress-photos' own extraction reports the documented pre-existing false positive — a CDN `src`
containing `build/three.min.js` — **confirmed identical on HEAD** rather than assumed); CSS braces
593/593; 47 assets on one version each, 0 splits, 0 missing.

- `ui.js` → `?v=20260909p3` (21 pages); progress-photos `module.js`/`module.css` → `?v=20260909p3`;
  `MODULE_V` → `20260909p3`. `scurve.js` is unchanged and keeps `20260901a` — it simply gains a third
  referencing page.
- ⚠️ `modules/project-schedule/index.html` and `modules/contracts-claims/index.html` are again staged
  as **HEAD + this change only**; the concurrent session's extraction of `splitPlan` into the untracked
  `assets/js/co-insert.js` is still in the working tree and is not mine to commit.
- ⚠️ **Not verified signed in.**

### 2026-09-09 (u2) — Minutes of Meeting: the PDF stops being a screenshot, and `hidden` starts working app-wide

Owner's six Minutes-of-Meeting items. Stage 2 of a five-stage pass. Full detail:
[`modules/minutes-of-meeting/CLAUDE.md`](modules/minutes-of-meeting/CLAUDE.md). The parts that reach
beyond the module:

- ⚠️⚠️ **`hidden` DID NOT WORK ON ANY `.pd-btn` IN THIS APP, ANYWHERE.**
  `.pd-btn { display: inline-flex }` is specificity **(0,1,0)** — exactly equal to the user agent's own
  `[hidden] { display: none }` — and an author rule beats the UA default at equal specificity. So every
  `btn.hidden = true` in every module set an attribute that changed nothing. **MEASURED before the fix:
  four `.pd-btn`s carrying the attribute all computed `display:flex`.** In Minutes of Meeting that put
  the filter funnel on screens that draw no filter panel, so clicking it silently toggled state you only
  saw later — which is how it was reported ("the search and filter view doesn't work when clicked").
  ⚠️ This is the **same defect** `minutes-of-meeting/module.css` has documented at length since August
  for `.il-icondd-menu`, fixed there with `:not([hidden])` and never generalised. Now one line in
  `dashboard.css`, fixing the class app-wide.
  ⚠️ **The shared fix alone was not sufficient, and only measuring showed it:** a module rule at
  (0,3,0) outranked it, so `+ Add meeting` hid correctly while the funnel and refresh did not.
- ⚠️ **A shared `.pd-spin`.** There was **no spinner in `assets/` at all** — zero keyframes — and three
  modules (`.cc-spin`, `.dr-spin`, `.ms-spin`) had each rolled a byte-identical private copy. Promoted
  rather than letting a fourth be added. Carries a `prefers-reduced-motion` slow-down.
- ⚠️⚠️ **`.pd-input` and `.pd-select` now pin `min-height: 32px`, and my hypothesis about why was
  wrong.** I expected native `<select>` chrome to be the "different UI" the owner reported. Measured:
  background, border, radius and colour all **match**. What differs is the box — text input **29px**,
  `<select>` **31px**, date input **31px**, three heights in one form row, because neither class pins a
  height and each control type adds its own intrinsic box.
  ⚠️ **`min-height`, deliberately NOT `height`** — this app has many `<textarea class="pd-input">`,
  which a fixed height would have collapsed to one line, and project-schedule has
  `<select multiple size="4">`. Both re-measured after the change: textarea **59px**, multiple-select
  **78px**, `.pd-input-sm` still **34px**, and the three form controls now agree at **32px**.
- **The module drops `html2pdf` for native jsPDF + autoTable.** The owner's own exported file proved the
  export was a **photograph**: `Producer (jsPDF 2.3.1)`, two `/DCTDecode` images at 1438×2096, **0 text
  operators**, 341.5 KB — so the reported text overflow was baked into a bitmap where no stylesheet
  could reach it. Now **21.1 KB with 103 selectable text operators and 0 JPEGs**, wrapping guaranteed by
  `splitTextToSize`. ⚠️ `jsPDF` is **not** obtainable from the html2pdf bundle (measured:
  `window.jspdf` undefined, `html2pdf.jsPDF` absent), which is why two new tags rather than reuse.
  ⚠️ `issues-lessons` and `progress-photos` still load html2pdf and are untouched.

**Verified** on real produced PDF files — the shipped drawing code sliced out of `module.js` and
executed against fixtures, the bytes captured and the PDF structure parsed — not by reading the code
that emits it. CSS measured before and after in a browser. `node --check` clean; inline `<script>`
parses; braces 492/492 and 355/355; 0 NUL bytes; **47 assets on one version each, 0 version splits,
0 referenced-but-missing**. ⚠️ **Not verified signed in.**

- Shared `dashboard.css` → `?v=20260909u2` (29 pages); module `module.css` / `module.js` →
  `?v=20260909u2`; `MODULE_V` → `20260909u2` (the module's `index.html` swapped its PDF libraries).
- ⚠️ `modules/project-schedule/index.html` and `modules/contracts-claims/index.html` are again staged as
  **HEAD + this change only** — they still carry the concurrent session's in-progress extraction of
  `splitPlan` into the untracked `assets/js/co-insert.js`, and committing the working-tree copies would
  ship a `<script src>` pointing at a file that is not in the repo.

### 2026-09-09 (ui) — The sidebar brand, a collapsed rail that shows the mark, and two sibling links you can tell apart

Owner's three Global items: *"The logo and the 'Planning Suite' title in the side panel looks off. Let's
optimize the UI to make it more professional looking."* / *"when the side panel is collapsed, I want to
see the red megawide logo 'M' at the very top of the side panel."* / *"when collapsed the redirect link
is unidentifiable. Let's plan how to show the procurement and engineering apps logo."*
Stage 1 of a five-stage pass; the other four areas follow as their own commits.

- **The brand block.** Wordmark `max-width` 150 → **176px** (it is a 5.81:1 lockup, so width is the only
  lever on its presence, and 150px in a 240px rail read as an afterthought floating in 28/24px of
  padding); padding `28px 20px 24px` → `22px 18px 18px`; caption tracking `.14em` → `.18em` with a
  matching `padding-left: .18em` — letter-spacing appends a gap AFTER the last letter, which drags
  centred text visually left, so the pad puts it back on the optical centre.
- ⚠️ **"Planning Suite" was on screen TWICE** — the brand `<small>` and the footer's *"EPC · PMO ·
  Planning Suite"*, in all 21 sidebar pages. The **footer** drops it: the product name belongs at the
  top where it identifies the app, and the footer is left naming the org unit that owns it.
- ⚠️⚠️ **NO NEW ASSET WAS CUT FOR THE COLLAPSED MARK.** `assets/img/favicon.png` **is** the red Megawide
  "M" (established by rendering it, not by its name), and `favicon-icon.png` is that same mark already
  padded to 256×256 and already cache-busted. The collapsed block previously hid the logo **and** the
  caption and put nothing back, so the 64px rail opened with an empty padded box above bare icons.
- ⚠️⚠️ **A PER-APP LOGO WAS NOT AN OPTION, AND ESTABLISHING THAT CHANGED THE ANSWER.** The owner asked
  for "the procurement and engineering apps logo". `engineering-app`, `wpm` (Procurement) and this app
  all ship the **same** 1020×850 Megawide mark — so a logo would have been three identical marks, no
  more distinguishable than the two identical `externalLink` glyphs it was meant to replace. They get
  purpose-drawn glyphs instead: a **purchase cart** and a **drafting compass**. ⚠️ Namespaced `app*`
  deliberately — `compass` (Stakeholder Map) and `ruler` are already taken, and a sibling link sitting a
  few rows under the Stakeholder Map row must not wear a near-copy of its icon. `externalLink` is
  **not orphaned** (`modules-grid.js:58` still draws it on retired-module cards).

⚠️⚠️ **BOTH "FAILURES" DURING VERIFICATION WERE THE HIDDEN-TAB ARTEFACT, NOT THE CODE — and neither
would have been visible by reading.** (1) The first pass measured **every width as 0** and reported
`brandPad` as the **mobile** value; `visibilityState` was `hidden` and `innerWidth` was **0**, which
matches `max-width: 820px`, so the phone rules were legitimately winning against a zero-width viewport.
(2) After a screenshot forced a paint, the collapsed rail still measured **240px** where the rule says
64 — and it stayed 240 after a 450ms wait. That is not the rule losing: **a hidden tab never advances a
CSS transition**, so `width` sits at its start value indefinitely. A cascade probe confirmed
`.pd-app.pd-collapsed .pd-sidebar` **matches** with no later rule overriding it; re-measuring with
transitions disabled gives **64px**. Measuring during a transition measures the animation, not the rule.

**Measured, transitions disabled, at 1440px and 400px in both themes:** expanded rail **240** / logo
**176 × 30.3** / mark `display:none` / padding `22px 18px 18px`; collapsed rail **64** / mark **30 × 30
and centred** (|cx − railW/2| < 1.5px) / logo, caption, footer and both sibling labels all hidden / both
sibling icons 16px with **genuinely different shapes** (`circle,path,path,path,path` vs
`circle,circle,path`); the 400px drawer re-expands `.pd-collapsed` to 290px and **suppresses the mark**,
so the wordmark and the mark can never stack; **no horizontal page scroll at either width**. Zero pages
are left with two identical sibling icons. `dashboard.css` braces **483/483**, both changed JS files
parse, `Icons.names` **79 → 81**, 0 NUL bytes.

- Assets `dashboard.css` / `icons.js` / `modules-grid.js` → `?v=20260909ui` across **29 / 21 / 2**
  references; audited to **0 version splits over 47 distinct assets** and **0 referenced-but-missing
  files**. `MODULE_V` → `20260909ui`, fallback literal included — every module `index.html` changed, and
  a module page is cached under `index.html?v=MODULE_V`, so without it a returning browser keeps serving
  a page that still requests the old stylesheet. ⚠️ **Deliberately not the next letter in the daily
  sequence**: the concurrent session in this tree is already on `20260909r`.
- ⚠️⚠️ **TWO PAGES WERE STAGED AS "HEAD + MY EDITS", NOT FROM THE WORKING TREE.**
  `modules/project-schedule/index.html` and `modules/contracts-claims/index.html` carry a concurrent
  session's in-progress extraction of `splitPlan` into the **still-untracked** `assets/js/co-insert.js`.
  Committing the working-tree copies would have shipped a `<script src>` pointing at a file that is not
  in the repo, and deleted `splitPlan` with it. Verified after staging: those two blobs contain **0**
  `co-insert` references, project-schedule's staged copy still contains `splitPlan`, and the staged diff
  for both is exactly the six lines of this change. Their working trees are untouched, as is
  `contracts-claims/wizard.js`.
- ⚠️ **A false positive worth recording rather than reporting as a finding:** the first `?v=` audit
  claimed 19 "unversioned references", every one of which was the asset NAME occurring in prose inside a
  comment (*"comes from dashboard.css"*). The checker now resolves only `src=`/`href=` attribute values.
  An earlier line-ending check was wrong the same way — `grep -c $'\r'` degenerated to an empty pattern
  and reported every one of the 21 files as CRLF; they are all **pure LF**, re-derived by counting bytes.
- ⚠️ **Not verified signed in.** `requireLogin` redirects without a session, so this was measured against
  a harness **generated from the shipped `dashboard.html`** with the Supabase-dependent scripts stripped —
  never hand-copied, because a hand-copied shell puts different rules in the cascade than the ones that
  actually ship (the trap recorded on 2026-09-09 cp). The harness was deleted before committing.

### 2026-09-09 (q) — The Affected-work preview answers the question a change order actually raises

Owner: *"I want the preview to show the overall change in the Gantt not just the bar graph how much
it lengthens in the Gantt. The current preview doesn't provide any useful information."* Right, and
the screenshot shows exactly why: **240 selected activities drew 240 bars 1-3px wide** across a
project-wide window. It answered *"which bars did I tick"* — which the tree beside it already
answers — and never answered the only question a variation raises: **what does this do to the
programme?**

#### ⚠⚠ N days on 240 activities is not 240 × N, and usually not even N
The activities run in **parallel**. What moves is the LATEST finish among them, and that only moves
the programme if it was already the programme's own finish. New pure `impactOf(sel, all, dur)`
computes precisely that — and it can, because `ACTS` already holds **every** activity on the
project, not just the selection, so the programme window is knowable without another read.

The panel now leads with the finding:
- **Programme finish moves N days later**, with the before → after dates — or **unchanged**, when the
  added time ends inside the current programme.
- **One bar for the whole programme**: what exists now, where the selection sits inside it, and the
  extension past the current finish. That is the "overall change in the Gantt".
- The sentence that makes it worth having: *"their work spans 1 Mar 2026 → 30 Jun 2027, growing
  **45 days** to 14 Aug 2027 — not 110 × 45, because they run in parallel."*

⚠⚠ **`slip` IS A LOWER BOUND, NOT A FORECAST, and the panel says so on screen.** This is date
arithmetic over the selected activities. It does **not** run CPM, does not move successors, and
cannot know whether a non-critical activity has float to absorb the insertion — so a slip of 0 means
*"the added time ends inside the current programme window"*, **never** *"the project is
unaffected"*. That distinction is the whole reason this file still refuses to copy `splitPlan`.

⚠ **The per-activity strip is kept, demoted to evidence** — a `<details>` that opens itself at ≤12
rows and stays shut above that. It was never wrong, only mis-ranked: at 240 rows it is noise, at 6 it
is exactly what you want. Deleting it would have thrown away a real view to fix a layout decision.

**18 assertions** on `impactOf`, sliced out of the shipped file: 240 parallel activities × 10 days
grows the span by **10, not 2,400**; the programme finish does **not** move when the selection is not
the last-finishing work; it moves by **10** when it is; a selection ending 4 days short of the
programme with a 10-day order yields **6** days of slip (partial float absorbed); undated and 1-day
activities are counted rather than silently dropped; an empty selection does not throw.
**Driven in a real browser** through the actual `CCWizard.open()` at 1440px, both themes: the slip
and unchanged branches both render correctly, `--pd-danger-text` resolves to `#FF8A80` in dark with
`color-mix` computed and **no hardcoded literal**.
`affected.js` / `module.css` → `?v=20260909q`; `MODULE_V` → `20260909q`.
⚠ **Not verified signed in** — fixture data through a stubbed data layer; no real programme read.
### 2026-09-09 (p) — Cash Flow's number inputs swept, and a regression in yesterday's fix caught

Owner: *"let's sweep the cash flow number inputs"* — the follow-up the audit named. **Not swept
blind:** the audit's own rule is that the READER has to be checked first, and checking it here found
both a worse variant of the bug and a defect I had introduced hours earlier.

#### It was worse here than in Contracts & Claims
Cash Flow's reader was `function num(v) { return Number(v) || 0; }`. So a comma-typed amount did not
become null — it became **`0`**. ⚠⚠ A null is at least visibly absent on the next load; a **0 is a
real number that flows into the arithmetic unnoticed**, and `s-ibb` (Contract Amount IBB) feeds
`var base = numInput('s-ibb') || 0` in **six** places, so the entire projection would have been drawn
off a zero contract with nothing on screen looking wrong.

#### ⚠⚠ A REGRESSION IN THE (n) FIX, FOUND BY EXECUTING IT
The tolerant reader I shipped yesterday stripped commas after checking only for *a comma following a
dot*. That caught `1.000,50` but **not `12,5`, which it turned into `125`** — where the original
`Number("12,5")` gave NaN → null. I replaced a silent blank with a **silent wrong number**, which is
the worse of the two. Both readers now **validate the comma shape instead of stripping it**: an
English thousands separator is always followed by exactly three digits, so the whole string is
matched against `^-?\d{1,3}(,\d{3})+(\.\d+)?$` and anything else is refused.

#### And an ordering bug the suite caught before it shipped
The first cut validated commas **before** stripping the currency symbol, so `₱1,200.50` failed the
pattern and returned 0 — the exact bug being fixed, reintroduced one step earlier in the same
function. Reordered. ⚠ It was a *test* that found this, not a reading: the code looked right.

#### What was flipped, and what deliberately was NOT
**8 of 27** inputs are money-capable and are now `type="text"` + `inputmode="decimal"`: `s-ibb`,
`s-bcb`, `s-limit`, the actuals `₱ amount`, and the four **basis-dependent** tranche inputs that hold
either a peso figure or a percent depending on `t.basis` — those cannot stay numeric, since half
their uses are money.
⚠ **The other 19 stay `type="number"` on purpose.** They are percentages and month counts: a
thousands separator is not expressible in them, and the spinner plus the mobile numeric keypad are
worth keeping where they are safe. Sweeping them too would have been change without benefit.
⚠ **No change handler needed touching** — every one already reads `v === '' ? null : num(v)`, so
making `num()` parse was enough, and empty stays distinguishable from zero.

**35 assertions, 0 failures**, executed against both readers sliced out of the shipped files:
`₱1,200.50`, `(1,500.25)`, `1,397,462,269.86`, `12.5%`, `$1,000` all parse; `12,5`, `1.000,50`,
`1,00` and `1,0000` are all **refused** rather than guessed; numbers pass through untouched and junk
still yields `0`, so every `num(x) || 0` caller keeps its exact previous contract.
contracts `module.js` → `?v=20260909p`; `MODULE_V` → `20260909p`. ⚠ **Not verified signed in.**
### 2026-09-09 (n) — Whole-app audit: a money field that blanked itself, four caches that cached failure

Owner: *"Debug the planning app whole and check for improvements."* Audited against **this repo's own
recorded failure modes** rather than a generic checklist, because those are the bugs it actually
ships. Two mechanical passes over 113k lines, then every candidate read by hand.

⚠️⚠️ **MOST OF WHAT THE SCAN FLAGGED WAS THE SCAN'S OWN FAULT, AND SAYING SO IS THE POINT.** The two
loudest findings — *"35 tables never granted"* and *"4 tables with RLS and no policy"* — were both
artifacts of my regexes. The policies exist, created dynamically via
`execute format('create policy %I on %I', ...)`, which a literal pattern cannot see; the grants are a
multi-table statement plus a blanket `grant ... on all tables in schema public` at
`supabase-schema.sql:721`. **209 raw findings reduced to 6 real ones.** An audit that reports its
false positives as findings is worse than no audit.

#### ⚠️⚠️ The one that loses data: nine `type="number"` fields in Contracts & Claims
**MEASURED in a real browser, not asserted** — `input[type=number].value` returns `""` for anything
the spec cannot parse, which is every way a planner writes money:

| typed | `type="number"` | `type="text"` |
|---|---|---|
| `1,000` | **`""`** | `1,000` |
| `1,397,462,269.86` | **`""`** | preserved |
| `₱1,200.50` | **`""`** | preserved |
| `(500)` | **`""`** | preserved |

`n()` turned that `""` into **`null`**, so typing the contract amount with thousands separators
**silently blanked it** — no error, and nothing afterwards to say a figure had ever been entered.
⚠️ `1,397,462,269.86` is not a hypothetical: it is a contract amount from this register's own
history. The four EOT day fields carry it too — this project's day counts are four digits
(1,048 / 1,095), so `1,048` blanked just as readily.

⚠️ **The BOQ found this trap in August and fixed it for its grid cells only** (`boq.js:1629`, *"NUMERIC
CELLS ARE type=text ... AND THIS IS THE OPPOSITE OF THE OBVIOUS CHOICE"*). The record form beside it
never got the fix, and no other module knows the trap exists. All nine fields are now
`type="text"` + `inputmode`, and `n()` parses the way `numOf` does.
⚠️ **It goes one step FURTHER than `numOf`, deliberately:** stripping commas blindly turns the
European `1.000,50` into `1.0005` — not a rejection, a **wrong number that looks real**. A comma after
a dot is never English formatting, so it is refused rather than guessed. **12 assertions, executed
against the function sliced out of the shipped file**; the ambiguous case is one of them, and it
failed until the guard was added.

#### ⚠️ Four caches that cache failure, all the same shape
`[]` is truthy, so `if (X) return X;` caches an empty answer **and an error** for the whole session:

| where | consequence |
|---|---|
| `boq.js ensureActs` | any RLS refusal or 8s timeout → the allocator reports "no activities" forever |
| `boq.js ensureSugg` | starts legitimately empty on a fresh deployment → never queries twice |
| **`assets/js/db.js getPeople`** | **shared** — one transient RPC failure at load and *every* assignment picker in *every* module silently offers free text for the session |
| `equipment-loading loadTowerVals` | caches `[]` when no level is chosen → picking one afterwards does nothing |

⚠️ This is the **exact** defect `ensureCodes` documents at `boq.js:703` — fixed there in
September, left standing in its sibling sixty lines below, and in three other files. All four now
guard on `.length`.

#### A block written twice
`boq.js`'s heading child-count loop appeared **twice, back to back**, with only blank lines between —
same `var kids`, same nested loop over the full line list, the second overwriting the first with
identical values. A merge artifact. Removed; up to ~900 rows are no longer walked twice for nothing.
⚠️ Found by the hoisting scanner, **for the wrong reason** — it saw the first copy's variables used
"before" the second copy's `var`. Right answer, wrong mechanism, and worth recording as such.

#### Reported, deliberately NOT changed
- **Duplicate DOM ids — re-checked properly, and the class is CLEAN.** The first pass used the
  unreliable checker described below, so the finding was re-derived with a character scanner that
  blanks comments only and respects string literals, splitting **static markup** from **JS-emitted**
  ids. Result: **zero duplicates in static markup on all 29 pages**, and **zero ids that appear both
  statically and in JS output** — those are the two shapes that would put two same-id elements in
  the document at once. Every remaining duplicate is JS-emitted and mutually exclusive **by
  construction**, in one of three shapes, each verified by reading the code:
    - a **ternary**, so exactly one branch can render — productivity-rates `f-wp`
      (`WPS.length ? <select> : <input>`), project-schedule `b-aconfirm`;
    - **branch-replaced `innerHTML`** — resource-loading's `openForm` writes `f-name` / `f-rate` /
      `f-uom` / `f-rem` in three `if/else if/else` arms that each REPLACE the form body;
    - **two separate modals** that never open together — equipment-loading `eq-x`
      (`openForm` vs `openMonths`), project-schedule's `lw-*` (the LBS matcher vs the trade matcher).
  ⚠ My earlier one-line claim that *"every pair sits in a mutually exclusive modal"* was right in
  conclusion and wrong in detail — only the third shape is a modal. Sharing ids across two modals is
  still the fragile one: nothing but convention stops both being open at once.
- **140 other `type="number"` inputs**, mostly Cash Flow money fields carrying the same latent risk.
  Not swept blind: each module needs its own reader checked first, which is a pass per module.
- `assets/js/mcc-rcm.js` has **606 CRLF among 617 LF** — anchors there must be byte-exact.

⚠️ **The audit's own duplicate-id check is unreliable** and was caught being so: adding a comment to
one file made a real duplicate *disappear* from the report, because regex comment-stripping mis-pairs
against `/*` and `*/` inside string literals. Raw `grep` is authoritative; the checker is a shortlist.

`db.js` / `boq.js` / contracts `module.js` → `?v=20260909n` (db.js is shared — 23 pages);
`MODULE_V` → `20260909n`. 40 JS files parse, CSS braces balanced, 0 NUL bytes, every asset on one
version, nothing referenced-but-missing. ⚠️ **Not verified signed in** — no form was submitted.

### 2026-09-09 (m2) — The stakeholder-directory migration could not run, twice over

Owner ran `migrations/2026-09-08-stakeholder-directory.sql` and got
**`ERROR 42883: function max(uuid) does not exist`**. Two blocking defects, both in the file this
session inherited unreviewed from the other clone — which is why it was flagged as the one piece
neither of us had read.

- ⚠⚠ **`max(sm.created_by)` on a uuid.** Postgres has no `max(uuid)`, so the backfill aborted
  and the SQL editor's single transaction took the whole file with it. **The aggregate was wrong
  in principle too**: uuids have no meaningful order, so "the greatest creator" states nothing.
  Replaced with the creator of the EARLIEST row, non-null preferred — the same
  `(array_agg(... order by ...))[1]` idiom the file already uses for `photo_path` /
  `photo_thumb_path`, and for the reason its own comment gives there: the value must come from a
  specific row, not from an independent aggregate that can pair fields across different rows.
- ⚠⚠ **The file contained NO `grant` at all**, which the first error was hiding. RLS policies
  FILTER rows for a role that already holds the table privilege; they never grant it. Every app
  query would have failed with *"permission denied for table stakeholders"* — which reads like an
  RLS problem and is not one. Every sibling migration in the folder carries the line.

**Verified statically** (the migration has not been re-run here): code-only parens 110/110, `$$`
paired, and the INSERT's **14 columns against 14 SELECT expressions** — a count that read 20 until
the checker was corrected to strip comments, since the new comment prose contains commas.
⚠❌ **Not run against the database.** The owner re-runs it; the file is idempotent
(`if not exists` throughout, `on conflict do nothing`), so a partial first attempt is safe.

### 2026-09-09 (m) — The other session's 33-commit-old working tree, merged rather than discarded

The clone had `.git/rebase-merge/` present but **completely empty** — no `head-name`, `onto`,
`orig-head`, todo or done — so `git status` claimed *"you are currently rebasing … all conflicts
fixed"* with no rebase to continue. ⚠️ I had earlier reported this as a paused rebase belonging to a
concurrent session; that was wrong and is corrected here. The directory was stale state from Sep 7,
and `git rebase --quit` could not remove it (a lock, most likely OneDrive syncing `.git`), so the
empty directory was removed directly.

Underneath it sat 48 modified files and 2 genuinely new ones on a HEAD **33 commits behind**. Two
independent checks agreed the work was real and unpushed: `stakeholder-map/module.js` carried
**41 mentions of "directory" against 0 upstream** (2,176 lines vs 1,420), plus
`migrations/2026-09-08-stakeholder-directory.sql` and `test-directory.js`, neither on `origin/main`.

⚠️⚠️ **A PULL WOULD HAVE COST THAT, AND GITHUB DESKTOP WAS OFFERING TO DO IT.** The tree diverged in
BOTH directions — ahead on stakeholder-map, and 2,044 lines behind on `project-schedule/index.html`
— so `pull` refuses and the tool's remedy is stash-or-discard. Captured first as
`refs/backup/worktree-20260909` and the branch `wip/other-session-20260909`, both built through a
throwaway index so **HEAD, the index and every file on disk were untouched**.

**43 conflict hunks across 27 files. Resolved by rule, not by picking a side:**

- ⚠️ **`modules/project-schedule/*` → OURS, and this is the one that mattered.** The wip side's diff
  there is a **reversion**: it deletes the *"Cost Loading step 2 reads the BOQ"* 2026-09-08 entry,
  which exists in both the merge base and `origin/main`. Measured — base 39,319 lines,
  `origin/main` 41,241, wip 39,197. wip never had the Structure step; the "theirs 0" hunks were its
  own local deletions overlapping upstream's additions, not a considered removal.
- ⚠️ **`issues-lessons/module.css` → THEIRS on the `.il-report` rules, and it is verified, not
  preferred.** OURS targets `.il-iss-actions` and `.il-mi-card`, which `module.js` emits **zero**
  times — silent no-ops. THEIRS targets `.il-mom-actions` / `.il-iss-card` / `.il-workflow-*`, which
  it emits 3 / 2 / 3 / 1 times.
- ⚠️⚠️ **`stakeholder-map` CSS *and* JS → THEIRS together, as a consistency requirement.** wip drops
  the module-local `.sm-kpi*` set for the shared `.pd-kpis` / `UI.kpi` component. `risk-register`'s
  `module.js` had **already auto-merged onto `UI.kpi`**, so keeping OURS for stakeholder-map's CSS
  while its JS emits `UI.kpi` would have rendered the KPI strip unstyled. Confirmed after resolving:
  the container is `<div class="pd-kpis" id="sm-kpis">` and `dashboard.css` defines it.
- **The comment-only hunks → OURS.** `--pd-fs-base` **is** `13px`, so HEAD's literal and wip's token
  are the same value; the rest differed only in `⚠` vs `⚠️` and `--` vs an em dash.
- ⚠️ **21 files were pure cache-bust collisions** and were resolved mechanically by a test that
  normalises the version string and compares the two sides — never `--ours` / `--theirs`, which take
  a whole file and drop your own non-conflicting edits in it.

⚠️ **Every asset whose CONTENT the merge changed got a version newer than BOTH sides** (`20260909m`,
18 assets, 29 pages) — the merged bytes existed on neither side, so neither side's string is honest.
Audited by resolving each reference to its real path (a basename grouping reports a false split,
since every module has its own `module.css`): **40 distinct assets, one version each, none missing.**

**Verified:** 40 JS files parse, 0 failures; CSS braces balanced on all 8 changed stylesheets; 0 NUL
bytes; both sides' work present — Structure step, the 2026-09-08 changelog entry, the delete-BOQ
handler, `TRADEMAP`, `affected.js`'s ladder/tree/preview, and the stakeholder directory with its
migration and test. Root `CLAUDE.md` is byte-identical to `origin/main` — no doubled changelog. ⚠️ The
two duplicate `2026-09-03 (b)/(c)` headings it reports are **pre-existing upstream**, and the (b) pair
is the documented legitimate one.

⚠️ **Not verified signed in, and not rendered.** This is a textual integration: nothing was clicked
through, and the stakeholder directory has never been exercised against a live project.

### 2026-09-09 (cq) — The Affected-work intro drops from four lines to one

Owner: *"Let's reduce the text in the step intro."* The third time the wizard's prose has been
called too long, so this cuts on a rule rather than by taste.

**Two of the four sentences were teaching the control, and the control now teaches itself.**
*"Tick a place to take all of it, or search to add individual activities"* described a screen that
did not yet exist when it was written. It does now: the ladder carries a count on every rung, the
tree carries carets and checkboxes, and the search box's own placeholder names every field it
matches. A caption narrating a legible control is just more to read before you can use it.

⚠️ **What survives is the one fact the screen cannot show: no date moves.** A planner who believes
saving reschedules the programme will not touch this step at all, and nothing on the page can
disprove that on its own — so it stays, as three words in bold rather than a clause about previewed
steps and pending variations.

⚠️ **The EOT half — "the granted days stay a single figure on the record" — went with the rest**,
because this step has no days field to mislead anyone with. The reasoning is unchanged and still
recorded where a developer looks: the ⚠️ block above the function, and at length in
`migrations/2026-09-09-cc-affected-activities.sql`. Deleting on-screen prose is not deleting the
decision behind it.

| type | before | after |
|---|---|---|
| Change Order | 65 words | **23** |
| EOT | 41 words | **14** |
| Claim | 27 words | **11** |

**Measured in the browser, in the real wizard shell** (not counted by eye): at 1440 all three render
as **one line**; at 918 the Change Order hint takes two and the other two stay at one. It was four
lines at both widths. No page horizontal scroll at either.

- `wizard.js?v=20260909cq`; `MODULE_V` → `20260909cq`. No other file changed.
- ⚠️ **Not verified signed in** — the wizard was driven against a stubbed data layer.

### 2026-09-09 (cp) — The Affected-work picker: a ladder, a WBS tree, and a Gantt beside them

Owner, on the step shipped that morning: *"UI is clashing let's fix … I want to have the level
breakdown select to be like a ladder rather than selecting since it can span different towers and
levels and zones … most of the activities have the same activity name even though they have
different activity IDs … I believe in a form of a WBS type would be appropriate. I want to be able
to have a side-by-side preview as well … how it would look like in the Gantt."* Detail in
[`modules/contracts-claims/CLAUDE.md`](modules/contracts-claims/CLAUDE.md).

- ⚠️⚠️ **The clash was two wizard rules, and my harness is why it measured clean.**
  `.ccw-main select { width:100% }` was unconditional — the `input` half of that same rule excludes
  checkboxes and radios, with a long comment about the ladder it once destroyed, and `select` got no
  such exclusion — while `.ccw-main label { display:block }` (0-1-1) beat the picker's own
  `.cca-lbl` (0-1-0). **My harness hand-copied the `.ccw-main` shell, so neither rule was ever in the
  cascade.** It now drives the **real `CCWizard.open()`** and asserts computed styles.
- ⚠️ **More specificity cannot win that fight and the fix does not try.** Three `:not()` arguments
  put the rule at **0-4-1**; the previous fix was an `!important` on one control. A sub-component's
  controls now opt out with `.cca-ctl` — the same shape the rule already uses for checkboxes — and
  a probe input without it still stretches, so ordinary wizard fields are untouched.
- ⚠️⚠️ **The ladder's rungs are re-derived strictly top-down, and that is what makes a bare value key
  safe.** Location values are plain text, not a node tree — *"Zone 'Z1' under two different locations
  is the same string"* — so a value-keyed rung would merge two towers' Z1 and a change order would
  silently take both. Asserted, with a contrast build that reads the level un-narrowed and does
  merge them. **N rungs, not four**, because levels are per project; 5 clamp and scroll.
- ⚠️⚠️ **Ancestry comes from the dotted `wbs` string, never `wbs_node_id`** — measured NULL on
  16,393 of 16,393 activities after an import — and **`ensureActs` had to stop discarding the
  `WBS Summary` rows**, which are the only code→name map. They stay out of the selectable set.
- ⚠️⚠️ **The preview is NOT a second copy of `splitPlan`, and it is pinned by assertion rather than
  by good intentions:** the suite slices the real `splitPlan` out of `project-schedule/index.html`,
  executes it, and asserts the preview's new finish and both gap edges match across 35 span ×
  duration combinations. If that arithmetic ever changes, this fails.
- ⚠️ **A real bug found only by measuring:** the CO-duration box rendered **149px** where
  `flex:0 0 42px` says 42 — a flex item's `min-width:auto` resolves to a form control's intrinsic
  width and silently outranks the flex basis. Reading the rule would never have shown it.
- **41 assertions, 0 failures, 3 contrast builds all biting**; driven in a real browser at 1440 and
  918 in both themes with **zero overlapping elements in the control bar**, measured as pairwise
  rect intersection. ⚠️ **Not verified signed in** — fixture data through a stubbed data layer.
- `affected.js` / contracts `module.css` → `?v=20260909cp`; `MODULE_V` → `20260909cp`.

### 2026-09-09 (co) — A change order says which activities it touches, and inserts into all of them at once

**Run `migrations/2026-09-09-cc-affected-activities.sql`.** Owner: *"adding change orders and
extension of time the planner should be able to easily select which activities are affected with the
CO/EOT … in a bulk manner in case that the CO/EOT affects a lot … by selecting affected activities
based on the location and optional to add other activities in the schedule as well."* Detail in
[`modules/contracts-claims/CLAUDE.md`](modules/contracts-claims/CLAUDE.md) and
[`modules/project-schedule/CLAUDE.md`](modules/project-schedule/CLAUDE.md).

- ⚠️⚠️ **THE WIZARD WROTE ONE ROW AND NOTHING ELSE.** No step, field or payload key in `wizard.js`
  mentioned `project_schedule` or an activity id, so the commercial record and the programme it
  argues about could not see each other from the register's side at all. There is now an **Affected
  work** step for Change Order / Claim / EOT: pick a **place** (tower, level, zone) to take all of
  it, or search to add individual activities.
- ⚠️⚠️ **AN EOT'S ACTIVITY SET CARRIES NO DAYS, and this is the decision the whole shape turns on.**
  The owner asked directly whether EOT should get a per-activity model. It should not:
  `approved_days` stays the single contract-level figure the schedule already sums (*"Contract finish
  + granted days = Revised finish"*), and the activities are the delay **basis** — a set, not
  numbers. Delay on parallel paths is **concurrent**: two activities each slipping 10 days on two
  parallel paths is **10** days of project delay, not 20, because only the critical path carries. A
  per-activity day column would invite the obvious roll-up and produce a figure nobody could defend
  in a claim. Same trap the BOQ allocations recorded from the other side — *"the sum belongs on the
  allocation, not on the tag."*
- ⚠️ **Saving a change order reschedules NOTHING.** A Pending variation must not move forty finish
  dates as a side effect of being recorded. Inserting the work is a separate, previewed action.
- ⚠️⚠️ **A NEW TABLE RATHER THAN `change_order_ref`, for three reasons that are each fatal on their
  own.** That column exists and already joins to `contracts_claims.reference_no` — but it is ONE
  text column, so a second variation overwrites the first (real projects re-touch the same activity:
  CO-014 in March, EOT-003 citing it in June); paired with `scope_type` it already means *"this row
  IS change-order work"*, which is a different fact from *"this row is AFFECTED BY it"*; and EOT has
  nowhere to go at all. `cc_affected_activities` is keyed on **`activity_id`, never the row uuid** —
  an import deletes and reinserts every row, so a uuid link is destroyed by the next import while
  the planner's Activity ID survives.
- ⚠️⚠️ **NO SECURITY-DEFINER RPC WAS NEEDED, and establishing that is worth as much as the feature.**
  `boq_tag_activities` had to be one because it UPDATEs `project_schedule`, which is gated on
  `created_by = auth.uid() or is_admin()` — and PostgREST answers an RLS-filtered UPDATE with 200 and
  zero rows. Verified from the policy source: `project_schedule` **INSERT** carries no ownership
  clause (`is_writer() and created_by = auth.uid() and can_access_project(...)`). Because the links
  live in their own table, nothing here updates an activity anybody else imported, so that
  silent-success trap cannot arise.
- ⚠️⚠️ **`fillDown('change_order_ref', …)` HAS EXISTED SINCE IT WAS WRITTEN AND HAD NEVER RUN.** It
  filters the selection to `isExecPhase`, reports the skipped count and explains the refusal; its own
  neighbouring comment says *"marking a run of activities as one change order is exactly the bulk
  edit these columns exist for"*. But `fillDown` is reachable only from a grid cell's `data-field`,
  the Scope cell emits `data-field="scope_type"` and renders the ref as a read-only span, and a
  repo-wide search for `data-field="change_order_ref"` returned **nothing**. The feature was built
  and had no door. A **Change Order Ref column** is the door — right-click → *Fill Change Order Ref
  down (N)* and Ctrl+D now work on a multi-row selection. Smallest change in the whole pass, largest
  payoff.
- **Select activities by location** (Actions menu) resolves a place to activities and loads them into
  the grid's existing `_selSet`, so every bulk action applies with **no new apply path**. Global
  Change could not have done it: `GC_FIELDS` addresses plain row fields and `location` is a jsonb map.
- **The bulk insert reuses `splitPlan` / `splitBuild` unmodified** — proven by the diff, which
  contains six `+` mentions of them and **zero** deletions. They are pure functions returning data,
  which is what makes a whole-run preview possible; and it lives in the schedule because that is
  where the arithmetic is and which app owns schedule writes. One preview table replaces
  `applySplit`'s per-host `confirm()` — twenty-three confirmations is not an interface — and all
  three refusal classes are **listed with their reason**, never silently skipped.
- ⚠️⚠️ **THE ONE DEFECT THAT WOULD HAVE CORRUPTED DATA: twenty-three activities sharing an Activity
  ID.** `splitBuild` uses `co.ref` as the new row's id, and `splitFreeId` checks only against `rows`
  — which never grows during a run, because nothing is written until the end. So every host under
  CO-014 would have been handed the id `CO-014`. Activity IDs are what predecessor strings, the
  schedule↔document links and these new links all reference, so it would have broken three things
  silently. `_bulkFreeId` threads a `taken` map and checks both. **The contrast build proves it**:
  reverting that one condition fails exactly the three id-uniqueness assertions.
- **Verified: 54 assertions** executing `splitPlan` / `splitBuild` / `_bulkFreeId` / `bulkSplitPlan`
  / `locSelValues` and the wizard's own `STEPS` **sliced out of the shipped files** — plus **three
  contrast builds**, each reverting one thing and each failing only where it should (3, 5 and 6
  assertions). `splitPlan`/`splitBuild` run as a **control**. **Rendered in a browser** at 1440px and
  at **918px** (the owner's own screenshot width): 7 raw floor spellings collapse to **4 places**,
  "2nd Floor" gathering all **18** of its activities under a ×3 badge naming every variant; both
  recorded CSS traps measured absent (22 checkboxes at **13px**, activity names at **314px** not the
  ~200px squeeze); no page or pane overflow; and both degrade paths — no location levels, and the
  un-run migration — name what to do and leave the picker usable.
- ⚠️ **Three of my own mistakes, caught and recorded rather than shipped:** `res.id` where
  `persistRecord` returns `{ok, row, dropped}` (every link write would have been skipped silently);
  a `p._open` flag read off freshly-derived objects (expanding a place would have shown nothing); and
  two unsound test metrics — a `wrapped` check comparing height against a *set* height, and a
  line-count from `top` offsets that `align-items:center` makes meaningless.
- Assets contracts `module.css` / `module.js` / `wizard.js` + the new `affected.js` `?v=20260909co`;
  **`MODULE_V` → `20260909co`** — ⚠️ deliberately not a letter in the daily sequence, since two
  collisions this month came from two sessions picking the same next letter.
- ⚠️ **Not verified signed in, and the migration has not been run.** No link has been written, no
  bulk insert applied and no CO Ref filled down against a real project. Until the migration runs the
  register saves normally and reports the unsaved links by name.
- ⚠️ **Deliberately not built:** a deep link from the record into the schedule (the schedule reads
  **no** URL parameters at all today — 0 occurrences of `URLSearchParams` — so it discovers the links
  from the table itself), per-activity EOT days, and retro-linking existing `change_order_ref` values.
### 2026-09-08 (pv) — Three registers: a KPI strip that fits, four invisible buttons, and a present view put back

No migration. Owner's items 1–3 of four; **item 4 (Progress Photos) was explicitly paused by the owner
and is not in this commit.** Detail in each module's own `CLAUDE.md`.

- ⚠️⚠️ **Stakeholder Map's KPI strip needed a CSS change that the first cut of this work did not
  contain, and only rebasing onto main exposed that.** The owner asked to drop three cards and *"fit
  the other 4 kpi cards in a single level row."* Dropping the cards is four lines; the row is
  `.sm-kpis`, which was `repeat(7, 1fr)` with breakpoints at 1600/1000/700 — sized for the seven cards
  that used to be there. **Four cards in that grid is worse than seven, not better:** seven tracks at
  desktop width leaves three empty cells, and at 918px — the width the owner's own screenshot was taken
  at — the 1000px breakpoint drops it to three tracks, so four cards would still have wrapped to two
  rows and the complaint would have survived the change meant to fix it. `.sm-kpis` now carries the
  shared `.pd-kpis` rule verbatim (`repeat(auto-fit, minmax(170px, 1fr))`) and the three breakpoints
  are gone. ⚠️ **MEASURED, 8 widths from 700–1900px:** four cards are **one row at 760px and every
  width above it**, with no upper bound (auto-fit stops adding tracks once the four are placed and
  `1fr` stretches them — 466px each at 1900px, so no ragged empty cell); at 918px it is one row where
  the old seven cards are **two**, which is the reported bug reproduced. Below 760px it goes to two
  rows, correct on a phone. ⚠️ Neither removed signal is lost: *no photo* is still a filter
  (`filters.flag === 'nophoto'`) and a missing plan still prints on the stakeholder's own card.
- ⚠️⚠️ **Meetings' four detail-toolbar buttons were not broken, they were INVISIBLE.**
  *"I am not sure if one of the buttons are present view. or any of the functions of the other buttons
  as well."* Every control in that toolbar is a `data-ico` placeholder that `Icons.hydrate()` fills in;
  `render()` hydrates `#il-mom-view` after calling `renderDetail()`, so a **first landing looked
  correct** — but **28 other call sites invoke `renderDetail()` directly** (toggling reporting view,
  every workflow step, every filter change, every save), and each rebuilt the toolbar with nothing to
  fill the icons in. Fixed at `renderDetail()` rather than at the 28 callers, for the same reason
  `psSetupChanged()` exists in project-schedule. The favourite star survived only because it is a
  literal ★/☆, not an icon. **Measured both ways in a browser:** unhydrated, all four report
  `svg:false` with empty labels — the screenshot's blank buttons; hydrated, all four render.
- ⚠️ **`+ Add meeting` wrapped because a 34px square rule had no `:not()`.**
  `.il-topbar-tools .pd-btn` forced `width:34px` onto **every** button in the cluster, so two words
  wrapped inside a 34px box. **Measured:** with `.il-tb-labeled` it is 106px and **one line box**
  (`scrollWidth/clientWidth 104/104`); with the class removed, 34px and **two line boxes**,
  `39/32` — overflowing. ⚠️ The first version of this assertion was **unsound** (it compared height
  against `fontSize × 1.6`, but 34px is the button's *set* height, so it reported a wrap either way);
  redone by counting line boxes with `Range.getClientRects()`. ⚠️ `.pd-btn` in the **shared**
  `dashboard.css` carries no `white-space`, so this is a shared gap fixed module-locally — that file is
  being edited by another session today.
- **The mode toggle gets a word, in both registers.** Export / email / distribute are *actions* and read
  fine as icons with titles; a reporting view is a **mode** — it changes what the whole screen is — and
  the owner could not identify it even in principle. Both now read **Present** / **Exit**, same word and
  same treatment in Meetings and in Issues & Concerns. The Meetings state chip also stops being a
  paragraph: it carried the whole sentence *"Draft — editable by you, a planner, or this meeting's
  attendees"*, which made a 60-character essay out of a status pill; the sentence moved to its own note
  line beside the locked note, so it is still on screen and still readable on a phone (a `title` would
  have hidden it from touch entirely).
- ⚠️⚠️ **Issues & Concerns' present view is RESTORED, and this is a deliberate reversal of a decision
  whose note is still in that module's `module.css`.** *"what happened to the present view?"* — it was
  removed on purpose in `256deb7`, recorded there as *"No need for reporting view" — confirmed
  unreachable, not just unused*. That reasoning was right about the **Dashboard** (a portfolio read) and
  wrong about the **single record**: presenting one issue in a meeting is not the same act as reading the
  register, and both Minutes of Meeting and Project Schedule kept a present mode for exactly that. The
  note is left in place and answered rather than deleted.
- ⚠️⚠️ **`present` is its own flag and must NOT be folded into `opts.readOnly`, even though both end at
  `ro=true`.** `readOnly` additionally sets `bg`, which means *"this is the Background embed on a
  lesson's page"* and keeps the narrative fields in **boxed, disabled textarea chrome** — the exact
  opposite of what a present view wants, because an `<input>` clips its own value (measured in Meetings
  at 659px of text in a 416px box). Reusing `readOnly` would have silently turned the present view into
  a Background embed. ⚠️ **7 assertions executing the flag computation sliced verbatim out of the
  shipped `issDetailHTML`**, with a **contrast build** on the pre-fix line: it fails exactly the
  `present` case (`ro:false` where `ro:true` is required), so the suite bites. ⚠️ The mode is
  **session-only and reset on leaving the record** — a screen that comes back read-only tomorrow reads
  as *"I have lost permission"*.
- ⚠️ **Two defects caught in this commit that the first cut would have shipped**, both from rebasing onto
  main rather than committing out of a shared working tree: my present-view CSS first targeted
  `.il-iss-actions` and `.il-mi-card`, **neither of which issues-lessons emits** (the real names are
  `.il-mom-actions` and `.il-iss-card`) — a silent no-op; and `font-size: var(--pd-fs-sm)` referenced a
  token that **does not exist on main** (the `--pd-fs-*` scale is another session's unlanded work), so
  the declaration would have been dropped at computed-value time. Every selector is now verified against
  the markup the module actually emits, and the token carries a `12px` fallback so it is correct now and
  adopts the scale when it lands.
- ⚠️⚠️ **Built in a temp worktree off `origin/main`, NOT staged out of the shared clone, and that was
  the whole difficulty of this commit.** The clone has **55 modified files** belonging to a concurrent
  session — an app-wide typography-token and shared-component refactor that had already migrated
  `#sm-kpis`/`#il-kpis` onto `.pd-kpis`, rewritten `stakeholder-map/module.js` by 840 lines, and burned
  `?v=20260908d` on `dashboard.css` and `ui.js`. **Item 1's verified behaviour depended on that
  unlanded migration** (which is how the missing CSS was found), and committing their `?v=` bumps
  without their file contents would have cache-poisoned their real deploy. Only module-local `?v=`
  tokens are bumped here; every shared asset token is left exactly as main has it.
- Assets `module.css` / `module.js` `?v=20260908pv` in all three modules; **`MODULE_V` → `20260908pv`**.
  ⚠️ **Deliberately not a letter in the daily sequence** — main is already at `20260908h`, and the two
  collisions this month were both two sessions independently picking the same next letter.
- ⚠️ **Not verified signed in.** No live login is possible here. The KPI row, the toolbar geometry and
  the icon hydration are real browser measurements against the shipped stylesheets with the module's own
  markup; the present view's flags are asserted against code sliced out of the shipped file. Nothing has
  been driven against a real project.
### Construction Library: Excel-style Ctrl-click selection, and a drag grip replacing the Move buttons (2026-09-08) — jasantos2

Owner: *"for the multiple selection, can you adapt similar to excel wherein if multiple selection,
you must hold ctrl and then click to select another row. And also instead of having buttons to move
up and move down, there should be a menu icon on the left, to allow smooth rearrangement."*

- **Excel's rules, exactly.** A plain click **replaces** the selection (it used to toggle, which let
  a selection accumulate quietly and then *Group* act on all of it); **Ctrl** — or **Cmd** — toggles
  one row and keeps the rest; **Shift** takes the range from the anchor and replaces, **Ctrl+Shift**
  adds. ⚠️ The anchor does not move on a shift-click, so shift-clicking again re-picks the range from
  the same start instead of ratcheting outward.
- **A ≡ grip, first in every re-arrangeable row.** Drag to re-arrange. ⚠️ Only the grip is
  draggable, never the row — a draggable ancestor kills text selection in the grouping-path field.
- ⚠️ **One drop does both halves of what a drag means:** the order *and* the grouping. Dropping a row
  inside another grouping re-homes it as well as placing it; a drag that reordered but left the path
  alone would park a row visually inside a grouping it is not in. Cross-trade drops are refused with
  the reason, because a trade is set by a discipline matcher elsewhere and re-trading a row by
  dragging it past a heading would undo that.
- A grouping's grip moves the **whole grouping** among its own siblings; a drag started on a selected
  row carries the **whole selection**.
- ⚠️ **Move up / Move down are gone from the bar, as asked** — kept in the right-click menu, and the
  grip takes **↑ / ↓**, so re-arranging never needs a mouse.

**599 assertions across ten suites, all passing** (54 new). ⚠️⚠️ **This time the drag was fired in a
browser**: a git-ignored page renders the shipped pane and wires the shipped handlers, so real
`DragEvent`s were dispatched at it — the reorder, the re-home, the refused cross-trade drop (with no
dirty flag), a whole grouping moved, and both keyboard routes all confirmed on the live DOM. It also
caught a defect the tests could not: the drop edge and the selection edge are both two-class rules,
so the one declared later wins, and the marker was vanishing on exactly the rows being dragged.
⚠️ **Not verified signed-in** — nothing was pushed, and the drag has not run inside the module with
a real project loaded.

`MODULE_V` → `20260908h`. Detail: [`modules/project-schedule/CLAUDE.md`](modules/project-schedule/CLAUDE.md).

### Schedule Setup: the WBS step and the Library become one Structure step with two views (2026-09-08) — jasantos2

Owner: *"merge the WBS in step 2 into step 6… Call the view for the step 2 as 5PMLC, and step 6 as
Construction Library… edits made should be updated live"*, then *"delete some groupings… multiple
selection of rows in the right pane, and then right click, group them together with a defined group
name. As well as re-arranging the items."*

- **One step, two views.** *Structure* replaces both steps: **5PMLC** is the project's whole live WBS
  (Milestones → Close-out), **Construction Library** is the places and groupings inside Execution.
  5PMLC is the default, which keeps the orientation the old step 2 existed to give. The **import path
  gains the 5PMLC view**, which it never had. Old deep links (`gotoStep('WBS')`, `'Library'`) still
  resolve and select the matching view.
- ⚠️ **On "updated live", honestly:** the views edit different stores — 5PMLC edits the **live** WBS
  tree, the Construction Library edits **this setup's draft**, which becomes branches at
  *Generate ▸ Push*. So a Library edit cannot make a branch appear in the tree; the branch does not
  exist yet, and writing branches per keystroke would litter a project's live WBS with structure
  nobody pushed. What *is* live is the bridge line between the two views, recomputed on every render
  from both sources, and it names the push in as many words.
- **Delete a grouping.** ⚠️ It deletes the **rung**, not the work: everything under it moves up into
  the parent, and the confirm says so. Nothing on this screen can delete an activity.
- **Multi-select and group.** Click a name, shift-click for a range, right-click to act. ⚠️ Grouping
  **inserts** a shared rung above the selection rather than overwriting their paths, so nothing they
  already had is discarded; a selection spanning trades makes one grouping of that name inside each
  trade, and the toast says when that happened.
- **Re-arranging** items and whole groupings, within siblings. ⚠️ Not cosmetic — this order is the
  order the push builds the branches in.

**544 assertions across nine suites, all passing** (96 new). A browser render caught two defects
this time, including a selected row that showed its tint but not its edge because a single-class rule
lost to the equally-specific depth rules below it. ⚠️ **Not verified signed-in** — nothing was pushed
and no live WBS tree was loaded, so the two views have never been switched between against a real
project.

`MODULE_V` → `20260908g`. Detail: [`modules/project-schedule/CLAUDE.md`](modules/project-schedule/CLAUDE.md).

### Schedule Setup Library: the grouping becomes a path, and the places gain their unit rung (2026-09-08) — jasantos2

Owner: *"for the library, allow users to add more levels and as well as in the right pane for the
groupings and items."*

The Library's two panes were three rungs deep each, by construction. Both now go four.

- **Right pane — the grouping is a PATH.** A trade holds a *tree* of groupings, and an item sits on
  whichever rung its own path ends on (`Structural › Substructure › Concrete Works › Rebar › Rebar`).
  Stored as `grp` + `grps` and read only through `absPathOf`; ⚠️ `grp` always holds rung 1, so every
  reader written before nesting existed gets exactly the value it used to get.
- **Editing it: ‹ out / › in.** ⚠️ One button per rung does not survive more rungs — a rendered pane
  showed **L2 L3 L4 L5 L6 on every item row**, squeezing the activity name. Promote/demote is two
  controls at any depth, and the chip at the head of the row already names the rung. Deepening
  borrows a **sibling's** name, in the spelling the pane draws; cancelling writes nothing.
- **Restructuring: Rename and + level.** Rename retitles a rung for every item under *that* node
  (two same-named groupings under different parents stay two). ⚠️ **+ level INSERTS** a rung and
  moves everything beneath one step deeper — the first version moved direct items only, and the
  rendered check found the button dead on the one grouping most worth inserting a phase under.
  A sub-tree already at the cap refuses rather than being truncated, which would be silent loss.
- **Left pane — the unit.** ⚠️ It has existed in `cfg.zoning`, in the push and behind Floors &
  Zones' own buttons since before this pane did; the pane just stopped at the zone, so a project
  with units read as if it had none. Four is the honest number: those are the rungs the setup
  stores and the stacking bands by. A fifth is a schema change and its own prompt.
- **The rung names come from the project.** The left pane reads its own location levels, so a
  breakdown named *Tower › Level › Zone › Cluster* says so here as it does in the push dialog.
- **One WBS dim per rung** — `agroup`…`agroup4`, keyed on the whole prefix so two parents' `Rebar`
  stay two branches. ⚠️ Every rung **self-skips**: a project that groups nothing pushes a tree
  identical to before this existed, and a saved setup gains nothing until it is ticked in
  *Generate → WBS structure*. The dialog now says *why* each skipped dim is skipped, per dim.

⚠️ It does **not** change the Vertical Stacking axis: that axis is the location breakdown, and the
grouping is activity structure.

**447 assertions across eight suites, all passing** (123 new, executing the shipped path model, the
Library's tree builder and the push's own `dimKey`), plus a browser render that is where four of the
defects above were found. ⚠️ **Not verified signed-in** — the anon key has no grants, so the four
grouping rungs have never been built against a real project's WBS.

`MODULE_V` → `20260908f`. Detail: [`modules/project-schedule/CLAUDE.md`](modules/project-schedule/CLAUDE.md).

### 2026-09-08 (e) — The right pane's skipped L2 was a bug of mine; the grouping becomes a WBS rung

Owner: *"how come on the right pane, the trades are L1 and then L3 is followed?"* Because
`libItemRow` printed a **literal L3** on every item — so an item with no grouping sat at depth 2,
directly under its trade, while claiming L3. The pane announced a rung that was not there.
`absLevelOf` answers it from the position instead: **inside a grouping = L3, directly under the trade
= L2**, derived and never stored, so the number cannot disagree with the tree the push builds.

Owner: *"allow the identification / adjustments of the levels of each item… This would then be
inputted as information for the schedule builder."* Each item now carries an **L2 / L3** pair, and
setting the level *is* the structural move — L3 means "has a grouping", L2 means "has none", so the
buttons set and clear it. ⚠️ Two buttons, not a free number: L1 is a trade, and the trades are the
project's fixed disciplines, so a 1/2/3 box would invite typing 1 and having nothing happen.

And it reaches the builder literally: **`agroup` is now a WBS dim**, nesting between the trade and the
places (`Structural Works › Rebar › 3rd Floor › Zone 1`), keyed on the normalised grouping name,
named by it and ordered by the setup's own order. ⚠️⚠️ **It self-skips** — `dimKey` returns the same
sentinel `tower` uses on a single-tower project — so a project where nothing is grouped pushes a tree
**identical** to before, and a **saved** setup does not include the rung until the planner ticks it in
*Generate → WBS structure*. ⚠️ It does **not** change the Vertical Stacking axis, which is the
*location* breakdown; the grouping shows up in the WBS tree and every WBS-branch readout instead.
Module only. 366 assertions across eight suites, plus a browser render whose chips, tooltips, picker
states and font weights were read out of the DOM; ⚠️ not verified signed-in. `MODULE_V` → `20260908e`.

### 2026-09-08 (d) — The Library labels L1/L2/L3, and the Schedule Setup rail minimises

Owner: *"there should be levels like L1, L2, L3 like in the pic i sent, so it is easier for everyone to
see also. also make the steps on the left side be minimized so more space."*

Both panes of the Library now carry a fixed-width **rung chip** on every row, with a legend per pane —
because indentation says a row is *under* another one but not **which rung** it is on, and the two panes
put different things on the same rung (L2 is a Floor on the left, a Grouping on the right), which is the
correspondence the sheet exists to show. Tinted by depth rather than coloured, so it does not compete
with the trade colour or the change-order and critical marks.

The step rail collapses to a **46px strip of numbered circles** — numbers, not nothing, since the steps
are referred to by number everywhere else in this module. ⚠️ The toggle lives outside the rail (which
`innerHTML` rebuilds every render and would throw it away) and the state is re-applied after every rail
render, so a repaint cannot silently expand it. One class drives both rails, so Schedule Setup and Cost
Loading cannot disagree. ⚠️ Named `sbld-railmin`: `.sbld-mini` already exists for an unrelated control.

⚠️ **Two layout defects were found by rendering the shipped function and looking at it** — a floor named
*Roof Deck* printing its kind label as well ("Roof Deck  Roof Deck"), and a six-trade list widening the
row past the floor name. And the fix for the first shipped with `/s+/g` instead of `/\s+/g`, collapsing
runs of the letter **s** — caught by asserting the normaliser rather than trusting it. Module only.
323 assertions across seven suites; ⚠️ not verified signed-in. `MODULE_V` → `20260908d`.

### 2026-09-08 (c) — Two jsonb columns from August get an editor; the BOQ's second insert path is deleted

No migration. Owner: *"Let's do the half-built and consistency gaps first."* Every one of the four
turned out to be something the **database already supported and the UI never reached** — which is why
they were cheap, and why nobody had noticed. Detail in
[`modules/contracts-claims/CLAUDE.md`](modules/contracts-claims/CLAUDE.md).

- ⚠️⚠️ **`pmi_records.internal_chain` / `client_chain` had ZERO reads in `pmi.js`.**
  `2026-08-25-pmi.sql` declared both, with the reason in the migration — *"a proposal three weeks
  with the COO is not 'Submitted' — it is NOT SUBMITTED AT ALL"* — and the roles were configurable
  per client from day one. So the register could report an instruction sitting **94 days** and not
  say **with whom**. There is now an **Approval chain** section (ours and the client's, per role:
  arrived / cleared / days / signed-by), a **holder** figure in the case-file header beside the stage
  clock, and a `n/m cleared` badge. ⚠️ Order comes from the **profile**, never from the jsonb's own
  keys — object keys enumerate in *data-entry* order, so that would let recording the COO first claim
  the COO signs first. ⚠️ A **renamed** role strands its dates as a labelled **orphan** row rather
  than being dropped or silently re-pointed; re-pointing by position would attribute one manager's
  sign-off to another. ⚠️ A record at Submitted with an uncleared chain is **reported, never
  corrected** — it is just as often a chain nobody filled in, and only the planner knows which.
- ⚠️⚠️ **`pmi_records.claim_id` existed since August and nothing could set it.** The register already
  drew a "claim" chip off it; `claim_id` appeared exactly once in `pmi.js`, reading that chip. So the
  roadmap's *"promoting a PMI to a contracts_claims row in one click"* was a hand-written `UPDATE`.
  **Raise claim / CO…** now does it — writing through the claims register's own `persistRecord` (which
  carries the missing-column degrade on the one table proven incomplete on the live database), asking
  the record **type** rather than deriving it, refusing a second promotion because two claims for one
  instruction is a double count in the register the client is billed from, and ⚠️ **rolling the claim
  back** if the link fails, since the claim is written first and an unlinked one is indistinguishable
  from a duplicate filed by hand.
- ⚠️⚠️ **`openNewRev()` wrote no `document_id`, so every revision it made was an orphan — and this
  corrects yesterday's entry (a), which said the opposite.** I claimed it wrote one from `DOCID`; it
  did not, and the insert is four lines long. `load()` shows a null-document revision under **every**
  BOQ on the project while `computeProjectTotal` counts it under **none**, and nothing errors — which
  is what let it survive. Fixed by **deleting the second insert path**, not by adding the column to
  it: the rival insert also lacked the duplicate-label retry `createDraft` grew after the owner hit
  `boq_revisions_project_rev_idx`.
- **An empty BOQ document is now reachable, so a refusal I wrote yesterday could go.** The wizard
  offers *First revision of `<name>`* on a document with zero revisions, the empty state names the
  document instead of denying a BOQ exists, and the delete refusal is removed. ⚠️ `can.rev` was
  already right and the step's **render gate** eight lines away silently overruled it — caught in a
  harness, not by reading.
- **Verified:** 40 assertions executing the chain derivation sliced out of the shipped `pmi.js`, with
  **three contrast builds** — jsonb-key ordering fails 7 assertions and then throws; the two
  single-purpose regressions fail exactly the one assertion each was written for. Rendered in a
  browser (both ladders, the three row states, the amber orphan, the contradiction alert) and the
  wizard driven through five worlds asserting paths, prefills, the three button labels and that `rev`
  sends **no `docName`**.
- Assets `module.css` / `boq.js` / `wizard.js` / `module.js` / `pmi.js` `?v=20260908c`; `MODULE_V` →
  `20260908c`.
- ⚠️ **Not verified signed-in.** No chain written, no claim raised or rolled back, no revision created
  through the repaired fallback against a real project.

> ⚠️ **Two sessions landed on 2026-09-08 and BOTH numbered themselves `(b)` and BOTH bumped `MODULE_V` to `20260908b`.** Resolved as the union — both entries kept whole, the Contracts & Claims one re-lettered `(c)`, and `MODULE_V` bumped past both to `20260908c` so a browser that fetched `20260908b` between the two pushes cannot keep a half-updated module page. Same collision, and the same resolution, as 2026-09-07 (e).

### 2026-09-08 (b) — Cost Loading reads the BOQ; a Library step puts places beside work

Owner: *"i want you to redirect the step 2 to the contracts and claims app. since technically the
assigning of cost per activity should be matched / defined in the BOQ."* Step 2 no longer asks for the
figure — it **reads** it. `boqDerive()` shares each priced BOQ line's amount across the activities it
is matched to (by allocated quantity, or **1/n** for a link-only line), skipping headings, exclusions
and amount-less lines; the read crosses modules under the caller's own RLS and writes nothing.
⚠️ **Two columns, not one box:** *From the BOQ* read-only beside an *Override*, because a single field
would let a planner think they had corrected the BOQ and hide that the correction stops following it.
Clearing the override returns the line to the BOQ. It degrades rather than blocks — no BOQ, no tables
or no grants all still allow typed totals, with the reason stated.

Owner: *"there should be a library in the schedule setup module. That library should first define the
locations on the left pane, and on the right the groupings of activities."* A new **Library** step in
Schedule Setup, in the shape of the attached cost-structure sheet: places left, trade → grouping →
item right. ⚠️ It is a view and an authoring surface, **not a second store** — the places live in
`cfg.zoning` and the items in `cfg.activities`; only the L2 grouping is new. And **`openLocAdopt()` is
finally wired**: complete and reachable from nothing since it was written (flagged twice), it is now
*Read locations from the WBS…*, beside *Match WBS to trades…* — which is the import complaint
answered, since the matching could always be done but was in front of nobody. Module only.
296 assertions across seven suites, all executing code sliced from the shipped file with HEAD run as a
control; ⚠️ not verified signed-in. `MODULE_V` → `20260908b`.


### 2026-09-08 (a) — The Trades step was never failing to load; a text-field CSS rule was hiding it

No migration. Owner: *"1. The trades in the add BOQ is not loading properly. 2. … it says 'Start a
new revision instead' which is misleading with my objective to create a new BOQ. 3. I need a delete
BOQ as well."* Detail in [`modules/contracts-claims/CLAUDE.md`](modules/contracts-claims/CLAUDE.md).

- ⚠️⚠️ **`.ccw-main input { width:100% }` was applied to the class-code ladder's checkboxes.** A
  text-field rule, matching *every* input inside the wizard's main pane — and the Trades step hosts
  `boq.js`'s four-pane ladder there. Measured in a browser on the shipped file: the ladder checkbox
  rendered **181.75px wide in a 201.75px row**, pushing the code chip, the item name and the n/total
  count clean out of the pane (`scrollWidth 254` against `clientWidth 202`) and centring the tick
  glyph in its own stretched box. All 702 codes were read and every name was in the DOM. Scoped by
  **type** — `input:not([type="checkbox"]):not([type="radio"])` — which also un-stretched the three
  radios the wizard already rendered as 100%-wide controls.
- ⚠️⚠️ **"Start a new revision instead" did not start a revision — it created a new BOQ document.**
  The link set `boqNew` and `finish()` then passed a `docName`, which is exactly what makes a new
  `boq_documents` row. So the only route to the thing the owner wanted was labelled as the thing he
  did not want, the label promised a supersede that never happened, and there was no route to a real
  revision of the BOQ on screen at all. Now three named choices — **Add trades to rev NN** /
  **Create another BOQ** / **New revision of NAME** — resolved by one `boqPath()` that the step's
  copy, the rail, the button label and `finish()` all read, and re-validated against what exists on
  every read because `boqDraft()` answers null until the BOQ section has loaded.
- **The last BOQ is deletable, and a draft revision has its own trash.** The `DOCS.length < 2`
  refusal protected nothing — `boq_revisions` cascades from `boq_documents`, so there was no next
  revision to orphan, and an empty picker is a state `render()` already answers on purpose. On a
  project with one BOQ the control refused every time, so from the owner's side it did not exist.
  The gates that guard evidence are untouched: an **issued** revision is never deletable, and
  `boq_billing_periods` blocks a delete in the **database**.
- ⚠️ **Audited, not built: the class-code bridge runs one way.** `grep -c 'boq_'` over
  `modules/project-schedule/index.html` returns **0**. Of the owner's four hand-offs (high-level BOQ
  → schedule, tagging, schedule → detailed BOQ, BOQ money → activity cost) only **tagging** exists,
  and it only works once the schedule already does. Cost Loading groups by activity **name**
  (`index.html:33201`) and its total is typed by hand, so a class code is a reporting tag and not a
  cost carrier. The trap to design around first is **double counting** — one line allocated across
  forty activities must contribute once, so the money belongs on the allocation, never on the tag.
- Assets `module.css` / `boq.js` / `wizard.js` / `module.js` `?v=20260908a`; `MODULE_V` →
  `20260908a`.
- ⚠️ **Not verified signed-in.** The wizard's four endings were asserted on their `createBoqDraft`
  payloads against stubbed deps, so nothing has been written or deleted against a real project.

### 2026-09-07 (k) — A BOQ can be deleted; Finance's cost classes are translated to Procurement's trades

**Run `migrations/2026-09-07-trade-map.sql`.** Owner: *"Let's add the option to delete BOQ first.
Let's do the proper mapping if you think that would help us in the finance and procurement
connectivity."* Detail in [`modules/contracts-claims/CLAUDE.md`](modules/contracts-claims/CLAUDE.md).

- **Delete is mostly refusal.** `boq_items` and `boq_class_map` cascade from `boq_revisions`, which
  cascades from `boq_documents`, so the control refuses an **issued** revision outright (the tendered
  document, the thing a claim argument turns on), refuses the **last** document (every revision hangs
  off one), translates the database's own refusal when `boq_billing_periods` — which references
  revisions **without** cascade — blocks it, and names the counts in the confirm.
- ⚠️⚠️ **`trade_map` TRANSLATES two vocabularies rather than merging them, and an earlier reading of
  mine was wrong.** I reported that Finance's 7 `class_codes.trade` values and Procurement's 10
  `work_packages.trade` values *"join to nothing, silently"* and recommended rewriting one. **There is
  no join.** `PRC_TRADE_ORDER` is a display sort order whose own comment says an unlisted trade *"is
  NOT dropped"*, and `project_schedule` has no trade column at all — verified, 0 occurrences. The two
  lists classify different things: how Finance files **cost**, and how Procurement **lets** the work.
  MEPF Works is one cost class bought as four subcontracts, which the owner's own billing proves
  (*"MEPF PO"* and *"STRUCTURAL PO"* are separate POs). A table, not a constant — Finance revises the
  chart without a deploy, and both apps can read a table. **"Others" is left unmapped** on purpose.
- ⚠️ **`PDb.selectAll` was the wrong reader for it** and the fix is a plain select: selectAll pages
  with `.order(key).gt(key, last)` and needs a **unique** key, while `trade_map`'s primary key is the
  PAIR — a page boundary inside the four MEPF rows would silently drop the rest of the group. Same
  family as the `class_codes.id` failure in (e), caught this time before shipping.
- ⚠️ **Audited on the owner's prompt — *"check that we have class codes to connect the activities to
  the costing"* — and three of the four links exist.** The chart (702 rows / 698 active) is there, the
  activity carries a code, the BOQ line carries one, and the line links to activities. But
  `modules/project-schedule/index.html` reads **no `boq_*` table at all**: Cost Loading keys its cost
  lines on the activity **NAME** and step 2's total is **typed by hand**. A BOQ line priced under
  03101 and forty activities tagged 03101 never meet. The class code is a tag for grouping and
  reporting; it is **not yet a cost carrier**. Named as the next feature rather than built, ⚠️ because
  the trap to design around first is double counting — one line allocated across forty activities must
  contribute its amount once, so the sum belongs on the **allocation**, not on the tag.
- `boq.js?v=20260907zb`, contracts `module.css?v=20260907q`; `MODULE_V` → `20260907zf`.
- ⚠️ **Not verified signed-in** — the migration has not been run, so no `trade_map` row has been read
  and no BOQ has been deleted through the new control.

### 2026-09-07 (j) — BOQ links before measurement; cost-loading spread per occurrence

Owner: *"if it is matching to schedule, users are able to link despite the qts or amount not being
assigned"*. Matching and measuring are different jobs done at different times — which activities a
BOQ line covers is knowable off the drawings first. **Match to schedule** now lists measured, lump
sum and provisional lines regardless of quantity or amount, proposes their candidate activities at
qty 0, and stores the link on its own (`qty = 0` = matched, not yet quantified — no migration; the
column is already `not null default 0`). ⚠️ The gate that mattered was silent: Apply discarded every
zero-quantity part, so a link recorded before measurement **vanished with a success toast**. A
qty-less line shows em dashes rather than zeros, never claims to reconcile, and reads **Link…**
instead of **Allocate…**; over-allocation is only tested where a quantity exists.

Owner: *"the function of cost loading of the project schedule should allow users to decide what type
of distribution that activity has over the ff months."* Step 4 already offered Linear / Front / Back
/ Bell per occurrence across its own dates — but **one shape per cost line**, which stopped being
enough once a cost line could be a WBS branch covering twenty zones. An occurrence may now override
its line's curve; "Same as line" deletes the override rather than freezing a copy, so a line-level
change still moves everything not overridden. Apply and the monthly preview were switched together —
a preview reading a different shape from the one Apply writes is an S-curve the schedule never gets.
251 assertions across six suites, all executing code sliced from the shipped files with HEAD run as
a control; ⚠️ not verified signed-in. `MODULE_V` → `20260907za`, `boq.js?v=20260907w`.

### 2026-09-07 (i) — `PDGrid`: spreadsheet keys as a shared layer, not a second grid engine

Owner: *"let's develop the excel grid, let's develop it in a way that would benefit more modules /
make it easier for planners to connect it to the activities as basis for cost loading, productivity
rates etc."*

- ⚠️⚠️ **New `assets/js/xlgrid.js` ATTACHES to a table; it does not render one.** WPM's
  `review.html` grid — the reference the owner pointed at — is **~517 lines of JS and 148 CSS
  rules** that own their markup end to end. Porting that would have meant rewriting every adopting
  module's table and then maintaining a second copy that drifts from WPM's. Instead a module keeps
  rendering exactly as it does now and PDGrid adds the behaviour, with a two-attribute contract the
  BOQ table **already satisfied before this file existed**: `data-i` (row) and `data-f` (field).
- **So adoption is: add the two attributes, call `PDGrid.attach`, supply a save function.** No
  markup rewrite, no new render path — which is what makes cost loading and Productivity Rates
  cheap to wire later.
- ⚠️ **Editing is free because the cells are real inputs.** WPM's grid renders `<td>`s and must
  build an editor on demand (`_xlBeginEdit`, F2, commit/cancel). Here the cell *is* the editor, so
  "move to a cell" is `.focus()` — deleting an entire class of state, including any chance of
  losing a half-typed value to a re-render.
- ⚠️ **Left/Right deliberately do NOT change cells.** With real inputs the caret must stay movable;
  Tab does columns, Up/Down/Enter do rows. The one place copying Excel exactly would fight the medium.
- Keys: Tab/Enter/arrows, **Shift+↓ select**, **Ctrl+D fill down**, Ctrl+Z undo, Delete clears a
  multi-cell selection only, and **paste a TSV column straight from Excel** — the feature that
  matters most, since a BOQ is priced in a spreadsheet far more often than typed.
- ⚠️ `onSet` routes through **`saveCell`, the same path an ordinary edit takes**, so a pasted value
  gets identical parsing and the identical `1,000`-is-not-empty guard. A second write path would be
  a second set of bugs.
- ⚠️ Caught before shipping: the keyboard-hint used the `draft` local **declared eight lines below
  it** — `var` hoisting made it `undefined`, so the hint would have silently never rendered.
- `xlgrid.js?v=20260907a`, `boq.js`/`packages.js?v=20260907i`, `MODULE_V` → `20260907l`.


### 2026-09-07 (h) — Contracts & Claims: the BOQ button goes, one day after it arrived

- Owner: *"there is also a BOQ button in the contract records which is redundant when we have
  already moved the BOQ section to the contract page"* — correct. It was added that morning to fix
  the BOQ having **no entry point at all** while it was still a sub-screen you navigated to; moving
  the BOQ inline onto the same page made it redundant the same afternoon. A button that scrolls you
  a few hundred pixels down the page you are already reading is noise in a card header.
- ⚠️ `openSub('boq')` **stays** in `module.js` and still switches tab + scrolls, because the
  contract wizard's BOQ step hands off through it. That is a hand-off from another screen, not a
  control on this one.
- `packages.js?v=20260907h`, `MODULE_V` → `20260907k`.


### 2026-09-07 (g) - Contracts & Claims: the draft BOQ table looks fillable, and headings collapse

- ⚠️⚠️ **3,505 invisible inputs.** The draft table's cells were `background: rgba(0,0,0,0)` with a
  `1px solid rgba(0,0,0,0)` border and no placeholder — present and wired, but nothing on screen said
  they could be typed into. Owner: *"the table is not apparent to be filled out"*.
  Invisible-until-hover suits an **issued** bill (read constantly, written never — the trigger
  refuses it); on a draft it defeats the whole screen. `.boq-fillable` now applies **only on a
  draft**, plus muted shape-of-the-value placeholders (`0.00`, `0`, `unit`).
- **Headings collapse** — 924 rows under 223 headings. Spans come from **`depth`, not `parent_id`**,
  so they stay right after a filter removes rows mid-branch; a caret shows only where a heading owns
  rows, and Collapse all / Expand all appear only when the bill has headings.
  ⚠️ The state is in memory, not persisted — it is how you are reading the bill, not part of it.
- `boq.js`/`module.css?v=20260907f`, `MODULE_V` → `20260907i`.
- ⚠️ This entry had to be repaired: it was first written through a bash double-quoted string and
  **every backtick span was command-substituted away**, silently. Write log entries from a file, not
  an inline shell string — the same trap `python-inline-write-truncates` records.


### 2026-09-07 (f) — The changelog is deduplicated and archived by month

Owner: *"Fix the duplicated CLAUDE.md and finish the consolidation."*

- ⚠️⚠️ **A merge doubled this file.** `3869e50` took it from **13,752 to 27,561 lines** by
  resolving a CLAUDE.md conflict as *both entire changelogs* rather than both sides' new
  entries. **491 entries were duplicated, each byte-identical to its twin** (none appeared three
  times). Removed by keeping the first occurrence of every distinct entry. ⚠️ One heading
  legitimately appears twice with **different bodies** — the 2026-09-02 *"five views to four"*
  entry — and both copies survive, because entries are keyed on heading **and** body.
- **Archived by month, verbatim**, into `docs/changelog/` and
  `modules/project-schedule/changelog/`. Nothing was summarised or edited; only the heading
  level was normalised to `###`.

| | before | after |
|---|---|---|
| `CLAUDE.md` | 1,043 KB · 27,626 lines | **86 KB · 1,191 lines** |
| `modules/project-schedule/CLAUDE.md` | 1,031 KB · 14,693 lines | **48 KB · 712 lines** |

- ⚠️ **Entry boundaries are DATED headings only.** Splitting on every `##`/`###` counted
  `### Verified`, `### The fix` and `### Fixed` as entries and made project-schedule look like it
  had repeated headings; it has **none** — 398 entries, 398 unique. The duplication was always
  root-only.
- **Verified against the pre-change file, not by assertion:** unique dated headings
  **499 → 499** (root) and **398 → 398** (project-schedule), **0 lost**.
- The header now carries the merge-trap warning, because a doubled changelog is invisible in a
  diff — it reads exactly like a large honest append.

### 2026-09-07 — Cost Loading: the cost line can be the WBS branch, not only the leaf activity

Owner: *"what will happen if the project schedule is structured, wherein zones are the lowest level of
details… my intent is to cost load based on the activities, similar to a BOQ… users then assign the
cost to the WBS (activity) and then the ff steps remain."* The exercise was already right — price
*Formworks* once, split it across the places it occurs. One assumption was wrong: that the **leaf row
carries the work's name**. Where the leaves are *Zone 1*, *Zone 2* the BOQ line is the **WBS node
above them**, so step 1 was asking the planner to price a zone — and *Zone 1* under two different
branches folded into one cost line.

The cost line's identity is now a **basis**, detected from the schedule and changeable in step 1:
the leaf's own name (unchanged for every existing project), or the nearest WBS ancestor that names
work. The instances then become the zone rows under it, so *"equally, or a percentage per zone"* is
step 3's existing machinery with nothing added — as are the curves, the 100%-or-refuse rule and
Apply. "Is this a place?" is answered from the project's own location values plus one fallback
pattern for imports that never populated them; phase and place ancestors are stepped over. Detection
seeds without claiming unsaved changes, never overrides an explicit choice, states the count behind
its suggestion, and warns with a count before orphaning totals already assigned.
Also established rather than assumed: the **importer** was the writer that mis-stamped Earthworks as
Structural (its trail includes the activity's own branch), while the Match-WBS-to-Trade **wizard** was
never broken (its trail excludes the node's own name) — so that wizard is the safe route to retag
rows already stored. Module only.
204 assertions across five suites, all executing code sliced from the shipped file, with HEAD run as
a control on the same rows; ⚠️ not verified signed-in. `MODULE_V` → `20260907h`.

### 2026-09-07 (e) — The class-code error was a paging assumption, not the migration

- ⚠️⚠️ **`PDb.selectAll` pages on `id`; `class_codes` is keyed on `code` and has no `id`.** Every
  read threw `column class_codes.id does not exist`, the caller swallowed it, and the UI said *"the
  chart is empty — run the migration"*. The owner ran it repeatedly and it could never help.
  Verified live first: **702 rows, all active, readable** — data and RLS were fine throughout.
  The `codesErr` added in (c) is what surfaced the real message.
- **`selectAll(table, apply, cols, key)`** — `key` defaults to `'id'`, so existing callers are
  unchanged; it must still be a unique non-null primary key. ⚠️ `db.js` is shared: `?v=` bumped
  across **all 23 HTML files** in one pass.
- ⚠️ **The inline BOQ never loaded in a hidden tab** — an IntersectionObserver only delivers during
  the rendering steps, which a background tab skips. Now the rect is checked at mount and loads
  immediately when already in view; the observer only handles scrolling.
- `db.js?v=20260907a`, `boq.js`/`module.js?v=20260907e`, `MODULE_V` → `20260907h`.
- ⚠️ Rebased onto a concurrent session that had also bumped `MODULE_V`; **both picked**
  **`20260907f`**, so the merged value is bumped past both to `h` (see [[concurrent-sessions]]).

### 2026-09-07 — Main-contract-only closes the change-order gap; "Earthworks" stops outranking its trade

Owner: *"when picking main it should exclude the 'change orders' activities hence the bar chart will
revert to its original state. (meaning no gap in between)."* The gap **is** the change order, so with
the change orders filtered off screen there is nothing for the hole to refer to. Main-only now draws
no gap — and **gives the days back**: `dispFin` subtracts both the change-order days upstream of a
row and the ones inside its own bar, and the shift walk propagates a predecessor's internal gap days
so successors move back too. Without that second half the filter would have claimed the variation
never happened while the bar went on measuring it. Blended and Change-orders keep the gap.

Owner: *"why are these works tagged under structural trade? even though the trade is under site
development."* A real bug in the trade vocabulary: `earthworks` sat in **Structural Works**' terms,
and the classifier walks the WBS ancestry nearest-first and returns on the first hit — so
`Site Development Works › Earthworks` matched the child and never looked at the parent, and the
importer stamped Backfilling, Gabion and Gravity Wall as Structural. Ambiguous terms are now marked
`weak` and decide a trade only when no enclosing ancestor names one outright. "Earthworks" is still
not a place, so no location band changes. ⚠️ Rows already stamped keep their stored trade until
retagged — the badge says so. Module only.
163 assertions across four suites, all executing code sliced from the shipped file, with HEAD's
classifier run on the same inputs as the control; ⚠️ not verified signed-in. `MODULE_V` → `20260907g`.

### 2026-09-07 — The main-contract bar is drawn in two pieces around the change order

Owner, correcting the entry below: *"the bar of a the main contract activity will be divided into two,
since in between is the bar of the change order."* Both of their statements hold together — **one row,
one Activity ID, and a bar broken in two** where the change order sits. The row was already right;
the drawing was not. The gap is **derived from the change order itself** (a `change_order` row
SS-linked into the activity, its span strictly inside), so no column and no migration: move, re-date
or delete the change order and the gap follows. Drawn as a notch inside the single `.ps-bar` element
with a dotted midline (the P6 suspended-activity convention) rather than as two bars or a `clip-path`,
so drag, resize, link mode and the critical/change-order outlines all survive untouched.
`Merge split back into one line item…` now migrates rows already split in the database onto this
model — keeping the last segment's finish (the old merge silently deleted the variation's time impact)
and re-linking the change orders SS so the merged bar actually draws in pieces. Module only.
108 assertions across three suites, all executing code sliced from the shipped file, with HEAD run as
a control; ⚠️ not verified signed-in. `MODULE_V` → `20260907f`.

### 2026-09-07 (d) — Contracts & Claims: the manual BOQ loses the half of the screen it never used

Owner: *"the BOQ is complicated to use… it's really simple: you just have a BOQ and a class code
library and you just have to match it with the activities in the schedule."*

- **A hand-built draft now shows two tabs, not four** — `Lines` and `Match to schedule`.
  ⚠️ `Class Codes` maps a *client's descriptions* onto codes; on an authored line the **code came
  first**, so there is nothing to infer — the same reasoning that gave manual lines their own
  `authored` source. Worse, that tab **teaches** `boq_class_suggestions`, so it would have learned
  from its own output. ⚠️ `Billing / POC` cannot act before issuing — a draft never bills.
- **Gated on `origin='manual' AND status='draft'`**: imports are untouched, and all four tabs
  return on issue. Nothing removed, only deferred until it means something.
- **The empty draft explains itself** instead of saying "No lines match these filters" on a BOQ
  with no lines — three numbered steps, and the filter case kept separate.
- `boq.js?v=20260907d`, `MODULE_V` → `20260907e`.

### 2026-09-07 (c) — Contracts & Claims: manual BOQ first, and the BOQ moves inline

Owner, four items. Detail in `modules/contracts-claims/CLAUDE.md`.

- ⚠️⚠️ **The class-code error was a truthy empty array.** `ensureCodes()` read `if (CODES) return
  CODES;` and **`[]` is truthy**, so opening the BOQ before the migration cached the empty answer
  and it never queried again — *"I've run the migration already. But the error statement is still
  the same."* Fixed to `if (CODES && CODES.length)`, plus a `codesErr` so an empty chart is
  distinguishable from a read refused by RLS. (Not `active`, which defaults true; not grants.)
- **Manual build is now the primary action**, import the convenience — reversing that morning's
  weighting, which ranked the two by the speed of the happy case rather than by which always works.
- **"Rev no." is prefilled.** `rev_no` is NOT NULL and was meant for the *client's* label off an
  import; a hand-built BOQ has none to copy, so it no longer demands an invented one.
- **The BOQ is a section of the Contract tab**, not an overlay — `boq.js` renders through a
  movable host. ⚠️ It loads on scroll (IntersectionObserver), because inline would otherwise charge
  every Contract-tab visit six round-trips.
- ⚠️ **`modules/contracts-claims/module.js` has MIXED endings** — 14 CRLF among 1,098 LF, and the
  line I needed was one of the 14. Byte-exact anchors only. `?v=20260907c`, `MODULE_V` → `20260907d`.

### 2026-09-07 (b) — Contracts & Claims: the BOQ had no entry point

Owner: *"Where can i access the BOQ from here?"* Detail in `modules/contracts-claims/CLAUDE.md`.

- ⚠️ **`#pk-boq` was wired but never rendered** — a correct `onSub('boq')` handler bound to an id no
  markup carried. The tab strip has only `contract`/`claims`/`eot`, and a `v:'boq'` hash cannot work
  because `switchTab()` resets `sub`. **The only route to the BOQ was `+ Add` → the wizard → its BOQ
  step**, so the manual builder shipped the same morning was effectively unreachable.
- **Fixed** by rendering the button in the Contract records card head — not gated on `canWrite` (a
  viewer may read the client's BOQ; `boq.js` withholds the authoring controls itself), and emitted
  before the empty-state return so it works on a project with no contract row yet.
- ⚠️ **`modules/contracts-claims/packages.js` is CRLF**, unlike most of this repo. An LF anchor
  counts 0 and reads as "the code moved"; `grep -c 

### 2026-09-07 — A change order keeps the main-contract activity as ONE line item

Owner: *"i want to retain the single line-item for the main contract activity."* Inserting a change
order no longer generates a continuation row. The host keeps its id, name, start and all of its own
days, and its finish moves out by the change order's duration — the same time impact, one bar. The
change order is linked `SS+<days worked>` so it sits inside the bar rather than lying about an FS,
and because the row that followed the host still follows it, there is nothing to re-point at all.
Rows already split in the database are untouched and can still be collapsed with "Merge split back
into one bar…". ⚠️ The honest cost: date-span-weighted roll-ups now see the host spanning the change
order's days too, so that window is counted in both rows — the trade for a single line item.
Also: the Detail levels a combined Vertical Stacking model cannot draw are now **hollow** (dimmed,
dashed, `not-allowed`) rather than merely inert, and the no-level list marks a row whose own **Trade**
field disagrees with the WBS branch it is filed under — which is why Structural Works showed
activities sitting under Site Development Works, and is data rather than an error. Module only.
Verified by slicing the shipped `splitPlan`/`splitBuild`/`_vsTradeConflict` out of the file and
executing them (48 assertions, HEAD executed as a control); ⚠️ not verified signed-in.
`MODULE_V` → `20260907a`.

### 2026-09-07 — Contracts & Claims: Contract tab reordered, procurement-style tables, and a manual BOQ

**Run `migrations/2026-09-07-boq-manual.sql`.** Owner's three items on the Contracts & Claims module,
plus a mid-build ask to shorten the on-screen hint text. Full detail, the ⚠️ decisions and everything
verified: [`modules/contracts-claims/CLAUDE.md`](modules/contracts-claims/CLAUDE.md). The parts that
reach beyond the module:

- ⚠️ **A `security definer` RPC writes `project_schedule.class_code`, and this is the shape it has to
  be.** `project_schedule_upd` is `is_writer() and can_access_project(project_id) and (created_by =
  auth.uid() or is_admin())`, so a planner who did not import the schedule cannot update its rows —
  and **PostgREST answers an RLS-filtered UPDATE with 200 and zero rows.** A plain UPDATE would have
  toasted "Tagged 40 activities" over a table that changed nothing: the same silent success
  `2026-09-02-wbs-link-batched.sql` documents at length, where 16,393 of 16,485 activities kept a NULL
  while the screen looked perfect. `boq_tag_activities` therefore checks `is_writer()` /
  `can_access_project()` explicitly, **writes one column and nothing else**, and **returns the row
  count** so the caller can report a shortfall instead of inventing a success. Verified against a stub
  that under-reports: it surfaces as an error, not a success toast.
- ⚠️ **`boq_items` gains a lifecycle rather than losing its invariant.** `2026-08-24-boq.sql` makes
  that table append-and-supersede on purpose — it is the client's document, and every claim argument
  turns on what was tendered. A manual builder needs editable lines, and the lazy reading is "so allow
  edits". The distinction that resolves it is **whose document it is yet**: `status='draft'` is
  editable, `status='issued'` is frozen **by a trigger** rather than by every future UI remembering
  to. Both new columns default to today's behaviour, so no existing row changes meaning when the
  migration runs.
- ⚠️ **The importer now creates its revision as a draft and issues it at the end** — the parent_id
  second pass UPDATEs rows the trigger would refuse, and a half-finished import is now visibly a draft
  instead of an `is_current` revision carrying a partial contract sum.
- ⚠️ **PMI proposal revisions are exempt from the lock**, or `pmi.js`'s `removeLine()` breaks. The test
  reads `pmi_id` through `to_jsonb` because `2026-08-25-pmi.sql` may not be applied on a given
  deployment, and a direct reference to a missing column would make the whole migration un-runnable.
- **The Procurement Dashboard's `.data-table` idiom is ported, not copied.** ⚠️ `wpm`'s stylesheet
  hard-codes `#EE3124` / `#f0f0f0` / `#fff` and re-states each under `body.dark-mode`; taking the
  literals would have given this module a table correct in light mode and unreadable in dark. Every
  value is a `--pd-*` token, so dark mode follows for free.

**Four real defects found by rendering rather than reading**, each of which looked fine in the state a
code review would have checked: `th()` called without its sort state (blank tab, and defaulting it
would have made one table's headers reorder the other); `esc()` wrapping its own placeholder markup
(the literal string `<span class="cc-mut">—</span>` on screen); blanks sorting **first** on descending
while ascending looked perfect; and — the one that would have cost data — a `type="number"` cell
reading back `""` for `1,000`, **silently clearing a quantity in a BOQ**.

⚠️ **Not verified signed in, and the migration has not been run.** Until it does, `status` reads absent
→ every revision behaves as issued → the manual builder is simply not offered and the module works
exactly as before.

⚠️ **Five pre-existing undefined pill classes** surfaced by the class audit and deliberately left
(out of scope): `boq-clm`, `ec-basis`, `ec-in`, `ec-rm`, `ec-tot`.

Assets: contracts `module.css` / `module.js` / `boq.js` / `packages.js` → `?v=20260907a`;
`MODULE_V` → `20260907a` (the `modules-grid.js?v=` in `dashboard.html` + `modules.html`, and the
fallback constant).

### 2026-09-04 — Vertical Stacking: combining trades draws the building at level 1

Owner: *"whenever the option of mixing the different trades of a certain tower is chosen, pls
illustrate the vertical stacking in terms of level 1. Bc the zoning of trades may be different and
therefore may cause incoherent data when consolidating the trades."* Correct, and it is arithmetic:
zoning is stored per trade, and a stacking cell is keyed by the zone **value**, so two trades that
both call a zone "Z1" collapse into one cell reporting a single date, percentage and slip over two
different breakdowns. **Per tower** and **Consolidated** now draw at level 1 — the one axis every
trade shares — and say why on the disabled Detail buttons, the toolbar caption and the PDF. Per trade
keeps its full zone/unit depth, and narrowing the chips to a single trade brings the zones back.
Verified by slicing the shipped `_vsDetailNow` out of the file and executing it (22 assertions,
controls included); ⚠️ not verified signed-in. Module only. `MODULE_V` → `20260904g`.
⚠️ Also carried in this commit, already in the working tree and **authored by a concurrent session,
unreviewed by me**: 305 lines of the slice-3 "Adopt from the WBS" work, wired to no button and so
currently unreachable.

### 2026-09-04 — The WBS matcher's cold open: it now reads the project's saved setup

Owner: *"fix the cold open gap."* The gap flagged in the entry below — the catalogue of places was
empty until the Schedule Setup tab had loaded a setup, which is exactly the case it exists for (import
a schedule, then match its WBS). `ScheduleBuilder.locCatalogueFor(projectId)` now reads the saved
`schedule_builder` row and derives the places from it. ⚠️ It never loads that setup into the builder —
nothing is assigned to `cfg`, nothing renders, no staged import is disturbed — and the **open setup
wins**, so a half-built setup for one package is never offered another package's floors. Not awaited:
the modal opens instantly and the places fill in. Module only. `MODULE_V` → `20260904e`.

### 2026-09-04 — The WBS matcher now offers the places the Schedule Setup already defines

Owner: *"build slice 2 first, then slice 1."* Slices 2 and 1 of yesterday's proposal, shipped —
`ScheduleBuilder.locCatalogue()` derives the project's places from the setup it already holds, and the
Location wizard's **value box** offers them instead of being blank free text. A migrated schedule was
previously re-typed branch by branch, and every typo (`2ND FLOOR` vs `2nd Floor`) became a second
floor in the stacking. ⚠️ Nothing is stored, nothing is rewritten: no new table, no new format, the
`location` jsonb keeps storing **strings**, the free-text box stays, and a project whose Schedule
Setup has never been opened this session behaves exactly as before. Module only — see
`modules/project-schedule/CLAUDE.md`. `MODULE_V` → `20260904d`.

### 2026-09-04 — Proposal: define the breakdowns first (a two-pane LBS / ABS step)

Owner’s idea for an earlier Schedule Setup step: locations as a tree on the left (L1 towers, L2
levels, L3 zones, each with its type), activity groupings as a tree on the right, then a stacking
preview — *"to mitigate the difficulty of the matching of WBS especially when a schedule is
migrated"*, and *"no logic whatsoever should be conflicted."*

Written up as **`docs/lbs-abs-setup-step-proposal.md`**, companion to the existing
`wbs-activity-tagging-proposal.md`. **Nothing implemented** — this is a new authoring surface over
three data shapes that never met, in a module that took fifteen fixes today; the design is the
deliverable and the code follows once §7 is answered. ⚠️ The constraint is answered clause by clause in
§3: the step is an authoring surface over data that already exists, nothing downstream learns a new
format, per-trade zoning is kept, and the `location` jsonb keeps storing **strings, not node ids**.
35 checks — on the document: every identifier and claim it makes is asserted against the shipped
source. ⚠️ `MODULE_V` not bumped; no application file changed.

---

### 2026-09-04 (c) — The trade selector leads, BL and ACT are told apart, and the baseline has a name

*"pls put the trade on the top, also can you emphasize which is the actual and which is the baseline ...
pls indicate if it is BL0 or maybe another current baseline."*

**(1)** The trade chips sat below the whole toolbar — under the view controls, the legend and the
activity count — so the control deciding what is on screen was the last thing before the buildings.
It is now the first row. **(2)** The compare cell tagged its rows **P** and **A** in the same weight and
ink; they are now **BL** (muted) and **ACT** (bold), so the difference carries the meaning and survives
a greyscale print. "P" for planned was also the wrong word — the figure comes from the baseline
columns. **(3)** Those columns hold whichever baseline was last *Set primary*, and the screen never said
which. New `blPrimaryLabel()` names it in the basis label, the legend and the PDF meta.

⚠️ The NAME is the label — baselines here are user-named and there is no numbering scheme, so no
"BL1" is invented; **BL0** stays the fallback, which is what this module already calls the `bl_*`
columns when nothing is recorded. ⚠️ The fetch is tolerant: no migration or no primary set → BL0 and
nothing else changes. 467 checks, 0 functions lost. `MODULE_V` → `20260904c`.

---

### 2026-09-04 (b) — "This IS a place" is now as durable as "this is not"

*"do i need to press anything for the substructure level to be detected?"* Yes —
**Apply to activities** in *Match WBS to locations*. And a gap in yesterday's fix meant that on some
projects even that would not have been enough: the veto read the planner's assignment from
`location_levels.match`, a DB column behind a migration the wizard is deliberately tolerant of
missing (*"the values are still applied, only the memory is lost"*). So the answer was applied to every
activity and forgotten a line later, and the stacking vetoed it again.

Two halves of one decision were stored with different durability — grouping-only in localStorage, the
assignment only in the DB. `saveLocAssigned` now mirrors assignments beside the exclusions, with
the DB column still primary. ⚠️ Values not seen this session are carried forward, as the exclusions are.
⚠️ Grouping-only still beats an assignment, and an **unassigned** "Substructure" is still vetoed — the
default is unchanged. 436 checks, 0 functions lost. `MODULE_V` → `20260904b`.

---

### 2026-09-04 (a) — A basement that always landed in Tower 1, and a tagged location the stacking refused

**(1)** *"when i click add basement, it always adds to tower 1 even if i selected another tower."* The
line above it in the source says why: `+ Add floor` writes `towerId: _twAct` and `+ Basement`
wrote no `towerId` at all, so `towerIdOf()` fell back to the first tower every time. The count
was unscoped for the same reason (B1 into Tower 3 came out "B3"). Both now match the floor handler.

**(2)** *"how come the substructure even though it is tagged as a location, is not being detected in the
vertical stacking."* Because the heuristic reads *Substructure* as a structural-works term and vetoes
it — the right **default**, but not a verdict: on AVR101 the planner filed that branch under Level (L2)
with 133 activities. New `_vsAssignedSet()` reads the values out of `location_levels.match`, and
an explicit assignment now beats the heuristic. ⚠️ Grouping-only still wins over both, and an
**unassigned** "Substructure" is still vetoed — the default is unchanged. ⚠️ Branches matched before
this need *Apply to activities* re-run. 428 checks, 0 functions lost. `MODULE_V` → `20260904a`.

---

### 2026-09-04 — The module icon comes out of the top bar entirely; a dropdown icon stops being baked into its button

Owner sent two annotated screenshots of Issues & Concerns' topbar: *"1. remove this icon in issues
slide as in first photo, crossed out. no module logo is allowed in this top bar across all modules.
2. in second photo, see the box in red. keep this logo across all modules. but do not include this
inside the dropdown selector. keep it to the left of it as a separate icon."*

Both photos show the SAME icon in two different places — the outcome of two separate,
already-shipped changes from the day before, now reversed/redone:

**1. `initModuleTopbar()` (ui.js) no longer pulls a module's icon into the top identity row.**
A 2026-09-02 pass had it extract `[class$="-title-ico"]` out of whatever landed in `.pd-modulebar`
(a module's `<h1>`, or a title-switch button like Project Schedule's) and pair it with the project
dropdown in `.pd-tb-main` via a new `.pd-tb-projgroup` wrapper — exactly the icon photo 1 crosses
out. That extraction (and the `.pd-tb-mark`/`.pd-tb-projgroup` CSS built for it) is removed outright.
⚠️ The top row goes back to being the four fixed chrome controls only (sidebar toggle · project
dropdown · theme toggle · avatar) — a module's own icon simply stays wherever it already sits inside
`.pd-modulebar`, which is where the fix below picks it up.

**2. `UI.tabsToDropdown()`'s `opts.icon` is now a SEPARATE sibling element, never baked into the
trigger's `innerHTML`.** A 2026-09-03 pass (the very next day, by the same concurrent thread) had
fused it into `trig.innerHTML` specifically to dodge a mobile problem: a genuinely separate `<h1>`
sitting beside the trigger would claim its own full-width row on a phone once emptied of its now-
redundant text (`.pd-h1-hasdrop`), the "orphaned icon row" issues-lessons had already been bitten by
once. ⚠️ Solved here differently, so both asks can be satisfied at once: the icon is still a real,
separate `<span class="pd-tabsdrop-ico">` — inserted via `wrap.insertBefore(ico, trig)`, never
written into the button's markup — but it lives INSIDE `.pd-tabsdrop` (a sibling of the trigger, not
of `.pd-modulebar`'s own top-level children). `.pd-tabsdrop` is now a flex row itself (`display:flex;
align-items:center; gap:6px`), and since IT is what takes the whole row on a phone
(`.pd-tabsdrop{flex:1 1 100%}`), the icon rides along with the trigger on that one row rather than
ever getting a row of its own. `.pd-tabsdrop-btn`'s mobile rule changed from `width:100%` to
`flex:1 1 auto; width:auto` so it fills what's left after the icon instead of overflowing it.

⚠️ **A real bug found while verifying, not by reading the code:** `Icons.hydrate(el)` looks for
`[data-ico]` among `el`'s DESCENDANTS — it never checks `el` itself — so the first cut's
`Icons.hydrate(ico)` was a silent no-op and shipped an empty, unhydrated icon span. Fixed by
hydrating `wrap` (the icon's parent) instead.

⚠️ **Only 2 of the 6 `tabsToDropdown()` callers pass `opts.icon`** (issues-lessons: its own `<h1>` is
permanently `display:none`d by `switchScreen()`, on every screen, by design; progress-photos: it has
no standalone `<h1>` at all, dropped on an earlier owner ask) — those two get the new separate icon.
The other four (risk-register, stakeholder-map, contracts-claims, minutes-of-meeting) call it with no
icon option at all: their own `<h1>`'s icon, once no longer extracted to the top row, naturally rides
beside the dropdown trigger as a sibling top-level child of `.pd-modulebar` — same visual outcome,
reached without touching those four modules at all. Project Schedule's own `.ps-title-btn` (a
title-switch button, not a `tabsToDropdown()` conversion) is untouched — its icon has always been
baked into that button by design, a different, older pattern the owner's screenshots don't target.

**Verified in a real browser** (Playwright against a stub-auth harness, so `.pd-tb-main` and
`.pd-modulebar` render before any login round-trip resolves) across issues-lessons, progress-photos,
minutes-of-meeting, risk-register and project-schedule: **zero icons in `.pd-tb-main` on every one of
the five** (only sidebar-toggle / project-select / theme-toggle present); issues-lessons and
progress-photos each render exactly one fully-hydrated `.pd-tabsdrop-ico` (16px svg) as a genuine DOM
sibling immediately before `.pd-tabsdrop-btn`, never inside its `innerHTML`; minutes-of-meeting and
risk-register render zero `.pd-tabsdrop-ico` (their own `<h1>` icon is the one visible icon,
unchanged); Project Schedule's `#ps-title-btn` keeps its `ganttChart` icon baked in, inside
`.pd-modulebar`, with zero icons in `.pd-tb-main`. `node --check` on `ui.js`; `dashboard.css` brace
count unchanged in shape (458/458 open/close); grepped for stray references to the removed
`.pd-tb-mark`/`.pd-tb-projgroup` classes and the old `icoHtml` variable — none left.
⚠️ **Not verified signed in** — the harness stubs `AppAuth.requireLogin` to never resolve, so it
covers the pre-login DOM state only; issues-lessons' `switchScreen()` (which force-hides its `<h1>`
on real init, leaving the new separate icon as the sole visible one) was confirmed by reading the
shipped function, not by driving a real login.

Shared assets changed → **`ui.js?v=` bumped `20260902c` → `20260904a` across all 21 referencing HTML
files; `dashboard.css?v=` bumped `20260903b` → `20260904a` across all 29 referencing HTML files** —
both were single, consistent versions before this change, confirmed and re-confirmed after.

### 2026-09-03 (v) — A Schedule Setup edit reached the database and six stale memos

*"when i edit the WBS tree and matched the WBS to the locations etc in the schedule setup, how come i
think the project schedule is not updated."* Because it was not — the write landed, the reader never
heard.

Both tabs are one page, and the schedule resolves phase, trade, contract scope, the stacking axis, the
grouping veto and the dim→level map through **caches**. Match-WBS cleared one of them; **Fill from the
WBS tree, the LBS editor and every WBS tree edit cleared none**. So a re-filed branch or a re-matched
location showed the pre-edit answer with no error. Sharpest case: `_nodeTrade` memoises the branch
NAME, so renaming a WBS branch left every activity under it on the old trade.

Two keys also could not see a rename: the dim→level map is resolved **by name** but was keyed on ids
alone, and the grouping veto was keyed on a level **count**. Both now carry names. New
`psSetupChanged()` clears all six memos and repaints everything including the Vertical Stacking,
which `renderAll` has never drawn — wired into all ten write sites, one function rather than a
fifth copy of a list. 402 checks, 0 functions lost. `MODULE_V` → `20260903v`.

---

### 2026-09-03 (u) — A conditional-format fill now tints a dark row instead of repainting it

*"still not fixed ... why is there light colors?"*

⚠️ The previous fix answered a different question: it made the text on those rows **readable** (dark ink
on the pale fill), which was right for *"I cannot read this"* and irrelevant to *"why is this light"*.

A format fill is a **light-mode colour** (the default `#FDECEA` is a pale cream) and it was painted
literally on any theme — there were **zero** dark-mode rules for `.ps-fmt`. In dark mode it now blends
into the row's own dark surface at 22%, keeping the hue the planner chose while the row stays part of a
dark grid; the ink returns to the theme's. ⚠️ Light mode is untouched byte for byte. ⚠️ The plain
background is declared first, so a browser without `color-mix` keeps a correct dark row rather than a
light block. ⚠️ The frozen columns are tinted too, or they would stay light while the row went dark.
365 checks — the cascade is parsed and proven (specificity 401 vs 200, fallback ordering, light mode
byte-identical, selection still wins), not eyeballed. `MODULE_V` → `20260903u`.

---

### 2026-09-03 (t) — A formatted row you could not read, and a header chopped into syllables

*"UI issues here."* Two, from one screenshot.

**(1)** `_fmtStyleStr` emitted `--fmt-fg` only when a conditional-format rule NAMED a text
colour, and the CSS falls back to `color:inherit`. The default fill is `#FDECEA`, a pale cream —
so in dark mode the row got a light background and kept near-white text, and **every rule added without
opening the Text swatch was unreadable**. The ink is now derived from the fill's luminance, the same
rule the stacking uses for text on a coloured cell. ⚠️ An explicit colour still wins, always.

**(2)** `word-break:break-word` on header cells chopped single words anywhere, rendering the
Activity ID header as *"AC / TIV / ITY / ID"*. Headers now break **between words only**; a word wider
than its column overflows and clips, which is legible for its first characters where four fragments are
legible for none. Wrapping itself is unchanged. 345 checks, 0 functions lost.
`MODULE_V` → `20260903t`.

---

### 2026-09-03 (s) — The stacking PDF stretched every building to the page width

*"for the conversion to PDF, make it more compact. look at this it is too big."* — a four-cell card
filling an A4 sheet, 4 sheets for the report.

One CSS declaration: the cloned building SVG was given `width:100%`, stretching every building to
the full content width whatever its size — and the height follows the aspect ratio, so a small card grew
just as tall. New `_pdfSize()` prints at natural size (1 viewBox unit = 1px at 96dpi), shrinking
only when it does not fit: the reported 260×190 card goes from ~a full sheet to **68.8 × 50.3 mm, three
per sheet**, while a wider-than-page building is still capped exactly as before. ⚠️ Height is capped at
one page too, so a tall tower prints narrow rather than clipped — `break-inside:avoid` is kept,
because a building is only readable whole. ⚠️ A missing/unparseable viewBox falls back to the old
behaviour. Page furniture tightened to match (body 13→11.5px, card margin 16→9px, page margin 12→10mm).
317 checks, 0 functions lost. `MODULE_V` → `20260903s`.

---

### 2026-09-03 (r) — The chunky shell converged on the PRC app's own values

Owner: *"Can you copy the formatting and css from prc-app to the planning-app. The prc-app looks more
minimalist compared to the chunky planning-app."* One file changed — `assets/css/dashboard.css` — and
every value below was **read out of `prc-app/assets/css/dashboard.css` and matched, not invented**.

- ⚠️ **What actually read as "chunky" was the SHAPE SCALE, not any one component.** The file carried a
  single `--pd-radius: 4px` plus six ad-hoc radii picked per component (4/8/9/10/12/14) and one
  hardcoded shadow, so nothing agreed with anything. It now carries PRC's own scale one-for-one —
  `--pd-radius`/`-md`/`-lg`/`-xl` (4/8/12/16) and `--pd-shadow`/`-md`/`-lg` — with the dark-mode block
  remapping the two new shadow rungs. **Reach for a rung, never a fresh literal.**
- **Matched to PRC exactly, measured rather than eyeballed:** `.pd-main` padding
  `22px` → **`20px 24px 48px`** (= `.content`); `.pd-kpi` **`16px 18px` / r12** (= `.metric-card`);
  `.pd-kpi-label` **10px/700** (= `.metric-label`); `.pd-kpi-value` **20px/800** (= `.metric-value`);
  `.pd-sec-head h3` **11px/700 uppercase tracked muted** (= `.panel-title`); `.pd-module-card`
  **18px / r12** (= `.panel`); the module grid gap **20px → 14px** (= `.grid-2`/`.grid-3`/
  `.project-cards`); `.pd-table th` **11px/700, `9px 10px`, 2px bottom rule** (= `.data-table th`).
- ⚠️ **Some values had to move UP, which is the opposite of what "minimalist" suggests.** The
  2026-09-01 pass had already lightened the tables and weights and in places went PAST PRC — PRC keeps
  **700** on `.metric-label`/`.data-table th` and **800** on `.metric-value`. So `.pd-kpi-value` went
  18px/700 → 20px/800 and the table header 500 → 700. The pre-existing ⚠️ comment on `.pd-kpi-value`
  explaining that earlier reduction was **extended, not deleted** — it records a deliberate choice this
  pass reverses, and deleting it would leave the next reader with no idea why.
- ⚠️ **The lift is gone from both card hovers, deliberately.** PRC marks a clickable tile with a **3px
  bottom bar that wipes in from the left** and no `translateY`. On a 12-tile module grid a lift is the
  single chunkiest bit of motion on the page. `.pd-module-card`'s old LEFT 4px accent (toggled by
  `opacity`) and `.pd-proj-card`'s `translateY(-2px)` are both replaced by that wipe. **Do not put the
  translate back.**
- ⚠️ **`.pd-kpi` gained PRC's permanent 4px left accent** (`.metric-card::before`) — it is what makes a
  stat card read as a stat card rather than an empty box, and `.pd-kpi-label` gained a `min-height:26px`
  so a one-line and a two-line label still line their VALUES up across the row.
- ⚠️ **Three self-inflicted regressions, all caught by measuring after the fact.** (1) Tightening the
  desktop base left the **responsive overrides pointing the wrong way** — `@media(max-width:1024px)`
  still set a module-grid gap of 16px, now LARGER than the new 14px desktop base (→ 12px; the 420px
  card/icon/heading values were tightened below the new base too). (2) A **hierarchy inversion I
  created**: with the tile title down to 14px, `.pd-module-figs .pd-fig b` at 15px/700 outweighed it
  (→ figs 11.5px, bold 13px). (3) A **duplicate `.pd-table th` selector** left behind when adding
  PRC's 9px header padding, consolidated away.
- **Deliberately NOT done, each for a stated reason:** the ~30 remaining small-chrome radii (menus,
  toasts, modals, chips, pills at 3/5/6/7/9/10/11/14/20px) were **not** blanket-folded onto the scale —
  pure diff noise with no visual effect, and PRC itself uses 8/10/20px for the equivalent chrome; the
  token comment carries the guidance instead. **Type sizing stays in px** (PRC is rem at a 87.5% root)
  — converting ~1,000 declarations is a large blast radius and is not a formatting pass.
  `.pd-tabbar`/`.pd-tab` stays an **underline bar**; PRC's pill segment group is a different component,
  not a formatting difference.
- **Verified:** brace balance **453/453**, **0 NUL bytes**, and all eight numeric convergence checks
  above read identical to PRC's own computed values, taken with `getComputedStyle` in a real browser
  against each app's shipped stylesheet at 1440px. Before/after/reference screenshots compared.
  ⚠️ **A Chromium artefact cost a pass:** `fullPage: true` renders a `position:sticky; height:100vh`
  sidebar at ~14px wide — the CSS was correct (240px, measured); shoot **viewport-only**.
  ⚠️ The offline `@import` of Montserrat fails in both harnesses, so both fell back to a system sans —
  symmetric, so the comparison holds, but the type is not the shipped face.
  ⚠️ **Not verified signed in**, and no module page was opened — this is a shared-stylesheet change and
  every module's own `module.css` loads AFTER it, so a module rule at equal specificity still wins on
  source order.
- Both throwaway harnesses were **deleted before committing** (`_scratch_harness.html`, git-ignored) —
  this repo has shipped harness files to production twice.

Shared asset changed → **`dashboard.css?v=` bumped `20260903a` → `20260903b` across all 29 referencing
pages**, 0 stragglers and 0 unversioned references. **No `MODULE_V` bump** — no module `index.html`
changed structurally.

⚠️ **Merged onto `origin/main` (26 commits ahead) before this landed.** Three conflicts,
all of the shape this file has recorded before: **two were cache-bust version collisions**
(`issues-lessons`, `minutes-of-meeting` — main bumped their `module.css?v=` to `20260903d` while
this side bumped `dashboard.css?v=` in the same two lines), resolved as the **union**, hunk by hunk.
⚠️ `git checkout --theirs` is the wrong tool for a version collision — it takes main's WHOLE file
and drops your own non-conflicting edits in it. The third was `CLAUDE.md`, where both sides prepend
→ **both kept whole, seam marked, and this entry re-lettered `(b)` → `(r)`** because main had
already used `(b)` twice on 2026-09-03 and had run as far as `(q)`.

⚠️ **`MODULE_V` → `20260903r` after all** (main had it at `20260903q`), which reverses the call
above: every module `index.html` DID change — its `dashboard.css?v=` line — and a module page is
cached under `index.html?v=MODULE_V`, so without the bump a returning browser keeps serving a page
that still requests `?v=20260903a` and the new stylesheet reaches nobody. That is this repo's own
most-repeated deploy failure, one level up.

<!-- seam: the entry above landed from `claude/planning-app-prc-styling-0zvvo4`; everything
     below came from `origin/main` in the same merge. Both sides prepend, so both are whole. -->

### 2026-09-03 (q) — An un-floored trade is still in the building, so it carries the tower

*"if there is no floors or zones under a trade ... if it is still under tower 1, then it is under tower
1."* Right — "no floors" says nothing about which building the work is in.

The `__all__` fallback (which stops a whole discipline being dropped from a push) left `towerId`
unset, so those activities were the only ones in the project with a blank Tower: the stacking's
no-tower bucket, and beside the tower branches rather than inside them. It now resolves its tower
through `towerIdOf` — the same resolver every real floor uses, which falls back to the first tower
for a floor naming none. ⚠️ A single-tower project resolves unambiguously; a multi-tower one lands on
the first, exactly as an un-towered floor already does (give the trade floors in step 5 to say
otherwise). ⚠️ The floor stays `_all` — this adds the tower, it does not invent a storey, zone or
unit, and no tower name is hard-coded. 291 checks, 0 functions lost. `MODULE_V` → `20260903q`.

---

### 2026-09-03 (p) — A single tower is not a WBS level, and that is why Allied Services sat beside it

*"why is there tower 1? if it is just a singular tower, the tower 1 should not be a WBS anymore."* Right
— a level with one branch carries no information and pushes the whole tree down a level.

⚠️ **The gate is back after I removed it this morning, and that removal was the wrong fix.** The
complaint then was that the dialog promised five levels and built four; the fault was the DIALOG lying,
not the tree. So `multiTower()` gates the tower dim again, and the dialog now dims a
ticked-but-skipped Tower row with *"skipped — this project has one tower"*, excludes it from the
*"N-level WBS"* line, and uses the **same predicate the push uses** rather than a copy. Ticking it is
still remembered: add a second tower and it builds.

That also answers *"how come the allied services is not under tower 1?"* — a trade with no floors gets
the `__all__` location, which carries no `towerId`, so it could never be filed under a tower and
sat beside it. With no tower branch it now sits with the other trades. ⚠️ On a genuinely multi-tower
project it still sits beside the towers, deliberately: it spans them, and filing it under Tower 1 would
invent a fact. The grid's grouping follows the same rule. 276 checks, 0 functions lost.
`MODULE_V` → `20260903p`.

---

### 2026-09-03 (n) — The WBS default comes from the Schedule Setup, and it leads with the Tower

*"the WBS tree default should be matched with what was defined in the schedule setup"* and *"it should
be tower and then trades bc that's the way it should be as a default."*

**(1)** The default structure is now **Tower → Trade → Level → Zone → Unit**. A tower is a place and a
trade is work done in it, so the place leads; the old default led with Trade and filed every tower under
every discipline. Changed in `blank().wbsOrder` **and** `WBS_DIMS` (the order a missing dim is
appended in), so the two stay in step. ⚠️ A **saved** setup keeps its own order — OPW101 included;
reorder it with the ↑/↓ arrows in the push dialog.

**(2)** The grid's default grouping now follows the setup. New `ScheduleBuilder.setupGroupDims()`
translates the setup structure into grid dims (`trade→work`, locations through `locLevelFor`),
offered as a **"Schedule Setup structure"** preset and used as the default. ⚠️ A saved choice always
wins and nothing is written when the setup is adopted, so it stays a default; a dim with no level is
dropped rather than guessed. 270 checks, 0 functions lost. `MODULE_V` → `20260903n`.

---

### 2026-09-03 (m) — The trades did not vanish: they were at L3, and a ticked Tower level was dropped

*"from schedule setup it is okay ... yet in project schedule, the trades vanished?"* Two things, and
neither is the trades being lost.

**(1)** `dimKey` returned the skip sentinel for the tower whenever `multiTower()` was false, so a
single-tower project silently got **four** levels after the dialog promised **five** — the ticked Tower
never appeared and the tree started at the floors. A ticked level is now built; the tick box is the
planner deciding, and a count must not overrule it. (Same rule as *"no defined number of towers means a
singular tower"*.) A row with genuinely no tower id still skips the level.

**(2)** The trades were built — one level under every floor, because this project ticked
**Tower → Level → Trade → Zone → Unit** and Trade is third. Drag Trade to the top and the trade branches
sit directly under the Execution Phase. ⚠️ That order was likely chosen while the labels were still
wrong (fixed in `k`), so the list was being reordered against fiction. The dialog now also names
what will sit at the top of the tree. 244 checks, 0 functions lost. `MODULE_V` → `20260903m`.

---

### 2026-09-03 (k) — The push wrote every location one level too high

*"it detected the levels as the towers, and the zones as levels"*, and *"Tower > Tower > Trade > Level
> Zone > Unit"*. One hard-coded assumption in two places: the label lookup AND the value writer mapped
`floor→LOC_LEVELS[0], zone→[1], unit→[2]`, which is only true for the *Floor › Zone › Unit*
breakdown the push itself seeds. OPW101 reads **Tower › Level › Zone › Unit**, so floor resolved to
Tower, zone to Level, unit to Zone — the doubled word in the editor, and, far worse, every push
stamping floor names into the **Tower** column. The stacking then faithfully drew zones as storeys.

New `locLevelFor(dim)` resolves each dim by NAME family, then one forward sweep that can only move
deeper; a dim with no level writes nothing. ⚠️ **The tower is claimed by name only, never by position**
— a breakdown with no tower level IS the single-tower case (my first attempt let it swallow a nameless
level and the harness caught it). Multiple towers were already supported and are untouched
(`cfg.towers`, **+ Tower**, and `multiTower()` gating the WBS level). ⚠️ General Requirements and
Site Works verify as present — nothing changed there. ⚠️ This fixes what the push WRITES; rows already
stamped wrong need a re-push. 231 checks, 0 functions lost. `MODULE_V` → `20260903k`.

---

### 2026-09-03 (j) — The Schedule Setup push carried a construction sequence where the building order belonged

*"fix the migration from schedule setup to project schedule, the trades are not properly arranged, the
floors are not properly arranged also."*

`buildTree` created one WBS branch per group in **first-seen** order, and only the trade dim was ever
sorted. Floors, zones, units and towers therefore came out in the order their work STARTS —
`generate()` sequences by date, so that is a construction sequence, not a building. Executing the
shipped code over a five-floor tower whose fit-out starts high: **before**
`5TH, 2ND, Ground, B1, B2` — **after** `B2, B1, Ground, 2ND, 5TH`. On a straight bottom-up push
the old order looked right only by coincidence.

New `dimOrderIndex` sorts every dim by the order the setup already defines and the builder already
reads: floors from `cfg.zoning[trade].floors`, zones from `floor.zones`, units from
`zone.units`, towers from `cfg.towers`, trades from `GROUPS` (unchanged). ⚠️ Unknown values
sort last, never first; ties are stable; the "no value at this level" sentinel is never reordered, so a
single-tower push still skips the tower level. ⚠️ The trade dim was ALREADY GROUPS-sorted — if trades
still read wrong, the intended rule is the step-8 Trade sequence, and I have not switched to it on a
guess. ⚠️ Not verified signed-in. 179 checks, 0 functions lost. `MODULE_V` → `20260903j`.

---

### 2026-09-03 (i) — Contracts & Claims unhidden, sidebar active state un-bolded, Schedule gets a Gantt icon, the module-name flash fixed, project selector goes bold+coded

Five owner items across two messages.

**1. Contracts & Claims unhidden.** Owner: *"please unhide contracts and claims register for all."*
`superAdminOnly: true` removed from its `config.js` entry (the other six from the 2026-09-03 (b)
pass — Risk Register, Stakeholder Map, Manpower/Equipment Loading, Productivity Rates, Cash Flow —
stay hidden). Portfolio Overview's matching tab-hiding list (that page's own static `.po-tabs`, not
built off `APP_CONFIG.MODULES`, so it needed its own list) drops `'contracts'` from the five it
still hides for everyone but `super_admin`.

**2. Sidebar active row: red box only, no extra bold.** Owner: *"once clicked, no need to make the
module text bold. keep at regular, red box is enough to highlight."* `.pd-sidebar nav a.active`
dropped its `font-weight: 600` — the active row now inherits the same 500 every other nav row uses;
only the red background changes.

**3. Project Schedule gets its own icon.** Owner: *"change icon to a gantt chart icon."* It shared
`calendar` with Minutes of Meeting. New `ganttChart` glyph in `icons.js` (three staggered bars, the
generic "Gantt chart" shape) — `config.js`'s `project-schedule` entry and the module's own
`.ps-title-btn` icon (`#ps-title-btn`, index.html) both switched to it. The module's *other*
`calendar` icons (Open schedule, the Month/Quarter/Year zoom button, duration-scenario menu items)
are genuinely date-pickers, not the module's identity mark, and were left alone.

**4. The module-name flash, root-caused and fixed — and a near-miss found while fixing it.** Owner:
*"when clicking a module, the module name sometimes appears for a few seconds before being
hidden."* Six modules (issues-lessons, minutes-of-meeting, progress-photos, risk-register,
stakeholder-map, contracts-claims) call `UI.tabsToDropdown(...)` to turn a flat tab row into a
Project-Schedule-style dropdown — but every one of them called it from *inside*
`AppAuth.requireLogin`'s callback, which only fires after **two real network round-trips**
(`auth.getSession()` + a profile fetch). Until that resolved, the raw `<h1>` title text AND the flat
tab-button row both sat fully visible with nothing to convert them — exactly the reported flash,
confirmed by simulating a 3s-delayed `requireLogin` in a real browser and sampling the DOM mid-delay.
- ⚠️ **The obvious fix — call it immediately, at the top of each module's script — was tried first
  and it CRASHED.** `tabsToDropdown()` needs `UI.initModuleTopbar()` to have already moved the tab
  strip into `.pd-modulebar`, so an early call defensively re-invoked `initModuleTopbar()` too
  (it's idempotent, guarded by its own `.pd-tb-main` existence check) — but that broke
  **`theme.js`'s own topbar injection**, which does `topbar.insertBefore(btn,
  topbar.querySelector('#user-bar'))` and silently assumes `#user-bar` is still a **direct child**
  of `.pd-topbar` when it runs. `initModuleTopbar()` moves `#user-bar` into the nested
  `.pd-tb-main`, so calling it before theme.js's own (DOMContentLoaded-bound) injection throws
  `NotFoundError: the node before which the new node is to be inserted is not a child of this node`
  — silently, since nothing in these pages listens for `pageerror`. Confirmed the crash was mine,
  not pre-existing, by running the same slow-auth simulation against the untouched `origin/main`
  copy first (no crash there).
- ⚠️ **The real fix: don't reorder anything — add a THIRD `DOMContentLoaded` listener.** theme.js's
  script tag loads first (in `<head>`), so its listener registers first and its injection runs
  before ui.js's own `initModuleTopbar()` listener (registered when ui.js loads, later) — an
  existing, working, implicit ordering guarantee neither file states out loud. Each fix is now
  `if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else
  go();` — the exact pattern theme.js/ui.js already use — with NO explicit
  `initModuleTopbar()` call. Registered last, it fires after both of theirs, preserving the order
  they need, while landing well before `requireLogin`'s network-bound callback (which is the whole
  point). minutes-of-meeting's `module.js` still calls `tabsToDropdown` a second time from its own
  `wire()` — harmless, guarded by the function's own `tabs.__pdTabsDrop` idempotency check.
- **Verified**: driven in a real browser with `requireLogin` stubbed to resolve after 3s — at
  500ms (well inside the old flash window) all six modules show **0 page errors**, the raw tab row
  already hidden, and the dropdown trigger already built and showing the right label. The theme
  toggle still renders correctly at the settled state.

**5. Project selector: bold code+name, code added to the dropdown rows.** Two asks: *"make project
code and project name in project selector bold. leave address and group head regular text"* and
*"in project selector dropdown, add project code before project name."*
- ⚠️ **The trigger button already wrapped "CODE — Name" in `<strong>`, but a same-day earlier
  "minimalist" pass (`d85311f`, unrelated to this session) had neutralized it to `font-weight: 500`**
  — barely distinguishable from the address/group-head subtitle below it (400). Both trigger
  components — `enhanceProjectSelect`'s `.pd-psel-btn .pd-psel-txt strong` and `renderSwitcher`'s
  `.pd-projsw-txt strong` — bumped to `700`; the subtitle (`small`, 400) and the placeholder state
  (`.pd-psel-ph strong`, still 400) are untouched.
  - The **open dropdown's own project rows** (`navListBody`'s `projRow`, in `assets/js/ui.js`) had
  neither the code nor any bold at all — just the bare name. They now read "CODE — Name" in the same
  bold (700), with an address/group-head subtitle in regular (400) beneath — mirroring the trigger's
  own two-line shape rather than inventing a third. ⚠️ The code needs no lookup (`p.id` **is** the
  code, the PK); the subtitle reuses the exact `[location, gh && 'Group Head: '+gh.name].join(' · ')`
  construction `enhanceProjectSelect`'s own `subFor()` already used, just inlined since `projRow`
  already has the project object and group-heads array in scope. A project with neither field
  correctly renders no `<small>` at all (no empty dangling element). `.pd-nt-proj` went from a
  single-line `align-items:center` row to `flex-start` with a stacked `.pd-nt-proj-txt` block (icon
  nudged 2px down to sit level with the first line, not the two-line midpoint); the selected row's
  subtitle gets the same `rgba(255,255,255,.82)` treatment the sidebar's own active-row subtitle
  already uses, so it stays legible on the red background.
- **Verified**: both trigger components and the dropdown-row markup rendered in a real browser
  against the shipped CSS — `strong` computes to `700` in all three places, `small` to `400`, a
  project missing location/group-head shows no subtitle, and the selected row's subtitle is legible
  against the red fill.

Files: `assets/js/config.js`, `assets/js/icons.js`, `assets/js/ui.js`, `assets/css/dashboard.css`,
`modules/portfolio-overview/index.html`, `modules/project-schedule/index.html`, and the six modules'
own `index.html` from item 4. Verified: `node --check` on every touched `.js` file; every touched
`index.html`'s inline `<script>` parses (progress-photos' own extraction reports the same
pre-existing false positive documented in the 2026-09-03 (b) entry — a CDN `src` URL containing the
literal substring `build/three.min.js`, confirmed byte-identical against `origin/main`); CSS
brace-balance holds (454/454); 0 duplicate DOM ids in any touched page (project-schedule's own
`grep` hits are all pre-existing dynamically-templated ids from its list renderers, unrelated to
this change). ⚠️ **Not verified signed in** — this environment has no live Supabase login; every
claim above is a real Playwright render against the shipped files with auth/DB stubbed.

### 2026-09-03 (h) — The stacking crash, named: a `var` read twenty lines before it was assigned

*"still blank after hard refresh, there is an error message shown"* — **Cannot read properties of
undefined (reading '0')**. And: *"the previous versions are okay, how come this changed now."*

In `renderVStack`, `var _axLvls = _vsAxis();` sat ~20 lines BELOW the loop that reads
`_axLvls[0]`. A `var` is hoisted but its assignment is not, so `undefined[0]` threw. It
only fires on projects where activities have no level — OPW101 has no location breakdown, so all 2,665
qualify and it threw on the first. **Not from this week's work:** bisected to **f8fc2e2** (today,
*"a WBS branch is a place (LBS) or a grouping"*), which added the reader without moving the
declaration up. Every commit before it is clean, which is exactly why older versions worked.

Declaration moved above its first reader; the one unguarded `_axLvls[0].id` of four is now guarded.
⚠️ The crash is **reproduced** in verification: HEAD throws the owner's exact message, the fix does not,
and moving the declaration back re-introduces it. ⚠️ The previous round's `_vsRenderSafe` repaired
nothing — it made the pane name its failure instead of going blank, and that is what made this
diagnosable at all. ⚠️ Still open: OPW101 shows duplicate phase roots (Initiation / Execution / Planning
twice each); the lifecycle-branch filing is fixed, the duplicates are not. 167 checks, 0 functions lost.
`MODULE_V` → `20260903h`.

---

### 2026-09-03 (g) — A blank stacking pane, a breakdown fetched once, and the `is_locked` that hid the mis-phased branches

Three reports on OPW101 / SLN101:

1. *"the vertical stacking is not shown even if it is already under execution phase"* — a completely
   blank panel, not even an empty-state message. Every branch of `renderVStack` writes
   `innerHTML`, so nothing on screen means it **threw**, and it threw invisibly because the
   toggle called it bare. New `_vsRenderSafe()` turns a blank pane into a named failure with the
   stack in the console and a retry. ⚠️ The underlying throw is not yet identified — the fix makes it
   impossible to hide, not gone.
2. *"still says no location breakdown after full load"* — the breakdown was fetched **once per page
   load** and never re-asked, so a tab that got zero stayed at zero while another tab displayed all
   five levels. Now a named `refreshLocLevels()`, re-run when the stacking opens, with a Check
   again button and a line saying which project id was queried and how many rows came back.
3. *"there are WBS again found under the execution phase that do not belong there"* — **again**,
   because `_wbsHealSkeletonPlacement` only considered `is_locked` candidates, and an
   imported branch is unlocked. Exactly the branches that end up misfiled were the ones it could not
   see. That requirement is gone; every other guard stands.

⚠️ Nothing else was loosened: only skeleton-declared branches move, only into a locked phase root,
only out of the root or another top-level phase (MEPF's own Procurement stays put). ⚠️ The phase memo
is now cleared on a move, or the change would be right in the database and wrong on screen. ⚠️ Not
verified signed-in. 145 slice-and-execute checks. `MODULE_V` → `20260903g`.

---

### 2026-09-03 — Minutes of Meeting UI/UX pass: icon-only chrome, draft-attendee editing, a labelled reporting switcher

Owner's 18-item list across Meetings List / Meetings Dashboard / Individual View /
Reporting View. Full detail (every item, the RLS reasoning for item 4, and the two real
pre-existing bugs found and fixed — a specificity collision that had been undoing the
reporting view's own padding since it shipped, and a rule-fields default that didn't match
the frequency `<select>` it sat under) is in `modules/minutes-of-meeting/CLAUDE.md` —
module-local, since the module contract reserves shared-file edits for the app owner.

**`assets/js/icons.js` — two new icons**, `mail` (the module's new icon-only Email
button) and `chevronLeft` (paired with the existing `chevronRight` for the reporting
view's Back/Next arrow buttons). Shared asset changed → **`icons.js?v=` bumped
`20260902f` → `20260903a` across all 21 referencing HTML files.**

**`migrations/2026-09-03-mom-draft-attendee-edit.sql` (module dev must run this)** — the
one item that touches the database: a meeting's minutes are still editable by any of the
meeting's recorded attendees while the record is a draft, not only by whoever wrote it or
a planner. Distributing (and reverting) a minute stays owner/planner-only regardless —
that RLS narrowing is unchanged, only the field-edit rule widened. Reading has always been
project-wide for every minute, draft or distributed.

<!-- both sides prepended a 2026-09-03 entry; both kept whole, seam here -->

### 2026-09-03 (f) — "No Location Breakdown Structure", on a project that has five

Owner, two tabs of SLN101 side by side: Schedule Setup lists **Tower › Level › Orientation › Zone ›
Cluster**, Vertical Stacking says the project has no breakdown. *"how come that is the error even
though there is a defined location levels"*

Both panes read the same `LOC_LEVELS` global — the difference was **when**. `load()` paints from
cache and renders before `loadResourcesAssignments()` fetches `location_levels`, which on a
16k-activity project is minutes; for all of it the stacking reported an empty array as *"this project
has no Location Breakdown Structure"*, a claim it had no basis for. It also folded a **query error**
into the same message, blaming the planner for a missing migration. New `LOC_LOAD` state gives three
honest answers (loading / could not be read / genuinely none), and — the reason the wrong one stuck —
`renderAll()` **never repaints the stacking**, so the pane was a dead end for the session; the
`location_levels` fetch now repaints it, but only when it is showing an empty state and only on
actual news. Detail in `modules/project-schedule/CLAUDE.md`.

⚠️ The "genuinely none" message is unchanged — it was always right, just said in two cases where it
was false. ⚠️ Known limit, not fixed: a second tab still does not learn about levels created in the
first until it reloads. ⚠️ Not verified signed-in; the cause is inferred from the code path and the
screenshots, not measured on SLN101. 90 slice-and-execute checks. `MODULE_V` → `20260903f`.

---

### 2026-09-03 (e) — A tower is one building, however the WBS spells it

Owner: *"there are scenarios wherein the substructure is separated from the superstructure, so we
need to combine them to create a tower. And there are direct instances wherein tower 1 is defined
including substructure and superstructure combined."*

New `locTowerToken()` gives a building ONE canonical identity, so `Tower 1 - Substructure`,
`SUBSTRUCTURE - TOWER 1`, `TOWER-1 SUPERSTRUCTURE` and a plain `Tower 1` all resolve to **Tower 1**.
Wired into the level guesser (a stage-first name now reaches the Tower level instead of being vetoed
as a trade), the value guesser (the stages combine), and Vertical Stacking's tower read — where it is
**read-time only**, so a project already stamped with two spellings draws one card without a single
row being written. Also: the WBS heal chain merged duplicate branches *after* the two passes that
refuse to run while a duplicate exists, so it took two page loads to converge; the merge now runs
first. Detail in `modules/project-schedule/CLAUDE.md`.

⚠️ `locGroupingReason` is deliberately untouched — a bare `Superstructure` still cannot become a
storey. ⚠️ Nothing is invented: a stage branch with no tower word at all leaves the tower blank rather
than guessing a name. ⚠️ Not verified signed-in (the anon key has no grants); verification is 66
slice-and-execute checks against the shipped functions. `MODULE_V` → `20260903e`.

---

### 2026-09-03 (d) — 16,396 activities under a visibly correct Execution Phase, and the stacking said zero

Owner, with two screenshots of SLN101 (4PH Strevi Bacoor): the grid renders a perfect tree —
**Execution Phase → Construction Phase → Substructure → Tower D → Excavation**, *Total: 16,396
activities* — while Vertical Stacking reads **“0 execution-phase activities stacked.”** *"How come?
even though the schedule is under the execution phase?"* Detail in
`modules/project-schedule/CLAUDE.md`.

⚠️⚠️ **Both screens were telling the truth about different things, and the app had no third source.**
`rebuild()` derives a row's ancestry from its **dotted WBS code** and never reads the node id — that
is why the grid is right. `phaseOf()` resolved **only** through `wbs_node_id → WBS_NODES`, and on this
project those ids are null (the 2026-09-02 (q)/(r) batched-link timeout, and every plain importer,
file activities by dotted code without ever linking them to a node). So all 16,396 answered *"no
phase"*, `isExecPhase()` was false for every one, and **every execution-scoped feature — Vertical
Stacking, Contract Scope, the activity colour key — silently reported an empty project.**

- **`phaseOf` gained the code fallback**, reading the same source the grid trusts: walk the dotted
  code's ancestors nearest-first and take the first branch name that resolves a phase — the identical
  rule `_nodePhase` applies to the tree, applied to the projection of that tree the rows carry.
- ⚠️ **Strictly last.** The row's own `phase` and the node chain both still win, so a healthy linked
  project computes exactly what it computed before — asserted, along with the pre-fix expression
  returning null for all of them, so the suite bites.
- ⚠️ **Read-time only, and it repairs the symptom, not the link.** Nothing is written; the activities
  are still unlinked, and *Schedule Setup → WBS → Adopt existing WBS* is still the real fix. But the
  previously recorded recovery for this state was **a re-import**, i.e. a destructive repair of a
  schedule that is not actually damaged.
- ⚠️ **It cannot sweep other phases into Execution:** a Planning-phase activity's own ancestry names
  Planning Phase, so it resolves to `planning`. Asserted for all four phases plus an orphan code,
  which correctly still has no phase.
- **The empty state now distinguishes the two cases** — *"nothing matches your filters"* vs *"not one
  of this project's N activities resolves ANY phase, so this is not a filter problem"*, measured
  rather than guessed, naming Adopt existing WBS. The old wording is exactly what made a full
  schedule read as an empty one.

**Verified: 10 checks executing the shipped `phaseOf` / `_phaseByCode` / `_nodePhase` / `isExecPhase`**
(sliced from the file) against the tree in the owner's own screenshot; the day's other suites still
green (26 + 14); **0 functions lost / 2 added**; parses; 0 NUL bytes.
⚠️ **Not verified signed in** — the fix is measured against the reported shape, not against the live
project. ⚠️ The owner's tab was on `?v=20260902ab`; **hard-refresh**, since a module page is cached by
its full URL. `MODULE_V` → `20260903d`.

### 2026-09-03 (c) — A WBS branch is a PLACE or a GROUPING, and the stacking now reads only places

Owner: *"for the vertical stacking, it should only read the locations WBS — tower, level, zones,
clusters, units, those are locations WBS. improve the distinction from 'groupings' WBS and 'locations'
WBS. idk what the correct term for 'Location Breakdown' is now."* Detail in
`modules/project-schedule/CLAUDE.md`.

**The term is Location Breakdown Structure (LBS)** — the standard counterpart to the WBS, and exactly
the distinction being asked for: the WBS says *what work*, the LBS says *where*. Relabelled in the
matcher, the Group menu, the Floors & Zones step and the stacking's own empty state.

- **The distinction had no name in the code.** New `locGroupingReason(name)` answers it once and is
  read by the guesser, the wizard and the stacking: a **location** is a place (tower/building, level/
  floor, zone, cluster, unit); a **grouping** is a project phase, a trade or a work type.
- ⚠️ **It is POSITION-AWARE, and it has to be.** Several terms sit in both vocabularies —
  `substructure`/`superstructure` are a Level synonym *and* a Structural Works term — so a flat
  "is it a trade word" test would have thrown away **Tower D - Substructure**, a real tower. The term
  appearing **earliest** wins: `Tower D - Substructure` → location; `Superstructure` (tie) → grouping.
  ⚠️ A tie resolves to grouping deliberately: those are stages of structural work, not storeys.
- **The guesser no longer proposes a trade or a phase as a location** — ⚠️ guess only. A saved match
  still wins, so a project that already decided *"Superstructure IS our Level"* keeps it and no stored
  data moves underneath anyone.
- ⚠️⚠️ **UN-MATCHING A BRANCH USED TO DO NOTHING TO THE DATA — that is why a grouping went on drawing
  a floor forever.** `locMapPlan` only ever SETS. A branch matched once and later marked grouping-only
  left its value stamped on every activity beneath it. Apply now **clears** it, and narrowly: only
  where the branch was in that level's *saved* table, is no longer in the new one, is the activity's
  deepest match, the stored value still equals what it wrote, and the new matching sets nothing there.
  Hand-typed, imported and backfilled values are untouched — it undoes this tool's own writes and
  nothing else. The toast says how many were cleared, because a silent removal is not acceptable.
- **The stacking refuses a grouping value at read time** as a backstop for values already stored.
  ⚠️ **Nothing is dropped**: a refused value simply means "no level", so the work lands in the
  existing dashed *No level* band — which now names the grouping branches as a cause, since a planner
  reading that band would otherwise go hunting for a value that is plainly there.
- The wizard badges each row with **why** it reads as a grouping (`project phase` / `trade / work
  type`), shown even on rows already matched — that badge is the one thing that makes an old, wrong
  match visible instead of permanent.

**Verified: 26 checks executing the shipped `locGroupingReason` / `locGuessLevel` / `locIsGroupingValue`
/ `_vsLevVal` / `clearPlan`** (sliced out of the file, never reimplemented), covering the both-vocabulary
tie cases, the Tower-D-Substructure rescue, and all four narrowing conditions of the clear; the
previous pass's 14 wizard checks still green; **0 functions lost / 7 added**; parses; 0 NUL bytes.
⚠️ **Not verified signed in** — no clear has run against real activities, which is the one thing most
worth watching on the first real use. `MODULE_V` → `20260903c`.

### 2026-09-03 (b) — WBS→location matcher: level filter, a live location tree, and "grouping only" named for what it is
<!-- both sides prepended a 2026-09-03 entry; both kept whole, seam here -->

### 2026-09-03 (b) — Super-admin-only modules, module-logo dropdowns, bold Portfolio, view toggles repositioned

Six items in one owner turn, two of them mid-turn follow-ups on the earlier five.

**1. Seven modules + Personal hidden from everyone but `super_admin`, "for now."** New
`superAdminOnly: true` on the risk-register, stakeholder-map, manpower-loading,
equipment-loading, productivity-rates, contracts-claims and cash-flow entries in
`config.js`. Read off `window.__role` — the global `AppAuth.requireLogin()` already sets
before its callback runs — by a shared `visible(m)` predicate now duplicated (deliberately,
one line each) in `ModulesGrid.render()` (the launcher grid), `UI.renderNav()` (both the
project- and portfolio-mode sidebars), and `dashboard.html`'s own tile grid, so a hidden
module can't surface from any of the three places a module can appear. **This is UI
visibility only** — no RLS or table-grant change, so it's reversible in one line and a
super_admin sees every module unchanged.
- ⚠️ Personal (My Work / Tasks) gated the same way, off the same role, in **two** places —
  `renderNav`'s Personal section AND `renderUserBar`'s avatar-menu "My Work" link (a second,
  independent path to `my-work.html` that renders on every page, sidebar or not; gating only
  the sidebar would have left the page one click away via the avatar on every module page).
- ⚠️ **Portfolio Overview's own tabs are a fourth surface, and a static one** — its six
  cross-project tabs (Risk / Stakeholders / Equipment / Contracts / Cash Flow / Productivity)
  are hardcoded markup, not built off `APP_CONFIG.MODULES`, so hiding the sidebar link alone
  would have moved the same data one click sideways instead of closing it. Hidden the same
  role-gated way, straight in that page's own `requireLogin` callback; the other seven tabs
  (Overview/S-Curve/Cash-Flow-rollup/Resources/Milestones/Issues/Meetings/Photos) are untouched
  since none of those seven modules are `superAdminOnly`.

**2–4. A module identity icon before the screen-switcher dropdown**, for Minutes of Meeting
and Progress Photos — both modules whose `<h1>` text is hidden once `UI.tabsToDropdown()`
builds a trigger that already names the current screen, so the icon was the only piece of
module identity left, and until now it wasn't carried into the trigger at all. Extended
`UI.tabsToDropdown(selOrEl, opts)` with `opts.icon`, baked straight into the trigger button
(`.pd-tabsdrop-ico`, brand-red, matching Project Schedule's own `.ps-title-btn` pattern) rather
than left as a separate element beside it — issues-lessons already tried a standalone icon
element next to a dropdown and had to hide the WHOLE thing on narrow screens because a lone
icon on its own row is exactly the "icon alone / label on the next line" defect this app's
history has fixed twice already (see `tabsToDropdown`'s own comment). `UI.tabsToDropdown('.il-tabs',
{icon:'clipboard'})` and `UI.tabsToDropdown('.pp-tabs', {icon:'camera'})` — matching each
module's own `config.js` icon. ⚠️ Found by actually rendering the pages and inspecting the
DOM, not by reading the CSS: issues-lessons' `<h1>` carries an inline `style="display:none"`
set by `switchScreen()` from an earlier, deliberate round — a different mechanism from
`tabsToDropdown`'s own class-based hide, and the reason its icon had disappeared entirely
rather than merely being un-styled.

**5. "Portfolio" now renders bold when it's the selected row in the project-selector dropdown.**
The trigger button (closed state) already wrapped its label in `<strong>` unconditionally
(`renderSwitcher`'s `mainLabel`) — this was specifically about the Portfolio row **inside the
dropdown's own list** (`navListBody()`'s `.pd-nt-portfolio`, the one list body shared by
`enhanceProjectSelect`'s popover, `renderSwitcher`'s menu, and `home.html`), whose `.sel`
(current/active) state changed only background/color, with no weight change from the row's
base 600. `.pd-nt-portfolio.sel` now adds `font-weight: 700` — measured via a real render:
600 unselected, 700 selected.

**6. The List/Calendar and Tile/List/Plan "change view" toggles moved out of the chrome and
into the content, on the left** — Minutes of Meeting and Progress Photos, the two modules
where they weren't already there. ⚠️ **Issues & Concerns needed no change** — its own
List/Kanban toggle (`.il-viewbar`, built by `viewKanbanBarHTML()`) was already the leading,
left-most element directly above `#il-table`; confirmed by rendering all three modules and
comparing, not by re-reading the CSS a second time.
- **Minutes of Meeting**: the icon-only List/Calendar toggle used to live in the topbar's
  tool cluster (top-right, beside the profile — chrome, nowhere near the meetings it
  switches), wired once in `wire()` since it sat outside `#il-mom-view`'s own re-rendered
  content, with a separate `syncTopTabs()` pass to keep its hidden/`.on` state in sync. It now
  opens `momBrowseFilterBarHTML()` — the "Filters / N meetings / Export / +Add meeting" bar
  that already sits directly above the list/calendar and is rebuilt fresh on every
  `renderBrowse()` — so its `.on` state needs no separate sync pass at all; wired in
  `wireBrowse()` like every other control in that bar. The old topbar markup, its `wire()`
  wiring and the `syncTopTabs()` block managing it are all removed rather than left dead; the
  now-pointless `.il-topbar-tools .il-viewtoggle { height: 34px }` CSS override (the button's
  own 34px rule already covered it) went with them.
- **Progress Photos**: the Tile/List/Plan toggle (`.pd-viewtoggle`) already lived in the right
  place — `.pp-listbar`, directly above the gallery/list — just pushed to the far right via
  `.pp-listbar .pd-viewtoggle { margin-left: auto; }` while count/group-by/tile-size/markup sat
  on the left. Moved to lead the row instead (markup relocated, the `margin-left:auto` rule
  removed — flex's own start alignment does the rest). Checked first that nothing in
  `module.js` depends on `.pp-listbar`'s child order (only one order-agnostic
  `document.querySelector('.pp-listbar')` read, for a whole-bar visibility toggle) or queries
  `.pd-vt[data-view]` by anything but the attribute (it does, everywhere).
- Both re-rendered at 400px afterward: the toggles wrap onto their own compact row (not
  stretched full-width — `.il-viewtoggle`/`.pd-viewtoggle` both carry `flex: none`), nothing
  clipped or broken.

Verified: `node --check` on every touched `.js` file; every touched `index.html`'s inline
`<script>` parses (progress-photos' own extraction reports a failure that reproduces
byte-for-byte against the untouched `origin/main` copy — the documented "`<script>` substring
inside a CDN `src` URL fools a naive regex extractor" trap, not a defect in this change); CSS
brace-balance holds on `dashboard.css` (450/450), minutes-of-meeting's `module.css` (301/301)
and progress-photos' `module.css` (525/525); 0 duplicate DOM ids in any of the three touched
module pages; 0 stray references to the removed `#il-viewtoggle` id anywhere in code (the one
surviving hit is an unrelated Month/Week sub-toggle inside calendar mode that only ever shared
the CSS *class*, never the id). All six items visually confirmed via Playwright renders at
1400px and 400px against the shipped CSS with the real app markup (auth/DB stubbed — this
environment has no live Supabase login). ⚠️ **Not verified signed in.**

### 2026-09-03 (c) — WBS→location matcher: level filter, a live location tree, and "grouping only" named for what it is

Owner, off a screenshot of *Match the WBS to your location breakdown*: filter by WBS level, use the
space, put a location tree on the right — plus two questions worth answering in the UI rather than in
chat. Detail in `modules/project-schedule/CLAUDE.md`.

- **A WBS-level lens, separate from the match-state lens.** `locScanNames` already recorded each
  name's depth and nothing surfaced it; there is now a `WBS level N (count)` dropdown and an `L n`
  column. ⚠️ **Two controls, not one merged list** — *"show me the un-matched level-3 branches"* is
  the question a planner asks, and a single dropdown cannot express a pair.
- **The window uses the room it has** — `min(96vw,1480px)` × 92vh. ⚠️ `maxHeight` had to be overridden
  too: the shared `.pd-modal` caps at 85vh, so an 86vh inner column would have been clipped by it and
  the footer buttons pushed out of reach.
- **A live location tree on the right**, level by level, showing what each level will HOLD once
  applied — the table says what each WBS name *is*, the tree says what the breakdown *becomes*.
  Clicking a level (or the Grouping-only bucket) narrows the table as a third, transient lens that
  leaves the two dropdowns alone, so clearing it restores exactly what was on screen.
- ⚠️ **"Category A under Tower A and Category A under Tower B" is NOT a conflict — answered in the
  UI.** Two WBS names resolving to the same value render merged with a `×2` badge and both names in
  the tooltip. They are one value *at that level*; the level ABOVE keeps them apart, because
  deepest-wins resolution stamps every level an activity sits under. Showing them as a clash would
  invent a problem and invite a planner to rename real data to dodge it.
- ⚠️ **"Some WBS are not locations, just a grouping of activities" — that answer already existed and
  was named as a rejection.** `— not a location —` is now **`— grouping only (not a location) —`**,
  with its own filter, its own bucket in the tree and a line saying nothing is written for it and the
  decision is remembered. Same stored value (`''`) and the same per-project memory as before —
  ⚠️ so the *"Not matched"* lens now means genuinely undecided (it used to include every deliberate
  exclusion, which is what made a finished project still read as unfinished).

**Verified: 14 checks executing the shipped `visible` / `depths` / `treeHtml` / `lvlOptions` /
`counts` / `rowsHtml`** (sliced out of the file, never reimplemented) against a fixture carrying the
owner's own Category-A-twice case — each lens, the level filter, both tree lenses, the merge badge and
the header/row cell alignment. Inline script parses; 0 NUL bytes.
⚠️ **Not verified signed in** — no live matching has been applied against a real project.
`MODULE_V` → `20260903b`.

### 2026-09-03 — Favicon nudged back up: the (ai) padding pass over-corrected

Owner shared a screenshot comparing two browser tabs side by side — ours read visibly smaller than a
reference tab's icon — and asked to increase it "by a little" to match. Follow-up to the same-day
(ai) entry below, which had gone the other way (owner: *"reduce favicon size"*, because the old
`favicon.png` bled edge-to-edge at close to 100% fill) and landed `favicon-icon.png` at a **68%/57%**
width/height fill — reasonable against "bleeding," but evidently too far the other way once seen next
to another tab.

- ⚠️ **Regenerated from the pristine, untouched `assets/img/favicon.png`** (still the original
  1020×850 source — (ai) deliberately left it alone since it doubles as the `.pd-auth-mark`/
  `.pd-home-mark` login/home logo, and that reasoning still holds), not by re-scaling the already-
  downsampled `favicon-icon.png` — re-scaling a 256px file that was itself scaled down from 1020px
  would compound a second round of resampling loss for no reason when the real source is one file away.
- **Target fill raised to ~88% width / ~73% height** (was 68%/57%) — a deliberate middle point between
  the two complaints: nowhere near the old edge-to-edge bleed, but a clearly bigger, bolder mark than
  the (ai) version at real favicon size. Same proportional scale-to-fit + center-on-transparent-256px-
  canvas construction as (ai), just with a smaller margin.
- Verified by rendering both the shipped (ai) file and this replacement down to actual 32×32 and 16×16
  favicon sizes and comparing: the new version is legibly bigger and still fully legible with clean
  margins at 16px, not touching the canvas edges.
- Shared asset changed → **`favicon-icon.png?v=` bumped from none to `20260903a` across all 29
  referencing pages** (it had shipped with no cache-bust query string at all in the (ai) pass).

### Older entries

Archived by month, verbatim. Newest stay above.

- [2026-09](docs/changelog/2026-09.md) - 57 entries
- [2026-08](docs/changelog/2026-08.md) - 220 entries
- [2026-07](docs/changelog/2026-07.md) - 145 entries
- [2026-06](docs/changelog/2026-06.md) - 38 entries
