// ============================================================================
// Minutes of Meeting
// ----------------------------------------------------------------------------
// Split out of the combined "Issues, Concerns & Lessons Learned" module on the
// owner's explicit call: Minutes of Meeting and Issues & Concerns are now two
// separate modules, each with its own folder, its own topbar and its own
// project context — Lessons Learned stayed with the register (it is captured
// FROM an issue far more often than from a meeting).
//
// Tables: meeting_minutes / mom_items (unchanged — no migration for the split
// itself). What moved is the CODE, not the schema.
//
// ⚠️ THE LINK BETWEEN THE TWO MODULES IS DELIBERATELY KEPT, in both directions,
// as two LIGHT reads rather than a shared editor:
//   - Issues & Concerns keeps a light read of `meeting_minutes` (title/date only)
//     so its "From MOM" tag still resolves — see that module's `momTag()`.
//   - This module keeps a light read of `issues_lessons` (ISSUES, below) so a
//     linked action item can show the register's LIVE status, and so the
//     "Get from issue" panel can list what is open to bring in. It also keeps a
//     light read of `lessons_learned` (LESSONS) for the "N lessons" badge —
//     capturing/opening a lesson now navigates to the sibling module, since
//     Lessons Learned's editor lives there.
// Neither module owns the other's table; both only ever READ across the split,
// same shape as every other cross-module link in this app (e.g. the schedule's
// wpm_work_packages mirror).
//
// ⚠️ "RAISE AS ISSUE" IS GONE, ON PURPOSE. New issues are logged directly in
// Issues & Concerns now — that module is where problems are raised, this one is
// where they are minuted. In its place: "Get from issue" pulls an ALREADY-RAISED
// issue (from a PPR, or anywhere) onto this meeting's agenda as an action item,
// the reverse direction of the old button. The underlying link
// (`mom_items.issue_id` -> `issues_lessons.id`) is unchanged; only which side
// creates the row is reversed.
// ============================================================================

