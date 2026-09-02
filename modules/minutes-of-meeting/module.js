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

  // One status vocabulary, shared with the register by the 2026-08-22 migration —
  // do not reintroduce a MoM-only list; the CHECK on mom_items refuses anything else.
  var STATUSES = ['Open', 'On Hold', 'Closed'];
  // ⚠️ Mirrors the `mom_items_type_chk` CHECK (migrations/2026-08-21-mom-schema-
  // carryover-distribute.sql). A value outside this list is refused by the
  // database, so the control is a <select>, never free text.
  var MOM_TYPES = ['Issue', 'FYI', 'Report'];
  // ⚠️ DEPARTMENT REPLACES CATEGORY ON A MINUTE (2026-09-02, owner: "instead of
  // category, use department and get department dropdown from issues"). This is
  // the SAME 11-value list `modules/issues-lessons/module.js` offers — copied
  // verbatim rather than read across, for the same reason the People Picker and
  // the chart helpers are duplicated here: two small IIFEs in two files, no
  // shared runtime between them.
  // ⚠️ KEEP THIS LIST IDENTICAL TO the register's `DEPARTMENTS` (and to
  // admin.html's own copy, which drives the per-user Department column). A
  // minute pulled in from an issue copies that issue's department straight
  // across, so a value this list lacks would read as off-list on arrival — the
  // exact drift that made mom-app's own two category dropdowns disagree.
  var DEPARTMENTS = ['Commercial and Contracts', 'Engineering', 'Procurement', 'Finance',
                     'Human Resources', 'Quality', 'Health and Safety', 'Operations',
                     'PMO', 'COO', 'CEO'];
  // ⚠️ mom-app's own `category` list is GONE from this file (item 5,
  // 2026-09-02): a minute is filed by DEPARTMENT now. The COLUMN is deliberately
  // NOT dropped and is never blanked — momItemDept() falls back to it and
  // momUsedDepartments() offers whatever a project already stored, so a minute
  // recorded before this change keeps reading correctly and can round-trip
  // through the select instead of silently reporting the first option.
  // A starting vocabulary, NOT a closed list — meeting_type carries no CHECK, so
  // whatever a project actually uses joins it through momOptions().
  var MOM_MEETING_TYPES = ['PPR Meeting', 'PSC Meeting', 'Client Meeting'];

  // ⚠️ SESSION-ONLY, never persisted. Reporting view is how the record is being
  // LOOKED AT right now, not a property of the minute.
  var _momReport = false;
  // ⚠️ ITEM 12 — which slide the reporting deck is on. Session-only, like
  // _momReport itself: it is where the presenter has got to right now, not a
  // property of the minute, and it resets whenever the deck changes shape.
  var _momSlide = 0;
  var _momF = { q: '', cat: '', type: '', status: '' };   // per-minute filters (Detail)
  var _momQ = '';                                          // meeting search (Browse)
  // Item 10 (2026-09-02): "add filter options and combine search bar to filter
  // grouping. filter group should be hidden/shown by a button." So the search
  // box is no longer a permanent control in the browse bar — it lives INSIDE
  // the filter group with the rest, and the group is behind one toggle.
  // ⚠️ Collapsed ≠ inactive: `momBrowseFilterOn()` puts a dot on the toggle
  // and the count line stays on screen, so a filter narrowing the list can
  // never be invisible — the same rule the Issues & Concerns filter toggle
  // already follows (its own history records why: a hidden active filter is
  // how a planner concludes their meetings have gone missing).
  var _momFiltOpen = false;
  var _momBrowseF = { kind: '', state: '', fav: false, group: '' };
  // ⚠️ 'list' | 'calendar' | 'detail' | 'series'. Meetings are BROWSED (list or
  // calendar); a single one is OPEN (detail); a recurring SERIES is open on its
  // own page (series — its definition + the meetings actually held under it).
  // "Back to meetings" returns to whichever browse mode was last active —
  // `_momBrowsePrev` is only ever set from list/calendar, never from detail or
  // series, so it can't collapse to either of those itself.
  var _momView = 'list', _momBrowsePrev = 'list';
  var _momSel = null;
  // Which series a currently-open MEETING was reached from, if any — set only
  // when a meeting is opened by clicking a row inside that series' own page
  // (momOpenSeries → the "Previously held" list), so "← Back" from the meeting
  // returns to the series page rather than to the flat list/calendar it would
  // otherwise fall back to.
  var _momCameFromSeries = null;
  var _momCalMonth = null;      // 'YYYY-MM' — the month the calendar view shows
  // 'month' | 'week' — which grid the Calendar sub-view renders.
  var _momCalMode = 'month';
  var _momWeekStart = null;     // 'YYYY-MM-DD' (a Monday) — the week the Week grid shows
  var _momSort = { col: 'date', dir: 'desc' };   // List view column sort


  // ⚠️ THE "ADD MEETING" MODAL — replaces the old one-click "+ New minutes"
  // (which inserted an almost-blank row and let you fill it in afterwards).
  // The rehaul asks the planner for the whole shape of the meeting up front —
  // title / date / start+end time / required+optional attendees / venue / link
  // / an addable AGENDA list / a recurring tag (which swaps the date for a
  // frequency + start/end date) / a favorite tag — so `_addDraft` holds all of
  // that in memory before anything is written. See addMeetingModalHTML/
  // saveAddMeeting below.
  var _addOpen = false, _addDraft = null;

  // Top-level tabs: 'meetings' | 'dashboard'.
  // ⚠️ MEETINGS IS FIRST AND IS THE LANDING TAB (2026-09-02, owner: "for
  // meetings module, meetings should be first over dashboard"). This
  // deliberately breaks step with Issues & Concerns, which lands on its
  // dashboard — the difference is that this module's primary act is
  // RECORDING a meeting, not reading a roll-up of them, so a planner opening
  // it is far more often here to write than to review. The tab strip's own
  // order in index.html matches, since a strip whose first entry is not where
  // the module opens reads as a bug.
  var _momTab = 'meetings';

  // ==========================================================================
  // RECURRING MEETING SCHEDULES (items #19, #22) — see the block above init()
  // for the occurrence math (schedDatesInRange / schedNextOccurrence / …).
  // ==========================================================================
  var SCHEDULES = [];
  // ⚠️ REHAUL (2026-09-02): a recurring series is no longer browsed from a
  // side panel above the meetings list — it is a ROW in the unified Meetings
  // list (see momUnifiedRows below), and clicking it opens a full SERIES PAGE
  // (`_momView === 'series'`, `_seriesSel` = the schedule id): the series'
  // own definition, above a list of every meeting actually held under it —
  // clicking one of THOSE opens the normal single-meeting Detail view. A
  // series is created from the Add Meeting modal's "Recurring" tag now, so
  // `_schedFormOpen`/`_schedFormDraft` below serve EDITING an existing series
  // from its own page only, never creation.
  var _seriesSel = null;
  var _schedFormOpen = false, _schedFormDraft = null;      // edit a SCHEDULE, from its page
  var _schedOccOpen = false, _schedOccDraft = null;        // "+ Add a meeting" for it

  // ⚠️ ITEM #23 — per-action-item hold/close, mirroring the Issues workflow
  // (2026-08-31). Keyed by item id, unlike Issues' single `_issHoldOpen` /
  // `_issCloseOpen`, because SEVERAL action-item cards are on screen at once
  // here — one flag each would collide across rows.
  var _momItemWF = {};          // itemId -> {mode:'hold'|'close', note, report, lesson}
  var ITEM_HISTORY = {};        // itemId -> [] once loaded, for the "History" reveal

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
  // ⚠️ `meterHTML` was removed with the dashboard tiles that used it (item 13).
  // `donutChartSVG` / `barChartSVG` / `CHART_COLORS` stay — the rebuilt
  // dashboard's four charts read all three.

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
  // ⚠️ THE INVERSE OF championText — see issues-lessons/module.js's copy of this same
  // helper for the full rationale. `owner` on a saved action item is already
  // `championText(owner_ids, extra)`; seeding the free-text box with that whole string
  // (instead of just the typed extra) makes every "Update" re-prepend the resolved names
  // onto an already-name-bearing string — the reported champion-concatenation bug,
  // copy-pasted here for the Responsible picker. Strips any segment matching a
  // currently-resolved name for `ids`, order-independent, keeping the genuine extra.
  function championExtra(ids, champion) {
    var named = {};
    peopleNamesOf(ids).forEach(function (n) { named[n] = 1; });
    return (champion || '').split(';')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s && !named[s]; })
      .join('; ');
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
      if (_momF.cat && momItemDept(it) !== _momF.cat) return false;
      if (_momF.type && (it.type || '') !== _momF.type) return false;
      if (_momF.status && momItemStatus(it) !== _momF.status) return false;
      if (!q) return true;
      return [it.item_no, momItemDept(it), it.issue, it.description, it.action_item, it.owner]
        .join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function momStatusFilterOpts() { return STATUSES.slice(); }

  function momReset() {
    MOMS = []; MOM_ITEMS = []; ISSUES = []; LESSONS = []; SCHEDULES = [];
    _momSel = null; _momErr = ''; _momLoaded = false;
    _momQ = ''; _momF = { q: '', cat: '', type: '', status: '' };
    _momView = 'list'; _momBrowsePrev = 'list'; _momTab = 'meetings';
    _momCameFromSeries = null; _momCalMode = 'month'; _momWeekStart = null;
    _addOpen = false; _addDraft = null;
    _seriesSel = null; _schedFormOpen = false; _schedFormDraft = null;
    _schedOccOpen = false; _schedOccDraft = null;
    _momItemWF = {}; ITEM_HISTORY = {};
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
      get: function () { return { t: _momTab, v: _momView, m: _momSel, s: _seriesSel, f: _momCameFromSeries }; },
      apply: function (state) {
        _momTab = state.t || 'meetings';
        _momView = state.v || 'list'; _momSel = state.m || null; _seriesSel = state.s || null;
        _momCameFromSeries = state.f || null;
        if (_momView === 'detail' && !_momSel) _momView = _momBrowsePrev || 'list';
        if (_momView === 'series' && !_seriesSel) _momView = _momBrowsePrev || 'list';
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
    // ⚠️ REHAUL ITEM 1 — the Dashboard/Meetings tab strip lives in the topbar
    // (index.html), outside #il-mom-view, so it is wired ONCE here rather
    // than in wireBrowse()/wireDetail(), which re-run on every repaint of
    // the content below it.
    document.querySelectorAll('.il-tabs [data-tab]').forEach(function (b) {
      b.onclick = function () { _momTab = b.dataset.tab; render(); if (histView) histView.push(); };
    });
    // ⚠️ "meetings is pressed, no need for the meeting label — have a dropdown
    // with 2 choices." UI.tabsToDropdown() is the shared component every other
    // module with this exact shape already uses (Progress Photos, Issues &
    // Concerns) — it converts the two real (now-hidden) buttons above into one
    // trigger that names the active choice, and it is what makes the static
    // module title text disappear (via its own `.pd-title-hasdrop` class, only
    // where dashboard.css says there is room for it to matter) — never an
    // unconditional JS hide, which this app's own history has twice recorded
    // as reintroducing an "icon alone / label on the next line" defect on
    // narrow screens.
    if (window.UI && UI.tabsToDropdown) UI.tabsToDropdown('.il-tabs');
    // Icon-only List/Calendar view toggle, top-right in the topbar tools —
    // lives in index.html's markup (outside #il-mom-view like the tabs above)
    // so it is wired once here too; only meaningful once inside Meetings, so
    // it hides itself on the Dashboard tab via syncTopTabs().
    document.querySelectorAll('#il-viewtoggle [data-mv]').forEach(function (b) {
      b.onclick = function () { _momView = b.dataset.mv; _momTab = 'meetings'; render(); if (histView) histView.push(); };
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
    // The List/Calendar icon toggle only means anything inside Meetings, and
    // only while actually browsing (not while a single meeting/series is
    // open, where "which browse view" isn't a live choice on screen).
    var vt = $('il-viewtoggle');
    if (vt) {
      var showing = _momTab === 'meetings' && (_momView === 'list' || _momView === 'calendar');
      vt.hidden = !showing;
      vt.querySelectorAll('[data-mv]').forEach(function (b) {
        b.classList.toggle('on', b.dataset.mv === _momView);
      });
    }
  }
  function render() {
    if (!pid) { _paintEmpty('Select a project to see its minutes.'); return; }
    if (!_momLoaded) { _paintEmpty('Loading minutes…'); return; }
    syncTopTabs();
    if (_momTab === 'dashboard') renderMomDashboard();
    else if (_momView === 'detail' && _momSel) renderDetail();
    else if (_momView === 'series' && _seriesSel) renderSeriesPage();
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
  // ⚠️ `attendeeCount` is all that survives the pre-item-13 dashboard: the
  // unified meetings list reads it for its attendee column. The tiles it used
  // to sit beside — momLastHeldDate / momAttendanceBattery / momOpenMinutesStat
  // / momOnScheduleStats / momAllOpenItems / momItemsDashListHTML — are all
  // deleted, per item 13's "remove all".
  function attendeeCount(obj) {
    if (!obj) return null;
    var ids = (obj.ids || []).length;
    var extra = (obj.text || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).length;
    return ids + extra;
  }
  // ==========================================================================
  // ITEM 13 (2026-09-02) — THE MEETINGS DASHBOARD, REBUILT.
  // "remove all and simply copy similar to Issues dashboard. minutes by status,
  //  minutes by department, minutes by responsible. then have a summary of the
  //  minutes list, group by meeting. then add one more chart, minutes per
  //  meeting. no other tiles needed. also have options to filter starred
  //  meetings only, and to filter meetings one by one via a multi select
  //  dropdown."
  // ⚠️ EVERYTHING the old dashboard carried is gone on purpose — the frequency
  // list, the attendance battery, the open-minutes meter and the
  // conducted-as-scheduled donut. They answered "how well is the cadence
  // holding", a different question from "what is on the minutes", and the
  // instruction was explicit. `momAttendanceBattery`/`momOpenMinutesStat`/
  // `momOnScheduleStats` go with them; `schedFrequencyLabel` stays because the
  // series page still reads it.
  // ⚠️ These charts count EVERY minute, not only the open ones — "Minutes by
  // Status" is meaningless if Closed is filtered out before it is charted.
  // ==========================================================================
  var _momDashF = { starred: false, meetings: [], pickOpen: false };

  // Every meeting a minute could belong to, newest first — the multi-select's
  // own option set, and the grouping order of the summary below it.
  function momDashMeetings() {
    return MOMS.slice().sort(function (a, b) {
      return String(b.meeting_date || '').localeCompare(String(a.meeting_date || ''));
    });
  }
  // ⚠️ A series is starred on `mom_schedules`, an occurrence on its own row, so
  // "starred meetings only" has to accept EITHER — otherwise starring a
  // recurring meeting would filter its own occurrences out of the dashboard.
  function momDashStarred(m) {
    if (m.is_favorite) return true;
    if (!m.schedule_id) return false;
    var sc = SCHEDULES.find(function (x) { return x.id === m.schedule_id; });
    return !!(sc && sc.is_favorite);
  }
  function momDashMeetingIds() {
    var sel = _momDashF.meetings;
    return momDashMeetings().filter(function (m) {
      if (_momDashF.starred && !momDashStarred(m)) return false;
      // ⚠️ An EMPTY selection means every meeting, never none. A dashboard that
      // reads as empty until you tick something looks broken, and "I have not
      // narrowed this yet" is the state people land on.
      if (sel.length && sel.indexOf(m.id) < 0) return false;
      return true;
    }).map(function (m) { return m.id; });
  }
  function momDashItems() {
    var ids = {}; momDashMeetingIds().forEach(function (id) { ids[id] = 1; });
    return MOM_ITEMS.filter(function (it) { return ids[it.mom_id]; });
  }
  function momDashFilterOn() { return _momDashF.starred || _momDashF.meetings.length > 0; }

  function momDashBarsFrom(items, keyFn, blank) {
    var by = {};
    items.forEach(function (it) { var k = keyFn(it) || blank; by[k] = (by[k] || 0) + 1; });
    return Object.keys(by).sort(function (a, b) { return by[b] - by[a]; })
      .map(function (k, i) { return { label: k, value: by[k], color: CHART_COLORS[i % CHART_COLORS.length] }; });
  }
  function momDashDonutCard(title, slices, aria) {
    return '<div class="pd-card il-dash-card"><h4>' + Fmt.esc(title) + '</h4>' +
      (slices.length
        ? '<div class="il-dash-chartwrap">' + donutChartSVG(slices, { aria: aria }) +
          '<div class="il-dash-legend">' + slices.map(function (s) {
            return '<span class="il-dash-legend-i"><i style="background:' + s.color + '"></i>' +
              Fmt.esc(s.label) + ' (' + s.value + ')</span>';
          }).join('') + '</div></div>'
        : '<div class="il-empty" style="padding:16px;">Nothing to chart yet.</div>') +
    '</div>';
  }

  function momDashFilterHTML() {
    var all = momDashMeetings();
    var sel = _momDashF.meetings;
    var label = sel.length
      ? (sel.length === 1
          ? (function () { var m = MOMS.find(function (x) { return x.id === sel[0]; });
             return m ? clip(m.title || '(untitled)', 32) : '1 meeting'; })()
          : sel.length + ' meetings')
      : 'All meetings';
    return '<div class="il-mom-dashfilt">' +
      '<span class="il-filt-ico" data-ico="filter" data-ico-size="15"></span>' +
      '<label class="il-mom-favfilt"><input type="checkbox" id="il-momd-star"' +
        (_momDashF.starred ? ' checked' : '') + '> Starred meetings only</label>' +
      '<div class="il-mom-msel">' +
        '<button type="button" class="pd-btn pd-btn-sm' + (_momDashF.pickOpen ? ' is-active' : '') +
          '" id="il-momd-pick">' + Fmt.esc(label) + ' &#9662;</button>' +
        (_momDashF.pickOpen
          ? '<div class="il-mom-mselpanel">' +
              (all.length
                ? all.map(function (m) {
                    return '<label class="il-gi-row"><input type="checkbox" data-mid="' + Fmt.esc(m.id) + '"' +
                      (sel.indexOf(m.id) >= 0 ? ' checked' : '') + '>' +
                      '<span class="il-mom-geti-txt">' + Fmt.esc(clip(m.title || '(untitled)', 60)) + '</span>' +
                      '<span class="il-mom-geti-meta">' +
                        (m.meeting_date ? Fmt.esc(Fmt.date(m.meeting_date)) : 'undated') +
                        (momDashStarred(m) ? ' · starred' : '') + '</span></label>';
                  }).join('')
                : '<div class="il-empty" style="padding:10px;">No meeting recorded yet.</div>') +
            '</div>'
          : '') +
      '</div>' +
      (momDashFilterOn()
        ? '<button class="il-clear" id="il-momd-clear"><span data-ico="x" data-ico-size="14"></span>Clear</button>'
        : '') +
    '</div>';
  }

  // The summary the owner asked for: every minute, grouped by the meeting it
  // was recorded at. ⚠️ Meetings with NO minutes are listed too, with a note —
  // a meeting nobody minuted is a real state and dropping it silently is how a
  // gap goes unnoticed.
  function momDashByMeetingHTML() {
    var ids = momDashMeetingIds();
    var meetings = momDashMeetings().filter(function (m) { return ids.indexOf(m.id) >= 0; });
    if (!meetings.length) {
      return '<div class="il-empty" style="padding:20px;">No meeting matches this filter.</div>';
    }
    return meetings.map(function (m) {
      var its = momItemsOf(m.id);
      var open = its.filter(function (it) { return momItemStatus(it) !== 'Closed'; }).length;
      return '<div class="pd-card il-mom-mgroup">' +
        '<div class="il-mom-mgrouphead" data-openmom="' + Fmt.esc(m.id) + '">' +
          '<span class="il-mom-mgroupt">' + Fmt.esc(m.title || '(untitled)') + '</span>' +
          '<span class="il-mom-mgroupm">' +
            (m.meeting_date ? Fmt.esc(Fmt.date(m.meeting_date)) + ' · ' : '') +
            its.length + ' minute' + (its.length === 1 ? '' : 's') +
            (its.length ? ' · ' + open + ' open' : '') +
            (momDashStarred(m) ? ' · ★' : '') +
          '</span></div>' +
        (its.length
          ? '<table class="pd-table il-mom-mgrouptbl"><thead><tr><th>No.</th><th>Minute</th>' +
            '<th>Department</th><th>Status</th><th>Responsible</th></tr></thead><tbody>' +
            its.map(function (it, i) {
              return '<tr data-openmom="' + Fmt.esc(m.id) + '">' +
                '<td>' + Fmt.esc(it.item_no || String((it.seq == null ? i : it.seq) + 1)) + '</td>' +
                '<td>' + Fmt.esc(clip(it.action_item || it.description || it.issue || '(blank)', 90)) + '</td>' +
                '<td>' + Fmt.esc(momItemDept(it) || '—') + '</td>' +
                '<td><span class="il-pill ' + statusClass(momItemStatus(it)) + '">' +
                  Fmt.esc(momItemStatus(it)) + '</span></td>' +
                '<td>' + Fmt.esc(championText(it.owner_ids, it.owner) || '—') + '</td>' +
              '</tr>';
            }).join('') + '</tbody></table>'
          : '<p class="il-mom-note">No minute was recorded at this meeting.</p>') +
      '</div>';
    }).join('');
  }

  function renderMomDashboard() {
    var host = $('il-mom-view'); if (!host) return;
    host.classList.remove('il-mom-report');
    if (_momErr) {
      host.innerHTML = '<div class="il-empty" style="padding:24px;">Could not load minutes: ' + Fmt.esc(_momErr) + '</div>';
      return;
    }
    var items = momDashItems();
    var statusSlices = momDashBarsFrom(items, momItemStatus, 'Open');
    var deptSlices = momDashBarsFrom(items, momItemDept, '(no department)');
    var respBars = momDashBarsFrom(items, function (it) {
      return championText(it.owner_ids, it.owner);
    }, '(unassigned)');
    // "Minutes per meeting" — one bar per meeting in scope, so a meeting that
    // produced nothing still shows as a zero rather than vanishing.
    var perMeeting = momDashMeetingIds().map(function (id, i) {
      var m = MOMS.find(function (x) { return x.id === id; }) || {};
      return {
        label: clip(m.title || '(untitled)', 28),
        value: momItemsOf(id).length,
        color: CHART_COLORS[i % CHART_COLORS.length],
      };
    }).sort(function (a, b) { return b.value - a.value; });

    host.innerHTML =
      momDashFilterHTML() +
      '<div class="il-dash-grid">' +
        momDashDonutCard('Minutes by Status', statusSlices, 'Minutes by status') +
        momDashDonutCard('Minutes by Department', deptSlices, 'Minutes by department') +
        '<div class="pd-card il-dash-card"><h4>Minutes by Responsible</h4>' +
          (respBars.length ? barChartSVG(respBars, { aria: 'Minutes by responsible' })
                           : '<div class="il-empty" style="padding:16px;">Nothing to chart yet.</div>') +
        '</div>' +
        '<div class="pd-card il-dash-card il-dash-wide"><h4>Minutes per meeting</h4>' +
          (perMeeting.length ? barChartSVG(perMeeting, { aria: 'Minutes per meeting' })
                             : '<div class="il-empty" style="padding:16px;">Nothing to chart yet.</div>') +
        '</div>' +
      '</div>' +
      '<h4 class="il-mom-dashsec">Minutes by meeting</h4>' +
      momDashByMeetingHTML();

    if (window.Icons && Icons.hydrate) Icons.hydrate(host);

    var star = host.querySelector('#il-momd-star');
    if (star) star.onchange = function () { _momDashF.starred = star.checked; renderMomDashboard(); };
    var pick = host.querySelector('#il-momd-pick');
    if (pick) pick.onclick = function () { _momDashF.pickOpen = !_momDashF.pickOpen; renderMomDashboard(); };
    host.querySelectorAll('[data-mid]').forEach(function (cb) {
      cb.onchange = function () {
        var id = cb.dataset.mid;
        var at = _momDashF.meetings.indexOf(id);
        if (cb.checked && at < 0) _momDashF.meetings.push(id);
        else if (!cb.checked && at >= 0) _momDashF.meetings.splice(at, 1);
        renderMomDashboard();
      };
    });
    var clr = host.querySelector('#il-momd-clear');
    if (clr) clr.onclick = function () {
      _momDashF = { starred: false, meetings: [], pickOpen: false };
      renderMomDashboard();
    };
    host.querySelectorAll('[data-openmom]').forEach(function (el) {
      el.onclick = function () { _momTab = 'meetings'; momOpenMeeting(el.dataset.openmom); };
    });
  }

  // ==========================================================================
  // REHAUL (2026-09-02) — UNIFIED MEETINGS LIST
  // ⚠️ Item 4's list is "meetings" — a planner does not care whether a row is
  // a one-off or a recurring series until they click into it, so List/Calendar
  // now browse ONE set of descriptors built from BOTH `MOMS` (standalone —
  // `schedule_id` null) and `SCHEDULES` (active recurring series). An
  // OCCURRENCE of a series (`schedule_id` set) is never a row here — it is
  // reached only from that series' own page (momOpenSeries), which is what
  // item 6 asks for: click the recurring "meeting" → its definition + the
  // meetings actually held under it, THEN click one of those for its minutes.
  // ==========================================================================
  function plannedAttendeeCount(row) {
    return (attendeeCount(row.attendees_required) || 0) + (attendeeCount(row.attendees_optional) || 0);
  }
  // Item 11: "for action items in list, show only X of Y open." Counted from
  // the minutes themselves, and — for a recurring series — summed across every
  // occurrence held under it, since the series row stands for all of them.
  // ⚠️ Openness is `momItemStatus`, which reads the REGISTER's live status for
  // a minute pulled in from an issue — the same rule the card, the filter and
  // the PDF already follow, so the list cannot claim a minute is open that the
  // register has since closed.
  function itemOpenCount(momIds) {
    var open = 0, total = 0;
    MOM_ITEMS.forEach(function (it) {
      if (momIds.indexOf(it.mom_id) < 0) return;
      total++;
      if (momItemStatus(it) !== 'Closed') open++;
    });
    return { open: open, total: total };
  }
  function momUnifiedRows() {
    var out = [];
    MOMS.forEach(function (m) {
      if (m.schedule_id) return;   // an occurrence — browsed from its series page, not here
      var c = itemOpenCount([m.id]);
      out.push({
        kind: 'meeting', id: m.id, favorite: !!m.is_favorite,
        title: m.title || '(untitled)',
        dateSort: m.meeting_date || '',
        dateLabel: m.meeting_date
          ? (Fmt.date(m.meeting_date) + (m.start_time ? ' · ' + m.start_time : ''))
          : '—',
        attendees: plannedAttendeeCount(m),
        location: m.venue || m.location || '—',
        draft: !m.is_distributed,
        group: m.meeting_group || '',
        open: c.open, total: c.total,
      });
    });
    schedActiveList().forEach(function (s) {
      var next = schedNextOccurrence(s, momToday());
      var cs = itemOpenCount(schedMeetingsOf(s.id).map(function (m) { return m.id; }));
      out.push({
        kind: 'series', id: s.id, favorite: !!s.is_favorite,
        title: s.title || '(untitled)',
        // ⚠️ dateSort is a real ISO date (next occurrence, else its own start)
        // even though the DISPLAYED label is the frequency, so date-sorting a
        // list mixing meetings and series still orders sensibly.
        dateSort: next || s.start_date || '',
        dateLabel: schedFrequencyLabel(s),
        attendees: plannedAttendeeCount(s),
        location: s.venue || '—',
        // ⚠️ A SERIES HAS NO DRAFT STATE — a draft is a property of one
        // recorded minute, and a series is the rule that produces them. It is
        // `false` rather than null so the Draft pill simply never renders on a
        // series row; the Status filter below documents what that means for it.
        draft: false,
        group: s.meeting_group || '',
        open: cs.open, total: cs.total,
      });
    });
    return out;
  }
  function momBrowseFilterOn() {
    return !!(_momQ.trim() || _momBrowseF.kind || _momBrowseF.state || _momBrowseF.fav || _momBrowseF.group);
  }
  // Item 10's filter set, applied to the unified list (search folded in — the
  // box lives inside the filter group now, not beside it).
  function momUnifiedFilter(rows) {
    var q = _momQ.trim().toLowerCase();
    return rows.filter(function (r) {
      if (q && r.title.toLowerCase().indexOf(q) < 0 && r.location.toLowerCase().indexOf(q) < 0) return false;
      if (_momBrowseF.kind && r.kind !== _momBrowseF.kind) return false;
      if (_momBrowseF.group && r.group !== _momBrowseF.group) return false;
      // ⚠️ Filtering by Draft/Distributed excludes every SERIES row, because a
      // series genuinely has neither state (see `draft` above). That is the
      // honest outcome — the alternative, treating a series as "distributed",
      // would assert something nobody recorded — and the filter's own option
      // labels say "meetings only" so it is not a surprise.
      if (_momBrowseF.state === 'draft' && !(r.kind === 'meeting' && r.draft)) return false;
      if (_momBrowseF.state === 'distributed' && !(r.kind === 'meeting' && !r.draft)) return false;
      if (_momBrowseF.fav && !r.favorite) return false;
      return true;
    });
  }
  // ⚠️ Favorites pinned to the top is layered OVER whatever column sort is
  // active, not an alternative to it — partition into favorite/non-favorite,
  // sort each half with the same comparator, concatenate. A column click still
  // reorders within each half rather than fighting the favorite pin.
  function momSortedRows(rows) {
    var col = _momSort.col, dir = _momSort.dir === 'asc' ? 1 : -1;
    function cmp(a, b) {
      var av, bv;
      if (col === 'title') { av = a.title.toLowerCase(); bv = b.title.toLowerCase(); }
      else if (col === 'attendees') { av = a.attendees; bv = b.attendees; }
      else if (col === 'location') { av = a.location.toLowerCase(); bv = b.location.toLowerCase(); }
      else if (col === 'open') { av = a.open; bv = b.open; }
      else { av = a.dateSort; bv = b.dateSort; }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    }
    var fav = rows.filter(function (r) { return r.favorite; }).sort(cmp);
    var rest = rows.filter(function (r) { return !r.favorite; }).sort(cmp);
    return fav.concat(rest);
  }

  function momBrowseFilterBarHTML(shown, total) {
    var on = momBrowseFilterOn();
    return '<div class="il-mom-browsebar">' +
        '<button class="pd-btn pd-btn-sm il-filt-toggle' + (_momFiltOpen ? ' open' : '') +
          (on ? ' has-active' : '') + '" id="il-mom-filttoggle" title="Search and filter meetings">' +
          '<span data-ico="filter" data-ico-size="15"></span> Filters</button>' +
        '<span class="il-mom-count">' + (on ? (shown + ' of ' + total + ' meetings') : (total + ' meeting' + (total === 1 ? '' : 's'))) + '</span>' +
        '<div style="flex:1;"></div>' +
        '<select class="pd-select pd-input-sm" id="il-mom-listexport" title="Export the meeting list" style="width:auto;">' +
          '<option value="">Export list as…</option><option value="html">HTML</option>' +
          '<option value="pdf">PDF</option><option value="xlsx">Excel</option></select>' +
        (canAdd ? '<button class="pd-btn pd-btn-primary pd-btn-sm" id="il-mom-new">+ Add meeting</button>' : '') +
      '</div>' +
      (!_momFiltOpen ? '' :
        '<div class="il-mom-filters">' +
          '<input class="pd-input pd-input-sm il-mom-search" id="il-mom-q" placeholder="Search title or location…" value="' + Fmt.esc(_momQ) + '">' +
          '<select class="pd-select pd-input-sm" id="il-momb-kind">' +
            '<option value="">All meetings</option>' +
            '<option value="meeting"' + (_momBrowseF.kind === 'meeting' ? ' selected' : '') + '>One-time only</option>' +
            '<option value="series"' + (_momBrowseF.kind === 'series' ? ' selected' : '') + '>Recurring only</option>' +
          '</select>' +
          '<select class="pd-select pd-input-sm" id="il-momb-state">' +
            '<option value="">Any status</option>' +
            '<option value="draft"' + (_momBrowseF.state === 'draft' ? ' selected' : '') + '>Draft (meetings only)</option>' +
            '<option value="distributed"' + (_momBrowseF.state === 'distributed' ? ' selected' : '') + '>Distributed (meetings only)</option>' +
          '</select>' +
          '<select class="pd-select pd-input-sm" id="il-momb-group">' +
            '<option value="">Any group</option>' +
            '<option value="Internal"' + (_momBrowseF.group === 'Internal' ? ' selected' : '') + '>Internal</option>' +
            '<option value="External"' + (_momBrowseF.group === 'External' ? ' selected' : '') + '>External</option>' +
          '</select>' +
          '<label class="il-mom-favfilt"><input type="checkbox" id="il-momb-fav"' +
            (_momBrowseF.fav ? ' checked' : '') + '> Favorites only</label>' +
          (on ? '<button class="pd-btn pd-btn-sm" id="il-momb-clear">Clear</button>' : '') +
        '</div>');
  }
  function renderBrowse() {
    var host = $('il-mom-view'); if (!host) return;
    host.classList.remove('il-mom-report');
    var all = momUnifiedRows();
    var rows = momUnifiedFilter(all);
    host.innerHTML =
      momBrowseFilterBarHTML(rows.length, all.length) +
      (_momErr
        ? '<div class="il-empty" style="padding:24px;">Could not load minutes: ' + Fmt.esc(_momErr) +
          '<br><small>If this says the relation does not exist, run <code>migrations/2026-08-19-duration-scenarios-and-mom.sql</code>.</small></div>'
        : (_momView === 'calendar' ? renderMomCalendarHTML(momSearchList()) : renderMomListHTML(rows)));
    wireBrowse();
    if (window.Icons && Icons.hydrate) Icons.hydrate(host);
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
  // Item 4: Title / Date-or-frequency / # Attendees / Location, favorites
  // pinned to the top (momSortedRows). A recurring "meeting" is tagged
  // Recurring, a not-yet-distributed standalone one Draft — both plain text
  // pills next to the title, the same visual language as the Detail view's
  // own draft/distributed state, so the list previews what opening the row
  // will show.
  function momListSortTh(label, col) {
    var on = _momSort.col === col;
    return '<th class="il-mom-th' + (on ? ' on' : '') + '" data-sort="' + col + '">' + Fmt.esc(label) +
      (on ? (_momSort.dir === 'asc' ? ' ▲' : ' ▼') : '') + '</th>';
  }
  function renderMomListHTML(rows) {
    if (!rows.length) {
      return '<div class="il-empty" style="padding:28px;">' +
        ((MOMS.length || SCHEDULES.length) ? 'No meeting matches “' + Fmt.esc(_momQ) + '”.' : 'No minutes recorded on this project yet.') +
      '</div>';
    }
    var sorted = momSortedRows(rows);
    return '<div class="pd-card" style="padding:0;overflow:auto;">' +
      '<table class="pd-table il-mom-listtable"><thead><tr>' +
        '<th class="il-mom-favtd"></th>' +
        momListSortTh('Title', 'title') + momListSortTh('Date', 'date') +
        momListSortTh('Attendees', 'attendees') + momListSortTh('Location', 'location') +
        momListSortTh('Minutes', 'open') +
      '</tr></thead><tbody>' +
      sorted.map(function (r) {
        return '<tr class="il-mom-lrow" data-kind="' + r.kind + '" data-id="' + Fmt.esc(r.id) + '">' +
          '<td class="il-mom-favtd"><button type="button" class="il-mom-favbtn' + (r.favorite ? ' on' : '') +
            '" data-fav="' + r.kind + ':' + Fmt.esc(r.id) + '" title="' +
            (r.favorite ? 'Remove from favorites' : 'Add to favorites') + '">' + (r.favorite ? '★' : '☆') + '</button></td>' +
          '<td>' + Fmt.esc(r.title) +
            (r.kind === 'series' ? ' <span class="il-mom-recur">Recurring</span>' : '') +
            (r.draft ? ' <span class="il-mom-draft">Draft</span>' : '') + '</td>' +
          '<td>' + Fmt.esc(r.dateLabel) + '</td>' +
          '<td>' + (r.attendees || '—') + '</td>' +
          '<td>' + Fmt.esc(r.location) + '</td>' +
          // Item 11 — "X of Y open", never a bare total. ⚠️ A meeting with no
          // minutes at all reads "—", not "0 of 0 open": nothing has been
          // recorded yet, which is a different fact from everything being closed.
          '<td class="il-mom-opencell">' + (r.total ? (r.open + ' of ' + r.total + ' open') : '—') + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  // ---- Calendar view — Month / Week (item 9) -------------------------------
  // ⚠️ UTC throughout — every grid is built from Date.UTC() and every meeting
  // is matched against its plain YYYY-MM-DD/'HH:MM' text, never parsed into a
  // local Date. That local-vs-UTC off-by-one has bitten this app repeatedly
  // (minusDays in both registers, the drawing importer) and a calendar is
  // exactly the screen where it would silently move a meeting onto the wrong
  // day or hour.
  // ⚠️ The calendar plots ACTUAL meetings from `MOMS` directly — including
  // occurrences of a recurring series (`schedule_id` set) — unlike the List
  // view, which deliberately excludes them (they're browsed from their
  // series' own page there). A calendar's whole job is showing WHEN things
  // happen, and an occurrence has a real date the same as any other meeting.
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

  // ---- Week grid (item 9's "throughout week per hour") -------------------
  var WEEK_HOUR_START = 6, WEEK_HOUR_END = 20, WEEK_HOUR_PX = 48;
  function timeToMinutes(hhmm) {
    if (!hhmm) return null;
    var parts = String(hhmm).split(':');
    var h = +parts[0], mi = +(parts[1] || 0);
    if (isNaN(h) || isNaN(mi)) return null;
    return h * 60 + mi;
  }
  function fmtHour(h) {
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + (h < 12 ? 'am' : 'pm');
  }
  // ⚠️ "This week" is seeded off the person's LOCAL wall-clock date (what
  // "today" means to whoever opened the calendar) exactly once, then
  // immediately re-expressed as a UTC date string — from that point on every
  // date this view computes (momWeekShift/momWeekDates) is pure Date.UTC()
  // arithmetic, matching Month view's own stated convention. Only the ONE-TIME
  // "what week am I in right now" question touches local time at all.
  function momWeekInit() {
    if (_momWeekStart) return;
    var d = new Date();
    var localDow = (d.getDay() + 6) % 7;   // Monday=0..Sunday=6
    var monday = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() - localDow));
    _momWeekStart = isoOf(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate());
  }
  function momWeekShift(deltaWeeks) {
    momWeekInit();
    var p = _momWeekStart.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + deltaWeeks * 7));
    _momWeekStart = isoOf(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  function momWeekDates() {
    momWeekInit();
    var p = _momWeekStart.split('-'), out = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + i));
      out.push(isoOf(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
    return out;
  }
  function momWeekLabel() {
    var dates = momWeekDates();
    return Fmt.date(dates[0]) + ' – ' + Fmt.date(dates[6]);
  }
  function renderMomWeekHTML(list) {
    var dates = momWeekDates();
    var todayISO = momToday();
    var dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    var byDay = {}, allDay = {};
    dates.forEach(function (iso) { byDay[iso] = []; allDay[iso] = []; });
    list.forEach(function (x) {
      if (!x.meeting_date) return;
      var iso = x.meeting_date.slice(0, 10);
      if (dates.indexOf(iso) < 0) return;
      // ⚠️ No start_time at all is plotted as an ALL-DAY chip above the hour
      // grid, not silently dropped or forced onto a fake 12:00 slot — a
      // meeting nobody has timed yet is still real and still needs to be seen.
      if (timeToMinutes(x.start_time) == null) allDay[iso].push(x); else byDay[iso].push(x);
    });
    var totalPx = (WEEK_HOUR_END - WEEK_HOUR_START) * WEEK_HOUR_PX;

    var head = '<div class="il-mom-wk-head"><div class="il-mom-wk-gutter"></div>' +
      dates.map(function (iso, i) {
        return '<div class="il-mom-wk-daycol' + (iso === todayISO ? ' is-today' : '') + '">' +
          '<div class="il-mom-wk-dayname">' + dayNames[i] + '</div>' +
          '<div class="il-mom-wk-daydate">' + (+iso.slice(8, 10)) + '</div></div>';
      }).join('') + '</div>';

    var allDayRow = '<div class="il-mom-wk-allday"><div class="il-mom-wk-gutter">All day</div>' +
      dates.map(function (iso) {
        return '<div class="il-mom-wk-daycol">' +
          allDay[iso].map(function (x) {
            return '<button type="button" class="il-mom-calchip' + (x.is_distributed ? '' : ' is-draft') +
              '" data-mom="' + Fmt.esc(x.id) + '" title="' + Fmt.esc(x.title || '(untitled)') + '">' +
              Fmt.esc(clip(x.title || '(untitled)', 18)) + '</button>';
          }).join('') + '</div>';
      }).join('') + '</div>';

    var hourLabels = '', hourLines = '';
    for (var h = WEEK_HOUR_START; h < WEEK_HOUR_END; h++) {
      hourLabels += '<div class="il-mom-wk-hourlabel" style="height:' + WEEK_HOUR_PX + 'px;">' + fmtHour(h) + '</div>';
    }
    for (var h2 = 0; h2 <= (WEEK_HOUR_END - WEEK_HOUR_START); h2++) {
      hourLines += '<div class="il-mom-wk-hourline" style="top:' + (h2 * WEEK_HOUR_PX) + 'px;"></div>';
    }
    var dayGridCols = dates.map(function (iso) {
      var evs = byDay[iso].map(function (x) {
        var s = timeToMinutes(x.start_time), e = timeToMinutes(x.end_time);
        if (e == null || e <= s) e = s + 60;   // no/invalid end time defaults to a 1-hour block
        var top = Math.max(0, (s - WEEK_HOUR_START * 60) / 60 * WEEK_HOUR_PX);
        var bottom = Math.min(totalPx, (e - WEEK_HOUR_START * 60) / 60 * WEEK_HOUR_PX);
        var hpx = Math.max(18, bottom - top);
        return '<button type="button" class="il-mom-wk-event' + (x.is_distributed ? '' : ' is-draft') +
          '" data-mom="' + Fmt.esc(x.id) + '" style="top:' + top + 'px;height:' + hpx + 'px;" title="' +
          Fmt.esc((x.title || '(untitled)') + ' · ' + x.start_time + (x.end_time ? '–' + x.end_time : '')) + '">' +
          '<span class="il-mom-wk-eventtime">' + Fmt.esc(x.start_time) + '</span> ' + Fmt.esc(clip(x.title || '(untitled)', 22)) +
        '</button>';
      }).join('');
      return '<div class="il-mom-wk-daycol il-mom-wk-daybody">' + hourLines + evs + '</div>';
    }).join('');
    var body = '<div class="il-mom-wk-body" style="height:' + totalPx + 'px;">' +
      '<div class="il-mom-wk-gutter il-mom-wk-hourgutter">' + hourLabels + '</div>' + dayGridCols + '</div>';

    return '<div class="il-mom-cal">' +
      '<div class="il-mom-calnav">' +
        '<button type="button" class="pd-btn pd-btn-sm" id="il-mom-wkprev" title="Previous week">‹</button>' +
        '<span class="il-mom-calmonth">' + Fmt.esc(momWeekLabel()) + '</span>' +
        '<button type="button" class="pd-btn pd-btn-sm" id="il-mom-wknext" title="Next week">›</button>' +
        '<button type="button" class="pd-btn pd-btn-sm" id="il-mom-wktoday">Today</button>' +
      '</div>' +
      '<div class="il-mom-wk">' + head + allDayRow + '<div class="il-mom-wk-scroll">' + body + '</div></div>' +
    '</div>';
  }

  function renderMomCalendarHTML(list) {
    return '<div class="il-mom-calmode"><div class="il-viewtoggle">' +
        '<button type="button" data-cm="month" class="' + (_momCalMode === 'month' ? 'on' : '') + '">Month</button>' +
        '<button type="button" data-cm="week" class="' + (_momCalMode === 'week' ? 'on' : '') + '">Week</button>' +
      '</div></div>' +
      (_momCalMode === 'week' ? renderMomWeekHTML(list) : renderMomMonthHTML(list));
  }
  function renderMomMonthHTML(list) {
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
    // ---- item 10: the filter group behind one toggle ----------------------
    var ft = host.querySelector('#il-mom-filttoggle');
    if (ft) ft.onclick = function () { _momFiltOpen = !_momFiltOpen; renderBrowse(); };
    [['il-momb-kind', 'kind'], ['il-momb-state', 'state'], ['il-momb-group', 'group']].forEach(function (p) {
      var el = host.querySelector('#' + p[0]);
      if (el) el.onchange = function () { _momBrowseF[p[1]] = el.value; renderBrowse(); };
    });
    var fv = host.querySelector('#il-momb-fav');
    if (fv) fv.onchange = function () { _momBrowseF.fav = fv.checked; renderBrowse(); };
    var fc = host.querySelector('#il-momb-clear');
    if (fc) fc.onclick = function () {
      _momQ = ''; _momBrowseF = { kind: '', state: '', fav: false, group: '' };
      renderBrowse();
    };

    var nb = host.querySelector('#il-mom-new');
    if (nb) nb.onclick = openAddMeetingModal;
    var lex = host.querySelector('#il-mom-listexport');
    if (lex) lex.onchange = async function () {
      var v = lex.value; lex.value = '';
      if (v === 'html') momExportListHTML();
      else if (v === 'pdf') await momExportListPDF();
      else if (v === 'xlsx') momExportListXLSX();
    };
    host.querySelectorAll('.il-mom-th[data-sort]').forEach(function (th) {
      th.onclick = function () {
        var col = th.dataset.sort;
        if (_momSort.col === col) _momSort.dir = _momSort.dir === 'asc' ? 'desc' : 'asc';
        else { _momSort.col = col; _momSort.dir = (col === 'title' || col === 'type') ? 'asc' : 'desc'; }
        renderBrowse();
      };
    });
    // ⚠️ Dispatches by KIND — a series row (`kind === 'series'`) opens the
    // series page (item 6), a plain meeting opens Detail (item 5). A favorite
    // click inside the row stops propagation below, so it never also opens
    // the row it sits in.
    host.querySelectorAll('.il-mom-lrow').forEach(function (tr) {
      tr.onclick = function () {
        if (tr.dataset.kind === 'series') momOpenSeries(tr.dataset.id);
        else momOpenMeeting(tr.dataset.id);
      };
    });
    host.querySelectorAll('[data-fav]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var i = b.dataset.fav.indexOf(':');
        momToggleFavorite(b.dataset.fav.slice(0, i), b.dataset.fav.slice(i + 1));
      };
    });
    host.querySelectorAll('.il-mom-calchip[data-mom]').forEach(function (b) {
      b.onclick = function () { momOpenMeeting(b.dataset.mom); };
    });
    // A PLANNED chip has no meeting to open yet — it opens the series page
    // with the "+ Add a meeting" form already showing, pre-dated to the day
    // that was clicked (overriding the form's own default of the schedule's
    // NEXT expected date, which may not be this exact day if several
    // occurrences are visible on one screen).
    host.querySelectorAll('.il-mom-calchip[data-plansched]').forEach(function (b) {
      b.onclick = function () {
        _schedOccOpen = true; _schedOccDraft = { date: b.dataset.planiso };
        momOpenSeries(b.dataset.plansched);
      };
    });
    var prev = host.querySelector('#il-mom-calprev');
    if (prev) prev.onclick = function () { momCalShift(-1); renderBrowse(); };
    var next = host.querySelector('#il-mom-calnext');
    if (next) next.onclick = function () { momCalShift(1); renderBrowse(); };
    var today = host.querySelector('#il-mom-caltoday');
    if (today) today.onclick = function () { _momCalMonth = null; momCalInit(); renderBrowse(); };

    var wprev = host.querySelector('#il-mom-wkprev');
    if (wprev) wprev.onclick = function () { momWeekShift(-1); renderBrowse(); };
    var wnext = host.querySelector('#il-mom-wknext');
    if (wnext) wnext.onclick = function () { momWeekShift(1); renderBrowse(); };
    var wtoday = host.querySelector('#il-mom-wktoday');
    if (wtoday) wtoday.onclick = function () { _momWeekStart = null; momWeekInit(); renderBrowse(); };
    host.querySelectorAll('.il-mom-wk-event[data-mom]').forEach(function (b) {
      b.onclick = function () { momOpenMeeting(b.dataset.mom); };
    });

    host.querySelectorAll('[data-cm]').forEach(function (b) {
      b.onclick = function () { _momCalMode = b.dataset.cm; renderBrowse(); };
    });
  }

  // ⚠️ Every schedule-CRUD/occurrence-creation control below (item #19/#22's
  // "+ New schedule"/"+ Add a meeting"/rename/delete) now lives on the series
  // page (renderSeriesPage/wireSeriesPage below), not in the browse view —
  // a series is opened from the unified list like anything else (item 6),
  // so it no longer needs its own always-visible panel in wireBrowse().
  function reRenderMomHost() {
    if (_momView === 'series') renderSeriesPage();
    else if (_momView === 'detail') renderDetail();
    else renderBrowse();
  }

  async function momToggleFavorite(kind, id) {
    var table = kind === 'series' ? 'mom_schedules' : 'meeting_minutes';
    var arr = kind === 'series' ? SCHEDULES : MOMS;
    var row = arr.find(function (x) { return x.id === id; });
    if (!row) return;
    var next = !row.is_favorite;
    row.is_favorite = next;   // optimistic — the star flips before the round-trip lands
    reRenderMomHost();
    try {
      var u = await sb().from(table).update({ is_favorite: next }).eq('id', id);
      if (u.error) throw u.error;
    } catch (e) {
      row.is_favorite = !next;
      UI.toast(/column|schema cache/i.test(e.message || '')
        ? 'Run migrations/2026-09-02-meetings-rehaul.sql in Supabase first.' : (e.message || e), 'error');
      reRenderMomHost();
    }
  }

  function momOpenSeries(id) {
    _momTab = 'meetings';
    if (_momView !== 'series') _momBrowsePrev = _momView;
    _seriesSel = id; _momView = 'series';
    render();
    if (histView) histView.push();
  }

  // ---- Series page (item 6): a recurring schedule's own details plus every
  // meeting actually held under it. -------------------------------------
  function renderSeriesPage() {
    var host = $('il-mom-view'); if (!host) return;
    var s = SCHEDULES.find(function (x) { return x.id === _seriesSel; });
    if (!s) { _momView = _momBrowsePrev || 'list'; renderBrowse(); return; }
    host.classList.remove('il-mom-report');
    var past = schedMeetingsOf(s.id);
    var next = schedNextOccurrence(s, momToday());
    var mine = s.created_by === UID;
    host.innerHTML =
      '<button type="button" class="pd-btn pd-btn-sm il-mom-back" id="il-mom-back">← Back to meetings</button>' +
      '<div class="pd-card il-mom-seriescard">' +
        '<div class="il-mom-seriesheadrow">' +
          '<div>' +
            '<h2 class="il-mom-seriestitle">' + Fmt.esc(s.title || '(untitled)') +
              ' <span class="il-mom-recur">Recurring</span></h2>' +
            '<div class="il-mom-seriesmeta">' + Fmt.esc(schedFrequencyLabel(s)) +
              ' · ' + Fmt.esc(s.meeting_group || 'Internal') +
              (s.end_date ? ' · ends ' + Fmt.esc(Fmt.date(s.end_date)) : '') +
              (next ? ' · next: ' + Fmt.esc(Fmt.date(next)) : ' · no further occurrences') +
            '</div>' +
          '</div>' +
          '<div class="il-mom-seriesacts">' +
            '<button type="button" class="pd-btn pd-btn-sm il-mom-favbtn' + (s.is_favorite ? ' on' : '') +
              '" id="il-mom-favtoggle" data-fav="series:' + Fmt.esc(s.id) + '">' +
              (s.is_favorite ? '★ Favorited' : '☆ Favorite') + '</button>' +
            ((isSteward || mine) ? '<button type="button" class="pd-btn pd-btn-sm" id="il-sched-edit">Edit</button>' : '') +
            ((isSteward || mine) ? '<button type="button" class="pd-btn pd-btn-sm pd-btn-danger" id="il-sched-del">Delete</button>' : '') +
            (canAdd ? '<button type="button" class="pd-btn pd-btn-primary pd-btn-sm" id="il-sched-addocc">+ Add a meeting</button>' : '') +
          '</div>' +
        '</div>' +
        (_schedFormOpen ? scheduleFormHTML(_schedFormDraft) : '') +
        (_schedOccOpen ? scheduleOccFormHTML(s) : '') +
      '</div>' +
      '<div class="pd-card il-mom-seriespast">' +
        '<h3>Meetings held (' + past.length + ')</h3>' +
        (past.length
          ? '<table class="pd-table"><thead><tr><th>Date</th><th>Status</th><th>Attendees</th></tr></thead><tbody>' +
            past.map(function (m) {
              return '<tr class="il-mom-schedpasti" data-mom="' + Fmt.esc(m.id) + '">' +
                '<td>' + Fmt.esc(m.meeting_date ? Fmt.date(m.meeting_date) : '—') + '</td>' +
                '<td>' + (m.is_distributed ? 'Distributed' : '<span class="il-mom-draft">Draft</span>') + '</td>' +
                '<td>' + (plannedAttendeeCount(m) || '—') + '</td>' +
              '</tr>';
            }).join('') + '</tbody></table>'
          : '<div class="il-empty" style="padding:18px;">No meetings recorded on this schedule yet — ' +
            '"+ Add a meeting" opens the first one, its details copied from nothing since none exist yet.</div>') +
      '</div>';
    wireSeriesPage();
    if (window.Icons && Icons.hydrate) Icons.hydrate(host);
  }

  function wireSeriesPage() {
    var host = $('il-mom-view'); if (!host) return;
    var back = host.querySelector('#il-mom-back');
    if (back) back.onclick = function () {
      _momView = _momBrowsePrev || 'list'; _seriesSel = null;
      _schedFormOpen = false; _schedFormDraft = null; _schedOccOpen = false; _schedOccDraft = null;
      render();
      if (histView) histView.push();
    };
    host.querySelectorAll('[data-fav]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var i = b.dataset.fav.indexOf(':');
        momToggleFavorite(b.dataset.fav.slice(0, i), b.dataset.fav.slice(i + 1));
      };
    });
    var sedit = host.querySelector('#il-sched-edit');
    if (sedit) sedit.onclick = function () {
      _schedFormDraft = SCHEDULES.find(function (x) { return x.id === _seriesSel; });
      _schedFormOpen = true; renderSeriesPage();
    };
    var sdel = host.querySelector('#il-sched-del');
    if (sdel) sdel.onclick = function () { scheduleDelete(_seriesSel); };
    var sc = host.querySelector('#il-sf-cancel');
    if (sc) sc.onclick = function () { _schedFormOpen = false; _schedFormDraft = null; renderSeriesPage(); };
    var freqSel = host.querySelector('#il-sf-freq');
    if (freqSel) freqSel.onchange = function () {
      var wrap = host.querySelector('#il-sf-rulewrap');
      if (wrap) wrap.innerHTML = scheduleRuleFieldsHTML({ frequency: freqSel.value });
    };
    var sv = host.querySelector('#il-sf-save');
    if (sv) sv.onclick = scheduleFormSave;
    var saddocc = host.querySelector('#il-sched-addocc');
    if (saddocc) saddocc.onclick = function () { _schedOccOpen = true; _schedOccDraft = null; renderSeriesPage(); };
    var socancel = host.querySelector('#il-of-cancel');
    if (socancel) socancel.onclick = function () { _schedOccOpen = false; _schedOccDraft = null; renderSeriesPage(); };
    var socreate = host.querySelector('#il-of-create');
    if (socreate) socreate.onclick = function () { scheduleCreateOccurrence(_seriesSel); };
    wirePeople(host, null);   // the occurrence form's Required/Optional pickers
    host.querySelectorAll('.il-mom-schedpasti').forEach(function (tr) {
      tr.onclick = function () { momOpenMeeting(tr.dataset.mom); };
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
        _seriesSel = ins.data.id;
        UI.toast('Schedule created', 'ok');
      }
      _schedFormOpen = false; _schedFormDraft = null;
      reRenderMomHost();
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
      if (_seriesSel === id) { _seriesSel = null; _momView = _momBrowsePrev || 'list'; }
      UI.toast('Schedule deleted', 'ok');
      reRenderMomHost();
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
      // ⚠️ `_seriesSel` stays SET (not nulled) — momOpenMeeting captures the
      // current `_momView` ('series', since we're calling this from the
      // series page) as `_momBrowsePrev`, so "← Back to meetings" from the
      // occurrence just created returns to ITS series page, not wherever
      // List/Calendar happened to be sitting before the series was opened.
      _schedOccOpen = false; _schedOccDraft = null;
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
    render();
    if (histView) histView.push();
  }

  // ---- + Add meeting modal (item 3) --------------------------------------
  // ⚠️ Agenda is a small DOM-driven list, not a JS array kept in state — each
  // row is a real input in the modal; adding/removing rows just adds/removes
  // DOM nodes, and the values are read straight off the inputs at save time
  // (agendaValuesOf). No separate model to keep in sync with the DOM.
  function agendaRowsHTML(items) {
    var list = (items && items.length) ? items : [''];
    return list.map(function (t) {
      return '<div class="il-mom-agrow"><input class="pd-input pd-input-sm il-mom-agitem" value="' +
        Fmt.esc(t) + '" placeholder="Agenda item"><button type="button" class="il-mom-agdel" title="Remove">✕</button></div>';
    }).join('');
  }
  // ⚠️ `wrapId`/`addId` default to the Add-meeting modal's own ids so every
  // existing caller is unchanged; the meeting's own agenda editor (item 4 of the
  // module list) passes its own pair rather than a second copy of this logic.
  function wireAgendaList(root, wrapId, addId) {
    var wrap = root.querySelector('#' + (wrapId || 'il-am-agenda')); if (!wrap) return;
    function bindRow(row) {
      var del = row.querySelector('.il-mom-agdel');
      if (del) del.onclick = function () {
        // Always leaves at least one row — clearing the last one's text is how
        // you empty the agenda, rather than a form with no agenda row at all.
        if (wrap.querySelectorAll('.il-mom-agrow').length > 1) row.remove();
        else { var i = row.querySelector('.il-mom-agitem'); if (i) i.value = ''; }
      };
    }
    wrap.querySelectorAll('.il-mom-agrow').forEach(bindRow);
    var add = root.querySelector('#' + (addId || 'il-am-agenda-add'));
    if (add) add.onclick = function () {
      var tmp = document.createElement('div');
      tmp.innerHTML = agendaRowsHTML(['']);
      var row = tmp.firstElementChild;
      wrap.appendChild(row);
      bindRow(row);
      var i = row.querySelector('.il-mom-agitem'); if (i) i.focus();
    };
  }
  function agendaValuesOf(root, wrapId) {
    var wrap = root.querySelector('#' + (wrapId || 'il-am-agenda')); if (!wrap) return [];
    return Array.prototype.map.call(wrap.querySelectorAll('.il-mom-agitem'), function (i) { return i.value.trim(); })
      .filter(function (v) { return v; });
  }

  function openAddMeetingModal() {
    var m = UI.modal(
      '<div class="pd-modal-header"><h3 style="margin:0;">+ Add meeting</h3>' +
        '<button class="pd-modal-close" id="il-am-x">&times;</button></div>' +
      '<div class="pd-modal-body">' +
        '<div class="il-form-row">' +
          '<div class="pd-field" style="flex:2 1 220px;"><label>Meeting title *</label>' +
            '<input class="pd-input" id="il-am-title" placeholder="e.g. Weekly PSC Meeting"></div>' +
          '<div class="pd-field" style="flex:1 1 130px;"><label style="display:flex;align-items:center;gap:6px;font-weight:400;">' +
            '<input type="checkbox" id="il-am-fav" style="width:auto;"> Favorite this meeting</label></div>' +
        '</div>' +
        '<div class="il-form-row">' +
          '<div class="pd-field" style="flex:1 1 150px;"><label>Date *</label>' +
            '<input class="pd-input" type="date" id="il-am-date" value="' + dateVal(momToday()) + '"></div>' +
          '<div class="pd-field" style="flex:1 1 120px;"><label>Start time</label><input class="pd-input" type="time" id="il-am-start"></div>' +
          '<div class="pd-field" style="flex:1 1 120px;"><label>End time</label><input class="pd-input" type="time" id="il-am-end"></div>' +
        '</div>' +
        '<div class="il-form-row">' +
          '<div class="pd-field" style="flex:1 1 200px;"><label>Venue</label><input class="pd-input" id="il-am-venue"></div>' +
          '<div class="pd-field" style="flex:1 1 200px;"><label>Meeting link</label><input class="pd-input" id="il-am-link" placeholder="https://…"></div>' +
        '</div>' +
        '<div class="pd-field"><label>Required attendees</label>' + peoplePickerHTML('am-req', [], '', false) + '</div>' +
        '<div class="pd-field"><label>Optional attendees</label>' + peoplePickerHTML('am-opt', [], '', false) + '</div>' +
        '<div class="pd-field"><label>Agenda</label><div id="il-am-agenda">' + agendaRowsHTML([]) + '</div>' +
          '<button type="button" class="pd-btn pd-btn-sm" id="il-am-agenda-add" style="margin-top:6px;">+ Add agenda item</button></div>' +
        '<div class="il-form-row">' +
          '<div class="pd-field" style="flex:1 1 260px;"><label style="display:flex;align-items:center;gap:6px;font-weight:400;">' +
            '<input type="checkbox" id="il-am-recur" style="width:auto;"> This is a recurring meeting</label></div>' +
        '</div>' +
        '<div id="il-am-recurwrap" hidden>' +
          '<div class="il-form-row">' +
            '<div class="pd-field" style="flex:1 1 220px;"><label>Frequency</label><select class="pd-select" id="il-am-freq">' +
              FREQUENCIES.map(function (f) { return '<option value="' + f.key + '">' + f.label + '</option>'; }).join('') +
            '</select></div>' +
          '</div>' +
          '<div class="il-form-row" id="il-sf-rulewrap">' + scheduleRuleFieldsHTML({ frequency: 'monthly_date' }) + '</div>' +
          '<div class="il-form-row">' +
            '<div class="pd-field" style="flex:1 1 150px;"><label>Series start date</label>' +
              '<input class="pd-input" type="date" id="il-am-sstart" value="' + dateVal(momToday()) + '"></div>' +
            '<div class="pd-field" style="flex:1 1 150px;"><label>Series end date (optional)</label>' +
              '<input class="pd-input" type="date" id="il-am-send"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="pd-modal-footer">' +
        '<button class="pd-btn" id="il-am-cancel">Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="il-am-save">Save meeting</button>' +
      '</div>',
      { title: 'Add meeting' }
    );
    var root = m.el;
    wirePeople(root, null);
    wireAgendaList(root);
    var recur = root.querySelector('#il-am-recur');
    if (recur) recur.onchange = function () {
      var wrap = root.querySelector('#il-am-recurwrap');
      if (wrap) wrap.hidden = !recur.checked;
    };
    var freqSel = root.querySelector('#il-am-freq');
    if (freqSel) freqSel.onchange = function () {
      var wrap = root.querySelector('#il-sf-rulewrap');
      if (wrap) wrap.innerHTML = scheduleRuleFieldsHTML({ frequency: freqSel.value });
    };
    var x = root.querySelector('#il-am-x'); if (x) x.onclick = m.close;
    var cancel = root.querySelector('#il-am-cancel'); if (cancel) cancel.onclick = m.close;
    var save = root.querySelector('#il-am-save');
    if (save) save.onclick = function () { saveAddMeeting(root, m.close, save); };
    if (window.Icons && Icons.hydrate) Icons.hydrate(root);
  }

  async function saveAddMeeting(root, close, saveBtn) {
    var g = function (id) { var e = root.querySelector('#' + id); return e ? e.value : ''; };
    var title = g('il-am-title').trim();
    var date = g('il-am-date');
    if (!title) { UI.toast('Meeting title is required.', 'warn'); return; }
    if (!date) { UI.toast('Date is required.', 'warn'); return; }
    var reqRoot = root.querySelector('[data-people="am-req"]'), optRoot = root.querySelector('[data-people="am-opt"]');
    var reqIds = reqRoot ? idsOf(reqRoot) : [], reqText = reqRoot ? ((reqRoot.querySelector('.il-pp-free') || {}).value || '') : '';
    var optIds = optRoot ? idsOf(optRoot) : [], optText = optRoot ? ((optRoot.querySelector('.il-pp-free') || {}).value || '') : '';
    var agenda = agendaValuesOf(root);
    var isRecur = !!(root.querySelector('#il-am-recur') || {}).checked;
    var isFav = !!(root.querySelector('#il-am-fav') || {}).checked;
    var venue = g('il-am-venue').trim(), link = g('il-am-link').trim();
    var startT = g('il-am-start'), endT = g('il-am-end');
    if (saveBtn) saveBtn.disabled = true;
    try {
      if (isRecur) {
        var freq = g('il-am-freq') || 'monthly_date';
        var payload = {
          project_id: pid, title: title, meeting_group: 'Internal', frequency: freq,
          start_date: g('il-am-sstart') || date, end_date: g('il-am-send') || null,
          is_favorite: isFav, venue: venue || null, meeting_link: link || null,
          start_time: startT || null, end_time: endT || null,
          attendees_required: { ids: reqIds, text: reqText },
          attendees_optional: { ids: optIds, text: optText },
          default_agenda: agenda.length ? agenda : null,
          weekday: null, week_ordinal: null, day_of_month: null, interval_n: 1,
          created_by: UID,
        };
        // The rule fields are the shared scheduleRuleFieldsHTML() markup, so
        // they carry the `il-sf-*` ids that helper always emits (the same ones
        // the series-page edit form reads), not `il-am-*`.
        if (freq === 'weekly') {
          payload.weekday = +g('il-sf-weekday') || 0;
          payload.interval_n = Math.max(1, +g('il-sf-interval') || 1);
        } else if (freq === 'monthly_weekday') {
          payload.weekday = +g('il-sf-weekday') || 0;
          payload.week_ordinal = +g('il-sf-ordinal') || 1;
        } else {
          payload.day_of_month = Math.max(1, Math.min(31, +g('il-sf-dom') || 1));
        }
        var ins = await sb().from('mom_schedules').insert(payload).select().single();
        if (ins.error) throw ins.error;
        SCHEDULES.push(ins.data);
        SCHEDULES.sort(function (a, b) { return (a.title || '').localeCompare(b.title || ''); });
        close();
        UI.toast('Recurring meeting series created', 'ok');
        _momErr = ''; renderBrowse();
      } else {
        var mpayload = {
          project_id: pid, title: title, meeting_date: date, meeting_group: 'Internal',
          is_favorite: isFav, venue: venue || null, meeting_link: link || null,
          start_time: startT || null, end_time: endT || null,
          attendees_required: { ids: reqIds, text: reqText },
          attendees_optional: { ids: optIds, text: optText },
          created_by: UID,
        };
        var minsRes = await sb().from('meeting_minutes').insert(mpayload).select().single();
        if (minsRes.error) throw minsRes.error;
        MOMS.unshift(minsRes.data); _momErr = '';
        // Each agenda item becomes a real action item on the new meeting — the
        // same mom_items table every action lives in, so it gets the full
        // workflow (owner, due date, hold/close, history) the moment the
        // meeting exists, rather than being a second, throwaway list of text.
        for (var i = 0; i < agenda.length; i++) {
          try {
            var itemIns = await sb().from('mom_items').insert({
              mom_id: minsRes.data.id, project_id: pid, seq: i,
              description: agenda[i], action_item: '', type: 'Report', status: 'Open', created_by: UID,
            }).select().single();
            if (!itemIns.error && itemIns.data) { MOM_ITEMS.push(itemIns.data); logItemHistory(itemIns.data.id, pid, 'create', null, null); }
          } catch (e) {}
        }
        // Still-open register issues are quietly seeded onto the new agenda,
        // the same rule every other "new minute" path in this module follows.
        try { await momPullIssues(minsRes.data.id, { quiet: true }); } catch (e) {}
        close();
        momOpenMeeting(minsRes.data.id);
      }
    } catch (e) {
      if (saveBtn) saveBtn.disabled = false;
      UI.toast(/relation|does not exist|schema cache|column/i.test(e.message || '')
        ? 'Run migrations/2026-08-19-duration-scenarios-and-mom.sql, migrations/2026-09-01-mom-schedules-attendees-item-history.sql ' +
          'and migrations/2026-09-02-meetings-rehaul.sql in Supabase first.' : (e.message || e), 'error');
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
      _momItemWF = {};   // leave no half-open workflow behind
      render();
      if (histView) histView.push();
    };
  }

  // ⚠️ MODULE ITEM 4 (2026-09-02) — "make sure that it is possible to add agenda
  // to a meeting". The Add-meeting modal could set one; an EXISTING meeting had
  // no way to. This is that editor, and it is also slide 2 of the reporting
  // deck (item 12).
  // ⚠️ The agenda is `meeting_minutes.agenda` (jsonb), NOT mom_items rows: an
  // agenda TOPIC ("Safety") is what the meeting intends to cover, a MINUTE is
  // what was actually recorded against it. Filing topics as minutes would put
  // empty rows in the record and count them as open work.
  function momAgendaSectionHTML(mom, ro) {
    var ag = Array.isArray(mom.agenda) ? mom.agenda : [];
    if (ro) {
      return '<div class="il-mom-agenda" id="il-mom-slide-agenda"><h4>Agenda</h4>' +
        (ag.length
          ? '<ol class="il-mom-agview">' + ag.map(function (t) {
              return '<li>' + Fmt.esc(t) + '</li>'; }).join('') + '</ol>'
          : '<p class="il-mom-note">No agenda was set for this meeting.</p>') +
      '</div>';
    }
    return '<div class="il-mom-agenda" id="il-mom-slide-agenda"><h4>Agenda</h4>' +
      '<p class="il-mom-note">What this meeting sets out to cover. Separate from the minutes ' +
      'below, which are what was actually recorded.</p>' +
      '<div id="il-mom-agenda">' + agendaRowsHTML(ag) + '</div>' +
      '<div class="il-mom-addrow">' +
        '<button type="button" class="pd-btn pd-btn-sm" id="il-mom-agenda-add">+ Add agenda item</button>' +
        '<button type="button" class="pd-btn pd-btn-sm" id="il-mom-agenda-save">Save agenda</button>' +
      '</div>' +
    '</div>';
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
    var others = MOMS.filter(function (x) { return x.id !== mom.id && momCarryable(x).length; });
    return '<div class="il-mom-detail-card">' +
      (ro ? '' : '<input type="file" id="il-mom-fileinput" hidden ' +
        'accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx">') +
      '<div class="il-mom-toolbar">' +
        '<span class="il-mom-state' + (locked ? ' on' : '') + '">' +
          (locked ? 'Distributed' : 'Draft — only you and planners can see this') + '</span>' +
        '<div style="flex:1;"></div>' +
        // Item 3/4: any meeting — not just a series — can be favorited; pinned
        // to the top of the list either way (momSortedRows). A view control,
        // offered to whoever can already see the minute, not gated on mayEdit.
        '<button class="pd-btn pd-btn-sm il-mom-favbtn' + (mom.is_favorite ? ' on' : '') + '" id="il-mom-favtoggle" ' +
          'title="' + (mom.is_favorite ? 'Remove from favorites' : 'Add to favorites') + '">' +
          (mom.is_favorite ? '★ Favorited' : '☆ Favorite') + '</button>' +
        // Export is a READ, so it is offered to everyone who can see the minute —
        // unlike every other control on this card, which is gated on canEditMinute().
        // A VIEW control, so — like PDF — it is offered to everyone who can see the
        // minute, not only to whoever may edit it.
        '<button class="pd-btn pd-btn-sm' + (_momReport ? ' is-active' : '') + '" id="il-mom-report" ' +
          'title="Present these minutes as a clean read-only record — hides the editing controls">' +
          (_momReport ? '\u2713 Reporting view' : 'Reporting view') + '</button>' +
        // Item 8: one control surface for HTML/PDF/PowerPoint/Excel, plus a
        // separate Email action — both reads, offered the same way PDF was.
        '<select class="pd-select pd-input-sm" id="il-mom-exportsel" title="Export these minutes" style="width:auto;">' +
          '<option value="">Export as…</option><option value="html">HTML</option>' +
          '<option value="pdf">PDF</option><option value="pptx">PowerPoint</option>' +
          '<option value="xlsx">Excel</option></select>' +
        '<button class="pd-btn pd-btn-sm" id="il-mom-email" title="Email these minutes">✉ Email</button>' +
        (mayEdit ? '<button class="pd-btn pd-btn-sm' + (locked ? '' : ' pd-btn-primary') + '" id="il-mom-dist">' +
          (locked ? '↩ Revert to draft' : '📤 Distribute') + '</button>' : '') +
      '</div>' +
      (locked && mayEdit
        ? '<p class="il-mom-note" style="margin-top:0;">These minutes have been issued, so the form is ' +
          'locked. Revert to draft to change them — everyone on the project can already read this version.</p>'
        : '') +
      // ⚠️ ITEM 12 — the reporting view is a slide deck now, and these ids are
      // what it steps through: #il-mom-slide-details, #il-mom-slide-agenda, then
      // one .il-mi-card per minute. The markup is IDENTICAL in both modes (the
      // controls are live either way, per "navigate and step through slides
      // while also editing") — reporting only decides which slide is on screen.
      '<div id="il-mom-slide-details">' +
      '<div class="il-form-row">' +
        '<div class="pd-field" style="flex:2 1 260px;"><label>Title</label><input class="pd-input" id="il-mom-title" value="' + Fmt.esc(mom.title || '') + '"' + d + '></div>' +
        '<div class="pd-field" style="flex:1 1 140px;"><label>Date</label><input class="pd-input" type="date" id="il-mom-date" value="' + (dateVal(mom.meeting_date)) + '"' + d + '></div>' +
        '<div class="pd-field" style="flex:1 1 140px;"><label>Location</label><input class="pd-input" id="il-mom-loc" value="' + Fmt.esc(mom.location || '') + '"' + d + '></div>' +
      '</div>' +
      // ⚠️ ITEM 3/5 — planned start/end alongside the ACTUAL start/end.
      // Both are always shown, never conditionally revealed once "the meeting
      // is done" — a meeting recorded ahead of time can still have its actual
      // times filled in the moment it wraps, and hiding the fields until some
      // date-based guess of "done" would just make them harder to find on the
      // day they are most useful.
      '<div class="il-form-row">' +
        '<div class="pd-field" style="flex:1 1 110px;"><label>Start time</label>' +
          '<input class="pd-input" type="time" id="il-mom-stime" value="' + Fmt.esc(mom.start_time || '') + '"' + d + '></div>' +
        '<div class="pd-field" style="flex:1 1 110px;"><label>End time</label>' +
          '<input class="pd-input" type="time" id="il-mom-etime" value="' + Fmt.esc(mom.end_time || '') + '"' + d + '></div>' +
        '<div class="pd-field" style="flex:1 1 110px;"><label>Actual start</label>' +
          '<input class="pd-input" type="time" id="il-mom-astime" value="' + Fmt.esc(mom.actual_start_time || '') + '"' + d + '></div>' +
        '<div class="pd-field" style="flex:1 1 110px;"><label>Actual finish</label>' +
          '<input class="pd-input" type="time" id="il-mom-aetime" value="' + Fmt.esc(mom.actual_end_time || '') + '"' + d + '></div>' +
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
      // ⚠️ OWNER ITEM 1 (2026-09-02) — the meeting-level "Activity discussed"
      // picker is GONE; the activity is recorded per minute now (see
      // momItemActCellHTML). A meeting-level value stored before this change is
      // shown here read-only rather than hidden — it is real data somebody
      // entered — and `momSaveHeader` no longer writes the column at all, so
      // saving the header cannot blank it.
      (mom.schedule_activity_id
        ? '<p class="il-mom-note">Recorded against activity <code>' +
            Fmt.esc(mom.schedule_activity_id) + '</code>' +
            (MOM_ACT_NAME[mom.schedule_activity_id] ? ' · ' + Fmt.esc(MOM_ACT_NAME[mom.schedule_activity_id]) : '') +
            ' when the whole meeting carried one activity. Each minute now carries its own.</p>'
        : '') +
      (ro ? '<p class="il-raisedby il-mom-by">' + Fmt.esc(minuteByLabel(mom)) + '</p>' : '') +
      // ⚠️ OWNER ITEM 2 (2026-09-02) — "remove the notes/discussion field in the
      // meeting details". The minutes themselves are the record now (the list
      // below), so a second free-text field covering the same ground invites the
      // same discussion being written twice, in two places, with no way to tell
      // which one is current. Existing text is shown read-only instead of being
      // hidden, and `momSaveHeader` no longer writes the column, so saving the
      // header cannot blank it. Exports still print it where a minute has it.
      (mom.notes
        ? '<div class="pd-field"><label>Notes / discussion ' +
            '<small style="font-weight:400;color:var(--pd-muted);">— recorded before each minute ' +
            'carried its own record; read-only</small></label>' +
            '<div class="il-mi-val">' + Fmt.esc(mom.notes).replace(/\n/g, '<br>') + '</div></div>'
        : '') +
      '</div>' +   /* end #il-mom-slide-details */
      momAgendaSectionHTML(mom, ro) +

      // ⚠️ OWNER ITEM 1 (2026-09-02) — "action items should be replaced by
      // minutes". Same rows, same `mom_items` table: what changed is the name,
      // because these ARE the minutes of the meeting, not a to-do list beside
      // them. Every user-facing "action item" string in this module follows.
      '<div class="il-mom-actions"><h4>Minutes</h4>' +
        '<p>Each minute recorded at this meeting lives here. Use <b>Get from issue</b> to bring in ' +
        'something already logged in Issues &amp; Concerns — during a PPR, or any time — so it is ' +
        'tracked here without retyping it. New issues are raised directly in that register now, not ' +
        'from these minutes.</p>' +
        // ⚠️ Offered only when there is enough to filter. A filter bar over three
        // rows is noise, and a "Showing 0 of 3" that a stale filter caused is how a
        // planner concludes their minutes have lost data.
        (items.length > 4 ? momFilterBarHTML(items) : '') +
        (items.length && !vis.length
          ? '<div class="il-empty" style="padding:14px;">No minute on these minutes matches the filter.</div>'
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
          : (items.length ? '' : '<div class="il-empty" style="padding:14px;">No minutes recorded on this meeting yet.</div>')) +
        (ro ? '' :
          '<div class="il-mom-addrow">' +
            '<button class="pd-btn pd-btn-sm" id="il-mom-additem">+ Add minute</button>' +
            // Carry-over is offered on ANY minute, not only a brand-new one — a recurring
            // meeting often has its agenda seeded after the fact. Only meetings that
            // actually still have something open are listed; an empty dropdown would
            // invite a click that does nothing.
            // ⚠️ OWNER ITEM 3 (2026-09-02) — "the carry over dropdown should not be
            // shown initially. clicking carry over should open a pop up window
            // where user can select which minutes to carry over from." One button;
            // the source meetings are listed inside the modal.
            (others.length
              ? '<button class="pd-btn pd-btn-sm" id="il-mom-carrygo" ' +
                  'title="Bring still-open minutes forward from an earlier meeting">Carry over…</button>'
              : '') +
            // ⚠️ OWNER ITEM 4 (2026-09-02) — "get from issue button is not working."
            // It was not broken: a brand-new meeting auto-seeds EVERY open issue, so
            // momOpenIssuesFor() legitimately returned an empty set and the button
            // rendered permanently `disabled` — which reads as broken. It is always
            // enabled now and opens a modal listing the project's issues, with the
            // ones already on this agenda shown and marked rather than filtered out,
            // so the answer to "where are my issues?" is on screen instead of absent.
            '<button class="pd-btn pd-btn-sm" id="il-mom-getissue" ' +
              'title="Bring issues from Issues &amp; Concerns onto this agenda">Get from issue</button>' +
          '</div>') +
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
      // ITEM 5 — filters on department now, over the same union the card's own
      // select offers, so a legacy `category` value stays reachable.
      '<select class="pd-select pd-input-sm" id="il-momf-cat">' +
        momOptions(DEPARTMENTS, momUsedDepartments(), _momF.cat, 'All departments') + '</select>' +
      '<select class="pd-select pd-input-sm" id="il-momf-type">' +
        momOptions(MOM_TYPES, [], _momF.type, 'All types') + '</select>' +
      '<select class="pd-select pd-input-sm" id="il-momf-status">' +
        momOptions(momStatusFilterOpts(), [], _momF.status, 'All statuses') + '</select>' +
      (on ? '<button class="il-clear" id="il-momf-clear" title="Clear all filters">' +
            '<span data-ico="x" data-ico-size="14"></span>Clear</button>' : '') +
      '<span class="il-mom-count">' +
        (on ? 'Showing ' + momVisibleItems(_momSel).length + ' of ' + items.length
            : items.length + ' minute' + (items.length === 1 ? '' : 's')) + '</span>' +
    '</div>';
  }

  // ⚠️ `UI.modal(html, opts)` wires NOTHING but the backdrop click — it does not
  // bind `[data-close]` and it ignores an `opts.width`. Every modal in this file
  // used to wire its own × and Cancel by id; this does the same job once, for
  // the modals added in the 2026-09-02 rehaul, and applies the width to the
  // `.pd-modal` box itself. A modal whose × does nothing is the exact silent
  // failure this repo has recorded before.
  function wireModalChrome(m, width) {
    var box = m.el.querySelector('.pd-modal');
    if (box && width) { box.style.maxWidth = width + 'px'; box.style.width = '100%'; }
    m.el.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = m.close; });
    if (window.Icons && Icons.hydrate) Icons.hydrate(m.el);
    return m;
  }

  // ⚠️ ITEM 4 — THE "GET FROM ISSUE" MODAL, replacing the inline panel.
  // It lists EVERY issue on the project, not only the still-open ones that are
  // off this agenda: the old panel's set was correct but invisible, because a
  // new meeting is seeded with all of them and the button then had nothing to
  // offer. Rows already on this agenda are shown, ticked and disabled — the
  // honest answer to "why is that one not in the list" is to show it as
  // already added.
  // ⚠️ A closed issue is listed but NOT selectable: dragging something the
  // register has settled onto next week's agenda is the exact thing
  // momOpenIssuesFor() exists to prevent, and it stays prevented here.
  // Field mapping is momIssuePayload()'s (issue ← description, description ←
  // caused_by, action item ← corrective_action) — one shape for every route in.
  function openGetIssueModal(momId) {
    var mom = MOMS.find(function (x) { return x.id === momId; });
    if (!mom) return;
    var on = {};
    momItemsOf(momId).forEach(function (it) { if (it.issue_id) on[it.issue_id] = 1; });
    var picked = {}, q = '';

    var m = UI.modal(
      '<div class="pd-modal-header"><h3>Get from issue</h3>' +
        '<button class="pd-modal-close" data-close>&times;</button></div>' +
      '<div class="pd-modal-body">' +
        '<p class="il-mom-note">Issues raised in <b>Issues &amp; Concerns</b> on this project. ' +
        'Tick the ones to record on this meeting — the issue, what caused it and its corrective ' +
        'action come across, and the minute keeps showing the register\'s live status.</p>' +
        '<input class="pd-input" id="il-gi-q" placeholder="Search issues…" autocomplete="off">' +
        '<div class="il-mom-getlist" id="il-gi-list"></div>' +
      '</div>' +
      '<div class="pd-modal-footer">' +
        '<span class="il-mom-note" id="il-gi-count" style="margin:0;flex:1;"></span>' +
        '<button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="il-gi-add" disabled>Add selected</button>' +
      '</div>');
    wireModalChrome(m, 640);

    var list = m.el.querySelector('#il-gi-list');
    var addBtn = m.el.querySelector('#il-gi-add');
    var countEl = m.el.querySelector('#il-gi-count');

    function rows() {
      var t = q.trim().toLowerCase();
      return ISSUES.filter(function (r) {
        if (!t) return true;
        return [r.description, r.department, r.champion, r.caused_by, r.corrective_action]
          .join(' ').toLowerCase().indexOf(t) >= 0;
      });
    }
    function paint() {
      var rs = rows();
      if (!ISSUES.length) {
        list.innerHTML = '<div class="il-empty" style="padding:12px;">No issue has been raised on this ' +
          'project yet. Raise one in Issues &amp; Concerns first.</div>';
      } else if (!rs.length) {
        list.innerHTML = '<div class="il-empty" style="padding:12px;">No issue matches that search.</div>';
      } else {
        list.innerHTML = rs.map(function (r) {
          var already = !!on[r.id], closed = (r.status || 'Open') === 'Closed';
          var dis = already || closed;
          return '<label class="il-gi-row' + (dis ? ' is-dis' : '') + '">' +
            '<input type="checkbox" data-issue="' + Fmt.esc(r.id) + '"' +
              (already ? ' checked' : (picked[r.id] ? ' checked' : '')) +
              (dis ? ' disabled' : '') + '>' +
            '<span class="il-mom-geti-txt">' + Fmt.esc(clip(r.description || '(no description)', 120)) + '</span>' +
            '<span class="il-mom-geti-meta">' + Fmt.esc(r.department || '—') +
              (r.champion ? ' · ' + Fmt.esc(r.champion) : '') + ' · ' + Fmt.esc(r.status || 'Open') +
              (already ? ' · already on this meeting' : (closed ? ' · closed in the register' : '')) +
            '</span></label>';
        }).join('');
        list.querySelectorAll('input[data-issue]').forEach(function (cb) {
          cb.onchange = function () {
            if (cb.checked) picked[cb.dataset.issue] = 1; else delete picked[cb.dataset.issue];
            sync();
          };
        });
      }
      sync();
    }
    function sync() {
      var n = Object.keys(picked).length;
      addBtn.disabled = !n;
      addBtn.textContent = n ? 'Add ' + n + ' to this meeting' : 'Add selected';
      countEl.textContent = ISSUES.length
        ? (rows().length + ' of ' + ISSUES.length + ' issue' + (ISSUES.length === 1 ? '' : 's'))
        : '';
    }

    var t = null;
    m.el.querySelector('#il-gi-q').oninput = function (e) {
      var v = e.target.value; clearTimeout(t);
      t = setTimeout(function () { q = v; paint(); }, 160);
    };
    addBtn.onclick = async function () {
      var ids = Object.keys(picked);
      if (!ids.length) return;
      addBtn.disabled = true; addBtn.textContent = 'Adding…';
      var added = 0;
      // ⚠️ Sequential, not Promise.all: momPullOneIssue derives the next
      // sequence number from what is already on the agenda, so parallel pulls
      // would race onto the same number.
      for (var k = 0; k < ids.length; k++) {
        try { if (await momPullOneIssue(momId, ids[k], { quiet: true })) added++; } catch (e) {}
      }
      m.close();
      UI.toast(added
        ? added + ' issue' + (added === 1 ? '' : 's') + ' recorded on this meeting'
        : 'Nothing was added', added ? 'ok' : 'warn');
      renderDetail();
    };
    paint();
    setTimeout(function () { try { m.el.querySelector('#il-gi-q').focus(); } catch (e) {} }, 30);
  }

  // ⚠️ ITEM 3 — the carry-over picker, replacing the always-visible dropdown.
  // One row per earlier meeting that actually still has something open on it
  // (momCarryable — the REGISTER decides openness for a linked minute), so the
  // modal can never list a meeting that would carry nothing across.
  function openCarryOverModal(momId) {
    var others = MOMS.filter(function (x) { return x.id !== momId && momCarryable(x).length; })
      .sort(function (a, b) { return String(b.meeting_date || '').localeCompare(String(a.meeting_date || '')); });
    var m = UI.modal(
      '<div class="pd-modal-header"><h3>Carry over minutes</h3>' +
        '<button class="pd-modal-close" data-close>&times;</button></div>' +
      '<div class="pd-modal-body">' +
        '<p class="il-mom-note">Bring whatever is still open on an earlier meeting onto this one. ' +
        'A carried minute is the SAME minute discussed again — its register link comes with it, so ' +
        'it is never chased twice. Running it again adds nothing that is already here.</p>' +
        (others.length
          ? '<div class="il-mom-getlist">' + others.map(function (x) {
              return '<button type="button" class="il-mom-geti" data-carry="' + Fmt.esc(x.id) + '">' +
                '<span class="il-mom-geti-txt">' + Fmt.esc(x.title || '(untitled)') + '</span>' +
                '<span class="il-mom-geti-meta">' +
                  (x.meeting_date ? Fmt.esc(Fmt.date(x.meeting_date)) + ' · ' : '') +
                  momCarryable(x).length + ' still open</span></button>';
            }).join('') + '</div>'
          : '<div class="il-empty" style="padding:12px;">No earlier meeting on this project has ' +
            'anything still open to carry over.</div>') +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button></div>');
    wireModalChrome(m, 560);
    m.el.querySelectorAll('[data-carry]').forEach(function (b) {
      b.onclick = function () { var id = b.dataset.carry; m.close(); momCarryOver(id); };
    });
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
  // ⚠️ `distribute`/`revert` (2026-09-02, owner item 9: "for each minute item,
  // history should also show when the minute item was distributed or reverted
  // to draft"). Distribution is a property of the MEETING, so it is logged onto
  // every one of its minutes at once — the history a reader opens is the
  // minute's, and "this was issued on the 4th" is part of that minute's story
  // even though the act covered its siblings too.
  var ITEM_HIST_LABELS = {
    create: 'Logged', update: 'Updated', hold: 'Put on hold', close: 'Closed',
    distribute: 'Distributed with the minutes', revert: 'Reverted to draft',
  };

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
    loadItemHistory(itemId);
  }
  async function loadItemHistory(itemId) {
    try {
      var res = await sb().from(HISTORY_TABLE_ITEM).select('*').eq('item_id', itemId)
        .order('changed_at', { ascending: false }).limit(200);
      ITEM_HISTORY[itemId] = res.error ? [] : (res.data || []);
    } catch (e) { ITEM_HISTORY[itemId] = []; }
    if (_momSel) renderDetail();
  }

  // ⚠️ OWNER ITEM 7 (2026-09-02) — "history need not show and hide, follow the
  // same set-up as issues and concerns". Issues can load one history per detail
  // page because a detail page IS one issue; a meeting is N minutes, so making
  // every card's history unconditional would have meant N round-trips per
  // render. This fetches the WHOLE meeting's history in ONE request keyed on
  // `.in('item_id', ids)` and fans it out per item.
  // ⚠️ An id already loaded, or already covered by a fetch in flight, is
  // dropped from the request — renderDetail() calls this on every repaint and
  // the completion handler repaints, so without that guard it is an infinite
  // fetch loop rather than a one-off load.
  var _momItemHistFetch = {};
  async function loadItemHistories(ids) {
    ids = (ids || []).filter(function (id) {
      return id && ITEM_HISTORY[id] === undefined && !_momItemHistFetch[id];
    });
    if (!ids.length) return;
    ids.forEach(function (id) { _momItemHistFetch[id] = true; });
    try {
      // ⚠️ PDb.selectAll, not a bare select: one meeting's minutes can carry
      // hundreds of history rows between them and a truncated read would print
      // a plausible-looking but incomplete audit trail.
      var all = await PDb.selectAll(HISTORY_TABLE_ITEM, function (q) { return q.in('item_id', ids); });
      var by = {};
      ids.forEach(function (id) { by[id] = []; });
      (all || []).forEach(function (h) { if (by[h.item_id]) by[h.item_id].push(h); });
      ids.forEach(function (id) {
        ITEM_HISTORY[id] = by[id].sort(function (a, b) {
          return String(b.changed_at || '').localeCompare(String(a.changed_at || ''));
        });
      });
    } catch (e) { ids.forEach(function (id) { ITEM_HISTORY[id] = []; }); }
    ids.forEach(function (id) { delete _momItemHistFetch[id]; });
    if (_momSel) renderDetail();
  }

  // ⚠️ Field-by-field before→after, mirroring the Issues register's own
  // HIST_FIELDS/issHistDiffHTML (item 7's "similar to the issues history").
  // `logItemHistory` already snapshots the WHOLE row before each change; this is
  // what turns that stored jsonb into something readable rather than a blob
  // nobody opens.
  var MI_HIST_FIELDS = [
    ['status', 'Status'], ['department', 'Department'], ['owner', 'Responsible'],
    ['issue', 'Issue / Agenda'], ['description', 'Description'],
    ['action_item', 'Action item'], ['type', 'Type'], ['item_no', 'No.'],
    ['schedule_activity_id', 'Activity discussed'],
    ['hold_reason', 'Reason for Hold'], ['closure_report', 'Closure note'],
    ['due_date', 'Target date'],
  ];
  function miHistNorm(v) { return (v === null || v === undefined) ? '' : String(v); }
  function miHistFieldHTML(key, val) {
    if (!val) return '<em>—</em>';
    if (key === 'due_date') return Fmt.esc(Fmt.date(val));
    return Fmt.esc(val).replace(/\n/g, '<br>');
  }
  // `before` is null on a `create` entry (nothing existed to compare against),
  // in which case this lists what was captured at creation instead of an arrow.
  // Unchanged fields are omitted entirely.
  function miHistDiffHTML(before, after) {
    after = after || {};
    var lines = MI_HIST_FIELDS.map(function (f) {
      var key = f[0], label = f[1];
      var a = miHistNorm(after[key]);
      if (!before) {
        if (!a) return '';
        return '<li><strong>' + Fmt.esc(label) + ':</strong> ' + miHistFieldHTML(key, a) + '</li>';
      }
      var b = miHistNorm(before[key]);
      if (b === a) return '';
      return '<li><strong>' + Fmt.esc(label) + ':</strong> ' + miHistFieldHTML(key, b) +
        ' &rarr; ' + miHistFieldHTML(key, a) + '</li>';
    }).filter(Boolean);
    return lines.length ? '<ul class="il-history-diff">' + lines.join('') + '</ul>' : '';
  }
  function itemHistoryHTML(itemId) {
    var list = ITEM_HISTORY[itemId];
    if (list === undefined) return '<p class="il-mom-note">Loading history…</p>';
    if (!list.length) {
      return '<p class="il-mom-note">No changes recorded yet — run <code>migrations/' +
        '2026-09-01-mom-schedules-attendees-item-history.sql</code> if this item has been updated ' +
        'and nothing appears here.</p>';
    }
    // ⚠️ Entry i's AFTER state is the snapshot the NEXT-more-recent entry
    // stored as its BEFORE (the list is newest-first); the most recent entry's
    // after-state is simply the live row, since no later entry exists to have
    // snapshotted it. Same reconstruction the Issues register uses.
    var current = MOM_ITEMS.find(function (x) { return x.id === itemId; }) || {};
    return '<ul class="il-history">' + list.map(function (h, i) {
      var after = i === 0 ? current : (list[i - 1].snapshot || {});
      return '<li class="il-history-i"><div class="il-history-top">' +
        '<span class="il-history-action">' + Fmt.esc(ITEM_HIST_LABELS[h.action] || h.action) + '</span>' +
        '<span class="il-history-when">' + Fmt.esc(Fmt.date(h.changed_at)) +
          (h.changed_by_department ? ' · ' + Fmt.esc(h.changed_by_department) : '') + '</span></div>' +
        (h.note ? '<div class="il-history-note">' + Fmt.esc(h.note).replace(/\n/g, '<br>') + '</div>' : '') +
        miHistDiffHTML(h.snapshot, after) +
      '</li>';
    }).join('') + '</ul>';
  }
  // Small `*` beside a required field's label — same shape as the Issues
  // module's own reqMark(), duplicated here for the same reason the People
  // Picker and chart helpers are: two small IIFEs in two files, not a shared
  // runtime.
  function reqMark(editable) { return editable ? ' <span class="il-req" title="Required">*</span>' : ''; }

  // The status cell is now JUST the pill. ⚠️ OWNER ITEM 6 (2026-09-02) —
  // "put on hold and close buttons should be beside the save minutes": the two
  // workflow buttons moved out of this meta cell and into the card's own action
  // footer (momItemWFButtonsHTML), beside Remove, where every other per-minute
  // action already lives. The reveal panel they open is full-width below the
  // text blocks (momItemWFPanelHTML) rather than crammed into a grid cell that
  // is sized for a status pill.
  function momItemStatusCellHTML(it, ro) {
    if (it.issue_id) {
      var iss = momIssueOf(it);
      var v = iss ? (iss.status || 'Open') : (it.status || 'Open');
      return '<span class="il-pill ' + statusClass(v) + '" title="Status follows the linked issue in Issues & Concerns">' +
        Fmt.esc(v) + '</span>';
    }
    var cur = it.status || 'Open';
    return '<span class="il-pill ' + statusClass(cur) + '">' + Fmt.esc(cur) + '</span>';
  }

  // The footer's Put On Hold / Close pair. Offered for an UNLINKED item only —
  // a linked item's status is the register's (see momItemStatusCellHTML), so
  // these would edit a `mom_items.status` value nothing displays. Suppressed
  // while that item's reveal panel is open, since the panel carries its own
  // Cancel/Confirm.
  function momItemWFButtonsHTML(it, ro) {
    if (ro || it.issue_id || _momItemWF[it.id]) return '';
    var cur = it.status || 'Open';
    var canHold = cur === 'Open', canClose = cur !== 'Closed';
    if (!canHold && !canClose) return '';
    return (canHold ? '<button class="pd-btn pd-btn-sm il-mi-wfstart" data-item="' + Fmt.esc(it.id) +
        '" data-wfstart="hold">Put On Hold</button>' : '') +
      (canClose ? '<button class="pd-btn pd-btn-sm il-mi-wfstart" data-item="' + Fmt.esc(it.id) +
        '" data-wfstart="close">Close</button>' : '');
  }

  // The hold / close reveal panel, full-width on the card.
  function momItemWFPanelHTML(it, ro) {
    var wf = _momItemWF[it.id];
    if (ro || it.issue_id || !wf) return '';
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
      // ⚠️ OWNER ITEM 5 (2026-09-02) — "instead of category, use department and
      // get department dropdown from issues". `DEPARTMENTS` is a verbatim copy of
      // the Issues register's own list (see its declaration). The legacy
      // `category` column is NOT dropped and its stored values still surface
      // through momUsedDepartments(), so a minute recorded before this change
      // keeps whatever it was filed under rather than silently reading as the
      // first option — the select-value trap this repo has been bitten by twice.
      momFieldHTML('Department', 'il-c-dept',
        '<select class="pd-select pd-input-sm il-mi" data-f="department"' + d + '>' +
        momOptions(DEPARTMENTS, momUsedDepartments(), momItemDept(it)) + '</select>',
        momItemDept(it)) +
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
        peoplePickerHTML('mom-own-' + it.id, it.owner_ids, championExtra(it.owner_ids, it.owner), ro),
        championText(it.owner_ids, it.owner)) +
      momFieldHTML('Target date', 'il-c-due',
        '<input class="pd-input pd-input-sm il-mi" data-f="due_date" type="date" value="' + dateVal(it.due_date) + '"' + d + '>',
        it.due_date ? Fmt.date(it.due_date) : '') +
      // ⚠️ OWNER ITEM 1 (2026-09-02) — "activity discussed in the meeting details
      // should be assigned to each minute, not to the whole meeting". One meeting
      // routinely covers several activities, so a single meeting-level link had to
      // be wrong for all but one of its minutes. The meeting-level field is gone
      // (see momDetailHTML) and this is its replacement, per minute.
      momFieldHTML('Activity discussed', 'il-c-mact', momItemActCellHTML(it, ro),
        momItemActLabel(it)) +
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
      // ITEM 6 — the hold/close reveal panel, full width (see momItemWFPanelHTML).
      momItemWFPanelHTML(it, ro) +
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
      // ⚠️ ITEM 6 — Put On Hold / Close live here now, beside the minute's own
      // other actions, rather than inside the Status meta cell.
      (function () {
        var wfb = momItemWFButtonsHTML(it, ro);
        return wfb ? '<div class="il-mi-f il-c-wf">' + wfb + '</div>' : '';
      })() +
      (ro ? '' : '<div class="il-mi-f il-c-del"><button class="pd-btn pd-btn-sm pd-btn-danger il-mi-del" title="Remove this minute">Remove</button></div>') +
      '</div>' +
      // ⚠️ OWNER ITEM 7 — the history is ALWAYS rendered; there is no Show/Hide
      // any more. Its rows arrive from one batched fetch per meeting
      // (loadItemHistories), so making it unconditional costs one round-trip for
      // the whole meeting rather than one per card.
      '<div class="il-mi-hist"><label class="il-mi-histlab">History</label>' +
        itemHistoryHTML(it.id) + '</div>' +
    '</div>';
  }

  // --------------------------------------------------- per-minute helpers ----
  // ITEM 5 — the department values this project has actually used, so a value
  // stored before DEPARTMENTS existed (or a legacy `category`) still appears in
  // the select that has to round-trip it.
  function momUsedDepartments() {
    var seen = {}, out = [];
    MOM_ITEMS.forEach(function (it) {
      var v = momItemDept(it);
      if (v && !seen[v]) { seen[v] = 1; out.push(v); }
    });
    return out;
  }
  // ⚠️ Falls back to the legacy `category` when `department` has never been set
  // on that row: the 2026-09-02 migration adds the column but back-fills
  // nothing, so without this every pre-existing minute would read as unfiled.
  function momItemDept(it) { return it.department || it.category || ''; }

  function momItemActLabel(it) {
    var id = it.schedule_activity_id;
    if (!id) return '';
    return id + (MOM_ACT_NAME[id] ? ' · ' + MOM_ACT_NAME[id] : '');
  }
  // The per-minute activity cell: the linked activity as a chip, plus one
  // button opening the shared picker modal. ⚠️ ONE modal rather than an inline
  // search box per card — a meeting with twenty minutes would otherwise carry
  // twenty live search inputs, twenty result panes and twenty debounced
  // queries against a 40k-row schedule.
  function momItemActCellHTML(it, ro) {
    var id = it.schedule_activity_id || '';
    var lab = momItemActLabel(it);
    if (!id) {
      return ro ? '<span class="il-noedit" title="Not linked to a schedule activity">—</span>'
        : '<button type="button" class="pd-btn pd-btn-sm il-mi-actpick" data-item="' + Fmt.esc(it.id) +
          '">Link activity…</button>';
    }
    return '<span class="il-mom-chip il-mi-actchip" title="' + Fmt.esc(lab) + '"><code>' + Fmt.esc(id) + '</code>' +
      (MOM_ACT_NAME[id] ? '<span>' + Fmt.esc(MOM_ACT_NAME[id]) + '</span>' : '') +
      (ro ? '' : '<button type="button" class="il-mi-actclear" data-item="' + Fmt.esc(it.id) +
        '" title="Unlink">✕</button>') + '</span>' +
      (ro ? '' : '<button type="button" class="pd-btn pd-btn-sm il-mi-actpick" data-item="' + Fmt.esc(it.id) +
        '">Change</button>');
  }

  // ITEM 1 — the shared activity picker, opened from one minute's card.
  // Reuses momActSearch (server-side, capped, and it says when it capped).
  function openItemActPicker(itemId) {
    var it = MOM_ITEMS.find(function (x) { return x.id === itemId; });
    if (!it) return;
    var m = UI.modal(
      '<div class="pd-modal-header"><h3>Activity discussed</h3>' +
        '<button class="pd-modal-close" data-close>&times;</button></div>' +
      '<div class="pd-modal-body">' +
        '<p class="il-mom-note">Search this project\'s schedule by Activity ID or name. ' +
        'The activity is recorded on this minute only, not on the whole meeting.</p>' +
        '<input class="pd-input" id="il-mia-q" placeholder="Search the schedule…" autocomplete="off">' +
        '<div class="il-mom-acres" id="il-mia-res" style="position:static;margin-top:8px;"></div>' +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button></div>');
    wireModalChrome(m, 560);
    var q = m.el.querySelector('#il-mia-q'), res = m.el.querySelector('#il-mia-res');
    var t = null;
    function paint(html) { res.innerHTML = html; }
    q.oninput = function () {
      clearTimeout(t);
      var term = q.value;
      t = setTimeout(async function () {
        if (String(term || '').trim().length < 2) { paint(''); return; }
        paint('<div class="il-mom-acrow">Searching…</div>');
        try {
          var hits = await momActSearch(term);
          if (hits === null) { paint(''); return; }
          if (!hits.length) { paint('<div class="il-mom-acrow">No matching activity.</div>'); return; }
          paint(hits.map(function (r) {
            return '<button type="button" class="il-mom-acrow" data-act="' + Fmt.esc(r.activity_id) +
              '" data-actn="' + Fmt.esc(r.activity_name || '') + '"><code>' + Fmt.esc(r.activity_id) +
              '</code> ' + Fmt.esc(r.activity_name || '') + '</button>';
          }).join('') + (hits.length >= 26
            ? '<div class="il-mom-acrow">Showing the first 26 — keep typing to narrow.</div>' : ''));
          res.querySelectorAll('[data-act]').forEach(function (b) {
            b.onclick = async function () {
              var id = b.dataset.act;
              MOM_ACT_NAME[id] = b.dataset.actn || '';
              m.close();
              if (await momSaveItemTolerant(itemId, { schedule_activity_id: id })) renderDetail();
            };
          });
        } catch (e) { paint('<div class="il-mom-acrow">' + Fmt.esc(e.message || e) + '</div>'); }
      }, 220);
    };
    setTimeout(function () { try { q.focus(); } catch (e) {} }, 30);
  }

  // ⚠️ `department` and `schedule_activity_id` on mom_items both arrive with
  // migrations/2026-09-02-meetings-rehaul.sql. PostgREST rejects the WHOLE row
  // on an unknown column, so without this a planner on an un-migrated database
  // would see a bare "column not found" and lose the edit. Only a MISSING
  // column is tolerated — a constraint or RLS refusal still fails loudly.
  async function momSaveItemTolerant(id, patch, histAction, histNote) {
    var ok = await momSaveItem(id, patch, histAction, histNote);
    if (ok) return true;
    var keys = Object.keys(patch).filter(function (k) {
      return k === 'department' || k === 'schedule_activity_id';
    });
    if (!keys.length) return false;
    var trimmed = Object.assign({}, patch);
    keys.forEach(function (k) { delete trimmed[k]; });
    if (!Object.keys(trimmed).length) {
      UI.toast('Not stored — run migrations/2026-09-02-meetings-rehaul.sql', 'warn');
      return false;
    }
    if (await momSaveItem(id, trimmed, histAction, histNote)) {
      UI.toast('Saved — ' + keys.join(', ') + ' needs migrations/2026-09-02-meetings-rehaul.sql', 'warn');
      return true;
    }
    return false;
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

  // ⚠️ PostgREST rejects the WHOLE row on one unknown column, so an un-run
  // migration would lose an entire carried/pulled minute rather than one field.
  // This names the column out of the error message so the caller can drop just
  // that one and retry. ⚠️ Only a MISSING column is matched — a constraint or an
  // RLS refusal must still fail loudly.
  var MIGRATE_COL = {
    department: '2026-09-02-meetings-rehaul.sql',
    schedule_activity_id: '2026-09-02-meetings-rehaul.sql',
    owner_ids: '2026-08-26-people-and-assignment.sql',
  };
  function missingColumn(err, payload) {
    var msg = String((err && err.message) || err || '');
    if (!/column|schema cache/i.test(msg)) return null;
    var keys = Object.keys(payload && payload.length ? (payload[0] || {}) : (payload || {}));
    for (var i = 0; i < keys.length; i++) {
      if (new RegExp("'" + keys[i] + "'|\\b" + keys[i] + "\\b").test(msg)) return keys[i];
    }
    return null;
  }
  function stripCol(payload, col) {
    if (payload && payload.length) {
      return payload.map(function (r) { var c = Object.assign({}, r); delete c[col]; return c; });
    }
    var c = Object.assign({}, payload); delete c[col]; return c;
  }

  // Shared by momPullIssues (bulk) and momPullOneIssue (a single pick from the
  // "Get from issue" panel) — one payload shape, so the two routes can never
  // disagree about what a pulled action looks like.
  // ⚠️ MODULE SCOPE, not nested inside momPullIssues — momPullOneIssue is a
  // sibling function, not a closure inside momPullIssues, so a declaration
  // nested in there is invisible to it (function declarations only hoist to
  // the top of their OWN enclosing function). Nesting it there was a real bug:
  // every click on a single issue in the "Get from issue" panel threw
  // "momIssuePayload is not defined" before ever reaching mom_items.insert.
  function momIssuePayload(r, momId, seq) {
    return {
      mom_id: momId, project_id: pid, seq: seq,
      // ⚠️ Type is 'Issue', because it is one. FYI would file a live problem under
      // the heading the PDF prints for information-only items.
      type: 'Issue',
      // ⚠️ The register's own department comes across (2026-09-02 item 5) —
      // a minute pulled in from an issue keeps the department it was raised
      // under rather than arriving unclassified for someone to guess at.
      // `category` is deliberately left unset: nothing writes it any more.
      department: r.department || null,
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
      // ⚠️ Tolerant of any un-run migration: the rejected column is dropped and
      // the pull retried, so the agenda still gets its issues and the planner is
      // told which field did not travel rather than losing the whole minute.
      var bad = missingColumn(e, payload);
      if (bad) {
        payload = stripCol(payload, bad);
        try {
          var ins2 = await sb().from('mom_items').insert(payload).select();
          if (ins2.error) throw ins2.error;
          (ins2.data || []).forEach(function (x) { MOM_ITEMS.push(x); });
          UI.toast('Added ' + take.length + ' open issue' + (take.length === 1 ? '' : 's') +
            ' — ' + bad + ' was not stored. Run migrations/' +
            (MIGRATE_COL[bad] || '2026-09-02-meetings-rehaul.sql'), 'warn');
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
  // ⚠️ `opts.quiet` suppresses the per-issue toast — the Get-from-issue modal
  // adds several at once and reports the total once, rather than stacking one
  // toast per pick.
  async function momPullOneIssue(momId, issueId, opts) {
    var quiet = opts && opts.quiet;
    var target = MOMS.find(function (x) { return x.id === (momId || _momSel); });
    if (!target || !canEditMinute(target) || momLocked(target)) return false;
    var r = ISSUES.find(function (x) { return x.id === issueId; });
    if (!r) { UI.toast('That issue could not be found — try refreshing.', 'error'); return false; }
    // ⚠️ Idempotent, same rule as the bulk pull: an issue already linked on this
    // agenda is skipped rather than added a second time.
    if (momItemsOf(target.id).some(function (it) { return it.issue_id === issueId; })) {
      if (!quiet) UI.toast('That issue is already on this agenda.', 'info');
      return false;
    }
    var seq = momItemsOf(target.id).length;
    var payload = momIssuePayload(r, target.id, seq);
    try {
      var ins = await sb().from('mom_items').insert(payload).select();
      if (ins.error) throw ins.error;
      (ins.data || []).forEach(function (x) { MOM_ITEMS.push(x); });
      if (!quiet) UI.toast('Added from the register.', 'ok');
      return true;
    } catch (e) {
      // ⚠️ Tolerant retry, now over ANY column the database has not caught up
      // with (owner_ids from the 2026-08-26 assignment migration, department
      // from 2026-09-02) — an un-run migration must cost one field, never the
      // whole minute.
      var bad = missingColumn(e, payload);
      if (bad) {
        payload = stripCol(payload, bad);
        try {
          var ins2 = await sb().from('mom_items').insert(payload).select();
          if (ins2.error) throw ins2.error;
          (ins2.data || []).forEach(function (x) { MOM_ITEMS.push(x); });
          if (!quiet) UI.toast('Added — ' + bad + ' was not stored. Run migrations/' +
            (MIGRATE_COL[bad] || '2026-09-02-meetings-rehaul.sql'), 'warn');
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
        item_no: it.item_no || null, category: it.category || null,
        department: it.department || null, type: it.type || null,
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
      // ⚠️ Retry once without whichever column the database does not have yet —
      // a carried minute losing its department beats losing the minute.
      if (ins.error) {
        var bad = missingColumn(ins.error, payload);
        if (!bad) throw ins.error;
        payload = stripCol(payload, bad);
        ins = await sb().from('mom_items').insert(payload).select();
        if (ins.error) throw ins.error;
        UI.toast('Carried over — ' + bad + ' was not stored. Run migrations/' +
          (MIGRATE_COL[bad] || '2026-09-02-meetings-rehaul.sql'), 'warn');
      }
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
      // Item 9 — every minute on this meeting records the act in its own
      // history. ⚠️ Best-effort and un-awaited, the same rule every other
      // logItemHistory call follows: the real write has already succeeded, and
      // a missing history table must not make a successful distribute read as
      // an error. ⚠️ `beforeRow` is null on purpose — nothing about the MINUTE
      // changed, so a field-by-field diff would be empty and misleading; the
      // action label plus its note is the whole entry.
      momItemsOf(momId).forEach(function (it) {
        logItemHistory(it.id, mom.project_id || pid, on ? 'distribute' : 'revert', null,
          (mom.title || 'these minutes') + (on ? ' were distributed' : ' were reverted to draft'));
      });
      UI.toast(on ? 'Minutes distributed' : 'Reverted to draft', 'ok');
      renderDetail();
      // Item 10 — "once distribute is hit, prompt user to email to attendees
      // confirmation." A prompt, not an automatic send: there is no mail
      // backend here (see momEmailMinutes), so the honest act is to offer the
      // person's own mail client pre-filled and let them press send.
      if (on) momPromptEmailAttendees(momId);
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
    // ⚠️ Patch the chips in place instead of re-rendering: a re-render here would
    // throw away whatever the planner has typed into the form while this was in
    // flight. Every minute linked to this activity gets its name filled in.
    var host = $('il-mom-view'); if (!host || !MOM_ACT_NAME[id]) return;
    MOM_ITEMS.forEach(function (it) {
      if (it.schedule_activity_id !== id) return;
      var card = host.querySelector('[data-item="' + String(it.id).replace(/"/g, '\\"') + '"]');
      var chip = card && card.querySelector('.il-mi-actchip');
      if (!chip) return;
      var nm = chip.querySelector('span');
      if (nm) nm.textContent = MOM_ACT_NAME[id];
      else chip.insertBefore(Object.assign(document.createElement('span'),
        { textContent: MOM_ACT_NAME[id] }), chip.querySelector('.il-mi-actclear') || null);
    });
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
      start_time: g('il-mom-stime') || null,
      end_time: g('il-mom-etime') || null,
      actual_start_time: g('il-mom-astime') || null,
      actual_end_time: g('il-mom-aetime') || null,
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
         'attendees_required', 'attendees_optional', 'attendees_actual',
         'start_time', 'end_time', 'actual_start_time', 'actual_end_time'].forEach(function (k) { delete stripped[k]; });
        try {
          var u2 = await sb().from('meeting_minutes').update(stripped).eq('id', mom.id);
          if (u2.error) throw u2.error;
          Object.assign(mom, stripped);
          UI.toast('Saved — some fields need migrations/2026-09-01-mom-schedules-attendees-item-history.sql ' +
            'and migrations/2026-09-02-meetings-rehaul.sql', 'warn');
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

  // ---- Export & Email (item 8) -------------------------------------------
  // ⚠️ Deliberately NOT sharing markup-building code with momDownloadPDF
  // below — that function is already verified end-to-end (a real produced
  // PDF was opened and checked, not just its source measured; see this
  // module's own CLAUDE.md for the "measuring the source of a render is not
  // verifying the render" lesson that cost a round of debugging once).
  // Touching it to extract a shared helper risks reintroducing exactly that
  // class of bug in an already-working export. A little duplication of the
  // field list across four formats is the safer trade.
  function momExportFilenameBase(mom) {
    return (mom.title || 'Meeting').replace(/[^a-zA-Z0-9_]/g, '_') + (momLocked(mom) ? '' : '_DRAFT');
  }
  function momExportItemText(it) { return it.action_item || it.description || ''; }
  function momDownloadBlob(filename, mime, content) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  function momExportHTML(momId) {
    var mom = MOMS.find(function (x) { return x.id === momId; });
    if (!mom) return;
    var items = momItemsOf(mom.id);
    var rowsHTML = items.length
      ? items.map(function (it, i) {
          var iss = momIssueOf(it);
          return '<tr><td>' + Fmt.esc(it.item_no || String((it.seq == null ? i : it.seq) + 1)) + '</td>' +
            '<td>' + Fmt.esc(momExportItemText(it)) + '</td>' +
            '<td>' + Fmt.esc(momItemDept(it)) + '</td>' +
            '<td>' + Fmt.esc(it.type || (it.issue_id ? 'Issue' : 'FYI')) + '</td>' +
            '<td>' + Fmt.esc(iss ? (iss.status || 'Open') : (it.status || 'Open')) + '</td>' +
            '<td>' + Fmt.esc(championText(it.owner_ids, it.owner) || '') + '</td>' +
            '<td>' + Fmt.esc(it.due_date ? Fmt.date(it.due_date) : '') + '</td></tr>';
        }).join('')
      : '<tr><td colspan="7">No minutes were recorded on this meeting.</td></tr>';
    var doc = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + Fmt.esc(mom.title || 'Meeting') + '</title>' +
      '<style>body{font-family:Arial,Helvetica,sans-serif;color:#1c1c1e;padding:24px;}' +
        'h1{color:#b40000;font-size:20px;margin:0 0 6px;} table{border-collapse:collapse;width:100%;margin-top:16px;}' +
        'th,td{border:1px solid #ddd;padding:6px 8px;font-size:12px;text-align:left;vertical-align:top;}' +
        'th{background:#f4f4f4;} .meta{margin:4px 0;font-size:13px;} .draft{background:#b40000;color:#fff;' +
        'padding:2px 8px;border-radius:3px;font-size:11px;font-weight:700;}</style></head><body>' +
      '<h1>' + Fmt.esc(projName) + ' — ' + Fmt.esc(mom.title || 'Meeting') +
        (momLocked(mom) ? '' : ' <span class="draft">DRAFT</span>') + '</h1>' +
      '<p class="meta"><b>Date:</b> ' + Fmt.esc(mom.meeting_date ? Fmt.date(mom.meeting_date) : '—') +
        (mom.start_time ? ' · ' + Fmt.esc(mom.start_time) + (mom.end_time ? '–' + Fmt.esc(mom.end_time) : '') : '') + '</p>' +
      (mom.venue ? '<p class="meta"><b>Venue:</b> ' + Fmt.esc(mom.venue) + '</p>' : '') +
      (mom.meeting_link ? '<p class="meta"><b>Meeting link:</b> ' + Fmt.esc(mom.meeting_link) + '</p>' : '') +
      (mom.attendees_required ? '<p class="meta"><b>Required attendees:</b> ' +
        Fmt.esc(championText(mom.attendees_required.ids, mom.attendees_required.text)) + '</p>' : '') +
      (mom.attendees_optional ? '<p class="meta"><b>Optional attendees:</b> ' +
        Fmt.esc(championText(mom.attendees_optional.ids, mom.attendees_optional.text)) + '</p>' : '') +
      (mom.attendees_actual ? '<p class="meta"><b>Actual attendees:</b> ' +
        Fmt.esc(championText(mom.attendees_actual.ids, mom.attendees_actual.text)) + '</p>' : '') +
      (mom.notes ? '<p class="meta"><b>Notes / discussion (Minutes of the Meeting):</b><br>' +
        Fmt.esc(mom.notes).replace(/\n/g, '<br>') + '</p>' : '') +
      '<h3>Minutes</h3><table><thead><tr><th>No.</th><th>Action item</th><th>Department</th><th>Type</th>' +
      '<th>Status</th><th>Responsible</th><th>Target date</th></tr></thead><tbody>' + rowsHTML + '</tbody></table>' +
    '</body></html>';
    momDownloadBlob(momExportFilenameBase(mom) + '_MOM.html', 'text/html', doc);
    UI.toast('HTML downloaded', 'ok');
  }

  function momExportXLSX(momId) {
    var mom = MOMS.find(function (x) { return x.id === momId; });
    if (!mom) return;
    if (!window.XLSX) { UI.toast('The Excel library did not load — check the connection and reload.', 'error'); return; }
    var items = momItemsOf(mom.id);
    var headRows = [
      ['Project', projName], ['Meeting', mom.title || ''],
      ['Date', mom.meeting_date ? Fmt.date(mom.meeting_date) : ''],
      ['Start / End', (mom.start_time || '') + (mom.end_time ? '–' + mom.end_time : '')],
      ['Venue', mom.venue || ''], ['Meeting link', mom.meeting_link || ''],
      ['Status', momLocked(mom) ? 'Distributed' : 'Draft'], [],
    ];
    var itemHead = ['No.', 'Action item', 'Department', 'Type', 'Status', 'Responsible', 'Target date'];
    var itemRows = items.map(function (it, i) {
      var iss = momIssueOf(it);
      return [
        it.item_no || String((it.seq == null ? i : it.seq) + 1), momExportItemText(it), momItemDept(it),
        it.type || (it.issue_id ? 'Issue' : 'FYI'), iss ? (iss.status || 'Open') : (it.status || 'Open'),
        championText(it.owner_ids, it.owner) || '', it.due_date ? Fmt.date(it.due_date) : '',
      ];
    });
    var ws = XLSX.utils.aoa_to_sheet(headRows.concat([itemHead]).concat(itemRows));
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Minutes');
    XLSX.writeFile(wb, momExportFilenameBase(mom) + '_MOM.xlsx');
    UI.toast('Excel file downloaded', 'ok');
  }

  async function momExportPPTX(momId) {
    var mom = MOMS.find(function (x) { return x.id === momId; });
    if (!mom) return;
    if (!window.PptxGenJS) { UI.toast('The PowerPoint library did not load — check the connection and reload.', 'error'); return; }
    var items = momItemsOf(mom.id);
    var pptx = new PptxGenJS();
    var title = pptx.addSlide();
    title.addText(mom.title || 'Meeting', { x: 0.5, y: 0.6, w: 9, h: 1, fontSize: 28, bold: true, color: 'B40000' });
    title.addText(projName + (momLocked(mom) ? '' : '  ·  DRAFT'), { x: 0.5, y: 1.5, w: 9, h: 0.5, fontSize: 14, color: '444444' });
    title.addText(
      (mom.meeting_date ? 'Date: ' + Fmt.date(mom.meeting_date) : '') +
      (mom.start_time ? '   ·   ' + mom.start_time + (mom.end_time ? '–' + mom.end_time : '') : '') +
      (mom.venue ? '\nVenue: ' + mom.venue : ''),
      { x: 0.5, y: 2.3, w: 9, h: 1, fontSize: 12, color: '444444' }
    );
    if (mom.notes) {
      var notesSlide = pptx.addSlide();
      notesSlide.addText('Notes / discussion (Minutes of the Meeting)', { x: 0.5, y: 0.4, w: 9, h: 0.6, fontSize: 20, bold: true, color: 'B40000' });
      notesSlide.addText(mom.notes, { x: 0.5, y: 1.2, w: 9, h: 4.5, fontSize: 12, color: '1c1c1e' });
    }
    if (items.length) {
      var rows = [['No.', 'Action item', 'Department', 'Status', 'Responsible']];
      items.forEach(function (it, i) {
        var iss = momIssueOf(it);
        rows.push([
          String(it.item_no || (i + 1)), clip(momExportItemText(it), 60), momItemDept(it),
          iss ? (iss.status || 'Open') : (it.status || 'Open'), championText(it.owner_ids, it.owner) || '',
        ]);
      });
      var actSlide = pptx.addSlide();
      actSlide.addText('Minutes', { x: 0.3, y: 0.3, w: 9, h: 0.5, fontSize: 20, bold: true, color: 'B40000' });
      actSlide.addTable(rows, { x: 0.3, y: 0.9, w: 9.4, fontSize: 9, border: { type: 'solid', color: 'DDDDDD', pt: 0.5 } });
    }
    await pptx.writeFile({ fileName: momExportFilenameBase(mom) + '_MOM.pptx' });
    UI.toast('PowerPoint downloaded', 'ok');
  }

  // ⚠️ mailto: can only carry text, never an attachment — this app has no
  // SMTP/API backend to actually send mail, so pre-filling the person's own
  // mail client (with a note to attach the downloaded file by hand) is the
  // honest version of "email these minutes," not a silent no-op that claims
  // to have sent something.
  function momEmailMinutes(momId) {
    var mom = MOMS.find(function (x) { return x.id === momId; });
    if (!mom) return;
    var items = momItemsOf(mom.id);
    var subject = 'Minutes of Meeting — ' + (mom.title || 'Meeting') +
      (mom.meeting_date ? ' (' + Fmt.date(mom.meeting_date) + ')' : '');
    var lines = [
      mom.title || 'Meeting',
      mom.meeting_date ? 'Date: ' + Fmt.date(mom.meeting_date) : '',
      mom.venue ? 'Venue: ' + mom.venue : '',
      '', 'Minutes:',
    ];
    if (items.length) {
      items.forEach(function (it, i) {
        lines.push((i + 1) + '. ' + momExportItemText(it) + (it.owner ? ' — ' + it.owner : ''));
      });
    } else {
      lines.push('(none recorded)');
    }
    lines.push('', '(Download the full minutes as HTML/PDF/Excel/PowerPoint from this meeting\'s ' +
      'Export menu and attach it by hand — a browser link cannot attach a file automatically.)');
    window.location.href = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(lines.join('\n'));
  }

  // Item 10 (2026-09-02) — offered right after a successful Distribute.
  // ⚠️ A confirm(), not a silent redirect: distributing and emailing are two
  // acts, and a mailto: that fires unasked hijacks the window to the person's
  // mail client the instant they press a button that said "Distribute".
  // ⚠️ It names the attendee tiers it can see so the planner knows WHO the
  // draft is meant to reach — this app stores attendee NAMES, not addresses
  // (the People Picker resolves to `users`/`people_directory` rows, and
  // exposing their email here would need a read this screen has no business
  // being granted), so the To: line is deliberately left for them to fill.
  function momPromptEmailAttendees(momId) {
    var mom = MOMS.find(function (x) { return x.id === momId; });
    if (!mom) return;
    var who = [];
    ['attendees_required', 'attendees_optional', 'attendees_actual'].forEach(function (k) {
      if (mom[k]) {
        var t = championText(mom[k].ids, mom[k].text);
        if (t) who.push(t);
      }
    });
    if (!who.length && mom.attendees) who.push(mom.attendees);
    if (!confirm('Minutes distributed.\n\nEmail them to the attendees now?' +
      (who.length ? '\n\nAttendees on record: ' + who.join('; ') : '\n\nNo attendees are recorded on this meeting yet.') +
      '\n\nThis opens your mail client with the minutes summarised in the body — ' +
      'add the recipients and press send.')) return;
    momEmailMinutes(momId);
  }

  // ---- Meeting LIST export (item 8's second sentence) --------------------
  function momExportListRows() { return momSortedRows(momUnifiedRows()); }
  function momExportListHTML() {
    var rows = momExportListRows();
    var body = rows.length
      ? rows.map(function (r) {
          return '<tr><td>' + (r.favorite ? '★' : '') + '</td><td>' + Fmt.esc(r.title) +
            (r.kind === 'series' ? ' (Recurring)' : '') + '</td><td>' + Fmt.esc(r.dateLabel) + '</td>' +
            '<td>' + (r.attendees || '') + '</td><td>' + Fmt.esc(r.location) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="5">No meetings recorded.</td></tr>';
    var doc = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Meetings — ' + Fmt.esc(projName) + '</title>' +
      '<style>body{font-family:Arial,Helvetica,sans-serif;color:#1c1c1e;padding:24px;}h1{color:#b40000;font-size:20px;}' +
      'table{border-collapse:collapse;width:100%;margin-top:16px;}th,td{border:1px solid #ddd;padding:6px 8px;font-size:12px;text-align:left;}' +
      'th{background:#f4f4f4;}</style></head><body><h1>Meetings — ' + Fmt.esc(projName) + '</h1>' +
      '<table><thead><tr><th></th><th>Title</th><th>Date / Frequency</th><th>Attendees</th><th>Location</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table></body></html>';
    momDownloadBlob('Meetings_' + (projName || 'Project').replace(/[^a-zA-Z0-9_]/g, '_') + '.html', 'text/html', doc);
    UI.toast('HTML downloaded', 'ok');
  }
  function momExportListXLSX() {
    if (!window.XLSX) { UI.toast('The Excel library did not load — check the connection and reload.', 'error'); return; }
    var rows = momExportListRows();
    var head = ['Favorite', 'Title', 'Date / Frequency', 'Attendees', 'Location'];
    var body = rows.map(function (r) {
      return [r.favorite ? 'Yes' : '', r.title + (r.kind === 'series' ? ' (Recurring)' : ''), r.dateLabel, r.attendees || '', r.location];
    });
    var ws = XLSX.utils.aoa_to_sheet([head].concat(body));
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Meetings');
    XLSX.writeFile(wb, 'Meetings_' + (projName || 'Project').replace(/[^a-zA-Z0-9_]/g, '_') + '.xlsx');
    UI.toast('Excel file downloaded', 'ok');
  }
  async function momExportListPDF() {
    if (typeof html2pdf !== 'function') { UI.toast('The PDF library did not load — check the connection and reload.', 'error'); return; }
    var rows = momExportListRows();
    var td = 'padding:5px 8px;border:1px solid #e5e5ea;';
    var rowsHTML = rows.length
      ? rows.map(function (r) {
          return '<tr><td style="' + td + '">' + (r.favorite ? '★' : '') + '</td>' +
            '<td style="' + td + '">' + Fmt.esc(r.title) + (r.kind === 'series' ? ' (Recurring)' : '') + '</td>' +
            '<td style="' + td + '">' + Fmt.esc(r.dateLabel) + '</td>' +
            '<td style="' + td + '">' + (r.attendees || '') + '</td>' +
            '<td style="' + td + '">' + Fmt.esc(r.location) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="5" style="' + td + '">No meetings recorded.</td></tr>';
    var holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:190mm;';
    var wrap = document.createElement('div');
    wrap.style.cssText = 'font-family:Arial,sans-serif;font-size:10px;color:#1c1c1e;width:190mm;padding:15mm 10mm;box-sizing:border-box;background:#fff;';
    wrap.innerHTML =
      '<div style="background:#b40000;padding:14px 20px;margin:-20px -20px 18px -20px;">' +
        '<div style="font-size:14px;font-weight:700;color:#fff;">Meetings — ' + Fmt.esc(projName) + '</div></div>' +
      '<table style="border-collapse:collapse;width:100%;"><thead><tr>' +
        '<th style="' + td + 'text-align:left;background:#f7f7f8;"></th>' +
        '<th style="' + td + 'text-align:left;background:#f7f7f8;">Title</th>' +
        '<th style="' + td + 'text-align:left;background:#f7f7f8;">Date / Frequency</th>' +
        '<th style="' + td + 'text-align:left;background:#f7f7f8;">Attendees</th>' +
        '<th style="' + td + 'text-align:left;background:#f7f7f8;">Location</th>' +
      '</tr></thead><tbody>' + rowsHTML + '</tbody></table>';
    holder.appendChild(wrap);
    document.body.appendChild(holder);
    try {
      await html2pdf().set({
        margin: [10, 10, 10, 10], filename: 'Meetings_' + (projName || 'Project').replace(/[^a-zA-Z0-9_]/g, '_') + '.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, allowTaint: true, logging: false, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      }).from(wrap).save();
      UI.toast('PDF downloaded', 'ok');
    } catch (e) {
      UI.toast('PDF error: ' + ((e && e.message) || e), 'error');
    } finally {
      if (holder.parentNode) holder.parentNode.removeChild(holder);
    }
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
            momPdfCell('Department', momItemDept(it)) +
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
        (items.length ? cards : momPdfField('Minutes', 'No minutes were recorded on this meeting.'));

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

  // ==========================================================================
  // ITEM 12 — REPORTING VIEW AS A SLIDE DECK.
  // "it should be a powerpoint style view where user can navigate and step
  // through slides while also editing. slide 1 meeting details, slide 2 agenda,
  // slide 3 onwards previous minutes 1 slide per minute."
  // ⚠️ The deck is a VIEW over the very markup the editor already rendered —
  // the same inputs, the same handlers — not a second read-only rendering of
  // the same data. That is what makes "while also editing" true rather than
  // approximately true, and it is why there is no separate slide template to
  // drift from the form.
  // ⚠️ Slides are found in the DOM, not counted from `MOM_ITEMS`: the minutes
  // list is filterable, so a count taken from the data would step past cards
  // that are not on screen.
  // ==========================================================================
  function momSlideEls(host) {
    var out = [];
    var det = host.querySelector('#il-mom-slide-details'); if (det) out.push(det);
    var ag = host.querySelector('#il-mom-slide-agenda'); if (ag) out.push(ag);
    host.querySelectorAll('.il-mi-card').forEach(function (c) { out.push(c); });
    return out;
  }
  function momSlideLabel(el, i) {
    if (el.id === 'il-mom-slide-details') return 'Meeting details';
    if (el.id === 'il-mom-slide-agenda') return 'Agenda';
    // ⚠️ Falls through on an EMPTY action item, not just on a missing one — a
    // minute recorded as "what was raised" with the action still to be agreed
    // is common, and `a || b` on the ELEMENTS would take the blank action
    // field and label the slide "Minute 3" while its issue text sits right
    // there. Caught by the harness, not by reading.
    var pick = function (sel) {
      var e = el.querySelector(sel);
      return e && e.value ? String(e.value).trim() : '';
    };
    var txt = pick('[data-f="action_item"]') || pick('[data-f="issue"]');
    return txt ? clip(txt, 48) : ('Minute ' + (i - 1));
  }
  function momApplySlides() {
    var host = $('il-mom-view'); if (!host) return;
    var root = host.querySelector('.il-mom-detail') || host;
    var old = host.querySelector('#il-mom-slidenav');
    if (old) old.remove();
    var els = momSlideEls(host);
    els.forEach(function (el) { el.hidden = false; el.classList.remove('il-slide'); });
    root.classList.toggle('il-mom-slides', !!_momReport);
    if (!_momReport || !els.length) return;

    if (_momSlide >= els.length) _momSlide = els.length - 1;
    if (_momSlide < 0) _momSlide = 0;
    els.forEach(function (el, i) {
      el.classList.add('il-slide');
      el.hidden = i !== _momSlide;
    });

    var nav = document.createElement('div');
    nav.className = 'il-mom-slidenav';
    nav.id = 'il-mom-slidenav';
    nav.innerHTML =
      '<button class="pd-btn pd-btn-sm" data-sl="prev"' + (_momSlide === 0 ? ' disabled' : '') + '>&larr; Back</button>' +
      '<div class="il-mom-slidename">' + Fmt.esc(momSlideLabel(els[_momSlide], _momSlide)) +
        '<span>Slide ' + (_momSlide + 1) + ' of ' + els.length + '</span></div>' +
      '<div class="il-mom-slidedots">' + els.map(function (el, i) {
        return '<button type="button" class="il-mom-slidedot' + (i === _momSlide ? ' on' : '') +
          '" data-sl="' + i + '" title="' + Fmt.esc(momSlideLabel(el, i)) + '"></button>';
      }).join('') + '</div>' +
      '<button class="pd-btn pd-btn-sm" data-sl="next"' +
        (_momSlide >= els.length - 1 ? ' disabled' : '') + '>Next &rarr;</button>';
    var tb = host.querySelector('.il-mom-toolbar');
    if (tb && tb.parentNode) tb.parentNode.insertBefore(nav, tb.nextSibling);
    else root.insertBefore(nav, root.firstChild);

    nav.querySelectorAll('[data-sl]').forEach(function (b) {
      b.onclick = function () {
        var v = b.dataset.sl;
        if (v === 'prev') _momSlide--;
        else if (v === 'next') _momSlide++;
        else _momSlide = parseInt(v, 10) || 0;
        // ⚠️ Re-applies rather than re-rendering: a re-render would throw away
        // whatever the presenter has typed into the slide they are leaving.
        momApplySlides();
        try { nav.scrollIntoView({ block: 'nearest' }); } catch (e) {}
      };
    });
  }
  // ⚠️ Arrow keys move the deck, but ONLY when focus is not in a field — the
  // whole point of this mode is that the slides stay editable, and stealing
  // ArrowLeft from a text input would make typing impossible.
  var _momSlideKeys = null;
  function momBindSlideKeys() {
    if (_momSlideKeys) return;
    _momSlideKeys = function (e) {
      if (!_momReport || !_momSel) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      _momSlide += (e.key === 'ArrowRight' ? 1 : -1);
      momApplySlides();
      e.preventDefault();
    };
    document.addEventListener('keydown', _momSlideKeys);
  }

  // ⚠️ DETAIL wiring only — the meeting picker and "+ New minutes" moved to the
  // List/Calendar browse views (wireBrowse), since selecting or creating a meeting
  // is how you GET to this view now, not something this view does to itself.
  function wireDetail() {
    var host = $('il-mom-view'); if (!host) return;
    if (!_momSel) return;
    // ⚠️ Per MINUTE now, not per meeting (item 1). De-duplicated so a meeting whose
    // twenty minutes all sit on one activity costs one lookup, not twenty.
    var _seenAct = {};
    momItemsOf(_momSel).forEach(function (it) {
      var a = it.schedule_activity_id;
      if (a && !_seenAct[a]) { _seenAct[a] = 1; momResolveActName(a); }
    });
    // ITEM 7 — the history is always on screen, so it is loaded for the whole
    // meeting in one request rather than per card on demand.
    loadItemHistories(momItemsOf(_momSel).map(function (it) { return it.id; }));

    // ---- item 4: the meeting's own agenda ---------------------------------
    wireAgendaList(host, 'il-mom-agenda', 'il-mom-agenda-add');
    var agSave = host.querySelector('#il-mom-agenda-save');
    if (agSave) agSave.onclick = async function () {
      var mom = MOMS.find(function (x) { return x.id === _momSel; });
      if (!mom || !canEditMinute(mom) || momLocked(mom)) return;
      var vals = agendaValuesOf(host, 'il-mom-agenda');
      agSave.disabled = true;
      try {
        // ⚠️ An empty agenda is stored as NULL, not as [] — "nobody set one" and
        // "someone set an empty one" are the same fact here, and every read
        // tests for a non-empty array.
        var u = await sb().from('meeting_minutes').update({ agenda: vals.length ? vals : null }).eq('id', mom.id);
        if (u.error) throw u.error;
        mom.agenda = vals.length ? vals : null;
        UI.toast('Agenda saved', 'ok');
      } catch (e) {
        UI.toast(/column|schema cache/i.test(e.message || '')
          ? 'Run migrations/2026-09-02-meetings-rehaul.sql in Supabase first — the agenda column is missing.'
          : (e.message || e), 'error');
      }
      agSave.disabled = false;
    };

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

    var favt = host.querySelector('#il-mom-favtoggle');
    if (favt) favt.onclick = function () { momToggleFavorite('meeting', _momSel); };

    var dist = host.querySelector('#il-mom-dist');
    if (dist) dist.onclick = function () {
      var cur = MOMS.find(function (x) { return x.id === _momSel; });
      momSetDistributed(_momSel, !momLocked(cur));
    };

    // ⚠️ NO "#il-mom-pullissues" wiring here any more — bringing issues in is
    // the Get-from-issue modal's job (openGetIssueModal), which ticks as many
    // as you like and adds them in one go.
    // ITEM 3 — one button, the source meetings live inside the modal.
    var cgo = host.querySelector('#il-mom-carrygo');
    if (cgo) cgo.onclick = function () { openCarryOverModal(_momSel); };

    // ⚠ Saves the header first when the user may edit: every export reads
    // MOMS, not the live form, so a title typed and not saved would be
    // missing from the file. Not when locked — the form is already disabled,
    // so this would be a pointless write to a distributed minute.
    var exportSel = host.querySelector('#il-mom-exportsel');
    if (exportSel) exportSel.onchange = async function () {
      var v = exportSel.value; exportSel.value = '';
      if (!v) return;
      var cur = MOMS.find(function (x) { return x.id === _momSel; });
      if (cur && canEditMinute(cur) && !momLocked(cur)) await momSaveHeader();
      if (v === 'html') momExportHTML(_momSel);
      else if (v === 'pdf') await momDownloadPDF(_momSel);
      else if (v === 'pptx') await momExportPPTX(_momSel);
      else if (v === 'xlsx') momExportXLSX(_momSel);
    };
    var emailBtn = host.querySelector('#il-mom-email');
    if (emailBtn) emailBtn.onclick = function () { momEmailMinutes(_momSel); };

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
        // ⚠️ `department` arrives with migrations/2026-09-02-meetings-rehaul.sql,
        // so it goes through the tolerant path: PostgREST rejects the whole row
        // on an unknown column and the planner would otherwise lose the edit.
        momSaveItemTolerant(id, patch);
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
    // ---- item 1: the per-minute activity link ------------------------------
    host.querySelectorAll('.il-mi-actpick').forEach(function (b) {
      b.onclick = function () { openItemActPicker(b.dataset.item); };
    });
    host.querySelectorAll('.il-mi-actclear').forEach(function (b) {
      b.onclick = async function () {
        if (await momSaveItemTolerant(b.dataset.item, { schedule_activity_id: null })) renderDetail();
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
    // ⚠️ OWNER ITEM 8 (2026-09-02) — "it should go to the ordinary Add Lessons
    // Learned page. no linking needed. user can just return to the meeting
    // minutes after." So the link carries no momId/momItem: the sibling opens
    // its own plain Add-a-lesson form, and the browser's Back comes straight
    // back to this meeting (both modules bind their screens to history state).
    host.querySelectorAll('.il-mi-lesson').forEach(function (b) {
      b.onclick = function () {
        location.href = '../issues-lessons/index.html?screen=lessons&newLesson=1';
      };
    });
    host.querySelectorAll('.il-mi-lesson-open').forEach(function (b) {
      b.onclick = function () {
        location.href = '../issues-lessons/index.html?screen=lessons&openLesson=' + encodeURIComponent(b.dataset.lesson);
      };
    });
    // ---- the "Get from issue" panel -------------------------------------------
    // ITEM 4 — the picker is a modal now (openGetIssueModal); the inline panel's
    // own search/add-all/per-row wiring went with it.
    var gib = host.querySelector('#il-mom-getissue');
    if (gib) gib.onclick = function () { openGetIssueModal(_momSel); };
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
        if (!confirm('Remove this minute?' +
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
      if (!confirm('Delete this meeting and its ' + items.length + ' minute(s)?' +
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

    // ---- item 12: the reporting deck --------------------------------------
    // ⚠️ LAST in wireDetail, after every control has been bound: momApplySlides
    // only hides and shows what is already there, so anything wired after it
    // would be wired on a hidden slide and work anyway — but the slide labels
    // read the live field values, which have to exist first.
    momBindSlideKeys();
    momApplySlides();

    // ⚠️ The meeting-level activity picker's wiring (#il-mom-actclear /
    // #il-mom-actq / #il-mom-acres, and the document click-away listener it
    // needed) is GONE with the field itself — item 1 moved the activity onto
    // each minute, where it is picked through a modal instead of an inline
    // search box per card. `_momActTimer` / `_momDocClick` went with it.
  }

  return { init: init };
})();
