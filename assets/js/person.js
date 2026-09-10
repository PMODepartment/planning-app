/* ===========================================================================
   PDPerson — the shared stakeholder profile page.

   Owner, 2026-09-10: "When clicking on the stakeholder from the Portfolio View
   it just opens a pop-up for assigning a project. I need to have the page where
   I will see the personal page of that stakeholder with details and with user
   permissions I can edit that stakeholder." And, on the project register: "when
   clicking on a person in here would open a pop-up, instead let's make use of
   the personal page as well. Information presented will be project-level only
   and view-only for those items that are only should be editable in the
   portfolio level."

   ⚠️⚠️ ONE PAGE, TWO SCOPES, AND THE SCOPE IS IN THE URL:

        person.html#person=<uuid>                  portfolio scope
        person.html#person=<uuid>&project=<PID>    project scope

      Building a profile view inside each module instead would mean the layout
      exists twice and the two drift — the failure this repo has recorded for the
      S-curve maths and again for the identity matcher. There is one renderer;
      the scope only decides which blocks appear and which of them are editable.

   ⚠️ WHAT IS EDITABLE WHERE IS A DATA FACT, NOT A UI PREFERENCE. `stakeholders`
      is the directory — who this person IS — and `stakeholder_map` is one
      project's assessment of them. Identity is therefore editable at portfolio
      scope only, and a project page shows it marked `portfolio` and locked. That
      is the owner's "view-only for those items that are only should be editable
      in the portfolio level", and it is also what keeps two projects from
      disagreeing about somebody's name.
   =========================================================================== */
