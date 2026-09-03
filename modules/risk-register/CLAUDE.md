# Module: risk-register

## EPC → MCC finished: the file, the global and the captions (2026-09-02f) — fmlozano

Owner: *"Finish the EPC → MCC rename."* The 2026-09-01 pass renamed the two view **headings** and
flagged the rest as too wide to do in passing — *"the module, its global and 40-odd CSS classes"*.

⚠️ **That estimate was wrong, and checking is what shrank it.** The 40-odd classes are `.rcm-*`
(Risk and Control Matrix) and **never said EPC**, so they need nothing. The real surface was
**11 references across 4 files** plus two file names:

- `assets/js/epc-rcm.js` → `assets/js/mcc-rcm.js`, `window.EPCRCM` → `window.MCCRCM`
- `assets/css/epc-rcm.css` → `assets/css/mcc-rcm.css`
- the rendered caption `EPC Control Masterlist` → `MCC Control Masterlist` (the parallel of the
  Universe heading renamed last pass, and it had been missed)
- both registers' `index.html`, `module.js` and `module.css` pointers, and the test suite

⚠️ **WHAT WAS DELIBERATELY LEFT SAYING EPC, and this is the point of the change rather than an
omission.** Activity 16 is literally named **"EPC FUNCTIONAL MEETINGS"** in the source workbook, the
sheet is called **"EPC Project Risk Categorization"**, and two activity descriptions quote the
workbook's own wording. Those strings are **data, not labels** — the suite asserts the activity names,
and rewriting them would make this file disagree with the register it was transcribed from. The
distinction is now written into the engine's header so the next pass does not "finish the job".

⚠️ **No `window.EPCRCM` alias was left behind.** A stale `module.js` calling `EPCRCM` against a fresh
`mcc-rcm.js` would throw on first use — exactly the failure this repo has mis-diagnosed as a code bug
before. It cannot happen: `index.html` names the `?v=` of **both** files, so a browser holding an old
`index.html` holds an old pair, and one holding the new one gets the new pair. Nothing can mix, so an
alias would be dead code that only hides the next mistake.

**Verified: 163 checks pass** (unchanged — the suite loads the shipped engine by path and asserts both
registers link it, so a half-done rename would have failed it). Zero `epc-rcm` / `EPCRCM` references
remain outside that one explanatory comment.

Shared files → `?v=20260902a`; both `module.js` + `module.css` → `?v=20260902a`; `MODULE_V` → `20260902f`.

---

## Live audit, out-of-app browser (2026-09-01) — fmlozano

Verified on the **deployed** site in the owner's signed-in Chrome, against **real legacy rows** written
by the pre-RCM module. Read-only; nothing written. Both 2026-09-01 migrations confirmed applied
(every new column resolves; an invented column correctly answers `42703`, so the probe discriminates).

⚠️ **Eight contrast defects found by MEASURING the deployed CSS, split across themes** — a one-theme
check would have passed. Full table and the reasoning in the root `CLAUDE.md` (2026-09-01 (m)). The
structural fix: `epc-rcm.css` now separates **`--rcm-c` (fill, fixed in both themes)** from
**`--rcm-t` (text, dark shade in light mode / light shade in dark)**, because one token cannot both
carry white and read on a light wash of itself. `--pd-muted` is dark in light mode and **light** in
dark, so the activity-number chip is ink-on-card inverted rather than white-on-muted. Status chips take
this repo's settled shape for the same failure: ink text, semantic colour on the border.

⚠️ **Four of the measurements were wrong before they were right** — a live `getComputedStyle` object
re-read after a class change, `.x` and `.x.on` resolving to the same element, a `color:transparent`
spacer scoring 1.00:1, and this module's classes probed on the *other* module's page (where its
stylesheet is not loaded). Enumerate every instance, snapshot values immediately, skip transparent and
empty nodes, and never measure a module's classes off its own page.

⚠️ The automated tab is `visibilityState: 'hidden'`, where timers throttle to ~1/min — an awaited
`setTimeout` inside a probe stalls the call for 45s. Style resolution is synchronous; do not await.

⚠️ **Four harness files had shipped to production** from this module's own rebuild commit and are now
removed, with `.gitignore` widened from the single `_ui_test.html` name to the word.

**Rendered correctly against DEMO01's three legacy risks** (pre-RCM categories and responses, no
activity, no residual): grouped under `— UNASSIGNED ACTIVITY` with the tally `2 × 2nd · 1 × 3rd`, and
every derived priority matching the workbook's 5×5 by hand — 4×4→2nd, 4×3→2nd, 3×3→3rd. 19 header
cells = 19 row cells; no page horizontal scroll. Legacy off-taxonomy `Schedule` still surfaces in the
Risk Universe rather than being silently dropped.

`module.css` + `epc-rcm.css` → `?v=20260901g`.

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
