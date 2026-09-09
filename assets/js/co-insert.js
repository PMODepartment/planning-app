/* Change-order insertion — THE arithmetic, in one place.

   Owner, 2026-09-09: *"We should also consider when a change order not only affects existing
   activities but will also add them. I believe there is a function already that is available in
   the schedule module. Let's implement holistically."*

   ⚠️⚠️ WHY THIS FILE EXISTS AT ALL. `splitPlan` / `splitBuild` / `bulkSplitPlan` lived inside
   modules/project-schedule/index.html, and project-schedule's own comment gave the reason:
   *"AND IT LIVES HERE, NOT IN CONTRACTS & CLAIMS ... Contracts & Claims records WHICH activities a
   variation touches; inserting the work is this module's job."* That was right about WRITES and
   wrong about READS. Contracts & Claims has to PREVIEW the same result — a planner raising a
   variation needs to see the activities it will create before agreeing to it — and the only two
   ways to do that were to copy the arithmetic or to share it. `affected.js` already carried a
   comment refusing the copy: *"a second copy of the one calculation a CO claim turns on."* So it
   is shared. One implementation, two callers, and the writes still happen only in the schedule.

   ⚠️⚠️ IT TAKES THE CALLER'S OWN DATE HELPERS AND THAT IS DELIBERATE, NOT LAZINESS.
   project-schedule's `pd`/`dstr`/`addDays` are LOCAL-time; contracts-claims' are UTC, on purpose
   (its own note: in UTC+8 a plain YYYY-MM-DD parsed locally lands on the previous day at 16:00 and
   every bar starts a day early). Standardising this file on either one would silently change the
   other module's dates. The ARITHMETIC is what must not be duplicated; the date representation is
   each module's own business, so it is injected.

   Usage:  var CO = COInsert.make({ pd: pd, dstr: dstr, addDays: addDays, dayDiff: dayDiff,
                                    fmtDate: Fmt.date, usedIds: function () { ... } });
*/
window.COInsert = (function () {
  'use strict';

  function make(deps) {
    deps = deps || {};
    var pd = deps.pd, dstr = deps.dstr, addDays = deps.addDays, dayDiff = deps.dayDiff;
    var fmtDate = deps.fmtDate || function (iso) { return iso; };
    // Every Activity ID already in the project. A function, not an array, because the caller's row
    // set changes under it and a snapshot taken at wiring time would go stale.
    var usedIds = deps.usedIds || function () { return []; };

    /* ⚠️⚠️ ONE ALLOCATOR FOR BOTH THE SINGLE AND THE BULK CASE, and the bulk one is the survivor.
       `splitFreeId` checked the candidate against the project's rows only — correct for one insert
       and quietly catastrophic for many, because `splitBuild` uses `co.ref` as the id when one is
       given and nothing is written until the end of a run, so the row set never grows during it:
       twenty-three hosts under CO-014 would every one of them be handed the id "CO-014". Twenty-
       three activities sharing an Activity ID breaks the predecessor strings (which reference
       activities BY id), the schedule<->document links and the affected-activity links, all
       silently. So a `taken` map is threaded through the run and every id is checked against both.
       ⚠️ The single-insert path now scans to 9999 rather than 999. That is the only behavioural
       difference in this whole extraction, it can only ever find MORE free ids, and it is recorded
       here so it is a decision rather than a drift. */
    function freeId(cand, taken) {
      taken = taken || {};
      var c = String(cand || 'CO');
      var used = {};
      (usedIds() || []).forEach(function (id) { if (id) used[String(id)] = 1; });
      if (!used[c] && !taken[c]) { taken[c] = 1; return c; }
      for (var i = 2; i < 9999; i++) {
        var t = c + '-' + i;
        if (!used[t] && !taken[t]) { taken[t] = 1; return t; }
      }
      var f = c + '-' + Date.now();
      taken[f] = 1;
      return f;
    }

    /* The dates, as data. Returns { seg1, co, seg2, shift } or { err }. Writes nothing. */
    function splitPlan(hostStart, hostEnd, cut, coDur) {
      if (!hostStart || !hostEnd || !cut) return { err: 'This activity has no start and finish to split.' };
      var dur = dayDiff(hostStart, hostEnd) + 1;
      if (dur < 2) return { err: 'A 1-day activity cannot be split — there is no point inside it. Lengthen it, or add the change order as its own activity.' };
      if (cut <= hostStart) return { err: 'Pick a date AFTER the activity starts (' + fmtDate(dstr(hostStart)) + ') — the first part needs at least one day.' };
      if (cut > hostEnd) return { err: 'Pick a date on or before the activity finishes (' + fmtDate(dstr(hostEnd)) + ') — the second part needs at least one day.' };
      var d1 = dayDiff(hostStart, cut);               // days worked before the interruption
      var d2 = dur - d1;                              // the host's remaining days, moved later
      var co = Math.max(1, Math.round(coDur || 1));
      var coStart = cut, coEnd = addDays(coStart, co - 1);
      var s2 = addDays(coEnd, 1), e2 = addDays(s2, d2 - 1);
      return {
        seg1: { start: hostStart, end: addDays(cut, -1), dur: d1 },
        co:   { start: coStart, end: coEnd, dur: co },
        seg2: { start: s2, end: e2, dur: d2 },
        shift: co                                     // how much later the line item now finishes
      };
    }

    /* THE WHOLE EDIT, as data. Returns { hostPatch, coRow } — nothing is written here, so the
       arithmetic can be tested, and PREVIEWED, without a database.

       ⚠️⚠️ ONE LINE ITEM, BY REQUEST. Owner 2026-09-07: *"recently we have a system wherein if a
       change order activity is inserted between a main contract activity a separate line of the
       main contract activity is generated. Now i want to retain the single line-item for the main
       contract activity."* So the host is not cut in two. It keeps its id, its name, its start and
       every one of its own days, and its FINISH MOVES OUT by the change order's duration — the
       same time impact the two-row model produced, carried by one bar. The change order is the
       only row created.
         · the host keeps its own predecessors AND its own successors. Because the row that
           followed it still follows it, THERE IS NOTHING TO RE-POINT. The old model had to send
           every successor to a continuation row or it would start while the second half of the
           work was still going; that whole failure mode leaves with the second row.
         · the CO is linked SS+<days worked before the interruption>, so it sits INSIDE the host's
           bar at the point the work actually stops.
         · the CO stays its own line item, with its own scope_type and ref — it is real scope.
       ⚠️ duration_days is written to MATCH the new span (own days + the change order's), because
       the scheduling engine derives a finish from a duration and would otherwise pull the bar back
       to the old date the next time anything recalculates.
       ⚠️ THE HONEST COST of one line: the date-span-weighted roll-ups (_vsPct and friends weight by
       dayDiff(start,end)+1) now see the host spanning the change order's days too, so that window
       is counted in both rows. Two rows tiled the window exactly and did not. That is the trade for
       a single line item, and it was the owner's call; if it ever matters, weight by duration_days,
       which is still the host's own work plus the gap and is written consistently here. */
    function splitBuild(host, plan, co, taken) {
      co = co || {};
      var coId = freeId(co.ref ? String(co.ref).trim() : ((host.activity_id || 'CO') + '-CO'), taken);
      var lag = plan.seg1.dur;                        // days the host works before the interruption
      var own = plan.seg1.dur + plan.seg2.dur;        // the host's OWN days — unchanged by the variation
      var coRow = {
        activity_id: coId, activity_name: co.name || 'Change order', activity_type: 'Task',
        status: 'Not Started', percent_complete: 0,
        start_date: dstr(plan.co.start), end_date: dstr(plan.co.end), duration_days: plan.co.dur,
        // ⚠️ SS + the days already worked, NOT an FS from the host. Under the two-row model the
        // host was truncated at the cut, so "after the host" was true; with one uncut line an FS
        // link would claim the variation starts after the WHOLE activity finishes — false, and it
        // would slide the change order to the wrong end of the bar on the next recalculation.
        predecessors: host.activity_id ? (String(host.activity_id) + ' SS+' + lag) : null,
        wbs: host.wbs || null, wbs_node_id: host.wbs_node_id || null,
        work_type: host.work_type || null, location: host.location || null,
        phase: host.phase || 'construction',
        scope_type: 'change_order', change_order_ref: co.ref ? String(co.ref).trim() : null
        // No split_group. The change order is its own line item that happens to sit in the gap, and
        // folding it into the host would report its days as main-contract work.
      };
      return {
        hostPatch: { end_date: dstr(plan.seg2.end), duration_days: own + plan.co.dur },
        coRow: coRow,
        // Kept as empty/null so nothing downstream has to learn a new shape: there is no second
        // half to create, no group to renumber and — the point — nothing to re-point.
        segRow: null, renumber: [], repoint: []
      };
    }

    /* Plans a whole run. PURE — returns descriptors and writes nothing, so a preview and the apply
       that follows it cannot disagree about what will happen.
       `cut` is either a Date (the same day for every host, refused where it falls outside) or the
       string 'mid' (each host's own midpoint, which splitPlan guarantees is always valid).
       Every host resolves to exactly one entry, with either `plan`+`build` or `err` — so a preview
       can show refusals rather than a shorter list than the planner selected. */
    function bulkSplitPlan(hosts, coRef, coName, coDur, cut) {
      var taken = {};
      return (hosts || []).map(function (h) {
        var hs = pd(h.start_date), he = pd(h.end_date);
        if (!hs || !he) return { host: h, err: 'No start and finish to split.' };
        /* ⚠️ Already carrying THIS reference -> refused, and named as such. Re-running the insert
           after a partial failure must not give one host the same change order twice; a DIFFERENT
           reference on the host is fine and is not refused, because an activity genuinely can be
           hit by two variations. */
        if (h.change_order_ref && coRef && String(h.change_order_ref).trim() === String(coRef).trim()) {
          return { host: h, err: 'Already cites ' + coRef + '.' };
        }
        var c = (cut === 'mid') ? addDays(hs, Math.max(1, Math.floor((dayDiff(hs, he) + 1) / 2))) : cut;
        var pl = splitPlan(hs, he, c, coDur);
        if (pl.err) return { host: h, err: pl.err };
        var b = splitBuild(h, pl, { name: coName, ref: coRef }, taken);
        return { host: h, plan: pl, build: b };
      });
    }

    return {
      freeId: freeId,
      splitPlan: splitPlan,
      splitBuild: splitBuild,
      bulkSplitPlan: bulkSplitPlan
    };
  }

  return { make: make };
})();
