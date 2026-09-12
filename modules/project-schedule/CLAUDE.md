## The changelog is archived by month (2026-09-07) — fmlozano

Owner: *"finish the consolidation."* This file was **1,031 KB / 14,693 lines** — unreadable, and
too large to orient in. Entries older than 2026-09-04 moved **verbatim** into
[`changelog/`](changelog/), one file per month; it is now **48 KB / 712 lines**.

- ⚠️ **No duplication here.** The doubling that hit the root `CLAUDE.md` (a merge that kept both
  whole logs) never touched this file: **398 entries, 398 unique**. It only looked otherwise when
  the splitter treated `### Verified` and `### The fix` as entry headings — entries are dated
  headings, sub-sections are not.
- Verified against the pre-change file: unique dated headings **398 → 398, 0 lost**.
- Nothing was summarised. Read `changelog/2026-08.md` and friends for anything older.

---

### The zoom control reaches the 3D stacking; migrated footprints arrive smaller, turnable, and with their corners fixed (2026-09-12 k) — ethanrobles10

Owner: *"the zoom control should also work on the vertical stacking 3d view and also, when the per
tower footprints are migrated, the default scale of the site plan should be way less. what if the
footprint of tower 1 is so big it is unable to be rotated? Also the migration of the footprints of
the tower, the users should not be able to edit the corner points of the footprint. It was already
defined. Meaning the only thing users are able to do are rotate the orientation and change
locations. that is it."*

### ⚠️ THE 3D VIEW ALREADY DOLLIED — NOTHING ON IT SAID SO
`cv.onwheel` has always moved `rot.r`, and it is unchanged. What was missing was any affordance: a
WebGL canvas has no scrollbar, no handle and nothing that looks zoomable, so the only statement that
it could be zoomed was the words "scroll to zoom" in small grey text under the card — a manual, not a
control. The same `.ps-zoomctl` the plan window uses is now built in `_vs3Build`, so it is on **every**
3D scene: the cards, the four panes of the focus window, and the Site view.

- ⚠️⚠️ **ONE CLASS FOR BOTH DRAWINGS.** `.zpw-zoom` / `.zpw-zpct` were renamed `.ps-zoomctl` /
  `.ps-zoomctl-pct` rather than copied. It is the same question asked of a different drawing, and
  two controls that looked different would be two things to learn.
- ⚠️⚠️ **ONE CLAMP.** `RMIN` / `RMAX` and `clampR()` replace the pair of limits that had been written
  out twice (the wheel and `setCam`). The buttons drive `rot.r` through the same function, so they
  can never offer a framing the wheel cannot reach, or stop short of one it can. **Measured**: the
  wheel and the buttons land on exactly the same two limits, on three model sizes.
- ⚠️ **`Fit` is `r0`** — this model's own default framing, not a number typed in here.
- ⚠️ **The readout is a RATIO of that default**, not a distance: "160%" means closer than the view
  the card opens at, which a planner can act on. Scene units mean nothing they can see, and they
  differ between a 3-storey model and a 40-storey one.
- ⚠️ **Synced from `applyRot`, not from the wheel handler.** The distance also changes on a restored
  camera, on a linked pane following this one, and on the buttons themselves; a readout wired to one
  of those three paths would sit there being wrong after the other two. It is why the four linked
  panes of the focus window all read the same number.
- ⚠️ `stopPropagation` on `pointerdown` as well as on click: the buttons sit ON the canvas, and the
  canvas starts an orbit on pointerdown — without it, pressing "+" would also turn the building.
- ⚠️ Removed in `dispose()`, beside the label layer and for the same reason: it is DOM this scene put
  on the host, and every repaint of this view disposes its scenes.

### ⚠️ THE DEFAULT SCALE: 0.62 OF A CELL → 0.38
A site plan is a **larger scale** than the floor plans it is built from — a tower that filled its own
sheet is a small object on a site. At two thirds of a cell the sheet read as a floor plan of four big
rooms, and the planner's first job was shrinking every footprint before they could start arranging.
Small is also the cheaper mistake: pressing + a few times is one gesture, dragging four overlapping
towers apart is not.

### ⚠️⚠️ "WHAT IF THE FOOTPRINT IS SO BIG IT IS UNABLE TO BE ROTATED?" — TWO WAYS IN, ONE CLOSED, ONE GUARDED
A shape's bounding box **grows as it turns**: a w x h rectangle at 45° needs `(w + h) / √2` each way.
`zpRotatePts` refuses a turn whose result will not fit the sheet, so a footprint can genuinely become
unturnable.

- ⚠️ **On IMPORT it could not, and measurement says so.** Even at 0.62, a slot is at most
  `0.62 x 0.62` of a cell and every angle still cleared the sheet. The import path was already safe;
  saying otherwise would have been claiming a fix for a bug that was not there.
- ⚠️⚠️ **The way in is the `+` BUTTON, and it was wide open.** Measured against the shipped code at
  HEAD: a footprint of an ordinary 2:1 tower, grown with eleven presses of `+`, reaches 988 x 494 on
  a 1000 x 620 sheet and **22 of 25 angles are then refused — including every quarter turn**. The
  planner would not find out until a turn they expected simply would not go.
- ⚠️ **`zpTurnable(pts, h)`**: every rotation of a shape fits inside the circle through its own
  corners, so the whole question is whether the **diagonal** of its bounding box clears the shorter
  side of the sheet. Import now caps the diagonal at `0.92 x min(ZP_W, siteH)` — it shrinks nothing
  that already fits — and `+` refuses the press that would take a **locked** area past it, at the
  point of growth, where the reason is still legible.
- ⚠️ **Only locked areas are guarded.** A hand-traced one may legitimately fill the sheet — the site
  outline drawn around the towers is supposed to.
- ⚠️ The rotate refusal now names the fix ("press − to make it smaller first"), because the fix is one
  button away and the planner is already looking at it.

### ⚠️⚠️ A MIGRATED FOOTPRINT'S CORNERS ARE THE FLOOR PLAN'S, AND ARE NOT EDITABLE HERE
Owner: *"It was already defined."* A corner dragged on the site plan would make it disagree with the
floor plan it was taken from — silently, with no way to tell afterwards which of the two drawings is
the building. `zpSitePlaceFootprints` marks every area it places `lock: 1`.

- ⚠️⚠️ **The enforcement is that paint() draws no handles**, and that is the right place for it:
  every corner gesture in this window — drag a corner, alt-click to remove one, click a midpoint to
  add one — reaches its corner through one of those two circles. No circles, no gesture. The body
  still drags, so moving is untouched, and **Orient** still turns it. The pointer handler checks
  `lock` too, so that anything drawing a handle in future cannot quietly re-open the corners.
- ⚠️⚠️ **The lock survives `zpNormPoly`.** That function rebuilds every area from scratch on load and
  returned exactly `{id, code, pts}` — a flag it did not copy would have been gone on the next
  reload, and a footprint that came back editable after a refresh is invisible until somebody drags a
  corner. **Verified** across the save/load round trip, and that a hand-traced area gains no lock.
- ⚠️ **Copy and Duplicate are refused on one.** A copy is written back as an ordinary area carrying
  the same tower name — a SECOND outline of one building, which is what this whole feature exists to
  prevent, and the "already on the site" check would then read the tower as done while one of the two
  drawings belongs to nobody. **Delete stays**, or a mistaken import could not be undone.
- ⚠️ **Resize (− / +) stays**, and that is a judgement against the letter of *"that is it"*: a uniform
  scale does not change the outline, it is the only way to say one tower is bigger than another on a
  plan where every footprint arrives at the same width, and the window's own scale note tells the
  planner to use it. The shape — which is what *"already defined"* is about — cannot be touched.
- ⚠️ Said in three places, because a planner reaching for a corner that is not there needs the answer
  where they are looking: a **dashed** outline when selected (a traced area shows its corners, this
  one has none to show), an SVG `<title>` on the shape itself, and its own line under the stage.

### Verified
- **538 assertions** driving the shipped `zpSitePlaceFootprints` / `zpTowerPlate` / `zpRotatePts` /
  `zpScalePts` / `zpTurnable` / `zpNormPoly`, sliced verbatim (harness gitignored, deleted): all 25
  angles on all four footprint shapes, area preserved and landing on the sheet each time; 24
  consecutive 15° turns never stick; every footprint's diagonal clears the sheet; every one fits its
  0.38 slot with its **own aspect** intact (7.5:1, 1:1, 1:3, 3:2); `lock: 1` on every migrated area
  and through normalize; a tall sheet and a multi-piece footprint behave; and a locked footprint
  grown with `+` until the guard stops it is **still turnable at all 25 angles**, on three sheet
  shapes.
- ⚠️ **Sanity-gated against HEAD**: the same harness run on the previous code fails 14 assertions
  (the slot sizes and every lock), and the growth gate above reports the 22-refused-angles state that
  the new guard prevents. A test that passes on both versions proves nothing.
- **42 assertions** on the 3D zoom, slicing `clampR`, the three button handlers and the `zoomUI`
  readout out of `_vs3Build` and running them against stub buttons: opens at 100% with Fit disabled,
  `+` and `−` stop exactly at `RMIN`/`RMAX` and disable themselves there, the readout crosses 100%
  the right way, Fit returns to `r0` exactly, and **the wheel reaches the same two limits and no
  further** — on three model sizes.
- **Layout measured in a browser** against the shipped stylesheets: the control sits inside the 3D
  mount and inside the plan stage, the same size in both; a locked area's outline computes to dashed
  `12px, 7px` where a traced one computes to `none`.
- ⚠️⚠️ **Not verified signed in.** The anon key has no grants, so no real footprint has been imported,
  locked, turned or grown in the app, and no three.js scene has been built — the zoom control's DOM
  and clamp are proven, a canvas with a building on it is not. First things to check on a real
  project: that a footprint brought in shows no corner dots, and that `+` on the 3D card moves the
  camera in and the readout with it.


### The plan window zooms like a CAD drawing, and the step behind it sheds three rows (2026-09-12 j) — ethanrobles10

Owner: *"make the space allotted for the site plan bigger. meaning it should be similar to autocad,
wheren you can zoom in zoom out. And also, simplify the UI pls, refer to the screenshot."*

### ⚠️⚠️ THE STAGE WAS ALREADY HUGE — IT JUST WOULD NOT FIT ON THE SCREEN
`.zpw-stage` was `width:100%` with the sheet's aspect, so on a 1180px modal it computed to roughly
1136 x 704. `.pd-modal` is capped at `max-height:90vh` and scrolls past it, so the drawing the window
exists for was the part you had to scroll to — and widening the modal could not have helped: every
extra pixel of width bought 0.62 more pixels of height the modal could not show.

- ⚠️⚠️ **The width is now capped by the height that actually fits**:
  `width:min(100%, calc(var(--zpvh) * var(--zpar)))` with `--zpvh: max(300px, calc(90vh - 360px))`.
  The whole sheet is on screen at once, and getting closer is the zoom's job rather than the
  scrollbar's.
- ⚠️ **90vh, not 100vh** — the sum that has to fit is the MODAL's, and the modal is the thing capped
  at 90vh. The 360px is this window's own chrome measured on the **site** plan, which is the taller
  subject (it carries the scale note); a budget that fitted the floor plan and not the site plan
  would scroll on exactly the drawing this was asked for.
- ⚠️ **The box keeps the sheet's aspect in BOTH dimensions.** The svg is stretched over it with
  `preserveAspectRatio="none"`, so a box of any other shape silently distorts every trace and
  `ptOf()` stops agreeing with what is drawn. `--zpar` is written by paint() from the sheet's own
  height; the literal in the CSS is only a fallback.
- The modal itself went `min(1180px, 96vw)` to `min(1560px, 97vw)`, which is what lets a wide sheet
  use the height once the height is the constraint.

### ⚠️⚠️ THE ZOOM IS A WINDOW ON THE SHEET, IN PLAN UNITS — NOT A TRANSFORM OVER THE DRAWING
`_zpWin.zk / zx / zy` is the zoom and the top-left corner of what is visible, **in the same units
every traced point is already stored in**. The svg's `viewBox` IS that window, so there is no second
coordinate system to keep in step and nothing to convert on the way out.

- ⚠️⚠️ **`ptOf()` was the only thing that had to change.** Every pointer position in this window —
  tracing a corner, dragging a shape, dragging a vertex, dropping the front marker — asks that one
  function where the cursor is in plan units. Adding the view offset there made every gesture work
  zoomed, with no gesture rewritten.
- ⚠️⚠️ **Clamped to the sheet, unlike AutoCAD.** Model space is infinite, so panning into nothing is
  harmless there; a plate is ZP_W x h and nothing exists outside it, so panning past the edge could
  only lose the drawing off-screen and leave a planner staring at blank paper. Zooming out past the
  whole sheet is refused for the same reason — that view already IS everything there is. Cap 12x.
- ⚠️ **The wheel zooms on the CURSOR** (`zSet(k, ax, ay)` holds the anchor point still), which is what
  makes it a magnifier rather than a slider: zooming in on a corner arrives at that corner, not at
  the middle of the sheet. The plus/minus buttons anchor on the middle, because they have no cursor.
- ⚠️ **Pan is a background drag, and only once zoomed in** — at 100% the whole sheet is already on
  screen, so a drag that moved nothing would read as broken. Middle-button drag pans at any zoom,
  which is the habit AutoCAD leaves people with. Shapes and the marker stopPropagation on their own
  `pointerdown`, so dragging one still moves it; panning only ever sees a press on empty paper. Not
  while tracing or placing — those are pointer modes of their own, and a left drag that panned
  mid-trace would swallow the click meant to be a corner.
- ⚠️ **Every annotation is sized on SCREEN, not in plan units.** Line weights hold through
  `vector-effect:non-scaling-stroke`; handle radii are divided by the zoom in paint(); labels use
  `--zs` (1/zoom) written on the svg. A 3-unit stroke at 6x is a fat band that swallows a small zone,
  and a handle that grew with the zoom would cover the very corner you zoomed in to reach.
- ⚠️ **The control sits ON the stage**, not in a toolbar row: it is a control for the VIEW, and the
  edit row it would otherwise live in is not emitted at all until the sheet has a zone to draw — so a
  planner zooming in to place their first corner would have had no control at all.
- ⚠️ The pan rewrites the `viewBox` live and repaints once on release. A full `paint()` per
  pointermove rebuilds every control in the window underneath the cursor, and the pan judders.

### ⚠️ THE WINDOW'S OWN SETUP ROWS ARE FOLDED
Which image is underneath, how the sheet is shaped and which way the building faces are answered once
and then carried for the life of the drawing — and they cost ~90px of stage on every repaint. Folded
into one `<details>`, **open on a blank sheet** (attaching the plan really is the first move there)
and shut once anything is drawn.

- ⚠️ **The summary carries the STATE**, not just a name: sheet shape, image attached or not, where the
  front is. A fold that hides the facts as well as the controls is one you have to open to find out
  whether you need to open it.
- ⚠️ **The Floor-shape brush moved OUT of that fold** and onto the end of the palette row. It is a
  brush, and it had been sitting in a row of controls for the front marker, which is not a brush at
  all. The earlier note about keeping it out of the zone palette was protecting the DISTINCTION, not
  the row — a dashed swatch behind the words "Floor shape", after a divider, cannot be misread as a
  zone somebody forgot they named.
- ⚠️ `<details>` keeps its contents in the DOM when shut, so every id inside stays wired exactly as it
  was. The open/shut state lives on `_zpWin.more`, or every repaint — and this window repaints on
  every gesture — would spring it open under the planner's hands.

### ⚠️⚠️ `.sbld-mini` IS `width:62px`, AND IT HAD CAUGHT TWO MORE CONTROLS
The owner's screenshot shows it: **"Site plan 1/8" wrapped onto two lines inside a 30px-tall button**,
so the one number that button exists to report was cut in half, and the **Activity level** select read
**"Aut"** where it had to read "Auto (deepest defined)". That class is sized for the two-character
number inputs it was written for — the same trap already recorded in this file for the copy-from-trade
select on 2026-09-03. Measured after the fix: the site-plan button is 111px wide with
`scrollHeight === clientHeight`; the old one is 62px with `scrollHeight 36 > clientHeight 29`.

- New `.sbld-twbtn` (auto width, `white-space:nowrap`) for the tower bar; `width:auto` on the select.
- ⚠️ **Rename / Copy from… / Delete went behind one ⋯ menu.** They are all "…this tower", all
  occasional, and three of them in a row read as three more primary actions beside the two that ARE
  primary — adding a tower, and the site plan. Delete names the tower in its label, because it is the
  destructive one and a menu row reading just "Delete" does not say what it takes with it.
- ⚠️ The menu closes on the next press outside; the listener removes ITSELF once the step re-renders
  and its element is detached, rather than leaving one dead handler behind per render.
- ⚠️ **Quick-generate and copy-from-trade folded into one "Quick setup" panel**, open exactly when
  this tower and trade have no floors — the only moment either is the next thing to do. Two rows of
  controls that stood above the floors a planner had already typed, on every render, for the life of
  the project.
- ⚠️ The Activity level row's worked example moved into the select's `title`: a sentence about what
  four options mean, read once, that sat on that row forever.

### ⚠️ A CSS BLOCK THAT ONLY WORKED BY ACCIDENT
`.sbld-towerbar {` opened its declaration block, three unrelated `.sbld-towerbar-note` rules were
written INSIDE it, and its own `padding`/`border` closed the block ten lines later. It rendered only
because CSS nesting happens to be supported and the note really is a descendant of the bar — in a
browser without nesting every note rule was dropped and the drift warning lost its styling. Written
out flat.

### Verified
- **39 assertions** against `zView` / `zSet` / `zFit` / `ptOf`, sliced verbatim out of the shipped
  file and driven in node (harness gitignored, deleted): the wheel anchor holds the point under the
  cursor **exactly** where the clamp does not bite, and stays on the sheet where it does; the view
  never leaves the sheet at any zoom or anchor, including a tall sheet; the zoom clamps at 1 and 12;
  the window is always the sheet over k with the **aspect unchanged**; `ptOf` never returns an
  off-sheet point; 100px of screen is worth a quarter of the plan at 4x; Fit restores exactly.
- **Layout measured in a browser** against the shipped stylesheets (`dashboard.css` and the module's
  own `<style>`, both sliced verbatim into a gitignored harness, deleted): at 1440x900 the whole
  window is **782px against an 810px cap — it fits**; the stage is 725.8 x 450, an aspect of 1.6129
  against the sheet's 1.6129; the zoom control sits inside the stage; the ⋯ menu opens below the bar
  and fully on screen; and the two button measurements above.
- ⚠️⚠️ **Not verified signed in.** The anon key has no grants, so no real plate has been opened: what
  is proven is the view arithmetic and the CSS layout, not a drag on a real traced zone at 6x. The
  first thing to check on a real project is that dragging a corner while zoomed lands it under the
  cursor.

### The site plan is BUILT from the towers' own floor plans; all that is left is arranging and orienting (2026-09-12 g) — ethanrobles10

Owner: *"the pre-requisites first is to establish the per tower floor plan. meaning once the per tower
floor plan has been established, in the site plan, the resulting shapes from the per tower is migrated
into the site plan. And therefore just arrangement is just required and orientation. But obviously,
the site plan should have a larger scale since you are arranging the footprint / layout established on
per tower."*

### ⚠️⚠️ THIS REPLACES RE-TRACING, WHICH WAS THE SITE PLAN'S REAL COST
As shipped yesterday the site plan was a blank sheet with the tower names as brushes. So a planner who
had already drawn every tower's floors was asked to draw each tower **again**, freehand, at site scale
— a second outline of the same building, by hand, which can only disagree with the first. The owner is
describing the right dependency: the floor plans are the **prerequisite**, and the site plan is their
**arrangement**.

**`Bring in N tower footprints`** now leads the site window's tool row. It derives each tower's
footprint from that tower's own floor plans, places them on the site sheet, and leaves the two things
only a person knows: **where each one stands, and which way it faces**.

- ⚠️ **The largest traced plate is the tower's footprint** — the same rule `zpBareShape` uses for a
  floor several trades traced, and for the same reason: the slab is at least as big as the biggest
  thing anyone drew on it, and a trade that traced only a core is a subset of that floor, not a rival
  claim about it. A **podium** is therefore the footprint of a tower that has one, which is exactly
  what a site plan wants.
- ⚠️ Across **every** trade, because zoning is per trade and the tower is one building.
- ⚠️ The plate's **outline**, not its zones — explicit `*floor*` areas when any were drawn, otherwise
  the zones together, which ARE the floor's footprint. Mirrors `_vsZpOutlineOf` so the site view and
  the stacking read one shape.
- ⚠️⚠️ **It ADDS, it never replaces.** A planner who has arranged three towers and then traces the
  fourth's floor plan must be able to bring that one in **without losing the arrangement** — so an area
  whose code is already on the site is left exactly where it is, and the button reports what it
  skipped. Replacing would silently undo the arranging this whole feature exists to make the only
  remaining work.
- ⚠️ A tower with no floor plan yet is **named in the toast**, never silently absent, and the button
  says how many it can bring in **before** it is pressed — so a half-traced project is not discovered
  by pressing it and getting two of four.

### ⚠️⚠️ ORIENTING DID NOT EXIST AT ALL, WHICH IS HALF THE OWNER'S ASK
Moving a shape already worked (drag it). There was **no way to turn one** — so a tower that faces the
road at an angle could only be re-traced corner by corner at that angle, which is precisely the work
importing the footprint is meant to remove. A new **Orient** group on the selection:

- `↶90 ↶ ↷ ↷90` — quarter turns and 15°. Both, because a tower is usually square to the site **or**
  set at an angle to a road, and six clicks of 15° to reach a right angle is not a control.
- `− +` — uniform resize, ⚠️ **uniform because the app carries no dimensions**: a tower's outline is
  only its PROPORTIONS, and scaling x and y separately would throw away the one true thing about it.
- ⚠️ **Rotation is about the shape's own centre, never the sheet's.** Turning about the sheet would
  send a tower across the site as well as turning it, so "orient" and "arrange" would stop being two
  independent actions and every rotation would need a compensating drag.
- ⚠️ **Not snapped to the grid.** The snap exists so adjacent zones MEET; a rotated corner lands
  wherever the angle puts it, and snapping it would deform the outline a little more on every click
  until a rectangle was no longer a rectangle.
- ⚠️ **A shape pushed off the sheet is TRANSLATED back, never squashed** — clamping each point
  independently is what turns a rotated rectangle into a trapezoid. One that cannot fit at all is
  **refused with a reason** rather than silently mangled.
- ⚠️ **Not gated to the site plan.** A zone traced at the wrong angle on a floor plan is the same
  problem, and a control that exists on one subject and not the other is one more rule to remember.

### ⚠️⚠️ "A LARGER SCALE" IS A DEFAULT, NOT A MEASUREMENT, AND THE WINDOW SAYS SO
This is the part that could quietly become a lie. **Plan units are square on every sheet** — a sheet is
`ZP_W` across by `h` down in the SAME unit — which is what makes the migration a *copy* rather than a
projection: a footprint's bbox is genuinely its proportions, and the points carry over under **one
uniform scale**. Scaling x and y to "fill the slot" would stretch a tower into a shape nobody drew.

But nothing in this app stores a **dimension**, so nothing here can know that Tower A is really wider
than Tower B — only that each is the shape it was traced as. Every tower therefore arrives at the same
footprint **width**, and the window carries a note saying that in as many words: *"each tower keeps its
own shape, not its size relative to the others… This is an arrangement, never a survey."* Claiming a
relative size would be inventing a survey, and a planner reading sizes off this drawing would be
reading something the app never stated.

⚠️ They are laid out on a coarse grid at **0.62 of a cell**, so two towers side by side arrive with a
street between them rather than touching edges the planner has to pull apart before they can arrange
anything.

### Verified
A gitignored harness (deleted) driving the **shipped** `zpRotatePts` / `zpScalePts` / `zpFitBack` /
`zpTowerPlate` / `zpPlateOutline` / `zpSitePlaceFootprints`, sliced verbatim — **38 assertions**.

| Checked | Result |
|---|---|
| Rotation | a quarter turn swaps w/h, the **centre does not move**, area preserved exactly, four turns return the original, 15° preserves area (not snapped, not deformed) |
| ⚠️ Off-sheet | translated back **and not deformed** (area unchanged, bbox still the rotated one); one that cannot fit is **refused**, not clamped |
| Scaling | both sides halve, **aspect untouched**, area goes as k², centre holds; past the sheet and down to nothing are both refused |
| Footprint | the **podium** wins over the typical floor, across **every** trade; an explicit outline wins over the zones; zones ARE the footprint when no outline was drawn; a tower with no plan reads null |
| ⚠️ The migration | 2:1, 1:3 and square all arrive with their **own aspect intact**; every point on the sheet; separated, not stacked; each inside its slot |
| Missing plans | named, not dropped; nothing invented |
| A multi-piece footprint | both pieces arrive under **one** scale — same size as each other, and the **same distance apart in proportion** |

⚠️ **Not verified signed in, and this is the caveat that matters most here.** The anon key has no
grants, so no real floor plan has been read and no footprint has ever landed on a real site sheet. What
is proven is the geometry — the derivation rule, the proportion preservation, the clamping and the
refusals. What has not been seen is the button pressed on a project with real traced floors. Trace one
tower's floor plan, open **Site plan…**, and the first thing to check is that the footprint that
arrives is the shape you drew.

### The setup detects its own towers, and "apply this plan to other floors" stops crossing buildings (2026-09-12 e) — ethanrobles10

Owner, on yesterday's site plan: *"but the schedule setup should detect, if the project has multiple
towers or not."* Then, separately: *"for the option of for example defining a floor plan, and applying
it to other floors. The other floors detected must be applicable to that tower only. Right now it
displays all other floors of all towers. fix"*

### 1. ⚠️⚠️ `multiTower()` COULD NOT ANSWER THE QUESTION IT IS NAMED FOR
It is `towerList().length > 1`, and `towerList()` falls back to `blankTowers()` — **one invented
"Tower 1"** — on a setup nobody has opened. So an imported four-tower schedule reported *one tower*,
which reads identically to a planner who genuinely has one.

That is not a cosmetic gap, it is the exact state in which yesterday's site plan **silently fails**:
the tower bar offers one chip called `Tower 1`, the planner traces the whole site as `Tower 1`, and the
Vertical Stacking — which knows the schedule's own `Tower A`..`Tower D` — finds nothing. Invisible
until the Site view comes up empty.

`towerReality()` asks **both sources** and returns one verdict:

| | source | on an untouched setup |
|---|---|---|
| `nNamed` | `cfg.towers` **only** — never `blankTowers()` | **0**, not 1 |
| `inSchedule` | the tower values the execution activities carry | 4 |
| `multi` | either says so | **true** |
| `drift` | the schedule knows towers the setup has not named | **true** |

⚠️ `multi` is true when **either** source says so: a planner who has named four towers but not pushed
has a multi-tower project, and so does one whose imported schedule holds four nobody has named.
Taking only the setup's word is the bug; taking only the schedule's breaks the ordinary forward path.

### 2. ⚠️⚠️ THE TWO SIDES DISAGREED ABOUT WHICH LEVEL EVEN IS THE TOWER
Writing the detection surfaced a second, older problem. There were already two rules:

- `sbDimsFromLevels` (setup): the first level is a tower **only on four levels or more**;
- `_vsTowerLevelId` (stacking): a level **named** tower/building/block, else the first.

So on a `Tower › Level › Zone` project — three levels, the first literally called *Tower* — the
stacking has towers and this side had **none**. Detection that disagrees with the thing it is detecting
*for* is worse than no detection, and the site plan's whole value is that the names match.

**So the names come from `_vsTowerOf` verbatim** — the stacking's own function, not a second reading of
the same rows. ⚠️ **But the gate is this side's, and deliberately conservative:** `_vsTowerOf` falls
back to the first location level whatever it is, so on a single-building project whose only level is
*Level* it would report "5th Floor", "6th Floor"… as towers, and this step would announce a
fifteen-tower project and offer a site plan for it. A tower axis is credible when a level is **named**
for one, or when the breakdown is deep enough that the first level cannot be the storey.

### 3. What the tower bar now does
- **The `Site plan…` button is absent on a single-tower project.** A "master site development plan
  showing all towers" on a one-tower job is a drawing of one building, which the floor plans already
  describe — and the stacking's Site view is hidden there for the same reason. An offered control that
  leads nowhere is the looks-live-does-nothing failure this module keeps recording.
- **It counts against EVERY tower the project has**, named here *and* known only to the schedule.
  Counting against `towerList()` alone would report `1/1 traced` on the very project whose site plan
  names nothing the stacking can find.
- **The drift case is reported with the names**, in the warn surface, telling the planner to add them
  with **+ Tower** so the names match. The single-tower line is a plain statement, not a warning — one
  tower is an ordinary project, and it exists only so the missing button is explained rather than
  merely absent.
- **The site plan's brush list is both sources too**, de-duplicated by the same normaliser the plan is
  matched with, with the schedule's own names last (the planner's chosen names are the ones they look
  for first). Otherwise the planner is offered the one invented `Tower 1` and paints the whole site
  with it.

### 4. ⚠️⚠️ THE APPLY LIST WAS SHOWING EVERY TOWER'S FLOORS, AND THE LABELS COLLIDED
On a four-tower job every trade's floor list holds every tower's floors, so *"also use this plan on…"*
offered **forty tick boxes of which thirty were other buildings** — and ticking one silently gave Tower
A's 5th floor Tower D's outline. Worse, **every tower has an `F5`**, so the list read as ten identical
rows with nothing saying which building any of them belonged to.

- Scoped by `towerIdOf`, which is what `floorsOfTower` already uses — one reading of "which tower is
  this floor in", not a second written here.
- ⚠️ **It is the TICK LIST that is scoped, not `zpUsers`.** That one COUNTS what actually shares the
  plate, and a setup from before this fix may genuinely share one across towers. Reporting *"shared by
  6 floors"* when six floors share it stays true; what changes is that you can no longer create that
  state by accident.
- The panel summary and the window header **name the tower** on a multi-tower job, because a list that
  silently shows a subset reads as a bug. The empty state says the scoping is deliberate rather than
  implying this trade has no other floor anywhere.
- ⚠️ **Single-tower projects are unaffected**, asserted: `towerIdOf` defaults every floor to the first
  tower, so they all still share, and the header does not mention a tower at all.

### Verified
A gitignored harness (deleted) driving the **shipped** `sbExecActs` / `sbHasTowerAxis` /
`sbTowersInSchedule` / `towerReality` / `zpSubjFloor` / `locTowerToken`, sliced verbatim.

| Checked | Result |
|---|---|
| An untouched setup | reads single-tower, and `nNamed` is **0** — `blankTowers()` does not count as a finding |
| **The bug**: an imported 4-tower schedule nobody has named | all four read, `multi` **true**, all four reported unnamed, **drift flagged** |
| The forward path (named here, nothing pushed) | multi-tower from the setup alone, **no drift** |
| Names that match | no drift; a partial match names **only** what is missing |
| ⚠️ `Tower › Level › Zone` (3 levels, first named Tower) | **is** a tower axis and both towers are read — the old four-level rule read **none** |
| Four levels, none named | still a tower axis (the depth rule) |
| ⚠️ `Level › Zone` | **not** a tower axis — floors are not towers, and the project reads single-tower |
| ⚠️ The apply list | only Tower A's own floor offered; **Tower B and C's are not** — this was the bug |
| | Tower B sees only Tower B; a tower with one floor offers nothing |
| Single-tower | both floors still share, and the header names no tower |

⚠️ **Not verified signed in.** The anon key has no grants, so nothing has been run against a real
project: no tower has been read off a live schedule, and the drift line has never been seen. What is
proven is the two-source verdict, the axis gate, the name join and the scoping. On the real project the
thing to read first is the line under the tower chips — it says what was detected.

### The master site development plan: one drawing for where the towers stand (2026-09-12 d) — ethanrobles10

Owner: *"if defined the floor plan of each tower, then there should be like a master site
development plan to showcase all towers. and then link that schedule to the vertical stacking.
propose how and where you would define the plan showcasing the site dev plan (showing all towers
orientation and location)."*

### ⚠️⚠️ WHERE IT IS DEFINED: on the TOWER BAR, in Floors & Zones
**Schedule Setup → Floors & Zones → the `Site plan…` button beside the tower chips.**

That bar is the only place in the app that enumerates the project's towers, and the site plan is a
statement *about that list* — where each of those towers stands and which way it faces. Put anywhere
else it would be orphaned from the names it has to use. It is deliberately **not** on a floor row,
which is where a floor plan lives: a floor plan is per trade and per floor; a site plan is one
drawing for the whole project, and filing it beside the towers is what makes that difference visible
instead of something to be explained. The button counts what is traced against the towers that exist
(`Site plan 3/4`), so a project that has grown a fourth tower reads as incomplete without anyone
opening it.

### ⚠️⚠️ HOW IT IS STORED: as one more plate, not a second store
`cfg.zonePlan` already is *"drawings, and what points at them"* — `{ plate: {id: …}, of: {key: id} }`.
The site plan is one more plate, pointed at by a reserved key (`ZP_SITE_ID = 'site'`) exactly as the
un-levelled band is by `'nolev'`, and **every polygon's `code` is a TOWER name instead of a zone
code**. Nothing in the schema, the normaliser, the save path or the garbage collector had to learn
about it, and it inherits the image upload, the presets, undo, copy/paste, the grid, the sheet
proportions and the colour bag for free.

- A separate `cfg.sitePlan` was the obvious alternative and it is the wrong one: a second normaliser,
  a second GC rule, a second set of tracing gestures to keep in step, and two places for "the drawing
  of this project" to live.
- The one thing a site plan genuinely does not share with a floor plan is **the trade** — floor plans
  are per trade (`zpByLabelOf`), a site plan is a fact about the project. That is expressed by the
  key it is filed under, not by a separate store.
- ⚠️ `*site*` is a **protocol key, not a label**, same rule as `ZP_NOLEV_KEY`. Both sides name the
  constant and point at each other.

### ⚠️⚠️ ONE TRACING WINDOW, TWO SUBJECTS — never two windows
The floor plan and the site plan are the same gesture over the same structure: attach a drawing,
trace named areas, name which is which. Copying `openZonePlan` would have duplicated ~900 lines whose
second copy starts drifting on the first bug fixed in only one of them — a failure this module has
already recorded twice. So everything that depends on *what* is being traced is named in a subject
descriptor (`zpSubjFloor` / `zpSubjSite`) and the window reads that instead of `floor` and `tr`:

| | Floor plan | Site plan |
|---|---|---|
| `key` (what `zonePlan.of` files it under) | the floor's id | `'site'` |
| `codes` (the paintable areas) | that floor's zones | the project's towers |
| sharing panel / trace-over | yes | **absent** — there is one site plan |
| outline row | "floor outline" | "site boundary" |

⚠️ `SUBJ.key`, not `floor.id`, is what `commit()` assigns — that one line is what makes the plate a
fact about the project rather than about a floor.

### The link into the Vertical Stacking
A **Site** scope button joins Per trade / Per tower / Consolidated, and draws one card: every tower
at its traced footprint, **as tall as its own storey count**, shaded by its own progress, on the same
as-of scrubber as everything else.

⚠️⚠️ **The site view is a MODEL, not a second renderer.** `_vs3Build` already draws N named cells at
their traced positions on a plate, shades each by its own progress, registers them for the
click-through and outlines them on hover. A site plan is that exact picture with the plate set to the
site drawing and the cells named after towers. A bespoke site renderer would have needed its own
camera, tones, picking, compare edges and as-of handling — every one of them a chance to disagree
with the tower views about the same project. `_vsSiteModel` is `_vsTowerModel`-shaped and carries the
three hooks a site actually differs by:

- `plateFor` — the site plan instead of a floor's (`_vs3Build` now asks the model, falling back to
  the floor lookup, so the override is one line at each of two call sites);
- `cellH` — **the one structural addition**. On a floor every cell is a zone of the same storey, so
  they are all one storey tall. On the site the cells are towers, and a 14-storey tower drawn the
  same height as a 40-storey one says something false about the project. `cellH` is a *multiplier*,
  so `SH` stays the single unit of height; it is 1 everywhere else, where the maths is the identity.
- `rowCells` — the towers, in the module's own tower order, in the module's own tower colours
  (`_vsTowerColor`, which already existed — a duplicate I wrote was caught and removed).

⚠️ Storey counts come from the **schedule**, not from the setup's floor list: the site view stands
beside the tower views and those are drawn from the schedule too. A tower whose setup says forty
floors but whose schedule carries eight would otherwise be drawn forty tall and eight tall in two
views of one project.

⚠️ **The button is absent when there is no site plan**, not disabled-looking-live: a Site view with
nothing traced is every tower at the same place on a guessed grid, which is a picture that lies about
where the buildings stand. Same for a single-tower project — the site *is* the tower there.

⚠️ **3D only, and it says so.** The 2D card is a SECTION; two towers north and south of each other
occupy the same place in an elevation. That is the same reason the 2D card has never drawn a floor
plan.

⚠️ The footer names the one thing a reader cannot see: **a tower the plan does not name keeps its
slot on the wrap grid**, so it is on the site, in the wrong place, looking exactly like one that was
traced. That is the most misleading thing this view can do, so `_vsSiteFit` counts it and the footer
prints it.

### Verified
Two node harnesses (gitignored, deleted) driving the **shipped** code sliced verbatim — the builder
chain (`zpNormAll` → `zpSiteOf` → `zpShapeOfBag`) and the stacking chain (`_vsSitePolysOf` /
`_vsSiteBoundary` / `_vsSiteFit`), plus the `zoneMesh` geometry.

| Checked | Result |
|---|---|
| Storage | a site plan round-trips as a plate; points normalised 0..1; the sheet's aspect travels with it; a colour resolves for every area; tower names survive verbatim |
| "No plan" | no `zonePlan`, an empty plate, a bag with no site pointer and a null config all return **null** — one answer, not four |
| ⚠️ Normalise + GC | the site plate **survives** (it is pointed at) alongside a floor plate, and an orphan plate is **still collected** — the reserved key does not defeat the GC |
| The name join | case and spacing normalised away; an untraced tower returns null; **the site boundary is never returned as a tower** |
| The fit verdict | 2 of 3 placed, the unplaced one named, the boundary not counted as a traced area, "nothing matches" distinct from "no plan" |
| A tall sheet | proportions preserved rather than squared |
| `cellH = 1` | **identity** — floor cards and Consolidated bands land at exactly the pre-change heights |
| `cellH < 1` | a 14-storey tower is 0.35 of a 40-storey one, **both standing on the ground**, progress filling upward inside each tower |

⚠️ **Not verified signed in, and this is the big one.** The anon key has no grants, so nothing here
has been run against a real project: the tracing window has not been opened on the site subject, no
site plan has been saved or read back, and the 3D site card has never been rendered. What is proven
is the storage contract, the name join, the fit arithmetic and the geometry — the wiring between them
is argued, not measured. Open **Floors & Zones → Site plan…**, trace one area per tower, **save**,
then check the Vertical Stacking's Site button appears; the footer under the model is the thing to
read first.

⚠️ Also unverified: the icon. `data-ico="map"` does not exist in the shared set (it would have
rendered nothing) — caught before shipping and changed to `compass`, which does.

### The geometry audit, and the suite stops living in a temp folder (2026-09-12) — fmlozano

Overnight audit, agenda item 5 — the geometry half of the UI audit: hunting the `zh` defect class
(a row height derived in one place while bars are positioned from another) in Progress, Vertical
Stacking, Network and the rest. **No shipped file changed.**

### ⚠️⚠️ THE CLASS CANNOT RECUR IN MOST OF THIS FILE, AND THE REASON IS STRUCTURAL
Not *"I looked and it seemed fine"*. Every site that positions something at `index × height` was
enumerated and classified:

| where | why it is safe |
|---|---|
| the Gantt (8 sites) | all read the **one** `ROWH`; `zh` closed the derivation gap |
| **Progress** | bars are `.ps-prog-track` inside a `<td>` — **in flow**, so a bar cannot leave its row |
| 4 SVG chart renderers | one local `rowH` per function feeds **both** the label `<text>` and the bar |
| WBS Manager | `WBS_ROWH = 34` vs `.ps-wbs-row { height:34px; box-sizing:border-box }`, no gap on the container |
| `--c-plus` | the CSS reads `var(--c-plus)` itself, so it cannot drift from the value it mirrors |
| Vertical Stacking 3D | labels are **projected from the scene per frame**, not a fixed-constant pair |

The LSM lanes are the one genuinely composed case: the budget (`_lsmRowH`) and the placement
(`_lsmBarsHTML`) are **two expressions over the same four constants**. Lane *i* lands at
`top + 4 + 11i`, the bar is 6px and the rail ends 9px in, so the last element bottoms at
`top + 11n + 2` against a row of `top + 11n + 8` — **6px of slack**.

### The suite proved the parts and never the whole
It already asserted a lane's internals (`bar 6 + 1 air + rail 2 == LSM_LANE_H`, read out of the
**shipped CSS**) and that lane bands do not overlap each other. Neither asks the question the
owner's screenshot asked: **does the last lane still land inside the row?** That is the `zh` symptom
verbatim — *ROWH 31 where the lanes needed 74, 20 of 58 bars outside their own row*.
**43 new assertions** answer it for every lane count `1..LSM_LANE_MAX`, and **both sides are
executed**: the budget by calling `_lsmRowH()`, the placement by parsing `_lsmBarsHTML()`'s real
output, the heights out of the real CSS.

### ⚠️⚠️ THE FIRST CUT OF THOSE ASSERTIONS WAS WORTHLESS, FOR THE FOURTH TIME IN THIS SUITE
It recomputed the budget **from the constants** instead of calling `_lsmRowH()` — so a negative
build that broke `_lsmRowH` outright left it **green**. Asserting on a copy of the thing under test
is the trap this file has now recorded four times (the `setGroupBys` guard, the `_declaredParallel`
substring, the hand-written `tr` fixture, and this). Rewritten to execute, it **bites**:

| negative build | result |
|---|---|
| `_lsmRowH` drops the lane GAP from its budget | **14 fail** — *"5 lane(s) lowest bottom 54px of the 53px granted"*, rising to 87 of 80 at 8 lanes |
| the placement drifts 12px down | **14 fail**, at every lane count |
| the CSS bar grows 6px → 14px | **1 fail**, caught by the existing composition assertion |
| the placement drifts **4px** down | **passes, correctly** — see below |

⚠️ **The sensitivity is stated rather than overclaimed:** the check catches a budget error and a
placement drift **beyond the row's 6px slack**. A drift *within* the slack is a misalignment, not a
spill, and this assertion is blind to it by design — that is the flowline's 2px-label shape, which
has its own maxDrift-0 check.

### ⚠️⚠️ AND THE SUITE ITSELF WAS THE LARGEST RISK IN THE ROOM
**660 assertions covering the whole LSM feature existed only in a session TEMP directory.** Not
gitignored — checked, there is no rule for it — just never committed, so every future session
would rebuild it from nothing while the loop's own rules require proving each change with it.
It is now **`modules/project-schedule/test-lsm.js`**, which is the convention this repo already
follows for `progress-photos/test.js`, `risk-register/test-rcm.js` and
`stakeholder-map/test-directory.js`: Node-only, `require('fs')` and nothing else, loaded by **no**
page — so nothing a planner sees changes and no `MODULE_V` bump is owed.
⚠️ Its header now carries the **pinned base SHA** and the exact two commands, because the pin has
already been overwritten once mid-feature and three assertions quietly became self-comparison.

**660 assertions on the working tree, 27 against the pinned base `4d82fd4`, 0 failing.** The base is
missing **35 functions and 17 constants**, which the run prints — so a base that has stopped being
a contrast says so out loud.

### The last four font-weight 600 in the app (2026-09-12) — fmlozano

Overnight audit, agenda item 3 — the UI audit. Two values this repo has previously driven to
zero were re-counted. `--pd-ok` / `--pd-warn` / `--pd-bad` used as a TEXT colour: **0**, so that fix
held. `font-weight: 600`: **four declarations, all in this file**, all `.ps-vs3-*`.

⚠️⚠️ **These are exactly the four the 2026-09-10 (ug) entry deferred**, with the reason stated
there: *"That file holds another session's uncommitted flowline work and is deliberately untouched;
they land when it does."* It landed. There is no Gotham Semibold (Brandbook 2026 p.29 names Thin /
Regular / Medium / Bold / Black), so a 600 addresses a cut of the primary face that does not exist.

### Each one decided against a decision the app has ALREADY made, not against taste
The (v4) rule is 600 → 700, **except** where that flattens a 600/700 pair — the inversion
that sweep caught itself creating in ten places.

| | was | now | why |
|---|---|---|---|
| `.ps-vs3-more > summary` | 600 | **500** | it is styled as a button, and `.pd-btn` is **500**. Convergence, not a choice. |
| `.ps-vs3-foot .lead b` | 600 | **700** | emphasis inside a parent that declares no weight |
| `.ps-vs3-help p b` | 600 | **700** | same |
| `.ps-vs3-lab.nolev` | 600 | **500** | ⚠️⚠️ base `.ps-vs3-lab` is **700**. Folding this up would make the two states **identical** — an ordinary storey label is bold, the band that is not a storey is lighter, italic and muted. At 500 the distinction is WIDER than it was at 600, and both ends are now real Gotham cuts. |

### ⚠️ Measured in a browser, not eyeballed — and a colour, not only a weight
A render harness at the repo root (gitignored, and **deleted afterwards**) inlined `dashboard.css`
plus this file's own `<style>` blocks and reported:

```
summary 500 | footLeadB 700 | helpPB 700 | labBase 700 | labNolev 500
hierarchyPreserved: true | nolevItalic: "italic"
```

Then the dark-mode remap, which is where a colour whose only definition sits in a light-mode block
shows up:

```
coloursThatDidNotRemap: []   weightsUnchangedByTheme: true
light  labBase rgb(35,31,32)    labNolev rgb(90,88,88)     bg rgb(255,255,255)
dark   labBase rgb(240,239,239) labNolev rgb(185,183,183)  bg rgb(43,44,43)
```

And the contrast ratios, since a weight change that quietly lands on an unreadable pair is not a fix:

| | light | dark |
|---|---|---|
| `.ps-vs3-lab` | **16.30** | **12.22** |
| `.ps-vs3-lab.nolev` | **7.07** | **7.02** |
| `.ps-vs3-more > summary` | **16.30** | **12.22** |

**Lowest reading 7.02 — all six clear AA (4.5) and AAA (7.0).**

### Verified
`node --check` PARSE OK on the inline block; **0 functions lost, 0 added**; **0 `font-weight: 600`
declarations anywhere in the app** — every remaining grep hit is prose (the `dashboard.css`
comment stating the rule, two code comments, four changelog lines). `MODULE_V` → `20260912b`,
sort-checked against `20260912a`.
⚠️ **Not verified signed in** — the Chrome bridge has been down since the `zh` fix; these are
real browser measurements against the shipped stylesheets, not a loaded project.

### Audit sweep: the cold-open class, and a harness that could hide it (2026-09-12) — fmlozano

Overnight audit, agenda item 2 — hunting the defect CLASS behind tonight's two biggest finds.
**No shipped file changed.**

### ⚠️⚠️ THE CHECKER IS HARDENED, BECAUSE IT WAS HIDING EXACTLY THIS
The suite's EXPORTS block used `typeof X === 'function' ? X : function () {}` for two cache
clearers. `_clearLsmDeclCat` is called only by `psSetupChanged`, which no probe runs, so the link
pass never pulled it in — and `M.clearDeclCat()` was a **no-op**. The warmed catalogue leaked
between scenarios and a fixture reported `null` for a storey it had just declared.

Both fallbacks now go through `_mustFn(name, fn)`, which returns the real function or one that
**throws, naming what was never linked**. Self-tested: un-linking `_clearLsmDeclCat` now produces
`HARNESS: _clearLsmDeclCat was never linked, so this call would have been a silent no-op` where it
previously passed 617 assertions clean.
⚠️ A no-op fallback in a harness is a stub wearing a different hat.

### The cold-open sweep — every cross-closure read, checked
| Export | reads `cfg` | cold-open reader | verdict |
|---|---|---|---|
| `locCatalogue` | yes | `locCatalogueFor` | closed |
| `zonePlanByLabel` / `zonePlanFront` | yes | `zonePlanFetch` | closed |
| `tradeHandoff` | yes | `tradeHandoffFor` | closed (tonight) |
| `tradeLabels` | no — constants | n/a | safe |
| `invalidateLocCache` | no | n/a | safe |
| **`setupGroupDims`** | yes | **none** | **documented + guarded, see below** |
| **`setupOrderLabels`** | yes | none | **dead end, see below** |

### ⚠️ `setupGroupDims` is NOT a silent failure, and that is the finding
It has no `...For(pid)` reader, so on a cold open the grid's default grouping does not follow the
setup's structure. But this is **already known to the code**: `_adoptSetupGrouping()` exists for it,
carries three guards (planner has not chosen, dims differ, grouping is still the plain `wbs` tree),
and the comment states the fallback outright — *"Until then the plain WBS tree stands, which is
the same behaviour as before."*

It could now be closed properly, because `locCatalogueFor` already proves a cfg-free read of the
same row is possible. **Deliberately not done autonomously:** it would re-group the grid a moment
after first paint, and whether that is better than a stable-but-plain default is the owner's call,
not a defect to be fixed overnight.

### ⚠️⚠️ `setupOrderLabels` IS A DEAD END
Exported by `ScheduleBuilder`, **zero callers anywhere in the repo**. It returns the setup's
structure as labels (`cfg.wbsOrder.map(dimLabelOf)`) — the makings of a "your setup says
Tower → Trade → Level" hint in the Group menu, which is the one place that would want it.
Left in place rather than removed: other sessions edit this repo live and may be mid-flight on it.
Fifth instance of the declared-but-unwired shape here, after `openLocAdopt`, `fillDown`'s
change-order branch, `cfg.floorLag` and `cfg.tradeLeads` — the last of which was wired yesterday.

### Verified
**617 assertions against the working tree, 27 against the pinned base, 0 failing. 30 negative
builds, all bite.** `wiring-check` 123/123 (3,527 cross-module references across 74 files),
`dead-hooks` identical to the pinned base, `scan` self-test clean.
⚠️ `tools/dead-hooks.js` finds dead CSS classes but not dead cross-closure EXPORTS, which is how
`setupOrderLabels` survived. Extending it is the obvious next tooling job.

### ONE SCALE for the storey axis — and a live bug it removes (2026-09-12 a) — fmlozano

Overnight audit, agenda item 1. It turned out to be bigger than "make the declared order
trustworthy": the declared order was **being used as the axis today, and it is wrong**.

### ⚠️⚠️ THE BUG THAT WAS LIVE
`_lsmRankOf` read: *if the setup declares more than one floor, the declared order IS the axis;
otherwise use `levelRank`.* All or nothing. And `catalogueFrom` concatenates the **per-trade** floor
lists, so on OPW101 the "declared axis" reads

    F1, B3, B2, B1, Ground Floor, 2ND…

— `F1` belongs to a trade listed before the one carrying the basements, so **the first floor sat
below the third basement**. Any planner who opened the Schedule Setup tab and then went to the LSM
got that axis; anyone who did not got the correct one. Measured, not deduced: `levelRank` reads
every one of those names right (`F1` → 1, `B3` → -3, `Ground Floor` → 0).

### The fix: one scale, and the declaration only PLACES
`levelRank` is now the axis, always. The Schedule Setup is consulted **only** where the heuristic
answers `null` — "Podium 2", "Amenity Deck", names no regex will cover — and such a storey is
placed **between its declared neighbours**, interpolated onto the same scale.

- ⚠️⚠️ **Within the trade's own list, never the concatenation.** The per-trade list is the only
  ordered thing in the setup ("floors bottom-up PER TRADE"), so catalogue entries now carry `tr`,
  the trade whose list they came from.
- ⚠️ **Nothing the heuristic already ranks can move.** That property is what makes this safe to
  turn on for every project at once, and it is asserted directly.
- ⚠️ **No interpolated value may land on a real rank**, or two storeys collapse to one ordinal.
- ⚠️ A storey with **no rankable neighbour either side** stays off the axis: the declaration says
  nothing about where it sits either, and the flowline's footnote is the honest answer.
- The basis is now `heuristic` or **`assisted`**, and the Rate strip says *"N of them placed from
  your Schedule Setup floor list because no floor name rule covers them."*

### What it gains
The demo project's **"Podium 2"** used to drop off the axis entirely — out of the rate fit and
out of the flowline. It is now placed between Ground Floor and the 3rd, and **all 19 storeys** are
on the chart. That assertion in the suite now says the OPPOSITE of what it said yesterday, which is
the honest record of a contract that changed.

### ⚠️⚠️ THREE FAULTS IN THE CHECKER, ALL FOUND BY NEGATIVE BUILDS
1. **The harness was silently STUBBING a real function.** `_clearLsmDeclCat` is called only by
   `psSetupChanged`, which no probe runs, so the link pass never pulled it in — and the EXPORTS
   line falls back to `function () {}` when a name is missing. `M.clearDeclCat()` did **nothing**,
   the warmed catalogue leaked between scenarios, and a fixture reported `null` for a storey it had
   just declared. **A no-op fallback in a harness is the same fault as a stub.**
2. **A fixture that could not discriminate.** With the unrankable storey sitting between its right
   neighbours, per-trade and cross-trade interpolation give the same answer, so two negative builds
   passed. The discriminating shape puts it at the END of its trade's list, where the next entry in
   the concatenation is a different building level.
3. **A fixture that bypassed the code under test.** The catalogue fixtures hand-write `tr`, so
   dropping the tag from `catalogueFrom` changed nothing. `catalogueFrom` is now **sliced and run**.

### Verified
**617 assertions against the working tree, 27 against the pinned base, 0 failing. 30 negative
builds, all bite** — including the declared order restored as the axis (**9** fail), placement
removed (**11**), the collision guard removed, interpolation across the concatenation, and the trade
tag dropped.
`node --check` PARSE OK, 0 functions lost, 81 insertions / 20 deletions.
`MODULE_V` → `20260912a`, sort-checked against `20260911zj`.

⚠️ **Not verified signed in** — the Chrome bridge is still down. The OPW101 axis fix is the
one thing here I would most want to see on the real project.

### A demo project, end to end through the whole LSM chain (2026-09-12) — fmlozano

Owner: *"Let's test it on a demo project"*. The Chrome bridge was still down, so the demo is built
**offline in the shape the Schedule Setup pushes one** and dated **the way `autoTrace` links one**
— each following trade trailing the leading one by that category's declared levels, counted
within the category and clamped to its top. Nothing was written to any real project.

**19 storeys** (4 basements, 2 podium, 12 typical, 1 roof), **5 trades**, the same declared handoff
shape One Portwood uses.

### What the chain did
- **Floors matched:** all **19** storeys resolved to the Setup's floor list and carried their
  category (`B4` basement, `Podium 2` podium, `Roof Deck` roof).
- **Trades matched:** `seq.basis` **declared**, five lanes, General Requirements first, MEPF last.
- ⚠️⚠️ **ZERO handoff findings**, which is the correct answer for a schedule dated to the
  generator's own links — and `nUnkinded` **0**, so nothing went unchecked.
- ⚠️⚠️ **The converse holds:** dragging ONE storey three weeks early is caught, and the finding
  names the trade that moved (`MEPF Works`) and the category whose rule it broke (`typical`).
- The strip stops saying either of the two sentences that were false on OPW101.

### ⚠️⚠️ A REAL COST OF THE zj DECISION, NOW MEASURED
Because `zj` deliberately does **not** take the floor ORDER from the cold-open catalogue, the axis
is still `levelRank`'s heuristic — and the heuristic cannot rank every name a planner uses. On
this demo it drops exactly one storey: **"Podium 2"**. The declared order *would* have placed it.

So the deferred work now has evidence behind it: **making the declared order trustworthy is worth
doing**, and the way to do it is to take the spine from the trade whose floor list actually covers
the building rather than from whichever trade is first in `GROUPS`. Recorded, not taken, because it
changes the axis on every project and deserves its own verification.

### ⚠️ And another branch the link pass could not see
`_lsmKindWord` / `LSM_KIND_LABEL` are reached **only when a lead finding actually RENDERS**, which
the probe never does. The demo scenario is what surfaced them. Same family as the three "reaching a
branch is not reaching every line in it" notes above.

**594 assertions against the working tree, 27 against the pinned base, 0 failing.** No shipped file
changed in this round.

### Where the One Portwood clashes come from: the closed loop holds (2026-09-12) — fmlozano

Owner: *"let's test end-to-end the clash detection as well. The schedule in One Portwood is
developed from the Schedule Setup, let's see how the clashes originated so that we can test if
there are errors in the sequence/process in schedule setup."* **No code changed** — this entry
records the verification and its answer.

### ⚠️⚠️ THE DETECTOR AND THE GENERATOR AIM AT THE SAME FLOOR
`autoTrace` chooses the predecessor it links to with

    si = pk[Math.min(ord + L - 1, pk.length - 1)]

and the clash detector measures against

    var tr = pk[Math.min(ordK + L - 1, pk.length - 1)];

Both expressions are **lifted out of the shipped source and RUN** over every
(floors-in-category 1—30 × lead 1—8 × ordinal) combination — **3,720 cases,
0 differ**, including the ones that hit the clamp at the top of a category.

Then the property that follows from it, demonstrated rather than argued: a schedule built to the
generator's own links raises **zero** handoff findings across **918 storey-pairs** — and a single
storey dragged three days earlier **is** caught, so it is not a test that cannot fail.

### What that means for One Portwood
**The Schedule Setup's sequencing process is not what produced those clashes.** A schedule the
setup generates is handoff-clash-free by construction. So a handoff finding on OPW101 says the
**dates have drifted from the declaration since the push** — hand edits, a re-schedule, or
calendar moves — not that the setup answered wrongly.
⚠️ The same-storey overlaps are a different matter: they rest on trade ORDER, not on the
handoff, and `autoTrace` does not prevent two trades sharing a storey. Those are real reports.

### The declared configuration, read off the live app
| Leading trade | whole-trade | basement | podium | typical | roof |
|---|---|---|---|---|---|
| General Requirements | **start together** | — | — | start together | — |
| Site Works | — | 1 | 1 | 1 | 1 |
| Structural Works | — | 4 | 4 | 4 | 4 |
| Architectural Works | — | 1 | 1 | 1 | 1 |
| MEPF Works | nothing declared | | | | |

### End to end on that configuration
The whole cold-open path now runs in the suite against **One Portwood's real 18 floors, their real
categories and this real handoff table**, through the shipped `.then(…)` wiring: the first read
is empty (and asserted to be — that is what triggers the fetch), the second carries all **18**
categories, the order is asserted **not** to have been taken, the handoff arrives, and the exact
finding that was wrong on screen — *"F1 Site Works before General Requirements"* — is
suppressed.

### Verified
**572 assertions against the working tree, 27 against the pinned base, 0 failing. 25 negative
builds, all 25 bite.**
⚠️ Deployment confirmed by fetching the live file: `zh`, `zi` and `zj` are all served.
⚠️⚠️ **Third occurrence of "a negative build must report, not explode":** the negative that
rewrites the detector's target line left the new comparison with nothing to run, and it **crashed**
on `A[-1].f` instead of failing. Guarded.
⚠️ **Still not re-measured signed in:** the Chrome bridge dropped after the `zh` row-height fix
was verified live and did not come back, so the OPW101 numbers under `zj`'s per-category arithmetic
are not yet read off the real project.

### A correction to zi: the warmed catalogue supplies the CATEGORY, not the ORDER (2026-09-12 zj) — fmlozano

⚠️⚠️ **A REGRESSION I ALMOST SHIPPED IN THE FIX ONE ENTRY ABOVE, caught by reading my own diff
against the live data I had just measured.** Recorded in full because the near-miss is the lesson.

`zi` made `_lsmDecl` read the cold-open catalogue for everything — including the **declared floor
order**. But `catalogueFrom`'s own contract is *"floors bottom-up **per trade**"*, and `_lsmDecl`
treats **first-seen across trades** as the building order. Measured on OPW101, the catalogue reads:

    F1, B3, B2, B1, Ground Floor, 2ND Floor, 3RD Floor, …

`F1` belongs to a trade listed before the one carrying the basements, so it lands **below B3**. That
order was unreachable on a cold open before `zi`, so the fault was latent; `zi` would have activated
it on **every project at once** and silently reordered charts that are correct today.

**Narrowed.** The warm now supplies the **category** — which is what the per-category handoff
needs and which has no ordering question — while the **order** keeps exactly the source it had.
Two separate reads inside `_lsmDecl`, and the warm no longer drops the rate memo, because the axis
does not move.

⚠️ **Making the declared order trustworthy is its own change and its own decision**, and it is
NOT taken here. It would want the spine to come from the trade whose floor list actually covers the
building, rather than from whichever trade happens to be first in `GROUPS`.

### Verified
**542 assertions against the working tree, 27 against the pinned base, 0 failing.**
⚠️⚠️ **25 negative builds, all 25 bite** — including two written specifically to guard this
decision: taking the order from the warmed catalogue fails, and letting the warm drop the rate memo
fails.
`node --check` PARSE OK, 0 functions lost. `MODULE_V` → `20260911zj`.

⚠️ **Still not re-measured live**: the Chrome bridge dropped part-way through the end-to-end
session, after the `zh` row-height fix was verified signed-in but before `zi`/`zj` were deployed.

### The declaration was never READ on a cold open (2026-09-11 zi) — fmlozano

Owner: *"let's test the LSM end-to-end... let's see how the clashes originated"*. Driving the
**live, signed-in** app on **OPW101 — One Portwood Residences** (2,561 activities) found two
defects, and the first one disabled most of the last three days' work.

### 1. ⚠️⚠️ TWO SENTENCES ON SCREEN WERE BOTH FALSE
The clash strip said *"17 storeys are not in your Schedule Setup's floor list"* and *"No
cross-trade handoff is declared in this project's Schedule Setup"*. Measured:

| | |
|---|---|
| `ScheduleBuilder.locCatalogue()` (what `_lsmDecl` reads) | **0 floors** |
| `locCatalogueFor(pid)` (the cold-open reader) | **18 floors, each with its category** |
| Level values on the activities matching the setup's floor list | **18 of 18, exactly** |
| trades carrying a declared handoff | **4** |

**The naming was never the problem; the read was.** `cfg` is only populated once the Schedule Setup
TAB has been opened, and nobody opens it on the way to a chart — so on every cold open the
declared floor ORDER fell back to the `levelRank` heuristic AND every storey came back with no
category, which means the per-category handoff **could never fire**. I wired `tradeHandoffFor`'s
cold open and left its prerequisite without one.

Fixed with the same pattern: `_lsmDeclWarm()`, once per project, not awaited, invalidating **both**
the rate (the axis moves) and the clashes. ⚠️ The warmed catalogue lives in `_lsmDeclCat`, **not**
in `_lsmDeclMemo`, which `_clearLsmRateMemo` wipes every frame — the `_lsmLeadMemo` lesson.

⚠️⚠️ **The suite caught this as a REGRESSION IN MY OWN FIX, and how it did is the point.**
`_lsmDecl` wraps its whole body in `try/catch`, so the unlinked `_lsmDeclCat` did not fail the link
pass — it degraded **silently** to the heuristic basis, and four assertions failed with
`"heuristic"` and no other clue. **Third appearance of that trap.**

### 2. ⚠️⚠️ "START TOGETHER" WAS BEING CONTRADICTED ON SCREEN
One Portwood's declared sequence, read off the live setup:

| Leading trade | whole-trade | basement | podium | typical | roof |
|---|---|---|---|---|---|
| General Requirements | **start together** | — | — | start together | — |
| Site Works | — | 1 | 1 | 1 | 1 |
| Structural Works | — | 4 | 4 | 4 | 4 |
| Architectural Works | — | 1 | 1 | 1 | 1 |
| MEPF Works | nothing declared | | | | |

The planner marked **General Requirements parallel**, and the strip still reported
*"F1 — Site Works before General Requirements, 25 wd"*. The same-storey overlap class knew
nothing about `tradeParallel`. **A chart contradicting an answer given two screens away is worse
than not checking at all.**
⚠️ Suppressed now — but **only for the trade that actually follows**, exactly as the handoff
does, so a parallel answer cannot excuse an overlap between trades three apart; and per category,
so "start together on the basements" does not excuse a typical floor.

### Verified
**539 assertions against the working tree, 27 against the pinned base, 0 failing.**
⚠️⚠️ **23 negative builds, each reverting one decision, all 23 bite.**
⚠️ One of them **passed at first**: the assertion matched `_declaredParallel(...)` anywhere on
the line, so `if (false && _declaredParallel(...))` satisfied it. **Third time a substring assertion
has been satisfied by dead code here** — it now requires the call to BE the condition.
`node --check` PARSE OK, 0 functions lost, 61 insertions / 3 deletions.
`MODULE_V` → `20260911zi`.

### A restored LSM mode came back at the PLAIN row height (2026-09-11 zh) — fmlozano

Owner, with a screenshot: *"the width of the rows is too big that the gantt bars in the WBS do not
align properly with the WBS row in the grid itself. Is this intended?"* ⚠️⚠️ **No.** The height is
intended; the fact that it never arrives is not. First defect found by driving the LIVE, SIGNED-IN
app rather than a harness.

### Measured on OPW101, signed in, on a cold load
`ps_lsmrows` = `1`, the grouping location-led, **58 LSM bars drawn** — and:

| | |
|---|---|
| `ROWH` | **31** (the plain height) |
| what the lanes need | **74** |
| bars sitting outside their own row | **20 of 58** |
| toolbar button lit | **no** |

Calling `applyRowZoom(false)` by hand corrected it to 74 with **0 spills** and perfect grid/Gantt
row tops (0, 74, 148, 222, 296), which is what proved the geometry was never wrong — only stale.

### Why
`applyRowZoom` is called **once** by init, and at that moment no project has loaded: `groupBys` is
empty so `_lsmShaped()` is false, and there are no rows for `catList()` to find lanes in. So the
height is computed for a mode that is on and a chart that does not exist yet — and **nothing
re-derives it** once the rows and the grouping arrive. Every other path that changes the height
(density, zoom, the toggle) calls `applyRowZoom` itself; **restoring the flag from localStorage
calls nothing**, because no toggle ever ran.

### The fix
Re-derived at **`doRender`**, the one choke point every grid+Gantt build funnels through, one line
after `DL = displayList()` so the grouping and the rows are both settled:

    if (typeof rowHFor === 'function' && rowHFor(_rowZoom) !== ROWH) applyRowZoom(false);
    _lsmPaintBtn();

⚠️ **Guarded**, so a frame that changes nothing does not touch the CSS variables; `catList` is
memoised on a cheap key, so the test itself is nearly free.
⚠️ **And the toolbar now says the mode is on.** A restored `_lsmRows` lit nothing, so the chart
was in LSM while the button that turns it off looked idle. `_lsmPaintBtn` is now the **one writer**
for that class and `_lsmFinish` keeps no inline copy.

### Verified
**518 assertions against the working tree, 27 against the pinned base, 0 failing.** The guard is
**cut out of `doRender` and executed**: a stale 31→74 calls `applyRowZoom` once, an unchanged
74→74 calls it zero times. **Three negative builds bite** — guard removed (**5** fail),
guard made unconditional (**5**), button paint dropped (**1**).
`node --check` PARSE OK, 0 functions lost, 25 insertions / 2 deletions.
`MODULE_V` → `20260911zh`.

⚠️ **What is still by design:** the row really is `pad + lanes × pitch`, so eight keyed
trades really do make a ~96px row. The lever is **"Key trades…"**, and `_lsmFinish` already says
so in its toast. What this fixes is the row not being that height in the first place.

### The handoff becomes PER FLOOR CATEGORY (2026-09-11 zg) — fmlozano

Owner: *"Wire the per-floor-kind handoff next"* — the limitation named at the end of the previous
entry, where only `tradeBatchKind`'s **typical** value was applied.

### 1. ⚠️⚠️ NO SECOND MATCHER WAS ADDED, AND THAT WAS THE WHOLE QUESTION
Matching an LSM storey to a Schedule Setup floor is the hard part, and this module already has two
places that do it (the WBS match table and `_lsmDecl`'s rank basis). A third would be a third thing
that can disagree about which floor *"5th Floor"* is.

It turned out not to be needed: **`catalogueFrom` has always put `kind: floorKind(f)` on every floor
entry**, and `_lsmDecl` already resolves a storey's words to one of those entries. So the category
costs **one line** in a loop that was already running. The base contrast asserts both halves of
that: the base already carries `kind: floorKind(f)`, and has nothing on the Gantt side reading it.

### 2. ⚠️⚠️ THE ARITHMETIC CHANGED, NOT JUST THE NUMBER
`autoTrace` counts the lead **within the category**: `ord` is the following trade's ordinal among
**its own floors of that category**, and it indexes into the leading trade's floors of that same
category — so a basement is never counted among the typical floors. Yesterday's pass counted across
the whole building, which was wrong the moment two categories existed.

⚠️⚠️ **And it CLAMPS to the top of the category** — `si = pk[Math.min(ord + L - 1, pk.length - 1)]`.
Yesterday's pass **skipped** the top L-1 storeys, on the reasoning that the leading trade "runs out
of floors to be ahead on". That was a second reading of the planner's declaration, and the schedule
`autoTrace` actually generates uses the first: B's top floor really does wait for A's top floor of
that category. **Corrected to follow `autoTrace` exactly**, because the generator is the definition
of what the answer means — the `_vsTowerModel` rule, and the previous version under-reported.

### 3. ⚠️⚠️ "START TOGETHER" IS AN ANSWER, AND IT SUPPRESSES THE FINDING
The setup's handoff question is a **checkbox and a number** per category: *start together*, else
*N level(s) behind*. `autoTrace` draws **no** trailing link for a category marked parallel, and none
at all for a leading trade marked parallel outright. Reporting a handoff the planner explicitly said
does not exist is the same fault as inventing one — so `cfg.tradeParallelKind` / `cfg.tradeParallel`
are read, through a `parallelKindOf` split out of `parallelKind` exactly as `declaredBatchOf` was
split out of `batchKind`. **Both splits are proved behaviour-identical by execution**, over all 80
(cfg, trade, category) combinations: 0 differ.

### 4. ⚠️ THE KINDLESS ANSWERS STAY WHERE THEY WERE
`cfg.tradeBatch` and the legacy `cfg.tradeLeads` predate floor categories, and `batchKind` has always
folded them into **typical** alone (every other category defaults to 1). Lifting them across all four
would silently rewrite what those projects declared, so they are applied to typical and nowhere else
— in `declaredBatchOf` and again in the pass, both asserted, and both with a negative build.

### 5. ⚠️⚠️ A STOREY WITH NO DECLARED CATEGORY IS NOT CHECKED, AND IS COUNTED
A storey in the schedule but not in the setup's floor list has no category, so no rule applies.
Guessing *typical* would measure a basement against the tower's number; silence would let
*"0 handoff findings"* read as *"nothing is early"* when part of the building was never examined.
So the strip says: *"2 storeys are not in your Schedule Setup's floor list, so no floor category
applies to them and the handoff was not checked there."* Same principle as the flowline's footnote
for unrankable locations.

### 6. What the planner sees
The chip now names the category and uses the setup's own words —
*"Architectural Works **1 basement level behind** Structural Works"* beside
*"Architectural Works **3 typical levels behind** Structural Works"*, the **same pair** on the same
chart, reading differently because the planner answered them differently. The tooltip adds
*"Counted among the basement floors only, the way the setup traces it."*

### Verified
**507 assertions against the working tree, 27 against the pinned base `4d82fd4`, 0 failing.**

⚠️⚠️ **Fifteen negative builds, each reverting ONE decision, and every one bites:**
pass unreachable (**14** fail), `floorLead` as evidence (**6**), `batchKind` drifted (**1**),
`parallelKind` drifted (**1**), lead applied to any pair (**1**), the leading trade marked (**1**),
one spelling only (**3**), legacy pair ignored (**3**), **counted across the building** (**8**),
**typical's number for every category** (**4**), **"start together" ignored** (**2**),
**whole-trade parallel ignored** (**2**), **unknown category guessed as typical** (**3**),
**kindless pair crossing categories** (**2**), **kindless batch lifted to every category** (**3**).

⚠️⚠️ **Two faults in the CHECKER, both found by those negative builds and both worth recording:**
- The nested handoff shape was read with raw dots, so a negative build that drops a trade's entry
  **crashed** the suite on `undefined.kind` instead of failing it — hiding every assertion after it
  and reporting a detected regression as a broken checker. Second time in this feature.
- The kindless-per-pair fixture **did not discriminate**: with the basements starting late, lifting
  the per-pair number onto them produced no finding either way, so `n14` **passed**. The fixture now
  starts the basements early enough that the bug shows.

**Rendered and measured** (gated on `visibilityState` + `clientWidth`): three chips, two of them the
same trade pair on different categories, computing `dashed 3px rgb(196, 33, 39)` against the plain
chip's `solid 1px rgba(196, 33, 39, .28)`; the flowline's handoff mark `stroke-dasharray 5px, 3px`
against the four plain marks' `none`; no horizontal page scroll.
⚠️ The strip and flowline were rendered from the shipped renderers over a **fabricated** clash
model — the arithmetic is proved by the suite, the browser proves the categories are legible.

⚠️ **Not verified signed in.** No real project has been measured against its own Schedule Setup.

`node --check` PARSE OK; 0 functions lost; NUL 0, CR 0, braces and comment markers balanced;
166 insertions / 62 deletions. `MODULE_V` → `20260911zg`, sort-checked against `zf`.

### The declared cross-trade handoff, wired into the clash detection (2026-09-11 zf) — fmlozano

Owner: *"Wire cfg.tradeLeads into the clash detection"* — taking up the standing invitation left at
the end of slice 3, where `cfg.tradeLeads` was named as declared-but-unread.

### 1. ⚠️⚠️ `cfg.tradeLeads` ALONE WOULD HAVE BEEN A DEAD END, AND THAT IS THE FINDING
It is the **legacy** per-pair field. `autoTrace` stopped reading it on **2026-08-13** (commit
`a404f83`) when the auto-trace question changed from *"how many floors between <A> and <B>"* to
*"how many floors at a time does <A> do before the next trade follows"*, and **nothing has written
it since**. On every project set up after that date it is `{}`. Wiring only that field would have
shipped a check that can never fire on a current project — a dead end of a subtler kind than the
three this module's audit already records.

So the **whole declared chain** is read, most specific first:

| Source | What it is | Still authored? |
|---|---|---|
| `cfg.tradeLeads['ST>AR']` | the legacy **per-pair** answer | no — but present on pre-Aug-13 setups |
| `cfg.tradeBatchKind[t].typical` / `cfg.tradeBatch[t]` | the current **per-leading-trade** answer | yes, in the auto-trace dialog |

⚠️ The key shape `prev + '>' + next` was **read off `a404f83`**, the last commit that consumed
it — not guessed from the field name.

### 2. ⚠️⚠️ `cfg.floorLead` IS DELIBERATELY NOT EVIDENCE
`blank()` writes `floorLead: 4` to **every** setup whether or not a planner ever touched it. Treating
it as a declaration would measure most projects in the database against a number nobody chose, and
put a red chip on trades for violating it. **No declaration, no handoff finding for that pair.**
Same rule as slice 3's *"an inferred order is labelled inferred"*, one step further: an invented
number is not labelled, it is **not used**.

### 3. One reader, not two
`batchKind` had the chain inline and must always answer a number (the generator has to link
something). The clash detector needs the opposite — to know when **nothing** was declared. So
`declaredBatchOf(cfg, trade)` was **split out of** `batchKind`, which now calls it.
⚠️ Behaviour-identical, and the suite **executes both** over all 80 (cfg, trade, floor-kind)
combinations rather than trusting the comment: **0 differ**.

⚠️ THE MATCHING LIVES ON THE BUILDER'S SIDE, where `cfg` is owned — the `zonePlanByLabel` rule.
`cfg` keys trades by GROUP CODE (`ST`), the Gantt knows them as the label on `work`. The new
`ScheduleBuilder.tradeHandoff()` emits **every spelling a trade can reach the grid by** (canonical
`GWORK`, the setup's short `GLABEL`, the raw code) — the two-spellings problem `WORK_ORDER`
documents, where a silent miss reads as *"nothing declared"*, which is a worse answer than an error.

### 4. What it reports
A **second class of finding**, beside the same-storey overlap: *the following trade climbed closer
than the handoff you declared*. B on storey `k` is compared against A's finish on storey
`k + L - 1`.

- ⚠️⚠️ **A per-TRADE lead applies only to the trade that actually FOLLOWS.** The setup asks about
  A and its immediate successor, so applying `lead[A]` to Structural→Tiles would invent a
  constraint nobody stated. A per-PAIR `tradeLeads` answer names both trades, so it applies to that
  pair whatever the gap.
- ⚠️⚠️ **A storey the leading trade never reaches is not a violation.** Near the top, A simply runs
  out of floors to be ahead on. Without this the check would put a chip on the last L-1 storeys of
  every pair on every project — noise that teaches a planner to ignore the strip.
- ⚠️ **Only the following trade is marked**, an explicit departure from the same-storey rule
  (which marks both because either could be out of place). Here the pair is on *different* storeys
  and the finding is specifically *"B started early"*; marking A would redden a trade that is exactly
  where the planner said it would be.
- ⚠️ **Only on the declared basis.** The handoff is declared per trade, so it applies only when
  the lanes ARE trades (`catCfg().field === 'work'`). Colour by an Activity Code and the pass does
  not run, rather than matching trade names against code values and finding nothing.
- ⚠️ It derives **nothing of its own**: storey ordinals and per-storey spans come from
  `_lsmRate`, the sequence from `_lsmSeq` — the `_vsTowerModel` rule again.

### 5. The cold open, and the memo that must NOT be cleared per frame
`ScheduleBuilder` holds a cfg only once the Schedule Setup **tab** has been opened this session, and
nobody opens it on the way to a chart. So `tradeHandoffFor(pid)` reads the saved setup directly —
the WBS matcher's own pattern, once per project, not awaited, the open setup winning over the most
recently edited one.
⚠️⚠️ **`_lsmLeadMemo` is deliberately absent from `_clearLsmRateMemo`'s per-frame list.** A
per-frame clear would overwrite the fetched answer with the empty synchronous one on the very next
repaint. It is invalidated by `psSetupChanged` — when the setup actually changes — and nowhere else.

### 6. ⚠️⚠️ THE LINK PASS CAUGHT THE NEW DEPENDENCY, TWICE
`_lsmClash` gained a call to `_lsmLead`, and the suite died with `_lsmLead is not defined` rather
than passing quietly — which is the entire reason it refuses to stub. Then it died again on
`pid is not defined`, because the probe reached `_lsmLeadWarm` with the LSM mode **off**, and the
function tests `_lsmAggOn()` before it ever mentions `pid`. **Reaching a branch is not the same as
reaching every line in it** — the third appearance of that trap in this feature.

### Verified
**475 assertions against the working tree, 23 against the pinned base `4d82fd4`, 0 failing.**

⚠️⚠️ **Eight negative builds, each reverting ONE decision, and every one bites:** the pass made
unreachable (**9** fail), `floorLead` treated as evidence (**5**), `batchKind` drifted by one
(**2**), the top-of-building guard removed (**1**), a per-trade lead applied to any pair (**1**),
the leading trade marked too (**1**), only the canonical spelling keyed (**3**), the legacy per-pair
field ignored (**3**).

The base contrast proves the dead end it closes: `tradeLeads` appears on **exactly two lines** there
— `blank()` and `normalize()` — and **nothing ever indexes into it**.

**Rendered** at the shipped CSS, gated on `visibilityState` + `clientWidth`, both classes measured:
the handoff chip computes `dashed 3px rgb(196, 33, 39)` against the overlap chip's
`solid 1px rgba(196, 33, 39, .28)`; the flowline's handoff mark computes
`stroke-dasharray 5px, 3px` against the plain mark's `none`, same colour and width. Label reads
*"2 clashes (1 vs declared handoff)"*, chip reads *"3rd Floor · Architectural Works 3 floors behind
Structural Works · 12 wd"*, no horizontal page scroll.
⚠️ **A second colour was deliberately not used.** The deck calls both *"possible pitfalls"* and
ranks neither above the other; a second hue would claim a severity order it does not make.
⚠️ The strip and flowline were rendered from the shipped renderers over a **fabricated** clash
model (`setClash`) — the detector's arithmetic is proved by the suite, the browser proves the two
classes are distinguishable.

⚠️ **Not verified signed in.** No real project has been measured against its own Schedule Setup.

⚠️ **Not applied per floor kind.** `cfg.tradeBatchKind` can say *basement 1, typical 6, roof 2*,
and only the **typical** value is used, because the LSM's storeys come from the location breakdown
and not from the setup's floor list — there is no matching between the two yet. Wiring that is the
next standing invitation.

`node --check` PARSE OK; 0 functions lost; NUL 0, CR 0, braces and comment markers balanced.
`MODULE_V` → `20260911zf`, sort-checked against `ze`.

### "Keep the Activity › Location preset" — and the comment that had become false (2026-09-11 ze) — fmlozano

Owner, on the preset I offered to drop: **"Keep the Activity › Location preset"**. It stays, and
the suite now says so in the assertion's own words rather than leaving it to be re-litigated.

⚠️⚠️ **Confirming that surfaced a real defect of my own making.** The comment above the Flowline
button in the toolbar markup still read *"It is NOT the Group menu's 'LSM' preset, which is
Activity › Location — the transpose of this layout"*. That was true when it was written and the
previous commit made it **false**: the preset now carries `lsm: true` and calls `setLsmRows(true)`,
so both doors open the same layout. A comment that confidently describes the opposite of what the
code does is worse than no comment — it is what the next reader trusts.

Corrected, and **asserted so it cannot come back**: the suite now fails if the source contains
either of the two old collision warnings. A negative build restoring the old sentence fails 1.

**399 assertions against the working tree, 15 against the pinned base, 0 failing.** `node --check`
PARSE OK; comment markers balanced 75/75; 6 insertions / 3 deletions, comments only — **no
behaviour change**. `MODULE_V` → `20260911ze`.

### The Group menu's "LSM" preset IS the LSM layout now (2026-09-11 zd) — fmlozano

Owner: *"Should we toggle the LSM through the group → LSM preset?"* I recommended **no** and was
**overruled** — *"Make the preset the toggle"*. Recording both, because the reasoning that
survived contact is the useful part.

### Why I said no, and what was actually true
1. The preset's dims were `['act'] + locDims` — the **transpose** of what the layout needs.
2. A preset that sets a grouping cannot arrange the other three prerequisites (colour key on, lanes
   keyed, collapse to the **floor** level), so it would look like the LSM and not be it.
3. `setGroupBys` has **twelve** call sites; coupling a mode to it means every one of them can now
   turn the mode off.

⚠️⚠️ **(2) was already mostly solved and I had not checked before answering.** The
`_lsmShaped()` guard from the row-height hotfix already withholds the tall row height the moment
the grouping stops being location-led. That made the owner's call **cheaper than I estimated**, and
I said so before implementing. Check the code before arguing from it.

### What shipped
- The preset is now `{ name: 'LSM', dims: locDims, lsm: true }` — **location-led**, so the hint
  printed under it is true again. `lsm: true` is read by the click handler; it is not a dimension.
- Picking it calls **`setLsmRows(true)`**, which arranges the grouping itself through `_lsmArrange`.
  ⚠️ The preset **hands over** rather than setting dims and leaving the mode to catch up — one
  writer for that arrangement, which is why `_lsmArrange` was extracted in slice 5.
- ⚠️⚠️ **The mode leaves with the grouping.** Now that a preset can turn LSM on, every other
  grouping action has to be able to turn it off — done **once** inside `setGroupBys`, which catches
  all twelve callers (presets, the level up/down/remove/add editors, the LBS wizard) instead of each
  of them remembering. It clears the flag, the persisted key and the lit toolbar button, and
  re-derives the row height.
  ⚠️ It cannot fight `_lsmArrange`, which sets a **location-led** grouping: turning the mode on can
  never turn it off. And with **no location levels** `_lsmArrange` toasts and never reaches
  `setGroupBys`, so the mode is not switched off underneath its own empty state. Both asserted.
- ⚠️⚠️ **The old dims are renamed, not deleted.** `['act'] + locDims` is a real grouping somebody
  may be using today — Activity over its locations — and silently removing it to free up a name
  would be a worse trade than one more row in this menu. It is now called
  **"Activity › Location"**, which is what it is.
- The LSM-rows tooltip no longer warns about a collision between two controls called LSM. There
  isn't one any more.

### ⚠️⚠️ The suite caught its own test being worthless
The first cut of these assertions **re-typed** the guard's condition into the checker and asserted on
that. A negative build with the shipped `if (!_locLed)` replaced by `if (false)` **passed all
fifteen** — the statements were still in the source and the arithmetic under test was the suite's
own copy. The block is now **cut out of `setGroupBys` and executed**, with a stubbed
`localStorage` / `getElementById` / `applyRowZoom` recording what it touched. The same negative build
now fails **7** assertions; a second negative that reverts the preset to its old dims fails **3**.
*A test that cannot fail is not evidence* — and it had to be demonstrated, not assumed.

### Verified
**397 assertions against the working tree, 15 against the pinned base `4d82fd4`, 0 failing.**
The base contrast bites on this change specifically: the base's preset **is** the activity-led
transpose, has no `lsm: true`, no "Activity › Location" entry, and its `setGroupBys` knows nothing
about an LSM mode.
`node --check` on the extracted inline script: **PARSE OK**. Function set vs base: **0 lost**,
31 added. NUL 0, CR 0, braces balanced. Diff: **50 insertions, 4 deletions**.

⚠️ **Not verified signed in.** This is a menu path that needs a loaded project; the guard is proved
by executing the shipped block, not by clicking it. `MODULE_V` → `20260911zd`, sort-checked
against `zc`.

### The flowline chart: the deck's own form, and one model behind both views (2026-09-11 zc) — fmlozano

Owner: *"Let's proceed with slice 5"*. The last of the five, and the shape the deck's earlier slides
are actually drawn in — time across, **location up**, each trade a diagonal whose slope is its
production rate.

### 1. ⚠️⚠️ IT DERIVES NOTHING OF ITS OWN
Storey ordinals, per-storey spans, the trade sequence, the rates and the clashes all come from
`_lsmRate` / `_lsmSeq` / `_lsmClash` — **the same model the LSM rows read**. `_lsmRate` now
hands out `ord`, `byKey`, `label`, `name`, `serAnc` and the window it measured in, alongside the fit
it already produced.

This is the `_vsTowerModel` rule, applied before it could be broken: this module has already
shipped a 3D view that put a floor somewhere else than the 2D view of the same data, *"with no way
to tell which is right"*. The suite now **forbids** the renderer from containing `levelRank(`,
`_lsmFit(` or `_lsmAgg(` at all.

⚠️ One consequence worth stating: `p.byRank` keeps the **whole span** now, not just the earliest
start. The fit only needs the start; the chart needs both edges for the band and both baseline
edges beside it.

### 2. What the deck asks for, and what it gets
- **A band per trade**, down the starts and back up the finishes — the work itself — with
  the centre line carrying the slope and the slope figure printed at its head. ⚠️ That figure is
  **the Rate strip's own**, not a second calculation.
- ⚠️⚠️ **BLOCK TASKS.** *"Non-linear activities, where the crew is stationary, are represented by
  block tasks."* A trade that never leaves one storey has no slope, and a near-vertical polyline
  would claim one — so it draws as a rectangle.
- ⚠️⚠️ **UNRANKABLE LOCATIONS ARE NOT PLOTTED AT ZERO.** *"Ground Reservoir"*, *"Podium Amenities"*
  — these carry work but are not storeys, and drawing them at the foot of the building would
  invent a position for them. They are **named in a footnote** instead.
- **Baseline dashed, actual solid**, the BL/ACT convention the Vertical Stacking settled, so the two
  views read the same way. Clash marks land on the storey they happen on. The data-date line is the
  same one the Gantt draws.
- ⚠️ It shares the Gantt's **own day width** (`DAYW[zoom] * ganttScale`), so the existing zoom and
  Ctrl+wheel drive it rather than a second time scale.
- ⚠️ **One section per tower.** The ordinals are per series, so two buildings are never drawn on
  one axis — the same rule the rate fits under.
- ⚠️ Three distinct **empty states** (no breakdown / no storey resolves / no keyed trade), the rule
  the stacking arrived at after four reports.

### 3. ⚠️⚠️ THE 2px MISALIGNMENT THE HARNESS CAUGHT
The storey labels are their own non-scrolling column beside the SVG — they must stay put while
the dates pan, and an SVG child cannot be `position:sticky`. So the two sides are laid out from the
same row height and the same top spacer, and the CSS note beside `.ps-fl-wrap` promises they agree.

They did not. This app is `box-sizing:border-box`, so the spacer's 2px bottom border sits **inside**
its height — and I had subtracted it as well, making the column 32px where the SVG's header
band is 34. **Measured: label centres 43/65/87… against the SVG's 45/67/89…** Every storey
label rode 2px above its own row.
⚠️ Fixed, and re-measured to **maxDrift 0** — and the check is now the stronger one: the
polyline **dots** sit on exactly the same six y values as the labels, so the axis and the plotted
points are proved to agree rather than merely both looking plausible.

### 4. The door, and the two things called "LSM"
A **Flowline** button in the Gantt toolbar, beside LSM rows, going through `_setView` like Progress
and Stacking and toggling back to the saved layout the same way; it sheds with them on a narrow bar.
⚠️⚠️ It arranges the same prerequisites the rows do, **through the same `_lsmArrange`** —
extracted in this slice precisely so there is not a second copy that forgets the floor-level
collapse. What it does **not** do is turn `_lsmRows` on: the row layout and this chart are two
readings of one model, not one feature.

⚠️⚠️ **AND THE GROUP MENU'S "LSM" PRESET IS A DIFFERENT THING.** It is `['act'] + locDims` —
*Activity › Location*, the transpose — and it predates any of this work. Two controls
called LSM that do different things is a genuine trap; the LSM-rows button's tooltip now says so
outright. **Renaming that preset is the owner's call and is deliberately not taken here.**

### Verified
**368 assertions against the working tree, 11 against the pinned base, 0 failing.**

⚠️⚠️ **A CORRECTION TO THE CONTRAST ITSELF, WHICH IS THE MOST IMPORTANT LINE HERE.** The pinned
`BASE_SHA` had been **overwritten** at some point during the five slices and pointed at
`621a33bc` — a commit that already contained slices 1–4. So the contrast had quietly become
**partly self-comparison**: three assertions that should have proved slice 1's work was new were
passing against a base that already had it. Re-pinned to `4d82fd4`, the commit before slice 1, and
the contrast is honest again: the base is missing **30 LSM functions and 14 constants**.
This is the [[contrast-build-pin-the-base]] trap in a form the memory did not anticipate — not
`HEAD` drifting, but the pin file itself being rewritten.

Rendered at 1440×900 with both stylesheets inlined, transitions off, gated on `visibilityState`
+ `clientWidth`: one section, a 148px axis, **six storey labels roof-first**, an 1623×174 SVG,
**8 bands / 8 centre lines / 8 dashed baselines**, 4 clash marks, the data-date line, slope labels
reading *"Structural · 8.6 wd/floor"*, band fill `#2F6FBF` at opacity **0.20**, baseline dash
`4px, 3px`, and no horizontal page scroll.

⚠️ **Not verified signed in.** No real project has been through the flowline; the chart is
rendered by executing the shipped `renderFlowline` against a stub document and a fabricated tower.
⚠️ The **block-task** and **unrankable-footnote** paths are asserted on the shipped source but were
not exercised in the browser — the fixture has neither.

`MODULE_V` → `20260911zc`, sort-checked against `za`/`zb`.
⚠️ Integrated by committing the module file FIRST and rebasing before touching the version or the
logs, so the two incoming commits (which do not touch this module at all) could not conflict with
them. `index.html` is byte-identical across the rebase.

### The five slices are done
Layout, production rate, clash detection, the data-date line, and the flowline. What is still not
built, and was named as out of scope at the start: the deck's **restricted time-location windows**
(*"restricted areas do not allow the planning of tasks in a given time and distance window"*), which
need a new store and a new authoring surface. ⚠️ And the standing invitation from slice 3:
`cfg.tradeLeads` is still declared and unread — wire it and a clash could be measured against
the planner's declared floors-behind rather than only against trade order.

### ⚠️⚠️ HOTFIX: ticking LSM stretched 2,561 rows, and the layout had almost no door (2026-09-11 z5) — fmlozano

Owner, from the live site on OPW101: *"Ticking LSM widens the with of the rows why is that"*, and
just before it: *"How does the planner access the LSM? Is it by selecting the 'LSM' in the
presets?"* Both are fair, and the second question's honest answer was **no, and almost nobody would
find it**.

### 1. ⚠️⚠️ THE COLLAPSE WENT TO THE WRONG LEVEL — that is the whole of the "wider rows"
`expandToLevel(n)` collapses every node at `ddepth >= n - 1`. `setLsmRows` called
`expandToLevel(locDims.length)`, so on OPW101's **Tower › Level › Zone › Unit**
breakdown that is `expandToLevel(4)` — which collapses only the **Units**. The Tower, Level and
Zone rows stayed open, and every activity carrying no Unit value was lifted by the dissolve and
stayed on screen as a leaf.

Then the row height did what it was told: `pad + lanes × pitch`, with 8 trades keyed, is ~96px
— applied to **2,561 rows** instead of about thirty floors. The owner saw tall rows full of
single activities ("Fire Rated Metal Doors", "Railings", "Latex Paint") and was right to ask.

The floor rows have to be the **deepest visible** ones, so the collapse level is the floor's own
depth: `ddepth >= fi` ⇒ `n = fi + 1`. On that breakdown the floor is the second dimension, so
**2, not 4**.
⚠️ An activity with no value at the floor level is still lifted to the tower and still visible
— correctly: it genuinely sits on no storey.

### 2. ⚠️⚠️ AND THE HEIGHT IS NOW ONLY EARNED BY AN LSM-SHAPED GROUPING
`ROWH` is uniform by construction — `renderWindow` slices on `floor(scrollTop / ROWH)` and every
bar sits at `i * ROWH` — so the lane budget cannot be given to the floor rows alone. That is
fine when the rows ARE floors and wrong the moment they are not, which is exactly what happened
above. `_lsmShaped()` gates it: the mode on **and** every grouping dimension a `loc:` one.

So changing the grouping now drops the rows back to their normal height even with the mode on,
which is the honest behaviour — the lanes are only ever drawn on location group rows anyway.
⚠️ It also gates `_viewKey()`, so the View button never reads "LSM" over a plain WBS tree.

⚠️ And the toast now **names the lane count and the resulting row height**, with a pointer to
*Key trades…*: "the rows got taller" is always answered by "because there are N trades keyed",
and the lever was two controls away with nothing connecting them.

### 3. ⚠️⚠️ THE DOOR: A TOOLBAR BUTTON, NOT A CHECKBOX INSIDE THE LEGEND
The only way in was a checkbox in the Legend head — which is itself hidden until *"Colour
activities by"* is ticked, and which can be folded away entirely. That is the
built-with-no-door shape this module has now recorded four times, and I walked into it again.

`#ps-lsmbtn` sits on the toolbar beside **Vertical Stacking** and **Activity Progress**, because that
is where this module's other view switches live — the owner moved them there deliberately on
2026-09-02 (*"still under the view button when we have already separated this entirely to the
toolbar"*) — and it **toggles**, the way those two do. It joins `_TB_SHED` so it sheds with them
in compact mode, and `_VIEW_LABEL` gains `lsm`, so the View button's face names it.
⚠️ It is NOT routed through `_setView`: LSM is a **row layout inside the split**, not one of the
full-width panels that replace it, so it toggles its own flag and repaints the View face itself.
⚠️ `_paintViewBtn()` only — **not** `renderLayoutMenu()`, which is declared in the init/wiring
scope and not at module scope. Calling it from there is the exact ReferenceError this file already
records for `closeMenus`, and a try/catch round it would have hidden the fault rather than avoided
it. The menu rebuilds itself on open.

### 4. ⚠️ THE NAME COLLISION, NAMED RATHER THAN SILENTLY RESOLVED
The Group menu has a preset called **"LSM"** — `['act'] + locDims`, i.e. Activity ›
Location. That is the **transpose** of this layout and a legitimate view in its own right, and the
owner named those three presets himself on 2026-09-11. So it is **left alone**: renaming another
person's naming without asking is not a fix. The new button's tooltip states the difference in as
many words, and this is flagged as the owner's call.

### 5. ⚠️ One floor-level rule, two callers
`stkDefaultLevel` already resolved "which location level is the storeys" by name test. The collapse
needs the same answer — if the two disagreed the rows would collapse to one level while the rate
and the clashes were computed on another, and nothing on screen would say so. Extracted to
`_locFloorLevelId()` and called from both, rather than copied.

### Verified
**323 assertions against the working tree, 0 failing.**

⚠️⚠️ **TWO CONTRAST BASES, and that is the point.** The `contrast-build-pin-the-base` trap bit
immediately: the natural base had moved past slices 1–4, so *"BASE has no LSM lane CSS"* started
failing — correctly, because the base now contains them. So:
- against the **pre-LSM** commit `4d82fd4`: **11 assertions**, none of the feature exists;
- against the **immediate predecessor** `621a33b`: **9 checks**, each specific to this fix — the
  predecessor **has** `expandToLevel(locDims.length)` and gates the height on
  `_lsmRows` alone; this file collapses at `_fi + 1` and gates on `_lsmShaped()`; and
  `_locFloorLevelId`, `_lsmShaped`, `ps-lsmbtn` and the `lsm` view label are all absent from it.

The collapse arithmetic is **executed, not described**: with Tower/Level/Zone/Unit, the floor
resolves to Level, its index is 1, `n` is 2, and at that level the Tower row stays open while the
Level rows collapse. The old value is asserted to have left the Level rows **expanded**, which is
the reported bug. The guard is executed across four groupings: location-only is shaped;
`['wbs']` is not; `['act','loc:a']` — the preset named "LSM" — is not; and mode-off never
is, with the row height reading **34px** in each unshaped case and the full lane budget only in the
shaped one.
⚠️ The icon name was checked against the set before shipping (`layers` exists and is already used
19 times here) — an unknown `data-ico` renders an **empty button**, which this log records.

⚠️ **Not verified signed in**, and this one genuinely wants it: the report came off the live site,
and what I can prove here is the arithmetic and the gate, not OPW101's own row count after the fix.
That is the first thing to check.

`MODULE_V` → `20260911z5`. ⚠️ Integrated by re-applying the anchored patch onto the
fast-forwarded base (their three commits touch Progress Photos only) — byte-identical result.

### Still to come
Slice 5, the flowline / time-location chart, is **deliberately not in this commit**: shipping a new
view on top of a layout that was stretching every row would have compounded the fault rather than
fixed it.

### The data-date line gains a grip, each storey says where it had got to — and the line stops eating clicks (2026-09-11 z4) — fmlozano

Owner: *"build the data-date line next"*. Slice 4 of 5, and the deck's headline read: a vertical line
at a date with every floor's state beside it — *"PLANNED STATUS AS OF END DECEMBER 2015"*,
*"Active Floor"*, *"New Cleared Floor"*, *"Exterior Wall Complete"*, *"SEALED LEVEL"*.

### 1. ⚠️⚠️ MOST OF IT ALREADY EXISTED, AND ONE THING I "FOUND" WAS NOT A BUG
The line is there: `.ps-datedate`, gated on `_gset.ddline`, drawn at `var dd = today()`.
`dataDate` is persisted per project, set from the Schedule dialog, and read by the CPM, the S-curve
and EVM.

⚠️⚠️ I flagged `var dd = today()` as a bug — the line drawing at the wall clock while the
schedule computed as of a pinned date — and **that was wrong**. `today()` IS the effective data
date:
```js
// call means "the data date", so today() returns dataDate (falling back to wall clock).
function today() { return dataDate || wallToday(); }
```
Recorded because the wrong conclusion was one grep away from being "fixed", and the fix would have
broken the one thing that was already right.

So the genuine gaps were: the line could not be **dragged**, and nothing put a storey's **state** on
the chart.

### 2. ⚠️⚠️ THE LINE WAS EATING CLICKS, AND NOBODY HAD NOTICED
`.ps-datedate` carried no `pointer-events`, and it is a top-level child of `.ps-tl` at **z-index 6**
while the bars sit at **3** — so it was already on top of every bar it crosses and already
swallowing their clicks. Two pixels wide, at one date, down the whole chart: easy to miss, which is
presumably why it has been there all along. **Measured on the base file: no `pointer-events`
declaration at all.**

Adding a drag is what made it matter, so the line is now **`pointer-events:none`** and only a grip
takes the pointer. ⚠️ **Measured after: a click at the line's own x, over a bar that crosses it,
lands on the BAR** (`elementFromPoint` returns the bar's progress fill), where before it hit the
line.

### 3. ⚠️⚠️ THE GRIP IS A TAB AT THE TOP, NOT THE LINE
Making the full-height line draggable would have re-created the same problem deliberately — and
worse: at month zoom a 2-day activity is about 8px wide, so a short bar sitting under the data date
would have become completely ungrabbable. An 11×14px tab at the top of the line is the only
draggable part.
⚠️ The honest cost: it scrolls with the chart, so it is reachable at the top of the list rather than
from anywhere. The Schedule dialog remains the way to set the date from any scroll position, and it
is unchanged.

### 4. ⚠️⚠️ ONE DATA DATE, WRITTEN THROUGH THE SAME SETTER THE DIALOG USES
The drag calls **`setDataDate`** — not a second as-of date for this chart. Two of those would be
far worse than no drag at all: the Rate strip, the S-curve, EVM and the remaining-work floor would
each be reading a different *"now"*. It follows the spotlight's own precedent exactly:
`setDataDate` → `computeCPM()` → `renderAll()`.
- ⚠️ **Nothing is written to the database.** The date lives in localStorage and the CPM is a
  read-time computation, so a drag is reversible — drag it back, or use the dialog.
- ⚠️ **It says what it changed, naming the old value.** A gesture that silently moves a
  project-wide setting is how a planner loses track of which *"now"* a report was run against.
- ⚠️ A **transient** label follows the cursor and is taken down on release. The permanent one was
  removed at the owner's request (*"Text label removed per request; the line alone marks the data
  date"*) and that still holds — this exists only for the duration of the gesture.

### 5. ⚠️⚠️ THE STOREY STATE COMES FROM `_stkState`, THE PANEL'S OWN FUNCTION
Not a second rule. `_stkState` reduces a bucket to two comparisons — **done** when every finish
is at or before D, **started** when any start is — and a lane bar's `s`/`f` **are** that
bucket's min-start and max-finish, so handing it the bar's span is exactly equivalent to handing it
the activities.
⚠️⚠️ **That equivalence is PROVEN, not assumed:** the suite runs both paths — the bar span
through `_lsmStateOf`, and `_stkState` over the real activity lists — across four bucket shapes
× 40 dates, and requires all **160** to agree. It also asserts that all three states occur in
that grid, so the agreement cannot be vacuous.

The label follows the deck's shape rather than its words, which are that project's vocabulary:
- ⚠️ the **frontier** is the furthest-along DONE trade *in sequence order*, not a count and not the
  last to finish. *"through Exterior Masonry"* is what a planner reads off the deck's chart; *"3 of 8
  done"* is not, and would be wrong the moment a late trade finishes early.
- *"Plastering · through MEPF 1st Fix"* — the active work, then the finished front.
  *"Complete"* when every keyed trade on the storey is done, *"Not started"* before the first start,
  and **nothing at all** for a storey with no bars (rather than a misleading "Not started").

⚠️ Gated on its own switch **and** on `_gset.ddline`: a status pinned to an x the planner cannot
see is a riddle, so if the line is hidden the readings go with it.

### Verified
**295 assertions against the working tree, 11 against the pinned base, 0 failing** — the
contrast is missing all 23 LSM functions and 10 constants, and its `.ps-datedate` has no
`pointer-events`.

⚠️⚠️ **AND THE GESTURE WAS ACTUALLY DRIVEN — the first one in this feature that has been.**
The shipped `startDDDrag` is sliced into a harness page and real `mousedown`/`mousemove`/`mouseup`
events are dispatched at the grip. Measured: the grip moves **858 → 1078px**, which at 11px/day
is 20 days, and the date goes **2026-03-20 → 2026-04-09** — exactly 20; the transient label
tracks mid-drag (*2026-03-30* at 110px, *2026-04-09* at 220px); the line follows the grip;
`computeCPM` and `renderAll` each fire **once**; the toast reads *"Data date → 2026-04-09 (was
2026-03-20)"*; the label is removed and both `dragging` classes are cleaned off.

Rendered at 1440×900 with both stylesheets inlined: grip **11×14px** at the top of the
timeline, `cursor:ew-resize`, `pointer-events:auto`; the line **2px** and `pointer-events:none`;
**6 status chips**, one per storey, reading *"Exterior Masonry · through Structural"*, *"through
MEPF 1st Fix"*, *"Plastering · through MEPF 1st Fix"*…; work-in-progress chips on
`rgba(199, 119, 0, 0.12)` = `--pd-warn-bg` (a colour, not a width); no horizontal scroll.

⚠️ **Not verified signed in.** No real project's data date has been dragged, and the status chips
have never been read off real activities.

`MODULE_V` → `20260911z4`, sort-checked against `e3`/`sc6`/`z1`/`z2`/`z3`.

### Still to come
Slice 5: the flowline / time-location chart, as a second view on the `setVStackMode` template.

### Clash detection: two trades on one storey at the same time, against an order somebody actually stated (2026-09-11 z3) — fmlozano

Owner: *"build the clash detection next"*. Slice 3 of 5, and the deck's first named advantage of LSM:
*"They show a direct connection to the layout of the site … Overlapping activities (clashes) can
be detected easily"*, and later *"Task lines that overlap indicate possible pitfalls and show that
the construction plan does not work."*

### 1. ⚠️⚠️ A CLASH MEANS NOTHING WITHOUT AN ORDER, AND THE PROJECT ALREADY DECLARES ONE
`cmpWorkName` sorts trades by **`WORK_ORDER`** — the owner-specified construction sequence
(Gen Req → Site Works → Structural → Architectural → MEPF → Allied →
Others) — and it already handles **both spellings** a trade can reach the grid under: the
canonical `"Structural Works"` an import writes, and the Schedule Setup's short `"Structural"`.
Reused, not re-derived. `_lsmSeq()` returns that order whenever the colour field is **Trade**.

⚠️⚠️ **On any other field the order is INFERRED, and it is labelled inferred everywhere it is
used** — on the strip, in every chip's tooltip. Activity name, activity type and activity code
have no declared sequence, so *"Tiles before Plastering"* is only a finding if somebody said
Plastering comes first. Flagging a violation of an order nobody stated is how a screen loses trust,
and this module's log already records two features that lost it that way.

### 2. What counts, and what deliberately does not
A clash is: trade **B**, which the sequence puts after trade **A**, starting on the **same storey**
before **A** finishes there.

- ⚠️⚠️ **A SHARED FINISH DAY IS A HANDOFF, NOT A CLASH.** `dispFin` is inclusive, so a successor
  starting the very day its predecessor finishes overlaps by one day — ordinary FS practice
  here. `LSM_CLASH_MIN = 1` and the overlap must **exceed** it. Without that threshold every clean
  handoff in the programme would be reported, which is the fastest way to make a warning worthless.
- ⚠️ **Different storeys are not a clash**, and that is the entire point of the chart: two trades
  overlapping in time on different floors is exactly how a takt programme is supposed to run.
  Asserted, because it is the one false positive that would discredit the feature immediately.
- ⚠️ **Two towers are not a clash either** — the series key (`_danc`) keeps `"1st Floor"` in
  Tower A apart from `"1st Floor"` in Tower B, the same way the rate's fits do.
- ⚠️ The **overflow marker** stands for several folded trades and can never be one side of a pair.
- Overlap is counted in **working days**, through the same axis the rate uses.

### 3. ⚠️⚠️ REPORTED, NEVER BLOCKED — and never hidden
Nothing is filtered, moved, refused or recoloured away. The strip names the pair, the storey and the
days; the bars carry a hatched mark over the overlapping **stretch**; the planner decides. Some
overlap is deliberate — a second-fix trade legitimately follows into a floor before the first
is quite done — and the deck's own word is *"possible"*.

⚠️ **Both bars are marked**, not just the late one: a clash is a property of the pair, and marking
one side reads as *"this trade is wrong"*. ⚠️ A hatched overlay **inside** the bar rather than an
outline around it — an outline would compete with the critical-path and change-order rings the
same bar can already carry, and what is being marked is a stretch, not the whole bar.

### 4. ⚠️ The chip NAVIGATES rather than filtering, and that is a considered limit
A "floors with clashes" filter would have to narrow the rows **before** `buildNodes` runs — and
the clash set is derived **from** `buildNodes`' own output, so it would need a two-pass build.
Selecting the storey and revealing it answers the same question with machinery that already exists
(`selId` + the two-pane scroll idiom), and it leaves every other floor on screen for comparison,
which is what the chart is for. Worst overlap first, eight chips, the count carries the rest.

### 5. ⚠️ One axis cache for every LSM reader
The rate fit and the clash pass both need *"working days between these two dates"* over the same
window for the same handful of calendars. The axis cache is lifted out of `_lsmRate` into
`_lsmAxOf`, so there is **one** walk of the span per frame and one boundary convention.
⚠️ Still `makeAxis` directly, never `axisFor` — that one caches for the CPM and wipes its cache
when the base differs. **Asserted: exactly three `makeAxis(` call sites in the file** (its
declaration, `axisFor`, and `_lsmAxOf`).

### 6. ⚠️⚠️ A FOURTH DECLARED-BUT-UNWIRED FIELD
Looking for a declared handoff to measure against turned up **`cfg.tradeLeads`** — *"per
cross-trade transition: floors of the leading trade done before the following one starts"*. It
occurs **exactly twice** in the file, in `blank()` and in `normalize()`, and is **read nowhere**. So
the setup records the planner's intended handoff and nothing consumes it. That is the fourth of
these, after `openLocAdopt`, `fillDown`'s change-order branch and `cfg.floorLag`. Wire it and this
detector could compare a clash against the *declared* floors-behind rather than only against trade
order — which is the obvious next step and is deliberately not guessed at here.

### Verified
**252 assertions against the working tree, 11 against the pinned base, 0 failing** — the
contrast is missing all 19 LSM functions and 9 constants.

Executed, not described: the declared order is asserted by handing `_lsmSeq` its trades in the
**wrong** order and requiring `WORK_ORDER` back (`Site Works > Structural Works > Architectural
Works > MEPF Works`), and again in the short-GLABEL spelling; a 5-working-day overlap is counted as
**5**; a same-day handoff is **0**; a clean gap is **0**; the same window on two different storeys is
**0**; the same storey name in two towers is **0**; the sequence violated the other way round still
names Structural as the predecessor; both bars carry a mark; worst-first ordering holds; and the
strip drops the *"(inferred order)"* caveat only when the basis is declared.

⚠️ **Rendered at 1440×900** with both stylesheets inlined, transitions off, gated on
`visibilityState` + `clientWidth`: **4 clashes → 8 marks** (two per clash), 6 distinct bars
flagged, each mark 6px tall, **inside** its bar, hatched, ringed `rgb(196, 33, 39)` = `--pd-bad`;
chips are real `<button>`s on `--pd-bad-bg` with `--pd-bad-line`; label reads *"4 clashes (inferred
order)"*; no horizontal scroll.

⚠️⚠️ **A harness ordering bug that is worth keeping, because it names a real dependency:** the first
render produced **0 marks**. `_lsmBarsHTML` asks `_lsmClash()` for a bar's marks and `_lsmClash`
reads `DL` — and the harness was rendering bars in the same loop that built the rows, before
`DL` was set. The real module is safe (`doRender` assigns `DL = displayList()` before `renderWindow`
ever reaches `ganttRowHTML`), but the harness had to **imitate that order rather than assume it**,
so it is two passes now.
⚠️ One fixture bug too: `grpRow` hardcoded the `'name'` category field, so the declared-sequence
clash test aggregated by activity name and silently found nothing. The field is a parameter now.

⚠️ **The chip's click is wired but not driven.** The wiring is asserted structurally (the
`data-lsmclash` attribute is emitted and `querySelectorAll('button[data-lsmclash]')` binds it), and
the scroll reuses the existing two-pane idiom — but `renderActLegend` has not been run in a
browser, so no chip has actually been clicked. ⚠️ **Not verified signed in.**

`MODULE_V` → `20260911z3`, sort-checked against `e3`/`sc6`/`z1`/`z2`.

### Still to come
Slices 4–5: the draggable data-date line (mostly reuse — `_stkState` already answers *"the
state of one (location, category) bucket at the cut-off date"*) and the flowline chart.

### The production rate, read off the staircase — and four things it should not have re-invented (2026-09-11 z2) — fmlozano

Owner: *"build the slope readout next"*, then, while it was being built, three corrections in a row:
*"Cross check with existing functions in the module and make sure no duplicates occur"*, *"Cross
check as well since we already have a location breakdown that defines the locations in the
schedule"*, *"Cross check the working cycle as well since I believe this already available in the
schedule setup"*, and *"check those items that were built and cross check for existing functions so
that everything is connected and nothing ends in a dead end"*. Every one of them found something.

Slice 2 of 5. The deck's own argument for LSM over a Gantt — *"They show a clear understanding
of the effect of the rate of production (by the slope of the line)"*, quoted as **"2 floors per
month"** and **"12 working day cycle per floor"**. Neither figure is typed anywhere; both are read
off the staircase the schedule already draws.

### 1. ⚠️⚠️ FOUR THINGS THE FIRST CUT WAS ABOUT TO DUPLICATE, AND ONE IT ALREADY HAD
The owner's cross-check instruction was right four times over:

| I was going to write | What already existed |
|---|---|
| `_lsmWIndex` — a working-day index | **`makeAxis`**, which precomputes *"how many working days lie strictly BEFORE offset o"*, with **`ALLAX`** as its calendar-day counterpart |
| a day-walking loop in `_lsmIdleGap` | **`PDCal.workingDaysInRange`** |
| my own floor ordering | **`ScheduleBuilder.locCatalogue()`** — the floors the planner declared in Schedule Setup, in the setup's own order |
| a "declared cycle" derived from takt settings | nothing — see 4 |

And one already shipped in slice 1 and had to be corrected: `_lsmAgg` resolved a bar's calendar with
**`dsCalendarFor(null, a)`**, which answers the same chain but belongs to the duration-scenario
screen. A working-day question is a scheduling question, so it is **`cpmCalOf`** now. Two resolvers
reaching the same answer today is exactly how they disagree tomorrow.

⚠️⚠️ **`makeAxis` DIRECTLY, NEVER `axisFor`.** `axisFor` caches on `_axCache`/`_axBaseKey` **for the
CPM**, keyed by its base and window — and its own first line wipes that cache when the key
differs. Calling it with the rate's base would have thrown away the CPM's axes on every repaint.
Own cache, shared implementation.

### 2. ⚠️⚠️ THE FIT'S y IS THE STOREY'S POSITION, NOT ITS RANK — caught by rendering it
`levelRank` is an **ordering key, not a measure**: the roof answers **900**, substructure **-50**, B2
**-2**. Fitting on those raw values put a Roof Deck **900 storeys above** the top floor, and one
outlier flattens a regression. **Measured in the browser on a six-storey fixture with a roof: r²
0.43, and every single trade read "irregular".** On a real high-rise the strip would have said
"irregular" always, which is worse than not shipping it.

"Floors per month" counts **storeys**, so y is the storey's ordinal position. ⚠️ The ordinals come
from **every storey on the chart for that series**, not from the trade's own points, so a trade that
skips a floor still shows the skip as a gap in its climb rather than having it compressed away.
⚠️ On the declared basis the ranks are already 0,1,2… so this is a no-op there; it is the
heuristic basis it rescues.

### 3. ⚠️⚠️ ONE RANK FUNCTION FOR THE ROWS AND FOR THE RATE
`_lsmRankOf` prefers the **declared** breakdown and falls back to `levelRank`, and **slice 1's
row-ordering block now calls it too**. If the row order and the slope's y-axis came from different
functions the strip would be describing a chart nobody is looking at. Consequence worth stating: a
storey the regexes cannot read — *"Podium Amenities"* — now takes its real place in both.
⚠️ **One basis for the whole chart, never a mixture**: declared indices are 0,1,2… and
`levelRank` answers -50/0/900, so interleaving them would produce a slope describing neither. The
strip says which axis it used, and points at Floors & Zones when it is guessing.
⚠️ `typeof ScheduleBuilder`, never `window.ScheduleBuilder` — this module is one IIFE and that
global is never assigned; that guard *"could never pass"* and silently disabled the floor plans for
the whole life of that feature.

### 4. ⚠️⚠️ THERE IS NO DECLARED CYCLE TO COMPARE AGAINST, and that was checked rather than assumed
The owner believed the working cycle was already in the Schedule Setup. It asks takt questions —
`zoneSimul`, `unitSimul`, `tradeBatch`/`tradeBatchKind`, `floorLead` — but **a trade's per-floor
cycle is stored nowhere**: it *emerges* from the activity durations plus those settings when
`generate()` runs. Re-deriving it here would be a second copy of the sequencing engine.

⚠️⚠️ **And `cfg.floorLag` — "cure/lag days between a floor and the floor above" — looks
like the missing declaration and is not one: it occurs exactly TWICE in this file, in `blank()` and
in `normalize()`, and is never read.** No caller subscripts it. So it holds no planner input at all.
**Third instance of the declared-but-unwired shape in this module**, after `openLocAdopt` and
`fillDown`'s change-order branch. Wire it and a planned-vs-achieved column becomes possible; until
then the measured figure is the only honest one, and the strip does not imply otherwise.

### 5. Two fits, not one converted
A cycle in **working** days and a rate in **calendar** months are different regressions over the
same points; dividing one by 30.44 to get the other silently assumes a seven-day week. Each is
fitted in its own x. Verified on the rendered fixture: 12 calendar days between storeys reads
**8.6 working days per floor** *and* **2.5 floors per calendar month** — both correct, and
neither derivable from the other.
⚠️ **≥ 3 storeys and r² reported.** Under 0.7 the chip shows the **word** "irregular" and
**no figure at all** — not a greyed-out number, because a greyed-out number still gets read as a
number, and a confident "2.1 floors/month" over a scatter is what ends up in a report. Degenerate
fits (every storey the same day, every point the same storey) return **null** rather than r² 1,
which is the most confident possible statement about nothing.

### 6. Nothing ends in a dead end
The owner's last instruction, made permanent: **50 structural assertions** now check that every
`_lsm*` function has a caller, every constant is read, and each of the three controls is both
emitted and wired — plus the reverse direction, that `makeAxis`, `workingDaysInRange`,
`expandToLevel`, the curated key set, `locCatalogue` and `cpmCalOf` are all actually reused. This
module has shipped "built with no door" three times; a structural assertion is the only thing that
keeps it from being four.

Also connected: the **bar tooltip** now carries that storey's own cycle (*"started 12 working days
after the storey below"*) from the same `steps` map the fit builds — the local figure a planner
can check, where the strip states the trend.

### Verified
**199 assertions against the working tree, 11 against the pinned base, 0 failing.**
⚠️⚠️ **The roof-deck assertion BITES:** reverting the single ordinal line reproduces **r²
0.432396** — the same 0.43 the browser reported — and a cycle of **0**, failing exactly 5
assertions. The consecutive-floor fixtures could never have caught it, which is why that case is now
its own suite section.
⚠️ **Rendered at 1440×900** with both stylesheets inlined, transitions forced off, gated on
`visibilityState` + `clientWidth`: 8 chips, **0** marked irregular, swatch computing
**`rgb(47, 111, 191)`** (a colour, not a width), strip 47px, no horizontal scroll, and the tooltip
reading *"6 storeys, upward, r² 1. 8.6 working days per floor, 2.5 floors per calendar month."*

⚠️⚠️ **Three more of my own harness defects, all of which read like module bugs:**
- the **probe could not link a branch it never ran** — again. `_lsmDecl` is wrapped in
  `try/catch`, so a missing `_locNormMemo` degraded **silently** to the heuristic basis and four
  assertions reported "heuristic" with no cause visible. The probe now calls `locNormKey` past the
  catch. ⚠️ Worth keeping: that catch is correct in production (a project with no setup must fall
  back) and it means a genuinely broken read is invisible.
- `emitbars.js` kept the **old single-line `sliceVar`**, so slicing the multi-line `ALLAX` object
  returned an unbalanced fragment and broke the next statement. Its slicer is now lifted from the
  suite so the two cannot disagree.
- two of my expectations were **wrong rather than the code**: a fixture running Ground(0) →
  2nd(2) skipped rank 1, so a 12-working-day-per-storey climb correctly fitted **10** days per rank
  (a building with no 1st floor); and my "irregular" fixture was two tidy clusters, which a line
  fits at r² **0.73** — above the floor, so it was not irregular at all. Both fixtures are
  now what they claimed to be.
⚠️ A structural check also had to learn to **strip comments**: it forbade `dsCalendarFor(` in
`_lsmAgg` and was matching the comment that explains the change. The module's own precedent — a
check that bans a code pattern must still let the prose quote it.

⚠️ **Not verified signed in.** No real project's locations, trades or working calendar have been
through this; the declared-breakdown path has never read a real `schedule_builder` row.

`MODULE_V` → `20260911z2`, sort-checked against `e3`/`sc1`/`sc6`/`z1`.

### Still to come
Slices 3–5: clash detection, the draggable data-date line (mostly reuse — `_stkState`
already answers *"the state of one (location, category) bucket at the cut-off date"*), and the
flowline chart.

### The LSM Gantt: one row per floor, one bar per trade, and the staircase that shows the rate (2026-09-11) — fmlozano

Owner, with a training deck — *Linear Scheduling Method for High-Rise Building Construction*,
Engr. Arnie L. Sy, First Pacific Leadership Academy, Feb 2015: *"Read the PDF and how we can properly
implement the Gantt view of the LSM in the schedule module."*

The deck's method is the Primavera P6 workaround, steps 1–19: make WBS level 1 the **location**,
**collapse** to one row per floor, define **one bar format per trade** each filtered by an activity
code and each with **"Show bar when collapsed"** ticked (step 11), **adjust the bar rows** so
overlapping bars stay visible (step 15), and **reverse the floor order** so the roof is at the top.
The point is not tidiness: **the slope of the resulting staircase IS the production rate** ("2 floors
per month", "12 working day cycle per floor"), which is the one reading a plain Gantt cannot give.

This is **slice 1 of 5** — the layout. Slope, clash detection, the data-date line and the
flowline chart are named at the bottom and are deliberately not in this commit.

### 1. It is a MODE OF THE GANTT, and the enabler was already written
`_sumSegsHTML` already lane-packs N bars into one row — `.ps-sum-seg` divs with inline
`top:<lane*lh>%` — which is precisely P6's "bar rows". Three things stopped it being this
layout: it bails on `r._dkind === 'group'` (so a collapsed row drew nothing), it only runs on a true
leaf branch, and it is **one lane per ACTIVITY**, which is why its cap is 4.

⚠️⚠️ **`_sumSegsHTML` IS NOT TOUCHED.** Loosening its group guard would hand every grouped row in
the app per-activity lanes — a behaviour change nobody asked for, in the view planners read
daily. New `_lsmBarsHTML` short-circuits ahead of it instead, gated on `r._glsm` rather than on the
mode, so a WBS branch, a Trade group and the Execution Phase head all keep their normal bracket +
strip + rail while the mode is on. That is what makes the mode safe to leave on. The suite asserts
that guard is still there.

### 2. ⚠️⚠️ THE LANE IS FIXED PER TRADE FOR THE WHOLE CHART
`lane` = the category's index in `catList()`, held constant on every location row. That is what makes
one trade read as a continuous diagonal down the floors rather than a scatter of bars.

⚠️ `_sumSegsHTML` **rejected greedy interval packing on purpose** — *"a shared lane says
'these are the same track of work' when nothing of the sort is meant"*. That objection was about
per-ACTIVITY lanes and it **argues for** fixed lanes here, where a lane genuinely IS one trade. The
index counts KEYED entries only, the same counter `catList` uses for the palette, so **lane N and
colour N are the same entry** and the legend doubles as the lane key.

⚠️ **And the curated key-trade set already existed for exactly this reason.** `catKeySet` /
`catKeyList` / `saveCatKeys` were built in August and their own comment already quotes this very
slide: *"choose only those activities that are with great importance and impact."* The lane roster
is that set. Nothing new was invented; a project with more trades than lanes gets the busiest
proposed and a toast saying so, editable through the **Key trades…** button that was already
sitting next to the new checkbox.

### 3. ⚠️⚠️ A WEEKEND IS NOT A BREAK — the defect the tests found
A trade can work a floor, leave, and come back, so the bar is **contiguous runs with a notch per
gap** (the `.ps-bar-cut` idiom, i.e. P6's suspended-activity convention) rather than one span from
first start to last finish, which would claim continuous work on a floor that stood idle.

The first cut tested **calendar** days. So a trade working Friday and returning Monday got a notch
— and on a schedule whose activities are weekly that is a notch in very nearly every bar, which
would make the one mark that means *"this floor stood idle"* mean nothing at all. `_lsmIdleGap` now
counts a gap only when it contains a **working** day, read through `PDCal.isWorkDay` and the
activity's own calendar via **`dsCalendarFor(null, a)`** — reused, not re-derived, because its
own comment describes exactly the chain wanted here.
⚠️ This is the deck's own point, not an embellishment: it lists *"it is very difficult to integrate
a working calendar on the LSM schedules drawn on spreadsheet or CADD"* as a disadvantage of drawing
these by hand. ⚠️ Over 14 clear days it is a break whatever the calendar says, which also bounds
the walk; and it degrades to the calendar-day rule when PDCal is absent.

### 4. Row height goes through the ONE place row height is set
`renderWindow` slices by `floor(scrollTop / ROWH)` and bars sit at `i * ROWH`, so per-row heights
would break both the virtualization and every bar's `top`. Instead `rowHFor(z)` gains an LSM floor:
`max(plain height, LSM_PAD + lanes * (LSM_LANE_H + LSM_LANE_GAP))`. ⚠️ A **floor under the zoom**,
not a replacement — row zoom can still make the row taller, never shorter than the lanes need.
⚠️ And it reaches `--ps-rowh` through `applyRowZoom`, which that function's own note calls THE ONE
PLACE row height is set, in both the CSS and the JS.

### 5. ⚠️⚠️ Reversing the floors contradicts a decision this file had already made
`buildNodes` says the grid keeps its build order *"always"*, and the stacking view's own checkbox
promised *"the grid and Gantt **always** keep their own build order (bottom-up)"*. So:
- a **separate flag** (`_lsmTopFirst`, its own localStorage key), never `_stkTopFirst` — sharing
  it would make changing one screen silently reorder the other;
- **LSM mode only**: turn the mode off and the order is byte-for-byte what it was (asserted);
- **that tooltip is corrected**, because left alone it becomes a false statement on screen.

What the removed coupling was protecting against is the order changing *behind* the planner. This is
a mode they switch on deliberately, and the deck reverses the floors as its own step.

⚠️⚠️ **AND IT IS NOT A PLAIN `.reverse()`.** `stkDisplayOrder` learned that the hard way: reversing
the whole list drags the **unrankable** values (*"Ground Reservoir"*, *"Podium Amenities"* —
things that are not a storey) to the top of the building. The ranked levels are reversed among
**themselves** and the rest keeps its place below. Same rule, reused via `levelRank`, not re-derived.

### 6. ⚠️⚠️ In this layout the LEGEND IS THE LANE KEY
`renderActLegend` keys only the leaf rows on screen, under a long note explaining that *"collapsed
means collapsed"* — correct, and hard-won over four reports. But in the LSM layout **everything
is collapsed by design**, so that rule left eight coloured lanes on screen with nothing to say which
trade was which. The legend now keys the **lane roster** in this mode.

⚠️ This does **not** re-arm the bug that note is about. That was a fallback to *every category in
the project* whenever the strict set came back empty. This is the explicit, capped lane roster —
the same shape as the curated-set branch one line above it, which already bypasses `_vis`.

### 7. The door
⚠️ A mode is not just a flag: the chart needs the grouping to BE the location, the tree collapsed
to one row per floor, and a curated set of trades. `setLsmRows` arranges all three — reusing
**`expandToLevel(locDims.length)`**, so no new collapse code — and **says what it changed**.
Making the planner do those three by hand and only then discover the mode is how a feature ends up
built with no door, which this module has shipped twice (`fillDown`'s change-order branch, and
`openLocAdopt`). ⚠️ It is reversible: the outgoing grouping is remembered and restored, and
`setGroupBys` already saves and restores each grouping's own collapse tree.

The controls sit in the Legend head beside **Key trades…** — a direct control rather than
another nested menu, and next to the button that edits the lane roster, because the two are one
subject.

### Verified
**81 assertions passing against the working tree, 11 against the pinned base**, every one executing
functions **sliced out of the shipped file by NAME** (a line-numbered slice in a 46k-line file under
concurrent edit goes stale within hours). The contrast bites: the base has none of the seven new
functions, none of the six constants, no top-first block, no `_glsm`, no lane CSS, its `rowHFor(1)`
is the plain 34, and its `ganttRowHTML` still draws the composition strip.

Asserted rather than eyeballed: **the lane index is constant for a trade across floors** (the
property that makes the diagonal); every keyed category is either a lane or inside the **counted**
overflow marker, with unique contiguous lane indices — never `% cap`, the silent-overpaint
defect on file; `renderWindow`'s window still brackets the visible rows at the taller ROWH, at four
scroll positions; **the JS lane constants equal their CSS counterparts** (bar 6 + 1 air + rail 2 =
`LSM_LANE_H` 9); progress is duration-weighted (10d@100% + 30d@0% = **25%**, not 50); a reversed
date pair cannot make a negative-width bar; and `levelRank`'s two recorded traps still hold
(*"Ground Reservoir"* is not level 0).

⚠️⚠️ **Two bugs in my own harness, both of which read exactly like bugs in the module:**
- the slicer did not understand **regex literals**, and `levelRank` contains `/[’'".,()\-_]/g`
  — a regex holding both quote characters. It entered string mode on that apostrophe and
  returned **217,897 characters** of the file, failing to parse. This repo's changelog keeps
  recording this shape; it is now a third instance.
- the link pass **could not link a branch it never ran**. The probe used a single interval, so the
  run-merge loop never executed and `_lsmIdleGap` reached the assertions unlinked and threw there
  instead of being resolved. The probe now carries two intervals with a gap. ⚠️ The refusal is
  intact: a name the module does not define as a function or module-level var is **refused, not
  stubbed** — auto-stubbing would make the suite go green against a broken file.
- ⚠️ And two of my first expectations were **wrong rather than the code**: the Friday→Monday
  case (see 3, which turned into a real fix) and a baseline-rail assertion whose fixture carried no
  baseline, so the rail was correctly absent.

**Rendered in a browser** at 1440×900, both stylesheets **inlined** (the pane renders a file
outside the project as a static snapshot, so a relative `<link>` resolves to nothing and the harness
reports perfect widths on invisible elements — the trap on file three times), transitions forced
off before measuring, and gated on `visibilityState` + `clientWidth`: a fabricated six-storey tower
draws **48 bars, 8 per row, 6 rows**, bar height **6px**, **minimum lane pitch 11px** (= 9 + 2, so
lanes never overlap), 48 baseline rails, **exactly 1 notch** for the one deliberate break, **0
horizontal page scroll**, and the bar background computes **`rgba(47, 111, 191, 0.2)`** — the
colour assertion, not merely a width. Structural's left edge across the six floors measures
**370 / 298 / 227 / 155 / 84 / 13 px**, monotone: the staircase, and its slope is the cycle.
⚠️ My first run measured **height 0 on everything** — not a CSS fault: the pane was 399px wide,
where the phone media query sets `.ps-split { display:none }`. Resolved by reading the ancestor
chain rather than by guessing.

⚠️ **Not verified signed in, and that is the thing most worth doing next.** Every number above comes
from executing the shipped functions against fabricated rows; no real project's locations, trades or
calendar have been through this. The first real open should check the staircase against a
hand-computed floor cycle. ⚠️ If floors land in *"— No level —"*, check the match table
(`location_levels.match`, *Group ▾ → Match WBS to locations…*) before blaming the
layout — a missing alias is the usual cause.

### Deliberately not in this commit
Named so they are not mistaken for oversights: the **production-rate / slope** readout (least-squares
`levelRank` vs start day, in floors per month and working days per floor cycle, with r² so a
non-linear trade gets no confident number); **clash detection** (report, never block — the deck
calls overlaps *"possible pitfalls"*, and the intended order should come from the Schedule Setup's
Trade sequence where a project has one, labelling a `catList`-derived order as inferred); a
**draggable data-date line** (mostly reuse — `_stkState` already answers *"the state of one
(location, category) bucket at the cut-off date"*, which is the deck's *"planned status as of end
December 2015"*); and the **flowline / time-location chart** as a second view on the
`setVStackMode` template. Also not built: the deck's **restricted time-location windows**, which need
a new store and a new authoring surface and are their own proposal.

`MODULE_V` → `20260911z1`. ⚠️⚠️ **Not the next letter:** the remote had moved to `20260911e3`
while this tree held `20260911sc6`, and `e3` sorts **before** `sc6` — so a browser holding `sc6`
would never have fetched `e3`. `z1` is past both, checked by sorting all three rather than assumed.
⚠️ Integrated by **re-applying the content-anchored patch scripts onto the fast-forwarded base**
rather than merging a 46k-line file: every anchor matched exactly once and the result is
byte-identical to the pre-integration file. The other session's five commits did not touch this
module.


### Consolidated drew a box on a fully traced project — two faults, both of them "the trades disagree" (2026-09-11 a1) — ethanrobles10

Owner: *"how come when pressing the consolidated and combining 2 trades that have the same floor
plan per floor but just different zones, the overall shape just resorts to a default rectangle. pls
fix that."*

They are right, and it was not one bug. Consolidated is the ONE card that cannot name a trade, and
both halves of the plan pipeline treated that as "no plan" rather than as "all of them".

### 1. ⚠️⚠️ THE BARE FLOOR KEY WAS EMITTED ONLY WHEN THE TRADES POINTED AT THE SAME PLATE
`zpByLabelOf` keys the plan map `trade|floor`, and writes a bare `floor` key for the cards that span
trades (per tower, Consolidated). That bare key was written only when every trade naming a floor
pointed at the **same plate id** — and it cannot be. **Every trade keeps its own floors tree**, so
two trades that traced *the very same outline* still point at two different floors, hence two
different plates. The rule read that as a contradiction and emitted nothing.

So on a project where every floor had been traced, twice, Consolidated was told there was no plan at
all: `_arAt` stayed null, the plate fell back to `PLATE.cols × CELL` (the **wrap grid** — a layout
for cells that have no plan), and the whole tower came out a box. The owner's report is exactly this
case: same plan per floor, different zones drawn on it.

**Now it picks the LARGEST traced footprint** (`zpBareShape`), and it does **not** union them:

- ⚠️ A union needs polygon booleans this app does not carry. And simply concatenating two tilings of
  the SAME floor puts two sets of coplanar caps inside one `ExtrudeGeometry` — the z-fighting this
  view spent a week removing. The dodge that makes `_vsZpOutlineOf` work (adjacent zones share an
  *edge*, and coincident opposite faces back-face cull) does not survive two overlapping *areas*.
- ⚠️ The largest plate is the honest single answer: the slab is at least as big as the biggest thing
  anyone traced on it, and a trade that traced only a core is a **subset** of that floor, not a rival
  claim about it. What is lost is a wing only one trade traced that the largest plate does not cover;
  the per-trade cards still draw each trade's own plan exactly, untouched.
- ⚠️ Area is compared in **plate-proportioned** units (y ÷ `ar`), never raw 0..1 — normalising both
  axes throws the sheet's aspect away, so without it a plan traced on a tall sheet measures the same
  as a wide one covering twice the floor.
- ⚠️ Ties keep the **first**, so the answer cannot depend on `cfg.zoning`'s key order.
- ⚠️ `sources` travels on a **copy**. Tagging the original would make that one trade's own card claim
  it was drawn from several plans.

### 2. ⚠️⚠️ AND A TRADE CELL MATCHED NO ZONE, SO IT KEPT ITS GRID BOX
Fixing the map alone would only have squared the box off. A Consolidated **card** splits each level
row by TRADE (`_vsRowTradeCells`), so the cell label is `Structural Works`; it matches no zone on the
plan, and the whole-floor fallback in `_vs3Build` was keyed on `n === 1` — true only where a single
trade touched that storey. Every multi-trade storey drew wrap-grid boxes with a plan in hand.

**A trade IS the whole floor** — not one place on the storey, all of them — so every cell of a
trade-split row now takes the floor's outline.

⚠️⚠️ **And that is precisely why they had to be banded in height.** A traced outline is positioned by
its own coordinates (`_vs3PolyMesh` never reads the wrap slot), so handing the same outline to two
trades would extrude two identical solids in the same place: coincident caps, z-fighting, one trade
invisible behind the other. The storey's height is split between the trades present on it instead —
the footprint stays true, every trade stays visible, and no trade is ever placed in a corner of the
floor it does not occupy.

- `bandN` is 1 everywhere else, and the band maths is then the identity — **untraced cards, per-trade
  cards and every 2D card are unchanged**. The 2D card keeps its trade columns; a section cannot draw
  a plan and was never wrong here.
- The **fill line**, the **sliver rounding** and the **compare baseline mark** all measure against
  `SHb = SH / bandN`. Left at `SH` a banded trade's baseline mark floats above its own slab, over the
  trade stacked on top of it, and its fill line is sized for a slab n times taller than the one drawn.
- ⚠️ **The zone-colour channel is guarded** (`_pgZone`). With `_pg` now set for trade cells,
  `_vsZpColorOf` would have returned the floor outline's colour for every trade and repainted the
  whole building one colour — deleting the channel that says which trade is which, which is the exact
  failure the note beside `fill` was written to prevent. A one-cell storey still takes it: there the
  cell IS the floor.
- ⚠️ The band order is the trades **present on that storey**, not a fixed slot per trade — a storey
  with no architectural work closes the gap rather than leaving a floating slab, so a trade's band can
  sit lower on some floors than others.

### 3. The footer says whose plan it is
A Consolidated card drawn from the largest of several trades' plans now says so, in both the `all`
and `partial` states. It is a real footprint but it is not "this card's plan", and a planner
comparing it against a trade whose plan is smaller has to be able to see why. Silence would be the
card quietly claiming a drawing it does not have.

### 4. ⚠️ Regression fixed from `zd`: the timeline legend sat on the viewpoint bar
Visible in the owner's screenshot — the legend covering the model's own **Display** control, with its
date range behind it. The legend is pinned to the STAGE (one period for both panes in compare), but
the stage's first rows belong to the panes: the pane label, and in 3D the viewpoint bar under it.
`top:9px` was a constant; it is now **measured** from the viewport's offset inside the stage
(`_vsFocusPlaceLegend`), which is the only thing that knows how tall that chrome is — it differs
between 2D, 3D, single and compare. Called inside the same rAF as the fit/resize, because both rects
read zero before layout.

### Verified
Two node harnesses driving the **shipped** code, sliced verbatim out of `index.html` (gitignored,
deleted), plus a browser check of the legend against real pane chrome.

| Checked | Result |
|---|---|
| `zpBareShape`, one trade | the shape is handed back **by identity**, untagged |
| Owner's case: 2 trades, same outline, different zones | a shape is emitted (**was null**), `sources = 2`, equal area → the first wins deterministically, sheet proportions carried, per-trade shapes left untagged |
| A trade that traced only a core | loses to the trade that traced the floor, in **either** argument order |
| Aspect weighting | the deeper sheet measures larger and is picked; raw 0..1 would have tied |
| Degenerate input | no polys / undefined polys → 0; `ar: 0` falls back to 1; an L-shape measures 0.75, not its box |
| `bandN = 1` | **identity** — slices land at exactly the pre-change heights and offsets |
| `bandN = 2` | trade 0 fills the lower half, trade 1 the upper; nothing overlaps; the two exactly fill the storey; each fills upward inside its own band; both go through the polygon path |
| `bandN = 4` | four contiguous equal bands ending exactly at the storey top |
| Band-scaled chrome | a 4× shorter band gets a proportionally thinner fill line; 0.4% still rounds away, 99.9% still rounds up |
| Legend placement | with a pane label **and** a viewpoint bar above the viewport, `top` measured to 84px and the legend clears the chrome (`legendTop 99 ≥ viewportTop 90`) |

⚠️ **Not verified against real data.** The anon key has no grants, so this has not been run against
OPW101's own traced plans — what is proven is the plate-selection rule, the band geometry and the
placement, not that the owner's two zoning trees resolve to the plates I expect. The footer's own
verdict line (`_vsPlanFit`) is the thing to read first on the real project: on Consolidated it should
now say **drawn as you traced them**, followed by the several-trades sentence.

### The focus window plays itself, at a speed you pick, and says which week you are looking at (2026-09-10 zd) — ethanrobles10

Owner: *"For the vertical stacking full screen, allow a play button to see the progress over time,
and allow users to set the playback speed (daily, weekly, monthly, quarterly etc.). But can you also
include a legend of the number of timeline on the upper right (example: week 1, week 2, week 3
etc...)"*

Three things in the **Vertical Stacking → expand a tower → focus window** (the one with the Full
screen button). The scrubber already walked the programme; you had to walk it by hand, a month at a
time, and nothing on screen said how far into the job the picture was.

### 1. Play, and the speed IS the step
A play/pause button left of the step arrows, and a **Daily / Weekly / Monthly / Quarterly / Yearly**
select next to it. One tick advances the as-of date by one of those, so "faster" and "coarser" are
the same dial — which is what makes it read as a playback speed rather than a second date filter.
The same dial re-labels the two step arrows, which used to be hard-coded to a month: there is one
step size in this window, not a playback speed and an arrow that could disagree with it.

- **Play from Live starts at the beginning.** Live is the end of the programme, and a film played
  from there has one frame in it. Play from a scrubbed date carries on from where you are; play
  from the end restarts. The end is a **stop, not a loop** — it leaves you looking at the finished
  building rather than snapping back to an empty site.
- Grabbing the handle, pressing a step arrow, pressing **Live**, clicking a legend row or closing
  the window all stop the run. Two things writing `_vsAsOf` is the scrubber fighting the person
  holding it.

⚠️⚠️ **Playback does NOT go through `_vsFocusSchedulePaint`.** That scheduler exists for a *drag*:
it coalesces pointer moves the buildings cannot keep up with and **drops the ones in between**. A
playback that dropped frames would skip the very periods it was asked to show. So each frame
repaints through `_vsFocusRunPaint` — which measures its own cost — and only *then* schedules the
next one, at `max(300ms, cost × 1.15)`. On a 2,500-activity tower the film runs slower than the
nominal rate; it can never run ahead of what has actually been drawn, and it can never queue two
repaints at once.

⚠️ The chosen speed lives at module level, so it survives closing and reopening the window inside a
session, and is deliberately **not persisted** past that — a remembered daily walk is how someone
opens this next week and reports the step arrows crawling.

### 2. The timeline legend, upper right
A panel pinned to the top-right of the stage: five period rows with the current one lit, its date
range beside it, and `Week 91 of 105` underneath. Clicking a row jumps the programme to that period.

⚠️⚠️ **Every number counts from THIS BUILDING'S OWN START, never from the calendar.** "Week 1" is
the week this tower starts — not ISO week 1 — and "Month 3" is the third month of this programme,
not March. Someone reading the legend is asking how far into *this* job the picture is; a calendar
number cannot answer that, and would silently answer a different question.

- Days and weeks count from the programme's start **date**; months, quarters and years from its
  start **month** — each unit on its own natural boundary, which is how a planner counts both
  ("week 1 is the week we started", "month 1 is the month we started"). Month 1 can therefore begin
  before the programme does, and the range shown is clamped to the programme at both ends.
- ⚠️ Days/weeks step through `setDate`, months/quarters/years through `setMonth` — never by adding a
  fixed number of milliseconds. A 24h constant drifts an hour at every DST boundary and a daily run
  across a year of them lands on the wrong **day**. `_vsDaysBetween` rounds for the same reason.
- ⚠️ **The rows are written, never built.** `_vsFocusLegendHTML` emits five fixed rows once; `chrome`
  only sets their text, their `.on` class and their `data-p` — because `chrome` runs on every frame
  of a drag and of a playback, and a legend that rebuilt its own markup there would re-enter the DOM
  sixty times a second and drop the click handler delegated to it. Same contract the footer bar has
  had since the two-speed scrub landed.
- ⚠️ Pinned to the **stage**, not to a pane: in *Planned vs Actual* there are two panes and the
  period is one number for both. Inside a pane it would print twice, and be clipped by the pane's
  own overflow the moment the building was panned. It takes the top-right corner; the pan hint has
  the bottom-right, and the two overlays must never share one.
- ⚠️ The window **slides**: the current period is kept in the middle where there is room on both
  sides and pinned to the ends where there is not, so row 3 is not always "now" — the `.on` class is
  what says which one is.
- ⚠️ The range is **not** two `Fmt.date`s. `Fmt.date` is a locale format (`Sep 27, 2027` under
  en-PH); two of them plus a dash is 26 characters in a 186px panel and the tail is ellipsed away —
  and which end gets ellipsed is the locale's business, not ours. `_vsPeriodRange` prints one year
  for a range that stays inside one (`27 Sep – 3 Oct 2027`). It is the only compact date in the
  window: the scrubber's own label still prints the as-of date through `Fmt.date`, so the app's
  format is never off the screen.
- Below 700px the legend keeps the count and drops the neighbouring rows — on a 375px stage five
  rows eat a third of the picture, and the **number** is what was asked for.

### 3. Verified
Measured in a throwaway harness (gitignored, deleted) that loads the **shipped** slices —
`_vsFocusScrubHTML`, `_vsFocusWireScrub`, the period helpers and the legend branch of `chrome`, cut
out of `index.html` verbatim — over a synthetic 5 Jan 2026 → 4 Jan 2028 programme, plus the real CSS
block. ⚠️ The one stub that is *not* the shipped code is `Fmt.date`, which is exactly the trap this
repo has already been bitten by; that is why the legend's range does not go through it at all.

| Checked | Result |
|---|---|
| Period numbering | start = Week/Day/Month/Quarter/Year **1**; +6d = Week 1, +7d = Week 2; 31 Jan = Month 1, 1 Feb = Month 2; 31 Mar = Q1, 1 Apr = Q2; a date before the start clamps to 1 |
| Totals | 2-year programme → **105 weeks / 25 months / 3 years**; 3-year → 157 / 37 / 1096 days |
| Stepping | 400 daily steps from 5 Jan 2026 → **9 Feb 2027** (no DST drift); 10 weekly → 16 Mar 2026; 4 quarterly → 5 Jan 2027; back one month → 5 Dec 2025 |
| Play from Live | started at Week 1 and advanced one week per tick |
| Play from a scrubbed date | carried on from it, clamped at the finish, **stopped** — button off, timer cleared |
| Speed change mid-view | `Week 91 of 105` → `Month 25 of 25`, arrows re-titled "Back/Forward one month", as-of date unmoved |
| Legend row click | jumped to that period's first day; **Live** returned to recorded progress |
| Forward arrow at the finish | no movement (clamped), no stray repaint |
| Light + dark, 1280px and ≤700px | legend reads in both themes; the phone rule drops the neighbour rows and the range as designed |

⚠️ **Not verified against real data.** The anon key has no grants, so none of this has been run
against a real tower's activities — what is proven is the period arithmetic, the control wiring and
the paint pacing, not how a 2,500-activity building feels under a daily run. The adaptive floor is
there for exactly that case and is the thing to watch first.

### CLASS_CODE_DB stops being de-zeroed, and a group code stops reading as an error (2026-09-10 z4) — fmlozano

**Run `migrations/2026-09-10-class-code-group-names.sql`.** Owner: *"let's fix the CLASS_CODE_DB
de-zeroing next."* Named in the `z3` entry below as reported-not-fixed; this is the fix, plus the
two things measuring it turned up.

### 1. The padding — 43 codes, and it is provably a no-op everywhere else
`CLASS_CODE_DB` **is** Finance's Level-2 group chart: 197 entries, 197 of which match a
`class_codes.code_l2` once the leading zeros are restored (154 did already, 43 did not). Padded by a
script that edits only the first quoted field of a line inside the literal and refuses any code that
does not then resolve to a real group. Asserted before and after: **0 duplicates either way**, line
count unchanged, and no name or trade altered — the only difference between the old table and the
new one is `zfill(5)`.

⚠️ De-zeroing is the one transformation `docs/boq-and-pmi.md` forbids outright, because the
de-zeroed space is not unique — `015051` (Gen Req › Earthmoving) collides with `15051` (Metal Works ›
Railings). It bit here in the mundane way rather than the dramatic one: nothing collided, the codes
simply joined to nothing.

### 2. ⚠️⚠️ A GROUP CODE IS VALID, AND THE RESOLVER ONLY KNEW ONE LEVEL
Padding alone would not have paid off, and the `z3` entry said so: `class_codes` is keyed on the
**item** code, so `ccByCode` could never resolve a group however it was spelled. Every activity the
Schedule Builder has ever pushed was therefore reported as an unrecognised class code — **197 of 197
library codes**, measured.

That was the resolver being wrong, not the data. An activity is coarser than a bill line by nature:
a group ("Chilled Water AC Works") is the size of something you schedule, and the L3 items under it
("Chilled Water Condenser Riser (B.I Pipes)") are the size of something you bill. So `ccLevelOf`
answers **item | group | null**, `ccGroupByCode` and `ccGroupOf` resolve the group side from the
`code_l2` / `desc_l2` columns **already on every `CLASS_CODES` row** — no second fetch, no second
source — and `ccIsUnknown` now means *neither level*.

- ⚠️ **The item index is consulted first and always wins.** Four of the 205 groups (`01700`,
  `26350`, `50000`, `51000`) also exist as an L3 code, where the group's general item carries the
  group's own number. Those must read as the item, which is the more specific true answer. Asserted
  for all four.
- ⚠️ **A group code is toned, never coloured like an error.** `.ps-cctag.grp` is `--pd-muted`; the
  red stays for a code that resolves at neither level. Measured against the row it sits on:
  item **16.30 / 12.22**, group **7.07 / 7.02** (light / dark), all three states distinguishable in
  both themes.
- The detail panel and the form hint gained the same three-way split, so a planner is told *"a
  group-level code — the list below is items only"* instead of nothing, or worse, a warning.
- ⚠️ `offChartCount` — added yesterday — **used to count every group code**, so it lit a warning on
  a perfectly good build. It now counts only what resolves at neither level, which is a genuine
  defect: a hand-typed code, an older template, or one still missing its leading zero.

### 3. The BOQ allocator meets it halfway
A BOQ line carries an **item** code and a builder-made activity carries a **group** code, so the
allocator's exact-equality gate matched nothing between them — on a schedule built that way it
proposed nothing at all, for every line. `candidatesFor` now falls back to the group.

- ⚠️ **Exact wins as a set.** If any activity carries the line's own item code, those are the
  candidates and the coarser ones are not offered alongside — mixing them would let a whole-group
  activity dilute a split that had an exact answer. The group gate opens only when the exact one
  found nobody.
- ⚠️ The group comes from the chart row's `code_l2`, **never from string surgery on the code**.
  Truncating `03101` to `0310` would be the de-zeroing mistake in another costume: the code is an
  opaque key and only the chart says what its group is.
- ⚠️ An activity coded with one of the four dual group/item codes is **not** taken as its own group —
  there it means the item.
- The rung says which it was: *"in group 03100, which holds 03101"* rather than *"carries 03101"*.

### 4. The chart's own two errors
`25200` reads *Chilled Water AC Works* in `class_codes` but holds only **Fresh Air Duct** items;
`25550` reads *Stair Pressurization Ducting Works* but holds **Kitchen Exhaust** items. Both are the
name of the group immediately above — a copy-down, twice. `CLASS_CODE_DB` has them right, and the
evidence is the items themselves, not the other list.
⚠️ The migration writes **by `code_l2`, never by `code`**: `desc_l2` is denormalised across every
item of the group, so updating one row would leave the group with two names depending on which item
you read. Idempotent, and it reports 0/0 on a second run rather than looking identical to a first.
⚠️ **11 trade disagreements are left alone** — Site Development and the LD Roadworks family are `SW`
here and `Others` in the chart. Both readings are defensible; choosing is Finance's call, not a data
repair.

### Verified
**42 new assertions (240 across five suites), 0 failing**, every function sliced out of its shipped
file and executed, with the pre-change revision as the contrast: it leaves 43 codes unresolved,
flags a group code as unknown, has no `ccLevelOf` at all, and returns **0 candidates** for a
group-coded schedule.
⚠️ **Two of my own harnesses were wrong in ways worth recording.** `t3`'s slice anchor pointed at the
old `candidatesFor` body and failed as a syntax error that reads like the code under test is broken —
the hazard of slicing by text in a 45k-line file. And `t4`'s fixture chart **had no `code_l2` column**,
so the group index built empty and every group assertion passed while testing nothing; a fixture
missing a column the code reads is a silent no-op test.
⚠️ `offChartCount` calls the module-level `ccLevelOf` from inside the ScheduleBuilder closure. The
suite **links the real function rather than stubbing it**, and the scope chain is separately asserted
(declared at module level, before the builder's IIFE opens) — this file has shipped a
`below is not defined` before.
⚠️ **NOT verified signed in.** No activity has been pushed with a group code and read back, and the
migration has not been run — until it is, the two group names simply stay as they are in the chart
while the builder's list shows the correct ones.

### ⚠️ Measured and deliberately NOT fixed
`.ps-cctag.unknown` is `var(--pd-red)`, which computes **3.40:1 on the dark card** — under AA. It is
a brand *surface* colour doing text duty, and `--pd-bad-text` exists for exactly this (the 2026-09-10
uic pass). But `color:var(--pd-red)` appears **120 times in this file alone**, so fixing one of them
is worse than fixing none. It needs its own sweep, and it is recorded here rather than half-done.

`MODULE_V` → `20260910z4`.

---

### The Activities step seeds itself from the project's own BOQ (2026-09-10 z3) — fmlozano

Owner: *"let's do the schedule builder seeding from the high-level BOQ."* The first of the three
hand-offs in their own process — *"high level BOQ will be the basis → detailed schedule will be
developed → detailed BOQ will be based on the detailed schedule"* — and the only one with nothing
built for it. (The third has shipped since 2026-09-07h, as Contracts & Claims' *Add lines from the
schedule…*; the 2026-09-08 (a) §4 audit table calling it *"❌ nothing"* is stale.)

### It is a second loader, not a new dialog
`+ From BOQ` sits beside `+ Library` in the holding pane and fills the **same list**, so ticking and
`←` are the accept step the planner already uses. ⚠️ Deliberately **not** a propose→preview→apply
modal: the holding list *is* the preview and ticking *is* the acceptance, and a modal doing the same
job is a second thing to keep in step. It reads three tables and writes none.

⚠️ **Current revisions only.** `boq_class_map` carries `project_id`, so reading by project alone
sweeps in every superseded revision — a code deleted in rev 02 would come back from rev 01, against
the whole point of supersession. A project may hold several BOQ documents (one per trade package),
so it is a list of current revisions, not one id.
⚠️ **One entry per CODE, not per line**, and headings and `exclusion_note` lines are skipped — the
same rule Cost Loading's `boqDerive` applies, for the same reason: a heading is layout and an
exclusion is a positive statement that the work is somebody else's scope.
⚠️ The mapping is the **exact inverse of `addAuthoredLines`** — `desc_l3` → activity name, `desc_l2`
→ the Construction Library's L2 grouping, the Finance trade → the builder group. The two directions
must agree on the string or a round trip renames everything.

### ⚠️⚠️ parseTrade recognised THREE of Finance's SEVEN trade values
Measured against the migration that assigns them, not read: `'Structural Works'`,
`'Architectural Works'`, `'MEPF Works'` and `'Allied Services Works'` all returned **null**, because
the map held the short forms (`'structural'`, `'mepf'`) and the fallback can only match a bare
GROUPS code. That is **458 of the chart's 702 codes** — they would every one have arrived in Others.

It was self-consistent with this pane's own hint line ("Structural", not "Structural Works"), and it
had a second consequence nobody had hit yet: `GWORK` — the canonical labels this module **writes** to
`project_schedule.work_type` — could not be read back in, so pasting a Trade column out of the
schedule and into this grid silently cleared **four of the eight** trades.
⚠️ Three of eight on the round trip but four of seven on the chart, and the gap is instructive:
`GWORK`'s ALLIED label is `'Allied Services'` (procurement's wording, per `trade_map`) while
Finance's own value is `'Allied Services Works'`. The vocabularies overlap unevenly, which is why
`finTradeGroup` goes through `parseTrade` rather than being a second table.

### ⚠️⚠️ And the `+ Library` list cannot produce a valid class code at all
`CLASS_CODE_DB` is a hardcoded 197-entry list, and measuring it against the Finance chart shows what
it actually is: **Finance's LEVEL-2 group chart with the leading zeros stripped.** 154 of 197 match
an L2 group exactly; the other **43 match only after zero-padding** (`'1050'` vs `'01050'`). **Zero
of the 197 is a valid Level-3 code**, and `class_codes` is keyed on the padded L3 code.

The push writes `class_code: r.act.code` — so **every activity ever pushed from the library carries
a class code that resolves to nothing**, `ccIsUnknown` is true for all of them, and the BOQ
allocator's class-code gate can never match one. A BOQ-seeded code does resolve, so those activities
arrive **already tagged**. That is the real payoff of the button, and it is what closes the loop to
the four-rung matcher shipped in Contracts & Claims this morning.

⚠️ **`CLASS_CODE_DB` is NOT fixed here.** Padding it would make its codes correct L2 groups and they
would still not be L3, so it does not become a valid class code either — the fix is a different,
larger decision about what that list is for. De-zeroing is also what `docs/boq-and-pmi.md` forbids
outright (the de-zeroed space is not unique: `015051` Gen Req › Earthmoving collides with `15051`
Metal Works › Railings). It is **reported on screen instead**, by `offChartCount`, in the step where
the two lists sit side by side. ⚠️ That count returns **0 while the chart has not loaded** — claiming
every code is unknown because the lookup table is empty is the `[]`-is-truthy family of false alarm.

### ⚠️ A layout defect found by measuring, not by reading
Adding a second button to `.sbld-hold-h` — a `nowrap` flex row — **shredded both labels**. Measured
against the module's own stylesheet in a browser at a real desktop width:

| pane width | before (1 button) | after, unfixed | after, fixed |
|---|---|---|---|
| **320px (default), resting** | 36px · one row | 59px, label on 2 lines | **36px · one row** |
| 320px while codes are ticked | 36 | 59 | 63 · two rows |
| 180px (drag minimum) | **59 · already two rows** | 81px, label on **3 lines** | 86 |

Fixed with `white-space:nowrap` on the button **plus** `flex-wrap` on the header — nowrap alone would
have overflowed instead — and a shorter label (`+ From BOQ`), the long form living in the `title`.
No overflow at any width, in either theme. Same failure the labelled `+ Add meeting` button hit.

⚠️ **Two of my own measurements were wrong before the code was**, both recorded because the mistake
is reusable: the first probe ran in a **399px-wide hidden pane**, so the phone media query was live
and every button measured 44px; and counting rows by distinct child `top` values reported 4 rows in a
36px header, because `align-items:center` gives items of different heights different tops — the
false positive this log already records for the module-bar audit. Height is the honest measure here.

### Verified
**56 assertions, 0 failing**, every function sliced out of the shipped file and executed, with the
pre-change revision run as the contrast (it drops the four trades, and 458 of 702 chart codes). The
loader runs against a stubbed Supabase covering the heading, the exclusion, an off-chart code, a code
with no trade, the dedupe against the build, and all three empty/broken cases — which say three
different things and, on a missing table, name the migration and **do not mark the setup dirty**.
⚠️ **NOT verified signed in** — the loader's three reads have never run against a real BOQ, and no
seeded activity has been pushed. That is the first thing to try: build a BOQ, press `+ From BOQ`,
tick, `←`, Save, push, and check the grid's Class Code column resolves rather than reading unknown.

`MODULE_V` → `20260910z3` (re-derived from the remote's `z2` after rebasing onto it).

---

### The camera survives the scrubber, both compare panes turn together, and the per-zone question is answered (2026-09-10) — ethanrobles10

Owner: *"Also for the progress, return the progress per zone, aligned with the schedule. In
addition, whenever the progress bar is moved, please retain the view being displayed. Whenever i
move the progress timeline bar, the view is always returned to default. In addition, in planned vs
actual, whenever there are view changes on the right, please also change the left (planned)
pane."*

## 1. ⚠️⚠️ Per-zone progress: the answer given twice before was un-followable

This has now been asked three times — *"how come the progress per zone is removed"* (twice) and
*"return the progress per zone, aligned with the schedule"* — and twice it was closed with "it
already works, switch **Detail** to 2." **That answer was wrong in the way that matters: on this
project it cannot be followed.** Pressed on the symptom, the owner said exactly what they see:
*"when adjusting the progress bar, the whole floor's accomplishment is being updated not per
zone."*

**Measured on the shipped code**, one storey of two activities on different schedules (Zone A
Jan–Mar, Zone B Jul–Sep), walked through four as-of dates:

```
zones RECORDED, Detail 2 → 2 cells
  as-of 2026-02-14 : Zone A=50%   Zone B=0%      ← per zone, on its own schedule
  as-of 2026-08-15 : Zone A=100%  Zone B=50%

NO zone recorded, Detail 2 → 1 cell, labelled '—'
  as-of 2026-02-14 : —=25%                        ← the WHOLE FLOOR
  as-of 2026-08-15 : —=75%
```

**Nothing is wrong with the progress.** `_vsRowCells` groups by `locValOf(r, id) || '—'`, so when
NO activity carries a value at that level every row folds into ONE bucket named `'—'` — the
Detail 1 drawing, reporting the floor's number, **under a Detail 2 label, with nothing on screen
saying why.** The planner switches to Detail 2, sees the identical building, drags the scrubber,
and correctly reports that the floor moves as one. The progress was per zone and aligned with the
schedule the whole time; **the zone column was empty, and the view hid that.**

Three things now say so, and the module's own rule decides how:

- **The Detail buttons for empty levels are disabled and carry the reason.** The bar already
  applies exactly this rule to a combined model — *"a button that looks live and is overridden is
  the silent failure this module keeps recording"* — and a Detail level nothing is filed under is
  the same button. The reason **names the level** (Zone, Area, Sector, whatever this LBS calls it)
  rather than saying "locations", because advice with the wrong word sends a planner to the wrong
  column: *"Not one activity on screen carries a Zone, so this Detail would draw exactly what
  Detail 1 draws. Set a Zone on the activities — Schedule Setup › Floors & Zones, or Actions ›
  Match WBS to locations… — and this level draws itself."*
- ⚠️ **The buttons stay on screen**, disabled, never dropped: hiding them would hide that the
  choice exists. `_vsDetailNow()` clamps to the measured depth so the model is never asked for a
  grain it cannot draw, the same shape as the existing `_vsMixTrades` clamp.
- **A banner in the existing warn stack** states it as the data gap it is, and connects the
  symptom to the cause in the owner's own terms — that a floor moving as one *is* what a floor
  doing all its zones at once looks like.
- **The footer stops advising a switch that would change nothing.** *"Switch Detail to 2 to read
  it zone by zone"* was printed unconditionally, including where Detail 2 draws the identical
  building. That sentence is why this was reported three times.

⚠️ Derived from the DATA, not from how many levels the LBS defines — `_vsSetFilledDepth`, computed
once per render from `_actsAll` (not the trade-filtered set: hiding a trade must not disable a
Detail level for the trades still on screen).

## 2. The camera stopped being thrown away on every frame of a drag

Owner: *"whenever i move the progress timeline bar, the view is always returned to default."*
They are right, and it was two faults compounding.

**`renderVStack()` rebuilds every scene from nothing** — the scrubber calls it per frame — and
`_vs3Build` ends with `setView('iso')`. So turning a building to the elevation you care about and
then walking the programme, the two gestures this card exists for, could not be done in the same
breath. There is now a camera memory keyed by the card's own key prefix, **harvested before the
dispose** (a freed renderer's camera is not readable, so reading it after would store nothing and
change nothing) and replayed after the build.

⚠️⚠️ **And `view()` alone was not enough** — this is the half the focus window got wrong too. It
reports the last viewpoint BUTTON pressed, so a camera the planner had *dragged* to their own
angle came back as the nearest preset: the focus window's scrub comment claimed *"the angle the
planner chose survives the scrub"* and it only ever survived for the six presets. `cam()`/
`setCam()` carry the orbit and the zoom.

- ⚠️ **The zoom crosses a rebuild as a RATIO of the model's own default radius**, not as an
  absolute. A stored `r` of 13.8 means "twice as far out as *that* building's default"; applied
  raw to a taller one it is a different framing. Asserted: a camera off a model with `r0` 6.9 at
  2× distance lands at 2× on a model whose `r0` is 16.7.
- ⚠️ **A drag now clears `view`**, so the camera stops claiming a preset it has been moved off —
  otherwise the bar, which now lights itself from the remembered camera, would light a button the
  model is not at. The wheel does *not* clear it: a preset sets the two angles and says nothing
  about distance, so dollying in on the Front elevation is still the Front elevation.
- ⚠️ **The bar's lit button was hardcoded to `iso`**, which is half of why this looked like a
  reset even on frames where the camera had been restored. Three states now: no memory → Iso,
  a remembered preset → that button, a remembered hand-orbit → nothing lit.
- ⚠️ **Not persisted.** A camera is where you are looking right now, not a setting; the module
  documents that a scene starts at Iso and reopening it tomorrow still does.
- **The horizontal scroll is the other half of "the view being displayed"** and applies to the 2D
  card too: six trades side by side are wider than any window, so a scrub that reset the scroller
  took the building being watched off screen. Captured before the `innerHTML`, re-applied after —
  ⚠️ skipped while the entrance animation runs, when the scroller's width is not yet final.

## 3. Planned vs Actual is one camera now, not two

Owner: *"whenever there are view changes on the right, please also change the left (planned)
pane."* The viewpoint bar was emitted **per pane**, and the comment where it sat said that was
deliberate — *"so in compare each building can be turned to a different elevation."* The owner has
overruled that, and they are right for a reason the SVG path already knew: **in 2D compare,
hovering, panning and zooming either pane already drives both.** Two independent cameras made 3D
the one view where the comparison could silently be between a baseline seen from the north and an
actual seen from the west.

So there is **one bar above both panes** — with the cameras locked, two identical bars would have
been two controls for one state — and every gesture on either model drives the other: the six
viewpoints, the orbit, and the wheel.

⚠️⚠️ **`setCam(c, true)` — the silent flag — is load-bearing.** It applies a camera without firing
that scene's own `onCam`, so mirroring A onto B does not immediately mirror B back onto A. Without
it the first drag is an infinite ping-pong between the panes; the scene's `muted` guard implements
it. ⚠️ The handlers are wired **after** the build loop, over every scene at once: bound inside the
loop, the first pane's handler would have been installed before the second scene existed.

## Verified

**Executed, not read.** The depth, the clamp, the empty-level names and the Detail buttons were
sliced out of the shipped file and run: 17 assertions, 0 failing — including that all three
buttons are still emitted when only one is usable, that the disabled button's reason names *Zone*
rather than "locations", and that `_vsDetailNow()` returns 1 (not 2) when no zone is recorded.
`setCam`'s ratio maths was executed the same way, including both clamps.

**The pane linking was run in a real browser**, the shipped `_vsFocusWire3DViews` against two
instrumented scenes and the real two-pane markup:

```
CLICK "Rear" on the shared bar:
   LEFT/planned.setView(rear, silent=true)
   RIGHT/actual.setView(rear, silent=true)      both scenes told: YES
ORBIT the RIGHT (actual) model to az=2.50:
   LEFT/planned.setCam({view:rear,az:2.50}, silent=true)
   LEFT pane adopted az: 2.50
   the right pane was NOT told again (no echo): true
   every mirror call is silent (the re-entrancy guard): true
   lit after a hand-orbit: []
ORBIT the LEFT (planned) model to az=-1.10:
   RIGHT/actual.setCam({view:rear,az:-1.10}, silent=true)   RIGHT adopted az: -1.10
```

The page parses (one inline script block, 0 syntax failures, 0 NUL bytes) and loads to the
sign-in redirect with an empty console. The toolbar was re-rendered in all three bases as a
regression check on the previous entry's cleanup.

⚠️ **Not verified signed in** — the anon key carries no grants, so no WebGL scene was built
against this project's data in this session. What is asserted above is the camera bookkeeping, the
linking logic, the depth derivation and the markup; nothing here claims to have watched a real
building keep its angle through a drag.

### The stacking bar loses a row, and the Fit button it lost was already dead (2026-09-10) — ethanrobles10

Owner: *"cleanup the UI just below the header. i think it is too much. you can remove the Fit
button."*

### 1. The Fit button was not doing anything, and had not been for two weeks

⚠️⚠️ **This is the part worth reading.** `#ps-vs-fit` toggled `_vsFit`, persisted it to
`ps_vsfit`, and re-rendered. All that re-render did with the flag was write two things:

- `is-fit` onto `.ps-vs-stage`, and
- a `--ps-vs-fith` custom property onto `.ps-vs-grid`, measured by a careful two-pass routine in
  `_vsApplyPane` — a body-height cap, then a second correction for the tower card's own header,
  padding and border, with a measured comment explaining that 469px fitted inside a 497px body
  and still scrolled.

**Neither was read by a single CSS rule.** There was no `.is-fit` selector anywhere in this file
and no `var(--ps-vs-fith)` anywhere in this file — grepped over the revision as shipped, not from
memory. So a planner who pressed Fit saw the button light up and the drawing not move.

The clue was in its own tooltip: *"hover a zone and read it in the magnifier"* — the magnifier was
deleted on 2026-09-02. Nothing had exercised the control since, which is how a live-looking button
sat on the bar for two weeks doing nothing. **What actually fits the stack is `--ps-vs-paneh`,
the max-height `_vsApplyPane` writes onto `.ps-vs-pane`; that half IS read by CSS and is
untouched.** Removing the button therefore changes no pixel of the drawing — which is the only
reason it could be removed on a one-line instruction without asking what should replace it.

Gone with it: `_vsFit`, `_saveVsFit`, the `is-fit` class, the whole second half of
`_vsApplyPane`, and the `ps_vsfit` key — swept from `localStorage` on load beside the four
magnifier keys, so a returning browser is not left carrying state for a control that no longer
exists. The **focus window keeps its own Fit** (`#ps-vs-fzfit`): that one is wired to a real
transform and answers a different question, reading one building close up.

### 2. The legend was a paragraph parked in a row of buttons

`.ps-vs-legendnote` was `flex:1 1 100%`, so it **claimed a whole row of the bar** and wrapped
inside it — three sentences of instructions sitting among the segmented controls. Correct when it
held three sentences; it is the reason the bar read as heavy.

⚠️ **Nothing was deleted, it was demoted.** What stays visible is what you read at a glance: which
fill means what, and the three DONE colours — still rendered *in* those colours, because a colour
key written in grey teaches nothing. The two long explanations (how to read a compare cell's
BL/ACT text; what the DONE pill asserts) moved into the item's own `title`, one hover away. The
strip is `flex:0 1 auto` now, and the divider that used to separate it from the activity count is
gone — a rule between two greyed captions, in a bar that still carries five.

Visible legend text, measured on the shipped builder: **176 → 66 characters** in the *actual*
basis, **360 → 87** in *Planned vs Actual*.

### 3. Verified

The `var bar = …` statement was **sliced out of the shipped file and executed** against stubs, in
all three date bases, then the resulting markup dropped into a throwaway harness that loads the
module's real inline `<style>` and the app's real `dashboard.css`, beside the same markup rendered
from `HEAD`. Rows are the count of distinct item offsets, measured in the browser, not counted by
eye:

```
pane width   basis                BEFORE          AFTER
1798px       Actual               2 rows /  65px  2 rows / 58px
1798px       Planned vs Actual    3 rows / 110px  2 rows / 58px
1400px       Planned vs Actual    4 rows / 138px  2 rows / 59px
1200px       Actual               4 rows /  97px  3 rows / 71px
1200px       Planned vs Actual    5 rows / 149px  3 rows / 71px
1000px       Actual               5 rows / 131px  3 rows / 71px
```

Also asserted on the rendered markup: **no Fit button in any basis**, dividers **6 → 5**, no
divider before the count, and the demoted prose present in the `title`. The page parses (one
inline script block, 0 syntax failures, 0 NUL bytes) and loads to the sign-in redirect with an
empty console.

⚠️ **Not verified signed in** — the anon key carries no grants, so the stacking cannot be reached
with data from this session. The claims above are about the bar's markup and layout, which is what
was changed; nothing here asserts anything about the drawing.

### ⚠️⚠️ The floor was drawn at a quarter of its size at Detail 1, because the WRAP GRID was sizing the plan (2026-09-10) — jasantos2

Owner: *"the size of the floor is decreased when proceed with level 1 - detail. Like i said, allow
users to define in the floor plan the size of the floor, and allow users to add shapes for the
different zones."*

### 1. Measured before it was touched
The plate's size in world units was `cols × rows` of the **wrap grid** — the layout used for cells
that have *no* plan — and that grid is derived from the cell COUNT. Four zones at Detail 2 make a
2×2 grid, so the plate was 2 × 2; one cell at Detail 1 makes 1×1, so the same building was drawn
half as wide and half as deep. Executing the shipped builder both ways on the same traced plate:

```
Detail 2 (4 zones): plate 2 x 2
Detail 1 (1 cell) : plate 1 x 1     ← the same plan at 25% of its area
```

The traced plan had nothing to do with that number and was scaled by it anyway. ⚠️ It is the same
class of mistake as the two before it: a value that describes the GUESS was being applied to the
STATEMENT.

**A traced card's plate is a constant now**, and the footprint depends on the plan and nothing
else — not the Detail, not the zone count. ⚠️ An untraced card keeps the wrap sizing, because
there the footprint honestly *is* the zone count on a grid, which is what the footer says it is.

### 2. The floor's proportions, defined where the floor is drawn
⚠️⚠️ **The sheet was fixed at 1000 × 620 and nothing could change it.** Every plan, portrait or
landscape, was traced on the same landscape rectangle — and since outlines cross the module
boundary normalised to 0..1, that rectangle *is* the floor's proportions as far as the 3D is
concerned. A tall site was drawn wide, and no control existed to say otherwise. Now:
- A **Sheet** control in the plan window: *Wide 3:2 · Square · Tall 2:3*, and **Fit to the image**
  when a plan is attached.
- ⚠️ **Attaching an image sets the sheet to the image's own shape** — but only while nothing is
  drawn. Rescaling somebody's trace without being asked is not a convenience.
- ⚠️⚠️ **Changing the sheet RESCALES what is already drawn.** Points are stored in plan units with
  y running 0..h, so raising h without touching them would leave every traced zone bunched
  against the top of the sheet: the drawing would silently stop matching the drawing.
- ⚠️ The stage's aspect is the sheet's, replacing a hard-coded `aspect-ratio:1000/620` that would
  have squashed a re-shaped sheet back into a landscape box and moved every corner with it.
- ⚠️ The sheet's ratio (`ar`) crosses the boundary with the outline, so the 3D plate is as deep as
  the drawing says. A plan traced on a tall sheet now builds a deep plate rather than a square one.

**Adding shapes for the different zones** already works — the zone palette loads the brush, the
nine presets drop a shape, Trace draws one corner by corner — and it is unchanged here. The
**Floor shape** control beside it states the floor's own outline, separately from the zones.

### Verified
**240 assertions across fourteen suites, 0 failing** — 10 new. ⚠️⚠️ The size bug is asserted
against **the revision before the fix, executed**: it draws the same plate at 25% of the area at
Detail 1, and this file draws it identically at both Details. ⚠️ Sanity gates: a tall sheet must
produce a DEEP plate and not merely a different number, a nonsense aspect must fall back rather
than collapse the building, an untraced card must still take the wrap path, and the normalised
points must stay 0..1 on both axes after the aspect is carried alongside them.
⚠️ **Not clicked in the live app**: the anon key has no grants for this project's data.

---

### The card's controls collapse to one Display button, and the fill level gets a line (2026-09-10) — jasantos2

Owner: *"can you simplify the UI, i think too much buttons and information, propose a simplified
UI yet still pleasing to the eye. In addition, how come the progress per zone is removed? pls
bring that back."*

### 1. Twenty-one controls in a row became six and a button
⚠️⚠️ **The control used every few seconds was last, and everything was equally loud.** Four
labelled groups, three dividers, no hierarchy — the bar read as a wall. Now:
- The **six viewpoints stay out in the open**, because turning the building is the gesture this
  card exists for, and **Iso starts lit** (six buttons with none on says the camera is nowhere).
- Everything set once and then left alone — plan wrap, front edge, colour meaning, floor markers,
  Sync — is behind one **Display** button, which ⚠️ **carries a count of how many of them are off
  their default**, so nothing hidden is ever a surprise.
- ⚠️ A `<details>`, not a hand-built popover: it opens and closes itself, is keyboard-reachable
  and screen-reader-labelled for free, and there is no outside-click handler to leak. ⚠️ Its open
  state survives the repaint every control inside it triggers — without that, choosing *Colour ›
  Zone* would slam the panel shut under the planner's cursor. ⚠️ The panel is absolutely
  positioned, so opening it does not push the model down the page.
- The **footer** was six sentences under every card at once, which is how the note that matters
  (positions are a guess; no dimension is implied) stops being read. One line now — what a block
  is, whether the layout is real or guessed, and the schematic warning in short form, which is
  the one sentence this module's rules say may not be hidden — with the standing explanation
  behind **What am I looking at?**. The "everything resolved" line lost its instructions too: it
  was telling a planner where to go at the moment they had already been there.
- In the floor-plan window, the two facts a planner states **once per floor** — which way it
  faces, and the floor's own shape — now share one row instead of owning two.

### 2. ⚠️⚠️ Per-zone progress: the maths never changed, the READING did
Every zone has always filled on its own percentage, and the suite pins it. What changed a week
ago is where the fill goes: a horizontal split across a zone's **width** is tens of pixels wide,
a vertical one inside a storey's **height** is about **two** on a twenty-storey tower. A 60/40
split in two pixels of tone is not a reading — so for the person looking at it, per-zone progress
was gone. That is a real complaint about a real regression, even though nothing in the arithmetic
moved.

**The answer is a line at the fill level**, not a bigger block: a hairline survives any storey
height, and reading a level off a line is what a gauge does.
- ⚠️ **Carved out of the done slice, never laid over it.** Overlapping geometry is what produced
  the striped z-fighting this view had; the zone is still cut into pieces that touch and do not
  intersect — done body, line, remaining.
- ⚠️ A very light tint of the **trade's own hue**, so it is not a fourth colour in the model.
  Measured against both neighbours: **65.0 / 40.3 ΔE** (light theme, vs remaining / done) and
  **53.4 / 28.3** (dark).
- ⚠️ **Pickable but not traced**: clicking it opens the zone like any other part of it, and the
  hover outline stays the zone's shape — a ring round the line as well would read as a division
  the planner had made.

### Verified
**230 assertions across thirteen suites, 0 failing** — 11 new. ⚠️ The bar's shape is asserted, not
eyeballed: six viewpoints out in the open, every other control after the panel's opening tag, no
count on the button at defaults and a count when there is one. ⚠️ The three slices are asserted on
the geometry the builder produces — body, line, remaining, touching, not overlapping, same
footprint, none nudged — and the line is the lightest of the three tones in both themes.
⚠️ **Looked at, for once**: the new bar and footer were rendered in the browser from the SHIPPED
`_vs3Bar` / `_vs3Foot` output against the app's real `dashboard.css`, in both themes, through a
throwaway `_scratch-*` harness (gitignored, deleted after). ⚠️ Still **not clicked in the live
app**: the anon key has no grants for this project's data.

---

### At Detail 1 the floor plan disappeared, and the floor's shape is now a separate question from its zones' (2026-09-10) — jasantos2

Owner: *"how come the progress per zone was removed? in order to show the progress per floor, the
user should make the detail to level 1 so the progress will show per level. In addition, how come
when clicking level 1 detail, the floor plan size disappears? To solve this, in the schedule
setup, can you add an options of defining the shapes of the zones AND for the floors. so that way
we can distinguish the difference between them."*

### 1. ⚠️⚠️ At Detail 1 the traced plan vanished, and the reason is a definition
Detail 1 draws a storey as ONE cell whose label is empty, so no zone can match it. The only thing
that answered for a whole floor was an explicitly drawn `*floor*` outline — a control that shipped
this morning as a swatch at the end of the ZONE palette, which is exactly where a planner reads it
as "another zone". A planner who had traced four zones and no outline got a **guessed box**: the
floor plan's size disappeared the moment they switched to Detail 1.

**A floor with zones and no outline now takes its shape from those zones.** Nobody should have to
draw the same shape twice to see it.
- ⚠️ Every zone polygon, not a union: adjacent traced zones share their edges, and two coincident
  faces pointing opposite ways are back-face culled, so the extrusion reads as one floor plate
  without a polygon-boolean library — and a zone traced away from the others still contributes.
- ⚠️ **The explicit outline still wins.** A podium slab bigger than the zones drawn on it can only
  be stated by drawing it, and that statement must not be overridden by a derivation.

### 2. The two shapes are now two controls
Owner: *"so that way we can distinguish the difference between them."* Right — they are different
in kind, so the outline is **out of the zone palette** and has its own **Floor shape** row, which
says which of the three states this floor is in: *drawn as n areas*, *taken from the n zone areas
you traced*, or *nothing traced yet*.
- ⚠️ The row's swatch carries **the same double duty the zone palette has** — with an area
  selected it makes THAT area the outline, otherwise it loads the brush. One rule for "what is
  this area", two places to say it, and no third gesture to learn.
- ⚠️ **Remove** deletes the outline and says what happens next: the floor's shape goes back to
  being its zones. It cannot leave the plate empty-but-owned — the same `zpDropIfEmpty` every
  other deletion in this window goes through.

### 3. Progress per zone: the rule was right and unstated
I could not reproduce per-zone progress being lost, and the suite now pins it: at **Detail 2** a
two-zone storey at 25% and 75% builds two blocks filled to 0.138 and 0.413 of the storey height,
each extruded from its OWN traced outline; at **Detail 1** the same storey is one block filled to
the floor's own progress. What was missing is that the card never SAID which grain it was drawing
— and an unstated rule is the same thing as a wrong one for the person reading it. The footer now
names it: *"One block = one zone, and each fills on its own progress — switch Detail to 1 to read
a whole storey as a single block"*, and the converse at Detail 1.

### Verified
**219 assertions across thirteen suites, 0 failing** — 16 new. ⚠️ The Detail-1 loss is asserted
against a **control**: the same plate (two zones, no outline) through the last revision of this
file without the change returns **null** — no shape, the box fallback, the bug — and through this
one returns both zones. ⚠️ Sanity gates: the explicit outline must WIN rather than join the zones,
an empty plate must still have no shape, the zone palette must not list the outline, and the two
Details must draw genuinely different things.
⚠️ **Not clicked in a browser**: the anon key has no grants for this project's data, so the window
and the model were verified by execution.

---

### ⚠️⚠️ Every trade was drawn with the FIRST trade's floor plan (2026-09-10) — jasantos2

Owner: *"i think, the defined section for structural is coinciding the defined floor plan and
zoning shapes with other trades … I have defined a new floor plan for architectural and yet this
is being shown."* They are right, and the cause is one line.

### The bug
Zoning is **per trade**: the setup keeps a separate floors/zones tree for each, and a plate is
pointed at a **floor id**, so Architectural's *Level 3* and Structural's *Level 3* are two
different floors that happen to share a name. `zpByLabelOf` — the map that crosses the module
boundary — was keyed by that **name alone**:

```js
[f.name, f.code].forEach(function (lab) {
  var k = zpNormCode(lab);
  if (k && !out[k]) out[k] = shape;      // ⚠️ first trade in cfg.zoning's key order wins
});
```

So the whole project got **one plan per floor name**, taken from whichever trade came first in
the object's key order, and every card drew it. Drawing a new Architectural plan could not change
what the Architectural card showed — it was never being asked for.

### The fix
- The map is keyed **`trade|floor`**. ⚠️ **Aliases are emitted at the source, not matched at the
  other end**: the stacking knows a trade only as the label on an activity ("Architectural
  Works"), this side knows it as a key (`AR`) with two names of its own (GWORK's canonical label,
  GLABEL's short one), so all three are emitted with one normaliser. Two sides each guessing how
  the other spells a trade is the join that already went wrong once in this file.
- ⚠️ **The bare floor key is still emitted — but only when every trade that named that floor
  points at the SAME plate.** It is what a card spanning trades (per tower, consolidated) reads,
  and when the trades disagree there is no honest answer, so it emits nothing and that card falls
  back to the wrap rather than borrowing somebody else's building.
- The card's trade is **derived in `_vsTowerModel`**, not passed in by four call sites: a card
  whose activities are all one trade IS that trade. That is true of the per-trade cards by
  construction, and of a per-tower or consolidated card that happens to hold one trade — which
  should read that trade's plan too. Mixed cards get null.
- ⚠️ **"Not traced" and "traced, but under another trade" are now different answers.** Until the
  map was keyed by trade the second could not be asked — it was silently served as this card's
  plan. The footer says which trade the card is and points at Schedule Setup, because sending a
  planner to draw a plan they have already drawn is the same wasted trip the name-mismatch
  message exists to prevent.
- ⚠️ Counts collapse back to floors: the map now holds one entry per trade per floor, so the Sync
  toast and the footer read distinct FLOOR labels (`_vsZpLabels`) rather than key counts — a
  two-trade, three-floor project reported "plans for 18 floors" for about ten minutes while this
  was being written.

### Verified
**203 assertions across twelve suites, 0 failing** — 22 new. ⚠️⚠️ **HEAD is executed as the
control**: the same two-trade setup (Structural's Level 3 traced left, Architectural's traced
right) is run through the shipped `zpByLabelOf` + `_vsZpFor` from HEAD and through this file's.
HEAD hands **both** cards the same outline — the bug, reproduced — and this file hands each card
its own. ⚠️ Sanity gates: two trades pointing at ONE plate must still answer a card that spans
them; a single-trade project must be unchanged; a floor nobody has drawn must be a plain miss and
not "under another trade"; and a mixed card must get nothing rather than borrowing.
⚠️ **Not clicked in a browser**: the anon key has no grants for this project's data.

---

### Progress fills upward, the striped shading was z-fighting, every storey is named, and the front is an object you place (2026-09-10) — jasantos2

Owner: *"the labels are good, but hopefully there is a label for all floors. Next, for the
progress can you make it that the progress for the 3D version is from bottom to top? not like
horizontal direction. In addition, for the progress, the shades are like unstable or not uniform.
look at the second picture. fix that pls. Also, in the floor plan, remove the front faces etc. I
just want you to add a feature wherein users are just able to place an object and then you would
be able to identify which is the front face of the project."*

### 1. ⚠️⚠️ The "unstable shades" were Z-FIGHTING, and the vertical fill is the same fix
The done stretch was a **second, narrower block sitting INSIDE the dim one**, lifted by a
thousandth of a unit (`+0.002` in y for a traced zone, `+0.001` in z for a block) so it would win
the depth test. Two surfaces that close is the textbook condition for z-fighting: at this camera's
near/far range the depth buffer cannot separate them, so **which one is in front is decided per
pixel and changes as the model turns**. That is the mottled, striped shading in the owner's second
screenshot — not a lighting fault, two surfaces arguing. Four of the six faces of every done block
were coplanar with the block it sat inside.

A zone is now **two disjoint slices stacked in height**: done from the floor of the storey up to
its percentage, remaining above it. Nothing is inside anything, no nudge is needed, no two faces
are coplanar — and the progress reads bottom-to-top, which is what the owner asked for and what a
storey being built actually looks like.
- ⚠️ Both slices carry the **same footprint**, so how far along a zone is no longer distorts the
  plan shape somebody traced. `_vs3PolyMesh` takes a **height and a base** now instead of a width
  fraction, and `_vsClipX` — the Sutherland–Hodgman clip that cut a traced outline at the progress
  fraction — is **deleted**: nothing cuts a zone horizontally any more.
- ⚠️ **A sliver rounds away.** A cell at 0.4% would contribute a slice two thousandths of a unit
  tall: invisible, but it still puts a seam across the zone and costs a mesh. Below 0.006 units it
  rounds to nothing (or, at the other end, to a whole storey).
- ⚠️ **The compare mark turned with the fill.** It was a vertical blade at a fraction of the
  zone's WIDTH — the right reading while progress grew sideways, a meaningless line now. It is a
  horizontal band at the baseline's **height**, so the gap to the top of the bright slice is still
  the slip, measured with the eye.
- ⚠️ The hover trace and the compare edges outline **every slice**, or they would draw a line
  round "the part that is done" and call it the zone.

### 2. A label for every floor
The first cut built ~14 labels and dropped the rest **at build time**, so a floor could not be
named however far you zoomed in. The layer now holds **one label per storey**; the only thinning
is per FRAME, and a hidden label comes back the moment the planner zooms or turns the model.
⚠️ The collision threshold is **17px — the label's own height plus a hairline**, taken from the
CSS rather than guessed: a threshold smaller than the label lets two of them touch, which is the
thing the rule exists to stop.

### 3. The front is an object you place, not a compass you pick
The four N/E/S/W buttons are **gone from the floor-plan window**. The planner drops a marker on
the frontage — the road, the main entrance, the side the building presents — and the **nearest
edge of the sheet is the front**, derived and drawn back on the drawing.
- ⚠️⚠️ **The marker is the input; the compass edge is derived.** Four buttons asked the planner to
  hold a mapping in their head — from "S" to "the bottom of this drawing" to "the side with the
  road on it" — and to keep it straight on a plan the architect may have rotated any way at all.
  Dropping an object asks nothing.
- ⚠️ Stored in **0..1 of the sheet**, and compared as **fractions**: sheets differ in height, so a
  marker in raw units would jump to a different edge when the plan image is replaced, and a raw
  distance comparison would make the short axis win every time.
- ⚠️⚠️ **The legacy field is still read.** Setups saved before the marker exists name their front
  in `front`; ignoring it would silently turn every one of those buildings round. The marker wins
  when there is one, and ⚠️ **Remove clears BOTH** — "removed but still facing east" is the one
  state this pair of fields must never produce.
- ⚠️ Placing is a one-click mode that turns itself off, and it cancels tracing: two pointer modes
  live at once means one click drops a marker *and* a corner. Dragging the marker writes no undo
  step — the marker is not part of the drawing, and Ctrl+Z must step through shapes.

### Verified
**181 assertions across ten suites, 0 failing** — 41 new, all executing lines sliced out of the
shipped file. ⚠️ The z-fighting fix is asserted on the **geometry the builder actually produces**:
at 50% the zone is two boxes, the lower one from the storey's floor to half its height and the
upper one from there to the ceiling, `hi <= lo` between them, the same width and depth, and
neither nudged in x or z. ⚠️ Sanity gates throughout — 0% and 100% must be a single full-height
piece, 3% must still be two, the compare band must move when the baseline does, a marker dropped
at (0.45, 0.35) must resolve by fraction rather than by plan units, and clearing must leave the
front genuinely unset.
⚠️ **Not clicked in a browser**: the anon key has no grants for this project's data, so the model
and the window were verified by execution. The z-fighting itself is diagnosed from the geometry —
two coplanar surfaces a thousandth apart — and fixed by removing the overlap, not by tuning it.

---

### The floor with no zones, the band with no floor, the progress tones, and floor markers (2026-09-10) — jasantos2

Owner: *"how about for floors without levels, there should also be an option for users to edit the
shape of that floor. In addition, look at the colors of the progress of the levels / zones, pls
improve it. Also can you add like a demarcation or floors that show which floor is this etc."*

### 1. ⚠️⚠️ A floor with no zones could not be given a shape AT ALL
Two gates saw to it, and neither was visible from the other: the **Plan** button on a floor row was
only emitted when the Activity level was Zone or Unit (`showZones`), and inside the window the
Add/Trace row was hidden when the floor had no zone codes — because every area had to BE a zone. So
on a **floor-level project**, the one thing a planner could not state about a storey was its shape,
and the 3D drew a box. Both gates are gone.

- **A reserved code, not a second kind of polygon.** `*floor*` is stored, moved, reshaped,
  coloured, copied, undone and saved by exactly the code that already does all of that for a zone.
  ⚠️ The stored code and the DISPLAYED label ("Whole floor") are deliberately different strings: a
  readable sentinel could collide with a zone a planner actually named.
- ⚠️ It is in the palette **always**, **last**, and **is not a zone**: the "not drawn" list, the
  `Plan n/m` count and everything else that counts zones skips it. A floor with no zones now reads
  **Shape…** / **Shape ✓** rather than "Plan 0/0".
- ⚠️⚠️ The 3D uses it **only for a storey whose row is a single cell**. On a floor split into four
  zones, extruding the outline four times would stack four identical slabs in one place and call
  them four zones — the suite asserts that this does not happen.

### 2. The band that has no floor
The Vertical Stacking draws work whose activities carry no floor as a row of its own, and nothing
could give that row a shape because it has no row in the setup to hang one off. It now has a
reserved **pointer** (`of.nolev`), ticked in the plan window's *Also use this plan elsewhere…*.
- ⚠️⚠️ It crosses the boundary under a **protocol key** (`*nolevel*`), not under the band's display
  text. `VS_NOLEV` is the words printed on the row ("— No level —") and is free to be reworded, at
  which point a map keyed by it would silently stop matching. Both sides name the constant and
  point at each other. The suite asserts the lookup **misses** when only the display text is there.
- ⚠️ Read straight off the bag, never through `zpIdFor`: a synthetic `{ id: 'nolev' }` falls through
  to that function's `kind:` fallback and would report the typical floors' plate as the band's — a
  tick nobody put there.
- ⚠️ The band now counts in the footer's "n of m storeys" **only once it has a plan**, so it neither
  drags the verdict down nor gets told it matches nothing after the planner has drawn it.

### 3. The progress colours, measured rather than adjusted
⚠️⚠️ **The defect was the dark theme, and the light theme is why nobody saw it.** Remaining was
`colour × 0.42` — one walk toward black, whatever the model stood on. Measured against the dark
card it sits on, those tones are **9.5 ΔE** from the background: two shades of the same grey, on
the part of the model that is most of a live project. The same rule measures **69.6** on the light
theme.

So the two tones are **placed**, not derived by arithmetic on the fill. Hue and saturation stay the
trade's; lightness moves — light theme: done is the trade colour exactly, remaining is it at 45%
lightness; dark theme: done is **lifted** off the ground (×1.35, held in 0.55–0.76) and remaining
**dropped but floored** (×0.70, held in 0.26–0.38). ⚠️ The clamps are the point, not the
multipliers: a trade colour that is already near-black and one that is already pale must both land
on the two rungs, or the pair that needed help most is the pair that does not get it.

| measured over 16 palette colours | before | light | dark |
|---|---|---|---|
| remaining vs its background (min ΔE) | 9.5 dark / 69.6 light | 67.6 | **23.2** |
| trade separation in the remaining tone (mean ΔE) | 37.2 | 47.5 | 60.1 |
| done vs remaining (min ΔE) — the progress read | 27.5 | 26.0 | 28.5 |
| trade hue drift | 0° | **0°** | **0°** |

⚠️ **And the lights were clipping the model white.** Lambert shades a face by
`colour × (ambient + directional × NdotL)`; a top face — most of what the Top and Iso views show —
has NdotL 0.768 against this light. At 0.72 + 0.55 that is **1.143**, so every channel above 223
pinned to 255 and the brightest trades lost their hue on exactly the faces a planner looks down on.
0.58 + 0.48 puts the same face at **0.949**, and the directional share is *larger* than before, so
the extruded outlines have more form rather than less.

### 4. Which floor is this
A **slab under every storey** and a **label naming it**, with a `Floors · Labelled | Plain` toggle
in the 3D bar (default Labelled).
- ⚠️ The slab is **wider than the plate** (×1.04): one sized to the zones above it is hidden by them
  from every angle except dead level, which is the one angle this view is rarely at. The overhang
  is what turns a column of floating blocks into storeys. One geometry and one material for the
  whole tower, and **not in `picks`** — a slab must not swallow the click meant for a zone.
- ⚠️ The labels are **HTML, not sprites**: crisp at any zoom, on the app's type scale and theme,
  readable by a screen reader, and free to build. They are placed from the **projected** geometry
  each frame — pinned to whichever plate corner is currently leftmost, at *that corner's* height,
  not the mean of the four (under perspective the mean floats the label off its storey).
- ⚠️ **Thinned, never stacked**: ~14 labels on a forty-storey tower, always including the top and
  the bottom, and any label landing within 14px of the one above is dropped for that frame.
  Overlapping labels are worse than none — they misname floors. The grade line is named too.
- ⚠️ Removed on dispose: the layer is DOM this scene added, and a repaint would otherwise leave a
  full set of floor names behind per rebuild.

### Verified
**140 assertions across eight suites, 0 failing** — 52 new, every one executing lines sliced out of
the shipped file (`_vs3Build` runs against a stub three.js whose Color is the real colour maths, so
the tone assertions are not vacuous). ⚠️ The colour work is **measured against a control**: the old
rule is executed on the same sixteen palette colours, and the table above is its output, not a
description of it. ⚠️ Sanity gates throughout — the band must MISS when only its display text is in
the map; a two-zone storey must extrude the outline zero times; `Plain` must build no slabs and no
labels; the "no outline drawn" case must extrude nothing at all.
⚠️ **Not clicked in a browser**: the anon key has no grants for this project's data, so the window,
the tones and the labels were verified by execution, not by opening them.

---

### Tracing over another floor, front/rear on the drawing, zone colours, and a hover trace in 3D (2026-09-10) — jasantos2

Owner: *"For uniformity of the sizes of the floor plans … when editing other floors, is there an
option to show the overview of the other floor plans and trace it from there? but the overview from
other floors should not be editable. Also pls add the option of defining from the floor plan which
is the front, which is the rear. Also can you add option for colors. As well as when hovering over
the zones in the vertical stacking 3D, can you show like a trace of the zone to distinguish it."*

### 1. Trace over another floor — a ghost, not a layer you can edit
A **Trace over** picker in the floor-plan window draws another floor's outlines underneath the one
being edited, and **Copy these here** lands them as ordinary shapes when two floors should match.
- ⚠️ **It cannot be edited, by construction, not by discipline.** The ghost carries no ids, no
  handles, no `data-zpoly`, and `pointer-events:none` sits on the group *and* the polygons — so a
  click passes through it to the real shape underneath rather than selecting something that is not
  there. It is drawn **below** the real shapes, so the floor being edited always reads on top.
- ⚠️ **Deduped by PLATE, not by floor.** A plan shared across forty storeys is one drawing; offering
  it forty times would bury the two references that genuinely differ.
- ⚠️⚠️ **Every plate in the project, not only this trade's.** Plates are shared through one `of` map
  keyed by floor id, but the first cut only walked `cfg.zoning[tr].floors` — so a planner tracing
  the Structural storeys could not see the plan drawn under Architecture, which is exactly the case
  where "make the floors uniform" matters. Cross-trade entries are labelled with their trade.
- ⚠️ Absent entirely when no other floor has a drawing: an empty picker is a question with no
  answers. The copy skips the height correction when the two sheets are the same height — `420 /
  620 * 620` is `419.99999999999994`, and a feature about uniformity must not introduce a
  difference of its own.

### 2. Front and rear, defined ON the drawing
**Front faces** — N/E/S/W with the plain-language edge beside each (`N · top`), the nominated edge
drawn in red on the sheet and the derived rear dashed opposite it.
- ⚠️ **One field, not two.** The rear is the opposite edge, derived — storing both would allow a
  building whose front and rear are the same side.
- ⚠️ **Not defaulted to a compass point.** "Nobody has said" and "somebody said South" are different
  answers; the 3D card falls back to its own preference only for the first.
- ⚠️⚠️ **The plan wins, and the 3D card's own buttons go inert** with a note saying where the answer
  lives. Two live controls for one fact is how a planner ends up believing the building faces two
  ways. And it turns the building: `_VS_TURN` states which edge each camera quarter-turn actually
  shows, and both the elevation NAMES and the camera POSITION derive from it, so choosing North
  cannot rename the buttons without moving the camera.

### 3. Zone colours
A colour swatch in the row that already asks which zone this is, and a **Colour · Trade | Zone**
toggle in the 3D bar.
- ⚠️⚠️ **Keyed by zone CODE, project-wide** — not per plate and not per area. `Zone 1` is the same
  zone on every storey, and a colour that changed floor by floor would be unreadable in the one
  view the colour exists for.
- ⚠️⚠️ **The automatic hue is now a HASH of the code, not its index in a list.** The index version
  answered "where does this code sit among *this floor's* codes", so `Zone 2` was the second hue on
  a floor listing four zones and the third on a floor listing five — same zone, two colours, one
  storey apart, and nothing outside that window could reproduce either. A hash answers the same for
  every caller.
- ⚠️ What is stored is an **override**; its absence is a real answer, and **Auto** restores it.
- ⚠️ **Colour by zone is opt-in and off by default**, because it spends this card's primary channel.
  The rule since the card shipped is *fill = trade · brightness = done · edges = slip*, and quietly
  repainting the fill would break the view whose job is comparing trades. It falls back **per
  cell**: a zone the plan does not name, and every cell of a trade-split card, keeps its trade
  colour.
- ⚠️ The colour crosses the module boundary **with the outline**, resolved in the builder where the
  bag is owned — the stacking view asks what colour a zone is and gets one answer.

### 4. Hovering a zone in 3D traces it
- ⚠️⚠️ **`depthTest` is off, deliberately.** From most angles a zone sits behind two or three other
  storeys, and an outline that respected the depth buffer would be hidden by exactly the geometry
  it exists to pick out. Ignoring depth draws the trace **through** the building. It is also why
  the trace is a LINE and not a brighter fill — a fill drawn through the model reads as a block
  floating in front of it.
- ⚠️ Built from the zone's **own mesh geometry**, so on a traced floor it is the shape the planner
  drew and on an untraced one it is the block — never a bounding box. Only the remaining-body mesh
  is traced: the done stretch is clipped to a fraction of the zone, and outlining it would outline
  "the done part" rather than the zone.
- ⚠️ Rebuilt **on change**, not per `pointermove`; one raycaster serves the hover and the click, so
  the card cannot outline one block and open another; the readout carries storey, zone, percent,
  count and finish, and a drag drops the trace rather than fighting it.
- ⚠️ The readout is a DOM node the scene appends, and **dispose removes it** — every repaint of
  this view disposes its scenes, so without that a planner switching basis a dozen times would
  collect a dozen tooltips.

### 5. ⚠️⚠️ A bug in this batch's own first half, found by executing it
`zonePlanFetch` began returning `{ byLabel, front }` so one fetch could carry both facts. The
cold-open path was moved to the new shape; **`_vsZpSync` was not** — it kept reading the answer *as*
the map. `Object.keys` then counted the two property names, so **Sync reported "read the floor
plans for 2 floors" on every project, including ones with nothing traced**, and every lookup
missed. The suite runs the same input through the pre-fix text and reproduces exactly that.

### Verified
**86 assertions across five suites, 0 failing**, every one of them executing lines sliced out of
the shipped file — the colour model and what crosses the boundary, the Sync read (with the pre-fix
text as the control), the reference picker, the elevation derivation, the 3D bar's markup, and
`_vs3Build` itself run against a stub three.js: the pick, the trace, the readout, the drag, the
click and the clean-up. ⚠️ Each suite carries a **sanity gate** — the no-colour config still
answers automatically, a bare project offers no references, the three colour runs are not one
answer — so a green run cannot be green for the wrong reason. ⚠️ The suites slice **by name**, not
by line number: in a 43k-line file a line-numbered slice goes stale on the next edit, and it fails
as a syntax error that reads as if the code under test were broken.
⚠️ **Not clicked in a browser:** the anon key has no grants for this project's data, so the window
and the model were verified by execution, not by opening them.

---

### ⚠️⚠️ The floor plan never reached the Vertical Stacking at all, and a Sync button (2026-09-10) — jasantos2

Owner: *"can't there be a button that allows syncing the floor plans to the 3D? and nothing is still
being shown in the vertical stacking 3D."*

### 1. ⚠️⚠️⚠️ The guard could never pass
This module is **one IIFE** — `(function () {` at the top of the script, `})();` at the bottom — so
`var ScheduleBuilder = (function () {…})()` is a **closure local**, and `window.ScheduleBuilder` is
never assigned. `_vsZpAll` tested `window.ScheduleBuilder`.

**So it returned `{}` unconditionally.** The traced floor plan has never reached the Vertical
Stacking — not in 3D, not in 2D, not once since the feature shipped. Every fix in the last two turns
(the detail-3 label join, the 2D order-and-width layout, the cold-open fetch, the three-way footer)
was correct and sat behind a condition that is false by construction. ⚠️ Every **other** consumer of
`ScheduleBuilder` in this file already used `typeof ScheduleBuilder !== 'undefined'`; these two
readers were the odd ones out, and I wrote the second of them last turn without checking the first.

⚠️ **Why the harnesses did not catch it:** they slice `_vsZpAll` and run it in a context where the
bridge is *provided*, which answers "does the map get built" and not "is the bridge reachable from
here". The new suite executes it in a context shaped like the real one — a `window` object that
exists and does **not** carry `ScheduleBuilder` — and **HEAD returns `{}` on the identical input**,
which is the whole bug, reproduced.

### 2. Sync floor plans
A **Sync floor plans** button in the 3D bar, next to Plan columns.
- ⚠️ It clears the **memo and the asked-flag**, or it would respect the very cache the planner is
  pressing it to bypass — a button that does nothing.
- ⚠️ **It always says what happened.** Synced and drawn, *n* of *m* storeys, a plan found that
  matches no storey, or nothing found at all — with the empty case naming where to draw one **and
  to save the setup**. A silent button looks broken.
- ⚠️ The verdict comes from **`_vsPlanFit`, the same function the footer prints**, read *after* the
  repaint — so the toast and the note under the model cannot contradict each other.
- ⚠️ **A card with no storeys is not accused of a name mismatch.** `_vsPlanFit` reports `nomatch`
  for an empty card too (nothing matched, because there was nothing to match), and telling a planner
  their floor names are wrong when the card simply has no rows sends them to fix nothing.
- ⚠️ Wired in **both** places the 3D bar is drawn, and the full-screen window rebuilds **itself** —
  repainting the card behind it would leave the model the planner is looking at untouched.

### Verified
**767 assertions across fourteen suites plus the runtime and extrusion checks, 0 failing** — 29 new.
⚠️⚠️ **The control is the point**: the same `_vsZpAll`, the same inputs, executed against HEAD,
returns `{}`; against this file it returns the plan. A structural assertion now also forbids any
**code** reader going through `window.` — while deliberately still allowing the comment that
explains the bug to quote it, because a test that banned the string would push the explanation out
of the file.
⚠️ **Not verified signed-in.** `zonePlanFetch` is a real query and the anon key has no grants, so the
database round trip still has not run. What is proved is that the plan now reaches the card once the
bridge answers.

`MODULE_V` → `20260910v2`.

### The 3D card could not see the floor plan unless the Setup tab had been opened (2026-09-10) — jasantos2

Owner: *"i want to use that defined floor plan and apply it to the vertical stacking 3D? it is not
reflecting? how do you make it reflect."*

⚠️⚠️ **The plan lives in the Schedule Setup config, and `ScheduleBuilder` only holds a config once
the Schedule Setup tab has loaded one.** That caveat was already written down — at
`_adoptSetupGrouping`, for the grid's default grouping — and I never carried it across to the
stacking. So the normal way of working broke it: trace the zones, save, reload, open Vertical
Stacking. `cfg` is `null`, the bridge returns `{}`, and the card quietly falls back to the guessed
layout. Nothing errored and nothing said why.

### 1. The stacking loads the saved setup itself
A new `ScheduleBuilder.zonePlanFetch(projectId)` reads the `schedule_builder` row directly when the
builder holds nothing.
- ⚠️ **It does not touch `cfg`.** Assigning the fetched config would hand the builder a setup nobody
  opened, which `isDirty()` and `save()` would then reason about as if the planner had been editing
  it. The config is used to build the map and thrown away.
- ⚠️ **Most recently updated wins**, matching `pickDefaultSetup` — the card and the setup tab have to
  agree which setup is *the* one, or they would draw different buildings. ⚠️ An older setup is tried
  when the newest holds no plan, which beats guessing next to a plan the planner knows they drew.
- ⚠️ **One implementation of the map.** `zpByLabel()` is now a one-line wrapper over `zpByLabelOf(c)`,
  so the in-memory path and the cold-open path cannot index the plan two different ways.
  `zpByLabelOf` resolves the floor→plate pointer from the **passed** bag, never from `cfg`.
- ⚠️⚠️ **Asked is recorded even when the answer is empty.** Marking the project only on success would
  make a project with no plan fetch, repaint, find nothing and fetch again — on every repaint,
  forever. An empty answer also does **not** repaint: that would be a flicker for nothing.
- ⚠️ A repaint clears the **memo** only, never the fetched map, or every basis switch, zoom and
  filter change would re-read the same rows.

### 2. ⚠️⚠️ And the footer now says WHICH of three things is wrong
There are three ways the plan fails to reach the card, and the footer was printing *"attach a floor
plan"* for all of them — including the case where the plan exists and is fine:
- **none** — nothing traced, or nothing saved → attach and trace one.
- ⚠️⚠️ **nomatch** — a plan exists, but **not one storey resolves to it**. Almost always the floor's
  Code/Name in the setup is not what the activities carry as their level, so the two never join.
  The footer now says the plan **is** traced, prints **both sides** of the join — *"filed under
  `GF, F2`… this card's storeys are `Ground Floor, 2nd Floor`"* — and names the field to fix. Telling
  a planner to draw a plan they have already drawn is the least useful thing that line could say.
- **partial** — some storeys matched; it says how many and names the rest.

### Verified
**738 assertions across thirteen suites plus the runtime and extrusion checks, 0 failing** — 45 new.
The map is **executed against a deliberately empty live `cfg`** (the cold open itself): keyed by
floor name *and* code, polygons back in 0..1, the per-**kind** plate resolving on this path too, and
a config whose plate is missing yielding `{}` rather than reading the live one. The three footer
states are executed, including the un-levelled band not counting as a failed match and the
four-name cap.
⚠️ **The controls run on HEAD**: it had no fallback at all, and its footer printed the same "attach a
plan" line for every case.
⚠️ **Three suites needed their slice lists extended, not their expectations changed** — splitting
`zpByLabel` and adding `_vsPlanFit` meant harness12, harness13 and harness15 were slicing half a
call graph. ⚠️ While doing it I **replaced two stubs with the real functions**: both suites had been
stubbing `_vsPlanDefined`, and now link the real `_vsPlanFit`/`_vsZpFor` with only `_vsZpAll` — the
leaf that reads the builder — controlled.
⚠️ **Not verified signed-in, and this change is the one that most needs it**: `zonePlanFetch` issues
a real query against `schedule_builder`, and the anon key has no grants, so **the fetch itself has
never run**. The map it builds is proved by execution; the round trip to the database is not.
**That is the first thing to try** — trace a plan, reload the page, open Vertical Stacking in 3D,
and check the footer says *"drawn as you traced them"* rather than either guess sentence.

`MODULE_V` → `20260910v1`.

### Snap to grid, and the traced layout finally reaches the Vertical Stacking (2026-09-10) — jasantos2

Owner: *"can you add snapping to grid. also how come the zones defined are not shown in the vertical
stacking? meaning the layout?"*

### 1. Snap to grid
A **Snap** control in the plan window — Off / 10 / 20 / 25 / 50 / 100 — with the grid drawn under the
shapes, remembered between sessions.
- ⚠️ **The grid is in PLAN UNITS** (the sheet is 1000 across), not pixels, so it is the same grid at
  any zoom, on any screen, and after the drawing is re-uploaded at another resolution.
- ⚠️ **Off is a real setting.** Tracing an as-built survey means putting the corner where the drawing
  puts it, and a grid of 1 is not the same promise as no grid.
- ⚠️ **Snapped *then* clamped.** Clamping first and snapping after can push a corner back off the
  sheet by up to half a step — which is how a zone ends up hanging over the edge of its own plate.
- ⚠️⚠️ **A MOVE snaps the box origin, not each corner.** Snapping every point independently would
  **deform** the outline as it travelled: an L-shape dragged across a coarse grid slowly becomes a
  different L. The offset is snapped instead, so the shape stays rigid and still lands on the grid.
- ⚠️ Changing the grid does **not** re-snap what is already drawn — that would silently rewrite a
  trace the planner had placed exactly.

### 2. ⚠️ A defect found by driving it: grid-*placed* is not grid-*sized*
Adding a preset with the grid on put its **origin** on a gridline and left the far edge at 527. Two
zones added side by side did not meet, which is most of the reason to want a grid. A **new** shape
has no history to preserve, so every corner is snapped — unlike a move. ⚠️ A coarse grid can collapse
a small shape's features onto one line, so the snapped ring is taken **only if it is still a ring**
(no coincident neighbours, real area); otherwise the shape keeps its proportions and only its
position snaps. All nine presets now land fully on the grid with no feature lost, and the fallback is
proved live, not dead code.

### 3. ⚠️⚠️ Why the zones were not showing — two causes, both proved by execution
**Neither was a rendering problem. The layout was being computed and then not found.**

- ⚠️⚠️ **The 2D card never read the floor plan at all.** `_vsTowerSVG` had no reference to it of any
  kind — and 2D is the **default view**. The zones were traced, and the card that almost everyone
  looks at ignored them completely. That is the owner's question, exactly.
- ⚠️⚠️ **Even in 3D the join only held at Detail 2.** At detail 3 and deeper `_vsRowCells` builds the
  cell label as a location **path** — `Z1 · Unit A` — and the plan stores **bare zone codes**, so the
  match found nothing and every outline silently vanished the moment a planner went one level
  deeper. The matcher now tries the whole label, then each segment **left to right**, which is the
  axis order — so a unit that happens to share a zone's name can never outrank the zone.

### 4. What an elevation can honestly say about a plan
The 2D card is a **section**, so it cannot draw a floor plan — two zones front and back of each other
occupy the same place in an elevation. Claiming otherwise would be the worse error. What it now takes
off the trace are two facts that *are* real in an elevation:
- **ORDER** — zones run left to right as they do on the drawing (by area-weighted centroid), instead
  of alphabetically. ⚠️ This is why `Z10` used to sit between `Z1` and `Z2`.
- **WIDTH** — each zone is as wide as its share of the traced floor **area**, so a big zone reads big
  and a service core reads small. ⚠️ Area is the **shoelace** area of the real outline, not the
  bounding box: an L-shaped zone wrapping a core covers far less floor than its box claims.

⚠️ **It degrades rather than losing zones.** No plan, or a plan naming none of this storey's zones →
`null`, and the equal-share path below is byte-for-byte what it always was. A zone the plan does not
name **keeps its cell** at the mean traced width, after the traced ones. A zone traced in two pieces
is one cell with its areas summed. A zero-area trace cannot sort to `NaN`.

### 5. ⚠️ A second defect found by testing: the minimum width did not hold
Every cell carries a date, so a tiny zone still has to be readable. Raising a thin cell to the floor
and **then** renormalising to fill the row pushes it straight back under — a 2%-of-floor service core
came out at 74px where the floor was 90px. Replaced with **water-filling**: pin the cells that would
fall short *at* the minimum and share what is left among the rest, iterated because pinning one cell
shrinks the pool. The row still tiles the plot exactly, with no gap and no overflow.

### Verified
**693 assertions across twelve suites plus the runtime and extrusion checks, 0 failing** — 67 new, in
a suite that **executes** the snapping, the ring test, the label join and the layout: the order that
disagrees with the alphabet, the area proportions, the L-shape sized by real area, the two-piece
zone, the pinned minimum, and every degenerate case returning `null` rather than a scrambled row.
⚠️ **The controls run on HEAD and show the reported bug**: at detail 3 HEAD finds nothing, and HEAD's
2D tower has no plan reference at all.
⚠️ **And the window was driven in a browser** — the grid control and its 79 drawn lines, all nine
presets landing fully on grid, a move that snapped **and** left the shape undeformed, a corner
snapping to (140,100), and Off dropping the grid and landing the corner exactly where released.
⚠️ **`vscheck` had to be taught to link module-level `var`s**, because the 2D tower now reaches
`_vsZpMemo` through the new path. It links the module's **own declaration** — never a stub — and it
is restricted to **module level**: allowing any indentation matched the function-internal
`var above = …` inside `_vsTowerModel`, so the outage control still failed but for the wrong reason.
Re-proved against that control: broken **0/10**, fixed **10/10**.
⚠️ **The reversal proof in harness12 is retired, deliberately and not because it went red.** It
asserted `_vsTowerSVG` was unchanged, which this change makes false on purpose. It was never the
load-bearing check — reassembling a whole function makes every variable resolve by construction,
which is why it once passed while the view threw `below is not defined`.
⚠️ **I overwrote the module file with a render harness mid-turn** (it writes to `argv[2]`, and I
passed the source). Nothing was lost — the pre-patch snapshot plus the patch scripts rebuilt it
byte-identically — and the harness now **refuses** any output path that is not a `_scratch*` file.
⚠️ **Not verified signed-in** — the image upload still has never run against the real bucket.

`MODULE_V` → `20260910u3`.

### The floor plan window gets tools: shapes, undo, clipboard, and naming the zone (2026-09-10) — jasantos2

Owner: *"if there is no floor plan, how do i add shapes or create shapes? and how come this is the
only interactable things to do in the window. please add options where i can add different shapes,
undo, copy paste of shapes, defining which is zone 1 2 etc."*

⚠️ **The question is the defect.** Yesterday's window could do exactly one thing: trace a polygon
corner by corner over an attached image. With no image there was nothing to click, and the answer to
*"how do I add a shape"* was *"you can't"*. Tracing is the right tool for a scanned plan and the
wrong one for everything else — a planner who knows the plate is a rectangle should not have to
click four corners to say so, and one who has no drawing yet should not be locked out.

### 1. Nine presets, drawn by the same function that draws the menu
Rectangle, square, L, T, U, triangle, trapezoid, hexagon, circle — placed at 34% of the plate,
centred, and selected on arrival so the next gesture acts on the thing just added.
- ⚠️ **Verbatim from the equipment site plan**, like the rest of this window, so the two screens
  cannot drift into offering different shapes under the same names.
- ⚠️ **`zpThumb` calls `zpPreset`**, so the menu icon is *the shape*. A menu that draws its own
  icons can advertise an outline the button does not produce; this one cannot.
- ⚠️ A kind listed in `ZP_SHAPES` with no `case` in the switch falls to the default and silently
  draws a **rectangle**. The suite compares every kind against the rectangle, so adding a name
  without adding its outline fails a test instead of shipping a lie.

### 2. Undo is a SNAPSHOT, and the suite derives what it must cover
⚠️ A handful of short point lists costs nothing to deep-copy, and an operation log would need a
correct inverse for **move, reshape, add-corner, remove-corner, re-assign, paste, delete** — seven
chances to corrupt a drawing. Snapshots have one. Pushed *before* the change, capped at 50, reachable
by **Ctrl+Z** wherever the focus is.
- ⚠️⚠️ **The test is derived, not quoted.** It scans the window's own `W.draft.X =` assignments and
  requires every field found to be inside the snapshot. Quoting the snapshot line would pass forever;
  this fails the day someone adds a mutable field and forgets it — which is the day a planner's work
  starts vanishing on undo.
- ⚠️ The keydown listener is **removed on close**. Left on the document it would undo into a closed
  window's state on the next screen.
- ⚠️ **Undoing back to nothing drops the plate** — a third `zpDropIfEmpty` site. Without it, undoing
  your very first shape leaves an empty plate behind and the floor row still reads *"has a plan"*.
  That is the same rule that already covers deleting the last area and removing the image.

### 3. Clipboard, and naming the zone
Copy / Paste / Duplicate / Delete, each dead when it cannot act.
- ⚠️ The clipboard is a **deep copy**, so editing the original cannot reach through and change what
  is pasted, and a paste **lands offset** rather than hiding exactly under its source with no visible
  effect. A pasted shape takes a **new id**, or the copy and the original would be one shape.
- The zone palette does **double duty**: with nothing selected it reads *"Draw as"* and sets what the
  next shape will be; with a shape selected it reads *"This area is"* and **re-assigns** it. That is
  the owner's *"defining which is zone 1 2 etc."* — and re-labelling a shape no longer means deleting
  and re-drawing it.

### 4. The gestures that have no button, now stated
Drag an area to move it, drag a corner to reshape, the faint dot between two corners **adds** one,
**Alt**-click a corner removes it. All four existed; none was written down. ⚠️ The empty state also
now says the image is **optional** — *"you can draw the zones without one"* — which is the sentence
whose absence produced the owner's question.

### Verified
**104 assertions in the plan suite, 27 new, all passing**, plus the runtime check (10) and the
extrusion suite (12). The presets are **executed**, not read: nine kinds against their bounding
boxes, the square and circle ignoring the height they are handed, the circle's 24 segments, the
unknown kind degrading rather than throwing, and every thumbnail rebuilt from `zpPreset` directly.
⚠️⚠️ **And the gestures were driven in a browser, which is the only reason they are claimed here** —
a preset added with **no plan image at all** (the owner's case), a move that translated by exactly the
drag delta, a reshape that moved one corner and left the others untouched, a midpoint dot that took a
rectangle to five corners, an Alt-click that took it back to four, copy/paste at a real offset, and
four undos stepping back through duplicate → paste → re-assign → the plate disappearing entirely with
Undo then disabled.
⚠️ **Five assertions needed retargeting**, named rather than quietly adjusted: the share refusal moved
from a rendered message to a toast that also **un-ticks** the box, the `zpDropIfEmpty` count went 2→3,
the remove-image confirm now says *"drawn"* rather than *"traced"* (areas need not be traced any
more), the empty prompt gained a `!W.drawing` condition, and the tip line bolds `<b>Alt</b>`. Every
property is unchanged or stricter.
⚠️ A second window cannot stack on the first — the modal backdrop is `position:fixed; inset:0`, so the
Plan button behind it is unreachable. Checked because a harness that called the opener twice *did*
produce two toolbars.
**Whole set: 627 assertions across eleven suites plus the runtime and extrusion checks, 0 failing**
— each suite run against the baseline it was written for, which for two of them meant exporting the
real parent commit rather than reusing a kept snapshot. ⚠️ Three suites did not run, and the reasons
differ: **harness2** is broken by the concurrent change-order refactor (`_CO`), **harness6** needs a
BOQ file this repo does not contain, and ⚠️ **harness14 is OBSOLETE** — it tests the zone-plan *grid*
that harness15 replaced yesterday, and I left it lying around instead of retiring it. Two assertions
in harness3 stay outside its scope filter for the same change-order reason.
⚠️ **Not verified signed-in.** Storage is stubbed, so **the image upload still has never run against
the real `site-plans` bucket** — unchanged from yesterday, and still the first thing to try.

`MODULE_V` → `20260910s5`.

### The floor plan: attach the drawing, trace the zones on it (2026-09-10) — jasantos2

Owner: *"instead of doing this method for defining the zones / areas, i want a pop up window or space
dedicated for attaching images (like the floor plan) and tracing the zones or areas, similar to the
one in the equipment loading. and then that floor plan will be identified for a specific floor. Now
there will be options if that floor plan can also be applied to other floors."*

The cell grid shipped yesterday is replaced, and the owner is right that it should be. A grid could
say *"Zone 1 is the left third"*; a traced plan says where Zone 1 **is**, on the drawing everyone on
site already works from.

### 1. Modelled on the equipment site plan, closely and on purpose
⚠️ Following that module rather than inventing something means the two screens behave the same way,
and it is why **no new migration is needed** — the `site-plans` bucket already exists:
- polygons in **virtual plan units** (0..1000 across), never pixels, so a trace survives a re-upload
  at another resolution, another screen and a zoom;
- the **image is a path** in that bucket; only the path goes in the setup, never the picture;
- the shapes **do not move with the image** — the fade slider dims a backdrop under a trace that is
  already right.
⚠️ One deliberate difference: the image goes **straight into an `<img>`**, not fetched to a blob
first. The equipment plan does that round-trip because it reads pixels back out of a canvas to detect
towers, and a cross-origin image taints one. Nothing here reads pixels, so the extra fetch would be a
second download of a large scan for nothing.

### 2. One plate, many floors, BY REFERENCE
`plate` holds the drawings and `of` maps a floor id onto one — so *"also use this plan on other
floors"* is a **pointer**, and re-tracing updates every floor that shares it. ⚠️ Copying would give a
forty-storey tower forty divergent copies of one drawing, and the first re-trace would leave
thirty-nine stale. A floor that already has its own plan is flagged before ticking replaces it.

### 3. Nothing is lost from yesterday
⚠️ A grid plate is **migrated** on read: one rectangle per painted cell, same position, same size.
The per-**kind** bag survives too — its floors cannot be resolved at normalize time (that runs before
the towers do), so it is parked under a reserved `kind:` pointer that `zpIdFor` resolves on open.

### 4. ⚠️⚠️ Three defects found by DRIVING it, not by reading it
- **Deleting the last traced area left an empty plate** in the setup with floors still pointing at
  it. That is the exact rule I wrote down for the grid version and failed to carry over: *"no plan"*
  and *"a plan holding nothing"* became two states that look identical to a reader and different to
  every consumer — the floor row said `Plan 0/2`, `zpUsers` counted it, `zpByLabel` skipped it. An
  empty plate is now dropped, and its pointers with it. ⚠️ An **image-only** plate survives, because
  attaching the drawing and tracing it later is the normal order of work.
- **The "No plan attached" prompt showed through the traced shapes** — a screen plainly in use still
  telling the planner it was empty. It appears only when there is nothing at all to look at.
- **A zero-area clip reached `ExtrudeGeometry`.** Clipping a square at t=0 returns four points, all
  on x=0: a valid-looking ring with no interior. The mesh builder tests the **shoelace area**, not
  the point count — which also catches a planner who traced three points in a straight line.

### 5. The 3D card extrudes the real outline
⚠️⚠️ **And the progress split stays hard-edged on a traced shape.** The 2D cell draws the done
stretch as a bar growing from the left; on an arbitrary outline the equivalent is the polygon
actually **cut** at that fraction — Sutherland–Hodgman against one vertical edge, ~15 lines, exact.
Colouring the whole zone by percentage instead would have replaced a hard edge with a tint and lost
the channel.
- ⚠️ **One builder (`zoneMesh`) serves both paths**, so the compare edges, the baseline mark, the
  registry and the picking are written once and cannot drift between a traced floor and an untraced
  one. A zone the plan does not name keeps its wrap slot — a half-traced plan degrades.
- ⚠️ A zone **traced in two pieces** becomes two shapes in one extrusion: an area split by a core is
  drawn as it was traced.
- ⚠️ The compare **edges copy the rotation** too. A traced slab is laid down with `rotation.x = -π/2`,
  and edges built from its geometry but left unrotated would float above the tower at ninety degrees.
- ⚠️ **`_vs3PlateOf` is deleted, not left dead.** It compared per-storey grid sizes and would have
  thrown on the new shape (`/^(\d+)x(\d+)$/.exec('undefinedxundefined')` → null → `m[1]`). A trace
  normalised to 0..1 needs no agreement between storeys, so that whole class of fallback is gone.

### Verified
**779 assertions across thirteen suites plus the runtime check, all passing** — 77 + 12 new.
The plan suite executes the model, the grid migration, the share-by-reference and the garbage
collection; a separate suite executes `_vs3PolyMesh` against a recording stand-in for three.js and
checks the geometry it builds: the outline mapped to world XZ and centred on the plate, the extrude
depth, the lay-down rotation, the done stretch as a real cut, two pieces in one extrusion, and every
degenerate case building **no** mesh.
⚠️ **And the window was driven in a browser** — attach, trace (closing both by *Finish* and by
clicking the first point again), select, delete, share, and the refusal when there is nothing to
share. All three defects above came from that, not from the code.
⚠️ **Five assertions across harness12 / harness13 needed retargeting**, where this change rewrote the
exact lines they described (the plate sizing, the cell share, the centres, the done stretch, the
compare mark). The properties are unchanged; named rather than quietly adjusted.
⚠️ **harness2 and two assertions in harness3 remain broken by the concurrent change-order refactor.**
⚠️ **Not verified signed-in** — Supabase storage is stubbed in the harness, so **the upload path has
never run against the real bucket**. That is the one thing to try first: attach a plan on a real
floor and confirm the image comes back on reopen.

`MODULE_V` → `20260910a`.

### The zone layout: where each zone SITS, defined per floor type (2026-09-09) — jasantos2

Owner: *"the pre-requisites for the 3D to be established is to define the location of the zones and
areas. in the schedule setup, in the step of defining the floors, i believe step 4. the setup of the
zones and floors should be established there per floor or type (type is the basement, podium /
commercial, typical, roof deck)."*

Until now a floor's zones were an **ordered list and nothing more** — which is why both stacking
cards drew them as equal slices: that was genuinely all there was. This is the missing half.

### 1. The model: `cfg.zonePlan`
A coarse plan grid, `{ cols, rows, cells: { "r,c": zoneCode } }`, held in two bags:
`kind` (basement / podium / typical / roof) and `floor` (per-floor overrides). `zpFor(floor)`
resolves the floor's own plate first, then its type's, and **returns null when neither exists** —
which is what lets every consumer say *"no layout defined"* rather than draw an invented one.

- ⚠️⚠️ **Per type first, per floor only where it differs**, which is the owner's own framing. A
  forty-storey tower has four or five distinct plates, not forty; `kind` already groups them and is
  the grouping every other per-level setting here uses (see `actLinksKind`).
- ⚠️⚠️ **A grid, not a polygon, deliberately.** A polygon needs a plan image, a scale calibration
  and a drawing tool; a grid needs two numbers and some clicking, and it answers the question the
  stacking views actually ask — *which zone is where, and roughly how big*. It gives relative
  position and relative area. It does **not** give dimensions, and nothing downstream implies it
  does — the editor and the 3D footer both say so.
- ⚠️ **Keyed by zone CODE, not zone id.** `cfg.zoning` is per trade, so a zone id exists only inside
  one trade's copy of the building — but a floor has one physical shape. Keying on the code
  (normalised) lets one plate serve every trade that names its zones the same way, which is the
  normal case. A plan per trade would be the same drawing eight times, and would let two trades
  disagree about the shape of one slab.
- ⚠️ `zpNorm` **drops a stored cell outside its own grid**, so shrinking a plate and growing it back
  really does forget. `zpNormAll` drops an unknown *kind* but **keeps an unknown floor id** — a kind
  is a closed vocabulary, a floor id may belong to a floor that has not resolved yet, and dropping
  it would delete a planner's layout on a round-trip.

### 2. The editor, in Floors & Zones
Type tabs (only for types this trade actually has, each showing its floor count and a ✓ when a plate
exists), an **Applies to** scope, a grid size, a palette of that type's zone codes, and a paintable
plate. Plus a legend with each zone's cell count and a warning naming any zone **not placed yet**.

- ⚠️⚠️ **The plate is created only when a cell is actually painted**, and in exactly one place.
  Arriving at the step, switching type or nudging the grid all leave the setup untouched — that is
  what keeps *"no plate yet"* true. A plate emptied of every cell is **removed**, so "no plate" and
  "a plate with nothing on it" are not two states that look identical.
- ⚠️ Zones are told apart by **shade of the trade colour**, never by hue: hue means *trade*
  everywhere else in this module, and spending it here would make one channel say two things. The
  code is printed in the cell as well, so the shade never carries it alone.
- ⚠️ A drag **repaints once at the end**, not per cell — this step re-renders the whole floors list,
  and doing that per mouseover of a 12 × 12 grid is unusable. `mouseup` is caught on the *document*,
  so releasing outside the grid still ends the drag.

### 3. ⚠️⚠️ Two defects found by DRIVING it in a browser, not by reading it
Both concerned the per-floor override, and both made the planner's own layout look **lost**:
- **Picking a floor with no override drew an empty grid** — even though its type's plate was in force
  for it. It now **shows that plate** as the starting point, says so on screen (*"showing the Typical
  plate — paint to give this floor its own"*), and the first paint creates the override as a
  **deep copy plus the edit** rather than wiping it.
- **"Use the type's plate" left the editor on that floor's now-deleted scope**, so it reported *"no
  plate yet"* over an empty grid while the type's plate sat there intact. It returns to the type's
  scope, which is the only thing that sentence can honestly mean.

### 4. The 3D card reads it
`ScheduleBuilder.zonePlanByLabel()` is the one thing that crosses the module boundary, keyed by
**floor label** — because the stacking view knows a floor only as the label on an activity's
location, and the matching belongs on the side that owns `cfg`. Deep-copied on the way out: a caller
that mutated a plate would be editing the planner's setup from another module.

- ⚠️ **Memoised per render** and cleared where every other per-render accumulator is. Forty storeys
  × eight trades would otherwise re-cross the boundary and deep-copy every plate hundreds of times
  for one repaint.
- ⚠️⚠️ **One plate is drawn per tower, so a mixed answer must fall back.** `_vs3PlateOf` returns the
  shared size only when *every* storey drawn agrees; a podium at 4 × 3 and typical floors at 2 × 2
  cannot both be right, and squashing one onto the other would misreport both. A storey with **no**
  plate counts as a disagreement.
- ⚠️ Per cell, the zone is placed by **its own label** — so Zone 2 sits where the planner put Zone 2
  rather than second in the wrap. A cell the plate does not name **keeps its wrap slot**, which is
  why a half-painted plate degrades instead of losing zones.
- A zone painted across several cells is **drawn across them**, centred on its own footprint.
  ⚠️ An L-shape becomes the **box around it** — the editor says so in as many words rather than
  leaving it to be discovered.
- ⚠️ The footer now says **whose** layout is on screen: the planner's, or a guess with the route to
  fixing it. The schematic warning stays either way — a layout gives positions, not dimensions.

### Verified
**770 assertions across twelve suites plus the runtime check, all passing** — 79 new. The zone-plan
suite executes `zpFor` / `zpBox` / `zpNorm` / `zpNormAll` / `zpByLabel` / `zpPaletteFor` and the 3D
side's `_vs3PlateOf` / `_vsZpBox`, sliced from the shipped file: type vs override resolution, the
L-shape's box, the round-trip sanitising, the asymmetric kind/floor-id rule, the deep copy, and the
agree/disagree/no-plate cases for the shared plate.
⚠️ **And it was driven in a browser**, which is where both defects above came from: painting,
erasing, switching type, creating and removing an override, and the "creates nothing until painted"
property all read back off the live DOM.
⚠️ **Three suites needed retargeting, not fixing**: two of harness12's assertions described the
plate/centre lines that this change edits (the property is unchanged and better), one of harness14's
tracked `paint()`'s *shape* rather than its property, and two harness contexts needed
`_vsPlanDefined`. Named rather than quietly adjusted.
⚠️ **harness2 and two assertions in harness3 are still broken by the concurrent change-order
refactor** (they slice `splitPlan` / `splitBuild`, which now delegate to `assets/js/co-insert.js`).
Named again rather than dropped.
⚠️ **Not verified signed-in** — the anon key has no grants. The editor was exercised against the
shipped functions in a real browser, but nothing was saved to a setup and no project has been pushed
with a layout defined, so the 3D card has not yet been seen reading a real one.

`MODULE_V` → `20260909x`.

### I broke Vertical Stacking, and the proof I trusted could not see it (2026-09-09) — jasantos2

Owner, with a screenshot of the live view: *"where is the 3D? and how come there is an error, no
vertical stacking now."* The view read **"The Vertical Stacking could not be drawn for this project.
below is not defined."**

### ⚠️⚠️ 1. What I broke, and why my verification missed it
Yesterday's refactor lifted the level ordering out of `_vsTowerSVG` into `_vsTowerModel`. That region
declares `above` and `below` — and the **drawing code still reads both** (a basement row is styled
from `below`, the grade line from where `above` ends). The model kept them and handed back only
`byLevel / levels / disp / groundAt / detail`, so the renderer threw `ReferenceError: below is not
defined` on **every** project. Not a corner case: the whole card, every scope, every basis.

⚠️⚠️ **And I had "proved" that refactor correct.** The proof reversed the transformation and diffed
the result against HEAD statement for statement. It passed — and it was worthless for this class of
bug, *by construction*: reversing the extraction reassembles the whole function, so every variable
resolves inside it no matter what the shipped scope looks like. **A textual-equivalence proof cannot
see a ReferenceError.** I checked that the code was the same and never checked that it still ran.

Two checks now exist so this cannot recur:
- **`vscheck.js` — it RUNS the shipped renderer.** On a fabricated tower, on all three bases, plus
  the trade-split path, asserting it returns SVG rather than throwing. ⚠️ Its dependency resolver is
  the part that makes it honest: on a `ReferenceError` it slices the **real** function of that name
  out of the module and retries, and if the name is **not** a function there it **refuses to stub it**
  and stays failed. Auto-stubbing everything would have made this pass on the broken file — worse
  than no check. Verified both ways: on the broken file it fails 10/10 and prints
  `REFUSED TO STUB: below`; on the fixed file it passes 10/10, having linked 29 real functions.
- **A static orphan check** in the suite: every variable the model declares, minus the ones the
  renderer destructures back, must not appear anywhere in the renderer's remaining body.

### 2. Where the 3D is
It was already there — the **`2D | 3D`** pair sits in the Vertical Stacking toolbar beside Detail,
with **2D the default**. The owner could not see it because the view threw before the toolbar drew;
nothing was missing but the render. No change was needed for that part of the ask.

### 3. Planned vs Actual, in 3D
⚠️ The 2D cell's rule is recorded and it is followed here rather than reinvented: **compare keeps the
trade colour**, because replacing the fill with the slip colour once turned every building into greys
and reds and the trades became unidentifiable. So the same three independent channels:
`FILL` = the trade · `BRIGHTNESS` = done vs remaining · `EDGES` = the slip.
- The slip rides `LineSegments` built from the **block's own geometry**, so it cannot drift from the
  block, coloured by the 2D card's own `_vsSlipColor`.
- The **baseline's mark** is a thin slab at the planned fraction, protruding slightly so it reads
  from the elevations and not only from above. ⚠️ Absent when there is no baseline — a mark at 0
  would claim "nothing was planned by now", which is a different statement from "nobody baselined
  this". Clamped to its own cell, and pickable, so clicking it opens the cell rather than nothing.
- The footer names these channels **only under compare**: naming a channel that is not being painted
  teaches a planner to look for something that is not there.

### 4. Full screen, in 3D
The focus window builds the model now. `_vs3FocusBuild` mirrors `_vsFocusBuild` deliberately — basis
swapped around the call and restored in a `finally`, `_vsCells` snapshotted — so a modal build cannot
leave the main view's cell map on a basis the main view is not drawing. Under compare it is **two
models side by side**, each with **its own viewpoint bar**, which is how you check whether baseline
and actual differ on the side you care about.
- ⚠️⚠️ **`_vsFocus.panes` is left empty in 3D, and that is the mechanism.** Every SVG-only routine in
  that window already begins `if (!F || !F.panes.length) return;`, so the pan, the zoom, the fit and
  the cross-pane hover sync go inert on their own instead of needing a flag threaded through each.
- ⚠️ **Zoom, the zoom label and Fit are not emitted at all in 3D** — they describe an SVG that is
  sized and translated, and a canvas orbits and dollies instead. Leaving three dead controls on
  screen is the looks-live-does-nothing failure this log keeps recording.
- ⚠️ **A crash this created and the suite caught:** not emitting them means
  `wrap.querySelector('#ps-vs-fzfit').onclick = …` dereferences null, and the focus window would
  not open **at all**. Every optional control is wired defensively now.
- ⚠️ **Full screen RESIZES the canvas.** A WebGL drawing buffer and a camera aspect are numbers set
  once; without it a fullscreened model keeps drawing at the windowed size in the corner of a much
  larger box. On the second frame, so the box has settled before it is measured. And the mount is
  given a real height — a canvas contributes nothing back to its parent, so `height:auto` measures 0
  and the pane renders black.
- ⚠️ **The as-of scrubber rebuilds the scenes** (a scene is geometry; there is no node to swap),
  **disposing the old contexts first** — a browser caps WebGL contexts and silently kills the oldest,
  so dragging across a year would otherwise blank the model half-way — and it **keeps the viewpoint**
  the planner chose, because losing it every frame would make the scrubber useless.
- The window's scenes are a separate list from the cards' own, so closing it frees only its own.

### Verified
**479 assertions across eleven suites plus the new runtime check, all passing** — 22, 36+11+5, 39+6,
35, 46+28, 123, 97, 54, 77, 54, and vscheck 10.
⚠️ **harness2 and two assertions in harness3 are still broken by the concurrent change-order
refactor**, not by a defect: they slice `splitPlan` / `splitBuild` out of this file and those now
delegate to a `_CO` global from `assets/js/co-insert.js`. Named again rather than quietly dropped.
⚠️ **A `sed` prefix match nearly shipped collateral damage**: bumping `20260909u` also rewrote
`dashboard.css?v=20260909u2` and `icons.js?v=20260909ui` into `…v2` / `…vi`. Caught by reading the
diff before committing, and reverted. A version bump must match the whole token.
⚠️ **Not verified signed-in** — the module page redirects to sign-in for the anon key, so the fix is
proved by executing the shipped renderer (all three bases, plus the trade-split path) rather than by
loading the live view. The 3D focus window and the compare channels have not been drawn in a browser
this turn; that is the first thing to check on the next pass.

`MODULE_V` → `20260909v`.

### Vertical Stacking gains a 3D view, and the 2D card is proved untouched (2026-09-09) — jasantos2

Owner: *"i was thinking of establishing a 3D view of the 2D vertical stacking that is already
established. Meaning the pre-requisites is defining the section plan and how the layout of the zones
and areas are. As well as defining from the top view, which is the front, right side, left side and
rear elevations."*

### 1. ⚠️⚠️ ONE MODEL, TWO RENDERERS — and the 2D card is proved untouched
`_vsTowerModel` is the level ordering, the grade split and each row's cells, **lifted verbatim** out
of `_vsTowerSVG`. Two renderers deriving their own level order is how a project ends up with a 3D
view that puts the 5th floor somewhere else than the 2D view of the same data, with no way to tell
which is right.

⚠️ The 2D Vertical Stacking card is the view the owner reads daily, and this moved 28 lines out of
the middle of its renderer. So it is **not** verified by sampling an input: the suite **reverses the
refactor** — puts the moved statements back, restores the caller's early return and the `rowCells`
closure — and asserts the result equals HEAD's `_vsTowerSVG` **statement for statement**. That holds
over *every* input, which no fixture could. Two consequences worth recording:
- ⚠️ **No re-indent.** Both functions are declared at the same depth, so the statements moved exactly
  as they were — which is also what makes the reversal a pure text swap rather than a judgement.
- ⚠️ The model returns **null** for "nothing to stack"; the message is the 2D card's own markup and
  the 3D card has its own. The model owns no HTML.

### 2. The prerequisites, and what they honestly are
The schedule holds a floor's zones as an **ordered list** — `{ id, code, name, units }`, no polygon,
no coordinates, no area. So the plan is the planner's own two statements, not a survey:
- **Plan columns** — how the zones *wrap* in plan, which is what turns `Zone 1…4` into a 2×2 plate
  instead of a 1×4 strip. Auto is a wide-ish grid (`ceil(√n)`), because that is how a plan is drawn.
- **Front faces N / E / S / W** — which edge of that plan is the **front** elevation. ⚠️ Right, rear
  and left are **derived** by rotation, never stored: four separate fields could contradict each
  other, and a building cannot have two fronts. Asserted for all four choices.
That is enough to place every zone relative to every other and to name the four elevations — and
**not** enough to state a dimension or an area. The card says so on screen.

### 3. ⚠️⚠️ ONE FOOTPRINT FOR THE BUILDING — two flaws only measurement found
Both of these looked entirely plausible on screen:
- **Per-storey grids made a 2-zone floor draw half the width of a 4-zone floor.** Ragged, and false:
  a floor with two zones has the *same* plate, cut differently. Found by *rendering* it.
- **A storey whose cells did not fill its grid left a HOLE.** Three cells in a 2×2 covered
  three-quarters of the plate — `4.5` of `6`. Found by asserting the covered **area**, not by
  looking: the ragged version was unremarkable to the eye.
So the plate is sized once from the busiest storey, and `_vsPlanSlots` spreads a storey's `n` cells
over at most `plate.rows` rows, each cell taking the full share of its own row. That **tiles the
plate exactly for any n** — asserted for every cell count on every plate up to twelve zones.

### 4. The rest of the card
- ⚠️ **The same three channels the 2D cell uses**, so the two cards cannot say different things:
  colour = the trade, brightness = done vs remaining, height = the storey. The done stretch grows
  from the cell's left edge exactly as the 2D solid bar does.
- The **grade plane** sits at the model's own `groundAt`, and the un-levelled band stays translucent
  here as it is dashed there.
- ⚠️ **One drill-down.** `cellKey` lives in the model, so the 3D card composes the identical
  `keyPrefix|level|cell` string and clicking a block opens the *same* panel `openVsCell` opens.
  Each renderer registers what it drew, with the same pure helpers.
- Six viewpoints — **Front / Right / Rear / Left / Top / Iso** — computed from the front edge, plus
  drag to orbit and scroll to zoom. ⚠️ Orbit is two angles and a radius rather than `OrbitControls`:
  the r128 examples loader is a second script to keep pinned for no gain here. The elevation is
  clamped just short of vertical, where `lookAt` has no defined roll and the model flips.

### 5. three.js, and the costs of having it
- ⚠️ The **same pinned r128** Progress Photos already ships (its 360° viewer and point-cloud
  reconstruction both load it), reusing that exact URL. Two three.js builds on one site is a real
  hazard — two `THREE` globals, whichever script wins — and Progress Photos' own test asserts the
  revision.
- ⚠️ **Lazily loaded, on first use.** ~600KB, and the Project Schedule opens on the grid; every
  planner who never opens the 3D card would otherwise pay for it on every page load. An in-flight
  load is shared, an existing tag reused, a failed load clears the cache so a retry can work, and
  the failure message says the **2D view needs nothing and still works**.
- ⚠️⚠️ **Every repaint frees its WebGL contexts.** A browser caps them (~16) then silently kills the
  oldest — so without `_vs3Reset()` at the top of `renderVStack`, a dozen basis switches would leave
  a screen of blank models and a clean console. Each scene forces context loss and drops its own
  handlers.

### What this is NOT
No zone outlines, no dimensions, no areas, no cross-section drawing, no imported geometry. The
owner's *"cross-sections of the plans to define the zones"* would need geometry the model does not
carry — a plan image per floor type, a polygon per zone, and a decision about whether geometry is
shared across trades or per trade (`cfg.zoning` is per trade, deliberately). That is a separate
piece of work with a storage decision in it, and this card is honest about standing in front of it.
⚠️ The **PDF export path still renders 2D**, untouched.

### Verified
**732 assertions across eleven suites, all passing.** The 73 new ones execute `_vsPlanGrid`,
`_vsPlanSlots`, `_vsElevOf/_vsElevLabel`, the pref round-trip and the plate arithmetic, and prove
the refactor by reversal. Controls: HEAD had the ordering inline, no model function, no `data-vs3d`,
no `_vsTowerBody`, no `WebGLRenderer`.
⚠️ One of my own controls was wrong rather than the code, for the third time this week: `THREE.` as a
"HEAD has no 3D" control matched the prose *"NOT THREE."* in a comment. **Grepping a 39k-line file
of prose-rich comments for a bare English word is not a control** — it measures the changelog.
⚠️⚠️ **And the card was actually drawn, orbited and picked in a browser**, loading the real pinned
three.js: the storeys stack, the plate is uniform, the grade plane sits below the un-levelled band,
Top gives a plan, and a click opened `TW:Tower A|2nd Floor|Zone 3` — the exact key format the 2D
card registers. Picking was checked from all six viewpoints; the only pixel that opens nothing is
the **dead centre of the front elevation**, which is the 6% gap *between* two plan columns — correct,
since there is no single zone there, and 8px either side lands on a block. That was confirmed rather
than assumed after the first test made it look like a broken raycast.
⚠️ **Not verified signed-in** — the anon key has no grants, so this ran against a fixture model in a
git-ignored page, never inside the module with a real project's activities loaded. The model itself
needs no browser proof (see the reversal), but the 2D↔3D toggle, the mount pass and the dispose path
have not been exercised against live data.

`MODULE_V` → `20260909a`.

### A stray NUL byte made this changelog un-greppable (2026-09-09) — fmlozano

Found while adding the entry below: this file carried **one NUL byte** (0x00) at offset 39,939, and
plain `grep` answers `Binary file modules/project-schedule/CLAUDE.md matches` instead of the matching
line. On a 107 KB changelog that is the module's primary history, that is a real papercut — you had
to remember `grep -a`.

**The prose had lost nothing.** The NUL sat *inside a quoted code literal*:

> `dimKey` returns the same `'<NUL>'` sentinel `tower` uses on a single-tower project

`dimKey` genuinely returns `'\u0000'` (`index.html:34259`), and that file's **own comments write the
sentinel as the escape** (`:26605`, `:26616`). So the entry was correctly quoting a real NUL sentinel
— whatever wrote it interpolated the *character* instead of the escape *text*. Repaired to `\u0000`,
which both preserves the meaning and matches the code's wording verbatim. One byte became six
characters; the line count is unchanged.

- ⚠⚠ **WRITING THIS ENTRY REPRODUCED THE BUG, TWICE.** The two places above that name
  the sentinel came out as real NUL bytes, because the text was written through a tool that
  interprets escape sequences -- exactly what happened to the entry being repaired. Caught by
  re-scanning the entry before committing it. **When you need the six characters of an escape in
  prose, build them from character codes and verify the bytes afterwards**; do not type the escape
  and trust the write. Same family as the heredoc-escape traps already recorded in this repo.
- ⚠️ **`git grep` was never affected, and an earlier statement of mine said it was.** Git sniffs only
  the **first 8000 bytes** for binary content and the NUL was at ~40 KB, so `git grep` always treated
  this file as text. GNU `grep` scans the whole buffer, which is why the two disagreed. Worth knowing
  before chasing "grep says binary" as a git problem.
- **Swept the whole repo**: 287 tracked text files (`.md .js .css .html .sql .json .txt .webmanifest
  .yml .yaml`), and this was the **only** one. Now zero.
- ⚠️ **Introduced by `d496488` (2026-09-08)** — bisected across the file's last 25 commits;
  `bb8e239` immediately before it is clean. Same family as the scripted-write traps this repo already
  records: a value interpolated as a character where the escape text was meant.
- ⚠️ **FOUND AND DELIBERATELY LEFT: `index.html:34282-34283` quotes the same sentinel as `' '` — a
  literal SPACE (0x20, verified in the bytes), not the NUL.** *"buildTree only creates a node when
  `dimKey()` is not `' '`, and `dimKey` returns `' '` for exactly the cases dimName returned null
  for"* — both wrong about a sentinel defined 23 lines below them. Almost certainly the same mangling,
  normalised to a space rather than to a NUL. Not fixed here **because the repo's own rule bumps
  `MODULE_V` on any change to a module's `index.html`**, and paying an app-wide cache-bust plus a
  conflict on a file another session is actively editing, to correct two words in a comment with no
  behavioural effect, is the wrong trade. It is recorded here so the next reader of that comment does
  not trust it — fix it when something else in that file is being changed anyway.

No `MODULE_V` bump: markdown only.
### A CO Ref column that unlocks a bulk edit already written, select-by-location, and the bulk change-order insert (2026-09-09) — fmlozano

Owner: *"There is already a function to add change order in the activities within the schedule module
this just needs to be integrated in the wizard and in a bulk manner in case that the CO/EOT affects a
lot … we can also expand that idea for both the wizard and in the schedule app by selecting affected
activities based on the location and optional to add other activities in the schedule as well."*
Reads the new `cc_affected_activities` table — see
[`modules/contracts-claims/CLAUDE.md`](../contracts-claims/CLAUDE.md) for the register's half.

### ⚠️⚠️ A bulk edit that was fully built and had no door

`fillDown(field, srcRow)` has carried a dedicated `change_order_ref` branch since it was written: it
filters the selection to `isExecPhase`, reports how many it skipped and explains the refusal with
`_phaseWhy`. `_FIELD_LABELS` names the field. `_CELL_META_BY_LABEL`'s own comment says *"marking a run
of activities as one change order is exactly the bulk edit these columns exist for."*

**None of it had ever run.** `fillDown` is reachable only from a grid cell's `data-field`; the Scope
cell emits `data-field="scope_type"` and renders the ref as a read-only `.ps-coref` span; and a
repo-wide search for `data-field="change_order_ref"` returned nothing. So the feature existed, guarded
its own edge cases, and was unreachable.

**A `Change Order Ref` column is the door.** Right-click → *Fill Change Order Ref down (N)* and Ctrl+D
now work on a multi-row selection, which is how one variation gets stamped across a whole floor.

- ⚠️ **Setting a ref does NOT change the row's scope**, deliberately — the same contract `promptCoRef`
  has always kept, writing `{ change_order_ref }` and nothing else. `scope_type` says whether the row
  **is** change-order work; the ref says **which** variation it belongs to, and a main-contract
  activity legitimately cites the CO that affected it. Inferring one from the other would silently
  reclassify main-contract work as a variation on the strength of a bulk fill-down.
- ⚠️ **Execution phase only, and not editable elsewhere** — the same rule `scopeCellHtml` applies, so
  the column cannot quietly acquire a value that means nothing.
- ⚠️ **Appended to `GRID_COLS`, not inserted** — a saved column sort/order is **positional**, and
  inserting mid-list re-points it at a different column. Verified the row emits exactly 26 cells for
  26 built-in columns, with `c-coref` 26th and emitted last, or every dynamic column would shift.
- The enum reuses **`coSelOpts`** — the same builder the details panel and `promptCoRef` use — so the
  registered change orders, the "not in the register" warning and the ordering cannot disagree
  between the three places a ref can be set. `_colText` includes the register **description**, so
  filtering the column on "plumbing" finds the activities under a CO numbered "CO 01": a planner
  remembers what the variation was, not its number.

### Select activities by location (Actions menu)

⚠️⚠️ **A SELECTOR, NOT A SECOND BULK-EDIT ENGINE, and that is the whole design.** It resolves a place
to activities and loads them into `_selSet` — the selection every bulk action in this file already
reads through `_selectedTaskRows()`. So fill-down, copy, cut, actualize dates and delete all apply to
the result with **no new apply path, no second set of permissions and no second set of bugs**.

⚠️ Global Change could not have done this job: `GC_FIELDS` addresses plain row fields and `gcMatch`
reads `r[field]` directly, while `location` is a jsonb map — it cannot see a place at all.

- Values are grouped by `locNormKey`, so `2ND FLOOR` and `2nd Floor` are **one** place with a `×N`
  badge. Measured: three spellings of one floor collapse to one entry gathering all 18 rows.
- ⚠️ **It says how many are off screen.** `_selSet` resolves against `rows`, not the displayed list,
  so a bulk action legitimately reaches an activity the current filter hides — correct, and alarming
  to discover afterwards. The dialog counts them before you commit.
- ⚠️ `selId` is set to the first selection so the context menu has an anchor: without it,
  right-clicking to reach Fill-down resets the selection to the row under the cursor and throws the
  whole set away.
- ⚠️ Three different reasons there may be no levels, and only one is the planner's to fix — `LOC_LOAD`
  is exactly that distinction, and claiming "no breakdown" while the read is pending or refused is a
  failure this module has already shipped once.

### The bulk change-order insert

⚠️⚠️ **IT REUSES `splitPlan` AND `splitBuild` UNMODIFIED** — proven by the diff, which contains six
`+` mentions of them and **zero** deletions. They are pure functions that return data and write
nothing, which is precisely what makes a whole-run **preview** possible: 23 hosts can be planned,
shown and then applied. Re-deriving those dates would be a second copy of the one calculation a
change-order claim turns on.

⚠️⚠️ **And it lives here, not in Contracts & Claims**, for the same reason: the arithmetic is here,
and this app owns schedule writes. The register records **which** activities a variation touches;
inserting the work is this module's job.

- **One preview table for the whole run**, replacing `applySplit`'s per-host `confirm()`. Twenty-three
  confirmations is not an interface, and a planner clicking through them cannot see the total time
  impact they are agreeing to.
- ⚠️ **All three refusal classes are LISTED with their reason, never skipped**: no dates, a 1-day
  activity (there is no point inside it), and a host **already citing this reference** — so re-running
  after a partial failure cannot give one host the same change order twice. A *different* ref on the
  host is not refused: an activity genuinely can be hit by two variations.
- The cut is a **rule**, not a date, because one date cannot fall inside 23 different spans. *At each
  activity's midpoint* is the default and, being what `openSplitDialog` itself defaults to, is
  **always valid** — asserted across every duration from 2 to 40 days, 0 refusals. *On one date* is
  offered and refuses per host where it falls outside.
- ⚠️ **Change-order rows first, host patches second** — the same recoverable order `applySplit` uses.
  If the inserts fail every host still reads as it always did; if the patches fail the change orders
  exist and are visible. The reverse leaves hosts finishing later with nothing in the gap to explain
  why. `created_by` is stamped, because `project_schedule_ins` requires it. Host patches go through
  `_batchUpdate`, whose `failedIds` are reported as *"somebody else imported this schedule, so their
  rows are not yours to change"* rather than as a generic failure.

### ⚠️⚠️ The defect that would have corrupted data: 23 activities sharing an Activity ID

`splitBuild` uses `co.ref` as the new row's id when one is given, and `splitFreeId` checks the
candidate against `rows` **only** — which never grows during a run, because nothing is written until
the end. So every host under CO-014 would have been handed the id **`CO-014`**. Activity IDs are what
predecessor strings reference, what the schedule↔document links key on and what these new
affected-activity links key on, so it would have broken three separate things **silently**.

`_bulkFreeId` threads a `taken` map through the run and checks both it and `rows`. **The contrast build
proves the fix is what matters**: reverting that one condition fails exactly the three id-uniqueness
assertions and nothing else. The suite also runs the shipped `splitFreeId` as a control and asserts it
returns the same id five times — which is correct for one insert, and is why the allocator exists.

### Affected marker and filter

A quiet chip on a leaf row naming the records recorded against it (capped at two references plus a
count — an activity re-touched by six variations over two years is real and would push the name off
the row). ⚠️ **A marker, not a scope change**: the row is still main-contract work. `filters.aff`
narrows the grid to one record's set, so *"what does CO-014 touch?"* is answerable from the Gantt;
WBS and group rows pass through, the same rule the critical-path and scope filters use.

⚠️ **`'Claim'` joined the register fetch**, since the wizard offers the step for all three
raised-against types — harmless to everything else, because `coRegistered()` still filters to
`record_type === 'Change Order'`.

⚠️ `AFF_BY_ACT` is cached and depends on `CC_AFFECTED` and `CONTRACT_RECS` **only, not on `rows`** —
it is keyed on `activity_id` and `affectedOf(r)` looks the row's own id up in it — so the single
invalidation beside the fetch is sufficient. An earlier version of that comment claimed it depended on
the rows, which was wrong and is corrected in place.

### Verified

`node --check` on the extracted 2.7MB inline script; **0 duplicate DOM ids introduced** — ⚠️ that gate
caught the duration input carrying the same id in both branches of the cut-mode ternary (only one
existed at runtime, but two branches sharing an id is how a `getElementById` starts reading the wrong
box after an unrelated edit), now emitted once; the 26-column/26-cell alignment; and 54 slice-and-
execute assertions with three contrast builds. Reads of the new table are tolerant in exactly the way
the register fetch beside them is: no table, no grant or an un-run migration leaves an empty list and
a schedule that behaves precisely as it did before.

⚠️ **Not verified signed in.** No bulk insert has been applied, no ref filled down and no marker
rendered against a real project; the migration has not been run, so `cc_affected_activities` reads as
absent and every one of these surfaces reports "nothing recorded yet".

`MODULE_V` → `20260909co`.
### Excel's selection model, and a grip instead of Move buttons (2026-09-08) — jasantos2

Owner: *"for the multiple selection, can you adapt similar to excel wherein if multiple selection,
you must hold ctrl and then click to select another row. And also instead of having buttons to move
up and move down, there should be a menu icon on the left, to allow smooth rearrangement."*

### 1. Excel's rules, exactly
`libSelClick` takes a modifier object now instead of a `shift` boolean:

- a **plain click replaces** the selection with that row. ⚠️ It used to *toggle*, which is what let a
  selection accumulate quietly while a planner thought they were only reading rows — and then
  *Group* acted on all of them.
- **Ctrl** (or **Cmd**, so a Mac behaves the same) toggles one row and keeps the rest.
- **Shift** takes the range from the anchor and **replaces**; **Ctrl+Shift** adds it.
- ⚠️ The **anchor does not move** on a shift-click, so shift-clicking again re-picks the range from
  the same start. That is what makes a range adjustable instead of ratcheting outward.
- ⚠️ Shift still walks the **rendered** order, never `cfg.activities`: the planner selects what they
  can see, and the two orders differ the moment anything is grouped.

### 2. The grip, and the buttons that are gone
Every re-arrangeable row carries a **≡** grip as its **first** element — before the level chip, so
the grips line up down the pane while the chips stay stepped by depth. Drag it to re-arrange.

- ⚠️ **Only the grip is draggable, never the row.** A draggable ancestor kills text selection in its
  descendants, and this row carries the grouping-path text field.
- ⚠️⚠️ **One drop does both halves of what a drag means:** where in the *order*, and which
  *grouping*. Dropping inside another grouping re-homes the row as well as placing it. A drag that
  reordered but left the path alone would park a row visually inside a grouping it is not in — the
  pane and the pushed tree disagreeing about the same item.
- ⚠️ **Same trade only.** A trade is the activity's `group` field, edited in Activities and in the
  schedule's Trade column with a discipline matcher behind it; silently re-trading an activity
  because it was dragged past a heading would undo that work. Refused with the reason.
- A grouping's grip moves the **whole grouping** among its **own siblings**. Re-parenting a branch by
  dragging is a restructure with no confirmation step, and the path field and ‹ › already do it
  deliberately — so that drop is refused, *with the reason*, rather than ignored.
- A drag started on a **selected** row carries the **whole selection**; started elsewhere it selects
  that row first, so a drag can never move rows the planner cannot see they picked.
- ⚠️ **Move up / Move down are gone from the selection bar, as asked** — but they stay in the
  right-click menu, and the grip itself takes **ArrowUp / ArrowDown**. That is why the grip is a
  `<button>` and not a styled span: dragging is a mouse gesture, and removing the buttons would
  otherwise have left no way to re-arrange without one.

### 3. Two defects the tests found, and one the CSS cascade did
- ⚠️ A grouping dropped where it cannot go **returned false with no message** when the target had no
  branch at that depth — the drag landed and nothing happened, which reads as a broken control.
  Only dropping a grouping *back where it was* is silent now; everything else explains itself.
- ⚠️⚠️ **The drop edge lost to the selection rule.** `.sbld-libbody .sbld-libdropbefore` and
  `.sbld-libitem.sbld-libpicked` are both two classes, so the one declared **later** wins — and the
  marker was written first, which meant it vanished on any selected row, i.e. on exactly the rows
  being dragged. **Second time today the same tie has bitten this pane** (the picked rule itself lost
  to the depth rules this morning). The rule now recorded: *anything that must win goes last.*
- ⚠️ One of my own assertions was wrong rather than the code: it demanded no `cfg.activities =`
  anywhere in the file, but the CSV importer replaces the list and the catalogue concats to it, both
  on purpose. Scoped to the three functions that write a whole new order.

### Verified
**599 assertions across ten suites, all passing.** The 54 new ones execute `libSelClick` through
every modifier combination and the two drop appliers `libDropItems` / `libDropNode` sliced out of the
shipped file — fed the same `{ row: { dataset } }` shape the real `dragover` hands them.
Controls: HEAD toggled on a plain click, had `data-libmove` bar buttons, and had no grip, no
`libWireDrag` and no `data-libdrag` at all. harness10's two selection assertions were retargeted to
the new model, not dropped.
⚠️⚠️ **And this time the drag was actually fired in a browser.** A git-ignored page renders the
shipped `stLibrary` and wires the shipped `libWireDrag`, so real `DragEvent`s with a real
`DataTransfer` could be dispatched at it. Confirmed on the live DOM: `_libNodes` indices match the
rendered `data-libnode` attributes; a reorder inside a grouping; a drop into another grouping that
re-homed *and* placed the row; a cross-trade drop refused with its toast and **no** dirty flag; a
whole grouping moved past its sibling; the previously-silent bad node drop now warning; ArrowUp /
ArrowDown on both an item grip and a grouping grip; Enter doing nothing; and the drop edge measured
at `rgb(238, 49, 36) 0 -3px inset` **on a selected row**, with the selection bar returning when the
class is removed.
⚠️ **Not verified signed-in** — the anon key has no grants, so nothing was pushed. The drag was
exercised against the shipped functions in a real browser, but not inside the running module with a
real project loaded.

`MODULE_V` → `20260908h`.

### The WBS step and the Library merge into Structure — 5PMLC and Construction Library (2026-09-08) — jasantos2

Owner: *"can you merge the WBS in step 2 into step 6. There should be 2 different views there in
step 6… Call the view for the step 2 as 5PMLC, and step 6 as Construction Library. since they are
both editable, edits made should be updated live."* And, mid-turn: *"provide users capabilities to
delete some groupings… multiple selection of rows in the right pane, and then right click, group
them together with a defined group name. As well as re-arranging the items pls."*

### 1. One step, two views
`stStructure` owns the heading, two tabs and a bridge line, then delegates the body to `stWbs`
(**5PMLC**) or `stLibrary` (**Construction Library**). Both view bodies lost their own `<h2>`.

- ⚠️ **Why the merge is right and not just fewer steps:** the two screens always answered the same
  question at two zoom levels — the whole lifecycle tree, and the places and work that end up inside
  its Execution branch. Two rail entries for one subject is what let a planner edit the breakdown in
  one place while reading it in another.
- ⚠️ **What it costs, because it is a real loss:** the WBS step was deliberately *first*, on the
  grounds that it is the only step showing what already exists rather than asking for something new.
  The merged step sits where the Library sat, after Activities and Floors & Zones, because the
  Construction Library is a *read* of those two. Mitigated, not ignored: **5PMLC is the default
  view**, so arriving at the step still shows the existing tree first. The original ordering note is
  kept in `STEPS_NEW` rather than deleted — it is still true about the tree.
- ⚠️ **The import path gains the 5PMLC view**, which it never had: `STEPS_IMP` had no WBS step at
  all, so an import could not see the project's live tree from inside the wizard — on the one path
  where comparing the file's structure against the project's own *is* the job.
- ⚠️ Switching views is safe **only** because `render()` calls `sbWbsPark()` unconditionally first.
  The 5PMLC view *borrows* the live WBS editor's DOM into the panel; repainting the panel with those
  nodes still inside it would destroy the tree for the rest of the session.
- ⚠️ `gotoStep('WBS')` and `gotoStep('Library')` still resolve, and carry the **intent**: they select
  the matching view. A deep link from another module failing silently is worse than a renamed step.
- ⚠️ The stale *"this step is early on purpose"* paragraph is **gone**. It was true while the tree
  was step 2 and would now be false on screen, which is the kind of sentence that teaches a planner
  to stop trusting the page. What survives is the half still needed: an almost-empty tree here is
  *correct* on a new project.

### 2. ⚠️⚠️ What "updated live" can and cannot mean — the owner asked, and half of it is undeliverable
The two views edit **different stores**, which is the design of this module, not an implementation
detail: **5PMLC edits `WBS_NODES`** (the project's live tree, written to the database as you type)
and **Construction Library edits `cfg`** (this setup's draft, which becomes branches when
Generate ▸ Push runs). So a Construction Library edit **cannot** make a branch appear in the 5PMLC
tree — the branch does not exist yet. Writing branches on every keystroke would litter a project's
live WBS with structure for activities nobody ever pushed, and the live tree has no undo.

What **is** live is the **bridge line**, and it is the part that matters: recomputed from `cfg` *and*
`WBS_NODES` on every render, and every edit in either view calls `render()`. Rename a grouping in the
Construction Library and the 5PMLC view's description of the Execution Phase changes immediately;
the number of branches the live tree already holds sits on the Construction Library's own screen.
⚠️ It says **"when you Push"** in as many words, and *"they are not in the tree below until then"*.
A counter implying the branch was already there is the looks-live-does-nothing failure this log keeps
recording. `strExecCount` returns **null**, not 0, when there is no Execution Phase branch at all —
"none yet" and "an empty one" are different situations and the line says which.

### 3. Deleting a grouping
⚠️⚠️ **NOTHING ON THIS SCREEN DELETES AN ACTIVITY.** `absDelSeg` removes the **rung**: everything
under it moves up into the parent. It is the exact inverse of `absAddSub`, and that symmetry is why
it is safe to offer — whatever a planner can insert they can take back out. The confirm names the
destination *and* says no activity is deleted, because "Delete" on a heading reads as "delete what
is under it" and that would be a rotten surprise to be wrong about.
⚠️ **Delete is a row button**, not only a context-menu entry: a destructive-sounding action that
exists only behind a right-click is one nobody finds and nobody trusts.

### 4. Multi-select, and grouping a selection
Click a name to select, **shift-click** for a range, **right-click** to act.
- ⚠️ The selection is module state keyed by activity id, so it **survives** the full re-render every
  edit triggers, and is **pruned** against `cfg.activities` on read so a deleted activity cannot
  leave a ghost in "3 selected".
- ⚠️ Shift extends through the **rendered** order (`_libOrder`), not `cfg.activities`: the planner is
  selecting what they can see, and the two orders differ the moment anything is grouped.
- ⚠️⚠️ **Grouping INSERTS, it does not flatten.** `Substructure › Rebar › x` grouped with
  `Substructure › Formworks › y` under "Phase 1" gives `Substructure › Phase 1 › Rebar › x` and
  `Substructure › Phase 1 › Formworks › y`: they now share a grouping, which is what was asked for,
  and neither loses the rung it had. Overwriting both paths with `Substructure › Phase 1` would
  "group" them by deleting structure the planner authored.
- ⚠️ **Per trade.** A grouping is a branch under one trade, so a selection spanning trades becomes a
  grouping of that name inside *each* trade. The toast says so — that is not what "group them
  together" sounds like, and finding out by reading the pane afterwards is worse.
- ⚠️ A trade whose items would pass the cap is refused **as a whole and counted**, never truncated.
- The item name is a real `<button>`, so rows are reachable by keyboard; every inherited button style
  is undone so it still reads as the row's text.

### 5. Re-arranging
⚠️ **The order is `cfg.activities`, and it is not cosmetic:** `absSegList` reads first-seen order out
of it, so it decides the order of the groupings in this pane **and** of the branches the push builds.
- Moves are **within siblings** (same trade, same path). Swapping with whatever sits next in the
  array would trade places with an item in another grouping — changing the pushed order of two
  branches while this pane appears not to move at all.
- ⚠️ A multi-row move walks **against the direction of travel**, so a block moves as one.
- ⚠️⚠️ **And a selected row never swaps with another selected row.** Measured on the fixture, not
  predicted: with both rows of a two-row grouping selected there is nothing to move past, and the
  ordering rule alone let them swap with *each other* — the planner's selection reordering itself
  instead of refusing. Ordering fixes the block that has room; the `hold` guard fixes the one that
  has none.
- A whole **grouping** travels as a block: `absMoveNode` lifts its items out and re-inserts them at
  the target sibling block's edge. ⚠️ Not item-by-item swapping — a grouping's position is where its
  first item sits relative to the *other* groupings' items, and those are a different sibling set.
- `cfg.activities` is mutated **in place** wherever a whole new order is written, never reassigned.

### 6. The right-click menu
⚠️ Appended to `document.body`, not into the panel: the panel is rebuilt with `innerHTML` on every
edit, so a menu living inside it would be destroyed by the action it just triggered. Closed before
any action runs and at the top of every `stLibrary` render; its document listeners are removed on
close rather than left behind; Escape closes it; and it is positioned **after** measuring, because a
menu placed blindly at the cursor opens off-screen exactly where a right-click on the last row is.
⚠️ **One listener on the pane**, resolved with `closest()` — binding `contextmenu` per row means a
handler per activity on a pane that repaints on every keystroke. A right-click on neither a row nor a
heading is left to the browser: suppressing the native menu over empty space buys nothing and takes
away Inspect.

### Verified
**544 assertions across nine suites, all passing.** The 96 new ones execute `absDelSeg`,
`absGroupSel`, `absCommonDepth`, `absRowKey`, `absMoveItem`, `absMoveSel`, `absMoveNode`, the
selection readers and `strLibStats` / `strExecCount` sliced out of the shipped file: the activity
count unchanged across a delete, the insert-not-flatten property, the per-trade split, the cap
refusal leaving paths untouched, both ends of every move, and the whole-sibling-set case.
Controls: HEAD had no delete, no selection, no menu and no reorder, and had WBS and Library as two
separate steps. harness7's two step-registration assertions were retargeted at the merged step
rather than dropped.
Also **rendered and inspected in a browser**, which is where two defects were found: the five-button
row from earlier today, and — after the CSS was written and asserted — a selected row that showed the
tint and **no bar**, because a single-class `.sbld-libpicked` loses its `box-shadow` to the
equally-specific depth rules declared later in the same sheet. Fixed with two classes and re-read off
the computed style: `rgb(238, 49, 36) 3px inset` on picked rows, the grey depth line on the rest.
⚠️ **Not verified signed-in** — the anon key has no grants, so nothing was pushed and no live
`WBS_NODES` was loaded. `strExecCount` was executed against a hand-built node list; the 5PMLC view's
mount path is HEAD's `sbWbsMount`/`sbWbsPark` unchanged, but the two views have never been switched
between in a real browser session against a real project.

`MODULE_V` → `20260908g`.

### The Library's levels stop being three: a grouping is a path, and a place has a unit (2026-09-08) — jasantos2

Owner: *"for the library, allow users to add more levels and as well as in the right pane for the
groupings and items."*

### 1. The right pane: the grouping is a PATH, not a name
A trade no longer holds one rung of groupings — it holds a **tree** of them, and the item sits on
whichever rung its own path ends on: `Structural › Substructure › Concrete Works › Rebar › Rebar`.

- Stored as `grp` + `grps`, read only through `absPathOf`. ⚠️ **`grp` always holds rung 1**, and
  `grps` exists only when the path is deeper — so every reader written before nesting existed (the
  push's `agroup` dim, `absGrpOf`, a setup loaded from the database) gets exactly the value it used
  to get. That is what makes this a widening rather than a migration, and it is asserted.
- ⚠️ `absSetPath` is the **only writer**: it keeps the two fields in step, deletes rather than
  storing `''` so "no grouping" is one state and not two, and is the single place the cap is
  enforced — no other path can create a rung the push cannot build.
- ⚠️ The reader **stops at a hole**, never skips one: a corrupt `['A', '', 'C']` reads as `A`,
  because skipping would silently promote every rung below it into a branch nobody authored.

### 2. Editing it: two buttons at any depth, and one field for the whole path
- ⚠️⚠️ **ONE BUTTON PER RUNG DOES NOT SURVIVE MORE RUNGS.** Measured on a rendered pane, not
  guessed: yesterday's `L2 / L3` pair generalised to "the rungs that exist plus one" printed
  **L2 L3 L4 L5 L6 on every item row** in a three-deep trade and squeezed the activity *name*, the
  one thing on the row that has to stay readable. Replaced with **‹ out / › in** — two controls at
  any depth, which is the promote/demote idiom every outline editor uses, and this pane is one. The
  rung itself is already named by the chip at the head of the row, so nothing is lost.
- Bounds are the item's own: out stops at L2 (⚠️ L1 is a *trade*, and the trades are the project's
  fixed disciplines), in stops at the cap, and both dead ends carry the reason in their title.
- ⚠️ Deepening borrows a **SIBLING's** name — `absSeedSeg`, re-asked at every rung with the path
  built so far. Measured too: seeding from "the last path authored in the trade" offered
  *Superstructure*'s segment to an item under *Substructure*. It is also named from `absSegList`, so
  the spelling offered is the branch's **first-seen** one — the spelling the pane is drawing.
- ⚠️ Cancelling writes **nothing**: the path is built in a copy and committed only at the end, so a
  half-named chain can never reach the activity. A no-op is refused, so the setup never reports
  unsaved work that does not exist.
- The grouping field now holds the whole path (`Substructure / Rebar`), split on `/ > › » |`.

### 3. Restructuring a grouping: Rename, and + level
- **Rename** rewrites the rung for every item under that node — ⚠️ *that* node: a `Rebar` under
  Substructure and a `Rebar` under Superstructure are two groupings, and renaming one must not touch
  the other. The segment is matched before it is replaced, so a stale node rewrites nothing.
- **+ level** *inserts* a rung: everything beneath moves one step deeper inside it. ⚠️ Everything,
  not only the direct items — the first version moved direct items alone, and the rendered check
  showed the button **dead on `Concrete Works`**, i.e. on precisely the grouping a planner most
  wants to insert a phase under. Inserting is "indent my children", and it is well defined for every
  descendant.
- ⚠️ A sub-tree already at the cap **refuses** rather than being truncated to fit: making it fit
  would have to drop somebody's deepest rung, which is silent data loss dressed as a tidy-up.
- ⚠️ `absAddWhy` is the **one** predicate behind the button's disabled state, its tooltip *and*
  `absAddSub`'s refusal. A predicate copied into a renderer is how a control ends up enabled for
  something the function then refuses — the failure this log keeps recording.
- ⚠️ Nothing stores a grouping: it exists because items name it. So an "empty" rung is not
  representable, which is why there is no way to create one and none to leave behind.
- One visible change to reading order: **a heading's own items now print before its sub-headings**,
  at every rung. The old tree had a separate `loose` list rendered *after* the groupings, so an
  ungrouped item appeared at the bottom of its trade; uniform outline order is what makes a
  recursive pane legible, and `+ level` reads correctly only when what it will move is above what
  it will not.

### 4. The left pane: the rung the data already had
⚠️ The **unit** has existed in `cfg.zoning`, in the push, and behind Floors & Zones' own +/- buttons
since before this pane did — the pane stopped at the zone, so a project with units read as if it had
none. It is collected and drawn at **L4**, with a per-zone count, and read `code || name` to match
the push's `dimName` (Floors & Zones creates units with a code and no name, so `name || code` would
have printed nothing here while the WBS printed `U1`).

⚠️ **Four is the honest number, not a shortfall.** Tower › Floor › Area › Unit are the rungs
`cfg.zoning` stores, `_dimLevelMap` resolves and Vertical Stacking bands by. A fifth is a schema
change reaching the push's location writer and the stacking axis, and it deserves its own prompt.

### 5. The rung names are no longer a constant
`libLvNames` replaces `LIB_LV`. The left pane's rungs are the project's **own** location levels via
`dimLabelOf` (a breakdown reading *Tower › Level › Zone › Cluster* now says so here, exactly as the
push dialog does), and the right pane's list grows with the depth the planner has built. The legend
is trimmed to the rungs a project actually has, so no L4 Unit is promised to a project with none.

### 6. And it reaches the schedule: one WBS dim per rung
`agroup`, `agroup2`, `agroup3`, `agroup4` — listed rather than generated, so the WBS-order editor can
name and reorder each like any other dim, and so the cap is visible in the file that enforces it.

- ⚠️ Keyed on the **whole prefix**, not the segment: two parents can each hold a `Rebar`, and keying
  on the segment alone would merge them into one branch holding both parents' work. Joined on a
  control character, never on `''` — concatenating would make `['ab','c']` and `['a','bc']` one key.
- ⚠️⚠️ **EVERY RUNG SELF-SKIPS**, which is what makes adding four dims safe: `dimKey` returns the
  same NUL sentinel `tower` uses on a single-tower project, so a project that groups nothing
  pushes a tree **identical** to before any of this existed, and a project two deep never builds a
  third rung. `buildTree`'s skip rule is HEAD's, untouched. Both asserted.
- ⚠️ A **saved setup is unaffected** — `incl[d]` is read from the setup's own `wbsOrder`, so the new
  rungs appear only once ticked in *Generate → WBS structure*. Only the new-setup default gains them.
- ⚠️ The dialog stops promising a level it will not build: `willBuild` now skips an unused grouping
  rung on the tower's own terms, and `_dimSkipWhy` gives the reason **per dim** instead of printing
  the tower's reason for whichever dim was skipped. Note this also covers `agroup` on a project that
  groups nothing — which it always did in the tree, and never admitted in this dialog.
- ⚠️ The label's number matches the dim's number (`agroup2` → *Grouping 2*), after the rendered
  legend read *"L3 Sub-grouping 2"* and left it unclear whether 2 was the level or the ordinal.

### Verified
**447 assertions across eight suites, all passing.** The 123 new ones execute `absPathOf`,
`absSetPath`, `absParsePath`, `absLevelOf`, `absSetLevel`, `absSeedSeg`, `absRenameSeg`, `absAddSub`,
`absAddWhy`, `absSegList/Index`, `libGroupTree`, `libLvNames` and the **push's own `dimKey`** sliced
out of the shipped file — the cap read from the source rather than assumed, both prefix-collision
cases, the cross-parent seed, the cancel-writes-nothing path, every refusal, and the sentinel that
makes each rung vanish. Controls: HEAD's `absLevelOf` could only answer 2 or 3, HEAD had one grouping
dim and no depth parser, HEAD's tree had a flat `groups` list plus a separate `loose`, HEAD's left
pane had no `sbld-libL4`, and HEAD hard-coded three rung names per side.
⚠️ harness8 is **retired**, not deleted-and-forgotten: it asserted the previous turn's diff against
the previous HEAD, and every property it covered is carried into the new suite (noted inline there).
harness7's Library sections were retargeted at the new tree shape rather than dropped.
Also **rendered and inspected in a browser** — which is where four of the defects above were found:
the five-button row, the sub-grouping that lost its heading weight, the dead `+ level` on a grouping
holding only sub-groupings, and a 3-deep path clipped by a 168px field (now 230px, measured at zero
overflow). Every grouping row's chip title, weight, tooltip and button state was read out of the DOM.
⚠️ **Not verified signed-in** — the anon key has no grants, so nothing was pushed. The four grouping
rungs have never been built against a real project's WBS; the skip property is proven at `dimKey` and
`buildTree`'s use of it is HEAD's unchanged code.

`MODULE_V` → `20260908f`.

### Why the right pane skipped L2, and the rung becomes a real WBS level (2026-09-08) — jasantos2

Owner: *"how come on the right pane, the trades are L1 and then L3 is followed?"* — and *"allow the
identification / adjustments of the levels of each item… This would then be inputted as information
for the schedule builder, and would aid in identifying the structure of the schedule."*

### 1. The jump was a bug in yesterday's own change, and it was mine
`libItemRow` printed a **literal `libLv(3, 'grp')`** on every item. So an item with no grouping sat at
depth 2 — directly under its trade, exactly as yesterday's entry describes and defends — while
claiming **L3**. The pane announced a rung that was not there, which is precisely the reading the
owner had to ask about.

`absLevelOf(a)` answers it instead: **an item inside a grouping is L3; an item directly under its
trade is L2.** ⚠️ It is derived, never stored — a level kept alongside the grouping could disagree
with it, and then the number on screen would stop describing the tree the push builds.
⚠️ An item promoted to L2 borrows `.sbld-libL2`, which is a **heading** style, so the weight is reset:
otherwise an ungrouped item reads as a grouping with no children.
⚠️ The chip's tooltip is overridden for that case — an item at L2 is at the grouping *depth* but is
not a grouping, and labelling it one would make the tooltip contradict its own row.

### 2. The rung is adjustable, because the rung IS the position
Each item carries an **L2 / L3** pair. Setting the level is not a second field: **L3 means "has a
grouping" and L2 means "has none"**, so pressing L2 clears `grp` and pressing L3 puts the item in one.

- ⚠️ **Two buttons, not a free number.** L1 is a *trade*, and the trades are the project's eight fixed
  disciplines — a 1/2/3 box would invite typing 1 and having nothing happen, which is the
  looks-live-does-nothing failure this module keeps recording. The current rung is `on`, disabled and
  says so.
- Demoting to L3 adopts the trade's most recently used grouping rather than a blank; a trade with none
  yet asks for a name. ⚠️ An item landing in a grouping called `""` would read L3 in the pane and skip
  the rung in the tree — the exact disagreement `absLevelOf` exists to prevent.
- ⚠️ A no-op is **refused**: setting the rung an item is already on marks nothing dirty and repaints
  nothing, so the setup never reports unsaved work that does not exist.

### 3. And it reaches the schedule builder: `agroup` is a WBS dim
This is the owner's third sentence, taken literally. The grouping is no longer a label on a screen —
it is a **rung in the pushed WBS**, sitting between the trade and the places:
`Structural Works › Rebar › 3rd Floor › Zone 1`.

- `dimKey`, `dimName` and `dimOrderIndex` all gained the case: keyed on the **normalised** grouping
  name (two items typed `Rebar` and `rebar ` are one grouping, and keying raw would build two branches
  that look identical), named by the grouping, and ordered by the order `cfg.activities` first
  mentions them — the same "the setup's own order" rule floors and zones already follow.
- ⚠️⚠️ **IT SELF-SKIPS, and that is what makes adding a dim safe.** `dimKey` returns the same `'\u0000'`
  sentinel `tower` uses on a single-tower project, so an ungrouped item attaches to its trade and the
  rung disappears — a project where nothing is grouped pushes a tree **identical** to before this
  existed. `buildTree`'s skip rule is HEAD's, untouched. Both are asserted.
- ⚠️ **A saved setup is unaffected.** The push reads `incl[d]` from the setup's *own* `wbsOrder`, so a
  setup saved before today simply does not include the rung until the planner ticks it in
  *Generate → WBS structure* — where it reorders with the same arrows as every other level.
- Only the **new-setup default** gains it. `locLevelFor` returns null for an unknown dim, so it can
  never be mistaken for a location level.

### ⚠️ What it does not do
It does not change the **Vertical Stacking axis**. That axis is the *location* breakdown — floors and
zones — and the grouping is activity structure, so the honest claim is narrower than the owner's
hope: the grouping now appears in the WBS tree, the grid's WBS column and every WBS-branch readout,
which is what makes the schedule's structure legible. Making the stacking read an activity rung is a
different change and would need its own prompt.

### Verified
**366 assertions across eight suites, all passing.** The 43 new ones execute `absLevelOf`,
`absSetLevel`, `absGrpList`, `absGrpIndex` and the push's own `dimKey` sliced out of the shipped file:
both rungs, both moves, the prompt fallback, all four refusals, the two-spellings-one-grouping case,
and the sentinel that makes the rung vanish. Controls: HEAD printed the literal `libLv(3, …)`, has no
`absLevelOf`, has no `agroup` anywhere, and its default order jumped trade → floor.
Also **rendered and inspected in a browser**: every item row's chip, tooltip, picker state and
computed font-weight were read out of the DOM — L2 items report *"Item, directly under its trade"*,
L3 items report *"Item"*, the current rung is disabled, and both weigh 400.
⚠️ **Not verified signed-in** — the anon key has no grants, so nothing was pushed. The `agroup` rung
has never been built against a real project's WBS; the skip property is proven at `dimKey`, and
`buildTree`'s use of it is HEAD's unchanged code rather than something I executed end to end.

`MODULE_V` → `20260908e`.

### The Library labels its levels L1/L2/L3, and the step rail minimises (2026-09-08) — jasantos2

Owner: *"there should be levels like L1, L2, L3 like in the pic i sent, so it is easier for everyone to
see also. also make the steps on the left side be minimized so more space."*

### 1. The rung is labelled, not only indented
The sheet carries L1/L2/L3 as its own column, and it is right to. Indentation tells you a row sits
*under* another one; it does not tell you **which rung** it is on — and the two panes put different
things on the same rung, which is the correspondence the sheet exists to show:

| | L1 | L2 | L3 |
|---|---|---|---|
| **Location** | Tower | Floor | Area / Zone |
| **Trade** | Trade | Grouping | Item |

- A fixed-width chip on every row, so the names still line up down the pane; **tinted by depth rather
  than coloured**, because three saturated badges per row would compete with the trade colour and with
  the change-order and critical marks this module already spends colour on. Each carries
  `L2 · Floor` as its tooltip.
- Each pane header repeats the vocabulary once (`L1 Tower · L2 Floor · L3 Area / Zone`) — nothing else
  on screen says that L2 means a floor on one side and a grouping on the other.

### 2. The step rail minimises to a strip of numbers
- One class on `.sbld-wrap` collapses the column to **46px**: the numbered circles stay, the titles and
  subtitles collapse, and each circle keeps its full `n. Title — subtitle` as a tooltip.
- ⚠️ **Numbers, not nothing.** The steps are referred to by number everywhere else in this module —
  which is why `_stepNo()` exists and no step number is ever hard-coded — so a rail that vanished would
  take the reader's place in the sequence with it.
- ⚠️ **The toggle lives OUTSIDE the rail**, in a new `.sbld-railcol`: the rail itself is rebuilt by
  `innerHTML` on every render and would throw the button away.
- ⚠️ **Re-applied after every rail render** (three call sites), because the wrap and the toggle survive
  a repaint while the rail does not — without that a repaint would silently expand it again.
- One class drives **both** rails (Schedule Setup and Cost Loading share these classes), so they cannot
  end up in different states. Remembered per browser in `localStorage`, read inside `try/catch`.
- The button says what pressing it **does** (`« Minimise` / `»`), not what the state is — a toggle
  labelled with its own current state is the one everybody reads backwards. Wired once per button, not
  once per render.
- ⚠️ Named **`sbld-railmin`**, not `sbld-min`: `.sbld-mini` already exists for an unrelated small
  select, and a class that is a prefix of another is a trap for the next reader. Its own assertion
  tripped on exactly that before the rename.

### Two defects found by RENDERING it, not by reading it
The shipped `stLibrary()` was executed against a constructed cfg and its real markup put on screen
with the module's own stylesheet:
- **"Roof Deck  Roof Deck"** — a floor actually named *Roof Deck* printed its name and its *kind*
  label, which reads as a duplication bug rather than as a category. The kind is now suppressed when
  it repeats the name.
- **A long trade list widened the row.** Six trades on one floor is normal; the floor name is the thing
  that must stay readable, so the trade list shrinks and ellipses instead.

### ⚠️ And a real bug the assertion caught, in the fix for the first defect
`_libNorm` was written `.replace(/s+/g, ' ')` — **no backslash** — so it collapsed runs of the letter
**s**: "Rebar Consumables" normalised to `rebar con umable ` and every comparison built on it was
quietly meaningless. Caught by asserting the normaliser rather than trusting it, and it is exactly the
class of typo that reads correctly at a glance.

### Verified
**323 assertions across seven suites, all passing.** The 27 new ones execute the shipped `libLv`,
`libLegend` and `_libNorm`, and assert the rail's mechanics against the file's own text: the toggle
outside the rail, both wraps wrapped, three `sbldMinSync()` calls, the once-per-button wiring, the
defensive `localStorage` read, and that `.sbld-mini`'s occurrence count is **unchanged** by the rename.
Controls: HEAD has no level chips, no `libLv`, no minimise state and no rail column.
Also **rendered and looked at** — expanded and minimised, in a browser, at 1400px — which is how both
layout defects above were found; the harness page is git-ignored and was deleted before committing.
⚠️ **Not verified signed-in** — the anon key has no grants, so this was the shipped render function
against constructed data, not a real project's places and items.

`MODULE_V` → `20260908d`.

### Cost Loading step 2 reads the BOQ; a Library step puts the places beside the work (2026-09-08) — jasantos2

### 1. The money is defined in the BOQ, and step 2 now reads it
Owner: *"i want you to redirect the step 2 to the contracts and claims app. since technically the
assigning of cost per activity should be matched / defined in the BOQ in the contracts and claims
module."*

Correct, and it is the argument this module already makes about `planned_cost`: two places that can
each state the cost of an activity will disagree, and then nobody can say which figure the S-curve
was drawn from. The BOQ is the priced document — it reconciles to a contract total, it is revisioned,
and Contracts & Claims already matches its lines to these very activities.

- `boqDerive(items, allocs)` — **pure**, so it can be executed without a database (the anon key has
  no grants on the BOQ tables either). `loadBoq()` does the reading and nothing else.
  - share = `alloc.qty / Σalloc.qty` where the line has allocated quantities;
  - ⚠️ share = **1/n** where it has none — the link-only case yesterday's BOQ change made possible,
    and the only reading the data supports. Weighting by anything else would invent a measurement.
  - ⚠️ Headings, **excluded** lines and amount-less lines contribute nothing. `boq_activity_quantity`
    could not be reused: it rolls up *quantity* and deliberately drops lump-sum and provisional
    lines, which carry money and no quantity.
- Read across modules by **the caller's own RLS** (`can_access_project`), so this can never see a
  project the planner cannot, and nothing here writes to the BOQ.
- ⚠️ **Two columns, not one box holding whichever won.** *From the BOQ* is read-only beside an
  *Override* input. A single field showing the BOQ figure would make a planner who edits it believe
  they had corrected the BOQ — and would hide that the correction stops following it. Clearing the
  box returns the line to the BOQ; a BOQ correction then flows through with nobody re-typing anything.
- ⚠️ **It degrades, never blocks.** No BOQ, no tables, no grants — all land on "you can still type
  totals below", with the reason verbatim, because a missing table and a missing grant need opposite
  responses. Manual entry stays: removing it would strand a project that has no BOQ yet.
- The step reports what it found (`n of m priced lines matched`) and names the unmatched ones as work
  to do on the BOQ's own **Match to schedule** tab. Steps 3, 4 and 5 are untouched — only **where the
  figure comes from** has moved.
- ⚠️ The counts are their own variables, not keys on the id→amount map: an activity whose
  `activity_id` happened to be `_lines` would otherwise have been handed the line count as its cost.
- Not awaited on open: the tab paints on the config it has and the BOQ figures fill in a moment later.

### 2. A Library step — places on the left, work on the right
Owner: *"there are still problems in detecting WBS, locations etc when importing a very detailed
schedule… there should be a library in the schedule setup module. That library should first define
the locations on the left pane, and on the right the groupings of activities, similar to the image
attached. make the UI better"*

A two-pane step in the shape of the attached cost-structure sheet: **Location (Floor and Area)** down
the left, **Trade (Groupings and Items)** down the right at three levels — L1 trade, L2 grouping,
L3 item.

- ⚠️⚠️ **A view and an authoring surface, not a second store.** The places already live in
  `cfg.zoning` (per trade, because a trade genuinely zones its floors its own way — the same fact the
  Vertical Stacking level-1 rule turns on) and the items in `cfg.activities`. A library with its own
  copy of either is the two-screens-disagreeing failure this log keeps recording. The one genuinely
  new field is the **L2 grouping** (`a.grp`), because the sheet asks for a middle level and
  `cfg.activities` had only trade → item.
- **Left pane** is the union across trades — a floor only one trade works is still a floor of the
  building — and it names the trades that define each one, because that difference is real and hiding
  it would make the pane read as a contradiction.
- **Right pane** groups items under their grouping; an item with none sits **directly under its
  trade** rather than under an invented "(ungrouped)" heading that would look like a real choice. The
  grouping input is the only editable thing on the screen and stays visually quiet until used.
- ⚠️ **`openLocAdopt()` is finally wired.** It has been complete and reachable from **nothing** since
  it was written — flagged twice in this log as dead code. *Read locations from the WBS…* is the
  button it always belonged on, and *Match WBS to trades…* opens the existing trade matcher beside
  it. That is the import complaint answered: not that the matching could not be done, but that it was
  not in front of anyone.
- Both buttons are **disabled with the reason** when the project has no imported WBS to read.
- Registered on **both** paths, after Activities and Floors & Zones — in front of them it would be an
  empty screen on a new project. On the import path it is the step that matters most.
- ⚠️ **No UoM column**, though the sheet has one: a unit belongs to a BOQ line and Contracts & Claims
  already carries it.
- The panes are a **grid** so the columns cannot drift as either side grows, each body scrolls on its
  own (a 400-floor tower must not push the trades off screen), and it collapses to one column under
  900px.

### Verified
**296 assertions across seven suites, all passing**, every one executing code sliced out of the
shipped file. The 45 new ones run `boqDerive` over eight table shapes (60/40 weighting, the 1/n
link-only split, headings, exclusions, amount-less lines, an unmatched priced line, accumulation
across lines, thirds rounding to 2dp), run `buildGroups` to prove the BOQ→override precedence in both
directions with the BOQ figure still reported beside an override, and run `libLocTree`/`libGroupTree`
over a constructed cfg (a shared floor appearing once with both trades named, deduplicated zones, the
L1/L2/L3 tree, an ungrouped item, an empty trade omitted, an empty project not throwing). Controls:
HEAD has no `boqDerive`, read the total only from the typed config, and **defined `openLocAdopt` while
calling it from nowhere**.
⚠️ **Not verified signed-in** — the anon key has no grants on `project_schedule` or the BOQ tables. No
BOQ was read from a live project and the Library has not been rendered against a real schedule; the
trees and the arithmetic were executed against constructed data.

### ⚠️ What this does NOT do
The library does not yet **drive** the importer's detection — it shows what was detected and gives you
the two ways to fix it. Making the location and trade guessers prefer library values over their
vocabularies is the next step, and it is a change to matching behaviour that deserves its own prompt.

`MODULE_V` → `20260908b`.

### Cost Loading: the spend shape is per OCCURRENCE, not only per cost line (2026-09-07) — jasantos2

Owner: *"the function of cost loading of the project schedule should allow users to decide what type
of distribution that activity has over the ff months. (e.g. back loaded, bell, etc.)"*

**Step 4 already did most of this** — *Spread over time*, with Linear / Front-loaded / Back-loaded /
Bell, applied per occurrence across that occurrence's own dates, integrating to the full total. What
it did **not** do was let two occurrences of one cost line differ: there was **one shape per line**.

That was tolerable while a cost line was one activity name. It stopped being tolerable the moment a
cost line could be a **WBS branch covering twenty zones** (the entry below), because a substructure
pour and a roof-level pour of the same bill item do not spend alike.

- `curveFor(g, r)` = the occurrence's override, else the line's curve. Stored as
  `cfg.groups[name].icurve[<instKey>]` — keyed on `activity_id`, like the step-3 percentages, because
  a uuid-keyed override would reset itself on the next re-import.
- ⚠️ **An override is only ever an override.** Clearing it returns the occurrence to the line, and a
  line-level change still moves every occurrence that has not been overridden. Storing a *copy* of
  the line's curve on each instance would have frozen them all against the line — so "Same as line"
  **deletes** the entry rather than writing the line's current value.
- Step 4 gains a per-occurrence editor: press the **occurrence count** to open a line and set an
  individual occurrence, each row showing its activity id, its place, its dates and its own money.
  "Same as line" is listed **first and selected by default**, so the fallback is visible rather than
  implied. A line with overrides carries an **"n custom"** tag, because a line whose occurrences
  disagree with it must not look uniform.
- ⚠️ Step 4 has its **own** open state (`clCvOpen`), so opening a line here never moves step 3's
  selection.
- Both readers were switched together: **Apply** writes `curveFor(g, d.r)` per row, and the **monthly
  preview** spreads with the same call — a preview reading a different shape from the one Apply writes
  is an S-curve on screen that the schedule never gets.
- `curveOf` itself is byte-identical, so a config saved before this spreads exactly as it did.

### Verified
**47 new assertions** (251 across six suites, all passing), executing `curveFor` / `icurveOf` /
`icurveCount` sliced out of the shipped file, with HEAD executed as the control and shown to have no
`curveFor` at all and to use the line curve for every occurrence. Also asserted: an unknown curve
name is ignored rather than trusted, a missing `icurve` map is safe, a line with no curve still falls
back to linear, and moving the line moves exactly the occurrences that are not overridden.
⚠️ **Not verified signed-in** — the anon key has no grants on `project_schedule`. No cost was applied
and the editor has not been opened against a real project.

`MODULE_V` → `20260907za`.



### Cost Loading: the cost line can be the WBS branch, not only the leaf activity (2026-09-07) — jasantos2

Owner: *"currently it is designed for project schedules whose lowest level of details are Activities.
However what will happen if the project schedule is structured, wherein zones are the lowest level of
details… my intent is to cost load based on the activities, similar to a BOQ. (e.g. rebar is xxx
amount, formworks is yyy amount) not per zone… users then assign the cost to the WBS (activity) and
then the ff steps remain. Meaning the lowest level detail (assuming those are zones) are divided
equally OR users are able to define what percentage of the cost belongs to that zone."*

### It did not need re-furnishing — it needed one assumption removed
The exercise was already the right one: group by name so *Formworks* is priced **once** and step 3
splits it across the places it occurs, equally or by a typed percentage. The five steps, the rounding
remainder, the 100%-or-refuse rule and the time curves all stay exactly as they were.

What was wrong was a single assumption inside `nameOf(r)`: that **the leaf row carries the work's
name**. On a schedule built the other way round the leaves are *Zone 1*, *Zone 2*, and the BOQ line
(*Rebar Works*) is the **WBS node above them** — so step 1 enlisted zone names and asked the planner
to price a zone. Worse, measured on a constructed case: *Zone 1* under **two different branches**
folded into **one** cost line, so pricing it would have split one figure across rebar and formworks
alike.

### The cost line's identity is now a basis, detected and changeable
- **`activity`** — the leaf's own name. Today's behaviour, byte for byte.
- **`wbs`** — the nearest WBS ancestor that names **work**. The instances are then the zone leaves
  under it, so *"divided equally OR a percentage per zone"* is step 3's existing machinery with
  nothing added.

Everything downstream is untouched because it never cared what a group was: assign, distribute, the
curve, Apply and review all key off the group and its instances.

- `wbsLineOf(r)` walks the leaf's WBS code **deepest-first** — the most specific true answer, so
  *Rebar Works* wins over the *Structural Works* heading above it — stepping over any ancestor that
  names a **place**, and (⚠️ measured) any ancestor that names a **phase**: a leaf filed directly on
  the Execution Phase root otherwise walked all the way up and became a cost line called
  "Execution Phase" holding the whole project, which is worse than no answer. Such a leaf now falls
  back to its own name and stays visible rather than vanishing from the total.
- **"Is this a place?" is answered by the project's own data**, not a new vocabulary: every location
  value used anywhere (`locValOf` over `LOC_LEVELS`), lowercased. ⚠️ Plus one independent fallback
  pattern, because `location` is often unpopulated on a fresh import — which is exactly when the
  planner opens this tab. A leaf literally called "Zone 3" is a place either way.
- `detectBasis()` proposes, and step 1 **shows the count it counted** ("4 of 5 leaf activities are
  named for a place… and 5 of them sit under a WBS branch that names work"). Both conditions are
  required: place-named leaves with no work-naming branch above them would offer a basis with nothing
  in it.
- ⚠️ Detection **seeds without marking dirty** — it runs from a render, and a render that reports
  unsaved changes teaches the planner to ignore that indicator. Once they pick a basis
  (`basisChosen`) detection never overrides them again.
- ⚠️ Switching the basis with money already assigned is **stated with the count and confirmed**: cost
  lines are keyed by name, the names change wholesale with the basis, so those totals are orphaned
  rather than silently re-attached to a line that happens to share a name.
- ⚠️ **Rename is disabled under the WBS basis**, with the reason. It edits `activity_name` on every
  instance — under this basis that would rename the **zone rows**, not the branch. Renaming a WBS
  node is a different write on a different table, so it is offered as disabled and points at the WBS
  Manager.

### Also: which writer mis-stamped those trades, established rather than assumed
Yesterday's `earthworks` fix raised the question of *which* code path had written Structural Works
onto the owner's rows. Both callers of `discCanonOf` pass a **different trail**, and that is the whole
story — now asserted:
- `discStampFromWbs` (**the importer**) builds the trail from the activity's own code, so it
  **includes** the branch the activity sits in — `… › Site Development Works › Earthworks`. HEAD
  matched *Earthworks* and stopped. **This is the writer that mis-stamped the rows.**
- `locScanNames` (**the Match-WBS-to-Trade wizard**) sets `trail = trail.slice(0, -1)`, **excluding**
  the node's own name — so it always saw `… › Site Development Works` and always offered the right
  value. **The wizard was never broken**, which is why it is the safe route to fix rows already
  stored: *Group ▸ Match WBS to Discipline/Trade…*, tick the branch, Apply.

### Verified
**204 assertions across five suites, all passing**, every one executing code sliced out of the
shipped file. The 35 new ones run the real `buildGroups`/`distribute` against two constructed
schedules — leaves-are-work and leaves-are-zones — and the controls **execute HEAD's** code on the
same rows to show it produced zone-named cost lines, no *Rebar Works* line at all, and the two-branch
*Zone 1* collapse. Also asserted: schedule A's grouping is **byte-identical to HEAD** (no regression
for existing projects), 1,000,000 over three zones equally comes to 333,333.33 / .33 / .34 and sums
back to exactly 1,000,000, a 50/30/20 per-zone split lands 500k/300k/200k, an 80% split yields no
amounts at all, detection still works with `location` stripped, and the basis guards behave.
⚠️ **Not verified signed-in** — the anon key has no grants on `project_schedule`. No cost was applied
and neither basis was exercised against a real project; the two schedules are constructed rows.

`MODULE_V` → `20260907h`.

### Main-contract-only closes the gap, and "Earthworks" stops outranking its own trade (2026-09-07) — jasantos2

### 1. Picking **Main** closes the gap
Owner: *"for the filtering of 'blended', 'main', 'change orders' activities, when picking main it
should exclude the 'change orders' activities hence the bar chart will revert to its original state.
(meaning no gap in between)."*

It follows from what the notch **means**. The gap *is* the change order — so with the change orders
filtered off the screen there is nothing left on screen for the hole to refer to, and it just reads
as a broken bar. Main-contract-only was already this module's "as if the variations were never
instructed" view (`_mainOnlyShiftOf` pulls every affected row back; `_unsplitFin` folds a legacy
split host into one bar), so closing the gap applies that existing rule to the single-line model
rather than inventing an exception. **Blended** and **Change orders** both keep the gap: in both, the
change order is on screen.

- The derivation splits in two. `_coGapsRaw(r)` is what **exists**; `_coGapsOf(r)` is what is
  **painted** and returns `[]` under Main-only. Anything doing arithmetic reads the raw one.
- ⚠️ **And the bar actually reverts, not just the notch.** `dispFin` now subtracts **two different
  things** under Main-only: `_mainOnlyShiftOf(r)`, the change-order days *upstream* of the row, and
  `_coGapDaysOf(r)`, the change-order days *inside its own bar*. Without the second, Main-only would
  have closed the gap and still drawn a bar three days too long — the filter claiming the variation
  never happened while the bar went on measuring it.
- ⚠️ **Successors move back too.** Under the single-line model the change order is a *successor* of
  its host, not a link in anybody's predecessor chain, so the shift walk could not see it: everything
  after the host would have kept the variation's days. The walk now adds a main-contract
  predecessor's own internal gap days alongside a change-order predecessor's duration.

### 2. Why those works were tagged Structural: `earthworks` was in the Structural vocabulary
Owner: *"why are these works tagged under structural trade? even though the trade is under site
development."* Measured, and it is a real classification bug in `WORK_CANON`, not a data-entry slip.

`earthworks` sat in **Structural Works**' term list, and `discCanonOf` walks the WBS ancestry
**nearest-first, returning on the first hit**. So `Execution Phase › Site Development Works ›
Earthworks` matched *Earthworks* one level down and **never looked at *Site Development Works* one
level up**. The importer's `discStampFromWbs` then wrote `work_type = 'Structural Works'` onto
Backfilling Works with Binder System, Gabion and Gravity Wall — which is why they were drawn in the
Structural building and, having no storey under Site Development, in **— No level —**.

Site earthworks (roads, drainage, retaining) and structural excavation are both real, so the term is
genuinely ambiguous. The error was letting the ambiguous **child** beat the explicit **parent**:

- `WORK_CANON` entries gain a **`weak`** list. `earthworks` and `excavation` moved into it.
- `discCanonOf` takes **two passes**: nearest-first over **strong** terms only (an ancestor that names
  its trade outright wins), then nearest-first allowing weak terms (nothing named a trade, so an
  ambiguous term is the best evidence there is — `Execution Phase › Earthworks` is still Structural),
  then the activity name.
- `_discTermHit` deliberately keeps matching **strong *and* weak**, because it answers a different
  question — "does this name read as a trade at all", which is what stops a trade being proposed as a
  location. **"Earthworks" is still not a place.**
- Two memos, since there are now two questions; one shared cache would answer whichever was asked
  first.
- Keep the `weak` list small and evidence-led: a term belongs there only when the same word honestly
  appears under two different trades on real schedules.

⚠️ **This fixes the stamp, not the rows already stamped.** `work_type` is stored, so those three
activities keep saying Structural Works until someone retags them — the Trade column in the grid, or
a re-run of the import stamp. The `≠ branch` badge now says exactly that, and names the precedence
bug as the likely cause.

### Verified
**163 assertions across four suites, all passing**, every one executing code sliced out of the
shipped file. The 39 new ones run the real classifier on the owner's three activity names and their
real WBS trail, and the **control executes HEAD's classifier on the same inputs and gets
`Structural Works`** — so the fix is demonstrably the fix. Also asserted: `Structural Works ›
Earthworks` is still Structural, `Site Development Works › Excavation` is Site Development, six
unrelated trades are byte-identical to HEAD, and `_discTermHit('Earthworks')` is unchanged so no
location band can appear. The scope-filter rule is executed rather than grepped: Main draws 0 gaps
while still knowing the 3 days, Blended and Change-orders draw 1, and the day count is identical in
all three.
⚠️ **Not verified signed-in** — the anon key has no grants on `project_schedule`. No row was retagged
and no filter was switched on a real project.

`MODULE_V` → `20260907g`.

### The main-contract BAR is drawn in two pieces with the change order in the gap (2026-09-07) — jasantos2

Owner, correcting the entry below: *"no but the purpose is that, the bar of a the main contract
activity will be divided into two, since in between is the bar of the change order."*

I had read "retain the single line-item" as "one continuous bar" and shipped exactly that. Both
statements are true together: **one row, one Activity ID, one line item — and its bar broken in two,
because the change order occupies the middle.** The row was already right; the drawing was not.

### The interruption is not a stored fact — it IS the change order
No new column, no migration. `_coGapsOf(r)` derives the suspended window from the change order
itself: a `change_order` row that is **SS-linked** into `r` and whose span lies strictly inside r's.
Move it, re-date it or delete it and the gap moves, re-dates or closes, with no second copy of the
truth to go stale — the same rule `splitLabel` already followed.

- **Only an SS link counts.** `applySplit` writes `<host> SS+<days worked>` precisely so the variation
  sits *inside* the bar; a change order merely queued after the activity is an FS successor and must
  not punch a hole in it.
- **Strictly inside.** A change order starting on the activity's own first day or ending on its last
  leaves no piece on that side, so it is not an interruption — notching there would just shave the
  bar's end off.
- Two change orders in one activity give two gaps and three pieces, ordered by date regardless of row
  order. Milestones, WBS summaries, id-less rows and the change order itself are never notched.

### An overlay, not two bars and not `clip-path`
`.ps-bar-cut` is a notch painted in the pane colour **inside the one `.ps-bar` element**, after the
progress fill. Two `.ps-bar` elements would need two `data-id`s and would break drag, resize, link
mode, the critical/spotlight outlines and every selector that assumes one bar per row; `clip-path`
would clip those outlines and the change-order ring away. `pointer-events:none`, so dragging still
works straight through the gap. A **dotted midline** crosses it — the P6 convention for a suspended
activity, and it says the two pieces are ONE activity, which is the thing the old two-row model could
not say. The map behind it is rebuilt once per repaint (`_clearCoGapMemo()` at the top of
`doRender`), because the change orders that punch the gaps are ordinary rows an edit or a drag can
move. The bar tooltip names each window and the change order that owns it — a hole with no
explanation is indistinguishable from a rendering fault.

### `mergeSplit` now migrates old splits onto this model instead of flattening them
Rows already split in the database were the other half of the ask, and the old merge got two things
wrong for them:
- ⚠️ **It gave the time impact back.** It re-ended the bar at `start + own days - 1`, quietly deleting
  the days the variation had cost — a schedule that was honest about a 3-day change order became one
  that was not, as a side effect of a *display* request. The segments and their gaps tile
  `start..lastEnd` exactly, so the merged bar now simply **keeps the last segment's finish**.
- ⚠️ **It left the change orders loose.** Under the old model each was an FS successor of the segment
  before it, and those segments are about to be deleted. `_splitGapCos()` finds every change order
  sitting in a gap and re-points it to `<host> SS+<days worked before it>` — the true relationship,
  and the thing `_coGapsOf` reads. The re-link happens **before** the delete, so a failure leaves the
  group intact and re-mergeable. The menu item now reads "Merge split back into one line item…".

### Unchanged from the entry below
One row, the finish still moves out by the change order's duration, `duration_days` still matches the
span, successors still need no re-pointing, and the span-weighting cost noted there still stands —
the notch is a drawing, so it changes no arithmetic.

### Verified
**108 assertions across three suites, all passing**, every one executing code sliced out of the
shipped file: 38 new for the gap derivation and the notch (including the six cases that must *not*
punch a hole — FS successor, FS+lag, a main-contract row, a link to another activity, a window
touching either end, missing dates), 11 for the legacy-merge migration, plus the 48 and 22 from
earlier today re-run green. Controls throughout: HEAD has no `ps-bar-cut`, no `_coGapsOf` and no
`_splitGapCos`, HEAD's bar emitted nothing between the fill and the handles, and HEAD's merge is
shown to re-end the bar at `start + own days - 1`.
⚠️ **Not verified signed-in** — the anon key has no grants on `project_schedule`. The derivation ran
against constructed rows; the notch has not been seen on screen, and no change order was inserted or
merged against the database. Insert one on a throwaway activity before trusting it on live work.

`MODULE_V` → `20260907f`.

### One line item per main-contract activity, hollow Detail levels, and the trade/WBS disagreement named (2026-09-07) — jasantos2

Three asks in one prompt, and one of them was a question rather than a bug.

### 1. A change order no longer generates a second main-contract row
Owner: *"recently we have a system wherein if a change order activity is inserted between a main
contract activity a separate line of the main contract activity is generated. Now i want to retain
the single line-item for the main contract activity."*

`splitBuild` no longer cuts the host in two. It keeps its id, its name, its start and every one of
its own days; its **finish moves out by the change order's duration** — the same time impact the
two-row model produced, now carried by one bar. The change order is the only row created.

- **Nothing to re-point.** The old model *had* to send every successor to the continuation row or the
  successor would start while the second half of the work was still going. The row that followed the
  host is still the row that follows it, so that entire failure mode leaves with the second row —
  `repoint` and `renumber` are now always empty.
- **The change order is linked `SS+<days worked before the interruption>`**, not FS. Under the two-row
  model the host was truncated at the cut, so "after the host" was true. With one uncut line an FS
  link would claim the variation starts after the *whole* activity finishes — false, and it would
  slide the change order to the wrong end of the bar the next time anything recalculated.
- **`duration_days` is written to match the new span** (own days + the change order's). The scheduling
  engine derives a finish from a duration and would otherwise pull the bar back to the old date.
- ⚠️ **THE HONEST COST of one line.** The date-span-weighted roll-ups (`_vsPct` and friends weight by
  `dayDiff(start,end)+1`) now see the host spanning the change order's days too, so that window is
  counted in **both** rows. Two rows tiled the window exactly and did not. That is the trade for a
  single line item and it was the owner's call; if it ever matters, weight by `duration_days`.
- **Legacy splits are untouched.** `mergeSplit` ("Merge split back into one bar…"), `splitLabel`
  ("part 1 of 2") and `splitSegsOf` all stay, so rows already split in the database keep reading
  correctly and can still be collapsed. `splitRenumber` was **deleted** — it renumbered the segments
  of a group, there are no new groups, and it had no caller left. Unreachable code that looks
  maintained is the thing this module keeps having to re-discover.
- The dialog, its live preview, the confirm and the toast all describe one bar now: where the work
  stops, the `SS+n` link, the day it finishes, and "no continuation row is created".

### 2. The unavailable Detail levels are drawn hollow
Owner: *"if the per tower or consolidate option is chosen, can you at least hollow the options for the
other levels of details."* Right — yesterday's change only added the `disabled` attribute, which
stops the click but leaves the button looking live, and a control that looks live and does nothing is
the silent failure this module keeps recording. `.ps-vs-seg > button:disabled` is now transparent,
dimmed, italic, dashed-divided and `cursor:not-allowed`, in **both** copies of that ruleset (the file
carries the vertical-stacking block twice). The tooltip still carries `VS_MIX_NOTE`.

### 3. "Why is there an error for the structural works trade?" — there isn't one
Owner: *"why is there an error for the structural works trade? it detected activities under the site
dev works trade?"* Nothing was mis-detected. `workOf()` is documented **"its own field wins;
otherwise the WBS says"** — so `A47480` / `A47490` / `A47500`, whose own **Trade** field reads
*Structural Works*, are drawn in the Structural building even though their WBS branch is
*Execution Phase › Site Development Works › Earthworks*. They then land in **— No level —** because
the Site Development branch names no storey, which is the ordinary truth for a gabion or a gravity
wall.

That disagreement is worth *seeing* every time rather than being explained once, so `_vsTradeConflict(r)`
marks it in the no-level list: a `≠ <branch>` badge beside the trade, naming both sides, saying which
one is being obeyed and what to fix (retag the Trade, or move the activity to the right branch). A
sentence appears above the table only when at least one row in it carries the mark.

### Verified
Slice-and-execute against the shipped file, never a reimplementation: `splitPlan`, `splitBuild`,
`splitFreeId` and `_vsTradeConflict` were cut out of `index.html` and executed against the app's own
`dayDiff`/`addDays`/`dstr`/`pd` (also sliced) — **48 assertions pass**, covering the one-row result,
the dates (a 10-day activity cut on day 5 with a 3-day CO finishes 3 days later at 13 days span), the
`SS+4` link, the CO id fallback, both refusal guards, and the badge across agreement / disagreement /
no-field / no-branch / null. Gated by controls: the **pre-patch** `splitBuild` sliced from HEAD is
executed too and is shown to create the continuation row, truncate the host to the cut, write
`split_group` and use a bare FS — so the suite bites. Inline script parses; `function NAME(` set vs
HEAD: **1 lost, `splitRenumber`, intentionally**. The 22 assertions from yesterday's level-1 rule
still pass.

⚠️ **Not verified signed-in** — the anon key has no grants on `project_schedule`, so no real project
was rendered and no change order was actually inserted against the database. The arithmetic and the
badge were executed; the on-screen and on-write results were not seen.

`MODULE_V` → `20260907a`.

### Vertical Stacking: combining trades draws the building at level 1 (2026-09-04) — jasantos2

Owner: *"whenever the option of mixing the different trades of a certain tower is chosen, pls
illustrate the vertical stacking in terms of level 1. Bc the zoning of trades may be different and
therefore may cause incoherent data when consolidating the trades."*

Right, and the setup is what makes it so. Zoning is stored **per trade** —
`cfg.zoning[trade].floors[].zones[].units[]`, each with its own ids — so Structural may pour a floor
in 6 zones while Architectural fits the same floor out in 2. And a stacking cell is keyed by the
zone **VALUE** (`_vsRowCells` → `ids.map(id => locValOf(r, id) || '—').join(' · ')`), so two trades
that both happen to call a zone "Z1" land in **one** cell, which then reports a single date, a single
percentage and a single slip over work from two different breakdowns. That is the incoherence, and it
is arithmetic, not appearance. The floor is the one axis every trade shares.

### The rule
- `_vsMixTrades = (_vsScope === 'tower' || _vsScope === 'all') && tradesShown.length > 1;` — set once
  the trade selection is final (after the `_vsTradeSel` filter, where `tradesShown` is known), and
  `detail` is resolved from it. `Per trade` never mixes: each card there is one trade.
- `_vsDetailNow()` returns `1` when mixed. **The clamp lives here, not in `_vsMaxDetail()`**, so the
  deeper Detail buttons stay on screen and the planner's own choice of 2 or 3 survives a switch back
  to Per trade. Clamping the button loop's bound would have both hidden that the choice exists and
  silently reset it. All five call sites inherit the clamp.

### It says why, in three places
- The **Detail buttons** for 2 and 3 are `disabled` when mixed, with `VS_MIX_NOTE` as their tooltip.
  A control that looks live and is then overridden is the silent failure this module keeps recording.
- The **toolbar axis caption** appends `— levels only (trades combined)` and carries the note.
- The **PDF meta row** says `— levels only (trades combined; each trade zones its floors differently)`.
  A printed sheet outlives the screen that knew why.

### Nothing is hidden and nothing is lost
**Per trade** still draws each trade at its own full zone/unit depth — that is where a per-trade
zoning question belongs — and **narrowing the chips to a single trade un-mixes the view**, bringing
the zones straight back on Per tower and Consolidated too.

### Verified
Slice-and-execute against the shipped file (never a reimplementation): `_vsDetailNow` and the
`_vsMixTrades` line were cut out of `index.html` and run — 22 assertions pass, covering the clamp,
the max-detail clamp still applying when not mixed, `_vsDetail` left untouched, and the flag across
`trade`/`tower`/`all` × 0/1/2/3 trades. Gated by controls: the **pre-patch** `_vsDetailNow` sliced
from HEAD returns 3 where the patched one returns 1, and `VS_MIX_NOTE` is absent from HEAD — so the
suite bites. Inline script parses; `function NAME(` set vs HEAD: **0 lost**.
⚠️ **Not verified signed-in** — the anon key has no grants on `project_schedule`, so no live project
was rendered. The clamp is pure logic and was executed; the on-screen result was not seen.

### ⚠️ Finding, not touched: the Consolidated trade split has never rendered
`_vsTowerSVG`'s 4th parameter `tradeSplit` and its helper `_vsRowTradeCells(list, trades)` are fully
implemented and committed, and **no call site passes them** (14736, 15725, 15732, 15740). Its own
comment says Consolidated "used to merge every trade into ONE cell per level painted brand red, so
the one view whose whole purpose is comparing trades was the one view in which you could not tell
them apart" — so that earlier owner-requested split is dead code on screen today. Left alone: the ask
here was level 1, and wiring it is a feature change nobody asked for. Worth a decision.

### Also in this commit
- **Two stale pointers fixed** (36315, 36336): `Run Group ▸ Match WBS to locations…` →
  `Run Schedule Setup ▸ Floors & Zones ▸ Match WBS to locations…`, matching where it actually lives.
- ⚠️ **305 lines authored by a concurrent session**, carried in because they were already in the
  working tree: the slice-3 *"Adopt from the WBS"* block (`adoptDimMap`, `adoptKindOf`, `adoptRankOf`,
  `adoptNorm`, `adoptHas`, `adoptScan()`, `openLocAdopt()`) plus 3 pointer rewordings (14651, 15680,
  15683). **I did not write, review or verify them.** `openLocAdopt` is wired to **no button** — there
  is no `b-locadopt` handler — so it is unreachable and **nothing in the UI changes**. One line of
  wiring is the next step whenever that is wanted.
- `MODULE_V` → `20260904g` (`dashboard.html`, `modules.html`, and the fallback in
  `assets/js/modules-grid.js` — all three).

### The cold open: the matcher reads the saved setup when none is loaded (2026-09-04) — jasantos2

Owner: *"fix the cold open gap."* The gap flagged in the entry below: `ScheduleBuilder` only holds a
`cfg` once a setup has been loaded this session, so the catalogue the value boxes offer was empty in
the case it exists for — a **staged import** being matched before the setup is built, or a setup that
was never opened this session.

### The fix
- `catalogueFrom(c)` — the derivation, moved out of the export and taking the cfg as an **argument**.
  ⚠️ The tower helpers (`towerList` / `towerLabel` / `towerIdOf`) are bound to the LOADED cfg and could
  not be used, so the tower name is resolved from `c.towers` by the same rule (`name || code || 'Tower'`,
  `blankTowers()` when empty). `locCatalogue()` is now `catalogueFrom(cfg)` — unchanged behaviour.
- `ScheduleBuilder.locCatalogueFor(projectId)` — reads `schedule_builder` for that project and derives
  the catalogue from the saved row.
- The wizard fires it **only when the sync catalogue is empty**, and does **not await** it: the modal
  opens instantly on the old free-text behaviour and the places appear a moment later, with a toast
  and a repaint. If the planner closed it meanwhile (`m.el.isConnected`), nothing happens.

### ⚠️ What it deliberately does NOT do
- **It never loads the setup into the builder.** Nothing is assigned to `cfg`, `curSetupId`, `curPid`
  or `mode`, and nothing renders. Adopting a setup as a side effect of opening a matcher would pick
  one of several packages' setups behind the planner's back, and would discard a staged import that is
  being reviewed. It is a read, and it stays a read.
- **The open setup wins, and when one is open no other is consulted.** If `curSetupId` is set, that row
  is read and only that row — a planner on a half-built setup for Package B must not be offered Package
  A's floors because A was saved more recently. Only when nothing is open does the builder's own
  `pickDefaultSetup` rule (most recently edited) choose.
- **Every failure returns the loaded cfg's catalogue** (usually `{}`): no table, no grants, no setup
  saved, wrong project → the matcher behaves exactly as it did before any of this existed.

### Verified
20 checks, again by slicing `catalogueFrom` and the wizard helpers out of the shipped file and running
their own source. Four are new and cover this fix: a **foreign** cfg derives its own tower and its own
floors *tagged with its own tower*, reading it does **not** disturb the loaded catalogue, and a cfg with
no towers falls back to `blankTowers()`. ⚠️ The harness deliberately does **not** define
`towerList`/`towerLabel` — with them defined it could not tell whether the derivation was reading its
argument or the loaded cfg. Parse check clean; function-set diff vs HEAD **0 lost, 3 added**.
⚠️ **Not verified signed-in:** the `schedule_builder` read itself has never run from here (the anon key
has no grants), so the async path is unproven on real data — only the derivation it feeds is.

### The WBS matcher picks from the project's places — LBS proposal, slices 2 + 1 (2026-09-04) — jasantos2

Owner: *"build slice 2 first, then slice 1."* The first code from
[`docs/lbs-abs-setup-step-proposal.md`](../../docs/lbs-abs-setup-step-proposal.md). Built in the order
asked, which is also the order that pays: slice 2 is the benefit, slice 1 is what it needs.

### What was wrong
`Match the WBS to your Location Breakdown Structure` ended in a **free-text box**. The project's actual
places live in `cfg.zoning[trade].floors` — **inside the ScheduleBuilder closure, per trade** — so
nothing outside it could say what the floors ARE, and the matcher had nothing to offer. On a migrated
schedule (whose WBS *is* the breakdown, and which is the case the owner named) the planner re-typed the
value for every branch, and each variant spelling — `2ND FLOOR`, `2nd Flr`, `2nd Floor` — became a
separate floor in the Vertical Stacking, in the grouping dimensions and in the Location columns.

### Slice 1 — `ScheduleBuilder.locCatalogue()`
The list of places, **derived, not stored**: no table, no migration, no second source of truth. It
reads the same `cfg` the push reads and returns `{ <location level id>: [{ value, dim, kind, tower }] }`.

⚠️ **The values are the strings `locMapOf` would write, character for character** — tower =
`towerLabel`, floor = `name || code`, zone/unit = `code || name`, each under the level `locLevelFor`
resolves. A catalogue that offered a *prettier* spelling than the push writes would manufacture the
very duplicate it exists to remove. Order is the setup's own order (`cfg.towers`, then floors
bottom-up per trade — what `dimOrderIndex` sorts the pushed WBS by); first spelling seen wins the
de-dupe across trades. A dim with **no level resolved contributes nothing** — never a next-free-column
fallback, which is the fault the `locMapOf` note already warns about.

### Slice 2 — the matcher reads it
- The value box gets a `<datalist>` of that level's places, with the floor's **type** and **tower** as
  the option label. Switching the *Location level* dropdown switches the list, because the places
  belong to the level.
- A badge beside each box: **✓ defined** (a place the setup knows), **≈ Ground Floor** (differs from a
  defined place by case/punctuation only), **+ new** (not in the setup — allowed, just not aligned).
- One button above the table: *Adopt the defined spelling for N values*. **That is the migration fix**
  — the whole re-typed schedule reconciled to the setup in one explicit click.

### ⚠️ What was deliberately NOT done — the owner's *"no logic whatsoever should be conflicted"*
- **The free-text box stays** (proposal §5). A `<datalist>` suggests; it never constrains. A branch the
  setup does not cover must stay matchable.
- **Nothing is rewritten silently.** A near-miss is *flagged*, and snapping it is a click the planner
  makes. A silent rewrite would change what Apply writes without anyone asking.
- **No new storage, no new format.** The `location` jsonb keeps storing **strings**, `location_levels`
  and its `match` table are untouched, `locGuessLevel` / `locGuessValue` / `locTowerToken` /
  `locGroupingReason` and the assigned/excluded overrides are unchanged, and the clear-pass on Apply is
  untouched.
- **It degrades to the old behaviour exactly.** No setup loaded → `{}` → no datalist, no badges, no
  snap bar. `ScheduleBuilder` only holds a `cfg` once the Schedule Setup tab has loaded one, so on a
  cold open of the Project Schedule the wizard is the free-text box it has always been. ⚠️ **Not
  verified:** whether planners routinely open the matcher before the Setup tab. If they do, the
  catalogue is empty when it would help most, and the fix is to load the setup on demand — one call,
  but it needs a live project to justify.
- The badge is patched **in place**, never by re-rendering the tbody: the planner is typing in one of
  those inputs and a rebuild would take the caret with it.

### Verified
16 checks, by **slicing `locCatalogue`, `catFor`, `catNorm`, `catState` and `catListId` out of the
shipped file and executing their own source** (no reimplementation): tower/floor/zone/unit values and
their order, de-duping across trades, `kind` + `tower` carried on a floor, a missing level contributing
no key, `cfg == null → {}`, and the snap rule both ways — `GROUND  FLOOR` and `2ND FLOOR` resolve,
`Ground Floor Zone A` does **not**. Plus a known-missing control, the inline-script parse check, and
the function-set diff vs HEAD (**0 lost, 11 added**). ⚠️ **Not verified signed-in** — no live project
from here (anon key has no grants), so the datalist, the badges and the snap button have not been seen
on real data.

### Proposal — define the breakdowns FIRST: a two-pane LBS / ABS step (2026-09-04) — jasantos2

Owner: *"what if instead of defining the number of floors basements … there should be an earlier step
in defining the locations and groupings of activities … left pane … L1 towers, L2 levels, L3 zones …
right pane is the groupings of activities … and then … an illustration what the zoning of per trade
would look like in a vertical stacking view. However no logic whatsoever should be conflicted. The
purpose is to mitigate the difficulty of the matching of WBS especially when a schedule is migrated."*

Written up as **[`docs/lbs-abs-setup-step-proposal.md`](../../docs/lbs-abs-setup-step-proposal.md)**.
**Nothing implemented.**

### Why it is a proposal and not a commit
This is a new authoring surface over three data shapes that were built at different times, in a module
that has taken **fifteen fixes today** — several of them for state that was already subtly out of step
between two screens. Building it blind, unverified against a live project, is how the next week of
screenshots gets written. The design is the deliverable; the code follows once the open questions in §7
are answered.

### The diagnosis it rests on
The location breakdown lives in **three** places that never met:

| what | where | shape |
|---|---|---|
| the dimensions (Tower/Level/Zone) | `location_levels` | project-wide, ordered |
| the **places** (Tower 1, B2, GF) | `cfg.zoning[trade].floors` | **per trade**, in the setup JSON |
| the values on activities | `location` jsonb | free strings |

So there is **no list of the project’s places** — which is why the matcher offers a free-text box and
the planner re-types the value for every branch. That *is* the reported difficulty. It is also why
`Copy Structural floors/zones → all trades` has to exist, and why a migrated schedule (whose WBS
*is* the breakdown) gets re-typed by hand.

### ⚠️ The constraint is the hard part, and it is answered clause by clause
*"No logic whatsoever should be conflicted"* — §3 is a table of every existing behaviour that could
conflict and how it survives. The rule that makes it work:

> The new step is an **authoring surface over data that already exists**, not a new source of truth.
> Nothing downstream learns a new format.

Concretely: per-trade zoning is **kept** (the LBS is the catalogue; which places a trade touches stays
in *Scope per zone*, which already has `cfg.scopeOff`); `floor.kind` and `towerId` are the
same fields edited elsewhere; `generate()`, `buildTree` and the push read `cfg.zoning` as
they do now, only derived rather than typed; and the LBS is **derived on first open**, so a project
that never opens the step behaves exactly as today.

⚠️⚠️ **The single most important line in the document:** the `location` jsonb keeps storing **strings,
not node ids**. Storing ids would orphan every existing and imported row. The LBS node *supplies* the
string; it does not replace it.

⚠️ `locTowerToken` / `locGroupingReason` and this week’s assigned/excluded overrides are **kept
unchanged** as the fallback for unmatched branches. A guess that is never consulted costs nothing;
deleting it would break every project that has not run the new step.

### Sequenced so the first slice is useful alone
LBS tree + derive-from-existing → matcher picks from the tree (most of the benefit) → *Adopt from the
WBS* (the migration button) → ABS tree → stacking preview. None requires the next.

---

**Verified: 35 checks — on the DOCUMENT, not on behaviour, because there is no behaviour.** Every
identifier it names (`cfg.zoning`, `cfg.scopeOff`, `locTowerToken`, `multiTower`,
`dimKey`, `activity_udf_defs` …) is asserted to exist in the shipped source, and each specific
claim is checked against it: the four `floor.kind` values, that zoning really is per-trade, that the
copy-to-all-trades button really exists, that `location` really stores strings keyed by level id,
that `location_levels.match` is really written by the matcher. A proposal that misdescribes the code
is worse than none, because the next reader builds on it.

⚠️ `MODULE_V` is **not** bumped — no application file changed.

### The trade selector leads, BL and ACT are told apart, and the baseline has a name (2026-09-04) — jasantos2

Owner: *"pls put the trade on the top, also can you emphasize which is the actual and which is the
baseline. Also for the planned Baseline in vertical stacking, pls indicate if it is BL0 or maybe another
current baseline or BLX something."*

### 1 The trade selector is now the first row
It sat **below the entire toolbar** — under the view controls, the legend sentence and the
stacked-activity count. So the control that decides *what is on screen* was the last thing on the way
to the buildings, and on a narrow window it wrapped below the fold entirely. Which trades you are
looking at is the first question the panel answers, so it is the first row.

### 2 ⚠️ The compare cell says BL and ACT, and they no longer look alike
The two rows were tagged **P** and **A** in the same weight and the same ink, one above the other —
two initials to be decoded from a legend the reader may not have on screen. **P** for *planned* is also
the wrong word for the thing: that figure comes from the baseline columns, not from a plan in the
abstract.

| | before | after |
|---|---|---|
| baseline row | `P  Oct 9, 26   66%` | `BL  Oct 9, 26   66%` — muted (72%), lighter |
| actual row | `A  Dec 13, 26  35%` | `ACT Dec 13, 26  35%` — full strength, bold |

⚠️ **The difference carries the meaning**, so it survives being glanced at *and* survives a greyscale
print — which "P" over "A" did not. The tag itself is always bold, so the word stays readable in the
muted row.

### 3 ⚠️⚠️ "Planned" now says WHOSE plan
Every planned date and planned % on that screen reads `bl_start` / `bl_finish`, and those
columns hold **whichever saved baseline was last "Set primary"** — `setPrimaryBaseline` overwrites
them. The screen said *planned* and never said whose.

New `BL_PRIMARY` + `blPrimaryLabel()`, surfaced in the basis label, the legend sentence and the
PDF meta line:
- the Planned basis reads **planned · Baseline 14-Nov-25**
- the Compare basis reads **planned (Baseline 14-Nov-25) vs actual**
- the legend spells out *BL = the baseline (**name**) date & %, then ACT = the actual date & % in bold*

⚠️ **The NAME is the label, not a made-up "BL1".** Baselines here are user-named (*Baseline 14-Nov-25*,
*Imported Rev C*), there is no numbering scheme, and inventing one would be a second vocabulary for the
same object. **BL0** stays as the FALLBACK, because that is already what this module calls the `bl_*`
columns when nothing is recorded — so a project with no primary set reads exactly as it did before.
⚠️ The fetch is as tolerant as the other optional tables here: no migration, no grant, or no primary
set → `null` → every label falls back to BL0 and nothing else changes. One row, two columns.

---

**Verified: 467 checks.** `blPrimaryLabel` is executed for a named baseline, an imported one, no
primary at all, and a primary whose name is blank (→ BL0, not an empty label), with a control that it
never invents "BL1"; `_vsBasisWord` is executed for all three bases. The cell change is diffed
against the previous commit: no opacity before, role-dependent opacity and weight now, ACT strong and
BL muted, and the old P/A tags gone. 0 functions lost, 1 added.

⚠️ **NOT verified visually** — the strings and the weights are checked, how the muted row reads on screen
is not. ⚠️ *"put the trade on the top"* was read as the **trade chip row** within the stacking panel; if
what was meant was the trade inside each cell, say so and it is a small change.

### "This IS a place" is now as durable as "this is not" (2026-09-04) — jasantos2

Owner, after the previous fix: *"how come? ... do i need to press anything for the substructure level to
be detected?"*

**Yes — `Apply to activities`.** And a gap in yesterday's fix meant that on some projects even
that would not have been enough.

### The gap
The veto now yields to an explicit assignment, and it read that assignment from
`location_levels.match` — a **database column behind the 2026-08-05 migration**. The wizard is
deliberately tolerant of that column being absent: *"the values are still applied, only the memory is
lost."* Which means on a project whose migration has not run, the planner answered, the answer was
**applied to every activity**, and the answer was **forgotten one line later** — so the stacking vetoed
it again.

⚠️ **Two halves of one decision were recorded in two places with different durability.** The
*grouping-only* half has always gone to localStorage; the *assignment* half went only to the DB. That
asymmetry is what let them get out of step.

New `loadLocAssigned` / `saveLocAssigned` mirror the assigned values to localStorage beside the
exclusions. The DB column stays primary and is still written — this is the belt.
- ⚠️ Values not seen in the current session are **carried forward**, exactly as the exclusions are, so
  filtering the wizard list before pressing Apply cannot silently forget an earlier decision.
- ⚠️ Browser-local, like the exclusions: a colleague on another machine reads the DB copy where the
  migration exists and falls back to the heuristic where it does not — strictly better than before,
  when everyone fell back to the heuristic.
- ⚠️ **Grouping-only still beats a locally-recorded assignment.** Checked.

### The answer to the question
**Schedule Setup → 5 · Floors & Zones → Match WBS to locations… → set the level → Apply to
activities.** That button is the whole trigger: it writes `location` onto the activities already in
the schedule, records both halves of the decision, and (since `20260903v`) repaints the grid and
the stacking immediately. **No re-push is needed** — the push creates activities; the matcher only
fills in where they are.

⚠️ It only touches activities that **have a WBS code** and sit **under the Execution Phase branch**.
⚠️ The screenshots were taken on `?v=20260903g`, which predates all of this.

---

**Verified: 436 checks.** The veto is executed with **no `match` column at all** — a locally-recorded
assignment is honoured, an unassigned value is still vetoed, and a grouping-only mark still wins. The
wizard's apply block is asserted to write both halves and to carry forward what it did not see. Plus
the whole previous suite, including the checks that an *unassigned* "Substructure", a trade name and a
phase name are all still vetoed — the default is unchanged. 0 functions lost, 3 added.

⚠️ **NOT verified signed-in.**

### A basement that always landed in Tower 1, and a tagged location the stacking refused (2026-09-04) — jasantos2

Two reports, unrelated causes.

### 1 "+ Basement" ignored the selected tower
Owner: *"the adding of basement is not working, meaning when i click add basement, it always adds to
tower 1 even if i selected another tower."*

Exactly so, and the line directly above it in the source shows why:

    + Add floor  ->  { ... kind: "typical", towerId: _twAct, zones: [] }
    + Basement   ->  { ... kind: "basement",                 zones: [] }

`towerIdOf()` falls back to the **first** tower for a floor that names none — right for a legacy
config, wrong for a floor created seconds ago in front of a tower picker. So every basement silently
became Tower 1's.

⚠️ **The count was wrong for the same reason.** It counted basements across **all** towers, so adding
B1 to Tower 3 while Tower 1 already had two produced `B3`. `+ Add floor` already scoped its
count with `floorsOfTower`; the basement now matches it. Basements still insert at index 0
(deepest first).

### 2 ⚠️⚠️ AVR101: "Substructure" was tagged as a Level and the stacking still dropped it
Owner: *"how come the substructure even though it is tagged as a location, is not being detected in the
vertical stacking."*

Because `locGroupingReason` reads *Substructure* as a **structural-works term** and vetoes it. That
is the right **default** — a stage is not a storey, and banding by it puts a fake floor in every tower —
and it is precisely why that rule was left untouched when the tower work went in.

**But a default is not a verdict.** On this project the planner opened *Match WBS to locations*, saw the
branch, and filed it under **Level (L2)** with the value *Substructure* — **133 activities**. A guess
must not out-rank the person who was asked and answered.

New `_vsAssignedSet()` reads the values out of `location_levels.match` — which the wizard writes
as *{ branch name: value to store }*, so they are exactly the values a person looked at and called a
place. The order in `locIsGroupingValue` is now:

1. an explicit **grouping-only** mark wins (that is also a person answering);
2. an explicit **assignment** wins;
3. only an **unanswered** value falls to the heuristic.

- ⚠️ **The default is unchanged.** An *unassigned* "Substructure" is still vetoed, as are trade names
  and phase names — there are regression checks for all three.
- ⚠️ The two explicit sets are **disjoint by construction**: the wizard records a branch as excluded
  only when it has no level, so a value cannot be both. Grouping-only is still checked first anyway.
- ⚠️ The new set is cached beside the grouping set and cleared by the same `psSetupChanged`, so
  re-running the matcher takes effect immediately.

---

**Verified: 428 checks.** Both handlers are diffed against the previous commit (no `towerId` before,
`_twAct` now; unscoped count before, `floorsOfTower` now), and the shipped `towerIdOf` is
executed to show a floor naming no tower really does resolve to the first — the reported symptom,
reproduced. The veto is executed against AVR101's actual shape (a Level whose match table holds
*Substructure*): vetoed on the previous commit, honoured now, while an unassigned copy of the same word
is still vetoed and a grouping-only mark still beats an assignment. 0 functions lost, 1 added.

⚠️ **NOT verified signed-in.** ⚠️ The stacking reads what is STORED on each activity, so branches
matched before this fix need *Apply to activities* re-run — the values were written, but any that the
veto had cleared are gone until the matcher writes them again.

### Older entries

Archived by month, verbatim. Newest stay above.

- [2026-09](modules/project-schedule/changelog/2026-09.md) - 76 entries
- [2026-08](modules/project-schedule/changelog/2026-08.md) - 168 entries
- [2026-07](modules/project-schedule/changelog/2026-07.md) - 142 entries
- [2026-06](modules/project-schedule/changelog/2026-06.md) - 1 entries
