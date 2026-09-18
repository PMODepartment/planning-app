// tools/type-scale.js - run: node tools/type-scale.js
//
// Finds type that is off the --pd-fs-* scale, and weights Gotham does not have.
//
// The scale exists because an audit once counted 29 DISTINCT font-size values in 1,997
// declarations across the shared CSS and sixteen modules - "most of what reads as 'each
// module was built by a different person'". The rungs are read from dashboard.css here
// rather than listed, so this checker cannot drift from the scale it enforces.
//
// It also flags font-weight:600. Gotham has no Semibold, so 600 renders as a synthesised
// bold on some platforms and as 500 or 700 on others - the one weight that is guaranteed
// to look different from machine to machine.
//
// THE TWO DOCUMENTED EXEMPTIONS ARE ENCODED, not baselined, because they are decisions
// with a REASON and a baseline forgets the reason:
//   (1) `font-size` on an SVG <text> is in USER UNITS, not pixels. It scales with the
//       viewBox, so it is not comparable to a CSS pixel and the scale does not apply.
//   (2) print/export stylesheets EMITTED AS STRINGS are laid out for paper, not screen.
//       Those arrive inside a <script>, which is how this file tells them apart.
// Both are stated in dashboard.css's own type-scale note. A 2026-09-18 sweep re-derived
// all four SVG cases by hand because only two were named there - this file is the
// machine-readable half of that note.
//
// WHAT IT DOES NOT COVER, stated rather than implied:
//   - font-family. A bare <button> that sets a size but no family renders in the UA's
//     Arial, which this file cannot see: it reads declarations, and the defect is an
//     ABSENT one. `.pd-btn` carried it app-wide until 2026-09-17 and `.ps-menu button`
//     until 2026-09-18. Both were found by a browser control assertion, not a parse.
//   - line-height, letter-spacing, and whether a size is LEGIBLE where it lands.
//   - inline `style="font-size:12px"` on markup. That is where the Colours... button's
//     off-scale 12px hid from a computed-style audit; it is markup, not CSS, and a
//     future pass could add it.
//
// It SELF-TESTS before reporting anything. Every shape below broke an earlier version.

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');

/* ---------------------------------------------------------------- parsing */

// Blank comments and string INTERIORS to spaces so a brace inside either cannot drift
// the depth counter. Length is preserved, so every index still addresses the original.
// (The project-schedule sheet quotes `function () {` in its prose; a raw brace count
// reads UNBALANCED on a perfectly valid stylesheet without this.)
function mask(css) {
  var out = css.split('');
  var i = 0, n = css.length;
  while (i < n) {
    var c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      var j = css.indexOf('*/', i + 2);
      j = j === -1 ? n : j + 2;
      for (var k = i; k < j; k++) out[k] = ' ';
      i = j;
    } else if (c === '"' || c === "'") {
      var q = c, m = i + 1;
      while (m < n && css[m] !== q) m += css[m] === '\\' ? 2 : 1;
      for (var t = i + 1; t < Math.min(m, n); t++) out[t] = ' ';
      i = Math.min(m + 1, n);
    } else {
      i++;
    }
  }
  return out.join('');
}

// Every rule at this level, as { sel, body }. Bodies come from the ORIGINAL source so
// values survive; only the brace walk reads the masked copy.
function blocks(css) {
  var m = mask(css), n = css.length, i = 0, out = [];
  while (i < n) {
    var b = m.indexOf('{', i);
    if (b === -1) break;
    var sel = m.slice(i, b);
    // A statement at-rule (@import, @charset) ends in ';' and owns no block; without
    // this it glues itself to the next selector. dashboard.css opens with @import.
    var semi = sel.lastIndexOf(';');
    if (semi !== -1) sel = sel.slice(semi + 1);
    var depth = 1, j = b + 1;
    while (j < n && depth) {
      if (m[j] === '{') depth++;
      else if (m[j] === '}') depth--;
      j++;
    }
    out.push({ sel: sel.trim(), body: css.slice(b + 1, j - 1) });
    i = j;
  }
  return out;
}

/* ------------------------------------------------------------------ scale */

