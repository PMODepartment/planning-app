## Two toolbar defects with one cause each: the group head hung left, and `.lg` had lost its rule (2026-09-02d) — fmlozano

Owner, from a live screenshot: *"The Ronquillo Group seem to be out of place from the project
selector. I still think we can improve how the legend looks like for the Activity(solid = done, pale
= remaining bar = forecast dates rail = planned)."* Both turned out to be measurable layout faults,
not taste — and the second explains why the owner typed `Activity(solid` with no space.

### 1 ⚠️ The group head hung 11.5px LEFT of the project it belongs to
The project name is not a text node: `enhanceProjectSelect` replaces the `<select>` with a
`.pd-psel-btn` that inherits `.pd-select`'s own padding + border, so its LABEL is inset from the
control's left edge — while `.ps-ws` was inset by a flat `2px`. **Measured against the shipped CSS:
name text at x=83.7, group-head text at x=72.2.** The two are stacked in the same column and are
meant to read as one block, so 11.5px of disagreement is exactly what "out of place" looks like.
`.ps-ws` now carries the trigger's own text inset (padding-left + border-width). **Verified: both
text origins at x=83.7 — 0px.**
⚠️ There is no CSS way to read a sibling's padding, so the value is a stated constant with a comment
naming what it must equal, and the harness asserts the two origins land within 1px instead.

### 2 ⚠️⚠️ `.ps-legend .lg` had been DEAD CSS since the marks were folded in
This is the whole of the legend complaint, and it was one stale selector.

When the marks became the leading entries of `#ps-actlegend` (2026-08-17) the `.ps-legend` wrapper
was **deleted**, so `.ps-legend .lg { display:inline-flex; align-items:center; gap:6px }` stopped
matching anything. Every chip in the activity legend has been unstyled ever since. Measured:

- `align-items` computed **`normal`** on all five chips, so each swatch **baseline**-aligned instead
  of centring — **`swCentreOff` −2 / −2 / −2 / −3**, the swatch riding above its own label.
- ⚠️ **And that is where the owner's missing space came from.** `#ps-view-schedule.ps-lsm .lg-lsmon`
  sets `display:inline-flex`, so the Activity chip — **alone among the five** — was a flex container
  with `gap: normal` (0). Its ` Activity ` text node and its `<em>` are separate flex items, and
  **flex strips the literal whitespace between items**. The other four chips were plain blocks, kept
  their spaces, and looked fine. So one chip rendered `Activity(solid`, which is precisely the string
  the owner quoted back. It was never a typo in the text.

Retargeted to `.ps-actlegend .lg`. **Verified: all five chips `display:flex`, `align-items:center`,
`gap:6px`, and `swCentreOff: 0` on every one** — plus the text now reads `Activity (solid = …)`.
⚠️ Kept at (0,2,0) so the two `#ps-view-schedule.ps-lsm .lg-lsm*` display rules (1,2,0) still decide
which chips are SHOWN; this only decides how a shown chip is laid out.

### ⚠️ Still open, and it is a design call, not a defect
The Activity chip measures **482px against 77 / 113 / 128 / 136** for the other four — 3.5× the
widest trade chip, and it visually swamps the colour key a reader actually came for. Fixing the
alignment makes it legible; it does not make it short. Put to the owner rather than chosen for them,
because the honest options trade against a rule this file already fought over: the three facts a
coloured bar encodes (rail = planned dates, extent = forecast dates, fill = done vs remaining) were
worded deliberately after "still to do" was misread as a forecast, so dropping one from screen is not
free. Not changed.

### ⚠️ The toolbar-width thread is closed by the owner's own screenshot
The previous entry left "1440 is still two lines — by 46px" open with the search box as the remaining
lever. Re-measured in a harness carrying the **real shell** (`.pd-app` flex row + a 64px collapsed
`.pd-sidebar` + `.pd-main`'s 22px padding — a bare toolbar over-reports available width by 108px and
my first harness did exactly that): the row needs **1377px**. At the owner's ~1920 screen it is one
line, which their screenshot confirms. No change made — the search box stays a real input.

### Verification
- Harness built from the shipped `<style>` block + `dashboard.css` + the real `ui.js` and `icons.js`,
  with `MARKS_LEGEND_HTML` **sliced verbatim** out of `index.html` and the project selector driven
  through the real `UI.enhanceProjectSelect`. Behind the standard gate (`visibilityState: visible`,
  `--pd-red` resolving).
- Parses (1 inline block); 0 NUL bytes; 1,447 function definitions, none lost; the dead
  `.ps-legend .lg` rule is gone (the one remaining match is the comment naming it).
- ⚠️ **Two harness faults of my own, both mine and not the code's:** `.replace(/\s+/g,' ')` written
  inside a JS **template literal** degrades to `/s+/g`, which silently ate every letter `s` and made
  the first text readout say `Mile tone` / `foreca t date`; and counting legend lines by distinct
  child `top` values always reports one extra, because the 0-height `.ps-tb-spacer` is vertically
  **centred** by `align-items:center` so its top is the line's midpoint. Count lines from the row's
  height.
- ⚠️ **Not verified signed in** — measured in the harness, not on a live project.
- `MODULE_V` → `20260902e` (origin had already shipped `d` for a different module change, so `d` was
  already in browsers and this fix would have sat behind a cached page).

## Vertical stacking: the cell body is never pale again — day mode was unreadable (2026-09-02) — eprobles

Owner: *"is there a way you can improve the visuals in this vertical stacking? … if it is on day
mode, please make it more visually appealing. Also for the color coding and visuals … choose better
colors or colors of text. and also in terms of orientation of the windows."*

⚠️ **ROOT CAUSE OF THE DAY-MODE COMPLAINT: every label was hard-coded `fill="#fff"`, and the light
theme drew the cell body as a 16 %-opacity wash of the trade colour on a white card.** White text on
a near-white box. Dark mode got away with it only because the card behind the wash is dark. The fix
is not a heavier font — it is that **the cell body is now always a saturated colour in both
themes**, and done vs remaining is a *brightness step on that one colour*:

| layer | what it is |
|---|---|
| 1 | the category colour, solid, across the whole cell |
| 2 | `--ps-vs-scrim` over it → the **remaining** tone (dimmer, same hue) |
| 3 | `--ps-vs-veil` 45° hatch → the texture that says "remaining" at a glance |
| 4 | the colour again, clean and undimmed, out to the POC → the **done** stretch |

Layer 4 is drawn **last**, so the done stretch *erases* 2 and 3 rather than sitting over them and the
boundary is a hard edge. Nothing about the meaning moved: fill = which trade, solid = how much is
done, border = early/on time/late. Three facts, still three channels.

- ⚠️ **The three tokens are CSS VARS (`--ps-vs-scrim` / `--ps-vs-veil` / `--ps-vs-edge`), not
  literals in the JS** — precisely so the two themes can differ; the SVG resolves them from the
  document. **They are re-declared in the PDF export's fixed light palette.** Change one and you
  must change the other or the print comes out as flat colour blocks with no done/remaining split.
- ⚠️ **The hatch pattern is a light veil now, not the trade colour.** It used to be the colour drawn
  over a wash of the same colour, which is exactly what made the light theme pale-on-pale.
- ⚠️ **Ink is chosen per cell from the colour's luminance** (`_vsLum` / `_vsInkFill` / `_vsTxtAttr`),
  and the halo flips with it. White is right for most of the palette but not for its yellow/amber —
  white on yellow is the same defect in a different hue. A non-hex colour (`var(--pd-muted)`, the
  un-towered band) falls back to white.
- ⚠️ The cell outline is `--ps-vs-edge`, not a fixed `rgba(0,0,0,.28)`: a black hairline is invisible
  on a dark card and heavy on a light one.

**The cards ("windows").** They still take their **content** width — that is deliberate and stays
(a one-zone tower must not sit in 660 px of dead space). What changed is that a *row* of them now
shares a height and hangs from a common top line instead of each card ending wherever its own drawing
does, which is what made a row read as debris rather than as a set. Plus a softer 14 px radius, a
two-stop shadow, a 1 px hover lift, and a header washed with the card's own `--tc` — on white that is
what stops eight cards looking like one grey table.

---

## Outline and Layouts folded into the View menu (2026-09-02c) — fmlozano

Owner: *"Yes fold Outline and Layouts into View too"* — accepting the two candidates I named at the
end of the scope/zoom pass. Both are view/layout questions, which is what `View ▾` already owns.

`Outline ▾` and `Layouts ▾` are gone from `.ps-tb-row`; `renderLayoutMenu` grows an **Outline**
section (after View) and a **Saved layouts** section (after Gantt settings).

- `renderCollapseMenu` / `renderViewsMenu` become `outlineSectionHTML` + `bindOutlineSection` and
  `layoutsSectionHTML` + `bindLayoutsSection`. Every handler moved verbatim — the >4000-row confirm
  on Expand all, `expandToLevel(parseInt(...))`, the per-project `ps_views` bundle (zoom, search,
  filters, grouping, column hidden/sort/renames/widths, Activity-Progress charts).
- The three `renderCollapseMenu()` call sites (`setGroupBys`, the full repaint, `applyView`) are gone:
  the menu is rebuilt on every open, so there is nothing left to keep in sync from outside.
- ⚠️ **`data-lyt`, NOT `data-view`.** The old Layouts menu marked saved layouts with `data-view`, and
  `renderLayoutMenu` already binds `[data-view]` to the six VIEW MODES. Pasting the section in as-is
  would have made clicking a saved layout call `_setView('Weekly client report')` and drop the planner
  on the fallback view. Asserted: exactly one `data-view=` producer is left in the file.
- ⚠️ **WBS levels are chips on one wrapping line, not a row each.** `maxDepth()` reaches 14 on a P6
  import; as stacked buttons that is taller than the rest of the menu combined. Measured: 6 levels on
  one 24px-chip row, **152px saved against stacked rows.** The chips use `border:1px var(--pd-line)`,
  the same token `.pd-btn` uses, so the affordance matches every other button in the app.
- ⚠️ Outline is omitted when `cur === 'stacking'`, exactly as the deleted
  `body.ps-vstack-on #ps-collapseto` rule hid the button — there is no grid outline to collapse while
  the building model is open. Saved layouts stays: it is meaningful in every view.
- Deleting a saved layout still keeps the menu open (`e.stopPropagation()` + in-place re-render), so
  clearing out several stale layouts does not need a reopen each time.

### ⚠️ THE FOLD WOULD HAVE SHIPPED A MENU YOU COULD NOT REACH THE BOTTOM OF
This is the whole reason the change is more than two string concatenations. `.ps-menu` is
`position:absolute; overflow:hidden` with **`max-height:none`**. With both sections folded in the menu
is **804px of content in a 900px viewport starting 209px down the page** — measured in the browser
against the shipped CSS with the real menu HTML generated by the shipped section builders:

- **Before the fix: `Reporting view` and `Reset layout to defaults` both measured `inViewport:false`
  and failed `elementFromPoint` — rendered, inside the menu box, and literally unclickable.** That is
  the same defect class the column chooser and the group menu each hit before; third instance.
- **After: clamped to 673px, scrolls, the box sits fully inside the viewport, and `Reset layout`
  hit-tests to itself once scrolled to.** Verified at 900 / 800 / 768 / 720 viewport heights.
- The fix is `anchorMenu(btn, menu)` — the existing pin-and-clamp the Colors menu already uses, not a
  new mechanism. ⚠️ `classList.add('open')` now runs BEFORE `renderLayoutMenu()`, or the anchor call
  inside it never fires on the first open. ⚠️ It re-anchors on EVERY render, not just on open:
  deleting a saved layout or toggling density rebuilds the menu at a different height.
- ⚠️ Fixed a pre-existing bug while there: `renderLayoutMenu` never hydrated its injected `data-ico`
  spans, so **Gantt settings and Reset layout have been rendering iconless**. `Icons.hydrate(lMenu)`.

### ⚠️ A sixth "brand red is not a text colour"
`＋ Save current layout…` came over from the old menu as `var(--pd-red)` at 13px/600. Measured on
`--pd-card`: **4.12:1 light and 3.40:1 dark — dark fails AA outright.** Now `--pd-danger-text`:
**5.84 light / 6.14 dark.** Everything else in the new sections passes too (muted heads and the chip
label 7.07 / 7.02; chip digits 16.3 / 12.22).

### The width, measured
- **Row needs 1590px → 1381px. 209px saved** (the two buttons were 98 + 102 + a divider, and nothing
  replaces them this time — unlike the scope/zoom fold, which bought back only 115px net).
- **One row now needs a ~1486px viewport, down from ~1720.** Bisected: 1398px of row width, + 88px of
  shell chrome.
- ⚠️ **1440 is still two lines — by 46px.** Close, but I am not going to claim it. The remaining
  lever is the 160px search box collapsing to an icon; not done, not asked for.
- On the owner's ~1920 screen it was one row before and after.

### Verification
- **42/42 executing the SHIPPED `outlineSectionHTML` / `bindOutlineSection` / `layoutsSectionHTML` /
  `bindLayoutsSection` / `esc`**, sliced by brace matching, against a selector-aware DOM shim (one menu
  now answers three different `[data-*]` queries). Covers chip counts at maxDepth 0 / 4 / 14, the
  integer arg to `expandToLevel`, the >4000-row confirm both ways, a hostile layout name escaped in
  both the attribute and the text, delete-keeps-the-menu-open, the full save bundle, and a cancelled
  prompt writing nothing. `esc` delegates to the shared `Fmt.esc`, so that is sliced out of
  `assets/js/db.js` rather than retyped.
- **33/33 and 40/40** — the reporting-view and scope/zoom suites still pass unchanged.
- Browser measurements above are against the shipped `<style>` block + `dashboard.css` + the real
  `ui.js`, behind the standard gate (`visibilityState`, `clientWidth >= 900`, toolbar not swallowed
  by `.pd-modulebar`).
- Parses (1 block); 0 NUL bytes; function-set diff vs HEAD: 2 removed, 4 added, all intended.
- ⚠️ Two harness faults of my own worth recording: a `[^)]*` regex could not cross `var(--pd-line)`,
  and `data-lvl="\d+"` does not match `data-lvl="all"` — both were wrong TESTS, not wrong code.
- ⚠️ A near-miss caught only by the leftover sweep: `cMenu` / `vMenu` were also used by two
  `addEventListener` calls ~500 lines away from `closeMenus`. Deleting the elements without those
  would have been a **ReferenceError at init that kills the entire module.** Grep for every use of a
  handle, not just the obvious one.
- ⚠️ **Not verified signed in** — no live project, so the Outline chips have never run against a
  real `maxDepth()` and the layouts list has never been read off real `ps_views` data.
- `.gitignore`: `**/_*_test.html` added. The existing patterns are filename-specific despite the
  comment above them saying "match the WORD" — my new `_menu_test.html` harness slipped straight
  through, which is exactly how four harness files reached production on 2026-09-01.
- `MODULE_V` → `20260902c`.

## Contract scope and timeline zoom folded from segments into menus (2026-09-02b) — fmlozano

Owner: *"Yes let's fold the scope and zoom into menus"* — taken up from my own offer at the end of the
previous prompt, where the one-row toolbar was still two lines at laptop widths.

Both 3-button `.ps-seg` segments become labelled `.ps-menu-wrap` buttons in the pattern established for
`View: Split ▾`: the button NAMES the current value, the menu carries the options with ●/○ marks.

- **Scope** stays a top-level, one-click control. ⚠️ That is a standing rule in this file, not a
  preference: the segment's own comment records that it must not live only in the Filter menu, because
  *"show me the change orders"* is a question a planner asks constantly and a filter three clicks deep is
  one nobody discovers. A dedicated menu button keeps all of that.
- ⚠️ **The button carries the state as COLOUR, and Blended is deliberately unlit.** The segment always
  showed one red pill — including on the default — and a permanently-lit control stops being seen. Now
  only an actual narrowing lights: red for Main, the CO amber `#E08A3C` for Change orders, matching the
  `.ps-scopetag` chips so the colour language is unbroken. So "you are filtered" is still readable
  without opening anything, and the resting state is quiet.
- ⚠️ **Menu items are bound inside `syncScopeSwitch` / `renderZoomMenu`, NOT once at init.** Both
  rebuild their menu's `innerHTML`, which destroys any handler bound earlier — the old init-time
  `_scSeg.querySelectorAll('[data-scope]')` binding is removed for that reason.
- ⚠️ **The wrappers keep the ids `ps-scope` / `ps-zoom`**, so two behaviours survive untouched:
  `syncScopeSwitch`'s `seg.style.display` (the control hides itself on a project with no change orders —
  *"a control with nothing to find"*) and the `body.ps-vstack-on #ps-zoom` rule that hides the timeline
  scale while the stacking view is open.
- ⚠️ `applyView` used to re-sync the segment with `querySelectorAll('#ps-zoom button')`. Under the new
  markup that selector also matches the TRIGGER, whose `dataset.zoom` is undefined — so it would have
  silently cleared the active mark on every saved-layout restore. Replaced with
  `_paintZoomBtn(); renderZoomMenu();`.
- The zoom menu still points at the two finer controls, which are unchanged and remain the fast path:
  drag a column edge in the date header, or Ctrl+scroll over the chart.

### ⚠️ THE HONEST ARITHMETIC — this bought less than I implied when I offered it
Measured at 1280 in the harness, per control: **scope 227px → 151px, zoom 173px → 135px**, plus one
divider. The row needs **1705px → 1590px — 115px saved, not the ~400px the segments occupied**, because
a labelled menu button costs 286px back. I described the two segments as "~400px of the row" without
netting off what replaces them.
- **One row now needs a ~1720px viewport, down from ~1815.** Confirmed by bisection: 1680 → 2 lines,
  1760 → 1 line.
- On the owner's ~1920 screen it was one row before and is one row now; what changed there is density,
  not line count.
- **At 1680 it IS one line in two real cases**: in Reporting view (Actions / Add / Schedule / `?` are
  hidden), and on a project with no change orders (the scope control hides itself).
- **Getting to one row at 1440 needs ~280px more.** The candidates, unchanged by this pass: `Outline ▾`
  (98px) and `Layouts ▾` (102px) are both view/layout controls that belong in the `View ▾` menu
  alongside Row density and Gantt settings, and the 160px search could collapse to an icon. Not done —
  it was not asked for, and folding Outline/Layouts is a real judgement call about how deep the View
  menu should get.

### Verification
- **40/40 executing the SHIPPED `syncScopeSwitch` / `renderZoomMenu` / `_paintZoomBtn` / `_scopeLabel` /
  `_scopeCount` / `_zoomLabel`**, sliced by brace matching, against a DOM shim whose `innerHTML` setter
  materialises the `data-scope` / `data-zoom` items — so the shipped `querySelectorAll` and the shipped
  `onclick` binding really run. Covers: the hide-with-no-COs rule both ways; the label for all three
  scopes; only-a-narrowing-lights and both lit states clearing on return to Blended; the main-only
  `_scopeSwitchTitle` appearing on Main and NOT on CO; the three counts including Blended = main + CO;
  a click doing everything the segment did (`_clearMainOnlyShift`, `buildFilterMenu`, both repaints,
  closing its own menu); handlers surviving a rebuild; and `renderZoomMenu` being a no-op with no menu
  present (`applyView` calls it on every saved-layout restore).
- Static: both segments gone, no leftover `#ps-zoom button` selector, `applyView` restores both,
  `closeMenus` closes both, the vstack hide rule still resolves, both menus stop click propagation.
- Parses (1 block); 0 NUL bytes; **0 functions lost**, 5 added.
- ⚠️ A bug in my own test file first: `/...<\/span>/` — an unescaped `/` inside a regex literal
  terminated it. Three occurrences; the file would not even parse.
- ⚠️ A harness trap worth keeping: the Browser pane opened at **594px**, below the 700px phone
  breakpoint where `.ps-toolbar` is `display:none` by design — so every item measured as invisible and
  the widths came back as `-5`. Gate width measurements on `clientWidth >= 900`.
- ⚠️ **Not verified signed in** — no live project, so the scope counts have never been read off real
  `scopeOf()` data and the hide-with-no-COs path has never run against a real project.
- `MODULE_V` → `20260902b`.

## Toolbar finished, the project switcher un-stretched, a foldable legend, and Reporting view becomes a screen (2026-09-02) — fmlozano

Four owner items in one pass, all measured in a real browser against the shipped CSS rather than
reasoned about.

### 1 · Toolbar redesign finished (the previous prompt's work, completed)
The three dangling `ps-tb-labeltoggle` references are gone — the CSS rule, the `body.ps-reporting`
selector, and the wiring block. Every toolbar control carries its own word now, so labelled mode has
nothing left to reveal. `.ps-topbar-tools .pd-btn.ps-tb-labeled` is a DIFFERENT rule (File / Reports /
Health in the module bar) and stays.

### 2 · ⚠️ The project switcher was stretched by dashboard.css, NOT by this module
Owner: *"the project switcher is extended unnecessarily."* Root-caused by measurement, not by reading:
`UI.initModuleTopbar()` restructures every module topbar into `.pd-tb-split > .pd-tb-main`, and
dashboard.css then gives `-projctx` `flex:1 1 220px; max-width:420px` and its trigger
`width:100%; **max-width:none**` — explicitly cancelling the 260px cap this module sets. Add
`.pd-psel-btn { justify-content:space-between }` and a 124px project name renders in a 420px box with
the caret stranded at the far edge.
- **Measured before/after at 1280 by re-asserting dashboard.css's own rule last: 420px wide with a
  259px gap between the name and the caret → 167px with a 6px gap.** Restoring the override reproduces
  the 420px exactly, so the test bites.
- ⚠️ The long selectors are load-bearing: dashboard.css's rule is (0,4,0), so a plain
  `.ps-projctx .pd-psel-btn` (0,2,0) loses and the fix would have silently done nothing.
- Consistency: the data-date badge was ~26px next to 34px everywhere else; it is 34px now.

### 3 · ⚠️ A REAL DEFECT MY OWN TOOLBAR REDESIGN INTRODUCED, found while measuring the above
`.ps-tb-row` was `flex-wrap:nowrap` with `overflow:visible`. **Measured at a 1280px viewport: the row
needed 1660px against 1256px available, and because dashboard.css sets `body { overflow-x:clip }` the
last ~400px — Analyze, Colors, the shortcuts button and the whole search box — were not merely
off-screen but UNREACHABLE, with no scrollbar to say so.** Six controls clipped, 518px of dead scroll.
- ⚠️ It was already overflowing by ~215px BEFORE this session; giving each view control its word made
  it worse. The owner's own screen is ~1920px, where it does fit on one line — which is why it was
  never reported and why I nearly shipped it.
- **Fix: the row wraps.** `overflow:visible` is unchanged, so the `.ps-menu` popovers still escape —
  the nowrap was never what protected them (the 701–1140px band already wrapped for this reason).
- **Measured after: 1920 → one row, 0 clipped, 0 page scroll. 1440 → 2 lines, 0 clipped. 1280 → 2
  lines, 0 clipped.** Re-asserting `nowrap` at 1280 reproduces the 6 clipped controls, so the check bites.
- ⚠️ A measurement trap of my own: `.ps-tb-spacer` is a 0×0 auto-margin element whose baseline sits
  elsewhere, and counting distinct `top` values reported ONE row as three. Exclude zero-width items.

### 4 · The activity legend folds
Owner: *"the panel below is always shown. If we can have the option to minimize this similar to the
activity details panel."* A chevron in the legend head folds it to a single line that still names the
field the colours mean — a bare chevron over an empty strip would leave a reader unable to tell the
legend was ever there. **Measured: 74px → 39px, reversible, chevron rotates 180°.**
- ⚠️ The class sits on the HOST, which `renderActLegend` only ever replaces the innerHTML of, so a
  re-render cannot silently unfold it.
- ⚠️ The chevron is INJECTED markup, so `Icons.hydrate(host)` is required — the DOMContentLoaded pass
  only covers static markup, and without it the button renders empty.

### 5 · Reporting view is a SCREEN now, not a trimmed toolbar
Owner: *"the sidepanel is completely minimized and the whole bar where the project switcher is
minimized as well."* It now also hides the sidebar, the topbar and the module bar.
**Measured: 163px of vertical chrome → 0, and the content's left edge 64px → 0.**
- ⚠️ STILL PURE CSS ON THE BODY CLASS. The sidebar is hidden with `display:none`, deliberately NOT by
  toggling the shell's `.pd-collapsed` — `UI.initShell` persists that in `pd_sidebar_collapsed`, so
  driving it here would silently overwrite the planner's own sidebar preference and leave it changed
  after they exit.
- ⚠️ **Those bands carry the project name, the group head and the data date** — the three facts that
  make a screenshot trustworthy. They are not dropped: a `.ps-rep-bar` in the toolbar carries them,
  painted by `_repIdPaint()`. Do not remove one without the other.
- ⚠️ **The exit chip is now a real `<button>`, not a `::before` pseudo-element.** A mode that removes
  most of the app chrome must be leavable in one visible click, and a pseudo-element cannot be clicked.
- ⚠️ **`_applyReportingClass()` GATES ON THE SCHEDULE TAB, and this is safety-critical.** `switchTab`
  hides `.ps-toolbar` on every other view — which is where BOTH ways out live (the Layout menu and the
  exit chip). Without the gate, switching to the Planner Cockpit while reporting is on would leave a
  planner with no chrome at all and nothing to click. Asserted for all five other tabs.
- ⚠️ The identity bar is its OWN line, not an item in `.ps-tb-row`: measured inside that row it cost
  498px on a row that already needed 1660 of 1256, pushing the search box off screen. `.ps-toolbar` is
  a flex COLUMN, so a sibling div is a free line that competes with nothing.
- ⚠️ **A WCAG defect found by measuring, and it is the fifth time in this repo:** the exit chip was
  brand red at 10.5px/700 = **3.74:1**, under AA — the same defect the `::before` chip it replaces
  already had. Text is `--pd-danger-text` now (the paired token added for exactly this); the BORDER
  stays brand red, since a component boundary is held to 3:1, which 3.74 clears.
  **All text passes in both themes: worst 5.31 light / 7.47 dark.**

### Verification
- **33/33 executing the SHIPPED `_applyReportingClass` / `_repIdPaint` / `applyLegendFold` /
  `setLegendFold`**, sliced out of index.html by brace matching, never reimplemented — the tab gate for
  all six tabs, escaping, the omitted separator when there is no group head, persistence, idempotence
  across re-renders, and null-safety on every path (`_repIdPaint` runs from `renderDataDateBadge` on
  every load).
- **In a real browser against the shipped CSS + the REAL `ui.js`** (`initModuleTopbar` and
  `enhanceProjectSelect` both actually run, so the cascade under test is the one that ships), at
  1280/1440/1920, light and dark: every number above, plus reporting toggling **byte-identically
  reversible**.
- ⚠️ **The harness produced one confidently wrong result first**, worth recording: my topbar slice
  left `.pd-topbar` unclosed, the parser nested `.pd-main` inside it, and `initModuleTopbar` then
  bucketed the whole toolbar into `.pd-modulebar` — so hiding the module bar took the toolbar with it
  and it read exactly like "reporting view hides its own way out". A pure harness fault. The sanity
  gate now asserts the toolbar is NOT inside the module bar.
- Parses (1 block, 0 fail); 0 NUL bytes; **function-set diff vs HEAD: 0 lost** (the one `radio` → `opt`
  swap is the intended `renderLayoutMenu` rewrite).
- ⚠️ **Not verified signed in** — no live project was opened, so `_repIdPaint` has never read a real
  `projName()`/group head, and the legend fold has never run against a real category list.
- `MODULE_V` → `20260902a`.

## ⚠️ REGRESSION, same day: adoption built 1,584 TOP-LEVEL nodes — and my own harness said it was fine (2026-09-01) — fmlozano

Owner, after running the migration and re-importing: *"See WBS Manager there are stray WBS... I think
the import and replace doesn't affect the existing WBS"*, and vertical stacking still empty. The WBS
Manager showed **1,632 nodes** listed as bare codes — `951 Wet Works`, `952 Window Installation` —
which `computeWbsCodes()` only ever produces for a **top-level** node.

### The regression

The previous prompt's fix stopped writing a custom `code` for a purely numeric segment (correctly —
it was mangling every path). But one line downstream still READ that column:

```js
(ins.data || []).forEach(function (n) { nodeByCode[n.code] = n.id; WBS_NODES.push(n); });
```

`n.code` is now **NULL** for every node in a P6 import, so `nodeByCode` was filled under the single
key `"null"` and not one dotted code was ever registered. Cascade:

1. depth 2 looked up `nodeByCode["1"]`, got nothing, inserted with `parent_id = NULL` — and so did
   every level below. **1,584 of 1,623 nodes landed at the top level.**
2. the link step resolves `nodeByCode[r.wbs]`, so it matched nothing: **11 of 1,626 summary rows
   linked** (only the pre-existing locked skeleton).
3. `wbs_link_activity_parents` builds its code → node map FROM those summary rows, so it had an
   almost empty map — **11 of 4,393 activities attachable**. That is why running the migration
   changed nothing and Vertical Stacking still read "0 execution-phase activities stacked".

**Fix:** remember the dotted code per payload, keyed on `(parent_id, sort_order)` — unique within the
adopt and returned on the inserted row — instead of reading it back off `n.code`. Not keyed on
response order, which PostgREST does not promise.

### ⚠️⚠️ WHY THE PREVIOUS PROMPT'S "VERIFIED" WAS WORTHLESS HERE

The harness **reimplemented** `wbsAdopt`'s insert loop instead of executing it, and wrote the line the
way it *ought* to be — `nodeByCode[code] = id`, using the local dotted code. So the harness was
correct and the shipped code was not, and every number it produced (0 drift, 4,393 linked, 3,874
`isExecPhase`) described a program that does not exist. The module's own log has said *"never
reimplemented"* since the .xer work began; this is what happens when one line breaks that rule.

`adopt.js` now executes the SHIPPED `wbsAdopt()` against a fake PostgREST that **returns inserted rows
in a shuffled order on purpose**, and it asserts the tree it actually built. Its first version passed
the pre-fix code too — because `build.js` had already adopted the tree, so `wbsAdopt` inserted nothing
and the run was vacuous. It now hard-asserts `WBS_NODES.length === 8` (skeleton only) before running.

### Verified, by executing the shipped function against both files

| | pre-fix | fixed |
|---|---|---|
| top-level nodes (Avesta, expect 5) | **1,584** | **5** |
| summary rows linked | 11 of 1,626 | **1,626 of 1,626** |
| activities the heal can attach | 11 of 4,393 | **4,393 of 4,393** |
| code drift | 0 | 0 |

Strevi, fixed: **5** top-level, **12,467 of 12,467** linked, **16,393 of 16,393** attachable, 0 drift.
The pre-fix run reproduces the owner's screenshot, so the harness bites.

⚠️ **Recovery for a project already adopted with the broken build:** its stray top-level nodes are
still there, and their computed codes (`1`…`1632`) now COLLIDE with the real depth-1 codes, so a
re-adopt on top of them resolves parents onto garbage. The tree must be cleared first — see the
Reset WBS work in the next entry.

## Imported activities were never attached to the WBS tree — "0 activities", and an empty Vertical Stacking (2026-09-01) — fmlozano

Owner, on Avesta: *"The WBS isn't allocating it properly to its correct WBS"* (WBS Manager screenshot:
every branch reading **0 activities**), then *"after importing and defined the location breakdown, this
is what happens in the vertical stacking"* (**"0 execution-phase activities stacked"** on a project
holding 3,874 of them).

Both files were re-run headlessly through the SHIPPED functions before anything was changed — sliced
out of `index.html` by brace-matching, never reimplemented. **The placement work from the previous
prompt holds: code drift 0 on both files**, and the tree the harness produces is the screenshot,
branch for branch (Execution Phase › General Requirements / Construction Phase / Site Development
Works; Closeout Phase › Tower 1…7 — those towers are the FILE's own closeout structure, not a
misfiling). So the structure was already right. What was wrong was that nothing was attached to it.

### ⚠️⚠️ THE ROOT CAUSE — one line, three symptoms

`wbsAdopt()` linked SUMMARY rows, and activities only where an activity's dotted code **equalled** a
branch's code. An imported activity never does: it carries its own **leaf** code — `4.2.3.1.5` under
branch `4.2.3.1`. So every import finished with `wbs_node_id = NULL` on **every** activity —
**4,393 of 4,393 (Avesta), 16,393 of 16,393 (Strevi)**.

The grid never showed it, because `rebuild()` derives ancestry by SPLITTING the dotted code. Everything
keyed on the NODE saw an empty project:

| | before | after |
|---|---|---|
| WBS Manager "N activities" | 0 of 1,623 / 0 of 12,464 nodes | **1,111 / 7,442 nodes** |
| `isExecPhase` → Vertical Stacking | **0** of 4,393 / 0 of 16,393 | **3,874 / 16,000** |
| `workOf()` (trade from the branch) | 0 / 0 | **4,393 / 16,393** |

`phaseOf(r)` is `r.phase || _nodePhase(r.wbs_node_id)`, so with no node there is no phase; `_vsActs()`
filters on `isExecPhase`, so the stack drew nothing. Same for the Contract Scope column ("—").

**Fix:** `_wbsLinkActivityParents()` — an activity belongs to the node whose code is **its own code
minus the last segment**. Verified: every activity resolves, **0 orphans** on both files.

### ⚠️ The guard that makes the link safe — `_wbsResyncCodes` would have flattened the schedule

That function rewrites `wbs` to `codeOf[wbs_node_id]` for every row carrying a node id. That is right
for a summary row (**it IS its node**) and catastrophic for an activity: it would collapse every
activity in a branch onto the branch's single code, which `rebuild()` then reads as ancestry.
Measured on the newly-linked rows: the un-guarded rule rewrites **4,393 / 16,393 rows — the whole
schedule — on the first `load()` after adoption.** Depth is the discriminator, and it is exact: a
Builder-pushed activity is filed AT its node and carries the node's code (same depth, unchanged);
an imported activity is strictly deeper, so only the BRANCH part of its code moves and its own tail
segment is kept. **Guarded rule: 0 rewrites** on both files.

Two more things that fell out of it:
- **The fetch would have doubled on every load** (13 → 29 round-trips on Strevi) now that activities
  carry node ids. Split into two phases with an EXACT short-circuit: an activity's target is its
  node's code plus its tail, so if no summary code drifted, no activity's can have — the second page
  is skipped. A healthy project now pays **less** than before this change.
- **The rebase is bounded.** One UPDATE per target code, and an activity's target code is unique to
  it, so a renumber that moved a big branch would issue one request per activity — the request storm
  `_wbsLinkRows` exists to kill. Over 500 codes the branches are still re-synced and the mass activity
  rebase is **reported instead of run**; skipping it corrupts nothing (those rows keep their codes).

### The heal, for every project already imported

Every project imported before today carries all of its activities unattached, and the symptom is
silent. `load()` now runs the linker when — and only when — an in-memory test finds an activity whose
parent code resolves to a node, so a healthy project performs **no query at all**. Idempotent:
re-running it matches 0 rows.

**`wbs_link_activity_parents(project_id)` sends NO PAYLOAD.** The project's own WBS-Summary rows ARE
the (code → node id) map, so the join runs inside the database — unlike `wbs_link_codes`, which has to
upload one pair per branch. That matters here: the client-side alternative is one PATCH per activity,
16,393 requests. So this one has **no row-by-row fallback** — without the function it says so and
leaves the data alone rather than hanging the app. `security invoker`, so RLS still applies.
⚠️ **The owner must run `migrations/2026-09-01-wbs-link-rpc.sql`** (it now carries both functions).

### Also fixed: the WBS Manager was computing codes by its own, pre-fix rule

`_wbsBuildIndex()` held a private copy of the code walk that read `n.code` **raw** for a custom code —
exactly the rule `computeWbsCodes()` carries a long warning about, one function over: a custom code is
a SEGMENT of the path, never a replacement for it. A Builder branch coded `AR-F11` was therefore drawn
in the WBS Manager as a top-level-looking `AR-F11` while the schedule showed it at `4.2.3.AR-F11` —
one node, two codes, two views. It now calls `computeWbsCodes()`; there is no second rule to keep in step.

### Verified

By executing the shipped functions over both real exports (Avesta 4,393 activities / 1,623 nodes;
Strevi 16,393 / 12,464):

1. WBS code drift after adoption **0 / 0**
2. activities attached **4,393 / 16,393**, unattached **0 / 0**
3. `isExecPhase` **3,874 / 16,000**; trade **4,393 / 16,393**
4. WBS Manager counts **1,111 / 7,442** nodes, totalling every activity
5. `_wbsResyncCodes` on a steady-state load — old rule 4,393 / 16,393 rewrites, **shipped rule 0 / 0**
6. second run of the heal **0 rows** (idempotent)
7. location plan, scoped to Execution Phase and seeded by `locSeedTerms`:
   Avesta **Tower 7 · Level 15 · Zone 2**, 3,818 of 3,874 located;
   Strevi **Tower 7 (4 real + 3 site-dev mentions ≤4 acts) · Level 19 · Zone 9**, 15,903 of 16,000
8. Vertical Stacking input: **3,617 / 15,704** execution-phase activities carrying the stacking axis

Whole file: 0 NUL bytes, 1 inline script, parses clean, 1,554 function definitions.

⚠️ **NOT verified signed in** — the anon key has no grants, so the two RPCs have never been called
against Supabase. The migration is the prerequisite; the first real load of Avesta is the test.

⚠️ **Two things in the screenshot this does NOT explain, and they are not from this file.** The nine
extra top-level branches (`6 BOQ Tower`, `7 BOQ Site Development`, `8`–`14 Tower 1…7`) are not
produced by importing this .xer into a seeded skeleton — the harness yields exactly five top-level
branches. They are left over from earlier work in that project. `_clearWbsTree()` drops every unlocked
node, so a **Replace** import removes them; an Append does not. Likewise the live tree's **944 nodes**
is short of the 1,623 this file adopts to, so that project's tree is not a complete adoption of it.

## The .xer import "bugged completely" on 4PH Strevi — the WBS code was being mangled (2026-09-01) — fmlozano

Owner: *"I tried importing the detailed program for Strevi Residences in the importer and it bugged
completely. Let's fix considering the location breakdown and matching of locations and WBS."*

**Reproduced headlessly first** by running the SHIPPED `parseXER` over the real 8.4 MB file (50,462
lines) rather than guessing: **12,465 PROJWBS + 16,393 TASK = 28,858 recs, WBS nesting 10 deep,
21,338 TASKPRED**. The parse itself is fine — 376 ms. Everything below was measured against that.
⚠️ ACTVCODE is effectively empty in this file (1 type, 1 value, 1 assignment), so the location
breakdown can only come from the WBS — which is what made items 4-6 matter.

### 1 ⚠️⚠️ THE ONE THAT DESTROYS THE SCHEDULE — `wbsAdopt` mangled every adopted WBS code

`wbsAdopt` inserted each node as `{ code: "1.4.2.3", code_custom: true }` — **the whole dotted path**.
But `computeWbsCodes` reads a custom code through `ownCodeSeg()`, which flattens dots to dashes so a
custom code can only ever be ONE segment. So `"1.4.2.3"` came back as **`"1-4-2-3"`** and the node's
computed code became `parentPath + "." + "1-4-2-3"`.

Measured on this file: **12,456 of 12,465 nodes compute to a mangled code** — `1.1` → `1.1-1`,
`1.4.2.3` → `1.1-4.1-4-2.1-4-2-3`. `_wbsResyncCodes()` then runs on the very next `load()`, sees every
stored `wbs` disagree with the computed code, and **rewrites all 12,456 summary rows to the mangled
value**. Since `rebuild()` derives ancestry by SPLITTING that code, `1.1-1.1-1-1` is depth 2 where it
should be depth 3 — the hierarchy collapses into sibling salad. That is "bugged completely".

⚠️ **The activities are NOT rewritten** (they carry no `wbs_node_id` — see #2), so they keep correct
codes while the summaries move: orphaned activities under garbage branches.

**Fix:** a node's `code` is its **own segment**, and only when that segment is **not purely numeric**.
Adoption never needed a custom code for numeric paths — rows are adopted in code order, one depth
level at a time, so `sort_order` already reproduces the file's numbering and auto-numbering yields the
identical dotted code. **Verified: 12,456 drifted → 0.** A non-numeric segment (`AR-F11`, `ISD02`)
carries planner meaning position cannot reproduce, so that — and only that — stays custom, stripped to
its own segment.

### 2 ⚠️ `wbsAdopt`'s link loop was O(n²) and linked NOTHING

`legacy.forEach(r => rows.forEach(a => …))` = **12,465 × 28,858 = 360 M comparisons, 3.7 s of blocked
main thread — and 0 activities linked**, because an imported activity carries its own leaf code and
never shares a code with a branch. Now indexed by code once; the real case (Builder pushes / manual
rows, where an activity carries its parent branch's code) stays O(1).

### 3 ⚠️ 12,465 single-row PATCHes to write the links

`_batchUpdate` issues one PATCH per row, 40 in flight → **312 sequential waves**. Minutes of an
apparently-hung app — and any wave that fails leaves nodes unlinked, which `_wbsEnsureSummaries` reads
as "this node has no summary row" and heals by **INSERTING a duplicate**, sequentially. That is the
Avesta runaway in a new costume, so this is a correctness fix, not only a speed one.

New `_wbsLinkRows()` → **`wbs_link_codes(project_id, [{code,node_id}…])`**, one UPDATE ... FROM
`jsonb_to_recordset`, **one round-trip**. Matches on the dotted code so it links the summary row AND
any activity carrying it — exactly what the client loop did. `security invoker`, so the caller's RLS
still applies. **Falls back to `_batchUpdate` when the function is absent**, same contract as
`schedule_rows`, so the app works before AND after `migrations/2026-09-01-wbs-link-rpc.sql`.
⚠️ **The owner must run it.**

### 4 The location breakdown was not scoped to Execution Phase

Both post-hoc location tools scope to Execution Phase (`locExecScopedActs`) so a Milestone or a
Planning deliverable can never pick up a tower/floor/zone. **The IMPORTERS ran the matcher over every
leaf in the file** — which is where the breakdown gets dirty before anyone can see it.

Measured on this file, mapping Tower with the default seeded terms: **14 values for 4 real towers.**
The Milestones branch contributed `Tower Handover`, `Building Watertightness` and `Building
Energization` (WBS headings, not places), and **Closeout contributed a SECOND, differently-spelled set
of the same four towers** — `Tower 1`..`Tower 4` against Execution's `Tower A`..`Tower D`. No spelling
merge can reconcile those: they genuinely are different strings for the same building.

`locImportScope()` scopes to the branches the planner filed under Execution Phase **in the same
dialog** — the importer already knows the answer, it just never asked itself. Falls back to the whole
file (old behaviour) when nothing is filed there, and **says which it is doing** in the preview.
**Measured after: Tower 14 → 7 values** (4 real + 3 genuine Site-Development / General-Requirements
mentions), Level 20 → 19, Zone unchanged. Applied to the Excel path too — same defect, same fix.

### 5 The preview recomputed over 16k leaves on every keystroke

`onChange` is wired to `oninput` on the keyword-terms box and ran the full plan each time.
**Debounced 250 ms**, and the placement selects now repaint it too (they decide the scope).

### 6 Memoisation — the same regex compiled 13.7 M times

`locTermHit` built a fresh `RegExp` **per term per call**, and `discStampFromWbs` asks it once per WBS
ancestry segment per activity: ~70 terms × up to 12 segments × 16,393 activities. Measured **1.46 s**,
and the import runs it **twice** (dialog + import).
- compiled-regex cache → 0.72 s
- memoise `_discTermMatch` **by name** (the tree repeats ~2.6k names across 150k asks) → **0.14 s, 10×**
- `locWordMatcher` memoised per matcher; the keyword source's ancestry walk memoised **per code path**
  (the deepest match for `4.2.3.1.5` is determined by `4.2.3.1` plus one node's name) → `locMapPlan`
  **0.47 s → 0.27 s**, byte-identical output
- `locNormKey` memoised (called twice per record per level over ~20 distinct values)

### 7 `Closeout` never matched `Closeout Phase`

The seeded skeleton says **Closeout Phase**; the file's branch is **Closeout**. `_wbsNameKey` folds
leading generic qualifiers but not a trailing `phase`, so the two did not match and the file's branch
was filed as a **sixth top-level branch beside the skeleton's empty Closeout Phase** — the exact
duplicate-top-level shape the placement step exists to prevent. `phase` added to the dropped words;
every skeleton phase stays distinct (initiation / planning / execution / closeout / milestone).
`_impGuessTarget` now matches on the same key, so the dialog's guess and `applyWbsPlacement`'s merge
test can never disagree — a mismatch there produces `Closeout Phase › Closeout`.

### Verified

By **executing the shipped functions**, sliced out of `index.html` by brace-matching and never
reimplemented, over the real file:
- placement + adoption end to end: the 5 branches merge into their skeleton phases, root wrapper
  dropped, **code drift 12,456 → 0** — and the same harness reproduces 12,456 against the pre-fix
  code, so it bites;
- the O(n²) loop measured at 3.7 s / 0 links;
- the scoped location plan (values above), with `locMapPlan` output byte-identical after memoisation;
- `discStampFromWbs` 1.46 s → 0.14 s, same 16,056 stamped.

Whole file: **0 NUL bytes, 1 inline script, parses clean, 1,427 function definitions, 0 lost.**

⚠️ **NOT verified signed in.** The anon key has no grants, so no import was actually run against
Supabase and the RPC has never been called. **The first real import is the test**, and it needs
`migrations/2026-09-01-wbs-link-rpc.sql` run first (without it the fallback fires: correct, but slow).
⚠️ Existing projects already carrying mangled codes are **not migrated** — a re-import with *Replace*
clears the tree and rebuilds it correctly, which is the recovery path.

## Vertical stacking banded by the TOWER, so the floors ran sideways (2026-09-01) — fmlozano

Owner: *"for multiple towers, i have identified and matched WBS to tower location, and as well as
defined the level locations. but in vertical stacking the level locations are not properly stacked.
they are stacked horizontally."* Their data was right; the view was reading the wrong level.

⚠️ **ROOT CAUSE: `_vsTowerSVG` banded by `LOC_LEVELS[0]`, and on a `Tower › Level › Zone` breakdown
that IS the Tower.** Every card is already scoped to ONE tower (the per-tower scope, or the Tower
selector), so every activity in it shares one tower value → **exactly one band** — and `_vsRowCells`
then split that band by `LOC_LEVELS.slice(1, detail)`, which is Level and Zone. So the floors came out
as the band's **cells, running horizontally**. A building drawn on its side, from one index.

⚠️ **The tower was being expressed three times and only needed two.** It is the card, it is the
selector in the bar — and it was also the band axis. New **`_vsAxis()`** = the location levels minus
the tower level (resolved by `_vsTowerLevelId`, so it works whether the tower is first or merely
named "Building"/"Block"). Storeys take the vertical axis; the tower stays the card.
- ⚠️ **Falls back to the full list** when removing the tower would leave nothing — a project whose
  ONLY location level is the tower genuinely stacks by it, and an empty axis draws no building at all.
  A one-level project is byte-identical to before.
- ⚠️ **This is the principle the stacking MODAL already settled on 2026-08-17** ("floors always take
  the vertical axis"). That fix went into `stkGridHTML` and was never applied to this view — which is
  why one half of the module got it right and the other did not.
- ⚠️ Cached on the level-id **signature**, not on `LOC_LEVELS` identity: `_vsRowCells` calls it per
  row per render, and it must re-resolve the moment the breakdown is reloaded or edited.
- Everything keyed off it moves together: the band axis, the detail cells, **Detail's maximum** (a
  `Tower › Level › Zone` project now offers 1–2, not 1–3 with a dead first step), the detail-button
  tooltips, the bar's "Level › Zone" caption and the PDF's Detail line.

**The two warnings were about the same level and are now about the right ones.**
`_vsHasLevel` tested the tower, so on the owner's project it reported every activity as levelled while
the stack showed one band. It tests the **axis** level now.
- ⚠️ The **Assign** repair is still about the TOWER, so it is split out rather than re-pointed:
  offering "assign all 2,561 activities to one **floor**" would be nonsense. It fires only when the
  tower is a level of its own, none of the work carries it, and the work is otherwise located — and it
  now says plainly that the **stack is unaffected** (it bands by the floor) and only the Tower picker
  is left with nothing to switch between. The two banners render **independently**; a project can
  legitimately have both.
- ⚠️ **`_vsStampTopLevel` wrote `LOC_LEVELS[0]`**, not the tower. On a project whose levels are
  ordered differently that is a floor, and the repair would have filed every activity on a floor
  nobody put it on. It resolves the tower the same way `_vsTowerOf` does now.

**Verified 17/17** executing the SHIPPED `_vsTowerLevelId` / `_vsAxis` / `_vsMaxDetail` / `_vsHasLevel` /
`_vsRowCells` (sliced out by brace-matching, not reimplemented): on `Tower › Level › Zone` the axis is
**Level › Zone**, bands are Levels, **detail 2's cells are Zones** (they were Levels), max detail 2, a
tower-only activity correctly reports NO level; a tower named "Building" sitting second is still
excluded; a project with no tower-ish name keeps its first level as the tower; and a **single-level
project falls back unchanged**. Parses (1 block, 0 fail); **0 functions lost, 1 added**; 0 NUL bytes; no
`LOC_LEVELS[0]` left in the stacking code except the tower tie-breaker itself.
⚠️ **Not verified signed in** — the anon key has no grants, so the owner's project was not opened. The
stack should now show one row per floor with the zones across. `MODULE_V` → `20260901b`.

## Vertical stacking: export the displayed report as a PDF (2026-09-01) — fmlozano

Owner: *"add an option wherein users are able to convert the displayed report in the vertical stacking
into PDF format. please make the report very simple yet aesthetic."* New **PDF** button in the stacking
toolbar, beside Magnify.

- ⚠️ **No PDF library.** This app is a no-build vanilla page; jsPDF/html2canvas would add a vendored
  megabyte and **rasterise** the buildings. A print window + the browser's own "Save as PDF" keeps the
  SVG **vector**, so the zone dates stay sharp at any zoom — which is the whole point of printing this
  view. Same pattern the Reports library already uses (`runReport`).
- ⚠️ **The svg is CLONED from the screen, never re-derived.** Re-deriving would be a second renderer to
  keep in step with `_vsTowerSVG`, and the first divergence would be a report that disagrees with the
  screen it was exported from.
- ⚠️ **Two things must travel with the clone.** The cells carry `var(--pd-line)` / `var(--pd-muted)`
  fills, so the vars are re-declared in the print document — as a **fixed LIGHT palette**, because a
  planner on dark mode must not get a black page of ink. And the cells reference the hatch patterns from
  `_vsHatchDefs()`, so that defs svg is copied in **ahead of** the buildings that reference it.
- ⚠️ **`width`/`height` attributes are stripped from the clone**; the viewBox carries the geometry, so
  each building scales to the page. Left as-is, a wide tower prints off the right margin.
- ⚠️ `break-inside:avoid` sits on the building **section**, not the svg — a building split across two
  pages is unreadable.
- The page states the basis it was exported under (Tower / View / Detail / Dates / Trades) plus the
  legend for the current basis, so a printed sheet cannot be misread as a different scope. Compare basis
  prints the four slip colours; otherwise the solid/hatched progress key.
- A4 portrait, 12mm margins, brand-red rule under the title, one card per building, footer with the data
  date. Pop-ups blocked or nothing on screen → a toast, not a silent no-op.

**Verified:** inline script parses (1 block, 0 fail); **0 functions lost, 1 added** against HEAD; 0 NUL
bytes; every helper it calls (`_vsDetailNow`, `_vsBasisWord`, `projName`, `esc`, `dstr`, `today`, the four
`VS_SLIP_*`) confirmed present.
⚠️ **Not verified signed in** — the anon key has no grants, so no real project was opened and no PDF was
produced. The first real export is the test. `MODULE_V` → `20260901a`.

## Fix: narrow-width topbar-tools cluster overflowed past the module bar (2026-08-30) — fmlozano

Owner sent a screenshot at a narrow ("tablet"/narrow-desktop, roughly 820–955px — the band the shared
`.pd-modulebar` layer does NOT force a wrap at, unlike ≤900px) width: the project dropdown, the title
switcher and the workspace subline visually crowded together, and below them "Actions ▾" / "+ Add
activity" / undo-redo / "File ▾" / "Group: WBS ▾" collided with faintly-visible "Reports"/"Health" text
and icons — reading exactly like the row of action buttons had been "lost".

⚠️ **Root cause: `#ps-topbar-tools` (undo/redo/File▾/Reports/Health/filter/refresh, 7+ controls) had
`display:flex` with no `flex-wrap` at all (defaults to `nowrap`) and nothing catching an overflow** —
neither a scrollbar nor a clip. At any width too narrow to fit all seven controls on one line, they
simply overflowed PAST `.pd-modulebar`'s right edge and painted on top of `.ps-toolbar`'s row in
`.pd-main` directly below it. That is every element in the screenshot: the topbar-tools cluster
spilling downward onto the schedule's own Actions/Add/Group row.
- ⚠️ Ruled out first, not guessed away: a sticky-positioning stacking collision (grepped every
  `position:sticky|fixed|absolute` in the file — none touch `.pd-topbar-tools`/`.pd-modulebar`/
  `.ps-toolbar`/`.pd-main`); leftover `position:absolute` on `.ps-datadate-badge`/`.ps-fresh`/
  `.ps-title-btn` from before the 2026-08-30 topbar restructure (none carry a position); and
  `.pd-tb-main`/`.pd-modulebar` mis-sizing around wrapped content (`.pd-modulebar` is `flex-wrap:wrap`
  with no fixed height, so it grows to fit any number of wrapped rows — confirmed, not the cause).
- **Fix:** `.ps-topbar-tools` gets `flex-wrap:wrap; row-gap:4px` — the same shape the shared
  `.pd-modulebar` container around it already uses. At any width where the 7 controls don't fit one
  line, they now wrap to a second line INSIDE the cluster instead of overflowing past it; the parent
  `.pd-modulebar` (itself `flex-wrap:wrap`, `min-height` not fixed) sizes around the extra line with no
  clipping. Composes cleanly with the shared ≤900px rule that forces the whole cluster onto its own
  full-width row — that rule still applies unchanged, this only fixes the band above it where the
  cluster stays inline but couldn't wrap on its own.
- Also dropped a harmless duplicate `margin-left:auto` on the same rule (declared twice, no behaviour
  change).
- `MODULE_V` → `20260830f` (bumped in `dashboard.html`/`modules.html`'s `modules-grid.js?v=` tag, which
  is what the constant is actually derived from — see that file's own header note).

## Stacking: the trade chips become a multi-select filter (2026-08-27) — fmlozano

`_vsTrade` (a single value) → `_vsTradeSel` (a list) + `_vsTradeOn` / `_vsTradeToggle`.

- ⚠️ **Empty means ALL.** A stored "every trade ticked" would silently exclude a trade the project
  gains later while the control claimed everything was on. "All trades" clears the selection.
- ⚠️ **Session-only.** A remembered trade filter reads as missing buildings next week.
- The **Per trade** scope needed no new view for "side by side" — it already draws one building per
  trade and was only ever handed one. `towers = tradesShown.map(...)`.
- ⚠️ `acts` itself is narrowed, so the per-tower and Consolidated models, the warning counts and the
  time bar all describe the same set the buildings are drawn from. `actsPreTrade` is kept **only** for
  the chip counts — from the filtered set a hidden trade would read "0 activities".
- ⚠️ `trades` is collected BEFORE the filter, or selecting one trade would leave the chip row showing
  only that trade with no way back.
- ⚠️ The chip row renders in every scope now (was `_vsScope === 'trade'` only).
- ⚠️ Stale names are dropped per render, so the view cannot filter itself to nothing.
- ⚠️ **`.ps-vs-chip.on` was brand red as text — 3.75:1 dark, under AA.** Harmless-ish with
  single-select; with a multi-select the lit chips ARE the filter. Now ink on the red tint (13.45 dark
  / 14.25 light), red kept as the border. Both stylesheet regions.

**Verified.** 25 checks executing the sliced helpers + the structural assertions; browser-measured
(two trades at x=12/x=238 on one row, `aria-pressed`, "2 of 5 trades shown side by side", five on one
row by default, Fit and the time bar unaffected). 0 functions lost, 2 added.
⚠️ **Test-authoring trap, three times in one pass:** the contrast assertion matched
`border-color:var(--pd-red)` as `color:` and could never pass, and shell-escaped regexes were mangled
on the way into the file twice. Guard with `[;{]`, and write test regexes literally (heredoc), never
through a `node -e` shell round-trip. ⚠️ **Not verified signed in.**

## Stacking: the header trim, and dismissible notices (2026-08-27) — fmlozano

**Header.** New `body.ps-vstack-on` (toggled by `setVStackMode`, both ways) hides `#ps-groupbtn`,
`#ps-zoom`, `#ps-collapseto`, `#ps-colorsbtn`, `#ps-analyzebtn` while the stacking is open — all five
act on the grid/Gantt, which is not on screen.
- ⚠️ Scoped to the stacking, not to `ps-reporting`: they are equally irrelevant to a planner working
  in the stack.
- ⚠️ **Kept on purpose:** Layout ▾ (the documented "way out of Reporting view" rule), Open ▾ and
  Layouts (they change which schedule/filters the stack reads), `#ps-scope` and the search (honoured
  by the stack), and the view switches. The suite asserts each of these is NOT in the hidden list, so
  a later tidy-up cannot quietly remove the exit.
- Reporting view additionally drops `#ps-tb-labeltoggle`, `#ps-help-btn` and `.ps-vs-bar > .ps-vs-note`
  (the field labels) → bar measured at 32px, one row.

**Dismissible notices.** `_vsWarnWrap(key, html)` wraps all three banners; `_vsWarnKey(kind, n)`.
- ⚠️ **The count is in the key.** Dismissing "1 activity carries no Level" must not silence "40
  activities carry no Level" later — different fact, and staying hidden through it would mislead.
- ⚠️ Per project, localStorage (`ps_vswarn`), never a column — one person's reading preference, not
  project state, and not something one planner can hide from another. A corrupt store falls back to
  **showing**.
- ⚠️ The handler removes the node and calls `_vsApplyPane(host)` — **not** `renderVStack()`, which
  would rebuild every svg and restart the entrance animation just to close a banner.
- ⚠️ 30px right padding, not a float: measured 0 of 7 text line-boxes overlapping the × at 430px.
  Space returned to the buildings: 47px at full width, 82px at 430px.

**Verified.** 27 checks executing the sliced helpers (render, dismiss, persist, count-changed,
other-project, other-kind, corrupt storage) + the structural assertions above; browser-measured
against the shipped CSS. 0 functions lost, 4 added.
⚠️ **Two of my own measurements were wrong first:** the overlap test included the button itself (it is
a child of the banner), and a contrast check indexed the hex as if it had a leading `#` and printed
1.76:1 — the banner text is 5.64:1 and untouched by this work. ⚠️ **Not verified signed in.**

## Vertical stacking: the tower key, the fit, and the pane (2026-08-27) — fmlozano

**1. Towers were not detected on a matcher-mapped project.** `_vsTowerOf` read
`r.location[VS_LOC_TOWER]` — the literal string `'tower'`.
- ⚠️ **`location` has TWO writers and they use different keys.** `locMapPlan` (the WBS→location
  matcher) and both importers write `loc[<location_levels.id>]`; only `locMapOf` (the Schedule Builder
  push) writes the reserved literal `tower`. So every project whose towers came from the matcher
  reported zero towers — the stack banded Tower 1 / Tower 2 (it reads `LOC_LEVELS` by id) while the
  picker said "no tower breakdown". Contrast run against the pre-fix function: `[]` vs
  `['Tower 1','Tower 2']`.
- New `_vsTowerLevelId()`: the **first** location level, name test (`tower|building|block`) as a
  tie-breaker only. ⚠️ Order is the primary rule because a level legitimately called "Building" or
  "Block" is still the tower axis, and a project that named it something else must still resolve to
  *something* rather than to nothing.
- ⚠️ The level id wins over the literal key when a project carries both — the matcher is the planner's
  decision, the push's value is derived.
- ⚠️ Same class as the Equipment module's `'tower'` literal (2026-08-24). **A jsonb location map is
  keyed by level id.**

**2. Fit — see the whole building.** `_vsFit` (on, persisted `ps_vsfit`) + `.ps-vs-stage.is-fit`.
- ⚠️ `width:auto` on the svg is what makes it scale rather than squash: the svg carries explicit
  width/height **attributes**, and a `max-height` alone with a fixed width distorts it.
- ⚠️ The fit cap subtracts the tower card's **measured** chrome (`card.height - svg.height`), not a
  constant. A cap from the body height alone fitted a 469px drawing into a 497px body and the body
  still scrolled — the card header, padding and border are ~71px.

**3. The time bar stays on screen.** `.ps-vs-pane` (bounded height) › `.ps-vs-body` (scrolls) ›
`.ps-vs-tl` (`flex:0 0 auto`).
- ⚠️⚠️ **`position:sticky; bottom:0` was tried first and is a NO-OP here.** Sticky is bounded by its
  containing block; the bar is the pane's LAST child, so the container's bottom edge *is* the bar's
  bottom edge and it has zero travel. Measured scrolling away at 0/300/600px with the rule in place.
  Do not "restore" it.
- ⚠️ `position:fixed` is also wrong — out of flow it overlaps the last building instead of ending the
  pane.
- ⚠️ The toolbar and trade chips are **outside** the scroller; scrolling the buildings must not take
  the controls with them.
- ⚠️ `_vsApplyPane` is re-run from the existing debounced `resize` handler — measured geometry goes
  stale, and a window dragged shorter would hide the bar again. It re-measures rather than
  re-rendering, so a resize does not restart the entrance animation.

**Verified.** 27 checks executing the sliced functions + the old-vs-new contrast; browser-measured at
1265px light and dark (fit 420×1400 → 141×452, aspect kept, body no longer scrolls, bar at 703 of
720; Fit off → full size, body scrolls 948px, bar still on screen; 0 page h-scroll). 0 functions lost,
3 added. ⚠️ **Not verified signed in.**

## Vertical stacking: the tower picker becomes a dropdown (2026-08-26) — fmlozano

Owner: a dropdown for which tower, a consolidated option showing every tower side by side, and a
greyed-out dropdown pinned to the single tower when the project has no tower breakdown. **No migration.**

`twChips` / `[data-vstw]` are gone, replaced by `#ps-vs-tower` at the head of `.ps-vs-bar` — "which
building" belongs before "how it is sliced".

- ⚠️ **The chips only existed when there was a choice**, so a one-tower project rendered no control
  and the planner could not tell a single building from every building merged. The select always
  renders; with nothing to switch between it is `disabled` and its `title` says why.
- ⚠️ **`_vsTower` is PINNED when there is one option** (`if (_twOpts.length === 1) _vsTower =
  _twOpts[0].v`). Without it `_vsTower` stays `'ALL'` while the select displays a tower name — the
  control and the model disagreeing is worse than either state alone.
- ⚠️ **Choosing "All towers" sets `_vsScope = 'tower'`.** Per-tower is the only scope that draws one
  model per tower; under `'trade'` the option would claim "side by side" while every tower merged.
  It deliberately does **not** set `_vsScope = 'all'` — the toolbar's own **Consolidated** button
  means ONE merged model for the whole project, the opposite thing. Two controls, two meanings.
- ⚠️ **No tower level at all → "Whole project (no tower breakdown)", never "Tower 1".** The one part
  of the ask not taken literally: the tower value may not be called "Tower 1" on any project, and
  minting a name makes every screen assert a breakdown nobody entered.
- ⚠️ **Found by the test, not by reading:** with no tower level every activity is untowered, so the
  `_untowered.length` branch made "— No tower —" the sole option — a missing-data warning on a job
  that simply has one building. Now gated on `towerNames.length`.
- ⚠️ `.ps-vs-sel { width:auto }` overrides the shared `.pd-select`'s `width:100%` (built for stacked
  `.pd-field` forms). Without it the select claims the whole toolbar row and every other control
  wraps — the recurring trap this app has hit in six filter bars.

**Verified.** 27 checks executing the sliced option-builder across four project shapes plus escaping
and the handler; browser-measured at 1265px light / 640px dark (bar one 32px row, select 150–243px,
disabled 0.62 / not-allowed, 0 clipped, 0 page h-scroll). ⚠️ The first browser reading (0px bar, 10
rows, 194px scroll) was taken before layout settled and was discarded on the viewport gate, not
chased. ⚠️ **Not verified signed in.**

## Cost curves, per-trade subtotals, derived earned value; Cost/EVM removed (2026-08-26) — fmlozano

**Run `migrations/2026-08-26-activity-cost-curve.sql`** (`project_schedule.cost_curve text`, no CHECK,
nothing back-filled — NULL means linear).

**Cost Loading step 4, "Spread over time".** Per-activity Linear / Front-loaded / Back-loaded / Bell,
each with a 16-bar spark drawn from the module's own `curveCdf` and a monthly-spend preview built by
`monthlyPhase()` over `usageMonths()`/`spreadCurveAdd()`.
- ⚠️ **`curveCdf` already existed** with exactly these four shapes (the resource spread uses it). A
  second definition would let a cost curve and a resource curve disagree about "front-loaded", so the
  picker reuses it verbatim. The S-Curve's copy is a transcription (different module, no shared
  closure) held to this one by an agreement test over 606 sample points.
- ⚠️ `applyAll()` writes `{planned_cost, cost_curve}` and skips a row only when BOTH match. The un-run
  migration is tolerated by retrying without `cost_curve` — but the probe requires the column name
  **and** missing-column phrasing, because a CHECK violation quotes the constraint name (which
  contains the column name) and a name-only test would send a planner to re-run an applied migration.

**Derived earned value.** New `evStored` / `evOf` / `evDerived` / `cpiOf` sit immediately above
`eac()`, which now consumes them; 27 call sites rewired (10+1 CPI expressions, 2 roll-up
accumulators, 2 column-sort/copy sites, the Activity Usage series, the export, report totals, 2
`hasCost` expressions).
- ⚠️ **A stored zero counts as unset**, matching the shared `sumEarned` agg exactly — the tile and the
  grid must not disagree about one activity.
- ⚠️ The grid cell renders a derived value **muted-italic** with a tooltip naming its inputs, so it is
  never mistaken for a measured figure; typing over it records a real one.

**Step 2 per-trade subtotal** (`tradeTotals` / `tradePanelHTML`). ⚠️ Attributed **per occurrence** by
each occurrence's own `workOf()`, sorted by `cmpWorkName` — one cost line can span two trades, so
bucketing by "its" trade would misattribute money or need a meaningless "Mixed" bucket. Its own panel
rather than inline totals, and an invalid split reports the unattributed money instead of hiding it.

**Cost / EVM tab removed** — tab button, `#ps-view-cost` markup, `renderCost` + `_niceTop`, the
`.ps-cost-*` CSS, 3 call sites and the switchTab branches. ⚠️ `renderCostAccounts` (the CBS manager)
and `ps-view-costload` deliberately survive — different features that happen to share a prefix. The
band now lives on `dashboard.html`, derived from the four already-aggregated metrics so the landing
page pays no extra round-trip.

**Verified.** 68 checks executing the shipped functions (sliced, never reimplemented) + 15 on the
shared agg; **8 functions lost, all 8 intentional and named**; parse clean; browser-measured light
1400px and dark 620px. ⚠️ **Not verified signed in**, and the migration has not been run.
⚠️ **Still open, pre-existing:** `_vsPctAt` (~line 11030) does not honour `_vsBasis`, so the planned
figure does not move when the vertical-stacking progress bar is scrubbed.

## REVERTED to the (b) build — `_vsAxis` was what removed the levels (2026-08-26) — fmlozano
Owner: *"revert it back to previous prompt. the vertical stacking levels are gone again. haha."*
`modules/project-schedule/index.html` is byte-identical to `b234098`; `9fc0efc` and `afe2053` are both out.
- ⚠️ **`_vsAxis()` collapses the axis to ONE level on a project whose location levels are unfilled.**
  Its loop is `while (i < LOC_LEVELS.length - 1) { if (any activity has a value at LOC_LEVELS[i]) break; i++ }`.
  When **no** activity carries a value at **any** level — levels defined, matching never run, which is the
  ordinary state of a freshly imported project — nothing ever breaks the loop, so `i` lands on
  `LOC_LEVELS.length - 1` and the axis is the LAST level alone. `_vsMaxDetail()` returns `1`,
  `_vsDetailNow()` clamps to 1, `_vsRowCells` takes `slice(1, 1)` = no sub-cells. Every level control gone.
- ⚠️ **The planned-vs-actual commit could NOT have caused it.** Its four call sites all pass a list the
  caller already holds, and `_vsTimelineHTML(acts)` takes `acts` as its own **parameter** — there is no
  scope in which it could throw. Checked before reverting rather than reverted on suspicion.
- ⚠️ **What comes back with the revert:** a one-tower project bands by `LOC_LEVELS[0]` (Tower) and its
  activities land in the "— No level —" band. That is the state `b234098` was built for — it ships the
  **Assign N activities** repair banner, which stamps the top level on work already located further down.
  So the case is handled, just by a planner action instead of silently.
- **If the axis idea is retried:** the loop needs a floor — never advance past a level unless some level
  BELOW it is actually populated, so "nothing is located anywhere" leaves the full axis intact.
## A one-tower project now stacks vertically — the axis skips a level nobody uses (2026-08-26) — fmlozano
Owner: *"there should be a fix for projects that have no tower. Some projects just only have 1 tower…
the zones are just fixed horizontally, it's not a vertical stacking per se."* And: *"some projects
don't have a WBS just for tower 1."* One root cause behind both.
- ⚠️ **The stacking bands by the FIRST location level, and on a one-building project that level is
  empty.** `locMapOf` deliberately never stamped a tower unless `multiTower()` (a filter with one
  choice is noise), and a project whose WBS has no Tower branch has nothing for the location matcher
  to read either. So every activity had no value at level 0, all of them fell into a single
  *— No level —* band, and the floors rendered as **cells running horizontally** — a building drawn
  sideways, which is exactly what the owner described.
- **Fix: `_vsAxis()` drops a LEADING level that no activity uses at all**, so the first populated
  level (Level) becomes the vertical axis and the floors stack. Zones and units stay as the cells.
  ⚠️ **STRICTLY ZERO, never a coverage ratio.** A "fewer than half" rule was tried on 2026-08-25 and
  was wrong: it dropped Tower **and** Level and stacked by Zone, because Level is carried by fewer
  activities than Zone is. **A level that ANY activity uses is real structure the planner put there** —
  it stays, and its un-valued rows keep their honest No-level band. Verified: one towered activity out
  of 2,561 keeps Tower as the axis.
  ⚠️ **Leading levels only, never the last one.** An unused level in the MIDDLE is a genuine gap in
  the data; hiding it would misreport the building rather than read it. Verified: Tower used / Level
  empty / Zone used keeps the full four-level axis.
  ⚠️ **Measured over the activities this view stacks** (execution-phase leaves), not over `rows` —
  which also holds WBS summaries and every Initiation / Planning / Close-out activity. One stray
  non-execution row carrying a tower would otherwise hold the axis and put the whole project back
  under "No level"; **that exact mistake made an earlier attempt a no-op.** Both cases verified.
  ⚠️ **Not filtered by the toolbar** — the building's shape must not change because someone typed in
  the search box. Re-measured when the row set or `_editSeq` changes.
- **A genuinely multi-tower project is untouched** — asserted, in both directions.
- The one-click **Assign** repair from earlier today stays, for a planner who would rather stamp a
  real tower name than have the level skipped; it now targets the AXIS' first level, so it can never
  offer to fill a level the view has already stepped past.
- Verified by executing the shipped `_vsAxis`/`_vsHasLevel`/`_vsMaxDetail` over nine shapes: the
  one-tower and no-Tower-WBS projects both → **Level › Zone › Unit**; a stray Planning row and a WBS
  summary row carrying a tower both → still Level; multi-tower → unchanged; a single towered activity
  → Tower kept; a middle gap → preserved; nothing located at all → still returns an axis rather than
  none. Inline script parses. ⚠️ **Not verified signed-in.** Delivered as `?v=20260826c`.

## "No levels detected" — the band had TWO causes and only one had a message (2026-08-26) — fmlozano
Owner, on One Portwood again: *"how come its like this again? there is no levels detected?"* Same
screenshot as before — 2,561 activities in the dashed *No level* band with their floors visible as the
cells, and a banner telling them to give the trade floors in Schedule Builder step 2.
- ⚠️ **The banner was giving advice for a problem this project does not have, which is why it kept
  reading as "still broken".** The floors ARE there — 2ND Floor, B1, Ground Floor, Roof Deck, all on
  screen. Two different faults land in the same band and the copy only ever described the first:
  - **(a) SOME activities lack the level** — whole-trade work pushed by a trade with no floors. Re-push
    is the right advice.
  - **(b) EVERY activity lacks it while carrying a value FURTHER DOWN** — the work is located and only
    the top level was never stamped. That is a single-tower project: `locMapOf` wrote the tower only
    when `multiTower()`, so a one-building push left that column empty on every row.
  This project is (b). The stacking bands by the first location level, so all 2,561 could only ever be
  filed under "No level".
- ⚠️ **The 2026-08-25 fix (`locMapOf` always stamps the tower) was correct and could never help HERE** —
  it fixes the NEXT push, and these rows were already in the database. That gap is what this closes.
- **Fix: the (b) case gets its own message and a one-click repair** — *"None of this project's 2,561
  activities carry a Tower, but 2,561 of them do carry a Level — so the work IS located and only the
  Tower was never stamped"* — with a name field (defaulting to the project's own name) and an **Assign
  N activities** button.
- ⚠️ **It writes ONE key of the `location` map, on a COPY of the row's existing map** — a planner's
  Level / Zone / Unit values cannot be lost to a fix aimed at the level above them. Verified: a row's
  Level and Zone survive the stamp byte-for-byte.
- ⚠️ **Only rows that already carry a value at some LOWER level are touched.** Work with no location at
  all is not located work, and giving it a tower would file it under a building nobody put it in.
  A row that already has a tower is never overwritten. WBS summaries and non-execution work are skipped.
- ⚠️ **Never runs by itself** — no load-time repair, no silent mass UPDATE. The planner types the value
  and confirms the count, because it is their data and the right name is theirs to choose. Writer-only,
  and refused on an archived or view-only project.
- ⚠️ **Only the rows the server ACCEPTED are updated in memory.** A partial failure otherwise leaves the
  screen claiming a value the database does not hold — verified: with one row rejected, that row keeps
  no tower, the other keeps its new one, and the toast says "1 of 2 — run it again to retry the rest."
- Verified by executing the shipped `_vsStampTopLevel` against a One-Portwood-shaped stub: exactly the
  two located-but-untowered rows are sent; a row with an existing Tower and a row with no location at
  all are both left alone; a blank name is refused; a second run reports nothing to do. Inline script
  parses. ⚠️ **Not verified signed-in.** Delivered as `?v=20260826b`.

## A scrubbable timeline under the stack, and the stacking as a touch view (2026-08-26) — fmlozano
Owner: *"allow it for an ipad or phone view, wherein it is very aesthetic… add like a timeline bar,
scrollable, and the vertical stacking progress is dependent on the timeline bar. When i drag the line,
the vertical stacking also updates so we can see the actual progression."*

**The time bar.** A scrubber under the stack: drag the handle (or tap the track), and every cell —
each band, each tower header, the overall figure — re-reads at that date, so the building fills up as
you move through the programme. Month/year ruler, the **data date** marked in green, ‹ › to step a
month, **▶** to play the whole programme through, **Live** to return to recorded progress.
- ⚠️⚠️ **MODELLED FROM THE SCHEDULE'S DATES — NOT REPLAYED FROM HISTORY, and it says so on screen.**
  `project_schedule` keeps ONE `percent_complete` per activity: today's. There is no per-date record
  of what was complete last March, so nothing can replay it. A scrubbed cell answers *"how much of
  this work is SCHEDULED to be done by this date"*, straight-line across each activity's own span —
  the same model the S-curve's planned line uses. **A building filling up as you drag looks exactly
  like recorded history and would be quoted as it**, which is why the subtitle states the basis
  rather than leaving it to be inferred.
- ⚠️ **Duration-weighted, using the same weighting as `_vsPct`** — so a scrubbed cell and a live cell
  are the same kind of number and can be compared. Verified: two equal activities read 0 / 50 / 100
  before, between and after; a 100-day activity beside a 1-day one reads **1%** on day one, not 50%.
- ⚠️ **It follows the current BASIS.** On Planned it scrubs the baseline dates, on Actual the
  actual/forecast ones — verified: an activity whose actuals sit in March reads **0%** at a
  mid-January scrub even though its planned dates say otherwise.
- ⚠️ **The whole stack re-renders on each scrub frame, deliberately.** Every cell, every tower header
  and the magnifier all read the same `_vsProgress`, so repainting one of them would leave the others
  reporting a different date. It is a few hundred cells of SVG string, throttled to a rAF.
- ⚠️ **The drag captures the track's rect at pointerdown**, because the repaint REPLACES the track
  element — anything measured per-move against the live node would jump the moment the first frame
  landed. Pointer events, so a finger gets the same handle.
- ⚠️ **The track scrolls rather than compressing.** 60 months squeezed into 300px is 5px a month — a
  ruler nobody can read or hit; it keeps a legible minimum (26px a month) and scrolls.
- ⚠️ **Play starts from the BEGINNING when the scrub is live or already at the end** — pressing play
  on a finished programme should replay it, not sit still.

**The touch view.** ⚠️ The stacking is the one part of this module that reads well on a tablet — it is
a *picture*, not a 26-column editable grid — so unlike the schedule (a read-only card list below
700px) it stays fully itself and is only re-proportioned: one building per row, wrapping chips, and
every control at 44px, because this view is dragged and tapped.
- **New "Stack" tab in the phone view**, beside List and Gantt. ⚠️ Offered **only when the project has
  a location breakdown** — a tab that always says "nothing to stack" reads as broken.
- ⚠️ **`renderVStack(hostEl)` takes a host argument rather than the phone reusing the id.** The
  desktop `#ps-vstack` still exists (hidden) at phone width, so a duplicate id would win
  `getElementById` and the phone would paint into an invisible node.
- ⚠️ **The magnifier is DISABLED on a phone, not merely hidden** — there is no hover to drive it, and
  a docked panel would eat half the screen to show nothing. Tapping a zone still opens its activities.
- The building keeps its drawn size and scrolls; shrinking the SVG to 375px makes every zone date
  unreadable, which is the entire content of the view.
- Verified by executing the shipped `_vsPctAt`/`_vsSpan` (sliced from the file): the eight cases
  above, plus a single-date programme and a dateless one both correctly yielding **no scrubber**
  rather than a zero-width one. Inline script parses. ⚠️ **Not verified signed-in** — the drag, the
  play loop and the phone layout want a real device. Delivered as `?v=20260826a`.

## Cost Loading wears the Schedule Builder's clothes, and the money is the loudest thing on screen (2026-08-25) — fmlozano
Owner: *"can you make the UI more visually appealing. emphasize more on the fields that are essential.
Follow the format or appearance in the schedule builder."*
- ⚠️ **Built ON the builder's classes, not beside them.** `.sbld-wrap` / `.sbld-rail` / `.sbld-step` /
  `.sbld-panel` / `.sbld-kpi` / `.sbld-tablewrap` / `.sbld-foot` / `.sbld-tag` / `.sbld-locbar` are now
  what Cost Loading is made of; the old parallel `pscl-wrap/rail/step/panel/kpis` set is **deleted**,
  not left alongside. A second near-identical stylesheet is how two wizards in one app slowly stop
  looking like one app, and it doubles the cost of every future theme change. What is left under
  `pscl-` is only what Cost Loading has and the builder does not: money inputs and the step-4 stack.
- **The emphasis, concretely** — the ask was "the fields that are essential", so the hierarchy is now
  explicit rather than everything at one weight:
  - **The money input is the primary control**: 36px tall, a ₱ prefix in its own gutter, tabular
    figures at 14px/700, and a red focus ring matching the primary button.
  - **`td.nm`** (activity name) is bold 13.5px; **`td.money`** is bold tabular; **`td.sub`** (WBS codes,
    activity ids, location tokens) is muted 11.5px. Context stays present but stops competing with the
    figure — before, a row of grey codes carried the same weight as the peso amount.
  - Occurrence counts became `.sbld-tag` pills ("3×"), so a count reads as a label, not as data.
  - An unpriced total says **"not priced"** in muted text instead of an em-dash that could be mistaken
    for zero.
- ⚠️ **The KPI order is an emphasis decision, not decoration.** It now leads with **Assigned so far**
  (accent border, 26px) then what is still MISSING — not yet priced, distribution incomplete, both
  amber when non-zero — and only then the plain counts. The old strip led with "Activity names", a
  number nobody opens this screen for, and buried the assigned total among five identical boxes.
- **A running total lives in the table's `tfoot`**, at the bottom of the column it sums, where a
  planner typing down the list can watch it move — rather than as yet another box at the top.
- **Each step now has the builder's title + lede + footer.** The footer carries Back / Next (and
  **Apply to schedule** on step 4), because the bottom of a long table is where the eye is when the
  step is finished — the rail alone meant scrolling back up to advance.
- Verified by RENDERING the shipped code: the `CostLoading` closure was sliced out of the file and
  executed against a stub project (5 activity names × 3 sub-WBS, two of them priced), its steps 1–3
  painted into a page carrying the real `dashboard.css` + module `<style>`, and read back in a
  browser. All three panels render: rail with the four steps and their captions, the ₱1,450,000.00
  hero KPI, "3 not yet priced", the ₱-prefixed inputs, per-occurrence figures (₱333,333.33 for a
  ₱1,000,000 / 3 split), the footer total "2 of 5 · ₱1,450,000.00", and Back/Next. Inline script
  parses; no stale `pscl-wrap|rail|step|panel|kpis` reference is left. ⚠️ **Not verified signed-in**
  (step 4's stack needs a real located project). `MODULE_V` → `20260825q`.
- ⚠️ **No behaviour changed.** Grouping, distribution, the 100% rule, Apply and what it writes are
  untouched — this commit is markup and CSS.

## The push

### 2026-08-25 (k) — The push always stamps the tower; both stacking-axis commits reverted
Owner: *"HUH NO! it should be tower > level > zone > unit!!!"* `MODULE_V` → `20260825p`.
- **Reverted `878eb31` and `2f7ba1c`.** The stacking bands by `LOC_LEVELS[0]` = Tower again. Choosing a
  different axis from the data was answering a question nobody asked — and it stacked by Zone.
- ⚠️ **The root cause is in the WRITE path:** `locMapOf()` stamped the tower only on multi-tower
  projects ("a filter with one choice is noise") — a filter argument applied to a data question. The
  stacking bands by the first location level, so a single-tower push left 2,561 rows with nothing at
  that level. The tower is now always written; the tower CHIPS still only appear when there are two.
- ⚠️ Fixes the next push, not rows already stored — no silent mass UPDATE over planner data. Re-push,
  or use Group ▸ Match the WBS to your location breakdown.
- Full reasoning in `modules/project-schedule/CLAUDE.md`.
 now ALWAYS stamps the tower; the stacking axis is left alone (2026-08-25) — fmlozano
Owner: *"HUH NO! it should be tower > level > zone > unit!!!"*
- **Both of my axis commits are reverted** (`878eb31`, `2f7ba1c`). The stacking bands by
  `LOC_LEVELS[0]` again, which on these projects is **Tower** — which is what the owner wants. Picking
  a different axis was me answering a question nobody asked: the levels are right, the VALUES were
  missing.
  ⚠️ For the record, the coverage rule did work as designed and that is exactly why it was wrong on
  this project — it dropped Tower *and* Level and stacked by **Zone (Z1…Z6)**, because Level is
  carried by well under half the activities that Zone is. A view that re-chooses its own axis from the
  data will keep surprising the planner who chose those levels deliberately.
- ⚠️ **ROOT CAUSE, and it is in the WRITE path, not the view:** `locMapOf()` stamped the tower **only
  when `multiTower()`** — "a tower filter with one choice is noise". That is a FILTER argument applied
  to a DATA question. The vertical stacking bands by the first location level, so a single-tower push
  wrote 2,561 activities with no value at that level and the view could only file every one of them
  under *— No level —*. **The tower is now always written when the builder knows it.**
  ⚠️ The noise this guard was avoiding is still avoided: the stacking's tower CHIPS already appear
  only when there is more than one tower to choose between. That belongs at the display layer.
- ⚠️ **This fixes the NEXT push, not the 2,561 rows already in the database.** Nothing here rewrites
  stored locations — a silent mass UPDATE over a planner's data is not something to do as a side
  effect of a display bug. To fill them in: **re-push from Schedule Builder**, or use **Group ▸ Match
  the WBS to your location breakdown** and map the tower branch to the Tower level.
- **Zone before Unit is a Location Breakdown question, not a code one.** This project's levels are
  ordered Tower › Level › **Unit › Zone**; the stacking follows that order by design. Reorder them in
  **Location Breakdown…** and every view follows.
- Inline script parses. ⚠️ **Not verified signed-in.** `MODULE_V` → `20260825p`.

## The stac

### 2026-08-25 (j) — The stacking axis is chosen by coverage; (i) was a no-op
Owner: *"the levels are detected in the project schedule, yet in the vertical stacking no levels were
detected."* `MODULE_V` → `20260825o`.
- ⚠️ **(i) measured the wrong set.** It scanned `rows`, which also holds WBS summary rows and every
  non-execution activity, so one stray Planning row carrying a Tower kept Tower as the axis and put all
  2,561 execution activities back under "— No level —".
- **Now it counts the activities the view actually stacks**, and drops a leading level when it covers
  fewer than half the activities some level below it covers — so three stray towered rows cannot hold
  the axis, while a genuinely multi-tower project tagged 2,000 of 2,561 keeps its towers.
- Full reasoning in `modules/project-schedule/CLAUDE.md`.
king axis is chosen by COVERAGE — my first attempt at it was a no-op (2026-08-25) — fmlozano
Owner: *"the levels are detected in the project schedule, yet in the vertical stacking no levels were
detected."*
- ⚠️ **Why `878eb31` did not fix it: it measured the wrong set.** `_vsLevels()` scanned **`rows`** for
  a value at each leading level — and `rows` also holds every **WBS summary row** and every
  **Initiation / Planning / Close-out** activity. A single stray non-execution row carrying a Tower was
  enough to mark Tower "used", keep it as the axis, and put all 2,561 execution activities straight
  back under *— No level —*. The fix was written for this project and was a no-op on it.
- **Now it measures the activities the view actually stacks** (execution-phase leaves), and it counts
  them instead of asking a yes/no question. ⚠️ **A leading level is dropped when it covers fewer than
  HALF the activities that some level below it covers.**
  - Not a zero-test: three stray towered rows out of 2,561 would keep Tower as the axis and bury the
    other 2,558 — the same bug wearing a smaller number.
  - Not "best coverage wins" either: a genuinely multi-tower project tagged 2,000 of 2,561 must KEEP
    its towers. That is real structure, and the 561 untagged rows belong in the No-level band where a
    planner can see and fix them.
- ⚠️ **Not filtered by the toolbar** (no `rowMatches`) — the building's axis must not change shape
  because someone typed in the search box. Re-measured when the row set or `_editSeq` changes, so a
  location typed into the grid is picked up without a reload.
- Verified by executing the SHIPPED `_vsLevels` over seven shapes: no towers at all → **Level › Unit ›
  Zone**; the same plus one PLANNING row with a tower → **Level › …** (the case that broke the last
  attempt); plus a WBS summary row with a tower → **Level › …**; 3 towered execution rows of 2,561 →
  **Level › …**; 2,000 of 2,561 tagged → **Tower › Level › Unit › Zone** kept; fully tagged multi-tower
  → kept; nothing located at all → full axis kept and the existing No-level band still explains it.
  Inline script parses. ⚠️ **Not verified signed-in.** `MODULE_V` → `20260825o`.

## Vertical stacking: the building axis is the first level that is USED, not LOC_LEVELS[0] (2026-08-25) — fmlozano
Owner, on One Portwood Residences (trades now reading correctly): *"look at the vertical stacking,
there is no levels detected."* — 2,561 located activities, every one of them banded under
*— No level —*, with the floors (2ND Floor, B1, Ground Floor, Roof Deck…) visible as the CELLS.
- ⚠️ **Root cause:** the stacking hard-wired its building axis to **`LOC_LEVELS[0]`**, and on this
  project level 0 is **Tower**. `locMapOf()` deliberately stamps a tower **only when `multiTower()`** —
  a single-tower project is never given one, because a filter with one choice is noise. So every row
  had a Floor and no Tower, `_vsHasLevel()` asked the wrong level, and the view reported "no levels"
  while holding a fully located schedule — then blamed the Schedule Builder for it in the warning
  banner. The floors were on screen the whole time, one axis lower.
- **Fix:** `_vsLevels()` — the axis is the first location level **any activity actually uses**. On One
  Portwood that is Level › Unit › Zone; a genuine multi-tower project is untouched.
  ⚠️ **Only LEADING empty levels are dropped, and never the last one.** An unused level in the MIDDLE
  is a real gap in the data — hiding it would misreport the building instead of reading it. Verified:
  Tower used / Level empty / Unit used keeps the full four-level axis.
- One display change that follows: the Detail buttons and the "Tower › Level" caption now count from
  the used axis, so this project offers 1–3 (Level › Unit › Zone) rather than 1–4 with a dead first step.
- Verified by executing the SHIPPED `_vsLevels`/`_vsHasLevel`/`_vsMaxDetail`: the One Portwood shape
  (nothing carries a Tower) → axis **Level › Unit › Zone**, `_vsHasLevel` **true** for a 2ND-Floor
  activity, max detail 3; a two-tower project → **Tower › Level › Unit › Zone** unchanged; a middle
  gap → unchanged; nothing located at all → still returns an axis (never empty) and the existing
  "no level" band still explains it. Inline script parses. ⚠️ **Not verified signed-in.**
  `MODULE_V` → `20260825n`.
- ⚠️ **Scope, deliberately:** this touches the stacking's axis only. Nothing in the trade derivation,
  the grid or the loader was changed — that is what went wrong yesterday and it is not being repeated.

## REVERTED to the Cost Loading build — the three trade changes and the loading work are OUT (2026-08-25) — fmlozano
Owner: *"what happened? the previous version was okay haha… now everything is filled with errors.
revert it back."* `modules/project-schedule/index.html` is now **byte-identical to commit `2e418b4`**
(the Cost Loading build). `MODULE_V` → `20260825m` purely to bust the cached copy.
- **What went out:** `e04c7c7` (root/phase/location-aware `_nodeTrade`), `e6d5bd1` (`isTradeName`
  filtering a stored `work_type`), `3e7c302` (canonical matcher + short WBS codes in the walk),
  `14f3d8d` (loading screen, ready toast, parallel `loadResourcesAssignments`, `_codeTrade`).
- **What stayed:** Cost Loading, and everything before it.
- ⚠️ **The honest post-mortem: I changed the meaning of a value 400 other lines depend on, four times,
  without ever seeing the data.** `workOf()` feeds the Trade column, Trade grouping, the colours, the
  vertical stacking, the builder comparisons and Cost Loading. Each step was verified against a WBS I
  INVENTED from a screenshot — every test passed, and the screen still got worse, because the tests
  encoded my guess about the tree rather than the tree. Three rounds of that is not iteration, it is
  guessing with extra steps.
- ⚠️ **The specific overreach:** returning **""** for a branch that is only phase+tower. It is the
  right answer in principle — a chip reading "Tower 1" hides missing tagging — but on a project where
  most rows resolve that way it empties the whole screen at once. A change with that blast radius
  needed the planner to see it on ONE tab before it touched the grid, the grouping and the stacking
  together.
- ⚠️ **The loading/perf work (parallel fetches, overlay, ready toast) was innocent but shipped in the
  same commit as `_codeTrade`.** It is reverted with it rather than left in: a half-reverted file
  nobody has run is a worse starting point than the last build the owner called okay. It re-applies
  cleanly from `14f3d8d` on request.
- **What the owner actually asked for, still open:** (1) the Execution Phase must not read as a trade,
  (2) Site Works / Structural Works must be detected. Next attempt starts by READING the project's real
  `wbs_nodes` / `wbs` codes / `work_type` values — not a screenshot — and lands in ONE place first.
- Inline script parses (0 fail); Cost Loading intact; the original `_nodeTrade` (`chain[chain.length-2]`)
  back. `MODULE_V` → `20260825m`.

## Loading: a real loading screen, a "ready to edit" toast, and the WBS fetch stops queueing (2026-08-25) — fmlozano
Owner: *"there is a delay in loading the project schedule, can't there be a loading screen and
notification if successfully loaded and ready for editing?"* and then *"the loading is really slow on
the WBS, and there are still errors in the trades, so the vertical stacking is not fixed."*
- ⚠️ **ROOT CAUSE of "slow on the WBS": a slow QUEUE, not a slow query.** `loadResourcesAssignments()`
  awaited ~12 round-trips strictly one after another — resources, calendars, assignments, code types,
  code values, steps, UDFs, location levels, packages, WPM packages, class codes, scenarios — and
  `wbs_nodes` sat near the **END** of that chain. Nothing in it fed anything else in it. They are now
  all started together and awaited at the bottom; the wall-clock is the slowest fetch instead of the
  sum. **The one real ordering constraint is kept:** `ensureWbsSkeleton()` reads `WBS_NODES`, so it
  still waits for that fetch.
  ⚠️ **Each keeps its OWN try/catch and empty-array fallback** — one shared catch would let a missing
  `packages` table (an un-run migration) blank out resources too.
  ⚠️ **Still awaited, not fire-and-forget:** Resource Usage, the cost roll-ups and Cost Loading read
  these arrays the moment `load()` returns.
- **The loading screen now covers the part that was never covered.** Sign-in → project list → group
  heads are three round-trips that happened against an empty grid with no spinner at all; the overlay
  goes up **before** the first fetch and `load()` takes the same overlay over, so there is no flicker.
  ⚠️ `loadProjects()` got its own try/catch: under an overlay, a failed project list would otherwise
  leave a spinner over an empty screen saying nothing.
- ⚠️ **The overlay still comes DOWN as soon as there is a schedule on screen** — the cache-first paint
  is a real feature and covering it with a spinner would trade it for a progress bar. What was missing
  is that nothing said the *rest* was still running. The freshness chip now carries the stage
  (*Loading resources and the WBS tree… → Checking the WBS tree… → Syncing… → Restoring your
  grouping…*), because those steps each RE-RENDER the grid.
- **"Ready" is announced at the END of `load()`**, not at first paint: *"Schedule ready — N activities
  loaded in 4.0s. You can edit now."* ⚠️ Suppressed on a warm load that took ≤1.5s — undo, redo,
  import, paste, merge and scenario-apply all end in `load()`, and a ready toast on each is noise on
  top of the message that operation already showed. Verified by executing the shipped `_announceReady`:
  warm+fast silent, warm+slow speaks, cold always speaks.
- ⚠️ **THE remaining trade bug — an imported project has NO `wbs_node_id`.** The node walk fixed
  earlier had nothing to walk: `wbs_node_id` is written by the WBS Manager and the Schedule Builder,
  but an XER/Excel import files activities by **dotted WBS code** and leaves it null. So once the junk
  `work_type` stopped being believed, those rows had no trade at all — which is why the vertical
  stacking still looked wrong after two "fixes". `workOf()` now falls back to `_codeTrade()`, which
  resolves the code path (`4.1.3` → `4`, `4.1`, `4.1.3`) against the WBS **summary rows'** names —
  the same tree the importer's own stamp and the Trade wizard read — nearest-first, same canonical
  matcher. It also works **before** `wbs_nodes` has loaded, since those rows are already in `rows`.
- Verified by executing the SHIPPED `workOf`/`_codeTrade` on an import-shaped project (no node ids at
  all): `4.1.3 ST1` → **Structural Works**, `4.1.4 AR1` → **Architectural Works**, the tower branch
  `4.1` → no trade, the phase branch `4` → no trade, and a genuinely-named branch (`Store Room`) still
  returns itself. Inline script parses. ⚠️ **Not verified signed-in.** `MODULE_V` → `20260825l`.

## The WBS is matched to TRADES the way it is matched to locations — ST1 → Structural Works (2026-08-25) — fmlozano
Owner: *"the trades should be the General Requirements, Site Works, Structural Works, Architectural
Works etc… just like in the schedule builder? why not, like the function of matching WBS to a location
breakdown, identify also the matching of WBS to trades."*
- **That matcher already existed and the grid was not using it.** `discCanonOf()` / `WORK_CANON` back
  the **Match the WBS to Discipline / Trade** wizard (Group menu ▸ same place as *Match the WBS to your
  location breakdown*) and the importer's *Set Discipline / Trade from the WBS* tick-box. `workOf()`,
  which is what the grid, the grouping, the colours and the stacking actually read, had its **own**
  ancestry walk that returned raw branch names. Two answers to one question, and the screen showed the
  worse one. `_nodeTrade()` now asks `_discTermMatch()` **first**, nearest-ancestor-first — so an
  imported schedule reads in the Schedule Builder's vocabulary with **no wizard run at all**.
- **The vocabulary IS the builder's now.** `WORK_CANON` was missing **General Requirements** and
  **Others** — two of the builder's seven GWORK groups — so those could never be produced. Added.
  ⚠️ `'general'` alone is deliberately NOT a term: "General Notes" / "General Arrangement" are
  drawings, not a trade.
- **Short WBS codes are recognised: `ST1`, `AR-2`, `MEPF 1`, `Gen Req 1`, `SW1`, `SD3`.** This is what
  the owner's project actually uses, and no amount of term-matching would have caught it.
  ⚠️ **EXACT token after stripping a trailing sequence number, never a substring** — "ST" as a
  substring claims *Store Room*. Verified: `Store Room` → no code match.
- ⚠️ **Nearest-ancestor-first, so a breakdown collapses into its trade:** `Fire Protection Works` under
  `MEPF1` → **MEPF Works**; `Superstructure` under `ST1` → **Structural Works**. This is the same rule
  that stopped the Discipline grouping fragmenting into a dozen buckets on AVR101.
- ⚠️ **A stored `work_type` that IS a valid trade still wins, untouched.** The Trade wizard exists so a
  planner can deliberately keep a granular value — *Architectural Works › Tiling Works* → **Tiling
  Works** — and canonicalising over the top of it would silently undo their decision. Verified: stored
  `'Tiling Works'` survives; only junk (a phase, a tower) falls through to the WBS.
- ⚠️ A project whose vocabulary is genuinely its own is unharmed: when **nothing** in the ancestry is
  canonical, the previous rule still applies (shallowest branch that is neither a phase nor a place).
- Verified by executing the SHIPPED `_nodeTrade` / `workOf` / `_discTermMatch` over the owner's tree
  (`Project › Execution Phase › Tower 1 › ST1|AR1|SW1|MEPF1|Gen Req 1`): ST1→Structural Works,
  AR1→Architectural Works, SW1→Site Works, MEPF1→MEPF Works, Gen Req 1→General Requirements,
  Fire Protection Works→MEPF Works, Superstructure→Structural Works, the Tower and the phase branches→
  no trade, `Store Room`→itself (not a code hit), stored `'Execution Phase'`+ST1→**Structural Works**.
  Inline script parses. ⚠️ **Not verified signed-in.** `MODULE_V` → `20260825k`.

## One rule for what a trade is — a STORED `work_type` of "Execution Phase" is no longer believed (2026-08-25) — fmlozano
Owner, with the grid grouped `Trade › Activity › Tower › …` and every row sitting under a trade called
**Execution Phase**: *"it detected the execution phase as a trade idk why. pls fix the logic and make
it simpler for incoming projects."*
- ⚠️ **Why the previous fix did not reach it.** That fix cleaned up the WBS walk (`_nodeTrade`), but
  `workOf()` returned the row's own `work_type` **before** the walk ever ran, unfiltered. These rows
  carry `work_type = 'Execution Phase'` (and 'Tower 1') from an import, so no amount of WBS-side care
  could have changed the answer. I fixed the derivation and left the shortcut around it open.
- **Now there is ONE rule, `isTradeName()`: a trade is a name that is not a project phase and not a
  place.** Both the stored field and every WBS branch are put through it. Everything that asks "what
  trade is this?" — the Trade column, Trade grouping, the colours, the vertical stacking's chips, Cost
  Loading — goes through `workOf()`, so a new project cannot acquire a trade called *Execution Phase*
  or *Tower 1* by **any** route: import, hand edit, or tree shape. That is the "simpler for incoming
  projects" part — one predicate, one place.
- ⚠️ **The row is NOT rewritten.** Nothing runs a silent UPDATE over the planner's data on load; the
  value simply stops being believed, and the WBS answer (or "— No trade —") shows instead.
- ⚠️ **The grid's Trade cell EDITOR still shows the raw stored value** (`r.work_type`, line ~13935),
  while the cell's display shows the filtered one. Deliberate: the planner must be able to see and
  correct the junk that is being ignored, or it becomes invisible data they cannot fix.
- Verified by executing the SHIPPED `workOf`/`isTradeName`/`_nodeTrade` over the tree in the owner's
  screenshot (`Project › Execution Phase › Tower 1 › ST1|AR1`, rows located at Tower 1/Tower 2 ·
  Ground Floor/2F): stored `'Execution Phase'` + ST1 branch → **ST1**; stored `'Tower 1'` + AR1 →
  **AR1**; stored junk with only the phase above → **""**; a real stored `'Structural Works'` → kept;
  no `work_type` → **ST1**; **"Tower Crane Works"** → kept, because no activity carries it as a
  location. Inline script parses. ⚠️ **Not verified signed-in.** `MODULE_V` → `20260825j`.

## The vertical stacking listed the TOWERS as trades — `_nodeTrade` trusted the branch under the root (2026-08-25) — fmlozano
Owner, with a screenshot of the trade chips reading *All trades · Execution Phase · Tower 1 · Tower 2*:
*"i think there is error in detecting the trades in a project schedule… it detected the towers as trades."*
- ⚠️ **Root cause:** `_nodeTrade()` took **the branch directly under the root** as the trade, with an
  explicit "no phase-root gate — every branch name is a classification" note. Real trees are
  `Project › Execution Phase › Tower 1 › Structural Works › Zone A`, so that branch is the **phase**;
  and when the phase itself is the root (which is how some of these projects are filed) it is the
  **tower**. Both chips in the screenshot are that one line of code, seen at two different WBS depths.
  This was never only a stacking bug — `workOf()` feeds Discipline/Trade grouping, the trade colours
  and the builder comparisons too.
- **Fix:** scan the ancestry **root-first** and take the **shallowest branch that is neither a phase
  heading nor a location**. Everything above it is skipped.
- ⚠️ **Skipped, not used as a fallback.** A branch that is only ever `Execution Phase › Tower 1` now
  yields **no trade** rather than "Tower 1" — a chip reading "Tower 1" looks like an answer and cannot
  be spotted as missing data, whereas "— No trade —" tells the planner to tag the work.
- ⚠️ **Locations are recognised from the project's OWN data** — the values its activities actually
  carry at each location level, plus the level names — **never a word list**. Verified: a genuine
  **"Tower Crane Works"** branch is still returned as the trade, because no activity carries it as a
  location. Pattern-matching on the word "Tower" would have eaten it.
- ⚠️ **The root is not a candidate** — it is the project, and "Test Project" is not a trade. The one
  pre-existing exception is kept: an activity filed **directly** on a root is still named by it, since
  a root can legitimately BE a trade node and that case is structurally indistinguishable.
- ⚠️ `work_type` still wins over the whole walk, so Schedule-Builder pushes (which stamp the canonical
  trade) are untouched. The location set is rebuilt when the row count or level count changes, and the
  cached trade answers are dropped with it — a tower typed in the grid starts being excluded without a
  reload.
- Verified by executing the SHIPPED `_nodeTrade`/`workOf` (sliced out of the file, not reimplemented)
  over a WBS carrying both shapes: deep `Phase›Tower›Structural›Zone` → **Structural Works**;
  phase-as-root `Phase›Tower 2›Architectural` → **Architectural Works**; `Phase›Tower` only → **""**;
  the phase branch itself → **""**; `Tower Crane Works` → itself; a parentless trade node → itself;
  `work_type` set → wins. Inline script parses. ⚠️ **Not verified signed-in.** `MODULE_V` → `20260825i`.

## Cost Loading — the four-step exercise that puts money on the activities (2026-08-25) — fmlozano
Owner: *"there must be a cost loading feature… Step 1: enlisting all activity level activities found
under the execution phase… Step 2: assigning the cost for each activity… Step 3: distribution for each
activity under each sub-WBS, equally or by a percentage… Step 4: consolidation and review, a vertical
stacking dependent on the selected activity."* Built as its own tab (**Cost Loading**, left of Cost/EVM),
a rail of four steps over one shared config. **Run `migrations/2026-08-25-schedule-cost-loading.sql`.**
- ⚠️ **The money is NOT stored in the new table.** `schedule_cost_loading` holds only the *working
  state* — a total per activity name and how it is split. **Apply writes `project_schedule.planned_cost`**,
  the column Cost/EVM, the Excel export and Cash Flow's cost-basis S-curve already read. A second
  per-activity cost store is how two screens end up disagreeing about the same peso.
- ⚠️ **Step 1 groups by NAME, not by WBS** — that is what the exercise *is*: "Formworks" is one cost
  line the programme happens to run 40 times. Grouping by WBS would make the planner price the same
  work 40 times over, which is the spreadsheet this replaces. Rename in step 1 and it is a **real
  schedule edit on every instance** (through `persist()`, so undoable and audited), and the pricing is
  carried across with the name — otherwise a planner orphans their own total by renaming.
- ⚠️ **Scope is execution-phase leaves only, and milestones are excluded.** A zero-duration marker
  carrying cost earns its value the day it flips, which is precisely the milestone padding a
  cost-loaded programme must not allow. A project with no execution branch is **told**, then offered
  every leaf, rather than silently loaded with initiation and closeout lines.
- ⚠️ **Instances are keyed on `activity_id`, never the row uuid.** A re-import replaces every row and
  mints new uuids; a uuid-keyed distribution would silently reset itself to "equal" on the next import.
  No activity id → a stable `wbs|name` fallback.
- ⚠️ **The rounding remainder lands on the LAST instance so the split sums to the total EXACTLY.**
  Verified by executing the shipped `distribute()`: 1,000,000 over three → 333,333.33 / 333,333.33 /
  333,333.**34**, summing to 1,000,000. The naive version comes to 999,999.99 and the project total
  drifts away from the figure the planner agreed.
- ⚠️ **A percentage split that does not add to 100% is REFUSED, never normalised** — normalising
  changes figures the planner typed with nothing on screen to say it happened. Verified: 30/60 returns
  `null` amounts and `_invalid`, and Apply names the offending activity instead of writing.
- ⚠️ **Apply states how many rows already carry a Planned IBB** from an import or an earlier loading and
  will be replaced — a count in the confirm, not a quiet overwrite. Nothing to write says so.
- Step 4 is the **vertical stack of the money**: towers side by side (or one pinned), one row per level,
  the bar sized by that level's **share of the selected activity's cost**, so the tallest bar is where
  the money is. Its own scope state, deliberately separate from the Gantt stack's.
- ⚠️ Tolerant of the un-run migration, like the builder: the exercise works in the browser and says
  *"Not saved — run migrations/…"* rather than failing to open.

## Both stacking windows are resizable, and the tower card hugs its own drawing (2026-08-24) — fmlozano
Owner, on the vertical stacking: *"can the window size containing the vertical stacking be resizable…
the total width of the vertical stacking based on information must also be same with the width of the
window containing the vertical stacking. In addition, the window of the magnifier should also be
resizeable."* Two separate faults, and the first is a real layout bug, not a preference.
- ⚠️ **The tower card was ~590px of dead space.** `.ps-vs-grid` was
  `grid-template-columns: repeat(auto-fit, minmax(360px, 1fr))`, and a **`1fr` track STRETCHES its item
  to fill the row** — so a short building (one zone wide, 180px of SVG) sat in a card the full width of
  the viewport. **Measured in a real browser at 1200px: 851px of card around 180px of drawing → 240px.**
  Now `display:flex; flex-wrap:wrap` with `.ps-vs-tower { flex:0 0 auto }`, so the card's width IS the
  information's width, and several towers wrap instead of each claiming a full-width row.
  ⚠️ `min-width:min(100%,240px)` is not padding for its own sake — without it a one-cell tower
  ellipsises its own name in the header, which is worse than the 32px of slack it costs.
  ⚠️ This re-activates the earlier (block A) flex rules, dead since block B's grid overrode them; block
  B is still the one that wins, so put new stacking CSS there.
- **One handle resizes BOTH windows, because they share one row.** The panel is right-docked, so its
  left edge is the only edge that can move: a `.ps-vs-loupe-res` gutter riding in the stage's existing
  14px gap (negative margins, so it steals width from neither pane) sets the panel's width directly and
  the stacking pane takes the remainder — it is `flex:1 1 0`. **Verified: 851/307 → 671/487, the sum
  preserved at 1158px in both.** A second grip under the magnified drawing sets the panel's height
  (245 → 395px). Double-click either to return to the responsive CSS default.
- ⚠️ **The stored width is CLAMPED against the stage's current width on every apply, and the corrected
  value is what gets saved.** This is the `ps_grid_w` trap that once made the Gantt pane vanish with no
  way back but editing localStorage: a width dragged on a wide monitor, restored verbatim on a narrow
  one, collapses the other pane to nothing. **Verified: a stored 900px in a 560px stage heals to 310px
  with the stacking pane still at 208px.**
- ⚠️ **`_vsLoupeMaxW` mirrors the CSS `max-width:72%` as well as the pane floor, so the width we STORE is
  one that can actually be displayed.** Without the 72% term the drag stored **938px while the panel
  rendered 852px** — a number in localStorage describing a layout nobody had seen. Caught by measuring
  stored-vs-rendered, not by reading. **Verified equal (852/852) after the fix.**
- ⚠️ **Pointer events with `setPointerCapture`, not mouse events** — the drag survives the pointer
  leaving the 6px strip mid-gesture, and a touch screen gets the same handle for free. The
  `ps-loupe-rz` class is held on `<body>` for the duration, or the cursor flickers back to the default
  the moment the pointer leaves the strip and text selects as you drag.
- ⚠️ **A resize repaints the panel** (`_vsLoupeRepaint`, from the remembered last-hovered cell). The
  clone is sized by its BOX, so a resized panel would otherwise keep the previous box's aspect ratio —
  which reads as a rendering fault rather than a resize. Silent when nothing has been hovered yet.
- Below 1100px the stage stacks and the horizontal handle is **hidden** — both panes are full-width
  there, so a horizontal drag has nothing to divide. **Verified at 900px: handle `display:none`, stage
  `column`, height grip still live, no page h-scroll.**
- **Verified in a real browser against the module's REAL `<style>` block and the SHIPPED handlers**
  (`_vsLoupeMaxW` / `_vsApplyLoupeSize` / `_vsWireLoupeResize` sliced out of index.html, not
  reimplemented), gitignored harness, deleted after: every number above, plus the drag classes being
  cleared on pointerup, the double-click reset nulling both stored values, and both handles resolving
  to real token colours in **dark** mode (grip `rgb(61,26,25)` against the card's `rgb(43,44,43)`) as
  well as light. ⚠️ **The sanity gate earned its keep again** — it asserts the shared `dashboard.css`
  loaded (`--pd-red` resolves) and the stage computes to `flex`, without which every measurement is
  meaningless. ⚠️ One run died on `_vsLoupeMaxW is not defined` — a **harness** gap (the new function
  was not in the slice list), not a code fault.
- Parse clean (1 block); **function-set diff vs HEAD: 0 lost, 5 added.** ⚠️ **Not verified signed-in.**
  `MODULE_V` → `20260824m`.

## At Completion is measured from the dates the schedule shows (2026-08-24) — fmlozano
Owner: Close-Out & Acceptance runs 24-Sep-2026 → 22-Nov-2026 and At Completion read **6 days**.
- ⚠️ **`actual + remaining` silently omits the GAP between the two.** Under retained logic an activity
  whose remaining work waits on a predecessor has elapsed nothing yet and 6d of work left, so the sum
  reported 6d against a 60d span. It also read `0 + remaining` whenever the actual start is later than
  the data date, since `actualDurLive` is elapsed-to-date.
- Now `dispStart → dispFin` inclusive — the same dates the Start and Finish columns beside it show, so
  the three can no longer disagree. Milestones are 0 (point events); with no usable pair of dates it
  falls back to the old sum, then to the planned duration.
- ⚠️ **Planned Duration deliberately stays the locked BASELINE span.** The two differing IS the
  variance, not a bug — do not "reconcile" them.
- ⚠️ **Data anomaly to raise with the owner, not worked around:** that activity's actual start
  (24-Sep-2026) is LATER than the data date (24-Aug-2026), which is why Actual Duration reads 0d. The
  module refuses that on a manual edit ("Actual Start can't be later than the Data Date"), so it most
  likely arrived via an import or a Schedule Builder push.
- Verified against the shipped function; **0 functions lost**. ⚠️ **Not verified signed-in.**

## Modal chrome: content was bleeding through the pinned header and footer (2026-08-24) — fmlozano
Owner, with a screenshot: *"The ends of the pop-up window are clashing with the edit activity title
… and risk - 3point estimate are clashing with the save activity below."* Correct, and it was a defect
in the pinning I shipped an hour earlier.

- ⚠️⚠️ **ROOT CAUSE: a sticky offset is measured from the SCROLLPORT'S CONTENT ORIGIN, and the shared
  `.pd-modal` carries `padding:22px`.** So `top:0` parked the header **22px below the modal's visual
  top** and left a 22px band that the form scrolled through in full view; `bottom:0` did the same under
  the footer. That is exactly what the screenshot shows — "Secondary Constraint" above the title and
  "RISK — 3-POINT ESTIMATE" below the Save button. Fixed with `top:-22px` / `bottom:-22px`, which is
  where the two already sit at rest via their own negative margins.
- ⚠️⚠️ **MY VERIFICATION WAS THE REAL FAILURE, and it is the lesson worth keeping.** The first pass
  measured `hdrPinned: 22 / ftrPinned: 22` at four scroll depths and I read the **constant** as proof
  of correct pinning. The constant only proved the element was sticky; **the 22 WAS the gap.** An
  offset test cannot answer "does the user see content there" — only an occlusion test can.
- **The test that actually settles it: `document.elementFromPoint` at the top and bottom pixel rows of
  the modal.** At five scroll depths the top band must paint the HEADER and the bottom band the FOOTER.
  It now does at every depth. ⚠️ **Contrast-checked by reverting the offsets to `0` in the live DOM:
  the top band paints `ps-f-afinish` and the bottom `ps-f-succ`** — form fields showing through,
  reproducing the report exactly. A check that does not fail on the old behaviour proves nothing.
  (Same technique the drawing-register scroll work used for the translucent frozen columns.)
- ⚠️ **A second bad assertion on the way:** counting elements whose rect *spans* the band flagged 1–2
  "bleeding" items even after the fix — those are tall fields legitimately scrolled BEHIND an opaque
  header, not visible through a gap. Rect-intersection cannot distinguish the two; hit-testing can.
- ✅ **The scroll-spy is now VERIFIED**, closing the caveat from the previous entry. It could not be
  exercised in the Browser pane (not compositing → zero scroll events), but a headless Edge screenshot
  at `scrollTop=1100` shows the rail's active tab reading **DATES & DURATION**, which only the scroll
  handler sets — the build-time call marks Contract Scope.
- Verified at five scroll depths: gap above header **22px → 0**, gap below footer **22px → 0**, top
  band HEADER and bottom band FOOTER throughout, plus a screenshot mid-scroll showing both edges
  cutting cleanly. Parse clean. `MODULE_V` → `20260824f`.

## Add/Edit Activity modal restructured — sections, pinned chrome, a section rail (2026-08-24) — fmlozano
Owner: *"Let's improve the edit activity pop up window. It looks all over the place."* Then, mid-build:
*"If we can also have sticky tabs protruding out the side of the popout window."* Measured the modal
first rather than restyling by eye, which is what turned a vague complaint into four specific defects.

**What was actually wrong, measured in a harness built from the REAL module `<style>` + the REAL modal
markup (sanity-gated on the grid resolving to 2 columns and the section colour being brand red):**
1. ⚠️ **The biggest "section" was a mislabelled dumping ground.** 44 fields, 5 headers — and **19 of
   them sat under "Contract Scope", a header that describes exactly 2.** Everything from Activity Type
   to Earned Value had been appended there over time. That is the disorder, in one number.
2. ⚠️ **`.pd-modal` is ITSELF the scroll container** (`max-height:90vh; overflow-y:auto` in the shared
   dashboard.css) with the header and footer as its children — so on a **2227px** form the title AND
   the **Save button scrolled completely out of view**, and saving meant scrolling back to the bottom.
3. ⚠️ **Rows were ragged because label heights differ.** "Trade" carries three lines of `<small>` help
   text while its row-mate "Work Package" carries one, so the two controls started at different heights
   and the row read as broken.
4. ⚠️ Measured, not guessed: the shared `.pd-select` renders **41px** and `.pd-input` **39px**, so even
   bottom-aligned rows sat 2–3px out.

**What was done.** Ten coherent sections (Classification · Dates & Duration · Constraints ·
Relationships · Cost · Labor Units · Risk · Location/Codes · Notes), with **dates gathered from the
three places they were scattered across** into one group. Each cell is a flex column with its control
pushed to the bottom, so a tall label no longer drags its row out of line; control heights unified at
40px inside this modal. Header and footer **pinned** — Save is now always reachable. A **section rail**
of sticky tabs protrudes from the modal's left edge; clicking one scrolls that section under the header
and lights the tab.
- ⚠️ **Every field block was MOVED VERBATIM by script, never retyped**, and the reorder is asserted:
  **form id set identical to HEAD, 67 before and after, 0 lost / 0 added.** Only the 4 id-less section
  headers were replaced; the one header with an id (`ps-f-scope-sec`, toggled by the contract-scope
  logic) was preserved untouched.
- ⚠️ **The rail is a SIBLING of `.pd-modal`, not a child** — a child would scroll away with the form,
  since the modal is the scroller. The overlay is `position:fixed` and already a centred flexbox, so
  the rail parks against the modal's edge and stays put. Hidden below 1100px, where it and the 720px
  modal no longer fit side by side.
- ⚠️ **All new CSS is scoped `#ps-modal`.** `.pd-modal-header`/`-footer`/`.pd-input`/`.pd-select` are
  SHARED components used by resource-loading and cash-flow, and the module contract forbids editing
  shared assets — these must never become bare selectors.
- `_syncFormSections()` hides a header whose whole group is hidden, so a project with no location
  levels gets no empty "Location, Codes & UDF" heading and no dead rail tab. ⚠️ It **skips any header
  with an id** — that means other code owns it — and reads the inline `style.display` rather than
  `offsetParent`, which is null for everything inside a hidden overlay.

**Four defects found BY MEASURING, three of which I had introduced and would otherwise have shipped:**
- ⚠️ **Sticky section headers pinned and NEVER RELEASED** — a `.ps-form-sec` is a grid item, so by
  mid-scroll *three* headers were painted at the same spot. Removed, with a comment saying why, since
  making it work needs each section wrapped in its own containing block.
- ⚠️ **My flex-column rule broke the Program Milestone row**, stacking the checkbox above its label and
  centring both (its inline `align-items:center` is the CROSS axis, which a column flips). Fixed with a
  `.ps-form-chk` opt-out.
- ⚠️ **The rail's active tab was wrong on 3 of 9 tabs.** The last sections can never reach the top line
  (nothing below them to scroll past), so a positional rule lit "Notes" for clicks on "Labor Units" and
  "Risk". Resolved by splitting the two: **a click asserts its own tab; scrolling infers by position**
  (with a bottom-of-scroll rule). Verified all 9 tabs: correct active state, each landing at 0px or
  legitimately saturated.
- The rail carried a stray horizontal scrollbar (`overflow:auto` → `overflow-x:hidden`).

**Verified by MEASUREMENT, executing the shipped `_syncFormSections`/`_buildSecNav` sliced verbatim
into the harness:** 44 fields (unchanged), 10 sections / 9 visible / 9 rail tabs, header and footer
pinned at 22px/22px at **every** scroll depth, 2 clean column positions, no horizontal scroll, and both
themes' sticky bars **opaque and exactly matching the modal background** (a translucent sticky bar would
let the form scroll through it — the same trap as the translucent frozen grid columns). Screenshots in
both themes. Parse clean; **function-set diff: 0 lost, 3 added**; form id set identical.
- ⚠️ **Known and accepted: 2 of 18 paired rows are still 3px out.** Those two cells hold trailing
  content AFTER the control (a `<datalist>`; a hint `<div>`), so bottom-aligning the control cannot
  align them. Not worth restructuring the markup for 3px.
- ⚠️ **The scroll-spy could NOT be verified here**: the Browser pane is not compositing, so **zero
  scroll events fire even for a fresh probe listener** — the same stalled-compositor artifact as the
  screenshot timeout. The click path is fully verified and deliberately does not depend on it.
- ⚠️ **A stale screenshot cost a cycle**: Edge served a cached page and showed two fixes as still
  broken. Confirm a UI fix by measuring the live DOM, or screenshot with a fresh `--user-data-dir`.
- ⚠️ **Not verified signed-in.** `MODULE_V` → `20260824e`.

## Mirrored procurement rows are typed 'Work Package', not 'Task' (2026-08-24) — fmlozano
Owner: *"When syncing from procurement let's make all of these into work packages rather than a Task."*
One value in `syncProcurement`'s patch — the surrounding vocabulary already existed.
- **No migration.** `project_schedule.activity_type` is plain `text default 'Task'` with **no CHECK
  constraint** (verified in both `supabase-schema.sql` and `supabase-setup.sql`), and **'Work Package'
  was already a first-class type** — a concurrent session had added it to the Add/Edit select, the Type
  filter menu, the General tab, `taskKindOf` and a dedicated `.ps-tk-wp` chip. This just starts using it.
- ⚠️ **Existing rows self-migrate, nothing to backfill.** `activity_type` is in `patchFields`, so the
  diff loop sees `'Task' !== 'Work Package'` and issues the UPDATE on the next sync.
- ⚠️ **ONLY the package rows.** The trade branches stay `'WBS Summary'` — they are the headings, and
  re-typing them would stop `isWbs()` recognising them, which is precisely the headless-branch failure
  fixed earlier today. `syncDesignDevelopment` is deliberately untouched: those rows are register
  roll-ups, not procurement packages.
- **Checked every consumer before changing the value**, since a type is read in four places: the chip
  (`.ps-tk-wp` exists), the Type **filter** (`filters.type[r.activity_type || 'Task']` — exact match,
  and 'Work Package' is offered in the menu), the Activity Type **grouping** dimension (returns
  `activity_type` verbatim, so packages now form their own group), and rendering — `isWbs()`/`isMile()`
  both return false, so the row still draws a normal bar. Nothing keys off the literal `'Task'`.
- **Verified by EXECUTING the shipped renderers** (`isWbs`, `isMile`, `isFinishMile`, `isWbsNode`,
  `taskKindOf`, `taskCellHtml` sliced verbatim) — `scratchpad/check-wptype.js`, **16/16**: the chip, the
  class, not-a-WBS, not-a-milestone, Task/WBS/Milestone all unchanged, the sync writing the new type and
  no longer writing `'Task'`, DD untouched, and all four consumer call sites present. Other suites green
  (cross-project 14/14, sweep 8/8, `_ensureNodeSummary` 18/18); parse clean; **0 functions lost/added**.
- ⚠️ **Three test failures on the way, all MY assertions, none the code:** I asserted the trade headings
  were projected by literal text inside `syncProcurement` (they come from `_ensureNodeSummary`); I sliced
  `syncDesignDevelopment` *backwards*, since it is defined **after** `syncProcurement` in the file; and a
  regex for `WBS Summary` matched **my own comment prose**. The last one is the repo's recurring trap —
  assert on the payload form (`activity_type: '…'`), not on a bare phrase.
- ⚠️ **Not verified signed-in.** `MODULE_V` → `20260824d`.

## The 83 corrupt rows: characterised, and a backed-up cleanup written (2026-08-24) — fmlozano
Follow-up to closing the writer. **Measured every one of the 83 rows before proposing anything**, and
the result removes the ambiguity: **not one of them is a legitimate projection.**
- **3** point at a WBS node belonging to a **different project**; **80** point at a node that **no
  longer exists**; **0** point at a node in their own project. **0** activities hang off those node
  ids, so deleting them orphans nothing.
- All 83 carry a NULL `wbs`, so they cannot nest (`rebuild()` derives ancestry by splitting the dotted
  code) and nothing can ever be filed under them.
- ⚠️ **Visible damage, not just clutter: BAU101 holds 40 WBS nodes and 112 summary rows.** 82 of the
  excess are these. The names (`U1` ×14, `U2` ×13, `Z2` ×11, `Z4`, `F7`…) are Schedule Builder unit and
  zone branches from the 2026-08-19 push.
- **Scope verified exact against the live DB:** `wbs IS NULL` matches **83 and nothing else**;
  `wbs = ''` matches **0** and is deliberately out of scope (copy-WBS-from-project inserts a blank code
  on purpose and lets `_wbsCommit()` assign the real one — ⚠️ never widen the predicate to
  `coalesce(wbs,'') = ''`); non-summary rows with a NULL `wbs`: **0**.

⚠️ **NOT deleted from here, deliberately — `migrations/2026-08-24-cleanup-null-code-wbs-rows.sql` is for
the owner to run in the SQL editor.** Two reasons, and the second is the one that decided it:
1. **A backup table needs DDL**, which the publishable key cannot do; the repo's own precedent requires
   the operation be reversible from a timestamped backup before any delete.
2. ⚠️ **A JSON backup through the browser channel would have been ceremony, not safety.** It returns
   ~900 characters per call, so the 83 rows' 10.7 KB minimum payload needs ~12 round-trips — **and the
   restore would be worthless anyway**, because 80 of the rows reference nodes that no longer exist, so
   re-inserting them would only re-create the same phantoms. The SQL editor gives a real
   `create table … as select` backup in one statement.
- The script backs up first, **deletes by joining on the backed-up ids** (so the two can never
  disagree), then verifies. Expected: BAU101 **112 → 30** summary rows against 40 nodes, and the next
  time it is opened the heal projects the 10 genuinely-missing trade headings for a clean **40/40**.
  Reverse and drop statements are at the bottom.

## Cross-project summary rows: the 2026-08-17 pinning fix had a hole (2026-08-24) — fmlozano
The 83 corrupt rows found during yesterday's verification are now understood and the writer is closed.
⚠️ **This is a follow-up to the 2026-08-17 `ownPid`/`ownNodes` pinning fix, which did not go far enough.**

**Root cause, proven from the two fingerprints rather than inferred.** A corrupt row has BOTH a
`project_id` from one project and a `wbs_node_id` from another, AND a NULL `wbs`. Each half has its own
cause and they share one trigger:
- ⚠️ **`pid` and `WBS_NODES` are updated at DIFFERENT times.** `pid` is set early in `load()` /
  `selectProject()`, but `WBS_NODES` is only replaced later, inside `loadResourcesAssignments()`
  (`WBS_NODES = await selectAllPaged('wbs_nodes','*')`). In that window `pid` is the NEW project while
  the tree in memory is still the OLD one. So `ownPid = pid` pins the NEW id, `ownNodes =
  WBS_NODES.slice()` pins the OLD nodes — and **`switched()` can never notice, because it compares
  `pid !== ownPid` and both are the new id.** The guard was watching the wrong thing.
- ⚠️ **`computeWbsCodes()` read the LIVE `WBS_NODES`, not the pinned list.** Called after dozens of
  awaits, by which time the tree may have been swapped, so `codeOf[n.id]` for a pinned old node comes
  back **undefined** → the row is written with `wbs` NULL. That is the marker the whole scan keyed on.
- **Invisible to every repair by construction:** the heal probes `.in('wbs_node_id', <this project's
  ids>)`, which matches neither a foreign id nor a NULL, and `_wbsDedupeSummariesByCode` skips a blank
  code outright (`if (!k) return`). That is why 83 rows sat there for four days.

**Three layered guards, cheapest first:**
1. **`computeWbsCodes(nodeList)`** takes an optional pinned list, defaulting to `WBS_NODES` so all ~20
   existing call sites are unchanged. The heal now calls `computeWbsCodes(ownNodes)`.
2. **The heal validates that its pinned tree belongs to its pinned project** —
   `ownNodes.filter(n => !n.project_id || n.project_id === ownPid)` — which is possible only because
   `WBS_NODES` is loaded with `select('*')` and so carries `project_id`. ⚠️ A node with **no**
   `project_id` is kept, not dropped: absence of the field must not silently delete real nodes. If
   nothing survives the filter the tree in memory is not this project's and it returns 0 for the next
   load to retry.
3. ⚠️ **`_insertWbsSummary` / `_insertWbsSummaries` refuse a payload whose `wbs` is null/undefined** —
   the universal backstop that catches this **no matter which writer races**, present and future.
   `undefined` from a `computeWbsCodes()` lookup has exactly one meaning: the node is not in the tree the
   codes came from. ⚠️ **`''` stays legal** — copy-WBS-from-project deliberately inserts a blank code and
   lets `_wbsCommit()` assign the real one; only null/undefined is the failure. The refusal returns
   `{error:null, data:null, skipped:true}` and console-warns rather than toasting or erroring, so a
   caller that checks `res.error` neither breaks its loop nor spams the planner; the bulk variant
   **filters** rather than aborting, so one unresolvable node cannot cost its legitimate siblings.

**Verified by EXECUTING the shipped functions**, sliced verbatim (`computeWbsCodes`,
`_insertWbsSummary`, `_insertWbsSummaries`) — `scratchpad/check-crossproject.js`, **14/14**. It contains
the **reproduction**: with the live tree swapped, the pre-fix lookup yields `undefined` for a pinned old
node while the pinned lookup still resolves it to `1.1`; the corrupt write is then refused with zero
inserts. Plus backward compatibility of the no-arg call, `''` still inserting, a valid row still
inserting, the bulk path keeping the good rows and dropping only the bad, an all-bad batch as a clean
no-op, and the shipped ownership filter's behaviour. Prior suites still green (sweep 8/8,
`_ensureNodeSummary` 18/18); parse clean; **function-set diff vs HEAD: 0 lost, 0 added.**
⚠️ A parse error during the edit came from an escaped apostrophe inside a JS string literal that lost
its backslash in transit — the same class as the repo's documented heredoc traps. Reworded rather than
re-escaped; **always re-run the parse check after writing a string with a quote in it.**
⚠️ **The 83 existing rows are NOT cleaned up here** — deleting is destructive and needs sign-off.
`MODULE_V` → `20260822h`.

## VERIFIED SIGNED-IN on live data — and a pre-existing cross-project row found (2026-08-24) — fmlozano
Both 2026-08-24 fixes verified against the deployed build in the owner's signed-in browser. This closes
the "not verified signed-in" caveat on the sweep fix and the creator-projection fix.

- **Deployed build confirmed** by fetching the live file: 12 `_ensureNodeSummary` references and the
  sweep's `isWbs(r)` guard both present on GitHub Pages.
- **OPW101 — the reported project: repaired.** `nodesMissingSummary` **9 → 0**; 460 nodes / 460 summary
  rows, 0 orphans, 0 duplicates, and all 9 trades holding exactly one heading (`3.3.1`–`3.3.9`).
- ⚠️ **The decisive test: heading row IDs captured before, compared after.** A full module load (which
  runs `syncProcurement`) plus a button-triggered **Sync Procurement**, then a second full load:
  **0 deleted, 0 recreated, IDs byte-identical**. Before the fix that sweep deleted all 9 every time.
  Recreated-vs-survived matters — identical IDs prove the rows were never touched, rather than deleted
  and re-made by the new projection.
- **SLN101 was an unplanned natural experiment and the best evidence of the pair working together.** It
  still carried the old damage (**5 of 10 trades with no heading**) because it had not been opened since
  the fix. One load: row count **254 → 259** — exactly the five — ending at **65 nodes / 65 headings, 0
  missing, 0 duplicates**. So the heal repairs history while the creators stop producing it.
- **Sync Engineering exercised on SLN101** (the only project whose `eng_design_progress` mirror has
  rows): completed, **0 DD headings deleted, IDs unchanged, 0 duplicates**, integrity still 65/65.
  ⚠️ On OPW101 that mirror is **empty**, so Sync Engineering there only ever hits the documented
  "an empty mirror leaves the branch untouched" guard — nothing to verify, which is why SLN101 was used.
- **AVR101 healed the same way on one load** (10 missing → 0).
- ⚠️ **Still carrying the old damage, un-fixed because they have not been opened since:** **BAU101** and
  **GPR101**, 10 trades each. They self-heal on the next load, exactly as SLN101 and AVR101 just did.
  GPR101 (17k activities) was deliberately not driven from automation — see the freeze note below.

### ⚠️ Pre-existing defect found while verifying — NOT caused by these changes, NOT fixed
A cross-project scan (`.in('wbs_node_id', …)` **without** a `project_id` filter) reported OPW101 as
having a duplicate heading; the project-filtered query said 11 nodes / 11 rows / 0 duplicates. The
difference is the bug:
- **A `project_schedule` row belonging to BAU101 carries a `wbs_node_id` pointing at OPW101's
  "Design Development" node**, with `wbs: null`, created **2026-08-19T08:30:02Z** — three days before
  today's work.
- ⚠️ **A NULL `wbs` on a summary row is the fingerprint**: `computeWbsCodes()` is built from the CURRENT
  project's tree, so a node from a *different* project has no entry and the code writes as null. Scanning
  for it found **83 such rows, all created 2026-08-18 → 2026-08-19** — **BAU101 82, MWD101 1** — with
  names like `U1`/`U3`/`Z2`, i.e. Schedule Builder push artefacts.
- ⚠️ **Invisible to every existing repair, by construction.** The heal fetches `.in('wbs_node_id', <this
  project's ids>)`, which matches neither a foreign node id nor a NULL; `_wbsDedupeSummariesByCode` skips
  a blank code outright (`if (!k) return`). This is the same class as the 2026-08-17 cross-project
  incident, and it post-dates the `ownPid`/`ownNodes` pinning fix — so **the pinning did not close every
  path**. The builder push is the likeliest remaining writer, on the timestamps and the node names.
- **Deliberately NOT cleaned up.** Deleting rows is destructive, this environment cannot create the
  backup table the precedent requires, and 82 of the 83 sit in one project — it wants the owner's
  sign-off and its own pass.

⚠️ **Method notes.** Two `Runtime.evaluate` calls died at the 45s CDP cap — **my own long polling loops**,
not a frozen renderer; both times the aborted eval left the page's fetch context broken
(`Failed to execute 'forEach' on 'Headers': The provided callback is no longer runnable`), which reads
exactly like a data error and is fixed by a reload. Poll in short separate calls, and **run queries from
`projects.html`, not the ~1.2 MB module page**. One query also failed on a column I guessed at
(`eng_design_progress.total` does not exist) — check the shape with `select('*')` first.

## The heal is now a BACKSTOP, not the mechanism — creators project their own rows (2026-08-24) — fmlozano
Owner, after the sweep fix landed: *"Check there are cases that this happens then the heal makes it
disappear. Let's track the root cause so that the heal becomes a backup not the main solution."* Right
call — the sweep was the acute bug, this is the structural one behind it.

**Audit 1 — every delete that touches `project_schedule`** (18 sites). Only ONE could ever take out a
projection, and it is the one already fixed: `syncProcurement`'s stale sweep, which scoped candidates
**by WBS node** and so pulled the trade nodes' own summary rows into the sweep.
- `syncDesignDevelopment`'s sweep scopes by `.like('activity_id','DD-%')` — a projection has no
  `activity_id`, so it can never match. **Safe.**
- The split-merge (`rest.map`), undo/redo, row delete, bulk delete, Clear and the two import-replace
  paths are all deliberate, confirmed, user-initiated. **Safe.**
- `_wbsDedupeSummariesByCode` and the heal's own `dupIds` pass delete only *duplicate* rows, and the
  former already refuses a group whose rows are backed by **different** nodes (two real branches whose
  dotted codes merely collided). **Safe.** ⚠️ One residual noted, not changed: a group where **no** row
  carries a `wbs_node_id` scores `distinct === 0` and passes that guard. Import-generated codes are
  unique per branch so it should be unreachable, but it is the one path that could delete an unlinked
  row that was not a duplicate.

**Audit 2 — every `wbs_nodes` creator, and whether it projects its own summary row.** This is where the
root cause actually lives. Six of nine already projected (`_seedSkeleton`, `wbsAddChild`, `wbsQuickAdd`,
copy-from-project, the bulk `_wbsInsertNodes`/`_insertWbsSummaries` pair, and the builder push);
`wbsAdopt` links pre-existing legacy rows so it has nothing to project. **Three did not** —
`_prcEnsureNode`, `_ddEnsureNode` and `_wbsBackfillSkeleton`, whose comment said so outright:
*"Summary-row projection is left to `_wbsEnsureSummaries()`."*
- ⚠️⚠️ **That made the heal load-bearing, and the heal has SIX bail paths:** the `_ensuringSummaries`
  re-entrancy guard, `!WBS_NODES.length`, a failed existence read (`if (eq.error) return 0`), two
  `switched()` project-switch returns, and an insert error that `break`s the loop. **Hit any one and
  the just-created trade nodes are left unprojected — no heading, children render flat, the first child
  is mistaken for the heading.** That is the reported symptom reached with no sweep involved at all.
- ⚠️ The re-entrancy path is not theoretical: **`syncProcurementApp` (the Sync button) calls
  `syncProcurement` directly**, so a sync fired while a `load()` is still inside `_wbsEnsureSummaries`
  gets `return 0` from the nested call and creates nodes with no rows.
- **Fix: `_ensureNodeSummary(node)`** — idempotent projection at creation, wired into all three. Both
  mirror creators call it on **every** return path, adoption included: an adopted node is precisely the
  one whose heading may already be missing on live data, so returning it unprojected re-creates the bug.
- ⚠️ **Idempotent in two stages, and the order matters for cost.** The in-memory `rows` check
  short-circuits with **zero round-trips** on a healthy project (asserted), so the common case is free;
  the targeted read behind it covers `rows` being stale against the server (a second tab, a mid-reload
  storm) where a blind insert would duplicate the heading — the failure mode that once ran AVR101 to
  2,000+ duplicate rows. A failed read or a failed insert is **tolerated, never forced**: it falls back
  to the heal rather than risking a duplicate.
- ⚠️ **`computeWbsCodes()` is called per node.** O(tree) each, but the callers create ≤9 (procurement),
  2 (DD) or ≤8 (backfill) nodes, and only when one is genuinely missing. Any code drift afterwards is
  already `_wbsResyncCodes()`'s job, which runs before the dedupe on every load.
- ⚠️ **`_seedSkeleton` deliberately NOT changed** — it projects every node in one pass after inserting
  the whole tree, which is correct for the seed-from-empty path. Its child-insert line is a byte-for-byte
  twin of the backfill's; the patch anchors on indentation to tell them apart. **Do not "unify" them.**

**Verified by EXECUTING the shipped code**, sliced verbatim (`isWbs`, `_insertWbsSummary`,
`_ensureNodeSummary`), nothing under test reimplemented — `scratchpad/check-ensuresummary.js`, **18/18**:
zero round-trips when the row is already in memory; no duplicate when the server has it but `rows` is
stale; a correct projection when genuinely missing (type, node id, dotted code, name, and **landing in
`rows`** — without which the heal would insert a second one); no insert on a read error; no insert when
the project switches mid-read; the read-only / no-project / null-node guards; a tolerated insert failure;
and idempotency across two back-to-back calls. The sweep suite still passes 8/8. Parse clean;
**function-set diff vs HEAD: 0 lost, 1 added (`_ensureNodeSummary`).**
⚠️ One failure on the first run was **my harness, not the code** — `pid: o.pid == null ? 'OPW101' : o.pid`
turned the `pid: null` case back into a real project, so the guard looked broken.
⚠️ **Not verified signed-in.** `MODULE_V` → `20260822g` (+ `modules-grid.js`'s own `?v=`).

## ⚠️⚠️ Sync Procurement DELETED the trade headings it had just created (2026-08-24) — fmlozano
Owner: *"The trades are not showing properly in the procurement dashboard"*, then the decisive clue —
*"when re-syncing from procurement in the WBS it shows for a brief moment but disappears completely."*
That is not a rendering fault. `syncProcurement()` was deleting its own work, in the same function call.

- ⚠️ **ROOT CAUSE — the stale-row sweep swept the trade nodes' WBS-Summary rows.** `allPrcRows` is
  *every* row whose `wbs_node_id` sits in the procurement subtree, and a node's projected summary row
  is one of those. A projection carries **no `activity_id`**, so `wantIds[String(r.activity_id)]` was
  never true and every trade heading was classed stale and deleted — **immediately after the
  `_wbsEnsureSummaries()` call a few lines above had just created it.** Create, render, delete: the
  brief flash the owner saw, on every single sync.
- ⚠️ **The comment above the sweep explains how it got there, and it is worth reading before touching
  it again.** Design Development scopes its sweep with `.like('activity_id','DD-%')` — a projection can
  never match a prefix. The owner asked for procurement's Activity ID to be the **bare WP number**,
  which has no prefix, so this sweep was scoped **by WBS node** instead. That scoping is correct for
  finding departed packages and is exactly what pulled the projections into the candidate set.
- **Fix:** only a **mirrored activity** can be stale here. A projection is owned by its node, never by
  the mirror — `isWbs(r)` and a missing `activity_id` both exclude a row from the sweep. Checked
  `syncDesignDevelopment` for the same class: **safe**, for the prefix reason above.
- **This is the whole of the reported "corruption", and nothing was actually corrupt.** With no summary
  row a trade node renders no heading, so the 8 Electrical work packages rendered flat and the first of
  them (activity **79**) was mistaken for the "Electrical and Auxiliary Works System" heading. The rest
  looked like duplicates of it. Their repeated `In Progress`, their dashed BL Start/BL Finish and their
  shared `wbs 3.3.6` are all **by design** — the mirror only encodes "awarded", mirrored rows carry no
  baseline, and every package under one trade shares that trade's code.
- ⚠️ **Two earlier hypotheses were WRONG and were disproved by live data, not by reading.** (a) Duplicate
  `source_kind='procurement'` skeleton roots (the 2026-08-21 bug): OPW101 has **exactly one**, with all
  9 trades correctly parented. (b) The importer clashing with the sync: a replace-import does delete
  every summary row while `_clearWbsTree()` keeps the locked nodes, but `_wbsEnsureSummaries()`
  reprojects them correctly — the sync then deleted them again. **The import was never involved.**
- **Live audit of OPW101 that pinned it** (run from `projects.html`, which carries the same session —
  ⚠️ the ~1.2 MB module page freezes on a large row scan): 460 nodes, 451 WBS-Summary rows, **0 orphans,
  0 duplicates**, and `nodesMissingSummary: 9` — *exactly* the 9 `procurement_trade` nodes, with
  `missingPlainCount: 0`. ⚠️ The **Procurement root keeps its own summary row**, which corroborates the
  mechanism precisely: `prcNodeIds` holds the root's **children**, never the root itself.
- **Self-healing, no cleanup needed.** `_wbsEnsureSummaries()` runs on every `load()` and reprojects any
  node missing a row; with the sweep fixed, they now survive the sync that follows.
- **Verified by EXECUTING the shipped predicate** — the stale block and `isWbs` sliced verbatim out of
  index.html, nothing reimplemented (`scratchpad/check-prcstale.js`, **8/8**): projections survive with
  a null *and* a blank `activity_id`, wanted packages survive, a departed package is still swept, an
  emptied trade keeps its heading while losing its package, and projections are safe against an empty
  want set. ⚠️ It carries a **contrast assertion proving the pre-fix predicate DID sweep both summary
  rows**, so the suite fails against HEAD. Inline script parses (1 block, rc 0).
- ⚠️ **Not verified signed-in** — the next real Sync Procurement is the test: the 9 trade headings should
  appear and **stay**. `MODULE_V` → `20260822a` (and `modules-grid.js`'s own `?v=` bumped with it — that
  file *contains* MODULE_V, so a cached copy would go on serving the old token).

# Module: project-schedule

## Procurement trades kept re-mis-nesting on every reload — duplicate skeleton roots (2026-08-21) — fmlozano
User: *"The trades are not showing properly in the procurement dashboard."* Screenshot showed the
console printing a DIFFERENT `[ps] healed N mis-nested procurement node(s) back onto the skeleton
root` count on successive loads (18, then 17) instead of converging to 0 — the heal was never
finishing, so `syncProcurement`'s trade branches kept shifting parent.
- ⚠️ **`_wbsDedupeSkeletonPass` cannot merge two ROOT markers.** It keys duplicates by
  `(parent_id, name)`, but if two nodes both carry `source_kind === 'procurement'` (the root marker
  itself) under DIFFERENT parents — one from the original skeleton seed, one re-created by an
  earlier version of the resolver — they key differently and are invisible to it.
- With two root candidates present, `_skeletonRoot`'s tie-break (exact-kind match, then earliest
  `created_at`) can pick a **different** one across loads as `WBS_NODES`' ordering shifts (concurrent
  tabs, ongoing syncs) — so `_healSkeletonNesting` re-parents one root's children onto the OTHER root
  on one load, and the reverse on the next. That is the fluctuating heal count; it was never going
  to settle.
- **Fix: `_dedupeSkeletonRoots(kind)`**, run at the top of `_healSkeletonNesting` before
  `_skeletonRoot` is consulted. Merges every extra `source_kind === kind` node into the earliest one
  (re-parenting children, moving activities' `wbs_node_id`, dropping the duplicate's own WBS-Summary
  row before deleting it — the same lossless pattern `_wbsDedupeSkeletonPass` already uses), so there
  is exactly one root candidate left. `_healSkeletonNesting`'s existing per-child heal + the general
  dedupe pass then have a stable target and should converge to 0 on the next load.
- Verified: inline script parses (1 block, 0 fail). ⚠️ **Not verified signed-in** — needs a live
  reload of the affected project to confirm the heal count drops to 0 and the trade branches stop
  moving. `MODULE_V` → `20260821c` (dashboard.html + modules.html + modules-grid.js's own `?v=`).

## Finance's class code becomes first-class schedule data (2026-08-21) — fmlozano
Step A of the schedule → procurement packaging flow the owner set out: planner builds the schedule →
procurement derives work-package scope and target installation FROM it → procurement backtracks the
awarding date. Owner picked A first, and answered the granularity question with **"it varies per
package"** — which the class-code hierarchy turns out to answer exactly.

### Why the direction question ("do activities point at packages, or the reverse?") had no good answer
There are **two** links and they are different relationships. **Formation** (schedule → procurement,
once per package): procurement decides a package's scope and need-by from the schedule. **Consumption**
(activity → package, ongoing, many-to-one): each activity records which package supplies it, which is
what drives the need-by push and the alignment report. The 2026-08-20 work built the second; the second
**presupposes** the first, which is why picking a package felt backwards — the packages don't exist yet.
- ⚠️ **But the real blocker was neither direction: there was no shared key.** Verified before designing:
  `project_schedule` had **no** cost/class code column; the Schedule Builder **had** the class code
  (`cfg.catalog[].code`, seeded from a hardcoded 197-code subset) and `taskPayload` **discarded** it; and
  WPM's `work_packages.cost_code` is a free-text `<input>` with no library. Both apps nominally speak
  Finance's vocabulary and in practice shared nothing. You cannot decide which way a key points when
  there is no common term underneath it.

### The chart, and the two traps in it
Read the owner's `EPC. FIN. Class Code Mapping Template_1164.xlsx` (sheet "Excel Temp", header row 9).
**702 Level-3 codes / 205 Level-2 groups / 42 Level-1 divisions.** Migration
`migrations/2026-08-21-class-codes.sql` (**MUST BE RUN**) creates a `class_codes` master + seeds it, and
adds `project_schedule.class_code`.
- ⚠️⚠️ **DE-ZEROING THE CODE MERGES UNRELATED ITEMS.** The template also carries a de-zeroed column, and
  it is NOT unique — two real collisions:
  `015051` General Requirement › Support Equipment › **Earthmoving** vs `15051` Metal Works › Railings ›
  **Railings**; and `017151` Gen Req › Bonds/Permits › **Misc. LGU and Estate Tax** vs `17151` Aluminum
  Glass › **Aluminum Swing Windows**. The **padded** Level 3 is the key (702 distinct of 704 rows).
  A de-zeroing "tidy-up" silently merges two unrelated cost codes, and because the merge looks like a
  successful match nothing errors. It is also why the code must be **picked, never typed** — both
  columns and both pickers are enums for this reason.
- ⚠️ **LEVELS ARE STORED, NOT PARSED.** `code_l1` is not reliably the code's first two characters —
  5 chart rows break it (the unpadded `1102x` rows sit under division `01`, `NOBDT` under `61`).
  Slicing the string to get a division mis-files them. Grouping resolves through the chart instead,
  which is also what makes granularity a **selectable level**.
- Two source rows dropped as duplicates of the padded code: `51000` (exact repeat) and a placeholder
  `NOBDT` under a non-numeric division `NO` (the real `61 / No Budget` row is kept). Deterministic:
  on a duplicate the numeric-division row wins.
- ⚠️ **Org-wide, not per project.** The template's header block has a "Project Name" field, but the
  chart is Finance's standard — 702 rows × 20 projects of identical data would be pure duplication.
  Loaded once per session, so a project switch does not refetch it.
- ⚠️ **No FK from `project_schedule.class_code`.** An imported P6/OPC schedule can carry a code that
  predates a template revision; rejecting the import (or nulling the value) is worse than holding a
  code that does not resolve — an unresolved code is a visible data-quality signal, and it renders
  flagged rather than blank everywhere.
- ⚠️ Named `class_code`, **not** `cost_code`: this module already has `cost_accounts` +
  `cost_account_id`, which are the internal CBS and a different concept. It joins to WPM's `cost_code`;
  the differing names are documented on both sides rather than risking a local confusion.

### What it gives the schedule
Grid column (editable as an enum, roll-up on summary/group rows stating the code only when **every**
activity beneath agrees, "Mixed (n)" otherwise), the field in the Add/Edit modal and the General tab,
search matching the code **and all three description levels** ("rebar" finds it, `015051` finds it),
a Global Change field with a datalist, and the builder push carrying it.
- **Three grouping dimensions — Division / Group / Item** (`cc1` / `cc2` / `cc3`), which cross freely
  with the location levels. **This is the owner's "it varies per package" answer**: a candidate package
  can be grouped at whichever level that package is actually bought at, instead of a rule baked into a
  query. Offered only once the chart is loaded, and they filter uncoded rows like every other
  `dimNeedsValue` dimension (toggleable, with the footer count).
- ⚠️ **Keyset-paginated by `code`, NOT via `PDb.selectAll`** — the shared helper paginates by `id` and
  this table's PK *is* the code, so it would throw. A plain select would serve today's 702 rows, but
  PostgREST caps a read at 1000 with no error, which is the bug class this repo keeps rediscovering.

### ⚠️ COLLISION WITH A CONCURRENT SESSION — needs a decision
While this was being built, another session solved the same problem differently: `classCodesOf()` in
the builder writes the class code into `project_schedule.activity_codes` as a **P6-style Activity Code**
under a per-project code type named "Class Code", creating the type and values on the fly. Both are now
in the file. Theirs needs no migration and reuses the existing `code:<id>` grouping; but it is
**per-project** (the same Finance code becomes a different uuid in every project, so nothing joins
across projects or to WPM), **flat** (no Division/Group, so the granularity answer is unreachable),
seeded from the **197-code subset** rather than the 702-code chart, and reaches **builder pushes only**
— not imports or manual entry. `taskPayload` now writes **both**, which is two representations of one
fact and exactly the drift this file's notes keep warning about. **Recommendation: keep the column +
chart as canonical and retire the activity-code mirror** — but it is the other author's work and the
owner's call, so nothing of theirs was removed.

### Verified
**53 checks green** by slicing the shipped helpers out of index.html and executing them (nothing under
test stubbed): both collision pairs staying distinct, the never-silently-wipe-a-code invariant incl.
against an empty chart, escaping, the roll-up refusing to fake agreement when a code is unresolved,
**one `c-ccode` cell on every row kind** (the column-alignment invariant this module has been bitten by
repeatedly), and all three grouping levels. Migration structurally checked (702 tuples, balanced,
policies dropped before create, re-runnable). Inline script parses; **function-set diff vs HEAD: 0
lost, 14 added.**
⚠️ **Not verified signed-in**, and the migration is not run — until it is, the field and the grouping
levels simply offer nothing and the form says which file to run.

## Minutes of Meeting REMOVED — it moved to Issues & Concerns (2026-08-20) — fmlozano

Owner: *"There is a minutes of the meeting within the project schedule module. Let's move this
out and connect it to issues and concerns module."* The whole C4 feature is gone from this
module and now lives in `modules/issues-lessons/` as a third screen. Nothing was rewritten —
the renderer, the raise-into-the-register flow and every ⚠️ decision comment moved with it.

**Removed here:** the `mom` entry in the title switcher, `#ps-view-mom`, the eleven `.ps-mom-*`
CSS rules, the nine functions (`loadMoms`, `momItemsOf`, `momIssue`, `renderMomView`,
`momDetailHTML`, `momSaveHeader`, `momSaveItem`, `momRaiseIssue`, `wireMom`), the `switchTab`
branches and the per-project reset of `MOMS`/`MOM_ITEMS`/`MOM_ISSUES`. 244 lines of script.

- **No migration.** `meeting_minutes` / `mom_items` are unchanged and every existing minute,
  action item and issue link is intact — only the screen that edits them changed address.
- `meeting_minutes.schedule_activity_id` stays, so minutes still point at an activity in THIS
  schedule; the register resolves it by a server-side search rather than by holding the schedule.
- **Verified:** the removal is exactly the nine functions and nothing else — the
  `function NAME(` set diffed against the pre-change file shows **9 removed, 0 added** (the
  standing check for the region-replace failure mode that blanked the Gantt twice), inline
  script parses, and **0** references to `ps-mom` / `ps-view-mom` / `MOM_*` remain.
- ⚠️ `MODULE_V` → `20260820a`: a module `index.html` changed, so the cached copy must not survive.

<!-- Merge seam (2026-08-21): entries below landed on `main` while the Minutes-of-Meeting removal was in progress. Both sides kept whole and unreworded. -->

## Activities are LINKED to procurement work packages, and the schedule pushes its need-by back (2026-08-20) — fmlozano
Owner: *"The activities should have a connection for which procurement work package it's connected to.
Currently there is a work package field per field."* Then, mid-build: *"The need-by will be the
installation date field in the prc app."*

### What was already there, and what was decorative
The app-to-app pipe has existed since 2026-07-14 and is sound: `sync-wpm` reads the WPM app's
`work_packages` with its **service-role key server-side** and upserts the columns we need into the
`wpm_work_packages` mirror, which the browser then reads under normal RLS. The WPM anon key ships in
that app's client JS, so a browser read there would expose every package's cost — that rule is why
the mirror exists, and this work keeps it.

⚠️ **`project_schedule.work_package` was the one part that pointed at nothing.** Plain `text`,
hand-typed in the modal and the General tab, read by the `'wp'` grouping dimension, search, row copy
and Global Change — with **no validation and no relationship to WPM whatsoever**. And it was not
merely unvalidated, it was **unusable**: WPM strips the prefix from its numbers
(`UPDATE_wpno_strip_prefix.sql`), so the values are bare ordinals — `'1'`, `'12'`, `'147'`. Nobody
types those correctly from memory. Confirmed the OPC/XER importers never map the column either, so
every value in it was hand-entered here.

### The link
Owner chose to **repurpose the existing column** rather than add one, so there is no migration on the
Planners side and grouping / filter / search / Global Change keep working on the same field.
- **`loadWpmWorkPackages()`** loads the mirror into `WPM_WPS`, sorted by the owner's trade order then
  WP number, tolerant of an un-run mirror migration exactly like `PACKAGES` / `LOC_LEVELS`.
  ⚠️ **Budget columns are deliberately NOT selected.** The mirror carries `approved_budget_bcb` /
  `awarded_cost` / `total_awarded` and an approved user *can* read them — but the schedule has no
  business holding procurement money in memory where a picker, a report or an Excel export could leak
  it into a schedule view. **Cash Flow is where procurement cost is reported** (ROADMAP E1 drew that
  line).
- **`wpOf` / `wpByNo` / `wpLabel` / `wpIsUnlinked` / `wpOptsHTML`**, with `_wpIndex()` memoised on
  `WPM_WPS`'s **identity** — a per-call scan would run once per grid row per render on a 17k-activity
  schedule, and the identity check means a reassignment (a re-sync) drops the cache by itself.
- ⚠️ **An unresolved value is shown as UNLINKED, never blanked.** Legacy hand-typed text predates the
  picker and is a data-quality signal a planner must see; and a package really can leave the WPM
  project, which must read as "this link is broken" rather than "this was never linked".
  `wpOptsHTML` therefore keeps the current value as a flagged option even when it resolves to
  nothing — **a `<select>` whose value is absent from its option list reads back as `''`**, so
  without that, opening a form on a legacy value and changing an unrelated field would silently wipe
  the link. Asserted, including with an empty mirror.
- ⚠️ **`wpOptsHTML` sorts its own optgroups.** The loader sorts too, but taking the trade order from
  first-appearance made the function silently order-dependent on its caller — a picker whose headings
  are in procurement order only by luck. Caught by a test that passed the packages in mirror order.
- The picker is a `<select>` populated per open, following the **Calendar field's** existing
  precedent; the detail panel uses the standard `ps-gedit` / `data-t="select"` wiring, so it persists
  through the same path every other field does. Grouping labels resolve through the mirror at read
  time (renaming a package in WPM re-labels the group on the next sync instead of leaving a stale
  caption), and search matches `wpLabel` so "steel" finds the activities fed by the steel package —
  searching the raw column never could.
- **Filter panel** gains a work-package select with two data-quality scopes — *not linked* and
  *linked to a package the Procurement app does not have* — the two questions asked after a sync.
- **Global Change** gets a `<datalist>`, not a select: its text operators (contains / is not) are
  legitimate there, so the input stays free-form while showing which numbers exist.
- **The mirrored Procurement branch now links to its own package** (`work_package: wp_no` in
  `syncProcurement`'s patch). ⚠️ `patchFields` had to gain `work_package` as well — the diff loop
  compares `ex[f]`, and an unselected column reads `undefined`, so every sync would have issued a
  pointless UPDATE for every package.

### Need-by = TARGET INSTALLATION
Per the owner. `wpNeedByIndex()` takes the **earliest start among a package's linked activities** —
the day work that consumes it begins.
- ⚠️ **WBS-Summary rows are excluded.** They are projections of their children, so counting them
  would double-count and, worse, a rolled-up summary start could pull the need-by *earlier* than any
  real activity needs it — telling a buyer to expedite for no reason.
- ⚠️ `linked` and `dated` are counted separately, so a package whose activities are all undated reads
  as "linked, no date" instead of as unlinked.
- **Health checks** (`computeHealth`): *Procurement Behind Need-by* (the package installs after the
  activity starts), *Work Package Has No Install Date*, *Stale Work-Package Link*. Every denominator
  is the **linked** set, not `tasks` — a project that links nothing scores exactly as before, so this
  cannot quietly punish a schedule that has not adopted the link.
- **Procurement Alignment report**: WP, trade, need-by, driver activity, target installation, slip,
  verdict, award + procurement status, worst slip first. ⚠️ **Packages with NO linked activity are
  listed too**, with a blank need-by — dropping them would make an unlinked schedule look perfectly
  aligned, the most dangerous possible reading. No cost columns.

### The write-back (Planners → WPM)
New Edge Function **`supabase/functions/push-need-by`** (deploy it; it reuses `sync-wpm`'s existing
secrets, so there is nothing new to set) writing a new **`planners_need_by`** table in the WPM project
(`wpm/MIGRATION_planners_need_by.sql` — **must be run**).
- ⚠️ **It does NOT write `work_packages.target_installation`.** That field is procurement-owned — a
  buyer types it and Saves it in `wp-form.html`. One app silently overwriting another team's
  authoritative dates is unrecoverable and unauditable, and there would be no way to tell a buyer's
  date from a robot's. **The schedule proposes; the buyer adopts** with a one-click *Use this date*
  that only fills the input. Same reasoning that makes the Planners app mirror WPM rather than read it
  live.
- ⚠️ **Keyset-paginated.** A plain select caps at 1000 rows, so a 17k-activity schedule would push
  need-by dates computed from the first 1000 — silently too late for everything else.
- ⚠️ **It PRUNES**, unlike the `wpm_work_packages` mirror (which only upserts, so a deleted package
  lives in it forever). A stale need-by is worse than a stale package row: it tells a buyer to
  expedite work that is no longer linked. But **a push computing zero rows does not wipe the table** —
  zero is indistinguishable from a mis-mapped project id, the same rule `syncProcurement` follows.
- ⚠️ The function's own reduce is a **second implementation of the need-by rule**, so a harness runs
  it and `wpNeedByIndex` over the same activities and requires them to agree — otherwise the
  Procurement app and the alignment report could report different dates for the same package.
- The data date lives in **localStorage**, not the DB, so the client passes it; the button is separate
  from *Sync Procurement* because a read-only refresh must never also write into another team's
  database as a side effect, and it confirms first.

### Verified
33 checks by extracting the shipped helpers and running them against stubs (resolution, the
never-wipe-a-link invariant, optgroup order, escaping, the need-by reduce, and the slip sign
convention read out of WPM's own `_needSlip`), plus 13 more proving `push-need-by`'s reduce agrees
with `wpNeedByIndex` on every case incl. padded keys, undated activities, actual-beats-planned and a
legacy free-text link. All four modified files parse.
⚠️ **Not verified signed-in**, and neither migration is run nor the function deployed — so the
Procurement panel and the push both report what to run until then. `MODULE_V` → `20260820a`.

## Towers: a WBS level, a location tag, and a stacking filter (2026-08-20) — eprobles

Multi-tower projects pushed five towers' floors into **one** flat floor list, because
`tower` existed only inside the Schedule Builder's `cfg`. Nothing downstream knew about
it. Two separate gaps, both worth naming:

**1. The WBS had no tower level.** Fixed by making `tower` a first-class entry in
`WBS_DIMS`, so it slots into the user-orderable `wbsOrder` like every other level
(default `trade > tower > floor > zone > unit`).

⚠️ **The level is skipped when there is only one tower.** `dimKey('tower')` returns the
"no value" sentinel unless `multiTower()`, so `buildTree` treats it as transparent and a
single-tower project keeps a **byte-identical** tree. Every existing project is
single-tower; a redundant "Tower 1" node above every floor would have been a regression
for all of them. `normalize()` also back-fills `tower` into an order saved before towers
existed — dropping an unknown dimension silently is how the level would have gone missing
again.

⚠️ **The sentinel is the escape `\u0000`, not a space.** A terminal renders it as blank,
and I mis-read it as a space on the first attempt — the patch anchor did not match and
applied nothing. Worse, this turned out to be a **live bug**: `dimKey`'s own `floor`
branch returned a literal space for an `_all` floor, which never equalled `buildTree`'s
`\u0000`. So a trade with no floors did *not* skip the level as the comment claimed; it
got a node, and `dimName` has no name for an `_all` floor, so it fell back to the level
label — a WBS branch literally called **"Floor"**. Both now use the same sentinel. When a
sentinel is produced in one function and compared in another, assert they are the same
value; do not eyeball it.

**2. A pushed activity did not record its tower at all.** `locMapOf` writes only
floor/zone/unit into the Location Breakdown levels, so Project Schedule could not tell a
Tower A activity from a Tower B one. The tower now goes into the location map under the
reserved key `'tower'`. Level ids are UUIDs, so it cannot collide, and the only code
reading that map generically is the search haystack (where "Tower B" finding its
activities is a feature). Deliberately **not** a new `LOC_LEVELS` row: that is per-project
DB data, and inserting a level at the top would renumber every existing project's levels.

Note the pre-existing ambiguity this exposed: "tower" in the Vertical Stacking view meant
"one building model card", which is not a project tower. The new `_vsTowerOf` /
`_vsTowersIn` / `_vsTowerColor` are named for the real thing, and the tower filter is
applied **before** trades are collected, so focusing Tower B lists the trades actually in
Tower B. Untagged rows get an explicit "— No tower —" band rather than disappearing —
same rule as the "No level" band.

Verified by extracting the shipped source text of `dimKey`/`dimName`/`buildTree` and
`locMapOf` and running them against synthetic configs, rather than paraphrasing the logic
into a test that could agree with a wrong assumption.

### Open-start activities did not follow the data date (2026-08-20)

Data date 01-Jul-26, every activity still starting 24-Aug-26. The shift existed but was
**one-directional** — `shiftUnstartedToDataDate` pulled un-started work forward out of the past and
bailed on everything else (`if (!s || s >= dd) return;`). So a data date *behind* the planned start
left open-start work stranded in the future, with nothing to bring it back. In this case 24-Aug was
the Schedule Builder's project start, carried in by the push.

The correct rule was **already in the same function**, applied only to no-predecessor *milestones*,
which "ride the data date (either direction)". That is not a milestone property — no predecessor
means the data date is the only thing driving the activity, whether it is a zero-duration marker or
six days of works. Generalised rather than duplicated, and the milestone case falls out of it as the
zero-duration instance. Activities that genuinely belong later say so with a predecessor or a date
constraint; that is what those are for.

⚠️ `cpmLogic`'s open-start anchor (`es = A(t.start_date)`) has arguably the same defect and was left
alone **deliberately**. It feeds float and criticality for every project, so re-anchoring every
unlinked activity to the data date there would silently redraw critical paths across the board. The
behaviour change stays in the function whose documented job is writing dates. Worth revisiting as
its own change, with its own verification, if the float numbers ever look wrong.

Both gates (`ps_useactuals`, `ps_ddretain`) default to on, so no new setting was needed.

### Follow-ups the same day: the builder's own stacking, and floor order vs the WBS manager

**Step 6 merged the towers.** `stackTowerSVG` read `cfg.zoning[tr].floors` — every tower's floors —
so a five-tower project drew one model per trade containing all five buildings stacked in one
column: floor codes repeating, the grade line in the wrong place, dates from unrelated buildings
side by side. This is the *same shape* as the step-5 `towerSVG` leak fixed a few commits earlier;
that fix made `towerId` a **required** parameter precisely so a call site cannot silently draw the
wrong building, and `stackTowerSVG` never got the same treatment. It now takes a required `towerId`
and the step renders one card per (tower × trade), tower-major, with tower chips.

**The stack's floor order disagreed with the WBS manager**, which the owner spotted by putting the
two views side by side: the WBS read `Lower Ground · Ground Floor · Upper Ground Floor · Level 1`,
the stack drew `Lower Ground · Level 1 · Upper Ground Floor · Ground Floor`. Two defects in
`levelRank`:

- `"Lower Ground"` matched **no** rule and returned `null`. Unrankable values sort last in build
  order, and the display **reverses** that list — so the lowest floor in the building rendered at
  the very top. An unrankable value is not a neutral outcome here; it is actively misplaced.
- `"Upper Ground Floor"` matched the plain `ground floor` rule and collided with the real Ground
  Floor at rank `0`. `lgf` and `ugf` were both listed in that same rule, so the abbreviations were
  wrong too.

Fixed by ranking the ground family before the plain rule (`lower ground`/`lg`/`lgf` → `-0.5`,
`upper ground`/`ugf` → `0.4`). But the deeper fix is the second layer: **the WBS tree is now the
ordering authority.** A name heuristic can only rank names it was taught, and floor names are
arbitrary ("Transfer Plate", "BOH Podium"). The WBS manager already holds the planner's own stated
order as `sort_order`, and it is the view the owner compares against — so `_vsOrderLevels` sorts by
tree position when the tree resolves **every** level and actually distinguishes them, and falls back
to the heuristic otherwise. A partial answer is refused deliberately: mixing tree positions with
heuristic ranks in one comparator yields an order matching neither view.

⚠️ The grade line stays a **physical** question answered by `levelRank`, never by tree position —
`sort_order` says what comes first, not what is underground. Under tree ordering it is the run of
below-grade levels at the *bottom* of that order, so the line cannot cut through the middle of a
tree-ordered stack.

## The Schedule-Builder → Project-Schedule pipeline, and the WBS code that was secretly the tree (2026-08-19) — eprobles

One long session, thirteen commits. Almost every defect in it — including two I caused
myself — came from the same shape: **the same fact derived independently in several
places, then drifting apart.** Recording that here because the individual fixes are
small and the pattern is the useful part.

### ⚠️⚠️ The root cause of "only Allied Services was migrated" — and my earlier entry got it wrong

The entry below (2026-08-18) concluded the drop was correct behaviour and only added a
warning. Then a second cause was found and fixed (`normActivity` mirrored durInt/durExt
but guarded on `!= null`, while every row-creating path seeded `durExt: 0`, so the mirror
never fired — real, but still not it). The actual cause was the **WBS code**:

```js
codeOf[n.id] = (n.code_custom && n.code) ? n.code : auto;   // parent path DISCARDED
```

A dotted WBS code is not a label. `rebuild()` derives ancestry by splitting it
(`r._segs = segs(r.wbs)` → `r._anc`), so **the code IS the tree**. The builder gave each
floor branch a readable custom code from its step-2 floor code ("ST-F1", "AR-F11"), and a
custom code replaced the parent path outright — so those branches came out with no dot in
them, i.e. as TOP-LEVEL branches, taking their whole subtree with them. On One Portwood
Residences **2560 of 2561 activities were severed from Execution Phase**; every trade
branch rolled up to nothing and displayed "—". The lone survivor was Allied Services,
whose floors carried no code, so it kept an auto dotted code and stayed attached.

Nothing was ever dropped from the push. The rows were detached.

Fixing that spawned two regressions of my own, both worth reading before touching this area:

* **A feedback loop.** Making the custom code NEST meant stripping dots out of it — and
  `_wbsCommit()` writes the computed code back into `wbs_nodes.code` for every node without
  checking `code_custom`. Harmless while the code was returned verbatim (identity write);
  the moment it became `parentPath + '.' + code`, each commit baked another layer in:
  `"AR-F11"` → `"4.5.AR-F11"` → `"4.4.4-5-AR-F11"`. Twelve orphaned codes on the owner's
  project. Fixed by `ownCodeSeg()` (heals on read; strips a leading run of purely NUMERIC
  segments only, so a deliberate `01.100` is left alone) plus never stamping a path onto a
  custom node's code.
* **Parent sorted below its own child.** Seeding `_seqByCode` from the WBS tree gave every
  branch code an entry, which made the sort's manual-order lookup fire in a case it had
  never reached: when one row has RUN OUT of segments it is an ANCESTOR of the other
  (`"1.3"` vs `"1.3.ST-B3"`), so it compared Structural Works' sort_order against B3's and
  returned the parent last. Fixed by consulting `_seqByCode` only when BOTH rows still have
  a segment at the divergence index — i.e. only between genuine siblings.

**The rule that ends this whole class:** the owner settled it — *"the WBS ID should not be
dependent on the names defined in step 2 … they are just guide."* `dimCode()` now returns
null and every ID is auto-numbered from tree position. Numeric segments cannot detach,
have nothing to write back, and sort naturally. Step-2 names still NAME the branch; only
the ID is structural. A re-push clears stale name-derived codes off reused branches.

### Branch order was decided by whichever row happened to carry a seq_order

Reported as "it is all jumbled": Ground Floor → 11TH → 12TH → 14TH → RD → Upper RD → 2ND,
i.e. `F1, F10, F11, F12, F13, F14, F2` — an ASCII sort, with the Roof Deck mid-tower.

`_seqByCode` was built ONLY from rows carrying a seq_order, and the push writes seq_order
on activities but not on the summary rows it creates. So a branch got an entry only when an
activity sat DIRECTLY under it — basements (unzoned) ordered correctly, floors (zoned, so
their activities live a level deeper) fell through to text comparison. One schedule, two
orderings, decided by whether a floor happened to be zoned. `wbs_nodes.sort_order` is the
authority and now seeds it. The push also re-asserts sort_order on REUSED branches, which it
previously threw away — so a branch kept its first-ever position forever and no re-push
could fix it.

### One function per fact

* `workOf(r)` — the row's own `work_type`, else the WBS branch directly under the phase
  root. Grouping/column/search/roll-up/formatting/diagnostic all read it. Fixes the report
  that a trade WBS with activities directly under it (no sub-WBS, no location) lost its
  trade: `dimNeedsValue('work')` DISSOLVES a valueless row, lifting it out of the Trade
  level and re-grouping it by Activity — so "Elevators" appeared to BE a trade. Narrow on
  purpose: the fallback applies only under a phase root, so an arbitrary WBS
  ("Project › Area") invents nothing. Label unified to **"Trade"**.
* `phaseOf` / `phaseFromName` — the phase column was seeded ONCE, by the 2026-08-12
  migration, BY BRANCH NAME. Every branch created since carries null, so activities under a
  root literally called "Execution Phase" resolved to no phase — the "—" in the Phase field,
  which cascaded into Contract Scope reading "n/a". The migration's own rule now runs at read
  time. A stored phase still wins.
* `scopeOf` — an EXPLICIT tag always displays; only the DEFAULT is gated on the execution
  phase. The builder states `phase:'construction'` + `scope_type:'main'` outright on every
  row it writes.
* `_phaseMemo` is cleared in `rebuild()` — it answers a question about the TREE (stored
  phase, name, ancestry) and all three change without touching the phase editor.

### Also landed

Contract scope (Main Contract / Change Order) with CO splice-linking; Constraint and
Constraint Date as grid columns; canonical trade order + **Site Development**; `.c-task` had
no width rule at all, so every column after it sat 13.9px right of its heading (measured
92/598 cell pairs misaligned → 0); square icon-only buttons were left-aligned because
`.pd-btn` sets no `justify-content`; step-4 durations and level types fork per floor
category; step-4 copy read the default instead of the selected level type; Ctrl+C/X/V
ignored a multi-row selection because every row click leaves a 1×1 cell rect behind, making
the row branch unreachable ("Cut 1 cell" with two rows selected). **Actions → Diagnose
data…** is a read-only report that names which of orphaned codes / missing codes / undated /
filtered-out / misfiled-vs-location is actually biting — it is what turned "2561 activities
but every branch shows —" into a one-line answer.

### ⚠️ The dissolve rule was investigated and deliberately LEFT ALONE

Tempting to "simplify" `dimNeedsValue` / `_dissolve` next. Measured first, across four
grouping orders on a mixed project (zoned trades + trades whose activities hang off the
branch):

* **no rows are lost** — 15/15 shown in every arrangement;
* **no depth mixes headings from different dimensions** any more; `workOf` removed that.

What remains is a location-less activity appearing beside Level headings instead of under a
placeholder — which is dissolve doing exactly what the owner asked for
(*"if there are activities under an unassigned WBS, dissolve it and reorganise the
activities to the parent"*). Changing it would reintroduce the "— Unassigned —" buckets that
request removed. Left as is by decision, not by omission.

### Verification

No signed-in run (the module redirects), so everything was checked by booting the module's
own code in an iframe with the shared APIs stubbed — including through its real `init()` for
the keyboard work — and asserting on the sorted model rather than rendered rows, because the
grid virtualizes and a first attempt read false negatives off it. Roughly 120 assertions
across the session, plus pre-fix/post-fix comparisons run side by side from `git show` for
the WBS-code, ordering, alignment and button fixes.

⚠️ **Still unverified against live data:** every Supabase write. In particular
`migrations/2026-08-19-schedule-contract-scope.sql` MUST be run — until it is, `scope_type`
does not exist and every Scope write fails with *"Could not find the 'scope_type' column …
in the schema cache"*, while the column still DISPLAYS a computed default, which makes it
look half-working.


## Design Development is sourced from the ENGINEERING APP, via a roll-up mirror (2026-08-19) — fmlozano
User: *"The planning-app's engineering drawing register should be fully migrated to the engineering
app… All data should be sourced from the engineering app."*

`syncDesignDevelopment()` read **this project's own** `drawing_register` / `material_submittal` —
the pre-cutover originals. The registers are authoritative in the Engineering App now, so the WBS
branch was mirroring a stale twin of the register the engineering team actually works in.

- **New mirror `eng_design_progress`** (`migrations/2026-08-19-eng-design-progress-mirror.sql`) fed by
  a new Edge Function **`supabase/functions/sync-eng`**, same security model as `sync-wpm`: the
  Engineering service key is an Edge Function secret, never in the browser (its anon key is public).
- ⚠️ **It mirrors the ROLL-UP, not the rows** — one row per (project, source, top level), a handful
  per project instead of 1,500+ drawings. Two deliberate divergences from the `wpm_work_packages`
  mirror, both of which are its documented weaknesses:
  - **It PRUNES.** That mirror only upserts, so a work package deleted upstream lives in it forever
    and keeps contributing to cash-out. `sync-eng` deletes a project's rows and re-inserts them, so
    pruning is structural rather than a step someone has to remember.
  - **Its RLS is PROJECT-SCOPED** (`can_access_project`), not merely `is_approved()`. The WPM mirror
    gates on approval alone because it carries no Planners project id; this one carries the real id,
    so there is no reason to let every approved user read every project's design progress.
- ⚠️ **The progress math now exists ONCE, upstream.** `_ddAggregate` / `_ddTopLevel` / `_ddSheetBased`
  / `_ddApprovedDr` / `_ddApprovedMs` / `_ddValidDate` are **deleted** from this file. The two bases
  are not interchangeable — Concept / Schematic / For Construction count 0-or-100 **tracking units**
  at equal weight, Individual Services Drawings counts **sheets** with partial credit — and a second
  implementation here was a second thing to keep in step with a register in another repo. The
  function's `aggregate.ts` is a **port of the register's own engine**, and a harness runs both over
  the same synthetic register and requires **identical** output (40 checks) — so a "tidy-up" there
  fails a test rather than silently changing what the schedule reports.
  - `DD_TOP_ORDER` stays: it is the **display order** (Concept → Schematic → For Construction →
    Individual Services, the sequence design actually runs in), not a fold.
  - The fold itself is applied upstream (migration 0017) and **again defensively** in `aggregate.ts`,
    where an unrecognised top level keeps its **raw name** rather than collapsing to "Unassigned" —
    a name is what makes it actionable.
- **Everything downstream is untouched**: the deterministic `DD-DWG-<slug>` / `DD-MAT-<slug>` ids,
  the fresh-from-DB insert-vs-update check, the stale-row sweep, the read-only gating, and the
  `end_date = latest planned` rule that stopped the zero-duration bars.
- ⚠️ **An empty mirror returns EARLY and leaves the branch exactly as it is.** Never synced (or a
  project with no design work) must not read as "zero", which would bulk-delete every activity in the
  branch. Same reasoning as the pre-existing `msOk` guard, which is kept: a source missing from the
  mirror is excluded from the stale sweep rather than treated as empty.
- **Sync Engineering** button in the WBS toolbar (`#ps-sync-eng`, gated on `canWrite`) invokes the
  function and re-runs the sync in place; a `synced <date>` readout beside it makes a stale roll-up
  visible instead of assumed current. A submittal read that failed upstream is **named in the toast**
  rather than passed off as a clean sync.
- **The twin modules are DISABLED** in `assets/js/config.js` (`enabled:false, retiredTo:`), not
  deleted, and the tables are **not dropped** — that is a separate, deliberate step. Audit first: the
  question is whether anything was edited in the local copies AFTER the cutover, and whether any row
  still holds an uploaded file (dropping the table orphans the storage object).
  - ⚠️ `dashboard.html` rendered every disabled module as **"In development"**, which is the opposite
    story for a retired one — a user would wait for something that already exists elsewhere. A module
    carrying `retiredTo` now reads **"Moved to …"**.
- ⚠️ **Fixed while working here: this file contained 6 raw NUL bytes** (`'\x00'` sentinels written as
  literal 0x00), which made it register as **binary** to `grep`/`diff` — the same trap the sibling
  app's notes record. Replaced with the `'\u0000'` escape; proven byte-equivalent by resolving the
  escape back and comparing. **Write `'\u0000'` in source, never paste the control character.**
- **Verified**: 40 port checks against the register's own engine, 12 fold checks, 29 checks over the
  repointed sync in the shipped source, migration idempotent on real Postgres 16 (two runs), page
  parses. ⚠️ **NOT verified end-to-end signed-in** — the function is not deployed and its secrets
  (`ENG_URL`, `ENG_SERVICE_KEY`) are not set, so no live sync has run.

## Contract scope (Main Contract / Change Order), constraint columns, and the REAL cause of "only Allied Services was pushed" (2026-08-19) — eprobles

Five things in one pass: two owner features, two owner-reported bugs, and one correction to a
previous entry in this file.

### 1. ⚠️⚠️ "Only Allied Services was migrated" — the 2026-08-18 entry above got the cause wrong

That entry concluded the drop was *correct behaviour* ("a 0-day activity shouldn't push") and fixed
it by adding a warning banner. The drop is real; the diagnosis of WHY those durations were zero is
not. The owner reported it again, so it was re-root-caused:

- `normActivity()` already MEANT to mirror one duration column onto the other:
  `var de = (a.durExt != null) ? … : (a.durInt != null ? di : legacy);`
- But every path that CREATES a step-1 row — the catalog import (`cfg.catalog.push`), the paste
  handler (`xlSetCell`'s row-extension) and "+ Add" — seeded `durExt: 0`.
- **`0` is not `null`.** The mirror never fired, the zero stood, and pushing "External" dropped every
  row born on those paths. Whichever trade happened to carry both numbers survived — which is why
  the survivor looked arbitrary, and why it was Allied Services on the owner's project.

So the planner had not "left a column blank": the app had silently written a 0 into it on their
behalf, and then dropped their work for containing it.

**Fix**, at the single choke point every caller (`effDur` / `pDur` / the push diagnostic) reads
through — plus the seeds, which now write `null`:

    function actDur(a, basis, kind) { … }   // a basis with no duration falls back to the OTHER column

An activity is now dropped only when it has no duration on *either* basis — the one case where
dropping it is right. The warning banner from the previous entry stays: it is still the correct
report for that genuinely-empty case.

### 2. Step 4: durations were shared across level types (owner-reported)

Step 4 already forked the *sequence* per level type (`actLinksKind`), but durations lived on the one
shared `cfg.activities` row — so typing a duration while "Typical" was selected changed Basement too.

Durations now fork by the same rule the links use: `cfg.activities` holds the DEFAULT every category
follows, and a category gets its own number only when the planner types one there
(`a.durKind[<kind>]`). Resolution is **per column**, so a category may specialise its Interior
duration and still inherit the default Exterior one.

⚠️ The fork is created EMPTY, not as a copy of the default. The first version copied the default into
both columns, which made the fork unclearable — blanking the cell you had typed left the other column
holding a copy of the default, which still counted as "this category has its own durations". Forking
empty means blanking the last number drops the fork, so "follow the default again" is just clearing
the cell. (Caught by the test below, not by reading it.)

Forked cells are marked (`.sbld-ownd`) with the default in their tooltip.

### 3. Step 4's level types were Basement/Typical no matter what step 2 said (owner-reported)

Root cause: **`normalize()` silently dropped `f.kind`.** Step 2 has a per-floor category selector
writing `f.kind`, but normalize rebuilds each floor field by field and never copied it — so
`floorKind()` always fell through to its legacy guess (`f.sub ? 'basement' : 'typical'`), and
`kindsInProject()` (which reads floorKind over the floors) could only ever return those two.

`kind` now survives normalisation, validated against `KIND_ORDER`. Also removed
`kindsInProject()`'s four-category fallback: offering Podium and Roof Deck on a project that has
neither is the other half of "step 4 has its own list". With no floors tagged, step 4 now shows only
the default and says where level types come from.

### 4. Constraint columns (owner: "a constraint type function, similar to the OPC features")

The constraint *engine* was already there and is genuinely OPC-grade — `fwdConstrain` /
`bwdConstrain` honour all 9 types on both CPM passes, including driving float negative when the
schedule is over-constrained. What was missing was reach: the fields were buried in the Add/Edit
modal, so setting them at scale was impractical.

Added **Constraint** and **Constraint Date** as real grid columns — sortable, filterable,
per-column-filterable, exportable, and editable in place. Constraint type uses a new `enum` inline
editor (a real `<select>`; a closed vocabulary must not be typed free-hand). Clearing the type clears
its date, and As Late As Possible takes no date at all, so a dangling constraint date the CPM would
ignore cannot exist. Both are fill-down / paste targets — setting one constraint across a run of
activities is exactly the bulk edit these columns are for.

### 5. Contract scope — Main Contract vs Change Order (owner)

New `scope_type` + `change_order_ref` on `project_schedule` and `wbs_nodes`
(`migrations/2026-08-19-schedule-contract-scope.sql`), inherited down the WBS the same way `phase`
is. **Execution phase only**, by request: outside it the column reads "—" and refuses the edit rather
than inviting a meaningless "is the design review a variation?" answer.

- **Grid**: a `Scope` column (MC / CO pill + the CO reference), a left rail on change-order rows, and
  a Mixed roll-up on summary rows — computed in the same pass as cost, so a branch's scope and its
  % / cost can never disagree.
- **Filter**: Blended (default) / Main contract only / Change orders only. Summary rows pass through
  so a filtered view keeps the headings that locate the surviving activities.
- **Add Activity**: a Contract Scope section high in the form (it decides how the row is reported,
  not a late detail), which appears and disappears as the chosen parent WBS changes phase.
- **Schedule Builder**: a `Contract` column in step 1, carried onto every pushed activity — a change
  order built here arrives already identified. ⚠️ The push tolerates a database without the
  migration: it drops the two fields and pushes everything else rather than failing wholesale.

**Linking — the design question the owner asked to have proposed.** Three options:

  (a) leave the CO dangling — rejected: an unlinked activity has no float, never reaches the critical
      path, and its delay effect is unprovable, which is the one thing a variation must demonstrate;
  (b) link it in parallel — right when the CO genuinely does not hold up main-contract work;
  (c) **splice it into the chain** — the CO takes over the predecessor, and everything that used to
      follow that predecessor now follows the CO.

(c) is the default offered, because it is the only arrangement where the CO's duration actually
pushes the downstream work. Adding a change order now offers the splice, naming exactly which
activities it will re-point; Cancel leaves it in parallel. Re-pointing preserves each edge's
relationship type and lag rather than flattening it to a default FS.

### Copy/paste & fill-down (owner asked whether it exists)

It already does, in the Schedule grid: Ctrl+C/X/V over a cell range or whole rows, Ctrl+D fill-down,
drag/Shift-click range select, type-to-edit, and a right-click "Fill down". No change needed beyond
teaching the three new columns to participate.

### Verified

Not signed in (the module redirects), so verification was done by booting the module's own code in an
iframe with the shared APIs stubbed — it evaluates top to bottom with **zero runtime errors** and
reaches its `requireLogin` boot call. On top of that, 42 assertions through `PS.fn` and the builder's
new `_t` test surface, all passing:

- scope inheritance (own tag > WBS branch > 'main'), CO-reference inheritance, non-execution-phase
  returning null, and the three filter modes;
- the splice re-pointer keeping type+lag, not matching an ID prefix (`A10` must not hit `A100`);
- the cross-basis fallback: External now pushes 3/3 rows where it pushed 0, with `missingTrades`
  empty;
- per-level-type durations: basement 12d / podium 4d / roof 4d out of `generate()`, one-column
  specialisation, no leakage between categories, and clearing a fork restoring the default;
- step-2 `kind` surviving normalize, and step 4 offering exactly `[basement, podium, roof]`;
- a full grid render: **26 header cells, 26 cells on every row** (the positional-drift invariant this
  file has been bitten by repeatedly), correct pills, tags, editability and the Mixed roll-up.

⚠️ Still unverified signed-in: the actual Supabase writes (the new columns need the migration run),
the Add-Activity scope section against a real WBS tree, and the splice prompt end to end.


## "Only Allied Services was pushed" — a zero-duration silent drop, now warned (2026-08-18) — eprobles
Owner: pushing from Schedule Builder pushed only Allied Services. Root-caused, not guessed.
- ⚠️ **`generate()` drops any activity whose duration is 0 for the CHOSEN BASIS.** Line ~14588:
  `var dur = effDur(a, basis, loc); if (dur <= 0) return;` — and `effDur → actDur` reads `durInt` on
  an Internal push, `durExt` on External. So a trade whose activities have no duration in the pushed
  column produces zero-length locations that are all skipped, and the trade vanishes from the push
  with **no message**. "Only Allied Services pushed" = only Allied's activities carry a duration for
  the basis that was pushed (either only Allied's durations were filled, or the others were filled in
  the OTHER of the Interior/Exterior columns).
- ⚠️ This is distinct from the already-fixed "trade with codes but no floors" case (line ~14573,
  which gives such a trade an un-located occurrence) — a zero-duration activity is dropped *after*
  that, per location.
- **Fix = make it visible, not silent** (the drop itself is correct — a 0-day activity shouldn't push):
  `generate()` now returns `missingTrades` (used trades that produced 0 rows) + `zeroDurByTrade`.
  The step-7 preview shows a per-basis warning banner in each `_genPanel` ("No Internal/External
  duration for: <trades> — these will NOT be pushed"), and the push completion summary adds the same
  warning naming the trades and the basis, telling the planner to enter durations or push the other
  basis.
- Verified: inline script parses (1 block, 0 fail); `missingTrades`/`zeroDurByTrade` wired through
  generate → preview → push summary. ⚠️ **Not verified signed-in** — needs a push with one trade's
  durations blank to see the banner. `MODULE_V` → `20260818l`.

## Schedule dialog: a PAST data date silently reverted to today (2026-08-18) — eprobles
Owner: can't set a data date before today (e.g. 14-Nov-2025) — it reverts to today.
- ⚠️ **Root cause was the radio UX, not a clamp.** The Schedule dialog (also opened by clicking the
  topbar Data Date badge) has two radios — "Use the current (system) date" (default when `dataDate`
  is null) and "Apply a specific data date" — plus an always-enabled date field. `scheduleNow()`
  reads the **radio**: if it's still on "system", it calls `setDataDate(null)` (= wall clock) no
  matter what's typed in the field. So a user who types a date without also clicking the "set" radio
  gets today. Nothing anywhere clamps the data date to ≥ today — a past date is fully allowed.
- **Fix:** editing the Data Date field now auto-selects the "Apply a specific data date" radio
  (`#ps-dd-date` `oninput` → checks `input[name="ps-dd"][value="set"]`), so typing/picking a date is
  honoured on Schedule Now. `setDataDate` persists it (`ps_datadate_<pid>`) and `loadDataDate`
  restores it, past dates included.
- Verified: inline script parses (1 block, 0 fail); wiring present; the date input carries no `min`
  so the browser allows past dates. ⚠️ Not verified signed-in. `MODULE_V` → `20260818k`.

## Schedule Builder push: floor WBS branch named by the floor NAME, coded uniquely (2026-08-18) — eprobles
Owner: when pushing to the schedule, use the floor NAMES as the WBS name but keep the WBS id unique
(e.g. WBS id `ST-F1` / Name `Ground Floor`). All in the grouped `pushToSchedule` tree builder.
- **`dimName('floor')` now prefers the floor's `name`** (falling back to its code), so the floor
  branch reads "Ground Floor" instead of "F1". Zone/unit unchanged (no name convention there).
- **New `dimCode(dim, r)`** gives a floor branch a **custom** WBS code `<TRADE>-<floorcode>`
  (e.g. `ST-F1`), threaded through `ensureNode` → the `wbs_nodes` insert as `code`/`code_custom:true`.
  `computeWbsCodes` already honours a custom code and **prefixes its subtree**, so a zone under it
  reads `ST-F1.1`, a unit `ST-F1.1.1`. Trade/zone/unit keep auto dotted codes. Unique by
  construction (trade prefix + floor code); a `_usedCode` guard de-dupes within a push if two floors
  ever share a code (→ `ST-F1-2`). Blank floor code → no custom code (auto dotted), never a bad code.
- ⚠️ **Re-push safety:** `dimAltName('floor')` now returns the floor's **code** (its old,
  pre-change branch name), so `existingChild(parentId, name) || existingChild(parentId, alt)` finds a
  branch pushed before this change (named "F1") and REUSES it instead of creating a duplicate
  "Ground Floor" beside it. (It keeps the existing node's name on reuse — a re-push doesn't rename in
  place; new/clean pushes get the new naming, which is the builder's common case.)
- ⚠️ The dotted-code **fallback** path (pre-migration / wbs-nodes insert failed) honours `nd.code`
  too — the floor row's `wbs` is `ST-F1`, its children `ST-F1.1`, name "Ground Floor".
- **Verified 13/13 in Node**: the SHIPPED `computeWbsCodes` sliced out and run over a
  trade→floor(custom)→zone→unit tree gives `ST-F1` / `ST-F1.1` / `ST-F1.1.1`, a second trade's
  "Ground Floor" is the distinct `AR-F1`, and the trade node keeps its auto dotted code; plus the
  reconstructed `dimName`/`dimCode` floor logic (name = floor name, name→code fallback, `ST-F1`
  format, non-floor/blank → null, and the dedupe → `ST-F1-2`). Inline script parses.
  ⚠️ **Not verified signed-in** (needs a real push). `MODULE_V` → `20260818k`.

## Schedule Builder step 7: "Total duration" was the SUM of durations, not the span (2026-08-18) — eprobles
Owner: Nov 14 '25 → Jul 22 '28 can't be 12,820 days. Correct — the Generate/preview KPI
(`_genPanel` → `g.totalDays`) read `rows.reduce((t,r)=>t+r.dur,0)`, i.e. **every activity's duration
summed**. In a takt schedule zones/trades overlap heavily, so that number (Internal 10,100 / External
12,820) is meaningless as a project duration and contradicts the Start/Finish shown beside it.
- **Fix (`generate()`, line ~14596):** `totalDays` now returns `total` — the schedule span already
  computed as `max(start-offset + days)` across all locations, the same value that drives
  `finish = addD(start, total-1)`. So `totalDays === dayDiff(start, finish) + 1` by construction and
  the KPI can no longer disagree with the Finish date. External span is ~982 d, internal ~800 d
  (matching GR·F1's 960 d / 800 d being the longest chains), not 12,820 / 10,100.
- ⚠️ **Left alone:** the step-4 per-trade "Total duration — Internal/External" (`tradeTotalDays`,
  line ~15015) is a *single trade's* own FS-chain length — a different, legitimate metric, not the
  project span. Not touched.
- Verified: the calendar span Nov 14 '25 → Jul 22 '28 inclusive = 982 d (Jan 22 '28 = 800 d) in Node;
  the invariant `totalDays = finish − start + 1` holds by construction; inline script parses (1 block,
  0 fail). ⚠️ Not verified signed-in. `MODULE_V` → `20260818j`.

## Grid cell copy/paste of DATES was broken — two root causes (2026-08-18) — eprobles
Owner: *"In the project schedule, the copy paste of dates is not working."* Two independent defects in
the cell clipboard, both found by comparing `_CELL_META` (the position-keyed copy/paste metadata) against
the live `GRID_COLS` and the grid's own cell rendering.
- ⚠️ **Start/Finish copied the WRONG field.** The grid Start/Finish cells display `dispStart`/`dispFin`
  (actual → forecast → planned) and edit `start_date`/`actual_start` (or `end_date`/`actual_finish`) per
  the row's state — but `_CELL_META[5]/[6]` hardcoded `actual_start`/`actual_finish`. So copying a
  Start/Finish cell of any **not-yet-actualized** activity (the common case — it shows a planned date but
  has no actual) copied **empty**, and pasting a date wrote to `actual_start`/`actual_finish`, bypassing
  the duration recompute + validation and wrongly marking the activity started/complete. That is the
  literal "copy paste of dates is not working".
- ⚠️ **`_CELL_META` was off-by-one from index 10.** The **Duration % Complete** column was added to
  `GRID_COLS` (index 10) on 2026-07-16 but never to `_CELL_META`, so every entry from 10 onward was
  shifted — the cost columns (Planned/Actual/Earned/BL IBB) all copied/pasted the wrong field, and a
  paste into the computed **At Completion IBB** column wrote `bl_cost`. Latent since July; fixed here too.
- **Fixes:** `_CELL_META` rebuilt to 19 entries index-aligned with `GRID_COLS` (durpct + the two
  computed IBB/float/var columns marked copy-only `f:null`; Start/Finish carry `disp:'start'|'fin'`).
  `_cellText`/`_cellPack` read the DISPLAYED date for `disp` columns so copy is never empty. `pasteCells`
  routes any `t==='date'` paste through **`_dateEditPatch`** with the field the grid would edit for that
  row (`d.actual_start ? 'actual_start' : 'start_date'`, `isComplete(d) ? 'actual_finish' : 'end_date'`)
  — same path the inline editor uses, so paste gets actual/planned routing, duration recompute and
  validation; a rejected date is skipped (counted), not aborted. A comment on `_CELL_META` now warns it
  must stay index-aligned with `GRID_COLS`.
- **Verified 28/28 in Node against the SHIPPED functions** (`GRID_COLS`, `_CELL_META`, `_cellText`,
  `_cellPack`, `_isoFromAny`, `_coerceCell`, `_dateEditPatch` sliced out, not reimplemented): meta↔grid
  alignment incl. the realigned cost columns; copying a planned-only Start/Finish is non-empty; copying a
  started row's Start shows the actual; pasting into a not-started Start routes to `start_date` (not
  `actual_start`); a completed Finish routes to `actual_finish`; `_isoFromAny`/`_coerceCell` edge cases.
  Inline script parses (1 block, 0 fail). ⚠️ **Not verified signed-in.** `MODULE_V` → `20260818h`.

## Stale WBS-summary dates: measured live, and the cleanup was NOT run (2026-08-17) — fmlozano
Asked to repair the WBS-Summary rows' own `start_date`/`end_date`/`bl_start`/`bl_finish`, which
nothing recomputes. **Measured first, changed nothing — and the measurement says the premise does not
hold at the scale assumed.** No write was made; no backup table was created; the table is exactly as
it was found.

**Partial-state check (a prior run of this task was killed mid-way).** ⚠️ Clean — nothing half-applied.
The only backup-looking table in the DB is the earlier cleanup's **`wbs_summary_backup_20260817`**
(103,548 rows, a FULL column copy incl. all four date columns); **no `*_dates_backup_*` table exists**.
202 WBS-Summary rows carry a 2026-08-17 `updated_at`, but all 202 are **INSERTs, not updates**
(`created_at === updated_at` to the microsecond, all AVR101, one 30-second burst at 01:50 UTC, all
four dates NULL) — that is `_wbsEnsureSummaries` projecting new rows when someone opened the project,
not a cleanup write.

**Scope measured, all 20 projects, 60,297 WBS-Summary rows** (matches the post-clean figure in the
entry below exactly — used as the sanity gate). Descendants resolved by dotted-`wbs` prefix, the same
relation `_anc` builds:
- **535 rows have no descendant activities** → out of scope, left alone by rule.
- **7,047 rows already agree** with their roll-up (CP104 981/981 and HOR102 5/5 are perfect).
- **52,715 rows disagree — but 52,692 of them are entirely NULL at source.** ⚠️ **They are not stale,
  they are empty.** Writing them is not a repair, it is populating ~52.7k derived values into columns
  the app deliberately ignores and nothing keeps in step — they would drift again on the next edit.
  That is a different decision from the one signed off, so it was not taken unilaterally.
- **Only 23 rows in the whole database actually hold a date that contradicts their descendants:**
  **WCB363 21** (14 stale `start_date`, 21 stale `end_date`; median small, **max 337 days**, 7 over
  30 days) and **DEMO01 2** (`bl_start`, 3 days). Verified one independently by direct query rather
  than from the in-memory model: WCB363 `1.1.1.2` *"Supplementary Agreement 3 'SA-3' Milestone"*
  stores finish **2025-10-30** while its last dated descendant ends **2024-11-27**.
- ⚠️ **And 14 of those 21 WCB363 rows must NOT be touched anyway.** They are the `1.1.3.12.*` branches
  whose descendants exist but carry **no dates at all**, so the specified rule (min/max of descendants)
  computes NULL and would **erase** the only dates on the row. The brief's "leave a row with no
  descendants alone" guard does not cover "descendants with no dates".
- ⚠️ Same hazard on the biggest offender: `1.1.1.2`'s undated descendants include *"Grand Opening
  (Overall Completion)"*, so the stored 2025-10-30 may be the only record of the SA-3 contractual
  date. Shrinking it to 2024-11-27 is defensible as arithmetic and questionable as data. **Owner call.**

**Consumer check (done BEFORE any write was contemplated) — no consumer is materially harmed.**
Every aggregate consumer already excludes summaries: `schedule_scurve_agg_multi` (and therefore
`schedule_scurve_agg` / `cashflow_schedule_agg`, both thin wrappers) filters
`activity_type !~* 'wbs|summary'` in SQL; the three client fallbacks — S-Curve `!isWbs`, Cash Flow's
`indexOf('wbs')===-1 && indexOf('summary')===-1`, Portfolio `!isWbsRow` — all filter too.
`schedule_rows` returns everything by design and the module filters downstream. Two whole-row date
aggregations do **not** filter summaries, and both are safe: `range()` (Gantt timeline bounds) and
`persistRollup()`'s `schedule_start`/`schedule_finish` written onto `projects`. ⚠️ Both are **min/max,
never a sum — so there is no double-count**, and since a corrected summary is by construction inside
its descendants' extent it becomes a no-op for them. The only effect is that a stale outlier stops
stretching the range. ⚠️ Worth flagging anyway: **`projects.schedule_finish` for WCB363 would move**
(next time someone opens it) — Portfolio Overview and the dashboard read that column.

**Two blockers, either one sufficient to stop:**
1. ⚠️ **The mandated backup table cannot be created from here.** DDL is impossible through PostgREST
   with the publishable key, and this environment has no secret key and no Management API token (the
   precedent below had one; key handling is a dashboard action the owner performs). Constraint: the
   operation must be fully reversible from a timestamped backup table — so no write.
2. The real scope is 23 rows, 14 of which are traps. That is a hand-reviewed edit, not a bulk job.

⚠️ **Semantics note for whoever picks this up.** The brief says match `_spanMap`/`_blSpanMap`, which
roll up **displayed** dates (`dispStart`/`dispFin`) — but `dispFin` includes the retained-logic
**forecast**, which moves with the data date, and the code carries an explicit note that it *"never
writes back to end_date, so the PLANNED finish/duration stay intact."* Storing it would freeze a
moving value into a planned column. Measured both ways: planned roll-up 52,713 rows vs displayed
52,716, and **for all 23 real rows the two definitions are identical** — so the choice is immaterial
where it matters, but it must be made explicitly before any bulk write.

⚠️ Measurement traps hit and worth keeping: the PostgREST **root endpoint now refuses the publishable
key** (`401 "Secret API key required"`), and its body parses to an empty object — the first table
enumeration read as *"0 tables, no backups exist"*, which is exactly the confident-wrong-number
failure this module keeps producing. It was caught only because a known-missing/known-present control
pair was run alongside. Also ⚠️ `count=exact` on the whole of `project_schedule` **statement-timeouts**;
filtered counts are fine. And one `wbs` value came back rendered as `[BLOCKED: JWT token]` — a
redaction in the browser tool's output, not data.

## Schedule Builder step 4: linking via View/Edit toggle (the ▸ column is gone) (2026-08-18) — eprobles
Owner: the per-row **▸ column** on the far right of the step-4 class-code grid was "too hassle" for
linking — use step 3's View/Edit method instead.
- Removed the ▸ / ↔ column from `t4GridHTML` (and its `data-linkact` wiring) — the grid is now purely
  the Excel editor for Code/Name/Interior/Exterior.
- New `actMode` ('view'|'edit') + a single toggle button `#b-amode` at the front of the action bar
  (mirrors step 3's `#b-seqmode`): **View** = click a schedule **bar** to inspect its predecessors/
  successors; **Edit** = click bars to select sources → right-click → destinations → link (FS/SS/FF/SF
  + lag dialog). The Confirm/Reset buttons + the pending hint render only in Edit; Auto-chain / Links /
  Clear stay in both. Right-click confirm (`aCtx`) is gated to Edit and bound on both the split and
  stacked layout containers. Leaving Edit clears any half-finished selection.
- ⚠️ Bars already carried `pend`/`pend-dst`/`sbld-focus` styling + `data-act` in BOTH the flow and
  gantt views (13722 / 13805), so selection reflects visually in either view with no extra CSS. The
  `actSelect`/`actConfirm`/`actReset`/`addActLink` 2-phase machinery is reused unchanged — only the
  entry point moved from the ▸ button to bar clicks.
- Verified: inline script parses; `data-linkact` fully removed; `actMode`/`#b-amode`/`aCtx` present.
  ⚠️ **Not verified signed-in** (auth wall). `MODULE_V` → `20260818g`.
- ✅ **Ask #1 ("podium + roof deck level type in step 4") was delivered by a CONCURRENT commit on main**
  (the `kindRow` / `uiSeqKind` / `data-seqkind` level-type selector — All levels · per-kind own/inherit
  + copy). Found at rebase: the step-4 `innerHTML` block conflicted; resolved by keeping the concurrent
  `kindRow` + "per level type" heading AND my View/Edit lede (the ▸ column it described is now gone).
  Both feature sets coexist — verified `data-seqkind`/`#b-seqcopy`/`#b-seqreset` and my `#b-amode` +
  bar-click handlers are all present and the script parses.
- ⚠️ **DEFERRED (told the owner) — two asks in the same message NOT done here, on purpose:**
  2. **Push doubles Gen Req / Site Works / Allied Services** — the doubled trades are exactly those
     where `GWORK === GLABEL`; the non-doubled (ST/AR/MEPF) are where they differ. Strong signal it's
     the grouped-push trade WBS node (named by GLABEL) colliding with the work_type group header
     (GWORK) in the Discipline/Trade view — i.e. a `pushToSchedule` grouped-branch / `buildNodes`
     interaction. This is the live-schedule push/grouping path the change log repeatedly warns
     regresses when changed without a signed-in run; needs live verification, not a blind edit.
  3. **Grouping Trade›Activity›Level›Zone›Unit shows the leaf as the activity name ("Concrete")
     instead of the unit number** — `emitLeaf`/`_dlabel` deepest-bucket logic; also a live-grouping
     change needing sign-in. See both flagged for a focused pass.

## Schedule Builder step 3: clicked relationship line stays highlighted (2026-08-18) — eprobles
Owner: with many overlapping arrows it's unclear which relationship was clicked — a clicked line
should STAY highlighted until you click somewhere else.
- New persistent selection state `seqSelLink = {from,to}` (the clicked arrow's group-key pair),
  surviving re-renders. `scheduleSVG` draws the selected arrow bold red with a red arrowhead
  (`sbldarrowsel` marker) on TOP of the rest (pushed into the `hot` layer), colours its two endpoint
  bars green (source) / amber (dest) via `barCls`, and dims every other arrow (`dimlink`).
- Arrow-click (`.sbld-linkhit`) sets `seqSelLink`, clears any bar focus, and re-renders BEFORE opening
  the edit/unlink dialog; unlinking clears it. Clicking a bar/zone, the focus-clear button, or
  `nodeReset` all clear `seqSelLink` — i.e. "click somewhere else".
- The focus legend's clear affordance now shows when EITHER a bar is focused OR a link is selected
  (`focusLegendHTML(active, id, linkSel)`); arrow-click clears `seqFocus`, so gating on `seqFocus.length`
  alone would have hidden the deselect control. Legend lede is selection-aware.
- CSS `.sbld-link.sellink` (bold red) + `.sbld-linkhit:hover` (red halo affordance). Verified: inline
  script parses; all symbols present. ⚠️ **Not verified signed-in** (auth wall). `MODULE_V` → `20260818f`
  (rebased past a concurrent bump to `…e`).

## Schedule Builder: floor CATEGORIES + per-category auto-trace handoff + click-arrow unlink (2026-08-18) — eprobles
Three related owner asks.
- **Floor categories in step 2.** Each floor now carries a `kind` — **Basement / Podium-Commercial /
  Typical / Roof Deck** — chosen from a dropdown on the floor row. `f.sub` is kept in step with
  'basement' (tower grade line + ordering). `floorKind(f)` derives a kind from `f.sub` for legacy
  floors, so nothing needs migrating. Add-floor → typical, add-basement → basement, quick-gen tags
  basements/floors accordingly. New cfg maps `tradeBatchKind` / `tradeParallelKind` (per leading trade,
  per kind), added to blank()/normalize().
- **Auto-trace handoff is now PER CATEGORY** (owner: "questions for the basements as well / unique
  floors"). The dialog's handoff section lists every floor category the building has, each with its own
  "start together" checkbox + "N level(s) behind" input. `autoTrace`'s cross-trade step trails the
  leading trade WITHIN each kind by that kind's own lead (or runs it parallel), instead of the old
  "basements 1:1, everything else = one global lead". Typical falls back to the legacy
  `tradeBatch`/`tradeParallel` so existing configs are unchanged; other kinds default to 1 level behind
  (the old basement behaviour). Verified with a model: default → basements 1:1, typical trail by 4;
  basements-parallel + typical-2 → no basement links, typical trail by 2.
- **Unlink a relationship by clicking its arrow — at ANY Detail level** (owner: easy, visually pleasing
  unlink). Every arrow in the resulting schedule now carries a clickable hit-path keyed by its two group
  codes (was Unit level only). Clicking resolves the leaf link(s) behind it via the shared `schedKeyOf`:
  one → edit/unlink directly; several (a collapsed Trade/Floor bar) → the dialog's Unlink removes them
  all (with a confirm). Hovering an arrow shows a red halo (`.sbld-linkhit:hover`) as the affordance.
  ⚠️ Relationships live in step 3 (the linking step), so that is where this landed — step 2 is zoning.
- Verified: inline script parses; all symbols present; cross-trade + unlink logic modelled in Node.
  ⚠️ **Not verified signed-in** (auth wall). `MODULE_V` → `20260818c`.

## Schedule Builder step 2: tower sizes to content + summarises high-unit zones (2026-08-18) — eprobles
Owner: 16 units per zone made the step-2 tower an unreadable row of tiny labelled slivers. `towerSVG`
rebuilt:
- **Sizes to content** — width grows with `maxZones × zoneNeed` (min 430) instead of a fixed 430, so
  zones/units get real room; the tower box scrolls / the ctrl-scroll zoom enlarges further.
- **Summarises busy zones** — a zone with more than `UMAX` (8) units is drawn as ONE block showing the
  zone code + "N units" with a few faint tick marks (capped at 11), instead of N labelled cells. Zones
  with ≤8 units still show each unit labelled, given generous width. `zoneNeed` accounts for both
  labelled (`maxLabeledU × UNITW`) and summarised (`ZSUMW`) zones so columns don't cramp.
- Verified: inline script parses; summary branch (`nU > UMAX`) present. ⚠️ **Not verified signed-in**.

## Schedule Builder step 3: View / Edit mode toggle — now a single button + cache-bust fix (2026-08-18) — eprobles
Owner: make step 3 easier — a **View** mode where clicking a bar/zone just shows its relationships, and
an **Edit** mode where clicking selects sources → right-click → destinations → link. Redone as ONE
toggle button (`#b-seqmode`) at the front of the actions bar — primary/filled while Editing, reads
"◉ View mode — click to Edit" / "✎ Edit mode — click to View".
- `seqMode` ('view' default | 'edit'). Shared `clickNode(uids)` handles tower nodes AND schedule
  bars/labels: always `setFocus` (highlight predecessors/successors), and additionally `nodeSelectMany`
  (pending source/destination) **only in Edit**. `nodeConfirm` (right-click) no-ops unless Edit, so View
  is pure inspect. Confirm/Reset buttons + the pending hint render only in Edit; lede is mode-aware.
  Leaving Edit clears any half-finished selection. Auto-trace / Links / Clear stay in both modes.
- ⚠️ **The reason the toggle "wasn't there":** `MODULE_V` had stayed `20260818a` across every commit
  today, so the module page was never re-cache-busted and returning browsers served the first cached
  build. Bumped to **`20260818b`**. ⚠️ **Bump MODULE_V on EVERY module deploy**, not once per day.
- Verified: inline script parses; single `#b-seqmode` toggle + flip handler present. ⚠️ Not verified
  signed-in (auth wall).

## Schedule Builder step 3: declutter the resulting-schedule diagonal (drop redundant FS labels) (2026-08-18) — eprobles
Owner screenshot: the step-3 resulting schedule was littered with overlapping "FS" tags piled on the
bars near the diagonal. Cause: `scheduleSVG` drew a text label on EVERY link, and auto-trace produces
almost entirely FS+0 links, so each one stamped a redundant "FS". Fixed by only labelling a link that
carries real information — a **non-FS type or a non-zero lag** (FS+0 is left unlabelled, matching Gantt
convention where finish-to-start is implicit). The arrows/arrowheads are unchanged; only the redundant
text is gone. Verified: inline script parses; label model gives ""/FS+3/SS/FF-2 for FS+0/FS+3/SS+0/FF-2.
⚠️ **Not verified signed-in** (auth wall). `MODULE_V` → `20260818a`.

## Schedule Builder: parallel-trades auto-logic option, cure question removed, Ctrl+scroll zoom, bar-chart linking (2026-08-18) — eprobles
Four owner asks on the Schedule Builder (`ScheduleBuilder` closure).
- **Step 3 auto-trace: "can start at the same time" option.** Each cross-trade section's handoff
  question now leads with a checkbox — *"Can start at the same time as <prev> (run in parallel)"* —
  which dims the "floors behind" input. Stored as `cfg.tradeParallel[prev]` (keyed on the leading
  trade). In `autoTrace` step 2, `if (cfg.tradeParallel[prev]) continue;` skips the trailing
  cross-trade links, so the next trade has no incoming link and step 3's bookend wires it straight to
  START — i.e. it runs concurrently with the previous trade instead of trailing by a floor lead.
- **Cure/lag question removed.** The per-trade "Cure / lag between a floor and the one above" question
  is gone from the dialog and its save branch; `autoTrace`'s vertical floor→floor link now always uses
  lag 0. `cfg.floorLag` is left in blank()/normalize() for back-compat but is no longer read/written.
- **Ctrl+scroll zoom on the building view AND the resulting schedule.** New `bindTowerZoom(el)` (CSS
  `zoom`, applied live without a re-render — clamped 0.4–3) and `bindSchedZoom(el)` (adjusts the
  existing `seqZoom` ±1 and re-renders). Wired to the step-3 tower (`.sbld-twr`) + schedule
  (`.sbld-schedscroll`), and to step-2's `.sbld-tower`. `passive:false` so Ctrl+wheel zooms instead of
  scrolling the page. `towerZoom` is baked into the tower container's inline style so it survives a
  re-render.
- **Bar-chart linking fixed (ask: "select a zone in the bar chart then right-click doesn't work").**
  Schedule bars were deliberately inspect-only (linking was tower-nodes-only). Clicking a bar / row
  label now also calls `nodeSelectMany(uids)` (same as a tower node), so you can pick a source zone in
  the resulting-schedule bar chart, right-click to advance to the destination phase, pick a
  destination bar, right-click to create the link. The confirm `contextmenu` handler is now bound on
  the stacked layout's container too (`.sbld-seqstack`), not only the split `.sbld-seq2`.
- **Zoneless floor: same as one-zone for SCHEDULING, but floor-lowest for the WBS.** Two owner asks,
  reconciled:
  - *WBS hierarchy* — a floor with no zones is the lowest location level (floor › activity); a floor
    with one zone is floor › zone › activity. So `leavesOfFloor` keeps `zone:null` for a zoneless floor
    (NOT a synthesized zone — that would wrongly add a zone level to the WBS). `locMapOf`/`locLabel`/
    the `buildTree` dim walk all read `loc.zone` directly, so a zoneless floor naturally stops at the
    floor level while a one-zone floor emits its zone.
  - *Cross-trade cell matching* — a zoneless floor and a one-zone floor must still pair up in
    auto-trace. `cellKey` now includes the zone code ONLY when the floor has **>1** zone; a 0-zone and
    a 1-zone floor both collapse to the same key, while a 2+-zone floor keeps its zones distinct.
- **Vertical chain fallback (owner: "AR F13 has no predecessor").** `autoTrace` step 1 linked floor i
  to floor i-1 only when a same-`cellKey` cell existed below — so a floor whose zoning differed from
  the one beneath it (a zoneless floor between zoned floors, mismatched zone counts) got NO predecessor
  and floated to the start. It now falls back to the **first cell of the floor below** when no cell
  matches, so every floor always chains to the one beneath it regardless of zoning.
- Verified: inline script parses; models confirm — a parallel-tagged transition is skipped (bookends to
  START); a zoneless floor keeps `zone:null` (WBS skips the zone level) while a one-zone floor keeps it;
  a 0-zone and 1-zone floor share a cellKey (pair across trades) while a 2-zone floor's cells stay
  distinct; and the vertical fallback chains F12(1 zone)→F13(0)→F14(0) so none is left predecessor-less.
  ⚠️ **Not verified signed-in** (auth wall). `MODULE_V` → `20260818a`.

## Grouping click = SELECT, and "unassigned" buckets are dissolved to the parent (2026-08-17) — eprobles
Two owner asks after the partial-depth fix below ("it didn't work" the way expected):
- **Clicking a grouping header now SELECTS the row, never collapses it.** Real WBS rows already
  selected on click (chevron-only collapse), but SYNTHETIC group headers (`_dkind === 'group'` —
  Discipline/Trade, Tower, Level, etc., which is what a location grouping actually shows) still
  toggled collapse on a bare click. They now highlight instead (new `_selGroup` = the group's
  `_dcode`, `ps-row-sel` applied to `.ps-group-row`); expand/collapse is the ▼/► chevron
  (`data-toggle`) only. `_selGroup` clears when a WBS row or a task row is selected.
- **"— Unassigned —" buckets are DISSOLVED, not shown** (owner: "if there are activities under an
  unassigned WBS, dissolve it and reorganize the activities to the parent"). In `buildNodes()`'s
  `walk`, an activity with no value on a `dimNeedsValue()` dimension (loc:/code:/work/wp/phase) is no
  longer bucketed under a placeholder heading — it is collected into `_dissolve` and recursed at
  `di+1` under the **same parent**, so it re-groups by the next dimension (nesting as deep as it
  genuinely has values) and, when nothing deeper matches, emits directly under the parent. So a
  Structural trade with Tower/Level/Zone but no Unit lands directly under its Zone instead of under a
  "— Unassigned —" unit node. ⚠️ Only `dimNeedsValue()` dims dissolve — status/type/act/responsible
  keep their blank buckets ('Not Started' / 'Task' / 'Unassigned'), which are real states.
- Verified against a faithful model of the new `walk` (dissolve + solo + group nodes): a partial-depth
  Structural activity lifts to depth 3 (under Zone) with no "— Unassigned —" group node, while a
  fully-tagged activity still nests to the Unit level. Inline script parses. ⚠️ Not verified
  signed-in. `MODULE_V` → `20260817z`.

## Grouping is a guide, not a hard filter — partial-depth trades are kept (2026-08-17) — eprobles
User: when the grouping is defined deeper than a trade goes (e.g. Structural has up to Zone but the
groups are defined up to Unit), the grouping-as-filter was excluding the whole Structural trade. It
should be a guide on how the WBS is organized, not drop a trade for a missing deeper criterion.
- ⚠️ **Root cause:** the `_hideUnassigned` filter in `buildNodes()` (~line 5029) required a value on
  **EVERY** required grouping dim (`dimNeedsValue()` dims — loc:/code:/work/wp/phase): `for … if
  (!dimRawOf(r, reqDims[q])) return false`. So an activity with Tower/Level/Zone but no Unit was
  dropped when grouping Tower › Level › Zone › Unit.
- **Fix:** the test is now "has a value on **AT LEAST ONE** required dim" (`if (dimRawOf(…)) return
  true; … return false`). A partial-depth trade is retained and simply nests as deep as it has
  values, landing in a "— Unassigned —" leaf at the level it stops. Only work matching **none** of
  the grouping levels (truly unassigned — Manpower Loading, Bonds & Permits with no location and no
  discipline) is still hidden. The toggle + footer count are unchanged.
- Verified against the SHIPPED `dimRawOf`/`dimNeedsValue` (sliced, not reimplemented): a Structural
  activity with Tower/Level/Zone but no Unit is kept under both Discipline›Location and location-only
  groupings; a fully-tagged activity kept; a truly-unassigned activity dropped; and under a
  location-only grouping a discipline-only General Requirements activity (no location) is still
  dropped. Inline script parses. ⚠️ **Not verified signed-in.** `MODULE_V` → `20260818d`.

## Schedule Builder push: doubled disciplines fix + canonical work_type labels (2026-08-17) — eprobles
User: after pushing the builder result into the project schedule, the Discipline/Trade grouping shows
**two of each trade** (two General Requirements, two Structural, …); also put Others/Allied after MEPF.
- ⚠️ **Root cause of the doubled buckets:** `tradeOf()` wrote the builder's short UI label
  (`GLABEL`: "Structural", "MEPF", "Architectural") into `project_schedule.work_type`, but imported
  activities carry the canonical **WORK_CANON** labels ("Structural Works" / "MEPF Works" /
  "Architectural Works" / "Site Works" / "Allied Services"). Grouping by Discipline/Trade therefore
  split each trade into a builder bucket beside the import bucket.
- **Fix:** new `GWORK` map beside `GLABEL` in the `ScheduleBuilder` closure (canonical labels; GR/OT
  keep their names — no WORK_CANON entry), and `tradeOf` now returns `GWORK[tr] || GLABEL[tr] || tr`.
  Pushed activities now merge into ONE bucket per trade with the imported ones.
- **Others/Allied after MEPF:** already handled — `GROUPS = [GR,SW,ST,AR,MEPF,ALLIED,OT]` and
  `tradeRank`/`_seq = rk*1e6+gi` carry that order into `seq_order` (ALLIED=6, OT=7 after MEPF=5). The
  doubled-bucket bug was masking it; with the labels merged, the groups collapse to one each and sort
  GR→SW→ST→AR→MEPF→Allied→Others.
- ⚠️ **Existing already-pushed rows keep the old labels** — re-push (or Global Change on `work_type`)
  to migrate them.
- Verified: inline `<script>` parses (0 fail); `GWORK`/`GLABEL`/`tradeOf` all in the ScheduleBuilder
  closure. ⚠️ **Not verified signed-in** (push→group-by-Discipline is behind the auth wall).
  `MODULE_V` → `20260817a`.
- **Still pending: Step 3 (Zone Sequencing) rules-engine redesign** — deferred, needs its own scoping pass.

## Phase-tagging wizard + docked stacking-pane fixes (2026-08-14) — fmlozano
Two owner asks in one turn.
- **"Tag project phases" wizard** (`openPhaseWizard`, in the Group menu → "Tag project phases (T&C /
  Handover…)…" and a "Tag phases…" button in the stacking modal). Detects Testing & Commissioning /
  Punchlisting / Handover/Turnover / Closeout / Defects-Liability activities **by name** (reuses the
  `STK_PHASES` keywords) and bulk-assigns each a value on a chosen **Level** (default value = the phase
  name), writing `project_schedule.location` via `_batchUpdate` — so they become real data usable in
  grouping/filters/stack, not only keyword-detected at render. Auto = accept the defaults; the table
  lets you untick/edit each. New `stkPhaseByLabel` (EXACT-label match, so an ordinary "Testing Floor"
  is never mistaken for a phase); `levelRank` returns 1000+ for those exact labels so a tagged phase
  sorts **above the roof**; `stackModel` styles a phase-named band as a phase row (phase colour + "X
  complete" text). No double-render: `stkPhaseRows` only adds UNtagged (no-level-value) phases.
- ⚠️ **Docked stacking pane bug — bands were never visible (debugged).** `.ps-sp-band` had **no
  height** and the row is `align-items:center`, so each band collapsed to its 1px border (the fill
  `<i>` is absolutely positioned). Gave it `height:20px` + a `--pd-bg` background so empty/not-started
  slots are visible too. This is why "the stacking wasn't seen in the pane" — not a data issue.
- ⚠️ **Pane cut-off defaulted to the data date**, which on a not-yet-started project (Avesta: data
  date Aug-26, work starts Nov-26) is all "not started" → empty. The pane now **defaults its cut-off
  to the project's planned finish** (shows the full end-state) and has its own **date input** to scrub
  earlier (`_stkPaneCut`, persisted).
- **Pane is resizable** — drag handle on its left edge (`#ps-stkp-grip`, `_stkPaneW` 150–700px,
  persisted `ps_stackpane_w`).
- Verified: inline `<script>` parses (0 fail). ⚠️ **NOT verified signed-in** (auth-gated). `MODULE_V`
  → `20260814c`.

## Schedule Builder audit — 8 functionality + UX fixes (2026-08-14) — fmlozano
Acting on an audit the owner approved. All in the `ScheduleBuilder` closure in `index.html`.
- **#1 Step-2 edits no longer wipe Step-3 links.** Previously EVERY structural edit — add floor/zone/
  unit, delete anything, **or even rename a zone code** — ran `cfg.links = []`, making the builder
  one-way. New `pruneLinks()` drops only links whose endpoints no longer exist (leaf uids key off
  `id`s, not codes, so adds and renames keep every link). Adds → no clear; deletes → prune; the
  Activity-level change (which genuinely changes all uids) → confirm-then-clear.
- **#2 Reuse zoning across trades.** Step 2 gained "Copy <trade> floors/zones → all trades" and a
  "copy from <trade>" select (`cloneFloors` deep-copies with fresh ids). Most towers share one
  building across ST/AR/MEPF — was re-entered per trade.
- **#3 Link manager table** (`openLinkManager`, "Links (N)" button in Step 3): filterable From·To·
  Type·Lag·✕ list with inline type/lag edit + clear-all — the only practical way to audit hundreds of
  links (One Portwood has 748). `uidLabel()` renders readable endpoints.
- **#4 Confirms on destructive actions.** Auto-trace's "Generate logic" and "Clear links" now confirm
  when links exist (auto-trace + clear both replace/erase everything).
- **#5 Removed the duplicate lead input.** The Step-3 "Structure leads by N floors" box overlapped the
  Auto-trace dialog's per-trade "floors behind"; the dialog is now the single place (`cfg.floorLead`
  stays the fallback default).
- **#6/#7 Resulting-schedule readability.** Row labels moved to a **frozen sticky-left column**
  (`.sbld-schedlabels`) so they stay visible when the diagonal takt chart scrolls right (SVG carries
  no label gutter now); labels are clickable to focus a row. Default **Detail = Floor (2)** instead of
  Unit (4) so a tall building opens compact. Right-click-to-confirm replaced with explicit **Confirm
  sources / Create links** buttons (right-click still works).
- **#8 Per-row / per-column scope toggles** (Step 5): click an activity header to toggle it across all
  locations, or a location label to toggle all its activities (was global All-on/All-off only).
- **#9 Unsaved-changes guard.** `beforeunload` warns on page close/refresh while dirty; switching
  project offers to save the previous project's builder config first (was discarded silently).
- Verified: inline `<script>` parses (0 fail). ⚠️ **NOT verified signed-in** (auth-gated). `MODULE_V`
  → `20260814b`.

## Vertical stacking: end phases (Testing & Commissioning / Punchlisting / Handover) as their own rows + Schedule Builder overflow fix (2026-08-14) — fmlozano
Two asks in one turn:
- **End phases now show in the LSM vertical stacking** (`renderStackView`). Testing & Commissioning,
  Punchlisting, Handover (also Closeout, Defects Liability) carry **no per-floor Level tag**, so they
  never appeared in a floor band — the reference LSM sheets show them as their own rows ABOVE the top
  floor. New `STK_PHASES` + `stkPhaseLabel` (**keyword match on the activity name**, deliberately
  field-independent — they need not be a distinct "Colour activities by" value, which on AVR101 they
  are not) + `stkPhaseRows(levelId, D)`: groups the keyword-matched, untagged, in-scope activities by
  canonical phase, ranked **1000+** (so `stkDisplayOrder` / the grid place them at the top), each with
  its own fixed colour, an italic red label, and a dashed divider separating the phase block from the
  floors. `stackModel` appends them; `stkTowerWideCats` **excludes** phase acts so a phase is shown
  once (its own row, never also folded into a floor). Both the single-tower render and the multi-tower
  grid render them; floor **counts exclude phase rows** (so "N/14" still means floors). Legend gains an
  "End phases:" group. ⚠️ The docked stacking pane (`renderStackPane`) is row-aligned to grid group
  rows, which have no phase group, so phase rows simply don't appear there (harmless — the modal is
  where phases show).
- ⚠️ **Schedule Builder step-3 resulting-schedule spilled off the right, unreachable** (owner report).
  Root cause: `.sbld-panel` is the `1fr` grid child of `.sbld-wrap` with the default `min-width:auto`,
  so the wide resulting-schedule SVG forced the grid track **past the viewport** and `body{overflow-x:
  clip}` clipped the right edge. Fix = `min-width:0` on `.sbld-panel` so the track stays bounded and
  the inner `.sbld-canvaswrap` (overflow:auto) scrolls internally. ⚠️ Deliberately **not** `overflow:
  hidden` — that would break the step-2 tower's `position:sticky`.
- Verified: inline `<script>` parses (0 fail). ⚠️ **NOT verified signed-in** (auth-gated). `MODULE_V`
  already `20260814a` this turn.

## Schedule Builder step 3: level-of-detail on the schedule + bar highlight/relationships + new Stacking step (2026-08-14) — fmlozano
Four owner asks on the Schedule Builder, all in the `ScheduleBuilder` closure in `index.html`:
- **Level-of-detail (`seqLevel`, the step-3 "Detail 1 2 3 4" buttons) now also collapses the RESULTING
  SCHEDULE, not just the tower.** `scheduleSVG` groups the leaf locations to the chosen level (1 Trade /
  2 Floor / 3 Zone / 4 Unit) — one bar per collapsed group — and **aggregates** the leaf-to-leaf
  `cfg.links` between the collapsed bars (dedup; a link internal to a group is hidden), so the arrows
  stay visible even when collapsed (WBS-style). Relationships remain leaf-to-leaf in the data; only the
  drawing collapses. ⚠️ **Edit/unlink of a link (`sbld-linkhit`) is only offered at Unit level (lvl 4)**,
  where a bar is a single leaf so the raw `from~to` is unambiguous; at coarser levels a bar's arrow may
  represent many leaf links, so it's inspect-only.
- **Clicking a bar highlights its whole row** (`.sbld-schedrowhi` full-width band, amber-tint), like the
  Project Schedule row highlight — in addition to the existing predecessor(green)/successor(amber)/dim
  marking. Bar click now focuses the group's leaf uids (`data-uids`, was singular `data-uid`).
- **Coincident relationship lines fixed** — the elbow x is now **staggered per source bar**
  (`srcCount`/`extra = i*7`) so parallel arrows out of one bar don't overlap, and the focused (hot)
  links are drawn LAST (on top of the dimmed ones) so a selected bar's links stand out.
- **NEW step 6 "Stacking"** inserted between Scope-per-zone (5) and Generate (now 7). `stStacking` runs
  `generate(stackBasis)` and renders one **building model per used trade** (`stackTowerSVG`, same
  superstructure-above-grade / basements-below layout as step 2), each zone cell labelled with its
  **zone number + completion date** (from `perZone[].finish`). Internal/External basis toggle. `STEPS`
  array + the two `stGenerate` headings + the help-modal step list renumbered.
- Verified: the inline `<script>` block parses (`new Function`, 0 fail). ⚠️ **NOT verified signed-in** —
  module is auth-gated (local server redirects to login), the standing constraint for this module.
  `MODULE_V` → `20260814a`.

## Vertical stacking: whole-tower phases now continue the per-floor stack, "by tower" breakdown (2026-08-13i) — fmlozano
Follow-up to the previous entry, from the owner reviewing it live: every floor's band was stalling
at "Architectural Works complete" and staying there forever, reading as though nothing happens after
Architectural — the Overall discipline status footer said otherwise, but only as a separate note, not
in the graphic itself. And with "Show all towers" on, the footer's pills collapse every tower into
one shared state per discipline, which cannot distinguish "all 7 towers really are in lockstep" from
"they're not, and this view just can't tell you that."

- **`stkTowerWideCats(levelId, D, cats, byLoc)`** — finds every category with **no per-floor tag
  anywhere in the tower** (computed once per tower, not per floor) and its state at the cut-off.
  Testing & Commissioning and Punchlisting & Handover are the textbook case: modelled as one
  whole-building line, so they never get a Level value and were previously invisible to every
  per-floor band. A category with zero activities in the tower is left out entirely, not counted as
  "none" — it genuinely doesn't apply here, and counting it would inflate every floor's total for a
  trade the tower never had.
- **`stackModel()` now folds those tower-wide phases into every floor's own tail.** One pass through
  `cats` (already chronological, from `catList()`'s own sort) resolves each category from either the
  floor's own activities or the precomputed tower-wide state — a single pass, not floor-categories-
  then-tower-categories as two loops, which is what keeps `lastDone` correct if a floor-tagged and a
  tower-wide category happen to be chronologically interleaved. A floor's `total`/`done`/`pct` now
  honestly include these phases (previously a floor read 100% once Architectural finished; now it's
  genuinely `n` of `n+2` until Testing & Punchlisting also finish) — and once they start, the band
  keeps moving past Architectural instead of stopping. **`b.text` appends "(whole tower)"** when the
  current state came from one of these, so a floor showing "Testing & Commissioning complete" doesn't
  read as if that floor individually was tested in isolation.
- **"By tower" breakdown table** under the existing discipline pills, shown whenever 2+ towers are on
  screen (`overallStatusHTML`'s new `perTower` param): one row per tower, one column per discipline,
  ✓/●/— per cell. New `overallDisciplineStatusForTower()` is the same pin-compute-restore pattern as
  `stackModelForTower()`, just returning `overallDisciplineStatus()`'s output for one tower instead of
  a `stackModel()`. Columns are guaranteed to line up with the pills above them because both come from
  the same `catList()` order.
- `MODULE_V` → `20260813j`.
- Verified: inline script parses (`new Function`), style block braces/comments balance. ⚠️ **NOT
  browser-verified.** The performance cost is worth flagging rather than guessing at: "Show all
  towers" now does, per tower, a `stackModel()` call (which itself does one `rows.filter` per
  tower-wide category) PLUS a separate `overallDisciplineStatusForTower()` call (one `rows.filter` per
  category) — on the owner's 7-tower / 4393-activity project that's on the order of 50-60 full-row
  scans per render. Untested against how it actually feels live; if it's noticeably slow, the fix is
  memoizing `stkTowerWideCats`/`overallDisciplineStatus` per (tower, cut-off) pair within one
  `renderStackView()` call rather than recomputing from `rows` each time.

## Vertical stacking: fixed the hatch-texture illusion, "Show all towers", overall discipline status (2026-08-13h) — fmlozano
Owner reported the "Planned status as of…" stack looked **wavy**, plus two feature asks: see all
towers at once instead of one at a time, and show whether disciplines beyond the coloured one
(MEPF, Allied Services, Testing & Commissioning, Punchlisting & Handover) are also finished.

- ⚠️ **The waviness is a real optical illusion, not a rendering bug — same family as the café-wall
  illusion.** Every band's fill used `catStyle()`, which layers a 45°
  `repeating-linear-gradient` hatch on top of the colour (built for a 15-20-trade Gantt legend, where
  colour alone stops being distinguishable). Stacking many same-height bands directly above each
  other means that diagonal texture crosses every band's dead-straight top/bottom border at a
  regular interval — which is exactly what makes straight, perfectly aligned lines read as wavy to
  the eye. **Fixed by making `stackModel()`'s `b.style` a flat `background-color`, never
  `(map[...]).style`.** A stacked band doesn't need texture to disambiguate — it's already its own
  bordered box with its own text label — so removing it costs nothing and the illusion is gone in
  both the modal and the docked pane (`renderStackPane` shares `stackModel`/`stkBandHTML`, so no
  second fix was needed there).
- **"Show all towers"** — a checkbox in the modal (only rendered when there's a level above the one
  being stacked) that renders every value of the *immediate parent* level side by side in one CSS
  grid (`stkGridHTML`), rows aligned by the union of location values across all of them via the same
  rank/order logic as the single-tower view, so "highest level at the top" means the same thing in
  both modes. Any level COARSER than the immediate parent (e.g. a Region above Tower) stays a single
  pinned selector, unaffected — only the one level directly being multiplied changes behaviour.
  ⚠️ **Implemented by temporarily pinning `_stkScope[parentLevelId]` per tower and restoring it**
  (`stackModelForTower`) rather than reworking `stkInScope` to take an override — synchronous, so
  there's no risk of the pin leaking across calls. Text labels move from an adjoining column (no room
  per tower) to a tooltip on each band. A tower with no value at a given row renders a distinct
  dashed placeholder (`.ps-stk-mnone`), not a status colour — that's a real absence (that building
  has no 14th floor), not "not started".
  ⚠️ **Scoped to the modal only.** The docked pane's whole model is "row-align a band to the grid's
  own group rows" (`renderStackPane`), which has no natural place to put N side-by-side columns
  without a much larger rework — left alone.
- **"Overall discipline status"** — a new footer panel listing every category on the "Colour
  activities by" field (not just the disciplines that happen to carry a value at the stacked level),
  aggregated across the current scope at the cut-off. Reuses `stkInScope()` but drops its requirement
  that the row also carry a value AT the stacked level — that's the whole point: **Testing &
  Commissioning and Punchlisting & Handover are routinely modelled as one whole-building activity
  with no per-floor tag**, so the per-floor stack can only ever report up to the last
  floor-tagged discipline (Architectural, in the screenshots) and silently says nothing about what
  happens after, even once those phases are done. `overallDisciplineStatus()` computes it for the
  current tower; `overallDisciplineStatusAllTowers()` un-pins just the immediate parent level so the
  same panel covers every tower shown when "Show all towers" is on.
  ⚠️ **This only surfaces disciplines that are actual values on the selected field already** — if
  Testing & Commissioning / Punchlisting & Handover aren't distinct `work_type` (or whichever field)
  values on any activity yet, they won't appear as their own row here either; they need to be tagged
  as their own category for this (or the legend) to separate them from whatever they're currently
  filed under.
- `MODULE_V` → `20260813i`.
- Verified: the whole inline `<script>` block parses (`new Function`) and the `<style>` block's
  braces/comments balance. ⚠️ **NOT browser-verified** — this repo's project-schedule module has no
  test seams (`_internals`/exported functions) the way the Engineering App's newer modules do, being
  one large closure not designed for external testing, and there is no live login available in this
  session. The scoping mechanism this builds on (`_stkScope`, `stkOuterLevels`, `stkInScope`) was
  itself only just added in the immediately preceding commits (`06bb6f5`…`3be1cd4`) — re-check the
  "Show all towers" toggle specifically against a project with 2+ hierarchy levels above the stacked
  one (e.g. Region › Tower › Level) to confirm the coarser selector still pins correctly once signed
  in.

## Schedule Builder: library trades + "Others", resizable step-1, step-3 scroll + level-detail fix (2026-08-13g) — eprobles
Follow-ups on the class-code library + linking UX.
- **Library items now carry their real trade.** Re-parsed the mapping workbook's **"Excel Temp"**
  sheet, which has a trade column (**Description 1** — General Requirement / Site Works / Rebar /
  Concrete / … / Electrical / Plumbing / Fire Protection / …), keyed by the same base code. Mapped
  each of the 197 Level-3 items to an app trade group and stored it as the 3rd tuple field; the
  loader files them under that group instead of defaulting all to ST. Counts: GR 17 · SW 15 · ST 5 ·
  AR 101 · MEPF 46 · ALLIED 5 · **OT 8**.
- **New trade "Others" (OT).** Added to `GROUPS`/`GLABEL`/`GCOLOR` (teal `#0d9488`) + `parseTrade`,
  used for the misc/financial codes (DLP, rectification, change order, contingency, buyback, …).
- **Step 1: resizable grid columns** — the grid is now `table-layout:fixed` with a `<colgroup>`;
  each header has a drag grip (`.xl-colgrip`) writing per-column widths into `xColW` (persist across
  re-renders). **Resizable library pane** — a drag grip on the "All class codes" pane's left edge
  (`holdW`, 180–720px, default widened 260→320) fixes the cramped-on-the-right complaint.
- **Step 3: long linking is scrollable** — `.sbld-canvaswrap` capped at `max-height:62vh` with visible
  scrollbars, so a tall/wide zone diagram scrolls inside its pane instead of growing the page.
- **Level-3/4 detail bug fixed** — when the **Activity level** is Floor or Zone, the deeper controls
  (unit +/- at Zone, zones+units at Floor) and the tower's unit/zone splits are now **hidden**
  (`showZones`/`showUnits` gates in `stLevels` + `towerSVG`), matching `leavesOfFloor`. Previously
  level-4 (unit) controls showed even when scheduling at level 3, which read as a bug.
- **Linking bug fixed** — clicking a schedule **bar** now only **inspects** (highlights preds/succs);
  it no longer also toggles the bar into the pending link selection. Linking is done from the tower
  nodes (step 3) / class-code list (step 4) on the left.
- `MODULE_V` → `20260813c`. Verified: inline script parses; all symbols present; trade mapping
  produced 0 unmatched. ⚠️ NOT browser-verified (auth wall).

## Schedule Builder: class-code library + predecessor/successor inspection + bigger duration fields (2026-08-13f) — eprobles
Three asks against the Schedule Builder (`ScheduleBuilder` closure in `index.html`), all additive:
- **Class-code library (right side of step 1).** Extracted **197 codes** from *EPC. FIN. Class Code
  Mapping Template (12).xlsx* — **Class Code number Level 3** (column 5) + **Description 3** (column 6),
  filtered to non-empty rows — into a `CLASS_CODE_DB` constant. A **+ Library** button in step 1's
  "All class codes" holding pane header seeds `cfg.catalog` with any not-already-present codes
  (`loadClassCodeLibrary`, group defaults ST, dur 0). They appear on the right; tick + `←` loads them
  into the build, and **Save** persists (catalog already rides in the `schedule_builder.config` jsonb).
  Re-loading never duplicates (dedup by trimmed code across build + list).
- **Predecessor/Successor inspection on bar select (steps 3 & 4).** Main already had a cross-highlight
  (`seqFocus` array / `actFocus`) that highlighted the *same* node across tower & gantt. Extended it:
  when a bar is focused, `scheduleSVG` / `actSchedSVG` / `actGanttSVG` now also mark its
  **predecessors** (green `.prednode`, links `.hotpred`), **successors** (amber `.succnode`,
  `.hotsucc`), and dim the rest (`.dimnode` / `.dimlink`) — computed from `cfg.links` / `cfg.actLinks`
  relative to the focused id(s). A legend + **Clear selection** button (`focusLegendHTML`) sits above
  each schedule. So with multiple predecessors/successors, clicking a bar makes the drivers obvious.
- **Bigger Int/Ext duration fields (step 4 inline editors).** `.sbld-actdur input` 48×24px/11px →
  82×38px/16px bold centered, labels 10.5px→13px, with a focus ring — far more readable.
- `MODULE_V` bumped `20260813a → 20260813b`. Verified: inline script parses (`new Function`), all new
  symbols present. ⚠️ **NOT browser-verified** — the module is auth-gated (no live session here), the
  standing constraint for this module. ⚠️ **Branch note:** the edits were re-applied onto **main**
  (52268c3) — the local `module/schedule-builder` branch was 7 commits stale and main had meanwhile
  added the `seqFocus`/`actFocus` cross-highlight this work builds on, so a stale-branch patch would
  have conflicted/duplicated.

## Schedule Builder: fully-dynamic per-trade auto-trace questions (+ cure lag, zone order) (2026-08-13e) — eprobles
The auto-trace dialog now asks each trade ONLY the questions that apply to what it actually has, and
adds two new takt inputs the user asked for. Per trade, dynamically shown:
- **Starts how many floors behind <previous trade>** (only when it has a preceding trade) — stored on
  the leading trade's `cfg.tradeBatch`.
- **Cure / lag between floors (days)** — only when the trade has >1 floor. NEW `cfg.floorLag[tr]`,
  applied as the FS lag on every vertical floor→floor link in `autoTrace` step 1.
- **Zones at once per floor** (only when >1 zone) — `cfg.zoneSimul`.
- **Zone order** — a reorderable ↑/↓ list of the trade's distinct zone codes (only when >1 zone). NEW
  `cfg.zoneOrder[tr]`; `autoTrace` step 1b sorts each floor's zones by this order before the
  simultaneity sliding-window, so the sequence zones are worked in is honoured.
- **Units at once per zone** (only when >1 unit) — `cfg.unitSimul`.
- Sections with no applicable question are omitted (respects `cfg.locLevel`: floor-level hides
  zone/unit questions, zone-level hides unit questions).
- Save uses clean `data-atkind`/`data-attr` attributes (an earlier hyphen-in-attribute approach
  mangled the key via camelCase — avoided). Additive jsonb (`floorLag`/`zoneOrder`); no migration.
- Verified: inline JS parses; cure-lag-on-vertical-link + zone-order chaining unit-checked. **NOT
  browser-verified** (auth-gated).

## Schedule Builder: level-link cascade to units + push start = data date (2026-08-13d) — eprobles
- **Zone-sequence collapsed-group linking now cascades to the unit level.** Linking two collapsed nodes
  (Level 1–3) previously created a full cross-product of every source leaf × every destination leaf.
  New `linkMapped(srcs, dsts, type, lag)` (used by `nodeConfirm`) instead maps each source unit-leaf to
  the destination unit-leaf that shares its **sub-location** (`cellKey` = zone#unit) — so linking Floor 5
  → Floor 6 establishes Z1U1→Z1U1, Z1U2→Z1U2, … (unit-to-unit relationships "followed" down the level).
  Falls back to the every-source×every-destination link only when no sub-locations match (e.g. a genuine
  cross-zone single pick). Unit-checked (group→group = clean 1:1; cross-zone single = 1 link).
- **Trade sequence → per-unit activities (already worked, confirmed):** `generate` iterates `locList()`
  (per-leaf = per-unit at unit level) and `pushToSchedule` applies each trade's `cfg.actLinks` WITHIN
  every location — so the class-code sequence is established per unit and replicated to all unit-level
  locations from step 2. No change needed.
- **Push start date = project Data Date.** `openPushModal` now shows a Start date: when the project's
  `dataDate` is set the schedule builds from it (read-only, with a note); when NO data date is defined
  the user is prompted to pick a start date (required). `generate(basis, startOverride)` +
  `pushToSchedule(..., startISO)` thread it through. (Preview panel still uses `cfg.startDate`.)
- Verified: inline JS parses; `linkMapped` + start logic unit-checked. **NOT browser-verified** (auth-gated).

## Schedule Builder: step-3/4 viewing — stacked layout, cross-highlight, L1–L4 collapse (2026-08-13c) — eprobles
Viewing/UX features for the Zone-sequence (step 3) and Trade-sequence (step 4) screens. UI-only, no
config/model change.
- **Stacked layout toggle** (`seqLayout` split|stack, shared by both steps). Split = building/list on
  the left, gantt on the right (original). **Stack = building view on TOP, gantt on the BOTTOM**, with
  the trades laid out **side-by-side** across the top (`.sbld-twr-hz` / `.sbld-twr-col` /
  `.sbld-seqstack`). Toggle in each step's action bar (Split/Stacked).
- **Click cross-highlight** (like the project-schedule row highlight). Clicking a zone/unit node or a
  gantt bar highlights the SAME location in both views via `.sbld-focus` (amber outline). Step 3 uses
  `seqFocus` (uids); step 4 uses `actFocus` (class-code id). Bars/nodes carry the focus class in
  `scheduleSVG`/`actSchedSVG`/`actGanttSVG` and the tower/list.
- **L1–L4 collapse (step 3 only)** — `seqLevel` 1=Trade / 2=Floor / 3=Zone / 4=Unit, via a "Detail
  1 2 3 4" button group. `towerNodesFor`/`seqTowerCol` build the tower at the chosen depth; a collapsed
  node carries ALL its descendant leaf uids (`data-uids`), so linking/highlighting it acts on the whole
  group (`nodeSelectMany`). Respects `cfg.locLevel`.
- Verified: inline JS parses (`new Function`). **NOT browser-verified** — module is auth-gated (local
  server redirects to sign-in), so no signed-in click-through of the new layout/highlight/collapse yet.

## Schedule Builder: auto-trace takt questions — zones/units simultaneity + unit sequencing (2026-08-13b) — eprobles
Step-3 auto-trace now asks the significant takt questions BEFORE building, and actually sequences units.
- **`openAutoTraceDialog` expanded** into a per-trade section asking: (a) how many **zones** run at the
  same time per floor, (b) how many **units** at the same time per zone, (c) how many **floors** finish
  before the following trade starts. Each question only shows when it applies (trade has >1 zone / >1
  unit / has a follower) and respects `cfg.locLevel` (floor/zone remaps hide the deeper questions).
  Stored in new per-trade `cfg.zoneSimul[tr]` / `cfg.unitSimul[tr]` (+ existing `cfg.tradeBatch`).
- **`autoTrace` gained intra-floor sequencing (step 1b)** — the fix for units. Previously units/zones
  within a floor ran fully parallel (only the vertical cellKey chain existed). Now a sliding-window
  chain (`leaf[i]` waits on `leaf[i-N]`) enforces "≤ N zones per floor / ≤ N units per zone at once":
  N = the answered simultaneity (0/blank or ≥ count = all parallel = old behaviour). Reads
  `leavesOfFloor` so it honours `cfg.locLevel`. Cross-trade floor batch + Start/End bookends unchanged.
- Additive `jsonb` keys (`zoneSimul`/`unitSimul`), tolerated by `normalize`; no migration. Verified:
  inline JS parses; sequencing unit-checked (fully-seq, zones-seq/units-parallel, zones-parallel/units-
  seq, all-parallel, 2-at-a-time window all correct). **NOT browser-verified** (module auth-gated).

## Schedule Builder: per-trade takt batch + global activity-level remap (2026-08-13) — eprobles
Three additive changes to the `ScheduleBuilder` closure in `index.html` (⚠️ re-applied directly onto
main — the session's original edits were made on the stale `module/schedule-builder` branch, which is
97 commits behind main and has a divergent, older Schedule Builder; that branch was NOT merged):
- **Auto-trace reworked to a per-TRADE "floors at a time" question** (was per cross-trade pair).
  `openAutoTraceDialog` now asks, for each leading trade, *"How many floors at a time does <trade> do
  before <next> follows?"* → new `cfg.tradeBatch[<trade>]`. `autoTrace`'s cross-trade lead reads
  `cfg.tradeBatch[prev]` (falls back to legacy per-pair `cfg.tradeLeads`, then `floorLead`).
- **Global activity-level remap** — new `cfg.locLevel` (`auto`|`floor`|`zone`|`unit`), chosen from a
  selector in **step 2**. `leavesOfFloor` honours it: `floor` = one leaf per floor, `zone` = one per
  zone (units ignored), `unit`/`auto` = deepest defined. Because `locList`/`cellKey`/`locLabel`/
  auto-trace/scope/`generate`/`pushToSchedule` all key off these leaves, one setting remaps the whole
  builder. Changing it clears `cfg.links` (leaf uids change). This is the "switch floors/zones to
  activity level" ask.
- Push-to-schedule already retains relationships (FS/SS/FF/SF + lag as predecessors) + files under the
  picked WBS with optional Trade→Floor→Zone→Unit grouping — unchanged, confirmed.
- Additive `jsonb` keys (`tradeBatch`/`locLevel`), tolerated by `normalize`; no migration. Verified:
  inline JS parses (`new Function`); leaf-remap counts unit-checked. **NOT browser-verified** (module
  is auth-gated; local server redirects to sign-in).

## Option A: ONE LANE PER ACTIVITY in the composition strip, with an honest overflow lane (2026-08-17) — fmlozano
Owner, on the strip shipped this morning: *"Slab on grade"* sharing lane 1 with *"Strip topsoil"* read as
a misalignment. Correct diagnosis on their part — the strip used **greedy interval partitioning**, so an
activity took the first lane whose previous occupant had **finished**, and two activities that merely do
not OVERLAP shared a lane. A shared lane says "these are one track of work"; nothing of the sort was
meant. Owner: *"A is the most ideal so that it will be easier to understand."* Now one lane per activity,
ordered by start date — an LSM staircase.

- **THE LEGIBILITY ARITHMETIC, which is the whole of this change.** Lane count is now activity count, not
  concurrency width, so the cap stopped being a safety net and became the design constraint.
  - **`PS_LANE_MIN = 3` — the minimum legible lane, measured.** A band carries `box-shadow:0 0 0 .5px
    inset`, and lanes **tile contiguously**, so the abutting outlines of two neighbours ARE the separator
    — there is no inter-lane gap to budget. A lane must render ≥2px of its own trade colour after the
    outline takes 0.5px top and bottom: **2 + 0.5 + 0.5 = 3px**. Below that a band is outline-and-nothing,
    indistinguishable from the hatched inert track behind it.
  - **Bracket floor = 6px comfortable / 5px compact, and 5 is a hard floor.** The bracket is a pale track
    + solid roll-up fill with `border-radius:2px`. At 4px the radius rounds away the full height at both
    ends and it reads as a lozenge, not a bar, and the solid-vs-pale split has under 3px of body left.
    **There is nothing left to take from the bracket.**
  - **The strip may only grow by taking from the bracket, never from the row** (ROWH is unchanged):

    | | o8 | bracket | strip | rail | bottom | ROWH |
    |---|---|---|---|---|---|---|
    | comfortable BEFORE | 8 | 8 | 8 | 5 | 31 | 34 |
    | comfortable AFTER | 8 | **6** | **12** | 5 | **33** | 34 |
    | compact BEFORE | 6 | 8 | 6 | 4 | 26 | 27 |
    | compact AFTER | 6 | **5** | **9** | 4 | **26** | 27 |

  - **`stripH = ROWH - o8 - compH - 1 - 1 - railH - 1`** — derived, never a literal, so the three marks
    cannot drift out of agreement with each other or with ROWH. The trailing −1 is the clear pixel: a
    rail flush with the row boundary touches the next row's divider.
  - **`LANE_CAP = floor(stripH / 3)` → 4 comfortable, 3 compact**, i.e. **3.00px per lane exactly, AT the
    floor in both densities**. Confirmed in a real browser, not just in the emitted string (below).
- ⚠️ **THE HONEST VERDICT, because the cap went DOWN (5 → 4) and the owner should hear it from us.**
  One-lane-per-activity is only fully expressible for a branch of **≤4 activities** (≤3 compact). The
  Earthworks case the owner is looking at has exactly 4 and renders as a perfect 4-step staircase — but a
  20-activity fit-out branch shows 3 lanes plus an overflow marker. **A real leaf branch can hold dozens**,
  so on those the strip now says "here are the earliest three, and there are 17 more" where it previously
  drew all of them. That is a genuine loss of per-activity detail, traded for lanes that mean what they
  look like. **4 lanes is the ceiling** — bracket and rail are both at their floors and ROWH cannot grow.
  If the owner prefers detail over unambiguous lanes on big branches, the honest options are (a) revert to
  greedy packing for branches over the cap, or (b) grow ROWH; there is no third answer at this row height.
- **The overflow rule — and this replaces a silent truncation, which is the point.** The old cap did
  `lane = j % LANE_CAP`: past the fifth activity bands **silently painted over each other** while the row
  implied it showed everything. Now the earliest `cap−1` keep individual lanes and the whole remainder
  folds into ONE `.ps-sum-more` marker spanning their combined date range, carrying the count and the
  names. Nothing is dropped and nothing is overpainted. It cannot be read as a trade band: no trade
  colour, dense neutral cross-hatch, dashed outline where a real band has a solid inset one.
  ⚠️ **The strip is `pointer-events:none` (pre-existing), so the marker's title is emitted but NEVER
  reachable on hover** — which is exactly why the marker has to be unmistakable on sight rather than
  relying on its tooltip. Enabling hover needs `.ps-sum-strip` added to the Gantt click delegate's
  `closest()` list first, or a click on a band deselects the row.
- **Ordering** is start date, then finish, then activity id — a **deterministic** tie-break, so the
  staircase cannot reshuffle between renders when two activities start on the same day. Asserted
  order-independent (feeding the same two rows in either order yields identical lanes).
- **Unchanged, each asserted individually:** band dates, per-band tooltips, trade colours and textures;
  which rows draw composition (a branch containing another branch still draws none — the altitude fix);
  ROWH; the bracket → strip → rail order and the rail's treatment; the roll-up %, bar label and tooltips;
  and **the plain (colours-off) view is byte-identical** (no strip, no marker, no comp bracket, rail still
  at `sumTop+9+1`, no inline colour on the bracket so the red CSS fill still applies).
- **Theming** needs nothing new: the marker uses `--ps-track`/`--ps-trackln`, plain CSS vars already
  defined in both the light and dark blocks, so it follows a theme flip with no JS.
- **Verified by EXECUTING the shipped code**, nothing under test stubbed — `rebuild`, `_buildSegMap`,
  `_sumSegsHTML`, `ganttRowHTML` and the whole `catEntry`/`catTint`/`catStyle` chain sliced verbatim out
  of index.html. `scratchpad/check-lanes.js`, **39 checks** on emitted geometry, at both densities.
  ⚠️ **BEFORE/AFTER: the same suite against HEAD fails 21 of 39**, including the literal complaint
  measured — four non-overlapping activities all reporting lane top `[0,0,0,0]`, and the 20-activity
  branch emitting **24 bands and 0 overflow markers**.
- **Confirmed in a REAL BROWSER** (headless Edge, shipped CSS, sanity-gated on `--pd-red` resolving so an
  unloaded stylesheet cannot pass as a measurement): strip **12.00px**, Earthworks **4 lanes @ 3.00px**,
  Fit-out **3 lanes @ 3.00px + a 3.00px overflow lane**, comp brackets **6.00px**, plain bracket
  **9.00px**, rails **5.00px** — the derived arithmetic exactly.
- **Other suites green:** optc 39, sumspan 22, blrail 14, present2 30, baseline-lsm, transpose,
  grouprollup. Parse clean (1 block); **function-set diff vs HEAD: 0 lost, 0 added.**
- ⚠️ **FIVE SUITES NEEDED A STUB ADDED, and that is a trap worth knowing:** `PS_LANE_MIN` is a
  module-scope `var`, NOT inside any sliced function body, so every harness that slices `ganttRowHTML`
  threw `ReferenceError` until it was added to the sandbox. A suite that crashes reads as a code defect;
  it was a harness gap.
- ⚠️ **Five assertions were CHANGED and they are this pass's intent, not regressions** — four in
  check-optc and one in check-present2 hard-coded the superseded `8px` comp bracket. They now read the
  height from the CSS and assert the surviving invariant (thinner than the old 13px, at/above the 5px
  floor, rule is height-only). Same precedent as the earlier "suite written against an intermediate
  iteration" note.
- **Screenshots** at 1440px from a gitignored `_ui_test.html` built from the module's REAL `<style>` block
  + rows emitted by the REAL `ganttRowHTML` (⚠️ unlike the older `mk-shot.js`, `_sumSegsHTML` is NOT
  stubbed — stubbing it would bypass the very logic under test): `scratchpad/lanes-before.png`,
  `lanes-after.png`, `lanes-after-dark.png`, plus `probe.png` (the in-browser measurements above).
  Harness pages deleted, PNGs kept. Before: Earthworks reads as one bar changing colour along its length.
  After: four descending steps.
  ⚠️ **Honest note on the after shot — at 1× the 3px bands are visibly fainter than the old 8px single
  lane.** They are legible and the staircase reads, but this is at the floor, not comfortably above it.
- ⚠️ **Traps.** The browser tool's screenshot still times out here — use headless Edge, and it needs
  **Windows-style paths** for `--screenshot` (a POSIX path silently writes nothing). `--dump-dom` is
  unavailable in this Edge build; render measurements into the page and screenshot them instead.
- ⚠️ **NOT verified signed-in** — the anon key has no grants on `project_schedule`, so AVR101 was never
  opened from here. Everything above is measured against the shipped functions in Node and in a real
  browser rendering the shipped CSS.
- ⚠️ **Left open.** (1) The cap-vs-detail trade-off above is the owner's call. (2)
  `scratchpad/check-present.js` still fails 12 checks and **fails them identically on HEAD** — a stale
  suite for a "Presentation mode" that is not in the file; not touched, not caused here.
- `MODULE_V` → `20260818d`.

## Concurrent activities are LANE-PACKED inside the bracket (2026-08-17) — fmlozano
Owner on Ground floor › Wet Works: *"it captures also the planned for other activities and overlaps
them which makes it confusing at the Wet Works level"* — then confirmed the target with a zoomed
crop of the P6 LSM sheet, where concurrent trades sit in their own sub-lanes and sequential ones
share a line.
- ⚠️ Every segment was drawn at the bracket's FULL height, so concurrent work simply painted over
  itself and whichever came last in `_sorted` won. Wet Works runs Masonry (Apr–Jul), Sealant
  (Apr–Jul) and Waterproofing (Jun–Jul) together, so the bracket showed a mash that read as one
  activity spilling over the others.
- **Greedy interval partitioning**: each activity takes the first lane whose previous occupant has
  finished, else a new lane. Overlap becomes **stacked stripes** — which is what a bar carrying
  several trades at once actually means — and purely sequential work still uses ONE full-height
  lane, so the common case is unchanged.
- ⚠️ **`LANE_CAP = 5`.** The bracket is 13px in LSM mode; past five lanes a stripe is under 3px and
  the stacking stops carrying information, so lanes are reused beyond that. Overlap returns only in
  the rare deeply-concurrent case, never for the ordinary 2–4 trade overlap.
- ⚠️ `top`/`height` now come **inline** (percentages), so `.ps-sum-seg` lost its `top:0;bottom:0` —
  a `bottom:0` would fight the computed height and flatten every lane back to full height.
- **Verified 22/22** against the sliced `_sumSegsHTML`: the three concurrent trades land in three
  different lanes, lanes tile the bracket exactly, none overflows, a non-overlapping follower reuses
  lane 0 rather than adding height, **sequential-only work still uses a single full-height lane**,
  and the cap holds at 12 concurrent activities. All 14 suites green.
- ⚠️ **Test-file lesson:** an existing assertion (`no stray top/height`) kept passing after this
  change because it matched `top:…px` while the code now emits `top:…%` — it was passing
  *vacuously*. Two attempts to patch the file with Python `.replace()` also silently no-op'd on
  escaping. The file was rewritten from scratch instead. A green assertion that no longer tests
  anything is worse than a missing one.

## Mixed branches drew a misleading partial composition (2026-08-17) — fmlozano
Owner, on Tower 1 › Structural Works: *"a white bar then filled with green then blank bars again
which doesn't make any sense."* Correct — and caused by the altitude fix earlier the same day.
- ⚠️ Narrowing `_buildSegMap` to the **direct parent** was right for pure branch-of-branches, but a
  **MIXED** branch — child branches (Substructure, Superstructure…) AND a couple of activities
  hanging directly off it — then drew a bracket decorated with only those strays. The white gaps
  read as "nothing is happening here" while the child branches were full of work.
- **A branch containing another BRANCH now draws no composition at all**, not even a partial one:
  it summarises like any other branch of branches, and only a TRUE leaf branch shows the trade
  sequence. `_kidBranch` is built in the same pass as the seg map.
- ⚠️ The stray activities are still in the map and still counted in the roll-up — nothing is dropped
  from the model, only from the drawing. Asserted.
- **Verified 18/18 against the real `_sumSegsHTML`** (not a proxy): leaf branches still draw, the
  mixed branch returns **empty**, higher branches return empty, and the flags are right in both
  directions.

## The REAL stacking lag: a cross-function n-squared I introduced (2026-08-17) — fmlozano
Owner: opening the vertical stacking still took *"about a minute or 2"*. The earlier O(n x m) sweep
had not touched it, because **the nesting spans two functions**.
- ⚠️ `stkPhaseNamedScope()` — added earlier the same day to scope "Tower 3 Handover" to Tower 3 —
  calls `stkScopeValues()`, and it runs **PER ROW** from `stkPhaseInScope`. `stkScopeValues` does a
  full pass over `rows` **plus a sort**. So `stkPhaseCats` became rows x (rows + sort), run **8x per
  open** (7 towers + the legend): **~154M row visits and ~35,000 sorts.**
- ⚠️ **My own fix caused it, and my own audit could not see it.** `audit-perf.js` looks for a scan
  nested inside an iteration *within one function body*; this one is `A → B → C` across three. The
  audit is a filter for one shape, not proof of absence.
- **Fixed by memoising `stkScopeValues`**, keyed on `rows.length` + a scope signature so pinning a
  different tower or reloading drops it.
- **Measured end to end with the shipped chain: 154,387,592 -> 70,288 row visits (2,197x).**
  8/8, including that a tower still gets **only its own** handover, and three cache-staleness
  assertions (same scope reuses, changed scope drops, changed rows drops).

## Expand menu offered levels that do not exist (2026-08-17) — fmlozano
`maxDepth()` estimated *deepest WBS code + groupBys.length*, which is only right when the WBS path is
part of the tree. Grouping by Discipline › Activity › Tower › Level › Zone does not show it at all,
so Avesta offered **"WBS Level 1…14" for a tree six deep** — eight entries that collapsed to nothing.
Now measured from the tree that was actually built (`_treeDepth`, recorded in `displayList` — the one
place the full un-collapsed tree exists; measuring `DL` would shrink the menu as branches collapsed,
and re-running `buildNodes()` just to count would double the costliest step of a render).

## Legend now shows planned vs complete (2026-08-17) — fmlozano
With colours on, a bar fills with its OWN trade colour — pale for remaining, solid+textured for
done — and **nothing on screen said so**, which is why two greens on one bar read as two trades.
Added `.lg-lsmon` entries (the mirror of `.lg-lsmoff`): sample swatches drawn the way a real bar is.

## Swept the remaining O(n x m) hot spots (2026-08-17) — fmlozano
Wrote a static audit for the shape that caused both stacking-pane wins — a scan of one large
collection nested inside an iteration of another — and worked the list. 19 candidates, 5 real.
- ⚠️ **`_wbsCommit`** ran **two** scans of `rows` per node: a `find` for the node's summary row plus
  a full `forEach` when its code changed. ~1,600 nodes x 4,393 rows = **~14M row visits per WBS
  commit**, and since renaming near the top of the tree re-codes every descendant, the expensive
  branch is the COMMON one. Now two indexes built in one pass. ⚠️ Kept `find`'s **first-match**
  tie-break for the summary row — asserted in the tests, because silently picking a different
  duplicate would change which row gets renamed.
- ⚠️ **`_selectedTaskRows`** did a `rows.find` PER SELECTED ID — Ctrl-A on Avesta made it 4,393²
  (**9.66M** comparisons, measured) and froze copy / bulk-delete / fill-down. One pass now.
  ⚠️ **Selection ORDER is preserved** (the clipboard pastes in it), so the result is re-sorted by
  each id's position in the selection rather than by row order.
- **Reorder persist** (`changes.map -> rows.find`) and **drawing-register's drag re-sequence**
  (`ids.forEach -> rows.find`): both O(changes x rows), both indexed once.
- **resource-loading `loadingModel`** looked up the resource master with a `find` **per assignment** —
  a P6/XER import brings ~55,000 of them.
- ⚠️ **The audit tool reported wrong line numbers for HTML** (it counts lines in the concatenated
  `<script>` bodies, not the file) and sent the first fix attempt to the wrong code. Locations were
  re-derived by grep. A second silent failure followed: a Python patch to the tool didn't match and
  no-op'd, and the "fixed" run printed identical output. **Both are the same lesson — verify a tool
  changed what you think before trusting its output.**
- **Verified 15/15 against the ORIGINAL implementations as oracles**: identical results for single /
  multi / stale-id / empty / select-all selections, selection order preserved, WBS rows excluded, the
  summary-row tie-break, and the activity bucket holding exactly the rows the old `forEach` touched —
  plus the measurement, **9,655,814 -> 4,393 visits**. All 13 suites green (236 assertions).
  ⚠️ **Not verified signed-in.** `MODULE_V` -> `20260817l`.

## Bar altitude + progress on every bar (2026-08-17) — fmlozano
Owner: *"the higher the WBS level the more high level the gantt bars should look like"*, the mixed
green/blue/grey textures are *"confusing during reporting"*, and *"how should the viewers know what
is the actual progress per activity — that is the main weakness of the gantt view right now."*
Both were fair, and the first was made worse by the bracket-subdivision work earlier today.
- ⚠️ **`_buildSegMap` mapped every activity into EVERY ancestor** (`a._anc`), so Execution Phase,
  Construction Phase and Tower 1 each drew the *same* 4,393-activity composition. Every level of the
  tree looked identical — a band of confetti that says nothing at reporting altitude. Now mapped to
  the **direct parent only**, so only the branch that actually contains activities shows the trade
  sequence; everything above falls through to the plain bracket with its rolled-up %-complete fill.
  The higher the level, the more summary the bar reads, which is the point of a WBS.
- ⚠️ **Progress was genuinely unreadable per activity.** A summary row printed its roll-up %, but an
  ACTIVITY printed only its name. In the plain view progress was a red sliver to eyeball; in LSM mode
  the red fill is suppressed entirely (the bar fills with its own trade colour), so **there was no
  number anywhere**. `_barLabel` now appends `%` for anything started — and a 100% bar says "100%"
  rather than going silent, so "no number" unambiguously means not-started.
- **Verified 15/15**: composition on the leaf branch and its sibling, ⚠️ **none on Tower 1 /
  Construction Phase / Execution Phase** (asserted individually), every activity still mapped exactly
  once (nothing lost by narrowing), and the label rules incl. 100% staying visible, not-started
  staying blank, the dates-label variant, `labels=none`, and clamping. All 12 suites green (221
  assertions). ⚠️ **Not verified signed-in.** `MODULE_V` → `20260817k`.

## Grid handlers delegated — the deeper half of the scroll fix (2026-08-17) — fmlozano
The `_gridWinKey` guard skipped no-op repaints; this removes the cost of the repaints that DO happen.
- ⚠️ `renderWindow` bound handlers **per element, every repaint**: click + contextmenu per row, a
  dblclick per editable cell (10-18 of them), three per status `<select>`, chevrons, WBS rows —
  ~20 listeners × ~40 visible rows ≈ **800 `addEventListener` calls each time the window moved**.
  Now bound **once** to the persistent `#ps-grid-rows` container and dispatched with `closest()`, so
  a window repaint is pure `innerHTML` plus one attribute pass.
- ⚠️ The guard flag lives **on the element** (`host._psDelegated`), not in a module var, so a
  re-created host re-binds rather than silently losing all its handlers.
- ⚠️ **Drag-and-drop stays per-element ON PURPOSE**: it is gated on `_reorderEnabled()` (usually
  costing nothing), it needs the `draggable` attribute per row anyway, and its five handlers close
  over per-row drop state that delegation would make materially easier to get wrong. Documented as
  the exception so it does not read as an oversight.
- ⚠️ `.ps-wbs-row { cursor:pointer }` moved to CSS — it used to be set as an inline style at bind
  time, which delegation would have dropped silently.
- **Verified 19/19 against the sliced shipped binder** on a DOM shim: **50 repeat binds add zero
  listeners** (the perf claim asserted directly), chevron-beats-row-select, WBS row selecting vs
  synthetic group header collapsing, plain/ctrl/shift selection, dblclick-to-edit, ⚠️ **the status
  dropdown NOT selecting its row** (a `stopPropagation` that delegation could easily have lost),
  status change persisting + repainting, both context menus, the Fill-down field passthrough, and a
  click on empty space being inert. All 11 suites green (206 assertions).
  ⚠️ **Not verified signed-in** — this touches the grid's core interactions, so it is worth a real
  click-through: select, ctrl/shift-select, double-click edit, status change, right-click menu, and
  drag-reorder if you use it. `MODULE_V` → `20260817j`.

## Gantt scroll: skip no-op window repaints (2026-08-17) — fmlozano
Owner: "also lagging when scrolling down and left". Scroll was ALREADY rAF-throttled, so the cost was
inside `renderWindow()` itself.
- ⚠️ Every call re-serialises the window AND **re-binds several hundred listeners** — roughly 20 per
  row x ~40 visible rows: row click + contextmenu + the drag set, a dblclick per editable cell,
  three per status `<select>`, chevrons, WBS rows. A rAF fires up to 60x/second, but the 10-row
  buffer moves far less often, so **most of those repaints painted the exact same rows.**
- Added a `_gridWinKey` guard (`first:last:DL.length`): a scroll that lands on the same slice now
  returns immediately. This is the pattern the **WBS Manager already used** (`_wbsWinKey`); the
  Gantt grid never got it.
- ⚠️ `renderWindow(force)` — scroll passes nothing, **every other caller MUST force**, or an edit /
  selection / filter would leave a stale window painted. `doRender` forces; closing an inline editor
  clears the key before flushing.
- ⚠️ **The deeper fix is still open:** those listeners should be *delegated* to `#ps-grid-rows` once
  instead of bound per element per repaint. That removes the cost entirely rather than skipping it,
  but it touches ~8 handler groups in the grid's hot path and was too big to do safely in the same
  pass. The key guard makes the common case cheap; delegation is the real answer.

## Stacking pane was O(categories x rows); now O(rows) (2026-08-17) — fmlozano
Owner: "the app is lagging so much when opening the vertical stacking." It was algorithmic, not
hardware.
- ⚠️ **`stkTowerWideCats` and `overallDisciplineStatus` were both `cats.forEach(rows.filter(...))`.**
  Under "Colour activities by = **Activity name**" Avesta has **438 categories x 4,393 rows = 1.9M
  row visits per call** — and `stkTowerWideCats` runs once per tower (7) while
  `overallDisciplineStatus` runs once per tower plus once for all-towers (8). **~30M `catValOf`
  calls to open one pane.** Both now bucket rows by category in ONE pass, then look up: O(rows + cats).
- ⚠️ **`stkOuterLevels` memoised.** `stkInScope` calls it for EVERY row on every pass, and it built a
  throwaway id array each time. Cache is keyed on `LOC_LEVELS`' **identity**, so it self-drops when
  the location breakdown is reassigned — asserted in the tests, since a stale cache here would
  silently scope the whole stack to the wrong levels.
- ⚠️ This is why the lag scaled with the **colour field**, not the project: Discipline/Trade has ~6
  categories and felt fine; Activity name has 438 and did not.
- **Verified 15/15 with the ORIGINAL implementations transcribed from git history as a behavioural
  oracle** — same category set, same order, same state, **same per-category activity counts** —
  then the complexity assertion: **274,436 -> 628 row visits (437x)** on an Avesta-sized fixture,
  with the new cost bounded at one pass over in-scope rows. All 10 suites green (167 assertions).
  ⚠️ **Not verified signed-in.** `MODULE_V` -> `20260817h`.

## Phase AUDIT against live AVR101: the detection was over-matching (2026-08-17) — fmlozano
Owner asked "audit the closeout, how is this showing?" — queried the live schedule. The answer is
that **most of what the stack called a phase was not one.**
- ⚠️ **"Testing & Commissioning" was 100% FALSE POSITIVE on AVR101.** The only activities matching
  were **Material Testing** ×2 (Apr-2025 → Aug-2027) — QA sampling, not commissioning. The bare
  `testing` keyword was doing it. Avesta models no commissioning work at all, so the purple band was
  showing a QA task as a building phase. Keyword narrowed to `commission | pre-comm | T&C`.
- ⚠️ **"Closeout" was mostly per-work-package COMMERCIAL admin** — `Commercial Closeout` ×14,
  `Financial Closeout` ×14, `Technical Closeout` ×14, scattered Jul-2026 → Nov-2027. The building's
  actual closeout is only `Tower N Full/Partial Closeout`. Added `STK_PHASE_NOT`
  (`^(commercial|financial|technical)`), which keeps the real ones and drops the admin.
- ⚠️ **Phases are PER TOWER on this project, not whole-building.** `Tower 1 Handover` 2026-12-21 …
  `Tower 4 Handover` 2027-08-31 — one each, each with its own date, and the tower is in the NAME
  rather than in a Tower field. Treating them as whole-building made **all 7 towers inherit one
  tower's dates**, which is why every floor of every tower painted the same colour in the owner's
  screenshot. `stkPhaseNamedScope()` now reads the tower out of the activity name and scopes the
  phase to it; a phase naming no tower stays whole-building as before.
- **Separate phase rows removed for real.** They were never `stkPhaseRows()` output — they were
  ordinary location bands whose Level value the "Tag phases…" wizard had set to a phase label.
  `stackModel` now drops those locations (`if (stkPhaseByLabel(loc)) return;`); the activities are
  still counted through `stkPhaseCats()`, so nothing is lost, it just stops being a second bar for
  work already folded into every floor.
- ⚠️ **Caught before shipping:** removing the phase branch from the bucketing loop left `isPh`
  referenced but undefined — a ReferenceError that parses fine. Found by grepping the symbol after
  the edit, not by the parse check, which is exactly the class this module has shipped twice.
- **Verified 19/19 on REAL AVR101 activity names**, incl. Material Testing rejected, all three
  admin-closeout variants rejected while `Tower N Full/Partial Closeout` are kept, per-tower
  attribution picking the right tower, and ⚠️ **the regression asserted directly — Tower 4 Handover
  is NOT in scope for Tower 1**. All 9 suites green (152 assertions). ⚠️ **Not verified signed-in.**
  `MODULE_V` → `20260817f`.

## Legend audit + end phases folded into the floor bands (2026-08-17) — fmlozano
- ⚠️ **REGRESSION I INTRODUCED, caught by the owner.** Baseline (BL0) / Activity / WBS summary
  reappeared in LSM mode. The hiding rule was `#ps-view-schedule.ps-lsm **.ps-legend** .lg-lsmoff`,
  scoped to the wrapper I deleted when flattening the marks into one legend row — and my own comment
  claimed "the existing rule still applies". It did not: it needed a `.ps-legend` ancestor. Rule is
  now unscoped, with a note saying why it must stay that way. **Lesson: a CSS rule can depend on
  markup structure, so deleting a wrapper is a behaviour change, not a cosmetic one.**
- **Tip line removed** — a permanent paragraph of instructions competing with the legend beside it.
- ⚠️ **End phases now fold into EVERY floor's band instead of getting their own rows** (owner:
  "should be within a per floor level not a separate bar"). New `stkPhaseCats()` turns them into
  **pseudo-categories** carrying their own colour, keyword-detected and **deliberately independent
  of the "Colour activities by" field** — these activities routinely have no `work_type`, which is
  what made them vanish under Discipline / Trade. They are injected into `towerWide` (state from
  their own activities) and appended to the per-band iteration, so a floor advances into
  Testing & Commissioning → Handover → Closeout instead of stalling at the last construction trade.
  `stackModel` no longer concatenates `stkPhaseRows()`; the separate "End phases:" legend strip is
  gone too, since the phases are ordinary chips now — keeping either would show the same work twice.
- **Stacking window gets its own "Colour by" switcher.** Switching used to mean closing the window,
  changing it in the Gantt legend and reopening — losing the cut-off month and scope each time. Same
  `catCfg().field`, and it repaints the Gantt behind so the two stay in step.
- **"Overall discipline status" scoped to the stack.** It listed all 438 categories under Activity
  name (the owner's "hundreds of legends"); its original job was surfacing phases with no per-floor
  tag, which now fold into the bands. Falls back to the full set rather than rendering empty.
- **Verified 15/15**: the 4 phases becoming pseudo-categories, keyword (not exact-name) detection,
  ordinary trades not swept in, chronological order, distinct per-phase colours, ⚠️ **a phase with
  NO work_type still becoming a category** (the exact regression), whole-building scope across
  towers, plus **CSS assertions that the lsmoff rule is unscoped and the Tip line is gone**. All 8
  suites green (133 assertions). ⚠️ **Not verified signed-in.** `MODULE_V` → `20260817e`.

## The WBS bracket is now subdivided by activity (2026-08-17) — fmlozano
Owner picked option 2: the white bar itself banded by activity, not a strip beneath it.
- **Segments are now the bracket's CHILDREN**, so every coordinate is relative to the bracket's own
  left edge (`barX`) rather than the timeline origin, and they inherit its `clip-path` — the tapered
  bracket shape survives while its body reads as the trade sequence under that branch.
- ⚠️ **MIN 2px per band.** This was the actual cause of the reported "simple white bar graph": on
  short branches (General Requirements, Site Works — 2-6 day spans) the bands were **sub-pixel at
  Month zoom and simply did not paint**, while months-long branches showed their full composition.
  Nothing was missing from the data; it was rounding to nothing.
- ⚠️ **The rolled-up red %-fill is suppressed when bands are present** — each band already carries
  its own progress, so the red would sit on top of them and describe the same thing twice.
- `.ps-sum-seg` uses `top/bottom:0` rather than a computed height, so it tracks the bracket at every
  row density; the bracket goes 9px → 13px **in LSM mode only**, since there it is the row's content
  rather than a rule. The plain (legend-off) view is byte-identical.
- **Verified 15/15** against the sliced shipped `_sumSegsHTML`: one band per activity, ⚠️ **relative
  positioning asserted directly** (first band at 0, not the 60px an absolute-coordinate regression
  would give), correct offsets for successive activities, the **1-day band still painting at ≥2px**,
  the sub-pixel zoom case that caused the bug, per-band progress, escaping, no stray top/height, and
  the four skip paths (legend off / group row / no wbs / no children). All 7 suites green (118
  assertions). ⚠️ **Not verified signed-in.** `MODULE_V` → `20260817d`.

## End phases missing under Discipline/Trade; legend truly merged (2026-08-17) — fmlozano
- ⚠️ **Closeout / Testing & Commissioning / Handover appeared under "Activity name" but NOT under
  "Discipline / Trade".** `stackModel`'s main loop dropped any row with no value on the colour field
  (`if (!v || !(v in catIdx)) return`). Every activity has a *name*, so the phases survived there —
  but whole-building end-phase activities routinely carry **no `work_type`**, so under
  Discipline/Trade they were filtered out before a band could form. ⚠️ A phase band is coloured by
  its **phase** (purple T&C, orange Punchlisting…), never by the colour field, so that filter never
  applied to it in the first place. Phase-labelled locations now keep their activities in `b.acts`,
  and the phase branch takes its state from `_stkState(b.acts, D)` when the band has no categories —
  without that fallback the row would render but permanently read "not started".
- **Legend merged for real.** The marks were a sibling `<div>` inside the same container, which still
  read as two sections. They are now the **leading entries of the same flex list** as the category
  chips, with a hairline `.ps-alg-sep` between.
- **Dropped "· N more not on this stack"** from the stacking legend. Under Activity name it read
  "· 436 more not on this stack" — a count of things deliberately not drawn, never actionable, and
  competing with the handful of chips that do mean something. Owner reported it as making the stack
  more confusing, not less.
- All 6 suites still green (103 assertions). `MODULE_V` → `20260817c`. ⚠️ **Not verified signed-in.**
- ⚠️ **OPEN:** "white bar per WBS to show even by activity level" is not done — the request has two
  readings and I did not want to guess. `_sumSegsHTML` already draws per-activity segments on every
  summary bar; on General Requirements / Site Works those spans are 2–6 days, so at Month zoom the
  segments are ~2px and the bar reads as plain white. Asked the owner which they mean.

## One legend, an explained empty-branch hide, and a visible "N more" list (2026-08-17) — fmlozano
Three owner asks in one pass.
- **Consolidated the two legends.** The bar-mark key (Activity / WBS summary / Baseline / Milestone /
  Data date) and the activity-category key were separate blocks describing the same chart. The marks
  row is now `MARKS_LEGEND_HTML`, emitted by `renderActLegend()` as the first line of `#ps-actlegend`
  with a hairline under it. ⚠️ The `.lg-lsmoff` marks still hide correctly in LSM mode — the existing
  `#ps-view-schedule.ps-lsm .lg-lsmoff` rule applies unchanged because the row stays in the same
  subtree with the same classes. ⚠️ The static div is retained (now empty) for the one state
  `renderActLegend()` bails out of — no project / no rows — where it would otherwise leave a gap.
- ⚠️ **"Execution Phase only" was NOT broken.** Confirmed against live OPW101: Milestones,
  Initiation Phase, Planning Phase and Closeout Phase hold **0 activities each** (only Execution
  Phase has any — 962). Un-ticking the toggle really did widen the filter; there was simply nothing
  behind it, and **"Hide empty groups" removed those branches silently**, so the toggle looked dead.
  Fixed the legibility, not the filter: the footer now reads **"· 4 empty branches hidden"** and
  names them in the tooltip with what to do about it. `emptyTopBranches()` reads `rows`, not `DL` —
  DL is the post-filter list they are already missing from, so it could never say what went.
- **"N more, not on screen" now shows WHICH.** Hovering opens a panel listing the actual names
  (capped at 80 + "…"), replacing a tooltip that only restated the number. Derived as a set
  difference from the same lists, so it can never disagree with the count. Hover is forgiving — the
  panel stays open while the pointer is over it, so a long list can be read and scrolled.
- **Verified 12/12** against the sliced shipped `emptyTopBranches` on the real OPW101 shape: exactly
  the 4 empty branches named, Execution excluded, only top-level rows considered, a branch counted
  empty even when it holds empty CHILD branches, silence when the checkbox is off, and ⚠️ a
  **dot-anchored prefix test proving "4" does not absorb "41"**; plus the hidden-name set difference
  in all four directions. All 5 earlier suites still green (91 assertions). ⚠️ **Not verified
  signed-in.** `MODULE_V` → `20260817b`.

## Data cleanup executed across ALL projects (2026-08-17) — fmlozano
Owner signed off: "Let's do a complete clean for all projects." Run against live via the Management
API. ⚠️ **Full backup taken first: `wbs_summary_backup_20260817` holds all 103,548 pre-clean
WBS-Summary rows** — the whole operation is reversible from that table.

Scope was bigger than the OPW101 sample implied: 103,548 summary rows, of which 42,988 *correctly
linked* rows still sat at a duplicated `wbs` code (SLT101 alone), plus 423 foreign-project links,
460 orphans and 35,168 null-linked.

Three steps, in order:
1. **Deleted pure contamination** — foreign-project-linked summary rows with **no activities under
   them**. ⚠️ Checked first rather than assumed: of OPW101's 421 foreign rows only **4** held real
   activities, so 417 were another project's structure grafted in with nothing beneath it.
2. **Cleared the bad link (kept the row)** on the handful that DO head real activities — deleting
   those would have left live activities with no branch header.
3. **Deduped to one summary row per `(project_id, wbs)`**, preferring a row correctly linked to that
   project, then earliest.

Result: **103,548 → 60,297** rows; **0** duplicated codes; **0** foreign links. Per project:
SLT101 57,672→14,849 · OPW101 709→285 · GPR101 8,692→8,690 · XERTEST 14,503→14,501. Every other
project untouched, AVR101 (the contamination *source*) included.
⚠️ A verification column counting "activities whose `wbs` has no matching summary row" came back
huge — and is **meaningless**: untouched projects (CP104, DEMO01, AVR101) score identically, because
activities carry codes below their branch header. It is not evidence of orphaning.
⚠️ This is cleanup only. It would refill without the writer fix shipped in `20260817a`.

## ⚠️ CROSS-PROJECT CORRUPTION: one project's WBS nodes written into another (2026-08-17) — fmlozano

Diagnosed LIVE against OPW101 (Management API, read-only). My two earlier theories were both WRONG
and the live data disproved them:
- NOT duplicate WBS nodes. OPW101's node tree is **clean**: 11 nodes, each projected **exactly once**.
- NOT the `is_locked` gap I flagged as a caveat. There are no duplicate node names at all.

**What is actually there:** 709 WBS-Summary rows for 11 nodes —
`421` whose `wbs_node_id` belongs to **AVR101**, `277` with a NULL `wbs_node_id`, `11` correct.
Only 7 collide on a `wbs` code (4, 4.1, 4.1.1, 4.2 ×3, 4.2.1, 4.3.5), which is why just a handful
show as visible duplicates — the rest is Avesta's structure (B3, Z6, F5, Tower 1, Ground Reservoir)
silently grafted into One Portwood's tree.

**Cause — `pid` is not pinned across awaits.** `_wbsEnsureSummariesInner` makes dozens of
round-trips, while `pid` and `WBS_NODES` are module-level and BOTH move on a project switch. The
insert read `project_id: pid` fresh each iteration while `n` came from the `WBS_NODES` captured
before the loop, so a switch mid-run stamped the NEW project's id onto the OLD project's nodes.
⚠️ The `_ensuringSummaries` re-entrancy guard does **not** cover this — it is a single run whose
`pid` changes underneath it, not two overlapping runs.

⚠️ **Why every integrity check passed and refresh never helped:** the existence probe fetches by
`.in('wbs_node_id', <this project's ids>)`, which matches neither a foreign project's node id nor a
NULL. So the healer cannot see the bad rows, and its invariant ("each node has exactly one summary
row") is *genuinely true* the whole time. The duplicates hang off ids it never asks about.

**Fixed (writer only):** pin `ownPid` + `ownNodes` at entry; use them for every query and insert;
re-check for a switch on **every iteration** (not once before the loop — each iteration is its own
round-trip); skip the in-memory `rows` mutation on a switch, since `rows` then belongs to the new
project. `MODULE_V` → `20260817a`.

⚠️ **NOT cleaned up — needs explicit sign-off (destructive).** Known scope, whole DB:
`SLT101` **42,823** excess summary rows, `OPW101` 7 (plus 421 foreign-linked), `XERTEST` 2, `GPR101` 1.
Proposed cleanup is to delete summary rows whose `wbs_node_id` points at a node in a *different*
project, then re-dedupe by `wbs` code. ⚠️ The 277 NULL-linked rows must NOT be blanket-deleted —
import-created structure can legitimately have no node id; only code-duplicates among them should go.

## Duplicate WBS rows on every refresh: the dedupe healed ONE LEVEL per call (2026-08-16) — fmlozano
Owner on One Portwood (OPW101): *"Refreshing the project schedule bugs out with having duplicated WBS
rows."* Screenshot: Execution Phase ×2, General Requirements ×2, Site Works ×2.
- ⚠️ **`_wbsDedupeSkeleton` keys duplicates by `(parent_id, name)`** — so two fully-seeded skeletons
  (two racing page loads, the scenario the function exists for) only ever collide at the **ROOTS**.
  Every child sits under its **own** root, so "General Requirements" under root A and under root B
  are *different keys* and are invisible to the pass. The pass then re-points B's children onto A —
  **which is the moment they become duplicate siblings** — but `dupes` was computed before that and
  the function returns.
- ⚠️ **Net effect: exactly one level collapsed per call**, and `load()` calls it once. So every
  refresh healed the next level down and `_wbsEnsureSummaries` faithfully projected a fresh crop of
  duplicate summary rows for the newly-exposed level. The bug *looked* like refresh causing
  duplication; refresh was actually the (partial) repair, surfacing the next layer each time.
- **Fix: run to a fixed point** — loop the pass until one heals nothing (guard 24, ~tree depth). A
  healthy tree exits after a single pass, so the normal cost is unchanged. The existing pass body is
  untouched and now lives in `_wbsDedupeSkeletonPass`.
- ⚠️ Deliberately **did not** widen the `is_locked` filter. Two same-named siblings under one parent
  are always wrong, but non-locked nodes come from imports and merging those is a data decision, not
  a repair — out of scope for the reported bug.
- **Verified 16/16** against the sliced shipped functions with an in-memory DB seeded to the exact
  OPW101 shape (two 5-node skeletons, 4 levels deep): all 10 nodes collapse to 5, the merge count is
  5 (**the old single-pass code could only ever report 1**), it provably takes more than one pass,
  the surviving chain keeps its parent/child structure, the **earliest** node survives each merge
  (activities are filed against it), the DB agrees with memory, and re-running on a healthy tree is a
  no-op costing one pass. ⚠️ **Not verified signed-in**, and ⚠️ **I could not query OPW101** to
  confirm its duplicate nodes carry `is_locked` — if they came from an import instead, this fix will
  not reach them and the dedupe scope is the next thing to look at.

## "· N not in this view" reworded (2026-08-16) — fmlozano
Owner asked what it meant. It was jargon ("categories" the user never named) and the tooltip listed
causes without saying what the number *was*. Now reads **"· 7 more, not on screen"**, and the tooltip
names the field in the planner's own words via `_catNoun()` ("activity names" / "disciplines /
trades" / "activity types") and states the actual meaning: they exist on the project, but none of
their activities are among the rows on screen, so there is nothing for them to key — usually a
collapsed branch. ⚠️ Suppressed entirely when a curated key set is active (`_hidden = 0` there),
since "not on screen" would then be conflated with "not keyed", which is a different thing.

## Curated KEY TRADES — the LSM discipline, not a bigger legend (2026-08-16) — fmlozano
Follow-on from the legend-scoping fix: with "Execution Phase only" honoured the legend fell 438 → 79,
but 79 is still not a key. ⚠️ **The remaining entries were CORRECT** — Mobilization, Temp. Facil.,
Manpower Loading, Safety Provisions etc. sit under **General Requirements, which is a child of
Execution Phase**. Nothing was leaking; "Execution Phase" is simply broader than the construction
work the owner pictures. Owner chose to curate rather than redefine the toggle.
- The reference P6 LSM layout keys ~17 trades and its own slide says why: *"Not all activities can or
  need be shown in the LSM Layout… Choose only those activities that are with great importance and
  impact."* So the fix is **fewer keyed activities**, not more legend.
- **`cfg.keys[field]`** — a curated set stored **per field**, because Activity name (438 values) and
  Discipline/Trade (6) have different vocabularies and curating one must not blank the other.
  ⚠️ **Empty/absent = not curated = every category keyed**, i.e. the exact old behaviour, so nothing
  changes until the planner opts in.
- ⚠️ **Palette index counts KEYED entries only.** A curated 15 now gets 15 consecutive, distinct
  palette+texture slots instead of arbitrary positions in a 438-entry list where two chosen trades
  could collide after the palette wraps. This is safe here — and explicitly NOT safe for
  `catVisibleValues` (see its warning) — because a curated set is **explicit and stable**: it moves
  only when edited, never on expand/collapse. The curated list is stored in `catList()` order
  (chronological), not click order, so the palette runs with the sequence of the work.
- Unkeyed work **still draws**, in neutral grey (`CAT_MUTED`), and drops out of the legend. It is not
  hidden — it just stops competing for the eye.
- **"Key trades…" picker** in the legend header: search, activity counts, **Top 15 by activity
  count** quick pick (the closest proxy the schedule has for "importance and impact"), Clear all.
  ⚠️ Offers only categories the **current view admits** (`catScopedValues`) — curating against
  Bidding-phase names while "Execution Phase only" is on would key trades that can never draw.
- **Verified 22/22 against the SHIPPED functions** (`catCfg`/`saveCatCfg`/`catKeySet`/`catKeyList`/
  `saveCatKeys`/`catList` + the real `CAT_PALETTE`/`CAT_TEXTURES` sliced out): uncurated behaviour
  unchanged, mute flags both ways, neutral grey + no texture on muted, **keyed entries landing on
  consecutive distinct palette slots and distinct textures**, the legend filter, **cache
  self-invalidating on a key-set change** (a stale hit would ship the old colours), per-field
  isolation both directions, and clearing returning to key-them-all. ⚠️ **Not verified signed-in.**

## Legend ignored "Execution Phase only" whenever the outline was collapsed (2026-08-16) — fmlozano
Owner: *"I ticked on Execution Phase only but legend still shows activities from other phases."*
Screenshot: WBS collapsed to 4 summary rows, legend full of Bid Kick-Off Meeting / Site Visit /
Contract Review + **"+398 more"**.
- ⚠️ **A comment asserting an invariant that was never true.** `renderActLegend`'s fallback
  `if (!list.length) { list = _all; _hidden = 0; }` carried the note *"Only reachable when the
  schedule renders no rows at all (filtered to nothing)"*. **It is reachable whenever no LEAF task
  row is on screen** — i.e. the ordinary collapsed outline — because `catVisibleValues()` only
  collects from `_dkind === 'task'`. Collapse the tree and it returns `{}`, the filter yields an
  empty list, and the fallback then printed `catList()`: **every category in the project**,
  ignoring `_execOnly` and every active filter. The scoping work from e211b5d/fc67cae was intact;
  this one line threw it away in the most common state.
- **Fix: `catScopedValues()`** — the categories the current view admits, mirroring `buildNodes()`'
  own scoping (the `_execOnly` carve-out `r.wbs === ec || locCodeUnder(r.wbs, ec)`, plus
  `rowMatches` for filters), independent of what is expanded. A collapsed outline *does* stand for
  its subtree, so falling back is right — but it now falls back to what the **view** admits, never
  to the raw project. The final `list = _all` guard survives only for "filtered to nothing", so the
  legend never goes blank.
- **Verified 13/13** against the sliced shipped `catScopedValues` with the fallback chain replicated
  verbatim, on an Avesta-shaped Execution/Bidding split: the regression asserted directly (collapsed
  + exec ON no longer prints the project), exact Execution-only membership, no Bidding leakage, the
  "not in this view" count, expanded leaves still winning outright, exec-OFF behaviour unchanged,
  and filtered-to-nothing still falling back rather than blanking. ⚠️ **Not verified signed-in.**

## End phases never appeared in the stack, tagged or not (2026-08-16) — fmlozano
Owner: *"Closeout phase, Testing & Commissioning, Punchlisting & Handover is not appearing in the
vertical stacking even when tagged."* Correct, and it was broken in **both** single-tower and
"all towers" mode.
- ⚠️ **Root cause: a whole-building phase has NO tower value, and every model run pins one.**
  `stkInScope()` walks the levels ABOVE the stacked one and demands a match; the scope is pinned to
  a tower (the grid pins one per column via `stackModelForTower`), the phase row's tower value is
  blank, and `'' !== 'Tower 3'` → rejected. For **every** tower. So the phase rows silently
  vanished no matter how they were tagged.
- ⚠️ **Both tagging paths died on the same check**, which is why "even when tagged" didn't help:
  an **untagged** phase goes through `stkPhaseRows()`, a phase the **"Tag phases…" wizard wrote**
  carries the phase label as its *Level* value and so arrives through `stackModel()`'s main loop
  instead — and both call `stkInScope` first.
- ⚠️ **The workaround was already in the file, applied to the wrong half.** `renderStackView`
  deletes `_stkScope[parentLvl.id]` before computing the *legend's* phase swatches — someone had
  already hit this and fixed it for the legend only. The model never got the same treatment.
- **Fix: `stkPhaseInScope()`, used for end phases only.** A **blank** value at the immediate parent
  level means "whole building" → in scope everywhere. A value that IS present must still match, so
  a genuinely tower-tagged phase stays on its own tower. Levels **coarser** than the immediate
  parent are unchanged, so one site's phases never leak into another's. Ordinary floors keep the
  strict `stkInScope` rule untouched. In the grid a whole-building phase now renders across every
  tower column with the same state, which is what "whole building" means (the tooltip already said
  so). `stkTowerWideCats` needed no change — it already excludes phase-named rows by design.
- **Verified 16/16 in Node against the SHIPPED functions** (`stkInScope`/`stkPhaseInScope`/
  `stkPhaseByLabel` + the real `STK_PHASES` sliced out, sanity-gated): the regression asserted
  directly (old rule excludes, new rule admits), in-scope for all 7 tower columns, tower-tagged
  phases still scoped to their own tower, cross-site leakage still blocked, blank-at-a-coarser-level
  still blocked, ordinary floors unaffected, the `stackModel` gate expression, all 5 canonical phase
  labels round-tripping, and the exact-label guard that stops a floor named "Testing Floor" being
  taken for a phase. ⚠️ **Not verified signed-in.**

## Stacking legend scoped to the stack + click-a-chip band highlight (2026-08-16) — fmlozano
Owner, from the "all towers" stack on AVR101: *"with this amount of activities there might be
confusion as to what activity is it referring to. Having difficulty determining which activity from
the whole bunch of legend activities in the list."*
- ⚠️ **The legend was listing EVERY category in the project.** `renderStackView` built it from the
  full `catList()`, so a 4,393-activity schedule produced a wall of ~50 visible chips (many
  truncated to "…") — and the screenshot shows the giveaway: Bid Kick-Off Meeting, Site Visit,
  Contract Review, Bid Submission. **Planning-phase work that can never colour a floor of a tower.**
  The reader had to find the right entry among mostly-irrelevant ones.
- ⚠️ **A band is coloured by exactly ONE category** — `b.cur`, its WIP-or-last-done (`stackModel`
  line ~16151). So every other category in the list is unreferenced by anything on screen. The
  legend now lists only the categories that actually colour a band, keeping `catList()`'s
  chronological order, plus an honest "· N more not on this stack" tail so the omission is visible
  rather than silent.
- **Click a chip → every band it is responsible for stays lit, the rest dim to 22%** (+ a red ring,
  so a lit band reads even against a pale fill). This is the actual answer to "which band is this?"
  in the multi-tower grid, where a band has **no text label of its own** — there is no room for a
  text column per tower, so it only ever had a tooltip. Click the same chip again, or "Clear
  highlight ✕", to reset.
  ⚠️ Bands carry `data-cat` (`stkCatKey`, which falls back to `.label` because a **phase** row's
  `cur` is a phase object with no `.value`). ⚠️ The highlight is **local view state on the modal's
  own DOM** — deliberately not wired into the Gantt's `toggleCatHighlight`, so closing the stack
  can't leave the schedule behind it filtered.
- **Verified 24/24 in Node against the SHIPPED functions** (`stkCatKey`/`stkBandHTML`/
  `wireStackLegend` sliced out, not stubbed — a sanity gate fails the run if a name is missing):
  key extraction incl. the phase-label fallback and null-safety, `data-cat` stamping + escaping +
  tooltip retention, scoping 50 categories down to the 3 on the stack with dedupe and order
  preserved, the nothing-started empty case, and the full highlight cycle (light, switch chips,
  re-click to clear, Clear control) asserting that other-category and not-started bands are never
  lit. Inline script parses; 0 function definitions lost. ⚠️ **Not verified signed-in.**
  `MODULE_V` → `20260816b`.

## Audit: two more silent 1000-row truncations (2026-08-16) — fmlozano
Fresh audit cycle. `weekly_commitments` (Last Planner) was read with a bare `.select()`:
`loadLPAll()` loads **every week of the project's life** to drive the PPC trend and the
reasons-for-variance Pareto, and a Last Planner project accrues commitments weekly (20/wk × 150wk
≈ 3,000 rows) — past the 1000 cap, so the **earliest weeks would silently vanish from the trend**.
Now `PDb.selectAll` + an explicit in-memory re-sort by `week_start` (the helper returns id order,
and every reader here assumes chronological). The existing `try/catch → LP_ALL = []` tolerance is
preserved, since `selectAll` throws rather than returning `{error}`.

## Baseline stopped reading as a second activity; bar colours are now theme-aware (2026-08-16) — fmlozano
Owner: *"Is the other colour of the rebar works its actual progress while the other is planned? It
doesn't look intuitive that two bar graphs signify the same activity… rather it shows these are two
different activities."* Plus: bar colours should be sensitive to light and dark mode.
- ⚠️ **The two-bars complaint was real and it was the BASELINE.** With `_gset.baseline` on, an
  activity drew **two solid bars of EQUAL height** — planned above, current below — with nothing
  about either saying one is the plan for the other. Read literally, that is two activities on one
  row. The baseline is now a **thin ghost rail (5px, 62–70% opacity, no shadow) tucked under the
  current bar**, which keeps the visual weight (asserted ≥3× the rail). The slip is then the offset
  between their left/right edges — the standard P6/MSP reading — instead of a stacked pair.
  Same change to the WBS **roll-up** baseline, which had the identical problem one level up.
  ⚠️ The summary bar's own top no longer shifts by whether a baseline exists (`sumTop` was
  `top + (blsp ? o12 : o8)`), so a branch doesn't jump when a baseline is captured. `o12` died with it.
- ⚠️ **Dark mode was the real colour failure, and it was invisible rather than merely low-contrast.**
  `CAT_PALETTE` is fixed hex; `#1F4E79` / `#8B0000` / `#375623` sit at **~0.05 relative luminance**
  against a near-black card. New **`catShade()`** pulls a colour into a readable band **for the active
  theme at RENDER time only** — the stored/user-picked hex is never rewritten, so a theme flip cannot
  silently change a project's saved colours and the legend's colour inputs still show what the planner
  chose. Measured: all five dark palette entries lift above 0.12; a colour already in range is
  returned untouched.
  ⚠️ **The light-mode correction is deliberately gentle** (threshold 0.68, cap 0.35) — a first cut at
  0.62/0.55 turned a pale yellow into muddy olive, which is worse than the washing-out it fixed.
  **No palette entry trips it at all** (asserted), which is the honest statement of where the bug was.
- ⚠️ **Textures were hardcoded `rgba(255,255,255,…)`** — a white hatch is invisible on a pale bar.
  `CAT_TEXTURES` now carries a `%C%` placeholder and `catStyle()` substitutes white or black by the
  **shaded** colour's own luminance. `catTint()`'s default alpha is theme-dependent too (0.22 light /
  0.34 dark): 0.26 over a dark card is barely distinguishable from the empty row behind it.
- ⚠️ **Bar colours are inlined into the row HTML at render time** (they have to be — every row can
  carry a different category colour), so unlike a CSS var they do NOT re-theme on a toggle. A
  `MutationObserver` on the `<html>` class that shared `theme.js` flips drops both colour caches and
  repaints. `catList`'s cache key gained the theme for the same reason — `c.style` is a rendered
  style string, so a cache hit across a flip would hand the legend the other theme's colours.
- **Verified 23/23 + 20/20 in Node against the SHIPPED functions** (`CAT_TEXTURES`…`catTint` and
  `ganttRowHTML` sliced out, not reimplemented): luminance lift per palette entry, both no-op cases,
  overlay polarity in both themes, every texture substituting, theme-dependent + explicit alpha,
  garbage input; and rail-below-bar, thin-rail, weight ratio, adjacency, in-row containment, the old
  equal-height stack as an explicit regression case, no-baseline and LSM suppression, summary-top
  stability, and compact density. Inline block parses (1 block, 0 fail).
  ⚠️ **Two test failures were MY assertions, not the code** — comparing `_rgbHex` output case-sensitively,
  and a `catEntry` stub returning null even with the legend on, which tests a state that cannot occur.
- ⚠️ **Not verified signed-in.** `MODULE_V` → `20260816a`.

## Location matching scoped to Execution Phase only (2026-08-06) — fmlozano
User: location/zone describes construction, so the Location Wizard (and grouping by a location
level) must not touch activities outside the Execution Phase WBS branch.
- **New `execPhaseCode()` / `locCodeUnder()` / `locExecScopedActs()`.** `execPhaseCode()` locates
  the skeleton's locked top-level "Execution Phase" WBS-Summary row and returns its dotted code;
  `locCodeUnder(code, ancestor)` is the boundary-safe prefix test (`"4"` matches `"4.1"`, never
  `"40.1"`). `locExecScopedActs()` is the shared entry point both write paths now call instead of
  scanning every activity with a WBS code.
- **Both writers scoped:** `openLocWizard()` and `openLocBackfill()` ("Fill location from the WBS
  tree…") now only scan/match/write against Execution-Phase activities — a name like "Design
  Review" under Planning Phase can never be offered a Tower/Level/Zone value, and Apply can never
  write `location` onto a non-construction activity. The wizard's own description text says so.
  When the project has no Execution Phase branch (skeleton not seeded / pre-dates it), warns and
  falls back to the whole schedule rather than silently doing nothing.
- **Grouping scoped too, not just writing.** Follow-up in the same prompt: grouping by a location
  level (`Location > Zone > Activity` or `Activity > Location > Zone`) was still bucketing
  Initiation/Planning/Milestone activities into an "— Unassigned —" location group alongside real
  Execution-Phase work — visually mixing phases that have nothing to do with location. `buildNodes()`
  now carves non-Execution-Phase activities out of the location-dim walk and renders them as their
  own top-level group ("— Other phases (not location-grouped) —"), always by their own WBS path
  regardless of the chosen dims — visible, never lost, never mixed into a location bucket. Only
  triggers when the active `groupBys` actually include a `loc:` dimension; every other grouping
  (Status/Type/Work Package/Activity Codes/plain WBS) is untouched.
- Verified: inline script (`new Function`) parses clean. **Not browser-verified against a live
  login** — same environment constraint as the rest of this session's work on this module.

## Location Wizard: real fix for the modal's horizontal overflow, plus bulk-assign audit (2026-08-06) — fmlozano
User reported the "Match the WBS to your location breakdown" wizard (`openLocWizard`) was scrollable
and wanted the popup to show whole, then reported it was "still the same" after a first attempted fix.
- ⚠️ **Root cause, found by reading `UI.modal()` rather than guessing again after the first fix
  looked right but didn't help:** `UI.modal()` always wraps caller HTML in its own `<div
  class="pd-modal">`, and the shared stylesheet caps that element at `max-width:520px`. Because that
  same element also has `overflow-y:auto`, CSS computes its `overflow-x` to `auto` too. The wizard's
  first attempt only set a width on an INNER div — a child of that still-520px box — so the wide
  content overflowed it, and since the whole `.pd-modal` became one scrolling region, the header and
  buttons scrolled sideways along with the table instead of staying put.
- **Real fix:** after `UI.modal()` returns, grab the actual `.pd-modal` element
  (`m.el.querySelector('.pd-modal')`) and set its `style.maxWidth`/`overflowX` directly — an inline
  style always wins regardless of the class rule's specificity. The inner div now just fills that box
  (`width:100%`) instead of fighting it with its own competing width.
- ⚠️ **Why the first attempt never showed up live:** this repo (`planning-app`) is a git repo tracked
  against `origin/main`, which is what GitHub Pages deploys from — but the first fix was only ever
  saved to the local file, never committed or pushed. "Still the same" was accurate: the live site
  hadn't changed at all. This prompt's fix is committed + pushed.
- **Wizard audit (previous prompt, same session):** fixed a real inconsistency where "Assign all
  shown to…" (bulk level-assign) skipped the value re-clean that the per-row level dropdown does,
  leaving a stale/uncleaned value under the newly assigned level; removed a dead `s.touched` flag;
  added a full-text `title` tooltip on the truncated ancestry trail; added a "N names shown" hint next
  to the bulk controls so it's clear which rows a bulk action will affect.
- Verified: inline script (`new Function`) parses clean. **Not browser-verified against a live login**
  — this environment has no session for the deployed app; verification here is static/parse-level plus
  reasoning through the actual `.pd-modal`/`UI.modal()` CSS cascade, not a rendered screenshot.

## Autosave added to the Add/Edit Activity modal (2026-08-06) — fmlozano
Extended the shared autosave pass (`assets/js/autosave.js`, wired into 5 other modules the same
prompt) to this module's Activity modal — the one place here that didn't fit the shared helper.
- ⚠️ **This modal isn't `UI.modal()`-based** — it's a static `#ps-modal` overlay shown/hidden via
  `style.display`, and `save()` is a bare module-scope function that unconditionally calls
  `closeModal()` (hides the modal + clears `editId`) on success. The shared `Autosave.wire` trick
  (temporarily no-op `modal.close`) doesn't apply — there's no object whose `.close` property
  `save()` calls through. So autosave here is a **small inline implementation** instead of the
  shared helper: a debounced (1.2s) `_asSchedule()`/`_asFlush()` pair that calls the existing
  `save()` directly, then **reopens the modal and restores `editId`** immediately after
  `closeModal()` ran inside it — same end effect (modal stays open, edit continues) via a different
  mechanism suited to this modal's shape. `UI.toast` is monkey-patched to a no-op for the duration
  of the tick so "Activity updated." doesn't fire on every autosave.
- **Edit only** — `_asSchedule()` no-ops when `editId` is null (a new, not-yet-inserted activity).
  `closeModal()` now also cancels the pending autosave timer, so cancelling/closing the modal can't
  fire a stray save afterward.
- Status badge `#ps-modal-autosave` beside the modal title (reuses the shared `.pd-autosave` CSS
  from `dashboard.css`), shown only when editing.
- Verified: inline script (`new Function`) parses clean. **Not browser-verified** — auth wall, same
  as the rest of this module's recent work.


## Documents tab removed (2026-08-05) — fmlozano
Both registers dropped the per-document → activity link, so nothing can author one any more and this
tab would be **permanently empty** — exactly the "empty promise" the Design Development node was
before it got a real writer. Removed the tab button, its render dispatch, the `DOC_DRAWINGS` /
`DOC_SUBMITTALS` lazy loads, and `detDocs` / `wireDocs` / `docsFor` / `docReadiness` / `_docChip` /
`_docApprovedDr` / `_docApprovedMs` / `_docLeadDefault`.
- **`syncDesignDevelopment()` is now the ONE connection** between this module and the two registers:
  progress flows register → schedule, and those rows are read-only here.
- ⚠️ Two fewer cross-module queries in `loadResourcesAssignments()` on every project load.
- ⚠️ `project_schedule` never stored the link (it lived on the register rows), so there is nothing to
  clean up here; the register-side columns are left in the DB unused.
- Verified: inline script parses, 0 leftover references, the DD sync intact.
  ⚠️ Not verified signed-in. `index.html` isn't cache-busted — hard-refresh.

## Design Development is now actually populated from the two registers (2026-08-05) — fmlozano
⚠️ **The 2026-08-03 skeleton entry's deferred item is now built.** That pass created the Design
Development node, locked it, labelled it "synced from Drawing Register + Material Submittal Log" and
blocked manual adds — but **nothing ever populated it. Zero writers.** The label was a promise the
code didn't keep.
- **`syncDesignDevelopment()`** (called from `load()` after `_wbsEnsureSummaries`, so the DD node and
  real dotted codes exist) mirrors both registers into the branch: two locked child nodes —
  **Drawing Register** / **Material Submittal Log** — each with one activity per discipline carrying
  `percent_complete`, `start_date` (min planned approval) and `end_date` (max actual once every item
  is approved, else the commitment).
- ⚠️ **Idempotent by deterministic `activity_id`** (`DD-DWG-<slug>` / `DD-MAT-<slug>`): a re-sync
  patches in place, writes only changed fields, and deletes rows for disciplines that vanished. This
  is deliberately the shape that avoids the duplicate-projection bug `_wbsEnsureSummaries` had to heal.
- ⚠️ **Drawings count SHEETS, submittals count ITEMS** — different measures, kept as separate
  branches rather than summed. The drawing side mirrors the register's own `approvedOf()`: a
  single-sheet drawing is approved by its **status**, not its counter.
- ⚠️ **`.is('parent_id', null)`** excludes the register's per-sheet child rows — their counters are
  already inside the parent drawing's, so counting both double-counts the register.
- ⚠️ **Tolerant throughout** — any failure leaves the branch untouched rather than blocking the load.
- **`isSyncedRow(r)`** gates `beginEdit`: a mirrored row can't be edited here, because the next sync
  would silently overwrite it. A node's own WBS Summary row is NOT gated (it is real structure).
- **This is the opposite direction to the Documents tab.** Design Development = the register IS the
  work (progress flows register → schedule). Execution Phase = a document ENABLES the work (the date
  flows schedule → register). Both registers now warn when a document is linked to a non-Execution
  activity — see `modules/drawing-register/CLAUDE.md`.
- **Verified 36/36** in a Node harness over the shipped `_ddAggregate`/`_ddSlug`/`_ddValidDate`/
  `isSyncedRow` (sliced, not reimplemented). Inline script parses. ⚠️ **Not verified signed-in** — no
  live sync has run. `index.html` isn't cache-busted; hard-refresh to pick it up.

### Live verification on BAU101 (2026-08-05) — 1 real bug found
First live sync, signed in. BAU101 had the skeleton's **Design Development node at `3.2` with zero
children** and 0 generated rows; the sync created the `Drawing Register` child node and **11
discipline activities**.
- ⚠️ **REAL BUG FOUND AND FIXED — zero-duration bars.** `end_date` fell back to `minPlan`, so
  `start === finish`. Architectural's planned approvals actually span **2025-03-18 → 2026-05-11** and
  the row rendered as a **single day on 2025-03-18**. The finish is now the **latest** planned
  approval (the commitment to have the whole discipline approved), replaced by the last actual once
  every item lands. Re-verified live: Architectural `2025-03-18 → 2026-05-11`, Structural
  `2024-12-06 → 2025-02-28`.
- **Idempotency proven on live data:** the second sync left **11 rows, not 22** — it patched in place.
- **Reconciles exactly with the register.** All 11 disciplines match the Drawing Register's own totals
  computed with the same `approvedOf()` rule (539 of 1,257 sheets, 43%); 0 mismatches.
- **Read-only guard confirmed:** double-clicking a synced row's name opened no editor and toasted
  *"This row is synced from the Drawing Register / Material Submittal Log — edit it there."*
- **Material Submittal Log node correctly absent** — BAU101 has 0 submittals, and the sync only
  creates a branch when there is data.
- **Need-by scoping proven both ways** by temporarily linking two drawings and reverting: one to a
  real Execution activity (`4.6-A1030`, start 14-Sep-26) → **"Aug 15, 2026"**; one to
  `DD-DWG-ARCHITECTURAL` → **"✕ Not execution"** with the explanatory tooltip. The picker tagged
  **11 of 20** offered activities as non-execution while still allowing them.
- **Cleanup:** both test links removed (BAU101 and GPR101 back to 0 linked documents). ⚠️ The Design
  Development branch itself is **left in place on BAU101** — that is the feature working, not test data.

## Location Wizard — match the detected WBS to the location levels (2026-08-05) — fmlozano
User: rather than describing the values with keywords, let the planner **match what the importer
detected**. Group menu → **Match WBS to locations…** (`openLocWizard`).
- **Matching is by WBS node NAME, not by node.** Measured first: the same name recurs under every
  tower and trade (Avesta's `9th Floor` sits under 7 towers × 3 trades), so a name is **one** decision
  instead of twenty-one, and it survives a re-import that renumbers every node id. Distinct ancestor
  names are only **160 (Avesta) / 127 (Jab) / 365 (Caticlan)**, and names appearing at more than one
  depth are rare (Jab 0, Caticlan 10, Avesta 19), so a name's meaning is stable enough to key on.
- **The planner confirms, not types.** Each row is a detected name + how many activities sit under it
  + its ancestry trail (so you can see *where* it sits) + a level dropdown + **the value to write**,
  which is editable. Pre-classified by `locGuessLevel`; sorted by activity coverage so the
  high-impact names come first; search (matches the name **and** the trail, so searching a branch
  finds everything under it), a Proposed/Not-matched/All filter, and bulk assign-all-shown.
- ⚠️ **Two pre-fill defects found by testing against the real files, not by reading:**
  (1) Jab's towers are `Tower A - Superstructure` etc., so the pre-filled VALUE repeated the work
  and split one tower in two — the value is now pre-cleaned through `locTrimSeg`, giving **34 names →
  17 clean tower values**. (2) `Cluster 1 (TD, TC, TE and TF) of Superstructure` — a cluster of
  *towers* — was classified as a **Level** because it contains "Superstructure". `locTermHit` now
  picks the level whose term appears **earliest** in the name: the head of a name says what the thing
  IS, so "Cluster" at position 0 beats "Superstructure" at 24, and `Tower D - Substructure` is a
  Tower for the same reason.
- **Trade variation needs no per-trade config** (the user's chosen model: one level set, deepest
  wins). Tagging `Superstructure`/`Substructure` as Levels means a structural activity under
  `Superstructure › 9th Floor` still resolves to **9th Floor** (deepest), while one under
  `Substructure › Foundation` falls back to the structure part. Verified as three explicit cases.
- **Reuses the whole existing pipeline:** the wizard only builds a name→value table per level and
  hands it to `locSrcsAssigned` → `locMapPlan` → `locPreviewHTML`. So the spelling merge, the
  distinct-value preview and the write path are shared with the importers and the backfill — nothing
  forked.
- **The matching is remembered** in `location_levels.match` (migration
  `../../migrations/2026-08-05-location-level-match.sql`, **USER MUST RUN**), so it is re-runnable
  and editable rather than one-shot, and a re-import can reuse it. ⚠️ **Tolerant:** without the
  migration the values are still applied and only the memory is lost — it warns rather than fails.
- **Out-of-the-box coverage from the pre-fill alone:** Avesta **Tower 91.8% / Level 82.4% / Zone
  27.7%** (46 of 160 names proposed); Jab **Tower 99.3% / Level 99.3% / Zone 99.3%** (61 of 127).
  ⚠️ Jab's Zone figure is **inflated**: the five `Cluster N (…) of Superstructure` nodes are tower
  clusters, not zones, and the planner should set them to "not a location" — exactly the correction
  the wizard exists for.
- **Verified 15/15 in Node** over the real Avesta + Jab trees (scan counts, review-list size, clean
  tower values, and the three trade-variation cases) and **32/32 in a real browser** driving the
  actual wizard end-to-end — pre-classification, the pre-cleaned value, one row for a name recurring
  under two trades, level-change re-cleaning the value, search/filter/bulk, the debounced preview,
  and **Apply**, asserting the exact `location` written for each activity plus the saved per-level
  matching. ⚠️ Three browser assertions failed first and **all three were my assertion** — search
  matching the ancestry trail is deliberate, and my bulk-assign step had cleared `9th Floor` because
  its trail contains "Works". Other suites (24/18/33/27) and the 9-file regression still green.
  ⚠️ Not verified signed-in.
- **Open question the user flagged:** whether walking the WBS tree would be more practical on
  multi-tower projects. Names-with-trail-context ships first so it can be judged against real data;
  a tree view remains a possible addition rather than a replacement.

## Spelling merge for location values (2026-08-05) — fmlozano
User's explicit call after the duplicates were flagged: merge differently-spelled values of the same
location automatically. ⚠️ **Deliberately lossy** — two genuinely different names that normalise
alike WILL be merged. The trade-off was raised, the user confirmed, and the preview names every merge
so it is visible rather than silent. Correcting the WBS is still the real fix.
- **`locNormKey`** folds case, spacing/joined words (`Roof Deck` = `Roofdeck`), punctuation, and
  worded↔numeric ordinals incl. the typo forms actually present (`Nineth`→9, `Eight`→8). It does NOT
  fold different numbers, different words, `8th` vs `18th`, or `Ground` vs `1st`.
- **Merging lives inside `locMapPlan`** — it needs the whole value SET per level, so it resolves in
  one pass up front. Both importers, the backfill and the preview therefore agree **by construction**
  rather than by three call sites remembering to do the same thing.
- ⚠️ **`locSpellRank` — choosing the winner by frequency picked the WORST spelling on real data.**
  It kept Avesta's typos (`Nineth Floor`, `Eight Floor`) over `9th`/`8th Floor`, and Jab's `Roofdeck`
  over `Roof Deck`, because the sloppy spelling happened to be commoner/shorter. The winner is now
  chosen on legibility first — a variant containing a **digit** (also making the grid's natural sort
  order 2/9/10 correctly, where `Ninth`/`Tenth` sort alphabetically), then more word separators, then
  more Title-Cased words, then frequency/shortest/alphabetical as a deterministic tail.
- **Measured on the real trees:** Avesta floors **26 → 13 values**, now reading
  `2nd … 12th Floor | Ground Floor | Roof Deck` (was a mix of `Eight Floor`, `Nineth Floor`,
  `Ground floor`); Jab **7 → 6**, keeping `Roof Deck`. Towers and zones were already clean and are
  untouched, and **coverage is unchanged** — only spellings collapse, no activity gains or loses a
  location.
- **Verified 27/27 in Node** over both real trees (what merges, what must NOT merge, the spelling
  choice, order-independence — reversing the row order yields the same kept spelling — and that the
  reported `keep`/`dropped` match what is actually written), plus **9/9 in a browser** on the preview
  note. The 24/18/33 suites and the 9-file regression run are still green; script parses.
  ⚠️ Not verified signed-in.

## Jab: "grouping by location returns Unassigned" — plus a real defect it exposed (2026-08-05) — fmlozano
User created Tower/Level/Zone levels on **4PH Jab Greenwoods Dasmariñas** (17,122 activities),
grouped by them and got three nested **"— Unassigned —(17122)"**.
- **Not a bug in grouping.** Creating a level only DEFINES it; it writes nothing to
  `project_schedule.location`. Jab was imported long before any mapping existed, so every activity
  still had `location = {}`. The fix is to run **Location Breakdown… → Fill location from the WBS
  tree…** once. ⚠️ Worth stating in the UI — "create a level" reads like it should populate it.
- ⚠️ **REAL DEFECT the screenshot exposed: a location qualified by the work it holds split into two
  groups.** Jab names its towers **`Tower D - Substructure`** and **`Tower D - Superstructure`**, so
  the keyword source returned **34 tower values for 17 towers** — every tower duplicated. Avesta
  never showed this because its nodes are plain (`Tower 3`).
- **Fix — `locTrimSeg`:** the matched segment is trimmed to the smallest separator-delimited part
  that STILL matches the terms (`Tower D - Substructure` → `Tower D`), while an unqualified name is
  returned untouched. ⚠️ The separator must be **spaced** (` - `, ` – `, ` — `, ` : `, ` | `) so a
  hyphenated code like `T1-L05` is never split; and the part kept is whichever side matches, so
  `Substructure - Tower D` works too. If no single part matches, the whole name is kept.
- **Measured on the real Jab .xer (17,122 activities, an exact count match with the live project):**
  Tower **99.3% → exactly 17 values, Tower A…Q** (was 34); Level **95.4%**, 7 values; Zone
  (`Area, Zone`) **14.9%**, Area 1/Area 2. **Avesta is byte-for-byte unchanged** — its names carry no
  separator, so the trim is inert there.
- **Recommended terms** — Jab: `Tower` · `Floor, Roof Deck, Roofdeck` · `Area, Zone`.
  Avesta: `Tower, -Handover` · `Floor, Storey, Roof Deck, -Finishes, -Coating` · `Zone`.
- ⚠️ **Data-quality issues the value list makes visible, which are the USER's to fix, not ours to
  silently merge:** Jab has both **`Roof Deck` and `Roofdeck`** (two groups for one level); Avesta
  has **`Ground Floor` / `Ground floor`** and worded-vs-numeric duplicates (`Eight Floor` vs
  `8th Floor`) — 26 values for ~13 real floors. Case-folding or fuzzy-merging these automatically
  would silently merge names that a project might legitimately distinguish; the preview shows them so
  the planner can correct the WBS.
- **Verified 33/33 in Node** (the 26 from the previous entry plus 7 for the trim: qualified name,
  unqualified untouched, en/em dash, colon, the unspaced-hyphen guard, match-on-either-side, and the
  no-part-matches fallback), run over both real trees. Script parses; the 24/18/9-file suites still
  green. ⚠️ Not verified signed-in.
- ⚠️ **`index.html` is NOT cache-busted** (documented) — the deployed page needs a hard refresh
  (Ctrl+Shift+R) before this appears.

## Location from the WBS by KEYWORD — the source that actually works on a P6 tree (2026-08-05) — fmlozano
Built so Avesta's location breakdown can be filled from its import. ⚠️ **I first proposed a source
that reads the ACTIVITY NAME, and that was wrong** — measured on the real file, only **1.1%** of
Avesta's 4,393 activity names contain "Tower" (the 49 milestones) and **0%** contain Zone/Level/T1/Z1.
The names are generic (`Formworks`, `Rebar`, `3rd Fix`). Building it would have shipped a feature that
fills nothing.
- **Where the location really is: the WBS tree** —
  `Execution Phase > Construction Phase > Tower 5 > Structural Works > Superstructure > 9th Floor >
  Zone 2 > Vertical`. ⚠️ **But NOT at a fixed depth**, which is why the existing depth mapping can't
  express it: the floor is at depth 6 under MEPF/Architectural Works and at depth **7** under
  Structural Works (which inserts Substructure/Superstructure). Depth 6 therefore means "Eleventh
  Floor" for one trade and "Superstructure" for another.
- **New source kind `locSrcsWbsWords`:** instead of a depth, the planner says **what the value looks
  like** and the source scans the whole ancestry for it — how they read their own tree anyway. Terms
  are comma-separated, matched as **whole words**, and a `-term` **excludes**. The **deepest**
  matching ancestor wins (the nearest enclosing location is the most specific).
- ⚠️ **Whole-word matching is not fussiness:** `Ground` matched "Bac**kground** Music" in the real
  file. And the exclude term exists because `Tower` also catches "Tower Handover" and `Floor` also
  catches "Floor Finishes" — both real nodes in this schedule.
- **The mapper needed one new capability:** a source can declare `needsArg`, and the row then shows a
  second input (seeded from the level's own name, so a level called Tower starts with `Tower`);
  `read()` resolves it via `src.make(arg)` into an ordinary `{key,name,get}`, so **`locMapPlan`,
  the importers and the backfill are unchanged**. A blank argument leaves the level unmapped rather
  than contributing an empty column.
- **The preview now lists the DISTINCT VALUES per level with counts**, replacing the old
  count-plus-two-sample-rows in all three call sites. With a keyword matcher this is the only way the
  planner can SEE that "Floor" caught "Floor Finishes" — it is what makes the exclude term
  discoverable, and it is how both false positives above were found.
- **Measured on the REAL Avesta .xer** (terms `Tower, -Handover` / `Floor, Storey, Roof Deck,
  Basement, Podium, -Finishes, -Coating` / `Zone`): **Tower 91.4%, Floor 79.2%, Zone 27.7%**; Zone
  resolves to exactly `Zone 1`/`Zone 2`; **every zoned activity also carries its tower and floor**;
  and the 379 unmatched activities are correctly the Initiation/Planning/Design work, which has no
  location. **Every activity under Construction Phase resolves to a real `Tower 1..7`** — the odd
  residual values (`FCD Tower`, `BOQ Tower`, `Tower 2, 5, 6, 7`) are Planning-branch design nodes and
  cannot contaminate construction work, since they are in a different branch.
- ⚠️ **Two test assertions failed and BOTH were my assertion, not the code** — worth keeping because
  each taught something: (1) some zoned activities had no floor because the floor node is
  **"Roof Deck"**, which "Floor, Storey" simply doesn't cover; (2) the extra Tower values are design
  nodes. Neither was visible from reading the tree.
- **Generality (measured across all 8 real .xer files with one generic term set):** Jab **99%**,
  Jenara **100%**, Strevi **97%**, Avesta **92%** tower coverage; Caticlan is not a tower project but
  gets **Zone 78% / Floor 83%**; Hotel 101 **Floor 51%**; OPW101 **20%**; DepED **0%**. So **the
  mechanism generalises, the WORDS do not** — each project needs terms matching its own vocabulary,
  which the preview shows in seconds. DepED has activity codes instead (`Priority`, on 185 tasks).
- **Verified 26/26 in Node against the shipped source** run over the **real 4,393-activity Avesta
  tree** (all the numbers above, plus whole-word/exclude/case/phrase/regex-metacharacter handling,
  deepest-wins on a synthetic nested tree, and inert behaviour before an argument is supplied), plus
  **17/17 in a real browser** on the UI (input reveal, seeding, hint, `make()` resolution, deepest
  floor across differing depths, the false positive appearing in the preview and an exclude term
  removing it, per-value counts, blank-argument un-mapping). Earlier 24/24 + 18/18 + the 9-file
  regression run all still green; script parses, 0 console errors.
- ⚠️ **Not verified signed-in.** The intended path for Avesta is **Location Breakdown… → Fill location
  from the WBS tree…**, which now offers this source against the already-imported schedule — no
  re-import needed.
- ⚠️ **Concurrent edit:** another session was editing this same file (`syncDesignDevelopment`) while
  this landed; the changes are in disjoint regions and were committed separately.
- Module-local; no migration, no `?v=` bump.

## Excel/OPC location mapping — and what the REAL exports actually contain (2026-08-05) — fmlozano
Completes the import mapping: the Excel/OPC path now retains the columns its fixed header detection
doesn't claim and offers them to the shared mapper, so an xlsx `Tower`/`Level`/`Zone` column can be
mapped onto the location levels. Same modal section, same planner, same preview as the P6 path.
- **`parseWorkbook` keeps unmatched columns** as `rec.extra = { "<header as written>": value }`.
  ⚠️ Headers repeat in real OPC exports and `extra` is keyed by header, so duplicates are
  **uniquified** (`Zone`, `Zone (2)`) — otherwise the second column silently overwrote the first on
  every row. Blank headers and blank cells are skipped; WBS rows get `extra: null`.
- **Third source kind `locSrcsCols`**, ~6 lines, because sources were already reduced to
  `{key,name,get(rec)}` — the mapper, the preview, the planner and the level-creation path needed
  **no changes at all**. That was the point of the shape.
- **⚠️ THE IMPORTANT FINDING — this does not help Avesta, and I checked rather than assumed.** I ran
  the **shipped** parsers over the **real exports on disk** (9 xlsx + 8 xer):
  - The **Avesta xlsx** has 4 spare columns and they are **Planned Value POC / At Completion IBB /
    BL Planned IBB / Percent Complete Type** — no location column. Nothing to map.
  - **Its WBS rows carry no Name at all** (the export writes only a code in the ID column: `AVE`,
    `1.4`, `1.4.4`), so in the Excel path the WBS-depth sources yield **codes, not readable names**.
  - The **Avesta .xer** WBS *does* have real names, but they are **Phase › Discipline › Trade**, and
    tower/zone appear at irregular depths as groupings (`Tower 1 + Gen Req***`, `Towers 2-7` at
    depth 5; `Zone 1`/`Zone 2` at depth 8, alongside `Mat Footing`/`SOG`). **No single depth maps
    cleanly to Tower or Zone.**
  - The **Avesta .xer has no usable activity codes** — one type (`View`) with one value, on **0**
    tasks. (Other projects do: Caticlan has `Trades` on 2,947 tasks and `High Level Trade SMC 1` on
    2,076 — so the P6 code path earns its keep, just not here.)
  - Avesta's location lives in the **activity names** (`Tower 1 Topping Off`).
  → So the remaining planned source kind — **a pattern/delimiter on the activity name** — is the one
  that would actually serve this project. It is NOT built yet.
- **Verified.** 18/18 in Node against the shipped `parseWorkbook` + mapper (claimed columns not
  duplicated into extras, duplicate-header uniquifying, blank header and blank cells skipped, dates/%
  still parsed, WBS rows null, mixing a WBS depth with a column in one mapping, and the same
  zone-name-under-two-towers case). Plus a **real-file regression run**: all 9 OPC exports
  (~50k activities incl. a 20,716-row one) parse, and every record is **byte-identical to the
  previously committed parser on every pre-existing field** — `extra` is purely additive. The
  earlier 24/24 mapper suite and 20/20 browser UI suite still pass; script parses.
- ⚠️ Still **not verified signed-in** — no live click-through of an actual import.
- Module-local; no migration, no `?v=` bump.

## P6 activity codes imported + a shared location mapper for imports (2026-08-05) — fmlozano
User: with the location breakdown added (Avesta = Tower › Level › Zone), the OPC/P6 imports don't
offer it. They couldn't: **neither importer ever wrote `location`**, so every imported activity
landed with `location = {}` and the Location group-by showed one "— Unassigned —" bucket. The XER
path was also **dropping P6's activity codes entirely** (it read CALENDAR/PROJWBS/TASK/TASKPRED/
RSRC/TASKRSRC/UDF but not ACTVTYPE/ACTVCODE/TASKACTV) — which is exactly where a P6 schedule keeps
Tower/Level/Zone when it isn't in the WBS.
- **XER activity codes now import.** `ACTVTYPE` → `activity_code_types`, `ACTVCODE` →
  `activity_code_values`, `TASKACTV` → each activity's `activity_codes`. Worth doing on its own
  merit: those dictionaries were previously only ever created by hand, so the existing `code:`
  grouping/filtering columns had nothing to work with on an imported project.
  ⚠️ **P6 nests code values** (`parent_actv_code_id`) and the app's dictionaries are flat — nesting
  is dropped, the values stay distinct, which is all grouping needs. ⚠️ P6 allows several values of
  one type on an activity; the app stores one per type, so **last assignment wins** (same as the
  grid editor). Resource-scoped types (`AS_Resource`) are skipped — they aren't activity codes.
  Values label as `SHORT - Description`, collapsing to one when they're equal.
- **New shared location mapper** — `locSrcsWbs` / `locSrcsCodes` / `locMapUI` / `locMapPlan` /
  `locEnsureLevels`. A **SOURCE** is anything that can yield a location value for a record and is
  reduced to `{key, name, get(rec)}` **before the UI sees it**, so adding a source kind (a
  spreadsheet column next) is a new builder function and nothing else. Records are plain objects
  too — DB rows in the backfill, parsed import recs in the importer — which is what lets **one**
  planner serve both.
- **`openLocBackfill` was rewritten onto it** rather than duplicated: same modal, same live
  count + sample, but it now also offers **activity codes** as sources, so a project whose codes
  carry the location no longer has to re-import to use them.
- **The XER import preview gained a "Location breakdown" step** listing the file's own WBS depths
  and code types (each with a 3-value sample) mapped onto the location levels. It can **create
  levels** — a project being imported into for the first time has none — and `location` is stamped
  onto the payloads so it rides in the **same insert**, no second pass over 40k rows.
  ⚠️ `locEnsureLevels` returns false if a level can't be created and the caller then skips the
  mapping: proceeding would write values under placeholder keys that nothing reads.
- ⚠️ **Code values are matched back by `(type,value)`, not by insert order** — PostgREST does not
  promise returned rows come back in the order sent, and these are chunked 500 at a time.
- **Verified 24/24 in Node against the SHIPPED functions** (sliced out of `index.html`, never
  reimplemented) — resource-scoped types dropped, `SHORT - Description` labelling incl. the equal
  and missing-short cases, label-less and unknown-value assignments ignored, WBS sources returning
  null on shallower rows, mixed WBS+code mappings landing together, no mutation of the caller's
  location map, an already-correct row planning no write, and **the crux case: the same zone name
  under two towers keeps its own tower**. Plus **20/20 in a real browser** on `locMapUI` (jsdom
  isn't available and `read()` drives everything): default guesses, name-match beating the depth
  guess, skipped levels excluded, the add/remove/prefill flow, new rows reading placeholder keys, a
  nameless new row refused, no page overflow. Script parses; 0 console errors.
- ⚠️ **Not verified signed-in** — needs a real `.xer` imported into a scratch project. **Excel/OPC
  is NOT covered yet**: its header detection still discards unmatched columns, so a `Tower`/`Level`/
  `Zone` column in an xlsx is dropped before the mapper could see it. That's the remaining piece —
  retain unmatched columns on each record and expose them as a third source kind.
- Module-local; no migration (reuses `location_levels` / `activity_code_*`), no `?v=` bump.

## SIGNED-IN verification of the location/grouping work — migration run, 1 real bug found (2026-08-04) — fmlozano
First live run of everything from this batch. **Migration `2026-08-04-activity-location-work-type.sql`
was executed on the production Supabase** (`planners-app`) and verified by querying the catalog, not
by trusting the success message: `location_levels` table = 1, `project_schedule.location` = 1,
`.work_type` = 1, policies = 2, indexes = 2.

- ⚠️ **REAL BUG FOUND AND FIXED — both Location Breakdown menu buttons were dead.**
  `renderGroupMenu` is module scope but called `closeMenus()`, which is declared in the **init/wiring
  scope**, so clicking "Location Breakdown…" or "Fill location from the WBS tree…" threw
  `ReferenceError: closeMenus is not defined` and did nothing. **The Node harness stubs `closeMenus`,
  so it passed there** — only the real page caught it. Fixed by closing the menu directly.
  Audited every other helper the new code calls: all module scope; this was the only one.
- **Duplicate-WBS heal proven end-to-end.** Planted the exact reported bug on the `Test` scratch
  project (a second projection of `Procurement` + `Execution Phase` → 9 summary rows for 7 nodes,
  matching the user's screenshot), then loaded the app: the grid came up with **7 rows**, and a
  follow-up SQL check confirmed the extras were **deleted from the database** (every node back to
  exactly 1 copy). Not a render filter — a real repair.
- **Both grouping layouts verified live** on 2 locations × 2 zones × 2 work types:
  `Location › Zone › Activity` and `Activity › Location › Zone`, 22 rows / 14 group headers, correct
  nesting and per-group counts, and **"Zone 1" stays a separate group under each location** — the
  case the whole design turns on. Order persists across a reload (`ps_groupbys_<pid>`).
- **Inline location editing verified with REAL mouse + keyboard**: double-click a Location cell, type
  "Tower B", Enter → persisted to the DB and the grid **re-grouped live** (Loc 1 4→3, a new Tower B
  branch appeared). Value suggestions in the datalist came from the project's existing values.
- ⚠️ **Method note that cost time: synthetic events do NOT drive this grid editor.** Dispatching
  `dblclick` + setting `input.value` + `blur()` / a synthetic `KeyboardEvent` opened the editor but
  never committed, and once left the cell visually blank while the DB was untouched — which looks
  exactly like a persistence bug and isn't. Use the real `computer` mouse/keyboard path to test it.
- ⚠️ **Environment:** screenshots of the module time out (stalled compositor, as documented) and the
  1MB page intermittently wedges CDP; verification is measured DOM + direct Supabase queries. One
  fresh load showed the correct grouping label with a stale grid, but it did not reproduce across a
  10-sample timeline (correct from the first frame), so it reads as an automation artifact rather
  than a defect — worth an eye on a foreground tab.
- **Left in place:** `Test` project now has 2 location levels (Location, Zone) and 8 demo activities
  so the feature is inspectable. **`XERTEST` still holds one genuine pre-existing duplicate**
  (`Execution Phase` ×2) that will self-heal the next time it is opened in the app.

## Builder push: flat by default, structure comes from grouping (2026-08-04) — fmlozano
Follow-up to the location-as-data work; the user picked this as the real simplification. The push
used to *materialise* the location breakdown as a Trade › Floor › Zone sub-WBS on every run. Now
that each activity carries `work_type` + `location`, that branch is redundant for most projects —
the same structure is a **view** you can flip, and it costs nothing to change your mind.
- **"Group into a sub-WBS" now defaults OFF.** A flat push adds the activities under the chosen WBS
  node and nothing else. The reason is stated in the dialog rather than left implicit, and the hint
  and the WBS-structure editor are mutually exclusive (`syncStructVisibility` toggles both).
- **Flat push names the activity for the WORK, not the place** — `taskPayload(r, r.act.name)`
  instead of `"Structural F5 · Z1 — Formworks"`. The location was crammed into the name only because
  it had nowhere else to live; it now has its own columns and grouping levels. ⚠️ This is also what
  made grouping-by-name useless before: every instance had a unique name.
- ⚠️ **A flat push switches the schedule to Activity › Location › Zone** (`setGroupBys`, only when
  `!grouped` and the project has levels). Without it the planner lands on a WBS-grouped list of a
  few hundred rows all reading "Formworks"/"Rebar" and reasonably concludes the push failed. The
  setting is written to the per-project key *before* the `load()`, so it survives the reload.
- **The sub-WBS path is untouched** and still the right choice when the WBS codes themselves must
  encode location (client-mandated coding). ⚠️ Another session had meanwhile rebuilt that dialog with
  a configurable ordered dimension list (`cfg.wbsOrder` / `renderStruct`); this change is deliberately
  surgical around it — default, hint, naming, post-push grouping — and preserves that editor intact.
- Verified: 9 static assertions on the shipped file (default flipped, hint wired, naming changed,
  grouping applied only on the flat path, grouped path + structure editor preserved) plus the
  33/39/16 suites still green and a clean parse. ⚠️ **Not verified signed-in** — the push writes to a
  real project, so the end-to-end run is the user's.

## Two bugs from a live Builder run: invisible "Structural", duplicated WBS rows (2026-08-04) — fmlozano

**1. "Structural" was unreadable in the Auto-trace dialog — measured, not guessed.**
`GCOLOR.ST` was the brand Dark Gray `#2B2C2B`, which is **exactly `--pd-card` in dark mode**, so the
trade name rendered at a **1.00:1 contrast ratio** — the same colour as its background. The dialog
literally read *"How many ___ floors must be completed before Architectural can start?"*. MEPF's deep
blue `#3a6098` was nearly as bad at 2.21:1.
- Fix: a `gc(trade)` accessor with dark-theme substitutes (`ST #a9aeb4`, `MEPF #7d9fd6`) — **6.28:1
  and 5.21:1** on the dark card, with the light-theme colours untouched (both still ≥3:1 on white).
  All **17** read sites now go through `gc()`; never read `GCOLOR` directly.
- This affected far more than the dialog: the tower trade headings, zone tags, trade chips, Gantt
  bars and the per-zone duration bars all used the same invisible colour on dark.
- ⚠️ Colours are baked into `innerHTML` at render time, so a *live* theme toggle leaves stale colours
  until the next builder re-render (step change / reopen). Acceptable; noted rather than hidden.
- ⚠️ **Self-inflicted trap worth remembering:** the bulk regex that rewrote the call sites used
  `GCOLOR\[([^\]]+)\]`, which stops at the FIRST `]` — so the nested `GCOLOR[p[0]]` became the
  syntax error `gc(p[0)]`, and it landed on the exact line the user reported. Caught by the parse
  check, not by eye. Don't bulk-rewrite bracket expressions without re-parsing.

**2. Duplicated WBS rows after a Builder push + Clear (screenshot: 9 schedule rows, 7 nodes).**
Root cause found by reading, then proven by test: **`ensureWbsSkeleton()` discarded the summary rows
it inserted** — `await _insertWbsSummary(...)` with the result thrown away, so the freshly created
rows never entered the in-memory `rows`. The `_wbsEnsureSummaries()` that runs immediately after in
`load()` then saw every skeleton node as un-projected and inserted a **second** row for it.
- Fix: push the inserted row into `rows` (the one-line root cause).
- **Self-heal**, so the user's already-broken project repairs itself on next load:
  `_wbsEnsureSummaries()` now removes duplicate projections first — one node must have exactly ONE
  summary row; it keeps the **earliest** and deletes the rest, then rebuilds (the deleted rows are
  still in `_sorted` and the roll-up maps until a re-sort) and reports what it removed.
  ⚠️ Safe because activities reference a WBS by dotted **code + `wbs_node_id`**, never by the summary
  row's id. ⚠️ Legacy rows with no `wbs_node_id` are deliberately left alone (they're the un-adopted
  import case that "Adopt existing WBS" owns).
- **Re-entrancy guard** (`_seedingSkeleton`): seeding is fired from `load()`, and `load()` overlaps
  on a project switch or the reload after Clear — two runs both seeing an empty `WBS_NODES` would
  each seed a whole skeleton. `ensureWbsSkeleton` is now a guarded wrapper around `_seedSkeleton`.

**Verified: 16/16 in Node against the shipped `_wbsEnsureSummaries`** — healthy project untouched,
the reported duplicate case deleting exactly the extras while keeping the first, no re-insert after
cleaning, a mixed dedupe-and-restore pass, legacy unlinked rows never touched, plus the WCAG contrast
maths above. Existing 33/33 grouping + 39/39 keyboard suites still green; script parses.
⚠️ **Not verified signed-in** — needs a real Builder push + Clear cycle to confirm end-to-end.

## Location + Work Type as activity DATA — grouping order is now interchangeable (2026-08-04) — fmlozano
User: activities are grouped Location > Zone > Activity, and that should be flippable to
**Activity > Location > Zone**. Root problem: location and zone existed **only as WBS tree
structure**, so the tree was the one and only grouping. Fix = make them activity data and let the
grid nest by any ordered set of levels. **The WBS tree is not modified** (user's call): grouping is
a view, so codes, cost roll-ups, EVM, exports and the document links all keep working.

**Migration `../../migrations/2026-08-04-activity-location-work-type.sql` (USER MUST RUN)** — a
`location_levels` table (ordered, per-project) + `project_schedule.location jsonb` +
`project_schedule.work_type`. Tolerant everywhere: no table → no levels → the feature is simply
absent and nothing else changes.

- **Location levels are per-project and free-form** (user chose "generic, configurable levels" over
  a fixed Location+Zone pair) — a tower, a viaduct and a plant don't share a vocabulary.
  `location` is a jsonb map keyed by level id, **deliberately the same shape as `activity_codes`**,
  so the existing dynamic-column / filter machinery applies to it unchanged.
  ⚠️ Values are plain text per level, **not a node tree**. "Z1" under two locations is the same
  string; they stay separate because grouping NESTS Zone under Location. Grouping by Zone alone
  deliberately merges them ("everything in Z1") — verified as an explicit test case.
- **`buildNodes()` generalised from single-level to N-level grouping.** `groupBy` (a string) became
  **`groupBys` (an ordered list)**; Location>Zone>Activity and Activity>Location>Zone are now the
  same engine with the list reversed. ⚠️ **'wbs' is a hierarchy, not a flat key** — alone it means
  the plain WBS tree, and as the LAST entry it means "show each group's WBS path". It is forced out
  of the middle by `normalizeGroupBys()`, which also drops levels/codes that no longer exist.
- ⚠️ **Legacy saved views are migrated, not reinterpreted.** A stored `groupBy:'status'` used to
  render each group's WBS path underneath; it loads as `['status','wbs']` so the user sees exactly
  what they saved. Plain `['status']` now means "group headers → activities", which is new.
- **Grouping picker** (replaces the `<select>`): presets for the two layouts a planner actually
  flips between, plus an ordered add/remove/▲▼ list. Persisted **per project** (`ps_groupbys_<pid>`).
- **Editable in the grid**: Work Type + one column per level, inline-editable via a new `xcol` type
  in `beginEdit` (with a datalist of values already used on the project — a typo silently creates a
  second group). Location columns default to VISIBLE (you created the level deliberately); Work Type
  stays opt-in like codes/UDFs so it doesn't widen every existing project's grid.
- **The Schedule Builder now stamps what it already knew.** It computes each generated activity's
  work type and floor/zone/unit and then **threw it away**, baking it into the activity NAME and the
  WBS nesting. `taskPayload` now carries `work_type` + `location`; `ensureLocLevels()` creates
  Location/Zone(/Unit) on first push if the project has none.
- **Backfill for existing schedules** (`openLocBackfill`): reads each activity's WBS ancestry and
  copies the names onto the new fields. ⚠️ The **depth→level mapping is shown and editable, not
  guessed** — a Phase>Location>Zone tree maps differently from Location>Zone — with a live count and
  a sample of what will change, an overwrite toggle, and a local apply before the batched write.
- Search now also matches work type + every location value.

**Verified: 33/33 in Node against the SHIPPED `buildNodes`** (extracted, not reimplemented) — the
WBS path unchanged, Opt 1 and Opt 2 shapes/depths/ancestry, order-swap keeping all activities, the
same-zone-name-under-two-locations case, ancestry chains being prefix-ordered and every ancestor
existing (collapse depends on it), missing values bucketing + sorting last, work-type falling back
to the activity name, filters pruning empty groups, `normalizeGroupBys` invariants, and group bars
rolling up child dates. Plus **in-browser** against the real stylesheet: the picker renders its 4
sections, highlights the active preset, disables ▲/▼ at the ends, actually reorders on click, 16×16
badges, 305px menu, no overflow. Existing 39/39 keyboard suite still green; script parses.
⚠️ **Not verified signed-in** — the migration hasn't been run, so no live click-through of the
backfill, the builder push, or a real 17k-row regroup. Screenshots impossible here.

## WBS Manager: the keyboard now works on a SELECTED ROW, not just a focused input (2026-08-04) — fmlozano
Follow-up to the build-speed work below. Every outliner key was bound to `keydown` on the row's
**name `<input>`**, so the moment focus left that input — click a row, arrow onto one, or select a
locked/synced heading that has no input at all — the keyboard was dead. New **document-level handler**
(next to the grid's, same scoping shape: bails while a field has focus, while any overlay is visible,
or when `#ps-view-wbs` isn't the visible tab) driving the selected row:
- **↑ ↓** move the selection · **Alt+↑↓** reorder among siblings · **Home/End** first/last.
- **← →** collapse / expand — and, once open, **→** steps into the first child while **←** steps out
  to the parent. Standard tree behaviour, and the reason a row selection is now genuinely navigable.
- **Enter / F2** enters edit mode on the name (a second Enter, now inside the input, adds the next
  WBS — so the two layers chain); **Shift+Enter** sub-WBS; **Insert** sibling after; **Tab /
  Shift+Tab** indent/outdent; **Delete** delete; **Esc** deselect.
- **No selection?** The first ↑/↓ lands on the top row, so the keyboard is always a way in rather
  than needing a click first. A selection filtered out by the search box recovers the same way.
- **Read-only** (`__viewOnly` / `__archived`): navigation and collapse/expand still work, every
  mutating key is inert.

⚠️ **The non-obvious bug this had to solve: `document.activeElement`.** The handler must bail when a
field has focus (otherwise it would hijack the search box's own arrow keys), but clicking a row did
**not** move focus — rows weren't focusable, so the search box kept it and the handler bailed on
every keystroke. Rows now carry `tabindex="-1"` and are explicitly `.focus()`ed on select, which both
fixes that and gives the tree a real focus target. `_wbsGoto(id, edit)` focuses the **row** when
navigating and the **input** when editing. Verified in-browser: focus goes `INPUT#ps-wbs-search` →
`DIV.ps-wbs-row`, so the guard passes. `focus({preventScroll:true})` everywhere — the function does
its own scroll-into-view and the browser's would fight it.

⚠️ **`_wbsNeighbourId` gained an `editableOnly` flag.** Name-editing navigation must *skip* locked /
synced rows (they render fixed text, not an input), but row *selection* must be able to land on them.
Both existing callers were updated to pass `true`; the new handler passes nothing.

⚠️ **Tab is swallowed while a row is selected** (it indents, matching the in-input behaviour), so it
no longer moves browser focus out of the tree. Escape clears the selection and hands Tab back.

**Verified: 39/39 in Node against the SHIPPED handler** (extracted from `index.html`, not
reimplemented) — all three focus guards, overlay guard, hidden-view guard, every key's routing,
selection landing on a synced row, end-of-list no-ops, the no-selection and filtered-out-selection
recovery paths, expand-then-step-into vs collapse-then-step-out, locked/synced Enter warning instead
of editing, and the full read-only matrix (navigation allowed, all 5 mutating keys inert).
**In-browser** against the real stylesheet + real `_wbsRowHTML`: `tabindex="-1"` on every row, the
search-box→row focus handover, `outline:none` on focus, no scroll jump, legend text, no page
h-scroll. ⚠️ **Not verified signed-in.** Screenshots remain impossible here (stalled compositor).
Module-local, no migration, no `?v=` bump.

## WBS Manager: make it fast to BUILD a WBS (2026-08-04) — fmlozano
The Manager was good at *editing* an existing tree and slow at *creating* one: every node cost a
modal round-trip (`wbsAddChild` → type a name → Save → re-render), and the only bulk paths were
"Adopt existing WBS" (import-only) and "Add WBS from Project", which was buried in the **grid's**
right-click menu and unreachable from the WBS view. Four ways in, aimed at how a planner actually
starts a WBS:

- **Type-to-build outliner (the main one).** `＋`/"Add WBS" now inserts a **blank node inline** and
  puts the cursor in it (`wbsQuickAdd` + `_wbsFocusName`) — no modal. From there the keyboard does
  the rest: **Enter** = next WBS at the same level, **Shift+Enter** = sub-WBS, **Tab/Shift+Tab** =
  indent/outdent, **Alt+↑↓** = move among siblings, **↑↓** = move the cursor, **Esc** = revert the
  field. **Enter on a still-blank name deletes that node** (`_wbsDeleteBlank`, guarded to leaf +
  0 activities + not locked) — the standard outliner way to undo an over-shoot. A persistent legend
  under the card header spells the keys out; without it they're invisible.
- **Paste an outline** (`openWbsOutline` + `parseWbsOutline`): paste from Excel/Word/notes, get a
  live preview of the tree with the codes it will receive, then build it in one go. Levels come from
  **dotted numbering** (`1.2.3 Name`) when the paste is demonstrably hierarchically numbered, else
  from **indentation rank** (tabs or any consistent spacing). Bullets are stripped; a paste can never
  skip a level. Optional "keep the pasted numbers as custom codes".
- **Duplicate a branch** (`wbsDuplicate`), row action `⧉`: copies a node + its whole subtree as
  siblings, N times, with a `#` placeholder in the name → "Level #" × 20 gives Level 1…Level 20.
  This is the typical-floor / tower / building case that otherwise means retyping the same subtree.
- **"From project…" surfaced** in the WBS toolbar (`wbsFromProject` already existed but was only
  reachable from the grid's context menu), and the empty state now offers the three starting points
  instead of a sentence.

**Behaviour notes / traps:**
- ⚠️ **`_wbsRenderWindow` now skips a repaint when the same slice is already painted.** Scrolling a
  row into view to focus its input fires `scroll`, whose rAF repaint would replace the window's
  `innerHTML` and **destroy the input mid-typing**. `renderWbsManager` always empties `.ps-wbs-win`
  when it rebuilds the skeleton, so a genuine re-render still paints. Don't "simplify" the guard away.
- ⚠️ **`_wbsNormalizeAndPersist(forceIds)` — `forceIds` is load-bearing.** It used to persist
  `parent_id`+`sort_order` for **every** node on every move (200 round-trips on an 8.6k-node tree);
  it now persists only the diff. But normalization can land a re-parented node on the **same integer
  `sort_order` it already had**, so the diff alone would silently skip its `parent_id` write —
  callers that re-parent MUST pass their moved ids. Verified in Node: a re-parent that keeps
  sort_order 0 is still persisted.
- **Renames during keyboard nav don't run the full `_wbsCommit`** (`_wbsCommitName`): a rename can't
  change any code, so the re-number/re-sync pass isn't needed and would steal focus. A `wbsDone` flag
  on the input stops the browser's change-on-blur firing a second (full) rename.
- ⚠️ **Batch builders don't rely on PostgREST insert ordering.** `_wbsInsertNodes` stashes a unique
  throwaway token in `code` (inert — `code_custom` stays false, so `computeWbsCodes` ignores it) and
  maps created ids back by token; `_wbsCommit` overwrites `code` with the real dotted code straight
  after. Both builders insert **one depth level per round-trip** (the `wbsAdopt` pattern).
- Indent now refuses to move a node under a `source_kind` (synced) parent and un-collapses the new
  parent, so an indented node can't vanish into a collapsed branch.
- New nodes are created with a **blank name** (placeholder-guided) rather than "New WBS", which is
  what makes Enter-on-blank a safe delete.

**Verified.** 19/19 in Node on the **shipped** `parseWbsOutline`/`_wbsOutlineCodes` (tab-indented,
dotted-code with no indentation at all, bullets + blank lines, uneven indent widths, first-line
over-indent, empty input, and the preview codes both at top level and under an existing parent).
⚠️ **Two real defects came out of those tests, not out of reading the code:** an ordinary name like
**"2 Storey Annex"** silently lost its "2", and "100 Preliminaries" was split into code+name — both
because the leading number was stripped before the mode was decided. Fixed by only splitting a code
in hierarchical-numbering mode. Plus 10/10 in Node on `_wbsNormalizeAndPersist` (re-parent at equal
sort_order, mid-list insert via the 0.5 slot, no-op writes nothing, duplicate-copy ordering).
**In-browser** against the module's real `<style>` + real `_wbsRowHTML`: 34px rows, locked headings
render fixed text with only ＋Act/＋, `source_kind` rows show the synced badge and **zero** buttons,
editable rows carry all 9 (incl. the new ⧉), no row or page h-scroll, name field 668px at 1280px
(the 9th button costs nothing), hint text correct, 0 console errors.
⚠️ **Not verified signed-in** — no live click-through of the actual insert/duplicate/paste writes.
Module-local, **no migration**, no `?v=` bump.

## Auto-generated WBS skeleton (2026-08-03) — fmlozano
Every project's WBS Manager now auto-seeds a **fixed 7-node outline** on first load (when
`WBS_NODES` is empty for that project, `ensureWbsSkeleton()` in `load()`'s resource-loading step):
- **L1** Milestones · Initiation Phase · Planning Phase · Execution Phase
- **L2** (under Planning Phase) Project Execution Plan · **Design Development** · **Procurement**

**Two new `wbs_nodes` columns** (migration `migrations/2026-08-03-wbs-skeleton.sql`, **USER MUST
RUN** — tolerant/no-op until then, just skips seeding):
- `is_locked` — every seeded node; blocks rename/recode/move/delete (`wbsRename`/`wbsMove`/
  `wbsEditCode`/`wbsDelete` all guard on it and toast). Add-activity/Add-child stay allowed so the
  L1 headings + Project Execution Plan remain normal, usable WBS nodes.
- `source_kind` — only **Design Development** (`'design_development'`) and **Procurement**
  (`'procurement'`): blocks **+Add activity** and **+Add child WBS** entirely (their data is meant to
  come from another module, not manual entry) and shows a "🔒 synced" badge instead of the usual
  action buttons in the WBS Manager row.
- `SOURCE_KIND_LABEL` names the intended source in every toast/tooltip: Design Development →
  "Drawing Register + Material Submittal Log"; Procurement → "the Procurement (WPM) app" (the
  existing `wpm_work_packages` mirror already used by Cash Flow — see [[cashflow-module-model]]).
- **Deliberately NOT built this pass:** the actual data pipe populating those two nodes' rollups
  from `drawing_register`/`material_submittal`/`wpm_work_packages` — this change only builds the
  skeleton + the "can't add activities here" guardrails. A follow-up can add a rollup summary (counts/
  status) read into each locked node's row, the same pattern as the Documents tab or the WPM mirror.
- Existing projects (already-nonempty `WBS_NODES`) are **untouched** — the skeleton only seeds a
  brand-new tree, it never merges into or reshapes an existing WBS.
- Verified: inline JS passes `node --check`. **Not browser-verified** (auth wall) — needs a signed-in
  check that a new/scratch project seeds the 7 nodes correctly and the locked/synced guards actually
  block the UI actions.

## Fix: "Critical path only" filter had zero effect (2026-07-30) — fmlozano
User asked for critical-path activities to be isolated (hide the rest, with an easy way to show them
again) — this feature **already existed** as Filter → Schedule → "Critical path only" (`filters.crit`,
added 2026-07-14), but testing it live on **Bauhinia (BAU101)** found it did **nothing**: toggling the
checkbox on/off left the grid showing all 246 activities regardless.
- **Root cause: `anyFilter()` never checked `filters.crit`.** `buildNodes()`'s WBS-mode branch only
  runs `rowMatches` filtering when `anyFilter()` returns true; that gate function ORs together search/
  behind/look/status/type/codes/col/adv but **omitted `filters.crit` entirely**, so toggling Critical-
  path-only **alone** (no other filter active) left `anyFilter()` false and the whole filter pass never
  ran — `rowMatches`'s own `if (filters.crit && !isWbs(r) && !r._critical) return false;` line was
  correct and simply never got invoked. Same bug hit the non-WBS grouped-mode branch (same `anyFilter()`
  gate). Confirmed via direct DOM inspection on the live site: checkbox toggled to `checked=true`,
  `filters.crit` verified true, grid still rendered all 246 rows (Cabinets Handles/Solid Wood Riser
  Detail/etc., all with 100+ day float, still visible) — not a UI-interaction miss, a real logic gap.
- **Fix:** one-token addition — `anyFilter()` now includes `filters.crit` in its OR chain.
- **Verified live on the deployed site** (BAU101, post-deploy hard-reload): checking "Critical path
  only" narrowed 246 → 4 critical activities + their WBS ancestors (Landscape/Bath House/Fence PC -
  Modularize under Designs, ACCU/Chiller under Construction → Mechanical — matching the Critical Path
  Report exactly); combined with the existing **"Hide empty groups"** toggle, childless ancestor
  branches (Milestones, Procurement) drop out too, leaving just the critical chain with real WBS
  context. Unchecking the filter instantly restores all 246 — the "show again" half the user asked
  for was already there, just inert until this fix. Module-local, no migration, no `?v=` bump.

## Mobile Gantt view (read-only, touch-scroll) (2026-07-26) — fmlozano
The phone view (`#ps-mobile`, <700px) was a card list only; added a **List | Gantt** segmented toggle
(persisted `ps_mview`). `renderMobile()` now dispatches to `renderMobileList(acts)` (the old cards) or
**`renderMobileGanttBody(nodes)`** — a self-contained compact Gantt (NOT the desktop virtualized pane,
which stays hidden on phones):
- Same `displayList()` data (respects search/filters/grouping/collapse), capped at `PS_M_CAP` (300) rows.
- Frozen sticky-left label column (`position:sticky;left:0`) + horizontally-scrollable timeline; month
  header (sticky-top); task bars with red %-fill, WBS-summary roll-up bars (`wbsSpan`), milestone
  diamonds (`isFinishMile` anchors on finish), a red data-date line, critical outline.
- Auto-fit scale: `dayw = clamp(1600/totalDays, 1.2, 6)` so the timeline is ~1600px then scrolls.
- Verified: `node --check`; geometry harness confirms month-cell widths **sum exactly to the timeline
  width** (header aligns with bars, diff 0), 1-day bars get a 3px min, data-date maps in range. Read-only
  (no edit/drag). **NOT browser-verified at 375px** (auth wall) — worth an eyeball on a real phone. CSS
  `.ps-mg-*` in the `@media (max-width:700px)` block; module-local, no `?v=` bump.

## Live collaboration — signed-in re-verification (2026-07-27) — fmlozano
Re-verified the PDCollab wiring on the deployed site, signed in, with a simulated second user
(independent Supabase client on the same channel). **Migration `2026-07-26-realtime-collab-project-schedule.sql`
is confirmed APPLIED.**
- ✅ **Presence** — GPR101 + XERTEST both show the topbar avatars; a 2nd member (Test B) appeared live.
- ✅ **Cell cursor** — Test B broadcasting `sel:{rowId,field:'activity_name'}` painted that exact grid
  cell with B's colour + "TB" flag (`paintRemoteCollab`), on the real row `92fa6007…`.
- ✅ **Live-value stream — infrastructure proven.** An isolated probe channel (light page, fresh client)
  subscribing to `postgres_changes` on `project_schedule` returned **SUBSCRIBED** and **received the
  INSERT event** for a test row (filter `project_id=eq.XERTEST`). So the table IS in the
  `supabase_realtime` publication, RLS/JWT allow the stream, and events deliver.
- ⚠️ **The module's own live-apply could NOT be confirmed end-to-end in-session.** On the heavy ~690KB
  Project Schedule page, while Chrome sits **behind** the Claude app (backgrounded), the tab throttles
  hard: the module's realtime channel goes to **CHANNEL_ERROR** (heartbeat starved) and CDP `evaluate`
  calls that `await` across a rAF-gated render **time out at 45s**. A test insert therefore did not visibly
  patch the grid *in that throttled state*. This is the **same documented automation artifact** as the
  rAF/screenshot caveats above — NOT a product defect: the probe proves the stream delivers, and the
  lightweight page (progress-photos) streamed fine in the same session. **Needs a real foreground
  two-session test** to watch the grid patch itself (open two browsers on the same project, edit in one).
- **Two-tab foreground attempt (2026-07-27, same session) — blocked by the environment, not the code.**
  Opened Project Schedule on **XERTEST** in two Chrome tabs; **both channels reported `joined`** (the
  lighter page kept its sockets alive, unlike the 25k GPR101 page). Fired a DB insert from tab A and
  sync-read tab B's grid — but tab B showed **0 painted rows**: its grid render is **rAF-gated**, and a
  Chrome tab that is not the OS-foreground window (Chrome sits behind the Claude app during automation)
  throttles rAF to a standstill, so the observer DOM never repaints even though the realtime event is
  delivered. Async fetch callbacks on the backgrounded heavy page also stall. **Conclusion: the visual
  grid-patch cannot be observed from automation** — it requires two real on-screen browser windows.
  Everything that does not need a live repaint is green (migration applied, stream delivers, presence,
  cursor) and the apply→rebuild→render logic is Node-harness-verified. Test insert cleaned up (0 leftover).
- **Data integrity:** all writes were on the XERTEST sandbox or a single restored GPR101 field
  (`percent_complete` 0→42→0, confirmed back to 0); every test row deleted (0 leftover, exact
  `activity_id` match). Nothing left in any real project.
- The `collab.js` **buildMembers sel-ref fix** (`?v=20260727b`, prior turn) applies here too — the avatar
  editing dot no longer masked by a stale presence ref when a user has multiple tabs.

## UI batch: collab cursor on all columns + keyboard, data-date line, network, L1/L2 IDs (2026-07-27) — fmlozano
Verified live on **Test Project** (id `Test`, 80 activities) throughout.
- **Collab cursor on every column, not just Activity Name.** `_setCellFromClick` broadcast the field via
  the stale `_CELL_META[ci]` (legacy built-in column order, out of sync with the live grid), so most
  columns sent the wrong field or null (null → painted the name cell). Now it reads the **clicked cell's
  own `data-field`**. Also added `data-field="status"` to the status cell (both pill + dropdown branches)
  so the cursor lands there too.
- **Cursor follows keyboard navigation.** New `broadcastActiveCell()` (reads the painted
  `.ps-cell-active` `data-field`) called from `moveRowSel` + `moveCell`, so arrow / Tab / Enter movement
  broadcasts, not only clicks.
- **Data-date line: label removed + drawn above the row highlight.** Removed the Gantt "Data date …"
  text label and the topbar "Data Date:" badge. The line lived in the static layer (z1) while the
  highlight band (`.ps-gantt-selband`) is in the bars layer (z3) → band drew over it ("broken"). Moved
  the line to a **top-level child of `.ps-tl`** (sibling of both layers) so its z6 wins — verified with
  `elementFromPoint` that the line is the topmost element over a highlighted row.
- **Activity Network never blank.** When no activity has links it showed only a hint. Now it renders
  **every activity as a node** (edgeless network) with a note; once links exist, behaviour is unchanged
  (linked set by default, toggle for the rest). Verified: 80 nodes render on the link-less Test Project.
- **Grid-only / Gantt-only confirmed working** (not a code change) — grid-only hides the gantt + grid
  full-width; gantt-only narrows the grid to 300px (OPC-style, intentional) + gantt fills. Both render
  visible content live; the only broken-looking view was the Network empty state (fixed above).
- **Hide Activity ID (WBS code) on WBS L1 + L2** (depth 0/1) in the grid — cleaner summary rows; L3+
  unchanged. Verified: Structure/F1/F2 blank, Z1/Z2 show `1.1.1`/`1.1.2`.
- Module-local (index.html inline), no migration, no `?v=` (index.html isn't cache-busted — hard-refresh
  to pick up).

## Offline editing + sync — Phase 2 (2026-07-26) — fmlozano
Wired the shared **PDSync** outbox (`assets/js/offline.js`): inline-edit the schedule offline, sync on
reconnect.
- **`persist()`** routes its `update` through `PDSync.write` (falls back to a direct write if PDSync is
  absent). The local apply (`r[k]=patch[k]`), `_myWrites` echo-stamp, undo, audit and `rebuild()` all run
  as before — a queued offline write returns ok and flows through the same optimistic path.
- **Read-offline** already existed (the IndexedDB stale-while-revalidate cache + `_cacheSaveSoon`, so an
  offline edit persists to the read cache too).
- **Field-level LWW**; online behaviour byte-identical to before. Composes with Phase-1 Realtime: a
  flushed offline edit streams to other viewers like any save.
- ⚠️ **Scope:** offline covers the **inline-edit `persist()` path only.** Bulk paths (import / global
  change / clear / leveling / bulk progress) and activity **delete/insert** stay **online-only** — not
  field scenarios, and queueing 40k offline rows is impractical. No migration. Verified: `node --check` +
  the shared outbox Node harness. NOT browser-verified (needs a real offline→online cycle). Assets: new
  `offline.js?v=20260726d`.

## Live collaboration — presence + live cell editing (2026-07-26) — fmlozano
Wired the shared **PDCollab** layer (`assets/js/collab.js`, Supabase Realtime) into the schedule grid —
same pattern proven on Drawing Register, plus two schedule-specific hardenings.
- **Wiring:** `maybeJoinCollab()` (re)joins a per-project channel in `load()` (guarded on pid change;
  `leaveCollab()` when no project); `key = project_schedule:<pid>`. `renderCollabPresence` → `#ps-presence`
  avatars. `broadcastCollabSel` fires from `_setCellFromClick` (column index → field via `_CELL_META`)
  and on `beginEdit`/commit. `paintRemoteCollab()` outlines each remote user's `.ps-grid-row[data-rowid]
  .ps-cell[data-field]` cell — called from the end of `highlightCells()`, so it re-applies after every
  virtualized `renderWindow` repaint. Only paints on the schedule tab (only it has cells).
- **Hardening 1 — coalesced remote changes + storm guard.** `_onRemoteChange` buffers postgres_changes
  and `_flushCollab` (180ms) applies the batch in ONE `rebuild()`+`renderAll()`. A **bulk storm**
  (import/global-change/clear fans out thousands of events) past **300** buffered → ONE `load()` reload
  instead of per-row patching. Essential: this is a 40k-row virtualized grid, not a small register.
- **Hardening 2 — echo suppression.** `persist()` stamps `_myWrites[id]`; `_applyRemoteRow` skips the
  Realtime echo of my own write for 4s (my optimistic local state is already correct), so an inline edit
  doesn't cause a redundant rebuild+render ~180ms later. Remote changes are also **deferred while an
  inline editor is open** (`_editing`).
- **Conflict model:** last-write-wins per cell (grid, not rich text); different fields of one row both
  win, same-cell clashes converge via each write's echo.
- **Migration `../../migrations/2026-07-26-realtime-collab-project-schedule.sql` (USER MUST RUN)** — adds
  `project_schedule` to `supabase_realtime` + `replica identity full`. Presence/cursors work WITHOUT it;
  only the live-value stream needs it.
- Verified: `node --check` + a Node harness for the coalesce/storm/echo/delete/defer logic (1 render for
  a 3-change burst, 0 for my own echo, 1 reload for 400 events, deferred-then-applied while editing).
  **NOT browser-verified** — needs two signed-in sessions. Assets `collab.js?v=20260726b`.

## Documents tab — schedule↔document link, phase 4 (2026-07-26) — fmlozano
Reciprocal of the Drawing Register / Material Submittal "Need-by" work: the schedule side of the
document connection. A drawing / submittal gates an activity's start, so each activity can now show
its enabling documents + whether they're approved in time.
- **New "Documents" detail tab** (`detDocs`/`wireDocs`, between Expenses and Relationships): lists every
  Drawing Register + Material Submittal row whose `schedule_activity_id` = this activity's `activity_id`,
  with type (DWG/MAT), name/desc, approval status (✓ when approved), lead days, and an **"Approve by"**
  date (need-by − lead). Header shows the activity's need-by (= its start) + a **readiness chip**.
- **`docReadiness(r)`** → ready / pending / at-risk (≤14d to need-by) / late (need-by passed) / null
  (nothing linked). Approved = drawing `Approved[ w/(o) comments]`, submittal `Approved[ w/ Comments]`
  (mirrors each register's own rule).
- **Lazy load** in `loadResourcesAssignments`: `DOC_DRAWINGS`/`DOC_SUBMITTALS` fetched with an explicit
  column list filtered to `schedule_activity_id NOT NULL` (only the linked subset — a handful/project,
  so one read, no pagination). **Tolerant** — if `migrations/2026-07-25-schedule-document-links.sql`
  hasn't run the column is absent, the query errors, caches stay empty, and the tab shows a hint.
- **Read-only** — linking is done from the register side (each document points at the activity it gates).
- Verified: inline script parses (`new Function`, 1 block, 0 fail). **Not browser-verified** (auth wall +
  needs a real project with linked documents + the migration run).
- **Deferred (deliberate):** a schedule-GRID document-readiness column + filter. The per-activity chip
  already surfaces the risk; a grid column across the virtualized 3-branch render (cell-count alignment +
  nth-child hide) is the risky change in this ~690KB concurrently-edited file — same call the register
  side made about grid changes. No `?v=` bump (module-local, no shared asset).

## Cell-nav horizontal autoscroll fixed (cells hidden behind frozen columns) (2026-07-22) — fmlozano
User: Left/Right/Tab cell navigation didn't autoscroll the columns correctly. Root cause in
`scrollCellVisible(r, c)`: the leading **#, Activity ID, Activity Name** columns are `position:sticky`
and float OVER the left edge of the scroll viewport, so a non-frozen cell can be scrolled *into* the
viewport yet stay **hidden behind those sticky columns**. The old check `if (left < sc.scrollLeft)`
ignored the frozen overlay entirely, so it never scrolled to uncover a left-obscured cell — and it
also scrolled pointlessly when the target itself was a frozen column.
- **Fix:** treat the frozen columns' combined width as the true left edge — reveal a left-obscured
  cell to `left − frozen − 4` (just past them), keep the right-edge case, and **no-op for frozen target
  columns** (they're always on-screen). `frozen` is summed from the row's first 3 children's live
  `offsetWidth` (hidden columns measure 0, so it's correct when columns are hidden/reordered off).
- **Verified live** (deployed, GPR101): deterministic replay of the exact math against real cell
  geometry — **all 11 visible columns are revealed from every scroll position (0 failures)** where the
  OLD algorithm failed all 21 in the tucked-behind-frozen case; the "failures" in a first pass were all
  hidden (width-0) cost columns, not real. End-to-end with real key events: ArrowRight scrolled 0→274
  (active cell revealed past the frozen columns), ArrowLeft scrolled 274→0 (active cell walked back,
  always visible). Module-local, no `?v=` bump.

## Gantt timeline no longer starts years before the schedule (2026-07-22) — fmlozano
User: the Gantt showed bars/timeline "all the way from 2022" though the schedule starts 2025.
**Not stray data** — verified live that the project's dates are clean (GPR101: all dates 2025–2029,
zero rows before 2024). Root cause: `range()` padded the scrollable timeline **2 YEARS before the
earliest activity and 3 after the latest** (`_min − 730` / `_max + 1095` days — the old "deep past/
future scroll" feature), and the Gantt opens at `scrollLeft 0`, so a 2025 schedule opened showing
empty years back to ~2023 (2024 for a project whose earliest start is late-2025; ~2022 for one
starting 2024). Confirmed live: GPR101's header spanned **2024–2032** for work that's really 2026–2027.
- **Fix:** padding tightened to a small margin — `_min − 31` days (≈1 month before) / `_max + 92`
  (≈1 quarter after; `_max` already extends +2 months). The pane still scrolls horizontally.
- **Verified live** (deployed): GPR101's header went **2024–2032 → 2026–2029**, opening at Nov/Dec 2025
  (the project starts Dec 22 2025) with summary bars at the left edge, no empty leading years; no
  console errors. Module-local, no `?v=` bump.

## One-call schedule_rows RPC — fast cold load (2026-07-22) — fmlozano
Follow-up to the cache-first work: cache makes *reopen* instant, but *cold first-open* was still ~8
sequential keyset round-trips (PostgREST caps table reads at 1000 rows). New SQL function
**`schedule_rows(p_project_id text) returns jsonb`** (migration
**`migrations/2026-07-22-schedule-rows-rpc.sql` — USER MUST RUN**) returns ALL of a project's rows as
a **single jsonb array in ONE round-trip** — a scalar jsonb return isn't subject to the max-rows cap.
`jsonb_agg(to_jsonb(t))` auto-includes every column (future-proof). **`security invoker`** so the
caller's RLS on `project_schedule` still applies (⚠️ never make it `security definer` — that would leak
cross-project rows). `grant execute … to authenticated`. Idempotent (create-or-replace + grant); lives
only in the migration, matching the sibling `schedule_scurve_agg` precedent (not in setup/schema).
- **Client:** `load()` calls `sb().rpc('schedule_rows', {p_project_id})` **first**; if it errors / isn't
  deployed, it **falls back to the keyset pagination loop** — so the app works before AND after the
  migration. Composes with the IndexedDB cache (RPC = fast cold/first open; cache = instant reopen).
- **Verified live** (deployed, migration NOT yet run): the RPC endpoint returns **404**, the client
  falls back to keyset, and a **17,122-activity project (Naga) loaded correctly** with no regression.
  The RPC *speedup* itself can't be verified until the migration runs (DDL needs DB privileges the
  in-browser anon client doesn't have) — after running it, the ~8 round-trips collapse to 1 automatically.

## Cache-first load — instant reopen (IndexedDB stale-while-revalidate) (2026-07-22) — fmlozano
User: "eliminate the loading time when the schedule is opened." **Measured the real bottleneck live**
first: Avesta (6,017 activities) cold-loaded in **~8.9s across ~8 sequential paginated round-trips** —
the wait is **round-trip latency × page count, NOT bytes**. So column-trimming ("lean columns") was
**deliberately not done** — it wouldn't cut the round-trips and risks silently dropping fields; the
real cold-load lever is a one-call server RPC (follow-up). Instead made **reopen instant**:
- **IndexedDB SWR** (`ps_schedule_cache`, store `rows`, keyed by project id). On open: if a cached row
  set exists (and its `uid` matches the logged-in user), paint it immediately with **no loading
  overlay** (`rebuild()` + `renderAll()` from cache), show a **"Cached · updating…"** badge, then
  re-fetch from the DB in the background and reconcile → **"Live"** (badge auto-hides), or
  **"Cached (offline)"** if the refresh fails. First open per project is unchanged (normal overlay).
- **Cached value is cleaned** — `_cachePut` strips `_`-prefixed fields `rebuild()`/CPM attach (some
  reference other rows → would bloat / break structured-clone); `rebuild()` recomputes them on load.
- **Edit-guard:** `_editSeq` bumps on every inline `persist()`; the background reconcile skips the
  `rows =` replace if an edit happened mid-fetch (that edit already hit the DB) so it never clobbers a
  live edit. `persist()` also debounce-recaches (`_cacheSaveSoon`).
- The cosmetic **count round-trip is skipped** on the cached path.
- **Verified live** (deployed, logged-in Chrome): reopening Avesta painted from cache in **~640ms vs
  ~8,900ms cold (~14×)** — the "Cached · updating…" badge fired (proving cache paint before network),
  then reconciled to "Live" and auto-hid; no console errors. The residual ~0.6s is local `rebuild()`
  (CPM/rollups), not network. Module-local, no migration, no `?v=` bump.
- **Follow-up for cold first-load:** a server-side RPC returning the whole schedule in one call (same
  pattern as `schedule_scurve_agg`) to collapse the ~8 round-trips into 1; and optional cross-project
  cache warming from the picker.

## Inline Status dropdown in the grid — one-click change (2026-07-22) — fmlozano
Changing an activity's status meant right-click → Edit activity → change the Status field — tedious on
10,000+ activity projects. The grid Status cell is now a **`<select>` styled as the coloured pill**
(`statusCellHtml`), so a writer changes status in one click directly in the grid. Read-only users
(`!canWrite` / `window.__viewOnly` / `__archived`) still get the static `<span>` pill.
- `change` is wired via re-attachment in `renderWindow` (rows are virtualized/windowed, like the
  `.ps-editable` dblclick wiring) and routed through **`_statusPatch`** (Completed → Actual Finish +
  100% + 0 remaining; In Progress → clear finish, reseed remaining; Not Started → clear actuals) and the
  undoable **`persist()`** — identical write path to the other inline cell edits, so it's undoable and
  has the same side-effect semantics as the detail-panel Status field. `mousedown`/`click`
  `stopPropagation` so opening the dropdown doesn't trigger row-select / cell-nav.
- WBS-summary / group rows keep an empty status cell (unchanged). Only ~visible rows render a select
  (grid virtualization), so no cost on huge schedules. Module-local, no migration, no `?v=` bump.
- **Verified live** (deployed, logged-in Chrome): on Avesta (real) the cells render as enabled selects
  with correct values; on the DEMO01 sandbox, changing M2003 Not Started → In Progress via the dropdown
  **persisted through a full DB reload** (searched it back, read "In Progress"), then restored to
  "Not Started". Screenshot shows every task row's Status as a "· ⌄" dropdown pill; WBS rows blank.

## Grid keyboard shortcuts never fired — hidden overlay tripped the guard (2026-07-22) — fmlozano
User: Arrow keys scrolled the panel instead of moving the selection; Tab traversed page buttons
instead of grid cells (not Excel-like). Root cause: the grid-shortcut `keydown` handler bailed on
`if (document.querySelector('.pd-modal-overlay, .ps-back.open, .ps-rep-back.open')) return;` — a
**bare presence** check. But `#ps-modal` **is** `.pd-modal-overlay` and is always in the DOM
(`display:none`), so the selector always matched and the handler returned before ANY branch
(Arrow/Tab/Enter/PageUp-Down/Home/End/F2/type-to-edit/Delete/Esc/Ctrl-C-X-V-D) — every key fell
through to the browser default (panel scroll / focus traversal). The line above already gates
`#ps-modal` via a `display` check, so this term was both redundant and wrong.
- **Fix:** iterate the overlay matches and bail only when one is actually **visible** (`offsetParent
  !== null`), so the always-present hidden `#ps-modal` no longer blocks; real open modals / `.ps-back.open`
  still block. Module-local, no `?v=` bump.
- **Verified live** (deployed app, logged-in Chrome) by reproducing the exact condition (temporarily
  removing the `.pd-modal-overlay` class from the hidden `#ps-modal`, which is what the visibility guard
  achieves): ArrowDown then prevents default (no scroll) and moves the selection across rows; Tab
  prevents default (focus stays in the grid, no button traversal) and sets the active grid cell.

## WBS Manager tree virtualized + verified live (2026-07-22) — fmlozano
Broad searches / Expand-all painted every visible row into the DOM (7,691 rows for a broad search on
the 8,596-node project → ~1s+). Now the render flattens the visible tree into `_wbsFlat` and only the
scroll-viewport window (+8-row buffer, ~24 rows) is in the DOM at once, offset by `translateY` over a
spacer that reserves the full scroll height — mirrors the grid/Gantt virtualization (`WBS_ROWH=34`).
- **Event delegation** on the persistent `#ps-wbs-tree` (attached once via `_wbsWire`) replaces per-row
  `onclick` — the window's rows are recreated on every scroll, so per-row handlers couldn't survive.
  Buttons dispatch by `data-*` key; focusing a name input selects its row via a class toggle (no full
  re-render → no blur mid-edit); scroll position is preserved across full re-renders (searches reset to
  top). Row height is fixed (34px) to match `WBS_ROWH`.
- **Verified live** on the 8,596-node project (deployed, logged-in Chrome): default 6 rows instant;
  **Expand all = 45ms with only 23 DOM rows** (was 1,433ms / 8,596 rows); search "Tower" = 34 matches /
  48-row set → 24 DOM rows; **extreme search "a" = 6,671 matches / 7,691-row set → 24 DOM rows, no
  freeze** (~400ms); delegated caret-collapse (→1 row) and row-select both work; screenshot shows the
  tree rendering correctly (hierarchy/codes/badges/carets/scrollbar). Window-slicing math unit-verified
  (~30 rows constant across 8,596). No console errors.
- ⚠️ **Caveat:** scroll-driven window repaint is gated behind `requestAnimationFrame` (same as the
  grid/Gantt). rAF is throttled when the tab isn't the OS-foreground window, so in the automated session
  programmatic `scrollTop` changes didn't repaint the window; in normal interactive use rAF fires and the
  window follows the scrollbar. The synchronous paths (expand/collapse/search) were verified directly.

## wbs_nodes load truncated at 1000 (fixed) + WBS Manager verified live (2026-07-22) — fmlozano
Found while verifying the WBS optimization **live on a large project** (deployed GitHub Pages, in the
user's logged-in Chrome). `load()` fetched `wbs_nodes` with a plain `select('*')` — Supabase caps at
1000 rows, so a big P6 import loaded a **truncated** tree; nodes whose parent fell past row 1000
dropped out of the walk. Live symptom: project **“4PH Jab Greenwoods Dasmariñas”** reported "1000
nodes" but rendered only 2 connected rows. **Fix:** keyset-paginate by `id` (the render/index re-sorts
by `sort_order`, so load order is irrelevant); same fix applied to the copy-WBS-from-project source
read. Same bug class as the audited resource_assignments/drawing/photos loads. No migration, no `?v=`.
- **After the fix, verified live** the project actually has **8,596 WBS nodes** (was capped at 1000):
  default load renders **6 rows** (large-tree collapse) instantly; **Expand all** → all 8,596 rows in
  ~1.4s (worst case); **Collapse all** → 1 row in ~114ms; caret toggle collapses/expands correctly;
  **Search** "Closeout" → 20 matches / 62 rows revealing each match **plus its full ancestor chain**
  (verified a 6-level-deep node: 1 → 1.4 Execution → 1.4.3 Superstructure → … → Closeout) in ~1s; clearing
  search restores the collapsed default. No console errors. (Very broad search terms render
  proportionally many rows — expected, same cost as Expand all.)

## WBS Manager optimized: indexed render + collapse/expand + search (2026-07-22) — fmlozano
`renderWbsManager` was O(N²)/O(N·rows) and painted **every** node at once — on a P6-scale tree
(~14k nodes / ~27k activities) it froze the tab. Per node it called `wbsActivityCount` (a full
`rows.filter` — ~378M iterations total), `wbsChildren` (filter+sort of all nodes), and `wbsDepthOf`
(linear `wbsById` walk). Fixes:
- **New `_wbsBuildIndex()`** builds `byId` / `childrenOf` (sorted) / `actCount` / `codeOf` in **one
  pass** at the top of the render; the walk uses those (no per-node scans). Benchmarked on a
  14,420-node / 27,600-activity fixture: the per-node-scan render cost dropped **11,171ms → 12ms**.
- **`computeWbsCodes` de-nested** the same way (was calling `wbsChildren` per level → O(N²·log N),
  now O(N·log N)). **Pure, identical output** (custom `code_custom` codes preserved, same sibling
  numbering + comparator) — verified against the old algorithm on a mixed fixture.
- **Collapse/expand** per node via a caret glyph (`_wbsCollapsed` set); only visible (expanded) rows
  are emitted, so the DOM stays small. Large trees (>300 nodes) **default-collapse** below the top
  level on load (`_wbsCollapseInit`, reset in `load()` + `selectProject`). Toolbar **Expand all /
  Collapse all** buttons. Adding a child auto-expands its parent so the new node is visible.
- **Search box** (`_wbsSearch`, 180ms debounce): reveals nodes whose code/name matches **plus their
  ancestors** (so matches are reachable), ignoring collapse on the matched path; shows a match count.
- Editing behavior unchanged — all existing row buttons (＋Act/＋/▲▼/→←/✎/✕), row-click select, and
  name-input rename are untouched. State (`_wbsCollapsed`/`_wbsSearch`/`_wbsCollapseInit`) resets on
  project switch + Clear. Module-local, no migration, no `?v=` bump. Inline script parses; index /
  codes / activity counts / search-visibility unit-verified in a Node harness.

## Last Planner section made collapsible (2026-07-22) — fmlozano
Follow-up to the merge below: the merged Last Planner block made the cockpit a long scroll on load,
so the `.ps-ck-secdiv` divider is now a **toggle button** (`#ps-lp-toggle`, a `<button>` styled as the
divider) with a rotating chevron; it collapses `#ps-lp-section` (all LP content wrapped in it) via a
`.collapsed` class → `display:none`. State persists in `localStorage['ps_lp_collapsed']`, applied on
init (default expanded). Wired next to the title-menu handler (same proven pattern). ⚠️ The chevron
`.ps-ck-secdiv-chev` needs `display:inline-flex` for the `rotate(-90deg)` to apply (an un-hydrated
inline icon span isn't transformable). Verified in a browser snapshot: only the `.collapsed` rule sets
the chevron transform, section toggles block↔none, no console errors. (Computed-transform readout is
unreliable in the static-snapshot renderer after a dynamic class change — the known quirk — so the
rotation was confirmed via the selector engine + the collapsed-state matrix, not the stale post-toggle
read.) Module-local, no `?v=` bump.

## Merged Last Planner into the Planner Cockpit tab (2026-07-22) — fmlozano
User felt the separate **Planner Cockpit** and **Last Planner** tabs were redundant / low-value as
two top-level views. Chose to **merge, not remove** (kept all functionality). The Last Planner
weekly section (week nav toolbar, PPC KPIs, weekly commitments table, PPC trend, reasons-for-variance)
now lives **inside `#ps-view-planner`**, below the cockpit KPIs/forecast, under a new
`.ps-ck-secdiv` divider ("Weekly Work Plan · Last Planner"). The `#ps-view-lastplanner` wrapper and
the `lastplanner` title-menu item are gone; `switchTab`/`renderAll` now call **both** `renderPlanner()`
and `openLastPlanner()` when the `planner` tab is active. All element IDs unchanged
(`ps-ck-*` vs `ps-lp-*` never collided), so every existing event handler keeps working; no DB change,
no `weekly_commitments` migration touched, no `?v=` bump (module-local HTML/CSS/JS only). Verified in
the browser: no console errors, `#ps-lp-table` resolves inside `#ps-view-planner`, `ps-view-lastplanner`
removed, menu down to planner/wbs/schedule/cost. Zero `lastplanner` references remain in the file.

## Cleanup: remove the dead old cost-TABLE code (2026-07-21)
Follows the Cost/EVM rebuild below, which orphaned the old per-activity cost table. Removed the
now-inert cluster (verified zero live refs first): `COST_COLS`, `_vc`, `costW`, `costColW`,
`costVisibleCols`, `startCostColResize`, and the now-dead `table.ps-cost-table` / `.ps-cost-th` CSS
(my WBS-overlap fix from `a109ae3` — that table no longer exists). Also simplified `renderColsMenu` to
drop its `onCost`/`COST_COLS` branch: the Columns chooser is only reachable on the Schedule tab (the
whole toolbar is `display:none` on other tabs, per `switchTab`), and the rebuilt Cost tab has no
hideable columns. **Behavior-preserving** — the removed branch was already unreachable,
`startCostColResize` had no callers, `applyColHidden` only ever used `gridCols()`. Verified: zero
remaining references to any removed symbol, script parses, and on the deployed page the Cost/EVM
dashboard renders and the Schedule column chooser still works.

## Cost Loading rebuilt → Cost / EVM dashboard (2026-07-21)
The old "Cost Loading" tab was a flat per-activity cost table — redundant (the Schedule grid already
shows per-activity Planned/Actual/EV/At-Completion IBB columns; the **Activity Usage** detail tab
already draws the time-phased per-activity cost curves) and low-value. Rebuilt into a **project-level
EVM dashboard** (tab relabelled **Cost / EVM**):
- **EVM KPI cards** at the data date: BAC, PV, EV, AC, SV, CV, SPI, CPI, EAC, VAC, TCPI + an over/under-
  budget · on/behind-schedule status chip. Math: PV = Σ budget × plannedPOC (planned % by data date);
  EV = Σ earned_value (fallback planned_cost × %); AC = Σ actual_cost; EAC = AC + (BAC−EV)/CPI;
  TCPI = (BAC−EV)/(BAC−AC).
- **Cost S-curve**: cumulative PV spread linearly across each activity's planned dates, with EV/AC
  plotted as points at the data date (no cost history is stored) + a BAC reference line.
- **Cost variance by WBS**: `_costMap` roll-up (Budget/Actual/Earned/CV/CPI/%Spent per branch),
  over-budget rows flagged red, + a project TOTAL row.
- `renderCost()` early-returns unless `activeTab==='cost'` (the EVM compute is heavier than the old
  table and `renderAll()` calls it every render). New DOM ids: `#ps-cost-status/-kpis/-curve/-note/-wbs`.
- The old flat-table helpers (`COST_COLS`, `startCostColResize`, `costColW/costVisibleCols`) are now
  dead code — left in place (inert; the cost-tab toolbar/column-chooser is hidden anyway). Minor cleanup TODO.
- Verified: inline script parses; EVM aggregation unit-tested (SV −10k/CV −15k/SPI 0.9/CPI 0.857/EAC
  350k/VAC −50k/TCPI 1.077 on a fixture); browser harness with a cost-loaded fixture rendered the KPIs
  (BAC 300k/EV 90k/AC 105k…), PV S-curve (13 months), status chip, and WBS table with no console errors.
  No migration, no `?v=` bump.

## THE ACTUAL "count populated, grid empty" bug: deferred render (2026-07-21)
**Verified on the deployed page** with a real 17,122-activity project (GPR101), driving the user's
logged-in Chrome. The screenshot bug reproduces on initial load: for ~8 seconds the footer reads
"Total: 17122 activities" while the grid still shows **"Select a project."**, then it self-corrects
at ~t=10s. **This is NOT the switch race fixed just below — that fix was correct but addressed a
different failure mode.** Root cause, from the live timing (footer set at t≈2s, grid painted at
t≈10s, overlay already hidden in between):
- `load()` finishes pagination (~2s), `hideLoading()`, `rows = all; rebuild()` → **footer count set
  immediately**.
- It then `await`s `loadResourcesAssignments()` + `_wbsEnsureSummaries()` — several seconds for a 17k
  activity project (many resource/assignment rows) — and **only called `renderAll()` AFTER those**.
- So the grid kept the stale pid=null "Select a project." paint for the whole resource-load window
  while the footer already showed the count.
- **Fix:** call `renderAll()` right after `rows = all; rebuild()` (and moved the large-schedule
  collapse block up before it), *then* load resources, *then* `renderAll()` again. The grid/Gantt
  only need `rows`; resources + WBS_NODES are for the Resource-Usage tab and WBS Manager, so painting
  before them is safe. Window drops from ~8s to ~0 (pagination is covered by the loading overlay).
- Verified live that the render itself works (a user-triggered switch to the same 17k project paints
  correctly — footer + grid consistent); the only defect was the *timing* of the paint. Re-verify on
  the deployed page after this ships. Module-only, no `?v` bump.

## Load race: footer count populated while grid shows "Select a project." (2026-07-21)
Reported from a screenshot: a big schedule (16,409 activities) with the footer reading
"Total: 16409 activities" but the grid showing "Select a project." — the count and the grid
disagreeing about whether a project was even selected.
- **Root cause: `load()` was async + keyset-paginated (up to ~17 sequential round-trips for a 16k-row
  project) with NO re-entrancy guard.** Switching or deselecting a project mid-load left the STALE
  load to run its terminal `rows = all; rebuild(); … renderAll()` after `pid` had already changed —
  clobbering `rows`, the footer count, and the rendered grid with the wrong project's state. The exact
  visible symptom depends on the precise rAF/await interleaving (grid can end up empty *or* showing a
  deselected project's rows); both are the same bug.
- **Fix: a monotonic load token `_loadGen`.** `load()` does `var gen = ++_loadGen` at entry and, after
  **every await** (each pagination page, the catch, before the commit `rows = all`, after
  `loadResourcesAssignments`, after `_wbsEnsureSummaries`), bails with `if (gen !== _loadGen) return`
  if a newer load has started. The `!pid` early-return branch now also `hideLoading()`s, since a stale
  load aborts silently and never touches the overlay (the newest/terminal load owns it). Covers every
  `load()` caller (project switch, undo/redo, import, scenario restore) uniformly.
- **Verified in a Node harness** modeling the real `load()`/`rebuild()`/`doRender()` + rAF deferral:
  WITHOUT the guard, deselecting or switching mid-load leaves pid/footer/grid inconsistent in 2 of 3
  scenarios; WITH the guard all three are consistent (deselect → "Select a project." + count 0;
  re-select same project → loads normally). Full inline script still parses. No shared asset, no `?v`
  bump. (Live click-through needs a real 16k-row project + a mid-load switch — the harness stands in.)

## Brand icon beside the title (2026-07-21)
The title is a **view-switcher button** (`.ps-title-btn`), so unlike every other module it never had
the brand-red module icon before its text — the `calendar` icon (the module's `config.js` icon) only
appeared inside the dropdown menu items. Added `<span class="ps-title-ico" data-ico="calendar">` before
`#ps-title-txt` inside the button, so it's `[calendar] Project Schedule ▾` matching the suite.
- ⚠️ Existing `.ps-title-btn [data-ico] { color:var(--pd-muted) }` (for the chevron) also matches the
  new icon. Override with **`.ps-title-btn span.ps-title-ico`** (0,2,1) which outspecifies it (0,2,0)
  regardless of source order. Verified the icon is brand-red (`#EE3124`) while the **chevron stays
  muted** — the override is scoped, not bleeding to the chevron.
- Kept it inside the switcher button on purpose: clicking the icon still opens the view switcher.
- Verified in a harness (real title markup + module CSS + icons.js): icon hydrates to SVG, brand-red
  via `currentColor`, 20×20, left of the text, chevron muted, order ICON→TEXT→chevron, and stays
  brand-red in dark mode. Screenshot still impossible (compositor stall) — measured via
  getComputedStyle. Module-only, no shared asset, no `?v` bump.

## Cost Loading tab: WBS/name overlap + duplicate-ID fixes (2026-07-21)
Reported: the Cost Loading table's WBS code visually overlapped the Activity Name (e.g.
"1.4.2.5.2.3.1Cabinetry" with ghosted text). Two real bugs found:
- **Overlap (visible).** `.ps-cost-table` is `table-layout:fixed`, but `.ps-table td` had **no
  overflow clipping** — so a WBS `<code>` wider than its 90px column bled straight into the next
  cell. Fixed with `table.ps-cost-table td { overflow:hidden; text-overflow:ellipsis; white-space:nowrap }`
  (full value now on hover via a `title` attr set in `renderCost`), widened the WBS column 90→120,
  and monospaced the code. ⚠️ **Specificity gotcha:** headers wrap via `table.ps-cost-table th` (0,1,2)
  because plain `.ps-cost-th`/`.ps-cost-table th` (0,1,1) is *outspecified* by `.ps-table th`'s
  `white-space:nowrap` which appears later in the sheet — so headers now WRAP ("Planned % (POC)"
  instead of clipping to "(PC") instead of being cut mid-word.
- **Duplicate `id="ps-cost-body"` (latent).** The Cost Loading `<tbody>` AND the "Cost Accounts (CBS)"
  modal panel both used it. `renderCostAccounts()` grabbed the first match (the hidden cost tbody),
  so the CBS manager wrote into the wrong element and appeared empty. Renamed the panel to
  `ps-cost-acct-body` + its one reader.
- Scope is safe: the new rules match `table.ps-cost-table` only — the two import-preview `.ps-table`
  tables lack that class and the Schedule grid uses `.ps-grid-*`, so neither is touched.
- **NOT a bug: the ₱0 / "—" cells.** That project's schedule was imported from P6/OPC with no cost
  loaded, so planned/actual/EV are genuinely 0 and baseline/CPI are null (—). Nothing to "fix" there.
- Verified in a browser harness using the module's real `<style>` + long screenshot WBS codes at the
  actual 12-column widths (sanity-asserting the CSS loaded first): WBS cell clips with no overlap into
  Activity Name, title tooltip present, and all 12 headers wrap to 2 lines with **none clipped**.
  Screenshot still impossible (compositor stall) — measured via `getBoundingClientRect` /
  `getComputedStyle`. Module-only change (project-schedule/index.html), no shared asset, no `?v` bump.

## Audit fix: paginate resource_assignments (2026-07-21)
`loadResourcesAssignments()` fetched `resource_assignments` with a single `select('*')` — Supabase
caps at 1000 rows, so P6/XER projects (~51k–55k assignments) silently loaded only the first 1000,
corrupting Resource/Role Usage, resource leveling and cost roll-ups. Now **keyset-paginated**
(`order id.asc`, `gt(id,last)`, `limit 1000`), matching the main activity `load()`. Assignment order
is irrelevant (aggregated by activity). Verified: parses clean; Node test confirms the loop loads all
rows (2500/2500) and terminates. No migration, no `?v=` bump. (Also see the RLS project-scope fix
migration `2026-07-21-rls-project-scope-fix.sql` — the schedule support tables' reads/writes are now
project-scoped.)

## Clear didn't clear, and re-import duplicated every WBS level (2026-07-17) — fmlozano
Two reports, **one root cause**: `wbs_nodes` was never deleted by any destructive path. Clear schedule
and both importers' "Replace existing" only ever ran `delete().eq('project_id', pid)` on `TABLE`
(`project_schedule`). The tree is a **separate table**, and the grid's WBS rows are only a *projection*
of it — so the nodes always survived, and the two symptoms fall straight out of that:
- **"Clear did nothing."** Clear deleted the summary rows, then `load()` → **`_wbsEnsureSummaries()`**
  (the orphan self-heal added 2026-07-16) faithfully re-projected a summary row for every surviving
  node. The rows were genuinely deleted and then immediately recreated — working as designed, on a
  tree that should no longer have existed. ⚠️ **These two features are only correct together**: the
  self-heal makes any path that drops schedule rows *without* dropping nodes look like a no-op.
- **Re-import duplicated the WBS levels.** "Replace" wiped `project_schedule`, so the importer's fresh
  summary rows all arrived with `wbs_node_id = null` → `autoAdoptAfterImport()` → `wbsAdopt()` mapped
  **every** legacy row to a new node payload with no check against the codes already in `WBS_NODES`
  (`nodeByCode` was seeded from them, but only ever *read* for parent lookup). One extra node per code
  per import, each then re-projected by the self-heal into another summary row.
- **Fixes.** (1) New **`_clearWbsTree()`** — deletes the project's `wbs_nodes` and resets the in-memory
  `WBS_NODES`; tolerant of a DB without the wbs-nodes migration (nothing to clear is not an error).
  Called by the Clear handler (which now also resets `_wbsSel`, and says "activities **and the entire
  WBS tree**" — it always destroyed more than the old copy admitted) and by the `replace` branch of
  **both** `doImport` and `doImportXER`; the tree is rebuilt from the incoming file by the existing
  `autoAdoptAfterImport()`. (2) `wbsAdopt` now builds node payloads only for codes **not already in
  `nodeByCode`** — the link loop below it already resolves each code through `nodeByCode`, so an
  existing node is **adopted and linked** rather than re-inserted. Belt-and-braces: it makes adopt
  idempotent on its own, so a re-run can't duplicate even if a tree survives some other way.
  ⚠️ Do **not** "simplify" this by filtering the `legacy` list instead — skipping those rows leaves
  them with `wbs_node_id = null`, and the self-heal then duplicates the *summary rows* instead.
- **Verified in a node simulation** of the real cycle (import → re-import ×3 → load) against a mutable
  store, mirroring `wbsAdopt` + `_wbsEnsureSummaries`. Reproduced the bug from the **shipped** code
  exactly — 4 codes → `1 x4, 1.1 x4, 1.2 x4, 1.1.1 x4`, self-heal adding 12 rows (matching the
  reported screenshot's repeated "1.1 Project Milestones") — and confirmed the fix holds at 4 nodes /
  4 summary rows / 0 duplicates / 0 unlinked across 3 re-imports; Clear+load now leaves **0** rows
  (was 4 resurrected). Not yet clicked through on a live login (needs a session + a project).
- **Existing duplicated data is not migrated** — the fix stops new duplicates, it doesn't clean up the
  ones already in the DB. Remediation is now possible for the first time: **Clear schedule → re-import**.
- **No migration.** `project_schedule.wbs_node_id` is a plain uuid with **no FK** to `wbs_nodes`, so
  deleting nodes first can't raise a constraint error and the delete order doesn't matter.

## Column chooser clipped by the details panel (2026-07-16) — fmlozano
The `+` column chooser (`#ps-cols-menu`) was cut off mid-list — worse the further up the details
panel was dragged.
- **Root cause:** `.ps-split` sets **`overflow:hidden`** (line ~243, for its border-radius + pane
  clipping), and `.ps-cols-corner`/`.ps-cols-menu` are absolutely positioned **inside**
  `.ps-grid-pane` within it. So the menu was clipped at the split's bottom edge — i.e. wherever the
  details panel happened to push it. The chooser's own `max-height:340px; overflow-y:auto` was
  useless here: the **ancestor** did the clipping, so the scrollable remainder was unreachable (this
  is a *different* bug from the 2026-07-14 cascade fix below, which made it scroll at its own cap).
- **Fix:** `positionColsMenu()` pins the menu to the **viewport** (`position:fixed`, re-anchored to
  the button's rect on every open) — which escapes every ancestor's overflow — and caps
  `max-height` to the real space below the button (`innerHeight − r.bottom − 16`, floor 180). Same
  approach `openRowMenu` already uses. Re-anchored on `resize` + `scroll` (capture phase, so it also
  catches ancestor scrolls) while open, since fixed positioning is viewport-relative.
- **Verified in a browser harness** against the module's real CSS, using `elementFromPoint` (CSS
  overflow clipping doesn't shrink `getBoundingClientRect`, so a rect check would have missed it):
  with a 280px split — before: content 726px, capped to 340px, **103px of that clipped away**, bottom
  not hittable (`bottomOfMenuActuallyVisible:false`); after: fully visible. At a 600px-tall viewport:
  menu bottom 588 ≤ 600 (fits), scrolls internally (517px box / 707px content), scrolls to the end,
  right edge still aligned to the button.

## WBS added in the Manager didn't appear in the Schedule (2026-07-16) — fmlozano
Reported on **Naga City Integrated Terminal**: adding a WBS Level 1 in the WBS Manager showed the node
in the tree but **nothing in the Project Schedule**; an activity added under it *did* appear.
- **Mechanism (explains both halves).** The tree lives in `wbs_nodes`; the grid only ever renders
  **projected `project_schedule` WBS-Summary rows**. Two writers, inconsistent treatment of
  `wbs_node_id`: the activity `save()` deliberately keeps it **out** of the main payload and writes it
  after in its own try/catch ("so a not-yet-migrated DB never breaks the main save"), but
  `wbsAddChild`'s projection insert put `wbs_node_id` **in** the payload — so on a DB missing that
  column the activity insert survives and the summary insert fails. And the failure was **silent**:
  `if (!sres.error && sres.data) rows.push(...)` dropped the error on the floor. Node in the tree, no
  schedule row, no message.
- **Fix:** new **`_insertWbsSummary(payload)`** — retries without `wbs_node_id` when the error names
  that column (warn toast: "Saved without the WBS link — run the wbs-nodes migration"), and **surfaces
  any other error** instead of swallowing it. Used by `wbsAddChild` and the copy-from-another-project
  path (which had the identical swallow).
- **CONFIRMED (2026-07-16):** the column really was missing — the user ran
  `migrations/2026-07-07-wbs-nodes.sql` only after hitting this, so every node created before that ran
  lost its projection. (An `information_schema` check *after* the migration shows the column present,
  which briefly looked like a disproof — it isn't; it's just post-migration state.)
- **Orphan nodes + `_wbsEnsureSummaries()` (the actual repair).** The failure left Naga with 3 nodes in
  `wbs_nodes` and **zero** WBS-Summary rows: visible in the WBS Manager, absent from the Schedule, and
  **unrepairable** — "Adopt existing WBS" only runs the other direction (summary rows → nodes), and its
  button is hidden precisely when there are no summary rows to adopt. New `_wbsEnsureSummaries()`
  re-projects any node lacking a summary row; it is **additive + idempotent** (keyed on
  `wbs_node_id`, so a reload can't duplicate) and gated on the new module-scope **`canWrite`**
  (super_admin/admin/planner — mirrors `is_planner()`) so a read-only user never triggers a write on
  load. Called from `load()` (after `loadResourcesAssignments`, which populates `WBS_NODES`) and at the
  top of `_wbsCommit()`. No-op on healthy projects. Verified in a node harness against Naga's exact
  state: 3 nodes → codes 1/2/3, second pass finds 0 missing, activities at `wbs "1"` nest under the
  restored Pre-Development row.
- **Related inconsistency (not fixed):** `2026-07-07-wbs-nodes.sql` was folded into `supabase-setup.sql`
  but **NOT into `supabase-schema.sql`** (0 mentions of `wbs_nodes`/`wbs_node_id` there), so any DB
  built from `supabase-schema.sql` lacks both the table and the column — i.e. this bug is still
  reproducible from a fresh schema build. Worth reconciling.
- **Dead read-only guards (pre-existing, NOT fixed):** neither `window.__viewOnly` nor
  `window.__archived` is **ever assigned** anywhere in the repo — both are read in ~8 guards each and
  are permanently `undefined`, so the intended "read-only / archived project" protections do nothing.
  This is why `canWrite` above had to be introduced rather than reusing `__viewOnly`.

> **Claude / developer: read this first.**
> 1. Read `../../MODULE_CONTRACT.md` and `../../CONTRIBUTING.md` (NOT auto-loaded).
> 2. This module is **Project Schedule & Cost Loading** (Phase 2). Your DB table is `project_schedule`
>    (defined in `../../supabase-schema.sql`; starter columns only — extend as needed).
> 3. Best reference to copy: **risk-register (plain CRUD; add a Gantt/cost-loading table as needed)**.
> 4. Work only inside this folder, on branch `module/project-schedule`, then PR to `main`.
> 5. Update this file as you build.

## Activity Progress: centered %-cells + Pie presentation with activity data-selection (2026-07-17c) — jasantos2 / eprobles
- **Centered cells:** No. / Planned Value % / Activity % Complete cells centered for task + WBS rows
  (`PROG_DEF[k].center` → `.ps-prog-cc`), matching the centered headers.
- **Presentation toggle (Table / Pie chart):** persisted `ps_progpres`. Pie mode (`renderProgressPie`)
  draws an SVG pie where each **selected** activity is a slice, sized by a metric (`ps_progmetric`:
  Activity % Complete or Planned Value %), full-circle when a single 100% slice; colours matched between
  slices and the legend.
- **Data selection:** a checklist of activities with All/Clear (`ps_progsel` per project; null = all) —
  tick which activities appear in the pie; `wireProgCtrls` handles the toggle, metric, checkboxes.
- Parses clean; served-file check passed.

## Duration model: baseline-locked planned, live actual, independent remaining, at-completion (2026-07-17b) — jasantos2 / eprobles
- **Planned (original) duration = BASELINE span** (`_origDurOf` prefers BL finish − BL start + 1), else the
  current span, else duration_days. **Locked/read-only when a baseline exists** — grid DUR cell drops
  `ps-editable`, detail shows `_gro` "baseline (locked)" instead of the editable `_gfPdur`. New `_durLocked`.
- **Actual Duration is computed LIVE** = data date − actual start (or actual finish − start once done) via
  `actualDurLive`; the detail field is now read-only (was an editable stored number), so it tracks the
  data date. Actualize today → actual 0; data date next week → actual = 7.
- **Remaining Duration is independent**: on start (`_fcFields` / actualize) it seeds to the **full planned
  (baseline) duration** (so "actualized today → remaining = planned"), then only changes on explicit edit
  (no auto-reduction as the data date advances).
- **At Completion = actual duration + remaining duration** (`_atCompletion`; = planned duration when not
  started). Verified: baseline 10 → actualized today {actual 0, rem 10, AC 10}; data date +7 {actual 7,
  rem 10, AC 17}; planned = baseline 10 (not current-span 20). Parses clean.

## Fix: CPM successors now follow the in-progress forecast finish (2026-07-17) — jasantos2 / eprobles
- **Bug:** an FS successor (e.g. Milestone 2) didn't move to follow its in-progress predecessor's
  forecast finish on Schedule. Cause: `cpmLogic` set a started activity's `_ef = es + scheduled span`,
  ignoring Remaining Duration — so the predecessor's early finish used its original span (later than the
  displayed forecast) and the successor clung to that.
- **Fix (retained logic):** for a started, not-finished activity with a Remaining Duration, `_ef` is now
  `max(es, dataDate) + remaining` (exclusive) — the forecast finish that the grid/Gantt already show —
  so successors reschedule off the forecast. Milestones stay 0-duration. Verified: Activity 2 forecast
  Sep-3 → Milestone 2 schedules to Sep-4 (was stuck at Sep-7). Parses clean.

## Progress-view No. col + centering + per-cell formatting; grid renames + cell format; Gantt header fix (2026-07-16z) — jasantos2 / eprobles
- **Activity Progress view:** added a **No.** column (running activity number; default first). **All
  headers centered**; **Planned Value % / Activity % Complete cells centered** (`.ps-prog-ctr`).
  Renamed columns to **Planned Value %** / **Activity % Complete**.
- **Per-cell manual formatting** (both views): new store `ps_cellfmt` = {pid:{rowId:{col:{b,i,sz,fg,bg}}}}
  + `openCellFmt` popover (Bold / Italic / Size / Text colour / Fill / Clear). Progress cells:
  right-click. Grid cells: right-click → **Format cell…** in the row menu. Applied on render
  (`_cellFmtStyleAttr` inline for Progress; `applyCellFmtGrid` post-paint for the virtualized grid,
  keyed by data-id + data-field).
- **Grid column renames:** `Planned Value POC` → **Planned Value %**, `Physical % Complete` →
  **Activity % Complete** (GRID_COLS).
- **Fix — Gantt date header vanished when the details panel was unchecked:** `syncHeadHeights` set the
  Gantt header to the grid header's measured height, which could read 0 mid-relayout after the toggle.
  Now floored to the natural header height (68px with the column-filter row, else 38px) and re-synced on
  the next frame after `applyLayout`.
- Parses clean; served-file check passed.

## Specific Description → remarks (always saves) + remove Notebook/Files tabs (2026-07-16y) — jasantos2 / eprobles
- **Specific Description now persists reliably** — stored in the existing `remarks` column (a real
  project_schedule column) instead of the un-migrated `specific_description`, so it always saves with no
  "run the pending migration" toast. The Progress-view desc cell + wiring now use `remarks`; the General
  detail "Notes/Remarks" field is relabeled **Specific Description** (same `remarks` field), so the two
  views stay in sync. Deleted the unused `2026-07-16-activity-specific-description.sql` migration.
- **Removed the Notebook and Files detail tabs** (buttons + render cases) — they wrote to un-migrated
  `notebook`/`files` columns and surfaced the tolerant-write migration warning. (`detNotebook`/`detFiles`
  left in as dead code, no longer reachable.)
- Parses clean; no console errors.

## Activity Progress view — resizable rows + columns (bars scale) (2026-07-16x) — jasantos2 / eprobles
- **Column width resize** (Progress view only): drag a header's right edge (`.ps-prog-colres`) → per-column
  width persisted to `ps_progcolw`; table is `table-layout:fixed`. The resizer suppresses the header's
  drag-reorder (`th.draggable=false` during the drag).
- **Row height resize**: drag any row's bottom edge (`.ps-prog-rowres`) → **uniform** row height (`--prog-rh`,
  persisted `ps_progrh`, clamped 22–200). The dual bar tracks are sized `calc((--prog-rh − 16)/2)`, so bars
  **scale with row height**. Default 38px.
- **Scoped to the Progress view** — the Gantt/grid `ROWH` is unchanged (Gantt rows not resizable).
- Parses clean; served-file check confirms colres/rowres/bar-scale present and Gantt ROWH untouched.

## Progress view revisions + Megawide WBS colors (2026-07-16w) — jasantos2 / eprobles
- **Dual progress bars:** the Progress column now shows two bars — **P** (grey = Planned POC) over **A**
  (red = Actual/Physical %), each with its %.
- **Configurable column order:** default **ID · Activity Name · Specific Description · Progress · Planned
  POC · Physical %**; headers are **drag-to-reorder**, persisted to `ps_progcols` (`progColOrder` +
  `PROG_DEF`/`_progCell` render columns from the order array).
- **WBS rows match the grid scheme** in the Progress table (same `--wl` level palette, red left accent).
- **WBS colors → Megawide black/grey/red:** `.ps-wl0…5` re-tinted to a greyscale gradient (main WBS
  darkest → deepest lightest) with **red / dark-red / black** left accents (light + dark), replacing the
  blue tint. Same palette mirrored onto `.ps-prog-table .ps-wl*`.
- Parses clean; served-file feature check passed.

## Physical % gate, WBS Duration roll-up + shades, Activity Progress view (2026-07-16v) — jasantos2 / eprobles
- **Physical % Complete edit gate:** editing `percent_complete` now requires an **Actual Start** (toast
  otherwise) and is forced to **100%** when the activity is complete — enforced in the grid `beginEdit`,
  the Status-tab `wireEditFields`, and the new Progress view.
- **WBS Duration % Complete roll-up:** `_costMap` now accumulates `wdur` (Σ original duration) and
  `wdurE` (Σ origDur × durPct/100); WBS `c-durpct` cell shows `wdurE/wdur` (duration-weighted). Verified
  33% for od 10@50% + od 20@25%.
- **WBS level shading:** `.ps-wl0…5` re-tinted to clearly distinct stepped blue-grays (main WBS darkest
  → deepest sub-WBS lightest) with a per-level left accent bar; matching stepped dark-mode palette.
- **Activity Progress view** (new): toolbar **Progress** toggle (`ps-progressbtn` → `.ps-progress-mode`
  hides the split/network/legend, shows `#ps-progress`). Dateless table — **ID · Activity Name ·
  Progress bar (fill = Physical %, line marker = Planned Value POC) · Physical % (editable, gated) ·
  Planned POC · Specific Description (editable)**. WBS rows show the duration-weighted roll-ups and level
  shade. New `specific_description` text column — migration
  `migrations/2026-07-16-activity-specific-description.sql` (**user must run**); saved tolerantly via
  `_saveActField` so it works pre-migration. `renderProgressView` hooked into `renderAll` when active.
- Parses clean; served-file feature check + roll-up math verified.

## Duration % Complete edit gate: started-only, complete=100% (2026-07-16u) — jasantos2 / eprobles
- **Duration % Complete is only editable once the activity is started** (has an Actual Start) — both the
  grid `dpct` commit and the Status-tab `dpct` handler reject the edit with a toast when `actual_start`
  is missing, and block editing when the activity is complete (it's fixed at 100%). `_durPct` already
  returns 100 for a completed activity (Actual Finish / status Completed). Parses clean.

## Duration % Complete grid column — editable (2026-07-16t) — jasantos2 / eprobles
- Added a **Duration % Complete** column to the activities grid (after Physical % Complete). New
  `['durpct','Duration % Complete','c-durpct']` in GRID_COLS, `--c-durpct` width + `.c-durpct` CSS, cell
  in all three `costCellsHtml` branches (value on tasks; blank on WBS/group, no duration-% roll-up).
- **Editable** (double-click) via a new `dpct` type in the grid `beginEdit` — sets **Remaining Duration**
  = original × (1 − %), leaving Physical % Complete untouched (same behavior as the Status-tab field).
  Verified: 40% on a 20-day original → remaining 12 → reads back 40%. Parses clean.

## Fix: negative lag merged into hyphenated activity ID on drag-to-link (2026-07-16s) — jasantos2 / eprobles
- **Bug:** linking with a negative lag via drag-to-link stored e.g. `2-A1010-15` (id merged, lag 0)
  instead of `2-A1010 FS-15`. Cause: `commitLink` appended the lag with **no separator** when the type
  was FS, and since activity IDs contain hyphens the parser's ID group swallowed the `-15`.
- **Fix:** `commitLink` now emits the type token (`FS`) as a separator whenever there's a type **or** a
  lag — matching `serializeRels`/`addPred` which were already correct. Verified: `2-A1010 FS-15` →
  id `2-A1010`, lag −15. (Existing bad predecessors must be removed + re-added.) Parses clean.

## Negative lag (lead) — confirmed supported + link-chooser hint (2026-07-16r) — jasantos2 / eprobles
- **Negative lag was already honored end-to-end**: all lag inputs (Add modal `#ps-pred-lag`,
  Relationships `#ps-rel-lag`, drag-to-link chooser) are unbounded number fields; `predRels` parses the
  sign; `relCandidateES` FS = `p._ef + lag` (SS/FF/SF likewise), so a negative lag pulls the successor's
  early start before the predecessor's finish (verified: A ef=10, B `FS-3` → es=7, overlap).
- Added the **"negative = lead/overlap"** hint + `title` to the drag-to-link chooser lag input (the
  other two lag inputs already had it). Applied on **Schedule** (CPM reschedule); the data-date floor
  still prevents scheduling an unstarted start before the data date. Parses clean.

## Baseline (planned) milestone marker in the Gantt (2026-07-16q) — jasantos2 / eprobles
- Milestones now show a **baseline/planned diamond** like activity bars show a baseline bar. New
  `.ps-mile-bl` (hollow diamond in the baseline colour) drawn at the milestone's baseline date —
  `bl_finish` for a Finish Milestone, `bl_start` otherwise — when `_gset.baseline` is on. It sits above
  the current (solid) diamond, which drops to `top+15·oY` when a baseline is present (baseline-above/
  current-below, matching the bars). No baseline → current diamond stays centered. Parses clean.

## Milestone types reduced to Start/Finish + point-event logic (2026-07-16p) — jasantos2 / eprobles
- **Removed the generic "Milestone" type** from all dropdowns (Add/Edit modal, General detail, Filter)
  — only **Start Milestone** / **Finish Milestone** remain. Legacy `Milestone` rows still read as
  milestones (isMile keeps it) so old data isn't broken.
- **Point-event logic:** milestones are zero-duration single-date events. `_origDurOf` returns 0 for
  any milestone. New `_dateEditPatch` milestone branch: editing the planned date sets **start_date =
  end_date** (single point); setting an actual date **achieves** the milestone (both actuals = the
  point, Completed/100%/0 remaining); clearing reopens it. Gantt anchors a **Finish Milestone on the
  finish**, a Start Milestone on the start.
- **Imports classify correctly:** XER uses `task_type` (`TT_FinMile` → Finish Milestone, else Start
  Milestone); the Excel importer maps finish-only 0-day rows → Finish Milestone, else Start Milestone.
- Verified: start/finish date edits sync both dates, actualizing completes the milestone, legacy
  Milestone still recognized. Parses clean.

## Start/Finish milestone types + no-predecessor milestone rides the data date (2026-07-16o) — jasantos2 / eprobles
- **Two milestone classifications:** added **Start Milestone** and **Finish Milestone** to the type
  dropdowns (Add/Edit modal `#ps-f-type-sel` + General detail). `isMile` recognizes both; new
  `isFinishMile`. In the Gantt a **Finish Milestone anchors on the finish date** (`e`), a Start
  Milestone / generic Milestone on the start (`s`).
- **No-predecessor milestone follows the data date:** in `shiftUnstartedToDataDate`, an unstarted
  milestone with **no predecessor** (nothing drives its date) now snaps **exactly to the data date**
  in either direction (a "you are here" start/finish anchor). Milestones that DO have a predecessor are
  left alone (they follow the predecessor via CPM). This runs on **Schedule** (with Retained Logic +
  Use-actual-dates on, the defaults), so hitting the data date + Schedule moves the milestone.
- Verified: no-pred milestone at Aug-12 or Sep-05 → snaps to data date Aug-18; with-predecessor
  milestone → not snapped; both new types read as milestones. Parses clean.

## Fix: actualizing a future start collapsed the finish to the start (2026-07-16n) — jasantos2 / eprobles
- **Bug:** actualizing a start that falls AFTER the data date made the finish equal the start. Cause:
  `forecastFin` scheduled remaining work from `today()` (data date), so `data date + remaining − 1`
  landed before the (future) actual start and the `if (f<as) f=as` guard clamped it to the start.
- **Fix:** remaining work is now scheduled from **max(data date, actual start)**, so a future actual
  start forecasts (actual start + remaining − 1) and retains its duration. Verified: actual start
  Sep-3 + remaining 8 (data date Aug-18) → finish Sep-10 (was Sep-3). Parses clean.

## Bar-border color + fix Actualize Start missing from context menu (2026-07-16m) — jasantos2 / eprobles
- **Bar border editing:** added a **Bar border** color to the Colors menu (`--ps-bar-bd`, default
  transparent). `.ps-bar` now has `border: var(--ps-bar-bw,1.5px) solid var(--ps-bar-bd,transparent)`
  with `box-sizing:border-box` (no size change); persists per project, clears on Reset to brand.
- **Fix: Actualize Start was missing** from the right-click menu. When the Start cell was rebound to
  `start_date` (scheduled) until actualized (prompt 16k), the menu's `showStart` still only matched
  `actual_start`, so right-clicking a not-started Start cell hid the Start actions (Finish still showed).
  `showStart` now also matches `start_date`. Parses clean.

## Fix: negative CPM duration corrupted successor scheduling (2026-07-16l) — jasantos2 / eprobles
- **Bug:** a successor (e.g. "Signing of Contract", FS pred = "Contract Final review") scheduled far
  too early. Root cause: `cpmLogic` set `t._dur = (end_date − start_date)/day + 1`, so an activity with
  an inconsistent **end_date before its start_date** got a **negative** `_dur` (−66 in the repro) →
  its early finish landed before its start → the FS successor's early start (= predecessor finish) was
  pulled way back.
- **Fix:** `_dur` is now clamped — milestones = 0, everything else `Math.max(1, span)` (falls back to
  `duration_days`, then 1) — so inconsistent dates can never make it negative. After this, running
  **Schedule** pushes the successor to follow its predecessor correctly.
- Note: successor dates apply on **Schedule** (CPM reschedule, like P6's F9), not automatically on each
  edit. Also fix the source row whose finish precedes its start (edit its Finish/Duration). Parses clean.

## Interactive Start/Finish/Duration + WBS baseline roll-up dates (2026-07-16k) — jasantos2 / eprobles
- **Planned Duration is now the interactive span** = (scheduled finish − effective start + 1);
  `_origDurOf` derives it from `dispStart`/`end_date` (not the forecast, so no loop with Remaining/%).
  Editing the **scheduled Start** keeps the Finish and adjusts the duration; editing the **Finish**
  (not-started) keeps the Start and adjusts the duration; editing the **Duration** keeps the start and
  moves the Finish (`_pdurPatch`). Verified: 10 → edit finish 15 → edit start 13 → edit dur 8 (finish
  moves).
- **Start cell binds to `start_date` (scheduled) until actualized**, then to `actual_start`. So a
  not-yet-actual start is a plain scheduling edit; the right-click **Actualize** converts it to actual
  and **retains the planned duration** (the span is preserved because the finish is unchanged and the
  actual start equals the scheduled start). Verified retained (8 stays 8 after actualize).
- **In-progress Finish edit drives the forecast:** once started, the Finish cell shows the forecast, so
  editing it sets **Remaining Duration** (forecast = data date + remaining − 1) and leaves the planned
  finish intact — Remaining Duration ↔ Duration % Complete remain the linked schedule pair.
- **WBS baseline roll-up dates now display:** the BL Start / BL Finish cells on WBS summary rows were
  blank; they now show the rolled-up baseline span via `wbsBlSpan` (`_blSpanMap`).
- Parses clean; no console errors.

## Fix: relationship lines render backwards on finish-before-start rows (2026-07-16j) — jasantos2 / eprobles
- **Bug:** an activity with a stored `end_date` earlier than its `start_date` (inconsistent/legacy data)
  drew its bar and its dependency arrows **backwards** (finish anchored left of the start). Reported as
  a "relationship lines bug" (e.g. row with Start Sep-14 / Finish Jul-9).
- **Fix:** `dispFin` now clamps the DISPLAYED finish to be ≥ `dispStart` (stored values untouched), so
  bars and relationship arrows can never render backwards regardless of inconsistent stored dates.
  Verified: start Sep-14 / end_date Jul-9 → displayed finish Sep-14 (not backwards). Parses clean.
  (Underlying data still has the reversed pair; editing that activity's Finish/Duration corrects it.)

## Fix: Actualize records the cell's date, not the data date (2026-07-16i) — jasantos2 / eprobles
- **Bug:** Actualize Start/Finish always reverted to the data date. Cause: `actualizeDates` capped the
  date to the data date and routed through `_dateEditPatch`, which rejects dates after the data date.
- **Fix:** it now builds the patch directly from the displayed cell date (`dispStart`/`dispFin`) with no
  capping — records exactly what's in the Start/Finish cell (future dates included). Only guard kept:
  a finish can't precede its start. Verified: future Sep-10 start / Sep-20 finish record as-is (were
  reverting to Aug-14). Parses clean.

## Actualize via right-click context menu (multi-row) (2026-07-16h) — jasantos2 / eprobles
- **Replaced the Actualize Start/Finish buttons with right-click context-menu actions.** Right-clicking
  a grid cell now offers **Actualize Start / Un-actualize Start / Actualize Finish / Un-actualize
  Finish**, and they operate on **all selected activity rows** (Ctrl/Shift-select then right-click).
  Context-aware: right-clicking a Start cell shows only Start actions, a Finish cell only Finish
  actions, any other cell shows both. New `actualizeDates(ids, which, on)` loops the target rows and
  reuses `_dateEditPatch` / `_statusPatch` (Actualize Start → In Progress; Actualize Finish → Completed
  w/ Physical %100 & Remaining 0; Un-actualize clears the actual date). Buttons + `.ps-actualize`
  wiring removed from the detail panel; a one-line hint points to the right-click. Parses clean.

## Editable Duration % Complete + wider Gantt range (2026-07-16g) — jasantos2 / eprobles
- **Duration % Complete is now an editable input** (Status detail), not just a derived readout. Editing
  it back-computes **Remaining Duration = original × (1 − p/100)** — a schedule-side input — and never
  touches Physical % Complete (`_gfDpct` + a `dpct` handler in `wireEditFields`). Verified: 25% on a
  20-day original → remaining 15.
- **Gantt timeline extended + scrollable:** `range()` padding widened from −14/+62 days to **2 years
  before the earliest** activity and **3 years after the latest** (−730 / +1095 days), so the planner
  can scroll into the deep past/future. Verified the bounds (earliest Aug-2026 → Aug-2024; latest
  Jan-2027 → Jan-2030). Parses clean.

## Actualize Start / Finish buttons (2026-07-16f) — jasantos2 / eprobles
- Added **Actualize Start** and **Actualize Finish** buttons in the Status detail's Dates group. They
  convert the scheduled date into a recorded actual: **Actualize Start** sets `actual_start` to the
  scheduled start (capped at the data date) and marks In Progress; **Actualize Finish** sets
  `actual_finish` to the scheduled finish (capped at the data date), defaulting an Actual Start if
  missing, and completes the activity (Physical % = 100, Remaining = 0) via `_statusPatch`. Each button
  disables once that date is already actual. Wired in `wireEditFields`; verified (future scheduled
  dates cap to the data date; finish path completes correctly). Parses clean.

## Physical % Complete vs schedule separation — project-controls policy (2026-07-16e) — jasantos2 / eprobles
- Adopted the professional project-controls rule: **Physical % Complete is the primary, official
  accomplishment measure** (reporting / EVM / dashboards / S-curve / completion) and the **scheduling
  engine is independent of it** — forecast dates come from Actual Start + Remaining Duration (+
  calendars / constraints / relationships).
- **Mapping:** Physical % Complete = `percent_complete` (the field already wired into every consumer)
  — relabeled "Duration POC" → **"Physical % Complete"** in the grid column and the Status detail.
  `ev_poc` stays as the secondary "Earned Value POC". Added a read-only **Duration % Complete**
  (derived = (original − remaining) / original) as a pure schedule metric.
- **Decoupled both directions:**
  - Editing **Physical % Complete no longer modifies Remaining Duration or forecast dates** — removed
    the `_progressFields` call and the "enter Actual Start before %" gate from both the grid `beginEdit`
    and the detail `wireEditFields`; `_progressFields` deleted. Editing the % now just stores the value.
  - Editing **Remaining Duration drives the forecast** (via `forecastFin`) and does **not** change
    Physical %. `_fcFields` no longer uses the % (remaining = original − elapsed, a schedule estimate).
- **Completion is now driven by Status / Actual Finish, not by typing a %.** New `_statusPatch`:
  Completed → records Actual Finish (default data date) + sets **Physical % = 100 and Remaining = 0**;
  In Progress → clears Actual Finish, reseeds Remaining; Not Started → clears actuals + %, restores
  Remaining to the original duration. Recording an **Actual Finish** likewise sets Physical % = 100 /
  Remaining = 0 (in `_dateEditPatch`). The Finish field edits the **actual** finish when the activity
  is complete (past date allowed) and the **scheduled** finish otherwise.
- Verified end-to-end (standalone replica): Physical-%-edit leaves forecast+remaining untouched;
  Remaining-edit moves the forecast with Physical % unchanged (Duration % derives to 80%); complete →
  100 % / 0 remaining / actual finish set; un-complete → In Progress with finish cleared + remaining
  restored. Script parses clean.
- **Note (cross-module):** the S-Curve / Cash-Flow / Portfolio modules read `percent_complete`, which
  is now the Physical % — so they automatically use the official accomplishment measure. No change
  needed there; flagged for awareness.

## Finish edit = scheduled finish (≥ data date); grid/detail Start-Finish now match (2026-07-16d) — jasantos2 / eprobles
- **Finish date validation flipped.** The "Finish" is the scheduled/forecast finish, so it may be
  **later** than the data date (a future finish) but **not earlier** than it (remaining work can't be
  scheduled into the past). The grid Finish cell + detail Finish now edit `end_date` (was
  `actual_finish`, which forced status=Completed and rejected any date after the data date). The
  `end_date` branch of `_dateEditPatch` rejects finish-before-start and finish-before-data-date, sets
  `duration_days` (keep start, move finish), and for an in-progress activity sets `remaining_duration`
  so the forecast finish equals the entered date.
- **Grid ⇄ detail Start/Finish now match.** The detail panel showed the raw (often blank) actual
  fields while the grid showed `dispStart`/`dispFin`. New `_gfDate(label, field, showVal)` renders the
  detail Start/Finish with the same `dispStart`/`dispFin` values and edits the same fields
  (`actual_start` / `end_date`); the read-only General "Dates" Start now uses `dispStart` too.
- Verified: future finish (Nov 30 vs Aug 14 data date) allowed (duration/remaining set, forecast =
  entry); finish before data date and finish before start both rejected; script parses clean.

## Editable Planned Duration + removed "P" date badge (2026-07-16c) — jasantos2 / eprobles
- **Removed the "P" (planned, no-actual) badge** from the Start/Finish grid cells — noise. Now: **A**
  when an actual is entered, **C** for a primary constraint on Start, nothing otherwise.
- **Planned Duration is now editable** in both the activities grid (DUR column, double-click) and the
  Status detail form. New pseudo-field `planned_duration` (type `pdur`) → `_pdurPatch` stores
  `duration_days` and re-spans the current schedule from the start anchor (keeps start, moves finish);
  the baseline is a snapshot and left untouched. `_origDurOf` reverted to prefer an explicit
  `duration_days` (so the edited value is the display source), then BL span, then current span,
  clamped ≥ 0. Wired in `beginEdit` (grid) and `wireEditFields` (detail).
- Verified: the previously −21d activity now reads its BL span (8d); editing Planned Duration to 12
  stores 12 and re-spans Aug 11 → Aug 22 (12d inclusive); script parses clean.

## Removed Planned Start/Finish fields; BL-based planned duration; arrows on current bar (2026-07-16b) — jasantos2 / eprobles
- **Removed the Planned Start / Planned Finish fields** (both the read-only General detail and the
  editable Status form) — redundant with **BL Start / BL Finish**, which is now the plan basis. The
  root cause of the residual negative Planned Duration was an inconsistent start_date/end_date pair
  (planned start later than planned finish) left by an earlier edit; dropping those fields removes
  the source. `start_date`/`end_date` still exist internally (current-schedule bar + CPM) and are set
  via drag/import/actuals, just no longer hand-edited as "planned" dates.
- **Planned Duration is now baseline-based** everywhere (DUR grid column + both detail views) via
  `_origDurOf`, which now prefers the **BL span** (→ duration_days → current span) and is clamped
  **≥ 0** — so it can never show negative again.
- **Relationship arrows now connect to the current-schedule bar.** The connector endpoints were
  anchored to a fixed row-offset (row-top + 16px) using the planned start/end x-span, so they ran
  through the gap between the baseline bar and the current bar. They now use `dispStart`/`dispFin`
  for the x-span and the actual current-bar vertical centre (recomputed with the same
  baseline/no-baseline geometry as `ganttRowHTML`), so each arrow lands on the current bar itself.

## Planned duration decoupled from actuals + retained-logic forecast (2026-07-16) — jasantos2 / eprobles
- **Bug fixed: planned duration went negative** when an Actual Start earlier than the Planned
  Start was entered. Root cause: the forecast finish was being written into `end_date` (which is
  ALSO the planned finish), so an early actual start could push the planned finish before the
  planned start → negative planned duration.
- **Fix — planned start/finish/duration are now fully independent of actuals.** Entering an Actual
  Start or a Duration POC no longer writes `end_date` or `duration_days`; it only stores
  `actual_duration` + `remaining_duration`. `_fcFields`/`_progressFields`/`_dateEditPatch` no longer
  touch the planned dates. Planned Duration everywhere (DUR grid column + detail) = planned finish −
  planned start (inclusive), always ≥ 0.
- **Forecast finish is now DISPLAY-ONLY (retained logic).** New `forecastFin(r)` = data date +
  remaining_duration − 1 (not before the actual start), computed live; `dispFin(r)` = actual finish
  → forecast (if started) → planned finish. Because it reads the data date live, the forecast finish
  **slides forward as the data date moves while the remaining duration (from the Duration POC) is
  retained** — planning-software retained logic on the Duration POC. Shown in the grid/Gantt Finish
  and as a read-only "Forecast Finish" line in the Status detail. (EV POC still excluded from dates.)
- Verified arithmetically: planned Jul10–Jul20 (dur 11) + actual start Jul5 + 40% POC → planned
  duration stays **11** (was going negative), planned finish stays Jul20, forecast finish = **Jul22**
  (data date Jul16 + remaining 7 − 1); module script parses clean.

## Forecast-on-actual-start, POC gate, Duration/EV POC split, dep lines behind bars (2026-07-14) — jasantos2 / eprobles
- **Forecast flow when Actual Start is entered.** Entering an Actual Start on a started (not
  finished) activity now computes **actual duration = data date − actual start**, **remaining =
  origDur × (1−POC)** (or origDur − elapsed when no POC), and a **forecast Finish = data date +
  remaining − 1** written to `end_date` (shown in the Finish field). At-Completion = actual +
  remaining. Shared helper `_fcFields` also drives `_progressFields` so % edits stay consistent.
  Verified: actual-start Jul 10 (10-day, no POC) → remaining 6, forecast finish Jul 19, at-comp 10;
  then Duration POC 60% → remaining 4, forecast finish Jul 17, at-comp 8.
- **POC screening.** Recording a % (Duration POC) now **requires an Actual Start first** (grid + detail)
  — you can't have progress with no start. Blocked with an error toast; `_progressFields` no longer
  auto-fills the actual start.
- **Duration POC vs Earned Value POC.** Renamed the schedule `%` column/field label **"Earned Value
  POC" → "Duration POC"** (drives the schedule). Added a **separate "Earned Value POC (%)"** detail
  field (physical/EV progress, informational — does NOT drive dates), stored in a new tolerant column
  `ev_poc` (migration `migrations/2026-07-14-ev-poc.sql` — **user must run**; safe before it's run via
  `_saveActField`). Export headers keep OPC's "Earned Value POC" name.
- **Relationship lines behind the bars.** The dep-line SVG z-index dropped from 5 → 2 (below the
  bars' z-index 3), so connectors render behind the activity/summary/milestone elements.

## Date-edit intelligence: actual duration, actual-start≤data-date guard, OPC planned duration (2026-07-14) — jasantos2 / eprobles
Central `_dateEditPatch(r,field,val)` now handles every date-cell edit (grid + detail), returning
`{error}` (reject, toast, no save) or `{patch}`:
- **Actual Start can't be later than the Data Date** → error toast, edit reverts.
- **Actual Duration = data date − actual start** (elapsed), or actual finish − actual start once
  finished (`actualDurOf`). Set whenever Actual Start/Finish is edited *and* by `_progressFields`.
- **Actual Finish can't precede Actual Start** → error.
- **Planned duration is now independent (OPC):** editing **Planned Start** keeps the original
  duration and **moves Planned Finish** (no longer recomputes a duration that could go negative when
  start < old start). Editing **Planned Finish** sets duration = finish − start (rejected if before
  start). The **DUR column** shows the stored `duration_days` (clamped ≥0), not a raw span.
- Verified in-browser: future actual-start rejected; actual-start Jul 10 → actual duration 4;
  planned-start Jul 1→Jun 25 keeps 10-day duration (finish → Jul 4); planned-finish before start rejected.

## Fix: progress re-adjust only worked once (pin original duration) (2026-07-14) — jasantos2 / eprobles
Tester: editing Earned Value POC re-adjusted the finish the first time but not on subsequent edits.
Root cause: when an activity has no stored `duration_days` (common for imported rows — the grid just
computes the "5d" from the dates), `_progressFields` derived the original duration from the current
`start…finish` span. The first edit moves the finish, so the *second* edit re-derived "original" off
the already-shortened bar → remaining barely changed → looked frozen. Fix: `_progressFields` now
resolves the original duration as duration_days → baseline span → planned span, and **pins it to
`duration_days`** on the first progress edit, so every later % edit recomputes remaining/finish from
the same base. Verified in-browser: a 10-day (no duration_days) activity edited 40%→60% now pins
duration 10 and recomputes remaining 6→4, finish Jul 19→Jul 17.

## Start/Finish columns show actual (fall back to planned) + detail relabel (2026-07-14) — jasantos2 / eprobles
Tester's model: the grid **Start/Finish** should reflect ACTUAL dates, with planned as the basis.
Chosen behavior (confirmed): *actual when set, else planned; editing writes the actual*.
- New accessors **`dispStart(r)=actual_start||start_date`**, **`dispFin(r)=actual_finish||end_date`**
  used for: grid Start/Finish cell display, the Gantt bar (`s/e`), column sort (`colSortVal`) and
  per-column filter (`_colText`). Grid Start/Finish cells now `data-field="actual_start"/"actual_finish"`
  (editing writes the actual); `beginEdit` prefills those cells with the displayed (fallback) date; a
  cell badge shows **A** (actual entered) or **P** (planned, no actual yet).
- **Gantt drag** operates on the displayed bar and writes to the shown field — actual when the
  activity has one, else planned (planned drag still recomputes duration; actual drag doesn't touch
  planned duration). Cell clipboard `_CELL_META` for those two columns now targets the actual fields.
- **Detail panel relabeled**: Status tab "Actual Start/Finish" → **"Start"/"Finish"** (editable +
  read-only). "Planned Start/Finish" stay as the plan/basis. (The Add/Edit modal still says "Actual
  Start/Finish" + "Planned Start/Finish" — left as the full editor.)
- Export already emitted actual-||-planned for Start/Finish (unchanged). DUR column still reflects
  planned duration. Note: editing an *un-started* activity's Start now creates an actual_start (marks
  it started) — that's the chosen "editing writes actual" behavior; adjust the plan via "Planned Start".

## Progress intelligence — POC-driven remaining/finish + retained-logic data-date shift (2026-07-14) — jasantos2 / eprobles
Two scheduling-logic features, both toggle-gated in the **Schedule dialog → Settings** (default ON).
- **Progress-driven dates (`progressDriven`).** Editing **% Complete (Earned Value POC)** — in the
  grid cell or the Status/General detail tab — now runs `_progressFields(r,pct)`: keeps
  `duration_days` as the original/planned duration and derives **remaining_duration =
  round(origDur × (1 − POC))**, actual_duration, status, actual_start, and an auto **finish =
  data date + remaining − 1** (remaining work scheduled from the data date). 100% → Completed,
  finish = data date, remaining 0; 0% → Not Started, remaining = full duration (dates untouched).
  All fields persist together through `persist()` (undoable + audited; `end_date`/`percent_complete`
  are in `_RECOMPUTE_FIELDS` so CPM/rollups refresh). Unit-checked: 40%→6d rem & finish +5;
  100%→finish at data date; shift keeps span.
- **Retain un-started work at the data date (`ddRetainOn`).** New `shiftUnstartedToDataDate()`:
  on **Schedule → Schedule Now**, any activity with 0% POC / no actual start whose planned start is
  **before** the data date is moved forward to start on the data date, **keeping its duration**
  (finish moves by the same delta). Runs for all tasks regardless of relationships (chunked bulk
  write, audited), *before* the CPM recompute + the existing relationship reschedule, so linked and
  unlinked schedules both self-adjust when the data date advances. (This complements the CPM's
  existing data-date flooring for linked activities.)
- **Verified:** full inline script parses; `_progressFields` + shift math hand-checked in-browser.
  Live click-through pending a session. (Note: with progress-driven ON, % edits move finish dates —
  a real scheduling action; the toggle lets teams that hand-manage dates turn it off.)

## Baseline bars above current + baseline roll-up + equal/full bar heights (2026-07-14) — jasantos2 / eprobles
- **Baseline (BL0) bar now drawn ABOVE the current schedule bar** (was below at +24). Activity bar
  geometry reworked: **with a baseline present**, planned + current are two **equal-height** bars
  (~11px each, density-scaled) stacked baseline-over-current; **without a baseline**, the current bar
  fills nearly the whole row height (`ROWH − 8`). Heights set inline (overriding the fixed
  `.ps-bl`/`.ps-bar` CSS heights). Bar label vertically centered on the current bar.
- **WBS summaries now roll up baseline dates.** New `_blSpanMap` (built in `rebuild()` from
  bl_start/bl_finish up the WBS tree, same walk as `_spanMap`) + `wbsBlSpan()`; the summary branch
  draws a rolled-up baseline bar above the summary bar (WBS grouping; keyed by dotted code). Summary
  bar shifts down to sit below it when a baseline roll-up is present.
- Milestones unchanged (point marker). Note: dep-line anchor Y left as-is (approximate elbow) — bars
  moving down a few px in baseline mode is cosmetically fine.

## Detail-form layout fix + import baseline (2026-07-14) — jasantos2 / eprobles
- **Fixed the cramped/overlapping Status (and General) editable detail form.** The forms wrapped
  their groups in `.ps-det-groups` (auto-fit `minmax(250px,1fr)`) while *each group* also had an
  inner 2-col field grid — at 250px the date inputs overlapped. New **`.ps-edit-groups`** wrapper
  (auto-fit `minmax(360px,1fr)`) gives each group room for its 2-col fields; the "Editing…" hint
  spans full width (`grid-column:1/-1`). detGeneralEdit + detStatusEdit now use it.
- **Import baseline (Excel).** The "set baseline from current schedule" flow already exists
  (Actions ▸ Baselines… ▸ **Capture current as baseline**). Added the requested **alternative**:
  a **Import baseline (Excel)…** button + file input in the Baselines modal → reuses the schedule
  importer's `parseWorkbook`, then `importBaselineFile()` stores the parsed start/finish/dur/
  planned-cost as a `schedule_baselines` snapshot **keyed by Activity ID, without touching the live
  schedule**. Set it primary to apply it to BL0/variance. (XLSX only for now; `.xer` baseline import
  can follow — the main importer's XER path is a different shape.)

## Theme-aware line colors, dark-mode WBS/activity contrast, full-row selection (2026-07-14) — jasantos2 / eprobles
- **Relationship lines + data-date line are now theme-aware** and editable. New CSS vars
  `--ps-dep` (relationship lines/dots/label/arrowhead) and `--ps-dd` (data-date line + label +
  legend swatch) on `#ps-view-schedule`: default **black in light mode, white in dark**. Both were
  hard-red before. Added **Relationship lines** + **Data date line** color pickers to the Colors
  menu (COLORDEFS `dep`/`dd`); a user override applies in both themes (inline var beats the
  theme default), Reset reverts to the black/white default.
- **Dark-mode WBS/sub-WBS shading brightened + stepped** (`--wl` per level was #3a…#21, nearly
  invisible on the #1C bg) → #56…#2a, clearly distinct per depth; added a left-accent bar to WBS
  levels 3–5 in dark (was only 0–2) so sub-WBS depth reads. Activity zebra stripe strengthened in
  dark (`.ps-alt` .03→.06) so activity rows separate.
- **Full-row selection highlight across both panes.** Clicking a WBS or activity now tints the
  **entire grid row** (`.ps-row-sel` full-width bg + red left inset) and draws a matching
  **`.ps-gantt-selband`** spanning that row across the Gantt (behind the bars). Emitted in
  `ganttRowHTML` for full renders and managed imperatively in `highlightRow` so a plain click (no
  Gantt re-render) still shows it; `highlightRow` also now matches WBS rows via `data-wbsid`.

## Arrow routing v2 (gap-routed) + Month default zoom (2026-07-14) — jasantos2 / eprobles
- **Dependency connector no longer runs its horizontal over a bar.** Previous routing kept a single
  vertical just outside the destination and ran the horizontal along the *source row* (a.y) — for
  adjacent FS bars that meant a visible back-track over the predecessor's tail. New **Z-route**: leave
  the source edge with a short stub (`S=9` outside the anchor), drop to the **midpoint Y between the
  two rows**, run the horizontal there (in the inter-row gap, no bars), drop to the destination row,
  then a short stub into its anchor edge. Only the two short end-stubs touch bar rows; the long run is
  always in the gap. Source stub direction follows the anchor (start-anchored SS/SF step left,
  finish-anchored FS/FF step right); destination vertical sits just outside its start (FS/SS) or finish
  (FF/SF). Label/dot repositioned to the new geometry.
- **Default timeline zoom is now Month** (was Quarter): `var zoom='month'` + the `.active` class moved
  to the Month segment button. Users can still switch to Quarter/Year (and saved layouts restore their
  own zoom).

## Colors menu was inaccessible — restored (2026-07-14) — jasantos2 / eprobles
- Tester asked "where is the Colors menu". Root cause: the `.ps-gantt-tools` CSS and
  `renderColorsMenu()` existed, but the **palette button + `#ps-colors-menu` element were missing
  from the Gantt-pane markup** (dropped at some point), so `renderColorsMenu` returned early and there
  was no way to open it. This means the earlier "bar colors already exist" note (below) was wrong —
  the feature was orphaned. **Fix:** added the `.ps-gantt-tools` palette button + `#ps-colors-menu`
  back into `.ps-gantt-pane` (top-right floating gear), declared `colorsMenu`, added it to
  `closeMenus()` + stop-propagation, and wired `#ps-colorsbtn` to `renderColorsMenu()` + toggle
  (same pattern as the other menus). The menu contents (Task bar / Progress fill / Summary / Baseline
  / Milestone pickers + per-WBS overrides + Reset) were already implemented — now reachable again.
  So item #2 (differentiate + modify WBS vs activity bar colors) is genuinely delivered.

## Gantt/print/filter batch (2026-07-14) — jasantos2 / eprobles
From a multi-item tester list; implemented the genuine gaps (several items were already built — see
"already existed" note at the end).
- **WBS bar progress fill (#1).** Summary bars now show a duration-weighted rolled-up %-complete fill
  (`_costMap[code].wearn/wd`) as a `.ps-sum-fill` child clipped to the bracket shape, plus the % on
  the bar label and title. Group headers (non-WBS grouping) don't get a fill.
- **Succeeding months (#3).** `range()` now pads the timeline: ~2 extra trailing months after the last
  activity (`addDays(_max, 62)`) + 14-day lead, so the Gantt shows context beyond the activity span.
- **Critical-path-only filter (#5b).** New **Filter → Schedule → "Critical path only"** (`filters.crit`);
  `rowMatches` excludes non-critical activities (WBS rows pass so ancestors are kept). This *excludes*
  the others, unlike the Critical Path toolbar toggle which only dims them.
- **Project title on print (#4).** The Print button injects a `#ps-print-head` banner (project name +
  data date + print date) shown only in `@media print`, at the top of the printed schedule.
- **Already existed (confirmed, no change needed):** progress override (#6 — Schedule dialog Settings:
  Retained Logic / Progress Override); differentiated + editable WBS vs activity bar colors (#2 — the
  Colors menu sets Task bar / Summary / Milestone separately); constraints + actual-date/data-date
  logic (#8 — primary/secondary constraints, constraint-aware CPM, use-actual-dates); a P6-style
  Advanced filter builder (#5a — `filters.adv`, Match All/Any rules).
- **Deferred / needs scoping:** #5a "time-based" filter condition (the Advanced builder exists — needs
  a date/duration operator added); #7 extra complete/activity types (Start Milestone, Finish Milestone,
  Resource Dependent) — needs decisions on how each renders/behaves (milestone side + duration-type).

## Quick-add default dates (2026-07-14) — jasantos2 / eprobles
- **New activities now default to start on the data date with a 5-day duration.** `quickAddActivity`
  stamps `start_date = today()` (the data date, `dataDate || wallToday()`), `end_date = today()+4`
  (5 inclusive days), and `duration_days = 5` on the insert payload (was blank/no dates). So a
  freshly-added activity shows a real bar on the Gantt immediately and can be nudged from there.

## Visible Schedule button + dependency-arrow routing fix (2026-07-14) — jasantos2 / eprobles
- **Schedule button is now a visible red primary button** (`pd-btn pd-btn-primary`, calculator icon +
  "Schedule" text) matching the "+ Add activity" button, instead of an icon-only `.ps-icobtn` whose
  label only showed in Labels mode. Same `#ps-schedbtn` id/handler (`openSchedule`).
- **Dependency arrows no longer run across the linked bar.** The elbow used to turn at
  `predecessorFinish + 8`, which for adjacent FS bars sat on top of the successor bar (per the
  tester's screenshot). Now the vertical turns just **outside the destination bar's anchor edge** —
  `toX − 10` (left of its start for FS/SS) or `toX + 10` (right of its finish for FF/SF) — so the
  connector leaves the source edge, runs along the source row to the turn, drops to the successor
  row, and enters with a short 10px stub, never crossing the linked bar. Origin dot + type/lag label
  repositioned to the new turn X.

## Wrapping column headers (2026-07-14) — jasantos2 / eprobles
- **Grid column headers now wrap** instead of truncating with an ellipsis, so long labels stay
  readable when a column is narrow / being resized. Header cells (`.ps-grid-row.head .ps-cell`) get
  `white-space:normal; overflow-wrap/word-break:break-word; text-overflow:clip`; data cells keep
  `nowrap`/ellipsis (verified in-browser: header WS=`normal`, data WS=`nowrap`).
- **Header row grows to fit the wrapped lines** (`.ps-grid-row.head` → `min-height:38px; height:auto`)
  and a new **`syncHeadHeights()`** sets the Gantt header's height (border-box) equal to the grid
  header's measured height, so the first data row stays aligned across the two panes. Called from
  `renderHeader()`, the end of `doRender()`, and live during `startColResize` (mou…move + up). This
  also makes the two heads exactly equal by measurement (previously both relied on matching fixed CSS
  heights, incl. the `.ps-colf-on` 68px filter-row case, which the inline sync now supersedes).

## Column chooser scroll + Schedule reschedules by default (2026-07-14) — jasantos2 / eprobles
- **Column chooser (grid-header "+" / `#ps-cols-menu`) now scrolls.** Root cause: `.ps-menu`
  (line ~550) sets `overflow:hidden` and, being *later* in source than `.ps-cols-menu` (line ~158,
  `overflow:auto`) at equal specificity, won the cascade — so the menu clipped at its `max-height:340px`
  with no scrollbar (visible in the tester's screenshot, cut off at "Planned Value"). Added
  `.ps-cols-menu { overflow-y:auto }` *after* `.ps-menu` so the chooser scrolls again.
- **Schedule now reschedules dependent activities by default.** The CPM (`cpmLogic`) already honors
  **multiple predecessors** per activity (each successor's early start = **max** candidate across all
  its `_relObjs`, topological pass), and `applyScheduleDates()` writes those dates back — but it only
  ran when the Schedule dialog's "Reschedule dependent activities" box was ticked, which defaulted
  **off**. Changed `reschedOn` to default **on** (respects an explicit user off-setting), so hitting
  **Schedule → Schedule Now** moves successors' Start/Finish along their FS/SS/FF/SF + lag links
  (completed activities keep actuals; started ones keep their Start). Still confirms before the bulk
  write. No relationships → it warns instead of moving.

## WBS click-to-select, WBS-scoped Activity ID, scrollable menus (2026-07-14) — jasantos2 / eprobles
Follow-ups from tester feedback. No migration, no schema change.
- **Clicking a WBS row now SELECTS it** (instead of toggling collapse every time). Expand/collapse is
  now **only** via the ▼/► chevron. Real WBS summary rows carry `data-wbsid` + get `ps-row-sel`, and
  the `.ps-wbs-row` click handler selects the node (sets `selId`/`_wbsSel`, re-renders) so it becomes
  the Add-activity target; synthetic **group** headers keep click-to-collapse. Chevron clicks are
  guarded (`closest('[data-toggle]')`) so they never fall through to selection.
- **Activity ID is now WBS-scoped** as **`<wbs>-A<num>`**: `nextActivityId(wbs)` uses the prefix
  `"<wbs>-A"` and numbers in increments of 10 from **1000** (e.g. WBS 1.1 → `1.1-A1000`, then
  `1.1-A1010`, …), continuing from the highest number already used under that exact WBS prefix and
  skipping collisions. No WBS → plain `A<num>`. `quickAddActivity` passes the target `wbs`.
  (Unit-checked in-browser: fresh 1.1→`1.1-A1000`; with A1000/A1010→`1.1-A1020`; per-WBS isolated;
  no-WBS continues the `A` series.)
- **Popup menus scroll instead of clipping.** `.ps-menu` had `overflow:hidden` + no height cap, so a
  tall **row context menu** (Add activity / Edit / clipboard / WBS / Delete) ran off-screen with no
  scroll. Added `.ps-rowctx, .ps-colhdr-menu { max-height:82vh; overflow-y:auto }` and, in
  `openRowMenu`, an explicit `max-height = viewportHeight − top − 10px` so the menu always fits the
  space below its anchor and scrolls when taller.

## Auto Activity ID + editable Status & Relationships tabs (2026-07-14) — jasantos2 / eprobles
Follow-up to the interactive-Add work below. No migration, no schema change.
- **Auto-generated Activity ID on quick-add.** `quickAddActivity` now stamps `activity_id =
  nextActivityId()` instead of leaving it blank. `nextActivityId()` takes the max existing numeric
  Activity ID in the project, rounds **up to the next multiple of 10** (P6/OPC-style — `…1010`→`1020`,
  `1013`→`1020`), and keeps whatever prefix the highest ID uses (e.g. `A1020`→`A1030`). Starts at
  `1010` when the project has no numeric IDs; skips collisions. (Logic unit-checked in-browser:
  empty→1010, `A1010/A1020/A1005`→`A1030`, `A1013`→`A1020`, collision→next free.)
- **Editable Status tab.** `renderDetails` status branch now renders `detStatusEdit(r)` + the shared
  `wireEditFields` (same live-editor pattern as General): Status, % Complete, Expected Finish, all
  Planned/Actual/Baseline dates, Actual/Remaining Duration, Free Float, Planned/Actual/Remaining Labor
  Units, and Primary/Secondary Constraints (+dates) are editable and persist on change. Computed
  fields (Planned/At-Completion Duration, Total Float, Critical, Finish Variance) stay read-only via
  the new `_gro()` helper. Added a `num` field type (non-negative, unbounded) to `_gf`/`wireEditFields`
  for durations/labor units (the existing `number` type stays 0–100, used for % Complete).
- **Editable Relationships tab.** `detRelsEdit(r)` + `wireRels` replace the read-only tables:
  predecessors get a **× remove** per row and an **add row** (activity datalist + FS/SS/FF/SF type +
  lag), mirroring the modal's predecessor picker. Edits reserialize to the predecessor token text via
  `serializeRels()` (verified to match the CPM `predRels` format — `1010 SS+3`, `1010 FS-2`) and go
  through `persist()` (undoable + audited + CPM rebuild). **Successors stay read-only** (derived as the
  inverse of other activities' predecessors).
- Resource Assignments / Steps / Expenses / Notebook / Files were already editable (CRUD) — unchanged.
- **Verification:** full inline script parses clean (module page loads, zero console errors);
  `nextActivityId`/`serializeRels` logic unit-checked in-browser. **Live click-through still pending a
  real login** (needs an approved session + a project with data).

## Interactive Add-activity + editable General tab (2026-07-14) — jasantos2 / eprobles
Requested: make "Add activity" contextual — select a WBS or activity first, then Add places the new
activity under that respective WBS and lets you edit its details in the panel below (no migration,
no schema change).
- **Contextual Add.** The toolbar **Add activity** button (`#ps-add`) and the right-click **"Add
  activity below"** now call the new **`quickAddActivity(sel)`** instead of always opening the modal.
  Placement is uniform: `wbs = sel.wbs`, `wbs_node_id = sel.wbs_node_id` — a selected **WBS summary**
  gets a child activity under it; a selected **activity** gets a sibling in the same WBS. It inserts a
  blank `Task` ("New Activity", Not Started, 0%) via the same insert + `pushUndo({type:'insert'})` +
  `logAudit` path as the modal `save()`, appends to `rows` locally (no full `load()` refetch),
  `rebuild()`s, un-collapses the new row's WBS ancestry, selects it, and scrolls it into view
  (deferred one rAF since `DL` is rebuilt inside the render frame). `wbs_node_id` is written
  separately + tolerantly (column-missing safe), like `save()`. **No selection → falls back to the
  full modal** (with a hint toast), so the modal path is unchanged and still reachable.
- **Editable General detail tab.** `renderDetails()`'s General tab now renders **`detGeneralEdit(r)`**
  + `wireGeneral()` (the old read-only `detGeneral` is kept, now unused). Core fields are live inputs —
  Activity ID, Name, Work Package, Type, Duration Type, % Complete Type, Status, % Complete,
  Responsible, Owner, Planned Start/Finish, Predecessors, Remarks (WBS shown read-only, since it's set
  by the parent). Each control persists **on `change`** through the existing `persist()` (so edits are
  undoable + audited + trigger the rebuild/CPM), then `renderGrid()`/`renderGantt()` refresh; Start/
  Finish recompute `duration_days` exactly like the inline grid editor. Activity Codes / UDFs stay
  read-only here (managed via the modal / their own editors).
- **New module-scope hook `_openDetail(tab)`** — assigned in init (where `setDetCollapsed`/
  `setDetailTab` are in scope) so `quickAddActivity` can expand a collapsed panel and jump to General.
- **Verification:** the full inline script parses clean (page loads at `/modules/project-schedule/`
  with zero console errors, then redirects via `AppAuth.requireLogin`). **Live click-through against a
  real login is still pending** (needs an approved session + a project with a WBS — same constraint as
  prior batches). Manual test: select a WBS/activity → Add activity → confirm a "New Activity" row
  appears under that WBS, is selected, and the General tab below is editable and persists.

## UX improvements batch 2 (2026-07-13) — shortcuts help, density, pinned data-date, dark-mode audit
The remaining four build-improvement asks (3, 4, 6, 7); no migration, no schema change.
- **3. Keyboard-shortcut help.** New **"?"** button in the toolbar (next to Labels) + the **?** key
  open `openShortcuts()` — a modal listing the previously-invisible grid shortcuts (Insert / Delete /
  Ctrl+C·X·V / Ctrl+D fill-down / Ctrl+Z·Y / Esc) plus mouse gestures (shift-click cell range,
  ctrl-click row, drag bar/edge, Ctrl+scroll zoom, drag-to-reorder). Also **wired Ctrl+D** into the
  grid keydown handler (was right-click-menu only): fills the active cell's field down to the selected
  rows via the existing `fillDown`. `.ps-kbd`/`.ps-sc-*` styles.
- **6. Row-density toggle (comfortable/compact).** `ROWH` is now driven by `_density`
  (`localStorage.ps_density`; 34px comfortable / 27px compact). A **Row density** section in the
  **Layout ▾** menu (`applyDensity`) reassigns ROWH + toggles `.ps-compact` on `.ps-split` and
  re-renders. Grid rows tighten via CSS (`.ps-split.ps-compact .ps-grid-row:not(.head):not(.ps-filter-row)`);
  Gantt bar offsets were refactored to scale with row height (`oY = ROWH/34`, so comfortable is
  byte-identical) — summary/baseline/milestone/bar tops + the dependency-line anchor Y all derive
  from it, keeping the two panes aligned at either density.
- **7. Pinned data-date label.** The Gantt data-date label (`#ps-datedate-lbl`) is now a readable
  pill (card bg + red border) and `renderWindow` sets its `top` to the current vertical scrollTop on
  every scroll, so it stays at the top of the Gantt viewport instead of scrolling out of view.
- **4. Dark-mode consistency audit.** Swept the named suspects — chart/SVG `<text>` labels, the
  `.ps-mini` tables, `.ps-trace-node`/trace logic, `.ps-net-node`/PERT text, dependency labels, the
  bar-colour vars + legend swatches. All already resolve through `var(--pd-*)` / the
  `#ps-view-schedule`-scoped `--ps-*` bar vars with a `html.pd-dark` override (the fix the original
  legend bug landed). No remaining mismatches found; the new elements added this session (WBS shading,
  import card, shortcuts panel, data-date pill) all include dark-mode-safe vars.
- Verified: full inline script parses clean (`new Function`, 537k chars). Live click-through still
  pending (needs a session + data), same as batch 1.

## UX improvements batch (2026-07-13) — toolbar labels, WBS shading, import feedback
Three of the seven build-improvement asks (1, 2, 5); no migration, no schema change.
- **1. Toolbar discoverability — labeled-mode toggle.** The secondary view cluster
  (Outline/Layouts/Schedule/Layout/Analyze) was icon-only + tooltips. Added a **"Labels"** toggle
  button (`#ps-tb-labeltoggle`, eye icon, far right of the toolbar before the search box) that adds a
  `.ps-tb-labeled` class to `.ps-toolbar`; CSS reveals each icon button's word via
  `.ps-icobtn[data-label]::after { content:attr(data-label) }` (the five buttons carry `data-label`
  = Outline/Layouts/Schedule/Layout/Analyze). Persisted in `localStorage.ps_tb_labels`; toggle shows
  an active red state. Pure CSS reveal — no change to the button render paths or their handlers.
- **2. WBS level visual hierarchy — depth shading.** WBS summary rows previously all shared
  `var(--pd-bg)`. `gridRowHTML`'s WBS branch now adds `ps-wl{min(depth,5)}`; CSS tints the row + its
  frozen c-num/c-id/c-name cells via a `--wl` custom prop (shallower = darker), light + dark variants,
  plus a left accent (inset box-shadow, no layout reflow) on the name cell for the top 3 levels
  (red / red-mid / muted). Group rows keep their red-light background (untouched — separate branch).
- **5. Import feedback — progress bar + "what came in" card.** The loading overlay gained a
  determinate progress bar (`#ps-load-bar`/`#ps-load-fill`); `setProgress(frac)` (null = hide) is
  driven by the chunked-insert loops in both `doImport` (Excel) and `doImportXER` (P6). After a
  successful import, `showImportSummary({title,file,tiles,warnings,note})` shows a modal card of
  counts (Excel: Activities / WBS nodes / With predecessors; XER also Calendars / Resources /
  Assignments / UDFs) plus warnings (e.g. activities missing start/finish) — replacing the old bare
  success toast. `fname` is now threaded into both `doImport`/`doImportXER`.
- Verified: full inline script block parses clean (`new Function`, 532k chars). Not yet clicked
  through on a live login (needs a session + an import file).

## Status
- [x] Read MODULE_CONTRACT.md + CONTRIBUTING.md
- [x] Built from scratch (Primavera Cloud reference, not a module copy)
- [x] CRUD implemented (add / edit / view / list / delete)
- [x] Project-scoped via `pd_project`; `created_by` + `project_id` stamped
- [x] `Fmt.esc()` on all user text injected into HTML
- [x] `enabled: true` set in `assets/js/config.js`
- [ ] Run DB migration (see below)
- [ ] PR opened into `main`

## Schema additions (2026-06-30)

Run `../../migrations/2026-06-30-project-schedule-columns.sql` in the Supabase
SQL editor before testing. Adds:

| Column | Type | Default |
|---|---|---|
| `actual_start` | date | — |
| `actual_finish` | date | — |
| `activity_type` | text | `'Task'` |
| `status` | text | `'Not Started'` |
| `responsible_party` | text | — |

## Schema additions (2026-07-01) — OPC Activity Details fields
Run `../../migrations/2026-07-01-project-schedule-opc-fields.sql`. Adds:
`owner, work_package, calendar, duration_type, percent_complete_type,
program_milestone(bool), expected_finish, actual_duration, remaining_duration,
free_float, planned_labor_units, actual_labor_units, remaining_labor_units,
primary_constraint, primary_constraint_date, secondary_constraint,
secondary_constraint_date`. All editable in the Add/Edit modal and shown in the
General/Status detail tabs (At-Completion Duration/Labor are computed).

## Schema additions (2026-07-02) — Baseline cost
Run `../../migrations/2026-07-02-baseline-cost-column.sql`. Adds `bl_cost` (baseline
planned cost, matches OPC's "BL Planned IBB"), seeded from the current Planned Cost.
Editable in the modal; shown in the Cost Loading table.

## Import (2026-07-06) — P6 .xer support
The Import button ("Import Excel/XER (OPC / P6)") now also accepts Oracle Primavera P6
`.xer` exports (auto-detected by extension, read as Windows-1252 text). `parseXER` tokenizes
the `%T`/`%F`/`%R` tab-delimited tables and imports:
- **CALENDAR** → the new `calendars` table (a hand-rolled recursive-descent parser reads P6's
  proprietary `clndr_data` grammar for the Mon–Sun working-day pattern + non-working
  Exceptions/holidays; exceptions that carry a shift-time override are treated as special
  working days, not holidays, and skipped).
- **PROJWBS** → WBS rows, using the *real* `parent_wbs_id` tree (not an outline-level guess
  like the Excel path) to generate dotted codes.
- **TASK** → activities (task_type TT_Mile/TT_FinMile → Milestone), linked to their imported
  calendar via `calendar_id`.
- **TASKPRED** → resolved into the same `predecessors` text format the CPM engine already
  parses (`predRels`) — `"<code> <FS|SS|FF|SF>+<lagDays>"`, lag hours rounded to whole days.
- **RSRC** / **TASKRSRC** → `resources` + `resource_assignments` (added alongside anything
  already in Resource & Role Master, not replacing it).
Verified against a real 26MB/97,906-line cost-loaded P6 export (~600ms parse): exact row-count
matches (14,495 WBS + 27,811 activities, 2 calendars, 2 resources, 27,744 assignments), 100%
predecessor resolution (27,796/27,796), 0 activities missing dates, correct milestone typing,
and a spot-checked activity's dates/calendar/predecessor all matched the source file exactly.
(Not yet run end-to-end against a live Supabase project — the parsing/mapping logic is
verified, but nobody has clicked Import on a real login yet.)

## Perf hardening (2026-07-07) — topological CPM + compute dedup
The scheduling engine is the hot path on large imports (27k+ activities). Two changes, no behaviour
change (verified 0 mismatches vs the old algorithm across 2,000 random DAGs):
- **`cpmLogic` forward/backward passes rewritten from fixed-point relaxation to a single
  topological-order pass (Kahn).** The old `while (chg && guard++ < tasks.length+5) { tasks.forEach }`
  was **O(n²)** on a long dependency chain — a 27k chain = ~730M iterations, which froze the tab.
  Now each pass is O(n + edges): build `_indeg` (= `_relObjs.length`; each node gets exactly that
  many decrements via predecessors' `_out`, so duplicate edges are safe), Kahn queue → `order`,
  forward pass over `order` (preds precede), backward pass over reverse `order` (succs precede).
  Cycles (bad data) leave nodes un-queued → appended so none is dropped. Measured: 27k-chain **19ms**.
- **CPM compute dedup**: `_cpmDirty` flag + `ensureCPM()` (recompute only if dirty). `rebuild()` sets
  dirty then computes (clears it); read/render paths that used to each call `computeCPM()` fresh —
  `renderPlanner`, `_snapSummary`, `exportLookahead`, `computeHealth`, `repCritical`, and the
  redundant post-`rebuild()` calls in `saveBulkUpdate`/`applyScheduleDates` — now call `ensureCPM()`
  (no-op right after a rebuild). Data-changing/option-changing paths (`scheduleNow`, link creation,
  `recomputeCPM`, crit-toggle) still force `computeCPM()`.
- Data fetch was already paged (`load()` fetches all `.range()` pages in parallel) and the Gantt/grid
  already window rows — those were not regressed.
- **Incremental `rebuild(structural)`**: `rebuild()` ran on every single-cell edit / drag / bulk save
  and re-did a full O(n log n) WBS sort (~129ms at 27k rows in node, worse in-browser via
  `localeCompare`). Now `structural` (default true) gates the sort; pure field edits that can't change
  ordering pass `false` and **reuse the existing `_sorted`** (which holds live row references, so
  edits still show). Callers passing `false`: `persist` when the patch has no `wbs`/`activity_id`
  (`rebuild(!!(patch && ('wbs' in patch || 'activity_id' in patch)))`), `saveBulkUpdate`,
  `applyScheduleDates`. Add/delete/import/column-sort/grouping/WBS-or-ID edits stay structural.
  A `_sorted.length !== rows.length` guard force-sorts if the row count changed anyway. WBS-derived
  `_segs/_depth/_anc` are also cached per row (`_segsWbs`) and recomputed only when `wbs` changes.
  The rollups (`_spanMap`/`_costMap`/`_min`/`_max`) + CPM still refresh every rebuild (needed after
  date/cost edits); only the sort + segs recompute are skipped.
- **Cosmetic-edit skip (in `persist`)**: a patch is classified against `_RECOMPUTE_FIELDS` (the fields
  feeding the sort / WBS roll-ups / CPM). If it touches **none** of them — a purely cosmetic edit
  (status, responsible_party, remarks, owner, PO fields, …) — `persist` **skips `rebuild()` entirely**;
  `_sorted`/`_spanMap`/`_costMap`/`_critical`/`_float` are all unchanged and still valid, and the
  renderers read the live row, so the value shows with zero recompute. WBS/Activity-ID/Type edits set
  `structural` (re-sort); any roll-up/CPM field triggers a `rebuild(structural)`. **Guard:** when the
  OPC column-sort (`colSort`) is active, leaf-sibling order can depend on the edited field, so an edit
  then forces a structural rebuild regardless. (Grouped views regroup from live rows in `buildNodes`
  every render, so they need no special handling.) Note: date/%/cost edits still pay the roll-up + CPM
  recompute — true incremental roll-ups were deliberately NOT added: CPM (~19ms, topological) is the
  floor and must recompute on any date/predecessor change, and `_spanMap`'s min/max isn't safely
  reversible, so the risk/reward was poor. Server-side WBS lazy-loading was also rejected — the grid
  is already windowed (`renderWindow`, cached `DL`, scroll never rebuilds) and client-side
  CPM/critical-path/roll-ups require the full dataset in memory.

## OPC clipboard extras (2026-07-11) — cell-level Cut/Copy/Paste
Follows the existing row clipboard (whole-activity Copy/Cut/Paste). Adds an Excel/OPC-style **cell**
clipboard operating on individual grid cells, independent of the row selection/clipboard.
- **Cell-range selection** (`_cellSel` = a rectangle in DL-row × grid-column index space; `_cellAnchor`
  = shift-extend anchor). A plain grid click sets the active cell (still selects the row for the
  details panel); **Shift-click extends a rectangular block**. Wired via `_setCellFromClick(rw,e)` in
  both the row click and contextmenu handlers (computes the column index from the clicked `.ps-cell`'s
  DOM position minus the `#` gutter — the DOM stays in data order, so this equals the `gridCols()`
  index). Painted by `highlightCells()` (called from `highlightRow()`, so it survives virtualization
  scroll/re-render): `.ps-cell-sel` tinted block, `.ps-cell-active` solid box, `.ps-cell-cut` dashed box.
- **`_CELL_META`** = per-column (GRID_COLS order, built-ins only) `{f, edit, t}`. Editable: Activity ID/
  Name, BL Start/Finish, Start, Finish, % Complete, Planned/Actual/EV/BL IBB. Computed columns (POC,
  At-Completion, Dur, Float, Var, Status, % Complete Type) are **copy-only** (paste skips them, counted
  in the toast). Extra code/UDF columns are out of scope (jsonb).
- **`copyCells(mode)`** packs the rectangle into `_cellClip` `{h,w,cells,cut,refs,tsv}` — each cell keeps
  its raw `val` (editable source, for a clean round-trip) plus display `text`; also writes a **TSV to the
  system clipboard** (`navigator.clipboard.writeText`, best-effort) so cells can be pasted into Excel.
  Clears `_clip` (row clipboard) so Ctrl+V stays unambiguous; `copyRows` reciprocally clears `_cellClip`.
- **`pasteCells()`** (async): single copied cell **fills** the whole target rectangle; a block **pastes
  once** from the top-left. Values coerce to the *target* column's type (`_coerceCell`: number clamps
  0–100, money ≥0 strips currency/commas, date via `_isoFromAny`). Writes are grouped per row and go
  through **`persist()`** (undoable + audited + triggers rebuild/CPM); **duration recomputes** when
  Start/Finish are pasted. A **cut** clears its source cells after paste (except any that were themselves
  paste targets). Falls back to reading the **system clipboard** (Excel paste) when nothing was copied
  in-grid. Non-editable targets are skipped and reported.
- **Keyboard:** Ctrl+C/X/V act on the cell selection when one exists (Excel-style), else fall back to the
  row clipboard; paste prefers whichever clipboard was filled last. **Esc** clears both selections. The
  right-click menu shows a **Copy/Cut/Paste cell(s)** section (Ctrl+C/X/V) above the relabeled **Copy/Cut
  row(s)** / **Paste N rows here** items.
- Verified: the 467k inline module block parses clean; a node harness hand-checked `_coerceCell`/
  `_isoFromAny` (150→100, "50%"→50, "₱1,250.5"→1250.5, iso+human dates→ISO, empty→null) and the
  block-vs-fill paste index mapping (2×2 block expands from a single target cell; a 1-cell clip fills a
  3×2 target). Page loads with no console errors. **Not yet exercised end-to-end against a live login**
  (same constraint as prior batches — needs a real session + data to click through).

## Details panel collapse/expand chevron (2026-07-11)
OPC-style inline toggle (`#ps-det-collapse`) at the right of the detail-tab strip: collapses/expands the
panel BODY while keeping the tab strip visible (so it can be reopened). Chevron rotates 180° when
collapsed (`.up`; only `chevronDown` exists in icons.js). Hides `#ps-details-body` + the resize grip;
state persisted (`ps_details_collapsed`). Clicking any tab while collapsed auto-expands. Independent of
the Layout-menu "hide whole panel" toggle. Verified live on Avesta (collapse→body/grip display:none +
chevron up; expand→restored).

## Trace Logic multi-level · auto-adopt on import · sidebar→back button (2026-07-11)
- **Trace Logic (multi-level):** `detTrace` now walks predecessor/successor chains N levels deep
  (`_traceWalk` = BFS with a `seen` set for dedup + cycle safety), rendering one column per level
  (deepest predecessors far-left). Persisted **Predecessor/Successor Levels** number inputs
  (`ps_trace_levels`, default 3, up to 99); `.ps-trace` scrolls both ways as it grows. Verified live on
  Avesta: A1005 now shows L1 A1100 Concept Design + **L2 A1149 Release of NTP** (matching OPC; the old
  single-level view only showed the immediate predecessor).
- **Auto-adopt WBS on import:** `wbsAdopt` rewritten to insert a whole **depth level at a time**
  (chunked, `.insert(batch).select()` → map code→id), instead of one node per await (which stalled on
  big P6 imports). Resumes cleanly from a partial adoption (seeds `nodeByCode`/`sibCount` from existing
  `WBS_NODES`). `silent` param skips confirm/toasts. `doImport`/`doImportXER` now `await load()` then
  `autoAdoptAfterImport()` (tolerant — never blocks the import). The manual WBS-Manager Adopt uses the
  same fast path now.
- **Sidebar removed:** the left `.pd-sidebar` (which duplicated the title dropdown's view switcher) is
  gone; a `.ps-modback` back-to-modules button (→ `../../dashboard.html`) sits where the hamburger was.
  `UI.initShell()` no-ops without a sidebar (harmless). Verified live: sidebar absent, back button
  present + correct href, content full-width, grid loads, title dropdown still switches views.

## Drag-and-drop row reorder within a WBS (2026-07-11)
**Migration `../../migrations/2026-07-11-activity-seq-order.sql` (RUN):** adds `project_schedule.seq_order`.
- **Sort:** in `rebuild()`, leaf siblings (same WBS parent) order by `seq_order` (unset = last → falls
  back to Activity-ID order = pre-feature behaviour), before the Activity-ID tiebreaker. colSort still
  takes precedence when active (its sibling branch runs first).
- **DnD:** task rows get `draggable=true` only when `_reorderEnabled()` (WBS grouping + no colSort +
  not view-only). Drag listeners rebind each `renderWindow` (rows are windowed). A red insertion line
  (`.ps-drop-above/.ps-drop-below`) marks the drop position; drop only lands within the SAME WBS parent.
  `reorderWithinWbs(draggedId,targetId,before)` renumbers that WBS's leaf siblings 0,1,2,… (from the
  current `_sorted` order) and persists changed `seq_order`s via parallel updates, then rebuild/render.
  Gantt auto-syncs (same `_sorted`/DL). Not undo-integrated (reversible by dragging back).
- **Extended to sibling WBS nodes (2026-07-11):** first cut only reordered activities SHARING a WBS —
  but P6 imports (e.g. Avesta) put one activity per WBS leaf (M6001 = WBS 1.1.1.5), so there were no
  same-WBS siblings and drag did nothing ("no red line"). Now the sort honors a **node-level**
  `seq_order` via `_seqByCode` (built from each WBS code's representative row — summary preferred, else
  a lone leaf activity), and a drop between two different WBS leaves under the **same parent** reorders
  those NODES by writing `seq_order` on their representative rows. **No code renumbering, no wbs_nodes
  dependency, update-only.** `dragover` allows any drop where the two rows share a WBS parent
  (`parentCodeOf`); `reorderDrop` dispatches to `reorderWithinWbs` (same wbs) or `reorderWbsSiblings`.
- **Undo/redo (2026-07-11):** both reorder paths record `pushUndo({type:'reorder', changes:[{id,before,after}]})`
  capturing each affected row's old→new `seq_order`; new `reorder` branch in `undo()`/`redo()` calls
  `_reorderApply(changes,'before'|'after')` (seq-only writes + `rebuild(true)`+render, no refetch). So
  Ctrl+Z/Ctrl+Y and the toolbar undo/redo revert/replay a drag reorder.
- **Verified LIVE on Avesta (2026-07-11):** node-level comparator unit-tested; then on the real
  4,393-row project, setting `seq_order` on the 7 "Topping Off" milestones (each its own WBS leaf,
  1.1.1.1–1.1.1.7) reversed their grid order exactly (M7001…M3001) — the exact path a drop triggers —
  then reverted. Confirms sort + reorder end-to-end. (The literal mouse drag-drop gesture still wants a
  human confirm; draggable rows + the same-parent drop rule are in place.)
- **Known limitation:** if a WBS node has MULTIPLE activities AND is itself reordered as a sibling, the
  node's `seq_order` (taken from one activity) can overlap with that activity's leaf-order meaning.
  Neither Avesta nor typical data hits this; documented for later.

## P6 .xer import RUN LIVE (2026-07-11) — import verified, load-timeout bug found
The P6 importer had never run end-to-end against live Supabase (parser-only verified). Imported a real
`.xer` into scratch project **XERTEST**: **42,306 activities, 14,495 WBS summaries, 27,796 predecessors
resolved, 11 milestones, 4 calendars, 5 resources, 55,489 assignments** — counts match the offline
parser verification exactly. **Import writes correctly at scale.**
- **BUG FOUND (new task):** opening a 42k-row project fails with *"canceling statement due to statement
  timeout."* `load()` fetches ~43 pages via `.range()` **OFFSET** pagination in parallel; far pages
  (offset ~41k) re-scan tens of thousands of rows each → exceeds Supabase's statement_timeout. 4.4k-row
  projects (Avesta) load fine; the threshold is a few thousand rows. **Fix planned:** keyset pagination
  (`order=id.asc&id=gt.<last>&limit=N`) so every page is an indexed range scan. Hot path — verify on a
  small project + XERTEST before shipping. (A single ordered 1000-row page measured 1.4s.)
- **FIXED + verified live (`1aaecfb`):** `load()` now uses keyset pagination (`order=id.asc & id>last,
  limit 1000`) instead of `.range()`/OFFSET — each page is an indexed PK range scan. REST simulation
  fetched all 42,306 rows across 43 pages (max page ~1.05s, ~12s total, no timeout); then the live app
  loaded XERTEST fully — **27,811 activities** + 14,495 WBS, Gantt with milestones + dependency lag
  labels rendering, no timeout toast. Sequential (each page needs the prior page's last id) so mid-size
  projects load marginally slower than the old parallel fetch, but nothing times out. Small projects =
  single page (unaffected).

## Resource/cost-side OPC parity — in progress (2026-07-11)
User approved building all four gaps. **Migration `../../migrations/2026-07-11-resource-cost-parity.sql`
(USER MUST RUN):** `cost_accounts` (CBS tree), `price_per_unit` on `resources`+`resource_roles`,
`budgeted/actual/remaining_cost`+`cost_account_id`+`rate_source` on `resource_assignments`,
`activity_expenses` table, and `project_schedule.cost_rollup` (opt-in bottom-up cost derivation;
default false = current manual behaviour preserved). Build sequence (UI, next):
- **3a Cost Accounts / CBS manager** — DONE + deployed (`871279c`). Actions ▾ → Cost Accounts…: a
  single-pane indented CBS **tree** manager (add top-level / add child / edit / delete with child+usage
  guards). `COST_ACCTS`/`EXPENSES` loaded in `loadResourcesAssignments` (tolerant). Helpers
  `costAcctTree`/`costAcctOptions`/`costAcctLabel`/`costAcctUsage` ready for 3b/3c pickers. Tree
  ordering/indentation node-verified; interactive smoke-test blocked by the 4,393-row render freeze
  (needs a small project, same blocker as §2 write-actions).
- **3b Price/Unit + assignment cost + roll-up** — DONE + deployed (`1fdc9b8`). Resource-master
  Price/Unit field on resources+roles (roster column) — verified live on DEMO01. Assignment form:
  budgeted/actual/remaining COST + cost-account picker + Derived (units × `resRate`) / Manual toggle
  (`recalcCost` auto-fills + disables cost inputs when derived); cost fields written tolerantly with
  `curve`. Panel shows cost + account columns + total + a per-activity **cost_rollup** toggle;
  `syncActivityCost(r)` sums Σ assignment + Σ expense cost → activity planned/actual via `persist()`
  (undoable) ONLY when the flag is on (default off = manual preserved), called after assignment
  save/delete. (Assignment-form interactive test blocked by the 4,393-row grid freeze — code-verified.)
- **3c Expenses tab** — DONE + deployed (`3a05035`). New **Expenses** detail tab (between Resource
  Assignments and Relationships): per-activity CRUD (name, cost account, planned/actual cost, remarks)
  + Total row (`detExpenses`/`wireExpenses`/`openExpenseForm`/`delExpense`, copied from Steps/Assignments).
  Feeds `syncActivityCost` so expenses roll into the activity's Planned/Actual cost when `cost_rollup`
  is on. Tolerant of the not-yet-run migration.
**Batch complete + verified LIVE end-to-end (2026-07-11).** Created a small scratch project
`XERTEST` (via the authenticated session) to escape the 4,393-row render freeze, then drove the full
flow on the live app: added a rated resource (₱500/unit), a cost account (01 Preliminaries), an
assignment (20 units → derived ₱10,000, tagged to the account), and an expense (₱2,500); toggling the
activity's **Roll cost up** ran `syncActivityCost` → activity `planned_cost` = **₱12,500** in the DB
(10,000 + 2,500). Confirms 3a (account shown), 3b (assignment cost + toggle + sync), and 3c (expense
feeding the rollup) all working together. Resource-master Price/Unit + roster column also verified live.
`XERTEST` is left in place as the responsive venue for the P6-import test + future interactive checks.

## Excel export now includes dynamic columns (2026-07-11)
`exportExcel` previously used a fixed header set — the Activity-Code/UDF dynamic grid columns were
grid-only. Now it appends the extras **currently shown in the grid** (`extraColDefs().filter(c=>!colHidden[colKey(c)])`
— WYSIWYG; extras default hidden so a plain schedule still exports the 16 built-ins only). Per-row
value via `extraCellVal` (blank on WBS rows, matching the grid). Header labels are **uniquified**
against the built-ins and each other (a UDF named "Status" → "Status (2)"; duplicate "Zone" →
"Zone"/"Zone (2)") so the `json_to_sheet` object keys can't collide. Verified the uniquifier in a node
harness. Widths default 18 for extras.

## Clipboard fixes from live DEMO01 testing (2026-07-11)
Two bugs surfaced during the first real-login click-through (VERIFICATION.md §2), both fixed:
- **Shift-click made a native browser text-selection** (blue highlight + the browser's selection
  toolbar) that buried the red cell-range block and made Ctrl+C/X/V feel tied to inline editing. Fix:
  `user-select:none` on `.ps-grid-pane .ps-cell` (re-enabled `user-select:text` on `.ps-cell input`
  so editing still allows text selection). The cell block is now the only visible selection and the
  keyboard clipboard acts on it directly.
- **Row Copy/Paste (right-click → Copy/Paste row(s)) wasn't undoable** — `pasteRows` inserted directly
  and never recorded undo. Fix: new **`insertMany`** undo action. `pasteRows` now collects the inserted
  rows (`_dbPayload(res.data)` = the row minus underscore-prefixed computed props) and, on a cut, the
  deleted source rows; `undo()` deletes the pasted rows + re-inserts cut sources; `redo()` reverses it;
  both `await load()` to resync. (Cell paste was already undoable — it routes through `persist()`.)

## OPC parity batch: Activity Codes, Weighted Steps, Last Planner/PPC (2026-07-07)
Three requested together (user prioritization: build the one that's more foundational/necessary
where it matters — see the per-feature notes below).

**1. Activity Codes + code-based grouping/filtering.**
**Migration:** `../../migrations/2026-07-07-activity-codes.sql` (`activity_code_types`,
`activity_code_values`, both RLS via `is_approved()`/`is_planner()`; `project_schedule.activity_codes
jsonb default '{}'` — a compact `{ "<code_type_id>": "<code_value_id>" }` map, matching the
`schedule_baselines` jsonb-snapshot convention rather than a join table).
- **Actions ▾ → Activity Codes…** (`#ps-codes-back`, `openCodes`/`renderCodesList`/`renderCodesDetail`)
  — a two-pane manager (list of code TYPES on the left — e.g. Phase, Area, Zone — their VALUES on
  the right), reusing the Snapshots modal's `.ps-snap-list`/`.ps-snap-detail` two-pane CSS. Rename/
  delete a type, add/delete its values; each value's detail row shows how many activities currently
  use it.
  - **Add/Edit Activity modal** gets one dynamic `<select>` per code type (`populateCodesFields`,
    `#ps-f-codes-wrap`/`#ps-f-codes-fields`, hidden entirely when the project has no code types
    yet). Written **separately + tolerantly** after the main save (own try/catch, same pattern as
    `contract_date`/`risk_*_pct`).
  - **Grouping**: `#ps-group` gets one auto-populated "Group: <name>" option per code type
    (`populateGroupSelect`, called after every project load and after any code-type CRUD); `groupKeyOf`
    resolves `groupBy==='code:<id>'` via the activity's `activity_codes[id]` → the value's label
    (falls back to "— Unassigned —"). The existing non-WBS grouping path in `buildNodes()` is fully
    generic, so no grouping-logic changes were needed beyond `groupKeyOf`.
  - **Filtering**: `filters.codes = { "<code_type_id>": { "<code_value_id>": true } }`, one checkbox
    section per code type in the filter menu (`buildFilterMenu`), ANDed across types / ORed within a
    type in `rowMatches`.
- Deliberately **not** added as a grid column this round — the sticky-column chain (contiguous-from-
  the-left invariant noted elsewhere in this file) is easy to break, and grouping+filtering already
  satisfies the ask; a column can follow later if wanted.

**2. Weighted Steps → physical % complete.**
**Migration:** `../../migrations/2026-07-07-activity-steps.sql` (`activity_steps`, keyed by
`activity_id` like `resource_assignments`, not the row's uuid).
- New **Steps** tab in the Activity Details panel (between Status and Resource Assignments —
  `detSteps`/`wireSteps`/`openStepForm`/`delStep`, copied structurally from `detAssign`/
  `wireAssign`/`openAssignForm`/`delAssign`): a per-activity checklist, each step has a name/weight/
  %-complete. Shows the rolled-up "Weighted physical % complete" above the list.
- **`physicalPct(activityId)`**: weight-weighted average of each step's own % complete
  (`Σ(weight·pct)/Σ(weight)`); returns `null` when the activity has no steps (manual entry still
  applies, no behavior change for activities that don't use Steps).
- **`syncPhysicalPct(r)`** writes the rolled-up value back onto `project_schedule.percent_complete`
  via the existing `persist()` (not a raw update) every time a step is added/edited/deleted — so
  undo, audit, and the CPM/rebuild trigger (`percent_complete` is already in `_RECOMPUTE_FIELDS`)
  all fire exactly as they would for a manual edit. This is the entire point of the feature: CPM,
  EVM, Cost Loading, forecasts, the Planner Cockpit, and Monte Carlo actuals all read
  `percent_complete` already, so they benefit with **zero further changes**.
- The Add/Edit modal's **% Complete** field is disabled (with an explanatory title) when the
  activity has steps, pointing to the Steps tab — purely a UX affordance; the field still submits
  its (already-synced) value if somehow re-enabled, so nothing breaks if steps are deleted mid-edit.

**3. Last Planner System — weekly work plan + Percent Plan Complete (PPC).**
**Migration:** `../../migrations/2026-07-07-weekly-commitments.sql` (`weekly_commitments`: project +
`week_start` (Monday) + description + optional `activity_id` link + responsible + status
(Open/Complete/Not Complete) + reason_code/notes).
- New 4th view/tab (**Last Planner**, sidebar `data-view="lastplanner"` + title-menu
  `data-tab="lastplanner"`, `#ps-view-lastplanner`) — same top-level pattern as Planner/Schedule/
  Cost Loading. The Schedule-only toolbar (Add activity/Group/Zoom/etc.) is hidden here too, same
  as on Planner/Cost Loading.
- **Week navigator** (`_lpWeek`, `mondayOf(d)`, prev/next/"This week", persisted per-project in
  localStorage) + **Add commitment** modal (description, optional linked activity picked from the
  live schedule, responsible).
- **Weekly commitments table**: inline **Status** (Open/Complete/Not Complete) and **Reason code**
  selects per row (reason select disabled unless status is Not Complete) — changes save immediately
  (`lpUpdate`), matching a real Friday-afternoon review workflow rather than requiring the edit modal
  for every status flip. Reason codes are a fixed Last-Planner-standard list (`LP_REASONS`: Materials,
  Manpower/Labor, Equipment, Prior Work Not Complete, Design/Information, Weather, Owner/Client
  Decision, Rework, Other).
- **PPC KPI** for the selected week = `Complete ÷ (Complete + Not Complete)` — **Open (not yet
  reviewed) commitments are excluded from the denominator** so a PPC number doesn't read artificially
  low mid-week before the review happens; the KPI row also shows the raw Open count so it's clear
  not everything's been assessed yet.
- **PPC trend chart** (`renderLPPpcTrend`): all weeks with ≥1 assessed commitment, plotted against a
  dashed 80% Lean-Construction benchmark line. **PPC trend / Reasons for variance** panels reuse the
  cockpit's `.ps-ck-trend-card`/`.ps-risk-torn-row` visual language rather than inventing new chart
  chrome.
- **Reasons for variance** (`renderLPReasons`): a Pareto-style ranked bar list of reason codes across
  **all** Not-Complete commitments (not just the current week), so recurring root causes are visible
  even if this week's variance count is small.
- Verified in throwaway gitignored harnesses (`_ui_test.html`): `mondayOf()` hand-checked against all
  7 weekdays (Sun correctly maps back to the *previous* Monday, Mon–Sat map to their own week);
  `physicalPct` weighted-average matched a hand calc (2·100+3·80+3·0+2·0)/10 = 44%; the Activity-
  Codes assignment `<select>`s correctly pre-select an activity's existing code values; screenshotted
  the PPC trend chart and — same lesson as the Milestone Outlook timeline earlier — caught and fixed
  an edge-label clipping bug (last x-axis date ran off the SVG's right edge) before shipping.

## First-class WBS (2026-07-07) — WBS Manager + dedicated wbs_nodes table
User wanted the Work Breakdown Structure built FIRST (unlimited depth), then activities placed under
any main- or sub-node — rather than hand-typing dotted codes. **Migration:** `../../migrations/
2026-07-07-wbs-nodes.sql` (`wbs_nodes` table + `project_schedule.wbs_node_id`).
- **Architecture (chosen by user): dedicated `wbs_nodes` table** (id, parent_id, code, code_custom,
  name, sort_order) as the AUTHORING source of truth for the tree. Codes are **auto-numbered from
  tree position** (`computeWbsCodes` → 1, 1.1, 1.1.2…) but **editable** (`code_custom` keeps a typed
  code e.g. `CIV-100`; its subtree is prefixed by it).
- **Projection (key integration):** the existing grid/roll-up/CPM/importer pipeline keys off the
  dotted `project_schedule.wbs` code + `activity_type='WBS Summary'` rows, so on every tree edit the
  app PROJECTS the nodes into those summary rows (`_wbsCommit`: recompute codes → update each node's
  `wbs_nodes.code`, its linked WBS-Summary row's `wbs`+`activity_name`, and the `wbs` of activities
  under any re-coded node; batched via `_batchUpdate`). This keeps the entire tested pipeline
  UNCHANGED — no rewrite of grouping/rollups/importers.
- **WBS Manager** — new view (`#ps-view-wbs`, sidebar `data-view="wbs"` + title menu `data-tab="wbs"`,
  `renderWbsManager`): indented tree with per-node Add-child, Move up/down, **Indent/Outdent**, Edit
  code, Delete; inline name edit; badges (sub-count · activity-count). Node CRUD: `wbsAddChild`/
  `wbsAddRoot` (inserts node + a projected WBS-Summary row), `wbsRename`, `wbsMove` (up/down/indent/
  outdent using the verified tree algos + `_wbsNormalizeAndPersist`), `wbsEditCode`, `wbsDelete`
  (**guarded** — blocks if the node still has sub-nodes or activities). Tree algorithms
  (auto-numbering, custom codes, move/indent/outdent, guards) unit-tested in a node harness.
- **Adopt existing WBS** (`wbsAdopt`) — one-time bridge for imported/legacy projects: builds `wbs_nodes`
  from the current WBS-Summary rows (parents resolved by dotted-code prefix, depth-ordered so parents
  exist first; codes preserved as `code_custom`), then links the summary rows + matching activities via
  `wbs_node_id`. Importers stay unchanged (they still create summary rows); Adopt pulls them into the
  manager. The Adopt button auto-shows only when un-adopted summary rows exist.
- **Add/Edit activity** — new **Parent WBS picker** (`#ps-f-wbs-node`, indented `wbsPickerOptions`)
  before the WBS Code field: picking a node auto-fills + locks the code and sets `wbs_node_id`
  (written tolerantly, like `contract_date`). Direct code entry still works when no tree exists yet
  (back-compat). `wbs_node_id` also added to the Add/Edit save + activity save paths.

## Toolbar/topbar de-clutter (2026-07-07) — File menu + labeled groups
The top area had ~22 icon-only buttons, several sharing a glyph (pulse=Health & Spotlight, risk=
Critical & Threshold/Monte-Carlo, listView=Layouts & UDF/GlobalChange, layers=Expand & Baselines) —
so planners had to guess. Reworked to labeled controls + grouping (no logic changes to the underlying
actions; ids preserved so all existing handlers work unchanged):
- **File ▾ menu** (topbar, `#ps-filebtn`/`#ps-file-menu`): **Import, Export, Print** combined. Import/
  Export were removed from the **Actions ▾** menu and the standalone Print icon removed from the topbar;
  the three item buttons keep their original ids (`ps-import`/`ps-export`/`ps-print`) so their handlers
  are untouched. `.ps-tb-labeled` gives topbar buttons auto width (icon + word); `.ps-tb-sep` dividers.
- **Topbar** now: undo · redo │ **File ▾** · **Reports** · **Health** (last two now show text labels) │
  filter · refresh. Undo/redo/filter/refresh stay icon-only (universally understood).
- **Lower toolbar** relabeled every icon button to icon+word: **Expand · Outline ▾ · Layouts ▾ ·
  Schedule · Layout ▾ · Columns ▾ · Colors ▾** (all keep their existing `.ps-menu-wrap` popovers +
  ids/handlers — just labels + drop `.ps-icobtn` fixed width).
- **Analyze ▾ menu** (`#ps-analyzebtn`/`#ps-analyze-menu`): the four analysis controls — **Critical
  path · Show dependencies · Link mode · Progress Spotlight** (advance 1/2wk·1mo·clear) — grouped into
  one labeled dropdown. The crit/deps/linkmode items keep their ids so their toggle handlers are
  unchanged; `analyzeMenu` stops click propagation so several can be toggled without closing, and
  `_syncAnalyzeBtn()` (module scope) mirrors any-active (crit/deps/link/`_spotlight.on`) onto the
  Analyze button (`#ps-analyzebtn.active`). The standalone `#ps-spotlight` button was removed (its
  `#ps-spotlight-menu` data-spot items now live inside Analyze); `advanceSpotlight`/`clearSpotlight`
  call `_syncAnalyzeBtn()` instead of touching the old button.
- `closeMenus()` gained `fileMenu` + `analyzeMenu`. Net: ~22 mystery icons → labeled words + 2 grouped
  dropdowns (File, Analyze), collisions gone.

## Advanced scheduling batch (2026-07-07) — 9 features, easiest→hardest
All in `modules/project-schedule/index.html`. Each feature was unit-tested (pure logic extracted
into a node harness) and committed+pushed separately. **User must run the new migrations** listed.

1. **Progress Spotlight / data-date advancement** (no migration). Toolbar Spotlight menu (`#ps-spotlight`,
   `advanceSpotlight`/`clearSpotlight`/`spotlightRow`): advance the data date 1/2 weeks or 1 month and
   blue-highlight (+dim the rest, mirroring critMode) the incomplete activities whose planned work fell
   in the window just passed — the exact set to status. `_spotlight={on,start,end}`; row class
   `ps-spotrow`, bar class `ps-spot`, `ps-spotmode` on grid-scroll + gantt-pane.
2. **Constraint-aware CPM** (no migration; uses existing primary/secondary constraint fields). `cpmLogic`
   now honors date constraints in both passes via `taskConstraints`/`fwdConstrain`/`bwdConstrain`:
   Start/Finish On·On-or-After·Mandatory pin/floor early dates (forward, applied LAST after the data-date
   floor); Start/Finish On-or-Before·Mandatory cap the late finish (backward); As-Late-As-Possible sits
   the activity at its late dates. **Critical is now `_float <= 0`** (was `=== 0`) so over-constrained
   (negative-float) activities flag critical — the point of the feature.
3. **Global Change** (no migration). Actions ▸ Global Change: WHERE conditions (field/op/value, ANDed;
   blank=all) + THEN changes (Set/Add/Subtract/Multiply/Clear · text/num, Set/Shift-days · date) with a
   live Preview count. `GC_FIELDS` catalog with per-type ops; `gcMatch`/`gcBuildPatch`; moving start/finish
   auto-recomputes duration. Chunked writes, resets undo, confirms first (same safety model as the bulk
   progress grid).
4. **Resource leveling / over-allocation resolver** (no migration). Actions ▸ Resource leveling
   (`levelScan`/`renderLeveling`/`levelDelay`): scans each resource's monthly planned demand vs calendar
   capacity (reuses `spreadAdd`+`resCapacity`), reports over-allocated periods + peak overage, lists the
   flexible (positive-float, not-started) contributors, and delays one within its own total float per
   click (through `persist()` → undoable + recomputes CPM; report re-scans). Never moves the project
   finish; critical/started contributors untouched.
5. **What-if scenarios (reflections)** — **migration `2026-07-07-schedule-scenarios.sql`**
   (`schedule_scenarios`). Actions ▸ What-if scenarios: capture the schedule as a named jsonb checkpoint
   (dates/dur/%/predecessors/cost), experiment on the live schedule, compare live-vs-scenario deltas
   (finish / critical count / planned cost / activities that moved), or **Restore** to roll the experiment
   back. Mirrors the baselines two-pane modal.
6. **User-Defined Fields** — **migration `2026-07-07-user-defined-fields.sql`** (`activity_udf_defs` +
   `project_schedule.udf jsonb`). Actions ▸ User-Defined Fields defines typed fields (Text/Number/Date/
   Cost); Add/Edit modal renders one typed input per def (`populateUdfFields`, saved tolerantly to `udf`
   jsonb, same pattern as `activity_codes`); values show in the details General tab. `UDF_DEFS` loaded in
   `loadResourcesAssignments`.
7. **Resource/cost distribution curves** — **migration `2026-07-07-assignment-curve.sql`**
   (`resource_assignments.curve`). Assignment modal gains a Distribution curve (Linear/Front/Back/Bell);
   new `curveCdf`+`spreadCurveAdd` shape how planned+remaining units are time-phased in Resource Usage
   (actuals stay linear). `spreadCurveAdd` uses each curve's cumulative fn → O(months), exact,
   total-conserving; `linear` reduces to `spreadAdd` exactly (verified). Curve written tolerantly.
8. **Saved layouts** (no migration; localStorage `ps_views`). The Saved-views control now bundles the
   FULL working arrangement — filter + grouping (incl. `code:<id>` groups) + zoom/search + the whole
   column setup (hidden columns / column sort / renamed headers / `--c-*` widths). `applyView` restores
   all of it and writes back to the same localStorage keys the renderers read; old saved views still
   apply (each field guarded).
9. **Threshold monitoring → auto-issues** — **migration `2026-07-07-schedule-thresholds.sql`**
   (`schedule_thresholds`). Actions ▸ Threshold monitoring: rules watching a per-activity metric
   (`float_below` / `finish_var_above` / `contract_var_above` / `overdue_days`) at a severity. "Scan now"
   (`scanThresholds`/`thrValue`/`thrBreached`) lists breaches; "Generate issues" writes them into the
   shared **`issues_lessons`** table (type=Issue, category='Schedule Threshold'), **deduplicated** against
   still-open threshold issues for the same activity+rule (deterministic `_thrIssueTitle`) so repeated
   scans don't spam duplicates.

## Monte Carlo: per-activity 3-point duration override (2026-07-07)
**Migration:** `../../migrations/2026-07-07-risk-3point-duration.sql` (`project_schedule.risk_optimistic_pct`/
`risk_pessimistic_pct`, both `numeric(6,2)`, nullable — folded into `supabase-setup.sql`).
Prioritized over adding a criticality-index output: the simulation previously applied ONE global
Optimistic%/Pessimistic% to every activity regardless of type, so a 2-day punch-list item and a
180-day long-lead procurement activity got the identical relative spread — an input-fidelity gap
that limits every downstream output (P50/P80/P90, tornado). A criticality index would instead need
a **backward pass per iteration** (to get float), roughly doubling compute right where 27k-activity/
1000-iteration runs are already flagged as heavy, and its result would mostly just re-derive what
the tornado already shows under a uniform-variance model. The override is compute-neutral (same
forward-pass-only architecture, per-node opt/pess instead of one global pair) and improves every
existing output immediately, so it came first.
- **Add/Edit Activity modal** gained **Risk: Optimistic %**/**Risk: Pessimistic %** fields (next to
  Contract Date) — blank (the default) means "use the simulation-wide default"; set only on the
  activities a planner actually has a stronger/weaker view on (e.g. long-lead procurement,
  permitting, weather-sensitive site work). Written **separately + tolerantly** after the main
  save (own try/catch, like `contract_date`), so a not-yet-migrated DB doesn't break saves — and so
  a missing `risk_*` column can't also swallow the `contract_date` write, or vice versa (kept as
  two independent tolerant updates rather than one combined payload).
- **`_riskPrep()`** captures `riskOpt`/`riskPess` (the activity's own %, `/100`, or `null`) per node.
  **`runRisk()`** computes each varied node's *effective* range once before the iteration loop
  (`nd._opt`/`nd._pess` = the override or the global default; re-clamped so pess>opt exactly like
  the global pair already was) — not per-iteration, since it's invariant across samples — and the
  sampling loop calls `_triSample(nd._opt, 1, nd._pess)` instead of the global `opt`/`pess`.
- **Results surface which activities used a custom estimate**: the count line adds "· N with a
  custom 3-point estimate", and any overridden activity in the **tornado** (top duration drivers)
  gets a small "(custom)" tag next to its name.
- Verified in a node harness (no DOM/backend touched): the effective-range fallback/clamp logic
  hand-checked across 5 cases (both null → global; one overridden → mixed; both overridden with
  pess≤opt → guard re-clamps, matching the global pair's own guard); `_triSample` re-verified with a
  realistic per-activity override range (opt 70%/pess 115%) — sampled mean matched `(a+c+b)/3`
  exactly over 300k draws, bounds respected.

## OPC parity: Multiple baselines + Monte Carlo risk (2026-07-07)
Both reached from the **Actions ▾** menu (`#ps-baselines`, `#ps-risk`).

**Multiple baselines** — **Migration:** `../../migrations/2026-07-07-schedule-baselines.sql`
(`schedule_baselines`: one row/baseline, `activities` jsonb `{ "<activity_id>":[start,finish,dur,
planned_cost] }`, `is_primary`, RLS via `is_approved`/`is_planner`). Modal `#ps-bl-back` (list + compare
panes). `captureBaseline()` snapshots all leaf activities; `setPrimaryBaseline()` flags one primary AND
**writes its dates back onto `project_schedule.bl_start/bl_finish/bl_cost`** (chunked, then `load()`) so
the existing Gantt BL0 bar + `finVar` variance use it; `showBlCompare()` shows per-activity
current-vs-baseline finish variance (top 300, sorted by slip, avg + late count); `deleteBaseline()`.
Tolerant of a missing table (shows a "run the migration" note).

**Monte Carlo schedule risk** — **no migration** (pure client compute). Modal `#ps-risk-back`.
`_riskPrep()` builds the task graph + topological `order` (same Kahn approach as `cpmLogic`) once;
`_riskForward(prep,durs)` is a single forward pass returning project finish (max EF) for a given
duration array. `runRisk()` samples each **incomplete, not-started** activity's duration from a
**triangular** distribution between Optimistic% and Pessimistic% of plan (mode = 100%; completed/started
keep actuals) via `_triSample`, runs N iterations (default 1000, chunked 100/frame with a progress %
so the UI never freezes — leverages the O(n+e) CPM), and accumulates running sums for a
**duration-sensitivity** (Pearson r of each activity's sampled duration vs the finish — no per-iteration
backward pass needed). `finalizeRisk()` shows P50/P80/P90 finish dates, deterministic (plan) finish,
P80-vs-plan slip, a 30-bin finish-date histogram, and a **tornado of the top duration drivers**. Finish
date = `base + EF − 1` (inclusive, matches `applyScheduleDates`). Verified in a node harness: triangular
mean = (o+m+p)/3 exactly, bounds respected, percentiles monotonic and right-skewed of the deterministic
finish.

## PWA / offline resilience (2026-07-07) — app-wide
For flaky site connectivity. Three new pieces, all safe-by-construction:
- **`sw.js`** (repo root) — a **network-first** service worker: only same-origin GET is handled;
  writes and ALL cross-origin (Supabase REST/auth) pass straight through (never cached/queued).
  Online it always fetches fresh then refreshes the cache; offline it falls back to the last cached
  asset/page. Because network is tried first, it can only ADD an offline fallback — never serves
  stale while online. Bump `CACHE` (`pd-shell-v*`) to purge.
- **`manifest.webmanifest`** (repo root) — installable (name/icons/theme `#EE3124`, `display:standalone`).
- **`assets/js/theme.js`** (loaded on every page) now, app-wide: derives the app root from its own
  script URL (works at any page depth), injects the `<link rel=manifest>` + `theme-color` meta,
  registers `sw.js` on `load`, and shows a fixed **offline indicator** ("Offline — … changes won't
  save") toggled by `online`/`offline` events (pure UI, no caching risk).
- **NOT offline writes** — edits still require connectivity (the indicator says so). Full offline
  write-queue/sync is deliberately out of scope (auth + conflict complexity).
- Module `?v=` → 20260709 (theme.js changed). NOTE: could not be tested against the live GitHub
  Pages origin from here; network-first is the safest strategy but verify install/offline on staging.

## Planner batch 7 (2026-07-07) — Cockpit redeveloped as a client-facing outlook, not tables
User feedback after batch 6 (which had already turned the two list panels into bar charts): "still
doesn't feel very useful... shouldn't be full of tables," and asked what a **Client** would want to
see. Agreed direction: are-we-on-track, when-will-it-finish, what's-at-risk — a snapshot/outlook,
not an activity punch list. Rebuilt the passive dashboard content (kept the `.ps-ck-bar` action
buttons — Update progress/Export lookahead/Take snapshot/Snapshots/Change history — since those are
on-demand tools, not part of the problem):
- **Status banner** (`_ckStatusHTML`, `#ps-ck-status`, top of the page): a traffic-light chip (On
  Track / At Risk / Behind Schedule — thresholds 0d / 30d off the forecast-vs-planned finish) plus
  one auto-generated sentence: "{Project} is X% complete. At the current pace, forecast finish is
  {date}, {N days past / on pace with} the planned finish ({date}). N milestones at risk. N exposed
  to contract-date (LD) risk." This is the single thing a client should read first.
- **New hero chart — Progress S-Curve & Forecast** (`_ckSCurveCompute`/`_ckSCurveSVG`, replaces
  batch 6's snapshot-based "Progress Trend" line): duration-weighted Planned / Actual / Forecast-
  to-finish curves, **ported verbatim from the standalone `modules/s-curve/` module's
  `compute()`/`renderChart()`** (same math — SPI-based forecast clamped 0.1–3, S-curve-shaped
  forecast tail, data-date line) but reusing this module's **already-loaded `rows`** for the current
  project instead of a second fetch, so it draws instantly with zero network cost. Strictly better
  than the snapshot trend it replaced: always available (no dependency on planners remembering to
  take weekly snapshots), and it's the chart a client actually recognizes from monthly reports. No
  manual forecast-override input here (that stays a feature of the dedicated s-curve module) — the
  cockpit's version is auto/SPI-only by design, kept simple.
- **New "Milestone Outlook" timeline** (`_ckMilestoneTimeline`, replaces the "Milestones at risk"
  list): every milestone plotted on a single date axis as a dumbbell — a faint gray dot at its
  baseline finish, a colored dot at its current forecast/actual finish, joined by a line when they
  differ. Color = status (green on-track / amber ≤14d late / red >14d late, thresholds intentionally
  tighter than the project-level status banner since a single milestone slipping 2 weeks matters
  more than the overall project doing so). Shows the WHOLE milestone set, not just the late ones —
  a client wants "what's coming up," not only "what's already broken." Only at-risk/late milestones
  get a text label (alternating above/below to reduce overlap); labels are clamped inside the
  viewBox (`padL+22`/`padL+cw-22`) so the first/last milestone's label doesn't clip off the edge —
  caught by screenshotting a throwaway harness before shipping.
- **"Top risk drivers"** (was "Most behind schedule"): same ranked bar rows as batch 6, just capped
  to the top 5 with a "+N more — see Update progress/Export lookahead" footer instead of a 60-row
  scrolling list.
- **Critical-path drivers**: kept the batch-6 float-bucket strip chart; the scrolling row-list below
  it became compact non-scrolling **pills** (`fillPills`, `.ps-ck-pill`, up to 18 + "+N more") — a
  name badge per activity, click still jumps to the Schedule view with that activity selected.
- **"3-week lookahead" panel removed from the passive view entirely** — it's an action checklist,
  not an outlook metric, and the same scope is still fully available via "Update progress…" (the
  bulk-edit grid, which has its own Due-2/3/6-weeks scope filter) and "Export lookahead" (the XLSX
  site-meeting handout); only its count remains, folded into the KPI strip.
- KPI strip condensed from 7 tiles to 6, swapping "Activities behind"/"Data date" (now in the
  headline sentence / chart data-date line) for "Forecast finish" (with a +Nd-vs-plan sub-label).
- Removed the now-dead snapshot-trend code (`_ckLoadTrend`/`_renderCkTrend`/`_ckTrendSVG` and the
  `_ckTrend` cache/invalidation call in `takeSnapshot`) rather than leaving it unused — "Take
  snapshot"/"Snapshots"/"Change history" still work exactly as before, just no longer feed a trend
  chart (the S-curve replaced that need).
- Verified with a throwaway gitignored harness (`_ui_test.html`) against a hand-built 12-activity/
  6-milestone fixture (mobilization on-time, substructure done-but-late, superstructure behind,
  MEPF/finishes not started) with a pinned data date: screenshotted the status banner (correctly
  read "Behind Schedule", 35% complete, forecast 186 days past plan), the S-curve (planned/actual/
  dashed-forecast rendered correctly, actual line flat past the data date as expected), and the
  milestone timeline (all four status colors present, dumbbell baseline-vs-forecast lines correct,
  labels legible and non-clipping after the padding fix above).

## Planner Cockpit (2026-07-07) — batch 1 of the planner roadmap
New third view (`#ps-view-planner`, sidebar `data-view="planner"` + title menu `data-tab="planner"`,
`activeTab==='planner'`). `renderPlanner()` (called from `switchTab`/`renderAll`) is a read-only
weekly cockpit built entirely from existing columns (no schema change): KPI row (overall % complete,
activities behind baseline, milestones at risk, critical count, due-in-3-weeks, data date) + four
lists — **Milestones at risk** & **Most behind schedule** (via `finVar` = forecast finish − baseline
finish, days late), **3-week lookahead** (incomplete activities whose start/finish falls in
[data date, +21d]), **Critical-path drivers** (`_critical` from `computeCPM`). Rows click → jump to
the Schedule view with the activity selected. CSS `.ps-ck-*`.

## Planner batch 6 (2026-07-07) — Cockpit charts (replace list rows) + Schedule-only toolbar hidden
User feedback: the four cockpit panels were "just scrollable tables," not useful for reporting/
tracking; also the Schedule grid's toolbar (Actions/Add activity/Group/Zoom/Expand/Views/Schedule/
Layout/Columns/Colors/Critical path/Link/Search) showed on the Planner and Cost Loading tabs where
none of it applies.
- **Milestones at risk / Most behind schedule are now ranked bar charts, not plain rows**: each row
  (`barRow()` in `renderPlanner()`) got a horizontal bar (`.ps-ck-bartrack`/`.ps-ck-barfill`) whose
  width is the item's slip days relative to the worst item in that same list (so the worst offender
  reads as a full bar, not just a bigger number), colored by severity tier (`sev-1/2/3`: ≤7d / 8–21d
  / >21d, via opacity on `var(--pd-red)`). Same click-to-jump-to-Schedule behavior as before (still
  `.ps-ck-row`).
- **New "Progress Trend" chart** (`#ps-ck-trend`, above the 2×2 grid): an SVG line chart
  (`_ckTrendSVG`) plotting `pct_complete` across the project's saved **Schedule Snapshots**
  (`schedule_snapshots` — the same table "Take snapshot" already writes to), so a planner can see
  week-over-week whether the project is catching up or slipping instead of re-reading one static
  KPI. Lazy-loaded per project (`_ckLoadTrend`/`_ckTrend` cache, invalidated when a project switches
  or a new snapshot is taken) so opening the cockpit isn't blocked on a network round-trip. Needs
  ≥2 snapshots to draw a line; otherwise shows an empty-state nudging the user toward "Take
  snapshot." Tolerant of a missing table (shows a migration hint, same pattern as the rest of the
  cockpit).
- **Critical-path drivers gained a float-bucket summary strip** (`_ckFloatBuckets`, `#ps-ck-buckets`,
  above the existing driver list): a segmented bar + legend counting incomplete activities into
  Critical (0d) / 1–5d / 6–15d / >15d float, so the panel reads as "how much slack is left in the
  schedule" before drilling into names.
- **3-week lookahead is unchanged** (stays a plain list) — it's an action checklist for the coming
  weeks, not a trend or ranking, so a chart wouldn't add anything.
- **Schedule-only toolbar now hidden outside the Schedule tab**: `switchTab()` toggles
  `.ps-toolbar` display — visible only when `tab==='schedule'`, hidden on Planner Cockpit AND Cost
  Loading (matches how `#ps-view-schedule`/`#ps-view-cost`/`#ps-view-planner` are already toggled).
- Verified with a throwaway gitignored harness (`_ui_test.html`, matches the `**/_ui_test.html`
  gitignore pattern from Prompt 53) rendering the real CSS + the new functions against synthetic
  data, screenshotted, then deleted: bar widths/severity shading scale correctly against each
  list's own max, LD tags still render, the float-bucket counts matched a hand-count (2 critical /
  1 each in the other three buckets from a 7-task fixture), and the trend SVG drew a 6-point line
  with correct gridlines/date labels/end-value callout.

## Planner batch 5 (2026-07-07) — Change history (audit trail)
**Migration:** `../../migrations/2026-07-07-schedule-audit.sql` (`schedule_audit`, insert-only for
planners, read for approved). `logAudit(r, action, changes)` is **fire-and-forget + tolerant** (a
missing table never breaks a save). Hooked into `persist()` (inline/grid/drag/link/tracker edits —
`_auditChanges(prev, patch)` diff), modal `save()` insert, `saveBulkUpdate()` (per row), and
`applyScheduleDates()` (one `reschedule` event with a count). Cockpit **Change history**
(`openAudit`, `#ps-audit-back`) lists the last 400 changes (When / Who [resolved via
`PDb.getAllUsers`] / Activity / field from→to), `_auditSummary` formats dates.

## Planner batch 4 (2026-07-07) — Schedule snapshots (milestones + summary)
**Migration:** `../../migrations/2026-07-07-schedule-snapshots.sql` (`schedule_snapshots` table +
RLS via `is_approved()`/`is_planner()`). Cockpit **Take snapshot** (`takeSnapshot`) captures a
summary (avg % / activities total+behind / milestones total+at-risk / project finish) plus every
milestone's forecast/baseline/contract date as `milestones` jsonb — one row per snapshot (scales to
27k activities). **Snapshots** (`openSnapshots`, `#ps-snap-back`) lists them; selecting one shows a
**milestone drift** table (Then forecast vs Now forecast, +Nd drift). `deleteSnapshot` removes one.
Fully tolerant — missing table just shows a "run the migration" note, never breaks the cockpit.

## Planner batch 3 (2026-07-07) — Contract date + LD tracker
**Migration:** `../../migrations/2026-07-07-schedule-contract-date.sql` (adds
`project_schedule.contract_date date`). A **Contract Date** field is in the Add/Edit modal
(`#ps-f-contract`, next to Baseline Finish). To avoid breaking saves on a not-yet-migrated DB,
`contract_date` is written **separately + tolerantly** after the main save (a missing-column error
is swallowed) — it is NOT in the main payload. `contractVar(r)` = forecast finish − contract date
(+ = LD exposure). Cockpit adds a **"Contract dates at risk"** KPI and an **"LD +Nd"** tag on the
Milestones-at-risk / Most-behind rows when the forecast passes the contract date.

## Planner batch 2 (2026-07-07) — bulk progress update + lookahead export
Both schema-free, driven from the cockpit action bar (`.ps-ck-bar`).
- **Bulk "Update Progress" grid** (`#ps-bulk-back` overlay): `openBulkUpdate()` → `renderBulkBody()`
  lists incomplete activities filtered by `#ps-bulk-scope` (Due 2/3/6 wks / In progress / All
  incomplete) + a text filter, each row with inline Status / % Complete / Actual start / Actual
  finish inputs. Edits accumulate in `_bulkEdits{id:{field:val}}` (row goes `.dirty`);
  `saveBulkUpdate()` writes changed rows in chunks of 40 via direct `update().eq('id')`, updates
  local `rows`, `rebuild()/computeCPM()/renderAll()`. Overdue target-finish flagged red.
- **Lookahead window + export**: `_ckLookWeeks` (2/3/4/6, `#ps-ck-weeks`) drives BOTH the cockpit
  "N-week lookahead" panel (`_ckLookSet()`) and `exportLookahead()` (XLSX handout: ID/Activity/
  Status/Start/Finish/%/Critical/Float/Responsible for the window).

## Topbar + project browser (2026-07-07)
- **Topbar tools spacing**: the global tool cluster (`#ps-topbar-tools`: undo/redo/health/reports/
  filter/refresh/print) now uses uniform 34×34 buttons, `gap:4px`, a left divider, and a divider
  before `#user-bar`; the theme toggle (`#pd-theme-toggle`, injected by theme.js before `#user-bar`)
  is sized to match. Removed the conflicting `width:36px` vs `padding:0 9px` rules.
- **OPC-style project browser (folder navigator — scales to 100+ schedules)**: the flat project
  `<select>` is hidden (kept as source of truth for `projName()` / load) behind `#ps-projsel-btn`,
  which opens `#ps-projsel-menu`. `renderProjectSelector()` shows **one folder level at a time**
  (state `_pssPath` = current workspace id, `''` = root): sub-folders (workspace/program/group nodes
  from the `workspaces` tree, with a node-type badge + a **descendant project count**) then the
  projects directly under the folder. A **breadcrumb** (`.ps-pss-crumb`, `_pssCrumbs`) walks back up;
  clicking a folder drills in. A **search box** (`_pssSearch`) flattens to matching projects across
  the whole tree (breadcrumb hidden while searching). Opening the menu sets `_pssPath` to the current
  project's `workspace_id` so it lands in context. Picking a project → `selectProject(id)` (syncs the
  hidden select + labels, reloads). `folder` icon added to icons.js. `.ps-projctx` is
  `position:relative` (NOT `.ps-menu-wrap`, which forces inline-block and breaks the name/workspace
  column). Module `?v=` → 20260708.

## Gantt timeline scale (2026-07-07) — adjustable period-column width
The Gantt timescale width is `dayw = DAYW[zoom] * ganttScale`. `DAYW` sets the base px/day per
Month/Quarter/Year; **`ganttScale`** (persisted `localStorage.ps_ganttscale`, clamped 0.35–6) lets
the user widen/narrow the period columns. Two gestures adjust it (the +/− buttons were removed):
- **Excel-style drag**: each date-header cell (`.ps-yr`/`.ps-mo`) carries a right-edge grip
  (`.ps-ts-grip`, `data-days` = its day span). `startTsResize(e, days)` rescales uniformly —
  `newDayw = startDayw + dragDx/days` → `ganttScale = newDayw / DAYW[zoom]` — re-rendering per rAF,
  saving on mouseup.
- **Ctrl + mouse-wheel** over `#ps-gantt-scroll`: `applyGanttScale(ganttScale × 1.15^±1)`, keeping
  the date under the cursor fixed (capture content-x ratio before, restore `scrollLeft` after a
  double-rAF since `renderGantt→scheduleRender` batches `doRender` one frame later).
`applyGanttScale(v)` / `_saveGanttScale()` are module-scope. (This is the Gantt month/qtr/year
column width — NOT the activity-grid columns.)

## Column drag-to-reorder (2026-07-08)
Header cells are `draggable` (HTML5 DnD): drag one onto another to reorder. Implemented purely via CSS
flex `order` — `applyColOrder()` writes `.ps-cell:nth-child(i){order:p}` rules keyed to each column's
DOM/data index, so the **DOM stays in data order** and everything positional keeps working (nth-child
hide, `data-ci`→`openColMenu`, `colSortVal`, resize) while only the VISUAL order changes. State is a
persisted `ps_colorder` list of `colKey`s; `normalizeColOrder()` appends new columns / drops removed
ones; `moveCol(src,tgt)` drops src before tgt. The resize grip preventDefaults its mousedown so it
resizes (not drags); a plain click still opens the column menu. Columns ▾ **Reset** also clears the
order back to default. NOTE (2026-07-08): removed the Procurement-flavoured UDF example text
("Cost Code / PO Number / Vendor / Risk Owner") — those belong to the separate Procurement Dashboard,
not the Planning App; the UDF prompt/empty-state are now domain-neutral.

## Dynamic columns (2026-07-08) — Activity Codes + UDFs as grid columns
"Define columns" now matches OPC: the project's **Activity Codes** and **User-Defined Fields** appear
as real, choosable grid columns (no new migration — reuses `CODE_TYPES`/`CODE_VALUES`/`UDF_DEFS` +
`project_schedule.activity_codes`/`udf` jsonb). `extraColDefs()` maps them to `[key,label,'c-x',meta]`
tuples; `gridCols() = GRID_COLS.concat(extraColDefs())` is the single source the whole column pipeline
now iterates (`renderHeader`, `applyColHidden`, `openColMenu`, `fitColumn`, `renderColsMenu`,
`colSortVal`). `gridRowHTML` appends `gridExtraHtml(r)` to ALL three row kinds (value on leaf tasks,
blank on group/WBS) so cell counts — and the `nth-child` hide rules — stay aligned. `extraCellVal`
reads the code value (`codeValueLabel`) or UDF (`udfFmt`). Extra columns share the resizable `--c-x`
width. **Collision-safe:** hide/rename use `colKey(c)` — built-ins keep their LABEL key (back-compat),
extras use their unique id (`code:<id>`/`udf:<id>`), so a code/UDF named e.g. "Status" can't hide the
built-in Status. Extras **default hidden** (`seedExtraHidden` + `ps_colseen`) — OPC-style deliberate
add via the Columns ▾ chooser, which now has an "Activity Codes & User-Defined Fields" sub-section
(Show all / Hide all / Reset — Reset re-seeds extras hidden). New codes/UDFs appear as columns when
their editor modal closes (`closeCodes`/`closeUdf` → `renderHeader`+`renderGrid`). Verified in a node
harness (collision-safety + hide-index alignment). NOTE: the Excel export still uses its fixed header
set — extra columns are grid-only for now.

## Columns (2026-07-07) — eye-icon show/hide, resize everywhere, export toggle
- **Eye-icon multi-select chooser**: the toolbar column button is now an **eye** icon
  (`icons.js` gained `eye`/`eyeOff`). `renderColsMenu()` shows a checkbox per column (ticked =
  visible) with a per-row eye glyph + **Show all / Hide all / Reset** footer. It is
  **context-aware**: on the Schedule tab it lists `GRID_COLS`; on the Cost Loading tab it lists
  `COST_COLS` (driven by `activeTab`, set in `switchTab`). Hidden state persists in
  `localStorage.ps_colhidden` (keyed by label; `saveColHidden()`).
- **Cost Loading table is now dynamic** (was static HTML). `COST_COLS` defines label / num /
  locked / default width / `cell(r)` / `tot(T)` renderers; `renderCost()` builds `<colgroup>` +
  `<thead>` (with `.ps-colgrip` handles) + `<tbody>`, **skipping hidden columns** and applying
  persisted widths (`localStorage.ps_costcols`, `startCostColResize`). Table is `table-layout:fixed`;
  the totals row now emits one cell per visible column (no colspan) so hide/resize line up.
- **Gantt-only layout keeps the columns**: `.ps-split.ps-gantt-only .ps-grid-pane` no longer
  `display:none` — it stays as a compact (300px default) **resizable + hideable** activity-column
  table beside the bars (Primavera-style). Drag the divider / hide columns for a leaner view.
- **Export honors hidden columns**: `exportExcel(includeHidden)` filters out headers whose grid
  column is hidden (`EXP_TO_GRID`/`expHeaderHidden`); % and ₱ number formats + column widths are
  resolved by header NAME (so positions stay correct when columns are dropped). `downloadSchedule()`
  (wired to `#ps-download`) prompts "Include hidden columns?" only when an exportable column is
  hidden, else exports directly.
- Module page `?v=` bumped to **20260707** (icons.js changed — shared asset, cache-busted).

## Scheduling (2026-07-06) — Reschedule dependent activities (relationship-driven dates)
The CPM forward pass (`cpmLogic`) computes each activity's early start/finish (`_es`/`_ef`,
day offsets from `_cpmBase`) honoring FS/SS/FF/SF + lag, actual dates, the data date, and
Retained-Logic/Progress-Override — but historically only used them for critical-path highlight.
`applyScheduleDates()` now WRITES those back so a successor's Start/Finish moves when a
predecessor's (actual or planned) dates change. Rules: completed activities (actual finish) keep
their dates; started-but-unfinished keep their Start (actual-pinned) and only Finish moves;
milestones snap to `_es`. `_ef` is start+duration (one past the inclusive last day) so finish =
`off(_ef - 1)`. Bulk-writes in chunks of 40 via direct `update().eq('id')`, updates local rows,
then `rebuild()/computeCPM()/renderAll()`; confirms first and is not per-step undoable
(`resetUndo()`). Wired into the **Schedule** dialog: a **"Reschedule dependent activities"**
checkbox (`#ps-dd-resched`, persisted `localStorage.ps_resched`, state `reschedOn`); `scheduleNow()`
runs `computeCPM()` then, if checked and `mode==='logic'`, calls `applyScheduleDates()`. Without
relationships it warns instead (nothing to drive the moves). This is P6-F9-style manual reschedule
(explicit, not automatic on every edit) to avoid silently rewriting dates.

## Import (2026-07-06) — Predecessors + Successors columns (Excel/OPC)
`parseWorkbook` now detects BOTH the **Predecessors** (`cPred`) and **Successors**
(`cSucc`) columns of an OPC/Primavera Cloud `.xlsx` export. Relationships are stored
as `predecessors` text only (single source of truth); the CPM engine derives successors
as the inverse. To make the imported graph complete regardless of which column an edge
lives in, `mergeSuccessors()` (end of `parseWorkbook`) folds each row's Successors into
the target activity's predecessors — a successor edge `A→B` is identical to `B` listing
`A` as a predecessor. Merge is de-duplicated by Activity ID (`predIds`), so symmetric
exports add 0 duplicates. Verified on the Avesta 4PH file (4,578 activities): both
columns fully symmetric → 6,841 edges, 0 extra. No schema change (uses existing
`predecessors` column). OPC exports here use plain comma-separated IDs (no FS/lag);
`predRels` defaults those to `FS+0`.

## Schema additions (2026-07-06) — Working calendars
Run `../../migrations/2026-07-06-working-calendars.sql` (adds `project_schedule.calendar_id`
+ the new `calendars` table, owned by resource-loading). The Activity modal's
Calendar field is now a dropdown into `calendars` instead of free text. The
FTE/Max-Availability histogram (`resCapacity`, Resource Usage tab) was rewritten
to use each resource's *actual assigned calendar* (working-day pattern + hours/day,
via the shared `assets/js/calendar.js` `PDCal` helper — 6-day/8h Philippine
Standard by default, PH regular holidays computed automatically) instead of a
hardcoded 5-day Mon–Fri week. See `modules/resource-loading/CLAUDE.md` for the
calendar CRUD UI.

## Module design

**Three-tab layout (Primavera Cloud reference):**

- **Schedule tab** — WBS, Activity ID, Activity Name, Type, Status, Planned Start/Finish,
  Actual Start/Finish, Duration, % Complete (progress bar), Responsible Party, Edit/Delete
- **Gantt tab** — Oracle Primavera-style: frozen Activities column (Activity ID + name,
  WBS-indented) on the left + time-scaled bar chart on the right. Planned bars with a
  progress fill (% complete), green Actual bars (actual_start→actual_finish||today),
  milestone diamonds, WBS-summary brackets, month/year timescale, **Week/Month/Quarter
  zoom**, month gridlines, and a red **Data date** (today) line. Pure HTML/CSS — no libs.
  Respects the same Status/Type/Search filters. `renderGantt()` in the IIFE; `pdate/dDiff/iso`
  date helpers; `ganttZoom` + `PX_PER_DAY` control scale.
  - **Baseline (BL0) bar** (`.ps-bl`): drawn under each activity bar from `bl_start`/`bl_finish`.
    Restyled 2026-07-06 for visibility — was a 5px hollow light-gray (`#9a9a9a`) outline that was
    effectively invisible; now an **8px solid blue bar** (`--ps-bl` `#2F6FB0` light / `#5AA0E6` dark)
    with a subtle border + shadow. Legend swatch (`.lg-bl`) and the Gantt color-picker default
    (`COLORDEFS` `bl` = `#2F6FB0`) updated to match. Blue was chosen to stay clear of the red
    progress fill / amber critical-path outline.
  - **Relationship (FS/SS/FF/SF) lines**: drawn in `renderWindow()` as an absolutely-positioned
    SVG overlay (`.ps-deps`, arrow marker `#ps-arrow`) from each visible task's `_relObjs`. Anchored
    on the correct bar edges per type (SS/SF leave the start edge, FF/SF arrive at the finish edge),
    with an origin dot + a type/lag label (non-FS). Only edges whose BOTH endpoints are in the
    rendered window draw (same as critical-path lines). **Toggle:** the toolbar **`#ps-deps`** button
    (arrow icon, next to Critical Path) controls visibility via `depsOn` (persisted in
    `localStorage.ps_deps`, **default ON**). The draw block runs when `critMode || depsOn`, so
    imported dependencies now show WITHOUT turning on Critical Path (previously they were gated behind
    `critMode` only — the reason imported FS/SS/FF/SF links didn't appear on the Gantt).
- **Cost Loading tab** — WBS, Activity Name, Planned Cost, Actual Cost, Earned Value,
  Cost Variance, CPI, % Complete — with TOTALS row

**KPI cards:** Overall % Complete, Completed count, In Progress count,
Planned Cost / Actual Cost, CPI (green/red), SPI (green/red)

**Filters:** Status, Activity Type, text search across WBS / ID / Name / Responsible Party

**Modal fields:** WBS Code, Activity ID, Activity Name, Activity Type, Status,
Planned Start, Planned Finish, Actual Start, Actual Finish, % Complete,
Responsible Party, Planned Cost, Actual Cost, Earned Value, Predecessors, Remarks

**Predecessors activity picker (2026-07-06):** below the free-text `#ps-f-pred` field, a picker
row (`#ps-pred-search` datalist of `ID — Name` for all leaf activities, `#ps-pred-type` FS/SS/FF/SF,
`#ps-pred-lag` days, `#ps-pred-add`) lets the user **select an activity from the schedule** instead
of typing the Activity ID. `setupPredPicker(row)` (called from `openForm`) rebuilds the datalist
(excludes the current activity + WBS summaries, sorted numeric by ID), and Add appends a
`predRels`-parseable token (`ID [type][±lag]`, FS omitted unless a lag is set) to `#ps-f-pred`,
de-duplicated by ID (via `predIds`), rejecting self-links and unknown IDs. The text field is kept
as the source of truth (typing + CSV/XER import unchanged); the picker only appends to it.

---

## Activity Progress — view transition + configurable chart builder (2026-07-21)

**Transition:** switching into/out of the Activity Progress view now fades/slides in
(`@keyframes ps-viewin`, `.ps-anim` on `.ps-progress`/`.ps-split`/`.ps-network`).
`_animIn(el)` reflow-restarts the animation; `setProgressMode(on)` triggers it on toggle.

**Chart builder** (replaces the fixed pie). The presentation toggle is now **Table / Chart**.
In Chart mode a control bar exposes:
- **Chart type** (`#ps-chart-type`): Pie, Pie (hollow core / donut), Column, Horizontal bar,
  Stacked column, Stacked bar. Types listed in `CHART_TYPES`.
- **X-axis category** (`#ps-chart-cat`): Activity / WBS / Status (`CHART_CATS`).
- **Y-axis series** (`[data-series]` checkboxes): any of Activity % Complete (`phys`),
  Planned Value % (`plan`), Duration % Complete (`durpct`) — multiple = planned-vs-actual
  comparison. Defined in `CHART_METRICS` (label + color + `val(row)`).

Config persisted per project in `localStorage ps_chartcfg = { <pid>: {type,cat,series[]} }`
via `chartCfg()`/`setChartCfg(patch)`. Activity data-selection checklist (`.ps-pie-chk`,
All/Clear) still filters which leaf activities feed the chart (reuses `progSelSet`/`setProgSel`).

**Multiple independent resizable charts (2026-07-21b):** the Chart mode is now a **workspace**
(`.ps-chart-ws`, large wrapping grid) holding any number of chart **cards**, each fully independent.
Storage moved to `localStorage ps_charts = { <pid>: [ {id,type,cat,series[],sel,w,h}, … ] }`
(`chartsList()`/`setCharts()`/`chartById()`/`updateChart(id,patch)`/`addChart()`/`removeChart(id)`;
legacy `ps_chartcfg` auto-migrated to the first card). Top bar = Table/Charts toggle + **+ Add chart**.
Each card (`_chartCard(cfg)`) has its own toolbar: type select, X-axis (By Activity/WBS/Status),
Y-series swatches, a **Data ▾** toggle opening a per-card activity checklist (`_chartDataPanel`,
`.ps-cchk`, All/Clear — `sel` array per card, null = all), and a **✕** delete. Bottom-right
**resize handle** (`.ps-chart-res`) drag-sets the card width + body height (persisted live). SVGs use
`preserveAspectRatio` + `.ps-chart-svg{width/height:100%}` so they scale to the card. Edits redraw
only the affected card in place (`_redrawCard`/`_wireChartCard`, Data-panel open state kept in
`_openData`) — no full-view rerender, so resizing/tweaking one chart never disturbs the others.
`_chartBuckets(cfg)` now filters by the card's own `cfg.sel` instead of the shared selection.

Rendering: `_chartBuckets(cfg)` groups selected leaf activities by category and means each metric;
`_pieSVG(buckets,metric,hollow)` (donut = center hole), `_barsSVG(buckets,cfg,horizontal,stacked)`
(grouped or stacked, 0–100 grid, rotated category labels). Pie/donut use the first series only
(note shown when >1 selected). `renderProgressChart()` dispatches by type; `wireProgCtrls` handles
the type/category selects + series checkboxes (keeps ≥1 series). Back-compat: old stored
`ps_progpres='pie'` maps to `'chart'`.

**Chart cards — data labels, moving, dark-mode text (2026-07-21c):**
- **Pie/donut data labels:** each pie card gets a **labels** select (No labels / % of total /
  Value % / Category / Category + %), stored per chart as `labels`. `_pieLabel(mode,d,frac)` +
  `_pieSVG(…,labelMode)` draw label text at the slice centroid (only for slices > 4%);
  `.ps-pie-dl` = white glyph + dark outline (`paint-order:stroke`) so it reads on any slice
  colour in either theme.
- **Move the whole box:** a grip handle (`.ps-chart-grip`) makes the card `draggable`;
  HTML5 drag-and-drop reorders cards in the workspace via `moveChart(id,toIdx)` + `_dragCard`
  (`.ps-card-drag`/`.ps-card-over` visuals).
- **Move the chart inside the box:** dragging inside `.ps-chart-body` pans the `.ps-chart-pan`
  wrapper (persisted `ox`/`oy`); double-click recenters. Cursor grab/grabbing.
- **Dark-mode text fix:** SVG axis/label text used the **undefined** `--pd-ink-soft` var (fell back
  to black → invisible on dark). Switched all SVG text fills to `var(--pd-muted)`; legend/notes
  already inherit `--pd-ink`. (`--pd-ink-soft` does not exist in dashboard.css — only
  `--pd-ink/-muted/-line/-bg/-card` remap under `html.pd-dark`.)
- Resize (bottom-right `.ps-chart-res`) unchanged and still per-card/persisted.

**Chart cards — Excel-like formatting (2026-07-21d):** each card gained a **⚙ options** panel
(toggle `.ps-chart-settog`, open-state in `_openSet`, `_chartSettingsPanel`) exposing:
- **Chart title** (`title`) — rendered centered above the plot at `titleSize` px.
- **Axis titles** — `xTitle` / `yTitle` drawn on the bar/column axes (rotated Y); margins grow
  to fit them.
- **Font sizes** — `titleSize` (chart title), `tickFont` (axis tick labels), `titleFont`
  (axis titles), `dlFont` (pie data labels); all resizable 6–48 px.
- **Element toggles** — `legend` (pie inline legend / bar series legend `_seriesLegend`) and
  `grid` (bar/column gridlines) hide/show.
- **Series colours** — colour pickers for Actual / Planned / Duration write **project-scoped**
  `ps_seriescolor` (`seriesColor`/`setSeriesColor`) shared by the charts AND the Activity
  Progress **table bars** (`_progBar` now inlines them) — per the request, recolouring is
  limited to those two features. `chartColor(cfg,m)` allows a per-chart override (`cfg.colors`)
  over the project colour; the toolbar swatches + bar fills use it. Changing a colour
  re-renders the whole workspace (panels reopen from `_openData`/`_openSet`).
- `_barsSVG` rewritten around margins (mL/mR/mT/mB) so axis titles/fonts/gridline toggles all
  compose; `_pieSVG(buckets,cfg)` now reads legend + dlFont from cfg.

**Chart cards — activity label field (2026-07-21e):** each chart's ⚙ options panel gained an
**Activity label** select (`catField`: `both` / `id` / `name`) controlling how activities are
labelled everywhere the chart shows them — axis category labels, pie/donut slice legend, and
data labels. Default `both` = "ID  Name"; `id` = Activity ID only; `name` = Activity name only
(each falls back to the other when its field is blank). Applied in `_chartBuckets` for the
Activity X-axis; wired via the generic `.ps-cset-f` handler. Persisted per chart in `ps_charts`.

## Merge to main + verification (2026-07-22)

Merged branch `module/project-schedule` (commit a1292e1, "Excel-like configurable
chart builder in Activity Progress") into `main` via a no-ff merge commit (7b9fc4e).
Branch was 74 commits behind main and both `index.html` and this `CLAUDE.md` had also
been heavily edited on main since the merge base, but git auto-merged with **no
conflicts**.

**Verification:** served locally (python http.server) and loaded the module in-browser —
scripts executed cleanly and performed the Supabase auth redirect with **zero console
errors**. Static checks: no conflict markers; inline JS (~668K chars) passes
`node --check`; both the new chart-builder code and main-branch code present. Logged-in
visual render not verified (auth wall / no credentials) — recommend a manual eyeball of
Activity Progress once signed in.

## Arrow-key row selection with Excel-like autoscroll (2026-07-22) — fmlozano

The grid had click / shift-click / ctrl-click row selection but no keyboard navigation. Added
Excel-style arrow-key row selection to the Schedule grid:
- **↑ / ↓** move the active row selection to the previous / next visible display-list (`DL`) row;
  **PageUp / PageDown** jump one viewport of rows (`_gridPageRows()` = floor(viewport/ROWH)−1);
  **Home / End** jump to the first / last row. **Shift** + any of these extends the multi-row
  selection from the anchor (reuses `_selRange`/`_selSet`/`_selAnchor`).
- `moveRowSel(delta, extend, absolute)` computes the target index in `DL`, **skips id-less group
  headers** in the direction of travel, sets `selId` + `_selSet`, then autoscrolls and re-highlights
  + `renderDetails()`.
- **`scrollRowVisible(idx)`** is the Excel-like minimal autoscroll: pins the row to the **top** edge
  when it moved above the viewport, to the **bottom** edge when below — unlike `scrollSelIntoView`
  which re-centers. Works with the virtualized grid (setting `scrollTop` fires the scroll listener →
  rAF → `renderWindow`, which repaints the window and re-runs `highlightRow`).
- Wired into the existing grid keydown handler (same guards: suppressed while editing a field, over a
  modal, when the Schedule view is hidden, or view-only/archived). Documented in the ？ shortcuts modal.
- Verified: inline JS passes `node --check`; module loads in-browser with no console errors. Live
  keyboard interaction needs a login (auth wall). Module-only, no migration, no `?v=` bump.

## Horizontal active-cell navigation — arrows / Tab / Enter (2026-07-22b) — fmlozano

Extended the arrow-key work above into a full Excel-style active-cell cursor on the Schedule grid:
- **← / →** move the active cell one column left / right (clamped to the visible columns).
- **Tab / Shift+Tab** move to the next / previous cell, **wrapping to the next / previous row** at the
  row ends (`_nextRowIdx` skips id-less group headers; the row selection + details panel sync when a
  wrap changes rows).
- **Shift+← / →** extend the cell rectangle from the anchor (`_cellSel`), complementing the existing
  Shift+click range and Shift+↑/↓ row-extend.
- **Enter / F2** begin inline editing of the active cell (`editActiveCell` → `beginEdit`, only for
  `.ps-editable` columns).
- **↑ / ↓** now also **preserve the active-cell column** (Excel column-persistence) and paint the
  active cell, so vertical + horizontal navigation share one cursor.
- `moveCell(dc, tab, extend)` seeds the cursor from `selId` (or the first real row) on first press;
  `scrollCellVisible(r,c)` is the horizontal autoscroll (reveals the target column via the rendered
  cells offsetLeft/offsetWidth; frozen sticky columns are always visible so only non-sticky cells
  scroll). Deferred one rAF so a Tab-wrapped row is painted before the cell is scrolled/highlighted.
- Wired into the grid keydown handler (same guards); shortcuts modal updated.
- Verified: inline JS passes `node --check`; module loads with no console errors. Live keyboard test
  needs a login. Module-only, no migration, no `?v=` bump.

## Enter/Tab commit-and-advance in the inline cell editor (2026-07-22c) — fmlozano

Excel-style commit navigation from within an active inline cell edit (`beginEdit`):
- **Enter** commits the edit and moves the active cell **down one row** (Shift+Enter up), keeping
  the column — via `moveRowSel(±1, false)`, which preserves the `_cellAnchor` column.
- **Tab** commits and moves to the **next cell** (Shift+Tab previous), wrapping across rows — via
  `moveCell(±1, true, false)`.
- **Escape** still cancels without advancing.
- The move runs right after `inp.blur()` triggers `commit()`. `commit()`s DB write is async, so
  `selId`/`_cellAnchor` advance immediately and the later re-render (`persist().then` → `renderGrid`
  → `renderWindow`/`highlightRow`) re-highlights by id — correct even if a date/cost edit reorders
  rows. Advance lands in ready (not editing) mode, matching Excel.
- Shortcuts modal updated (Editing section). Verified: inline JS passes `node --check`, module loads
  with no console errors. Live keyboard test needs a login. Module-only, no migration, no `?v=` bump.

## Excel type-down-a-column entry anchor + type-to-edit (2026-07-22d) — fmlozano

Completes the Excel data-entry flow on the Schedule grid with an **entry-column anchor** (`_entryCol`):
- Editing a cell anchors the column the current row-entry began in. **Tab** walks across columns
  keeping the anchor; **Enter** commits, drops to the next row, and **returns to the anchor column**
  (classic Excel type-a-row-then-Enter-back-to-start). Enter with no Tab just goes straight down the
  same column. Shift+Enter goes up.
- **Type-to-edit:** pressing a printable key on a ready (selected, not-editing) editable cell now
  **begins editing seeded with that character** (text cells and numeric-compatible chars on number
  cells; date cells just open) — so you can keep typing down/across without F2 each time.
- **Ready-mode Enter** now moves down (at the entry column) instead of opening the editor; **F2**
  (or double-click, or typing) opens the editor — matching Excel.
- The anchor is **reset** by any non-entry navigation (arrows, PageUp/Down, Home/End, mouse click via
  `_setCellFromClick`, Escape) so the next fresh edit re-anchors; Tab/Enter preserve it.
- Implementation: `_entryCol`/`_resetEntry()`; `beginEdit` sets `_entryCol` when null; the in-edit
  Enter and ready-mode Enter set `_cellAnchor.c = _entryCol` before `moveRowSel`; type-to-edit lives
  in the grid keydown handler after the `?` branch (so `?` still opens shortcuts).
- ⚠️ **Known minor race:** type-to-edit opens the editor on the current DOM; a still-in-flight prior
  `persist().then → renderGrid` could repaint and drop that just-opened input if the next keystroke
  lands before the async write returns. Pre-existing for any fast edit-then-edit; acceptable for
  normal-paced entry. A render guard (skip re-render while an input is open) is the follow-up if it bites.
- Shortcuts modal updated. Verified: inline JS passes `node --check`, module loads with no console
  errors. Live keyboard test needs a login. Module-only, no migration, no `?v=` bump.

## Render guard: defer repaints while an inline editor is open (2026-07-22e) — fmlozano

Fixes the documented type-to-edit keystroke race from 22d. A still-in-flight `persist().then →
renderGrid` (or any scheduled repaint) could replace `#ps-grid-rows` innerHTML and destroy a
freshly opened inline `<input>`, dropping a keystroke during fast type-down entry.
- New **`_editing`** flag: set true in `beginEdit` right after the input is appended, cleared at the
  **top of `commit()`** (so it is false the instant the editor starts closing).
- **`doRender()` and `renderWindow()`** both early-return while `_editing`, setting **`_pendingWin`**
  instead of repainting — so neither the grid rows nor the Gantt bars layer (`#ps-tl-bars`, cleared in
  doRender) get wiped under an open editor.
- The closing editor **flushes** the deferred paint: `commit()` clears `_editing` then, if
  `_pendingWin`, calls `scheduleRender()`. Guaranteed even on a failed save (whose branch skips its
  own `renderGrid`). `_rafP` dedups the flush against the branchs own render within a frame.
- Correct because the edited value is read synchronously in `commit` before any repaint; the flush
  repaint (and the branchs own `.then` render) run after, on fresh `rows`. Arrow/click nav cant
  reach here — the global keydown returns early while focus is in the input, so the editor only closes
  via blur/Enter/Tab/Escape, all of which run `commit`. No stuck-`_editing` path.
- Verified: inline JS passes `node --check`, module loads with no console errors. Live keyboard test
  needs a login. Module-only, no migration, no `?v=` bump.

## LIVE verification of the keyboard navigation — found + fixed a hidden-column bug (2026-07-22f) — fmlozano

First signed-in run of the 22a–22e keyboard work, driven in the owners logged-in Chrome against the
deployed site on the real **4PH Jab Greenwoods Dasmariñas** project (17,122 activities).
- **Verified working live** with real key events (DOM-inspected after each): active cell set by click
  (row 2 / col 0 / "A227380"); **↓×3** moved rows 2→5 with the **column held at 0** (column
  persistence) and the row selection following; **→×3** moved col 0→3 with the row unchanged;
  **Tab×6** moved col 3→9. Deployed build confirmed to contain every new symbol.
- **BUG FOUND (now fixed): navigation stepped into HIDDEN columns.** That project hides 6 of its 19
  grid columns (indices 11–16 → `display:none`, width 0 — the cost/IBB block). `moveCell` walked raw
  column indices, so ←/→/Tab marched the cursor through zero-width invisible cells: measured the
  active cell at `offsetLeft 0 / width 0 / text ""` after Tabbing past column 10. The user would press
  → and watch the active-cell box vanish for six presses.
  **Fix:** `_colShown(ci)` (reads the same `colHidden`/`colKey` source of truth as the Columns chooser
  and `applyColHidden`s nth-child rules) + `_nextVisCol`/`_firstVisCol`/`_lastVisCol`; `moveCell`
  now steps to the next VISIBLE column (Tab wrap uses first/last visible; arrows stay put when there
  is no further visible column), and `moveRowSel` snaps to the first visible column if the preserved
  one is hidden. Shipped + deployed.
- ⚠️ **Environment blocker for the rest.** Chrome sits BEHIND the Claude app, so the tab is
  `visibilityState:"hidden"` → **rAF never fires** (measured: no callback in 1.2s) and the renderer is
  throttled hard enough that `Page.captureScreenshot` times out. Since `scheduleRender`/`doRender` and
  `scrollCellVisible` are rAF-gated, a reload in that state paints **0 rows** (the `_rafP` latch is set
  by a render that can never run). Same caveat already documented for the WBS virtualization work.
  Swapping `window.requestAnimationFrame` for a `setTimeout` shim revives the paths, but only if
  installed BEFORE module init — not achievable post-navigation.
- **Still unverified live, needs Chrome focused + a scratch project** (must not write to a real
  17k-activity schedule): horizontal autoscroll (`scrollCellVisible`), Enter/Tab commit-and-advance,
  the `_entryCol` type-down anchor, type-to-edit, and the `_editing` render guard.

## Signed-in verification on XERTEST — 3 bugs found + fixed, all behaviours confirmed (2026-07-22g) — fmlozano

Full keyboard/entry verification driven in the owners logged-in Chrome against the deployed site,
on the **XERTEST** sandbox (the safe venue — the earlier pass deliberately refused to write to the
real 17k-activity project).

**Bugs found by this pass, each fixed + redeployed + re-verified:**
1. **Navigation stepped into HIDDEN columns** (`4f8661c`). XERTEST/4PH hide 6 of 19 columns
   (`display:none`, width 0). `moveCell` walked raw indices, so →/Tab parked the cursor on invisible
   cells (measured `offsetLeft 0 / width 0 / text ""`). Fixed with `_colShown`/`_nextVisCol`/
   `_firstVisCol`/`_lastVisCol` off the same `colHidden` source of truth as the Columns chooser.
   **Re-verified: col 10 → 17, skipping 11–16.**
2. **In-edit Enter/Tab moved TWICE** (`11e6551`). `inp.blur()` switches `document.activeElement` to
   `<body>` synchronously, so the keystroke kept bubbling to the document-level grid handler whose
   "focus is in an INPUT → bail" guard no longer matched — the move ran twice (**Enter skipped 2 rows
   (4→6), Tab skipped 2 columns (1→4)**). Fixed with `e.stopPropagation()` on the editors
   Enter/Tab/Escape. **Re-verified: Enter 4→5, Tab×2 = col 1→3.**
3. **Closing editor left an orphaned `<input>`** (`86d2ea1`). `commit()`s per-branch renders are
   conditional (`if (ok) renderGrid()`), so a no-op/failed persist skipped the repaint and left the
   input sitting in the cell with blank text — newly visible now that Tab/Enter navigate away from it.
   `commit()` now always `scheduleRender()`s. (Pre-existing; only surfaced by the new navigation.)

**Verified PASSING live:** click sets active cell · ↓×3 rows advance with the column held · →×3 ·
Tab×6 · **hidden-column skip** · **horizontal autoscroll** (`scrollLeft` 0→504) · **render guard**
(input survived 6 forced repaint cycles as the SAME DOM node with its uncommitted value intact) ·
**Escape cancels with no write** · **entry-column anchor** (Enter from col 3 returned to col 1 on the
next row) · **single-step Enter/Tab** · **type-to-edit** (typing `z` opened an editor seeded with `z`,
focus in the input).

**Data integrity confirmed by direct Supabase query** (not just the DOM): `project_schedule` in
XERTEST has **0 rows named `z`**, and the row whose editor was Tab/Enter-committed still holds its
original `activity_name` ("Start of Precast Production") — the commits wrote the unchanged value back,
nothing was corrupted. No writes at all reached the real 4PH project.

⚠️ **Environment notes for the next person automating this.** Chrome sits behind the Claude app, so the
tab is `visibilityState:"hidden"` → **native rAF never fires** and `Page.captureScreenshot` times out.
Workaround: overwrite `window.requestAnimationFrame` with a `setTimeout` shim (the module reads it at
call time via `(window.requestAnimationFrame || fallback)(fn)`, so a post-load swap works). ⚠️ But if
any `scheduleRender()` latched `_rafP = true` under the NATIVE rAF before the shim, that latch never
clears and every later `scheduleRender` no-ops — the grid then paints 0 rows and commits appear not to
repaint. The scroll path (`onVScroll`, own `winRaf` guard) still repaints and can be nudged with a
synthetic `scroll` event. Both are automation artifacts, NOT product defects.

## Phone read-only activity list (2026-07-23)

Below **700px** the grid+Gantt split is hidden outright (`.ps-split`, `.ps-divider`, `.ps-toolbar`,
`.ps-legend`, `#ps-details` all `display:none`) and replaced by **`#ps-mobile`** — a condensed
**read-only** activity list painted by `renderMobile()`. Rationale: this module is an 18-column
virtualized grid beside a time-scaled Gantt with Excel-style keyboard navigation and drag-to-link;
none of that survives a 375px touch screen, and the owner chose a read-only field view over
pan-and-zoom.

- **Same data path, different presentation.** `renderMobile()` reads `displayList()`, so the active
  search / filters / grouping / collapse state all carry over. It renders only `_dkind === 'task'`
  nodes (WBS summary rows are skipped) as cards: Activity ID, status pill (derived the same way as
  the grid — `isComplete()` → Completed, `actual_start` → In Progress, else Not Started), name,
  Start / Finish / % Complete / Float, and a progress bar. Critical-path activities get a red left rail.
- **Deliberately read-only** — no edit, drag, link or keyboard handlers are wired to these cards.
- ⚠️ **`PS_M_CAP = 300` is a real guard, not a nicety.** This list is **not virtualized** (the desktop
  grid is), and projects here reach 17k+ activities — painting every card would lock up a phone. Over
  the cap it renders the first 300 and tells the user to narrow with search/filters. Only raise it
  together with virtualization.
- `renderAll()` calls `renderMobile()` only when already at phone width; a debounced `resize`
  listener repaints on the way in, so rotating from desktop into phone can't reveal an empty pane.
- **Verified** at 375px against the module's real stylesheet: cards 351px wide with no page-level
  horizontal scroll, 4-column meta grid with no cell overflow, correct status colours
  (muted/amber/green), red rail on critical-path only, progress fill exact (45% → 0.45), toolbar
  hidden. At 1280px **desktop is unchanged** — mobile list `display:none`, split `flex`
  (grid 660px + Gantt 588px), divider and toolbar visible.
- ⚠️ **Verification gap, stated plainly:** `renderMobile()` was **not** exercised end-to-end against
  loaded rows. The harness stubs could not satisfy this module's `load()` path (RPC → keyset
  fallback), so it rendered its genuine empty state and the card branch was verified by injecting
  `renderMobile()`'s exact template against the real CSS. The data binding itself rests on
  `node --check` plus confirming every helper it calls (`esc`, `dispStart`, `dispFin`, `isComplete`,
  `displayList`, `Fmt.date`) exists. **Worth a signed-in pass on a real project.**

### 2026-07-23 — Schedule Builder view (bottom-up / location-based setup)
- Added a **Schedule Builder** view to the title-switcher (between Project Schedule and Cost/EVM):
  a 5-step wizard implementing the planning team's whiteboard flow (steps 1–7). Steps: **Activities**
  (class-code list — code/name/group ST·AR·OTHER/required duration, drag to reorder = trade sequence)
  → **Floors & Zones** (Location Breakdown) → **Zone sequence** (drag; default floor×zone) →
  **Scope per zone** (location×activity checkbox matrix, stored inverted as `scopeOff`) →
  **Generate** (sequential FS chain through locations from a start date → KPIs, duration-per-zone
  bars, grouped preview, CSV export; "Push to Project Schedule" is a stub for the next milestone).
- Code: a self-contained `ScheduleBuilder` closure with its OWN helpers (`e2`/`pdd`/`iso2`/`render`/
  `load`/`save`/`generate`…) so nothing collides with the module's same-named functions. Reads the
  module's live `pid`/`UID`. Wired via `switchTab('builder')` (view `#ps-view-builder`, rail
  `#ps-bld-rail`, panel `#ps-bld-panel`) + a `renderAll` hook so switching project while on the tab
  reloads it. `.sbld-*` CSS added to the module `<style>`.
- Storage: one jsonb `config` per project in **`schedule_builder`** — migration
  `migrations/2026-07-23-schedule-builder.sql` (**USER MUST RUN**; project-scoped RLS, read
  `can_access_project` / write `is_writer()`+`can_access_project`). Save/load show a "run migration"
  toast until applied. Icons: drag grip is the text glyph ⠇ (no `menu` in icons.js); Save uses `check`.
- **Standalone `modules/schedule-builder/` was removed** — this integrated view supersedes it.
- Verified: inline JS parses (`node --check`); loads with no console errors (auth gate blocks the
  click-through). Not yet exercised signed-in.

### 2026-07-23 — Schedule Builder: per-trade zoning + tower visual + Gantt link canvas
- **Trades expanded** to ST · AR · MEPF · Allied · Other (`GROUPS`/`GLABEL`/`GCOLOR`); step-1
  activity group select uses them.
- **Step 2 rebuilt — per-trade, per-floor zoning.** Trade chips select the trade being edited;
  per trade you add floors (drag to reorder) and set each floor's zone count (± stepper, zones
  auto-name Z1..Zn), or bulk "Quick: N floors × M zones". A **tower/high-rise SVG visual**
  (`towerSVG`) renders the selected trade's floors stacked (ground at bottom) with zone cells in
  the trade colour. Model: `config.zoning[trade].floors[].zones[]`.
- **Step 3 rebuilt — Gantt link canvas.** Every zone(-trade) is a bar (length = its trade's
  day-sum); drag the dot on a bar's right edge onto another bar to create a finish-to-start link
  (`addLink`, with cycle guard via `reaches`); click a connector to remove it. Bars slide to the
  longest-path earliest start (`computeStarts`). Auto-chain / Clear links buttons. Self-contained
  SVG + a single document-level mouseup (`upWired`) resolving the drop target by `elementFromPoint`.
- **Step 4 (scope)** now renders one matrix per trade (that trade's locations × its activities);
  `scopeOff` keyed by `locUid|activityId` where `locUid = trade/floorId/zoneId`.
- **Step 5 (generate)** iterates per-trade locations, offsets each by its link-derived start, and
  FS-chains that trade's activities within the location; per-zone bars coloured by trade.
- Config model changed (`zoning`+`links` replace flat `floors`/`zones`/`sequence`) — same
  `schedule_builder` table/jsonb; old flat configs are ignored by `normalize` (feature is new).
- Verified: inline JS parses (`node --check`); scheduling math (longest-path starts, total, cycle
  guard) unit-checked in Node; module loads with no console errors. Not yet exercised signed-in.

### 2026-07-24 — Schedule Builder step 3: Start/End milestones + auto-traced interphase logic
- **Start & End nodes** added to the link canvas: a green **START** milestone (top row) and a red
  **END** milestone (bottom row, at the project's longest-path end). START has a source handle;
  END is a terminal drop target. Both are valid link endpoints (markers, 0 duration — they bookend
  the network without affecting timing). `Auto-chain` now also links Start→first and last→End.
- **Auto-trace of construction logic.** New helpers `locKeyOf` (floor+zone), `tryLink` (dedupe +
  cycle-safe), `traceInterphase`, `autoTrace`. When you draw a link between two zones **at the same
  location** (same floor+zone across trades), the builder auto-chains the remaining trades there in
  order **ST → AR → MEPF → Allied → Other** — the structural→architectural→MEPF interphasing.
  A new **Auto-trace logic** button builds it for the whole building: interphase every location's
  trades, then bookend Start→sources and sinks→End. All additions are cycle-guarded via `reaches`.
- Verified: inline JS parses (`node --check`); loads with no console errors. Signed-in click-through
  (drag-to-link firing the interphase trace, Start/End rendering) still pending — auth-gated here.

### 2026-07-24 — Schedule Builder step 3 redesign: takt floor-lead logic + tower-connect UI
- **Zone-sequence logic is now takt/location-based.** `autoTrace` rebuilds the flow from rules:
  (1) each trade climbs its own floors zone-by-zone (vertical progression), (2) a following trade
  stays a configurable **floor lead** behind the previous one — e.g. "Structure leads by 4 floors
  before the next trade starts" (Architecture on the ground floor can't begin until Structure is
  4 floors up), (3) bookended by Start → sources and sinks → End. New `cfg.floorLead` (default 4),
  editable inline in step 3. Helpers `floorsOf`/`zoneByCode`/`uidFor`/`floorAxis`. First cross-trade
  transition uses the lead; later ones stay 1 floor behind. Unit-checked in Node: with ST dur 2/floor
  and lead 4, AR ground start = day 8 (= 4 structural floors) — correct staircase.
- **Linking UI rebuilt as a tower + schedule split.** LEFT: a tower (floors stacked, ground at
  bottom; union of floor codes) where every zone is a clickable **node** grouped by trade and
  coloured by trade. Click a source node then a target to connect them (finish-to-start, with the
  same-location interphase auto-trace + cycle guard); the pending source is outlined. RIGHT: the
  **resulting schedule** (`scheduleSVG`) — read-only takt bars from the links with Start/End +
  arrows; click an arrow to remove that link. Replaces the SVG drag-handle canvas (drag-to-link).
- Verified: inline JS parses (`node --check`); takt scheduling unit-checked; module loads with no
  console errors. Signed-in click-through still pending (auth-gated here).

### 2026-07-24 — Schedule Builder: "Push to Project Schedule" hand-off (add + choose WBS)
- Step 5's **Push to Project Schedule** now actually writes the generated activities into the live
  `project_schedule` — **adds** to the existing schedule (never replaces). A modal asks which **WBS**
  to file them under (dropdown of existing WBS-Summary rows, or "Top level"), plus a checkbox to
  **organise into Trade → Floor → Zone sub-WBS** (on by default; off = flat under the chosen WBS).
- New builder fns `nextChildIndex(base)` (next free dotted-code child under a parent), `openPushModal`,
  `pushToSchedule(parentCode, grouped)`: builds WBS-Summary + Task payloads (dates + baseline from the
  takt result, unique `activity_id`s vs existing rows, `created_by=UID`), chunked-inserts to `TABLE`,
  then `switchTab('schedule')` + module `load()` to repaint the Gantt.
- Enabler: the builder's internal `load` was renamed **`loadCfg`** so it no longer shadows the
  module's schedule `load()` (needed to reload after the insert). `open()` updated accordingly.
- Verified: inline JS parses (`node --check`); loads with no console errors. Signed-in click-through
  of the actual insert still pending (auth-gated here).

### 2026-07-24 — Schedule Builder step 3: typed/lagged links, unlink, multi-link, narrow tower, zoomable/editable schedule
- **Relationship type + lag.** Links now carry `type` (FS/SS/FF/SF) + `lag` (days). A dialog
  (`openLinkDialog`) asks both whenever you connect two nodes; `computeStarts` honours them via
  `linkStart()` (FS/SS/FF/SF math, negatives floored to 0). Arrows on the schedule show a
  `TYPE±lag` label and anchor from the correct edge (start for SS/SF, finish for FS/FF).
- **Unlink + edit.** Click any arrow (or re-click a linked pair) to open the dialog with an
  **Unlink** button and editable type/lag (`linkOf`/`removeLink`). Removed the old auto-interphase-
  on-manual-link (surprising now that linking is explicit); the bulk logic stays in **Auto-trace**.
- **Multiple linking.** The source node stays selected after a link so you can fan out to several
  targets; **Done linking** / clicking the source again releases it.
- **Narrower vertical tower.** Zone nodes are compact fixed-width squares and floors are tighter, so
  the left pane reads as a stacked tower; the split is now ~270px tower : expanded schedule.
- **Zoomable, editable schedule.** Right pane uses a `seqZoom` px/day scale with − / + buttons;
  schedule **bars are clickable** (act as link source/target too, so you can wire relationships from
  the Gantt), and arrows are clickable to edit/unlink.
- Verified: inline JS parses (`node --check`); FS/SS/FF/SF + lag math unit-checked; loads with no
  console errors. Signed-in click-through still pending (auth-gated here).

### 2026-07-24 — Schedule Builder step 3: draggable tower/schedule split + scaling nodes
- Step 3 is now a **draggable split** (`.sbld-seq2` flex + `.sbld-seq2-grip` col-resize divider,
  width in `seqLeftW`): drag to give more room to the tower or the schedule. Min 150px tower,
  schedule keeps ≥260px.
- Zone **nodes now flex** to fill their (resizable) trade cell (`flex:1 1 22px; min 20 / max 72px`),
  so they grow when the tower pane is widened and shrink when narrowed — no longer a fixed tiny size.
- Verified: inline JS parses; loads with no console errors.

### 2026-07-24 — Fix: "Gantt only" layout did nothing when clicked

Owner: the Gantt-only layout view isn't working when clicked. **Reproduced and root-caused, not guessed.**
- **Cause: an inline style silently beat the stylesheet.** Gantt-only narrows the activities grid purely
  via `.ps-split.ps-gantt-only .ps-grid-pane { flex:0 0 300px }`. But the divider drag handler — and the
  `ps_grid_w` width it restores on every load — writes **`gridPane.style.flexBasis` inline**, and an
  inline declaration outranks any normal stylesheet rule. So the class was applied, the CSS was correct,
  and nothing moved.
- **Measured, with the module's real stylesheet:** fresh browser (never dragged, empty localStorage)
  660px → **300px**, works; after a drag (inline basis set) 660px → **660px**, dead. That's why it would
  have looked fine on a clean profile — every real user who had ever touched the divider had it broken.
- **Fix:** the width is now applied **imperatively** in `_applyGridPaneWidth()`, called from
  `applyLayout()`, and only on the **mode transition** — so a divider drag *while in* Gantt-only isn't
  snapped back on the next render. Leaving Gantt-only restores the user's saved `ps_grid_w`, or clears
  the inline value so the 660px stylesheet default returns when there is none.
- ⚠️ **Second, load-order half of the bug:** the divider's saved-width restore block runs **after**
  `applyLayout()` during init, so it re-clobbered the 300px for anyone whose persisted `ps_layout` was
  already `gantt` — Gantt-only would have been broken on page load even with the fix above. That restore
  now skips while `layoutMode === 'gantt'`.
- ⚠️ **Why not `!important`:** it would also win against the inline style, but it would then block the
  divider drag in Gantt-only mode — and that pane is deliberately meant to stay resizable there (the
  whole point of the 2026-07-07 "Gantt-only keeps the columns" change).
- **Verified in-browser** by extracting the **shipped** `_applyGridPaneWidth` out of `index.html` and
  running it against the module's real CSS — 5/5: Gantt-only narrows to 300px with a dragged width
  present; returning to Split restores the user's 660px; Grid-only still hides the Gantt pane; a drag to
  420px inside Gantt-only survives a re-render; with no saved width, leaving Gantt-only falls back to the
  660px CSS default. Inline script parses; module loads with no console errors (auth-gated here, so no
  signed-in click-through). Module-local, no migration, no `?v=` bump.

## Signed-in verification of the phone view (2026-07-25)

Closed the verification gap left when the phone list shipped: `renderMobile()` had never run against
real loaded rows. Checked on the deployed site, signed in, against **GPR101** (4PH Jab Greenwoods,
17k+ activities) and **OPW101** (One Portwood, 862 rows / 698 leaf activities).

**Confirmed working.** `renderMobile()` renders real rows correctly: 112 cards on GPR101's default
(collapsed) outline with 0 blank IDs, 0 blank names and 0 missing dates; status derivation matched the
data (20 Completed / 39 In Progress / 53 Not Started); 38 critical-path cards carried the red rail;
progress bars matched `percent_complete`. **`PS_M_CAP` verified live on OPW101** — expanding all gave
*"300 of 698 activities"*, exactly 300 cards, and the *"398 more activities not shown"* note.

**BUG FOUND AND FIXED — date overflow.** The real `Fmt.date` renders **"Feb 15, 2027"**, which measures
**80px** at the card's 12.5px meta font, but a meta column is only **~77px on a 375px phone** — it
overflowed. It fit at 390px by a single pixel, which is why nothing looked wrong at first glance. The
local harness had stubbed `Fmt.date` with a short form, so **this was invisible to harness testing and
could only surface against real data.** Fixed by using this module's own `fmtOPCDate` (DD-Mon-YY, 65px),
plus a 2×2 meta fallback below 380px. Re-verified live: max date width now 66px vs 77px available.

⚠️ **PERFORMANCE FINDING — not fixed, needs a decision.** The phone view hides the desktop UI with CSS
but **does not stop it being built**: `renderAll()` still runs `renderGrid()`, `renderGantt()`,
`renderCost()` and `renderDetails()` at phone width, and then `renderMobile()` on top — so a phone pays
for the desktop pipeline *plus* the card list. Measured on OPW101 (698 activities, desktop CPU):
`renderMobile()` alone is **~865ms median** (3 runs: 172 / 865 / 868), isolated by confirming a resize
with phone mode off leaves `#ps-mobile` untouched. On GPR101, clicking **Expand all** (17k activities)
**froze the renderer** — that test drove the desktop grid+Gantt rebuild simultaneously so the freeze is
not attributable to `renderMobile` alone, but it does show the combined cost is not phone-safe.
The cost is `displayList()`/`buildNodes()`, which sorts and filters every row — `PS_M_CAP` caps the
*cards painted*, not that traversal. **Recommended fix:** gate `renderGrid()`/`renderGantt()` on
`!psIsPhone()` inside `renderAll()` and repaint them when crossing back above 700px. Deliberately NOT
done here — `index.html` is under active concurrent development (the Schedule Builder view landed
mid-session) and restructuring `renderAll()` risks regressing the desktop path.

**Note on scope:** the phone block hides `.ps-toolbar`, which is a **shared** element sitting outside
`#ps-view-schedule` — so it is hidden for the Cost/EVM, Planner, WBS Manager and the new Schedule
Builder views too, not just the schedule. That is coherent with "read-only on a phone" (the toolbar is
all authoring controls), but it was not a considered decision for Builder, which arrived later.
`#ps-mobile` itself is correctly nested inside `#ps-view-schedule`, so it only appears on that view.

⚠️ **Method note:** the Chrome window could not be resized below ~1432px in this environment, so the
phone path was exercised by patching `window.matchMedia` (which `psIsPhone()` reads at call time) and
firing the module's own debounced resize handler. That verifies the **data binding and the cap against
live data**, which was the open gap; the **CSS presentation at a true 375px viewport** remains verified
only in the local harness.

## Render-pipeline fix for the phone view (2026-07-25)

Closed the performance finding from the signed-in check. The phone view hid the desktop UI in CSS but
still BUILT it: `renderAll()` ran `renderGrid`/`renderGantt`/`renderCost`/`renderDetails` at phone width
and then `renderMobile()` on top, so a phone paid for the full desktop pipeline plus the card list.
- **Fix (three coordinated changes):** `renderAll()` now returns after `renderMobile()` when
  `psIsPhone()`; `doRender()` (the single choke point every grid+Gantt build funnels through, also poked
  by scroll/edit/load-reconcile) bails to `renderMobile()` on phone as a safety net; and the debounced
  `resize` handler tracks `_psWasPhone` so crossing phone→desktop runs a full `renderAll()` to build the
  grid/Gantt that were skipped while phone.
- **Verified live, signed in** (deployed):
  - OPW101 (698 activities), phone mode, Expand-all: grid DOM stays unbuilt, list updates to "300 of 698",
    cap holds, no freeze.
  - **GPR101 (17,122 activities), phone mode, Expand-all: no freeze (~83ms to rAF), grid unbuilt, list
    "300 of 17122", cap holds.** This is the operation that appeared to freeze before.
  - Round-trip: desktop 380 grid cells → phone 112 cards → back to desktop **380 cells rebuilt**, split
    visible. Clean desktop reload renders normally (380 cells, 44 Gantt bars, real data). No console errors.

⚠️ **CORRECTION to the 2026-07-25 check entry above.** That entry said GPR101 Expand-all "froze the
renderer" and attributed it to the desktop render cost. **That was wrong.** Re-testing with the fix
deployed, the freeze reproduced *identically even with the grid build now skipped* — the actual cause is
the Expand-all handler's **blocking `window.confirm()`** (shown when `rows.length > 4000`): with no user
to dismiss it, the main thread blocks and CDP times out at 45s. It was never a render cost. The
`renderMobile`-alone ~865ms measurement on OPW101 stands (OPW is < 4000, no dialog), and the pipeline fix
is still a real improvement — a phone no longer builds the desktop grid at all — but the "17k froze the
renderer" claim was a mis-diagnosis of a modal dialog.

### 2026-07-24 — Schedule Builder step 2: optional Zone → Unit hierarchy (Trade → Floor → Zone? → Unit?)
- Recovered from a stray git stash-pop that left conflict markers on the stale `module/project-schedule`
  branch; re-applied this work cleanly on `main` (which already had the builder + typed links + resize).
- **Model:** each zone now has `units[]`. Leaves (`leavesOfFloor`/`locList`): a floor with no zones is a
  leaf; a zone with no units is a leaf; else each unit is a leaf. `locLabel` joins present codes;
  `cellKey`=zone#unit code for cross-trade matching; `floorIndexOf` for the takt index.
- **Step 2 editor** rebuilt as a nested per-floor card: floor code/name + **+ Zone**; each zone row has a
  **Units ± stepper** (0 = none) + delete; "Quick" now floors × zones × units. Tower visual nests
  floors → zones → units.
- **autoTrace** reworked to index leaves by (trade, floorIdx, cellKey) so the vertical climb + cross-trade
  floor-lead match by zone+unit. **Step 3 tower** nodes, **scope** matrix, and **Push-to-Schedule**
  grouping (Trade → Floor → Zone → Unit sub-WBS, each level optional) all leaf-aware.
- Verified: inline JS parses; leaves/cellKey unit-checked (2 floors × 1 zone × 2 units = 8 leaves,
  keys Z1#U1/Z1#U2); loads with no console errors. Change Order incorporation still pending (next).

### 2026-07-24 — Schedule Builder: bigger tower, centered steppers, relationships carried on push
- **Tower visual enlarged** (W 320→430, floor height 40→52, bigger fonts) and its column widened
  (minmax(400px,460px)); floor/zone/unit labels are more legible.
- **± steppers centered** (`display:inline-flex; align-items:center; justify-content:center`) and
  slightly larger; count font bumped.
- **Relationships carried into the pushed schedule.** `pushToSchedule` now assigns clean sequential
  activity ids (`SB1`, `SB2`… — dotted WBS codes would break the predecessor parser), chains each
  location's activities FS internally, and maps every zone→zone link (FS/SS/FF/SF + lag) onto the
  correct end-activities as `predecessors` tokens (e.g. `SB5+3`, `SB2 SS+2`, `SB9 FF-1`) — matching
  the module's `predRels` format. Start/End markers are skipped. So the generated CPM logic lands in
  the live schedule, not just the dates.
- Verified: inline JS parses; predecessor-token + leaves/cellKey logic unit-checked; loads with no
  console errors.

### 2026-07-24 — Data date badge restored, actual-duration fix, Activity-Progress collapse, per-project saved views
- **Data Date badge back in the header.** `renderDataDateBadge` targeted `#ps-datadate-badge`, but the
  element had been dropped from the topbar (only the CSS class remained) so it silently no-op'd. Re-added
  a clickable badge next to the tools cluster; clicking it opens the Schedule dialog to change the date.
- **Duration now updates on actualised finish.** The grid **Dur** column showed `_origDurOf` (planned/
  baseline span via `end_date`), so changing an actualised activity's finish never moved it. For a
  completed activity (has `actual_finish`) the Dur cell now shows the **actual span** (`actualDurLive` =
  actual finish − actual start + 1), read-only, updating live when the finish changes.
- **Activity Progress table: WBS collapsible** like the Gantt. Added ▼/► carets on WBS rows (toggle the
  shared `collapsed` map → `renderProgressView`) + **Expand/Collapse all** buttons in the table control bar.
  It already respected `hiddenRow`, so it inherits the schedule's default-collapsed depth too.
- **Saved layouts are now PER PROJECT and include the chart template.** `ps_views` re-keyed to
  `{ <pid>: { name: view } }` (`loadViews`/`saveViews`); a saved layout also captures the
  Activity-Progress **charts** (`chartsList()`) and `applyView` restores them (`setCharts`). Columns
  (hidden/order/widths/renames) + filters + grouping + zoom were already in a view. Tooltip updated.
- Verified: inline JS parses; module loads with no console errors. Change Order incorporation still pending.

### 2026-07-24 — Activity Progress chart: fix scroll reset when picking activities
- Ticking an activity in a chart card's Data checklist called `_redrawCard` (full card rebuild), so the
  checklist re-rendered and its scroll snapped to the top after every click. The `.ps-cchk` handler now
  updates only the chart body (`.ps-chart-pan` innerHTML = `_chartSVG(cfg)`) and the "Data (N)" count in
  place — the checklist DOM + scroll position are preserved, so you can tick multiple activities in a row.

### 2026-07-24 — Activity Progress chart: "Full labels" option (untruncated, scale with resize)
- Category/pie labels were truncated to ~14–16 chars with an ellipsis, so long activity/WBS names were
  cut off. Added a **Full labels** toggle to each chart's ⚙ settings (`cfg.fullLabels`). When on,
  `_pieLabel` and `_barsSVG` render the whole text; `_barsSVG` also reserves margin for it (horizontal:
  wider left margin `max(92, lblPx+10)`; column: extra bottom margin `lblPx*0.36`, `lblPx ≈ maxLabelLen
  × tickFont × 0.58, capped 280). Since chart SVGs scale to the card via viewBox, resizing the card
  bigger enlarges the full labels so the whole text is readable. Combine with the Data-label / Axis-label
  font-size controls already in the panel.

### 2026-07-24 — Planning logic: consistent duration recompute + contradiction errors on actual dates
- `_dateEditPatch` hardened so actualising / re-actualising dates keeps every duration field consistent
  and blocks contradictions with clear toasts:
  - **Actual Finish requires an Actual Start** ("an activity can't finish before it has started").
  - Actual Finish before Actual Start / after Data Date → error (kept, message improved).
  - **Actual Start can't be after an existing Actual Finish**, and you can't clear an Actual Start while
    an Actual Finish is set (reopen the finish first).
  - Re-actualising the finish recomputes Actual = finish−start+1, Remaining = 0, %=100, Completed;
    Planned + At-Completion are derived from these so they update on render. Clearing the finish reopens
    to In Progress, reseeds Remaining, and drops % below 100.
- Verified: inline JS parses; module loads with no console errors.

### 2026-07-24 — Schedule Builder: Internal vs External durations (per activity, generate both)
- Each activity now carries **two durations** — `durInt` (internal / target) and `durExt` (external /
  contract). Step 1's editor has Int./Ext. columns (legacy single `duration` auto-migrates into both).
- `nodeDays(loc, basis)` + `generate(basis)` take a basis (`'int'`|`'ext'`); `actDur(a, basis)` picks the
  field. Step 3's link canvas uses internal for its bar lengths (relationships are basis-independent).
- **Step 5 shows BOTH schedules side by side** (`_genPanel` × Internal/External): each with total
  duration, start, finish, duration-per-zone bars, and the grouped activity table — so you can compare
  the target vs contract finish dates. Separate CSV per basis.
- **Push** modal gained a "Schedule to push" select (Internal / External); `pushToSchedule(pc, grp, basis)`
  generates that basis before writing (relationships still carried).
- Verified: inline JS parses; module loads with no console errors.

### 2026-07-24 — WBS status pills, WBS selection highlight, dark-mode highlight, push relationships confirmed
- **WBS/summary rows now show a rolled-up status pill** (Completed / In Progress / Not Started). Counters
  (`done`/`prog`/`total`) added to the `_costMap` roll-up in `rebuild`; `_wbsStatusPill(code)` renders the
  pill in the WBS row's status cell (all done → Completed, any started/done → In Progress, else Not Started).
- **Clicking a WBS now highlights it.** Root cause: the WBS row's `--wl` shade on its frozen cells has
  higher CSS specificity than `.ps-row-sel`, so the selection tint was hidden. Added
  `.ps-grid-pane .ps-wbs-row.ps-row-sel > .c-num/.c-id/.c-name { background:var(--pd-red-light) }` (selId was
  already being set on WBS click).
- **Dark-mode highlight fixed.** `--pd-red-light` is a near-black maroon in dark mode, so the selection/
  spotlight barely read. Added `html.pd-dark` overrides using translucent red (`rgba(238,49,36,.22)`) for
  the selected row + frozen cells + Gantt sel-band, and a theme-neutral translucent blue
  (`rgba(37,99,235,.12)`) for `.ps-spotrow` (works in both light and dark).
- **Push relationships confirmed migrating.** `pushToSchedule` already maps each zone link (FS/SS/FF/SF +
  lag) onto the pushed activities' `predecessors` (SB-ids) and chains each location FS internally — verified
  the block is intact after the earlier git recovery. (Arrows show once Critical Path / relationship lines
  are toggled on.)
- Verified: inline JS parses; module loads with no console errors.

### 2026-07-24 — Schedule Builder: renamed trades + basements (substructure)
- **Trades** are now **Structural · Architectural · MEPF · Allied Services** (GLABEL/GROUPS updated;
  dropped the old 'Other'; ST/AR relabelled). Existing 'OTHER' zoning/activities normalise away
  (activities fall back to ST).
- **Basements / substructure.** Floors carry an optional `sub:true`. Step 2 gains a **+ Basement**
  button (inserts at index 0 = deepest, so takt builds bottom-up) and a **basements** field in Quick
  (`B bsmt + F flr × Z zn × U un`). Basement rows show a **BSMT** badge (dashed card, red header).
  The **tower** now splits at a **grade line**: superstructure above, basements below (dashed, lower
  opacity, labelled B1…deepest) with a "grade" marker.
- Verified: inline JS parses; module loads with no console errors. (Internal/External durations were
  already served — confirmed via curl; the "not reflected" was a stale browser cache → hard-refresh.)

### 2026-07-24 — Schedule Builder step 3 equal bars + step 1 row layout
- **Step 3 schedule bars are now equal-length, laid out by dependency rank** (`computeRanks` =
  topological depth) instead of day-length. Uniform 44px+ bars spaced by rank → always visible and
  easy to hit when connecting (previously 0-duration zones collapsed to tiny/overlapping bars). Zoom
  scales the bar width. Arrows/anchors unchanged.
- **Step 1 row rebalanced**: Activity Name shortened (`.sbld-actname`, flex 1 130 / max 220) and more
  room given to Trade (170px, now showing the full trade label) and Interior/Exterior durations (90px
  each). Header labels updated to Interior/Exterior.
- Verified: inline JS parses; module loads with no console errors.

### 2026-07-24 — Schedule Builder: activity template download/upload + robust step-3 nodes
- **Step 1 template import/export.** New **Download template** (CSV: Code, Activity Name, Trade,
  Interior Duration, Exterior Duration + examples) and **Upload CSV/Excel** buttons. `importActivities`
  maps columns case-insensitively, resolves the Trade by label or code (Structural/ST → ST, etc.),
  reads Interior→durInt / Exterior→durExt, and asks replace-vs-append when activities already exist.
  CSV parsed inline (`parseCsv`), .xlsx via the already-loaded SheetJS (`XLSX`).
- **Step 3 "no nodes" fixed.** The tower was a floor×trade MATRIX keyed off `floorAxis()` code-matching,
  which could render empty cells (no visible nodes). Rebuilt as **per-trade sections** — each trade
  heading → its floors (top first) → a row of zone/unit node buttons — so every location in `locList()`
  is guaranteed to appear as a clickable node. (Bars on the right remain the equal-length connect targets.)
- Verified: inline JS parses; module loads with no console errors.

### 2026-08-04 — Fix: Duplicate branch failed — fractional sort_order into an integer column
User report: "Duplicate failed: invalid input syntax for type integer: "3.001"" (and `"0.001"`).
- **Root cause:** `wbs_nodes.sort_order` is an **integer** column, but `wbsDuplicate` inserted its
  copies at `(n.sort_order||0) + c/1000` — a fractional "slot" meant to keep the copies immediately
  after the original until `_wbsNormalizeAndPersist` renumbered the sibling group. That trick only
  works **in memory** (which is why `outdent`'s `+0.5` is fine — it's overwritten with an integer
  before any write); on an INSERT the fraction reaches Postgres and is rejected outright. Nothing was
  created, hence "duplicate not working".
- **Same latent bug in `wbsQuickAdd`:** a mid-list insert (Enter after an existing sibling) wrote
  `(after.sort_order||0) + 0.5`, so it would fail identically — the docs' "mid-list insert via the
  0.5 slot" was never exercised against the real integer column.
- **Fix — make room with integers instead.** New `_wbsMakeRoom(parentId, after, count)`: renumbers the
  sibling group so everything after `after` is bumped by `count` (persisting only the diff, via
  `_batchUpdate`) and returns the first free integer slot. `wbsQuickAdd` takes one slot; `wbsDuplicate`
  reserves `count` and places copy *c* at `slot0 + (c-1)`. `_wbsNormalizeAndPersist` still runs after
  and compacts to 0..k-1.
- Verified in Node against the shipped logic: duplicating 3× after the first of three siblings gives
  order `a, a1, a2, a3, b, c` with **every** sort_order an integer (was `3.001`/`0.001`). Script
  parses. ⚠️ Not verified signed-in — needs a live Duplicate click. Module-local, no migration, no
  `?v=` bump.

### 2026-08-04 — Work Package is now a grouping dimension
`work_package` was a stored-only OPC parity field (form + General tab + row copy + Global Change);
nothing read it. It is now a real grouping level, so the grid can nest by deliverable/contract package.
- Three sites, matching how every other flat dimension is wired: `dimValOf` (`'wp'` → trimmed
  `work_package`, blank → `— No work package —`), `dimLabel` (`'Work Package'`), `allDims` (after
  `type`, so it appears in the picker's "Add a level" list). Nothing else needed — `buildNodes`,
  `normalizeGroupBys`, collapse, group bars and the per-project `ps_groupbys_<pid>` persistence are
  all dimension-agnostic.
- Composes with the existing levels, e.g. **Work Package › Location › Activity** or
  **Work Package › WBS** (wbs stays forced-last by `normalizeGroupBys`).
- Search now also matches `work_package`, consistent with work type + location values.
- ⚠️ **No grid column** — the value is only settable in the Add/Edit form (or in bulk via Actions ▸
  Global Change, which already lists Work Package). An inline-editable column would need a 4th
  `costCellsHtml` cell across all three row branches; deferred as it wasn't asked for.
- **Verified: 11/11 in Node against the shipped `dimValOf`/`dimLabel`/`allDims`/`normalizeGroupBys`**
  (extracted, not reimplemented) — value, trimming, all three blank forms bucketing together, `wp`
  accepted by the normalizer, `wbs` still forced last from either order, `wp` alone surviving, an
  unknown dim still dropped. Script parses; only those 3 sites enumerate dimensions, so nothing else
  needed updating. ⚠️ Not verified signed-in. Module-local, no migration, no `?v=` bump.

## WBS import: the last double-layer + the duplicate children the merge fix created (2026-08-08) — fmlozano
After another AVR101 reimport the user reported the main WBS still double-layered. Queried the live
tree (1,627 nodes): the previous merge fix **worked for Initiation / Planning / Execution Phase** but
left two real defects.
- ⚠️ **`Milestones > Project Milestones` still nested.** The merge test was exact name equality, but
  `_impGuessTarget` files that branch under Milestones via the **keyword hint** (`/milestone|key date/`),
  not by name — so `sameName` was false and it nested. New **`_wbsNameKey()`** normalises before
  comparing: case/punctuation folded, parentheticals dropped, a leading generic qualifier stripped
  (`the|project|overall|main|general|key`), trailing plural tolerated. Deliberately conservative —
  it does **not** fold distinct words, so `Tower 1 Execution Phase` still nests under `Execution
  Phase` rather than being merged away (asserted as a test case).
- ⚠️ **The merge fix itself created duplicate CHILDREN — my regression, found by querying the live
  tree rather than by re-reading the code.** Merging lifted the branch's children up as **new
  siblings** of the target's existing children, so Planning Phase ended up with three name-collided
  pairs — locked skeleton `Procurement` / `Design Development` / `Project Execution Plan` (0 grandkids
  each) sitting **beside** the file's unlocked ones (1 / 7 / 3 grandkids). `_wbsDedupeSkeleton()`
  cannot heal these: it only merges pairs where **both** nodes are `is_locked`.
  `_wbsSkeletonTargets()` now also returns each target's `childCode` (normalised child name → dotted
  code), and a moved child that matches an existing child is filed **into** it; only genuinely new
  children (e.g. `Preparation and Approval of BOQ`) take a fresh slot.
- ⚠️ **Why filing into the existing code is safe rather than a duplicate summary row:** `_clearWbsTree()`
  only drops unlocked nodes, so the locked skeleton child survives a replace-import. The file's row
  then lands on that node's code, `wbsAdopt` links **every** legacy row of that code to the existing
  node (`group.forEach`, no re-insert), and `_wbsEnsureSummaries()`'s duplicate-projection heal deletes
  the extra summary row on the next load. Self-healing, not an orphan.
- **Verified in Node against the SHIPPED `_wbsNameKey` + `applyWbsPlacement`** (sliced out, not
  reimplemented, with stubbed skeleton targets): 5/5 name-key cases incl. the two that must NOT fold,
  and a full placement run reproducing the live AVR101 shape — `Project Milestones` merges (child at
  `1.1`, no extra layer), `Procurement`→`3.3` and `Design Development`→`3.2` land on the **existing**
  children, and the new BOQ branch takes `3.4`. Inline script parses.
  ⚠️ **Not verified signed-in** — needs a hard refresh (`index.html` is not `?v=` cache-busted) and
  another Avesta reimport. ⚠️ The location + discipline wizards must be re-run after any reimport;
  a reimport wipes `work_type` and `location`.

## Import WBS-placement picker was missing Closeout Phase (2026-08-08) — fmlozano
Screenshot: AVR101's import placement dialog offered Milestones / Initiation / Planning / Execution
Phase but no Closeout Phase, even though the file carries 70 leaf activities under it and Closeout
Phase exists live as a top-level branch.
- ⚠️ **Root cause is the documented AVR101 quirk, now actually biting.** `_wbsSkeletonTargets()`
  only offers **locked** top-level nodes. Closeout Phase was added to `WBS_SKELETON` after AVR101 was
  already seeded, so on AVR101 it was never auto-seeded/locked — a previous reimport instead created
  it as an ordinary **unlocked** top-level branch ("its own top-level branch"). The locked-only filter
  silently drops it, so the picker can never route the file's own Closeout Phase branch there — every
  reimport re-creates it as a fresh unlocked top-level sibling instead of filing into the one that
  already exists, i.e. the exact duplicate-top-level symptom this whole placement feature exists to
  prevent, just for one branch the locked filter can't see.
- **Fix:** after the locked pass, also fold in any **unlocked** top-level node whose name matches (via
  the existing `_wbsNameKey()`) an entry in the `WBS_SKELETON` constant — i.e. a phase the constant
  knows about but this project's tree never got to lock. Deduplicated by name key so a project that
  *does* have a locked match isn't given a second target.
- Verified in Node against the shipped `_wbsSkeletonTargets`/`_wbsNameKey` (sliced, not reimplemented)
  with a fixture mirroring AVR101 exactly (4 locked + 1 unlocked Closeout Phase): all 5 phases now
  returned as targets. Inline script parses. ⚠️ Not verified signed-in — hard-refresh then reimport.

## Import now reuses the saved location matching + stamps Discipline/Trade (2026-08-08) — fmlozano
User reimported AVR101 and reported Discipline/Trade and Level both unrecognised. **Diagnosed by
querying the live project, not by reading code** — two independent root causes, both measured:
- ⚠️ **Level written on ZERO activities while Tower got 4,021 and Zone 1,218.** The importer's
  Location breakdown offers only the keyword matcher, whose argument `locMapUI` seeds from **the
  level's own name**. That works by pure coincidence for levels called Tower/Zone (Avesta's nodes
  really are "Tower 5"/"Zone 2") and matches nothing for a level called **Level**: measured
  **0 of 1,623** WBS node names contain the word "level" — they read "Nineth Floor"/"Roof Deck".
  Meanwhile the project already held a **planner-confirmed 29-name match table** for Level whose
  **every key still exists in the tree** (verified 29/29) — the importer simply never offered it.
  **Fix: `locSrcsSavedMatch()`** exposes each level's saved `location_levels.match` as a source and
  `guessFor()` prefers it, per level. A level with no saved match still falls back to the keyword
  source, so a first-ever import is unchanged.
- ⚠️ **`work_type` blank on ALL 4,393 activities.** The import writes `location` but has never
  written `work_type`, and a reimport **wipes** the column — so the trade grouping reads
  "— No discipline/trade —" after every reimport until someone remembers the wizard. The wizard's
  matching is `localStorage`-only, so it doesn't even survive a browser change. **Fix:
  `discStampFromWbs()`** derives the trade from the WBS ancestry via the existing `discCanonOf()`.
  Deterministic — no saved state — so it works on a first-ever import too. Both import dialogs gained
  a default-on checkbox (`discImportRowHTML`) that shows the **real coverage and the exact trades
  found in this file** before importing, and disables itself when the WBS has no recognisable trade
  headings. The wizard remains the way to refine/exclude.
- **Verified against the shipped functions** (sliced, not reimplemented): on Avesta's documented WBS
  shape the stamp yields exactly the canonical trades — Fire Protection/Electrical/Plumbing → **MEPF
  Works**, Wet/Finishing → **Architectural Works**, Superstructure/Substructure/Earthworks →
  **Structural Works** — while Planning-branch and milestone activities correctly get **none**. The
  saved-match source resolves a deep code to `Tower 5` / `9th Floor` / `Zone 2` (including the
  spelling merge "Nineth Floor" → "9th Floor"), and each level defaults to **its own** saved match,
  falling back to the keyword source when it has none. Inline script parses.
- ⚠️ **Live-probe caveat:** the module page is ~1MB and a full 6,400-row scan **froze and then killed
  the tab**; the lighter `projects.html` carries the same session and is the better place to query
  from. A row count that climbs between two reads means an import is in flight — measurements taken
  then are of a half-written table (one read returned 500 rows mid-insert).

## Existing projects never received newly-added skeleton phases — Closeout Phase backfill (2026-08-08) — fmlozano
User: *"Closeout phase is not recognized in the import wizard. We added closeout phase as one of the
main default WBS."* Diagnosed by **querying the live tree**, which showed AVR101 sitting at **7 nodes
— four top-level phases and no Closeout Phase at all.**
- ⚠️ **Root cause: `ensureWbsSkeleton()` only ever seeded an EMPTY tree** (`if (WBS_NODES.length) return`),
  so a phase appended to `WBS_SKELETON` after a project was first seeded could never reach it. AVR101
  predates Closeout Phase, so it was never seeded/locked there. This was noted as an aside in an earlier
  session and is the actual defect.
- ⚠️ **The previous fix (`b13bd86`) could not cover it.** That one widened the import picker to also
  offer *unlocked* top-level nodes whose name matches `WBS_SKELETON` — which worked only while a prior
  import's unlocked "Closeout Phase" branch happened to exist. **`_clearWbsTree()` drops unlocked
  nodes**, so Clear schedule deleted it and the picker was empty again. Compensating for a missing node
  only works while the node exists; the fix has to create it.
- **`_wbsBackfillSkeleton()`** now runs when the tree is non-empty: inserts any missing top-level
  skeleton phase **locked**, in its constant position, with its skeleton children. Matched by
  `_wbsNameKey`, so an existing **locked or unlocked** node of that name is **adopted, never
  duplicated**. Sort order prefers the constant's own index and falls past the end if something already
  occupies it, so a user's own top-level branch is never renumbered underneath them. Summary-row
  projection is left to `_wbsEnsureSummaries()` (runs straight after in `load()`) rather than duplicating
  the projector. Tolerant: an insert error just means no backfill.
- **Verified 12/12 in Node against the SHIPPED `_wbsNameKey`/`_wbsBackfillSkeleton`** (sliced out, not
  reimplemented) using AVR101's exact live shape: exactly one phase added, locked, top-level, at
  sort_order 4 (after Execution Phase); **second run is a no-op**; an unlocked same-name node is adopted
  rather than duplicated; and a tree holding only Milestones gets the other four phases + Planning's
  three children with no duplicate sort_order and no re-created Milestones. Inline script parses.
- ⚠️ **Not verified signed-in** — `index.html` is not `?v=` cache-busted, so **hard-refresh
  (Ctrl+Shift+R) before reimporting**; the phase appears on the next project load, then the import
  picker offers it.

## Two location levels that are really ONE dimension — merge levels (2026-08-08) — fmlozano
User: *"There are location breakdown that are the same levels which are horizontal and vertical. This
shows unassigned"*, with the intended shape drawn as `Tower > Level > Zone > {Vertical, Horizontal}` —
note Vertical and Horizontal at the **same depth**, i.e. siblings, i.e. two **values**, not two levels.
- **Measured live on AVR101 before changing anything.** The project has 5 `location_levels`:
  Tower(0) / Level(1) / Zone(2) / **Vertical(3)** / **Horizontal(4)**. The Vertical level holds exactly
  one distinct value — `"Vertical"`, on 720 activities; Horizontal holds exactly `"Horizontal"`, on 498.
  **`haveBOTH: 0`** — no activity carries a value at both. So the "— Unassigned —" rows are not a
  grouping bug: grouping by two mutually-exclusive levels *must* leave each blank under the other.
- ⚠️ **The keyword matcher leads straight into this.** Name a level "Vertical", let `locMapUI` seed its
  own name as the search term, and every matching WBS node yields the value `"Vertical"` — a degenerate
  level whose only value is its own name. Both of these levels have `match: {}` (0 saved keys), i.e.
  they were filled by keyword, never through the wizard.
- **`_locMergePlan(srcId, tgtId)` + `openLocMergeLevel()`** — a **Merge into another level** (`⤵`)
  action on each row of the Location Breakdown editor. Plans first and shows the counts, the values
  being carried over, and any conflicts before writing.
  ⚠️ **A conflict never overwrites.** An activity that already holds a value at the target keeps it;
  only its source value is dropped. Silently discarding a real location value to satisfy a merge would
  be data loss.
  ⚠️ **The source key is deleted from `location` on conflict rows too**, not just moved rows — otherwise
  the deleted level would leave orphaned keys behind in the jsonb.
  The saved WBS `match` tables are folded together (target's entries win), the merged level can be
  renamed in the same dialog (Vertical+Horizontal → e.g. "Orientation"), and the source level is deleted.
- **Verified 7/7 in Node against the SHIPPED `_locMergePlan`/`locValOf`/`isWbs`** (sliced, not
  reimplemented) over a fixture built from AVR101's exact live shape: 498 activities move, **0
  conflicts** (matching the measured `haveBOTH: 0`), WBS-summary rows excluded, a planted both-values
  row is classed a conflict that keeps the **target** value, and merged coverage lands on **1,218** —
  exactly the live `Vertical 720 + Horizontal 498`. Inline script parses; every helper the new code
  calls confirmed to exist.
- ⚠️ **Not verified signed-in** — `index.html` is not `?v=` cache-busted, so hard-refresh before using
  Group menu → **Location Breakdown…** → `⤵` on Horizontal → merge into Vertical → rename.

### ⚠️ Live audit caught a regression in that backfill — it must COMPLETE a skeleton, never impose one
Auditing the backfill across **all 19 live projects** (top-level nodes only, per project — a single
cross-project `.is('parent_id',null)` scan froze the tab) showed the first cut was **wrong for 8 of
them**:
- **8 projects carry a real hand-built/imported WBS with NO skeleton** — CDP101, CP104, **GPR101**,
  LCIT, MWD101, OPW101, PSP101, SLN101. They predate the skeleton feature, so `lockedSkeletonPhases`
  is 0 and the backfill would have injected **five empty locked phases as new top-level branches into
  every one of them** — on GPR101 that is five empty headings dropped into an 8,596-node P6 tree.
- Only **4** genuinely wanted it (BAU101, BAU101-TEST, Test, XERTEST → Closeout Phase). AVR101 was
  already repaired by the live run. 6 empty-tree projects seed normally and are unaffected.
- **Guard:** backfill now runs only when the project already has a **locked top-level node bearing a
  skeleton name** — the signal that `ensureWbsSkeleton()` actually seeded it. A project with a tree and
  no skeleton has opted out; leave it alone.
- **Verified 6/6 in Node against the shipped function** over each real shape: a legacy imported root and
  a hand-built two-branch tree are both **untouched**; a seeded 4-phase project gets exactly Closeout
  Phase, locked; a complete skeleton is a no-op; and a seeded tree that also holds imported branches
  gets its missing phases without colliding sort_order or touching "Tower 1".
- ⚠️ **Lesson:** "additive and idempotent" is not the same as "safe" — this was both, and still wrong
  for 42% of projects, because it changed *which* projects the feature applies to. Measure the blast
  radius across real data before shipping anything that runs on every project load.

## The .xer importer silently discarded the WBS placement step (2026-08-09) — fmlozano
User cleared + reimported AVR101 and it mis-filed again. **Root cause found by grep, not by theory:
`parsed.wbsPlacement` was written once (line ~5270) and READ NOWHERE.** The XER preview dialog
collected the planner's per-branch placement choices and threw them away — `doImportXER` had the
full explanatory comment for the placement step but **no `applyWbsPlacement` call**. Every `.xer`
import ever run ignored placement. Avesta is a `.xer`.
- ⚠️ **The failure is silent and worse than "branches sit beside the skeleton".** Dotted codes are
  COMPUTED from position (locked skeleton nodes store `code=null` — confirmed live), so Milestones
  computes to code `"1"` — exactly a .xer's own project-root code. `wbsAdopt` then resolves the
  file's root ONTO the Milestones node and the entire file lands as its children. Nothing errors.
- **Measured live after the user's reimport** (waited for the row count to settle first — 6,606
  rows / 387 nodes): `Milestones desc=379`, and its children were the file's own branches
  `Project Milestones(5) · Initiation Phase(9) · Planning Phase(89) · Execution Phase(272)`, all
  unlocked, while the locked `Execution Phase` held **0**. `nodesWithStoredCode: 379` vs the
  skeleton's null codes is the fingerprint of the adopt path.
- ⚠️ **My first two hypotheses were both WRONG and were disproved by testing the SHIPPED code, not
  by reading it.** (a) A code-collision + `moves.sort`-by-string-length bug in `applyWbsPlacement`:
  disproved — run against the real file shape it distributes correctly in BOTH skeleton
  configurations (5 targets, and the 4-target pre-backfill state from the user's screenshot, where
  Closeout correctly becomes top-level `5`). (b) A stale cached build (this file is not `?v=`
  cache-busted, so it was the plausible suspect): disproved by the reimport reproducing it, and
  finally by the grep. **When a function tests clean against real data, check whether it is being
  called at all.**
- **Fix:** one line in `doImportXER`, placed to satisfy both surrounding comments' stated
  invariants — after location mapping (which keys off ORIGINAL codes), before the disc stamp and
  `xerRecToPayload` (which reads the FINAL code as `wbs`). Verified by index: `locMapping <
  placement < discStamp < payloads`.
- **Verified:** inline block parses (1,039,020 chars); `applyWbsPlacement` declared in the same
  block as the new call; and a simulation of the shipped functions over AVR101's exact measured
  shape turns `Milestones 379 / Initiation 0 / Planning 3 / Execution 0` into
  `Milestones 5 / Initiation 9 / Planning 89 / Execution 272`, root wrapper dropped, **0 stray
  top-level nodes**. ⚠️ **Not verified signed-in** — needs one more Clear + reimport.
- ⚠️ **The Excel path was always correct** (line ~4689) — only the XER path was missing the call.
  Worth checking whether both import paths consume every option the shared dialog collects.

## Code audit + 4 fixes: seeding, cache-busting, dead code, collapse memory (2026-08-10) — fmlozano
User asked for an architecture audit ("does the code work or not"), then for the fixes it surfaced.

**Audit verdict: it works.** Static scan found **0** duplicate module-scope function names, **0**
duplicate static DOM ids (294), **0** genuine undeclared references, and a clean parse. The problem is
scale, not correctness: **1.21 MB / 15,198 lines in ONE file**, a single ~1.03 M-char inline `<script>`,
**683 module-scope functions in one IIFE sharing ~144 mutable vars**, 334 `.onclick=` rebinds against a
virtualized grid, 156 scattered `.from()` calls, **0 committed tests, no build step**. Function-level
decomposition is fine (median 7 lines, largest 183, none over 200) — the risk is change-safety.

⚠️ **THREE of my own analysis tools produced confidently wrong numbers before I caught them. Any scan
of this file needs a sanity gate.**
1. A Bash **heredoc silently collapsed `\\b` into a backspace character**, so every `new RegExp('\\b…')`
   matched nothing and the dead-code scan reported **all 826 functions as dead**. Caught only because
   "rebuild is never called" is obviously false. Write analysis scripts with the file tool, not heredocs.
2. My comment/string **stripper is broken** — stripped brace balance is **4, must be 0** (it mis-tokenises
   regex literals and apostrophes in comments). Every statistic derived from it is unreliable; the
   headline counts above were re-derived from the RAW file with a sanity gate.
3. The same stripper deleted newlines inside block comments, so line numbers drifted and two runs of the
   `ScheduleBuilder` coupling measurement disagreed (**1,325 vs 2,712 lines**). Fixed by preserving
   newlines — but a naive brace-matcher still can't tokenise this file, so **there is no trustworthy way
   to find a closure boundary here without a real parser** (none available: no `package.json`).

**Fix 1 — location-wizard keyword seeding (`locSeedTerms`).** The matcher's default argument was the
level's **own name**, which only works when that name happens to be the tree's vocabulary. Measured on
AVR101: a level called **"Level" matched 0 of 159 distinct WBS node names** (the tree says "Nineth
Floor"/"Roof Deck"), so Level imported blank on all 4,393 activities while Tower and Zone filled at 88%
and 28%. Now seeds the **synonym family** via `locLevelTerms()` — the same list `locGuessLevel` already
pre-classifies with, so wizard suggestion and importer default agree by construction.
- **Measured on the live tree: Level 0 → 30 of 159 names.** ⚠️ Tower gains 2 false-positive *names*
  (`Building Management Systems`, `Building Watertightness`), so I re-ran the full deepest-wins
  resolution over all **3,874 Execution-Phase activities**: **3,814 Tower values before and after,
  0 activities changed.** Safe. `locLevelTerms` also deduped (order/duplicate-independent, so no
  classification change).
- ⚠️ Known-visible false positives remain by design — "Floor Finishes"/"Ground Reservoir" match the
  Level family and appear in the wizard's distinct-value preview for the planner to exclude.
- **15/15 against sliced shipped functions**, including the two cases that must NOT fold.

**Fix 2 — module pages are now cache-busted** (`dashboard.html`). Every shared asset carried `?v=` but
each module's own `index.html` did not, so returning users kept serving a cached page — mis-diagnosed as
a code bug more than once in this changelog. `MODULE_V` lives in dashboard.html, **not** config.js:
config.js is itself cache-busted from 22 HTML files, so versioning it there would mean a 22-file bump
for a one-module change. Covers all 13 modules. **Bump `MODULE_V` on any deploy that changes a module.**

**Fix 3 — 21 dead functions + one dead `var atDur` removed** (−162 lines). ⚠️ Every candidate was
re-verified against the **RAW** source including strings, which caught **2 false positives**
(`isDirty`, `drivingPath` ARE referenced). ⚠️ `mergeSuccessors` is `(function mergeSuccessors(){…})()`
— a named IIFE that IS invoked; my remover's line-start anchor skipped it **by luck, not design**.
Verified after: 0 of the removed names appear anywhere, `renderDetails()` dispatches only to surviving
functions, and `detStatusEdit` has its own `dd`/`nz` helpers so nothing was orphaned.

**Fix 4 — collapse state remembered per grouping** (user request). `setGroupBys` did `collapsed = {}`,
so flipping WBS ↔ Discipline/Tower/Level meant re-collapsing a 1,623-node tree by hand every time.
⚠️ The map is keyed by `_dcode`, which is **generated from the active groupBys** — one shared map cannot
serve two groupings, which is why it was wiped. Now one map **per grouping signature**, per project,
persisted (`ps_collapsed_<pid>`).
- ⚠️ **Adversarial review found 3 real defects in my first cut — all confirmed against the code and
  fixed before shipping:**
  1. **BLOCKER:** `doRender()` arms a 500 ms debounced save on load's first paint (line 2784/2841), but
     the store wasn't read until `loadGroupBys()` at 2856 — behind three awaits including the paginated
     resource fetches. The timer won, writing the **empty init object over the project's saved trees**.
     Fixed with a `_colStorePid` guard + reading the store at the TOP of `load()`.
  2. **BLOCKER:** `selectProject()` changes `pid` without cancelling the pending save, so `_colKey()`
     returned the NEW project while `collapsedStore` still held the OLD one — project A's trees written
     under project B's key. `_dcode` keys collide across projects, so B would open with unrelated
     branches hidden. Fixed by the same guard + `_cancelCollapseSave()` in `selectProject`.
  3. **MAJOR:** `restoreCollapsedFor` overwrote `collapsed` unconditionally and runs *after*
     `_applyBigCollapse()`, discarding the large-schedule default — a 17k-activity schedule would open
     fully expanded. Fixed with `keepIfMissing`: load-time keeps the default, grouping-switch resets.
- **12/12 against sliced shipped functions**, including a regression test for each of the three.

**Bonus real bug found while scoping the data layer:** `activity_steps` used a bare `.select('*')`
(capped at 1000 rows) while every growable neighbour already paginated. It holds one row **per step per
activity**, and truncation feeds `physicalPct()` → `syncPhysicalPct()` → **writes a wrong
`percent_complete`** into the schedule, corrupting EVM, the S-curve and every roll-up. Now routed
through `selectAllPaged` (exactly equivalent — the call had no `.order()`).

⚠️ **NOT verified signed-in.** The deployed site serves the old build and a local `file://` load renders
as a static snapshot without executing scripts, so every check above is static analysis plus harnesses
that **execute functions sliced from the shipped file**. Smoke-test after deploy.
⚠️ **Deferred: splitting the file.** One inbound entry point (`ScheduleBuilder.open`) but heavy outbound
coupling to module helpers — it needs an explicit shared-state object first, and a boundary I can prove.

## Stage 1 of the file split: explicit shared-state surface (`PS` / `window.__PS`) (2026-08-10) — fmlozano
Groundwork for splitting the 1.2 MB file, done **without moving a single line of code**.
- ⚠️ **What actually blocks a split is not size, it is implicit sharing.** All **684** module-scope
  functions freely read and write **174** mutable bindings in one closure; code moved to another
  `<script>` loses the closure and the state with it. The scaffold exposes that surface explicitly:
  `Object.defineProperties` accessors that **close over the real bindings**, so `PS.state.rows` **is**
  `rows` — reads and writes both hit the live variable, no copy, no synchronisation.
- **Curated call-back surface, not all 684.** `PS.fn` exposes **29** functions an extracted module would
  realistically call back into (load/rebuild/renderAll/persist/switchTab/displayList/buildNodes/…).
  Functions move with their code; shared mutable state does not — so state gets full coverage and
  functions get a deliberate subset. `PS.meta` records the real counts so the scale is measured by the
  code rather than by a regex over it.
- ⚠️ **Wrapped in try/catch by design** — a refactor scaffold must never be able to break the module. If
  any accessor fails to build, `PS` is simply `null` and everything runs exactly as before. A startup
  self-check reads every accessor once so a mis-generated name fails loudly instead of latently.
- **Generated, not hand-written.** The 174 names came from a scanner that parses multi-declarator lists
  (`var a = 1, b, c;` — the shape that produced false positives earlier), then were **cross-checked by a
  second, independently-written test**: 174/174 confirmed declared, 0 rejected, 0 referenced-only-once,
  and a sanity gate requiring 9 known-real names to survive.
- **Verified additive by diff: 0 lines removed or changed, 250 added.** `PS` and `_psBad` collide with
  nothing (0 prior occurrences; `PS_M_CAP` is a distinct identifier). `window.__PS` follows this module's
  existing `window.__archived` / `window.__viewOnly` precedent.
- ⚠️ **Cost: +23,634 chars (~2%) on a file whose problem is size.** Accepted only because it is the
  enabler for removing far more later; it should shrink as code actually moves out.

**⚠️ The bigger win: this module can now be EXECUTED locally.** `run-scaffold.js` runs the real 1 MB IIFE
in a Node `vm` sandbox with stubbed DOM/Supabase/AppAuth (`requireLogin` never fires its callback, so
only module-scope code runs). **12/12**, including proof that a write through `PS.state` reaches the
live binding. That lifts the "cannot verify without deploying" constraint this module has carried all
session — future changes here can be executed before they ship, not just parsed.
⚠️ One test failed first and it was **my stub, not the code**: `esc()` is `return Fmt.esc(s)`, and my
`Fmt` proxy returned the input unchanged, so the assertion was testing the stub. Stub the real
behaviour or the test proves nothing.

**Stage 2 (not started):** move one subsystem out (Schedule Builder is the best candidate — a single
inbound entry point) so it reads state through `PS` instead of the closure, with a verifiable step
between each move. ⚠️ Still blocked on a trustworthy closure boundary: a naive brace-matcher cannot
tokenise this file and there is no parser available (no `package.json`).

### 2026-08-10 — Execution Phase wrapper + "Execution Phase only" toggle, and a load-order grouping flash fixed
User: with location grouping on, Execution Phase's content (grouped by Discipline/Location) has no
"Execution Phase" heading above it — unlike Milestones/Initiation/Planning, which do show as headings
(they render by real WBS path, since they're carved out of the location walk). Confirmed as **by
design**, not a bug — 3,874 of 4,393 activities are under Execution Phase, so wrapping it would be a
container holding 88% of the schedule with no filtering value. User asked for the wrapper anyway (for
visual consistency with the other phases) plus a toggle to isolate just Execution Phase.
- **Synthetic "Execution Phase" wrapper heading.** When a location dimension is grouped, a
  `_dkind:'group'` node (named from the real WBS row, falling back to "Execution Phase") is pushed
  before the Discipline/Location walk, and the walk's `parentCode`/`parentAnc` are seeded from it —
  so Structural Works / Tower 1 / … now nest one level deeper, under the heading. Purely cosmetic;
  the underlying carve-out (`otherPhaseActs` vs `acts`) is unchanged.
- **"Execution Phase only" toggle** (Group menu → new **View** section, checkbox `#ps-gm-execonly`,
  persisted `localStorage.ps_execonly`). Drops Milestones/Initiation/Planning/Closeout entirely
  instead of rendering them before/after — reuses the same `execPhaseCode()`/`locCodeUnder()` scoping
  the carve-out already does, extended to also scope when **no** location dimension is active (the
  plain WBS-tree view): the project's own Execution Phase WBS-summary row + everything under it is
  kept, with no synthetic wrapper needed there since the real row already is the top-level heading.
- ⚠️ **REAL BUG FOUND AND FIXED while investigating a separate report: `groupBys` flashes the wrong
  value on every project open/switch.** User showed two screenshots — one glitchy (blank grid rows,
  "Group: WBS") that "reverts back to being okay" (correct grouping, real data) a moment later.
  Traced to `load()`: `groupBys` is a shared module var never reset per-project, and the per-project
  saved grouping isn't read from storage (`loadGroupBys()`) until **near the very end** of `load()` —
  after the schedule rows, WBS tree and resource assignments have all loaded (several seconds on a
  large project). But the grid **renders twice before that** (once from the IndexedDB cache, once
  from the fresh DB fetch), both painting with whatever `groupBys` was left over — the bare `['wbs']`
  default on a fresh load, or literally the **previous project's** grouping on a project switch.
  `loadGroupBys()`'s later, fully-validated read then flips it to correct — the visible "revert."
- **Fix:** `load()` now reads the saved grouping from `localStorage` **immediately**, before either
  of the two early renders, so they already paint correctly. Deliberately **un-validated** at this
  point (`normalizeGroupBys()`/`allDims()` need `LOC_LEVELS`, which isn't loaded yet — validating
  early would silently drop a saved `loc:` dimension) — the existing `loadGroupBys()` call still runs
  its full validated read+normalize later, now normally a no-op repaint instead of a visible flip.
  Also restores this grouping's collapse tree at the same early point (`restoreCollapsedFor`), which
  composes cleanly with the existing `_applyBigCollapse()` large-tree default (guarded on
  `collapsed` being empty — verified no conflict).
- Verified: inline script parses; the exact added read/fallback logic unit-tested in isolation
  (picks up a saved grouping, falls back to `['wbs']` for a project with none, fails safe — no throw —
  on a corrupted saved value). ⚠️ **Not verified signed-in for the flash fix** — needs a project with a
  non-default saved grouping reopened a few times to confirm the flash is gone; the wrapper/toggle
  feature's implementation predates this entry (built in the same session) and is likewise unverified
  signed-in. Module-local, no migration, no `?v=` bump (`index.html` isn't cache-busted — hard-refresh).

## Activity legend (LSM-style) + vertical stacking view on a month click (2026-08-13) — fmlozano
User asked for the two LSM features from the OPW101 deck: a **legend for the activities in the Gantt**,
and **clicking a month to show progress as a vertical stack** of floors.
- ⚠️ **The existing `.ps-legend` is not that legend.** It explains bar SHAPES (task / summary /
  baseline / milestone / data date) — one entry per bar KIND. An LSM legend maps a colour to a
  repeating work TYPE (Structural Works · MEPF 1st Fix · Plastering …), which recurs on every floor.
  So the new legend is a second strip (`#ps-actlegend`) keyed by a category FIELD, not by row.
- **Category colour engine** (`ps_catcolors` per project, alongside the existing `ps_wbscolors` /
  `ps_actcolors`): `catCfg` / `catValOf` / `catList` / `catColor`. The field is selectable —
  **Activity name · Discipline/Trade (`work_type`) · Activity type · any Activity Code type** —
  because a P6 import may carry the trade in any of them. Colours auto-assign from an 18-colour
  palette and every swatch in the legend is an editable `<input type=color>`.
- ⚠️ **Categories are ordered by when the work first starts, not alphabetically** — that is what makes
  the legend read like an LSM one (Structural → Masonry → Plastering → Finishes falls out of the
  schedule itself). Dateless categories sort last; WBS/summary rows and blank values are excluded (a
  summary rolls up several categories, so it has no single colour).
- **Bar colour precedence is now `actColor(r) || catColor(r) || effWbsColor(r)`** — a per-activity
  override still wins, and the legend is **off by default**, so no existing project's Gantt changes
  colour until the planner turns it on.
- **Vertical stacking view** (`#ps-stack-back`, `openStackView`/`renderStackView`): every month (or
  quarter) cell in the Gantt header is clickable and opens *"Planned status as of &lt;period&gt;"* —
  one band per location value, top level first, coloured with the same legend colours. Per band:
  fill = % of that location's categories complete at the cut-off, text = *"On-going X"* / *"X
  complete"* / *"Not started"*.
  - ⚠️ **The grip inside the same header cell is a DRAG, not a click** — the handler ignores clicks
    landing on `.ps-ts-grip`, or resizing the timescale would pop the panel open every time.
  - ⚠️ Rows are sorted by **earliest start** and then reversed, not by name — floor names are text
    ("Nineth Floor", "Roof Deck") and sort meaninglessly; build order is the honest vertical order.
    Falls back to a numeric-aware name sort when starts are missing.
  - Level is chosen from `LOC_LEVELS` (defaults to the one whose name matches /floor|level|storey/),
    switchable in the panel. Uses `dispStart`/`dispFin`, so it reads actuals where recorded.
  - Honest empty states rather than a blank panel: no Location Breakdown → points at
    **Group ▸ Location Breakdown…**; levels defined but unfilled → points at
    **Group ▸ Match WBS to locations…**; no categories on the chosen field → points back at the legend.
- ⚠️ Only Month and Quarter zoom produce clickable period cells (Year zoom renders `.ps-yr` only).
- **Verified 12/12 in Node against the SHIPPED `_stkState`/`catList`/`catValOf`/`catCfg`** (sliced out
  of index.html, not reimplemented): all five state cases incl. finish-exactly-on-the-cut-off counting
  as done and started-but-unfinished beating a later done; category ordering by first start, dateless
  last, WBS + blank excluded, counts aggregated, palette cycling. Inline script parses (1 block, 0
  fail); the module page loads with no console errors.
  ⚠️ **Not verified signed-in** — needs a project with a location breakdown to eyeball the stack.
  `MODULE_V` bumped to `20260813a` (module `index.html` is cache-busted from dashboard.html).

## LSM pass 2: textures, filling bars, WBS composition, side-by-side stacking (2026-08-13) — fmlozano
Owner feedback on the first LSM pass, verified **signed in on AVR101 (Avesta, 6,016 rows)** this time.
- **Legend colours were too close together → colour + TEXTURE, as the reference sheet does it.**
  New `CAT_TEXTURES` (solid / hatch / dots / vertical / back-hatch / crosshatch / horizontal / grid)
  rendered as `background-image` over the base colour by `catStyle()`, cycling **one step per legend
  entry** so neighbours differ in hue *and* pattern; palette re-ordered for maximum adjacent
  separation. A **Textures** checkbox turns it off. ⚠️ A native `<input type=color>` can only show a
  flat swatch, so the legend swatch is a styled button with the colour input hidden behind it.
  **Verified live: 6 trades, 6 distinct colours, 5 distinct textures.**
- **Bars now FILL UP.** `catTint()` paints the remainder in the same colour at 0.26 alpha and the
  `.ps-bar-fill` carries the solid textured colour. ⚠️ Alpha rather than a blend toward white, so it
  reads in both themes. **Verified live: bar `rgba(0,176,240,.26)` / fill `rgb(0,176,240)` + texture,
  widths 0 / 53 / 100% matching `percent_complete`.**
- **WBS summary bars show what is INSIDE them** (`_sumSegsHTML`): each descendant activity as a
  segment at its own dates, tinted + filled by its own progress — so a summary reads as its sequence
  of trades, not one flat block. ⚠️ Built from a **one-pass `_segMap`** (each leaf pushed into every
  ancestor's bucket, capped at 400) rather than scanning `_sorted` per visible row, which would be
  O(rows × visible) on a 17k schedule. **Verified live: 378 segments on Avesta's default outline.**
- **Stacking view rebuilt.**
  - ⚠️ **Level order was wrong and it was not a sort-stability issue — the values are text.** Ordering
    by earliest start interleaved basements among the upper floors. New `levelRank()` ranks
    structurally (basements negative, ground 0, mezzanine 0.5, floors by number, roof last) and
    `cmpLevelValue` falls back to a numeric-aware name sort. **Two defects the live run caught that no
    fixture would have:** `Substructure` was unrankable and floated to the TOP of the tower (now −50,
    below the basements), and **`Ground Reservoir` matched the bare word "ground" and ranked as level
    0**, wedging a water tank between 2nd Floor and Ground Floor (the ground match now needs the floor
    sense). Values that are not a storey are appended **below** the stack instead of reversing with it.
    **Verified live: Roof Deck → 12th … 2nd → Ground Floor → grade line → Substructure → Ground
    Reservoir.**
  - **Bands are aligned** — the status column is a fixed `168px` grid track, not `auto`. With `auto`
    the widest label won and every band ended at a different x, which read as cantilevered floors.
    **Verified live: every band's right edge at exactly 918px.**
  - "Stack by" is a real 150×30 select on its own label, no longer colliding with its own text.
- **Docked stacking pane** (`.ps-stackpane`, third column of `.ps-split`): one band per level, placed
  at `DL index × ROWH` and scroll-synced by `transform`, so the stack sits **beside** the Gantt on the
  same row axis. It only aligns when the grid is **grouped by that level**, and offers a one-click
  "Group by <level>"; location groups then order by `cmpLevelValue` (top-first or bottom-first,
  shared with the stack) — the WBS grouping is never touched.
  ⚠️ **`normalizeGroupBys()` silently DROPS a `loc:` dimension whose level isn't in `LOC_LEVELS`**, so
  clicking that button before the project's levels finish loading did nothing at all. Confirmed as the
  live symptom (4/4 in Node) and now guarded with a toast instead of a silent no-op.
- **Verified 49 checks in Node against the SHIPPED functions** (sliced, not reimplemented): 12 state/
  category + 33 level-rank / ordering / tint / stackModel + 4 grouping-normalisation. Inline script
  parses. ⚠️ **The docked pane's row alignment is the one thing NOT confirmed live** — switching a
  6k-row project's grouping repeatedly timed out CDP on a backgrounded tab.
- ⚠️ **Environment note that finally paid off:** the tab reports `visibilityState:"hidden"`, so rAF
  never fires and the Gantt does not repaint after a state change. **`window.__PS.fn.doRender()` (the
  stage-1 scaffold) calls the render choke point directly and bypasses it** — that is how the bars and
  segments were measurable at all.

## LSM pass 3: tower scoping + the two clipped selects (2026-08-13) — fmlozano
Owner feedback on pass 2, all four items, verified signed in on AVR101.
- ⚠️ **THE REAL ONE — the stack ignored TOWER logic.** Avesta is `Tower › Level › Zone ›
  Orientation`, so stacking by Level merged **seven different buildings' 9th floors into one band**.
  That is not a display nit: Tower 1 can be topped out while Tower 5 is still in substructure, and a
  merged band cannot represent both. **Levels above the stacked one are now a SCOPE**
  (`_stkScope` + `stkOuterLevels`/`stkScopeValues`/`stkInScope`/`stkEnsureScope`), one selector per
  outer level, defaulting to the **first real value rather than a merge**, named in the panel title
  and the pane header. Scoping cascades: the Zone stack is scoped by Tower **and** Level.
  **Verified live: Tower 1 → 13 levels (tops out at the 11th), Tower 3 and Tower 5 → 14 (they have a
  12th) — three different buildings, three different stacks, from one project.**
- ⚠️ **Two selects were clipping their own text** (`Colour activities by`, then `Stack by` + the new
  Tower selector) — all three had a **fixed** `height` (28/30px) that the 12–12.5px option text
  overflowed, so the descenders were cut and it read as a smudge. Height is a **minimum** now and the
  box grows with its content. **Verified live: 32px box, 30px needed, `clipped:false` on all three.**
- **Label spill-over in the modal.** The level column wrapped "Ground Reservoir" onto two lines and
  the status column cut "Architectural Works complete" — and a wrapped label pushed its own row out
  of alignment with the others. Both side columns are fixed and wide enough (118 / 215px) and clip
  with a tooltip instead of wrapping; panel 1000px. **Verified live: 0 two-line labels, 0 clipped
  statuses, every band's right edge at 976px.**
- ⚠️ **The docked pane looked empty, and grouping by the level was NOT enough to fix it.** Each level
  group is followed by its whole subtree, so on Avesta two level rows sit hundreds of rows apart and
  no scroll position shows two bands. The pane now offers **"Collapse to one row per <level>"**
  (`stkCollapseToLevels`), which is what actually produces the side-by-side of the reference sheet.
- ⚠️ **My own ordering slip, caught live:** `renderStackView` built the title *before* resolving the
  scope, so the first open never said which tower you were looking at. Scope resolves first now.
- **60 checks green against the SHIPPED functions** (12 + 33 + 4 + 11), the new suite covering
  outer-level detection, cascading scope, first-value defaulting, per-tower models, and the
  **unscoped merge as an explicit regression case**. ⚠️ **Still not verified live: the docked pane's
  collapse-to-levels alignment** — regrouping a 6k-row project repeatedly timed out CDP.
- ⚠️ **Method note:** `window.__PS.fn.doRender()` (the stage-1 scaffold) is the only way to measure
  anything here — the tab reports `visibilityState:"hidden"`, so rAF never fires and the Gantt never
  repaints after a state change. Every measurement above came through it.

## New "Activity" grouping dimension — Activity › Location › WBS (2026-08-15) — fmlozano
User: *"the activities will swap with the WBS and the WBS Locations are the ones below the
activities. The current group by is not working as intended."*
- ⚠️ **Not a bug in `buildNodes` — the layout was simply not expressible.** `allDims()` offered WBS,
  Discipline/Trade, the location levels, Phase, Status, Responsible, Type, Work Package and activity
  codes, but **no dimension keyed on the activity itself**, so "activity on top, its locations
  beneath" had no way to be selected. The N-level engine already supported it; only the key was missing.
- **New `'act'` dimension** = trimmed `activity_name`, blank → `— Unnamed activity —`. Three sites,
  exactly as `'wp'` was added: `dimValOf` / `dimLabel` / `allDims` (listed second, right after `wbs`).
  Nothing else needed — `buildNodes`, `normalizeGroupBys`, collapse, group roll-up bars and the
  per-project `ps_groupbys_<pid>` persistence are all dimension-agnostic.
- ⚠️ **A one-activity group is CORRECT here, unlike `'work'`.** `dimValOf`'s work_type branch
  deliberately avoids falling back to the activity name because that flooded the view with hundreds
  of one-activity "disciplines". For the LSM dimension the name **is** the key, so a one-off activity
  forming its own group is the intended reading, not the failure mode — noted in the code so nobody
  "fixes" it back.
- **New preset "Activity › Location (LSM)"** = `['act'] + locDims + ['wbs']`. `wbs` last is load-bearing
  per the user's choice: it means each location group still renders its **pruned WBS path** above its
  activities, rather than listing activities flat.
- **Verified 9/9 in Node against the SHIPPED `dimValOf`/`dimLabel`/`allDims`/`normalizeGroupBys`**
  (sliced out of index.html, not reimplemented): value + trim, both blank forms, label, presence and
  picker order in `allDims`, the full preset surviving normalization, `wbs` still forced last from a
  mid-list position, and a stale `loc:` dim still dropped. Inline script parses (1 block, 0 fail).
- ⚠️ **Not verified signed-in** — needs a project with a location breakdown to eyeball the nesting.
  Module-local, no migration. `MODULE_V` → `20260815k`.

## LSM pass 4: legend scoped to what's open, bars stripped to activities only, activity groups in build order (2026-08-15) — fmlozano
Three owner asks off live screenshots of AVR101.
- **1. The legend printed the whole project — 398+ entries.** `catList()` scans every row, and the
  legend printed all of it. Now scoped by **`catVisibleValues()`** to the categories exposed by the
  WBS branches actually opened (leaf `_dkind:'task'` rows in `DL`), with a "· N more in collapsed
  branches" tail.
  ⚠️ **Deliberately NOT folded into `catList()`.** Colours are assigned by **position** in that list
  (`CAT_PALETTE[i % …]`), so scoping the list itself would **re-colour every bar on every
  expand/collapse**. The full list stays the stable colour assignment; the scoping only decides what
  the legend PRINTS.
  ⚠️ **Fallback when nothing is expanded:** a fully-collapsed outline exposes 0 task rows, but the
  Gantt still draws every activity as a coloured segment on the summary bars — an empty key beside a
  full chart reads as broken. So it falls back to the whole list and says "whole project (nothing
  expanded yet)".
  ⚠️ **`renderAll()` was the legend's ONLY caller**, and collapse/expand routes through
  `renderGrid → scheduleRender → doRender`, never `renderAll` — so the scoping would have been dead
  on arrival. Hooked at the end of `doRender()`, where `DL` is already built for that frame (it reads
  `DL` rather than calling `displayList()`, which would re-run `buildNodes()` over every row).
- **2. LSM mode now shows ONLY the activity bars.** New `_lsm = catCfg().on` in `ganttRowHTML`
  suppresses the BL0 bar (task, milestone **and** the WBS roll-up baseline) and the red %-complete
  treatment. Planned = the category colour at low alpha, actual = the solid textured fill — that
  pairing already existed; what was missing was removing the three other bars stacked around it.
  ⚠️ The summary roll-up bar is dropped **only when segments actually exist** (`!(_lsm && segs)`).
  A synthetic group header (Activity / Tower / Level) has no `wbs`, so `_sumSegsHTML` returns '' for
  it — dropping its bar on `_lsm` alone would leave that row with no mark at all.
  `_sumSegsHTML` gained a `standalone` flag so the segments take the row's height instead of the thin
  strip that used to sit under the roll-up bar. The shape legend's Activity / WBS summary / Baseline
  entries hide via `#ps-view-schedule.ps-lsm` — they'd otherwise describe marks that no longer exist.
- **3. "Activities are mixed with locations" — it was ORDERING, not nesting.** The nesting was
  correct (`3rd Fix › Tower 1 › 11th Floor`). ⚠️ **On this project "2nd Floor" and "3rd Floor" are
  genuine ACTIVITY NAMES** (14 each — per-floor milestones), so alphabetical `cmpGroupName` interleaved
  them with "1st Fix"/"2nd Fix"/"3rd Fix" into one meaningless run that reads as locations leaking into
  the activity level. The `'act'` dimension now sorts by **earliest start** (the same rule the LSM
  legend uses), blanks last, name as tiebreak — build order separates them because they genuinely
  start apart. Every other dimension's comparator is untouched.
- **Verified 15/15 in Node against the SHIPPED code** (the sort block and `catVisibleValues` sliced out
  of index.html, not reimplemented): chronological order with blanks last, min-start-per-bucket,
  equal-start name tiebreak, `loc:`/`status` dims still using their own comparators, legend scoping
  counting only task rows and deduping, empty/null `DL`, and the presence of all six LSM guards.
  Inline script parses (1 block, 0 fail).
- ⚠️ **Not verified signed-in** — needs a live look at AVR101 with the legend on. `MODULE_V` → `20260815m`.

## Grouping picker: Move down / Remove were unreachable, and the WBS path repeated per group (2026-08-15) — fmlozano
Owner screenshot of the Group menu showed each level row as a number badge, a blank label and a single
▲ — no ▼, no ✕. Plus: with a location grouping, "Execution Phase › Construction Phase › Tower 1 ›
Structural Works" repeated above every single leaf group.
- ⚠️ **CSS SPECIFICITY BUG — ▼ and ✕ have been invisible AND unreachable since the picker shipped.**
  `.ps-menu button` is `(0,1,1)` (class + type) and sets `display:block; width:100%; padding:8px 14px`;
  `.ps-gm-x` is only `(0,1,0)`, so it lost. Each row button therefore rendered a **full row wide** and
  un-shrinkable (`flex:none` DID apply — `.ps-menu button` sets no flex), so the three buttons totalled
  3× the row width: the label (`flex:1` + `overflow:hidden`) collapsed to **zero width**, and ▼/✕ were
  pushed past the menu's clipped edge (`.ps-group-menu{overflow-y:auto}` makes overflow-x computed
  `auto`). That is the whole screenshot — blank label, lone ▲ — from one missing class in a selector.
  Re-asserted at `(0,2,1)` as `.ps-group-menu button.ps-gm-x`.
  ⚠️ **The markup was correct all along**, which is why this reads as a missing feature rather than a
  style bug. Check the cascade before adding a control that the code already emits.
- **Common-prefix prune in `emitLeaf`.** The WBS path is emitted PER GROUP, so a grouping like
  Activity › Tower › Level › Zone › Orientation › WBS re-rendered the identical four-row ancestor chain
  inside every one of hundreds of leaf groups — rows that are the same for every activity in the group
  AND whose Tower/Level/Zone are already the group headings above them. `emitLeaf` now drops the
  ancestors **common to every activity in the group** and keeps only the part of the tree that actually
  branches.
  ⚠️ **Clamped to `minSegs - 1`**: the common prefix of a SINGLE code is the whole code, which would
  emit no row at all for a one-activity group.
  ⚠️ **`_danc` gets only the RETAINED ancestors** — collapse walks that chain and expects every entry
  in it to exist as a rendered row; leaving the dropped codes in would break expand/collapse silently.
  ⚠️ **`prune` is passed ONLY from the dims walk.** The two other `emitLeaf` calls render the carved-out
  non-Execution phases by their real WBS path with no group heading above them, where the full chain
  **is** the view.
- **No hardcoded A–E presets.** The owner clarified the five examples were illustrative — the ask is
  general flexibility for reporting. With ▼/✕ working, the existing add / reorder / remove list already
  expresses every one of them (and Tower/Level/Zone/Orientation/Unit are per-project location levels,
  so fixed presets would be wrong on the next project anyway).
- **Verified 17/17 in Node against the SHIPPED `emitLeaf`** (sliced out, not reimplemented): the
  reported chain dropped, depths flattened to group level, a group that genuinely branches keeping its
  branching level with correct kinds/depths, unpruned behaviour byte-identical to before (6 rows,
  depths 1-5), uneven depths, the single-activity clamp, and **every `_danc` entry existing as a
  rendered row across all five fixtures**. Inline script parses (1 block, 0 fail).
- ⚠️ **Not verified signed-in.** `MODULE_V` → `20260815n`.

## Legend ignored "Execution Phase only" and the visible branches on a collapsed outline (2026-08-15) — fmlozano
Owner: with **Execution Phase only** ticked the legend still listed Bid Review / Site Visit / Bid
Submission — Planning-and-Initiation work that is not on screen.
- ⚠️ **My own regression from the scoping pass earlier today.** `catVisibleValues()` resolved only leaf
  `_dkind:'task'` rows. On a collapsed outline there are none, so the scope came back empty and hit the
  "nothing expanded yet → show the whole project" fallback — which ignored the Execution-Phase carve-out
  AND which branches were rendered. The fallback was the bug, not a missing filter.
- **A collapsed row now resolves what it STANDS FOR**, which is also exactly what the Gantt paints as
  coloured segments on that row:
  - **group row** → `_gacts`, a **reference** (no copy) to its bucket, stashed in `buildNodes`. Buckets
    are built from the already-scoped `acts`, so this inherits the Execution-Phase carve-out and the
    filters for free.
  - **WBS row** → `catAncMap()`, a cached `wbs code → {category: true}` index.
    ⚠️ **Uncapped on purpose.** The obvious reuse is the Gantt's `_segMap`, but that is capped at
    `SEG_CAP` (400) for drawing — reusing it would silently drop categories out of the key on any
    branch bigger than that.
    ⚠️ **Only expanded when the row is NOT inside a group** (group display codes carry `§`). Inside a
    group the ancestor index returns every activity under that code across ALL groups, pulling in
    categories the group itself excludes — and that row's group ancestor is in `DL` anyway, so it is
    already counted.
  - **task row** → its own value, as before.
- ⚠️ **Grouping by WBS at level 1 with no phase filter still lists everything, and that is correct** —
  those five phase rows genuinely represent every activity in the project, and the Gantt draws a
  segment for each one. The levers are the **Execution Phase only** toggle and expanding a branch;
  the legend now follows exactly the same scope rule the bars do.
- **Verified 10/10 in Node against the SHIPPED `catAncMap`/`catVisibleValues`** (sliced, not
  reimplemented): a collapsed discipline group resolving to its bucket ONLY (excluding the other
  phase's work), a collapsed top-level WBS row resolving its whole subtree, a sibling phase resolving
  only its own, a WBS row inside a group correctly NOT expanded, task rows, mixed input deduping,
  empty `DL`, a group with no `_gacts`, blank names skipped, and a 900-activity branch returning all
  900 (proving the SEG_CAP truncation is not inherited). Inline script parses (1 block, 0 fail).
- ⚠️ **Not verified signed-in.** `MODULE_V` → `20260815p`.

## Grouping is now also a FILTER; deepest level carries the activity; group rows roll up baseline + status (2026-08-15) — fmlozano
Four owner asks off live AVR101 screenshots, plus a clarification mid-turn: *"the group by function will
act as a filtering function… only showing activities that have the applied selection."*
- **The grouping filters.** An activity with no value on a grouping dimension can only ever land in an
  "— Unassigned —" bucket, so it is now dropped instead: a Tower › Level › Zone › Orientation breakdown
  shows the work that HAS a location and nothing else. Manpower Loading, Bonds & Permits and the rest of
  General Requirements say nothing in a location breakdown and no longer appear.
  ⚠️ **Runs AFTER the Execution-Phase carve-out and clears `otherPhaseActs` too.** That carve-out exists
  to render non-located phases by their WBS path — which is exactly what the owner asked to stop seeing.
  ⚠️ **Restricted to `dimNeedsValue()` dimensions** (loc:, code:, work, wp, phase). `status` defaults to
  'Not Started', `type` to 'Task', `act` to the name, and **`responsible`'s "Unassigned" is a genuine
  state a planner needs to see** — filtering on those would be silent data loss, not tidying.
  ⚠️ **It HIDES real activities**, so it is a toggle (Group menu → View, default ON) and the grid footer
  reports "· N hidden (no value on a grouping level)". Never let that be silent.
  **This also fixed the legend complaint**: with Activity as the top level, every activity name was a
  group row in `DL`, so the correctly-scoped legend still listed all 400. Filtering the non-located work
  out of the view removes it from the key as a side effect.
- **The deepest level now carries the activity.** A one-activity bucket at the last dimension emitted a
  "Vertical (1)" group row followed by its single activity — the same record twice, and the group row was
  the one WITHOUT Status / BL Start / BL Finish. That bucket now emits the ACTIVITY itself carrying the
  group's label (`_dlabel`), so every column is populated by the normal task-row rendering.
  ⚠️ **The label cell is NOT editable** when `_dlabel` is set: it would read "Vertical" while editing
  `activity_name`, which is how someone renames an activity by accident.
  ⚠️ **`_dlabel` is stamped on a REUSED row object**, so all three other emit paths now clear it — a
  stale label would otherwise survive a grouping change.
- **Group rows roll up baseline dates and status.** New `bspan`/`addBlSpan` in `buildNodes` +
  `_dblspan`, resolved by `wbsBlSpan` via the DISPLAY code (a group heading has no dotted WBS code);
  `_groupStatusPill` reads `_gdone`/`_gprog` counted once per bucket while it is in hand (`_costMap` is
  keyed by real WBS codes, so it cannot serve a group). So collapsing a level moves its detail up the
  tree instead of leaving three blank cells.
- **The LSM preset dropped its trailing `wbs`** — the location levels already say where the work is.
- **Verified 15/15 in Node against the SHIPPED code** (`dimRawOf`, `dimNeedsValue`, the filter block and
  `_groupStatusPill` sliced out, not reimplemented): required-dim filtering incl. missing-`location`
  entirely, the toggle off, a grouping with no filterable dim left untouched, the carve-out phases
  filtered too, all three status states, an empty group, and that status/responsible/type/act/wbs are
  NOT filterable. Inline script parses (1 block, 0 fail).
  ⚠️ **A stale test anchor cost a run**: `indexOf('_gbHidden = 0;')` matched the module-scope
  declaration, not the filter block, and sliced thousands of lines. Anchor on something unique.
- ⚠️ **Not verified signed-in.** `MODULE_V` → `20260815q`.

## Legend strictly = rows on screen; presets trimmed; repeated names qualified; click-a-bar highlight (2026-08-15) — fmlozano
- ⚠️ **Legend scope reverted to leaf task rows ONLY.** The previous cut also resolved what a COLLAPSED
  row stood for — defensible, since the Gantt paints those activities as segments on it — but it meant
  five collapsed phase rows produced a 400-entry key, which is what the owner asked twice to stop
  seeing. "Activities that are seen (opened WBS)" means rendered activity rows, nothing else. Empty
  state now reads *"Nothing expanded — open a WBS branch and its activities appear here."*
  ⚠️ **Known trade-off, deliberately accepted and stated:** in LSM mode a collapsed summary bar still
  paints coloured segments that now have no legend entry. `catAncMap()` and the `_gacts` node property
  were removed with it rather than left as rot.
- **Presets:** "Discipline › Location (recommended)" → **"Discipline › Activity › Location"**
  (`['work','act'] + locDims`); "Location › Discipline" removed. (The owner's text said "Discipline ›
  Activity › Trade › …" — Discipline and Trade are the same `work_type` field here, so it is listed once.)
- **The four identical "1st Fix" rows.** Without a trailing `wbs` level there is no path shown, so four
  activities that differ only by WBS parent (Mechanical / Electrical / Plumbing / Fire Protection) all
  read "1st Fix". `emitLeaf`'s non-`showWbs` branch now counts names within the group and tags **only
  the repeated ones** with their immediate WBS parent (`_dsuffix`, muted). ⚠️ Only when it actually
  repeats — qualifying every row would be noise. ⚠️ Cleared on the other emit paths, like `_dlabel`,
  because row objects are reused across renders.
- **Click a Gantt bar → every bar of that activity highlights**, the rest dim to 18%. Keyed by the
  "Colour activities by" field when the legend is on, else by activity name, so it always matches what
  the colours currently mean. Clicking the same bar again, or the ✕ on the legend's "Highlighting: X"
  chip, clears it.
  ⚠️ **Rides on the existing drag handler's zero-movement path.** A 0-day `move` previously persisted an
  identical patch — a pointless write plus an undo entry — so this replaced a small bug rather than
  adding a competing click listener that would fight the drag.
  ⚠️ `_hlCls()` returns `''` when nothing is highlighted, so the normal render is byte-identical.
- **Verified 19/19 in Node against the SHIPPED code** (`catVisibleValues`, `_hlKeyOf`/`_hlCls` and
  `emitLeaf` sliced out, not reimplemented): task-rows-only scoping incl. an all-collapsed outline
  returning an empty key and dedupe; no-highlight/match/non-match classes and the legend-on field
  switch; the qualifier applied to repeated names only, skipped for unique ones, and safe when the
  parent WBS row is missing; leaf sort order; both presets. Inline script parses (1 block, 0 fail).
  ⚠️ One assertion failed first and it was **my expected value**, not the code — the leaves sort by WBS
  code, so the unique name lands second, not last.
- ⚠️ **Not verified signed-in.** `MODULE_V` → `20260815r`.

## REGRESSION FIXED: LSM mode left WBS rows with no Gantt bar (2026-08-15) — fmlozano
Owner: *"The Gantt bars in the gantt view is missing."*
- **Audited by EXECUTING the shipped `ganttRowHTML`** against fixtures rather than reading it — it
  neither throws nor returns empty, so this was never a crash. That pointed straight at what LSM mode
  had changed.
- ⚠️ **Root cause, and it is mine.** The "only the activity bars" pass dropped the **WBS roll-up bar**
  in LSM mode and left the row to be drawn by its per-activity segments alone. That looked right on a
  small fixture and is wrong on real data: `_segMap` is capped at **SEG_CAP (400) per ancestor** and
  `_buildSegMap` fills each bucket with the **first 400 activities met in `_sorted` order**. On a
  4,393-activity project a collapsed high-level branch therefore got segments for a handful of its
  children and **nothing at all** for the rest — rows of empty Gantt, exactly as reported.
- **Fix: the roll-up bar always draws again.** It is the only mark guaranteed to exist for a summary
  row. Only the **BL0 bar** (task, milestone and roll-up) and the **red %-complete treatment** stay
  suppressed in LSM mode — which is what was actually asked for. The `standalone` sizing added for the
  removed layout is gone with it.
- ⚠️ **Lesson: a cap that exists for DRAWING became a correctness bug the moment it was the only
  drawing.** Before, the cap just meant "some segments are omitted from a bar that is still there".
  Check what a truncation guard is load-bearing for before making it the sole source of a mark.
- **Verified 28/28 in Node against the SHIPPED `ganttRowHTML`/`_sumSegsHTML`/`_hlCls`** (sliced, not
  reimplemented), across the full matrix of LSM on/off × segments present/absent × task / WBS / group /
  milestone rows: **every row type always produces a bar**, BL0 appears only outside LSM mode (task and
  roll-up), and segments appear only in LSM with segments available. Inline script parses (1 block, 0 fail).
- ⚠️ **Not verified signed-in.** `MODULE_V` → `20260815s`.

## Blank Gantt + stale legend: ONE throwing row was taking out three things at once (2026-08-15) — fmlozano
Owner: Gantt still empty, and the legend only updated after a tab refresh.
- ⚠️ **The two symptoms are ONE fault, and the failure signature named it.** The grid painted, the
  Gantt did not, and the legend was stale until a full reload. In `renderWindow()` the grid rows are
  assigned FIRST, then the Gantt bars are accumulated into a `bars` string and assigned **only after
  the loop finishes**; `doRender()` then calls `renderStackPane()` and (as it was) `renderActLegend()`
  *after* `renderWindow()`. So a throw on a single row mid-loop leaves `#ps-tl-bars` never assigned
  (blank Gantt), and the exception escapes `renderWindow` → `doRender` aborts → the stacking pane and
  the legend never repaint (legend only recovers on a page load). Every symptom, one cause.
- **Fixes, none of which need the culprit row identified:**
  1. **Per-row try/catch in the bars loop, and the assignment happens regardless.** A bad row now
     costs exactly one bar and logs `[ps] N Gantt row(s) failed to render; first was row <i>` with the
     row object — so the next occurrence is diagnosable from the console instead of invisible.
  2. **`renderActLegend()` moved to the TOP of `doRender()`**, right after `DL` is built (all it
     needs). It no longer depends on the Gantt render succeeding — which is literally the
     "automatic without the need to refresh" the owner asked for.
  3. **`renderStackPane()` and `wireDrag()` isolated** in their own try/catch — an optional side pane
     and an event-wiring pass must never blank the grid and bars that were just painted.
- ⚠️ **I could NOT reproduce the throwing row.** `ganttRowHTML` was executed against task / WBS /
  group / milestone rows with LSM on and off and segments present and absent — **28/28, never threw**
  — so the bad row is some shape those fixtures don't cover. The isolation above is the right fix
  either way (one row should never blank the view), and the console line will name the row next time.
- **Verified 10/10 in Node against the SHIPPED loop** (sliced out, not reimplemented): a poisoned row
  in the middle still renders the other three bars, the container is assigned rather than left stale,
  the failure is counted and logged, an all-good render is byte-identical with no logging, an
  all-bad render still assigns and logs the full count, plus the new ordering
  (`renderActLegend` before `renderWindow`) and both isolation wrappers. Parses (1 block, 0 fail).
- ⚠️ **Not verified signed-in.** If the Gantt is still empty after this, the console now says which
  row — that is the next thing to send. `MODULE_V` → `20260815t`.

## The blank Gantt: I had DELETED catEntry / catColor / catColorMapNow (2026-08-15) — fmlozano
The isolation shipped in the previous entry did its job on the first try — the console named it:
`ReferenceError: catEntry is not defined at _sumSegsHTML → ganttRowHTML → renderWindow`, 21–23 rows
failing per render.
- ⚠️ **Root cause: a region-replace of mine silently removed three live functions.** The "legend =
  visible rows only" pass replaced everything between my own comment marker and
  `function renderActLegend()`. **`catColorMapNow`, `catEntry` and `catColor` were sitting in that
  gap** and went with it. `catEntry` had **3 call sites** (`ganttRowHTML` ×2, `_sumSegsHTML`), so with
  the legend ON every single Gantt row threw — a completely blank Gantt.
- ⚠️ **Why it was invisible for four commits:** the file still **parsed cleanly** (a missing function
  is a runtime ReferenceError, not a syntax error), and every harness I wrote **stubbed `catEntry`**
  rather than slicing it out of the file — so the tests were green while the shipped code could not
  run. This is the same trap already recorded on 2026-08-05 ("stub real behaviour or the test proves
  nothing") and on 2026-08-10 (a scan that reported all 826 functions dead). **A green harness that
  injects a dependency proves nothing about whether that dependency still exists.**
- **Fix:** the three functions restored verbatim from `bb991bd`.
- **New standing check, and it should have existed already:** diff the SET of
  `function NAME(` between HEAD and a known-good commit after any bulk edit. Run against `2053790`
  (last commit before today's work): **0 functions lost, 10 added** — so nothing else went missing
  across the day's ~8 commits.
  ⚠️ Do NOT use a "called but never defined" scan on this file — prose inside the ~2,700 comment lines
  matches `word(` and buries the signal (it returned `collaboration`, `guard`, `weeks`…). Compare
  definition SETS across commits instead.
- ⚠️ **Never again replace a computed `src[i:j]` region without printing what is inside it.** I
  asserted on both boundaries and never looked at the 11 lines between them.
- **Verified 7/7 in Node against the SHIPPED functions**, sliced (not stubbed) this time: the exact
  reported call — `_sumSegsHTML` on a WBS row with the legend on — no longer throws and emits its
  segment, plus `catEntry` hit/miss, `catColor` hit/miss and `catColorMapNow`. Parses (1 block, 0 fail).
- `MODULE_V` → `20260815u`.

## Grouping no longer flips the grid — the stack order is now an opt-in "Match grid" ticker (2026-08-17) — fmlozano
Owner: the WBS view builds bottom-up (lower floors first), but selecting a grouped view flipped the
grid to top-floor-first. Wanted: never flip by default; flip only for the vertical stacking pane, via
a ticker, and only while that pane is open.
- ⚠️ **`_stkTopFirst` was doing double duty.** It is the stacking view's own display order (a building
  reads top-down), but the grid's location-group sort also read it directly — so ticking "Highest
  level at the top" in the stack modal silently reversed **every** location grouping in the grid,
  even with the stack closed. That is the reported flip; nothing else was reordering rows.
- **New `_gridMatchStack`** (persisted `ps_grid_matchstack`, **default off**) and the grid gate is now
  `_isLoc && _stkPaneOn && _gridMatchStack && _stkTopFirst`. So: off → build order always; on but pane
  closed → build order; on with the pane open → grid follows the stack's direction, which is the only
  state where alignment means anything.
- **The ticker lives in the docked pane's header** ("Match grid"), not the modal — it is inert unless
  that pane is open, so putting it anywhere else would offer a control that does nothing. Toggling it,
  and opening/closing the pane, re-render the grid + Gantt so the order changes immediately.
- The stack modal's checkbox tooltip no longer claims it sets the grid order.
- Verified: inline block parses (1 block, 0 fail); the gate and all 7 `_gridMatchStack` references
  present. ⚠️ **Not verified signed-in** — needs a project with a location breakdown. `MODULE_V` →
  `20260817o`.

## Reporting view — hide the authoring controls (2026-08-17) — fmlozano
Owner asked to improve the page for reporting, chose "the on-screen view itself", then clarified
mid-build: *"the reporting view will only hide some tabs/buttons."*
- ⚠️ **I had over-built it first** — a presentation bar, Summary/Detail altitudes, a summary column
  overlay, a report header and a bigger row height (~180 lines). Scrapped on the clarification and
  replaced with ~25 lines: a `body.ps-reporting` class and CSS. Nothing renders, nothing is written,
  nothing is restored on exit — so it is exactly reversible by construction rather than by care.
- **Hidden:** `#ps-actionsbtn`, `#ps-add`, `#ps-schedbtn` (it reschedules — a write), `#ps-linkmode`,
  `#ps-undo`, `#ps-redo`, `#ps-details`, the per-column filter row, and the footer's Hide-empty-groups
  checkbox. Edit affordances (`.ps-editable` cursor + hover) are neutralised.
- **Kept:** every view control — Open, grouping, zoom, Outline, Layouts, Layout, Progress, Analyze,
  Colors, Labels, search, Reports, Health, File/Print. ⚠️ **The Layout menu must stay visible: it
  holds the toggle, so it is the way back out.** A red "Reporting view" chip on the toolbar says the
  view is trimmed.
- **Session-only** (not persisted): a planner reopening the module to edit must never land in a
  trimmed view.
- **Verified in-browser against the module's REAL stylesheet and REAL toolbar markup** (harness
  extracted from index.html, gitignored, deleted): all 7 targets hidden when on, **all 11 view
  controls still visible**, filter row + footer checkbox hidden, edit cursor `text`→`default`, chip
  renders, and **fully reversible — the off-state snapshot is byte-identical after toggling back**.
  ⚠️ **The sanity gate earned its keep**: the first run reported the toolbar hidden with reporting
  OFF, because the Browser pane was below the 700px phone breakpoint (which hides `.ps-toolbar` and
  `.ps-split`); every measurement in that run was meaningless. Gate on `innerWidth` + a known-good
  computed value before trusting any of this.
  ⚠️ Two entries in that output look like failures and are not: `ps-colsbtn` reads MISSING because
  the columns control is the grid-header "+" corner, not a toolbar button, and `ps-linkmode` reads
  hidden in both states because it lives inside the closed Analyze menu.
- 15 static checks green (parse, every hidden id exists in the markup so no rule is a silent no-op,
  the Layout button is never hidden, no leftovers from the heavier version, ROWH untouched).
  Function-set diff vs HEAD: **0 lost**. ⚠️ **Not verified signed-in.** `MODULE_V` → `20260817p`.

## Grouped Gantt was a wall of flat red — group rows had no progress and no colour (2026-08-17) — fmlozano
Owner, on Discipline/Trade grouping: *"The gantt view is filled with red only, it doesn't signify
anything."* Correct, and it had nothing to do with the LSM work — the rows on that screen are
**group** rows, not WBS rows, and group rows were never given anything to draw.
- ⚠️ **`.ps-sum-group { background:var(--pd-red) !important }`** painted every group bar flat brand
  red, and the `!important` made it unoverridable. On top of that a group row got **no progress
  fill** (`sumPct` comes from `_costMap`, which is keyed by dotted WBS code — a group has none, so
  `_cm` is null and `sumPct` is 0) and **no composition** (`_sumSegsHTML` returns '' for
  `_dkind === 'group'`). So the moment you group by anything, every bar is an identical red slab
  carrying zero information. It was not a regression; it has been like that since grouping shipped.
- **Group rows now carry their own roll-up**, computed in `buildNodes` in the pass that was already
  walking the bucket (so it costs nothing): `_gpct` duration-weighted progress and `_gcat`, the
  group's category when **every** activity in it shares one.
  ⚠️ `_gpct` deliberately uses **the same weights and the same duration definition as `_costMap`'s
  `wd`/`wearn`** — a group and a WBS row covering the same activities must never report different
  percentages. Asserted against both formulas read out of the shipped source.
  ⚠️ A **mixed** group (a Tower holding all trades) resolves to `null` and stays neutral — colouring
  it as one trade would be a lie.
- **A single-trade group bar now fills up in its own legend colour** (tint remainder + solid textured
  fill, the same treatment as an activity bar), so grouping by Discipline/Trade reads as the trades
  it names. Mixed groups get a neutral `--ps-sum` bracket. Red is now only ever progress.
- New `catEntryByValue(v)` — `catEntry(r)` resolves a row, and a group has a value but no row.
  ⚠️ Two bugs in my first cut, both caught before shipping: I called `catValOf(ba)` **without the
  field**, which silently falls back to the activity NAME (so every group would have looked mixed),
  and I faked a row for `catEntry`. `catCfg().field` is hoisted out of the per-activity loop — it
  re-reads localStorage on every call.
- **21 checks green against the SHIPPED code** (the bucket block sliced out and executed, not
  reimplemented): category resolution, mixed → null, blank → null, duration-weighting proven by a
  100d@0% + 10d@100% case landing on 9% rather than 50%, zero-duration → 0 with no NaN, weights
  matching `_costMap`, and the four render-branch behaviours. Parse clean; **function-set diff vs
  HEAD: 0 lost, 1 added.** ⚠️ **Not verified signed-in.** `MODULE_V` → `20260817q`.

## Planned vs actual restored in the coloured view + named in the legend (2026-08-17) — fmlozano
Owner: *"The legend should show the planned vs actual."* Confirmed with them that this means the
**baseline dates vs the current dates**, not the progress shading already on the bar.
- ⚠️ **REVERSES a deliberate earlier decision, on the owner's call.** With "Colour activities by" on,
  the `_lsm` flag suppressed the BL0 bar on the reasoning that the pale remainder already IS the
  planned span. That conflates two different things: the remainder is planned **work** not yet done
  *inside the current dates*, while the baseline is the planned **dates** — and only the second one
  shows slip. A reporting view that cannot show slip is the wrong trade. Both draw now.
- Safe to bring back because the 2026-08-16 fix had already changed the baseline from an
  equal-weight second bar into a **thin ghost rail tucked under** the bar — which is what stopped it
  reading as two separate activities in the first place. Asserted: rail 5px vs bar 20px (≥3×), rail
  below the bar, both inside the row, and the slip visible as the offset between their left edges.
- Applies to all three row kinds: activity bar, WBS/group roll-up, and the milestone's baseline
  diamond. ⚠️ Group rows now get a rolled-up baseline too (`wbsBlSpan` resolves them via `_dblspan`).
  The Gantt-settings **baseline toggle still wins** — asserted, or this would have quietly overridden
  a user setting.
- **Legend:** the Baseline entry is no longer `.lg-lsmoff`, so it is named in the coloured view as
  **"Planned dates (BL0 baseline)"**. ⚠️ The two progress chips were reworded — **"Still to do"** /
  **"Actual (complete)"** — because "Planned (remaining)" sitting next to "Baseline (BL0)" made the
  two sound like the same thing, which is exactly the confusion being fixed.
- **`_lsm` is deleted, not left dangling.** Both things it gated have now come back (roll-up bar
  2026-08-15, baseline today), so it had one remaining reference: its own declaration. The comment it
  carried had been factually wrong for two days.
- **17 checks green by EXECUTING the shipped `ganttRowHTML`** (sliced out, ~9.6k chars, not
  reimplemented) across categorised activity / WBS summary / milestone / no-baseline / toggle-off /
  non-LSM, measuring real pixel geometry from the emitted HTML. Earlier group-roll-up suite (21) still
  green. Parse clean; **function-set diff vs HEAD: 0 lost.** ⚠️ **Not verified signed-in.**
  `MODULE_V` → `20260817r`.

## Stacking grid: floors on the vertical axis, and the "0/13" counter that meant nothing (2026-08-17) — fmlozano
Two owner reports on the vertical stacking modal.
- ⚠️ **Axes were inverted when stacking by Zone.** Rows were always the stacked level and columns
  always the parent, so Tower × Level came out right by luck (floors on the rows) while Level × Zone
  put Zone 1 / Zone 2 on the rows with the floors running across — a building lying on its side.
  Orientation is now decided **from the data, never from a level's name**: `levelRank()` returns a
  number for storeys and null for anything else, so whichever axis has the larger share of rankable
  values becomes the vertical one. Tower × Level is unchanged; Level × Zone transposes.
  ⚠️ Both orientations now read from ONE `cell[outer][loc]` index — the first cut stashed state on
  the function object (`stkGridHTML._flipCols`) and was thrown away before it shipped.
- ⚠️ **"0/13" on every tower did NOT mean zero accomplishment.** It counted bands at `pct === 100`,
  and since the 2026-08-13 change every floor's total includes the **whole-building phases**
  (Testing & Commissioning, Punchlisting, Closeout). One unfinished phase therefore holds **every
  floor of that tower** below 100% — so the count is structurally 0 until the very end of the job,
  on every project. The headline is now **average progress** (`87%`), with the exact fully-complete
  count kept in the tooltip; the modal's summary line reads "N locations · X% avg progress · N fully
  complete" for the same reason. Phase rows stay excluded from both.
- **Legend (owner): show planned vs actual as a bar sample, like the plain view's "Activity (red = %
  complete)" chip.** The three flat chips are now ONE `.lg-lsmbar` swatch drawn the way a real bar is
  — solid+textured actual over the pale remainder, with the baseline rail underneath — labelled
  "Activity (solid = actual, pale = still to do, rail = planned)".
- **14 checks by EXECUTING the shipped `stkGridHTML`** with the real `levelRank` sliced in: both
  orientations, floor ordering, every cell still placed after the transpose **and placed in the right
  cell** (not merely the right count), the average counter, and phases excluded. Parse clean;
  **function-set diff: 0 lost, 2 added.** ⚠️ **Not verified signed-in.** `MODULE_V` → `20260817s`.

⚠️ **KNOWN BUG, NOT FIXED — the Colors menu clips off-screen.** `.ps-menu` is `position:absolute;
left:0`, so a menu opened from a button near the right edge overflows the viewport and its right-hand
column (the colour swatches) is cut off. It depends on toolbar width, which is why it shows with a
long grouping label ("Discipline / Trade › Activity › Tower › Level › Zone › Orientation") and not
with "Group: WBS". The fix already exists for the column chooser (`positionColsMenu`: `position:fixed`
anchored to the button rect, clamped to the viewport) and should be generalised to the toolbar menus.

## Colors menu clipped off-screen + bars thickened for nothing (2026-08-17) — fmlozano
- ⚠️ **Colors menu clipping (owner asked for this one explicitly).** `.ps-menu` is
  `position:absolute; left:0`, so a menu opened from a button near the right edge overflowed the
  viewport and its right-hand column was cut off — on the Colors menu that is the colour swatches,
  i.e. the entire point of the menu, which is why it read as "the colour editing is broken". It
  depends on **toolbar width**, so it appeared with a long grouping label and not with "Group: WBS" —
  which is also why it looked like a grouping bug. New `anchorMenu(btn, menu)` pins it `fixed`,
  right-aligned to the button's own rect, clamped so it can never start off the LEFT edge either,
  width- and height-capped to the viewport with `overflow-y:auto`. Same approach as the existing
  `positionColsMenu`. ⚠️ `fixed` is viewport-relative, so it re-anchors on `resize` and on
  **capture-phase** `scroll` (to catch ancestor scrolls) while open, or it detaches from its button.
- ⚠️ **The thicker bars in coloured mode were buying nothing on most rows.** Owner: *"the width of
  the bars become thicker when Colour activities by is ticked — what value does that bring?"* The
  9px→13px bump exists so the trade-composition bands INSIDE a bracket are readable. But after the
  altitude fix (a branch containing other branches draws no composition), high-level rows got the
  extra height with nothing inside them. Now keyed to the bands actually being emitted
  (`.ps-sum-comp`, set when `_segs` is non-empty), so a bracket is only thicker when it has
  something to show.
- 8 checks + all three earlier suites green (transpose 14, baseline 18, group roll-up 21). Parse
  clean, **0 functions lost**. ⚠️ **Not verified signed-in.** `MODULE_V` → `20260817t`.
- ⚠️ **One stale TEST failed and it was the test, not the code** — it still asserted the two flat
  legend chips ("Still to do" / "Actual (complete)") that the owner then asked to be replaced by the
  single bar-sample swatch. Updated to assert the shipped intent (one `.lg-lsmbar` sample drawing
  both halves + the rail). Worth remembering: a suite written against an intermediate iteration will
  fail on the FINAL one and look like a regression.

⚠️ **OPEN / NOT INVESTIGATED — owner report: "check the Gantt for Mat Footing etc, it is bugging."**
Screenshot: under Foundation, the leaf branches (Mat Footing, SW/CW Starter, FTB, SOG) draw green
hatched composition bands, while their parents (Substructure, Earthworks, Foundation, Superstructure)
draw plain red brackets. Earthworks in particular shows a green band over a wide pale bar. Not
diagnosed — ran out of context. First things to check: whether those bands span the right dates (the
band geometry is relative to the bracket's own left edge, `barX`), and whether the pale bar behind is
the category TINT or a stray baseline rail now that the rail draws in coloured mode.

## "Check the Gantt for Mat Footing etc" — the summary bracket was drawing DIFFERENT DATES from the bands inside it (2026-08-17) — fmlozano
Owner: *"Check the Gantt for Mat Footing etc, it is bugging."* Avesta (AVR101), grouped by WBS,
"Colour activities by = Discipline / Trade" ticked. It is one root cause with two visible faces, and
it is **not** in `_sumSegsHTML` and **not** in this morning's baseline reinstatement.
- ⚠️ **ROOT CAUSE: `_spanMap` — the roll-up that positions every summary bracket — was built from
  `start_date`/`end_date`, while EVERYTHING that draws inside or beside it uses `dispStart`/`dispFin`**
  (actual when set, else the retained-logic forecast, else planned). Activity bars, the grid's
  Start/Finish columns and the LSM composition bands are all on displayed dates; the bracket alone
  was on stored planned dates. So on any branch whose work has actually STARTED — foundations, which
  is exactly the screenshot — the bands are offset from their own bracket by the slip. The bands are
  the bracket's CHILDREN and the bracket carries a `clip-path`, so the overflow is silently eaten
  rather than drawn: short bands in the wrong place, white where work should be.
- ⚠️ **SECOND HALF, same block: the roll-up folded in the WBS-SUMMARY ROW'S OWN stored dates.**
  `rows.forEach` had no `isWbs(r)` guard (`_costMap`, three lines below, has always had one). An
  imported summary row carries its own `start_date`/`end_date`/`bl_*` and **nothing in this module
  ever recomputes them**, so one stale summary date stretched its own bracket *and every ancestor's*
  far past the work underneath. That is the "green hatched band sitting on a wide pale bar" —
  the pale bar is the BL0 roll-up rail blown out to the stale baseline width, not a rendering
  artefact of the rail itself.
- **Fix, all in `rebuild()`:** the span roll-up now walks **descendant activities only** and uses
  **dispStart/dispFin**; `_blSpanMap` likewise skips summary rows. A second pass seeds a branch that
  holds no activities at all from its own dates, so an empty branch still draws instead of vanishing
  — ⚠️ without that fallback `wbsSpan` returns null and `ganttRowHTML` returns `''`, i.e. a blank row.
  The timeline `_min`/`_max` moved to displayed dates too, or a bar whose actual start precedes its
  planned start falls off the left edge.
- **Same inconsistency fixed in the GROUPED path** (`buildNodes`' `addSpan`, 3 call sites) — group
  headers had the identical planned-vs-displayed mismatch. Latent, not reported, one line each.
- **Also: the roll-up baseline rail was hard-coded to `sumTop + 10`** while a bracket carrying bands
  is **13px** (`.ps-sum-comp`), not 9px — so on exactly the rows that show a composition the rail was
  3px *inside* the bracket and read as a stray pale slab poking out of it. It is now placed from the
  bracket's actual height; `_segs` is computed before the rail for that reason.
- **RULED OUT, both of the leads I started with.** (1) `_sumSegsHTML`'s band maths is CORRECT:
  `barX` is the bracket's own left edge, `_anc[last]` really is the activity's direct parent branch
  (an activity's `wbs` is its OWN dotted code — `recToPayload`/`xerRecToPayload` set `wbs: r.code`
  for leaves and summaries alike — so `_anc` excludes it and its last element is the containing
  branch), and the `_kidBranch` guard is right. (2) The baseline rail reinstated this morning is not
  drawing where it shouldn't; it was drawing the wrong WIDTH, because of the stale-summary-date bug
  above, and at the wrong HEIGHT on comp brackets.
- **Verified 22/22 in Node by EXECUTING the shipped code** — `rebuild`, `dispStart`, `dispFin`,
  `forecastFin`, `wbsSpan`, `wbsBlSpan`, `_buildSegMap`, `_sumSegsHTML`, `ganttRowHTML` and the whole
  `catEntry`/`catList`/`catShade` chain all **sliced out of index.html, none stubbed** (only the
  browser environment is: `localStorage`, `Fmt`, `_psDark`). ⚠️ **The suite was then run against the
  PRE-FIX file (`BEFORE=1 node check-sumspan.js head-index.html`) and fails 11/22** — including the
  literal screenshot: bracket 2190px wide with only 453px of bands on it. A suite that does not fail
  on the old file proves nothing; this one does.
  `scratchpad/check-sumspan.js`, plus a new `scratchpad/check-regress.js` (parse + function-set diff).
- Earlier suites still green: transpose 14, baseline-LSM 18, group roll-up 21. Parse clean (1 block).
  **Function-set diff vs HEAD: 0 lost, 1 added (`_mergeSpan`).**
- ⚠️ **NOT verified signed-in** — no auth from this environment, so I could not open Avesta and
  confirm which of the two mechanisms dominates in the owner's actual screenshot. Both are fixed and
  both reproduce the reported picture in the harness.
- ⚠️ **STILL OPEN, and it is a DATA problem, not a render one:** WBS-summary rows in the database
  keep stale `start_date`/`end_date`/`bl_start`/`bl_finish` from import. Nothing reads them for the
  Gantt any more, but they are still exported to Excel for non-summary paths and would mislead
  anyone querying the table directly. Worth a one-off cleanup or a write-back on rebuild.
- `MODULE_V` → `20260817u`.

## Stale WBS-summary dates: 4 rows corrected on WCB363 (2026-08-17) — fmlozano
Follow-on to the "stale WBS-summary dates" finding. Derived and applied in the owner's signed-in
browser session (the anon key has **no grants at all** on `project_schedule` — `401 42501` — so this
cannot be done from a headless agent; see the traps below).
- ⚠️ **Re-derivation confirmed WCB363 and DISPROVED the DEMO01 figure.** WCB363: 21 flagged,
  **7 fixable / 14 traps** — matches the earlier measurement exactly. **DEMO01 is NOT 2 rows, it is
  74** (8 fixable, 66 whose computed value is NULL, i.e. a write would erase the stored `bl_start`).
  DEMO01 was therefore left entirely alone — a 2 → 74 scope change is an owner decision, not a
  cleanup. ⚠️ Do not trust the "2" recorded in the earlier entry.
- ⚠️ **3 of the 7 "fixable" WCB363 rows were NOT applied, because the mechanical rule is not
  sufficient.** A row passes as fixable if *any* descendant carries a date, but three had mostly
  undated descendants and the roll-up would have dragged the stored date backwards by 40–337 days:
  `1.1.1` Milestone (16/19 dated), `1.1.1.2` **SA-3 Milestone** (12/15) and
  `1.1.3.7.16.1.1.1.4.4.1` Turn Over from STR – ABWF (**2/15**). On the two milestones the undated
  descendants include *"Substantial / Practical Completion incl. Partial Occupancy Permit"*, so the
  stored 2025-10-30 may be the only record of the SA-3 contractual date. Same trap as the 14, one
  level subtler. **Left for a planner.**
- **Applied — 4 rows, `end_date` only, one row at a time, each pre-checked to still hold the exact
  expected value before writing** (a mismatch would have aborted the whole run):

| id | wbs | name | end_date before → after |
|---|---|---|---|
| 2109e622-ac2f-466c-9a69-fff89393d318 | 1.1.3.7.14.1.1.3.1 | Permits | 2024-08-28 → 2024-07-19 |
| 788017d5-9296-406f-97fa-0a7f0bcaf3d3 | 1.1.3.7.17.7.2 | Transformer, Main VCB and Switchgear Room | 2023-09-30 → 2023-07-01 |
| 7f1846a2-41bb-46d3-883d-e09b71e73bf3 | 1.1.3.7.17.7.2.1 | ABWF Works | 2023-09-30 → 2023-07-01 |
| 079407be-aaa2-4a33-a51d-c31c59ea7bd9 | 1.1.3.7.14.2 | Waterproofing of Decks | 2025-03-15 → 2025-01-14 |

  All four had **fully-dated descendants** (2/2, 2/2, 2/2, 29/30), so nothing was inferred from
  absent data. `start_date`/`bl_start`/`bl_finish` were untouched (all four rows carry NULL baselines).
- **REVERSE (paste into the browser console on a signed-in page to undo):**
```js
await __sb.from('project_schedule').update({end_date:'2024-08-28'}).eq('id','2109e622-ac2f-466c-9a69-fff89393d318');
await __sb.from('project_schedule').update({end_date:'2023-09-30'}).eq('id','788017d5-9296-406f-97fa-0a7f0bcaf3d3');
await __sb.from('project_schedule').update({end_date:'2023-09-30'}).eq('id','7f1846a2-41bb-46d3-883d-e09b71e73bf3');
await __sb.from('project_schedule').update({end_date:'2025-03-15'}).eq('id','079407be-aaa2-4a33-a51d-c31c59ea7bd9');
```
- **Verified after:** all four re-read at their new values; the 3 risky rows + a sample trap row
  confirmed **unchanged**; WCB363 row count **20,716 before and after**; no other project touched.
  `projects.schedule_finish` for WCB363 is **2025-12-21, unmoved** (the corrections all pull dates
  *earlier* and none was the project max).
- ⚠️ **Traps for anyone repeating this:** the anon key has zero grants, so a headless agent cannot
  read this table at all — it must run in a signed-in browser session. And the PostgREST root
  endpoint 401s that key while returning a body that parses to `{}`, which reads as "nothing exists";
  every probe here was gated with a known-present AND a known-missing table (`PGRST205`) to tell a
  real empty result from a silent auth failure.
- **Still open:** DEMO01's 74 rows (needs a decision, not a cleanup); the 14 WCB363 traps; the 3
  milestone/turn-over rows above; and the ~52,700 summary rows that are simply NULL — empty, not
  stale, and populating them is a separate product decision.

## DEMO01 schedule cleared (2026-08-17) — fmlozano
Owner: *"let's just clear the DEMO01 project schedule since this is just a demo project."* Checked the
target before deleting rather than taking the description on trust — and it held up:
- `projects.name` = **"Demo Project (sandbox)"**; all **6,017** rows created in ONE burst on
  2026-07-11; content is a **copy of Avesta** (Tower 1–5 Topping Off, 4,393 activities — AVR101's
  exact count). **0** schedule_baselines / resource_assignments / activity_steps /
  weekly_commitments / cash_flow_settings, and **0 `wbs_nodes`**.
- ⚠️ That last one mattered: with nodes present, deleting schedule rows alone would have let
  `_wbsEnsureSummaries()` re-project a summary row per surviving node on the next load — the
  documented 2026-07-17 "Clear did nothing" bug. With 0 nodes the trap does not apply here, but
  **any future clear must drop `wbs_nodes` too** (that is what the module's own Clear does).
- Deleted in keyset batches of 500 (a single 6k-row delete can statement-timeout), with the safety
  facts **re-asserted immediately before the delete** — it would have aborted if the project name had
  stopped saying "sandbox" or if `wbs_nodes` had become non-zero, rather than deleting under a stale
  premise. **6,017 → 0.**
- Also zeroed `projects.schedule_activities/_progress/_start/_finish` for DEMO01: the cached roll-up
  still read **4,393 activities / 12%**, which the Portfolio and dashboard read, so an emptied project
  would have kept advertising a schedule. The `projects` row itself is untouched.
- **Verified:** DEMO01 0 rows, **AVR101 untouched at 6,016**, project row still present.
- ⚠️ **NOT reversible** — no backup table is creatable from the browser session (DDL needs a key this
  environment does not have) and 6,017 rows cannot be exported through it. Accepted deliberately: it
  is a sandbox copy of Avesta and is reconstructible by re-importing. Do NOT apply the same reasoning
  to a real project.
- This also moots the **74 flagged DEMO01 summary rows** from the stale-dates investigation.

## WCB363 stale-date work: CLOSED, remaining rows deliberately not fixed (2026-08-17) — fmlozano
Owner's call: drop the remaining WCB363 fix. Recording it so nobody reopens it as an oversight.
- **Not being changed (17 rows), by decision, not by omission:**
  - the **14 traps** — descendants exist but carry no dates, so the min/max roll-up computes NULL and
    would ERASE each row's only stored date (mostly `1.1.3.12.*` "Tender Award / LOA Signed --- TBC");
  - the **3 mostly-undated rows** — `1.1.1` Milestone (16/19 descendants dated), `1.1.1.2` **SA-3
    Milestone** (12/15) and `1.1.3.7.16.1.1.1.4.4.1` Turn Over from STR – ABWF (**2/15**). Their
    undated descendants include *"Substantial / Practical Completion incl. Partial Occupancy
    Permit"*, so the stored 2025-10-30 may be the only record of the SA-3 contractual date. Rolling
    them back 40–337 days is a commercial judgement, not a data fix.
- ⚠️ **The 4 rows already corrected earlier today STAY corrected** — dropping the remaining work does
  not revert them. They were the fully-dated cases (2/2, 2/2, 2/2, 29/30), so nothing was inferred
  from absent data. Reverse statements are in the entry above if they are ever to be undone.
- ⚠️ **These rows will keep showing as "disagreeing" in any future scan.** That is expected. Anyone
  re-running the stale-date measurement should treat WCB363's 17 as a known, reviewed exclusion
  rather than a fresh finding — and must NOT bulk-fix them.
- The Gantt does not read these columns any more (spans roll up from descendant activities), so the
  stale values are cosmetic at source; they only mislead someone querying the table directly.

## BL0 rails didn't line up with their bars: the baseline fallback was inventing them (2026-08-17) — fmlozano
Owner, AVR101 grouped by WBS with colours on: on the upper summary rows (Execution Phase,
General Requirements, Construction Phase, Tower 1, Structural Works, Substructure, Earthworks) the
blue rail spans nearly the full pane while the coloured bar sits well to the right of it.
- ⚠️ **ROOT CAUSE: the fallback pass in `rebuild()` seeded `_blSpanMap` from the SUMMARY ROW'S OWN
  stored `bl_start`/`bl_finish` whenever its descendants had no baseline** — and a WBS-summary row's
  stored dates are stale imported data that nothing in this module recomputes, routinely spanning
  the whole project. Worse, `_mergeSpan` merged that stale value into **every ancestor code**, so one
  un-baselined branch pushed a pane-wide rail onto Earthworks *and* Substructure, Structural Works,
  Tower 1, Construction Phase and Execution Phase — exactly the seven rows reported. Measured in the
  harness: **rail x=0 w=2922px beside a bar x=118 w=122px.**
- ⚠️ **The hypothesis in the brief was half right and the half that mattered was different.** The
  rail does NOT derive from a differently-scoped roll-up: pass 1 of `_blSpanMap` already rolls up
  descendant leaf activities only, on the same tree walk as `_spanMap` (both were fixed earlier the
  same day). Rail and bar agreed on **every branch whose work carries a baseline**. The disagreement
  came only from the fallback, which is not a roll-up at all — it is the summary row's own row data.
  So "the two marks derive from different spans" was true only for un-baselined branches.
- **Basis chosen, explicitly:** the rail is **`bl_start`/`bl_finish` rolled up over exactly the
  descendant leaf activities the bar rolls up** — the planned dates for the same activity set. The
  bar uses `dispStart`/`dispFin` for that set (actual → forecast → planned), which is the only
  correct pairing, because baseline has no actual/forecast variant: comparing a planned baseline to
  a planned current date would never show slip, which is the entire point of the rail. Where a
  descendant has no baseline it contributes nothing to the rail and still contributes to the bar —
  correct, and it is why a rail can legitimately be narrower than its bar.
- **Fix: the baseline fallback is deleted outright.** No descendant baseline → `_blSpanMap` has no
  entry → `wbsBlSpan` returns null → `ganttRowHTML` omits the rail. A missing baseline now renders
  as **no rail**, never a bogus one.
- ⚠️ **Scope creep considered and REVERTED.** I first also restricted the CURRENT-span fallback so an
  empty branch could not widen a real ancestor. It measurably broke bracket nesting (`check-sumspan`
  went red: a child bracket ended up outside its parent), so it was reverted. A parent bracket must
  contain its children, and an empty branch's own stored dates are the only information about it —
  that they may be stale is the documented **data** problem, not a render one. Only the baseline half
  changed; a comment now says why the two passes are deliberately asymmetric.
- **All three rail sites checked and consistent:** the activity bar and the milestone diamond read
  `r.bl_start`/`r.bl_finish` off their own row (nothing to roll up), and the grouped-mode roll-up
  (`addBlSpan` in `buildNodes`) only ever accumulates from activities and has no summary-row fallback
  — so neither needed a change, and neither can reproduce this.
- **Verified by EXECUTING the shipped code**, nothing under test stubbed: `rebuild`, `wbsSpan`,
  `wbsBlSpan`, `_sumSegsHTML` and `ganttRowHTML` sliced verbatim out of index.html, with real pixel
  geometry read back out of the emitted HTML (`scratchpad/check-blrail.js`, 14 checks). ⚠️ **BEFORE
  /AFTER: the same suite run against HEAD fails 6 of 15** — including the literal screenshot
  (pane-wide rail beside a short bar) — and passes 14/14 after. Existing suites green: sumspan 22,
  baseline-lsm, transpose, grouprollup. Parse clean; **function-set diff vs HEAD: 0 lost, 0 added.**
- ⚠️ **`scratchpad/check-sumspan.js` had ONE assertion changed**, and it is worth flagging: it
  required the empty branch to inherit its summary row's stored baseline — i.e. the suite encoded
  the defect as expected behaviour. It now asserts no rail. Everything else in that file is untouched.
- ⚠️ **NOT verified signed-in** — no authenticated session is possible from this environment, so
  AVR101 was not opened; the reproduction and the fix are both measured in the harness against the
  shipped functions.
- ⚠️ **Still open (data, unchanged):** WBS-summary rows keep stale `bl_start`/`bl_finish` in the
  database. Nothing reads them for the rail any more, but they are still wrong at source.
- `MODULE_V` → `20260817v`.

## Gantt presentation pass: red confined to progress, inert track, legend rewritten (2026-08-17) — fmlozano
Owner, on AVR101 grouped by WBS with colours on. Three things, one commit, kept separate from the
rail fix above.

**1. "Red means progress" — the rule, and the tension the owner correctly spotted.**
The owner's own words: *"Let's try the red mean progress and only progress. But this will overlap
the planned vs actual per activity difference."* That is real, so here is the rule actually adopted,
which holds across all three row kinds instead of only one:
> **Progress is always the SOLID portion of the row's own tone, over a PALE version of that same
> tone. Red is the progress colour in the plain view only, where it is the row's tone at BOTH
> levels; in the coloured view the row's tone is its trade colour and red never appears at all.**
- **Plain (colours-off) view: byte-identical, deliberately.** There red already means progress on
  both the activity bar and the summary bracket — internally coherent, and the owner has not
  complained about it. Asserted: `.ps-sum-fill`'s default is still `var(--ps-prog,var(--pd-red))`
  and every new rule is scoped under `.ps-lsm`.
- **Coloured view: red is gone from summary rows entirely.** Five stacked branch-of-branches rows
  (Execution Phase › Construction Phase › Tower 1 › Structural Works › Substructure) were drawing
  five near-identical saturated red slabs in a view where red means nothing anywhere else, competing
  with the activity bars and the composition bands for the eye. They now render as a quiet
  structural bracket: pale neutral track, solid neutral for the completed portion.
- ⚠️ **NOTHING was removed.** The roll-up % is still emitted as the fill (same width), still in the
  bar label, still in the tooltip — asserted individually. This is about visual weight only.
- ⚠️ **A single-trade GROUP still fills in its own trade colour**: it sets `_fillStyle` inline via
  `catStyle`, and an inline style beats the new CSS var. A mixed group stays neutral. Both asserted.
- ⚠️ **First cut was inverted and the screenshot caught it.** I kept the bracket dark and made the
  fill a translucent white, so the DONE portion rendered *paler* than the remaining portion —
  backwards against every other row on the chart. Track and fill were swapped; there is now an
  assertion in both themes that the solid tone's alpha is more than twice the track's.

**2. The uncovered stretch of a band-carrying bracket is now inert.**
It used to show the bracket's own solid structural colour, so a gap meaning "nothing is scheduled
here" looked identical to a gap meaning "the data is wrong" — which is precisely what made the Mat
Footing bug hard to spot. `.ps-sum-comp` gets a faint hatched track, so the bands are the only
coloured thing on the row. ⚠️ **Which rows draw composition is UNCHANGED** — a branch containing
another branch still draws none (the deliberate 2026-08-17 altitude fix); asserted.

**3. Legend rewritten — "still to do" was wrong, and two chips clashed.**
- ⚠️ The owner read "still to do" as a forecast. It is not. A row encodes **three separate things**
  and the wording now keeps them apart: **the rail** = BL0 planned dates; **where the bar sits** =
  the current/forecast dates (a started activity's right edge *is* the forecast finish, `dispFin` →
  `forecastFin` off the data date); **the fill inside the bar** = progress, solid = done, pale =
  **remaining** (100 − percent_complete). The pale part is remaining *work* inside the current
  dates, never a forecast date — the forecast is already expressed by where the bar ends. Chip:
  `Activity (solid = done, pale = remaining · bar = forecast dates · rail = planned)`, with the
  fuller three-part explanation in the `title`.
- ⚠️ **The two chips did clash and are now folded.** `Planned dates (BL0 baseline)` and the bar
  sample both named the rail. The standalone BL0 chip goes back to `.lg-lsmoff`: in the coloured
  view the bar sample already draws *and* names the rail, so it is the single statement there; in
  the plain view the standalone chip is the only one, so it stays. Nothing lost in either view.

**Theming.** All three new tones (`--ps-sumprog`, `--ps-track`, `--ps-trackln`) are **plain CSS
vars** defined in both the light and the dark block — not inlined at render time — so they follow a
theme flip with no JS and need nothing from the existing `MutationObserver`. Asserted for each var
in both blocks, and confirmed visually in both themes.

**Verified.** `scratchpad/check-present2.js`, **29 checks**, executing the shipped `ganttRowHTML`
(sliced verbatim) for emitted classes/geometry and asserting the CSS + legend against index.html
itself. All six other suites green (blrail 14, sumspan 22, baseline-lsm, transpose, grouprollup);
parse clean; **function-set diff vs HEAD: 0 lost, 0 added.**
- **Screenshots** at 1440px from a gitignored `_ui_test.html` built from the module's REAL `<style>`
  block + rows emitted by the REAL `ganttRowHTML`, in both themes:
  `scratchpad/gantt-before.png`, `gantt-after.png`, `gantt-after-dark.png`. Harness deleted, server
  killed, PNGs kept.
  ⚠️ **The browser tool's screenshot times out here (the documented stalled compositor)** — these
  were taken with **headless Edge** (`msedge.exe --headless=new --screenshot`), which works.
  ⚠️ Two harness traps, both caught by a sanity gate rather than by eye: the shared
  `assets/css/dashboard.css` must be linked or every `--pd-*` token (including the `--pd-red` that
  `.ps-sum-fill` falls back to) is unresolved and every measurement is meaningless; and
  `ganttRowHTML`'s second argument is a **row INDEX**, not a pixel top — passing pixels stacked
  every row 34x too far down and only the first row appeared.
- ⚠️ **`scratchpad/check-baseline-lsm.js` has two assertions updated** — the legend wording, and the
  BL0 chip being `.lg-lsmoff` again. Neither is a regression; both are this pass's intent.
- ⚠️ **NOT verified signed-in** — no authenticated session is possible from this environment.
- `MODULE_V` → `20260817w`.

## Option C: the trade composition moved OUT of the bracket into a strip beneath it (2026-08-17) — fmlozano
Owner: *"The varying colour within the same bar is causing confusion. For example under Earthworks it
shows grey then green… same with Substructure."* A leaf branch's bracket drew **one band per
descendant activity, each in that activity's own trade colour**, INSIDE the bracket. Earthworks holds
both MEPF (grey) and Structural (green) work, so the bracket showed grey bands then green bands and
read as *a single bar changing colour along its length* rather than as *several activities inside one
branch*. Owner picked Option C over four alternatives: **the bracket becomes one plain structural
mark, and the bands relocate to their own thin strip below it** — two rows of meaning instead of one
overloaded bar.
- **The bracket.** `.ps-sum` is now a single plain mark on every summary row alike: pale
  `--ps-track`, solid `--ps-sumprog` for the rolled-up %. Leaf branches stop being a different *kind
  of object* from their parents, which is half of why the row read as one confusing bar.
  `#ps-view-schedule.ps-lsm .ps-sum:not(.ps-sum-comp):not(.ps-sum-gcat)` lost its `:not(.ps-sum-comp)`.
- **The strip.** New `.ps-sum-strip`, a SIBLING of the bracket at the same `left`/`width`. The band
  maths in `_sumSegsHTML` is **completely untouched** — same dates, same greedy lane-packing, same
  `LANE_CAP 5`, same colours, same per-band tooltips — because the coordinates were already relative
  to `barX`, which is the strip's left edge too. Only the box they land in changed.
- ⚠️ **THE ROW DID NOT GET TALLER; the bracket got THINNER.** The 13px comp bracket existed only so
  the bands inside it were readable, and they are not inside it any more. Final geometry (the numbers
  are the point, given the earlier "what is the thickness buying?" complaint):

  | | bracket | strip | rail | bottom | ROWH |
  |---|---|---|---|---|---|
  | comfortable, BEFORE | 8→21 (13px) | — | 22→27 | 27 | 34 |
  | comfortable, AFTER | 8→16 (**8px**) | 17→25 (8px) | 26→31 | **31** | 34 |
  | compact, AFTER | 6→14 (8px) | 15→21 (6px) | 22→26 | **26** | 27 |

  `sumH` in `ganttRowHTML` is `_segs ? 8 : 9` and must stay equal to the CSS (`.ps-sum` 9px /
  `.ps-sum.ps-sum-comp` 8px) — the JS reads that number to stack the two marks below it.
- ⚠️ **Three marks now compete for the space under the bracket; the stacking order is FIXED and
  documented in the code:** bracket → strip → **rail last**. The rail stays the bottom-most mark on
  *every* row kind, comp or not, so "the rail is the thing furthest from the bar" is a rule the eye
  can rely on. 1px of clear air between each. Strip vs rail cannot be confused: the rail is 5px,
  rounded, bordered, `--ps-bl` blue, `opacity:.7` and titled "Baseline (roll-up)"; the strip is
  square, unbordered, inert-hatched, `pointer-events:none` and carries no title of its own. Asserted
  both ways, including that they never overlap vertically.
- ⚠️ **THE INERT TRACK: the owner's grey was PARTLY it, and it does still earn its place — but not
  where it was.** Added earlier today to `.ps-sum-comp`, it filled every stretch of the bracket that
  no band covered with a faint grey 45° hatch — on exactly the rows that also carry grey MEPF bands.
  So one bracket could show, left to right: hatched grey (inert), grey (MEPF), green (Structural),
  pale grey (remainder) — four tones, three meanings, one bar. **Verdict: keep it, move it.** Once
  composition leaves the bracket the bracket has no "uncovered stretch" to explain, so the track has
  no job there; the STRIP does have gaps, and a gap meaning "nothing is scheduled here" must not look
  like a gap meaning "the data is wrong" (exactly what made the Mat Footing bug hard to spot). It now
  lives on `.ps-sum-strip` only. It cannot be read as a grey trade band: hatched, far fainter, and
  with **no inset outline** — every real band has one (`.ps-sum-seg`'s box-shadow).
- ⚠️ **INFORMATION WAS ADDED BACK, not removed.** The roll-up %-fill used to be *suppressed* on a
  band-carrying bracket (the bands sat on top of it and described progress twice). With the bands
  gone from the bracket the suppression is dropped, so a leaf branch now draws its duration-weighted
  roll-up % like every other summary row instead of carrying it only in the label and the tooltip.
  Bar label, bracket tooltip and per-band tooltips all asserted individually.
- **Which rows draw composition is UNCHANGED.** A branch containing another branch still draws none
  (the deliberate 2026-08-17 altitude fix) — no strip either, and its bracket stays the plain 9px
  one. Asserted. **The plain (colours-off) view is byte-identical**: `_segs` is `''` with colours off,
  so no strip, no `.ps-sum-comp`, rail still at `sumTop + 9 + 1`, `.ps-sum-fill` still red.
- **Theming.** The strip uses `--ps-track`/`--ps-trackln` only — **plain CSS vars already defined in
  both the light and the dark block**, nothing inlined at render time, so it follows a theme flip with
  no JS and needs nothing from the `MutationObserver` that drops the colour caches. Asserted that the
  strip's inline style contains geometry and no colour at all; confirmed in both themes visually.
- **Verified by EXECUTING the shipped code**, nothing under test stubbed: `rebuild`, `wbsSpan`,
  `wbsBlSpan`, `_buildSegMap`, `_sumSegsHTML`, `ganttRowHTML` and the whole
  `catEntry`/`catTint`/`catStyle` chain sliced verbatim out of index.html. `scratchpad/check-optc.js`,
  **38 checks** on emitted geometry and classes, at both densities. ⚠️ **BEFORE/AFTER: the same suite
  against HEAD fails 17 of 38** — including the literal complaint, measured: the Earthworks bracket's
  own body contained
  `["rgba(110,110,110,0.32)","#6e6e6e","rgba(0,176,80,0.32)","#00b050","rgba(255,255,255,.55)"]`,
  i.e. **five colours inside one bar**; after, the bracket body carries **at most one**.
- **Other suites green:** sumspan 22, blrail 14, present2 30, baseline-lsm, transpose, grouprollup.
  Parse clean (1 block); **function-set diff vs HEAD: 0 lost, 0 added.**
- ⚠️ **`scratchpad/check-present2.js` has three assertions changed and they are this pass's INTENT,
  not regressions** — the fill is no longer suppressed on a comp bracket, the inert track is asserted
  on `.ps-sum-strip` instead of `.ps-sum-comp`, and the pale-track rule no longer excludes comp rows.
- ⚠️ **A HARNESS TRAP that produced ten confidently wrong failures on the first run:** matching the
  bracket with `class="ps-sum[^"]*"` also matches **`ps-sum-strip`**, and the strip is emitted
  *before* the bracket — so every geometry reading came off the wrong element. The matcher now
  requires an exact class token (`ps-sum(?: [^"]*)?`). The same trap will bite anything that greps
  this markup.
- **Screenshots** at 1440px from a gitignored `_ui_test.html` built from the module's REAL `<style>`
  block + rows emitted by the REAL `ganttRowHTML`, taken with **headless Edge** (the browser tool's
  screenshot still times out here): `scratchpad/optc-before.png`, `optc-after.png`,
  `optc-after-dark.png`. Harnesses deleted, PNGs kept. Before shows Substructure as one bar carrying
  orange, green, blue and hatched grey; after, a neutral bracket with a thin coloured strip under it.
- ⚠️ **NOT verified signed-in** — the anon key has no grants on `project_schedule`, so AVR101 was
  never opened from here. Everything above is measured against the shipped functions in Node and in a
  real browser rendering the shipped CSS.
- ⚠️ **Left open.** (1) `LANE_CAP` is still 5 against an 8px strip, so a five-lane row gives ~1.6px
  stripes — deliberately unchanged (identical lane packing was a requirement), but 4 lanes would
  probably read better and is worth putting to the owner. (2) `scratchpad/check-present.js` fails 12
  checks **and fails them identically on HEAD** — a stale suite for a "Presentation mode" that is not
  in the file; not touched, not caused here. (3) The strip is `pointer-events:none`, so its per-band
  tooltips are emitted but never shown — the same as before this change; enabling them would need
  `.ps-sum-strip` added to the Gantt click delegate's `closest()` list first, or a click on a band
  would deselect the row.
- `MODULE_V` → `20260817x`.

## Discipline/Trade groups sort in construction order (2026-08-18) — fmlozano
Owner asked for Gen Req → Site Works → Structural → Archi → MEPF → Allied Services → Others.
- ⚠️ **`WORK_ORDER` already existed but was missing half the vocabulary** — it listed only
  `structural / architectural / mepf / allied / site development`, so **General Requirements was
  unranked and fell to the END** (an unranked value sorts after every known trade), and Site Works
  was ranked after MEPF rather than second. That is the reported order, from four missing strings.
- Each trade is now listed under **both spellings it can reach the grid by**: the canonical
  `WORK_CANON` label written by imports and the discipline wizard (`Structural Works`) and the
  Schedule Builder's short `GLABEL` (`Structural`). GWORK is supposed to merge those into one bucket,
  but a project pushed before that fix still holds the short label — and an unranked value silently
  falls to the end, which is exactly the failure this list exists to prevent.
- **Verified against the SHIPPED `cmpWorkName`** (sliced out and executed, not reimplemented):
  canonical labels sort to the owner's order, short builder labels sort to the same order, an unknown
  trade still lands after the known ones but **before** the blank "— No discipline/trade —" bucket,
  and matching stays case/whitespace-insensitive. Parse clean (1 block, 0 fail).
- ⚠️ **Not verified signed-in.** `MODULE_V` → `20260818e`.

⚠️ **CLOSED 2026-08-18 (see the entry below) — duplicated WBS rows after a Schedule Builder push.**
Original note, kept for the reasoning it rules out: Screenshot
shows General Requirements / Site Works / Allied Services each rendered **twice** with identical dates
and %, while Structural / Architectural / MEPF appear **once**. Investigated, not reproduced; recording
what has been ruled OUT so the next pass does not redo it:
- **Not the skeleton.** `WBS_SKELETON` is Milestones / Initiation / Planning (+3 children) / Execution /
  Closeout — it contains no trade names, so a push cannot collide with a seeded node.
- **Not `buildTree` emitting two buckets per trade.** `dimKey('trade')` returns `l.trade`, so one
  bucket per distinct trade code per push.
- **The 3-of-6 split is the real clue** and is unexplained: GR / SW / ALLIED duplicate, ST / AR / MEPF
  do not. Worth checking next: whether the project was pushed twice (each push inserts a fresh
  `wbs_nodes` row per trade — `ensureNode` keys on `'N'+(++nodeSeq)`, so it dedupes **within** one push
  and not across pushes), and whether the `wbsOk === false` fallback ran, since that path writes dotted
  summary rows with **no `wbs_node_id`** — and `_wbsEnsureSummaries`' duplicate heal keys on
  `wbs_node_id`, so it cannot see or heal those.
- ⚠️ Needs a live query of `project_schedule` + `wbs_nodes` for that project (`wbs`, `wbs_node_id`,
  `created_at` per duplicate pair) — `created_at` clustering will immediately say "two pushes" vs "one
  push wrote two rows". The anon key has no grants, so it must run in a signed-in browser session.

## Duplicate trade branches, per-level-type trade sequencing, and the grouped roll-up (2026-08-18) — fmlozano
Three owner asks in one prompt. All in `modules/project-schedule/index.html` (module-local, no migration).

### 1 · The doubled trades from Schedule Builder → Project Schedule (the OPEN item above, now closed)
Two independent causes, both fixed; the 3-of-6 split that made the report look impossible is explained.
- ⚠️ **The grouped push was never idempotent.** `ensureNode` keys on `'N'+(++nodeSeq)`, so it dedupes
  **within** one push and not across pushes — every re-push (normal after fixing durations or adding a
  trade) inserted a **fresh `wbs_nodes` row per trade / floor / zone / unit**, i.e. a whole second copy
  of the tree. Those duplicates are invisible to `_wbsEnsureSummaries`' heal, which keys on
  `wbs_node_id` and sees each duplicate node as legitimately un-projected. The push now looks for an
  existing child of the same parent with the same name (`existingChild`, earliest `created_at` wins),
  **reuses** it, and — critically — **suppresses that node's WBS-Summary payload**, because the
  survivor already has one and writing another is the exact "two rows for one `wbs_node_id`"
  duplication.
- ⚠️ **The trade branch was named with the WRONG one of two labels, and that is the 3-of-6 clue.**
  `dimName('trade')` used `GLABEL` ("Structural") while the activities' `work_type` used `GWORK`
  ("Structural Works"), so the same trade was reachable under two names. For **GR / Site Works /
  Allied Services the two labels are byte-for-byte identical** — those read as a duplicated row; for
  ST / AR / MEPF they read as two differently-named rows, which is why exactly three of six "looked
  duplicated". `dimName` now returns `GWORK`, so a builder branch and an imported/wizard-tagged branch
  land on one name.
- ⚠️ **The duplicate-branch heal was restricted to `is_locked` skeleton nodes**, so it could never
  touch builder branches — projects already carrying duplicates stayed broken. `_wbsDedupeSkeletonPass`
  now merges **any** same-name siblings (blank names skipped — every unnamed sibling would key alike).
  Merging is lossless: children, activities and summary rows are re-pointed onto the survivor before
  the duplicate is deleted, and the fixed-point loop already collapses a whole duplicated subtree in
  one call. It now **toasts what it merged** — it changes the tree, so it must not be silent.
  (`_clearWbsTree`'s `is_locked` filter is unrelated and untouched.)

### 2 · Step 4 Trade sequence — per level type, with copy
A basement is not sequenced like a typical floor, so the class-code sequence is now definable **per
floor category** (Basement / Podium-Commercial / Typical / Roof Deck — the `KIND_ORDER` the auto-trace
takt questions already use).
- `cfg.actLinks` stays the **default**; `cfg.actLinksKind[kind]` is an optional override, present only
  once the planner actually edits that category. **A project that never touches this reads and writes
  exactly the same data as before.**
- New **Level type** row in step 4: All levels (default) + every category the project actually builds,
  each badged `own` when it has forked. Selecting a category **shows** the default (reading never
  forks — clicking a tab must not make the setup dirty); the **first edit** forks a copy so the default
  is never edited by accident. One click reverts a category to the default.
- **Copy sequence from…** copies **one trade's** links from any other defined category (or from the
  default), replacing only that trade's links in the target and leaving every other trade's alone.
- Every step-4 read/write now goes through `AL()` / `AL(true)` — the flow diagram, the trade Gantt, the
  totals, Auto-chain, Clear links and the tabular Links manager (whose title names the category).
- ⚠️ **`generate()` and the push resolve the sequence per LOCATION**, via `linksForLoc(loc)` →
  `floorKind(loc.floor)`, so the generated dates AND the pushed predecessors describe the same logic.
  The un-located "whole project" placeholder (`floor._all`) has no category and follows the default.

### 3 · Project Schedule: the lowest level of detail names the line item, and the roll-up is scoped
- **New `locSuffixOf(r, dims)`** — the level / zone / unit an activity carries that the **current
  grouping does not already state**, appended to the leaf row: "Precast Works · B3 - Z1 - U1". A level
  that IS a grouping dimension is a heading above the row, so it is subtracted rather than repeated.
  Wired into all three leaf paths (plain WBS view subtracts nothing — it groups by nothing). The
  repeated-name WBS-parent qualifier survives as the **fallback** for rows with no location.
- ⚠️ **The deepest-bucket-of-one merge no longer throws the activity name away.** It set
  `_dlabel = <bucket value>`, so the merged row read "U1" where the planner needs "Precast Works
  B3 - Z1 - U1" — and that row is the *only* row for the leaf, so the name was gone from the schedule.
  It now keeps the name and carries the bucket's identity in the suffix (its own dimension included,
  since this row replaced its heading; shallower dimensions are still headings and are subtracted).
- ⚠️ **The roll-up on a branch inside a grouped view mixed two scopes.** `wbsSpan` reads the
  display-scoped `_dspan`, but `%`-complete / status / IBB / cost read `_costMap`, which is keyed by
  dotted WBS code and always covers the branch's **whole subtree** — so a branch reported 400
  activities' progress beside 12 activities' dates. New **`_dcost`**, built in `buildNodes` from
  exactly the rows emitted under each display code with the same arithmetic and the same weights as
  `_costMap`, and new **`cmOf(nd)`** which prefers it. Wired into the cost/POC cells, the rolled-up
  status pill (now takes the roll-up object, not a code), the Gantt bracket %, and the Progress
  table — where group rows had no dotted code at all and therefore always showed **0 %**.
- ⚠️ **The BASELINE roll-up was accumulated in only one of the two leaf branches**, so any grouping
  ending in `wbs` left every branch and group row above it with blank BL Start / BL Finish and no BL0
  rail. `addBlSpan` now runs in both.

### Verification
- **46 behavioural checks green in Node against the SHIPPED functions** (sliced out of `index.html` by
  their exact source text and executed, never reimplemented): `locSuffixOf` across every
  grouping/location combination incl. the owner's example string and the LOC_LEVELS ordering; `cmOf`'s
  scoped-vs-global precedence and its fallback; the level-type fork/inherit/no-fork-on-read rules,
  `kindsInProject`, `locKind`, and `copyTradeSeq`'s trade isolation in both directions; `actOffsets`
  proving a basement's own all-parallel sequence spans 5 days where the default FS chain spans 15, with
  roof and un-located work still inheriting; `dimName`'s canonical trade label; `existingChild`'s
  case/padding-insensitive, earliest-wins, parent-scoped reuse; and that the dedupe filter no longer
  mentions `is_locked`. Inline script parses (1 block, 0 fail).
- **Loaded in a real browser** (local static server): the module initialises with **0 console errors**
  before redirecting to sign-in.
- ⚠️ **Not verified signed in on a project.** The three things that need it: a re-push actually merging
  into the existing branches, the heal's toast firing on a project that already holds duplicates, and
  the grouped roll-up numbers read off the live grid.

## Live test on AVR101 of the 2026-08-18 changes (2026-08-18) — fmlozano
Owner asked for a live test. Run **signed in as the owner on the deployed GitHub Pages build**, against
Avesta Residences (AVR101, 4,393 activities / 1,623 WBS nodes), querying Supabase from the page for the
data-level checks. What passed, what could not be tested there, and one thing this run *disproved*.

### Passed live
- **No duplicated trade branches on AVR101, and the widened heal does not over-merge.** Queried the
  whole tree (paged past PostgREST's 1,000-row cap): **1,623 `wbs_nodes`, 0 duplicate (parent, name)
  sibling groups, 1,623 `WBS Summary` rows, exactly one per `wbs_node_id`, 0 rows with a null
  `wbs_node_id`.** ⚠️ **The two "General Requirements" nodes are NOT duplicates** — one sits under
  `Execution Phase`, the other under `Planning Phase › Procurement › Work Package Awarding › Tower 1 +
  Gen Req***`. Different parents, so the (parent_id, name) key correctly leaves them alone. That is the
  case that would have been destroyed by keying the heal on name alone.
- **The location suffix renders, and says what the grouping does not.** Grouped by Discipline/Trade
  (no location level), leaf rows read `Formworks · Bridge`, `Concrete, 3000 psi · Road Pavement`,
  `SUBGRADE (100mm thk) · Sidewalk`, `Material Testing · Testing & Commissioning` — four rows that
  previously all read just "Formworks" / "Concrete, 3000 psi" with nothing to tell them apart.
  4,562 of the 4,393+ rows carry `location` on this project, over levels Tower / Level / Zone /
  Orientation.
- **Step 4's whole per-level-type flow**, exercised end to end (on **BAU101-TEST**, see below):
  the Level type row offers exactly the categories the project builds (`All levels (default) ·
  Basement · Typical`); selecting Basement shows the inherited default and the "first edit forks it"
  hint with **no** reset button; Auto-chain (SS) on Basement forks it — `OWN` badge, "Basement levels
  have their own sequence", reset button appears — and **the default is verifiably untouched**
  (Links modal: Basement `SS, SS` vs All levels `FS, FS`); "Copy Structural sequence from…" offers
  All levels + Basement (never the category being edited) and copying Basement→Typical gives Typical
  `SS, SS`; "Follow the default here" drops the override and Typical reads `FS, FS` again while
  Basement keeps its own. The Links modal title names the level type it is editing.
  **Nothing persisted** — re-read `schedule_builder.config` afterwards: `actLinks` still all `FS`,
  `actLinksKind` still absent, because the builder only writes on **Save setup**.

### Could not be tested on AVR101
- ⚠️ **AVR101 has no `schedule_builder` row at all** — step 4 correctly shows "No trades yet". The
  builder work was therefore verified on **BAU101-TEST** (a sandbox project with 11 class codes,
  7 links, basement + typical floors). Only 6 projects have a builder config: CDP101, MWD101, OPW101,
  BAU101, BAU101-TEST, Test — none of them AVR101.
- **The idempotent re-push and the heal's merge toast could not be observed**, because AVR101's tree
  is already clean and there is no builder setup to push. Both remain code-level only.

### ⚠️ Disproved by this run — do not repeat the claim
- **The baseline roll-up fix makes NO observable difference on AVR101.** The changelog above says a
  grouping ending in `wbs` "left every branch with blank BL Start / BL Finish". Checked live under
  Discipline/Trade › WBS: the new build shows `Site Development (35)` = Jun 26 2026, `Bridge` = Jun 26,
  `Road Pavement` = Jul 13, `Sidewalk` = Aug 6 — all correct roll-ups — **and the pre-change build
  shows exactly the same values.** `wbsBlSpan` falls back to `_blSpanMap[w.wbs]`, and a real WBS row
  always has a dotted code, so the global baseline map already served it. Adding `addBlSpan` to that
  branch is still right (it is what feeds a group row, which has no dotted code), but it is **not**
  a fix for a symptom anyone has seen. Claim it as belt-and-braces, not as a bug fixed.

### ⚠️ RETRACTED — see the entry below; this "freeze" was a test-harness artefact, not a bug
Original note kept for the reasoning it records:
**Grouping AVR101 by `Discipline / Trade › Level` freezes the tab.** The renderer stops responding
(CDP `Runtime.evaluate` times out); at 74 s the grid is still empty with **no console error**, so it is
a compute blow-up, not an exception.
- **Proved pre-existing by a same-origin A/B**: the module as of `22103fc` (before any of the
  2026-08-18 changes) was deployed alongside as `abold.html`, loaded in the same session against the
  same project, and **froze identically on the same grouping**. The temp file has since been removed.
- ⚠️ **Jekyll silently 404s any path starting with `_`** on GitHub Pages — `_ab-old.html` never
  deployed and cost a wasted cycle. There is no `.nojekyll` in this repo. Worth knowing before adding
  any underscore-prefixed path (it also means `modules/_template/` is not served).
- Two red herrings this chase produced, recorded so the next pass does not repeat them: `.ps-row` is
  **not** the grid row class (it is `.ps-grid-row`), and `#ps-grid-rows` stays empty in the **mobile
  card layout** — which the app switches to whenever `innerWidth` is 0, i.e. whenever the Chrome
  window is minimised. Several "0 rows rendered" readings were that, not a hang.

### Housekeeping
`ps_collapsed_AVR101` in localStorage is **1.5 MB** and holds 22 per-grouping collapse maps, one with
8,199 entries. Not touched here beyond removing the `work` key, but it is a lot of state to parse on
every load and is a plausible contributor to the slowness above.

## ⚠️ RETRACTION — there is no "Discipline / Trade › Level freeze" (2026-08-18) — fmlozano
Owner asked me to fix the freeze I reported earlier today. **I profiled it on AVR101 and the freeze is
not real — it was an artefact of my own test harness.** Correcting the record, because the previous
entry sends the next reader hunting a bug that does not exist.

### What the numbers actually are
An instrumented copy of the module (`perf.html`, deployed alongside, since removed) timed every stage
of `doRender` on AVR101 (4,393 activities / 1,623 WBS nodes / 3,672 in the Execution Phase scope):

| grouping | buildNodes | displayList | renderWindow | doRender total |
|---|---|---|---|---|
| WBS (default) | 13 ms | 27 ms | 116 ms | **153 ms** |
| Discipline / Trade | 83 ms | 88 ms | 57 ms | **~150 ms** |
| Discipline / Trade › Level | 119 ms | 128 ms | 74 ms | **209 ms** |
| Discipline / Trade › Level › WBS | 166 ms | 181 ms | 80 ms | **270 ms** |

Inside `buildNodes` the grouped walk is 156 ms of the 166 ms worst case and the pre-work (Execution
Phase carve-out + hide-unassigned) is 5 ms. **Nothing is quadratic and nothing hangs.**

### What I actually saw, and why
⚠️ **The Chrome window the automation drives was MINIMISED**, so `document.visibilityState === 'hidden'`
while `document.hasFocus()` was still true. Two consequences, and between them they produce a perfect
imitation of a frozen app:
- **`scheduleRender()` schedules through `requestAnimationFrame`, which never fires in a hidden tab**,
  and it latches `_rafP = true` first — so the grouping change completed (measured: `setGroupBys` 62 ms
  end to end) and then *no repaint ever happened*. The grid kept showing the previous grouping's rows.
- **Background tabs throttle `setTimeout` to roughly once a minute**, so my in-page polling loops blew
  straight past the 45 s CDP limit and came back as "the renderer may be frozen or unresponsive".
- ⚠️ **The A/B that "proved it pre-existing" proved nothing** — both builds were driven in the same
  hidden tab, so of course both "froze". The A/B conclusion for the *roll-up change* still stands only
  because the roll-up numbers were read from a rendered grid, not from that timing.
- Two more red herrings from the same run, recorded so nobody re-derives them: `.ps-row` is not the row
  class (it is `.ps-grid-row`), and `#ps-grid-rows` only ever holds the **windowed** ~24 rows, so "24
  rows" is the healthy state, not a truncation.

**Lesson for the next live session: check `document.visibilityState` before believing any render-timing
or "nothing rendered" observation.** `hasFocus()` is not enough — a minimised window has focus and is
still hidden.

### One REAL bug found while profiling, and fixed
⚠️ **A saved location grouping silently degrades when `location_levels` comes back empty.**
`loadGroupBys()` → `normalizeGroupBys()` filtered `groupBys` against `allDims()`, which is built from
`LOC_LEVELS` / `CODE_TYPES`. Those fetches are deliberately tolerant ("no table → no levels"), so an
empty registry means *either* "this project has none" *or* "the fetch failed / returned nothing" — and
the filter treated them alike, **deleting every `loc:` level from the planner's grouping**.
- **Seen live on AVR101, twice in one session:** a load where the levels came back empty turned
  `Discipline / Trade › Level` into plain `Discipline / Trade` while localStorage still held the correct
  grouping — so it looked like the app had reset the grouping by itself. Evidenced by the group-button
  text and, independently, by the instrumented build logging `doRender START dims=["work"]` for a stored
  grouping of `["work","loc:<Level>"]`.
  ⚠️ **An earlier version of this note also claimed "the Group menu offered zero location levels". That
  observation was unsound** — the menu is built on OPEN, so querying `button[data-gadd]` without opening
  it returns nothing on a healthy load too. Verified afterwards: with the menu opened on a healthy load
  it offers all four levels. The two data points above are the ones that hold. This is a far better candidate for anything the owner has experienced as
  "the Level grouping doesn't work" than the freeze ever was.
- **Fix:** a `loc:` / `code:` level is only retired when its registry is **loaded** and genuinely lacks
  it; an empty registry keeps the level. Safe, because `dimValOf`/`dimRawOf` resolve a location level
  through `r.location[levelId]` and simply yield no value — and the level comes back intact as soon as
  a load brings the registry back. `wbs`-forced-last, dropping genuinely stale levels, dropping unknown
  plain dims and the `['wbs']` fallback are all unchanged.
- **9 new checks against the shipped `normalizeGroupBys` + `allDims`** (55 total in the harness, all
  green): known level kept; deleted level and deleted activity code both retired; **empty** location and
  code registries both KEEP the saved level; a location-only grouping is not wiped to the `wbs`
  fallback; `wbs` still forced last; unknown plain dim still dropped; all-invalid still falls back.
- ⚠️ **Not verified live** — the trigger is an intermittently empty `location_levels` response, which I
  cannot force from the page. The unit checks cover the branch; the live smoke test only confirms the
  normal path still loads `Discipline / Trade › Level` correctly.

### Not changed, deliberately
`scheduleRender()`'s rAF-only scheduling is what makes a hidden tab never repaint. Left alone: for a
real user the queued frame fires as soon as the window is shown again and the grid paints the current
state, so there is no user-facing defect to fix — only an automation hazard, now documented above.

## Group-by roll-ups, the frozen-column clash, the Task column, and the REAL duplicate-WBS cause (2026-08-18) — fmlozano
Four owner reports in one pass, all reproduced on live data. The duplicate-WBS one took three attempts
to get right and the final cause is not what the first two entries said — read this one, not those.

### 1 · Group rows were blank across every roll-up column
Screenshot: grouped Discipline / Trade › Activity › Level › Zone › Unit, and every group row empty in
Dur / Planned Value % / Activity % / Duration % / Var (BL) and in the Discipline, Level, Zone and Unit
columns — while the same numbers DO appear on WBS rows in the plain WBS view.
- ⚠️ `costCellsHtml()` short-circuited a group row to **nine blank cells**, with the note that its
  members are "scattered across the WBS tree, so the per-WBS-code roll-up map doesn't apply". That was
  true of `_costMap` (keyed by dotted code) and stopped being true when `cmOf()` landed: it reads the
  display-scoped `_dcost`, built from exactly the rows rendered under this group. The short-circuit is
  gone, so a group row reports what a WBS summary reports, over its own bucket.
- Summaries also gained **Dur** (`sumDurCellHtml` — the rolled-up span, which is what the Gantt bracket
  measures) and **Var (BL)** (`sumVarCellHtml` — rolled-up finish vs rolled-up baseline finish). Both
  degrade to an empty cell when there is no span / no baseline, never to a broken one.
- **New `_duni` / `uniOf()`**: the Discipline / Level / Zone / Unit columns on a summary row now state
  the value when **every** activity beneath agrees. Accumulated in the same `addCost` pass, so it costs
  one extra pass over the levels per row. ⚠️ A **mixed** branch stays blank on purpose — a Tower holding
  all trades has no single discipline and printing one would be a lie. Activity Codes and UDFs stay
  blank on summaries: those are per-activity assignments, not roll-ups.
- **Verified live on OPW101**: `Execution Phase (2561)` → Dur 982d, PV 36%; `General Requirements (1)`
  → 960d / 45% / Discipline "General Requirements"; `Structural Works (308)` → 102d / 100%.

### 2 · "Clashing data in the columns … happens when scrolling" — two independent causes
- ⚠️ **The frozen columns were TRANSLUCENT in two row states.** A dark-mode **selected** row painted its
  sticky `c-num`/`c-id`/`c-name` `rgba(238,49,36,.22)` — 22% opaque — so the status pill and the BL dates
  that had scrolled *behind* the name column showed straight through it. That is the doubled text on row
  24 of the screenshot. `.ps-spotrow` (`rgba(37,99,235,.12)`) had the same defect and the
  conditional-formatting rule fell back to `transparent`.
  **Fixed structurally, not rule-by-rule:** `--ps-frozen-bg` carries each row state's OPAQUE base, every
  frozen-cell rule paints that, and a tint is layered as a `background-image`. Identical appearance,
  nothing can bleed through. ⚠️ **Never give a frozen cell a translucent `background` again — layer it.**
  A test now fails if any `.c-num/.c-id/.c-name` rule sets `background: rgba(...)` or `transparent`.
- ⚠️ **The header and the body were built from different column sets.** Measured on OPW101: the header
  carried **29** cells (9 extra columns) while every body row carried **21** (1 extra column), because
  `extraColDefs()` depends on `LOC_LEVELS`/`CODE_TYPES`/`UDF_DEFS` and `renderHeader()` is called from
  ~14 places while the rows come from `renderWindow()`. Column order and hiding are `nth-child` CSS, so
  an 8-column offset puts body values under the wrong headings — and it shifts as you scroll because the
  frozen columns share those `order` values. **`syncGridColumns()`** re-asserts the header + the
  order/hide CSS whenever the column **signature** changes (a signature, not a count, so a reorder or a
  rename is caught too), called from `doRender` before the rows are built.

### 3 · New "Task" column
`['task','Task','c-task']` in `GRID_COLS`, so the Columns menu, hiding, reordering, resizing and the
Excel export all pick it up for free. `taskKindOf()`: **WBS** for a branch or a grouping header,
**Start Milestone** / **Finish Milestone**, else **Task**. A bare `'Milestone'` counts as a start (only a
Finish Milestone is anchored on the finish); `'Task Dependent'` normalises to Task; ⚠️ an unrecognised
P6 type (e.g. `Level of Effort`) is shown **as stored** rather than mislabelled "Task"; and WBS wins
over a milestone type on the same row. Appended rather than inserted mid-list so a saved (positional)
column-sort index keeps pointing at the column it was set on — drag it where you want it.

### 4 · The duplicated WBS rows — the actual cause, found by doing the owner's own workflow
The owner said it happens **when pushing from the Schedule Builder**, and that a one-time cleanup was
not acceptable. Both true. Three mechanisms, in the order they were found:
- **(a) A partial `wbs_nodes` tree.** On OPW101 the five non-locked nodes were written by the push at
  `05:54:13.509–14.314`, the sixth insert failed, and 450 ms later the dotted-code fallback wrote a
  summary row for **every** branch including those five. The next load's `_wbsEnsureSummaries()` saw the
  five orphan nodes as un-projected and inserted a **second** row for each: General Requirements (4.1),
  Site Works (4.2), Allied Services (4.3) and two F1 floors — the owner's original screenshot, and the
  explanation for the "only 3 of 6 trades" clue. The push now **rolls its own partial tree back** before
  falling back.
- **(b) The failure was TRANSIENT, so the rollback alone is not a fix.** The byte-identical insert
  succeeds on demand (probed live on OPW101 and cleaned up). Each node is its own round-trip (~100 ms),
  so a real build is hundreds of them and one blip aborted the whole tree at random.
  **`insertNodeSafe()`** retries three times with backoff and ⚠️ **re-reads before each retry** — a
  failure can be the *response* rather than the write, and a blind retry would create the second copy of
  the very node this fix exists to prevent.
- **(c) ⚠️⚠️ THE ONE THAT ACTUALLY RECURS: dotted codes drift when the tree is renumbered.** A dotted
  `wbs` code is DERIVED from a node's position among its siblings, so inserting nodes renumbers every
  later branch — and nothing wrote the new codes back. The push even documents the gap ("load() heals
  summaries but doesn't re-sync codes"). **Reproduced by doing a real re-push on the BAU101-TEST
  sandbox: 48 of 94 summary rows and 90 of 132 activities were left carrying a stale code, and 18 codes
  were shared by two different branches** — which the grid draws as the same WBS twice. New
  **`_wbsResyncCodes()`** rewrites `wbs` from `wbs_node_id` (the stable identity) for every drifted row,
  grouped by target code so it is one UPDATE per code. A healthy project writes nothing; an imported
  project whose rows carry no node ids is untouched.
- ⚠️ **And (c) made the earlier heal DANGEROUS, which matters more than the resync itself.** Two summary
  rows on one code are *not* necessarily duplicates: if they are backed by **different** nodes they are
  two real branches whose codes merely collided. Deleting one would have destroyed a live branch, and
  `_wbsEnsureSummaries` would re-create it — the pair would flap on every load. `_wbsDedupeSummariesByCode`
  now skips any group with more than one distinct `wbs_node_id`, and the resync runs first so the dedupe
  judges duplicates on correct codes.
- **A re-push must also recognise a branch created under the OLD trade label.** Trade branches are named
  with canonical `GWORK` ("Structural Works") since this morning, but BAU101-TEST holds 58 branches named
  `Structural` / `Architectural` / `MEPF` from an earlier push. Without an alias the reuse lookup would
  miss them and add "Structural Works" as a second branch — a duplicate in every sense that matters even
  though the names differ. `ensureNode` now carries the pre-GWORK name and the lookup falls back to it.

### Verification
- **142 checks green in Node against the SHIPPED functions**, including: `costCellsHtml` **executed** for
  each row kind to prove the cell counts still match (textual counting cannot work — the task branch
  emits three cost cells through one `money()` helper); every `taskKindOf` case incl. WBS-beats-milestone
  and the unrecognised-type passthrough; `syncGridColumns` re-rendering on arrival, disappearance and
  reorder but **not** on an unchanged set; the retry's re-read-before-write ordering and its `.is()`
  null-parent match; and the dedupe guard refusing a two-different-nodes pair while still merging a
  same-branch pair.
- **Live, OPW101:** the same-code heal took 457 summary rows → 452 and 5 duplicate codes → **0**; group
  rows now carry their roll-ups (numbers above).
- **Live, BAU101-TEST — the real end-to-end proof:** an actual Schedule Builder push under `4 Execution
  Phase`, grouped into a sub-WBS. Result: 66 activities / 38 relationships / 36 branches, **no fallback
  warning** (so the node path held), **0** same-name sibling nodes, **94 nodes and 94 summary rows 1:1**,
  **0** rows without a node id, and the pre-GWORK trade names preserved by the alias. Then on the next
  load the resync took code drift **138 → 0** and duplicate codes **18 → 0**.
- ⚠️ **What that push left behind:** BAU101-TEST grew by 66 activities and 36 WBS branches (58 → 94
  nodes). It is the sandbox and the tree is now internally consistent, but clear it if you want the
  pre-test state back.
- ⚠️ **Not verified live:** the retry firing on a real transient failure (it cannot be forced), and the
  rollback path (it needs a genuine mid-tree insert failure). Both are covered by the unit checks only.
- ⚠️ The body rows could not be inspected on the last pass because the automation's Chrome window was
  minimised again — see [[browser-hidden-tab-artefact]]. The header was confirmed to carry the Task
  column; body/header cell parity rests on the unit checks.

## Push dialog, the NOT-NULL warning, the "+" column lane (2026-08-18) — fmlozano
Owner's screenshots, on OPW101.

### 1 · "Assign under WBS" removed — a builder push always files under Execution Phase
It was always set to Execution Phase, so offering the choice only invited a wrong one. The picker (and
its option list) is gone; the parent is resolved at push time by **`execPhaseCode()`**, so a renamed or
re-coded branch still matches, and the dialog states where the push will land. No Execution Phase branch
→ top level, and a throwing resolver degrades to the top level rather than breaking the dialog.

### 2 · ⚠️ The warning names the real cause, and it was NOT the transient failure I assumed
> `null value in column "name" of relation "wbs_nodes" violates not-null constraint`

**One unnamed branch aborted the entire `wbs_nodes` insert loop.** The push then fell back to dotted
codes — which is why the WBS Manager showed **Execution Phase · 0 activities**: nothing carried a
`wbs_node_id`, so the Manager had nothing to count. The retry I added earlier cannot help a constraint
violation, and the earlier entry's "transient blip" reading was wrong for this failure.
- ⚠️ `dimName()`'s `null` returns were *supposedly unreachable*: `buildTree` creates a node only when
  `dimKey()` is not `' '`, and `dimKey` returns `' '` for exactly the cases `dimName` returned `null`
  for (`floor._all`, missing zone, missing unit). **They were reached anyway.** I could not find the
  path by reading — OPW101's config has zero blank-named floors/zones/units and every trade key is in
  `GROUPS` — so the guard stops being a proof and becomes a value: every dimension now falls back to its
  level name, and the insert coalesces a blank as a last resort.
- **`_unnamedDims` counts the fallbacks per level and the push reports them**, so if it recurs the
  planner is told *which* level was unnamed ("Zone ×3 — give those a code in step 2") instead of losing
  the whole tree silently. That report is also how the remaining mystery gets identified next time.
- ⚠️ **Still unexplained:** exactly which location produces the blank name. The guard makes it harmless
  and self-reporting; it does not explain it. Next push on OPW101 will name the level.

### 3 · The "+" column chooser no longer covers the last column
`.ps-cols-corner` is `position:absolute; right:0` over the header, so with the grid scrolled fully right
it sat **on top of the last column's heading** while that column's data stayed visible — the reported
"the + makes the columns not aligned". It now has its **own trailing lane**: a `.c-plus` spacer cell on
the header, the filter row and every body row, so the last real column always ends before the button and
header/body stay cell-for-cell identical.
- ⚠️ The spacer carries an explicit **`order:9999`**. `applyColOrder()` assigns `order: 0..N-1` by
  `nth-child`, and an unstyled cell defaults to `order:0` — the spacer would have jumped to the front.
- Neither `applyColOrder()` nor `applyColHidden()` can ever target it: both generate rules only for
  `gridCols()` entries, and the spacer sits past the end.

### Verification
**172 checks green** against the shipped functions, including: every `dimName` fallback case (unknown
trade, `_all` floor, missing zone/unit, blank code+name, no `loc` at all) plus that a real code still
wins and is trimmed, and that the fallbacks are counted per level; `_pushParentLabel` naming a found
branch, a renamed branch and the no-branch case, and `_pushParentCode` surviving a throwing resolver;
and the spacer's explicit order, its presence on all three body row kinds plus the header and filter
rows, and that no order/hide rule can target it.
⚠️ **Not verified live** — the next real push is the test: it should now complete with a WBS-Manager tree
(so Execution Phase reports its activities) and, if any location is still unnamed, say which level.

## Push speed, the sub-WBS tick-box, autofit columns, location-breakdown-first (2026-08-18) — fmlozano
Five owner items. One of them is confirmation that the previous fix landed.

### 1 · ⚠️ The warning after pushing IS the previous fix working — not a new fault
The push completed with **444 WBS branches** and no NOT-NULL abort, and the warning read:
> Some locations had no code or name, so their branch was named after its level instead: **Floor ×1**.
> Give those floors/zones/units a code in step 2 to name them properly.

That is exactly the designed behaviour: one location in the builder has neither a code nor a name, so its
branch was named after its level rather than costing the planner the whole tree. **Before the fix this
same condition aborted the entire `wbs_nodes` insert loop**, which is what produced the dotted-code
fallback and "Execution Phase · 0 activities". The diagnostic also finally identifies the culprit that
reading the code could not: **one unnamed floor**. Naming it in step 2 clears the warning.

### 2 · ⚠️ Why the push was slow — one round-trip PER BRANCH
The `wbs_nodes` loop `await`ed a **single-row insert per branch**, and OPW101 builds **444** of them. At
the ~100 ms a Supabase round-trip costs that is **~45 seconds** of the push spent waiting, one node at a
time — with 2,561 activities going in afterwards in six chunks of 500.
- Siblings at the same **depth** can all go in one insert, because their parents already have ids. The
  tree now costs as many round-trips as it has **levels** (Trade › Floor › Zone › Unit = 4), not as many
  as it has nodes — 444 → ~5.
- ⚠️ **Order is load-bearing.** PostgREST returns inserted rows in payload order, which is how each new
  id is matched back to its nodeDesc. Three layers guard that: a length check on the happy path; a
  `(parent_id, name)` match for a short or reordered response, which **consumes** the matched row so two
  branches can never claim the same id; and an unmatchable row **fails the push** rather than silently
  mis-parenting the tree. A batch that errors as a whole is retried **row by row** through
  `insertNodeSafe`, so one bad branch still costs only itself.

### 3 · "Group into a sub-WBS instead" removed
Always ticked, exactly like the WBS picker before it. A builder push now always builds the real branch
tree — that is the point of defining the location breakdown — so the tick-box, its visibility toggle and
the flat path's "Group the pushed schedule by" select (which only applied when it was OFF) are all gone.
Activities still carry discipline + location as DATA, so the schedule's own Group control re-orders the
view freely afterwards. An empty level list is still refused.

### 4 · Location breakdown FIRST
The builder's three location levels **are** the project's Location Breakdown levels — but the builder
hard-labelled them Floor / Zone / Unit and the only way to create them was to push and let
`ensureLocLevels()` invent "Location / Zone / Unit".
- **New bar at the top of step 2**: states this project's levels ("Tower › Level › Zone"), or that it has
  none yet *and what a push would create*, with a button that opens the real Location Breakdown editor
  (`openLocLevels()`) before any floors are typed in. Degrades with a message if that editor is absent.
- **`dimLabelOf()`**: every level label in steps 2–7, the push dialog's L1…L4 and the unnamed-branch
  warning now read the project's own names, falling back to Floor / Zone / Unit only when it has none.
- A first push names the levels it creates **after the builder's own labels**, so a project that gets its
  breakdown *from* a push ends up with the words the planner already saw.

### 5 · Double-click a divider to auto-fit + a better "+"
- **`autoFitCol()`**, wired to `dblclick` on the column grip. ⚠️ It collapses the column's width variable
  to `0px` before measuring: at its normal width a cell's `scrollWidth` just reports the (possibly too
  wide) box, so the fit could never *shrink* anything. Clamped 46–520 px and persisted to `ps_cols`
  alongside the drag-resized widths.
- ⚠️ **Widths are per column TYPE, not per column** — all four date columns read `--c-date` — so fitting
  one date column fits them all. That is how the drag grips have always worked; the tooltip now says so
  instead of the behaviour pretending otherwise.
- ⚠️ It fits what is **rendered**: the grid is windowed, so the measurement covers the visible rows plus
  the buffer, not all 2,561. Same trade-off Excel makes on a filtered sheet, and it keeps it to one reflow.
- The **"+"** is restyled (ink-coloured, real hover/open state) and pinned to `width: var(--c-plus)` — the
  exact width of the spacer lane the header and body rows reserve — so it can never overlap the last
  column again.

### Verification
**214 checks green** against the shipped functions, including: the depth bucketing and per-level batching,
all three id-mapping paths (payload order / `(parent_id, name)` with row consumption / row-by-row retry)
and the fail-rather-than-mis-parent case; the tick-box and its toggle being gone and the push always being
called grouped; `autoFitCol`'s measure-at-zero ordering, its clamp, its restore-on-nothing-to-measure and
its persistence; the "+" width being tied to `--c-plus`; `dimLabelOf` reading the project's levels and
falling back per level; and an unnamed location now being named after the **project's** level.
⚠️ **Not verified live.** The deployed build loads with 0 console errors, but the automation's Chrome
window was minimised again ([[browser-hidden-tab-artefact]]) so the builder panel would not repaint and I
could not walk the dialog or time a real push. **The push timing in particular is an analytical claim
(444 round-trips → ~5), not a measured one** — the next real push is the test.
⚠️ BAU101-TEST is empty again (cleared after my earlier test push), so there was no sandbox tree to
re-push into either.

## The Gantt pane vanishing, and the header/body column drift (2026-08-18) — fmlozano

### 1 · ⚠️ The Gantt pane really was gone — an unclamped saved width, now guarded
View said "Split (Grid + Gantt)" and no Gantt existed anywhere on screen. **Confirmed from the owner's
own storage: `ps_grid_w = "1518"`.** The divider drag writes an INLINE `flex-basis` on the grid pane and
cleared its `max-width`, and that pixel width is restored **verbatim** on the next load — so a width
dragged on a wide window (or another monitor) exceeds the split's width and the Gantt pane, `flex:1 1
auto; min-width:0`, collapses to **zero**. There was no way back short of editing localStorage by hand.
- **The guard is CSS, deliberately, not a number in JS** — the browser re-evaluates it on every resize,
  so it self-corrects at any window size:
  `.ps-split:not(.ps-grid-only) > .ps-grid-pane { max-width: calc(100% - var(--ps-gantt-min) - 6px) !important; }`
  ⚠️ The `!important` is load-bearing: it has to beat the inline `max-width` the drag writes. "Grid only"
  keeps its own `100%` rule, since the Gantt is `display:none` there.
- **JS then HEALS the stored number** rather than merely surviving it. Every write goes through
  `setGridW()`, which clamps to what fits and persists the corrected value, so a width dragged on a wide
  monitor stops fighting a narrow one. A window resize re-clamps, leaving Gantt-only clamps on the way
  out, and ⚠️ **`max-width:none` is gone from the split code entirely** — that is what let an inline
  flex-basis eat the whole pane. Never write it there again.
- **New "Reset layout to defaults" in the View menu.** A saved pane width or column layout that ends up
  unusable must always be undoable from the UI — a planner should never be asked to open devtools. It
  clears `ps_grid_w` / `ps_cols` / `ps_colorder`, drops the inline width and every `--c-*` variable,
  returns the view to Split, repaints, and says outright that the schedule itself is untouched.

### 2 · ⚠️ The column lines: two scroll boxes with two different content widths
The header and the body are separate scroll containers. `.ps-grid-scroll` is `overflow:auto` and shows a
vertical scrollbar; `.ps-grid-head` is `overflow:hidden` and never does. So the body's content box is
~15px narrower and its **maximum scrollLeft is ~15px LARGER**:

    body max = content − (paneW − scrollbar)        head max = content − paneW

The sync does `gHead.scrollLeft = gs.scrollLeft`, which the header **clamps to its own smaller maximum** —
so the header lags the body by up to the scrollbar's width as you scroll toward the right end, and agrees
exactly at scrollLeft 0. That is why it looked intermittent ("when scrolling or not scrolling").
- **`syncHeadGutter()`** measures the body's scrollbar and pads the header by exactly that. Padding counts
  toward `scrollWidth` but not toward the row's available width, so the header's maximum becomes
  `content + pad − paneW` — identical to the body's.
- ⚠️ **Measured, never assumed.** The width varies by platform and by overlay-scrollbar setting, and is
  **zero** while the grid has too few rows to overflow — a hard-coded 15px would misalign the other way.
  Re-measured from `syncHeadHeights()` (which the column resize, the autofit and the density toggle
  already call) and after every paint, since the scrollbar comes and goes with the row count.
- **The other candidate was ruled out first, not guessed away.** A new structural check renders the header
  and all three body row kinds from the shipped code and diffs their cell sequences: **28 cells, same
  classes, same order**. Column order and hiding are `nth-child` CSS over those cells, so a count or order
  mismatch would misalign them — there isn't one. Keep that check: it is the cheap way to catch a future
  row kind that forgets a cell.

### Verification
**252 checks green**, including the clamp arithmetic executed at three window widths (a 1000px split caps
the grid at 754px; oversize clamps to 754; undersize floors at 240; a 400px split still gives the 240
floor), the reset clearing every key and variable, and the gutter arithmetic showing the two maxima differ
by exactly the scrollbar width without the pad and by zero with it.
⚠️ **Neither fix is verified live.** The automation's Chrome window was minimised for this whole pass
(`innerWidth: 0`, `visibilityState: hidden` — see [[browser-hidden-tab-artefact]]), so I could not measure
cell positions or see the Gantt come back. The Gantt diagnosis is nonetheless **evidence-based** (the
stored 1518px), and the drift diagnosis follows from the two containers' geometry, but **both want the
owner's eyes**: the Gantt should reappear on load, and the column lines should stay put at any scroll
position.

## ⚠️ I broke the module, and the cache hid a day of fixes (2026-08-18) — fmlozano

### The module would not open at all — my regression
The Project Schedule opened with "— Select project —" and an empty grid whatever the dashboard had
selected. Cause: the patch that added the Gantt-pane clamp **deleted the line that READS the saved pane
width** and left `if (saved && …)` behind. `saved` was then undeclared, so init threw right before
`loadProjects()`.
- **Confirmed live on the deployed build**, not inferred: `ReferenceError: saved is not defined` at
  `index.html:19931`, inside `AppAuth.requireLogin`'s callback.
- ⚠️ **`node --check` cannot catch this.** It is valid syntax that only fails at runtime, and the whole
  harness is built on slicing functions out and executing them — which never exercises the init path.
  I also tried writing a general undeclared-identifier scanner and **threw it away**: a regex over a
  19k-line file produced garbage (`ge`, `nam`, `enumerabl`) and did not even flag `saved`. Do not
  resurrect that idea; assert the invariant instead.
- **Structural guard, which is the real protection:** the whole split-pane setup is now wrapped in
  try/catch. It is cosmetic and sits immediately before `loadProjects()`, so anything throwing in it
  costs the planner the entire module — indistinguishable from "the app is broken". A layout nicety may
  now cost the layout, never the data. Six checks assert the read precedes the use, that the wrap exists
  and closes before `loadProjects()`, and that the log says the schedule still loads.
- ⚠️ One of those checks initially passed a false positive: the assertion compared positions of
  `if (saved &&`, which my own COMMENT also contains. Compare against the code form, not prose.
- **Verified live after the fix:** 0 console errors, `window.__psSetGridW` present (so init got past the
  block), and the module loaded Bauhinia Residences with 132 activities.

### ⚠️⚠️ And the reason several of today's fixes "did not work": MODULE_V
`dashboard.html` defines `MODULE_V` and appends it as `?v=` to every module link, with a comment saying
outright that it must be bumped on any deploy that changes a module's `index.html` — and warning that
forgetting it has been **mis-diagnosed as a code bug more than once**.
**I deployed `modules/project-schedule/index.html` about ten times today and never bumped it.** So
`?v=20260818g` kept serving a cached page and the owner was testing stale builds for much of the session.
Bumped `20260818g` → `20260818h`. Treat the bump as part of the same commit as the module change.

## Multi-cell select: it already exists — and the last of the positional drift (2026-08-18) — fmlozano
Owner asked whether the Project Schedule could have Excel-style multi-cell selection. **It already
does**, and has for a while: `_cellSel` is a rectangle in DL-row × grid-column space, `_cellAnchor` is
the shift-extend anchor, `_cellClip` is the cell clipboard. Click, shift-click and shift+arrows select a
range; `Ctrl+C` / `Ctrl+X` write TSV to the system clipboard (so it round-trips with Excel), `Ctrl+V`
pastes a block or fills the selection from a single copied cell, `Ctrl+D` fills down, and the whole set
is listed in the **?** shortcuts panel under Editing / Clipboard / Selection. Nothing to build.

### ⚠️ But checking it found the mapping still drifted — and ethanrobles10 had just fixed most of it
Two commits landed while I was looking (`7280198`, `0313786`, Claude Opus 4.8): they found the same
off-by-one — "Duration % Complete" was added to `GRID_COLS` in July but never to the parallel
`_CELL_META`, so every cost column after index 10 copied and **pasted the wrong field** — and the
Start/Finish rows writing `actual_start`/`actual_finish` unconditionally. Their fix re-aligned the array
and added a `disp` marker so copy reads the DISPLAYED date and paste routes through `_dateEditPatch`,
which is better than what I had written (it gets the actual/planned routing, the duration recompute and
the validation, where mine did a raw field write). **Their `disp` handling and paste path are kept
verbatim.** I rebased onto them rather than resolving the conflict in my favour.
- ⚠️ **What was still wrong:** `_cellText()` carried the same drift as a `switch (ci)` on hard-coded
  7 / 8 / 13 / 16 / 17. Those were right before index 10 was inserted and wrong after: 13 became Earned
  Value IBB (so **At Completion IBB copied nothing**), 16 became Percent Complete Type and 17 became
  Float — so **copying Float or Var (BL) produced the neighbouring column's text**.
- ⚠️ **And the array itself was still the cause, not the cure.** Their second commit is them
  hand-adding an entry for the Task column I had introduced — exactly the bookkeeping that had already
  failed once. `_CELL_META_BY_LABEL` + `cellMeta(ci)` now resolve the field from `gridCols()` **by
  label**, so an unlisted built-in column is **copy-only by default** instead of silently inheriting its
  neighbour's field, and adding a column needs no bookkeeping at all. The comment that told the next
  person to "add the matching entry HERE" is gone with it.
- **Bonus the label keying makes free:** the dynamic columns (Discipline / Trade, the location levels,
  Activity Codes, UDFs) and Task now copy their **displayed value**. They came out blank before, which is
  precisely wrong when the point of the copy is to paste the block into Excel.
- Also dropped a `PS.state` accessor still naming the deleted `_CELL_META` (reading it would have thrown).

### Verification
**31 checks in a new `t2.js`, executed against the shipped `cellMeta` + `gridCols`**: every cost column
resolves to its own field; `Start`/`Finish` keep `disp: 'start'` / `'fin'`; the seven computed columns and
every dynamic column are copy-only; out-of-range is `null`; the `disp` date read and the `_dateEditPatch`
paste routing are still in place; and — the point of the change — **a newly added built-in column is
copy-only rather than inheriting a neighbour's field**, asserted by injecting one into a copy of
`GRID_COLS`. The 259-check suite still passes (its own cell-mapping block was superseded by `t2.js` and
removed rather than left asserting my discarded signature).
⚠️ **Not verified live** — no signed-in run this pass. The behaviour is unchanged for the columns
ethanrobles10 had already corrected; what is newly correct is Float / Var (BL) / At Completion copy text
and the dynamic columns copying at all. MODULE_V → 20260818i.


## 2026-08-24 — Vertical Stacking: a magnifier that shows the hovered zone enlarged beside the building

Owner: zones get small fast — a tall tower at detail 3 is a wall of 8pt dates, and the existing
**Zoom** control only fixes that by making the whole building too wide to see at once. Asked for a
magnifying glass: hover a zone on the left, see it enlarged on the right.

**Magnify** (new toggle in the stacking bar, beside Zoom) splits the view into a flex row: the
towers on the left, a sticky **Magnifier** panel on the right. Moving the pointer over a building
paints a magnified copy of whatever is under it into the panel, and the readout underneath holds
the hovered zone's activity count, POC (with the planned % when there is a baseline), date and
slip — the same numbers the cell's tooltip carries, but held still so they can be read with the
pointer elsewhere.

⚠️ **The panel is a CLONE of the same `<svg>` with a tighter `viewBox`, not a second renderer.**
Whatever `_vsTowerSVG` draws — hatch, planned marker, Compare's two-row table, the grade line — is
what the loupe shows, and it cannot drift from the left pane. The clone is made **once per tower**
and then only its `viewBox` moves; re-cloning per mousemove would rebuild thousands of rects a
second at detail 3. Mousemove is throttled to a frame, `<title>`s are stripped from the clone and
it takes no pointer events, so the tooltips and the click-through drill-down stay with the real
cells. The hovered zone is outlined in **both** panes (`.is-loupe`).

- Magnification is a separate control from Zoom (**1.5×–8×**, ± in the panel head); it never goes
  wider than the drawing itself, so a short building is centred rather than letterboxed.
- Both the toggle and the magnification persist in `localStorage` (`ps_vsloupe` / `ps_vsloupez`) —
  viewing preferences, like `ps_ganttscale`, not project data.
- Leaving a building does **not** clear the panel: the last zone stays magnified so its numbers can
  still be read.
- Under 1100px the panel drops below the towers instead of squeezing them.

### Verification
Not signed in this pass, so the loupe was driven in a **harness that loads the shipped
`_vsLoupePaint` / `_vsLoupeInfo` / `_vsWireLoupe` verbatim** (extracted from index.html) over a
mock 10-level × 6-zone tower: the clone is created once and reused, the `viewBox` lands centred on
the hovered cell at exactly `W / _vsLoupeZ` wide and clamped inside the drawing, the highlight
appears on exactly one cell in each pane, `<title>`s are stripped, two moves in one frame coalesce
to the last, and a pointer over the label gutter still magnifies while the readout falls back to
the tower name. Whole-file JS syntax check clean. `MODULE_V` → `20260824g`.
⚠️ **Not verified against live schedule data** — no signed-in run.

### 2026-08-26 — Contract Package Monitor: a multi-package project tracked as several
Owner: *"For cases with projects that have multiple packages let's modify the project schedule module
to show this multiple packaged project but tracked and monitored separately as a package."*

A multi-package project (Package 1 — Tower 1 and General Requirements; Package 2 — Towers 2-7) is one
schedule that must report as several, because each package is administered, progressed and billed on
its own. New built-in report **Contract Package Monitor** (`repPackages`, in the Reports dialog).

- One row per contract package **plus the unassigned bucket**: activities, own/total tagging, planned
  and actual start/finish, planned % at the data date, actual %, variance (pp), cost-weighted %,
  planned cost, earned. Project total row at the foot.
- ⚠️ **The weighting is `schedule_scurve_agg`'s, exactly**: `w_dur` = duration_days else
  (end−start)+1 else 1; `w_cost` = planned_cost else bl_cost else 0; leaves are rows with a start date
  and a non-WBS/summary type; POC = Σ(w × pc)/Σ(w); planned = Σ(w × straight-line elapsed)/Σ(w). Any
  other weighting would disagree with the S-Curve, Cash Flow and the Contracts BOQ accrual — all three
  read that same function, and two package percentages differing by rounding are worse than one.
- ⚠️ **Effective package via `packageOf()`**, so a WBS branch tagged once reports its whole subtree.
  The **own / total** column exposes how much of a total is inherited rather than tagged — the way a
  package total drifts when a branch is re-parented.
- ⚠️ **The unassigned bucket is always listed**, and the note warns when it is non-empty: otherwise a
  half-tagged schedule looks fully packaged, every package row right and the project's wrong.
- ⚠️ A package with no activities reads **`— none —`, never 0%** (a zero claims a measurement was
  made). An actual finish is **withheld while anything is open** (`— N open —`) rather than reporting
  the latest finish among half-done work.
- **Verified 21/21** executing the shipped `repPackages` in node on a three-package fixture: PKG-1 at
  75.00% actual vs 100.00% planned (−25.00 pp, ₱1.5M earned of ₱2M), PKG-2 found only through WBS
  inheritance at **0 / 1** own and 60.61% planned, PKG-3 reporting `— none —`, the WBS-summary row and
  the start-date-less row excluded from counts, percentages and money, project total 25.56%.
  ⚠️ My first assertion said 60.00% for PKG-2 and was wrong — the RPC divides by (end − start), a
  99-day span, not the 100-day duration. The code matched the SQL.
- Inline script parses (`node --check` on the extracted block). ⚠️ **Not rendered in the Reports
  dialog and not run against live data** — no signed-in run.

### 2026-08-26 — Packages become the schedule's top-level structure (not a report)
Owner, rejecting the Contract Package Monitor as an answer: *"This is not the result that I am
expecting… I am expecting that as an example the contracts will show directly in the grid. Each
package will have its own WBS and own activities depending on the scope of that package."*

The report was the wrong shape — it reported on packages instead of making the schedule package-first.
Decisions taken with the owner before building: **package = a real top-level WBS root**;
**change orders stay orthogonal** (a CO belongs to a package — `package_id` = which lot, `scope_type` =
main vs change order, never derived from one another); **named Builder setups per package, with a push
history**.

`migrations/2026-08-26-package-scoped-schedule.sql`
- `schedule_builder` goes from **one row per project** to many: `{id, project_id, package_id, name,
  config}`. ⚠️ **The existing row is preserved** and renamed *Original setup* — a planner's builder
  state is hours of work, and losing it to a migration is the most expensive way to add a feature.
  ⚠️ **No package is guessed for it**: it lands unassigned, which is honest and visible.
- `schedule_builder_pushes` — a **full copy** of the config at the moment of each push. ⚠️ A copy, never
  a pointer: a pointer follows later edits and stops describing the schedule it produced.
- `wbs_nodes.is_package_root` + a unique index (one root per package). ⚠️ **A flag, not a name match** —
  matching on the branch name breaks the first time someone renames it, and the next push silently
  builds a second root holding half the schedule.

Schedule Builder
- **Setups dialog** (new button in the builder header, labelled with the open setup and its package):
  every setup grouped by contract package, with Open / Duplicate / Delete, *New setup for this package*,
  and the **push history** with *Load this version*.
- ⚠️ **Loading a pushed version restores the RECIPE, not the schedule** — the activities stay exactly
  where they are. Anything else would be a silent bulk delete. Said in the dialog and in the confirm.
- ⚠️ **A new setup starts empty**, never seeded from what happened to be open — that is how a Package 2
  build inherits Package 1's floors and zones.
- ⚠️ **Deleting a setup never deletes pushed activities.** Stated in the confirm, because the recipe and
  the work are easy to confuse.
- Save falls back to the old single-row upsert when the migration has not been run, so an un-migrated
  database still keeps the planner's work instead of losing a session to an error toast.

Push / Import / Clear all take a package
- **Push** builds under that package's own WBS root (`ensurePackageRoot`), stamps `package_id` on every
  branch **and** every activity, and records the snapshot. ⚠️ An explicitly chosen WBS row still wins —
  a planner pushing into a branch means it. ⚠️ Pushing an **unassigned** setup on a project that has
  packages now warns first: those activities would appear in no package total.
- **Import** asks for the package, defaulting to **— No package —** rather than the first one: an
  unassigned import is visible and fixable, a wrongly-assigned one looks correct. ⚠️ **Replace is now
  scoped to that package** — importing Package 2's programme used to delete Package 1's. The adopted
  WBS tree is then nested under the package root.
- **Clear** asks what to delete: one package, only unassigned work, or everything. It **counts the rows
  first** and names them on the button. ⚠️ Nothing is preselected as "Everything". ⚠️ Rows are deleted
  **by id from the effective package** (`packageOf`), not by a `package_id` filter — an untagged row
  inside a package's tree is still its work, and a column filter would leave it behind for the next
  push to land on top of. ⚠️ **The package root survives** a package clear: the lot still exists, the
  grid still shows it, and the re-push adopts it instead of creating a sibling.

**Verified 9/9** executing the shipped `_clearWbsTree` in node against a two-package tree: the tagged
branch and the **untagged descendant** both cleared, the package root kept, the other package and the
locked skeleton untouched, unassigned top-level work left alone, a whole-project clear reducing to the
skeleton, and an empty package clearing nothing without erroring. Inline script parses.

`MODULE_V` → `20260826i`.

⚠️ **The migration has NOT been run, and nothing was clicked through in a browser.** Until the migration
runs, the builder keeps its single-setup behaviour and says so on save.

### 2026-08-26 — File an EXISTING schedule under a contract package
Owner: *"Now build the bulk action to file existing schedules under a package."*

Push, import and clear all take a package, but that only helps work built *after* packages existed.
One Portwood's **2,665 activities** were planned before them, belong to no lot, appear in no package
total, and still show phases rather than contracts at the top of the grid. **Actions → File under a
package…** is the one-time action that fixes that, and what makes the two top-level rows real.

One apply does four things: ensure the package's WBS root → stamp `package_id` on the chosen
activities → stamp it on the branches holding them → re-parent the chosen **top-level** branches under
that root.

- Two scopes: **everything not yet in a package** (the common case) or **one WBS branch and everything
  under it**. Both preview measured counts — activities, branches, and how many top-level branches
  would move — before anything is written.
- ⚠️ **Work already in ANOTHER package is never touched, in any scope.** Stealing Package 1's
  activities into Package 2 would be silent and unrecoverable: the previous owner is recorded nowhere
  to restore from. Filing into the package that already owns the work is a no-op, not a double move.
- ⚠️ **Only TOP-LEVEL branches move.** Deeper ones are re-tagged where they are — a deep re-parent
  would rewrite a hand-built WBS, and it is the one part of this a planner could not undo by eye.
  Moving a top level back is one drag in the WBS Manager.
- ⚠️ **Branches are tagged as well as activities**, so a NEW activity added under one of them inherits
  the package through `packageOf()` without anyone remembering to set it.
- ⚠️ **The locked skeleton DOES move** when it is in scope — the mockup puts Planning Phase and
  Execution Phase *under* the package. **Verified safe against the duplicate-skeleton bug**:
  `ensureWbsSkeleton()` only seeds a project with **no nodes at all**, and `_wbsBackfillSkeleton()`
  fails closed — its `seeded` guard looks for a locked skeleton node at TOP level, finds none once
  they have moved, and returns without inserting.
- ⚠️ **A partial apply still reloads.** Hiding a half-done write behind stale state is how someone
  re-runs it and double-moves a branch.
- ⚠️ Nothing is deleted; no dates, durations or progress are touched.

**Refactor in passing:** `ensurePackageRoot` was lifted out of the Schedule Builder closure to module
scope — three callers need it now (builder push, import nesting, this action) — and
`_importUnderPackageRoot` lost its duplicated copy of the root-resolution dance (**−871 chars**).

**Verified 13/13** executing the shipped `_pkgFileCandidates` in node against One Portwood's shape (a
locked skeleton at top level, everything unassigned, plus a Builder-made Package 2 root with its own
subtree): the unassigned scope takes exactly the two unassigned activities; an activity already in
Package 2 **and one that inherits it** are both left alone; WBS summary rows are not filed as
activities; package roots are never candidates; exactly the two top-level skeleton branches move;
branch scope takes only that subtree; and re-filing into the owning package adds nothing.
`MODULE_V` → `20260826j`.

⚠️ **Not clicked through in a browser** — no signed-in run against real data.

### 2026-08-26 — The push dialog names its package, and each package gets its own phase branch
Owner, from the push dialog: *"Where will the push to project schedule at which package show? See the
dropdown is clashing."*

Two problems, and the second was a real bug in what shipped this morning.

**1. The package was invisible — and was never actually applied.**
⚠️ `pushToSchedule` resolved the package root only `if (!baseNodeId && curPkgId)`, but `parentCode` is
**always** `execPhaseCode()` (the WBS picker was removed 2026-08-18), so `baseNodeId` was **always** the
shared project-level Execution Phase and the package root was found and then silently ignored. A
Builder push could never have produced a top-level package row — the thing packages exist for.
- New `ensurePackageBranch(pkgId, name)` creates/adopts **"PKG-2 — Towers 2-7 › Execution Phase"**, and
  the package now **wins over** the project-level phase.
- ⚠️ **Matched by name key UNDER THE ROOT, never globally**: every package has an "Execution Phase" of
  its own, so a global lookup would collapse them all onto the first package's.
- ⚠️ Falls back to the root itself if the branch insert fails — never lose the push over a nicety.
- The dialog gains a **Contract package** select, defaulting to the open setup's package, plus
  **— No package (project level) —**. It states the destination in full: *Filed under **PKG-1 — Tower 1
  and General Requirements › Execution Phase***.
- ⚠️ Shown even when there is only one choice. "Where did my 2,561 activities go" is the question this
  dialog exists to answer, and a package applied invisibly from the open setup is exactly what could
  not be seen.
- Choosing a package **other than the setup's** is allowed and says so: it files the activities there
  and does **not** change the setup. Choosing none warns that the work will appear in no package total
  and points at **Actions → File under a package…**.
- `pushToSchedule` takes a 7th arg, `pkgOverride`. ⚠️ `undefined` means "not asked" (use the setup's);
  `null` means "deliberately no package" — they are not the same and the default must not collapse them.

**2. The "Schedule to push" dropdown clipped its own text.**
⚠️ Measured, not guessed: `.pd-select` is `padding:9px 11px; font-size:14px; border:1px`, and `* {
box-sizing:border-box }` is global — so the inline `height:34px` left **34 − 18 − 2 = 14px** of content
box for a line box of ~17px, clipping the descenders of "Internal (target)". The inline height is
removed; padding sizes the control to its natural ~37px. No other fixed-height `.pd-select` exists in
this module.

**Verified 10/10** executing the shipped `ensurePackageRoot` + `ensurePackageBranch` in node against a
stubbed PostgREST: the root is named from the contract and flagged, a second call **adopts** rather
than duplicating, the phase branch is created under the root carrying the package, a re-push adopts it,
`_wbsNameKey` matching survives case and spacing (`EXECUTION  phase`), and a second package gets its
**own** root and its **own** Execution Phase — four nodes, no collapse onto the first.
`MODULE_V` → `20260826m` (j..l were taken by a concurrent session; `l` was already live, so this needed a fresh one).

⚠️ **Still not clicked through in a browser.**

### 2026-08-26 — Schedule ↔ Contracts: change orders come from the register, not free text
Owner: *"This should also connect to the project schedule via the tagging for contracts, packages,
change orders, EOT."*

Where the four axes stood: **package** connected that morning (`project_schedule.package_id` +
`wbs_nodes.package_id`, roots and inheritance); **contract** covered by the package it defines;
**change order** — `scope_type` existed but `change_order_ref` was **free text**; **EOT** — nothing.

⚠️ **The change-order gap was worse than "not connected".** `change_order_ref` was typed into a
`prompt()` whose only help was a comma-joined list of strings already used on that project. The
commercial team records every variation next door in `contracts_claims`, in the **same database**, and
the two lists could never see each other — so the schedule said `VO-14` while the register said
`VO-014`, and no report could join them.

- The schedule now reads Change Orders and EOTs from `contracts_claims` on project load
  (`CONTRACT_RECS`). ⚠️ **Read-only**: the schedule cites a variation, it never creates one — that is
  the Contracts module's job, and one app inventing another's commercial records is unrecoverable.
- ⚠️ **Tolerant of every absence** — no table, no grant, no rows → empty list, and the CO field behaves
  exactly as it always did. A project whose Contracts module was never set up must not lose its schedule.
- `promptCoRef` is now a **picker** over the registered COs (reference + description + status), with
  free text kept for a variation not yet recorded.
- The details panel's **Change Order Ref** is a select over the same list.
- ⚠️ **A stored ref always keeps its own option**, labelled **"⚠ not in the register"** and placed
  directly under "none" so it is seen. Without it a `<select>` whose value is absent reports the FIRST
  option and the next save silently re-files the activity under a different variation — the same rule
  the package picker follows.
- ⚠️ **Registered refs sort first** so the list leads with what the commercial team owns; refs used
  only on the schedule follow, so nothing existing disappears.

**Verified 20/20** executing the shipped `coRegistered` / `coIsRegistered` / `coLabel` / `coRefValues` /
`coSelOpts` in node: EOTs are not offered as change orders, a blank reference is excluded, `VO-2` sorts
before `VO-014` (numeric), whitespace matches, the legacy `VO-14` typo reports **not registered** and
keeps its option in position 1, a registered value is never duplicated, and the union has no duplicates.

⚠️ **EOT is still not connected** and needs the owner's call first: an approved EOT is *N days*, and
whether that shifts a completion milestone, relaxes a constraint, or stays informational beside the
schedule is a commercial decision.

### 2026-08-26 — EOT connected to the schedule, and deliberately NOT spread onto activities
Owner: *"EOT should be connected and it will impact the project schedule, but in terms of spreading the
N days on to which activities I am not sure how to go through with this."*

⚠️ **The uncertainty was the right instinct, because the premise hides a trap: an EOT is never spread
onto activities at all.** It adds no work and changes no duration. It moves the **contractual completion
date** — the date lateness, and therefore liquidated damages, are measured against. Activity dates come
from the programme's own logic; an EOT is what makes a late finish *excusable*, not what causes it.

Pushing N days across activities would be backwards twice: it would corrupt a programme that already
says what it says, and it would hide the very thing the EOT exists to show — the gap between when the
work will actually finish and when the contract now requires it.

So **nothing here writes a date.** Three derived figures per package, reported in the Contract Package
Monitor beside the programme's own:
```
  contract finish   the package's own end_date, off the contract
  + granted days    Σ approved_days of EOTs with status 'Approved'
  = revised finish  the date lateness is now measured against
  exposure          forecast finish − revised finish   (positive = LD exposure)
```
- ⚠️ **Only `Approved` EOTs move the date.** A pending claim is exposure, not entitlement — reporting it
  as granted would tell a PM they have time nobody has given them. Pending days show in brackets.
- ⚠️ **A Change Order's `approved_days` is not EOT time** and is excluded, even though the column exists
  on both.
- ⚠️ **An untagged EOT counts ONCE, in the unassigned row** — never against every package. The first
  cut of this credited it to all of them; the harness caught that the code and its own note disagreed,
  and the note's rule was the safe one. Crediting one untagged claim to every lot would tell each PM
  they have time they may not have, and count the same days several times in one report.
- ⚠️ **Calendar days.** An EOT is granted in calendar days unless the contract says otherwise; the note
  says to apply the project calendar if yours grants working days, rather than quietly assuming.
- ⚠️ **Exposure is measured against the REVISED date**, so granted time is already credited — it reads
  "+18d late" or "42d float", never raw slippage that ignores the extension.

**Verified 12/12** executing the shipped `eotFor` / `revisedFinishOf` in node: 30d + 15d granted on
PKG-1 with a Disapproved 99d ignored and a 500d Change Order excluded; 20d pending reported apart and
never added; a project-wide EOT staying out of both packages; 2028-06-30 + 45d = **2028-08-14**; and a
package with no contract finish on record returning null rather than a guessed date.

⚠️ **Not clicked through in a browser.** The report is reachable at Reports → Contract Package Monitor.

`MODULE_V` → `20260826s`.

### 2026-08-27 — Reading more than one Procurement project from one schedule

AVR101's schedule covers all 7 towers, but Towers 2-7 are bought under **AVR102**, a different project in
the Procurement app. `_prcWpmProjectId()` resolved exactly one WPM project, so AVR102's work packages
could never reach the activities that consume them.

- **`_prcWpmScopes()`** = the project's own `cash_flow_settings.wpm_project_id` **plus** one per contract
  package naming its own (`packages.wpm_project_id`, 2026-08-27-package-external-codes.sql).
- **`_wpmScopeOf(r)`** = which WPM project ONE activity's work package is read from, resolved through
  `packageOf()` so a WBS branch tagged once answers for its whole subtree.
- ⚠️ **INERT UNTIL A PACKAGE IS MAPPED.** One scope in, one scope out — the tree, the ids and the
  resolution are byte-identical to before on every existing project.
- ⚠️ An **archived** lot still contributes a scope: the lot is retired, its procurement history is not.

**⚠️ `wp_no` IS UNIQUE ONLY WITHIN A WPM PROJECT.** Both AVR101 and AVR102 have a "1". Consequences, each
handled explicitly:
- The index is **nested** `byScope[project][no]`, plus a `uniq` map of numbers appearing in exactly one
  project. ⚠️ The first cut joined them into one string key with `\u0000` and **wrote a real NUL byte into
  the file** — nesting needs no separator, so nothing can collide and the bug cannot come back.
- `wpOf(r)`: the activity's own lot → the host → an unambiguous number → **null**. ⚠️ Null, not a guess:
  showing another lot's vendor under an activity is worse than showing none.
- **`activity_id` prefixes only a NON-HOST scope** (`AVR102-1`). Prefixing everything would re-key every
  package on every existing project and the next sync would sweep and re-insert the lot.
- The **picker is scoped to the activity's own lot** — two `<option>`s with `value="1"` are
  indistinguishable to a `<select>`, and the label would otherwise resolve through the host.

**The Procurement branch gains a LOT level** when the schedule spans several codes:
`Procurement › Towers 2-7 › Structural › WP`, named from the package (its **scope**, which is what a
planner reads), falling back to the bare code when no package claims that mapping so an unmapped scope
stays visible. A single-code project keeps `Procurement › Trade › WP` exactly.
- ⚠️ **The stale sweep now walks the WHOLE subtree.** Trade nodes are grandchildren under a lot, so the
  old direct-children scan would have found nothing stale AND read every package as new — a second copy
  of the entire branch on the first sync.
- ⚠️ `nodeOf` is keyed **lot → trade**; one flat map collides the moment two lots both buy Structural
  Works, which is the normal case.

⚠️ **`wpIsUnlinked` was left reading the old flat index** and would have flagged **every** activity as
unlinked. Now asks `wpOf()`, so the flag and the label cannot disagree.

**Verified 22/22** executing the shipped `_prcWpmScopes` / `_wpmScopeOf` / `_wpIndex` / `wpOf` / `wpByNo`
(sliced by brace-matching): the single-code path unchanged, an activity in each lot resolving to its own
project's WP "1", the ambiguous case returning null, archived lots still contributing, and the cache
invalidating on reassignment. **0 functions lost** against HEAD; 0 NUL bytes; inline script parses.
⚠️ **Not clicked through signed in and no live sync has been run** — the first real Sync Procurement on a
mapped project is the test.
