// ============================================================================
// Autosave — shared debounced-autosave wiring for Add/Edit modals.
// Reuses each module's own Save button handler (which already knows how to
// build the payload + write via PDSync/Supabase); autosave just calls it on a
// debounce and suppresses the close/redirect side effects it normally does on
// a manual click, so the modal stays open while the planner keeps typing.
// ============================================================================
window.Autosave = (function () {
  function wire(opts) {
    // opts: { root, modal, saveBtn, indicator, delay }
    //   root      element to listen for input/change on
    //   modal     the UI.modal() return value (has .close, .el)
    //   saveBtn   the <button> whose onclick performs the real save
    //   indicator element to show status text in (optional)
    //   delay     debounce ms (default 1200)
    var root = opts.root, modal = opts.modal, saveBtn = opts.saveBtn;
    var ind = opts.indicator, delay = opts.delay || 1200;
    var timer = null, dirty = false, saving = false, again = false, stopped = false;

    function status(s) {
      if (!ind) return;
      ind.textContent = s;
      ind.className = 'pd-autosave pd-autosave-' +
        (s === 'Saved' ? 'ok' : s === 'Saving…' ? 'busy' : /error/i.test(s) ? 'err' : 'idle');
    }

    function schedule() {
      if (stopped) return;
      dirty = true;
      status('Unsaved changes…');
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
    }

    async function flush() {
      if (stopped || !dirty) return;
      if (saving) { again = true; return; }
      dirty = false; saving = true; status('Saving…');
      var realClose = modal.close;
      modal.close = function () {};   // autosave never closes the modal
      /* ==== GIVE THE SAVE BUTTON BACK THE WAY WE FOUND IT =====================================
         Owner 2026-09-17: *"Saving button is not working, probably due to the autosave feature."*
         Right, and here is the mechanism.
         ⚠️⚠️ THE BORROWED HANDLER DISABLES THE BUTTON AND NEVER RE-ENABLES IT ON SUCCESS,
         because on a real click it does not have to: the modal closes and the button goes with it.
         Autosave calls that same handler with `modal.close` stubbed out — which is the whole point,
         the planner is still typing — so the handler runs `btn.disabled = true;
         btn.textContent = 'Saving…'`, succeeds, calls the no-op close, and returns. Nothing ever
         puts the button back. From the planner's side the Save button reads **Saving…** and is dead
         for the rest of the session, which is exactly what was reported. Their work WAS saved —
         autosave wrote it — but the only thing on screen says otherwise, so the rational response
         is to hit Cancel and assume the edit was lost.
         ⚠️ THE FIX BELONGS HERE, NOT IN EACH MODULE. Autosave is what suppressed the close
         that would have disposed of the button, so autosave is what owes it a restore — and there
         are four consumers (contracts-claims, progress-photos, risk-register, stakeholder-map),
         three of which spell their save handler differently. One module (stakeholder-map) already
         has its own `finally` for this and is simply restored to the same values twice.
         ⚠️ Captured BEFORE the call, restored after, whatever happened: on a failure the
         handler has usually already reset the label itself, and writing back 'Save' + enabled is
         the same answer. `label` is read off the live node rather than assumed, so a module that
         names its button something other than "Save" keeps its own word. */
      var wasDisabled = saveBtn.disabled, wasLabel = saveBtn.textContent;
      try {
        await saveBtn.onclick();
        status('Saved');
      } catch (e) {
        status('Error — will retry');
        dirty = true;
      } finally {
        modal.close = realClose;
        saveBtn.disabled = wasDisabled;
        saveBtn.textContent = wasLabel;
        saving = false;
        if (again) { again = false; schedule(); }
      }
    }

    root.addEventListener('input', schedule);
    root.addEventListener('change', schedule);

    return {
      cancel: function () { stopped = true; clearTimeout(timer); },
      flushNow: flush
    };
  }
  return { wire: wire };
})();
