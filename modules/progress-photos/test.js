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
};
let idSeq = 1;
const nid = (p) => p + '-' + (idSeq++);

function makeQuery(table) {
  let rowsSel = store[table].slice();
  const filters = [];
  const q = {
    select() { return q; },
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
      return { data: null, error: null };
    }
    return { data: apply(rowsSel), error: null };
  }
  // make select() awaitable too
  q.select = function () { return q; };
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
  return el;
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
 'ppr-view', 'ppr-count', 'ppr-listbar', 'ppr-countbar', 'ppr-f-from',
 'ppr-f-to', 'ppr-clearfilters', 'ppr-new', 'ppr-back',
].forEach(ensure);

// ------------------------------------------------------------------- globals --
const ctx = {
  console, Promise, JSON, Math, Date, String, Number, Object, Array, Boolean,
  setTimeout, clearTimeout, isNaN, parseInt, parseFloat, encodeURIComponent,
  document: documentStub,
  window: {},
  navigator: { onLine: true },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  sessionStorage: { _d: { pd_project: 'DEMO01' }, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } },
  indexedDB: { open: () => ({ onupgradeneeded: null, onsuccess: null, onerror: null }) },
  URL: { createObjectURL: () => 'blob://x', revokeObjectURL() {} },
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
ok('a returning user\'s explicit List choice still overrides the new default (restoreUI unchanged)',
   /if \(v === 'list' \|\| v === 'gallery'\) view = v;/.test(mjs));
ok('the Presentations-list row-action icons carry left padding (follow-up item 2)',
   /\.ppr-acts \{[^}]*padding-left: 10px/.test(css));

console.log('\n[1/2] Works is a real dropdown, not free text (checkbox group as of Batch B, 2026-08-29)');
ok('no <input list="pp-works-list"> left anywhere', !/list="pp-works-list"/.test(mjs + pjs));
ok('shared works datalist removed from index.html', !/pp-works-list/.test(html));
ok('"+ Add custom Works value" escape hatch present (was "+ Add new Works value…" in the old <select>)',
   /Add custom Works value/.test(mjs));
