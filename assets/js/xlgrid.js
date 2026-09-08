/* ==========================================================================
   PDGrid — spreadsheet keys for a table that is ALREADY rendered
   --------------------------------------------------------------------------
   Owner, 2026-09-07: *"let's develop the excel grid, let's develop it in a way that would
   benefit more modules / make it easier for planners to connect it to the activities as basis
   for cost loading, productivity rates etc."*

   ⚠️⚠️ THIS ATTACHES TO A TABLE; IT DOES NOT RENDER ONE. That is the whole design, and it is
   the opposite of how WPM's review.html grid works (~517 lines of JS + 148 CSS rules that own
   their markup end to end). Porting that here would have meant rewriting each module's table
   and then maintaining a second copy of a big grid engine that drifts from the original.

   Instead: a module keeps rendering its own <table> exactly as it does today, and PDGrid adds
   the keyboard, selection and clipboard behaviour on top. The only contract is two attributes
   the BOQ table already had before this file existed:

       <input class="…" data-i="<row id>" data-f="<field name>" />

   So adopting it in Productivity Rates or a cost-loading grid is: give the inputs `data-i` and
   `data-f`, call PDGrid.attach, and supply a save function. No markup rewrite, no new render
   path, and every module keeps its own columns, formatting and validation.

   ⚠️ EDITING IS FREE BECAUSE THE CELLS ARE REAL INPUTS. WPM's grid renders <td>s and has to
   build an editor on demand (_xlBeginEdit, F2, type-to-edit, commit/cancel). Here the cell IS
   the editor, so "move to a cell" is just `.focus()`. That removes an entire class of state —
   there is no "am I editing?" flag to get wrong, and a half-typed value can never be lost by a
   re-render that happens to land mid-edit.

   ⚠️ LEFT/RIGHT DELIBERATELY DO NOT CHANGE CELLS. In a grid of real inputs the caret has to be
   movable, and a planner correcting the middle of "1,250.00" expects Left to move one character,
   not to jump columns. Tab does columns; Up/Down/Enter do rows. This is the one place where
   copying Excel exactly would fight the medium.

   API
   ---
     var g = PDGrid.attach({
       root:  element,                    // container holding the table
       cell:  '.boq-cell',                // selector for the editable inputs inside it
       onSet: function (rowId, field, value) { … },   // persist ONE cell; may return a Promise
       onBatch: function (changes) { … }   // optional: [{id, field, value}] applied at once
     });
     g.detach();

   Keys
   ----
     Up / Down / Enter      move a row within the column
     Tab / Shift+Tab        move a column, wrapping to the next row
     Shift+Up / Shift+Down  extend a selection down the column
     Ctrl+D                 fill the selection from its top cell   (the big one for pricing)
     Ctrl+Z                 undo the last grid-applied batch
     Delete                 clear the selection
     Ctrl+C                 copy the selection as TSV
     Ctrl+V / paste         paste a TSV block, spilling right and down from the focused cell
   ========================================================================== */
