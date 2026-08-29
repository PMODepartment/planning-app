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
  var T_TMPL   = 'ppr_report_templates';
  var BUCKET   = 'progress-photos';
  var SIGN_TTL = 3600;

  var profile = null, uid = null, pid = null, projName = '';
  var canWrite = false;
  var pprs = [];                 // presentations for this project
  var slidesOf = {};             // ppr_id -> [slide]
  var photos = [];               // the project's photo library (for picking)
  var templates = [];            // saved report templates for this project
  var tmplTableMissing = false;  // migrations/2026-08-29-ppr-report-templates.sql not run yet
  var urlCache = {};             // storage path -> signed URL
  var selId = null;              // selected PPR (drives the preview pane)
  var filters = { from: '', to: '' };
  var screen = 'list';           // list | slides | templates
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
    $('ppr-clearfilters').onclick = function () {
      filters = { from: '', to: '' };
      ['from', 'to'].forEach(function (k) { var el = $('ppr-f-' + k); if (el) el.value = ''; });
      renderList();
    };
    $('ppr-new').onclick = function () { openPprForm(null); };
    $('ppr-back').onclick = function () { screen = 'list'; render(); };
    if ($('ppr-templates')) $('ppr-templates').onclick = function () { screen = 'templates'; render(); };
    if ($('ppr-tmpl-new')) $('ppr-tmpl-new').onclick = function () { openTemplateForm(null); };
  }

  // ------------------------------------------------------------------ load ---
  async function load() {
    var host = $('ppr-view');
    if (!pid) { host.innerHTML = '<div class="pp-empty">Select a project.</div>'; return; }
    host.innerHTML = '<div class="pp-empty">Loading PPRs…</div>';

    // ⚠️ All three reads are keyset-paginated. The photo library in particular routinely exceeds
    // PostgREST's 1000-row server cap — module.js's own load() has paginated for exactly that reason
    // since 2026-07-21, but this one did not, so the slide picker silently could not SEE any photo
    // past the first 1000 and a slide referencing one rendered as an empty frame. Slides and PPRs
    // accumulate over years, so they get the same treatment rather than waiting to break later.
    // PDb.selectAll returns id order — the display sorts below are re-applied in memory.
    try {
      pprs = await PDb.selectAll(T_PPR, function (q) { return q.eq('project_id', pid); });
    } catch (e) { host.innerHTML = ''; UI.toast(e.message || String(e), 'error'); return; }
    pprs.sort(function (a, b) { return String(b.ppr_date || '').localeCompare(String(a.ppr_date || '')); });

    var slides;
    try {
      slides = await PDb.selectAll(T_SLIDE, function (q) { return q.eq('project_id', pid); });
    } catch (e) { host.innerHTML = ''; UI.toast(e.message || String(e), 'error'); return; }
    slidesOf = {};
    slides.forEach(function (s) {
      (slidesOf[s.ppr_id] = slidesOf[s.ppr_id] || []).push(s);
    });
    Object.keys(slidesOf).forEach(function (k) {
      slidesOf[k].sort(function (a, b) { return (a.slide_no || 0) - (b.slide_no || 0); });
    });

    try {
      photos = await PDb.selectAll(T_PHOTO, function (q) { return q.eq('project_id', pid); });
      photos.sort(function (a, b) { return String(b.taken_at || '').localeCompare(String(a.taken_at || '')); });
    } catch (e) { photos = []; }

    await loadTemplates();
    await signAll();
    render();
  }

  // Tolerant of the migration not having run yet — same convention as every
  // other optional table this module reads (e.g. location_levels). Templates
  // are a management concern of the Presentations screen, so they load alongside
  // everything else rather than lazily on first visit to that screen.
  async function loadTemplates() {
    tmplTableMissing = false;
    try {
      templates = await PDb.selectAll(T_TMPL, function (q) { return q.eq('project_id', pid); });
      templates.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
    } catch (e) {
      templates = [];
      if (/schema cache|does not exist/i.test((e && e.message) || '')) tmplTableMissing = true;
    }
  }

  // Every image on screen (photos + key plans) signed in one round-trip.
  async function signAll() {
    urlCache = {};
    var paths = {};
    // Key plans now live on the PHOTO (progress_photos.key_plan_url); the legacy
    // slide-level key_plan_url is still signed so pre-migration PPRs render.
    photos.forEach(function (p) {
      if (p.photo_url) paths[p.photo_url] = 1;
      if (p.key_plan_url) paths[p.key_plan_url] = 1;
    });
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
  function tmplById(id) { return templates.filter(function (t) { return t.id === id; })[0] || null; }

  // Every photo AT (a superset of) this set of location values, newest first.
  // Same subset-equality rule as module.js's resolveActivity()/lastCaptureAt()
  // — restated here rather than shared, because this file holds its own
  // independently-loaded copy of the photo library (established pattern:
  // module.js and ppr.js each load progress_photos on their own).
  function photosAtLocation(values) {
    var keys = Object.keys(values || {}).filter(function (k) { return values[k]; });
    if (!keys.length) return [];
    return photos.filter(function (p) {
      var lv = p.location_values || {};
      return keys.every(function (k) { return (lv[k] || '') === values[k]; });
    }).sort(function (a, b) { return String(b.taken_at || '').localeCompare(String(a.taken_at || '')); });
  }

  // The universe of locations a template can be built from: everywhere the
  // SCHEDULE says work is happening, unioned with everywhere a PHOTO has
  // already been captured. Schedule-derived wins on a key collision (it's the
  // more current source); photo-only locations fill in what the schedule
  // doesn't (or no longer) know about, e.g. a completed zone already dropped
  // from the schedule, or a shot taken before its zone existed there.
  function allLocationCombos() {
    var byKey = {};
    (window.ProgressPhotos && ProgressPhotos.locCombos ? ProgressPhotos.locCombos() : [])
      .forEach(function (c) { byKey[c.key] = c; });
    (window.ProgressPhotos && ProgressPhotos.photoLocCombos ? ProgressPhotos.photoLocCombos() : [])
      .forEach(function (c) { if (!byKey[c.key]) byKey[c.key] = c; });
    return Object.keys(byKey).map(function (k) { return byKey[k]; })
      .sort(function (a, b) { return a.label.localeCompare(b.label); });
  }

  // ---------------------------------------------------------------- render ---
  function hydrate() { if (window.Icons && Icons.hydrate) Icons.hydrate($('ppr-view')); }

  function render() {
    // Filters + count belong to the list only — the slides/templates views are
    // each their own screen.
    $('ppr-listbar').style.display = screen === 'list' ? '' : 'none';
    $('ppr-countbar').style.display = screen === 'list' ? '' : 'none';
    if ($('ppr-tmpl-wrap')) $('ppr-tmpl-wrap').hidden = screen !== 'templates';
    if ($('ppr-view')) $('ppr-view').hidden = screen === 'templates';
    syncTools(true);
    if (screen === 'slides') renderSlides();
    else if (screen === 'templates') renderTemplates();
    else renderList();
  }

  // The topbar tools follow the Presentations screen's own state: "+ New Presentation"
  // and "Templates" belong to the list, "Presentations list" (back) belongs to the
  // slides/templates views, "+ New template" belongs to the templates view.
  // `visible` is false while the Photos screen is showing, which hides all of
  // them — they never share a row with each other, so no divider is needed.
  function syncTools(visible) {
    var back = $('ppr-back'), neu = $('ppr-new'), tmplBtn = $('ppr-templates'), tmplNew = $('ppr-tmpl-new');
    var onList = screen === 'list', onTmpl = screen === 'templates';
    if (back) back.style.display = (visible && (screen === 'slides' || onTmpl)) ? '' : 'none';
    if (neu) neu.style.display = (visible && onList && canWrite) ? '' : 'none';
    if (tmplBtn) tmplBtn.style.display = (visible && onList) ? '' : 'none';
    if (tmplNew) tmplNew.style.display = (visible && onTmpl && canWrite) ? '' : 'none';
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

    var count = $('ppr-count');
    if (count) {
      count.textContent = pprs.length
        ? 'Showing ' + list.length + ' of ' + pprs.length + ' PPR' + (pprs.length === 1 ? '' : 's')
        : '';
    }
    $('ppr-countbar').style.visibility = pprs.length ? '' : 'hidden';

    var clr = $('ppr-clearfilters');
    if (clr) clr.hidden = !(filters.from || filters.to);

    if (!pprs.length) {
      host.innerHTML = '<div class="pp-empty">' +
        '<span data-ico="clipboard" data-ico-size="34"></span>' +
        '<p>No presentations yet for this project.</p>' +
        (canWrite ? '<p class="pp-hint">Use <strong>+ New Presentation</strong> to create one, then add ' +
                    'previous/current slides from the Photos Database.</p>' : '') +
        '</div>';
      hydrate();
      return;
    }

    var rows = list.map(function (p) {
      var n = slides(p.id).length;
      return '<div class="ppr-row' + (p.id === selId ? ' sel' : '') + '" data-id="' + p.id + '" ' +
        'title="Open this presentation\'s slides">' +
        '<div class="ppr-cell ppr-date">' + esc(longDate(p.ppr_date)) + '</div>' +
        '<div class="ppr-cell">' + esc(p.description || '—') + '</div>' +
        '<div class="ppr-cell ppr-num">' + n + '</div>' +
        '<div class="ppr-cell ppr-acts">' +
          '<button class="pp-iconbtn" data-act="download" data-id="' + p.id + '" ' +
            'title="Download an offline copy of this presentation (opens with no network)">' +
            '<span data-ico="download" data-ico-size="15"></span></button>' +
          '<button class="pp-iconbtn" data-act="pdf" data-id="' + p.id + '" title="Download as PDF">' +
            '<span data-ico="clipboard" data-ico-size="15"></span></button>' +
          '<button class="pp-iconbtn" data-act="pptx" data-id="' + p.id + '" title="Download as PowerPoint (.pptx)">' +
            '<span data-ico="layers" data-ico-size="15"></span></button>' +
          '<button class="pp-iconbtn" data-act="open" data-id="' + p.id + '" title="Open slides">' +
            '<span data-ico="arrowRight" data-ico-size="15"></span></button>' +
          (canWrite ? '<button class="pp-iconbtn" data-act="edit" data-id="' + p.id + '" title="Edit presentation details">' +
                      '<span data-ico="pencil" data-ico-size="15"></span></button>' +
                      '<button class="pp-iconbtn pp-del" data-act="del" data-id="' + p.id + '" title="Delete presentation">' +
                      '<span data-ico="trash" data-ico-size="15"></span></button>' : '') +
        '</div></div>';
    }).join('');

    var table = '<div class="ppr-table">' +
      '<div class="ppr-head"><div>Presentation Date</div><div>Description</div>' +
      '<div class="ppr-num">No. of Slides</div><div></div></div>' +
      (list.length ? rows : '<div class="pp-empty" style="border:0;">No presentations in this date range.</div>') +
      '</div>';

    host.innerHTML = '<div class="ppr-split">' + table +
      '<div class="ppr-preview"><div class="ppr-preview-head">Preview</div>' +
      '<div id="ppr-preview-body"></div></div></div>';

    // Clicking anywhere on the row OPENS the presentation (owner feedback: no need to
    // press an icon just to open it). Selecting-without-opening is no longer a
    // separate gesture — the preview pane is driven by whatever is open, and
    // hovering a row is enough to see its slide count in the list itself.
    Array.prototype.forEach.call(host.querySelectorAll('.ppr-row'), function (r) {
      r.onclick = function () { openPpr(r.dataset.id); };
    });
    Array.prototype.forEach.call(host.querySelectorAll('[data-act]'), function (el) {
      el.onclick = function (e) {
        e.stopPropagation();
        var p = pprById(el.dataset.id); if (!p) return;
        var a = el.dataset.act;
        if (a === 'open') openPpr(p.id);
        else if (a === 'download') exportOffline(p);
        else if (a === 'pdf') exportPdf(p);
        else if (a === 'pptx') exportPptx(p);
        else if (a === 'edit') openPprForm(p);
        else if (a === 'del') removePpr(p);
      };
    });
    renderPreview();
    // ⚠️ hydrate() must happen HERE, not only in render(): renderList() is called
    // DIRECTLY by the date filters, the clear-filters button and (previously) the
    // row click, all of which bypass render(). That's why the download / open /
    // delete icons were reported missing — the markup was correct, but the
    // `data-ico` placeholders were never swapped for SVG on those paths.
    hydrate();
  }

  function openPpr(id) {
    var p = pprById(id); if (!p) return;
    selId = id; viewPprId = id; slideAt = 0; keyPlanOpen = false;
    screen = 'slides';
    render();
  }

  function renderPreview() {
    var body = $('ppr-preview-body'); if (!body) return;
    var s = selId ? slides(selId) : [];
    if (!selId || !s.length) {
      body.innerHTML = '<div class="ppr-noslides">' +
        (selId ? 'No slides to show.' : 'Select a presentation to preview its slides.') + '</div>';
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
        var at = +im.dataset.slide;
        openPpr(selId); slideAt = at; renderSlides();
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
        '<div class="ppr-hfield"><label>Project</label><span>' + esc(projName || pid) + '</span></div>' +
        '<div class="ppr-hfield"><label>Presentation Date</label><span>' + esc(longDate(p.ppr_date)) + '</span></div>' +
        '<div class="ppr-hfield"><label>Description</label><span>' + esc(p.description || '—') + '</span></div>' +
        '<div class="ppr-hfield"><label>Slides</label><span class="ppr-nav">' +
          '<button class="ppr-navbtn" id="ppr-prev" ' + (slideAt <= 0 ? 'disabled' : '') + '>‹</button>' +
          '<strong>' + (s.length ? slideAt + 1 : 0) + '</strong> of ' + s.length +
          '<button class="ppr-navbtn" id="ppr-next" ' + (slideAt >= s.length - 1 ? 'disabled' : '') + '>›</button>' +
        '</span></div>' +
      '</div>';

    if (!s.length) {
      host.innerHTML = header + '<div class="pp-empty"><p>This presentation has no slides yet.</p>' +
        (canWrite ? '<p class="pp-hint">Add a slide by picking this period\'s photo, optionally ' +
                    'paired with an earlier one to compare against.</p>' +
                    '<p><button class="pd-btn pd-btn-primary" id="ppr-slide-add">+ Add slide</button></p>'
                  : '') + '</div>';
      wireSlideNav(s);
      if ($('ppr-slide-add')) $('ppr-slide-add').onclick = function () { openSlideForm(null); };
      return;
    }

    // ⚠️ Trade / Works / Location are NO LONGER slide-level. A slide's two photos
    // may sit at DIFFERENT locations (owner feedback), so a single slide-wide
    // location was actively wrong — each pane now shows its own photo's tags,
    // read straight from progress_photos. `cur.trade/works/location` survive on
    // old rows and are only used as a fallback when a pane has no photo linked.
    var hasBefore = !!cur.before_photo_id;
    var anyKeyPlan = keyPlanPathFor(cur, 'before') || keyPlanPathFor(cur, 'after');
    var meta =
      '<div class="ppr-meta">' +
        '<div class="ppr-hfield"><label>Key Plan</label>' +
          (anyKeyPlan
            ? '<button class="ppr-kpbtn" id="ppr-kp" title="Toggle the key plan overlay">' +
              (keyPlanOpen ? '⤡' : '⤢') + '</button>'
            : '<span class="ppr-kpnone">—</span>') +
        '</div>' +
      '</div>';

    // No before photo → don't render an empty "Photo not set" frame beside it;
    // show just the current photo, centered (owner feedback).
    var pairHTML = hasBefore
      ? '<div class="ppr-pair">' + pane(cur, 'before') + pane(cur, 'after') + '</div>'
      : '<div class="ppr-pair ppr-pair-single">' + pane(cur, 'after') + '</div>';

    host.innerHTML = header + meta + pairHTML +
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
    hydrate();
  }

  // Key plan is per PHOTO now (progress_photos.key_plan_url), with the legacy
  // slide-level key_plan_url honoured as a fallback so PPRs built before the
  // 2026-08-28 migration keep rendering their overlay.
  function keyPlanPathFor(sl, which) {
    var ph = photoById(which === 'before' ? sl.before_photo_id : sl.after_photo_id);
    return (ph && ph.key_plan_url) || sl.key_plan_url || '';
  }

  function pane(sl, which) {
    var photoId = which === 'before' ? sl.before_photo_id : sl.after_photo_id;
    var ph = photoById(photoId);
    var u = urlOfPhoto(photoId);
    var cap = (which === 'before' ? sl.before_caption : sl.after_caption) ||
              (ph ? ph.description : '') || '';
    var kp = keyPlanOpen ? urlOfPath(keyPlanPathFor(sl, which)) : '';
    // Each pane carries its own Trade · Works · Location, since the two photos
    // are no longer required to share a location.
    var tags = ph ? [ph.trade, ph.works, ph.location].filter(Boolean).join(' · ')
                  : [sl.trade, sl.works, sl.location].filter(Boolean).join(' · ');
    return '<figure class="ppr-pane">' +
      // "Previous"/"Current" is the user-facing label (owner feedback, item 7:
      // less ambiguous than Before/After for a recurring capture). The
      // internal `which` discriminator stays 'before'/'after' throughout this
      // file — it's a private parameter value, never displayed, and renaming
      // it everywhere (this function, keyPlanPathFor, slideFigureHTML, the
      // form field ids) would touch ~30 call sites for no user-visible gain.
      '<div class="ppr-panelabel">' + (which === 'before' ? 'Previous' : 'Current') + '</div>' +
      '<div class="ppr-imgwrap">' +
        (u ? '<img class="ppr-img" src="' + esc(u) + '" alt="' + esc(cap) + '" />'
           : '<div class="ppr-img pp-noimg"><span>Photo not set</span></div>') +
        (kp ? '<img class="ppr-keyplan" src="' + esc(kp) + '" alt="Key plan" />' : '') +
      '</div>' +
      '<figcaption>' +
        '<div class="ppr-capdate">' + esc(ph && ph.taken_at ? capDate(ph.taken_at) : '—') + '</div>' +
        '<div class="ppr-captxt">' + esc(cap || '—') + '</div>' +
        (tags ? '<div class="ppr-panetags">' + esc(tags) + '</div>' : '') +
      '</figcaption></figure>';
  }

  function wireSlideNav(s) {
    if ($('ppr-prev')) $('ppr-prev').onclick = function () { if (slideAt > 0) { slideAt--; renderSlides(); } };
    if ($('ppr-next')) $('ppr-next').onclick = function () { if (slideAt < s.length - 1) { slideAt++; renderSlides(); } };
  }

  // -------------------------------------------------------- Presentation CRUD ----
  // Renamed from "PPR" to "Presentation" (owner feedback): the same record now backs
  // both a PPR presentation and a client presentation, distinguished in the description.
  // The DB table/columns keep their `ppr_*` names — renaming them would break
  // every existing row and the migration isn't worth it for a label change.
  function openPprForm(p) {
    var isNew = !p; p = p || {};
    // Copy-previous: pre-selects the most recent EARLIER presentation so a new one
    // starts from last period's slides, with its "after" photos promoted to
    // "before" (see copySlidesFrom below).
    var prior = pprs.filter(function (x) { return x.id !== p.id; });
    var html =
      '<div class="pd-modal-header"><h3>' + (isNew ? 'New Presentation' : 'Edit Presentation') + '</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form"><div class="pp-form2">' +
        '<div class="pd-field"><label>Presentation date</label>' +
          '<input class="pd-input" type="date" id="ppr-f-date" value="' + esc(p.ppr_date || '') + '" /></div>' +
        '<div class="pd-field"><label>Description</label>' +
          '<input class="pd-input" id="ppr-f-desc" placeholder="e.g. PPR ftm of June 2026 / Client Presentation" value="' +
          esc(p.description || '') + '" /></div>' +
        (isNew && prior.length
          ? '<div class="pd-field pp-span2"><label>Copy from a previous presentation ' +
              '<span class="pp-optnote">(optional)</span></label>' +
              '<select class="pd-select" id="ppr-f-copy"><option value="">— start empty —</option>' +
              prior.map(function (x) {
                return '<option value="' + esc(x.id) + '">' + esc(longDate(x.ppr_date)) +
                  (x.description ? ' — ' + esc(x.description) : '') +
                  ' (' + slides(x.id).length + ' slide' + (slides(x.id).length === 1 ? '' : 's') + ')</option>';
              }).join('') + '</select>' +
              '<p class="pp-hint">Copies that presentation\'s slides across, moving each slide\'s ' +
              '<strong>current photo into the &ldquo;previous&rdquo; position</strong> so you only ' +
              'need to add this period\'s new photo.</p></div>'
          : '') +
      '</div></div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="ppr-f-save">Save</button></div>';
    var m = openModal(html, 560);
    $('ppr-f-save').onclick = async function () {
      var date = $('ppr-f-date').value;
      if (!date) { UI.toast('A presentation date is required', 'warn'); return; }
      this.disabled = true;
      var data = { ppr_date: date, description: $('ppr-f-desc').value.trim() };
      var res, newId = null;
      if (isNew) {
        // .select() so the new id comes back — needed to copy slides into it and
        // to jump straight to its editor.
        res = await sb().from(T_PPR)
          .insert(Object.assign(data, { project_id: pid, created_by: uid })).select();
        if (!res.error) newId = res.data && res.data[0] && res.data[0].id;
      } else {
        res = await sb().from(T_PPR)
          .update(Object.assign(data, { updated_at: new Date().toISOString() })).eq('id', p.id);
      }
      if (res.error) { UI.toast(res.error.message, 'error'); this.disabled = false; return; }

      var copied = 0;
      var copyFrom = $('ppr-f-copy') ? $('ppr-f-copy').value : '';
      if (isNew && newId && copyFrom) {
        try { copied = await copySlidesFrom(copyFrom, newId); }
        catch (err) { UI.toast('Presentation created, but copying slides failed: ' +
          (err.message || err), 'warn'); }
      }

      m.close();
      UI.toast(isNew
        ? ('Presentation created' + (copied ? ' with ' + copied + ' slide' + (copied === 1 ? '' : 's') + ' copied' : ''))
        : 'Presentation updated', 'ok');
      await load();
      // After creating, go straight into the slides editor (owner feedback:
      // "after adding PPR, it should go to PPR edit") rather than dropping the
      // user back on the list with nothing obviously to do next.
      if (isNew && newId) openPpr(newId);
    };
  }

  // Copies every slide of `fromPprId` into `toPprId`, PROMOTING each source
  // slide's "after" (current) photo into the new slide's "before" slot and
  // leaving "after" empty for this period's fresh capture. Captions move with
  // the photo they describe; the after caption is deliberately NOT carried over
  // (it described last period's photo, which is now the before).
  async function copySlidesFrom(fromPprId, toPprId) {
    var src = slides(fromPprId);
    if (!src.length) return 0;
    var payload = src.map(function (sl, i) {
      return {
        ppr_id: toPprId, project_id: pid, created_by: uid, slide_no: i + 1,
        before_photo_id: sl.after_photo_id || sl.before_photo_id || null,
        after_photo_id: null,
        before_caption: sl.after_caption || sl.before_caption || null,
        after_caption: null
      };
    });
    var res = await sb().from(T_SLIDE).insert(payload);
    if (res.error) throw res.error;
    return payload.length;
  }

  async function removePpr(p) {
    var n = slides(p.id).length;
    var html =
      '<div class="pd-modal-header"><h3>Delete Presentation</h3>' +
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
      m.close(); UI.toast('Presentation deleted', 'ok');
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

  // The slide form is PHOTO-FIRST (owner feedback: "for adding slides, you can
  // add photos instead of selecting locations"). Trade / Works / Location are
  // no longer asked for at all — they're properties of the photo, shown
  // read-only once one is picked, and rendered per-pane in the slides view. The
  // two photos may sit at different locations, which the old shared
  // location field made impossible to express.
  function openSlideForm(sl) {
    var isNew = !sl; sl = sl || {};
    var html =
      '<div class="pd-modal-header"><h3>' + (isNew ? 'Add slide' : 'Edit slide') + '</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        '<p class="pp-hint">Pick this period\'s photo, and optionally an earlier one to compare ' +
          'it against. The two may be at <strong>different locations</strong>. Each photo brings ' +
          'its own trade, works, location and key plan with it.</p>' +
        '<div class="pp-form2">' +

          '<div class="pd-field pp-span2"><label>Current photo</label>' +
            '<div class="ppr-pickrow">' +
              '<select class="pd-select" id="ppr-s-after">' + photoOptions(sl.after_photo_id) + '</select>' +
              '<button type="button" class="pd-btn" id="ppr-s-after-add" title="Upload a new photo and use it here">+ Add photo</button>' +
            '</div>' +
            '<div class="ppr-pickinfo" id="ppr-s-after-info"></div></div>' +
          '<div class="pd-field pp-span2"><label>Caption for the current photo</label>' +
            '<input class="pd-input" id="ppr-s-acap" placeholder="e.g. Aerial View facing Marikina River ftm of June 2026." value="' +
            esc(sl.after_caption || '') + '" /></div>' +

          '<div class="pd-field pp-span2"><label>Previous photo <span class="pp-optnote">(optional — leave empty to show the current photo on its own)</span></label>' +
            '<div class="ppr-pickrow">' +
              '<select class="pd-select" id="ppr-s-before">' + photoOptions(sl.before_photo_id) + '</select>' +
              '<button type="button" class="pd-btn" id="ppr-s-before-add" title="Upload a new photo and use it here">+ Add photo</button>' +
            '</div>' +
            '<div class="ppr-pickinfo" id="ppr-s-before-info"></div></div>' +
          // Only rendered/shown when a before photo is actually set (owner
          // feedback: "when there is no added before photo, no need to ask for
          // before photo description").
          '<div class="pd-field pp-span2" id="ppr-s-bcap-field" style="display:none;">' +
            '<label>Caption for the previous photo</label>' +
            '<input class="pd-input" id="ppr-s-bcap" placeholder="e.g. Aerial View facing Marikina River ftm of May 2026." value="' +
            esc(sl.before_caption || '') + '" /></div>' +
        '</div>' +
        '<p class="pp-hint">Key plans are set on the photo itself — edit a photo on the ' +
          '<strong>Photos</strong> tab to attach or change one.</p>' +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="ppr-s-save">Save</button></div>';

    var m = openModal(html, 660);

    // Read-only echo of the picked photo's own tags, so the planner can see
    // what the slide will show without any field to fill in.
    function paintInfo(which) {
      var sel = $('ppr-s-' + which), box = $('ppr-s-' + which + '-info');
      if (!sel || !box) return;
      var ph = photoById(sel.value);
      if (!ph) { box.innerHTML = '<span class="pp-muted">No photo selected.</span>'; return; }
      var tags = [ph.trade, ph.works, ph.location].filter(Boolean).join(' · ');
      var u = urlOfPhoto(ph.id);
      box.innerHTML =
        (u ? '<img class="ppr-pickthumb" src="' + esc(u) + '" alt="" />' : '') +
        '<span>' + esc(tags || 'No tags on this photo') +
        (ph.taken_at ? '<br>' + esc(capDate(ph.taken_at)) : '') +
        (ph.key_plan_url ? '<br>Key plan attached' : '') + '</span>';
    }
    // The before caption field only exists as a question once there's a before
    // photo to describe.
    function syncBeforeCaption() {
      var has = !!$('ppr-s-before').value;
      $('ppr-s-bcap-field').style.display = has ? '' : 'none';
    }

    $('ppr-s-after').onchange = function () {
      var ph = photoById(this.value);
      if (ph && !$('ppr-s-acap').value) $('ppr-s-acap').value = ph.description || '';
      paintInfo('after');
    };
    $('ppr-s-before').onchange = function () {
      var ph = photoById(this.value);
      if (ph && !$('ppr-s-bcap').value) $('ppr-s-bcap').value = ph.description || '';
      syncBeforeCaption();
      paintInfo('before');
    };

    // "+ Add photo" right here — no trip to the Photos tab to upload a shot
    // that's missing (owner feedback). Reuses the Photos screen's own Add-photos
    // modal, then selects the newly created photo in this picker.
    ['after', 'before'].forEach(function (which) {
      var btn = $('ppr-s-' + which + '-add');
      if (!btn) return;
      btn.onclick = function () {
        ProgressPhotos.openUploadForPicker(async function (newIds) {
          // Re-read the library so the new row is pickable, then select it.
          var before = photos.map(function (p) { return p.id; });
          await reloadPhotos();
          // PDSync's offline outbox can't report an inserted id, so fall back to
          // whichever photo appeared that wasn't in the library a moment ago.
          var pickId = (newIds && newIds[0]) || photos.filter(function (p) {
            return before.indexOf(p.id) < 0;
          }).map(function (p) { return p.id; })[0];
          if (!pickId) return;                 // queued offline — nothing to pick yet
          var sel = $('ppr-s-' + which);
          if (!sel) return;                    // modal was closed meanwhile
          sel.innerHTML = photoOptions(pickId);
          sel.value = pickId;
          var ph = photoById(pickId);
          var capEl = $('ppr-s-' + (which === 'after' ? 'acap' : 'bcap'));
          if (ph && capEl && !capEl.value) capEl.value = ph.description || '';
          if (which === 'before') syncBeforeCaption();
          paintInfo(which);
        });
      };
    });

    paintInfo('after'); paintInfo('before'); syncBeforeCaption();

    $('ppr-s-save').onclick = async function () {
      var afterId = $('ppr-s-after').value || null;
      var beforeId = $('ppr-s-before').value || null;
      if (!afterId && !beforeId) { UI.toast('Pick at least one photo for this slide', 'warn'); return; }
      this.disabled = true;
      var data = {
        before_photo_id: beforeId,
        after_photo_id: afterId,
        before_caption: beforeId ? ($('ppr-s-bcap').value.trim() || null) : null,
        after_caption: $('ppr-s-acap').value.trim() || null
      };
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

  // Re-reads just the photo library + signs any new paths — used after an
  // inline upload from the slide form, so a full load() (which would re-render
  // the screen underneath the open modal) isn't needed.
  async function reloadPhotos() {
    try {
      photos = await PDb.selectAll(T_PHOTO, function (q) { return q.eq('project_id', pid); });
      photos.sort(function (a, b) { return String(b.taken_at || '').localeCompare(String(a.taken_at || '')); });
    } catch (e) { return; }
    await signAll();
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
  // Why a self-contained file: a PPR is presented in a presentation where the photo
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

  // Every image a presentation's slides reference (photos + per-pane key plans),
  // embedded as a downscaled data URI — shared by the offline HTML export,
  // the PDF export and the PPTX export, so the three formats can never
  // embed a different picture of the same slide. `onProgress(i, total)` is
  // optional, called before each fetch so each caller can show its own message.
  async function collectSlideImages(s, onProgress) {
    var imgs = {}, failed = 0;
    var jobs = [];
    s.forEach(function (sl) {
      [sl.before_photo_id, sl.after_photo_id].forEach(function (id) {
        var u = urlOfPhoto(id); if (u && !imgs[u]) jobs.push(u);
      });
      // Key plans are per-photo now, so each pane can contribute a different one.
      ['before', 'after'].forEach(function (which) {
        var k = urlOfPath(keyPlanPathFor(sl, which)); if (k) jobs.push(k);
      });
    });
    jobs = jobs.filter(function (u, i) { return jobs.indexOf(u) === i; });

    for (var i = 0; i < jobs.length; i++) {
      if (onProgress) onProgress(i, jobs.length);
      try { imgs[jobs[i]] = await toDataURL(jobs[i]); }
      catch (e) { failed++; console.warn('PPR: could not embed an image —', e && e.message); }
      await new Promise(function (r) { setTimeout(r, 0); });
    }
    return { imgs: imgs, failed: failed };
  }

  async function exportOffline(p) {
    var s = slides(p.id);
    if (!s.length) { UI.toast('This presentation has no slides to export', 'warn'); return; }

    var m = openModal(
      '<div class="pd-modal-header"><h3>Preparing offline copy</h3></div>' +
      '<div class="pp-form"><p id="ppr-x-msg">Embedding images…</p>' +
      '<p class="pp-hint">Every photo is embedded in the file so it opens without a network ' +
      'connection. Large PPRs take a moment.</p></div>', 480);
    var msg = $('ppr-x-msg');

    var res = await collectSlideImages(s, function (i, total) {
      msg.textContent = 'Embedding image ' + (i + 1) + ' of ' + total + '…';
    });
    var imgs = res.imgs, failed = res.failed;

    msg.textContent = 'Building file…';
    var html = offlineHTML(p, s, imgs);
    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Presentation ' + (projName || pid) + ' ' + (p.ppr_date || '') + '.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);

    m.close();
    var mb = (blob.size / 1048576).toFixed(1);
    UI.toast('Offline copy downloaded (' + mb + ' MB)' +
      (failed ? ' — ' + failed + ' image(s) could not be embedded' : ''), failed ? 'warn' : 'ok');
  }

  // Renders one <figure> per pane, mirroring the in-app slides view: tags and
  // the key plan are per PHOTO, and a slide with no before photo renders the
  // single photo centered rather than beside an empty frame. Shared by the
  // offline HTML export and the PDF export (built into a real DOM node rather
  // than a string there, but from the SAME figure/slide markup) so the two
  // documents can never show a different layout of the same slide.
  function slideFigureHTML(sl, which, imgs) {
    var ph = photoById(which === 'before' ? sl.before_photo_id : sl.after_photo_id);
    var cap = (which === 'before' ? sl.before_caption : sl.after_caption) ||
              (ph && ph.description) || '';
    var tags = ph ? [ph.trade, ph.works, ph.location].filter(Boolean).join(' · ')
                  : [sl.trade, sl.works, sl.location].filter(Boolean).join(' · ');
    var kp = urlOfPath(keyPlanPathFor(sl, which));
    var phUrl = urlOfPhoto(ph && ph.id);
    function im(url, cls, alt) {
      var d = url ? imgs[url] : '';
      return d ? '<img class="' + cls + '" src="' + d + '" alt="' + esc(alt || '') + '" />'
               : '<div class="' + cls + ' missing">Image unavailable</div>';
    }
    return '<figure>' +
      '<div class="lbl">' + (which === 'before' ? 'Previous' : 'Current') + '</div>' +
      '<div class="phwrap">' + im(phUrl, 'ph', cap) +
        (kp && imgs[kp] ? im(kp, 'kpimg', 'Key plan') : '') + '</div>' +
      '<figcaption><div class="d">' + esc(ph && ph.taken_at ? capDate(ph.taken_at) : '—') + '</div>' +
      '<div class="c">' + esc(cap) + '</div>' +
      (tags ? '<div class="t">' + esc(tags) + '</div>' : '') +
      '</figcaption></figure>';
  }

  function slidesBodyHTML(p, s, imgs) {
    var slidesHTML = s.map(function (sl, i) {
      var hasBefore = !!sl.before_photo_id;
      return '<section class="slide">' +
        '<div class="meta"><span class="no">Slide ' + (i + 1) + ' of ' + s.length + '</span></div>' +
        '<div class="pair' + (hasBefore ? '' : ' single') + '">' +
          (hasBefore ? slideFigureHTML(sl, 'before', imgs) : '') + slideFigureHTML(sl, 'after', imgs) +
        '</div></section>';
    }).join('');
    return '<header><h1>' + esc(projName || pid) + ' — Progress Photos</h1>' +
      '<p>' + esc(p.description || '') + ' · Presentation Date: ' + esc(longDate(p.ppr_date)) +
      ' · ' + s.length + ' slide' + (s.length === 1 ? '' : 's') + '</p></header>' +
      '<div class="wrap">' + slidesHTML + '</div>' +
      '<footer>Generated ' + esc(longDate(new Date().toISOString().slice(0, 10))) +
      ' from the Planners Dashboard · Megawide Construction Corporation</footer>';
  }

  // Shared by the offline HTML export (in a real <style> tag) and the PDF
  // export (injected into the same detached DOM node html2pdf rasterises).
  var EXPORT_CSS =
    'body{margin:0;font-family:Montserrat,Segoe UI,Arial,sans-serif;color:#231F20;background:#F4F4F4}' +
    'header{background:#EE3124;color:#fff;padding:16px 22px}' +
    'header h1{margin:0;font-size:19px;letter-spacing:.02em}' +
    'header p{margin:4px 0 0;font-size:13px;opacity:.92}' +
    '.wrap{max-width:1180px;margin:0 auto;padding:18px}' +
    '.slide{background:#fff;border:1px solid #DCDBDB;border-radius:4px;padding:14px;margin-bottom:16px;position:relative}' +
    '.meta{display:flex;flex-wrap:wrap;gap:18px;font-size:13px;margin-bottom:10px;align-items:baseline}' +
    '.meta .no{font-weight:700;color:#EE3124}' +
    '.meta b{color:#6b6b6b;font-weight:600;margin-right:4px}' +
    '.phwrap{position:relative}' +
    '.kpimg{position:absolute;top:8px;right:8px;width:150px;border:1px solid #DCDBDB;display:block;box-shadow:0 1px 4px rgba(0,0,0,.25)}' +
    '.pair{display:grid;grid-template-columns:1fr 1fr;gap:14px}' +
    '.pair.single{grid-template-columns:minmax(0,760px);justify-content:center}' +
    'figure{margin:0}' +
    '.lbl{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b6b6b;margin-bottom:4px}' +
    'figcaption .t{font-size:11.5px;color:#6b6b6b;margin-top:3px}' +
    '.ph{width:100%;display:block;border:1px solid #DCDBDB;background:#F4F4F4}' +
    '.missing{padding:40px;text-align:center;color:#9a9a9a;font-size:13px}' +
    'figcaption{text-align:center;margin-top:6px}' +
    'figcaption .d{font-size:13px}' +
    'figcaption .c{font-style:italic;font-size:12.5px;color:#4a4a4a;margin-top:2px}' +
    'footer{text-align:center;font-size:11.5px;color:#6b6b6b;padding:6px 0 22px}' +
    '@media print{body{background:#fff}.slide{page-break-after:always;border:0}}' +
    '@media (max-width:820px){.pair,.pair.single{grid-template-columns:1fr}.kpimg{width:110px}}';

  // A standalone page: inline CSS, inline images, no scripts, no external refs.
  function offlineHTML(p, s, imgs) {
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />' +
      '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
      '<title>' + esc(projName || pid) + ' — ' + esc(longDate(p.ppr_date)) + '</title>' +
      '<style>' + EXPORT_CSS + '</style></head><body>' +
      slidesBodyHTML(p, s, imgs) +
      '</body></html>';
  }

  // ------------------------------------------------------------- PDF export ---
  // Brief Section 5: "exportable as a slide deck (PPTX) or PDF suitable for
  // presenting directly in a presentation." Reuses the SAME slidesBodyHTML/EXPORT_CSS
  // as the offline HTML export, rasterised by html2pdf — so the on-screen
  // slides, the offline copy and the PDF can never show three different layouts
  // of one presentation.
  async function exportPdf(p) {
    var s = slides(p.id);
    if (!s.length) { UI.toast('This presentation has no slides to export', 'warn'); return; }
    if (typeof html2pdf !== 'function') {
      UI.toast('The PDF library did not load — check the connection and reload.', 'error'); return;
    }
    var m = openModal(
      '<div class="pd-modal-header"><h3>Preparing PDF</h3></div>' +
      '<div class="pp-form"><p id="ppr-x-msg">Embedding images…</p></div>', 420);
    var msg = $('ppr-x-msg');
    var holder = null;
    try {
      var res = await collectSlideImages(s, function (i, total) {
        msg.textContent = 'Embedding image ' + (i + 1) + ' of ' + total + '…';
      });
      msg.textContent = 'Building PDF…';

      // ⚠️ THE CAPTURED ELEMENT MUST STAY IN NORMAL FLOW (issues-lessons
      // 2026-08-22 found this the hard way: `position:fixed`/`absolute` on the
      // node html2pdf renders gives html2canvas a real WIDTH but a height of
      // ZERO — every previous PDF export in this repo that made that mistake
      // produced a byte-identical blank page with no error. The OFF-SCREEN
      // PARKING goes on a HOLDER; `wrap` sits in normal flow inside it.
      holder = document.createElement('div');
      holder.style.cssText = 'position:fixed;left:-10000px;top:0;';
      var wrap = document.createElement('div');
      wrap.style.cssText = 'width:1180px;';
      wrap.innerHTML = '<style>' + EXPORT_CSS + '</style>' + slidesBodyHTML(p, s, res.imgs);
      holder.appendChild(wrap);
      document.body.appendChild(holder);

      var filename = 'Presentation ' + (projName || pid) + ' ' + (p.ppr_date || '') + '.pdf';
      await html2pdf().set({
        margin: [8, 8, 8, 8],
        filename: filename,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, allowTaint: true, logging: false, backgroundColor: '#F4F4F4' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak: { mode: ['css'] }
      }).from(wrap).save();

      m.close();
      UI.toast('PDF downloaded' + (res.failed ? ' — ' + res.failed + ' image(s) could not be embedded' : ''),
        res.failed ? 'warn' : 'ok');
    } catch (e) {
      m.close(); UI.toast('PDF error: ' + ((e && e.message) || e), 'error');
    } finally {
      if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
    }
  }

  // ------------------------------------------------------------ PPTX export ---
  // PptxGenJS builds slides via its own API (not from HTML), so this walks the
  // same photo/pane data slideFigureHTML() reads — one PptxGenJS slide per
  // report slide, before pane on the left half when present, after pane on the
  // right (or centered alone). Units are inches (its native unit); a 13.33x7.5
  // widescreen layout matches the offline export's own wide, image-led look.
  async function exportPptx(p) {
    var s = slides(p.id);
    if (!s.length) { UI.toast('This presentation has no slides to export', 'warn'); return; }
    if (typeof PptxGenJS !== 'function') {
      UI.toast('The PowerPoint library did not load — check the connection and reload.', 'error'); return;
    }
    var m = openModal(
      '<div class="pd-modal-header"><h3>Preparing PowerPoint</h3></div>' +
      '<div class="pp-form"><p id="ppr-x-msg">Embedding images…</p></div>', 420);
    var msg = $('ppr-x-msg');
    try {
      var res = await collectSlideImages(s, function (i, total) {
        msg.textContent = 'Embedding image ' + (i + 1) + ' of ' + total + '…';
      });
      msg.textContent = 'Building file…';
      var imgs = res.imgs;

      var pptx = new PptxGenJS();
      pptx.defineLayout({ name: 'PP_WIDE', width: 13.33, height: 7.5 });
      pptx.layout = 'PP_WIDE';

      var title = pptx.addSlide();
      title.background = { color: 'EE3124' };
      title.addText(projName || pid, { x: 0.6, y: 2.6, w: 12, h: 0.8, fontSize: 28, bold: true, color: 'FFFFFF' });
      title.addText((p.description || 'Progress Photos') + '\n' + longDate(p.ppr_date),
        { x: 0.6, y: 3.5, w: 12, h: 1, fontSize: 16, color: 'FFFFFF' });

      // PptxGenJS's `data` option takes the payload WITHOUT the `data:` prefix
      // that canvas.toDataURL() (collectSlideImages' own source) always adds.
      function stripDataPrefix(uri) { return uri ? uri.replace(/^data:/, '') : ''; }
      function pptxPane(slide, sl, which, x, w) {
        var ph = photoById(which === 'before' ? sl.before_photo_id : sl.after_photo_id);
        var cap = (which === 'before' ? sl.before_caption : sl.after_caption) || (ph && ph.description) || '';
        var tags = ph ? [ph.trade, ph.works, ph.location].filter(Boolean).join(' · ') : '';
        var url = urlOfPhoto(ph && ph.id);
        var data = url ? imgs[url] : '';
        slide.addText(which === 'before' ? 'PREVIOUS' : 'CURRENT',
          { x: x, y: 0.35, w: w, h: 0.35, fontSize: 11, bold: true, color: '6B6B6B', charSpacing: 1 });
        if (data) slide.addImage({ data: stripDataPrefix(data), x: x, y: 0.75, w: w, h: 4.6, sizing: { type: 'contain', w: w, h: 4.6 } });
        else slide.addText('Photo not set', { x: x, y: 0.75, w: w, h: 4.6, align: 'center', valign: 'middle', color: '9A9A9A', fontSize: 12 });
        var capLines = [ph && ph.taken_at ? capDate(ph.taken_at) : '—', cap, tags].filter(Boolean).join('\n');
        slide.addText(capLines, { x: x, y: 5.45, w: w, h: 0.9, fontSize: 10, color: '4A4A4A', align: 'center' });
      }

      s.forEach(function (sl, i) {
        var slide = pptx.addSlide();
        slide.addText('Slide ' + (i + 1) + ' of ' + s.length, { x: 0.4, y: 0.05, w: 6, h: 0.3, fontSize: 10, bold: true, color: 'EE3124' });
        var hasBefore = !!sl.before_photo_id;
        if (hasBefore) {
          pptxPane(slide, sl, 'before', 0.4, 6.1);
          pptxPane(slide, sl, 'after', 6.8, 6.1);
        } else {
          pptxPane(slide, sl, 'after', 3.4, 6.5);
        }
      });

      m.close();
      await pptx.writeFile({ fileName: 'Presentation ' + (projName || pid) + ' ' + (p.ppr_date || '') + '.pptx' });
      UI.toast('PowerPoint downloaded' + (res.failed ? ' — ' + res.failed + ' image(s) could not be embedded' : ''),
        res.failed ? 'warn' : 'ok');
    } catch (e) {
      m.close(); UI.toast('PowerPoint error: ' + ((e && e.message) || e), 'error');
    }
  }

  // ----------------------------------------------------- Report Templates ---
  // Brief Section 5 / Phase 2: a saved, re-runnable report definition. Running
  // it ("Generate") produces an ordinary Presentation with slides auto-populated
  // from the CURRENT photo library — the template itself never holds photos.
  function renderTemplates() {
    var host = $('ppr-tmpl-view');
    if (!host) return;
    if (tmplTableMissing) {
      host.innerHTML = '<div class="pp-empty"><p>Report templates need a table this project ' +
        'does not have yet.</p><p class="pp-hint">Run ' +
        '<code>migrations/2026-08-29-ppr-report-templates.sql</code> in the Supabase SQL editor, ' +
        'then reload.</p></div>';
      hydrate(); return;
    }
    if (!templates.length) {
      host.innerHTML = '<div class="pp-empty">' +
        '<span data-ico="layers" data-ico-size="34"></span>' +
        '<p>No report templates yet for this project.</p>' +
        (canWrite ? '<p class="pp-hint">A template is a saved, reusable definition — pick the ' +
          'locations to include once, in order, then press <strong>Generate</strong> each time you ' +
          'need a fresh previous/current report at those same locations.</p>' : '') +
        '</div>';
      hydrate(); return;
    }
    var rows = templates.map(function (t) {
      var locs = t.locations || [];
      return '<div class="ppr-row" data-id="' + esc(t.id) + '">' +
        '<div class="ppr-cell">' + esc(t.name) + '</div>' +
        '<div class="ppr-cell">' + esc(t.meeting_type === 'internal' ? 'Internal' : 'Client') + '</div>' +
        '<div class="ppr-cell ppr-num">' + locs.length + '</div>' +
        '<div class="ppr-cell">' + (t.comparison_rule === 'baseline' ? 'Latest vs baseline' : 'Latest vs previous') + '</div>' +
        '<div class="ppr-cell ppr-acts">' +
          '<button class="pd-btn pd-btn-primary" data-tact="run" data-id="' + esc(t.id) + '">Generate</button>' +
          (canWrite ? '<button class="pp-iconbtn" data-tact="edit" data-id="' + esc(t.id) + '" title="Edit template">' +
                      '<span data-ico="pencil" data-ico-size="15"></span></button>' +
                      '<button class="pp-iconbtn pp-del" data-tact="del" data-id="' + esc(t.id) + '" title="Delete template">' +
                      '<span data-ico="trash" data-ico-size="15"></span></button>' : '') +
        '</div></div>';
    }).join('');
    host.innerHTML = '<div class="ppr-table ppr-tmpl-table">' +
      '<div class="ppr-head"><div>Name</div><div>Type</div><div class="ppr-num">Locations</div>' +
      '<div>Comparison</div><div></div></div>' + rows + '</div>';
    Array.prototype.forEach.call(host.querySelectorAll('[data-tact]'), function (el) {
      el.onclick = function () {
        var t = tmplById(el.dataset.id); if (!t) return;
        var a = el.dataset.tact;
        if (a === 'run') runTemplate(t, el);
        else if (a === 'edit') openTemplateForm(t);
        else if (a === 'del') removeTemplate(t);
      };
    });
    hydrate();
  }

  async function runTemplate(t, btn) {
    // Non-destructive (only ever creates a new presentation), so this runs
    // immediately rather than behind a confirm — the button disables itself
    // for the duration to guard against a double-click double-generating.
    if (btn) btn.disabled = true;
    try { await generateFromTemplate(t); }
    finally { if (btn) btn.disabled = false; }
  }

  async function generateFromTemplate(tmpl) {
    var locs = tmpl.locations || [];
    if (!locs.length) { UI.toast('This template has no locations to include', 'warn'); return; }

    var picks = locs.map(function (entry) {
      var candidates = photosAtLocation(entry.values || {});
      var after = candidates[0] || null;
      var before = null, missingBaseline = false;
      if (tmpl.comparison_rule === 'baseline') {
        before = entry.baseline_photo_id ? photoById(entry.baseline_photo_id) : null;
        missingBaseline = !!entry.baseline_photo_id && !before;
      } else {
        before = candidates[1] || null;
      }
      return { entry: entry, before: before, after: after, missingBaseline: missingBaseline };
    });

    if (!picks.some(function (x) { return x.after; })) {
      UI.toast('None of this template\'s locations have a photo yet', 'warn'); return;
    }

    var today = new Date().toISOString().slice(0, 10);
    var desc = tmpl.name + ' — ' + longDate(today);
    var ires = await sb().from(T_PPR)
      .insert(Object.assign({ ppr_date: today, description: desc }, { project_id: pid, created_by: uid })).select();
    if (ires.error) { UI.toast(ires.error.message, 'error'); return; }
    var newId = ires.data && ires.data[0] && ires.data[0].id;
    if (!newId) { UI.toast('Presentation created, but its id could not be read back', 'error'); await load(); return; }

    var payload = picks.map(function (x, i) {
      return {
        ppr_id: newId, project_id: pid, created_by: uid, slide_no: i + 1,
        before_photo_id: x.before ? x.before.id : null,
        after_photo_id: x.after ? x.after.id : null,
        before_caption: null, after_caption: null,
        // Legacy fallback tag only — panes read each photo's own fields when
        // a photo is present. Kept so an EMPTY pane (nothing captured here
        // yet) still names which location the slide is for.
        location: x.entry.label || null
      };
    });
    var sres = await sb().from(T_SLIDE).insert(payload);
    if (sres.error) {
      UI.toast('Presentation created, but its slides failed: ' + sres.error.message, 'error');
      await load(); return;
    }

    // Flagged rather than hidden: a location on the report with no photo yet,
    // or a baseline photo that has since been deleted, is information the
    // planner needs before presenting this, not a reason to drop it silently.
    var noPhoto = picks.filter(function (x) { return !x.after; }).length;
    var noBaseline = picks.filter(function (x) { return x.missingBaseline; }).length;
    var note = [];
    if (noPhoto) note.push(noPhoto + ' location' + (noPhoto === 1 ? '' : 's') + ' still ha' + (noPhoto === 1 ? 's' : 've') + ' no photo');
    if (noBaseline) note.push(noBaseline + ' baseline photo' + (noBaseline === 1 ? '' : 's') + ' no longer exist' + (noBaseline === 1 ? 's' : ''));
    UI.toast('Generated ' + payload.length + ' slide' + (payload.length === 1 ? '' : 's') +
      ' for "' + tmpl.name + '"' + (note.length ? ' — ' + note.join('; ') : ''), note.length ? 'warn' : 'ok');
    await load();
    openPpr(newId);
  }

  function openTemplateForm(tmpl) {
    var isNew = !tmpl;
    tmpl = tmpl ? JSON.parse(JSON.stringify(tmpl)) : { id: null, name: '', meeting_type: 'client', comparison_rule: 'previous', locations: [] };
    var draftLocs = (tmpl.locations || []).slice();

    function photoOptionsFor(values, sel) {
      var cands = photosAtLocation(values || {});
      if (!cands.length) return '<option value="">— no photos captured here yet —</option>';
      return '<option value="">— none —</option>' + cands.map(function (p) {
        var label = [capDate(p.taken_at), p.description].filter(Boolean).join(' · ');
        return '<option value="' + esc(p.id) + '"' + (sel === p.id ? ' selected' : '') + '>' + esc(label) + '</option>';
      }).join('');
    }

    function locRowHTML(entry, i) {
      var needsBaseline = tmpl.comparison_rule === 'baseline';
      return '<div class="ppr-tmpl-locrow" data-i="' + i + '">' +
        '<span class="ppr-tmpl-locorder">' + (i + 1) + '</span>' +
        '<span class="ppr-tmpl-loclabel">' + esc(entry.label || '(untitled location)') + '</span>' +
        (needsBaseline
          ? '<select class="pd-select ppr-tmpl-baseline" data-i="' + i + '">' +
            photoOptionsFor(entry.values, entry.baseline_photo_id) + '</select>'
          : '') +
        '<span class="ppr-tmpl-locbtns">' +
          '<button type="button" class="pp-iconbtn" data-locact="up" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + '>&uarr;</button>' +
          '<button type="button" class="pp-iconbtn" data-locact="down" data-i="' + i + '"' + (i === draftLocs.length - 1 ? ' disabled' : '') + '>&darr;</button>' +
          '<button type="button" class="pp-iconbtn pp-del" data-locact="remove" data-i="' + i + '">' +
            '<span data-ico="x" data-ico-size="13"></span></button>' +
        '</span></div>';
    }
    function locsHTML() {
      return draftLocs.length ? draftLocs.map(locRowHTML).join('')
        : '<p class="pp-hint">No locations added yet.</p>';
    }

    var html =
      '<div class="pd-modal-header"><h3>' + (isNew ? 'New report template' : 'Edit report template') + '</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form"><div class="pp-form2">' +
        '<div class="pd-field"><label>Name</label>' +
          '<input class="pd-input" id="tmpl-f-name" placeholder="e.g. Weekly Client Update — Tower B" ' +
          'value="' + esc(tmpl.name || '') + '" /></div>' +
        '<div class="pd-field"><label>Presentation type</label>' +
          '<select class="pd-select" id="tmpl-f-type">' +
            '<option value="client"' + (tmpl.meeting_type !== 'internal' ? ' selected' : '') + '>Client</option>' +
            '<option value="internal"' + (tmpl.meeting_type === 'internal' ? ' selected' : '') + '>Internal</option>' +
          '</select></div>' +
        '<div class="pd-field pp-span2"><label>Comparison</label>' +
          '<select class="pd-select" id="tmpl-f-cmp">' +
            '<option value="previous"' + (tmpl.comparison_rule !== 'baseline' ? ' selected' : '') +
              '>Latest photo vs. the one before it (always current)</option>' +
            '<option value="baseline"' + (tmpl.comparison_rule === 'baseline' ? ' selected' : '') +
              '>Latest photo vs. a fixed baseline photo per location</option>' +
          '</select></div>' +
        '<div class="pd-field pp-span2"><label>Locations, in report order</label>' +
          '<div id="tmpl-f-locs">' + locsHTML() + '</div>' +
          (canWrite ? '<button type="button" class="pd-btn" id="tmpl-f-addloc">+ Add location</button>' : '') +
        '</div>' +
      '</div></div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="tmpl-f-save">Save</button></div>';
    var m = openModal(html, 640);

    function wireLocRows() {
      Array.prototype.forEach.call(m.el.querySelectorAll('[data-locact]'), function (b) {
        b.onclick = function () {
          var i = +b.dataset.i, a = b.dataset.locact;
          if (a === 'remove') draftLocs.splice(i, 1);
          else if (a === 'up' && i > 0) { var t0 = draftLocs[i - 1]; draftLocs[i - 1] = draftLocs[i]; draftLocs[i] = t0; }
          else if (a === 'down' && i < draftLocs.length - 1) { var t1 = draftLocs[i + 1]; draftLocs[i + 1] = draftLocs[i]; draftLocs[i] = t1; }
          refreshLocs();
        };
      });
      Array.prototype.forEach.call(m.el.querySelectorAll('.ppr-tmpl-baseline'), function (sel) {
        sel.onchange = function () { draftLocs[+this.dataset.i].baseline_photo_id = this.value || null; };
      });
    }
    function refreshLocs() { $('tmpl-f-locs').innerHTML = locsHTML(); wireLocRows(); if (window.Icons) Icons.hydrate($('tmpl-f-locs')); }
    wireLocRows();

    $('tmpl-f-cmp').onchange = function () { tmpl.comparison_rule = this.value; refreshLocs(); };
    if ($('tmpl-f-addloc')) $('tmpl-f-addloc').onclick = function () {
      openLocationPicker(draftLocs, function (picked) { draftLocs.push(picked); refreshLocs(); });
    };

    $('tmpl-f-save').onclick = async function () {
      var name = $('tmpl-f-name').value.trim();
      if (!name) { UI.toast('A name is required', 'warn'); return; }
      if (!draftLocs.length) { UI.toast('Add at least one location', 'warn'); return; }
      this.disabled = true;
      var data = {
        name: name,
        meeting_type: $('tmpl-f-type').value,
        comparison_rule: $('tmpl-f-cmp').value,
        locations: draftLocs
      };
      var res = isNew
        ? await sb().from(T_TMPL).insert(Object.assign(data, { project_id: pid, created_by: uid }))
        : await sb().from(T_TMPL).update(Object.assign(data, { updated_at: new Date().toISOString() })).eq('id', tmpl.id);
      if (res.error) { UI.toast(res.error.message, 'error'); this.disabled = false; return; }
      m.close(); UI.toast(isNew ? 'Template created' : 'Template updated', 'ok');
      await loadTemplates(); renderTemplates();
    };
  }

  function openLocationPicker(alreadyAdded, onPick) {
    var used = {}; alreadyAdded.forEach(function (e) { used[e.key] = 1; });
    var all = allLocationCombos().filter(function (c) { return !used[c.key]; });
    var html =
      '<div class="pd-modal-header"><h3>Add a location</h3><button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        '<input class="pd-input" id="loc-pick-search" placeholder="Search locations…" style="margin-bottom:10px;width:100%;box-sizing:border-box;" />' +
        '<div id="loc-pick-list" class="ppr-tmpl-picklist"></div>' +
        (!all.length ? '<p class="pp-hint">No locations available — locations come from Project ' +
          'Schedule\'s Location Breakdown, or from wherever a photo has already been captured.</p>' : '') +
      '</div>';
    var m = openModal(html, 480);
    function paint(q) {
      q = (q || '').toLowerCase();
      var list = all.filter(function (c) { return !q || c.label.toLowerCase().indexOf(q) >= 0; });
      $('loc-pick-list').innerHTML = list.map(function (c) {
        return '<button type="button" class="ppr-tmpl-pickrow" data-key="' + esc(c.key) + '">' + esc(c.label) + '</button>';
      }).join('') || '<p class="pp-hint">No matches.</p>';
      Array.prototype.forEach.call($('loc-pick-list').querySelectorAll('[data-key]'), function (b) {
        b.onclick = function () {
          var c = list.filter(function (x) { return x.key === b.dataset.key; })[0]; if (!c) return;
          m.close();
          onPick({ key: c.key, label: c.label, values: c.values, baseline_photo_id: null });
        };
      });
    }
    paint('');
    if ($('loc-pick-search')) $('loc-pick-search').oninput = function () { paint(this.value); };
  }

  async function removeTemplate(t) {
    var html =
      '<div class="pd-modal-header"><h3>Delete template</h3><button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form"><p>Delete <strong>' + esc(t.name) + '</strong>? Presentations it has already ' +
      'generated are not affected.</p></div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-danger" id="tmpl-d-yes">Delete</button></div>';
    var m = openModal(html, 420);
    $('tmpl-d-yes').onclick = async function () {
      this.disabled = true;
      var res = await sb().from(T_TMPL).delete().eq('id', t.id);
      if (res.error) { UI.toast(res.error.message, 'error'); this.disabled = false; return; }
      m.close(); UI.toast('Template deleted', 'ok');
      await loadTemplates(); renderTemplates();
    };
  }

  return {
    init: init,
    _syncTools: syncTools,
    _addSlide: function () { openSlideForm(null); },
    _screen: function () { return screen; }
  };
})();
