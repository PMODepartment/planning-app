/* ============================================================================
 * PDAttach — "a record can carry its paperwork", as ONE implementation.
 *
 * Lifted verbatim out of modules/contracts-claims/module.js (2026-09-15 h),
 * where it was written, and parameterised. ⚠️⚠️ THE POINT OF THIS FILE IS THE
 * ORDERING RULES BELOW, NOT THE UPLOAD. They are three decisions that are only
 * obvious once you have got them wrong:
 *
 *   1. The OBJECT is uploaded BEFORE the row is written, so a failed upload can
 *      never leave a row pointing at nothing.
 *   2. If the row write then fails, the object is ROLLED BACK, so a failed
 *      insert cannot leave a file in the bucket with nothing to explain it.
 *   3. On removal the ROW GOES FIRST, because a failed object delete leaves a
 *      recoverable orphan whereas the reverse leaves an attachment that will
 *      not open.
 *
 * A second copy of those rules is a second set of ways to get them wrong, and
 * this repo has paid for a hand-copied duplicate at least three times — the
 * location normaliser (three copies, one of them wrong: it matched a 13th-floor
 * leaf to "3rd Floor"), the S-curve maths copied into portfolio-overview, and
 * the change-order insert. So the schedule does NOT get its own copy; it gets
 * an instance of this.
 *
 * ⚠️ IT OWNS NO GLOBAL STATE. `create()` returns an instance holding its own
 * cache, so two modules on one page cannot see each other's attachments.
 *
 * ⚠️ IT EMITS CLASSES UNDER THE CALLER'S OWN PREFIX (`cls`), so each module
 * keeps styling its own panel and adopting this file changes not one pixel of
 * an existing screen. That is deliberate: the alternative — neutral shared
 * classes — would have meant retargeting contracts-claims' working CSS in the
 * same commit that moved its JS, which is two risks where one will do.
 * ========================================================================== */
