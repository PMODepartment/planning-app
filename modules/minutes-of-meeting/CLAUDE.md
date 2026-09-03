# Module: minutes-of-meeting

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
