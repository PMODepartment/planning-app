/* =============================================================================
   PDLoc — ONE location-value normaliser for the whole app
   =============================================================================
   ⚠️⚠️ WHY THIS FILE EXISTS: THERE WERE THREE COPIES AND ONE OF THEM WAS WRONG.

     1. `modules/project-schedule/index.html`  — `LOC_ORD` / `_locNormKeyCalc` / `locSpellRank`
        (the canonical one: strips EVERY separator, so "Roof Deck" and "Roofdeck" agree)
     2. `modules/contracts-claims/affected.js` — `LOC_ORD` / `_normCalc` / `spellRank`
        (a deliberate duplicate, cross-asserted against (1) in that module's suite)
     3. `modules/contracts-claims/boq.js`      — `ORD` / `locKey`
        (KEPT the spaces, and folded floor/level/storey to one word)

   (3) is the odd one out and it was silently costing matches: the BOQ allocator's
   `locMatch` could not match a leaf reading "to Roof Deck" against an activity whose
   location value is "Roofdeck", while the schedule matched the same pair fine. A BOQ line
   that fails to match spreads its money over the wrong activities — see `boqDerive` in
   project-schedule, which splits a line's amount across whatever it IS matched to.

   ⚠️ There is no shared runtime across module boundaries in this app: each module is its own
   PAGE, and `ScheduleBuilder` is a closure local that is never assigned to `window`. So the
   only way to share is a file in `assets/js/` that both pages load — the same call already
   made for `co-insert.js`, `scurve.js` and `stakeholders.js`.

   ⚠️ `normKey` here is BYTE-FOR-BYTE the schedule's `_locNormKeyCalc`. It is the merge key the
   stacking, the location wizard and every stored `project_schedule.location` value already
   agree on, so changing it would silently regroup a real project's floors. Do not "improve"
   it. New behaviour goes in a new function, as `contains` below does.
   ============================================================================= */
window.PDLoc = (function () {
  'use strict';

  /* Ordinal words → digits, so "third floor" and "3rd Floor" agree. ⚠️ Deliberately small:
     folding too much is how "8th" and "18th" get merged. Verbatim from the schedule. */
  var ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8,
    eight: 8, ninth: 9, nineth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14,
    fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20 };

  /* Memoised: called once per record per mapped level in both the merge pass and the plan pass,
     over a value set that is tiny (a couple of dozen distinct spellings) next to the record count. */
  var _memo = Object.create(null);
  function normKey(v) {
    var k = String(v == null ? '' : v), c = _memo[k];
    if (c !== undefined) return c;
    return (_memo[k] = _normCalc(k));
  }
  function _normCalc(v) {
    var s = String(v == null ? '' : v).toLowerCase().replace(/[‘’']/g, '');
    s = s.replace(/[a-z]+/g, function (w) { return ORD[w] != null ? String(ORD[w]) : w; });
    s = s.replace(/(\d+)(st|nd|rd|th)(?![a-z])/g, '$1');   // 2nd → 2, 10th → 10
    return s.replace(/[^a-z0-9]+/g, '');                   // "Roof Deck" and "Roofdeck" → roofdeck
  }

  /* One display spelling per normalised key. ⚠️ Frequency alone picks the WORST spelling on real
     data — it kept Avesta's typos ("Nineth Floor", "Eight Floor") over "9th"/"8th Floor", and Jab's
     "Roofdeck" over "Roof Deck". So legibility decides first:
       1. a variant containing a DIGIT (unambiguous, and it sorts 2/9/10 correctly where
          "Ninth"/"Tenth" sort alphabetically),
       2. then more word separators ("Roof Deck" over "Roofdeck"),
       3. then more Title-Cased words ("Ground Floor" over "Ground floor"),
     then frequency / shortest / alphabetical so the answer is deterministic whatever order the
     rows arrived in. Verbatim from the schedule. */
  function spellRank(v) {
    return [
      /\d/.test(v) ? 0 : 1,
      -(String(v).split(/\s+/).length),
      -(String(v).split(/\s+/).filter(function (w) { return /^[A-Z]/.test(w); }).length)
    ];
  }
  function bestSpelling(variants) {
    var counts = {};
    (variants || []).forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
    return Object.keys(counts).sort(function (a, b) {
      var ra = spellRank(a), rb = spellRank(b);
      for (var i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
      if (counts[b] !== counts[a]) return counts[b] - counts[a];
      if (a.length !== b.length) return a.length - b.length;
      return a.localeCompare(b);
    })[0];
  }

  /* ==========================================================================
     contains(haystack, needle) — "does this sentence name this place?"
     ==========================================================================
     The BOQ case, which neither existing copy handled correctly. A BOQ leaf on the fit-out
     sheets is a SENTENCE naming a place — "to Hallway & Lift Lobby at 3rd floor" — while
     `project_schedule.location` holds a TOKEN — "3rd Floor". So the test is containment,
     not equality.

     ⚠️⚠️ AND IT CANNOT BE A PLAIN `indexOf` ON `normKey`, WHICH IS WHY THIS IS NOT ONE LINE.
     `normKey` strips every separator, so "13th Floor" → "13floor" and "3rd Floor" → "3floor",
     and `"13floor".indexOf("3floor")` is 1 — a hit. A BOQ line measured on the 3rd floor would
     silently claim the 13th floor's activities too, which on a change order is scope invented
     out of nothing. This is exactly the "8th and 18th get merged" trap boq.js's own ORD comment
     warned about, arriving from the other direction.

     So a hit is rejected when a DIGIT sits immediately outside a numeric edge of the needle.
     A non-numeric needle ("roofdeck") is unaffected and still matches inside "toroofdeck",
     which is the miss this whole file exists to fix.

     ⚠️ Substring search needs ≥2 characters, or a zone named "A" matches every sentence
     containing the letter a. Exact equality is always honoured, however short. */
  function contains(haystack, needle) {
    var H = normKey(haystack), N = normKey(needle);
    if (!H || !N) return false;
    if (H === N) return true;
    if (N.length < 2) return false;
    var i = H.indexOf(N);
    while (i >= 0) {
      var before = i > 0 ? H.charAt(i - 1) : '';
      var after = H.charAt(i + N.length);
      var badL = /\d/.test(before) && /^\d/.test(N);
      var badR = /\d/.test(after) && /\d$/.test(N);
      if (!badL && !badR) return true;
      i = H.indexOf(N, i + 1);
    }
    return false;
  }

  return { ORD: ORD, normKey: normKey, spellRank: spellRank, bestSpelling: bestSpelling,
           contains: contains, _calc: _normCalc };
})();