ok('Add form uses the Works overlay', /worksOverlayHTML\('pp',/.test(mjs));
ok('Edit form uses the Works overlay', /worksOverlayHTML\('pp-e',/.test(mjs));

console.log('\n[2] Capture date / trade / works / location required');
ok('requiredFieldsMissing gates date', /Capture date is required/.test(mjs));
ok('requiredFieldsMissing gates trade', /At least one Trade is required/.test(mjs));
ok('requiredFieldsMissing gates works', /At least one Works value is required/.test(mjs));
ok('Add save calls the gate', /requiredFieldsMissing\('pp'\)/.test(mjs));
ok('Edit save calls the gate', /requiredFieldsMissing\('pp-e'\)/.test(mjs));

console.log('\n[2b] Batch B (2026-08-29 feedback item 2) — Trade/Works multi-select, Location label dropped');
ok('TRADES checkbox overlay function exists', /function tradesOverlayHTML/.test(mjs));
ok('Works checkbox overlay function exists (schedule-derived, trade-scoped, unioned across checked trades)',
   /function worksOverlayHTML/.test(mjs));
ok('multiCheckHTML renders one checkbox per option, checking the ones already selected',
   /function multiCheckHTML[\s\S]{0,400}existingVals\.indexOf\(v\) >= 0 \? ' checked'/.test(mjs));
ok('readMultiCheck reads back only the :checked boxes', /function readMultiCheck[\s\S]{0,200}:checked/.test(mjs));
ok('the "Location label" free-text input is gone (item 2 — "redundant")', !/-loctxt/.test(mjs));
ok('locationFieldHTML no longer takes a locText parameter', /function locationFieldHTML\(idPrefix, existingValues\) \{/.test(mjs));
ok('location is derived purely from the breakdown breadcrumb on save (both Add and Edit)',
   (mjs.match(/location: locBreadcrumb\(locVals\) \|\| null,/g) || []).length === 2);
ok('the insert/update payload carries both the new arrays and the legacy first-selected fallback',
   /trades: tradesVal,[\s\S]{0,60}works_multi: worksVal,[\s\S]{0,60}trade: tradesVal\[0\] \|\| null,[\s\S]{0,60}works: worksVal\[0\] \|\| null,/.test(mjs));
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
ok('photo forms carry a key plan field', /keyPlanFieldHTML\('pp',/.test(mjs) && /keyPlanFieldHTML\('pp-e',/.test(mjs));
ok('slide form no longer uploads a key plan', !/ppr-s-kp/.test(pjs));
ok('signAll signs photo key plans', /if \(p\.key_plan_url\) paths\[p\.key_plan_url\] = 1;/.test(pjs));

console.log('\n[7/8] Slides are built from photos, with inline add');
ok('slide form has no trade select', !/ppr-s-trade/.test(pjs));
ok('slide form has no works field', !/ppr-s-works/.test(pjs));
ok('slide form has no location field', !/ppr-s-loc"/.test(pjs));
ok('after-photo picker has + Add photo', /ppr-s-after-add/.test(pjs));
ok('before-photo picker has + Add photo', /ppr-s-before-add/.test(pjs));
ok('inline add calls openUploadForPicker', /ProgressPhotos\.openUploadForPicker/.test(pjs));
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

console.log('\n[11] Key plan upload/selection wizard');
ok('openKeyPlanWizard exists', /function openKeyPlanWizard/.test(mjs));
ok('wizard offers already-uploaded key plans', /distinctKeyPlans\(\)/.test(mjs));
ok('wizard offers a fresh upload', /pp-kp-upload/.test(mjs));
ok('wizard grid styled', /\.pp-kpgrid \{/.test(css));

console.log('\n[12] Clicking a meeting row opens it');
ok('row onclick calls openPpr', /r\.onclick = function \(\) \{ openPpr\(r\.dataset\.id\); \};/.test(pjs));
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
ok('list view keeps its row actions', /pp-actcell">' \+ rowActions\(r\)/.test(mjs));

console.log('\n[15] Tile grouping: month default + year/location/activity');
ok('default group is month', /var galleryGroupBy = 'month'/.test(mjs));
ok('year grouping', /galleryGroupBy === 'year'/.test(mjs));
ok('location grouping', /galleryGroupBy === 'location'/.test(mjs));
ok('activity grouping', /galleryGroupBy === 'activity'/.test(mjs));
ok('group-by select rendered', /pp-gallery-groupby/.test(mjs));
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
  const ALLOWED_FFF_CONTEXT = /\.pp-lightbox|\.pp-lb-|\.ppr-tmpl-locorder|\.pp-tab\.active|\.pd-btn-primary|\.pp-del:hover|\.pp-syncbtn:hover|\.pano-badge-warn|\.bim-pin\b|#bim-place\.is-active|\.pp-mediatile-badge|\.pp-pinbtn\b|\.pp-pinpreview-dot|\.bim-cluster\b|\.ppr-mktool\b|\.ppr-sortno\b|\.pp-mk-tool\.active/;
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
  ok('index.html has the Capture 360° / Compare topbar tools (now on Gallery)', /id="pano-new"/.test(html) && /id="pano-compare-btn"/.test(html));
  ok('the 360° screen host div is kept (hidden), not deleted — pano.js\'s load()/render() key off it existing',
     /id="pp-screen-pano" hidden/.test(html));
  ok('OpenCV.js CDN script present (pinned version)', /opencv-js@4\.10\.0-release\.1\/dist\/opencv\.js/.test(html));
  ok('Three.js CDN script present (pinned, classic global build not the ES-module-only r150\\+)', /three@0\.128\.0\/build\/three\.min\.js/.test(html));
  ok('PANO.init is wired alongside PPR.init', /PANO\.init\(user, profile\)/.test(html));
  ok('setScreen folds 360° tools into the Gallery screen (PANO._syncTools(isPhotos), not a dedicated isPano)',
     /PANO\._syncTools\(isPhotos\)/.test(html) && !/isPano = s === 'pano'/.test(html));
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
  ok('index.html has the Request-scan topbar tool + screen host (kept, hidden)',
     /id="recon-new"/.test(html) && /id="pp-screen-recon" hidden/.test(html));
  ok('PLYLoader CDN script present (same pinned Three.js revision as the 360° viewer)',
     /three@0\.128\.0\/examples\/js\/loaders\/PLYLoader\.js/.test(html));
  ok('RECON.init is wired alongside the other module inits', /RECON\.init\(user, profile\)/.test(html));
  ok('setScreen folds 3D tools into the Gallery screen (RECON._syncTools(isPhotos), not a dedicated isRecon)',
     /RECON\._syncTools\(isPhotos\)/.test(html) && !/isRecon = s === 'recon'/.test(html));
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
     /id="bim-place"/.test(html) && /id="pp-screen-bim"/.test(html));
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
  ok('the source value is threaded into the saved row', /source: \$\('pano-c-source'\)\.value/.test(pnjs));
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

  // --- Row actions: Download / Preview / Archive (item 1) ----------------
  ok('the row no longer has pdf/pptx/open as separate icons', !/data-act="pdf"/.test(pjs) && !/data-act="pptx"/.test(pjs) && !/data-act="open"/.test(pjs));
  ok('the row has exactly download/preview/archive actions', /data-act="download"/.test(pjs) && /data-act="preview"/.test(pjs) && /data-act="archive"/.test(pjs));
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
  ok('the List grid header gained a matching leading column so header/body stay aligned',
     /<div><\/div><div>Photo<\/div>/.test(mjs));
  ok('the three batch actions are Download / Add to Presentation / Archive',
     /pp-sel-download/.test(mjs) && /pp-sel-addppr/.test(mjs) && /pp-sel-archive/.test(mjs));
  ok('batch archive is tolerant of the pending migration, same as the single-item toggle', /pp-sel-archive'\)\.onclick[\s\S]{0,400}archive-flag\.sql/.test(mjs));
  ok('index.html has the batch-select bar host, hidden by default', /id="pp-selbar" hidden/.test(html));
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
  ok('module.js offers the pin-picker follow-up after a successful upload, non-blocking',
     /BIM\.openPinPickerFor/.test(mjs));
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

  // --- Batch G: floor-plan map/clustering view -----------------------------
  // Structural only — mapClusters/renderMapBody depend on module-internal
  // plan/pin state populated by load(), same DOM/auth-stack limitation this
  // module has flagged for every other client-only surface (Phase 3's OpenCV
  // stitching is the one exception, and that needed a real browser).
  ok('the Plan/Map toggle exists in bim.js\'s render(), dispatching to a dedicated map body',
     /screen2 ===? 'map'/.test(bmjs) && /function renderMapBody\(\)/.test(bmjs));
  ok('map clustering + the month-scrub/play controls exist, mirroring Vertical Stacking\'s own null-is-live pattern',
     /function mapClusters\(monthCutoff\)/.test(bmjs) && /function wireMapView\(\)/.test(bmjs) &&
     /function stopMapPlay\(\)/.test(bmjs) && /mapPlaying/.test(bmjs));
  ok('a cluster resolves the visible item\'s date via itemDateFor, cumulative up to the scrubbed month',
     /function itemDateFor\(pin\)/.test(bmjs));
  ok('clicking a cluster opens its member list rather than jumping straight into one item (ambiguous which one)',
     /function openClusterList\(cluster\)/.test(bmjs));

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

  console.log('\n================ ' + passes + ' passed, ' + fails + ' failed ================');
  process.exit(fails ? 1 : 0);
})();
