/* Affected activities — which schedule activities a Change Order / EOT touches.

   Owner, 2026-09-09: *"adding change orders and extension of time the planner should be able to
   easily select which activities are affected with the CO/EOT ... in a bulk manner in case that
   the CO/EOT affects a lot ... by selecting affected activities based on the location and optional
   to add other activities in the schedule as well."*

   Hosted by ContractsClaims (see module.js) the same way boq.js / pmi.js / packages.js are: this
   file owns the affected-activity link and nothing else. Its own file rather than a function
   inside the wizard because there are TWO consumers -- the wizard's new step and the record
   form -- and a picker living inside one of them would have to be reached through it.

   ⚠️⚠️ AN EOT LINK CARRIES NO DAYS. `contracts_claims.approved_days` stays the single
      contract-level figure; these rows are the delay BASIS, a SET and not numbers. Delay on
      parallel paths is CONCURRENT -- two activities each slipping 10 days on two parallel paths is
      10 days of project delay, not 20 -- so a per-activity day column would invite a sum that is
      wrong. The reasoning is written out at length in the migration; do not add a days column here.

   ⚠️ THIS FILE WRITES NOTHING TO project_schedule. It reads it to offer a picker, and it writes
      only `cc_affected_activities`. Inserting change-order work into the hosts is the SCHEDULE
      module's job, because `splitPlan`/`splitBuild` -- the date arithmetic a CO claim turns on --
      lives there, and a second copy of that calculation is the last thing this app needs. */
