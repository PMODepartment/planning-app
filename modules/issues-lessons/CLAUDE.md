# Module: issues-lessons

## 2026-08-30 — Tabs become a dropdown (shared `UI.tabsToDropdown`)

The shared UI pass converted this module's flat `.il-tabs` row (Minutes of Meeting / Issues &
Concerns / Lessons Learned) into a single trigger-button + menu, matching Project Schedule's own
`.ps-title-switch` pattern — one `UI.tabsToDropdown('.il-tabs')` call added to the existing
`requireLogin` callback. It works by **clicking the real, now-hidden tab buttons** rather than
reimplementing this module's own view-switching logic, so `switchScreen`/the MoM-vs-register
selectors are untouched; a `MutationObserver` on each button's `class` keeps the trigger's label in
sync with whichever screen is `.active`. Also part of the same pass: the module's title/tabs/tools
moved out of `.pd-topbar` into a new sibling `.pd-modulebar` (`UI.initModuleTopbar`, shared code, no
module-local change needed here). See the root `CLAUDE.md`'s 2026-08-30(g) entry for the full
shared-layer rationale. Module-local files untouched by this change (shared `ui.js`/`dashboard.css`
only), so no `module.css/js?v=` bump this pass.

## 2026-08-28 (b) — Open issues onto the next agenda; the red panel stops being a slab; five smaller fixes

Owner ran both migrations, then gave six items off live screenshots. `MODULE_V` → `20260828b`;
`module.css/js?v=` → `20260828a`. **No migration.**

**1. Issues raised are now logged onto the NEXT meeting's minutes** — *"similar to a carry over items
but for issues and concerns"*, and built as carry-over's sibling so the two share their rules.
- A **new minute is seeded automatically** with the register's still-open issues, and a button beside
  the carry-over dropdown pulls in anything raised since. ⚠️ Only on a **brand-new** minute: re-running
  it on every render would fight a planner who deliberately took an item off this week's agenda.
- ⚠️ **It COPIES the register link, never re-raises** — one issue, N meetings. The row therefore shows
  the register's live status and carries no Raise button, so it cannot be double-raised by hand
  either. `issues_lessons.mom_id` is untouched: provenance names the meeting an issue was FIRST raised
  from, which is what lets `canDeleteMinute()` ignore these links.
- ⚠️ **Openness is decided by the REGISTER**, the rule the screen, the PDF and carry-over already
  follow — a closed issue must not be dragged onto next week's agenda, and `On Hold` is still open.
- ⚠️ **Idempotent by construction**: an issue already on THIS minute is skipped, so pressing the button
  twice adds nothing. Scoped per minute, not globally — an issue discussed last week is still open and
  belongs on this week's agenda too.
- ⚠️ **`owner_ids` travels with `owner`**, so a pulled item still resolves on the champion's My Work
  page; copying only the text would silently drop the assignment. Tolerant of the un-run assignment
  migration — `owner_ids` is dropped and retried, so the agenda still gets its issues.
- ⚠️ **The button is offered only when there is something to bring in, and says how many.** A
  permanently-present button that usually does nothing is the invitation-to-a-no-op that the
  carry-over dropdown already avoids.
- ⚠️ **Flagged, not solved:** a project with forty open issues seeds forty action items into every new
  minute. That is what was asked for and it is what an agenda is, but if it proves noisy the honest
  fix is a filter (department, or aging) rather than a silent cap.

**2. The status panel is no longer a solid brand-red slab.** Owner: *"the red tint is pleasing but
hurts the eye… for both light and dark mode."*
- ⚠️ **Red at ~260×600px of continuous fill, with white text and white inputs punched into it, is a
  glare source.** #EE3124 is an accent chosen to be seen in small doses. That it hurt in BOTH themes is
  the tell that the problem was area and saturation, not the theme mapping. Red is now a **rail and a
  heading** over a normal card — the same move the Gantt pass made when red went back to meaning
  progress.
