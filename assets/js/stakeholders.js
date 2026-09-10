// ============================================================================
// Planners Dashboard — shared stakeholder directory (PDStakeholders)
// ----------------------------------------------------------------------------
// `stakeholders` is the PORTFOLIO-level master list of people. `stakeholder_map`
// holds one row per person PER PROJECT (the engagement: influence, interest,
// approach, plan) and links back through the nullable `stakeholder_id`. There is
// no junction table — "this person is on N projects" is N stakeholder_map rows
// sharing one stakeholder_id.
//
// ⚠️⚠️ WHY THIS FILE EXISTS AT ALL. Two screens need identity matching, find-or-
// create, directory loading and merge: the Stakeholder Map module and the
// Portfolio Dashboard's Stakeholders view. portfolio-overview has ALREADY made
// the mistake of hand-copying shared logic once — it carried its own duplicate of
// the S-curve maths until 2026-09-09, and the cost was that one bug had to be
// reasoned about in three files. Not repeating that here.
//
// ⚠️⚠️ THE MATCHER NEVER DECIDES ANYTHING ON ITS OWN. `matchCandidates` RANKS;
// a human links. Exact identity (name + organisation, the unique index's own key)
// may be resolved automatically because the database enforces it anyway — but a
// FUZZY hit must always be confirmed. Silently merging two real people is worse
// than the duplicate it was trying to prevent, and it is not undoable from the UI.
// ============================================================================

