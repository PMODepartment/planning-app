/* ============================================================================
   PDProgram — the PARENT PROJECT (a development bought as several projects)

   Owner, 2026-08-27: *"AVR101 and AVR101 are treated separately. LCR352 and
   LCR102 are treated the same way. Let's do a global approach for this in the
   planning-app first before the procurement app and engineering app."*

   Megawide buys one development as several PROJECTS, each with its own code:
     AVR101 / AVR102  → Avesta Residences
     LCR102 / LCR352  → the same development, two contracts
   Procurement and Engineering hold them the same way, so the codes are the
   shared key across all three apps.

   ⚠️ THIS IS A REPORTING ROLLUP, NOT A MERGE, and that is the whole design.
      Folding them into one project with `packages` rows underneath is what
      produced the AVR101 › {AVR101, AVR102} nesting, and it breaks the cross-app
      link: `push-packages` resolves ONE downstream project per Planners project
      (cash_flow_settings.wpm_project_id), while WPM and Engineering each hold
      AVR101 and AVR102 as their own projects. Keeping the rows separate keeps
      that 1:1 intact and costs no data change.

   ⚠️ ONE DEFINITION, USED EVERYWHERE. Portfolio Overview solved this first with
      a private copy; a second screen grouping by its own slightly-different rule
      is how two pages come to disagree about which projects are "the same
      project" — the exact confusion this exists to end. Every screen that groups
      projects reads these three functions.
   ============================================================================ */
window.PDProgram = (function () {
  'use strict';

  /* The grouping key.
     ⚠️ THE PREFIX IS NOT A GUESS. It is the convention every project id in this
        portfolio already follows (AVR, BAU, GPR, LCR, OPW, SLN, SLT, WCB), so
        this needs NO data entry to start working — which is what makes it safe
        to switch on across every screen at once. A project whose prefix is
        unique simply forms a group of one and reads exactly as it does today.
     ⚠️ `projects.program` OVERRIDES it, for the cases the convention cannot
        express: two developments sharing a prefix, or one split across prefixes
        after a rebrand. Set it in Admin; leave it blank and the prefix rules. */
  function keyOf(p) {
    if (p && p.program && String(p.program).trim()) return String(p.program).trim().toUpperCase();
    var m = String((p && p.id) || '').match(/^[A-Za-z]+/);
    return (m ? m[0] : String((p && p.id) || '')).toUpperCase();
  }

  /* The display name: the words the members' names actually SHARE.
     "Avesta Residences Tower 1 and General Requirements" + "Avesta Residences
     Towers 2-7" reads as "Avesta Residences" rather than the bare code AVR.
     ⚠️ Falls back to the code when they share fewer than 3 characters — the
        honest answer for an accidental prefix collision. Inventing a shared name
        for two unrelated projects is worse than showing the code, because the
        name is what a reader trusts. */
  function labelOf(key, members) {
    var names = (members || []).map(function (p) { return String((p && p.name) || '').trim(); })
      .filter(Boolean);
    if (!names.length) return key;
    if (names.length === 1) return names[0];
    var parts = names.map(function (n) { return n.split(/\s+/); });
    var i = 0;
    while (i < parts[0].length && parts.every(function (w) {
      return w[i] && w[i].toLowerCase() === parts[0][i].toLowerCase();
    })) i++;
    var words = parts[0].slice(0, i);

    /* ⚠️ DROP A TRAILING QUALIFIER THAT IS PART OF THE NUMBERING, NOT THE NAME.
       "La Costa Residences Phase 1" + "Phase 2" share the word "Phase", so the raw
       shared prefix is "La Costa Residences Phase" — a dangling qualifier that reads
       as an unfinished name. (The WPM version this was ported from has the same flaw.)
       ⚠️ ONLY when what follows it is a bare NUMBER in every member, because that is
          what makes it a numbering scheme rather than the development's actual name:
            "… Phase 1" / "… Phase 2"  -> numbering  -> drop "Phase"
            "Sun Tower A" / "Sun Tower B" -> A and B are wings of a building genuinely
            called Sun Tower -> KEEP it, or the group reads as "Sun".
       Checked against the NEXT token of every member, so one member breaking the
       pattern leaves the qualifier alone. */
    var QUALIFIER = /^(phase|package|pkg|tower|building|bldg|block|lot|stage|section|part|cluster|wing)$/i;
    if (words.length && QUALIFIER.test(words[words.length - 1])) {
      // ⚠️ The token AFTER the shared run, i.e. index words.length — words[words.length-1]
      // is the qualifier itself, and testing that for a number can never be true.
      var allNumbered = parts.every(function (w) {
        var nxt = w[words.length];
        return nxt && /^\d+([-–—/]\d+)?$/.test(nxt.replace(/[.,;:]+$/, ''));
      });
      // ⚠️ Trimming to nothing is allowed on purpose: "Tower 1" / "Tower 2" leaves a bare
      // "Tower", which names no development — the length check below then falls back to
      // the code, which at least identifies it.
      if (allNumbered) words = words.slice(0, -1);
    }

    var common = words.join(' ').replace(/[\s\-–—,:]+$/, '');
    return common.length >= 3 ? common : key;
  }

  /* Every project keyed by its parent, sorted by label, members by id.
     Returns [{key, label, members}] — the shape every consumer wants, so no
     screen has to rebuild the grouping loop and get the ordering subtly different. */
  function groups(projects) {
    var by = {}, order = [];
    (projects || []).forEach(function (p) {
      var k = keyOf(p);
      if (!by[k]) { by[k] = []; order.push(k); }
      by[k].push(p);
    });
    return order.map(function (k) {
      var ms = by[k].slice().sort(function (a, b) {
        return String(a.id).localeCompare(String(b.id));
      });
      return { key: k, label: labelOf(k, ms), members: ms };
    }).sort(function (a, b) { return a.label.localeCompare(b.label); });
  }

  /* The parent label for ONE project, computed against the WHOLE portfolio.
     ⚠️ Always pass every project, never a filtered list: a filter that hides
        AVR102 would make AVR101's parent read as AVR101's own title, so the same
        project would show a different parent depending on the active filter. */
  function labelFor(project, allProjects) {
    var k = keyOf(project);
    var members = (allProjects || []).filter(function (p) { return keyOf(p) === k; });
    return labelOf(k, members.length ? members : [project]);
  }

  /* True when this project shares its parent with at least one other.
     Used to decide whether a parent heading is worth showing at all — a heading
     above a single project invents a hierarchy that is not there. */
  function isShared(project, allProjects) {
    var k = keyOf(project), n = 0;
    (allProjects || []).forEach(function (p) { if (keyOf(p) === k) n++; });
    return n > 1;
  }

  return { keyOf: keyOf, labelOf: labelOf, groups: groups, labelFor: labelFor, isShared: isShared };
})();
