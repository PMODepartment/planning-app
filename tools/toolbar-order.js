/* THE MODULE BAR'S ONE ORDER, ENFORCED — tools/toolbar-order.js
 *
 *   node tools/toolbar-order.js
 *
 * Owner 2026-09-16: *"Let's also double check the sequencing of the buttons of the toolbar. Some
 * modules have the filter button first then others last. Some has the main red button last or
 * before the filter. Let's make this consistent making sure that the modules UI are
 * professionally looking, simple and yet elegant."*
 *
 * The order, read left to right as a sentence — what am I looking at, narrow it, do the thing I
 * came to do, then the occasional tools, then the two that belong to the page rather than the
 * work:
 *
 *     [ view / mode ] | [ filter ] | [ PRIMARY ] | [ other tools ] [ export ] [ refresh ]
 *
 * ⚠️⚠️ THIS EXISTS BECAUSE EIGHT OF FIFTEEN BARS DISAGREED, and nothing could tell. The order is
 *    markup order across fifteen separate files, so it drifts the moment anyone adds a button to
 *    the end of a cluster "because that is where the cursor was". A checker is the only thing that
 *    notices.
 *
 * ⚠️⚠️ AND IT SELF-TESTS FIRST, on both directions. A checker that has never failed proves
 *    nothing — and this one's FIRST version passed every module while being wrong: it counted the
 *    items *inside* a dropdown menu as toolbar buttons, so Minutes of Meeting and Project Schedule
 *    were reported out of order when they were not, and Progress Photos' primary went uncounted
 *    because its trigger lives inside a `*-wrap` div. Both shapes are in the self-test.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RANK = { view: 0, filter: 1, primary: 2, tool: 3, export: 4, refresh: 5 };

/* ⚠️ A MENU PANEL IS STRIPPED; ITS TRIGGER IS NOT. The distinction is the whole reason the first
   version of this file was wrong. `<div class="pp-addmenu">` is the panel — its buttons are menu
   items and must not be read as toolbar buttons. `<div class="pp-addmenu-wrap">` is the wrapper
   that HOLDS the trigger, and the trigger is a real toolbar button (often the primary). So: strip
   a div whose class list has a token ending in `menu`, and never one ending in `wrap`. */
function stripMenuPanels(html) {
  const re = /<div\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const cls = /class="([^"]*)"/.exec(m[1]);
    if (!cls) continue;
    const tokens = cls[1].split(/\s+/).filter(Boolean);
    const isPanel = tokens.some(t => /menu$/.test(t)) && !tokens.some(t => /wrap$/.test(t));
    if (!isPanel) continue;
    // walk to this div's matching close
    let depth = 0, i = m.index, end = -1;
    const tags = /<div\b[^>]*>|<\/div>/g;
    tags.lastIndex = m.index;
    let t;
    while ((t = tags.exec(html))) {
      depth += t[0].startsWith('</') ? -1 : 1;
      if (depth === 0) { end = t.index + t[0].length; break; }
    }
    if (end < 0) continue;
    html = html.slice(0, i) + html.slice(end);
    re.lastIndex = i;
  }
  return html;
}

/* What KIND of control a button is. ⚠️ Read off the id and the classes, never off the label — a
   label is prose and changes; `id="cc-export"` is what the module's own JS binds to. */
function kindOf(button) {
  if (/pd-btn-primary/.test(button)) return 'primary';
  if (/filttoggle|filterbtn|-tb-filter|projfilter/.test(button)) return 'filter';
  if (/refresh/.test(button)) return 'refresh';
  if (/id="[a-z0-9-]*export|icondd-btn|id="[a-z]+-filebtn/.test(button)) return 'export';
  if (/pd-seg|data-lay=|data-shv=/.test(button)) return 'view';
  return 'tool';
}

/* ⚠️⚠️ THE CLUSTER IS FOUND BY DIV DEPTH, NOT BY A LAZY REGEX — and the lazy one was wrong.
   `([\s\S]*?)\n\s*</div>\s*\n\s*<div id=` looks like it stops at the cluster's own close, and in
   most modules it does. In Progress Photos it ran straight past it and swallowed the CONTENT
   filter bar and list bar as well: 27 buttons captured where the bar has 20, the extra seven being
   `pp-filttoggle`, `pp-clearfilters`, the tile/list/plan toggles and two more. The module was
   reported out of order on buttons that are not in its toolbar at all.
   ⚠️ Counting `<div>` against `</div>` from the opening tag is the only thing that finds the real
   end, because the cluster nests wrappers and menus several deep. */
