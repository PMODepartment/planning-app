/* A character walker for SQL: blanks comments, blanks string bodies, keeps
   offsets. ⚠️ REGEXES CANNOT DO THIS, and both failure directions bit me here:
     - strip `--` comments first  -> a `--` INSIDE a string literal chops the
       string, leaving an unterminated quote that swallows the rest of the file.
       (This is the `tools/scan.js` lesson, in SQL.)
     - strip strings first        -> an apostrophe inside a COMMENT
       ("somebody's own notes") opens a phantom string.
   So it is one pass that knows which state it is in. */
function scanSql(src) {
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '-' && d === '-') {                       // line comment
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {                       // block comment
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += (src[i] === '\n' ? '\n' : ' '); i++; }
      out += '  '; i += 2;
      continue;
    }
    if (c === "'") {                                    // string literal
      out += "'"; i++;
      while (i < n) {
        if (src[i] === "'" && src[i + 1] === "'") { out += '  '; i += 2; continue; }
        if (src[i] === "'") break;
        out += (src[i] === '\n' ? '\n' : ' '); i++;
      }
      out += "'"; i++;
      continue;
    }
    if (c === '"') {                                    // quoted identifier
      out += '"'; i++;
      while (i < n && src[i] !== '"') { out += src[i]; i++; }
      out += '"'; i++;
      continue;
    }
    out += c; i++;
  }
  return out;
}
// ---- self-test, on the shapes that broke the regex versions ----------------
const CASES = [
  ["raise exception 'a -- b'; end if;", 'end if', '-- inside a string must NOT start a comment'],
  ["-- somebody's own notes\nend loop;", 'end loop', "an apostrophe in a comment must NOT start a string"],
  ["execute format('x %I', t); end;", 'end', 'ordinary string + code after it'],
  ["/* block 'quote' -- dash */ end if;", 'end if', 'block comment containing both'],
];
let ok = true;
for (const [src, must, why] of CASES) {
  const got = scanSql(src);
  const pass = got.indexOf(must) >= 0 && got.indexOf('-- b') < 0;
  if (!pass) { ok = false; console.log('  SELF-TEST FAIL: ' + why + '  ->  ' + JSON.stringify(got)); }
}
console.log('sqlscan self-test: ' + (ok ? 'PASS (4/4)' : 'FAIL'));
if (!ok) process.exit(2);
module.exports = { scanSql };
