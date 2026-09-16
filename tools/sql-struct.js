/* Matches plpgsql block openers to their closers inside each $$ ... $$ body.
   Catches a missing `end if` / `end loop` — the likeliest hand-authoring error
   in a file no local Postgres can parse.
   ⚠️ SELF-TESTS FIRST, and it has been wrong TWICE: once matching `loop\n if`
   as one token (swallowing the `if`), once stripping `--` comments before
   strings (so a `--` inside an error message chopped the string). Both reported
   CORRECT functions as broken. A checker that cannot be right about correct code
   cannot be trusted about wrong code. */
const fs = require('fs');
const { scanSql } = require('./sql-scan.js');

function check(body) {
  const clean = scanSql(body).toLowerCase();
  // ⚠️ `end <kw>` must be tried BEFORE the bare keywords.
  const re = /\bend\s+(if|loop|case)\b|\b(begin|case|if|loop|end)\b/g;
  const stack = [], errs = []; let t;
  while ((t = re.exec(clean))) {
    if (t[1]) {
      const got = stack.pop();
      if (!got) errs.push('unmatched `end ' + t[1] + '`');
      else if (got !== t[1]) errs.push('`end ' + t[1] + '` closes a `' + got + '`');
    } else {
      const kw = t[2];
      if (kw === 'end') {
        const got = stack.pop();
        if (!got) errs.push('unmatched bare `end`');
        else if (got === 'if' || got === 'loop') errs.push('bare `end` closes an open `' + got + '`');
      } else if (kw === 'if') {
        // ⚠️ An `if` opens a block only when it is the plpgsql IF STATEMENT,
        // and the test is whether a `then` follows before the statement ends.
        //   `drop constraint if exists c;`      -> no `then`  -> DDL, opens nothing
        //   `add column if not exists x int;`   -> no `then`  -> DDL, opens nothing
        //   `if exists (select 1 ...) then`     -> has `then` -> a real block
        // My first cut skipped any `if` followed by `exists`, which threw away
        // that third shape and took the false positives from 3 to 38.
        const rest = clean.slice(re.lastIndex);
        const semi = rest.indexOf(';');
        const seg = semi < 0 ? rest : rest.slice(0, semi);
        const words = ' ' + seg.replace(/[^a-z]+/g, ' ').trim() + ' ';
        if (words.indexOf(' then ') < 0) continue;
        stack.push(kw);
      } else stack.push(kw);
    }
  }
  return { ok: stack.length === 0 && errs.length === 0, stack, errs };
}
const GOOD = "begin\n foreach t in array l loop\n if x then\n raise notice 'a -- b';\n end if;\n end loop;\nend";
const BROKEN = "begin\n foreach t in array l loop\n if x then\n raise notice 'x';\n end loop;\nend";
// The DDL shape above, as a self-test: it must read as BALANCED.
const DDL = ['begin',
  ' alter table t drop constraint if exists c;',
  ' alter table t add column if not exists x int;',
  ' if y then', '  null;', ' end if;', 'end'].join(String.fromCharCode(10));
const selfOk = check(GOOD).ok && !check(BROKEN).ok && check(DDL).ok;
console.log('plpgsql self-test: good=' + check(GOOD).ok + ' broken-caught=' + !check(BROKEN).ok + ' ddl=' + check(DDL).ok +
            (selfOk ? '   OK' : '   ABORT'));
if (!selfOk) process.exit(2);

let bad = 0;
// No arguments: every migration. There is no local Postgres here, so this is
// the only structural gate these files get. A file with no function body just
// reports 0 bodies, which is correct and costs nothing.
let targets = process.argv.slice(2);
if (!targets.length) {
  targets = fs.readdirSync('migrations')
    .filter(f => f.slice(-4) === '.sql')
    .map(f => 'migrations/' + f);
}
for (const p of targets) {
  const raw = fs.readFileSync(p, 'utf8');
  const bodies = []; const re = /\$\$([\s\S]*?)\$\$/g; let m;
  while ((m = re.exec(raw))) bodies.push(m[1]);
  console.log('\n' + p.split('/').pop() + '  —  ' + bodies.length + ' function body/bodies');
  bodies.forEach((b, i) => {
    const r = check(b);
    if (!r.ok) bad++;
    console.log('   body ' + (i + 1) + ': ' + (r.ok ? 'BALANCED'
      : 'UNBALANCED  leftover=[' + r.stack.join(',') + ']  ' + r.errs.join('; ')));
  });
}
process.exit(bad ? 1 : 0);