function clusterOf(html) {
  const open = /<div class="[a-z]{2,3}-topbar-tools"[^>]*>/.exec(html);
  if (!open) return null;
  const from = open.index + open[0].length;
  const tags = /<div\b[^>]*>|<\/div>/g;
  tags.lastIndex = from;
  let depth = 1, t;
  while ((t = tags.exec(html))) {
    depth += t[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(from, t.index);
  }
  return null;
}

function sequenceOf(html) {
  const raw = clusterOf(html);
  if (raw === null) return null;
  const blk = stripMenuPanels(raw);
  const seq = [];
  const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
  let b;
  while ((b = re.exec(blk))) {
    /* \u26a0\u26a0 HIDDEN-BY-DEFAULT IS RECORDED, and it is what makes a multi-TAB bar checkable.
       Progress Photos keeps four tabs' controls in ONE cluster and shows one tab's at a time
       (`style="display:none"` / `hidden`), so its markup order is four canonical runs laid end to
       end, not one. Read as a single sequence it looks wildly out of order and is not. */
    seq.push({ kind: kindOf(b[1] + b[2]), hidden: /\bhidden\b|display:\s*none/.test(b[1]) });
  }
  const out = [];
  for (let i = 0; i < seq.length; i++) {
    if (i && seq[i].kind === seq[i - 1].kind) continue;         // collapse runs
    out.push(seq[i]);
  }
  return out;
}

/* ⚠️ A RANK MAY DROP ONLY WHERE A NEW TAB'S CONTROLS BEGIN — i.e. on a button that is hidden by
   default. Anywhere else a drop is the real defect this checker exists to catch: two buttons a
   planner can see at once, in the wrong order. */
function inOrder(seq) {
  for (let i = 0; i < seq.length - 1; i++) {
    if (RANK[seq[i].kind] <= RANK[seq[i + 1].kind]) continue;
    if (seq[i + 1].hidden) continue;        // a different tab's run starts here
    return false;
  }
  return true;
}
function render(seq) {
  return seq.map(s => s.kind + (s.hidden ? '*' : '')).join(' > ');
}

/* ---------------------------------------------------------------- self-test */
let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) { if (cond) pass++; else { fail++; fails.push(label); } }

const TRIGGER_IN_WRAP =
  '<div class="xx-topbar-tools">' +
  '<button class="pd-filttoggle" id="x-filt"></button>' +
  '<div class="pp-addmenu-wrap"><button class="pd-btn pd-btn-primary" id="x-add">+ Add</button>' +
  '<div class="pp-addmenu"><button data-addtype="photo">Photo</button></div></div>' +
  '<button class="pd-btn" id="x-refresh"></button>' +
  '\n  </div>\n  <div id="x-presence">';
ok(JSON.stringify(sequenceOf(TRIGGER_IN_WRAP).map(x => x.kind)) === JSON.stringify(['filter', 'primary', 'refresh']),
   'self-test: a trigger inside a *-wrap is a toolbar button, its menu panel is not');

const BAD = '<div class="xx-topbar-tools">' +
  '<button class="pd-btn" id="x-refresh"></button>' +
  '<button class="pd-filttoggle" id="x-filt"></button>' +
  '\n  </div>\n  <div id="x-presence">';
ok(!inOrder(sequenceOf(BAD)), 'self-test: refresh before the filter IS caught');

const GOOD = '<div class="xx-topbar-tools">' +
  '<button class="pd-filttoggle" id="x-filt"></button>' +
  '<button class="pd-btn pd-btn-primary" id="x-add">+ Add</button>' +
  '<button class="pd-btn" id="x-export"></button>' +
  '<button class="pd-btn" id="x-refresh"></button>' +
  '\n  </div>\n  <div id="x-presence">';
ok(inOrder(sequenceOf(GOOD)), 'self-test: the canonical order passes');

/* Two tabs' runs end to end: the second run's first button is hidden by default, so the rank drop
   between them is a tab boundary and not a defect. */
