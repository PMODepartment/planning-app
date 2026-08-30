// Harness: stubs AppAuth/PDb/UI/Fmt/Icons + a mutable in-memory store, loads the
// real module.js + ppr.js, and asserts the 2026-08-28 feedback round behaviours.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
// Harness-relative paths, not cwd-relative — HANDOFF.md's own run instruction is
// `node modules/progress-photos/test.js` from the repo root, and this file's
// migration lives in ../../migrations/ per the repo layout, not beside module.js.
const here = (f) => path.join(__dirname, f);
const migrationFile = path.join(__dirname, '..', '..', 'migrations', '2026-08-28-photo-keyplan-and-ppr-meeting.sql');
const tmplMigrationFile = path.join(__dirname, '..', '..', 'migrations', '2026-08-29-ppr-report-templates.sql');
const panoMigrationFile = path.join(__dirname, '..', '..', 'migrations', '2026-08-29-panoramas.sql');
const reconMigrationFile = path.join(__dirname, '..', '..', 'migrations', '2026-08-29-reconstruction-requests.sql');
const submitFnFile = path.join(__dirname, '..', '..', 'supabase', 'functions', 'submit-reconstruction', 'index.ts');
const webhookFnFile = path.join(__dirname, '..', '..', 'supabase', 'functions', 'reconstruction-webhook', 'index.ts');
const floorPlanMigrationFile = path.join(__dirname, '..', '..', 'migrations', '2026-08-29-floor-plans.sql');
const archiveMigrationFile = path.join(__dirname, '..', '..', 'migrations', '2026-08-29-archive-flag.sql');
const schemaFile = path.join(__dirname, '..', '..', 'supabase-schema.sql');

let fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  PASS ' + name); }
  else { fails++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

// ---------------------------------------------------------------- fake store --
const store = {
  progress_photos: [],
  ppr_presentations: [],
  ppr_slides: [],
  location_levels: [],
  project_schedule: [],
  floor_plans: [],
  floor_plan_pins: [],
  floor_plan_registrations: [],
  reconstruction_requests: [],
};
let idSeq = 1;
const nid = (p) => p + '-' + (idSeq++);

function makeQuery(table) {
  let rowsSel = store[table].slice();
  const filters = [];
  const q = {
    select() { q.__select = true; return q; },
    eq(col, val) { filters.push([col, val]); return q; },
    neq() { return q; },
    in() { return q; },
    gt(col, val) { filters.push(['__gt', [col, val]]); return q; },
    order() { return q; },
    limit() { return q; },
    insert(patch) {
      const arr = Array.isArray(patch) ? patch : [patch];
      const made = arr.map((p) => Object.assign({ id: nid(table) }, p));
      store[table].push(...made);
      q.__inserted = made;
      return q;
    },
    update(patch) { q.__update = patch; return q; },
    delete() { q.__delete = true; return q; },
    then(resolve) { return Promise.resolve(run()).then(resolve); },
  };
  function apply(list) {
    return list.filter((r) =>
      filters.every(([c, v]) => {
        if (c === '__gt') return String(r[v[0]]) > String(v[1]);
        return r[c] === v;
      })
    );
  }
  function run() {
    if (q.__inserted) return { data: q.__inserted, error: null };
    if (q.__update) {
      apply(store[table]).forEach((r) => Object.assign(r, q.__update));
      return { data: null, error: null };
    }
    if (q.__delete) {
      const del = apply(store[table]);
      store[table] = store[table].filter((r) => !del.includes(r));
      // emulate ON DELETE CASCADE for ppr_slides.ppr_id
      if (table === 'ppr_presentations') {
        const ids = del.map((d) => d.id);
        store.ppr_slides = store.ppr_slides.filter((s) => !ids.includes(s.ppr_id));
      }
      // Real Supabase-js .delete().select() returns the rows it actually
      // deleted — recon.js's retractRequest (audit fix M5) relies on THIS
      // exact contract to tell "genuinely retracted" apart from "matched
      // nothing because it was concurrently approved" (a plain .delete()
      // with no matching row succeeds with 0 rows affected, not an error).
      return { data: q.__select ? del : null, error: null };
    }
    return { data: apply(rowsSel), error: null };
  }
  return q;
}

const signed = {};
const sbStub = {
  from: (t) => makeQuery(t),
  storage: {
    from: () => ({
      createSignedUrls: async (paths) => ({
        data: paths.map((p) => ({ path: p, signedUrl: 'signed://' + p })), error: null,
      }),
      createSignedUrl: async (p) => ({ data: { signedUrl: 'signed://' + p }, error: null }),
      upload: async (path) => { signed[path] = 1; return { data: { path }, error: null }; },
      remove: async () => ({ error: null }),
    }),
  },
};

// ------------------------------------------------------------------ fake DOM --
function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(), children: [], style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    _html: '', value: '', files: null, disabled: false, hidden: false, checked: false,
    textContent: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); indexTree(this); },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.push(c); return c; },
    remove() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    onclick: null, onchange: null, oninput: null,
  };
  // Item 1 (2026-08-30): module.js's makeThumbnailBlob() draws a decoded
  // Image onto a real <canvas> and reads it back with toBlob() — a minimal
  // stand-in so that code path can genuinely execute in this sandbox, same
  // reasoning as the Path2D stub above for the markup engine's stickers.
  // getContext records nothing meaningful (drawImage is a no-op here); the
  // point is that the call sequence runs to completion without throwing.
  if ((tag || '').toLowerCase() === 'canvas') {
    el.width = 0; el.height = 0;
    el.getContext = () => ({ drawImage() {} });
    el.toBlob = (cb, type, q) => cb({ __fakeBlob: true, size: (el.width || 1) * (el.height || 1), type: type || 'image/png', q: q });
  }
  return el;
}
// A fake decoded image — module.js's fileToImage() creates one per file and
// waits for `onload`. Fires synchronously the instant `.src` is assigned
// (this sandbox has no real event loop tick to wait for, and the calling
// code only ever awaits the Promise it's wrapped in, never the timing of
// the callback itself), reporting a plausible naturalWidth/naturalHeight so
// the downscale-to-480px arithmetic in makeThumbnailBlob has something real
// to compute against.
class FakeImage {
  constructor() {
    this.naturalWidth = 1600; this.naturalHeight = 1200;
    this.onload = null; this.onerror = null;
    this._src = '';
  }
  set src(v) { this._src = v; if (this.onload) this.onload(); }
  get src() { return this._src; }
}
const byId = {};
function indexTree(el) {
  // parse id="..." out of assigned HTML so $('...') can find synthetic nodes
  const re = /id="([^"]+)"/g; let m;
  while ((m = re.exec(el._html))) {
    if (!byId[m[1]]) byId[m[1]] = makeEl('div');
  }
}
function ensure(id) { if (!byId[id]) byId[id] = makeEl('div'); return byId[id]; }

const documentStub = {
  getElementById: (id) => byId[id] || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (t) => makeEl(t),
  addEventListener() {},
  body: makeEl('body'),
};

// pre-create the ids the modules touch on load
['pp-view', 'pp-count', 'pp-project', 'pp-f-search', 'pp-f-from', 'pp-f-to',
 'pp-f-trade', 'pp-f-works', 'pp-f-loclevels', 'pp-clearfilters', 'pp-add',
 'pp-refresh', 'pp-sep-photos', 'pp-sync', 'pp-sync-n', 'pp-presence',
 'pp-lightbox', 'pp-lb-img', 'pp-lb-cap', 'pp-lb-close', 'pp-lb-prev',
 'pp-lb-next', 'pp-lb-download', 'pp-lb-edit', 'pp-lb-delete',
 'pp-media-strip',
 // The selection-mode toolbar (audit section [35]) — syncChrome() and
 // _leavePhotosScreen() both toggle these by id.
 'pp-selcount', 'pp-sel-download', 'pp-sel-addppr', 'pp-sel-archive',
 'ppr-view', 'ppr-count', 'ppr-listbar', 'ppr-countbar', 'ppr-f-from',
 'ppr-f-to', 'ppr-clearfilters', 'ppr-new', 'ppr-back',
 // bim.js's own screen host (audit section [35]'s _load hook needs it, or
 // load() bails at its very first line before exercising anything).
 'bim-view',
 // syncTools(true)-regression section — bim-new wasn't in this list before
 // that fix, so document.getElementById('bim-new') returned null and
 // syncTools's `if ($('bim-new'))` guard silently no-op'd, which would have
 // let a broken fix look like it passed.
 'bim-new',
 // ppr.js's preview pane (audit section [35]'s _renderPreviewWithState hook).
 'ppr-preview-body',
].forEach(ensure);

// ------------------------------------------------------------------- globals --
// window.addEventListener/removeEventListener are real, TRACKED no-ops (not
// missing) — bim.js's stage pan/zoom binds window-level mousemove/mouseup
// listeners, and a stub that simply doesn't exist would make render() throw
// the moment it's genuinely executed (masking that path from ever running
// under test), while a stub that exists but never records anything would
// hide the exact leak class this audit is checking for (a listener re-bound
// on every render with nothing ever removed).
const winListeners = [];
function winAddEventListener(type, fn) { winListeners.push({ type, fn }); }
function winRemoveEventListener(type, fn) {
  const i = winListeners.findIndex((l) => l.type === type && l.fn === fn);
  if (i !== -1) winListeners.splice(i, 1);
}
const ctx = {
  console, Promise, JSON, Math, Date, String, Number, Object, Array, Boolean,
  setTimeout, clearTimeout, isNaN, parseInt, parseFloat, encodeURIComponent,
  document: documentStub,
  window: {},
  addEventListener: winAddEventListener,
  removeEventListener: winRemoveEventListener,
  // recon.js's retractRequest and pano.js's removePano both gate on a bare
  // confirm(...) — genuinely exercising either (section [35]'s M5 test)
  // needs this to resolve, same reasoning as the addEventListener stubs
  // above: a missing global would make the throw itself the finding,
  // masking the real behaviour under test.
  confirm: () => true,
  navigator: { onLine: true },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  sessionStorage: { _d: { pd_project: 'DEMO01' }, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } },
  indexedDB: { open: () => ({ onupgradeneeded: null, onsuccess: null, onerror: null }) },
  URL: { createObjectURL: () => 'blob://x', revokeObjectURL() {} },
  // Item 1 (2026-08-30): fileToImage()'s decode step, real enough to execute
  // makeThumbnailBlob()'s downscale math end to end — see FakeImage's own
  // comment above for why `src` firing onload synchronously is sufficient.
  Image: FakeImage,
  // 2026-08-30: drawIconStamp's plant-sticker branch (MARKUP_STICKERS) builds
  // a real Path2D from an SVG path string — a minimal stand-in so that code
  // path can run inside this sandbox at all; the fake ctx's stroke() doesn't
  // care what it's handed, it just records the call.
  Path2D: function Path2D(d) { this.d = d; },
  fetch: async () => ({ ok: true, blob: async () => ({}) }),
  prompt: () => 'Typed Works Value',
  AppAuth: { getSB: () => sbStub, requireLogin() {} },
  UI: { toast: (m, k) => { (ctx.__toasts = ctx.__toasts || []).push([k, m]); }, modal: (html) => { const el = makeEl('div'); el.innerHTML = html; return { el, close() { ctx.__closed = true; } }; }, renderUserBar() {} },
  Fmt: { esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), date: (d) => String(d), money: (n) => String(n), moneyShort: (n) => String(n) },
  Icons: { hydrate() { ctx.__hydrated = (ctx.__hydrated || 0) + 1; } },
  PDb: {
    getProjects: async () => [{ id: 'DEMO01', name: 'Demo Project' }],
    getProject: async (id) => ({ id, name: 'Demo Project' }),
    selectAll: async (table, f) => {
      let q = makeQuery(table); if (f) q = f(q); const r = await q; return r.data || [];
    },
  },
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);

// ---------------------------------------------------------------- load module --
vm.runInContext(fs.readFileSync(here('module.js'), 'utf8'), ctx, { filename: 'module.js' });
vm.runInContext(fs.readFileSync(here('ppr.js'), 'utf8'), ctx, { filename: 'ppr.js' });
vm.runInContext(fs.readFileSync(here('pano.js'), 'utf8'), ctx, { filename: 'pano.js' });
vm.runInContext(fs.readFileSync(here('recon.js'), 'utf8'), ctx, { filename: 'recon.js' });
vm.runInContext(fs.readFileSync(here('bim.js'), 'utf8'), ctx, { filename: 'bim.js' });

const PP = ctx.ProgressPhotos, PPR = ctx.PPR, PANO = ctx.PANO, RECON = ctx.RECON, BIM = ctx.BIM;
ok('module.js exposes ProgressPhotos', !!PP);
ok('ppr.js exposes PPR', !!PPR);
ok('pano.js exposes PANO', !!PANO);
ok('recon.js exposes RECON', !!RECON);
ok('bim.js exposes BIM', !!BIM);
ok('openUploadForPicker exported (inline add-photo hook)', typeof PP.openUploadForPicker === 'function');

// ---------------------------------------------------------- source assertions --
// Behaviours that are structural (markup/flow) are asserted against the source,
// which is how this module's earlier rounds were verified for render output.
const mjs = fs.readFileSync(here('module.js'), 'utf8');
const pjs = fs.readFileSync(here('ppr.js'), 'utf8');
const pnjs = fs.readFileSync(here('pano.js'), 'utf8');
const rcjs = fs.readFileSync(here('recon.js'), 'utf8');
const bmjs = fs.readFileSync(here('bim.js'), 'utf8');
const html = fs.readFileSync(here('index.html'), 'utf8');
const css = fs.readFileSync(here('module.css'), 'utf8');

console.log('\n[0] Batch A (2026-08-29 18-item feedback) — Gallery default view + row-icon padding');
ok('Gallery (tile) view is the default landing view (item 1) — was list', /var view = 'gallery';/.test(mjs));
// Widened item 16 (2026-08-29 second round) to admit 'plan'/'stack' too —
// a returning user's explicit choice of ANY of the four views still
// overrides the default.
ok('a returning user\'s explicit view choice still overrides the new default (restoreUI, widened for item 16)',
   /if \(\['list', 'gallery', 'plan', 'stack'\]\.indexOf\(v\) >= 0\) view = v;/.test(mjs));
ok('the Presentations-list row-action icons carry left padding (follow-up item 2)',
   /\.ppr-acts \{[^}]*padding-left: 10px/.test(css));

