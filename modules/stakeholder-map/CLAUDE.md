# Module: stakeholder-map

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

**Rendered correctly against OPW101's one legacy stakeholder** — impact 4 × influence 3 →
**12 → 1st Priority → Manage Closely**, with the BD relationship chain intact (2→3, gap 1,
**Enhance / Every two months**) and an initials avatar standing in for the missing photo. 17 header
cells = 17 row cells; no page horizontal scroll.

⚠️ **The photo upload is still NOT verified against the real bucket.**
`storage.from('stakeholder-photos').list()` returns `[]` for a bucket that does **not** exist — proved
with a control on an invented bucket name — so the bucket is **unprobeable read-only** and the only
honest test is a real upload, which is a write. Left for a pass that is allowed to write to a sandbox.

⚠️ The sidebar still reads **"Stakeholder Map"** while the page is now the **"Stakeholder Register"**;
the name lives in `config.js`'s shared `MODULES` registry, so renaming it is the app owner's call.

`module.css` + `epc-rcm.css` → `?v=20260901g`.

## Rebuilt on the OPS register + stakeholder photos (2026-09-01) — fmlozano
Rebuilt against **`CSF101. OPS. Stakeholder Register. 2026 02 13.xlsx`**. ⚠️ **This SUPERSEDES the
corporate-BD build documented further down** — that section describes `IMP_GRID`, "Impact ×
Interest", two views and "no storage bucket (no file uploads)", none of which is true any more.

**Four views:** Register (28 columns behind 6 band groups, `sm_bands`, grouped by 5-PMLC activity) ·
**Cards** (the faces, grouped by engagement approach) · Impact / Influence (two 4×4 grids) · Criteria.

⚠️⚠️ **THE TWO WORKBOOKS ARE NOT THE SAME TEMPLATE FOR THE PRIORITY GRID.** Both carry a sheet named
`Risk Assessment Criteria - old` and both `INDEX` into `D328:H332` on it, but the **contents of that
range differ between the files**. Deriving the stakeholder grid from the risk workbook's table — which
the shared formula makes very easy to do by accident — is wrong in **6 of 16 cells**, and wrong in the
direction that *under-states* a stakeholder's priority. `RISK_GRID` and `STK_GRID` are two separate
transcriptions on purpose. Asserted, with a contrast run, in `../risk-register/test-rcm.js`.

⚠️ **The two stakeholder lookups DISAGREE and both are shown**, because the workbook does: impact 3 ×
influence 3 is 2nd Priority → "Keep Informed" by the response lookup, and "Manage Closely" by Table 2.
The register's own hand-typed Approach column follows neither consistently (at (3,3): 23 rows "Keep
Informed", 2 "Manage Closely") — which is why a stored `mgmt_approach` **overrides** the derived value
rather than being corrected to it.

**Column reuse is load-bearing and counter-intuitive:** `influence` stores **Impact**, `interest`
stores **Influence**, both as TEXT `'1'..'4'`. `config.js` declares those column names for the
dashboard tile, so renaming them breaks the tile silently. Do not "tidy" it.

### Photos (the feature this round was asked for)
Private bucket **`stakeholder-photos`**; the columns store **paths, not URLs** (a stored URL expires),
signed in one **batched** `createSignedUrls` per load. Client-side canvas downscale to a display image
(1024px) **and a real separate thumbnail** (240px). Drop-well + picker + lightbox, initials fallback
with a deterministic hue.
⚠️ **Ordering rules, each because the opposite leaves a real mess:** the file is held in memory and
uploaded **on Save, not on pick** (an abandoned modal leaves no orphan); old objects are deleted
**only after** the row no longer points at them; deleting a row removes its objects.

**Migration `../../migrations/2026-09-01-stakeholder-register-ops.sql` (USER MUST RUN)** — 27 columns,
an activity index, the private bucket and 4 storage policies, guarded on `is_writer()`.

**Verified:** covered by `node modules/risk-register/test-rcm.js` (146 checks; the derived helpers are
sliced out of *this* module.js and executed). Driven in a browser: 0 console errors, all 4 views, live
derivation matching the workbook (impact 4 × influence 3 → 1st Priority / Manage Closely; gap 1 →
Enhance → Every two months), and the **whole photo path** — pick → a 300×200 blob preview with
**nothing uploaded** → Save → main + thumb uploaded to `CSF101/<ts>_<rand>.jpg` → row inserted
carrying both paths, `created_by` stamped, and **0 derived values persisted**.
⚠️ **Not verified signed in; the migration has not been run** — so the real `createSignedUrls`, the
bucket policies and the RLS on the new columns are untested against PostgREST. ⚠️ **No geometry or
contrast measured** (compositor stalled, `innerWidth: 0`).

## Live collaboration + offline (Phase 1 & 2) (2026-07-26) — fmlozano
Same "◑ register" recipe as risk-register: presence (`#sm-presence`), row cursor on Edit-modal open,
live rows via postgres_changes, offline modal-update via `PDSync.write` + read-cache (`sm:<pid>`).
Realtime migration `2026-07-26-realtime-collab-registers.sql` (USER MUST RUN). `node --check` ok; not
browser-verified. Assets + `module.js?v=20260726a`.

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
