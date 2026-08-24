/* PMI tracking — inside the Contracts & Claims module.
   Implements ROADMAP B2a (bucket + typed attachments), B2b (the record: dual
   refs, parent/revision/spawn relations, receipt stage, per-stage aging) and
   B2c (the per-contract cost rate card, whose priced lines land in boq_items as
   change_order scope).

   Design note: docs/boq-and-pmi.md §5. Every ⚠️ here comes from a real 14-page
   filed PMI (MST347. OPS. VO-PMI 29.2 rev1), measured rather than assumed.

   THE CORE INSIGHT: a filed PMI is a CASE FILE, not a form. Fourteen pages, five
   documents, three authors, eighteen months. So the record is many typed
   attachments plus three distinct relations plus a per-stage clock — and the
   parts that vary by client are configuration, not code.

   Hosted by ContractsClaims (see module.js), like boq.js. */
window.PMI = (function () {
  'use strict';

  var T_PMI = 'pmi_records', T_ATT = 'pmi_attachments',
      T_PROF = 'contract_profiles', T_TERMS = 'contract_cost_terms',
      T_REV = 'boq_revisions', T_ITEM = 'boq_items';
  var BUCKET = 'contracts-claims';
  var MIGRATION = 'migrations/2026-08-25-pmi.sql';

  var sb = function () { return window.__sb || (window.__sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY)); };
  var esc = function (s) { return Fmt.esc(s == null ? '' : String(s)); };

  // ---- state ---------------------------------------------------------------
  var UID = null, canWrite = false, isAdmin = false, pid = null, projLabel = '';
  var RECS = [], ATT = {}, PROFILES = [], TERMS = {}, LINES = {}, REVS = {};
  var sub = 'register', loaded = false, selId = null;
  var filt = { q: '', stage: '', outcome: '', latest: '1' };

  // ==========================================================================
  // VOCABULARY
  // ==========================================================================
  /* ⚠️ RECEIPT IS FIRST, and it is the addition that matters. The four
     commercial stages after it are the module's existing pipeline, kept verbatim
     — what they never carried is that the instruction ARRIVES before we estimate
     anything, and time sitting on an un-responded PMI is OUR exposure. */
  var STAGES = [
    { key: 'received',        label: 'Received',        clock: 'date_received',  note: 'awaiting our response' },
    { key: 'estimated',       label: 'Estimated',       clock: 'date_estimated', note: 'estimated, not yet submitted' },
    { key: 'submitted',       label: 'Submitted',       clock: 'date_submitted', note: 'with the client' },
    { key: 'evaluated',       label: 'Evaluated',       clock: 'date_evaluated', note: 'evaluated, awaiting decision' },
    { key: 'client_approved', label: 'Client approved', clock: null,             note: 'decided' },
    { key: 'rejected',        label: 'Rejected',        clock: null,             note: 'decided' },
    { key: 'withdrawn',       label: 'Withdrawn',       clock: null,             note: 'closed without a decision' }
  ];
  var STAGE_BY = {}; STAGES.forEach(function (s) { STAGE_BY[s.key] = s; });
  /* Reusing contracts_claims' own outcome vocabulary rather than inventing a
     parallel one — the two registers are read side by side, and two spellings of
     "Approved" is how a report ends up unable to join them. */
  var OUTCOMES = ['Pending', 'Approved', 'Disapproved', 'Cancelled'];
  var DOC_TYPES = [
    { key: 'cost_proposal',     label: 'Cost proposal' },
    { key: 'client_form',       label: "Client's PMI form" },
    { key: 'product_data',      label: 'Product data / photos' },
    { key: 'testing_report',    label: 'Testing report' },
    { key: 'supplier_contract', label: 'Supplier contract' },
    { key: 'other',             label: 'Other' }
  ];
  var DOC_LABEL = {}; DOC_TYPES.forEach(function (d) { DOC_LABEL[d.key] = d.label; });

  /* The real build-up, offered as a TEMPLATE the planner accepts — never seeded
     into the database, because a seeded card is the hard-coded 10/20/12 by
     another name and would be silently applied to the next client. */
  var CARD_TEMPLATE = [
    { code: 'A', label: 'Direct cost (material + labour), VAT-ex', kind: 'direct',     basis_codes: [],          rate: null, is_total: false },
    { code: 'B', label: 'Add markup',                              kind: 'markup_add', basis_codes: ['A'],       rate: 0.10, is_total: false },
    { code: 'C', label: 'Fix cost (as per contract)',              kind: 'percent_of', basis_codes: ['B'],       rate: 0.20, is_total: false },
    { code: 'D', label: 'Subtotal',                                kind: 'sum',        basis_codes: ['B', 'C'],  rate: null, is_total: false },
    { code: 'E', label: 'VAT',                                     kind: 'percent_of', basis_codes: ['D'],       rate: 0.12, is_total: false },
    { code: 'F', label: 'TOTAL',                                   kind: 'sum',        basis_codes: ['D', 'E'],  rate: null, is_total: true }
  ];

  // ==========================================================================
  // HELPERS
  // ==========================================================================
  var MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function pad2(n) { return String(n).padStart(2, '0'); }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function fmtDate(s) {
    if (!s) return '';
    var p = String(s).slice(0, 10).split('-');
    if (p.length !== 3) return esc(s);
    return pad2(+p[2]) + '-' + MN[+p[1] - 1] + '-' + String(p[0]).slice(2);
  }
  /* Whole days, UTC, so DST can never shift a count. Same helper the claims
     register uses — the two aging figures must be computed the same way or a
     report comparing them is comparing two different things. */
  function daysBetween(a, b) {
    if (!a || !b) return null;
    var pa = String(a).slice(0, 10).split('-'), pb = String(b).slice(0, 10).split('-');
    if (pa.length !== 3 || pb.length !== 3) return null;
    return Math.round((Date.UTC(+pb[0], +pb[1] - 1, +pb[2]) - Date.UTC(+pa[0], +pa[1] - 1, +pa[2])) / 86400000);
  }
  function money(n) {
    if (n == null || !isFinite(n)) return '';
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function txt(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function normKey(s) { return txt(s).toLowerCase(); }

  /* ⚠️ AGING IS PER STAGE, DERIVED, NEVER STORED. One aging number over a
     16-month case answers nothing — "days since receipt while un-responded" and
     "days in internal approval" are different questions with different owners.
     The existing rules carry over unchanged: null when decided, null on a future
     date, never negative. */
  function agingOf(r) {
    var st = STAGE_BY[r.stage];
    if (!st || !st.clock) return null;            // decided or closed: the clock has stopped
    var from = r[st.clock];
    if (!from) return null;                        // the stage has no start date recorded
    var d = daysBetween(from, todayISO());
    return d != null && d >= 0 ? { days: d, stage: r.stage, since: from, note: st.note } : null;
  }
  function isDecided(r) { return r.stage === 'client_approved' || r.stage === 'rejected'; }
  /* ⚠️ Total time on our desk from receipt, reported SEPARATELY from the stage
     clock. It is the exposure figure, and it keeps running across stages. */
  function totalAgeOf(r) {
    var end = r.date_decided || todayISO();
    var d = daysBetween(r.date_received || r.date_issued, end);
    return d != null && d >= 0 ? d : null;
  }

  function refOf(r) {
    var a = txt(r.our_ref), b = txt(r.client_ref);
    if (a && b) return a + '  ·  ' + b;
    return a || b || '(unreferenced)';
  }
  function labelFor(r) {
    var p = PROFILES.find(function (x) { return x.id === (r && r.profile_id); }) ||
            PROFILES.find(function (x) { return x.is_default; });
    return (p && p.instruction_label) || 'PMI';
  }
  function recById(id) { return RECS.find(function (r) { return r.id === id; }) || null; }

  // ==========================================================================
  // THE COST BUILD-UP (B2c) — derived from the lines + the card, never stored
  // ==========================================================================
  /* ⚠️ A step may only reference EARLIER steps. A forward or missing reference
     yields null, NOT 0 — a zero silently understates the total, and this is a
     number that gets quoted in a meeting. The UI reports the broken step. */
  function evalCard(card, directTotal) {
    var steps = (card || []).slice().sort(function (a, b) { return (a.step_order || 0) - (b.step_order || 0); });
    var byCode = {}, out = [], problems = [];
    steps.forEach(function (s) {
      var code = String(s.code || '').toUpperCase(), v = null;
      if (s.kind === 'direct') {
        v = Number(directTotal) || 0;
      } else {
        var codes = (s.basis_codes || []).map(function (c) { return String(c).toUpperCase(); });
        var bases = codes.map(function (c) { return Object.prototype.hasOwnProperty.call(byCode, c) ? byCode[c] : undefined; });
        if (!codes.length || bases.some(function (b) { return b === undefined || b === null; })) {
          problems.push({ code: code, why: !codes.length ? 'no basis set' : 'basis ' + codes.join('+') + ' is missing or comes later' });
        } else if (s.kind === 'markup_add') {
          v = bases[0] * (1 + (Number(s.rate) || 0));
        } else if (s.kind === 'percent_of') {
          v = bases[0] * (Number(s.rate) || 0);
        } else if (s.kind === 'sum') {
          v = bases.reduce(function (a, b) { return a + b; }, 0);
        }
      }
      byCode[code] = v;
      out.push({ code: code, label: s.label, kind: s.kind, basis_codes: s.basis_codes || [],
                 rate: s.rate, is_total: !!s.is_total, step_order: s.step_order, value: v });
    });
    var totalStep = out.filter(function (s) { return s.is_total; }).pop() || out[out.length - 1] || null;
    return { steps: out, byCode: byCode, problems: problems, total: totalStep ? totalStep.value : null };
  }
  /* The direct cost is the sum of the proposal's own priced lines. Material and
     labour are summed separately too, because the sheet states them separately
     and the split survives into the claim. */
  function directOf(lines) {
    var t = { total: 0, mat: 0, lab: 0, n: 0 };
    (lines || []).forEach(function (l) {
      if (l.amount == null) return;
      t.total += Number(l.amount); t.n++;
      if (l.mat_amount != null) t.mat += Number(l.mat_amount);
      if (l.lab_amount != null) t.lab += Number(l.lab_amount);
    });
    return t;
  }
  /* ⚠️ A PROPOSAL WITH NO PRICED LINES HAS NO TOTAL — it is NOT priced at zero.
     Rendering ₱0.00 there asserts we quoted nothing, which is the same false
     equivalence this module refuses elsewhere: in the BOQ a scope-boundary
     statement ("By Megaworld") is stored verbatim rather than coerced to 0,
     because a zero and "nobody has priced this" are different facts — and only
     one of them is safe to put in front of a client. Caught by rendering the
     register against a fixture where most instructions are unpriced. */
  function proposalTotal(r) {
    var lines = LINES[r.id] || [];
    if (!lines.length) return null;
    var card = cardFor(r);
    if (!card.length) return null;              // no rate card = nothing to price through
    return evalCard(card, directOf(lines).total).total;
  }
  function cardFor(r) {
    var p = (r && r.profile_id) || (PROFILES.find(function (x) { return x.is_default; }) || {}).id;
    return TERMS[p] || [];
  }

  // ==========================================================================
  // ATTACHMENT COMPLETENESS (§5.1)
  // ==========================================================================
  function profileOf(r) {
    return PROFILES.find(function (x) { return x.id === (r && r.profile_id); }) ||
           PROFILES.find(function (x) { return x.is_default; }) || null;
  }
  /* ⚠️ "Has the cost proposal been submitted?" is a different question from "is
     the testing report attached?", which is exactly why attachments are typed
     and why a single file column could never answer a QS chasing one. */
  function completeness(r) {
    var p = profileOf(r), need = (p && p.required_docs) || [];
    var have = {}; (ATT[r.id] || []).forEach(function (a) { have[a.doc_type] = (have[a.doc_type] || 0) + 1; });
    var missing = need.filter(function (d) { return !have[d]; });
    return { need: need, have: have, missing: missing, ok: !missing.length, count: (ATT[r.id] || []).length };
  }

  // ==========================================================================
  // LOAD
  // ==========================================================================
  function migHint(err) {
    var m = (err && err.message) || '';
    return /does not exist|schema cache|PGRST20|relation|column/i.test(m)
      ? ' Run <code>' + MIGRATION + '</code> in the Supabase SQL editor, then reload.' : '';
  }

  async function load() {
    loaded = false;
    RECS = []; ATT = {}; PROFILES = []; TERMS = {}; LINES = {}; REVS = {};
    if (!pid) { render(); return; }
    try {
      PROFILES = await PDb.selectAll(T_PROF, function (q) { return q.eq('project_id', pid); });
      var terms = await PDb.selectAll(T_TERMS, function (q) { return q.eq('project_id', pid); });
      TERMS = {}; terms.forEach(function (t) { (TERMS[t.profile_id] = TERMS[t.profile_id] || []).push(t); });
      Object.keys(TERMS).forEach(function (k) { TERMS[k].sort(function (a, b) { return a.step_order - b.step_order; }); });

      RECS = await PDb.selectAll(T_PMI, function (q) { return q.eq('project_id', pid); });
      RECS.sort(function (a, b) {
        return String(b.date_received || b.date_issued || '').localeCompare(String(a.date_received || a.date_issued || '')) ||
               String(b.our_ref || '').localeCompare(String(a.our_ref || ''), undefined, { numeric: true });
      });
      var atts = await PDb.selectAll(T_ATT, function (q) { return q.eq('project_id', pid); });
      ATT = {}; atts.forEach(function (a) { (ATT[a.pmi_id] = ATT[a.pmi_id] || []).push(a); });

      // The priced scope: one boq_revision per PMI, and its lines.
      var revs = await PDb.selectAll(T_REV, function (q) { return q.eq('project_id', pid).not('pmi_id', 'is', null); });
      REVS = {}; revs.forEach(function (v) { REVS[v.pmi_id] = v; });
      if (revs.length) {
        var items = await PDb.selectAll(T_ITEM, function (q) { return q.eq('project_id', pid).not('pmi_id', 'is', null); });
        LINES = {}; items.forEach(function (l) { (LINES[l.pmi_id] = LINES[l.pmi_id] || []).push(l); });
        Object.keys(LINES).forEach(function (k) { LINES[k].sort(function (a, b) { return a.source_row - b.source_row; }); });
      }
      loaded = true;
    } catch (err) {
      var host = document.getElementById('cc-view');
      if (host) host.innerHTML = '<div class="pd-card cc-empty"><h3>Could not load the PMI register</h3><p>' +
        esc(err.message || String(err)) + '</p><p class="cc-mut">' + migHint(err) + '</p></div>';
      return;
    }
    render();
  }

  // ==========================================================================
  // RENDER — shell
  // ==========================================================================
  var SUBS = [{ key: 'register', label: 'Register' }, { key: 'terms', label: 'Cost Terms' }];

  function render() {
    var host = document.getElementById('cc-view');
    if (!host) return;
    if (!pid) { host.innerHTML = '<div class="pd-card cc-empty"><h3>Select a project</h3></div>'; return; }
    if (!loaded) { host.innerHTML = '<div class="pd-card cc-empty"><h3><span class="cc-spin"></span>Loading the register…</h3></div>'; return; }

    var h = '<div class="boq-bar"><div class="boq-subtabs">' +
      SUBS.map(function (s) { return '<button class="boq-subtab' + (sub === s.key ? ' active' : '') + '" data-psub="' + s.key + '">' + esc(s.label) + '</button>'; }).join('') +
      '</div><span class="boq-spacer"></span>' +
      (canWrite && sub === 'register' ? '<button class="pd-btn pd-btn-primary" id="pmi-new">+ New ' + esc(labelFor(null)) + '</button>' : '') +
      '</div>';

    h += sub === 'terms' ? termsHTML() : registerHTML();
    host.innerHTML = h;
    if (window.Icons && Icons.hydrate) Icons.hydrate(host);
    host.querySelectorAll('[data-psub]').forEach(function (b) { b.onclick = function () { sub = b.dataset.psub; render(); }; });
    var n = host.querySelector('#pmi-new'); if (n) n.onclick = function () { openForm(null); };
    if (sub === 'register') wireRegister(host); else wireTerms(host);
  }

  function kpi(label, value, sub2, cls) {
    return '<div class="cc-kpi ' + (cls || '') + '"><div class="cc-kpi-l">' + esc(label) + '</div>' +
      '<div class="cc-kpi-v">' + value + '</div><div class="cc-kpi-s">' + esc(sub2 || '') + '</div></div>';
  }

  // ==========================================================================
  // REGISTER
  // ==========================================================================
  function visible() {
    var q = normKey(filt.q);
    return RECS.filter(function (r) {
      if (filt.latest === '1' && !r.is_latest) return false;
      if (filt.stage && r.stage !== filt.stage) return false;
      if (filt.outcome && (r.outcome || '') !== filt.outcome) return false;
      if (!q) return true;
      // ⚠️ BOTH references are searched. The number you cannot search on is the
      //    one the other party will cite in the meeting where it matters.
      return normKey([r.our_ref, r.client_ref, r.title, r.scope, r.remarks].join(' ')).indexOf(q) >= 0;
    });
  }

  function registerHTML() {
    var list = visible();
    var open = RECS.filter(function (r) { return r.is_latest && !isDecided(r) && r.stage !== 'withdrawn'; });
    var unresponded = open.filter(function (r) { return r.stage === 'received'; });
    var ages = open.map(agingOf).filter(Boolean).map(function (a) { return a.days; });
    var oldest = ages.length ? Math.max.apply(null, ages) : 0;
    /* ⚠️ Approval rate over DECIDED records only, and it says so. The naive
       denominator (everything submitted) counts still-pending instructions as
       failures — on the real fixture that read 0.2% where the honest figure was
       85.0% of one decided record, and a register that lives 18 months per case
       makes that worse, not better. */
    var decided = RECS.filter(function (r) { return r.is_latest && isDecided(r); });
    var approved = decided.filter(function (r) { return r.stage === 'client_approved'; });
    var rate = decided.length ? (approved.length / decided.length * 100) : null;

    var h = '<div class="cc-kpis">' +
      kpi(labelFor(null) + 's', RECS.filter(function (r) { return r.is_latest; }).length, RECS.length + ' rows incl. superseded') +
      kpi('Open', open.length, 'not yet decided', open.length ? 'warn' : 'good') +
      kpi('Un-responded', unresponded.length, 'received, not estimated — our exposure', unresponded.length ? 'bad' : 'good') +
      kpi('Oldest in stage', oldest ? oldest + 'd' : '—', 'days in its current stage', oldest >= 90 ? 'bad' : oldest >= 30 ? 'warn' : '') +
      kpi('Approval rate', rate == null ? '—' : rate.toFixed(1) + '%',
          decided.length ? 'of ' + decided.length + ' decided ' + (decided.length === 1 ? 'record' : 'records') : 'nothing decided yet') +
      '</div>';

    if (!PROFILES.length) {
      h += '<div class="boq-alert warn"><strong>No contract profile yet.</strong> The instruction label, the reference ' +
        'pattern, the required-document checklist and the cost build-up are all <em>per contract</em> — the format varies ' +
        'by client, so none of it is hard-coded. Set one up under <strong>Cost Terms</strong>; until then this screen says ' +
        '"PMI" and no documents are treated as mandatory.</div>';
    }
    if (unresponded.length) {
      var worst = unresponded.map(agingOf).filter(Boolean).sort(function (a, b) { return b.days - a.days; })[0];
      h += '<div class="boq-alert bad"><strong>' + unresponded.length + ' instruction' + (unresponded.length === 1 ? '' : 's') +
        ' received and not yet estimated' + (worst ? ', the oldest for <strong>' + worst.days + ' days</strong>' : '') + '.</strong> ' +
        'Time sitting on an un-responded instruction is our own exposure, and it is the thing a four-stage commercial ' +
        'pipeline cannot show.</div>';
    }

    h += '<div class="boq-filters">' +
      '<input class="pd-input" id="pmi-f-q" placeholder="Search either reference, title or scope…" value="' + esc(filt.q) + '" />' +
      '<select class="pd-select" id="pmi-f-stage"><option value="">All stages</option>' +
        STAGES.map(function (s) { return '<option value="' + s.key + '"' + (filt.stage === s.key ? ' selected' : '') + '>' + esc(s.label) + '</option>'; }).join('') + '</select>' +
      '<select class="pd-select" id="pmi-f-outcome"><option value="">All outcomes</option>' +
        OUTCOMES.map(function (o) { return '<option' + (filt.outcome === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>' +
      '<select class="pd-select" id="pmi-f-latest">' +
        '<option value="1"' + (filt.latest === '1' ? ' selected' : '') + '>Latest revisions only</option>' +
        '<option value=""' + (filt.latest === '' ? ' selected' : '') + '>Include superseded</option></select>' +
      '<span class="cc-count">' + list.length + ' of ' + RECS.length + '</span></div>';

    h += '<div class="pd-card cc-tablecard"><table class="cc-table boq-table"><thead><tr>' +
      '<th class="cc-desc">Reference / title</th><th>Stage</th><th class="cc-r">In stage</th>' +
      '<th class="cc-r">Total age</th><th>Outcome</th><th class="cc-r">Proposal total</th>' +
      '<th>Docs</th><th>Links</th>' + (canWrite ? '<th class="cc-actcol"></th>' : '') +
      '</tr></thead><tbody>';

    if (!list.length) h += '<tr><td colspan="9" class="cc-mut" style="text-align:center;padding:32px;">No instructions match these filters.</td></tr>';
    list.forEach(function (r) {
      var ag = agingOf(r), tot = totalAgeOf(r), c = completeness(r);
      var card = evalCard(cardFor(r), directOf(LINES[r.id]).total);
      var ptot = proposalTotal(r);
      var agCls = !ag ? '' : ag.days >= 90 ? ' bad' : ag.days >= 30 ? ' warn' : '';
      h += '<tr data-id="' + esc(r.id) + '"' + (r.is_latest ? '' : ' class="pmi-superseded"') + '>' +
        '<td class="cc-desc"><div class="cc-desc-txt">' + esc(txt(r.title) || '(untitled)') + '</div>' +
          '<div class="cc-mini pmi-refs">' + esc(refOf(r)) + '</div></td>' +
        '<td><span class="boq-kind k-' + esc(r.stage) + '">' + esc((STAGE_BY[r.stage] || {}).label || r.stage) + '</span>' +
          (r.is_latest ? '' : '<div class="cc-mini">superseded</div>') + '</td>' +
        '<td class="cc-r"><span class="cc-age' + agCls + '">' + (ag ? ag.days + 'd' : '') + '</span>' +
          (ag ? '<div class="cc-mini">' + esc(ag.note) + '</div>' : '') + '</td>' +
        '<td class="cc-r">' + (tot == null ? '' : tot + 'd') + '</td>' +
        '<td>' + (r.outcome ? '<span class="cc-st st-' + esc(String(r.outcome).toLowerCase()) + '">' + esc(r.outcome) + '</span>' : '<span class="cc-mut">—</span>') + '</td>' +
        '<td class="cc-r">' + (ptot == null ? '<span class="cc-mut">not priced</span>' : money(ptot)) +
          (ptot != null && card.problems.length ? '<div class="cc-mini boq-bad">card incomplete</div>' : '') + '</td>' +
        '<td>' + docChip(c) + '</td>' +
        '<td>' + linksChip(r) + '</td>' +
        (canWrite ? '<td class="cc-actcol"><button class="pd-btn" data-open="' + esc(r.id) + '">Open</button></td>' : '') +
        '</tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  function docChip(c) {
    if (!c.need.length) return '<span class="boq-alloc none">' + c.count + ' file' + (c.count === 1 ? '' : 's') + '</span>';
    var cls = c.ok ? 'full' : c.count ? 'part' : 'none';
    return '<span class="boq-alloc ' + cls + '" title="' + esc(c.ok ? 'all required documents attached'
      : 'missing: ' + c.missing.map(function (d) { return DOC_LABEL[d] || d; }).join(', ')) + '">' +
      (c.need.length - c.missing.length) + '/' + c.need.length + '</span>';
  }
  /* ⚠️ Three relations, shown as three DIFFERENT things. Collapsing them into
     one "related" count is what makes the 29 → 29.2 → rev1 chain unreadable. */
  function linksChip(r) {
    var out = [];
    if (r.parent_id) out.push('<span class="pmi-link parent" title="a proposal under ' + esc(refOf(recById(r.parent_id) || {})) + '">under</span>');
    if (r.supersedes_id) out.push('<span class="pmi-link rev" title="supersedes ' + esc(refOf(recById(r.supersedes_id) || {})) + '">rev</span>');
    if (r.spawned_from_id) out.push('<span class="pmi-link spawn" title="issued on approval of ' + esc(refOf(recById(r.spawned_from_id) || {})) + '">spawned</span>');
    if (r.claim_id) out.push('<span class="pmi-link claim" title="linked to a claim / change order">claim</span>');
    var kids = RECS.filter(function (x) { return x.parent_id === r.id; }).length;
    if (kids) out.push('<span class="pmi-link kids" title="' + kids + ' proposal(s) under this instruction">' + kids + '↓</span>');
    return out.join(' ') || '<span class="cc-mut">—</span>';
  }

  function wireRegister(host) {
    var q = host.querySelector('#pmi-f-q'), t = null;
    if (q) q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { filt.q = q.value; render(); }, 170); });
    [['pmi-f-stage', 'stage'], ['pmi-f-outcome', 'outcome'], ['pmi-f-latest', 'latest']].forEach(function (p) {
      var el = host.querySelector('#' + p[0]);
      if (el) el.onchange = function () { filt[p[1]] = el.value; render(); };
    });
    host.querySelectorAll('[data-open]').forEach(function (b) {
      b.onclick = function () { openCaseFile(b.dataset.open); };
    });
  }

  // ==========================================================================
  // THE RECORD FORM (B2b)
  // ==========================================================================
  function openForm(r, presets) {
    if (!canWrite) { UI.toast('You do not have permission to file an instruction.', 'error'); return; }
    var e = r || presets || {};
    var lbl = labelFor(e);
    var prof = profileOf(e);
    function f(label, id, val, type, hint) {
      return '<label>' + esc(label) + '<input class="pd-input" id="' + id + '" type="' + (type || 'text') + '" value="' +
        esc(val == null ? '' : (type === 'date' ? String(val).slice(0, 10) : val)) + '" />' +
        (hint ? '<span class="cc-mini">' + esc(hint) + '</span>' : '') + '</label>';
    }
    var body =
      '<div class="cc-sec">Identity</div>' +
      '<label>Contract profile<select class="pd-select" id="pf-prof"><option value="">— default —</option>' +
        PROFILES.map(function (p) { return '<option value="' + esc(p.id) + '"' + (e.profile_id === p.id ? ' selected' : '') + '>' + esc(p.name) + ' (' + esc(p.instruction_label) + ')</option>'; }).join('') +
      '</select></label>' +
      f("Client's reference", 'pf-cref', e.client_ref, 'text', prof && prof.ref_pattern ? 'e.g. ' + prof.ref_pattern : 'the number on their form, e.g. MEL.CON.PMI-029') +
      f('Our reference', 'pf-oref', e.our_ref, 'text', 'our own sequence, e.g. MST347. OPS. VO-PMI 29.2 (rev1)') +
      '<p class="cc-hint">⚠️ Both references are stored and both are searched. A single reference forces a choice, and the ' +
        'number you drop is the one the other party will cite.</p>' +
      f('Title', 'pf-title', e.title) +
      '<label class="cc-wide">Scope as instructed<textarea id="pf-scope">' + esc(e.scope || '') + '</textarea></label>' +

      '<div class="cc-sec">Stage &amp; dates</div>' +
      '<label>Stage<select class="pd-select" id="pf-stage">' +
        STAGES.map(function (s) { return '<option value="' + s.key + '"' + ((e.stage || 'received') === s.key ? ' selected' : '') + '>' + esc(s.label) + '</option>'; }).join('') +
      '</select></label>' +
      '<label>Outcome<select class="pd-select" id="pf-outcome"><option value="">—</option>' +
        OUTCOMES.map(function (o) { return '<option' + (e.outcome === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') +
      '</select></label>' +
      f('Issued by client', 'pf-d-issued', e.date_issued, 'date') +
      f('Received by us', 'pf-d-recv', e.date_received, 'date') +
      f('Estimated', 'pf-d-est', e.date_estimated, 'date') +
      f('Submitted', 'pf-d-sub', e.date_submitted, 'date') +
      f('Evaluated', 'pf-d-eval', e.date_evaluated, 'date') +
      f('Decided', 'pf-d-dec', e.date_decided, 'date') +
      '<p class="cc-hint">Aging is derived <strong>per stage</strong> from these dates and is never stored — one aging ' +
        'number over a case that runs eighteen months answers nothing.</p>' +

      '<div class="cc-sec">Relations</div>' +
      relSelect('pf-parent', 'Under instruction (parent)', e.parent_id, e.id,
        'PMI 29 is the instruction; 29.2 is one cost proposal under it.') +
      relSelect('pf-supersedes', 'Supersedes (this is a revision of…)', e.supersedes_id, e.id,
        'The superseded row is kept — it is the evidence for what changed.') +
      relSelect('pf-spawn', 'Issued on approval of (spawned from)', e.spawned_from_id, e.id,
        'One instruction issues another; a distinct relation from parent and revision.') +
      f('EOT days claimed', 'pf-eot', e.eot_days, 'number') +
      '<label class="cc-wide">Remarks<textarea id="pf-rem">' + esc(e.remarks || '') + '</textarea></label>';

    var m = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">' + (r ? 'Edit' : 'File') + ' ' + esc(lbl) + '</h2>' +
      '<button class="pd-modal-close" id="pf-x">&times;</button></div>' +
      '<div class="cc-form pmi-form">' + body + '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" id="pf-c">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="pf-save">Save</button></div>');
    var el = function (id) { return m.el.querySelector('#' + id); };
    el('pf-x').onclick = m.close; el('pf-c').onclick = m.close;

    el('pf-save').onclick = async function () {
      var v = function (id) { var x = txt(el(id).value); return x === '' ? null : x; };
      var payload = {
        project_id: pid, profile_id: v('pf-prof'),
        client_ref: v('pf-cref'), our_ref: v('pf-oref'),
        title: v('pf-title'), scope: v('pf-scope'),
        stage: el('pf-stage').value, outcome: v('pf-outcome'),
        date_issued: v('pf-d-issued'), date_received: v('pf-d-recv'),
        date_estimated: v('pf-d-est'), date_submitted: v('pf-d-sub'),
        date_evaluated: v('pf-d-eval'), date_decided: v('pf-d-dec'),
        parent_id: v('pf-parent'), supersedes_id: v('pf-supersedes'), spawned_from_id: v('pf-spawn'),
        eot_days: v('pf-eot') == null ? null : Number(v('pf-eot')),
        remarks: v('pf-rem'), updated_at: new Date().toISOString()
      };
      if (!payload.client_ref && !payload.our_ref) { UI.toast('Give the instruction at least one reference number.', 'error'); return; }
      var btn = el('pf-save'); btn.disabled = true; btn.textContent = 'Saving…';
      try {
        if (r) {
          var up = await sb().from(T_PMI).update(payload).eq('id', r.id);
          if (up.error) throw up.error;
        } else {
          payload.created_by = UID; payload.is_latest = true;
          var ins = await sb().from(T_PMI).insert(payload).select().single();
          if (ins.error) throw ins.error;
          /* ⚠️ Flipping is_latest on the superseded row happens ONLY after the
             new row exists. The other order can leave a revision chain with no
             live row at all — a register where nothing is current. */
          if (payload.supersedes_id) {
            var fl = await sb().from(T_PMI).update({ is_latest: false }).eq('id', payload.supersedes_id);
            if (fl.error) UI.toast('Saved, but the superseded revision is still flagged current: ' + fl.error.message, 'error');
          }
        }
        m.close(); UI.toast(r ? 'Updated.' : 'Filed.', 'success');
        await load();
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Save';
        UI.toast((err.message || String(err)) + migHint(err).replace(/<\/?code>/g, ''), 'error');
      }
    };
  }
  /* ⚠️ A record can never be its own parent / revision / spawn source, and the
     picker enforces it by construction rather than validating afterwards. */
  function relSelect(id, label, cur, selfId, hint) {
    return '<label>' + esc(label) + '<select class="pd-select" id="' + id + '"><option value="">—</option>' +
      RECS.filter(function (r) { return r.id !== selfId; }).map(function (r) {
        return '<option value="' + esc(r.id) + '"' + (cur === r.id ? ' selected' : '') + '>' + esc(refOf(r).slice(0, 70)) + '</option>';
      }).join('') + '</select><span class="cc-mini">' + esc(hint) + '</span></label>';
  }

  // ==========================================================================
  // THE CASE FILE — header, chains, typed attachments, priced lines, build-up
  // ==========================================================================
  function openCaseFile(id) {
    var r = recById(id);
    if (!r) return;
    selId = id;
    var m = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;" id="cf-h"></h2>' +
      '<button class="pd-modal-close" id="cf-x">&times;</button></div>' +
      '<div class="pmi-case" id="cf-body"></div>' +
      '<div class="pd-modal-footer">' +
      (canWrite ? '<button class="pd-btn" id="cf-rev">New revision…</button> ' +
                  '<button class="pd-btn" id="cf-spawn">Spawn follow-on…</button> ' +
                  '<button class="pd-btn" id="cf-edit">Edit</button> ' : '') +
      '<button class="pd-btn" id="cf-close">Close</button></div>');
    var body = m.el.querySelector('#cf-body');
    m.el.querySelector('#cf-h').textContent = labelFor(r) + ' — ' + (txt(r.title) || refOf(r));
    m.el.querySelector('#cf-x').onclick = m.close;
    m.el.querySelector('#cf-close').onclick = m.close;
    if (canWrite) {
      m.el.querySelector('#cf-edit').onclick = function () { m.close(); openForm(r); };
      m.el.querySelector('#cf-rev').onclick = function () { m.close(); newRevision(r); };
      m.el.querySelector('#cf-spawn').onclick = function () { m.close(); spawnFrom(r); };
    }

    function paint() {
      r = recById(id) || r;
      var ag = agingOf(r), tot = totalAgeOf(r), c = completeness(r);
      var lines = LINES[r.id] || [], dir = directOf(lines);
      var card = evalCard(cardFor(r), dir.total);
      var prof = profileOf(r);

      var h = '<div class="pmi-hdr">' +
        '<div><span class="cc-mini">Client ref</span><div class="pmi-ref">' + esc(txt(r.client_ref) || '—') + '</div></div>' +
        '<div><span class="cc-mini">Our ref</span><div class="pmi-ref">' + esc(txt(r.our_ref) || '—') + '</div></div>' +
        '<div><span class="cc-mini">Stage</span><div><span class="boq-kind k-' + esc(r.stage) + '">' +
          esc((STAGE_BY[r.stage] || {}).label || r.stage) + '</span></div></div>' +
        '<div><span class="cc-mini">In stage</span><div>' + (ag ? ag.days + 'd — ' + esc(ag.note) : '<span class="cc-mut">clock stopped</span>') + '</div></div>' +
        '<div><span class="cc-mini">Total age from receipt</span><div>' + (tot == null ? '—' : tot + 'd') + '</div></div>' +
        '</div>';

      if (r.scope) h += '<p class="pmi-scope">' + esc(r.scope) + '</p>';

      // ---- the chain, all three relations named apart -----------------------
      h += '<div class="cc-sec">Chain</div><div class="pmi-chain">' + chainHTML(r) + '</div>';

      // ---- typed attachments ----------------------------------------------
      h += '<div class="cc-sec">Documents' + (prof && prof.required_docs.length ? ' — ' + (c.need.length - c.missing.length) + ' of ' + c.need.length + ' required attached' : '') + '</div>';
      if (c.missing.length) {
        h += '<div class="boq-alert warn">Missing required: <strong>' +
          esc(c.missing.map(function (d) { return DOC_LABEL[d] || d; }).join(', ')) + '</strong>. ' +
          'This client\'s profile treats a submission as incomplete without them.</div>';
      }
      h += '<table class="boq-splittab"><thead><tr><th>Type</th><th>File</th><th class="cc-r">Size</th><th></th></tr></thead><tbody>';
      var list = (ATT[r.id] || []).slice().sort(function (a, b) { return String(a.doc_type).localeCompare(String(b.doc_type)); });
      if (!list.length) h += '<tr><td colspan="4" class="cc-mut">Nothing attached yet. A filed instruction is a case file — cost proposal, the client\'s form, product data, testing report, supplier contract.</td></tr>';
      list.forEach(function (a) {
        h += '<tr><td><span class="boq-kind">' + esc(DOC_LABEL[a.doc_type] || a.doc_type) + '</span></td>' +
          '<td><button class="pd-btn pmi-view" data-view="' + esc(a.id) + '">' + esc(a.file_name || a.file_path.split('/').pop()) + '</button></td>' +
          '<td class="cc-r cc-mini">' + (a.file_size ? Math.round(a.file_size / 1024) + ' KB' : '') + '</td>' +
          '<td>' + (canWrite ? '<button class="pd-btn" data-delatt="' + esc(a.id) + '" title="Remove">&times;</button>' : '') + '</td></tr>';
      });
      h += '</tbody></table>';
      if (canWrite) {
        h += '<div class="pmi-up"><select class="pd-select" id="cf-dtype">' +
          DOC_TYPES.map(function (d) { return '<option value="' + d.key + '">' + esc(d.label) + '</option>'; }).join('') +
          '</select><input type="file" id="cf-file" /><span id="cf-upst" class="cc-mini"></span></div>' +
          '<p class="cc-hint">The bucket is private: the object <strong>path</strong> is stored and the URL is signed on ' +
          'demand, so a stored link can never expire into a dead one.</p>';
      }

      // ---- priced lines + the build-up ------------------------------------
      h += '<div class="cc-sec">Priced scope</div>' +
        '<p class="cc-hint">A cost proposal <strong>is</strong> a BOQ — same qty / material / labour / total shape — so its ' +
        'lines live in <code>boq_items</code> with <code>scope_type = change_order</code>, not a parallel table that would ' +
        'drift. That is what makes a variation measurable, mappable to class codes and allocatable to activities.</p>';
      h += '<table class="boq-splittab"><thead><tr><th>Description</th><th>Unit</th><th class="cc-r">Qty</th>' +
        '<th class="cc-r">Material</th><th class="cc-r">Labour</th><th class="cc-r">Amount</th>' + (canWrite ? '<th></th>' : '') +
        '</tr></thead><tbody>';
      if (!lines.length) h += '<tr><td colspan="7" class="cc-mut">No priced lines yet.</td></tr>';
      lines.forEach(function (l) {
        h += '<tr><td>' + esc(l.description || '') + '</td><td>' + esc(l.unit || '') + '</td>' +
          '<td class="cc-r">' + (l.qty == null ? '' : Number(l.qty).toLocaleString('en-US')) + '</td>' +
          '<td class="cc-r">' + money(l.mat_amount) + '</td><td class="cc-r">' + money(l.lab_amount) + '</td>' +
          '<td class="cc-r">' + money(l.amount) + '</td>' +
          (canWrite ? '<td><button class="pd-btn" data-delline="' + esc(l.id) + '" title="Remove">&times;</button></td>' : '') + '</tr>';
      });
      h += '</tbody></table>';
      if (canWrite) h += '<div class="pmi-up"><button class="pd-btn" id="cf-addline">+ Add priced line</button></div>';

      // ---- the contractual build-up ---------------------------------------
      h += '<div class="cc-sec">Cost build-up</div>';
      if (card.steps.length && !lines.length) {
        h += '<div class="boq-alert warn">No priced lines yet, so this proposal has <strong>no total</strong> — ' +
          'it is not priced at zero. Add the priced scope above and it will run through the card below.</div>';
      }
      if (!card.steps.length) {
        h += '<div class="boq-alert warn">No cost terms for this contract yet. The build-up (direct → markup → fix cost → ' +
          'VAT) is <strong>"as per contract"</strong>, so it is a per-contract rate card rather than fixed percentages — ' +
          'set it up under <strong>Cost Terms</strong>.</div>';
      } else {
        if (card.problems.length) {
          h += '<div class="boq-alert bad"><strong>The card cannot be evaluated.</strong> ' +
            esc(card.problems.map(function (p) { return 'step ' + p.code + ': ' + p.why; }).join('; ')) +
            '. A step may only reference earlier steps; the affected steps show no value rather than a zero, ' +
            'because a zero here silently understates the total.</div>';
        }
        h += '<table class="boq-progtab pmi-card"><thead><tr><th></th><th>Step</th><th>Basis</th><th class="cc-r">Rate</th><th class="cc-r">Amount</th></tr></thead><tbody>';
        card.steps.forEach(function (s) {
          h += '<tr' + (s.is_total ? ' class="pmi-total"' : '') + '><td class="pmi-code">' + esc(s.code) + '</td>' +
            '<td>' + esc(s.label) + (s.kind === 'direct' ? ' <span class="cc-mini">(' + dir.n + ' line' + (dir.n === 1 ? '' : 's') + ')</span>' : '') + '</td>' +
            '<td class="cc-mini">' + esc(s.kind === 'direct' ? 'priced lines' : (s.kind === 'sum' ? s.basis_codes.join(' + ') : s.basis_codes.join('') + (s.kind === 'markup_add' ? ' + markup' : ' ×'))) + '</td>' +
            '<td class="cc-r">' + (s.rate == null ? '' : (Number(s.rate) * 100).toFixed(2) + '%') + '</td>' +
            '<td class="cc-r">' + (s.value == null ? '<span class="boq-bad">—</span>' : money(s.value)) + '</td></tr>';
        });
        h += '</tbody></table>';
        if (dir.mat || dir.lab) {
          h += '<p class="cc-mini">Direct cost splits material ' + money(dir.mat) + ' / labour ' + money(dir.lab) +
            ' — the split survives into the claim, as it does on the billing sheets.</p>';
        }
      }
      body.innerHTML = h;
      wireCase(m, r, paint);
    }
    paint();
  }

  function chainHTML(r) {
    var out = [];
    function row(kind, label, other, note) {
      if (!other) return;
      out.push('<div class="pmi-chain-row ' + kind + '"><span class="pmi-link ' + kind + '">' + esc(label) + '</span>' +
        '<button class="pd-btn pmi-jump" data-jump="' + esc(other.id) + '">' + esc(refOf(other).slice(0, 60)) + '</button>' +
        '<span class="cc-mini">' + esc(note) + '</span></div>');
    }
    row('parent', 'under', recById(r.parent_id), 'this is a proposal under that instruction');
    row('rev', 'supersedes', recById(r.supersedes_id), 'kept as the evidence for what changed');
    row('spawn', 'issued from', recById(r.spawned_from_id), 'a separate instruction, issued on that one being approved');
    RECS.filter(function (x) { return x.parent_id === r.id; }).forEach(function (k) {
      row('kids', 'proposal', k, 'a cost proposal under this instruction');
    });
    RECS.filter(function (x) { return x.supersedes_id === r.id; }).forEach(function (k) {
      row('rev', 'superseded by', k, 'this row is history; that one is live');
    });
    RECS.filter(function (x) { return x.spawned_from_id === r.id; }).forEach(function (k) {
      row('spawn', 'issued', k, 'this instruction issued that one');
    });
    return out.length ? out.join('') : '<p class="cc-mut">No related instructions.</p>';
  }

  function wireCase(m, r, paint) {
    m.el.querySelectorAll('[data-jump]').forEach(function (b) {
      b.onclick = function () { m.close(); openCaseFile(b.dataset.jump); };
    });
    m.el.querySelectorAll('[data-view]').forEach(function (b) {
      b.onclick = function () { viewAttachment(b.dataset.view); };
    });
    m.el.querySelectorAll('[data-delatt]').forEach(function (b) {
      b.onclick = function () { removeAttachment(b.dataset.delatt, paint); };
    });
    m.el.querySelectorAll('[data-delline]').forEach(function (b) {
      b.onclick = function () { removeLine(b.dataset.delline, paint); };
    });
    var fi = m.el.querySelector('#cf-file');
    if (fi) fi.onchange = function () { uploadAttachment(m, r, paint); };
    var al = m.el.querySelector('#cf-addline');
    if (al) al.onclick = function () { addLine(r, paint); };
  }

  // ==========================================================================
  // ATTACHMENTS (B2a)
  // ==========================================================================
  /* ⚠️ THE ORDERING RULES ARE THE FEATURE, each one because the opposite order
     leaves a real mess. Upload runs BEFORE the row write, so a failed upload
     never leaves a row pointing at nothing; the object is rolled back if the row
     write then fails, so a failure leaves no orphan; and on removal the ROW goes
     first, because a failed object delete leaves a recoverable orphan whereas
     the reverse leaves an attachment that will not open. Same rules as
     material-submittal and mom-attachments. */
  async function uploadAttachment(m, r, paint) {
    var fi = m.el.querySelector('#cf-file'), st = m.el.querySelector('#cf-upst');
    var f = fi.files && fi.files[0];
    if (!f) return;
    var dtype = m.el.querySelector('#cf-dtype').value;
    st.textContent = 'Uploading…';
    var safe = f.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-90);
    var path = pid + '/pmi/' + r.id + '/' + dtype + '-' + Date.now() + '-' + safe;
    var up = await sb().storage.from(BUCKET).upload(path, f, { upsert: false });
    if (up.error) {
      st.textContent = '';
      UI.toast('Upload failed: ' + up.error.message +
        (/bucket/i.test(up.error.message) ? ' — run ' + MIGRATION + ' to create the bucket.' : ''), 'error');
      fi.value = ''; return;
    }
    var ins = await sb().from(T_ATT).insert({
      project_id: pid, pmi_id: r.id, doc_type: dtype, file_path: path,
      file_name: f.name, file_size: f.size, uploaded_by: UID
    }).select().single();
    if (ins.error) {
      // roll the object back rather than leave it orphaned in the bucket
      await sb().storage.from(BUCKET).remove([path]);
      st.textContent = '';
      UI.toast('Attach failed, upload rolled back: ' + ins.error.message, 'error');
      fi.value = ''; return;
    }
    (ATT[r.id] = ATT[r.id] || []).push(ins.data);
    st.textContent = ''; fi.value = '';
    UI.toast('Attached.', 'success');
    paint();
  }

  /* The bucket is private, so the URL is minted on demand and never stored. */
  async function viewAttachment(attId) {
    var a = null;
    Object.keys(ATT).forEach(function (k) { (ATT[k] || []).forEach(function (x) { if (x.id === attId) a = x; }); });
    if (!a) return;
    var s = await sb().storage.from(BUCKET).createSignedUrl(a.file_path, 60);
    if (s.error || !s.data) { UI.toast('Could not open the file: ' + ((s.error && s.error.message) || 'no signed URL'), 'error'); return; }
    window.open(s.data.signedUrl, '_blank', 'noopener');
  }

  async function removeAttachment(attId, paint) {
    var a = null, owner = null;
    Object.keys(ATT).forEach(function (k) { (ATT[k] || []).forEach(function (x) { if (x.id === attId) { a = x; owner = k; } }); });
    if (!a || !confirm('Remove "' + (a.file_name || 'this file') + '"? The file is deleted from storage.')) return;
    // ⚠️ Row first: a failed object delete leaves a recoverable orphan, while the
    //    reverse leaves a row whose file will not open.
    var del = await sb().from(T_ATT).delete().eq('id', attId);
    if (del.error) { UI.toast(del.error.message, 'error'); return; }
    ATT[owner] = (ATT[owner] || []).filter(function (x) { return x.id !== attId; });
    var rm = await sb().storage.from(BUCKET).remove([a.file_path]);
    if (rm.error) UI.toast('Row removed, but the stored file could not be deleted — it is orphaned, not lost.', 'error');
    else UI.toast('Removed.', 'success');
    paint();
  }

  // ==========================================================================
  // PRICED LINES → boq_items with scope_type='change_order' (B2c / §5.6)
  // ==========================================================================
  /* Each PMI proposal gets its OWN boq_revision, created lazily on the first
     line. boq_items.revision_id is NOT NULL and identity is
     (revision_id, sheet, source_row), so this keeps both intact — and keeps
     change-order lines out of the contract document's revision, where they
     would inflate the contract total. */
  async function ensureRevision(r) {
    if (REVS[r.id]) return REVS[r.id];
    var ins = await sb().from(T_REV).insert({
      project_id: pid, pmi_id: r.id,
      rev_no: 'PMI ' + (txt(r.our_ref) || txt(r.client_ref) || String(r.id).slice(0, 8)),
      issued_date: r.date_submitted || r.date_estimated || null,
      source_file: null, is_current: false,      // ⚠️ never current: this is not the contract BOQ
      notes: 'Priced scope of ' + labelFor(r) + ' ' + refOf(r)
    }).select().single();
    if (ins.error) throw ins.error;
    REVS[r.id] = ins.data;
    return ins.data;
  }

  function addLine(r, paint) {
    var m = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">Add priced line</h2>' +
      '<button class="pd-modal-close" id="al-x">&times;</button></div>' +
      '<div class="cc-form">' +
      '<label class="cc-wide">Description<input class="pd-input" id="al-desc" /></label>' +
      '<label>Unit<input class="pd-input" id="al-unit" /></label>' +
      '<label>Quantity<input class="pd-input" id="al-qty" type="number" step="0.001" /></label>' +
      '<label>Material rate<input class="pd-input" id="al-mr" type="number" step="0.01" /></label>' +
      '<label>Labour rate<input class="pd-input" id="al-lr" type="number" step="0.01" /></label>' +
      '<p class="cc-hint">The line <strong>amount</strong> is authoritative. Leave it blank to derive it from qty × rates ' +
      '— it is then flagged as derived, exactly as an imported BOQ line would be, so a later reconciliation can tell our ' +
      'figures from the client\'s.</p>' +
      '<label>Amount (optional)<input class="pd-input" id="al-amt" type="number" step="0.01" /></label>' +
      '</div><div class="pd-modal-footer"><button class="pd-btn" id="al-c">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="al-go">Add</button></div>');
    var el = function (id) { return m.el.querySelector('#' + id); };
    el('al-x').onclick = m.close; el('al-c').onclick = m.close;
    el('al-go').onclick = async function () {
      var n = function (id) { var x = txt(el(id).value); if (x === '') return null; var y = Number(x); return isFinite(y) ? y : null; };
      var desc = txt(el('al-desc').value);
      if (!desc) { UI.toast('Give the line a description.', 'error'); return; }
      var qty = n('al-qty'), mr = n('al-mr'), lr = n('al-lr'), amt = n('al-amt');
      var derived = false;
      if (amt == null && qty != null && (mr != null || lr != null)) { amt = qty * ((mr || 0) + (lr || 0)); derived = true; }
      var btn = el('al-go'); btn.disabled = true; btn.textContent = 'Adding…';
      try {
        var rev = await ensureRevision(r);
        var existing = LINES[r.id] || [];
        var ins = await sb().from(T_ITEM).insert({
          project_id: pid, revision_id: rev.id, pmi_id: r.id,
          // ⚠️ scope_type is the SAME axis project_schedule.scope_type uses, so a
          //    variation reports separately without living in a separate table.
          scope_type: 'change_order',
          sheet: 'PMI', source_row: existing.length + 1,
          item_no: String(existing.length + 1), description: desc, unit: txt(el('al-unit').value) || null,
          qty: qty, mat_rate: mr, lab_rate: lr,
          mat_amount: qty != null && mr != null ? qty * mr : null,
          lab_amount: qty != null && lr != null ? qty * lr : null,
          amount: amt, derived_amount: derived,
          line_kind: qty != null ? 'measured' : 'lump_sum',
          depth: 0, sort_order: existing.length, created_by: UID
        }).select().single();
        if (ins.error) throw ins.error;
        (LINES[r.id] = LINES[r.id] || []).push(ins.data);
        m.close(); paint();
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Add';
        UI.toast((err.message || String(err)) + migHint(err).replace(/<\/?code>/g, ''), 'error');
      }
    };
  }

  async function removeLine(lineId, paint) {
    if (!confirm('Remove this priced line?')) return;
    var del = await sb().from(T_ITEM).delete().eq('id', lineId);
    if (del.error) { UI.toast(del.error.message, 'error'); return; }
    Object.keys(LINES).forEach(function (k) { LINES[k] = (LINES[k] || []).filter(function (l) { return l.id !== lineId; }); });
    paint();
  }

  // ==========================================================================
  // REVISION + SPAWN (§5.3)
  // ==========================================================================
  /* ⚠️ A revision is a NEW ROW that supersedes the old one, never an overwrite.
     The superseded proposal is the evidence for what changed and why — which is
     the whole reason this is not an UPDATE. */
  function newRevision(r) {
    openForm(null, {
      profile_id: r.profile_id, client_ref: r.client_ref,
      our_ref: bumpRev(r.our_ref), title: r.title, scope: r.scope,
      parent_id: r.parent_id, supersedes_id: r.id,
      stage: r.stage, date_issued: r.date_issued, date_received: r.date_received
    });
    UI.toast('Filing a revision — the current row is kept and flagged superseded once this saves.', 'success');
  }
  /* 'MST347. OPS. VO-PMI 29.2 (rev1)' → '(rev2)'. Falls back to appending rev1.
     A proposal, not a rule: the field stays editable. */
  function bumpRev(ref) {
    var s = txt(ref);
    if (!s) return '';
    var m = s.match(/\(?\brev\s*0*(\d+)\)?/i);
    if (m) {
      var next = 'rev' + (Number(m[1]) + 1);
      return s.replace(m[0], m[0].indexOf('(') === 0 ? '(' + next + ')' : next);
    }
    return s + ' (rev1)';
  }
  /* ⚠️ A THIRD RELATION, distinct from parent and revision: the form says
     "Separate PMI for site implementation will be issued upon approval of the
     cost proposal". One instruction ISSUES another. */
  function spawnFrom(r) {
    openForm(null, {
      profile_id: r.profile_id, client_ref: '', our_ref: '',
      title: (txt(r.title) || 'Follow-on') + ' — site implementation',
      scope: 'Issued on approval of ' + refOf(r) + '.',
      spawned_from_id: r.id, stage: 'received'
    });
    UI.toast('Filing a follow-on instruction, linked as spawned from this one.', 'success');
  }

  // ==========================================================================
  // COST TERMS (B2c) — profiles + the rate card
  // ==========================================================================
  function termsHTML() {
    var h = '<p class="cc-hint">The instruction label, the reference pattern, the required-document checklist, the approval ' +
      'roles and the cost build-up are all <strong>per contract</strong>. The sample sheet marks its percentages ' +
      '<em>"As per Contract"</em> — hard-coding 10 / 20 / 12 produces confidently wrong proposals on the next project.</p>';

    h += '<div class="boq-filters">' + (canWrite ? '<button class="pd-btn pd-btn-primary" id="ct-new">+ New contract profile</button>' : '') + '</div>';

    if (!PROFILES.length) {
      h += '<div class="pd-card cc-empty"><h3>No contract profile yet</h3>' +
        '<p>A profile holds what varies by client. Until one exists the register says "PMI", nothing is a required ' +
        'document, and a proposal has no build-up to price it through.</p></div>';
      return h;
    }

    PROFILES.forEach(function (p) {
      var card = TERMS[p.id] || [];
      // Priced against a nominal ₱1,000,000 so the card can be read as rates
      // without needing a proposal open. Labelled as an illustration.
      var ev = evalCard(card, 1000000);
      h += '<div class="pd-card pmi-prof"><div class="pmi-prof-h">' +
        '<div><strong>' + esc(p.name) + '</strong>' + (p.is_default ? ' <span class="boq-kind">default</span>' : '') +
          '<div class="cc-mini">calls it "' + esc(p.instruction_label) + '"' +
          (p.ref_pattern ? ' · ref pattern ' + esc(p.ref_pattern) : '') + '</div></div>' +
        (canWrite ? '<div><button class="pd-btn" data-pedit="' + esc(p.id) + '">Edit profile</button> ' +
          '<button class="pd-btn" data-cedit="' + esc(p.id) + '">Edit card</button></div>' : '') +
        '</div>';
      h += '<div class="cc-mini pmi-req">Required documents: ' +
        (p.required_docs && p.required_docs.length
          ? esc(p.required_docs.map(function (d) { return DOC_LABEL[d] || d; }).join(', '))
          : 'none — nothing blocks a submission') + '</div>';
      if (!card.length) {
        h += '<p class="cc-mut">No cost card yet. ' + (canWrite ? 'Edit card to build one, or start from the sample build-up.' : '') + '</p>';
      } else {
        h += '<table class="boq-progtab pmi-card"><thead><tr><th></th><th>Step</th><th>Basis</th>' +
          '<th class="cc-r">Rate</th><th class="cc-r">On ₱1,000,000 direct</th></tr></thead><tbody>';
        ev.steps.forEach(function (s) {
          h += '<tr' + (s.is_total ? ' class="pmi-total"' : '') + '><td class="pmi-code">' + esc(s.code) + '</td>' +
            '<td>' + esc(s.label) + '</td>' +
            '<td class="cc-mini">' + esc(s.kind === 'direct' ? 'priced lines' : s.basis_codes.join(s.kind === 'sum' ? ' + ' : '')) + '</td>' +
            '<td class="cc-r">' + (s.rate == null ? '' : (Number(s.rate) * 100).toFixed(2) + '%') + '</td>' +
            '<td class="cc-r">' + (s.value == null ? '<span class="boq-bad">—</span>' : money(s.value)) + '</td></tr>';
        });
        h += '</tbody></table><p class="cc-mini">Illustrated on a nominal ₱1,000,000 of direct cost — a real proposal ' +
          'prices its own lines through the same card.</p>';
        if (ev.problems.length) h += '<div class="boq-alert bad">' +
          esc(ev.problems.map(function (x) { return 'step ' + x.code + ': ' + x.why; }).join('; ')) + '</div>';
      }
      h += '</div>';
    });
    return h;
  }

  function wireTerms(host) {
    var n = host.querySelector('#ct-new'); if (n) n.onclick = function () { editProfile(null); };
    host.querySelectorAll('[data-pedit]').forEach(function (b) {
      b.onclick = function () { editProfile(PROFILES.find(function (p) { return p.id === b.dataset.pedit; })); };
    });
    host.querySelectorAll('[data-cedit]').forEach(function (b) {
      b.onclick = function () { editCard(PROFILES.find(function (p) { return p.id === b.dataset.cedit; })); };
    });
  }

  function editProfile(p) {
    var e = p || {};
    var m = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">' + (p ? 'Edit' : 'New') + ' contract profile</h2>' +
      '<button class="pd-modal-close" id="ep-x">&times;</button></div>' +
      '<div class="cc-form">' +
      '<label>Name<input class="pd-input" id="ep-name" value="' + esc(e.name || '') + '" /></label>' +
      '<label>Calls an instruction a…<input class="pd-input" id="ep-lbl" value="' + esc(e.instruction_label || 'PMI') + '" />' +
        '<span class="cc-mini">PMI · Site Instruction · Architect\'s Instruction · Variation Order</span></label>' +
      '<label>Reference pattern (hint only)<input class="pd-input" id="ep-pat" value="' + esc(e.ref_pattern || '') + '" />' +
        '<span class="cc-mini">shown beside the reference field; never validated, so a client changing their own numbering cannot block filing</span></label>' +
      '<div class="cc-sec">Required documents</div>' +
      '<p class="cc-hint">Which documents this client demands before a submission counts as complete. The register shows ' +
      'the shortfall per instruction.</p>' +
      DOC_TYPES.filter(function (d) { return d.key !== 'other'; }).map(function (d) {
        var on = (e.required_docs || []).indexOf(d.key) >= 0;
        return '<label class="pmi-chk"><input type="checkbox" data-req="' + d.key + '"' + (on ? ' checked' : '') + ' /> ' + esc(d.label) + '</label>';
      }).join('') +
      '<div class="cc-sec">Approval roles</div>' +
      '<label class="cc-wide">Ours, in order<input class="pd-input" id="ep-int" value="' + esc((e.internal_roles || []).join(', ')) + '" />' +
        '<span class="cc-mini">comma-separated, e.g. Office Supervisor, MEPF &amp; Finishing Manager, Project Manager, COO</span></label>' +
      '<label class="cc-wide">The client\'s, in order<input class="pd-input" id="ep-cli" value="' + esc((e.client_roles || []).join(', ')) + '" />' +
        '<span class="cc-mini">e.g. Prepared, Checked, Noted, Approved, D&amp;C Head</span></label>' +
      '<label class="pmi-chk"><input type="checkbox" id="ep-def"' + (e.is_default ? ' checked' : '') + ' /> Use as this project\'s default</label>' +
      '</div><div class="pd-modal-footer"><button class="pd-btn" id="ep-c">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="ep-go">Save</button></div>');
    var el = function (id) { return m.el.querySelector('#' + id); };
    el('ep-x').onclick = m.close; el('ep-c').onclick = m.close;
    el('ep-go').onclick = async function () {
      var name = txt(el('ep-name').value);
      if (!name) { UI.toast('Give the profile a name.', 'error'); return; }
      var reqs = [];
      m.el.querySelectorAll('[data-req]').forEach(function (c) { if (c.checked) reqs.push(c.dataset.req); });
      var split = function (s) { return txt(s).split(',').map(function (x) { return x.trim(); }).filter(Boolean); };
      var payload = {
        project_id: pid, name: name, instruction_label: txt(el('ep-lbl').value) || 'PMI',
        ref_pattern: txt(el('ep-pat').value) || null, required_docs: reqs,
        internal_roles: split(el('ep-int').value), client_roles: split(el('ep-cli').value),
        is_default: el('ep-def').checked, updated_at: new Date().toISOString()
      };
      try {
        if (p) {
          var up = await sb().from(T_PROF).update(payload).eq('id', p.id);
          if (up.error) throw up.error;
        } else {
          payload.created_by = UID;
          var ins = await sb().from(T_PROF).insert(payload).select().single();
          if (ins.error) throw ins.error;
        }
        // ⚠️ Only one default per project. Nothing in the schema enforces it, so
        //    clearing the others is done here — two defaults means the label the
        //    screen shows depends on which row loaded first.
        if (payload.is_default) {
          await sb().from(T_PROF).update({ is_default: false }).eq('project_id', pid).neq('name', name);
        }
        m.close(); UI.toast('Profile saved.', 'success'); await load();
      } catch (err) {
        UI.toast((err.message || String(err)) + migHint(err).replace(/<\/?code>/g, ''), 'error');
      }
    };
  }

  function editCard(p) {
    if (!p) return;
    var rows = (TERMS[p.id] || []).map(function (t) {
      return { code: t.code, label: t.label, kind: t.kind, basis_codes: (t.basis_codes || []).slice(),
               rate: t.rate, is_total: t.is_total, step_order: t.step_order };
    });
    var m = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">Cost card — ' + esc(p.name) + '</h2>' +
      '<button class="pd-modal-close" id="ec-x">&times;</button></div>' +
      '<div class="pmi-case" id="ec-body"></div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" id="ec-tpl">Start from the sample build-up</button> ' +
      '<button class="pd-btn" id="ec-c">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="ec-go">Save card</button></div>');
    var body = m.el.querySelector('#ec-body');

    function paint() {
      var ev = evalCard(rows.map(function (r, i) { return Object.assign({}, r, { step_order: i }); }), 1000000);
      var codes = rows.map(function (r) { return String(r.code || '').toUpperCase(); });
      body.innerHTML =
        '<p class="cc-hint">Each step has a label, a <strong>basis</strong> (which earlier step it multiplies or sums) and a ' +
        'rate. A step may only reference steps above it; one that cannot be evaluated shows no amount rather than a zero.</p>' +
        '<table class="boq-splittab"><thead><tr><th>Code</th><th>Label</th><th>Kind</th><th>Basis</th>' +
        '<th class="cc-r">Rate %</th><th>Total</th><th class="cc-r">On ₱1M</th><th></th></tr></thead><tbody>' +
        rows.map(function (r, i) {
          var earlier = codes.slice(0, i).filter(Boolean);
          return '<tr><td><input class="pd-input ec-in" data-i="' + i + '" data-f="code" value="' + esc(r.code || '') + '" style="width:52px" /></td>' +
            '<td><input class="pd-input ec-in" data-i="' + i + '" data-f="label" value="' + esc(r.label || '') + '" /></td>' +
            '<td><select class="pd-select ec-in" data-i="' + i + '" data-f="kind">' +
              ['direct', 'markup_add', 'percent_of', 'sum'].map(function (k) {
                return '<option value="' + k + '"' + (r.kind === k ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select></td>' +
            '<td>' + (r.kind === 'direct' ? '<span class="cc-mini">priced lines</span>'
              : earlier.map(function (c) {
                  var on = (r.basis_codes || []).map(String).map(function (x) { return x.toUpperCase(); }).indexOf(c) >= 0;
                  return '<label class="pmi-chk-sm"><input type="checkbox" class="ec-basis" data-i="' + i + '" data-c="' + esc(c) + '"' + (on ? ' checked' : '') + ' />' + esc(c) + '</label>';
                }).join('') || '<span class="boq-bad cc-mini">no earlier step</span>') + '</td>' +
            '<td class="cc-r">' + (r.kind === 'markup_add' || r.kind === 'percent_of'
              ? '<input class="pd-input ec-in" data-i="' + i + '" data-f="rate" type="number" step="0.01" value="' + esc(r.rate == null ? '' : (Number(r.rate) * 100)) + '" style="width:76px" />'
              : '') + '</td>' +
            '<td><input type="checkbox" class="ec-tot" data-i="' + i + '"' + (r.is_total ? ' checked' : '') + ' /></td>' +
            '<td class="cc-r">' + (ev.steps[i] && ev.steps[i].value != null ? money(ev.steps[i].value) : '<span class="boq-bad">—</span>') + '</td>' +
            '<td><button class="pd-btn ec-rm" data-i="' + i + '">&times;</button></td></tr>';
        }).join('') +
        '</tbody></table>' +
        '<button class="pd-btn" id="ec-add">+ Add step</button>' +
        (ev.problems.length ? '<div class="boq-alert bad">' + esc(ev.problems.map(function (x) { return 'step ' + x.code + ': ' + x.why; }).join('; ')) + '</div>' : '');

      body.querySelectorAll('.ec-in').forEach(function (inp) {
        inp.onchange = function () {
          var i = +inp.dataset.i, f = inp.dataset.f;
          rows[i][f] = f === 'rate' ? (txt(inp.value) === '' ? null : Number(inp.value) / 100) : inp.value;
          if (f === 'kind' && inp.value === 'direct') rows[i].basis_codes = [];
          paint();
        };
      });
      body.querySelectorAll('.ec-basis').forEach(function (cb) {
        cb.onchange = function () {
          var i = +cb.dataset.i, c = cb.dataset.c, arr = rows[i].basis_codes || [];
          rows[i].basis_codes = cb.checked ? arr.concat([c]) : arr.filter(function (x) { return String(x).toUpperCase() !== c; });
          paint();
        };
      });
      body.querySelectorAll('.ec-tot').forEach(function (cb) {
        cb.onchange = function () { rows.forEach(function (r, j) { r.is_total = cb.checked && j === +cb.dataset.i; }); paint(); };
      });
      body.querySelectorAll('.ec-rm').forEach(function (b) {
        b.onclick = function () { rows.splice(+b.dataset.i, 1); paint(); };
      });
      body.querySelector('#ec-add').onclick = function () {
        rows.push({ code: String.fromCharCode(65 + rows.length), label: '', kind: 'percent_of', basis_codes: [], rate: null, is_total: false });
        paint();
      };
    }
    paint();
    m.el.querySelector('#ec-x').onclick = m.close;
    m.el.querySelector('#ec-c').onclick = m.close;
    m.el.querySelector('#ec-tpl').onclick = function () {
      rows = CARD_TEMPLATE.map(function (t, i) { return Object.assign({}, t, { basis_codes: t.basis_codes.slice(), step_order: i }); });
      paint();
      UI.toast('Sample build-up loaded — check every rate against this contract before saving.', 'success');
    };
    m.el.querySelector('#ec-go').onclick = async function () {
      var codes = rows.map(function (r) { return String(r.code || '').toUpperCase(); });
      if (codes.some(function (c) { return !c; })) { UI.toast('Every step needs a code.', 'error'); return; }
      if (new Set(codes).size !== codes.length) { UI.toast('Step codes must be unique within a card.', 'error'); return; }
      // Replace-then-insert: a card is one decision, so a partial overwrite would
      // leave two planners' steps interleaved.
      var del = await sb().from(T_TERMS).delete().eq('profile_id', p.id);
      if (del.error) { UI.toast(del.error.message, 'error'); return; }
      if (rows.length) {
        var ins = await sb().from(T_TERMS).insert(rows.map(function (r, i) {
          return { project_id: pid, profile_id: p.id, step_order: i, code: String(r.code).toUpperCase(),
                   label: r.label || String(r.code).toUpperCase(), kind: r.kind,
                   basis_codes: (r.basis_codes || []).map(function (x) { return String(x).toUpperCase(); }),
                   rate: r.rate, is_total: !!r.is_total };
        }));
        if (ins.error) { UI.toast(ins.error.message, 'error'); return; }
      }
      m.close(); UI.toast('Cost card saved.', 'success'); await load();
    };
  }

  // ==========================================================================
  // HOST API
  // ==========================================================================
  function init(deps) { UID = deps.uid; canWrite = !!deps.canWrite; isAdmin = !!deps.isAdmin; }
  async function show(projectId, label) { pid = projectId; projLabel = label || ''; await load(); }
  function reset() { loaded = false; RECS = []; ATT = {}; PROFILES = []; TERMS = {}; LINES = {}; REVS = {}; selId = null; }

  return {
    init: init, show: show, reset: reset, render: render,
    _internals: {
      STAGES: STAGES, DOC_TYPES: DOC_TYPES, CARD_TEMPLATE: CARD_TEMPLATE,
      daysBetween: daysBetween, agingOf: agingOf, totalAgeOf: totalAgeOf, isDecided: isDecided,
      evalCard: evalCard, directOf: directOf, completeness: completeness, bumpRev: bumpRev,
      proposalTotal: proposalTotal, cardFor: cardFor,
      refOf: refOf, labelFor: labelFor, visible: visible, chainHTML: chainHTML,
      _set: function (o) {
        if (o.RECS) RECS = o.RECS; if (o.ATT) ATT = o.ATT; if (o.PROFILES) PROFILES = o.PROFILES;
        if (o.TERMS) TERMS = o.TERMS; if (o.LINES) LINES = o.LINES; if (o.REVS) REVS = o.REVS;
        if (o.filt) filt = o.filt; if (o.pid) pid = o.pid;
        if (o.canWrite != null) canWrite = o.canWrite;
      }
    }
  };
})();