const TWO_TABS = '<div class="xx-topbar-tools">' +
  '<button class="pd-filttoggle" id="x-filt"></button>' +
  '<button class="pd-btn" id="x-refresh"></button>' +
  '<button class="pd-filttoggle" id="y-filt" style="display:none;"></button>' +
  '<button class="pd-btn pd-btn-primary" id="y-add" style="display:none;">+ Add</button>' +
  '\n  </div>\n  <div id="x-presence">';
ok(inOrder(sequenceOf(TWO_TABS)), 'self-test: a second tab\'s run may restart the order');

/* ...but the SAME drop between two buttons a planner can see at once is still caught. */
const VISIBLE_DROP = '<div class="xx-topbar-tools">' +
  '<button class="pd-filttoggle" id="x-filt"></button>' +
  '<button class="pd-btn" id="x-refresh"></button>' +
  '<button class="pd-btn pd-btn-primary" id="x-add">+ Add</button>' +
  '\n  </div>\n  <div id="x-presence">';
ok(!inOrder(sequenceOf(VISIBLE_DROP)), 'self-test: the same drop between VISIBLE buttons is still a defect');

if (fail) {
  console.log('SELF-TEST FAILED — not checking the modules:\n  ' + fails.join('\n  '));
  process.exit(1);
}
console.log('self-test: ' + pass + '/' + pass + ' ✓\n');

/* ---------------------------------------------------------------- the modules */
const dirs = fs.readdirSync(path.join(ROOT, 'modules'))
  .filter(d => fs.existsSync(path.join(ROOT, 'modules', d, 'index.html')));
let bad = 0, seen = 0;
for (const d of dirs) {
  const html = fs.readFileSync(path.join(ROOT, 'modules', d, 'index.html'), 'utf8');
  const seq = sequenceOf(html);
  if (!seq) continue;              // no tool cluster on this page
  seen++;
  const good = inOrder(seq);
  if (!good) bad++;
  console.log('  ' + (good ? 'ok  ' : 'BAD ') + d.padEnd(20) + render(seq));
}
console.log('\ntoolbar-order: ' + seen + ' module bar(s), ' + bad + ' out of order');

/* ==== THE EXPORT CONTROL, ONE IDIOM ==========================================================
   Owner 2026-09-16: *"I've noticed across multiple modules there are different UI's for export.
   Let's make this consistent."* There were four: a bespoke dropdown in Issues & Concerns, a
   generic one in Minutes of Meeting, a plain button in seven modules, and a File menu in Project
   Schedule.
   ⚠️ CONSISTENT DOES NOT MEAN "EVERYTHING GETS A MENU". A module with one export format keeps a
   plain button — a one-entry dropdown is a control that cannot do anything. What has to match is
   the TRIGGER: the same download icon, the same 34px square, the same slot in the bar. Where there
   IS a choice, it opens the SHARED `UI.iconMenuHTML` dropdown rather than a private one.
   ⚠️⚠️ SO THE CHECK IS FOR A PRIVATE COPY, not for a menu. A module that grows its own
   `.x-export-menu` is the drift this pass removed, and it is invisible in a diff of that module. */
let exBad = 0;
const PRIVATE_MENU = /\.[a-z]{2,3}-(?:export-menu|exportwrap|icondd)\b/;
for (const d of dirs) {
  for (const f of ['index.html', 'module.css']) {
    const fp = path.join(ROOT, 'modules', d, f);
    if (!fs.existsSync(fp)) continue;
    const src = fs.readFileSync(fp, 'utf8');
    /* Strip comments first — this pass left notes in several modules explaining what was
       removed, and a note naming the old class is not a private copy of it. */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
    const m = PRIVATE_MENU.exec(code);
    if (m) { exBad++; console.log('  BAD ' + d.padEnd(20) + 'private export menu: ' + m[0] + ' (' + f + ')'); }
  }
}
/* And the shared control must still be exported by ui.js, or the two modules that use it break. */
const uiSrc = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'ui.js'), 'utf8');
['iconMenuHTML', 'wireIconMenu', 'closeIconMenus'].forEach(function (fn) {
  if (uiSrc.indexOf(fn + ': ' + fn) < 0) { exBad++; console.log('  BAD ui.js does not export ' + fn); }
});
console.log('export-ui:     ' + exBad + ' private export control(s)');
if (bad || exBad) process.exit(1);
