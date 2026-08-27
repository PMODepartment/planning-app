# Module: contracts-claims

## PMI tracking — the whole of B2 (2026-08-25) — fmlozano
**Run `migrations/2026-08-25-pmi.sql`.** New 5th tab, `pmi.js`, two sub-tabs: **Register · Cost
Terms**, plus a **case-file** modal per instruction. Implements ROADMAP B2a (bucket + typed
attachments), B2b (the record) and B2c (the rate card, whose priced lines land in `boq_items`).
Design note: `docs/boq-and-pmi.md` §5 — grounded in a real 14-page filed PMI.

### Why a separate table from `contracts_claims`, and not a `record_type`
`contracts_claims` holds the **commercial** record. A PMI is the **instruction** that precedes it and
may never become one: it arrives, it sits un-responded (our exposure, invisible until now), it may be
revised three times, and **one PMI can spawn several proposals that each become their own change
order**. A `record_type` would need three self-FKs, a second reference number and a receipt stage
bolted onto rows where all of it is meaningless — and a 1:1 would make the 29 → 29.2 → rev1 chain
unrepresentable. `pmi_records.claim_id` links the two, so neither owns the other's state.

### The record (B2b)
- ⚠️ **Two reference numbers, both searched.** `MEL.CON.PMI-029` (theirs) and `MST347. OPS. VO-PMI
  29.2 (rev1)` (ours). ⚠️ **OUR ref is unique per project; THEIRS deliberately is not** — one client
  instruction spans a parent, its proposals and every revision, all citing the same number, so
  forcing it unique would make a revision impossible to file.
- ⚠️ **Three relations, three columns, three visually distinct marks**: `parent_id` (29 → 29.2),
  `supersedes_id` (rev1 over rev0, **never an overwrite** — the superseded row is the evidence), and
  `spawned_from_id` (the form says a separate PMI is issued on approval — a *third* relation).
  A contrast build that relabels all three "related" fails the suite.
- ⚠️ **Receipt is a real stage and comes first.** The four commercial stages are kept verbatim; what
  they never carried is that the instruction arrives before we estimate anything.
- ⚠️ **Aging is PER STAGE, derived, never stored**, and total-age-from-receipt is reported
  *separately*. Null when decided, null on a future date, never negative. `daysBetween` is the
  claims register's own UTC helper, so the two registers' figures are comparable.
- ⚠️ **The approval rate is over DECIDED records only.** Withdrawn was never adjudicated and pending
  is not a failure — the naive denominator is what read 0.2% where the honest figure was 85%.
- ⚠️ `internal_chain` / `client_chain` are jsonb because the roles are **per-client configuration**,
  not a fixed set of columns. A proposal three weeks with the COO is not "Submitted".

### The case file (B2a)
Five document types, from the real bundle's five documents by three authors. ⚠️ **Many typed
attachments, not one `file_url`** — a single column cannot answer "has the cost proposal been
submitted?" separately from "is the testing report attached?", which is what a QS asks when chasing
one. Several files per type is normal (the photos are three pages), so it is *not* unique on
`(pmi_id, doc_type)`. The required-document checklist is per profile and the register shows the
shortfall (`2/3`).
- New private **`contracts-claims`** bucket following **mom-attachments**, not the 2026-06-18 three:
  ⚠️ INSERT is `is_writer()` (the legacy `is_approved()` lets a viewer upload into a register they
  cannot write a row to), DELETE keeps the `owner` branch beside `is_planner()`.
- ⚠️ **The object PATH is stored and the URL is signed on demand.** The ordering rules are the
  feature: upload before the row write, roll the object back if the row write fails, and on removal
  delete the ROW first (a failed object delete leaves a recoverable orphan; the reverse leaves an
  attachment that will not open).

### The cost build-up (B2c)
⚠️ **The percentages are marked "As per Contract" — they are per-contract terms, not constants.** So
`contract_cost_terms` is an ordered rate card: each step a label, a `kind`, a **basis** (which
earlier step it multiplies or sums) and a rate. Verified against the real sheet, step by step:
A 8,707,500 → B 9,578,250 → C 1,915,650 → D 11,493,900 → E 1,379,268 → **F 12,873,168**.
- ⚠️ **The sheet prints 12,873,167.99 where D+E is exactly 12,873,168.00.** Asserted as the artefact
  it is; never "fix" our arithmetic to match a rounding display.
- ⚠️ **A step may only reference earlier steps, and a missing or forward basis yields `null`, never
  0.** A zero silently understates a total that gets quoted in a meeting; the broken step is named on
  screen. A contrast build that returns 0 there fails 5 assertions.
- ⚠️ **No seeded card and no default profile.** A seeded 10/20/12 is the hard-coded percentages by
  another name — it would be applied to the next client silently and read as a considered term. The
  sample build-up is a one-click **template the planner must accept**, which is a different thing.
- ⚠️ **A PMI cost proposal IS a BOQ**, so its priced lines go to `boq_items` with
  `scope_type='change_order'` + `pmi_id`. Each proposal gets its **own `boq_revision`** (via the new
  `boq_revisions.pmi_id`), because `boq_items.revision_id` is NOT NULL and identity is
  `(revision_id, sheet, source_row)` — a nullable revision_id would make that unique index toothless,
  since NULLs are distinct in Postgres. It also keeps change-order lines out of the contract
  revision, so the BOQ tab's contract total is unaffected.
- ⚠️ **Two delete rules on purpose:** `boq_revisions.pmi_id` **cascades** (a proposal's priced scope
  has no meaning without its instruction) while `boq_items.pmi_id` **sets null** (a *contract* line
  tagged to a PMI must lose its tag, not its life).

### Verified
- **82 checks green** executing the shipped functions in a `vm` sandbox — the build-up step by step,
  the forward-reference guard, per-stage aging across all seven stages, the dual-reference search, the
  three relations, `bumpRev`, attachment completeness and the decided-only denominator.
- ⚠️ **Nine contrast builds, all nine bite** (zero-basis 5 fails, clock-never-stops 3, bad-revbump 4,
  one-ref-searched 2, one-relation 2, negative-aging 1, withdrawn-decided 1, hardcoded-label 1,
  count-unpriced 1). ⚠️ `one_relation` initially passed: my assertion checked the CSS *class* while
  the variant changed the *label*, so it was testing the wrong half. The class drives the colour, the
  label says what the relation is — the suite now asserts both.
- **VERIFIED SIGNED-IN** against the real database (super admin, GPR101, via the owner's own
  `localhost:5173`): all 5 tabs render, the BOQ tab loads cleanly on the migrated schema, and the
  **un-migrated PMI tab degrades exactly as designed** — it names the missing table *and*
  `migrations/2026-08-25-pmi.sql`, with **zero unhandled rejections**, and returning to Claims
  restores the register's filters and tools.
  ⚠️ **Measurement note:** clicking a tab *during* `init()`'s own trailing `load()` produced a
  reading where the view had not switched. From a settled state the same click is correct — do not
  drive the tabs until init has finished.
- **Browser-verified** at 1280 and a 375px layout viewport, both themes, against the shipped CSS:
  header/body cells align 9/9, the case file reproduces the full build-up to **12,873,168.00**, the
  chain shows three distinct labels, the missing-required warning fires, desktop stays a one-row
  52px filter bar and a 61px topbar with all **5** tabs on screen, and there is no page horizontal
  scroll at either width.
