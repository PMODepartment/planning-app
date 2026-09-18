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
  var pid = null;                 // selected project id (sessionStorage 'pd_project'), or null
  var portfolioAll = false;       // true when "Portfolio (all projects)" is checked
  var PROJECTS = [];              // cached project list — reused for portfolio-wide grounding
  var profile = null;
  var conversationId = null;      // pormac_conversations.id, once persisted
  var chatHistory = [];           // [{role:'user'|'assistant', content}] — sent to the model
  var tier = null;                // a TIERS[].id, or null while being resolved
  var capPromise = null;          // resolves once detectCapability() has set `tier`
  var engine = null;              // the WebLLM engine instance, once loaded
  var engineModelId = null;
  var sending = false;
  var convToken = 0;              // guards a slow conversation load landing after a project switch

  function sb() { return AppAuth.getSB(); }
  function $(id) { return document.getElementById(id); }

  // ==========================================================================
  // Init
  // ==========================================================================
  /* The height of everything docked below the thread — composer + disclaimer. Read from the DOM
     rather than counted up from paddings, so it stays right if either ever changes. */
  function syncDockHeight() {
    var inp = $('pmc-input');
    var comp = inp && inp.closest ? inp.closest('.pmc-composer') : null;
    if (!comp) return;
    var h = Math.round(window.innerHeight - comp.getBoundingClientRect().top);
    if (h > 0 && h < window.innerHeight) document.documentElement.style.setProperty('--pmc-dock', h + 'px');
  }

  async function init(user, prof) {
    profile = prof;

    // ⚠️⚠️ WIRE THE COMPOSER BEFORE ANY `await`, AND NEVER GATE THE PANE ON ONE.
    // `#pmc-send` and `#pmc-input` are static markup — they paint the instant
    // the page loads, well before this function has run. The handlers used to
    // be attached only after `loadProjects()` resolved, and worse, the whole
    // `#pmc-chrome` pane (composer included) started `display:none` and was
    // revealed by `switchView('chat')` BELOW that same await. So a slow or
    // hanging project fetch left the planner with no box to type into at all
    // and nothing on screen saying why — measured: with the fetch pending,
    // `#pmc-input` renders 0x0 and a click on it never lands. The pane is now
    // visible in the markup itself, and a project-list failure can only ever
    // cost the project picker.
    $('pmc-send').onclick = onSend;
    $('pmc-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
    });
    $('pmc-input').addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(160, this.scrollHeight) + 'px';
      syncDockHeight();
    });
    /* ⚠ The composer and the disclaimer are docked to the bottom of the viewport, and
       `.pd-toast` is `position:fixed; bottom:24px` — so a toast landed ON the disclaimer
       (measured: 7×296px of overlap). The stylesheet lifts it by `--pmc-dock`, and this keeps
       that value honest as the textarea grows from 40px to 160px; a constant would have been
       right only until somebody typed a long question. */
    syncDockHeight();
    window.addEventListener('resize', syncDockHeight);
    // ⚠️ Wired here, not inside the `loadProjects()` try block below, for the
    // same reason the composer handlers are: it needs `pid`/`portfolioAll`
    // and `profile`, none of which depend on the project list ever loading,
    // so a failed fetch must not also take away the one way to clear a stuck
    // or unwanted thread.
    $('pmc-clear').onclick = clearHistory;

    try {
      await loadProjects();
      $('pmc-project').onchange = function (e) {
        pid = e.target.value || null;
        sessionStorage.setItem('pd_project', pid || '');
        loadConversation();
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
    renderTierBar();
    loadConversation();

    // Kick off capability detection in the background — the planner can start
    // typing immediately. onSend() awaits `capPromise` if it hasn't landed yet,
    // so a message sent in the first instant still waits for a real answer
    // (null vs 'local-full' vs 'remote') rather than racing against it.
    capPromise = applyTier();
  }

  async function loadProjects() {
    var projects = await PDb.getProjects();
    PROJECTS = projects;   // reused by portfolio-wide grounding — no second fetch
    var sel = $('pmc-project');
    pid = sessionStorage.getItem('pd_project') || null;
    sel.innerHTML = '<option value="">General (no project selected)</option>' +
      projects.map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === pid ? ' selected' : '') + '>' +
          Fmt.esc(p.name) + '</option>';
      }).join('');
    UI.enhanceProjectSelect(sel);

    // ⚠️⚠️ SCOPE IS DERIVED SOLELY FROM HOW THE PLANNER ARRIVED, NOT A
    // CONTROL THEY SET. `ui.js`'s `renderNav('portfolio', …)` puts
    // `#pd_scope=portfolio` on EVERY module's own link (2026-09-14,
    // generalized from this module's own one-off `#pmc_scope=portfolio`),
    // read once by `AppAuth` (auth.js) into a per-tab sessionStorage flag
    // every module now shares — this is the ONE signal distinguishing
    // "opened from the Portfolio nav" from "opened from a project's own
    // module grid" (a module page always renders under `mode:'project'` in
    // `UI.renderNav` regardless of which nav family linked to it, so
    // `pd_project` sessionStorage cannot tell the two apart on its own).
    // A checkbox here used to let a planner flip that scope mid-session —
    // removed 2026-09-14 (owner: "no need for the portfolio checkbox")
    // because the whole point is that the answer's basis should follow
    // WHERE Pormac was opened from, not a toggle somebody could leave in
    // the wrong position and not notice.
    if (window.AppAuth && AppAuth.isPortfolioScope()) setPortfolioAll(true);
  }

  // One writer for the portfolio-scope flag and the project select it hides,
  // so the two cannot drift out of sync the way two separate call sites would
  // risk. ⚠️ Hidden, not merely disabled — with no toggle left to turn
  // Portfolio back off, a visible-but-unusable select would just be a control
  // that does nothing, where the earlier checkbox-driven design at least gave
  // a reason to keep it in view (disabled, so it still answered "why can't I
  // pick a project right now").
  function setPortfolioAll(on) {
    portfolioAll = !!on;
    $('pmc-project').style.display = portfolioAll ? 'none' : '';
  }

  // ==========================================================================
  // The conversation — ONE per planner per project
  // ==========================================================================
  // ⚠️ Declared ABOVE its readers: a `var` hoists its declaration but not its
  // assignment, and this app has shipped two crashes from exactly that shape.
  var MSG_CAP = 200;   // messages rendered into the thread; older turns stay in the database

  // Owner, 2026-09-12: "keep only 1 conversation per user per project... no need
  // also for new chat since everything is in one conversation." So there is no
  // Chat/History switcher and no reset button: opening the module (or switching
  // project) resumes that project's single running thread, which the planner
  // scrolls back through in place.
  //
  // ⚠️⚠️ "ONE" IS ENFORCED BY WHAT THIS READS, NOT BY A UNIQUE INDEX, AND THAT IS
  // DELIBERATE. Rows already exist from before this change — every press of the
  // old "New chat" made another — so a unique constraint could not be added
  // without first destroying or merging real conversations. Worse, the General
  // (no project) case cannot be covered by a plain unique index at all: Postgres
  // treats NULLs as distinct, so `(created_by, project_id)` would happily admit
  // a second NULL-project row. Instead this loads EVERY conversation the planner
  // has for this project and merges their messages into one chronological
  // thread, so "everything is in one conversation" is true on screen from the
  // first load, including retroactively — while new turns are written to the
  // most recently updated one, which converges the rows without deleting any.
  //
  // ⚠️ `.eq('created_by', ...)` is not redundant with RLS. The select policy is
  // `created_by = auth.uid() OR is_admin()`, so without it an admin would load
  // every planner's conversations into their own thread.
  async function loadConversation() {
    var token = ++convToken;   // a project switch mid-fetch must win over this load
    conversationId = null;
    chatHistory = [];
    renderMessages('Loading ' + (portfolioAll ? 'the portfolio-wide' : 'this project’s') + ' conversation…');
    try {
      var q = sb().from('pormac_conversations').select('id')
        .eq('created_by', profile.id)
        .order('updated_at', { ascending: false });
      // ⚠️ Portfolio scope shares the same NULL-project bucket as General
      // (no project selected) rather than getting a column value of its own
      // — `pormac_conversations.project_id` references `projects(id)`, so a
      // sentinel string there would be a foreign-key violation on the very
      // first save. Nothing in the schema distinguishes "asked generally"
      // from "asked across the portfolio"; both are simply not one project.
      q = (pid && !portfolioAll) ? q.eq('project_id', pid) : q.is('project_id', null);
      var { data: convs, error } = await q;
      if (error) throw error;
      if (token !== convToken) return;

      var ids = (convs || []).map(function (c) { return c.id; });
      if (!ids.length) { renderMessages(); return; }   // nothing yet — persistTurn() creates it on the first reply
      conversationId = ids[0];                          // canonical: the most recently updated

      // Newest-first + limit, then reversed — an ascending limit would hand back
      // the OLDEST N and silently drop everything recent, which is the half a
      // planner is actually reading.
      var { data: msgs, error: msgErr } = await sb().from('pormac_messages')
        .select('role,content')
        .in('conversation_id', ids)
        .order('created_at', { ascending: false })
        .limit(MSG_CAP + 1);
      if (msgErr) throw msgErr;
      if (token !== convToken) return;

      var rows = (msgs || []).slice().reverse();
      // A message row's own `role` check allows 'system' too, but nothing in
      // this module ever WRITES one — only the shape chatHistory/promptMessages
      // expects is kept.
      rows = rows.filter(function (m) { return m.role === 'user' || m.role === 'assistant'; });
      var truncated = rows.length > MSG_CAP;
      chatHistory = truncated ? rows.slice(-MSG_CAP) : rows;
      chatHistory = chatHistory.map(function (m) { return { role: m.role, content: m.content }; });
      renderMessages(null, truncated);
    } catch (e) {
      if (token !== convToken) return;
      // The chat itself still works without its history — this only costs the
      // earlier turns, so say so rather than leaving a blank thread that reads
      // as "nothing was ever saved".
      renderMessages('Could not load earlier messages (' + ((e && e.message) || e) + '). You can still ask a question.');
    }
  }


  // Owner, 2026-09-14: "provide also option to clear history." Deletes every
  // `pormac_conversations` row for the CURRENT scope (this project, General,
  // or Portfolio — General and Portfolio share the same NULL-project bucket,
  // same as everywhere else this module reads/writes that scope) rather than
  // only the canonical row `loadConversation()` picked.
  //
  // ⚠️⚠️ DELETING ONLY `conversationId` WOULD LEAVE THE THREAD COMING BACK.
  // `loadConversation()` merges EVERY conversation row for this scope, not
  // just the canonical one — a leftover from before this module converged on
  // "one conversation per project" (2026-09-12). Deleting the single
  // canonical row and reopening the module would silently resurrect whatever
  // older row was next in line, which reads as "clear history did nothing."
  // The delete uses the identical scope predicate `loadConversation()` reads
  // with, so the two can never disagree about what "this conversation" means.
  //
  // ⚠️ `pormac_messages.conversation_id` is `references … on delete cascade`
  // (migrations/2026-09-12-pormac.sql), and a foreign-key cascade runs at the
  // constraint level rather than through the deleting role's own RLS — so
  // deleting the conversation rows here is enough; no separate messages
  // delete or policy is needed.
  //
  // ⚠️ `.eq('created_by', profile.id)` is not redundant with the table's own
  // delete policy (`created_by = auth.uid() OR is_admin()`) — without it an
  // admin's "clear history" would delete every planner's conversation for
  // this scope, not just their own.
  async function clearHistory() {
    var scopeLabel = portfolioAll ? 'the portfolio-wide conversation'
      : pid ? 'this project’s conversation' : 'the general conversation';
    if (!confirm('Clear ' + scopeLabel + '? This deletes it for everyone who can see this project — it cannot be undone.')) return;
    try {
      var q = sb().from('pormac_conversations').delete().eq('created_by', profile.id);
      q = (pid && !portfolioAll) ? q.eq('project_id', pid) : q.is('project_id', null);
      var { error } = await q;
      if (error) throw error;
      convToken++;              // drop any in-flight loadConversation() for the old state
      conversationId = null;
      chatHistory = [];
      renderMessages();
      UI.toast('Cleared ' + scopeLabel + '.', 'ok');
    } catch (e) {
      UI.toast('Could not clear history (' + ((e && e.message) || e) + ').', 'warn');
    }
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
    // ⚠️ VALIDATED against the table. An unrecognised string here (a stale key
    // from an older build, a hand-edited value) used to flow straight through
    // as the tier and land in every ternary's silent else-branch.
    var saved = localStorage.getItem('pormac_tier_override');
    if (saved && TIER_IDS.indexOf(saved) >= 0 && saved !== 'none') {
      return { tier: saved, reason: 'downgraded earlier on this device after a local run failed' };
    }

    if (!('gpu' in navigator)) return { tier: 'remote', reason: 'this browser has no WebGPU' };
    var adapter = null;
    try { adapter = await navigator.gpu.requestAdapter(); } catch (e) { adapter = null; }
    if (!adapter) return { tier: 'remote', reason: 'WebGPU is present but no adapter is available' };

    var ua = navigator.userAgent || '';
    var isIOS = /iPhone|iPad|iPod/.test(ua);
    var isMobile = isIOS || /Android/.test(ua);
    var mem = navigator.deviceMemory || null; // undefined on Safari/Firefox always

    if (mem != null) {
      // ⚠️ `local-max` (a 7–8B model) is NOT offered on a guess: it is a ~5GB
      // one-time download and several GB of VRAM, so it needs a machine that
      // has actually reported enough memory. Below that the old 3B/1B rungs
      // are unchanged.
      if (mem >= 16 && !isMobile) return { tier: 'local-max', reason: mem + 'GB reported (desktop)' };
      if (mem >= 8 && !isMobile) return { tier: 'local-full', reason: mem + 'GB reported (desktop)' };
      if (mem >= 6) return { tier: 'local-lite', reason: mem + 'GB reported' };
      return { tier: 'remote', reason: mem + 'GB reported — too little to risk a local model' };
    }
    // No deviceMemory API (Safari/Firefox): a coarse, deliberately conservative
    // fallback. Never hand a phone the full-size model on a guess.
    if (isMobile) return { tier: 'local-lite', reason: 'mobile device, memory unreadable on this browser — starting conservative' };
    return { tier: 'local-full', reason: 'desktop, memory unreadable on this browser' };
  }

  // ==========================================================================
  // Which model answers: a CHOICE, not only a capability
  // ==========================================================================
  // ⚠️⚠️ THIS REVERSES THE MODULE'S ORIGINAL DEFAULT, AND THE REVERSAL IS THE
  // WHOLE POINT (2026-09-12, owner: "the model is not so smart").
  // `detectCapability()` above answers "what can this device run?" — and the
  // first build used that answer as the whole decision, so a planner on a good
  // laptop was routed to the LARGEST model a browser tab can hold (3B) while
  // the hosted path they could have reached carries a 70B-class model. The
  // better the machine, the worse the answer. Capability now decides only the
  // LOCAL rung; the hosted model is preferred whenever it is actually reachable.
  //
  // ⚠️ It stays a visible choice rather than a silent switch, because the
  // original ask was explicitly in-browser inference ("totally free... no
  // hosting cost"). Both remain true — Groq's free tier costs nothing either —
  // but "runs on your device" is a property somebody chose on purpose, so it
  // is one click away and remembered per device, not deleted.
  function qualityPref() {
    var q = localStorage.getItem('pormac_quality');
    return q === 'device' ? 'device' : 'best';
  }

  // Asks the Edge Function whether the hosted path is usable for THIS caller
  // right now — deployed, keyed, and not out of quota. ⚠️ It costs no model
  // call and no daily allowance (the function answers `probe` before it
  // reaches the provider), which is what makes it safe to run on every load.
  // ⚠️ ONE caller for the Edge Function. `probeRemote` and `sendRemote` had the
  // same six lines character for character — the token walk, the URL literal,
  // both headers and the empty-object JSON guard — so the function's route name
  // and that guard each had two owners. Each is now just its own error mapping.
  // ⚠️ `timeoutMs` is optional and deliberately NOT applied to a real message:
  // a 70B reply can legitimately take a while, and aborting one would be worse
  // than waiting for it.
  async function callPormacChat(payload, timeoutMs) {
    var { data: sess } = await sb().auth.getSession();
    var token = sess && sess.session && sess.session.access_token;
    if (!token) return { noAuth: true };
    var opts = {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    };
    if (timeoutMs && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
      opts.signal = AbortSignal.timeout(timeoutMs);
    }
    var resp = await fetch(APP_CONFIG.SUPABASE_URL + '/functions/v1/pormac-chat', opts);
    return { resp: resp, body: await resp.json().catch(function () { return {}; }) };
  }

  async function probeRemote() {
    try {
      // ⚠️⚠️ BOUNDED, because `onSend` blocks on this before the first message.
      // Unbounded, a captive portal or a function that hangs rather than 404s
      // stalls the planner's first Enter press for the browser's whole network
      // timeout — in a module whose entire point is that a local model can
      // answer with no network at all. The catch below degrades to the local
      // rung, so a timeout costs 3 seconds, not the session.
      var r = await callPormacChat({ probe: true }, 3000);
      if (r.noAuth) return { ok: false, why: 'not signed in' };
      if (r.resp.ok && r.body.ok) return { ok: true, left: r.body.remaining_today };
      // ⚠️ The three ways this path can be unusable are DIFFERENT problems with
      // different remedies, and a planner told only "unavailable" cannot act on
      // any of them. 404 = the function was never deployed; 503/no_key = it is
      // deployed but has no provider key; 429 = today's allowance is spent.
      if (r.resp.status === 404) return { ok: false, why: 'the cloud assistant has not been deployed yet' };
      if (r.body.code === 'no_key') return { ok: false, why: 'the cloud assistant has no provider key set' };
      if (r.body.code === 'quota') return { ok: false, why: "today's cloud allowance is used up" };
      return { ok: false, why: (r.body.error || ('cloud check returned ' + r.resp.status)) };
    } catch (e) {
      return { ok: false, why: 'the cloud assistant could not be reached' };
    }
  }


  // The one place the tier is decided. Returns the capability answer too, so
  // the Quality control can say what "On this device" would actually give you
  // without re-running the probe.
  async function resolveTier() {
    // ⚠️ The preference chooses an ORDER, not a branch. Written as nested ifs
    // this same logic duplicated the probe call and the reason-building across
    // two arms, and the arm where the planner chose "on this device" on a
    // device that CANNOT run one silently skipped the probe and claimed a
    // hosted model that was never deployed. As a walk, "nothing worked" falls
    // out of exhausting the list instead of needing a separate flag.
    var deviceFirst = qualityPref() === 'device';
    var cap = await detectCapability();          // '…' or 'remote' if it can run nothing locally
    var localOk = cap.tier !== 'remote';
    var order = deviceFirst ? ['local', 'remote'] : ['remote', 'local'];
    var why = [];

    for (var i = 0; i < order.length; i++) {
      if (order[i] === 'local') {
        if (localOk) {
          return { tier: cap.tier, reason: deviceFirst
            ? cap.reason + ' — your choice: on this device'
            : why.concat(['running the smaller on-device model instead']).join(' — ') };
        }
        why.push('this device cannot run a local model');
      } else {
        var probe = await probeRemote();
        if (probe.ok) {
          return { tier: 'remote', reason: why.concat([probe.left != null
            ? probe.left + ' cloud messages left today' : 'the larger hosted model']).join(' — ') };
        }
        why.push(probe.why);
      }
    }
    return { tier: 'none', reason: why.join(' — ') };
  }


  // ==========================================================================
  // The tier table — ONE row per rung, heaviest first
  // ==========================================================================
  // ⚠️⚠️ EVERY PROPERTY OF A TIER LIVES IN THIS TABLE, and that is the point.
  // These same facts used to be spread across six independent `tier === '…'`
  // ternary chains (labels, model patterns, VRAM ceiling, context cap, history
  // depth, the downgrade ladder), so adding one rung meant editing six places
  // and each chain had its own silent `else`. Two real defects came out of that
  // shape, neither of them visible in any single chain:
  //   · `downgrade()` did `order.indexOf(tier)` and an UNRECOGNISED tier gives
  //     -1, so `Math.min(-1 + 1, 3)` is 0 — a failure "downgraded" a planner
  //     UP to the heaviest 8B rung.
  //   · a stale `pormac_tier_override` in localStorage flowed in unvalidated
  //     and landed in every else-branch while the bar read "Choosing a model…"
  //     forever.
  // Both are now impossible: there is one lookup, it validates, and it fails
  // closed. Adding a rung is one row.
  //
  // ⚠️ `none` is a REAL tier, not a flag. "Nothing can answer" is a state this
  // module genuinely reaches (no WebGPU and the hosted path unreachable), and
  // expressing it as a boolean beside the tier meant only the tier BAR honoured
  // it — `onSend` still sent, and the planner got "something went wrong"
  // instead of the diagnosis already on screen two lines above.
  var TIERS = [
    { id: 'local-max',  label: 'On this device — large model',  ctxCap: 5, keep: 12, maxVram: 6500,
      patterns: [/Llama-3\.1-8B-Instruct/i, /Qwen2\.5-7B-Instruct/i, /Mistral-7B-Instruct/i] },
    { id: 'local-full', label: 'On this device — medium model', ctxCap: 4, keep: 8,  maxVram: 3300,
      patterns: [/Llama-3\.2-3B-Instruct/i, /Qwen2\.5-3B-Instruct/i, /Phi-3\.5-mini-instruct/i] },
    { id: 'local-lite', label: 'On this device — small model',  ctxCap: 4, keep: 8,  maxVram: 1400,
      patterns: [/Llama-3\.2-1B-Instruct/i, /Qwen2\.5-1\.5B-Instruct/i, /Qwen2-0\.5B-Instruct/i] },
    { id: 'remote',     label: 'Best quality — large hosted model', ctxCap: 8, keep: 30 },
    { id: 'none',       label: 'No model available',                ctxCap: 0, keep: 0 },
  ];
  var TIER_IDS = TIERS.map(function (t) { return t.id; });
  // ⚠️ Falls back to the SMALLEST local rung, never the largest — an unknown
  // tier is a bug, and the safe guess when you do not know what the device can
  // take is the one that asks least of it.
  function rung(id) {
    var hit = TIERS.filter(function (t) { return t.id === id; })[0];
    return hit || TIERS[2];
  }

  // Step the tier down after a real failure (OOM, context lost, load error),
  // and remember it on THIS device so the next visit does not repeat the
  // failure. This is the "slow down instead of crash" behaviour.
  function downgrade(reason) {
    // ⚠️ Never past 'remote' into 'none' — a local failure says nothing about
    // whether the hosted path works, and parking a planner on "No model
    // available" because their GPU ran out of memory would be a lie.
    var i = TIER_IDS.indexOf(tier);
    var next = TIER_IDS[Math.min((i < 0 ? 0 : i) + 1, TIER_IDS.indexOf('remote'))];
    UI.toast('Pormac: switching to a lighter mode (' + reason + ')', 'warn');
    localStorage.setItem('pormac_tier_override', next);
    tier = next;
    engine = null; engineModelId = null;
    renderTierBar(reason);
  }

  // ⚠️ `tierReason` is genuine state — "what the bar is currently saying" — and
  // it has to be, because `ensureEngine`'s progress callback repaints with a
  // reason hundreds of times during a model load while other callers repaint
  // with none.
  var tierReason = '';

  // ⚠️⚠️ THE CONTROLS ARE REBUILT ONLY WHEN THEY ACTUALLY CHANGE, AND THAT IS
  // NOT AN OPTIMISATION — IT IS THE FIX FOR A DEFECT.
  // This used to rewrite the whole bar's innerHTML on every call, including the
  // <select>. WebLLM's initProgressCallback fires once per downloaded shard, so
  // during a first-time load (a ~5GB download on the large rung) the Quality
  // control was destroyed and rebuilt every few hundred milliseconds — dropping
  // focus and closing its dropdown mid-click, at exactly the moment a planner
  // would want to escape a slow local model. The status text and the busy dot
  // are mutated in place instead; the controls are re-emitted only when the
  // preference or the downgrade flag genuinely differs.
  function renderTierBar(reason) {
    if (reason != null) tierReason = reason;
    var bar = $('pmc-tierbar');
    if (!bar) return;
    var pref = qualityPref();
    var downgraded = !!localStorage.getItem('pormac_tier_override');
    var sig = pref + '|' + downgraded;

    if (bar.getAttribute('data-controls') !== sig) {
      bar.innerHTML =
        '<span class="pmc-tierpill"><span class="pmc-dot"></span><span class="pmc-tierlabel"></span></span>' +
        '<span class="pmc-tierwhy"></span>' +
        '<label class="pmc-quality" title="Which model answers. Best quality runs on a much larger hosted ' +
          'model; on-device runs a smaller one in your browser with no daily limit.">Quality' +
          '<select class="pd-select pd-input-sm" id="pmc-quality">' +
            '<option value="best"' + (pref === 'best' ? ' selected' : '') + '>Best quality</option>' +
            '<option value="device"' + (pref === 'device' ? ' selected' : '') + '>On this device</option>' +
          '</select></label>' +
        (downgraded ? '<button class="pd-btn pd-btn-sm" id="pmc-retry-local">Reset device model</button>' : '');
      bar.setAttribute('data-controls', sig);

      $('pmc-quality').onchange = function (e) {
        localStorage.setItem('pormac_quality', e.target.value === 'device' ? 'device' : 'best');
        // ⚠️ Drop the loaded engine: switching to Best must not keep answering
        // from the small model already sitting in memory, which would make the
        // control look broken while quietly doing nothing.
        engine = null; engineModelId = null;
        tier = null; renderTierBar('switching…');
        capPromise = applyTier();
      };
      var retry = $('pmc-retry-local');
      if (retry) retry.onclick = function () {
        localStorage.removeItem('pormac_tier_override');
        engine = null; engineModelId = null;
        tier = null; renderTierBar('re-checking this device…');
        capPromise = applyTier();
      };
    }

    bar.querySelector('.pmc-tierlabel').textContent = tier ? rung(tier).label : 'Choosing a model…';
    bar.querySelector('.pmc-tierwhy').textContent = tierReason;
    setBusy(sending);
  }

  // The busy dot is a class on one element. Repainting the bar to flip it is
  // what forced `tierReason` into module state in the first place.
  function setBusy(b) {
    var bar = $('pmc-tierbar');
    var pill = bar && bar.querySelector('.pmc-tierpill');
    if (pill) pill.classList.toggle('busy', !!b);
  }

  // One writer for `tier` and the bar — three call sites setting them by hand
  // is three chances for the two to disagree.
  function applyTier() {
    return resolveTier().then(function (r) {
      tier = r.tier;
      renderTierBar(r.reason);
      return r;
    });
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

    // ⚠️ The ceiling was 3B for every capable machine. A 7–8B model is a real
    // step up in reasoning and WebLLM ships several, so a workstation is no
    // longer capped at what a mid-range laptop can hold. The cost is honest and
    // paid once: ~5GB downloaded and cached by the browser on first use.
    // Which patterns and how much VRAM come from the tier table — this used to
    // be two separate ternary chains testing the same tier three lines apart.
    var spec = rung(tier);
    var patterns = spec.patterns, maxVram = spec.maxVram;
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
  // All project ids the planner can currently see, drawn from the same list
  // the project <select> is built from — never a second fetch, and never
  // wider than what RLS would already hand back to `moduleMetrics` itself.
  function allProjectIds() { return PROJECTS.map(function (p) { return p.id; }); }
  function projectNameOf(id) {
    var p = PROJECTS.filter(function (x) { return x.id === id; })[0];
    return p ? p.name : id;
  }

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
        // ⚠️⚠️ PORTFOLIO SCOPE PASSES `moduleMetrics` EVERY PROJECT ID AT ONCE,
        // NOT ONE MODULE PROVIDER PER PROJECT. `moduleMetrics` now accepts an
        // array (`assets/js/db.js`) and reads the whole named table under an
        // `.in(project_col, ids)` filter — one round trip and one aggregate
        // over the portfolio, exactly the arithmetic the Project Dashboard
        // tile already runs per project, just over a wider row set. Fetching
        // per-project and merging client-side would be N round trips for a
        // question that only needs one number.
        fetch: async function () {
          var out2 = await PDb.moduleMetrics(m.dash, portfolioAll ? allProjectIds() : pid);
          return summarizeDash(m, out2, portfolioAll);
        },
      });
    });
    return out;
  }

  function summarizeDash(m, out, portfolio) {
    if (!out || out.__error) return null;
    var lines = [];
    // ⚠️ Says "across every project", or a planner reading "342 activities
    // recorded" would reasonably assume that is one project's count, not the
    // whole portfolio's — the same figure reads as two very different facts.
    if (out.__rows != null) lines.push(out.__rows + ' ' + (m.dash.unit || 'records') +
      (portfolio ? ' recorded across every project you can see.' : ' recorded.'));
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
          // ⚠️ `!portfolioAll` gates the scoped attempt — with Portfolio
          // checked the planner asked for every project, so trying (and
          // failing) a single-project match first would just be a wasted
          // round trip in front of the answer they wanted.
          // ⚠️⚠️ `id` IS THE PAGING CURSOR AND HAD TO BE ADDED TO ALL THREE MIRROR READS.
          // `PDb.selectAll` reads its next cursor off the last RETURNED ROW OBJECT, so a cursor
          // left out of the column list is `undefined`, `undefined == null` is true, and the loop
          // returned after ONE page. Every figure in the sentence below -- the work-package count,
          // how many are awarded, the approved-budget total and the awarded-cost total -- was a
          // sum over AT MOST THE FIRST 1000 ROWS, and the assistant stated it as fact.
          // ⚠️⚠️ NOT HYPOTHETICAL FOR THIS TABLE. `supabase/functions/sync-wpm` says of the very
          // rows it mirrors here: *"Unscoped -- which is what any full or cron sync does -- this
          // reads EVERY work package in the WPM portfolio, far past the 1000-row cap."* The
          // unscoped fallback on the next line is exactly that read.
          // ⚠️ `selectAll` now forces the cursor in by itself; these stay explicit so the list
          // reads as what it is rather than as a projection that happens to work.
          var scoped = (pid && !portfolioAll) ? await PDb.selectAll('wpm_work_packages', function (q) { return q.eq('wpm_project_id', pid); },
            'id,wp_no,description,approved_budget_bcb,awarded_cost,award_status,procurement_status,delivery_status') : [];
          var rows = scoped.length ? scoped : await PDb.selectAll('wpm_work_packages', null,
            'id,wp_no,description,approved_budget_bcb,awarded_cost,award_status,procurement_status,delivery_status');
          if (!rows.length) return null;
          var awarded = rows.filter(function (r) { return r.award_status && /award/i.test(r.award_status); }).length;
          var totalBudget = rows.reduce(function (n, r) { return n + (Number(r.approved_budget_bcb) || 0); }, 0);
          var totalAwarded = rows.reduce(function (n, r) { return n + (Number(r.awarded_cost) || 0); }, 0);
          var scope = scoped.length ? 'for this project'
            : (portfolioAll ? 'PORTFOLIO-WIDE, as asked' : 'PORTFOLIO-WIDE — could not confirm which rows belong to this project');
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
          var rows = await PDb.selectAll('wpm_vendors', null, 'id,name,trade_categories,accreditation,status');
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
          if (!pid && !(portfolioAll && allProjectIds().length)) return null;
          // project_id carries THIS app's id here (see the mirror's own
          // comment) so this is a clean, real project-scoped — or, under
          // Portfolio, `.in(...)` over every project's id — filter.
          var rows = await PDb.selectAll('eng_design_progress',
            function (q) { return portfolioAll ? q.in('project_id', allProjectIds()) : q.eq('project_id', pid); },
            'id,project_id,source,top_level,basis,percent_complete,units_total,units_done,synced_at');
          if (!rows.length) return null;
          var asOf = rows[0] && rows[0].synced_at ? Fmt.date(rows[0].synced_at) : null;
          if (!portfolioAll) {
            var lines = rows.map(function (r) {
              return r.top_level + ' (' + r.source + '): ' + (r.percent_complete != null ? r.percent_complete + '%' : '—') +
                (r.units_total ? ' (' + (r.units_done || 0) + '/' + r.units_total + ')' : '');
            });
            return 'Engineering design progress (mirrored from the Engineering App' + (asOf ? ', as of ' + asOf : '') + '): ' + lines.join('; ');
          }
          // ⚠️⚠️ PORTFOLIO SCOPE GROUPS BY PROJECT INSTEAD OF LISTING EVERY
          // ROW. Every tower of every project, one line each, would be the
          // largest single block gatherContext produces and could crowd out
          // every other module's context on a portfolio with a handful of
          // projects. One line per project — its own average percent
          // complete over its own rows — keeps this bounded the same way
          // `summarizeDash`'s "top N" lists already are, and a planner
          // asking a portfolio-wide question wants "which projects are
          // behind on design", not every drawing set's own tower.
          var byProj = {};
          rows.forEach(function (r) {
            var g = byProj[r.project_id] || (byProj[r.project_id] = { sum: 0, n: 0 });
            if (r.percent_complete != null) { g.sum += Number(r.percent_complete) || 0; g.n++; }
          });
          var perProj = Object.keys(byProj).map(function (id) {
            var g = byProj[id];
            return projectNameOf(id) + ' ' + (g.n ? Math.round(g.sum / g.n) + '%' : '—');
          });
          return 'Engineering design progress (mirrored from the Engineering App' + (asOf ? ', as of ' + asOf : '') +
            ', portfolio-wide, own average % complete per project): ' + perProj.slice(0, 12).join('; ') +
            (perProj.length > 12 ? ' (+' + (perProj.length - 12) + ' more project(s))' : '') + '.';
        },
      },
    ];
  }

  function allProviders() { return moduleProviders().concat(mirrorProviders()); }

  // Match the question against every provider's keywords; if nothing matches,
  // default to a small, generally-useful set so a vague question still gets
  // something rather than nothing. Capped, so the prompt stays small enough
  // for a 1–3B local model's context window.
  // The project the planner has selected, named the way the picker names it —
  // read off the live <select> so it cannot disagree with what is on screen.
  // ⚠️ Portfolio scope wins over whatever the (hidden) select still shows —
  // it is left holding its last real value rather than reset to blank (see
  // `setPortfolioAll`), so reading it here without checking `portfolioAll`
  // first would report a stale single project while every context provider
  // had already switched to answering across all of them.
  function projectLabel() {
    if (portfolioAll) return 'Portfolio — every project you can see (' + PROJECTS.length + ' projects)';
    var sel = $('pmc-project');
    var opt = sel && sel.options[sel.selectedIndex];
    return (pid && opt && opt.text) || '';
  }

  async function gatherContext(question) {
    var providers = allProviders();
    var matched = providers.filter(function (p) { return p.keywords.test(question); });
    if (!matched.length) matched = providers.filter(function (p) { return p.key === 'project-schedule' || p.key === 'risk-register'; });

    // ⚠️ How many modules to pull in is bounded by the MODEL's window, not by a
    // constant. Four was chosen for a 1B model; on the hosted model it was
    // withholding most of the project from a question that spans modules
    // ("are the delays on the critical path tied to any open claim?"), which
    // is exactly the kind of question a planner asks an assistant.
    matched = matched.slice(0, rung(tier).ctxCap);

    // ⚠️ Fetched in PARALLEL, not in sequence. Each provider is its own round
    // trip, so eight of them in a row put eight latencies between the planner's
    // question and the first token. `Promise.all` over per-provider catches
    // keeps the isolation the sequential loop had — one failing provider must
    // not take the others with it — while costing one latency instead of N.
    var results = await Promise.all(matched.map(function (p) {
      // ⚠️ Portfolio scope satisfies `needsProject` too — it is a project
      // scope (every project at once), not the absence of one; a provider
      // gated on "there must be SOME project context" should run, and each
      // provider's own `fetch` is what decides single-project vs. `.in(...)`.
      if (p.needsProject && !pid && !portfolioAll) return Promise.resolve(null);
      return Promise.resolve().then(p.fetch).then(
        function (text) { return text ? { label: p.label, text: text } : null; },
        function () { return null; }
      );
    }));

    var used = [], blocks = [];
    // ⚠️ Name the project (or the scope) first. Without it the model is
    // reading a pile of figures with nothing saying what they describe, and
    // answers generically about "the project" because that is genuinely all
    // it was told. Portfolio scope needs its own label rather than
    // "Project: Portfolio — every…" — it is not a project.
    var proj = projectLabel();
    if (proj) blocks.push((portfolioAll ? 'Scope: ' : 'Project: ') + proj);
    results.forEach(function (r) {
      if (!r) return;
      blocks.push(r.text);
      used.push(r.label);
    });
    return { used: used, text: blocks.join('\n') };
  }

  // ==========================================================================
  // Sending a message
  // ==========================================================================
  // ⚠️ A weak model gets much of its apparent intelligence from the instructions,
  // so this says what a good answer LOOKS like rather than only what to avoid.
  // The original was three sentences of prohibitions ("don't guess, be
  // concise"), which is most of what made replies read as evasive: told only
  // what not to do, a small model hedges.
  var SYSTEM_PROMPT = [
    'You are Pormac, an assistant inside Megawide’s Planners Dashboard. You help construction',
    'Planning Engineers read their own project data: schedule, risks, stakeholders, contracts,',
    'claims, cash flow, manpower, equipment, progress photos, procurement and engineering design.',
    '',
    'How to answer:',
    '- Lead with the direct answer in one sentence, then the figures that support it.',
    '- QUOTE THE ACTUAL NUMBERS from the context below. A planner asking "how far behind are we"',
    '  wants the days and the dates, not a description of where to find them.',
    '- Use the planner’s vocabulary: activity, WBS, float, baseline, POC, BOQ, variation, EOT.',
    '- Keep it short. A few sentences or a tight list. No preamble, no restating the question.',
    '',
    'Honesty rules:',
    '- The context below is the ONLY project data you have. Never invent a figure, date, name or',
    '  ID that is not in it.',
    '- If the context does not answer the question, say so in one line and name the module the',
    '  planner should open. Do not pad the answer with generic construction advice.',
    '- Figures mirrored from the Procurement or Engineering apps may lag the live register there;',
    '  say so when you quote one.',
  ].join('\n');

  async function onSend() {
    if (sending) return;
    var input = $('pmc-input');
    var text = input.value.trim();
    if (!text) return;
    sending = true;
    if (tier === null && capPromise) await capPromise; // don't race the capability check
    input.value = ''; input.style.height = 'auto';
    pushMessage('user', text, null, null);

    // ⚠️ `none` means resolveTier() already established that nothing can
    // answer. Sending anyway would replace the diagnosis on the tier bar with
    // a generic "something went wrong" — the planner would lose the one line
    // that says what to fix.
    if (tier === 'none') {
      pushMessage('assistant', 'No model is available right now — ' + tierReason + '.');
      sending = false;
      return;
    }

    var ctx = await gatherContext(text);
    var placeholder = pushMessage('assistant', '', null, ctx.used);
    setBusy(true);

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
      setBusy(false);
    }
  }

  function promptMessages(question, contextText) {
    var msgs = [{ role: 'system', content: SYSTEM_PROMPT + (contextText ? '\n\nProject data available to you:\n' + contextText : '\n\nNo project data is loaded for this question.') }];
    // ⚠️ How much conversation to carry is a property of the MODEL, not of the
    // module. A 1B model's window is a few thousand tokens and stuffing it
    // makes answers worse; the hosted model accepts 131k, where cutting the
    // thread at 8 turns was throwing away the context that makes a follow-up
    // question ("and the one after that?") answerable at all.
    var recent = chatHistory.slice(-rung(tier).keep);
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
    var r = await callPormacChat({ messages: promptMessages(question, contextText) });
    if (r.noAuth) throw new Error('not signed in');
    if (!r.resp.ok) throw new Error(r.body.error || ('the hosted model returned ' + r.resp.status));
    // ⚠️ The reply carries the allowance left, so the tier bar is refreshed from
    // the answer rather than re-probing for a number the send already returned.
    if (r.body.remaining_today != null && tier === 'remote') {
      renderTierBar(r.body.remaining_today + ' cloud messages left today');
    }
    return r.body.reply || '(no response)';
  }


  // ==========================================================================
  // Persistence — best-effort. A migration that hasn't run yet, or an access
  // rule that says no, must not stop the chat from working; it just stops it
  // from being remembered.
  // ==========================================================================
  async function persistTurn(userText, replyText, used) {
    try {
      if (!conversationId) {
        // ⚠️ `project_id` is a FK to `projects(id)` — Portfolio scope stores
        // NULL, same as General, never `pid` (which could still hold a stale
        // project id from before Portfolio was checked; see `projectLabel`).
        var { data, error } = await sb().from('pormac_conversations')
          .insert({ project_id: portfolioAll ? null : pid, title: userText.slice(0, 60), created_by: profile.id })
          .select('id').single();
        if (error) throw error;
        conversationId = data.id;
      } else {
        // `loadConversation()` picks this project's canonical conversation by
        // `updated_at desc`, and nothing else in this table ever bumps it —
        // without this, an ongoing thread would lose that role to any older
        // row that happened to be touched more recently.
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

  // `note` replaces the thread with a single system line (loading / a failed
  // history read); `truncated` prefixes the thread with one, because a planner
  // scrolling to the top of a capped thread would otherwise read it as the
  // start of the conversation.
  function renderMessages(note, truncated) {
    var thread = $('pmc-thread');
    thread.innerHTML = '';
    if (note) { pushMessage('system', note); return; }
    if (!chatHistory.length) {
      pushMessage('system', portfolioAll
        ? 'Ask me anything across the portfolio — I’ll answer using data from every project you can see. Everything you ask here stays in one running conversation — scroll back any time.'
        : pid
        ? 'Ask me anything about this project. Everything you ask here stays in one running conversation — scroll back any time.'
        : 'Pick a project above for grounded answers, or ask a general question.');
      return;
    }
    if (truncated) pushMessage('system', 'Showing the most recent ' + MSG_CAP + ' messages of this conversation.');
    chatHistory.forEach(function (m) { pushMessage(m.role, m.content); });
  }

  return { init: init };
})();
