/* Executes the SHIPPED confirmDelete / deleteProjectModal / previewHTML / nfmt,
   sliced OUT OF projects.html BY NAME — never retyped, and never by line number
   (a line-numbered slice in a file under concurrent edit goes stale within hours
   and then fails as a syntax error that reads like a bug in the code under test).

   usage: node _scratch/test-delete-dialog.js [path-to-projects.html] */
const fs = require('fs'), vm = require('vm');
const SRC = process.argv[2] || 'projects.html';

function sliceFn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) return null;
  let i = src.indexOf('{', at), d = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return src.slice(at, i + 1); }
  }
  return null;
}
const html = fs.readFileSync(SRC, 'utf8');
const script = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/.exec(html)[1];
const NAMES = ['nfmt', 'previewHTML', 'confirmDelete', 'deleteProjectModal'];
const parts = [];
for (const n of NAMES) {
  const f = sliceFn(script, n);
  // A MISSING SLICE ABORTS. Silently skipping one would let the suite compare
  // nothing and still report green.
  if (!f) { console.error('SLICE FAILED: ' + n + ' not found in ' + SRC); process.exit(2); }
  parts.push(f);
}

function el(tag) {
  const e = { tag, value: '', textContent: '', disabled: false, innerHTML: '',
    isConnected: true, oninput: null, onclick: null, _byId: {},
    focus() { e._focused = true; },
    querySelector(sel) { return e._byId[sel.replace('#', '')] || null; } };
  return e;
}
function makeModal(htmlStr) {
  const root = el('div');
  root.innerHTML = htmlStr;
  ['d-echo', 'd-go', 'd-cancel', 'd-prev'].forEach(function (id) {
    if (htmlStr.indexOf('id="' + id + '"') < 0) return;
    const e = el('x');
    // FAITHFULNESS 1: the initial disabled state comes from the MARKUP. A stub
    // that always starts enabled reported three correct behaviours as failures.
    const tag = new RegExp('<[^>]*id="' + id + '"[^>]*>').exec(htmlStr);
    e.disabled = !!(tag && tag[0].indexOf(' disabled') >= 0);
    root._byId[id] = e;
  });
  const mod = { el: root, closed: false, close() { mod.closed = true; root.isConnected = false; } };
  return mod;
}
// FAITHFULNESS 2: a real browser fires NO click event on a disabled element.
// Calling .onclick() directly bypasses that and made a correct double-click
// guard look like a double-run.
function click(e) { if (e.disabled) return false; e.onclick(); return true; }
let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (extra !== undefined ? '   -> ' + extra : '')); }
}
const sleep = () => new Promise(r => setImmediate(r));
function build(env) {
  const ctx = vm.createContext(Object.assign({ console, setImmediate, Promise }, env));
  vm.runInContext(parts.join('\n'), ctx);
  return ctx;
}

