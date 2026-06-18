// ============================================================================
// Module Template — copy this folder to modules/<your-key>/ and adapt.
// Demonstrates the required pattern: shared auth, project context (pd_project),
// project-scoped queries, created_by stamping, Fmt.esc on injected text.
//
// Replace TABLE and the column rendering with your module's needs.
// ============================================================================

window.MyModule = (function () {
  var TABLE = 'risk_register';      // <-- change to your module's table
  var pid = null;                   // current project id
  var profile = null;

  function sb() { return AppAuth.getSB(); }

  async function init(user, prof) {
    profile = prof;
    await loadProjects();
    document.getElementById('btn-add').onclick = onAdd;
    document.getElementById('project-picker').onchange = function (e) {
      pid = e.target.value;
      sessionStorage.setItem('pd_project', pid);   // shared project context
      load();
    };
    if (pid) load();
  }

  async function loadProjects() {
    var projects = await PDb.getProjects();
    var sel = document.getElementById('project-picker');
    pid = sessionStorage.getItem('pd_project') || (projects[0] && projects[0].id) || null;
    sel.innerHTML = '<option value="">Select project…</option>' +
      projects.map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === pid ? ' selected' : '') + '>' +
          Fmt.esc(p.name) + '</option>';
      }).join('');
  }

  async function load() {
    if (!pid) return;
    var { data, error } = await sb().from(TABLE).select('*')
      .eq('project_id', pid).order('created_at', { ascending: false });
    if (error) { UI.toast(error.message, 'error'); return; }
    render(data || []);
  }

  function render(rows) {
    var t = document.getElementById('records');
    if (!rows.length) { t.innerHTML = '<tr><td style="padding:24px;color:var(--pd-muted);">No records yet.</td></tr>'; return; }
    t.innerHTML =
      '<thead><tr><th>Title</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' +
          '<td>' + Fmt.esc(r.title) + '</td>' +
          '<td>' + Fmt.esc(r.status) + '</td>' +
          '<td>' + Fmt.date(r.created_at) + '</td>' +
          '<td><button class="pd-btn" data-del="' + r.id + '">Delete</button></td>' +
        '</tr>';
      }).join('') + '</tbody>';
    t.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () { del(b.getAttribute('data-del')); };
    });
  }

  async function onAdd() {
    if (!pid) { UI.toast('Pick a project first', 'warn'); return; }
    var title = prompt('Title:');
    if (!title) return;
    var { error } = await sb().from(TABLE).insert({
      project_id: pid,
      title: title,
      status: 'Open',
      created_by: profile.id,     // REQUIRED — RLS depends on this
    });
    if (error) { UI.toast(error.message, 'error'); return; }
    UI.toast('Added', 'ok'); load();
  }

  async function del(id) {
    if (!confirm('Delete this record?')) return;
    var { error } = await sb().from(TABLE).delete().eq('id', id);
    if (error) { UI.toast(error.message, 'error'); return; }
    UI.toast('Deleted', 'ok'); load();
  }

  return { init: init };
})();
