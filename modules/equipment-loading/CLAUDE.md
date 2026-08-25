# Equipment Loading — module change log

Per-project equipment register, its monthly planned/actual loading histogram, and a
site-development plan view that pins vertical/ground equipment to towers.

## What it is
Three tabs:

| Tab | What it does |
|---|---|
| **Loading** | The OPS "Equipment Loading Graph": grey planned bar per month with the actual stacked in front (major solid, tools in the light tint), a cut-off month band, KPIs, and the Planned/Actual matrix below it. Editable per (equipment, month) in **By equipment** mode. |
| **Equipment** | The register — name, category, purchase/rental, unit, cost per unit-month, supplier, site block, **schedule link**. |
| **Site Plan** | The project's site development plan as a backdrop, each tower traced as a shape, and equipment assigned to one or more of them. |

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

---

## 2026-08-24 — Equipment codes, towers linked to the schedule, and equipment SHARED between towers

**Run `migrations/2026-08-24-equipment-code-and-sharing.sql`** (after the three earlier ones).

**1. Chart ↔ matrix alignment, and 3-letter months.** A bar now sits directly over its own
column in the grid below it.
- ⚠️ **The chart's origin and pitch come from the matrix, not from the pane width**:
  `padL = MX_C1 + MX_C2` (150 + 84, the two sticky label columns) and `bw = MX_CELL` (46). Those
  three numbers are duplicated in the CSS and **cannot be read at render time** — the matrix may
  not be laid out on the first paint. Change one, change the other.
- ⚠️ **Two real defects, both found by measuring rather than reading.** (a) `.eq-mx` was
  `min-width:100%` with auto table layout, so the browser widened every column to fill the pane —
  the label columns measured **211/118 against the declared 150/84** and a month cell **65 against
  46**, so the chart lined up with nothing. Now `table-layout:fixed; width:max-content`. (b) After
  that the offset was a **constant 16px**: the chart's card has `padding:14px 16px` while the
  matrix card is `padding:0`, so the two boxes had different left origins. The chart wrap now
  bleeds out by exactly that padding.
- Both boxes scroll horizontally in step (guarded against the assign-back loop that reads as a
  stutter on a trackpad).
- Measured after: bar centre vs its column centre **0px** on all 14 months, the cut-off band exactly
  over the cut-off column (dx 0, dw 0), no page horizontal scroll.

**2. A unique equipment CODE (`equipment_items.code`).** Unique per project, case-insensitively;
the **name is deliberately free to repeat**, because a project really does have three rows called
"Tower Crane" and telling them apart by name is impossible. Shown in the register, the matrix row
labels and the export.
- ⚠️ **Unique per PROJECT, not globally** — two projects legitimately both number their first crane
  TC-01, and a global constraint would refuse the second with an error nobody could act on. A
  cross-project asset register is a different table and a later decision; the code is what such a
  view will join on, which is why it is required from the start.
- The clash is checked in the UI **as well as** by the index: the index gives a raw PostgREST
  error, and "TC-01 is already used by Tower Crane 2" is the only version a planner can act on.
- ⚠️ A new item is proposed the next free code, and the JS prefix rule matches the migration's seed
  exactly (`left(regexp_replace(category,'[^A-Za-z]','','g'),2)` → `GR-01`, not initials), so a
  seeded row and a new one never collide.

**3. A shape can be linked to the schedule's own tower (`plan.blocks[].tower`).**
- ⚠️ **Stored separately from the shape's NAME**, which is a label a planner types. They routinely
  differ ("T1" on the plan, "Tower 1" in the schedule), and deriving one from the other is how a
  tower silently ends up matching no activities and therefore having no window at all.
- Selecting a shape reveals a dropdown of the project's real tower values (with activity counts,
  from `project_location_values`), plus its resolved **schedule window** underneath.

