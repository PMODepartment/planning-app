/* SLICING A FUNCTION OUT OF THE SHIPPED index.html BY NAME — shared by the executed suites.
 *
 * ⚠️⚠️ THE SUITES RUN THE SHIPPED CODE. Nothing in this repo's test files may re-implement the
 *    rule under test: a suite that re-implements it proves the re-implementation, and this repo
 *    has been caught by that four times. So every suite slices the real function out of
 *    `index.html` by NAME and runs it, and this is the one slicer they share — a second copy is
 *    how two suites start disagreeing about what "the shipped function" means.
 * ⚠️ BY NAME, NEVER BY LINE NUMBER — that file is ~50,000 lines and under concurrent edit.
 */
'use strict';

const scan = require('../../tools/scan.js');

function makeSlicer(src) {
  /* ⚠️ Comments are blanked through tools/scan.js first — a `{` inside a comment miscounts the
     braces, which is the trap that scanner exists for. String bodies are kept, so the walker
     below still has to step over quotes itself. */
  const mask = scan.blankComments(src);
  const BS = String.fromCharCode(92);
  function endOf(i) {
    let k = mask.indexOf('{', i), d = 0;
    for (; k < mask.length; k++) {
      const ch = mask[k];
      if (ch === '"' || ch === "'" || ch === '`') {
        const q = ch; k++;
        while (k < mask.length && mask[k] !== q) { if (mask[k] === BS) k++; k++; }
        continue;
      }
      if (ch === '{') d++;
      else if (ch === '}') { d--; if (!d) return k + 1; }
    }
    throw new Error('unbalanced');
  }
  function sliceFn(name) {
    const i = src.indexOf('function ' + name + '(');
    if (i < 0) throw new Error('SLICE FAILED: function ' + name + ' — aborting rather than comparing nothing');
    const out = src.slice(i, endOf(i));
    try { new Function('return (' + out + ')'); }
    catch (e) { throw new Error('slice of ' + name + ' does not parse: ' + e.message); }
    return out;
  }
  function sliceVarLine(name) {
    const i = src.indexOf('var ' + name + ' = ');
    if (i < 0) throw new Error('SLICE FAILED: var ' + name + ' — aborting rather than comparing nothing');
    const j = src.indexOf(String.fromCharCode(10), i);
    const t = src.slice(i, j < 0 ? src.length : j).trim();
    return /;$/.test(t) ? t : t + ';';
  }
  /* An ANONYMOUS function expression, sliced by the text that precedes it. ⚠️ For code that has
     not been given a name yet — a comparator passed straight to `.sort()`, say. It is still the
     SHIPPED function, byte for byte; the anchor only says where to start looking. Preferred only
     where a name does not exist: a named slice cannot silently follow the wrong `function (`.
     ⚠️ `after` is matched in the COMMENT-BLANKED source, so an anchor that also appears in a
     comment above the real one cannot win. */
  function sliceAnon(after, sig) {
    const i = mask.indexOf(after);
    if (i < 0) throw new Error('SLICE FAILED: anchor ' + JSON.stringify(after) + ' — aborting rather than comparing nothing');
    const j = mask.indexOf(sig, i);
    if (j < 0) throw new Error('SLICE FAILED: ' + JSON.stringify(sig) + ' after ' + JSON.stringify(after));
    const out = src.slice(j, endOf(j));
    try { new Function('return (' + out + ')'); }
    catch (e) { throw new Error('anonymous slice after ' + after + ' does not parse: ' + e.message); }
    return out;
  }
  return { sliceFn, sliceVarLine, sliceAnon };
}

module.exports = { makeSlicer };
