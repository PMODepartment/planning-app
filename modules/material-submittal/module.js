/* Material Submittal Log — modules/material-submittal/module.js
   Built against "EPC. PMO. Material Submittal List Dashboard" (2025-01-25).

   DASHBOARD MATHS — read before changing anything in scurve()/statusCounts():
   The workbook's own formulas are the spec. Verified against them exactly:
     status table = COUNTIF over the Status column (blank = not counted)
     PLANNED curve = COUNTIFS(PlannedApproval within month, TradeCategory = <code>)
     ACTUAL  curve = COUNTIFS(ActualApproval  within month, TradeCategory = <code>)
   i.e. the S-curve is driven by the APPROVAL date pair, NOT submission — despite
   the workbook labelling its own summary rows "Planned/Actual Submission".

   TWO DEFECTS in the workbook, both reproduced and proven before being fixed:
     1. `TradeCategory` pointed at the redundant "Trades" column, which is blank on
        39 of 141 real submittals — silently dropping them from the chart (33 of
        them had approval dates and would otherwise have counted).
     2. Its OVERALL row summed EIGHT discipline rows but listed "ST" twice, so
        Structural was double-counted: OVERALL read 97/29 where the seven distinct
        disciplines sum to 91/23.
   This module groups by `discipline` (always populated) and counts each discipline
   once. `legacyScurve()` reproduces the workbook's figure from `trade_code` purely
   so the dashboard can show the reconciliation — nothing else may use it. */
