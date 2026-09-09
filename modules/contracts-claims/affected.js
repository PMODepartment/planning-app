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
    ACTS = []; ACTS_LOAD = 'pending'; ACTS_ERR = '';
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
      /* Leaves only. A WBS Summary is a heading -- it carries no work, and a change order raised
         against a heading would double-count every activity beneath it. Same exclusion
         `boq_tag_activities` makes in SQL. */
      ACTS = (rows || []).filter(function (r) { return r.activity_type !== 'WBS Summary' && r.activity_id; });
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

  // ---- the picker ----------------------------------------------------------
  function pickerHTML() {
    return '<div class="cca" id="cca-root"><div class="cca-loading">Reading the schedule…</div></div>';
  }

  /* Mounts into `root` (which must already be in the document) and resolves to a handle:
       { ids(), count(), refresh() }
     ⚠️ ASYNC AND MOUNTED AFTER PAINT, the same shape `D.mountBoqPicker` uses on the wizard's
     Trades step. The wizard rebuilds its body with innerHTML on every step change, so a picker
     that rendered synchronously from a step function would be handed a node that is about to be
     replaced. */
  async function mount(root, opts) {
    opts = opts || {};
    var host = root.querySelector('#cca-root') || root;
    await Promise.all([ensureLevels(), ensureActs(), ensureLinks()]);

    var sel = {};                             // activity_id -> 1
    (opts.initial || []).forEach(function (i) { if (i) sel[String(i)] = 1; });
    var lvlId = (LEVELS[0] && LEVELS[0].id) || '';
    var q = '';

    /* Values at one level, grouped by normalised key. Returns
       [{ key, label, variants, acts }] with the biggest place first -- on a real schedule the
       planner is far more often after a whole tower than a single unit. */
    function placesAt(levelId) {
      if (!levelId) return [];
      var byKey = {};
      ACTS.forEach(function (a) {
        var v = (a.location && a.location[levelId]) || '';
        v = String(v).trim(); if (!v) return;
        var k = normKey(v); if (!k) return;
        (byKey[k] = byKey[k] || { key: k, variants: [], acts: [] });
        byKey[k].variants.push(v); byKey[k].acts.push(a);
      });
      return Object.keys(byKey).map(function (k) {
        var g = byKey[k];
        return { key: k, label: bestSpelling(g.variants), variants: g.variants, acts: g.acts };
      }).sort(function (x, y) {
        if (y.acts.length !== x.acts.length) return y.acts.length - x.acts.length;
        return String(x.label).localeCompare(String(y.label), undefined, { numeric: true });
      });
    }

    var openKeys = {};                        // normalised place key -> 1 (expanded into the pane)
    var ROW_CAP = 400;                        // the pane is scanned, not paged; see the note below

    /* The activities pane. ⚠️ A TYPED QUERY SEARCHES THE WHOLE PROJECT, not the chosen place --
       that is the owner's *"optional to add other activities in the schedule as well"*. With no
       query it shows the expanded places' activities, plus anything already selected from
       elsewhere so a selection can never be invisible while it is still counted.
       ⚠️ TAKES the places it was already given rather than re-deriving them. The first cut called
       placesAt() a second time here, which returns FRESH objects -- so the `_open` flag paint()
       had just stamped was always undefined on them and expanding a place showed nothing at all.
       Caught by tracing the object identity, not by reading. */
    function visibleActs(places) {
      var ql = q.trim().toLowerCase();
      if (ql) {
        return ACTS.filter(function (a) {
          return String(a.activity_id).toLowerCase().indexOf(ql) >= 0 ||
                 String(a.activity_name || '').toLowerCase().indexOf(ql) >= 0 ||
                 String(a.wbs || '').toLowerCase().indexOf(ql) >= 0;
        }).slice(0, ROW_CAP);
      }
      var seen = {}, out = [];
      places.forEach(function (p) {
        if (!openKeys[p.key]) return;
        p.acts.forEach(function (a) { if (!seen[a.activity_id]) { seen[a.activity_id] = 1; out.push(a); } });
      });
      /* ⚠️ Selected-but-not-shown activities are appended, always. Without this, unticking a place
         would hide rows the planner had individually ticked while the footer went on counting
         them -- a selection you cannot see is a selection you cannot correct. */
      ACTS.forEach(function (a) { if (sel[a.activity_id] && !seen[a.activity_id]) { seen[a.activity_id] = 1; out.push(a); } });
      return out.slice(0, ROW_CAP);
    }

    function placeState(p) {
      var on = 0;
      p.acts.forEach(function (a) { if (sel[a.activity_id]) on++; });
      return on === 0 ? 'none' : (on === p.acts.length ? 'all' : 'some');
    }

    function paint() {
      var places = placesAt(lvlId);
      var acts = visibleActs(places);
      var nSel = Object.keys(sel).length;
      var lvlName = (LEVELS.filter(function (l) { return l.id === lvlId; })[0] || {}).name || '';

      host.innerHTML =
        noticeHTML() +
        '<div class="cca-bar">' +
          (LEVELS.length
            /* ⚠️ Labelled "Level", not "Place" -- the OPTIONS are the project's location LEVEL
               names ("Tower", "Level", "Zone"), so "Place" beside a box reading "Level" reads as
               a contradiction. Caught by looking at the render, not the code. The pane heading
               below carries the chosen level's own name. */
            ? '<label class="cca-lbl">Level<select class="pd-select pd-input-sm" id="cca-lvl">' +
                LEVELS.map(function (l) {
                  return '<option value="' + esc(l.id) + '"' + (l.id === lvlId ? ' selected' : '') + '>' + esc(l.name) + '</option>';
                }).join('') +
              '</select></label>'
            : '') +
          '<input class="pd-input pd-input-sm cca-q" id="cca-q" placeholder="Search every activity — id, name or WBS" value="' + esc(q) + '">' +
          '<span class="cca-count" id="cca-seln">' + nSel + ' selected</span>' +
          (nSel ? '<button type="button" class="pd-btn pd-btn-sm" id="cca-clear">Clear</button>' : '') +
        '</div>' +
        '<div class="cca-panes">' +
          '<div class="cca-col">' +
            '<div class="cca-h"><span>' + (LEVELS.length ? esc(lvlName || 'Place') : 'Place') + '</span><span>' + places.length + '</span></div>' +
            '<div class="cca-body">' + (places.length
              ? places.map(function (p) {
                  var st = placeState(p);
                  return '<div class="cca-row' + (openKeys[p.key] ? ' on' : '') + '" data-place="' + esc(p.key) + '">' +
                    '<input type="checkbox" data-pk="' + esc(p.key) + '"' + (st === 'all' ? ' checked' : '') +
                      (st === 'some' ? ' data-part="1"' : '') + '>' +
                    '<span class="cca-name" title="' + esc(p.variants.filter(uniq).join(' / ')) + '">' + esc(p.label) + '</span>' +
                    (p.variants.filter(uniq).length > 1 ? '<span class="cca-alt" title="Spelled ' + esc(p.variants.filter(uniq).join(' / ')) + ' on this schedule — treated as one place">×' + p.variants.filter(uniq).length + '</span>' : '') +
                    '<span class="cca-n">' + p.acts.length + '</span></div>';
                }).join('')
              : '<div class="cca-empty">' + placesEmptyText() + '</div>') +
            '</div>' +
          '</div>' +
          '<div class="cca-col">' +
            '<div class="cca-h"><span>Activities</span><span id="cca-shown">' + acts.length + (acts.length >= 400 ? '+' : '') + '</span></div>' +
            '<div class="cca-body">' + (acts.length
              ? acts.map(function (a) {
                  return '<div class="cca-row" data-act="' + esc(a.activity_id) + '">' +
                    '<input type="checkbox" data-ak="' + esc(a.activity_id) + '"' + (sel[a.activity_id] ? ' checked' : '') + '>' +
                    '<span class="cca-code">' + esc(a.activity_id) + '</span>' +
                    '<span class="cca-name" title="' + esc(a.wbs || '') + '">' + esc(a.activity_name || '') + '</span>' +
                    (a.change_order_ref ? '<span class="cca-co" title="Already carries change order ' + esc(a.change_order_ref) + '">' + esc(a.change_order_ref) + '</span>' : '') +
                    '<span class="cca-n">' + (a.start_date ? esc(Fmt.date(a.start_date)) : '—') + '</span></div>';
                }).join('')
              : '<div class="cca-empty">' + (q.trim() ? 'No activity matches “' + esc(q) + '”.' : 'Tick a place on the left, or search for an activity.') + '</div>') +
            '</div>' +
          '</div>' +
        '</div>';
      wire();
    }

    function uniq(v, i, arr) { return arr.indexOf(v) === i; }

    /* ⚠️ Each state gets its OWN sentence. "No places" is three different facts -- the location
       migration is missing, the read was refused, or the project genuinely has no breakdown yet --
       and only the last one is not something to act on. Saying "no locations defined" for all
       three is the failure this module has already shipped once. */
    function placesEmptyText() {
      if (LVL_LOAD === 'error') return 'The location levels could not be read. If this project has never had them, run <code>' + esc(MIGRATION_LOC) + '</code>. Searching still works.';
      if (!LEVELS.length) return 'This project has no location breakdown defined yet, so there are no places to pick from. Search for activities instead, or define levels in Schedule Setup › Floors &amp; Zones.';
      return 'No activity carries a value at this level. Try another place, or search.';
    }
    function noticeHTML() {
      var out = '';
      if (ACTS_LOAD === 'error') {
        out += '<p class="cca-warn">The schedule could not be read: ' + esc(ACTS_ERR) +
          '. Nothing can be selected until that is fixed.</p>';
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

    function wire() {
      var lv = host.querySelector('#cca-lvl');
      if (lv) lv.onchange = function () { lvlId = lv.value; openKeys = {}; paint(); };
      var qi = host.querySelector('#cca-q');
      if (qi) {
        qi.oninput = function () { q = qi.value; paint(); var n = host.querySelector('#cca-q'); if (n) { n.focus(); n.selectionStart = n.selectionEnd = n.value.length; } };
      }
      var cl = host.querySelector('#cca-clear');
      if (cl) cl.onclick = function () { sel = {}; paint(); };

      // A place row: the label expands it into the right pane; the checkbox selects all of it.
      host.querySelectorAll('.cca-row[data-place]').forEach(function (el) {
        var cb = el.querySelector('input[data-pk]');
        el.onclick = function (e) {
          if (e.target === cb) return;
          openKeys[el.dataset.place] = !openKeys[el.dataset.place];
          paint();
        };
        if (cb) cb.onchange = function () {
          var p = placesAt(lvlId).filter(function (x) { return x.key === el.dataset.place; })[0];
          if (!p) return;
          /* ⚠️ Reads the checkbox's own new state rather than recomputing from `placeState`: a
             PARTLY selected place must become fully selected on the first click, not clear the
             few that were already ticked. */
          if (cb.checked) p.acts.forEach(function (a) { sel[a.activity_id] = 1; });
          else p.acts.forEach(function (a) { delete sel[a.activity_id]; });
          openKeys[el.dataset.place] = true;
          paint();
        };
      });
      host.querySelectorAll('input[data-ak]').forEach(function (cb) {
        cb.onchange = function () {
          if (cb.checked) sel[cb.dataset.ak] = 1; else delete sel[cb.dataset.ak];
          paint();
        };
      });
      if (opts.onCount) opts.onCount(Object.keys(sel).length);
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
    /* Exported for the render harness only — the normalisation is the one piece here with
       non-obvious behaviour, and it must be testable without a database. */
    _internals: { normKey: normKey, bestSpelling: bestSpelling, spellRank: spellRank }
  };
})();
