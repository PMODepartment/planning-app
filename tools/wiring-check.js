/* ARE THE MODULES ACTUALLY CONNECTED? — executed, not read.
 *
 * Owner: *"Make sure every module connected with each other properly."*
 *
 * ⚠️⚠️ THE FAILURE THIS EXISTS FOR IS ON FILE AND IT KILLED A LIVE MODULE. On 2026-09-10 (z6) the
 * whole Contracts & Claims BOQ was dead in production because `boq.js`'s `_internals` export named
 * `locKey`, a function deleted in the same refactor. The object literal is evaluated when the IIFE
 * returns, so it threw there, `window.BOQ` was NEVER ASSIGNED, and every BOQ feature went down
 * together. `node --check` PARSES that file happily — a ReferenceError is a runtime fact.
 *
 * So this LOADS each shipped browser script against a window stub and asserts three things:
 *   1. the file's global actually gets assigned            (the z6 failure)
 *   2. no exported key is undefined                        (a second stale name hiding behind it)
 *   3. every cross-module call a consumer makes names a key its provider really exports
 *
 * ⚠️ (3) is the half that answers the owner's question. (1) and (2) prove a module LOADS; (3)
 * proves module A can actually reach the function it calls in module B.
 */
const fs = require('fs'), path = require('path');
const scan = require('./scan.js');

// ⚠️ The scanner proves itself before this file reports anything. Findings from an untrustworthy
//    scanner are worse than no findings — one false one teaches people to skip the report.
const _scanBad = scan.selfTest();
if (_scanBad.length) {
  console.log('scan.js self-test FAILED — aborting:\n  ' + _scanBad.join('\n  '));
  process.exit(2);
}

const ROOT = '.';
const SKIP_DIR = new Set(['.git', 'node_modules', 'docs', 'migrations', 'supabase', 'services']);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(path.join(dir, e.name), out); }
    else out.push(path.join(dir, e.name));
  }
  return out;
}
const FILES = walk(ROOT, []).map(p => p.replace(/\\/g, '/'));
const JS = FILES.filter(f => f.endsWith('.js') && !/harness|test\.js$|\/scratch/.test(f));

let pass = 0, fail = 0, warn = 0;
const ok = (label, cond, detail) => {
  if (cond) pass++;
  else { fail++; console.log('  FAIL ' + label + (detail ? '\n        ' + detail : '')); }
};

/* ---------------------------------------------------------------- the stub
   Deliberately thin. A stub that answers everything would let a module that calls a function
   nobody provides look healthy — the opposite of what this checks. */
function makeWindow() {
  const noop = function () {};
  const chain = () => new Proxy(noop, { get: () => chain(), apply: () => chain() });
  const win = {
    document: new Proxy({}, {
      get(t, k) {
        if (k === 'readyState') return 'complete';
        if (k === 'documentElement' || k === 'body' || k === 'head') return chain();
        if (k === 'currentScript') return { src: 'x.js?v=test' };
        return chain();
      },
    }),
    navigator: { userAgent: 'node', onLine: true, serviceWorker: undefined },
    location: { href: 'https://x/y.html', pathname: '/y.html', search: '', hash: '', origin: 'https://x' },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    addEventListener: noop, removeEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop }),
    setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
    requestAnimationFrame: noop, cancelAnimationFrame: noop,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    console, Math, Date, JSON, Intl, URL, URLSearchParams, Promise, Proxy, Reflect,
    supabase: { createClient: () => chain() },
  };
  win.window = win; win.self = win; win.globalThis = win;
  return win;
}

/* ⚠️ A BROWSER EXPOSES THESE AS BARE GLOBALS, and `new Function` resolves a bare name against the
   real global scope, not against the `window` object passed in. theme.js calls matchMedia()
   unqualified, and the first run reported it as a load failure — the harness's fault, not the
   file's. One runner, used by the self-test and the sweep alike, so they cannot diverge. */
function runScript(src, win) {
  return new Function(
    'window', 'self', 'globalThis', 'document', 'console', 'localStorage', 'sessionStorage',
    'navigator', 'location', 'matchMedia', 'addEventListener', 'fetch', 'setTimeout',
    'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'alert', 'confirm',
    'prompt', src)(
      win, win, win, win.document, console, win.localStorage, win.sessionStorage, win.navigator,
      win.location, win.matchMedia, win.addEventListener, win.fetch, win.setTimeout,
      win.clearTimeout, win.setInterval, win.clearInterval, win.requestAnimationFrame,
      function () {}, function () { return true; }, function () { return null; });
}

