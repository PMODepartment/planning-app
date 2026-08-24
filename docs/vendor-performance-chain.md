# Vendor Performance Chain — schedule → package → procurement → vendor → schedule

Captured 2026-08-24. Design note + roadmap for connecting **Vendor Management** (WPM app)
to the **Project Schedule** (Planners app), so a PM can see per-vendor S-curves, monthly
accomplishment, and which vendors are on track vs. problematic — and so vendor history
becomes the basis of internal schedules.

---

## 1. The chain as it stands today

Five links. **Four are built.** One is missing, and it is the same one every time.

| # | Link | Where it lives | State |
|---|------|----------------|-------|
| 1 | **Schedule building** — WBS + activities, durations, calendars, baselines | `project_schedule`, `wbs_nodes`, `calendars` | ✅ built |
| 2 | **Packaging the works** — which contract lot a line of work belongs to | `packages` + `project_schedule.package_id` (`migrations/2026-08-19-packages.sql`, `…-schedule-package.sql`) | ✅ built |
| 3 | **Package → procurement** — the schedule activity points at a WPM work package; the need-by date is pushed back to the buyer | `project_schedule.work_package` = WPM `work_packages.wp_no`; `wpm_work_packages` mirror; `push-need-by` → `planners_need_by` | ✅ built (ROADMAP E1/E2) |
| 4 | **Procurement → vendor** — who was actually awarded the package | WPM: `work_packages.vendor_id`, `awarded_vendor_ids[]`, `awarded_vendor_amounts[]`, `vendors`, `vendor_rates` | ✅ built **in WPM only** |
| 5 | **Vendor → schedule performance** — vendor S-curve, monthly accomplishment, on-track/problem flag | — | ❌ **does not exist** |

### The missing link, stated precisely

**The Planners app has no concept of a vendor.** Verified: zero occurrences of `vendor`
across `migrations/` and every `modules/*/index.html`. Concretely:

- `wpm_work_packages` (the mirror) copies budget, dates, trade, award/procurement/delivery
  status — **but not `vendor_id`, not `awarded_vendor_ids`, not the `contractor` name.**
  So the schedule knows an activity belongs to WP-147, and knows WP-147's award status,
  but not *who* is building it.
- `productivity_activities.subcontractor` is **free text** (AFCSC, JM2, CEC, GeoExpert —
  typed, or scraped off a workbook sheet label). It is the *only* place in the whole
  Planners suite that names a vendor, and it cannot be joined to anything.

Everything in link 5 falls out almost mechanically once that one link is closed — because
the aggregation machinery already exists and is already parameterised the right way.

### Why the machinery is already there

`schedule_scurve_agg_multi()` (`migrations/2026-07-20-schedule-scurve-agg.sql`) does the
per-activity × per-month spread server-side and returns duration- **and** cost-weighted
cumulative **planned + actual** curves. It already reads `percent_complete`, `actual_start`,
`actual_finish`, `planned_cost`/`bl_cost`.

**A vendor S-curve is that same function with a different `where` clause.** Filter the leaf
set to activities whose `work_package` resolves to a WP awarded to vendor V, and the existing
SQL produces the vendor's planned vs. actual curve with no new maths. Monthly accomplishment
is the first difference of that curve — the Cash Flow module already consumes ΔS-curve% this
way.

---

## 2. Why productivity-rates is the right starting point

Agreed, and for a sharper reason than "it mentions subcontractors."

The suite currently has **two unrelated notions of vendor progress**, and they need
reconciling before anything is built on top:

| | Productivity Monitoring | Schedule S-curve |
|---|---|---|
| Unit | **physical** — kg, m³, m², pcs installed per month | **weighted %** — duration- or cost-weighted |
| Source | site-reported, manually entered / Excel-imported | planner-maintained `percent_complete` + actual dates |
| Granularity | trade × month | activity × day |
| Vendor | free-text `subcontractor` | none |

A PM asking "is AFCSC on track?" is asking a question these two answer *differently*, and
today neither can be attributed to a vendor entity. Productivity Monitoring is the better
first move because:

1. **It is the only module that already carries a vendor name** — giving it a real
   `vendor_id` is the smallest change that creates the vendor entity in Planners, and it
   immediately makes the existing 13 trades / 307 monthly entries queryable by vendor.
2. **It holds the physical accomplishment the schedule does not.** `project_schedule` has
   `planned_labor_units` / `actual_labor_units` but **no quantity or unit column** — so a
   productivity rate can only come from this module.
3. **It closes the loop back to schedule building.** `rate = output ÷ (resource × work_days)`
   inverted gives `duration = qty ÷ (rate × crew)`. A vendor's *own historical rate* is what
   makes an internal schedule defensible instead of assumed — this is the "basis of internal
   schedules" ask, and it is a query over data this module already stores.

Its one structural gap: **productivity activities are not linked to schedule activities or
work packages either.** So it can tell you AFCSC laid 45 t of rebar in July; it cannot tell
you whether that was the 62 t the schedule needed.

---

## 3. Roadmap — Section F

Sequenced so every phase is independently useful. F1 is the enabling migration; nothing
downstream works without it.

### F1. Vendor identity in the Planners app  ← start here
Mirror the vendor, don't re-key it.

- Extend the `sync-wpm` Edge Function to copy `vendor_id`, `awarded_vendor_ids[]`,
  `awarded_vendor_amounts[]` and the display `contractor` string onto `wpm_work_packages`.
  Dates and status already come across; this is additive to the same upsert.
