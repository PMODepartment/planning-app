// ============================================================================
// Pormac — an AI assistant that runs IN THE BROWSER, at zero hosting cost.
// ----------------------------------------------------------------------------
// Inference is WebLLM (WebGPU) by default: the model downloads once to the
// device and every reply is computed locally, so this module has no server to
// pay for or keep alive. A device that cannot do that (no WebGPU, too little
// memory, or a local load/crash) automatically falls back to a hosted model
// through supabase/functions/pormac-chat — a shared FREE tier (Groq), never a
// per-device cost.
//
// ⚠️⚠️ PORMAC DOES NOT QUERY THE PROCUREMENT (WPM) OR ENGINEERING APPS' OWN
// DATABASES. Both are separate Supabase projects with their own auth; a
// Planners-app session has no standing there, so a browser call to either
// would run as an anonymous stranger against another department's database.
// What it reads instead are the mirrors THIS app already maintains for this
// exact purpose — `wpm_work_packages` / `wpm_vendors` (supabase/functions/
// sync-wpm) and `eng_design_progress` (supabase/functions/sync-eng) — under
// the signed-in planner's OWN RLS session, same as Cash Flow and the
// Schedule's Design Development branch already do. See
// migrations/2026-09-12-pormac.sql for the full reasoning.
//
// ⚠️⚠️ GROUNDING IS DETERMINISTIC RETRIEVAL, NOT FREE-FORM TOOL-CALLING. A
// 1–3B in-browser model is not reliable at emitting well-formed tool calls —
// so instead of asking the model to decide which data to fetch, a keyword
// router (CONTEXT_PROVIDERS below) decides, using the SAME `dash` metrics
// spec every module already publishes for the Project Dashboard tile
// (`PDb.moduleMetrics`) — so Pormac's numbers can never disagree with the
// dashboard's, because both read the one declared spec.
// ============================================================================