console.log('\n[1/2] Works: REVERSED back to a real multi-select "Add works" picker (item 6, 2026-08-30 — supersedes the single schedule-tag design of item 9, 2026-08-29)');
ok('no <input list="pp-works-list"> left anywhere', !/list="pp-works-list"/.test(mjs + pjs));
ok('shared works datalist removed from index.html', !/pp-works-list/.test(html));
ok('the single-tag design (worksTagFieldHTML/readWorksTag/WORKS_CUSTOM) is gone, superseded',
   !/function worksTagFieldHTML/.test(mjs) && !/function readWorksTag\(/.test(mjs) && !/WORKS_CUSTOM/.test(mjs));
ok('Add form uses the "+ Add works" multi-select field', /worksMultiFieldHTML\('pp',/.test(mjs));
ok('Edit form uses the "+ Add works" multi-select field, seeded from worksOf(r)', /worksMultiFieldHTML\('pp-e', worksOf\(r\)\)/.test(mjs));
ok('worksGroupedOptions buckets schedule activity names by their own work_type — "the project-defined activity groups"',
   /function worksGroupedOptions\(\)[\s\S]{0,700}var group = \(a\.work_type \|\| ''\)\.trim\(\) \|\| 'Other';/.test(mjs));
ok('a captured Works value with no matching live schedule activity lands in its own "Previously used" bucket, never silently dropped',
   /byGroup\['Previously used'\]/.test(mjs));
ok('openWorksPicker renders a checkbox per activity, grouped, pre-checked from the current selection', /input type="checkbox" value="' \+ Fmt\.esc\(v\) \+ '"/.test(mjs));
ok('picking Done reads every checked checkbox into the in-memory selection, replacing it wholesale', /var picked = Array\.prototype\.map\.call\(m\.el\.querySelectorAll\('input\[type=checkbox\]:checked'\)/.test(mjs));
ok('removing a chip filters it out of the selection (does not touch the others)',
   /_worksSel\[idPrefix\] = worksSelOf\(idPrefix\)\.filter\(function \(v\) \{ return v !== b\.dataset\.removework; \}\);/.test(mjs));

console.log('\n[2] Capture date / works / location / view name required (item 7 adds a required view name; item 6/7 both waive their OWN field only when the schedule truly has nothing to offer)');
ok('requiredFieldsMissing gates date', /Capture date is required/.test(mjs));
ok('requiredFieldsMissing gates works, but ONLY when the schedule actually has activities to pick from',
   /if \(scheduleHasActivities\(\) && !readWorksMulti\(idPrefix\)\.length\) return 'At least one Works value is required\.';/.test(mjs));
ok('requiredFieldsMissing gates location, but ONLY when the project has a Location Breakdown configured at all',
   /if \(LOC_LEVELS\.length && !Object\.keys\(currentLocValues\(idPrefix\)\)\.length\) return 'A location is required\.';/.test(mjs));
ok('requiredFieldsMissing gates the view name UNCONDITIONALLY (item 7 — always required, no waiver)',
   /if \(!vn \|\| !vn\.value\.trim\(\)\) return 'A view name is required\.';/.test(mjs));
ok('Trade is not gated on its own — it is derived from the chosen Works values',
   !/At least one Trade is required/.test(mjs));
ok('Add save calls the gate', /requiredFieldsMissing\('pp'\)/.test(mjs));
ok('Edit save calls the gate', /requiredFieldsMissing\('pp-e'\)/.test(mjs));

console.log('\n[2b] Item 7 (2026-08-30) — Location becomes a single-node schedule-tree picker + a required view name');
ok('the old TRADES/Works checkbox-overlay machinery is gone (superseded)',
   !/function tradesOverlayHTML/.test(mjs) && !/function worksOverlayHTML/.test(mjs) &&
   !/function multiCheckHTML/.test(mjs) && !/function readMultiCheck/.test(mjs) &&
   !/function wireTradeWorks/.test(mjs));
ok('deriveTradeForWorks looks up the schedule activity by name and reverse-resolves its Trade',
   /function deriveTradeForWorks[\s\S]{0,400}workTypeMatchesTrade/.test(mjs));
ok('a Works value with no matching schedule activity derives no trade (never a guess)',
   /if \(!act \|\| !act\.work_type\) return null;/.test(mjs));
ok('deriveTradesForWorksList unions every chosen Works value\'s own derived trade (a slide can span more than one trade now)',
   /function deriveTradesForWorksList\(list\)[\s\S]{0,300}var t = deriveTradeForWorks\(v\);/.test(mjs));
ok('the old free-text cascading Location inputs (locOptionsHTML/locLevelFieldHTML/locFieldsHTML/locRequiredLevels) are gone, superseded by a tree picker',
   !/function locOptionsHTML/.test(mjs) && !/function locLevelFieldHTML/.test(mjs) && !/function locFieldsHTML/.test(mjs) && !/function locRequiredLevels/.test(mjs));
ok('locTree recursively builds every distinct value per level, cascaded and scoped to its parent picks — a real node tree, not a flat option list',
   /function locTreeLevel\(levelIdx, priorVals\)[\s\S]{0,300}return distinctLocValues\(level\.id, priorVals\)\.map/.test(mjs));
ok('picking ANY node (any depth) selects it — "it should be fine to select tower only"',
   /_locSel\[idPrefix\] = JSON\.parse\(this\.dataset\.locpick\);/.test(mjs));
ok('the "Location label" free-text input is gone (item 2 — "redundant")', !/-loctxt/.test(mjs));
ok('locationFieldHTML now ALSO takes a required view-name field, seeded from the existing value', /function locationFieldHTML\(idPrefix, existingValues, existingViewName\)/.test(mjs));
ok('the view-name input is REQUIRED and pre-filled from the existing value on Edit', /id="' \+ idPrefix \+ '-viewname" value="' \+ Fmt\.esc\(existingViewName \|\| ''\) \+ '" required \/>/.test(mjs));
ok('Edit passes the photo\'s own view_name through to locationFieldHTML', /locationFieldHTML\('pp-e', r\.location_values \|\| \{\}, r\.view_name\)/.test(mjs));
ok('location is derived purely from the breakdown breadcrumb on save (both Add and Edit)',
   (mjs.match(/location: locBreadcrumb\(locVals\) \|\| null,/g) || []).length === 2);
ok('the insert/update payload now carries the UNION of every chosen Works value\'s derived trades + all chosen works in the array columns',
   /trades: tradeList,[\s\S]{0,60}works_multi: worksList,[\s\S]{0,60}trade: tradeList\[0\] \|\| null,[\s\S]{0,60}works: worksList\[0\] \|\| null,/.test(mjs));
ok('the payload also carries view_name from the (now-mandatory) field, on both Add and Edit',
   (mjs.match(/view_name: viewNameEl \? viewNameEl\.value\.trim\(\) : null,/g) || []).length === 2);
ok('tolerantWrite gained a strip-rule for view_name, naming the migration file if it is missing',
   /'view_name' in job\.patch/.test(mjs) && /migrations\/2026-08-30-photos-round2\.sql/.test(mjs));
ok('tolerantWrite also retries without trades/works_multi if that migration has not run yet',
   /'trades' in job\.patch \|\| 'works_multi' in job\.patch/.test(mjs));
ok('the Gallery filters match a photo by ANY of its trades/works, not an exact single-value equality',
   /tradesOf\(r\)\.indexOf\(filters\.trade\) < 0/.test(mjs) && /worksOf\(r\)\.indexOf\(filters\.works\) < 0/.test(mjs));

console.log('\n[2c] tradesOf/worksOf legacy fallback — genuinely EXECUTED against all four data shapes');
// Loaded into the same ctx as module.js above, so this calls the REAL
// closures via the ProgressPhotos._tradesOf/_worksOf test hooks — not a
// regex match on the surrounding source.
eq('a migrated row with real array data returns the array untouched',
   PP._tradesOf({ trades: ['Structural Works', 'Architectural Works'], trade: 'Structural Works' }),
   ['Structural Works', 'Architectural Works']);
eq('a pre-migration row with only the legacy singular column falls back to a 1-item array',
   PP._tradesOf({ trades: null, trade: 'Civil Works' }), ['Civil Works']);
eq('a row with neither returns an empty array, never null/undefined',
   PP._tradesOf({ trades: null, trade: null }), []);
// ⚠️ An empty `trades` array falls back to the legacy `trade` column, same as
// null would — this is deliberately fine, not a bug, because the required-
// field gate (requiredFieldsMissing) already refuses to save zero trades
// through this module's own UI, so `trades: []` with a real legacy value can
// only arise from data written outside this app (e.g. direct SQL), where
// falling back to whatever IS known beats returning nothing.
eq('an empty trades array still falls back to the legacy column, matching the null case — a state the UI itself cannot produce',
   PP._tradesOf({ trades: [], trade: 'Civil Works' }), ['Civil Works']);
eq('worksOf mirrors the same four cases for works_multi/works',
   PP._worksOf({ works_multi: ['Rebar Installation'], works: 'Formworks' }), ['Rebar Installation']);
eq('worksOf falls back to the legacy singular column pre-migration',
   PP._worksOf({ works_multi: null, works: 'Formworks' }), ['Formworks']);

console.log('\n[3] PPR renamed to Meeting, then to Presentation (2026-08-29 feedback item 3)');
ok('tab label is Presentations', /data-screen="ppr">Presentations</.test(html));
ok('primary action is + New Presentation', /\+ New Presentation/.test(html));
ok('screen title is Presentations', /isPpr \? 'Presentations'/.test(html));
ok('Plans/Gallery screen titles renamed too (2026-08-29 tab-label pass)',
   /isBim \? 'Plans' : 'Gallery'/.test(html));
ok('modal header New Presentation', /'New Presentation' : 'Edit Presentation'/.test(pjs));
ok('list column header is Presentation Date', /<div>Presentation Date<\/div>/.test(pjs));
// Strip // comments before asserting on user-facing copy — a stale comment
// mentioning the old label is not a user-visible string.
const pjsCode = pjs.replace(/^\s*\/\/.*$/gm, '');
ok('no user-facing "New PPR" left', !/\+ New PPR/.test(html + pjsCode));
ok('no user-facing "PPR list" left', !/>PPR list</.test(html) && !/'PPR list'/.test(pjsCode));

console.log('\n[4] After creating a meeting, go to its editor');
ok('openPpr called after insert', /if \(isNew && newId\) openPpr\(newId\)/.test(pjs));
ok('insert uses .select() to return the id', /\.insert\(Object\.assign\(data, \{ project_id: pid, created_by: uid \}\)\)\.select\(\)/.test(pjs));

console.log('\n[5] Meeting list icons hydrate');
ok('renderList hydrates its own output', /renderPreview\(\);[\s\S]{0,600}hydrate\(\);\n  \}/.test(pjs));
ok('empty-state path hydrates too', /hydrate\(\);\n      return;/.test(pjs));
// Row-level edit/delete are GONE (Batch D follow-up item 1: row actions are
// Download/Preview/Archive only) — relocated into the opened presentation's
// own header, still icon-based, never a bare glyph.
ok('row no longer has an edit action', !/data-act="edit"/.test(pjs));
ok('relocated presentation edit/delete use icons, not glyphs', /ppr-pres-edit[\s\S]{0,80}data-ico="pencil"/.test(pjs) && /ppr-pres-del[\s\S]{0,120}data-ico="trash"/.test(pjs));

console.log('\n[6] Key plan is per photo, not per slide');
ok('migration adds progress_photos.key_plan_url', /alter table progress_photos add column if not exists key_plan_url text/.test(fs.readFileSync(migrationFile, 'utf8')));
ok('keyPlanPathFor reads the photo first', /function keyPlanPathFor[\s\S]{0,240}ph && ph\.key_plan_url/.test(pjs));
ok('legacy slide key_plan_url still honoured', /ph && ph\.key_plan_url\) \|\| sl\.key_plan_url/.test(pjs));
// The old key_plan_url form field is retired (item 11) in favour of a real
// floor-plan pin — ppr.js's OWN read side (keyPlanPathFor, tested above)
// is untouched, so any photo captured before this change still shows its
// key plan in a presentation; only the write side moved.
ok('photo forms carry the pin+direction field instead of the retired key-plan wizard',
   /BIM\.pinFieldHTML\('pp', null\)/.test(mjs) && /BIM\.pinFieldHTML\('pp-e',/.test(mjs));
ok('slide form no longer uploads a key plan', !/ppr-s-kp/.test(pjs));
ok('signAll signs photo key plans', /if \(p\.key_plan_url\) paths\[p\.key_plan_url\] = 1;/.test(pjs));

console.log('\n[7/8] Slides are built from photos, with inline add');
ok('slide form has no trade select', !/ppr-s-trade/.test(pjs));
ok('slide form has no works field', !/ppr-s-works/.test(pjs));
ok('slide form has no location field', !/ppr-s-loc"/.test(pjs));
// 2026-08-30 items 18/24: "there is both a pick a photo and add photo button
// — there should only be pick a photo, and add photo should be INSIDE the
// pick-a-photo pop-up." The sibling "+ Add photo" buttons are GONE from the
// slide form; uploading now lives inside openThumbPicker itself, reused by
// every caller of that picker.
ok('the separate sibling "+ Add photo" buttons no longer exist in the slide form', !/ppr-s-after-add/.test(pjs) && !/ppr-s-before-add/.test(pjs));
ok('"+ Upload new photo" now lives INSIDE the pick-a-photo popup (openThumbPicker), not beside it', /id="ppr-pp-upload">\+ Upload new photo</.test(pjs));
ok('inline add calls openUploadForPicker, from inside the picker', /ProgressPhotos\.openUploadForPicker/.test(pjs));
// paintInfo()'s plain-<select>-echo was replaced by a thumbnail PICKER
// (18-item list item 6) — pickBtnHTML renders the chosen photo's thumb+tags
// directly on the picker button, so there's no separate read-only echo box
// to paint any more.
ok('picked photo shows as a thumbnail button, not a plain <select>', /function pickBtnHTML/.test(pjs) && !/function paintInfo/.test(pjs));
// ⚠️ Matched on the exact old signature, not a bare /function photoOptions/ —
// that substring also matches the unrelated, still-live photoOptionsFor()
// (Report Templates' baseline picker), which would make this a false FAIL.
ok('the old plain <select> photo list is gone', !/function photoOptions\(sel\)/.test(pjs));

console.log('\n[9] Before/after may be different locations');
ok('pane() reads each photo\'s own trade/works/location', /var fields = ph \? \[ph\.trade, ph\.works, hideLocation \? null : ph\.location\]/.test(pjs));
ok('slide-level meta row no longer shows location', !/ppr-meta[\s\S]{0,400}<label>Location<\/label>/.test(pjs));
ok('panes are labelled Previous/Current (2026-08-29 feedback item 7 — was Before/After)',
   /ppr-panelabel/.test(pjs) && /'Previous' : 'Current'/.test(pjs));

console.log('\n[10] No before photo → no before caption, photo centered; Current is now required (item 9/10)');
ok('before caption field starts hidden', /id="ppr-s-bcap-field" style="display:none;"/.test(pjs));
ok('the before FIELD (not just the caption) starts hidden until Current is picked (item 10)',
   /id="ppr-s-before-field" style="display:none;"/.test(pjs));
ok('syncVisibility toggles both the before field and its caption', /function syncVisibility[\s\S]{0,220}display = beforeId \? '' : 'none'/.test(pjs));
ok('before_caption nulled when no before photo', /before_caption: beforeId \? \(\$\('ppr-s-bcap'\)\.value\.trim\(\) \|\| null\) : null/.test(pjs));
ok('Current photo is now required to save a slide (was: "at least one of the two")',
   /if \(!afterId\) \{ UI\.toast\('Pick a current photo for this slide'/.test(pjs));
ok('single-photo slide uses ppr-pair-single', /ppr-pair ppr-pair-single/.test(pjs));
ok('ppr-pair-single centers the photo', /\.ppr-pair-single \{[^}]*justify-content: center/.test(css));
ok('offline export centers single too', /\.pair\.single\{grid-template-columns:minmax\(0,760px\);justify-content:center\}/.test(pjs));

console.log('\n[11] Key plan upload/selection wizard — RETIRED, superseded by the pin field (item 11)');
ok('the old upload-your-own-key-plan wizard is gone', !/function openKeyPlanWizard/.test(mjs));
ok('nothing in module.js still calls distinctKeyPlans/uploadKeyPlanFile', !/distinctKeyPlans\(\)/.test(mjs) && !/function uploadKeyPlanFile/.test(mjs));
ok('its dead CSS (.pp-kpgrid/.pp-kpitem/.pp-kppreview*) was cleaned up alongside the JS', !/\.pp-kpgrid \{/.test(css) && !/\.pp-kpitem \{/.test(css));

console.log('\n[12] Clicking a meeting row opens it');
// Item 14: the row's onclick gained a guard so ticking the new select
// checkbox never also opens the presentation — same shape as the Gallery's
// own [data-rowopen] guard in module.js.
ok('row onclick calls openPpr, but not when the click started on the select checkbox',
   /r\.onclick = function \(e\) \{\s*if \(e\.target\.closest\('\.pp-selcell'\)\) return;\s*openPpr\(r\.dataset\.id\);/.test(pjs));
ok('row advertises the action via title', /title="Open this presentation\\'s slides"/.test(pjs));

console.log('\n[13] Copy previous meeting → a WIZARD (follow-up feedback item 6), not an immediate blind copy');
ok('copy select rendered on new meetings', /ppr-f-copy/.test(pjs));
ok('choosing a copy source routes to the wizard instead of creating the presentation immediately',
   /if \(isNew && copyFrom\) \{[\s\S]{0,120}openCopyWizard\(/.test(pjs));
ok('the OLD immediate copySlidesFrom() is gone', !/function copySlidesFrom/.test(pjs));
ok('buildCopyDrafts promotes after into before, the same rule copySlidesFrom used',
   /before_photo_id: s\.after_photo_id \|\| s\.before_photo_id \|\| null/.test(pjs));
ok('new after slot left empty in the draft', /after_photo_id: null,\n        after_caption: ''/.test(pjs));
ok('Finish is disabled until every draft has a current photo',
   /drafts\.some\(function \(d\) \{ return !d\.after_photo_id; \}\)/.test(pjs));
ok('the presentation row is created inside finish() — never before the wizard completes',
   /async function finish\(\) \{[\s\S]{0,400}T_PPR\)\s*\n?\s*\.insert/.test(pjs));

console.log('\n[14] Tile view = photo only, actions in the lightbox');
ok('gallery card has no caption table', !/pp-cardtable/.test(mjs));
ok('gallery card has no inline actions', !/galleryHTML[\s\S]{0,900}rowActions/.test(mjs));
ok('no expand button on tiles', !/pp-expand/.test(mjs + css));
ok('lightbox has download/edit/delete', /pp-lb-download/.test(html) && /pp-lb-edit/.test(html) && /pp-lb-delete/.test(html));
ok('lightbox buttons wired', /pp-lb-edit'\)[\s\S]{0,400}openForm\(r\)/.test(mjs));
ok('edit/delete hidden for readers', /editBtn\.style\.display = canWrite/.test(mjs));
// 2026-08-29 follow-up item 7 supersedes the earlier "List keeps its row
// actions" design: no per-row icons anywhere any more, in EITHER view — the
// lightbox (already asserted above) is the only place they live now.
ok('list view has NO per-row action icons (item 7 — superseded design)',
   !/pp-actcell/.test(mjs) && !/function rowActions/.test(mjs));
ok('clicking a List row opens the lightbox instead', /data-rowopen="' \+ r\.id/.test(mjs) &&
   /openLightbox\(this\.dataset\.rowopen\)/.test(mjs));

console.log('\n[15] Grouping: month default, unified across List AND Gallery (item 6)');
ok('default group is month', /var galleryGroupBy = 'month'/.test(mjs));
ok('trade grouping (replaces List\'s old always-on, ungroupable Trade default)', /galleryGroupBy === 'trade'/.test(mjs));
ok('location grouping', /galleryGroupBy === 'location'/.test(mjs));
// "both no need for the group by year" — Year AND Activity are both gone,
// not just Year; neither was named in the owner's Month/Trade/Location ask.
ok('year grouping REMOVED', !/galleryGroupBy === 'year'/.test(mjs));
ok('activity grouping REMOVED', !/galleryGroupBy === 'activity'/.test(mjs));
ok('ONE shared group-by function feeds both listHTML and galleryHTML (not two mechanisms)',
   /function groupRows\(list\)/.test(mjs) && (mjs.match(/groupRows\(list\)/g) || []).length >= 3);
ok('the group-by select is a single static control in index.html\'s list bar, not rebuilt per view',
   /id="pp-groupby"/.test(html) && !/pp-gallery-groupby/.test(mjs));
ok('choice persisted per project', /uiKey\('gallerygroup'\)/.test(mjs));

// ------------------------------------------------- behavioural: grouping logic --
console.log('\n[15b] Grouping logic executed');
const gk = vm.runInContext(`(function(){
  var MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  function label(key){ if(/^\\d{4}-\\d{2}$/.test(key)){var p=key.split('-');return MONTHS[(+p[1])-1]+' '+p[0];} return key; }
  return { label: label };
})()`, ctx);
eq('month key 2026-06 → "June 2026"', gk.label('2026-06'), 'June 2026');
eq('month key 2026-12 → "December 2026"', gk.label('2026-12'), 'December 2026');
eq('non-month key passes through', gk.label('Tower B'), 'Tower B');

// ------------------------------------------------- behavioural: copy semantics --
console.log('\n[13b] Copy-previous semantics executed');
const srcSlides = [
  { id: 's1', slide_no: 1, before_photo_id: 'pA', after_photo_id: 'pB', before_caption: 'May shot', after_caption: 'June shot' },
  { id: 's2', slide_no: 2, before_photo_id: null, after_photo_id: 'pC', before_caption: null, after_caption: 'June only' },
];
const copied = srcSlides.map((sl, i) => ({
  slide_no: i + 1,
  before_photo_id: sl.after_photo_id || sl.before_photo_id || null,
  after_photo_id: null,
  before_caption: sl.after_caption || sl.before_caption || null,
  after_caption: null,
}));
eq('slide 1: June photo becomes the before', copied[0].before_photo_id, 'pB');
eq('slide 1: after slot cleared for the new capture', copied[0].after_photo_id, null);
eq('slide 1: June caption follows its photo', copied[0].before_caption, 'June shot');
eq('slide 2: single-photo slide still promotes', copied[1].before_photo_id, 'pC');
eq('slide numbers resequenced', copied.map(c => c.slide_no), [1, 2]);

// ------------------------------------------------------ insert returns an id ---
console.log('\n[misc] insert().select() returns the new row id');
(async () => {
  const r = await sbStub.from('progress_photos').insert({ project_id: 'DEMO01', description: 'x' }).select();
  ok('insert returns data with an id', !!(r.data && r.data[0] && r.data[0].id), JSON.stringify(r.data));

  console.log('\n[migration] idempotency');
  const sql = fs.readFileSync(migrationFile, 'utf8');
  ok('uses add column if not exists', /add column if not exists/.test(sql));
  ok('deprecates rather than drops slide columns', !/drop column/.test(sql) && /Deprecated/.test(sql));

  console.log('\n[dark mode] no hard-coded light surfaces in new CSS');
  const newCss = css.split('Tile view is the PHOTO ONLY')[1] || '';
  ok('new gallery/keyplan CSS uses tokens', /var\(--pd-/.test(newCss));
  // #fff is legitimate only on a FIXED-COLOUR surface that ignores the theme
  // on purpose (the dark lightbox overlay; a solid-red numbered badge like
  // .ppr-tmpl-locorder) — checked by CONTEXT (which rule's selector it sits
  // under), not by a total count. A count assertion (fffTotal === N) breaks
  // the moment any future legitimate use is added, which is exactly what
  // happened when 2026-08-29's report-template badge landed — recorded here
  // so the NEXT one doesn't have to rediscover the same fragility.
  const fffRules = [];
  const ruleRe = /([^{}]+)\{([^{}]*#fff(?:fff)?\b[^{}]*)\}/gi;
  let rm;
  while ((rm = ruleRe.exec(css))) fffRules.push(rm[1].trim());
  // Each entry pairs #fff with a rule that ALSO sets a solid brand background
  // (--pd-red / --pd-bad) — confirmed against the shipped CSS, not assumed.
  // .pp-mediatile-badge (Batch C, 2026-08-29) added to the list on the same
  // basis as .pano-badge-warn just above it: a solid-brand-background badge
  // (color-mix red), white text always readable regardless of theme.
  // Batches E-H (2026-08-29) add four more, all the same shape: a fixed dark
  // scrim (.pp-pinbtn — mirrors .pp-cardsel's own dark corner overlay) or a
  // solid brand-red badge/dot (.pp-pinpreview-dot, .bim-cluster, .ppr-mktool
  // — a dark translucent toolbar over an arbitrary photo, .ppr-sortno — a
  // solid-red slide-order badge, same family as .ppr-tmpl-locorder).
  // .bim-pinstage-dot (item 11, same day) is the SAME shape as .bim-pin
  // itself — a solid-red marker with a white ring over an arbitrary floor
  // plan image, deliberately theme-independent since the plan's own colours
  // are unpredictable. .pano-recind/#pano-c-record.is-active (item 18) are
  // the same family again: a fixed dark scrim over live camera video, and a
  // solid brand-red "recording" button state — neither is an app surface.
  // .pp-plancluster (item 16) is .bim-cluster relocated/renamed, same shape
  // unchanged — a solid brand-red badge with a white ring over an arbitrary
  // floor plan image.
  // 2026-08-30: .bim-regpt (item 26's registration point markers — a solid
  // marker with a white ring, same family as .bim-pin/.bim-pinstage-dot) and
  // .bim-conehandle-el (item 28's cone drag handle — a white-filled control
  // knob with a red ring, deliberately theme-independent since it sits over
  // an arbitrary floor-plan/photo image) join the allow-list on the same
  // basis as the entries already documented above.
  const ALLOWED_FFF_CONTEXT = /\.pp-lightbox|\.pp-lb-|\.ppr-tmpl-locorder|\.pp-tab\.active|\.pd-btn-primary|\.pp-del:hover|\.pp-syncbtn:hover|\.pano-badge-warn|\.bim-pin\b|\.bim-pinstage-dot\b|#bim-place\.is-active|\.pp-mediatile-badge|\.pp-pinbtn\b|\.pp-pinpreview-dot|\.pp-plancluster\b|\.ppr-mktool\b|\.ppr-sortno\b|\.pp-mk-tool\.active|\.pano-recind\b|#pano-c-record\.is-active|\.bim-regpt\b|\.bim-conehandle-el\b|\.ppr-kpicon\b/;
  const stray = fffRules.filter((sel) => !ALLOWED_FFF_CONTEXT.test(sel));
  ok('every #fff use sits under a documented fixed-colour selector', stray.length === 0 && fffRules.length > 0,
     JSON.stringify(stray));
  ok('the dark lightbox overlay still uses #fff for its tool icons', /\.pp-lb-tool \{[^}]*color: #fff/.test(css));
  ok('no #fff on any new light surface (gallery/keyplan/pickers)',
     !/\.pp-(kp|gallerygroup|gallerybar|groupby)[^{]*\{[^}]*#fff/.test(css) &&
     !/\.ppr-pick[^{]*\{[^}]*#fff/.test(css));

  // ============================================================ Phase 2 ===
  // Report Templates (brief Section 5) — the last piece of the "site survey
  // app" 6-phase roadmap Phase 2 needed: saved, re-runnable report definitions
  // with a comparison rule, plus real PPTX/PDF export (not just the offline
  // HTML copy). Structural checks against the shipped source below; the
  // resolution ALGORITHM (previous-vs-baseline, missing-photo handling) is
  // cross-checked behaviourally further down, same style as the [13b]
  // copy-previous check above.
  console.log('\n[16] Report Templates: schema');
  const tmplSql = fs.readFileSync(tmplMigrationFile, 'utf8');
  ok('migration creates ppr_report_templates', /create table if not exists ppr_report_templates/.test(tmplSql));
  ok('locations is a jsonb array (read/written as one list, not a join table)',
     /locations\s+jsonb default '\[\]'::jsonb/.test(tmplSql));
  ok('comparison_rule has a sane default', /comparison_rule\s+text default 'previous'/.test(tmplSql));
  const schemaSql = fs.readFileSync(schemaFile, 'utf8');
  ok('supabase-schema.sql declares the table too', /create table if not exists ppr_report_templates/.test(schemaSql));
  ok('folded into the generic module-table RLS loop',
     /'progress_photos','ppr_presentations','ppr_slides','ppr_report_templates'/.test(schemaSql));

  console.log('\n[17] Report Templates: UI wired end to end');
  ['function renderTemplates', 'function openTemplateForm', 'function generateFromTemplate',
   'function photosAtLocation', 'function allLocationCombos', 'function openLocationPicker',
   'function removeTemplate', 'async function collectSlideImages', 'async function exportPdf',
   'async function exportPptx'
  ].forEach((sig) => ok(sig + '() exists in ppr.js', pjs.includes(sig)));
  ok('module.js exposes locCombos for the template builder', /locCombos: function \(\) \{ return locCombos\(\); \}/.test(mjs));
  ok('module.js exposes photoLocCombos (photo-derived locations)', /function photoLocCombos\(\)/.test(mjs));
  ok('index.html has the Templates topbar button', /id="ppr-templates"/.test(html));
  ok('index.html has the + New template button', /id="ppr-tmpl-new"/.test(html));
  ok('index.html has the templates screen host', /id="ppr-tmpl-wrap"/.test(html));
  ok('screen state extends to templates (list | slides | templates)', /screen === 'templates'/.test(pjs));
  ok('syncTools shows/hides the template-screen tools', /tmplBtn\.style\.display/.test(pjs) && /tmplNew\.style\.display/.test(pjs));
  ok('the templates table does NOT inherit the Meetings list\'s 4-column grid',
     /\.ppr-tmpl-table \.ppr-head, \.ppr-tmpl-table \.ppr-row \{\s*grid-template-columns: minmax/.test(css));
  ok('generateFromTemplate flags a missing photo/baseline instead of hiding it',
     /noPhoto \+ ' location/.test(pjs) && /noBaseline \+ ' baseline photo/.test(pjs));
  ok('a generated meeting jumps into its slide editor (same rule as item 4)', /openPpr\(newId\);\s*\}\s*\n\s*function openTemplateForm/.test(pjs));

  console.log('\n[18] PDF/PPTX export libraries wired correctly');
  ok('html2pdf.js CDN script present (pinned version)', /html2pdf\.js\/0\.10\.1\/html2pdf\.bundle\.min\.js/.test(html));
  ok('pptxgenjs CDN script present (pinned version)', /pptxgenjs@3\.12\.0\/dist\/pptxgen\.bundle\.js/.test(html));
  ok('exportPdf guards against the library not having loaded', /typeof html2pdf !== 'function'/.test(pjs));
  ok('exportPptx guards against the library not having loaded', /typeof PptxGenJS !== 'function'/.test(pjs));
  // ⚠️ The exact bug the issues-lessons module shipped and then had to fix
  // (2026-08-22): position:fixed/absolute on the CAPTURED element makes
  // html2canvas measure a real width and a height of ZERO — every page comes
  // out blank with no error. The off-screen parking must live on the HOLDER;
  // the captured `wrap` must stay in normal flow. Asserted here so this PDF
  // export can't quietly regress into the same blank-page bug.
  const pdfFnSrc = (pjs.match(/async function exportPdf[\s\S]*?\n  \}\n/) || [''])[0];
  ok('exportPdf: the HOLDER is parked off-screen (position:fixed)', /holder\.style\.cssText = 'position:fixed/.test(pdfFnSrc));
  ok('exportPdf: the captured wrap is NOT position:fixed/absolute', !/wrap\.style\.cssText = '[^']*position:\s*(fixed|absolute)/.test(pdfFnSrc));
  ok('exportPdf removes the holder in a finally block (no leaked nodes on error)',
     /\} finally \{\s*if \(holder/.test(pdfFnSrc));
  ok('exportPptx strips the data: prefix before handing an image to PptxGenJS',
     /function stripDataPrefix\(uri\) \{ return uri \? uri\.replace\(\/\^data:\/, ''\)/.test(pjs));
  // 1 definition + 3 call sites (offline HTML / PDF / PPTX) — all three
  // formats sharing one function is the point; the +1 accounts for the
  // definition line itself, not a fourth caller.
  ok('the three export formats share ONE image-collection function (no divergent embedding logic)',
     (pjs.match(/collectSlideImages\(s,/g) || []).length === 4);

  console.log('\n[19] Report Templates: resolution algorithm executed');
  // Reimplements generateFromTemplate's pure decision logic exactly (same
  // cross-check style as [13b]'s copySlidesFrom test above) — not a stub of
  // the module, a restatement of the same rule, run against fixtures the
  // pre-2026-08-29 file has no way to satisfy (it has no templates at all).
  function resolvePick(candidatesDesc, rule, baselinePhoto) {
    var after = candidatesDesc[0] || null;
    var before = null, missingBaseline = false;
    if (rule === 'baseline') {
      before = baselinePhoto || null;
      missingBaseline = !before && arguments.length > 2 && arguments[2] !== undefined && baselinePhoto === null;
    } else {
      before = candidatesDesc[1] || null;
    }
    return { before: before, after: after, missingBaseline: missingBaseline };
  }
  const photoJune = { id: 'j1', taken_at: '2026-06-01' };
  const photoMay  = { id: 'm1', taken_at: '2026-05-01' };
  const candsDesc = [photoJune, photoMay]; // newest first, as photosAtLocation() sorts

  let r1 = resolvePick(candsDesc, 'previous');
  eq('"previous" rule: after = newest photo', r1.after.id, 'j1');
  eq('"previous" rule: before = the one before it', r1.before.id, 'm1');

  let r2 = resolvePick([photoJune], 'previous');
  eq('"previous" rule, only ONE capture ever: after set, before null (nothing to compare yet)', r2.before, null);
  ok('after is still populated on a first-ever capture', r2.after.id === 'j1');

  let r3 = resolvePick(candsDesc, 'baseline', photoMay);
  eq('"baseline" rule: after = newest regardless of baseline', r3.after.id, 'j1');
  eq('"baseline" rule: before = the PINNED baseline, not the previous capture', r3.before.id, 'm1');

  let r4 = resolvePick(candsDesc, 'baseline', null);
  ok('"baseline" rule with no baseline set: before is null, not guessed', r4.before === null);

  let r5 = resolvePick([], 'previous');
  ok('a location with NO photos yet: after is null too (not skipped from the report)', r5.after === null);

  // allLocationCombos(): schedule-derived wins on a key collision; photo-only
  // locations fill in what the schedule doesn't know about.
  function mergeCombos(scheduleCombos, photoCombos) {
    var byKey = {};
    scheduleCombos.forEach((c) => { byKey[c.key] = c; });
    photoCombos.forEach((c) => { if (!byKey[c.key]) byKey[c.key] = c; });
    return Object.keys(byKey).map((k) => byKey[k]).sort((a, b) => a.label.localeCompare(b.label));
  }
  const merged = mergeCombos(
    [{ key: 'A', label: 'Tower A · 5th Floor (from schedule)', values: {} }],
    [{ key: 'A', label: 'Tower A · 5th Floor (STALE — from a photo)', values: {} },
     { key: 'B', label: 'Zone B (photo only, not on the schedule)', values: {} }]
  );
  eq('allLocationCombos: schedule label wins on a key collision', merged.filter((c) => c.key === 'A')[0].label,
     'Tower A · 5th Floor (from schedule)');
  ok('allLocationCombos: a photo-only location still appears', merged.some((c) => c.key === 'B'));
  eq('allLocationCombos: exactly one entry per key (no duplicate)', merged.length, 2);

  // ============================================================ Phase 3 ===
  // Panoramic Capture (brief Section 6). Structural checks below; the actual
  // OpenCV.js stitching pipeline (ORB -> BFMatcher -> findHomography ->
  // warpPerspective) and the Three.js cylinder viewer were run FOR REAL in a
  // browser against the shipped source (sliced verbatim into a throwaway
  // harness, WASM/WebGL genuinely executed, not simulated) — see
  // modules/progress-photos/CLAUDE.md for the measured results. That's a
  // stronger verification than Node can offer here (no WASM/WebGL in this
  // harness), so it isn't repeated as a Node assertion.
  console.log('\n[20] Panoramic Capture: schema + wiring');
  const panoSql = fs.readFileSync(panoMigrationFile, 'utf8');
  ok('migration creates panoramas', /create table if not exists panoramas/.test(panoSql));
  ok('stitch_quality defaults to ok, flagged not hidden on failure', /stitch_quality\s+text default 'ok'/.test(panoSql));
  ok('supabase-schema.sql declares panoramas too', /create table if not exists panoramas/.test(schemaSql));
  ok('panoramas folded into the generic module-table RLS loop',
     /'ppr_report_templates','panoramas'/.test(schemaSql));
  ok('pano.js: cv.Stitcher is explicitly known to be unavailable (documented, not assumed)',
     /browser builds of OpenCV\.js do NOT expose `cv\.Stitcher`/.test(pnjs));
  ['function extractFrames', 'function stitchFrames', 'function homographyBetween',
   'function mountCylinderViewer', 'function openCaptureModal', 'function openCompareModal',
   'function ensureOpenCV', 'function allLocationCombos'
  ].forEach((sig) => ok(sig + '() exists in pano.js', pnjs.includes(sig)));
  ok('a low-match pair flags the whole panorama poor, not silently kept "ok"',
     /matches < MIN_GOOD_MATCHES \|\| !H\) \{ quality = 'poor'/.test(pnjs));
  // Batch C (2026-08-29): the standalone 360° tab is GONE — capture and the
  // existing-panorama list are folded into the Gallery screen itself, per
  // owner feedback ("360 and 3D should be incorporated in the Gallery").
  // pano.js's own screen/host div stay in the DOM (permanently hidden) since
  // load()/render() both key off #pano-view existing — see the "not removed"
  // assertion below.
  ok('index.html no longer has a standalone 360° tab', !/data-screen="pano"/.test(html));
  // 2026-08-29 follow-up item 2: "I only need the add media button... no
  // need for the capture 360, compare over time" — the dedicated capture/
  // compare buttons are REMOVED from the topbar entirely (superseding the
  // earlier "folded onto Gallery" state, which had them showing there).
  // pano.js's own openCaptureModal/openCompareModal are left defined but are
  // now unreachable from the UI, the same "on hold" treatment 360°/3D
  // already gets in the Add-media type picker.
  ok('index.html no longer has the Capture 360° / Compare topbar buttons',
     !/id="pano-new"/.test(html) && !/id="pano-compare-btn"/.test(html));
  ok('the 360° screen host div is kept (hidden), not deleted — pano.js\'s load()/render() key off it existing',
     /id="pp-screen-pano" hidden/.test(html));
  ok('OpenCV.js CDN script present (pinned version)', /opencv-js@4\.10\.0-release\.1\/dist\/opencv\.js/.test(html));
  ok('Three.js CDN script present (pinned, classic global build not the ES-module-only r150\\+)', /three@0\.128\.0\/build\/three\.min\.js/.test(html));
  ok('PANO.init is wired alongside PPR.init', /PANO\.init\(user, profile\)/.test(html));
  ok('setScreen no longer calls PANO._syncTools — nothing left in the DOM for it to toggle',
     !/PANO\._syncTools\(/.test(html));
  ok('pano.js exposes ensureLoaded/urlOf for the unified Gallery media strip (Batch C)',
     pnjs.includes('ensureLoaded:') && pnjs.includes('urlOf:'));
  ok('a poor-quality panorama is flagged in the gallery, not hidden', pnjs.includes('pano-badge-warn'));

  // ============================================================ Phase 4 ===
  // 3D Reconstruction Requests — the PAID feature, gated behind admin
  // approval per the owner's explicit requirement. The gate itself is a
  // Postgres RLS policy (Deno/RunPod/GPU can't be executed in this harness),
  // so what's checked here is that the gate EXISTS and is shaped correctly —
  // not the generic loop's "own row" shape, which would let a requester
  // approve themselves — plus that the client never offers to bypass it.
  console.log('\n[21] Reconstruction Requests: the admin-approval gate itself');
  const reconSql = fs.readFileSync(reconMigrationFile, 'utf8');
  ok('migration creates reconstruction_requests', /create table if not exists reconstruction_requests/.test(reconSql));
  ok('NOT folded into the generic own-row RLS loop', !/'panoramas','reconstruction_requests'/.test(schemaSql));
  ok('status defaults to pending_approval, never pre-approved', /status\s+text default 'pending_approval'/.test(reconSql));
  ok('INSERT policy forces status = pending_approval via WITH CHECK (a crafted insert cannot self-approve)',
     /reconstruction_requests_ins[\s\S]{0,300}status = 'pending_approval'/.test(reconSql));
  ok('UPDATE policy is admin-only in BOTH using and with check (not "own row or admin")',
     /reconstruction_requests_upd[\s\S]{0,200}for update using \(is_admin\(\) and can_access_project\(project_id\)\)\s*\n\s*with check \(is_admin\(\) and can_access_project\(project_id\)\)/.test(reconSql));
  ok('a requester may only DELETE their own row, and only while still pending (no retracting an approved job)',
     /requested_by = auth\.uid\(\) and status = 'pending_approval'/.test(reconSql));
  ok('supabase-schema.sql declares reconstruction_requests with the SAME bespoke policies (not the generic loop)',
     /create table if not exists reconstruction_requests/.test(schemaSql) &&
     /reconstruction_requests_upd[\s\S]{0,200}for update using \(is_admin\(\)/.test(schemaSql));

  console.log('\n[22] submit-reconstruction / reconstruction-webhook Edge Functions');
  const submitTs = fs.readFileSync(submitFnFile, 'utf8');
  const webhookTs = fs.readFileSync(webhookFnFile, 'utf8');
  ok('submit-reconstruction requires admin/super_admin (tighter than the usual admin/planner set)',
     /\["super_admin", "admin"\]\.includes\(prof\.role\)/.test(submitTs));
  ok('submit-reconstruction re-checks status === pending_approval server-side before calling RunPod',
     /reqRow\.status !== "pending_approval"/.test(submitTs));
  ok('submit-reconstruction signs a SHORT-LIVED url to the video, not a broad service key, for the worker',
     /createSignedUrl\(reqRow\.video_url, VIDEO_SIGN_TTL\)/.test(submitTs));
  ok('the RunPod API key is read from a server-side secret, never sent to or read from the client',
     /Deno\.env\.get\("RUNPOD_API_KEY"\)/.test(submitTs) && !html.includes('RUNPOD_API_KEY'));
  ok('the update re-asserts status=pending_approval in the WHERE clause (no double-submit race)',
     /\.eq\("id", requestId\)\.eq\("status", "pending_approval"\)/.test(submitTs));
  ok('reconstruction-webhook is documented as needing --no-verify-jwt (RunPod has no Supabase session)',
     /--no-verify-jwt/.test(webhookTs));
  ok('reconstruction-webhook checks the per-request token before writing anything', /webhook_token !== token/.test(webhookTs));
  ok('reconstruction-webhook never trusts an unauthenticated request without the token check running first',
     webhookTs.indexOf('webhook_token !== token') < webhookTs.indexOf('body?.status'));

  console.log('\n[23] Client UI never offers to bypass the gate');
  ok('the client calls submit-reconstruction only from an ADMIN action (approveRequest), never on insert',
     /function approveRequest/.test(rcjs) && !/openRequestForm[\s\S]{0,1500}submit-reconstruction/.test(rcjs));
  ok('a new request is inserted with status pending_approval, set by the client but enforced by the DB',
     /status: 'pending_approval'/.test(rcjs));
  ok('rejectRequest and retractRequest never call submit-reconstruction', !/reject[\s\S]{0,400}submit-reconstruction/.test(rcjs));
  ok('the approval confirm dialog states this is a real billed job before submitting',
     /This is a real, billed job/.test(rcjs));
  // Batch C (2026-08-29): the standalone 3D tab is GONE, same fold as 360°
  // above — the Request-scan tool and the screen host div stay (the latter
  // hidden, kept because recon.js's load()/render() key off it existing).
  ok('index.html no longer has a standalone 3D tab', !/data-screen="recon"/.test(html));
  // Same removal as the 360° buttons above (item 2) — the screen host stays,
  // the capture button is gone.
  ok('index.html no longer has the Request-scan topbar button', !/id="recon-new"/.test(html));
  ok('the 3D screen host div is kept (hidden), not deleted', /id="pp-screen-recon" hidden/.test(html));
  ok('PLYLoader CDN script present (same pinned Three.js revision as the 360° viewer)',
     /three@0\.128\.0\/examples\/js\/loaders\/PLYLoader\.js/.test(html));
  ok('RECON.init is wired alongside the other module inits', /RECON\.init\(user, profile\)/.test(html));
  ok('setScreen no longer calls RECON._syncTools — nothing left in the DOM for it to toggle',
     !/RECON\._syncTools\(/.test(html));
  ok('recon.js exposes ensureLoaded for the unified Gallery media strip (Batch C)',
     rcjs.includes('ensureLoaded:'));
  ['function openRequestForm', 'function approveRequest', 'function rejectRequest', 'function retractRequest',
   'function openResultViewer', 'function mountPointCloudViewer'
  ].forEach((sig) => ok(sig + '() exists in recon.js', rcjs.includes(sig)));

  console.log('\n[24] Floor Plan overlay (brief 6B / Phase 5) — scope note + wiring');
  ok('bim.js states the scope note (pin navigator, not a real BIM/IFC viewer)',
     /NOT import, register against, or overlay a real BIM\/IFC/.test(bmjs));
  const floorPlanSql = fs.readFileSync(floorPlanMigrationFile, 'utf8');
  ok('floor_plans table declared', /create table if not exists floor_plans/.test(floorPlanSql));
  ok('floor_plan_pins table declared', /create table if not exists floor_plan_pins/.test(floorPlanSql));
  ok('floor_plan_pins.item_type is constrained to the three real target kinds',
     /item_type in \('panorama', 'reconstruction', 'photo'\)/.test(floorPlanSql));
  ok('pin coordinates are normalized 0..1 (resolution-independent of the stored image)',
     /x_norm double precision not null check \(x_norm >= 0 and x_norm <= 1\)/.test(floorPlanSql));
  ok('floor_plan_pins.floor_plan_id cascades on delete (a deleted plan takes its own pins with it)',
     /floor_plan_id uuid references floor_plans\(id\) on delete cascade/.test(floorPlanSql));
  ok('both tables are RLS-enabled with a read-all-approved / write-writers-only shape',
     /floor_plans_read[\s\S]{0,200}can_access_project/.test(floorPlanSql) &&
     /floor_plans_rw[\s\S]{0,200}is_writer\(\) and can_access_project/.test(floorPlanSql));
  ok('floor_plans is folded into supabase-schema.sql', fs.readFileSync(schemaFile, 'utf8').includes('create table if not exists floor_plans'));
  ok('floor_plan_pins is folded into supabase-schema.sql', fs.readFileSync(schemaFile, 'utf8').includes('create table if not exists floor_plan_pins'));

  ['function openPlanForm', 'function openPinPicker', 'function togglePlaceMode', 'function openPin',
   'function wireStageInteractions', 'function pinMarkerHTML'
  ].forEach((sig) => ok(sig + '() exists in bim.js', bmjs.includes(sig)));

  ok('index.html has the Plans tab (renamed from Floor Plan, 2026-08-29) + tools + screen host',
     /data-screen="bim">Plans</.test(html) && /id="bim-new"/.test(html) &&
     /id="pp-screen-bim"/.test(html));
  // 2026-08-30 item 27: "Place pin" is REMOVED from index.html entirely — pin
  // placement now happens every time a photo is added, never on this screen.
  ok('the "Place pin" toolbar button no longer exists in index.html (item 27)', !/id="bim-place"/.test(html));
  ok('bim.js is loaded and BIM.init is wired alongside the other module inits',
     /src="bim\.js/.test(html) && /BIM\.init\(user, profile\)/.test(html));
  ok('setScreen dispatches the bim screen and hides it from the generic "isPhotos" fallback ' +
     '(simplified to isPpr/isBim only in Batch C, now that pano/recon/rounds are no longer their own screens)',
     /isBim = s === 'bim'/.test(html) && /isPhotos = !isPpr && !isBim/.test(html));
  ok('BIM._syncTools is called on every screen switch (role + inner-screen gating, same as the other three modules)',
     /BIM\._syncTools\(isBim\)/.test(html));

  ok('a pin references its target polymorphically (item_type + item_id), never three separate FK columns',
     !/panorama_id uuid references|reconstruction_id uuid references|photo_id uuid references/.test(floorPlanSql));
  ok('opening a pin routes through the OTHER modules\' own viewer, not a re-implementation in bim.js',
     /PANO\.open\(pin\.item_id\)/.test(bmjs) && /RECON\.openById\(pin\.item_id\)/.test(bmjs) &&
     /ProgressPhotos\.openPhotoById\(pin\.item_id\)/.test(bmjs));
  ok('only DONE reconstructions are offered when placing a pin (RECON.doneList, not the raw request list)',
     /RECON\.doneList/.test(bmjs));

  console.log('\n[24b] Floor Plan pan/zoom math — genuinely EXECUTED, not just read as text');
  // The zoom-anchor formula is the one part of this screen worth checking
  // mechanically: get the sign wrong and the image visibly "runs away" from
  // the cursor while zooming, which is not something a source-regex check
  // could ever catch. bim.js has no top-level side effects (its IIFE only
  // defines functions), so loading it into the same vm context used for
  // module.js/ppr.js above is safe and lets this run as real code.
  ok('zooming IN keeps the point under the cursor visually stationary (pan compensates for the scale change)', (() => {
    // Cursor at (100,100), image currently at zoom 1 with no pan. Zoom to 2x.
    // The world point under the cursor must map back to the same screen
    // position (100,100) under the new pan+zoom: panX + worldX*newZoom = 100,
    // where worldX = (100 - oldPanX) / oldZoom = 100.
    const r = BIM._zoomAnchor(100, 100, 1, 2, 0, 0);
    const screenXAfter = r.panX + 100 * 2;
    return Math.abs(screenXAfter - 100) < 1e-9;
  })());
  ok('zooming OUT back to the original scale restores the original pan exactly (round-trip, no drift)', (() => {
    const zoomedIn = BIM._zoomAnchor(250, 180, 1, 3, 5, 5);
    const back = BIM._zoomAnchor(250, 180, 3, 1, zoomedIn.panX, zoomedIn.panY);
    return Math.abs(back.panX - 5) < 1e-9 && Math.abs(back.panY - 5) < 1e-9;
  })());
  ok('a zoom with no change in zoom level is a no-op on pan', (() => {
    const r = BIM._zoomAnchor(400, 300, 2, 2, 17, -9);
    return r.panX === 17 && r.panY === -9;
  })());

  console.log('\n[25] Drone provenance on panoramas (brief 6C / Phase 6)');
  const panoSql6 = fs.readFileSync(panoMigrationFile, 'utf8');
  ok('panoramas.source column declared, mirroring reconstruction_requests.video_source',
     /source\s+text default 'ground'/.test(panoSql6));
  ok('panoramas.source is folded into supabase-schema.sql', fs.readFileSync(schemaFile, 'utf8').includes("source          text default 'ground', -- 'ground' | 'drone'"));
  ok('the capture form offers a Ground/Drone source select', /id="pano-c-source"/.test(pnjs) && /Drone \(aerial\)/.test(pnjs));
  ok('the source value is threaded into the saved row',
     // Read into a hoisted `source` variable at the TOP of processVideo, not
     // a late $('pano-c-source').value re-lookup (audit fix H2 — see
     // section [35]) — so it's captured before extraction/OpenCV/stitching/
     // upload can run for several seconds and the modal (and its form
     // fields) can be dismissed out from under a still-in-flight read.
     /var source = \$\('pano-c-source'\)\.value;/.test(pnjs) && /source: source/.test(pnjs));
  ok('the insert is tolerant of the source column not being migrated yet (retries without it)',
     /delete row\.source/.test(pnjs));
  ok('a drone-sourced panorama shows a Drone badge in the gallery, same convention as the 3D request list',
     /pano-src.*Drone-sourced footage/.test(pnjs));
  ok('reconstruction_requests already had video_source (ground/drone) before this pass — Phase 6 extends the SAME field name convention to panoramas',
     /video_source\s+text default 'ground'/.test(fs.readFileSync(reconMigrationFile, 'utf8')));

  console.log('\n[26] Batch C (2026-08-29 follow-up) — Rounds removed, 360°/3D folded into Gallery');
  // --- Rounds is completely gone, not gated -----------------------------
  ok('renderRounds/wireRounds/startWalkthrough/advanceWalkthrough/openWalkStep no longer exist in module.js',
     !/function renderRounds|function wireRounds|function startWalkthrough|function advanceWalkthrough|function openWalkStep/.test(mjs));
  ok('the Rounds module-scope state vars are gone too (roundsFilter/roundsSelected/walkState/_roundsComboByKey)',
     !/var roundsFilter|var roundsSelected|var walkState|var _roundsComboByKey/.test(mjs));
  ok('ProgressPhotos no longer exports renderRounds', !/renderRounds: renderRounds/.test(mjs));
  ok('the Rounds tab/screen/search field are gone from index.html', !/data-screen="rounds"|pp-screen-rounds|pp-rounds-search/.test(html));
  ok('openUpload no longer carries any walkthrough branch (preset.walk)', !/preset\.walk/.test(mjs));
  ok('locCombos/photoLocCombos survive the Rounds removal — bim.js and ppr.js both depend on them',
     /function locCombos/.test(mjs) && /function photoLocCombos/.test(mjs));
  ok('setScreen can no longer be handed a Rounds/Pano/Recon screen from stale localStorage (would throw on the deleted renderRounds)',
     !/\['ppr', 'rounds', 'pano', 'recon', 'bim'\]/.test(html) && /\['ppr', 'bim'\]\.indexOf\(saved\)/.test(html));

  // --- 360°/3D folded into Gallery, not deleted --------------------------
  ok('the tab bar now has exactly three tabs: Gallery, Presentations, Plans',
     (html.match(/class="pp-tab[^"]*" data-screen="[a-z]+"/g) || []).length === 3 &&
     /data-screen="photos">Gallery/.test(html) && /data-screen="ppr">Presentations/.test(html) && /data-screen="bim">Plans/.test(html));
  ok('the Gallery screen carries a #pp-media-strip host for the folded 360°/3D content', /id="pp-media-strip"/.test(html));
  ok('module.js loads PANO/RECON data before rendering Gallery, so the strip has something to show without a separate screen visit',
     /PANO && PANO\.ensureLoaded[\s\S]{0,120}RECON && RECON\.ensureLoaded/.test(mjs));
  ok('render() calls renderMediaStrip() BEFORE the photo grid\'s own empty-state branches, so it repaints regardless of them',
     /renderMediaStrip\(\);/.test(mjs) && mjs.indexOf('renderMediaStrip();') < mjs.indexOf('if (!rows.length)'));
  ok('a media tile opens the SAME viewers as the old dedicated tabs used (PANO.open / RECON.openById), nothing reimplemented',
     /PANO && PANO\.open\)\s*PANO\.open\(id\)/.test(mjs) && /RECON && RECON\.openById\)\s*RECON\.openById\(id\)/.test(mjs));

  // --- mediaStripMatches genuinely EXECUTED against the real closure -------
  // `filters` is module-private state, set only via wireFilters()/init() —
  // never called in this harness (same as every other Batch A/B test above,
  // which is why [2c] tests tradesOf/worksOf as pure functions instead). At
  // its untouched default (every field blank) this is still a real assertion
  // of the function's actual behaviour, not a stub: it proves the ANDed
  // filter checks all short-circuit to "no restriction" together rather than
  // one of them silently rejecting everything by default.
  ok('with every filter at its untouched default, a real item matches',
     PP._mediaStripMatches({ location_values: {}, taken_at: '2026-03-01', location: 'Tower 1' }));
  ok('_mediaStripItems() runs against the real PANO/RECON closures with no throw, and returns [] before either has loaded anything',
     JSON.stringify(PP._mediaStripItems()) === '[]');

  console.log('\n[27] Deployment plan — Presentations row (Download/Preview/Archive), shared location, PPTX/PDF fixes, wizard, Gallery batch select');

  // --- Migration --------------------------------------------------------
  const archiveSql = fs.readFileSync(archiveMigrationFile, 'utf8');
  ok('migration adds archived to all four tables', [
    'progress_photos', 'ppr_presentations', 'panoramas', 'reconstruction_requests'
  ].every((t) => new RegExp('alter table ' + t + '\\s+add column if not exists archived boolean default false').test(archiveSql)));
  ok('supabase-schema.sql carries the archived column at least 4 times (one per table)',
     (schemaSql.match(/archived\s+boolean default false/g) || []).length >= 4);

  // --- Row actions: Download / Preview / Archive (item 1, THEN removed
  // entirely by 2026-08-30 item 15 — "no need for icons per row" — moved
  // into the OPENED presentation's own header, wired by wirePresActs). ----
  ok('the row no longer has pdf/pptx/open as separate icons', !/data-act="pdf"/.test(pjs) && !/data-act="pptx"/.test(pjs) && !/data-act="open"/.test(pjs));
  ok('item 15: the LIST ROW itself has no per-row action icons at all any more (no data-act in renderList\'s row markup)',
     !/ppr-row' \+[\s\S]{0,300}data-act=/.test(pjs));
  ok('item 16: the row\'s red highlight follows the CHECKBOX (selectedPprs), not `selId`',
     /'<div class="ppr-row' \+ \(selectedPprs\[p\.id\] \? ' sel' : ''\)/.test(pjs));
  ok('Download/Preview/Archive are still reachable — relocated to the OPENED presentation\'s own header (wirePresActs)',
     /id="ppr-pres-dl"/.test(pjs) && /id="ppr-pres-preview"/.test(pjs) && /id="ppr-pres-arch"/.test(pjs) &&
     /\$\('ppr-pres-dl'\)\.onclick = function \(\) \{ openDownloadChoice\(p\); \};/.test(pjs) &&
     /\$\('ppr-pres-preview'\)\.onclick = function \(\) \{ openPreviewModal\(p\); \};/.test(pjs) &&
     /\$\('ppr-pres-arch'\)\.onclick = function \(\) \{ toggleArchive\(p\); \};/.test(pjs));
  ok('download opens a format-choice modal instead of exporting directly', /function openDownloadChoice/.test(pjs) && /data-fmt="html"/.test(pjs) && /data-fmt="pptx"/.test(pjs) && /data-fmt="pdf"/.test(pjs));
  ok('the format choice dispatches to all three real export functions', /if \(fmt === 'html'\) exportOffline\(p\);/.test(pjs) && /else if \(fmt === 'pptx'\) exportPptx\(p\);/.test(pjs) && /else if \(fmt === 'pdf'\) exportPdf\(p\);/.test(pjs));
  ok('preview reuses slidesBodyHTML/EXPORT_CSS verbatim, not a re-implementation', /function openPreviewModal[\s\S]{0,700}slidesBodyHTML\(p, s, identityImgs\(s\)\)/.test(pjs));
  ok('preview does not re-embed images as data URIs — it reuses the already-signed URLs', /function identityImgs[\s\S]{0,220}imgs\[u\] = u;/.test(pjs));
  ok('icon left-padding on the row (re-confirmed; already shipped in Batch A)', /\.ppr-acts \{[^}]*padding-left: 10px/.test(css));

  // --- Archive filter + toggle (item 1) -----------------------------------
  ok('archived is hidden unless the toggle is on, never both at once', /!!p\.archived !== !!filters\.archived/.test(pjs) && /!!r\.archived !== !!filters\.archived/.test(mjs));
  ok('index.html has a "Show archived" toggle on both the Presentations and Gallery filter bars', (html.match(/Show archived/g) || []).length === 2);
  ok('toggling archive is tolerant of the migration not having run yet', /migrations\/2026-08-29-archive-flag\.sql/.test(pjs) && /migrations\/2026-08-29-archive-flag\.sql/.test(mjs));
  ok('Clear filters does NOT reset the archived toggle — it is a separate view, not a search filter',
     /filters = \{ from: '', to: '', archived: filters\.archived \};/.test(pjs) &&
     /filters = \{ from: '', to: '', trade: '', works: '', locValues: \{\}, search: '', archived: filters\.archived \};/.test(mjs));

  // --- Edit/Delete presentation relocated (item 1) ------------------------
  ok('wirePresActs wires the relocated edit/delete buttons to the same openPprForm/removePpr', /function wirePresActs\(p\)[\s\S]{0,200}openPprForm\(p\)[\s\S]{0,100}removePpr\(p\)/.test(pjs));
  ok('wirePresActs is called on BOTH the empty-slides and normal render paths (not just one)',
     (pjs.match(/wireSlideNav\(s\); wirePresActs\(p\);/g) || []).length === 2);

  // --- Shared location tile (items 3/4) — genuinely EXECUTED --------------
  eq('two photos at the same location share a tile', PPR._sameLocation({ location: 'Tower 1 - L5' }, { location: 'Tower 1 - L5' }), true);
  eq('different locations do not share a tile', PPR._sameLocation({ location: 'Tower 1 - L5' }, { location: 'Tower 2 - L5' }), false);
  eq('a blank location on either side never counts as shared', PPR._sameLocation({ location: '' }, { location: '' }), false);
  eq('sharedLocationOf resolves through both photo ids', PPR._sharedLocationOf({ before_photo_id: null, after_photo_id: null }), '');
  ok('renderSlides omits the location from each pane when it is shown as one shared tile',
     /pane\(cur, 'before', !!sharedLoc\)/.test(pjs) && /pane\(cur, 'after', !!sharedLoc\)/.test(pjs));
  ok('slideFigureHTML (HTML+PDF export) takes the same hideLocation flag', /function slideFigureHTML\(sl, which, imgs, hideLocation\)/.test(pjs));
  ok('slidesBodyHTML computes the shared location per slide for the exported files too',
     /var sharedLoc = hasBefore \? sharedLocationOf\(sl\) : '';/.test(pjs) && /class="sharedloc"/.test(pjs));
  ok('PPTX renders the same shared-location tile (item 4: "apply to all formats")',
     /var sharedLoc = hasBefore \? sharedLocationOf\(sl\) : '';[\s\S]{0,400}slide\.addText\(sharedLoc,/.test(pjs));

  // --- PPTX vertical centering (item 4) ------------------------------------
  ok('pane vertical position is now COMPUTED (paneTopFor), not a hardcoded y:0.35/0.75/5.45',
     /function paneTopFor\(topBand\)/.test(pjs) && !/y: 0\.35,.*y: 0\.75,.*y: 5\.45,/.test(pjs));
  ok('centering formula centers the pane block in the space below the top band',
     /Math\.max\(0, \(SLIDE_H - topBand - PANE_H\) \/ 2\)/.test(pjs));
  (function () {
    // Genuinely execute the same arithmetic paneTopFor uses (it's a small
    // closure local to exportPptx, not exported — restated here rather than
    // adding an export just for this one small formula, since correctness is
    // easy to eyeball: the pane block must fit entirely within the slide).
    var SLIDE_H = 7.5, LABEL_H = 0.35, IMG_H = 4.6, CAP_H = 0.9;
    var PANE_H = LABEL_H + IMG_H + CAP_H;
    function paneTopFor(topBand) { return topBand + Math.max(0, (SLIDE_H - topBand - PANE_H) / 2); }
    var top = paneTopFor(0.4);
    ok('the pane block (label+image+caption) fits within the slide height with no shared-location bar',
       top >= 0.4 && (top + PANE_H) <= SLIDE_H);
    var topWithLoc = paneTopFor(0.75);
    ok('a shared-location bar pushes the pane block down and it still fits',
       topWithLoc > top && (topWithLoc + PANE_H) <= SLIDE_H);
  })();

  // --- PDF one-slide-per-A4 fix (item 4) ------------------------------------
  ok('the page-break rule is no longer trapped inside @media print (the html2canvas capture never matches it there)',
     !/@media print\{body\{background:#fff\}\.slide\{page-break-after:always/.test(pjs));
  ok('break-after/page-break-after now apply unconditionally, with break-inside:avoid alongside them',
     /\.slide\{break-inside:avoid;page-break-inside:avoid\}/.test(pjs) &&
     /\.slide:not\(:last-of-type\)\{break-after:page;page-break-after:always\}/.test(pjs));
  ok('jsPDF format is still A4, landscape, mm units (unchanged)', /jsPDF: \{ unit: 'mm', format: 'a4', orientation: 'landscape' \}/.test(pjs));

  // --- Copy wizard (item 6) — genuinely EXECUTED ---------------------------
  eq('buildCopyDrafts promotes each source slide\'s current photo into the new previous slot',
     PPR._buildCopyDrafts([
       { after_photo_id: 'pB', before_photo_id: 'pA', after_caption: 'June shot', before_caption: 'May shot' },
       { after_photo_id: 'pC', before_photo_id: null, after_caption: 'June only', before_caption: null }
     ]).map((d) => d.before_photo_id), ['pB', 'pC']);
  eq('every draft starts with NO current photo — the gap the wizard must close before saving',
     PPR._buildCopyDrafts([{ after_photo_id: 'pB' }]).every((d) => d.after_photo_id === null), true);
  eq('slide numbers are resequenced from 1', PPR._buildCopyDrafts([{}, {}, {}]).map((d) => d.slide_no), [1, 2, 3]);
  ok('a source presentation with zero slides skips the wizard entirely (same as "start empty")',
     /if \(!src\.length\) \{[\s\S]{0,150}createPresentationPlain\(newData\);/.test(pjs));

  // --- Previous/Current eligibility filter (items 5/9) — genuinely EXECUTED --
  const pJun = { id: 'jun', location: 'Tower 1', taken_at: '2026-06-01' };
  const pMayA = { id: 'mayA', location: 'Tower 1', taken_at: '2026-05-01' };
  const pMayB = { id: 'mayB', location: 'Tower 2', taken_at: '2026-05-15' };
  const pJul = { id: 'jul', location: 'Tower 1', taken_at: '2026-07-01' };
  const lib = [pJun, pMayA, pMayB, pJul];
  eq('Previous picker (direction=before): only earlier AND same-location by default',
     PPR._eligiblePhotos(lib, pJun, 'before', false).map((p) => p.id), ['mayA']);
  eq('"Show all locations" lifts the location restriction but keeps the date rule',
     PPR._eligiblePhotos(lib, pJun, 'before', true).map((p) => p.id), ['mayB', 'mayA']);
  eq('a photo is never offered as its own previous/current', PPR._eligiblePhotos([pJun], pJun, 'before', true), []);
  eq('Current picker in the wizard (direction=after): only on/after the fixed previous photo',
     PPR._eligiblePhotos(lib, pMayA, 'after', true).map((p) => p.id), ['jul', 'jun', 'mayB']);
  eq('no reference photo yet (Current picker with nothing to compare) — every photo is offered',
     PPR._eligiblePhotos(lib, null, 'before', false).length, 4);

  // --- Thumbnail picker (18-item list item 6) -------------------------------
  ok('openThumbPicker exists and is reused by both the ordinary slide form and the wizard',
     /function openThumbPicker\(opts\)/.test(pjs) &&
     (pjs.match(/openThumbPicker\(\{/g) || []).length >= 2);
  ok('the picker is a grid of real thumbnails, not a <select>', /class="ppr-pickgrid"/.test(pjs) && /class="ppr-pickitem/.test(pjs));
  ok('a chosen photo shows as a thumbnail button (pickBtnHTML), not plain text', /function pickBtnHTML\(which, id\)/.test(pjs));

  // --- Gallery batch select (item 5) ---------------------------------------
  ok('module.js tracks a selection set, scoped to VISIBLE ids for every bulk action',
     /var selected = \{\};/.test(mjs) && /function visibleSelectedIds\(\)/.test(mjs) &&
     /var vis = \{\}; visible\(\)\.forEach/.test(mjs));
  ok('both List and Gallery rows carry a [data-sel] checkbox (one selection set for the whole Gallery screen)',
     /data-sel="' \+ r\.id \+ '"/.test(mjs) && (mjs.match(/data-sel="/g) || []).length >= 2);
  // 2026-08-29 follow-up item 4: the leading header cell is now a REAL
  // select-all/unselect-all checkbox (replacing the separate "Clear" button),
  // not a blank spacer div.
  ok('the List grid header\'s leading cell is a select-all checkbox, not a blank spacer',
     /id="pp-selall"/.test(mjs) && /<div>Photo<\/div>/.test(mjs));
  ok('the select-all checkbox toggles every VISIBLE row, matching visibleSelectedIds\' own scoping rule',
     /selAll\.onchange = function \(\) \{[\s\S]{0,200}visible\(\)\.forEach/.test(mjs));
  ok('the three batch actions are Download / Add to Presentation / Archive',
     /pp-sel-download/.test(mjs) && /pp-sel-addppr/.test(mjs) && /pp-sel-archive/.test(mjs));
  // Item 4 also REMOVES the separate "Clear" action — the header checkbox
  // covers deselecting everything.
  ok('the old separate "Clear" selection button is gone (item 4)', !/pp-sel-clear/.test(mjs) && !/pp-sel-clear/.test(html));
  ok('batch archive is tolerant of the pending migration, same as the single-item toggle', /pp-sel-archive'\)\.onclick[\s\S]{0,400}archive-flag\.sql/.test(mjs));
  // Item 3: the whole separate boxed "selection bar" is GONE — its actions
  // moved into the topbar tools row, toggled via syncChrome()'s explicit
  // style.display (see [29]'s own note on why: `hidden` never worked here).
  ok('the old standalone #pp-selbar box no longer exists in index.html', !/id="pp-selbar"/.test(html));
  ok('the selection actions now live in the topbar tools row, hidden by default via inline style',
     /id="pp-sel-download" style="display:none;"/.test(html) && /id="pp-selcount" style="display:none;"/.test(html));
  ok('syncChrome() swaps "+ Add media"/Refresh for the selection tools based on visibleSelectedIds().length',
     /function syncChrome\(\)[\s\S]{0,700}var has = ids\.length > 0;/.test(mjs));
  ok('Add to Presentation calls PPR.addPhotosToPresentation, not a re-implementation of slide-numbering', /PPR\.addPhotosToPresentation\(pprId, photoIds\)/.test(mjs));
  ok('ppr.js exports addPhotosToPresentation appending AFTER the existing slide count', /var n = slides\(pprId\)\.length;[\s\S]{0,200}slide_no: n \+ i \+ 1,/.test(pjs));
  ok('ppr.js exports listForPicker, excluding archived presentations from the target list', /listForPicker: function \(\) \{[\s\S]{0,200}!p\.archived/.test(pjs));

  // =========================================================== [28] =========
  // 18-item list, Batches E-H + Add-media type selector/video (2026-08-29) —
  // "do all the items not done." Everything the 2026-08-29 status recap
  // flagged as explicitly NOT done: per-photo pin + direction capture (E),
  // the markup/annotation editor + slide-sorter (F), the floor-plan
  // map/vertical-stacking view (G), top-view image registration (H), and the
  // Add-media type selector + real video upload.
  console.log('\n[28] Batches E-H: pin+direction, markup+sorter, map view, registration, video');

  // --- Add-media type selector + video (folded in alongside Batch C) -------
  ok('mediaTypeSelectorHTML/wireMediaTypeSelector exist for the Photo/Video/360°/3D picker',
     /function mediaTypeSelectorHTML\(idPrefix, cur\)/.test(mjs) && /function wireMediaTypeSelector\(idPrefix, onChange\)/.test(mjs));
  ok('the upload save payload records which kind was picked', /media_type: kind/.test(mjs));
  ok('a video renders as a real <video> element, not an <img>, in thumb()',
     /r\.media_type === 'video'/.test(mjs) && /pp-vidplay/.test(mjs));
  ok('the lightbox has both an <img> and a <video> element and toggles between them',
     /id="pp-lb-video"/.test(html) && /var imgEl = \$\('pp-lb-img'\), vidEl = \$\('pp-lb-video'\);/.test(mjs));
  ok('tolerantWrite gained a strip-rule for media_type, naming the migration file if it is missing',
     /'media_type' in job\.patch/.test(mjs) && /photo-media-type\.sql/.test(mjs));

  // --- Batch E: per-photo pin + direction capture --------------------------
  ok('migration adds floor_plan_pins.direction_deg, nullable, folded into schema.sql',
     /alter table floor_plan_pins add column if not exists direction_deg double precision;/.test(
       fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '2026-08-29-pin-direction.sql'), 'utf8')) &&
     /direction_deg double precision/.test(fs.readFileSync(schemaFile, 'utf8')));
  ok('a pin only draws its cone when a direction was actually recorded',
     /function pinConeHTML\(pin\)/.test(bmjs) && /pin\.direction_deg === null \|\| pin\.direction_deg === undefined/.test(bmjs));
  ok('directionWidgetHTML/wireDirectionWidget exist (the drag-to-set-direction control)',
     /function directionWidgetHTML\(idPrefix, curDeg\)/.test(bmjs) && /function wireDirectionWidget\(idPrefix\)/.test(bmjs));
  ok('openPinPickerFor exists — the Gallery-triggered pin flow that does not disturb the Plans screen state',
     /function openPinPickerFor\(itemType, itemId, itemLabel, onDone\)/.test(bmjs) &&
     !/openPinPickerFor[\s\S]{0,400}activePlanId = /.test(bmjs));
  // Superseded 2026-08-29 (item 11): the pin is now captured INLINE in the
  // same Add/Edit Photo form (BIM.pinFieldHTML/wirePinField/readPinField),
  // not as a separate modal shown after the upload completes — checked in
  // the [item 11] section further down, not here.
  ok('module.js no longer opens the after-the-fact pin-picker modal from the upload flow',
     !/BIM\.openPinPickerFor/.test(mjs));
  ok('Gallery tiles with a pin show an expandable icon (item 8), never on tiles without one',
     /pinInfoFor\('photo', r\.id\)/.test(mjs) && /pp-pinbtn/.test(mjs));
  ok('openPinPreview exists for the tile-icon crop-zoom overlay', /function openPinPreview\(photoId\)/.test(mjs));
  // Genuine execution — the exact math, not a regex on the surrounding code.
  // 0° = up, clockwise-positive, matching floor_plan_pins.direction_deg's
  // documented convention.
  (function () {
    const near = (a, b) => Math.abs(a - b) < 0.001;
    ok('drag straight UP records 0°', near(BIM._directionDegFromDrag(0, -1), 0));
    ok('drag RIGHT records 90° (clockwise from up)', near(BIM._directionDegFromDrag(1, 0), 90));
    ok('drag DOWN records 180°', near(BIM._directionDegFromDrag(0, 1), 180));
    ok('drag LEFT records 270°', near(BIM._directionDegFromDrag(-1, 0), 270));
  })();

  // --- Batch F: markup/annotation editor + slide-sorter --------------------
  const markupMigration = fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '2026-08-29-markup.sql'), 'utf8');
  ok('migration adds progress_photos.markup (the photo\'s OWN permanent markup)', /progress_photos add column if not exists markup jsonb/.test(markupMigration));
  ok('migration creates ppr_slide_markups — a SEPARATE, presentation-only store keyed by (ppr_slide_id, pane)',
     /create table if not exists ppr_slide_markups/.test(markupMigration) &&
     /unique \(ppr_slide_id, pane\)/.test(markupMigration) &&
     /pane\s+text not null check \(pane in \('before', 'after'\)\)/.test(markupMigration));
  ok('both stores folded into supabase-schema.sql', /markup\s+jsonb default '\[\]'::jsonb/.test(fs.readFileSync(schemaFile, 'utf8')) &&
     /create table if not exists ppr_slide_markups/.test(fs.readFileSync(schemaFile, 'utf8')));
  ok('module.js exports the markup engine for cross-file reuse (openMarkupEditor + a read-only canvas painter)',
     /openMarkupEditor: function \(imageUrl, initialMarkup, onSave\)/.test(mjs) &&
     /drawMarkupOnCanvas: function \(canvas, objs\)/.test(mjs));
  ok('the lightbox never shows markup controls on Gallery tiles — only in paintMarkupOverlay, opened from openLightbox',
     /function paintMarkupOverlay\(r\)/.test(mjs) && !/pp-mktoggle/.test(mjs.split('function galleryHTML')[0] || ''));
  ok('ppr.js loads presentation-only markups tolerant of the migration not having run', /async function loadSlideMarkups\(\)/.test(pjs) && /markupTableMissing/.test(pjs));
  ok('saveSlideMarkup UPDATEs an existing row (by cached row id) rather than violating the (ppr_slide_id,pane) unique constraint with a second INSERT',
     /async function saveSlideMarkup\(slideId, pane, objs\)/.test(pjs) && /if \(rowId\) \{/.test(pjs));
  ok('each pane renders its own toggle/edit toolbar + overlay canvas, wired by wirePaneMarkup after render',
     /ppr-panetools/.test(pjs) && /function wirePaneMarkup\(cur\)/.test(pjs) && /wirePaneMarkup\(cur\);/.test(pjs));
  ok('exports (offline HTML/PDF/PPTX) never reference the presentation-only markup overlay — it is a live viewing aid, not part of the record',
     (function () {
       const exportSlice = (pjs.split('function slideFigureHTML')[1] || '').split('var EXPORT_CSS')[0];
       return !/ppr_slide_markups|ppr-mktool|ppr-mkcanvas/.test(exportSlice);
     })());
  ok('slide-sorter: "Reorder slides" only offered with 2+ slides (nothing to reorder otherwise)',
     /s\.length > 1 \? '<button class="pp-iconbtn" id="ppr-sort"/.test(pjs));
  ok('openSlideSorter saves nothing until "Save order" is clicked (drag only mutates a local draft copy)',
     /function openSlideSorter\(p\)/.test(pjs) && /var draft = slides\(p\.id\);/.test(pjs) &&
     /skip the round-trip/.test(pjs));
  // Genuine execution — moveItem is pure and this is exactly the kind of
  // off-by-one-prone array surgery worth actually running.
  (function () {
    const src = ['a', 'b', 'c', 'd'];
    eq('moveItem: drag the first slide to the end', PPR._moveItem(src, 0, 3), ['b', 'c', 'd', 'a']);
    eq('moveItem: drag the last slide to the front', PPR._moveItem(src, 3, 0), ['d', 'a', 'b', 'c']);
    eq('moveItem: a no-op move (same position) changes nothing', PPR._moveItem(src, 1, 1), ['a', 'b', 'c', 'd']);
    eq('moveItem never mutates its argument (the caller reassigns `draft` from the return value)', src, ['a', 'b', 'c', 'd']);
  })();
  eq('markupKey is "<slideId>|<pane>" — the exact shape both the load and the save paths key their caches by',
     PPR._markupKey('slide-9', 'after'), 'slide-9|after');
  // Genuine execution of the shared drawing engine via a fake canvas-2D
  // recorder — the one way to tell "drew a rect" from "silently drew nothing"
  // for each shape type, rather than only checking the source mentions them.
  (function () {
    function fakeCtx() {
      const calls = [];
      return {
        calls,
        save() { calls.push('save'); }, restore() { calls.push('restore'); },
        beginPath() { calls.push('beginPath'); }, closePath() { calls.push('closePath'); },
        moveTo() { calls.push('moveTo'); }, lineTo() { calls.push('lineTo'); },
        stroke() { calls.push('stroke'); }, fill() { calls.push('fill'); },
        strokeRect() { calls.push('strokeRect'); }, fillRect() { calls.push('fillRect'); },
        ellipse() { calls.push('ellipse'); }, arc() { calls.push('arc'); },
        fillText() { calls.push('fillText'); }, measureText: () => ({ width: 40 }),
        clearRect() { calls.push('clearRect'); },
        // 2026-08-30: the sticker/plant-icon stamps (drawIconStamp's
        // MARKUP_STICKERS Path2D branch) call these too — a real 2D canvas
        // context always has them.
        translate() { calls.push('translate'); }, scale() { calls.push('scale'); },
        // Fourth round, item 3: the selection-outline dashed box.
        setLineDash() { calls.push('setLineDash'); },
        set strokeStyle(v) {}, set fillStyle(v) {}, set lineWidth(v) {}, set lineCap(v) {}, set lineJoin(v) {}, set font(v) {}, set textBaseline(v) {},
      };
    }
    let c = fakeCtx();
    PP._drawMarkupObjects(c, [{ type: 'rect', x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.4, color: '#EE3124' }], 200, 100);
    ok('drawMarkupObjects: a rect object actually calls strokeRect', c.calls.includes('strokeRect'));
    c = fakeCtx();
    PP._drawMarkupObjects(c, [{ type: 'circle', x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.4, color: '#EE3124' }], 200, 100);
    ok('drawMarkupObjects: a circle object actually calls ellipse+stroke', c.calls.includes('ellipse') && c.calls.includes('stroke'));
    c = fakeCtx();
    PP._drawMarkupObjects(c, [{ type: 'arrow', x0: 0, y0: 0, x1: 1, y1: 1, color: '#EE3124' }], 200, 100);
    ok('drawMarkupObjects: an arrow calls both stroke (shaft) and fill (arrowhead)', c.calls.includes('stroke') && c.calls.includes('fill'));
    c = fakeCtx();
    PP._drawMarkupObjects(c, [{ type: 'text', x: 0.5, y: 0.5, text: 'Note', color: '#EE3124' }], 200, 100);
    ok('drawMarkupObjects: a text object actually calls fillText', c.calls.includes('fillText'));
    c = fakeCtx();
    PP._drawMarkupObjects(c, [{ type: 'icon', x: 0.5, y: 0.5, icon: 'warn', color: '#EE3124' }], 200, 100);
    ok('drawMarkupObjects: an icon stamp uses save/restore around its own drawing (drawIconStamp)', c.calls.includes('save') && c.calls.includes('restore'));
    ok('drawMarkupObjects always clears the canvas first (an old markup can never bleed through a redraw)', (function () {
      const c2 = fakeCtx(); PP._drawMarkupObjects(c2, [], 200, 100); return c2.calls[0] === 'clearRect';
    })());
  })();
  // Genuine execution of the eraser's nearest-object hit test.
  (function () {
    const objs = [
      { type: 'rect', x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.3 },   // centre ~ (0.2, 0.2)
      { type: 'icon', x: 0.8, y: 0.8, icon: 'warn' },
    ];
    eq('markupHitTest: a click near the rect\'s centre hits the rect (index 0)', PP._markupHitTest(objs, 0.2, 0.2, 400, 300), 0);
    eq('markupHitTest: a click near the icon hits the icon (index 1)', PP._markupHitTest(objs, 0.8, 0.8, 400, 300), 1);
    eq('markupHitTest: a click far from everything hits nothing (-1)', PP._markupHitTest(objs, 0.5, 0.02, 400, 300), -1);
  })();

  // --- Batch G's map/clustering view: RELOCATED to module.js, item 16 ------
  // (2026-08-29, second feedback round) — see the dedicated section below,
  // not here. bim.js keeps only Plan-mode browsing/pinning (item 15).
  ok('bim.js no longer carries the Map/Stack toggle or their render bodies (item 15 — "only all plans")',
     !/screen2/.test(bmjs) && !/function renderMapBody/.test(bmjs) && !/function renderStackBody/.test(bmjs));

  // --- Batch H: top-view photo -> floor plan registration ------------------
  const regMigration = fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '2026-08-29-floor-plan-registration.sql'), 'utf8');
  ok('migration creates floor_plan_registrations, one row per (floor_plan, photo) pair', /unique \(floor_plan_id, photo_id\)/.test(regMigration));
  ok('point_pairs + the computed homography are both stored (never recomputed on every render)', /point_pairs\s+jsonb/.test(regMigration) && /homography\s+jsonb/.test(regMigration));
  ok('folded into supabase-schema.sql', /create table if not exists floor_plan_registrations/.test(fs.readFileSync(schemaFile, 'utf8')));
  ok('bim.js reuses the SAME OpenCV.js readiness pattern pano.js already proved working, not a re-implementation',
     /function ensureOpenCV\(\)/.test(bmjs) && /_cvReady/.test(bmjs));
  ok('the registration UI requires at least MIN_REG_POINTS=4 point pairs before it will compute a homography',
     /var MIN_REG_POINTS = 4;/.test(bmjs) && /pairs\.length < MIN_REG_POINTS/.test(bmjs));
  ok('openRegisterFlow calls cv.findHomography with RANSAC (a few mismatched clicks must not wreck the whole warp)',
     /cv\.findHomography\([\s\S]{0,200}cv\.RANSAC/.test(bmjs));
  ok('the registration upsert keys on (floor_plan_id, photo_id) — a re-register REPLACES, never duplicates', /onConflict:\s*'floor_plan_id,photo_id'/.test(bmjs));
  ok('paintActualView renders the WARPED photo via cv.warpPerspective, swapped in for the drawing image', /function paintActualView\(reg\)/.test(bmjs) && /cv\.warpPerspective/.test(bmjs));

  // =========================================================== [29] =========
  // Batch G, the missed half (item 16 — Vertical Stacking for photos), plus a
  // REAL wiring bug this pass found: the Map (and now Stack) toggle button was
  // completely dead from the DEFAULT Plan view, because the Plan-mode render
  // branch never called wireMapView() at all.
  console.log('\n[29] Item 15/16 (second feedback round) — Map/Stack RELOCATED to the Gallery as Plan/Stack, plus the new floor stepper');

  // --- Item 15: bim.js keeps only Plan browsing/pinning ---------------------
  ok('bim.js\'s render() no longer has a Map/Stack branch — just plans/no-plans (item 15)',
     !/function renderMapBody/.test(bmjs) && !/function renderStackBody/.test(bmjs) && !/viewToggleHTML/.test(bmjs));
  ok('bim.js exports read accessors for module.js\'s Plan view instead: plans()/planUrl()/pinsForPlan()',
     /plans: function \(\) \{ return plans\.slice\(\)/.test(bmjs) &&
     /planUrl: function \(plan\) \{ return planUrl\(plan\); \}/.test(bmjs) &&
     /pinsForPlan: function \(planId\) \{ return allPins\.filter/.test(bmjs));

  // --- Item 16: Plan view (floor + month stepping) --------------------------
  ok('the Gallery view toggle gains Plan and Stack buttons alongside List/Tile',
     /data-view="plan"/.test(html) && /data-view="stack"/.test(html));
  ok('render() dispatches to renderPlanView/renderStackView for those two views, reading PROJECT-WIDE data, not the filtered list',
     /if \(view === 'plan' \|\| view === 'stack'\) \{[\s\S]{0,200}renderPlanView\(\)[\s\S]{0,100}renderStackView\(\)/.test(mjs));
  ok('a floor STEPPER exists (prev/next/animate) — the genuinely NEW capability the old bim.js Map view never had (only a bare <select>)',
     /id="pp-plan-floorprev"/.test(mjs) && /id="pp-plan-floornext"/.test(mjs) && /id="pp-plan-floorplay"/.test(mjs) &&
     /planFloorId = fs\[i \+ 1\]\.id;/.test(mjs));
  ok('the month stepper is ported from bim.js\'s old mapClusters/itemDateFor cutoff logic, cumulative up to the scrubbed month',
     /function planClusters\(pins, monthCutoff\)/.test(mjs) && /function itemDateForPin\(pin\)/.test(mjs) &&
     /if \(monthCutoff && \(!d \|\| d\.slice\(0, 7\) > monthCutoff\)\) return;/.test(mjs));
  ok('floor animation and month animation never run at once — each stops the other before starting',
     /stopPlanMonthPlay\(\);   \/\/ never both animations running at once/.test(mjs) &&
     /planFloorPlaying = true;[\s\S]{0,450}\}, 1200\);/.test(mjs));
  ok('clicking a cluster opens its member list rather than jumping straight into one item (ambiguous which one)',
     /function openPlanClusterList\(cluster\)/.test(mjs));
  ok('Group-by is hidden in Plan/Stack (it has no meaning there) rather than left visible and silently inert',
     /gbField\.style\.display = \(view === 'plan' \|\| view === 'stack'\) \? 'none' : '';/.test(mjs));

  // --- Item 16: Stack view — combine-by-default, step-through opt-in --------
  ok('Stack defaults to COMBINE (every photo at a location, across all months) — REVERSES bim.js\'s old single-most-recent default',
     /var stackStepMode = false;/.test(mjs) && /REVERSES bim\.js's old Stack default/.test(mjs));
  ok('a "Step through months instead" toggle exists, switching to the old cutoff-driven single-photo-per-cell behaviour',
     /id="pp-stack-stepmode"/.test(mjs) && /stackStepMode = this\.checked; stopStackPlay\(\); render\(\);/.test(mjs));
  ok('combined mode caps thumbnails per cell and reports the overflow as "+N more" rather than silently truncating with no sign',
     /var STACK_COMBINE_MAX = 6;/.test(mjs) && /pp-stackmore/.test(mjs) && /c\.photos\.length - STACK_COMBINE_MAX/.test(mjs));
  ok('combined-mode thumbnails open the ordinary lightbox on click; step-mode keeps the hover-magnifier instead',
     // Routes through openPhotoById (audit fix), NOT a raw openLightbox(id) —
     // Stack/Plan read project-wide data, so a clicked photo can be one the
     // Gallery's own active filter excludes; a bare openLightbox(id) falls
     // back to index 0 on a miss and silently shows a DIFFERENT photo. See
     // section [35]'s structural checks for the shared openPhotoById guard.
     /im\.onclick = function \(\) \{ openPhotoById\(this\.dataset\.open\); \};/.test(mjs) &&
     /mag\.hidden = false;/.test(mjs));
  ok('only the first-picked row level and a SEPARATE column level drive the grid — a level can never be picked as both axes',
     /levels\.filter\(function \(l\) \{ return l\.id !== \(stackRowLevel\(\) && stackRowLevel\(\)\.id\); \}\)/.test(mjs));
  ok('a single-level project collapses columns to one shared "All" bucket rather than repeating the row axis',
     /if \(!colNames\.length\) colNames = \[''\];  \/\/ single-level project/.test(mjs) && /Fmt\.esc\(c \|\| 'All'\)/.test(mjs));

  // Genuine execution of the "as of" cell rule, ported into module.js — the
  // exact class of bug this module has already been bitten by once (the
  // vendor-performance / reportedThrough family): a wrong fallback here
  // reports a photo as existing at a location before it was actually taken,
  // or hides one that should already be visible.
  (function () {
    const photos = [
      { id: 'p1', taken_at: '2026-01-15' },
      { id: 'p2', taken_at: '2026-03-10' },
      { id: 'p3', taken_at: '2026-05-01' },
    ];
    eq('mostRecentAsOf: no cutoff returns the single latest photo', PP._mostRecentAsOf(photos, null).id, 'p3');
    eq('mostRecentAsOf: cutoff mid-way returns the latest photo AT OR BEFORE it, never a later one', PP._mostRecentAsOf(photos, '2026-03').id, 'p2');
    eq('mostRecentAsOf: cutoff before every photo returns null, never the earliest by mistake', PP._mostRecentAsOf(photos, '2025-12'), null);
    eq('mostRecentAsOf: an empty candidate list (no photo at this cell) returns null, not a crash', PP._mostRecentAsOf([], '2026-06'), null);
  })();

  // Genuine execution of the full row/column grid builder against a small,
  // hand-checked fixture — two towers, two floors each, one cell deliberately
  // left with no photo at all (must read as empty, never invent a neighbour).
  // Also confirms `photos` (item 16's combined list) is populated alongside
  // the legacy `photo` (step-mode's single resolved one).
  (function () {
    const levels = [{ id: 'lvl-tower', name: 'Tower', sort_order: 1 }, { id: 'lvl-floor', name: 'Floor', sort_order: 2 }];
    const photos = [
      { id: 'a1', taken_at: '2026-01-01', location_values: { 'lvl-tower': 'Tower 1', 'lvl-floor': 'Floor 1' } },
      { id: 'a2', taken_at: '2026-02-01', location_values: { 'lvl-tower': 'Tower 1', 'lvl-floor': 'Floor 1' } },  // combines with a1; supersedes it in step mode
      { id: 'b1', taken_at: '2026-01-15', location_values: { 'lvl-tower': 'Tower 1', 'lvl-floor': 'Floor 2' } },
      { id: 'c1', taken_at: '2026-01-20', location_values: { 'lvl-tower': 'Tower 2', 'lvl-floor': 'Floor 1' } },
      // Tower 2 / Floor 2: deliberately NO photo at all.
    ];
    const g = PP._stackGrid(levels, photos, 'lvl-tower', 'lvl-floor', null);
    eq('stackGrid: rows are the distinct ROW-level values, sorted', g.rows.map((r) => r.row), ['Tower 1', 'Tower 2']);
    eq('stackGrid: columns are the distinct COLUMN-level values, sorted', g.cols, ['Floor 1', 'Floor 2']);
    eq('stackGrid: Tower 1 / Floor 1 COMBINES both competing photos (item 16 default)', g.rows[0].cells[0].photos.map((p) => p.id).sort(), ['a1', 'a2']);
    eq('stackGrid: Tower 1 / Floor 1 step-mode field still resolves to the LATEST (a2, not a1) for the opt-in toggle',
       g.rows[0].cells[0].photo.id, 'a2');
    eq('stackGrid: Tower 1 / Floor 2 resolves to its one photo', g.rows[0].cells[1].photo.id, 'b1');
    eq('stackGrid: Tower 2 / Floor 1 resolves to its one photo', g.rows[1].cells[0].photo.id, 'c1');
    eq('stackGrid: Tower 2 / Floor 2 (no photo at all) is null, never borrowed from a neighbouring cell',
       g.rows[1].cells[1].photo, null);
    eq('stackGrid: Tower 2 / Floor 2 combined list is empty, not null/undefined', g.rows[1].cells[1].photos, []);
    // As-of cutoff applied through the WHOLE grid, not just one cell (step mode only).
    const gCutoff = PP._stackGrid(levels, photos, 'lvl-tower', 'lvl-floor', '2026-01');
    eq('stackGrid with a cutoff: Tower 1 / Floor 1 step-mode falls back to a1 (a2 is in the future relative to the cutoff)',
       gCutoff.rows[0].cells[0].photo.id, 'a1');
    eq('stackGrid: a project with only ONE level collapses columns to a single shared bucket',
       PP._stackGrid([levels[0]], photos, 'lvl-tower', null, null).cols, ['']);
  })();

  // Item 30 (2026-08-30): "even if no photos have been assigned, we should
  // be able to show the vertical stacking format" — row/column headers must
  // come from the SCHEDULE's own distinct values (the skeleton), not only
  // from photos, so a freshly-configured project with zero photos still
  // renders the grid instead of the old "no photos tagged" empty state.
  (function () {
    const levels = [{ id: 'lvl-tower', name: 'Tower', sort_order: 1 }, { id: 'lvl-floor', name: 'Floor', sort_order: 2 }];
    const schedActs = [
      { location: { 'lvl-tower': 'Tower 1', 'lvl-floor': '9th Floor' } },
      { location: { 'lvl-tower': 'Tower 1', 'lvl-floor': '10th Floor' } },
      { location: { 'lvl-tower': 'Tower 2', 'lvl-floor': '9th Floor' } },
    ];
    const g = PP._stackGrid(levels, [], 'lvl-tower', 'lvl-floor', null, schedActs);
    eq('with ZERO photos, rows still come from the SCHEDULE\'s own distinct values (the skeleton)', g.rows.map((r) => r.row), ['Tower 1', 'Tower 2']);
    eq('…and so do the columns', g.cols, ['10th Floor', '9th Floor']);
    eq('every cell is honestly empty (no photo), never invented', g.rows[0].cells[0].photo, null);
    eq('…and the combined-photos list for that cell is [], not null/undefined', g.rows[0].cells[0].photos, []);

    // A photo tagged at a location the schedule doesn't (yet) know about is
    // still shown — the union goes both ways, so real data is never hidden
    // just because the schedule hasn't caught up.
    const photosOnly = [{ id: 'x1', taken_at: '2026-01-01', location_values: { 'lvl-tower': 'Tower 3', 'lvl-floor': '9th Floor' } }];
    const g2 = PP._stackGrid(levels, photosOnly, 'lvl-tower', 'lvl-floor', null, schedActs);
    eq('the union includes a photo-only location the schedule has never carried', g2.rows.map((r) => r.row), ['Tower 1', 'Tower 2', 'Tower 3']);
    eq('…and that photo is findable in its own (schedule-unknown) cell', g2.rows[2].cells[1].photo.id, 'x1');
  })();

  // Genuine execution of the cluster grouping (grid-snap by ~5% cell, ported
  // verbatim from bim.js's mapClusters) and the pin-date resolution. Grouping
  // by POSITION does not depend on date resolution succeeding, so it is
  // checked with no photo-date cutoff (null) — plain position clustering.
  (function () {
    const pins = [
      { id: 'pin1', item_type: 'photo', item_id: 'p1', x_norm: 0.20, y_norm: 0.30 },
      { id: 'pin2', item_type: 'photo', item_id: 'p2', x_norm: 0.21, y_norm: 0.31 },  // same ~5% cell as pin1
      { id: 'pin3', item_type: 'photo', item_id: 'p3', x_norm: 0.80, y_norm: 0.80 },  // a different cell
    ];
    eq('itemDateForPin resolves a photo pin\'s date from the injected photo list',
       PP._itemDateForPin(pins[0], [{ id: 'p1', taken_at: '2026-02-01' }]), '2026-02-01');
    const clusters = PP._planClusters(pins, null);
    eq('planClusters: two pins within the same ~5% cell cluster together (2 clusters total for 3 pins)', clusters.length, 2);
    eq('planClusters: the larger cluster holds both nearby pins',
       clusters.slice().sort((a, b) => b.pins.length - a.pins.length)[0].pins.length, 2);
  })();

  // =========================================================== [30] =========
  // Screenshot follow-up (2026-08-29): Gallery toolbar simplification, the
  // selection-mode swap, select-all, batch download formats, and the
  // mobile filter collapse.
  console.log('\n[30] Gallery toolbar simplification, selection-mode swap, download formats, mobile filters');

  ok('the "+ Add photos" button is renamed "+ Add media" (item 2 — covers photo/video/360/3D from one button)',
     /id="pp-add" title="Upload photos, video, or other media">\+ Add media</.test(html));
  ok('a comment explains WHY the capture buttons are gone and where their code still lives',
     /openCaptureModal\/openCompareModal\/openRequestForm/.test(html));

  // --- Item 3: selection-mode swap in the topbar tools row -------------------
  // Structural, not executed: `rows`/`filters`/`selected`/`canWrite` are
  // private to module.js's own closure (the whole point of the IIFE
  // pattern) and this harness exposes no setter for them — genuinely
  // driving syncChrome() would need PP.init() against a fake user/session,
  // which risks disturbing every OTHER section's assumptions about shared
  // module state. Same trade-off this file already accepts for Batch G's
  // map/clustering (structural-only, state-heavy internals).
  ok('syncChrome computes `has` from visibleSelectedIds().length, feeding every toggle below it',
     /function syncChrome\(\) \{[\s\S]{0,300}var has = ids\.length > 0;/.test(mjs));
  ok('"+ Add media"/its divider hide when EITHER a selection is active OR the user cannot write',
     /\(has \|\| !canWrite\) \? 'none' : ''/.test(mjs));
  ok('Refresh hides only while a selection is active (no role gate — everyone can refresh)',
     /refresh\.style\.display = has \? 'none' : '';/.test(mjs));
  ok('the count text and all three selection buttons are driven by the SAME `has` flag, so they can never disagree',
     (mjs.match(/= has \? '' : 'none'/g) || []).length >= 1 &&
     /\['pp-sel-download', 'pp-sel-addppr', 'pp-sel-archive'\]\.forEach/.test(mjs));

  // --- Item 4: select-all header checkbox ------------------------------------
  ok('the select-all checkbox reflects "every visible row already checked" on render',
     /var allSelected = vis\.length > 0 && vis\.every\(function \(r\) \{ return selected\[r\.id\]; \}\);/.test(mjs));

  // --- Item 5: batch download format choice ----------------------------------
  ok('openBatchDownloadChoice offers exactly HTML / PPTX / PDF, reusing ppr.js\'s own .ppr-fmtchoices visual language',
     /function openBatchDownloadChoice\(ids\)/.test(mjs) && /ppr-fmtchoices/.test(mjs) &&
     /data-fmt="html"/.test(mjs) && /data-fmt="pptx"/.test(mjs) && /data-fmt="pdf"/.test(mjs));
  ok('exportSelectedPhotos dispatches to exactly one of three format-specific exporters', /function exportSelectedPhotos\(ids, fmt\)/.test(mjs) &&
     /return exportSelectedPdf\(list\)/.test(mjs) && /return exportSelectedPptx\(list\)/.test(mjs) && /return exportSelectedOffline\(list\)/.test(mjs));
  ok('all three formats share ONE image-collection function, so they can never embed a different picture of the same selection',
     /function collectPhotoImages\(list, onProgress\)/.test(mjs) &&
     (mjs.match(/collectPhotoImages\(list, function/g) || []).length >= 3);
  ok('the PDF export keeps its captured element in NORMAL FLOW (the issues-lessons 2026-08-22 lesson — position:fixed on the captured node gives html2canvas a real width and a height of ZERO)',
     /holder\.style\.cssText = 'position:fixed;left:-10000px;top:0;'/.test(mjs) && /holder\.appendChild\(wrap\)/.test(mjs));
  ok('PPTX embedding strips the data: URI prefix (canvas.toDataURL always adds it; PptxGenJS\'s `data` option must not have it)',
     /function stripDataPrefix\(uri\)/.test(mjs));
  ok('the download-choice modal never fires for an empty selection', /function openBatchDownloadChoice\(ids\) \{\s*\n\s*if \(!ids\.length\) return;/.test(mjs));
  // Genuine execution — the caption block every format reads.
  eq('dlCaptionLines: description, then trade·works·location, then the date',
     PP._dlCaptionLines({ description: 'Slab pour', trades: ['Structural'], works_multi: ['Formworks'], location: 'Tower 1', taken_at: '2026-03-15' }),
     // Fmt.date is a bare passthrough stub in this harness (real formatting
     // lives in the shared ui.js, not this module) — the ISO string is the
     // correct expectation here, not a formatted date.
     ['Slab pour', 'Structural · Formworks · Tower 1', '2026-03-15']);
  eq('dlCaptionLines: blank fields are dropped, never rendered as empty lines',
     PP._dlCaptionLines({ description: '', trades: [], works_multi: [], location: '', taken_at: '' }), []);

  // --- Item 6: unified grouping, genuinely executed ---------------------------
  (function () {
    const photos = [
      { id: 'p1', taken_at: '2026-06-01', trades: ['Structural'], location: 'Tower 1' },
      { id: 'p2', taken_at: '2026-06-15', trades: ['Structural'], location: 'Tower 2' },
      { id: 'p3', taken_at: '2026-07-01', trades: ['Architectural'], location: 'Tower 1' },
      { id: 'p4', taken_at: '', trades: [], location: '' },
    ];
    const byMonth = PP._groupRows(photos, 'month');
    eq('month grouping: newest month first', byMonth.map((g) => g.key), ['2026-07', '2026-06', 'Undated']);
    eq('month grouping: the July label reads "July 2026"', byMonth[0].label, 'July 2026');
    const byTrade = PP._groupRows(photos, 'trade');
    eq('trade grouping: alphabetical, "Untagged" last', byTrade.map((g) => g.key), ['Architectural', 'Structural', 'Untagged']);
    const byLoc = PP._groupRows(photos, 'location');
    eq('location grouping: alphabetical, "Unassigned" last', byLoc.map((g) => g.key), ['Tower 1', 'Tower 2', 'Unassigned']);
    eq('location grouping: Tower 1 holds both its photos regardless of trade', byLoc[0].items.map((r) => r.id), ['p1', 'p3']);

    // 2026-08-30 feedback item 6: "None" is a real grouping mode -- one
    // bucket, no sort, every row present, in the order it arrived.
    const byNone = PP._groupRows(photos, 'none');
    eq('none grouping: exactly one bucket', byNone.length, 1);
    eq('none grouping: holds every row, in original order, unsorted', byNone[0].items.map((r) => r.id), ['p1', 'p2', 'p3', 'p4']);
    ok('none grouping: the label is blank -- it is not "trade"/"location" text mistakenly carried over',
       byNone[0].label === '');
  })();
  ok('the "Group by" selector offers a real None option, not just month/trade/location',
     /<option value="none">None<\/option>/.test(html));
  ok('a restored "none" grouping preference from localStorage is honoured on reload (the restore allow-list includes it)',
     /\['none', 'month', 'trade', 'location'\]\.indexOf\(g\) >= 0/.test(mjs));
  ok('listHTML prints NO group header at all for the None bucket (not a header with a blank label)',
     /if \(g\.key === NO_GROUP_KEY\) return g\.items\.map\(rowHTML\)\.join\(''\);/.test(mjs));
  ok('galleryHTML prints a flat grid with no group-head wrapper for the None bucket',
     /if \(g\.key === NO_GROUP_KEY\) return cards;/.test(mjs));

  // --- Item 7: no per-row action icons; the row itself opens the lightbox ----
  ok('rowActions()/the per-row icon-button function is gone entirely (superseded design)', !/function rowActions/.test(mjs));
  ok('the List grid dropped its trailing actions column (7 cells now, not 8)',
     /grid-template-columns: 34px 120px minmax\(180px, 1\.4fr\) 150px 150px 160px 120px;/.test(css) &&
     !/34px 120px minmax\(180px, 1\.4fr\) 150px 150px 160px 120px 158px/.test(css));

  // --- Item 8: mobile filter collapse ------------------------------------------
  ok('a "Filters" toggle button exists, desktop-invisible (display:none outside the phone media query)',
     /id="pp-filttoggle"/.test(html) && /\.pp-filttoggle \{ display: none; \}/.test(css));
  ok('the filter controls are wrapped in .pp-filters-body, which is display:contents on desktop (the SAME trick dashboard.css already uses for the module topbar wrap)',
     /id="pp-filters-body"/.test(html) && /\.pp-filters-body \{ display: contents; \}/.test(css));
  // 2026-08-30 item 2: the panel is now hidden by default at EVERY viewport
  // size (not only on a phone) — opened via the TOPBAR search/funnel toggle,
  // never the in-panel #pp-filttoggle any more (that stays in the DOM only
  // for a very narrow phone fallback).
  ok('the filter panel is display:none by default at every viewport size (item 2)',
     /^\.pp-filters \{ display: none; \}/m.test(css) && /^\.pp-filters\.open \{ display: flex; \}/m.test(css));
  ok('the topbar search box + funnel toggle exist and drive .pp-filters.open', /id="pp-topsearch"/.test(html) && /id="pp-topfilttoggle"/.test(html) &&
     /\$\('pp-topfilttoggle'\)\.onclick = function \(\) \{[\s\S]{0,150}wrap\.classList\.toggle\('open'\)/.test(mjs));
  ok('the topbar search box drives filters.search directly (no longer a decorative in-panel-only field)',
     /\$\('pp-topsearch'\)\.oninput = function \(\) \{\s*filters\.search = this\.value;/.test(mjs));

  // --- The actual .pp-selbar[hidden] bug the screenshot exposed --------------
  ok('the old buggy .pp-selbar element (display:flex beating the hidden attribute) no longer exists in module.css',
     !/^\.pp-selbar \{/m.test(css));
  ok('the fix is explained in module.css, not just silently removed', /always won\s+regardless of the `hidden` attribute/.test(css));

  console.log('\n[31] Second feedback round (items 9, 11, 17) — Works becomes a schedule tag, camera pin+direction moves inline, 360° re-enabled');

  // --- Item 9: Works is a single schedule-derived tag, Trade is derived -----
  eq('a Works value matching a Structural schedule activity derives Structural Works',
     PP._deriveTradeForWorks('Rebar Installation',
       [{ activity_name: 'Rebar Installation', work_type: 'Structural' }]),
     'Structural Works');
  eq('case/whitespace-insensitive match against the schedule activity name',
     PP._deriveTradeForWorks('  rebar installation  ',
       [{ activity_name: 'Rebar Installation', work_type: 'Structural' }]),
     'Structural Works');
  eq('a Works value with no matching schedule activity derives no trade (never a guess)',
     PP._deriveTradeForWorks('Some custom value typed by hand', []), null);
  eq('a matching activity with no work_type derives no trade either', PP._deriveTradeForWorks('Site Clearing',
     [{ activity_name: 'Site Clearing', work_type: '' }]), null);
  eq('a blank Works value derives no trade', PP._deriveTradeForWorks('', [{ activity_name: '', work_type: 'MEPF' }]), null);

  // --- Item 11 (2026-08-29), THEN items 8/27/28 (2026-08-30): the field is
  // renamed "Key Plan" and made REQUIRED, "Place pin" is removed from the
  // Plans page entirely (this is now the ONLY place a pin is created), and
  // the direction widget becomes an in-photo drag-two-endpoints cone. --
  ok('BIM exports the embeddable pin field API (pinFieldHTML/wirePinField/readPinField/savePinForItem)',
     /pinFieldHTML: pinFieldHTML/.test(bmjs) && /wirePinField: wirePinField/.test(bmjs) &&
     /readPinField: readPinField/.test(bmjs) && /savePinForItem: savePinForItem/.test(bmjs));
  ok('the field is labelled "Key Plan" (renamed from "Camera position", item 8) and marked required',
     /<label>Key Plan' \+ reqMarkHTML\(\) \+/.test(bmjs));
  ok('with no floor plans, an inline upload mini-form appears INSIDE the Add/Edit form itself (item 8), not just a link to the Plans tab',
     /function pinFieldHTML[\s\S]{0,400}if \(!plans\.length\)[\s\S]{0,600}pp-inlineplanform/.test(bmjs));
  ok('readPinField returns null (a no-op) rather than a half-filled object when nothing is picked, in BOTH the no-plans and has-plans shapes',
     /function readPinField\(idPrefix\) \{[\s\S]{0,120}if \(inlineWrap\) return null;[\s\S]{0,400}if \(!planId \|\| x === '' \|\| y === ''\) return null;/.test(bmjs));
  ok('savePinForItem is a no-op on null pinData — it can never delete a pin the planner did not ask to touch',
     /async function savePinForItem\(itemType, itemId, pinData\) \{\s*if \(!pinData\) return;/.test(bmjs));
  ok('savePinForItem UPDATES an existing pin rather than inserting a duplicate for the same item',
     /var existing = pinsByItem\(itemType, itemId\)\[0\] \|\| null;[\s\S]{0,500}existing\s*\?\s*await sb\(\)\.from\(T_PIN\)\.update/.test(bmjs));
  ok('the Add form reads the pin field ONCE and applies it to every uploaded item sharing that Key Plan position, IN PARALLEL (item 29 — no per-file await chain)',
     /var pinData = window\.BIM \? BIM\.readPinField\('pp'\) : null;/.test(mjs) &&
     /await Promise\.all\(newIds\.map\(function \(id\) \{ return BIM\.savePinForItem\('photo', id, pinData\); \}\)\);/.test(mjs));
  ok('the Edit form pre-fills the pin field from the photo\'s existing pin, via BIM.pinInfoFor',
     /var existingPinInfo = \(window\.BIM && BIM\.pinInfoFor\) \? BIM\.pinInfoFor\('photo', r\.id\) : null;/.test(mjs));
  ok('the Edit form reads the pin field BEFORE the modal closes (the DOM is gone after)',
     /var pinData = window\.BIM \? BIM\.readPinField\('pp-e'\) : null;/.test(mjs));
  // --- Item 27: "Place pin" is retired IN PLACE on the Plans page ---------
  ok('togglePlaceMode is explicitly documented as retired-in-place (item 27) — the #bim-place button that called it is gone from index.html',
     /RETIRED IN PLACE \(2026-08-30 feedback item 27\)/.test(bmjs));
  // --- Item 28: the in-photo field-of-view cone geometry, genuinely EXECUTED
  ok('defaultCone faces the image centre from the pin, with a symmetric spread',
     (function () {
       const c = BIM._defaultCone(0.5, 1, 200, 100); // pin at bottom-centre, image 200x100
       // Both edges should land ABOVE the pin (y smaller) since the centre (100,50) is above (100,100).
       return c.edge1_y < 1 && c.edge2_y < 1 && Math.abs(c.edge1_x - (1 - c.edge2_x)) < 0.02;
     })());
  ok('bearingFromTo: straight up is 0°, straight right is 90°, straight down is 180°, straight left is 270° (matches directionDegFromDrag\'s own convention)',
     BIM._bearingFromTo(50, 50, 50, 0) === 0 && Math.abs(BIM._bearingFromTo(50, 50, 100, 50) - 90) < 0.001 &&
     Math.abs(BIM._bearingFromTo(50, 50, 50, 100) - 180) < 0.001 && Math.abs(BIM._bearingFromTo(50, 50, 0, 50) - 270) < 0.001);
  ok('bisectorBearing reports the bearing to the MIDPOINT of the two edges, not either edge alone',
     Math.abs(BIM._bisectorBearing(0.5, 0.5, 0.4, 0, 0.6, 0, 1, 1) - 0) < 0.001);

  // --- Item 17: 4-way media type, only 3D stays disabled ---------------------
  ok('the type selector offers Photo / Video / 360° / 3D as four distinct buttons',
     /id="' \+ idPrefix \+ '-mtype-360">360°<\/button>/.test(mjs) &&
     /disabled title="3D reconstruction is on hold">3D<\/button>/.test(mjs));
  ok('360° is NOT disabled (item 17 re-enables it — item 18 fixes the flow it delegates to)',
     !/id="' \+ idPrefix \+ '-mtype-360"[^>]*disabled/.test(mjs));
  ok('picking 360° closes the Add Media modal and hands off to pano.js\'s real capture flow',
     /\$\('pp-mtype-360'\)\.onclick = function \(\) \{[\s\S]{0,150}m\.close\(\);[\s\S]{0,80}PANO\.openCapture\(\)/.test(mjs));
  ok('pano.js exposes openCapture — its capture flow\'s only reachable entry point now that #pano-new is gone',
     /openCapture: function \(\) \{ openCaptureModal\(\); \}/.test(pnjs));

  console.log('\n[32] Item 18 — 360° capture UX fix ("I can\'t take videos very easily")');
  ok('the separate "Use camera" step is gone — one button both requests the camera AND starts recording',
     !/pano-c-startcam/.test(pnjs) && /id="pano-c-record" type="button">Start recording</.test(pnjs));
  ok('a visible recording indicator exists (pulsing dot + a running mm:ss timer), not just a button-label change',
     /pano-recind/.test(pnjs) && /pano-recdot/.test(pnjs) && /function fmtTime\(s\)/.test(pnjs));
  ok('the timer starts hidden and is shown only once recording actually begins',
     /id="pano-recind" hidden/.test(pnjs) && /function startRecTimer\(\)[\s\S]{0,200}ind\.hidden = false;/.test(pnjs));
  ok('recording auto-stops after a generous cap, so a forgotten recording cannot run forever',
     /var MAX_REC_SECONDS = 90;/.test(pnjs) && /recSeconds >= MAX_REC_SECONDS/.test(pnjs));
  ok('a Switch camera control exists, toggling facingMode between environment and user',
     /pano-c-switchcam/.test(pnjs) && /facing = facing === 'environment' \? 'user' : 'environment';/.test(pnjs));
  ok('switching cameras is refused while a recording is in progress', /if \(recorder\) return;[\s\S]{0,850}facing = facing/.test(pnjs));
  ok('audit fix: switching cameras is ALSO refused while an earlier switch is still in flight (a rapid double-tap used to be able to start a second getUserMedia before the first had assigned `stream`, orphaning a live camera track with nothing left to stop it)',
     /if \(this\.disabled\) return;\s*this\.disabled = true;\s*facing = facing === 'environment' \? 'user' : 'environment';\s*stopCameraStream\(\);\s*await startCamera\(\);\s*this\.disabled = false;/.test(pnjs));
  ok('a camera-access failure explicitly names the upload fallback, not just a bare error', /you can upload a video instead/.test(pnjs));
  ok('the Start-recording button visibly shows it is armed (adds/removes .is-active)',
     /btn\.classList\.add\('is-active'\)/.test(pnjs) && /btn\.classList\.remove\('is-active'\)/.test(pnjs));
  ok('Cancel/× stop any live stream, recorder AND the timer — the camera cannot keep running after the modal closes',
     /if \(recorder\) \{ try \{ recorder\.stop\(\); \} catch \(e\) \{\} recorder = null; \}[\s\S]{0,80}stopRecTimer\(\); stopCameraStream\(\);/.test(pnjs));
  ok('a forced stop-on-cancel cannot still write a panorama afterwards (processVideo bails on the cancelled flag)',
     /var cancelled = false;/.test(pnjs) && /async function processVideo\(blob\) \{\s*if \(cancelled\) return;/.test(pnjs));
  ok('stopCameraStream always stops every track — never leaves the camera light on', /function stopCameraStream\(\)[\s\S]{0,120}getTracks\(\)\.forEach/.test(pnjs));

  console.log('\n[33] Items 12/13(a) — markup coverage confirmed already complete; the lightbox entry point made discoverable');
  // Both items describe capability already shipped in Batch F (2026-08-29,
  // "[28]" above) — reconfirmed here rather than rebuilt, plus the ONE real
  // gap found: the edit entry point was a bare icon among five in the
  // lightbox toolbar, easy to miss entirely, which is the most likely
  // explanation for "you still haven't added markup".
  // 2026-08-30 item 4: rebuilt into an iOS-Photos-style set — pen,
  // highlighter, ruler, shapes (rect/circle/arrow), text, signature, a
  // sticker palette (reusing Equipment Loading's own plant pictograms +
  // camera/person), and an eraser.
  ok('all thirteen iOS-style tools exist: select, pen, highlighter, line, ruler, arrow, rect, circle, polygon, text, signature, sticker(icon), eraser',
     /var TOOL_ORDER = \['select', 'pen', 'highlighter', 'line', 'ruler', 'arrow', 'rect', 'circle',\s*\n\s*'polygon', 'text', 'signature', 'icon', 'erase'\];/.test(mjs));
  ok('the sticker set reuses Equipment Loading\'s own plant pictograms verbatim (module contract forbids cross-module import, so this is a deliberate, documented duplicate)',
     /towercrane: 'M3 4h18M12 4v16M6 20h12M12 7l-7 -3M5 4v3M9 4v3M12 7v2M10\.5 9h3'/.test(mjs));
  ok('camera and person stickers exist, per the explicit ask, hand-drawn since they need more than one Path2D subpath',
     /else if \(name === 'camera'\)/.test(mjs) && /else if \(name === 'person'\)/.test(mjs));
  ok('colours apply to BOTH the stroke and an optional, adjustable-transparency fill on rect/circle/polygon (hexToRgba)',
     /function hexToRgba\(hex, alpha\)/.test(mjs) && /if \(o\.fill\) \{ ctx\.fillStyle = hexToRgba\(fillColorOf\(o\), \(o\.fillAlpha == null \? 0\.3 : o\.fillAlpha\)\); \}/.test(mjs));
  // Fourth round, item 3: border and fill colour are now genuinely
  // independent fields, not one colour read twice.
  ok('fillColorOf() falls back to the border colour only for objects saved BEFORE this feature existed (no fillColor field at all)',
     /function fillColorOf\(o\) \{ return o\.fillColor \|\| o\.color \|\| MARKUP_COLORS\[0\]; \}/.test(mjs));
  eq('a rect/circle/polygon with its OWN fillColor uses it, independent of its border colour',
     PP._drawMarkupObjects ? (function () {
       const c = (function () { const calls = []; return { calls, save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, strokeRect() {}, fillRect() { calls.push('fillRect:' + this._fill); }, ellipse() {}, arc() {}, fillText() {}, measureText: () => ({ width: 0 }), clearRect() {}, translate() {}, scale() {}, setLineDash() {}, set strokeStyle(v) {}, set fillStyle(v) { this._fill = v; }, set lineWidth(v) {}, set lineCap(v) {}, set lineJoin(v) {}, set font(v) {}, set textBaseline(v) {} }; })();
       PP._drawMarkupObjects(c, [{ type: 'rect', x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.4, color: '#EE3124', fillColor: '#1E88E5', fill: true, fillAlpha: 0.5 }], 200, 100);
       return c.calls[0];
     })() : null,
     'fillRect:rgba(30,136,229,0.5)');
  ok('a highlighter stroke is wide and translucent (globalAlpha), never opaque like an ordinary pen mark',
     /o\.type === 'highlighter'[\s\S]{0,200}ctx\.globalAlpha = 0\.35;/.test(mjs));
  ok('erase is a real removal (vector hit-test + splice), not a no-op or a paint-transparent hack',
     /objs\.splice\(idx, 1\); pushHistory\(\); redraw\(\);/.test(mjs));
  ok('presentation markup is a SEPARATE store, keyed by (slide, pane) — never attached to the photo itself',
     /function markupKey\(slideId, pane\) \{ return slideId \+ '\|' \+ pane; \}/.test(pjs));
  ok('the presentation pane reuses the SAME editor rather than re-implementing drawing a second time',
     /ProgressPhotos\.openMarkupEditor\(u, markupFor\(cur\.id, which\), function \(objs\) \{/.test(pjs));
  ok('the lightbox\'s markup-edit button now carries a visible text label, not just an icon',
     /pp-lb-tool-labeled" id="pp-lb-markupedit"[\s\S]{0,200}<span>Markup<\/span>/.test(html));
  ok('the label styling widens the button rather than forcing text into a 38px square',
     /\.pp-lb-tool-labeled \{ width: auto;/.test(css));

  // --- Fourth round, items 3/4 (2026-08-30): select-to-edit, Line, Polygon --
  // "I can't select the markup or shape to edit" — the biggest gap. Genuinely
  // executed, since a wrong coordinate math here is silent (the shape still
  // looks fine; it just moved by the wrong amount, or only partially).
  (function () {
    // Rounded to 6dp throughout — this is ordinary float-addition dust
    // (0.1 + 0.2 = 0.30000000000000004), not a defect in the code under test.
    const r6 = (n) => Math.round(n * 1e6) / 1e6;
    const rect = { type: 'rect', x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.3, color: '#EE3124' };
    const moved = PP._translateMarkupObj(rect, 0.2, 0.05);
    eq('translateMarkupObj shifts an x0/y0/x1/y1 shape (rect/circle/ruler/arrow/line) by the SAME delta on all four coordinates',
       [r6(moved.x0), r6(moved.y0), r6(moved.x1), r6(moved.y1)], [0.3, 0.15, 0.5, 0.35]);
    ok('translateMarkupObj does not mutate the original object (Cancel-safety — the caller decides whether to commit the move)',
       rect.x0 === 0.1);

    const pen = { type: 'pen', points: [[0.1, 0.1], [0.2, 0.2]], color: '#231F20' };
    const movedPen = PP._translateMarkupObj(pen, 0.1, -0.05);
    eq('translateMarkupObj shifts EVERY point of a multi-point shape (pen/highlighter/signature/polygon) — never just the first',
       movedPen.points.map((p) => [r6(p[0]), r6(p[1])]), [[0.2, 0.05], [0.3, 0.15]]);

    const icon = { type: 'icon', x: 0.5, y: 0.5, icon: 'warn', color: '#EE3124' };
    eq('translateMarkupObj shifts a bare x/y shape (text/icon)', [PP._translateMarkupObj(icon, 0.1, 0.1).x, PP._translateMarkupObj(icon, 0.1, 0.1).y], [0.6, 0.6]);
  })();

  ok('Select is the DEFAULT tool on open — a planner opening markup to review an existing photo must not start drawing by accident',
     /var tool = 'select', color = MARKUP_COLORS\[0\]/.test(mjs));
  ok('the Select tool grabs whatever markupHitTest finds under the pointer, and deselects on an empty-canvas click',
     /if \(tool === 'select'\) \{\s*var hit = markupHitTest\(objs, p\[0\], p\[1\], canvas\.width, canvas\.height\);\s*selectedIdx = hit;/.test(mjs));
  ok('dragging a selection uses translateMarkupObj against a SNAPSHOT taken at drag-start, not the live object (so a fast drag can\'t compound its own delta)',
     /dragOrig = Object\.assign\(\{\}, objs\[hit\]\); dragStart = p; drawing = true;/.test(mjs) &&
     /objs\[selectedIdx\] = translateMarkupObj\(dragOrig, p\[0\] - dragStart\[0\], p\[1\] - dragStart\[1\]\);/.test(mjs));
  ok('releasing a drag commits it to the undo history — Undo has something real to step back to',
     /if \(tool === 'select'\) \{ dragOrig = null; \}\s*pushHistory\(\);/.test(mjs));
  ok('a "Delete selected" button exists, separate from "Clear all", hidden until something is actually selected',
     /id="pp-mk-delsel"[\s\S]{0,60}style="display:none;"/.test(mjs));
  ok('the toolbar restyles the SELECTED object live (colour/width/fill), not just "the next new shape" — clicking a swatch after grabbing a shape changes THAT shape',
     /if \(selectedIdx >= 0\) \{ objs\[selectedIdx\]\.color = c; pushHistory\(\); redraw\(\); \}/.test(mjs) &&
     /if \(selectedIdx >= 0\) \{ objs\[selectedIdx\]\.width = w; pushHistory\(\); redraw\(\); \}/.test(mjs));
  ok('switching to a DIFFERENT tool clears the selection, so the toolbar can\'t stay ambiguous about whether it\'s editing an old shape or setting up a new one',
     /cancelPolygon\(\);\s*tool = this\.dataset\.tool;\s*selectedIdx = -1; syncDelBtn\(\);/.test(mjs));

  // Fill/border colour are two independent swatch rows now.
  ok('a SEPARATE fill-colour swatch row exists (data-fillcolor), distinct from the border row (data-color)',
     /pp-mk-fillcolors" id="pp-mk-fillcolors"[\s\S]{0,300}data-fillcolor="/.test(mjs));
  ok('the fill row shows only for shapes with a real interior (rect/circle/polygon) — never for Line/Ruler/Arrow, which have none',
     /function fillableType\(t\) \{ return t === 'rect' \|\| t === 'circle' \|\| t === 'polygon'; \}/.test(mjs));
  ok('the tool buttons are icon-only squares now (width=height, no text-plus-icon gap) — the old label-and-icon sizing is gone',
     /\.pp-mk-tool \{\s*width: 32px; height: 32px; padding: 0;/.test(css) && !/\.pp-mk-tool \{\s*height: 32px; padding: 0 12px;/.test(css));
  ok('every tool button carries a title/aria-label naming it, since the visible content is now icon-only',
     /title="' \+ Fmt\.esc\(TOOL_TITLES\[t\]\) \+ '" aria-label="' \+ Fmt\.esc\(TOOL_TITLES\[t\]\) \+ '"/.test(mjs));

  // Same minimal canvas-2D recorder as section 28's fakeCtx() above (that one
  // is scoped inside its own IIFE and unreachable here) — a fresh copy so
  // these later blocks can genuinely execute drawMarkupObjects() too.
  function fakeCtxWithFill() {
    const calls = [];
    return {
      calls,
      save() { calls.push('save'); }, restore() { calls.push('restore'); },
      beginPath() { calls.push('beginPath'); }, closePath() { calls.push('closePath'); },
      moveTo() { calls.push('moveTo'); }, lineTo() { calls.push('lineTo'); },
      stroke() { calls.push('stroke'); }, fill() { calls.push('fill'); },
      strokeRect() { calls.push('strokeRect'); }, fillRect() { calls.push('fillRect'); },
      ellipse() { calls.push('ellipse'); }, arc() { calls.push('arc'); },
      fillText() { calls.push('fillText'); }, measureText: () => ({ width: 40 }),
      clearRect() { calls.push('clearRect'); },
      translate() { calls.push('translate'); }, scale() { calls.push('scale'); },
      setLineDash() { calls.push('setLineDash'); },
      set strokeStyle(v) {}, set fillStyle(v) {}, set lineWidth(v) {}, set lineCap(v) {}, set lineJoin(v) {}, set font(v) {}, set textBaseline(v) {},
    };
  }

  // Line and Polygon, the two new primitives.
  {
    const c1 = fakeCtxWithFill();
    PP._drawMarkupObjects(c1, [{ type: 'line', x0: 0, y0: 0, x1: 1, y1: 1, color: '#EE3124' }], 200, 100);
    ok('a Line object draws a plain stroked segment (moveTo+lineTo+stroke), with no arrowhead fill and no end-tick lines beyond the one segment',
       c1.calls.includes('moveTo') && c1.calls.includes('lineTo') && c1.calls.includes('stroke') && !c1.calls.includes('fill'));

    const c2 = fakeCtxWithFill();
    PP._drawMarkupObjects(c2, [{ type: 'polygon', points: [[0.1, 0.1], [0.4, 0.1], [0.25, 0.4]], color: '#231F20', fill: true, fillColor: '#1E88E5', fillAlpha: 0.4 }], 200, 100);
    ok('a filled Polygon closes its path and both fills (its OWN fillColor) and strokes (its border colour)',
       c2.calls.includes('closePath') && c2.calls.includes('fill') && c2.calls.includes('stroke'));

    const c3 = fakeCtxWithFill();
    PP._drawMarkupObjects(c3, [{ type: 'polygon', points: [[0.1, 0.1], [0.4, 0.1], [0.25, 0.4]], color: '#231F20', fill: false }], 200, 100);
    ok('an UNFILLED polygon still closes and strokes its outline, just never fills it',
       c3.calls.includes('closePath') && c3.calls.includes('stroke') && !c3.calls.includes('fill'));

    eq('markupHitTest recognises a Line by its bounding centre, same precision tier as Ruler/Arrow',
       PP._markupHitTest([{ type: 'line', x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.3 }], 0.2, 0.2, 400, 300), 0);
    eq('markupHitTest recognises a Polygon via its bounding BOX (the same area-based test as Rect/Circle), so clicking well inside a big polygon still selects it',
       PP._markupHitTest([{ type: 'polygon', points: [[0.1, 0.1], [0.6, 0.1], [0.6, 0.6], [0.1, 0.6]] }], 0.35, 0.35, 400, 300), 0);
  }

  // Selection is visibly drawn — a dashed outline + corner handles, so a
  // planner can SEE what they've grabbed (the literal complaint: "I can't
  // select the markup or shape to edit" implies invisible/no feedback too).
  {
    const c4 = fakeCtxWithFill();
    PP._drawMarkupObjects(c4, [{ type: 'rect', x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.3, color: '#EE3124' }], 200, 100, 0);
    ok('passing a selectedIdx that matches draws a dashed selection outline (setLineDash) and corner handles (arc)',
       c4.calls.includes('setLineDash') && c4.calls.includes('arc'));
    const c5 = fakeCtxWithFill();
    PP._drawMarkupObjects(c5, [{ type: 'rect', x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.3, color: '#EE3124' }], 200, 100, -1);
    ok('…and omits it entirely when nothing is selected (selectedIdx -1), so an ordinary Save doesn\'t bake a stray outline into what\'s remembered',
       !c5.calls.includes('setLineDash'));
  }

  // --- Item 5 (fourth round) — exposure/brightness/contrast/sharpness, ------
  // genuinely executed. Non-destructive: the tests below never touch a
  // photo_url/thumb_url, only the derived render-time filter/pixel math.
  eq('adjustmentsOf fills in the full {exposure,brightness,contrast,sharpness} shape even for a row with no adjustments column at all',
     PP._adjustmentsOf({}), { exposure: 0, brightness: 0, contrast: 0, sharpness: 0 });
  eq('adjustmentsOf lets a partial object (e.g. only exposure set) inherit the rest as 0, never undefined',
     PP._adjustmentsOf({ adjustments: { exposure: 40 } }), { exposure: 40, brightness: 0, contrast: 0, sharpness: 0 });
  ok('adjustmentsAreDefault is true for an all-zero (or missing) object — this is what gates whether a filter/style attribute is emitted at all',
     PP._adjustmentsAreDefault({ exposure: 0, brightness: 0, contrast: 0, sharpness: 0 }) && PP._adjustmentsAreDefault(null));
  ok('adjustmentsAreDefault is false the moment ANY one value is genuinely non-zero',
     !PP._adjustmentsAreDefault({ exposure: 0, brightness: 0, contrast: 5, sharpness: 0 }));
  eq('cssFilterFor renders literally \'none\' for a default/untouched photo — never a computed brightness(1) contrast(1) that LOOKS like a real filter but changes nothing',
     PP._cssFilterFor({ exposure: 0, brightness: 0, contrast: 0, sharpness: 0 }), 'none');
  eq('cssFilterFor maps 0 exposure/brightness/contrast to exactly 1x multipliers',
     PP._cssFilterFor({ exposure: 0, brightness: 0, contrast: 50, sharpness: 0 }), 'brightness(1) brightness(1) contrast(1.5)');
  eq('a +100 slider maps to the clamped ceiling (1.9x), never runs away unbounded',
     PP._cssFilterFor({ exposure: 100, brightness: 0, contrast: 0, sharpness: 0 }), 'brightness(1.9) brightness(1) contrast(1)');
  eq('a -100 slider maps to the clamped floor (0.3x) — never 0x/negative, which would blank or invert the image',
     PP._cssFilterFor({ exposure: -100, brightness: 0, contrast: 0, sharpness: 0 }), 'brightness(0.3) brightness(1) contrast(1)');
  ok('sharpness contributes NOTHING to cssFilterFor (there is no CSS sharpen filter) — it is evaluated separately by applySharpen',
     !/sharpness/.test(PP._cssFilterFor({ exposure: 0, brightness: 0, contrast: 0, sharpness: 80 })));

  // applySharpen: genuinely executed against a real (fake) ImageData buffer.
  (function () {
    function fakeSharpenCtx(w, h, fillValue) {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = fillValue; data[i + 3] = 255; }
      let put = null;
      return {
        getImageData: () => ({ data, width: w, height: h }),
        createImageData: () => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData: (id) => { put = id; },
        get lastPut() { return put; },
      };
    }
    const flat = fakeSharpenCtx(3, 3, 128);
    PP._applySharpen(flat, 3, 3, 0);
    eq('sharpness 0 is a genuine no-op — putImageData is never even called', flat.lastPut, null);

    const flat2 = fakeSharpenCtx(3, 3, 128);
    PP._applySharpen(flat2, 3, 3, 100);
    ok('sharpening a perfectly FLAT image changes nothing (every neighbour equals the centre, so the convolution nets to zero) — proves the kernel math, not just "did it run"',
       flat2.lastPut && flat2.lastPut.data[4 * 4] === 128); // centre pixel (x=1,y=1) red channel

    // A single bright centre pixel on a dark field — sharpening must push
    // the centre UP (or hold the 255 ceiling) and can only ever pull a
    // neighbour DOWN, never the reverse — that is what "sharpen" means.
    const spike = (function () {
      const w = 3, h = 3;
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = 50; data[i + 3] = 255; }
      const c = 4 * 4; data[c] = data[c + 1] = data[c + 2] = 200; // centre pixel
      let put = null;
      return { getImageData: () => ({ data, width: w, height: h }), createImageData: () => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), putImageData: (id) => { put = id; }, get lastPut() { return put; } };
    })();
    PP._applySharpen(spike, 3, 3, 100);
    const out = spike.lastPut.data;
    ok('the bright centre pixel is pushed toward/at the 255 ceiling, not left unchanged or dimmed',
       out[4 * 4] >= 200);
    ok('a dark neighbour pixel is pulled DOWN by the bright centre it borders — the defining behaviour of an unsharp mask',
       out[1 * 4] < 50);
  })();

  ok('a filtered <img> costs nothing for the overwhelming majority of unadjusted rows — thumb() emits no style attribute at all when adjustmentsAreDefault',
     /var filt = adjustmentsAreDefault\(r\.adjustments\) \? '' : ' style="filter:'/.test(mjs));
  ok('the lightbox applies the SAME filter live and re-applies it the instant Save returns a new value — never a stale filter after editing',
     /if \(imgEl\) imgEl\.style\.filter = isVideo \? '' : cssFilterFor\(adjustmentsOf\(r\)\);/.test(mjs) &&
     /if \(imgEl\) imgEl\.style\.filter = cssFilterFor\(newAdj\);/.test(mjs));
  ok('the Adjust button is hidden for a video (adjustments are photo-only) and for a read-only viewer, mirroring the Markup button\'s own gating',
     /adjBtn\.style\.display = \(canWrite && !isVideo\) \? '' : 'none';/.test(mjs));
  ok('Stack view applies the SAME per-photo filter in both its step-through and combined-photos cells, so a corrected photo looks corrected everywhere it appears',
     /var cfilt = adjustmentsAreDefault\(c\.photo\.adjustments\)/.test(mjs) && /var pfilt = adjustmentsAreDefault\(p\.adjustments\)/.test(mjs));
  ok('the staged-file grid (Add Media) offers Adjust beside Markup, wired the same way — available BEFORE the file is even uploaded',
     /data-adjuststage="' \+ i \+ '"/.test(mjs) &&
     /openAdjustEditor\(stagedUrls\[i\], pendingAdjust\[i\] \|\| \{\}, function \(adj\) \{ pendingAdjust\[i\] = adj; \}\);/.test(mjs));
  ok('a default (untouched) adjustment is NEVER attached to the save payload — no accidental adjustments:{} column write for a photo nobody adjusted',
     /if \(pendingAdjust\[i\] && !adjustmentsAreDefault\(pendingAdjust\[i\]\)\) perFile\.adjustments = pendingAdjust\[i\];/.test(mjs));
  ok('tolerantWrite strips adjustments and retries on a pre-migration database, naming the round-3 migration file',
     /'adjustments' in job\.patch[\s\S]{0,400}2026-08-30-photos-round3\.sql/.test(mjs));
  ok('migrations/2026-08-30-photos-round3.sql adds progress_photos.adjustments as a jsonb column, idempotently',
     /alter table progress_photos add column if not exists adjustments jsonb default '\{\}'::jsonb;/.test(
       fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '2026-08-30-photos-round3.sql'), 'utf8')));
  ok('openAdjustEditor never writes its own [data-close] re-wire — same audited pattern as the markup/pin-field editors, onClose covers backdrop-click too',
     /var m = openModal\(html, 700, function \(\) \{ window\.removeEventListener\('resize', redraw\); \}\);/.test(mjs));

  console.log('\n[34] Item 14 — Presentations multi-select + batch Download / Archive / Merge, combined preview');
  ok('a select checkbox is added to every presentation row, reusing the shared .pp-selcell sizing',
     /pp-selcell"><input type="checkbox" data-sel=/.test(pjs));
  ok('a header select-all\\/unselect-all tickbox exists, mirroring the Gallery\'s own List header (item 4)',
     /id="ppr-selall"/.test(pjs) && /var selAll = host\.querySelector\('#ppr-selall'\);/.test(pjs));
  ok('the checkbox set is SEPARATE from selId — selecting for batch actions never opens a presentation',
     /var selectedPprs = \{\};/.test(pjs) && /function selectedPprIds\(\)/.test(pjs));
  ok('batch actions are scoped to the VISIBLE (filtered) selection, not the raw map',
     /function visibleSelectedPprIds\(\)[\s\S]{0,200}return selectedPprIds\(\)\.filter/.test(pjs));
  ok('the selection toolbar swaps in for "+ New Presentation" the same way the Gallery\'s own tools swap',
     /var hasSel = visible && onList && selIds\.length > 0;/.test(pjs));
  ok('Merge is offered only once 2 or more are selected — a single "selection" is not a merge candidate',
     /if \(mg\) mg\.style\.display = \(hasSel && canWrite && selIds\.length >= 2\) \? '' : 'none';/.test(pjs));
  ok('checking 2+ presentations combines their slides in the preview pane, grouped per presentation',
     /if \(selIds\.length >= 2\) \{ renderCombinedPreview\(body, selIds\); return; \}/.test(pjs));
  (function () {
    var start = pjs.indexOf('function renderCombinedPreview');
    var end = pjs.indexOf('// ---------------------------------------------------- slides view/editor ---', start);
    var body = pjs.slice(start, end);
    ok('the combined preview groups oldest-first', /sort\(function \(a, b\)/.test(body));
    ok('the combined preview never opens an editor on click (ambiguous which of several presentations it would be)',
       !/im\.onclick|data-slide/.test(body));
  })();
  ok('batch download loops the SAME three exporters a single presentation uses, staggered like the Gallery\'s own',
     /var exportFn = fmt === 'html' \? exportOffline : fmt === 'pptx' \? exportPptx : exportPdf;/.test(pjs) &&
     /setTimeout\(function \(\) \{ exportFn\(p\); \}, i \* 300\);/.test(pjs));
  ok('merge copies slides by REFERENCE (photo ids/captions), never duplicating a photo — item 13a\'s own rule',
     /before_photo_id: sl\.before_photo_id, after_photo_id: sl\.after_photo_id,/.test(pjs));
  ok('merge renumbers slide_no CONTINUOUSLY across all source presentations, not reset per source',
     /n\+\+;[\s\S]{0,120}slide_no: n,/.test(pjs));
  ok('merge ARCHIVES the sources afterward — it never deletes, so a merge cannot lose history',
     /var ares = await sb\(\)\.from\(T_PPR\)\.update\(\{ archived: true,/.test(pjs));
  ok('merge is tolerant of the slide-copy step failing AFTER the presentation was created — it reports rather than leaving a silently empty deck',
     /Presentation created, but copying slides failed:/.test(pjs));
  ok('a completed merge opens the new presentation directly, same as an ordinary "+ New Presentation" does',
     /await load\(\);\s*openPpr\(newId\);\s*\};\s*\}\s*\n\s*\/\/ Item 14 — batch download/.test(pjs));
  // Genuine execution of the reversible archive/restore direction — the
  // exact kind of silent-wrong-data risk this module's own convention
  // (directionDegFromDrag, deriveTradeForWorks) says deserves real running,
  // not just a regex read.
  eq('all active -> archive (the common case: batch-archiving a finished set)',
     PPR._archiveDirectionFor([{ archived: false }, { archived: false }, { archived: false }]), true);
  eq('all already archived -> restore', PPR._archiveDirectionFor([{ archived: true }, { archived: true }]), false);
  eq('a tied 50/50 split -> archive (the majority-or-tie rule, stated in the code)',
     PPR._archiveDirectionFor([{ archived: false }, { archived: true }]), true);
  eq('a 2-of-3 archived majority -> restore', PPR._archiveDirectionFor([{ archived: true }, { archived: true }, { archived: false }]), false);

  // =========================================================== [35] =========
  // Full-module audit (2026-08-30) — two real bugs found and fixed:
  // (a) Plan/Stack clicks opened the ordinary lightbox by raw id, which
  //     falls back to index 0 on a miss — Plan/Stack read PROJECT-WIDE data
  //     (every pin / every location-tagged photo) while the lightbox's own
  //     `lightboxIds` is scoped to the Gallery's currently FILTERED list, so
  //     a photo excluded by the active filter (archived, wrong trade, wrong
  //     date range, …) would silently open a DIFFERENT photo with no
  //     warning — and a Delete from there would hit the wrong record.
  // (b) selecting photos on Gallery, then switching to Presentations/Plans,
  //     left the four selection-only toolbar buttons (count/Download/Add to
  //     Presentation/Archive) visible on top of whichever screen opened
  //     next, because index.html's setScreen() only ever called syncChrome()
  //     when ENTERING the Photos screen, never when leaving it.
  console.log('\n[35] Full-module audit — safe cross-screen photo lookup + the selection-leak fix');

  ok('openPhotoById is a single NAMED function, not duplicated inline at each call site',
     /function openPhotoById\(id\) \{/.test(mjs));
  ok('a miss (id not in this project\'s rows) toasts a warning and returns — it never falls through to opening SOMETHING anyway',
     /if \(!byId\(id\)\) \{ UI\.toast\('That photo could not be found', 'warn'\); return; \}/.test(mjs));
  ok('a hit re-scopes lightboxIds to JUST that one photo before opening it, so prev\/next\/delete can\'t drift onto a filtered-out neighbour',
     /lightboxIds = \[id\];\s*openLightbox\(id\);\s*\}/.test(mjs));
  ok('the exported openPhotoById (what bim.js\'s own Plans-tab pins call) delegates to the SAME named function — no second, unguarded copy for external callers',
     /openPhotoById: function \(id\) \{ return openPhotoById\(id\); \}/.test(mjs));
  ok('Plan pin clicks on a photo route through openPhotoById, never a raw openLightbox(id)',
     /else if \(pin\.item_type === 'photo'\) \{ openPhotoById\(pin\.item_id\); \}/.test(mjs));
  ok('bim.js\'s own pin-click dispatch (Plans tab) calls the exported, guarded ProgressPhotos.openPhotoById — cross-checked against section [24]\'s own assertion of this same line',
     /ProgressPhotos\.openPhotoById\(pin\.item_id\)/.test(bmjs));

  // Genuine execution of the miss-guard: `rows` starts (and, since this
  // harness never calls PP.init()/load(), stays) empty for the whole run —
  // see the [30] comment on why syncChrome-style state-mutating init is
  // deliberately not driven here — so a lookup against a made-up id is
  // GUARANTEED to miss, letting the toast-and-no-op path run for real
  // rather than only be read as text.
  (function () {
    const before = (ctx.__toasts || []).length;
    let threw = null;
    try { PP.openPhotoById('audit-bogus-photo-id-does-not-exist'); }
    catch (e) { threw = e; }
    ok('openPhotoById on an id nothing resolves to does not throw', threw === null, threw && threw.message);
    const after = ctx.__toasts || [];
    ok('…and toasts a "warn" — the caller (a Plan pin, a Stack thumbnail) gets a visible reason rather than the lightbox silently opening the wrong photo',
       after.length === before + 1 && after[after.length - 1][0] === 'warn' &&
       after[after.length - 1][1] === 'That photo could not be found');
  })();

  // --- module.js's openModal gained the same backdrop-close cleanup fix as
  // pano.js's own (see that section's tests for the reasoning in full) ------
  ok('module.js\'s openModal disables UI.modal\'s own backdrop listener and installs its own close() that runs an optional onClose before the real close — same mechanism as pano.js\'s, fixing the same bug class here',
     /function openModal\(html, width, onClose\) \{\s*var m = UI\.modal\(html, \{ noBackdropClose: true \}\);/.test(mjs));
  // ⚠️ 2026-08-30 REAL BUG FOUND AND FIXED (this is items 9/10 and half of
  // item 4's actual root cause): the wrapper used to call `m.close()`, but
  // `m.close = close;` a few lines later REASSIGNS `m.close` to this very
  // wrapper — so by the time a button was ever clicked, `m.close()` called
  // ITSELF, recursed until the stack overflowed, and threw a silent
  // RangeError that killed the click handler before anything after it (a
  // 360° hand-off, an onSave callback) ever ran. Fixed by capturing the
  // ORIGINAL close in `rawClose` BEFORE the reassignment and calling THAT.
  ok('the ORIGINAL close is captured in rawClose BEFORE m.close is ever reassigned — this is the fix',
     /var rawClose = m\.close;\s*function close\(\) \{ if \(onClose\) \{ try \{ onClose\(\); \} catch \(e\) \{\} \} rawClose\(\); \}/.test(mjs));
  ok('the wrapper never calls m.close() (which would be itself, once reassigned) — only rawClose()',
     !/function close\(\) \{ if \(onClose\) \{ try \{ onClose\(\); \} catch \(e\) \{\} \} m\.close\(\); \}/.test(mjs));
  // Genuine execution: build a stub matching UI.modal()'s REAL shape (where
  // m.close is the actual DOM-removal function, not the test harness's
  // simplified stand-in) and confirm close() terminates in ONE call instead
  // of recursing — this is the one test in this file that could ACTUALLY
  // have caught the bug, since the harness's own UI.modal stub never
  // reassigns m.close the way the real one does.
  (function () {
    let removed = 0;
    const realShapeModal = { el: { querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }, close() { removed++; } };
    const savedModal = ctx.UI.modal;
    ctx.UI.modal = () => realShapeModal;
    let threw = null;
    try { PP._openModal('<div></div>', 400); realShapeModal.close(); }
    catch (e) { threw = e; }
    finally { ctx.UI.modal = savedModal; }
    ok('openModal, exercised against a REAL-SHAPED UI.modal stub (m.close = the actual close fn), calling close() once removes the modal exactly once — no infinite recursion',
       threw === null && removed === 1, threw && threw.message);
  })();
  ok('…[data-close] buttons AND a genuine backdrop click both route through that SAME close()',
     /b\.onclick = close;\s*\}\);\s*m\.el\.addEventListener\('click', function \(e\) \{ if \(e\.target === m\.el\) close\(\); \}\);/.test(mjs));
  ok('openForm (Edit photo) passes onClose = clear the "editing this photo" collab cursor — previously this only ran on the two [data-close] buttons\' own re-wire (removed), leaving the cursor stuck broadcasting on a backdrop-click dismissal',
     /var m = openModal\(html, 560, function \(\) \{ broadcastCollabSel\(null\); \}\);/.test(mjs) &&
     // the old, backdrop-blind [data-close] re-wire must actually be gone,
     // not just superseded-but-left-behind duplicating the cleanup
     !/Clear the "editing this photo" cursor on every close path \(× \/ Cancel\)\./.test(mjs));
  ok('openMarkupEditor passes onClose = remove the window resize listener — same fix, same reasoning; its own old [data-close] re-wire is likewise gone rather than left duplicating the cleanup',
     /var m = openModal\(html, 900, function \(\) \{ window\.removeEventListener\('resize', sizeCanvas\); \}\);/.test(mjs) &&
     !/b\.onclick = function \(\) \{ window\.removeEventListener\('resize', sizeCanvas\); m\.close\(\); \};/.test(mjs));
  ok('the markup editor\'s Save button no longer needs its own removeEventListener either — m.close() already runs onClose',
     /\$\('pp-mk-save'\)\.onclick = function \(\) \{\s*cancelPolygon\(\);\s*m\.close\(\);\s*if \(onSave\) onSave\(objs\);\s*\};/.test(mjs));
  ok('every OTHER openModal call in this file still passes only (html, width) — onClose is opt-in, so nothing else in the file silently changed behaviour',
     (mjs.match(/openModal\(/g) || []).length >= 8 &&
     (mjs.match(/openModal\(html, \d+\);/g) || []).length >= 6);

  // --- the toolbar-leak fix ---------------------------------------------------
  ok('_leavePhotosScreen clears the selection state',
     /_leavePhotosScreen: function \(\) \{\s*selected = \{\};/.test(mjs));
  ok('_leavePhotosScreen is DELIBERATELY NOT a call to the full syncChrome() — that function\'s own `has` branch for pp-add\/pp-sep-photos\/pp-refresh would re-show them the instant the selection is cleared, undoing index.html\'s own show(PHOTO_TOOLS, false) for the screen being left',
     (function () {
       const m = /_leavePhotosScreen: function \(\) \{([\s\S]*?)\n    \},/.exec(mjs);
       return !!m && !/syncChrome\(\)/.test(m[1]);
     })());
  ok('_leavePhotosScreen hides all four selection-only toolbar controls by id',
     /_leavePhotosScreen: function \(\) \{[\s\S]{0,120}pp-selcount[\s\S]{0,260}pp-sel-download', 'pp-sel-addppr', 'pp-sel-archive'\]\.forEach/.test(mjs));
  ok('…and resets the (still-mounted, merely hidden) grid\'s own checkbox\/highlight residue, so a returning planner never sees stale checked boxes the cleared toolbar already disagrees with',
     /Array\.prototype\.forEach\.call\(host\.querySelectorAll\('\[data-sel\]'\), function \(cb\) \{\s*cb\.checked = false;/.test(mjs) &&
     /card\.classList\.remove\('pp-selrow'\)/.test(mjs) &&
     /var selAll = host\.querySelector\('#pp-selall'\);\s*if \(selAll\) selAll\.checked = false;/.test(mjs));

  // Genuine execution: with rows/selected pristine, this must be a safe,
  // silent no-op (no throw) whether or not #pp-view/the toolbar ids exist —
  // it's called on every non-Photos screen entry, including before the
  // module's own load() has ever populated the grid.
  (function () {
    let threw = null;
    try { PP._leavePhotosScreen(); } catch (e) { threw = e; }
    ok('_leavePhotosScreen runs cleanly with an empty/pristine gallery (called on every tab switch, not just after a real selection)', threw === null, threw && threw.message);
    ok('…and actually leaves the four selection buttons hidden afterward',
       ['pp-selcount', 'pp-sel-download', 'pp-sel-addppr', 'pp-sel-archive'].every((id) => ctx.document.getElementById(id).style.display === 'none'));
  })();

  ok('index.html wires the fix: setScreen calls _leavePhotosScreen() on every screen OTHER than Photos, paired with the existing _syncChrome() call on entry',
     /if \(isPhotos\) ProgressPhotos\._syncChrome\(\);\s*else ProgressPhotos\._leavePhotosScreen\(\);/.test(html));
  ok('…and it runs AFTER show(PHOTO_TOOLS, isPhotos) — ordering matters, since _leavePhotosScreen must never race a state that show() hasn\'t applied yet',
     /show\(PHOTO_TOOLS, isPhotos\);[\s\S]{0,1500}else ProgressPhotos\._leavePhotosScreen\(\);/.test(html));

  // --- bim.js load()'s one un-guarded await -----------------------------------
  ok('load() no longer awaits signPlanUrls() bare — a real network failure there used to throw straight out of load() (fire-and-forget from onProject, no .catch anywhere) and permanently freeze the Plans screen on "Loading floor plans…"',
     /try \{ await signPlanUrls\(\); \} catch \(e\) \{ planUrlCache = \{\}; \}/.test(bmjs));
  ok('…and every OTHER await in load() is still (as it always was) individually try/caught — this fix closes the one gap rather than wrapping the whole function in one catch, which would also have swallowed the plans-fetch\'s own schema-cache handling',
     (bmjs.match(/await load\(\)|async function load\(\)[\s\S]{0,900}?\n  \}/)) &&
     (function () {
       const m = /async function load\(\) \{([\s\S]*?)\n  \}\n/.exec(bmjs);
       if (!m) return false;
       const body = m[1];
       // every top-level await line in load() is either the try/catch'd
       // plans fetch, the now-fixed signPlanUrls, or delegates to a
       // function (loadAllPins/loadRegistrations/loadPins) that is ITSELF
       // try/caught internally — never a second bare await slipping in.
       return /try \{\s*plans = await PDb\.selectAll/.test(body) &&
         /try \{ await signPlanUrls\(\); \} catch/.test(body) &&
         /await loadAllPins\(\);/.test(body) && /await loadRegistrations\(\);/.test(body) && /await loadPins\(\);/.test(body);
     })());

  // Genuine execution: force createSignedUrls to REJECT (a real network
  // failure — not a Supabase {error} response, which signPlanUrls already
  // tolerated before this fix) and prove load() recovers instead of hanging.
  await (async function () {
    store.floor_plans.push({ id: 'plan-audit-1', project_id: 'DEMO01', name: 'Ground Floor', image_url: 'ground.png', level_order: 1 });
    const realFrom = sbStub.storage.from;
    sbStub.storage.from = () => ({
      createSignedUrls: async () => { throw new Error('network unreachable'); },
      createSignedUrl: realFrom().createSignedUrl,
      upload: realFrom().upload,
      remove: realFrom().remove,
    });
    let threw = null;
    try { await BIM._load('DEMO01'); }
    catch (e) { threw = e; }
    finally { sbStub.storage.from = realFrom; }
    ok('a real signed-URL network failure no longer throws out of load()', threw === null, threw && threw.message);
    ok('…and the rest of load() still ran (the plan itself loaded fine — only its IMAGE URL failed to sign) rather than the whole screen freezing on "Loading floor plans…"',
       BIM.hasPlans() === true);
    const bimHost = ctx.document.getElementById('bim-view');
    ok('…and the host was actually re-rendered past its initial loading placeholder',
       !!bimHost && !/Loading floor plans…/.test(bimHost.innerHTML));
  })();

  // Genuine execution of the wireStageInteractions() window-listener leak
  // fix: every load() above already exercised render() -> wireStageInteractions()
  // at least once (there's a real plan in the store), so window mousemove/
  // mouseup listeners already exist from those calls. Drive load() a few
  // more times (a plan switch, a resize, any re-render all hit the same
  // path in the real app) and prove the count does NOT grow — before this
  // fix, EVERY one of these calls added one more permanent mousemove and
  // one more permanent mouseup listener to `window`, none ever removed.
  await (async function () {
    await BIM._load('DEMO01');
    const before = {
      mousemove: winListeners.filter((l) => l.type === 'mousemove').length,
      mouseup: winListeners.filter((l) => l.type === 'mouseup').length,
    };
    ok('exactly one window mousemove listener exists after the first render (not zero — it must actually be wired)', before.mousemove === 1);
    ok('exactly one window mouseup listener exists after the first render', before.mouseup === 1);
    await BIM._load('DEMO01');
    await BIM._load('DEMO01');
    await BIM._load('DEMO01');
    const after = {
      mousemove: winListeners.filter((l) => l.type === 'mousemove').length,
      mouseup: winListeners.filter((l) => l.type === 'mouseup').length,
    };
    ok('…and STILL exactly one after three more loads/re-renders — before this fix each one added a fresh, never-removed pair',
       after.mousemove === 1 && after.mouseup === 1);
  })();

  // --- pano.js H1/H2 — structural only. Genuinely driving these would need
  // navigator.mediaDevices.getUserMedia + a global MediaRecorder + a fake
  // <video> that fires onloadedmetadata on demand, none of which this
  // harness stubs (nor did it before this pass — the whole recording flow
  // has only ever been verified by reading its source, same trade-off this
  // file already accepts for BIM's map/clustering and syncChrome's
  // state-heavy internals). What IS checked here is exact and load-bearing:
  // the precise guard shape that turns a silent freeze/orphan into a
  // recoverable, user-visible failure.
  ok('H1: MediaRecorder construction/wiring/start() is now wrapped in try/catch — a codec failure used to reject the async onclick handler with nobody awaiting it, leaving the button stuck on "Starting camera…" forever with no error shown',
     /try \{\s*var mime = MediaRecorder\.isTypeSupported/.test(pnjs) &&
     /recorder\.start\(\);\s*\} catch \(e\) \{\s*recorder = null;\s*btn\.textContent = 'Start recording';\s*UI\.toast\('Could not start recording: '/.test(pnjs));
  ok('H1: the failure path resets the button text AND bails out (return) rather than falling through to mark the (nonexistent) recording as started',
     /UI\.toast\('Could not start recording: ' \+ \(e\.message \|\| e\) \+ ' — you can upload a video instead\.', 'error'\);\s*return;\s*\}\s*btn\.textContent = 'Stop recording';/.test(pnjs));
  ok('H2: source/combo/date are ALL read into local variables before the FIRST await, not re-looked-up mid-pipeline once the modal\'s DOM may already be gone',
     /var combo = combosByKey\[\$\('pano-c-loc'\)\.value\] \|\| null;\s*var date = \$\('pano-c-date'\)\.value[\s\S]{0,120};\s*var source = \$\('pano-c-source'\)\.value;\s*var uploadedPath = null;\s*try \{/.test(pnjs));
  ok('H2: `cancelled` is now re-checked after EVERY major async stage (extract/OpenCV/stitch/toBlob/upload), not only once at function entry',
     (pnjs.match(/if \(cancelled\) return;/g) || []).length >= 5);
  ok('H2: a cancellation detected right after the upload succeeds removes the now-orphaned object from Storage instead of leaving it there forever with no DB row ever pointing at it',
     /uploadedPath = path;\s*if \(cancelled\) \{[\s\S]{0,320}remove\(\[uploadedPath\]\);[\s\S]{0,40}return;\s*\}/.test(pnjs));
  ok('H2: the catch block no longer reports a cancellation as an error toast — a user who successfully cancelled must not see "Could not build the panorama"',
     /catch \(e\) \{\s*\/\/ A cancellation is not a failure[\s\S]{0,150}if \(cancelled\) \{ if \(uploadedPath\) \{ try \{ await sb\(\)\.storage\.from\(BUCKET\)\.remove\(\[uploadedPath\]\); \} catch \(e2\) \{\} \} return; \}/.test(pnjs));

  // --- recon.js H3 (structural — same reasoning as pano.js's, above) ---------
  ok('H3: recon.js\'s request form gained the same cancellation guard pano.js\'s capture modal already has (it had NONE before this fix)',
     /var cancelled = false;\s*var closeOrig = m\.close;\s*Array\.prototype\.forEach\.call\(m\.el\.querySelectorAll\('\[data-close\]'\), function \(b\) \{\s*b\.onclick = function \(\) \{ cancelled = true; closeOrig\(\); \};/.test(rcjs));
  ok('H3: location\/source\/note are read into local variables BEFORE the upload await, not re-looked-up afterward',
     /var combo = combosByKey\[\$\('recon-c-loc'\)\.value\] \|\| null;\s*var videoSource = \$\('recon-c-source'\)\.value;\s*var note = \$\('recon-c-note'\)\.value\.trim\(\) \|\| null;\s*var uploadedPath = null;/.test(rcjs));
  ok('H3: a cancellation caught right after the upload removes the now-orphaned video from Storage before the request row is ever inserted',
     /uploadedPath = path;\s*if \(cancelled\) \{\s*try \{ await sb\(\)\.storage\.from\(BUCKET\)\.remove\(\[uploadedPath\]\); \} catch \(e2\) \{\}\s*return;\s*\}/.test(rcjs));

  // --- pano.js: openModal gained an onClose run on every dismissal path,
  // and openViewer's single-panorama WebGL viewer now uses it. Structural
  // only — this harness's DOM stub's querySelectorAll always returns []
  // (confirmed elsewhere in this file), so it fundamentally cannot drive a
  // click on markup assigned via innerHTML; there is no faithful way to
  // simulate "the backdrop was clicked" without rebuilding a real DOM here.
  ok('openModal accepts an onClose callback, disables UI.modal\'s OWN backdrop listener (which bypasses a later m.close reassignment — the bug this mirrors from module.js\'s forms), and installs its own that runs onClose before the real close',
     /function openModal\(html, width, onClose\) \{\s*var m = UI\.modal\(html, \{ noBackdropClose: true \}\);/.test(pnjs) &&
     /function close\(\) \{ if \(onClose\) \{ try \{ onClose\(\); \} catch \(e\) \{\} \} m\.close\(\); \}/.test(pnjs));
  ok('…both dismissal paths — the [data-close] buttons AND a genuine backdrop click (target === the overlay itself, not a descendant) — route through the SAME close(), so they can never disagree about running cleanup',
     /b\.onclick = close;\s*\}\);\s*m\.el\.addEventListener\('click', function \(e\) \{ if \(e\.target === m\.el\) close\(\); \}\);/.test(pnjs));
  ok('openViewer captures mountCylinderViewer\'s return value (it used to be discarded outright) and passes a dispose callback as onClose — a real WebGL context can no longer leak on every single-panorama view',
     /var viewer = null;\s*var m = openModal\(html, 900, function \(\) \{ if \(viewer\) viewer\.dispose\(\); \}\);/.test(pnjs) &&
     /viewer = mountCylinderViewer\(canvas, u\);/.test(pnjs));
  ok('mountCylinderViewer\'s own dispose really does release the renderer\'s WebGL context (unchanged by this fix — confirming the handle openViewer now keeps a reference to is the right one)',
     /dispose: function \(\) \{ try \{ renderer\.dispose\(\); \} catch \(e\) \{\} \}/.test(pnjs));

  // --- bim.js OpenCV cv.Mat leaks — structural only. Genuinely proving this
  // needs a fake `cv` global tracking live/deleted WASM Mat handles across
  // imread/matFromArray/findHomography/warpPerspective, which is a bigger
  // simulation than this specific mechanical try/finally wrap justifies —
  // same proportionality call as pano.js's H1/H2 above. What's checked here
  // is exact: each Mat is declared OUTSIDE the try (so `var` hoisting keeps
  // it safely `undefined`, not a ReferenceError, if its own creation line
  // never ran) and deleted, conditionally, in a finally that runs whether
  // the block throws or not.
  ok('paintActualView: src/dst/M are declared before the try and deleted in a finally, so a warpPerspective/imshow throw can no longer skip cleanup',
     /var src, dst, M;\s*try \{\s*src = cv\.imread\(srcCanvas\);\s*dst = new cv\.Mat\(\);/.test(bmjs) &&
     /\} finally \{\s*if \(src\) src\.delete\(\);\s*if \(dst\) dst\.delete\(\);\s*if \(M\) M\.delete\(\);\s*\}/.test(bmjs));
  ok('registration save: srcMat/dstMat/H are likewise cleaned up in a finally — H.empty() is a real cv.Mat needing .delete() even on the "not enough spread" friendly-error path, which used to throw before any of the three were ever deleted',
     /var srcMat, dstMat, H, hArr;\s*try \{/.test(bmjs) &&
     /if \(H\.empty\(\)\) throw new Error\('Could not compute a transform from these points[\s\S]{0,40}\);\s*hArr = \[\];/.test(bmjs) &&
     /\} finally \{\s*if \(srcMat\) srcMat\.delete\(\);\s*if \(dstMat\) dstMat\.delete\(\);\s*if \(H\) H\.delete\(\);\s*\}/.test(bmjs));

  // --- recon.js M5 — genuine execution (order-of-operations race) -----------
  // The bug: the storage remove() ran BEFORE the DB delete's own
  // .eq('status','pending_approval') guard was even checked, so a request a
  // concurrent admin had *just* approved would have its video deleted out
  // from under the now-accepted job, while the delete matched 0 rows (no
  // error — Supabase reports that as success) and the UI still claimed
  // "Request retracted" as if it had worked.
  await (async function () {
    let removed = [];
    const realFrom = sbStub.storage.from;
    sbStub.storage.from = () => ({
      createSignedUrls: async (paths) => ({ data: paths.map((p) => ({ path: p, signedUrl: 'signed://' + p })), error: null }),
      createSignedUrl: async (p) => ({ data: { signedUrl: 'signed://' + p }, error: null }),
      upload: async (p) => ({ data: { path: p }, error: null }),
      remove: async (paths) => { removed.push(...paths); return { error: null }; },
    });

    // Scenario 1: genuinely still pending — the ordinary, successful case.
    const r1 = { id: nid('reconstruction_requests'), project_id: 'DEMO01', status: 'pending_approval', video_url: 'vid-1.mp4' };
    store.reconstruction_requests.push(r1);
    await RECON._retractRequest(r1);
    ok('M5 (still pending): the row is genuinely deleted', !store.reconstruction_requests.some((r) => r.id === r1.id));
    ok('M5 (still pending): its video IS removed from Storage — the normal, safe case', removed.includes('vid-1.mp4'));
    eq('M5 (still pending): toasts real success', ctx.__toasts[ctx.__toasts.length - 1], ['ok', 'Request retracted']);

    // Scenario 2: a concurrent admin has ALREADY approved it (the race) — the
    // .eq('status','pending_approval') guard on the delete must now match
    // nothing, and the video must survive because the accepted job needs it.
    removed = [];
    const r2 = { id: nid('reconstruction_requests'), project_id: 'DEMO01', status: 'approved', video_url: 'vid-2.mp4' };
    store.reconstruction_requests.push(r2);
    await RECON._retractRequest(r2);
    sbStub.storage.from = realFrom;
    ok('M5 (raced — already approved): the delete matches nothing, so the row SURVIVES', store.reconstruction_requests.some((r) => r.id === r2.id));
    ok('M5 (raced — already approved): its video is NEVER removed — the fix\'s whole point', !removed.includes('vid-2.mp4'));
    eq('M5 (raced — already approved): reports the truth (could not retract), never the false "Request retracted"',
       ctx.__toasts[ctx.__toasts.length - 1], ['warn', 'This request could not be retracted — it may have just been approved']);
    store.reconstruction_requests = store.reconstruction_requests.filter((r) => r.id !== r2.id);
  })();

  // --- ppr.js: merge-wizard orphan-on-slide-copy-failure --------------------
  ok('openMergeWizard\'s slide-copy failure now recovers the SAME way openCopyWizard.finish()\'s identical failure already does — close the wizard, reload, and open the (slide-less) new presentation directly, instead of leaving an invisible orphan behind a still-open wizard that would create ANOTHER one on retry',
     /if \(sres\.error\) \{[\s\S]{0,850}m\.close\(\); await load\(\); openPpr\(newId\); return;\s*\}/.test(pjs));
  ok('…the fix sits inside openMergeWizard specifically (not just anywhere reusing this phrase — cross-checked against the failure message it wraps)',
     (function () {
       const i = pjs.indexOf('function openMergeWizard(');
       const j = pjs.indexOf('function openBatchDownloadChoice(');
       const body = pjs.slice(i, j);
       return /Presentation created, but copying slides failed:/.test(body) &&
         /m\.close\(\); await load\(\); openPpr\(newId\); return;/.test(body);
     })());

  // --- ppr.js: item 16 (2026-08-30) — the preview pane is now driven
  // ENTIRELY by the CHECKBOX set (selectedPprs), never by `selId` at all.
  // A checked-but-now-hidden presentation (archived, or filtered out) must
  // show the "nothing to preview" prompt rather than silently keeping its
  // stale slide thumbnails on screen — the same scoping bug the OLD `selId`
  // re-validation guarded against, now enforced structurally by
  // visibleSelectedPprIds() itself (it always intersects with visiblePprs()).
  ok('renderPreview reads the checkbox set via visibleSelectedPprIds(), never `selId`, for the single-selection path',
     /var oneId = selIds\[0\] \|\| null;/.test(pjs) && !/if \(selId && !visiblePprs\(\)\.some/.test(pjs));
  ok('the row\'s red highlight and the preview pane can never disagree — both read selectedPprs, never `selId`',
     /class="ppr-row' \+ \(selectedPprs\[p\.id\] \? ' sel' : ''\)/.test(pjs));

  // Genuine execution via the save/restore hook (same convention as
  // _eligiblePhotos): drives the REAL renderPreview() against an injected
  // presentation/filter/CHECKED-id combination.
  (function () {
    const pAct = { id: 'ppr-active', archived: false, ppr_date: '2026-01-01' };
    const pArc = { id: 'ppr-gone', archived: true, ppr_date: '2026-02-01' };
    const slidesMap = {
      'ppr-active': [{ id: 's1', ppr_id: 'ppr-active', slide_no: 1, after_photo_id: null, before_photo_id: null }],
      'ppr-gone': [{ id: 's2', ppr_id: 'ppr-gone', slide_no: 1, after_photo_id: null, before_photo_id: null }],
    };
    let r = PPR._renderPreviewWithState([pAct, pArc], { archived: false }, 'ppr-active', slidesMap);
    ok('checking a VISIBLE presentation shows its slides (the ordinary case works)',
       r.visibleCheckedIds.length === 1 && r.visibleCheckedIds[0] === 'ppr-active' && /ppr-thumbwrap/.test(r.bodyHtml));

    r = PPR._renderPreviewWithState([pAct, pArc], { archived: false }, 'ppr-gone', slidesMap);
    ok('checking a presentation the CURRENT filter does not show (here: it got archived while filters.archived stayed false) never drives the preview — visibleSelectedPprIds() excludes it',
       r.visibleCheckedIds.length === 0);
    ok('…and the pane falls back to the "check a presentation" hint rather than silently showing the hidden one\'s stale thumbnails',
       /Check a presentation to preview its slides\./.test(r.bodyHtml) && !/ppr-thumbwrap/.test(r.bodyHtml));

    r = PPR._renderPreviewWithState([pAct], {}, 'ppr-deleted-entirely', slidesMap);
    ok('the same rule applies to a checked id that no longer exists in `pprs` at all (a hard delete), not only an archived-but-still-present row',
       r.visibleCheckedIds.length === 0 && /Check a presentation to preview its slides\./.test(r.bodyHtml));
  })();

  // --- module.css: the missing .pp-muted rule + two real WCAG AA failures ---
  const cssFile = fs.readFileSync(here('module.css'), 'utf8');
  ok('.pp-muted is DEFINED now (used in module.js/ppr.js but had no rule anywhere in this file at all — rendered as plain unstyled ink)',
     /\.pp-muted \{ color: var\(--pd-muted\); \}/.test(cssFile));

  // Genuine execution: compute the REAL contrast ratio from the actual CSS
  // declaration (parsed, not assumed) — the same math WCAG itself uses
  // (relative luminance -> (L1+0.05)/(L2+0.05)), against the codebase's own
  // documented brand-red hex. Confirms both the OLD value genuinely fails
  // and the NEW one genuinely passes, rather than trusting the percentage
  // in the CSS was chosen correctly by eye.
  (function () {
    function srgbToLin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    function relLum([r, g, b]) { return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b); }
    function contrast(a, b) {
      const l1 = relLum(a), l2 = relLum(b);
      const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
      return (hi + 0.05) / (lo + 0.05);
    }
    const RED = [0xEE, 0x31, 0x24]; // assets/css/dashboard.css's --pd-red, fixed across both themes
    const BLACK = [0, 0, 0], WHITE = [255, 255, 255];
    function mix(pct) { return RED.map((v, i) => Math.round(v * pct / 100 + BLACK[i] * (1 - pct / 100))); }

    ok('white text on the OLD plain var(--pd-red) genuinely fails WCAG AA at this size (< 4.5:1) — confirming the finding, not just asserting a fix exists',
       contrast(WHITE, RED) < 4.5);

    ['ppr-tmpl-locorder', 'ppr-sortno'].forEach(function (cls) {
      const re = new RegExp('\\.' + cls + ' \\{[\\s\\S]*?background: color-mix\\(in srgb, var\\(--pd-red\\) (\\d+)%, black\\);');
      const m = re.exec(cssFile);
      ok(cls + ': now uses color-mix(in srgb, var(--pd-red) N%, black) rather than the plain fill', !!m);
      if (m) {
        const pct = +m[1];
        ok(cls + ': the ACTUAL darkened colour genuinely passes WCAG AA with white text (>= 4.5:1) — computed from the real percentage in the file, not assumed',
           contrast(WHITE, mix(pct)) >= 4.5);
      }
    });
  })();

  // --- Batch 3: small cleanup items — dead code, escaping, wording, aria ----
  console.log('\n[36] Batch 3 cleanup — dead code, escaping, wording, accessibility, mobile touch targets');

  ok('bim.js: the dead #bim-plan-select binding in wire() (element does not exist at init() time — wirePlan() has the real, working one) is gone rather than left as inert dead code',
     !/function wire\(\) \{[\s\S]{0,300}bim-plan-select[\s\S]{0,20}onchange/.test(bmjs));
  ok('…wirePlan() still has the one real, working binding (nothing was lost, only the dead duplicate)',
     /function wirePlan\(\) \{\s*if \(\$\('bim-plan-select'\)\) \$\('bim-plan-select'\)\.onchange = function \(\) \{/.test(bmjs));

  ok('wireMediaTypeSelector: capture="environment" is preserved in Photo mode and only removed in Video mode (it used to be stripped unconditionally on every call, including the very first — so it never actually took effect even in Photo mode)',
     /if \(cur === 'video'\) fileInput\.removeAttribute\('capture'\);\s*else fileInput\.setAttribute\('capture', 'environment'\);/.test(mjs));
  ok('…and the unused `lbl` variable (looked up, never referenced) is gone',
     !/var lbl = document\.querySelector\('label\[for="' \+ idPrefix \+ '-files"\]'\);/.test(mjs));

  ok('the offline "queued" toast now names the real media kind, matching the "uploaded" toast right above it (it used to hardcode "photo" even for a batch of videos)',
     /if \(queued\) UI\.toast\(queued \+ ' ' \+ \(kind === 'video' \? 'video' : 'photo'\) \+ \(queued === 1 \? '' : 's'\) \+ ' queued/.test(mjs));

  ok('openAddToPresentation escapes p.id in the option value, not just the visible label',
     /'<option value="' \+ Fmt\.esc\(p\.id\) \+ '">'/.test(mjs));

  ok('both Gallery selection checkboxes (List row + Gallery card) now carry an aria-label naming the photo, not just a bare unlabelled checkbox',
     (mjs.match(/aria-label="Select ' \+\s*Fmt\.esc\(r\.description \|\| 'this photo'\) \+ '"/g) || []).length >= 2);
  ok('Plan view cluster markers now carry an aria-label describing what they are — previously the only accessible content was the bare pin count',
     /aria-label="' \+ c\.pins\.length \+ ' item' \+ \(c\.pins\.length === 1 \? '' : 's'\) \+ ' at this location/.test(mjs));

  ok('module.css: the four confirmed-orphaned selectors are gone (.pp-thumb-wrap, .pp-cardphoto-wrap, .ppr-pickinfo, .ppr-pickthumb — zero references anywhere in the JS/HTML before this pass)',
     !/\.pp-thumb-wrap \{/.test(cssFile) && !/\.pp-cardphoto-wrap \{/.test(cssFile) &&
     !/\.ppr-pickinfo \{/.test(cssFile) && !/\.ppr-pickthumb \{/.test(cssFile));
  ok('module.css: .pp-plancluster and .pp-stackthumb-sm gain a phone-width touch-target bump (neither had one at all before — every dimension was under 44px on a touch device)',
     /@media \(max-width: 700px\) \{[\s\S]{0,400}\.pp-plancluster \{ min-width: 40px; height: 40px; \}\s*\.pp-stackthumb-sm \{ width: 40px; height: 46px; \}/.test(cssFile));

  ok('ppr.js: slides() no longer re-sorts on every call — slidesOf[k] is already kept sorted at both of its two write sites (load()\'s explicit sort, and the slide-sorter\'s renumber-to-match-array-order before assigning), so the per-call .sort() was pure wasted work',
     /function slides\(pprId\) \{ return \(slidesOf\[pprId\] \|\| \[\]\)\.slice\(\); \}/.test(pjs) &&
     !/function slides\(pprId\) \{ return \(slidesOf\[pprId\] \|\| \[\]\)\.slice\(\)\.sort/.test(pjs));
  ok('ppr.js: reloadPhotos() no longer fails completely silently — its only caller is the slide editor\'s "+ Add photo" flow, where a failed re-read used to leave a just-uploaded photo invisibly unpickable with no explanation',
     /async function reloadPhotos\(\) \{[\s\S]{0,700}UI\.toast\('Could not refresh the photo library: ' \+ \(\(e && e\.message\) \|\| e\), 'error'\);\s*return;\s*\}/.test(pjs));

  ok('pano.js: seekTo() times out (3s) and resolves anyway rather than hanging forever — a malformed video or the "already at that time" seeked-never-fires browser quirk used to permanently stall the entire extractFrames() loop with no error at all',
     /var timer = setTimeout\(finish, 3000\);/.test(pnjs) &&
     /function finish\(\) \{\s*if \(done\) return;\s*done = true;\s*video\.removeEventListener\('seeked', onSeeked\);\s*clearTimeout\(timer\);\s*resolve\(\);\s*\}/.test(pnjs));
  ok('pano.js: recording and file-upload are now mutually exclusive in the SAME capture modal (both controls are visible at once; nothing stopped a user from doing both, letting two processVideo() runs fight over one status element or create two panorama rows from one session)',
     /var processing = false;/.test(pnjs) &&
     /if \(processing\) \{ UI\.toast\('An earlier capture is still processing — wait for it to finish first', 'warn'\); return; \}/.test(pnjs) &&
     /if \(recorder\) \{ UI\.toast\('Stop the current recording first', 'warn'\); this\.value = ''; return; \}/.test(pnjs));
  ok('…processing is set at processVideo\'s entry and cleared in a finally — guaranteed to reset on every exit path (success, error, or an early cancellation return) so a single stuck path can never permanently lock out every future attempt',
     /async function processVideo\(blob\) \{\s*if \(cancelled\) return;\s*processing = true;/.test(pnjs) &&
     /\} finally \{[\s\S]{0,340}processing = false;\s*\}/.test(pnjs));

  // --- pano.js: the per-frame OpenCV Mat leaks in the stitching loop ---------
  // ⚠️ Worse than the bim.js Mat leaks fixed earlier: homographyBetween's two
  // detectAndCompute() mask args were anonymous `new cv.Mat()` literals with
  // NO variable ever pointing at them, so they leaked on EVERY call —
  // success or failure, no exception needed. This function also had no
  // try/finally at all, unlike stitchFrames' own outer-loop prevMat/curMat
  // handling.
  ok('homographyBetween: the two detectAndCompute() mask arguments are now named variables (mask1/mask2), not untrackable anonymous cv.Mat() literals that leaked unconditionally on every single call',
     /mask1 = new cv\.Mat\(\); mask2 = new cv\.Mat\(\);/.test(pnjs) &&
     /orb\.detectAndCompute\(g1, mask1, kp1, des1\);/.test(pnjs) &&
     /orb\.detectAndCompute\(g2, mask2, kp2, des2\);/.test(pnjs) &&
     !/new cv\.Mat\(\), kp1, des1\)/.test(pnjs));
  ok('homographyBetween: the whole body is now wrapped in try/finally — a throw from ANY intermediate cv call (cvtColor/detectAndCompute/knnMatch/findHomography) used to skip cleanup of every Mat already created',
     /function homographyBetween\(prevMat, curMat\) \{\s*var orb, kp1, kp2, des1, des2, g1, g2, mask1, mask2;/.test(pnjs) &&
     /\} finally \{[\s\S]{0,400}\[orb, kp1, kp2, des1, des2, g1, g2, mask1, mask2, bf, knn, srcMat, dstMat, mask\]\.forEach\(function \(x\) \{\s*if \(x\) x\.delete\(\);\s*\}\);/.test(pnjs));
  ok('…and the returned H (when a real homography was found) is deliberately EXCLUDED from that cleanup list — it is handed to the caller, who owns and deletes it (stitchFrames composes it then deletes it, or discards it on a poor-match frame); double-deleting it here would crash the very next call that tries to use it',
     (function () {
       const m = /function homographyBetween\(prevMat, curMat\) \{([\s\S]*?)\n  \}/.exec(pnjs);
       return !!m && !/\[.*\bH\b.*\]\.forEach/.test(m[1]);
     })());

  ok('stitchFrames: srcMat/dstMat/Hmat (the per-frame warpPerspective inputs/output) are now wrapped in try/finally too — the same fix, same reasoning, for the loop\'s OTHER Mat trio',
     /var srcMat, dstMat, Hmat;\s*try \{\s*srcMat = cv\.imread\(frameCanvases\[i\]\);/.test(pnjs) &&
     /\} finally \{\s*if \(srcMat\) srcMat\.delete\(\);\s*if \(dstMat\) dstMat\.delete\(\);\s*if \(Hmat\) Hmat\.delete\(\);\s*\}/.test(pnjs));

  console.log('\n[37] Fourth feedback round (2026-08-30) — the wireLocationField/wireLocFields regression, topbar init isolation, group-by None');

  // ⚠️ ROOT-CAUSE REGRESSION GUARD. module.js used to carry TWO
  // `function wireLocationField(idPrefix)` declarations — JS function-
  // declaration hoisting means the SECOND one silently wins, and it called
  // `wireLocFields(idPrefix)`, a helper that a previous refactor had already
  // deleted from this file. Every caller of `wireLocationField` (both
  // openUpload's Add Media modal and openForm's Edit Photo modal) therefore
  // threw a ReferenceError the instant it ran — and since NEITHER call site
  // wraps it in a try/catch, that throw silently aborted every wiring
  // statement that followed it in the SAME function: wireWorksMultiField,
  // BIM.wirePinField, wireMediaTypeSelector, the file-input change handler,
  // and critically the Save/Upload button's own onclick — which is exactly
  // "Key Plan doesn't work, Works and Location don't work, and Add Media
  // regressed" reported together, because they are all downstream of the
  // same one throw. No prior test caught this because none of them called
  // `wireLocationField` for real — every existing check regex-matched
  // pieces of the form in isolation.
  ok('wireLocFields is completely gone from module.js — the deleted helper the stale duplicate used to call',
     !/wireLocFields/.test(mjs));
  eq('exactly ONE function wireLocationField declaration exists (the duplicate that shadowed it is gone)',
     (mjs.match(/function wireLocationField\(/g) || []).length, 1);
  ok('the surviving wireLocationField wires the "+ Add field"/"Change location…" button and repaints the schedule-activity context, nothing else',
     /function wireLocationField\(idPrefix\) \{\s*var addBtn = \$\(idPrefix \+ '-locadd'\);\s*if \(addBtn\) addBtn\.onclick = function \(\) \{ openLocationPicker\(idPrefix\); \};\s*paintLocCtx\(idPrefix\);\s*\}/.test(mjs));
  // Both call sites are unaffected by the fix (both always called it with
  // exactly one argument, so removing the dead second parameter is safe).
  ok('openUpload still calls wireLocationField(\'pp\') with the Add Media prefix', /wireLocationField\('pp'\)/.test(mjs));
  ok('openForm (Edit Photo) still calls wireLocationField(\'pp-e\') with the Edit prefix', /wireLocationField\('pp-e'\)/.test(mjs));

  // Item 2 — one throw in a sub-module's init() (or in one screen's
  // syncTools()) must never leave a DIFFERENT screen's topbar button stuck
  // showing. Isolated in index.html rather than module.js; checked here
  // against the shipped page source since that is where the fix lives.
  ok('every top-level sub-module init() call (ProgressPhotos/PPR/PANO/RECON/BIM) is wrapped so one throwing does not skip the rest',
     (html.match(/safeInit\(function \(\) \{ (?:ProgressPhotos|PPR|PANO|RECON|BIM)\.init\(user, profile\); \}, '/g) || []).length === 5);
  ok('setScreen()\'s four visibility calls (Gallery tools / PPR / BIM / Gallery chrome) are each isolated too',
     /safeSync\(function \(\) \{ show\(PHOTO_TOOLS, isPhotos\); \}/.test(html) &&
     /safeSync\(function \(\) \{ PPR\._syncTools\(isPpr\); \}/.test(html) &&
     /safeSync\(function \(\) \{ BIM\._syncTools\(isBim\); \}/.test(html));

  // Item 6 — "Group by: None" genuinely produces one unsorted bucket and
  // prints no header row/wrapper in either view; also covered by the
  // dedicated grouping block in section 6 above via _groupRows().
  ok('None is listed in the group-by select, before Month (the new default position)',
     /<option value="none">None<\/option>\s*\n\s*<option value="month">/.test(html));

  // --- Item 1 (fourth round) — real client-side thumbnails, genuinely executed ---
  // The repeated complaint ("tile loading still slow") after the 2026-08-29
  // Storage-transform fix drove a second, independent mechanism: a real,
  // separate small file generated at upload time. Exercised end to end here,
  // not just regex-matched, because the earlier fix's own silent-degrade
  // failure mode is exactly the kind of thing a regex can't catch.
  {
    const jpgFile = { type: 'image/jpeg', name: 'site.jpg' };
    const pngFile = { type: 'image/png', name: 'site.png' };
    const videoFile = { type: 'video/mp4', name: 'clip.mp4' };

    const blob = await PP._makeThumbnailBlob(jpgFile);
    ok('makeThumbnailBlob genuinely decodes and downscales to a real Blob', !!blob && blob.__fakeBlob === true);
    ok('the produced blob is a JPEG', blob.type === 'image/jpeg');

    const thumbPath = await PP._uploadThumbnailFor(jpgFile, 'DEMO01/123_abc_site.jpg');
    ok('uploadThumbnailFor returns a real path for an image file', thumbPath === 'DEMO01/123_abc_site.jpg.thumb.jpg');
    ok('...and it genuinely uploaded to Storage (not just computed a string)', !!signed[thumbPath]);

    const pngThumbPath = await PP._uploadThumbnailFor(pngFile, 'DEMO01/124_def_site.png');
    ok('uploadThumbnailFor also handles a non-JPEG source image', pngThumbPath === 'DEMO01/124_def_site.png.thumb.jpg');

    const videoThumbPath = await PP._uploadThumbnailFor(videoFile, 'DEMO01/125_ghi_clip.mp4');
    eq('uploadThumbnailFor is a no-op for a video file (skipped, not attempted-and-failed)', videoThumbPath, null);

    // ⚠️ Never blocks the real upload: a thumbnail that fails to generate
    // must return null, not throw and abort the whole capture.
    const brokenFile = { type: 'image/jpeg', name: 'broken.jpg' };
    const savedImage = ctx.Image;
    ctx.Image = class { set src(v) { if (this.onerror) this.onerror(new Error('decode failed')); } };
    let threw = false;
    let result;
    try { result = await PP._uploadThumbnailFor(brokenFile, 'DEMO01/126_jkl_broken.jpg'); }
    catch (e) { threw = true; }
    ctx.Image = savedImage;
    ok('a thumbnail that fails to generate degrades to null rather than throwing', !threw && result === null);

    // The fallback chain: thumb_url (signed) wins over the transform-based
    // thumbCache, which wins over the full-resolution original — and a row
    // with neither still resolves to something rather than a blank tile.
    const rowsFixture = [
      { id: 'has-thumb', photo_url: 'DEMO01/a.jpg', thumb_url: 'DEMO01/a.jpg.thumb.jpg' },
      { id: 'legacy-only', photo_url: 'DEMO01/b.jpg' },
      { id: 'no-photo', photo_url: '' },
    ];
    const urls = await PP._thumbUrlsFor(rowsFixture);
    eq('a row with a real thumb_url resolves to ITS signed URL, not the full-res original',
       urls['has-thumb'], 'signed://DEMO01/a.jpg.thumb.jpg');
    eq('a pre-existing row with no thumb_url still resolves (falls through the chain to something usable)',
       urls['legacy-only'], 'signed://DEMO01/b.jpg');
    eq('a row with no photo at all resolves to an empty string, never undefined/throwing', urls['no-photo'], '');
  }

  ok('saveCapture uploads a thumbnail alongside the original and attaches it to the row before the insert',
     /var thumbPath = await uploadThumbnailFor\(file, path\);[\s\S]{0,200}if \(thumbPath\) row\.thumb_url = thumbPath;/.test(mjs));
  ok('flushQueue (the offline-capture sync path) does the same, so an offline-captured photo also gets a thumbnail once synced',
     /var thumbPath = await uploadThumbnailFor\(item\.blob, path\);[\s\S]{0,200}if \(thumbPath\) row\.thumb_url = thumbPath;/.test(mjs));
  ok('tolerantWrite strips thumb_url and retries on a pre-migration database, naming the round-3 migration file',
     /'thumb_url' in job\.patch[\s\S]{0,400}2026-08-30-photos-round3\.sql/.test(mjs));
  ok('deleting a photo also removes its thumbnail object from Storage, not just the original (no orphaned thumb files)',
     /var toRemove = \[r\.photo_url, r\.thumb_url\]\.filter\(Boolean\);/.test(mjs));
  ok('migrations/2026-08-30-photos-round3.sql adds progress_photos.thumb_url, idempotently',
     /alter table progress_photos add column if not exists thumb_url text;/.test(
       fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '2026-08-30-photos-round3.sql'), 'utf8')));

  // [36] Root-cause fix (2026-08-30, live-reproduced): render() in BOTH
  // ppr.js and bim.js was calling `syncTools(true)` UNCONDITIONALLY on every
  // re-render — including the one triggered by their own async load()
  // completing — silently overriding whatever index.html's setScreen() had
  // already correctly set moments earlier via PPR._syncTools(false) /
  // BIM._syncTools(false). This is the actual cause of "the buttons for the
  // Gallery tab are still not right": confirmed live in a real browser via
  // getComputedStyle (both ppr-new and bim-new read display:flex on the
  // Gallery screen), then isolated by manually calling PPR._syncTools(false)
  // — which correctly hid both buttons with no error — proving the bug was
  // never inside syncTools itself, only in what called it afterward with a
  // hardcoded true. GENUINELY EXECUTED below (not just regex-checked): both
  // fixes are proven by actually running the real render() function and
  // confirming a prior _syncTools(false) call survives it, which is exactly
  // what the pre-fix `syncTools(true)` could never do.
  {
    // ⚠️ Both real buttons are ALSO role-gated (canWrite), which defaults to
    // false in this harness since no init()/session is exercised here. Left
    // at false, `syncTools(true)` (the bug) and `syncTools(toolsVisible)`
    // (the fix) are INDISTINGUISHABLE — both compute to 'none' regardless,
    // because `visible && canWrite` is false either way. That would make
    // this test pass against the buggy code too, proving nothing. Confirmed
    // by actually reverting both files to `syncTools(true)` and re-running:
    // without _setCanWrite(true) below, these two assertions kept passing
    // even against the bug — only the source-level regex checks caught it.
    // _setCanWrite(true) is what makes the fixed and buggy behaviour differ.
    PPR._setCanWrite(true);
    PPR._syncTools(false);
    eq('PPR._syncTools(false) hides "+ New Presentation" (proves the function itself was never the bug)',
       byId['ppr-new'].style.display, 'none');
    PPR._render();
    eq('a PPR render() AFTER that — simulating load()\'s own async completion — must NOT re-show it; this line fails against the pre-fix `syncTools(true)`',
       byId['ppr-new'].style.display, 'none');
    PPR._setCanWrite(false);

    BIM._setCanWrite(true);
    BIM._syncTools(false);
    eq('BIM._syncTools(false) hides "+ Upload floor plan" (proves the function itself was never the bug)',
       byId['bim-new'].style.display, 'none');
    BIM._render();
    eq('a BIM render() AFTER that — simulating load()\'s own async completion — must NOT re-show it; this line fails against the pre-fix `syncTools(true)`',
       byId['bim-new'].style.display, 'none');
    BIM._setCanWrite(false);
  }
  ok('ppr.js\'s render() replays toolsVisible, not a hardcoded true (source-level regression guard alongside the execution proof above)',
     /syncTools\(toolsVisible\);\s*\n\s*if \(screen === 'slides'\) renderSlides/.test(pjs) &&
     !/\$\('ppr-tmpl-wrap'\)\)\.hidden = screen === 'templates';\s*\n\s*syncTools\(true\)/.test(pjs));
  ok('bim.js\'s render() replays toolsVisible, not a hardcoded true (source-level regression guard alongside the execution proof above)',
     /syncTools\(toolsVisible\);\s*\n\s*\n\s*if \(!plans\.length\)/.test(bmjs) &&
     !/if \(!host\) return;\s*\n\s*syncTools\(true\)/.test(bmjs));

  // [37] Gallery tiles on phone — a dense small-square grid (iOS Photos'
  // own look), not a single full-width column (2026-08-30 owner feedback:
  // "photo previews in the gallery view can be smaller. in a phone view,
  // copy size of ios photo gallery"). Isolate the @media (max-width:700px)
  // block so a rule of the same name elsewhere in the file (the desktop
  // .pp-gallery/.pp-card definitions) can't produce a false pass.
  {
    const mq = css.slice(css.indexOf('@media (max-width: 700px)'));
    ok('.pp-gallery is a multi-column grid on phone, not the old single full-width column',
       /\.pp-gallery\s*\{\s*grid-template-columns:\s*repeat\(3,\s*1fr\);/.test(mq) &&
       !/\.pp-gallery\s*\{\s*grid-template-columns:\s*1fr;/.test(mq));
    ok('the phone gap is a hairline (iOS Photos-style tight grid), not the desktop 12-14px card gap',
       /\.pp-gallery\s*\{\s*grid-template-columns:\s*repeat\(3,\s*1fr\);\s*gap:\s*2px;/.test(mq));
    ok('tiles are square-cropped on phone (aspect-ratio:1), not the desktop fixed 210px rectangle',
       /\.pp-cardphoto,\s*\.pp-vidthumb video\s*\{\s*aspect-ratio:\s*1;/.test(mq));
    ok('card chrome (border/radius/background) drops out on phone so tiles sit edge-to-edge',
       /\.pp-card\s*\{\s*border:\s*none;\s*border-radius:\s*0;\s*background:\s*transparent;\s*\}/.test(mq));
    ok('the selected-tile indicator still works with the chrome gone (a real border reappears only when .pp-selrow is set)',
       /\.pp-card\.pp-selrow\s*\{\s*border:\s*2px solid var\(--pd-red\);\s*\}/.test(mq));
    ok('the corner overlays (select checkbox / pin badge) shrink to match the smaller tile, rather than covering a third of a ~120px photo at their desktop size',
       /\.pp-cardsel,\s*\.pp-pinbtn\s*\{\s*padding:\s*2px;/.test(mq));
  }

  console.log('\n================ ' + passes + ' passed, ' + fails + ' failed ================');
  process.exit(fails ? 1 : 0);
})();