/* ---------------------------------------------------------- 0 · does it BITE?
   ⚠️ A CHECKER THAT HAS NEVER FAILED PROVES NOTHING. Before reporting on the real tree, the z6
   outage is reproduced in memory against the real boq.js: a name is added to the `_internals`
   export that no longer exists. That is byte-for-byte the shape that killed the module — the
   object literal is evaluated when the IIFE returns, so it throws there and window.BOQ is never
   assigned. If this does not fail, nothing below means anything. */
(function selfTest() {
  const src = fs.readFileSync('modules/contracts-claims/boq.js', 'utf8');
  const broken = src.replace('_internals: {', '_internals: { locKey: locKey,');
  if (broken === src) { console.log('  SELFTEST INCONCLUSIVE: could not inject the z6 shape'); return; }
  const win = makeWindow();
  let threw = null;
  try { runScript(broken, win); } catch (e) { threw = e; }
  const caught = !!threw && /locKey is not defined/.test(threw.message) && win.BOQ === undefined;
  if (!caught) {
    console.log('  SELFTEST FAILED — the z6 defect was injected and this checker did not catch it.');
    console.log('  Nothing below can be trusted. Aborting.');
    process.exit(2);
  }
  console.log('  self-test: z6 reproduced and caught (window.BOQ never assigned) ✓\n');
})();

/* ------------------------------------------------- 1 + 2 · every script loads */
console.log('='.repeat(78));
console.log('1 · every shipped browser script LOADS and assigns its global');
console.log('='.repeat(78));

const EXPORTS = {};          // globalName -> Set(keys)
const PROVIDER_FILE = {};    // globalName -> file

for (const f of JS) {
  const src = fs.readFileSync(f, 'utf8');
  if (/^\s*(const|let|var)?\s*\w+\s*=\s*require\(/m.test(src)) continue;   // node script, not a browser one
  const assigns = [...src.matchAll(/window\.([A-Z][A-Za-z0-9_]*)\s*=/g)].map(m => m[1]);
  if (!assigns.length) continue;
  const win = makeWindow();
  let threw = null;
  try { runScript(src, win); } catch (e) { threw = e; }
  ok(f + ' loads', !threw, threw && (threw.name + ': ' + threw.message));
  if (threw) continue;
  for (const g of new Set(assigns)) {
    const v = win[g];
    ok(f + ' assigns window.' + g, v !== undefined && v !== null);
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      const undef = keys.filter(k => { try { return v[k] === undefined; } catch (e) { return false; } });
      ok('window.' + g + ' has no undefined export', undef.length === 0, undef.join(', '));
      EXPORTS[g] = new Set(keys);
      PROVIDER_FILE[g] = f;
      // one level down: _internals is where z6 hid
      if (v._internals && typeof v._internals === 'object') {
        const iu = Object.keys(v._internals).filter(k => v._internals[k] === undefined);
        ok('window.' + g + '._internals has no undefined export', iu.length === 0, iu.join(', '));
      }
    }
  }
}

/* ---------------------------------------- 3 · cross-module calls resolve */
console.log('');
console.log('='.repeat(78));
console.log('3 · every cross-module call names a key its provider really exports');
console.log('='.repeat(78));

const PROVIDERS = Object.keys(EXPORTS).sort();
console.log('  providers loaded: ' + PROVIDERS.join(', ') + '\n');