// Read the rungs off dashboard.css. Listing them here instead would let this checker
// and the scale drift apart, which is the one failure that would make it worse than
// nothing: it would enforce a scale the app no longer uses.
function readScale() {
  var css = fs.readFileSync(path.join(ROOT, 'assets/css/dashboard.css'), 'utf8');
  var px = {}, re = /--pd-fs-([A-Za-z0-9-]+)\s*:\s*([0-9.]+)px/g, m;
  while ((m = re.exec(mask(css)))) px[parseFloat(m[2])] = '--pd-fs-' + m[1];
  return px;
}

/* -------------------------------------------------------------- the sizes */

// font-size:, plus the size inside a `font:` shorthand. The shorthand matters: a
// `font: 600 11.5px/1 inherit` carries BOTH an off-scale size and a 600 weight, and
// reading only `font-size:` misses both.
// ⚠ BOTH READ THE MASKED BODY. A declaration is preceded by `;` or by the start of the
// body - OR by a comment, and this sheet is full of them. `/* note */ font-size: 9px`
// matched neither anchor and was skipped outright. It cost two self-test failures, and
// the font-weight case PASSED FOR THE WRONG REASON: it reported no 600 because it had
// found nothing at all, comment and declaration alike. Masking blanks the comment and
// leaves the declaration where it is, so the anchors mean what they say.
function sizesIn(rawBody) {
  var body = mask(rawBody);
  var out = [], m;
  var re = /(^|;)\s*font-size\s*:\s*([^;}]+)/g;
  while ((m = re.exec(body))) out.push({ raw: m[2].trim(), from: 'font-size' });
  var sh = /(^|;)\s*font\s*:\s*([^;}]+)/g;
  while ((m = sh.exec(body))) {
    var px = m[2].match(/(^|[\s/])([0-9.]+)px/);
    if (px) out.push({ raw: px[2] + 'px', from: 'font shorthand' });
  }
  return out;
}

function weight600(rawBody) {
  var body = mask(rawBody);
  return /(^|;)\s*font-weight\s*:\s*600\s*(;|$)/.test(body) ||
         /(^|;)\s*font\s*:\s*[^;}]*\b600\b/.test(body);
}

/* ------------------------------------------------------------- exemptions */

// (1) SVG <text>. Tested on the MEDIUM, not the size, and on two independent signals:
//     the rule paints with `fill:` (meaningless on HTML text), and/or the class is
//     emitted on a <text> element somewhere in the repo. Both are reported so a weak
//     case is visible rather than silently swallowed.
function svgSignals(sel, body, textClasses) {
  var paints = /(^|;)\s*fill\s*:/.test(body);
  var onText = sel.split(',').some(function (part) {
    return (part.match(/\.[-A-Za-z0-9_]+/g) || []).some(function (c) {
      return textClasses[c.slice(1)];
    });
  });
  return { paints: paints, onText: onText, exempt: paints || onText };
}

