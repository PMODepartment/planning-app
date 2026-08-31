# Module: minutes-of-meeting

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