const SRC_FILES = FILES.filter(f => (f.endsWith('.js') || f.endsWith('.html')) && !/harness|test\.js$/.test(f));
let checked = 0;
const missing = [];
for (const f of SRC_FILES) {
  let src = fs.readFileSync(f, 'utf8');
  /* ⚠️ HTML COMMENTS ARE PROSE TOO. The first run reported PPR._syncSelChrome as an unresolved
     cross-module call. It occurs exactly once in the whole repo — inside an <!-- … --> block
     explaining the selection chrome. Stripping only JS comments turns documentation into a
     finding, which is how a checker trains people to ignore it. */
  /* ⚠️⚠️ AND COMMENTS ARE NOW STRIPPED BY scan.js, NOT BY A LINE REGEX. This file shipped with a
     line-comment regex that eats every line containing a double slash INSIDE A STRING — an https
     URL, a regex, a path — deleting real source with it. Measured on equipment-loading: four live
     classes vanished from a sibling check built the same way. The direction of that error HERE is a
     FALSE NEGATIVE — fewer references seen, so a genuinely broken one could slip through — which is
     exactly the flaw a green result hides. scan.js self-tests before anything runs. */
  src = scan.clean(f, src);
  for (const g of PROVIDERS) {
    if (PROVIDER_FILE[g] === f) continue;                                    // its own definition
    const re = new RegExp('(?:window\\.)?\\b' + g + '\\.([A-Za-z_$][\\w$]*)', 'g');
    for (const m of src.matchAll(re)) {
      const key = m[1];
      if (key === 'prototype' || key === 'call' || key === 'apply' || key === 'bind') continue;
      checked++;
      if (!EXPORTS[g].has(key)) missing.push({ file: f, ref: g + '.' + key });
    }
  }
}
const uniq = [...new Map(missing.map(x => [x.file + '|' + x.ref, x])).values()];
// ⚠️ Printed even when it passes. "0 failed" over 40 references and over 4,000 are very different
//    statements, and a checker that hides its own coverage cannot be audited.
console.log('  ' + checked + ' references checked across ' + SRC_FILES.length + ' files');
ok(checked + ' cross-module references all resolve', uniq.length === 0);
for (const x of uniq) console.log('        ' + x.ref.padEnd(34) + x.file);

/* ------------------------------------- 4 · every referenced asset exists, once */
console.log('');
console.log('='.repeat(78));
console.log('4 · assets: every reference resolves, and each is on ONE version');
console.log('='.repeat(78));

const HTML = FILES.filter(f => f.endsWith('.html') && !/harness/.test(f));
const seenVer = {};       // asset path -> Set(version)
const dead = [];
for (const f of HTML) {
  const src = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, ' ');
  const dir = path.posix.dirname(f);
  for (const m of src.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) {
    const raw = m[1];
    if (/^(https?:|data:|mailto:|#|\/\/)/.test(raw)) continue;          // external or in-page
    const [rel, qs] = raw.split('?');
    if (!/\.(js|css|png|jpg|jpeg|svg|webmanifest|ico)$/i.test(rel)) continue;
    const resolved = path.posix.normalize(path.posix.join(dir, rel));
    if (!fs.existsSync(resolved)) dead.push(f + '  ->  ' + raw);
    // ⚠️ Version splits are tracked per RESOLVED PATH, never per basename: every module has its
    //    own module.css, and grouping by basename reports a split that does not exist.
    const v = (qs && /(?:^|&)v=([^&]*)/.exec(qs) || [])[1];
    if (v) { (seenVer[resolved] = seenVer[resolved] || new Set()).add(v); }
  }
}
ok('every referenced asset exists on disk', dead.length === 0, dead.slice(0, 12).join('\n        '));

const split = Object.entries(seenVer).filter(([, s]) => s.size > 1);
ok('no shared asset is referenced at two different versions', split.length === 0,
   split.map(([p, s]) => p + '  ' + [...s].join(' vs ')).join('\n        '));

/* ------------------------------- 5 · every enabled module's page really exists */
const cfgSrc = fs.readFileSync('assets/js/config.js', 'utf8');
const cfgWin = makeWindow();
try { runScript(cfgSrc, cfgWin); } catch (e) {}
const mods = (cfgWin.APP_CONFIG && cfgWin.APP_CONFIG.MODULES) || [];
const badPath = mods.filter(m => m && m.enabled && m.path && !fs.existsSync(m.path));
ok(mods.filter(m => m && m.enabled).length + ' enabled modules all have a real page',
   badPath.length === 0, badPath.map(m => m.key + ' -> ' + m.path).join(', '));

console.log('');
console.log('  ' + pass + ' passed, ' + fail + ' failed' + (warn ? ', ' + warn + ' warned' : ''));
process.exit(fail ? 1 : 0);