window.PDAttach = (function () {
  'use strict';

  function esc(s) { return (window.Fmt && Fmt.esc) ? Fmt.esc(s == null ? '' : String(s)) : String(s == null ? '' : s); }
  function toast(m, k) { if (window.UI && UI.toast) UI.toast(m, k); }

  function sizeStr(b) {
    var n = Number(b);
    if (!isFinite(n) || n <= 0) return '';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  /* cfg:
   *   sb()            -> the supabase client        (required)
   *   projectId()     -> the project id             (required)
   *   userId()        -> the signed-in user's id    (required)
   *   table           -> attachments table name     (required)
   *   bucket          -> storage bucket id          (required)
   *   ownerCol        -> the column naming the parent row ('record_id' | 'activity_id')
   *   migration       -> path quoted in the "run this" hint
   *   types           -> [[value, label], ...] — MUST match the table's CHECK
   *   cls             -> css class prefix, e.g. 'cc' -> .cc-att
   *   pathSeg         -> object-path segment, e.g. 'records' | 'activities'
   *   extraOf(key)    -> optional; extra columns to store on insert
   *   staleOf(row)    -> optional; a string to show when the row looks mis-pointed
   *   parentWord      -> what the caller calls the thing files hang off ('record')
   *
   * ⚠️ `parentWord` exists so contracts-claims keeps the EXACT two sentences it
   * already shipped ("…when you save the record", "The record was saved, but…").
   * Extracting a function should not quietly reword a screen that was signed off
   * — a copy change is a change, and it belongs in its own commit with a reason.
   */
  function create(cfg) {
    var C = cfg || {};
    var cls = C.cls || 'pd';
    var noun = C.parentWord || 'record';
    var ownerCol = C.ownerCol || 'record_id';
    var TYPES = C.types || [['other', 'Other']];
    var MAP = {};      // ownerKey -> [row]
    var ERR = null;    // the read's own failure, kept apart from "no rows"

    function sb() { return C.sb(); }
    function label(t) {
      for (var i = 0; i < TYPES.length; i++) if (TYPES[i][0] === t) return TYPES[i][1];
      return 'Other';
    }

    /* ⚠️ TOLERANT BY CONSTRUCTION. Until the migration is run the table is
       absent, and the module around this must still open — the panel then says
       the one useful thing (run the migration, by name) instead of taking the
       screen down with it. ⚠️ And the failure is kept in ERR rather than being
       folded into an empty MAP: "could not be read" and "nothing attached yet"
       are different facts and the panel says different things about them. */
    async function load(ids) {
      MAP = {}; ERR = null;
      var list = (ids || []).filter(Boolean);
      if (!list.length) return;
      try {
        var res = await sb().from(C.table).select('*').in(ownerCol, list);
        if (res.error) throw res.error;
        (res.data || []).forEach(function (a) {
          (MAP[a[ownerCol]] = MAP[a[ownerCol]] || []).push(a);
        });
      } catch (e) { MAP = {}; ERR = (e && e.message) || String(e); }
    }

    /* The same read, scoped by PROJECT instead of by a list of parents.
       ⚠️⚠️ THIS EXISTS BECAUSE `.in()` CANNOT BE USED ON THE SCHEDULE. A project can carry 16,000
       activities, and PostgREST puts `in.(…)` in the URL — a list that long is refused long before
       it is answered. One project-scoped read returns every attachment on the project instead, and
       the grouping happens here.
       ⚠️ It pages through PDb.selectAll where available: PostgREST caps a read at 1000 rows
       SERVER-SIDE WITH NO ERROR, and a silently truncated read here means files that exist and
       cannot be seen. selectAll pages on `id`, which this table has — the check
       `tools/selectall-key.js` exists for exactly the case where it does not. */
    async function loadProject(projectId) {
      MAP = {}; ERR = null;
      if (!projectId) return;
      try {
        var data;
        if (window.PDb && PDb.selectAll) {
          data = await PDb.selectAll(C.table, function (q) { return q.eq('project_id', projectId); });
        } else {
          var res = await sb().from(C.table).select('*').eq('project_id', projectId);
          if (res.error) throw res.error;
          data = res.data || [];
        }
        (data || []).forEach(function (a) {
          (MAP[a[ownerCol]] = MAP[a[ownerCol]] || []).push(a);
        });
      } catch (e) { MAP = {}; ERR = (e && e.message) || String(e); }
    }

    function of(key) { return (key && MAP[key]) || []; }
    function count(key) { return of(key).length; }
    function error() { return ERR; }

    function find(attId) {
      var hit = null, owner = null;
      Object.keys(MAP).forEach(function (k) {
        (MAP[k] || []).forEach(function (x) { if (x.id === attId) { hit = x; owner = k; } });
      });
      return { row: hit, owner: owner };
    }

    /* Upload one file against a parent that EXISTS. Returns the inserted row, or throws. */
    async function upload(key, file, docType) {
      var safe = String(file.name || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-90);
      var path = C.projectId() + '/' + (C.pathSeg || 'items') + '/' + key + '/' +
                 docType + '-' + Date.now() + '-' + safe;

      // (1) object first — a failed upload must never leave a row pointing at nothing.
      var up = await sb().storage.from(C.bucket).upload(path, file, { upsert: false });
      if (up.error) {
        throw new Error(up.error.message +
          (/bucket/i.test(up.error.message) ? ' — the ' + C.bucket + ' bucket is missing.' : ''));
      }

      var row = { project_id: C.projectId(), doc_type: docType, file_path: path,
                  file_name: file.name, file_size: file.size, uploaded_by: C.userId() };
      row[ownerCol] = key;
      if (typeof C.extraOf === 'function') {
        var ex = C.extraOf(key) || {};
        Object.keys(ex).forEach(function (k) { row[k] = ex[k]; });
      }

      var ins = await sb().from(C.table).insert(row).select().single();
      if (ins.error) {
        // (2) roll the object back rather than leave it orphaned in the bucket
        await sb().storage.from(C.bucket).remove([path]);
        throw new Error(ins.error.message +
          (/relation|does not exist/i.test(ins.error.message)
            ? ' — run ' + C.migration + ' in the Supabase SQL editor.' : '') + ' (upload rolled back)');
      }
      (MAP[key] = MAP[key] || []).push(ins.data);
      return ins.data;
    }

    /* The bucket is private, so the URL is minted on demand and never stored. */
    async function open(attId) {
      var a = find(attId).row;
      if (!a) return;
      var s = await sb().storage.from(C.bucket).createSignedUrl(a.file_path, 60);
      if (s.error || !s.data) {
        toast('Could not open the file: ' + ((s.error && s.error.message) || 'no signed URL'), 'error');
        return;
      }
      window.open(s.data.signedUrl, '_blank', 'noopener');
    }

    async function remove(attId) {
      var f = find(attId), a = f.row, owner = f.owner;
      if (!a || !confirm('Remove "' + (a.file_name || 'this file') + '"? The file is deleted from storage.')) return false;
      // (3) row first: a failed object delete leaves a recoverable orphan, the
      //     reverse leaves a row whose file will not open.
      var del = await sb().from(C.table).delete().eq('id', attId);
      if (del.error) { toast(del.error.message, 'error'); return false; }
      MAP[owner] = (MAP[owner] || []).filter(function (x) { return x.id !== attId; });
      var rm = await sb().storage.from(C.bucket).remove([a.file_path]);
      if (rm.error) toast('Row removed, but the stored file could not be deleted — it is orphaned, not lost.', 'error');
      else toast('Removed.', 'success');
      return true;
    }

    /* ---- the panel --------------------------------------------------------
       `key` may be null: that is the NEW-record case, where files are staged and
       flushed by flush() once the parent has an id. `staged` is the caller's own
       array, so two callers each keep their own pending list without this
       instance holding per-caller state. */
    function panelHTML(key, staged, canEdit) {
      var live = of(key);
      var rows = live.map(function (a) {
        /* ⚠️ The stale note is the whole reason `activity_name` is stored. It is
           a WARNING, never a correction — nothing is re-pointed, because only a
           person can say whether the id was reissued or the work was renamed. */
        var stale = (typeof C.staleOf === 'function') ? C.staleOf(a) : '';
        return '<li class="' + cls + '-att' + (stale ? ' ' + cls + '-att-stale' : '') + '">' +
          '<span class="' + cls + '-att-n">' + esc(a.file_name || 'file') +
          '<i>' + esc(label(a.doc_type)) + (sizeStr(a.file_size) ? ' · ' + sizeStr(a.file_size) : '') +
          (stale ? ' · ' + esc(stale) : '') + '</i></span>' +
          '<button type="button" class="pd-btn ' + cls + '-att-open" data-att="' + esc(a.id) + '">Open</button>' +
          (canEdit ? '<button type="button" class="pd-btn ' + cls + '-att-del" data-att="' + esc(a.id) + '">Remove</button>' : '') +
          '</li>';
      }).join('');

      var pend = (staged || []).map(function (f, i) {
        return '<li class="' + cls + '-att ' + cls + '-att-pend"><span class="' + cls + '-att-n">' +
          esc(f.file.name) + '<i>' + esc(label(f.type)) +
          (sizeStr(f.file.size) ? ' · ' + sizeStr(f.file.size) : '') + ' · not uploaded yet</i></span>' +
          '<button type="button" class="pd-btn ' + cls + '-att-unstage" data-i="' + i + '">Remove</button></li>';
      }).join('');

      return '<ul class="' + cls + '-atts">' + rows + pend + '</ul>' +
        (!rows && !pend ? '<p class="' + cls + '-hint">No files attached yet.</p>' : '') +
        (ERR ? '<p class="' + cls + '-hint">The attachments table could not be read — run <code>' +
          esc(C.migration) + '</code> in the Supabase SQL editor, then reload.</p>' : '') +
        (canEdit
          ? '<div class="' + cls + '-att-add">' +
              '<select class="pd-select ' + cls + '-att-type">' + TYPES.map(function (t) {
                return '<option value="' + esc(t[0]) + '">' + esc(t[1]) + '</option>'; }).join('') + '</select>' +
              '<input type="file" class="' + cls + '-att-file" />' +
              '<span class="' + cls + '-att-st"></span>' +
            '</div>' +
            (key ? '' : '<p class="' + cls + '-hint">Files are uploaded when you save the ' + esc(noun) + '.</p>')
          : '');
    }

    /* Wire one panel. `get`/`set` read and write the caller's staged array so
       this function owns no state of its own. `paint` redraws whatever surface
       the panel is sitting on. */
    function panelWire(root, key, get, set, paint) {
      root.querySelectorAll('.' + cls + '-att-open').forEach(function (b) {
        b.onclick = function () { open(b.dataset.att); };
      });
      root.querySelectorAll('.' + cls + '-att-del').forEach(function (b) {
        b.onclick = async function () { if (await remove(b.dataset.att)) paint(); };
      });
      root.querySelectorAll('.' + cls + '-att-unstage').forEach(function (b) {
        b.onclick = function () { var a = get().slice(); a.splice(Number(b.dataset.i), 1); set(a); paint(); };
      });
      var fi = root.querySelector('.' + cls + '-att-file'), ty = root.querySelector('.' + cls + '-att-type');
      if (!fi) return;
      fi.onchange = async function () {
        var f = fi.files && fi.files[0]; if (!f) return;
        var dt = ty ? ty.value : 'other';
        /* ⚠️ A parent that already exists uploads NOW; one that does not is
           staged. The planner sees the difference stated on the row ("not
           uploaded yet"), never guesses it. */
        if (!key) { set(get().concat([{ file: f, type: dt }])); fi.value = ''; paint(); return; }
        var st = root.querySelector('.' + cls + '-att-st');
        if (st) st.textContent = 'Uploading…';
        try { await upload(key, f, dt); toast('Attached.', 'success'); }
        catch (e) { toast('Attach failed: ' + ((e && e.message) || e), 'error'); }
        if (st) st.textContent = '';
        fi.value = ''; paint();
      };
    }

    /* Flush a staged list against a parent that now exists. Failures are
       reported per file and do NOT undo the parent — the row is the fact the
       planner came to save, the file is evidence for it, and losing the record
       because a PDF would not upload is the worse trade. */
    async function flush(key, staged) {
      if (!key || !staged || !staged.length) return;
      var bad = [];
      for (var i = 0; i < staged.length; i++) {
        try { await upload(key, staged[i].file, staged[i].type); }
        catch (e) { bad.push(staged[i].file.name + ': ' + ((e && e.message) || e)); }
      }
      if (bad.length) {
        toast('The ' + noun + ' was saved, but ' + bad.length + ' file' + (bad.length === 1 ? '' : 's') +
          ' could not be attached — ' + bad[0], 'error');
      } else {
        toast(staged.length + ' file' + (staged.length === 1 ? '' : 's') + ' attached.', 'success');
      }
    }

    return {
      load: load, of: of, count: count, error: error, label: label,
      upload: upload, open: open, remove: remove,
      panelHTML: panelHTML, panelWire: panelWire, flush: flush,
      types: function () { return TYPES.slice(); }
    };
  }

  return { create: create, sizeStr: sizeStr };
})();
