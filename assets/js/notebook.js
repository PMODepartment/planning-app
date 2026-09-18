/* ============================================================================
 * PDNotes — the planner's own notebook, on every signed-in page.
 *
 * Owner: *"a personal notebook in the app that saves … like a sticky note that
 * doesn't close when moving through pages. Collapsible but can be opened
 * somewhere within the page."*
 *
 * ⚠️⚠️ "DOESN'T CLOSE WHEN MOVING THROUGH PAGES" IS NOT LITERALLY POSSIBLE HERE,
 * and pretending otherwise would be the wrong design. This app is 24 separate
 * documents with no shared runtime — every navigation is a full page load, so
 * nothing survives it by staying alive. What CAN be true, and is what the ask
 * actually wants, is that the drawer **comes back exactly as you left it**: open
 * or shut, on the same note, scrolled where you were. That state is per-browser
 * convenience, so it lives in localStorage; the NOTES themselves are a table,
 * because "that saves" has to mean saved.
 *
 * ⚠️ It mounts itself on any page carrying `.pd-app` — the 24 signed-in shell
 * pages — and never on login/register/pending/forgot-password, which have no
 * shell and no session.
 *
 * ⚠️ NOT a second to-do list. Tasks already exists and is fed from real
 * assignment data (champion_ids / owner_ids); a notebook that grew checkboxes
 * would start disagreeing with it about what a planner owes. This is freeform.
 * ========================================================================== */
