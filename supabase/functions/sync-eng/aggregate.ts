// Design-progress roll-up — PORTED from the Engineering App's drawing-register
// module (`modules/drawing-register/module.js`).
// -----------------------------------------------------------------------------
// ⚠️ THIS IS A PORT, NOT A REIMPLEMENTATION. Every rule below exists because the
// register hit a real bug without it; the comments name the bug so a "tidy-up"
// here cannot quietly undo one. The paired harness runs THIS file and the
// module's own sliced functions over the same register and requires identical
// output — if you change a rule, that harness fails, which is the point.
//
// Split out of index.ts so it can be tested in isolation (Deno's HTTP entry
// point can't be imported into a plain Node harness).

export type Row = {
  id: string;
  project_id: string;
  parent_id: string | null;
  node_kind: string | null;
  phase: string | null;
  title?: string | null;
  status: string | null;
  no_of_sheets: number | null;
  approved_sheets: number | null;
  planned_approval: string | null;
  actual_approval: string | null;
  is_tracking_unit?: boolean | null;
  track_mode?: string | null;
  submissions?: any;
};

export type Agg = {
  top_level: string;
  basis: "binary" | "sheets";
  percent_complete: number;
  units_total: number;
  units_done: number;
  min_planned: string | null;
  max_planned: string | null;
  max_actual: string | null;
  fallback: boolean;
};

// The four FIXED top levels, in LIFECYCLE order. Anything unrecognised sorts
// after them rather than being dropped — an unclassified top level is a data
// question, and silently discarding its rows would understate progress.
export const TOP_LEVELS = [
  "Concept Design",
  "Schematic Design",
  "For Construction Drawings",
  "Individual Services Drawings",
];

// Only Individual Services Drawings carries partial sheet credit.
const SHEET_MODE_TOPS = new Set(["Individual Services Drawings"]);

const LEGACY_STATUS: Record<string, string> = {
  Ongoing: "In Progress", Pending: "Submitted", Submitted: "Submitted",
  Resubmit: "Resubmit", Cancelled: "Cancelled", "Approved w/o comments": "Approved",
};
const statusOf = (s: string | null) => (s && LEGACY_STATUS[s]) || s || "";
const isApprovedStatus = (s: string) =>
  s === "Approved" || s === "Approved w/o comments" || s === "Approved w/ comments";

// A legacy import sentinel like "2000-01-06" is not a real date and must not win
// a min()/max(). Same guard the register uses.
const validDate = (d: string | null | undefined) => {
  if (!d) return false;
  const y = +String(d).slice(0, 4);
  return y >= 2015 && y <= 2100;
};
const num = (v: any) => { const n = Number(v); return isFinite(n) ? n : 0; };

