# Module: issues-lessons

## 2026-09-03 — Dashboard chart tiles maximised/aligned, and the issue detail's Lessons Learned becomes a table

Owner's list, off a screenshot of the Issues Dashboard:

**Issues dashboard**
1. "increase size of pie for issues by status chart (maximize to tile but with sufficient padding).
   have also the labels extend a bit with leader lines. add also the legend at the bottom of the tile"
2. "for issue by department and issue by champion, move label to bottom of tile"
3. "for the department and champion labels in issues by dept and issues by champion, left align."
4. "for the value labels, center align by default but align left to avoid situations like in the
   first photo attached"
5. "bar charts must also be aligned left."
6. "chart tile heights should be minimized to reduce whitespace. but maintain that all 3 chart tile
   heights to be equal."
7. "for the open issues tile, make sure issue can wrap text, not overflow"
8. "for the lessons learned tile, make sure also lessons can wrap text, not overflow. add also issue
   column"

**Issues individual view**
1. "label 'Related Lessons' to 'Lessons Learned'. but in lessons learned individual view, keep as
   'Related Lessons'"
2. "the lessons learned should be be in a table format instead with lessons learned, department, and
   date closed columns. lessons learned here should be wrap text"
3. "the history can also be improved. each tile inside can be reduced width. next history items then
   add to the side and down."

### Dashboard items 1–6 — the donut grows, gets leader lines and a bottom legend; both bar tiles move their header below the chart

The status donut goes from the shared 130px default to **170px** (`size: 170` on `donutChartSVG`),
and each slice now draws a leader line from its own arc out to its label — a straight radial
segment from just outside the ring to the label's anchor point — so a label can sit clear of a thin
slice instead of crowding the ring itself. A second, always-complete legend (`statusLegendBottomHTML`)
sits **under** the donut, listing all three statuses even when one is currently empty — the
per-slice labels skip a zero-value slice (nothing to point a leader line at), but a legend is
naming the vocabulary, not describing the current ring, so it stays complete.

⚠️ The Department/Champion tiles' own `<h4>` + legend row moves from *above* the chart to *below*
it (`.il-dash-cardhead-bottom`), matching the shape "chart, then a caption" the Status tile now
also has after item 1 — so all three tiles read the same way and stay comparable in height (item 6).
`.il-dash-cardbody` itself is squeezed 340px → 260px (item 6's "minimise to reduce whitespace"),
and because it's still the ONE height every tile's body shares, they stay equal regardless of what
each chart draws inside it.

### Dashboard items 3–5 — row labels left, value labels centre-or-left, the whole chart hugs the left edge

`hbarSVG`'s row (department/champion) labels drop the prior round's "centre unless it would cross
the y-axis" rule and are now unconditionally left-aligned (`anchor: 'start'`, flush to the tile's
left edge) — item 3 names the row label specifically, as a plain column of names down the left side.

