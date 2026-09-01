/* Verification harness stub — NOT shipped, NOT loaded by index.html.
   Stands in for AppAuth + the Supabase client only; db.js / ui.js / icons.js /
   epc-rcm.js / module.js are the REAL files, so what the harness renders is what
   the app renders. */
window.PDHarness = (function () {
  var DB = {};

  function result(data) { return { data: data, error: null }; }

  function builder(table) {
    var st = { eq: {}, gt: null, single: false };
    function rows() {
      var out = (DB[table] || []).slice();
      Object.keys(st.eq).forEach(function (k) {
        out = out.filter(function (r) { return String(r[k]) === String(st.eq[k]); });
      });
      if (st.gt) out = out.filter(function (r) { return String(r.id) > String(st.gt); });
      out.sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
      return out;
    }
    var api = {
      select: function () { return api; },
      eq: function (c, v) { st.eq[c] = v; return api; },
      in: function () { return api; },
      gt: function (c, v) { st.gt = v; return api; },
      order: function () { return api; },
      limit: function () { return api; },
      single: function () { st.single = true; return api; },
      insert: function (row) {
        row = Array.isArray(row) ? row[0] : row;
        row.id = 'new' + (Math.random().toString(36).slice(2, 7));
        (DB[table] = DB[table] || []).push(row);
        console.log('[harness] INSERT', table, row);
        return api;
      },
      update: function (patch) { st.patch = patch; return api; },
      delete: function () { st.del = true; return api; },
      then: function (res, rej) {
        var out;
        if (st.patch) {
          (DB[table] || []).forEach(function (r) {
            if (String(r.id) === String(st.eq.id)) Object.assign(r, st.patch);
          });
          console.log('[harness] UPDATE', table, st.eq.id, st.patch);
          out = result(null);
        } else if (st.del) {
          DB[table] = (DB[table] || []).filter(function (r) { return String(r.id) !== String(st.eq.id); });
          console.log('[harness] DELETE', table, st.eq.id);
          out = result(null);
        } else {
          var rs = rows();
          out = result(st.single ? (rs[0] || null) : rs);
        }
        return Promise.resolve(out).then(res, rej);
      }
    };
    return api;
  }

  // A 1×1 transparent PNG stands in for every signed photo URL — enough to prove
  // the <img> path renders, without a network.
  var PX = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">' +
    '<rect width="120" height="120" fill="#8aa"/><circle cx="60" cy="46" r="22" fill="#fff"/>' +
    '<ellipse cx="60" cy="104" rx="36" ry="26" fill="#fff"/></svg>');

  var sbStub = {
    from: builder,
    storage: {
      from: function () {
        return {
          createSignedUrls: function (paths) {
            return Promise.resolve(result((paths || []).map(function (p) { return { path: p, signedUrl: PX }; })));
          },
          createSignedUrl: function (p) { return Promise.resolve(result({ signedUrl: PX })); },
          upload: function (p) { console.log('[harness] UPLOAD', p); return Promise.resolve(result({ path: p })); },
          remove: function (ps) { console.log('[harness] REMOVE', ps); return Promise.resolve(result(null)); }
        };
      }
    },
    rpc: function () { return Promise.resolve(result([])); },
    channel: function () {
      var ch = { on: function () { return ch; }, subscribe: function () { return ch; },
                 track: function () { return Promise.resolve(); }, unsubscribe: function () {},
                 send: function () {}, presenceState: function () { return {}; } };
      return ch;
    },
    removeChannel: function () {}
  };

  // db.js reaches for window.getSB (set by auth.js), not AppAuth.getSB.
  window.getSB = function () { return sbStub; };
  window.AppAuth = {
    getSB: function () { return sbStub; },
    requireLogin: function (cb) { cb({ id: 'u1' }, { id: 'u1', name: 'Harness User', role: 'planner' }); },
    canAccessProject: function () { return true; },
    logout: function () {}
  };

  return {
    install: function (data) {
      Object.keys(data).forEach(function (k) {
        if (k === 'projects') DB.projects = data.projects;
        else DB[k] = data[k];
      });
      // PDCollab / PDSync are optional everywhere in the modules; leaving them
      // undefined is a real, supported runtime state (offline.js/collab.js are
      // separate scripts) and keeps the harness honest about the fallbacks.
    },
    db: DB
  };
})();
