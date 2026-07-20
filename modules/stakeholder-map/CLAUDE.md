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

## What it does — Megawide corporate-BD methodology
Rebuilt to match the real **"CORP. BD TCD. Stakeholder Map 2026.xlsx"** (BD Map /
TCD Map + Stakeholder Analysis Guide). Kept **project-scoped** per the contract
(the corporate/SBU grouping in the file — BD/TCD — is out of scope; this is one
map per project). Two topbar views (same chrome as risk-register):

- **Register (list):** identity + contact + both derived analyses per row
  (Name/nickname, Sector, Group, Institution, Position, Impact, Interest,
  Importance pill, Approach, Current→Target relationship, Strategy, Frequency,
  Primary Responsible). Filters: Sector / Group / Importance / search + Clear.
- **Impact / Interest:** a **4×4 grid** (rows = Impact 4→1, cols = Interest 1→4,
  matching the Guide's Table 3), cells colored by Importance rank and holding the
  stakeholders in each cell; click a cell to filter the register.
- **Add/Edit modal:** sectioned (Identity / Contact / Analysis / Relationship /
  Ownership & notes); the derived Importance+Approach and Strategy+Frequency
  update **live** as the 1–4 ratings change. Rating dropdowns carry the Guide's
  descriptors.

## Two derivation chains — DERIVED, never stored
Both are pure functions of the stored 1–4 ratings, so they are computed in-app and
never persisted (storing would only let them drift — same principle as
risk-register's rating and issues-lessons' aging).

1. **Impact (1–4) × Interest (1–4) → Importance (1st–4th) → Engagement Approach.**
   Grid `IMP_GRID` transcribed verbatim from the Guide "Table 3". Approach:
   `1st=Manage Closely, 2nd=Keep Satisfied, 3rd=Keep Informed, 4th=Monitor`.
2. **Gap = Target − Current relationship → Engagement Strategy → Min Frequency.**
   `gap 2–3 = Catch up, 1 = Enhance, 0 = Maintain` (negative → N/A).
   Frequency `Catch up=Monthly, Enhance=Every two months, Maintain=Quarterly`.

### ⚠️ Workbook self-discrepancy (resolved to the live formula)
The **Guide sheet** (Table 5) says `Maintain=Semi-annually` and `Enhance=Quarterly`,
but the **live cell formula** (column S, which the data actually reflects) says
`Catch up=Monthly, Enhance=Every two months, Maintain=Quarterly`. We follow the
**live formula** (source of truth); the Guide sheet is stale. `freqOf()` documents this.

## DB — migration `2026-07-20-stakeholder-map-full.sql` (USER MUST RUN)
Add-only + idempotent; folded into `supabase-schema.sql` + `supabase-setup.sql`.
Reuses starter columns for their natural match (no dead duplicates):
`category`=Sector, `organization`=Institution, `role_title`=Position,
**`influence`=Impact 1–4**, `interest`=Interest 1–4 (both stored as text '1'..'4'),
`engagement`=free-text notes. Adds `stakeholder_group, title, nickname, birthday,
email, current_rel, target_rel, primary_responsible, alternate, gift_tier` + a
`(project_id, name)` index. Load/save show a "run the migration" toast until it's applied.

No storage bucket (no file uploads). No external app to import from — starts empty
(owner's choice). No shared JS/CSS asset touched, so **no `?v` bump**.

## Verified (stubbed harness, real module.js/css, DOM inspection)
Both chains exact against the workbook (Impact×Interest→Importance→Approach and
gap→Strategy→Frequency for all rating combos incl. unrated=blank), KPIs (Manage 2 /
Satisfy 1 / Catch-up 2 on the fixture), 4×4 grid placement, importance & cell-click
filters, live in-form derivation, add/save (`created_by` stamped, derived fields NOT
persisted), wide table scrolls inside its card (no page h-scroll), grid view no
h-scroll, dark-mode tokens with fixed semantic rank colors. No console errors.
