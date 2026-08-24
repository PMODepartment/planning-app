# Equipment Loading — module change log

Per-project equipment register, its monthly planned/actual loading histogram, and a
site-development plan view that pins vertical/ground equipment to towers.

## What it is
Three tabs:

| Tab | What it does |
|---|---|
| **Loading** | The OPS "Equipment Loading Graph": grey planned bar per month with the actual stacked in front (major solid, tools in the light tint), a cut-off month band, KPIs, and the Planned/Actual matrix below it. Editable per (equipment, month) in **By equipment** mode. |
| **Equipment** | The register — name, category, purchase/rental, unit, cost per unit-month, supplier, site block, **schedule link**. |
| **Site Dev** | A drag-and-drop plan of the site's blocks (towers). Pick an equipment chip, click a block to assign it. Blocks can be pulled from the schedule's own Location Breakdown values. |

## Tables
`equipment_items` (register) · `equipment_loading` (one row per equipment per month) ·
`equipment_site_plan` (one jsonb row per project: block geometry + `level_id`).

Migrations, both to be run in the Supabase SQL editor:
- `migrations/2026-08-24-equipment-loading.sql` — the three tables, RLS, the
  `project_location_values` lookup.
- `migrations/2026-08-24-equipment-schedule-link.sql` — the schedule-link columns and
  `equipment_loading.source`.

## Design notes
- **The month axis is the project schedule's**, not typed here: earliest activity start to
  latest finish, WBS-Summary rows excluded (they carry stale imported dates — one was 337
  days out — which would stretch the axis by a year). The note under the controls always
  says which source the axis came from.
- **Monthly quantities are their own table, not a jsonb blob** on the item: a blob cannot be
  filtered, summed per month by the database, or edited by two people without one clobbering
  the other's month.
- **The site plan IS a jsonb blob**, deliberately the opposite call: it is geometry, read and
  written as one picture, never queried a block at a time.
- `equipment_items.site_block` stores the block's **id, never its name** — renaming a tower
  must not orphan every assignment.
- Only Vertical and Ground Equipment can be pinned to a block. Tools and service vehicles move
  around the whole site, so asking which tower they belong to would invent an answer; the site
  filter therefore excludes them rather than reporting a tower as having no tools.
- Actuals after the cut-off month are left **blank, not zero** — "not reported" and "none on
  site" are different facts, and drawing them the same makes every future month a shortfall.

---

## 2026-08-24 — Link an equipment line item's DURATION to the project schedule

The register could say what equipment a project has and how much of it is on site each
month, but not *why* a month was loaded: planned months were typed by hand, so when the
schedule moved the loading sheet did not. That is the failure mode of the spreadsheet this
module replaces. This adds the link.

**What was built**
- An item can point at **one schedule activity** or a **WBS branch**, with a quantity and
  optional mobilisation lead / demobilisation lag in months. Its planned months are then
  derived from that link: `link_qty` units for every month the linked dates span.
- A **schedule search** in the item form (activity id / name, or WBS branch), with an
  **"only this block"** filter that restricts the search to activities tagged with this
  item's tower — the site-development perspective and the schedule meeting in one picker.
- A **sync** (topbar link button, and automatically right after saving a linked item) that
  writes the derived months into `equipment_loading`.
- A **drift check** on load: every linked item is re-resolved against the schedule and a
  banner names the items whose span has moved, with a "Re-derive now" button.
- The register grew a **Schedule link** column: what it is linked to, the resulting duration
  and quantity, and a "schedule moved" flag.
- ⚠️ **Fixed a bug in the same day's first version**: "Pull towers from the schedule" called
  `project_location_values(pid, 'tower')`. `project_schedule.location` is a jsonb map keyed by
  a **`location_levels` UUID**, so the literal `'tower'` matches nothing on any project — the
  button could only ever report "no towers". It now reads the project's Location Breakdown
  levels, defaults to the one named like a tower/building/block, remembers the choice in
  `plan.level_id`, and exposes a **Site level** picker in the Site Dev toolbar.

**Decisions worth keeping**
- Derived months are **written into `equipment_loading`**, not computed at render time: the
  chart, matrix, export and the dashboard tile all read that one table, and a second invisible
  source of planned quantities would make them disagree the moment anything read it directly.
- `equipment_loading.source` records who wrote a month. The sync only ever clears rows it owns
  (`source='schedule'`); a planner's own number survives a re-sync. Without that column a
  re-sync cannot tell its own previous output from a hand correction, and would either wipe
  corrections or keep stale months forever. **Actuals are never touched by the sync.**
- Planned cells of a linked item are shown **locked** in the matrix rather than accepting an
  edit the next sync would throw away.
- `link_activity_id` stores the schedule's **`activity_id` text, not the row's uuid**: a
  re-import replaces every `project_schedule` row (new uuids) while the activity ids are what
  stay stable.
- The drift check is **read-only**. A sync that fired by itself would overwrite a plan someone
  is part-way through explaining, so re-deriving is always the planner's explicit action.
- The search term is stripped of PostgREST's filter punctuation (`, ( ) * % \`) before it goes
  into an `.or()` string — otherwise a typed comma ends the filter early and the server answers
  a different question than the one asked.
- Link months are **not clipped** to the module's month axis: the axis comes from the same
  schedule, so a link falling outside it means the two disagree, and silently dropping those
  months would hide exactly that.

**Verified**
- The inline script parses; the shipped text of `linkMonths` was sliced out of the file and
  executed against 7 cases (single month, month-end spanning, lead/lag crossing a year
  boundary, negative lead ignored, missing dates, a 20-year span not hitting the 600-month
  guard). All pass.
- Every `getElementById` target exists in the static markup.

**NOT verified** — the anon key has no grants on these tables, so nothing below was exercised
signed in:
- the sync, drift check and schedule search against real Supabase data;
- the `location->>'<level id>'` filter used by "only this block";
- both migrations have **not been run** — the owner must run
  `migrations/2026-08-24-equipment-loading.sql` and then
  `migrations/2026-08-24-equipment-schedule-link.sql` in the Supabase SQL editor. Until then
  the module shows its "needs its tables" banner.
