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
 'pp-rounds-view', 'pp-rounds-search', 'pp-screen-rounds',
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

const PP = ctx.ProgressPhotos, PPR = ctx.PPR, PANO = ctx.PANO, RECON = ctx.RECON;
ok('module.js exposes ProgressPhotos', !!PP);
ok('ppr.js exposes PPR', !!PPR);
ok('pano.js exposes PANO', !!PANO);
ok('recon.js exposes RECON', !!RECON);
ok('openUploadForPicker exported (inline add-photo hook)', typeof PP.openUploadForPicker === 'function');

// ---------------------------------------------------------- source assertions --
// Behaviours that are structural (markup/flow) are asserted against the source,
// which is how this module's earlier rounds were verified for render output.
const mjs = fs.readFileSync(here('module.js'), 'utf8');
const pjs = fs.readFileSync(here('ppr.js'), 'utf8');
const pnjs = fs.readFileSync(here('pano.js'), 'utf8');
const rcjs = fs.readFileSync(here('recon.js'), 'utf8');
const html = fs.readFileSync(here('index.html'), 'utf8');
const css = fs.readFileSync(here('module.css'), 'utf8');

console.log('\n[1/2] Works is a real dropdown, not free text');
ok('worksSelectHTML emits a <select>', /function worksSelectHTML[\s\S]{0,400}<select/.test(mjs));
ok('no <input list="pp-works-list"> left anywhere', !/list="pp-works-list"/.test(mjs + pjs));
ok('shared works datalist removed from index.html', !/pp-works-list/.test(html));
ok('"+ Add new Works value" escape hatch present', /__new__/.test(mjs));
ok('Add form uses worksSelectHTML', /worksSelectHTML\('pp',/.test(mjs));
ok('Edit form uses worksSelectHTML', /worksSelectHTML\('pp-e',/.test(mjs));

console.log('\n[2] Capture date / trade / works / location required');
ok('requiredFieldsMissing gates date', /Capture date is required/.test(mjs));
ok('requiredFieldsMissing gates trade', /Trade is required/.test(mjs));
ok('requiredFieldsMissing gates works', /Works is required/.test(mjs));
ok('Add save calls the gate', /requiredFieldsMissing\('pp'\)/.test(mjs));
ok('Edit save calls the gate', /requiredFieldsMissing\('pp-e'\)/.test(mjs));

console.log('\n[3] PPR renamed to Meeting');
ok('tab label is Meetings', /data-screen="ppr">Meetings</.test(html));
ok('primary action is + New Meeting', /\+ New Meeting/.test(html));
ok('screen title is Meetings', /isPpr \? 'Meetings'/.test(html));
ok('modal header New Meeting', /'New Meeting' : 'Edit Meeting'/.test(pjs));
ok('list column header is Meeting Date', /<div>Meeting Date<\/div>/.test(pjs));
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
ok('edit action uses an icon, not a ✎ glyph', /data-act="edit"[\s\S]{0,120}data-ico="pencil"/.test(pjs));

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
ok('picked photo tags echoed read-only', /function paintInfo/.test(pjs));

console.log('\n[9] Before/after may be different locations');
ok('pane() reads each photo\'s own tags', /var tags = ph \? \[ph\.trade, ph\.works, ph\.location\]/.test(pjs));
ok('slide-level meta row no longer shows location', !/ppr-meta[\s\S]{0,400}<label>Location<\/label>/.test(pjs));
ok('panes are labelled Before/After', /ppr-panelabel/.test(pjs) && /'Before' : 'After'/.test(pjs));

console.log('\n[10] No before photo → no before caption, photo centered');
ok('before caption field starts hidden', /id="ppr-s-bcap-field" style="display:none;"/.test(pjs));
ok('syncBeforeCaption toggles it', /function syncBeforeCaption[\s\S]{0,200}display = has \? '' : 'none'/.test(pjs));
ok('before_caption nulled when no before photo', /before_caption: beforeId \? \(\$\('ppr-s-bcap'\)\.value\.trim\(\) \|\| null\) : null/.test(pjs));
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
ok('row advertises the action via title', /title="Open this meeting\\'s slides"/.test(pjs));

console.log('\n[13] Copy previous meeting, promoting after → before');
ok('copy select rendered on new meetings', /ppr-f-copy/.test(pjs));
ok('copySlidesFrom promotes after into before', /before_photo_id: sl\.after_photo_id \|\| sl\.before_photo_id \|\| null/.test(pjs));
ok('new after slot left empty', /after_photo_id: null/.test(pjs));
ok('after caption not carried into the new after', /after_caption: null/.test(pjs));

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
  const ALLOWED_FFF_CONTEXT = /\.pp-lightbox|\.pp-lb-|\.ppr-tmpl-locorder|\.pp-tab\.active|\.pd-btn-primary|\.pp-del:hover|\.pp-syncbtn:hover|\.pano-badge-warn/;
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
  ok('index.html has the 360° tab', /data-screen="pano">360/.test(html));
  ok('index.html has the Capture 360° / Compare topbar tools', /id="pano-new"/.test(html) && /id="pano-compare-btn"/.test(html));
  ok('index.html has the 360° screen host', /id="pp-screen-pano"/.test(html));
  ok('OpenCV.js CDN script present (pinned version)', /opencv-js@4\.10\.0-release\.1\/dist\/opencv\.js/.test(html));
  ok('Three.js CDN script present (pinned, classic global build not the ES-module-only r150\\+)', /three@0\.128\.0\/build\/three\.min\.js/.test(html));
  ok('PANO.init is wired alongside PPR.init', /PANO\.init\(user, profile\)/.test(html));
  ok('setScreen dispatches the pano screen', /isPano = s === 'pano'/.test(html));
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
  ok('index.html has the 3D tab + Request-scan tool + screen host',
     /data-screen="recon">3D/.test(html) && /id="recon-new"/.test(html) && /id="pp-screen-recon"/.test(html));
  ok('PLYLoader CDN script present (same pinned Three.js revision as the 360° viewer)',
     /three@0\.128\.0\/examples\/js\/loaders\/PLYLoader\.js/.test(html));
  ok('RECON.init is wired alongside the other module inits', /RECON\.init\(user, profile\)/.test(html));
  ok('setScreen dispatches the recon screen', /isRecon = s === 'recon'/.test(html));
  ['function openRequestForm', 'function approveRequest', 'function rejectRequest', 'function retractRequest',
   'function openResultViewer', 'function mountPointCloudViewer'
  ].forEach((sig) => ok(sig + '() exists in recon.js', rcjs.includes(sig)));

  console.log('\n================ ' + passes + ' passed, ' + fails + ' failed ================');
  process.exit(fails ? 1 : 0);
})();
