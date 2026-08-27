/* ============================================================================
   CONTRACTS & CLAIMS — GUIDED WIZARD (window.CCWizard)

   Owner, 2026-08-26: *"We will create a wizard for Contracts, BOQ, Change Order,
   Claims/EOT"*, after asking whether the BOQ import could handle the many formats a
   client sends and whether it could be *"intuitive like a wizard similar to how the
   schedule builder works so that it can easily be connected with each other."*

   ONE wizard, with the type chosen at step 1 — decided with the owner over four
   separate flows, because Contract and BOQ share the package step. A contract can
   define its package and walk straight into loading its BOQ against that same
   package, which is the connection the question was really about.

   ⚠️ THE WIZARD IS FOR NEW RECORDS ONLY. Editing keeps the compact form (openForm) —
      nobody wants six steps to fix a typo, and a wizard that owns editing too becomes
      the slowest path to the most common action.
   ⚠️ IT DOES NOT OWN THE WRITE. Every save goes through module.js's persistRecord(),
      the same path the form uses. Two payload builders for one table drift, and the
      half that drifts is the one nobody is looking at.
   ⚠️ NOTHING IS WRITTEN UNTIL THE LAST STEP. Step 5 can create a contract package —
      the one irreversible act in here — and it happens inside the same save as the
      record, so a half-finished wizard leaves no orphan package behind.
   ============================================================================ */
