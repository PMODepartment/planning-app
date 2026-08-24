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

---

## 2026-08-24 — "Site Dev" becomes **Site Plan**: a real plan view with traced tower shapes

The tab was a blank grid with draggable rectangles. It is now the site development plan itself,
with each tower marked on it as a shape you can trace, reshape, label and assign equipment to.

**What was built**
- **Backdrop** — upload the project's site development plan (PNG/JPG, ≤12 MB) as the plan view's
  background. Stored in a new private `site-plans` bucket; the row keeps the object **path** and
  the module signs a short-lived URL on demand.
- **Detect towers** — thresholds the uploaded plan (Otsu), groups the connected dark pixels, and
  offers each solid blob's footprint as a shape, numbered `Tower 1…N` in reading order.
- **Draw shape** — trace a tower corner by corner; click the first point again, press Enter, or
  press Finish to close it. Esc abandons. **+ Rectangle** still adds a 4-corner box.
- **Free shape editing** — drag the outline to move, drag a white handle to move a corner, drag a
  faded midpoint handle to **add** a corner, Alt-click a corner to **remove** one. Double-click or
  the rail's Rename button relabels a tower; the rail also deletes one.
- **Assignment is unchanged** — pick an equipment chip, click the tower.

**Decisions worth keeping**
- ⚠️ **The stage's height comes from the SAME aspect as the svg viewBox** (`padding-bottom` =
  `PLAN.h / 1000`). A fixed-height stage would letterbox the backdrop while the shapes were not
  letterboxed, and every traced tower would sit off its building. Measured: plan-unit → screen via
  the svg CTM equals the manual linear mapping to **0px** at both widths tested.
- ⚠️ **Legacy rect blocks are READ as 4-point polygons, never migrated on load.** A plan written by
  the first version keeps working, and opening the tab stays a read. `setPts` retires `x/y/w/h` the
  first time a shape is edited, so a block can never carry two disagreeing shapes.
- ⚠️ **Replacing the backdrop rescales the existing shapes** by the aspect change — otherwise a new
  scan of the same site silently moves every tower off its building.
- ⚠️ **The image is fetched to a blob and shown from an object URL**, not straight from the signed
  URL: a cross-origin image taints a canvas and `detectTowers` reads pixels back out of one. Same
  round-trip the PPR export has to make.
- ⚠️ **Detection is a SUGGESTION and the UI says so.** A site plan carries roads, hatching, title
  blocks and text, all dark pixels. Two filters do the real work: a size band (0.35%–35% of the
  sheet — below is text, above is the border frame) and a **fill ratio** (a footprint is solid; a
  road network sprawls across a mostly-empty box). Everything it proposes is an ordinary shape.
- ⚠️ **The flood fill is iterative with an explicit stack.** A recursive one blows the call stack on
  a large blob, which on a real plan is every building. Verified against a 160,000-pixel blob.
- ⚠️ **Deleting a shape clears `equipment_items.site_block` explicitly.** That column holds a plain
  id with no foreign key behind it, so the rows would otherwise point at nothing and read as
  "unknown block" forever.
- ⚠️ **Enter/Esc are bound only while drawing AND on this tab**, so they cannot swallow a keystroke
  meant for the matrix editor or a modal.
- ⚠️ **`align-items:stretch` in the ≤1000px media query is load-bearing.** In column direction the
  inherited `flex-start` sizes each pane to its content, and the stage is an empty padding-box — the
  plan collapsed to **0×0**, measured at a 653px layout viewport before the fix.

**Verified** — 22 checks executing the shipped `bpts` / `setPts` / `bboxOf` / `ptsAttr` / `clamp` /
`planH` / `otsu` / `components` (sliced from the file, never reimplemented): legacy rects read as
polygons without mutating the row, `setPts` retires the rect fields, the bbox of a concave shape,
Otsu splitting both a white-paper and a grey-scan histogram, exact component bounding boxes, the
size floor rejecting a stray pixel, an L-shaped run failing the fill test while a solid block passes,
a full-sheet blob landing over the 35% guard, and the 160k-pixel stack case. Plus a real browser at
desktop and a 653px layout viewport against the shipped CSS: stage aspect equals the viewBox
exactly, the svg fills the stage to the pixel, CTM mapping error 0, no page horizontal scroll, and
dark mode entirely on tokens. The script parses and every `getElementById` target exists.

**NOT verified** — nothing signed in (the anon key has no grants), so the upload, the signed-URL
read, detection against a real plan, and the pointer drag/trace gestures are untested against real
data. **Owner action:** run `migrations/2026-08-24-site-plan-bucket.sql` (after the two equipment
migrations) or the backdrop upload will report the bucket is missing.