- ⚠️ **A real defect found by rendering, not reading:** the proposal total read **`0.00`** for every
  unpriced instruction — asserting "we quoted nothing". That is the same false equivalence this
  module refuses in the BOQ, where `By Megaworld` is stored verbatim rather than coerced to 0. Now
  `not priced`, via `proposalTotal()`, which returns null with no lines *or* no card. Three
  assertions added.
- ⚠️ **A real WCAG failure, also only from measuring:** the `claim` relation mark used brand red,
  which is **4.12:1 light / 3.40:1 dark** — under the 4.5:1 AA floor for 10px bold, while the other
  eleven marks passed at 6.4+. Brand red is not a text colour at this size. It now uses body ink with
  a red *border* (the only mark with one, so still distinguishable): **all 12 marks pass, min 6.39
  light / 6.56 dark**.
- ⚠️ **Harness bug worth remembering:** four aging assertions failed as off-by-one because the harness
  built fixture dates from **UTC** getters while `todayISO()` uses **local** ones (deliberately, to
  match the claims register). East of Greenwich that is a day out for part of every day and reads as
  a code defect. Gate fixture dates on the same clock the module uses.
- **0 functions lost or added in `module.js`**; all three files parse; CSS braces balanced.
- ⚠️ **Not exercised against real data:** no PMI has been filed, no file uploaded through the bucket,
  and no card saved — the migration is not run. The upload/rollback ordering and the storage policies
  are structurally verified only.
- Assets `module.css/js?v=20260825a`, new `pmi.js?v=20260825a`; `MODULE_V` → `20260825a`.

### Not built (deliberate)
- **The internal/client approval chain has columns and configuration but no editor yet** — the roles
  are captured per profile and stored as jsonb, but ticking off "Recommending Approval" per record is
  a further screen. Per-stage aging already surfaces the exposure the chain would explain.
- **No OCR of client PMI PDFs.** The tempting answer to "the format varies" and the wrong one: the
  sample is a 14-page bundle mixing a spreadsheet print, a scanned form, photos and a supplier
  contract, and a mis-parsed amount in a claims register gets quoted at a meeting. Type the header
  fields, attach the file.
- Promoting a PMI to a `contracts_claims` row in one click (`claim_id` is stored but set by hand).


## BOQ tab — the whole B1 chain (2026-08-24) — fmlozano
**Run `migrations/2026-08-24-boq.sql`.** New 4th top-level tab, `boq.js` (self-contained, hosted the
way `ppr.js` is hosted by progress-photos), with four sub-tabs: **BOQ Items · Class Codes ·
Allocations · Billing / POC**. Implements ROADMAP B1a–B1d. Design note: `docs/boq-and-pmi.md` — every
⚠️ in `boq.js` is a **measured** finding from the real OPW101 Package 2 workbook, not a guess.

### The tables (8) and the two things they are NOT
`boq_revisions` · `boq_items` · `boq_import_profiles` · `boq_class_map` · `boq_class_suggestions` ·
`boq_allocations` · `boq_billing_periods` · `boq_progress`, plus a `boq_activity_quantity` view.
- ⚠️ **`boq_items` is append-and-supersede, never edited in place.** It is the client's document; a
  remeasure is a NEW revision with the prior retained, because every claim argument turns on exactly
  what was tendered. There is deliberately **no UI path** that updates a line's description, unit,
  qty or amount after import.
- ⚠️ **No `project_schedule.quantity` column, and that was the explicit decision** (see
  `docs/vendor-performance-chain.md` #1). A quantity column would make a THIRD place quantities live
  (client BOQ, allocation, activity) with nothing keeping them in step — and the activity copy is the
  one everybody would read. An activity's quantity is **derived**: the `boq_activity_quantity` view,
  `security_invoker` so the caller's RLS applies.

### Import: detect → preview → accept → import verbatim
- ⚠️ **Header detection is a SEARCH, never an offset.** Measured in ONE workbook: header row
  **12 / 10 / 7** and first column **A / B / B** across the trade sheets and their billing twins. The
  accepted map is saved to `boq_import_profiles` per sheet so the next revision needs no re-deciding.
- ⚠️ **The heading discriminator is the `Total of X >>` marker, NEVER "has unit + qty".** A heading
  can carry both (`DIV 5 | METALS | lot | 1`); the unit+qty test made HS-SP read sum-of-WT% =
  **2.000000** and a contract of **₱114,410,587.84** against the true **₱57,205,293.92**. A contrast
  build with that test in place fails **7** assertions, including the contract sum.
- ⚠️ **Non-numeric amounts are scope-boundary statements, not missing data** — `Included in Package 1`
  (16), `n/a` (4), `By Megaworld` (2). Stored verbatim in `exclusion_note`, `line_kind='excluded'`,
  out of every roll-up. **Never coerced to 0**: a zero and "someone else is doing this" are different
  facts. A contrast build that returns 0 for text fails 8 assertions.
- ⚠️ **Line totals are authoritative; rates are rounded displays.** `qty × displayed rate` gives
  ₱8,707,508.60 against the sheet's ₱8,707,500.00 — **₱8.60 wrong on a two-line sheet**. Amounts are
  imported as given; where the client gave a rate and no amount we compute it and set
  `derived_amount`, so a later reconciliation can tell the client's figures from ours.
- ⚠️ **THE RECONCILIATION GATE IS THE MOST VALUABLE THING IN THE IMPORTER.** Tolerance is
  absolute-and-small (₱1 or 0.01%) because the files carry genuine artefacts of that size (the PMI
  prints 12,873,167.99 where D+E is 12,873,168.00 — assert it, never "fix" our arithmetic). Widening
  it to 5% lets the **₱20,667,260.59** plant hole (Tower Crane, Elevators, Generator Set,
  Skidloader — UoM literally `unit`) pass, which is exactly how that hole was created.
- ⚠️ Sheet names are used **as the workbook gave them** — `'BILLING BREAKDOWN '` has a trailing
  space and an exact-name lookup throws. An unpriced trade sheet is **reported**, because ACOUSTIC's
  trade sheet is ₱0.00 while its billing twin carries ₱19,082,190.24.
- `#REF!` and other error values survive the import rather than aborting it.

### Mapping (B1b)
⚠️ `boq_class_map` is **scoped to the revision. There is no global description→code table that
applies itself** — two clients saying "Wall Systems and Cladding" may mean different Finance codes.
Viability comes from `boq_class_suggestions`, learned from **accepted** mappings across the
portfolio, matching on normalised description AND the client's own heading path (which maps onto
Finance divisions far more stably than free text). Every proposal names its source; nothing is
auto-accepted; each stored row records **how** (`suggested` / `bulk_accepted` / `hand_picked`).
⚠️ **Never de-zero a code** — `015051` (Gen Req › Earthmoving) ≠ `15051` (Metal Works › Railings), so
it is a picker, not a text box, and `normKey` does not strip leading zeros.
⚠️ Headings and excluded lines are **not mappable at all**, not "mappable and unmapped" — counting
them in the denominator makes a fully-mapped BOQ read as permanently incomplete.

### Allocation (B1c)
A class code is a **tag**, not a key, so a line is allocated **across** activities: location match
first (the leaf text *is* a location on 3 of the 4 sheets), then pro-rata by duration, then by hand.
⚠️ **A proposal is never stored until applied** — an auto-split becomes indistinguishable from a
planner's own figures. ⚠️ **No candidate activity → nothing is proposed**, rather than an arbitrary
spread. ⚠️ The remainder is shown **both ways**: a shortfall is unplanned work, an excess is a wrong
S-curve (verified live — over-allocating flips the line to "over-allocated by 9,690.3").

