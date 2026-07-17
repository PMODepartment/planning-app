// ============================================================================
// Progress Photos — PPR Presentations
// ----------------------------------------------------------------------------
// Replaces the Power Apps "PPR PRESENTATIONS DATABASE" + "EDIT PROGRESS PHOTO
// SLIDES" screens.
//
// A PPR is one monthly Project Performance Review presentation. Each slide is a
// BEFORE/AFTER pair at one location — last month's photo beside this month's —
// tagged Trade / Works / Location, with an optional Key Plan overlay.
//
// The two photos are picked from the Photos Database (`progress_photos`), not
// re-uploaded: the library stays the single source of truth for imagery.
//
// Download exports a SELF-CONTAINED OFFLINE .html — every image inlined as a
// downscaled data URI — so a PPR opens with no network and no dependency on the
// photo library's load time.
// ============================================================================

window.PPR = (function () {
  var T_PPR    = 'ppr_presentations';
  var T_SLIDE  = 'ppr_slides';
  var T_PHOTO  = 'progress_photos';
  var BUCKET   = 'progress-photos';
  var SIGN_TTL = 3600;

  var profile = null, uid = null, pid = null, projName = '';
  var canWrite = false;
  var pprs = [];                 // presentations for this project
  var slidesOf = {};             // ppr_id -> [slide]
  var photos = [];               // the project's photo library (for picking)
  var urlCache = {};             // storage path -> signed URL
  var selId = null;              // selected PPR (drives the preview pane)
  var filters = { from: '', to: '' };
  var screen = 'list';           // list | slides
  var viewPprId = null, slideAt = 0, keyPlanOpen = false;

  function sb() { return AppAuth.getSB(); }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return Fmt.esc(s); }

  // The PPR screens are presentation surfaces, so they use the app's long date
  // ("13 July 2026") rather than the dashboard's compact Fmt.date.
  function longDate(d) {
    if (!d) return '—';
    var m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(d);
    return new Date(+m[1], +m[2] - 1, +m[3])
      .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function capDate(d) {
    if (!d) return '';
    var m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(d);
    return new Date(+m[1], +m[2] - 1, +m[3])
      .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function openModal(html, width) {
    var m = UI.modal(html);
    var box = m.el.querySelector('.pd-modal');
    if (box && width) box.style.maxWidth = width + 'px';
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-close]'), function (b) {
      b.onclick = m.close;
    });
    if (window.Icons && Icons.hydrate) Icons.hydrate(m.el);
    return m;
  }

  // ------------------------------------------------------------------ init ---
  function init(user, prof) {
    profile = prof; uid = user.id;
    canWrite = ['super_admin', 'admin', 'planner'].indexOf(prof.role) >= 0;
    wire();
    ProgressPhotos.onProject(function (p, name) {
      pid = p; projName = name;
      screen = 'list'; selId = null;
      load();
    });
  }

  function wire() {
    ['from', 'to'].forEach(function (k) {
      var el = $('ppr-f-' + k);
      if (el) el.onchange = el.oninput = function () { filters[k] = this.value; renderList(); };
    });
    $('ppr-new').onclick = function () { openPprForm(null); };
    $('ppr-back').onclick = function () { screen = 'list'; render(); };
  }

  // ------------------------------------------------------------------ load ---
  async function load() {
    var host = $('ppr-view');
    if (!pid) { host.innerHTML = '<div class="pp-empty">Select a project.</div>'; return; }
    host.innerHTML = '<div class="pp-empty">Loading PPRs…</div>';

    var pr = await sb().from(T_PPR).select('*')
      .eq('project_id', pid).order('ppr_date', { ascending: false });
    if (pr.error) { host.innerHTML = ''; UI.toast(pr.error.message, 'error'); return; }
    pprs = pr.data || [];

    var sl = await sb().from(T_SLIDE).select('*')
      .eq('project_id', pid).order('slide_no', { ascending: true });
    if (sl.error) { host.innerHTML = ''; UI.toast(sl.error.message, 'error'); return; }
    slidesOf = {};
    (sl.data || []).forEach(function (s) {
      (slidesOf[s.ppr_id] = slidesOf[s.ppr_id] || []).push(s);
    });

    var ph = await sb().from(T_PHOTO).select('*')
      .eq('project_id', pid).order('taken_at', { ascending: false });
    photos = ph.error ? [] : (ph.data || []);

    await signAll();
    render();
  }

  // Every image on screen (photos + key plans) signed in one round-trip.
  async function signAll() {
    urlCache = {};
    var paths = {};
    photos.forEach(function (p) { if (p.photo_url) paths[p.photo_url] = 1; });
    Object.keys(slidesOf).forEach(function (k) {
      slidesOf[k].forEach(function (s) { if (s.key_plan_url) paths[s.key_plan_url] = 1; });
    });
    var list = Object.keys(paths);
    if (!list.length) return;
    var res = await sb().storage.from(BUCKET).createSignedUrls(list, SIGN_TTL);
    if (res.error) { UI.toast('Could not load previews: ' + res.error.message, 'warn'); return; }
    (res.data || []).forEach(function (d) {
      if (d && d.signedUrl && !d.error) urlCache[d.path] = d.signedUrl;
    });
  }

  function photoById(id) { return photos.filter(function (p) { return p.id === id; })[0] || null; }
  function urlOfPhoto(id) { var p = photoById(id); return p && p.photo_url ? (urlCache[p.photo_url] || '') : ''; }
  function urlOfPath(path) { return path ? (urlCache[path] || '') : ''; }
  function slides(pprId) { return (slidesOf[pprId] || []).slice().sort(function (a, b) { return (a.slide_no || 0) - (b.slide_no || 0); }); }
  function pprById(id) { return pprs.filter(function (p) { return p.id === id; })[0] || null; }

  // ---------------------------------------------------------------- render ---
  function render() {
    $('ppr-listbar').style.display = screen === 'list' ? '' : 'none';
    syncTools(true);
    if (screen === 'slides') renderSlides(); else renderList();
    if (window.Icons && Icons.hydrate) Icons.hydrate($('ppr-view'));
  }

  // The topbar tools follow the PPR screen's own state: "+ New PPR" belongs to
  // the list, "PPR list" (back) belongs to the slides view. `visible` is false
  // while the Photos screen is showing, which hides both.
  function syncTools(visible) {
    var back = $('ppr-back'), neu = $('ppr-new');
    if (back) back.style.display = (visible && screen === 'slides') ? '' : 'none';
    if (neu) neu.style.display = (visible && screen === 'list' && canWrite) ? '' : 'none';
  }

  function visiblePprs() {
    return pprs.filter(function (p) {
      if (filters.from && (!p.ppr_date || p.ppr_date < filters.from)) return false;
      if (filters.to && (!p.ppr_date || p.ppr_date > filters.to)) return false;
      return true;
    });
  }

  function renderList() {
    var host = $('ppr-view');
    var list = visiblePprs();

    if (!pprs.length) {
      host.innerHTML = '<div class="pp-empty">' +
        '<span data-ico="clipboard" data-ico-size="34"></span>' +
        '<p>No PPR presentations yet for this project.</p>' +
        (canWrite ? '<p class="pp-hint">Use <strong>+ New PPR</strong> to create one, then add ' +
                    'before/after slides from the Photos Database.</p>' : '') +
        '</div>';
      return;
    }

    var rows = list.map(function (p) {
      var n = slides(p.id).length;
      return '<div class="ppr-row' + (p.id === selId ? ' sel' : '') + '" data-id="' + p.id + '">' +
        '<div class="ppr-cell ppr-date">' + esc(longDate(p.ppr_date)) + '</div>' +
        '<div class="ppr-cell">' + esc(p.description || '—') + '</div>' +
        '<div class="ppr-cell ppr-num">' + n + '</div>' +
        '<div class="ppr-cell ppr-acts">' +
          '<button class="pp-iconbtn" data-act="download" data-id="' + p.id + '" ' +
            'title="Download an offline copy of this PPR">' +
            '<span data-ico="download" data-ico-size="15"></span></button>' +
          '<button class="pp-iconbtn" data-act="open" data-id="' + p.id + '" title="Open slides">' +
            '<span data-ico="arrowRight" data-ico-size="15"></span></button>' +
          (canWrite ? '<button class="pp-iconbtn" data-act="edit" data-id="' + p.id + '" title="Edit PPR details">✎</button>' +
                      '<button class="pp-iconbtn pp-del" data-act="del" data-id="' + p.id + '" title="Delete PPR">' +
                      '<span data-ico="trash" data-ico-size="15"></span></button>' : '') +
        '</div></div>';
    }).join('');

    var table = '<div class="ppr-table">' +
      '<div class="ppr-head"><div>PPR Date</div><div>Description</div>' +
      '<div class="ppr-num">No. of Slides</div><div></div></div>' +
      (list.length ? rows : '<div class="pp-empty" style="border:0;">No PPRs in this date range.</div>') +
      '</div>';

    host.innerHTML = '<div class="ppr-split">' + table +
      '<div class="ppr-preview"><div class="ppr-preview-head">Preview</div>' +
      '<div id="ppr-preview-body"></div></div></div>';

    Array.prototype.forEach.call(host.querySelectorAll('.ppr-row'), function (r) {
      r.onclick = function () { selId = r.dataset.id; renderList(); };
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-act]'), function (el) {
      el.onclick = function (e) {
        e.stopPropagation();
        var p = pprById(el.dataset.id); if (!p) return;
        var a = el.dataset.act;
        if (a === 'open') { viewPprId = p.id; slideAt = 0; screen = 'slides'; render(); }
        else if (a === 'download') exportOffline(p);
        else if (a === 'edit') openPprForm(p);
        else if (a === 'del') removePpr(p);
      };
    });
    renderPreview();
  }

  function renderPreview() {
    var body = $('ppr-preview-body'); if (!body) return;
    var s = selId ? slides(selId) : [];
    if (!selId || !s.length) {
      body.innerHTML = '<div class="ppr-noslides">' +
        (selId ? 'No slides to show.' : 'Select a PPR to preview its slides.') + '</div>';
      return;
    }
    body.innerHTML = '<div class="ppr-thumbs">' + s.map(function (sl, i) {
      // The preview shows the "after" (this month's) photo — the slide's headline image.
      var u = urlOfPhoto(sl.after_photo_id) || urlOfPhoto(sl.before_photo_id);
      return '<div class="ppr-thumbwrap">' +
        '<span class="ppr-thumbno">' + (i + 1) + '</span>' +
        (u ? '<img class="ppr-thumb" src="' + esc(u) + '" alt="Slide ' + (i + 1) + '" ' +
             'data-slide="' + i + '" />'
           : '<div class="ppr-thumb pp-noimg"><span data-ico="camera" data-ico-size="16"></span></div>') +
        '</div>';
    }).join('') + '</div>';

    Array.prototype.forEach.call(body.querySelectorAll('[data-slide]'), function (im) {
      im.onclick = function () {
        viewPprId = selId; slideAt = +im.dataset.slide; screen = 'slides'; render();
      };
    });
    if (window.Icons && Icons.hydrate) Icons.hydrate(body);
  }

  // ---------------------------------------------------- slides view/editor ---
  function renderSlides() {
    var host = $('ppr-view');
    var p = pprById(viewPprId);
    if (!p) { screen = 'list'; renderList(); return; }
    var s = slides(p.id);
    if (slideAt >= s.length) slideAt = Math.max(0, s.length - 1);
    var cur = s[slideAt];

    var header =
      '<div class="ppr-slidehead">' +
        '<div class="ppr-hfield"><label>PPR Project</label><span>' + esc(projName || pid) + '</span></div>' +
        '<div class="ppr-hfield"><label>PPR Meeting Date</label><span>' + esc(longDate(p.ppr_date)) + '</span></div>' +
        '<div class="ppr-hfield"><label>PPR Description</label><span>' + esc(p.description || '—') + '</span></div>' +
        '<div class="ppr-hfield"><label>Slides</label><span class="ppr-nav">' +
          '<button class="ppr-navbtn" id="ppr-prev" ' + (slideAt <= 0 ? 'disabled' : '') + '>‹</button>' +
          '<strong>' + (s.length ? slideAt + 1 : 0) + '</strong> of ' + s.length +
          '<button class="ppr-navbtn" id="ppr-next" ' + (slideAt >= s.length - 1 ? 'disabled' : '') + '>›</button>' +
        '</span></div>' +
      '</div>';

    if (!s.length) {
      host.innerHTML = header + '<div class="pp-empty"><p>This PPR has no slides yet.</p>' +
        (canWrite ? '<p class="pp-hint">Add a slide by pairing last month\'s photo with this ' +
                    'month\'s from the Photos Database.</p>' +
                    '<p><button class="pd-btn pd-btn-primary" id="ppr-slide-add">+ Add slide</button></p>'
                  : '') + '</div>';
      wireSlideNav(s);
      if ($('ppr-slide-add')) $('ppr-slide-add').onclick = function () { openSlideForm(null); };
      return;
    }

    var meta =
      '<div class="ppr-meta">' +
        '<div class="ppr-hfield"><label>Trade</label><span>' + esc(cur.trade || '—') + '</span></div>' +
        '<div class="ppr-hfield"><label>Works</label><span>' + esc(cur.works || '—') + '</span></div>' +
        '<div class="ppr-hfield"><label>Location</label><span>' + esc(cur.location || '—') + '</span></div>' +
        '<div class="ppr-hfield"><label>Key Plan</label>' +
          (cur.key_plan_url
            ? '<button class="ppr-kpbtn" id="ppr-kp" title="Toggle the key plan overlay">' +
              (keyPlanOpen ? '⤡' : '⤢') + '</button>'
            : '<span class="ppr-kpnone">—</span>') +
        '</div>' +
      '</div>';

    host.innerHTML = header + meta +
      '<div class="ppr-pair">' + pane(cur, 'before') + pane(cur, 'after') + '</div>' +
      (canWrite ? '<div class="ppr-slideacts">' +
        '<button class="pd-btn pd-btn-primary" id="ppr-slide-add">+ Add slide</button>' +
        '<button class="pd-btn" id="ppr-slide-edit">Edit slide</button>' +
        '<button class="pd-btn pd-btn-danger" id="ppr-slide-del">Delete slide</button></div>' : '');

    wireSlideNav(s);
    if ($('ppr-slide-add')) $('ppr-slide-add').onclick = function () { openSlideForm(null); };
    var kp = $('ppr-kp');
    if (kp) kp.onclick = function () { keyPlanOpen = !keyPlanOpen; renderSlides(); };
    if ($('ppr-slide-edit')) $('ppr-slide-edit').onclick = function () { openSlideForm(cur); };
    if ($('ppr-slide-del')) $('ppr-slide-del').onclick = function () { removeSlide(cur); };
    if (window.Icons && Icons.hydrate) Icons.hydrate(host);
  }

  function pane(sl, which) {
    var pid_ = which === 'before' ? sl.before_photo_id : sl.after_photo_id;
    var ph = photoById(pid_);
    var u = urlOfPhoto(pid_);
    var cap = (which === 'before' ? sl.before_caption : sl.after_caption) ||
              (ph ? ph.description : '') || '';
    var kp = keyPlanOpen && sl.key_plan_url ? urlOfPath(sl.key_plan_url) : '';
    return '<figure class="ppr-pane">' +
      '<div class="ppr-imgwrap">' +
        (u ? '<img class="ppr-img" src="' + esc(u) + '" alt="' + esc(cap) + '" />'
           : '<div class="ppr-img pp-noimg"><span>Photo not set</span></div>') +
        (kp ? '<img class="ppr-keyplan" src="' + esc(kp) + '" alt="Key plan" />' : '') +
      '</div>' +
      '<figcaption>' +
        '<div class="ppr-capdate">' + esc(ph && ph.taken_at ? capDate(ph.taken_at) : '—') + '</div>' +
        '<div class="ppr-captxt">' + esc(cap || '—') + '</div>' +
      '</figcaption></figure>';
  }

  function wireSlideNav(s) {
    if ($('ppr-prev')) $('ppr-prev').onclick = function () { if (slideAt > 0) { slideAt--; renderSlides(); } };
    if ($('ppr-next')) $('ppr-next').onclick = function () { if (slideAt < s.length - 1) { slideAt++; renderSlides(); } };
  }

  // ------------------------------------------------------------ PPR CRUD ----
  function openPprForm(p) {
    var isNew = !p; p = p || {};
    var html =
      '<div class="pd-modal-header"><h3>' + (isNew ? 'New PPR' : 'Edit PPR') + '</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form"><div class="pp-form2">' +
        '<div class="pd-field"><label>PPR meeting date</label>' +
          '<input class="pd-input" type="date" id="ppr-f-date" value="' + esc(p.ppr_date || '') + '" /></div>' +
        '<div class="pd-field"><label>Description</label>' +
          '<input class="pd-input" id="ppr-f-desc" placeholder="e.g. PPR ftm of June 2026" value="' +
          esc(p.description || '') + '" /></div>' +
      '</div></div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="ppr-f-save">Save</button></div>';
    var m = openModal(html, 520);
    $('ppr-f-save').onclick = async function () {
      var date = $('ppr-f-date').value;
      if (!date) { UI.toast('A PPR meeting date is required', 'warn'); return; }
      this.disabled = true;
      var data = { ppr_date: date, description: $('ppr-f-desc').value.trim() };
      var res;
      if (isNew) res = await sb().from(T_PPR).insert(Object.assign(data, { project_id: pid, created_by: uid }));
      else res = await sb().from(T_PPR).update(Object.assign(data, { updated_at: new Date().toISOString() })).eq('id', p.id);
      if (res.error) { UI.toast(res.error.message, 'error'); this.disabled = false; return; }
      m.close(); UI.toast(isNew ? 'PPR created' : 'PPR updated', 'ok');
      await load();
    };
  }

  async function removePpr(p) {
    var n = slides(p.id).length;
    var html =
      '<div class="pd-modal-header"><h3>Delete PPR</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form"><p>Delete <strong>' + esc(p.description || longDate(p.ppr_date)) +
        '</strong> and its <strong>' + n + '</strong> slide' + (n === 1 ? '' : 's') + '?</p>' +
        '<p class="pp-hint">The photos themselves stay in the Photos Database — only the ' +
        'presentation and its slide pairings are removed.</p></div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-danger" id="ppr-d-yes">Delete</button></div>';
    var m = openModal(html, 460);
    $('ppr-d-yes').onclick = async function () {
      this.disabled = true;
      // ppr_slides.ppr_id is ON DELETE CASCADE, so the slides go with it.
      var res = await sb().from(T_PPR).delete().eq('id', p.id);
      if (res.error) { UI.toast(res.error.message, 'error'); this.disabled = false; return; }
      m.close(); UI.toast('PPR deleted', 'ok');
      if (selId === p.id) selId = null;
      await load();
    };
  }

  // ----------------------------------------------------------- slide CRUD ---
  // Photo pickers are populated from the project's own library (contract: the
  // Photos Database is the single source of truth for imagery).
  function photoOptions(sel) {
    return '<option value="">— none —</option>' + photos.map(function (p) {
      var label = [p.description || '(no description)', p.location, capDate(p.taken_at)]
        .filter(Boolean).join(' · ');
      return '<option value="' + esc(p.id) + '"' + (sel === p.id ? ' selected' : '') + '>' +
             esc(label) + '</option>';
    }).join('');
  }

  function openSlideForm(sl) {
    var isNew = !sl; sl = sl || {};
    var p = pprById(viewPprId);
    var trades = ProgressPhotos.trades();
    var html =
      '<div class="pd-modal-header"><h3>' + (isNew ? 'Add slide' : 'Edit slide') + '</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        '<p class="pp-hint">A slide pairs <strong>last month\'s</strong> photo with ' +
          '<strong>this month\'s</strong> at the same location. Both come from the Photos ' +
          'Database — upload there first if a shot is missing.</p>' +
        '<div class="pp-form2">' +
          '<div class="pd-field"><label>Trade</label><select class="pd-select" id="ppr-s-trade">' +
            '<option value="">—</option>' + trades.map(function (t) {
              return '<option' + (sl.trade === t ? ' selected' : '') + '>' + esc(t) + '</option>';
            }).join('') + '</select></div>' +
          '<div class="pd-field"><label>Works</label>' +
            '<input class="pd-input" id="ppr-s-works" list="pp-works-list" value="' + esc(sl.works || '') + '" /></div>' +
          '<div class="pd-field pp-span2"><label>Location</label>' +
            '<input class="pd-input" id="ppr-s-loc" value="' + esc(sl.location || '') + '" /></div>' +
          '<div class="pd-field pp-span2"><label>Before photo (previous month)</label>' +
            '<select class="pd-select" id="ppr-s-before">' + photoOptions(sl.before_photo_id) + '</select></div>' +
          '<div class="pd-field pp-span2"><label>Before caption</label>' +
            '<input class="pd-input" id="ppr-s-bcap" placeholder="e.g. Aerial View facing Marikina River ftm of May 2026." value="' +
            esc(sl.before_caption || '') + '" /></div>' +
          '<div class="pd-field pp-span2"><label>After photo (this month)</label>' +
            '<select class="pd-select" id="ppr-s-after">' + photoOptions(sl.after_photo_id) + '</select></div>' +
          '<div class="pd-field pp-span2"><label>After caption</label>' +
            '<input class="pd-input" id="ppr-s-acap" placeholder="e.g. Aerial View facing Marikina River ftm of June 2026." value="' +
            esc(sl.after_caption || '') + '" /></div>' +
          '<div class="pd-field pp-span2"><label>Key plan' +
            (sl.key_plan_url ? ' <span class="pp-hint">(replacing the current one)</span>' : '') +
            '</label><input class="pd-input" type="file" id="ppr-s-kp" accept="image/*" /></div>' +
        '</div>' +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="ppr-s-save">Save</button></div>';

    var m = openModal(html, 640);

    // Picking a photo pre-fills the slide's tags from that photo — the library
    // already carries trade/works/location, so don't make anyone retype them.
    $('ppr-s-after').onchange = function () {
      var ph = photoById(this.value); if (!ph) return;
      if (!$('ppr-s-trade').value) $('ppr-s-trade').value = ph.trade || '';
      if (!$('ppr-s-works').value) $('ppr-s-works').value = ph.works || '';
      if (!$('ppr-s-loc').value)   $('ppr-s-loc').value   = ph.location || '';
      if (!$('ppr-s-acap').value)  $('ppr-s-acap').value  = ph.description || '';
    };
    $('ppr-s-before').onchange = function () {
      var ph = photoById(this.value); if (!ph) return;
      if (!$('ppr-s-bcap').value) $('ppr-s-bcap').value = ph.description || '';
    };

    $('ppr-s-save').onclick = async function () {
      this.disabled = true;
      var data = {
        trade: $('ppr-s-trade').value || null,
        works: $('ppr-s-works').value.trim() || null,
        location: $('ppr-s-loc').value.trim() || null,
        before_photo_id: $('ppr-s-before').value || null,
        after_photo_id: $('ppr-s-after').value || null,
        before_caption: $('ppr-s-bcap').value.trim() || null,
        after_caption: $('ppr-s-acap').value.trim() || null
      };
      try {
        var f = $('ppr-s-kp').files;
        if (f && f[0]) data.key_plan_url = await uploadKeyPlan(f[0]);
      } catch (err) {
        UI.toast('Key plan upload failed: ' + (err.message || err), 'error');
        this.disabled = false; return;
      }
      var res;
      if (isNew) {
        var n = slides(viewPprId).length;
        res = await sb().from(T_SLIDE).insert(Object.assign(data, {
          ppr_id: viewPprId, project_id: pid, created_by: uid, slide_no: n + 1
        }));
      } else {
        res = await sb().from(T_SLIDE)
          .update(Object.assign(data, { updated_at: new Date().toISOString() })).eq('id', sl.id);
      }
      if (res.error) { UI.toast(res.error.message, 'error'); this.disabled = false; return; }
      m.close(); UI.toast(isNew ? 'Slide added' : 'Slide updated', 'ok');
      await load();
      screen = 'slides'; render();
    };
  }

  async function uploadKeyPlan(file) {
    var safe = file.name.replace(/[^\w.\-]+/g, '_');
    var path = pid + '/keyplans/' + Date.now() + '_' + safe;
    var res = await sb().storage.from(BUCKET).upload(path, file, { upsert: false });
    if (res.error) throw res.error;
    return path;
  }

  async function removeSlide(sl) {
    var html =
      '<div class="pd-modal-header"><h3>Delete slide</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form"><p>Delete slide <strong>' + (slideAt + 1) + '</strong> (' +
        esc(sl.location || 'no location') + ')? The photos stay in the Photos Database.</p></div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-danger" id="ppr-sd-yes">Delete</button></div>';
    var m = openModal(html, 460);
    $('ppr-sd-yes').onclick = async function () {
      this.disabled = true;
      var res = await sb().from(T_SLIDE).delete().eq('id', sl.id);
      if (res.error) { UI.toast(res.error.message, 'error'); this.disabled = false; return; }
      if (sl.key_plan_url) { try { await sb().storage.from(BUCKET).remove([sl.key_plan_url]); } catch (e) {} }
      m.close(); UI.toast('Slide deleted', 'ok');
      await load();
      screen = 'slides'; slideAt = Math.max(0, slideAt - 1); render();
    };
  }

  // ------------------------------------------------- offline export (.html) --
  // Why a self-contained file: a PPR is presented in a meeting where the photo
  // library may load slowly (connectivity, or sheer volume of photos). Every
  // image is inlined as a downscaled data URI, so the file opens instantly with
  // no network and no dependency on Supabase being reachable.
  var MAXW = 1600, JPEG_Q = 0.82;

  async function toDataURL(url) {
    var resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var blob = await resp.blob();
    var img = await blobToImage(blob);
    // Downscale: full-resolution site photos would make the file huge and slow
    // to open — the opposite of the point.
    var scale = Math.min(1, MAXW / (img.naturalWidth || MAXW));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((img.naturalWidth || MAXW) * scale));
    c.height = Math.max(1, Math.round((img.naturalHeight || MAXW) * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', JPEG_Q);
  }
  function blobToImage(blob) {
    return new Promise(function (resolve, reject) {
      var u = URL.createObjectURL(blob);
      var im = new Image();
      im.onload = function () { URL.revokeObjectURL(u); resolve(im); };
      im.onerror = function () { URL.revokeObjectURL(u); reject(new Error('decode failed')); };
      im.src = u;
    });
  }

  async function exportOffline(p) {
    var s = slides(p.id);
    if (!s.length) { UI.toast('This PPR has no slides to export', 'warn'); return; }

    var m = openModal(
      '<div class="pd-modal-header"><h3>Preparing offline copy</h3></div>' +
      '<div class="pp-form"><p id="ppr-x-msg">Embedding images…</p>' +
      '<p class="pp-hint">Every photo is embedded in the file so it opens without a network ' +
      'connection. Large PPRs take a moment.</p></div>', 480);
    var msg = $('ppr-x-msg');

    var imgs = {}, failed = 0, step = 0;
    var jobs = [];
    s.forEach(function (sl) {
      [sl.before_photo_id, sl.after_photo_id].forEach(function (id) {
        var u = urlOfPhoto(id); if (u && !imgs[u]) jobs.push(u);
      });
      var k = urlOfPath(sl.key_plan_url); if (k) jobs.push(k);
    });
    jobs = jobs.filter(function (u, i) { return jobs.indexOf(u) === i; });

    for (var i = 0; i < jobs.length; i++) {
      msg.textContent = 'Embedding image ' + (i + 1) + ' of ' + jobs.length + '…';
      try { imgs[jobs[i]] = await toDataURL(jobs[i]); }
      catch (e) { failed++; console.warn('PPR: could not embed an image —', e && e.message); }
      await new Promise(function (r) { setTimeout(r, 0); });
      step++;
    }

    msg.textContent = 'Building file…';
    var html = offlineHTML(p, s, imgs);
    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'PPR ' + (projName || pid) + ' ' + (p.ppr_date || '') + '.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);

    m.close();
    var mb = (blob.size / 1048576).toFixed(1);
    UI.toast('Offline copy downloaded (' + mb + ' MB)' +
      (failed ? ' — ' + failed + ' image(s) could not be embedded' : ''), failed ? 'warn' : 'ok');
  }

  // A standalone page: inline CSS, inline images, no scripts, no external refs.
  function offlineHTML(p, s, imgs) {
    function im(url, cls, alt) {
      var d = url ? imgs[url] : '';
      return d ? '<img class="' + cls + '" src="' + d + '" alt="' + esc(alt || '') + '" />'
               : '<div class="' + cls + ' missing">Image unavailable</div>';
    }
    var slidesHTML = s.map(function (sl, i) {
      var bp = photoById(sl.before_photo_id), ap = photoById(sl.after_photo_id);
      var kp = urlOfPath(sl.key_plan_url);
      return '<section class="slide">' +
        '<div class="meta"><span class="no">Slide ' + (i + 1) + ' of ' + s.length + '</span>' +
          '<span><b>Trade</b> ' + esc(sl.trade || '—') + '</span>' +
          '<span><b>Works</b> ' + esc(sl.works || '—') + '</span>' +
          '<span><b>Location</b> ' + esc(sl.location || '—') + '</span></div>' +
        (kp && imgs[kp] ? '<div class="kp"><b>Key Plan</b><br>' + im(kp, 'kpimg', 'Key plan') + '</div>' : '') +
        '<div class="pair">' +
          '<figure>' + im(urlOfPhoto(sl.before_photo_id), 'ph', sl.before_caption) +
            '<figcaption><div class="d">' + esc(bp && bp.taken_at ? capDate(bp.taken_at) : '—') + '</div>' +
            '<div class="c">' + esc(sl.before_caption || (bp && bp.description) || '') + '</div></figcaption></figure>' +
          '<figure>' + im(urlOfPhoto(sl.after_photo_id), 'ph', sl.after_caption) +
            '<figcaption><div class="d">' + esc(ap && ap.taken_at ? capDate(ap.taken_at) : '—') + '</div>' +
            '<div class="c">' + esc(sl.after_caption || (ap && ap.description) || '') + '</div></figcaption></figure>' +
        '</div></section>';
    }).join('');

    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />' +
      '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
      '<title>PPR ' + esc(projName || pid) + ' — ' + esc(longDate(p.ppr_date)) + '</title><style>' +
      'body{margin:0;font-family:Montserrat,Segoe UI,Arial,sans-serif;color:#231F20;background:#F4F4F4}' +
      'header{background:#EE3124;color:#fff;padding:16px 22px}' +
      'header h1{margin:0;font-size:19px;letter-spacing:.02em}' +
      'header p{margin:4px 0 0;font-size:13px;opacity:.92}' +
      '.wrap{max-width:1180px;margin:0 auto;padding:18px}' +
      '.slide{background:#fff;border:1px solid #DCDBDB;border-radius:4px;padding:14px;margin-bottom:16px;position:relative}' +
      '.meta{display:flex;flex-wrap:wrap;gap:18px;font-size:13px;margin-bottom:10px;align-items:baseline}' +
      '.meta .no{font-weight:700;color:#EE3124}' +
      '.meta b{color:#6b6b6b;font-weight:600;margin-right:4px}' +
      '.kp{position:absolute;top:14px;right:14px;font-size:11px;color:#6b6b6b;text-align:right}' +
      '.kpimg{width:190px;border:1px solid #DCDBDB;margin-top:3px;display:block}' +
      '.pair{display:grid;grid-template-columns:1fr 1fr;gap:14px}' +
      'figure{margin:0}' +
      '.ph{width:100%;display:block;border:1px solid #DCDBDB;background:#F4F4F4}' +
      '.missing{padding:40px;text-align:center;color:#9a9a9a;font-size:13px}' +
      'figcaption{text-align:center;margin-top:6px}' +
      'figcaption .d{font-size:13px}' +
      'figcaption .c{font-style:italic;font-size:12.5px;color:#4a4a4a;margin-top:2px}' +
      'footer{text-align:center;font-size:11.5px;color:#6b6b6b;padding:6px 0 22px}' +
      '@media print{body{background:#fff}.slide{page-break-after:always;border:0}}' +
      '@media (max-width:820px){.pair{grid-template-columns:1fr}.kp{position:static;text-align:left}}' +
      '</style></head><body>' +
      '<header><h1>' + esc(projName || pid) + ' — Progress Photos</h1>' +
      '<p>' + esc(p.description || '') + ' · PPR Meeting Date: ' + esc(longDate(p.ppr_date)) +
      ' · ' + s.length + ' slide' + (s.length === 1 ? '' : 's') + '</p></header>' +
      '<div class="wrap">' + slidesHTML + '</div>' +
      '<footer>Offline copy generated ' + esc(longDate(new Date().toISOString().slice(0, 10))) +
      ' from the Planners Dashboard · Megawide Construction Corporation</footer>' +
      '</body></html>';
  }

  return {
    init: init,
    _syncTools: syncTools,
    _addSlide: function () { openSlideForm(null); },
    _screen: function () { return screen; }
  };
})();