- ⚠️ **The RAIL is what survives of the original fixed-contrast rule** ("must not look like a different
  screen mid-meeting"): the brand cue is identical in both themes while the surface follows the theme
  like every other card. A slab that ignored the theme was the thing being complained about.
- ⚠️ **Two real WCAG failures found by measuring my own first cut**, both the trap this repo has now
  recorded three times: brand red as 10px heading text is **4.12:1** on the card, and the aging value
  was **3.60:1** on the tint. Fixed with a **paired** accent — `--pd-bad` (#C42127) light, **#FF8A80**
  dark, because `--pd-bad` remaps to #EF5350 and measures **4.02** on the dark card.
- ⚠️ **`--pd-dark-red` IS NOT A TOKEN.** Writing it resolves to nothing, silently inherits ink, and
  measures 16.3 — i.e. it looks like a pass. Verified against the real stylesheet.
- **Measured after, both themes: min 5.11 light / 6.14 dark across heading, labels, aging and inputs.**

**3. The action item is multiline, and Description comes first.** It was a single-line `<input>`, which
clips its own value — an action of any length was unreadable in exactly the mode that exists for
reading it, the same defect the reporting view fixed for Issue / Agenda. Order now follows how the item
is written up: what was discussed, then what will be done.

**4. The "Any aging" filter stopped clashing.** ⚠️ Two causes, neither of them width tuning:
`flex: 0 0 auto` gives a select an **auto basis** — its own content width — and a flex item will not
shrink below that, so the last filter ran past the card edge and was clipped rather than wrapping; and
the fixed `height: 34px` against the shared 16px control font clipped its descenders. Now
`flex: 1 1 150px; min-width: 0` (the `min-width` is load-bearing — the auto minimum reinstates the
content width otherwise) and **min**-height. Measured at 1385px: one 56px row, aging 38px, 0 overflow,
0 page h-scroll.

**5. Meeting types are the project's own** — PPR Meeting / PSC Meeting / Client Meeting, replacing the
invented starter vocabulary. Still no CHECK constraint, so a project's own wording still joins the list
through `momOptions()`.

**6. The topbar stopped spilling** (it was orphaning the avatar on its own line) — the module title
text now hides at ≤1500px, keeping the icon, well before the row is forced to wrap. The Lessons Learned
lead banner is removed at the owner's request; the screen says what it is, and the detail's "What
produced this lesson" block already explains that a link is optional.

**Verified: 135 checks executing the SHIPPED functions**, sliced by brace-matching and never
reimplemented — 11 new on the agenda rules alone (closed excluded, On Hold and blank counted as open,
already-on-this-minute skipped, an unlinked action not suppressing an issue, another minute's copy not
blocking this one, and running it twice adding nothing). ⚠️ The suite **cannot run against the
pre-change file at all**, so it bites. **0 functions lost / 2 added**; parses; 0 NUL bytes; CSS braces
233/233. Contrast and layout measured in a real browser against the shipped stylesheets in both themes.

⚠️ **Not verified signed in** — no live click-through of the seeding, the button, or the reordered
fields against real data.
⚠️ **A near miss worth recording:** I overwrote the repo's own `.claude/launch.json` while setting up a
throwaway static server, not having checked that one already existed. Restored from git. The repo
already ships `.claude/tools/static-server.ps1` — use it.

## 2026-08-26 — Testing the meeting-linked lesson picker found TWO real defects

The one path the earlier signed-in pass could not exercise (that project's single meeting had
no action items). Built the missing fixture in the QADEMO sandbox — a meeting with an action
item — and the test paid for itself immediately.

⚠️ **DEFECT 1: the Source dropdown was unusable, so a lesson could only be linked from a
pre-filled entry point.** Choosing *"A meeting action item"* — or *"An issue or concern"* —
snapped straight back to **Not linked** and no picker ever appeared. `linkKind` was derived
from the stored ids, but the dropdown is **UI INTENT that necessarily exists BEFORE any id has
been chosen**: selecting `mom` cleared `issue_id`, left `mom_id` null, and the re-render
derived "not linked" and reset the select. Now tracked as `_kind` on the in-memory object.
⚠️ It is never persisted — `saveLesson` builds its payload from named columns — so it cannot
reach the database.

⚠️ **DEFECT 2: the meeting list could render EMPTY on a project full of minutes.** `_momLoaded`
is set on the **first line** of `loadMoms` as a re-entrancy guard, so it means *"a fetch has
started"*, not *"the minutes are in hand"*. The picker tested it, decided the data was ready,
rendered from an empty `MOMS`, and never heard the rows arrive. Reproduced live, then confirmed
by re-rendering seconds later and watching the meeting appear. `loadMoms` now re-renders the
lessons screen on completion — ⚠️ **on the failure path too**, or a failed fetch leaves the
picker waiting forever. Fixing it there covers every reader of `MOMS` at once instead of making
each one race the fetch.

⚠️ **WHY THE 64-CHECK SUITE MISSED BOTH, and it is the lesson worth keeping: it stubbed
`momLinkPickerHTML` and only ever rendered lessons whose links were ALREADY set.** It tested the
renderer, never the transition. A suite that only feeds a component its settled states cannot
see a state machine that refuses to leave the first one. The suite now slices the **real**
picker and drives the before-an-id-exists states: **6 of the new checks fail against the pre-fix
file**, 77/77 pass after, 0 functions lost.

**Verified live after the fixes**, on the deployed build:
- Source stays on the chosen kind; the meeting picker appears with no id yet; the action-item
  picker stays **disabled until a meeting is chosen**, then lists that meeting's items with
  *"— the meeting as a whole —"* still offered.
- The race path (switch project → straight to Lessons → open the picker) now **self-corrects
  with no user interaction**, and the unsaved draft survives the re-render.
- Both entry points work: pre-filled from an action item's *"+ Capture lesson"*, and linked by
  hand through the dropdown. Two lessons on one action item render as **"2 lessons"** on its card.
- 0 console errors. ⚠️ **Sandbox left exactly as found** — 0 meetings / 0 lessons / 0 issues,
  every probe row removed through the app's own delete paths.

⚠️ **Smaller gap found and NOT fixed:** a meeting created in the current session is not added to
`MOM_BY_ID` (the "+ New minutes" handler pushes to `MOMS` only), so a lesson linked to it reads
*"From a meeting"* without naming it until the next load. Confirmed by reloading and watching the
title appear. Cosmetic, self-healing, and a one-line fix in that handler when it is next touched.


## 2026-08-26 — SIGNED-IN VERIFICATION of the report/lessons rework (caveat closed)

Both migrations were run by the owner and the whole rework was then driven **signed in on the
deployed site** in the owner's own Chrome. This closes the "not verified signed in" caveat the
entry below carries.

**Migrations confirmed against the live database first**, with the probe calibrated before it was
trusted — `42501` = present but grant-blocked · `PGRST205` = table absent · `42703` = column absent,
plus a **negative control on each table** so the readings are not incidental. `lessons_learned` and
all 13 columns present; `schedule_builder`(+5 cols), `schedule_builder_pushes` and
`wbs_nodes.is_package_root` present (the other session's package-scoped migration).
- ⚠️ **The backfill copied 0 rows, and that is the correct result, not a failure.** Measured:
  `lessons_on_issues = 0`, `lessons_in_library = 0`, `linked_back = 0`. Nobody had ever filled in the
  old `lesson_learned` field on any issue, so the `not exists` guard had nothing to copy. **The shape
  that would be alarming is a non-zero first column with a zero second one** — that is the one to
  check if this is ever re-run elsewhere.

**Driven end to end on the QADEMO sandbox** (chosen deliberately over a live register), and every
step verified against a **full `load()` re-query**, not just against the in-memory row:
- Tab order **Minutes of Meeting → Issues & Concerns → Lessons Learned**, module opens on the
  minutes, view toggle correctly hidden there.
- Register defaults to **Report** with the log hidden; empty states correct on both sides.
- ⚠️ **The cancel path — the decision that differs from "+ New minutes" — verified to write
  NOTHING.** Typed into the draft, pressed Cancel, then re-queried the database: register still 0.
  This is the whole reason a new issue is a draft in memory rather than an inserted row.
- **Save inserted and RLS accepted it** (`created_by = auth.uid()`): 0 → 1 TOTAL / 1 OPEN, the draft
  became a real row, detail read *"Raised by you · Operations."*
- The detail pane renders the Power Apps layout: panel **Status · Department · Champion · Date
  Presented · Days Aging · Date Resolved**, body **Issue · Caused By · Corrective Action**.
- **"+ Capture a lesson"** switched screens with the source **pre-selected to that issue**, the
  primary button relabelled *+ New lesson*, the toggle relabelled *Report | Library*, and **no
  migration banner** — i.e. the real table is being read, not the legacy fallback.
- Lesson saved, then **survived a full re-query**: it renders inside the issue's own detail pane and
  the list row flags *"lesson captured"* — the round trip the old one-lesson-per-issue model could
  not represent.
- **Reporting view: 8 controls → 0**, zero inputs inside the split, values rendered as text, save bar
  hidden, and the panel measured **`rgb(238,49,36)`** (brand red) **in dark mode** — the
  fixed-contrast island holds where a token would have remapped it.
- **0 console errors** across the whole session and on a fresh page load.
- ⚠️ **Sandbox left exactly as found** — both probe rows deleted through the app's own delete paths
  and confirmed 0 issues / 0 lessons after a re-query. No live project was written to.

**Still not exercised:** a second user (the per-row permission branches were verified against
fixtures, not against another account), the meeting-linked lesson picker, and the legacy fallback —
which is now unreachable by construction, since the table exists.

⚠️ **Separate pre-existing defect, NOT introduced here and not fixed:** `index.html` renders mojibake
— *"championâ€¦"*, *"Â·"* in the tab title, *"â€""* in the minutes lead. The file holds UTF-8 bytes
written through a cp1252 path. It predates this work (visible in the owner's screenshots from before
the change). Worth its own pass with an explicit encoding, not a find-and-replace.


## 2026-08-26 — Tab order, the register becomes a REPORT, and lessons become their own record

Four owner asks in one prompt. **⚠️ Run `migrations/2026-08-26-lessons-learned.sql`.**

**1. Tab order is now Minutes of Meeting → Issues & Concerns → Lessons Learned**, which is
the order the work actually happens: a meeting is recorded, what it raised is chased in the
register, what it taught is kept in the library. ⚠️ **The first tab is also the default
screen** (`screen = 'mom'`) — a tab strip whose first entry is not where the module opens
reads as a bug, and the register is one click away.

**2. Issues & Concerns is a REPORT, not only a log.** The owner's reference was their live
Power Apps "View Open Issues" screen, and that layout is now the default: a **red status
panel** (Status · Department · Champion · Date Presented · Days Aging · Date Resolved)
beside the **issue / caused by / corrective action** blocks, one record at a time, in the
same master/detail shape as the minutes. A **Report | Log** switch in the toolbar keeps the
table — ⚠️ **the log was not replaced, deliberately**: scanning forty issues for the one you
want is a different job from reading one of them, and both run off `issuesFiltered()`, so
switching presentation never changes the set.
- ⚠️ **Days Aging stays DERIVED and is the one field with no control** — 0 when Closed, else
  today minus the date presented. A stored aging is wrong the next morning.
- ⚠️ **The red panel is a fixed-contrast island** — brand red with white labels in *both*
  themes, its controls on a light surface. Do not token-ise its background: remapping it in
  dark mode turns the screen someone is presenting from into a different-looking screen
  mid-meeting. This is the one place in the module that deliberately ignores the theme.
- ⚠️ **The selection is validated against the FILTERED set**, not just against `rows` — a
  filter that hides the open issue has to move the pane, or the reader is looking at a record
  the list beside it says is not there.
- **Reporting view** renders every field as text rather than as a control, for the reason the
  minutes card already documents: a single-line `<input>` clips its own value, so a long
  Caused By was unreadable in exactly the mode meant for reading it. `momFieldHTML` now
  delegates to a shared `ilField`, so all three screens report the same way.

**3. The pop-up is gone. There is ONE editor for an issue and it is the detail pane.**
"+ New issue" and the log's ✎ both land there.
- ⚠️ **A new issue is a DRAFT IN MEMORY, not an inserted row — deliberately UNLIKE "+ New
  minutes"**, which inserts immediately and lets you type. It cannot work that way here:
  `issues_lessons_del` is **planner-only** (2026-08-19-department-issues.sql), so a department
  that mis-clicked "+ New issue" would leave a blank row in the register with no way to remove
  it. The draft is written on Save and discarded on Cancel, and leaving it is confirmed.
- ⚠️ `openForm` and `wireModalCursor` are **deleted, not left alongside** — a second editor is
  a second place for the fields to drift apart. Autosave went with the modal (it wrapped a
  modal's Save button); an explicit Save is the trade.
- Permission gating is unchanged and still mirrors the RLS row for row: any approved
  non-viewer may raise, you maintain your own, a planner maintains the register, and where
  delete is unavailable the card **says why** rather than hiding a button.

**4. A lesson is its own record now** (`lessons_learned`), no longer three columns on the
issue. That shape forced **one lesson per issue**, **no lesson without an issue**, and a
capture form welded to the issue form — all three are gone. A lesson carries **optional**
links to the issue, the meeting and the action item that produced it, and is captured from
three places: the Lessons screen, an issue's detail pane, and an action item's card.
- ⚠️ **An unlinked lesson is a legitimate record, not a broken one** — meetings produce
  lessons nobody logged as a problem, and a lesson brought from another project has no issue
  in this register at all. "Not linked" is the first option in the source picker, never a
  fallback, and nothing in the UI requires a link.
- ⚠️ **`on delete set null`, never cascade.** A lesson outlives its source — that is the whole
  point of a library — so deleting the issue strips the link, not the knowledge. The delete
  confirmation was reworded to say so; the old wording ("this also removes any lesson captured
  on it") is now a false warning that would stop someone deleting a duplicate.
- ⚠️ **Delete is wider here than on the register, on purpose.** An issue may not be deleted by
  the department that raised it (the record of a problem having existed is the point); a lesson
  is something someone wrote down, and a duplicate is noise in a library everyone reads — so
  its author may remove it.
- ⚠️ **LEGACY FALLBACK, and it matters.** Until the migration runs there is no table, so the
  library is rebuilt read-only from the old columns with a banner naming the file to run.
  Without it, opening the app before the migration would report a project's whole lessons
  history as empty, which reads as data loss. Legacy ids are prefixed `legacy:` so they can
  never be mistaken for a real row and sent to the database in an update.
- ⚠️ **The migration backfills and does NOT clear the old columns**, guarded by `not exists`.
  Clearing them would leave an older deployed tab showing a lesson that has vanished.
- ⚠️ The meeting picker **loads the minutes on demand** — they load lazily, so assuming they
  are in hand would offer an empty meeting list on a project full of minutes.

**Verified: 64 checks executing the SHIPPED builders**, sliced out of `module.js` and never
reimplemented — every Power Apps field present in the layout, aging derived and uneditable,
the full permission matrix (own / another department's / unauthored, planner and not), report
mode emitting no controls at all, the new-issue draft offering Cancel and no Delete, **two
lessons on one issue** (the case the old model could not represent), an unlinked lesson
rendering and correctly *not* counting toward its issue, the legacy rebuild being read-only
even for a planner, "Not linked" selected by default, search, and escaping.
⚠️ **The suite cannot pass against the pre-change file** (`NOT FOUND: ilField`), so it bites.
Function-set diff vs HEAD: **2 lost — `openForm` and `wireModalCursor`, both deliberate — 24
added.** Parses; 0 NUL bytes; CSS braces 217/217; every `$()` id resolves to the shell or to a
renderer.

⚠️ **NOT verified signed in, and the migration has not been run.** No live click-through of a
save, a lesson capture, or the meeting picker against real data — the module is behind Supabase
auth and the anon key has no grants. The first real use is the test.
`MODULE_V` → `20260826h`; module assets → `?v=20260826a`.

## MoM: last mom-app gaps closed — filters, meeting type, attachments (2026-08-21) — fmlozano
Owner: *"close the gaps by starting with the ongoing session."* **Run
`migrations/2026-08-21-mom-type-and-attachments.sql`** (after the schema/carry-over/distribute one
from earlier today). This finishes the mom-app parity list — nothing from the gap study is left open.

**Two things in mom-app were deliberately NOT copied, and both are the interesting decisions.**
- ⚠️ **Its attachment bucket is PUBLIC and it stores `/object/public/…` URLs**, so anybody holding a
  link reads the file with no login at all. Minutes attachments are site photos and commercial
  documents. This bucket is **private**, `attachment_url` holds the object **PATH**, and the URL is
  signed on demand — the same construction as `drawing_register.file_url`, including keeping the
  misleading column name for parity and documenting it rather than storing a URL that has expired.
- ⚠️ **Its category list has drifted between two hand-maintained dropdowns** — the edit form offers
  `Finance`, the filter does not, so an item categorised Finance there can never be filtered to.
  `MOM_CATEGORIES` is the UNION of both, read by the editor *and* the filter, so that defect cannot
  reproduce here.

**The category free-text I shipped this morning was a latent version of the same bug.** It is now a
select. ⚠️ Built through `momOptions()` = canonical ∪ values already used on this project ∪ **the
row's own current value** — the select-value trap this app has been bitten by twice (the drawing
register's type field silently WIPED a value on save; the schedule's work-package picker read back
`''`). A `<select>` whose value is absent from its options reports the FIRST option instead.

**Action-item filters** (search / category / type / status) with a count and a clear.
- ⚠️ **The status filter tests the REGISTER's status for a raised action**, because that is what the
  row displays — otherwise filtering to Closed would hide a row the screen is showing as Closed. Its
  options are the union of both vocabularies: `On Hold` exists only in the register and `In Progress`
  only on the minute, so offering one list would make the other unreachable.
- ⚠️ Offered only past 4 actions, and the filtered set drives the TABLE while the full set still
  drives the count and the empty state — rendering the filtered rows as if they were everything is
  how a hidden row gets mistaken for a deleted one. Filters clear when you switch minutes.

**`meeting_type` — not decoration.** In mom-app it is what the meetings list GROUPS by, and that is
the point: a project runs several standing meetings at once, so a flat date-ordered list puts last
week's client meeting between two weekly coordinations. The list now groups by type (untyped in its
own trailing bucket — every pre-migration minute is untyped, so that bucket is the whole list until
someone fills it in) and gains a search past 6 meetings.
- ⚠️ **No CHECK constraint, the opposite call from `mom_items.type` this morning.** `type` has three
  fixed values the PDF badges by name; a meeting type is project vocabulary nobody can enumerate up
  front, and mom-app lets an admin add one at runtime. The fragmentation a CHECK would have covered
  is handled by `momOptions()` offering what the project already uses.

**Attachments — the ordering rules are the whole feature**, each one because the opposite order
leaves a real mess: upload BEFORE the row write (a failed upload must never leave a row pointing at
nothing); roll the object back if the row write then fails; on replace delete the old object only
AFTER the row points at the new one; on remove null the row FIRST (a failed delete leaves a
recoverable orphan, the reverse leaves an attachment that will not open). Deleting an action or a
whole minute captures the paths BEFORE the rows leave memory — after the cascade they cannot be
queried at all. The PDF names the file but never links it: the bucket is private, so a link would be
dead for whoever opens the sheet.
- ⚠️ **The bucket's INSERT policy is `is_writer()`, not the `is_approved()` the 2026-06-18 buckets
  use.** That older rule predates viewer-readonly and lets a VIEWER upload into a register they
  cannot write a row to — an orphan by construction. A new bucket has no legacy uploads to protect,
  so it starts on the correct rule instead of inheriting the drift. DELETE keeps the `owner` branch
  beside `is_planner()`, matching the settled rule on the other three.

**Verified by executing the shipped code, sliced not stubbed: 42 new checks** (75 across the three
MoM suites) — the select-value round-trip, every filter incl. the register-status rule, the grouping
and its untyped/single-group cases, and all four attachment ordering rules driven with injected
failures. Header/row cells align 11/11 writer, 10/10 read-only. **0 functions lost, 16 added.**
- ⚠️ **A real layout defect the harness caught and reading would not have:** the filter bar rendered
  **203px tall** — the shared `.pd-select` is `width:100%` (built for stacked `.pd-field` forms), so
  every select claimed the whole bar and landed on its own row. Fixed to 52px, one row. Every filter
  bar in this app has to override that; it is not decoration.
- ⚠️ **A literal NUL byte** got written into a patch script where a space belonged, truncating a JS
  string at the sentinel. `module.js` was checked byte-wise for NULs (0) after every patch.
- ⚠️ **Not verified signed-in, and neither migration has been run** — the module redirects to login
  and I do not enter credentials, so upload/distribute/carry-over click paths are unexercised against
  real data and the bucket policies are structurally checked only. `MODULE_V` → `20260821e` (another
  session had taken `d`); the module's own `?v=` → `20260821c`.

## MoM: mom-app item schema, carry-over keeping the register link, draft→distribute (2026-08-21) — fmlozano
Owner: *"Let's proceed with all 3. But I like how our minutes of the meeting can push action items to
issues & concerns. Let's consider that with the carry-over. I also like the new formatting we have.
Let's keep."* **Run `migrations/2026-08-21-mom-schema-carryover-distribute.sql`.** The PDF format
shipped earlier today is **unchanged** — re-measured after the schema change: band `rgb(180,0,0)`,
wrap `718.1px` (= 190mm), the same six grid tracks, the same badge palette.

- ⚠️ **ONE migration, not three, and the header says why.** Carry-over copies `issue_id`, which
  changes what `mom_has_raised()` means (the delete guard written in the department-minutes
  migration); distribution gates both what can be READ and what may be RAISED. Split apart, any one
  of them leaves the other two describing rules that are no longer true.
- ⚠️ **The action text MOVES out of `description` into `action_item`, once.** `mom_items.description`
  has always held the action ("Resequence L4 formworks"), which is why the PDF already printed it as
  Action Item. Leaving it there would mean the same column means the action on old rows and the
  elaboration on new ones, with no query able to tell which. **Guarded on the column not having
  existed, not on the data** — the obvious "backfill where action_item is null" would silently refill
  from a now-different field the first time a user legitimately clears one.

**Carry-over — the owner's specific interest, and it drove three decisions.**
- ⚠️ **It COPIES the register link rather than re-raising.** A carried action is the same issue,
  discussed again, so `issue_id` comes across and the new minute shows the register's live status.
  Re-raising would put two competing issues in the register for one problem — and because the Raise
  button only renders when `issue_id` is null, copying the link also makes double-raising by hand
  impossible. **One issue, N meetings.**
- ⚠️ **What is "still open" is decided by the REGISTER for a raised action**, the same rule the screen
  and the PDF already follow. An action raised months ago and since closed in the register must not
  be dragged into next week's agenda because nobody went back to tick the box on the old minute.
- ⚠️ **`mom_has_raised()` had to be re-defined or carry-over would have broken own-delete.** A carried
  item has an `issue_id`, so the old test said "something was raised here" and turned every
  brand-new draft seeded from an old meeting into a planner-delete-only row. Nobody raised anything —
  `issues_lessons.mom_id` still names the meeting the issue was FIRST raised from, and carry-over
  never moves it, so deleting a meeting that merely carried the action destroys no provenance. The
  test now excludes carried links, and `canDeleteMinute()` mirrors it.
- Idempotent by construction (already-carried source items are skipped) and it **says so** rather
  than silently doing nothing; `carried_from_mom_id` records the first seeding only.

**Draft → Distribute.**
- ⚠️ **Only the READ narrowing is enforced in the database, deliberately** — that is the part that is
  a security boundary (a draft is visible only to its recorder and planners; `mom_items` had to match
  or a draft's action items leak while its heading does not, which is the leak, not a lesser version
  of it). The "distributed minutes are locked for editing" half is **UI-only**: it is a workflow
  guard, not a permission, and the person it stops may legally revert two clicks later. UI stricter
  than RLS is safe; the reverse is the silent-failure trap.
- ⚠️ **An action cannot be raised out of a draft, and THAT is enforced in the DB** (`issues_lessons_ins`
  now tests `mom_is_distributed`) — unlike the edit lock, this one leaves a permanent row behind if
  it slips through, whose "Raised at: …" provenance would point at a minute the reader cannot open.
- ⚠️ **Existing minutes backfill to DISTRIBUTED**; the column defaults false only for new rows. They
  were written in a world with no draft concept and already have actions raised off them — letting
  the default apply would retroactively hide the entire history from everyone but each recorder.
  Guarded on the column not having existed, **not** on "nothing is distributed yet", which is also
  true of a project that reverted everything to draft.
- The PDF **prints a DRAFT chip and appends `_DRAFT` to the filename** on an undistributed minute: a
  PDF outlives the screen that knew it was a draft, and that is the one way this export could mislead.

**Smaller things that were still defects.**
- ⚠️ The inline-edit handler wrote `''` on an empty field. `type` carries a CHECK, so clearing it
  would have been **refused by the database**; the other new columns would have stored `''` where
  every read tests null. Empty is now NULL on the nullable columns.
- ⚠️ A legacy row printed its action text under **both** Action Item and Description in the PDF —
  caught by the harness, fixed by blanking Description when the action text came from it.

**Verified by executing the shipped code, sliced not stubbed: 33 checks** — 23 on carry-over
(register-decides-openness, link copied, not re-raised, seq/idempotency, all four refusals, failed
insert leaves the minute unstamped, and both halves of the carried-vs-raised delete rule) and 10 on
the raise guard (draft refused, action text not description, link after insert). Header/row cell
counts align exactly (9 read-only / 10 writer, both sides). **0 functions lost, 4 added.** Migration
is paren-balanced, `$$`-paired, every policy preceded by a drop. ⚠️ **Not verified signed-in, and the
migration has not been run** — the module redirects to login and I do not enter credentials, so the
new controls' click paths are unexercised against real data. `MODULE_V` → `20260821b`; the module's
own `?v=` → `20260821b`.

## Minutes of Meeting exports a PDF in mom-app's exact format (2026-08-21) — fmlozano
Owner: *"There is a minutes of the meeting app of the same github account of a different repository.
Let's implement the download pdf feature following exactly the same format of the exported pdf."*
(`PMODepartment/mom-app`, a single 3341-line `index.html`.) **No migration.** A `⬇ PDF` button on
every minute in `modules/issues-lessons` renders the same sheet that app produces: the `#b40000`
header band with the white logo and project — title / date / location / item count, then one bordered
card per action with the six-column meta grid (`0.4fr 1.5fr 0.9fr 0.9fr 1.2fr 1fr`), the grey field
blocks, the same badge palette, and the same html2pdf/jsPDF options (A4 portrait, 10mm margins,
scale 2, JPEG q0.98).

- **Verified against the real source, not a re-implementation.** The exporter was executed by
  slicing its own text out of `module.js` in a throwaway harness and stubbing only the closure it
  reads. The rendered node measured `rgb(180,0,0)` on the band, `718.1px` (= 190mm at 96dpi) wide,
  the six grid tracks in the ratios above, and every badge colour byte-identical to mom-app's map.
- ⚠️ **The export is offered to READ-ONLY viewers**, unlike every other control on the detail card.
  Exporting is a read, and the person who most needs the sheet — someone who attended the meeting
  but did not record it — is exactly the one `canEditMinute()` says no to.
- ⚠️ **Field mapping is lossy in one direction and richer in the other**, because the two apps do
  not share a schema. `mom_items` has no `category` / `type` / `issue` / `action_item`; it has one
  free-text `description`. So `Action Item` ← `description`; `Issue / Agenda` ← the linked
  register issue's description; `Description` ← what the register now says; `Type` ← Issue when
  raised else FYI; `Category` ← "Raised in register" / "Held in minutes" — a true statement about
  the action rather than a dash in every row of every export. Going the other way, `attendees`,
  `notes` and the linked schedule activity exist HERE and not in mom-app, and they print in the
  same field blocks above the actions: dropping the minute's substance to match a narrower app
  would export a worse record.
- ⚠️ **A raised action prints the REGISTER's status, not `mom_items.status`** — the same rule the
  screen follows. Printing the minute's own copy would put a stale status on paper that outlives
  the screen showing the live one.
- ⚠️ **`in progress` was ADDED to mom-app's badge palette.** mom-app has no such status; `mom_items`
  does, and without an entry the most common mid-flight status would have printed in the default
  grey — the same grey as Closed.
- ⚠️ **The export node is built as detached inline-styled DOM, parked at `left:-10000px`, and
  removed in `finally`.** html2canvas rasterises real laid-out DOM, so an orphan node has no box and
  renders blank; and a throw mid-render would otherwise leave the node behind, stacking one more on
  every later export. The inline styles are deliberate — `module.css` must not reach this element or
  a dark-theme session would export a dark sheet.
- **Header is saved before rendering** when the user may edit: the exporter reads `MOMS`, not the
  form, so a title typed and not saved would have been missing from the sheet.
- Library is the same `html2pdf.js@0.10.1` bundle mom-app loads. `MODULE_V` → `20260821a`, and the
  module's own `?v=` → `20260821a`.

## Departments record minutes too — per-MINUTE permissions (2026-08-20) — fmlozano

Owner: *"Let departments record minutes too."* **Run
`migrations/2026-08-20-department-minutes.sql`.** This is the other half of D1: it does to
minutes what D1 did to issues, and for the same reason — the screen is department-facing now.

⚠️ **It is NOT a blanket widening, and that is the whole design.** The tables were created
under `for all using (is_planner())` — one rule for four commands. Swapping `is_writer()` into
that same shape would let any approved non-viewer rewrite or delete **another** department's
minutes: a record of a meeting they may not have attended. So three commands, three rules:
- **insert** — any approved non-viewer on an accessible project, stamped as themselves
  (planners exempt, for minutes typed up on someone else's behalf).
- **update** — planner+ on anything; everyone else only minutes they recorded. ⚠️ Asserted in
  **both** `using` and `with check`: with `using` alone a row can be updated *out of* your own
  ownership, leaving you neither the right to fix it nor the record of having written it.
- **delete** — planner+ on anything; everyone else their own, **and only while nothing has been
  raised from them**.

⚠️ **Why own-delete exists here when the register's does not:** "+ New minutes" INSERTs
immediately and then lets you type, so a mis-click leaves a real empty row — without own-delete
every stray draft would need a planner. ⚠️ **And why it is guarded:** once an action is raised,
issues in the register point back at the minute for provenance ("Raised at: …", the From MOM
tag), and `on delete set null` means deleting it *silently strips that* rather than failing.
Stripping provenance is a planner's call, not a side effect of tidying your own drafts.

⚠️ **`mom_items` ownership is DERIVED, not stored, and is not getting a `created_by`.** An
action item belongs to its minute (already `on delete cascade`), so "may I touch this action?"
is the same question as "may I edit the minute it is on?" — `mom_is_mine(mom_id)`, a
SECURITY DEFINER helper with a pinned `search_path` like every other helper here (a policy whose
sub-select is itself RLS-filtered is how this schema got a stack-depth recursion bug once).
A second ownership column would be a second answer to that question, free to disagree — someone
else's action sitting inside minutes you own.

**The UI mirrors it per minute, not per screen** (`canEditMinute` / `canDeleteMinute`): the
single `canMinutes` flag is gone, because no one flag can say "yes for this row, no for that
one", and a flag that says yes where the DB says no is the silent failure D1 removed. A
department sees "+ New minutes"; its own minutes fully editable; another department's read-only
with **who recorded it** (department-level, never a person — resolving `created_by` to a name
would need a read of `users` for a caption); and where delete is unavailable it says why instead
of just missing a button. A minute with no `created_by` is planner-only and says so.

- **103 checks green** (was 79) against the section sliced verbatim from the shipped `module.js`,
  incl. the full matrix — planner/department/viewer × own/another's/unauthored minute, delete
  before and after something is raised, and both write paths refusing what the policy refuses
  (`momSaveItem` on another department's action, `momRaiseIssue` out of their minutes) while the
  same calls succeed on your own. ⚠️ The suite **cannot pass against the pre-change file** — it
  dies on `canEditMinute is not defined`. **12 browser combos** (planner / dept-own / dept-other
  × desktop/phone × light/dark).
- ⚠️ **A stale harness option silently became a PASS**: `build({ canMinutes: false })` kept
  "asserting" a read-only case after the option stopped existing, so it was really testing a
  planner. Renaming a flag invalidates every test that named it — the chip's unlink rule is now
  asserted through its argument instead.
- ⚠️ Migration structurally checked only (parens/`$$`/every policy preceded by a drop/the generic
  `*_write` dropped). **The policies themselves are NOT verified against a live database** — and
  `admin_*`-style checks cannot be run from the SQL editor anyway, since `auth.uid()` is NULL for
  the `postgres` role. Neither MOM table is in `supabase-schema.sql` / `supabase-setup.sql`
  (pre-existing drift, same as its predecessor), so `/migrations` remains their only definition.

## Minutes of Meeting moved IN from the Project Schedule (2026-08-20) — fmlozano

Owner: *"There is a minutes of the meeting within the project schedule module. Let's move this
out and connect it to issues and concerns module. Lessons Learned, departments can also add
issues."* A meeting's action items are chased as entries in THIS register, so the minutes now
sit beside it: a third topbar screen — **Issues & Concerns | Lessons Learned | Minutes of
Meeting** — reading the same `meeting_minutes` / `mom_items` tables. **No migration.**

### What the move actually bought
- ⚠️ **The linked issue is read out of `rows`**, the register this module already holds, so there
  is no second fetch of `issues_lessons` and no second copy of a status to drift. The schedule
  module had to fetch them separately (`MOM_ISSUES`) precisely because it did not own the
  register; that whole round-trip is gone.
- **A raised action appears in the register immediately** — the new row is pushed into `rows` and
  the filter options refreshed, instead of making the planner reload to find what they just filed.
- The action item's status pill now shows the **register's** status, not the action's own, because
  the register is what owns it after raising.

### What was deliberately preserved
- **Still one-way.** Raising COPIES the action into the register and links the two; from then on
  the register is authoritative and the minute keeps saying what the meeting said.
- **Raising is idempotent** (button rendered only when `issue_id` is null, re-checked before the
  write), the **insert happens before the link** (a link written first + a failed insert = an
  action that reads "Raised" while nobody chases it), and a failed *link* leaves the action
  honestly unraised with a warning to check for a duplicate.
- ⚠️ `mom_items.status` and `issues_lessons.status` are **not the same list** — In Progress
  translates to On Hold on the way across. Tested as a table: Open→Open, In Progress→On Hold,
  Closed→Closed, blank→Open.
- Deleting an action or the whole minutes never deletes an issue already raised, and both
  confirmations say so.

### Two things that had to change with the address
- ⚠️ **The activity picker searches the server.** The schedule module could offer a `<datalist>`
  over its own loaded rows; this module does not own the schedule and must not pull 40k
  activities into a side screen. And a datalist could not have served it anyway — it filters on
  each option's VALUE (which has to be the `activity_id` we store), so typing part of a NAME
  would match nothing (the trap documented when the drawing register's picker was built). It is
  now an `ilike` on id **and** name, capped at 25 with a "keep typing to narrow" note, debounced
  250ms, WBS summaries excluded. ⚠️ PostgREST's `or()` is comma/paren delimited, so those
  characters are stripped from the term or they would corrupt the filter instead of being searched.
- ⚠️ **Write permission mirrors the RLS, and that is the database talking, not a preference.**
  At the move it was planner-only (`meeting_minutes` / `mom_items` were created under
  `is_planner()`); the owner then asked for departments to record minutes, so it is now
  per-minute — see the entry above.

### Verified
- **79 checks green** against the MOM section **sliced verbatim out of the shipped `module.js`**
  (the slice asserts all eleven functions are present, so it cannot silently test nothing):
  keyset paging via `PDb.selectAll`, display order with blanks last, the load-error path naming
  the migration, all four status translations, the four raise failure modes, idempotency, the
  empty-action refusal, the `or()` sanitiser, the picker's min-length/WBS/limit rules, the
  name-cache, escaping, and `momReset` on a project switch.
- **Real browser, 8 combos** (planner/read-only × desktop/phone × light/dark) against the shipped
  CSS: two panes at 1280 (260px list), stacked at 375, no page h-scroll, the action grid scrolling
  inside its own box, and the read-only render carrying **no** write control and 13 disabled fields.
- ⚠️ **One real defect found by measuring, not by reading:** at 375px the detail pane came out
  **1123px wide** and gave the whole page a horizontal scroll — turning the flex row into a column
  left `align-items:flex-start` sizing each pane to its content, and `min-width:0` does not
  constrain a column item. Fixed with `align-items:stretch` + an explicit width.
- ⚠️ **Not verified signed-in** — no live click-through of a real raise against the live tables.
  Assets `module.css/js?v=20260820a`.

## Live collaboration + offline (Phase 1 & 2) (2026-07-26) — fmlozano
Same "◑ register" recipe as risk-register (see that module's CLAUDE.md): presence (`#il-presence`),
row-level cursor on Edit-modal open (`wireModalCursor`/`paintRemote`), live rows via postgres_changes,
offline modal-update via `PDSync.write` + read-cache (`il:<pid>`). Realtime migration
`2026-07-26-realtime-collab-registers.sql` (USER MUST RUN). `node --check` ok; not browser-verified.
Assets + `module.js?v=20260726a`.

Developer change log for the **Issues, Concerns & Lessons Learned** module.
Update every PR. Table: `issues_lessons`.

## Status
- [x] Read MODULE_CONTRACT.md + CONTRIBUTING.md
- [x] Built from the Power Apps "Issues & Concerns" app (risk-register used as the
      plain-CRUD reference)
- [x] CRUD implemented (add / edit / view / list / delete)
- [x] Project-scoped via `pd_project`; `created_by` + `project_id` stamped
- [x] `Fmt.esc()` on all user text injected into HTML
- [x] `enabled: true` set in `assets/js/config.js`
- [ ] PR opened into `main`

## Built 2026-07-17 (from the Power Apps Issues & Concerns app)

Two top-level screens (segmented topbar tabs, same chrome as Progress Photos):

**Issues & Concerns** — reproduces the Power Apps log row-for-row:
`No. · Department · Issue · Caused By · Corrective Action · Champion · Status ·
Date Presented · Days Aging · Date Resolved`. Filters: search, Status, Department,
Champion, Days-aging bucket (open / 0–30 / 31–90 / 90+). KPIs: Total / Open /
On Hold / Closed / Avg aging (open). Add/Edit modal grouped into Details · Issue ·
Lessons Learned. Statuses are **Open | On Hold | Closed** (matches the app, not the
starter table's "In Progress").

**Lessons Learned** (this module's addition) — a card library that collects every
lesson captured on an issue, so management/operations can reference them on future
projects. Each card shows the lesson category, department, date, the lesson text, an
optional recommendation, and the source issue + its status. Filters: search,
Department, Lesson category. A lead banner explains that lessons are entered from an
issue's *Lessons Learned* section, and issues carrying a lesson show a "Lesson
captured" tag in the log.

### Field mapping / decisions
- **Lessons live on the issue row, not a separate table** — a lesson is never
  divorced from the issue that produced it, and the library is just a filtered view of
  `issues_lessons` where `lesson_learned` is non-empty. This directly serves the brief:
  "take note of lessons from any issues & concerns that were logged."
- `ISSUE` text → existing `description`; `STATUS` → existing `status`. New columns:
  `department`, `champion`, `caused_by`, `corrective_action`, `date_presented`,
  `date_resolved`, `lesson_learned`, `lesson_category`, `recommendation`. `type` is set
  to `'Issue'` on insert.
- **Days Aging is DERIVED in the app** (`agingDays()`), never stored: **0 when Closed**
  (matches the app showing "0 days" for closed items), else `today − date_presented`.
  Rows open > 90 days render the aging value in red.
- Champion is free text with a datalist of values already used on the project (the app
  shows multi-name strings like "Ronquillo, Jules Norman; Agcaoili, Heherson").

## DB
- **Run migration `migrations/2026-07-17-issues-lessons.sql`** — adds the 9 columns
  above + a `(project_id, date_presented desc)` index. Idempotent; folded into
  `supabase-schema.sql`. **The new fields render blank until it runs.**

## Verified 2026-07-17
Harness-verified against a mutable in-memory store (stubbed `AppAuth`/`PDb`/Supabase;
real `Fmt`/`UI`/`Icons`; gitignored `_ui_test.html`, deleted after use) served over a
local static server and driven via DOM/JS (screenshots impossible — compositor stalled
in this env, as noted in earlier prompts):
- Project scoping (P2 rows excluded from P1); table renders the Power Apps columns;
  KPIs Total 3 / Open 1 / On Hold 1 / Closed 1 / Avg aging 131d.
- Days Aging: open Precast item = 215 days + **is-hot** (red); Closed item = 0 days.
- "Lesson captured" tag on the 2 rows carrying a lesson.
- Filters: Status=Closed → 1 row; aging 90+ → 1 row; **Clear filters button hidden
  until a filter is set**, shown when active, clears back to 3 rows and re-hides.
- Screen switch: Lessons hides the issues screen + the "+ New issue" tool, retitles the
  header, shows 2 lesson cards; lesson KPIs (captured 2 / from closed 1 / categories 2);
  category filter → 1 card; clear → 3 after a new lesson is added.
- Add/save round-trip: `type='Issue'`, `created_by` stamped (RLS), lesson persisted;
  log grows to 4 rows and the lesson appears in the library.
- Dark mode: lesson card surface `#2B2C2B` with light text (tokens adapt); no console
  errors; `x` clear icon hydrates.

## Pending
- Live click-through against a real login + the live `issues_lessons` table (needs the
  migration run first).

## 2026-08-22 — MoM UI clash, raise deadlock, Reporting view, module audit

**The UI clash (owner-reported, screenshot).** `.il-mom-actions td:first-child { width:100% }`
plus `td:nth-child(2..4)` were written when the columns were `Action | Owner | Due | Status`.
Inserting No. / Category / Type / Issue in front silently re-aimed "take all the slack" at the
**No.** column (~247px cell, 223px input) while Category crushed to "Com" and Status to "C".
Specificity (0,2,1) also beat the `.il-mom-table .il-mi-no` (0,2,0) rule meant to hold it.
Same failure class as the schedule's `_CELL_META` index drift.
⚠️ **Never size this table by position.** Every `<th>`/`<td>` now carries its own `il-c-*`
class and the CSS keys off that, so inserting a column cannot re-target a rule again.
Measured after the fix: No. 96 (input 72), Cat 184, Type 128, Issue 224, Action 264, Owner 154,
Due 169, Status 152, File 76, Register 137, Del 56; header 11 cells = body 11 cells; the
`carried` badge is `display:block` and unclipped; table 1639px scrolling **inside**
`.il-mom-tablewrap` (887 visible) with **page horizontal scroll 0** (was 198).

**⚠️ THE RAISE DEADLOCK (mine, owner-reported).** `ro = !mayEdit || locked` conflated
*permission* with the *workflow lock*. Raising requires the minute to be DISTRIBUTED (the DB
enforces it in `issues_lessons_ins`) — but the cell was gated on `ro`, which is true the moment
a minute is distributed. So a **draft** rendered a button the database always refused, and
**distributing made the button disappear**: there was no state in which an action could be
raised at all. Fixed by passing `mayEdit` and `locked` separately. Verified in all three states:
`!mayEdit` → dash; writer + draft → **disabled** button whose title says to distribute first;
writer + distributed → **live `.il-mi-raise`** — the state that was previously unreachable.

**Reporting view** (owner asked for a presentable read-only record). Session-only `_momReport`,
never persisted — it is how the record is being *looked at* right now, not a property of the
minute. The class is toggled on `#il-mom-view`, **not `<body>`**, so switching to Issues &
Concerns cannot leave the register in report mode. Verified: controls go transparent and
`pointer-events:none`, add-item / carry-over / save / delete / row-delete / delete-column all
hide, and toggling back restores the DOM **byte-identical** to before.

**Audit of the whole module.** 0 NUL bytes, parses, CSS braces 189/189, **0 functions lost**
(77 = 77 vs HEAD), no positional column selectors left (the only `:first-child` matches are a
warning comment and `.il-mom-group:first-child`), every read goes through `PDb.selectAll`
(no raw `.select()` — the 1000-row truncation class), and both `mom_items` inserts supply
`description` and an explicit `status`. `description`'s original `not null` was already dropped
by the 2026-08-21 migration, so the action-text move cannot break inserts.

⚠️ **One real find, fixed:** the item **status** select rendered `MOM_STATUSES` with no
off-list fallback, so a legacy row holding anything else would silently report **'Open'** —
the select-value trap. It is deliberately **not** routed through `momOptions()`, because that
helper always emits a blank first option and picking it would write `''` into a CHECK-constrained
column and be refused; an off-list value is appended instead. Verified: in-list selects
correctly, `'Deferred'` survives and is selected, no blank option in any of the three cases.

📌 **Noted, not changed** (a design call, not a defect): `MOM_STATUSES` (Open | In Progress |
Closed) and the register's `STATUSES` (Open | On Hold | Closed) differ. The item's own select
shows `it.status` while the filter (`momItemStatus`) and the register pill show the *linked
issue's* status, so a raised item can be filtered by "On Hold" while its select reads its own
value. The "Raised · <status>" pill makes the register's value visible on the row.

Suites re-run green after every edit: carry-over **23**, raise **10**, gaps **42** = **75**.
`MODULE_V` → `20260822b`; module assets → `?v=20260822a`.
⚠️ **Not verified signed-in** — measured in a harness against the real CSS and the shipped
functions, not through a live login.

## 2026-08-22 — One status vocabulary: the register's words win

Owner: unify the status lists, and **follow On Hold instead of In Progress**.
**⚠️ Run `migrations/2026-08-22-unify-mom-status.sql`.**

The two lists had drifted since the tables were created:

    mom_items        Open | In Progress | Closed
    issues_lessons   Open | On Hold     | Closed

That was visible to the owner, not cosmetic: raising an action had to **translate** the value
(`In Progress` → `On Hold`) on the way into the register; `momStatusFilterOpts()` had to offer
**both** vocabularies because `momItemStatus()` could return either; and a raised action could be
filtered by a word its own dropdown did not contain. The register's vocabulary wins — it is the
authoritative record of what is being chased, minutes feed it, and its word is the one the
dashboard's attention band already reads (`config.js` → `attention.values = ['Open','On Hold']`).

⚠️ **The migration's ORDER is the whole risk.** The old CHECK forbids `On Hold` and the new one
forbids `In Progress`, so neither can be added while the rows or the other constraint disagree:
**(1) drop the old CHECK → (2) move the rows → (3) add the new CHECK.** Doing (3) before (2) fails
on every in-flight action in the database. The old constraint is dropped **by definition, not by
name** — it came from an inline `check` in the create-table, so its generated name is not
guaranteed to be `mom_items_status_check` on an instance that has been through a table rewrite.
Nulls are settled to `Open` in the same pass (the column is nullable and a null renders as `Open`
in a select with no blank option, so the data is made to agree with what the screen already claims).

⚠️ **`issues_lessons` is deliberately left alone.** It already holds exactly this vocabulary and
carries **no CHECK of its own** (the column predates these migrations). Adding one is a separate
decision about a separate table and would fail on any historical row holding a word neither list
anticipated. Verify first: `select status, count(*) from issues_lessons group by 1 order by 2 desc;`

**Code: `MOM_STATUSES` is gone.** `STATUSES` (declared at the top of the same IIFE — confirmed by
checking the scope: one IIFE opens at line 23 and never closes before line 780) is now the single
list, read by the register's filter, the register's edit modal, the MoM filter and the MoM item
select. Do **not** reintroduce a MoM-only list; the CHECK now refuses `In Progress`.
- `momStatusFilterOpts()` collapses to `STATUSES.slice()` — kept as a function because it is the
  seam the filter bar and its tests both call, and `.slice()` so a caller cannot mutate the shared
  array (asserted in the suite).
- Raising no longer translates: `var st = it.status || 'Open';`
- ⚠️ **The PDF's `'in progress'` badge key is RETAINED on purpose.** An export runs against
  `MOM_ITEMS` **in memory**, so a tab opened before the migration can still print a stale value —
  and dropping the key would render it in the default grey, the same grey as Closed. One line, and
  it fails safe.
- ⚠️ The status column's **width floor was not retuned down** now that the longest option is
  shorter: the column also renders an off-list legacy value carried through by `momItemRowHTML`,
  and a floor set to the shortest possible list is a floor that crushes the first surprise.

**Verified** by executing the shipped functions: the item select offers exactly `Open, On Hold,
Closed` with **no blank option**, a legacy `In Progress` row is carried through and selected rather
than silently reporting `Open`, and the filter returns the one list. Suites re-run green — carry-over
**23**, raise **10**, gaps **44** (the gaps suite's "offers BOTH vocabularies" assertion encoded the
old behaviour and was rewritten to assert the single list, plus that `In Progress` cannot leak back
and that the options are a copy). **0 functions lost** (77 = 77). Parses; 0 NUL bytes.
- ⚠️ **`t_gaps.js` seeds `STATUSES` now, not `MOM_STATUSES`** — the harness slices the MoM region,
  and the shared list is declared 570 lines above it, outside the slice.
- ⚠️ **A wrong turn worth recording:** the first cut routed the item select through `momOptions()`.
  That helper **always emits a blank first option**, and picking it would write `''` into the
  CHECK-constrained column and be refused by the database. The select builds its options inline and
  must stay that way.

`MODULE_V` → `20260822c`; module assets → `?v=20260822b`.
⚠️ **Not verified signed-in, and the migration has not been run.**

## 2026-08-22 — Action items are CARDS, not a table (the reporting rework)

Owner, on the live screen: *"The UI needs a big rework since I need to have all of the details
for the action items to be read in one view especially during reporting"* — then, decisively:
*"this is true when viewing the minutes of meeting in the mom-app."*

That second message settled the design. **No migration.**

⚠️ **NEVER PUT THE COLUMNS BACK.** The action items were an 11-column table with
`min-width: 1400px` scrolling inside `.il-mom-tablewrap`. On the owner's own screen (a ~1490px
detail pane) the table still needed 1639px, so **Owner, Due, Status, File and the register link
all sat off the right edge behind a horizontal scrollbar** — precisely the columns someone
reporting from the screen needs to read.

⚠️ **Re-tuning the widths could not have fixed this, which is why the previous pass didn't.**
An action item has more fields than a screen has columns: any set of widths that fits them all
crushes the text fields, and any set that keeps the text readable overflows. The layout had to
stop being a row. Yesterday's per-column class work was a correct fix to the *wrong* problem —
it made the columns aim at the right cells, but eleven columns were never going to fit.

**The card mirrors mom-app's own layout — the same structure `momDownloadPDF()` already
renders:** a six-cell meta grid (No. / Category / Type / Status / Responsible / Target date)
above full-width text blocks. That is deliberate and worth preserving: the screen and the export
are now **one document**, so what a planner reads on screen is what the PDF prints. A third
bespoke on-screen layout would let the two drift, which is the drift this module has already
been bitten by twice (the mom-app category dropdowns, the two status vocabularies).

**Reporting view now renders values, not controls** (`momFieldHTML`). ⚠️ This is not cosmetic:
a single-line `<input>` **clips its own value** — measured, a 659px value inside a 416px box —
so a long Issue / Agenda was unreadable in the one mode that exists for reading it. Text wraps;
an input cannot be made to. It also stops a printed-looking record being built out of form
widgets. `overflow-wrap: anywhere` on the value means an unspaced run can never widen the card
and reintroduce the scrollbar this whole change removes.

**`description` is now on screen.** It has been a real column since the 2026-08-21 migration and
the PDF has always printed it, but the table had no column for it — so the export carried a field
the screen could not show. In reporting it appears only when it has something to say, and it is
blank when the action text *came from* `description` (a legacy row), the same rule the PDF applies.

⚠️ **Grid columns are stepped COUNTS (6 → 3 → 2), not `auto-fit`.** auto-fit with a minmax floor
packed five tracks into the pane and stranded Target date alone on a second row — never clipped,
but a 5+1 split reads as a mistake. Every step divides six exactly. At full width the tracks are
the PDF's own fractions (`0.6fr 1.5fr 0.9fr 0.9fr 1.2fr 1fr`) so Category gets the room its
longest option needs (measured 202px for "Commercial / Contracts") instead of an equal share.

⚠️ **A bug caught in my own patch before it shipped:** the No. field keeps the `carried` badge
inside its block, and my first cut did that by stripping a `</div>` off the helper's output. In
reporting the body *itself* contains a `</div>`, so it would have closed the wrong element and
broken the card. The badge is passed as an explicit `extra` argument instead.

**Verified in a browser against the real CSS**, gated on a sane viewport (⚠️ two readings were
thrown away first — one taken while the window was not compositing, reporting `clientWidth: 0`,
and one under leftover mobile emulation pinning the layout viewport at 980px; both produced
confident nonsense like "139 elements offscreen"). At 1265px: **0 fields offscreen, 0 clipped,
0 page horizontal scroll, 0 inner scroll** in both edit and reporting; all 11 fields present;
reporting = 9 values / 0 controls and the long Issue / Agenda fully wrapped; toggling back
restores the DOM byte-identical. Reflow verified at 805px (3 columns, 2 rows) and 520px
(2 columns, 3 rows) with all 11 fields still present and nothing offscreen.

Suites green — carry-over **23**, raise **10**, gaps **44**. **0 functions lost**, 1 added
(`momFieldHTML`). Parses; 0 NUL bytes; CSS braces 190/190.
`MODULE_V` → `20260822d`; module assets → `?v=20260822c`.
⚠️ **Not verified signed-in.**

## 2026-08-22 — ⚠️ THE PDF EXPORT HAD BEEN PRODUCING A BLANK PAGE ALL ALONG

Owner: *"PDF download works but format isn't working"*, with four sample files. **No migration.**

**It was not a formatting problem. Every sheet was an empty A4 page.** All four samples were
byte-identical at 3,058 bytes; the page's entire content stream was `0.567 w / 0 G` — a line
width and a stroke colour — and `/XObject <<>>` was **empty**. `html2pdf` rasterises to a JPEG,
so a file with no image is a blank page. Nothing about the layout was ever reaching paper.

⚠️ **THE EXPORTED NODE MUST BE IN NORMAL FLOW. Do not put `position:fixed` (or absolute) back
on `wrap`.** It carried `position:fixed;left:-10000px` to park itself off-screen. html2pdf clones
the source into its own container and measures it there, and **an out-of-flow element contributes
nothing to that container's height** — so html2canvas got the correct width and a height of
**zero** and rendered no image at all. Measured across positioning modes on the real library:

| `wrap` positioning        | canvas    |
|---------------------------|-----------|
| in normal flow            | 1438×360 ✅ |
| `position:fixed` off-screen  | 1438×**0** ❌ |
| `position:absolute` off-screen | 1438×**0** ❌ |
| `fixed` + explicit `height:400px` | 1438×**0** ❌ |

⚠️ An explicit height does **not** rescue it — the clone is still out of flow. That is the trap:
the element measures fine in the page (`offsetHeight` 179), so every check short of rendering it
says it is healthy.

**Fix: the off-screen parking moved to a HOLDER; the captured element stays in normal flow inside
it.** The holder hides the node, `wrap` is what gets rendered, and removing the holder still takes
`wrap` with it in the `finally`.

⚠️ **Why this survived since the export shipped:** the original verification measured the *node's*
geometry (band colour, 190mm width, grid tracks) and the DOM lifecycle, and the log said so
honestly — *"nobody has opened a generated PDF… what is proven is the render call and the DOM
lifecycle, not the visual output."* That gap was exactly where the bug lived. **Measuring the
source of a render is not verifying the render.**

**Verified end-to-end on a real produced file**, which is the check that was missing before: the
shipped `momDownloadPDF` run against the real `html2pdf@0.10.1` now writes **216,539 bytes with a
1438×1406 DCTDecode image** (was 3,058 bytes, no image), and the extracted JPEG shows mom-app's
format exactly — the `#b40000` band with the logo, project — title, date / location / item count,
the attendees and notes blocks, then one bordered card per action with the six-cell meta grid and
the coloured Type/Status badges.
- ⚠️ Two harness attempts failed silently first and neither was the module's fault: `html2canvas`
  is **not** a global in the html2pdf bundle, and intercepting `.save()` on the object returned by
  `html2pdf()` misses, because `.set()` returns a **different** worker — the interception has to
  patch the worker **prototype**. The first failed attempt wrote a real file to Downloads.

Suites green — carry-over **23**, raise **10**, gaps **44**. **0 functions lost** (78 = 78).
Parses; 0 NUL bytes. `MODULE_V` → `20260822e`; `module.js?v=20260822d`.
⚠️ **Not verified signed-in** — proven against the shipped exporter and the real library with
fixture data, not through a live login on real minutes.
