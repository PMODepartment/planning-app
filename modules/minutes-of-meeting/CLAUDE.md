# Module: minutes-of-meeting

## 2026-09-12 (c) — Carry-over asks only for what differs; the Schedule tile gets its own time; Date and Venue merge in the meeting view

Owner's four-item refinement of the previous round's Regular/Irregular work. **No migration.**

1. **"if meeting is already recurring, when carrying over meeting, ask only for the next date and
   time. other fields no need to ask, just copy the previous details including schedule, attendees,
   title, agenda, open minutes."** `openNextMeetingModal`'s `isRecur` branch drops Title, Venue,
   Meeting link and the Required/Optional attendee pickers entirely — it now asks for **Date, Start
   time, End time** and nothing else. `createNextOccurrence` reads title/venue/link/attendees
   straight off `sch`/`seed` instead of DOM inputs that no longer exist; the schedule itself
   (`schedIdToUse`) is untouched, since this branch never touches `mom_schedules` at all.
2. **"if meeting is not recurring, when carrying over meeting, ask for schedule: if regular or
   irregular. if regular, ask for start date, end date, frequency as usual. ask also for next date.
   if irregular, just ask for next date and time. other fields no need to ask, just copy previous
   details including title, agenda, attendees, open minutes."** The `!isRecur` (promotion) branch
   drops the same fields (Title/Venue/Link/Attendees). What remains: a **Schedule** select
   (Regular/Irregular); **Regular** shows Series start date, Series end date, Frequency + rule
   fields, plus a **Date** field for the next meeting — no time; **Irregular** shows only Date +
   Start time + End time. ⚠️⚠️ A Regular series' time is not asked here at all — it is silently
   carried from the seed meeting's own `start_time`/`end_time`, the same as venue/attendees, since a
   Regular series' fixed meeting time is now captured once, on the schedule itself (item 3).
3. **"the Schedule input group must only contain start and end dates, time, frequency and Must only
   be for recurring meetings."** `openAddMeetingModal`'s `#il-am-schedtile` gains its own **Start
   time \* / End time \*** fields (new ids `il-am-schedstart`/`il-am-schedend`, distinct from the
   one-time-meeting row's `il-am-start`/`il-am-end`, which live in a different tile and would
   otherwise collide) — required, validated in `validateAddMeeting`. ⚠️⚠️ **This reverses the
   previous round's own reasoning** ("each occurrence's own start/end time is set on the meeting
   itself, once it exists" — deleted along with the note paragraph that said so): a recurring
   meeting happens at ONE fixed time every occurrence, so asking for it once, as part of defining
   the series, is more honest than asking a fresh instance every time an occurrence is created.
   `saveAddMeeting` reads `isRecur ? g('il-am-schedstart') : g('il-am-start')` (and the `-end`
   equivalent) so the right field feeds both the schedule's own `start_time`/`end_time` and the
   first occurrence's (item 5 from the previous round, unchanged).
4. **"the date, planned start and finish time and actual start and finish time should be combined
   with the venue group as date and venue."** `momDetailHTML`'s separate **Schedule** tile (Date,
   Start time, End time, Actual start, Actual finish) and **Venue** tile (Venue, Location, Meeting
   link, Recording) merge into one **Date and Venue** tile — no field, id, or writer changed, only
   which box each renders inside. Unlike item 3, this is the per-MEETING Detail view, unconditional
   on recurring/non-recurring — every meeting's own record shows one merged tile.

### Verified
`node --check` clean; CSS unchanged this round (357/357 braces, no edits to `module.css`); every new
id (`il-am-schedstart`, `il-am-schedend`, `il-nx-schedwrap`, `il-nx-timewrap`, `il-nx-timeendwrap`,
`il-nx-sstart`, `il-nx-send`) appears exactly once in the template it belongs to; `il-nx-date`/
`il-nx-start`/`il-nx-end` appear twice in source but inside mutually-exclusive `isRecur` ternary
branches, so at most one set ever renders into the DOM at once; repo-wide grep confirms zero
remaining references to the removed `il-nx-title`/`il-nx-venue`/`il-nx-link`/`nx-req`/`nx-opt`.

⚠️ **Not verified signed in** — no live login is possible in this environment. No live carry-over
(existing series, or promoting a plain meeting, regular or irregular) or "+ Add meeting" save against
real data.

`module.js?v=` → `20260912i` (`module.css` unchanged this round, stays `20260912h`). No `MODULE_V`
bump — no shared asset touched.

## 2026-09-12 (b) — Table-view drag, the item-level carry-over button retired, an icon-only Present toggle, required meeting type, a real first occurrence for a new series, and Regular/Irregular scheduling

Owner's nine-item list, all against this module. **No migration.**

1. **"in minutes list table view, allow drag to reorder."** `momItemsTableHTML(vis, canDrag)` now
   takes the same `canDrag` test `momItemRowHTML` already computes (`!ro && !momFilterOn() &&
   !_momReport`, now hoisted once in `momDetailHTML` so Card and Table can't disagree on it) and
   emits a leading grip column — the same `momDragGripHTML`/`data-reorder-row` shape the Card view
   already uses. ⚠️⚠️ `wireMinuteDrag(host, momId)` no longer requires a `.il-mi-cards` wrapper —
   it now looks for `[data-reorder]`/`[data-reorder-row]` across the whole detail HOST, which
   covers either view without caring which is on screen (Card and Table never render at once).
2. **"in minutes list, remove the carry over button as this has been moved to the meeting."** The
   item-level "Carry over…" button (`#il-mom-carrygo` → `openCarryOverModal`, which pulled
   still-open minutes IN from another meeting) is deleted along with the modal function — "Carry
   over to next meeting" in the toolbar (`#il-mom-carrynext`) is the one carry-over control now.
   ⚠️ `momCarryable`/`momCarryOver` are untouched and still called from `createNextOccurrence` —
   only the button and its own modal are gone, not the underlying carry mechanism.
3. **"for the present button in the meeting, remove the text label. instead of eye icon, use
   slides icon."** `#il-mom-report` drops `.il-mom-modetxt` and its Present/Exit text; a new
   `slides` glyph (`assets/js/icons.js` — a presentation screen on a stand, distinct from `eye`,
   which reads as "view/watch" rather than "present") replaces `eye`. `.il-mom-modebtn`'s CSS
   collapses to the same 34×34 square every other icon-only toolbar button already uses, keeping
   only the class name (so the active-state colour rule `.il-mom-report .il-mom-modebtn` still has
   something to key on) — the `title`/`aria-label` still name the action in full.
4. **"for adding new meeting, meeting type is required. meeting agenda is also required at least
   1."** Agenda was *already* required (`validateAddMeeting`'s `agendaValuesOf(root).length`
   check, unchanged). Meeting type (the Internal/External select, literally labelled "Meeting
   type" — not "Meeting description", which is the free-text field mapped to the `meeting_type`
   column) previously always carried a value with no blank option, so "required" was true only by
   accident of a forced default. It now opens on a real blank `— Select —` option, validated in
   `validateAddMeeting`.
5. **"when creating a new recurring meeting, use the date of the first applicable meeting."**
   ⚠️⚠️ **Before this, creating a recurring series inserted ONLY a `mom_schedules` row — no
   occurrence at all.** Since the 2026-09-12(a) removal of the series page, `momUnifiedRows` shows
   only a schedule's own occurrences, never a bare schedule row — so a brand-new series existed in
   the database and was completely unreachable from the Meetings List, findable only by opening the
   Calendar in the right month and clicking its dashed "planned" chip. `saveAddMeeting`'s recurring
   branch now also inserts the FIRST real `meeting_minutes` occurrence, dated to
   `schedNextOccurrence(schedule, schedule.start_date)` — never the raw typed "Series start date",
   which is only a lower bound (`schedDatesInRange` finds dates ON OR AFTER it, not necessarily AT
   it — a start date landing on a Tuesday is not itself a meeting date for a Wednesday-weekly
   schedule). The agenda items collected in the modal are seeded onto this first occurrence through
   a new `momSeedAgendaItems(momId, agenda)` helper, factored out of the non-recurring branch's
   identical loop so there is one copy of "turn an agenda array into real `mom_items` rows," not two
   subtly different ones.