### Billing / POC (B1d)
⚠️ **`rel_pct` is the ONLY stored input.** WT %, %Wt. and Amt. are pure functions of the line amount,
its sheet total and rel_pct; persisting them means they disagree with the BOQ the moment a revision
changes a quantity. Verified against the real sheets: sum of WT % = **1.000000** per sheet; the
worked Site Supervision line (22 mos @ ₱1,220,000) gives previous **₱3,660,000.00** and to-date
**₱7,320,000.00** exactly; 9.6718% + 7.5741% = **17.2459%**; MATERIALS + LABOR = Amt.
- ⚠️ **WT % is relative to its own SHEET, so a project POC is NOT the average of the four.** Computed
  as Σ(amount × rel) ÷ contract, which IS the trade-share re-weighting but in a form that cannot be
  mis-implemented as an average. Proved by measurement: ACOUSTIC alone at 100% reads **1.65%** (its
  contract share) where the naive average would read **25%**; Architectural alone reads **87.90%**.
- ⚠️ Each period **snapshots the revision it was billed against**, or a remeasure rewrites a
  submitted billing. `previous` is never stored — it is the prior period's to-date.
- ⚠️ A billing period is **not a calendar month** (26th→25th); the period→month mapping for Cash Flow
  stays explicit. **Decision #6 resolved 2026-08-26** — see below.
- ⚠️ **Two POC systems now exist and must not be merged**: `schedule_scurve_agg` is *progress*, this
  is *contractual/revenue*. Reconciling them is a report, never an override. Said on screen.

### Verified
- **112 checks green** executing the shipped functions in a `vm` sandbox (`_internals`, nothing
  reimplemented) — the parser, the line-kind rules, the reconciliation gate, the WT%/POC/revenue
  identities and the allocation proposer, all against the workbook's own measured figures.
- ⚠️ **Six contrast builds prove the suite bites**: the unit+qty heading test (7 fails), coercing
  text to 0 (8), a 5% tolerance (2), pro-rata-over-location (2), de-zeroing the code (1), reading the
  FIRST Rel column instead of to-date (1). ⚠️ A **seventh** (lump-sum leaking into the quantity
  roll-up) initially passed — the fixture never exercised the discriminator, because a parsed
  lump-sum line has no qty. Added the case that does: a **heading** with `lot | 1`. Three fails now.
- **Browser-verified** at 1280 and a 375px layout viewport, light and dark, with the real
  `dashboard.css` / `module.css` / `ui.js`: all four sub-tabs render, header/body cell counts align
  7/7 · 8/8 · 9/9, the contract reads **₱1,155,577,055.60** and POC **17.2459%**, both modals open
  and the reconciliation line updates live, 0 page horizontal scroll at either width, tables scroll
  inside their own card.
- ⚠️ **A real accessibility defect found by measuring, which reading would not have caught:** the
  first cut used one hard-coded hue per meaning and **8 of 10 theme/colour combinations failed WCAG
  AA** — the amber scope-boundary marker read **2.80:1** on a light card and green/blue/purple/red
  sat at 2.5–3.5:1 on the dark card. Same class as the Drawing Register's 2.64:1 pill. Now paired
  light/dark semantic tokens: **minimum 6.39:1 light / 6.56:1 dark** across all 16 combinations.
