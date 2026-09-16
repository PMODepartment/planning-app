#!/usr/bin/env node
/* node tools/portfolio-provenance.js
   ---------------------------------------------------------------------------
   The shared portfolio-provenance layer (UI.projectCode / projectName /
   projectLabel / projectTagHTML / groupByProject / projectGroupRowHTML), proved
   by EXECUTING the shipped `assets/js/ui.js` rather than by reading it.

   Owner, 2026-09-15: "for consolidated data in portfolio, if in list group by
   project" and "for consolidated data not in list, add a marker project code to
   identify." Four modules consolidate (Meetings, Issues & Concerns, Contracts &
   Claims, Progress Photos) and all four call these helpers, so a defect here is
   a defect on four screens at once.

   ⚠️⚠️ THE PROPERTIES THAT ACTUALLY MATTER ARE THE TWO THAT LOSE DATA:
     · a row carrying no project_id must NOT be dropped, and
     · row order INSIDE a group must be exactly the caller's,
   because both failures look like a working screen. A dropped row is simply
   absent, and a re-sorted group reads as a list that ignored the sort you just
   asked for. Each is asserted, and each has a negative build below that bites.

   ⚠️ The suite ends with three CONTRAST builds — one per load-bearing rule —
   each reverting exactly one decision in the real file, in memory. A checker
   that has never failed proves nothing.                                      */
'use strict';
const fs = require('fs');

const scan = require('./scan.js');
scan.selfTest();   // ⚠️ the scanner proves itself before this file trusts it

const SRC = fs.readFileSync('assets/js/ui.js', 'utf8');
/* ⚠️ Section 5 counts a PHRASE, and the comment that explains the change quotes
   that same phrase — the first run reported 3 where there are 2, i.e. it was
   measuring its own explanation. Comments are stripped through the shared,
   self-tested scanner (tools/scan.js), which is the exact correction
   `cellcount.py` and the (w) BOQ suite each had to make before their counts
   meant anything. */
const CODE = scan.blankComments(SRC);

/* The three projects every case below is built from. ⚠️ Deliberately NOT in
   alphabetical order, and the codes deliberately do not sort the same way as
   the names — otherwise "ordered by code" could pass by accident. */
const PROJECTS = [
  { id: 'ZED101', name: 'Alpha Tower' },
  { id: 'AVR101', name: 'Zulu Riverfront' },
  { id: 'OPW101', name: 'One Portwood' },
];

/* ⚠️ Lifted from tools/wiring-check.js's own runner rather than re-typed: a
   browser exposes these as BARE globals and `new Function` resolves a bare name
   against the real global scope, not the `window` passed in. */
function makeWindow() {
  const noop = function () {};
  const chain = () => new Proxy(noop, { get: () => chain(), apply: () => chain() });
  const win = {
    document: new Proxy({}, { get(t, k) {
      if (k === 'readyState') return 'complete';
      if (k === 'currentScript') return { src: 'x.js?v=test' };
      return chain();
    } }),
    navigator: { userAgent: 'node', onLine: true },
    location: { href: 'https://x/y.html', pathname: '/y.html', search: '', hash: '', origin: 'https://x' },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    addEventListener: noop, removeEventListener: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    setTimeout: (f) => { try { f(); } catch (e) {} }, clearTimeout: noop,
    setInterval: noop, clearInterval: noop, requestAnimationFrame: noop,
    fetch: () => Promise.resolve({ ok: true }),
    console, Math, Date, JSON, Intl, URL, URLSearchParams, Promise, Proxy, Reflect,
    supabase: { createClient: () => chain() },
    // The one real dependency: the helpers read the project-selector's own warm
    // cache, which `allProjectIds()` fills from here.
    PDb: { getProjects: async () => PROJECTS.slice(), getGroupHeads: async () => [] },
    Icons: { hydrate: noop, svg: () => '' },
  };
  win.window = win; win.self = win; win.globalThis = win;
  return win;
}
function runScript(src, win) {
  return new Function(
    'window', 'self', 'globalThis', 'document', 'console', 'localStorage', 'sessionStorage',
    'navigator', 'location', 'matchMedia', 'addEventListener', 'fetch', 'setTimeout',
    'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'alert', 'confirm',
    'prompt', 'PDb', 'Icons', src)(
      win, win, win, win.document, console, win.localStorage, win.sessionStorage, win.navigator,
      win.location, win.matchMedia, win.addEventListener, win.fetch, win.setTimeout,
      win.clearTimeout, win.setInterval, win.clearInterval, win.requestAnimationFrame,
      function () {}, () => true, () => null, win.PDb, win.Icons);
}
async function loadUI(src) {
  const win = makeWindow();
  runScript(src, win);
  if (!win.UI) throw new Error('ui.js did not assign window.UI');
  // Warms `_pdProjCache`, exactly as every consolidating module's load() does
  // before it renders. ⚠️ Without this the NAME half is legitimately unknown —
  // which is its own asserted case further down, not an accident.
  await win.UI.allProjectIds();
  return win.UI;
}