window.MinutesOfMeeting = (function () {
  var profile = null, UID = null;
  var pid = null, projName = '';
  // ⚠️ Same three-tier permission shape as Issues & Concerns
  // (migrations/2026-08-20-department-minutes.sql): any approved non-viewer
  // records minutes and maintains their own; a planner maintains all of them.
  // There is no screen-wide write flag — see canEditMinute()/canDeleteMinute()
  // below, which mirror the RLS per MINUTE, not per module.
  var canAdd = false, isSteward = false;

  var MOMS = [], MOM_ITEMS = [], _momErr = '', _momLoaded = false;
  // ⚠️ A LIGHT READ of the sibling module's register — id/description/status/
  // department/champion(_ids)/corrective_action/caused_by, the fields the "Get
  // from issue" panel and the linked-item status pill need. This module never
  // writes to issues_lessons.
  var ISSUES = [];
  // ⚠️ Likewise a light read of lessons_learned, for the "N lessons" badge only.
  var LESSONS = [];

  var MOM_ACT_NAME = {};        // activity_id -> activity_name, resolved on demand
  var _momActTimer = null;      // debounce for the activity search
  var _momDocClick = null;      // the one outside-click handler for the picker

  // One status vocabulary, shared with the register by the 2026-08-22 migration —
  // do not reintroduce a MoM-only list; the CHECK on mom_items refuses anything else.
  var STATUSES = ['Open', 'On Hold', 'Closed'];
  // ⚠️ Mirrors the `mom_items_type_chk` CHECK (migrations/2026-08-21-mom-schema-
  // carryover-distribute.sql). A value outside this list is refused by the
  // database, so the control is a <select>, never free text.
  var MOM_TYPES = ['Issue', 'FYI', 'Report'];
  // mom-app's own category list, taken as the union of its two disagreeing lists —
  // see the original module's note (now history) on why that matters.
  var MOM_CATEGORIES = [
    'Commercial / Contracts', 'Organizational Hr', 'Engineering', 'Procurement',
    'Operations', 'Risk', 'Stakeholder Management', 'Quality',
    'Project Execution Plan', 'Finance', 'Other Matters'
  ];
  // A starting vocabulary, NOT a closed list — meeting_type carries no CHECK, so
  // whatever a project actually uses joins it through momOptions().
  var MOM_MEETING_TYPES = ['PPR Meeting', 'PSC Meeting', 'Client Meeting'];

  // ⚠️ SESSION-ONLY, never persisted. Reporting view is how the record is being
  // LOOKED AT right now, not a property of the minute.
  var _momReport = false;
  var _momF = { q: '', cat: '', type: '', status: '' };   // action-item filters (Detail)
  var _momQ = '';                                          // meeting search (Browse)
  // ⚠️ 'list' | 'calendar' | 'detail'. Meetings are BROWSED (list or calendar) or a
  // single one is OPEN (detail); selecting or creating one switches into detail,
  // and "Back to meetings" returns to whichever browse mode was last active —
  // `_momBrowsePrev` is only ever set from list/calendar, never from detail, so
  // it can't collapse to "detail" itself.
  var _momView = 'list', _momBrowsePrev = 'list';
  var _momSel = null;
  var _momCalMonth = null;      // 'YYYY-MM' — the month the calendar view shows
  var _momSort = { col: 'date', dir: 'desc' };   // List view column sort

  // "Get from issue" panel state (Detail view) — see momGetPanelHTML.
  var _momPickerOpen = false, _momPickerQ = '';

  var histView = null;          // UI.bindHistoryState() handle — see init()

  function sb() { return AppAuth.getSB(); }

  // ===== live collaboration (presence + who's-editing row cursor) =====
  // ⚠️ Same connection the Issues & Concerns module used to share with this
  // screen when they were one page — presence still works with no migration
  // (it is broadcast, not a table read); the live-VALUE stream additionally
  // needs `meeting_minutes` in the realtime publication, which nothing in this
  // split adds — so it degrades to presence-only until that migration exists,
  // same as it silently did before the split (mom_items was never in it either).
  var _collab = null, _remoteSel = {}, _collabSelf = {}, PID_PFX = 'il';
  function joinCollab() {
    if (!window.PDCollab) return;
    if (_collab) { _collab.leave(); _collab = null; }
    _remoteSel = {};
    if (!pid) { renderPresence([]); return; }
    _collab = PDCollab.join({
      key: 'meeting_minutes:' + pid, table: 'meeting_minutes', projectId: pid, self: _collabSelf,
      onPresence: function (ms) { renderPresence(ms); _remoteSel = {}; ms.forEach(function (m) { if (!m.self && m.sel) _remoteSel[m.id] = { id: m.id, name: m.name, color: m.color, sel: m.sel }; }); paintRemote(); },
      onSelection: function (d) { if (d.sel) _remoteSel[d.id] = { id: d.id, name: d.name, color: d.color, sel: d.sel }; else delete _remoteSel[d.id]; paintRemote(); },
      onRemoteChange: applyRemoteChange
    });
  }
  function renderPresence(ms) { var el = document.getElementById(PID_PFX + '-presence'); if (el) el.innerHTML = window.PDCollab ? PDCollab.avatarsHTML(ms || []) : ''; }
  function paintRemote() { if (!window.PDCollab) return; PDCollab.clearCells(document); }
  function applyRemoteChange(payload) {
    var evt = payload.eventType || payload.event, rec = payload['new'] || payload.record || null, old = payload['old'] || payload.old_record || null;
    if (evt === 'DELETE') {
      var did = old && old.id; if (did == null) return;
      MOMS = MOMS.filter(function (x) { return String(x.id) !== String(did); });
    } else if (rec) {
      var j = -1; for (var i = 0; i < MOMS.length; i++) { if (String(MOMS[i].id) === String(rec.id)) { j = i; break; } }
      if (j < 0) MOMS.push(rec); else MOMS[j] = rec;
    } else return;
    render();
  }
  function $(id) { return document.getElementById(id); }
  function statusClass(s) {
    return s === 'Closed' ? 'is-closed' : (s === 'On Hold' ? 'is-hold' : 'is-open');
  }

  // ==========================================================================
  // PEOPLE PICKER — Champion (issues) and Responsible (meeting action items)
  // --------------------------------------------------------------------------
  // ⚠️ HYBRID BY DESIGN: ids AND text, both written on every save.
  //   * The IDS are what make "show me what I own" answerable. A typed name
  //     cannot be resolved to an account, and this register already contains
  //     "Ronquillo, Jules Norman; Agcaoili, Heherson" — no equality test will
  //     ever match that against a login.
  //   * The TEXT is kept because not every champion has an account (a
  //     subcontractor's engineer is named on an issue and will never log in),
  //     because every existing row's champion is text, and because a printed
  //     sheet shows names rather than uuids.
  // The app writes both from one control, so they cannot disagree.
  //
  // ⚠️ THE SELECTION LIVES IN THE DOM (`data-ids` on the root), not in a module
  // variable. Two pickers can be on screen at once (several action items), and
  // a partial re-render of one must not disturb the other — nor lose text the
  // planner has typed into a neighbouring field, which a full re-render would.
  // ==========================================================================
  var PEOPLE = [];

  function peopleById() {
    var by = {};
    PEOPLE.forEach(function (p) { by[p.id] = p; });
    return by;
  }
  // ⚠️ An id that no longer resolves is reported as "Unknown person", never
  // dropped. It means the person left; showing fewer champions than the row
  // records would silently misstate who owns the work.
  function peopleNamesOf(ids) {
    var by = peopleById();
    return (ids || []).map(function (id) {
      var p = by[id]; return (p && p.name) ? p.name : 'Unknown person';
    });
  }
  // The display string the register/PDF/export read. Named people first, then
  // anyone typed in free text, joined the way the existing data already reads.
  function championText(ids, extra) {
    var parts = peopleNamesOf(ids);
    var t = (extra || '').trim();
    if (t) parts.push(t);
    return parts.join('; ');
  }
  function idsOf(root) {
    var v = (root && root.dataset.ids) || '';
    return v ? v.split(',').filter(Boolean) : [];
  }

  // ⚠️ The qualifier is the COMPANY for a contact and the DEPARTMENT for an
  // account. Two people called Cruz are told apart by who they work for, and for
  // someone outside Megawide the department field is usually empty anyway.
  function personLabel(p) {
    var q = (p.kind === 'contact' ? (p.company || p.department) : p.department) || '';
    return (p.name || '(unnamed)') + (q ? ' · ' + q : '');
  }

  function peopleOptionsHTML(chosen) {
    var taken = {}; (chosen || []).forEach(function (i) { taken[i] = 1; });
    var list = PEOPLE.filter(function (p) { return !taken[p.id]; });
    // ⚠️ The select is rendered even when the roster is EMPTY, because it now
    // carries the way to add somebody. Returning '' on an empty list — as it did
    // before the directory existed — would hide the only route on exactly the
    // project that most needs it.
    return '<select class="pd-select pd-input-sm il-pp-add">' +
      '<option value="">' + (list.length ? '+ add a person…' : '+ add someone…') + '</option>' +
      list.map(function (p) {
        return '<option value="' + Fmt.esc(p.id) + '">' + Fmt.esc(personLabel(p)) +
          (p.kind === 'contact' ? ' (no account)' : '') + '</option>';
      }).join('') +
      // ⚠️ Deliberately the LAST option and clearly separated: creating a person is
      // a real write that everyone else then sees, so it must not be one keystroke
      // away from picking an existing colleague.
      '<option disabled>──────────</option>' +
      '<option value="__new__">＋ Someone without an account…</option>' +
    '</select>';
  }

  // The inline "new person" form. ⚠️ Inline, NOT a modal: the surrounding fields
  // are only read on Save, and this module already learned (the pop-up that was
  // deleted) that anything which repaints or overlays the form loses whatever the
  // planner had typed and not yet saved.
  function newPersonHTML() {
    return '<div class="il-pp-new">' +
      '<div class="il-pp-newrow">' +
        '<input class="pd-input pd-input-sm il-pp-nname" placeholder="Full name" />' +
        '<input class="pd-input pd-input-sm il-pp-nco" placeholder="Company or department" />' +
      '</div>' +
      '<div class="il-pp-newact">' +
        '<button type="button" class="pd-btn pd-btn-sm pd-btn-primary il-pp-nadd">Add person</button>' +
        '<button type="button" class="pd-btn pd-btn-sm il-pp-ncancel">Cancel</button>' +
        '<span class="il-pp-nnote">Saved once and offered to everyone from now on. ' +
          'They have no login, so this work will not appear on a My Work page.</span>' +
      '</div>' +
    '</div>';
  }

  // `key` only has to be unique among the pickers rendered at the same time.
  function peoplePickerHTML(key, ids, text, ro, newOpen) {
    ids = (ids || []).filter(Boolean);
    var names = peopleNamesOf(ids);
    if (ro) {
      var shown = championText(ids, text);
      return '<div class="il-mi-val' + (shown ? '' : ' is-empty') + '">' +
        (shown ? Fmt.esc(shown) : '—') + '</div>';
    }
    return '<div class="il-people" data-people="' + Fmt.esc(key) + '" data-ids="' + Fmt.esc(ids.join(',')) + '"' +
      (newOpen ? ' data-new="1"' : '') + '>' +
      (ids.length
        ? '<div class="il-pp-chips">' + (function () {
            var by = peopleById();
            return ids.map(function (id, i) {
              // ⚠️ A person with no account is MARKED on the chip. The planner
              // assigning the work has to be able to see, at a glance, that this
              // item will never surface on anyone's personal view — the two kinds
              // of champion look identical otherwise.
              var p = by[id] || {};
              var contact = p.kind === 'contact';
              return '<span class="il-pp-chip' + (contact ? ' is-contact' : '') + '"' +
                (contact ? ' title="No account on the dashboard"' : '') + '>' +
                Fmt.esc(names[i]) +
                (contact ? '<span class="il-pp-noacct">no account</span>' : '') +
                '<button type="button" class="il-pp-rm" data-rm="' + Fmt.esc(id) + '" title="Remove">✕</button></span>';
            }).join('');
          })() + '</div>'
        : '') +
      peopleOptionsHTML(ids) +
      (newOpen ? newPersonHTML() : '') +
      // ⚠️ The free-text box is NOT a fallback for a missing roster — it is how
      // someone without an account gets named. Its own label says so, or a
      // planner reasonably assumes the dropdown is the only valid route.
      '<input class="pd-input pd-input-sm il-pp-free" value="' + Fmt.esc(text || '') + '" ' +
        'placeholder="Others not on the system (typed)">' +
    '</div>';
  }

  // Rebuilds ONE picker in place and re-wires it. ⚠️ Never re-renders the whole
  // form: the surrounding fields are only read on Save, so a full repaint would
  // discard whatever the planner had typed but not yet saved.
  function repaintPicker(root, onChange, newOpen) {
    var key = root.dataset.people;
    var ids = idsOf(root);
    var free = root.querySelector('.il-pp-free');
    var text = free ? free.value : '';
    // ⚠️ A half-typed new person survives the repaint that removing a chip causes.
    // Losing it would make the two controls fight each other.
    var nn = root.querySelector('.il-pp-nname'), nc = root.querySelector('.il-pp-nco');
    var keepN = nn ? nn.value : '', keepC = nc ? nc.value : '';
    if (newOpen === undefined) newOpen = root.dataset.new === '1';
    var holder = document.createElement('div');
    holder.innerHTML = peoplePickerHTML(key, ids, text, false, newOpen);
    var fresh = holder.firstChild;
    root.parentNode.replaceChild(fresh, root);
    if (newOpen) {
      var f1 = fresh.querySelector('.il-pp-nname'), f2 = fresh.querySelector('.il-pp-nco');
      if (f1) { f1.value = keepN; f1.focus(); }
      if (f2) f2.value = keepC;
    }
    wirePeople(fresh.parentNode, onChange);
    return fresh;
  }

  function wirePeople(scope, onChange) {
    if (!scope) return;
    scope.querySelectorAll('.il-people').forEach(function (root) {
      if (root._wired) return;
      root._wired = true;
      var fire = function () {
        if (onChange) onChange(root.dataset.people, idsOf(root),
          (root.querySelector('.il-pp-free') || {}).value || '');
      };
      var add = root.querySelector('.il-pp-add');
      if (add) add.onchange = function () {
        if (!add.value) return;
        // ⚠️ Opening the new-person form is NOT a selection — the select is reset
        // and nothing is added, or the sentinel id would end up in champion_ids
        // and resolve to "Unknown person" forever.
        if (add.value === '__new__') {
          add.value = '';
          repaintPicker(root, onChange, true);
          return;
        }
        var ids = idsOf(root);
        if (ids.indexOf(add.value) < 0) ids.push(add.value);
        root.dataset.ids = ids.join(',');
        var fresh = repaintPicker(root, onChange);
        if (onChange) onChange(fresh.dataset.people, idsOf(fresh),
          (fresh.querySelector('.il-pp-free') || {}).value || '');
      };

      // ---- The new-person form -------------------------------------------
      var nadd = root.querySelector('.il-pp-nadd');
      if (nadd) nadd.onclick = async function () {
        var nm = (root.querySelector('.il-pp-nname') || {}).value || '';
        var co = (root.querySelector('.il-pp-nco') || {}).value || '';
        if (!nm.trim()) { UI.toast('Enter a name for the person.', 'warn'); return; }
        nadd.disabled = true;
        var made;
        try {
          made = await PDb.createContact(nm, co, '', UID);
        } catch (e) {
          nadd.disabled = false;
          // ⚠️ The form is left OPEN with the typed name intact. Closing it on a
          // failure would throw the name away and the planner would have to work
          // out what had happened from a toast that has already gone.
          UI.toast('Could not add the person: ' + ((e && e.message) || e) +
            ' — if this names a missing table, run migrations/2026-08-28-people-directory.sql', 'error');
          return;
        }
        var ids = idsOf(root);
        // ⚠️ createContact returns the EXISTING row when the person is already in
        // the directory, so guard against adding the same id twice.
        if (ids.indexOf(made.id) < 0) ids.push(made.id);
        root.dataset.ids = ids.join(',');
        var fresh = repaintPicker(root, onChange, false);
        if (onChange) onChange(fresh.dataset.people, idsOf(fresh),
          (fresh.querySelector('.il-pp-free') || {}).value || '');
        UI.toast(made.name + ' added — everyone can pick them now.', 'ok');
      };
      var ncan = root.querySelector('.il-pp-ncancel');
      if (ncan) ncan.onclick = function () { repaintPicker(root, onChange, false); };
      root.querySelectorAll('.il-pp-rm').forEach(function (b) {
        b.onclick = function () {
          root.dataset.ids = idsOf(root).filter(function (i) { return i !== b.dataset.rm; }).join(',');
          var fresh = repaintPicker(root, onChange);
          if (onChange) onChange(fresh.dataset.people, idsOf(fresh),
            (fresh.querySelector('.il-pp-free') || {}).value || '');
        };
      });
      var free = root.querySelector('.il-pp-free');
      if (free) free.onchange = fire;
    });
  }

  function clip(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n).trim() + '…' : s;
  }

  // ⚠️ ONE field renderer, in reporting mode a field renders as TEXT rather than a
  // control — a single-line <input> CLIPS its own value. Newlines survive as <br>
  // because the record is what was written. `extra` is appended INSIDE the block
  // because the reporting body itself contains a </div>.
  function ilField(report, label, cls, control, raw, extra) {
    var body = report
      ? '<div class="il-mi-val' + (raw ? '' : ' is-empty') + '">' +
          (raw ? Fmt.esc(raw).replace(/\n/g, '<br>') : '—') + '</div>'
      : control;
    return '<div class="il-mi-f ' + cls + '"><label>' + label + '</label>' +
      body + (extra || '') + '</div>';
  }

  function dateVal(d) {
    if (!d) return '';
    var m = String(d).match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : '';
  }

  // ⚠️ THE SELECT-VALUE TRAP, which this app has been bitten by twice (the drawing
  // register's drawing-type field silently WIPED a value on save; the schedule's
  // work-package picker read back ''). A <select> whose value is absent from its
  // options reports the FIRST option instead — so a legacy or hand-entered value
  // would be silently rewritten the next time anything saved the row.
  //
  // Options are therefore canonical ∪ values already in use on this project ∪ the
  // row's own current value, so whatever is on screen always round-trips.
  function momOptions(canon, present, cur, blank) {
    var seen = {}, out = [];
    canon.concat(present || []).concat(cur ? [cur] : []).forEach(function (v) {
      v = String(v == null ? '' : v).trim();
      if (!v || seen[v.toLowerCase()]) return;
      seen[v.toLowerCase()] = 1; out.push(v);
    });
    return '<option value="">' + (blank || '—') + '</option>' +
      out.map(function (v) {
        return '<option' + (cur === v ? ' selected' : '') + '>' + Fmt.esc(v) + '</option>';
      }).join('');
  }
  // What this project actually uses, so one planner's spelling is offered to the next.
  function momUsedCategories() {
    return MOM_ITEMS.map(function (x) { return x.category; }).filter(Boolean);
  }
  function momUsedMeetingTypes() {
    return MOMS.map(function (x) { return x.meeting_type; }).filter(Boolean);
  }

  // ------------------------------------------------ action-item filters -----
  function momFilterOn() {
    return !!(_momF.q || _momF.cat || _momF.type || _momF.status);
  }
  // ⚠️ For a linked action the REGISTER's status is what the row displays, so it is
  // what the status filter must test — otherwise filtering to Closed would hide a
  // row the screen is showing as Closed.
  function momItemStatus(it) {
    var iss = momIssueOf(it);
    return iss ? (iss.status || 'Open') : (it.status || 'Open');
  }
  function momVisibleItems(momId) {
    var all = momItemsOf(momId);
    if (!momFilterOn()) return all;
    var q = _momF.q.toLowerCase();
    return all.filter(function (it) {
      if (_momF.cat && (it.category || '') !== _momF.cat) return false;
      if (_momF.type && (it.type || '') !== _momF.type) return false;
      if (_momF.status && momItemStatus(it) !== _momF.status) return false;
      if (!q) return true;
      return [it.item_no, it.category, it.issue, it.description, it.action_item, it.owner]
        .join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function momStatusFilterOpts() { return STATUSES.slice(); }

  function momReset() {
    MOMS = []; MOM_ITEMS = []; ISSUES = []; LESSONS = [];
    _momSel = null; _momErr = ''; _momLoaded = false;
    _momQ = ''; _momF = { q: '', cat: '', type: '', status: '' };
    _momView = 'list'; _momBrowsePrev = 'list';
    _momPickerOpen = false; _momPickerQ = '';
    MOM_ACT_NAME = {};   // activity ids are project-scoped — this cache is too
  }

  // ⚠️ Loaded EAGERLY, unlike the shared module this screen was split out of —
  // there, minutes were a secondary screen most sessions never opened, so the
  // fetch waited until it did. Here the whole module IS Minutes of Meeting, so it
  // loads with the project the same way the Issues & Concerns register loads its
  // own table.
  async function load() {
    if (!pid) { MOMS = []; MOM_ITEMS = []; ISSUES = []; LESSONS = []; _momLoaded = true; render(); return; }
    // ⚠️ Keyset-paginated (PDb.selectAll): a plain .select() truncates at 1000 rows
    // server-side with no error, and both of these accumulate for the life of the
    // project — one row per meeting, and one per action item on every meeting.
    try {
      MOMS = await PDb.selectAll('meeting_minutes', function (q) { return q.eq('project_id', pid); });
      MOM_ITEMS = await PDb.selectAll('mom_items', function (q) { return q.eq('project_id', pid); });
      _momErr = '';
    } catch (e) {
      MOMS = []; MOM_ITEMS = [];
      _momErr = (e && e.message) || 'load failed';
      _momLoaded = true; render();
      return;
    }
    // selectAll returns id order — the display order is applied here.
    MOMS.sort(function (a, b) {                       // meeting_date desc, blanks last
      var x = a.meeting_date || '', y = b.meeting_date || '';
      if (!x !== !y) return x ? -1 : 1;
      if (x !== y) return y.localeCompare(x);
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
    MOM_ITEMS.sort(function (a, b) {
      return (a.seq || 0) - (b.seq || 0) ||
        String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
    // ⚠️ Light reads of the sibling module's tables (see the header comment) —
    // tolerant of either being unmigrated (no rows, not a failed load): the
    // status pill and the "Get from issue" panel just have nothing to offer yet.
    try { ISSUES = await PDb.selectAll('issues_lessons', function (q) { return q.eq('project_id', pid); }); }
    catch (e) { ISSUES = []; }
    try { LESSONS = await PDb.selectAll('lessons_learned', function (q) { return q.eq('project_id', pid); }); }
    catch (e) { LESSONS = []; }
    _momLoaded = true;
    render();
  }

  function momItemsOf(id) { return MOM_ITEMS.filter(function (x) { return x.mom_id === id; }); }
  // ⚠️ Reads the LIGHT register copy (ISSUES), not a full editable register — this
  // module never writes to issues_lessons, only reads it for display/linking.
  function momIssueOf(item) {
    return item.issue_id && ISSUES.find(function (x) { return x.id === item.issue_id; });
  }
  // ⚠️ PER MINUTE, not per module. These mirror
  // migrations/2026-08-20-department-minutes.sql line for line; where the UI and the RLS
  // disagree the user fills in a form and the save bounces with nothing to explain it.
  function canEditMinute(m) {
    if (isSteward) return true;
    return !!(canAdd && m && m.created_by && UID && m.created_by === UID);
  }
  function canDeleteMinute(m) {
    if (isSteward) return true;
    return canEditMinute(m) && !momItemsOf(m.id).some(function (i) {
      return i.issue_id && !i.carried_from_item_id;
    });
  }
  function momLocked(m) { return !!(m && m.is_distributed); }
  function minuteByLabel(m) {
    if (!m || !m.created_by) return 'Recorded before minutes noted who wrote them — a planner maintains it.';
    if (UID && m.created_by === UID) return 'Recorded by you.';
    return 'Recorded by someone else — they or a planner can change it.';
  }
  // Short form for the List view's "Recorded by" column — never a real name, the
  // same privacy posture as minuteByLabel (a department user has no business
  // being granted a read of `users` for a caption).
  function minuteRecordedByShort(m) {
    if (!m.created_by) return '—';
    if (UID && m.created_by === UID) return 'You';
    return 'Someone else';
  }
  function momToday() {
    // Local date, not toISOString().slice(0,10) — east of Greenwich that is yesterday.
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function lessonsOfMomItem(itemId) {
    return itemId ? LESSONS.filter(function (l) { return l.mom_item_id === itemId; }) : [];
  }

  // ============================================================================
  async function init(user, prof) {
    profile = prof;
    UID = (user && user.id) || (prof && prof.id) || null;
    _collabSelf = { id: UID, name: (prof && (prof.name || prof.email)) || 'Someone' };
    isSteward = ['super_admin', 'admin', 'planner'].indexOf(prof.role) >= 0;
    canAdd = !!prof && prof.status === 'approved' && prof.role !== 'viewer';

    // ⚠️ Tolerant, and NOT awaited-into-failure: a missing roster RPC (migration not
    // yet run) falls back to free text rather than refusing the whole module.
    try { PEOPLE = await PDb.getPeople(); } catch (e) { PEOPLE = []; }

    await loadProjects();
    wire();
    // Browser-history integration: List / Calendar / a single open meeting each get
    // a history entry, so the browser's own Back steps back through them instead of
    // jumping straight past every view to the module launcher.
    histView = UI.bindHistoryState({
      key: 'mom_view',
      get: function () { return { v: _momView, m: _momSel }; },
      apply: function (state) {
        _momView = state.v || 'list'; _momSel = state.m || null;
        if (_momView === 'detail' && !_momSel) _momView = _momBrowsePrev || 'list';
        render();
      }
    });
    if (pid) load();
    joinCollab();
  }

  async function loadProjects() {
    var projects = await PDb.getProjects();
    var sel = $('il-project');
    pid = sessionStorage.getItem('pd_project') || (projects[0] && projects[0].id) || null;
    var cur = projects.find(function (p) { return p.id === pid; });
    projName = cur ? (cur.name || cur.id) : '';
    sel.innerHTML = '<option value="">Select project…</option>' +
      projects.map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === pid ? ' selected' : '') + '>' +
          Fmt.esc(p.name) + '</option>';
      }).join('');
    UI.enhanceProjectSelect(sel);
    if (pid) sessionStorage.setItem('pd_project', pid);
  }

  function wire() {
    $('il-project').onchange = function () {
      pid = this.value;
      var opt = this.options[this.selectedIndex];
      projName = opt ? opt.textContent : '';
      if (pid) sessionStorage.setItem('pd_project', pid);
      // Minutes belong to a project — never carry them across a switch.
      momReset();
      load();
      joinCollab();
    };
    var rb = $('il-refresh');
    if (rb) rb.onclick = function () { momReset(); load(); };
  }

  // -------------------------------------------------------------- render ---
  function render() {
    if (!pid) { _paintEmpty('Select a project to see its minutes.'); return; }
    if (!_momLoaded) { _paintEmpty('Loading minutes…'); return; }
    if (_momView === 'detail' && _momSel) renderDetail();
    else renderBrowse();
    if (window.Icons && Icons.hydrate) Icons.hydrate($('il-mom-view'));
    paintRemote();
  }
  function _paintEmpty(msg) {
    var host = $('il-mom-view');
    if (host) host.innerHTML = '<div class="pd-card" style="padding:24px;color:var(--pd-muted);">' + Fmt.esc(msg) + '</div>';
  }

  function momSearchList() {
    var q = _momQ.trim().toLowerCase();
    if (!q) return MOMS;
    return MOMS.filter(function (x) {
      return [x.title, x.location, x.meeting_type, x.attendees, x.meeting_date]
        .join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }

  // ---------------------------------------------------------------- browse ---
  // List and Calendar are the two ways to browse EVERY meeting on this project —
  // the ask this module split out to satisfy. Selecting one (or creating a new
  // one) switches into Detail, the single-meeting editor.
  function renderBrowse() {
    var host = $('il-mom-view'); if (!host) return;
    host.classList.remove('il-mom-report');
    var list = momSearchList();
    host.innerHTML =
      '<div class="il-mom-browsebar">' +
        '<span class="il-filt-ico" data-ico="filter" data-ico-size="15"></span>' +
        '<input class="pd-input pd-input-sm il-mom-search" id="il-mom-q" placeholder="Search meetings…" value="' + Fmt.esc(_momQ) + '">' +
        '<div class="il-viewtoggle il-mom-vtoggle" id="il-mom-vtoggle">' +
          '<button type="button" data-mv="list" class="' + (_momView === 'list' ? 'on' : '') + '">List</button>' +
          '<button type="button" data-mv="calendar" class="' + (_momView === 'calendar' ? 'on' : '') + '">Calendar</button>' +
        '</div>' +
        (canAdd ? '<button class="pd-btn pd-btn-primary pd-btn-sm" id="il-mom-new">+ New minutes</button>' : '') +
      '</div>' +
      (_momErr
        ? '<div class="il-empty" style="padding:24px;">Could not load minutes: ' + Fmt.esc(_momErr) +
          '<br><small>If this says the relation does not exist, run <code>migrations/2026-08-19-duration-scenarios-and-mom.sql</code>.</small></div>'
        : (_momView === 'calendar' ? renderMomCalendarHTML(list) : renderMomListHTML(list)));
    wireBrowse();
  }

  // ---- List view --------------------------------------------------------
  function momSortedList(list) {
    var col = _momSort.col, dir = _momSort.dir === 'asc' ? 1 : -1;
    var arr = list.slice();
    arr.sort(function (a, b) {
      var av, bv;
      if (col === 'title') { av = (a.title || '').toLowerCase(); bv = (b.title || '').toLowerCase(); }
      else if (col === 'type') { av = (a.meeting_type || '').toLowerCase(); bv = (b.meeting_type || '').toLowerCase(); }
      else if (col === 'state') { av = a.is_distributed ? 1 : 0; bv = b.is_distributed ? 1 : 0; }
      else { av = a.meeting_date || ''; bv = b.meeting_date || ''; }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return arr;
  }
  function momListSortTh(label, col) {
    var on = _momSort.col === col;
    return '<th class="il-mom-th' + (on ? ' on' : '') + '" data-sort="' + col + '">' + Fmt.esc(label) +
      (on ? (_momSort.dir === 'asc' ? ' ▲' : ' ▼') : '') + '</th>';
  }
  function renderMomListHTML(list) {
    if (!list.length) {
      return '<div class="il-empty" style="padding:28px;">' +
        (MOMS.length ? 'No meeting matches “' + Fmt.esc(_momQ) + '”.' : 'No minutes recorded on this project yet.') +
      '</div>';
    }
    var sorted = momSortedList(list);
    return '<div class="pd-card" style="padding:0;overflow:auto;">' +
      '<table class="pd-table il-mom-listtable"><thead><tr>' +
        momListSortTh('Title', 'title') + momListSortTh('Type', 'type') +
        momListSortTh('Date', 'date') + momListSortTh('State', 'state') +
        '<th>Action items</th><th>Recorded by</th>' +
      '</tr></thead><tbody>' +
      sorted.map(function (x) {
        var items = momItemsOf(x.id);
        var open = items.filter(function (i) { return momItemStatus(i) !== 'Closed'; }).length;
        return '<tr class="il-mom-lrow" data-mom="' + Fmt.esc(x.id) + '">' +
          '<td>' + Fmt.esc(x.title || '(untitled)') + '</td>' +
          '<td>' + Fmt.esc(x.meeting_type || '—') + '</td>' +
          '<td>' + (x.meeting_date ? Fmt.date(x.meeting_date) : '—') + '</td>' +
          '<td>' + (x.is_distributed ? '<span class="il-pill is-open">Distributed</span>' : '<span class="il-mom-draft">Draft</span>') + '</td>' +
          '<td>' + items.length + (open ? ' (' + open + ' open)' : '') + '</td>' +
          '<td>' + Fmt.esc(minuteRecordedByShort(x)) + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  // ---- Calendar view ------------------------------------------------------
  // ⚠️ UTC throughout — the grid is built from Date.UTC() and every meeting is
  // matched against its plain YYYY-MM-DD text, never parsed into a local Date.
  // That local-vs-UTC off-by-one has bitten this app repeatedly (minusDays in
  // both registers, the drawing importer) and a calendar is exactly the screen
  // where it would silently move a meeting onto the wrong day.
  function momCalInit() {
    if (_momCalMonth) return;
    var d = new Date();
    _momCalMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function momCalShift(delta) {
    momCalInit();
    var parts = _momCalMonth.split('-'), y = +parts[0], m = +parts[1] - 1 + delta;
    var d = new Date(Date.UTC(y, m, 1));
    _momCalMonth = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  }
  function momMonthLabel(ym) {
    var parts = ym.split('-');
    var names = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
      'August', 'September', 'October', 'November', 'December'];
    return names[+parts[1] - 1] + ' ' + parts[0];
  }
  function renderMomCalendarHTML(list) {
    momCalInit();
    var parts = _momCalMonth.split('-'), y = +parts[0], m = +parts[1];
    var first = new Date(Date.UTC(y, m - 1, 1));
    var startDow = (first.getUTCDay() + 6) % 7;   // Monday-first, matching the rest of the suite
    var daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    var byDay = {};
    list.forEach(function (x) {
      if (!x.meeting_date || x.meeting_date.slice(0, 7) !== _momCalMonth) return;
      var key = x.meeting_date.slice(0, 10);
      (byDay[key] = byDay[key] || []).push(x);
    });
    var todayISO = momToday();
    var cells = '';
    for (var i = 0; i < startDow; i++) cells += '<div class="il-mom-calcell is-blank"></div>';
    for (var day = 1; day <= daysInMonth; day++) {
      var iso = _momCalMonth + '-' + String(day).padStart(2, '0');
      var here = byDay[iso] || [];
      cells += '<div class="il-mom-calcell' + (iso === todayISO ? ' is-today' : '') + '">' +
        '<div class="il-mom-caldate">' + day + '</div>' +
        here.slice(0, 4).map(function (x) {
          return '<button type="button" class="il-mom-calchip' + (x.is_distributed ? '' : ' is-draft') +
            '" data-mom="' + Fmt.esc(x.id) + '" title="' + Fmt.esc(x.title || '(untitled)') + '">' +
            Fmt.esc(clip(x.title || '(untitled)', 22)) + '</button>';
        }).join('') +
        (here.length > 4 ? '<div class="il-mom-calmore">+' + (here.length - 4) + ' more</div>' : '') +
      '</div>';
    }
    return '<div class="il-mom-cal">' +
      '<div class="il-mom-calnav">' +
        '<button type="button" class="pd-btn pd-btn-sm" id="il-mom-calprev" title="Previous month">‹</button>' +
        '<span class="il-mom-calmonth">' + Fmt.esc(momMonthLabel(_momCalMonth)) + '</span>' +
        '<button type="button" class="pd-btn pd-btn-sm" id="il-mom-calnext" title="Next month">›</button>' +
        '<button type="button" class="pd-btn pd-btn-sm" id="il-mom-caltoday">Today</button>' +
      '</div>' +
      '<div class="il-mom-calgrid il-mom-calhead">' +
        ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (d) { return '<div>' + d + '</div>'; }).join('') +
      '</div>' +
      '<div class="il-mom-calgrid">' + cells + '</div>' +
    '</div>';
  }

  function wireBrowse() {
    var host = $('il-mom-view'); if (!host) return;
    var q = host.querySelector('#il-mom-q');
    if (q) q.oninput = function () {
      _momQ = q.value; var at = q.selectionStart;
      renderBrowse();
      var again = $('il-mom-q');
      if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch (e) {} }
    };
    host.querySelectorAll('#il-mom-vtoggle [data-mv]').forEach(function (b) {
      b.onclick = function () { _momView = b.dataset.mv; render(); if (histView) histView.push(); };
    });
    var nb = host.querySelector('#il-mom-new');
    if (nb) nb.onclick = momCreateNew;
    host.querySelectorAll('.il-mom-th[data-sort]').forEach(function (th) {
      th.onclick = function () {
        var col = th.dataset.sort;
        if (_momSort.col === col) _momSort.dir = _momSort.dir === 'asc' ? 'desc' : 'asc';
        else { _momSort.col = col; _momSort.dir = (col === 'title' || col === 'type') ? 'asc' : 'desc'; }
        renderBrowse();
      };
    });
    host.querySelectorAll('.il-mom-lrow').forEach(function (tr) {
      tr.onclick = function () { momOpenMeeting(tr.dataset.mom); };
    });
    host.querySelectorAll('.il-mom-calchip').forEach(function (b) {
      b.onclick = function () { momOpenMeeting(b.dataset.mom); };
    });
    var prev = host.querySelector('#il-mom-calprev');
    if (prev) prev.onclick = function () { momCalShift(-1); renderBrowse(); };
    var next = host.querySelector('#il-mom-calnext');
    if (next) next.onclick = function () { momCalShift(1); renderBrowse(); };
    var today = host.querySelector('#il-mom-caltoday');
    if (today) today.onclick = function () { _momCalMonth = null; momCalInit(); renderBrowse(); };
  }

  function momOpenMeeting(id) {
    if (_momView !== 'detail') _momBrowsePrev = _momView;
    _momSel = id; _momView = 'detail';
    _momF = { q: '', cat: '', type: '', status: '' };
    _momPickerOpen = false; _momPickerQ = '';
    render();
    if (histView) histView.push();
  }

  async function momCreateNew() {
    try {
      var ins = await sb().from('meeting_minutes').insert({
        project_id: pid, title: 'Meeting ' + Fmt.date(momToday()),
        meeting_date: momToday(), created_by: UID }).select().single();
      if (ins.error) throw ins.error;
      MOMS.unshift(ins.data); _momErr = '';
      // ⚠️ The new minute's agenda is SEEDED with the register's still-open
      // issues, exactly as before the split — a problem raised three meetings
      // ago keeps appearing until somebody closes it rather than falling off
      // because nobody retyped it. `quiet` skips the header save (nothing typed
      // yet) and the redundant render (momOpenMeeting below does that).
      try { await momPullIssues(ins.data.id, { quiet: true }); } catch (e) {}
      momOpenMeeting(ins.data.id);
    } catch (e) {
      UI.toast(/relation|does not exist|schema cache/i.test(e.message || '')
        ? 'Run migrations/2026-08-19-duration-scenarios-and-mom.sql in Supabase first.' : e.message, 'error');
    }
  }

  // ---------------------------------------------------------------- detail ---
  function renderDetail() {
    var host = $('il-mom-view'); if (!host) return;
    var cur = MOMS.find(function (x) { return x.id === _momSel; });
    if (!cur) { _momView = _momBrowsePrev || 'list'; renderBrowse(); return; }
    host.classList.toggle('il-mom-report', _momReport);
    host.innerHTML =
      (isSteward ? '' : (canAdd
        ? '<p class="il-mom-note">You can record minutes and maintain the ones you recorded. ' +
          'A planner maintains the rest — everyone on the project can read them all.</p>'
        : '<p class="il-mom-note">You can read the minutes of this project.</p>')) +
      '<button type="button" class="pd-btn pd-btn-sm il-mom-back" id="il-mom-back">← Back to meetings</button>' +
      momDetailHTML(cur);
    wireDetail();
    var back = host.querySelector('#il-mom-back');
    if (back) back.onclick = function () {
      _momView = _momBrowsePrev || 'list'; _momSel = null; _momReport = false;
      render();
      if (histView) histView.push();
    };
  }

  function momDetailHTML(mom) {
    // ⚠️ THREE states, not two. `mayEdit` is the PERMISSION (whose minute is this);
    // `locked` is the WORKFLOW state (has it been issued). A distributed minute is
    // read-only even to the person who wrote it — they revert it to draft first, which
    // is a deliberate act rather than a silent edit to a sheet already circulated.
    var mayEdit = canEditMinute(mom), locked = momLocked(mom);
    var ro = !mayEdit || locked, d = ro ? ' disabled' : '';
    var items = momItemsOf(mom.id);
    // ⚠️ `vis` drives the TABLE; `items` still drives the count, the filter bar and
    // the empty state. Rendering the filtered set as if it were everything is how a
    // hidden row gets mistaken for a deleted one.
    var vis = momVisibleItems(mom.id);
    var act = mom.schedule_activity_id || '';
    var others = MOMS.filter(function (x) { return x.id !== mom.id && momCarryable(x).length; });
    return '<div class="il-mom-detail-card">' +
      (ro ? '' : '<input type="file" id="il-mom-fileinput" hidden ' +
        'accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx">') +
      '<div class="il-mom-toolbar">' +
        '<span class="il-mom-state' + (locked ? ' on' : '') + '">' +
          (locked ? 'Distributed' : 'Draft — only you and planners can see this') + '</span>' +
        '<div style="flex:1;"></div>' +
        // Export is a READ, so it is offered to everyone who can see the minute —
        // unlike every other control on this card, which is gated on canEditMinute().
        // A VIEW control, so — like PDF — it is offered to everyone who can see the
        // minute, not only to whoever may edit it.
        '<button class="pd-btn pd-btn-sm' + (_momReport ? ' is-active' : '') + '" id="il-mom-report" ' +
          'title="Present these minutes as a clean read-only record — hides the editing controls">' +
          (_momReport ? '\u2713 Reporting view' : 'Reporting view') + '</button>' +
        '<button class="pd-btn pd-btn-sm" id="il-mom-pdf" title="Download these minutes as a PDF">⬇ PDF</button>' +
        (mayEdit ? '<button class="pd-btn pd-btn-sm' + (locked ? '' : ' pd-btn-primary') + '" id="il-mom-dist">' +
          (locked ? '↩ Revert to draft' : '📤 Distribute') + '</button>' : '') +
      '</div>' +
      (locked && mayEdit
        ? '<p class="il-mom-note" style="margin-top:0;">These minutes have been issued, so the form is ' +
          'locked. Revert to draft to change them — everyone on the project can already read this version.</p>'
        : '') +
      '<div class="il-form-row">' +
        '<div class="pd-field" style="flex:2 1 260px;"><label>Title</label><input class="pd-input" id="il-mom-title" value="' + Fmt.esc(mom.title || '') + '"' + d + '></div>' +
        '<div class="pd-field" style="flex:1 1 140px;"><label>Date</label><input class="pd-input" type="date" id="il-mom-date" value="' + (dateVal(mom.meeting_date)) + '"' + d + '></div>' +
        '<div class="pd-field" style="flex:1 1 140px;"><label>Location</label><input class="pd-input" id="il-mom-loc" value="' + Fmt.esc(mom.location || '') + '"' + d + '></div>' +
        '<div class="pd-field" style="flex:1 1 170px;"><label>Meeting type</label>' +
          '<select class="pd-select" id="il-mom-type"' + d + '>' +
            momOptions(MOM_MEETING_TYPES, momUsedMeetingTypes(), mom.meeting_type || '', '— none —') +
          '</select></div>' +
      '</div>' +
      '<div class="pd-field"><label>Attendees</label><input class="pd-input" id="il-mom-att" value="' + Fmt.esc(mom.attendees || '') + '" placeholder="Names, comma separated"' + d + '></div>' +
      '<div class="pd-field il-mom-act"><label>Activity discussed ' +
        '<small style="font-weight:400;color:var(--pd-muted);">— optional; links these minutes to a schedule activity</small></label>' +
        '<input type="hidden" id="il-mom-act" value="' + Fmt.esc(act) + '">' +
        '<div id="il-mom-actsel">' + momActChipHTML(act, ro) + '</div>' +
        (ro ? '' :
          '<input class="pd-input pd-input-sm" id="il-mom-actq" placeholder="Search the schedule by Activity ID or name…" autocomplete="off">' +
          '<div class="il-mom-acres" id="il-mom-acres" hidden></div>') +
      '</div>' +
      (ro ? '<p class="il-raisedby il-mom-by">' + Fmt.esc(minuteByLabel(mom)) + '</p>' : '') +
      '<div class="pd-field"><label>Notes / discussion</label>' +
        '<textarea class="pd-textarea" id="il-mom-notes" rows="4"' + d + '>' + Fmt.esc(mom.notes || '') + '</textarea>' +
      '</div>' +

      '<div class="il-mom-actions"><h4>Action items</h4>' +
        '<p>An action item lives here. Use <b>Get from issue</b> to bring in something already ' +
        'logged in Issues &amp; Concerns — during a PPR, or any time — so it is tracked on this ' +
        'agenda without retyping it. New issues are raised directly in that register now, not ' +
        'from these minutes.</p>' +
        // ⚠️ Offered only when there is enough to filter. A filter bar over three
        // rows is noise, and a "Showing 0 of 3" that a stale filter caused is how a
        // planner concludes their minutes have lost data.
        (items.length > 4 ? momFilterBarHTML(items) : '') +
        (items.length && !vis.length
          ? '<div class="il-empty" style="padding:14px;">No action item on these minutes matches the filter.</div>'
          : '') +
        // ⚠️⚠️ THIS IS A CARD LIST, NOT A TABLE, AND IT MUST STAY ONE.
        // It was an 11-column table needing 1400px+, so on a real screen Owner, Due,
        // Status, File and the register link all sat off the right edge behind a
        // horizontal scrollbar — exactly the columns a reporter reads. An action item
        // has more fields than any screen has columns, so widening or re-tuning the
        // columns cannot fix that; the layout has to WRAP instead of scroll.
        //
        // The card deliberately mirrors mom-app's own layout — the same one
        // momDownloadPDF() already renders: a six-cell meta grid (No. / Category /
        // Type / Status / Responsible / Target date) above full-width text blocks.
        // Keeping the two identical means what you read on screen IS what the export
        // prints; a third bespoke layout would let the screen and the PDF drift.
        (vis.length ? '<div class="il-mi-cards">' +
          vis.map(function (it, i) { return momItemRowHTML(it, ro, d, mayEdit, locked, i); }).join('') +
          '</div>'
          : (items.length ? '' : '<div class="il-empty" style="padding:14px;">No action items on these minutes.</div>')) +
        (ro ? '' :
          '<div class="il-mom-addrow">' +
            '<button class="pd-btn pd-btn-sm" id="il-mom-additem">+ Add action item</button>' +
            // Carry-over is offered on ANY minute, not only a brand-new one — a recurring
            // meeting often has its agenda seeded after the fact. Only meetings that
            // actually still have something open are listed; an empty dropdown would
            // invite a click that does nothing.
            (others.length
              ? '<span class="il-mom-carry">' +
                  '<select class="pd-select pd-input-sm" id="il-mom-carryfrom">' +
                    '<option value="">Carry over still-open actions from…</option>' +
                    others.map(function (x) {
                      return '<option value="' + Fmt.esc(x.id) + '">' + Fmt.esc(x.title || '(untitled)') +
                        (x.meeting_date ? ' · ' + Fmt.esc(Fmt.date(x.meeting_date)) : '') +
                        ' · ' + momCarryable(x).length + ' open</option>';
                    }).join('') +
                  '</select>' +
                  '<button class="pd-btn pd-btn-sm" id="il-mom-carrygo">Carry over</button>' +
                '</span>'
              : '') +
            // ⚠️ The replacement for the removed "Raise as issue" button: this pulls
            // FROM the register rather than raising a new issue into it. Disabled
            // (with the reason) when nothing is left to bring in, rather than a live
            // button that would toast an empty result on every click.
            (function () {
              var n = momOpenIssuesFor(mom.id).length;
              return n
                ? '<button class="pd-btn pd-btn-sm' + (_momPickerOpen ? ' is-active' : '') + '" id="il-mom-getissue" ' +
                    'title="Bring an already-raised issue onto this agenda">Get from issue' +
                    (_momPickerOpen ? '' : ' (' + n + ')') + '</button>'
                : '<button class="pd-btn pd-btn-sm" disabled ' +
                    'title="No open issue in the register is off this agenda already">Get from issue</button>';
            })() +
          '</div>' +
          momGetPanelHTML(mom)) +
      '</div>' +

      (ro ? '' :
        '<div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
          (canDeleteMinute(mom)
            ? '<button class="pd-btn pd-btn-sm pd-btn-danger" id="il-mom-del">Delete minutes…</button>'
            // Says why rather than showing a button the database would refuse.
            : '<span class="il-raisedby" style="margin:0;">An action has been raised from these ' +
              'minutes, so only a planner can delete them.</span>') +
          '<div style="flex:1;"></div>' +
          '<button class="pd-btn pd-btn-primary pd-btn-sm" id="il-mom-save">Save minutes</button></div>') +
    '</div>';
  }

  // mom-app keeps these in a collapsible drawer; here they sit inline above the
  // table, matching the filter bars the rest of this app already uses.
  function momFilterBarHTML(items) {
    var on = momFilterOn();
    return '<div class="il-mom-filters">' +
      '<span class="il-filt-ico" data-ico="filter" data-ico-size="15"></span>' +
      '<input class="pd-input pd-input-sm" id="il-momf-q" placeholder="Search agenda, action, owner…" value="' + Fmt.esc(_momF.q) + '">' +
      '<select class="pd-select pd-input-sm" id="il-momf-cat">' +
        momOptions(MOM_CATEGORIES, momUsedCategories(), _momF.cat, 'All categories') + '</select>' +
      '<select class="pd-select pd-input-sm" id="il-momf-type">' +
        momOptions(MOM_TYPES, [], _momF.type, 'All types') + '</select>' +
      '<select class="pd-select pd-input-sm" id="il-momf-status">' +
        momOptions(momStatusFilterOpts(), [], _momF.status, 'All statuses') + '</select>' +
      (on ? '<button class="il-clear" id="il-momf-clear" title="Clear all filters">' +
            '<span data-ico="x" data-ico-size="14"></span>Clear</button>' : '') +
      '<span class="il-mom-count">' +
        (on ? 'Showing ' + momVisibleItems(_momSel).length + ' of ' + items.length
            : items.length + ' action' + (items.length === 1 ? '' : 's')) + '</span>' +
    '</div>';
  }

  // ⚠️ THE "GET FROM ISSUE" PANEL — what replaced the "Raise as issue" button. It
  // lists still-open issues in the register that are NOT yet on this agenda
  // (momOpenIssuesFor — the exact same set the bulk pull used), searchable, each
  // one a single click to bring in (momPullOneIssue). "+ Add all" stays for the
  // case that used to be the only option: bringing in everything at once.
  // ⚠️ Session-only state (_momPickerOpen / _momPickerQ), reset whenever the
  // selected minute changes — a panel left open on the wrong meeting, or a stale
  // search term, would be confusing rather than convenient.
  function momGetPanelHTML(mom) {
    if (!_momPickerOpen) return '';
    var avail = momOpenIssuesFor(mom.id);
    var q = _momPickerQ.trim().toLowerCase();
    var shown = q ? avail.filter(function (r) {
      return [r.description, r.department, r.champion, r.caused_by].join(' ').toLowerCase().indexOf(q) >= 0;
    }) : avail;
    return '<div class="il-mom-getpanel">' +
      '<div class="il-mom-getpanel-head">' +
        '<input class="pd-input pd-input-sm" id="il-mom-getq" placeholder="Search open issues…" value="' + Fmt.esc(_momPickerQ) + '">' +
        (avail.length > 1
          ? '<button class="pd-btn pd-btn-sm" id="il-mom-getall">+ Add all ' + avail.length + '</button>' : '') +
      '</div>' +
      (shown.length
        ? '<div class="il-mom-getlist">' + shown.map(function (r) {
            return '<button type="button" class="il-mom-geti" data-issue="' + Fmt.esc(r.id) + '">' +
              '<span class="il-mom-geti-txt">' + Fmt.esc(clip(r.description || '(no description)', 90)) + '</span>' +
              '<span class="il-mom-geti-meta">' + Fmt.esc(r.department || '—') +
                (r.champion ? ' · ' + Fmt.esc(r.champion) : '') + ' · ' + Fmt.esc(r.status || 'Open') + '</span>' +
            '</button>';
          }).join('') + '</div>'
        : '<div class="il-empty" style="padding:10px;">' +
            (avail.length ? 'No open issue matches “' + Fmt.esc(_momPickerQ) + '”.'
                          : 'Every open issue in the register is already on this agenda.') +
          '</div>') +
    '</div>';
  }

  // ⚠️ `ro` is "can this row's FIELDS be typed into" = permission AND not-locked.
  // Raising needs a DIFFERENT test, so `mayEdit` and `locked` are passed separately.
  // Collapsing them into `ro` created a deadlock — see the register cell below.
  // ⚠️ `i` is the position among the VISIBLE items and is used only for the fallback
  // number placeholder, exactly as the PDF does it — never as an identity.
  // ⚠️ In Reporting view a field renders as TEXT, not as a control. This is not
  // cosmetic: a single-line <input> CLIPS its own value (measured — a 659px value in a
  // 416px box), so a long Issue / Agenda was unreadable in exactly the mode meant for
  // reading it. Text wraps; an input cannot be made to. It also stops a printed-looking
  // record being built out of form widgets.
  // ⚠️ `raw` is the value to SHOW; it is escaped here, and newlines survive as <br>
  // because the record is what was said, not a flattened paragraph.
  // ⚠️ `extra` is appended INSIDE the block (the carried badge needs to sit under the
  // number in both modes). It is a separate argument rather than something the caller
  // splices onto the result, because the reporting body itself contains a </div> and a
  // string-surgery approach would close the wrong one.
  // Delegates to the shared renderer — the register and the library render their fields
  // the same way, so a change to reporting presentation lands on all three screens at once.
  function momFieldHTML(label, cls, control, raw, extra) {
    return ilField(_momReport, label, cls, control, raw, extra);
  }

  function momItemRowHTML(it, ro, d, mayEdit, locked, i) {
    var iss = momIssueOf(it);
    // ⚠️ Rows written before the 2026-08-21 migration hold their action text in
    // `description`, the same fallback the PDF applies.
    var actText = it.action_item || it.description || '';
    return '<div class="il-mi-card" data-item="' + Fmt.esc(it.id) + '">' +
      // ---- the six-cell meta grid, in mom-app's own order --------------------
      '<div class="il-mi-meta">' +
      momFieldHTML('No.', 'il-c-no',
        '<input class="pd-input pd-input-sm il-mi" data-f="item_no" value="' + Fmt.esc(it.item_no || '') +
        '" placeholder="' + ((it.seq == null ? (i || 0) : it.seq) + 1) + '"' + d + '>',
        it.item_no || String((it.seq == null ? (i || 0) : it.seq) + 1),
        // Says the action came in from an earlier meeting. ⚠️ Not a status: a carried
        // action is the SAME action, and its register link came with it — without the
        // tag it reads as something someone re-typed, and the two would be chased twice.
        (it.carried_from_item_id ? '<span class="il-mom-carried" title="Carried over from an earlier meeting">carried</span>' : '')) +
      momFieldHTML('Category', 'il-c-cat',
        '<select class="pd-select pd-input-sm il-mi" data-f="category"' + d + '>' +
        momOptions(MOM_CATEGORIES, momUsedCategories(), it.category || '') + '</select>',
        it.category) +
      momFieldHTML('Type', 'il-c-type',
        '<select class="pd-select pd-input-sm il-mi" data-f="type"' + d + '>' +
        // ⚠️ A blank option is offered because the column is nullable — without it an
        // untyped legacy row would silently read as the first option while the database
        // still holds null, the select-value trap the drawing register documents.
        '<option value="">—</option>' +
        MOM_TYPES.map(function (o) { return '<option' + (it.type === o ? ' selected' : '') + '>' + o + '</option>'; }).join('') +
      '</select>', it.type) +
      momFieldHTML('Status', 'il-c-status',
        '<select class="pd-select pd-input-sm il-mi" data-f="status"' + d + '>' +
        // ⚠️ No blank option: `status` carries a CHECK and the handler deliberately
        // does NOT null-convert it, so an empty pick would write '' and be refused.
        // `present` carries any off-list legacy value through so the select shows the
        // truth instead of silently reporting 'Open' — the select-value trap.
        // ⚠️ Deliberately NOT momOptions(): that helper always emits a blank first
        // option, and picking it here would write '' into a CHECK-constrained column and
        // be refused by the database. The list is closed, so an off-list LEGACY value is
        // appended instead of being swallowed — otherwise the select silently reports
        // 'Open' while the row holds something else (the select-value trap).
        STATUSES.concat(it.status && STATUSES.indexOf(it.status) < 0 ? [it.status] : [])
          .map(function (o) {
            return '<option' + (it.status === o ? ' selected' : '') + '>' + Fmt.esc(o) + '</option>';
          }).join('') +
      '</select>',
        // ⚠️ Once raised, the REGISTER owns the status — the same rule the PDF follows.
        // Showing `mom_items.status` on a raised action would put a stale word in the
        // record beside a register pill saying something else.
        iss ? (iss.status || 'Open') : (it.status || 'Open')) +
      // Same roster as the register's Champion, so an action raised into an issue
      // carries a responsible the personal view can actually resolve.
      momFieldHTML('Responsible', 'il-c-owner',
        peoplePickerHTML('mom-own-' + it.id, it.owner_ids, it.owner, ro),
        championText(it.owner_ids, it.owner)) +
      momFieldHTML('Target date', 'il-c-due',
        '<input class="pd-input pd-input-sm il-mi" data-f="due_date" type="date" value="' + dateVal(it.due_date) + '"' + d + '>',
        it.due_date ? Fmt.date(it.due_date) : '') +
      '</div>' +
      // ---- the text blocks, full width so nothing is clipped ----------------
      momFieldHTML('Issue / Agenda', 'il-c-issue',
        '<input class="pd-input pd-input-sm il-mi" data-f="issue" value="' + Fmt.esc(it.issue || '') + '" placeholder="What was raised" ' + d + '>',
        it.issue) +
      // ⚠️ Description comes BEFORE the action item, and both are textareas. The
      // order follows how the item is actually written up: what was discussed, then
      // what will be done about it. The action item was a single-line <input>, which
      // clips its own value — an action of any length was unreadable in exactly the
      // mode that exists for reading it, the same defect the reporting view fixed for
      // Issue / Agenda.
      // ⚠️ Description was NOT on the old table at all, so it was a column the screen
      // could never show while the PDF printed it. In reporting/read-only it appears
      // only when it has something to say; an empty labelled block on every action is
      // noise in a printed record. Blank when the action text CAME from `description`
      // (a legacy row), or the card prints the same sentence twice under two headings
      // — the rule the PDF already applies.
      ((ro && (!it.description || it.description === actText))
        ? ''
        : momFieldHTML('Description <span>optional</span>', 'il-c-desc',
            '<textarea class="pd-textarea il-mi" data-f="description" rows="2" placeholder="What was discussed"' + d + '>' +
            Fmt.esc(it.description === actText ? '' : (it.description || '')) + '</textarea>',
            it.description === actText ? '' : it.description)) +
      momFieldHTML('Action item', 'il-c-act',
        '<textarea class="pd-textarea il-mi" data-f="action_item" rows="2" placeholder="What will be done"' + d + '>' +
        Fmt.esc(actText) + '</textarea>',
        actText) +
      // ---- the footer: the two things the PDF has no equivalent for ----------
      '<div class="il-mi-foot">' +
      '<div class="il-mi-f il-c-file"><label>File</label>' + momAttachCellHTML(it, ro) + '</div>' +
      // ⚠️ NO "Raise" here any more — a freeform action item is just a freeform
      // action item now. The only way a row carries `issue_id` is that it was
      // brought in with Get from issue (or, on an older minute, was raised before
      // this change). Either way the pill reads the REGISTER's live status (from
      // `ISSUES`, this module's own light read) so the two can never disagree.
      '<div class="il-mi-f il-c-reg"><label>From the register</label>' + (it.issue_id
        ? (iss
            ? '<span class="il-pill ' + statusClass(iss.status) + '" title="' + Fmt.esc(iss.description || '') + '">Linked · ' + Fmt.esc(iss.status || 'Open') + '</span>'
            : '<span style="font-size:12px;color:var(--pd-muted);" title="Linked to an issue in Issues & Concerns">Linked</span>')
        : '<span class="il-noedit" title="Not brought in from an issue">—</span>') + '</div>' +
      // ⚠️ Capturing a lesson is NOT an edit of the minute — it writes a row in the
      // library — so it is offered to anyone who may add records, on a distributed minute
      // or a draft alike, and it stays available when the minute is locked. Same reasoning
      // as the register cell above, without the distribution gate: a lesson carries no
      // provenance a reader must be able to open.
      '<div class="il-mi-f il-c-lesson"><label>Lesson</label>' + (function () {
        var ls = lessonsOfMomItem(it.id);
        if (ls.length) {
          return '<button class="pd-btn pd-btn-sm il-mi-lesson-open" data-lesson="' + Fmt.esc(ls[0].id) + '" ' +
            'title="' + Fmt.esc(clip(ls[0].lesson, 140)) + '">' +
            (ls.length > 1 ? ls.length + ' lessons' : 'Lesson captured') + '</button>';
        }
        return canAdd && !_momReport
          ? '<button class="pd-btn pd-btn-sm il-mi-lesson">+ Capture lesson</button>'
          : '<span class="il-noedit" title="No lesson captured from this action">—</span>';
      })() + '</div>' +
      (ro ? '' : '<div class="il-mi-f il-c-del"><button class="pd-btn pd-btn-sm pd-btn-danger il-mi-del" title="Remove this action">Remove</button></div>') +
      '</div>' +
    '</div>';
  }

  function momActChipHTML(id, ro) {
    if (!id) return '<span style="font-size:12px;color:var(--pd-muted);">Not linked to an activity.</span>';
    var nm = MOM_ACT_NAME[id];
    return '<span class="il-mom-chip"><code>' + Fmt.esc(id) + '</code>' +
      '<span id="il-mom-actname">' + (nm ? Fmt.esc(nm) : '') + '</span>' +
      (ro ? '' : '<button type="button" id="il-mom-actclear" title="Unlink">✕</button>') + '</span>';
  }
  // ---------------------------------------------------------- carry-over -----
  // "What is still open on that meeting?" — the set carry-over would bring forward.
  // ⚠️ For a RAISED action the REGISTER's status decides, not `mom_items.status`, which
  // is the same rule the screen and the PDF already follow. An action raised months ago
  // and since closed in the register must not be dragged into next week's agenda
  // because nobody went back to tick the box on the old minute.
  function momCarryable(mom) {
    return momItemsOf(mom.id).filter(function (it) {
      var iss = momIssueOf(it);
      return (iss ? (iss.status || 'Open') : (it.status || 'Open')) !== 'Closed';
    });
  }

  // ==========================================================================
  // OPEN ISSUES ONTO THE NEXT AGENDA
  //
  // The other direction of the minutes<->register link. Raising sends an action
  // INTO the register; this brings a still-open issue BACK onto the next meeting's
  // agenda, so a problem raised three meetings ago stops falling off the sheet
  // simply because nobody retyped it.
  //
  // ⚠️ It is carry-over's sibling and shares its rules on purpose — one issue, N
  // meetings. It COPIES the register link (`issue_id`) rather than raising a second
  // issue, which also means the resulting row shows the register's LIVE status and
  // carries no "Raise" button, so it cannot be double-raised by hand.
  //
  // ⚠️ `issues_lessons.mom_id` is NOT touched. Provenance names the meeting an issue
  // was FIRST raised from; moving it would make canDeleteMinute() treat every meeting
  // that merely discussed the issue as the one that owns it.
  // ==========================================================================

  // Still-open issues in THIS project's register that are not already on this minute.
  // ⚠️ Openness is decided by the REGISTER, the same rule the screen, the PDF and
  // carry-over already follow. An issue closed last week must not be dragged onto
  // next week's agenda because nobody went back to tick a box on an old minute.
  function momOpenIssuesFor(momId) {
    var on = {};
    momItemsOf(momId).forEach(function (it) { if (it.issue_id) on[it.issue_id] = 1; });
    return ISSUES.filter(function (r) {
      return (r.status || 'Open') !== 'Closed' && !on[r.id];
    });
  }

  async function momPullIssues(momId, opts) {
    opts = opts || {};
    var target = MOMS.find(function (x) { return x.id === (momId || _momSel); });
    if (!target || !canEditMinute(target) || momLocked(target)) return 0;
    var take = momOpenIssuesFor(target.id);
    if (!take.length) {
      // ⚠️ Silent when this ran by itself on a new minute — a toast saying nothing
      // happened, for something nobody asked for, is noise. Loud when the planner
      // pressed the button, because then "nothing happened" is the answer.
      if (!opts.quiet) UI.toast('Every open issue is already on this agenda.', 'info');
      return 0;
    }
    if (!opts.quiet) await momSaveHeader();

    var seq = momItemsOf(target.id).length;
  // Shared by momPullIssues (bulk) and momPullOneIssue (a single pick from the
  // "Get from issue" panel) — one payload shape, so the two routes can never
  // disagree about what a pulled action looks like.
  function momIssuePayload(r, momId, seq) {
    return {
      mom_id: momId, project_id: pid, seq: seq,
      // ⚠️ Type is 'Issue', because it is one. FYI would file a live problem under
      // the heading the PDF prints for information-only items.
      type: 'Issue',
      category: null,
      issue: r.description || null,
      // The register's corrective action is what is currently being done about it —
      // the right thing to read out, and the right thing to update in the meeting.
      action_item: r.corrective_action || null,
      description: r.caused_by || '',
      // ⚠️ Responsible comes across as BOTH the ids and the text, so an item pulled
      // onto an agenda still resolves on the champion's My Work page. Copying only
      // the text would silently drop the assignment.
      owner_ids: r.champion_ids || [],
      owner: r.champion || null,
      due_date: null,
      // ⚠️ Its own status is seeded from the register, but the row DISPLAYS the
      // register's live value from then on (momItemRowHTML reads the linked issue),
      // so this copy can never be what anyone reads as authoritative.
      status: (r.status || 'Open'),
      issue_id: r.id
    };
  }

    var payload = take.map(function (r, i) {
      return momIssuePayload(r, target.id, seq + i);
    });

    try {
      var ins = await sb().from('mom_items').insert(payload).select();
      if (ins.error) throw ins.error;
      (ins.data || []).forEach(function (x) { MOM_ITEMS.push(x); });
      UI.toast('Added ' + take.length + ' open issue' + (take.length === 1 ? '' : 's') +
        ' from the register to this agenda.', 'ok');
      if (!opts.quiet) renderDetail();
      return take.length;
    } catch (e) {
      // ⚠️ Tolerant of the un-run assignment migration: owner_ids is dropped and the
      // pull is retried, so the agenda still gets its issues and the planner is told
      // which field did not travel rather than losing the whole action.
      if (/owner_ids/.test(e.message || '')) {
        payload.forEach(function (x) { delete x.owner_ids; });
        try {
          var ins2 = await sb().from('mom_items').insert(payload).select();
          if (ins2.error) throw ins2.error;
          (ins2.data || []).forEach(function (x) { MOM_ITEMS.push(x); });
          UI.toast('Added ' + take.length + ' open issue' + (take.length === 1 ? '' : 's') +
            ' — the responsible person was not stored. Run migrations/2026-08-26-people-and-assignment.sql', 'warn');
          if (!opts.quiet) renderDetail();
          return take.length;
        } catch (e2) { e = e2; }
      }
      UI.toast('Could not add the open issues: ' + (e.message || e), 'error');
      return 0;
    }
  }

  // ⚠️ THE "GET FROM ISSUE" ASK: pull ONE already-raised issue — during a PPR, or
  // anywhere else in Issues & Concerns — onto this agenda without retyping it,
  // rather than raising a brand-new one from the minutes (that button is gone; new
  // issues are logged directly in Issues & Concerns now). Same shape as the bulk
  // pull above (momIssuePayload), for exactly one chosen issue.
  async function momPullOneIssue(momId, issueId) {
    var target = MOMS.find(function (x) { return x.id === (momId || _momSel); });
    if (!target || !canEditMinute(target) || momLocked(target)) return false;
    var r = ISSUES.find(function (x) { return x.id === issueId; });
    if (!r) { UI.toast('That issue could not be found — try refreshing.', 'error'); return false; }
    // ⚠️ Idempotent, same rule as the bulk pull: an issue already linked on this
    // agenda is skipped rather than added a second time.
    if (momItemsOf(target.id).some(function (it) { return it.issue_id === issueId; })) {
      UI.toast('That issue is already on this agenda.', 'info');
      return false;
    }
    var seq = momItemsOf(target.id).length;
    var payload = momIssuePayload(r, target.id, seq);
    try {
      var ins = await sb().from('mom_items').insert(payload).select();
      if (ins.error) throw ins.error;
      (ins.data || []).forEach(function (x) { MOM_ITEMS.push(x); });
      UI.toast('Added from the register.', 'ok');
      return true;
    } catch (e) {
      // ⚠️ Same tolerant retry as the bulk pull — the un-run assignment migration
      // must not lose the whole item, only the responsible-person link.
      if (/owner_ids/.test(e.message || '')) {
        delete payload.owner_ids;
        try {
          var ins2 = await sb().from('mom_items').insert(payload).select();
          if (ins2.error) throw ins2.error;
          (ins2.data || []).forEach(function (x) { MOM_ITEMS.push(x); });
          UI.toast('Added — the responsible person was not stored. Run migrations/2026-08-26-people-and-assignment.sql', 'warn');
          return true;
        } catch (e2) { UI.toast(e2.message, 'error'); return false; }
      }
      UI.toast('Could not add: ' + (e.message || e), 'error');
      return false;
    }
  }

  // ⚠️ CARRY-OVER COPIES THE REGISTER LINK RATHER THAN RE-RAISING. A carried action is
  // the SAME issue, discussed again — so `issue_id` comes across and the new minute
  // shows the register's live status. Re-raising would put a second competing issue in
  // the register for one problem, and copying the link also means the carried row has
  // no "Raise" button, so it cannot be double-raised by hand either.
  //
  // ⚠️ `issues_lessons.mom_id` is NOT moved: provenance names the meeting an issue was
  // FIRST raised from. That is what lets canDeleteMinute() ignore carried links.
  async function momCarryOver(fromId) {
    var target = MOMS.find(function (x) { return x.id === _momSel; });
    var src = MOMS.find(function (x) { return x.id === fromId; });
    if (!target || !src || !canEditMinute(target) || momLocked(target)) return;
    // The header is saved first: this re-renders, and a title typed a moment ago would
    // otherwise be thrown away by that repaint. Same reason as "+ Add action item".
    await momSaveHeader();

    // ⚠️ Idempotent by construction. Carrying twice from the same meeting must not
    // duplicate the agenda, so anything already carried from one of these source items
    // is skipped — and the button reports that rather than silently doing nothing.
    var already = {};
    momItemsOf(target.id).forEach(function (it) {
      if (it.carried_from_item_id) already[it.carried_from_item_id] = 1;
    });
    var take = momCarryable(src).filter(function (it) { return !already[it.id]; });
    if (!take.length) {
      UI.toast(momCarryable(src).length
        ? 'Every still-open action from those minutes has already been carried over.'
        : 'Nothing is still open on those minutes.', 'info');
      return;
    }
    var seq = momItemsOf(target.id).length;
    var payload = take.map(function (it, i) {
      return {
        mom_id: target.id, project_id: pid, seq: seq + i,
        item_no: it.item_no || null, category: it.category || null, type: it.type || null,
        issue: it.issue || null, description: it.description || '', action_item: it.action_item || null,
        owner: it.owner || null, due_date: it.due_date || null,
        // ⚠️ The status carried is the minute's own, not the register's. Where the two
        // differ the register is authoritative and the row displays ITS status anyway
        // (momItemRowHTML reads the linked issue), so copying the register's value here
        // would freeze a snapshot that goes stale the moment the issue moves.
        status: it.status || 'Open',
        issue_id: it.issue_id || null,
        carried_from_item_id: it.id
      };
    });
    try {
      var ins = await sb().from('mom_items').insert(payload).select();
      if (ins.error) throw ins.error;
      (ins.data || []).forEach(function (r) { MOM_ITEMS.push(r); });
      // Records where the agenda came from, once — a minute can be topped up from several
      // meetings, and only the first seeding is what "carried from" means.
      if (!target.carried_from_mom_id) {
        var u = await sb().from('meeting_minutes').update({ carried_from_mom_id: src.id }).eq('id', target.id);
        if (!u.error) target.carried_from_mom_id = src.id;
      }
      var linked = take.filter(function (it) { return it.issue_id; }).length;
      UI.toast('Carried over ' + take.length + ' action' + (take.length === 1 ? '' : 's') +
        (linked ? ' — ' + linked + ' still linked to the register' : ''), 'ok');
      renderDetail();
    } catch (e) {
      UI.toast(/column|schema cache/i.test(e.message || '')
        ? 'Run migrations/2026-08-21-mom-schema-carryover-distribute.sql in Supabase first.'
        : e.message, 'error');
    }
  }

  // ------------------------------------------------------------- distribute ---
  // ⚠️ Distribution is the point the minutes become everyone's. Reverting does NOT
  // retract anything already raised into the register — those are their own rows and
  // someone may already be working them — so the confirmation says so rather than
  // letting a planner assume "revert" undoes the meeting's consequences.
  async function momSetDistributed(momId, on) {
    var mom = MOMS.find(function (x) { return x.id === momId; });
    if (!mom || !canEditMinute(mom)) return;
    if (on) {
      if (!confirm('Distribute "' + (mom.title || 'these minutes') +
        '"?\n\nEveryone on the project will be able to read them, and the form locks ' +
        'until you revert it to draft.')) return;
    } else {
      var raised = momItemsOf(momId).filter(function (i) { return i.issue_id; }).length;
      if (!confirm('Revert "' + (mom.title || 'these minutes') + '" to draft?' +
        '\n\nOnly you and planners will see them again.' +
        (raised ? '\n\n' + raised + ' issue(s) already raised in Issues & Concerns STAY there — ' +
          'reverting does not retract them.' : ''))) return;
    }
    var patch = { is_distributed: on, distributed_at: on ? new Date().toISOString() : null,
                  distributed_by: on ? UID : null };
    try {
      var u = await sb().from('meeting_minutes').update(patch).eq('id', momId);
      if (u.error) throw u.error;
      Object.assign(mom, patch);
      UI.toast(on ? 'Minutes distributed' : 'Reverted to draft', 'ok');
      renderDetail();
    } catch (e) {
      UI.toast(/column|schema cache/i.test(e.message || '')
        ? 'Run migrations/2026-08-21-mom-schema-carryover-distribute.sql in Supabase first.'
        : e.message, 'error');
    }
  }

  // ------------------------------------------------------- activity search ----
  // Server-side, capped, and it says when it capped. A schedule can hold 40k
  // activities; this screen must not load them to offer a picker.
  async function momActSearch(q) {
    // ⚠️ PostgREST's or() is comma/parenthesis delimited, so those characters in the
    // query would corrupt the filter rather than search for themselves.
    q = String(q || '').replace(/[,()%*\\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (q.length < 2 || !pid) return null;
    var like = '%' + q + '%';
    var res = await sb().from('project_schedule')
      .select('activity_id,activity_name,activity_type')
      .eq('project_id', pid)
      .not('activity_id', 'is', null)
      .or('activity_id.ilike.' + like + ',activity_name.ilike.' + like)
      .limit(26);
    if (res.error) throw res.error;
    // A WBS summary is not an activity anyone holds a meeting about; the schedule
    // module's own picker excluded them too.
    return (res.data || []).filter(function (r) { return r.activity_type !== 'WBS Summary'; });
  }

  async function momResolveActName(id) {
    if (!id || MOM_ACT_NAME[id] !== undefined) return;
    try {
      var res = await sb().from('project_schedule').select('activity_name')
        .eq('project_id', pid).eq('activity_id', id).limit(1);
      MOM_ACT_NAME[id] = (res && !res.error && res.data && res.data[0] && res.data[0].activity_name) || '';
    } catch (e) { MOM_ACT_NAME[id] = ''; }
    // ⚠️ Patch the chip in place instead of re-rendering: a re-render here would throw
    // away whatever the planner has typed into the form while this was in flight.
    var el = $('il-mom-actname');
    if (el && $('il-mom-act') && $('il-mom-act').value === id) el.textContent = MOM_ACT_NAME[id] ? '· ' + MOM_ACT_NAME[id] : '';
  }

  // -------------------------------------------------------------- persist -----
  async function momSaveHeader() {
    var mom = MOMS.find(function (x) { return x.id === _momSel; });
    if (!mom || !canEditMinute(mom)) return false;
    var g = function (id) { var e = $(id); return e ? e.value : ''; };
    var payload = {
      title: g('il-mom-title').trim() || '(untitled)',
      meeting_date: g('il-mom-date') || null,
      location: g('il-mom-loc').trim() || null,
      meeting_type: g('il-mom-type').trim() || null,
      attendees: g('il-mom-att').trim() || null,
      notes: g('il-mom-notes').trim() || null,
      schedule_activity_id: g('il-mom-act').trim() || null,
    };
    try {
      var u = await sb().from('meeting_minutes').update(payload).eq('id', mom.id);
      if (u.error) throw u.error;
      Object.assign(mom, payload);
      return true;
    } catch (e) { UI.toast(e.message, 'error'); return false; }
  }

  // Action-item edits save on change, one field at a time — a planner typing into a
  // table expects it to stick, and a single Save that silently covers the header AND
  // every row is how a half-typed action gets written.
  async function momSaveItem(id, patch) {
    // ⚠️ The action item has no owner of its own — it belongs to its minute, so the
    // question is whether that MINUTE is mine. Same derivation as the policy.
    var it0 = MOM_ITEMS.find(function (x) { return x.id === id; });
    if (!it0 || !canEditMinute(MOMS.find(function (m) { return m.id === it0.mom_id; }))) return false;
    try {
      var u = await sb().from('mom_items').update(patch).eq('id', id);
      if (u.error) throw u.error;
      var it = MOM_ITEMS.find(function (x) { return x.id === id; });
      if (it) Object.assign(it, patch);
      return true;
    } catch (e) { UI.toast(e.message, 'error'); return false; }
  }

  // ------------------------------------------------------------ attachments ---
  // ⚠️ PRIVATE BUCKET. `attachment_url` stores the object PATH and the URL is signed
  // on demand, never stored — a stored signed URL is one that has already expired.
  // mom-app uses a PUBLIC bucket and stores the public URL, so anyone holding the
  // link reads the file with no login; that is deliberately not copied. Same
  // construction as the drawing register's `file_url`.
  var MOM_BUCKET = 'mom-attachments';

  function momAttachCellHTML(it, ro) {
    if (it.attachment_url) {
      return '<span class="il-mom-file">' +
        '<button class="pd-btn pd-btn-sm il-mi-fview" title="' + Fmt.esc(it.attachment_name || 'Open the attachment') + '">' +
          '<span data-ico="eye" data-ico-size="14"></span></button>' +
        (ro ? '' : '<button class="pd-btn pd-btn-sm pd-btn-danger il-mi-fdel" title="Remove the attachment">' +
          '<span data-ico="x" data-ico-size="13"></span></button>') +
      '</span>';
    }
    return ro ? '<span class="il-noedit">—</span>'
      : '<button class="pd-btn pd-btn-sm il-mi-fadd" title="Attach a photo or document">+ File</button>';
  }

  // ⚠️ ORDERING IS THE WHOLE GAME HERE, and each rule exists because the opposite
  // order leaves a real mess behind. The same four rules the material-submittal and
  // drawing-register attachment work settled on:
  //   1. UPLOAD FIRST, then write the row — a failed upload must never leave a row
  //      pointing at an object that does not exist.
  //   2. If the row write then fails, DELETE WHAT WAS JUST UPLOADED — otherwise the
  //      object is orphaned in the bucket with nothing referencing it.
  //   3. On replace, delete the OLD object only AFTER the row points at the new one.
  //   4. On remove, null the row FIRST, then delete the object — a failed delete
  //      leaves an orphan (recoverable), where the reverse leaves a row pointing at
  //      nothing (renders as an attachment that will not open).
  async function momAttachUpload(itemId, file) {
    var it = MOM_ITEMS.find(function (x) { return x.id === itemId; });
    if (!it || !file) return;
    var mom = MOMS.find(function (m) { return m.id === it.mom_id; });
    if (!canEditMinute(mom) || momLocked(mom)) return;
    // 25 MB: a site photo or a tabled PDF, not a drawing set. Refused before the
    // upload rather than after, so nobody waits for a transfer that will be rejected.
    if (file.size > 25 * 1024 * 1024) {
      UI.toast('That file is ' + Math.round(file.size / 1048576) + ' MB — attachments are capped at 25 MB.', 'warn');
      return;
    }
    var old = it.attachment_url || null;
    // Path is scoped by project and item so two meetings cannot collide, and the
    // timestamp keeps a re-upload from overwriting the object a row still points at.
    var safe = String(file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    var path = pid + '/' + it.mom_id + '/' + itemId + '-' + Date.now() + '-' + safe;
    UI.toast('Uploading ' + safe + '…', 'info');
    try {
      var up = await sb().storage.from(MOM_BUCKET).upload(path, file, { upsert: false });
      if (up.error) throw up.error;
      var okRow = await momSaveItem(itemId, { attachment_url: path, attachment_name: file.name || safe });
      if (!okRow) {
        // Rule 2 — roll the object back rather than orphan it.
        try { await sb().storage.from(MOM_BUCKET).remove([path]); } catch (e) {}
        return;
      }
      // Rule 3 — the row already points at the new object, so the old one is safe
      // to drop. A failure here is an orphan, not data loss, so it does not throw.
      if (old) { try { await sb().storage.from(MOM_BUCKET).remove([old]); } catch (e) {} }
      UI.toast('Attached', 'ok');
      renderDetail();
    } catch (e) {
      UI.toast(/bucket|not found/i.test(e.message || '')
        ? 'Run migrations/2026-08-21-mom-type-and-attachments.sql in Supabase first.'
        : 'Upload failed: ' + ((e && e.message) || e), 'error');
    }
  }

  async function momAttachRemove(itemId) {
    var it = MOM_ITEMS.find(function (x) { return x.id === itemId; });
    if (!it || !it.attachment_url) return;
    var mom = MOMS.find(function (m) { return m.id === it.mom_id; });
    if (!canEditMinute(mom) || momLocked(mom)) return;
    if (!confirm('Remove "' + (it.attachment_name || 'this file') + '" from this action?\n\nThe file is deleted.')) return;
    var path = it.attachment_url;
    // Rule 4 — the row stops pointing at it first.
    if (!await momSaveItem(itemId, { attachment_url: null, attachment_name: null })) return;
    try { await sb().storage.from(MOM_BUCKET).remove([path]); } catch (e) {}
    UI.toast('Attachment removed', 'ok');
    renderDetail();
  }

  // ⚠️ Signed on demand and opened immediately. 60s is plenty to hand the URL to the
  // browser and is the same window the other registers use — the link is not meant to
  // be copied out and shared, which is the point of the bucket being private.
  async function momAttachOpen(itemId) {
    var it = MOM_ITEMS.find(function (x) { return x.id === itemId; });
    if (!it || !it.attachment_url) return;
    try {
      var r = await sb().storage.from(MOM_BUCKET).createSignedUrl(it.attachment_url, 60);
      if (r.error) throw r.error;
      window.open(r.data.signedUrl, '_blank', 'noopener');
    } catch (e) {
      UI.toast('Could not open the attachment: ' + ((e && e.message) || e), 'error');
    }
  }

  // Every attachment under a set of action items — used before a delete, while the
  // rows are still in memory to read the paths from.
  function momPathsOf(items) {
    return items.map(function (x) { return x.attachment_url; }).filter(Boolean);
  }

  // ------------------------------------------------------------------- pdf ----
  // ⚠️ The layout below is the standalone mom-app's `downloadPDF()` reproduced field
  // for field — same red header band, same six-column meta grid, same grey field
  // blocks, same badge palette, same html2pdf/jsPDF settings — so a minute exported
  // from here and one exported from that app are the SAME sheet. Do not "tidy" the
  // inline styles into module.css: html2canvas rasterises this DOM, and the module's
  // own stylesheet deliberately does not reach it (a themed export would come out dark).
  var MOM_PDF_BADGE = {
    'open': 'background:#d4f5d4;color:#1a8f3a;',
    'closed': 'background:#e5e5ea;color:#666;',
    'on hold': 'background:#fff3cd;color:#b06800;',
    // ⚠️ RETAINED although no row can hold 'In Progress' since the 2026-08-22
    // migration. An export runs against MOM_ITEMS in memory, so a tab opened before the
    // migration can still print a stale value — and dropping the key would render it in
    // the default grey, the same grey as Closed. One line, and it fails safe.
    'in progress': 'background:#fff3cd;color:#b06800;',
    'issue': 'background:#fde8e8;color:#b40000;',
    'fyi': 'background:#e8f0fe;color:#1a56db;',
    'report': 'background:#f3e8ff;color:#6b21a8;'
  };
  function momPdfBadge(val) {
    var s = MOM_PDF_BADGE[String(val || '').toLowerCase()] || 'background:#eee;color:#333;';
    return '<span style="' + s + ';font-size:9px;font-weight:700;padding:2px 8px;border-radius:20px;' +
      'display:inline-block;">' + Fmt.esc(val || '-') + '</span>';
  }
  function momPdfCell(label, val, mono) {
    return '<div style="background:#f7f7f8;border-radius:5px;padding:6px 8px;border:1px solid #e5e5ea;">' +
      '<div style="font-size:8px;font-weight:600;color:#8e8e93;text-transform:uppercase;margin-bottom:2px;">' + label + '</div>' +
      '<div style="font-size:10px;' + (mono ? 'font-family:monospace;' : '') + '">' + Fmt.esc(val || '-') + '</div></div>';
  }
  function momPdfField(label, val) {
    // Newlines survive as <br> — the notes field is multi-line, and a flattened
    // paragraph is not the record of what was said.
    var safe = Fmt.esc(val || '-').replace(/\n/g, '<br>');
    return '<div style="margin-bottom:6px;background:#f7f7f8;border-radius:6px;padding:7px 10px;border:1px solid #e5e5ea;">' +
      '<div style="font-size:8px;font-weight:600;color:#8e8e93;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;">' + label + '</div>' +
      '<div style="font-size:10px;color:#1c1c1e;word-break:break-word;">' + safe + '</div></div>';
  }

  async function momDownloadPDF(momId) {
    var mom = MOMS.find(function (x) { return x.id === momId; });
    if (!mom) return;
    if (typeof html2pdf !== 'function') {
      UI.toast('The PDF library did not load — check the connection and reload.', 'error');
      return;
    }
    var btn = $('il-mom-pdf'), orig = btn ? btn.innerHTML : '';
    if (btn) { btn.textContent = 'Generating…'; btn.disabled = true; }
    var wrap = null, holder = null;
    try {
      var items = momItemsOf(mom.id);
      var filename = (mom.title || 'Meeting').replace(/[^a-zA-Z0-9_]/g, '_') +
        (momLocked(mom) ? '' : '_DRAFT') + '_MOM.pdf';

      var cards = items.map(function (it, i) {
        var iss = momIssueOf(it);
        // ⚠️ Rows written before the migration hold their action text in `description`.
        var actText = it.action_item || it.description;
        return '<div style="margin-bottom:14px;padding:12px;border:1px solid #ddd;border-radius:8px;break-inside:avoid;">' +
          '<div style="display:grid;grid-template-columns:0.4fr 1.5fr 0.9fr 0.9fr 1.2fr 1fr;gap:5px;margin-bottom:8px;">' +
            momPdfCell('No.', it.item_no || String((it.seq == null ? i : it.seq) + 1), true) +
            momPdfCell('Category', it.category) +
            '<div style="background:#f7f7f8;border-radius:5px;padding:6px 8px;border:1px solid #e5e5ea;">' +
              '<div style="font-size:8px;font-weight:600;color:#8e8e93;text-transform:uppercase;margin-bottom:2px;">Type</div>' +
              // ⚠️ Falls back to the register link only when the row is untyped — legacy
              // rows predate the `type` column, and printing a dash for every one of them
              // would lose a true statement the export can still make about them.
              momPdfBadge(it.type || (it.issue_id ? 'Issue' : 'FYI')) + '</div>' +
            '<div style="background:#f7f7f8;border-radius:5px;padding:6px 8px;border:1px solid #e5e5ea;">' +
              '<div style="font-size:8px;font-weight:600;color:#8e8e93;text-transform:uppercase;margin-bottom:2px;">Status</div>' +
              // ⚠️ Once raised, the REGISTER owns the status — the same rule the screen
              // follows. Printing `mom_items.status` for a raised action would put a
              // stale status on paper that outlives the screen showing the live one.
              momPdfBadge(iss ? (iss.status || 'Open') : (it.status || 'Open')) + '</div>' +
            momPdfCell('Responsible', it.owner) +
            momPdfCell('Target Date', it.due_date ? Fmt.date(it.due_date) : '', true) +
          '</div>' +
          // mom-app's three text blocks, now backed by three real columns.
          // ⚠️ Each falls back to what the row can still truthfully say, because rows
          // written before the migration hold their action text in `description`.
          momPdfField('Issue / Agenda', it.issue) +
          momPdfField('Action Item', actText) +
          // Blank when the action text CAME from description (a legacy row), or the
          // sheet prints the same sentence twice under two different headings.
          momPdfField('Description', it.description !== actText ? it.description : '') +
          // Not a mom-app block: mom-app has no register to point at. Printed only when
          // the action has actually been raised, so it never adds an empty row.
          // Named, never embedded: the bucket is private, so a link in the sheet would
          // be dead for whoever opens the PDF. Saying a file exists is the useful half.
          (it.attachment_name ? momPdfField('Attachment', it.attachment_name) : '') +
          (iss ? momPdfField('Status in Issues & Concerns',
            (iss.status || 'Open') + (iss.champion ? ' · champion ' + iss.champion : '') +
            (it.carried_from_item_id ? ' · carried over from an earlier meeting' : '')) : '') +
        '</div>';
      }).join('');

      // ⚠️ A plain detached element, not a full document string: html2canvas renders
      // whatever DOM it is handed, and reusing the module's own markup would drag the
      // dark-theme variables in with it.
      // ⚠️⚠️ THE EXPORTED NODE MUST BE IN NORMAL FLOW. DO NOT PUT `position:fixed`
      // (or absolute) BACK ON `wrap`. It used to carry `position:fixed;left:-10000px`
      // to park itself off-screen, and that produced a COMPLETELY BLANK PDF — every
      // sheet was an empty A4 page whose content stream held nothing but a line width.
      //
      // Why: html2pdf clones the source into its own container and measures it there.
      // An out-of-flow element contributes NOTHING to that container's height, so
      // html2canvas got the right width and a height of ZERO and rendered no image at
      // all (measured: canvas 1438x0, and `/XObject <<>>` empty in the produced file).
      // An explicit `height` does not save it — the clone is still out of flow.
      //
      // So the OFF-SCREEN PARKING MOVES TO A HOLDER and the captured element stays in
      // normal flow inside it. The holder is what hides the node; `wrap` is what gets
      // rendered. Measured after the change: canvas 1438x360 with real content.
      holder = document.createElement('div');
      holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:190mm;';

      wrap = document.createElement('div');
      wrap.style.cssText = 'font-family:Arial,sans-serif;font-size:9px;color:#1c1c1e;width:190mm;' +
        'padding:15mm 10mm;box-sizing:border-box;background:#fff;';

      // Header fields this module records and mom-app does not. They are the minute's
      // substance — dropping them to match a narrower app would export a worse record —
      // so they print in the same field blocks, above the actions.
      var head = '';
      if (mom.attendees) head += momPdfField('Attendees', mom.attendees);
      if (mom.schedule_activity_id) {
        head += momPdfField('Activity discussed', mom.schedule_activity_id +
          (MOM_ACT_NAME[mom.schedule_activity_id] ? ' · ' + MOM_ACT_NAME[mom.schedule_activity_id] : ''));
      }
      if (mom.notes) head += momPdfField('Notes / discussion', mom.notes);
      if (head) head = '<div style="margin-bottom:14px;">' + head + '</div>';

      wrap.innerHTML =
        '<div style="background:#b40000;padding:14px 20px;margin:-20px -20px 18px -20px;display:flex;justify-content:space-between;align-items:center;">' +
          '<img src="../../assets/img/logo-white.png" style="height:26px;width:auto;" crossorigin="anonymous"/>' +
          '<div style="text-align:right;">' +
            '<div style="font-size:12px;font-weight:700;color:#fff;">' +
              // ⚠️ An undistributed minute MUST say so on paper. A PDF outlives the screen
              // that knows it was a draft, and a sheet that reads as issued minutes when
              // nobody has issued them is the one way this export can mislead.
              (momLocked(mom) ? '' : '<span style="background:#fff;color:#b40000;font-size:9px;' +
                'font-weight:800;padding:2px 7px;border-radius:3px;letter-spacing:0.08em;' +
                'margin-right:8px;vertical-align:middle;">DRAFT</span>') +
              Fmt.esc(projName) + ' — ' + Fmt.esc(mom.title || 'Meeting') + '</div>' +
            '<div style="font-size:9px;color:rgba(255,255,255,0.85);margin-top:3px;">📅 ' +
              Fmt.esc(mom.meeting_date ? Fmt.date(mom.meeting_date) : '-') + '   📍 ' + Fmt.esc(mom.location || '-') +
              '   (' + items.length + ' item' + (items.length !== 1 ? 's' : '') + ')</div>' +
          '</div>' +
        '</div>' + head +
        (items.length ? cards : momPdfField('Action items', 'No action items were recorded on these minutes.'));

      // ⚠️ Must be IN the document: html2canvas measures a laid-out element, and an
      // orphan node has no box. The HOLDER is parked off-screen so the page does not
      // jump; `wrap` sits in normal flow inside it (see the warning above).
      holder.appendChild(wrap);
      document.body.appendChild(holder);

      await html2pdf().set({
        margin: [10, 10, 10, 10],
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, allowTaint: true, logging: false, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      }).from(wrap).save();

      UI.toast('PDF downloaded', 'ok');
    } catch (e) {
      UI.toast('PDF error: ' + ((e && e.message) || e), 'error');
    } finally {
      // ⚠️ In `finally`: a throw mid-render would otherwise leave the off-screen node
      // in the document, and every later export would stack another one.
      // Removing the holder takes `wrap` with it.
      if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
      if (btn) { btn.innerHTML = orig; btn.disabled = false; }
    }
  }

  // ⚠️ DETAIL wiring only — the meeting picker and "+ New minutes" moved to the
  // List/Calendar browse views (wireBrowse), since selecting or creating a meeting
  // is how you GET to this view now, not something this view does to itself.
  function wireDetail() {
    var host = $('il-mom-view'); if (!host) return;
    if (!_momSel) return;
    momResolveActName(($('il-mom-act') || {}).value);

    // ⚠️ Re-rendering on every keystroke would destroy the input and its focus, so
    // the value is kept in module state and the caret is restored after the repaint.
    // The list is already in memory — there is no request to debounce.
    var fq = host.querySelector('#il-momf-q');
    if (fq) fq.oninput = function () {
      _momF.q = fq.value; var at = fq.selectionStart;
      renderDetail();
      var again = $('il-momf-q');
      if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch (e) {} }
    };
    [['il-momf-cat', 'cat'], ['il-momf-type', 'type'], ['il-momf-status', 'status']].forEach(function (pair) {
      var el = host.querySelector('#' + pair[0]);
      if (el) el.onchange = function () { _momF[pair[1]] = el.value; renderDetail(); };
    });
    var fc = host.querySelector('#il-momf-clear');
    if (fc) fc.onclick = function () { _momF = { q: '', cat: '', type: '', status: '' }; renderDetail(); };

    var rep = host.querySelector('#il-mom-report');
    if (rep) rep.onclick = function () { _momReport = !_momReport; renderDetail(); };

    var dist = host.querySelector('#il-mom-dist');
    if (dist) dist.onclick = function () {
      var cur = MOMS.find(function (x) { return x.id === _momSel; });
      momSetDistributed(_momSel, !momLocked(cur));
    };

    // ⚠️ NO "#il-mom-pullissues" wiring here any more — the bulk pull moved
    // inside the "Get from issue" panel as "+ Add all N" (see #il-mom-getall).
    var cgo = host.querySelector('#il-mom-carrygo');
    if (cgo) cgo.onclick = function () {
      var sel = host.querySelector('#il-mom-carryfrom');
      if (!sel || !sel.value) { UI.toast('Pick the meeting to carry actions from.', 'warn'); return; }
      momCarryOver(sel.value);
    };

    var pb = host.querySelector('#il-mom-pdf');
    // ⚠ Saves the header first when the user may edit: the export reads MOMS, not
    // the form, so a title typed and not saved would be missing from the sheet.
    if (pb) pb.onclick = async function () {
      var cur = MOMS.find(function (x) { return x.id === _momSel; });
      // ⚠️ Not when locked: the form is disabled, so this would be a pointless write
      // to a distributed minute — and one that bumps its updated_at for nothing.
      if (cur && canEditMinute(cur) && !momLocked(cur)) await momSaveHeader();
      await momDownloadPDF(_momSel);
    };
    var sv = host.querySelector('#il-mom-save');
    if (sv) sv.onclick = async function () { if (await momSaveHeader()) { UI.toast('Minutes saved', 'ok'); renderDetail(); } };

    var ai = host.querySelector('#il-mom-additem');
    if (ai) ai.onclick = async function () {
      // The header is saved first: adding a row re-renders, and a title typed a moment
      // ago would be thrown away by that repaint.
      await momSaveHeader();
      try {
        var seq = momItemsOf(_momSel).length;
        var ins = await sb().from('mom_items').insert({
          mom_id: _momSel, project_id: pid, seq: seq, description: '', action_item: '',
          // ⚠️ Defaults to FYI, not Issue: most minuted lines are information, and a row
          // that defaults to Issue would have every new action pre-classified as a
          // problem before anyone typed what it was.
          type: 'FYI', status: 'Open' }).select().single();
        if (ins.error) throw ins.error;
        MOM_ITEMS.push(ins.data); renderDetail();
      } catch (e) { UI.toast(e.message, 'error'); }
    };

    host.querySelectorAll('.il-mi').forEach(function (f) {
      f.onchange = function () {
        var id = f.closest('[data-item]').dataset.item, fld = f.dataset.f, patch = {};
        var v = f.value.trim ? f.value.trim() : f.value;
        // ⚠️ Empty means NULL on every nullable column, not the empty string.
        // `type` carries a CHECK (Issue | FYI | Report); writing '' when the planner
        // picks the blank option would be REFUSED by the database, and the other new
        // columns would silently store '' where every read tests for null.
        patch[fld] = (fld === 'due_date' || !v) && fld !== 'description' && fld !== 'status'
          ? (v || null) : v;
        momSaveItem(id, patch);
      };
    });
    // ⚠️ ONE hidden <input type=file> reused by every row, not one per row: a table of
    // 40 actions would otherwise carry 40 file inputs, and the row that owns the
    // pending pick is tracked instead.
    var fin = host.querySelector('#il-mom-fileinput');
    host.querySelectorAll('.il-mi-fadd').forEach(function (b) {
      b.onclick = function () {
        if (!fin) return;
        fin.dataset.item = b.closest('[data-item]').dataset.item;
        fin.value = '';            // so re-picking the same file still fires change
        fin.click();
      };
    });
    if (fin) fin.onchange = function () {
      var id = fin.dataset.item, f = fin.files && fin.files[0];
      fin.value = '';
      if (id && f) momAttachUpload(id, f);
    };
    host.querySelectorAll('.il-mi-fview').forEach(function (b) {
      b.onclick = function () { momAttachOpen(b.closest('[data-item]').dataset.item); };
    });
    host.querySelectorAll('.il-mi-fdel').forEach(function (b) {
      b.onclick = function () { momAttachRemove(b.closest('[data-item]').dataset.item); };
    });

    // ⚠️ NO ".il-mi-raise" wiring here any more — the button is gone.
    // ⚠️ Capturing/opening a lesson now navigates to the sibling Issues & Concerns
    // module's Lessons Learned screen: lessons are its record, not this module's,
    // once the two split apart. `momId`/`momItem`/`issue_id` carry the link across
    // exactly as newLesson({mom_id, mom_item_id, issue_id}) used to pre-fill it
    // locally; the receiving module reads them from the query string.
    host.querySelectorAll('.il-mi-lesson').forEach(function (b) {
      b.onclick = function () {
        var id = b.closest('[data-item]').dataset.item;
        var it = MOM_ITEMS.find(function (x) { return x.id === id; }) || {};
        var q = 'screen=lessons&momId=' + encodeURIComponent(it.mom_id) +
          '&momItem=' + encodeURIComponent(id) +
          (it.issue_id ? '&issueId=' + encodeURIComponent(it.issue_id) : '');
        location.href = '../issues-lessons/index.html?' + q;
      };
    });
    host.querySelectorAll('.il-mi-lesson-open').forEach(function (b) {
      b.onclick = function () {
        location.href = '../issues-lessons/index.html?screen=lessons&openLesson=' + encodeURIComponent(b.dataset.lesson);
      };
    });
    // ---- the "Get from issue" panel -------------------------------------------
    var gib = host.querySelector('#il-mom-getissue');
    if (gib) gib.onclick = function () {
      _momPickerOpen = !_momPickerOpen; _momPickerQ = '';
      renderDetail();
    };
    var gq = host.querySelector('#il-mom-getq');
    if (gq) gq.oninput = function () {
      _momPickerQ = gq.value; var at = gq.selectionStart;
      renderDetail();
      var again = $('il-mom-getq');
      if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch (e) {} }
    };
    var gall = host.querySelector('#il-mom-getall');
    if (gall) gall.onclick = async function () {
      gall.disabled = true;
      await momPullIssues(_momSel);
      _momPickerOpen = false;
      renderDetail();
    };
    host.querySelectorAll('.il-mom-geti').forEach(function (b) {
      b.onclick = async function () {
        b.disabled = true;
        var ok = await momPullOneIssue(_momSel, b.dataset.issue);
        renderDetail();
        if (!ok) b.disabled = false;
      };
    });
    // ⚠️ Saves on change, one field at a time — the same rule the rest of this card
    // follows. A Save button covering the header AND every action is how a half-typed
    // action gets written.
    wirePeople(host, function (key, ids, text) {
      if (key.indexOf('mom-own-') !== 0) return;
      var id = key.slice('mom-own-'.length);
      momSaveItem(id, { owner_ids: ids, owner: championText(ids, text) || null });
    });
    host.querySelectorAll('.il-mi-del').forEach(function (b) {
      b.onclick = async function () {
        var id = b.closest('[data-item]').dataset.item;
        var it = MOM_ITEMS.find(function (x) { return x.id === id; });
        // ⚠️ Removing the action does NOT remove the issue it raised — the register is
        // its own record and someone may already be working it. Said out loud, because
        // the opposite is a reasonable thing to assume.
        if (!confirm('Remove this action item?' +
          (it && it.attachment_url ? '\n\nIts attached file is deleted too.' : '') +
          (it && it.issue_id
          ? '\n\nThe issue it raised STAYS in Issues & Concerns — this only removes the line from these minutes.' : ''))) return;
        // ⚠️ Read the path BEFORE the row leaves memory, or there is nothing left to
        // name the object with and it is orphaned in the bucket forever.
        var paths = momPathsOf(it ? [it] : []);
        try {
          var dl = await sb().from('mom_items').delete().eq('id', id);
          if (dl.error) throw dl.error;
          if (paths.length) { try { await sb().storage.from(MOM_BUCKET).remove(paths); } catch (e) {} }
          MOM_ITEMS = MOM_ITEMS.filter(function (x) { return x.id !== id; });
          renderDetail();
        } catch (e) { UI.toast(e.message, 'error'); }
      };
    });

    var db = host.querySelector('#il-mom-del');
    if (db) db.onclick = async function () {
      var items = momItemsOf(_momSel), raised = items.filter(function (i) { return i.issue_id; }).length;
      // ⚠️ Same rule as the single-action delete: capture the paths first. The action
      // rows go by `on delete cascade`, so after this they cannot be queried at all.
      var paths = momPathsOf(items);
      if (!confirm('Delete these minutes and their ' + items.length + ' action item(s)?' +
        (paths.length ? '\n\n' + paths.length + ' attached file(s) are deleted too.' : '') +
        (raised ? '\n\n' + raised + ' issue(s) already raised in Issues & Concerns will REMAIN — they simply stop pointing back at a meeting.' : ''))) return;
      try {
        var dl = await sb().from('meeting_minutes').delete().eq('id', _momSel);
        if (dl.error) throw dl.error;
        if (paths.length) { try { await sb().storage.from(MOM_BUCKET).remove(paths); } catch (e) {} }
        MOM_ITEMS = MOM_ITEMS.filter(function (x) { return x.mom_id !== _momSel; });
        MOMS = MOMS.filter(function (x) { return x.id !== _momSel; });
        _momSel = null; UI.toast('Minutes deleted', 'ok'); renderDetail();
      } catch (e) { UI.toast(e.message, 'error'); }
    };

    // ---- the activity picker ----
    var clr = host.querySelector('#il-mom-actclear');
    if (clr) clr.onclick = function () {
      $('il-mom-act').value = '';
      $('il-mom-actsel').innerHTML = momActChipHTML('', false);
      wireMom();
    };
    var q = host.querySelector('#il-mom-actq'), res = host.querySelector('#il-mom-acres');
    if (q && res) {
      var close = function () { res.hidden = true; res.innerHTML = ''; };
      q.oninput = function () {
        var term = q.value;
        if (_momActTimer) clearTimeout(_momActTimer);
        if (String(term).trim().length < 2) { close(); return; }
        _momActTimer = setTimeout(async function () {
          try {
            var hits = await momActSearch(term);
            if (hits === null) { close(); return; }
            res.hidden = false;
            res.innerHTML = hits.length
              ? hits.slice(0, 25).map(function (r) {
                  return '<button type="button" data-act="' + Fmt.esc(r.activity_id) + '" data-actn="' + Fmt.esc(r.activity_name || '') + '">' +
                    '<b>' + Fmt.esc(r.activity_id) + '</b> — ' + Fmt.esc(r.activity_name || '(unnamed)') + '</button>';
                }).join('') + (hits.length > 25 ? '<div class="il-mom-acnote">More than 25 match — keep typing to narrow.</div>' : '')
              : '<div class="il-mom-acnote">No activity in this project matches.</div>';
            res.querySelectorAll('[data-act]').forEach(function (b) {
              b.onclick = function () {
                var id = b.dataset.act;
                MOM_ACT_NAME[id] = b.dataset.actn || '';
                $('il-mom-act').value = id;
                $('il-mom-actsel').innerHTML = momActChipHTML(id, false);
                var nm = $('il-mom-actname'); if (nm && MOM_ACT_NAME[id]) nm.textContent = '· ' + MOM_ACT_NAME[id];
                q.value = ''; close(); wireMom();
              };
            });
          } catch (e) {
            res.hidden = false;
            res.innerHTML = '<div class="il-mom-acnote">Could not search the schedule: ' + Fmt.esc(e.message || 'failed') + '</div>';
          }
        }, 250);
      };
      q.onkeydown = function (e) { if (e.key === 'Escape') { close(); e.stopPropagation(); } };
      // ⚠️ Bound ONCE for the life of the page, not per wireMom() call — wireMom runs on
      // every render and on every picker interaction, so a listener added here would
      // accumulate. It looks the picker up by id each time instead of closing over it.
      if (!_momDocClick) {
        _momDocClick = function (e) {
          var r = $('il-mom-acres'), i = $('il-mom-actq');
          if (r && !r.hidden && !r.contains(e.target) && e.target !== i) { r.hidden = true; r.innerHTML = ''; }
        };
        document.addEventListener('click', _momDocClick);
      }
    }
  }

  return { init: init };
})();
