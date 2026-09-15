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
  var K_OPEN = 'pd_notes_open', K_SEL = 'pd_notes_sel';
  var SAVE_MS = 700;

  var notes = [], selId = null, loaded = false, err = null, busy = false;
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
    err = null;
    var c = sb(); if (!c) { err = 'not signed in'; return; }
    try {
      /* ⚠️ No `.eq('created_by', …)` — the RLS policy IS the filter, and adding a
         client-side one would silently mask a policy that had stopped working.
         ⚠️ PDb.selectAll, never a bare select: the 1000-row cap is server-side
         and silent, and a notebook that quietly stopped showing older notes
         would look like data loss. */
      if (window.PDb && PDb.selectAll) {
        notes = await PDb.selectAll(TABLE, function (q) { return q.order('updated_at', { ascending: false }); });
      } else {
        var r = await c.from(TABLE).select('*').order('updated_at', { ascending: false });
        if (r.error) throw r.error;
        notes = r.data || [];
      }
      loaded = true;
    } catch (e) {
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

  function listHTML() {
    if (err) {
      return '<p class="pd-nb-msg">Could not read your notes.<br><span class="pd-nb-mut">' + esc(err) + '</span></p>';
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
    if (!open) return;

    var cur = notes.find(function (n) { return n.id === selId; }) || null;
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
    ed.placeholder = cur ? 'Write anything…' : 'Select a note, or press + to start one.';
    var del = root.querySelector('.pd-nb-del');
    if (del) del.disabled = !cur;
    wireList();
  }

  function wireList() {
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
    if (!loaded && !busy) {
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
          '<b>Notebook</b>' +
          '<span class="pd-nb-status" aria-live="polite"></span>' +
          '<button type="button" class="pd-btn pd-btn-sm pd-nb-new" title="New note">+ New</button>' +
          '<button type="button" class="pd-btn pd-btn-sm pd-nb-del" title="Delete this note">Delete</button>' +
          '<button type="button" class="pd-btn pd-btn-sm pd-nb-x" title="Close" aria-label="Close notebook">&times;</button>' +
        '</div>' +
        '<div class="pd-nb-body">' +
          '<div class="pd-nb-side"></div>' +
          '<textarea class="pd-nb-ed" spellcheck="true"></textarea>' +
        '</div>' +
        '<p class="pd-nb-foot">Private to you. Saves as you type.</p>' +
      '</div>' +
      '<button type="button" class="pd-nb-fab" aria-expanded="false" aria-controls="pd-notes" title="Notebook">' +
        '<span class="pd-nb-fab-ico" aria-hidden="true">✎</span><span class="pd-nb-fab-txt">Notes</span>' +
      '</button>';
    document.body.appendChild(root);

    root.querySelector('.pd-nb-fab').onclick = function () { isOpen() ? close() : open(); };
    root.querySelector('.pd-nb-x').onclick = function () { close(); };
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
      _set: function (o) {
        if (o.notes) { notes = o.notes; loaded = true; }
        if ('selId' in o) selId = o.selId;
        if ('err' in o) err = o.err;
      } }
  };
})();
