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
