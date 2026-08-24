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
  stays explicit (open decision #6, still open).
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
