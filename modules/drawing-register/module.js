// ============================================================================
// Drawing Register — REFERENCE MODULE (file-upload pattern)
// ----------------------------------------------------------------------------
// Second reference module. Where Risk Register shows plain CRUD, this one adds
// the pattern every file-bearing module needs:
//   • upload a file to a PRIVATE Supabase Storage bucket ('drawing-register')
//   • store only the object PATH in the table (file_url column)
//   • view the file later via a short-lived SIGNED URL (createSignedUrl)
//
// Requires: migrations/2026-06-18-storage-buckets.sql (creates the bucket+policies)
// Copy this pattern for Progress Photos and Material Submittal.
// ============================================================================

window.DrawingRegister = (function () {
  var TABLE = 'drawing_register';
  var BUCKET = 'drawing-register';
  var profile = null;
  var pid = null;
  var rows = [];
  var filters = { status: '', discipline: '', search: '' };

  var DISCIPLINES = ['Architectural','Structural','Civil','Mechanical','Electrical',
                     'Plumbing','Fire Protection','Auxiliary','Landscape','Survey'];
  var STATUSES = ['For Review','Approved','Superseded'];

  function sb() { return AppAuth.getSB(); }

  async function init(user, prof) {
    profile = prof;
    await loadProjects();
    document.getElementById('dr-add').onclick = function () { openForm(null); };
    document.getElementById('dr-project').onchange = function (e) {
      pid = e.target.value; sessionStorage.setItem('pd_project', pid); load();
    };
    ['dr-f-status','dr-f-discipline','dr-f-search'].forEach(function (id) {
      var el = document.getElementById(id);
      el.oninput = el.onchange = function () {
        filters.status     = document.getElementById('dr-f-status').value;
        filters.discipline = document.getElementById('dr-f-discipline').value;
        filters.search     = document.getElementById('dr-f-search').value.toLowerCase().trim();
        render();
      };
    });
    if (pid) load();
  }

  async function loadProjects() {
    var projects = await PDb.getProjects();
    var sel = document.getElementById('dr-project');
    pid = sessionStorage.getItem('pd_project') || (projects[0] && projects[0].id) || null;
    sel.innerHTML = '<option value="">Select project…</option>' +
      projects.map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === pid ? ' selected' : '') + '>' + Fmt.esc(p.name) + '</option>';
      }).join('');
  }

  async function load() {
    if (!pid) return;
    var res = await sb().from(TABLE).select('*')
      .eq('project_id', pid).order('drawing_no', { ascending: true });
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    rows = res.data || [];
    var ds = {};
    rows.forEach(function (r) { if (r.discipline) ds[r.discipline] = 1; });
    document.getElementById('dr-f-discipline').innerHTML = '<option value="">All disciplines</option>' +
      Object.keys(ds).sort().map(function (d) {
        return '<option' + (filters.discipline === d ? ' selected' : '') + '>' + Fmt.esc(d) + '</option>';
      }).join('');
    render();
  }

  function filtered() {
    return rows.filter(function (r) {
      if (filters.status && r.status !== filters.status) return false;
      if (filters.discipline && r.discipline !== filters.discipline) return false;
      if (filters.search) {
        var hay = [r.drawing_no, r.title, r.discipline, r.revision, r.remarks].join(' ').toLowerCase();
        if (hay.indexOf(filters.search) === -1) return false;
      }
      return true;
    });
  }

  function statusCls(s) {
    return s === 'Approved' ? 'dr-ok' : s === 'Superseded' ? 'dr-old' : 'dr-review';
  }

  function render() {
    var data = filtered();
    var t = document.getElementById('dr-table');
    if (!rows.length) {
      t.innerHTML = '<tr><td style="padding:24px;color:var(--pd-muted);">No drawings yet for this project. Click “Add drawing”.</td></tr>';
      return;
    }
    t.innerHTML =
      '<thead><tr><th>Drawing No.</th><th>Title</th><th>Discipline</th><th>Rev</th>' +
      '<th>Status</th><th>Issued</th><th>Due</th><th>File</th><th></th></tr></thead><tbody>' +
      (data.map(function (r) {
        return '<tr>' +
          '<td><strong>' + Fmt.esc(r.drawing_no) + '</strong></td>' +
          '<td>' + Fmt.esc(r.title) + (r.remarks ? '<div class="dr-sub">' + Fmt.esc(r.remarks) + '</div>' : '') + '</td>' +
          '<td>' + Fmt.esc(r.discipline) + '</td>' +
          '<td>' + Fmt.esc(r.revision) + '</td>' +
          '<td><span class="dr-pill ' + statusCls(r.status) + '">' + Fmt.esc(r.status) + '</span></td>' +
          '<td>' + Fmt.date(r.issue_date) + '</td>' +
          '<td>' + Fmt.date(r.due_date) + '</td>' +
          '<td>' + (r.file_url ? '<button class="pd-btn" data-view="' + Fmt.esc(r.file_url) + '">View</button>' : '<span style="color:var(--pd-muted);">—</span>') + '</td>' +
          '<td style="white-space:nowrap;"><button class="pd-btn" data-edit="' + r.id + '">Edit</button> ' +
            '<button class="pd-btn" data-del="' + r.id + '">Delete</button></td>' +
        '</tr>';
      }).join('') || '<tr><td colspan="9" style="padding:24px;color:var(--pd-muted);">No drawings match the filters.</td></tr>') +
      '</tbody>';

    t.querySelectorAll('[data-view]').forEach(function (b) { b.onclick = function () { viewFile(b.dataset.view); }; });
    t.querySelectorAll('[data-edit]').forEach(function (b) { b.onclick = function () { openForm(rows.find(function (x){ return x.id === b.dataset.edit; })); }; });
    t.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { del(rows.find(function (x){ return x.id === b.dataset.del; })); }; });
  }

  // ---- Open a private file via short-lived signed URL ----
  async function viewFile(path) {
    var res = await sb().storage.from(BUCKET).createSignedUrl(path, 60); // 60s
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    window.open(res.data.signedUrl, '_blank');
  }

  // ---- Upload helper: returns the stored object path ----
  async function uploadFile(file) {
    var safe = file.name.replace(/[^\w.\-]+/g, '_');
    var path = pid + '/' + Date.now() + '_' + safe;     // project-foldered
    var res = await sb().storage.from(BUCKET).upload(path, file, { upsert: false });
    if (res.error) throw res.error;
    return path;
  }

  function openForm(r) {
    if (!pid) { UI.toast('Select a project first', 'warn'); return; }
    var isNew = !r; r = r || {};
    function opts(list, val) { return list.map(function (o){ return '<option' + (val === o ? ' selected' : '') + '>' + o + '</option>'; }).join(''); }
    var m = UI.modal(
      '<h2 style="margin-top:0;">' + (isNew ? 'Add drawing' : 'Edit drawing') + '</h2>' +
      '<div style="display:flex;gap:10px;">' +
        '<div class="pd-field" style="flex:0 0 160px;"><label>Drawing No.</label><input class="pd-input" id="f-no" value="' + Fmt.esc(r.drawing_no) + '"></div>' +
        '<div class="pd-field" style="flex:1;"><label>Title</label><input class="pd-input" id="f-title" value="' + Fmt.esc(r.title) + '"></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;">' +
        '<div class="pd-field" style="flex:1;"><label>Discipline</label><select class="pd-select" id="f-disc"><option value="">—</option>' + opts(DISCIPLINES, r.discipline) + '</select></div>' +
        '<div class="pd-field" style="flex:0 0 90px;"><label>Revision</label><input class="pd-input" id="f-rev" value="' + Fmt.esc(r.revision) + '" placeholder="A"></div>' +
        '<div class="pd-field" style="flex:1;"><label>Status</label><select class="pd-select" id="f-status">' + opts(STATUSES, r.status || 'For Review') + '</select></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;">' +
        '<div class="pd-field" style="flex:1;"><label>Issue date</label><input class="pd-input" type="date" id="f-issue" value="' + (r.issue_date || '') + '"></div>' +
        '<div class="pd-field" style="flex:1;"><label>Due date</label><input class="pd-input" type="date" id="f-due" value="' + (r.due_date || '') + '"></div>' +
      '</div>' +
      '<div class="pd-field"><label>Remarks</label><textarea class="pd-textarea" id="f-rem" rows="2">' + Fmt.esc(r.remarks) + '</textarea></div>' +
      '<div class="pd-field"><label>Drawing file (PDF/DWG/image)' + (r.file_url ? ' — a file is already attached; choosing a new one replaces it' : '') + '</label>' +
        '<input class="pd-input" type="file" id="f-file" accept=".pdf,.dwg,.dxf,.png,.jpg,.jpeg"></div>' +
      '<div style="text-align:right;margin-top:6px;"><button class="pd-btn" id="f-cancel">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="f-save">Save</button></div>'
    );
    m.el.querySelector('#f-cancel').onclick = m.close;
    m.el.querySelector('#f-save').onclick = async function () {
      var saveBtn = m.el.querySelector('#f-save');
      var data = {
        project_id: pid,
        drawing_no: m.el.querySelector('#f-no').value.trim(),
        title:      m.el.querySelector('#f-title').value.trim(),
        discipline: m.el.querySelector('#f-disc').value,
        revision:   m.el.querySelector('#f-rev').value.trim(),
        status:     m.el.querySelector('#f-status').value,
        issue_date: m.el.querySelector('#f-issue').value || null,
        due_date:   m.el.querySelector('#f-due').value || null,
        remarks:    m.el.querySelector('#f-rem').value.trim(),
        updated_at: new Date().toISOString(),
      };
      if (!data.title && !data.drawing_no) { UI.toast('Drawing No. or Title required', 'warn'); return; }
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      try {
        var fileEl = m.el.querySelector('#f-file');
        if (fileEl.files && fileEl.files[0]) {
          saveBtn.textContent = 'Uploading…';
          data.file_url = await uploadFile(fileEl.files[0]);
        }
        if (isNew) {
          data.created_by = profile.id;          // REQUIRED for RLS
          var ins = await sb().from(TABLE).insert(data);
          if (ins.error) throw ins.error;
        } else {
          var upd = await sb().from(TABLE).update(data).eq('id', r.id);
          if (upd.error) throw upd.error;
        }
        UI.toast('Saved', 'ok'); m.close(); load();
      } catch (e) {
        UI.toast(e.message, 'error'); saveBtn.disabled = false; saveBtn.textContent = 'Save';
      }
    };
  }

  async function del(r) {
    if (!confirm('Delete drawing "' + (r.drawing_no || r.title) + '"?')) return;
    if (r.file_url) { try { await sb().storage.from(BUCKET).remove([r.file_url]); } catch (e) {} }
    var res = await sb().from(TABLE).delete().eq('id', r.id);
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    UI.toast('Deleted', 'ok'); load();
  }

  return { init: init };
})();