window.PDGrid = (function () {
  'use strict';

  var CSS_ID = 'pdgrid-css';
  /* Injected here rather than added to each module's stylesheet, the same way collab.js does it:
     a module adopts PDGrid by calling attach(), with no CSS edit and no <link> to remember. */
  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    /* ⚠️⚠️ THIS IS WPM review.html's GRID SKIN, PORTED — not a new table design. Owner,
       2026-09-07: *"we can just follow the all work packages grid design than recreate a new
       table UI design"*, and then *"still doesn't follow the review.html grid UI"* when only the
       KEYS had been ported. The look is half the point: a spreadsheet reads as a lattice of tight
       cells, and the module's card-table styling (roomy padding, a rounded bordered input inside
       every cell) reads as a form. Same rules as the original, expressed against this app's
       tokens rather than WPM's.
       ⚠️ THE RANGE HIGHLIGHT IS A box-shadow OVERLAY, NOT A background — copied deliberately,
       including the reason. review.html's own comment records the bug: as a background it lost a
       specificity fight with the zebra stripe and the row-hover tint, so dragging a range showed
       the highlight only on the last cell touched. An inset shadow paints over whatever the cell's
       own background happens to be. */
    s.textContent =
      /* ⚠️⚠️ ONE FONT SIZE FOR EVERY CELL, and this is the single biggest difference between this
         grid and review.html's. Owner, comparing them: *"it seems that the fonts are different for
         all of the texts in the page"*. Measured on a BOQ row before this: SIX sizes plus a weight
         change — .cc-table td 13px, .boq-cell 12.5px, .boq-cellsel 11.5px, .boq-no 11.5px mono,
         .boq-code 11.5px mono, .cc-mini 11px, and font-weight 600 on the description. review.html
         sets one size on `table.xl td` and lets everything inherit; a spreadsheet reads as a
         spreadsheet because every cell is typographically identical, and the eye scans a column
         instead of stumbling over six treatments.
         ⚠️ Monospace SURVIVES on the code columns — that is an alignment device for
         fixed-width identifiers, not decoration — but at the same size as everything else. */
      '.pdg-grid td,.pdg-grid td input,.pdg-grid td select,.pdg-grid td .cc-desc-txt,' +
        '.pdg-grid td .boq-code,.pdg-grid td .boq-no,.pdg-grid td .boq-kind' +
        '{font-size:12px;font-weight:400;line-height:1.35}' +
      /* ⚠️ `var(--pd-mono, …)` WITH THE FULL STACK AS THE FALLBACK. This sheet is injected into
         <head> at runtime, so it lands AFTER a module's own stylesheet and wins on equal
         specificity — meaning a divergent stack written here silently overrides the module's
         token and undoes the fix. The fallback matters too: a module adopting PDGrid may not
         define --pd-mono, and it must still get a stack containing a Windows face rather than
         falling through to the generic default (Courier New). */
      '.pdg-grid td .boq-code,.pdg-grid td .boq-no{font-family:var(--pd-mono,ui-monospace,' +
        'SFMono-Regular,"SF Mono",Consolas,"Liberation Mono",Menlo,monospace)}' +
      /* ⚠️ The sheet/row sub-line is REMOVED FROM THE GRID, not merely shrunk. It was the second
         line of every description cell, which is what made the rows tall and uneven, and a second
         size the moment it differed from the first. review.html has no such line. The text moves
         to the cell's tooltip (see boq.js), so nothing is lost and every row is one line high. */
      '.pdg-grid td .cc-mini{display:none}' +
      '.pdg-grid td .cc-desc-txt{-webkit-line-clamp:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      /* the lattice */
      '.pdg-grid{border-collapse:separate;border-spacing:0;width:100%}' +
      '.pdg-grid td,.pdg-grid th{border-right:1px solid var(--pd-line,#333);' +
        'border-bottom:1px solid var(--pd-line,#333)}' +
      '.pdg-grid td{padding:3px 5px;cursor:cell;vertical-align:middle}' +
      /* the header band: sticky, small, uppercase, sealed with a firmer bottom border */
      '.pdg-grid thead th{position:sticky;top:0;z-index:6;background:var(--pd-card,#222);' +
        'font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;' +
        'padding:5px 6px;height:32px;vertical-align:middle;white-space:nowrap;' +
        'border-bottom:2px solid var(--pd-line,#333)}' +
      /* zebra, strengthened: this table is wide and dense, a row must read while scrolling */
      '.pdg-grid tbody tr:nth-child(even) td{background:rgba(128,128,128,.055)}' +
      '.pdg-grid tbody tr:hover td{background:rgba(238,49,36,.07)}' +
      /* numerics line up only with tabular figures */
      '.pdg-grid .pdg-num,.pdg-grid td.cc-r{text-align:right;font-variant-numeric:tabular-nums}' +
      '.pdg-grid .boq-cell{font-variant-numeric:tabular-nums}' +
      /* ⚠️ The cell IS the input here, so the input must stop looking like a control: no radius,
         no resting border of its own, filling the td so the lattice comes from the table. */
      '.pdg-grid .boq-cell,.pdg-grid .boq-cellsel{border-radius:0;border-color:transparent;' +
        'background:transparent;width:100%;padding:2px 3px}' +
      '.pdg-grid .boq-cell:hover,.pdg-grid .boq-cellsel:hover{background:rgba(128,128,128,.10)}' +
      /* ⚠️ Overrides .boq-fillable's resting tint INSIDE a grid. Both are (0,2,0) so source order
         decides, and this stylesheet is injected into <head> after module.css loads. The fillable
         affordance was right when each cell was an island; with a full lattice the borders already
         say "this is a cell", and the tint on top of them read as 4,000 boxes. */
      '.pdg-grid.boq-fillable .boq-cell,.pdg-grid.boq-fillable .boq-cellsel' +
        '{background:transparent;border-color:transparent}' +
      /* ⚠️⚠️ THE SELECTION RING IS ON THE CELL, NOT THE INPUT. Owner: *"the select pane is not
         proper as well compared to the review.html build"*. The input sits inset inside its td, so
         an outline on the input drew a box with a visible gap all round it — review.html outlines
         the <td> itself, so the ring is the cell. `:focus-within` puts it back where it belongs and
         the input's own outline is suppressed. The little square bottom-right is review.html's fill
         handle, kept as a visual cue that a cell is the anchor of a range. */
      '.pdg-grid td:focus-within{outline:2px solid var(--pd-red,#EE3124);outline-offset:-2px;' +
        'position:relative;z-index:4}' +
      '.pdg-grid td:focus-within::after{content:"";position:absolute;right:-3px;bottom:-3px;' +
        'width:6px;height:6px;background:var(--pd-red,#EE3124);border:1px solid var(--pd-card,#222)}' +
      '.pdg-grid .boq-cell:focus{outline:none;background:transparent;border-color:transparent}' +
      /* group / heading rows: red top rule and an uppercase label, as in the original */
      '.pdg-grid tbody tr.boq-head td{background:rgba(238,49,36,.09)!important;' +
        'border-top:2px solid var(--pd-red,#EE3124);font-weight:700}' +
      /* selection */
      '.pdg-sel{box-shadow:inset 0 0 0 9999px rgba(238,49,36,.22);position:relative;z-index:2}' +
      '.pdg-anchor{outline:2px solid var(--pd-red,#EE3124);outline-offset:-2px;position:relative;z-index:3}' +
      /* ---- ported furniture: resize grip, freeze pin, set-all, fill handle, required ---- */
      /* WARNING The grip sits INSIDE the th and is only visible on hover, so 13 permanent grab
         bars do not compete with the column labels. Full height so the target is easy to hit. */
      '.pdg-grid thead th.pdg-th{position:relative;padding-right:34px}' +
      '.pdg-rz{position:absolute;top:0;right:0;width:6px;height:100%;cursor:col-resize;' +
        'opacity:0;background:var(--pd-red,#EE3124)}' +
      '.pdg-grid thead th:hover .pdg-rz{opacity:.45}' +
      '.pdg-rz:hover{opacity:1!important}' +
      '.pdg-pin,.pdg-setall{position:absolute;top:50%;transform:translateY(-50%);border:0;' +
        'background:none;color:var(--pd-muted,#8a8a8a);cursor:pointer;font-size:11px;line-height:1;' +
        'padding:0 2px;opacity:0}' +
      '.pdg-pin{right:14px}.pdg-setall{right:24px}' +
      '.pdg-grid thead th:hover .pdg-pin,.pdg-grid thead th:hover .pdg-setall{opacity:.55}' +
      '.pdg-pin:hover,.pdg-setall:hover{opacity:1!important;color:var(--pd-red,#EE3124)}' +
      '.pdg-pin.on{opacity:.9;color:var(--pd-red,#EE3124)}' +
      /* WARNING A frozen cell needs its own background or the scrolling columns show through it,
         and a z-index above the body but below the sticky header. The edge rule is what tells the
         eye where the frozen block ends. */
      '.pdg-grid td.pdg-frozen,.pdg-grid th.pdg-frozen{position:sticky;z-index:4;' +
        'background:var(--pd-card,#222)}' +
      '.pdg-grid thead th.pdg-frozen{z-index:7}' +
      '.pdg-grid .pdg-frozen-edge{border-right:2px solid var(--pd-red,#EE3124)}' +
      '.pdg-fill{position:absolute;width:8px;height:8px;background:var(--pd-red,#EE3124);' +
        'border:1px solid var(--pd-card,#222);z-index:9;cursor:crosshair;display:none}' +
      '.pdg-fillprev{box-shadow:inset 0 0 0 9999px rgba(238,49,36,.10);' +
        'outline:1px dashed rgba(238,49,36,.6);outline-offset:-1px}' +
      /* WARNING Required-and-empty is a LEFT BAR, not a red fill. A filled cell would fight the
         zebra, the selection overlay and the computed tint all at once, and on a draft where most
         cells start empty a red screen says nothing. */
      '.pdg-missing{box-shadow:inset 3px 0 0 var(--pd-warn,#D97706)}' +
      /* the shortcut legend */
      '.pdg-grid .cc-mini{font-size:9.5px;opacity:.7;margin-top:1px}' +
      '.pdg-grid .cc-desc{max-width:340px}' +
      '.pdg-hint{font-size:11px;color:var(--pd-muted,#8a8a8a)}' +
      '.pdg-hint kbd{font:inherit;font-weight:700;padding:0 3px;border:1px solid var(--pd-line,#333);' +
      'border-radius:3px;background:rgba(128,128,128,.12)}';
    document.head.appendChild(s);
  }

  /* ⚠️⚠️ THESE ARE PORTED FROM review.html, AND TWO OF ITS FEATURES ARE DELIBERATELY NOT.
     Ported: drag-to-resize with per-user persistence, frozen columns, the fill handle,
     required-and-empty highlighting, and per-column set-all.

     NOT ported, with reasons, because blind parity would be worse than judgement:
       · DIRTY TRACKING / "unsaved" COUNT / DRAFT AUTOSAVE. review.html stages every edit in
         `_gridEdits` and saves the batch later, so it must show what is unsaved and protect it.
         This grid writes each cell straight through on `change`. There is nothing unsaved to
         track — an "unsaved: 0" badge that can never read anything else is noise, and a
         localStorage draft would be a second copy of data already committed to Postgres.
       · COLLAPSIBLE COLUMN GROUPS. review.html carries 76 columns in named groups; this table
         has 13. Collapsing a group of two or three costs more than it saves. The equivalent
         win here is collapsing ROWS by heading, which the BOQ already does. */
  function attach(opt) {
    ensureCss();
    var root = opt.root;
    var sel = opt.cell || '.pdg-cell';
    if (!root) return { detach: function () {} };

    /* The host's column spec, when it has one. Everything below degrades quietly without it:
       a grid that only passes `root` and `cell` keeps exactly the behaviour it had before. */
    var SPEC = opt.columns || null;
    var SKEY = opt.storageKey || 'pdgrid';
    var MINW = 48, MAXW = 640;
    var widths = {}, freezeKey = null;

    function lsKey(what) { return 'pdg_' + SKEY + '_' + what; }
    function loadPrefs() {
      try { widths = JSON.parse(localStorage.getItem(lsKey('w')) || '{}') || {}; } catch (e) { widths = {}; }
      try { freezeKey = localStorage.getItem(lsKey('f')) || null; } catch (e) { freezeKey = null; }
    }
    function savePrefs() {
      try { localStorage.setItem(lsKey('w'), JSON.stringify(widths)); } catch (e) {}
      try {
        if (freezeKey) localStorage.setItem(lsKey('f'), freezeKey);
        else localStorage.removeItem(lsKey('f'));
      } catch (e) {}
    }
    function colW(c) { var v = widths[c.k]; return (typeof v === 'number' && v > 0) ? v : c.w; }
    loadPrefs();

    var cells = [];        // [{el, id, field, r, c}]
    var byRC = {};         // 'r:c' -> cell
    var cols = [];         // field order, by first appearance
    var rows = [];         // row id order, by first appearance
    var anchor = null;     // {r, c} where a shift-selection started
    var focus = null;      // {r, c}
    var undo = [];         // [[{el,id,field,prev}]]

    function key(r, c) { return r + ':' + c; }

    function table() { return root.querySelector('table.pdg-grid'); }

    /* ⚠️ WIDTH LIVES ON THE <col>, NOT THE CELLS. With `table-layout:fixed` the colgroup is the
       only thing the browser reads, so one write per column resizes the whole table — and a drag
       can update it live without re-rendering 4,000 cells. */
    function applyWidths() {
      var t = table(); if (!t || !SPEC) return;
      var colEls = t.querySelectorAll('colgroup col');
      var total = 0;
      SPEC.forEach(function (c, i) {
        var w = colW(c); total += w;
        if (colEls[i]) { colEls[i].style.width = w + 'px'; }
      });
      t.style.minWidth = total + 'px';
    }

    /* ⚠️ A FROZEN COLUMN IS STICKY AT ITS OWN LEFT OFFSET, so the offsets must be recomputed
       whenever a width changes — which is why the resize drag re-applies this on release. The
       boundary is inclusive: freezing "Description" pins everything up to and including it,
       because a contiguous left freeze is the only kind that reads correctly when you scroll. */
    function applyFreeze() {
      var t = table(); if (!t || !SPEC) return;
      t.querySelectorAll('.pdg-frozen').forEach(function (el) {
        el.classList.remove('pdg-frozen', 'pdg-frozen-edge');
        el.style.left = '';
      });
      if (!freezeKey) return;
      var upto = -1;
      SPEC.forEach(function (c, i) { if (c.k === freezeKey) upto = i; });
      if (upto < 0) return;
      var left = 0;
      for (var i = 0; i <= upto; i++) {
        var l = left;
        t.querySelectorAll('tr').forEach(function (tr) {
          var cell = tr.children[i];
          if (!cell) return;
          cell.classList.add('pdg-frozen');
          if (i === upto) cell.classList.add('pdg-frozen-edge');
          cell.style.left = l + 'px';
        });
        left += colW(SPEC[i]);
      }
    }

    /* Header furniture: a resize grip, a pin, and (where the host allows it) a set-all caret.
       Injected rather than required of the host, so adopting PDGrid stays a two-attribute job. */
    function decorateHead() {
      var t = table(); if (!t || !SPEC) return;
      var ths = t.querySelectorAll('thead th');
      SPEC.forEach(function (c, i) {
        var th = ths[i]; if (!th || th.querySelector('.pdg-rz')) return;
        th.classList.add('pdg-th');
        if (c.k === freezeKey) th.classList.add('pdg-pinned');

        var pin = document.createElement('button');
        pin.className = 'pdg-pin' + (c.k === freezeKey ? ' on' : '');
        pin.type = 'button';
        pin.title = c.k === freezeKey ? 'Unfreeze' : 'Freeze columns up to here';
        pin.textContent = '\u25e7';
        pin.onmousedown = function (e) { e.stopPropagation(); };
        pin.onclick = function (e) {
          e.preventDefault(); e.stopPropagation();
          freezeKey = (freezeKey === c.k) ? null : c.k;
          savePrefs(); applyWidths(); applyFreeze(); decorateHead();
        };
        th.appendChild(pin);

        /* ⚠️ Set-all is offered ONLY where the host says a column is safe for it. A blanket
           "set every cell in this column" over a money column is a way to destroy a bill in one
           click; over UoM or Kind it is the single biggest time-saver on the screen. */
        if (opt.onSetColumn && c.setAll) {
          var sa = document.createElement('button');
          sa.className = 'pdg-setall'; sa.type = 'button';
          sa.title = 'Set this column for every row shown';
          sa.textContent = '\u22ee';
          sa.onmousedown = function (e) { e.stopPropagation(); };
          sa.onclick = function (e) {
            e.preventDefault(); e.stopPropagation();
            opt.onSetColumn(c);
          };
          th.appendChild(sa);
        }

        var grip = document.createElement('div');
        grip.className = 'pdg-rz';
        grip.title = 'Drag to resize · double-click to reset';
        grip.onmousedown = function (e) { startResize(e, c, i); };
        grip.ondblclick = function (e) {
          e.preventDefault(); e.stopPropagation();
          delete widths[c.k]; savePrefs(); applyWidths(); applyFreeze();
        };
        th.appendChild(grip);
      });
    }

    /* ⚠️ The drag updates the <col> live and re-renders NOTHING — on 4,400 cells a re-render per
       mousemove is unusable. Only on release are the prefs saved and the freeze offsets redone,
       because those depend on the final width. */
    function startResize(e, c, i) {
      e.preventDefault(); e.stopPropagation();
      var t = table(); if (!t) return;
      var startX = e.clientX, startW = colW(c);
      var colEl = t.querySelectorAll('colgroup col')[i];
      document.body.style.cursor = 'col-resize';
      function move(ev) {
        var w = Math.max(MINW, Math.min(MAXW, startW + (ev.clientX - startX)));
        widths[c.k] = w;
        if (colEl) colEl.style.width = w + 'px';
        t.style.minWidth = SPEC.reduce(function (a, x) { return a + colW(x); }, 0) + 'px';
      }
      function up() {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.style.cursor = '';
        savePrefs(); applyFreeze();
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    }

    /* ⚠️ REQUIRED-AND-EMPTY, not merely empty. A blank cell is only a problem where the host has
       said a value is expected — flagging every empty cell on a 4,400-cell grid would paint the
       whole screen and mean nothing. */
    function paintRequired() {
      if (!SPEC) return;
      var req = {};
      SPEC.forEach(function (c) { if (c.req) req[c.k] = 1; });
      if (!Object.keys(req).length) return;
      for (var i = 0; i < cells.length; i++) {
        var x = cells[i];
        var bad = req[x.field] && String(x.el.value || '').trim() === '';
        x.el.classList.toggle('pdg-missing', !!bad);
      }
    }
    function missingCount() {
      return root.querySelectorAll('.pdg-missing').length;
    }

    /* Rebuilt from the DOM on every keystroke path that needs it, because the host module
       re-renders freely (a filter, a collapse, a save) and any map we cached would be stale.
       Reading ~700 inputs is microseconds; a stale map is a wrong cell written. */
    function index() {
      cells = []; byRC = {}; cols = []; rows = [];
      var list = root.querySelectorAll(sel);
      var ci = {}, ri = {};
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        var id = el.getAttribute('data-i'), f = el.getAttribute('data-f');
        if (!id || !f) continue;
        if (!(f in ci)) { ci[f] = cols.length; cols.push(f); }
        if (!(id in ri)) { ri[id] = rows.length; rows.push(id); }
        var cell = { el: el, id: id, field: f, r: ri[id], c: ci[f] };
        cells.push(cell);
        byRC[key(cell.r, cell.c)] = cell;
      }
    }

    function at(r, c) { return byRC[key(r, c)] || null; }

    function cellOf(el) {
      for (var i = 0; i < cells.length; i++) if (cells[i].el === el) return cells[i];
      return null;
    }

    /* Not every (row, column) exists — a heading row has no qty input, and a module may leave a
       cell out for its own reasons. Moving skips the holes rather than stopping dead on them. */
    function seek(r, c, dr) {
      for (var i = r + dr; i >= 0 && i < rows.length; i += dr) {
        var x = at(i, c);
        if (x && !x.el.disabled && !x.el.readOnly) return x;
      }
      return null;
    }

    function seekCol(r, c, dc) {
      var i, x;
      for (i = c + dc; i >= 0 && i < cols.length; i += dc) {
        x = at(r, i);
        if (x && !x.el.disabled && !x.el.readOnly) return x;
      }
      // wrap to the next / previous row, the way Tab does in a spreadsheet
      for (var rr = r + (dc > 0 ? 1 : -1); rr >= 0 && rr < rows.length; rr += (dc > 0 ? 1 : -1)) {
        for (i = (dc > 0 ? 0 : cols.length - 1); i >= 0 && i < cols.length; i += dc) {
          x = at(rr, i);
          if (x && !x.el.disabled && !x.el.readOnly) return x;
        }
      }
      return null;
    }

    function clearPaint() {
      for (var i = 0; i < cells.length; i++) {
        cells[i].el.classList.remove('pdg-sel');
        cells[i].el.classList.remove('pdg-anchor');
      }
    }

    /* The selection is a COLUMN RUN, not a rectangle, and that is deliberate. The operations a
       planner actually wants here are "put this rate down the rest of the trade" and "clear this
       column" — both vertical. A rectangular model would cost range maths in every operation to
       serve a case (multi-column fill) that a paste already covers better. */
    function range() {
      if (!focus) return null;
      var a = anchor || focus;
      return { c: focus.c, r1: Math.min(a.r, focus.r), r2: Math.max(a.r, focus.r) };
    }

    function paint() {
      clearPaint();
      var R = range();
      if (!R) { syncFill(); return; }
      for (var r = R.r1; r <= R.r2; r++) {
        var x = at(r, R.c);
        if (x) x.el.classList.add(R.r1 === R.r2 ? 'pdg-anchor' : 'pdg-sel');
      }
      syncFill();
    }

    /* WARNING THE FILL HANDLE IS THE MOUSE EQUIVALENT OF Ctrl+D, and the reason review.html has
       one: a planner pricing a trade drags a rate down forty lines without touching the keyboard.
       It is positioned against the LAST cell of the current selection, in the scroll container's
       coordinates, so it tracks horizontal scroll instead of drifting off the cell it belongs to. */
    var fillFrom = null, fillTo = null;

    function syncFill() {
      var h = root.querySelector('.pdg-fill');
      var R = range();
      var last = R && at(R.r2, R.c);
      if (!last || !SPEC) { if (h) h.style.display = 'none'; return; }
      var wrap = root.querySelector('.cc-tablewrap') || root;
      if (!h) {
        h = document.createElement('div');
        h.className = 'pdg-fill';
        h.title = 'Drag down to copy this value';
        h.onmousedown = startFill;
        wrap.style.position = wrap.style.position || 'relative';
        wrap.appendChild(h);
      }
      var tr = last.el.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      h.style.display = 'block';
      h.style.left = (tr.right - wr.left + wrap.scrollLeft - 4) + 'px';
      h.style.top = (tr.bottom - wr.top + wrap.scrollTop - 4) + 'px';
    }

    function paintFillPreview() {
      root.querySelectorAll('.pdg-fillprev').forEach(function (el) { el.classList.remove('pdg-fillprev'); });
      if (fillTo == null || !fillFrom) return;
      for (var r = fillFrom.r2 + 1; r <= fillTo; r++) {
        var x = at(r, fillFrom.c);
        if (x) x.el.classList.add('pdg-fillprev');
      }
    }

    function startFill(e) {
      e.preventDefault(); e.stopPropagation();
      index();
      var R = range(); if (!R) return;
      fillFrom = R; fillTo = null;
      function move(ev) {
        var el = document.elementFromPoint(ev.clientX, ev.clientY);
        var c = el && cellOf(el.closest && el.closest(sel) ? el.closest(sel) : el);
        if (!c) { var td = el && el.closest && el.closest('td'); if (td) c = cellOf(td.querySelector(sel)); }
        if (c && c.c === fillFrom.c && c.r > fillFrom.r2) { fillTo = c.r; paintFillPreview(); }
      }
      function up() {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        if (fillTo != null) {
          var src = at(fillFrom.r1, fillFrom.c);
          var b = [];
          if (src) for (var r = fillFrom.r2 + 1; r <= fillTo; r++) setCell(at(r, fillFrom.c), src.el.value, b);
          commit(b);
        }
        fillFrom = null; fillTo = null;
        paintFillPreview(); paint();
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    }

    function go(cell, keepAnchor) {
      if (!cell) return;
      focus = { r: cell.r, c: cell.c };
      if (!keepAnchor) anchor = null;
      cell.el.focus();
      if (cell.el.select) { try { cell.el.select(); } catch (e) {} }
      paint();
    }

    /* Every write goes through here so undo, fill and paste all record the same way, and so a
       module only ever has to implement one save function. ⚠️ The DOM is updated FIRST and the
       persist call is fired after: a planner filling 40 rows should see 40 rows change at once,
       not watch them arrive one round trip at a time. */
    function setCell(cell, value, batch) {
      if (!cell || cell.el.disabled || cell.el.readOnly) return;
      var prev = cell.el.value;
      if (String(prev) === String(value)) return;
      cell.el.value = value;
      if (batch) batch.push({ el: cell.el, id: cell.id, field: cell.field, prev: prev });
      if (opt.onSet) {
        try { opt.onSet(cell.id, cell.field, value); }
        catch (e) { try { console.warn('[pdgrid] onSet failed', e); } catch (e2) {} }
      }
    }

    function commit(batch) {
      if (batch && batch.length) undo.push(batch);
      if (undo.length > 50) undo.shift();
    }

    function doUndo() {
      var b = undo.pop();
      if (!b) return;
      for (var i = b.length - 1; i >= 0; i--) {
        b[i].el.value = b[i].prev;
        if (opt.onSet) {
          try { opt.onSet(b[i].id, b[i].field, b[i].prev); } catch (e) {}
        }
      }
    }

    function onKey(e) {
      var cell = cellOf(e.target);
      if (!cell) return;
      index();
      cell = cellOf(e.target);
      if (!cell) return;
      if (!focus || focus.r !== cell.r || focus.c !== cell.c) { focus = { r: cell.r, c: cell.c }; }

      var k = e.key, mod = e.ctrlKey || e.metaKey;

      if (mod && k.toLowerCase() === 'z') { e.preventDefault(); doUndo(); return; }

      if (mod && k.toLowerCase() === 'd') {
        e.preventDefault();
        var R = range();
        if (!R) return;
        var src = at(R.r1, R.c);
        if (!src) return;
        var b = [];
        // A single cell means "fill from here to the end of the column" is NOT assumed —
        // that would be a very large accident. With no selection, Ctrl+D copies the cell ABOVE,
        // which is what Excel does and what a planner reaching for it expects.
        if (R.r1 === R.r2) {
          var above = seek(cell.r, cell.c, -1);
          if (above) setCell(cell, above.el.value, b);
        } else {
          for (var r = R.r1 + 1; r <= R.r2; r++) setCell(at(r, R.c), src.el.value, b);
        }
        commit(b);
        return;
      }

      if (k === 'Enter' || k === 'ArrowDown' || k === 'ArrowUp') {
        var dir = (k === 'ArrowUp') ? -1 : 1;
        if (e.shiftKey && k !== 'Enter') {
          e.preventDefault();
          if (!anchor) anchor = { r: cell.r, c: cell.c };
          var nxt = seek(cell.r, cell.c, dir);
          if (nxt) { focus = { r: nxt.r, c: nxt.c }; nxt.el.focus(); paint(); }
          return;
        }
        e.preventDefault();
        go(seek(cell.r, cell.c, dir));
        return;
      }

      if (k === 'Tab') { e.preventDefault(); go(seekCol(cell.r, cell.c, e.shiftKey ? -1 : 1)); return; }

      if (k === 'Delete' || k === 'Backspace') {
        var Rd = range();
        // Only hijack Delete for a MULTI-cell selection. On a single cell it must keep deleting
        // one character, or the key becomes unusable for ordinary typing corrections.
        if (Rd && Rd.r1 !== Rd.r2) {
          e.preventDefault();
          var bd = [];
          for (var rr = Rd.r1; rr <= Rd.r2; rr++) setCell(at(rr, Rd.c), '', bd);
          commit(bd);
        }
        return;
      }

      if (k === 'Escape') { anchor = null; paint(); return; }
    }

    function onCopy(e) {
      var cell = cellOf(e.target);
      if (!cell) return;
      var R = range();
      if (!R || R.r1 === R.r2) return;     // a single cell copies natively, as text
      index();
      var out = [];
      for (var r = R.r1; r <= R.r2; r++) {
        var x = at(r, R.c);
        out.push(x ? x.el.value : '');
      }
      e.clipboardData.setData('text/plain', out.join(String.fromCharCode(10)));
      e.preventDefault();
    }

    /* ⚠️ Paste is the feature that makes this worth building. A BOQ is priced in Excel far more
       often than it is typed, so a planner pasting a column of 200 rates is the realistic path —
       and it is exactly what the schedule, cost loading and productivity grids will want too. */
    function onPaste(e) {
      var cell = cellOf(e.target);
      if (!cell) return;
      var text = (e.clipboardData || window.clipboardData).getData('text');
      if (!text) return;
      var lines = text.replace(/\r/g, '').split(String.fromCharCode(10));
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      // One plain value is an ordinary paste into one field; let the browser do it.
      if (lines.length === 1 && lines[0].indexOf(String.fromCharCode(9)) < 0) return;
      e.preventDefault();
      index();
      var b = [];
      for (var i = 0; i < lines.length; i++) {
        var parts = lines[i].split(String.fromCharCode(9));
        for (var j = 0; j < parts.length; j++) {
          var target = at(cell.r + i, cell.c + j);
          if (target) setCell(target, parts[j].trim(), b);
        }
      }
      commit(b);
      try { UI.toast('Pasted ' + b.length + ' cell' + (b.length === 1 ? '' : 's') + '.', 'success'); }
      catch (e2) {}
    }

    function onFocusIn(e) {
      var cell = cellOf(e.target);
      if (!cell) { index(); cell = cellOf(e.target); }
      if (!cell) return;
      focus = { r: cell.r, c: cell.c };
      if (!anchor) paint();
    }

    /* WARNING RE-RUN ON EVERY REFRESH, because the host re-renders the whole table on a filter, a
       collapse or a save — which throws away the colgroup widths, the sticky offsets and the
       header furniture along with it. layout() is what makes those survive a render the host
       knows nothing about. */
    function layout() {
      index();
      applyWidths();
      decorateHead();
      applyFreeze();
      paintRequired();
      syncFill();
    }

    layout();
    root.addEventListener('keydown', onKey);
    root.addEventListener('copy', onCopy);
    root.addEventListener('paste', onPaste);
    root.addEventListener('focusin', onFocusIn);

    return {
      detach: function () {
        root.removeEventListener('keydown', onKey);
        root.removeEventListener('copy', onCopy);
        root.removeEventListener('paste', onPaste);
        root.removeEventListener('focusin', onFocusIn);
        clearPaint();
      },
      refresh: layout,
      /* How many required cells are still empty - the host renders the legend, since only it
         knows where to put it. */
      missing: missingCount,
      resetWidths: function () { widths = {}; savePrefs(); applyWidths(); applyFreeze(); },
      /* Exported for a harness: the grid's whole job is the map it builds from the DOM, so a
         test can assert the map without a browser. */
      _map: function () { return { rows: rows.slice(), cols: cols.slice(), n: cells.length }; }
    };
  }

  function hintHTML() {
    return '<span class="pdg-hint">' +
      '<kbd>Tab</kbd> next field · <kbd>Enter</kbd> next row · <kbd>Shift</kbd>+<kbd>&darr;</kbd> select · ' +
      '<kbd>Ctrl</kbd>+<kbd>D</kbd> fill down · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · paste a column from Excel' +
      '</span>';
  }

  return { attach: attach, hintHTML: hintHTML };
})();