export function aggregateDrawings(rows: Row[]): Agg[] {
  const byId: Record<string, Row> = {};
  rows.forEach((r) => { byId[r.id] = r; });
  const isNode = (r: Row) => !!r.node_kind && r.node_kind !== "drawing";

  // Three kinds of parent edge share one column, so each has to be told apart by
  // what the PARENT is — not by the mere presence of parent_id. Getting this
  // wrong is the bug that made every drawing count as a sheet in the Engineering
  // App's own dashboard tile.
  const nodeKids: Record<string, Row[]> = {};   // group  → child groups
  const draws: Record<string, Row[]> = {};      // group  → child drawings
  const sheets: Record<string, Row[]> = {};     // drawing→ child sheets
  const roots: Row[] = [];                      // level-1 groups
  const orphanDraws: Row[] = [];                // drawings with no group parent

  rows.forEach((r) => {
    const p = r.parent_id ? byId[r.parent_id] : null;
    if (isNode(r)) {
      if (p && isNode(p)) (nodeKids[p.id] = nodeKids[p.id] || []).push(r);
      else roots.push(r);
      return;
    }
    if (p && isNode(p)) { (draws[p.id] = draws[p.id] || []).push(r); return; }
    if (p) { (sheets[p.id] = sheets[p.id] || []).push(r); return; }
    // ⚠️ A drawing whose group parent is MISSING renders at root upstream rather
    // than vanishing (a queued offline parent_id can replay against a node
    // someone else deleted). It must count here too, or the mirror would report a
    // lower total than the register shows.
    orphanDraws.push(r);
  });

  const hasSheets = (r: Row) => !!(sheets[r.id] && sheets[r.id].length);

  // THE single definition of "how many sheets of this row are approved":
  //   • a row with sheets  → the sum over its sheets
  //   • a single-sheet row → its STATUS is the approval state
  //   • an aggregate row   → its hand-typed count
  function approvedOf(r: Row): number {
    if (hasSheets(r)) return sheets[r.id].reduce((n, k) => n + approvedOf(k), 0);
    if ((num(r.no_of_sheets) || 0) <= 1) return isApprovedStatus(statusOf(r.status)) ? 1 : 0;
    return num(r.approved_sheets) || 0;
  }

  function drawsUnder(n: Row): Row[] {
    let out = (draws[n.id] || []).slice();
    (nodeKids[n.id] || []).forEach((c) => { out = out.concat(drawsUnder(c)); });
    return out;
  }

  // A unit is approved only when EVERY drawing beneath it is approved, and there
  // is at least one: a level row is a promise about a body of work, so it is not
  // partially kept.
  function unitApproved(u: Row): boolean {
    if (!isNode(u)) return isApprovedStatus(statusOf(u.status));
    const list = drawsUnder(u);
    return list.length > 0 && list.every((r) => isApprovedStatus(statusOf(r.status)));
  }

  // The tracking units at or below a node. A flagged node IS the unit, so the
  // walk STOPS there — otherwise a unit would also count its own descendants and
  // the percentages would not sum to 100.
  //
  // ⚠️ The fallback counts leaf DRAWINGS, never sheets. Falling back to sheet
  // counts would give a For Construction drawing with 12 sheets and 7 approved a
  // 58% partial credit, which is precisely what "0 or 100 only" forbids.
  function unitsUnder(n: Row): Row[] {
    if (n.is_tracking_unit) return [n];
    let out: Row[] = [];
    (nodeKids[n.id] || []).forEach((c) => { out = out.concat(unitsUnder(c)); });
    (draws[n.id] || []).forEach((d) => { out.push(d); });
    return out;
  }
  function hasFlaggedUnit(n: Row): boolean {
    return !!n.is_tracking_unit || (nodeKids[n.id] || []).some(hasFlaggedUnit);
  }

  // Fields belonging to the WHOLE drawing, answered by the parent when a sheet
  // carries none — one planned approval date per drawing, status per sheet.
  function inh(r: Row, f: keyof Row): any {
    const v = r[f];
    if (v != null && v !== "") return v;
    const p = r.parent_id ? byId[r.parent_id] : null;
    if (!p) return null;
    const pv = p[f];
    return pv != null && pv !== "" ? pv : null;
  }

  function dates(list: Row[]) {
    let minPlanned: string | null = null, maxPlanned: string | null = null;
    let maxActual: string | null = null, allAppr = list.length > 0;
    let tot = 0, ap = 0;
    list.forEach((r) => {
      const t = num(r.no_of_sheets) || 0, a = approvedOf(r);
      tot += t; ap += a;
      const pl = inh(r, "planned_approval");
      if (validDate(pl)) {
        if (!minPlanned || pl < minPlanned) minPlanned = pl;
        if (!maxPlanned || pl > maxPlanned) maxPlanned = pl;
      }
      const ac = r.actual_approval;
      if (validDate(ac) && (!maxActual || ac > maxActual)) maxActual = ac;
      if (!(t > 0 && a >= t)) allAppr = false;
    });
    // ⚠️ maxActual is reported ONLY once everything is approved. Surfacing it
    // earlier reads as a completion date for work that is still open.
    return { tot, ap, minPlanned, maxPlanned, maxActual: allAppr ? maxActual : null, allAppr };
  }

  // ⚠️ Belt-and-braces fold. Migration 0017 already folded `phase` to the four top
  // levels in the Engineering App, so for a migrated register this is a no-op —
  // but a project that predates it (or a row written by an older client) must not
  // arrive here as its own top level and split the branch into look-alikes:
  // Schematic Design 1 and 2 MERGE; Temporary Works / Combined Services / As-Built
  // fold under For Construction; "(Scheme 2)" is a change order, not a stage.
  //
  // ⚠️ An unrecognised value keeps its RAW name rather than collapsing to
  // "Unassigned" — the migration deliberately refuses to guess at those and
  // reports them, and a name is what makes one actionable.
  const foldTop = (raw: string) => {
    const t = raw.replace(/\s+/g, " ").trim().toLowerCase();
    if (!t) return "Unassigned";
    if (/concept|\becd\b/.test(t)) return "Concept Design";
    if (/individual\s*service|\bisd\b/.test(t)) return "Individual Services Drawings";
    if (/temporary\s*works|\btw[dg]\b/.test(t)) return "For Construction Drawings";
    if (/combined\s*service|\bcsd\b/.test(t)) return "For Construction Drawings";
    if (/as[- ]?built|\babd\b/.test(t)) return "For Construction Drawings";
    if (/schematic|scheme|\bsd[12]?\b/.test(t)) return "Schematic Design";
    if (/construction|contract|\bfcd\b/.test(t)) return "For Construction Drawings";
    return raw.trim();
  };
  const topName = (r: Row) => foldTop(String(r.phase || r.title || ""));
  const modeOf = (top: string, sample: Row | undefined): "binary" | "sheets" => {
    // The stored copy wins (every row carries one after migration 0017);
    // otherwise derive from the top level's NAME, so an un-migrated row still
    // behaves correctly instead of defaulting to partial credit.
    if (sample && sample.track_mode === "sheets") return "sheets";
    if (sample && sample.track_mode === "binary") return "binary";
    return SHEET_MODE_TOPS.has(top) ? "sheets" : "binary";
  };

  // Group the level-1 nodes AND the orphan drawings by top-level name. Several
  // root nodes can share a name (one per project scope), so they merge.
  const groups: Record<string, { nodes: Row[]; loose: Row[] }> = {};
  const bucket = (k: string) => (groups[k] = groups[k] || { nodes: [], loose: [] });
  roots.forEach((n) => { bucket(topName(n)).nodes.push(n); });
  orphanDraws.forEach((d) => { bucket(topName(d)).loose.push(d); });

  const out: Agg[] = [];
  Object.keys(groups).forEach((top) => {
    const g = groups[top];
    let all: Row[] = g.loose.slice();
    g.nodes.forEach((n) => { all = all.concat(drawsUnder(n)); });
    if (!all.length) return;                        // an empty top level is not progress
    const d = dates(all);
    const basis = modeOf(top, all[0] || g.nodes[0]);

    let unitsTotal: number, unitsDone: number, fallback = false;
    if (basis === "sheets") {
      unitsTotal = d.tot; unitsDone = d.ap;
    } else {
      let units: Row[] = g.loose.slice();           // a loose drawing is its own unit
      g.nodes.forEach((n) => { units = units.concat(unitsUnder(n)); });
      unitsTotal = units.length;
      unitsDone = units.filter(unitApproved).length;
      fallback = !g.nodes.some(hasFlaggedUnit);
    }
    out.push({
      top_level: top, basis,
      percent_complete: unitsTotal ? Math.round((unitsDone / unitsTotal) * 100) : 0,
      units_total: unitsTotal, units_done: unitsDone,
      min_planned: d.minPlanned, max_planned: d.maxPlanned,
      max_actual: basis === "sheets" ? d.maxActual
                                     : (unitsTotal > 0 && unitsDone >= unitsTotal ? d.maxActual : null),
      fallback,
    });
  });

  return out.sort((a, b) => {
    const ia = TOP_LEVELS.indexOf(a.top_level), ib = TOP_LEVELS.indexOf(b.top_level);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.top_level.localeCompare(b.top_level);
  });
}

