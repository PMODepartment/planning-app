# Proposal — a management-level Project Dashboard (per project)

**Status:** proposal, not built. Owner decision needed — see [What this needs from the app
owner](#what-this-needs-from-the-app-owner).
**Author:** planning team (project-schedule module) · 2026-08-21
**Scope:** one project at a time. Portfolio roll-up is out of scope here (that is
`portfolio-overview`), and package-level scoping follows roadmap A3.

---

## 1. What the dashboard does today, and why it is not a management view

`dashboard.html` (roadmap A4/A5) shows four project KPIs, the Packages panel, and one tile per
module. Each tile reports **a row count**, an optional "needs attention" count, and last-updated —
read through `PDb.moduleSummary` from the `dash` spec each module declares in `config.js`. The shell
never reaches into a module's tables, which is the right architecture and should not change.

The limitation is what a count can say. Today a director opening Bauhinia Residences sees:

```
Project Schedule & Cost Loading      500 activities · updated Aug 21, 2026
Risk Register                        0 risks 0 open
Cash Flow                            0 periods
```

**"500 activities" is not a status.** It does not say whether the project is late, by how much, what
it will cost, or what needs a decision this week. Every tile answers "how much data is in this
module?" when management is asking "how is the project doing, and what do I need to act on?"

Worse, the four header KPIs are mostly empty on this project (`—` for budget, forecast start,
forecast finish, location) because they read the *project record*, which nobody fills in, rather
than the *schedule*, which is maintained daily and already knows the forecast finish.

---

## 2. What a management dashboard should answer

Four questions, in this order. Everything below is arranged to answer them and nothing else.

1. **Are we going to finish on time?**
2. **Are we going to finish on budget?**
3. **Are we where we said we would be right now?**
4. **What is going to hurt us, and what needs a decision this week?**

---

## 3. Proposed layout

### Band 1 — Four status cards (replacing the four data-less KPIs)

Each card carries a number, a direction, and the basis it was measured against. A card with no
basis says so rather than showing a zero.

| Card | Number | Basis | Source |
|---|---|---|---|
| **Time** | forecast finish, and days early/late | vs baseline finish; vs contract date if set | `project-schedule` |
| **Cost** | forecast at completion (EAC) vs budget | vs `planned_cost` roll-up | `project-schedule` cost loading, `cash-flow` |
| **Progress** | actual % vs planned % as at the data date | duration-weighted, execution phase | `project-schedule`, `s-curve` |
| **Exposure** | open high risks · open issues · live claims | counts, each with its own link | `risk-register`, `issues-lessons`, `contracts-claims` |

⚠️ **Every card states its data date.** A "12 days late" on a schedule last updated six weeks ago is
worse than no number, because it will be trusted. The card shows *"as at 21-Aug-26"* and greys
itself when the data date is more than N days old.

⚠️ **A card with no baseline shows "no baseline captured", not 0%.** This was settled once already in
the schedule module: Planned Value % is deliberately blank until a baseline exists, because measuring
the schedule against itself reports zero variance on a project that has never committed to anything.
The dashboard must hold the same line — the empty state is the finding.

### Band 2 — One chart, not six

**The S-curve: planned vs actual cumulative progress, with the data date marked.** It is the one
picture that answers questions 1 and 3 together, and it is the chart every progress meeting already
runs on. Cash flow in/out by period sits beside it as a second, smaller line.

Nothing else belongs in this band. A dashboard with six charts is read as decoration.

### Band 3 — Decisions waiting on someone

A single list, newest-pressure-first, mixing sources — because management does not think in modules:

- critical-path activities **already late** or due inside the look-ahead window
- top risks by exposure (probability × impact), open only
- claims by value and age, unresolved
- issues open past their target date

Each line links straight into the module row that owns it.

### Band 4 — Data confidence

The panel nobody builds and everybody needs, because **every number above is only as good as this**:

- schedule data date, and its age
- baseline: captured or not, and how many activities lack one
- activities with no trade, no WBS node, or an orphan WBS code
- modules with no data at all (so an empty Exposure card reads as "not being used" rather than "no risks")

This is not padding. Every item on that list is a defect class that has actually produced a wrong
number in this app — orphan WBS codes broke the roll-ups, a missing baseline emptied Planned Value %,
un-tagged activities broke the trade grouping. A director reading a green dashboard deserves to know
how much of it rests on activities that carry no baseline, or sit under a WBS code that matches no
branch. The figures are per project and already computable; this panel just stops them being
invisible.

### Per package

Once A3 lands, each band takes a package selector, defaulting to the whole project. The bands do not
change shape — only the filter behind them.

---

## 4. What this needs from the app owner

I cannot build this from inside a module, and I should not try. Per `MODULE_CONTRACT.md` §1 a module
may not edit files outside its own folder. This proposal touches three shared files:

| File | Change | Why it cannot be avoided |
|---|---|---|
| `assets/js/db.js` | extend the `dash` contract beyond count/attention/updated | `moduleSummary` can only COUNT rows. It cannot express "SPI 0.87", "42 days late" or "EAC vs budget". |
| `assets/js/config.js` | richer `dash` specs per module | each module must keep declaring its own figures — the shell must not learn any module's tables |
| `dashboard.html` | the four bands above | the page itself |

**The mechanism I would propose** — and the part worth deciding before any pixels: keep A5's
principle exactly (*the shell reads only what the module published*) and extend it from a **count
spec** to a **published-summary spec**. Two candidate shapes:

- **(a) A summary view per module.** Each module owns a SQL view (`<module>_dashboard`) returning one
  row per project with named, already-computed figures. The shell selects one row and renders
  whatever it finds. Modules stay in control; the shell stays ignorant; no cross-module queries.
- **(b) A summary row written by the module.** Each module writes its own figures into a shared
  `module_dashboard` table when its data changes. Faster to read, but it is a cache — and a cache
  that can go stale is exactly the class of bug this app keeps relearning (a stored label drifting
  from the mechanism it describes).

**I would recommend (a).** It cannot go stale, because it is computed on read. (b) buys speed we have
no evidence of needing, at the cost of a staleness failure mode that reads as a wrong number rather
than a slow one.

---

## 5. What I would deliberately leave out

- **Percent-complete gauges per module.** Most modules have no meaningful denominator; a gauge would
  invent one.
- **A "project health score".** One number blending time, cost and risk hides which of the three is
  wrong, which is the only actionable part. The four cards say it plainly instead.
- **Anything from Drawing Register or Material Submittal Log.** Both moved to the Engineering App;
  their tiles correctly read "Moved to". Surfacing their figures here would re-fork data that has
  deliberately been consolidated elsewhere.
- **Editing.** The dashboard is read-and-navigate. Every figure links to the module that owns it, and
  that is where it gets changed.

---

## 6. Suggested sequence

1. Owner decides on the summary mechanism — (a) or (b) above. Everything else waits on this.
2. Band 1 + Band 4 (status and data confidence). Highest value, and Band 4 makes Band 1 trustworthy.
3. Band 2 (S-curve) once `s-curve` publishes a summary.
4. Band 3 (decisions) — needs `risk-register`, `issues-lessons` and `contracts-claims` publishing
   theirs.
5. Package selector after A3.

The project-schedule module can publish its half of Band 1 and Band 4 as soon as the mechanism is
agreed — the figures (forecast finish, SPI, EAC, duration-weighted POC, baseline coverage, orphan
codes, un-tagged activities) are all already computed inside it for the Cockpit and the Diagnose
report.
