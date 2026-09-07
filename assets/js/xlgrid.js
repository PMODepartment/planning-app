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
    s.textContent =
      '.pdg-sel{background:rgba(238,49,36,.16)!important;border-color:rgba(238,49,36,.55)!important}' +
      '.pdg-anchor{outline:2px solid var(--pd-red,#EE3124);outline-offset:-2px}' +
      '.pdg-flash{transition:background .35s ease}' +
      '.pdg-hint{font-size:11px;color:var(--pd-muted,#8a8a8a)}' +
      '.pdg-hint kbd{font:inherit;font-weight:700;padding:0 3px;border:1px solid var(--pd-line,#333);' +
      'border-radius:3px;background:rgba(128,128,128,.12)}';
    document.head.appendChild(s);
  }

  function attach(opt) {
    ensureCss();
    var root = opt.root;
    var sel = opt.cell || '.pdg-cell';
    if (!root) return { detach: function () {} };

    var cells = [];        // [{el, id, field, r, c}]
    var byRC = {};         // 'r:c' -> cell
    var cols = [];         // field order, by first appearance
    var rows = [];         // row id order, by first appearance
    var anchor = null;     // {r, c} where a shift-selection started
    var focus = null;      // {r, c}
    var undo = [];         // [[{el,id,field,prev}]]

    function key(r, c) { return r + ':' + c; }

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
      if (!R) return;
      for (var r = R.r1; r <= R.r2; r++) {
        var x = at(r, R.c);
        if (x) x.el.classList.add(R.r1 === R.r2 ? 'pdg-anchor' : 'pdg-sel');
      }
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

    index();
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
      refresh: index,
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
