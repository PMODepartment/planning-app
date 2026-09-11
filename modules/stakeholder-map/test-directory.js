// ============================================================================
// Stakeholder directory — invariant suite
// ----------------------------------------------------------------------------
// Run from the repo root:  node modules/stakeholder-map/test-directory.js
//
// WHAT THIS IS AND IS NOT. `modules/stakeholder-map/module.js` is a browser IIFE
// that closes over the Supabase client, the DOM and the shared MCCRCM engine, so
// it cannot be required into Node the way assets/js/mcc-rcm.js can (see
// test-rcm.js, which does execute its subject). What CAN be checked without a
// browser is the set of invariants that, if broken, produce a silent data bug
// rather than a visible error — and every assertion below was written from a
// mistake that was actually made and fixed while building this feature, not from
// a list of things that could theoretically go wrong.
//
// The one execution test at the end runs the real overlay semantics against a
// transcription of the shipped code, and asserts the transcription still matches
// the source — a fixture that has drifted from its subject tests nothing.
// ============================================================================
const fs = require('fs');
const path = require('path');
const here = (...p) => path.join(__dirname, ...p);
const root = (...p) => path.join(__dirname, '..', '..', ...p);

let fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  PASS ' + name); }
  else { fails++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}
function eq(name, a, b) {
  ok(name, JSON.stringify(a) === JSON.stringify(b),
     'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

const js  = fs.readFileSync(here('module.js'), 'utf8');
const css = fs.readFileSync(here('module.css'), 'utf8');
const html = fs.readFileSync(here('index.html'), 'utf8');
const sql = fs.readFileSync(root('migrations', '2026-09-08-stakeholder-directory.sql'), 'utf8');

// ---------------------------------------------------------------------------
console.log('\n[1] PERSON_FIELDS is the single contract, and its membership is deliberate');
// ---------------------------------------------------------------------------
const pfMatch = js.match(/var PERSON_FIELDS = \[([\s\S]*?)\];/);
ok('PERSON_FIELDS is declared exactly once', (js.match(/var PERSON_FIELDS =/g) || []).length === 1);
const PERSON_FIELDS = pfMatch
  ? pfMatch[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
  : [];
eq('PERSON_FIELDS is the 13 person facts, in the order the migration lists them',
   PERSON_FIELDS,
   ['name', 'title', 'nickname', 'role_title', 'organization', 'category',
    'stakeholder_group', 'email', 'contact', 'birthday',
    'photo_path', 'photo_thumb_path']);

// ⚠️ THE MOST IMPORTANT ASSERTION IN THIS FILE. Every one of these names a
// PERSON, which is exactly why someone will eventually "tidy up" by moving them
// into PERSON_FIELDS. They are PROJECT facts: the same mayor can be owned by
// two different Megawide people on two different jobs, and that is not a
// conflict to reconcile. Promoting any of them to global would silently
// overwrite one project's engagement ownership with another's.
['relationship_champion', 'relationship_owner', 'primary_responsible', 'alternate',
 'megawide_counterpart', 'engagement_plan', 'engagement', 'stk_category',
 'stk_sub_category', 'influence', 'interest', 'current_rel', 'target_rel',
 'sort_order', 'project_id'].forEach(f => {
  ok('`' + f + '` is NOT global — it stays a project fact', PERSON_FIELDS.indexOf(f) === -1);
});

// Every PERSON_FIELD must exist as a column on the directory table, or the
// overlay writes a key the server has never heard of and the save 400s.
const createBlock = (sql.match(/create table if not exists stakeholders \(([\s\S]*?)\n\);/) || [])[1] || '';
PERSON_FIELDS.forEach(f => {
  ok('the `stakeholders` table actually has a `' + f + '` column',
     new RegExp('^\\s*' + f + '\\s+\\w', 'm').test(createBlock));
});

// ---------------------------------------------------------------------------
console.log('\n[2] The save split reads the DIRECTORY, never the disabled inputs');
// ---------------------------------------------------------------------------
// A disabled <input> still reports its rendered value, so reading the band-1
// fields in the shared case would look right and be wrong in the worst way:
// it would re-assert a snapshot taken when the modal opened, overwriting any
// change another user made to that person in the meantime.
const ident2 = (js.match(/var ident2 = shared \? \{([\s\S]*?)\n      \} : \{/) || [])[1] || '';
ok('ident2 exists and is keyed on `shared`', !!ident2);
ok('its shared branch never reads a form field',
   ident2.length > 0 && !/q\('#f-/.test(ident2));
ok('its shared branch reads person.* for every field',
   (ident2.match(/person\./g) || []).length >= 11);
ok('the shared branch carries the photo paths (a picked person keeps their face)',
   /photo_path: person\.photo_path/.test(ident2) &&
   /photo_thumb_path: person\.photo_thumb_path/.test(ident2));
ok('`relationship_champion` is read from the form in BOTH cases, outside ident2',
   !/relationship_champion/.test(ident2) &&
   /relationship_champion: q\('#f-champ'\)/.test(js));
ok('the project payload is Object.assign(project, ident2) — one merge, not two lists',
   /var data = Object\.assign\(\{[\s\S]*?\}, ident2\);/.test(js));

// ---------------------------------------------------------------------------
console.log('\n[3] The identity band is locked when the person is shared');
// ---------------------------------------------------------------------------
ok('a `dis` flag is derived from `shared`', /var dis = shared \? ' disabled' : '';/.test(js));
// Every band-1 input must carry it. A field that misses the flag stays editable
// and its edit is then discarded by the save split — a change that appears to
// work and does nothing, which is the hardest kind of bug to report.
// ⚠️ A BOUNDED [\s\S] class, not [^+]. The declarations this has to match look
// like `id="f-name" value="' + Fmt.esc(ident.name) + '"' + dis + '>`, so a
// character class that forbids `+` can never reach the flag: the first version
// of this loop "failed" on nine perfectly correct fields, which is a test bug
// wearing the costume of nine product bugs. Bounded so it cannot run on into the
// NEXT field's declaration and pass by accident either.
['f-name', 'f-nick', 'f-title', 'f-role', 'f-org', 'f-sector', 'f-group',
 'f-email', 'f-contact', 'f-bday', 'f-gift'].forEach(id => {
  const re = new RegExp('id="' + id + '"[\\s\\S]{0,220}?\\+ dis \\+');
  ok('#' + id + ' is disabled when shared', re.test(js));
});
ok('#f-champ is NOT disabled — it is a project fact sitting in a global band',
   !/id="f-champ"[\s\S]{0,220}?\+ dis \+/.test(js));
ok('the identity inputs read `ident`, not the row mirror',
   (js.match(/Fmt\.esc\(ident\./g) || []).length >= 8);
ok('the photo well is inert when shared (class AND no handlers)',
   /shared \? ' is-locked' : ''/.test(js) && /if \(!shared\) \{\n      well\.onclick/.test(js));
ok('.is-locked actually blocks the pointer in CSS as well',
   /\.sm-photowell\.is-locked \{[^}]*pointer-events: *none/.test(css));

// ---------------------------------------------------------------------------
console.log('\n[4] Person edits go through ONE door, and it reports refusals');
// ---------------------------------------------------------------------------
ok('openPersonForm exists and is the only caller of updatePerson',
   /async function openPersonForm\(/.test(js) &&
   (js.match(/await updatePerson\(/g) || []).length === 1);
ok('updatePerson asks for rows back (.select) rather than trusting a silent 200',
   /update\(patch\)\.eq\('id', id\)\.select\('id'\)/.test(js));
// An RLS refusal on UPDATE matches zero rows and returns NO error. Reporting
// "Saved" over a write that never happened is the worst available outcome, and
// this repo has already been bitten by exactly that shape on the photo deletes.
ok('a zero-row update is reported as a refusal, never as success',
   /if \(!res\.data \|\| !res\.data\.length\) \{[\s\S]{0,200}throw new Error/.test(js));
ok('its Save button names the blast radius, not just "Save"',
   /Save for all projects/.test(js));
ok('the count of affected projects is QUERIED, not assumed',
   /select\('project_id'\)\.eq\('stakeholder_id', personId\)/.test(js));
ok('saving a person reloads the register (the mirror and the sort both change)',
   /openPersonForm[\s\S]*?dirAll = null;\n        load\(\);/.test(js));

// ---------------------------------------------------------------------------
console.log('\n[5] The Add picker is the default path, and degrades safely');
// ---------------------------------------------------------------------------
ok('"+ Add stakeholder" opens the picker, not the blank form',
   /\$\('sm-add'\)\.onclick = function \(\) \{ openAddPicker\(\); \};/.test(js));
ok('the picker falls through to the blank form when the migration is not run',
   /if \(dirOff\) \{ openForm\(null\); return; \}/.test(js));
ok('a picked person opens the normal form (the project bands still need filling)',
   /openForm\(null, \{ person: person \}\)/.test(js));
ok('people already on this project are shown and DISABLED, not filtered out',
   /is-here/.test(js) && /disabled title="Already on this project"/.test(js));
ok('the picker reports reuse ("on N projects") so the saving is visible',
   /on ' \+ on \+ ' project'/.test(js));
ok('the result list is capped and says so, rather than rendering the whole directory',
   /hits\.slice\(0, 60\)/.test(js) && /more match/.test(js));
ok('picker avatars are signed in ONE batch, after the list is on screen',
   /async function paintAndSign\(\)/.test(js) && /await signPaths\(need\)/.test(js));
ok('the empty directory says what to do instead of showing an empty box',
   /The directory is empty/.test(js));

// ---------------------------------------------------------------------------
console.log('\n[6] The overlay runs BEFORE sort and BEFORE the offline cache write');
// ---------------------------------------------------------------------------
// sortRows() orders by `name`, which for a linked row is the DIRECTORY's name.
// Sorting first would order the register by whatever stale mirror the project
// row happened to hold; caching first would persist rows the user never saw.
// ⚠️ COMMENTS STRIPPED FIRST. load()'s own note explains this very ordering and
// therefore contains the literal text "sortRows()" on a line ABOVE the overlay
// call — indexing the raw source found sortRows at 680 and overlayPeople at 1133
// and declared a correct function broken. An ordering assertion has to read the
// code, not the prose about the code.
const loadFn = ((js.match(/async function load\(\) \{([\s\S]*?)\n  \}/) || [])[1] || '')
  .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
const iOverlay = loadFn.indexOf('overlayPeople()');
const iSort = loadFn.indexOf('sortRows()');
const iCache = loadFn.indexOf('PDSync.cachePut');
ok('load() overlays the directory before sorting', iOverlay > -1 && iSort > -1 && iOverlay < iSort);
ok('load() overlays the directory before caching', iOverlay > -1 && iCache > -1 && iOverlay < iCache);
ok('loadPeople() is awaited inside load()', /await loadPeople\(\);/.test(loadFn));
ok('loadPeople chunks its `in.()` filters at 200 (URL length cap)',
   (js.match(/i \+= 200/g) || []).length >= 1 && (js.match(/j \+= 200/g) || []).length >= 1);
ok('a missing `stakeholders` table is non-fatal — every row simply stays unlinked',
   /function dirMissing\(/.test(js) && /if \(dirMissing\(err\)\) \{ dirOff = true; return; \}/.test(js));

// ---------------------------------------------------------------------------
console.log('\n[7] findOrCreatePerson matches on the SAME key as the unique index');
// ---------------------------------------------------------------------------
// If the "find" half used a different key from the index, a miss would insert a
// duplicate the index then refuses, and the planner would see a raw constraint
// error they cannot act on.
ok('the migration keys the unique index on lower(btrim(name)) + folded organization',
   /create unique index if not exists stakeholders_name_org_uidx\s*\n\s*on stakeholders \(lower\(btrim\(name\)\), lower\(coalesce\(btrim\(organization\), ''\)\)\)/.test(sql));
const focp = (js.match(/async function findOrCreatePerson\(fields\) \{([\s\S]*?)\n  \}\n/) || [])[1] || '';
ok('the JS match is case-insensitive on name', /\.trim\(\)\.toLowerCase\(\) === name\.toLowerCase\(\)/.test(focp));
ok('the JS match folds a blank organisation to \'\' the same way', /organization \|\| ''\)\.trim\(\)\.toLowerCase\(\) === org\.toLowerCase\(\)/.test(focp));
ok('a lost insert race (23505) is re-resolved, not reported as an error',
   /23505/.test(focp) && /var again = await find\(\)/.test(focp));
ok('created_by is set on insert — stakeholders_ins requires it',
   /row\.created_by = profile\.id/.test(focp));
ok('the migration RLS insert policy is the one that requires created_by',
   /create policy stakeholders_ins on stakeholders\s*\n\s*for insert with check \(is_writer\(\) and created_by = auth\.uid\(\)\)/.test(sql));

// ---------------------------------------------------------------------------
console.log('\n[8] A directory failure never blocks recording the stakeholder');
// ---------------------------------------------------------------------------
// The project row is the record the project needs; the directory is an
// optimisation on top of it. Failing the whole save because a shared master list
// refused would stop a planner recording a stakeholder at all.
ok('the link attempt is wrapped and degrades to an unlinked row',
   /try \{\n            var pr = await findOrCreatePerson\(data\);/.test(js));
ok('and it SAYS the row was saved to this project only, rather than pretending',
   /Saved to this project only/.test(js));
ok('the link is resolved BEFORE the project row is written (no null-link window)',
   js.indexOf('findOrCreatePerson(data)') < js.indexOf("data.created_by = profile.id;              // REQUIRED for RLS"));

// ---------------------------------------------------------------------------
console.log('\n[9] The migration is add-only and cannot lose a project assessment');
// ---------------------------------------------------------------------------
ok('no column is dropped or renamed',
   !/drop column|rename column/i.test(sql));
ok('the link is `on delete set null`, never cascade — deleting a person must not delete an assessment',
   /stakeholder_id uuid references stakeholders\(id\) on delete set null/.test(sql) &&
   !/references stakeholders\(id\) on delete cascade/.test(sql));
ok('the person columns stay on stakeholder_map (they are the mirror the exports read)',
   !/alter table stakeholder_map[\s\S]*?drop column/i.test(sql));
ok('the backfill is idempotent (on conflict do nothing)',
   /on conflict \(lower\(btrim\(name\)\), lower\(coalesce\(btrim\(organization\), ''\)\)\) do nothing/.test(sql));
ok('rows with a blank name are skipped, not given an empty directory entry',
   /where coalesce\(btrim\(sm\.name\), ''\) <> ''/.test(sql));
// Two independent max()es can pair project A's photo with project B's thumbnail
// — two different pictures of the same person.
ok('photo and thumbnail are taken from the SAME row (one order key, two array_aggs)',
   (sql.match(/order by nullif\(btrim\(sm\.photo_path\), ''\) desc nulls last/g) || []).length === 2);
ok('the migration reports what it did rather than leaving the operator to guess',
   /raise notice 'stakeholders directory: % people'/.test(sql));
ok('writing the directory is is_writer(), not is_planner() (an engineer meets the counterpart)',
   /for insert with check \(is_writer\(\)/.test(sql));
ok('DELETING a person is is_planner() — it reaches every project',
   /create policy stakeholders_del on stakeholders\s*\n\s*for delete using \(is_planner\(\)\)/.test(sql));

// ---------------------------------------------------------------------------
console.log('\n[10] Icons in dialogs are hydrated with the API that exists');
// ---------------------------------------------------------------------------
// icons.js exports { svg, hydrate, names } and hydrates on DOMContentLoaded
// only. Markup injected into a modal after that keeps a bare `data-ico` span and
// renders NOTHING — silently, with no error anywhere.
const iconsJs = fs.readFileSync(root('assets', 'js', 'icons.js'), 'utf8');
ok('icons.js exports `hydrate` and does NOT export `paint`',
   /hydrate: hydrate/.test(iconsJs) && !/paint:/.test(iconsJs));
ok('module.js only ever calls Icons.hydrate', !/Icons\.paint\(/.test(js));
const nIco = (js.match(/data-ico=/g) || []).length;
const nHyd = (js.match(/Icons\.hydrate\(m\.el\)/g) || []).length;
ok('every dialog that emits a data-ico hydrates its own subtree (' + nIco + ' icons, ' + nHyd + ' hydrate calls)',
   nIco > 0 && nHyd >= 3);

// ---------------------------------------------------------------------------
console.log('\n[11] The bands are the SHARED segmented control, not a bespoke one');
// ---------------------------------------------------------------------------
const dash = fs.readFileSync(root('assets', 'css', 'dashboard.css'), 'utf8');
ok('.pd-seg / .pd-seg-multi are declared in the shared stylesheet',
   /^\.pd-seg \{/m.test(dash) && /\.pd-seg-multi > button\.on \{/.test(dash));
ok('dashboard.html no longer carries its own copy (it loaded later and would win)',
   !/^\s*\.pd-seg \{ display:inline-flex/m.test(fs.readFileSync(root('dashboard.html'), 'utf8')));
ok('the bespoke .sm-band pills are gone from module.css',
   !/^\.sm-band \{/m.test(css) && !/^\.sm-bands-lab \{/m.test(css));
ok('#sm-bands is the shared control, in the module bar',
   /class="pd-seg pd-seg-multi sm-bands" id="sm-bands"/.test(html));
ok('the band row is no longer a standalone block in the page body',
   !/<div class="sm-bands" id="sm-bands"><\/div>/.test(html));
ok('band toggles are aria-pressed (N independent), not aria-checked (one of N)',
   /aria-pressed="' \+ on \+ '"/.test(js));
ok('hiding the control also hides its trailing separator',
   /sep\.classList\.contains\('sm-tb-sep'\)/.test(js));
ok('the KPI strip is the shared .pd-kpis / UI.kpi, not a 7-column local grid',
   /class="pd-kpis" id="sm-kpis"/.test(html) &&
   /return UI\.kpi\(label, val, \{ cls: cls \|\| '', sub: sub \}\);/.test(js) &&
   !/^\.sm-kpis \{/m.test(css));

// ---------------------------------------------------------------------------
console.log('\n[12] Execution: the overlay semantics, against the shipped rule');
// ---------------------------------------------------------------------------
// ⚠️ The overlay is transcribed here rather than imported, so the transcription
// is asserted against the source FIRST. A fixture that has drifted from its
// subject tests the fixture.
const overlaySrc = (js.match(/function overlayPeople\(\) \{([\s\S]*?)\n  \}/) || [])[1] || '';
ok('the shipped overlay assigns every PERSON_FIELD, coalescing undefined to null',
   /PERSON_FIELDS\.forEach\(function \(f\) \{ row\[f\] = p\[f\] == null \? null : p\[f\]; \}\)/.test(overlaySrc));
ok('the shipped overlay returns early for an unlinked row (legacy rows untouched)',
   /var p = personOf\(row\);\s*\n\s*if \(!p\) return;/.test(overlaySrc));

function overlay(rows, people) {
  rows.forEach(row => {
    const p = row.stakeholder_id ? people[row.stakeholder_id] : null;
    if (!p) return;
    PERSON_FIELDS.forEach(f => { row[f] = p[f] == null ? null : p[f]; });
  });
  return rows;
}

const people = {
  P1: { id: 'P1', name: 'Hon. Maria Reyes', role_title: 'City Mayor',
        organization: 'Quezon City LGU', email: 'mayor@qc.gov.ph',
        photo_path: 'PRJ-A/1_a_face.jpg', photo_thumb_path: 'PRJ-A/1_a_face_t.jpg' },
};
const out = overlay([
  // linked, with a STALE mirror — the directory must win
  { id: 'r1', stakeholder_id: 'P1', name: 'Maria Reyes', role_title: 'Vice Mayor',
    email: 'old@qc.gov.ph', influence: '4', relationship_owner: 'F. Lozano' },
  // linked, and the directory has BLANKED a field the mirror still holds
  { id: 'r2', stakeholder_id: 'P1', nickname: 'Mayang', influence: '3' },
  // legacy: no link at all
  { id: 'r3', stakeholder_id: null, name: 'Someone Else', role_title: 'Consultant' },
], people);

eq('a stale mirror is corrected from the directory', out[0].name, 'Hon. Maria Reyes');
eq('...including a changed role', out[0].role_title, 'City Mayor');
eq('...and a changed e-mail', out[0].email, 'old@qc.gov.ph' === out[0].email ? 'STALE' : 'mayor@qc.gov.ph');
eq('the PROJECT fields are untouched by the overlay', out[0].influence, '4');
eq('...including the project engagement owner', out[0].relationship_owner, 'F. Lozano');
// ⚠️ THE BLANKING CASE. If the overlay merged with a preference for the row's own
// value, "I removed his old nickname" would appear to work on the directory and
// keep showing the stale one on every register that reads the mirror.
eq('a field BLANKED in the directory is blanked on the row, not left stale', out[1].nickname, null);
eq('the photo path is copied, so a shared person keeps their face', out[1].photo_path, 'PRJ-A/1_a_face.jpg');
eq('the thumbnail comes from the same person record', out[1].photo_thumb_path, 'PRJ-A/1_a_face_t.jpg');
eq('an UNLINKED legacy row keeps its own name', out[2].name, 'Someone Else');
eq('...and its own role', out[2].role_title, 'Consultant');

console.log('\n================ ' + passes + ' passed, ' + fails + ' failed ================');
process.exit(fails ? 1 : 0);