window.Pormac = (function () {
  var pid = null;                 // selected project id (sessionStorage 'pd_project')
  var profile = null;
  var conversationId = null;      // pormac_conversations.id, once persisted
  var chatHistory = [];           // [{role:'user'|'assistant', content}] — sent to the model
  var tier = null;                // 'local-full' | 'local-lite' | 'remote'
  var capPromise = null;          // resolves once detectCapability() has set `tier`
  var engine = null;              // the WebLLM engine instance, once loaded
  var engineModelId = null;
  var sending = false;
  var view = 'chat';              // 'chat' | 'history'
  var PROJECTS = [];              // cached from loadProjects(), for labelling History rows

  function sb() { return AppAuth.getSB(); }
  function $(id) { return document.getElementById(id); }

  // ==========================================================================
  // Init
  // ==========================================================================
  async function init(user, prof) {
    profile = prof;

    // ⚠️⚠️ WIRE THE BUTTONS BEFORE ANY `await`. `#pmc-new` / `#pmc-send` are
    // static markup in the topbar and composer — they render and look
    // clickable the instant the page paints, well before this function has
    // run at all. They used to get their onclick only after `loadProjects()`
    // resolved below, so a slow or failing project fetch (RLS hiccup, a
    // network blip) left them sitting there inert with nothing on screen
    // to say why — "the buttons don't work" with no visible cause. Wiring
    // first means a project-list failure can only ever cost the project
    // picker, never the chat controls.
    // "New chat" has to work from EITHER tab — a planner reading History who
    // hits it should land back in a blank Chat, not have the reset happen
    // invisibly behind the pane they're still looking at.
    $('pmc-new').onclick = function () { conversationId = null; chatHistory = []; switchView('chat'); renderMessages(); };
    $('pmc-send').onclick = onSend;
    $('pmc-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
    });
    $('pmc-input').addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(160, this.scrollHeight) + 'px';
    });

    // Chat / History screen switcher — same `UI.tabsToDropdown` convention
    // every other module's tab strip already uses, so it collapses into the
    // compact dropdown trigger rather than staying a row of buttons. Wiring
    // the real buttons is this module's job; the dropdown just proxies clicks
    // to them and mirrors whichever one carries `.active`.
    Array.prototype.forEach.call(document.querySelectorAll('.pmc-tab'), function (btn) {
      btn.onclick = function () { switchView(btn.dataset.view); };
    });
    if (window.UI && UI.tabsToDropdown) UI.tabsToDropdown('.pmc-tabs');

    try {
      await loadProjects();
      $('pmc-project').onchange = function (e) {
        pid = e.target.value || null;
        sessionStorage.setItem('pd_project', pid || '');
        conversationId = null; chatHistory = [];
        renderMessages();
      };
    } catch (e) {
      // A planner can still chat without a project selected — this only
      // costs project-scoped grounding, never the chat itself.
      UI.toast('Pormac: could not load the project list (' + ((e && e.message) || e) + ')', 'warn');
    }

    // ⚠️ No access gate here (2026-09-12, owner's call: "available to
    // everyone, no need for settings to define accessibility"). Every user
    // who reaches this page is already `status = 'approved'` —
    // `AppAuth.requireLogin` redirects anyone else to pending.html before
    // `init()` ever runs — so there is nothing left to check. `pormac_can_use()`
    // still exists in the database purely for `supabase/functions/pormac-chat`
    // (the hosted fallback) to lean on the same rule server-side; it is just
    // `is_approved()` now, not a per-user allow-list.
    switchView('chat');
    renderTierBar();
    renderMessages();

    // Kick off capability detection in the background — the planner can start
    // typing immediately. onSend() awaits `capPromise` if it hasn't landed yet,
    // so a message sent in the first instant still waits for a real answer
    // (null vs 'local-full' vs 'remote') rather than racing against it.
    capPromise = detectCapability().then(function (cap) {
      tier = cap.tier;
      renderTierBar(cap.reason);
      return cap;
    });
  }

  async function loadProjects() {
    var projects = await PDb.getProjects();
    PROJECTS = projects; // cached so History rows can label a conversation's project without a second fetch
    var sel = $('pmc-project');
    pid = sessionStorage.getItem('pd_project') || null;
    sel.innerHTML = '<option value="">General (no project selected)</option>' +
      projects.map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === pid ? ' selected' : '') + '>' +
          Fmt.esc(p.name) + '</option>';
      }).join('');
    UI.enhanceProjectSelect(sel);
  }

  // ==========================================================================
  // Chat / History screens
  // ==========================================================================
  function switchView(v) {
    view = v;
    Array.prototype.forEach.call(document.querySelectorAll('.pmc-tab'), function (b) {
      b.classList.toggle('active', b.dataset.view === v);
    });
    $('pmc-chrome').style.display = v === 'chat' ? 'flex' : 'none';
    $('pmc-history').style.display = v === 'history' ? 'flex' : 'none';
    if (v === 'history') renderHistory();
  }

  // Personal, not project-shared — RLS already scopes `select` on
  // pormac_conversations to `created_by = auth.uid() or is_admin()`, so this
  // reads across every project the planner has ever chatted about, not just
  // the one currently selected, with each row saying which project it was.
  async function renderHistory() {
    var host = $('pmc-history');
    host.innerHTML = '<div class="pmc-muted" style="padding:16px;">Loading…</div>';
    try {
      var { data, error } = await sb().from('pormac_conversations')
        .select('id,project_id,title,updated_at')
        .order('updated_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      var rows = data || [];
      if (!rows.length) {
        host.innerHTML = '<div class="pmc-muted" style="padding:16px;">No past conversations yet — anything you send in Chat is saved here.</div>';
        return;
      }
      host.innerHTML = rows.map(function (r) {
        var proj = PROJECTS.filter(function (p) { return p.id === r.project_id; })[0];
        return '<div class="pmc-hist-row" data-id="' + Fmt.esc(r.id) + '">' +
          '<div class="pmc-hist-txt">' +
            '<div class="pmc-hist-title">' + Fmt.esc(r.title || 'New conversation') + '</div>' +
            '<div class="pmc-hist-meta">' + Fmt.esc(proj ? proj.name : 'General') + ' · ' + Fmt.esc(Fmt.date(r.updated_at)) + '</div>' +
          '</div>' +
          '<button type="button" class="pd-icon-btn pmc-hist-del" data-id="' + Fmt.esc(r.id) + '" ' +
            'title="Delete this conversation" data-ico="trash" data-ico-size="14"></button>' +
        '</div>';
      }).join('');
      if (window.Icons) Icons.hydrate(host);
      Array.prototype.forEach.call(host.querySelectorAll('.pmc-hist-row'), function (row) {
        row.onclick = function (e) {
          if (e.target.closest('.pmc-hist-del')) return; // the delete button has its own handler below
          openConversation(row.dataset.id);
        };
      });
      Array.prototype.forEach.call(host.querySelectorAll('.pmc-hist-del'), function (btn) {
        btn.onclick = function (e) { e.stopPropagation(); deleteConversation(btn.dataset.id); };
      });
    } catch (e) {
      host.innerHTML = '<div class="pmc-muted" style="padding:16px;">Could not load past conversations (' +
        Fmt.esc((e && e.message) || String(e)) + ').</div>';
    }
  }

  async function openConversation(id) {
    try {
      var { data: conv, error: convErr } = await sb().from('pormac_conversations')
        .select('id,project_id').eq('id', id).single();
      if (convErr) throw convErr;
      var { data: msgs, error: msgErr } = await sb().from('pormac_messages')
        .select('role,content').eq('conversation_id', id).order('created_at', { ascending: true });
      if (msgErr) throw msgErr;

      conversationId = conv.id;
      // A message row's own `role` check allows 'system' too, but nothing in
      // this module ever WRITES one — only the shape chatHistory/promptMessages
      // expects is kept.
      chatHistory = (msgs || []).filter(function (m) { return m.role === 'user' || m.role === 'assistant'; })
        .map(function (m) { return { role: m.role, content: m.content }; });

      // Restore the project this conversation was grounded in — but only if
      // it's still one the planner can see. A project they've since lost
      // access to isn't in `#pmc-project`'s own option list, and forcing pid
      // to it anyway would just have every context provider query a project
      // RLS refuses; General is the honest fallback there, not a query.
      var sel = $('pmc-project');
      var hasOption = conv.project_id && Array.prototype.some.call(sel.options, function (o) { return o.value === conv.project_id; });
      pid = hasOption ? conv.project_id : null;
      sel.value = pid || '';
      sessionStorage.setItem('pd_project', pid || '');

      switchView('chat');
      renderMessages();
    } catch (e) {
      UI.toast('Pormac: could not open that conversation (' + ((e && e.message) || e) + ')', 'warn');
    }
  }

  async function deleteConversation(id) {
    if (!confirm('Delete this conversation? This cannot be undone.')) return;
    var { error } = await sb().from('pormac_conversations').delete().eq('id', id);
    if (error) { UI.toast('Pormac: could not delete that conversation (' + error.message + ')', 'warn'); return; }
    // Deleting the one currently open in Chat drops it back to blank —
    // its messages are gone (cascade delete), so there is nothing left to show.
    if (id === conversationId) { conversationId = null; chatHistory = []; renderMessages(); }
    renderHistory();
  }

  // ==========================================================================
  // Capability detection + tiered model selection
  // ==========================================================================
  // ⚠️ Honest, not clever: there is no reliable way to read a device's true
  // free VRAM/RAM from a web page (navigator.deviceMemory is Chromium-only and
  // absent on Safari/Firefox entirely), so this is a conservative HEURISTIC,
  // not a measurement — under-promising (starting a capable desktop on the
  // lite model) costs a slightly weaker first answer; over-promising (trying
  // the full model on a 6GB phone) risks the tab crashing mid-conversation.
  // See modules/pormac/CLAUDE.md for the reasoning and its limits.
  async function detectCapability() {
    var saved = localStorage.getItem('pormac_tier_override');
    if (saved) return { tier: saved, reason: 'downgraded earlier on this device after a local run failed' };

    if (!('gpu' in navigator)) return { tier: 'remote', reason: 'this browser has no WebGPU' };
    var adapter = null;
    try { adapter = await navigator.gpu.requestAdapter(); } catch (e) { adapter = null; }
    if (!adapter) return { tier: 'remote', reason: 'WebGPU is present but no adapter is available' };

    var ua = navigator.userAgent || '';
    var isIOS = /iPhone|iPad|iPod/.test(ua);
    var isMobile = isIOS || /Android/.test(ua);
    var mem = navigator.deviceMemory || null; // undefined on Safari/Firefox always

    if (mem != null) {
      if (mem >= 8 && !isMobile) return { tier: 'local-full', reason: mem + 'GB reported (desktop)' };
      if (mem >= 6) return { tier: 'local-lite', reason: mem + 'GB reported' };
      return { tier: 'remote', reason: mem + 'GB reported — too little to risk a local model' };
    }
    // No deviceMemory API (Safari/Firefox): a coarse, deliberately conservative
    // fallback. Never hand a phone the full-size model on a guess.
    if (isMobile) return { tier: 'local-lite', reason: 'mobile device, memory unreadable on this browser — starting conservative' };
    return { tier: 'local-full', reason: 'desktop, memory unreadable on this browser' };
  }

  // Step the tier down after a real failure (OOM, context lost, load error),
  // and remember it on THIS device so the next visit does not repeat the
  // failure. This is the "slow down instead of crash" behaviour.
  function downgrade(reason) {
    var order = ['local-full', 'local-lite', 'remote'];
    var i = order.indexOf(tier);
    var next = order[Math.min(i + 1, order.length - 1)];
    UI.toast('Pormac: switching to a lighter mode (' + reason + ')', 'warn');
    localStorage.setItem('pormac_tier_override', next);
    tier = next;
    engine = null; engineModelId = null;
    renderTierBar(reason);
  }

  var TIER_LABEL = {
    'local-full': 'Running locally (full model)',
    'local-lite': 'Running locally (lite model)',
    'remote': 'Cloud fallback (this device can’t run it locally)',
    null: 'Checking this device…',
  };

  function renderTierBar(reason) {
    var bar = $('pmc-tierbar');
    if (!bar) return;
    var label = TIER_LABEL[tier] || TIER_LABEL[null];
    bar.innerHTML =
      '<span class="pmc-tierpill' + (sending ? ' busy' : '') + '"><span class="pmc-dot"></span>' + Fmt.esc(label) + '</span>' +
      (reason ? '<span>' + Fmt.esc(reason) + '</span>' : '') +
      (tier === 'remote' ? '<button class="pd-btn pd-btn-sm" id="pmc-retry-local">Try running locally again</button>' : '');
    var retry = $('pmc-retry-local');
    if (retry) retry.onclick = function () {
      localStorage.removeItem('pormac_tier_override');
      tier = null; renderTierBar();
      detectCapability().then(function (cap) { tier = cap.tier; renderTierBar(cap.reason); });
    };
  }

  // Lazy-loaded only once a local tier is actually needed — matches this
  // app's existing precedent for three.js in Progress Photos (a heavy library
  // most sessions never touch should not be in every page's initial payload).
  var _webllm = null;
  async function loadWebLLM() {
    if (_webllm) return _webllm;
    _webllm = await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm/+esm');
    return _webllm;
  }

  // Resolve a model NAME PATTERN against WebLLM's own prebuilt catalogue at
  // runtime rather than hard-coding one exact model id — the catalogue is
  // maintained upstream and its ids have changed before; matching by pattern
  // means this file does not go stale the next time it does.
  function pickModelId(webllm, maxVramMB, patterns) {
    var list = (webllm.prebuiltAppConfig && webllm.prebuiltAppConfig.model_list) || [];
    var hit = list.filter(function (m) {
      return m.model_id && (!m.vram_required_MB || m.vram_required_MB <= maxVramMB) &&
        patterns.some(function (p) { return p.test(m.model_id); });
    }).sort(function (a, b) { return (a.vram_required_MB || 0) - (b.vram_required_MB || 0); });
    return hit.length ? hit[0].model_id : null;
  }

  async function ensureEngine() {
    if (tier === 'remote') return null;
    if (engine && engineModelId) return engine;

    var webllm;
    try { webllm = await loadWebLLM(); }
    catch (e) { downgrade('could not load the local model runtime'); return null; }

    var patterns = tier === 'local-full'
      ? [/Llama-3\.2-3B-Instruct/i, /Qwen2\.5-3B-Instruct/i, /Phi-3\.5-mini-instruct/i]
      : [/Llama-3\.2-1B-Instruct/i, /Qwen2\.5-1\.5B-Instruct/i, /Qwen2-0\.5B-Instruct/i];
    var maxVram = tier === 'local-full' ? 3300 : 1400;
    var modelId = pickModelId(webllm, maxVram, patterns);
    if (!modelId) { downgrade('no suitable local model is available for this tier'); return null; }

    try {
      engine = await webllm.CreateMLCEngine(modelId, {
        initProgressCallback: function (report) {
          renderTierBar((report && report.text) || 'loading the local model…');
        },
      });
      engineModelId = modelId;
      renderTierBar('model ready (' + modelId + ')');
      return engine;
    } catch (e) {
      engine = null; engineModelId = null;
      downgrade('the local model failed to start (' + ((e && e.message) || e) + ')');
      return null;
    }
  }

  // ==========================================================================
  // Grounding: deterministic context providers over this app's own data
  // ==========================================================================
  // Built from APP_CONFIG.MODULES' own `dash` specs (the Project Dashboard
  // tile contract) wherever one exists — reusing PDb.moduleMetrics means these
  // figures are computed exactly once, by the shell, the same way for the
  // Dashboard tile and for Pormac. A module with no `dash` spec simply is not
  // offered as context; that's the shell's own existing honesty rule ("no
  // dash is fine — the tile then says no summary is published"), not a gap
  // Pormac invents a shortcut around.
  function moduleProviders() {
    var out = [];
    (APP_CONFIG.MODULES || []).forEach(function (m) {
      if (!m.enabled || !m.dash || m.superAdminOnly) return; // respects the same visibility rule as the launcher
      var kw = [m.key, m.name, m.dash.unit].filter(Boolean).join(' ').toLowerCase();
      out.push({
        key: m.key,
        label: m.name,
        keywords: new RegExp(kw.split(/[\s,-]+/).filter(function (w) { return w.length > 2; }).join('|'), 'i'),
        needsProject: true,
        fetch: async function () {
          var out2 = await PDb.moduleMetrics(m.dash, pid);
          return summarizeDash(m, out2);
        },
      });
    });
    return out;
  }

  function summarizeDash(m, out) {
    if (!out || out.__error) return null;
    var lines = [];
    if (out.__rows != null) lines.push(out.__rows + ' ' + (m.dash.unit || 'records') + ' recorded.');
    Object.keys(out).forEach(function (k) {
      if (k.indexOf('__') === 0 || k === 'lists' || k === 'recent' || k === 'sub') return;
      var v = out[k];
      if (v == null) return;
      if (typeof v === 'object') {
        if ('n' in v && 'hh' in v) { // matrix2
          lines.push(k + ': ' + v.hh + ' high/high, ' + v.hl + ' high/low, ' + v.lh + ' low/high, ' + v.ll + ' low/low (of ' + v.n + ')');
        } else if (Array.isArray(v)) {
          lines.push(k + ': ' + v.length + ' item(s)');
        } else {
          // groupSpan-shaped map {key: {from,to,n,done,...}}
          var parts = Object.keys(v).slice(0, 6).map(function (gk) {
            var g = v[gk]; return gk + ' (' + (g.done || 0) + '/' + (g.n || 0) + ' done)';
          });
          if (parts.length) lines.push(k + ': ' + parts.join('; '));
        }
      } else {
        lines.push(k + ': ' + v);
      }
    });
    if (out.lists) Object.keys(out.lists || {}).forEach(function (lk) {
      var rows = out.lists[lk] || [];
      if (rows.length) lines.push(lk + ' (top ' + rows.length + '): ' + rows.slice(0, 5).map(function (r) {
        return Object.values(r).filter(function (v) { return v != null && v !== ''; }).slice(0, 3).join(' / ');
      }).join(' | '));
    });
    if (!lines.length) return null;
    return m.name + ' — ' + lines.join(' ');
  }

  // ---- Bespoke providers over the cross-app MIRRORS (not launcher modules,
  // so they carry no `dash` spec of their own). ----
  function mirrorProviders() {
    return [
      {
        key: 'procurement', label: 'Procurement (WPM mirror)',
        keywords: /procure|vendor|supplier|work[\s-]?package|awarded|award|\bpo\b|purchase\s*order|bcb|budget/i,
        needsProject: false,
        fetch: async function () {
          // ⚠️ wpm_work_packages carries the WPM app's OWN project id
          // (`wpm_project_id`), not this app's — the mirror is not mapped
          // between the two (see migrations/2026-07-14-wpm-work-packages-mirror.sql).
          // Best-effort: try an exact id match (many projects share the same
          // code across both apps); if nothing matches, fall back to a
          // portfolio-wide summary and SAY SO, rather than silently guessing.
          var scoped = pid ? await PDb.selectAll('wpm_work_packages', function (q) { return q.eq('wpm_project_id', pid); },
            'wp_no,description,approved_budget_bcb,awarded_cost,award_status,procurement_status,delivery_status') : [];
          var rows = scoped.length ? scoped : await PDb.selectAll('wpm_work_packages', null,
            'wp_no,description,approved_budget_bcb,awarded_cost,award_status,procurement_status,delivery_status');
          if (!rows.length) return null;
          var awarded = rows.filter(function (r) { return r.award_status && /award/i.test(r.award_status); }).length;
          var totalBudget = rows.reduce(function (n, r) { return n + (Number(r.approved_budget_bcb) || 0); }, 0);
          var totalAwarded = rows.reduce(function (n, r) { return n + (Number(r.awarded_cost) || 0); }, 0);
          var scope = scoped.length ? 'for this project' : 'PORTFOLIO-WIDE — could not confirm which rows belong to this project';
          return 'Procurement (' + scope + ', mirrored from WPM, may lag the live app): ' + rows.length +
            ' work package(s), ' + awarded + ' awarded, approved budget ' + Fmt.money(totalBudget) +
            ', awarded cost ' + Fmt.money(totalAwarded) + '.';
        },
      },
      {
        key: 'vendors', label: 'Vendor directory (WPM mirror)',
        keywords: /vendor|contractor|subcon|accredit/i,
        needsProject: false,
        fetch: async function () {
          var rows = await PDb.selectAll('wpm_vendors', null, 'name,trade_categories,accreditation,status');
          if (!rows.length) return null;
          var accredited = rows.filter(function (r) { return r.accreditation === 'accredited'; }).length;
          return 'Vendor directory (portfolio-wide, mirrored from WPM): ' + rows.length + ' vendors, ' +
            accredited + ' accredited.';
        },
      },
      {
        key: 'engineering', label: 'Engineering design progress',
        keywords: /engineering|drawing|submittal|design\s*(dev|progress)|for\s*construction|schematic/i,
        needsProject: true,
        fetch: async function () {
          if (!pid) return null;
          // project_id carries THIS app's id here (see the mirror's own
          // comment) so this is a clean, real project-scoped filter.
          var rows = await PDb.selectAll('eng_design_progress', function (q) { return q.eq('project_id', pid); },
            'source,top_level,basis,percent_complete,units_total,units_done,synced_at');
          if (!rows.length) return null;
          var lines = rows.map(function (r) {
            return r.top_level + ' (' + r.source + '): ' + (r.percent_complete != null ? r.percent_complete + '%' : '—') +
              (r.units_total ? ' (' + (r.units_done || 0) + '/' + r.units_total + ')' : '');
          });
          var asOf = rows[0] && rows[0].synced_at ? Fmt.date(rows[0].synced_at) : null;
          return 'Engineering design progress (mirrored from the Engineering App' + (asOf ? ', as of ' + asOf : '') + '): ' + lines.join('; ');
        },
      },
    ];
  }

  function allProviders() { return moduleProviders().concat(mirrorProviders()); }

  // Match the question against every provider's keywords; if nothing matches,
  // default to a small, generally-useful set so a vague question still gets
  // something rather than nothing. Capped, so the prompt stays small enough
  // for a 1–3B local model's context window.
  async function gatherContext(question) {
    var providers = allProviders();
    var matched = providers.filter(function (p) { return p.keywords.test(question); });
    if (!matched.length) matched = providers.filter(function (p) { return p.key === 'project-schedule' || p.key === 'risk-register'; });
    matched = matched.slice(0, 4);

    var used = [], blocks = [];
    for (var i = 0; i < matched.length; i++) {
      var p = matched[i];
      if (p.needsProject && !pid) continue;
      try {
        var text = await p.fetch();
        if (text) { blocks.push(text); used.push(p.label); }
      } catch (e) { /* one provider failing must not block the others */ }
    }
    return { used: used, text: blocks.join('\n') };
  }

  // ==========================================================================
  // Sending a message
  // ==========================================================================
  var SYSTEM_PROMPT =
    'You are Pormac, an assistant embedded in Megawide’s Planners Dashboard. Answer the ' +
    'planner’s question using ONLY the context given below when it is relevant; say plainly ' +
    'when you don’t have enough information rather than guessing. Be concise. If the context ' +
    'includes figures mirrored from the Procurement or Engineering apps, make clear they may lag ' +
    'the live register there.';

  async function onSend() {
    if (sending) return;
    var input = $('pmc-input');
    var text = input.value.trim();
    if (!text) return;
    sending = true;
    if (tier === null && capPromise) await capPromise; // don't race the capability check
    input.value = ''; input.style.height = 'auto';
    pushMessage('user', text, null, null);

    var ctx = await gatherContext(text);
    var placeholder = pushMessage('assistant', '', null, ctx.used);
    renderTierBar();

    try {
      var reply;
      if (tier === 'remote' || !(await ensureEngine())) {
        reply = await sendRemote(text, ctx.text);
      } else {
        reply = await sendLocal(text, ctx.text, placeholder);
      }
      updateMessage(placeholder, reply);
      chatHistory.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
      await persistTurn(text, reply, ctx.used);
    } catch (e) {
      updateMessage(placeholder, 'Sorry — something went wrong answering that (' + ((e && e.message) || e) + ').');
    } finally {
      sending = false;
      renderTierBar();
    }
  }

  function promptMessages(question, contextText) {
    var msgs = [{ role: 'system', content: SYSTEM_PROMPT + (contextText ? '\n\nContext:\n' + contextText : '') }];
    // Keep only the last few turns — a local model's context window is small,
    // and the context block above is rebuilt fresh every message anyway.
    var recent = chatHistory.slice(-8);
    return msgs.concat(recent, [{ role: 'user', content: question }]);
  }

  async function sendLocal(question, contextText, placeholderEl) {
    var eng = engine; // ensureEngine() already succeeded by the time we get here
    var out = '';
    var stream = await eng.chat.completions.create({ messages: promptMessages(question, contextText), stream: true });
    for await (var chunk of stream) {
      var delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
      if (delta) { out += delta; updateMessage(placeholderEl, out, true); }
    }
    return out || '(no response)';
  }

  async function sendRemote(question, contextText) {
    var { data: sess } = await sb().auth.getSession();
    var token = sess && sess.session && sess.session.access_token;
    if (!token) throw new Error('not signed in');
    var resp = await fetch(APP_CONFIG.SUPABASE_URL + '/functions/v1/pormac-chat', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: promptMessages(question, contextText) }),
    });
    var body = await resp.json().catch(function () { return {}; });
    if (!resp.ok) throw new Error(body.error || ('cloud fallback returned ' + resp.status));
    return body.reply || '(no response)';
  }

  // ==========================================================================
  // Persistence — best-effort. A migration that hasn't run yet, or an access
  // rule that says no, must not stop the chat from working; it just stops it
  // from being remembered.
  // ==========================================================================
  async function persistTurn(userText, replyText, used) {
    try {
      if (!conversationId) {
        var { data, error } = await sb().from('pormac_conversations')
          .insert({ project_id: pid, title: userText.slice(0, 60), created_by: profile.id })
          .select('id').single();
        if (error) throw error;
        conversationId = data.id;
      } else {
        // History sorts by `updated_at desc`, and nothing else in this table
        // ever bumps it — without this an ongoing conversation would sink
        // to the bottom of its own list the moment a newer one was created.
        await sb().from('pormac_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
      }
      await sb().from('pormac_messages').insert([
        { conversation_id: conversationId, role: 'user', content: userText },
        { conversation_id: conversationId, role: 'assistant', content: replyText, model_tier: tier, context_used: used },
      ]);
    } catch (e) { /* silent — chat stays usable without history */ }
  }

  // ==========================================================================
  // Rendering
  // ==========================================================================
  function pushMessage(role, content, tierUsed, contextUsed) {
    var thread = $('pmc-thread');
    var wrap = document.createElement('div');
    wrap.className = 'pmc-msg ' + role;
    var col =
      (contextUsed && contextUsed.length ? '<div class="pmc-ctxchips">' + contextUsed.map(function (c) {
        return '<span class="pmc-ctxchip">' + Fmt.esc(c) + '</span>';
      }).join('') + '</div>' : '') +
      '<div class="pmc-bubble">' + (content ? Fmt.esc(content) : '<span class="pmc-cursor"></span>') + '</div>';
    // ⚠️ Only assistant bubbles carry the Pormac avatar — a planner's own
    // messages and the system placeholder ("pick a project…") aren't Pormac
    // talking, so an avatar on those would misattribute the message.
    wrap.innerHTML = role === 'assistant'
      ? '<img class="pmc-avatar" src="../../assets/img/pormac-avatar.png?v=20260912a" alt="" aria-hidden="true">' +
        '<div class="pmc-msgcol">' + col + '</div>'
      : col;
    thread.appendChild(wrap);
    thread.scrollTop = thread.scrollHeight;
    return wrap.querySelector('.pmc-bubble');
  }

  function updateMessage(bubbleEl, content, streaming) {
    bubbleEl.innerHTML = Fmt.esc(content) + (streaming ? '<span class="pmc-cursor"></span>' : '');
    var thread = $('pmc-thread');
    thread.scrollTop = thread.scrollHeight;
  }

  function renderMessages() {
    var thread = $('pmc-thread');
    thread.innerHTML = '';
    if (!chatHistory.length) {
      thread.innerHTML = '<div class="pmc-msg system"><div class="pmc-bubble">' +
        (pid ? 'Ask me anything about this project.' : 'Pick a project above for grounded answers, or ask a general question.') +
        '</div></div>';
      return;
    }
    chatHistory.forEach(function (m) { pushMessage(m.role, m.content); });
  }

  return { init: init };
})();
