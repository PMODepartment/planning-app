# Module: issues-lessons

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
