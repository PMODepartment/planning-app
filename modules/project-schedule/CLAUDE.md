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
- ⚠️⚠️ **IT SELF-SKIPS, and that is what makes adding a dim safe.** `dimKey` returns the same `' '`
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