The **value label** inside each bar ("X/Y (Z%) open") keeps a fallback rule, but inverted from
row-label alignment: it centres in the bar by default, and only drops to left-aligned (anchored
just inside the bar's own left edge) when the text is too wide for the bar to hold centred without
running past its edges. That's exactly the screenshot's complaint — a short bar like Finance's
"0/1 (0%) open" next to a much longer department's bar couldn't fit the text centred, so it spilled
and looked garbled; `ilTextW(valueText, 10.5) <= totalW - 8` is the fit test, and failing it flips
`valAnchor`/`valX` to the left-fallback rather than trying to shrink the font or the text.

Item 5's "bar charts must also be aligned left" is the chart's own SVG `preserveAspectRatio`,
changed from `xMidYMid meet` (centres the chart's natural aspect inside a wider tile, leaving
padding on both sides) to `xMinYMin meet` (anchors to the top-left, so the chart hugs the tile's
left edge with no floating gap). The donut is untouched — item 1 gives it its own, deliberately
centred treatment, since a ring chart reads differently from a left-to-right bar list.

### Dashboard items 7/8 — the Open Issues and Lessons Learned tiles wrap instead of truncating, and the lessons tile gains an Issue column

Both `fullIssueListHTML` and `lessonsTileHTML` drop their `clip(text, 90)` ellipsis-truncation call
on the issue/lesson text column — `.il-dash-list td` already sets `word-break: break-word`, so the
cell wraps onto as many lines as it needs rather than either overflowing its column or being cut
short with an ellipsis that hid the rest of the sentence.

Item 8 also adds an **Issue** column to the Lessons Learned tile (via `lessonSourceText(l)`, the
same helper the standalone Lessons Learned list screen's own Issue column already reads, so the
dashboard tile and that screen can't describe a lesson's source two different ways).

⚠️ That pushed the tile from 3 columns to 4, which collided with the existing
`.il-dash-list.il-dash-lesson-list` 3-column width rule (60/22/18%) — reusing it unmodified would
have silently mis-sized whichever table's markup happened to load its CSS second. The dashboard
tile now carries its own class, `.il-dash-list.il-dash-lessontile-list` (36/30/19/15% —
Lesson/Issue/Department/Captured), and `.il-dash-lesson-list` is freed up for the individual-view
table below, where it fits perfectly: both are a 3-column Lesson/Department/date shape, just with
a different final column (Captured vs. Date Closed) and a different heading.

### Individual-view item 1 — "Related Lessons" only when embedded on a LESSON's own page

`issDetailHTML` already carries `opts.excludeLessonId`, set **only** when this same markup is
rendered embedded on a lesson's own detail page (showing that lesson's parent issue) — see
`renderLessonDetailView` passing `excludeLessonId: cur.id`. That flag is now also the signal for
the heading: unset (the issue's own, normal page) it reads **"Lessons Learned"** — these are simply
the lessons this issue produced; set (embedded on a lesson's page) it keeps **"Related Lessons"** —
from there, the section really is about lessons *related to* the one already on screen. One
variable answers both "which lessons to exclude" and "what to call the section," because both
questions are really the same question: is this the issue's own page or not.

### Individual-view item 2 — a real table (Lesson Learned / Department / Date Closed), not a numbered list

The plain `<ol class="il-related-lessons">` (added by the prior round, item 5) is replaced with a
`<table class="il-dash-list il-dash-lesson-list">` — reusing the dashboard's own table styling and
column widths verbatim rather than inventing a third set of table rules for the same 3-column
shape. Date Closed reads `lessonResolvedDate(l)` (already used by the standalone Lessons list and
its export — the same "closed only once the linked issue has a `date_resolved`" rule everywhere).
Lesson text is not truncated (`.il-dash-list td` wraps, matching the "wrap text" ask), and each row
keeps the exact same `data-open-lesson` attribute the old `<li>` used, so the existing generic
`[data-open-lesson]` click-wiring (`wireIssues()`) attaches with no changes of its own.

### Individual-view item 3 — History entries shrink and wrap to the next row

`.il-history` goes from a single-column flex list to a CSS grid
(`repeat(auto-fill, minmax(220px, 1fr))`), so entries lay out several to a row and wrap to a new
row once the current one is full — "next history items then add to the side and down," reusing the
same auto-fill/minmax shape the Kanban board columns already use elsewhere in this file.
`align-items: start` so a short entry never stretches to match a taller one sharing its row — entries
carry wildly different amounts of before/after diff text, and forcing equal height would leave
visible empty space in the shorter ones.

### Verified

`node --check` clean on `module.js`; CSS brace-balance unchanged proportionally (287/287); 0 NUL
bytes in either file; a function-name-set diff against `origin/main` shows **0 functions lost, 1
added** (`statusLegendBottomHTML`) — nothing was accidentally dropped by the edits. Confirmed no
stale references remain to the removed `.il-related-lessons`/`.il-related-lesson-item` classes
outside the explanatory comment documenting their removal, and that `.il-dash-lesson-list` and
`.il-dash-lessontile-list` are each used by exactly the table they're now scoped to.

⚠️ Not verified signed in — no live click-through of the new leader lines, the left/centre value-label
fallback on real department data, or the individual-view table against a real lesson history. Module
assets bumped `module.css/js?v=20260903a`; no `MODULE_V` bump (index.html's structure is unchanged —
only its two module-local `?v=` query strings moved).

## 2026-09-02 (b) — Kanban view, wider/reworked columns, squeezed KPI bands, a stripped-down Background section — and a real bug the verification pass found

Owner's 10-item list, off a screenshot of the lesson detail view:
1. "in the issues list, no need to show lessons learned if captured."
2. "in issues list, increase column width for issue, caused by, corrective action."
3. "add also option for kanban view for issues which can be grouped by department or by champion.
   same applies for lessons list."
4. "for the summary tiles in the top of the issues and lessons list, squeeze to one row except in
   mobile view. no need to show aging."
5. "in lessons list, separate column for lessons learned and for issue. reduce column width of
   department and date resolved. increase width for lesson learned and issue and allow wrap text.
   remove aging column in list."
6. "In lessons individual view, as in first photo, in lessons group, remove issue text and open
   issue button. remove also issue in register marking. for the label 'The Issue this Lesson came
   from' rename simply to 'Background'."
7. "From the lessons learned individual view, the issue should not be editable. except for related
   lessons which user can directly add from the view. In the related Lessons, do not include the
   lesson displayed - include only the others."
8. "In the background group add in the top right option to open issue. this will bring to the
   individual issue view."
9. "In the Issue dashboard, Issues by Status do not need legends, labels is enough. labels should
   include the color, the number of issues and the percent."
10. "In dashboard, issues by department and issues by champion, wrap text of label if cannot fit in
    1 line. also center label but if left side of label crosses the y-axis, convert to left align.
    also change label to X/Y (_%) open instead of X open of Y issues."

### Item 1 — the lesson tag is gone from the Issues list

The `hasLesson(r)`-gated `.il-lessontag` span is removed from the Issue cell in `renderIssuesLog()`.
`hasLesson()` itself is untouched — it still gates the close-workflow's "a lesson is already on
record" branch, and the lesson is still one click away from an issue's own detail page (Related
lessons). The now-unreferenced `.il-lessontag`/`.il-lessontag .pd-ico` CSS is deleted rather than
left as rot.

### Item 2 — Issue / Caused By / Corrective Action widened

`.il-cell-wrap { max-width: 420px }` → `620px`, `.il-table { min-width: 1080px }` → `1400px` so the
header and body columns keep agreeing at the new width.

### Item 3 — a List | Kanban toggle, shared between Issues and Lessons

⚠️ Built as ONE shared pair of helpers (`viewKanbanBarHTML`/`wireViewKanbanBar`/`kanbanGroups`/
`kanbanBoardHTML`) rather than two near-identical boards — the toggle is the same `.pd-viewtoggle`/
`.pd-vt` component Progress Photos' List/Gallery switch already uses, so this isn't a new UI pattern,
just a new use of an existing one.
- Each screen keeps its **own** view/group state (`_issView`/`_issKanbanGroup`,
  `_lessView`/`_lessKanbanGroup`) — a planner may want the Issues log as a board and the Lessons log
  as a table, or the reverse, and neither resets on a project switch (a presentation preference, not
  project data, the same rule `_issSort`/`_lessSort` already follow).
- The board groups by Department or Champion (a picker that only appears once Kanban is actually
  chosen). **Champion grouping reads the SAME `latestChampionText()` the log column shows** — a card
  reading "assigned to Cruz" that disagreed with the table would be worse than no grouping at all.
- ⚠️ **A lesson has no champion of its own.** `lessKanbanChampion()` resolves it through the
  lesson's linked issue (the same indirection `lessonResolvedDate()` already uses to reach an
  issue's `date_resolved`) — a lesson with no linked issue falls into "(no champion)".
- ⚠️ Blank/"(no …)" buckets always sort LAST, never alphabetically — a board where the unassigned
  pile is buried mid-alphabet is how it gets mistaken for a small group rather than the backlog it
  usually is.
- The board reads the SAME filtered set the table would (`issuesFiltered()`/`lessonsFiltered()`) —
  a board that ignored the Open-by-default filter would show closed issues nobody asked for the
  moment it was switched to. It has no column sort of its own (a board has no row order to sort).
- **Issues screen: new static containers** (`#il-issues-viewbar`/`#il-issues-listwrap`/
  `#il-issues-kanban` in `index.html`) — the existing `#il-table` is written to directly by both
  `renderIssuesLog()` and the transient "Loading…"/"Select a project" states in `load()`, so it stays
  a real DOM element rather than being rebuilt from a string each time; `renderIssuesLog()` shows
  exactly one of `#il-issues-listwrap`/`#il-issues-kanban` at a time. ⚠️ `load()` now resets both to
  their list-view defaults at its very start — otherwise a load kicked off while a board was showing
  would write its transient messages into the now-hidden `#il-table`, invisible until the render at
  the end of `load()` re-applied the current view.
- **Lessons screen: no HTML changes needed** — `renderLessonsLogView(host)` already rebuilds its
  whole host from a string on every call, so the toggle bar and the board are folded straight into
  that string.

### Item 4 — KPI bands squeeze to one row (except on a phone)

`.il-kpis`/`.il-kpis-2` go `repeat(4,1fr)`/`repeat(2,1fr)` (was 5/3 — the aging tiles below are
dropped) and STAY there down to phone width; the old `@media (max-width:1000px)` 3-column
compression rule (built for the 5-tile band's 3-over-2 auto-place) is deleted along with the tile it
existed for. Only at ≤700px do the bands get to wrap — Issues' 4-tile band drops to 2-over-2 there
(four tiles across a 375px screen leaves each too narrow to read its own number); Lessons' 2-tile
band was already 2 across.
- `renderIssueKpis()` drops its "Avg aging (open)" tile → exactly Total/Open/On Hold/Closed.
- `renderLessonKpis()` drops its "Avg aging (d)" tile → exactly Lessons learned/Issues closed.

### Item 5 — Lessons list: Lesson Learned and Issue as two real columns

The value that used to render as a small `.il-lcard-src` sub-line under the lesson text
(`lessonSourceText()`: the linked issue's text, "From a meeting: …", or "Captured on its own") is
now its own **Issue** column, sharing the SAME `.il-cell-wrap` class item 2 just widened — one width
decision, both tables' wide columns benefit. Department and Date Resolved get their own narrow
classes (`.il-ls-dept` max-width 120px, `.il-ls-date` max-width 90px + nowrap — a date never needs to
wrap). Aging is dropped from the table (its KPI tile is already gone, per item 4 — a column repeating
a number two clicks from where it's acted on). `.il-lcard-src`/`.il-src-issue` CSS deleted; they had
exactly one remaining reference and it was a stale comment, not code.

### Items 6/7/8 — the lesson's own Background section: renamed, read-only, and its "open issue" moved

- **Item 6:** the lesson's OWN toolbar (`.il-mom-toolbar` — the state pill + `openIssueBtn`) is
  removed from `lessonDetailHTML()` entirely. The embedded issue's OWN toolbar (a second, separate
  `.il-mom-toolbar` inside `issDetailHTML()`, reading "Issue in the register" / "New issue — not yet
  saved") is now suppressed too, via a new `opts.hideToolbarState` flag — the section's own header
  already says what the block is. "The issue this lesson came from" → **"Background"**.
- **Item 7:** a new `opts.readOnly` flag forces `mayEdit = false` regardless of `canEditRow(r)` —
  "the issue should not be editable" from a lesson's own page, full stop, even for a planner who
  normally could edit it. Related lessons + "+ Add another lesson" are gated independently
  (`canAdd`/`isSteward`, never on `ro`) and are untouched by this flag, exactly as asked. The current
  lesson is excluded from that embedded issue's own "Related lessons" list via the existing
  `opts.excludeLessonId` (built 2026-09-01, reused here) — "include only the others."
- **Item 8:** the "open the real issue" button moved out of the lesson's own toolbar (removed by
  item 6) and into the Background section's own header, top right (`.il-less-bg-head`, a flex-row
  modifier on the existing `.il-dash-sec-head` eyebrow style) — reusing the SAME id/attribute
  `wireLessons()` already wires (`#il-less-openissue` → `openIssue(dataset.openIssue)`), so no new
  wiring was needed for it to work from its new position.

⚠️⚠️ **A REAL BUG, FOUND ONLY BECAUSE THE THREE NEW `opts.*` FLAGS WERE EXECUTED, NOT JUST READ.**
`issDetailHTML(r, opts)` had an internal helper — used to build a handful of `<select>` option
lists — ALSO named `opts`: `function opts(list, val, blank) { … }`, declared inside the same
function body as the `opts` PARAMETER. A function DECLARATION hoists and takes over its scope's
binding for that name before a single statement runs, so `opts` was already this helper — not the
caller's object — by the time `mayEdit`/`excludeId` were computed a few lines later. Confirmed with
a throwaway Node repro before touching anything: `typeof opts` inside the body reads `'function'`
from the very first line, never the object passed in. Consequence: `opts && opts.readOnly` was
testing a function object (which has no `.readOnly`) and was **always falsy** — items 6's toolbar
suppression and item 7's read-only lock would have silently done NOTHING; only `excludeLessonId`
(built in an earlier round, same collision, same bug) happened to already be broken the same way.
Fixed by renaming the inner helper to `selOptsHTML` and its one call site. ⚠️ Two OTHER functions in
this file (`lessonDetailHTML`, `openQuickLessonModal`) declare their own local `opts(list,val,blank)`
too, but neither takes an `opts` PARAMETER, so there is no collision there and nothing to rename.
Verified the fix with a `vm` + permissive-`Proxy` harness executing the real, unmodified
`issDetailHTML` straight out of the shipped file (see Verified below) — every flag now measurably
does what it says, and a normal (no-`opts`) call from the real Issues screen is provably unaffected.

### Item 9 — Issues by Status: no separate legend, the donut's own labels carry it

`donutChartSVG()`'s per-slice label gained a coloured "●" `<tspan>` (inheriting the slice's own
colour) ahead of the existing `Label: N` text, plus a computed percent: `● Open: 3 (75%)`. The Status
card's separate legend row (`statusLegendTop`) is deleted — the donut now states colour, count and
percent in one place, so a legend repeating the same three facts is dropped rather than kept as
decoration. `barLegendTop` (the Department/Champion tiles' own header legend, from an earlier round)
is untouched — those bars don't carry per-row colour the way a donut slice does.

### Item 10 — Issues by Department/Champion: wrapped, y-axis-aware centring, "X/Y (Z%) open"

`hbarSVG()` rebuilt around three new helpers: `ilCharW`/`ilTextW` (a deterministic, DOM-free
per-character width estimate — this verification harness has no browser/canvas to measure real text
with) and `ilWrapLines(label, maxW, fs)`, which word-wraps a label to **at most 2 lines** (a row's
height must stay bounded; every word past the first line's break is appended to the second
regardless of width, never wrapping to a third). A single word wider than the column on its own is
placed unbroken — never character-truncated, this module's own established rule ("overflows rather
than being cut, with nothing on screen saying more was cut off").
- Each row's label is **centred** in its column by default. ⚠️ If centring would push the label's
  LEFT edge past the chart's own left boundary (x=0, "crosses the y-axis"), it falls back to
  **left-aligned** instead — decided once per label off its WIDEST line, so a wrapped label's lines
  stay consistently aligned with each other rather than each line deciding independently.
- The in-bar text changed from "N open of N issues" to **"X/Y (Z%) open"**, with a stroke halo (the
  tile's own card colour) so it stays legible over whichever segment (Total track or Open fill) it
  lands on.
- Rows are still never capped (unchanged from the prior round) — every department/champion is
  always shown; the caller's scrollable panel absorbs a long list.

### ⚠️⚠️ A REAL BUG THIS BUG FOUND WHILE VERIFYING

See items 6/7/8 above — the `opts`-named-inner-helper collision inside `issDetailHTML`. Recorded
here too because it is, by a wide margin, the most consequential finding of this round: without it,
items 6 and 7 would have shipped as text changes with no actual effect, and the owner's explicit "the
issue should not be editable" would have quietly continued to render an editable form.

### Verified

- `node --check module.js` clean; CSS braces balanced 283/283 (was 272/272 before this round — net
  new rules from the Kanban board + the narrowed Lessons columns).
- 0 duplicate DOM `id=` attributes in `index.html` after adding `#il-issues-viewbar`/
  `#il-issues-listwrap`/`#il-issues-kanban`.
- Function-name-set diff against `origin/main`: **0 functions lost, 18 added** — `ilCharW`, `ilTextW`,
  `ilWrapLines` (item 10), `viewKanbanBarHTML`, `wireViewKanbanBar`, `kanbanGroups`, `kanbanBoardHTML`,
  `issKanbanGroupKey`, `issKanbanCardHTML`, `issKanbanHTML`, `wireIssKanban`, `lessKanbanChampion`,
  `lessKanbanGroupKey`, `lessKanbanCardHTML`, `lessKanbanHTML`, `wireLessKanban`, `wireBar` (item 3),
  and `selOptsHTML` (the item 6/7/8 bug fix's rename).
- Repo-wide grep: 0 remaining references to `.il-lessontag`/`.il-lcard-src`/`.il-src-issue` outside
  explanatory comments; every new class emitted by `module.js` (`.il-viewbar`, `.il-kanban*`,
  `.il-ls-dept`, `.il-ls-date`) resolves to at least one CSS rule.
- **Every new/changed function EXECUTED, not just read**, via a Node `vm`+`Proxy` harness sliced
  straight out of the shipped file (never reimplemented): `hbarSVG` (centred vs. left-align fallback,
  the 2-line wrap cap, an unbroken over-wide word, zero-total with no `NaN`, the `X/Y (Z%) open`
  format, multi-row rect counts), `donutChartSVG` (the `●`-marker + percent label format),
  `kanbanGroups`/`kanbanBoardHTML`/`viewKanbanBarHTML`/`wireViewKanbanBar` (grouping + "(no …)"
  sorts-last, the empty-board message, the toggle's active-button + pre-selected group, and that
  clicking List/Kanban/the group-select fires exactly the right callback), `issKanbanHTML`/
  `lessKanbanHTML` (department AND champion grouping, including champion resolved through a lesson's
  linked issue) — and, decisively, the FIXED `issDetailHTML` itself: `readOnly:true` now measurably
  disables every field and drops the workflow buttons, `hideToolbarState:true` now measurably drops
  the toolbar, `excludeLessonId` now measurably excludes just that one lesson from Related lessons —
  and a normal call with no `opts` (the real Issues & Concerns screen's own usage) is provably
  unaffected: toolbar shown, fields editable, both lessons listed.

⚠️ **Not verified signed-in** — this environment has no live Supabase login, the standing constraint
for every UI pass in this module. No live click-through of the Kanban toggle/board against real
project data, the widened columns' actual rendered width, or the Background section's new "Open
issue" button against a real linked issue.

`module.css/js?v=` → `20260902b`; `MODULE_V` (via `modules-grid.js?v=` on
`dashboard.html`/`modules.html`) → `20260902ak`.

## 2026-09-02 — Title dedup extended to all 3 screens, Related lessons as a numbered list, denser table, Reopen from Closed, and export to Excel/PDF/HTML

Owner's 9-item list: (1) the module title is still showing "to the left" on Issues & Concerns and
Issues Dashboard — only Lessons Learned had it removed; (2) a lesson's own detail view should be
the same layout as an issue's, with the lesson above the issue, not two differently-shaped blocks;
(3) that embedded issue's own lesson list should exclude the current lesson and read "Related
lessons"; (4) a button to open the referenced issue, and every lesson added straight from the
Lessons Learned screen must log a real issue behind it; (5) that lesson list should be a numbered
list of lesson text only, not tiles; (6) smaller, denser table fonts, text allowed to overflow, and
the Issue/Caused By/Corrective Action columns widened; (7) no reporting view; (8) export Issues and
Lessons Learned as Excel/PDF/HTML; (9) a Reopen button on a Closed issue, not just On Hold.

**Items 2 and half of item 4 were already built** (entries (f)/(g)/(h)): `lessonDetailHTML` already
reuses `issDetailHTML`'s `.il-iss-split`/`.il-iss-panel`/`.il-iss-body` layout with the lesson above
the embedded issue, and `newLessonAsClosedIssue()` already routes every "+ New lesson" click from
the Lessons screen through the full issue-to-closure form — so a lesson created there has always
logged a real (Closed) issue behind it. This entry closes the remaining gaps.

### Item 1 — the title was hidden on Lessons only

⚠️ Entry (h)'s fix scoped the always-hide to `s === 'lessons'` — deliberate at the time, but the
owner's report names Issues & Concerns and Issues Dashboard too. `switchScreen()` now hides the
whole `<h1>` on **every** screen: `.il-tabs`' dropdown trigger already names whichever of the three
is active, so the module title duplicates it everywhere, not just on Lessons. ⚠️ Still a full
element hide (never text-only) — hiding only `.il-title-txt` is the exact defect entry (h) traced
("icon alone on a line, dropdown label on the next"); hiding the whole `<h1>` leaves nothing
standing for that to happen to.

### Item 3 — "Related lessons", not "Lessons learned from this issue"

Heading renamed in `issDetailHTML`. The exclusion (`opts.excludeLessonId`, so the lesson you're
already looking at never lists itself as "related" to itself) was already correct and untouched.

### Item 4 — an explicit "Open issue" button

`lessonDetailHTML`'s toolbar gains **"Open issue in Issues & Concerns →"** (only when the lesson
has a real `issue_id`) — reusing `openIssue()`, the same entry point the log/dashboard/step-through
already use, so it switches to the real Issues & Concerns screen rather than merely scrolling to
the read-embedded copy already sitting below on the same page. It replaces the toolbar slot the
removed Reporting-view toggle (item 7) used to occupy.

### Item 5 — a numbered list, lesson text only

The "Related lessons" section's tile/card grid (`lessonCardHTML`, `.il-lessons.il-lessons-inline`)
is replaced with a plain `<ol>` of lesson text — no department chip, date, or action buttons, just
the line, clickable to open. ⚠️ `lessonCardHTML` is **removed outright** — its only caller was this
section, and nothing else in the module ever called it (checked before deleting, not assumed).
Reuses `wireIssues()`'s existing generic `[data-open-lesson]` wiring, so no new event handler was
needed. The now-dead `.il-lessons`/`.il-lcard*`/`.il-chip` CSS (that tile grid's own styling) is
removed with it; `.il-lcard-src`/`.il-src-issue` are **kept** — `renderLessonsLogView` still uses
them for the source line under a lesson's own row in the Lessons Learned table.

### Item 6 — a denser, more minimalist table

`.il-table` drops to 12.5px body / 11px header font (was inherited ~14px); `.il-cell-wrap` (the
Issue / Caused By / Corrective Action / Lesson Learned cells) widens 320px → 420px; `min-width`
raised 980px → 1080px to fit. ⚠️ **`-webkit-line-clamp` removed from the desktop `.il-clip` rule** —
a clamped cell hid text with nothing on screen saying more had been cut off, exactly what "allow
text overflows as needed" asks to stop. ⚠️ The **mobile card view's own 4-line clamp had to keep its
own complete definition** (`display:-webkit-box`/`-webkit-box-orient`/`overflow`, not just
`-webkit-line-clamp`) — it previously borrowed those three properties from the desktop rule I just
stripped them from, and `-webkit-line-clamp` alone does nothing without them.

### Item 7 — no reporting view (lessons)

`_lessReport` and its toolbar toggle (`#il-less-report`) are removed from `lessonDetailHTML` —
issues already lost theirs in an earlier round (entry note: "the separate 'Reporting view'
read-only toggle this used to also fold in is gone"), lessons hadn't caught up. `ro` in
`lessonDetailHTML` now means exactly what it means on an issue's page: edit permission, full stop.

⚠️ **Found while removing it: an entire CSS block for a Minutes-of-Meeting-style reporting view
(`.il-mom-report`) was already 100% dead in this file** — it targeted ids (`#il-mom-additem`,
`#il-mom-carry`, `#il-mom-save`, …) belonging to the *other* module this file split out of in
2026-08-31, and nothing in `module.js` had set that class on an Issues/Lessons host since the
issues-side toggle was removed in an earlier round. Confirmed dead (grepped for every `.add`/
`.toggle` of the class — none), then removed along with the three vestigial
`host.classList.remove('il-mom-report')` calls that were its only remaining trace.

### Item 8 — export to Excel / PDF / HTML

New **Export ▾** control in the topbar tool cluster (beside Refresh), offering the currently
**filtered and sorted** Issues or Lessons list (whichever screen is active) — the same list
`issuesFiltered()`/`lessonsFiltered()` + the active `_issSort`/`_lessSort` already render on screen,
so an export can never disagree with what's on it. Hidden while a single record's detail is open or
on the Dashboard tab (nothing there is "the list").

- **Excel** — the same SheetJS convention this suite already uses elsewhere (`aoa_to_sheet` →
  `book_new` → `writeFile`), loaded from the same pinned CDN build (`xlsx@0.18.5`) every other
  exporting module already loads.
- **HTML** — a self-contained file (inline `<style>`, no external references) built as a string and
  downloaded via `Blob` + a throwaway `<a download>`, so it opens correctly offline.
- **PDF** — `html2pdf.js@0.10.1`, the same pinned CDN build minutes-of-meeting and progress-photos
  already load, landscape (these are wide tables). ⚠️⚠️ **Follows the "normal flow" rule this repo
  already learned the hard way** (minutes-of-meeting's `momDownloadPDF`): the captured node must
  stay in normal flow — html2pdf clones it into its own container and measures it there, so an
  out-of-flow node contributes zero height and produces a silently blank PDF. The off-screen parking
  goes on a separate holder (`position:fixed;left:-10000px`); the rendered `wrap` sits in normal
  flow inside it. Cleanup runs in `finally`, so a thrown export can't leave a stray node behind for
  the next one to stack on top of.

### Item 9 — Reopen offered from Closed too

`canReopen` widened from `status === 'On Hold'` to `status === 'On Hold' || status === 'Closed'`.
No change needed to `confirmReopenIssue()` — it already just sets status back to `Open` with a
required Action Plan, which is exactly as sound a transition from Closed as it always was from On
Hold. `date_resolved`/`closure_report` are deliberately left as historical record of the last
closure; a later re-close overwrites both with fresh values, same as before.

### Verified

- `node --check` clean on `module.js`.
- 0 NUL bytes across `module.js`/`module.css`/`index.html`.
- CSS braces balanced: 272/272 (was 281/281 before the dead-code removals below).
- 0 duplicate DOM `id=` attributes in `index.html`; `<div>` tags balanced (28/28).
- Function-name-set diff against `origin/main`: **1 function removed (`lessonCardHTML`, its only
  caller replaced), 6 added** (`closeExportMenu`, `exportRows`, `exportRegister`,
  `exportExcelFile`, `exportHTMLFile`, `exportPDFFile`) — all deliberate.
- Repo-wide grep confirms no other file references any of the removed classes (`il-lcard`,
  `il-chip`, `il-lessons`) or the removed `_lessReport`/`il-mom-report` mechanism.

⚠️ **Not verified signed-in** — this environment has no live Supabase login, the standing constraint
for every UI pass in this module. No live click-through of the export menu against real filtered
rows (in particular, no PDF has actually been opened, no `.xlsx` has actually been read back, and
no HTML export has actually been opened offline), the Reopen-from-Closed workflow against a real
row, or the numbered "Related lessons" list's click-to-open against real linked lessons.

`module.css/js?v=` → `20260902a`; `MODULE_V` (via `modules-grid.js?v=` on
`dashboard.html`/`modules.html`) → `20260902u`.

## 2026-09-01 (h) — Mobile pass off a phone screenshot: the duplicate title, KPI/chart tile layout, touch reorder, and the lesson detail's field arrangement

Owner sent a phone screenshot of the live Issues & Concerns screen — the module `<h1>` ("Issues &
Concerns") crossed out in red, sitting directly above the tabs-dropdown trigger reading the same
thing — with 10 items. Two touch shared files (`assets/js/ui.js`, `assets/css/dashboard.css`); the
rest are module-local.

### Item 1 — the duplicate title on mobile

⚠️ **The earlier fix (entry (f)) only hid the duplicate ≥701px.** `UI.tabsToDropdown()` marks the
title text `.pd-title-hasdrop`, and dashboard.css hid it `@media (min-width:701px)` on purpose —
below 700px `.pd-modulebar > h1` is forced onto its own full-width row (the phone stacking rule),
and hiding just the TEXT there would leave a bare icon alone on that row with the dropdown
trigger's own label on the row after it, which is the exact "icon alone / label on the next line"
defect this file's own history (`issues-lessons/module.css`, "REMOVED 2026-08-31") already fixed
once. The screenshot showed the opposite problem — the FULL duplicate text, not a bare icon — so
the earlier caution didn't actually cover this case.

Fixed by marking the **`<h1>` itself**, not just its text span (`pd-h1-hasdrop`, added in
`tabsToDropdown()` right beside the existing `pd-title-hasdrop`), and hiding the whole element
below 700px (`.pd-modulebar > h1.pd-h1-hasdrop { display: none; }`). ⚠️ **This removes the row
entirely rather than leaving it half-empty** — with no separate icon row left at all, there is
nothing left to read as "alone", so the old defect can't recur through this door either. Desktop
(≥701px) is untouched: the icon still rides the same row as the dropdown trigger and tools, which
is the wanted look there.

### Item 2 — the 5-tile KPI band compresses to two rows on narrow screens

⚠️ **Root cause: `.il-kpis` (the Issues screen's 5-tile band) was narrowed to 2 COLUMNS at both
≤820px and ≤700px**, and 5 items over 2 columns auto-place as 2+2+1 — three rows, with the last
tile (AVG AGING) stranded alone on a mostly-empty third row, exactly the screenshot. Fixed by
**not** narrowing `.il-kpis` (without the `-2` suffix) below the existing ≤1000px rule, which
already sets it to 3 columns — kept at 3 all the way to phone width, so 5 tiles over 3 columns
auto-place as 3+2, always exactly two rows, the tiles just getting narrower rather than gaining a
third row. ⚠️ `.il-kpis-2` (the smaller 3-tile bands — e.g. the Lessons screen's own band, item 10
below) is untouched and still narrows to 2 columns at ≤820px — a 3-tile band reading fine at 3
columns needs no such fix.

### Item 3 — reordering on a touch device did nothing

⚠️ **Not a bug in the drag code — a whole input model that doesn't exist on touch.**
`dragGripHTML`/`wireReorder` are pure HTML5 native drag-and-drop (`draggable="true"`,
`ondragstart`/`ondragover`/`ondrop`), and touch devices never fire those events at all — reordering
"does nothing" on a phone by construction, not by a fault in the gesture handling.

Rather than reimplement drag-and-drop on top of touch/pointer events (real risk of fighting the
page's own scroll gesture, and nothing here can be verified against a real touchscreen in this
environment), a **move-up / move-down button pair** does the same job with no gesture at all.
`moveButtonsHTML(id, isFirst, isLast)` renders two small buttons; `wireReorder` now also wires
`[data-moveup]`/`[data-movedown]` clicks, computing the row's neighbour in the currently-displayed
`list` and calling the **same `applyReorder`** the drag handle already uses (fed a computed
neighbour id instead of a drop target) — so drag and the buttons can never disagree about what
"move" means, and there is exactly one reorder/renumber code path, not two. CSS shows the drag grip
by default and swaps to the move buttons below 700px, since dragging genuinely doesn't work there
and a control that does nothing is worse than none.

⚠️ **Sized smaller than this app's usual 44px touch minimum, deliberately** — a full-size control
here would make every row noticeably taller across the whole register for one small cell, and a
step button's target (move one place) tolerates an imprecise tap far better than a primary action
does: a miss just needs a second tap, not the wrong record touched.

### Item 4 — dashboard chart tiles need not share height below 1000px

⚠️ **Reverses part of entry (g)'s item 1**, on purpose, per this round's explicit ask. The fixed
`.il-dash-cardbody { height: 340px; }` (and the internal scroller it exists to bound) is now a
wide-screen-only rule — below 1000px the three tiles are no longer a strict single row (they stack
2-up or 1-up per the existing `.il-dash-grid` breakpoints), so forcing three differently-shaped
charts to share one height stops being what makes them read as "one row"; each tile now sizes to
its own content there instead.

### Item 5 — donut chart: a label beside each section

`donutChartSVG` gained per-slice labels, not just the top-right legend added in entry (g). Each
non-zero slice's midpoint angle is computed from its own cumulative arc offset, and a label
("Open (2)") is placed just outside the ring at that angle, anchored toward whichever side of the
circle it falls on (right of the ring reads outward from it; left of the ring anchors from its own
end so it also reads away from the arc; top/bottom centre) — so a label never sits through the arc
it names. ⚠️ **A zero-value slice gets no label** — "Closed (0)" floating beside an otherwise-empty
arc position would read as a data point that exists when it doesn't.

⚠️ The viewBox is widened to give the labels room, with the ring drawn inside a translated `<g>` so
its own coordinate math (built for the un-padded box) needed no changes. The SVG renders at
`width="100%"` (matching `hbarSVG`'s own scaling convention) so it shrinks to fit a narrow tile
instead of a fixed pixel width overflowing it, capped by a new `.il-donut-svg { max-width: 260px; }`
so it can't grow oversized on a wide single-column mobile layout.

### Item 6 — department/champion bar labels overflow instead of truncating

`hbarSVG`'s row labels were character-truncated to 24 chars with an ellipsis (`clip(it.label, 24)`)
— removed; the full label now renders regardless of length. ⚠️ Most browsers default a root `<svg>`
to `overflow:hidden`, which would have silently clipped anything running past the viewBox even
without the character truncation — the returned `<svg>` now carries `overflow="visible"` so a long
name genuinely overflows past the fixed label column rather than being cut, matching the literal
ask. The `.il-dash-cardbody-scroll` wrapper's own `overflow-y:auto` already computes `overflow-x`
to `auto` too per the CSS spec's cross-axis rule (an explicit `overflow-y` value forces a `visible`
`overflow-x` to compute as `auto`), so an overflowing label scrolls into view horizontally rather
than spilling onto neighbouring page content.

### Item 7 — the Open Issues and Lessons Learned dashboard tiles scroll internally

Both tiles' inner `.pd-tablewrap` (the shared horizontal-scroll wrapper every wide table in this
app uses) now also caps at `max-height: 400px; overflow-y: auto;` — scoped to
`.il-dash-fulllist-card .pd-tablewrap`/`.il-dash-lessons-card .pd-tablewrap` specifically, since
`.pd-tablewrap` itself is a shared utility class used unbounded everywhere else in the app and must
stay that way.

### Item 8 — the lesson detail view now mirrors the issue detail's own field arrangement

⚠️ **Corrects entry (g)'s item 7**, which built the lesson's own fields in a bespoke shape (a
`.il-form-row` pair, one textarea, a "what produced it" section, a save row) stacked ABOVE a
completely separately-shaped, full `issDetailHTML` block for the linked issue. This round's ask —
"same contents as issues including order and arrangement of fields, only the header differs" —
reads as: the lesson's OWN block should use the same STRUCTURE issues use, not a second, different
layout.

`lessonDetailHTML` now builds its content with the identical `.il-iss-split` /
`.il-iss-panel` / `.il-iss-body` two-pane layout `issDetailHTML` already uses (reused verbatim, not
a second copy of the classes), in the same relative order: **panel** — Department, then Date
Captured (the same relative order Department and Date Raised hold in an issue's own panel); **body**
— the Lesson Learned textarea (the position an issue's primary narrative field occupies), then, at
the foot of the body pane, "what produced this lesson" when unlinked — the same structural position
an issue's provenance line (`il-iss-prov`) occupies. Save/Cancel/Delete sit below the split, in the
same position `issDetailHTML`'s workflow row does. ⚠️ Only the toolbar's state text (already
lesson-worded via `lessonSourceText`) and the field labels differ from an issue's page — the
arrangement itself is now identical. The embedded full issue block below (when linked) is
unchanged from entry (g) — this round's wording doesn't retract it, only corrects the shape of the
lesson's own block above it.

### Item 9 — lesson list labels: "Lesson Learned", and "From an issue" → "Issue"

The Lessons Learned list's column header (and its mobile-stacked `data-l` label) changed from
"Lessons" to **"Lesson Learned"**. `lessonSourceText(l)`'s issue-linked case changed from
`'From an issue' + ...` to `'Issue' + ...` — the only case the ask named; the meeting-linked and
standalone cases ("From a meeting", "Captured on its own") are untouched.

### Item 10 — the Lessons Learned KPI band is exactly three tiles

`renderLessonKpis()` rewritten from `Lessons captured / From a closed issue / Departments` to
exactly three: **Lessons learned** (count), **Issues closed** (project-wide `rows` count of
`status === 'Closed'`, not scoped to only issues with a lesson attached — the two registers read
side by side), and **Avg aging (d)** — the mean of every lesson's own `lessonAgingDays(l)`. ⚠️ Reuses
the SAME function the list's own Aging column already reads, so the tile and the column can never
disagree about what one lesson's aging is.

### Verified

- `node --check` clean on both touched JS files (`module.js`, `assets/js/ui.js`).
- 0 NUL bytes across every touched file.
- CSS braces balanced: `module.css` 285/285, `dashboard.css` 427/427.
- 0 duplicate DOM `id=` attributes in `index.html` (unchanged this round — no markup was added or
  removed there; every new control is rendered dynamically by JS into existing containers).
- `<div>` tags balanced (26/26, unchanged — `index.html` untouched this round).
- Function-name-set diff against `main`: **0 functions lost, 1 added** (`moveButtonsHTML`) in
  `module.js`; **0 lost, 0 added** in `ui.js` (the fix there is inline inside the existing
  `tabsToDropdown`, not a new named function).
- 0 leftover git conflict markers repo-wide after the branch restart (see below).

⚠️ **Not verified signed-in** — this environment has no live Supabase login, the standing constraint
for every UI pass in this module. No live click-through of the move-up/move-down buttons on a real
touch device, the donut label placement against real slice values, the bar-label horizontal
overflow-scroll, or the restructured lesson detail view's live save/cancel/delete cycle.

`module.css/js?v=` → `20260901j`; shared `assets/js/ui.js?v=` / `assets/css/dashboard.css?v=` →
`20260901d` (app-wide — 20/28 referencing files respectively); `MODULE_V` (via `modules-grid.js?v=`
on `dashboard.html`/`modules.html`) → `20260901s`.

## 2026-09-01 (g) — Dashboard tile sizing/legends, list ordering, Lessons Learned reworked to embed the source issue, sortable columns

Owner's 10-item list, verbatim: (1) the three dashboard chart tiles should share one height;
(2) legends move to the top right to compact the view; (3) Open Issues sits above Lessons Learned;
(4) the Lessons Learned tile carries a count of lessons; (5) the issues list label reads "X open of
X total issues" instead of "X issues"; (6) the new-lesson form's labels all say "lesson", never
"issue"; (7) the Lessons Learned list drops "Open the Issue", and opening a lesson shows the lesson
on top with the full issue below it (details, other lessons, update history); (8) the Lessons
Learned list matches the Issues list's shape — Department / Lessons / Date Resolved / Aging;
(9) clicking a column header on either list cycles ascending → descending → natural order;
(10) the Lessons Learned logo + label are dropped — the screen dropdown already names it.

### Items 1/2/3/4/5 — the Dashboard tiles

⚠️ **Height equality had to be a fixed box, not `align-items:stretch` alone.** `.il-dash-card`
already stretched to match its row-mate under CSS Grid, which is why the earlier "size the Status
tile to its content" pass (entry (f)) had them at different heights on purpose — this round asks
for the opposite, so each card now carries a `.il-dash-cardhead` (title + legend, sized to its own
content) over a fixed **340px `.il-dash-cardbody`**, the same box for the donut, the department bar
and the champion bar regardless of how many rows/slices each one holds. The donut centres inside it
(`.il-dash-cardbody-center`); the two bar charts scroll inside it when their row count would
otherwise force the card taller (`.il-dash-cardbody-scroll`) — a bar chart with many departments no
longer stretches its card past its siblings, it scrolls its own body instead.

⚠️ **The legend moves to the card's header row, not just "up."** `barLegendTop`/`statusLegendTop`
render inline beside the title (`.il-dash-cardhead` is a flex row, title left / legend right), so
the chart body itself is legend-free — freeing real vertical room in the fixed 340px box rather
than shrinking the chart to make space for a legend still sitting inside it.

⚠️ **Open Issues now renders before Lessons Learned in source order**, not merely visually
reordered with CSS — the two full-width tiles at the foot of the dashboard are built by one
function each, called in the new order, so there is no `order:` override to drift out of sync with
a future edit.

⚠️ **The Lessons Learned tile reuses the same `.il-dash-fulllist-head`/`-count` pair Open Issues
already had**, rather than inventing a second count style — "N lessons" sits in the same visual slot
"N open of M total issues" does, so the two full-width tiles read as one family.

⚠️ **The issues-list label change is a wording fix, not a new count.** `fullIssueListHTML` already
received the filtered list; it just never received the *unfiltered total* to compare against. The
function signature widened to take a second `totalCount` argument (both call sites — the Dashboard
tile and wherever else it's built — pass the true unfiltered count), and the label became
`"<open> open of <total> total issue(s)"`.

### Item 6 — lesson-form labels no longer say "issue"

⚠️ **The lesson editor was literally the issue editor with an `opts.excludeLessonId` filter** —
`issDetailHTML(r, opts)` renders one shared template for both screens, so "toolbar state text",
section headings ("Issue" / "Caused By" / "Date Raised"), and their placeholders all read as if
the row being edited were an issue, even when it's a lesson's *linked* issue shown for context, or
— per item 7 below — the issue is now embedded ABOVE the lesson rather than the other way around.
A new `forceClose`-style gate (reusing the existing conditional-rendering shape the function already
had for its Close-workflow copy) swaps every one of those strings to their lesson-facing equivalent
("How It Was Resolved" / "What Happened" / "Root Cause" / "Date Captured") whenever the template is
rendering in lesson context, so the same markup serves both screens without duplicating the layout.

### Item 7 — opening a lesson now embeds its source issue, not the reverse

⚠️ **This is the largest structural change in the batch, and it deliberately reuses the Issues
screen's own renderer rather than building a second one.** `renderLessonDetailView(host)` is
rewritten to render the lesson on top (`lessonDetailHTML`) and, when the lesson has a linked issue,
the **full issue detail below it** — reusing `issDetailHTML`/`wireIssues` verbatim so the embedded
issue gets the exact same Save/Hold/Reopen/Close/Delete affordances, History section and "other
lessons on this issue" list the real Issues screen has, rather than a second, thinner read-only copy
that would drift the moment either was edited.

⚠️ **The embed borrows the Issues screen's own global state (`_issSel`/`_issMode`/the workflow
toggles), and that state is saved and restored around the borrow.** Those globals are what every
workflow button and `refreshIssueView()` call already act on, so reusing them (rather than adding a
parallel `_embedIssSel`) is what makes the embedded buttons work correctly with zero new plumbing —
but it also means viewing a lesson would silently overwrite whatever issue the real Issues screen
had open. New `_issEmbedSaved` captures `{sel, mode, hold, close, reopen}` the moment a lesson's
embed diverges from what Issues already had selected, and `switchScreen()` restores it the moment
the Lessons screen is actually left — so returning to Issues shows what was really open there, not
whatever a lesson happened to link to.

⚠️ **The two screens' hosts are cleared on every screen switch**, not just repainted over — without
this, reusing `issDetailHTML`'s ids inside `#il-lessons-view` while `#il-issues-view` still held its
own copy from a previous session state would produce **duplicate DOM ids** (`il-iss-back`,
`il-champ-list`, etc.), exactly the class of defect this module's own established verification
checklist checks for. `switchScreen()` now blanks whichever of `#il-issues-view`/`#il-lessons-view`
is NOT the target screen.

⚠️ **History repaints on the embedded issue too, not only on the real Issues screen.**
`loadIssueHistory`'s completion callback only ever repainted when `_issMode === 'detail'` — true
only on the real screen — so the embedded issue's History section would have been stuck reading
"Loading history…" forever. The condition is widened to also match
`screen === 'lessons' && _lessMode === 'detail'`, and the fetch itself is triggered on entry to the
lesson-detail view (fresh switch always fetches; revisiting the same lesson only fetches if not
already cached, so re-renders don't refetch on every incidental repaint).

⚠️ **Every `renderIssues()` call inside the workflow/save functions (hold, reopen, close, save,
delete-lesson-quick-modal) is now `refreshIssueView()`** — a one-line dispatcher that repaints
Lessons when that's the active screen and Issues otherwise, so saving/closing/reopening an issue
from inside the embedded view repaints the Lessons screen it's actually showing on, rather than
silently repainting a hidden `#il-issues-view` nobody is looking at. Left untouched: 8 other
`renderIssues()` call sites that are already screen-aware by construction (filter handlers scoped
to `#il-f-*`, the top-level dispatcher, `refreshIssueView()`'s own else-branch, and the
open/back/new-issue screen-entry functions) — each was checked individually before being excluded.

⚠️ **Item 10's "no Open the Issue button" falls out of this for free** — the Lessons Learned list
never had a per-row navigation button pointed at the issue in the first place (it links by opening
the lesson itself, which now shows the issue inline); nothing needed removing there beyond
confirming it was never emitted, so this batch's #7 and #10 are one and the same fix from two
different angles.

### Item 8 — the Lessons Learned list matches the Issues list's shape

`renderLessonsLogView(host)` is rewritten from a card grid into a `<table>` with the same four
columns the Issues list already has where they apply to a lesson: **Department / Lessons / Date
Resolved / Aging**. New helpers:

```js
function lessonResolvedDate(l) {
  if (l && l.issue_id) {
    var r = rows.find(function (x) { return x.id === l.issue_id; });
    if (r && r.date_resolved) return r.date_resolved;
  }
  return null;
}
function lessonAgingDays(l) {
  if (lessonResolvedDate(l)) return 0;
  return daysSince(l && l.date_captured);
}
```

⚠️ **A lesson has no resolution date of its own — it's read through its linked issue.** This
module's established invariant is that `issues_lessons.date_resolved` is only ever set once
`status === 'Closed'`, so resolving through the link is both correct and consistent with how
"resolved" is defined everywhere else in the module. `lessonAgingDays` mirrors `agingDays()`'s own
shape (0 once resolved, else days-since) via a newly extracted `daysSince()` primitive shared by
both.

⚠️ **No "Open the Issue" button in the list rows** (item 7's other half) — each row shows
`lessonSourceText(l)` under the lesson text instead, naming where the lesson came from without a
navigation control that duplicates clicking the row itself.

### Item 9 — click-to-sort, cycling asc → desc → natural, on both lists

New shared sort infrastructure, applied identically to the Issues log and the Lessons Learned list:

```js
var _issSort = { key: '', dir: 0 };
var _lessSort = { key: '', dir: 0 };
function cycleSort(state, key) {
  if (state.key !== key) { state.key = key; state.dir = 1; }
  else if (state.dir === 1) { state.dir = -1; }
  else { state.key = ''; state.dir = 0; }
}
```

⚠️ **Sorting and drag-reorder are mutually exclusive, following this app's own established
convention** (Drawing Register set this precedent for exactly this conflict) — a sorted column's
drag handle is blanked (`_issSort.key ? '' : dragGripHTML(r.id)`) and `wireReorder(...)` is only
called when no sort is active, so a sorted view can't silently corrupt the manual order underneath
it. A `.il-sortnote` banner ("Sorted by <label> — drag reorder disabled" + a "Restore manual order"
button) appears whenever a sort is active, on both lists.

⚠️ **Blanks sort last in both directions** (`sortCmp`'s null/undefined/empty-string handling) — an
issue with no champion or a lesson with no resolution date reads as "unknown," not "earliest" or
"latest," in either sort direction.

⚠️ **`ISSUE_SORT_EXTRACT`/`LESSON_SORT_EXTRACT` are keyed by the same header labels the columns
already show**, so `sortThHTML(label, key, state)` renders the arrow (▲/▼) only on the active
column and every other header stays plain — clicking cycles the SAME column: asc → desc → off,
never jumping to a different column's sort.

### Verified

Verified structurally after the branch restart below (git-policy — see that section) reapplied
these edits on top of the merged `origin/main`, not just once before the restart:
- `node --check` clean.
- 0 NUL bytes across `module.js`/`module.css`/`index.html`.
- CSS braces balanced (271/271).
- 0 duplicate DOM `id=` attributes in `index.html` (38 total).
- Function-name-set diff against the (post-restart) `origin/main`: **0 functions lost, 9 added**
  (`applySort`, `cycleSort`, `daysSince`, `lessonAgingDays`, `lessonResolvedDate`,
  `refreshIssueView`, `sortCmp`, `sortThHTML`, `wireSortHeaders`) — matching the pre-restart run
  exactly, confirming the branch reset carried the working-tree edits through unchanged.

⚠️ **Not verified signed-in** — this environment has no live Supabase login, the standing
constraint for every UI pass in this module. No live click-through of the embedded-issue History
repaint, the `_issEmbedSaved` save/restore round-trip on a real screen switch, or the click-to-sort
cycle against real rows.

`module.css/js?v=` → `20260901i`; `MODULE_V` (via `modules-grid.js?v=` on
`dashboard.html`/`modules.html`) → `20260901r`.

## 2026-09-01 (f) — Dashboard cleanup off a screenshot, close-vs-lesson decoupled, and a popup for capturing a lesson from an issue

Owner's 13-item list, verbatim, off a screenshot of the live Dashboard with the duplicate title and
the two bar tiles' clipped/mis-placed labels circled: (1) remove the redundant module-name label
next to the tabs-dropdown trigger, app-wide, and rename the tab "Dashboard" → "Issues Dashboard";
(2) drop the "X lessons captured" note; (3) size the Status tile to its content, split the rest
between the two bar tiles; (4) rename the three tiles Issues by Status / Department / Champion;
(5) make the bar-chart row labels readable and left-aligned, sort department rows by the dropdown's
own order and champion rows A→Z; (6) centre "X open of X issues" ON the bar; (7) the issue-list
tile shows Open issues only, retitled; (8) add a Lessons Learned tile; (9) closing an issue only
requires a lesson if none exists yet — otherwise just date + closure report; (10) drop the
"Open the issue →" button from a lesson card shown on that issue's own page; (11) capturing another
lesson from an issue's page opens a popup, not a screen switch; (12) "Capture another lesson" →
"Add another lesson"; (13) "Date Presented" → "Date Raised" (label only).

### Item 1 — the duplicate title, fixed in the SHARED layer, not per-module
⚠️ **`UI.tabsToDropdown()` already builds a trigger that names the current screen** (`sync()`'s
`trig.innerHTML`), so the module's own static `<h1>` text sitting beside it was a literal
duplicate — "Dashboard" next to a trigger also reading "Dashboard ▾", exactly what the screenshot
circled. Fixed once in `assets/js/ui.js` (`tabsToDropdown`), not in this module alone, since
**progress-photos is the other current caller** and carries the identical redundancy.
⚠️ **The obvious fix — unconditionally hide the title text — was wrong twice, both caught before
shipping.** First: by the time `tabsToDropdown()` runs, `initModuleTopbar()` (bound to
`DOMContentLoaded`, so it always runs first) has already moved the tab strip OUT of `.pd-topbar`
and into the sibling `.pd-modulebar` bar alongside the module's own `<h1>` — so
`tabs.closest('.pd-topbar')` finds nothing, and a first draft of this fix would have had **no
effect at all**. Fixed by walking to `.closest('.pd-modulebar')` instead, the element the title
and the tabs actually share now. Second: **an unconditional hide reproduces a bug this repo's own
history already fixed once.** Below 700px `.pd-modulebar > h1` is forced onto its own full-width
row with the dropdown trigger on the row after it — hiding the title there leaves a bare icon on
one line and the label on the next, which is precisely the "icon alone / label on the next line"
defect `module.css`'s own `⚠️ REMOVED (2026-08-31, owner-reported bug #4)` comment says never to
bring back. So the JS only adds a CLASS (`pd-title-hasdrop`); a new `dashboard.css` rule
(`@media (min-width:701px) { .pd-modulebar > h1 .pd-title-hasdrop { display:none } }`) decides
WHEN to actually hide it — only where the title and the trigger genuinely sit on one row together.
Below 700px the title stays exactly as the 2026-08-31 fix left it.
**The tab is also renamed** "Dashboard" → "Issues Dashboard" (`index.html`'s `.il-tabs` button and
`switchScreen()`'s `#il-screen-title` text), matching the owner's wording.

### Item 2 — the "X lessons captured" note is gone
Removed with item 8's real tile below it — a one-line count naming a number is redundant the
moment there's a tile that actually lists them.

### Item 3/4 — tile sizing and names
`.il-dash-grid`'s template changes from `repeat(3, 1fr)` to `0.8fr 1.6fr 1.6fr` — Status only
needs room for its donut + a short legend, so the two bar tiles (whose rows now carry a label,
a full-width track and a centred count — item 5/6) get the width back. Renamed **Issues by
Status / Issues by Department / Issues by Champion**.

### Item 5 — `hbarSVG` rewritten: left-aligned labels, canonical/alphabetical sort
⚠️ **The old chart right-aligned its labels** (`text-anchor="end"`), which on a long department or
champion name clips the READABLE start of the label and keeps the unreadable tail — exactly what
the screenshot showed. Switched to `text-anchor="start"` at a small fixed left margin, so a label
always shows from its beginning outward, truncated (`clip(..., 24)`) rather than clipped by the
SVG's own edge.
**Department rows sort by the `DEPARTMENTS` dropdown's own canonical order** (`DEPARTMENTS.indexOf`,
unknown/legacy department names falling to the end via a `-1 → DEPARTMENTS.length` remap, then
alphabetical among themselves) — not by count, so the tile reads in the same order a planner
already expects from every department picker in this module. **Champion rows sort A→Z**
(`localeCompare`).

### Item 6 — "N open of N issues" centred on its own bar
The label's `x` is now the midpoint of the row's TOTAL bar (`padLeft + totalW/2`), not a fixed
offset past the track — so it always sits over the bar it describes regardless of how short that
bar is. ⚠️ **Legibility across an open (red) vs. remaining (grey/line-token) two-tone bar, and
across both themes**, is handled with an SVG text halo — `paint-order="stroke"` +
`stroke="var(--pd-card)"` — rather than picking one fixed text colour that would fail contrast on
one segment or the other (the two-tone bar's colours are drastically different between light-mode
`--pd-line` and dark-mode's translucent white).

### Item 7 — the issue-list tile is Open issues only
`fullIssueListHTML(data)`'s heading is now "Open Issues"; its caller filters to
`(r.status || 'Open') === 'Open'` before handing it the data, so a planner who has additionally
narrowed the dashboard's own Status filter to e.g. Closed correctly sees an empty tile — the
dashboard's filter is still respected, "Open issues" is layered on top of it, not instead of it.

### Item 8 — a real Lessons Learned tile
New `dashLessonsFiltered()` (scoped to the dashboard's own Department filter only — the one
`dFilters` field that means the same thing on a lesson as it does on an issue; Status/Champion/
search are issue-shaped and don't carry over) + `lessonsTileHTML(list)`, a compact Lesson /
Department / Captured table, clicking a row into that lesson's own detail (`openLesson`).

### Item 9 — closing an issue only asks for a lesson when one doesn't exist yet
`hasLesson(r)` was already the existing helper (checks `LESSONS` for `issue_id === r.id`, plus the
legacy inline field). `closeNeedsLesson = !isNew && !hasLesson(r)` gates a Lessons Learned field
inside the close panel; `confirmCloseIssue()` re-derives the same `needsLesson` and only validates/
inserts a lesson when it's true. ⚠️ **The other half of item 9 — "users can add lessons learned
even without closing the issue" — was already true of the existing "+ Capture another lesson"
button**, which has never been gated on status; confirmed it stays that way (see item 11's
comment in `issDetailHTML`).

### Item 10 — no "Open the issue →" on that issue's own page
`lessonCardHTML(l, opts)` takes a second, optional `opts` argument; `opts.hideIssueLink` suppresses
the button. ⚠️ **Guarded with `typeof opts === 'object'`, not a bare `opts = opts || {}`** — the
unified Lessons screen's own call site is `list.map(lessonCardHTML)`, and `Array.prototype.map`
calls its callback with `(item, index, array)`, so a bare fallback would read the array INDEX as
`opts` and (being a truthy number past index 0) misinterpret it as an options object. The issue
detail's own card list passes `{hideIssueLink: true}` explicitly; the Lessons screen's list still
gets the link — a genuine way out from there.

### Item 11 — "+ Add another lesson" opens a popup, not a screen switch
New `openQuickLessonModal(issueId)`, `UI.modal()`-based, following the shared
`.pd-modal-header`/`.pd-modal-body`/`.pd-modal-footer` convention. Mirrors the FULL lesson editor's
current field set exactly (Department / Date captured / Lesson — see `lessonDetailHTML`, where
Recommendation and the source picker were already dropped from that form on 2026-09-01(e)) rather
than inventing a second, shorter definition of what a lesson record needs. No source picker: the
issue is already known, the same rule the full editor already follows when `l.issue_id` is set.
On save: inserts into `lessons_learned`, unshifts into `LESSONS`, closes the modal, and calls
`renderIssues()` — which re-renders the still-open issue detail in place (`issDetailHTML` recomputes
`ls = lessonsOfIssue(r.id)` fresh), so the new card appears without leaving the page. The
`#il-iss-addlesson` handler in `wireIssues()` now calls this instead of `newLesson(...)`, which
used to switch `screen` to `'lessons'`.

### Item 12 — "Capture another lesson" → "Add another lesson"

### Item 13 — "Date Presented" → "Date Raised"
Label-only, everywhere it's user-facing (the detail form's field label, the Issues log's `<th>`,
its `data-l` stacked-card label, the history field name, and the required-field validation
message). ⚠️ **The underlying column (`date_presented`) and every `r.date_presented`/
`v.date_presented` reference are untouched** — renaming the column would touch the DB, the
importer/export, and every history entry already logged against the old label.

**Verified.** `node --check` clean on both `ui.js` and `module.js`; CSS braces balanced
(dashboard.css 426/426, module.css unchanged at 262/262); 0 NUL bytes across all five touched
files; 0 duplicate DOM ids; `<div>`/`</div>` balanced in `index.html` (26/26); every new modal id
(`il-ql-x/-dept/-date/-lesson/-cancel/-save`) appears exactly once. Function-set diff against
`origin/main`: **0 lost**, **added** — `dashLessonsFiltered`, `lessonsTileHTML`,
`openQuickLessonModal` (plus a third local `opts()` closure, the same pattern the file already
used twice). Every class the new modal emits (`il-form-row`, `pd-field`, `pd-select`,
`pd-input-sm`, `pd-textarea`, `pd-modal-header/-body/-footer/-close`) resolves to a real,
pre-existing CSS rule — no orphan classes.

⚠️ **Not verified signed in** — no live login is possible in this environment, the standing
constraint for every UI pass in this repo. No live click-through of the dashboard's new layout,
the reworked close-issue panel, or the new quick-lesson popup against real data.

`ui.js`/`dashboard.css?v=20260901c` (app-wide, both shared assets — 20/28 files respectively);
`module.css/js?v=20260901h`; `MODULE_V` (via `modules-grid.js?v=` on `dashboard.html`/
`modules.html`) → `20260901q`.

## 2026-09-01 (e) — Reopen from On Hold, a leaner lesson form, lessons genuinely separate from issues, and the dashboard redrawn with horizontal "N open of N" bars

Owner's 6-item list, verbatim: (1) once On Hold, a button to move back to Open, requiring an
Action Plan; (2) dropping the standalone-lesson-capture form's Recommendation field ("the same
as lessons learned") and its "what produced this lesson" question when it's already known
("the same as the current issue"); (3) opening a lesson must never land on the issue — lessons
need their own separate page; (4) all three Dashboard tiles in one row on a wide screen;
(5) replace the vertical Open-vs-Total bar and the grouped champion bar with a horizontal bar
per department and per champion, labelled "X open of X issues"; (6) the full issue list in its
own tile, with a wider Issue column. **Migration
`migrations/2026-09-01-issues-reopen-action-plan.sql`.**

### Item 1 — Reopen Issue, gated on an Action Plan
`canReopen` mirrors `canHold`/`canClose` exactly, just on the opposite status
(`status === 'On Hold'`), and the "Reopen Issue" button opens the same reveal-panel shape Hold
and Close already use — a required textarea (`il-iss-reopennote`) that must be non-empty before
`confirmReopenIssue()` will write `{status: 'Open', action_plan: note}`. ⚠️ **`action_plan` is a
real column, not just a history note** — added to `HIST_FIELDS` (`'Action Plan'`) so a reopen's
reasoning shows up in the before→after diff the same way Hold/Close's narratives already do, and
`ISSUE_HIST_LABELS.reopen = 'Reopened'` names the entry itself. ⚠️ **`hold_reason` is left
untouched on reopen** — clearing it would erase the record of why it was held in the first
place, which the History timeline (and a later reader of the row) still benefits from seeing.
The three reveal-panel flags (`_issHoldOpen` / `_issCloseOpen` / `_issReopenOpen`) are now
mutually exclusive everywhere a panel opens, and all three are reset on `openIssue()` /
`backFromIssueDetail()` / `issReset()` so switching issues can never leave a stray open panel
from the previous one.

### Item 2 — a leaner standalone-lesson form
**Recommendation is gone** — the field, its `data`/`saveLesson` write, its search-hay entry, and
its display line on `lessonCardHTML` are all removed; the `recommendation` COLUMN is untouched
(same call as Lesson category's removal on 2026-08-31) so nothing already stored is destroyed,
and `saveLesson()`'s payload simply omits the key now rather than writing `''`, so an update can
never blank an old value it no longer has a field to edit. **"What produced this lesson" is
skipped whenever `l.issue_id` is already set** — covering both "+ Capture another lesson" from
an issue's own detail (the draft arrives pre-linked) and any existing issue-linked lesson viewed
later. ⚠️ **Scoped to issue links only, not meeting links** — a lesson linked to a meeting action
item (`mom_id`/`mom_item_id`, no `issue_id`) still gets the picker, since the owner's own wording
("the same as the current issue") only names the issue case, and a genuinely standalone lesson
(no link at all, captured fresh from the Lessons screen) needs the picker to have any way to link
one. The toolbar's `lessonSourceText(l)` line already states the issue when the block is hidden.

### Item 3 — Lessons Learned is a real, separate page now
⚠️ **Root cause: the Lessons screen's "log" was a mirrored TABLE of closed issues, not a list of
lesson records** — `renderLessonsLogView` built its own copy of the Issues log's shape from
`closedIssuesFiltered()` (a filter over `rows`, the issues table), and every row's click handler
called `openIssue()`. So "viewing a lesson" from that table always meant leaving the Lessons
screen for the Issues one — the standalone-lessons section below it was the only part that ever
opened a real Lesson record. Rebuilt around `lessonsFiltered()` (already existed, already
department/search-filters the actual `LESSONS` table, already covers both issue-linked and
standalone rows in one set) rendered uniformly via `lessonCardHTML`, whose own "Open this lesson
→" button calls `openLesson()` — staying on the Lessons screen. **`closedIssuesFiltered()` and
`standaloneLessonsFiltered()` are deleted**, not left as unused rot. "Open the issue →" is kept
as an explicit, secondary link on a card that has one — a deliberate way OUT when someone
genuinely wants the issue, never the default click any more. ⚠️ **Drag-to-reorder is uniform
across the whole list now** (the earlier round's split between the issues table's `sort_order`
and the standalone cards' `sort_order` collapses into one `wireReorder` call against `LESSONS` /
`lessonOrderCmp` / `LESSON_TABLE`), since every row is now a real lesson record.

### Item 4 — three tiles, one row, on a wide screen
`.il-dash-grid` drops the old `1.4fr 1fr 1fr` template plus `.il-dash-wide`'s
`grid-column: 1 / 2` override (which — verified by walking CSS Grid's auto-placement algorithm
— pushed the champion card onto a SECOND row anyway, in column 1 only, leaving two empty cells;
"wide" never actually meant full-span at desktop widths). Replaced with a plain
`repeat(3, 1fr)`, so Status / Department / Champion sit in one row above ~1000px, two-then-one at
the existing breakpoints.

### Item 5 — horizontal "N open of N issues" bars, per department and per champion
New `hbarSVG(items, opts)` replaces both `barChartSVG` (the old single overall Open/Total pair)
and `groupedBarSVG` (the vertical grouped per-champion bars) — one shared horizontal-bar renderer
for both tiles. Each row draws a track sized to the item's TOTAL (scaled off the largest total
among every row), the OPEN count filled on top in the accent colour, with the label to the left
and **"N open of N issues" printed after the bar**, per the owner's own wording. New `byDept`
grouping mirrors the existing `byChamp` one (same `{label, open, total}` shape, same
`latestChampionText()`-based grouping for champions). ⚠️ **Rows are never capped** — the old
grouped-bar chart topped out at 10 champions with a separate breakdown table listing the rest;
since a horizontal chart's row count only changes its HEIGHT (not its legibility at a fixed
width, the way a vertical chart's bar count would), every department and every champion is
always shown, and the now-redundant `champTableHTML` breakdown table is deleted along with it —
each bar row already states its own open/total, so a second table repeating the same numbers had
nothing left to add. A tall chart (many champions) scrolls inside its own tile
(`.il-dash-hbar-wrap`, `max-height:340px`) rather than growing the page without bound.

### Item 6 — the full issue list gets its own tile, Issue column widened
`fullIssueListHTML(data)`'s output is now wrapped in `<div class="pd-card il-dash-card
il-dash-fulllist-card">`, matching the other three tiles' own card treatment instead of sitting
bare under the grid. `.il-dash-list` — now used ONLY by this table, since item 5 removed its
other consumer (the champion breakdown table) — gets `table-layout:fixed` plus explicit
`nth-child` column widths (Issue 42% / Champion 17% / Department 17% / Status 13% / Aging 11%),
so the Issue column genuinely claims the most room instead of splitting evenly with four much
shorter columns.

**Verified.** `node --check` clean; CSS braces balanced (258/258); 0 NUL bytes in both files; 0
duplicate DOM ids; `<div>`/`</div>` balanced in `index.html` (26/26). Function-set diff against
the prior commit: **lost** — `barChartSVG`, `champTableHTML`, `closedIssuesFiltered`,
`groupedBarSVG`, `standaloneLessonsFiltered` (all five deliberately superseded, per the items
above); **added** — `confirmReopenIssue`, `hbarSVG`. Every id `wireIssues()` queries for the
Reopen panel (`il-iss-reopenbtn` / `-reopencancel` / `-reopennote` / `-reopenconfirm`) confirmed
present in `issDetailHTML`'s own emitted markup.

⚠️ **Not verified signed in** — no live login is possible in this environment, the standing
constraint for every UI pass in this repo. No live click-through of the Reopen workflow, the
restructured Lessons list, the new horizontal-bar charts against real data, or the migration
itself, which has not been run.

`module.css/js?v=20260901g`; `MODULE_V` (via `modules-grid.js?v=` on `dashboard.html`/
`modules.html`) → `20260901i`.

## 2026-09-01 (d) — Progress-Photos-style search/filter chrome, drag-to-reorder, a leaner log, and one combined dashboard with real charts

Owner's 10-item list, verbatim: (1) same search/filter UX as Progress Photos everywhere in this
module; (2) drag-to-reorder in the Issues log and the Lessons log; (3) no KPI tiles on the Issues
detail view; (4) drop Lesson category — fold it into Department, the same field Issues already
has; (5) Champion in the log/summary views shows only the LATEST champion, not the full history;
(6) stop separating Issues from Lessons on the Dashboard; (7) a status pie chart instead of tiles;
(8) a bar chart of Open vs Total; (9) a real by-champion visualization, also Open-vs-Total bars;
(10) the full issue list below every chart, not a capped sample. **Migration
`migrations/2026-09-01-issues-lessons-reorder.sql`.**

### Item #1 — the topbar search + funnel toggle
Copied Progress Photos' chrome, not reinvented: `.il-topsearch` (a compact box in the topbar tool
cluster) + `.il-topfilttoggle` (an icon button that toggles `.open` on whichever filter panel the
active screen owns). One pair of controls, three panels — `#il-issues-filters` /
`#il-lessons-filters` / the new `#il-dashboard-filters` — decided by `screen` via
`activeFilters()`/`activeFilterPanelId()`/`activeSearchPlaceholder()`. `wireTopFilters()` binds the
box to `oninput` and the toggle to a class flip; `syncTopFilters()` re-seeds the box's value and
placeholder and the toggle's open/closed state on every `switchScreen()` — so tabbing between
Issues → Lessons → Dashboard never leaves the search box showing one screen's term while filtering
another's. ⚠️ **Every panel's own `#…-search` input is kept in the DOM, `hidden`** — not deleted —
so `iFilters.search`/`lFilters.search`/`dFilters.search` stay bound to a real element for any code
still reading them by id; the topbar box is what a planner actually types into. `#il-filt-toggle`
(the old per-screen button) is gone from Issues; Lessons never had one; the old always-visible
`.il-filtbar` gave way to `.il-filters{display:none}` / `.il-filters.open{display:flex}` in CSS.

### Item #2 — drag-to-reorder in both logs
A nullable `sort_order` on both `issues_lessons` and `lessons_learned`. NULL means "nobody has
touched the order yet" — `issueOrderCmp`/`lessonOrderCmp` fall back to the existing date-based sort
(newest first) exactly as before, and an ordered row always sorts before an unordered one. A small
inline-SVG 6-dot grip (`dragGripHTML`, not routed through `icons.js` — one glyph didn't earn a new
shared-asset dependency) is the drag handle: in the Issues log, the Lessons screen's closed-issues
table, and the standalone lesson-card grid (the whole card is `draggable="true"` there).
`wireReorder(container, list, baseArr, cmp, table)` wires `dragstart`/`dragover`/`dragend`/`drop`
with a red top/bottom insertion line (`.il-drop-before`/`.il-drop-after`); `applyReorder` renumbers
**only the currently-displayed (filtered) list**, spaced by 10 so a later drop can slot between two
values without a full renumber, writes **only the rows whose `sort_order` actually changed**, then
re-sorts the real underlying array (`rows`/`LESSONS`) with the SAME comparator used at load — so
display order and the in-memory array can never disagree. ⚠️ **Relies on `.filter()` preserving
object references**: mutating `r.sort_order` on a row pulled from the filtered view is mutating the
same object sitting in `rows`, so no separate write-back step is needed. Legacy standalone lessons
(`isLegacyLesson(l)`) don't get a drag handle — there's no live row underneath them to persist an
order onto.

### Item #3 — no KPI tiles on the Issues detail view
`renderIssues()` only calls `renderIssueKpis()` while `_issMode === 'log'`; opening an issue
(`_issMode === 'detail'`) clears `#il-kpis` instead. The tiles exist to help you scan a list of many
issues — once you've opened one, they're just three numbers that don't describe what's on screen.

### Item #4 — Lesson category retired in favour of Department
Removed `LESSON_CATS`, the category `<select>` from `lessonDetailHTML`, the category chip from
`lessonCardHTML` (the department chip stays), `category`/`_lessonCategory` from every lesson-insert
payload (`confirmCloseIssue`, `saveIssue`'s forceClose branch, `newLessonAsClosedIssue`'s draft,
`newLesson()`'s initial object, `saveLesson()`'s payload), and the category filter from the Lessons
filter panel + `lFilters` (now `{search, department}`). `renderLessonKpis()`'s third tile now counts
distinct `department` values under "Departments" (was "Categories"). ⚠️ **The `lessons_learned`
table's `category` column is untouched** — dropping a column is destructive and nothing here reads
or writes it any more, so leaving it costs nothing and a future decision to actually remove it is
the DB owner's, not silently taken here.

### Item #5 — "latest champion" in log/summary views
New `latestChampionText(r)`: reads the LAST element of `r.champion_ids` (the array is push-ordered
by assignment, so the last id is the most-recently-assigned account) and resolves it to a name via
`peopleNamesOf`; falls back to the last `;`-separated segment of the free-text `champion` string for
legacy rows with no ids at all. Applied in the Issues log's Champion column, the Lessons screen's
closed-issues table, and every champion reference on the new Dashboard. ⚠️ **The full editable
Champion picker inside the detail/edit view is UNCHANGED** — it still shows and edits the complete
assignment history. Only the places that summarize a row in one line were simplified; the record
that actually tracks "everyone who has ever been champion" was never in question.

### Items #6–10 — the Dashboard rebuilt as one combined analytics screen
`renderDashboardScreen()`, `dashboardListHTML()`, `lessonDashboardListHTML()`, `agingBucketsOf()`
and `CHART_COLORS` are gone, replaced by a single screen with its own filter state (`dFilters =
{search, status, department, champion}` — deliberately independent of `iFilters`/`lFilters`, so
opening the Dashboard never silently narrows what the Issues or Lessons screens later show):
- **Status → pie chart** (existing `donutChartSVG`, Open/On Hold/Closed slices) instead of tiles.
- **Open vs Total → a 2-bar chart** (existing `barChartSVG`).
- **By champion → a NEW `groupedBarSVG(items, opts)`** (same hand-rolled inline-SVG style as the
  existing `donutChartSVG`/`barChartSVG` — viewBox-based, `<title>` tooltips, `Fmt.esc()` on every
  label, no charting library): two bars per champion (Open red, Total grey), the top 10 by total,
  plus a full `champTableHTML` breakdown table beneath it for anyone champion #11 onward. ⚠️
  Grouped by `latestChampionText(r)`, not the raw `champion` string, so "Alice Cruz; Bob Reyes"
  attributes to whichever of the two was assigned most recently rather than creating a third,
  unreadable combined bucket.
- **Lessons folded into a one-line note** (`lessonsNote`, total lesson count + how many are
  standalone vs linked to a closed issue) rather than a second set of charts — item 6's "no need to
  separate" taken to mean lessons earn a mention, not equal screen real estate, since the ask was
  specifically about not partitioning the ISSUES side of the dashboard by status.
- **`fullIssueListHTML(data)`** below every chart: every row `dFilters` currently matches, **never
  capped** (the old `dashboardListHTML` truncated to a sample) — clicking a row opens it via the
  same `openIssue()` path a log row uses.

**Verified.** `node --check module.js` clean. Function-set diff against HEAD: **lost** —
`agingBucketsOf`, `dashboardListHTML`, `lessonDashboardListHTML` (all three deliberately superseded
by the rebuild); **added** — `activeFilterPanelId`, `activeFilters`, `activeSearchPlaceholder`,
`applyReorder`, `champTableHTML`, `dashIssuesFiltered`, `dragGripHTML`, `fullIssueListHTML`,
`groupedBarSVG`, `issueOrderCmp`, `latestChampionText`, `lessonOrderCmp`, `syncTopFilters`,
`wireReorder`, `wireTopFilters`. 0 duplicate DOM ids; `<div>`/`</div>` balanced in `index.html`
(26/26); CSS braces balanced (255/255); 0 NUL bytes. Two stale leftovers caught by grepping for
removed identifiers rather than by report, both fixed before shipping: `newLessonAsClosedIssue`'s
draft still carried `_lessonCategory: ''`, and `renderLessons()`'s active-filter check still tested
`['search','department','category']` against the now-two-key `lFilters`.

⚠️ **Not verified signed in** — no live login is possible in this environment, the standing
constraint for every UI pass in this repo. No live click-through of the drag-and-drop reorder (HTML5
native DnD is awkward to simulate even signed in), the new charts against real data, or the
migration itself, which has not been run.

`module.css/js?v=20260901f`; `MODULE_V` (via `modules-grid.js?v=` on `dashboard.html`/
`modules.html`) → `20260901h`.

## 2026-09-01 (c) — Filters behind a button, click-to-open rows, step-through, detailed history, and the champion-concatenation bug

Owner's 7-item list for Issues & Concerns. Items 1–2 were already delivered in the 2026-08-31(b)
rebuild below (the combined Dashboard tab, and Date Resolved only required at closure) — checked
against the live code and confirmed still present, not redone. This entry is items 3–7. **No
migration.**

### Item #3 — the filter bar is now called up by a button
`.il-filters` (renamed `#il-issues-filters`) on the Issues screen defaults `hidden`, revealed by a
new `.il-filt-toggle` button (`#il-filt-toggle`) that just flips `hidden` — the panel stays open
until toggled shut again, and nothing in `iFilters` itself changes when it closes. ⚠️ **A closed
panel must not hide an active filter from view entirely** — `renderIssues()` already computes
`anyF` (a filter narrower than the "Open" default) for the Clear-filters button; the same flag now
also toggles a small dot (`.il-filt-toggle.has-active`) on the toggle button, so "Open items only"
narrowing the log stays visible even with the panel closed. Scoped to the Issues screen only, per
the literal ask — the Lessons Learned filter bar is untouched.

### Item #4 — no more edit icon; the whole row opens the issue
`renderIssuesLog()`'s `<tr>` now carries `data-open="<id>"` and a click handler
(`openIssue(tr.dataset.open)`), the same pattern this file already used for the Dashboard's issue
list and the Lessons log. The separate `✎` edit button and its "—"/"raised by someone else" dash
are gone. ⚠️ **This also closes a real pre-existing gap**: a row you cannot edit
(`canEditRow(r)` false) previously had NO way to open it at all from the log — it now opens in
`issDetailHTML`'s existing read-only (`ro`) rendering, so a viewer or another department can finally
read a record from the log instead of only ever reaching it via the Dashboard's summary list. Only
the delete icon (planner-only) remains, in its own cell, with `e.stopPropagation()` so clicking it
does not also open the row underneath it. The actions `<th>`/`<td>` is now gated on `isSteward`
rather than `canWrite` (the only thing left in it), and the "no results" row's colspan follows the
same gate. Dead `.il-noedit` CSS rule removed (verified zero remaining references — a same-named
rule in `minutes-of-meeting/module.css` is a separate file/module and untouched).

### Item #5 — step through the filtered list from inside the detail view
A Prev/Next control (`issStepHTML`/`stepIssue`) beside "← Back to Issues", walking
`issuesFiltered()` — the SAME set the log/filter bar is currently showing, never all of `rows` — so
stepping tracks whatever filter is applied. ⚠️ **Never offered for an unsaved draft (`_issNew`)**,
which has no position in that list yet. ⚠️ **Degrades to a plain note ("Not in the current filter")
rather than guessing a neighbour** when the open record has since fallen out of the active filter —
e.g. closing an issue while "Open items only" is set. Stepping reuses `openIssue()` exactly as a row
click would, so permission handling and history loading behave identically either way.

### Item #6 — the history is now a field-by-field before → after record
`logHistory()` already snapshotted the WHOLE row before every change (see the 2026-08-31 build) —
the gap was `historyHTML()` only ever rendering the action label and a free-text note, never the
snapshot itself. New `issHistDiffHTML(before, after)` walks every field the register actually asks
for (Status, Department, Champion(s), Issue, Caused By, Corrective Action, Reason for Hold, Closure
Report, Date Presented, Date Resolved) and prints only the ones that changed, as "Field: old →
new". ⚠️ **Each entry's "after" state is reconstructed from its NEIGHBOUR, not stored separately** —
entry i's after-state is the live row for the most recent entry, or the next-more-recent entry's
own "before" snapshot otherwise (the list is newest-first), since a change's before-state IS the
previous change's after-state. ⚠️ **A `create` entry has no "before" to diff against** (`logHistory`
is passed `null` there) — it instead lists what was actually captured at creation, with no arrow, so
"all issue details must be captured and saved" holds for the very first entry too. Champion is
diffed as the already-resolved display TEXT (`champion`, kept in sync with `champion_ids` by
`championText()` on every save), not the raw uuid array — readable, not clutter.

### Item #7 — the champion-concatenation bug
⚠️ **Root cause: the free-text box was seeded with the FULL saved `champion` string, not just the
typed extra.** `champion` on a saved row is `championText(ids, extra)` = resolved names + extra,
joined — but `issDetailHTML` fed that whole string back into the picker's free-text input on every
render. So the box for an issue with Champion(s) "Alice Cruz" plus typed "External Consultant" was
seeded with `"Alice Cruz; External Consultant"`, and the next "Update Issue" recomputed `champion =
championText(ids, "Alice Cruz; External Consultant")` = `"Alice Cruz; Alice Cruz; External
Consultant"` — doubling on every single click with no interaction needed, exactly the reported
behaviour. New `championExtra(ids, champion)` reverses `championText`: it strips out any
`;`-separated segment that exactly matches one of the CURRENTLY resolved names for `ids` (not by
position, so it survives the ids being reordered) and keeps the rest, which is the genuine typed
extra — including legacy free-text-only rows (`ids` empty), where every segment survives untouched.
⚠️ **The identical bug existed in `minutes-of-meeting/module.js`'s copy-pasted People Picker**, for
the action-item Responsible field (`owner`/`owner_ids`) — same fix applied there. That module's own
Required/Optional/Actual attendee pickers were checked and are NOT affected: they store `{ids,
text}` as a jsonb pair where `text` is already just the raw typed extra (read straight off the
free-text box at save time, never run through `championText`), so nothing there needed changing.

**Verified.** 10 checks on `championExtra` (a 5-repeated-"Update"-click simulation stays
byte-stable at `"Alice Cruz; Bob Reyes; External Consultant"` instead of doubling every pass, and a
reproduction of the pre-fix behaviour against the same inputs shows the doubling for comparison), 15
on `issStepHTML`/`stepIssue` (boundary disabling, the filtered-out "Not in the current filter" case,
and that stepping past a boundary is a no-op), 16 on `issHistDiffHTML` in isolation plus 10 more on
`historyHTML`'s full create→update→hold→close chaining (including that the `create` entry correctly
shows the ORIGINAL value of a field later edited in an update, proving the after-state
reconstruction walks the chain rather than just diffing against the live row). All sliced from the
shipped functions, never reimplemented. `node --check` clean on both module.js files; 0 NUL bytes;
CSS braces balanced (239/239); **function-set diff against HEAD: 0 lost, 6 added** in issues-lessons
(`championExtra`, `histNorm`, `histFieldHTML`, `issHistDiffHTML`, `issStepHTML`, `stepIssue`) and 1
added in minutes-of-meeting (`championExtra`).

⚠️ **Not verified signed in** — no live login is possible in this environment, the standing
constraint for every UI pass in this repo. No live click-through of the filter toggle, row-click,
step-through, or the champion-picker fix against real data.

`module.css/js?v=20260901e` (issues-lessons); minutes-of-meeting `module.js?v=20260901b` (its
`module.css` is unchanged this pass); `MODULE_V` (via `modules-grid.js?v=` on `dashboard.html`/
`modules.html`) → `20260901d`.

## 2026-08-31 (b) — Issues & Concerns rebuilt: dashboard, status workflow + history, required fields;
## Lessons Learned mirrors it for closed issues; three bugs fixed

Owner sent a 24-item request spanning this module and Minutes of Meeting, off two screenshots (a
phone-width topbar and a date-input field). Given the size, this pass **phases the delivery**: the
three bugs first, then Issues & Concerns rebuilt in full, then Lessons Learned mirrored onto the same
architecture for its one narrower case (item #15). Minutes of Meeting's own Dashboard/Meetings rework
(items #2, #17–23) and the HTML/PDF/PPTX exports (#24) are **NOT started** — flagged below, not
fabricated as done. **Run `migrations/2026-08-31-issues-workflow-history.sql`.**

### Bug #3 — a fresh visit rendered nothing at all
⚠️ **Root cause: `UI.bindHistoryState`'s `apply()` only runs if a URL hash for that key ALREADY
exists.** On a first visit there is none, so `bindHistoryState` calls `writeUrl(true)`
(`replaceState`) and returns — `apply()`, the callback that actually paints a screen, is never
invoked. Every other module either renders unconditionally at load or has a screen visible by
default in raw HTML; this module's `#il-screen-issues` carried a stray `hidden` attribute with no
unconditional render before `bindHistoryState` ran, so the one path that should have painted it
never fired and the app sat blank until some other interaction forced a re-render.
- Fixed at the cause: `init()` now calls `switchScreen(screen)` unconditionally right after binding
  history state — a harmless repaint if `apply()` already ran (nothing here calls `.push()` from
  inside it, so no double-navigation), the only paint if it did not.
- **Defense in depth:** removed the stray `hidden` from `#il-screen-issues` in `index.html` — a
  screen's initial visibility must not depend solely on JS having run before paint, the convention
  every other module already follows.
- Checked all 11 other modules using the same `bindHistoryState` pattern — none share this defect;
  every one of them either has no `hidden` default screen or renders unconditionally at load.

### Bug #4 — the module icon and title stacked on separate lines on a phone
⚠️ **A stale rule from before the shared-layer topbar restructuring.** `UI.initModuleTopbar()`
(2026-07-24) moved every module's title out of `.pd-topbar` into a sibling `.pd-modulebar`, and a
later shared-layer decision (root CLAUDE.md, 2026-07-24 "part 9") explicitly **restored** module
title text at every width, superseding an earlier "hide the title text on narrow screens" rule. This
module still carried its OWN copy of that superseded rule —
`.il-title-txt { display: none }` inside `@media (max-width: 820px)`, plus a second, wider
`@media (max-width: 1500px) { .il-title .il-title-txt { display: none } }` block — so the icon
rendered alone with the title text hidden, and on the module's own two-row layout the icon and (once
visible again above 1500px) the title text stacked instead of sitting on one line. Both rules
removed, with an explanatory comment in their place. Also removed the identical stale rule from
`modules/minutes-of-meeting/module.css` (copied at the module-split, same bug).

### Bug #5 — date input fields rendered with visible clipping/misalignment
Native `<input type="date">` controls inherited this module's 16px phone font (the iOS-zoom guard
every input carries) with no compensating height/padding, so the browser's own date-picker chrome
(calendar icon, segments) crowded against the box edges. Normalized with an explicit `height: 34px`
+ `line-height: 20px` + matched vertical padding + `box-sizing: border-box`, with a taller phone
override. A defensible, general fix rather than a guess chasing one browser's rendering quirk from a
static screenshot — this is a much smaller item than the 21 substantial feature items in the same
request.

### Items #1, #6–14, #16 — Issues & Concerns rebuilt around three modes: Dashboard · Log · Detail
`_issMode` replaces the old `'report'|'library'` idea entirely — **Dashboard** (item #16 renames
"Report"), **Log** (the table, unchanged in kind), and **Detail**, a drill-down reached from either.
All three read the same `issuesFiltered()`, so switching presentation never changes the set in view.

- **#1 — the Dashboard**, `renderIssueDashboard()`: a tile (issue count, labelled by the active
  status scope — "Open issues" by default), a **summary list** of the filtered issues sorted
  longest-aging-first (capped to 12, "switch to Log for the full list" beyond that) showing Issue /
  Champion / Department / Status / Aging, a **donut** and a **bar** chart (hand-rolled inline SVG,
  the app's established convention — no charting library). ⚠️ **"Category" reads as DEPARTMENT.**
  Issues have no free-text category field of their own (unlike Lessons, which do); department is
  this register's existing classifying dimension and the one the filter bar and log already group
  by, so the donut is "by department" rather than inventing a second, parallel taxonomy. The bar
  chart is "by aging group" against the same three buckets (0–30 / 31–90 / 90+) the filter bar
  already offers (`AGING_BUCKETS`), via `agingBucketsOf()`.
- **#6 — the Log defaults to Open**: `iFilters.status` now defaults to `'Open'` (was `''`), on both
  Dashboard and Log — they share one filter state. ⚠️ Because Open is now the *default* scope and
  not "no filter," it must not count toward "a filter is active" or the Clear-filters button would
  show permanently at rest; `anyF` explicitly excludes `status === 'Open'` from that test.
- **#7 — the department list** replaced with the owner's exact 11: Commercial and Contracts,
  Engineering, Procurement, Finance, Human Resources, Quality, Health and Safety, Operations, PMO,
  COO, CEO. Synced to `admin.html`'s own copy (its user-management Department column), which had
  drifted onto an older, different list. ⚠️ Minutes of Meeting carries **no department picker of its
  own** — it only displays a linked issue's department verbatim off the light `ISSUES` mirror — so
  there is nothing to sync there.
- **#8 — every field required**: department, champion(s), the issue text, caused-by and date
  presented are `required` on the base form; the status-conditional narrative field (corrective
  action / hold reason / closure report, see #10–13) is `required` too, whichever one is showing.
  `reqMark()` renders a visible `*` beside each required label so this isn't only enforced silently
  by the browser. Backed by `validateIssueCommon()` + per-status checks in `saveIssue()`, so a
  bypassed `required` attribute (autofill, programmatic submit) still can't save an incomplete row.
- **#9 — spellcheck** on every free-text textarea in the detail form (issue, caused-by, corrective
  action, hold reason, closure report, the standalone-lesson text).
- **#10–13 — status is no longer a field you set; it's driven by three buttons.**
  - **Update Issue** — the existing Save path, now logging history (see #11) on every save.
  - **Put On Hold** (`confirmHoldIssue`) — opens a reveal panel demanding a **Reason for Hold**
    (`required`); on confirm, sets `status='On Hold'` + `hold_reason`, and the detail view swaps its
    narrative field from **Corrective Action** to **Reason for Hold** (item #12) — the same field
    slot, different label and column, so a hold reason can never be mistaken for a corrective action
    once the issue reopens.
  - **Close Issue** (`confirmCloseIssue`) — opens a reveal panel demanding BOTH a **Closure Report**
    and a **Lessons Learned** entry (`required`, item #13); on confirm, the narrative field becomes
    **Closure Report** and — this is the load-bearing decision — the lesson text is inserted straight
    into `lessons_learned` (linked via `issue_id`) in the *same* action, so **"no need for the
    capture a lesson button"** is not a missing feature, it's the point: closing an issue always
    produces exactly one lesson, with no separate step to skip.
  - ⚠️ **Two new columns, not a repurposed one** (`migrations/2026-08-31-issues-workflow-history.sql`):
    `hold_reason` and `closure_report`, both `text`. Overloading `corrective_action` for all three
    would make an On-Hold issue's "planned actions" column silently mean "why we paused," and a
    Closed one mean "how we closed it" — one column answering three different questions is exactly
    how a report ends up quoting the wrong thing.
  - Adding a new issue no longer asks for a status at all (item #10) — `newIssue()` seeds
    `status: 'Open'` directly; the only way out of Open is one of the two buttons above, on a saved row.
- **#11 — every change is logged to a per-issue history**, new `issues_lessons_history` table.
  - ⚠️ **Insert-only RLS on purpose — no update policy, no delete policy, anywhere.** An audit trail
    a planner could edit or remove after the fact is not an audit trail; a bad entry from a future
    bug is a manual, logged, out-of-band DBA fix, never a feature this app exposes.
  - Every write path — create, update, hold, close, and the forced-closed-on-create path from item
    #15 — captures a **snapshot of the row as it stood immediately before the change** (`before =
    Object.assign({}, r)`, taken before the row is mutated) plus an `action` label and an optional
    `note` (the hold reason / closure report / lessons text at that moment, so the history reads as
    a story without decoding jsonb). `changed_by_department` is denormalized from the actor's own
    profile at write time — resolving `created_by`→name later would need a `users` read a department
    user has no business being granted, the same privacy floor `championText`/`raisedByLabel` already
    hold in this module.
  - ⚠️ **Best-effort, never load-bearing**: `logHistory()` runs *after* the real write has already
    succeeded, wrapped in its own try/catch — a missing migration or a transient failure here must
    never make a successful save read as an error to the person who just saved. `historyHTML()`
    correctly distinguishes "no changes yet" from "the migration hasn't been run" only by naming the
    file in the empty state, since both look identical from the client's side.
- **#14 — narrow-screen field order**: `.il-iss-panel { order: 2 }` / `.il-iss-body { order: 1 }`
  inside the existing `@media (max-width: 700px)` block, so on a phone the issue/caused-by/
  corrective-action/narrative fields render ABOVE the status panel (department, champion, dates),
  matching the flex column the module already switches to at that width.
- **#16 — "Report" → "Dashboard"** everywhere the word appeared as a screen label (view toggle
  buttons in `index.html`, `syncChrome()`'s labelling logic).

### Item #15 — Lessons Learned mirrors Issues, closed-only, plus a standalone flow
*"Lessons learned and issues and concerns should be similar in terms of report/dashboard content and
log content except that the lessons learned are exclusively for closed issues only. Users can add
lessons without going through issues but they must still provide all the details required from
adding issues up to closure report and lessons learned."*

⚠️ **Read literally, a standalone lesson under this model IS a full `issues_lessons` row created
directly in Closed status** — not a second data model bolted beside the first. That reading is what
let the Lessons screen reuse almost everything the Issues rebuild had just built:
- `_lessMode`: `'dashboard' | 'log' | 'detail'`, same three-mode shape as Issues.
- `renderLessonDashboard()` mirrors `renderIssueDashboard()`: a tile counting closed issues +
  standalone `lessons_learned` rows together, a summary list of closed issues
  (`lessonDashboardListHTML`), a donut **by lesson category** (the field Issues doesn't have but
  Lessons always did), a bar **by department**.
- `renderLessonsLogView()` shows the register-style table for `closedIssuesFiltered()` — issues where
  `status === 'Closed'` — with a **secondary section beneath it** for
  `standaloneLessonsFiltered()`: `lessons_learned` rows with **no** `issue_id`, i.e. lessons captured
  straight from a meeting action item (via the cross-module deep link from Minutes of Meeting) or
  written before this workflow existed. Kept visible rather than dropped — item #15 scopes *new*
  standalone lessons through the full closure flow, it doesn't retire the legacy ones.
- **"+ New Lesson" on the Lessons screen routes to `newLessonAsClosedIssue()`**, not the legacy
  `newLesson()` — it opens the SAME Issues detail form (`_forceClose` flag on the draft), demanding
  every field up through department/champion/dates AND the closure report AND the lesson text in one
  save, then inserts both the `issues_lessons` row (Closed) and the `lessons_learned` row atomically
  in `saveIssue()`'s forced-close branch. `_issNewFromLessons` routes "← Back" and a successful save
  back to the Lessons screen instead of Issues'.
- ⚠️ **The legacy `newLesson()`/`openLesson()` pair is kept, unchanged in purpose, for the ONE case
  that still needs it**: a lesson with no full issue behind it (a meeting-linked or pre-migration
  standalone `lessons_learned` row). Its own `_lessMode`/`_lessPrevMode` were carrying a stale
  `'report'` value left over from before this rewrite (a bug introduced mid-session and caught before
  landing) — fixed to `'detail'`, with `_lessPrevMode` tracked the same way `newIssue()` tracks
  `_issPrevMode`, and a new `backFromLessonDetail()` written to mirror `backFromIssueDetail()`
  (previously referenced by `wireLessons()` but never defined — also caught before landing).
- Clicking a closed issue anywhere in the Lessons dashboard/log opens it via the shared `openIssue()`
  — on the Issues screen, in Issues' own Detail view — since a closed issue **is** an Issues record;
  the Lessons screen is a filtered lens onto it, not a second editor for the same row.

### Verified
- `node --check` clean throughout every edit in this pass.
- CSS brace balance unchanged at **233/233** after all new `.il-req` / `.il-backlink` /
  `.il-workflow-*` / `.il-history*` / `.il-dash-*` rules.
- **0 NUL bytes** (checked with a raw byte count, not `grep -c` — a `grep -c $'\x00'` in this shell
  reported a meaningless count and would have been a false alarm if trusted).
- **Function-set diff against the last commit: 6 lost, all deliberate** (`issListRowHTML`,
  `issSearchList`, `renderIssuesReport`, `lessonListRowHTML`, `renderLessonsLibrary`,
  `renderLessonsReport` — the old Report/Library-mode renderers, wholly superseded), **21 added**
  (the Dashboard renderers, the chart helpers, the workflow confirm/validate functions, the history
  functions, `backFromLessonDetail`, `newLessonAsClosedIssue`, `closedIssuesFiltered`/
  `standaloneLessonsFiltered`). Grepped for every removed name across the whole module + `index.html`
  — zero remaining references.
- Every static element id referenced via `$('…')`/`getElementById('…')` resolves against
  `index.html`'s raw markup (dynamically-created ids reached via `host.querySelector` inside the
  detail-view render functions are, correctly, not part of that check).

⚠️ **Not verified signed in** — no live login is possible in this environment, the standing
constraint for every UI pass in this repo. No live click-through of the dashboard charts, the
Hold/Close workflow, the history table, or the standalone-lesson closure flow against real data; the
migration has not been run.

### Explicitly NOT done this pass — flagged, not silently skipped
- **Item #2** (a Minutes-of-Meeting dashboard, mirroring this one) and **items #17–23** (Meetings tab
  redesign: defined recurring meeting schedules, a calendar showing actual-or-planned dates per
  frequency, agenda continuity from the previous meeting, required/optional/actual attendees, venue/
  link/recording fields, Internal/External meeting-type grouping, a right-pane scheduler, and a
  per-item history + hold/close narrative for `mom_items` mirroring what Issues just got) — a
  substantial separate body of work (new tables for meeting schedules/frequency, new calendar/
  right-pane/agenda UI) belonging in `modules/minutes-of-meeting/`, deliberately deferred to its own
  pass rather than compressed into this one.
  ⚠️ **DONE 2026-09-01 — see that module's own CLAUDE.md.**
- **Item #24** (download as HTML / PDF / PPTX for Issues, Lessons, and Minutes) — Minutes of Meeting
  already has a working PDF export from an earlier session (see that module's history below); Issues
  and Lessons have no export at all yet, and no module has an HTML or PPTX export. Not started.

`module.css/js?v=20260831b`; `MODULE_V` (via `modules-grid.js?v=` on `dashboard.html`/`modules.html`)
→ `20260831b`.

## 2026-08-31 — Minutes of Meeting split out into its own module

Owner: *"the minutes of the meeting and the issues and concerns should be two separate modules."*
Full detail lives in `modules/minutes-of-meeting/CLAUDE.md`; this entry is the Issues & Concerns half.

**What left this file:** the whole MoM screen — `renderMom`/`wireMom`/`momDetailHTML`/`momItemRowHTML`/
distribute/carry-over/raise (now "Get from issue" on the other side)/attachments/the PDF export — moved
wholesale to `window.MinutesOfMeeting` in the new module. The `il-tabs` strip is now two tabs (Issues &
Concerns, Lessons Learned); default `screen` changed from `'mom'` to `'issues'`; the deep-link reader
only accepts `?screen=issues|lessons` now.

**What stayed, and why — the kept half is the LINK, not a leftover.**
- `momTag()` — the register's "From MOM" tag — is untouched: it was always a light read of
  `meeting_minutes` (id/title/meeting_date only, populated in `load()`), never dependent on the full
  MoM editor.
- `MOMS` / `MOM_ITEMS` / `momItemsOf()` / `loadMoms()` / `momReset()` survive in trimmed form, for
  exactly one remaining consumer: `momLinkPickerHTML()`, the Lessons Learned "Source → A meeting action
  item" picker. It still needs to list meetings and their action items to link a lesson to one; it
  never needed the rest of the MoM apparatus (permissions, distribute state, attachments…), so none of
  that moved back in.
- ⚠️ **`momLoadDone()` is gone, not moved.** It existed to re-render the Lessons screen when a
  background `loadMoms()` resolved; `momLinkPickerHTML()` already chains its own
  `loadMoms().then(function(){renderLessons();})`, so the extra notification hook was redundant once
  the MoM screen (its other caller) no longer exists here.

**The new reciprocal link — receiving a deep link FROM Minutes of Meeting.** That module's "Capture
lesson" / "N lessons" buttons now navigate here (Lessons Learned's editor is this module's, not
theirs) instead of switching a local screen. `init()` reads `?momId=&momItem=&issueId=` or
`?openLesson=` **after `load()` completes** (now `await`ed instead of fire-and-forget, specifically so
this can run once `LESSONS`/`_lessLegacy` are actually populated) and calls the existing
`newLesson({mom_id, mom_item_id, issue_id})` or `openLesson(id)` — the exact same functions a local
"+ Capture lesson" click always called; only the trigger crossed a module boundary.

**CSS.** Removed only rules verified to have zero remaining selector usage after the JS surgery —
`.il-mi-cards/-card/-meta/-foot`, `.il-c-no/-reg/-del`, the activity-picker block (`.il-mom-act*`,
`.il-mom-chip*`), `.il-mom-by`, and the carry-over/filter-bar/attachment blocks
(`.il-mom-carry*`, `.il-mom-group*`, `.il-mom-filters*`, `.il-mom-count`, `.il-mom-file`).
⚠️ **Everything else with an `.il-mom-*` name was deliberately KEPT** — `.il-mom-wrap/-list/-detail/
-head/-item/-draft/-detail-card/-toolbar/-state/-note/-actions/-addrow/-search/-report` turned out to
be a **shared master/detail list+detail pattern**, reused verbatim by Issues' and Lessons' own
"View Open Issues"-style report screens (confirmed by grepping actual class usage in the trimmed file
before removing anything — several looked MoM-exclusive by name alone and were not). Removing those
would have broken the Issues/Lessons report views, not cleaned up dead code.

**Verified.** `node --check` clean; CSS braces balanced (194/194); every class the trimmed JS emits
resolves to a CSS rule except pre-existing JS-hook-only classes that had no dedicated styling before
this change either (`il-if`, `il-c-aging`, `il-iss-card`, `il-lf-fld`) — confirmed pre-existing, not a
regression. Grepped for every symbol this split was supposed to remove (`renderMom`, `wireMom`,
`momDetailHTML`, `MOM_ACT_NAME`, `MOM_TYPES`, `canEditMinute`, `momLocked`, `MOM_BUCKET`,
`momDownloadPDF`, `il-screen-mom`, `_momSel`, …) — zero remaining references.

⚠️ **Not verified signed in** — no live click-through of the cross-module lesson deep-link, and no
live confirmation that the "From MOM" tag still resolves against a meeting recorded in the sibling
module (the underlying read is unchanged, but the split itself is untested against real data).

`module.css/js?v=20260831a`; `MODULE_V` (via `modules-grid.js?v=` on `dashboard.html`/`modules.html`)
→ `20260831a`.

## 2026-08-30 — Tabs become a dropdown (shared `UI.tabsToDropdown`)

The shared UI pass converted this module's flat `.il-tabs` row (Minutes of Meeting / Issues &
Concerns / Lessons Learned) into a single trigger-button + menu, matching Project Schedule's own
`.ps-title-switch` pattern — one `UI.tabsToDropdown('.il-tabs')` call added to the existing
`requireLogin` callback. It works by **clicking the real, now-hidden tab buttons** rather than
reimplementing this module's own view-switching logic, so `switchScreen`/the MoM-vs-register
selectors are untouched; a `MutationObserver` on each button's `class` keeps the trigger's label in
sync with whichever screen is `.active`. Also part of the same pass: the module's title/tabs/tools
moved out of `.pd-topbar` into a new sibling `.pd-modulebar` (`UI.initModuleTopbar`, shared code, no
module-local change needed here). See the root `CLAUDE.md`'s 2026-08-30(g) entry for the full
shared-layer rationale. Module-local files untouched by this change (shared `ui.js`/`dashboard.css`
only), so no `module.css/js?v=` bump this pass.

## 2026-08-28 (b) — Open issues onto the next agenda; the red panel stops being a slab; five smaller fixes

Owner ran both migrations, then gave six items off live screenshots. `MODULE_V` → `20260828b`;
`module.css/js?v=` → `20260828a`. **No migration.**

**1. Issues raised are now logged onto the NEXT meeting's minutes** — *"similar to a carry over items
but for issues and concerns"*, and built as carry-over's sibling so the two share their rules.
- A **new minute is seeded automatically** with the register's still-open issues, and a button beside
  the carry-over dropdown pulls in anything raised since. ⚠️ Only on a **brand-new** minute: re-running
  it on every render would fight a planner who deliberately took an item off this week's agenda.
- ⚠️ **It COPIES the register link, never re-raises** — one issue, N meetings. The row therefore shows
  the register's live status and carries no Raise button, so it cannot be double-raised by hand
  either. `issues_lessons.mom_id` is untouched: provenance names the meeting an issue was FIRST raised
  from, which is what lets `canDeleteMinute()` ignore these links.
- ⚠️ **Openness is decided by the REGISTER**, the rule the screen, the PDF and carry-over already
  follow — a closed issue must not be dragged onto next week's agenda, and `On Hold` is still open.
- ⚠️ **Idempotent by construction**: an issue already on THIS minute is skipped, so pressing the button
  twice adds nothing. Scoped per minute, not globally — an issue discussed last week is still open and
  belongs on this week's agenda too.
- ⚠️ **`owner_ids` travels with `owner`**, so a pulled item still resolves on the champion's My Work
  page; copying only the text would silently drop the assignment. Tolerant of the un-run assignment
  migration — `owner_ids` is dropped and retried, so the agenda still gets its issues.
- ⚠️ **The button is offered only when there is something to bring in, and says how many.** A
  permanently-present button that usually does nothing is the invitation-to-a-no-op that the
  carry-over dropdown already avoids.
- ⚠️ **Flagged, not solved:** a project with forty open issues seeds forty action items into every new
  minute. That is what was asked for and it is what an agenda is, but if it proves noisy the honest
  fix is a filter (department, or aging) rather than a silent cap.

**2. The status panel is no longer a solid brand-red slab.** Owner: *"the red tint is pleasing but
hurts the eye… for both light and dark mode."*
- ⚠️ **Red at ~260×600px of continuous fill, with white text and white inputs punched into it, is a
  glare source.** #EE3124 is an accent chosen to be seen in small doses. That it hurt in BOTH themes is
  the tell that the problem was area and saturation, not the theme mapping. Red is now a **rail and a
  heading** over a normal card — the same move the Gantt pass made when red went back to meaning
  progress.
- ⚠️ **The RAIL is what survives of the original fixed-contrast rule** ("must not look like a different
  screen mid-meeting"): the brand cue is identical in both themes while the surface follows the theme
  like every other card. A slab that ignored the theme was the thing being complained about.
- ⚠️ **Two real WCAG failures found by measuring my own first cut**, both the trap this repo has now
  recorded three times: brand red as 10px heading text is **4.12:1** on the card, and the aging value
  was **3.60:1** on the tint. Fixed with a **paired** accent — `--pd-bad` (#C42127) light, **#FF8A80**
  dark, because `--pd-bad` remaps to #EF5350 and measures **4.02** on the dark card.
- ⚠️ **`--pd-dark-red` IS NOT A TOKEN.** Writing it resolves to nothing, silently inherits ink, and
  measures 16.3 — i.e. it looks like a pass. Verified against the real stylesheet.
- **Measured after, both themes: min 5.11 light / 6.14 dark across heading, labels, aging and inputs.**

**3. The action item is multiline, and Description comes first.** It was a single-line `<input>`, which
clips its own value — an action of any length was unreadable in exactly the mode that exists for
reading it, the same defect the reporting view fixed for Issue / Agenda. Order now follows how the item
is written up: what was discussed, then what will be done.

**4. The "Any aging" filter stopped clashing.** ⚠️ Two causes, neither of them width tuning:
`flex: 0 0 auto` gives a select an **auto basis** — its own content width — and a flex item will not
shrink below that, so the last filter ran past the card edge and was clipped rather than wrapping; and
the fixed `height: 34px` against the shared 16px control font clipped its descenders. Now
`flex: 1 1 150px; min-width: 0` (the `min-width` is load-bearing — the auto minimum reinstates the
content width otherwise) and **min**-height. Measured at 1385px: one 56px row, aging 38px, 0 overflow,
0 page h-scroll.

**5. Meeting types are the project's own** — PPR Meeting / PSC Meeting / Client Meeting, replacing the
invented starter vocabulary. Still no CHECK constraint, so a project's own wording still joins the list
through `momOptions()`.

**6. The topbar stopped spilling** (it was orphaning the avatar on its own line) — the module title
text now hides at ≤1500px, keeping the icon, well before the row is forced to wrap. The Lessons Learned
lead banner is removed at the owner's request; the screen says what it is, and the detail's "What
produced this lesson" block already explains that a link is optional.

**Verified: 135 checks executing the SHIPPED functions**, sliced by brace-matching and never
reimplemented — 11 new on the agenda rules alone (closed excluded, On Hold and blank counted as open,
already-on-this-minute skipped, an unlinked action not suppressing an issue, another minute's copy not
blocking this one, and running it twice adding nothing). ⚠️ The suite **cannot run against the
pre-change file at all**, so it bites. **0 functions lost / 2 added**; parses; 0 NUL bytes; CSS braces
233/233. Contrast and layout measured in a real browser against the shipped stylesheets in both themes.

⚠️ **Not verified signed in** — no live click-through of the seeding, the button, or the reordered
fields against real data.
⚠️ **A near miss worth recording:** I overwrote the repo's own `.claude/launch.json` while setting up a
throwaway static server, not having checked that one already existed. Restored from git. The repo
already ships `.claude/tools/static-server.ps1` — use it.

## 2026-08-26 — Testing the meeting-linked lesson picker found TWO real defects

The one path the earlier signed-in pass could not exercise (that project's single meeting had
no action items). Built the missing fixture in the QADEMO sandbox — a meeting with an action
item — and the test paid for itself immediately.

⚠️ **DEFECT 1: the Source dropdown was unusable, so a lesson could only be linked from a
pre-filled entry point.** Choosing *"A meeting action item"* — or *"An issue or concern"* —
snapped straight back to **Not linked** and no picker ever appeared. `linkKind` was derived
from the stored ids, but the dropdown is **UI INTENT that necessarily exists BEFORE any id has
been chosen**: selecting `mom` cleared `issue_id`, left `mom_id` null, and the re-render
derived "not linked" and reset the select. Now tracked as `_kind` on the in-memory object.
⚠️ It is never persisted — `saveLesson` builds its payload from named columns — so it cannot
reach the database.

⚠️ **DEFECT 2: the meeting list could render EMPTY on a project full of minutes.** `_momLoaded`
is set on the **first line** of `loadMoms` as a re-entrancy guard, so it means *"a fetch has
started"*, not *"the minutes are in hand"*. The picker tested it, decided the data was ready,
rendered from an empty `MOMS`, and never heard the rows arrive. Reproduced live, then confirmed
by re-rendering seconds later and watching the meeting appear. `loadMoms` now re-renders the
lessons screen on completion — ⚠️ **on the failure path too**, or a failed fetch leaves the
picker waiting forever. Fixing it there covers every reader of `MOMS` at once instead of making
each one race the fetch.

⚠️ **WHY THE 64-CHECK SUITE MISSED BOTH, and it is the lesson worth keeping: it stubbed
`momLinkPickerHTML` and only ever rendered lessons whose links were ALREADY set.** It tested the
renderer, never the transition. A suite that only feeds a component its settled states cannot
see a state machine that refuses to leave the first one. The suite now slices the **real**
picker and drives the before-an-id-exists states: **6 of the new checks fail against the pre-fix
file**, 77/77 pass after, 0 functions lost.

**Verified live after the fixes**, on the deployed build:
- Source stays on the chosen kind; the meeting picker appears with no id yet; the action-item
  picker stays **disabled until a meeting is chosen**, then lists that meeting's items with
  *"— the meeting as a whole —"* still offered.
- The race path (switch project → straight to Lessons → open the picker) now **self-corrects
  with no user interaction**, and the unsaved draft survives the re-render.
- Both entry points work: pre-filled from an action item's *"+ Capture lesson"*, and linked by
  hand through the dropdown. Two lessons on one action item render as **"2 lessons"** on its card.
- 0 console errors. ⚠️ **Sandbox left exactly as found** — 0 meetings / 0 lessons / 0 issues,
  every probe row removed through the app's own delete paths.

⚠️ **Smaller gap found and NOT fixed:** a meeting created in the current session is not added to
`MOM_BY_ID` (the "+ New minutes" handler pushes to `MOMS` only), so a lesson linked to it reads
*"From a meeting"* without naming it until the next load. Confirmed by reloading and watching the
title appear. Cosmetic, self-healing, and a one-line fix in that handler when it is next touched.


## 2026-08-26 — SIGNED-IN VERIFICATION of the report/lessons rework (caveat closed)

Both migrations were run by the owner and the whole rework was then driven **signed in on the
deployed site** in the owner's own Chrome. This closes the "not verified signed in" caveat the
entry below carries.

**Migrations confirmed against the live database first**, with the probe calibrated before it was
trusted — `42501` = present but grant-blocked · `PGRST205` = table absent · `42703` = column absent,
plus a **negative control on each table** so the readings are not incidental. `lessons_learned` and
all 13 columns present; `schedule_builder`(+5 cols), `schedule_builder_pushes` and
`wbs_nodes.is_package_root` present (the other session's package-scoped migration).
- ⚠️ **The backfill copied 0 rows, and that is the correct result, not a failure.** Measured:
  `lessons_on_issues = 0`, `lessons_in_library = 0`, `linked_back = 0`. Nobody had ever filled in the
  old `lesson_learned` field on any issue, so the `not exists` guard had nothing to copy. **The shape
  that would be alarming is a non-zero first column with a zero second one** — that is the one to
  check if this is ever re-run elsewhere.

**Driven end to end on the QADEMO sandbox** (chosen deliberately over a live register), and every
step verified against a **full `load()` re-query**, not just against the in-memory row:
- Tab order **Minutes of Meeting → Issues & Concerns → Lessons Learned**, module opens on the
  minutes, view toggle correctly hidden there.
- Register defaults to **Report** with the log hidden; empty states correct on both sides.
- ⚠️ **The cancel path — the decision that differs from "+ New minutes" — verified to write
  NOTHING.** Typed into the draft, pressed Cancel, then re-queried the database: register still 0.
  This is the whole reason a new issue is a draft in memory rather than an inserted row.
- **Save inserted and RLS accepted it** (`created_by = auth.uid()`): 0 → 1 TOTAL / 1 OPEN, the draft
  became a real row, detail read *"Raised by you · Operations."*
- The detail pane renders the Power Apps layout: panel **Status · Department · Champion · Date
  Presented · Days Aging · Date Resolved**, body **Issue · Caused By · Corrective Action**.
- **"+ Capture a lesson"** switched screens with the source **pre-selected to that issue**, the
  primary button relabelled *+ New lesson*, the toggle relabelled *Report | Library*, and **no
  migration banner** — i.e. the real table is being read, not the legacy fallback.
- Lesson saved, then **survived a full re-query**: it renders inside the issue's own detail pane and
  the list row flags *"lesson captured"* — the round trip the old one-lesson-per-issue model could
  not represent.
- **Reporting view: 8 controls → 0**, zero inputs inside the split, values rendered as text, save bar
  hidden, and the panel measured **`rgb(238,49,36)`** (brand red) **in dark mode** — the
  fixed-contrast island holds where a token would have remapped it.
- **0 console errors** across the whole session and on a fresh page load.
- ⚠️ **Sandbox left exactly as found** — both probe rows deleted through the app's own delete paths
  and confirmed 0 issues / 0 lessons after a re-query. No live project was written to.

**Still not exercised:** a second user (the per-row permission branches were verified against
fixtures, not against another account), the meeting-linked lesson picker, and the legacy fallback —
which is now unreachable by construction, since the table exists.

⚠️ **Separate pre-existing defect, NOT introduced here and not fixed:** `index.html` renders mojibake
— *"championâ€¦"*, *"Â·"* in the tab title, *"â€""* in the minutes lead. The file holds UTF-8 bytes
written through a cp1252 path. It predates this work (visible in the owner's screenshots from before
the change). Worth its own pass with an explicit encoding, not a find-and-replace.


## 2026-08-26 — Tab order, the register becomes a REPORT, and lessons become their own record

Four owner asks in one prompt. **⚠️ Run `migrations/2026-08-26-lessons-learned.sql`.**

**1. Tab order is now Minutes of Meeting → Issues & Concerns → Lessons Learned**, which is
the order the work actually happens: a meeting is recorded, what it raised is chased in the
register, what it taught is kept in the library. ⚠️ **The first tab is also the default
screen** (`screen = 'mom'`) — a tab strip whose first entry is not where the module opens
reads as a bug, and the register is one click away.

**2. Issues & Concerns is a REPORT, not only a log.** The owner's reference was their live
Power Apps "View Open Issues" screen, and that layout is now the default: a **red status
panel** (Status · Department · Champion · Date Presented · Days Aging · Date Resolved)
beside the **issue / caused by / corrective action** blocks, one record at a time, in the
same master/detail shape as the minutes. A **Report | Log** switch in the toolbar keeps the
table — ⚠️ **the log was not replaced, deliberately**: scanning forty issues for the one you
want is a different job from reading one of them, and both run off `issuesFiltered()`, so
switching presentation never changes the set.
- ⚠️ **Days Aging stays DERIVED and is the one field with no control** — 0 when Closed, else
  today minus the date presented. A stored aging is wrong the next morning.
- ⚠️ **The red panel is a fixed-contrast island** — brand red with white labels in *both*
  themes, its controls on a light surface. Do not token-ise its background: remapping it in
  dark mode turns the screen someone is presenting from into a different-looking screen
  mid-meeting. This is the one place in the module that deliberately ignores the theme.
- ⚠️ **The selection is validated against the FILTERED set**, not just against `rows` — a
  filter that hides the open issue has to move the pane, or the reader is looking at a record
  the list beside it says is not there.
- **Reporting view** renders every field as text rather than as a control, for the reason the
  minutes card already documents: a single-line `<input>` clips its own value, so a long
  Caused By was unreadable in exactly the mode meant for reading it. `momFieldHTML` now
  delegates to a shared `ilField`, so all three screens report the same way.

**3. The pop-up is gone. There is ONE editor for an issue and it is the detail pane.**
"+ New issue" and the log's ✎ both land there.
- ⚠️ **A new issue is a DRAFT IN MEMORY, not an inserted row — deliberately UNLIKE "+ New
  minutes"**, which inserts immediately and lets you type. It cannot work that way here:
  `issues_lessons_del` is **planner-only** (2026-08-19-department-issues.sql), so a department
  that mis-clicked "+ New issue" would leave a blank row in the register with no way to remove
  it. The draft is written on Save and discarded on Cancel, and leaving it is confirmed.
- ⚠️ `openForm` and `wireModalCursor` are **deleted, not left alongside** — a second editor is
  a second place for the fields to drift apart. Autosave went with the modal (it wrapped a
  modal's Save button); an explicit Save is the trade.
- Permission gating is unchanged and still mirrors the RLS row for row: any approved
  non-viewer may raise, you maintain your own, a planner maintains the register, and where
  delete is unavailable the card **says why** rather than hiding a button.

**4. A lesson is its own record now** (`lessons_learned`), no longer three columns on the
issue. That shape forced **one lesson per issue**, **no lesson without an issue**, and a
capture form welded to the issue form — all three are gone. A lesson carries **optional**
links to the issue, the meeting and the action item that produced it, and is captured from
three places: the Lessons screen, an issue's detail pane, and an action item's card.
- ⚠️ **An unlinked lesson is a legitimate record, not a broken one** — meetings produce
  lessons nobody logged as a problem, and a lesson brought from another project has no issue
  in this register at all. "Not linked" is the first option in the source picker, never a
  fallback, and nothing in the UI requires a link.
- ⚠️ **`on delete set null`, never cascade.** A lesson outlives its source — that is the whole
  point of a library — so deleting the issue strips the link, not the knowledge. The delete
  confirmation was reworded to say so; the old wording ("this also removes any lesson captured
  on it") is now a false warning that would stop someone deleting a duplicate.
- ⚠️ **Delete is wider here than on the register, on purpose.** An issue may not be deleted by
  the department that raised it (the record of a problem having existed is the point); a lesson
  is something someone wrote down, and a duplicate is noise in a library everyone reads — so
  its author may remove it.
- ⚠️ **LEGACY FALLBACK, and it matters.** Until the migration runs there is no table, so the
  library is rebuilt read-only from the old columns with a banner naming the file to run.
  Without it, opening the app before the migration would report a project's whole lessons
  history as empty, which reads as data loss. Legacy ids are prefixed `legacy:` so they can
  never be mistaken for a real row and sent to the database in an update.
- ⚠️ **The migration backfills and does NOT clear the old columns**, guarded by `not exists`.
  Clearing them would leave an older deployed tab showing a lesson that has vanished.
- ⚠️ The meeting picker **loads the minutes on demand** — they load lazily, so assuming they
  are in hand would offer an empty meeting list on a project full of minutes.

**Verified: 64 checks executing the SHIPPED builders**, sliced out of `module.js` and never
reimplemented — every Power Apps field present in the layout, aging derived and uneditable,
the full permission matrix (own / another department's / unauthored, planner and not), report
mode emitting no controls at all, the new-issue draft offering Cancel and no Delete, **two
lessons on one issue** (the case the old model could not represent), an unlinked lesson
rendering and correctly *not* counting toward its issue, the legacy rebuild being read-only
even for a planner, "Not linked" selected by default, search, and escaping.
⚠️ **The suite cannot pass against the pre-change file** (`NOT FOUND: ilField`), so it bites.
Function-set diff vs HEAD: **2 lost — `openForm` and `wireModalCursor`, both deliberate — 24
added.** Parses; 0 NUL bytes; CSS braces 217/217; every `$()` id resolves to the shell or to a
renderer.

⚠️ **NOT verified signed in, and the migration has not been run.** No live click-through of a
save, a lesson capture, or the meeting picker against real data — the module is behind Supabase
auth and the anon key has no grants. The first real use is the test.
`MODULE_V` → `20260826h`; module assets → `?v=20260826a`.

## MoM: last mom-app gaps closed — filters, meeting type, attachments (2026-08-21) — fmlozano
Owner: *"close the gaps by starting with the ongoing session."* **Run
`migrations/2026-08-21-mom-type-and-attachments.sql`** (after the schema/carry-over/distribute one
from earlier today). This finishes the mom-app parity list — nothing from the gap study is left open.

**Two things in mom-app were deliberately NOT copied, and both are the interesting decisions.**
- ⚠️ **Its attachment bucket is PUBLIC and it stores `/object/public/…` URLs**, so anybody holding a
  link reads the file with no login at all. Minutes attachments are site photos and commercial
  documents. This bucket is **private**, `attachment_url` holds the object **PATH**, and the URL is
  signed on demand — the same construction as `drawing_register.file_url`, including keeping the
  misleading column name for parity and documenting it rather than storing a URL that has expired.
- ⚠️ **Its category list has drifted between two hand-maintained dropdowns** — the edit form offers
  `Finance`, the filter does not, so an item categorised Finance there can never be filtered to.
  `MOM_CATEGORIES` is the UNION of both, read by the editor *and* the filter, so that defect cannot
  reproduce here.

**The category free-text I shipped this morning was a latent version of the same bug.** It is now a
select. ⚠️ Built through `momOptions()` = canonical ∪ values already used on this project ∪ **the
row's own current value** — the select-value trap this app has been bitten by twice (the drawing
register's type field silently WIPED a value on save; the schedule's work-package picker read back
`''`). A `<select>` whose value is absent from its options reports the FIRST option instead.

**Action-item filters** (search / category / type / status) with a count and a clear.
- ⚠️ **The status filter tests the REGISTER's status for a raised action**, because that is what the
  row displays — otherwise filtering to Closed would hide a row the screen is showing as Closed. Its
  options are the union of both vocabularies: `On Hold` exists only in the register and `In Progress`
  only on the minute, so offering one list would make the other unreachable.
- ⚠️ Offered only past 4 actions, and the filtered set drives the TABLE while the full set still
  drives the count and the empty state — rendering the filtered rows as if they were everything is
  how a hidden row gets mistaken for a deleted one. Filters clear when you switch minutes.

**`meeting_type` — not decoration.** In mom-app it is what the meetings list GROUPS by, and that is
the point: a project runs several standing meetings at once, so a flat date-ordered list puts last
week's client meeting between two weekly coordinations. The list now groups by type (untyped in its
own trailing bucket — every pre-migration minute is untyped, so that bucket is the whole list until
someone fills it in) and gains a search past 6 meetings.
- ⚠️ **No CHECK constraint, the opposite call from `mom_items.type` this morning.** `type` has three
  fixed values the PDF badges by name; a meeting type is project vocabulary nobody can enumerate up
  front, and mom-app lets an admin add one at runtime. The fragmentation a CHECK would have covered
  is handled by `momOptions()` offering what the project already uses.

**Attachments — the ordering rules are the whole feature**, each one because the opposite order
leaves a real mess: upload BEFORE the row write (a failed upload must never leave a row pointing at
nothing); roll the object back if the row write then fails; on replace delete the old object only
AFTER the row points at the new one; on remove null the row FIRST (a failed delete leaves a
recoverable orphan, the reverse leaves an attachment that will not open). Deleting an action or a
whole minute captures the paths BEFORE the rows leave memory — after the cascade they cannot be
queried at all. The PDF names the file but never links it: the bucket is private, so a link would be
dead for whoever opens the sheet.
- ⚠️ **The bucket's INSERT policy is `is_writer()`, not the `is_approved()` the 2026-06-18 buckets
  use.** That older rule predates viewer-readonly and lets a VIEWER upload into a register they
  cannot write a row to — an orphan by construction. A new bucket has no legacy uploads to protect,
  so it starts on the correct rule instead of inheriting the drift. DELETE keeps the `owner` branch
  beside `is_planner()`, matching the settled rule on the other three.

**Verified by executing the shipped code, sliced not stubbed: 42 new checks** (75 across the three
MoM suites) — the select-value round-trip, every filter incl. the register-status rule, the grouping
and its untyped/single-group cases, and all four attachment ordering rules driven with injected
failures. Header/row cells align 11/11 writer, 10/10 read-only. **0 functions lost, 16 added.**
- ⚠️ **A real layout defect the harness caught and reading would not have:** the filter bar rendered
  **203px tall** — the shared `.pd-select` is `width:100%` (built for stacked `.pd-field` forms), so
  every select claimed the whole bar and landed on its own row. Fixed to 52px, one row. Every filter
  bar in this app has to override that; it is not decoration.
- ⚠️ **A literal NUL byte** got written into a patch script where a space belonged, truncating a JS
  string at the sentinel. `module.js` was checked byte-wise for NULs (0) after every patch.
- ⚠️ **Not verified signed-in, and neither migration has been run** — the module redirects to login
  and I do not enter credentials, so upload/distribute/carry-over click paths are unexercised against
  real data and the bucket policies are structurally checked only. `MODULE_V` → `20260821e` (another
  session had taken `d`); the module's own `?v=` → `20260821c`.

## MoM: mom-app item schema, carry-over keeping the register link, draft→distribute (2026-08-21) — fmlozano
Owner: *"Let's proceed with all 3. But I like how our minutes of the meeting can push action items to
issues & concerns. Let's consider that with the carry-over. I also like the new formatting we have.
Let's keep."* **Run `migrations/2026-08-21-mom-schema-carryover-distribute.sql`.** The PDF format
shipped earlier today is **unchanged** — re-measured after the schema change: band `rgb(180,0,0)`,
wrap `718.1px` (= 190mm), the same six grid tracks, the same badge palette.

- ⚠️ **ONE migration, not three, and the header says why.** Carry-over copies `issue_id`, which
  changes what `mom_has_raised()` means (the delete guard written in the department-minutes
  migration); distribution gates both what can be READ and what may be RAISED. Split apart, any one
  of them leaves the other two describing rules that are no longer true.
- ⚠️ **The action text MOVES out of `description` into `action_item`, once.** `mom_items.description`
  has always held the action ("Resequence L4 formworks"), which is why the PDF already printed it as
  Action Item. Leaving it there would mean the same column means the action on old rows and the
  elaboration on new ones, with no query able to tell which. **Guarded on the column not having
  existed, not on the data** — the obvious "backfill where action_item is null" would silently refill
  from a now-different field the first time a user legitimately clears one.

**Carry-over — the owner's specific interest, and it drove three decisions.**
- ⚠️ **It COPIES the register link rather than re-raising.** A carried action is the same issue,
  discussed again, so `issue_id` comes across and the new minute shows the register's live status.
  Re-raising would put two competing issues in the register for one problem — and because the Raise
  button only renders when `issue_id` is null, copying the link also makes double-raising by hand
  impossible. **One issue, N meetings.**
- ⚠️ **What is "still open" is decided by the REGISTER for a raised action**, the same rule the screen
  and the PDF already follow. An action raised months ago and since closed in the register must not
  be dragged into next week's agenda because nobody went back to tick the box on the old minute.
- ⚠️ **`mom_has_raised()` had to be re-defined or carry-over would have broken own-delete.** A carried
  item has an `issue_id`, so the old test said "something was raised here" and turned every
  brand-new draft seeded from an old meeting into a planner-delete-only row. Nobody raised anything —
  `issues_lessons.mom_id` still names the meeting the issue was FIRST raised from, and carry-over
  never moves it, so deleting a meeting that merely carried the action destroys no provenance. The
  test now excludes carried links, and `canDeleteMinute()` mirrors it.
- Idempotent by construction (already-carried source items are skipped) and it **says so** rather
  than silently doing nothing; `carried_from_mom_id` records the first seeding only.

**Draft → Distribute.**
- ⚠️ **Only the READ narrowing is enforced in the database, deliberately** — that is the part that is
  a security boundary (a draft is visible only to its recorder and planners; `mom_items` had to match
  or a draft's action items leak while its heading does not, which is the leak, not a lesser version
  of it). The "distributed minutes are locked for editing" half is **UI-only**: it is a workflow
  guard, not a permission, and the person it stops may legally revert two clicks later. UI stricter
  than RLS is safe; the reverse is the silent-failure trap.
- ⚠️ **An action cannot be raised out of a draft, and THAT is enforced in the DB** (`issues_lessons_ins`
  now tests `mom_is_distributed`) — unlike the edit lock, this one leaves a permanent row behind if
  it slips through, whose "Raised at: …" provenance would point at a minute the reader cannot open.
- ⚠️ **Existing minutes backfill to DISTRIBUTED**; the column defaults false only for new rows. They
  were written in a world with no draft concept and already have actions raised off them — letting
  the default apply would retroactively hide the entire history from everyone but each recorder.
  Guarded on the column not having existed, **not** on "nothing is distributed yet", which is also
  true of a project that reverted everything to draft.
- The PDF **prints a DRAFT chip and appends `_DRAFT` to the filename** on an undistributed minute: a
  PDF outlives the screen that knew it was a draft, and that is the one way this export could mislead.

**Smaller things that were still defects.**
- ⚠️ The inline-edit handler wrote `''` on an empty field. `type` carries a CHECK, so clearing it
  would have been **refused by the database**; the other new columns would have stored `''` where
  every read tests null. Empty is now NULL on the nullable columns.
- ⚠️ A legacy row printed its action text under **both** Action Item and Description in the PDF —
  caught by the harness, fixed by blanking Description when the action text came from it.

**Verified by executing the shipped code, sliced not stubbed: 33 checks** — 23 on carry-over
(register-decides-openness, link copied, not re-raised, seq/idempotency, all four refusals, failed
insert leaves the minute unstamped, and both halves of the carried-vs-raised delete rule) and 10 on
the raise guard (draft refused, action text not description, link after insert). Header/row cell
counts align exactly (9 read-only / 10 writer, both sides). **0 functions lost, 4 added.** Migration
is paren-balanced, `$$`-paired, every policy preceded by a drop. ⚠️ **Not verified signed-in, and the
migration has not been run** — the module redirects to login and I do not enter credentials, so the
new controls' click paths are unexercised against real data. `MODULE_V` → `20260821b`; the module's
own `?v=` → `20260821b`.

## Minutes of Meeting exports a PDF in mom-app's exact format (2026-08-21) — fmlozano
Owner: *"There is a minutes of the meeting app of the same github account of a different repository.
Let's implement the download pdf feature following exactly the same format of the exported pdf."*
(`PMODepartment/mom-app`, a single 3341-line `index.html`.) **No migration.** A `⬇ PDF` button on
every minute in `modules/issues-lessons` renders the same sheet that app produces: the `#b40000`
header band with the white logo and project — title / date / location / item count, then one bordered
card per action with the six-column meta grid (`0.4fr 1.5fr 0.9fr 0.9fr 1.2fr 1fr`), the grey field
blocks, the same badge palette, and the same html2pdf/jsPDF options (A4 portrait, 10mm margins,
scale 2, JPEG q0.98).

- **Verified against the real source, not a re-implementation.** The exporter was executed by
  slicing its own text out of `module.js` in a throwaway harness and stubbing only the closure it
  reads. The rendered node measured `rgb(180,0,0)` on the band, `718.1px` (= 190mm at 96dpi) wide,
  the six grid tracks in the ratios above, and every badge colour byte-identical to mom-app's map.
- ⚠️ **The export is offered to READ-ONLY viewers**, unlike every other control on the detail card.
  Exporting is a read, and the person who most needs the sheet — someone who attended the meeting
  but did not record it — is exactly the one `canEditMinute()` says no to.
- ⚠️ **Field mapping is lossy in one direction and richer in the other**, because the two apps do
  not share a schema. `mom_items` has no `category` / `type` / `issue` / `action_item`; it has one
  free-text `description`. So `Action Item` ← `description`; `Issue / Agenda` ← the linked
  register issue's description; `Description` ← what the register now says; `Type` ← Issue when
  raised else FYI; `Category` ← "Raised in register" / "Held in minutes" — a true statement about
  the action rather than a dash in every row of every export. Going the other way, `attendees`,
  `notes` and the linked schedule activity exist HERE and not in mom-app, and they print in the
  same field blocks above the actions: dropping the minute's substance to match a narrower app
  would export a worse record.
- ⚠️ **A raised action prints the REGISTER's status, not `mom_items.status`** — the same rule the
  screen follows. Printing the minute's own copy would put a stale status on paper that outlives
  the screen showing the live one.
- ⚠️ **`in progress` was ADDED to mom-app's badge palette.** mom-app has no such status; `mom_items`
  does, and without an entry the most common mid-flight status would have printed in the default
  grey — the same grey as Closed.
- ⚠️ **The export node is built as detached inline-styled DOM, parked at `left:-10000px`, and
  removed in `finally`.** html2canvas rasterises real laid-out DOM, so an orphan node has no box and
  renders blank; and a throw mid-render would otherwise leave the node behind, stacking one more on
  every later export. The inline styles are deliberate — `module.css` must not reach this element or
  a dark-theme session would export a dark sheet.
- **Header is saved before rendering** when the user may edit: the exporter reads `MOMS`, not the
  form, so a title typed and not saved would have been missing from the sheet.
- Library is the same `html2pdf.js@0.10.1` bundle mom-app loads. `MODULE_V` → `20260821a`, and the
  module's own `?v=` → `20260821a`.

## Departments record minutes too — per-MINUTE permissions (2026-08-20) — fmlozano

Owner: *"Let departments record minutes too."* **Run
`migrations/2026-08-20-department-minutes.sql`.** This is the other half of D1: it does to
minutes what D1 did to issues, and for the same reason — the screen is department-facing now.

⚠️ **It is NOT a blanket widening, and that is the whole design.** The tables were created
under `for all using (is_planner())` — one rule for four commands. Swapping `is_writer()` into
that same shape would let any approved non-viewer rewrite or delete **another** department's
minutes: a record of a meeting they may not have attended. So three commands, three rules:
- **insert** — any approved non-viewer on an accessible project, stamped as themselves
  (planners exempt, for minutes typed up on someone else's behalf).
- **update** — planner+ on anything; everyone else only minutes they recorded. ⚠️ Asserted in
  **both** `using` and `with check`: with `using` alone a row can be updated *out of* your own
  ownership, leaving you neither the right to fix it nor the record of having written it.
- **delete** — planner+ on anything; everyone else their own, **and only while nothing has been
  raised from them**.

⚠️ **Why own-delete exists here when the register's does not:** "+ New minutes" INSERTs
immediately and then lets you type, so a mis-click leaves a real empty row — without own-delete
every stray draft would need a planner. ⚠️ **And why it is guarded:** once an action is raised,
issues in the register point back at the minute for provenance ("Raised at: …", the From MOM
tag), and `on delete set null` means deleting it *silently strips that* rather than failing.
Stripping provenance is a planner's call, not a side effect of tidying your own drafts.

⚠️ **`mom_items` ownership is DERIVED, not stored, and is not getting a `created_by`.** An
action item belongs to its minute (already `on delete cascade`), so "may I touch this action?"
is the same question as "may I edit the minute it is on?" — `mom_is_mine(mom_id)`, a
SECURITY DEFINER helper with a pinned `search_path` like every other helper here (a policy whose
sub-select is itself RLS-filtered is how this schema got a stack-depth recursion bug once).
A second ownership column would be a second answer to that question, free to disagree — someone
else's action sitting inside minutes you own.

**The UI mirrors it per minute, not per screen** (`canEditMinute` / `canDeleteMinute`): the
single `canMinutes` flag is gone, because no one flag can say "yes for this row, no for that
one", and a flag that says yes where the DB says no is the silent failure D1 removed. A
department sees "+ New minutes"; its own minutes fully editable; another department's read-only
with **who recorded it** (department-level, never a person — resolving `created_by` to a name
would need a read of `users` for a caption); and where delete is unavailable it says why instead
of just missing a button. A minute with no `created_by` is planner-only and says so.

- **103 checks green** (was 79) against the section sliced verbatim from the shipped `module.js`,
  incl. the full matrix — planner/department/viewer × own/another's/unauthored minute, delete
  before and after something is raised, and both write paths refusing what the policy refuses
  (`momSaveItem` on another department's action, `momRaiseIssue` out of their minutes) while the
  same calls succeed on your own. ⚠️ The suite **cannot pass against the pre-change file** — it
  dies on `canEditMinute is not defined`. **12 browser combos** (planner / dept-own / dept-other
  × desktop/phone × light/dark).
- ⚠️ **A stale harness option silently became a PASS**: `build({ canMinutes: false })` kept
  "asserting" a read-only case after the option stopped existing, so it was really testing a
  planner. Renaming a flag invalidates every test that named it — the chip's unlink rule is now
  asserted through its argument instead.
- ⚠️ Migration structurally checked only (parens/`$$`/every policy preceded by a drop/the generic
  `*_write` dropped). **The policies themselves are NOT verified against a live database** — and
  `admin_*`-style checks cannot be run from the SQL editor anyway, since `auth.uid()` is NULL for
  the `postgres` role. Neither MOM table is in `supabase-schema.sql` / `supabase-setup.sql`
  (pre-existing drift, same as its predecessor), so `/migrations` remains their only definition.

## Minutes of Meeting moved IN from the Project Schedule (2026-08-20) — fmlozano

Owner: *"There is a minutes of the meeting within the project schedule module. Let's move this
out and connect it to issues and concerns module. Lessons Learned, departments can also add
issues."* A meeting's action items are chased as entries in THIS register, so the minutes now
sit beside it: a third topbar screen — **Issues & Concerns | Lessons Learned | Minutes of
Meeting** — reading the same `meeting_minutes` / `mom_items` tables. **No migration.**

### What the move actually bought
- ⚠️ **The linked issue is read out of `rows`**, the register this module already holds, so there
  is no second fetch of `issues_lessons` and no second copy of a status to drift. The schedule
  module had to fetch them separately (`MOM_ISSUES`) precisely because it did not own the
  register; that whole round-trip is gone.
- **A raised action appears in the register immediately** — the new row is pushed into `rows` and
  the filter options refreshed, instead of making the planner reload to find what they just filed.
- The action item's status pill now shows the **register's** status, not the action's own, because
  the register is what owns it after raising.

### What was deliberately preserved
- **Still one-way.** Raising COPIES the action into the register and links the two; from then on
  the register is authoritative and the minute keeps saying what the meeting said.
- **Raising is idempotent** (button rendered only when `issue_id` is null, re-checked before the
  write), the **insert happens before the link** (a link written first + a failed insert = an
  action that reads "Raised" while nobody chases it), and a failed *link* leaves the action
  honestly unraised with a warning to check for a duplicate.
- ⚠️ `mom_items.status` and `issues_lessons.status` are **not the same list** — In Progress
  translates to On Hold on the way across. Tested as a table: Open→Open, In Progress→On Hold,
  Closed→Closed, blank→Open.
- Deleting an action or the whole minutes never deletes an issue already raised, and both
  confirmations say so.

### Two things that had to change with the address
- ⚠️ **The activity picker searches the server.** The schedule module could offer a `<datalist>`
  over its own loaded rows; this module does not own the schedule and must not pull 40k
  activities into a side screen. And a datalist could not have served it anyway — it filters on
  each option's VALUE (which has to be the `activity_id` we store), so typing part of a NAME
  would match nothing (the trap documented when the drawing register's picker was built). It is
  now an `ilike` on id **and** name, capped at 25 with a "keep typing to narrow" note, debounced
  250ms, WBS summaries excluded. ⚠️ PostgREST's `or()` is comma/paren delimited, so those
  characters are stripped from the term or they would corrupt the filter instead of being searched.
- ⚠️ **Write permission mirrors the RLS, and that is the database talking, not a preference.**
  At the move it was planner-only (`meeting_minutes` / `mom_items` were created under
  `is_planner()`); the owner then asked for departments to record minutes, so it is now
  per-minute — see the entry above.

### Verified
- **79 checks green** against the MOM section **sliced verbatim out of the shipped `module.js`**
  (the slice asserts all eleven functions are present, so it cannot silently test nothing):
  keyset paging via `PDb.selectAll`, display order with blanks last, the load-error path naming
  the migration, all four status translations, the four raise failure modes, idempotency, the
  empty-action refusal, the `or()` sanitiser, the picker's min-length/WBS/limit rules, the
  name-cache, escaping, and `momReset` on a project switch.
- **Real browser, 8 combos** (planner/read-only × desktop/phone × light/dark) against the shipped
  CSS: two panes at 1280 (260px list), stacked at 375, no page h-scroll, the action grid scrolling
  inside its own box, and the read-only render carrying **no** write control and 13 disabled fields.
- ⚠️ **One real defect found by measuring, not by reading:** at 375px the detail pane came out
  **1123px wide** and gave the whole page a horizontal scroll — turning the flex row into a column
  left `align-items:flex-start` sizing each pane to its content, and `min-width:0` does not
  constrain a column item. Fixed with `align-items:stretch` + an explicit width.
- ⚠️ **Not verified signed-in** — no live click-through of a real raise against the live tables.
  Assets `module.css/js?v=20260820a`.

## Live collaboration + offline (Phase 1 & 2) (2026-07-26) — fmlozano
Same "◑ register" recipe as risk-register (see that module's CLAUDE.md): presence (`#il-presence`),
row-level cursor on Edit-modal open (`wireModalCursor`/`paintRemote`), live rows via postgres_changes,
offline modal-update via `PDSync.write` + read-cache (`il:<pid>`). Realtime migration
`2026-07-26-realtime-collab-registers.sql` (USER MUST RUN). `node --check` ok; not browser-verified.
Assets + `module.js?v=20260726a`.

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

## 2026-08-22 — MoM UI clash, raise deadlock, Reporting view, module audit

**The UI clash (owner-reported, screenshot).** `.il-mom-actions td:first-child { width:100% }`
plus `td:nth-child(2..4)` were written when the columns were `Action | Owner | Due | Status`.
Inserting No. / Category / Type / Issue in front silently re-aimed "take all the slack" at the
**No.** column (~247px cell, 223px input) while Category crushed to "Com" and Status to "C".
Specificity (0,2,1) also beat the `.il-mom-table .il-mi-no` (0,2,0) rule meant to hold it.
Same failure class as the schedule's `_CELL_META` index drift.
⚠️ **Never size this table by position.** Every `<th>`/`<td>` now carries its own `il-c-*`
class and the CSS keys off that, so inserting a column cannot re-target a rule again.
Measured after the fix: No. 96 (input 72), Cat 184, Type 128, Issue 224, Action 264, Owner 154,
Due 169, Status 152, File 76, Register 137, Del 56; header 11 cells = body 11 cells; the
`carried` badge is `display:block` and unclipped; table 1639px scrolling **inside**
`.il-mom-tablewrap` (887 visible) with **page horizontal scroll 0** (was 198).

**⚠️ THE RAISE DEADLOCK (mine, owner-reported).** `ro = !mayEdit || locked` conflated
*permission* with the *workflow lock*. Raising requires the minute to be DISTRIBUTED (the DB
enforces it in `issues_lessons_ins`) — but the cell was gated on `ro`, which is true the moment
a minute is distributed. So a **draft** rendered a button the database always refused, and
**distributing made the button disappear**: there was no state in which an action could be
raised at all. Fixed by passing `mayEdit` and `locked` separately. Verified in all three states:
`!mayEdit` → dash; writer + draft → **disabled** button whose title says to distribute first;
writer + distributed → **live `.il-mi-raise`** — the state that was previously unreachable.

**Reporting view** (owner asked for a presentable read-only record). Session-only `_momReport`,
never persisted — it is how the record is being *looked at* right now, not a property of the
minute. The class is toggled on `#il-mom-view`, **not `<body>`**, so switching to Issues &
Concerns cannot leave the register in report mode. Verified: controls go transparent and
`pointer-events:none`, add-item / carry-over / save / delete / row-delete / delete-column all
hide, and toggling back restores the DOM **byte-identical** to before.

**Audit of the whole module.** 0 NUL bytes, parses, CSS braces 189/189, **0 functions lost**
(77 = 77 vs HEAD), no positional column selectors left (the only `:first-child` matches are a
warning comment and `.il-mom-group:first-child`), every read goes through `PDb.selectAll`
(no raw `.select()` — the 1000-row truncation class), and both `mom_items` inserts supply
`description` and an explicit `status`. `description`'s original `not null` was already dropped
by the 2026-08-21 migration, so the action-text move cannot break inserts.

⚠️ **One real find, fixed:** the item **status** select rendered `MOM_STATUSES` with no
off-list fallback, so a legacy row holding anything else would silently report **'Open'** —
the select-value trap. It is deliberately **not** routed through `momOptions()`, because that
helper always emits a blank first option and picking it would write `''` into a CHECK-constrained
column and be refused; an off-list value is appended instead. Verified: in-list selects
correctly, `'Deferred'` survives and is selected, no blank option in any of the three cases.

📌 **Noted, not changed** (a design call, not a defect): `MOM_STATUSES` (Open | In Progress |
Closed) and the register's `STATUSES` (Open | On Hold | Closed) differ. The item's own select
shows `it.status` while the filter (`momItemStatus`) and the register pill show the *linked
issue's* status, so a raised item can be filtered by "On Hold" while its select reads its own
value. The "Raised · <status>" pill makes the register's value visible on the row.

Suites re-run green after every edit: carry-over **23**, raise **10**, gaps **42** = **75**.
`MODULE_V` → `20260822b`; module assets → `?v=20260822a`.
⚠️ **Not verified signed-in** — measured in a harness against the real CSS and the shipped
functions, not through a live login.

## 2026-08-22 — One status vocabulary: the register's words win

Owner: unify the status lists, and **follow On Hold instead of In Progress**.
**⚠️ Run `migrations/2026-08-22-unify-mom-status.sql`.**

The two lists had drifted since the tables were created:

    mom_items        Open | In Progress | Closed
    issues_lessons   Open | On Hold     | Closed

That was visible to the owner, not cosmetic: raising an action had to **translate** the value
(`In Progress` → `On Hold`) on the way into the register; `momStatusFilterOpts()` had to offer
**both** vocabularies because `momItemStatus()` could return either; and a raised action could be
filtered by a word its own dropdown did not contain. The register's vocabulary wins — it is the
authoritative record of what is being chased, minutes feed it, and its word is the one the
dashboard's attention band already reads (`config.js` → `attention.values = ['Open','On Hold']`).

⚠️ **The migration's ORDER is the whole risk.** The old CHECK forbids `On Hold` and the new one
forbids `In Progress`, so neither can be added while the rows or the other constraint disagree:
**(1) drop the old CHECK → (2) move the rows → (3) add the new CHECK.** Doing (3) before (2) fails
on every in-flight action in the database. The old constraint is dropped **by definition, not by
name** — it came from an inline `check` in the create-table, so its generated name is not
guaranteed to be `mom_items_status_check` on an instance that has been through a table rewrite.
Nulls are settled to `Open` in the same pass (the column is nullable and a null renders as `Open`
in a select with no blank option, so the data is made to agree with what the screen already claims).

⚠️ **`issues_lessons` is deliberately left alone.** It already holds exactly this vocabulary and
carries **no CHECK of its own** (the column predates these migrations). Adding one is a separate
decision about a separate table and would fail on any historical row holding a word neither list
anticipated. Verify first: `select status, count(*) from issues_lessons group by 1 order by 2 desc;`

**Code: `MOM_STATUSES` is gone.** `STATUSES` (declared at the top of the same IIFE — confirmed by
checking the scope: one IIFE opens at line 23 and never closes before line 780) is now the single
list, read by the register's filter, the register's edit modal, the MoM filter and the MoM item
select. Do **not** reintroduce a MoM-only list; the CHECK now refuses `In Progress`.
- `momStatusFilterOpts()` collapses to `STATUSES.slice()` — kept as a function because it is the
  seam the filter bar and its tests both call, and `.slice()` so a caller cannot mutate the shared
  array (asserted in the suite).
- Raising no longer translates: `var st = it.status || 'Open';`
- ⚠️ **The PDF's `'in progress'` badge key is RETAINED on purpose.** An export runs against
  `MOM_ITEMS` **in memory**, so a tab opened before the migration can still print a stale value —
  and dropping the key would render it in the default grey, the same grey as Closed. One line, and
  it fails safe.
- ⚠️ The status column's **width floor was not retuned down** now that the longest option is
  shorter: the column also renders an off-list legacy value carried through by `momItemRowHTML`,
  and a floor set to the shortest possible list is a floor that crushes the first surprise.

**Verified** by executing the shipped functions: the item select offers exactly `Open, On Hold,
Closed` with **no blank option**, a legacy `In Progress` row is carried through and selected rather
than silently reporting `Open`, and the filter returns the one list. Suites re-run green — carry-over
**23**, raise **10**, gaps **44** (the gaps suite's "offers BOTH vocabularies" assertion encoded the
old behaviour and was rewritten to assert the single list, plus that `In Progress` cannot leak back
and that the options are a copy). **0 functions lost** (77 = 77). Parses; 0 NUL bytes.
- ⚠️ **`t_gaps.js` seeds `STATUSES` now, not `MOM_STATUSES`** — the harness slices the MoM region,
  and the shared list is declared 570 lines above it, outside the slice.
- ⚠️ **A wrong turn worth recording:** the first cut routed the item select through `momOptions()`.
  That helper **always emits a blank first option**, and picking it would write `''` into the
  CHECK-constrained column and be refused by the database. The select builds its options inline and
  must stay that way.

`MODULE_V` → `20260822c`; module assets → `?v=20260822b`.
⚠️ **Not verified signed-in, and the migration has not been run.**

## 2026-08-22 — Action items are CARDS, not a table (the reporting rework)

Owner, on the live screen: *"The UI needs a big rework since I need to have all of the details
for the action items to be read in one view especially during reporting"* — then, decisively:
*"this is true when viewing the minutes of meeting in the mom-app."*

That second message settled the design. **No migration.**

⚠️ **NEVER PUT THE COLUMNS BACK.** The action items were an 11-column table with
`min-width: 1400px` scrolling inside `.il-mom-tablewrap`. On the owner's own screen (a ~1490px
detail pane) the table still needed 1639px, so **Owner, Due, Status, File and the register link
all sat off the right edge behind a horizontal scrollbar** — precisely the columns someone
reporting from the screen needs to read.

⚠️ **Re-tuning the widths could not have fixed this, which is why the previous pass didn't.**
An action item has more fields than a screen has columns: any set of widths that fits them all
crushes the text fields, and any set that keeps the text readable overflows. The layout had to
stop being a row. Yesterday's per-column class work was a correct fix to the *wrong* problem —
it made the columns aim at the right cells, but eleven columns were never going to fit.

**The card mirrors mom-app's own layout — the same structure `momDownloadPDF()` already
renders:** a six-cell meta grid (No. / Category / Type / Status / Responsible / Target date)
above full-width text blocks. That is deliberate and worth preserving: the screen and the export
are now **one document**, so what a planner reads on screen is what the PDF prints. A third
bespoke on-screen layout would let the two drift, which is the drift this module has already
been bitten by twice (the mom-app category dropdowns, the two status vocabularies).

**Reporting view now renders values, not controls** (`momFieldHTML`). ⚠️ This is not cosmetic:
a single-line `<input>` **clips its own value** — measured, a 659px value inside a 416px box —
so a long Issue / Agenda was unreadable in the one mode that exists for reading it. Text wraps;
an input cannot be made to. It also stops a printed-looking record being built out of form
widgets. `overflow-wrap: anywhere` on the value means an unspaced run can never widen the card
and reintroduce the scrollbar this whole change removes.

**`description` is now on screen.** It has been a real column since the 2026-08-21 migration and
the PDF has always printed it, but the table had no column for it — so the export carried a field
the screen could not show. In reporting it appears only when it has something to say, and it is
blank when the action text *came from* `description` (a legacy row), the same rule the PDF applies.

⚠️ **Grid columns are stepped COUNTS (6 → 3 → 2), not `auto-fit`.** auto-fit with a minmax floor
packed five tracks into the pane and stranded Target date alone on a second row — never clipped,
but a 5+1 split reads as a mistake. Every step divides six exactly. At full width the tracks are
the PDF's own fractions (`0.6fr 1.5fr 0.9fr 0.9fr 1.2fr 1fr`) so Category gets the room its
longest option needs (measured 202px for "Commercial / Contracts") instead of an equal share.

⚠️ **A bug caught in my own patch before it shipped:** the No. field keeps the `carried` badge
inside its block, and my first cut did that by stripping a `</div>` off the helper's output. In
reporting the body *itself* contains a `</div>`, so it would have closed the wrong element and
broken the card. The badge is passed as an explicit `extra` argument instead.

**Verified in a browser against the real CSS**, gated on a sane viewport (⚠️ two readings were
thrown away first — one taken while the window was not compositing, reporting `clientWidth: 0`,
and one under leftover mobile emulation pinning the layout viewport at 980px; both produced
confident nonsense like "139 elements offscreen"). At 1265px: **0 fields offscreen, 0 clipped,
0 page horizontal scroll, 0 inner scroll** in both edit and reporting; all 11 fields present;
reporting = 9 values / 0 controls and the long Issue / Agenda fully wrapped; toggling back
restores the DOM byte-identical. Reflow verified at 805px (3 columns, 2 rows) and 520px
(2 columns, 3 rows) with all 11 fields still present and nothing offscreen.

Suites green — carry-over **23**, raise **10**, gaps **44**. **0 functions lost**, 1 added
(`momFieldHTML`). Parses; 0 NUL bytes; CSS braces 190/190.
`MODULE_V` → `20260822d`; module assets → `?v=20260822c`.
⚠️ **Not verified signed-in.**

## 2026-08-22 — ⚠️ THE PDF EXPORT HAD BEEN PRODUCING A BLANK PAGE ALL ALONG

Owner: *"PDF download works but format isn't working"*, with four sample files. **No migration.**

**It was not a formatting problem. Every sheet was an empty A4 page.** All four samples were
byte-identical at 3,058 bytes; the page's entire content stream was `0.567 w / 0 G` — a line
width and a stroke colour — and `/XObject <<>>` was **empty**. `html2pdf` rasterises to a JPEG,
so a file with no image is a blank page. Nothing about the layout was ever reaching paper.

⚠️ **THE EXPORTED NODE MUST BE IN NORMAL FLOW. Do not put `position:fixed` (or absolute) back
on `wrap`.** It carried `position:fixed;left:-10000px` to park itself off-screen. html2pdf clones
the source into its own container and measures it there, and **an out-of-flow element contributes
nothing to that container's height** — so html2canvas got the correct width and a height of
**zero** and rendered no image at all. Measured across positioning modes on the real library:

| `wrap` positioning        | canvas    |
|---------------------------|-----------|
| in normal flow            | 1438×360 ✅ |
| `position:fixed` off-screen  | 1438×**0** ❌ |
| `position:absolute` off-screen | 1438×**0** ❌ |
| `fixed` + explicit `height:400px` | 1438×**0** ❌ |

⚠️ An explicit height does **not** rescue it — the clone is still out of flow. That is the trap:
the element measures fine in the page (`offsetHeight` 179), so every check short of rendering it
says it is healthy.

**Fix: the off-screen parking moved to a HOLDER; the captured element stays in normal flow inside
it.** The holder hides the node, `wrap` is what gets rendered, and removing the holder still takes
`wrap` with it in the `finally`.

⚠️ **Why this survived since the export shipped:** the original verification measured the *node's*
geometry (band colour, 190mm width, grid tracks) and the DOM lifecycle, and the log said so
honestly — *"nobody has opened a generated PDF… what is proven is the render call and the DOM
lifecycle, not the visual output."* That gap was exactly where the bug lived. **Measuring the
source of a render is not verifying the render.**

**Verified end-to-end on a real produced file**, which is the check that was missing before: the
shipped `momDownloadPDF` run against the real `html2pdf@0.10.1` now writes **216,539 bytes with a
1438×1406 DCTDecode image** (was 3,058 bytes, no image), and the extracted JPEG shows mom-app's
format exactly — the `#b40000` band with the logo, project — title, date / location / item count,
the attendees and notes blocks, then one bordered card per action with the six-cell meta grid and
the coloured Type/Status badges.
- ⚠️ Two harness attempts failed silently first and neither was the module's fault: `html2canvas`
  is **not** a global in the html2pdf bundle, and intercepting `.save()` on the object returned by
  `html2pdf()` misses, because `.set()` returns a **different** worker — the interception has to
  patch the worker **prototype**. The first failed attempt wrote a real file to Downloads.

Suites green — carry-over **23**, raise **10**, gaps **44**. **0 functions lost** (78 = 78).
Parses; 0 NUL bytes. `MODULE_V` → `20260822e`; `module.js?v=20260822d`.
⚠️ **Not verified signed-in** — proven against the shipped exporter and the real library with
fixture data, not through a live login on real minutes.