window.PDPerson = (function () {
  'use strict';

  var DIR = 'stakeholders';
  var MAP = 'stakeholder_map';

  var personId = '', projectId = '', person = null, mapRow = null, usage = [];
  var profile = null, editing = false, dirCols = null;
  // ⚠️ `editing` is the IDENTITY editor (portfolio scope). `projEditing` is the
  //    register's own form mounted on this page (project scope). They are separate
  //    because they edit different tables and are gated differently.
  var projEditing = false;

  function sb() { return AppAuth.getSB(); }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return (window.Fmt && Fmt.esc) ? Fmt.esc(s) : String(s == null ? '' : s); }

  // ⚠️ Writers are planner and above. `viewer` and `user` read the profile and
  //    cannot change it — the same ladder auth.js documents.
  function canWrite() {
    var r = profile && profile.role;
    return r === 'planner' || r === 'admin' || r === 'super_admin';
  }

  // ---- the hash ------------------------------------------------------------
  // ⚠️ Read with the same `key=value&key=value` shape UI.bindHistoryState writes,
  //    so this page can share a URL with a module's own state without either
  //    clobbering the other.
  function readHash() {
    var out = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (p) {
      if (!p) return;
      var i = p.indexOf('=');
      if (i === -1) return;
      out[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1));
    });
    return out;
  }

  function val(v) {
    var s = v == null ? '' : String(v).trim();
    return s ? '<div class="pp-v">' + esc(s) + '</div>'
             : '<div class="pp-v is-empty">—</div>';
  }
  function field(label, v, locked) {
    return '<div class="pp-f' + (locked ? ' is-locked' : '') + '">' +
      '<div class="pp-l">' + esc(label) + '</div>' + val(v) + '</div>';
  }

  function statusOf(p) { return (p && p.status) || 'Active'; }
  function initials(name) {
    return (String(name || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); }).join('')) || '?';
  }

  // ---- load ---------------------------------------------------------------
  async function load() {
    var q = await sb().from(DIR).select('*').eq('id', personId).limit(1);
    if (q.error) throw q.error;
    person = (q.data || [])[0] || null;
    if (!person) return;
    // ⚠️ Which optional columns this deployment actually has, learned from the row
    //    rather than assumed — 2026-09-10-stakeholder-profile-fields.sql may not
    //    have been run, and a locked-looking empty field is better than a lie.
    dirCols = PDStakeholders.columnsFrom([person]);

    // every project this person is on — a fact about the PERSON, so it is never
    // narrowed by whatever project filter the caller happened to have set
    try {
      var u = await sb().from(MAP).select('id,project_id,relationship_champion')
                        .eq('stakeholder_id', personId);
      usage = (u.data || []).filter(function (r) { return r.project_id; });
    } catch (e) { usage = []; }

    if (projectId) {
      var m = await sb().from(MAP).select('*')
                        .eq('stakeholder_id', personId).eq('project_id', projectId).limit(1);
      mapRow = (m.data || [])[0] || null;
    }
  }

  // ---- render -------------------------------------------------------------
  function renderCrumb() {
    var back = projectId
      ? { href: 'modules/stakeholder-map/index.html?project=' + encodeURIComponent(projectId),
          label: projectId + ' Stakeholder Map' }
      : { href: 'modules/portfolio-overview/index.html#po_view=' +
                encodeURIComponent(JSON.stringify({ v: 'stakeholders' })),
          label: 'All profiles' };
    return '<div class="pp-crumb">' +
      '<a class="pp-back" href="' + back.href + '" title="Back to ' + esc(back.label) + '">' +
        '<span data-ico="chevronLeft" data-ico-size="16"></span></a>' +
      '<div class="pp-crumb-txt"><a href="' + back.href + '">' + esc(back.label) + '</a>' +
        '<span class="pp-crumb-sep">/</span>' +
        '<span class="pp-crumb-cur">' + esc((person && person.name) || 'Profile') + '</span></div>' +
      '</div>';
  }

  function renderHead() {
    var st = statusOf(person), off = st !== 'Active';
    var thumb = person.photo_thumb_path || person.photo_path;
    var acts = '';
    if (!projectId && canWrite()) {
      acts = '<button class="pd-btn pd-btn-primary" id="pp-edit">' +
             (editing ? 'Cancel' : 'Edit profile') + '</button>';
      if (editing) acts += '<button class="pd-btn pd-btn-primary" id="pp-save">Save</button>';
    } else if (projectId) {
      // ⚠️⚠️ THE REGISTER'S OWN FORM IS MOUNTED HERE, not reimplemented. Owner:
      //    "Fold the register form onto the person page… All edits should only be
      //    available at the person page." `StakeholderMap.mountForm` renders the
      //    identical 619-line form into an element on this page — see the note on
      //    `inlineHost` in that module. There is one editor, and it lives here.
      if (canWrite() && mapRow) {
        acts = '<button class="pd-btn pd-btn-primary" id="pp-pedit">' +
               (projEditing ? 'Close editor' : 'Edit') + '</button>';
      }
      acts += '<a class="pd-btn" href="modules/stakeholder-map/index.html?project=' +
              encodeURIComponent(projectId) + '">Open register</a>';
    }
    return '<div class="pp-head">' +
      '<div class="pp-ava">' + (thumb ? '<img id="pp-photo" alt="">' : esc(initials(person.name))) +
        '<span class="pp-dot' + (off ? ' off' : '') + '" title="' + esc(st) + '"></span></div>' +
      '<div class="pp-id">' +
        '<div class="pp-name">' + esc(person.name || '(unnamed)') +
          (person.nickname ? ' <span class="pp-nick">“' + esc(person.nickname) + '”</span>' : '') +
        '</div>' +
        '<div class="pp-org">' + (person.organization ? esc(person.organization) : '—') + '</div>' +
        '<div class="pp-role">' + (person.role_title ? esc(person.role_title) : '—') + '</div>' +
      '</div>' +
      '<div class="pp-head-act">' + acts + '</div>' +
    '</div>';
  }

  // The identity block. `locked` is true on a project page.
  function renderDetails() {
    var locked = !!projectId;
    var has = function (c) { return PDStakeholders.hasCol(dirCols, c); };
    var st = statusOf(person), off = st !== 'Active';
    var rows =
      field('Name', person.name, locked) +
      (has('middle_initial') ? field('Middle initial', person.middle_initial, locked) : '') +
      field('Nickname', person.nickname, locked) +
      field('Honorific / title', person.title, locked) +
      field('Sector', person.category, locked) +
      (has('sub_sector') ? field('Sub-sector', person.sub_sector, locked) : '') +
      field('Agency / organisation', person.organization, locked) +
      field('Position', person.role_title, locked) +
      (has('secondary_position') ? field('Secondary position', person.secondary_position, locked) : '') +
      field('Group', person.stakeholder_group, locked) +
      field('Email', person.email, locked) +
      field('Contact', person.contact, locked) +
      '<div class="pp-f' + (locked ? ' is-locked' : '') + '"><div class="pp-l">Status</div>' +
        '<div class="pp-v"><span class="pp-pill' + (off ? ' off' : '') + '"><i></i>' + esc(st) + '</span></div></div>';

    return '<section class="pp-panel"><h2>Personal details</h2>' +
      '<p class="pp-panel-sub">' + (locked
        ? 'Held once in the shared directory, so every project sees the same person. ' +
          'Change it from the Portfolio Directory — editing it here would let two projects ' +
          'disagree about somebody’s name.'
        : 'The shared directory record. Every project that maps this person reads it.') +
      '</p>' + rows + '</section>';
  }

  function renderOwner() {
    if (projectId) {
      var r = mapRow || {};
      return '<section class="pp-panel"><h2>Ownership</h2>' +
        '<p class="pp-panel-sub">Who holds this relationship on ' + esc(projectId) +
        '. These are project facts — the same person can be championed by different ' +
        'people on different jobs.</p>' +
        field('Relationship champion', r.relationship_champion) +
        field('Relationship owner', r.relationship_owner || r.primary_responsible) +
        field('Megawide counterpart', r.megawide_counterpart) +
        field('Alternate', r.alternate) +
      '</section>';
    }
    var body;
    if (!usage.length) {
      body = '<p class="pp-note">On no project yet. Assign them from the Portfolio Directory.</p>';
    } else {
      body = '<div class="pp-chips">' + usage.map(function (u) {
        return '<a class="pp-chip" href="person.html#person=' + encodeURIComponent(personId) +
          '&project=' + encodeURIComponent(u.project_id) + '">' + esc(u.project_id) + '</a>';
      }).join('') + '</div>' +
      '<p class="pp-note">Open one to see that project’s assessment of them.</p>';
    }
    return '<section class="pp-panel"><h2>On ' + usage.length +
      (usage.length === 1 ? ' project' : ' projects') + '</h2>' +
      '<p class="pp-panel-sub">Every project this person is mapped to, whatever the ' +
      'project filter was set to when you got here.</p>' + body + '</section>';
  }

  // The OPS register's own bands, for a project page.
  // ⚠️ READ-ONLY, and deliberately: `stakeholder-map`'s form already owns writing
  //    these 31 columns, with its derivations and its autosave. A second editor is
  //    a second set of rules to keep in step.
  function renderBands() {
    if (!projectId) return '';
    if (!mapRow) {
      return '<div class="pp-bands"><section class="pp-panel">' +
        '<h2>Not on this project</h2><p class="pp-panel-sub">This person is in the ' +
        'directory but is not mapped to ' + esc(projectId) + ', so there is no ' +
        'assessment to show. Add them from that project’s register.</p></section></div>';
    }
    var r = mapRow;
    var band = function (title, sub, body) {
      return '<section class="pp-panel"><h2>' + esc(title) + '</h2>' +
        '<p class="pp-panel-sub">' + esc(sub) + '</p>' + body + '</section>';
    };
    return '<div class="pp-bands">' +
      band('Identification', 'Where this person sits in the 5-PMLC process.',
        field('Activity', r.activity_no ? (r.activity_no + '. ' + (r.activity || '')) : '') +
        field('Sub-process', r.sub_process) +
        field('Stakeholder category', r.stk_category) +
        field('Sub-category', r.stk_sub_category)) +
      band('Assessment', 'Impact and influence, and the priority they resolve to.',
        field('Impact', r.influence) + field('Influence', r.interest) +
        field('Importance', (r.influence && r.interest) ? (r.influence * r.interest) : '') +
        field('Priority level', r.priority_level)) +
      band('Response', 'What we do about them, and what it costs.',
        field('Response category', r.response_category) +
        field('Response description', r.response_description) +
        field('Impact cost', r.impact_cost) + field('Response cost', r.response_cost)) +
      band('Engagement', 'The plan, and the relationship it is meant to move.',
        field('Approach', r.mgmt_approach) +
        field('Engagement plan', r.engagement_plan) +
        field('Relationship now', r.current_rel) + field('Target', r.target_rel)) +
      band('Residual risk', 'What is left after the response.',
        field('Impact score', r.res_impact) + field('Possibility', r.res_possibility) +
        field('Detectability', r.res_detectability)) +
      band('Audit plan', 'How this is checked.',
        field('Audit procedures', r.audit_procedures) +
        field('Required documents', r.required_documents) +
        field('Point person', r.audit_contact) + field('Timing', r.audit_timing)) +
    '</div>';
  }

  // ---- the portfolio-scope editor -----------------------------------------
  // ⚠️ Only the identity block becomes editable, and only at portfolio scope.
  function renderEditor() {
    var has = function (c) { return PDStakeholders.hasCol(dirCols, c); };
    var f = function (id, label, v, type) {
      return '<div class="pp-f"><div class="pp-l">' + esc(label) + '</div>' +
        '<input class="pd-input" id="pp-' + id + '" type="' + (type || 'text') +
        '" value="' + esc(v == null ? '' : v) + '"></div>';
    };
    return '<section class="pp-panel"><h2>Personal details</h2>' +
      '<p class="pp-panel-sub">The shared directory record. Every project that maps this ' +
      'person reads it, so a change here reaches all of them.</p>' +
      f('name', 'Name', person.name) +
      (has('middle_initial') ? f('middle_initial', 'Middle initial', person.middle_initial) : '') +
      f('nickname', 'Nickname', person.nickname) +
      f('title', 'Honorific / title', person.title) +
      f('category', 'Sector', person.category) +
      (has('sub_sector') ? f('sub_sector', 'Sub-sector', person.sub_sector) : '') +
      f('organization', 'Agency / organisation', person.organization) +
      f('role_title', 'Position', person.role_title) +
      (has('secondary_position') ? f('secondary_position', 'Secondary position', person.secondary_position) : '') +
      f('stakeholder_group', 'Group', person.stakeholder_group) +
      f('email', 'Email', person.email, 'email') +
      f('contact', 'Contact', person.contact) +
      '</section>';
  }

  var EDIT_FIELDS = ['name', 'middle_initial', 'nickname', 'title', 'category', 'sub_sector',
                     'organization', 'role_title', 'secondary_position', 'stakeholder_group',
                     'email', 'contact'];

  async function save() {
    var patch = {};
    EDIT_FIELDS.forEach(function (k) {
      var el = $('pp-' + k);
      if (el) patch[k] = el.value.trim() || null;
    });
    if (!patch.name) { UI.toast('A name is required.', 'warn'); return; }
    var btn = $('pp-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      // ⚠️⚠️ `.select('id')` and a LENGTH CHECK, not a bare update. PostgREST answers
      //    an RLS-filtered UPDATE with 200 and zero rows — the silent success this
      //    repo has recorded since `boq_tag_activities`. Zero rows means it did not
      //    happen, and saying "Saved" over it is the worst outcome.
      var res = await PDStakeholders.writeTolerant(function (row) {
        return sb().from(DIR).update(row).eq('id', personId).select('id');
      }, patch);
      if (res.res && res.res.error) throw res.res.error;
      if (!((res.res && res.res.data) || []).length) {
        throw new Error('The directory refused the change — nothing was saved.');
      }
      Object.keys(patch).forEach(function (k) { person[k] = patch[k]; });
      editing = false;
      UI.toast(res.dropped && res.dropped.length
        ? 'Saved, without ' + res.dropped.join(', ') + ' — that column is not on this database yet.'
        : 'Saved.', res.dropped && res.dropped.length ? 'warn' : 'ok');
      paint();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
      UI.toast('Could not save: ' + ((e && e.message) || e), 'warn');
    }
  }

  // ---- paint --------------------------------------------------------------
  function paint() {
    var host = $('pp-body');
    if (!person) {
      host.innerHTML = '<div class="pp-empty">That stakeholder is not in the directory, ' +
        'or you do not have access to them.</div>';
      return;
    }
    host.innerHTML = renderCrumb() + renderHead() +
      // ⚠️ While the project form is open the READ view is not drawn. Showing both
      //    puts two copies of every value on one page, one of them stale the moment
      //    the planner types — and the form is the taller of the two, so the read
      //    view would sit under it looking like the saved state.
      (projEditing
        ? '<div class="pp-formhost pd-card" id="pp-form"></div>'
        : '<div class="pp-cols">' +
            (editing ? renderEditor() : renderDetails()) +
            renderOwner() +
          '</div>' + renderBands());

    if (window.Icons && Icons.hydrate) Icons.hydrate(host);
    document.title = (person.name || 'Profile') + ' — Planners Dashboard';

    var e = $('pp-edit');
    if (e) e.onclick = function () { editing = !editing; paint(); };
    var s = $('pp-save');
    if (s) s.onclick = save;
    var pe = $('pp-pedit');
    if (pe) pe.onclick = function () { projEditing = !projEditing; paint(); };
    if (projEditing) mountProjectForm();
    paintPhoto();
  }

  // ⚠️⚠️ The register's form, rendered into this page. It is the SAME function the
  //    register's "+ Add stakeholder" uses — not a copy — so the derived previews,
  //    the photo well, the six RCM bands and the autosave all behave identically and
  //    cannot drift from it.
  async function mountProjectForm() {
    var host = $('pp-form');
    if (!host) return;
    if (!window.StakeholderMap || !StakeholderMap.mountForm) {
      host.innerHTML = '<div class="pp-empty">The register module did not load, ' +
        'so the editor is unavailable. Open the register instead.</div>';
      return;
    }
    host.innerHTML = '<div class="pp-empty">Opening the editor…</div>';
    var res = await StakeholderMap.mountForm({
      host: host, projectId: projectId, stakeholderId: personId, profile: profile,
      // ⚠️ Re-read before repainting: the form writes the row, and this page's own
      //    copy of it is stale the moment it does.
      onSaved: async function () {
        projEditing = false;
        try { await load(); } catch (e) {}
        paint();
      },
      onClose: function () { projEditing = false; paint(); }
    });
    if (res && res.error) {
      host.innerHTML = '<div class="pp-empty">' + esc(res.error) + '</div>';
    }
  }

  // The photo lives in a private bucket, so it needs a signed URL.
  async function paintPhoto() {
    var img = $('pp-photo');
    if (!img) return;
    var path = person.photo_thumb_path || person.photo_path;
    try {
      var r = await sb().storage.from('stakeholder-photos').createSignedUrl(path, 3600);
      if (r && r.data && r.data.signedUrl) img.src = r.data.signedUrl;
    } catch (err) { /* the initials placeholder is already behind it */ }
  }

  async function start(prof) {
    profile = prof;
    // ⚠️⚠️ RESET THE EDIT STATE ON EVERY LOAD. `editing` is module state and the
    //    project chips on this page navigate to another scope of the SAME page, which
    //    replaces no document — so without this, leaving a profile mid-edit opened the
    //    NEXT person already in edit mode, over a form built from the previous one's
    //    values. Found by a harness, not by reading.
    editing = false;
    mapRow = null;
    usage = [];
    var h = readHash();
    personId = h.person || '';
    projectId = h.project || '';
    if (!personId) {
      $('pp-body').innerHTML = '<div class="pp-empty">No stakeholder was named in the link.</div>';
      return;
    }
    $('pp-body').innerHTML = '<div class="pp-empty">Loading…</div>';
    try { await load(); } catch (e) {
      $('pp-body').innerHTML = '<div class="pp-empty">' + esc((e && e.message) || e) + '</div>';
      return;
    }
    paint();
    // ⚠️ Re-read on a hash change: the project chips on this very page link to
    //    another scope of the SAME page, which changes no document.
    window.addEventListener('hashchange', function () { start(profile); });
  }

  return { start: start };
})();