6. **"change the input group of venue to date and venue. for non-recurring meetings, the schedule
   inputs are moved to this new group. for recurring meetings, the date and time in the date and
   venue field stays in the meeting view."** In `openAddMeetingModal`: the "Venue" tile is renamed
   **"Date and Venue"** and gains the Date/Start time/End time row — but only for a **one-time**
   meeting (`#il-am-datetimewrap`, hidden the moment Recurring is checked). The old "Schedule" tile
   (Series start/end date, Frequency, rule fields) now exists **only** while Recurring is checked
   (`#il-am-schedtile`, hidden as a whole tile rather than field-by-field) — for a recurring series
   there is no per-occurrence date/time question in this form at all; each occurrence's own
   start/end time is set "in the meeting view" (`momDetailHTML`'s own Schedule tile) once it exists,
   which is exactly item 5's newly-created first occurrence and every later one.
7. **"when adding a recurring meeting, ask input from user if schedule will be regular or
   irregular beside the recurring input. if irregular, no need for the schedule input group."** A
   `Regular schedule | Irregular` select (`#il-am-regularity`) appears beside the Recurring checkbox
   once it is ticked. Irregular hides `#il-am-schedtile` entirely (no Frequency, no rule fields, no
   Series start/end date) and writes `mom_schedules.frequency = 'irregular'` with `start_date =
   momToday()` — there is no cadence to store, only the fact that the meeting recurs on no fixed
   pattern. ⚠️⚠️ `frequency` carries **no CHECK constraint** (`text not null default
   'monthly_date'`), so `'irregular'` is a legitimate value to write, but `schedDatesInRange` had to
   be taught it explicitly: without the guard, `'irregular'` would fall through to the `else` branch
   and be silently treated as `monthly_date`, inventing a monthly cadence nobody asked for.
   `schedDatesInRange` now returns `[]` for it (so `schedNextOccurrence` always answers `null`, and
   the Calendar's planned-chip prediction correctly shows nothing to predict), and
   `schedFrequencyLabel` reads "Irregular — no fixed schedule" instead of computing garbage off a
   weekday/ordinal/day-of-month that was never set.
8. **"when a non-recurring meeting is carried over, ask user if regular or irregular. if regular,
   ask for schedule. if irregular, just ask for next meeting date and time. other details like
   venue, attendees, agenda will be carried over along with the open minutes."** This is
   `openNextMeetingModal`'s promotion path (`opts.seedMom` set, no `opts.schedId` — a plain
   meeting's own "Carry over to next meeting" button). It gains the identical Regular/Irregular
   select (`#il-nx-regularity`), which toggles `#il-nx-freqwrap`/`#il-nx-rulewrap` off for
   Irregular — the same "no need for the schedule input group" rule as item 7, applied to promoting
   an existing meeting rather than creating a fresh one. ⚠️⚠️ **The modal had no Start/End time
   fields at all before this** — added (`#il-nx-start`/`#il-nx-end`, defaulting from the seed
   meeting's own `start_time`/`end_time`) so "next meeting date and time" is something this screen
   can actually ask for. Venue/link/attendees already defaulted from the seed; the seed's own
   `meeting_minutes.agenda` (the topic-headline jsonb list, distinct from its `mom_items` rows —
   those are what `momCarryOver` brings across separately as "the open minutes") now travels
   forward onto the new occurrence too, the one thing in this list that was not already carried.
9. **"when a recurring meeting is carried over, ask user for next meeting date. if recurring, use
   the next date in sequence by default. carry over all other details including open minutes."**
   ⚠️ **Already true before this pass** — `openNextMeetingModal`'s `isRecur` (`opts.schedId` set)
   branch already defaults `Date` to `schedNextOccurrence(sch, momToday())` and already carries
   venue/link/attendees from the schedule's last occurrence, with `momCarryOver(seed.id)` bringing
   forward whatever is still open. It now additionally gets the Start/End time fields and the
   agenda carry-over built for item 8 (both sit outside the `isRecur` branch, so they apply
   uniformly), and — via item 7's fix — a schedule that happens to be Irregular now correctly falls
   back to `plusDaysISO(seed.meeting_date, 7)` for its default next date (since
   `schedNextOccurrence` answers `null` for it) instead of silently computing a monthly-cadence date
   nobody set.

### Verified
`node --check` clean on `module.js`, `assets/js/icons.js`, `assets/js/modules-grid.js`; CSS brace
balance holds (357/357) and every `/* … */` opened is closed (90/90); 0 NUL bytes across every
touched file; every new dynamically-emitted id (`il-am-schedtile`, `il-am-datetimewrap`,
`il-am-regwrap`, `il-am-regularity`, `il-nx-regularity`, `il-nx-freqwrap`, `il-nx-start`,
`il-nx-end`) appears exactly once in the template it belongs to; repo-wide grep for
`openCarryOverModal`/`il-am-recurwrap`/`il-am-datewrap`/`il-am-sstartwrap`/`il-am-sendwrap` —
zero remaining references outside this changelog's own historical entries; `momCarryable`/
`momCarryOver` confirmed still called from `createNextOccurrence` after the button removal.

⚠️ **Not verified signed in** — no live login is possible in this environment. No live drag in the
Table view, no live creation of a first occurrence (regular or irregular), and no live "Carry over
to next meeting" round-trip (either direction) against a real project.

`module.css`/`module.js?v=` → `20260912f`; shared `assets/js/icons.js?v=` → `20260912f` (22
referencing pages); `MODULE_V` (via `modules-grid.js?v=` on `dashboard.html`/`modules.html`) →
`20260912f`.

## 2026-09-12 — The Meetings List drops manual order, the Minutes list gets a real drag gesture, and recurring meetings stop having a second screen

Owner's three items: (1) "for meeting list, no need to allow drag to reorder. by default, sort by
date with favorite always at top"; (2) "for minutes list, allow drag to reorder"; (3) a full rewrite
of the recurring-meeting workflow — a read-only Recurring tickbox on every Meetings List row, a
meeting history table after the minutes, clicking a previous meeting opens it as an ordinary
meeting, the Meetings List shows only the latest occurrence of a series, and a "carry over to next
meeting" button that also promotes a non-recurring meeting into a recurring one.

### 1 — Meetings List: back to column sort, favorites always on top

The **⋮⋮** manual-order column shipped only hours earlier the same day (round 2, "in list mode,
allow also drag to reorder") is gone: `momOrderCmp`/`momListDragTh`/`momWireReorder` are deleted,
`momSortedRows` no longer has a `'manual'` branch, and the sort-header click handler no longer has
a special case for it. The list is back to what it was before that round — click any column to sort
it, favorites partitioned to the top of whichever sort is active — which is exactly what the owner
asked for. ⚠️ `migrations/2026-09-11-mom-list-reorder.sql` (the `sort_order` columns on
`meeting_minutes`/`mom_schedules`) is left in place as inert history rather than deleted or reverted
— this repo does not rewrite a migration once it may have been run, and an unused nullable column
costs nothing.

### 2 — Minutes list: drag-to-reorder, converted to Pointer Events

⚠️⚠️ **This ALREADY existed, and it already didn't work on touch.** `wireMinuteDrag`/
`persistMinuteOrder` (2026-09-02) were pure HTML5 `draggable`/`ondragstart`/`ondragover`/`ondrop` —
which never fires on a touch device at all, the same defect this app's history has now recorded and
fixed twice this same day for Issues & Concerns / Lessons Learned. So "allow drag to reorder" reads
as "make the drag that is already there actually work everywhere," not as a feature to build from
nothing.

Converted to Pointer Events (`pointerdown`/`pointermove`/`pointerup`/`pointercancel`), the identical
mechanism and class names (`.il-draghandle`/`.il-reorderable`/`.il-dragging`/`.il-drop-before`/
`.il-drop-after`, `data-reorder`/`data-reorder-row`) `issues-lessons/module.js`'s own
`wireReorder`/`applyReorder` use — each module keeps its own copy per MODULE_CONTRACT.md, but the
shapes now match exactly. `momDragGripHTML(id)` (already built earlier the same day for exactly this
purpose) supplies the grip; `momItemRowHTML` puts `data-reorder-row` directly on the `.il-mi-card`
itself rather than a separate grip-only target, so the whole card is the drop zone, not just the
small glyph. The write is `applyMinuteReorder`, over `mom_items.seq` — `momVisibleItems(momId)` is
the ordered set (drag is only offered while nothing filters the meeting's minutes, so this is always
every minute, never a filtered subset whose seq math would leave hidden rows ambiguous), written
sequentially rather than via `Promise.all` (the same rule "Get from issue" already follows for
numbering writes — overlapping requests racing onto one sequence is worse than the small delay of
writing in order).

⚠️ `pointerup` and `pointercancel` are two separate handlers, not one that always commits — a cancel
(the OS taking the gesture for something else) is exactly when a card is likely still marked from
the last move, and has to abort with no write.

### 3 — Recurring meetings: no more series page

Owner: *"in meeting list, there is error in workflow regarding recurring and non-recurring
meetings."* The error was architectural: a recurring schedule (`mom_schedules`) was its own kind of
row in the unified Meetings List (`kind: 'series'`), opened onto its own screen
(`momOpenSeries`/`renderSeriesPage`/`wireSeriesPage`) with its own CRUD
(`scheduleFormSave`/`scheduleDelete`) and its own "+ Add a meeting" form
(`scheduleCreateOccurrence`/`scheduleOccFormHTML`) — a second browsing surface next to the one that
already existed for ordinary meetings, and every occurrence of a series lived only inside that
second surface's own "Meetings held" table, never in the list itself.

⚠️⚠️ **All four of those functions, and `scheduleFormHTML`/`scheduleOccFormHTML`, are deleted.**
Every occurrence of a recurring schedule is a REAL `meeting_minutes` row now
(`schedule_id` set), and it opens exactly like any other meeting — there is nothing left for a
series page to do.

- **A read-only Recurring tickbox column** in the Meetings List (`momUnifiedRows`'s `recurring`
  field, `.il-mom-rectd`), a disabled checkbox — nothing on this screen can toggle it; the only way a
  meeting becomes recurring is the promotion path below.
- **`momUnifiedRows` shows only the LATEST occurrence per schedule** — a small map from
  `schedule_id` to whichever of its meetings has the latest `meeting_date` — "from the meeting list,
  details of the recurring meeting should just reflect the latest occurrence."
- **`momHistorySectionHTML(mom)`** — a "Meeting history" table after the Minutes section, on a
  recurring occurrence only (`isRecurOcc`). Every meeting under the same schedule
  (`schedMeetingsOf`), current row named and non-clickable, every other row opening via
  `momOpenMeeting` — "as a normal meeting," per the owner's own wording, since that is exactly what
  `momOpenMeeting` already does for any row. "The history then shows all meetings linked including
  the latest one" — the table lists every occurrence, current one included.
- **"Carry over to next meeting"** — one icon button (`redo`) in the Detail toolbar, beside
  Email/Distribute, gated on `mayEdit` like every other write control on the card.
  `openNextMeetingModal(opts)` takes `{schedId}` (an existing series' own button, or a Calendar
  planned-chip click, `presetDate` naming the exact day clicked) or `{seedMom}` (a plain meeting's
  own button, no schedule yet). `createNextOccurrence` does the write:
  - **`schedId` set** — inserts the next `meeting_minutes` row under that schedule, exactly as
    `scheduleCreateOccurrence` used to.
  - ⚠️⚠️ **`schedId` absent — "if current meeting is non-recurring, hitting the carry over button
    will make the meeting a recurring one."** A brand-new `mom_schedules` row is inserted, anchored
    on the SEED meeting's own date (`start_date: seed.meeting_date`, not today — so the series reads
    as starting from the meeting that was just carried forward) and its default weekday derived from
    that same date (`utcDow`), not a bare Monday. The seed meeting is then retroactively updated
    (`schedule_id` set on it) — the promotion. Only then is the next occurrence inserted under the
    new schedule.
  - Both branches finish the same way `scheduleCreateOccurrence` did: `momOpenMeeting` (so
    `momCarryOver` — which reads its fields off the Detail form's DOM — has a form to read),
    `momPullIssues` quietly, then `momCarryOver(seed.id)` to bring forward whatever is still open.

⚠️ `reRenderMomHost`/`momToggleFavorite` are simplified to `meeting_minutes` only — there is no
second "kind" left to branch on, since `momUnifiedRows` only ever emits meeting rows now. The three
list-export functions (`momExportListHTML`/`momExportListXLSX`/the PDF's `autoTable` body builder)
that used to test `r.kind === 'series'` now test `r.recurring`, the field `momUnifiedRows` actually
emits.

### CSS

`.il-mom-dragth`/`.il-mom-dragcell`/`.il-mom-sortnote`/`.il-mom-sortnote button` (the Meetings List's
own manual-order chrome) are removed; the shared `.il-draghandle`/`.il-reorderable`/`.il-dragging`/
`.il-drop-before`/`.il-drop-after` set survives unchanged, since the Minutes list's drag now uses it
too. `.il-mi-card[draggable="true"]`/`.il-mi-draghandle` (HTML5-drag-specific) become
`.il-mi-card.has-drag`/`.il-mi-card > .il-draghandle`; the card-specific `.is-dragging`/`.drop-before`/
`.drop-after` rules are removed since `data-reorder-row` sits directly on the card and the shared
2px drop-mark rules already cover it. New `.il-mom-rectd`/`.il-mom-opencell`,
`.il-mom-history`/`.il-mom-histrow`/`.il-mom-histcur`/`.is-current`. ⚠️ The series page's own CSS
(`.il-mom-seriescard`/`-seriesheadrow`/`-seriestitle`/`-seriesmeta`/`-seriesacts`/`-seriespast`,
`.il-mom-recur`, `.il-mom-schedpasti`, `.il-mom-schedform`/`.il-mom-occform`/`-schedform-acts`) is
removed with the functions that emitted it. ⚠️ Also removed: a whole block
(`.il-mom-schedpanel`/`-schedhead`/`-schedbody`/`-schedlist`/`-schedright`/`-schedrow`/`-schedpast`/
`-schedpasti`/`-schedform`/`-occform`/`-schedform-acts`) that was **already dead** before this
change — an even earlier always-visible schedule panel superseded by the series page on 2026-09-02 —
found and removed while touching this exact area, rather than left as rot.

### Verified

`node --check` clean on `module.js`; CSS brace balance holds (357/357) and every `/* … */` comment
opened is closed (89/89); repo-wide grep for every deleted identifier
(`momOpenSeries`/`renderSeriesPage`/`wireSeriesPage`/`scheduleFormSave`/`scheduleDelete`/
`scheduleCreateOccurrence`/`scheduleFormHTML`/`scheduleOccFormHTML`/`momOrderCmp`/`momListDragTh`/
`momWireReorder`/`_seriesSel`/`_schedFormOpen`/`_schedFormDraft`/`_schedOccOpen`/`_schedOccDraft`/
`_momCameFromSeries`) — zero remaining references outside this changelog's own historical entries.

⚠️ **Not verified signed in** — no live login is possible in this environment. No live click-through
of the promotion path (a plain meeting becoming a recurring series), the Meeting history table, or
the Pointer-Events drag on the Minutes list against real data.

`module.css`/`module.js?v=` → `20260912e`; `MODULE_V` (via `modules-grid.js?v=` on
`dashboard.html`/`modules.html`) → `20260912e`.

## 2026-09-11 (round 2) — The Meetings List gets manual drag-to-reorder, and the dashed divider becomes real tiles

**Run `migrations/2026-09-11-mom-list-reorder.sql`.** Owner's two follow-ups on the same day's
earlier round: (1) "in list mode, allow also drag to reorder"; (2) "the breaker as a dashed
horizontal line is not enough. place each input group in separate tiles instead."

### 1 — Manual order for the Meetings List, alongside its existing column sorts

The List view already sorted by Title/Date/Attendees/Location/Minutes, defaulting to Date
descending, with favorites always pinned to the top of whichever sort was active. There was
nowhere for a planner's own, hand-picked order to live — dragging a row did nothing, because
nothing recorded what "dragged" would even mean here.

- A new **⋮⋮** column, leftmost, doubles as its own toggle: clicking its header switches the List
  sort to `'manual'`. In that mode every row grows the same drag grip
  (`momDragGripHTML`/`momWireReorder`) the Issues & Concerns / Lessons Learned register already
  uses — Pointer Events, not HTML5 `draggable` (which never fires on a touch device at all), so one
  gesture works for mouse, touch and pen. A note above the table ("Manual order — drag rows to
  rearrange.") carries a **Sort by date instead** link back out.
- ⚠️⚠️ **The List mixes TWO tables in one sequence** (`meeting_minutes` for standalone/recorded
  meetings, `mom_schedules` for recurring series — `momUnifiedRows()`), so the new `sort_order`
  column exists on **both** (`migrations/2026-09-11-mom-list-reorder.sql`, additive, idempotent) and
  shares one numbering space by convention: dragging a meeting row past a series row renumbers both
  tables together, spaced by 10 (the same idiom as `mom_items.seq` and
  `2026-09-01-issues-lessons-reorder.sql`). A drag's write is per-row, addressed to whichever table
  that row's `kind` says it belongs to.
- ⚠️⚠️ **Manual order deliberately does NOT keep favorites pinned to the top**, the one place it
  differs from every other List sort. Every other sort partitions into favorite/non-favorite halves
  and sorts each with the same comparator (`momSortedRows`) — layering the pin OVER the sort. Doing
  that here would mean a row dropped just above a favorite silently lands somewhere else instead;
  the drop position lying about the result is a worse surprise than a starred row simply not
  floating to the top while its order is being set by hand. The star still filters
  (`_momBrowseF.fav`) and still renders; it just stops being an ordering rule for as long as manual
  order is the active sort. Documented at length above `momSortedRows` in module.js, and in the
  migration's own header comment.
- ⚠️ Rows with no `sort_order` yet fall back to the List's own existing date-based order (newest
  first) — `momOrderCmp` mirrors `issueOrderCmp`/`lessonOrderCmp`'s null-handling exactly, nulls
  sorting after any explicitly ordered row.
- ⚠️ A completed drag mutates the underlying `MOMS`/`SCHEDULES` array objects directly (not just the
  transient sorted-row copy), or the very next repaint — anything that calls `renderBrowse()` again
  before a reload — would silently snap the row back to its pre-drag position.
- Verified by slicing `momOrderCmp`/`momSortedRows`/`momWireReorder` out of the shipped file and
  executing them against DOM/table mocks (a `Function`-constructor closure standing in for
  `document`/`SCHEDULES`/`MOMS`/`sb`/`renderBrowse`, the same technique used to verify
  issues-lessons' equivalent below): a meeting dragged onto a series row writes **both** tables in
  one pass, in the correct order, updates the in-memory rows, and calls `renderBrowse()` exactly
  once; hovering the row being dragged marks nothing; a `pointercancel` clears every mark and commits
  no write, even when a drop target was already highlighted at the moment of cancellation (a case
  that failed on the first draft of this code — see the matching note in issues-lessons/CLAUDE.md,
  the identical mistake made in both modules' drag code the same day and fixed the same way in both).
- ⚠️ **Not verified signed in** — no drag has been run against a real project, and the migration has
  not been run from here.

### 2 — Six named sections, six tiles

⚠️⚠️ **The dashed divider this replaces shipped the SAME DAY, hours earlier**, as the fix for a
comment that had wrongly claimed the Detail view already carried it (see entry below). The owner,
looking at that fix: "the breaker as a dashed horizontal line is not enough. place each input group
in separate tiles instead." A dashed rule is still just a line running between two areas that
otherwise look identical to the page around them; a box — its own border, its own background, its
own margin — reads as a distinct block at a glance, which a line only does on close inspection.

- New `.il-mom-sectile` (module.css): border + `--pd-radius-md` + `var(--pd-bg)` background + its
  own top margin — lifted **verbatim** from `.il-mom-actions` (the Minutes section), which has been
  boxed exactly this way since before this pass. One look for all six groups, not five sections
  matching each other and a sixth (Minutes) that already happened to match by coincidence.
- Details / Schedule / Venue / Attendees in `momDetailHTML`, and Details / Schedule / Venue /
  Attendees / Agenda in `openAddMeetingModal` (the "+ Add meeting" modal — the two forms are meant
  to "read as one system," per the modal's own long-standing comment, so both got the tile treatment
  together rather than leaving one on the old dashed rule), are each now wrapped in their own
  `<div class="il-mom-sectile">`. `.il-mom-agenda` (the Detail view's Agenda section, found by its
  own id since `momApplySlides()` looks it up as `#il-mom-slide-agenda` to treat it as one whole
  reporting-view slide) picked up the identical box styling in its own rule rather than being
  wrapped a second time.
- ⚠️ The old `.il-mom-slides .il-mom-agenda { border-top:0; ... }` override — needed only because a
  dashed top border reads as "there is content above me," which is false once Agenda is its own
  full-screen slide — is removed rather than adapted. `.il-mom-actions` has never zeroed its own box
  while presenting, and the agenda tile now follows that same, already-established precedent: a
  boxed section is just a boxed section, slide or not.
- Verified by manual div-by-div balance inspection of every edited boundary (a `<div class="pd-field">
  ...<div class="il-mi-val">...</div></div>` construct inside the conditional Notes block makes a
  naive automated string-literal-extraction check unreliable on `momDetailHTML` specifically — it
  reported a false imbalance that line-by-line reading disproved; `openAddMeetingModal`, simpler and
  with no such nested conditional, cross-checked clean via the same automated method: 32 open / 32
  close `<div>`, 5 open / 5 close `<h4>`, 5 `.il-mom-sectile` occurrences) and `node --check`.
- ⚠️ **Not verified signed in.**

`module.css`/`module.js` → `?v=20260911d`; `MODULE_V` (via `modules-grid.js?v=` on
`dashboard.html`/`modules.html`) → `20260911d`.

## 2026-09-11 — A Card/Table switcher for the Minutes list, real section dividers, and the minute number stops being typed

Owner's three items: (1) "when opening a meeting, the minutes are usually in tiles, provide also
switcher to convert to table"; (2) "provide cleaner breaker between input groups of details,
schedule, venue, attendees, agenda, and minutes"; (3) "for the minutes number, make this
non-editable. define this automatically based on order of minutes."

### 1 — Card stays the editor; Table is a new, honest alternate

⚠️⚠️ **The card list carries a standing warning not to become a table** ("THIS IS A CARD LIST, NOT
A TABLE, AND IT MUST STAY ONE" — an 11-column table on this data hid Owner/Due/Status/File/the
register link behind a horizontal scrollbar, because an action item has more fields — a workflow
panel, attachments, a lesson link, its own audit history — than any table row can hold). That
warning is about the ONE layout being a table; it says nothing against offering a second,
narrower VIEW alongside it. New `momItemsTableHTML(vis)` is exactly that: a plain, six-column
scan table (No. / Status / Responsible / Target date / Issue-Agenda / Action item), through the
shared `.pd-tablewrap`/`.pd-table` convention this app already uses for a wide table (scroll
horizontally, never reflow), with no editing control of its own — every cell is text. Clicking a
row switches back to Card view and scrolls to that minute (a short flash outline marks it), which
is where the workflow buttons, attachments, lesson link and history actually live.

- A small `.il-viewtoggle`/`.il-vt-btn` pair (this module's own existing List/Calendar toggle
  chrome, reused rather than inventing a third pattern in one file) sits beside the "Minutes"
  heading, gated on there being at least one minute.
- ⚠️⚠️ **Hidden while presenting.** `momApplySlides()` steps through `.il-mi-card` elements
  directly, one per slide — there is no `.il-mi-card` in the DOM at all while the Table view is
  showing, so the toggle disappears during Present and the render forces Card regardless of the
  stored preference (`!_momReport && _minutesView === 'table'`), or the slide deck would have
  nothing to step through.
- ⚠️ The heading's `<h4>` is now wrapped in `.il-mom-minhead` (a flex row holding the heading and
  the toggle). `.il-mom-slides .il-mom-actions > h4` — the rule that hides this heading's row
  while presenting — was a **direct-child** selector, so wrapping the `<h4>` silently broke it;
  fixed to target `.il-mom-minhead` instead. Caught by re-reading every combinator using
  `.il-mom-actions >` in the stylesheet, not by rendering it.

### 2 — The Detail view's own section headings get the divider the Add-meeting modal always had

⚠️⚠️ **The comment above the Add-meeting modal's divider rule already claimed the Detail view had
"the same weight" — it did not.** `.il-am-form .il-mom-sechead:not(:first-child)` (the dashed
break between Details/Schedule/Venue/Attendees/Agenda) was scoped to `.il-am-form` alone; the
Detail view's own identical headings live inside `.il-mom-detail-card`, which was never covered,
so the six named sections there had nothing but the base rule's plain 8px bottom margin between
them. Extended the same selector to also match `.il-mom-detail-card .il-mom-sechead:not(:first-
child)` — one rule, one visual language, both forms. Agenda and Minutes already draw their own
divider/box (`.il-mom-agenda`, `.il-mom-actions`) and are unaffected either way.

### 3 — the minute No. is derived from order, never typed

Owner: "for the minutes number, make this non-editable. define this automatically based on order
of minutes." The No. field was a free-text `<input data-f="item_no">`; it is now a static
`<div class="il-mi-val">`, in both edit and report mode, showing the exact same fallback
expression every other reader of this number already uses (the list view, the PDF/export
builders, the slide label): `it.item_no || String((it.seq == null ? i : it.seq) + 1)`. ⚠️ A
hand-typed `item_no` from before this change still reads back — legacy data is never silently
discarded — but nothing can type a new one; the only way a minute's number changes now is
reordering it (drag-to-reorder, `persistMinuteOrder`, already the module's own mechanism for
`seq`).

### Verified

`momItemsTableHTML` executed against a fixture (a Blank/legacy/linked-issue row apiece) sliced
straight out of the shipped file: 3 rows, the carried badge, the Linked marker reading the
register's live status, and the `il-mt-blank` placeholder all present and correctly gated.
`node --check` clean on both `module.js`; braces balanced (371/371); 0 NUL bytes across every
touched file. Grepped every `.il-mom-actions >` combinator in the stylesheet before editing, to
make sure wrapping the heading did not silently break a sibling rule (it did — see item 1 above,
fixed in the same commit rather than left for the next person to find).

⚠️ **Not verified signed in** — no live login is possible in this environment, the standing
constraint for every UI pass in this repo. No live click-through of the Card/Table toggle, the
row-click-to-edit jump, or the new section dividers against a real meeting.

`module.css`/`module.js?v=` → `20260911c`. No `MODULE_V` bump — `index.html`'s structure is
unchanged, only the two module-local asset versions moved.

## 2026-09-09 (u2) — The PDF stops being a screenshot; `hidden` starts working; text wraps

Owner's six Minutes-of-Meeting items. Stage 2 of a five-stage pass.

### ⚠️⚠️ 1+5 — The export was a PHOTOGRAPH of the screen, so no CSS could fix it

The reported *"texts are not properly wrapped and spilling over the page"* was not a CSS bug in the
export. `momDownloadPDF` was `html2pdf().from(node).save()` — html2canvas rasterises the DOM and jsPDF
pastes the bitmap in. **Every page was one JPEG.** Established by opening the owner's own attached file
(`Meeting_Aug_28__2026_MOM.pdf`) and reading its bytes: `Producer (jsPDF 2.3.1)`, two `/DCTDecode`
streams at 1438×2096, **0 text-showing operators**, 341.5 KB. The 400-character run ran off the right
edge and was clipped **inside the picture**, where a stylesheet cannot reach it.

**Rewritten to draw natively with jsPDF + autoTable.** Wrapping is now a property of the renderer —
`splitTextToSize` cannot overflow — rather than something the CSS has to get right.

| | old (raster) | new (native) |
|---|---|---|
| size | **341.5 KB** | **21.1 KB** |
| pages | 2 | 2 |
| full-page JPEGs | **2** | **0** |
| selectable text ops | **0** | **103** |

⚠️ **jsPDF is NOT obtainable from the html2pdf bundle**, which the first plan assumed. MEASURED: with
only `html2pdf.bundle.min.js` loaded, `window.jspdf` is `undefined` and `html2pdf.jsPDF` does not
exist. `index.html` now loads `jspdf.umd` + the autotable plugin and **drops html2pdf entirely** —
it had no other caller here. The two other modules that load it are untouched.

⚠️ **The logo was 93.5 KB of a 104.5 KB export** on the first cut — `logo-white.png` is 6846×1178 and
the band draws it 42mm wide. It is now re-drawn through a canvas at print resolution before it reaches
`addImage`, and given a fixed alias so jsPDF stores one copy for the whole document: **10.1 KB**.
⚠️ PNG, not JPEG — the wordmark is white on transparent and sits on the red band; JPEG has no alpha
and would have put a white box across the header.

⚠️ **The four raster helpers are DELETED, not left dead** (`MOM_PDF_BADGE`, `momPdfBadge`,
`momPdfCell`, `momPdfField` — 1,735 characters). Their only two callers were the two rewritten
functions, so all four had zero remaining references.

### 3 — Attendees: they were built, and they were invisible

⚠️ The owner asked for attendees in the export. They were **already implemented** — but every tier sat
behind `if (mom.attendees_required)` and printed only when non-empty, so a meeting with none recorded
produced a sheet with no attendee section at all and nothing saying why. That is exactly the state the
owner's attached file was in. The section is now **always printed** and says `None recorded` per tier,
because "nobody was recorded" is itself a fact about a minute. The legacy free-text column still prints
only when no structured tier exists, so names never appear twice under two headings.
**Also added to the two exports that omitted them entirely** — XLSX and PPTX carried no attendee row at
all.

⚠️ Two smaller things the raster sheet got wrong, fixed while rewriting: the header printed
`- (3 items)` with a dangling dash and a pin for a meeting with no location (the subtitle is now built
from the parts that exist); and the field order was Issue → Action → Description while the **screen**
is Issue → Description → Action, so paper and screen disagreed about the order of the record.

### ⚠️⚠️ 4 — `hidden` DID NOT WORK ON ANY `.pd-btn` IN THIS APP

The filter funnel appeared on screens that draw no filter panel; clicking it silently toggled state the
owner only saw on returning to the list. Root cause is a specificity tie: `.pd-btn { display:inline-flex }`
in the shared sheet is **(0,1,0)** — exactly equal to the user agent's `[hidden] { display:none }` — and
an author rule wins ties. **MEASURED before the fix: all four buttons carrying the attribute computed
`display:flex`.**

⚠️ This is the **same defect this file already documents at length for `.il-icondd-menu`** and fixed in
August with `:not([hidden])`. It was never generalised.

⚠️ **The shared fix alone was not enough, and only measuring showed that.** `.pd-btn[hidden]` is
(0,2,0), but `.il-topbar-tools .pd-btn:not(.il-tb-labeled)` here is **(0,3,0)** and outranked it — so
`+ Add meeting` correctly hid (it is excluded by that `:not()`) while the funnel and refresh both still
computed `flex`. The module rule now carries `:not([hidden])` too. Both fixes verified together: all
four hidden, a control button still visible.

**Refresh had no feedback at all.** `momReset(); load();` — `momReset()` sets `_momLoaded = false` but
**never calls `render()`**, and `load()` awaits four to five round trips before its single `render()`.
So the button did not change, the old content stayed frozen, and not even *"Loading minutes…"* painted.
It now shows a spinner, disables itself, renders immediately, and restores in a `finally`.
⚠️ The spinner is the **new shared `.pd-spin`** — there was no spinner in `assets/` at all, and three
modules had each rolled a byte-identical private copy. Promoted rather than adding a fourth.

Two state defects found while tracing it: the dashboard **Clear** handler replaced `_momDashF` with an
object **missing the `open` key**, so clearing the filters also collapsed the panel and left
`syncTopbarTools()` reading `undefined`; and `momReset()` cleared `_momQ` but not `_momFiltOpen` /
`_momBrowseF`, so a project switch emptied the search box while keeping the filter values that hide
rows. ⚠️ **I made that exact mistake myself while fixing it** — my first `_momBrowseF` reset invented a
`starred` key and dropped `fav`. Caught by asserting all three reset sites have an identical key set;
they now do.

### 2 — Dropdowns

⚠️ **My hypothesis was wrong and the measurement is the useful part.** I expected native `<select>`
chrome. Measured in the Add-meeting modal (dark, 900px): background, border, radius and colour all
**match** `.pd-input` exactly. What differs is the **box** — text input **29px**, `<select>` **31px**,
date input **31px**, three heights in one form row. `.pd-input`/`.pd-select` pin no height, so each
control type contributes its own intrinsic box.

Fixed in the shared sheet with `min-height: 32px`. ⚠️ **`min-height`, deliberately not `height`** —
there are many `<textarea class="pd-input">` in this app, which a fixed height would have collapsed to
a single line, and project-schedule has `<select multiple size="4">`. Both re-measured after the fix:
input/select/date all **32px**, textarea **59px**, multiple-select **78px**, compact `.pd-input-sm`
still **34px**.

⚠️ **Reported, not silently fixed:** this module carries **four unrelated dropdown patterns**
(`iconMenuHTML`, the dashboard multi-select, the activity popover, shared `tabsToDropdown`), and
`assets/` has no shared combobox at all. Converging them is an app-wide job, not this commit. The
dashboard multi-select **was** wired into `closeIconMenus`, which it was not before.

### 6 — The meeting count becomes a footnote

Owner: the leading *"3 meetings"* *"does not provide any useful piece of information"*. Moved below the
table as an italic note. ⚠️ Emitted from `renderBrowse()`, **not** from inside `renderMomListHTML` —
that card is `overflow:auto` so the note would scroll sideways with the table, and the function returns
early on an empty list. ⚠️ Its own class: `.il-mom-count` is reused for a *different* count in the
detail view. ⚠️ **List view only** — `momUnifiedRows()` excludes occurrences of a recurring series while
the calendar plots all of `MOMS` including them, so the figure would contradict the grid it sat under.

### Verified

**The PDF is verified on REAL PRODUCED FILES**, not by reading the code that emits them: the shipped
drawing code is sliced out of `module.js` by brace matching and executed against fixtures (including a
400-character run and a meeting with no minutes), the bytes captured, and the PDF structure parsed —
0 `/DCTDecode`, 103 text operators, `longest single text run 107 chars` (the 400-character value became
multiple wrapped lines), and `Attendees` / `Required` / `Optional` / `Actual` / `Page 1 of` / `DRAFT` /
`None recorded` all present. ⚠️ **jsPDF puts `save` as an OWN property on each instance** and the
instance prototype is not `C.prototype` — so the first harness's prototype override silently did
nothing and really downloaded three files. The harness now wraps the constructor.

CSS measured before and after in a browser against the shipped stylesheets: history note **797px of
content in a 396px card → wrapped**, diff row **590 → wrapped**, no container or page overflow.
`node --check` clean, inline `<script>` parses, braces 355/355 and 492/492, 0 NUL bytes,
47 assets on one version each with 0 missing.

⚠️ **Not verified signed in.** No meeting has been exported against a real project; the fixtures stand
in for real rows.

`module.css` / `module.js` → `?v=20260909u2`; `index.html` swapped its PDF libraries, so
`MODULE_V` → `20260909u2`. Shared `dashboard.css` → `?v=20260909u2` across 29 pages.

## 2026-09-08 — The toolbar's four buttons were invisible, not broken; `+ Add meeting` wrapped inside a 34px square

Owner: *"Toolbar needs UI rework, the UI for the minutes itself is bugged. I am not sure if one of the
buttons are present view. or any of the functions of the other buttons as well."* Three independent
defects, one of which explains the whole report.

### ⚠️⚠️ 1. `renderDetail()` wrote `data-ico` placeholders and never hydrated them

Every control in the detail toolbar — reporting view, export, email, distribute — is a
`<span data-ico="…">` that `Icons.hydrate()` fills in. `render()` hydrates `#il-mom-view` *after*
calling `renderDetail()`, so a **first landing on a meeting looked completely correct**. But
**28 other call sites invoke `renderDetail()` directly** — toggling reporting view, every item-workflow
step, every filter change, every save — and each one rebuilt the toolbar with nothing to fill the icons
in. So the four buttons went blank **the moment you touched anything**, which is exactly the state the
owner's screenshot caught. They were never broken; they had no glyphs.

The favourite star survived only because it is a literal ★/☆ character, not an icon — which is why the
screenshot shows one visible control and four empty boxes.

⚠️ **Fixed in `renderDetail()` itself, not at the 28 callers**, for the same reason
`psSetupChanged()` exists in project-schedule: a list every future caller has to remember is a list
that goes stale.

**Measured in a browser against the shipped `module.css` and the real `icons.js`:** without the
hydrate call, all four buttons report `svg: false` and empty labels — the screenshot reproduced; with
it, all four render, the export dropdown's icon included.

### ⚠️ 2. `.il-topbar-tools .pd-btn` had no `:not()`, so a labelled button got a 34px box

The rule exists to make the **icon-only** chrome square. Without an exclusion it forced
`width: 34px` onto *every* `.pd-btn` in the cluster — including `+ Add meeting`, whose two words then
wrapped onto two lines inside a 34px box. That is the wrap in the owner's screenshot.

Now `.il-topbar-tools .pd-btn:not(.il-tb-labeled)` keeps the square, and
`.il-topbar-tools .pd-btn.il-tb-labeled` gets `width:auto; padding:0 12px; white-space:nowrap`. Same
shape, and the same fix, as contracts-claims' `.cc-tb-labeled`.

**Measured both ways:** with the class, **106px wide and ONE line box**
(`Range.getClientRects().length === 1`, `scrollWidth/clientWidth 104/104`); with the class removed,
**34px and TWO line boxes**, `39/32` — overflowing. Icon-only buttons stay 34×34 and the page still has
no horizontal scroll.

⚠️ **The first version of that assertion was unsound and would have passed either way.** It compared the
button's height against `fontSize × 1.6 + 6` — but 34px is the button's own *set* height, so a wrapped
and an unwrapped button measure identically. Redone by counting line boxes. The code was right; the
test was not.

⚠️ **`.pd-btn` in the shared `dashboard.css` carries no `white-space` at all**, so any multi-word button
wraps wherever a flex parent squeezes it. Fixed module-locally because that file is being edited by
another session today; the shared gap is worth closing on its own.

### 3. The reporting toggle gets a word; the state chip stops being a paragraph

⚠️ **A principled exception to the 2026-09-03 icon-only pass, not a reversal of it.** That pass was
about the three **actions** (export / email / distribute), which are self-evident as icons and each
carry a `title`. This is a **mode** — it changes what the whole screen is — and the owner could not
identify it even in principle. It now reads **Present** / **Exit** beside the eye
(`.il-mom-modebtn` / `.il-mom-modetxt`), with the `title` still naming it as the reporting view so the
two vocabularies stay connected. ⚠️ **Same word and same treatment in Issues & Concerns**, which got
its present view back in the same commit — the two registers must name this the same thing.

⚠️ **The state chip carried a 60-character sentence.** It rendered
*"Draft — editable by you, a planner, or this meeting's attendees"* inside a status pill, which made an
essay out of a chip and pushed the toolbar's controls to the far edge. The chip now says **Draft** /
**Distributed**; the sentence **moved to its own note line** beside the locked-state note that already
lives there, so it is still on screen and still readable on a phone. ⚠️ Not a `title` — that would have
hidden it from touch entirely. ⚠️ It still says **editing**, not reading: reading a draft has always
been project-wide (`meeting_minutes_read` has no draft carve-out).

⚠️ `.il-mom-toolbar` gained `align-items: center` — the chip and the 34px controls have different
heights, and the default stretch made the chip a tall rounded slab.

### Verified
`node --check` clean; `module.css` brace-balanced (352/352). The hydrate fix is confirmed **in scope**
(`renderDetail`'s own `var host = $('il-mom-view')`, the call placed immediately before
`wireDetail()`). Geometry and icon presence are real browser measurements against the shipped
stylesheet, taken with the tab **visible** — a hidden tab voids all geometry and the harness refuses to
report rather than returning zeros.

⚠️ **Not verified signed in** — no meeting has been opened against a real project, so the 28 call sites
that produced the blank state have not been exercised live; the fix is measured on the toolbar markup
`momDetailHTML` emits, hydrated and unhydrated.

`module.css` / `module.js?v=20260908pv`; `index.html` gained `il-tb-labeled` on `#il-mom-tb-add`;
`MODULE_V` → `20260908pv`.
## 2026-09-03 (c) — Dashboard chart consistency (shared with Issues Dashboard), and the
## Responsible/attendee free-text input is retired in favour of the dropdown alone

Owner's list included two items that name **both** dashboards (this module's Meetings Dashboard
and Issues & Concerns' own Issues Dashboard) plus one app-wide item that reaches every People
Picker in the suite. Both modules keep their own copy of the chart/picker code by this repo's
established no-shared-runtime convention (two small IIFEs in two files), so every fix here was
applied twice, once per module — see `modules/issues-lessons/CLAUDE.md` for its mirror entry.

### Dashboard: filter hidden by default, chart titles on top, one bottom legend, no bold text

The two module dashboards had drifted from each other and from a plain, consistent chart
language: some tiles put the legend scattered per-item beside the chart, some put the count/
value label in bold, and font sizes between the donut's labels and the bar chart's value labels
didn't match.

- **`donutChartSVG(slices, opts)` dropped its per-slice on-chart labels entirely.** The ring now
  renders alone; every count and percent moved into the ONE legend beneath it
  (`statusLegendBottomHTML`), which prints `● Label: N (P%)` per entry — so there is exactly one
  place this information can be read and the chart and its legend can never disagree with each
  other about a number.
- **`hbarSVG`'s in-bar value text lost its bold weight** (`font-weight="700"` removed) and its
  font size was unified to match the donut's own label size (10.5px → 11px), so a reader moving
  from the pie to a bar chart sees the same weight and size throughout — "no bold font except
  chart titles" taken literally: the `<h4>` title keeps its ordinary (bold) heading style as the
  one sanctioned exception, everything else in a chart tile is regular weight.
- **Every dashboard tile now renders title-then-chart-then-bottom-legend**, matching the shape
  the donut tile already had — the Department/Responsible/Meeting bar tiles moved their
  `.il-dash-cardhead`(title) ABOVE the chart body and their legend BELOW it, replacing the older
  `.il-dash-cardhead-bottom`/`.il-dash-legend-top` shape where the title sat under the chart and
  the legend sat above it. All three tile kinds are now visually the same family.
- ⚠️ **The filter-hidden-by-default half of this item needed no new work.** It was already
  satisfied by the topbar funnel-toggle wiring built for an earlier item in this same list
  (`momBrowseFilterBarHTML()`'s toggle) — checked against the live behaviour before assuming it
  still needed doing, rather than duplicating a fix that already shipped.

### The People Picker's free-text input is gone; the dropdown (with "+ add a person") is now the only way in

*"Remove the separate free-text input for Responsible/Champion fields — rely solely on the
existing dropdown, which already has a + add a person option."*

This module's shared "People Picker" component backs **Responsible / Required / Optional /
Actual attendees** — an always-editable free-text `<input class="il-pp-free">` sat beside the
account-chip dropdown, letting a name be typed with no link to any account and no route through
the directory. That is exactly the redundant control the ask names: the dropdown's own
"+ Someone without an account…" option already writes a real `people_directory` row via
`PDb.createContact()`, so a second, un-vetted typing box duplicated what the dropdown already did
properly.

- **The `<input>` is removed from `peoplePickerHTML()`.** In its place: nothing, when no legacy
  free text exists on the row, or a read-only **`.il-pp-freenote`** ("Also (typed): …") with its
  own small ✕ (`.il-pp-rmtext`) when a row already carries hand-typed text from before this
  change — preserving existing data rather than silently discarding it on the next repaint.
- **`root.dataset.text` replaces the input as the free-text half's state**, read through a new
  `textOf(root)` (mirroring the existing `idsOf(root)` for the ids half). Every call site that used
  to read `(root.querySelector('.il-pp-free')||{}).value||''` now calls `textOf(root)` instead —
  `repaintPicker`, `wirePeople`, `scheduleCreateOccurrence`, `validateAddMeeting`,
  `saveAddMeeting`, and `momAttendeesOf`.
- ⚠️ **Nothing NEW can be typed into a free-text field any more, by construction** — there is no
  input left to type into. A person with no account is added exclusively through the dropdown's
  own "+ add a person" flow, which resolves through `people_directory` (case-insensitive identity,
  reused across projects) rather than a fresh, unlinkable string each time.
- The ✕ on `.il-pp-freenote` sets `root.dataset.text = ''` and repaints — a way to retire old
  hand-typed text once it's been superseded by a real assignment, without ever offering a way to
  add MORE of it.

### CSS

Both modules' People Picker stylesheet blocks (`.il-people`/`.il-pp-*`) had the dead
`.il-people .il-pp-free { width:100%; }` rule removed and gained `.il-pp-freenote`/
`.il-pp-rmtext` — the note styled as a quiet dashed-border row (matching `.il-pp-new`'s own
"something's different here" treatment) with its remove button styled like the existing
`.il-pp-rm` chip-remove control. Header comments above the block rewritten to describe the new
"chips + dropdown + an optional read-only legacy-text note" shape.

### Verified

`node --check` clean on both modules' `module.js`. CSS brace balance unchanged proportionally
after the edits (this module 348/348, issues-lessons 287/287). Grepped both modules' `module.js`
and `module.css` for the removed `.il-pp-free` input class — zero remaining references outside
the new `.il-pp-freenote`/`.il-pp-rmtext` names (which only share a substring, not the class).

⚠️ **Not verified signed in** — no live login is possible in this environment, the standing
constraint for every UI pass in this repo. No live click-through of the reworked dashboard tiles
against real department/champion data, or of the People Picker's dropdown-only flow (including
the "+ add a person" → `people_directory` round-trip) against a real save.

`module.css/js?v=` → `20260903d` in both modules. No shared asset touched, no `MODULE_V` bump.

## 2026-09-03 — UI/UX polish: icon-only chrome, a clickable star, required
## fields, the dashboard matched to Issues, sort + three named sections,
## draft-attendee editing, and a labelled reporting-view switcher

Owner's 18-item list across four screens. **Run
`migrations/2026-09-03-mom-draft-attendee-edit.sql`** — the only item here that
touches the database (Individual View item 4).

### Meetings List

**1 — filter button is icon-only.** `momBrowseFilterBarHTML()`'s toggle drops the
"Filters" text; the funnel icon plus its `title`/`aria-label` already says what it does.

**2 — export is an icon dropdown, not a labelled `<select>`.** The list's `<select
id="il-mom-listexport">` is replaced by `iconMenuHTML()` — a small shared builder (a
button showing one icon, a hidden menu of options) used for both this and the
per-meeting export control below. `wireIconMenu()`/`closeIconMenus()` open/close it and
close any other open one on the next click anywhere in the document, the same
one-menu-open-at-a-time rule the rest of the app's dropdowns follow.

**3 — Favorite is a clickable star, not a checkbox.** `amFavBtnHTML(on)` renders a ★/☆
toggle button (`#il-am-fav`, `data-on` carries the state); clicking it swaps its own
`outerHTML` and re-binds itself (`wireFavBtn()`, called once after render and again from
inside its own handler — no `arguments.callee`). `saveAddMeeting` reads the favorite
state off `data-on`, not a checkbox's `.checked`.

**4 — "this is a recurring meeting" → "Recurring meeting", moved beside the title.** The
checkbox now sits in the SAME row as the title field and the favorite star
(`.il-am-titlerow`), rather than lower in the form where it read as one setting among many
instead of the thing that reshapes everything below it.

**5 — a Recording field.** `#il-am-rec` (Add modal) and `#il-mom-rec` (existing-meeting
Detail editor) write `meeting_minutes.recording_url` (added 2026-09-01, already on the
table — no new migration). ⚠️ **Only the plain one-time-meeting payload gets it — a
recurring SERIES payload does not**, because `mom_schedules` has no `recording_url`
column of its own; a series' individual occurrences each get their own Recording field
once they're real `meeting_minutes` rows, from the Detail editor.

**6 — Date ↔ Series start/end are mutually exclusive, in the SAME row.** `#il-am-datewrap`
and `#il-am-sstartwrap`/`#il-am-sendwrap` are three sibling `.pd-field`s sharing one form
row, two of them `hidden` until the Recurring checkbox is ticked. `recur.onchange` toggles
which pair is hidden, so a recurring meeting's date field is genuinely REPLACED by the
series dates rather than merely joined by them further down the form.

**7 — required fields.** `validateAddMeeting(root, g, isRecur)` demands: title, start
time, end time, venue, at least one required attendee (id or free text), at least one
agenda item — always; and, when recurring, frequency and series start date, plus
weekday/"which week" **only for the frequencies that actually render those fields**
(`scheduleRuleFieldsHTML` shows a different field set per frequency — a monthly-date or
quarterly series asks for a day of month instead, and was never told it was missing a
control it was never shown). `saveAddMeeting` toasts the first failing message and stops;
nothing is written until every check passes.
⚠️ Fixed a latent mismatch while implementing this: the modal's initial rule-fields
preview was hard-coded to `scheduleRuleFieldsHTML({frequency:'monthly_date'})`, while the
`<select id="il-am-freq">` (no option pre-selected) actually *displays* its first option,
`'weekly'` — so the fields shown on open never matched what would save if nobody touched
the dropdown, and the new weekday-required check would have failed against a `<select>`
that doesn't exist in that state. Now seeded from `FREQUENCIES[0].key`, so the preview and
the default selection can't disagree.

### Meetings Dashboard

**1 — matched to the Issues & Concerns dashboard's own chart types.** Copied (not
shared — this app duplicates small per-module chart components rather than sharing a
runtime across module boundaries) `donutChartSVG` (per-slice leader-line labels),
`hbarSVG` ("X/Y (Z%) open" bars) and their `ilCharW`/`ilTextW`/`ilWrapLines` text-wrapping
helpers from `issues-lessons/module.js`. The old `barChartSVG`/`momDashBarsFrom`/
`momDashDonutCard` are deleted, not left dead. **Minutes by Status** is the donut (fixed
colors: Open red / On Hold amber / Closed green). **Minutes by Department**, **Minutes by
Responsible** and **Minutes by Meeting** are all `hbarSVG` via one new
`momByOpenTotal(items, keyFn, blank, order)` — a minute (like an issue) is open/closed, so
the same "how many of this group are still open" shape applies to all three groupings.
Department keeps `DEPARTMENTS`' own display order; the other two sort alphabetically.

### Individual View

**1 — sort the minutes.** A `Sort by` `<select>` (`_momF.sort`, values `''`/`status`/
`dept`/`owner`/`due`) lives in the same bar as the search/department/type/status filters.
⚠️ **It does NOT share their `>4`-items visibility gate.** Those filters can HIDE rows,
and a "Showing 0 of 3" on a tiny list reads as data loss — the reason they were gated in
the first place. Sorting never hides anything, so `momFilterBarHTML()` shows the sort
control (and only the sort control) once there's more than one minute
(`items.length > 1`), and shows the rest of the bar only past 4, exactly as before.
`''` means "order recorded" — `momItemsOf()`'s own order, which is `MOM_ITEMS`'s load-time
sort by `seq` — and is the only option that is NEVER re-sorted by `momSortMinutes()`, so
the un-sorted default reproduces the order the minutes were actually taken in. Every other
option sorts blanks LAST, matching this app's convention elsewhere (dates, aging, …) — an
ascending sort putting blanks first would read as "nobody is responsible" being the most
important row on the card. ⚠️ "Clear all filters" preserves the chosen sort — sort is a
display preference, not something that narrows the list, so clearing what hides rows
should not also silently reorder them back to default.

**2 — three named sections.** A `<h4 class="il-mom-sechead">Meeting details</h4>` heading
was added ahead of the details fields (Agenda and Minutes already had their own `<h4>`, so
those needed no change) — the card now reads as three deliberate parts (Meeting details /
Agenda / Minutes) rather than one long form that happens to end in a list.

**3 — icon-only reporting/export/email/distribute.** Same `iconMenuHTML`/`wireIconMenu`
pattern as the list's export control; a new **mail** icon was added to `icons.js` for the
Email button (2026-09-03 shared bump, already applied earlier this session).

**4 — a draft is editable by any of its attendees, not only its creator/a planner.**
⚠️ **Reading was already project-wide** — `meeting_minutes_read` has never had a draft
carve-out (see 2026-08-20-department-minutes.sql, "Reading is unchanged: anyone on the
project reads the minutes") — so the on-screen state label claiming "Draft — only you and
planners can see this" was already stale before this change; it now reads "Draft —
editable by you, a planner, or this meeting's attendees", which is the true rule on both
sides. The actual gap was entirely on WRITE:
- New `attendeeIdsOf(m)` collects every id across the three attendee tiers
  (`attendees_required`/`_optional`/`_actual`, each `{ids:[...], text:'...'}`).
- New `isDraftAttendee(m)` — true only while `!momLocked(m)` and your id is in that list —
  mirrors the DB's own `not is_distributed` gate exactly.
- `canEditMinute(m)` is now `isSteward() || owner || isDraftAttendee(m)` — this is what the
  form fields, the agenda editor and the minutes list are gated on.
- ⚠️⚠️ **`canDeleteMinute(m)` was deliberately NOT broadened along with it** — it no
  longer delegates to `canEditMinute`, and instead re-checks ownership directly (owner or
  steward, exactly the old rule). Deleting the whole record is more consequential than
  editing it, and the DB's `meeting_minutes_del` policy was never widened to attendees.
  Delegating here would have shown a Delete control the database goes on to refuse — the
  exact silent-failure pattern this app's own history warns against repeatedly.
- ⚠️⚠️ **Same reasoning for Distribute.** New `canDistribute(m)` is the ORIGINAL,
  narrower `canEditMinute` definition (owner or planner, whatever the lock state) — it
  gates the Distribute/Revert button and `momSetDistributed()`'s own guard. An attendee
  can now edit everything else on a draft, but issuing (or retracting) it stays a
  deliberate act belonging to whoever wrote it or a planner; the DB's WITH CHECK already
  refuses an attendee's attempt to flip `is_distributed`, this just keeps the UI from ever
  offering the button for them to try.
- The migration adds `mom_is_attendee(p_mom uuid)` (mom_items' three write policies OR it
  in alongside `mom_is_mine`) and widens `meeting_minutes_upd` with an inline attendee
  clause tested directly against the table's own `is_distributed`/attendee columns —
  ⚠️ **deliberately NOT via a helper function that re-queries `meeting_minutes` for its
  own row**, since a WITH CHECK's guarantee about seeing the row's proposed NEW values
  only holds for columns referenced directly on the table the policy is on, not for an
  independent subquery back into the same table from inside the same statement. `mom_items`
  is a different table, so `mom_is_attendee()`'s subquery into `meeting_minutes` there has
  none of that ambiguity.

### Reporting View

**1 — real padding per slide.** ⚠️⚠️ **Was a genuine, invisible-by-reading bug, not just
a taste call.** `.il-mom-report .il-mi-card { padding: 16px 18px }` has existed since
reporting view shipped, but `.il-mom-slides .il-slide { padding: 4px 0 2px }` — same
(0,2,0) specificity, later in the file — silently won on every minute-card slide the
whole time. A minute-card slide keeps that 16/18px padding untouched now; the Meeting
details / Agenda slides (plain divs with no padding of their own) get `18px 20px` set
directly on their own ids instead of through the old blanket `.il-slide` rule, which is
now gone entirely.

**2 — the switcher shows M / A / 1 / 2 / 3…, with icon-only Back/Next flanking it.**
`momSlideShortLabel(el, i)` returns `'M'`/`'A'`/the minute's ordinal (the SAME number
`momSlideLabel()`'s "Minute N" fallback already uses, so the two can't disagree about
which slide is which). The nav is rebuilt: a `.il-mom-slidebar` row holds
`[chevronLeft icon button] [labelled switcher buttons] [chevronRight icon button]`, with
the full slide name + "Slide N of M" counter moved to its own line beneath — a labelled
switcher no longer needs a separate caption to say WHICH slide is showing, only what it's
called. ⚠️ The nav is built via `document.createElement` + `innerHTML`, outside the
normal `render()`/`Icons.hydrate()` pass, so it calls `Icons.hydrate(nav)` itself right
after setting its markup — the chevrons would otherwise render as empty spans.

**Verified:** `node --check` clean on `module.js`; `module.css` brace-balanced (321/321);
function-set diff against the pre-change file shows exactly 3 functions removed
(`barChartSVG`, `momDashBarsFrom`, `momDashDonutCard`, all deliberate) and 18 added, none
lost by accident; the migration is paren-balanced with comments stripped (86/86), its
`$$` pairs (4 = 2 function bodies), and both new/altered policies have a preceding
`drop policy if exists`. ⚠️ **Not verified signed in** — no live Supabase login is
available in this environment, the standing constraint for every UI/RLS pass in this
repo; in particular the draft-attendee RLS branch (item 4) has never been exercised
against a real second account, and the migration has not been run.

`module.css`/`module.js?v=` → `20260903c`. No `MODULE_V` bump — `index.html`'s structure
is unchanged, only the module-local asset versions moved.


## 2026-09-02 (b) — The corrected spec: Meetings first, one toolbar row, filters
## behind a button, and the minutes reworked end to end

The owner's follow-up ("some of my prompts were not captured") supersedes parts of the
10-item pass below. **Run `migrations/2026-09-02-meetings-rehaul.sql`** — it grew three
columns this round: `meeting_minutes.agenda`, `mom_items.department`,
`mom_items.schedule_activity_id`.

### Module-level items

**1 — Meetings is the FIRST and DEFAULT tab**, ahead of Meetings Dashboard, and the same
tabs→dropdown conversion was applied to the other modules that carry a topbar tab strip:
**contracts-claims**, **risk-register**, **stakeholder-map** (one `UI.tabsToDropdown()`
call each). ⚠️ Body-level view switchers (equipment-loading, manpower-loading,
portfolio-overview, productivity-rates, resource-loading, `_template`) were deliberately
NOT converted — those are content tabs inside the page, not the topbar strip the ask is
about, and collapsing them would hide a module's own primary navigation below the fold.
⚠️ `_momTab` defaults to `'meetings'` in all three places that reset it; a strip whose
first entry is not where the module opens reads as a bug.

**2 — the secondary bar is one row.** `assets/css/dashboard.css` gains a
`@media (min-width: 701px)` block making `.pd-modulebar` `flex-wrap: nowrap` with the
project selector allowed to shrink and ellipsise. ⚠️ **It SHRINKS, it does not SCROLL** —
`overflow-x: auto` would establish a clipping context and cut off every popover opened
from inside that bar (the project switcher's own menu included), the exact trap the
2026-07-24 part-6 pass recorded. ⚠️ Wrapping is left intact below 700px, where the 44px
touch minimums need the room.

**10 — one filter group, behind a button, with the search folded in.**
`momBrowseFilterBarHTML()` renders a `Filters` toggle plus a collapsible group holding
search / kind / state / group / starred / clear. `momUnifiedFilter()` replaces
`momUnifiedSearch()`. ⚠️ The Draft and Distributed states exclude series rows **by
construction** — a recurring series has no draft state — so the option says
"(meetings only)" rather than silently returning nothing.

**11 — "X of Y open" on the list.** `itemOpenCount()` counts through `momItemStatus`, so
a minute pulled in from an issue is judged by the REGISTER's live status, exactly as the
card, the filter and the PDF already do. A series row sums across every occurrence held
under it. A meeting with no minutes reads `—`, never `0 of 0 open`.

### Minutes-specific items

**1 — "action items" are MINUTES, and the activity moved onto each one.** Same
`mom_items` table; what changed is the name, because these ARE the minutes. The
meeting-level **Activity discussed** picker is gone — one meeting routinely covers
several activities, so a single link had to be wrong for all but one of its minutes. Each
minute now carries its own, set through **one shared modal** (`openItemActPicker`).
⚠️ One modal, not an inline search box per card: twenty minutes would otherwise mean
twenty live inputs and twenty debounced queries against a 40k-row schedule.
⚠️ `momSaveHeader` **no longer writes `schedule_activity_id` at all** — dropping it from
the payload rather than writing `null`, so saving the header cannot blank a value stored
before this change. That value is shown read-only on the meeting instead of hidden.

**2 — Notes / discussion removed.** Same treatment and the same reason: the column is not
written any more, and existing text renders read-only rather than disappearing. Exports
still print it where a meeting has it.

**3 — carry-over is a button + modal** (`openCarryOverModal`), not an always-visible
dropdown. Only meetings that still have something open are listed, so the modal cannot
offer a source that would carry nothing.

**4 — ⚠️ "Get from issue button is not working" — it was NOT broken, and the diagnosis is
the useful part.** A brand-new meeting auto-seeds *every* open issue, so
`momOpenIssuesFor()` legitimately returned an empty set and the button rendered
permanently `disabled` — which is indistinguishable from broken. `openGetIssueModal()` is
always enabled and lists **every** issue on the project, with the ones already on this
agenda ticked and disabled. ⚠️ A CLOSED issue is listed but not selectable: dragging
something the register has settled onto next week's agenda is what the open-only rule
existed to prevent, and it stays prevented. Field mapping is `momIssuePayload()`'s
unchanged shape (issue ← description, description ← caused_by, action ← corrective
action). ⚠️ Adds run **sequentially**, not `Promise.all` — the sequence number is derived
from what is already on the agenda, so parallel pulls would race onto the same number.

**5 — Department replaces Category**, from the Issues register's own `DEPARTMENTS` list
(a verbatim copy — keep the two in step). ⚠️ The `category` COLUMN is not dropped and is
never blanked: `momItemDept()` falls back to it and `momUsedDepartments()` offers whatever
a project already stored, so a minute filed before this change round-trips through the
select instead of silently reporting the first option.

**6 — Put On Hold / Close moved to the card's action footer**, beside Remove, and their
reveal panel is full-width below the text blocks instead of crammed into a grid cell
sized for a status pill. The workflows are unchanged (reason required to hold, closure
note required to close, lesson still optional).

**7 — the history is always on screen**, with the Issues register's field-by-field
before→after diff (`MI_HIST_FIELDS` / `miHistDiffHTML`, mirroring `HIST_FIELDS` /
`issHistDiffHTML`). ⚠️ Issues can afford one fetch per detail page because a detail page
IS one issue; a meeting is N minutes, so `loadItemHistories()` fetches the **whole
meeting's history in one request** keyed on `.in('item_id', ids)` and fans it out — with
an in-flight guard, because `renderDetail()` calls it and its completion repaints, which
without the guard is an infinite fetch loop rather than a load.

**8 — "Capture lesson" goes to the ordinary Add Lessons Learned page.** The link carries
no `momId`/`momItem` any more, and `issues-lessons` learned a `?newLesson=1` deep link
that opens its own plain form. ⚠️ The older LINKED form is kept — it is still how a lesson
gets attached to a specific minute, and existing links stay openable.

**9 — distribute / revert appear in each minute's history.** Distribution is a property
of the MEETING, so it is logged onto every one of its minutes at once: the history a
reader opens is that minute's, and "this was issued on the 4th" is part of its story even
though the act covered its siblings.

**10 — distributing prompts to email the attendees**, naming them, then hands off to the
same `mailto:` the Email button uses.

**12 — the reporting view is a slide deck.** `momApplySlides()` steps
`#il-mom-slide-details` → `#il-mom-slide-agenda` → one `.il-mi-card` per minute, with
prev/next, a dot strip and arrow keys. ⚠️ **The deck is a VIEW over the markup the editor
already rendered** — same inputs, same handlers — not a second read-only rendering. That
is what makes "while also editing" true rather than approximately true, and why there is
no slide template to drift from the form. ⚠️ Consequently the old
"render every field as static text" mode is GONE: `momFieldHTML` no longer passes
`_momReport` to `ilField`, and the CSS that neutralised every control
(`pointer-events:none`, transparent borders) is deleted. The clipping that mode existed to
avoid was fixed at the source instead — Issue / Agenda, Description and Action item are
all textareas now. ⚠️ Slides are found in the DOM, not counted from `MOM_ITEMS`: the
minutes list is filterable, so a count taken from the data would step past cards that are
not on screen. ⚠️ Arrow keys are ignored while focus is in a field, or typing would be
impossible.

**13 — the dashboard was rebuilt and everything else removed**, as instructed: Minutes by
Status, Minutes by Department, Minutes by Responsible, Minutes per meeting, then the
minutes grouped by meeting — plus a starred-only tick and a multi-select meeting
dropdown. ⚠️ **These charts count EVERY minute, not only the open ones** — "Minutes by
Status" is meaningless if Closed is filtered out before it is charted. ⚠️ An EMPTY
multi-select means every meeting, never none. ⚠️ "Starred meetings only" accepts a star on
the meeting's own row **or on its series**, or starring a recurring meeting would filter
its own occurrences out. ⚠️ A meeting with no minutes is still listed, with a note — a
meeting nobody minuted is a real state, and dropping it silently is how a gap goes
unnoticed. `momAttendanceBattery` / `momOpenMinutesStat` / `momOnScheduleStats` /
`momAllOpenItems` / `momItemsDashListHTML` / `meterHTML` / `momLastHeldDate` are deleted
with the tiles they fed.

**14 — no more bold.** Every `font-weight: 700/800` in `module.css` is `600`, and a scoped
`#il-mom-view b, #il-mom-view strong { font-weight: 600 }` catches the inline emphasis the
JS emits.

**Module item 4 — an agenda can be added to an EXISTING meeting.** The Add-meeting modal
could set one; nothing could edit it afterwards. `momAgendaSectionHTML()` is that editor
and doubles as slide 2. ⚠️ The agenda is `meeting_minutes.agenda` (jsonb), NOT `mom_items`
rows: an agenda TOPIC is what the meeting intends to cover, a MINUTE is what was recorded
against it, and filing topics as minutes would put empty rows in the record and count them
as open work. ⚠️ An empty agenda stores NULL, not `[]`.

### Two defects found by checking rather than reading

⚠️ **`UI.modal(html, opts)` wires NOTHING but the backdrop click** — it does not bind
`[data-close]` and it ignores `opts.width`. Three new modals were written assuming both.
`wireModalChrome(m, width)` now does it once; a modal whose × does nothing is exactly the
silent failure this repo keeps recording.

⚠️ **`momSlideLabel` fell through on a MISSING action-item element but not on an EMPTY
one** — `el.querySelector(a) || el.querySelector(b)` takes the blank field and labels the
slide "Minute 3" while the issue text sits right there. A minute recorded as "what was
raised", with the action still to be agreed, is common. Caught by the harness.

### Verified
- **40 checks executing the SHIPPED functions**, sliced out of `module.js` by brace
  matching and never reimplemented — and the constants (`MI_HIST_FIELDS`, `MIGRATE_COL`)
  are lifted from the source too, since a hand-copied field list makes the suite agree
  with itself rather than with the module. Covers the missing-column retry (including
  that a constraint violation and an RLS refusal are NOT treated as missing columns), the
  department fallback, the history diff, every dashboard filter combination, the open
  counts, the slide labels and the activity label. ⚠️ **The suite cannot even LOAD against
  the pre-change file** (`NOT FOUND`), so it is testing new behaviour, not restating old.
- `node --check` clean on `module.js`, `issues-lessons/module.js` and `modules-grid.js`;
  every inline `<script>` in the seven touched HTML files parses; CSS braces balanced
  (302/302 module, 431/431 shared); 0 NUL bytes; 0 duplicate DOM ids; **no shared asset
  served at two versions and none unversioned**.
- **Function-set diff: 12 lost, all deliberate** (`meterHTML`, `momUsedCategories`,
  `momLastHeldDate`, `momAttendanceBattery`, `momOpenMinutesStat`, `momOnScheduleStats`,
  `momAllOpenItems`, `momItemsDashListHTML`, `renderMomActionDashboard` — the removed
  dashboard; `momUnifiedSearch` → `momUnifiedFilter`; `momGetPanelHTML` → the modal;
  `momActChipHTML` → the per-minute chip), **39 added**.

⚠️ **Not verified signed in, and the migration has not been run.** No live click-through
of the slide deck, the agenda editor, the Get-from-issue modal, the department select or
the rebuilt dashboard against real data. Until the migration runs, `department` and
`schedule_activity_id` are dropped from every write with a toast naming the file, and
saving an agenda says which migration is missing.

⚠️ **Merged onto `origin/main` before the PR** (109 commits ahead; PR #46 had already
been merged at the earlier bug-fix commit, so this work needs its own PR). 30 conflicts,
**every one a cache-busting version collision** except `CLAUDE.md` — both sides prepend, so
both sides are kept whole and unreworded with the seam marked, the resolution this repo
already set for the PR #13 and 2026-08-21 conflicts. ⚠️ **A first pass resolved them with
`git checkout --theirs`, which takes main's WHOLE file and silently discarded my own
non-conflicting `UI.tabsToDropdown` lines in three modules** — caught by grepping for them
afterwards, aborted, and redone by rewriting each conflict hunk in place. ⚠️ Also confirmed:
`epc-rcm.css` was renamed `mcc-rcm.css` on main, and 0 stale references to the old name
remain.

Versions after reconciling with main: `module.css/js?v=20260903b`; `issues-lessons`
`module.js?v=20260903b` (my `?newLesson=1` deep link rode into main's newer file, so it needs
a token above main's `20260903a`); `dashboard.css?v=20260903a` app-wide (29 files — the shared
`.pd-modulebar` block is mine, above main's `20260902c`); `modules-grid.js?v=` (hence
`MODULE_V`) → `20260903a`, above main's `20260902am`.


## 2026-09-02 — Full rehaul: dropdown tab, list/calendar icon toggle, a real "+ Add
## meeting" modal, favorites, series pages, a per-hour Week view, and exports

Owner's 10-item rehaul spec, verbatim in the commit history. **Run
`migrations/2026-09-02-meetings-rehaul.sql`** (after the 2026-09-01 schedules/attendees
migration — this one adds to the same two tables).

**1 — "no need for the meeting label, have a dropdown with 2 choices."** The `.il-tabs`
strip (Meetings Dashboard / Meetings) is converted into one dropdown trigger via the
shared `UI.tabsToDropdown('.il-tabs')` — the same mechanism Issues & Concerns and
Progress Photos already use, which is also what makes the static module title
disappear where there's room for it (via `.pd-title-hasdrop`, never an unconditional
JS hide — this app's own history has twice recorded that reintroducing the
"icon-alone-then-label-on-the-next-line" defect on narrow screens).

**2 — icon-only List/Calendar toggle, top right.** `#il-viewtoggle` in the topbar tool
cluster (two square `.il-vt-btn` icon buttons — `listView`/`calendar` from `icons.js`),
wired once in `wire()` since it lives outside `#il-mom-view`. `syncTopTabs()` hides it
whenever it wouldn't mean anything on screen (the Dashboard tab, or a single meeting/
series already open) and syncs its `.on` state to `_momView` on every render.

**3 — "+ Add meeting" is now a real modal**, not a one-click blank-row insert.
`openAddMeetingModal()`/`saveAddMeeting()`: title, date, start/end time, venue, meeting
link, Required/Optional attendee People Pickers, an addable agenda list, and Recurring
+ Favorite checkboxes. ⚠️ **The agenda list is DOM-driven, not a JS array kept in
state** (`agendaRowsHTML`/`wireAgendaList`/`agendaValuesOf`) — each row is a real input;
adding/removing just adds/removes nodes, and values are read straight off the inputs at
save time, so there is nothing to keep in sync with the DOM.
- **Not recurring** → inserts one `meeting_minutes` row, and each agenda item becomes a
  real `mom_items` row (`type:'Report'`) — the same table every other action item lives
  in, so it has the full owner/due-date/hold-close/history apparatus from the moment the
  meeting exists, rather than being a second, throwaway text list. The register's
  still-open issues are quietly seeded onto the new agenda too, the same rule every
  other "new minute" path in this module already follows.
- **Recurring** → inserts one `mom_schedules` row (frequency + rule fields via the
  existing `scheduleRuleFieldsHTML()`, series start/end dates, and the same venue/link/
  attendee/agenda fields stored as the series' own defaults — `mom_schedules` gained
  `venue`/`meeting_link`/`start_time`/`end_time`/`attendees_required`/
  `attendees_optional`/`default_agenda`/`end_date`/`is_favorite` in the 2026-09-01
  migration for exactly this). No occurrence is created automatically — the series row
  itself IS the list entry (item 4), and its first meeting is created from its own
  series page (item 6) the same way every later one is.
- ⚠️ **Genuinely missing column found while wiring this up:** `mom_schedules` has read
  and written `interval_n` (the "every N weeks" step) since the table was created, but
  the original CREATE TABLE never declared it — so "every 2 weeks" has silently been
  writing to nothing and always recurring weekly. Added in this migration, defaulted to
  1 (the behaviour every existing row already had).

**4 — the unified list, favorites pinned to the top.** `momUnifiedRows()` builds ONE
descriptor set from `MOMS` (standalone meetings, `schedule_id` null) and
`SCHEDULES` (active recurring series) — Title / Date-or-frequency / attendee count /
Location, with a Recurring or Draft pill beside the title. `momSortedRows()` partitions
into favorite/non-favorite, sorts each half with whatever column comparator is active,
then concatenates favorites first — so a column click still reorders *within* the pin,
it never fights it. ⚠️ **An occurrence of a series (`schedule_id` set) is never a row
here** — it's reached only from its series' own page (item 6); a planner does not need
to tell a one-off from a recurring meeting apart until they click into it, and listing
both the series AND every one of its past occurrences as separate top-level rows would
double-count the same recurring commitment.
- The favorite star (★/☆ — plain Unicode, not an `icons.js` glyph; no "star" icon exists
  in that shared set and this rehaul is not the place to add one) is wired with
  `e.stopPropagation()` so clicking it never also opens the row it sits in, and
  `momToggleFavorite(kind, id)` optimistically flips the row, re-renders whichever
  view is active (`reRenderMomHost()`), and reverts + toasts the migration name if the
  round-trip fails on a missing column.

**5 — Detail view gained the actual-vs-planned pairing.** Planned **Start time / End
time** now sit beside the existing Date field; **Actual start / Actual finish** sit next
to the (already-existing, from 2026-09-01) Required/Optional/**Actual** attendee
pickers. ⚠️ **Both pairs are always shown, never conditionally revealed once "the
meeting is done"** — a meeting recorded ahead of time can still have its actual times
filled in the moment it wraps, and guessing "done" from the date would just make the
fields harder to find on the one day they matter most. "Minutes of the Meeting" is the
existing Notes / discussion textarea — already free text, already exported — relabelled
in the HTML/PPTX exports so the term matches the ask; the on-screen label is left as
"Notes / discussion" since it already says what the field is for.
- The favorite toggle also lives here, in the Detail toolbar, so ANY meeting — not just
  a series — can be favorited and pinned to the top of the list (item 4).

**6 — series page.** `momOpenSeries(id)` switches `_momView` to `'series'` and renders
`renderSeriesPage()`: the schedule's own title/frequency/group/end-date/next-occurrence,
Favorite/Edit/Delete/"+ Add a meeting" actions, and a table of every meeting actually
held under it (`schedMeetingsOf`) — clicking one opens it in Detail exactly like any
other meeting. Every schedule-CRUD control that used to sit in an always-visible panel
in the browse view (dead code from an earlier draft — see below) now lives here
instead, reached the same way any other row is opened.
- ⚠️ **"Back to meetings" from a meeting created off this page returns to the series
  page it came from, not wherever List/Calendar was sitting before.** `momOpenMeeting()`
  captures the CURRENT `_momView` as `_momBrowsePrev` before switching to Detail — so as
  long as `_seriesSel` stays set when `scheduleCreateOccurrence()` calls it (it used to
  be nulled right before the call, which is now fixed), `_momBrowsePrev` comes out as
  `'series'` and the round trip lands back where it started.
- ⚠️ **Found and removed while wiring the series page in: `wireBrowse()` still carried
  the ENTIRE old schedule-panel wiring block** — `#il-sched-new`/`#il-sched-close`/
  `.il-mom-schedrow[data-sched]`/etc — none of which `renderBrowse()` had emitted for
  several edits already (the browse view's own markup had already moved on to the
  unified list). Harmless (the `querySelector`s just returned null), but dead and
  confusing; deleted along with the row-click handler's stale `tr.dataset.mom`
  reference (the unified list rows carry `data-kind`/`data-id`, not `data-mom` — that
  handler had never actually opened anything since the unified list shipped).

**7 — "retrieve minutes from issues."** Already existed pre-rehaul as the "Get from
issue" panel (`momGetPanelHTML`/`momOpenIssuesFor`/`momPullIssues`/`momPullOneIssue`) —
confirmed still present and unchanged. Nothing in the 10-item spec asked for anything
this didn't already do.

**8 — export & email.** The Detail toolbar's single "⬇ PDF" button became one
`<select id="il-mom-exportsel">` (HTML/PDF/PowerPoint/Excel) plus a separate "✉ Email"
button; the browse view's toolbar gained a matching `<select id="il-mom-listexport">`
(HTML/PDF/Excel) for the meeting list. PDF (`momDownloadPDF`) is untouched — it is
already verified end-to-end (a real produced PDF opened and checked, not just its
source measured) — the other formats are new, independent functions rather than a
refactor sharing markup with it, to avoid reintroducing exactly the "measuring the
source of a render is not verifying the render" trap that function's own history
already paid for once.
- **HTML** (`momExportHTML`/`momExportListHTML`) — a standalone document via
  `Blob` + a synthetic `<a download>` click; no library needed.
- **Excel** (`momExportXLSX`/`momExportListXLSX`) — SheetJS, the same
  `xlsx@0.18.5` build already loaded by cash-flow / contracts-claims / equipment-
  loading / manpower-loading / portfolio-overview / productivity-rates / project-
  schedule in this suite.
- **PowerPoint** (`momExportPPTX`) — `pptxgenjs@3.12.0`, the same build progress-
  photos already loads for its PPR export. A title slide, a notes slide when the
  minute has any, and a table slide of the action items. ⚠️ **Single-meeting only** —
  the spec's second sentence ("meeting list can also be exported in html, pdf, xlsx")
  deliberately does not list PPT for the list, so no list→PPTX export was built.
- **Email** (`momEmailMinutes`) — a `mailto:` link, pre-filled subject + a plain-text
  action-item summary. ⚠️ **This app has no SMTP/API backend to actually send mail**,
  so a `mailto:` link — which pre-fills the person's own mail client and stops there —
  is the honest version of "email these minutes," not a silent no-op dressed up as one.
  The body says plainly that a file has to be attached by hand, since `mailto:` can
  carry text only, never an attachment.
- A PDF export of the meeting LIST (`momExportListPDF`) reuses `momDownloadPDF`'s
  own detached-node-in-normal-flow pattern (see that function's own header comment for
  why an out-of-flow node produces a completely blank PDF) rather than risking the same
  mistake again in a second place.

**9 — Week view (the per-hour half of "throughout month per day or throughout week per
hour").** New `renderMomWeekHTML()` + `momWeekInit`/`momWeekShift`/`momWeekDates`/
`momWeekLabel`/`timeToMinutes`/`fmtHour`: an hour axis (`WEEK_HOUR_START..END`, 6am–8pm
by default) down the left, 7 day columns, timed meetings as absolutely-positioned
blocks sized/placed from `start_time`/`end_time` in minutes-since-grid-start, and an
**all-day row above the grid for meetings with no time set** — a meeting nobody has
timed yet is still real and must still be seen, not silently dropped or forced onto a
fake slot. `renderMomCalendarHTML()` is a thin Month/Week dispatcher above both (the
old function of that name is now `renderMomMonthHTML`, unchanged internally).
⚠️ **"This week" is seeded off the person's LOCAL wall-clock date exactly once, then
immediately re-expressed as a UTC date string** — from that point on every date this
view computes is pure `Date.UTC()` arithmetic, matching the Month view's own stated
convention and this app's own repeatedly-learned local-vs-UTC lesson. Only the single
"what week am I in right now" question ever touches local time.

**10 — Dashboard.** Already existed pre-rehaul (`renderMomDashboard`/
`renderMomActionDashboard`, 2026-09-01): meeting-frequency list, an attendance battery,
an open-minutes meter, a conducted-as-scheduled donut, then an action-items summary
mirroring Issues & Concerns' own tile/donut/bar/full-list shape. Confirmed still present
and unchanged by this pass — nothing in the 10-item spec asked for anything beyond what
it already did.

**Verified.** `node --check` clean; CSS braces balanced (274/274); 0 NUL bytes across
`module.js`/`module.css`/`index.html`; 0 duplicate DOM ids in `index.html`
(`<div>`/`</div>` 14/14). Function-set diff against the last commit: **5 lost, all
deliberate** (`schedulesPanelHTML`/`scheduleRowHTML`/`scheduleRightPaneHTML` — the old
always-visible schedule panel, superseded by the series page; `momSortedList` —
superseded by `momSortedRows`'s favorites-aware version; `momCreateNew` — superseded by
`openAddMeetingModal`/`saveAddMeeting`), **35 added**. Every newly-referenced function
name checked present via a static scan before wiring its caller.

⚠️ **Not verified signed in** — no live login is possible in this environment, the
standing constraint for every UI pass in this repo. No live click-through of the Add
Meeting modal, the series page's occurrence-creation flow, the Week grid against real
timed meetings, or any of the four export formats against real data; the migration has
not been run. The exports in particular deserve a real signed-in pass — HTML/XLSX are
low-risk (plain data-to-file, no rendering library), but PDF-of-the-list and PPTX both
depend on a library actually loading over the network, which this environment cannot
observe.

`module.css/js?v=20260902a`; `modules-grid.js?v=` (hence `MODULE_V`) → `20260902a`
across `dashboard.html`/`modules.html` — this module's `index.html` changed
structurally (new toolbar markup, two new CDN script tags), so a returning browser
needs the bump to stop serving the cached pre-rehaul page.

## 2026-09-01 — Dashboard + Meetings tabs, recurring schedules, structured attendees,
## Internal/External grouping, and per-action-item hold/close history

Continuation of the same 24-item request that rebuilt Issues & Concerns (see that module's
2026-08-31(b) entry). That pass explicitly deferred items #2 and #17–23 — Minutes of Meeting's own
Dashboard + Meetings rework — as a separate body of work; this entry is that work.
**Run `migrations/2026-09-01-mom-schedules-attendees-item-history.sql`.**

### Item #17 — two top-level tabs: Dashboard | Meetings
The module gained a `.il-tabs` strip in the topbar (copied verbatim from Issues & Concerns' own —
same visual language, two small IIFEs in two files, no shared runtime to draw it from instead),
wired once in `wire()` since the strip lives outside `#il-mom-view` and would otherwise be
re-wired on every repaint. `_momTab` ('dashboard' | 'meetings') defaults to **dashboard**, matching
the convention item #16 set for Issues & Concerns. Everything the module already had — List /
Calendar / the single-meeting Detail editor — now lives inside **Meetings**; nothing about how
those three work was changed structurally, they just sit behind a tab now.
⚠️ **`momOpenMeeting()` always forces `_momTab = 'meetings'`.** `render()` checks `_momTab` before
`_momView`, so a caller sitting on the Dashboard (the action-items list's row click) that only set
`_momSel`/`_momView` without touching `_momTab` would silently redraw the dashboard instead of the
meeting just opened. One line at the single choke point every "open a meeting" path already runs
through, rather than remembering to set it at each of the four call sites.

### Item #18 (+ #2) — the Dashboard tab
Two sections, read left-to-right as: how well does the recurring cadence hold, then what's still
open on it.
- **Meeting frequency** — one line per active schedule via `schedFrequencyLabel()` ("Every first
  Monday of the month"), plus the date of the last meeting actually held (`momLastHeldDate()` —
  the latest `meeting_date` that is `<= today`, so a future-dated draft can't read as "already held").
- **Attendance — last meeting held**, a battery-style meter (`meterHTML(..., 'is-battery')`):
  actual vs required attendee count on the most recent held meeting that has EITHER attendee tier
  filled in. ⚠️ **Withheld, not shown at 0%, when neither tier was ever recorded** — a meeting with
  only the old free-text `attendees` field has nothing this can honestly count, and reporting 0
  would read as "nobody came" rather than "nobody was asked."
- **Open minutes**, the same meter shape: how many recorded minutes are still in Draft (not yet
  Distributed) out of the total — "open" in the same sense an issue is, until it is issued.
- **Conducted as scheduled**, a donut: expected occurrences (from each active schedule's own start
  date to today, via `schedDatesInRange`) vs how many were actually held.
  ⚠️ **Withheld entirely (not shown as 0/0) when there is no schedule history yet** — an empty pie
  reads as a real 0% conducted-as-scheduled, a false statement when there's simply nothing to
  compare against.
  ⚠️ **Credit for a schedule is CAPPED at its own expected count** (`momOnScheduleStats`) — summing
  raw actual counts would let one over-met schedule (extra ad-hoc sessions under the same recurring
  slot) mask a different schedule's real shortfall in the combined percentage.
- **"…then copy the same contents to summarize the minutes"** — read as: apply the Issues
  dashboard's own tile/list/pie/bar shape to this module's own record, i.e. its ACTION ITEMS
  (`mom_items`) across every minute on the project, not a second copy of the meeting stats above.
  `renderMomActionDashboard()`: a summary list of open items (sorted most-recent-meeting-first,
  capped at 12), a donut by `category` (the field mom_items actually carries — MOM_CATEGORIES), and
  a bar by `type` (Issue/FYI/Report) — the categorical dimensions this table has, mirroring what
  Issues' own dashboard does with department/aging on its rows. Clicking a row jumps to that
  action's meeting, in Detail, on the Meetings tab (forcing `_momTab` as above).
- ⚠️ **The donut/bar/meter helpers (`donutChartSVG`, `barChartSVG`, `meterHTML`, `CHART_COLORS`)
  are duplicated from Issues & Concerns, not shared** — same reasoning as the People Picker
  component this module already carries its own copy of: two small IIFEs in two files, and this
  split already established that a small duplicated component beats widening it into a shared-asset
  change nobody asked for.

### Item #19 (+ #22) — recurring meeting schedules
New `mom_schedules` table + a panel at the top of the Meetings tab ("Recurring meeting schedules"),
above the existing List/Calendar browse of individual `meeting_minutes` rows (unaffected — a
schedule is a commitment, not a replacement for the meetings themselves).
- **Frequency model**: `weekly` (every N week(s) on a weekday, anchored to the schedule's own
  `start_date` — "every 2 weeks" means every 2 weeks FROM WHEN IT STARTED, not every week that
  happens to land on an even ISO week), `monthly_weekday` ("first Monday" … "last Friday", `-1`
  resolving to the true last occurrence even in a month with only 4 of that weekday), `monthly_date`,
  and `quarterly` (anchored to the schedule's own **start month**, so a February-starting quarterly
  schedule recurs Feb/May/Aug/Nov, never silently shifted onto the calendar year's own quarters).
  ⚠️ **UTC throughout** (`schedDatesInRange`/`nthWeekdayOfMonth`/`utcDow`), matching the calendar
  view's own existing convention — the local-vs-UTC off-by-one has bitten this app repeatedly and a
  schedule's whole job is landing on the right day.
- **Clicking a schedule row opens a right pane** (item #22): its next expected date, an
  "+ Add a meeting" button, and every actual meeting recorded against it
  (`schedMeetingsOf`), each opening in Detail.
- **"+ Add a meeting" copies its defaults from the last occurrence, item #22's specific ask**: date
  defaults to the schedule's own next expected occurrence, venue/meeting-link/required-and-optional
  attendees default from the MOST RECENT recorded meeting under that schedule (`scheduleOccFormHTML`)
  — all editable before creating. A brand-new schedule with no prior occurrence falls back to just
  its own next expected date with nothing else to copy.
- **Calendar shows PLANNED occurrences, item #19's explicit ask**: for every active schedule, any
  expected date in the displayed month with no actual meeting already recorded under that SAME
  schedule renders as a dashed, muted chip (`.is-planned`) rather than nothing. ⚠️ Scoped per
  schedule, not "any meeting on that day" — a schedule kept exactly on its expected date must not
  show two chips (one real, one phantom) for the same session. Clicking a planned chip opens that
  schedule's right pane with the "+ Add a meeting" form pre-dated to the exact day clicked
  (`_schedOccDraft.date`), which can differ from the schedule's bare "next" date when several of its
  occurrences are visible on screen at once.
- **"Starts always from previous meeting minutes" (item #19) / "all previous minutes are then
  copied" (item #22) — read as reusing the register's own carry-over, not a second, competing
  definition of "copy the previous minutes."** Creating an occurrence quietly seeds the register's
  still-open issues (the same rule "+ New minutes" already follows) and then runs the EXISTING
  `momCarryOver()` against the immediately-preceding occurrence of that schedule — idempotent,
  register-decides-openness, all the rules that feature already established. A literal "copy
  EVERYTHING ever discussed on this schedule" reading was rejected: it would duplicate the same
  long-since-closed items onto every future occurrence forever, which is not what an agenda is for.
- ⚠️ **Ordering trap avoided deliberately**: `momOpenMeeting()` (which renders the Detail form) is
  called BEFORE the carry-over/pull-issues calls, not after — `momCarryOver()` always calls
  `momSaveHeader()`, which reads its fields straight off the Detail form's DOM. Calling it before
  the form exists would resave the brand-new row with a blank `"(untitled)"` title (a missing
  element's `.value` reads as `''`, not the row's real value) — the exact trap this file's own
  comment on `momOpenMeeting` warns about for a different reason.
- Schedule CRUD (`scheduleFormSave`/`scheduleDelete`) mirrors `meeting_minutes`' own per-row RLS
  shape (2026-08-20): any approved non-viewer creates, a planner maintains all, everyone else only
  their own. Deleting a schedule with recorded meetings against it does NOT delete them — they
  simply stop pointing back at a recurring schedule (`on delete set null`).

### Item #20 — required / optional / actual attendees, venue, link, recording
Three People Pickers (the same hybrid ids+text component Champion/Responsible already use)
replace the single free-text "Attendees" field: **Required**, **Optional**, **Actual**. Plus plain
text fields for **Venue**, **Meeting link**, and **Recording** (a URL, not an upload — nothing in
the request implied file storage, and every other reference in this module to an external resource
— the activity link, the register link — is a link, not a blob).
- ⚠️ **Stored as jsonb `{ids, text}` per tier** (`attendees_required`/`_optional`/`_actual`),
  deliberately NOT six flat columns (an ids-array + text pair per tier, the pattern `champion_ids`/
  `champion` uses elsewhere) — three attendee tiers repeating that pair is double the column count
  for one repeated shape, and every consumer (the dashboard's battery, the PDF, the save path) reads
  each tier as one object either way.
- ⚠️ **The legacy free-text `attendees` column is shown, read-only, ONLY when none of the three
  structured tiers has ever been filled in** on that minute — hiding it outright would silently
  disappear real attendee data recorded before this feature existed.
- ⚠️ **`momSaveHeader()` distinguishes `undefined` (the picker wasn't rendered — a read-only view)
  from `null` (rendered, left empty)**: the former leaves the column untouched, the latter is a real
  "nothing entered" that should overwrite whatever was there. Collapsing the two would mean opening
  a locked minute in read-only mode and saving from elsewhere could silently blank its attendees.
- ⚠️ **Tolerant of the un-run migration** — `momSaveHeader()` retries with `meeting_group`, `venue`,
  `meeting_link`, `recording_url`, and all three attendee columns stripped on a "column not found"
  error, so a title/date/notes edit still saves. All seven columns come from the SAME migration
  file, so this app's usual per-column retry granularity is unnecessary here: a live database either
  has all of them or none of them.

### Item #21 — meeting type dropdown grouped Internal/External only
The "Meeting type" DROPDOWN is now a plain two-option select — **Internal** / **External** —
writing a new `meeting_group` column. The old dropdown's vocabulary (PPR Meeting / PSC Meeting /
Client Meeting) moved to a free-text **"Meeting description"** field (still the same `meeting_type`
column; only what the form does with it changed) with those values offered as `<datalist>`
suggestions rather than enforced as a closed list.
⚠️ **`<datalist>` options, not `<select>` options — a real distinction, not styling.** A datalist
`<option>` takes no `selected` attribute (the bound `<input>`'s own value decides what shows), and
offering a blank "— none —" entry would just be typed over — so `momTypeDatalistOptions()` is a
new, smaller helper rather than reusing `momOptions()`, whose blank-first-option shape exists
specifically to solve the SELECT-value trap this field no longer has.

### Item #23 — per-action-item Update / Put On Hold / Close, with history
Mirrors the Issues & Concerns workflow (2026-08-31) at the level of one `mom_items` row instead of
one whole detail page.
- **Gated to UNLINKED items only** (no `issue_id`) — a linked item's status is the register's, the
  same rule the PDF and the status pill already followed before this change; showing Hold/Close
  buttons there would edit a `mom_items.status` value nothing displays. A linked item keeps its
  plain register-status pill, now titled "Status follows the linked issue in Issues & Concerns."
- **Put On Hold requires a reason** (`hold_reason`, required); **Close requires a closure note**
  (`closure_report`, required) — **but a lesson is optional**, the one deliberate difference from
  closing an Issue (item #13), which always records one. If a lesson IS typed in the close panel,
  it is pushed straight into `lessons_learned`, linked via `mom_item_id`, the same table
  "+ Capture lesson" already writes to elsewhere on the same card.
- **Both the hold reason and the closure note stay visible on the card, read-only, after the
  reveal panel that captured them closes** — a "Reason for Hold" / "Closure note" field appears
  beneath Action Item whenever the corresponding status/column pair is set, and prints in the PDF
  too. Without this, the narrative would only be recoverable via the History panel, which is a
  worse reading experience for the single most likely thing someone wants to know about a held or
  closed item.
- **New `mom_items_history` table, mirroring `issues_lessons_history` exactly** — insert-only RLS,
  no update policy, no delete policy, on purpose: an audit trail a planner could edit or remove
  after the fact is not an audit trail. ⚠️ **A SEPARATE table from the Issues one, not a shared one
  with a nullable pair of foreign keys** — the two audit unrelated primary keys and unrelated rows,
  and a shared table needing "exactly one of `issue_id`/`item_id` set" is precisely the shape that
  lets a bug insert a row naming neither.
- ⚠️ **"All items must have an updates history" is honoured for EVERY save, not just hold/close** —
  `momSaveItem()` now takes an optional `(histAction, histNote)` pair (defaulting to a plain
  `'update'` with no note) and logs a snapshot-before-mutating history row on every field edit,
  linked or unlinked, category/owner/due-date changes included. The "+ Add action item" handler logs
  a `'create'` entry the same way. Best-effort, never awaited-into-failure (same rule as the Issues
  module's own `logHistory`) — the real `mom_items` write has already succeeded by the time this
  runs, so a missing migration or a transient failure here must not read as an error to whoever just
  saved.

### Verified
- `node --check` clean throughout.
- CSS brace balance: 226/226.
- 0 NUL bytes.
- **Function-set diff against the last commit: 0 lost, 41 added.** Grepped every new
  `migrations/2026-09-01-…` reference across the file for a consistent filename (4 occurrences,
  identical).
- `migrations/gen-verify.js` and `migrations/gen-build.js` re-run — `VERIFY-schema.sql` now covers
  347 live objects from 133 migrations (up from 293/113, which also retroactively picked up the
  2026-08-31 Issues history migration that had not been folded in yet); `supabase-build.sql`
  regenerated with the same 9 pre-existing dependency reorderings plus this session's two new
  migrations appended before the deferred base tail.

⚠️ **Not verified signed in** — no live login is possible in this environment, the standing
constraint for every UI pass in this repo. No live click-through of the schedule occurrence math
against a real calendar month, the attendance battery against real recorded attendees, the
hold/close workflow, or the history table against real data; the migration has not been run.

### Explicitly NOT done this pass
- **Item #24** (download as HTML / PDF / PPTX for Issues, Lessons, and Minutes) — this module's PDF
  export already exists from an earlier session and was extended to print the new fields (attendee
  tiers, venue/link/recording, group, hold/closure narratives); no HTML or PPTX export exists
  anywhere in the suite, and none was built this pass.
- The dashboard's "conducted as scheduled" pie and the frequency/attendance stats are computed
  client-side over `MOMS`/`SCHEDULES`, both already loaded for the project — no new query cost, but
  also no portfolio-level rollup across projects (not asked for).

`module.css/js?v=20260901a`; `MODULE_V` (via `modules-grid.js?v=` on `dashboard.html`/
`modules.html`) → `20260901a`.

## 2026-08-31 (b) — Fix: stale title-hiding rule stacked the module icon and title

Owner-reported bug (screenshot), fixed as part of the same-day Issues & Concerns pass — see that
module's CLAUDE.md for the full root-cause explanation (a rule superseded by the shared
`.pd-modulebar` layer's 2026-07-24 decision to always show module title text, never removed from
either module's own stylesheet). This module's copy — `@media (max-width: 1500px) { .il-title
.il-title-txt { display: none; } }`, copied verbatim from Issues & Concerns at the module split —
removed with an explanatory comment in its place. No JS change; no `?v=` bump needed beyond whatever
the sibling module's pass already triggers app-wide (`MODULE_V` via `modules-grid.js?v=`).

## 2026-08-31 — Module created: Minutes of Meeting split out of Issues, Concerns & Lessons Learned

Owner: *"the minutes of the meeting and the issues and concerns should be two separate modules"* —
with three concrete requirements: (1) the link between the two modules stays; (2) this module gets a
List view and a Calendar view of every meeting on the project; (3) the "Raise as issue" button in the
Add Minutes form is gone, replaced by "Get from issue" — pulling something already raised (during a
PPR, or anywhere) onto the agenda, rather than raising a new issue from the minutes.

Tables `meeting_minutes` / `mom_items` are unchanged — **no migration for the split itself.** What
moved is the code. See `modules/issues-lessons/CLAUDE.md` for the other half of this same change.

**The split, precisely.** `window.IssuesLessons` was one IIFE with three screens sharing state (`rows`,
`MOMS`/`MOM_ITEMS`, one project selector, one collab channel keyed on `issues_lessons`). Minutes of
Meeting is now `window.MinutesOfMeeting`, its own module folder, its own topbar, its own project
context, its own presence channel (keyed on `meeting_minutes`). Lessons Learned stayed with the
register — it is captured *from* an issue far more often than from a meeting, and splitting it a third
way was not asked for.

⚠️ **The link is kept as TWO LIGHT READS, never a shared editor — same shape as every other
cross-module link in this app (the schedule's `wpm_work_packages` mirror, Cash Flow's WPM read).**
- This module reads a light copy of `issues_lessons` (`ISSUES` — id, description, status, department,
  champion(_ids), corrective_action, caused_by) purely so a linked action item can show the register's
  **live** status and so "Get from issue" can list what is open to bring in. It never writes to
  `issues_lessons`.
- It also reads a light copy of `lessons_learned` (`LESSONS`), for the "N lessons" badge on an action
  item — capturing or opening a lesson now **navigates to the sibling module**
  (`../issues-lessons/index.html?screen=lessons&momId=…&momItem=…&issueId=…`, or `?openLesson=…`)
  rather than switching a local screen, because Lessons Learned's editor lives there now. The receiving
  side is in `modules/issues-lessons/module.js`'s `init()`.
- The reciprocal direction — the register's "From MOM" tag — is `issues-lessons`'s own light read of
  `meeting_minutes` (unchanged by this split, see that module's CLAUDE.md).

⚠️ **"Raise as issue" is gone, and it is not a smaller version of the old feature reversed — it is the
opposite direction.** The old button copied an action item's text INTO a brand-new `issues_lessons`
row. Now that Issues & Concerns is its own module, creating issues belongs there; this module only
ever **pulls** — `momPullOneIssue(momId, issueId)` inserts a `mom_items` row from an EXISTING issue
(same payload shape `momIssuePayload()` the bulk "Add all" pull already used, factored out so the two
routes cannot disagree). The per-row "Raise as issue" button and its deadlock-prone gating are deleted
outright, not hidden behind a flag.
- **"Get from issue"** replaces it at the action-items header, beside "+ Add action item": a small
  searchable panel (`momGetPanelHTML`) listing `momOpenIssuesFor(mom.id)` — issues that are still open
  and not already on this agenda — each a one-click add, plus a **"+ Add all N"** that reuses the
  existing bulk `momPullIssues()` (kept from before, still auto-seeds a brand-new minute with the
  register's open issues, still offered explicitly mid-meeting). Disabled with a reason when there is
  nothing left to bring in, rather than a live button that toasts an empty result.
- ⚠️ **Idempotent by construction**, same as the bulk pull: an issue already linked on this agenda is
  refused with a toast rather than added a second time.
- ⚠️ **`mom_items.issue_id → issues_lessons.id` is the SAME link the old "Raise" wrote.** Only which
  side creates the row is reversed, so every existing raised action, every "From MOM" tag, and the
  register's own status pill on a linked item all keep working unchanged.

**List and Calendar views (the second ask).** The module used to open straight into a two-pane
list+detail editor with no way to see "every meeting" as its own screen. It now has three states —
`_momView`: `'list' | 'calendar' | 'detail'` — List/Calendar are how you **browse**, Detail is the
single-meeting editor (the old two-pane view, essentially unchanged, now reached by selecting a row/
chip or "+ New minutes" and left via "← Back to meetings").
- **List** (`renderMomListHTML`): a sortable table — Title / Type / Date / Draft-or-Distributed /
  Action items (with an open count) / Recorded by (never a real name — same privacy posture as
  `minuteByLabel`, a department user has no business being granted a read of `users` for a caption).
  Click a column header to sort; click a row to open it.
- **Calendar** (`renderMomCalendarHTML`): a Monday-first month grid, matching the convention this suite
  already established for the Portfolio Overview milestones calendar. Prev/Next/Today nav; each day
  cell lists up to 4 meeting chips (draft meetings dashed/muted) with a "+N more" note past that; a
  chip opens that meeting. ⚠️ **UTC throughout** — the grid is built from `Date.UTC()` and every
  meeting is matched against its plain `meeting_date` text, never parsed into a local `Date`. That
  local-vs-UTC off-by-one has bitten this app repeatedly (`minusDays` in both registers, the drawing
  importer) and a calendar is exactly the screen where it would silently move a meeting onto the wrong
  day.
- Both share one search box (`momSearchList`, unchanged from the original sidebar picker) and the
  "+ New minutes" action (factored into `momCreateNew()`, still auto-seeding the new minute's agenda
  from the register's open issues via the quiet bulk pull, still switching straight into Detail on the
  new row).
- ⚠️ `_momBrowsePrev` remembers which of List/Calendar was active before opening a meeting, so "Back to
  meetings" returns to the same view rather than always resetting to List.
- Browser-history integration (`UI.bindHistoryState`, key `mom_view`) covers all three states, so the
  browser's own Back button steps List → Calendar → Detail correctly instead of jumping straight past
  every view to the module launcher.

**What moved verbatim (unchanged behaviour, just relocated):** the Detail editor itself
(`momDetailHTML`/`momItemRowHTML`/`momFilterBarHTML`/`momFieldHTML`/`momActChipHTML`), the activity
picker (server-side search against `project_schedule`, never a full list — this module still does not
own the schedule), distribute/revert (`momSetDistributed`), carry-over from another meeting
(`momCarryable`/`momCarryOver`), attachments (`momAttach*`, the same private-bucket + four-rule
ordering as before), and the PDF export (`momDownloadPDF`, byte-for-byte the same mom-app-format
sheet, including the fix that keeps the captured node in normal flow). The People Picker (Responsible)
is a verbatim duplicate of the block Issues & Concerns also carries for Champion — deliberately kept as
two copies rather than promoted into a shared asset, to avoid widening this split into a shared-file
change beyond what was asked.

**Verified.** `node --check` clean on `module.js`; CSS braces balanced (156/156); every `il-*` class the
JS emits resolves to a rule in `module.css` except plain JS-hook classes with no dedicated styling
(`il-mi`, `il-if`-equivalents, the new-person form fields) — the same pattern the combined module
already used. Cross-checked every `mom`-prefixed function called against what is defined in the file —
none missing. Confirmed no leftover reference to `rows`/`TABLE`/`screen`/`MOM_BY_ID`/
`populateFilterOptions`/local `newLesson`/`openLesson`/`renderMom`/`switchScreen` — the things that only
make sense inside the combined module — survived the split.

⚠️ **Not verified signed in** — no live click-through of the List/Calendar views, "Get from issue", the
cross-module lesson deep-link, or the PDF export against real data. The module reuses the same
`meeting_minutes`/`mom_items` schema the combined module already shipped against, so no new migration
risk was introduced, but the new UI paths (browse toolbar, calendar grid, get-panel) are unexercised
against a live login.

`config.js` gained the `minutes-of-meeting` entry (icon `calendar` — the only module using it so far);
`MODULE_V` (derived from `modules-grid.js?v=` on `dashboard.html`/`modules.html`) bumped to
`20260831a`, which also covers the trimmed `issues-lessons/index.html`. `assets/js/my-work.js`'s row
click now routes `data-screen="mom"` items to this module instead of `issues-lessons`.
