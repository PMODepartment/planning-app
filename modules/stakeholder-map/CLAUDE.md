# Module: stakeholder-map

Developer change log for the **Stakeholder Map** module. Update this every PR.

## Status
- [x] Read MODULE_CONTRACT.md + CONTRIBUTING.md
- [x] Copied a reference module as the starting point (risk-register)
- [x] CRUD implemented (add / edit / view / list / delete)
- [x] Project-scoped via `pd_project`; `created_by` + `project_id` stamped
- [x] `Fmt.esc()` on all user text injected into HTML
- [x] `enabled: true` set in `assets/js/config.js`
- [ ] PR opened into `main`

## What it does
Project-scoped stakeholder register + the classic PMI **Power–Interest grid**.
Two topbar views (segmented tabs, same chrome as risk-register):
- **Register (list):** filterable table (category / influence / interest / search
  + a Clear-filters ghost that only shows when a filter is set), KPIs
  (Stakeholders / Manage Closely / Keep Satisfied / High influence), a colored
  engagement-strategy pill per row.
- **Influence / Interest:** a 3×3 grid — rows = Influence (High→Low), columns =
  Interest (Low→High) — each cell colored by its engagement quadrant and holding
  the stakeholders that fall in it (name chips, +N more). Click a cell to jump to
  the Register filtered to that Influence×Interest combination.
- **Add/Edit modal:** name / organization / role / category / influence /
  interest / contact / engagement notes, with the **Strategy field derived live**
  as the influence & interest dropdowns change.

## Key design decision — strategy is DERIVED, never stored
The engagement **strategy** (Manage Closely / Keep Satisfied / Keep Informed /
Monitor) is a pure function of influence × interest, computed in-app by
`strategy()`. It is **not** persisted — storing it would only let it drift out of
sync with the two fields it depends on. The `engagement` column stays free-text
(the plan / notes). This mirrors risk-register's derived-rating pattern, minus the
storage (same reasoning as the issues-lessons "days aging" derived field).

**Quadrant rule (documented threshold):** "high side" = the **High** band only;
**Medium is treated as not-high**, so only genuinely high-power/high-interest
stakeholders land in the demanding quadrants.
- Influence High + Interest High → **Manage Closely** (red)
- Influence High + Interest ≠ High → **Keep Satisfied** (amber)
- Influence ≠ High + Interest High → **Keep Informed** (blue)
- otherwise → **Monitor** (gray)

## Notes
- Uses the `stakeholder_map` columns from `supabase-schema.sql` **as-is**
  (name, organization, role_title, category, influence, interest, contact,
  engagement) — **no schema change / migration needed**.
- No file uploads, so no Storage bucket.
- No external app to mirror — built from suite conventions (reference:
  risk-register). Shared topbar chrome block copied verbatim per the guardrail.
- Verified in a stubbed harness (real module.js + module.css, mutable in-memory
  store, DOM inspection since the compositor stalls screenshots in this env):
  KPIs, strategy derivation, all 7 seed stakeholders placed in the correct grid
  cells, cell-click→filter, search, Clear, add/save round-trip (`created_by`
  stamped, strategy not persisted), no page h-scroll, dark-mode tokens.
