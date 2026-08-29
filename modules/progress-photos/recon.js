// ============================================================================
// Progress Photos — 3D Reconstruction Requests (brief 6A / Phase 4)
// ----------------------------------------------------------------------------
// This is a PAID feature (a real per-job GPU cost on RunPod), so — per the
// app owner's explicit requirement — every request goes through an ADMIN
// APPROVAL gate before it is ever sent for processing. The gate is enforced
// at the database level (reconstruction_requests' RLS: only an admin may
// move a row past 'pending_approval'), and again inside the
// submit-reconstruction Edge Function itself — this client is the UI for
// that workflow, not the enforcement of it.
//
// Flow: any writer records/uploads a walkthrough video against a location ->
// row inserted as 'pending_approval' -> an admin sees it in the approval
// queue and clicks Approve -> the Edge Function submits it to RunPod and the
// row becomes 'queued' -> RunPod's own webhook moves it through
// 'processing' -> 'done'/'failed' as the job progresses -> a 'done' request
// can be opened in the 3D viewer (point cloud now; the trained Gaussian
// Splat once the RunPod worker actually produces one — see the module's
// CLAUDE.md for what that side still needs, i.e. an actual deployment).
// ============================================================================

window.RECON = (function () {
  var T_REQ   = 'reconstruction_requests';
  var BUCKET  = 'progress-photos';
  var SIGN_TTL = 3600;

  var profile = null, uid = null, pid = null, projName = '';
  var canWrite = false, isAdmin = false;
  var requests = [];

  function sb() { return AppAuth.getSB(); }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return Fmt.esc(s); }

  function openModal(html, width) {
    var m = UI.modal(html);
    var box = m.el.querySelector('.pd-modal');
    if (box && width) box.style.maxWidth = width + 'px';
    Array.prototype.forEach.call(m.el.querySelectorAll('[data-close]'), function (b) { b.onclick = m.close; });
    if (window.Icons && Icons.hydrate) Icons.hydrate(m.el);
    return m;
  }

  function init(user, prof) {
    profile = prof; uid = user.id;
    canWrite = ['super_admin', 'admin', 'planner'].indexOf(prof.role) >= 0;
    isAdmin = ['super_admin', 'admin'].indexOf(prof.role) >= 0;
    wire();
    ProgressPhotos.onProject(function (p, name) { pid = p; projName = name; load(); });
  }

  function wire() {
    if ($('recon-new')) $('recon-new').onclick = function () { openRequestForm(); };
  }
  function syncTools(visible) {
    if ($('recon-new')) $('recon-new').style.display = (visible && canWrite) ? '' : 'none';
  }

  async function load() {
    var host = $('recon-view');
    if (!host) return;
    if (!pid) { host.innerHTML = '<div class="pp-empty">Select a project.</div>'; return; }
    host.innerHTML = '<div class="pp-empty">Loading requests…</div>';
    try {
      requests = await PDb.selectAll(T_REQ, function (q) { return q.eq('project_id', pid); });
      requests.sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); });
    } catch (e) {
      requests = [];
      if (!/schema cache|does not exist/i.test((e && e.message) || '')) UI.toast(e.message || String(e), 'error');
    }
    render();
  }

  function reqById(id) { return requests.filter(function (r) { return r.id === id; })[0] || null; }

  function allLocationCombos() {
    var byKey = {};
    (window.ProgressPhotos && ProgressPhotos.locCombos ? ProgressPhotos.locCombos() : [])
      .forEach(function (c) { byKey[c.key] = c; });
    (window.ProgressPhotos && ProgressPhotos.photoLocCombos ? ProgressPhotos.photoLocCombos() : [])
      .forEach(function (c) { if (!byKey[c.key]) byKey[c.key] = c; });
    return Object.keys(byKey).map(function (k) { return byKey[k]; }).sort(function (a, b) { return a.label.localeCompare(b.label); });
  }

  var STATUS_LABEL = {
    pending_approval: 'Pending approval', approved: 'Approved', rejected: 'Rejected',
    queued: 'Queued', processing: 'Processing', done: 'Done', failed: 'Failed'
  };
  var STATUS_CLASS = {
    pending_approval: 'recon-badge-pending', rejected: 'recon-badge-bad', failed: 'recon-badge-bad',
    done: 'recon-badge-ok', queued: 'recon-badge-mid', processing: 'recon-badge-mid', approved: 'recon-badge-mid'
  };

  function hydrate() { if (window.Icons && Icons.hydrate) Icons.hydrate($('recon-view')); }

  function render() {
    var host = $('recon-view');
    var pending = requests.filter(function (r) { return r.status === 'pending_approval'; });
    var html = '';

    // Admin approval queue — only rendered for admins, and only when there is
    // something to act on. A permanently-empty "queue" section is the same
    // invitation-to-a-no-op this app's own conventions elsewhere avoid.
    if (isAdmin && pending.length) {
      html += '<div class="recon-section"><h3 class="recon-sectitle">' +
        'Awaiting your approval (' + pending.length + ')</h3>' +
        '<p class="pp-hint">Each approval submits the video to RunPod for GPU processing — a real ' +
        'per-job cost. Review before approving.</p>' +
        pending.map(function (r) { return reqRowHTML(r, true); }).join('') + '</div>';
    }

    if (!requests.length) {
      html += '<div class="pp-empty">' +
        '<span data-ico="camera" data-ico-size="34"></span>' +
        '<p>No 3D reconstruction requests yet for this project.</p>' +
        (canWrite ? '<p class="pp-hint">Press <strong>+ Request 3D scan</strong> to submit a walkthrough ' +
          'video for processing. An admin must approve it before it is sent for (paid) processing.</p>' : '') +
        '</div>';
    } else {
      html += '<div class="recon-section"><h3 class="recon-sectitle">All requests</h3>' +
        requests.map(function (r) { return reqRowHTML(r, false); }).join('') + '</div>';
    }

    host.innerHTML = html;
    Array.prototype.forEach.call(host.querySelectorAll('[data-act]'), function (el) {
      el.onclick = function () {
        var r = reqById(el.dataset.id); if (!r) return;
        var a = el.dataset.act;
        if (a === 'approve') approveRequest(r);
        else if (a === 'reject') rejectRequest(r);
        else if (a === 'retract') retractRequest(r);
        else if (a === 'view') openResultViewer(r);
      };
    });
    hydrate();
  }

  function reqRowHTML(r, inQueue) {
    var canRetract = !inQueue && r.requested_by === uid && r.status === 'pending_approval';
    return '<div class="recon-row" data-id="' + esc(r.id) + '">' +
      '<div class="recon-rowmain">' +
        '<span class="recon-badge ' + (STATUS_CLASS[r.status] || '') + '">' + esc(STATUS_LABEL[r.status] || r.status) + '</span>' +
        '<span class="recon-loc">' + esc(r.location || 'Unassigned') + '</span>' +
        (r.video_source === 'drone' ? '<span class="recon-src" title="Drone-sourced footage">Drone</span>' : '') +
        '<span class="recon-date">' + esc(Fmt.date(r.created_at)) + '</span>' +
      '</div>' +
      (r.requested_note ? '<div class="recon-note">' + esc(r.requested_note) + '</div>' : '') +
      (r.status === 'rejected' && r.rejected_reason ? '<div class="recon-note recon-note-bad">Rejected: ' + esc(r.rejected_reason) + '</div>' : '') +
      (r.status === 'failed' && r.error_message ? '<div class="recon-note recon-note-bad">' + esc(r.error_message) + '</div>' : '') +
      '<div class="recon-acts">' +
        (inQueue ? '<button class="pd-btn pd-btn-primary" data-act="approve" data-id="' + esc(r.id) + '">Approve &amp; submit</button>' +
                   '<button class="pd-btn pd-btn-danger" data-act="reject" data-id="' + esc(r.id) + '">Reject</button>'
                 : '') +
        (canRetract ? '<button class="pd-btn" data-act="retract" data-id="' + esc(r.id) + '">Retract request</button>' : '') +
        (r.status === 'done' ? '<button class="pd-btn" data-act="view" data-id="' + esc(r.id) + '">View 3D</button>' : '') +
      '</div></div>';
  }

  // ------------------------------------------------------------- request ---
  function openRequestForm() {
    var combos = allLocationCombos();
    var html =
      '<div class="pd-modal-header"><h3>Request a 3D reconstruction</h3><button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form">' +
        '<p class="pp-hint">This submits a real GPU processing job once approved — an admin will review ' +
        'it first. Record a longer, more thorough walkthrough than a 360° spin (move through the space).</p>' +
        '<div class="pd-field"><label>Location</label>' +
          '<select class="pd-select" id="recon-c-loc"><option value="">— none / untracked —</option>' +
          combos.map(function (c) { return '<option value="' + esc(c.key) + '">' + esc(c.label) + '</option>'; }).join('') +
          '</select></div>' +
        '<div class="pd-field"><label>Source</label>' +
          '<select class="pd-select" id="recon-c-source">' +
            '<option value="ground">Ground (staff phone)</option>' +
            '<option value="drone">Drone (aerial)</option>' +
          '</select></div>' +
        '<div class="pd-field"><label>Walkthrough video</label>' +
          '<input type="file" id="recon-c-file" accept="video/*" /></div>' +
        '<div class="pd-field"><label>Note to the approver <span class="pp-optnote">(optional)</span></label>' +
          '<textarea class="pd-input" id="recon-c-note" rows="2"></textarea></div>' +
        '<p id="recon-c-status" class="pp-hint"></p>' +
      '</div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="recon-c-save">Submit for approval</button></div>';
    var m = openModal(html, 560);
    var combosByKey = {}; combos.forEach(function (c) { combosByKey[c.key] = c; });

    $('recon-c-save').onclick = async function () {
      var f = $('recon-c-file').files && $('recon-c-file').files[0];
      if (!f) { UI.toast('Choose a video file', 'warn'); return; }
      var status = $('recon-c-status');
      this.disabled = true;
      try {
        status.textContent = 'Uploading video…';
        var path = pid + '/reconstructions/pending/' + Date.now() + '_' + Math.random().toString(36).slice(2) + '_' + f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        var up = await sb().storage.from(BUCKET).upload(path, f, { contentType: f.type || 'video/mp4' });
        if (up.error) throw up.error;
        var combo = combosByKey[$('recon-c-loc').value] || null;
        var row = {
          project_id: pid, requested_by: uid, status: 'pending_approval',
          location_values: combo ? combo.values : {}, location: combo ? combo.label : null,
          video_url: path, video_source: $('recon-c-source').value,
          requested_note: $('recon-c-note').value.trim() || null
        };
        var ires = await sb().from(T_REQ).insert(row);
        if (ires.error) throw ires.error;
        m.close();
        UI.toast('Request submitted — an admin will review it before processing begins', 'ok');
        await load();
      } catch (e) {
        status.textContent = '';
        UI.toast('Could not submit the request: ' + (e.message || e), 'error');
        this.disabled = false;
      }
    };
  }

  async function approveRequest(r) {
    var html =
      '<div class="pd-modal-header"><h3>Approve &amp; submit for processing</h3><button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form"><p>This sends <strong>' + esc(r.location || 'this walkthrough') + '</strong> to RunPod ' +
      'for GPU processing. <strong>This is a real, billed job.</strong> Continue?</p></div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-primary" id="recon-ap-yes">Approve &amp; submit</button></div>';
    var m = openModal(html, 460);
    $('recon-ap-yes').onclick = async function () {
      this.disabled = true; this.textContent = 'Submitting…';
      try {
        var sess = await sb().auth.getSession();
        var res = await fetch(AppAuth.getSB().supabaseUrl + '/functions/v1/submit-reconstruction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sess.data.session.access_token },
          body: JSON.stringify({ request_id: r.id })
        });
        var j = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
        m.close();
        UI.toast('Approved and submitted to RunPod', 'ok');
        await load();
      } catch (e) {
        UI.toast('Could not submit: ' + (e.message || e), 'error');
        this.disabled = false; this.textContent = 'Approve & submit';
      }
    };
  }

  async function rejectRequest(r) {
    var html =
      '<div class="pd-modal-header"><h3>Reject request</h3><button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pp-form"><div class="pd-field"><label>Reason <span class="pp-optnote">(optional)</span></label>' +
      '<textarea class="pd-input" id="recon-rej-reason" rows="2"></textarea></div></div>' +
      '<div class="pd-modal-footer"><button class="pd-btn" data-close>Cancel</button>' +
        '<button class="pd-btn pd-btn-danger" id="recon-rej-yes">Reject</button></div>';
    var m = openModal(html, 460);
    $('recon-rej-yes').onclick = async function () {
      this.disabled = true;
      var res = await sb().from(T_REQ).update({
        status: 'rejected', rejected_reason: $('recon-rej-reason').value.trim() || null,
        updated_at: new Date().toISOString()
      }).eq('id', r.id).eq('status', 'pending_approval');
      if (res.error) { UI.toast(res.error.message, 'error'); this.disabled = false; return; }
      m.close(); UI.toast('Request rejected', 'ok');
      await load();
    };
  }

  async function retractRequest(r) {
    if (!confirm('Retract this request? It has not been approved yet.')) return;
    if (r.video_url) await sb().storage.from(BUCKET).remove([r.video_url]);
    var res = await sb().from(T_REQ).delete().eq('id', r.id).eq('status', 'pending_approval');
    if (res.error) { UI.toast(res.error.message, 'error'); return; }
    UI.toast('Request retracted', 'ok');
    await load();
  }

  // -------------------------------------------------------------- viewer ---
  // Renders the result point cloud (COLMAP's scaled sparse/dense cloud) as
  // THREE.Points via the official PLYLoader — this is what makes measurement
  // possible later (Phase 4/5), unlike the splat file, which is for viewing
  // only. Falls back to the splat file if no point cloud was returned.
  function openResultViewer(r) {
    var path = r.result_pointcloud_url || r.result_splat_url;
    if (!path) { UI.toast('No result file recorded on this request', 'warn'); return; }
    var html =
      '<div class="pd-modal-header"><h3>' + esc(r.location || '3D reconstruction') + '</h3>' +
        '<button class="pd-modal-close" data-close>×</button></div>' +
      '<div class="pano-viewerwrap"><canvas id="recon-canvas"></canvas>' +
      '<p class="pano-viewerhint">Drag to orbit · scroll to zoom</p></div>';
    var m = openModal(html, 900);
    var canvas = m.el.querySelector('#recon-canvas');
    canvas.width = 820; canvas.height = 520;
    sb().storage.from(BUCKET).createSignedUrl(path, SIGN_TTL).then(function (res) {
      if (res.error || !res.data) { UI.toast('Could not load the 3D file', 'error'); return; }
      mountPointCloudViewer(canvas, res.data.signedUrl);
    });
  }

  function mountPointCloudViewer(canvas, url) {
    if (typeof THREE === 'undefined' || typeof THREE.PLYLoader === 'undefined') {
      var ctx2d = canvas.getContext('2d');
      ctx2d.fillStyle = '#2B2C2B'; ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      ctx2d.fillStyle = '#fff'; ctx2d.font = '14px sans-serif';
      ctx2d.fillText('3D viewer library did not load — check the connection and reload.', 16, canvas.height / 2);
      return;
    }
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(canvas.width, canvas.height, false);
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(60, canvas.width / canvas.height, 0.01, 1000);

    // Minimal hand-rolled orbit (spherical coords around the origin) — avoids
    // pulling in the separate OrbitControls.js addon for one interaction.
    var radius = 5, theta = 0, phi = Math.PI / 2.2, dragging = false, lastX = 0, lastY = 0;
    function applyCam() {
      camera.position.set(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta)
      );
      camera.lookAt(0, 0, 0);
    }
    canvas.addEventListener('mousedown', function (e) { dragging = true; lastX = e.clientX; lastY = e.clientY; });
    window.addEventListener('mouseup', function () { dragging = false; });
    canvas.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      theta -= (e.clientX - lastX) * 0.01; phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi - (e.clientY - lastY) * 0.01));
      lastX = e.clientX; lastY = e.clientY; applyCam(); renderer.render(scene, camera);
    });
    canvas.addEventListener('wheel', function (e) {
      radius = Math.max(0.5, Math.min(50, radius + e.deltaY * 0.01)); applyCam(); renderer.render(scene, camera); e.preventDefault();
    }, { passive: false });

    var loader = new THREE.PLYLoader();
    loader.load(url, function (geometry) {
      geometry.computeBoundingSphere();
      var mat = new THREE.PointsMaterial({ size: 0.02, vertexColors: !!geometry.attributes.color });
      if (!geometry.attributes.color) mat.color.set(0xee3124);
      var points = new THREE.Points(geometry, mat);
      scene.add(points);
      // Frame the camera to the loaded cloud's actual scale, since a COLMAP
      // point cloud's units vary run to run (no fixed real-world scale — see
      // the module CLAUDE.md's scale-calibration note for Phase 5's answer).
      var r = (geometry.boundingSphere && geometry.boundingSphere.radius) || 1;
      radius = r * 2.5;
      applyCam(); renderer.render(scene, camera);
    }, undefined, function (err) {
      UI.toast('Could not parse the 3D file: ' + (err && err.message || err), 'error');
    });
    applyCam(); renderer.render(scene, camera);
  }

  return {
    init: init,
    _syncTools: syncTools,
    // Read by the Floor Plan pin picker (bim.js / Phase 5) — only DONE
    // requests can be pinned, since anything earlier has no result to open.
    doneList: function () { return requests.filter(function (r) { return r.status === 'done'; }).slice(); },
    // Opens the 3D viewer for a specific request id, independent of whatever
    // this screen's own `requests` cache currently holds — used by the Floor
    // Plan pin navigator, which may be the first thing to touch this module
    // in a session (its own `load()` hasn't necessarily run yet).
    openById: async function (id) {
      var r = reqById(id);
      if (!r) {
        try {
          var res = await AppAuth.getSB().from(T_REQ).select('*').eq('id', id).maybeSingle();
          r = res.data;
        } catch (e) { r = null; }
      }
      if (!r) { UI.toast('That 3D reconstruction could not be found', 'warn'); return; }
      openResultViewer(r);
    }
  };
})();