// Material submittals are counted as ITEMS — a different thing from sheets, which
// is why they stay a separate branch rather than being blended into one total.
export function aggregateSubmittals(rows: any[]): Agg[] {
  const byDisc: Record<string, any[]> = {};
  rows.forEach((r) => {
    const k = (r.discipline || "").trim() || "Unassigned";
    (byDisc[k] = byDisc[k] || []).push(r);
  });
  return Object.keys(byDisc).sort().map((k) => {
    const list = byDisc[k];
    const done = list.filter((r) =>
      isApprovedStatus(statusOf(r.status)) || statusOf(r.status) === "Approved w/ Comments").length;
    let minPlanned: string | null = null, maxPlanned: string | null = null, maxActual: string | null = null;
    list.forEach((r) => {
      const pl = r.plan_approval_date;
      if (validDate(pl)) {
        if (!minPlanned || pl < minPlanned) minPlanned = pl;
        if (!maxPlanned || pl > maxPlanned) maxPlanned = pl;
      }
      const ac = r.date_approved;
      if (validDate(ac) && (!maxActual || ac > maxActual)) maxActual = ac;
    });
    return {
      top_level: k, basis: "sheets" as const,
      percent_complete: list.length ? Math.round((done / list.length) * 100) : 0,
      units_total: list.length, units_done: done,
      min_planned: minPlanned, max_planned: maxPlanned,
      max_actual: done >= list.length ? maxActual : null,
      fallback: false,
    };
  });
}
