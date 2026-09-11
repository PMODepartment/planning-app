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
  /* ⚠️ LOAD-BEARING, NOT TIDINESS — the reason this normalisation exists at all. A real schedule
     spells one floor several ways: Avesta carries "2ND FLOOR" and "2nd Floor", Jab carries
     "Roofdeck" and "Roof Deck". Offering those as separate places means the planner ticks one,
     believes they have selected the 5th floor, and silently misses the twelve activities spelled
     the other way -- on a change order, that is scope left out of a claim. So values are GROUPED
     by normalised key and shown under one spelling.

     ⚠️ THE DUPLICATE IS RETIRED. The copy that lived here is now `assets/js/locmatch.js`
     (`window.PDLoc`), loaded by this page and by the schedule's, so there is one implementation
     instead of three. The local names are KEPT as thin delegates rather than being renamed at
     ~40 call sites and in the `_internals` export the suite reads — a rename would have made the
     diff impossible to check for the one thing that matters, which is that behaviour is unchanged.

     ⚠️ Resolved at CALL TIME, never captured into a local at load time: `locmatch.js` is a
     separate <script> and capturing `window.PDLoc.normKey` while it was still undefined would
     throw on the first grouping rather than degrade. */
  function normKey(v) { return PDLoc.normKey(v); }
  function spellRank(v) { return PDLoc.spellRank(v); }
  function bestSpelling(variants) { return PDLoc.bestSpelling(variants || []); }

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
  /* ⚠️⚠️ ACTIVITIES WITH NO VALUE AT THIS LEVEL GET THEIR OWN BUCKET, and before 2026-09-10 they
     were DROPPED — `if (!v) return;` and nothing else. Because `ladderOf` then narrows with
     `cand = chosen.acts`, an activity that stops short of the deepest level became invisible in
     every rung below it and in the tree.

     Owner, 2026-09-10, on OPW101: *"Structural works doesn't appear on some floors."* Exactly
     that. Structural work on the 7th floor is filed to the ZONE and carries no UNIT, so the moment
     the Unit rung auto-positioned on U1 all 24 structural activities were gone — with nothing on
     screen saying anything had been filtered out. The counts showed it if you added them up: the
     floor held 240 activities and its zone values summed to 236.

     ⚠️ THIS IS NOT THE "every zone at once" MODE THE NOTE ABOVE FORBIDS. The bucket lives inside
     `cand`, which every rung above has already narrowed, so it is still strictly top-down — it is
     "the activities HERE that name no <level>", not a value gathered across towers. No composite
     key is needed and none is introduced.
     ⚠️ The sentinel cannot collide with a real key: `normKey` strips to letters and digits, so a
     control character is unreachable by any spelling of a real place. */
  /* The sentinels are ATTRIBUTE-SAFE, and that is not cosmetic. They were control characters
     (\u0000) and it cost a silent failure: an HTML parser substitutes U+FFFD for a NUL, so
     `el.dataset.v` read back '\ufffdall', never matched, and the ladder fell through to the
     first value — both new gestures rendered perfectly and did nothing when clicked.
     `normKey` ends `.replace(/[^a-z0-9]+/g, '')`, so EVERY real key is [a-z0-9] only and any
     sentinel carrying another character cannot collide with a spelling of a real place. */
  var NO_VALUE = '*none*';
  function valuesAt(cand, levelId) {
    var byKey = {}, none = [];
    cand.forEach(function (a) {
      var v = String((a.location && a.location[levelId]) || '').trim();
      var k = v ? normKey(v) : '';
      if (!k) { none.push(a); return; }
      (byKey[k] = byKey[k] || { key: k, variants: [], acts: [] });
      byKey[k].variants.push(v); byKey[k].acts.push(a);
    });
    var out = Object.keys(byKey).map(function (k) {
      var g = byKey[k];
      var uniq = g.variants.filter(function (v, i, arr) { return arr.indexOf(v) === i; });
      return { key: k, label: bestSpelling(g.variants), spellings: uniq, acts: g.acts };
    }).sort(function (x, y) {
      if (y.acts.length !== x.acts.length) return y.acts.length - x.acts.length;
      return String(x.label).localeCompare(String(y.label), undefined, { numeric: true });
    });
    /* ⚠️ LAST, and only when there are any — it is not a place, so it must not outrank one however
       many activities are in it, and an empty bucket on a fully-filed project would be noise.
       ⚠️ It is also never emitted as the ONLY entry: a level where nothing carries a value is the
       "skip this rung" case `ladderOf` already handles, and a lone "— none —" rung would be a pane
       that says nothing and costs a column. */
    if (none.length && out.length) {
      out.push({ key: NO_VALUE, label: '', spellings: [], acts: none, none: true });
    }
    return out;
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
  /* ALL_VALUES - "every value at this level", so a line can be linked ACROSS the floors.
     Owner, 2026-09-10: *"Is there a way to select all floors but select specific activities only
     from the selection?"* Yes, and it is the ordinary case for a Structural bill: "Rebar Works"
     covers the rebar on EVERY floor, and picking floors one at a time is eighteen passes.

     AND IT IS WHY THE RUNGS BELOW AN "ALL" ARE NOT RENDERED. The note on valuesAt forbids a
     "show me every zone at once" mode without a composite key, and it is right: with Level on All,
     a Zone rung would merge the 5th floor's Z1 with the 7th floor's Z1 - the same string, two
     different places - and ticking it would silently take both. So resolution stays strictly
     top-down: the ladder stops at the first All, and the tree plus the search take over, which is
     exactly the "then select specific activities only" half of the ask. */
  var ALL_VALUES = '*all*';
  function ladderOf(base, levels, cursor) {
    var rungs = [], cand = base, out = {};
    for (var i = 0; i < (levels || []).length; i++) {
      var lv = levels[i];
      var vals = valuesAt(cand, lv.id);
      if (!vals.length) continue;
      /* ⚠️⚠️ THE DEFAULT IS "ALL", AND IT USED TO BE `vals[0]`. Owner, 2026-09-10, on
         OPW101: *"Structural works isn't viewing properly."* Every rung defaulting to its own first
         value CASCADED - the picker opened on Tower 1 -> 5TH Floor -> Z1 -> U1, which is 18 of
         2,561 activities, and Structural Works was missing from the tree entirely because its work
         on that floor carries no Unit and so lives in the no-value bucket, not under U1.
         The planner chose none of that. An opening FILTER nobody asked for does not read as a
         filter; it reads as missing data, which is exactly how it was reported.
         Opening on All shows everything, and the rung below appears only once a value is picked -
         so the ladder is a drill-down instead of a guess. Nothing is SELECTED either way: the
         ladder positions the view, it never ticks a box. */
      var want = cursor ? cursor[lv.id] : null;
      if (want == null) want = ALL_VALUES;
      if (want === ALL_VALUES) {
        /* cand is NOT narrowed, and the loop STOPS. Both halves matter: the first is what makes
           "all floors" mean all of them, the second is what keeps a deeper rung from being
           resolved against an ambiguous parent. */
        out[lv.id] = ALL_VALUES;
        rungs.push({ level: lv, values: vals, sel: null, all: true, total: cand.length });
        break;
      }
      /* The DEFAULT is still the first value, not All. A ladder that opened on "everything" would
         show the whole project in the tree on every open, and the rung that answers "which floor
         am I on" would answer "all of them" - a filter nobody chose, which is the mirror of the
         bug the no-value bucket fixes. All is a deliberate click. */
      var chosen = vals.filter(function (v) { return v.key === want; })[0] || vals[0];
      out[lv.id] = chosen.key;
      rungs.push({ level: lv, values: vals, sel: chosen, all: false, total: cand.length });
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
    /* ⚠ SEPARATE from `open`. The picker tree and the preview Gantt show the same branches for
       different reasons -- you collapse a branch in the picker to stop scrolling past it, and in
       the preview to see the shape of the impact. Sharing one map made collapsing in one pane
       silently reorganise the other. Preview branches start OPEN, because a collapsed Gantt is
       an empty Gantt. */
    var gopen = {};
    var q = '';
    var coDur = 0;       // change-order duration for the preview; 0 = bars only
    /* ⚠️ Read ONCE, not per paint: `opts` is the caller's object and a caller that mutated it
       mid-session would change the picker's shape under the planner. Defaults to true, so the
       four existing call sites are untouched by their own silence. */
    var showPreview = opts.preview !== false;

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

    /* The change-order plan for the current selection, from the SHARED engine.
       ⚠️⚠️ `COInsert.bulkSplitPlan` is the SAME function the Project Schedule runs when it actually
       performs the insert (assets/js/co-insert.js). That is the whole point of the extraction: this
       preview cannot drift from what the insert does, because there is nothing to drift from.
       ⚠️ UTC helpers are handed in, because this module's dates are UTC while the schedule's are
       local. The engine standardises on neither -- see its header.
       ⚠️ `usedIds` reads ACTS, so a proposed Activity ID never collides with one already on the
       programme, exactly as it will not when the schedule writes it. */
    var CO = (window.COInsert && window.COInsert.make({
      pd: pd, dstr: function (d) { return d ? d.toISOString().slice(0, 10) : null; },
      addDays: addDays, dayDiff: dayDiff,
      usedIds: function () { return ACTS.map(function (a) { return a.activity_id; }); }
    })) || null;

    function optVal(k) { var v = opts[k]; return (typeof v === 'function') ? v() : (v || ''); }

    function planFor(hosts) {
      if (!CO || !coDur) return null;
      /* ⚠️ EOT IS NOT AN INSERT. Its activities are the delay BASIS -- the granted days move the
         contract completion date, they are not added to the work. The schedule's own bulk screen
         refuses to plan one for the same reason, and showing proposed activities here would invite
         a planner to expect rows that will never be created. */
      if (optVal('recType') === 'EOT') return null;
      return CO.bulkSplitPlan(hosts, optVal('coRef'), optVal('coName') || 'Change order', coDur, 'mid');
    }

    /* The Gantt. WBS branches, the host bars with the gap the variation opens inside them, and the
       CHANGE-ORDER ACTIVITIES THAT WILL BE CREATED drawn as their own rows beneath their host.
       Owner: *"a change order not only affects existing activities but will also add them."* */
    function ganttHTML(list) {
      if (!list.length) {
        return '<div class="cca-empty">Nothing selected yet.</div>';
      }
      var dated = list.filter(function (a) { return pd(a.start_date) && pd(a.end_date); });
      if (!dated.length) {
        return '<div class="cca-empty">' + list.length + ' selected, but none carry both a start ' +
               'and a finish, so there is nothing to draw.</div>';
      }

      var plan = planFor(dated);
      var byHost = {};
      (plan || []).forEach(function (p) { byHost[String(p.host.activity_id)] = p; });

      // ---- the window: everything the plan touches, before and after ----------
      var mn = null, mx = null;
      function seen(d) { if (!d) return; if (!mn || d < mn) mn = d; if (!mx || d > mx) mx = d; }
      dated.forEach(function (a) {
        seen(pd(a.start_date)); seen(pd(a.end_date));
        var p = byHost[String(a.activity_id)];
        if (p && p.build) { seen(pd(p.build.hostPatch.end_date)); seen(pd(p.build.coRow.end_date)); }
      });
      if (!mn || !mx) return '<div class="cca-empty">No dates to draw.</div>';
      var span = Math.max(1, dayDiff(mn, mx) + 1);
      function pct(d) { return Math.max(0, Math.min(100, (dayDiff(mn, d) / span) * 100)); }
      function seg(a, b) {
        var l = pct(a), r = pct(b);
        return 'left:' + l.toFixed(2) + '%;width:' + Math.max(0.4, r - l).toFixed(2) + '%;';
      }

      // ---- rows, grouped by WBS ----------------------------------------------
      var entries = treeOf(dated, NAME_BY_CODE, LEVELS);
      /* ⚠ `undefined` means never seen -> OPEN; an explicit 0 means the planner collapsed it.
         Using delete for the collapse would make it indistinguishable from never-seen, so a
         collapsed branch would spring open on the next repaint -- which is every keystroke. */
      entries.forEach(function (e) { if (e.branch && gopen[e.code] === undefined) gopen[e.code] = 1; });
      var vis = visibleTree(entries, gopen);
      var out = [], drawn = 0, capped = false;

      for (var i = 0; i < vis.length; i++) {
        var e = vis[i];
        var pad = 'padding-left:' + (8 + e.depth * 12) + 'px;';
        if (e.branch) {
          /* A branch row carries the span of everything under it, so a collapsed branch still says
             when its work happens rather than going blank. */
          var kids = e.acts || [], bs = null, be = null;
          kids.forEach(function (k) {
            var s = pd(k.start_date), en = pd(k.end_date);
            if (!s || !en) return;
            if (!bs || s < bs) bs = s;
            var p2 = byHost[String(k.activity_id)];
            if (p2 && p2.build) { var pe = pd(p2.build.hostPatch.end_date); if (pe > en) en = pe; }
            if (!be || en > be) be = en;
          });
          out.push('<div class="cca-gr-row cca-gr-branch" data-gb="' + esc(e.code) + '" style="' + pad + '">' +
            '<span class="cca-gr-lbl"><span class="cca-caret">' + (gopen[e.code] ? '▾' : '▸') + '</span>' +
            esc(e.name || e.code) + ' <i>' + e.n + '</i></span>' +
            '<span class="cca-gr-track">' +
              (bs && be ? '<i class="cca-gr-sum" style="' + seg(bs, be) + '"></i>' : '') +
            '</span></div>');
          continue;
        }

        if (drawn >= 300) { capped = true; break; }
        var a = e.a, s0 = pd(a.start_date), e0 = pd(a.end_date);
        var p = byHost[String(a.activity_id)];
        var bar = '';
        if (p && p.build) {
          var newEnd = pd(p.build.hostPatch.end_date);
          // the host, now finishing later
          bar += '<i class="cca-gr-bar" style="' + seg(s0, newEnd) + '"></i>';
          // ⚠️ The notch is drawn from the PLAN's own co window, not re-derived here -- it is where
          //    the engine says the work stops, so the picture cannot disagree with the insert.
          bar += '<i class="cca-gr-cut" style="' + seg(p.plan.co.start, p.plan.co.end) + '"></i>';
          bar += '<i class="cca-gr-ext" style="' + seg(e0, newEnd) + '"></i>';
        } else {
          bar += '<i class="cca-gr-bar" style="' + seg(s0, e0) + '"></i>';
        }
        out.push('<div class="cca-gr-row" style="' + pad + '">' +
          '<span class="cca-gr-lbl" title="' + esc(a.activity_id + ' · ' + (a.activity_name || '')) + '">' +
            esc(a.activity_name || a.activity_id) +
            (e.qual ? '<span class="cca-qual"> · ' + esc(e.qual) + '</span>' : '') + '</span>' +
          '<span class="cca-gr-track">' + bar + '</span></div>');
        drawn++;

        // ---- the activity this variation CREATES -----------------------------
        if (p && p.build) {
          var cr = p.build.coRow;
          out.push('<div class="cca-gr-row cca-gr-new" style="padding-left:' + (8 + (e.depth + 1) * 12) + 'px;">' +
            '<span class="cca-gr-lbl" title="' + esc('New activity ' + cr.activity_id + ' · ' +
              cr.start_date + ' → ' + cr.end_date + ' · ' + cr.predecessors) + '">' +
              '<span class="cca-gr-plus">+</span>' + esc(cr.activity_id) +
              '<span class="cca-qual"> · ' + esc(cr.activity_name) + '</span></span>' +
            '<span class="cca-gr-track">' +
              '<i class="cca-gr-cobar" style="' + seg(pd(cr.start_date), pd(cr.end_date)) + '"></i>' +
            '</span></div>');
        } else if (p && p.err) {
          out.push('<div class="cca-gr-row cca-gr-err" style="padding-left:' + (8 + (e.depth + 1) * 12) + 'px;">' +
            '<span class="cca-gr-lbl">' + esc(p.err) + '</span><span class="cca-gr-track"></span></div>');
        }
      }

      var nNew = (plan || []).filter(function (p) { return p.build; }).length;
      var nErr = (plan || []).filter(function (p) { return p.err; }).length;
      return '<div class="cca-gr-head"><span>' +
          (plan ? '<b>' + nNew + '</b> new activit' + (nNew === 1 ? 'y' : 'ies') + ' will be created' +
                  (nErr ? ' · <b>' + nErr + '</b> refused' : '')
                : (optVal('recType') === 'EOT'
                    ? 'An EOT adds no activities — its set is the delay basis'
                    : 'Enter a duration to see the activities this creates')) +
        '</span><span>' + esc(fullDate(mn)) + ' → ' + esc(fullDate(mx)) + '</span></div>' +
        '<div class="cca-gr">' + out.join('') + '</div>' +
        (capped ? '<div class="cca-mg-more">Showing the first 300 rows — collapse a branch to see the rest.</div>' : '');
    }

    function ladderHTML(lad) {
      if (!lad.rungs.length) return '<div class="cca-warn cca-noladder">' + placesEmptyText() + '</div>';
      var stopped = lad.rungs.length && lad.rungs[lad.rungs.length - 1].all;
      return '<div class="cca-lad">' + lad.rungs.map(function (r) {
        /* The whole candidate set at this rung, so "All" can be TICKED as well as positioned on -
           the two gestures the rest of the ladder already separates (clicking a row moves the
           position, clicking its box selects). */
        var allActs = [];
        r.values.forEach(function (v) { allActs = allActs.concat(v.acts); });
        var allSt = rungState({ acts: allActs });
        return '<div class="cca-col"><div class="cca-h"><span>' + esc(r.level.name) + '</span><span>' + r.values.length + '</span></div>' +
          '<div class="cca-body cca-ladbody">' +
          /* ALL, first and always. It answers "every floor", which for a trade bill is the normal
             reading - one Structural line covers the rebar on all eighteen of them. */
          '<div class="cca-row cca-rowall' + (r.all ? ' on' : '') + '" data-lvl="' + esc(r.level.id) + '" data-v="' + esc(ALL_VALUES) + '">' +
            '<input type="checkbox" data-rk="' + esc(ALL_VALUES) + '" data-rl="' + esc(r.level.id) + '"' +
              (allSt.all ? ' checked' : '') + (allSt.part ? ' data-part="1"' : '') + '>' +
            '<span class="cca-name"><em>All ' + esc(String(r.level.name).toLowerCase()) + 's</em></span>' +
            '<span class="cca-n">' + (allSt.on ? allSt.on + '/' : '') + allActs.length + '</span></div>' +
          r.values.map(function (v) {
            var st = rungState(v);
            /* The no-value bucket is labelled from the LEVEL, so it reads as a fact about the data
               ("no Zone recorded") rather than as a place called "none". */
            var lbl = v.none
              ? '<em>\u2014 no ' + esc(r.level.name) + ' recorded \u2014</em>'
              : esc(v.label);
            var ttl = v.none
              ? 'These activities carry no ' + esc(r.level.name) + '. They are filed one level up - normal where a trade is planned per floor rather than per zone. Before 2026-09-10 they were hidden entirely.'
              : esc(v.spellings.join(' / '));
            return '<div class="cca-row' + (r.sel && v.key === r.sel.key ? ' on' : '') + (v.none ? ' cca-rownone' : '') + '" data-lvl="' + esc(r.level.id) + '" data-v="' + esc(v.key) + '">' +
              '<input type="checkbox" data-rk="' + esc(v.key) + '" data-rl="' + esc(r.level.id) + '"' + (st.all ? ' checked' : '') + (st.part ? ' data-part="1"' : '') + '>' +
              '<span class="cca-name" title="' + ttl + '">' + lbl + '</span>' +
              (v.spellings.length > 1 ? '<span class="cca-alt" title="Spelled ' + esc(v.spellings.join(' / ')) + ' on this schedule — treated as one place">×' + v.spellings.length + '</span>' : '') +
              '<span class="cca-n">' + (st.on ? st.on + '/' : '') + v.acts.length + '</span></div>';
          }).join('') + '</div></div>';
      }).join('') + '</div>' +
      /* Says WHY the deeper rungs are gone, because a pane that silently disappears reads as a
         defect - and the reason is the one thing that stops a planner asking for it back. */
      (stopped
        ? '<p class="cca-hintline">Showing every ' + esc(String(lad.rungs[lad.rungs.length - 1].level.name).toLowerCase()) +
          '. The levels below it are hidden while it is on <em>All</em> — the same zone name means a different place on each one — so narrow with the search or pick from the tree.</p>'
        : '');
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
      /* ⚠️ HOW MANY OTHERS CARRY THIS NAME, counted over the WHOLE project rather than the current
         rung — "all the Rebar" is the question being asked, and it does not stop at this floor. */
      var _nk = normKey(a.activity_name || '');
      var _unpicked = 0;
      if (_nk) {
        for (var _si = 0; _si < ACTS.length; _si++) {
          var _sa = ACTS[_si];
          if (!sel[_sa.activity_id] && normKey(_sa.activity_name || '') === _nk) _unpicked++;
        }
      }
      return '<div class="cca-row" data-act="' + esc(a.activity_id) + '" style="' + pad + '">' +
        '<input type="checkbox" data-ak="' + esc(a.activity_id) + '"' + (sel[a.activity_id] ? ' checked' : '') + '>' +
        '<span class="cca-code">' + esc(a.activity_id) + '</span>' +
        '<span class="cca-name" title="' + esc((a.activity_name || '') + (e.qual ? ' · ' + e.qual : '')) + '">' +
          esc(a.activity_name || '') + (e.qual ? ' <span class="cca-qual">· ' + esc(e.qual) + '</span>' : '') + '</span>' +
        (a.change_order_ref ? '<span class="cca-co" title="Already cites change order ' + esc(a.change_order_ref) + '">' + esc(a.change_order_ref) + '</span>' : '') +
        /* Only when it would actually do something: on the last unpicked namesake there is nothing
           left to add, and an affordance that does nothing is worse than none. */
        (_unpicked > 1
          ? '<button type="button" class="cca-takeall" data-takename="' + esc(_nk) + '" ' +
            'title="Also select the other ' + (_unpicked - 1) + ' activities named &quot;' +
            esc(a.activity_name || '') + '&quot;, anywhere on this project">+' + (_unpicked - 1) + '</button>'
          : '') +
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
      /* ⚠️⚠️ THE CAP IS ON THE ROWS PAINTED, NOT ON THE ACTIVITIES THE TREE IS BUILT FROM,
         and that distinction was the whole bug. Owner, 2026-09-10, looking at Tower 1 / All levels
         with the header reading "400+": *"Why can't I see rebar works now?"*
         `slice(0, ROW_CAP)` was applied to the ACTIVITY LIST, so `treeOf` never saw activity 401
         onward - and a branch only exists if some activity in the list puts it there. The tree was
         therefore not merely scrolled short: 2ND and 3RD Floor were the only floors IN it, and no
         amount of expanding could reach Rebar Works. A cap on rows is a scroll; a cap on the
         source list silently deletes structure.
         Branches start CLOSED, so building from the full scope paints a few dozen rows, not 2,560 -
         the cap now trims what is actually visible, after the open/closed filter. */
      var listed = scope.concat(extra);
      var entries = treeOf(listed, NAME_BY_CODE, LEVELS);
      // a search opens what it found, so hits are never hidden behind a shut branch
      if (hits) entries.forEach(function (e) { if (e.branch) open[e.code] = 1; });
      var visAll = visibleTree(entries, open);
      var vis = visAll.slice(0, ROW_CAP);
      var visCut = visAll.length - vis.length;
      var nSel = Object.keys(sel).length;
      var selActs = ACTS.filter(function (a) { return sel[a.activity_id]; });

      host.style.setProperty('--cca-rungs', String(Math.max(1, lad.rungs.length)));
      /* ⚠️ A CLASS, not an inline grid override: `.cca-lower` already collapses to one column
         under 820px, and an inline style would beat that media query and re-create the two-column
         squeeze on a phone. Setting it on the HOST lets the rule sit beside its sibling in CSS. */
      host.classList.toggle('cca-nopreview', !showPreview);
      /* ⚠️⚠️ CAPTURED BEFORE THE WRITE BELOW DESTROYS THE ELEMENT. `innerHTML` replaces the
         scrollers wholesale and a fresh element starts at scrollTop 0, so expanding a branch threw
         the planner back to the top of the tree — on an 18-floor project that is the whole cost of
         the job. Keyed by CLASS rather than by index: the ladder is rebuilt with a different number
         of rungs depending on where the cursor sits, so a positional key would restore one pane's
         offset onto another. */
      var _keepScroll = {};
      ['.cca-treebody', '.cca-ladbody', '.cca-mgbody'].forEach(function (sel) {
        var el = host.querySelector(sel);
        if (el && el.scrollTop) _keepScroll[sel] = el.scrollTop;
      });
      host.innerHTML =
        noticeHTML() +
        '<div class="cca-bar">' +
          '<input class="pd-input pd-input-sm cca-q cca-ctl" id="cca-q" placeholder="Search every activity — id, name, WBS or place" value="' + esc(q) + '">' +
          /* SELECT EVERY MATCH IN ONE CLICK. Owner, 2026-09-10: *"I am picking Activities covering
             Rebar Works so I will link them to Rebar activities across multiple floors, zones, and
             units. Right now its very tedious work."* Ticking the Structural branch takes Formworks,
             Concrete and Precast with it, so the only route was to expand every zone of every floor
             and deselect three rows in each - 18 floors x 6 zones.
             A search ALREADY spans the whole project (`scope = hits || lad.cand`), so typing
             "Rebar" lists every Rebar activity on every floor. What was missing was a way to take
             them. This is that, and it is why the button states the COUNT rather than saying "all":
             the tree is capped at ROW_CAP, so a planner could otherwise select more than is on
             screen without knowing how many.
             It TOGGLES - once every match is selected it clears them - matching the rung
             checkboxes, and it is ADDITIVE otherwise, so "Rebar" then "Rebar Coupler" accumulates
             rather than replacing. */
          (hits && hits.length
            ? (function () {
                var on = hits.filter(function (a) { return sel[a.activity_id]; }).length;
                return '<button type="button" class="pd-btn pd-btn-sm' + (on === hits.length ? '' : ' pd-btn-primary') +
                  '" id="cca-selall">' + (on === hits.length ? 'Deselect' : 'Select') + ' all ' + hits.length + '</button>';
              })()
            : '') +
          '<span class="cca-count" id="cca-seln">' + nSel + ' selected</span>' +
          (nSel ? '<button type="button" class="pd-btn pd-btn-sm" id="cca-clear">Clear</button>' : '') +
        '</div>' +
        ladderHTML(lad) +
        '<div class="cca-lower">' +
          '<div class="cca-col">' +
            '<div class="cca-h"><span>Activities' + (hits ? ' · search' : '') + '</span>' +
              '<span>' + listed.length + '</span></div>' +
            '<div class="cca-body cca-treebody">' +
              (vis.length ? vis.map(treeRowHTML).join('') : '<div class="cca-empty">' + emptyTreeText(hits) + '</div>') +
              /* ⚠️ A cap whose entire notice is a "+" is a cap the planner cannot act on - it was
                 read as "there is no Rebar Works", not as "there is more". It now names the number
                 being held back and the two controls that reach it. */
              (visCut ? '<div class="cca-cut">' + visCut + ' more row' + (visCut === 1 ? '' : 's') +
                ' not shown — close a branch, or search to jump straight to them.</div>' : '') +
            '</div>' +
          '</div>' +
          /* ⚠️⚠️ THE PREVIEW COLUMN IS CHANGE-ORDER-SPECIFIC, so a caller that is not raising one
             suppresses it with `opts.preview === false`. The BOQ allocator reuses this picker to
             answer "which activities does this bill line cover" — the identical gesture — and a
             "CO ___ days" box with a schedule-slip Gantt beside it would be answering a question
             nobody asked, on a screen about quantities.
             ⚠️ SUPPRESSED, NOT REBUILT: one ladder, one tree, one search, four call sites. A second
             picker for the BOQ is exactly the drift this module has already paid for twice (two
             create dialogs, two import doors). `impactOf`/`ganttHTML` simply never run. */
          (showPreview
            ? '<div class="cca-col">' +
                '<div class="cca-h"><span>Preview</span>' +
                  '<span class="cca-durwrap">CO <input class="cca-dur cca-ctl" id="cca-dur" size="3" inputmode="numeric" value="' + (coDur || '') + '" placeholder="0"> days</span></div>' +
                /* ⚠ THE GANTT IS NOT HIDDEN BEHIND A TOGGLE ANY MORE. It was a <details> while it
                   was a strip of 240 one-pixel bars -- correct then, wrong now: grouped under its WBS
                   branches and carrying the activities the variation creates, it IS the preview, and
                   the headline above it is the summary of what it shows. */
                '<div class="cca-body cca-mgbody">' + impactHTML(selActs) +
                  (selActs.length ? ganttHTML(selActs) : '') + '</div>' +
              '</div>'
            : '') +
        '</div>';
      /* ⚠️ Restored synchronously, before the browser paints — a `requestAnimationFrame` here
         would show the top of the list for one frame and read as a flicker on every tick. */
      Object.keys(_keepScroll).forEach(function (sel) {
        var el = host.querySelector(sel);
        if (el) el.scrollTop = _keepScroll[sel];
      });
      wire();
      if (opts.onCount) opts.onCount(nSel);
    }

    function keepCaret(id) { var n = host.querySelector('#' + id); if (n) { n.focus(); n.selectionStart = n.selectionEnd = n.value.length; } }

    function wire() {
      var qi = host.querySelector('#cca-q');
      if (qi) qi.oninput = function () { q = qi.value; paint(); keepCaret('cca-q'); };
      var cl = host.querySelector('#cca-clear');
      if (cl) cl.onclick = function () { sel = {}; paint(); };
      var sa = host.querySelector('#cca-selall');
      /* Re-runs searchHits() rather than closing over paint()'s copy: the query can change between
         renders, and a stale hit list would select what the planner searched for a moment ago. */
      if (sa) sa.onclick = function () {
        var h = searchHits() || [];
        var on = h.filter(function (a) { return sel[a.activity_id]; }).length;
        setMany(h, on !== h.length);
        paint();
      };
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
            if (key === ALL_VALUES) {
              /* Every value on the rung, the no-value bucket included - which is the point: the
                 activities carrying no value at this level ARE part of "all of them", and leaving
                 them out would rebuild the very hole that bucket was added to close. */
              r.values.forEach(function (v) { setMany(v.acts, want); });
              return;
            }
            r.values.forEach(function (v) { if (v.key === key) setMany(v.acts, want); });
          });
          paint();
        };
      });

      host.querySelectorAll('.cca-gr-branch[data-gb]').forEach(function (el) {
        el.onclick = function () { var c = el.dataset.gb; gopen[c] = gopen[c] ? 0 : 1; paint(); };
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
      /* ⚠️ THE WHOLE ROW IS THE TARGET, not the checkbox inside it. Measured at 344px with the
         phone block live: the box is 13x13 against a 44px `--pd-tap`, and `.cca-row[data-act]`
         carried NO handler at all - so the row's 30px bought nothing, and the one row type a
         planner clicks hundreds of times was the smallest target in the dialog.
         The ladder rows and the branch rows have answered a row click all along (they move the
         rung / open the branch); the leaf rows simply had nothing else to do and were never wired.
         `sel` is toggled directly rather than the checkbox being clicked, because `paint()` rebuilds
         the row from `sel` anyway - driving the input would be a state that lives for one frame. */
      host.querySelectorAll('[data-takename]').forEach(function (b) {
        b.onclick = function (e) {
          /* ⚠️ The row underneath also answers a click. Without this the "+N" would tick the row
             AND take the namesakes, which reads as the button doing the wrong thing by one. */
          e.stopPropagation();
          var k = b.dataset.takename;
          ACTS.forEach(function (x) { if (normKey(x.activity_name || '') === k) sel[x.activity_id] = 1; });
          paint();
        };
      });
      host.querySelectorAll('.cca-row[data-act]').forEach(function (el) {
        el.onclick = function (e) {
          if (e.target && e.target.tagName === 'INPUT') return;
          if (e.target && e.target.closest && e.target.closest('[data-takename]')) return;
          var id = el.dataset.act;
          if (sel[id]) delete sel[id]; else sel[id] = 1;
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
