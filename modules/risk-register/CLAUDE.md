# Module: risk-register

## Rebuilt as an EPC Risk & Control Matrix (2026-09-01) — fmlozano
Rebuilt against **`SLN101. OPS. Risk Register. 2025 07 01.xlsx`**. The register is no longer a flat
CRUD table: it is the workbook's **RCM**, banded Identification → Assessment → Response → Residual →
Audit Plan, grouped by the **5-PMLC activity** each risk is registered against.

**Four views** (was Register + Risk Matrix): **Register** (26 columns behind 5 toggleable band
groups, `rr_bands`, collapsible activity groups) · **Heat Map** (5×5, replaces `matrix`) · **Risk
Universe** (the 10×29 taxonomy with this project's counts, zero-count branches flagged — the point of
the view is blind spots) · **Criteria** (the workbook's own rating tables).

⚠️ **`?rr_view=matrix` is a RETIRED view name.** `switchView` maps it to `heat` and anything else
unrecognised to `list`. Without that a bookmark carrying the old hash hides all four panes and renders
a **blank page with no error** — verified in a browser before and after.

**Derived, never stored:** importance (impact × likelihood), priority (`EPCRCM.riskPriority`, a 5×5
**lookup** — see below), residual score + band. ⚠️ **`rating` IS still written**, solely to keep the
pre-existing dashboard tile working; it is the one exception and it is commented as such.

⚠️ **Priority is a LOOKUP, not a band on the product.** A product of 4 is answered three ways by the
sheet: impact 2 × probability 2 → 4th, impact 1 × probability 4 → 3rd, impact 4 × probability 1 → 3rd.
A threshold on impact × probability would be wrong. Asserted in `test-rcm.js`.

**Shared engine `assets/js/epc-rcm.js`** — the vocabulary, the scales, the grids and the Control
Masterlist, used by this module *and* stakeholder-map. Transcribing them twice would guarantee drift.

**Migration `../../migrations/2026-09-01-risk-register-rcm.sql` (USER MUST RUN)** — add-only,
idempotent: 22 columns + an activity index. No storage bucket.
⚠️ Supersedes this file's old claims that the module needed *no schema change* and had *no bucket*.

**Verified:** `node modules/risk-register/test-rcm.js` — **146 checks**, executing the shipped
functions (sliced by brace matching, never reimplemented), asserting both grids against **the
workbooks' own computed output** (13/13 risk pairs, 7/7 stakeholder pairs). ⚠️ The suite **bites**:
transposing `STK_GRID` to the risk workbook's table fails 4. Driven in a browser: 0 console errors,
the retired hash rendering the Heat Map, heat-map click-to-filter, 33 zero-count universe branches.
⚠️ **Not verified signed in; the migration has not been run.** ⚠️ **No geometry or contrast measured**
— the Browser pane was not compositing (`visibilityState: hidden`, `innerWidth: 0`), so every layout
number it reports is void. Do not read its `pageHScroll` as a defect.

## Live collaboration + offline (Phase 1 & 2) (2026-07-26) — fmlozano
Wired PDCollab (Realtime) + PDSync (offline). Modal-edit register → **row-level cursor**: `openForm`
calls `wireModalCursor(m, r)` which broadcasts "editing this row" (cleared on cancel/save/backdrop);
`paintRemote()` (end of `render()`) flags that row for others; presence avatars in `#rr-presence`;
`applyRemoteChange` patches `rows` from postgres_changes. **Offline:** the edit path routes through
`PDSync.write` (insert stays online) + a read-cache (`rr:<pid>`). Realtime migration
`../../migrations/2026-07-26-realtime-collab-registers.sql` (USER MUST RUN) covers the live-value stream.
Verified `node --check`; not browser-verified. Assets `offline.js`/`collab.js` + `module.js?v=20260726a`.
This is the reference wiring the other four registers copied.

Developer change log for the **risk-register** module. This is also the
**reference module** other developers copy. Update this every PR.

## Status
- [x] Schema table reviewed in `supabase-schema.sql` (`risk_register`)
- [x] CRUD implemented (add / edit / delete / list)
- [x] `enabled: true` set in `assets/js/config.js`

## What it does
- Project-scoped risk register (reads/writes `pd_project` shared context).
- **List view:** filterable table (status, category, search) with colored
  rating pills, KPIs (Total / Open / High / Medium).
- **Matrix view:** 5×5 Likelihood × Impact heat grid; click a cell to filter
  the register to that L×I combination.
- **Add/Edit modal:** full form; `rating` is **derived in the app**
  (`likelihood × impact`, 1–25) and shown live as the dropdowns change.
- Rating bands: Low 1–7 (green), Medium 8–14 (amber), High 15–25 (red).

## Patterns it demonstrates (for other modules)
- Shared `AppAuth.requireLogin` + `UI.renderUserBar`.
- Project picker bound to `sessionStorage['pd_project']`.
- All queries scoped `.eq('project_id', pid)`.
- `created_by = profile.id` stamped on insert (required by RLS).
- `Fmt.esc()` on every user value injected into HTML.
- A computed/derived field saved alongside raw inputs.

## Notes
- Uses the `risk_register` columns from `supabase-schema.sql` as-is; no schema
  changes were needed.
- No file uploads, so no Storage bucket for this module.