(function () {
  'use strict';

  var DIR = 'stakeholders';
  var MAP = 'stakeholder_map';

  // The person fields the directory owns and stakeholder_map mirrors. ⚠️ Kept
  // identical to the module's own list; the mirror exists because the register
  // table, the CSV export, the offline cache and the portfolio roll-up all read
  // `row.name` / `row.organization` directly off a stakeholder_map row.
  var PERSON_FIELDS = ['name', 'title', 'nickname', 'role_title', 'organization',
                       'category', 'stakeholder_group', 'email', 'contact',
                       'birthday', 'gift_tier', 'photo_path', 'photo_thumb_path'];

  // ---- normalisation -------------------------------------------------------
  // ⚠️ Honorifics and suffixes are stripped as WHOLE TOKENS, never as substrings:
  // "Sr" as a substring would maul "Srinivasan", and "Jr" would maul "Jrue".
  var HONORIFICS = ['mr', 'mrs', 'ms', 'miss', 'dr', 'engr', 'engineer', 'arch', 'atty',
                    'hon', 'sir', 'madam', 'madame', 'prof', 'professor', 'fr', 'rev',
                    'gen', 'col', 'capt', 'lt', 'sgt', 'usec', 'asec', 'sec', 'gov', 'mayor'];
  var SUFFIXES = ['jr', 'sr', 'ii', 'iii', 'iv', 'v', 'phd', 'md', 'cpa', 'rn', 'esq', 'ret'];

  function stripDiacritics(s) {
    // Peñafrancia → Penafrancia. normalize('NFD') splits the accent off as its own
    // combining mark, which the range then removes.
    try { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { return s; }
  }

  function normName(s) {
    var t = stripDiacritics(String(s == null ? '' : s)).toLowerCase();
    // A comma means "Surname, Given" — flip it so token order is comparable.
    var c = t.indexOf(',');
    if (c > 0) t = t.slice(c + 1) + ' ' + t.slice(0, c);
    t = t.replace(/[.\-_'’]/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    var parts = t.split(' ').filter(Boolean).filter(function (w, i, arr) {
      if (HONORIFICS.indexOf(w) !== -1) return false;
      // ⚠️ A suffix is only dropped when something precedes it — a person recorded
      // as just "Ii" keeps the only name they have.
      if (SUFFIXES.indexOf(w) !== -1 && i > 0) return false;
      return true;
    });
    return parts.join(' ');
  }

  function tokens(s) { var n = normName(s); return n ? n.split(' ') : []; }

  function normOrg(s) {
    var t = stripDiacritics(String(s == null ? '' : s)).toLowerCase();
    t = t.replace(/[.,\-_'’]/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    // Corporate suffixes carry no identity: "Megawide Construction Corp" and
    // "Megawide Construction Corporation" are one employer.
    return t.replace(/\b(corp|corporation|inc|incorporated|co|company|ltd|limited|llc|plc|group|holdings)\b/g, '')
            .replace(/\s+/g, ' ').trim();
  }

  // ---- edit distance (bounded) --------------------------------------------
  // ⚠️ Bounded on purpose: it is only ever asked "is this within k?", and an
  // early exit keeps it cheap over a directory of hundreds.
  function editWithin(a, b, k) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > k) return k + 1;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      var best = cur[0];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
                          prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > k) return k + 1;
      for (j = 0; j <= b.length; j++) prev[j] = cur[j];
    }
    return prev[b.length];
  }

  function isInitialOf(a, b) { return a.length === 1 && b.length > 1 && b.charAt(0) === a; }

  function subset(small, big) {
    var pool = big.slice();
    for (var i = 0; i < small.length; i++) {
      var k = pool.indexOf(small[i]);
      if (k === -1) return false;
      pool.splice(k, 1);
    }
    return true;
  }

  // ---- the score -----------------------------------------------------------
  // Returns { score, why } with score in 0..1. 0 means "not a candidate".
  //
  // ⚠️⚠️ THE SURNAME GATE IS WHAT KEEPS THIS HONEST. Every name-based rule below
  // requires the LAST token to agree (or to be an initial of the other). Without
  // it, "Juan Santos" and "Maria Santos" score as a near-miss on a shared surname,
  // and a directory of Filipino names would surface false matches constantly. The
  // gate costs one real case — a surname that changed — which is a rename, not a
  // near-duplicate, and is not what this feature is for.
  // Every spelling of one person worth comparing: their recorded name, and — when a
  // nickname exists — that nickname standing in for the GIVEN name.
  // ⚠⚠ SUBSTITUTED FOR THE GIVEN NAME, NOT MATCHED AGAINST THE WHOLE STRING. The first
  //    version only fired when the nickname equalled the entire other name, which is not
  //    how a nickname is used: the directory holds `Ana Reyes` with nickname `Anne`, and
  //    the person gets typed as `Anne Reyes`. That case scored ZERO. Found by the suite,
  //    not by reading.
  // ⚠ The surname is never substituted, so the surname gate below still applies to every
  //    variant and a nickname cannot smuggle two different families together.
  function nameVariants(p) {
    var base = tokens(p.name);
    var out = [base];
    var nick = tokens(p.nickname);
    if (nick.length && base.length) {
      var alt = nick.concat(base.slice(1));       // nickname + the rest of the name
      if (alt.join(' ') !== base.join(' ')) out.push(alt);
      if (base.length > 1) {
        var alt2 = nick.concat([base[base.length - 1]]);   // nickname + surname only
        if (alt2.join(' ') !== alt.join(' ')) out.push(alt2);
      }
    }
    return out;
  }

  function scorePair(a, b) {
    var best = { score: 0, why: '' };
    var va = nameVariants(a), vb = nameVariants(b);
    for (var i = 0; i < va.length; i++) {
      for (var j = 0; j < vb.length; j++) {
        var r = scoreTokens(va[i], vb[j], i > 0 || j > 0);
        if (r.score > best.score) best = r;
      }
    }
    if (!best.score) return best;
    return applyOrg(best, a, b);
  }

  function scoreTokens(ta, tb, viaNick) {
    var na = ta.join(' '), nb = tb.join(' ');
    var out = { score: 0, why: '' };

    if (!na || !nb) return out;

    if (na === nb) { out.score = viaNick ? 0.9 : 1; out.why = viaNick ? 'nickname matches' : 'same name'; }
    else {
      var la = ta[ta.length - 1], lb = tb[tb.length - 1];
      var surnameOk = la === lb || isInitialOf(la, lb) || isInitialOf(lb, la) ||
                      (la.length >= 4 && lb.length >= 4 && editWithin(la, lb, 1) <= 1);
      if (surnameOk) {
        var small = ta.length <= tb.length ? ta : tb;
        var big   = ta.length <= tb.length ? tb : ta;
        if (small.length !== big.length && subset(small, big)) {
          // "Fernando Lozano" ⊂ "Fernando Miguel Lozano" — the owner's own case.
          out.score = 0.92; out.why = 'one name is the other with a middle name';
        } else if (small.length === big.length) {
          var diff = 0, initialised = 0, typo = 0;
          for (var i = 0; i < small.length; i++) {
            var x = small[i], y = big[i];
            if (x === y) continue;
            if (isInitialOf(x, y) || isInitialOf(y, x)) { initialised++; continue; }
            if (x.length >= 4 && y.length >= 4 && editWithin(x, y, 2) <= 2) { typo++; continue; }
            diff++;
          }
          if (diff === 0 && initialised > 0 && typo === 0) {
            out.score = 0.88; out.why = 'initials expanded';
          } else if (diff === 0 && typo === 1) {
            out.score = 0.78; out.why = 'looks like a typo';
          } else if (diff === 0 && typo === 0 && initialised === 0) {
            out.score = 1; out.why = 'same name';
          }
        }
      }
    }

    if (out.score && viaNick && out.why.indexOf('nickname') === -1) {
      out.why += ' (via nickname)';
      out.score = Math.min(out.score, 0.9);   // one step less certain than the recorded name
    }
    return out;
  }

  // Organisation adjusts confidence; it never creates or vetoes a match on its own.
  // ⚠️ A disagreement DEMOTES rather than excludes — people change employer, and the same
  // person under two organisations is exactly the duplicate this is meant to catch.
  function applyOrg(out, a, b) {
    var oa = normOrg(a.organization), ob = normOrg(b.organization);
    if (oa && ob) {
      if (oa === ob) { out.score = Math.min(1, out.score + 0.06); out.why += ', same organisation'; }
      else { out.score -= 0.12; out.why += ', different organisation'; }
    }
    return out;
  }

  var THRESHOLD = 0.65;

  // Rank directory rows against a typed person. Never writes, never decides.
  function matchCandidates(input, directory, opts) {
    opts = opts || {};
    var limit = opts.limit || 6;
    var exclude = opts.excludeIds || [];
    var out = [];
    (directory || []).forEach(function (p) {
      if (!p || exclude.indexOf(p.id) !== -1) return;
      var r = scorePair(input, p);
      if (r.score >= (opts.threshold || THRESHOLD)) {
        out.push({ person: p, score: Math.round(r.score * 100) / 100, why: r.why, exact: r.score >= 1 });
      }
    });
    out.sort(function (x, y) { return y.score - x.score; });
    return out.slice(0, limit);
  }

  // An EXACT identity hit — the unique index's own key, `lower(btrim(name))` +
  // `lower(coalesce(btrim(organization),''))`. ⚠️ Deliberately NOT the normalised
  // form above: this must agree with what the DATABASE will accept, or a "find"
  // that misses inserts a row the index then refuses and the save fails with a
  // constraint error the planner cannot act on.
  function exactKey(p) {
    return String(p && p.name || '').trim().toLowerCase() + ' ' +
           String(p && p.organization || '').trim().toLowerCase();
  }
  function findExact(input, directory) {
    var k = exactKey(input);
    return (directory || []).filter(function (p) { return exactKey(p) === k; })[0] || null;
  }

  function missingTable(err) {
    var m = String(err && (err.message || err.details || err.code) || '');
    return /does not exist|schema cache|42P01|PGRST205/i.test(m);
  }

  window.PDStakeholders = {
    DIR: DIR, MAP: MAP, PERSON_FIELDS: PERSON_FIELDS, THRESHOLD: THRESHOLD,
    normName: normName, normOrg: normOrg, tokens: tokens,
    editWithin: editWithin, scorePair: scorePair, nameVariants: nameVariants,
    matchCandidates: matchCandidates, findExact: findExact, exactKey: exactKey,
    missingTable: missingTable
  };
})();