// Every class seen on an <text ...> element, anywhere in the repo.
function collectTextClasses() {
  var seen = {};
  walkDir(ROOT, function (p) {
    if (!/\.(html|js)$/i.test(p)) return;
    var src = fs.readFileSync(p, 'utf8'), m;
    var re = /<text[^>]*class=(?:"|\\")([^"\\]+)/g;
    while ((m = re.exec(src))) m[1].split(/\s+/).forEach(function (c) { if (c) seen[c] = true; });
    // createElementNS + setAttribute('class', 'x') builds SVG text with no literal tag
    var ns = /createElementNS\([^)]*,\s*['"]text['"]\)/.test(src);
    if (ns) {
      var re2 = /setAttribute\(\s*['"]class['"]\s*,\s*['"]([^'"]+)/g, m2;
      while ((m2 = re2.exec(src))) m2[1].split(/\s+/).forEach(function (c) { if (c) seen[c] = true; });
    }
  });
  return seen;
}

/* ------------------------------------------------------------- collection */

function walkDir(dir, hit) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    if (e.name === '.git' || e.name === 'node_modules') return;
    var p = path.join(dir, e.name);
    if (e.isDirectory()) return walkDir(p, hit);
    // *harness* / _scratch* are gitignored scratch, not shipped source.
    if (/harness/i.test(e.name) || /^_scratch/i.test(e.name)) return;
    hit(p);
  });
}

// A sheet, plus whether it was EMITTED AS A STRING - exemption (2). A <style> inside a
// <script> is a print/export sheet built at runtime and laid out for paper. The naive
// regex alone cannot tell: project-schedule has three <style> matches and two of them
// are inside JS strings.
function sheetsOf(file) {
  var src = fs.readFileSync(file, 'utf8');
  if (/\.css$/i.test(file)) return [{ css: src, inScript: false }];
  if (!/\.html$/i.test(file)) return [];
  var scripts = [];
  var sre = /<script[^>]*>([\s\S]*?)<\/script>/gi, sm;
  while ((sm = sre.exec(src))) scripts.push([sm.index, sm.index + sm[0].length]);
  var out = [], re = /<style[^>]*>([\s\S]*?)<\/style>/gi, m;
  while ((m = re.exec(src))) {
    var at = m.index;
    var inScript = scripts.some(function (r) { return at > r[0] && at < r[1]; });
    out.push({ css: m[1], inScript: inScript });
  }
  return out;
}

function collect(css, where, inScript, scale, textClasses, acc) {
  blocks(css).forEach(function (r) {
    var inner = r.sel.charAt(0) === '@' ? blocks(r.body) : [r];
    inner.forEach(function (ir) {
      if (weight600(ir.body)) {
        acc.weights.push({ where: where, sel: ir.sel.replace(/\s+/g, ' ').slice(0, 64) });
      }
      sizesIn(ir.body).forEach(function (s) {
        acc.total++;
        var px = s.raw.match(/^([0-9.]+)px$/);
        if (!px) {
          // Counted, not lumped in with the failures: a value that is already a token is
          // the GOAL, and reporting it beside the literals made the summary read as if
          // 1,752 declarations were wrong when they are the ones doing it right.
          if (/var\(\s*--pd-fs-/.test(s.raw)) acc.token++; else acc.relative++;
          return;
        }
        var n = parseFloat(px[1]);
        if (scale[n]) { acc.onScale++; return; }
        if (inScript) { acc.exempt.push({ where: where, sel: ir.sel.slice(0, 54), px: n, why: 'print/export sheet (string-emitted)' }); return; }
        var sig = svgSignals(ir.sel, ir.body, textClasses);
        if (sig.exempt) {
          acc.exempt.push({ where: where, sel: ir.sel.replace(/\s+/g, ' ').slice(0, 54), px: n,
            why: 'SVG <text>, user units' + (sig.paints && sig.onText ? ' (fill: + <text>)' : sig.paints ? ' (fill: only)' : ' (<text> only)') });
          return;
        }
        acc.found.push({ where: where, sel: ir.sel.replace(/\s+/g, ' ').slice(0, 54), px: n, from: s.from });
      });
    });
  });
}

/* ------------------------------------------------------------- self-tests */

function selfTest() {
  var scale = { 10: '--pd-fs-micro', 11: '--pd-fs-xs', 13: '--pd-fs-base' };
  var textClasses = { 'svg-lab': true };
  function run(css, inScript) {
    var acc = { found: [], exempt: [], weights: [], total: 0, onScale: 0, token: 0, relative: 0 };
    collect(css, 'selftest', !!inScript, scale, textClasses, acc);
    return acc;
  }
  var a = run([
    "@import url('https://x/css2?family=A:wght@0,400&display=swap');",
    '.ok { font-size: 13px; }',
    '.cmt { /* } brace in a comment */ font-size: 9px; }',
    '.str::after { content: "}"; font-size: 9px; }',
    '@media (max-width: 700px) { .nested { font-size: 9px; } }',
    '.tok { font-size: var(--pd-fs-base); }',
    '.em { font-size: 1.2em; }',
    '.svgpaint { font-size: 8px; fill: #999; }',
    '.svg-lab { font-size: 9.5px; }',
    '.shorthand { font: 600 11.5px/1 inherit; }',
    '.heavy { font-weight: 600; }',
    '.notheavy { /* font-weight: 600 */ font-weight: 700; }'
  ].join('\n'));
  var px = a.found.map(function (x) { return x.sel.trim() + '@' + x.px; });
  var ex = a.exempt.map(function (x) { return x.sel.trim(); });
  var w = a.weights.map(function (x) { return x.sel.trim(); });
  var b = run('.printonly { font-size: 7px; }', true);

  var cases = [
    ['a statement @import does not swallow the next rule', px.indexOf('.cmt@9') !== -1 || a.onScale > 0],
    ['an on-scale size is not a finding', px.indexOf('.ok@13') === -1],
    ['a brace inside a comment does not drift the parse', px.indexOf('.cmt@9') !== -1],
    ['a brace inside a STRING does not drift the parse', px.indexOf('.str::after@9') !== -1],
    ['a size inside a nested @media is seen', px.indexOf('.nested@9') !== -1],
    ['a var(--pd-fs-*) value is not a finding', px.join().indexOf('.tok') === -1],
    ['an em value is not this check', px.join().indexOf('.em') === -1],
    ['a rule that paints with fill: is EXEMPT', ex.indexOf('.svgpaint') !== -1],
    ['a class emitted on <text> is EXEMPT', ex.indexOf('.svg-lab') !== -1],
    ['a `font:` shorthand size is caught', px.indexOf('.shorthand@11.5') !== -1],
    ['a `font:` shorthand 600 is caught', w.indexOf('.shorthand') !== -1],
    ['font-weight:600 is a finding', w.indexOf('.heavy') !== -1],
    ['a 600 inside a comment is NOT a finding', w.indexOf('.notheavy') === -1],
    ['a string-emitted print sheet is EXEMPT', b.found.length === 0 && b.exempt.length === 1]
  ];
  var bad = 0;
  cases.forEach(function (c) {
    if (!c[1]) bad++;
    console.log('  ' + (c[1] ? 'ok  ' : 'FAIL') + '  ' + c[0]);
  });
  return bad;
}

/* ---------------------------------------------------------------- verdict */

console.log('self-tests:');
var bad = selfTest();
if (bad) { console.error('\nSELF-TEST FAILED (' + bad + ') - not reporting.'); process.exit(2); }
console.log('');

var scale = readScale();
var rungs = Object.keys(scale).map(Number).sort(function (x, y) { return x - y; });
if (rungs.length < 5) { console.error('ABORT: read only ' + rungs.length + ' rungs from dashboard.css'); process.exit(2); }

var textClasses = collectTextClasses();
var acc = { found: [], exempt: [], weights: [], total: 0, onScale: 0, token: 0, relative: 0 };
var nfiles = 0;
walkDir(ROOT, function (p) {
  var sheets = sheetsOf(p);
  if (!sheets.length) return;
  nfiles++;
  var rel = path.relative(ROOT, p).replace(/\\/g, '/');
  sheets.forEach(function (s) { collect(s.css, rel, s.inScript, scale, textClasses, acc); });
});

console.log('scale, read from dashboard.css: ' + rungs.join(' / ') + ' px');
console.log('scanned ' + nfiles + ' files carrying a stylesheet');
console.log(acc.total + ' font-size declarations:');
console.log('  ' + acc.token + ' use a --pd-fs-* token       (the goal)');
console.log('  ' + acc.onScale + ' a literal px ON a rung');
console.log('  ' + acc.relative + ' relative or inherited (em/%/inherit) - not this check');
console.log('  ' + acc.exempt.length + ' exempt for a stated reason');
console.log('  ' + acc.found.length + ' OFF the scale');
console.log('');

if (acc.exempt.length) {
  console.log('--- exempt (' + acc.exempt.length + ') ---');
  acc.exempt.forEach(function (e) {
    console.log('  ' + String(e.px + 'px').padEnd(8) + e.where + '  ' + e.sel + '   ' + e.why);
  });
  console.log('');
}

var fail = acc.found.length + acc.weights.length;
if (!fail) {
  console.log('0 findings - every size is on a rung or exempt for a stated reason,');
  console.log('and nothing asks for a weight Gotham does not have.');
} else {
  if (acc.found.length) {
    console.log('=== ' + acc.found.length + ' size(s) off the scale ===');
    acc.found.forEach(function (e) {
      console.log('  ' + String(e.px + 'px').padEnd(8) + e.where + '  ' + e.sel + '  (' + e.from + ')');
    });
    console.log('  Reach for a rung. Never split one: 12px "because 12.5 looks big here"');
    console.log('  is how the 29 distinct values happened.');
    console.log('');
  }
  if (acc.weights.length) {
    console.log('=== ' + acc.weights.length + ' rule(s) asking for font-weight 600 ===');
    acc.weights.forEach(function (e) { console.log('  ' + e.where + '  ' + e.sel); });
    console.log('  Gotham has no Semibold. Use 500 or 700.');
  }
}
process.exit(fail ? 1 : 0);
