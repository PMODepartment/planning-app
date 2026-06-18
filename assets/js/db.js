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
