# Module: issues-lessons

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
