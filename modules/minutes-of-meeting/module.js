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

  // ⚠️ ITEM #17 — top-level tabs. 'dashboard' | 'meetings'. Dashboard is the
  // landing tab (matches the Issues & Concerns convention this module split
  // from — item #16 renamed that module's own "Report" screen to "Dashboard"
  // as the default view). Meetings hosts everything this module already had
  // (List / Calendar / Detail) PLUS the recurring-schedule list (item #19).
  var _momTab = 'dashboard';

  // ==========================================================================
  // RECURRING MEETING SCHEDULES (items #19, #22) — see the block above init()
  // for the occurrence math (schedDatesInRange / schedNextOccurrence / …).
  // ==========================================================================
  var SCHEDULES = [];
  // Which schedule's right-pane is open in the Meetings tab's "Recurring
  // meetings" list (item #22), and the state of the two small forms it hosts.
  var _schedSel = null;
  var _schedFormOpen = false, _schedFormDraft = null;      // add/edit a SCHEDULE
  var _schedOccOpen = false, _schedOccDraft = null;        // "+ Add a meeting" for it

  // ⚠️ ITEM #23 — per-action-item hold/close, mirroring the Issues workflow
  // (2026-08-31). Keyed by item id, unlike Issues' single `_issHoldOpen` /
  // `_issCloseOpen`, because SEVERAL action-item cards are on screen at once
  // here — one flag each would collide across rows.
  var _momItemWF = {};          // itemId -> {mode:'hold'|'close', note, report, lesson}
  var ITEM_HISTORY = {};        // itemId -> [] once loaded, for the "History" reveal
  var _momItemHistOpen = {};    // itemId -> true while its history panel is open

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
  // DASHBOARD CHART HELPERS (item #18/#2) — hand-rolled inline SVG, no library,
  // the app's established convention. ⚠️ Deliberately duplicated from Issues &
  // Concerns rather than shared: these two modules are separate IIFEs in
  // separate files with no shared runtime, and the module split already
  // established (see this file's header comment, and the People Picker block
  // above) that a small duplicated component beats widening the split into a
  // shared-asset change nobody asked for.
  // ==========================================================================
  var CHART_COLORS = ['#EE3124', '#2B6CB0', '#2F855A', '#B7791F', '#6B46C1',
                       '#B83280', '#00838F', '#8D6E63', '#4A5568', '#5A67D8', '#C42127'];

  function donutChartSVG(slices, opts) {
    opts = opts || {};
    var size = opts.size || 130, sw = opts.stroke || 20;
    var r = (size - sw) / 2, c = size / 2, circ = 2 * Math.PI * r;
    var total = slices.reduce(function (s, x) { return s + x.value; }, 0);
    var offset = 0, arcs;
    if (!total) {
      arcs = '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="var(--pd-line)" stroke-width="' + sw + '"></circle>';
    } else {
      arcs = slices.map(function (s) {
        var frac = s.value / total, len = frac * circ;
        var piece = '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="' + s.color +
          '" stroke-width="' + sw + '" stroke-dasharray="' + len.toFixed(2) + ' ' + (circ - len).toFixed(2) +
          '" stroke-dashoffset="' + (-offset).toFixed(2) + '" transform="rotate(-90 ' + c + ' ' + c + ')">' +
          '<title>' + Fmt.esc(s.label) + ': ' + s.value + '</title></circle>';
        offset += len;
        return piece;
      }).join('');
    }
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size +
      '" role="img" aria-label="' + Fmt.esc(opts.aria || 'chart') + '">' + arcs + '</svg>';
  }

  function barChartSVG(bars, opts) {
    opts = opts || {};
    var w = opts.width || 280, h = opts.height || 140, padTop = 22, padBottom = 20;
    var bodyH = h - padTop - padBottom;
    var max = Math.max(1, bars.reduce(function (m, b) { return Math.max(m, b.value); }, 0));
    var bw = w / bars.length;
    var barsSvg = bars.map(function (b, i) {
      var bh = max ? Math.round((b.value / max) * bodyH) : 0;
      var innerW = bw * 0.6, x = i * bw + (bw - innerW) / 2;
      var y = padTop + (bodyH - bh);
      return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + innerW.toFixed(1) +
          '" height="' + Math.max(1, bh).toFixed(1) + '" fill="' + b.color + '" rx="3"><title>' +
          Fmt.esc(b.label) + ': ' + b.value + '</title></rect>' +
        '<text x="' + (x + innerW / 2).toFixed(1) + '" y="' + (y - 4).toFixed(1) + '" text-anchor="middle" ' +
          'font-size="10" fill="var(--pd-ink)">' + b.value + '</text>' +
        '<text x="' + (x + innerW / 2).toFixed(1) + '" y="' + (h - 4).toFixed(1) + '" text-anchor="middle" ' +
          'font-size="9" fill="var(--pd-muted)">' + Fmt.esc(clip(b.label, 10)) + '</text>';
    }).join('');
    return '<svg width="100%" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" ' +
      'aria-label="' + Fmt.esc(opts.aria || 'chart') + '" preserveAspectRatio="xMidYMid meet">' + barsSvg + '</svg>';
  }

  // A single horizontal proportion bar with a label overlay — used for the
  // attendance "battery" and the open-minutes stat, both single numbers
  // rather than a category breakdown (which is what the donut/bar above are
  // for). `tone` = 'is-battery' adds the small nub CSS treats as a battery cap.
  function meterHTML(pct, label, tone) {
    pct = Math.max(0, Math.min(100, Math.round(pct || 0)));
    return '<div class="il-mom-meter' + (tone ? ' ' + tone : '') + '">' +
      '<div class="il-mom-meter-track"><div class="il-mom-meter-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="il-mom-meter-label">' + Fmt.esc(label) + '</div>' +
    '</div>';
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
  // ⚠️ ITEM #21 — <datalist> options, NOT <select> options: `<option>` inside
  // a datalist takes no `selected` attribute (the bound <input>'s own value
  // decides what shows), and offering a blank "— none —" entry here would
  // just be typed over, unlike momOptions()'s select-value trap where a
  // missing option silently rewrites the field.
  function momTypeDatalistOptions() {
    var seen = {}, out = [];
    MOM_MEETING_TYPES.concat(momUsedMeetingTypes()).forEach(function (v) {
      v = String(v == null ? '' : v).trim();
      if (!v || seen[v.toLowerCase()]) return;
      seen[v.toLowerCase()] = 1; out.push(v);
    });
    return out.map(function (v) { return '<option value="' + Fmt.esc(v) + '">'; }).join('');
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
    MOMS = []; MOM_ITEMS = []; ISSUES = []; LESSONS = []; SCHEDULES = [];
    _momSel = null; _momErr = ''; _momLoaded = false;
    _momQ = ''; _momF = { q: '', cat: '', type: '', status: '' };
    _momView = 'list'; _momBrowsePrev = 'list'; _momTab = 'dashboard';
    _momPickerOpen = false; _momPickerQ = '';
    _schedSel = null; _schedFormOpen = false; _schedFormDraft = null;
    _schedOccOpen = false; _schedOccDraft = null;
    _momItemWF = {}; ITEM_HISTORY = {}; _momItemHistOpen = {};
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
    // ⚠️ Tolerant of the un-run 2026-09-01 migration, same as ISSUES/LESSONS
    // above: no table means no schedules, and the Meetings tab's schedules
    // list just says so rather than refusing the whole module.
    try {
      SCHEDULES = await PDb.selectAll('mom_schedules', function (q) { return q.eq('project_id', pid); });
      SCHEDULES.sort(function (a, b) { return (a.title || '').localeCompare(b.title || ''); });
    } catch (e) { SCHEDULES = []; }
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

  // ==========================================================================
  // SCHEDULE OCCURRENCE MATH (items #18, #19, #22)
  // ⚠️ UTC throughout, matching the calendar view above — the local-vs-UTC
  // off-by-one has bitten this app repeatedly (minusDays in both registers,
  // the drawing importer), and a schedule's whole job is landing on the
  // right day.
  // ==========================================================================
  var FREQUENCIES = [
    { key: 'weekly',          label: 'Weekly (every N week(s), on a weekday)' },
    { key: 'monthly_weekday', label: 'Monthly, on a weekday — e.g. "first Monday"' },
    { key: 'monthly_date',    label: 'Monthly, on a date' },
    { key: 'quarterly',       label: 'Quarterly, on a date' },
  ];
  var WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var ORDINAL_NAMES = { '1': 'first', '2': 'second', '3': 'third', '4': 'fourth', '-1': 'last' };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoOf(y, mIdx, day) { return y + '-' + pad2(mIdx + 1) + '-' + pad2(day); }
  function utcDow(d) { return (d.getUTCDay() + 6) % 7; }   // Monday=0..Sunday=6

  // The nth (1..4) or LAST (-1) weekday-of-month, as a day-of-month number.
  // -1 finds the true last occurrence even in a month where a 5th doesn't
  // exist, so "last Friday" stays meaningful every month.
  function nthWeekdayOfMonth(y, mIdx, weekday, ordinal) {
    var first = new Date(Date.UTC(y, mIdx, 1));
    var offset = (weekday - utcDow(first) + 7) % 7;
    if (ordinal === -1) {
      var daysInMonth = new Date(Date.UTC(y, mIdx + 1, 0)).getUTCDate();
      var day = 1 + offset;
      while (day + 7 <= daysInMonth) day += 7;
      return day;
    }
    return 1 + offset + (Math.max(1, ordinal) - 1) * 7;
  }
  function clampDom(y, mIdx, dom) {
    return Math.min(dom, new Date(Date.UTC(y, mIdx + 1, 0)).getUTCDate());
  }
  function ordinalNum(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // Every occurrence of `sch` within [startISO, endISO] inclusive, on or
  // after its own start_date. Walked month by month for every frequency
  // (even 'weekly', which just emits each matching weekday within a month)
  // so one function serves both the calendar's one-month-at-a-time need and
  // schedNextOccurrence()'s short forward-looking window.
  function schedDatesInRange(sch, startISO, endISO) {
    var out = [];
    if (!sch || sch.active === false) return out;
    var lo = (sch.start_date && sch.start_date > startISO) ? sch.start_date : startISO;
    if (lo > endISO) return out;
    var loP = lo.split('-'), hiP = endISO.split('-');
    var y = +loP[0], m = +loP[1] - 1, endY = +hiP[0], endM = +hiP[1] - 1;
    var guard = 0;
    while ((y < endY || (y === endY && m <= endM)) && guard++ < 600) {
      if (sch.frequency === 'weekly') {
        var interval = Math.max(1, sch.interval_n || 1);
        var wd = sch.weekday == null ? 0 : sch.weekday;
        var daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        // ⚠️ Anchored to the schedule's own start_date, so "every 2 weeks"
        // means every 2 weeks FROM WHEN IT STARTED — a week that lands on
        // the right weekday but the wrong parity relative to the anchor is
        // skipped, or "every other Monday" would silently become "every
        // Monday that happens to fall in an even ISO week".
        var anchor = new Date((sch.start_date || isoOf(y, m, 1)) + 'T00:00:00Z');
        for (var day = 1; day <= daysInMonth; day++) {
          var d = new Date(Date.UTC(y, m, day));
          if (utcDow(d) !== wd) continue;
          var weeksSince = Math.floor((d.getTime() - anchor.getTime()) / (7 * 86400000));
          if (weeksSince < 0 || weeksSince % interval !== 0) continue;
          out.push(isoOf(y, m, day));
        }
      } else if (sch.frequency === 'monthly_weekday') {
        var wd2 = sch.weekday == null ? 0 : sch.weekday;
        var ord = sch.week_ordinal == null ? 1 : sch.week_ordinal;
        out.push(isoOf(y, m, nthWeekdayOfMonth(y, m, wd2, ord)));
      } else if (sch.frequency === 'quarterly') {
        // Quarters anchored to the schedule's OWN start month, not the
        // calendar year — a schedule starting in February recurs in
        // Feb/May/Aug/Nov, never silently shifted onto Jan/Apr/Jul/Oct.
        var anchorM = sch.start_date ? (+sch.start_date.slice(5, 7) - 1) : m;
        if (((m - anchorM) % 3 + 3) % 3 === 0) out.push(isoOf(y, m, clampDom(y, m, sch.day_of_month || 1)));
      } else {   // 'monthly_date' (default)
        out.push(isoOf(y, m, clampDom(y, m, sch.day_of_month || 1)));
      }
      m++; if (m > 11) { m = 0; y++; }
    }
    var loBound = sch.start_date || '0000-01-01';
    return out.filter(function (iso) { return iso >= startISO && iso <= endISO && iso >= loBound; }).sort();
  }

  // The first occurrence on or after `fromISO`. Looks up to ~2 years ahead —
  // headroom a rare cadence (quarterly) or a future-dated start needs.
  function schedNextOccurrence(sch, fromISO) {
    var endD = new Date(fromISO + 'T00:00:00Z'); endD.setUTCDate(endD.getUTCDate() + 730);
    var end = endD.getUTCFullYear() + '-' + pad2(endD.getUTCMonth() + 1) + '-' + pad2(endD.getUTCDate());
    var dates = schedDatesInRange(sch, fromISO, end);
    return dates.length ? dates[0] : null;
  }

  // A short, readable statement of the recurrence — what item #18's dashboard
  // and the schedules list both print ("every first Monday of the month").
  function schedFrequencyLabel(sch) {
    if (!sch) return '';
    var wd = WEEKDAY_NAMES[sch.weekday == null ? 0 : sch.weekday];
    if (sch.frequency === 'weekly') {
      var n = Math.max(1, sch.interval_n || 1);
      return n === 1 ? 'Every ' + wd : (n === 2 ? 'Every other ' + wd : 'Every ' + n + ' weeks, on ' + wd);
    }
    if (sch.frequency === 'monthly_weekday') {
      var ord = ORDINAL_NAMES[String(sch.week_ordinal == null ? 1 : sch.week_ordinal)] || 'first';
      return 'Every ' + ord + ' ' + wd + ' of the month';
    }
    if (sch.frequency === 'quarterly') return 'Every quarter, on the ' + ordinalNum(sch.day_of_month || 1);
    return 'Every month, on the ' + ordinalNum(sch.day_of_month || 1);
  }

  function schedActiveList() { return SCHEDULES.filter(function (s) { return s.active !== false; }); }
  // Actual recorded minutes tied to a schedule, most recent first — what the
  // right-pane's "all previous occurrences" list (item #22) reads.
  function schedMeetingsOf(schedId) {
    return MOMS.filter(function (x) { return x.schedule_id === schedId; })
      .slice().sort(function (a, b) { return (b.meeting_date || '').localeCompare(a.meeting_date || ''); });
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
      get: function () { return { t: _momTab, v: _momView, m: _momSel }; },
      apply: function (state) {
        _momTab = state.t || 'dashboard';
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
    // ⚠️ ITEM #17 — the Dashboard/Meetings tab strip lives in the topbar
    // (index.html), outside #il-mom-view, so it is wired ONCE here rather
    // than in wireBrowse()/wireDetail(), which re-run on every repaint of
    // the content below it.
    document.querySelectorAll('.il-tabs [data-tab]').forEach(function (b) {
      b.onclick = function () { _momTab = b.dataset.tab; render(); if (histView) histView.push(); };
    });
  }

  // -------------------------------------------------------------- render ---
  // ⚠️ ITEM #17: two top-level tabs, wired once in wire() (they live in the
  // topbar, outside #il-mom-view, so they are never rebuilt by a re-render —
  // only their `.active` class needs syncing here).
  function syncTopTabs() {
    document.querySelectorAll('.il-tabs [data-tab]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === _momTab);
    });
  }
  function render() {
    if (!pid) { _paintEmpty('Select a project to see its minutes.'); return; }
    if (!_momLoaded) { _paintEmpty('Loading minutes…'); return; }
    syncTopTabs();
    if (_momTab === 'dashboard') renderMomDashboard();
    else if (_momView === 'detail' && _momSel) renderDetail();
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
  // ==========================================================================
  // DASHBOARD (items #2, #18) — the "similar concept to the dashboard for
  // issues" ask. Two sections: a meetings summary (frequency, last held,
  // attendance, open-minutes, on-schedule %) and an action-items summary
  // mirroring the Issues & Concerns dashboard's own tile/list/pie/bar shape,
  // scoped to MOM_ITEMS instead of issues_lessons rows.
  // ==========================================================================
  function momLastHeldDate() {
    var today = momToday();
    var held = MOMS.filter(function (m) { return m.meeting_date && m.meeting_date <= today; });
    if (!held.length) return null;
    return held.reduce(function (mx, m) { return m.meeting_date > mx ? m.meeting_date : mx; }, held[0].meeting_date);
  }
  function attendeeCount(obj) {
    if (!obj) return null;
    var ids = (obj.ids || []).length;
    var extra = (obj.text || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).length;
    return ids + extra;
  }
  // ⚠️ Computed off the most recent HELD meeting that actually recorded
  // structured Required/Actual attendees (item #20) — a legacy meeting with
  // only the old free-text `attendees` field has nothing this can count, and
  // reporting 0 there would read as "nobody attended" rather than "not asked".
  function momAttendanceBattery() {
    var today = momToday();
    var held = MOMS.filter(function (m) { return m.meeting_date && m.meeting_date <= today; })
      .slice().sort(function (a, b) { return (b.meeting_date || '').localeCompare(a.meeting_date || ''); });
    var m = held.find(function (x) { return x.attendees_required || x.attendees_actual; });
    if (!m) return null;
    var req = attendeeCount(m.attendees_required) || 0;
    var act = attendeeCount(m.attendees_actual) || 0;
    return { title: m.title, date: m.meeting_date, required: req, actual: act,
      pct: req ? Math.round(act / req * 100) : (act ? 100 : 0) };
  }
  // "Open minutes" = still in Draft (not yet distributed) — a minute is "open"
  // in the same sense an issue is, until it is issued/closed off.
  function momOpenMinutesStat() {
    var total = MOMS.length;
    var open = MOMS.filter(function (m) { return !m.is_distributed; }).length;
    return { total: total, open: open, pct: total ? Math.round(open / total * 100) : 0 };
  }
  // ⚠️ Credit for a schedule is CAPPED at what was actually expected of it —
  // summing raw actual counts would let one over-met schedule (extra ad-hoc
  // sessions under the same recurring slot) mask another schedule's real
  // shortfall in the combined percentage.
  function momOnScheduleStats() {
    var today = momToday();
    var expected = 0, actual = 0;
    schedActiveList().forEach(function (s) {
      var exp = schedDatesInRange(s, s.start_date || today, today).length;
      var act = schedMeetingsOf(s.id).filter(function (m) { return m.meeting_date && m.meeting_date <= today; }).length;
      expected += exp;
      actual += Math.min(act, exp || act);
    });
    return { expected: expected, actual: actual };
  }
  function momAllOpenItems() {
    return MOM_ITEMS.filter(function (it) { return momItemStatus(it) !== 'Closed'; });
  }
  function momItemsDashListHTML(data) {
    if (!data.length) return '<div class="il-empty" style="padding:16px;">No open action items.</div>';
    var top = data.slice().sort(function (a, b) {
      var ma = MOMS.find(function (m) { return m.id === a.mom_id; });
      var mb = MOMS.find(function (m) { return m.id === b.mom_id; });
      return ((mb && mb.meeting_date) || '').localeCompare((ma && ma.meeting_date) || '');
    }).slice(0, 12);
    return '<div class="pd-tablewrap"><table class="il-dash-list"><thead><tr>' +
      '<th>Action</th><th>Meeting</th><th>Category</th><th>Status</th><th>Responsible</th></tr></thead><tbody>' +
      top.map(function (it) {
        var m = MOMS.find(function (x) { return x.id === it.mom_id; });
        var actText = it.action_item || it.description || '';
        return '<tr data-openmom="' + Fmt.esc(it.mom_id) + '">' +
          '<td>' + Fmt.esc(clip(actText, 70) || '(no text)') + '</td>' +
          '<td>' + Fmt.esc((m && m.title) || '—') + (m && m.meeting_date ? ' · ' + Fmt.esc(Fmt.date(m.meeting_date)) : '') + '</td>' +
          '<td>' + Fmt.esc(it.category || '—') + '</td>' +
          '<td><span class="il-pill ' + statusClass(momItemStatus(it)) + '">' + Fmt.esc(momItemStatus(it)) + '</span></td>' +
          '<td>' + Fmt.esc(championText(it.owner_ids, it.owner) || '—') + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>' +
      (data.length > top.length
        ? '<p class="il-mom-note">Showing the 12 most recent of ' + data.length +
          ' — open a meeting from the Meetings tab for the rest.</p>' : '');
  }
  function renderMomActionDashboard() {
    var data = momAllOpenItems();
    var byCat = {};
    data.forEach(function (it) { var k = it.category || '(no category)'; byCat[k] = (byCat[k] || 0) + 1; });
    var catSlices = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; })
      .map(function (k, i) { return { label: k, value: byCat[k], color: CHART_COLORS[i % CHART_COLORS.length] }; });
    var byType = {};
    data.forEach(function (it) { var k = it.type || '(untyped)'; byType[k] = (byType[k] || 0) + 1; });
    var typeBars = Object.keys(byType).sort(function (a, b) { return byType[b] - byType[a]; })
      .map(function (k, i) { return { label: k, value: byType[k], color: CHART_COLORS[i % CHART_COLORS.length] }; });
    return '<div class="pd-card il-dash-card il-dash-wide"><h4>Open action items</h4>' +
        momItemsDashListHTML(data) + '</div>' +
      '<div class="pd-card il-dash-card"><h4>By category</h4>' +
        (catSlices.length
          ? '<div class="il-dash-chartwrap">' + donutChartSVG(catSlices, { aria: 'Open action items by category' }) +
            '<div class="il-dash-legend">' + catSlices.map(function (s) {
              return '<span class="il-dash-legend-i"><i style="background:' + s.color + '"></i>' +
                Fmt.esc(s.label) + ' (' + s.value + ')</span>';
            }).join('') + '</div></div>'
          : '<div class="il-empty" style="padding:16px;">Nothing to chart yet.</div>') +
      '</div>' +
      '<div class="pd-card il-dash-card"><h4>By type</h4>' +
        (typeBars.length ? barChartSVG(typeBars, { aria: 'Open action items by type' })
                         : '<div class="il-empty" style="padding:16px;">Nothing to chart yet.</div>') +
      '</div>';
  }
  function renderMomDashboard() {
    var host = $('il-mom-view'); if (!host) return;
    host.classList.remove('il-mom-report');
    if (_momErr) {
      host.innerHTML = '<div class="il-empty" style="padding:24px;">Could not load minutes: ' + Fmt.esc(_momErr) + '</div>';
      return;
    }
    var last = momLastHeldDate();
    var att = momAttendanceBattery();
    var openStat = momOpenMinutesStat();
    var sched = momOnScheduleStats();
    // ⚠️ An empty pie (0 expected) reads as a real 0% conducted-as-scheduled,
    // which is a false statement when there is simply no schedule to compare
    // against yet — so the pie is withheld entirely rather than shown at 0/0.
    var pieSlices = sched.expected
      ? [{ label: 'Conducted as scheduled', value: sched.actual, color: '#2F855A' },
         { label: 'Missed', value: Math.max(0, sched.expected - sched.actual), color: '#B7791F' }]
      : [];

    host.innerHTML =
      '<div class="il-dash-grid">' +
        '<div class="pd-card il-dash-card"><h4>Meeting frequency</h4>' +
          (schedActiveList().length
            ? '<ul class="il-mom-freqlist">' + schedActiveList().map(function (s) {
                return '<li><b>' + Fmt.esc(s.title) + '</b> — ' + Fmt.esc(schedFrequencyLabel(s)) + '</li>';
              }).join('') + '</ul>'
            : '<p class="il-mom-note">No recurring schedule is defined yet — set one from the Meetings tab.</p>') +
          '<p class="il-mom-note" style="margin-top:8px;">Last meeting held: ' +
            (last ? '<b>' + Fmt.esc(Fmt.date(last)) + '</b>' : 'none recorded yet') + '</p>' +
        '</div>' +
        '<div class="pd-card il-dash-card"><h4>Attendance — last meeting held</h4>' +
          (att
            ? meterHTML(att.pct, att.actual + ' of ' + att.required + ' required attendees (' + att.pct + '%) — ' +
                Fmt.esc(att.title || 'the last meeting'), 'is-battery')
            : '<p class="il-mom-note">Not recorded yet — set Required and Actual attendees when saving a meeting.</p>') +
        '</div>' +
        '<div class="pd-card il-dash-card"><h4>Open minutes</h4>' +
          meterHTML(openStat.pct, openStat.open + ' of ' + openStat.total + ' minutes still in Draft (' + openStat.pct + '%)') +
        '</div>' +
        '<div class="pd-card il-dash-card"><h4>Conducted as scheduled</h4>' +
          (pieSlices.length
            ? '<div class="il-dash-chartwrap">' + donutChartSVG(pieSlices, { aria: 'Meetings conducted as scheduled' }) +
              '<div class="il-dash-legend">' + pieSlices.map(function (s) {
                return '<span class="il-dash-legend-i"><i style="background:' + s.color + '"></i>' +
                  Fmt.esc(s.label) + ' (' + s.value + ')</span>';
              }).join('') + '</div></div>'
            : '<div class="il-empty" style="padding:16px;">Not enough schedule history yet.</div>') +
        '</div>' +
      '</div>' +
      '<h4 class="il-mom-dashsec">Action items across all minutes</h4>' +
      '<div class="il-dash-grid">' + renderMomActionDashboard() + '</div>';

    host.querySelectorAll('[data-openmom]').forEach(function (tr) {
      tr.onclick = function () { _momTab = 'meetings'; momOpenMeeting(tr.dataset.openmom); };
    });
  }

  function renderBrowse() {
    var host = $('il-mom-view'); if (!host) return;
    host.classList.remove('il-mom-report');
    var list = momSearchList();
    host.innerHTML =
      schedulesPanelHTML() +
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
    if (window.Icons && Icons.hydrate) Icons.hydrate(host);
  }

  // ==========================================================================
  // ITEM #19/#22 — recurring meeting schedules: where they are DEFINED (this
  // panel, at the top of the Meetings tab) and the right pane a click on one
  // opens, showing its next planned date, every actual meeting recorded
  // against it, and the "+ Add a meeting" form that copies its defaults from
  // the last occurrence. Sits ABOVE the List/Calendar browse of individual
  // meeting_minutes rows below it, which is unaffected — a schedule is a
  // commitment, not a replacement for the meetings themselves.
  // ==========================================================================
  function schedulesPanelHTML() {
    var scheds = schedActiveList();
    var sel = _schedSel ? SCHEDULES.find(function (s) { return s.id === _schedSel; }) : null;
    return '<div class="il-mom-schedpanel">' +
      '<div class="il-mom-schedhead">' +
        '<h4>Recurring meeting schedules</h4>' +
        (canAdd && !_schedFormOpen ? '<button class="pd-btn pd-btn-sm" id="il-sched-new">+ New schedule</button>' : '') +
      '</div>' +
      (_schedFormOpen ? scheduleFormHTML(_schedFormDraft) : '') +
      (scheds.length
        ? '<div class="il-mom-schedbody' + (sel ? ' has-sel' : '') + '">' +
            '<div class="il-mom-schedlist">' + scheds.map(scheduleRowHTML).join('') + '</div>' +
            (sel ? '<div class="il-mom-schedright">' + scheduleRightPaneHTML(sel) + '</div>' : '') +
          '</div>'
        : (_schedFormOpen ? '' : '<p class="il-mom-note">No recurring meeting is defined yet — add one so the ' +
            'calendar can show its planned dates and the dashboard can report how often it is actually held.</p>')) +
    '</div>';
  }

  function scheduleRowHTML(s) {
    var next = schedNextOccurrence(s, momToday());
    var n = schedMeetingsOf(s.id).length;
    return '<button type="button" class="il-mom-schedrow' + (s.id === _schedSel ? ' active' : '') +
      '" data-sched="' + Fmt.esc(s.id) + '">' +
      '<span class="il-mom-schedrow-title">' + Fmt.esc(s.title) + '</span>' +
      '<span class="il-mom-schedrow-meta">' + Fmt.esc(schedFrequencyLabel(s)) + ' · ' + Fmt.esc(s.meeting_group || 'Internal') + '</span>' +
      '<span class="il-mom-schedrow-next">' + (next ? 'Next: ' + Fmt.esc(Fmt.date(next)) : 'No upcoming date') + ' · ' + n + ' held</span>' +
    '</button>';
  }

  function scheduleRightPaneHTML(s) {
    var next = schedNextOccurrence(s, momToday());
    var past = schedMeetingsOf(s.id);
    return '<div class="il-mom-schedright-head">' +
      '<div><b>' + Fmt.esc(s.title) + '</b><div class="il-mom-schedrow-meta">' + Fmt.esc(schedFrequencyLabel(s)) + '</div></div>' +
      '<div class="il-mom-schedright-acts">' +
        (canAdd ? '<button class="pd-btn pd-btn-sm" id="il-sched-edit">Edit</button>' : '') +
        (canAdd ? '<button class="pd-btn pd-btn-sm pd-btn-danger" id="il-sched-del">Delete…</button>' : '') +
        '<button class="pd-btn pd-btn-sm" id="il-sched-close" title="Close">' +
          '<span data-ico="x" data-ico-size="14"></span></button>' +
      '</div>' +
    '</div>' +
    (canAdd && !_schedOccOpen
      ? '<button class="pd-btn pd-btn-primary pd-btn-sm" id="il-sched-addocc">+ Add a meeting' +
          (next ? ' for ' + Fmt.esc(Fmt.date(next)) : '') + '</button>'
      : '') +
    (_schedOccOpen ? scheduleOccFormHTML(s) : '') +
    '<h5 class="il-mom-schedright-sub">Previously held</h5>' +
    (past.length
      ? '<div class="il-mom-schedpast">' + past.map(function (m) {
          return '<button type="button" class="il-mom-schedpasti" data-mom="' + Fmt.esc(m.id) + '">' +
            '<span>' + Fmt.esc(m.title || '(untitled)') + '</span>' +
            '<span class="il-mom-schedrow-meta">' + (m.meeting_date ? Fmt.esc(Fmt.date(m.meeting_date)) : '—') +
              (m.is_distributed ? '' : ' · Draft') + '</span>' +
          '</button>';
        }).join('') + '</div>'
      : '<p class="il-mom-note">No meeting has been recorded against this schedule yet.</p>');
  }

  // ⚠️ Re-rendered in place (into #il-sf-rulewrap) whenever the frequency
  // select changes, so the fields relevant to weekly/monthly/quarterly show
  // up without a full-form repaint that would drop other in-progress edits.
  function scheduleRuleFieldsHTML(s) {
    var freq = s.frequency || 'monthly_date';
    var wdOpts = function (cur) {
      return WEEKDAY_NAMES.map(function (n, i) {
        return '<option value="' + i + '"' + (cur === i ? ' selected' : '') + '>' + n + '</option>';
      }).join('');
    };
    if (freq === 'weekly') {
      return '<div class="pd-field" style="flex:1 1 140px;"><label>Weekday</label>' +
          '<select class="pd-select" id="il-sf-weekday">' + wdOpts(s.weekday == null ? 0 : s.weekday) + '</select></div>' +
        '<div class="pd-field" style="flex:1 1 140px;"><label>Every N week(s)</label>' +
          '<input class="pd-input" type="number" min="1" id="il-sf-interval" value="' + (s.interval_n || 1) + '"></div>';
    }
    if (freq === 'monthly_weekday') {
      return '<div class="pd-field" style="flex:1 1 140px;"><label>Which</label>' +
          '<select class="pd-select" id="il-sf-ordinal">' +
            [1, 2, 3, 4, -1].map(function (o) {
              return '<option value="' + o + '"' + ((s.week_ordinal == null ? 1 : s.week_ordinal) === o ? ' selected' : '') +
                '>' + ORDINAL_NAMES[String(o)] + '</option>';
            }).join('') +
          '</select></div>' +
        '<div class="pd-field" style="flex:1 1 140px;"><label>Weekday</label>' +
          '<select class="pd-select" id="il-sf-weekday">' + wdOpts(s.weekday == null ? 0 : s.weekday) + '</select></div>';
    }
    // 'monthly_date' or 'quarterly'
    return '<div class="pd-field" style="flex:1 1 140px;"><label>Day of month</label>' +
      '<input class="pd-input" type="number" min="1" max="31" id="il-sf-dom" value="' + (s.day_of_month || 1) + '"></div>';
  }

  function scheduleFormHTML(draft) {
    var s = draft || {};
    var isNew = !s.id;
    return '<div class="il-mom-schedform">' +
      '<div class="il-form-row">' +
        '<div class="pd-field" style="flex:2 1 200px;"><label>Title</label>' +
          '<input class="pd-input" id="il-sf-title" value="' + Fmt.esc(s.title || '') +
          '" placeholder="e.g. Monthly PSC Meeting"></div>' +
        '<div class="pd-field" style="flex:1 1 130px;"><label>Group</label>' +
          '<select class="pd-select" id="il-sf-group">' +
            ['Internal', 'External'].map(function (g) {
              return '<option' + ((s.meeting_group || 'Internal') === g ? ' selected' : '') + '>' + g + '</option>';
            }).join('') +
          '</select></div>' +
      '</div>' +
      '<div class="il-form-row">' +
        '<div class="pd-field" style="flex:1 1 220px;"><label>Frequency</label>' +
          '<select class="pd-select" id="il-sf-freq">' +
            FREQUENCIES.map(function (f) {
              return '<option value="' + f.key + '"' + ((s.frequency || 'monthly_date') === f.key ? ' selected' : '') +
                '>' + f.label + '</option>';
            }).join('') +
          '</select></div>' +
        '<div class="pd-field" style="flex:1 1 150px;"><label>Starts from</label>' +
          '<input class="pd-input" type="date" id="il-sf-start" value="' + dateVal(s.start_date || momToday()) + '"></div>' +
      '</div>' +
      '<div class="il-form-row" id="il-sf-rulewrap">' + scheduleRuleFieldsHTML(s) + '</div>' +
      '<div class="il-mom-schedform-acts">' +
        '<button class="pd-btn pd-btn-primary pd-btn-sm" id="il-sf-save">' + (isNew ? 'Create schedule' : 'Save schedule') + '</button>' +
        '<button class="pd-btn pd-btn-sm" id="il-sf-cancel">Cancel</button>' +
      '</div>' +
    '</div>';
  }

  // ⚠️ ITEM #22: "define date, optional and required attendees plus other
  // details which are copied from the last meeting by default." Every field
  // pre-fills from the schedule's most recent recorded occurrence (`last`)
  // and falls back to the schedule's own next expected date when there is
  // no prior occurrence to copy from — a brand-new schedule's first meeting.
  function scheduleOccFormHTML(s) {
    var last = schedMeetingsOf(s.id)[0];
    var next = schedNextOccurrence(s, momToday());
    // ⚠️ `_schedOccDraft.date` wins when set — the one path that sets it is a
    // click on a specific PLANNED chip in the calendar, which names an exact
    // day that may not be the schedule's bare "next" date if several of its
    // occurrences are visible on screen at once.
    var defDate = (_schedOccDraft && _schedOccDraft.date) || next || (last && last.meeting_date) || momToday();
    var defVenue = (last && last.venue) || '';
    var defLink = (last && last.meeting_link) || '';
    var reqIds = (last && last.attendees_required && last.attendees_required.ids) || [];
    var reqText = (last && last.attendees_required && last.attendees_required.text) || '';
    var optIds = (last && last.attendees_optional && last.attendees_optional.ids) || [];
    var optText = (last && last.attendees_optional && last.attendees_optional.text) || '';
    return '<div class="il-mom-occform">' +
      '<div class="il-form-row">' +
        '<div class="pd-field" style="flex:1 1 140px;"><label>Date</label>' +
          '<input class="pd-input" type="date" id="il-of-date" value="' + dateVal(defDate) + '"></div>' +
        '<div class="pd-field" style="flex:1 1 160px;"><label>Venue</label>' +
          '<input class="pd-input" id="il-of-venue" value="' + Fmt.esc(defVenue) + '"></div>' +
        '<div class="pd-field" style="flex:1 1 160px;"><label>Meeting link</label>' +
          '<input class="pd-input" id="il-of-link" value="' + Fmt.esc(defLink) + '"></div>' +
      '</div>' +
      '<div class="pd-field"><label>Required attendees</label>' + peoplePickerHTML('occ-req', reqIds, reqText, false) + '</div>' +
      '<div class="pd-field"><label>Optional attendees</label>' + peoplePickerHTML('occ-opt', optIds, optText, false) + '</div>' +
      '<div class="il-mom-schedform-acts">' +
        '<button class="pd-btn pd-btn-primary pd-btn-sm" id="il-of-create">Create this meeting</button>' +
        '<button class="pd-btn pd-btn-sm" id="il-of-cancel">Cancel</button>' +
      '</div>' +
    '</div>';
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
    // ⚠️ ITEM #19 — "show actual meeting dates or planned if date not yet
    // passed, depending on the defined meeting frequency." A planned
    // occurrence renders ONLY where no actual meeting under that SAME
    // schedule already sits on that day — a schedule that was kept exactly
    // on its expected date must not show two chips (one real, one phantom)
    // for the same session.
    var monthStart = _momCalMonth + '-01', monthEnd = _momCalMonth + '-' + String(daysInMonth).padStart(2, '0');
    var planned = {};
    schedActiveList().forEach(function (s) {
      schedDatesInRange(s, monthStart, monthEnd).forEach(function (iso) {
        var already = (byDay[iso] || []).some(function (x) { return x.schedule_id === s.id; });
        if (!already) (planned[iso] = planned[iso] || []).push(s);
      });
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
        (planned[iso] || []).map(function (s) {
          return '<button type="button" class="il-mom-calchip is-planned" data-plansched="' + Fmt.esc(s.id) +
            '" data-planiso="' + iso + '" title="Planned: ' + Fmt.esc(s.title) + '">' +
            Fmt.esc(clip(s.title, 20)) + '</button>';
        }).join('') +
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
    host.querySelectorAll('.il-mom-calchip[data-mom]').forEach(function (b) {
      b.onclick = function () { momOpenMeeting(b.dataset.mom); };
    });
    // A PLANNED chip has no meeting to open yet — it opens the schedule's
    // right pane with the "+ Add a meeting" form already showing, pre-dated
    // to the day that was clicked (overriding the form's own default of the
    // schedule's NEXT expected date, which may not be this exact day if
    // several occurrences are visible on one screen).
    host.querySelectorAll('.il-mom-calchip[data-plansched]').forEach(function (b) {
      b.onclick = function () {
        _schedSel = b.dataset.plansched; _schedOccOpen = true; _schedOccDraft = { date: b.dataset.planiso };
        renderBrowse();
        var panel = host.querySelector('.il-mom-schedpanel');
        if (panel) panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
      };
    });
    var prev = host.querySelector('#il-mom-calprev');
    if (prev) prev.onclick = function () { momCalShift(-1); renderBrowse(); };
    var next = host.querySelector('#il-mom-calnext');
    if (next) next.onclick = function () { momCalShift(1); renderBrowse(); };
    var today = host.querySelector('#il-mom-caltoday');
    if (today) today.onclick = function () { _momCalMonth = null; momCalInit(); renderBrowse(); };

    // ---- recurring schedules panel (items #19, #22) ------------------------
    var sn = host.querySelector('#il-sched-new');
    if (sn) sn.onclick = function () { _schedFormDraft = null; _schedFormOpen = true; renderBrowse(); };
    var sc = host.querySelector('#il-sf-cancel');
    if (sc) sc.onclick = function () { _schedFormOpen = false; _schedFormDraft = null; renderBrowse(); };
    var freqSel = host.querySelector('#il-sf-freq');
    if (freqSel) freqSel.onchange = function () {
      var wrap = host.querySelector('#il-sf-rulewrap');
      if (wrap) wrap.innerHTML = scheduleRuleFieldsHTML({ frequency: freqSel.value });
    };
    var sv = host.querySelector('#il-sf-save');
    if (sv) sv.onclick = scheduleFormSave;

    host.querySelectorAll('.il-mom-schedrow[data-sched]').forEach(function (b) {
      b.onclick = function () {
        _schedSel = (_schedSel === b.dataset.sched) ? null : b.dataset.sched;
        _schedOccOpen = false; _schedOccDraft = null;
        renderBrowse();
      };
    });
    var sclose = host.querySelector('#il-sched-close');
    if (sclose) sclose.onclick = function () { _schedSel = null; _schedOccOpen = false; renderBrowse(); };
    var sedit = host.querySelector('#il-sched-edit');
    if (sedit) sedit.onclick = function () {
      _schedFormDraft = SCHEDULES.find(function (x) { return x.id === _schedSel; });
      _schedFormOpen = true; renderBrowse();
    };
    var sdel = host.querySelector('#il-sched-del');
    if (sdel) sdel.onclick = function () { scheduleDelete(_schedSel); };
    var saddocc = host.querySelector('#il-sched-addocc');
    if (saddocc) saddocc.onclick = function () { _schedOccOpen = true; _schedOccDraft = null; renderBrowse(); };
    var socancel = host.querySelector('#il-of-cancel');
    if (socancel) socancel.onclick = function () { _schedOccOpen = false; _schedOccDraft = null; renderBrowse(); };
    var socreate = host.querySelector('#il-of-create');
    if (socreate) socreate.onclick = function () { scheduleCreateOccurrence(_schedSel); };
    wirePeople(host, null);   // the occurrence form's Required/Optional pickers
    host.querySelectorAll('.il-mom-schedpasti').forEach(function (b) {
      b.onclick = function () { momOpenMeeting(b.dataset.mom); };
    });
  }

  async function scheduleFormSave() {
    var host = $('il-mom-view'); if (!host) return;
    var g = function (id) { var e = host.querySelector('#' + id); return e ? e.value : ''; };
    var payload = {
      project_id: pid,
      title: g('il-sf-title').trim() || '(untitled schedule)',
      meeting_group: g('il-sf-group') || 'Internal',
      frequency: g('il-sf-freq') || 'monthly_date',
      start_date: g('il-sf-start') || momToday(),
      weekday: null, week_ordinal: null, day_of_month: null, interval_n: 1,
    };
    if (payload.frequency === 'weekly') {
      payload.weekday = +g('il-sf-weekday') || 0;
      payload.interval_n = Math.max(1, +g('il-sf-interval') || 1);
    } else if (payload.frequency === 'monthly_weekday') {
      payload.weekday = +g('il-sf-weekday') || 0;
      payload.week_ordinal = +g('il-sf-ordinal') || 1;
    } else {
      payload.day_of_month = Math.max(1, Math.min(31, +g('il-sf-dom') || 1));
    }
    var editing = _schedFormDraft && _schedFormDraft.id;
    try {
      if (editing) {
        var u = await sb().from('mom_schedules').update(payload).eq('id', editing);
        if (u.error) throw u.error;
        var s = SCHEDULES.find(function (x) { return x.id === editing; });
        if (s) Object.assign(s, payload);
        UI.toast('Schedule saved', 'ok');
      } else {
        payload.created_by = UID;
        var ins = await sb().from('mom_schedules').insert(payload).select().single();
        if (ins.error) throw ins.error;
        SCHEDULES.push(ins.data);
        SCHEDULES.sort(function (a, b) { return (a.title || '').localeCompare(b.title || ''); });
        _schedSel = ins.data.id;
        UI.toast('Schedule created', 'ok');
      }
      _schedFormOpen = false; _schedFormDraft = null;
      renderBrowse();
    } catch (e) {
      UI.toast(/relation|does not exist|schema cache/i.test(e.message || '')
        ? 'Run migrations/2026-09-01-mom-schedules-attendees-item-history.sql in Supabase first.' : e.message, 'error');
    }
  }

  async function scheduleDelete(id) {
    var s = SCHEDULES.find(function (x) { return x.id === id; });
    if (!s) return;
    var n = schedMeetingsOf(id).length;
    if (!confirm('Delete the schedule "' + (s.title || '') + '"?' +
      (n ? '\n\n' + n + ' recorded meeting(s) STAY — they simply stop pointing back at a recurring schedule.' : ''))) return;
    try {
      var dl = await sb().from('mom_schedules').delete().eq('id', id);
      if (dl.error) throw dl.error;
      SCHEDULES = SCHEDULES.filter(function (x) { return x.id !== id; });
      if (_schedSel === id) _schedSel = null;
      UI.toast('Schedule deleted', 'ok');
      renderBrowse();
    } catch (e) { UI.toast(e.message, 'error'); }
  }

  // ⚠️ Creates the meeting FIRST, then opens it in Detail before touching the
  // header-save/carry-over machinery — momSaveHeader() (which momCarryOver
  // always calls) reads its fields straight off the Detail form's DOM, which
  // does not exist until momOpenMeeting() has rendered it. Getting this order
  // backwards would resave the row with a blank "(untitled)" title (g() on a
  // missing element returns '', not the row's real value).
  async function scheduleCreateOccurrence(schedId) {
    var s = SCHEDULES.find(function (x) { return x.id === schedId; });
    if (!s) return;
    var host = $('il-mom-view');
    var dateEl = host.querySelector('#il-of-date'), venueEl = host.querySelector('#il-of-venue'),
        linkEl = host.querySelector('#il-of-link');
    var dateV = dateEl ? dateEl.value : '';
    if (!dateV) { UI.toast('Pick a date for this meeting.', 'warn'); return; }
    var reqRoot = host.querySelector('[data-people="occ-req"]'), optRoot = host.querySelector('[data-people="occ-opt"]');
    var reqIds = reqRoot ? idsOf(reqRoot) : [], reqText = reqRoot ? ((reqRoot.querySelector('.il-pp-free') || {}).value || '') : '';
    var optIds = optRoot ? idsOf(optRoot) : [], optText = optRoot ? ((optRoot.querySelector('.il-pp-free') || {}).value || '') : '';
    var last = schedMeetingsOf(schedId)[0];
    try {
      var ins = await sb().from('meeting_minutes').insert({
        project_id: pid, schedule_id: schedId, title: s.title,
        meeting_date: dateV, meeting_group: s.meeting_group || 'Internal',
        venue: venueEl ? (venueEl.value.trim() || null) : null,
        meeting_link: linkEl ? (linkEl.value.trim() || null) : null,
        attendees_required: { ids: reqIds, text: reqText },
        attendees_optional: { ids: optIds, text: optText },
        created_by: UID,
      }).select().single();
      if (ins.error) throw ins.error;
      MOMS.unshift(ins.data);
      _schedOccOpen = false; _schedOccDraft = null; _schedSel = null;
      momOpenMeeting(ins.data.id);   // renders Detail NOW — see the note above
      // ⚠️ ITEM #19 — "starts always from previous meeting minutes." Seeded
      // quietly with the register's own still-open issues (the same rule
      // "+ New minutes" already follows), THEN the immediately-preceding
      // occurrence of this schedule carries forward whatever is still open
      // on it — one deliberate reuse of the existing carry-over rules
      // (idempotent, register-decides-openness) rather than a second,
      // competing definition of "copy the previous minutes".
      try { await momPullIssues(ins.data.id, { quiet: true }); } catch (e) {}
      if (last) { try { await momCarryOver(last.id); } catch (e) {} }
      renderDetail();
    } catch (e) {
      UI.toast(/relation|does not exist|schema cache|column/i.test(e.message || '')
        ? 'Run migrations/2026-09-01-mom-schedules-attendees-item-history.sql in Supabase first.' : e.message, 'error');
    }
  }

  function momOpenMeeting(id) {
    // ⚠️ Opening a meeting always means "show me the Meetings tab" — a caller
    // on the Dashboard (item #18's action-items list) or the Meetings tab's
    // own schedules panel both land here, and render() checks `_momTab`
    // BEFORE `_momView`, so leaving this unset from the Dashboard would
    // silently redraw the dashboard instead of the meeting just opened.
    _momTab = 'meetings';
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
      _momItemWF = {}; _momItemHistOpen = {};   // leave no half-open workflow behind
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
      '</div>' +
      // ⚠️ ITEM #21 — the "Meeting type" DROPDOWN is now grouped Internal /
      // External ONLY (writes `meeting_group`). Which specific standing
      // meeting this is (PPR / PSC / Client…) is free TEXT now — "Meeting
      // description" — with the old vocabulary offered as suggestions via a
      // <datalist> rather than enforced as a closed list, per the owner's
      // explicit instruction that this belongs in the description, not the
      // dropdown. `meeting_type` is the same column as before; only what it
      // means to the form changed.
      '<div class="il-form-row">' +
        '<div class="pd-field" style="flex:1 1 130px;"><label>Group</label>' +
          '<select class="pd-select" id="il-mom-group"' + d + '>' +
            '<option value="Internal"' + ((mom.meeting_group || 'Internal') === 'Internal' ? ' selected' : '') + '>Internal</option>' +
            '<option value="External"' + (mom.meeting_group === 'External' ? ' selected' : '') + '>External</option>' +
          '</select></div>' +
        '<div class="pd-field" style="flex:1 1 220px;"><label>Meeting description</label>' +
          '<input class="pd-input" id="il-mom-type" list="il-mom-typelist" value="' + Fmt.esc(mom.meeting_type || '') +
          '" placeholder="e.g. PPR Meeting, PSC Meeting"' + d + '>' +
          '<datalist id="il-mom-typelist">' + momTypeDatalistOptions() + '</datalist></div>' +
        '<div class="pd-field" style="flex:1 1 160px;"><label>Venue</label>' +
          '<input class="pd-input" id="il-mom-venue" value="' + Fmt.esc(mom.venue || '') + '"' + d + '></div>' +
      '</div>' +
      '<div class="il-form-row">' +
        '<div class="pd-field" style="flex:1 1 200px;"><label>Meeting link</label>' +
          '<input class="pd-input" id="il-mom-link" value="' + Fmt.esc(mom.meeting_link || '') + '" placeholder="https://…"' + d + '></div>' +
        '<div class="pd-field" style="flex:1 1 200px;"><label>Recording</label>' +
          '<input class="pd-input" id="il-mom-rec" value="' + Fmt.esc(mom.recording_url || '') + '" placeholder="https://… (optional)"' + d + '></div>' +
      '</div>' +
      // ⚠️ ITEM #20 — three attendee tiers, each the same hybrid ids+text
      // People Picker used for Champion/Responsible elsewhere in this app.
      // The legacy free-text `attendees` column is read verbatim below when
      // NONE of the three structured columns has ever been filled in on this
      // minute — hiding it outright would silently disappear real attendee
      // data recorded before this feature existed.
      '<div class="il-form-row il-mom-attgrid">' +
        '<div class="pd-field" style="flex:1 1 220px;"><label>Required attendees</label>' +
          peoplePickerHTML('mom-att-req', mom.attendees_required && mom.attendees_required.ids,
            mom.attendees_required && mom.attendees_required.text, ro) + '</div>' +
        '<div class="pd-field" style="flex:1 1 220px;"><label>Optional attendees</label>' +
          peoplePickerHTML('mom-att-opt', mom.attendees_optional && mom.attendees_optional.ids,
            mom.attendees_optional && mom.attendees_optional.text, ro) + '</div>' +
        '<div class="pd-field" style="flex:1 1 220px;"><label>Actual attendees</label>' +
          peoplePickerHTML('mom-att-act', mom.attendees_actual && mom.attendees_actual.ids,
            mom.attendees_actual && mom.attendees_actual.text, ro) + '</div>' +
      '</div>' +
      (!mom.attendees_required && !mom.attendees_optional && !mom.attendees_actual && mom.attendees
        ? '<p class="il-mom-note">Legacy attendees, recorded before Required / Optional / Actual existed: ' +
          Fmt.esc(mom.attendees) + '</p>'
        : '') +
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

  // ==========================================================================
  // ITEM #23 — per-action-item audit history + Update/Put On Hold/Close,
  // mirroring the Issues & Concerns workflow (2026-08-31) at the level of one
  // mom_items row instead of one whole detail page. Gated to UNLINKED items
  // only (see momItemStatusCellHTML) — a LINKED item's status is the
  // register's, and this module never writes issues_lessons.
  // ==========================================================================
  var HISTORY_TABLE_ITEM = 'mom_items_history';
  var ITEM_HIST_LABELS = { create: 'Logged', update: 'Updated', hold: 'Put on hold', close: 'Closed' };

  // ⚠️ Best-effort and never awaited-into-failure: the real mom_items write
  // has already succeeded by the time this runs, and a missing migration or
  // a transient failure here must not make that read as an error to whoever
  // just saved. `reqMark` is reused from the Issues module's own naming, but
  // this file has its own copy (defined below) — see that function's comment.
  async function logItemHistory(itemId, projectId, action, beforeRow, note) {
    try {
      await sb().from(HISTORY_TABLE_ITEM).insert({
        item_id: itemId, project_id: projectId || pid, action: action, note: note || null,
        snapshot: beforeRow || null, changed_by: UID,
        changed_by_department: (profile && profile.department) || null,
      });
    } catch (e) { /* table not migrated yet, or a transient failure — silent */ }
    if (_momItemHistOpen[itemId]) loadItemHistory(itemId);
  }
  async function loadItemHistory(itemId) {
    try {
      var res = await sb().from(HISTORY_TABLE_ITEM).select('*').eq('item_id', itemId)
        .order('changed_at', { ascending: false }).limit(200);
      ITEM_HISTORY[itemId] = res.error ? [] : (res.data || []);
    } catch (e) { ITEM_HISTORY[itemId] = []; }
    if (_momSel && _momItemHistOpen[itemId]) renderDetail();
  }
  function itemHistoryHTML(itemId) {
    var list = ITEM_HISTORY[itemId];
    if (list === undefined) return '<p class="il-mom-note">Loading history…</p>';
    if (!list.length) {
      return '<p class="il-mom-note">No changes recorded yet — run <code>migrations/' +
        '2026-09-01-mom-schedules-attendees-item-history.sql</code> if this item has been updated ' +
        'and nothing appears here.</p>';
    }
    return '<ul class="il-history">' + list.map(function (h) {
      return '<li class="il-history-i"><div class="il-history-top">' +
        '<span class="il-history-action">' + Fmt.esc(ITEM_HIST_LABELS[h.action] || h.action) + '</span>' +
        '<span class="il-history-when">' + Fmt.esc(Fmt.date(h.changed_at)) +
          (h.changed_by_department ? ' · ' + Fmt.esc(h.changed_by_department) : '') + '</span></div>' +
        (h.note ? '<div class="il-history-note">' + Fmt.esc(h.note).replace(/\n/g, '<br>') + '</div>' : '') +
      '</li>';
    }).join('') + '</ul>';
  }
  // Small `*` beside a required field's label — same shape as the Issues
  // module's own reqMark(), duplicated here for the same reason the People
  // Picker and chart helpers are: two small IIFEs in two files, not a shared
  // runtime.
  function reqMark(editable) { return editable ? ' <span class="il-req" title="Required">*</span>' : ''; }

  // The status cell's whole control surface: a plain pill for a LINKED item
  // (register-owned, see the comment at its call site), or — for an unlinked
  // item — the pill plus Put On Hold / Close, or whichever reveal panel is
  // open. `ro` already folds in both "not mine to edit" and "minutes locked".
  function momItemStatusCellHTML(it, ro) {
    if (it.issue_id) {
      var iss = momIssueOf(it);
      var v = iss ? (iss.status || 'Open') : (it.status || 'Open');
      return '<span class="il-pill ' + statusClass(v) + '" title="Status follows the linked issue in Issues & Concerns">' +
        Fmt.esc(v) + '</span>';
    }
    var cur = it.status || 'Open';
    var wf = _momItemWF[it.id];
    if (ro || !wf) {
      var canHold = !ro && cur === 'Open', canClose = !ro && cur !== 'Closed';
      return '<span class="il-pill ' + statusClass(cur) + '">' + Fmt.esc(cur) + '</span>' +
        (ro ? '' : '<div class="il-mi-wfbtns">' +
          (canHold ? '<button class="pd-btn pd-btn-sm il-mi-wfstart" data-item="' + Fmt.esc(it.id) +
            '" data-wfstart="hold">Put On Hold</button>' : '') +
          (canClose ? '<button class="pd-btn pd-btn-sm il-mi-wfstart" data-item="' + Fmt.esc(it.id) +
            '" data-wfstart="close">Close</button>' : '') +
        '</div>');
    }
    if (wf.mode === 'hold') {
      return '<div class="il-workflow-panel il-mi-wfpanel">' +
        '<label>Reason for Hold' + reqMark(true) + '</label>' +
        '<textarea class="pd-textarea" rows="2" spellcheck="true" data-item="' + Fmt.esc(it.id) +
          '" data-wf="note" placeholder="Why is this on hold?">' + Fmt.esc(wf.note || '') + '</textarea>' +
        '<div class="il-workflow-acts">' +
          '<button class="pd-btn pd-btn-sm il-mi-wfcancel" data-item="' + Fmt.esc(it.id) + '">Cancel</button>' +
          '<button class="pd-btn pd-btn-primary pd-btn-sm il-mi-wfconfirm" data-item="' + Fmt.esc(it.id) +
            '" data-wfaction="hold">Confirm hold</button>' +
        '</div></div>';
    }
    // wf.mode === 'close' — ⚠️ ITEM #23: a closure narrative is required, a
    // lesson is NOT — unlike closing an Issue (item #13), which always
    // records one. If a lesson IS typed here it is pushed straight into
    // `lessons_learned`, linked via `mom_item_id`, exactly the same table
    // "+ Capture lesson" already writes to elsewhere on this card.
    return '<div class="il-workflow-panel il-mi-wfpanel">' +
      '<label>Closure note' + reqMark(true) + '</label>' +
      '<textarea class="pd-textarea" rows="2" spellcheck="true" data-item="' + Fmt.esc(it.id) +
        '" data-wf="report" placeholder="How was this resolved?">' + Fmt.esc(wf.report || '') + '</textarea>' +
      '<label>Lessons learned <span style="font-weight:400;color:var(--pd-muted);">' +
        '(optional — pushed to the Lessons Learned report if filled in)</span></label>' +
      '<textarea class="pd-textarea" rows="2" spellcheck="true" data-item="' + Fmt.esc(it.id) +
        '" data-wf="lesson" placeholder="What did the team learn? (optional)">' + Fmt.esc(wf.lesson || '') + '</textarea>' +
      '<div class="il-workflow-acts">' +
        '<button class="pd-btn pd-btn-sm il-mi-wfcancel" data-item="' + Fmt.esc(it.id) + '">Cancel</button>' +
        '<button class="pd-btn pd-btn-primary pd-btn-sm il-mi-wfconfirm" data-item="' + Fmt.esc(it.id) +
          '" data-wfaction="close">Confirm close</button>' +
      '</div></div>';
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
      // ⚠️ ITEM #23 — the free status <select> is gone. An UNLINKED item now
      // carries its own Update/Put On Hold/Close workflow (mirroring items
      // #10–13 in Issues & Concerns, and its history table); a LINKED item's
      // status is still shown as a plain pill reading the REGISTER's live
      // value — the same rule the PDF already follows — since editing
      // `mom_items.status` there would change a field nothing displays.
      momFieldHTML('Status', 'il-c-status', momItemStatusCellHTML(it, ro),
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
      // ⚠️ ITEM #23 — the hold reason / closure note stays visible on the card
      // once the workflow panel that captured it has closed, read-only, the
      // same way it is recorded in the history below. Read-only ALWAYS (not
      // gated on `ro`): re-editing a settled narrative belongs to a fresh
      // Put On Hold / Close, not to typing over the last one.
      (!it.issue_id && it.status === 'On Hold' && it.hold_reason
        ? momFieldHTML('Reason for Hold', 'il-c-holdnote',
            '<div class="il-mi-val">' + Fmt.esc(it.hold_reason).replace(/\n/g, '<br>') + '</div>', it.hold_reason)
        : '') +
      (!it.issue_id && it.status === 'Closed' && it.closure_report
        ? momFieldHTML('Closure note', 'il-c-closenote',
            '<div class="il-mi-val">' + Fmt.esc(it.closure_report).replace(/\n/g, '<br>') + '</div>', it.closure_report)
        : '') +
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
      // ⚠️ ITEM #23 — "all items must have an updates history", so this is
      // offered on EVERY item, linked or not (only the status workflow above
      // is unlinked-only). Loaded lazily on first open, not with the rest of
      // the minute — most cards on most days are never inspected for history.
      '<div class="il-mi-f il-c-hist"><label>History</label>' +
        '<button class="pd-btn pd-btn-sm il-mi-histbtn" data-item="' + Fmt.esc(it.id) + '">' +
          (_momItemHistOpen[it.id] ? 'Hide' : 'Show') + '</button></div>' +
      (ro ? '' : '<div class="il-mi-f il-c-del"><button class="pd-btn pd-btn-sm pd-btn-danger il-mi-del" title="Remove this action">Remove</button></div>') +
      '</div>' +
      (_momItemHistOpen[it.id] ? '<div class="il-mi-hist">' + itemHistoryHTML(it.id) + '</div>' : '') +
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
  // The three attendee tiers, read straight off their picker's DOM — same
  // pattern as reading il-mom-title etc., since the whole header (structured
  // attendees included) is saved together by one "Save minutes" click.
  // ⚠️ Returns null, not an empty {ids:[],text:''} object, when nothing was
  // entered — a stored null reads honestly as "not recorded" (what the
  // dashboard's attendance battery and the legacy-attendees fallback note
  // both test for), where an empty object would read as "zero attendees".
  function momAttendeesOf(key) {
    var root = document.querySelector('[data-people="' + key + '"]');
    if (!root) return undefined;   // the field wasn't rendered at all (e.g. read-only)
    var ids = idsOf(root), text = (root.querySelector('.il-pp-free') || {}).value || '';
    return (ids.length || text.trim()) ? { ids: ids, text: text.trim() } : null;
  }

  async function momSaveHeader() {
    var mom = MOMS.find(function (x) { return x.id === _momSel; });
    if (!mom || !canEditMinute(mom)) return false;
    var g = function (id) { var e = $(id); return e ? e.value : ''; };
    var payload = {
      title: g('il-mom-title').trim() || '(untitled)',
      meeting_date: g('il-mom-date') || null,
      location: g('il-mom-loc').trim() || null,
      meeting_type: g('il-mom-type').trim() || null,
      meeting_group: g('il-mom-group') || 'Internal',
      venue: g('il-mom-venue').trim() || null,
      meeting_link: g('il-mom-link').trim() || null,
      recording_url: g('il-mom-rec').trim() || null,
      notes: g('il-mom-notes').trim() || null,
      schedule_activity_id: g('il-mom-act').trim() || null,
    };
    // ⚠️ `undefined` (the field was not rendered — a read-only view) leaves
    // the column untouched rather than blanking a value nobody had a chance
    // to edit; `null` (rendered, left empty) is a real "nothing entered".
    var req = momAttendeesOf('mom-att-req'), opt = momAttendeesOf('mom-att-opt'), act = momAttendeesOf('mom-att-act');
    if (req !== undefined) payload.attendees_required = req;
    if (opt !== undefined) payload.attendees_optional = opt;
    if (act !== undefined) payload.attendees_actual = act;
    try {
      var u = await sb().from('meeting_minutes').update(payload).eq('id', mom.id);
      if (u.error) throw u.error;
      Object.assign(mom, payload);
      return true;
    } catch (e) {
      // ⚠️ Tolerant of the un-run 2026-09-01 migration — the same "drop the
      // columns it added and retry" pattern this app uses elsewhere, since
      // all of these columns come from that one file: a live database
      // either has all of them or none of them, never some.
      if (/column|schema cache/i.test(e.message || '')) {
        var stripped = Object.assign({}, payload);
        ['meeting_group', 'venue', 'meeting_link', 'recording_url',
         'attendees_required', 'attendees_optional', 'attendees_actual'].forEach(function (k) { delete stripped[k]; });
        try {
          var u2 = await sb().from('meeting_minutes').update(stripped).eq('id', mom.id);
          if (u2.error) throw u2.error;
          Object.assign(mom, stripped);
          UI.toast('Saved — Group/Venue/Link/Recording/Attendees need ' +
            'migrations/2026-09-01-mom-schedules-attendees-item-history.sql', 'warn');
          return true;
        } catch (e2) { UI.toast(e2.message || e2, 'error'); return false; }
      }
      UI.toast(e.message, 'error'); return false;
    }
  }

  // Action-item edits save on change, one field at a time — a planner typing into a
  // table expects it to stick, and a single Save that silently covers the header AND
  // every row is how a half-typed action gets written.
  // ⚠️ ITEM #23: EVERY save through here is logged — `histAction`/`histNote`
  // default to a plain 'update' with no note (an ordinary field edit); the
  // Put On Hold / Close confirm handlers below pass 'hold'/'close' plus the
  // narrative typed into the reveal panel, so the history reads as a story
  // rather than a diff.
  async function momSaveItem(id, patch, histAction, histNote) {
    // ⚠️ The action item has no owner of its own — it belongs to its minute, so the
    // question is whether that MINUTE is mine. Same derivation as the policy.
    var it0 = MOM_ITEMS.find(function (x) { return x.id === id; });
    if (!it0 || !canEditMinute(MOMS.find(function (m) { return m.id === it0.mom_id; }))) return false;
    var before = Object.assign({}, it0);   // snapshot BEFORE mutating — for the history row
    try {
      var u = await sb().from('mom_items').update(patch).eq('id', id);
      if (u.error) throw u.error;
      var it = MOM_ITEMS.find(function (x) { return x.id === id; });
      if (it) Object.assign(it, patch);
      logItemHistory(id, it0.project_id || pid, histAction || 'update', before, histNote || null);
      return true;
    } catch (e) { UI.toast(e.message, 'error'); return false; }
  }

  // ⚠️ ITEM #23: Put On Hold requires a reason (mirroring the Issues module's
  // confirmHoldIssue); Close requires a closure NOTE but a lesson is
  // optional — the one deliberate difference from closing an Issue (item
  // #13), which always records one. If a lesson IS typed, it is pushed
  // straight into `lessons_learned`, linked back via `mom_item_id`, exactly
  // the same table "+ Capture lesson" already writes into on this same card.
  async function momItemWorkflowConfirm(itemId, action) {
    var wf = _momItemWF[itemId]; if (!wf) return;
    var it = MOM_ITEMS.find(function (x) { return x.id === itemId; });
    if (!it) return;
    var mom = MOMS.find(function (m) { return m.id === it.mom_id; });
    if (!mom || !canEditMinute(mom) || momLocked(mom)) return;
    if (action === 'hold') {
      var note = (wf.note || '').trim();
      if (!note) { UI.toast('A reason for the hold is required.', 'warn'); return; }
      var okH = await momSaveItem(itemId, { status: 'On Hold', hold_reason: note }, 'hold', note);
      if (okH) { delete _momItemWF[itemId]; UI.toast('Action put on hold', 'ok'); renderDetail(); }
      return;
    }
    var report = (wf.report || '').trim(), lesson = (wf.lesson || '').trim();
    if (!report) { UI.toast('A closure note is required.', 'warn'); return; }
    var okC = await momSaveItem(itemId, { status: 'Closed', closure_report: report }, 'close', report);
    if (!okC) return;
    if (lesson) {
      try {
        var lrow = {
          project_id: pid, mom_id: it.mom_id, mom_item_id: itemId,
          department: (profile && profile.department) || null, category: null,
          lesson: lesson, recommendation: null, date_captured: momToday(), created_by: UID,
        };
        var lins = await sb().from('lessons_learned').insert(lrow).select().single();
        if (!lins.error) LESSONS.unshift(lins.data);
        else UI.toast('Action closed, but the lesson could not be saved: ' + lins.error.message, 'warn');
      } catch (e2) { UI.toast('Action closed, but the lesson could not be saved: ' + (e2.message || ''), 'warn'); }
    }
    delete _momItemWF[itemId];
    UI.toast('Action closed' + (lesson ? ' — lesson pushed to the Lessons Learned report' : ''), 'ok');
    renderDetail();
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
          // ⚠️ ITEM #23 — the same narrative the screen keeps visible after
          // the workflow panel that captured it has closed.
          (!it.issue_id && it.status === 'On Hold' && it.hold_reason ? momPdfField('Reason for Hold', it.hold_reason) : '') +
          (!it.issue_id && it.status === 'Closed' && it.closure_report ? momPdfField('Closure note', it.closure_report) : '') +
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
      // ⚠️ ITEM #20 — the STRUCTURED attendee tiers print when any of them has
      // been filled in; the old free-text `attendees` column is the fallback
      // for a minute recorded before they existed, never printed alongside
      // them (that would show the same names twice under two headings).
      if (mom.attendees_required || mom.attendees_optional || mom.attendees_actual) {
        if (mom.attendees_required) head += momPdfField('Required attendees', championText(mom.attendees_required.ids, mom.attendees_required.text));
        if (mom.attendees_optional) head += momPdfField('Optional attendees', championText(mom.attendees_optional.ids, mom.attendees_optional.text));
        if (mom.attendees_actual) head += momPdfField('Actual attendees', championText(mom.attendees_actual.ids, mom.attendees_actual.text));
      } else if (mom.attendees) {
        head += momPdfField('Attendees', mom.attendees);
      }
      // ⚠️ ITEM #21 — the group (Internal/External) and the free-text
      // description print together, since neither alone is what the old
      // single "Meeting type" line used to say.
      if (mom.meeting_group || mom.meeting_type) {
        head += momPdfField('Meeting', [mom.meeting_group, mom.meeting_type].filter(Boolean).join(' — '));
      }
      if (mom.venue) head += momPdfField('Venue', mom.venue);
      if (mom.meeting_link) head += momPdfField('Meeting link', mom.meeting_link);
      if (mom.recording_url) head += momPdfField('Recording', mom.recording_url);
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
        MOM_ITEMS.push(ins.data);
        logItemHistory(ins.data.id, pid, 'create', null, null);
        renderDetail();
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

    // ---- item #23: per-item Put On Hold / Close workflow -------------------
    host.querySelectorAll('.il-mi-wfstart').forEach(function (b) {
      b.onclick = function () {
        _momItemWF[b.dataset.item] = { mode: b.dataset.wfstart, note: '', report: '', lesson: '' };
        renderDetail();
      };
    });
    host.querySelectorAll('.il-mi-wfcancel').forEach(function (b) {
      b.onclick = function () { delete _momItemWF[b.dataset.item]; renderDetail(); };
    });
    // ⚠️ Kept in the draft object on every keystroke (not read fresh at
    // confirm time), the same reason the Issues module tracks `_issCloseDraft`
    // — a re-render mid-typing (a live-collaboration update, another row's
    // interaction) must not throw away a half-written narrative.
    host.querySelectorAll('.il-mi-wfpanel textarea[data-wf]').forEach(function (t) {
      t.oninput = function () {
        var wf = _momItemWF[t.dataset.item]; if (!wf) return;
        wf[t.dataset.wf] = t.value;
      };
    });
    host.querySelectorAll('.il-mi-wfconfirm').forEach(function (b) {
      b.onclick = function () { momItemWorkflowConfirm(b.dataset.item, b.dataset.wfaction); };
    });
    host.querySelectorAll('.il-mi-histbtn').forEach(function (b) {
      b.onclick = function () {
        var id = b.dataset.item;
        _momItemHistOpen[id] = !_momItemHistOpen[id];
        if (_momItemHistOpen[id] && ITEM_HISTORY[id] === undefined) loadItemHistory(id);
        renderDetail();
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
