# Module: minutes-of-meeting

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