(async function () {
  const ROWS = [
    { table_name: 'project_schedule', row_count: 12431, class: 'delete' },
    { table_name: 'wbs_nodes',        row_count: 7,     class: 'delete' },
    { table_name: 'user_notes',       row_count: 3,     class: 'unlink' },
    { table_name: 'calendars',        row_count: 1,     class: 'delete' },
  ];
  let lastModal = null, previewCalls = 0, runCalls = 0, toasts = [];
  const env = {
    Fmt: { esc: s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])) },
    UI: { modal(h) { lastModal = makeModal(h); return lastModal; }, toast(msg, kind) { toasts.push([msg, kind]); } },
    PDb: {
      previewProjectDelete() { previewCalls++; return Promise.resolve(ROWS); },
      deleteProject() { runCalls++; return Promise.resolve(); },
    },
    reloadData: async function () {},
  };
  const ctx = build(env);

  console.log('\n=== A · the preview path (a project delete) ===');
  ctx.deleteProjectModal({ id: 'OPW101' }, null);
  const M = lastModal, echo = M.el._byId['d-echo'], go = M.el._byId['d-go'], prev = M.el._byId['d-prev'];
  ok('the modal opens immediately, before the preview answers', !!M);
  ok('the echo input starts DISABLED', /id="d-echo"[^>]*disabled/.test(M.el.innerHTML));
  ok('a "checking" line is shown while the read is out', M.el.innerHTML.indexOf('Checking what will be deleted') >= 0);
  ok('the button is disabled before the preview lands', go.disabled === true);
  echo.value = 'OPW101'; echo.oninput();
  ok('the exact id typed BEFORE the preview lands still does not arm it', go.disabled === true);

  await sleep(); await sleep();
  ok('previewProjectDelete called EXACTLY once', previewCalls === 1, previewCalls);
  ok('the echo input is enabled once the preview lands', echo.disabled === false);
  ok('the button label carries the row count', go.textContent.indexOf('12,439') >= 0, go.textContent);
  ok('the count EXCLUDES the unlink rows (12431+7+1, not +3)',
     go.textContent.indexOf('12,439') >= 0 && go.textContent.indexOf('12,442') < 0, go.textContent);

  echo.value = 'OPW101'; echo.oninput();
  ok('an exact match arms the button', go.disabled === false);
  echo.value = 'OPW101 '; echo.oninput();
  ok('a trailing space still arms (the shipped rule trims)', go.disabled === false);
  echo.value = 'opw101'; echo.oninput();
  ok('a CASE difference does NOT arm', go.disabled === true);
  echo.value = 'OPW10'; echo.oninput();
  ok('a prefix does NOT arm', go.disabled === true);
  echo.value = 'OPW101'; echo.oninput();

  console.log('\n=== B · what the preview renders ===');
  const H = prev ? prev.innerHTML : '';   // absent in the no-preview contrast
  ok('a "Deleted permanently" heading', H.indexOf('Deleted permanently') >= 0);
  ok('a "Kept, unlinked from this project" heading', H.indexOf('Kept, unlinked from this project') >= 0);
  ok('project_schedule renders its exact count', H.indexOf('project_schedule — 12,431') >= 0, H);
  ok('wbs_nodes renders its exact count', H.indexOf('wbs_nodes — 7') >= 0);
  ok('user_notes renders its exact count', H.indexOf('user_notes — 3') >= 0);
  const iKept = H.indexOf('Kept, unlinked'), iNotes = H.indexOf('user_notes'), iSched = H.indexOf('project_schedule');
  // ORDER, not the class attribute: asserting class="unlink" would only prove
  // the string was echoed back, not that it rendered under the right heading.
  ok('user_notes sits UNDER the kept heading', iNotes > iKept);
  ok('project_schedule sits ABOVE the kept heading', iSched < iKept);
  ok('biggest count first within a section', H.indexOf('project_schedule') < H.indexOf('wbs_nodes'));

  console.log('\n=== C · the run ===');
  const c1 = click(go), c2 = click(go);   // second click lands on a now-disabled button
  await sleep(); await sleep(); await sleep();
  ok('the first click was accepted', c1 === true);
  ok('the second click was REFUSED by the disabled button', c2 === false);
  ok('opts.run fired EXACTLY once under a double-click', runCalls === 1, runCalls);
  ok('the modal closed', M.closed === true);
  ok('a success toast was raised', toasts.some(t => t[1] === 'ok'));

  console.log('\n=== D · a REJECTING preview must never arm ===');
  previewCalls = 0; runCalls = 0; toasts = [];
  const env2 = Object.assign({}, env, { PDb: Object.assign({}, env.PDb, {
    previewProjectDelete() { previewCalls++; return Promise.reject(new Error('permission denied')); } }) });
  const ctx2 = build(env2);
  ctx2.deleteProjectModal({ id: 'OPW101' }, null);
  const M2 = lastModal, echo2 = M2.el._byId['d-echo'], go2 = M2.el._byId['d-go'];
  const prev2 = M2.el._byId['d-prev'] || { innerHTML: '' };
  await sleep(); await sleep();
  echo2.value = 'OPW101'; echo2.oninput();
  ok('the button is STILL disabled after a failed preview', go2.disabled === true);
  ok('the echo input stays disabled', echo2.disabled === true);
  ok('the failure names the cause', prev2.innerHTML.indexOf('permission denied') >= 0);
  ok('the failure says nothing will be removed', prev2.innerHTML.indexOf('not armed') >= 0);
  ok('it names the migration to run', prev2.innerHTML.indexOf('2026-09-16-delete-project-purge.sql') >= 0);
  ok('run was never called', runCalls === 0);

  console.log('\n=== E · NO preview (the group-head path) must be unchanged ===');
  previewCalls = 0;
  const ctx3 = build(env);
  let ghRun = 0;
  ctx3.confirmDelete({ id: 'GH-01', title: 'Delete group head GH-01?', body: 'x',
    ok: 'Group head deleted', run: function () { ghRun++; return Promise.resolve(); } });
  const M3 = lastModal, echo3 = M3.el._byId['d-echo'], go3 = M3.el._byId['d-go'];
  ok('NO preview block is rendered at all', M3.el._byId['d-prev'] === undefined);
  ok('the echo input is NOT disabled', /id="d-echo"\s+autocomplete/.test(M3.el.innerHTML));
  ok('previewProjectDelete was never called', previewCalls === 0);
  ok('the button starts disabled (unchanged)', go3.disabled === true);
  echo3.value = 'GH-01'; echo3.oninput();
  ok('typing the id arms it with no preview at all', go3.disabled === false);
  echo3.value = 'GH-0'; echo3.oninput();
  ok('a prefix un-arms it', go3.disabled === true);
  ok('the button label is untouched by the preview path', go3.textContent === '', JSON.stringify(go3.textContent));

  console.log('\n=== F · the copy that had become false ===');
  const body = M.el.innerHTML;
  ok('the dialog no longer claims the delete is refused', body.indexOf('It is refused while') < 0);
  ok('it no longer claims an error names what is blocking', body.indexOf('names what is') < 0);
  ok('it says the files in storage are NOT removed', body.indexOf('Files in storage are NOT removed') >= 0);
  ok('it says notebook entries are kept', body.indexOf('Notebook entries are <b>kept</b>') >= 0);
  ok('it still offers Archive as the reversible alternative', body.indexOf('Archive') >= 0);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
