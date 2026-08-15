// ============================================================================
// Planners Dashboard — Shared DB helpers (PDb) + formatters (Fmt)
// ----------------------------------------------------------------------------
// Cross-cutting data that EVERY module needs: the project list and the current
// user. Module-specific tables (e.g. risk_register) are owned by each module's
// own JS — this file only carries shared concerns so modules stay decoupled.
// ============================================================================

(function () {
  function sb() { return window.getSB(); }

  var PDb = {
    // ---- Keyset pagination (shared) ----
    // ⚠️ PostgREST caps a table read at 1000 rows SERVER-side, and a client `.limit()` cannot raise
    // it. A plain `.select()` on a growable table therefore returns a SILENTLY TRUNCATED result —
    // no error, no warning, just wrong KPIs/totals/charts. This has been found and fixed one module
    // at a time (project_schedule, drawing_register, progress_photos, material_submittal,
    // resource_assignments, activity_steps, wbs_nodes…), each reinventing the same loop. This is
    // that loop, once, so the next module doesn't have to rediscover it.
    //
    //   var rows = await PDb.selectAll('cash_flow_rollup', function (q) { return q.in('project_id', ids); });
    //
    // ⚠️ Paginates by `id` (the uuid PK) because a keyset cursor MUST be unique and non-null —
    // `sort_order`/`period`/`taken_at` are none of those, so they cannot be the cursor. Rows come
    // back in id order; **re-sort in memory** if you need a display order.
    async selectAll(table, apply, cols) {
      var out = [], last = null, PAGE = 1000;
      for (;;) {
        var q = sb().from(table).select(cols || '*');
        if (typeof apply === 'function') q = apply(q);
        q = q.order('id', { ascending: true }).limit(PAGE);
        if (last) q = q.gt('id', last);
        var res = await q;
        if (res.error) throw res.error;
        var page = res.data || [];
        out = out.concat(page);
        // A short page means the server had nothing more — the only safe terminator, since a full
        // page is ambiguous (it may or may not be the last).
        if (page.length < PAGE) return out;
        last = page[page.length - 1].id;
        // Defensive: a table whose `id` is not unique would loop forever otherwise.
        if (last == null) return out;
      }
    },

    // ---- Projects (shared across all modules) ----
    async getProjects() {
      var { data, error } = await sb()
        .from('projects').select('*').order('name');
      if (error) throw error;
      return data || [];
    },
    async getProject(id) {
      var { data, error } = await sb()
        .from('projects').select('*').eq('id', id).single();
      if (error) throw error;
      return data;
    },
    async createProject(p) {
      var { data, error } = await sb().from('projects').insert(p).select().single();
      if (error) throw error;
      return data;
    },
    async updateProject(id, p) {
      var { error } = await sb().from('projects').update(p).eq('id', id);
      if (error) throw error;
    },
    // Reversible — the everyday "retire a project" action. Sets the existing
    // projects.status to archived/active (same flag the Edit modal exposes and
    // portfolio-overview filters on); no data is removed. Admin-only (DB).
    async archiveProject(id, archive) {
      var { error } = await sb().rpc('admin_archive_project', {
        target: id, archive: archive !== false,
      });
      if (error) throw error;
    },
    // Hard delete. The RPC refuses if ANY module row still references the
    // project and names what's blocking — surface error.message to the admin.
    async deleteProject(id) {
      var { error } = await sb().rpc('admin_delete_project', { target: id });
      if (error) throw error;
    },

    // ---- Group Heads (the flat tag that replaced the workspace tree) ----
    // A project carries exactly one group_head_id. This is a lookup table, not
    // a tree: sort/filter/group by group head is the only structure needed, and
    // a lookup (rather than free text) is what keeps the grouping from
    // fragmenting on typos.
    async getGroupHeads() {
      var { data, error } = await sb()
        .from('group_heads').select('*').order('sort_order').order('name');
      if (error) throw error;
      return data || [];
    },
    async createGroupHead(g) {
      var { data, error } = await sb().from('group_heads').insert(g).select().single();
      if (error) throw error;
      return data;
    },
    async updateGroupHead(id, g) {
      var { error } = await sb().from('group_heads').update(g).eq('id', id);
      if (error) throw error;
    },
    // Hard delete. The RPC refuses while projects are still assigned and says
    // how many — surface error.message to the admin. Setting `active = false`
    // is the non-destructive way to retire one.
    async deleteGroupHead(id) {
      var { error } = await sb().rpc('admin_delete_group_head', { target: id });
      if (error) throw error;
    },

    // ---- Users (admin screens) ----
    async getAllUsers() {
      var { data, error } = await sb().from('users').select('*').order('name');
      if (error) throw error;
      return data || [];
    },
    async updateUser(id, u) {
      var { error } = await sb().from('users').update(u).eq('id', id);
      if (error) throw error;
    },
    // Delete a user completely (auth + profile) via the admin RPC. Frees their
    // email so they can request access again later. Admin-only (enforced in DB).
    async deleteUser(id) {
      var { error } = await sb().rpc('admin_delete_user', { target: id });
      if (error) throw error;
    },
    async updateLastLogin(id) {
      try { await sb().from('users').update({ last_login: new Date().toISOString() }).eq('id', id); } catch (e) {}
    },
  };

  // ---- Formatters (shared) ----
  var Fmt = {
    money: function (n) {
      if (n == null || isNaN(n)) return '—';
      return '₱' + Number(n).toLocaleString('en-PH', { maximumFractionDigits: 2 });
    },
    moneyShort: function (n) {
      if (n == null || isNaN(n)) return '—';
      var a = Math.abs(n);
      if (a >= 1e9) return '₱' + (n / 1e9).toFixed(2) + 'B';
      if (a >= 1e6) return '₱' + (n / 1e6).toFixed(2) + 'M';
      return Fmt.money(n);
    },
    date: function (d) {
      if (!d) return '—';
      var m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return d;
      var dt = new Date(+m[1], +m[2] - 1, +m[3]);
      return dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
    },
    esc: function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },
  };

  window.PDb = PDb;
  window.Fmt = Fmt;
})();