**4. Equipment is now MANY-TO-MANY with towers (`equipment_tower_links`).** The left pane exists to
answer one question — *can one crane serve two buildings?* — and that needs an asset to hold two
placements.
- ⚠️ **A join table, not an array column.** A tower crane serving two towers is one asset with two
  placements, and the questions asked of it are per-placement ("what does Tower B have?", later "is
  TC-01 free in March?"). An array can hold the ids but cannot be joined, counted per tower by the
  database, or later carry a placement's own dates without rewriting every reader.
- ⚠️ **`site_block` is backfilled into it and then left in place, unread.** Dropping the column in
  the same migration that starts using the new table leaves no way back if the backfill was wrong.
- Clicking a **second** tower on the plan **adds** a placement rather than moving the first — that
  is the sharing case. Saving from the form **diffs** the placements rather than clearing and
  rewriting, so an untouched one keeps its row.
- ⚠️ If the migration has not run the tab still **shows** existing single assignments (read from the
  legacy column) but refuses to write, naming the file — silently accepting a write into a table
  that does not exist would lose it.
- Deleting a shape deletes its placements explicitly; there is no foreign key behind `block_id`
  (it is a shape id inside the plan jsonb), so the rows would otherwise point at nothing.

**5. "Shared between towers" panel — the actual answer, from the schedule.**
- ⚠️ **Judged on the towers' schedule WINDOWS, never on the register.** Two placements are only a
  plan; whether they can be the same physical crane depends entirely on timing. A tower's window is
  the earliest start / latest finish of the activities tagged with its linked tower value — two
  indexed reads per tower, cached.
- ⚠️ **Overlap is judged in MONTHS**, matching the loading matrix's own resolution. A two-day
  calendar overlap is not a scheduling problem, and reporting it as one trains the planner to ignore
  the panel.
- ⚠️ **Peak planned quantity decides whether an overlap is a clash** — two units of the same code
  covering two towers at once is a fleet, not a conflict.
- ⚠️ **An unlinked tower reads "timing unknown", never "fine".** It names which tower needs linking.

**6. Copy / paste / duplicate a shape.** Ctrl+C / Ctrl+V on the plan, or the rail's Copy button.
⚠️ **The geometry is copied, never the placements** — a second tower is a different building, and
inheriting the first one's equipment would assign a crane to a tower nobody put it on.

**Verified** — 29 checks executing the shipped `towersOf` / `hasTower` / `towerNamesOf` /
`blockCounts` / `nextCode` / `overlapMonths` / `sharingRows` / `blockTowerVal` / `shapeOffset` /
`nextTowerName` (sliced from the file, never reimplemented): every placement listed, per-tower
counts counting each placement once, a deleted shape still reading honestly, the code prefix rule
matching the migration and the skip being case-insensitive, sequential towers reading shareable,
concurrent towers reporting 3 months of overlap, a two-day overlap inside one month counting as that
month, overlap symmetric, an unlinked tower named as unknown with no pair judged, and 2 planned units
covering a two-tower overlap while 1 does not. Plus the browser measurements in (1), the register's
header/row cell counts aligned at 12/12, a clean parse, and every `getElementById` target present.

**NOT verified** — nothing signed in (the anon key has no grants): the placement writes, the
`location->>'<level id>'` window reads, the tower-value RPC, and the pointer gestures are untested
against real data, and the migration has not been run.

---

## 2026-08-24 — A save no longer dies on a column the database does not have yet

Reported from the live site: adding a Tower Crane failed with
*"Could not add: Could not find the 'code' column of 'equipment_items' in the schema cache"*, and
**everything typed into the form was lost**.

⚠️ **The trigger was the un-run migration, but the defect was the all-or-nothing write.** PostgREST
answers an unmigrated column with PGRST204 and **rejects the whole row** — so one column the database
had not heard of threw away the name, category, acquisition, unit, supplier, towers and schedule link
the planner had just filled in, and the message named a column rather than an action.

**Fixed with a tolerant write** (`tolerantWrite`): on a missing-column error it drops the column
PostgREST named, retries, and reports which fields were not stored **plus the exact migration file to
run**. Applied to the item insert/update, the sync's link-stamp, and the sync's own writes to
`equipment_loading` (which carry `source`).
- ⚠️ **Only a MISSING COLUMN is tolerated.** A constraint violation, an RLS refusal or a bad value
  must still fail loudly — a save that silently discarded real data would be a worse bug than the one
  being fixed. Asserted both ways in the suite.
- ⚠️ **It works on a COPY of the payload**, so a caller that reuses or re-reads its object is not
  quietly mutated.
- ⚠️ **`equipment_loading.source` missing is reported once per sync, not per row**, and says what it
  costs: the months are still written, but without that column a re-sync cannot tell its own previous
  output from a planner's hand-typed number, so it stops clearing its own stale months.
- ⚠️ **A toast is not enough** — it disappears, and what is left on screen is a register with blank
  codes and no explanation. The pending migration now also renders as a **standing banner** in the
  same place the missing-tables warning uses, until it is run.

**Verified** — 16 checks executing the shipped `tolerantWrite` / `missingColumn` / `reportDropped` /
`renderMigrateBanner` against a fake PostgREST that reproduces the reported PGRST204 message: the row
saves with only `code` dropped and every other field intact, exactly one retry, the caller's payload
unmutated, three missing columns peeled off one at a time, a unique-constraint violation and an RLS
refusal both still failing, a named column that is not in the payload not looping, and the toast +
banner naming the migration rather than the column. Parse clean, CSS balanced, **0 functions lost**.

**The real fix is still to run the migration** — `migrations/2026-08-24-equipment-code-and-sharing.sql`
(after the earlier three). Until then codes and tower sharing are simply not stored, and the module
now says so instead of refusing the save. ⚠️ After running it, **reload the page**: PostgREST caches
the schema, and an already-open tab keeps the old one.

---

## 2026-08-24 — Site Plan: Ctrl+scroll zoom, and drag a chip onto a tower to assign it

Two owner asks, both about making the plan usable on a real site drawing rather than a fixture.

**1. Zoom.** Ctrl (or Cmd) + scroll over the plan zooms around the cursor; the pane scrolls at any
zoom past fit. A **− / % / + / Fit** control sits in the toolbar so the gesture is discoverable, and
the help line names it.
- ⚠️ **The zoom lives on a new inner wrapper, NOT on the stage** — and this is the whole trap. A
  percentage padding resolves against the **containing block's** width, so widening the stage itself
  would double its width while `padding-bottom` kept computing from the old container: the backdrop
  would letterbox while the shapes did not, and every traced tower would sit off its building. The
  wrapper takes the zoomed width; the stage stays 100% of it. **Measured: aspect 1.4286 = 1000/700
  at both 100% and 152%.**
- ⚠️ **Zooming does not re-render.** It sets the wrapper's width and fixes the scroll offset, so a
  shape mid-drag or a trace in progress survives the gesture. Everything else keeps working because
  every pointer position is read through `getBoundingClientRect`, which is already zoom-aware.
- ⚠️ **The wheel listener is bound ONCE on the container (which survives every re-render) and is
  non-passive.** A passive listener cannot `preventDefault`, and without that Ctrl+wheel zooms the
  whole browser page instead of the plan. A plain wheel still scrolls the plan — asserted both ways.
- ⚠️ **`PLAN_ZMIN` is 0.2, not 1.** The pane is height-capped, so a tall plan still overflows
  vertically at 100%; a Fit that could not shrink would not fit anything. Measured: Fit lands at
  **77%** with the whole plan inside the pane both ways.
- Anchor stability measured: a plan point under the cursor drifts **1px across three zoom notches**
  (rounding, plus `clientWidth` changing when the scrollbar appears).

**2. Drag an equipment chip onto a tower.** Chips carry a grip and their code, and drop onto either
the **shape on the plan** or the **tower row in the rail**; the target lights up while dragging.
- ⚠️ **A drop only ever ADDS a placement.** The click path still toggles (click a tower the item is
  already on to take it off), but a drag that silently unassigned when you dropped on the wrong tower
  would destroy a placement nobody meant to touch. Dropping on a tower it is already on says so.
- ⚠️ **The rail row is a drop target as well as the shape** — past Fit most towers are off screen,
  and a feature that only works while you can see the shape stops working exactly when the plan gets
  big.
- ⚠️ **Click-then-click is kept, not replaced.** HTML5 drag-and-drop does not fire from touch, so on
  a phone tapping the chip and then the tower is the only path — which is also why the phone rules
  raise chips, tower rows and zoom buttons to the 44px minimum (measured at 29–31px before).
- A tool or service vehicle dropped on a tower is refused **with the reason**, not ignored; so is a
  drop that lands on the sheet but not on a tower.
- The plan does not claim a drag it did not start (files, text): `dragover` only preventDefaults
  while one of our chips is in flight.

**Verified** — the shipped `setZoom` / `fitZoom` / `syncZoomLabel` / `wireZoom` / `clearDropMarks` /
`wireDropTarget` / `dropChipOn` sliced out of the file and driven in a real browser against the
shipped CSS: aspect preserved at zoom, 1px anchor drift, Ctrl+wheel prevented and a plain wheel not
zooming, clamping at both ends with the buttons disabling, Fit fitting vertically, drops landing on
the shape and on the rail row, the repeat drop refusing to unassign, the tool refusal, the
drop-on-empty-sheet message, and no claim on a foreign drag. Phone at a 375px layout viewport: 44px
chips/rows/zoom buttons, 0 page horizontal scroll; desktop unchanged at 1280. All four earlier
equipment suites still green, parse clean, CSS balanced, **0 functions lost**.

⚠️ **Not verified signed in** — the anon key has no grants, so the drop's actual write to
`equipment_tower_links` is exercised against a stub, not against real data.