window.PDNotes = (function () {
  'use strict';

  var TABLE = 'user_notes';
  var MIGRATION = 'migrations/2026-09-15-user-notes.sql';
  var K_OPEN = 'pd_notes_open', K_SEL = 'pd_notes_sel', K_SIDE = 'pd_notes_side', K_POS = 'pd_notes_pos';
  var SAVE_MS = 700;

  var notes = [], selId = null, loaded = false, err = null, busy = false;
  /* ⚠️⚠️ A LOAD IN FLIGHT MUST NOT CLOBBER A WRITE THAT LANDED WHILE IT WAS OUT.
     `load()` assigns `notes` WHOLESALE, so a note created (or edited, or deleted) between the
     read being issued and it coming back was silently discarded when the stale list arrived —
     measured: "+ New" succeeded, the row was in the database, and the panel still read "No notes
     yet". Every writer bumps this token; a load whose token has moved on throws its result away.
     Same device, and the same failure, as the contracts-claims load race fixed the same day. */
  var loadGen = 0;
  function invalidateLoad() { loadGen++; }
  var root = null, saveTimer = null, dirty = null;

  function sb() { return (window.AppAuth && AppAuth.getSB) ? AppAuth.getSB() : null; }
  function esc(s) { return (window.Fmt && Fmt.esc) ? Fmt.esc(s == null ? '' : s) : String(s == null ? '' : s); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* The title is the first non-empty line, trimmed. ⚠️ Derived on WRITE and
     stored, never asked for — a notebook that demands a title before you can
     type is a form, and people stop using it. */
  function titleOf(body) {
    var first = String(body == null ? '' : body).split('\n').find(function (l) { return l.trim(); });
    first = (first || '').trim();
    return first.length > 80 ? first.slice(0, 79) + '…' : first;
  }
  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return '';
    var days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (days === 1) return 'yesterday';
    if (days < 7) return days + ' days ago';
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }
  /* The project the planner was looking at, for the optional tag. Read from the
     same sessionStorage key every module uses — never invented here. */
  function curProject() { try { return sessionStorage.getItem('pd_project') || null; } catch (e) { return null; } }

  // ---- data ----------------------------------------------------------------
  async function load() {
    var gen = ++loadGen;
    err = null;
    var c = sb(); if (!c) { err = 'not signed in'; return; }
    var fetched = [];
    try {
      /* ⚠️ No `.eq('created_by', …)` — the RLS policy IS the filter, and adding a
         client-side one would silently mask a policy that had stopped working.
         ⚠️ PDb.selectAll, never a bare select: the 1000-row cap is server-side
         and silent, and a notebook that quietly stopped showing older notes
         would look like data loss. */
      if (window.PDb && PDb.selectAll) {
        fetched = await PDb.selectAll(TABLE, function (q) { return q.order('updated_at', { ascending: false }); });
      } else {
        var r = await c.from(TABLE).select('*').order('updated_at', { ascending: false });
        if (r.error) throw r.error;
        fetched = r.data || [];
      }
      if (gen !== loadGen) return;   // a write landed while this read was out — keep theirs
      notes = fetched;
      loaded = true;
    } catch (e) {
      if (gen !== loadGen) return;
      notes = []; loaded = true;
      err = (e && e.message) || String(e);
    }
  }

  async function create() {
    var c = sb(); if (!c) return null;
    /* ⚠️ `created_by` is NOT sent — the column defaults to auth.uid(). Writing a
       note onto another account is therefore not something this client can
       express, rather than something it is trusted not to do. */
    var row = { body: '', title: '', project_id: curProject() };
    try {
      var r = await c.from(TABLE).insert(row).select().single();
      if (r.error) throw r.error;
      /* ⚠️⚠️ CLEAR THE STALE READ ERROR. `err` was set once by a failed `load()` and never
         cleared, so `listHTML` kept rendering the failure FOREVER — a note created afterwards
         went into `notes` and could not be seen, which is exactly "+ New does nothing". */
      err = null; loaded = true;
      invalidateLoad();
      notes.unshift(r.data);
      return r.data;
    } catch (e) {
      toastErr(e);
      return null;
    }
  }

  /* ⚠️⚠️ FLUSH BEFORE ANYTHING THAT CHANGES WHAT IS ON SCREEN. The editor is
     debounced, so switching note, deleting, or closing the drawer with an
     unsaved keystroke in flight would drop it. Every one of those paths awaits
     this first. */
  async function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!dirty) return;
    var d = dirty; dirty = null;
    var c = sb(); if (!c) return;
    var patch = { body: d.body, title: titleOf(d.body), updated_at: new Date().toISOString() };
    var n = notes.find(function (x) { return x.id === d.id; });
    if (n) { n.body = patch.body; n.title = patch.title; n.updated_at = patch.updated_at; }
    try {
      var r = await c.from(TABLE).update(patch).eq('id', d.id).select('id');
      if (r.error) throw r.error;
      /* ⚠️ A PostgREST update filtered away by RLS answers 200 WITH ZERO ROWS.
         Reporting "saved" over a write that changed nothing is the silent
         success this repo has recorded since boq_tag_activities. */
      if (!r.data || !r.data.length) throw new Error('the note was not saved — it may belong to another account');
      invalidateLoad();
      setStatus('Saved');
    } catch (e) { toastErr(e); setStatus('Not saved'); }
  }

  async function remove(id) {
    var n = notes.find(function (x) { return x.id === id; });
    var label = (n && n.title) ? '“' + n.title + '”' : 'this note';
    if (!confirm('Delete ' + label + '? This cannot be undone.')) return;
    await flush();
    var c = sb(); if (!c) return;
    try {
      var r = await c.from(TABLE).delete().eq('id', id).select('id');
      if (r.error) throw r.error;
      invalidateLoad();
      notes = notes.filter(function (x) { return x.id !== id; });
      if (selId === id) selId = notes.length ? notes[0].id : null;
      paint();
    } catch (e) { toastErr(e); }
  }

  function toastErr(e) {
    var m = (e && e.message) || String(e);
    if (/relation|does not exist|schema cache|PGRST205/i.test(m)) {
      m = 'The notebook table is missing — run ' + MIGRATION + ' in the Supabase SQL editor.';
    }
    if (window.UI && UI.toast) UI.toast(m, 'error');
  }
  function setStatus(t) {
    var el = root && root.querySelector('.pd-nb-status');
    if (el) el.textContent = t || '';
  }

  // ---- render --------------------------------------------------------------
  function isOpen() { return lsGet(K_OPEN) === '1'; }

  /* The note LIST inside the drawer folds away, independently of the drawer itself.
     Owner: *"I want the side panel within the notebook to be collapsible as well."*

     ⚠️ TWO SEPARATE STATES, TWO SEPARATE KEYS, deliberately. Folding the list is "give the
     writing more room", and shutting the drawer is "I am done" — a planner who writes with the
     list folded must not have it spring back every time they reopen the notebook, and a single
     key would make one gesture undo the other.
     ⚠️⚠️ AND THE HEAD HAS TO NAME THE CURRENT NOTE ONCE THE LIST IS GONE. The list was the only
     thing on screen saying WHICH note is being typed into; folding it without replacing that is
     how somebody writes a paragraph into yesterday's note. `.pd-nb-cur` carries it. */
  /* ======================================================================================
     DRAGGING THE NOTES BUTTON — owner: *"I want the notes/notebook button to be movable by
     drag. Movable anywhere in the page as the user desires."*

     The FAB drags the WHOLE `.pd-nb` root, panel included: the panel is anchored to the button
     and detaching them would leave an open note floating with no handle.

     ⚠⚠ THE HARD PART IS NOT THE DRAG, IT IS WHERE THE PANEL OPENS AFTERWARDS. The default
     corner is bottom-right and the stylesheet opens the panel UPWARDS, RIGHT-ALIGNED to suit
     it. Drag the button to the top of the window and the panel opens off the top of the screen;
     drag it to the left edge and 380px of panel hangs off the left. So placement decides two
     flips, and the drag re-decides them as it moves:
       · `pd-nb-below`  — button in the top half → the panel opens DOWNWARDS
       · `pd-nb-atleft` — button in the left half → the panel extends RIGHT

     ⚠⚠ EVERYTHING IS EXPRESSED AS THE BUTTON'S POSITION, AND THE ROOT IS PLACED TO SUIT IT.
     The root's top-left is NOT the button's: with the panel open above it, the root starts ~520px
     higher. Positioning the root directly meant the button jumped out from under the cursor the
     moment the notebook was open, and clamping on the root's box refused to let the button near
     the bottom of the screen — the corner it lives in by default.

     ⚠ STORED AS A FRACTION OF THE VIEWPORT, not pixels: a position saved on a 2560px monitor
     and restored on a laptop would put the button off screen, and the only control that opens
     the notebook would be unreachable with no way back. Re-clamped on restore and on resize. */
  function nbFabBox() {
    var fab = root && root.querySelector('.pd-nb-fab');
    return fab ? fab.getBoundingClientRect() : null;
  }
  /* Place the BUTTON's top-left at (x, y), clamped to the viewport. Two passes on purpose: the
     flip classes change the root's layout, which moves the button INSIDE the root, so the
     button's offset has to be re-read after they are applied or the first drag into the top
     half lands ~520px off. */
  /* ⚠ Below 700px the stylesheet lays the notebook out full-width (`left:12px; right:12px;
     align-items:stretch`) and the button is not a floating target any more. Writing left/top
     into that would break a layout the owner never asked to change, so a phone keeps its
     corner — the stored position is remembered and reapplied when the window grows again. */
  function nbFloating() { return window.innerWidth > 700; }
  function nbPlace(x, y, save) {
    if (!root || !nbFloating()) return;
    var fr = nbFabBox(); if (!fr) return;
    var fw = fr.width, fh = fr.height;
    x = Math.max(4, Math.min(window.innerWidth - fw - 4, x));
    y = Math.max(4, Math.min(window.innerHeight - fh - 4, y));
    root.classList.add('pd-nb-moved');
    /* ⚠⚠ THE FLIP IS DECIDED BY WHICH SIDE HAS MORE ROOM, NOT BY WHICH HALF OF THE SCREEN THE
       BUTTON IS IN. “Top half → open downwards” was the first cut and it is wrong in the middle:
       measured at the centre of a 1006×910 window, the button sat at y=455, the half-test said
       “not the top half”, the panel opened upwards and its top landed at **-73px** — off screen.
       ⚠ At the centre NEITHER side fits a 520px panel (447 above, 417 below), so choosing a side
       is not enough: the panel is also CAPPED to the room on the side chosen, via `--pd-nb-room`.
       It shrinks rather than clipping, which is the honest failure and the reversible one — drag
       the button back to a corner and it is 520px again.
       ⚠ The 8 is the flex `gap` between the panel and the button, and 160 is a floor so the
       editor never collapses to a sliver no one can type in. */
    var GAP = 8;
    var roomAbove = y - GAP, roomBelow = window.innerHeight - (y + fh) - GAP;
    var below = roomBelow > roomAbove;
    root.style.setProperty('--pd-nb-room', Math.max(160, below ? roomBelow : roomAbove) + 'px');
    root.classList.toggle('pd-nb-below', below);
    root.classList.toggle('pd-nb-atleft', (x + fw / 2) < window.innerWidth / 2);
    // pass two: with the flips applied, work out where the root must sit for the button to land
    var rr = root.getBoundingClientRect(), fr2 = nbFabBox();
    root.style.left = (x - (fr2.left - rr.left)) + 'px';
    root.style.top = (y - (fr2.top - rr.top)) + 'px';
    root.style.right = 'auto';
    root.style.bottom = 'auto';
    if (save) lsSet(K_POS, (x / Math.max(1, window.innerWidth)) + ',' + (y / Math.max(1, window.innerHeight)));
  }
  function nbRestore() {
    var v = lsGet(K_POS); if (!v) return;          // never moved: the stylesheet's corner stands
    var a = String(v).split(','), fx = parseFloat(a[0]), fy = parseFloat(a[1]);
    if (!isFinite(fx) || !isFinite(fy)) return;
    nbPlace(fx * window.innerWidth, fy * window.innerHeight, false);
  }
  function nbReclamp() {
    if (!root || !root.classList.contains('pd-nb-moved')) return;
    /* ⚠ Crossing DOWN through the breakpoint must strip the inline left/top, or the phone
       layout inherits a desktop position and the notebook ends up half off the screen with no
       way to drag it back. The class and the stored fraction survive, so growing the window
       restores the position rather than forgetting it. */
    if (!nbFloating()) {
      root.style.left = ''; root.style.top = ''; root.style.right = ''; root.style.bottom = '';
      root.style.removeProperty('--pd-nb-room');
      root.classList.remove('pd-nb-below', 'pd-nb-atleft');
      return;
    }
    /* Grown back above the breakpoint with the inline position stripped: re-read the stored
       fraction rather than the button's current (corner) box, or the move is silently lost. */
    if (!root.style.left) { nbRestore(); return; }
    var fr = nbFabBox(); if (!fr) return;
    nbPlace(fr.left, fr.top, false);               // same spot, re-clamped to the new viewport
  }
  function nbDrag(fab) {
    var gx = 0, gy = 0, moved = false, on = false, sx = 0, sy = 0;
    fab.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button !== 0) return;   // right-click keeps the browser's menu
      var fr = fab.getBoundingClientRect();
      gx = e.clientX - fr.left; gy = e.clientY - fr.top;
      sx = e.clientX; sy = e.clientY; moved = false; on = true;
      try { fab.setPointerCapture(e.pointerId); } catch (err) {}
    });
    fab.addEventListener('pointermove', function (e) {
      if (!on) return;
      /* ⚠⚠ THE 4px THRESHOLD IS WHAT KEEPS THE BUTTON CLICKABLE. Without it every click is a
         one-pixel drag, the click is then suppressed below, and the notebook can never be opened
         again — the feature would have eaten the only control it was attached to. */
      if (!moved && Math.abs(e.clientX - sx) < 4 && Math.abs(e.clientY - sy) < 4) return;
      if (!moved) { moved = true; root.classList.add('pd-nb-dragging'); }
      e.preventDefault();
      nbPlace(e.clientX - gx, e.clientY - gy, false);
    });
    function end(e) {
      if (!on) return;
      on = false;
      root.classList.remove('pd-nb-dragging');
      try { fab.releasePointerCapture(e.pointerId); } catch (err) {}
      if (moved) { var fr = fab.getBoundingClientRect(); nbPlace(fr.left, fr.top, true); }
    }
    fab.addEventListener('pointerup', end);
    fab.addEventListener('pointercancel', end);
    /* ⚠ The click is swallowed only when the pointer actually travelled. `moved` is reset on the
       next pointerdown, so this never suppresses a later, genuine click. */
    fab.addEventListener('click', function (e) {
      if (!moved) return;
      e.preventDefault(); e.stopImmediatePropagation();
    }, true);
  }
  function sideHidden() { return lsGet(K_SIDE) === '1'; }
  function setSideHidden(v) { lsSet(K_SIDE, v ? '1' : '0'); paint(); }

  /* ⚠️⚠️ "THE TABLE IS NOT THERE" AND "THE READ FAILED" ARE DIFFERENT PROBLEMS WITH
     DIFFERENT OWNERS, and the first cut said the same vague thing for both. A planner whose
     migration has not been run needs the FILENAME and nothing else; the generic
     "Could not read your notes" sent them looking for a bug instead. This is the state the
     notebook is in on every deployment until `2026-09-15-user-notes.sql` has been run — which
     is to say, the most likely thing anyone sees first. */
  function isMissingTable(m) {
    return /relation|does not exist|schema cache|PGRST205|PGRST20[0-9]/i.test(String(m || ''));
  }
  function listHTML() {
    if (err && isMissingTable(err)) {
      return '<p class="pd-nb-msg"><b>The notebook is not set up yet.</b><br>' +
        '<span class="pd-nb-mut">Run <code>' + esc(MIGRATION) + '</code> in the Supabase SQL ' +
        'editor, then reload this page. Nothing is lost — there is nothing stored yet.</span></p>';
    }
    if (err) {
      return '<p class="pd-nb-msg">Could not read your notes.<br><span class="pd-nb-mut">' + esc(err) +
        '</span><br><button type="button" class="pd-btn pd-btn-sm pd-nb-retry">Try again</button></p>';
    }
    if (!notes.length) {
      return '<p class="pd-nb-msg">No notes yet.<br><span class="pd-nb-mut">' +
        'Anything you write here is private to you and follows you between pages.</span></p>';
    }
    return '<ul class="pd-nb-list">' + notes.map(function (n) {
      return '<li class="pd-nb-item' + (n.id === selId ? ' on' : '') + '" data-id="' + esc(n.id) + '">' +
        '<span class="pd-nb-t">' + (n.title ? esc(n.title) : '<i>Untitled</i>') + '</span>' +
        '<span class="pd-nb-when">' + esc(when(n.updated_at)) + '</span></li>';
    }).join('') + '</ul>';
  }

  function paint() {
    if (!root) return;
    var open = isOpen();
    root.classList.toggle('open', open);
    var fab = root.querySelector('.pd-nb-fab');
    if (fab) fab.setAttribute('aria-expanded', open ? 'true' : 'false');
    var panel = root.querySelector('.pd-nb-panel');
    if (panel) panel.hidden = !open;

    var sideOff = sideHidden();
    root.classList.toggle('sidehid', sideOff);
    var st = root.querySelector('.pd-nb-sidet');
    if (st) {
      st.setAttribute('aria-expanded', sideOff ? 'false' : 'true');
      st.title = sideOff ? 'Show the note list' : 'Hide the note list';
      st.firstChild.textContent = sideOff ? '›' : '‹';
    }
    if (!open) return;

    var cur = notes.find(function (n) { return n.id === selId; }) || null;
    /* ⚠️ Only while the list is folded. With the list on screen it already names every note and
       marks the current one, so printing the title twice would just crowd the head. */
    var curEl = root.querySelector('.pd-nb-cur');
    if (curEl) curEl.textContent = (sideOff && cur) ? (cur.title || 'Untitled') : '';
    root.querySelector('.pd-nb-side').innerHTML = listHTML();
    var ed = root.querySelector('.pd-nb-ed');
    /* ⚠️ The textarea is only rebuilt when the NOTE changes, never on every
       paint — replacing it under the cursor would drop the caret mid-sentence
       and lose the selection. Same rule the BOQ grid arrived at. */
    if (ed.dataset.id !== String(cur ? cur.id : '')) {
      ed.dataset.id = String(cur ? cur.id : '');
      ed.value = cur ? (cur.body || '') : '';
    }
    ed.disabled = !cur;
    /* ⚠️ The empty-state instruction has to match what is actually on screen. With the list folded
       there is nothing to "select", and telling somebody to pick from a list they cannot see is
       the kind of advice that reads as a broken screen. */
    ed.placeholder = cur ? 'Write anything…'
      : (sideOff ? 'No note open — press › to show the list, or + New.'
                 : 'Select a note, or press + to start one.');
    var del = root.querySelector('.pd-nb-del');
    if (del) del.disabled = !cur;
    wireList();
  }

  function wireList() {
    var retry = root.querySelector('.pd-nb-retry');
    if (retry) retry.onclick = function () { loaded = false; err = null; open(); };
    root.querySelectorAll('.pd-nb-item').forEach(function (li) {
      li.onclick = async function () {
        if (li.dataset.id === String(selId)) return;
        await flush();
        selId = li.dataset.id;
        lsSet(K_SEL, selId);
        setStatus('');
        paint();
      };
    });
  }

  async function open() {
    lsSet(K_OPEN, '1');
    paint();                       // show the shell immediately
    /* ⚠️ Retry when the last attempt ERRORED, not only when nothing has loaded — otherwise
       running the migration while the page is open leaves the notebook broken until a reload,
       and the planner has no way to know a reload is what it needs. */
    if ((!loaded || err) && !busy) {
      busy = true;
      setStatus('Loading…');
      await load();
      busy = false;
      if (!selId || !notes.some(function (n) { return n.id === selId; })) {
        var remembered = lsGet(K_SEL);
        selId = (remembered && notes.some(function (n) { return n.id === remembered; }))
          ? remembered : (notes.length ? notes[0].id : null);
      }
      setStatus('');
      paint();
    }
  }
  async function close() {
    await flush();                 // an unsaved keystroke must not die with the panel
    lsSet(K_OPEN, '0');
    paint();
  }

  function build() {
    if (document.getElementById('pd-notes')) return;
    root = document.createElement('div');
    root.id = 'pd-notes';
    root.className = 'pd-nb';
    root.innerHTML =
      '<div class="pd-nb-panel" hidden>' +
        '<div class="pd-nb-head">' +
          /* ⚠️ A real <button>, first in the head, so the fold is reachable by keyboard and is
             never hidden by the thing it folds — a control that disappears with the panel it
             collapses is one nobody can undo. */
          '<button type="button" class="pd-nb-sidet" aria-expanded="true" title="Hide the note list">' +
            '<span aria-hidden="true">‹</span></button>' +
          '<b>Notebook</b>' +
          '<span class="pd-nb-cur"></span>' +
          '<span class="pd-nb-status" aria-live="polite"></span>' +
          '<button type="button" class="pd-btn pd-btn-sm pd-nb-new" title="New note">+ New</button>' +
          /* ⚠️ NO × BUTTON. Owner 2026-09-15: *"remove the close button since the notebook can
             be opened and closed via [the Notes button] already which will make it redundant."*
             Right — the FAB is a toggle, and a second control doing the same thing in the same
             corner is one more thing to read. Escape still closes it from the keyboard. */
          '<button type="button" class="pd-btn pd-btn-sm pd-nb-del" title="Delete this note">Delete</button>' +
        '</div>' +
        '<div class="pd-nb-body">' +
          '<div class="pd-nb-side"></div>' +
          '<textarea class="pd-nb-ed" spellcheck="true"></textarea>' +
        '</div>' +
        '<p class="pd-nb-foot">Private to you. Saves as you type.</p>' +
      '</div>' +
      '<button type="button" class="pd-nb-fab" aria-expanded="false" aria-controls="pd-notes" title="Notebook — click to open, drag to move it">' +
        '<span class="pd-nb-fab-ico" aria-hidden="true">✎</span><span class="pd-nb-fab-txt">Notes</span>' +
      '</button>';
    document.body.appendChild(root);

    var _fab = root.querySelector('.pd-nb-fab');
    _fab.onclick = function () { isOpen() ? close() : open(); };
    /* ⚠ `nbDrag` binds in the CAPTURE phase for click, so it must be installed before anything
       downstream can act on a click that was really the end of a drag. */
    nbDrag(_fab);
    nbRestore();
    /* ⚠ A window the user shrinks must not strand the button off screen — the same reason the
       stored position is a fraction rather than a pixel count. */
    window.addEventListener('resize', nbReclamp);
    root.querySelector('.pd-nb-sidet').onclick = function () { setSideHidden(!sideHidden()); };
    root.querySelector('.pd-nb-new').onclick = async function () {
      await flush();
      var n = await create();
      if (!n) return;
      selId = n.id; lsSet(K_SEL, selId);
      paint();
      var ed = root.querySelector('.pd-nb-ed'); if (ed) ed.focus();
    };
    root.querySelector('.pd-nb-del').onclick = function () { if (selId) remove(selId); };

    var ed = root.querySelector('.pd-nb-ed');
    ed.addEventListener('input', function () {
      if (!selId) return;
      dirty = { id: selId, body: ed.value };
      setStatus('Saving…');
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { flush(); }, SAVE_MS);
      /* Keep the list's title live without rebuilding the textarea. */
      var n = notes.find(function (x) { return x.id === selId; });
      if (n) {
        n.title = titleOf(ed.value);
        var li = root.querySelector('.pd-nb-item[data-id="' + selId + '"] .pd-nb-t');
        if (li) li.innerHTML = n.title ? esc(n.title) : '<i>Untitled</i>';
      }
    });
    /* ⚠️ Escape closes, but ONLY from inside the panel — a global Escape handler
       would fight every modal in the app for the same key. */
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); close(); }
    });
    /* ⚠️⚠️ The last chance to save. A debounced write in flight when the tab is
       closed or navigated away is simply lost otherwise, and `pagehide` fires in
       cases `beforeunload` does not (bfcache, mobile Safari). Synchronous-ish:
       the write is fired, not awaited — the browser gives no guarantee here, so
       this is a best effort on top of the 700ms debounce, not instead of it. */
    window.addEventListener('pagehide', function () { flush(); });

    paint();
    if (isOpen()) open();          // restore the state the planner left it in
  }

  function mount() {
    /* ⚠️ Shell pages only. `.pd-app` is what login/register/pending/forgot-password
       do not have, and they have no session either — a notebook there would be a
       control that can only fail. */
    if (!document.querySelector('.pd-app')) return;
    build();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  return {
    mount: mount, open: open, close: close,
    _internals: { titleOf: titleOf, when: when, listHTML: listHTML,
      sideHidden: sideHidden, setSideHidden: setSideHidden,
      _set: function (o) {
        if (o.notes) { notes = o.notes; loaded = true; }
        if ('selId' in o) selId = o.selId;
        if ('err' in o) err = o.err;
      } }
  };
})();