window.MaterialSubmittal = (function () {
  'use strict';

  var TABLE = 'material_submittal';
  // PRIVATE storage bucket (2026-06-18 storage migration): objects are only
  // reachable through a short-lived signed URL, never a public link.
  var BUCKET = 'material-submittal';
  var sb = function () { return window.__sb || (window.__sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY)); };
  var esc = function (s) { return Fmt.esc(s == null ? '' : String(s)); };

  // ---- attachments ---------------------------------------------------------
  // One document per submittal, matching the log's own model: each row carries a
  // single "Type of Presentation" (brochure / test results / sample board …), and
  // a submittal needing two document types is already two rows in the workbook.
  // `file_url` stores the object PATH, not a URL — the URL is signed on demand.
  async function uploadFile(file) {
    var safe = String(file.name).replace(/[^\w.\-]+/g, '_').slice(-120);
    var path = pid + '/' + Date.now() + '_' + safe;
    var res = await sb().storage.from(BUCKET).upload(path, file, { upsert: false });
    if (res.error) throw res.error;
    return path;
  }
  async function viewFile(path) {
    var res = await sb().storage.from(BUCKET).createSignedUrl(path, 60);
    if (res.error) { UI.toast('Could not open the file: ' + res.error.message, 'error'); return; }
    window.open(res.data.signedUrl, '_blank', 'noopener');
  }
  // Best-effort: a failed object delete must never block the row delete, or the
  // user is left unable to remove a record because of a storage hiccup.
  async function removeFiles(paths) {
    var list = (paths || []).filter(Boolean);
    if (!list.length) return;
    try { await sb().storage.from(BUCKET).remove(list); } catch (e) {}
  }
  function fileLabel(path) {
    if (!path) return '';
    var base = String(path).split('/').pop();
    return base.replace(/^\d{10,}_/, '');          // strip the timestamp prefix
  }

  // ---- vocabularies (workbook "Library" sheet — letter codes are its own) ----
  var STATUSES = [
    { name: 'Approved',             code: 'A', cls: 's-approved'  },
    { name: 'Approved w/ Comments', code: 'B', cls: 's-approvedc' },
    { name: 'Resubmit',             code: 'C', cls: 's-resubmit'  },
    { name: 'Rejected',             code: 'D', cls: 's-rejected'  },
    { name: 'For Information',      code: 'F', cls: 's-info'      },
    { name: 'Pending Approval',     code: '',  cls: 's-pending'   },
    { name: 'For Submission',       code: 'P', cls: 's-forsub'    }
  ];
  // Dashboard order matches the workbook's status block exactly.
  var STATUS_ORDER = ['Approved', 'Approved w/ Comments', 'Resubmit', 'Rejected', 'For Information', 'Pending Approval', 'For Submission'];
  var DONE = { 'Approved': 1, 'Approved w/ Comments': 1 };   // counts as approved

  var PRESENTATION = ['Sample Board', 'Mock Up', 'Brochure and Technical Data Sheet', 'Sample', 'Product Certification', 'Test Results'];
  var CONSULTANTS  = ['ECTA', 'RBS', 'INT', 'IES', 'DADEC', 'MCC-ENG'];

  // Discipline codes (workbook "Coding Reference"). The 7 the dashboard charts
  // are the ones its S-curve tracked; any other code still counts in "Other".
  var DISCIPLINES = [
    ['AR','ARCHITECTURAL'],['ST','STRUCTURAL'],['CL','CIVIL'],['ME','MECHANICAL'],['EL','ELECTRICAL'],
    ['PL','WATER SUPPLY/PLUMBING'],['FP','FIRE FIGHTING'],['AC','HVAC/AIR-CONDITIONING'],['AN','ANCILLARY'],
    ['BW','BUILDERS WORK'],['CC','CO-ORDINATED CEILING PLAN'],['CH','CHILLED WATER'],['CS','COORDINATED SERVICES'],
    ['DC','DISTRICT COOLING'],['DR','DRAINAGE'],['EA','LIGHTING/EARTHING'],['FA','FIRE ALARM'],['GE','GENERAL'],
    ['HS','ELECTRICAL LOW CURRENT'],['ID','INTERIOR DESIGN'],['IR','IRRIGATION'],['LF','LIFTS'],
    ['LP','LIQUID PETROLEUM GAS'],['LS','LANDSCAPE'],['LT','ELECTRICAL LIGHTING'],['LV','ELECTRICAL LOW VOLTAGE'],
    ['PW','ELECTRICAL POWER'],['SN','STANDARD'],['SP','CO-ORDINATED SITE PLAN'],['UM','URBAN AND MASTER PLANNING'],
    ['XX','MISCELLANEOUS']
  ];
  var CHART_DISC = ['CL', 'ST', 'AR', 'ME', 'EL', 'PL', 'FP'];
  var DISC_COLOR = { CL:'#EE3124', ST:'#2B2C2B', AR:'#C42127', ME:'#2F6FB0', EL:'#B45309', PL:'#12693A', FP:'#7C3AED', Other:'#8A8F98' };

  var DOCTYPES = [['MT','Material Submission'],['SD','Shop Drawing'],['SP','Specification'],['IT','Inspection & test plan'],
    ['MS','Method statement'],['MA','Manual'],['RP','Report'],['SH','Schedule'],['XX','Other']];
  var BUILDINGS = [['SUB','Substructure'],['SUP','Superstructure'],['POD','Podium'],['TR1','Tower 1'],['PRB','Parking Building'],['GEN','General']];

  // The workbook's 23 section headers, in its own order (drives grouping + the filter).
  var SECTIONS = ['GENERAL REQUIREMENT','SITEWORKS','REBAR','CONCRETE','MASONRY','STONEWORKS','TILING WORKS',
    'DRYWALLS AND CEILING WORKS','THERMAL & MOISTURE PROTECTION','DOOR AND JAMB','DOOR HARDWARES','METAL WORKS',
    'PAINTING WORKS','ALUMINUM GLASS & GLAZING WORKS','CABINETRY','SPECIALTIES','MECHANICAL WORKS','ELECTRICAL WORKS',
    'AUXILIARY WORKS','PLUMBING WORKS','FIRE PROTECTION WORKS','OTHER ALLIED SERVICES','RECTIFICATION WORKS'];

  // ---- state ---------------------------------------------------------------
  var UID = null, PROFILE = null, pid = null, rows = [], view = 'dashboard';
  var canWrite = false, isAdmin = false, loading = false;
  var sel = {}, collapsed = {}, noteDismissed = false;
  var filters = { q: '', section: '', disc: '', status: '', pres: '', overdue: false };

  // ---- date helpers --------------------------------------------------------
  var MON = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
  var MNAME = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  /* Parses what the workbook actually contains: "18-Mar-24", Excel serials, Date
     objects and ISO. Returns an ISO yyyy-mm-dd string (what Postgres `date` wants).

     ⚠️ TIMEZONE: never read a spreadsheet Date with LOCAL getters. SheetJS returns
     a cell displaying "18-Mar-24" as 2024-03-17T15:59:17Z (serial→ms rounding), so
     local getters yield the 17th in some zones and the 18th in others — the parsed
     date would depend on where the browser is. Everything below is UTC-only, and
     the Date branch rounds to the NEAREST UTC day to absorb that 15:59:17 drift.
     The importer also reads cells as FORMATTED TEXT (raw:false), so the normal path
     is the literal "18-Mar-24" string and never touches a Date at all. */
  function parseDate(v) {
    if (v == null || v === '') return null;
    // Duck-typed, not `instanceof Date`: a Date built in another realm (iframe, or a
    // test harness running the module in a vm context) fails instanceof and would
    // silently fall through to the string branch, shifting the date by a day.
    if (v && typeof v.getTime === 'function' && !isNaN(v.getTime()))
      return isoUTC(new Date(Math.round(v.getTime() / 86400000) * 86400000));
    if (typeof v === 'number' && isFinite(v)) {           // Excel serial (1900 system)
      var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return isNaN(d) ? null : isoUTC(d);
    }
    var s = String(v).trim();
    if (!s || /^[-–—]+$/.test(s)) return null;
    var m = /^(\d{1,2})[-\/\s]([A-Za-z]{3,})[-\/\s](\d{2,4})$/.exec(s);   // 18-Mar-24
    if (m) {
      var mo = MON[m[2].slice(0, 3).toLowerCase()];
      if (mo == null) return null;
      var y = +m[3]; if (y < 100) y += 2000;
      return pad4(y) + '-' + pad2(mo + 1) + '-' + pad2(+m[1]);            // pure string maths
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    var m2 = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);                 // dd/mm/yyyy
    if (m2) { var y2 = +m2[3]; if (y2 < 100) y2 += 2000; return pad4(y2) + '-' + pad2(+m2[2]) + '-' + pad2(+m2[1]); }
    // Last resort: a locale string like "Mon Mar 18 2024 …" parses to LOCAL time, so
    // read it back with local getters (isoUTC would shift it a day west of UTC).
    var d2 = new Date(s);
    return isNaN(d2.getTime()) ? null : iso(d2);
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function pad4(n) { return String(n).padStart(4, '0'); }
  function isoUTC(d) { return pad4(d.getUTCFullYear()) + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function iso(d) { return pad4(d.getFullYear()) + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function fmtDate(s) {
    if (!s) return '';
    var p = String(s).slice(0, 10).split('-');
    if (p.length !== 3) return esc(s);
    return String(+p[2]).padStart(2, '0') + '-' + MNAME[+p[1] - 1] + '-' + String(p[0]).slice(2);
  }
  function monthKey(s) { return s ? String(s).slice(0, 7) : null; }          // yyyy-mm
  function todayISO() { return iso(new Date()); }

  // ---- row helpers ---------------------------------------------------------
  function statusOf(r) { return (r.status || '').trim(); }
  function statusMeta(name) {
    for (var i = 0; i < STATUSES.length; i++) if (STATUSES[i].name === name) return STATUSES[i];
    return null;
  }
  function discOf(r) { return (r.discipline || r.code_discipline || '').trim().toUpperCase(); }
  function sectionOf(r) { return (r.trade_section || '').trim() || 'UNCLASSIFIED'; }
  function isApproved(r) { return !!DONE[statusOf(r)]; }
  // Overdue = planned approval has passed and it still isn't approved. Blank plan
  // date can't be overdue (no commitment to miss).
  function isOverdue(r) {
    if (isApproved(r) || !r.plan_approval_date) return false;
    return String(r.plan_approval_date).slice(0, 10) < todayISO();
  }
  // Composed 7-part number; falls back to whatever was stored/imported.
  function codeOf(r) {
    var p = [r.code_project, r.code_building, r.code_company, r.code_doctype, r.code_discipline, r.code_floor, r.code_number];
    var got = p.filter(function (x) { return x != null && String(x).trim() !== ''; });
    return got.length >= 2 ? p.map(function (x) { return (x == null ? '' : String(x).trim()); }).filter(Boolean).join('-') : (r.submittal_no || '');
  }

  // ==========================================================================
  // DASHBOARD MATHS
  // ==========================================================================

  // Workbook parity: COUNTIF over the status column — rows with a BLANK status are
  // not counted at all (that is why its total read 107 against 146 sheet rows).
  function statusCounts(list) {
    var m = {}, total = 0;
    STATUS_ORDER.forEach(function (s) { m[s] = 0; });
    list.forEach(function (r) {
      var s = statusOf(r); if (!s) return;
      if (!(s in m)) m[s] = 0;
      m[s]++; total++;
    });
    return { map: m, total: total };
  }

  // Monthly + cumulative counts of PLANNED (plan_approval_date) and ACTUAL
  // (date_approved) per discipline. Corrected maths: groups by `discipline`, counts
  // every submittal, each discipline exactly once.
  // `cutoff` (yyyy-mm, optional) stops the cumulative at that month — the workbook
  // did this via IF(month > CurrentMonth, NA(), …). Omitted = the whole timeline.
  function scurve(list, cutoff) {
    var months = {}, per = {};
    function bump(bucket, disc, mk) {
      if (!mk || (cutoff && mk > cutoff)) return;
      months[mk] = true;
      var key = CHART_DISC.indexOf(disc) >= 0 ? disc : 'Other';
      (per[key] = per[key] || { planned: {}, actual: {} });
      per[key][bucket][mk] = (per[key][bucket][mk] || 0) + 1;
    }
    list.forEach(function (r) {
      var d = discOf(r);
      bump('planned', d, monthKey(r.plan_approval_date));
      bump('actual',  d, monthKey(r.date_approved));
    });
    var keys = Object.keys(months).sort();
    if (!keys.length) return { months: [], series: [], totals: { planned: 0, actual: 0 } };
    // Fill the gaps so the curve is continuous across empty months.
    var all = [], cur = keys[0], last = keys[keys.length - 1], guard = 0;
    while (cur <= last && guard++ < 600) {
      all.push(cur);
      var y = +cur.slice(0, 4), mo = +cur.slice(5, 7);
      if (++mo > 12) { mo = 1; y++; }
      cur = y + '-' + String(mo).padStart(2, '0');
    }
    var order = CHART_DISC.filter(function (d) { return per[d]; }).concat(per.Other ? ['Other'] : []);
    var series = order.map(function (d) {
      var cp = 0, ca = 0;
      return {
        disc: d, color: DISC_COLOR[d] || DISC_COLOR.Other,
        planned: all.map(function (mk) { return (cp += (per[d].planned[mk] || 0)); }),
        actual:  all.map(function (mk) { return (ca += (per[d].actual[mk]  || 0)); })
      };
    });
    var tp = all.map(function (_, i) { return series.reduce(function (a, s) { return a + s.planned[i]; }, 0); });
    var ta = all.map(function (_, i) { return series.reduce(function (a, s) { return a + s.actual[i];  }, 0); });
    return {
      months: all, series: series,
      totalPlanned: tp, totalActual: ta,
      totals: { planned: tp[tp.length - 1] || 0, actual: ta[ta.length - 1] || 0 }
    };
  }

  // Reproduces the WORKBOOK's figure (grouped by the sparse `trade_code`, with
  // Structural double-counted) so the dashboard can show the reconciliation.
  // Reconciliation display ONLY — never use this for real reporting.
  function legacyScurve(list, cutoff) {
    var p = 0, a = 0, st = { p: 0, a: 0 }, dropped = 0;
    var within = function (d) { var mk = monthKey(d); return mk && (!cutoff || mk <= cutoff); };
    list.forEach(function (r) {
      var t = (r.trade_code || '').trim().toUpperCase();
      if (CHART_DISC.indexOf(t) < 0) { if (discOf(r)) dropped++; return; }   // blank/other → invisible to the old chart
      var hp = within(r.plan_approval_date), ha = within(r.date_approved);
      if (hp) p++; if (ha) a++;
      if (t === 'ST') { if (hp) st.p++; if (ha) st.a++; }                    // the duplicated row
    });
    return { planned: p + st.p, actual: a + st.a, dropped: dropped };
  }

  function kpis(list) {
    var sc = statusCounts(list);
    var approved = (sc.map['Approved'] || 0) + (sc.map['Approved w/ Comments'] || 0);
    return {
      total: list.length,
      counted: sc.total,
      approved: approved,
      approvedPct: sc.total ? approved / sc.total * 100 : 0,
      pending: sc.map['Pending Approval'] || 0,
      forSub: sc.map['For Submission'] || 0,
      rejected: (sc.map['Rejected'] || 0) + (sc.map['Resubmit'] || 0),
      overdue: list.filter(isOverdue).length
    };
  }

  // ==========================================================================
  // RENDER — DASHBOARD
  // ==========================================================================
  function renderDashboard() {
    var host = document.getElementById('ms-view');
    if (!rows.length) { host.innerHTML = emptyHTML(); wireEmpty(); return; }

    var k = kpis(rows), sc = statusCounts(rows), curve = scurve(rows), legacy = legacyScurve(rows);
    var h = '<div class="ms-dash">';

    h += '<div class="ms-kpis">' +
      kpi('Total submittals', k.total, k.counted !== k.total ? (k.total - k.counted) + ' with no status yet' : 'all have a status') +
      kpi('Approved', k.approved, k.approvedPct.toFixed(1) + '% of ' + k.counted + ' tracked', 'good') +
      kpi('Pending approval', k.pending, 'submitted, awaiting decision', k.pending ? 'warn' : '') +
      kpi('For submission', k.forSub, 'not yet submitted') +
      kpi('Rejected / resubmit', k.rejected, 'needs rework', k.rejected ? 'bad' : '') +
      kpi('Overdue', k.overdue, 'past planned approval', k.overdue ? 'bad' : '') +
      '</div>';

    h += '<div class="ms-grid2">';

    // ---- status block (workbook parity) ----
    h += '<div class="ms-card"><h3>Material submittal log overview</h3>' +
      '<p class="ms-cardsub">Status mix across the ' + sc.total + ' submittal' + (sc.total === 1 ? '' : 's') + ' that carry a status.</p>' +
      '<div class="ms-donutwrap">' + donutSVG(sc) + '<div class="ms-legend">' +
      STATUS_ORDER.map(function (s) {
        var n = sc.map[s] || 0, pct = sc.total ? (n / sc.total * 100) : 0;
        return '<div><span class="ms-sw" style="background:' + statusColor(s) + '"></span>' +
          '<span style="flex:1">' + esc(s) + '</span><b>' + n + '</b> <span class="ms-mut">' + pct.toFixed(1) + '%</span></div>';
      }).join('') + '</div></div>';

    h += '<table class="ms-stat" style="margin-top:14px;"><thead><tr><th>Status</th><th>No. of Material Submittal</th><th>Wt %</th></tr></thead><tbody>';
    STATUS_ORDER.forEach(function (s) {
      var n = sc.map[s] || 0, pct = sc.total ? (n / sc.total * 100) : 0;
      h += '<tr' + (n ? '' : ' class="ms-zero"') + '><td>' + esc(s) +
        '<div class="ms-bar"><i style="width:' + pct.toFixed(2) + '%;background:' + statusColor(s) + '"></i></div></td>' +
        '<td>' + n + '</td><td>' + pct.toFixed(2) + '%</td></tr>';
    });
    h += '<tr><td>Total</td><td>' + sc.total + '</td><td>100.00%</td></tr></tbody></table></div>';

    // ---- S-curve ----
    h += '<div class="ms-card"><h3>Material submittal S-curve</h3>' +
      '<p class="ms-cardsub">Cumulative <b>planned</b> vs <b>actual approvals</b> by month, from the plan / actual approval dates.</p>' +
      '<div class="ms-chart">' + curveSVG(curve) + '</div>';

    h += '<table class="ms-stat" style="margin-top:14px;"><thead><tr><th>Discipline</th><th>Planned</th><th>Actual</th><th>%</th></tr></thead><tbody>';
    curve.series.forEach(function (s) {
      var p = s.planned[s.planned.length - 1], a = s.actual[s.actual.length - 1];
      h += '<tr><td><span class="ms-sw" style="display:inline-block;background:' + s.color + ';margin-right:7px;"></span>' +
        esc(discName(s.disc)) + '</td><td>' + p + '</td><td>' + a + '</td><td>' + (p ? (a / p * 100).toFixed(1) : '0.0') + '%</td></tr>';
    });
    h += '<tr><td>Overall</td><td>' + curve.totals.planned + '</td><td>' + curve.totals.actual + '</td><td>' +
      (curve.totals.planned ? (curve.totals.actual / curve.totals.planned * 100).toFixed(1) : '0.0') + '%</td></tr></tbody></table>';
    h += '</div></div>';   // /grid2

    // ---- reconciliation note ----
    if (!noteDismissed && (legacy.planned !== curve.totals.planned || legacy.actual !== curve.totals.actual || legacy.dropped)) {
      h += '<div class="ms-note" id="ms-note"><span class="ms-note-ico" data-ico="risk" data-ico-size="16"></span><div>' +
        '<b>These totals differ from the source Excel — deliberately.</b><br>' +
        'This dashboard counts <b>' + curve.totals.planned + ' planned / ' + curve.totals.actual + ' actual</b>. ' +
        'The workbook’s chart reported <b>' + legacy.planned + ' / ' + legacy.actual + '</b> because it grouped by its ' +
        '“Trades” column' + (legacy.dropped ? ' — left blank on <b>' + legacy.dropped + '</b> submittal' + (legacy.dropped === 1 ? '' : 's') + ', which its chart silently dropped' : '') +
        ' — and its overall row listed Structural twice, double-counting it. ' +
        'Here every submittal is included and each discipline counts once.' +
        '</div><button class="ms-note-x" id="ms-note-x" title="Dismiss">&times;</button></div>';
    }

    h += '</div>';
    host.innerHTML = h;
    if (window.Icons && Icons.hydrate) Icons.hydrate(host);
    var x = document.getElementById('ms-note-x');
    if (x) x.onclick = function () { noteDismissed = true; renderDashboard(); };
  }

  function kpi(label, value, sub, cls) {
    return '<div class="ms-kpi ' + (cls || '') + '"><div class="ms-kpi-l">' + esc(label) + '</div>' +
      '<div class="ms-kpi-v">' + value + '</div><div class="ms-kpi-s">' + esc(sub || '') + '</div></div>';
  }
  function statusColor(s) {
    return ({ 'Approved':'#12693A', 'Approved w/ Comments':'#3F6B21', 'Resubmit':'#9A4A15', 'Rejected':'#9B1C1C',
      'For Information':'#1E4E8C', 'Pending Approval':'#B45309', 'For Submission':'#8A8F98' })[s] || '#8A8F98';
  }
  function discName(c) {
    for (var i = 0; i < DISCIPLINES.length; i++) if (DISCIPLINES[i][0] === c) return c + ' — ' + title(DISCIPLINES[i][1]);
    return c === 'Other' ? 'Other disciplines' : c;
  }
  function title(s) { return String(s).toLowerCase().replace(/\b[a-z]/g, function (m) { return m.toUpperCase(); }); }

  function donutSVG(sc) {
    var R = 54, C = 2 * Math.PI * R, off = 0, segs = '';
    if (!sc.total) return '';
    STATUS_ORDER.forEach(function (s) {
      var n = sc.map[s] || 0; if (!n) return;
      var frac = n / sc.total, len = frac * C;
      segs += '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="' + statusColor(s) + '" stroke-width="22" ' +
        'stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" ' +
        'transform="rotate(-90 70 70)"><title>' + esc(s) + ': ' + n + '</title></circle>';
      off += len;
    });
    var approved = (sc.map['Approved'] || 0) + (sc.map['Approved w/ Comments'] || 0);
    return '<svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Status mix">' + segs +
      '<text x="70" y="66" text-anchor="middle" style="font-size:21px;font-weight:800;fill:var(--pd-ink)">' +
      (sc.total ? Math.round(approved / sc.total * 100) : 0) + '%</text>' +
      '<text x="70" y="82" text-anchor="middle" style="font-size:9.5px">approved</text></svg>';
  }

  function curveSVG(c) {
    if (!c.months.length) return '<p class="ms-mut" style="font-size:12.5px;">No approval dates recorded yet — the curve appears once submittals carry planned or actual approval dates.</p>';
    var n = c.months.length;
    var W = Math.max(560, 46 * n + 90), H = 250, L = 44, R = 14, T = 14, B = 44;
    var cw = W - L - R, ch = H - T - B;
    var max = Math.max(1, c.totalPlanned[n - 1], c.totalActual[n - 1]);
    var step = niceStep(max / 4);
    var top = Math.ceil(max / step) * step;
    var X = function (i) { return L + (n === 1 ? cw / 2 : cw * i / (n - 1)); };
    var Y = function (v) { return T + ch - ch * (v / top); };
    var s = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Cumulative planned vs actual approvals">';
    for (var g = 0; g <= top; g += step) {
      s += '<line class="ms-grid" x1="' + L + '" y1="' + Y(g).toFixed(1) + '" x2="' + (W - R) + '" y2="' + Y(g).toFixed(1) + '"/>' +
           '<text x="' + (L - 7) + '" y="' + (Y(g) + 3.5).toFixed(1) + '" text-anchor="end">' + g + '</text>';
    }
    s += '<line class="ms-axis" x1="' + L + '" y1="' + (T + ch) + '" x2="' + (W - R) + '" y2="' + (T + ch) + '"/>';
    // x labels — thin out so they never collide
    var every = Math.ceil(n / 14);
    c.months.forEach(function (mk, i) {
      if (i % every) return;
      s += '<text x="' + X(i).toFixed(1) + '" y="' + (T + ch + 15) + '" text-anchor="middle">' + MNAME[+mk.slice(5, 7) - 1] + '</text>' +
           '<text x="' + X(i).toFixed(1) + '" y="' + (T + ch + 26) + '" text-anchor="middle">' + mk.slice(2, 4) + '</text>';
    });
    function path(arr) { return arr.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' '); }
    s += '<path d="' + path(c.totalPlanned) + '" fill="none" stroke="#2B2C2B" stroke-width="2.4" stroke-linejoin="round"/>';
    s += '<path d="' + path(c.totalActual)  + '" fill="none" stroke="#EE3124" stroke-width="2.4" stroke-linejoin="round"/>';
    // end labels
    var lp = c.totalPlanned[n - 1], la = c.totalActual[n - 1];
    s += '<circle cx="' + X(n - 1).toFixed(1) + '" cy="' + Y(lp).toFixed(1) + '" r="3.2" fill="#2B2C2B"/>' +
         '<circle cx="' + X(n - 1).toFixed(1) + '" cy="' + Y(la).toFixed(1) + '" r="3.2" fill="#EE3124"/>';
    // legend
    s += '<g transform="translate(' + (L + 4) + ',' + (T + 4) + ')">' +
      '<line x1="0" y1="0" x2="16" y2="0" stroke="#2B2C2B" stroke-width="2.4"/><text x="21" y="3.5">Planned (' + lp + ')</text>' +
      '<line x1="0" y1="14" x2="16" y2="14" stroke="#EE3124" stroke-width="2.4"/><text x="21" y="17.5">Actual (' + la + ')</text></g>';
    return s + '</svg>';
  }
  function niceStep(x) {
    if (!isFinite(x) || x <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log(x) / Math.LN10)), f = x / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  // ==========================================================================
  // RENDER — LOG
  // ==========================================================================
  function visibleRows() {
    var q = filters.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (filters.section && sectionOf(r) !== filters.section) return false;
      if (filters.disc && discOf(r) !== filters.disc) return false;
      if (filters.status && statusOf(r) !== filters.status) return false;
      if (filters.pres && (r.type_presentation || '') !== filters.pres) return false;
      if (filters.overdue && !isOverdue(r)) return false;
      if (!q) return true;
      // trade_section is searchable on purpose: a planner typing "rebar" means the
      // REBAR section — no item text contains that word, so without it the search
      // returns nothing for the most natural query.
      return [codeOf(r), r.material, r.specification, r.brand, r.supplier, r.location,
              r.mas_id, r.reference_document, r.remarks, r.trade_section, r.discipline]
        .some(function (v) { return v && String(v).toLowerCase().indexOf(q) >= 0; });
    });
  }

  function renderLog() {
    var host = document.getElementById('ms-view');
    if (!rows.length) { host.innerHTML = emptyHTML(); wireEmpty(); return; }
    var list = visibleRows();
    document.getElementById('ms-count').textContent = 'Showing ' + list.length + ' of ' + rows.length;

    // group by trade section, in the workbook's order (unknown sections after)
    var groups = {}, order = [];
    list.forEach(function (r) {
      var s = sectionOf(r);
      if (!groups[s]) { groups[s] = []; order.push(s); }
      groups[s].push(r);
    });
    order.sort(function (a, b) {
      var ia = SECTIONS.indexOf(a), ib = SECTIONS.indexOf(b);
      if (ia < 0 && ib < 0) return a.localeCompare(b);
      if (ia < 0) return 1; if (ib < 0) return -1;
      return ia - ib;
    });

    // Header is the single source of truth for the column count — the group rows and
    // the empty state both span it, and a hardcoded number silently breaks the
    // moment a column is added.
    var HEAD = ['<th class="ms-cb"><input type="checkbox" id="ms-xall" title="Select all shown" /></th>',
      '<th class="ms-fz1">Submittal No.</th>', '<th class="ms-fz2">Item</th>',
      '<th>Disc.</th>', '<th>Location</th>', '<th>Brand</th>', '<th>Vendor</th>', '<th>Presentation</th>',
      '<th class="ms-doccol">Doc</th>',
      '<th>Req. baseline</th>', '<th>Plan sub.</th>', '<th>Actual sub.</th>', '<th>Plan appr.</th>', '<th>Actual appr.</th>',
      '<th>Approver</th>', '<th>Rev</th>', '<th>Status</th>', '<th>MAS ID</th>'];
    if (canWrite) HEAD.push('<th class="ms-actcol"></th>');
    var SPAN = HEAD.length;

    var h = '<div class="pd-card ms-tablecard"><table class="ms-table"><thead><tr>' +
      HEAD.join('') + '</tr></thead><tbody>';

    if (!list.length) {
      h += '<tr><td colspan="' + SPAN + '" style="text-align:center;padding:34px;" class="ms-mut">No submittals match these filters.</td></tr>';
    }
    order.forEach(function (secName) {
      var g = groups[secName], isColl = !!collapsed[secName];
      var appr = g.filter(isApproved).length;
      h += '<tr class="ms-grp" data-sec="' + esc(secName) + '"><td colspan="' + SPAN + '">' +
        '<span class="ms-grp-caret">' + (isColl ? '&#9656;' : '&#9662;') + '</span>' + esc(secName) +
        '<span class="ms-grp-count">' + g.length + ' item' + (g.length === 1 ? '' : 's') + ' · ' + appr + ' approved</span></td></tr>';
      if (isColl) return;
      g.forEach(function (r) {
        var st = statusOf(r), meta = statusMeta(st), od = isOverdue(r);
        h += '<tr' + (sel[r.id] ? ' class="ms-selrow"' : '') + ' data-id="' + esc(r.id) + '">' +
          '<td class="ms-cb"><input type="checkbox" data-cb="' + esc(r.id) + '"' + (sel[r.id] ? ' checked' : '') + ' /></td>' +
          '<td class="ms-fz1"><span class="ms-code">' + esc(codeOf(r) || '—') + '</span></td>' +
          '<td class="ms-fz2"><div class="ms-item">' + esc(r.material || '(untitled)') + '</div>' +
            (r.specification ? '<div class="ms-sub" title="' + esc(r.specification) + '">' + esc(r.specification) + '</div>' : '') + '</td>' +
          '<td class="ms-nowrap">' + esc(discOf(r) || '—') + '</td>' +
          '<td>' + esc(r.location || '') + '</td>' +
          '<td>' + esc(r.brand || '') + '</td>' +
          '<td>' + esc(r.supplier || '') + '</td>' +
          '<td>' + esc(r.type_presentation || '') + '</td>' +
          '<td class="ms-doccol">' + (r.file_url
            ? '<button class="ms-filebtn" data-file="' + esc(r.file_url) + '" title="Open ' + esc(fileLabel(r.file_url)) + '"><span data-ico="eye" data-ico-size="14"></span></button>'
            : '<span class="ms-mut ms-mini">—</span>') + '</td>' +
          '<td class="ms-nowrap ms-mut">' + fmtDate(r.date_required) + '</td>' +
          '<td class="ms-nowrap ms-mut">' + fmtDate(r.plan_submission_date) + '</td>' +
          '<td class="ms-nowrap">' + fmtDate(r.date_submitted) + '</td>' +
          '<td class="ms-nowrap ' + (od ? 'ms-od' : 'ms-mut') + '"' + (od ? ' title="Overdue — planned approval has passed"' : '') + '>' + fmtDate(r.plan_approval_date) + (od ? ' !' : '') + '</td>' +
          '<td class="ms-nowrap">' + fmtDate(r.date_approved) + '</td>' +
          '<td class="ms-nowrap ms-mini">' + esc([r.approver_consultant, r.approver_client].filter(Boolean).join(' / ')) + '</td>' +
          '<td class="ms-r">' + esc(r.revision_no || '') + '</td>' +
          '<td>' + (st ? '<span class="ms-pill ' + (meta ? meta.cls : 's-forsub') + '">' + esc(st) + '</span>' : '<span class="ms-mut ms-mini">—</span>') + '</td>' +
          '<td class="ms-nowrap ms-mini">' + esc(r.mas_id || '') + '</td>' +
          (canWrite ? '<td class="ms-actcol"><button class="pd-btn" data-edit="' + esc(r.id) + '" title="Edit">&#9998;</button> ' +
            '<button class="pd-btn" data-del="' + esc(r.id) + '" title="Delete">&times;</button></td>' : '') +
          '</tr>';
      });
    });
    h += '</tbody></table></div>';

    var selN = Object.keys(sel).filter(function (k) { return sel[k]; }).length;
    if (selN && canWrite) {
      h = '<div class="ms-listbar" style="display:flex;gap:10px;align-items:center;margin-bottom:10px;">' +
        '<span style="font-weight:700;color:var(--pd-red);">' + selN + ' selected</span>' +
        '<select class="pd-select" id="ms-bulkstatus" style="max-width:210px;"><option value="">Set status…</option>' +
        STATUS_ORDER.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('') + '</select>' +
        '<button class="pd-btn" id="ms-bulkdel">Delete selected</button>' +
        '<button class="pd-btn" id="ms-selnone">Clear selection</button></div>' + h;
    }
    host.innerHTML = h;
    wireLog();
  }

  function wireLog() {
    var host = document.getElementById('ms-view');
    if (window.Icons && Icons.hydrate) Icons.hydrate(host);   // the Doc column uses data-ico
    host.querySelectorAll('[data-file]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); viewFile(b.dataset.file); };
    });
    host.querySelectorAll('.ms-grp').forEach(function (tr) {
      tr.onclick = function () { var s = tr.dataset.sec; collapsed[s] = !collapsed[s]; renderLog(); };
    });
    host.querySelectorAll('[data-cb]').forEach(function (cb) {
      cb.onclick = function (e) { e.stopPropagation(); sel[cb.dataset.cb] = cb.checked; renderLog(); };
    });
    var xall = document.getElementById('ms-xall');
    if (xall) xall.onclick = function () {
      visibleRows().forEach(function (r) { sel[r.id] = xall.checked; });
      renderLog();
    };
    host.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); openForm(rows.find(function (r) { return String(r.id) === b.dataset.edit; })); };
    });
    host.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); delRow(b.dataset.del); };
    });
    var bs = document.getElementById('ms-bulkstatus');
    if (bs) bs.onchange = function () { if (bs.value) bulkStatus(bs.value); };
    var bd = document.getElementById('ms-bulkdel'); if (bd) bd.onclick = bulkDelete;
    var sn = document.getElementById('ms-selnone'); if (sn) sn.onclick = function () { sel = {}; renderLog(); };
  }

  function emptyHTML() {
    return '<div class="pd-card ms-empty"><h3>No material submittals yet</h3>' +
      '<p>Import the PMO workbook to load your existing log, or add submittals one at a time.</p>' +
      (canWrite ? '<p style="margin-top:14px;"><button class="pd-btn pd-btn-primary" id="ms-e-imp">Import from Excel</button> ' +
        '<button class="pd-btn" id="ms-e-add">Add a submittal</button></p>' : '') + '</div>';
  }
  function wireEmpty() {
    var a = document.getElementById('ms-e-imp'); if (a) a.onclick = function () { document.getElementById('ms-file').click(); };
    var b = document.getElementById('ms-e-add'); if (b) b.onclick = function () { openForm(null); };
  }

  // ==========================================================================
  // CRUD
  // ==========================================================================
  function openForm(r) {
    if (!canWrite) { UI.toast('You do not have permission to edit submittals.', 'error'); return; }
    var e = r || {};
    function opts(list, cur, blank) {
      return (blank ? '<option value="">' + blank + '</option>' : '') + list.map(function (o) {
        var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? (o[0] + ' — ' + title(o[1])) : o;
        return '<option value="' + esc(v) + '"' + (String(cur || '') === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>';
      }).join('');
    }
    function f(label, id, val, type) {
      return '<label>' + esc(label) + '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : (type === 'date' ? String(val).slice(0, 10) : val)) + '" /></label>';
    }
    var body =
      '<div class="ms-sec">Material submittal number</div>' +
      '<div class="ms-codeparts">' +
        '<label>Project<input id="ms-c-proj" value="' + esc(e.code_project || '') + '" placeholder="TMS" /></label>' +
        '<label>Building<select id="ms-c-bldg">' + opts(BUILDINGS, e.code_building, '—') + '</select></label>' +
        '<label>Company<input id="ms-c-comp" value="' + esc(e.code_company || 'MCC') + '" placeholder="MCC" /></label>' +
        '<label>Doc type<select id="ms-c-doc">' + opts(DOCTYPES, e.code_doctype || 'MT', '—') + '</select></label>' +
        '<label>Discipline<select id="ms-c-disc">' + opts(DISCIPLINES, e.code_discipline || e.discipline, '—') + '</select></label>' +
        '<label>Floor level<input id="ms-c-floor" value="' + esc(e.code_floor || '') + '" placeholder="GEN" /></label>' +
        '<label>Number<input id="ms-c-num" value="' + esc(e.code_number || '') + '" placeholder="1000" /></label>' +
      '</div>' +
      '<div class="ms-codeprev" id="ms-codeprev"><span>Preview</span><br>—</div>' +

      '<div class="ms-sec">Classification</div>' +
      '<label>Trade section<select id="ms-f-sec2"><option value="">—</option>' +
        SECTIONS.map(function (s) { return '<option' + (e.trade_section === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
      '</select></label>' +
      '<label>Discipline (drives the dashboard)<select id="ms-f-disc2">' + opts(DISCIPLINES, e.discipline || e.code_discipline, '—') + '</select></label>' +
      f('Floor levels', 'ms-f-floors', e.floor_levels) +
      f('Location', 'ms-f-loc', e.location) +

      '<div class="ms-sec">Item</div>' +
      '<label class="ms-wide">Item<input id="ms-f-item" value="' + esc(e.material || '') + '" placeholder="e.g. Reinforcement Bar" /></label>' +
      '<label class="ms-wide">Specification<textarea id="ms-f-spec">' + esc(e.specification || '') + '</textarea></label>' +
      f('Reference document', 'ms-f-ref', e.reference_document) +
      f('Brand', 'ms-f-brand', e.brand) +
      f('Vendor / supplier', 'ms-f-vendor', e.supplier) +
      '<label>Type of presentation<select id="ms-f-pres2"><option value="">—</option>' +
        PRESENTATION.map(function (p) { return '<option' + (e.type_presentation === p ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') +
      '</select></label>' +

      '<div class="ms-sec">Dates</div>' +
      f('Required date baseline', 'ms-f-req', e.date_required, 'date') +
      f('Plan submission', 'ms-f-psub', e.plan_submission_date, 'date') +
      f('Actual submission', 'ms-f-asub', e.date_submitted, 'date') +
      f('Plan approval', 'ms-f-pappr', e.plan_approval_date, 'date') +
      f('Actual approval', 'ms-f-aappr', e.date_approved, 'date') +

      '<div class="ms-sec">Approval</div>' +
      '<label>Approver — consultant<input id="ms-f-cons" list="ms-dl-cons" value="' + esc(e.approver_consultant || '') + '" />' +
        '<datalist id="ms-dl-cons">' + CONSULTANTS.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist></label>' +
      f('Approver — client', 'ms-f-client', e.approver_client) +
      f('Revision no.', 'ms-f-rev', e.revision_no) +
      '<label>Status<select id="ms-f-stat2"><option value="">—</option>' +
        STATUS_ORDER.map(function (s) { return '<option' + (statusOf(e) === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
      '</select></label>' +
      f('MAS ID', 'ms-f-mas', e.mas_id) +
      '<label class="ms-wide">Remarks<textarea id="ms-f-rem">' + esc(e.remarks || '') + '</textarea></label>' +

      '<div class="ms-sec">Document</div>' +
      '<div class="ms-filefield">' +
        (e.file_url
          ? '<div class="ms-filenow" id="ms-file-now"><span data-ico="eye" data-ico-size="14"></span>' +
            '<button type="button" class="ms-filelink" id="ms-file-open">' + esc(fileLabel(e.file_url)) + '</button>' +
            '<button type="button" class="ms-filerm" id="ms-file-rm" title="Remove this attachment">&times;</button></div>'
          : '') +
        '<label class="ms-wide" style="margin:0;">' + (e.file_url ? 'Replace document' : 'Attach document') +
          ' <span class="ms-mut" style="font-weight:400;">(PDF, image, or any submittal document)</span>' +
          '<input id="ms-f-file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.dwg,.zip" /></label>' +
      '</div>';

    var m = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">' + (r ? 'Edit' : 'Add') + ' material submittal</h2>' +
      '<button class="pd-modal-close" id="ms-m-x">&times;</button></div>' +
      '<div class="ms-form">' + body + '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" id="ms-m-cancel">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="ms-m-save">Save</button></div>');

    var el = function (id) { return m.el.querySelector('#' + id); };
    function syncPrev() {
      var parts = ['ms-c-proj','ms-c-bldg','ms-c-comp','ms-c-doc','ms-c-disc','ms-c-floor','ms-c-num']
        .map(function (i) { return (el(i).value || '').trim(); }).filter(Boolean);
      el('ms-codeprev').innerHTML = '<span>Preview</span><br>' + (parts.length ? esc(parts.join('-')) : '—');
    }
    ['ms-c-proj','ms-c-bldg','ms-c-comp','ms-c-doc','ms-c-disc','ms-c-floor','ms-c-num'].forEach(function (i) {
      el(i).addEventListener('input', syncPrev); el(i).addEventListener('change', syncPrev);
    });
    // Keep the dashboard discipline in step with the code's discipline part unless
    // the user has deliberately set it to something else.
    el('ms-c-disc').addEventListener('change', function () {
      if (!el('ms-f-disc2').value) el('ms-f-disc2').value = el('ms-c-disc').value;
    });
    syncPrev();
    if (window.Icons && Icons.hydrate) Icons.hydrate(m.el);

    // Attachment controls. `fileCleared` is only committed on Save, so cancelling
    // the dialog can never orphan or delete a document.
    var fileCleared = false;
    var openBtn = el('ms-file-open'), rmBtn = el('ms-file-rm');
    if (openBtn) openBtn.onclick = function () { viewFile(e.file_url); };
    if (rmBtn) rmBtn.onclick = function () {
      fileCleared = true;
      var now = el('ms-file-now'); if (now) now.remove();
      UI.toast('Attachment will be removed when you save.', 'info');
    };

    el('ms-m-x').onclick = m.close;
    el('ms-m-cancel').onclick = m.close;
    el('ms-m-save').onclick = async function () {
      var v = function (id) { var x = (el(id).value || '').trim(); return x === '' ? null : x; };
      var payload = {
        project_id: pid,
        code_project: v('ms-c-proj'), code_building: v('ms-c-bldg'), code_company: v('ms-c-comp'),
        code_doctype: v('ms-c-doc'), code_discipline: v('ms-c-disc'), code_floor: v('ms-c-floor'), code_number: v('ms-c-num'),
        trade_section: v('ms-f-sec2'), discipline: v('ms-f-disc2') || v('ms-c-disc'),
        floor_levels: v('ms-f-floors'), location: v('ms-f-loc'),
        material: v('ms-f-item'), specification: v('ms-f-spec'), reference_document: v('ms-f-ref'),
        brand: v('ms-f-brand'), supplier: v('ms-f-vendor'), type_presentation: v('ms-f-pres2'),
        date_required: v('ms-f-req'), plan_submission_date: v('ms-f-psub'), date_submitted: v('ms-f-asub'),
        plan_approval_date: v('ms-f-pappr'), date_approved: v('ms-f-aappr'),
        approver_consultant: v('ms-f-cons'), approver_client: v('ms-f-client'),
        revision_no: v('ms-f-rev'), status: v('ms-f-stat2'), mas_id: v('ms-f-mas'), remarks: v('ms-f-rem'),
        updated_at: new Date().toISOString()
      };
      payload.submittal_no = [payload.code_project, payload.code_building, payload.code_company, payload.code_doctype,
        payload.code_discipline, payload.code_floor, payload.code_number].filter(Boolean).join('-') || null;
      if (!payload.material) { UI.toast('Item is required.', 'error'); return; }

      // ---- attachment: upload BEFORE the row write, so a failed upload can't
      // leave the row pointing at an object that doesn't exist. -----------------
      var saveBtn = el('ms-m-save'), fileEl = el('ms-f-file');
      var picked = fileEl && fileEl.files && fileEl.files[0];
      var oldPath = r ? r.file_url : null, uploaded = null;
      if (picked) {
        saveBtn.disabled = true; saveBtn.textContent = 'Uploading…';
        try { uploaded = await uploadFile(picked); }
        catch (err) {
          saveBtn.disabled = false; saveBtn.textContent = 'Save';
          UI.toast('Upload failed: ' + (err.message || err), 'error');
          return;                                    // nothing written — safe to retry
        }
        payload.file_url = uploaded;
      } else if (fileCleared) {
        payload.file_url = null;
      }
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

      var res;
      if (r) res = await sb().from(TABLE).update(payload).eq('id', r.id).select().single();
      else { payload.created_by = UID; res = await sb().from(TABLE).insert(payload).select().single(); }
      if (res.error) {
        // Roll the orphan back rather than leaving it in the bucket forever.
        if (uploaded) await removeFiles([uploaded]);
        saveBtn.disabled = false; saveBtn.textContent = 'Save';
        UI.toast(res.error.message, 'error'); return;
      }
      // Row now points at the new object (or none) — drop the superseded one.
      if (oldPath && (uploaded || fileCleared) && oldPath !== payload.file_url) await removeFiles([oldPath]);

      if (r) Object.assign(r, res.data); else rows.push(res.data);
      m.close(); UI.toast(r ? 'Submittal updated.' : 'Submittal added.', 'success');
      render();
    };
  }

  async function delRow(id) {
    var r = rows.find(function (x) { return String(x.id) === String(id); });
    if (!r || !confirm('Delete "' + (r.material || 'this submittal') + '"? This cannot be undone.')) return;
    var res = await sb().from(TABLE).delete().eq('id', id);
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    await removeFiles([r.file_url]);            // row is gone; drop its document too
    rows = rows.filter(function (x) { return String(x.id) !== String(id); });
    delete sel[id];
    UI.toast('Submittal deleted.', 'success'); render();
  }

  async function bulkStatus(status) {
    var ids = Object.keys(sel).filter(function (k) { return sel[k]; });
    if (!ids.length) return;
    var res = await sb().from(TABLE).update({ status: status, updated_at: new Date().toISOString() }).in('id', ids);
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    rows.forEach(function (r) { if (sel[r.id]) r.status = status; });
    UI.toast('Updated ' + ids.length + ' submittal' + (ids.length === 1 ? '' : 's') + '.', 'success');
    sel = {}; render();
  }

  async function bulkDelete() {
    var ids = Object.keys(sel).filter(function (k) { return sel[k]; });
    if (!ids.length || !confirm('Delete ' + ids.length + ' submittal' + (ids.length === 1 ? '' : 's') + '? This cannot be undone.')) return;
    // Capture the paths BEFORE the rows leave `rows`, or they're unrecoverable.
    var paths = rows.filter(function (r) { return sel[r.id] && r.file_url; }).map(function (r) { return r.file_url; });
    for (var i = 0; i < ids.length; i += 100) {
      var res = await sb().from(TABLE).delete().in('id', ids.slice(i, i + 100));
      if (res.error) { UI.toast(res.error.message, 'error'); return; }
    }
    await removeFiles(paths);
    rows = rows.filter(function (r) { return !sel[r.id]; });
    sel = {}; UI.toast('Deleted ' + ids.length + ' submittal' + (ids.length === 1 ? '' : 's') + '.', 'success'); render();
  }

  async function clearAll() {
    if (!isAdmin) { UI.toast('Clearing the log is restricted to admins.', 'error'); return; }
    var m = UI.modal('<h2 style="margin-top:0;">Clear material submittal log</h2>' +
      '<p style="color:var(--pd-muted);font-size:13px;">This permanently deletes <strong>all ' + rows.length + ' submittals</strong> for project <strong>' + esc(pid) + '</strong> and cannot be undone. To confirm, type the project code below.</p>' +
      '<input class="pd-input" id="ms-clr-in" placeholder="Type ' + esc(pid) + ' to confirm" autocomplete="off" />' +
      '<div style="text-align:right;margin-top:12px;"><button class="pd-btn" id="ms-clr-x">Cancel</button> ' +
      '<button class="pd-btn pd-btn-danger" id="ms-clr-go" disabled>Delete all submittals</button></div>');
    var inp = m.el.querySelector('#ms-clr-in'), go = m.el.querySelector('#ms-clr-go');
    inp.oninput = function () { go.disabled = inp.value.trim() !== String(pid); };
    inp.focus();
    m.el.querySelector('#ms-clr-x').onclick = m.close;
    go.onclick = async function () {
      if (inp.value.trim() !== String(pid)) return;
      m.close();
      var paths = rows.filter(function (r) { return r.file_url; }).map(function (r) { return r.file_url; });
      var res = await sb().from(TABLE).delete().eq('project_id', pid);
      if (res.error) { UI.toast(res.error.message, 'error'); return; }
      await removeFiles(paths);
      rows = []; sel = {}; UI.toast('Log cleared.', 'success'); render();
    };
  }

  // ==========================================================================
  // IMPORT — the PMO workbook layout
  // ==========================================================================
  /* The sheet is NOT a flat table: rows 10/11/12 are a 3-tier merged header, and
     the body is broken up by single-cell TRADE SECTION rows (GENERAL REQUIREMENT,
     SITEWORKS, …) that own the rows beneath them. Column positions are fixed by
     that header, so we locate the header row and read by index rather than by
     fuzzy header matching (several headers repeat — "Floor Levels" appears twice). */
  var C = { NO:0, PROJ:1, BLDG:2, COMP:3, DOC:4, DISC:5, FLOOR:6, NUM:7, TRADE:8, FLOORS:9, LOC:10,
            ITEM:11, SPEC:12, REF:13, BRAND:14, VENDOR:15, PRES:16, REQ:17, PSUB:18, ASUB:19,
            PAPPR:20, AAPPR:21, CONS:22, CLIENT:23, REV:24, STATUS:25, REM:26, MAS:27 };

  function pickSheet(wb) {
    var want = wb.SheetNames.filter(function (n) { return /material\s*submittal\s*log/i.test(n); });
    return want[0] || wb.SheetNames.filter(function (n) { return /submittal/i.test(n) && !/dashboard/i.test(n); })[0] || wb.SheetNames[0];
  }

  // Matches the sign-off block that trails the data ("PREPARED AND CHECKED BY:",
  // "REVIEWED BY:", then names and job titles). Everything from there down is not data.
  var SIGNOFF_RE = /^\s*(prepared|reviewed|checked|noted|recommended|endorsed|verified|approved)\b.*\bby\b\s*:?\s*$/i;

  function parseWorkbook(wb) {
    var name = pickSheet(wb);
    // raw:false → cells arrive as their DISPLAYED text ("18-Mar-24"), which keeps
    // date parsing timezone-independent. See the note above parseDate.
    var aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    var S = function (row, i) { var v = row[i]; return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); };

    // Find the header row ("NO." + "MATERIAL SUBMITTAL NUMBER"), then start after
    // its two sub-header rows. Falls back to the workbook's known position.
    var hdr = -1;
    for (var i = 0; i < Math.min(aoa.length, 40); i++) {
      var r = aoa[i] || [];
      if (/^no\.?$/i.test(S(r, 0)) && /material\s*submittal\s*number/i.test(S(r, 1))) { hdr = i; break; }
    }
    var start = hdr >= 0 ? hdr + 3 : 12;

    var out = [], sections = {}, section = '', skipped = 0, order = 0;
    for (var j = start; j < aoa.length; j++) {
      var row = aoa[j] || [];
      var filled = row.filter(function (x) { return String(x == null ? '' : x).trim() !== ''; }).length;
      if (!filled) continue;

      // Stop completely at the sign-off block — the rows below it are names and job
      // titles, which otherwise import as submittals ("REVIEWED BY:", "Project Manager").
      var isSignoff = false;
      for (var k = 0; k <= C.ITEM; k++) if (SIGNOFF_RE.test(S(row, k))) { isSignoff = true; break; }
      if (isSignoff) break;

      // A section header is a lone label in the first columns with no item.
      if (filled <= 2 && !S(row, C.ITEM)) {
        var lbl = (S(row, 0) || S(row, 1)).toUpperCase();
        if (lbl) { section = lbl; sections[lbl] = true; }
        continue;
      }
      /* A row is a real submittal when it carries substance — NOT merely when it has
         an Item. One row in the reference workbook (sheet row 33) has a full code,
         dates and a status but a blank Item; requiring an Item silently dropped it and
         put the status total one under the workbook's own COUNTIF. Its Item stays null
         and renders as "(untitled)" rather than being invented. */
      var item = S(row, C.ITEM);
      var substantive = item || S(row, C.NUM) || S(row, C.STATUS) || S(row, C.MAS);
      if (!substantive || filled < 3) { skipped++; continue; }

      var disc = S(row, C.DISC).toUpperCase();
      var code = [S(row, C.PROJ), S(row, C.BLDG), S(row, C.COMP), S(row, C.DOC), disc, S(row, C.FLOOR), S(row, C.NUM)].filter(Boolean);
      out.push({
        project_id: pid,
        code_project: S(row, C.PROJ) || null, code_building: S(row, C.BLDG) || null, code_company: S(row, C.COMP) || null,
        code_doctype: S(row, C.DOC) || null, code_discipline: disc || null, code_floor: S(row, C.FLOOR) || null,
        code_number: S(row, C.NUM) || null,
        submittal_no: code.length ? code.join('-') : null,
        trade_section: section || null,
        // Dashboard groups by `discipline`; fall back to the sparse Trades column
        // only when the code has no discipline part.
        discipline: disc || S(row, C.TRADE).toUpperCase() || null,
        trade_code: S(row, C.TRADE).toUpperCase() || null,   // reconciliation only
        floor_levels: S(row, C.FLOORS) || null, location: S(row, C.LOC) || null,
        material: item || null, specification: S(row, C.SPEC) || null, reference_document: S(row, C.REF) || null,
        brand: S(row, C.BRAND) || null, supplier: S(row, C.VENDOR) || null,
        type_presentation: normPres(S(row, C.PRES)),
        date_required: parseDate(row[C.REQ]), plan_submission_date: parseDate(row[C.PSUB]),
        date_submitted: parseDate(row[C.ASUB]), plan_approval_date: parseDate(row[C.PAPPR]),
        date_approved: parseDate(row[C.AAPPR]),
        approver_consultant: S(row, C.CONS) || null, approver_client: S(row, C.CLIENT) || null,
        revision_no: S(row, C.REV) || null, status: normStatus(S(row, C.STATUS)),
        remarks: S(row, C.REM) || null, mas_id: S(row, C.MAS) || null,
        seq_no: parseInt(S(row, C.NO), 10) || null, sort_order: order++
      });
    }
    return { sheet: name, records: out, sections: Object.keys(sections), skipped: skipped };
  }

  // Map loose spellings onto the Library sheet's vocabularies.
  function normStatus(s) {
    if (!s) return null;
    var t = s.toLowerCase().replace(/[.\s]+/g, ' ').trim();
    if (/^a$/.test(t)) return 'Approved';
    if (/^b$/.test(t)) return 'Approved w/ Comments';
    if (/^c$/.test(t)) return 'Resubmit';
    if (/^d$/.test(t)) return 'Rejected';
    if (/^f$/.test(t)) return 'For Information';
    if (/^p$/.test(t)) return 'For Submission';
    if (/approved\s*w|comment/.test(t)) return 'Approved w/ Comments';
    if (/approved/.test(t)) return 'Approved';
    if (/resubmit/.test(t)) return 'Resubmit';
    if (/reject/.test(t)) return 'Rejected';
    if (/information/.test(t)) return 'For Information';
    if (/pending/.test(t)) return 'Pending Approval';
    if (/submission|submit/.test(t)) return 'For Submission';
    return s;
  }
  function normPres(s) {
    if (!s) return null;
    var t = s.toLowerCase();
    for (var i = 0; i < PRESENTATION.length; i++) if (PRESENTATION[i].toLowerCase() === t) return PRESENTATION[i];
    if (/brochure|data\s*sheet/.test(t)) return 'Brochure and Technical Data Sheet';
    if (/board/.test(t)) return 'Sample Board';
    if (/mock/.test(t)) return 'Mock Up';
    if (/certif/.test(t)) return 'Product Certification';
    if (/test/.test(t)) return 'Test Results';
    if (/sample/.test(t)) return 'Sample';
    return s;
  }

  function onFile(ev) {
    var file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    if (!canWrite) { UI.toast('You do not have permission to import.', 'error'); return; }
    var fr = new FileReader();
    fr.onload = function (e) {
      var parsed;
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
        parsed = parseWorkbook(wb);
      } catch (err) { UI.toast('Could not read that workbook: ' + (err.message || err), 'error'); return; }
      if (!parsed.records.length) {
        UI.toast('No submittals found on sheet "' + parsed.sheet + '" — is this the Material Submittal workbook?', 'error');
        return;
      }
      previewImport(parsed, file.name);
    };
    fr.readAsArrayBuffer(file);
  }

  function previewImport(parsed, fname) {
    var recs = parsed.records;
    var withStatus = recs.filter(function (r) { return r.status; }).length;
    var withAppr = recs.filter(function (r) { return r.plan_approval_date || r.date_approved; }).length;
    var noDisc = recs.filter(function (r) { return !r.discipline; }).length;

    var m = UI.modal('<div class="pd-modal-header"><h2 style="margin:0;">Import material submittals</h2>' +
      '<button class="pd-modal-close" id="ms-i-x">&times;</button></div>' +
      '<p style="color:var(--pd-muted);font-size:13px;margin:10px 0 0;">From <b>' + esc(fname) + '</b> · sheet <b>' + esc(parsed.sheet) + '</b></p>' +
      '<div class="ms-imp">' +
        '<div><b>' + recs.length + '</b><span>Submittals</span></div>' +
        '<div><b>' + parsed.sections.length + '</b><span>Trade sections</span></div>' +
        '<div><b>' + withStatus + '</b><span>With a status</span></div>' +
        '<div><b>' + withAppr + '</b><span>With approval dates</span></div>' +
      '</div>' +
      (noDisc ? '<p class="ms-mut" style="font-size:12.5px;">' + noDisc + ' submittal' + (noDisc === 1 ? '' : 's') + ' have no discipline code — they will be grouped under “Other” on the dashboard.</p>' : '') +
      (parsed.skipped ? '<p class="ms-mut" style="font-size:12.5px;">' + parsed.skipped + ' non-item row' + (parsed.skipped === 1 ? '' : 's') + ' skipped (blank or sign-off rows).</p>' : '') +
      '<label class="ms-chk" style="margin-top:6px;"><input type="checkbox" id="ms-i-repl" ' + (rows.length ? 'checked' : '') + ' /> Replace the ' + rows.length + ' submittal' + (rows.length === 1 ? '' : 's') + ' already in this project</label>' +
      '<div class="pd-modal-footer"><button class="pd-btn" id="ms-i-cancel">Cancel</button> ' +
      '<button class="pd-btn pd-btn-primary" id="ms-i-go">Import ' + recs.length + '</button></div>');

    m.el.querySelector('#ms-i-x').onclick = m.close;
    m.el.querySelector('#ms-i-cancel').onclick = m.close;
    m.el.querySelector('#ms-i-go').onclick = async function () {
      var replace = m.el.querySelector('#ms-i-repl').checked;
      m.close();
      await doImport(recs, replace);
    };
  }

  async function doImport(recs, replace) {
    var host = document.getElementById('ms-view');
    host.innerHTML = '<div class="pd-card ms-empty"><h3><span class="ms-spin"></span>Importing…</h3><p id="ms-imp-p">Preparing…</p></div>';
    var p = document.getElementById('ms-imp-p');
    if (replace) {
      p.textContent = 'Clearing existing submittals…';
      // Their documents go too — otherwise every re-import leaves the previous
      // set orphaned in the bucket with no row referencing them.
      var paths = rows.filter(function (x) { return x.file_url; }).map(function (x) { return x.file_url; });
      var del = await sb().from(TABLE).delete().eq('project_id', pid);
      if (del.error) { UI.toast('Could not clear existing: ' + del.error.message, 'error'); load(); return; }
      await removeFiles(paths);
    }
    recs.forEach(function (r) { r.created_by = UID; });
    var ok = 0, CH = 200;
    for (var i = 0; i < recs.length; i += CH) {
      p.textContent = 'Importing ' + Math.min(i + CH, recs.length) + ' of ' + recs.length + '…';
      var res = await sb().from(TABLE).insert(recs.slice(i, i + CH));
      if (res.error) {
        // A missing column means the migration hasn't been run — say so plainly
        // rather than failing with Postgres' wording.
        var msg = /column|schema cache|PGRST204/i.test(res.error.message || '')
          ? 'Import failed — run migrations/2026-07-20-material-submittal-full.sql first. (' + res.error.message + ')'
          : res.error.message;
        UI.toast(msg, 'error'); break;
      }
      ok += recs.slice(i, i + CH).length;
    }
    UI.toast('Imported ' + ok + ' submittal' + (ok === 1 ? '' : 's') + '.', ok ? 'success' : 'error');
    sel = {}; collapsed = {};
    await load();
  }

  // ==========================================================================
  // EXPORT / PRINT
  // ==========================================================================
  function exportExcel() {
    var list = visibleRows();
    if (!list.length) { UI.toast('Nothing to export.', 'error'); return; }
    var aoa = list.map(function (r) {
      return {
        'NO.': r.seq_no || '',
        'Material Submittal Number': codeOf(r),
        'Trade Section': r.trade_section || '',
        'Discipline': discOf(r),
        'Floor Levels': r.floor_levels || '',
        'Location': r.location || '',
        'Item': r.material || '',
        'Specification': r.specification || '',
        'Reference Document': r.reference_document || '',
        'Brand': r.brand || '',
        'Vendor': r.supplier || '',
        'Type of Presentation': r.type_presentation || '',
        'Required Date Baseline': fmtDate(r.date_required),
        'Plan Submission Date': fmtDate(r.plan_submission_date),
        'Actual Submission Date': fmtDate(r.date_submitted),
        'Plan Approval Date': fmtDate(r.plan_approval_date),
        'Actual Approval Date': fmtDate(r.date_approved),
        'Approver - Consultant': r.approver_consultant || '',
        'Approver - Client': r.approver_client || '',
        'Revision No.': r.revision_no || '',
        'Status': statusOf(r),
        'Remarks': r.remarks || '',
        'MAS ID': r.mas_id || '',
        // Filename only — the object is private, so a link would be useless once
        // its signed URL expires (60s).
        'Document': fileLabel(r.file_url)
      };
    });
    var ws = XLSX.utils.json_to_sheet(aoa);
    ws['!cols'] = Object.keys(aoa[0]).map(function (k) { return { wch: k === 'Item' || k === 'Specification' ? 34 : Math.max(12, k.length + 2) }; });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Material Submittal Log');
    XLSX.writeFile(wb, 'Material Submittal Log - ' + (projName() || pid) + '.xlsx');
  }
  function projName() {
    var s = document.getElementById('ms-project');
    return s && s.selectedIndex >= 0 ? s.options[s.selectedIndex].textContent : '';
  }

  // ==========================================================================
  // SHELL
  // ==========================================================================
  function render() {
    document.getElementById('ms-filters').style.display = view === 'log' ? '' : 'none';
    if (view === 'dashboard') renderDashboard(); else renderLog();
    syncClearFilt();
  }

  function syncClearFilt() {
    var on = !!(filters.q || filters.section || filters.disc || filters.status || filters.pres || filters.overdue);
    var b = document.getElementById('ms-f-clear');
    if (b) b.hidden = !on;
  }

  function fillFilters() {
    function fill(id, values, cur) {
      var s = document.getElementById(id);
      var first = s.options[0].outerHTML;
      s.innerHTML = first + values.map(function (v) {
        return '<option' + (cur === v ? ' selected' : '') + '>' + esc(v) + '</option>';
      }).join('');
    }
    var secs = SECTIONS.filter(function (s) { return rows.some(function (r) { return sectionOf(r) === s; }); });
    rows.forEach(function (r) { var s = sectionOf(r); if (secs.indexOf(s) < 0) secs.push(s); });
    fill('ms-f-section', secs, filters.section);
    var discs = []; rows.forEach(function (r) { var d = discOf(r); if (d && discs.indexOf(d) < 0) discs.push(d); });
    fill('ms-f-discipline', discs.sort(), filters.disc);
    fill('ms-f-status', STATUS_ORDER, filters.status);
    fill('ms-f-pres', PRESENTATION, filters.pres);
  }

  async function load() {
    if (!pid) { rows = []; render(); return; }
    loading = true;
    document.getElementById('ms-view').innerHTML = '<div class="pd-card ms-empty"><h3><span class="ms-spin"></span>Loading…</h3></div>';
    var res = await sb().from(TABLE).select('*').eq('project_id', pid).order('sort_order', { ascending: true });
    loading = false;
    if (res.error) {
      // The module ships ahead of its migration on some environments — be explicit.
      var missing = /column|schema cache|PGRST204|does not exist/i.test(res.error.message || '');
      document.getElementById('ms-view').innerHTML = '<div class="pd-card ms-empty"><h3>Could not load the log</h3><p>' +
        esc(res.error.message) + '</p>' + (missing ? '<p class="ms-mut">Run <code>migrations/2026-07-20-material-submittal-full.sql</code> in the Supabase SQL editor, then reload.</p>' : '') + '</div>';
      return;
    }
    rows = res.data || [];
    // Stable order: sort_order then the workbook's own NO., then item.
    rows.sort(function (a, b) {
      var d = (a.sort_order || 0) - (b.sort_order || 0); if (d) return d;
      d = (a.seq_no || 0) - (b.seq_no || 0); if (d) return d;
      return String(a.material || '').localeCompare(String(b.material || ''));
    });
    fillFilters();
    render();
  }

  function switchTab(v) {
    view = v;
    document.querySelectorAll('.ms-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === v); });
    render();
  }

  async function init(user, profile) {
    UID = (user && user.id) || (profile && profile.id) || null;
    PROFILE = profile;
    isAdmin = !!(profile && (profile.role === 'admin' || profile.role === 'super_admin'));
    canWrite = !!(profile && ['super_admin', 'admin', 'planner'].indexOf(profile.role) !== -1);
    UI.initShell();

    document.getElementById('ms-clear').style.display = isAdmin ? '' : 'none';
    if (!canWrite) {
      ['ms-add', 'ms-import'].forEach(function (id) { var b = document.getElementById(id); if (b) b.style.display = 'none'; });
    }

    // ---- project selector (shared searchable browser) ----
    var selEl = document.getElementById('ms-project');
    var projects = [];
    try { projects = (await PDb.getProjects()) || []; } catch (e) { projects = []; }
    projects = projects.filter(function (p) { return !AppAuth.canAccessProject || AppAuth.canAccessProject(profile, p.id); });
    selEl.innerHTML = projects.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name || p.id) + '</option>'; }).join('');
    var stored = sessionStorage.getItem('pd_project');
    if (stored && projects.some(function (p) { return String(p.id) === String(stored); })) selEl.value = stored;
    pid = selEl.value || (projects[0] && projects[0].id) || null;
    if (UI.enhanceProjectSelect) UI.enhanceProjectSelect(selEl);
    selEl.addEventListener('change', function () {
      pid = selEl.value;
      sessionStorage.setItem('pd_project', pid);
      sel = {}; collapsed = {}; noteDismissed = false;
      load();
    });

    // ---- tabs ----
    document.querySelectorAll('.ms-tab').forEach(function (t) {
      t.onclick = function () { switchTab(t.dataset.view); };
    });

    // ---- tools ----
    document.getElementById('ms-add').onclick = function () { openForm(null); };
    document.getElementById('ms-import').onclick = function () { document.getElementById('ms-file').click(); };
    document.getElementById('ms-file').addEventListener('change', onFile);
    document.getElementById('ms-export').onclick = exportExcel;
    document.getElementById('ms-print').onclick = function () {
      if (view !== 'log') switchTab('log');
      setTimeout(function () { window.print(); }, 60);
    };
    document.getElementById('ms-clear').onclick = clearAll;

    // ---- filters ----
    var q = document.getElementById('ms-f-search'), t = null;
    q.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () { filters.q = q.value; render(); }, 160);
    });
    document.getElementById('ms-f-section').addEventListener('change', function (e) { filters.section = e.target.value; render(); });
    document.getElementById('ms-f-discipline').addEventListener('change', function (e) { filters.disc = e.target.value; render(); });
    document.getElementById('ms-f-status').addEventListener('change', function (e) { filters.status = e.target.value; render(); });
    document.getElementById('ms-f-pres').addEventListener('change', function (e) { filters.pres = e.target.value; render(); });
    document.getElementById('ms-f-overdue').addEventListener('change', function (e) { filters.overdue = e.target.checked; render(); });
    document.getElementById('ms-f-clear').onclick = function () {
      filters = { q: '', section: '', disc: '', status: '', pres: '', overdue: false };
      q.value = '';
      ['ms-f-section', 'ms-f-discipline', 'ms-f-status', 'ms-f-pres'].forEach(function (id) { document.getElementById(id).value = ''; });
      document.getElementById('ms-f-overdue').checked = false;
      render();
    };

    await load();
  }

  // Exposed for the harness/tests as well as the page.
  return {
    init: init,
    _internals: { parseWorkbook: parseWorkbook, scurve: scurve, legacyScurve: legacyScurve,
      statusCounts: statusCounts, kpis: kpis, parseDate: parseDate, normStatus: normStatus,
      normPres: normPres, setPid: function (x) { pid = x; } }
  };
})();
