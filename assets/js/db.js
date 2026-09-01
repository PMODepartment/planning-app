// ============================================================================
// Planners Dashboard — Shared DB helpers (PDb) + formatters (Fmt)
// ----------------------------------------------------------------------------
// Cross-cutting data that EVERY module needs: the project list and the current
// user. Module-specific tables (e.g. risk_register) are owned by each module's
// own JS — this file only carries shared concerns so modules stay decoupled.
// ============================================================================

(function () {
  function sb() { return window.getSB(); }

  // The people roster, fetched once per page. See PDb.getPeople().
  var _people = null;

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
    /* ⚠️ TOLERANT OF A COLUMN THIS DATABASE DOES NOT HAVE YET. PostgREST answers an
       unmigrated column with PGRST204 and REJECTS THE WHOLE ROW, so one new field would
       throw away every other value the admin just typed — the exact failure the contracts
       module hit on 2026-08-27 with `package_id`. Drops the column PostgREST named, retries,
       and reports which fields were not stored so the migration still gets run.
       ⚠️ ONLY a missing column is tolerated. A constraint violation or an RLS refusal still
          fails loudly: a save that silently discarded real data would be the worse bug. */
    _missingCol(err) {
      var m = String((err && err.message) || '');
      if (!/PGRST204|schema cache|column/i.test(m)) return null;
      var q = m.match(/'([a-z0-9_]+)' column/i) || m.match(/column "?([a-z0-9_]+)"?/i);
      return q ? q[1] : null;
    },
    async _tolerant(run, payload) {
      var body = Object.assign({}, payload), dropped = [];
      for (var i = 0; i < 6; i++) {
        var res = await run(body);
        if (!res.error) return { data: res.data, dropped: dropped };
        var col = PDb._missingCol(res.error);
        if (!col || !(col in body)) throw res.error;
        delete body[col]; dropped.push(col);
      }
      throw new Error('Could not save the project after dropping: ' + dropped.join(', '));
    },
    async createProject(p) {
      var r = await PDb._tolerant(function (body) {
        return sb().from('projects').insert(body).select().single();
      }, p);
      PDb._warnDropped(r.dropped);
      return r.data;
    },
    async updateProject(id, p) {
      var r = await PDb._tolerant(function (body) {
        return sb().from('projects').update(body).eq('id', id);
      }, p);
      PDb._warnDropped(r.dropped);
    },
    // Names the column's OWN migration, never a generic "run the migrations" —
    // a hint that points at the wrong file sends whoever reads it hunting in it.
    _warnDropped(dropped) {
      if (!dropped || !dropped.length) return;
      var MIG = {
        program: 'migrations/2026-08-27-project-program.sql',
        wpm_project_id: 'migrations/2026-08-27-package-external-codes.sql',
        eng_project_id: 'migrations/2026-08-27-package-external-codes.sql',
        planners_project_id: 'migrations/2026-08-27-package-external-codes.sql'
      };
      var files = {};
      dropped.forEach(function (c) { if (MIG[c]) files[MIG[c]] = 1; });
      var names = Object.keys(files);
      var msg = 'Saved, but this database has no ' + dropped.join(', ') + ' column' +
        (dropped.length > 1 ? 's' : '') + ' — that value was NOT stored.' +
        (names.length ? ' Run ' + names.join(' and ') + ', then save again.' : '');
      if (window.UI && UI.toast) UI.toast(msg, 'warn'); else console.warn(msg);
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

    // ---- Packages (a contract package INSIDE a project) ----
    // Project -> Package -> module records. See migrations/2026-08-19-packages.sql.
    // ⚠️ A package is NOT the Main-Contract/Change-Order split — that is
    // `scope_type`, a tag on the activity itself, so a CO can sit inside the
    // construction sequence where the work is. The two axes are orthogonal.
    async getPackages(projectId) {
      var q = sb().from('packages').select('*');
      if (projectId) q = q.eq('project_id', projectId);
      var { data, error } = await q.order('sort_order').order('code');
      if (error) throw error;
      return data || [];
    },
    /* Tolerant of an unmigrated column, for the same reason the project writes are:
       PostgREST rejects the WHOLE row on one unknown column, so adding the external-code
       mappings would otherwise throw away the code, name, dates and amount the planner had
       just typed. See _projWrite above. */
    async createPackage(p) {
      var r = await PDb._tolerant(function (body) {
        return sb().from('packages').insert(body).select().single();
      }, p);
      PDb._warnDropped(r.dropped);
      return r.data;
    },
    async updatePackage(id, p) {
      var r = await PDb._tolerant(function (body) {
        return sb().from('packages').update(body).eq('id', id);
      }, p);
      PDb._warnDropped(r.dropped);
    },
    // Guarded delete. The Project Schedule now carries `package_id` on activities
    // and WBS nodes (2026-08-19-schedule-package.sql), so the RPC refuses while
    // anything still points at the package and says how many — a raw FK error, or
    // worse the ON DELETE SET NULL silently unassigning a few hundred activities,
    // tells the planner nothing. Setting the package to archived retires it
    // without touching the schedule.
    async deletePackage(id) {
      var { error } = await sb().rpc('admin_delete_package', { target: id });
      if (error) throw error;
    },

    // ---- Dashboard metrics (management band) ----
    // Aggregate a module's rows into the named figures IT declared. Returns {} when the module
    // declares no metrics, so a caller can treat "no spec" and "no data" the same way.
    //
    //   dash: { table: 'project_schedule', metrics: [
    //     { key:'finish', agg:'max', column:'end_date' },
    //     { key:'poc',    agg:'wavg', column:'percent_complete', weight:'duration_days' } ] }
    //
    async moduleMetrics(spec, projectId) {
      if (!spec || !spec.table || !projectId || (!(spec.metrics && spec.metrics.length) && !spec.recent)) return {};
      var col = spec.projectCol || 'project_id';
      // Only what the spec asked for — plus id, which selectAll paginates on.
      var want = { id: 1 };
      (spec.metrics || []).forEach(function (m) {
        if (m.column) want[m.column] = 1;
        if (m.weight) want[m.weight] = 1;
      });
      if (spec.exclude && spec.exclude.column) want[spec.exclude.column] = 1;
      (spec.metrics || []).forEach(function (m) {
        // ⚠️ m.amount is sumEarned's fallback money column — omit it here and the derivation
        // silently reads undefined on every row, i.e. the metric comes back null and the panel
        // says 'not loaded' for a project that is fully loaded.
        [m.x, m.y, m.group, m.from, m.to, m.pct, m.doneCol, m.amount].forEach(function (c) { if (c) want[c] = 1; });
        (m.where || []).forEach(function (w) { if (w && w.column) want[w.column] = 1; });
      });
      if (spec.recent) {
        (spec.recent.columns || []).forEach(function (c) { want[c] = 1; });
        if (spec.recent.orderBy) want[spec.recent.orderBy] = 1;
        if (spec.recent.pathCol) want[spec.recent.pathCol] = 1;
      }
      var rows;
      try {
        rows = await PDb.selectAll(spec.table, function (q) { return q.eq(col, projectId); },
          Object.keys(want).join(','));
      } catch (e) {
        // A metric spec naming a column the project's database does not have yet is a spec/migration
        // problem, not a reason to blank the whole band. Report nothing for this module and let the
        // others render.
        return { __error: (e && e.message) || String(e) };
      }
      // ⚠️ Rows the module says are not real records — a WBS summary row is not an activity, and
      // counting it would inflate every figure on the card.
      if (spec.exclude && spec.exclude.column && spec.exclude.values) {
        rows = rows.filter(function (r) { return spec.exclude.values.indexOf(r[spec.exclude.column]) === -1; });
      }
      var out = { __rows: rows.length };
      // A metric may narrow the rows it looks at: [{column, values}] — every clause must match.
      // ⚠️ Declared by the module, because only the module knows that record_type 'Contract' and
      // 'Change Order' are different things. The shell just applies the clauses it was given.
      function keep(r, where) {
        if (!where) return true;
        for (var w = 0; w < where.length; w++) {
          var c = where[w];
          if (!c || !c.column) continue;
          var v = r[c.column];
          if (c.values) { if (c.values.indexOf(v) === -1) return false; }
          // ⚠️ `absent` is how a module says "not yet resolved" without the shell knowing what
          // resolution means — an unresolved claim is one with no date_resolved.
          else if (c.absent) { if (!(v == null || v === '')) return false; }
          else if (v == null || v === '') return false;         // "has a value at all"
        }
        return true;
      }
      function numOf(v) { var n = +v; return isFinite(n) ? n : null; }
      (spec.metrics || []).forEach(function (m) {
        // ---- 2x2 matrix: counts in four quadrants from two numeric columns -------------------
        // ⚠️ The SPLIT is declared, not assumed. likelihood/impact run 1..5 and influence/interest
        // 1..4, so a hard-coded midpoint would be wrong for one of them.
        if (m.agg === 'matrix2') {
          var q = { hh: 0, hl: 0, lh: 0, ll: 0, n: 0 };
          for (var mi = 0; mi < rows.length; mi++) {
            var mr = rows[mi]; if (!keep(mr, m.where)) continue;
            var xv = numOf(mr[m.x]), yv = numOf(mr[m.y]);
            if (xv == null || yv == null) continue;
            var hiX = xv >= m.split, hiY = yv >= m.split;
            q[(hiY ? 'h' : 'l') + (hiX ? 'h' : 'l')]++; q.n++;
          }
          out[m.key] = q;
          return;
        }
        // ---- per-group spans: min start / max finish for each value of a column ---------------
        if (m.agg === 'groupSpan') {
          var g = {}, order = [];
          for (var gi = 0; gi < rows.length; gi++) {
            var gr = rows[gi]; if (!keep(gr, m.where)) continue;
            var key = gr[m.group]; if (key == null || key === '') continue;
            var a0 = gr[m.from], b0 = gr[m.to];
            if (!g[key]) { g[key] = { key: key, from: a0 || null, to: b0 || null, n: 0, done: 0, sum: 0, wsum: 0 }; order.push(key); }
            var e = g[key];
            if (a0 && (!e.from || a0 < e.from)) e.from = a0;
            if (b0 && (!e.to || b0 > e.to)) e.to = b0;
            e.n++;
            var pv = numOf(gr[m.pct]), wv = numOf(gr[m.weight]);
            if (pv != null && wv != null && wv > 0) { e.sum += pv * wv; e.wsum += wv; }
            if (m.doneValues && m.doneCol && m.doneValues.indexOf(gr[m.doneCol]) !== -1) e.done++;
          }
          out[m.key] = order.map(function (k) {
            var e = g[k];
            e.pct = e.wsum > 0 ? (e.sum / e.wsum) : null;
            return e;
          });
          return;
        }
        // ---- an ordered series: one x column, N y columns ---------------------------------------
        // Declared, not assumed: the module names its x axis and its y series, so this stays as
        // ignorant of what an S-curve is as the rest of this engine.
        // ⚠️ A point is kept only when x is present AND at least one y is numeric. Dropping the
        // whole row when ONE series is null would silently shorten the other series; keeping a row
        // with no y at all would draw a gap that looks like a reading of zero.
        if (m.agg === 'series') {
          var ys = [].concat(m.y || []);
          var pts = [];
          for (var si = 0; si < rows.length; si++) {
            var sr = rows[si]; if (!keep(sr, m.where)) continue;
            var xv2 = sr[m.x]; if (xv2 == null || xv2 === '') continue;
            var pt = { x: xv2 }, any = false;
            for (var yi = 0; yi < ys.length; yi++) {
              var yv2 = numOf(sr[ys[yi]]);
              pt[ys[yi]] = yv2;
              if (yv2 != null) any = true;
            }
            if (any) pts.push(pt);
          }
          pts.sort(function (a, b) { return a.x < b.x ? -1 : a.x > b.x ? 1 : 0; });
          out[m.key] = pts;
          return;
        }
        // ---- weighted % of TIME elapsed between two date columns, as at today -----------------
        // This is how a planned value is expressed without the shell knowing what a baseline is:
        // the module names the two date columns and the weight, and gets back "where the plan says
        // this should be". ⚠️ Rows missing either date are EXCLUDED, not counted as 0 — the same
        // rule the schedule module applies to its own planned figures.
        if (m.agg === 'elapsed') {
          var ew = 0, ea = 0, today = new Date(); today.setHours(0, 0, 0, 0);
          for (var ei = 0; ei < rows.length; ei++) {
            var er = rows[ei]; if (!keep(er, m.where)) continue;
            var f0 = er[m.from], t0 = er[m.to]; if (!f0 || !t0) continue;
            var wv2 = numOf(er[m.weight]); if (wv2 == null || wv2 <= 0) continue;
            var fd = new Date(f0 + 'T00:00:00'), td = new Date(t0 + 'T00:00:00');
            if (isNaN(+fd) || isNaN(+td)) continue;
            var frac = (today <= fd) ? 0 : (today >= td) ? 1 : ((today - fd) / (td - fd));
            ew += wv2; ea += wv2 * frac * 100;
          }
          out[m.key] = ew > 0 ? (ea / ew) : null;
          return;
        }
        var vals = [], wsum = 0, wacc = 0, n = 0, sum = 0;
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i];
          if (!keep(r, m.where)) continue;
          if (m.agg === 'sumWhere') { var sv = numOf(r[m.column]); if (sv != null) { sum += sv; n++; } continue; }
          // ---- sumEarned: a stored figure when there is one, else amount x percent ------------
          // ⚠️ Earned value is DERIVED when nobody has typed one. Owner 2026-08-26: "there is a
          // column for activity % complete, now that POC should be multiplied with the specified
          // amount on that activity." A plain `sum` over `earned_value` reported NOTHING on a
          // fully cost-loaded schedule -- so the dashboard's EVM panel said "earned value and cost
          // are not loaded" for a project carrying a Planned IBB and a % complete on every line.
          // ⚠️ A STORED figure still wins, and a stored ZERO counts as unset -- the same rule the
          // Project Schedule module applies in `evOf`, so the tile and the grid cannot disagree
          // about one activity.
          // ⚠️ The column names are DECLARED by the module (`amount` / `pct`), never assumed here:
          // this engine is shared by every module and must not know that a schedule calls its money
          // `planned_cost`.
          if (m.agg === 'sumEarned') {
            var stored = numOf(r[m.column]);
            if (stored != null && stored !== 0) { sum += stored; n++; continue; }
            var amt = numOf(r[m.amount]), pct = numOf(r[m.pct]);
            if (amt == null) continue;
            var p = Math.max(0, Math.min(100, pct == null ? 0 : pct));
            if (p <= 0) continue;                      // 0% earns nothing, and adds no coverage
            sum += amt * (p / 100); n++; continue;
          }
          if (m.agg === 'countWhere') {
            if (m.values ? m.values.indexOf(r[m.column]) !== -1 : !!r[m.column]) n++;
            continue;
          }
          var v = r[m.column];
          if (v == null || v === '') continue;
          if (m.agg === 'min' || m.agg === 'max') { vals.push(v); continue; }
          var num = +v; if (!isFinite(num)) continue;
          if (m.agg === 'wavg') {
            var w = +r[m.weight]; if (!isFinite(w) || w <= 0) continue;
            wsum += w; wacc += w * num;
            continue;
          }
          sum += num; n++;
        }
        if (m.agg === 'min') out[m.key] = vals.length ? vals.reduce(function (a, b) { return a < b ? a : b; }) : null;
        else if (m.agg === 'max') out[m.key] = vals.length ? vals.reduce(function (a, b) { return a > b ? a : b; }) : null;
        else if (m.agg === 'countWhere') out[m.key] = n;
        else if (m.agg === 'sumWhere') out[m.key] = n ? sum : null;
        else if (m.agg === 'sum' || m.agg === 'sumEarned') out[m.key] = n ? sum : null;   // null, not 0 — see below
        else if (m.agg === 'avg') out[m.key] = n ? (sum / n) : null;
        else if (m.agg === 'wavg') out[m.key] = wsum > 0 ? (wacc / wsum) : null;
      });
      // ---- the most recent N rows, for a module that has something to SHOW rather than count ----
      // ⚠️ Declared columns only, and the module names its own storage bucket — the shell does not
      // know that progress photos live in a private bucket, only that this spec asked for signing.
      if (spec.recent && spec.recent.orderBy && spec.recent.columns) {
        var rc = rows.slice().sort(function (a, b) {
          var x = a[spec.recent.orderBy] || '', y = b[spec.recent.orderBy] || '';
          return x < y ? 1 : x > y ? -1 : 0;                      // newest first
        }).slice(0, spec.recent.limit || 6);
        out.recent = rc;
        if (spec.recent.bucket && spec.recent.pathCol && rc.length) {
          try {
            var paths = rc.map(function (r) { return r[spec.recent.pathCol]; }).filter(Boolean);
            if (paths.length) {
              var sg = await sb().storage.from(spec.recent.bucket)
                .createSignedUrls(paths, spec.recent.ttl || 3600);
              if (!sg.error && sg.data) {
                var byPath = {};
                sg.data.forEach(function (d) { if (d && d.path) byPath[d.path] = d.signedUrl || d.signedURL; });
                out.recent.forEach(function (r) { r.__url = byPath[r[spec.recent.pathCol]] || null; });
              }
            }
          } catch (e) { /* a signing failure costs the thumbnails, not the whole band */ }
        }
      }
      // ⚠️ An empty sum returns null rather than 0 deliberately. "Budget 0" reads as a costed project
      // worth nothing; "Budget —" reads as "not cost-loaded yet", which is the truth. The dashboard
      // renders the two differently and must be able to tell them apart.
      return out;
    },

    // ---- Dashboard tiles (A5) ----
    // One project-scoped summary per module, driven by the `dash` spec each
    // module declares in config.js (see MODULE_CONTRACT.md). The shell never
    // hard-codes a module's tables here — it reads what the module published.
    //
    // ⚠️ Counts use a HEAD request with count:'exact'. Do not "simplify" this to
    // selecting the rows and taking .length: PostgREST caps a read at 1000 rows
    // server-side, so a big project's schedule would report exactly 1000
    // activities forever, with no error to notice (the same trap PDb.selectAll
    // exists for).
    async moduleSummary(spec, projectId) {
      if (!spec || !spec.table || !projectId) return null;
      var col = spec.projectCol || 'project_id';
      async function count(apply) {
        var q = sb().from(spec.table).select('id', { count: 'exact', head: true }).eq(col, projectId);
        if (apply) q = apply(q);
        var res = await q;
        if (res.error) throw res.error;
        return res.count || 0;
      }
      var out = { total: await count(null) };
      // The "needs attention" figure is optional and only declared where the
      // status vocabulary is actually known from the schema. A tile that
      // invented one would read 0 forever and look like good news.
      if (spec.attention && spec.attention.column && spec.attention.values) {
        out.attention = await count(function (q) { return q.in(spec.attention.column, spec.attention.values); });
        out.attentionLabel = spec.attention.label || 'open';
      }
      if (spec.updatedCol !== null) {
        var uc = spec.updatedCol || 'updated_at';
        var res = await sb().from(spec.table).select(uc).eq(col, projectId)
          .order(uc, { ascending: false }).limit(1);
        // A missing column is a spec bug, not a reason to fail the whole
        // dashboard — the tile just loses its timestamp.
        if (!res.error && res.data && res.data.length) out.lastActivity = res.data[0][uc];
      }
      return out;
    },

    // ---- People roster (any approved user) ----
    // ⚠️ NOT `getAllUsers()`. That reads `users` directly and, under
    // `users_self_read` (auth.uid() = id or is_admin()), returns ONLY YOUR OWN
    // ROW for a non-admin — so a picker built on it would silently offer a
    // one-person list to every planner. This calls the `app_people()` RPC
    // (2026-08-26-people-and-assignment.sql), which returns id/name/department
    // and nothing else: no email, no role, no project assignments.
    //
    // ⚠️ Cached for the page's lifetime. The roster changes when someone is
    // approved in Admin, which is not something a picker needs to see mid-session,
    // and every module that offers an assignment field would otherwise re-fetch it.
    async getPeople() {
      if (_people) return _people;
      var res = await sb().rpc('app_people');
      // ⚠️ Tolerant of the un-run migration: no function means no roster, and the
      // caller falls back to free text rather than losing the whole form.
      if (res.error) { _people = []; return _people; }
      _people = res.data || [];
      return _people;
    },
    // ---- Adding a person who has NO account -----------------------------
    // ⚠️ The backup path for a champion who will never log in (a subcontractor's
    // engineer, a client's rep). It writes a row to `people_directory`
    // (2026-08-28-people-directory.sql) so the NEXT planner picks the same person
    // instead of retyping the name a third way — which is the whole difference
    // between this and the free-text line beside it.
    //
    // ⚠️ Returns the EXISTING row when the name+company is already in the
    // directory, rather than erroring. The unique index is case-insensitive on
    // purpose, so "Engr. Cruz" and "engr. cruz" resolve to one person — and a
    // planner who hits that should get the person, not a failure.
    async createContact(name, company, department, uid) {
      var nm = (name || '').trim();
      if (!nm) throw new Error('A name is required.');
      var payload = {
        name: nm,
        company: (company || '').trim() || null,
        department: (department || '').trim() || null,
        created_by: uid || null
      };
      var res = await sb().from('people_directory').insert(payload).select().single();
      if (res.error) {
        // 23505 = the case-insensitive identity index. Read the existing row back
        // and hand it over; anything else is a real failure and must be surfaced.
        if (res.error.code === '23505') {
          var q = sb().from('people_directory').select('*')
            .ilike('name', nm).limit(1);
          var got = await q;
          if (!got.error && got.data && got.data[0]) {
            var row = got.data[0];
            var rec = { id: row.id, name: row.name, department: row.department,
                        company: row.company, kind: 'contact' };
            if (_people) _people.push(rec);
            return rec;
          }
        }
        throw res.error;
      }
      var d = res.data;
      var made = { id: d.id, name: d.name, department: d.department,
                   company: d.company, kind: 'contact' };
      // ⚠️ Pushed into the SAME cache the pickers read, so the person is
      // selectable immediately. Re-fetching the roster here would be a round-trip
      // that also discards ids other open pickers are mid-way through resolving.
      if (_people) _people.push(made);
      return made;
    },

    // Resolve ids -> display names without a second round-trip. Unknown ids are
    // reported as such, never dropped: an id that no longer resolves means the
    // person left, and silently showing fewer champions than the row records
    // would misstate who owns the work.
    peopleNames(ids) {
      var by = {};
      (_people || []).forEach(function (p) { by[p.id] = p.name || p.id; });
      return (ids || []).map(function (id) { return by[id] || 'Unknown person'; });
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
