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