window.CCWizard = (function () {
  'use strict';
  var esc = function (x) { return Fmt.esc(String(x == null ? '' : x)); };
  var D = null;      // deps handed in by module.js
  var st = null;     // wizard state
  var ov = null;

  /* The steps, per type. A step declares whether it applies, so the rail and the
     Back/Next arithmetic never diverge from what is actually shown — the classic
     wizard bug where "step 3 of 5" skips to 5 and the count lies. */
  var STEPS = [
    { key: 'type',    label: 'Record',   sub: 'What are you recording?', when: function () { return true; } },
    { key: 'package', label: 'Package',  sub: 'Define or link the contract lot',
      when: function () { return true; } },
    /* ⚠️ A PACKAGE HAS NO DETAILS OR DATES STEP. It has no reference number, no
       counterparty and no claim pipeline — those belong to the CONTRACT that defines it.
       Offering them would invite a package that quietly carries half a contract. */
    { key: 'details', label: 'Details',  sub: 'Reference, parties, value',
      when: function () { return st.type !== 'BOQ' && st.type !== 'Package'; } },
    { key: 'dates',   label: 'Dates',    sub: 'When it was signed or filed',
      when: function () { return st.type !== 'BOQ' && st.type !== 'Package'; } },
    { key: 'boq',     label: 'BOQ',      sub: 'Optional — skip it if the BOQ has not arrived yet',
      when: function () { return st.type === 'Contract' || st.type === 'BOQ'; } },
    { key: 'review',  label: 'Review',   sub: 'Check, then save', when: function () { return true; } }
  ];
  function liveSteps() { return STEPS.filter(function (s) { return s.when(); }); }
  function stepIndex() {
    var ls = liveSteps();
    for (var i = 0; i < ls.length; i++) if (ls[i].key === st.step) return i;
    return 0;
  }

  // ---- steps -----------------------------------------------------------------
  function stepType() {
    var opts = [
      ['Contract',      'A construction contract. It DEFINES a contract package, and can carry its BOQ.'],
      ['Change Order',  'A variation raised against a package that already exists.'],
      ['Claim',         'A commercial claim raised against a package.'],
      ['EOT',           'Extension of Time — measured in days, not pesos.'],
      ['Package',       'A contract lot on its own — when the package is known before its contract is.'],
      ['BOQ',           'Load a bill of quantities against a package, without creating a record.']
    ];
    return '<div class="ccw-cards">' + opts.map(function (o) {
      return '<button class="ccw-card' + (st.type === o[0] ? ' on' : '') + '" data-type="' + esc(o[0]) + '">' +
        '<span class="ccw-card-t">' + esc(o[0]) + '</span>' +
        '<span class="ccw-card-d">' + esc(o[1]) + '</span></button>';
    }).join('') + '</div>';
  }

  /* SEVERAL PACKAGES IN ONE RUN.
     Owner: *"upon creating a construction contract - it would also define multiple
     packages in one go. Currently the planner would have to go through multiple runs in
     the same wizard just to log for example 5 packages for a single project."*
     One contract commonly buys several lots, so the package step is a LIST, not a form.
     ⚠️ THE CONTRACT RECORD CAN ONLY CITE ONE. `contracts_claims.package_id` is a single
        column, so when a contract defines five, the record is linked to the one marked
        PRIMARY (the first by default) and the other four are created beside it. That is
        said on screen — silently linking to whichever sorted first would make the claims
        register cite a lot nobody chose.
     ⚠️ ALL-OR-NOTHING. If the contract record then fails to save, EVERY package this run
        created is rolled back — not just the last one. */
  /* The rows that will actually be created: a blank row a planner added and never filled
     is dropped silently, because an empty row is a UI artefact, not an intention. */
  function pkgToCreate() {
    return st.pkgList.filter(function (p) { return String(p.code || '').trim(); });
  }
  function primaryPkg() {
    var list = pkgToCreate();
    if (!list.length) return null;
    var want = st.pkgList[st.pkgPrimary];
    return (want && String(want.code || '').trim()) ? want : list[0];
  }
  /* ⚠️ Two rows with the same code cannot both be created — the table is unique on
     (project, lower(code)) — and the second would fail halfway through, after the first
     had already been written. Caught before anything is saved. */
  function dupPkgCode() {
    var seen = {}, list = pkgToCreate();
    for (var i = 0; i < list.length; i++) {
      var k = String(list[i].code).trim().toLowerCase();
      if (seen[k]) return list[i].code;
      seen[k] = 1;
    }
    return null;
  }
  function blankPkg() { return { code: '', name: '', start: '', end: '', amount: '' }; }
  function pkgRowsHTML() {
    return '<table class="ccw-pkgs"><thead><tr>' +
      '<th style="width:26px;" title="Which package the contract record is linked to">★</th>' +
      '<th>Code</th><th>Name</th><th>Start</th><th>Finish</th><th>Amount</th><th></th>' +
      '</tr></thead><tbody>' +
      st.pkgList.map(function (p, i) {
        return '<tr>' +
          '<td style="text-align:center;"><input type="radio" name="ccw-primary" data-primary="' + i + '"' +
            (st.pkgPrimary === i ? ' checked' : '') + (st.type === 'Package' ? ' disabled' : '') + ' /></td>' +
          '<td><input data-pf="code" data-i="' + i + '" value="' + esc(p.code) + '" placeholder="PKG-' + (i + 1) + '" /></td>' +
          '<td><input data-pf="name" data-i="' + i + '" value="' + esc(p.name) + '" placeholder="Tower ' + (i + 1) + '" /></td>' +
          '<td><input data-pf="start" data-i="' + i + '" type="date" value="' + esc(p.start) + '" /></td>' +
          '<td><input data-pf="end" data-i="' + i + '" type="date" value="' + esc(p.end) + '" /></td>' +
          '<td><input data-pf="amount" data-i="' + i + '" type="number" step="0.01" value="' + esc(p.amount) + '" /></td>' +
          '<td>' + (st.pkgList.length > 1 ? '<button class="pd-btn ccw-x" data-del="' + i + '" title="Remove">&times;</button>' : '') + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>' +
      '<button class="pd-btn" id="ccw-addpkg">+ Add another package</button>';
  }

  function stepPackage() {
    var pk = D.packages();
    if (st.type === 'Package') {
      return '<p class="ccw-hint">A contract package is a scope division of this project — ' +
        '<b>Package 1 — Tower 1 and General Requirements</b>, <b>Package 2 — Towers 2-7</b>. ' +
        'They come off the contract documents; record one here when you have the lot before the ' +
        'signed contract.</p>' +
        pkgRowsHTML() +
        '<p class="ccw-hint">⚠️ <b>Finish</b> is the contractual completion date. The schedule adds approved ' +
        'EOT days to it to get a revised finish, so a package without one reports no revised finish and no ' +
        'liquidated-damages exposure.</p>';
    }
    /* Two directions, and the wizard says which one it is in. A Contract DEFINES its
       package; everything else is RAISED AGAINST one that already exists. Getting this
       backwards is what the owner caught in the old form. */
    if (st.type === 'Contract') {
      return '<p class="ccw-hint">A contract package is a scope division of this project — ' +
        '<b>Package 1 — Tower 1 and General Requirements</b>, <b>Package 2 — Towers 2-7</b>. ' +
        'This contract <b>defines</b> one. The schedule, BOQ, procurement and engineering all file against it.</p>' +
        '<label>Package<select id="ccw-pkg">' +
          '<option value="">— Create it from this contract —</option>' +
          pk.map(function (p) { return '<option value="' + esc(p.id) + '"' + (st.pkgId === p.id ? ' selected' : '') + '>Link to ' + esc((p.code ? p.code + ' — ' : '') + p.name) + '</option>'; }).join('') +
        '</select></label>' +
        '<div id="ccw-pkgnew"' + (st.pkgId ? ' style="display:none;"' : '') + '>' +
          pkgRowsHTML() +
          '<p class="ccw-hint">One contract often buys several lots — add a row for each, in one run. ' +
          '⚠️ The contract record itself can cite only <b>one</b> package, so the row marked <b>★</b> is the one ' +
          'it links to; the rest are created beside it.</p>' +
          '<p class="ccw-hint">⚠️ Created only when you press <b>Save</b> on the last step — never before, so ' +
          'abandoning the wizard leaves no half-made package behind. If the contract then fails to save, ' +
          '<b>every</b> package this run created is rolled back.</p>' +
        '</div>';
    }
    if (!pk.length) {
      return '<p class="ccw-hint">⚠️ This project has <b>no contract packages yet</b>. They come off the contract ' +
        'documents — record the <b>Contract</b> first (it defines the package), or add one on the Dashboard. ' +
        'You can continue without one: the record is simply not narrowed to a lot.</p>';
    }
    return '<p class="ccw-hint">Which contract lot is this raised against? Optional — a package narrows a record, ' +
      'it is never required.</p>' +
      '<label>Raised against package<select id="ccw-pkg">' +
        '<option value="">— none —</option>' +
        pk.map(function (p) { return '<option value="' + esc(p.id) + '"' + (st.pkgId === p.id ? ' selected' : '') + '>' + esc((p.code ? p.code + ' — ' : '') + p.name) + '</option>'; }).join('') +
      '</select></label>';
  }

  function stepDetails() {
    var isC = st.type === 'Contract', isEot = st.type === 'EOT';
    return '<div class="ccw-grid">' +
      '<label>Reference no.<input id="ccw-ref" value="' + esc(st.ref) + '" placeholder="' + (isC ? 'e.g. CTR-2026-01' : 'e.g. CO 01') + '" /></label>' +
      '<label>Counterparty / client<input id="ccw-cp" value="' + esc(st.cp) + '" /></label>' +
      '</div>' +
      '<label>Description<textarea id="ccw-desc" placeholder="' + (isC ? 'e.g. Construction of Tower 1 and General Requirements' : 'e.g. Additional Cost for Plumbing Fixtures') + '">' + esc(st.desc) + '</textarea></label>' +
      (isC
        ? '<label>Contract amount<input id="ccw-amount" type="number" step="0.01" value="' + esc(st.amount) + '" /></label>' +
          '<p class="ccw-hint">This becomes the package\'s contract value.</p>'
        : '<div class="ccw-grid">' +
            '<label>Estimated ' + (isEot ? 'days' : 'amount') + '<input id="ccw-est" type="number" step="' + (isEot ? '1' : '0.01') + '" value="' + esc(st.est) + '" /></label>' +
            '<label>Submitted ' + (isEot ? 'days' : 'amount') + '<input id="ccw-sub" type="number" step="' + (isEot ? '1' : '0.01') + '" value="' + esc(st.sub) + '" /></label>' +
          '</div>' +
          '<p class="ccw-hint">Evaluated and Client-approved figures are filled in later, as the claim moves ' +
          'through its pipeline — they are not known when it is raised.</p>');
  }

  function stepDates() {
    /* ⚠️ A contract is SIGNED; a claim is filed, submitted, evaluated, approved.
       Showing the claim pipeline on a contract is the exact bug the owner reported in
       the old form, so the wizard never builds those fields for a Contract at all. */
    if (st.type === 'Contract') {
      return '<label>Date signed<input id="ccw-d1" type="date" value="' + esc(st.d1) + '" /></label>' +
        '<p class="ccw-hint">The contract\'s own start and finish are the <b>package</b> dates from step 2 — ' +
        'those are what the schedule and the billing read.</p>';
    }
    return '<div class="ccw-grid">' +
      '<label>Date filed<input id="ccw-d1" type="date" value="' + esc(st.d1) + '" /></label>' +
      '<label>Date submitted<input id="ccw-d2" type="date" value="' + esc(st.d2) + '" /></label>' +
      '</div>' +
      '<p class="ccw-hint">Aging runs from <b>Date submitted</b> while the record is pending — it is never stored. ' +
      'Evaluated and approved dates are recorded later, on the record itself.</p>';
  }

  function stepBoq() {
    /* ⚠️ OPTIONAL, AND SAID SO — owner, on seeing this step: *"is this section optional?
       Or even at the right time to add where for example a project had just been awarded
       and there is no BOQ to import yet."* He is right: a contract is recorded the week
       it is awarded, and the priced BOQ often arrives weeks later. A step that looks
       mandatory at that moment invites either a fabricated import or an abandoned wizard.
       So this step asserts nothing, blocks nothing, and names the later path.
       ⚠️ ALSO HONEST ABOUT THE PARSER. Detection is a set of header patterns measured
          against ONE real workbook; a client whose sheet says "Particulars / Sum" parses
          partly, and a silently-wrong money column is the dangerous failure. So it hands
          over to the existing detect → preview → accept importer rather than pretending
          the wizard has already understood the file. */
    return '<p class="ccw-hint"><b>This step is optional — most contracts are recorded before the BOQ arrives.</b> ' +
      'Press <b>Next</b> to skip it; nothing is lost, and the package you just defined is what the BOQ will be ' +
      'loaded against whenever it turns up.</p>' +
      '<p class="ccw-hint">When you do have it: a BOQ comes in whatever format the client uses, so the importer ' +
      '<b>proposes</b> a column map and you accept or correct it — nothing is written until you do.</p>' +
      (st.pkgId || pkgToCreate().length
        ? '<p class="ccw-hint">It will be loaded against <b>' +
          esc(st.pkgLabel() || (primaryPkg() ? primaryPkg().code : '') || 'the package from step 2') + '</b>.</p>'
        : '<p class="ccw-hint">⚠️ No package chosen, so a BOQ loaded later will not be narrowed to a lot.</p>') +
      '<p class="ccw-hint">⚠️ The importer lives on the <b>BOQ tab</b> and writes on its own Accept. Finish here ' +
      'first so the package exists — then import against it.</p>';
  }

  function stepReview() {
    function row(k, v2) { return '<tr><td>' + esc(k) + '</td><td><b>' + (v2 || '<span class="ccw-mut">—</span>') + '</b></td></tr>'; }
    var mk = pkgToCreate();
    var creating = (st.type === 'Contract' || st.type === 'Package') && !st.pkgId && mk.length;
    var h = '<table class="ccw-review"><tbody>' +
      row('Type', esc(st.type)) +
      row(st.type === 'Package' ? 'Package' : (st.type === 'Contract' ? 'Defines package' : 'Raised against'), creating
        ? mk.map(function (p, i) {
            return esc(p.code + (p.name ? ' — ' + p.name : '')) +
              (st.type !== 'Package' && p === primaryPkg() ? ' <span class="ccw-new">★ linked to this contract</span>' : '');
          }).join('<br>') + ' <span class="ccw-new">' + mk.length + ' will be created</span>'
        : esc(st.pkgLabel())) +
      (st.type === 'BOQ' || st.type === 'Package' ? '' :
        row('Reference no.', esc(st.ref)) +
        row('Description', esc(st.desc)) +
        row('Counterparty', esc(st.cp)) +
        (st.type === 'Contract'
          ? row('Contract amount', st.amount === '' ? '' : esc(Number(st.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })))
          : row('Estimated', esc(st.est)) + row('Submitted', esc(st.sub))) +
        row(st.type === 'Contract' ? 'Date signed' : 'Date filed', esc(st.d1)) +
        (st.type === 'Contract' ? '' : row('Date submitted', esc(st.d2)))) +
      '</tbody></table>';
    if (creating) {
      h += '<p class="ccw-hint">⚠️ Saving creates ' + mk.length + ' package(s) and the record together. ' +
        'If the package cannot be created — a duplicate code, most often — <b>nothing</b> is saved and you stay here.</p>';
    }
    if (st.type === 'BOQ') {
      h += '<p class="ccw-hint">Nothing is recorded for a BOQ-only run: go to the <b>BOQ tab</b> and import against ' +
        'the package you chose.</p>';
    }
    return h;
  }

  var RENDER = { type: stepType, package: stepPackage, details: stepDetails, dates: stepDates, boq: stepBoq, review: stepReview };

  // ---- shell -----------------------------------------------------------------
  function paint() {
    var ls = liveSteps(), i = stepIndex(), cur = ls[i];
    ov.querySelector('#ccw-rail').innerHTML = ls.map(function (s, n) {
      return '<button class="ccw-rail-i' + (n === i ? ' on' : (n < i ? ' done' : '')) + '" data-goto="' + esc(s.key) + '"' +
        (n > i ? ' disabled' : '') + '><span class="ccw-rail-n">' + (n + 1) + '</span>' +
        '<span class="ccw-rail-l">' + esc(s.label) + '</span></button>';
    }).join('');
    ov.querySelector('#ccw-h').textContent = (i + 1) + ' · ' + cur.label;
    ov.querySelector('#ccw-sub').textContent = cur.sub;
    ov.querySelector('#ccw-body').innerHTML = RENDER[cur.key]();
    ov.querySelector('#ccw-back').disabled = i === 0;
    var last = i === ls.length - 1;
    ov.querySelector('#ccw-next').textContent = last ? (st.type === 'BOQ' ? 'Done' : 'Save') : 'Next';
    ov.querySelector('#ccw-next').className = 'pd-btn ' + (last ? 'pd-btn-primary' : 'pd-btn-primary');
    wireStep(cur.key);
  }
  function read(id) { var x = ov.querySelector('#' + id); return x ? (x.value || '').trim() : ''; }
  function wireStep(key) {
    if (key === 'type') {
      ov.querySelectorAll('[data-type]').forEach(function (b) {
        b.onclick = function () { st.type = b.dataset.type; paint(); };
      });
    } else if (key === 'package') {
      var sel = ov.querySelector('#ccw-pkg');
      if (sel) sel.onchange = function () {
        st.pkgId = sel.value || '';
        var box = ov.querySelector('#ccw-pkgnew');
        if (box) box.style.display = st.pkgId ? 'none' : '';
      };
      ov.querySelectorAll('[data-pf]').forEach(function (x) {
        x.oninput = function () { st.pkgList[+x.dataset.i][x.dataset.pf] = x.value; };
      });
      ov.querySelectorAll('[data-primary]').forEach(function (r) {
        r.onchange = function () { st.pkgPrimary = +r.dataset.primary; };
      });
      ov.querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = function () {
          capture('package');
          var i = +b.dataset.del;
          st.pkgList.splice(i, 1);
          /* ⚠️ The primary must follow the removal. Leaving it on an index that has
             shifted (or no longer exists) links the contract to the wrong lot. */
          if (st.pkgPrimary >= st.pkgList.length) st.pkgPrimary = st.pkgList.length - 1;
          else if (st.pkgPrimary > i) st.pkgPrimary--;
          paint();
        };
      });
      var addp = ov.querySelector('#ccw-addpkg');
      if (addp) addp.onclick = function () { capture('package'); st.pkgList.push(blankPkg()); paint(); };
    }
  }
  /* Capture whatever the current step holds before leaving it — a wizard that loses a
     field when you press Back is worse than no wizard. */
  function capture(key) {
    if (key === 'package') {
      var sel = ov.querySelector('#ccw-pkg'); if (sel) st.pkgId = sel.value || '';
      ov.querySelectorAll('[data-pf]').forEach(function (x) {
        var row = st.pkgList[+x.dataset.i]; if (row) row[x.dataset.pf] = x.value;
      });
    } else if (key === 'details') {
      st.ref = read('ccw-ref'); st.cp = read('ccw-cp'); st.desc = read('ccw-desc');
      st.amount = read('ccw-amount'); st.est = read('ccw-est'); st.sub = read('ccw-sub');
      /* Seed only the FIRST row, and only while it is untouched — a contract that buys
         five lots must not have four of them silently named after the contract. */
      var p0 = st.pkgList[0];
      if (p0 && !p0.code) p0.code = st.ref;
      if (p0 && !p0.name) p0.name = st.desc.slice(0, 80);
    } else if (key === 'dates') {
      st.d1 = read('ccw-d1'); st.d2 = read('ccw-d2');
    }
  }

  /* ⚠️ ROLLS BACK EVERY PACKAGE THIS RUN CREATED, newest first. Only ones created here:
     a package the planner LINKED to is somebody else's row and is never touched. */
  async function rollbackPackages(ids) {
    for (var i = ids.length - 1; i >= 0; i--) {
      try { await D.deletePackage(ids[i]); } catch (e) { /* reported by the caller */ }
    }
  }
  async function finish() {
    var btn = ov.querySelector('#ccw-next');
    if (st.type === 'BOQ') { close(); return; }
    if (st.type === 'Package') {
      if (!pkgToCreate().length) { UI.toast('Give at least one package a code — it comes off the contract.', 'error'); return; }
    } else if (!st.desc && !st.ref) {
      UI.toast('Give the record a description or a reference number.', 'error'); return;
    }
    btn.disabled = true; btn.textContent = 'Saving…';
    var pkgId = st.pkgId || null, madeIds = [];   // madeIds = created by THIS save, in order
    /* ⚠️ PACKAGES ARE CREATED FIRST AND A FAILURE ABORTS EVERYTHING — including packages
       already written in this same run, which are rolled back below. A record saved
       pointing at a package that could not be created would claim a link that does not
       exist, and nothing downstream would ever notice. */
    var t0 = st.type;
    if ((t0 === 'Contract' || t0 === 'Package') && !pkgId) {
      var dup = dupPkgCode();
      if (dup) {
        btn.disabled = false; btn.textContent = 'Save';
        UI.toast('Two rows both use the code "' + dup + '" — codes must be unique within a project.', 'error');
        return;
      }
      var want = pkgToCreate(), prim = primaryPkg();
      for (var pi = 0; pi < want.length; pi++) {
        var row = want[pi];
        try {
          var made = await D.createPackage({
            project_id: D.pid(), code: String(row.code).trim(), name: (row.name || row.code).trim(),
            description: (t0 === 'Contract' && row === prim) ? (st.desc || null) : null,
            contract_amount: row.amount === '' || row.amount == null ? null : Number(row.amount),
            start_date: row.start || null, end_date: row.end || null,
            status: 'active', sort_order: D.packages().length, created_by: D.uid()
          });
          madeIds.push(made.id);
          if (row === prim) pkgId = made.id;
        } catch (er) {
          var em = (er && er.message) || String(er);
          // Undo whatever this run already wrote before reporting.
          await rollbackPackages(madeIds);
          btn.disabled = false; btn.textContent = 'Save';
          UI.toast(/duplicate key/i.test(em)
            ? 'A package with code "' + row.code + '" already exists — go back and link to it instead.'
            : ('Could not create package "' + row.code + '": ' + em), 'error');
          return;
        }
      }
    }
    /* ⚠️ A PACKAGE IS THE WHOLE RECORD. There is no contracts_claims row to write, so
       there is nothing to roll back either — the package IS the thing being saved. */
    if (t0 === 'Package') {
      close();
      UI.toast(madeIds.length + ' package(s) created.', 'success');
      D.done('Package');
      return;
    }
    var t = st.type, num = function (x) { return x === '' ? null : (isFinite(Number(x)) ? Number(x) : null); };
    var payload = {
      project_id: D.pid(), record_type: t,
      reference_no: st.ref || null, description: st.desc || null, counterparty: st.cp || null,
      package_id: pkgId,
      amount: t === 'Contract' ? num(st.amount) : null,
      est_amount: null, sub_amount: null, eval_amount: null, approved_amount: null,
      est_days: null, sub_days: null, eval_days: null, approved_days: null,
      status: t === 'Contract' ? null : 'Pending',
      date_filed: st.d1 || null,
      date_submitted: t === 'Contract' ? null : (st.d2 || null),
      date_evaluated: null, date_approved: null,
      remarks: null, updated_at: new Date().toISOString()
    };
    if (t === 'Claim' || t === 'Change Order') { payload.est_amount = num(st.est); payload.sub_amount = num(st.sub); }
    else if (t === 'EOT') { payload.est_days = num(st.est); payload.sub_days = num(st.sub); }

    var res = await D.persist(payload);
    if (!res.ok) {
      /* ⚠️ ROLL THE PACKAGE BACK. This wizard's own note claimed "abandoning the wizard
         leaves no orphan package behind" — and it was FALSE, caught live: the package is
         created first (the record needs its id), so a record insert that then failed left
         a real package behind with nothing pointing at it. The owner hit exactly that,
         twice: the save failed on a missing `approved_amount` column, and the retry was
         refused with "PKG-1 already exists" — a package they had never knowingly created
         and could not see in the records list.
         ⚠️ ONLY A PACKAGE THIS SAVE CREATED IS REMOVED. One the planner linked to
            (st.pkgId set) is somebody else's row and is never touched. */
      await rollbackPackages(madeIds);
      btn.disabled = false; btn.textContent = 'Save';
      UI.toast(D.failMsg(res.error) +
        (madeIds.length ? ' All ' + madeIds.length + ' package(s) were rolled back, so nothing was left behind.' : ''), 'error');
      return;
    }
    close();
    UI.toast(madeIds.length
      ? 'Contract saved, and ' + madeIds.length + ' package(s) created.' : 'Record added.', 'success');
    if (D.warnDropped) D.warnDropped(res.dropped);
    D.done(t);
  }

  function close() { if (ov) { ov.remove(); ov = null; } }

  function open(deps, type) {
    D = deps;
    st = {
      step: 'type', type: type || 'Contract',
      pkgId: '', pkgCode: '', pkgName: '', pkgStart: '', pkgEnd: '',
      ref: '', desc: '', cp: '', amount: '', est: '', sub: '', d1: '', d2: '',
      pkgLabel: function () {
        var p = D.packages().filter(function (x) { return String(x.id) === String(st.pkgId); })[0];
        return p ? ((p.code ? p.code + ' — ' : '') + p.name) : '';
      }
    };
    ov = document.createElement('div');
    ov.className = 'pd-modal-overlay ccw-ov';
    ov.innerHTML =
      '<div class="pd-modal ccw"><div class="pd-modal-header">' +
        '<h2 style="margin:0;">New record</h2><button class="pd-modal-close" id="ccw-x">&times;</button></div>' +
      '<div class="ccw-wrap"><div class="ccw-rail" id="ccw-rail"></div>' +
        '<div class="ccw-main"><h3 id="ccw-h"></h3><p class="ccw-sub" id="ccw-sub"></p>' +
        '<div id="ccw-body"></div></div></div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" id="ccw-cancel">Cancel</button>' +
        '<button class="pd-btn" id="ccw-back">Back</button>' +
        '<button class="pd-btn pd-btn-primary" id="ccw-next">Next</button></div></div>';
    document.body.appendChild(ov);
    ov.querySelector('#ccw-x').onclick = close;
    ov.querySelector('#ccw-cancel').onclick = close;
    ov.querySelector('#ccw-back').onclick = function () {
      capture(st.step);
      var ls = liveSteps(), i = stepIndex();
      if (i > 0) { st.step = ls[i - 1].key; paint(); }
    };
    ov.querySelector('#ccw-next').onclick = function () {
      capture(st.step);
      var ls = liveSteps(), i = stepIndex();
      if (i >= ls.length - 1) { finish(); return; }
      st.step = ls[i + 1].key; paint();
    };
    ov.addEventListener('click', function (e) {
      var g = e.target.closest && e.target.closest('[data-goto]');
      if (g && !g.disabled) { capture(st.step); st.step = g.dataset.goto; paint(); }
    });
    paint();
  }
  return { open: open };
})();
