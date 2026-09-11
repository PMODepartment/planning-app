/* A string-and-comment aware scanner for this repo's JS/HTML. Shared, self-testing.
 *
 * ⚠️⚠️ WHY THIS EXISTS: a naive line-comment stripper — one regex matching a double slash to
 * end-of-line — DESTROYS this source. A double slash inside a string (an https URL, a regex, a
 * path) eats the rest of that line, taking real markup with it. Measured: with naive stripping,
 * `class="eq-plan-zoom"` and three of its neighbours VANISHED from equipment-loading, and a
 * dead-hook check built on it reported four perfectly live classes as dead. Without stripping, all
 * four are found.
 *
 * ⚠️ And writing THAT sentence broke the file: quoting the regex put a comment terminator inside
 * this very comment. The trap is not hypothetical even here.
 *
 * Same failure family as uicopy.py's tokeniser, which had to learn regex literals and then
 * keyword-preceded regex literals before its findings meant anything. This is that algorithm in JS,
 * with the same rule: it proves itself on known-good shapes before any caller trusts it.
 */
'use strict';

const KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void',
                          'instanceof', 'do', 'else', 'yield', 'await', 'throw']);

/* Walk `src` once, classifying every character. Returns a copy with COMMENTS blanked to spaces and
 * everything else — code and string bodies — left byte-for-byte in place, so offsets and line
 * numbers survive. Strings are kept because a class attribute lives inside one. */
function blankComments(src) {
  const out = src.split('');
  let i = 0, n = src.length, prev = '', prevWord = '';
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };

  while (i < n) {
    const c = src[i];
    if (c === '\n') { i++; prev = '\n'; prevWord = ''; continue; }

    if (c === '/' && i + 1 < n) {
      if (src[i + 1] === '/') { const j = src.indexOf('\n', i); const e = j < 0 ? n : j; blank(i, e); i = e; continue; }
      if (src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); const e = j < 0 ? n : j + 2; blank(i, e); i = e; continue; }
      // ⚠️ A regex literal. A `/` starts one only where a value cannot already have ended — and the
      //    LAST CHARACTER cannot tell you that: `return /[",]/` ends in 'n'. Track the last word too.
      const regexOk = KEYWORDS.has(prevWord) ||
        (!')]}'.includes(prev) && !/[\w$]/.test(prev));
      if (regexOk) {
        let j = i + 1, esc = false, cls = false, closed = false;
        while (j < n) {
          const d = src[j];
          if (esc) esc = false;
          else if (d === '\\') esc = true;
          else if (d === '[') cls = true;
          else if (d === ']') cls = false;
          else if (d === '/' && !cls) { closed = true; break; }
          else if (d === '\n') break;              // a newline means it was a divide after all
          j++;
        }
        if (closed) { i = j + 1; prev = '/'; prevWord = ''; continue; }
      }
    }

    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        j++;
      }
      i = j + 1; prev = c; prevWord = '';
      continue;                                    // string body is LEFT INTACT
    }

    if (!/\s/.test(c)) {
      prev = c;
      if (/[\w$]/.test(c)) {
        let k = i; while (k < n && /[\w$]/.test(src[k])) k++;
        prevWord = src.slice(i, k); i = k; continue;
      }
      prevWord = '';
    }
    i++;
  }
  return out.join('');
}

/* HTML comments, for .html files. Applied before the JS pass. */
function blankHtmlComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
}

function clean(file, src) {
  return blankComments(file.endsWith('.html') ? blankHtmlComments(src) : src);
}

/* ------------------------------------------------------------------ self-test
   ⚠️ A scanner that has never been wrong about known-good code cannot be trusted about unknown
   code. Every case here is a shape that broke an earlier version of this algorithm. */
function selfTest() {
  const cases = [
    ["var s = 'a//b'; var t = 1;",                      s => s.includes("'a//b'")],
    ["var u = 'https://x.test/y'; var z = 2;",           s => s.includes('https://x.test/y')],
    ["// gone\nvar keep = 1;",                           s => !s.includes('gone') && s.includes('keep')],
    ["/* gone */ var keep2 = 2;",                        s => !s.includes('gone') && s.includes('keep2')],
    ['return /[",\\r\\n]/.test(s); // gone',             s => !s.includes('gone')],
    ["var re = /can\\'t/; var keep3 = 3;",               s => s.includes('keep3')],
    ["var d = a / b; var keep4 = 4;",                    s => s.includes('keep4')],
    ['h += \'<div class="eq-plan-zoom" x>\';',           s => s.includes('class="eq-plan-zoom"')],
    ['h += \'<div class="a\' + v + \' b">\';',           s => s.includes('class="a') && s.includes(' b"')],
  ];
  const bad = [];
  for (const [src, want] of cases) if (!want(blankComments(src))) bad.push(src);
  const html = blankHtmlComments('<!-- gone --><div class="live">');
  if (html.includes('gone') || !html.includes('class="live"')) bad.push('html comment');
  return bad;
}

module.exports = { clean, blankComments, blankHtmlComments, selfTest };

if (require.main === module) {
  const bad = selfTest();
  if (bad.length) { console.log('SELFTEST FAILED:\n  ' + bad.join('\n  ')); process.exit(2); }
  console.log('scan.js self-test: ' + 10 + ' shapes, all correct');
}
