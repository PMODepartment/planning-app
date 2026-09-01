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
  var T_MARKUP = 'ppr_slide_markups';
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
  // Presentation-only markup (18-item list item 14) — a SEPARATE store from
  // the photo's own permanent markup (progress_photos.markup), keyed by
  // "<ppr_slide_id>|<pane>" so a Previous pane and a Current pane on the same
  // slide never share a drawing. markupCache holds the vector array (what's
  // drawn); markupRowId holds the underlying row id so a second edit UPDATEs
  // in place instead of violating ppr_slide_markups' own (ppr_slide_id,pane)
  // unique constraint with a second INSERT. showMarkup is a per-pane, session-
  // only visibility toggle — never persisted, since "am I looking at the
  // overlay right now" is a viewing preference, not presentation content.
  var markupCache = {}, markupRowId = {}, showMarkup = {};
  var markupTableMissing = false;  // migrations/2026-08-29-markup.sql not run yet
  var selId = null;              // selected PPR (drives the preview pane)
  var filters = { from: '', to: '', archived: false };  // archived: false = hide archived (default)
  var screen = 'list';           // list | slides | templates
  var viewPprId = null, slideAt = 0;
  // Item 21: "the key plan should be per photo, not shared at the top."
  // Replaces the single shared `keyPlanOpen` toggle with per-pane state —
  // each of the two photos in a slide can show/hide its OWN key plan popup
  // independently of the other.
  var keyPlanOpenPane = { before: false, after: false };
  // Multi-select batch actions (item 14) — deliberately SEPARATE from `selId`.
  // `selId` means "this ONE presentation is open/being previewed"; `selectedPprs`
  // is a checkbox set for Download/Archive/Merge, and when 2+ are checked it
  // ALSO drives the preview pane to show their slides combined end-to-end
  // ("previews will then combine all the PPRs" — the owner's own wording).
  var selectedPprs = {};
  function selectedPprIds() { return Object.keys(selectedPprs).filter(function (id) { return selectedPprs[id]; }); }
  // Scoped to the currently VISIBLE (filtered) set, not the raw map — a
  // selection made before toggling "Show archived" must not silently let a
  // batch action reach a presentation the list no longer shows. Same rule
  // Gallery's own visibleSelectedIds() already documents in module.js.
  function visibleSelectedPprIds() {
    var vis = {}; visiblePprs().forEach(function (p) { vis[p.id] = true; });
    return selectedPprIds().filter(function (id) { return vis[id]; });
  }

  function sb() { return AppAuth.getSB(); }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return Fmt.esc(s); }
  // module.js's own reqMark() is private to ITS closure — restated here
  // rather than exported/shared, matching this file's existing convention of
  // keeping small independently-loaded helpers in step across files (see
  // allLocationCombos()'s own comment on the same call).
  function reqMark() { return ' <span class="pp-req">*</span>'; }

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
      screen = 'list'; selId = null; selectedPprs = {};
      load();
    });
  }

  function wire() {
    ['from', 'to'].forEach(function (k) {
      var el = $('ppr-f-' + k);
      if (el) el.onchange = el.oninput = function () { filters[k] = this.value; renderList(); };
    });
    // Archive (follow-up feedback, 2026-08-29): a soft-delete, hidden from the
    // default list — this checkbox is the ONLY way back to see one, same rule
    // as the Gallery's own archived items.
    if ($('ppr-f-archived')) $('ppr-f-archived').onchange = function () { filters.archived = this.checked; renderList(); };
    $('ppr-clearfilters').onclick = function () {
      filters = { from: '', to: '', archived: filters.archived };  // the archived toggle is not a "filter" to clear
      ['from', 'to'].forEach(function (k) { var el = $('ppr-f-' + k); if (el) el.value = ''; });
      renderList();
    };
    // Item 2 parity — the topbar funnel toggles the same collapsed-by-default
    // filter panel Gallery uses (#ppr-listbar shares the .pp-filters class).
    if ($('ppr-topfilttoggle')) $('ppr-topfilttoggle').onclick = function () {
      var wrap = $('ppr-listbar'); if (!wrap) return;
      wrap.classList.toggle('open');
      this.classList.toggle('is-active', wrap.classList.contains('open'));
    };
    $('ppr-new').onclick = function () { openPprForm(null); };
    $('ppr-back').onclick = function () { screen = 'list'; render(); };
    if ($('ppr-templates')) $('ppr-templates').onclick = function () { screen = 'templates'; render(); };
    if ($('ppr-tmpl-new')) $('ppr-tmpl-new').onclick = function () { openTemplateForm(null); };
    // Item 14 — multi-select batch actions.
    if ($('ppr-sel-download')) $('ppr-sel-download').onclick = function () { openBatchDownloadChoice(visibleSelectedPprIds()); };
    if ($('ppr-sel-archive')) $('ppr-sel-archive').onclick = function () { archiveSelectedPprs(visibleSelectedPprIds()); };
    if ($('ppr-sel-merge')) $('ppr-sel-merge').onclick = function () { openMergeWizard(visibleSelectedPprIds()); };
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
    await loadSlideMarkups();
    await signAll();
    render();
  }

  // Tolerant of the migration not having run yet, same convention as
  // loadTemplates(). Loaded whole-project, not per-slide-open — the same
  // "small dataset, load it all up front" call already made for pprs/slides.
  async function loadSlideMarkups() {
    markupTableMissing = false;
    markupCache = {}; markupRowId = {};
    try {
      var rows = await PDb.selectAll(T_MARKUP, function (q) { return q.eq('project_id', pid); });
      rows.forEach(function (r) {
        var key = r.ppr_slide_id + '|' + r.pane;
        markupCache[key] = r.markup || [];
        markupRowId[key] = r.id;
      });
    } catch (e) {
      if (/schema cache|does not exist/i.test((e && e.message) || '')) markupTableMissing = true;
    }
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
  // ⚠️ Audit fix: slidesOf[k] is ALREADY kept sorted by slide_no at both of
  // its only two write sites — load() explicitly sorts it once, and the
  // slide-sorter's own save handler renumbers slide_no sequentially to
  // MATCH the array's own order before assigning it here — so re-sorting on
  // every single call (this function is called constantly during render)
  // was pure wasted work, not a correctness guard against anything that can
  // actually happen. .slice() is kept: callers must still get their own
  // copy, since some (e.g. the slide-sorter's own drag reorder) mutate it.
  function slides(pprId) { return (slidesOf[pprId] || []).slice(); }
  function pprById(id) { return pprs.filter(function (p) { return p.id === id; })[0] || null; }
  function tmplById(id) { return templates.filter(function (t) { return t.id === id; })[0] || null; }

  function markupKey(slideId, pane) { return slideId + '|' + pane; }
  function markupFor(slideId, pane) { return markupCache[markupKey(slideId, pane)] || []; }

  // Insert-or-update by (ppr_slide_id, pane) — markupRowId tells which, so a
  // second edit of the same pane UPDATEs the existing row rather than hitting
  // the table's own unique constraint with a second INSERT.
  async function saveSlideMarkup(slideId, pane, objs) {
    var key = markupKey(slideId, pane);
    var rowId = markupRowId[key];
    try {
      var res;
      if (rowId) {
        res = await sb().from(T_MARKUP).update({ markup: objs, updated_at: new Date().toISOString() }).eq('id', rowId);
      } else {
        res = await sb().from(T_MARKUP).insert({
          ppr_slide_id: slideId, project_id: pid, pane: pane, markup: objs, created_by: uid
        }).select();
      }
      if (res.error) throw res.error;
      markupCache[key] = objs;
      if (!rowId && res.data && res.data[0]) markupRowId[key] = res.data[0].id;
      showMarkup[key] = true;
      UI.toast('Markup saved', 'ok');
    } catch (e) {
      var msg = /schema cache|does not exist/i.test((e && e.message) || '')
        ? 'Markup could not be saved — run migrations/2026-08-29-markup.sql'
        : ('Could not save markup: ' + ((e && e.message) || e));
      UI.toast(msg, 'warn');
    }
    renderSlides();
  }

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
    // ⚠️ ROOT-CAUSE FIX (2026-08-30): this was `syncTools(true)`, unconditionally,
    // on EVERY render — including one triggered by load()'s own async
    // completion, which runs well after index.html's setScreen() has already
    // correctly hidden this screen's tools because the Gallery (or Plans) tab
    // is the one actually active. That silently re-showed "+ New Presentation"
    // on top of a screen it doesn't belong to — the exact symptom reported
    // live and reproduced in the browser, with no console error, because
    // nothing here ever threw. Replaying the last-known value (set by
    // index.html's setScreen -> PPR._syncTools) keeps a later re-render from
    // overriding a screen switch that already happened. bim.js had the
    // identical bug (also fixed 2026-08-30).
    syncTools(toolsVisible);
    if (screen === 'slides') renderSlides();
    else if (screen === 'templates') renderTemplates();
    else renderList();
  }

  // The topbar tools follow the Presentations screen's own state: "+ New Presentation"
  // and "Templates" belong to the list, "Presentations list" (back) belongs to the
  // templates view now (the slides view carries its own in-header back button,
  // #ppr-slide-back, rendered first inside .ppr-slidehead — owner feedback:
  // Back Button > Presentation Details > action buttons), "+ New template"
  // belongs to the templates view. `visible` is false while the Photos screen
  // is showing, which hides all of them — they never share a row with each
  // other, so no divider is needed.
  var toolsVisible = false;   // last-known value passed to syncTools by index.html's setScreen
  function syncTools(visible) {
    toolsVisible = visible;
    var back = $('ppr-back'), neu = $('ppr-new'), tmplBtn = $('ppr-templates'), tmplNew = $('ppr-tmpl-new');
    var onList = screen === 'list', onTmpl = screen === 'templates';
    var selIds = visibleSelectedPprIds();
    // Same swap-in shape as the Gallery's own syncChrome: exactly one of
    // "the normal list tools" or "the selection batch tools" is ever visible.
    var hasSel = visible && onList && selIds.length > 0;
    if (back) back.style.display = (visible && onTmpl) ? '' : 'none';
    if ($('ppr-topfilttoggle')) $('ppr-topfilttoggle').style.display = (visible && onList && !hasSel) ? '' : 'none';
    if (neu) neu.style.display = (visible && onList && canWrite && !hasSel) ? '' : 'none';
    if (tmplBtn) tmplBtn.style.display = (visible && onList && !hasSel) ? '' : 'none';
    if (tmplNew) tmplNew.style.display = (visible && onTmpl && canWrite) ? '' : 'none';
    var cnt = $('ppr-selcount'), dl = $('ppr-sel-download'), ar = $('ppr-sel-archive'), mg = $('ppr-sel-merge');
    if (cnt) { cnt.style.display = hasSel ? '' : 'none'; cnt.textContent = selIds.length + ' selected'; }
    if (dl) dl.style.display = hasSel ? '' : 'none';
    if (ar) ar.style.display = (hasSel && canWrite) ? '' : 'none';
    // Merging needs at least two presentations — one "selected" is just a
    // single row, not a merge candidate.
    if (mg) mg.style.display = (hasSel && canWrite && selIds.length >= 2) ? '' : 'none';
  }

  function visiblePprs() {
    return pprs.filter(function (p) {
      // Archived is hidden unless the toggle is explicitly on — never both at
      // once ("show archived" means ONLY archived, so an archived item found
      // via a date filter can't silently reappear in the everyday list).
      if (!!p.archived !== !!filters.archived) return false;
      if (filters.from && (!p.ppr_date || p.ppr_date < filters.from)) return false;
      if (filters.to && (!p.ppr_date || p.ppr_date > filters.to)) return false;
      return true;
    });
  }

  function renderList() {
    var host = $('ppr-view');
    var list = visiblePprs();

    // The denominator matches the archived toggle's OWN scope (not
    // pprs.length as a whole) — otherwise "3 of 12" while 9 are archived and
    // simply not being shown reads as 9 presentations having vanished.
    var scope = pprs.filter(function (p) { return !!p.archived === !!filters.archived; });
    var count = $('ppr-count');
    if (count) {
      count.textContent = pprs.length
        ? 'Showing ' + list.length + ' of ' + scope.length + ' PPR' + (scope.length === 1 ? '' : 's') +
          (filters.archived ? ' (archived)' : '')
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
      // Item 15: per-row icons are gone entirely — Download/Archive are now
      // batch actions in the topbar the moment a row is checked (item 16),
      // and Preview is superseded by the checkbox-driven preview pane
      // itself. Edit/Delete-presentation still live inside the opened
      // presentation's own header (renderSlides()).
      // Item 16: the red highlight follows the CHECKBOX, not "which row was
      // last opened" — `selId` (the currently-open presentation) is a
      // different concept now that opening a row navigates away entirely.
      return '<div class="ppr-row' + (selectedPprs[p.id] ? ' sel' : '') + '" data-id="' + p.id + '" ' +
        'title="Open this presentation\'s slides">' +
        '<div class="ppr-cell pp-selcell"><input type="checkbox" data-sel="' + p.id + '"' +
          (selectedPprs[p.id] ? ' checked' : '') + ' /></div>' +
        '<div class="ppr-cell ppr-date">' + esc(longDate(p.ppr_date)) + '</div>' +
        '<div class="ppr-cell">' + esc(p.description || '—') + '</div>' +
        '<div class="ppr-cell ppr-num">' + n + '</div>' +
        '</div>';
    }).join('');

    // Header select-all/unselect-all tickbox (item 14 — same pattern this
    // module already uses for the Gallery's own List header, item 4).
    var visIds = {}; list.forEach(function (p) { visIds[p.id] = true; });
    var allChecked = list.length > 0 && list.every(function (p) { return !!selectedPprs[p.id]; });
    var table = '<div class="ppr-table">' +
      '<div class="ppr-head"><div class="pp-selcell"><input type="checkbox" id="ppr-selall"' +
        (allChecked ? ' checked' : '') + ' title="Select/unselect all shown" /></div>' +
        '<div>Presentation Date</div><div>Description</div>' +
      '<div class="ppr-num">No. of Slides</div></div>' +
      (list.length ? rows : '<div class="pp-empty" style="border:0;">' +
        (filters.archived ? 'No archived presentations.' : 'No presentations in this date range.') + '</div>') +
      '</div>';

    host.innerHTML = '<div class="ppr-split">' + table +
      '<div class="ppr-preview"><div class="ppr-preview-head">Preview</div>' +
      '<div id="ppr-preview-body"></div></div></div>';

    // Clicking anywhere on the row OPENS the presentation (owner feedback: no need to
    // press an icon just to open it). Selecting-without-opening is no longer a
    // separate gesture — the preview pane is driven by whatever is open, and
    // hovering a row is enough to see its slide count in the list itself.
    // ⚠️ An ARCHIVED row still opens on click — archiving hides it from the
    // default LIST, it doesn't lock the presentation itself; a planner may
    // still need to open an old one to re-download it. Clicks starting on the
    // select checkbox are excluded so ticking a box never also opens it.
    Array.prototype.forEach.call(host.querySelectorAll('.ppr-row'), function (r) {
      r.onclick = function (e) {
        if (e.target.closest('.pp-selcell')) return;
        openPpr(r.dataset.id);
      };
    });
    // Item 14/16 — the checkbox set (separate gesture from opening a row;
    // its own change handler, below, also drives the preview pane and the
    // red highlight — Download/Archive/Preview no longer have per-row icons
    // at all, see item 15).
    Array.prototype.forEach.call(host.querySelectorAll('[data-sel]'), function (cb) {
      cb.onchange = function () {
        if (this.checked) selectedPprs[this.dataset.sel] = true; else delete selectedPprs[this.dataset.sel];
        syncTools(toolsVisible);
        renderPreview();
      };
    });
    var selAll = host.querySelector('#ppr-selall');
    if (selAll) selAll.onchange = function () {
      var on = this.checked;
      Object.keys(visIds).forEach(function (id) { if (on) selectedPprs[id] = true; else delete selectedPprs[id]; });
      renderList();
    };
    // Re-synced on every list render (not only on a checkbox click) — toggling
    // "Show archived" changes what's VISIBLE without touching selectedPprs
    // itself, and the toolbar must reflect the visible-selection count either way.
    syncTools(toolsVisible);
    renderPreview();
    // ⚠️ hydrate() must happen HERE, not only in render(): renderList() is called
    // DIRECTLY by the date filters, the clear-filters button and (previously) the
    // row click, all of which bypass render(). That's why the download / open /
    // delete icons were reported missing — the markup was correct, but the
    // `data-ico` placeholders were never swapped for SVG on those paths.
    hydrate();
  }

  // Archive is a soft-delete: a presentation's history (and any Gallery photos
  // it cites) must survive being retired, unlike Delete (still reachable from
  // the opened presentation's own header, see renderSlides() below), which
  // removes the row and cascades its slides. Direct action, no confirm modal
  // — reversible with one more click via the same button.
  async function toggleArchive(p) {
    var next = !p.archived;
    var res = await sb().from(T_PPR).update({ archived: next, updated_at: new Date().toISOString() }).eq('id', p.id);
    if (res.error) {
      // Tolerant of the 2026-08-29-archive-flag.sql migration not having run
      // yet — same "strip the column, warn, retry" convention as every other
      // not-yet-migrated column in this module.
      if (/column .* does not exist|schema cache/i.test(res.error.message || '')) {
        UI.toast('Archiving needs a pending migration — run migrations/2026-08-29-archive-flag.sql', 'warn');
        return;
      }
      UI.toast(res.error.message, 'error'); return;
    }
    p.archived = next;
    UI.toast(next ? 'Presentation archived' : 'Presentation restored', 'ok');
    renderList();
  }

  // Item 14 — batch archive. Toggles every selected presentation the SAME
  // direction as the majority of the selection is currently in (archive if
  // most are active, restore if most are already archived) rather than a
  // per-row toggle, which a batch action of this shape can't express cleanly
  // — a mixed selection with no clear "next state" would be a worse UX than
  // just picking the more useful direction and letting a planner re-select
  // any stragglers.
  // Pure, pulled out so it can be genuinely EXECUTED by a test rather than
  // only read — a flipped comparison here would silently restore an archive
  // request (or vice versa) with nothing in the UI to catch it, the same
  // class of risk this module already documents for directionDegFromDrag.
  function archiveDirectionFor(ps) {
    var archivedCount = ps.filter(function (p) { return p.archived; }).length;
    return archivedCount <= ps.length / 2;   // majority active -> archive; majority archived -> restore
  }
  async function archiveSelectedPprs(ids) {
    if (!ids.length) return;
    var ps = ids.map(pprById).filter(Boolean);
    var next = archiveDirectionFor(ps);
    var res = await sb().from(T_PPR).update({ archived: next, updated_at: new Date().toISOString() }).in('id', ids);
    if (res.error) {
      if (/column .* does not exist|schema cache/i.test(res.error.message || '')) {
        UI.toast('Archiving needs a pending migration — run migrations/2026-08-29-archive-flag.sql', 'warn');
        return;
      }
      UI.toast(res.error.message, 'error'); return;
    }
    ps.forEach(function (p) { p.archived = next; });
    selectedPprs = {};
    UI.toast(ps.length + ' presentation' + (ps.length === 1 ? '' : 's') + (next ? ' archived' : ' restored'), 'ok');
    renderList();
  }

  // Item 14 — merge. Copies every selected presentation's slides, IN DATE
  // ORDER, into one NEW presentation (renumbered continuously so the merged
  // deck reads front-to-back with no gaps); the source presentations are
  // ARCHIVED afterward, never deleted — a merge should not be able to lose
  // history, and archiving keeps them reachable via "Show archived" the same
  // way every other retirement in this module already works. Slides are
  // copied by REFERENCE (before/after_photo_id, trade/works/location,
  // captions) — no photo is duplicated, matching item 13a's own rule that a
  // presentation never owns a copy of the photo.
  function openMergeWizard(ids) {
    if (ids.length < 2) return;
    var ps = ids.map(pprById).filter(Boolean)
      .sort(function (a, b) { return String(a.ppr_date || '').localeCompare(String(b.ppr_date || '')); });
    var totalSlides = ps.reduce(function (n, p) { return n + slides(p.id).length; }, 0);
    var html =
      '<div class="pd-modal-header"><h3>Merge ' + ps.length + ' presentations</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        '<p class="pp-hint">Combines ' + totalSlides + ' slide' + (totalSlides === 1 ? '' : 's') +
          ' from ' + ps.length + ' presentations into one new presentation, in date order. ' +
          'The originals are archived afterward, not deleted.</p>' +
        '<ul class="pp-mergelist">' + ps.map(function (p) {
          return '<li>' + esc(longDate(p.ppr_date)) + (p.description ? ' — ' + esc(p.description) : '') +
            ' <span class="pp-muted">(' + slides(p.id).length + ' slide' + (slides(p.id).length === 1 ? '' : 's') + ')</span></li>';
        }).join('') + '</ul>' +
        '<div class="pp-form2">' +
          '<div class="pd-field"><label>Merged presentation date' + reqMark() + '</label>' +
            '<input class="pd-input" type="date" id="ppr-mg-date" value="' + esc(ps[ps.length - 1].ppr_date || '') + '" /></div>' +
          '<div class="pd-field"><label>Description</label>' +
            '<input class="pd-input" id="ppr-mg-desc" placeholder="e.g. Q3 combined progress" value="" /></div>' +
        '</div>' +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="ppr-mg-go">Merge</button></div>';
    var m = openModal(html, 560);
    $('ppr-mg-go').onclick = async function () {
      var date = $('ppr-mg-date').value;
      if (!date) { UI.toast('A presentation date is required', 'warn'); return; }
      this.disabled = true;
      var desc = $('ppr-mg-desc').value.trim();
      var ires = await sb().from(T_PPR)
        .insert({ ppr_date: date, description: desc, project_id: pid, created_by: uid }).select();
      if (ires.error) { UI.toast(ires.error.message, 'error'); this.disabled = false; return; }
      var newId = ires.data && ires.data[0] && ires.data[0].id;
      if (!newId) { UI.toast('Could not create the merged presentation', 'error'); this.disabled = false; return; }
      var n = 0;
      var payload = [];
      ps.forEach(function (p) {
        slides(p.id).forEach(function (sl) {
          n++;
          payload.push({
            ppr_id: newId, project_id: pid, created_by: uid, slide_no: n,
            before_photo_id: sl.before_photo_id, after_photo_id: sl.after_photo_id,
            before_caption: sl.before_caption, after_caption: sl.after_caption,
            trade: sl.trade, works: sl.works, location: sl.location
          });
        });
      });
      if (payload.length) {
        var sres = await sb().from(T_SLIDE).insert(payload);
        if (sres.error) {
          // ⚠️ Audit fix — same recovery as openCopyWizard.finish()'s
          // identical failure mode, below: the presentation row already
          // exists (created above) and was being left invisible behind a
          // still-open wizard whose button was merely re-enabled — retrying
          // Merge from there would insert a SECOND orphaned presentation on
          // top of the first, compounding rather than fixing it. Closing
          // the wizard and opening the (currently slide-less) new
          // presentation directly puts the planner exactly where they can
          // see what happened and add slides one at a time instead.
          UI.toast('Presentation created, but copying slides failed: ' + sres.error.message, 'error');
          m.close(); await load(); openPpr(newId); return;
        }
      }
      var ares = await sb().from(T_PPR).update({ archived: true, updated_at: new Date().toISOString() }).in('id', ids);
      if (ares.error) UI.toast('Merged, but could not archive the originals: ' + ares.error.message, 'warn');
      else ps.forEach(function (p) { p.archived = true; });
      m.close();
      selectedPprs = {};
      UI.toast('Merged into one presentation of ' + payload.length + ' slide' + (payload.length === 1 ? '' : 's'), 'ok');
      await load();
      openPpr(newId);
    };
  }

  // Item 14 — batch download. Loops the SAME three exporters a single
  // presentation's own Download button uses, one format chosen for the
  // whole batch — mirrors the Gallery's own openBatchDownloadChoice exactly
  // (a 300ms stagger, since a burst of near-simultaneous programmatic
  // downloads is exactly what some browsers throttle or block).
  function openBatchDownloadChoice(ids) {
    if (!ids.length) return;
    var html =
      '<div class="pd-modal-header"><h3>Download ' + ids.length + ' presentation' + (ids.length === 1 ? '' : 's') + '</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form"><p class="pp-hint">Choose a format.</p>' +
        '<div class="ppr-fmtchoices">' +
          '<button type="button" class="pd-btn" data-fmt="html">' +
            '<span data-ico="download" data-ico-size="16"></span> Offline HTML' +
            '<small>Opens with no network — best for presenting on-site.</small></button>' +
          '<button type="button" class="pd-btn" data-fmt="pptx">' +
            '<span data-ico="layers" data-ico-size="16"></span> PowerPoint (.pptx)' +
            '<small>Editable slide deck.</small></button>' +
          '<button type="button" class="pd-btn" data-fmt="pdf">' +
            '<span data-ico="clipboard" data-ico-size="16"></span> PDF' +
            '<small>One slide per A4 page, ready to print.</small></button>' +
        '</div></div>';
    var m = openModal(html, 460);
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-fmt]'), function (b) {
      b.onclick = function () {
        var fmt = this.dataset.fmt;
        m.close();
        var exportFn = fmt === 'html' ? exportOffline : fmt === 'pptx' ? exportPptx : exportPdf;
        ids.forEach(function (id, i) {
          var p = pprById(id); if (!p) return;
          setTimeout(function () { exportFn(p); }, i * 300);
        });
      };
    });
  }

  // Read-only view of the exported look, without downloading a file — reuses
  // slidesBodyHTML/EXPORT_CSS (the SAME markup the offline HTML/PDF exports
  // produce) so what you preview can never look different from what you'd get.
  // ⚠️ Deliberately NOT collectSlideImages()'s downscaled data-URI embedding —
  // this stays on screen, so the already-cached SIGNED URLs serve directly
  // (an identity map: imgs[url] === url), at zero extra fetch/embed cost.
  function identityImgs(s) {
    var imgs = {};
    s.forEach(function (sl) {
      [sl.before_photo_id, sl.after_photo_id].forEach(function (id) {
        var u = urlOfPhoto(id); if (u) imgs[u] = u;
      });
      ['before', 'after'].forEach(function (which) {
        var k = urlOfPath(keyPlanPathFor(sl, which)); if (k) imgs[k] = k;
      });
    });
    return imgs;
  }
  function openPreviewModal(p) {
    var s = slides(p.id);
    if (!s.length) { UI.toast('This presentation has no slides to preview', 'warn'); return; }
    var html =
      '<div class="pd-modal-header"><h3>Preview — ' + esc(p.description || longDate(p.ppr_date)) + '</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="ppr-previewbox">' +
        '<style>' + EXPORT_CSS + '</style>' + slidesBodyHTML(p, s, identityImgs(s)) +
      '</div>';
    openModal(html, 1000);
  }

  // The three export formats, behind one button — "Download…" alone doesn't
  // say which file you'll get, and the three were previously three separate
  // row icons (follow-up feedback item 1: "ask user if format is HTML, PPTX,
  // or PDF").
  function openDownloadChoice(p) {
    var html =
      '<div class="pd-modal-header"><h3>Download presentation</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form"><p class="pp-hint">Choose a format.</p>' +
        '<div class="ppr-fmtchoices">' +
          '<button type="button" class="pd-btn" data-fmt="html">' +
            '<span data-ico="download" data-ico-size="16"></span> Offline HTML' +
            '<small>Opens with no network — best for presenting on-site.</small></button>' +
          '<button type="button" class="pd-btn" data-fmt="pptx">' +
            '<span data-ico="layers" data-ico-size="16"></span> PowerPoint (.pptx)' +
            '<small>Editable slide deck.</small></button>' +
          '<button type="button" class="pd-btn" data-fmt="pdf">' +
            '<span data-ico="clipboard" data-ico-size="16"></span> PDF' +
            '<small>One slide per A4 page, ready to print.</small></button>' +
        '</div></div>';
    var m = openModal(html, 460);
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-fmt]'), function (b) {
      b.onclick = function () {
        var fmt = this.dataset.fmt;
        m.close();
        if (fmt === 'html') exportOffline(p);
        else if (fmt === 'pptx') exportPptx(p);
        else if (fmt === 'pdf') exportPdf(p);
      };
    });
  }

  function openPpr(id) {
    var p = pprById(id); if (!p) return;
    selId = id; viewPprId = id; slideAt = 0; keyPlanOpenPane = { before: false, after: false };
    screen = 'slides';
    render();
  }

  // Item 17: when a slide has BOTH a previous and current photo, its
  // thumbnail is a stacked-photo card — current on top, previous peeking out
  // from behind — instead of one flat image quietly standing in for the
  // pair. Falls back to a single flat thumbnail when only one photo exists.
  // Shared by the single-presentation preview and the combined (multi-
  // selected) preview below, so the two can never draw a slide differently.
  function slideThumbHTML(sl, i, clickable) {
    var u = urlOfPhoto(sl.after_photo_id) || urlOfPhoto(sl.before_photo_id);
    var b = sl.before_photo_id ? urlOfPhoto(sl.before_photo_id) : '';
    var a = sl.after_photo_id ? urlOfPhoto(sl.after_photo_id) : '';
    var slideAttr = clickable ? ' data-slide="' + i + '"' : '';
    var body;
    if (b && a) {
      body = '<div class="ppr-stackcard"' + slideAttr + '>' +
        '<img class="ppr-stack-back" src="' + esc(b) + '" alt="Previous" />' +
        '<img class="ppr-stack-front" src="' + esc(a) + '" alt="Current" />' +
      '</div>';
    } else if (u) {
      body = '<img class="ppr-thumb" src="' + esc(u) + '" alt="Slide ' + (i + 1) + '"' + slideAttr + ' />';
    } else {
      body = '<div class="ppr-thumb pp-noimg"><span data-ico="camera" data-ico-size="16"></span></div>';
    }
    return '<div class="ppr-thumbwrap"><span class="ppr-thumbno">' + (i + 1) + '</span>' + body + '</div>';
  }

  function renderPreview() {
    var body = $('ppr-preview-body'); if (!body) return;
    // Item 16: "preview pane should align the the rows with checked boxes."
    // The preview is now driven ENTIRELY by the CHECKBOX set — 0 checked
    // shows a prompt, 1 shows that one presentation's slides (still
    // clickable into the editor), 2+ combine them (item 14). `selId`
    // ("which presentation is currently OPEN, in the slides screen") no
    // longer drives the LIST screen's preview at all — opening a row
    // navigates away from the list entirely, so there's nothing left on
    // this screen for `selId` to usefully mean here.
    var selIds = visibleSelectedPprIds();
    if (selIds.length >= 2) { renderCombinedPreview(body, selIds); return; }
    var oneId = selIds[0] || null;
    var s = oneId ? slides(oneId) : [];
    if (!oneId || !s.length) {
      body.innerHTML = '<div class="ppr-noslides">' +
        (oneId ? 'No slides to show.' : 'Check a presentation to preview its slides.') + '</div>';
      return;
    }
    body.innerHTML = '<div class="ppr-thumbs">' + s.map(function (sl, i) { return slideThumbHTML(sl, i, true); }).join('') + '</div>';

    Array.prototype.forEach.call(body.querySelectorAll('[data-slide]'), function (im) {
      im.onclick = function () {
        var at = +im.dataset.slide;
        openPpr(oneId); slideAt = at; renderSlides();
      };
    });
    if (window.Icons && Icons.hydrate) Icons.hydrate(body);
  }

  // Item 14's combined preview — each selected presentation's own slides,
  // grouped under its own date/description heading, oldest first (reading
  // order for "how this progressed"). A read-only overview: clicking a
  // thumbnail here does not jump into an editor, unlike the single-
  // presentation preview above, since which of several open presentations a
  // click should land in is ambiguous by construction.
  function renderCombinedPreview(body, ids) {
    var ordered = ids.map(pprById).filter(Boolean)
      .sort(function (a, b) { return String(a.ppr_date || '').localeCompare(String(b.ppr_date || '')); });
    body.innerHTML = '<div class="ppr-combined">' + ordered.map(function (p) {
      var s = slides(p.id);
      return '<div class="ppr-combined-group">' +
        '<div class="ppr-combined-head">' + esc(longDate(p.ppr_date)) +
          (p.description ? ' — ' + esc(p.description) : '') +
          ' <span class="pp-muted">(' + s.length + ' slide' + (s.length === 1 ? '' : 's') + ')</span></div>' +
        (s.length
          ? '<div class="ppr-thumbs">' + s.map(function (sl, i) { return slideThumbHTML(sl, i, false); }).join('') + '</div>'
          : '<div class="ppr-noslides">No slides.</div>') +
      '</div>';
    }).join('') + '</div>';
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
        // Owner feedback: "Back to List" belongs BEFORE the presentation
        // details, not tucked into the topbar (where it used to sit as a
        // breadcrumb beside the screen tabs — see index.html's syncTools,
        // now scoped to the Templates screen only). Rendered as the FIRST
        // child of this header so the reading order is exactly
        // Back Button > Presentation Details > action buttons.
        '<button class="pp-crumbback ppr-slideback" id="ppr-slide-back" title="Back to the presentation list">' +
          '<span data-ico="arrowLeft" data-ico-size="14"></span> Presentations list</button>' +
        // Item 23: the Project field is gone — it's redundant (the topbar
        // project selector already names it, on every screen of this module).
        '<div class="ppr-hfield"><label>Presentation Date</label><span>' + esc(longDate(p.ppr_date)) + '</span></div>' +
        '<div class="ppr-hfield"><label>Description</label><span>' + esc(p.description || '—') + '</span></div>' +
        '<div class="ppr-hfield"><label>Slides</label><span class="ppr-nav">' +
          '<button class="ppr-navbtn" id="ppr-prev" ' + (slideAt <= 0 ? 'disabled' : '') + '>‹</button>' +
          '<strong>' + (s.length ? slideAt + 1 : 0) + '</strong> of ' + s.length +
          '<button class="ppr-navbtn" id="ppr-next" ' + (slideAt >= s.length - 1 ? 'disabled' : '') + '>›</button>' +
        '</span></div>' +
        // Edit/Delete PRESENTATION relocated here (follow-up feedback moved the
        // row's own icons to Download/Preview/Archive only) — this is the
        // screen you're already on when you'd want to rename/re-date it or
        // remove it entirely, so nothing was actually lost.
        '<span class="ppr-hfield ppr-hspacer">' +
          // Slide-sorter (18-item list item 12) — only worth offering with
          // something to reorder; a 1-slide (or empty) presentation has no
          // possible order to change. Item 20: the icon is now a swap glyph
          // (was a generic "layout" icon that read as unrelated to reordering).
          // It reorders (a write), so it's canWrite-gated like Edit/Delete.
          (canWrite && s.length > 1 ? '<button class="pp-iconbtn" id="ppr-sort" title="Reorder slides">' +
            '<span data-ico="swap" data-ico-size="15"></span></button>' : '') +
          // Sixth round item 6: "no need for the full size preview button" —
          // that button opened a modal reproducing the SAME pane already on
          // screen (you're already viewing this exact slide full-size while
          // editing it), and was removed. This is a DIFFERENT feature: the
          // list row's own "Preview" (openPreviewModal, all of the
          // presentation's slides at once) had no way back INTO it once you
          // opened the presentation to edit it — restored here so it's
          // reachable from both places, not just the list. Preview and
          // Download are reads (never gated by canWrite, same as the list
          // row's own Preview/Download always were); Archive/Edit/Delete
          // mutate the record and stay writer-only.
          '<button class="pp-iconbtn" id="ppr-pres-preview" title="Preview this presentation\'s slides">' +
            '<span data-ico="eye" data-ico-size="15"></span></button>' +
          '<button class="pp-iconbtn" id="ppr-pres-dl" title="Download this presentation">' +
            '<span data-ico="download" data-ico-size="15"></span></button>' +
          (canWrite ? '<button class="pp-iconbtn" id="ppr-pres-arch" title="' + (p.archived ? 'Restore from archive' : 'Archive presentation') + '">' +
            '<span data-ico="folder" data-ico-size="15"></span></button>' +
          '<button class="pp-iconbtn" id="ppr-pres-edit" ' +
          'title="Edit presentation details"><span data-ico="pencil" data-ico-size="15"></span></button>' +
          '<button class="pp-iconbtn pp-del" id="ppr-pres-del" title="Delete presentation">' +
          '<span data-ico="trash" data-ico-size="15"></span></button>' : '') +
        '</span>' +
      '</div>';

    if (!s.length) {
      host.innerHTML = header + '<div class="pp-empty"><p>This presentation has no slides yet.</p>' +
        (canWrite ? '<p class="pp-hint">Add a slide by picking this period\'s photo, optionally ' +
                    'paired with an earlier one to compare against.</p>' +
                    '<p><button class="pd-btn pd-btn-primary" id="ppr-slide-add">+ Add slide</button></p>'
                  : '') + '</div>';
      wireSlideNav(s); wirePresActs(p);
      if ($('ppr-slide-add')) $('ppr-slide-add').onclick = function () { openSlideForm(null); };
      return;
    }

    // ⚠️ Trade / Works / Location are NO LONGER slide-level. A slide's two photos
    // may sit at DIFFERENT locations (owner feedback), so a single slide-wide
    // location was actively wrong — each pane now shows its own photo's tags,
    // read straight from progress_photos. `cur.trade/works/location` survive on
    // old rows and are only used as a fallback when a pane has no photo linked.
    var hasBefore = !!cur.before_photo_id;
    // Item 21: the shared "Key Plan" meta row is GONE — each pane now
    // carries its own show/hide icon (wired inside pane()/wirePaneMarkup
    // below), so there is nothing left for a top-of-slide toggle to do.

    // If both photos are at the SAME location, show it ONCE above the pair
    // instead of repeating it on each pane (follow-up feedback item 3, and
    // item 22 — split into each pane's OWN location line when they differ,
    // handled inside pane() via `hideLocation`).
    var sharedLoc = hasBefore ? sharedLocationOf(cur) : '';
    var sharedLocHTML = sharedLoc
      ? '<div class="ppr-sharedloc"><span data-ico="mapPin" data-ico-size="14"></span>' + esc(sharedLoc) + '</div>'
      : '';

    // No before photo → don't render an empty "Photo not set" frame beside it;
    // show just the current photo, centered (owner feedback).
    var pairHTML = hasBefore
      ? '<div class="ppr-pair">' + pane(cur, 'before', !!sharedLoc) + pane(cur, 'after', !!sharedLoc) + '</div>'
      : '<div class="ppr-pair ppr-pair-single">' + pane(cur, 'after', false) + '</div>';

    host.innerHTML = header + sharedLocHTML + pairHTML +
      (canWrite ? '<div class="ppr-slideacts">' +
        '<button class="pd-btn pd-btn-primary" id="ppr-slide-add">+ Add slide</button>' +
        '<button class="pd-btn" id="ppr-slide-edit">Edit slide</button>' +
        '<button class="pd-btn pd-btn-danger" id="ppr-slide-del">Delete slide</button></div>' : '');

    wireSlideNav(s); wirePresActs(p);
    if ($('ppr-slide-add')) $('ppr-slide-add').onclick = function () { openSlideForm(null); };
    if ($('ppr-slide-edit')) $('ppr-slide-edit').onclick = function () { openSlideForm(cur); };
    if ($('ppr-slide-del')) $('ppr-slide-del').onclick = function () { removeSlide(cur); };
    ['before', 'after'].forEach(function (which) {
      var kp = $('ppr-kp-' + which);
      if (kp) kp.onclick = function () { keyPlanOpenPane[which] = !keyPlanOpenPane[which]; renderSlides(); };
    });
    wirePaneMarkup(cur);
    hydrate();
  }

  function wirePresActs(p) {
    // Back button now lives INSIDE the slide header itself (owner feedback:
    // Back Button > Presentation Details > action buttons) rather than the
    // topbar's own #ppr-back, which is now scoped to the Templates screen
    // only (see index.html/syncTools). Same behaviour #ppr-back always had.
    if ($('ppr-slide-back')) $('ppr-slide-back').onclick = function () { screen = 'list'; render(); };
    if ($('ppr-pres-edit')) $('ppr-pres-edit').onclick = function () { openPprForm(p); };
    if ($('ppr-pres-del')) $('ppr-pres-del').onclick = function () { removePpr(p); };
    if ($('ppr-sort')) $('ppr-sort').onclick = function () { openSlideSorter(p); };
    if ($('ppr-pres-arch')) $('ppr-pres-arch').onclick = function () { toggleArchive(p); };
    if ($('ppr-pres-dl')) $('ppr-pres-dl').onclick = function () { openDownloadChoice(p); };
    if ($('ppr-pres-preview')) $('ppr-pres-preview').onclick = function () { openPreviewModal(p); };
  }

  // ------------------------------------------------------ slide-sorter (item 12) ---
  // A grid of slide thumbnails (each slide's Current photo, matching the
  // preview pane's own headline-image rule) that reorders on native HTML5
  // drag-and-drop, writing the new order back to ppr_slides.slide_no.
  // ⚠️ Reordered in a LOCAL COPY of the array first — nothing is written until
  // the sequence is settled, and cancelling the modal (× / backdrop) discards
  // it entirely, leaving the saved order untouched. This mirrors the copy
  // wizard's own "nothing is saved until you're done" rule (2026-08-29), just
  // for a reorder instead of a multi-step build.
  // Pure — splices `from` out and reinserts at `to`, returning a NEW array
  // (never mutates its argument) so it can be genuinely executed by a test
  // without needing a real drag event. Exported as a test-only hook.
  function moveItem(arr, from, to) {
    var copy = arr.slice();
    var moved = copy.splice(from, 1)[0];
    copy.splice(to, 0, moved);
    return copy;
  }

  function openSlideSorter(p) {
    var draft = slides(p.id);       // local working copy, index = current position
    var dragFrom = -1;

    // Item 19: "add also the location details per photo" — each slide's
    // current (and, if different, previous) photo location, since the two
    // aren't required to match (2026-08-29 feedback already made that a
    // real possibility). Sixth round item 8: the CURRENT photo's Works value
    // is shown too — that's the one thing this pop-up needs to say what a
    // slide is actually OF, since the thumbnail alone can't (and the reorder
    // decision is usually "which stage of work goes first").
    function thumbHTML(sl, i) {
      var u = urlOfPhoto(sl.after_photo_id) || urlOfPhoto(sl.before_photo_id);
      var aph = photoById(sl.after_photo_id), bph = photoById(sl.before_photo_id);
      var locs = [];
      if (aph && aph.location) locs.push(aph.location);
      if (bph && bph.location && bph.location !== aph.location) locs.push(bph.location + ' (previous)');
      var works = (aph && aph.works) || sl.works || '';
      return '<div class="ppr-sortitem" draggable="true" data-i="' + i + '">' +
        '<span class="ppr-sortno">' + (i + 1) + '</span>' +
        (u ? '<img class="ppr-sortthumb" src="' + esc(u) + '" alt="Slide ' + (i + 1) + '" />'
           : '<div class="ppr-sortthumb pp-noimg"><span data-ico="camera" data-ico-size="16"></span></div>') +
        (works ? '<div class="ppr-sortworks">' + esc(works) + '</div>' : '') +
        (locs.length ? '<div class="ppr-sortloc">' + esc(locs.join(' · ')) + '</div>' : '') +
        '</div>';
    }

    var m = openModal(
      '<div class="pd-modal-header"><h3>Reorder slides</h3><button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        '<p class="pp-hint">Drag a slide to move it. Numbers update as you go — nothing is saved until you click Save order.</p>' +
        '<div class="ppr-sortgrid" id="ppr-sortgrid"></div>' +
      '</div>' +
      '<div class="pd-modal-footer">' +
        '<button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="ppr-sort-save">Save order</button>' +
      '</div>', 720);

    function paint() {
      var grid = m.el.querySelector('#ppr-sortgrid');
      grid.innerHTML = draft.map(thumbHTML).join('');
      if (window.Icons && Icons.hydrate) Icons.hydrate(grid);
      Array.prototype.forEach.call(grid.querySelectorAll('.ppr-sortitem'), function (el) {
        el.ondragstart = function (ev) {
          dragFrom = +el.dataset.i;
          el.classList.add('is-dragging');
          if (ev.dataTransfer) { ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData('text/plain', String(dragFrom)); } catch (e) {} }
        };
        el.ondragend = function () { el.classList.remove('is-dragging'); };
        el.ondragover = function (ev) { ev.preventDefault(); el.classList.add('is-dragover'); };
        el.ondragleave = function () { el.classList.remove('is-dragover'); };
        el.ondrop = function (ev) {
          ev.preventDefault(); el.classList.remove('is-dragover');
          var to = +el.dataset.i;
          if (dragFrom < 0 || dragFrom === to) return;
          draft = moveItem(draft, dragFrom, to);
          dragFrom = -1;
          paint();
        };
      });
    }
    paint();

    m.el.querySelector('#ppr-sort-save').onclick = async function () {
      var btn = m.el.querySelector('#ppr-sort-save');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        // Sequential, small N (a presentation's slide count) — same per-row
        // update convention already used throughout this file rather than a
        // single bulk statement supabase-js has no clean way to express here.
        for (var i = 0; i < draft.length; i++) {
          if ((draft[i].slide_no || 0) === i + 1) continue;   // unchanged position, skip the round-trip
          var res = await sb().from(T_SLIDE).update({ slide_no: i + 1 }).eq('id', draft[i].id);
          if (res.error) throw res.error;
          draft[i].slide_no = i + 1;
        }
        slidesOf[p.id] = draft;
        slideAt = 0;
        m.close();
        renderSlides();
        UI.toast('Slide order saved', 'ok');
      } catch (e) {
        UI.toast('Could not save the new order: ' + ((e && e.message) || e), 'error');
        btn.disabled = false; btn.textContent = 'Save order';
      }
    };
  }

  // A slide's two photos are only required to be at the SAME location often
  // enough that repeating the tag on both panes reads as redundant, but they
  // are NOT required to match — comparing progress across two different spots
  // is a real, supported use of "previous vs current". Exact string equality
  // on the already-resolved `location` display field (both photos' own
  // breadcrumb) — not location_values, which can carry keys one photo's
  // breakdown never reached (a deeper level filled in over time).
  function sharedLocationOf(sl) {
    var b = photoById(sl.before_photo_id), a = photoById(sl.after_photo_id);
    if (!b || !a || !b.location || !a.location) return '';
    return b.location === a.location ? b.location : '';
  }

  // Key plan is per PHOTO now (progress_photos.key_plan_url), with the legacy
  // slide-level key_plan_url honoured as a fallback so PPRs built before the
  // 2026-08-28 migration keep rendering their overlay.
  function keyPlanPathFor(sl, which) {
    var ph = photoById(which === 'before' ? sl.before_photo_id : sl.after_photo_id);
    return (ph && ph.key_plan_url) || sl.key_plan_url || '';
  }

  // `hideLocation` is true when renderSlides() already printed the two photos'
  // shared location once, above the pair (follow-up feedback item 3) — this
  // pane's own head then shows no location line at all, since it was already
  // said. When `hideLocation` is FALSE (the two differ, or only one photo
  // exists), item 22's "split" is simply: EACH pane states its own location,
  // here, in its own head tile.
  function pane(sl, which, hideLocation) {
    var photoId = which === 'before' ? sl.before_photo_id : sl.after_photo_id;
    var ph = photoById(photoId);
    var u = urlOfPhoto(photoId);
    var cap = (which === 'before' ? sl.before_caption : sl.after_caption) ||
              (ph ? ph.description : '') || '';
    // Item 21: the key plan is per-pane now — its own icon, its own popup,
    // independent of the other pane. Only offered when this SPECIFIC photo
    // actually has one (never a speculative, usually-inert icon).
    var kpPath = keyPlanPathFor(sl, which);
    var kpOpen = keyPlanOpenPane[which];
    var kpIcon = kpPath
      ? '<button class="ppr-kpicon' + (kpOpen ? ' is-active' : '') + '" id="ppr-kp-' + which + '" ' +
        'title="Show/hide this photo\'s key plan"><span data-ico="mapPin" data-ico-size="14"></span></button>'
      : '';
    var kpPopup = (kpOpen && kpPath) ? '<div class="ppr-kppopup"><img src="' + esc(urlOfPath(kpPath)) + '" alt="Key plan" /></div>' : '';
    // Each pane carries its own Location, since the two photos are no longer
    // required to share one. Sixth round item 10: location is now ALWAYS
    // rendered (an em-dash when unset, matching Date/Description below)
    // rather than silently vanishing whenever the photo has none — it must
    // not read as "the location line disappeared", only "not set".
    // `hideLocation` still suppresses it here specifically because the SAME
    // value is already shown once, above the pair, when both photos agree.
    var loc = hideLocation ? null : (ph ? ph.location : sl.location) || '';
    // Presentation-only markup (item 14) — never on the offline/PDF/PPTX
    // exports (those are the record of what was PRESENTED; this overlay is a
    // live annotation aid), and never shown at all without an actual photo.
    var mk = u ? markupFor(sl.id, which) : [];
    var mkKey = markupKey(sl.id, which);
    var mkVisible = showMarkup[mkKey] !== false;
    var mkTools = u ? '<div class="ppr-panetools">' +
      (mk.length ? '<button class="ppr-mktool' + (mkVisible ? ' is-active' : '') + '" ' +
        'id="ppr-mktoggle-' + which + '" title="Show/hide markup">' +
        '<span data-ico="eye" data-ico-size="13"></span></button>' : '') +
      (canWrite ? '<button class="ppr-mktool" id="ppr-mkedit-' + which + '" title="Edit markup">' +
        '<span data-ico="palette" data-ico-size="13"></span></button>' : '') +
      '</div>' : '';
    // Item 22/23: capture date / description / works move ABOVE the image
    // (previously a figcaption below it) — a per-pane "head" tile, holding
    // its own location line when the shared tile above the pair doesn't
    // already cover it.
    return '<figure class="ppr-pane">' +
      // "Previous"/"Current" is the user-facing label (owner feedback, item 7:
      // less ambiguous than Before/After for a recurring capture). The
      // internal `which` discriminator stays 'before'/'after' throughout this
      // file — it's a private parameter value, never displayed, and renaming
      // it everywhere (this function, keyPlanPathFor, slideFigureHTML, the
      // form field ids) would touch ~30 call sites for no user-visible gain.
      // Sixth round item 9: Current gets the filled brand-red chip (it's the
      // stage being reported on), Previous the quieter outlined one — so the
      // two panes read as distinct at a glance, not just by left/right order.
      '<div class="ppr-panelabel' + (which === 'after' ? ' is-current' : '') + '">' + (which === 'before' ? 'Previous' : 'Current') + '</div>' +
      // Sixth round items 10/11: Location is always shown (never silently
      // absent when unset), and Date/Description each carry an explicit
      // label — previously both were bare values with no indication of
      // which was which. The Trade/Works tag line is gone entirely: "no
      // need to include as caption all the activities performed or assigned
      // to the photo" — the caption is now Location, Date and Description
      // only.
      '<div class="ppr-panehead">' +
        (hideLocation ? '' : '<div class="ppr-panehead-loc"><span data-ico="mapPin" data-ico-size="12"></span>' +
          '<span class="ppr-panehead-lbl">Location</span> ' + (loc ? esc(loc) : '—') + '</div>') +
        '<div class="ppr-capdate"><span class="ppr-panehead-lbl">Date</span> ' + esc(ph && ph.taken_at ? capDate(ph.taken_at) : '—') + '</div>' +
        '<div class="ppr-captxt"><span class="ppr-panehead-lbl">Description</span> ' + esc(cap || '—') + '</div>' +
      '</div>' +
      '<div class="ppr-imgwrap">' +
        (u ? '<img class="ppr-img" src="' + esc(u) + '" alt="' + esc(cap) + '" />'
           : '<div class="ppr-img pp-noimg"><span>Photo not set</span></div>') +
        (u && mk.length && mkVisible ? '<canvas class="ppr-mkcanvas" id="ppr-mkcanvas-' + which + '"></canvas>' : '') +
        mkTools + kpIcon + kpPopup +
      '</div>' +
    '</figure>';
  }

  // Called after renderSlides() paints — sizes each pane's overlay canvas to
  // the image's own rendered box (a canvas has no intrinsic size of its own)
  // and paints it via the SHARED drawing routine module.js exports, then
  // wires the toggle/edit buttons. `cur` is the slide object currently shown.
  function wirePaneMarkup(cur) {
    ['before', 'after'].forEach(function (which) {
      var photoId = which === 'before' ? cur.before_photo_id : cur.after_photo_id;
      var cv = $('ppr-mkcanvas-' + which);
      if (cv) {
        var wrap = cv.parentElement;
        var paint = function () {
          var w = wrap.clientWidth, h = wrap.clientHeight;
          if (!w || !h) return;
          cv.width = w; cv.height = h;
          if (window.ProgressPhotos && ProgressPhotos.drawMarkupOnCanvas) {
            ProgressPhotos.drawMarkupOnCanvas(cv, markupFor(cur.id, which));
          }
        };
        var img = wrap.querySelector('img.ppr-img');
        if (img && img.complete && img.naturalWidth) paint();
        else if (img) img.addEventListener('load', paint, { once: true });
        else paint();
      }
      var tgl = $('ppr-mktoggle-' + which);
      if (tgl) tgl.onclick = function () {
        var key = markupKey(cur.id, which);
        showMarkup[key] = !(showMarkup[key] !== false);
        renderSlides();
      };
      var edt = $('ppr-mkedit-' + which);
      if (edt) edt.onclick = function () {
        var u = urlOfPhoto(photoId);
        if (!u) { UI.toast('Pick a photo for this pane before adding markup', 'warn'); return; }
        ProgressPhotos.openMarkupEditor(u, markupFor(cur.id, which), function (objs) {
          saveSlideMarkup(cur.id, which, objs);
        });
      };
    });
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
      var desc = $('ppr-f-desc').value.trim();
      var copyFrom = $('ppr-f-copy') ? $('ppr-f-copy').value : '';

      // Copying from a previous presentation now goes through a wizard
      // (follow-up feedback item 6) that REQUIRES a current photo on every
      // slide before anything is written — so the presentation itself is not
      // created here at all in that case; the wizard creates BOTH the
      // presentation row and its finished slides together, in one place, only
      // once every slide has been given a current photo. Cancelling the
      // wizard leaves NOTHING behind: no orphan presentation, no half-copied
      // slides.
      if (isNew && copyFrom) {
        m.close();
        openCopyWizard({ ppr_date: date, description: desc }, copyFrom);
        return;
      }

      this.disabled = true;
      var data = { ppr_date: date, description: desc };
      var res, newId = null;
      if (isNew) {
        // .select() so the new id comes back — needed to jump straight to its editor.
        res = await sb().from(T_PPR)
          .insert(Object.assign(data, { project_id: pid, created_by: uid })).select();
        if (!res.error) newId = res.data && res.data[0] && res.data[0].id;
      } else {
        res = await sb().from(T_PPR)
          .update(Object.assign(data, { updated_at: new Date().toISOString() })).eq('id', p.id);
      }
      if (res.error) { UI.toast(res.error.message, 'error'); this.disabled = false; return; }

      m.close();
      UI.toast(isNew ? 'Presentation created' : 'Presentation updated', 'ok');
      await load();
      // After creating, go straight into the slides editor (owner feedback:
      // "after adding PPR, it should go to PPR edit") rather than dropping the
      // user back on the list with nothing obviously to do next.
      if (isNew && newId) openPpr(newId);
    };
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
  // Two photos are "at the same location" when their own resolved `location`
  // breadcrumbs match exactly — the same field sharedLocationOf() compares.
  function sameLocation(a, b) { return !!(a && b && a.location && b.location && a.location === b.location); }

  // The candidate set for a picker, relative to a fixed reference photo:
  // `direction` 'before' keeps only photos captured STRICTLY EARLIER than
  // `refPhoto` (used for the Previous picker, item 5: "previous photo's
  // capture date must be before current's"); 'after' keeps only photos
  // captured ON OR AFTER it (used by the copy wizard, which fixes Previous
  // first and needs a LATER Current). No `refPhoto`, or either side missing a
  // capture date, skips the date test entirely — comparing against "unknown"
  // would just as likely hide the right photo as the wrong one.
  // `allowAllLocations` lifts the same-location restriction (item 9's
  // override checkbox); the reference photo itself is always excluded (a
  // slide comparing a photo to itself is never a real "previous vs current").
  function eligiblePhotos(refPhoto, direction, allowAllLocations) {
    return photos.filter(function (cand) {
      if (refPhoto && cand.id === refPhoto.id) return false;
      if (refPhoto && refPhoto.taken_at && cand.taken_at) {
        if (direction === 'before' && !(cand.taken_at < refPhoto.taken_at)) return false;
        if (direction === 'after' && !(cand.taken_at >= refPhoto.taken_at)) return false;
      }
      if (refPhoto && !allowAllLocations && !sameLocation(cand, refPhoto)) return false;
      return true;
    }).sort(function (a, b) { return String(b.taken_at || '').localeCompare(String(a.taken_at || '')); });
  }

  // A searchable grid of photo THUMBNAILS (item 6 of the original 18-item
  // list: "photo pickers should show thumbnails, not plain text"), reused by
  // both the ordinary slide form below and the copy wizard's per-step Current
  // picker. `opts`: title, candidates (already filtered/sorted), currentId,
  // allowNone (Previous only — Current is always required), emptyHint,
  // onPick(idOrNull).
  //
  // 2026-08-30 items 18/24: "there is both a pick a photo and add photo
  // button — there should only be pick a photo, and the add photo button
  // should be INSIDE the pick-a-photo pop-up." The upload affordance moves
  // here, once, so it's available to every caller of this picker (the slide
  // form's Current/Previous pickers AND the copy wizard's) instead of being
  // duplicated at each call site as a second, sibling button.
  function openThumbPicker(opts) {
    var html =
      '<div class="pd-modal-header"><h3>' + esc(opts.title) + '</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        '<input class="pd-input" id="ppr-pp-search" placeholder="Search description, location, trade…" ' +
          'style="margin-bottom:10px;width:100%;box-sizing:border-box;" />' +
        '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
          '<button type="button" class="pd-btn pd-btn-primary" id="ppr-pp-upload">+ Upload new photo</button>' +
          (opts.allowNone ? '<button type="button" class="pd-btn" id="ppr-pp-none">— None (clear) —</button>' : '') +
        '</div>' +
        '<div class="ppr-pickgrid" id="ppr-pp-grid"></div>' +
      '</div>';
    var m = openModal(html, 660);
    function paint(q) {
      q = (q || '').toLowerCase();
      var list = opts.candidates.filter(function (p) {
        if (!q) return true;
        var hay = [p.description, p.location, p.trade, p.works].filter(Boolean).join(' ').toLowerCase();
        return hay.indexOf(q) >= 0;
      });
      var grid = $('ppr-pp-grid');
      grid.innerHTML = list.length ? list.map(function (p) {
        var u = urlOfPhoto(p.id);
        var cap = [capDate(p.taken_at), p.description].filter(Boolean).join(' · ');
        return '<button type="button" class="ppr-pickitem' + (p.id === opts.currentId ? ' sel' : '') +
          '" data-id="' + esc(p.id) + '">' +
          (u ? '<img src="' + esc(u) + '" alt="" />' :
               '<div class="ppr-picknoimg"><span data-ico="camera" data-ico-size="18"></span></div>') +
          '<span class="ppr-pickcap"><span class="d">' + esc(cap || '(no description)') + '</span>' +
          (p.location ? '<br>' + esc(p.location) : '') + '</span></button>';
      }).join('') : '<p class="pp-hint">' + esc(opts.emptyHint || 'No matching photos.') + '</p>';
      Array.prototype.forEach.call(grid.querySelectorAll('[data-id]'), function (b) {
        b.onclick = function () { m.close(); opts.onPick(this.dataset.id); };
      });
      if (window.Icons) Icons.hydrate(grid);
    }
    paint('');
    if ($('ppr-pp-search')) $('ppr-pp-search').oninput = function () { paint(this.value); };
    if ($('ppr-pp-none')) $('ppr-pp-none').onclick = function () { m.close(); opts.onPick(null); };
    // Item 24 — "+ Upload new photo", now living INSIDE the picker. Reuses
    // the Photos screen's own Add-media modal, reloads the library so the
    // new row is pickable, then selects it exactly as this slide's
    // Current/Previous choice — same recovery for PDSync's offline outbox
    // (which can't report an inserted id) this flow already relied on.
    if ($('ppr-pp-upload')) $('ppr-pp-upload').onclick = function () {
      ProgressPhotos.openUploadForPicker(async function (newIds) {
        var before = photos.map(function (p) { return p.id; });
        await reloadPhotos();
        var pickId = (newIds && newIds[0]) || photos.filter(function (p) {
          return before.indexOf(p.id) < 0;
        }).map(function (p) { return p.id; })[0];
        if (!pickId) return;   // queued offline — nothing to pick yet
        m.close();
        opts.onPick(pickId);
      });
    };
  }

  // The slide form is PHOTO-FIRST (owner feedback: "for adding slides, you can
  // add photos instead of selecting locations"). Trade / Works / Location are
  // no longer asked for at all — they're properties of the photo, shown
  // read-only once one is picked, and rendered per-pane in the slides view.
  //
  // ⚠️ Current is now REQUIRED (was: "at least one of the two"), and Previous
  // is hidden entirely until Current is set (18-item list, items 9/10/11):
  // "previous photo should never be allowed without a current photo." The
  // Previous picker defaults to the SAME location as Current and to photos
  // captured strictly earlier, both liftable — location via the "Show all
  // locations" checkbox, date is a hard rule since a "previous" that comes
  // AFTER the "current" is a fact, not a preference.
  function openSlideForm(sl) {
    var isNew = !sl; sl = sl || {};
    var afterId = sl.after_photo_id || null;
    var beforeId = sl.before_photo_id || null;
    var beforeAllLocs = false;

    function pickBtnHTML(which, id) {
      var ph = photoById(id);
      if (!ph) return '<button type="button" class="pd-btn" id="ppr-s-' + which + '-btn">Pick a photo…</button>';
      var u = urlOfPhoto(ph.id);
      var tags = [ph.trade, ph.works, ph.location].filter(Boolean).join(' · ');
      return '<button type="button" class="ppr-pickchosen" id="ppr-s-' + which + '-btn">' +
        (u ? '<img src="' + esc(u) + '" alt="" />' : '') +
        '<span><strong>' + esc(ph.description || '(no description)') + '</strong>' +
        (ph.taken_at ? '<br>' + esc(capDate(ph.taken_at)) : '') +
        (tags ? '<br>' + esc(tags) : '') + '<br><em>Change…</em></span></button>';
    }

    var html =
      '<div class="pd-modal-header"><h3>' + (isNew ? 'Add slide' : 'Edit slide') + '</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        '<p class="pp-hint">Pick this period\'s photo first, then optionally an earlier one to ' +
          'compare it against. The two may be at <strong>different locations</strong>. Each photo ' +
          'brings its own trade, works, location and key plan with it.</p>' +
        '<div class="pp-form2">' +

          '<div class="pd-field pp-span2"><label>Current photo' + reqMark() + '</label>' +
            '<div class="ppr-pickrow"><span id="ppr-s-after-slot">' + pickBtnHTML('after', afterId) + '</span></div></div>' +
          '<div class="pd-field pp-span2"><label>Caption for the current photo</label>' +
            '<input class="pd-input" id="ppr-s-acap" placeholder="e.g. Aerial View facing Marikina River ftm of June 2026." value="' +
            esc(sl.after_caption || '') + '" /></div>' +

          '<div class="pd-field pp-span2" id="ppr-s-before-field" style="display:none;">' +
            '<label>Previous photo <span class="pp-optnote">(optional — leave empty to show the current photo on its own)</span></label>' +
            '<label class="ppr-allloc"><input type="checkbox" id="ppr-s-alllocs" /> Show all locations, not just the current photo\'s</label>' +
            '<div class="ppr-pickrow"><span id="ppr-s-before-slot">' + pickBtnHTML('before', beforeId) + '</span></div></div>' +
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

    function syncVisibility() {
      $('ppr-s-before-field').style.display = afterId ? '' : 'none';
      $('ppr-s-bcap-field').style.display = beforeId ? '' : 'none';
    }
    function repaintPickBtn(which) {
      $('ppr-s-' + which + '-slot').innerHTML = pickBtnHTML(which, which === 'after' ? afterId : beforeId);
      wirePickBtn(which);
      if (window.Icons) Icons.hydrate($('ppr-s-' + which + '-slot'));
    }
    function wirePickBtn(which) {
      var btn = $('ppr-s-' + which + '-btn'); if (!btn) return;
      btn.onclick = function () { openPickerFor(which); };
    }
    function openPickerFor(which) {
      if (which === 'after') {
        openThumbPicker({
          title: 'Pick the current photo', candidates: eligiblePhotos(null, null, true),
          currentId: afterId, allowNone: false, onPick: setAfter
        });
      } else {
        var afterPh = photoById(afterId);
        openThumbPicker({
          title: 'Pick the previous photo',
          candidates: eligiblePhotos(afterPh, 'before', beforeAllLocs),
          currentId: beforeId, allowNone: true,
          emptyHint: beforeAllLocs
            ? 'No earlier photos exist for this project.'
            : 'No earlier photos at the current photo\'s location. Tick "Show all locations" above to see every earlier photo.',
          onPick: setBefore
        });
      }
    }
    function setAfter(id) {
      afterId = id;
      var ph = photoById(id);
      if (ph && !$('ppr-s-acap').value) $('ppr-s-acap').value = ph.description || '';
      // A Previous photo picked under the OLD current photo may no longer be a
      // valid pairing (wrong side of the new date, or a different location
      // with "Show all locations" off) — cleared rather than silently kept.
      if (beforeId) {
        var stillOk = eligiblePhotos(ph, 'before', beforeAllLocs).some(function (p) { return p.id === beforeId; });
        if (!stillOk) {
          beforeId = null;
          UI.toast('The previous photo no longer matches the new current photo and was cleared', 'warn');
        }
      }
      // Non-blocking duplicate warning (18-item list, item 11) — checked
      // against every OTHER slide of this presentation, not this one being
      // edited.
      var dup = slides(viewPprId).some(function (s2) { return s2.id !== sl.id && s2.after_photo_id === id; });
      if (dup) UI.toast('This photo is already the current photo on another slide in this presentation', 'warn');
      repaintPickBtn('after'); repaintPickBtn('before'); syncVisibility();
    }
    function setBefore(id) {
      beforeId = id;
      var ph = photoById(id);
      if (ph && !$('ppr-s-bcap').value) $('ppr-s-bcap').value = ph.description || '';
      repaintPickBtn('before'); syncVisibility();
    }

    wirePickBtn('after'); wirePickBtn('before'); syncVisibility();
    if ($('ppr-s-alllocs')) $('ppr-s-alllocs').onchange = function () { beforeAllLocs = this.checked; };
    // Item 18/24: uploading a new photo now happens INSIDE the "Pick a
    // photo…" popup itself (openThumbPicker's own "+ Upload new photo"
    // button) — there is no longer a separate sibling "+ Add photo" button
    // here at all, so every slide keeps to exactly one Current photo and at
    // most one Previous, with one single way to attach either.

    $('ppr-s-save').onclick = async function () {
      if (!afterId) { UI.toast('Pick a current photo for this slide', 'warn'); return; }
      if (beforeId && !afterId) { UI.toast('A slide needs a current photo before a previous one can be added', 'warn'); return; }
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

  // ------------------------------------------------------- copy-from wizard --
  // Follow-up feedback item 6: copying a previous presentation must never
  // produce a slide with a Previous photo and no Current — the OLD immediate
  // copySlidesFrom() (removed) inserted every slide with `after_photo_id:
  // null`, which is exactly that state. Nothing is written until every draft
  // slide has been given a current photo; cancelling at any point leaves NO
  // trace at all — not even the presentation row, which this function creates
  // itself only on Finish (openPprForm's save handler no longer creates it
  // when a copy source is chosen).
  // Each draft PROMOTES the source slide's current photo into the new slide's
  // previous slot (same rule the old copySlidesFrom used) and starts with no
  // current photo — that's the gap the wizard exists to close before
  // anything saves. A standalone function (not inlined into openCopyWizard)
  // so it can be genuinely executed by test.js, the same way _tradesOf/
  // _mediaStripMatches are — this is exactly the kind of "off-by-one in the
  // promotion" mistake worth actually running rather than only reading.
  function buildCopyDrafts(src) {
    return src.map(function (s, i) {
      return {
        slide_no: i + 1,
        before_photo_id: s.after_photo_id || s.before_photo_id || null,
        before_caption: s.after_caption || s.before_caption || null,
        after_photo_id: null,
        after_caption: ''
      };
    });
  }

  function openCopyWizard(newData, fromPprId) {
    var src = slides(fromPprId);
    if (!src.length) {
      // Nothing to copy from — same as "start empty", no wizard needed.
      createPresentationPlain(newData);
      return;
    }
    var drafts = buildCopyDrafts(src);
    var step = 0;

    function paneReadOnlyHTML(photoId, label) {
      var ph = photoById(photoId);
      if (!ph) return '<div class="ppr-wizpane"><div class="ppr-panelabel">' + esc(label) + '</div>' +
        '<div class="ppr-img pp-noimg"><span>Photo not set</span></div></div>';
      var u = urlOfPhoto(ph.id);
      return '<div class="ppr-wizpane"><div class="ppr-panelabel">' + esc(label) + '</div>' +
        (u ? '<img class="ppr-img" src="' + esc(u) + '" alt="" />' : '') +
        '<div class="ppr-captxt">' + esc(ph.description || '—') +
        (ph.taken_at ? ' · ' + esc(capDate(ph.taken_at)) : '') + '</div></div>';
    }

    function render() {
      var d = drafts[step];
      var afterPh = photoById(d.after_photo_id);
      var body =
        '<p class="ppr-wizstep">Slide ' + (step + 1) + ' of ' + drafts.length + '</p>' +
        '<div class="ppr-pair">' + paneReadOnlyHTML(d.before_photo_id, 'Previous') +
          '<div class="ppr-wizpane">' +
            '<div class="ppr-panelabel">Current' + reqMark() + '</div>' +
            (afterPh
              ? ('<img class="ppr-img" src="' + esc(urlOfPhoto(afterPh.id)) + '" alt="" />' +
                 '<div class="ppr-captxt">' + esc(afterPh.description || '—') +
                 (afterPh.taken_at ? ' · ' + esc(capDate(afterPh.taken_at)) : '') + '</div>')
              : '<div class="ppr-img pp-noimg"><span>Not picked yet</span></div>') +
            '<button type="button" class="pd-btn" id="ppr-wiz-pick">' +
              (afterPh ? 'Change current photo…' : 'Pick current photo…') + '</button>' +
          '</div></div>' +
        '<div class="pd-field pp-span2"><label>Caption for the current photo</label>' +
          '<input class="pd-input" id="ppr-wiz-cap" value="' + esc(d.after_caption || '') + '" /></div>';
      var html =
        '<div class="pd-modal-header"><h3>Copy presentation — pick this period\'s photos</h3>' +
          '<button class="pd-modal-close" data-close>×</button></div>' +
        '<div class="pp-form">' + body + '</div>' +
        '<div class="pd-modal-footer">' +
          '<button class="pd-btn" data-close>Cancel</button>' +
          (step > 0 ? '<button class="pd-btn" id="ppr-wiz-prev">‹ Back</button>' : '') +
          (step < drafts.length - 1
            ? '<button class="pd-btn pd-btn-primary" id="ppr-wiz-next" ' + (afterPh ? '' : 'disabled') + '>Next ›</button>'
            : '<button class="pd-btn pd-btn-primary" id="ppr-wiz-finish" ' + (afterPh ? '' : 'disabled') + '>Finish</button>') +
        '</div>';
      if (m) { m.el.querySelector('.pd-modal').innerHTML = html; wire(); if (window.Icons) Icons.hydrate(m.el); }
      else { m = openModal(html, 640); wire(); }
    }
    function wire() {
      $('ppr-wiz-cap').oninput = function () { drafts[step].after_caption = this.value; };
      $('ppr-wiz-pick').onclick = function () {
        var beforePh = photoById(drafts[step].before_photo_id);
        openThumbPicker({
          title: 'Pick this period\'s photo', candidates: eligiblePhotos(beforePh, 'after', false),
          currentId: drafts[step].after_photo_id, allowNone: false,
          emptyHint: 'No later photos at the previous photo\'s location yet.',
          onPick: function (id) {
            drafts[step].after_photo_id = id;
            var ph = photoById(id);
            if (ph && !drafts[step].after_caption) drafts[step].after_caption = ph.description || '';
            var dup = drafts.some(function (d2, i2) { return i2 !== step && d2.after_photo_id === id; });
            if (dup) UI.toast('This photo is already picked as the current photo on another slide', 'warn');
            render();
          }
        });
      };
      Array.prototype.forEach.call(m.el.querySelectorAll('[data-close]'), function (b) { b.onclick = m.close; });
      if ($('ppr-wiz-prev')) $('ppr-wiz-prev').onclick = function () { step--; render(); };
      if ($('ppr-wiz-next')) $('ppr-wiz-next').onclick = function () { step++; render(); };
      if ($('ppr-wiz-finish')) $('ppr-wiz-finish').onclick = finish;
    }
    async function finish() {
      if (drafts.some(function (d) { return !d.after_photo_id; })) {
        UI.toast('Every slide needs a current photo before this can be saved', 'warn'); return;
      }
      $('ppr-wiz-finish').disabled = true;
      var res = await sb().from(T_PPR)
        .insert(Object.assign({}, newData, { project_id: pid, created_by: uid })).select();
      if (res.error) { UI.toast(res.error.message, 'error'); $('ppr-wiz-finish').disabled = false; return; }
      var newId = res.data && res.data[0] && res.data[0].id;
      var payload = drafts.map(function (d) {
        return Object.assign({}, d, { ppr_id: newId, project_id: pid, created_by: uid,
          before_caption: d.before_caption || null, after_caption: d.after_caption || null });
      });
      var res2 = await sb().from(T_SLIDE).insert(payload);
      if (res2.error) {
        // The presentation row exists but has no slides — surfaced honestly
        // rather than silently discarded; the planner can still open it and
        // add slides one at a time (openSlideForm), or delete it and retry.
        UI.toast('Presentation created, but slides failed to save: ' + res2.error.message, 'error');
        m.close(); await load(); openPpr(newId); return;
      }
      m.close();
      UI.toast('Presentation created with ' + payload.length + ' slide' + (payload.length === 1 ? '' : 's') + ' copied', 'ok');
      await load(); openPpr(newId);
    }
    var m = null;
    render();
  }

  async function createPresentationPlain(data) {
    var res = await sb().from(T_PPR).insert(Object.assign({}, data, { project_id: pid, created_by: uid })).select();
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    UI.toast('Presentation created', 'ok');
    await load();
    var newId = res.data && res.data[0] && res.data[0].id;
    if (newId) openPpr(newId);
  }

  // Re-reads just the photo library + signs any new paths — used after an
  // inline upload from the slide form, so a full load() (which would re-render
  // the screen underneath the open modal) isn't needed.
  async function reloadPhotos() {
    try {
      photos = await PDb.selectAll(T_PHOTO, function (q) { return q.eq('project_id', pid); });
      photos.sort(function (a, b) { return String(b.taken_at || '').localeCompare(String(a.taken_at || '')); });
    } catch (e) {
      // ⚠️ Audit fix: this was a completely silent failure, no toast at all.
      // Its only caller is the slide editor's "+ Add photo" flow — a user
      // just uploaded a photo through the picker and expects it to become
      // selectable immediately; a failed re-read here left it invisible
      // with nothing telling the planner why their new photo isn't there.
      UI.toast('Could not refresh the photo library: ' + ((e && e.message) || e), 'error');
      return;
    }
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
  // `hideLocation` — see pane()'s own comment; kept in step across the live
  // editor and all three export formats (follow-up feedback item 4: "apply
  // comment #3 for all formats") so a slide can't show the shared-location
  // tile on screen but repeat it in the downloaded file, or vice versa.
  function slideFigureHTML(sl, which, imgs, hideLocation) {
    var ph = photoById(which === 'before' ? sl.before_photo_id : sl.after_photo_id);
    var cap = (which === 'before' ? sl.before_caption : sl.after_caption) ||
              (ph && ph.description) || '';
    // Sixth round items 10/11, mirrored into the exports so a downloaded
    // file never shows a different caption than the live editor did: no
    // Trade/Works tags line, Location always present (em-dash when unset,
    // suppressed only when the shared tile above the pair already said it),
    // and Date/Description each carry a label.
    var loc = hideLocation ? null : (ph ? ph.location : sl.location) || '';
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
      '<figcaption>' +
      (hideLocation ? '' : '<div class="loc">Location: ' + (loc ? esc(loc) : '—') + '</div>') +
      '<div class="d">Date: ' + esc(ph && ph.taken_at ? capDate(ph.taken_at) : '—') + '</div>' +
      '<div class="c">Description: ' + esc(cap || '—') + '</div>' +
      '</figcaption></figure>';
  }

  function slidesBodyHTML(p, s, imgs) {
    var slidesHTML = s.map(function (sl, i) {
      var hasBefore = !!sl.before_photo_id;
      var sharedLoc = hasBefore ? sharedLocationOf(sl) : '';
      return '<section class="slide">' +
        '<div class="meta"><span class="no">Slide ' + (i + 1) + ' of ' + s.length + '</span>' +
        (sharedLoc ? '<span class="sharedloc">' + esc(sharedLoc) + '</span>' : '') + '</div>' +
        '<div class="pair' + (hasBefore ? '' : ' single') + '">' +
          (hasBefore ? slideFigureHTML(sl, 'before', imgs, !!sharedLoc) : '') +
          slideFigureHTML(sl, 'after', imgs, !!sharedLoc) +
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
    // ⚠️ page-break-after/inside must NOT sit inside @media print: html2pdf's
    // pagebreak:{mode:['css']} reads getComputedStyle() during a NORMAL
    // (screen-context) html2canvas capture, which never matches @media print
    // — so a rule scoped there is silently inert during export. It has no
    // effect on-screen either way (browsers ignore page-break properties
    // outside print/pagination contexts), so moving it out changes nothing
    // visually and fixes the export. `:not(:last-of-type)` avoids a trailing
    // blank page after the final slide; break-inside:avoid stops one slide's
    // pane from ever being sliced across two pages by height alone (the CSS
    // page-break-after rule only starts the NEXT page — it can't shrink a
    // slide that's already taller than one).
    '.slide{break-inside:avoid;page-break-inside:avoid}' +
    '.slide:not(:last-of-type){break-after:page;page-break-after:always}' +
    '.meta{display:flex;flex-wrap:wrap;gap:18px;font-size:13px;margin-bottom:10px;align-items:baseline}' +
    '.meta .no{font-weight:700;color:#EE3124}' +
    '.meta b{color:#6b6b6b;font-weight:600;margin-right:4px}' +
    // Shared-location tile (follow-up feedback item 3/4): one line above the
    // pair when both photos are at the same place, instead of repeating it in
    // each figcaption below.
    '.meta .sharedloc{font-weight:600;color:#4a4a4a}' +
    '.phwrap{position:relative}' +
    '.kpimg{position:absolute;top:8px;right:8px;width:150px;border:1px solid #DCDBDB;display:block;box-shadow:0 1px 4px rgba(0,0,0,.25)}' +
    '.pair{display:grid;grid-template-columns:1fr 1fr;gap:14px}' +
    '.pair.single{grid-template-columns:minmax(0,760px);justify-content:center}' +
    'figure{margin:0}' +
    '.lbl{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b6b6b;margin-bottom:4px}' +
    '.ph{width:100%;display:block;border:1px solid #DCDBDB;background:#F4F4F4}' +
    '.missing{padding:40px;text-align:center;color:#9a9a9a;font-size:13px}' +
    'figcaption{text-align:center;margin-top:6px}' +
    // Sixth round items 10/11: the tags (.t) line is gone (no Trade/Works in
    // the caption); Location (.loc) is new, always present, styled like the
    // date line it now sits above.
    'figcaption .loc{font-size:12px;font-weight:600;color:#231F20}' +
    'figcaption .d{font-size:13px}' +
    'figcaption .c{font-style:italic;font-size:12.5px;color:#4a4a4a;margin-top:2px}' +
    'footer{text-align:center;font-size:11.5px;color:#6b6b6b;padding:6px 0 22px}' +
    '@media print{body{background:#fff}.slide{border:0}}' +
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

      // Vertical centering (follow-up feedback item 4: "center the items
      // vertically and horizontally" — horizontal was already centered, since
      // the two 6.1"-wide panes plus their gap sum to the slide width; nothing
      // there needed to change). LABEL_H/IMG_H/CAP_H are the same three block
      // heights the old fixed y:0.35/0.75/5.45 offsets used — only the STARTING
      // y moves, computed so the whole pane block sits centered in whatever
      // vertical space is left below the top band (slide number, + the shared-
      // location line on the slides that have one).
      var SLIDE_H = 7.5, LABEL_H = 0.35, IMG_H = 4.6, CAP_H = 0.9;
      var PANE_H = LABEL_H + IMG_H + CAP_H;
      function paneTopFor(topBand) { return topBand + Math.max(0, (SLIDE_H - topBand - PANE_H) / 2); }

      function pptxPane(slide, sl, which, x, w, paneTop, hideLocation) {
        var ph = photoById(which === 'before' ? sl.before_photo_id : sl.after_photo_id);
        var cap = (which === 'before' ? sl.before_caption : sl.after_caption) || (ph && ph.description) || '';
        var tagFields = ph ? [ph.trade, ph.works, hideLocation ? null : ph.location] : [];
        var tags = tagFields.filter(Boolean).join(' · ');
        var url = urlOfPhoto(ph && ph.id);
        var data = url ? imgs[url] : '';
        var labelY = paneTop, imgY = paneTop + LABEL_H, capY = imgY + IMG_H;
        slide.addText(which === 'before' ? 'PREVIOUS' : 'CURRENT',
          { x: x, y: labelY, w: w, h: LABEL_H, fontSize: 11, bold: true, color: '6B6B6B', charSpacing: 1 });
        if (data) slide.addImage({ data: stripDataPrefix(data), x: x, y: imgY, w: w, h: IMG_H, sizing: { type: 'contain', w: w, h: IMG_H } });
        else slide.addText('Photo not set', { x: x, y: imgY, w: w, h: IMG_H, align: 'center', valign: 'middle', color: '9A9A9A', fontSize: 12 });
        var capLines = [ph && ph.taken_at ? capDate(ph.taken_at) : '—', cap, tags].filter(Boolean).join('\n');
        slide.addText(capLines, { x: x, y: capY, w: w, h: CAP_H, fontSize: 10, color: '4A4A4A', align: 'center' });
      }

      s.forEach(function (sl, i) {
        var slide = pptx.addSlide();
        slide.addText('Slide ' + (i + 1) + ' of ' + s.length, { x: 0.4, y: 0.05, w: 6, h: 0.3, fontSize: 10, bold: true, color: 'EE3124' });
        var hasBefore = !!sl.before_photo_id;
        var sharedLoc = hasBefore ? sharedLocationOf(sl) : '';
        var topBand = 0.4;
        if (sharedLoc) {
          // Same shared-location tile as the live editor / HTML+PDF exports
          // (follow-up feedback items 3/4) — one centered line, whole slide
          // width, above both panes.
          slide.addText(sharedLoc, { x: 0.4, y: 0.4, w: 12.53, h: 0.3, fontSize: 11, bold: true, color: '4A4A4A', align: 'center' });
          topBand = 0.75;
        }
        var paneTop = paneTopFor(topBand);
        if (hasBefore) {
          pptxPane(slide, sl, 'before', 0.4, 6.1, paneTop, !!sharedLoc);
          pptxPane(slide, sl, 'after', 6.8, 6.1, paneTop, !!sharedLoc);
        } else {
          pptxPane(slide, sl, 'after', 3.4, 6.5, paneTop, false);
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

  // Exposed for the Gallery's "Add to Presentation" batch action (follow-up
  // feedback item 5). Each selected photo becomes a NEW slide's CURRENT
  // photo, appended after whatever slides the presentation already has —
  // Previous is left blank, exactly like an ordinary "+ Add slide" with
  // nothing picked to compare against; the planner can add one afterward from
  // the presentation's own editor. Slide numbering continues from the
  // existing count so re-running this on the same presentation never
  // collides with slide_no.
  async function addPhotosToPresentation(pprId, photoIds) {
    var n = slides(pprId).length;
    var payload = photoIds.map(function (id, i) {
      return {
        ppr_id: pprId, project_id: pid, created_by: uid, slide_no: n + i + 1,
        after_photo_id: id, before_photo_id: null
      };
    });
    var res = await sb().from(T_SLIDE).insert(payload);
    if (res.error) return { ok: false, error: res.error.message };
    await load();
    return { ok: true, count: payload.length };
  }

  return {
    init: init,
    _syncTools: syncTools,
    // Test-only hook, same convention as the others below — genuinely
    // executes render() so a regression of the 2026-08-30 syncTools(true)
    // bug (a re-render silently re-showing "+ New Presentation" on a screen
    // it doesn't belong to) is caught by running the real code, not just by
    // reading it.
    _render: function () { render(); },
    // Test-only hook — sets canWrite directly, bypassing init()'s
    // onProject()/load() machinery, so the syncTools(true)-vs-toolsVisible
    // regression test can actually tell the two apart. Every real button
    // syncTools touches is ALSO gated on canWrite (role-based), so with
    // canWrite left at its harness default of false both a fixed and a
    // buggy render() produce the same 'none' — the bug is invisible without
    // this. Never called from production code.
    _setCanWrite: function (v) { canWrite = v; },
    _addSlide: function () { openSlideForm(null); },
    _screen: function () { return screen; },
    // Archived presentations are excluded — a retired one is not a sensible
    // target for newly-batched photos, same reasoning as the list itself
    // hiding them by default.
    listForPicker: function () {
      return pprs.filter(function (p) { return !p.archived; }).slice()
        .sort(function (a, b) { return String(b.ppr_date || '').localeCompare(String(a.ppr_date || '')); });
    },
    addPhotosToPresentation: addPhotosToPresentation,
    // Test-only hook (same convention as module.js's _tradesOf/
    // _mediaStripMatches) — genuinely executes the copy-wizard's draft
    // promotion instead of only regex-checking the source.
    _buildCopyDrafts: function (src) { return buildCopyDrafts(src); },
    // More test-only hooks, same convention — the shared-location match and
    // the Previous/Current eligibility filter are exactly the kind of
    // off-by-one-prone logic (item 3/4's location comparison, item 5/9's
    // date/location filter) worth genuinely running against real photo
    // objects rather than only reading.
    _sameLocation: function (a, b) { return sameLocation(a, b); },
    _sharedLocationOf: function (sl) { return sharedLocationOf(sl); },
    _eligiblePhotos: function (photosArr, refPhoto, direction, allowAllLocations) {
      var saved = photos; photos = photosArr;
      try { return eligiblePhotos(refPhoto, direction, allowAllLocations); }
      finally { photos = saved; }
    },
    // Test-only hooks for the slide-sorter (item 12) and the presentation-only
    // markup overlay (item 14) — same convention as the hooks above.
    // moveItem is pure and needs no closure state; markupKey likewise.
    _moveItem: function (arr, from, to) { return moveItem(arr, from, to); },
    _markupKey: function (slideId, pane) { return markupKey(slideId, pane); },
    // Item 14 — see archiveDirectionFor's own comment on why this is worth
    // genuinely executing rather than only regex-checked.
    _archiveDirectionFor: function (ps) { return archiveDirectionFor(ps); },
    // Test-only hook (same save/restore convention as _eligiblePhotos),
    // REWRITTEN 2026-08-30 for item 16 — the preview pane is now driven
    // ENTIRELY by the checkbox set (selectedPprs), never by `selId`.
    // Injects a presentation list/filter/slide set and a candidate CHECKED
    // id (which may be archived/filtered out), runs the REAL
    // renderPreview(), and reports what the pane actually shows — proving
    // that a checked-but-now-hidden presentation (visibleSelectedPprIds()
    // scopes to visiblePprs()) renders the "nothing to preview" prompt
    // rather than silently showing its stale slides.
    _renderPreviewWithState: function (pprsArr, filtersPatch, testCheckedId, slidesMap) {
      var savedPprs = pprs, savedFilters = filters, savedSlidesOf = slidesOf, savedSel = selectedPprs;
      selectedPprs = testCheckedId ? (function () { var m = {}; m[testCheckedId] = true; return m; })() : {};
      pprs = pprsArr; filters = Object.assign({}, filters, filtersPatch);
      if (slidesMap) slidesOf = slidesMap;
      try {
        renderPreview();
        var body = $('ppr-preview-body');
        return { visibleCheckedIds: visibleSelectedPprIds(), bodyHtml: body ? body.innerHTML : '' };
      } finally {
        pprs = savedPprs; filters = savedFilters; slidesOf = savedSlidesOf; selectedPprs = savedSel;
      }
    },
    // Item 17 — the stacked-photo-card thumbnail is worth genuinely
    // executing (a mismatched previous/current guard here would silently
    // fall back to a flat single image for every dual-photo slide).
    _slideThumbHTML: function (sl, i, clickable) { return slideThumbHTML(sl, i, clickable); }
  };
})();