- ⚠️ **Two real phone defects, also only from measurement:** `flex:1 1 100%` put every filter on its
  own row (**305px** on Items — taller than the content it filters; now 218px), and `flex:1 1 0`
  could not shrink the 4-button sub-tab strip below its text width (**401px inside 375px**, "Billing
  / POC" clipped; now 355px with wrapping labels at the 44px touch minimum).
- ⚠️ **Measurement trap, again:** `window.innerWidth` reported **464** while the layout viewport was
  **375** and the ≤700px rules were applying. Gate on `document.documentElement.clientWidth`, and
  note `filterRows` counted from `getBoundingClientRect().top` is meaningless under
  `align-items:center` — the bar's own height is the honest number.
- **0 functions lost or added in `module.js`** (surgical edits inside existing functions only); both
  files parse; CSS braces balanced; 0 NUL bytes.
- ⚠️ **NOT verified signed-in, and the migration has not been run.** No real workbook has been put
  through the importer — the parser is verified against fixtures reproducing the measured shapes, not
  against the file itself. **The first real import is the test**, and the reconciliation gate is what
  should catch a column-map mistake.
- Assets `module.css/js?v=20260824a`, new `boq.js?v=20260824a`; `MODULE_V` → `20260824n`.
- ⚠️ **Not folded into `supabase-schema.sql` / `supabase-setup.sql`** — pre-existing drift, checked:
  `packages`, `class_codes`, `duration_scenarios` and `mom_items` are absent from both too, so
  `/migrations` is the only definition for all of them. Closing that drift is its own audited pass
  (see the 2026-07-16 entry in the main CLAUDE.md for the ordering trap it carries).

### Not built (deliberate)
- **B2 (PMI)** — the whole of it. `boq_items.scope_type` is in place so a variation's priced lines can
  land here as `change_order`, but ⚠️ **there is no `pmi_id` column yet**: a pointer added before the
  UI that sets it produces rows belonging to no PMI that vanish from any PMI-filtered view (the
  packages-migration trap). B2c adds it with its UI.
- **Line-kind reclassification** (`measured` → `provisional`) — the sheet cannot tell us which
  lump-sum lines are provisional; that is a planner's call and needs its own reviewed edit path.
- Cash Flow does not yet read the BOQ as its cost-weighted S-curve basis, and the schedule's IBB
  columns are still maintained by hand. Both are the next consumers, not part of B1.

## Live collaboration + offline (Phase 1 & 2) (2026-07-26) — fmlozano
Same "◑ register" recipe as risk-register: presence (`#cc-presence`), row cursor on Edit-modal open,
live rows via postgres_changes, offline modal-update + **offline bulk-status** via `PDSync.write` +
read-cache (`cc:<pid>`). Realtime migration `2026-07-26-realtime-collab-registers.sql` (USER MUST RUN).
`node --check` ok; not browser-verified. Assets + `module.js?v=20260726a`.

> **Claude / developer: read this first.**
> 1. Read `../../MODULE_CONTRACT.md` and `../../CONTRIBUTING.md` (NOT auto-loaded).
> 2. This module is **Contracts & Claims Register**. DB table `contracts_claims`.
> 3. Chrome (topbar/tabs/tools/filter bar) is copied from **drawing-register / material-submittal** —
>    do not re-invent it.
> 4. Update this file as you build.

## Built 2026-07-20 — Contract · Claims / Change Order · Extension of Time
Built against the Power Apps **“Contracts & Claims Register”** app (Overview, Claims and Change
Orders, and Extension of Time screens). Three tabs, as specified.

### The key insight: two of the three screens are the SAME screen
Claims/CO and EOT are both a **four-stage pipeline** — *Estimated → Submitted → Evaluated → Client
Approved* — with a status, a derived aging figure and a project roll-up banner. They differ only in
**unit**: Claims/CO are money, EOT is calendar days. So both are driven by one `VIEWS` config and
one renderer; only the column set changes. Contract is the odd one out — a flat
description + amount list with no pipeline and no status.

### Data model (migration `../../migrations/2026-07-20-contracts-claims-full.sql` — USER MUST RUN)
- `record_type` discriminates the tabs: **`Contract` | `Claim` | `Change Order` | `EOT`**
  (Claim and Change Order share the Claims/CO tab; the app's “Select Claim/CO” filter picks between
  them).
- Money pipeline: `est_amount`, `sub_amount`, `eval_amount`, `approved_amount`.
- Days pipeline: `est_days`, `sub_days`, `eval_days`, `approved_days`.
- ⚠️ **Money and days are separate column sets on purpose**, not one generic value + unit
  discriminator. They are never mixed in a view, the roll-ups are per-screen, and separate columns
  make it impossible to accidentally sum pesos and calendar days into one total.
- Dates: `date_filed`, `date_submitted`, `date_evaluated`, `date_approved`. Reuses the starter
  `amount` (contract value only), `status`, `reference_no`, `description`, `counterparty`, `remarks`.
- **Saving nulls the pipeline that doesn't belong to the chosen type**, so changing a record from
  Change Order to EOT can't leave stale pesos hanging off it.

### Derived, never stored
- **Aging** = `today − date_submitted`, shown **only while Pending** (exactly as the app does). A
  stored aging is wrong the day after you write it. Returns null when decided, never submitted, or
  if the submit date is in the future (no negative ages). `daysBetween` is UTC-based so DST can't
  shift a count.
- **Recovery rate** = approved ÷ submitted over **decided records only** (Approved + Disapproved).
  ⚠️ Deliberately NOT ÷ everything submitted: on a young register most claims are still Pending, so
  that denominator reads as a catastrophic ~0% when nothing has actually been refused. Verified on
  the real fixture: the naive figure was **0.2%**, the honest one **85.0% of 1 decided record**.
  Cancelled is excluded too — a withdrawn claim was never adjudicated.

### Verification — 43/43 against the screenshots' own numbers
Loads the shipped `module.js` (no reimplementation). The Power Apps screenshots print their roll-up
banners, which makes them an exact fixture:
- **Hotel 101 EOT — all four totals match exactly**: 1,048 / 1,095 / 882 / 314.
- **Avesta Residences Claims — three of four match exactly**: submitted 437,601,575, evaluated
  163,574,365, approved 937,774. **Estimated is 387,716,248 against their printed 387,716,249.**
  That 1-peso gap is *their* display rounding (values stored with cents, rounded per cell, then
  summed) — it is asserted explicitly in the test so nobody later "fixes" our arithmetic to match a
  rounding artefact.
- Aging (Pending-only, null when decided/unsubmitted/future), status/type isolation between tabs
  (EOT rows can never leak into Claims), date-window filtering, number formatting, `<br>` stripping.
- **Browser-verified** with that data: headers match the app's wording, the total banner renders the
  roll-up, aging shows **17** on the one Pending EOT exactly as the screenshot does, the Add form
  swaps money↔days↔contract fields by type, saving an EOT from the Claims tab **follows the record
  to its tab** rather than letting it vanish, filters/clear/bulk work, dark mode on tokens, and the
  wide table scrolls inside its own card with **no page horizontal scroll**. No console errors.
- ⚠️ **Environment caveat:** screenshots time out and computed styles go stale after a dynamic class
  change (see material-submittal's CLAUDE.md). Dark mode was therefore measured by setting the theme
  **before first paint**, not by toggling it live.

### 2026-07-20 (b) — Top bar wasn't uniform (missing shared chrome)
Owner reported the top bar didn't match the suite, specifically the buttons beside the profile icon.
**Same defect as the 2026-07-17 Progress Photos pass:** this module was missing the three shared
topbar rules every uniform module carries, so it inherited `dashboard.css`'s `.pd-topbar { gap:14px }`
with **no `flex-wrap`**, the avatar had **no left divider**, and theme.js's injected toggle kept its
default size instead of matching the 34×34 tool buttons.
- Fixed by copying the block **verbatim** from `drawing-register/module.css` (see the top of
  `module.css`). ⚠️ **Do not drop it when copying this module** — the comment there says what breaks.
- **Verified by computed-style diff against the real drawing-register**, with a **sanity assertion
  that the reference CSS actually loaded first** (that omission invalidated the first Progress Photos
  attempt). Zero differences on every chrome element; **geometry pixel-identical** — tool cluster
  right edge **1179px**, theme toggle left **1193px**, profile divider left **1247px**.
- No horizontal overflow at 1280/1100/900/700/420px. This module wraps to a second row earlier than
  the others below 900px because it carries **three** tabs — graceful wrapping, not breakage.

### 2026-08-26 — Decision #6 resolved: the reporting month, cut at month end
Owner: *"Billing is dependent on the contract itself as this is a commercial decision. But for
reporting purposes, can we cover til end of each month?"* — so **both**, kept apart.
- The Billing tab's period table is unchanged: 26th→25th, the dates the client certifies and pays.
- Added a **Monthly reporting view** beneath it. Each period's **increment** (its revenue less the
  prior period's to-date) is spread **straight-line across the calendar days it spans**, inclusive of
  both endpoints, and assigned to the months those days fall in. Columns: revenue in month,
  cumulative, materials, labour, which billings fed it, and days covered / days in month.
- ⚠️ **The increment is spread, never the to-date.** To-date is cumulative; spreading it would bill
  the same money into every month it touches.
- ⚠️ **Inclusive endpoints.** 26-Feb → 25-Mar is **28** days (Feb 26–28 = 3, Mar 1–25 = 25), not 27.
- ⚠️ **UTC date arithmetic.** A local-time `Date` shifts a date across a month boundary for anyone
  east or west of the server, silently moving revenue between months.
- ⚠️ **The tail of the current month is left blank, not accrued.** Days after the last `period_end`
  have been certified by nobody. Filling them from the schedule's progress would push decision #7's
  *other* POC into a revenue figure — the one merge this module refuses. The view says so on screen
  and names the shortfall in days.
- ⚠️ **A part-covered month is normal at both ends and means different things**: the first is short
  because the project started mid-month, the last because the next billing has not been raised.
  Both are marked `part` rather than filled.
- ⚠️ **Periods with no `period_end` fall in no month** and are **excluded, not guessed** — the view
  names them and warns that its Total is then below Revenue to date.
- ⚠️ **Nothing is stored and no month is editable.** `rel_pct` remains the only input; the pro-rata
  is a derivation in `boq.js` (`monthlyRevenue`), so changing the convention later cannot corrupt a
  submitted billing. The migration comment was updated to record the resolution.
- **Verified by executing the shipped `monthlyRevenue`** in node against a three-billing fixture
  (26th→25th, ₱1,000,000 contract, 60/40 material/labour): Dec 6/31 part, Jan 31/31 full, Feb 28/28
  full, Mar 25/31 part; the monthly total closes **exactly** on revenue to date (₱300,000.00), and
  the material split holds at 0.6 in every month. Not yet clicked through in a browser.

`MODULE_V` → `20260826q`; `wizard.js?v=20260826a`, `module.js?v=20260826b`, `module.css?v=20260826a`.

### 2026-08-26 — Decision #2 corrected: a package is a scope division, not a trade
Owner: *"Package 1: Avesta Residences Tower 1 and General Requirements / Package 2: Avesta Residences
Towers 2-7 … In terms of BOQ, it is purely the client who will dictate which will define the progress
billing of each package whether by trade or etc."*
- **The first answer was wrong.** A trade sheet is not a commercial lot: the workbook **is** Package 2,
  and its sheets are the client's billing breakdown *within* it. `Packages from sheets…` is **deleted**
  and replaced by **`Assign to contract package…`** — assigns lines to a package that already exists,
  shows each sheet's current lot (`mixed` included, never hidden), and can remove an assignment.
- ⚠️ **No insert in that function.** Packages come off the contract documents, on the Dashboard. With
  none on the project, the tool says where they come from instead of offering to invent one.
- `suggestCode()` deleted — a code from a tab name means nothing under the corrected model.
- No schema change: `boq_items.package_id` was right; per-line storage still stands because one issued
  document can cover more than one lot. Migration comments corrected in place.

### 2026-08-26 — Decision #7 reframed: the gap is an accrual, and it is money
Owner: *"Isn't the s-curve based on actual progress? … the contractor will bill the client based on
actual verified progress … for reporting purposes … accrual and expected accounts receivable/payable."*
- Not rival numbers — the same work at **reported → certified → paid**. The panel is now
  "Reported, certified, and the accrual between them", and the third cell is
  `(reported − certified) × contract` in pesos: *Accrued — done, not yet certified*, or
  *Billed ahead of the work* when it runs the other way (absolute value, never a negative peso).
- ⚠️ **The reported figure is contractor-reported, not client-verified** — it is `percent_complete`
  typed on the programme. Said on screen, because the accrual otherwise reads as agreed money.
- ⚠️ **Dispute is not measurable**: `boq_progress` stores one `rel_pct` per line, the certified one.
  A claimed figure beside it is a schema decision and is **open**.
- **Verified**: 13/13 executing the shipped `pocCompareHTML` in node — ₱27,541.00 at +2.75pp
  (0.20 reported vs 0.172459 certified on ₱1M), the reverse case at ₱22,459.00 / −2.25pp, plus the
  no-billing, no-schedule and reconciliation branches. Not clicked through in a browser.

### 2026-08-26 — Claimed vs certified: dispute becomes a number
Owner: *"Add rel_pct_claimed vs certified so dispute is measurable"*.
- `migrations/2026-08-26-boq-claimed-vs-certified.sql` adds `boq_progress.rel_pct_claimed` beside
  `rel_pct`. **`rel_pct` keeps its meaning — CERTIFIED.** POC, revenue and the monthly view still
  derive from it alone; **nothing bills from a claim**.
- ⚠️ **NULL = "not separately recorded", never zero.** No default, no back-fill. A zero default would
  have priced every historical line as a 100% dispute the instant the migration ran. Effective
  claimed is `coalesce(rel_pct_claimed, rel_pct)` in SQL and in JS alike.
- ⚠️ **Not netted.** Certified-above-claimed is reported on its own as an anomaly rather than
  cancelling genuine disputes elsewhere, which would hide both. No CHECK constraint: refusing the
  save would only move the wrong number somewhere unrecorded.
- Progress dialog: **Claimed %** beside **Certified %** (was "To date %"), blank meaning *same*, with
  a live dispute total in the footer. The save writes the **union** of both maps — keying off the
  certified map alone drops a line claimed in full and certified at nothing, the sharpest dispute
  there is. Save and new-period seed both **degrade gracefully** when the migration has not run.
- Accrual panel splits into **In dispute / Not yet claimed / ⚠️ Certified above claimed**, plus an
  **In dispute** KPI — both only once a claim exists, since a standing "₱0.00 dispute" asserts an
  agreement nobody made.
- `boq_period_dispute` view (security_invoker, the screen's own heading/exclusion money rules).
- **Verified**: 12/12 on `disputeOf`, 12/12 on the reframed `pocCompareHTML`. ⚠️ Migration not run,
  nothing clicked through.

### 2026-08-26 — The contract DEFINES its package (and stops showing claim dates)
Owner, on the Add-record form: *"In the contract module, there is a package field here. How come? In
the contract it'll be the one that will define the packaging."* And: *"There are also date fields for
approved evaluated which are not relevant to the construction contract."*

Both were real, and the first was a modelling error rather than a cosmetic one.

**The package field pointed the wrong way for one of the four types.**
`contracts_claims.package_id` was added for CLAIMS — a claim, change order or EOT is *raised against* a
lot that already exists — and one form serves every type, so **Contract** inherited a picker asking
which package it belongs to, when the contract is the document that **defines** the package.
- Type **Contract** now shows **Contract package** with *— Create from this contract —* first, plus
  *Link to …* for each existing package, and a block for package **code, name, start, finish**. The
  contract amount becomes the package's contract value.
- Code and name are **seeded from Reference no. and Description** as you type, and never overwrite
  anything you have edited yourself (`dataset.touched`).
- Types **Claim / Change Order / EOT** are unchanged, relabelled **Raised against package** so the
  direction is legible on screen.
- ⚠️ **This closes a real chicken-and-egg.** Until now the only way to create a package was the
  Dashboard, so a project whose contracts were being entered here read *"(none on this project)"* — the
  screenshot — and the schedule, BOQ, procurement and engineering all had nothing to file against.
- ⚠️ **Still never automatic.** Decision #2 stands: a package minted without a human saying so could
  later be cited in a claim nobody agreed to. This is an explicit choice with its code and name
  confirmed — a planner entering the contract, which is the authoritative act.
- ⚠️ **The package is created BEFORE the record is written, and a failure aborts the save.** A contract
  row saved pointing at a package that could not be created would claim a link that does not exist and
  nothing downstream would notice. A duplicate code says so and offers linking instead.
- ⚠️ **Seeded once, then the Dashboard owns it.** No two-way sync, so the contract and the package
  cannot silently drift apart.

**The four claim dates were showing on a Contract.**
⚠️ `Date filed / submitted / evaluated / approved` carried **no type guard**, while the `Status & dates`
header above them and the aging hint below them both had `data-not="Contract"` — so on a Contract the
header vanished and its four fields stayed, stranded under "Contract value". Submitted → Evaluated →
Client Approved is the **claim** pipeline; a construction contract is signed, not evaluated.
- A Contract now shows **Contract dates → Date signed**, and nothing else. It writes to the same
  `date_filed` column (no schema change), and the form never shows both labels at once.
- The three claim dates are written as `null` on a Contract rather than left holding stale values.
- ⚠️ **The guard had to move from the input to the LABEL.** `f()` put its attributes on the `<input>`
  while `applyType()` toggles the element carrying `data-only` / `data-not` — hiding the box and
  leaving its caption floating, which is how this shipped unnoticed. `f()` gained a `lattrs` argument
  and the note says why.

**Verified** by static audit of the built form: **0 inputs carry a type guard** (all 18 sit on labels,
7 Contract-only / 11 non-Contract), and `node --check` is clean. ⚠️ **Not clicked through in a browser**
— in particular, creating a package from a contract has not been run against the live database.

`MODULE_V` → `20260826p`; `module.js?v=20260826a`.

### 2026-08-26 — A guided wizard for Contract / CO / Claim / EOT / BOQ
Owner: *"We will create a wizard for Contracts, BOQ, Change Order, Claims/EOT"*, after asking whether
the BOQ import could cope with the many formats clients send and whether input could be *"intuitive
like a wizard similar to how the schedule builder works so that it can easily be connected with each
other."*

Shape decided with the owner: **one** wizard with the type chosen at step 1 (not four), the **wizard for
new records and the existing form for editing**, and — for the BOQ half — **full column mapping saved as
a reusable format profile**.

`wizard.js` (new, 347 lines) → `window.CCWizard`. Steps: **Record → Package → Details → Dates → BOQ →
Review**, with each step declaring `when()` so the rail and the Back/Next arithmetic can never diverge
from what is actually shown — the classic wizard bug where "3 of 5" jumps to 5 and the count lies.
- ⚠️ **It does not own the write.** `persistRecord()` was extracted from `openForm`'s save handler and
  both now call it. Two payload builders for one table drift, and the half that drifts is the one
  nobody is looking at.
- ⚠️ **Nothing is written until the last step.** The one irreversible act — creating a contract package
  — happens inside the same save as the record, so abandoning the wizard leaves no orphan package.
  If the package fails (a duplicate code, most often) **nothing** is saved and you stay on Review.
- ⚠️ **The package step states its direction.** A Contract **defines** its package; a CO/Claim/EOT is
  **raised against** one. With no packages yet, it says to record the Contract first rather than
  showing an empty picker.
- ⚠️ **A contract is signed, not evaluated** — the wizard never builds the claim-pipeline dates for a
  Contract at all, rather than building and hiding them.
- ⚠️ **Back never loses a field**: `capture()` runs on every move, including rail jumps.
- Falls back to the old form if `wizard.js` fails to load, so the module cannot lose its Add button.

**On the BOQ question, answered honestly in the step itself:** detection is a set of header patterns
(`/description/`, `/total amount/`, `/material cost/`) plus one structural rule, all measured against
**one** workbook (OPW101 Package 2). A client whose sheet says "Particulars / Sum" parses partly, and a
silently-wrong money column is the dangerous failure — so the BOQ step hands over to the existing
detect → preview → accept importer instead of pretending to have understood the file.
⚠️ **`boq_import_profiles` already has `client_key`, `col_map`, `header_row`, `first_col` and
`heading_rule`** — the reusable-profile machinery is in the schema and only the UI is missing.

⚠️ **NOT DONE, and next:** the BOQ step is a hand-off, not yet the mapping UI — re-pointing columns per
sheet and saving/reusing a named format profile is the second half of this build. Nothing here has been
clicked through in a browser.

### 2026-08-26 — Three defects the owner found in the wizard, one of them mine to own
Owner, from the live wizard: *"there is already a BOQ field is this section optional? Or even at the
right time to add where for example a project had just been awarded and there is no BOQ to import
yet"*, then a save that failed on `approved_amount`, then *"It says PKG-1 already exists but doesn't
show in the contract records."*

**1. ⚠️ THE WIZARD LEFT ORPHAN PACKAGES — and its own comment claimed it could not.** The package is
created before the record because the record needs its id; when the record insert then failed, the
package stayed. The owner hit it twice: the save died on a missing column, the retry was refused with
*"PKG-1 already exists"* — a package they had never knowingly created and could not see anywhere in
the records list, because a package is not a record. A failed save now **rolls the package back**, and
⚠️ **only one this save created** — a package the planner *linked* to is somebody else's row and is
never touched.

**2. The BOQ step looked mandatory at exactly the wrong moment.** A contract is recorded the week it is
awarded; the priced BOQ arrives weeks later. A step that looks required then invites either a
fabricated import or an abandoned wizard. It now says **"optional — most contracts are recorded before
the BOQ arrives"**, the rail sub-title says so too, and the dead "Open the BOQ importer…" button is
gone rather than lying about what it does.

**3. A save could not survive a column this database does not have.** `contracts_claims` here predates
the four est/sub/eval/approved columns, and a **Contract sends all four as NULL** — it has no claim
pipeline — so PostgREST rejected the whole insert over columns holding nothing. `persistRecord` now
drops a missing column **only when its value is null** and retries, bounded, then reports which ones
went so the migration still gets run.
⚠️ **A missing column carrying a real figure still fails loudly.** Silently discarding money is the one
outcome worse than an error.

**Verified 12/12** executing the shipped `persistRecord` against a stubbed PostgREST: the exact live
case (four missing NULL columns) saves with the ₱1,397,462,269.86 contract amount intact in 5 bounded
attempts; a missing column holding ₱250,000 fails and names itself; a healthy schema takes exactly one
attempt; the caller's payload is never mutated; and the update path degrades identically without
stamping `created_by`.

⚠️ **Two orphan packages already exist on One Portwood** (PKG-1, PKG-2) from before this fix — they are
on the **Dashboard → Packages**, not in the Contracts records, and can be edited or archived there.

`MODULE_V` → `20260826r`; `wizard.js?v=20260826b`, `module.js?v=20260826c`.

### 2026-08-26 — Packages move out of the Dashboard and into the contract module
Owner: *"I think the packages in the dashboard is misplaced it should be within the contract module
itself."* Right, and it is the same principle that corrected the Add-record form earlier the same day:
a contract package is a scope division that comes off the **contract documents**, so the contract
module owns it.

- New **Packages** tab in Contracts & Claims (`packages.js` → `window.CCPackages`), between Contract and
  Claims. Full CRUD, the guarded delete, and the **Share with Procurement & Engineering** button, all
  moved rather than reimplemented — same `packages` table, same `PDb` calls, same
  `admin_delete_package` RPC, so every consumer is untouched.
- Loads on first open, like the BOQ and PMI tabs: a project switch should not pay for a screen most
  sessions never open.
- The Dashboard keeps a one-line pointer to where it went, so nobody hunts for it.

⚠️ **ONE FINDING FROM THE MOVE, AND IT IS THE REASON THE OLD PANEL FELT INERT: the "Select" button did
nothing.** It wrote `pd_package` into `sessionStorage` and **nothing ever read it** — only
`projects.html` cleared it on a project switch. The panel's own note admitted module data would not
narrow, and it never did, because no consumer existed. The control is **not carried over**: a button
that does nothing is worse than no button, and every module that genuinely narrows by package (the
schedule, the BOQ, procurement, engineering) has its own filter.

⚠️ **Dead references had to go with it.** The markup swap alone would have left
`document.getElementById('pkg-add').style.display` throwing on every Dashboard load — the panel's JS
(`loadPackages` / `renderPackages` / `packageModal` / `deletePackageModal` / `pushPackages`) and its
four wiring lines are removed. The dashboard's inline script parses clean.

⚠️ **A copied class that does not exist.** `boq.js` writes `boq-kind k-trade` / `k-skip`, and neither
variant is defined in `module.css` — those pills fall back to the base style. Copying that idiom would
have shipped a status column with no visual distinction, so the new one uses `k-measured`, which is
real. **Worth fixing in boq.js separately.**

⚠️ **`packages.end_date` is now load-bearing beyond this screen** — the schedule's EOT arithmetic reads
it as the contractual completion date (revised finish = end_date + granted days). Both the list and the
edit dialog say so, and a package without one shows *"— not set —"* rather than an empty cell.

⚠️ **Not clicked through in a browser.** `node --check` clean on `packages.js`, `module.js` and the
dashboard's inline script.

### 2026-08-26 — The BOQ status pills that said nothing
Owner: *"fix the boq.js pills too"*, after the Packages move turned up `boq-kind k-…` classes the JS
emits and the stylesheet never defined.

Audited every class the module can emit against every one `module.css` defines, rather than fixing the
two that happened to be noticed:

| source | values |
|---|---|
| `line_kind` | measured · lump_sum · provisional · excluded · **heading** |
| billing period `status` | **draft** · submitted · approved |
| PMI `stage` | received · estimated · submitted · evaluated · client_approved · rejected · withdrawn |

**Exactly two were undefined — `k-heading` and `k-draft`** — and both fell back to the base muted pill,
so a heading row and a priced row wore the same badge, and a draft billing looked identical to a
submitted one. PMI's seven were all already defined; my earlier guess that `k-trade` / `k-skip` were
the culprits was wrong — those strings are `<option>` values in the import dialog, never pill classes.

- ⚠️ **`k-heading` is dashed, not coloured.** A heading is a **subtotal of the lines beneath it** and
  carries no money of its own — the dashed border says *structure, not a value*, which is the one
  confusion that matters here, because summing headings double-counts the sheet (the same trap the
  `Total of X >>` marker rule exists to prevent).
- `k-draft` takes the amber `--boq-warn` already used for "partial" — the monthly view's `part` badge
  borrows this very class, so that badge was invisible too and is fixed by the same rule.
- ⚠️ **Package status got its own `k-active` / `k-archived`** rather than keeping the `k-measured` the
  Packages tab borrowed yesterday. It was legible, but `measured` means *measured quantity* everywhere
  else in this file, and one class with two meanings is how a vocabulary rots.

**Verified** by a set-difference over the shipped stylesheet: **emitted-but-undefined: none;
defined-but-never-emitted: none.** ⚠️ Not looked at in a browser — this is a colour/border change, so
the audit proves the classes resolve, not that the shades read well on screen.

### 2026-08-26 — Six tabs become three, and the module gets its title back
Owner: *"The module for contracts/claims page does not have the website title. I also want to have the
tabs to be consolidated into fewer tabs only. There are too many tabs to keep track of. Contracts and
packages are the same thing isn't it? If it makes sense let's fold the BOQ tab and fold the PMI with
the Claims register."*

**The missing title was caused by the tab count.** `module.css` hid `.cc-title-txt` below **1460px**
with the comment *"5 tabs need more room"* — so the module showed no title on any normal laptop, and
the sixth tab made it certain. Three tabs need far less room, so the breakpoint drops to **1080px** and
the title survives everywhere but a genuinely narrow window.

**Contract · Claims / Change Order · Extension of Time.** Packages folded into Contract; BOQ folded
under Contract; PMI folded under Claims.

⚠️ **"Contracts and packages are the same thing" — nearly, and in practice one-to-one, but NOT
identically**, and the gap is what the merged view must not hide:
- a package with **no contract record** is real (created directly, or before the contract was entered)
  and must still appear, or it drops off the very screen the schedule and BOQ file against;
- a contract record with **no package** is also real (the link is optional) and is listed in its own
  section rather than dropped.
So: **one row per package**, carrying its contract's reference, counterparty and signing date on a
second line, and a *"Contract records not linked to a package"* section beneath.
- ⚠️ **Joined on `package_id`, never on code or name.** A contract's reference has no relationship to a
  package's code, and text matching would pair the wrong two the first time someone renamed one.
- ⚠️ **A contract amount that disagrees with its package's is flagged**, not averaged or hidden. The two
  are seeded from one another and then edited apart, and a silent disagreement only surfaces in a
  billing dispute.

⚠️ **FOLDED, NOT MERGED — and that distinction is deliberate.** BOQ and PMI keep their own screens: the
BOQ is revisions + 1,200 lines + billing periods, and PMI is `pmi_records` with its own stage pipeline,
attachments, per-client instruction label and approval roles. Flattening either into the claims table
would have cost that machinery for the sake of a shorter list. They stop *competing at the top level* —
BOQ opens from the Contract tab, PMI from the Claims register, each with a way back.
- ⚠️ **The back bar is a SIBLING of `#cc-view`, not inside it.** Both sub-modules render by replacing
  that element's innerHTML, so a back link placed inside would be wiped the moment the screen finished
  loading, leaving no way out.

**Two more undefined classes, found by extending yesterday's pill audit to every class the module
emits:**
- ⚠️ **`.boq-imp` — the import/preview modal body, used 8 times in `boq.js` and never styled.** A
  1,200-line preview had no scroll of its own, so it pushed the modal's own footer — with **Accept** and
  **Cancel** — off the screen. Now `max-height:70vh; overflow:auto`.
- `.cc-warn` added for the amount-mismatch flag rather than emitting a class that resolves to nothing.
- `.cc-listbar` is emitted undefined but carries its whole layout inline — a hook, not a gap.

⚠️ **Not clicked through in a browser.** `node --check` clean on `module.js` and `packages.js`; the
class audit reports **emitted-but-undefined: none** apart from that inline-styled hook.

### 2026-08-26 — The wizard creates packages, and several of them in one run
Owner, on the New-package form: *"I thought we will have a wizard for this"*, then: *"upon creating a
construction contract - it would also define multiple packages in one go. Currently the planner would
have to go through multiple runs in the same wizard just to log for example 5 packages."*

Both were right. Folding Packages into the Contract tab left **New package** opening a raw modal while
every other new thing went through the wizard — the exact inconsistency the wizard existed to remove.

- **Package is now a wizard type** alongside Contract / Change Order / Claim / EOT / BOQ. ⚠️ It has **no
  Details and no Dates step** — a package has no reference number, no counterparty and no claim
  pipeline; those belong to the contract that defines it, and offering them would invite a package
  quietly carrying half a contract.
- **New package** opens the wizard at that type; **Edit** keeps the compact form, the same rule the
  records follow.
- ⚠️ `gotoTypeTab` sent anything unrecognised to **Claims**, so a saved package would have dropped the
  planner on a register that cannot show it. `Package` now lands on Contract.

**The package step is a LIST, not a form.** Add a row per lot — code, name, start, finish, amount — and
save five in one run.
- ⚠️ **The contract record can cite only ONE.** `contracts_claims.package_id` is a single column, so the
  row marked **★** is the one the record links to and the rest are created beside it. Said on screen;
  silently linking to whichever sorted first would make the claims register cite a lot nobody chose.
- ⚠️ **The ★ follows a deletion.** Removing a row above the primary shifts it, and leaving the index
  where it was would link the contract to the wrong lot.
- ⚠️ **Duplicate codes are caught BEFORE anything is written** — case- and whitespace-insensitively.
  The table is unique on `(project, lower(code))`, so the second would otherwise fail halfway through,
  after the first had already been created.
- ⚠️ **Blank rows are dropped**, not saved: a row added and never filled is a UI artefact.
- ⚠️ **ALL-OR-NOTHING ROLLBACK.** If any package fails, or the contract record fails afterwards, **every
  package this run created** is deleted, newest first — not just the last one. A package the planner
  *linked* to is somebody else's row and is never touched.
- ⚠️ Only the **first** row is seeded from the contract's reference/description, and only while
  untouched — a contract buying five lots must not have four of them named after itself.

**Verified 8/8** executing the shipped `pkgToCreate` / `primaryPkg` / `dupPkgCode`: five rows with a
blank one drop to four; the ★ on row 2 wins over the first; a ★ left on a blank row falls back to the
first real one; `PKG-1` vs `pkg-1` and `PKG-1` vs `" PKG-1 "` both caught; an all-blank list creates
nothing; a single row behaves exactly as before.

⚠️ **Not clicked through in a browser.** Class audit clean apart from `cc-listbar`, which carries its
layout inline.

### Notes / follow-ups
- **Project-scoped by contract §6.** The app's Overview screen is cross-project ("My Projects"); this
  module scopes to the topbar project, so the roll-up banner is that project's total — which is
  exactly what the app's own Claims and EOT screens show. A cross-project Overview would belong in
  `portfolio-overview`, not here.
- Legacy descriptions can carry literal HTML (`…Proposal <br>of Water Ingress` appears in the real
  data). Everything is escaped on output, so this was only ever a cosmetic leak; `clean()` strips it.
- Not built: attachments (the table has no `file_url`, and there's no contracts bucket), revision
  history per claim, and multi-currency.

## Status
- [x] Read MODULE_CONTRACT.md + CONTRIBUTING.md
- [x] Chrome copied from drawing-register / material-submittal (not re-invented)
- [x] CRUD implemented (add / edit / list / delete / bulk status / bulk delete)
- [x] Project-scoped via `pd_project`; `created_by` + `project_id` stamped
- [x] `Fmt.esc()` on all user text injected into HTML
- [x] `enabled: true` set in `assets/js/config.js`
- [ ] **Run `migrations/2026-07-20-contracts-claims-full.sql` on the live DB**
- [ ] Live click-through against a real login

### 2026-08-27 — The wizard may no longer build a package that restates a project

Owner: *"Created AVR101 in the projects list → went to contracts & claims → defined AVR101 (again) and
AVR102 packages. The structure now is AVR101 › {AVR101, AVR102}. This will create problems in connecting
with the procurement app and engineering app."*

**The wizard was not misused — it invited this.** Step 2 opened on *"— Create it from this contract —"*
with an empty row already waiting, which reads as an instruction; the planner filled it with the only code
they had, which was the **project's own**. A wizard that pre-selects the rarer answer manufactures the
rarer answer.

**Checked before designing:** `wpm/data/` holds **AVR101 and AVR102 as separate projects**. Megawide's
codes are PROJECT codes, so those two are two projects of one development — consolidated for reporting by
the Portfolio Overview's new **Group by → Parent project** rollup, which needs no package.

- ⚠️ **"None: this project is the contract lot" is now the DEFAULT** for a Contract. Defining packages is
  a deliberate third choice (`— Define package(s) from this contract —`) beside None and Link.
  `st.pkgId` therefore carries **three** meanings, read only through `linkedPkgId()` / `willCreate()` —
  the empty string used to mean *create*, and a stale reading of it would silently make every contract
  define a package again.
- ⚠️ **A package whose code names a project is REFUSED**, live on every keystroke and again at Save, which
  jumps back to the package step. Two shapes, two messages: **its own project** ("a project cannot be a
  package of itself") and **a sibling project**, which names the real consequence — *Share with
  Procurement & Engineering* maps every package of this project to **one** downstream project, so
  AVR102's lot would land in AVR101 and a buyer in AVR102 would see nothing.
- ⚠️ **Refused, not warned.** By the time Save is pressed the step has already explained it in full. A
  package that restates a project is not a typo fixable later — the schedule, the BOQ and the downstream
  mirror all start filing against it.
- ⚠️ **The reference no longer seeds a clashing code.** A contract on AVR101 is very often referenced
  "AVR101", and seeding that into the package row was the app proposing the exact structure the guard
  refuses. Left blank instead: an empty row asks a question, a pre-filled wrong one looks like an answer.
- ⚠️ **The project list is read once per project switch, never per keystroke.** An unreadable list
  degrades to "no conflict" — it never blocks a legitimate package, it only stops catching an
  illegitimate one.
- **Chose packages and filled none** is now refused too, rather than silently saving as "no package" —
  a different answer than the one on screen, with no way to tell which the record got.
- ⚠️ **The validation chain was an `else if` and is now independent checks.** A contract that defines
  packages AND has no reference must fail both; the chain let the second through whenever the first
  branch was taken.

⚠️ **A LIVE CRASH, FIXED: `open()` never initialised `st.pkgList` or `st.pkgPrimary`.** The package step
reads both on its first paint, so `st.pkgList.map(...)` threw a TypeError on `undefined` and the step
rendered nothing. Yesterday's "Verified 8/8" exercised `pkgToCreate` / `primaryPkg` / `dupPkgCode` against
a **hand-built `st`**, never the one `open()` builds — and its own note recorded the run was *"not clicked
through in a browser"*. A unit test that constructs the state under test cannot catch state that is never
constructed.

**Verified 22/22 in Node against the shipped functions** (extracted by brace-matching, not re-typed): both
reported shapes caught, case- and whitespace-insensitively; the sibling conflict carries the project it
collides with; genuine sub-lots, `AVR101-A`, blank rows and not-yet-existing codes all pass; an
unreadable project list degrades safely; all six states of the three-way package choice; and the previous
star/blank-row/duplicate-code behaviour unchanged.

⚠️ **Not clicked through signed in** — auth-gated, no credentials in this session. `node --check` clean on
all three module scripts; class audit clean (`ccw-stop` defined), with only the pre-existing `ccw-ov` and
`cc-listbar` undefined.

### 2026-08-27 (2) — OPW101 could not be saved without inventing a package

Owner, on the live build: *"OPW101 is a one work construction contract without any packages. But this
requires me to connect it to a package."* And: *"There is still an add package in the wizard wherein the
project code… will have two branched packages AVR101 (again) and AVR102."*

**Both were real, and the first is the more serious: it was a hard block.** `openForm`'s package select
offered only *"— Create from this contract —"* or a link, and the save handler then **refused** without a
package code and name. A single-lot contract — the ordinary case here — had **no way through the form**
except to invent a package, and the only code to hand was the project's own. ⚠️ **The validator was
manufacturing the AVR101 › {AVR101, AVR102} shape**, and yesterday's fix only closed the wizard door
while this one stayed open.

⚠️ **NOTHING EVER REQUIRED A PACKAGE, and the UI claimed otherwise in four places.** `package_id` is
nullable on `contracts_claims`, `boq_items`, `project_schedule` and `wbs_nodes` with no back-fill —
2026-08-25-package-adoption.sql says it outright: *"every existing row keeps package_id NULL, which is
[normal]"*. The orphan section's *"nothing downstream can file against them"* was simply **false**: the
schedule, BOQ, procurement and engineering all file against the **project**; a package only NARROWS that.

- **`openForm` now offers None / Define / Link**, with **None the default and saveable**. Choosing None on
  a record that has a package also **unlinks** it — which is how the existing AVR101/AVR102 rows get
  unpicked without a delete.
- **The conflict guard is now ONE function, shared.** `wizard.js` exports `codeConflict` as a pure
  `(code, projectId, projects)`; the form calls the same one, live per keystroke and again at save.
  ⚠️ Two copies of this rule would drift, and the half that drifted would be the one nobody looks at.
- **The Avesta example is purged from the copy.** Packages empty state, orphan section, BOQ assign modal,
  BOQ "no packages" modal, the wizard's type cards and the form's placeholder all held up *"Package 1 —
  Tower 1 and General Requirements / Package 2 — Towers 2-7"* as the model. That example is **two
  projects**, so every one of those screens was teaching the exact structure the guard refuses. Replaced
  with a genuine sub-lot ("enabling works vs main works") and a pointer to the Portfolio rollup.
- ⚠️ **The Contract type card said *"It DEFINES a contract package"*.** That sentence is why planners
  believed recording a contract means creating one. Now: *"Most need no package — the project already is
  the lot."*
- **The packages empty state is no longer a deficiency.** *"No packages — and most projects need none."*
- **The orphan warning now fires only when the project HAS packages**, where a contract sitting outside
  all of them really is a gap. On OPW101 it reads as a plain list with no warning.
- **The reference no longer seeds a clashing code** in the form either, matching the wizard.

**Verified 40/40 in Node against the shipped functions** (28 wizard + shared guard, 12 rendering
`orphanHTML` in both states): OPW101 renders no warning, no badge and no "not linked" headline; a project
with packages still warns, without the false downstream claim; the shared guard refuses own-code and
sibling-code case-insensitively and passes genuine sub-lots, blanks and an absent project list.

⚠️ **Not clicked through signed in.** `node --check` clean on all four module scripts.