window.CCAffected = (function () {
  'use strict';

  var T_LINK = 'cc_affected_activities';
  var T_SCHED = 'project_schedule';
  var T_LEVELS = 'location_levels';
  var MIGRATION = 'migrations/2026-09-09-cc-affected-activities.sql';
  var MIGRATION_LOC = 'migrations/2026-08-04-activity-location-work-type.sql';

  var sb = function () { return window.__sb || (window.__sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY)); };
  var esc = function (s) { return Fmt.esc(s == null ? '' : String(s)); };

  // ---- state ---------------------------------------------------------------
  var UID = null, canWrite = false, pid = null;
  /* ⚠️⚠️ THREE LOAD STATES, NOT A TRUTHY ARRAY, and this is not defensive padding -- it is the
     bug this module's own history records twice. `boq.js`'s `ensureCodes` read `if (CODES) return
     CODES;` and `[]` IS TRUTHY, so one read before the migration cached the empty answer for the
     whole session and the screen said "the chart is empty -- run the migration" to an owner who
     had already run it. `ensureActs` still carries the same shape.
     Worse, an empty array cannot say WHICH empty it is: "this project has no schedule" and "the
     read was refused by RLS" are different sentences, and only one of them is the planner's
     problem. So every loader here reports 'pending' | 'ok' | 'error' and only 'ok' may claim
     there is genuinely nothing. Same rule the schedule applies to `LOC_LOAD`. */
  var LEVELS = [], LVL_LOAD = 'pending', LVL_ERR = '';
  var ACTS = [], ACTS_LOAD = 'pending', ACTS_ERR = '';
  /* dotted WBS code -> branch name, from the WBS Summary rows. See ensureActs. */
  var NAME_BY_CODE = {};
  /* The tree is SCANNED, not paged. A cap keeps a 16k-activity project from rendering 16k
     rows into a modal; the header says `N+` when it bites. */
  var ROW_CAP = 400;
  var LINKS = [], LINK_LOAD = 'pending', LINK_ERR = '';

  function isMissingTable(e) {
    var m = String((e && (e.message || e.msg)) || e || '');
    return /does not exist|schema cache|relation .* does not exist|42P01|PGRST205/i.test(m);
  }

  // ---- location value normalisation ---------------------------------------
  /* ⚠️⚠️ A DELIBERATE DUPLICATE of the schedule's `LOC_ORD` / `_locNormKeyCalc` / `locSpellRank`
     (modules/project-schedule/index.html:10321, :10332, :10348), copied rather than shared because
     this app has no shared runtime across module boundaries -- the same call already made for the
     People Picker and the dashboard chart helpers. KEEP THE TWO IN STEP.

     ⚠️ AND IT IS LOAD-BEARING, NOT TIDINESS. A real schedule spells one floor several ways:
     Avesta carries "2ND FLOOR" and "2nd Floor", Jab carries "Roofdeck" and "Roof Deck". Offering
     those as separate places means the planner ticks one, believes they have selected the 5th
     floor, and silently misses the twelve activities spelled the other way -- on a change order,
     that is scope left out of a claim. So values are GROUPED by normalised key and shown under one
     spelling. */
  var LOC_ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8,
    eight: 8, ninth: 9, nineth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14,
    fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20 };
  var _normMemo = Object.create(null);
  function normKey(v) {
    var k = String(v == null ? '' : v), c = _normMemo[k];
    if (c !== undefined) return c;
    return (_normMemo[k] = _normCalc(k));
  }
  function _normCalc(v) {
    var s = String(v == null ? '' : v).toLowerCase().replace(/[‘’']/g, '');
    s = s.replace(/[a-z]+/g, function (w) { return LOC_ORD[w] != null ? String(LOC_ORD[w]) : w; });
    s = s.replace(/(\d+)(st|nd|rd|th)(?![a-z])/g, '$1');   // 2nd -> 2, 10th -> 10
    return s.replace(/[^a-z0-9]+/g, '');                   // "Roof Deck" and "Roofdeck" -> roofdeck
  }
  /* One display spelling per normalised key: a digit first (unambiguous and it sorts), then more
     word separators, then more Title-Cased words, then frequency / shortest / alphabetical so the
     answer is deterministic whatever order the rows arrived in. Verbatim from the schedule. */
  function spellRank(v) {
    return [
      /\d/.test(v) ? 0 : 1,
      -(String(v).split(/\s+/).length),
      -(String(v).split(/\s+/).filter(function (w) { return /^[A-Z]/.test(w); }).length)
    ];
  }
  function bestSpelling(variants) {
    var counts = {};
    variants.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
    return Object.keys(counts).sort(function (a, b) {
      var ra = spellRank(a), rb = spellRank(b);
      for (var i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
      if (counts[b] !== counts[a]) return counts[b] - counts[a];
      if (a.length !== b.length) return a.length - b.length;
      return a.localeCompare(b);
    })[0];
  }

  /* ⚠️⚠️ NO GROUPING-VALUE VETO HERE, AND THAT IS A DELIBERATE DEPARTURE FROM THE SCHEDULE.
     `_vsLevVal` refuses a stored location value when `locIsGroupingValue` says the name is a trade
     or a phase ("Superstructure", "Structural Works"), and it is right to: it is drawing a
     BUILDING, and a trade is not a storey.
     A SELECTOR is the opposite case. These values are already stored on the activities -- a
     planner or the matcher filed them there -- so whatever they are called, ticking one selects
     exactly the activities filed under it, which is precisely what the planner asked for. Applying
     the veto here would HIDE activities from a change order because the stacking dislikes the name
     of the place they are in. Nothing is drawn from this list, so nothing is at risk. */

  // ---- loads ---------------------------------------------------------------
  function init(deps) {
    deps = deps || {};
    UID = deps.uid || null;
    canWrite = !!deps.canWrite;
  }
  function setProject(projectId) {
    if (projectId === pid) return;
    pid = projectId; reset();
  }
  function reset() {
    LEVELS = []; LVL_LOAD = 'pending'; LVL_ERR = '';
    ACTS = []; ACTS_LOAD = 'pending'; ACTS_ERR = ''; NAME_BY_CODE = {};
    LINKS = []; LINK_LOAD = 'pending'; LINK_ERR = '';
  }

  async function ensureLevels() {
    if (LVL_LOAD === 'ok' || LVL_LOAD === 'error') return LEVELS;
    try {
      var r = await sb().from(T_LEVELS).select('id,name,sort_order').eq('project_id', pid).order('sort_order');
      if (r.error) throw r.error;
      LEVELS = r.data || []; LVL_LOAD = 'ok'; LVL_ERR = '';
    } catch (e) {
      /* ⚠️ The levels list stands rather than being clobbered on a failure, and only the state
         changes -- the same rule `refreshLocLevels` follows. A project whose location migration was
         never run must still be able to use the search pane. */
      LVL_LOAD = 'error'; LVL_ERR = (e && e.message) ? e.message : String(e);
    }
    return LEVELS;
  }

  async function ensureActs() {
    if (ACTS_LOAD === 'ok' || ACTS_LOAD === 'error') return ACTS;
    try {
      /* ⚠️ `PDb.selectAll`, never a bare `.select()`: PostgREST caps a read at 1000 rows and
         answers 200, so a 16k-activity schedule would silently offer the planner the first 1000
         and a change order would be raised against a sixteenth of the programme.
         ⚠️ The keyset cursor is `id` (the default) and that is correct here -- it is
         project_schedule's unique primary key. The `class_codes` failure this helper documents was
         a table with no `id` at all. */
      var rows = await PDb.selectAll(T_SCHED, function (q) { return q.eq('project_id', pid); },
        'id,activity_id,activity_name,wbs,start_date,end_date,duration_days,activity_type,scope_type,change_order_ref,location');
      /* ⚠⚠ THE WBS SUMMARY ROWS ARE KEPT AS A CODE -> NAME MAP, and the first cut of this file
         threw them away. They are the ONLY source for a branch's name -- the schedule builds its
         own `nameByCode` from exactly these rows -- so without them every heading in the activity
         tree renders nameless, which is the whole point of having a tree. Same single read; they
         are simply not discarded.
         ⚠ They stay OUT of the selectable set. A heading carries no work, and a change order
           raised against one would double-count every activity beneath it -- the same exclusion
           `boq_tag_activities` makes in SQL. */
      NAME_BY_CODE = {};
      (rows || []).forEach(function (r) {
        if (r.activity_type === 'WBS Summary' && r.wbs) NAME_BY_CODE[String(r.wbs)] = r.activity_name || '';
      });
      ACTS = (rows || []).filter(function (r) { return r.activity_type !== 'WBS Summary' && r.activity_id; });
      // Ancestry is derived once, here, rather than per render -- see stampSegs.
      ACTS.forEach(stampSegs);
      ACTS_LOAD = 'ok'; ACTS_ERR = '';
    } catch (e) {
      ACTS_LOAD = 'error'; ACTS_ERR = (e && e.message) ? e.message : String(e);
    }
    return ACTS;
  }

  async function ensureLinks(force) {
    if (!force && (LINK_LOAD === 'ok' || LINK_LOAD === 'error')) return LINKS;
    try {
      var r = await sb().from(T_LINK).select('id,cc_id,activity_id,note').eq('project_id', pid);
      if (r.error) throw r.error;
      LINKS = r.data || []; LINK_LOAD = 'ok'; LINK_ERR = '';
    } catch (e) {
      LINK_LOAD = 'error';
      /* ⚠️ Distinguish "the migration has not been run" from every other failure. The first is an
         instruction the owner can act on; the second is not, and reporting them the same way is
         what sent him running an already-applied migration repeatedly. */
      LINK_ERR = isMissingTable(e) ? ('no-migration:' + MIGRATION) : ((e && e.message) ? e.message : String(e));
    }
    return LINKS;
  }

  // ---- reads ---------------------------------------------------------------
  function listFor(ccId) {
    return LINKS.filter(function (l) { return String(l.cc_id) === String(ccId); })
      .map(function (l) { return l.activity_id; });
  }
  function countFor(ccId) { return listFor(ccId).length; }
  function countsByRecord() {
    var out = {};
    LINKS.forEach(function (l) { out[l.cc_id] = (out[l.cc_id] || 0) + 1; });
    return out;
  }
  function actById(activityId) {
    for (var i = 0; i < ACTS.length; i++) if (String(ACTS[i].activity_id) === String(activityId)) return ACTS[i];
    return null;
  }
  /* Links whose activity is no longer on the schedule. ⚠️ A REAL, REPORTABLE STATE, not an error:
     the activity may have been renumbered by a re-import or deleted outright, and the planner is
     the only one who can say which. Surfaced in the picker so a claim is never argued from a set
     that quietly shrank. Answers [] while the activities have not loaded, so a slow read never
     reads as "every link is broken". */
  function missingFor(ccId) {
    if (ACTS_LOAD !== 'ok') return [];
    return listFor(ccId).filter(function (id) { return !actById(id); });
  }
  function linkState() { return { levels: LVL_LOAD, acts: ACTS_LOAD, links: LINK_LOAD, linkErr: LINK_ERR, actsErr: ACTS_ERR, lvlErr: LVL_ERR }; }

  // ---- write ---------------------------------------------------------------
  /* Diff-based, so re-saving the picker is not a delete-and-reinsert: the unique (cc_id,
     activity_id) makes an unchanged row a no-op and `created_at` on the untouched links survives,
     which matters because it is the only record of when the scope was first identified. */
  async function saveFor(ccId, ids) {
    if (!ccId) return { err: 'no record id' };
    var want = {}, have = {};
    (ids || []).forEach(function (i) { if (i) want[String(i)] = 1; });
    listFor(ccId).forEach(function (i) { have[String(i)] = 1; });
    var add = Object.keys(want).filter(function (i) { return !have[i]; });
    var del = Object.keys(have).filter(function (i) { return !want[i]; });
    if (!add.length && !del.length) return { added: 0, removed: 0 };
    try {
      /* ⚠️ Chunked at 100. A `.in()` filter travels in the URL and a long one exceeds the server's
         URL cap -- the limit this app has already hit twice -- and an insert of thousands of rows
         risks the 8s statement timeout. */
      for (var i = 0; i < add.length; i += 100) {
        var body = add.slice(i, i + 100).map(function (a) {
          return { project_id: pid, cc_id: ccId, activity_id: a, created_by: UID };
        });
        var ri = await sb().from(T_LINK).insert(body);
        if (ri.error) throw ri.error;
      }
      for (var j = 0; j < del.length; j += 100) {
        var rd = await sb().from(T_LINK).delete().eq('cc_id', ccId).in('activity_id', del.slice(j, j + 100));
        if (rd.error) throw rd.error;
      }
      await ensureLinks(true);
      return { added: add.length, removed: del.length };
    } catch (e) {
      return {
        err: isMissingTable(e) ? ('no-migration:' + MIGRATION) : ((e && e.message) ? e.message : String(e)),
        added: 0, removed: 0
      };
    }
  }

  // ---- dates ---------------------------------------------------------------
  /* ⚠️ UTC THROUGHOUT, and it is not optional. `start_date` is a plain `YYYY-MM-DD`; parsing it
     with `new Date(s)` uses the local zone, and in UTC+8 (this owner's zone) every such date lands
     on the previous day at 16:00 — so a bar drawn from it starts a day early. Same convention, and
     the same reason, as the schedule's own `pd` / `addDays`. */
  function pd(s) {
    if (!s) return null;
    var m = String(s).slice(0, 10).split('-');
    if (m.length !== 3) return null;
    var d = new Date(Date.UTC(+m[0], +m[1] - 1, +m[2]));
    return isNaN(d.getTime()) ? null : d;
  }
  function dayDiff(a, b) { return Math.round((b - a) / 86400000); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() + n); return x; }
  var MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function shortDate(d) { return d ? (MON3[d.getUTCMonth()] + ' ' + d.getUTCDate()) : '—'; }
  // ⚠ The programme finish is often a year or more out, where "Mar 12" is ambiguous.
  function fullDate(d) { return d ? (d.getUTCDate() + ' ' + MON3[d.getUTCMonth()] + ' ' + d.getUTCFullYear()) : '—'; }

  // ---- the WBS code, as ancestry -------------------------------------------
  /* ⚠️⚠️ ANCESTRY COMES FROM SPLITTING THE DOTTED `wbs` STRING, NEVER FROM `wbs_node_id`.
     Measured in migrations/2026-09-01-wbs-link-rpc.sql: `wbs_node_id` is NULL on 4,393 of 4,393
     activities (Avesta) and 16,393 of 16,393 (4PH Strevi) after an import, until a repair RPC is
     run — and the schedule's grid never noticed, because `rebuild()` derives ancestry by splitting
     the code. A tree built on the node id would be empty on exactly the projects that matter.
     ⚠️ Segments are NOT always numeric — a custom code is spliced in as one SEGMENT, so real codes
     look like `1.2.ST-F1.3`. Never infer depth from digits, only from the segment count. */
  function stampSegs(r) {
    var w = String(r.wbs == null ? '' : r.wbs);
    if (r._segsFor === w && r._segs) return r;
    var segs = w === '' ? [] : w.split('.');
    var anc = [];
    for (var i = 1; i < segs.length; i++) anc.push(segs.slice(0, i).join('.'));
    r._segs = segs; r._anc = anc; r._segsFor = w;
    return r;
  }
  // Natural, segment-wise comparison, so `10` sorts after `9` rather than after `1`.
  function cmpCode(a, b) {
    var x = String(a == null ? '' : a).split('.'), y = String(b == null ? '' : b).split('.');
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var p = x[i], q = y[i];
      if (p === undefined) return -1;
      if (q === undefined) return 1;
      var np = parseInt(p, 10), nq = parseInt(q, 10);
      var bothNum = !isNaN(np) && !isNaN(nq) && String(np) === p && String(nq) === q;
      var c = bothNum ? (np - nq) : String(p).localeCompare(String(q));
      if (c !== 0) return c;
    }
    return 0;
  }
  // Every activity at or under `code`. Covers both `wbs` conventions — see treeOf.
  function actsUnder(list, code) {
    return list.filter(function (a) {
      var w = String(a.wbs == null ? '' : a.wbs);
      return w === code || (a._anc || []).indexOf(code) >= 0;
    });
  }
  /* The deepest location value an activity carries. Deepest because it is the most specific:
     "Formworks · Z1" says more than "Formworks · Tower 1". */
  function locSuffix(a, levels) {
    for (var i = (levels || []).length - 1; i >= 0; i--) {
      var v = String((a.location && a.location[levels[i].id]) || '').trim();
      if (v) return v;
    }
    return '';
  }

  // ---- THE LADDER (pure) ---------------------------------------------------
  /* Values at one level over a GIVEN candidate set, grouped by normalised key.
     ⚠️⚠️ THE CANDIDATE SET IS WHY NO COMPOSITE KEY IS NEEDED. The location migration is explicit
     that values are plain text and NOT a node tree — *"Zone 'Z1' under two different locations is
     the same string"* — so a rung keyed on the bare value would merge Tower A's Z1 with Tower B's
     Z1, and a change order would silently take both. It cannot happen here because `cand` has
     already been narrowed by every rung above, so the Z1 resolved in this pane IS Tower A's Z1.
     That is the same property that makes boq.js's cascade safe, where division codes are likewise
     not unique across trades — and it holds ONLY while resolution stays strictly top-down.
     Do not add a "show me every zone at once" mode without introducing a composite key. */
  function valuesAt(cand, levelId) {
    var byKey = {};
    cand.forEach(function (a) {
      var v = String((a.location && a.location[levelId]) || '').trim();
      if (!v) return;
      var k = normKey(v); if (!k) return;
      (byKey[k] = byKey[k] || { key: k, variants: [], acts: [] });
      byKey[k].variants.push(v); byKey[k].acts.push(a);
    });
    return Object.keys(byKey).map(function (k) {
      var g = byKey[k];
      var uniq = g.variants.filter(function (v, i, arr) { return arr.indexOf(v) === i; });
      return { key: k, label: bestSpelling(g.variants), spellings: uniq, acts: g.acts };
    }).sort(function (x, y) {
      if (y.acts.length !== x.acts.length) return y.acts.length - x.acts.length;
      return String(x.label).localeCompare(String(y.label), undefined, { numeric: true });
    });
  }

  /* The rungs, resolved strictly top-down. Returns `{ rungs, cand, cursor }` and MUTATES NOTHING —
     the caller adopts the returned cursor.
     ⚠️ EVERY CURSOR IS RE-DERIVED AGAINST THE VALUES THAT ACTUALLY EXIST on this pass, and falls
     back to the first — never to null. boq.js's own note records what independent resolution did
     there: *"a division from one trade showing beside the groups of another"*. A ladder has no
     collapsed state, it has a position.
     ⚠️ A LEVEL WITH NO VALUES UNDER THE CURRENT PATH IS SKIPPED, not rendered as "Unassigned". On a
     project where only some towers have zones, an empty rung is noise that also costs a pane —
     the same call `buildTree` makes with its skip sentinel. */
  function ladderOf(base, levels, cursor) {
    var rungs = [], cand = base, out = {};
    for (var i = 0; i < (levels || []).length; i++) {
      var lv = levels[i];
      var vals = valuesAt(cand, lv.id);
      if (!vals.length) continue;
      var want = cursor ? cursor[lv.id] : null;
      var chosen = vals.filter(function (v) { return v.key === want; })[0] || vals[0];
      out[lv.id] = chosen.key;
      rungs.push({ level: lv, values: vals, sel: chosen });
      cand = chosen.acts;
    }
    return { rungs: rungs, cand: cand, cursor: out };
  }

  // ---- THE ACTIVITY TREE (pure) --------------------------------------------
  /* Flat display entries carrying a depth, mirroring the schedule's own `emitLeaf`: collect every
     ancestor code, prune the prefix they all share, then sort branches and activities as ONE list
     so they interleave correctly.
     ⚠️⚠️ TWO `wbs` CONVENTIONS COEXIST IN ONE TABLE AND BOTH ARE NORMAL. An IMPORTED activity
     carries its own leaf code one segment below its branch (`4.2.3.1.5` under `4.2.3.1`); a
     builder-pushed one carries the BRANCH's code, identical to every sibling. Keyed naively the
     first gives every row its own node and the second collapses forty rows onto one heading. So a
     code counts as a branch when a WBS Summary row NAMES it or anything sits below it, and an
     activity whose own code is also a branch is indented one level beneath it. */
  function treeOf(list, nameByCode, levels) {
    if (!list.length) return [];
    nameByCode = nameByCode || {};
    var segsOf = list.map(function (a) { return (stampSegs(a)._segs || []); });
    var minSegs = segsOf.reduce(function (m, s) { return Math.min(m, s.length); }, Infinity);
    var cut = 0;
    while (cut < minSegs - 1 && segsOf.every(function (s) { return s[cut] === segsOf[0][cut]; })) cut++;

    var isBranch = {};
    list.forEach(function (a) {
      (a._anc || []).forEach(function (c) { isBranch[c] = 1; });
      var own = String(a.wbs == null ? '' : a.wbs);
      if (own && nameByCode[own] !== undefined) isBranch[own] = 1;   // the builder-pushed case
    });

    var entries = [];
    Object.keys(isBranch).forEach(function (c) {
      if (c.split('.').length > cut) entries.push({ code: c, branch: true });
    });
    list.forEach(function (a) {
      entries.push({ code: String(a.wbs == null ? '' : a.wbs), branch: false, a: a });
    });
    entries.sort(function (x, y) {
      var c = cmpCode(x.code, y.code);
      if (c !== 0) return c;
      if (x.branch !== y.branch) return x.branch ? -1 : 1;          // the heading before its rows
      return String((x.a && x.a.activity_id) || '').localeCompare(String((y.a && y.a.activity_id) || ''));
    });

    /* ⚠️ QUALIFY ONLY THE NAMES THAT ACTUALLY REPEAT. The owner's complaint is that most activities
       share a name and differ only by an id nobody memorises; the schedule's `emitLeaf` solves it
       the same way, and its comment is the same case — *"Four rows all reading '1st Fix' is
       unreadable … only their WBS parent says which"*. A qualifier on every row would be noise. */
    var nameN = {};
    list.forEach(function (a) { var k = String(a.activity_name || '').trim(); nameN[k] = (nameN[k] || 0) + 1; });

    entries.forEach(function (e) {
      var segN = e.code === '' ? 0 : e.code.split('.').length;
      e.depth = Math.max(0, segN - 1 - cut);
      if (e.branch) {
        e.name = nameByCode[e.code] !== undefined ? nameByCode[e.code] : '';
        e.acts = actsUnder(list, e.code);
        e.n = e.acts.length;
      } else {
        if (isBranch[e.code]) e.depth = e.depth + 1;               // it sits INSIDE its own code
        e.name = String(e.a.activity_name || '');
        e.qual = (nameN[e.name.trim()] > 1) ? locSuffix(e.a, levels) : '';
      }
    });
    return entries;
  }

  /* Which tree rows are on screen. A shut branch hides its subtree — including an activity whose
     own code IS that branch, which is the builder-pushed case again. */
  function visibleTree(entries, open) {
    var branchAt = {};
    entries.forEach(function (e) { if (e.branch) branchAt[e.code] = 1; });
    return entries.filter(function (e) {
      var code = e.code === '' ? '' : e.code;
      var segs = code === '' ? [] : code.split('.');
      // every strict ancestor must be open
      for (var i = 1; i < segs.length; i++) {
        var p = segs.slice(0, i).join('.');
        if (branchAt[p] && !open[p]) return false;
      }
      // an activity filed ON a branch code is inside it
      if (!e.branch && branchAt[code] && !open[code]) return false;
      return true;
    });
  }

  // ---- THE GANTT PREVIEW (pure) --------------------------------------------
  /* ⚠️⚠️ THIS IS NOT A SECOND COPY OF `splitPlan`, AND THE DIFFERENCE IS THE POINT.
     The authoritative insertion arithmetic lives in project-schedule (`splitPlan`), and the commit
     that built the bulk insert refused to duplicate it: *"reimplementing that date arithmetic in
     the contracts module would be a second copy of the one calculation a CO claim turns on."* That
     still holds. A PREVIEW needs only two facts — where the gap sits, and where the bar now ends —
     so this computes those two and nothing else.
     ⚠️ AND IT IS PINNED BY ASSERTION, NOT BY GOOD INTENTIONS. The verification suite slices the
     REAL `splitPlan` out of project-schedule/index.html, executes it, and asserts that `newEnd`
     here equals its `seg2.end` and that the gap equals its `co` span, across a range of durations.
     If the schedule's arithmetic ever changes, that assertion fails and this gets corrected —
     which is the property a silent duplicate would not have.
     ⚠️ The cut is the activity's MIDPOINT, which is exactly what `openSplitDialog` defaults to and
     is always strictly inside the bar, so a preview never has to refuse on the date.
     ⚠️ A 1-DAY ACTIVITY IS REFUSED, with the reason, rather than drawn as a gapless bar that would
     imply the insertion worked — `splitPlan` refuses it too ("there is no point inside it"). */
  function previewOf(a, dur) {
    var s = pd(a.start_date), e = pd(a.end_date);
    if (!s || !e) return { err: 'no dates' };
    var span = dayDiff(s, e) + 1;
    if (span < 2) return { err: 'cannot split — 1 day' };
    if (!dur) return null;
    var cut = addDays(s, Math.max(1, Math.floor(span / 2)));
    return { cut: cut, gapStart: cut, gapEnd: addDays(cut, dur - 1), newEnd: addDays(e, dur), shift: dur };
  }

  /* ---- THE OVERALL IMPACT (pure) ------------------------------------------
     Owner: *"I want the preview to show the overall change in the Gantt ... The current preview
     doesn't provide any useful information."* Correct, and the screenshot shows why: 240 selected
     activities drew 240 bars 1-3px wide across a project-wide window. It answered "which bars did I
     tick", which the tree beside it already answers, and never answered the only question a change
     order actually raises -- WHAT DOES THIS DO TO THE PROGRAMME?

     ⚠️⚠️ N DAYS ON 240 ACTIVITIES IS NOT 240 x N DAYS, AND IT IS USUALLY NOT EVEN N. The activities
     run in parallel, so what moves is the LATEST finish among them -- and that only moves the
     programme if it was already the programme's own finish. This computes exactly that, and nothing
     it cannot stand behind.

     ⚠️⚠️ `slip` IS A LOWER BOUND, NOT A FORECAST. It is pure date arithmetic over the selected
     activities. It does NOT run CPM, does not move successors, and cannot know whether a
     non-critical activity has float to absorb the insertion. A slip of 0 therefore means "the added
     time ends inside the current programme window", NEVER "the project is unaffected" -- and the
     panel says so in those words. The real knock-on is the Project Schedule's job, which is where
     `splitPlan`/`splitBuild` live and why this file refuses to copy them. */
  function impactOf(sel, all, dur) {
    function span(list) {
      var mn = null, mx = null;
      (list || []).forEach(function (a) {
        var s = pd(a.start_date), e = pd(a.end_date);
        if (!s || !e) return;
        if (!mn || s < mn) mn = s;
        if (!mx || e > mx) mx = e;
      });
      return { start: mn, finish: mx };
    }
    var proj = span(all), sp = span(sel);
    var dated = (sel || []).filter(function (a) { return pd(a.start_date) && pd(a.end_date); });
    var oneDay = dated.filter(function (a) { return dayDiff(pd(a.start_date), pd(a.end_date)) + 1 < 2; });
    // The selection's own finish after the insertion. Every selected bar grows by `dur`, so the
    // latest of them grows by `dur` -- no more.
    var selAfter = (sp.finish && dur) ? addDays(sp.finish, dur) : sp.finish;
    var progAfter = proj.finish;
    if (selAfter && proj.finish && selAfter > proj.finish) progAfter = selAfter;
    return {
      proj: proj, sel: sp, selAfter: selAfter, progAfter: progAfter,
      slip: (proj.finish && progAfter) ? dayDiff(proj.finish, progAfter) : 0,
      selGrew: (sp.finish && selAfter) ? dayDiff(sp.finish, selAfter) : 0,
      nSel: (sel || []).length, nDated: dated.length,
      nUndated: (sel || []).length - dated.length, nOneDay: oneDay.length
    };
  }

  // ---- the picker ----------------------------------------------------------
  function pickerHTML() {
    return '<div class="cca" id="cca-root"><div class="cca-loading">Reading the schedule…</div></div>';
  }

  /* Mounts into `root` (which must already be in the document) and resolves to a handle:
       { ids(), count(), refresh() }
     ⚠️ THE HANDLE CONTRACT IS FIXED. Four call sites depend on it — wizard.js mirrors `ids()` into
     `st.affIds` on every `onCount` (the handle dies with the DOM on a step change), `finish()`
     reads it to save, module.js's `openForm` tolerates a null handle, and the register row calls
     `countFor`.
     ⚠️ ASYNC AND MOUNTED AFTER PAINT, the same shape `D.mountBoqPicker` uses on the Trades step:
     the wizard replaces `#ccw-body` wholesale on every step change. */
  async function mount(root, opts) {
    opts = opts || {};
    var host = root.querySelector('#cca-root') || root;
    await Promise.all([ensureLevels(), ensureActs(), ensureLinks()]);

    var sel = {};        // activity_id -> 1  — the selection, and the only state that is saved
    (opts.initial || []).forEach(function (i) { if (i) sel[String(i)] = 1; });
    var cur = {};        // level id -> normalised value key — the ladder's POSITION
    var open = {};       // branch code -> 1 — expanded in the tree
    var q = '';
    var coDur = 0;       // change-order duration for the preview; 0 = bars only

    function setMany(acts, on) {
      acts.forEach(function (a) { if (on) sel[a.activity_id] = 1; else delete sel[a.activity_id]; });
    }
    function rungState(v) {
      var on = 0;
      v.acts.forEach(function (a) { if (sel[a.activity_id]) on++; });
      return { on: on, all: on > 0 && on === v.acts.length, part: on > 0 && on < v.acts.length };
    }
    function searchHits() {
      var ql = q.trim().toLowerCase();
      if (!ql) return null;
      /* ⚠️ A typed query searches the WHOLE project, not the current rung — the owner's *"optional
         to add other activities in the schedule as well"*. It matches the dotted code too, so a
         planner who knows the WBS can jump straight to it. */
      return ACTS.filter(function (a) {
        return String(a.activity_id).toLowerCase().indexOf(ql) >= 0 ||
               String(a.activity_name || '').toLowerCase().indexOf(ql) >= 0 ||
               String(a.wbs || '').toLowerCase().indexOf(ql) >= 0 ||
               locSuffix(a, LEVELS).toLowerCase().indexOf(ql) >= 0;
      });
    }

    /* The headline the owner asked for: what this does to the PROGRAMME, above the per-bar
       detail rather than instead of it. See impactOf for what these numbers do and do not claim. */
    function impactHTML(sel) {
      if (!sel.length) {
        return '<div class="cca-empty">Nothing selected yet \u2014 pick the activities this change ' +
               'order touches and its effect on the programme appears here.</div>';
      }
      var imp = impactOf(sel, ACTS, coDur);
      if (!imp.sel.start || !imp.proj.start) {
        return '<div class="cca-empty">' + imp.nSel + ' selected, but none of them carry both a ' +
               'start and a finish, so there is no impact to compute.</div>';
      }

      var head;
      if (!coDur) {
        head = '<div class="cca-imp-h"><b>Enter the change order\u2019s duration</b>' +
               '<span>then this shows what it does to the programme.</span></div>';
      } else if (imp.slip > 0) {
        head = '<div class="cca-imp-h cca-imp-slip"><b>Programme finish moves ' + imp.slip +
               ' day' + (imp.slip === 1 ? '' : 's') + ' later</b><span>' +
               esc(fullDate(imp.proj.finish)) + ' \u2192 ' + esc(fullDate(imp.progAfter)) + '</span></div>';
      } else {
        /* \u26a0 "unchanged" is stated as a fact about DATES, never as "no impact" -- this does not
           run CPM, so an activity with float can still push its successors. */
        head = '<div class="cca-imp-h"><b>Programme finish unchanged</b><span>the added time ends ' +
               'inside the current programme, which finishes ' + esc(fullDate(imp.proj.finish)) +
               '.</span></div>';
      }

      // ---- one bar for the whole programme ----------------------------------
      var t0 = imp.proj.start, t1 = imp.progAfter || imp.proj.finish;
      var span = Math.max(1, dayDiff(t0, t1) + 1);
      function pc(d) { return Math.max(0, Math.min(100, (dayDiff(t0, d) / span) * 100)); }
      var progR = pc(imp.proj.finish);
      var selL = pc(imp.sel.start), selR = pc(imp.sel.finish);
      var selAfterR = pc(imp.selAfter || imp.sel.finish);
      var bar =
        '<div class="cca-imp-bar" title="' + esc('Programme ' + fullDate(imp.proj.start) + ' \u2192 ' +
          fullDate(imp.proj.finish)) + '">' +
          '<i class="cca-imp-prog" style="left:0;width:' + progR.toFixed(2) + '%;"></i>' +
          (imp.slip > 0
            ? '<i class="cca-imp-ext" style="left:' + progR.toFixed(2) + '%;width:' +
              (100 - progR).toFixed(2) + '%;"></i>' : '') +
          (selAfterR > selR
            ? '<i class="cca-imp-selafter" style="left:' + selL.toFixed(2) + '%;width:' +
              (selAfterR - selL).toFixed(2) + '%;"></i>' : '') +
          '<i class="cca-imp-sel" style="left:' + selL.toFixed(2) + '%;width:' +
            Math.max(0.6, selR - selL).toFixed(2) + '%;"></i>' +
        '</div>' +
        '<div class="cca-imp-ax"><span>' + esc(fullDate(t0)) + '</span>' +
          '<span>' + esc(fullDate(t1)) + '</span></div>';

      // ---- what actually moved, in words -----------------------------------
      var facts = [];
      facts.push('<b>' + imp.nSel + '</b> activit' + (imp.nSel === 1 ? 'y' : 'ies') + ' selected');
      if (coDur) {
        /* \u26a0\u26a0 THE NUMBER THAT MAKES THE WHOLE PANEL WORTH HAVING. Selecting 240 activities and
           adding 10 days does not add 2,400 days, and a planner reading 240 bars cannot see that.
           The selected work runs in parallel, so its own window grows by the change order's
           duration and no more. */
        facts.push('their work spans ' + esc(fullDate(imp.sel.start)) + ' \u2192 ' +
                   esc(fullDate(imp.sel.finish)) + ', growing <b>' + imp.selGrew + ' day' +
                   (imp.selGrew === 1 ? '' : 's') + '</b> to ' + esc(fullDate(imp.selAfter)) +
                   ' \u2014 not ' + imp.nSel + ' \u00d7 ' + coDur + ', because they run in parallel');
      }
      if (imp.nUndated) facts.push('<b>' + imp.nUndated + '</b> carr' + (imp.nUndated === 1 ? 'ies' : 'y') + ' no dates and cannot be drawn');
      if (imp.nOneDay) facts.push('<b>' + imp.nOneDay + '</b> too short to split (1 day)');

      return '<div class="cca-imp">' + head + bar +
        '<div class="cca-imp-note">' + facts.join(' \u00b7 ') + '.</div>' +
        /* \u26a0 The limit is on screen, not only in the source: a planner must not read `slip` as a
           rescheduled forecast. */
        '<div class="cca-imp-warn">Dates only \u2014 nothing is rescheduled here and successors are not ' +
          'moved. The Project Schedule performs the insertion and shows the real knock-on.</div>' +
        '</div>';
    }

    function ganttHTML(list) {
      if (!list.length) return '<div class="cca-empty">Nothing selected yet — the preview draws the activities you pick.</div>';
      var rows = list.filter(function (a) { return pd(a.start_date) && pd(a.end_date); });
      if (!rows.length) return '<div class="cca-empty">' + list.length + ' selected, but none carry both a start and a finish, so there is nothing to draw.</div>';
      var mn = null, mx = null;
      rows.forEach(function (a) {
        var s = pd(a.start_date), e = pd(a.end_date), pv = previewOf(a, coDur);
        if (pv && pv.newEnd) e = pv.newEnd;
        if (!mn || s < mn) mn = s;
        if (!mx || e > mx) mx = e;
      });
      var total = Math.max(1, dayDiff(mn, mx) + 1);
      /* Auto-fit, clamped — a preview has no zoom, so the window must always fit what is selected. */
      var dayw = Math.max(0.8, Math.min(6, 560 / total));
      var W = Math.max(110, Math.round(total * dayw));
      function xOf(d) { return Math.round(dayDiff(mn, d) * dayw); }

      var out = '<div class="cca-mg"><div class="cca-mg-row cca-mg-head">' +
        '<span class="cca-mg-lbl"></span><span class="cca-mg-track" style="width:' + W + 'px;">' +
        '<b class="cca-mg-t0">' + esc(shortDate(mn)) + '</b><b class="cca-mg-t1">' + esc(shortDate(mx)) + '</b>' +
        '</span><span class="cca-mg-fin">Finish</span></div>';

      /* ⚠️ THE STRIP CARRIES THE SAME QUALIFIER THE TREE DOES, and it has to: the owner's whole
         complaint is that most activities share a name, and a preview listing "Formworks" nine
         times answers the question "which ones did I pick?" with "some Formworks". Qualified only
         where the name actually repeats, exactly as treeOf does it. */
      var mgN = {};
      rows.forEach(function (a) { var k = String(a.activity_name || '').trim(); mgN[k] = (mgN[k] || 0) + 1; });

      out += rows.slice(0, 120).map(function (a) {
        var s = pd(a.start_date), e = pd(a.end_date), pv = previewOf(a, coDur);
        var x = xOf(s), w = Math.max(3, Math.round((dayDiff(s, e) + 1) * dayw));
        var bar = '';
        if (pv && pv.newEnd) {
          // the ghost rail runs to the NEW finish, so the added time is the visible thing
          bar += '<i class="cca-mg-ghost" style="left:' + x + 'px;width:' + Math.max(3, Math.round((dayDiff(s, pv.newEnd) + 1) * dayw)) + 'px;"></i>';
        }
        bar += '<i class="cca-mg-bar" style="left:' + x + 'px;width:' + w + 'px;"></i>';
        if (pv && pv.gapStart) {
          /* ⚠️ BAR-LOCAL COORDINATES — the gap's origin is the bar's own start, not the timeline's,
             which is how the schedule draws its own notch. A notch touching either edge is DROPPED
             rather than drawn as a stub that reads like a rendering fault. */
          var gx = dayDiff(s, pv.gapStart) * dayw;
          var gw = Math.max(1, Math.round((dayDiff(pv.gapStart, pv.gapEnd) + 1) * dayw));
          var full = (dayDiff(s, pv.newEnd) + 1) * dayw;
          if (gx > 0 && gx + gw < full) bar += '<i class="cca-mg-cut" style="left:' + Math.round(x + gx) + 'px;width:' + gw + 'px;"></i>';
        }
        var nm = String(a.activity_name || '').trim();
        var qual = (mgN[nm] > 1) ? (locSuffix(a, LEVELS) || a.activity_id) : '';
        return '<div class="cca-mg-row"><span class="cca-mg-lbl" title="' +
          esc(a.activity_id + ' · ' + (a.activity_name || '') + (qual ? ' · ' + qual : '')) + '">' +
          esc(nm || a.activity_id) +
          (qual ? '<span class="cca-qual"> · ' + esc(qual) + '</span>' : '') + '</span>' +
          '<span class="cca-mg-track" style="width:' + W + 'px;">' + bar + '</span>' +
          '<span class="cca-mg-fin">' + (pv && pv.err
            ? '<span class="cca-mg-no" title="' + esc(pv.err) + '">' + esc(pv.err) + '</span>'
            : pv && pv.newEnd
            ? esc(shortDate(pv.newEnd)) + ' <b class="cca-mg-plus">+' + pv.shift + 'd</b>'
            : esc(shortDate(e))) + '</span></div>';
      }).join('');
      out += '</div>';

      if (rows.length > 120) out += '<div class="cca-mg-more">+' + (rows.length - 120) + ' more not drawn</div>';
      var nodate = list.length - rows.length;
      if (nodate) out += '<div class="cca-mg-more">' + nodate + ' selected activit' + (nodate === 1 ? 'y has' : 'ies have') + ' no dates and cannot be drawn.</div>';
      return out;
    }

    function ladderHTML(lad) {
      if (!lad.rungs.length) return '<div class="cca-warn cca-noladder">' + placesEmptyText() + '</div>';
      return '<div class="cca-lad">' + lad.rungs.map(function (r) {
        return '<div class="cca-col"><div class="cca-h"><span>' + esc(r.level.name) + '</span><span>' + r.values.length + '</span></div>' +
          '<div class="cca-body cca-ladbody">' + r.values.map(function (v) {
            var st = rungState(v);
            return '<div class="cca-row' + (r.sel && v.key === r.sel.key ? ' on' : '') + '" data-lvl="' + esc(r.level.id) + '" data-v="' + esc(v.key) + '">' +
              '<input type="checkbox" data-rk="' + esc(v.key) + '" data-rl="' + esc(r.level.id) + '"' + (st.all ? ' checked' : '') + (st.part ? ' data-part="1"' : '') + '>' +
              '<span class="cca-name" title="' + esc(v.spellings.join(' / ')) + '">' + esc(v.label) + '</span>' +
              (v.spellings.length > 1 ? '<span class="cca-alt" title="Spelled ' + esc(v.spellings.join(' / ')) + ' on this schedule — treated as one place">×' + v.spellings.length + '</span>' : '') +
              '<span class="cca-n">' + (st.on ? st.on + '/' : '') + v.acts.length + '</span></div>';
          }).join('') + '</div></div>';
      }).join('') + '</div>';
    }

    function treeRowHTML(e) {
      var pad = 'padding-left:' + (10 + e.depth * 14) + 'px;';
      if (e.branch) {
        var on = 0; (e.acts || []).forEach(function (a) { if (sel[a.activity_id]) on++; });
        var all = on > 0 && on === e.n, part = on > 0 && on < e.n;
        return '<div class="cca-row cca-tbranch" data-branch="' + esc(e.code) + '" style="' + pad + '">' +
          '<span class="cca-caret">' + (open[e.code] ? '▾' : '▸') + '</span>' +
          '<input type="checkbox" data-bk="' + esc(e.code) + '"' + (all ? ' checked' : '') + (part ? ' data-part="1"' : '') + '>' +
          '<span class="cca-code">' + esc(e.code) + '</span>' +
          '<span class="cca-name" title="' + esc(e.name) + '">' + esc(e.name || '(unnamed branch)') + '</span>' +
          '<span class="cca-n">' + (on ? on + '/' : '') + e.n + '</span></div>';
      }
      var a = e.a;
      return '<div class="cca-row" data-act="' + esc(a.activity_id) + '" style="' + pad + '">' +
        '<input type="checkbox" data-ak="' + esc(a.activity_id) + '"' + (sel[a.activity_id] ? ' checked' : '') + '>' +
        '<span class="cca-code">' + esc(a.activity_id) + '</span>' +
        '<span class="cca-name" title="' + esc((a.activity_name || '') + (e.qual ? ' · ' + e.qual : '')) + '">' +
          esc(a.activity_name || '') + (e.qual ? ' <span class="cca-qual">· ' + esc(e.qual) + '</span>' : '') + '</span>' +
        (a.change_order_ref ? '<span class="cca-co" title="Already cites change order ' + esc(a.change_order_ref) + '">' + esc(a.change_order_ref) + '</span>' : '') +
        '</div>';
    }

    function emptyTreeText(hits) {
      if (hits) return 'No activity matches “' + esc(q) + '”.';
      if (ACTS_LOAD === 'ok' && !ACTS.length) return 'This project has no schedule activities yet.';
      return 'Nothing at this place. Move the ladder above, or search.';
    }
    /* ⚠️ Each state gets its OWN sentence. "No places" is three different facts — the location
       migration is missing, the read was refused, or the project genuinely has no breakdown yet —
       and only the last is not something to act on. Saying "no locations defined" for all three is
       a failure this module has already shipped once. */
    function placesEmptyText() {
      if (LVL_LOAD === 'error') return 'The location levels could not be read. If this project has never had them, run <code>' + esc(MIGRATION_LOC) + '</code>. Searching still works.';
      if (!LEVELS.length) return 'This project has no location breakdown defined yet, so there is no ladder to climb. Search for activities below, or define levels in Schedule Setup › Floors &amp; Zones.';
      return 'No activity carries a location value yet. Search for activities below, or match the WBS to locations in the Project Schedule.';
    }
    function noticeHTML() {
      var out = '';
      if (ACTS_LOAD === 'error') {
        out += '<p class="cca-warn">The schedule could not be read: ' + esc(ACTS_ERR) + '. Nothing can be selected until that is fixed.</p>';
      } else if (ACTS_LOAD === 'ok' && !ACTS.length) {
        out += '<p class="cca-warn">This project has no schedule activities yet, so there is nothing to select. Import or build the schedule first.</p>';
      }
      if (LINK_LOAD === 'error') {
        out += '<p class="cca-warn">' + (String(LINK_ERR).indexOf('no-migration:') === 0
          ? 'Affected activities cannot be saved until <code>' + esc(MIGRATION) + '</code> is run in the Supabase SQL editor. You can still pick them — the record will save and the selection will be reported as unsaved.'
          : 'The existing links could not be read: ' + esc(LINK_ERR)) + '</p>';
      }
      var miss = opts.ccId ? missingFor(opts.ccId) : [];
      if (miss.length) {
        out += '<p class="cca-warn">' + miss.length + ' linked activit' + (miss.length === 1 ? 'y is' : 'ies are') +
          ' no longer on the schedule (' + esc(miss.slice(0, 6).join(', ')) + (miss.length > 6 ? ', …' : '') +
          '). A re-import renumbers activities; re-pick them or they will stay unmatched.</p>';
      }
      return out;
    }

    function paint() {
      var hits = searchHits();
      var lad = ladderOf(ACTS, LEVELS, cur);
      cur = lad.cursor;                                   // adopt the re-derived position
      var scope = hits || lad.cand;
      /* ⚠️ SELECTED-BUT-OUT-OF-SCOPE ROWS ARE ALWAYS APPENDED. Without this, moving the ladder
         hides rows the planner ticked individually while the footer goes on counting them — and a
         selection you cannot see is a selection you cannot correct. */
      var seen = {}; scope.forEach(function (a) { seen[a.activity_id] = 1; });
      var extra = ACTS.filter(function (a) { return sel[a.activity_id] && !seen[a.activity_id]; });
      var listed = scope.concat(extra).slice(0, ROW_CAP);
      var entries = treeOf(listed, NAME_BY_CODE, LEVELS);
      // a search opens what it found, so hits are never hidden behind a shut branch
      if (hits) entries.forEach(function (e) { if (e.branch) open[e.code] = 1; });
      var vis = visibleTree(entries, open);
      var nSel = Object.keys(sel).length;
      var selActs = ACTS.filter(function (a) { return sel[a.activity_id]; });

      host.style.setProperty('--cca-rungs', String(Math.max(1, lad.rungs.length)));
      host.innerHTML =
        noticeHTML() +
        '<div class="cca-bar">' +
          '<input class="pd-input pd-input-sm cca-q cca-ctl" id="cca-q" placeholder="Search every activity — id, name, WBS or place" value="' + esc(q) + '">' +
          '<span class="cca-count" id="cca-seln">' + nSel + ' selected</span>' +
          (nSel ? '<button type="button" class="pd-btn pd-btn-sm" id="cca-clear">Clear</button>' : '') +
        '</div>' +
        ladderHTML(lad) +
        '<div class="cca-lower">' +
          '<div class="cca-col">' +
            '<div class="cca-h"><span>Activities' + (hits ? ' · search' : '') + '</span>' +
              '<span>' + listed.length + (listed.length >= ROW_CAP ? '+' : '') + '</span></div>' +
            '<div class="cca-body cca-treebody">' +
              (vis.length ? vis.map(treeRowHTML).join('') : '<div class="cca-empty">' + emptyTreeText(hits) + '</div>') +
            '</div>' +
          '</div>' +
          '<div class="cca-col">' +
            '<div class="cca-h"><span>Preview</span>' +
              '<span class="cca-durwrap">CO <input class="cca-dur cca-ctl" id="cca-dur" size="3" inputmode="numeric" value="' + (coDur || '') + '" placeholder="0"> days</span></div>' +
            '<div class="cca-body cca-mgbody">' + impactHTML(selActs) +
              (selActs.length
                ? '<details class="cca-imp-det"' + (selActs.length <= 12 ? ' open' : '') + '>' +
                    '<summary>Per activity (' + selActs.length + ')</summary>' +
                    ganttHTML(selActs) + '</details>'
                : '') + '</div>' +
          '</div>' +
        '</div>';
      wire();
      if (opts.onCount) opts.onCount(nSel);
    }

    function keepCaret(id) { var n = host.querySelector('#' + id); if (n) { n.focus(); n.selectionStart = n.selectionEnd = n.value.length; } }

    function wire() {
      var qi = host.querySelector('#cca-q');
      if (qi) qi.oninput = function () { q = qi.value; paint(); keepCaret('cca-q'); };
      var cl = host.querySelector('#cca-clear');
      if (cl) cl.onclick = function () { sel = {}; paint(); };
      var du = host.querySelector('#cca-dur');
      if (du) du.oninput = function () {
        coDur = Math.max(0, Math.min(999, parseInt(String(du.value).replace(/[^0-9]/g, ''), 10) || 0));
        paint(); keepCaret('cca-dur');
      };

      /* ⚠️ ROW CLICK NAVIGATES, CHECKBOX CLICK SELECTS — and this guard is what keeps them apart.
         Without it, ticking a tower would also jump the ladder into it, the bug boq.js's own
         handler documents. */
      host.querySelectorAll('.cca-row[data-lvl]').forEach(function (el) {
        el.onclick = function (e) {
          if (e.target && e.target.tagName === 'INPUT') return;
          /* Moving a rung CLEARS EVERY RUNG BELOW IT. `ladderOf` re-derives regardless, so this
             makes the reset explicit rather than incidental — and stops a stale deep cursor
             briefly resolving against another tower's values. */
          var li = -1;
          for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === el.dataset.lvl) li = i;
          cur[el.dataset.lvl] = el.dataset.v;
          for (var j = li + 1; j < LEVELS.length; j++) delete cur[LEVELS[j].id];
          paint();
        };
      });
      host.querySelectorAll('input[data-rk]').forEach(function (cb) {
        cb.onchange = function () {
          /* ⚠️ Reads the checkbox's own NEW state rather than recomputing from rungState: a partly
             selected rung must become FULLY selected on the first click, not clear the few already
             ticked. Same class of bug as boq.js's leaf/isOn fix. */
          var want = cb.checked, lvl = cb.dataset.rl, key = cb.dataset.rk;
          ladderOf(ACTS, LEVELS, cur).rungs.forEach(function (r) {
            if (r.level.id !== lvl) return;
            r.values.forEach(function (v) { if (v.key === key) setMany(v.acts, want); });
          });
          paint();
        };
      });

      host.querySelectorAll('.cca-row[data-branch]').forEach(function (el) {
        el.onclick = function (e) {
          if (e.target && e.target.tagName === 'INPUT') return;
          var c = el.dataset.branch;
          if (open[c]) delete open[c]; else open[c] = 1;
          paint();
        };
      });
      host.querySelectorAll('input[data-bk]').forEach(function (cb) {
        cb.onchange = function () {
          setMany(actsUnder(ACTS, cb.dataset.bk), cb.checked);
          open[cb.dataset.bk] = 1;
          paint();
        };
      });
      host.querySelectorAll('input[data-ak]').forEach(function (cb) {
        cb.onchange = function () {
          if (cb.checked) sel[cb.dataset.ak] = 1; else delete sel[cb.dataset.ak];
          paint();
        };
      });
      // Partial ticks are a DOM PROPERTY, not an attribute — applied after every paint.
      host.querySelectorAll('[data-part]').forEach(function (cb) { cb.indeterminate = true; });
    }

    paint();
    return {
      ids: function () { return Object.keys(sel); },
      count: function () { return Object.keys(sel).length; },
      refresh: paint
    };
  }

  return {
    init: init, setProject: setProject, reset: reset,
    ensureLinks: ensureLinks, ensureActs: ensureActs, ensureLevels: ensureLevels,
    listFor: listFor, countFor: countFor, countsByRecord: countsByRecord,
    missingFor: missingFor, linkState: linkState, migration: MIGRATION,
    saveFor: saveFor, pickerHTML: pickerHTML, mount: mount,
    /* Exported for the verification suite only. These are the pieces with non-obvious behaviour,
       and every one of them is a PURE function so it can be executed without a database or a
       browser — which is why the ladder, the tree and the preview were hoisted out of mount(). */
    _internals: {
      normKey: normKey, bestSpelling: bestSpelling, spellRank: spellRank,
      stampSegs: stampSegs, cmpCode: cmpCode, actsUnder: actsUnder, locSuffix: locSuffix,
      valuesAt: valuesAt, ladderOf: ladderOf, treeOf: treeOf, visibleTree: visibleTree,
      previewOf: previewOf, impactOf: impactOf, pd: pd, addDays: addDays, dayDiff: dayDiff
    }
  };
})();