let pass = 0; const fails = [];
function ok(name, cond, got) {
  if (cond) { pass++; return; }
  fails.push(name + (got === undefined ? '' : '  (got: ' + JSON.stringify(got) + ')'));
}

(async function main() {
  const UI = await loadUI(SRC);

  /* ---- 1 · the label rule ------------------------------------------------ */
  ok('code is the id verbatim', UI.projectCode('AVR101') === 'AVR101', UI.projectCode('AVR101'));
  ok('code of nothing is empty, never "undefined"', UI.projectCode(null) === '', UI.projectCode(null));
  ok('name resolves from the warm cache', UI.projectName('AVR101') === 'Zulu Riverfront', UI.projectName('AVR101'));
  ok('label is CODE — Name', UI.projectLabel('AVR101') === 'AVR101 — Zulu Riverfront', UI.projectLabel('AVR101'));
  // ⚠️ The degrade that keeps a first paint honest: a project the cache has
  // never heard of is named by its code, not by a blank and not by "undefined".
  ok('unknown project degrades to the bare code', UI.projectLabel('XXX999') === 'XXX999', UI.projectLabel('XXX999'));
  ok('unknown project has no name', UI.projectName('XXX999') === '', UI.projectName('XXX999'));

  /* ---- 2 · the marker chip ---------------------------------------------- */
  const tag = UI.projectTagHTML('AVR101');
  ok('tag carries the shared class', /class="pd-projtag"/.test(tag), tag);
  ok('tag shows the CODE only', />AVR101</.test(tag), tag);
  ok('tag does NOT show the name inline', tag.indexOf('>AVR101 — ') < 0, tag);
  ok('tag keeps the full label in its title', /title="AVR101 — Zulu Riverfront"/.test(tag), tag);
  ok('tag of nothing renders nothing at all', UI.projectTagHTML(null) === '', UI.projectTagHTML(null));
  ok('tag takes a caller class', /class="pd-projtag il-mom-projtag"/.test(UI.projectTagHTML('AVR101', { cls: 'il-mom-projtag' })));
  // ⚠️ A project name is user data and reaches the DOM through a title="…"
  // attribute — an unescaped quote there is an attribute injection.
  const evil = await (async () => {
    const win = makeWindow();
    win.PDb.getProjects = async () => [{ id: 'X"1', name: 'a"<b>&' }];
    runScript(SRC, win); await win.UI.allProjectIds();
    return win.UI.projectTagHTML('X"1');
  })();
  ok('tag escapes a quote in the code', evil.indexOf('>X"1<') < 0, evil);
  ok('tag escapes markup in the name', evil.indexOf('<b>') < 0, evil);

  /* ---- 3 · grouping ------------------------------------------------------ */
  const rows = [
    { id: 'r1', project_id: 'OPW101' },
    { id: 'r2', project_id: 'AVR101' },
    { id: 'r3', project_id: 'OPW101' },
    { id: 'r4', project_id: null },            // ⚠️ must survive
    { id: 'r5', project_id: 'ZED101' },
    { id: 'r6', project_id: 'AVR101' },
  ];
  const g = UI.groupByProject(rows);
  ok('one group per distinct project, plus the no-project bucket', g.length === 4, g.length);
  ok('groups are ordered by CODE, not by name or first-seen',
    g.map(x => x.id).join(',') === 'AVR101,OPW101,ZED101,', g.map(x => x.id).join(','));
  // ⚠️ THE LOSS CASE. A row with no project must be visible somewhere.
  ok('the no-project bucket is LAST', g[3].id === '', g[3].id);
  ok('the no-project bucket is named, not blank', g[3].label === 'No project recorded', g[3].label);
  ok('no row is dropped', g.reduce((n, x) => n + x.rows.length, 0) === rows.length);
  ok('every original row is present exactly once',
    rows.every(r => g.filter(x => x.rows.indexOf(r) >= 0).length === 1));
  // ⚠️ THE OTHER LOSS CASE. `rows` arrives already sorted by the caller; this
  // regroups and must never re-sort, or a list sorted by date silently stops
  // being sorted by date inside each project.
  ok('caller order is preserved inside a group',
    g[1].rows.map(r => r.id).join(',') === 'r1,r3', g[1].rows.map(r => r.id).join(','));
  ok('caller order is preserved inside the second group',
    g[0].rows.map(r => r.id).join(',') === 'r2,r6', g[0].rows.map(r => r.id).join(','));
  ok('a group carries its label', g[0].label === 'AVR101 — Zulu Riverfront', g[0].label);
  ok('an empty list groups into nothing', UI.groupByProject([]).length === 0);
  ok('a null list does not throw', UI.groupByProject(null).length === 0);
  // A caller whose rows keep the id somewhere else (a derived row, not a table row)
  const custom = UI.groupByProject([{ pid: 'AVR101' }, { pid: 'OPW101' }], r => r.pid);
  ok('a custom id accessor is honoured', custom.map(x => x.id).join(',') === 'AVR101,OPW101');

  /* ---- 4 · the group header row ----------------------------------------- */
  const hdr = UI.projectGroupRowHTML(g[0], 7);
  ok('header is a real <tr> the table can hold', /^<tr class="pd-projgrouprow">/.test(hdr), hdr);
  // ⚠️ A <tr> narrower than its table draws a visible notch down every group.
  ok('header spans the caller\'s own column count', /colspan="7"/.test(hdr), hdr);
  // ⚠️ The colspan attribute being present is NOT enough — a `display:flex`
  // <td> carries it and the browser ignores it. The cell must stay a plain
  // table cell with the flex row nested inside, which is what this pins.
  ok('the colspan sits on a plain table cell', /<td class="pd-projgroupcell" colspan=/.test(hdr), hdr);
  ok('the flex row is a nested div, not the cell', /<div class="pd-projgroup">/.test(hdr), hdr);
  ok('header shows the code', /pd-projgroup-code">AVR101</.test(hdr), hdr);
  ok('header shows the name beside it', /pd-projgroup-name">Zulu Riverfront</.test(hdr), hdr);
  ok('header counts its rows', /pd-projgroup-n">2</.test(hdr), hdr);
  const nohdr = UI.projectGroupRowHTML(g[3], 5);
  ok('the no-project header names itself', /pd-projgroup-code">No project recorded</.test(nohdr), nohdr);
  ok('the no-project header prints no name span', nohdr.indexOf('pd-projgroup-name') < 0, nohdr);

  /* ---- 5 · item 1 — the shell switcher's Portfolio state ----------------- */
  // ⚠️ Asserted on the SOURCE the browser runs, not on a description of it:
  // renderSwitcher needs a real DOM to execute, which this harness has no
  // business faking. What it can prove is that the phrase the module-page
  // selector uses is now the phrase this one uses too.
  // ⚠️⚠️ THREE, NOT TWO — a follow-up (owner, 2026-09-16: "always use this type
  // of dropdown when portfolio is selected") found a THIRD surface this count
  // did not know about: navListBody's own clickable Portfolio row inside the
  // shared dropdown list (opened from either selector), which carried no
  // subtitle at all until then. Left at 2 here would have made a real third
  // fix look like a regression the next time this ran.
  const selPhrase = (CODE.match(/every project you can see/g) || []).length;
  ok('the Portfolio subtitle exists in all THREE selector surfaces', selPhrase === 3, selPhrase);
  // ⚠️ The exact code SHAPE changed too, without changing the behaviour it
  // proves: renderSwitcher now computes `subLabel` once (reused by both the
  // portfolio and the non-portfolio branch) rather than inlining the ternary
  // at the point of use. Matched on the assignment rather than the old
  // inline `'<small>...'` construction, or this would fail on a refactor that
  // changed nothing this test is actually meant to guard.
  ok('the switcher gates it on portfolio mode',
     /var subLabel = mode === 'portfolio' \? 'every project you can see' : opts\.ghLabel;/.test(CODE));

  /* ---- 6 · CONTRAST — each rule reverted, in memory ---------------------- */
  const NEG = [
    ['the no-project bucket sorts FIRST (rows vanish under an unlabelled head)',
      s => s.replace("      if (!a !== !b) return a ? -1 : 1;                 // the no-project bucket last",
                     "      if (!a !== !b) return a ? 1 : -1;")],
    ['rows are re-sorted inside a group',
      s => s.replace("      map[id].push(r);",
                     "      map[id].push(r); map[id].sort(function (x, y) { return String(y.id).localeCompare(String(x.id)); });")],
    ['the header stops spanning the table',
      s => s.replace("colspan=\"' + (colspan || 1) + '\"", "colspan=\"1\"")],
  ];
  let bites = 0;
  for (const [what, mutate] of NEG) {
    const broken = mutate(SRC);
    if (broken === SRC) { fails.push('CONTRAST could not be built: ' + what); continue; }
    const U2 = await loadUI(broken);
    const g2 = U2.groupByProject(rows);
    const h2 = U2.projectGroupRowHTML(g2[0], 7);
    const stillGood =
      g2[g2.length - 1].id === '' &&
      g2.filter(x => x.id === 'OPW101')[0].rows.map(r => r.id).join(',') === 'r1,r3' &&
      /colspan="7"/.test(h2);
    if (stillGood) fails.push('CONTRAST DID NOT BITE: ' + what);
    else bites++;
  }
  ok('all three contrast builds bite', bites === NEG.length, bites);

  console.log('');
  console.log('  ' + pass + ' passed, ' + fails.length + ' failed   (' + bites + '/' + NEG.length + ' contrast builds bite)');
  if (fails.length) { fails.forEach(f => console.log('    FAIL  ' + f)); process.exit(1); }
})().catch(e => { console.error(e); process.exit(2); });