- New mirror table `wpm_vendors` (id, name, trade_categories, accreditation, status,
  synced_at), populated by the same function from WPM `vendors`.
  - ⚠️ **Mirror, never a live browser read** — WPM's anon key is public and its vendor table
    sits alongside `vendor_rates`. Same rule E1 established for budgets.
  - ⚠️ **Names and trades only — no rates, no contacts.** Vendor commercial data stays in WPM.
- `productivity_activities.vendor_id uuid` (nullable) + a picker reading `wpm_vendors`.
  Keep the free-text `subcontractor` untouched as the legacy/display fallback, exactly as
  E2 kept unresolvable `work_package` values visible rather than blanking them.
- Migrations: `2026-08-2x-wpm-vendors-mirror.sql`, `2026-08-2x-productivity-vendor-link.sql`.

**Deliverable:** "Vendor" becomes a filter/group dimension in Productivity Monitoring.

### F2. Productivity activity → work package / schedule activity
- `productivity_activities.work_package text` (a WPM `wp_no` — same key and same picker the
  schedule uses), and/or `wbs_node_id` for a scope-level link.
- Reconciliation view: **planned qty (schedule/BOQ) vs. actual qty (productivity), per trade
  per month.**
- ⚠️ Blocked on a real gap: `project_schedule` has **no `quantity` / `unit` column**. Either
  add one (`2026-08-2x-schedule-activity-quantity.sql`) or source planned quantity from the
  Contracts & Claims BOQ (ROADMAP B1). **Main open decision — see §4.1.**

### F3. Vendor S-curve
- `schedule_scurve_agg_vendor(p_project_id text, p_vendor_id uuid)` — the existing
  `schedule_scurve_agg_multi` body with the leaf CTE filtered through
  `work_package → wpm_work_packages → vendor_id / awarded_vendor_ids`.
  Keep `security invoker` so project RLS still applies.
- Render in the **s-curve module** with a vendor selector: planned vs. actual vs. baseline,
  one curve per vendor, plus an all-vendors overlay.
- The physical-quantity curve from productivity entries is a **second, separately-labelled
  series** — never averaged into the weighted one. They measure different things, and merging
  them produces a number nobody can defend in a progress meeting.

### F4. Monthly accomplishment + on-track / problem flags
- Monthly accomplishment = Δ cumulative % per month, per vendor (planned vs. actual), against
  the schedule's shared **data date** (`ps_datadate_<pid>` — the key Cash Flow already reuses).
- Per-vendor status **derived, never stored** (the suite's standing rule):
  - **SPI-style ratio** — actual cum % ÷ planned cum % at the data date.
  - **Slip days** — Σ (actual_finish − bl_finish) over the vendor's completed activities;
    forecast slip on in-progress ones.
  - **Trend** — sign of the last 3 months of Δ variance, so a recovering vendor and a
    deteriorating one at the same SPI don't read identically.
- Thresholds live in the existing `schedule_thresholds` table
  (`2026-07-07-schedule-thresholds.sql`) rather than being hard-coded.

### F5. Vendor scorecard
One page per vendor, across projects: S-curve, monthly accomplishment, slip history,
productivity rate vs. peer average for the same trade, packages awarded, and need-by
adherence (`planners_need_by` vs. actual delivery). Portfolio-level ranking by trade.

### F6. Basis of internal schedules — the loop closes
- **Rate library:** `productivity_entries` aggregated to vendor × trade × unit → a defensible
  historical rate, with sample size and date range attached.
- **Schedule builder integration:** when a planner adds an activity with a quantity and a
  trade, offer `duration = qty ÷ (rate × crew size)` from that library — the vendor's own
  history when a vendor is assigned, the trade average otherwise — and say plainly which one
  it used and on how many months of data.
- Feeds the existing **duration scenarios** work (`2026-08-19-duration-scenarios-and-mom.sql`):
  best/likely/worst from the rate distribution instead of typed percentages.

---

## 4. Open decisions

1. **Where does planned quantity come from?** (blocks F2/F6)
   Add `quantity`/`unit` to `project_schedule`, or source it from the Contracts & Claims BOQ
   (ROADMAP B1) and link BOQ item → activity. The second is more correct and more work; the
   first is available now and risks a third place quantities live.
2. **Co-awarded packages.** `awarded_vendor_ids[]` is an array. When two vendors share WP-147,
   is progress split by `awarded_vendor_amounts[]`, attributed to the primary `vendor_id`, or
   counted for both (double-counting the total)? **Recommendation:** attribute to the primary
   for the S-curve and show co-awardees on the scorecard, until a real co-award appears that
   needs a split.
3. **Vendor S-curve weighting.** Duration-weighted (available everywhere) or cost-weighted
   (needs `planned_cost`, and procurement cost is deliberately kept off schedule rows — E1).
   **Recommendation:** duration-weighted, with the same switcher Cash Flow exposes, defaulting
   to duration.
4. **Cross-project vendor rollup (F5)** means reading many projects' schedules at once.
   `schedule_scurve_agg_multi` already takes `text[]` and stays `security invoker`, so RLS
   holds — but follow the portfolio RPC pattern (`2026-07-11-portfolio-resource-rpc.sql`)
   rather than looping in the browser.

---

## 5. Sequencing

```
F1 (vendor identity) ──┬─→ F3 (vendor S-curve) ─→ F4 (accomplishment + flags) ─→ F5 (scorecard)
                       │
                       └─→ F2 (productivity ↔ WP link) ─→ F6 (rate library → durations)
                                   ▲
                       B1 (BOQ) ───┘   or   schedule quantity column
```

F1 is small, unblocks both branches, and is worth doing before anything else is designed in
detail. F3 is the fastest visible win after it — the SQL already exists.
