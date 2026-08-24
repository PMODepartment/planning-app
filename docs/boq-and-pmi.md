# Contracts & Claims — client BOQ, class-code mapping, and PMI tracking

Captured 2026-08-24. Design note for **ROADMAP B1** (client BOQ → internal class codes →
activities) and **B2** (Claims Register with PMI tracking), plus the decision that the BOQ — not a
new `project_schedule.quantity` column — is the source of planned quantity for the
vendor-performance chain (`docs/vendor-performance-chain.md`, F2/F6).

Grounded in two real documents, both supplied as reference and both **measured, not assumed**:

- **BOQ** — *EPC. CAC. BID. One Portwood Package 2 BOQ. 2025 08 28 rev.05 — commented 250925*
  (OPW101, One Portwood Residences / Megaworld). 10 sheets, 1,207 priced lines across the four
  trade BOQs, plus four billing twins and a separate 793-line master billing.
- **PMI** — *MST347. OPS. VO-PMI 29.2 — Cost Proposal for Supply & Installation of Rangehood
  (rev1)* (My Enso Lofts / PH1 World Developers). 14 pages.

---

## 1. What already exists (so B1 is smaller than it looks)

**The middle link of B1 is built.** `2026-08-21-class-codes.sql` seeded the Finance chart —
**702 Level-3 codes / 205 groups / 42 divisions** in `class_codes`, admin-owned, readable by any
approved user — and added **`project_schedule.class_code`** with an index, a picker (never a
free-text box), a WBS roll-up, search across all three description levels, Global Change, and
three grouping levels (Division / Group / Item).

So `BOQ item → class code → activity` is a two-hop join whose **second hop already works**.
B1 is really: *store the client's BOQ lines, map them to class codes, and decide how a quantity is
attributed to the activities that carry that code.*

⚠️ **Never de-zero a class code.** The template's de-zeroed column is not unique — `015051`
(Gen Req › Earthmoving) collides with `15051` (Metal Works › Railings), and `017151` with `17151`.
The padded code is the key. Already documented in the migration; it bites hardest on a BOQ import,
where the client's own numbering is arbitrary and the urge to "normalise" is strongest.

---

## 2. What the real BOQ actually looks like

Every design decision below comes from this. The headline: **the format varies not just between
clients, but between sheets of the same workbook.**

### 2.1 Ten sheets, four of them the actual BOQ

| Sheet | Rows | Role |
|---|---|---|
| `Architectural` | 901 priced lines, 235 headings | trade BOQ |
| `HS-SP` (hardscape & swimming pool) | 71 / 41 | trade BOQ |
| `IFO HL&LL` (interior fit-out, hallway & lift lobby) | 187 / 40 | trade BOQ |
| `ACOUSTIC` | 48 / 8 | trade BOQ |
| `… (Billing)` ×4 | — | billing twin of each trade sheet |
| `BILLING BREAKDOWN ` (trailing space), `Summary` | — | a **different** contract's billing (§4.3) + bid reconciliation |

⚠️ **The header row and column offset differ per sheet, inside one file:**

| Sheet | header row | first column |
|---|---|---|
| Architectural | 12 | A |
| HS-SP / IFO / ACOUSTIC | 10 | **B** |
| the four `(Billing)` twins | 7 | **B** |

So **header detection must be a search, never a fixed offset** — the same `findHeader` /
`gridOf` approach the Drawing Register importer already uses, and for the same reason.

### 2.2 Item numbers are hierarchical — and **not unique**

Numbering runs `DIV 1` → `1.1` → `1.1.1` → `1.1.2.1`, four levels deep. But in Architectural,
**13 of 901 numbered lines are duplicates**, and the pattern shows why: rows 17–20 are numbered
`1.1.2 … 1.1.5` as *leaves* under heading `1.1.1`, then row 21 restarts `1.1.2` as a *heading*.
The client's own numbering is inconsistent.

⚠️ **Therefore `item_no` is a display label, never a key and never the hierarchy.** Identity is
`(revision, sheet, source_row)`. Parent/child comes from the heading/leaf structure, with the
item number used only to *propose* nesting and shown to the planner for confirmation.

### 2.3 Headings and leaves are structurally distinct — and both carry meaning

A heading carries `Total of 9.1 >>` / `Sub-Total of 9.1.1 >>` beside its amount column; a leaf has
a unit and a quantity.

⚠️ **The marker is the only reliable discriminator — a heading can also carry a unit and a
quantity** (`DIV 5 | METALS | lot | 1`). Using "has unit + qty" as the test double-counts an entire
sheet's weights; see §4.5 trap 2, where it doubles HS-SP's contract value.

⚠️ **On three of the four sheets the leaf description is a LOCATION, not a specification.**

```
9.1.1     WF-1.02C: Low Wall, Machine Pressed Laminate      ← heading = the SPEC
9.1.1.1     to Hallway & Lift Lobby at 3rd floor   m2  308.7  ← leaf = WHERE it goes
9.1.1.2     to Hallway & Lift Lobby at 5th floor   m2  308.7
```

This is enormously useful and it drives §3.3:

- **The class code belongs to the heading** (the spec is what maps to a Finance code).
- **The quantity belongs to the leaf.**
- **The leaf's text is a location string** — a direct bridge to `project_schedule.location`, and
  the module already has a location matcher (`locMapPlan` / the Match-WBS wizard) built for
  exactly this shape of text.

⚠️ But `Architectural`, the biggest sheet, does **not** follow this — its leaves are ordinary
descriptions with `m2` / `lm` / `set` units. So heading-vs-leaf semantics are **per sheet**, not
a global rule, and the importer must not assume either.

### 2.4 The amount column is not always a number

Real values found in `TOTAL AMOUNT`: **`Included in Package 1` (16), `n/a` (4), `By Megaworld`
(2)**, `Consideration : One side only` (1).

⚠️ These are **scope-boundary statements, not missing data.** "Included in Package 1" and "By
Megaworld" are contractually load-bearing — they are exactly what a claim turns on later. Store
the text verbatim in an `exclusion_note`, flag the line's kind, and **exclude it from every
quantity and money roll-up** rather than coercing it to 0. A zero and a "someone else is doing
this" are different facts.

The sheet also carries a colour-coded legend — *FOR DELETION*, *FOR INCLUDE TO OTHER SCOPE OR
REGR* — as fill colours on rows. ⚠️ Worth reading on import (openpyxl exposes fill), but **as an
advisory flag for review, never as an automatic delete**; a colour is one person's markup.

### 2.5 Material and labour are split natively

`UNIT COST → MATERIAL | MATERIAL COST | LABOR + CONS | LABOR COST | TOTAL AMOUNT`.

⚠️ **This is the same shape as the PMI cost proposal** (§5.5), which is what makes §4.6 possible:
one line-item table serves the contract BOQ and variation pricing alike.

### 2.6 Line totals are authoritative; unit rates are rounded displays

Measured on the PMI sheet: displayed rates `5,892.86` and `1,339.29`, true rates `5,892.857142…`
and `1,339.285714…`. Recomputing `qty × displayed rate` gives **₱8,707,508.60** against the
sheet's **₱8,707,500.00** — an **₱8.60 error on a two-line sheet**, compounding across 1,215.

**Rule: import `amount` as given. Derive the rate for display only; never write a derived rate
back.** Where a client BOQ gives a rate but no amount, compute it and **mark the line derived**,
so a later reconciliation can tell the client's figures from ours.

Same class of artefact appears at the totals: the PMI prints `12,873,167.99` where `D + E` is
exactly `12,873,168.00`, and the module's existing suite already asserts a **1-peso** gap against
the Avesta screenshots. **Assert these; never "fix" our arithmetic to match a rounding artefact.**

The `Summary` sheet also carries **`#REF!`** — a broken formula in the client's own file. Import
must survive error values, not abort on them.

### 2.7 It is revision 5, with comments, and a PO against it

The filename says `rev.05 - commented 250925`; `Summary` says `UPDATED PO 2025 10 20`,
`PO#30014424`, bid ₱1,031,765,228.24 → ₱1,155,577,055.63 (= ×1.12, VAT confirmed at contract
level). Revisions and a per-revision reconciliation against the bid are the normal case, not an
edge case.

---

## 3. B1 — the design

### 3.1 Tables

| Table | Holds | Why separate |
|---|---|---|
| `boq_revisions` | rev no., issued date, source file, sheet inventory | rev.05 exists; supersession must be visible |
| `boq_items` | client lines **verbatim** — sheet, source row, item_no, description, unit, qty, material/labour rates + amounts, total, `line_kind`, `exclusion_note`, parent | the contract document |
| `boq_class_map` | BOQ line → `class_code`, + author, timestamp, source of the suggestion | mapping is a **judgement**, must be auditable and re-runnable |
| `boq_allocations` | BOQ line → activity, with a share of quantity | one code covers many activities (§3.3) |
| `boq_import_profiles` | per-sheet column map + header row + detection rules | §3.2 |

⚠️ **`boq_items` is append-and-supersede, never edited in place.** It is the client's document. A
remeasure or a revised BOQ is a **new revision**, with the prior retained. Editing stored lines
destroys the only record of what was tendered, and every claim argument turns on exactly that.

⚠️ `line_kind` (`measured` | `lump_sum` | `provisional` | `excluded` | `heading`) is **required,
not cosmetic**. Lump-sum and provisional lines carry money but no measurable quantity; if they
enter a quantity roll-up they silently corrupt every productivity rate derived from it.

### 3.2 Import: a saved profile per sheet, because the format varies

Given §2.1, a single hard-coded parser cannot even read one workbook. The importer:

1. **Detects** — finds the header row by searching for `ITEM DESCRIPTION` (etc.), infers the
   column map and the heading/leaf rule, per sheet.
2. **Previews** — shows the planner what it found: sheets, line counts, heading/leaf split, the
   non-numeric amounts, unmapped columns, and a sample.
3. **Saves the accepted profile** to `boq_import_profiles`, keyed by client/project, so the next
   revision of the same BOQ imports without re-deciding — and a new client starts from detection
   again.

⚠️ **Detection proposes; the planner accepts.** A silently-wrong column map produces a BOQ that
looks complete and is wrong in the money column — the worst possible failure here.

### 3.3 Mapping to class codes — **per BOQ, seeded from a learned library**

The mapping differs from BOQ to BOQ (client vocabulary, trade splits, bespoke items), so:

⚠️ **`boq_class_map` rows are scoped to the BOQ revision. There is no global "description → class
code" table that silently applies itself.** Two clients calling something "Wall Systems and
Cladding" may legitimately mean different Finance codes, and a global map would apply one project's
judgement to another with nothing on screen to say it had.

But mapping ~1,200 lines by hand for every project is not viable either, so:

- A **suggestion library** accumulates from accepted mappings — normalised description text →
  class code, with hit counts and last-used-on. It also matches on **item-number path**
  (`DIV 9 › 9.1 › Wall Systems and Cladding`) and on the client's own division headings, which map
  onto Finance divisions far more stably than free text does.
- On import, every line arrives with a **proposed** code and a confidence, sorted worst-first.
- The planner accepts in bulk (a whole heading, a whole division) or overrides per line.
- **Only accepted mappings are stored**, and each stores *how* it was arrived at (suggested /
  bulk-accepted / hand-picked), so a later audit can tell a considered mapping from a bulk accept.

⚠️ **Map at the heading level where the sheet supports it** (§2.3). On IFO / HS-SP / ACOUSTIC one
heading covers 2–16 location leaves, so mapping 40 headings covers 187 lines. That is the
difference between a viable workflow and an unusable one — and it falls out of the document's own
structure rather than being imposed on it.

### 3.4 The hard part: one class code covers many activities

`class_code` on an activity is a **tag**, not a key — "Rebar Works" is one code carried by forty
floor-level activities. A BOQ line therefore cannot be attributed to *an* activity; it must be
**allocated across** them.

Three ways to split, in the order they should be offered:

1. **By location match** — the leaf text (`to Hallway & Lift Lobby at 3rd floor`) against
   `project_schedule.location`. On the fit-out sheets this is near-exact, and the schedule module
   **already has the matcher** (`locMapPlan`, the Match-WBS-to-locations wizard, `locNormKey`'s
   ordinal folding). This should be the first thing tried, not an afterthought.
2. **Pro-rata by an existing measure** — activity duration, labour units, or an equal split across
   the location breakdown. Fast, and right often enough to be a good proposal.
3. **Explicitly, by hand** — always available; the only defensible option on a lump-sum line.
4. **Unallocated** — a real, visible state, and the planner's worklist.

⚠️ **A proposed split must be accepted before it is stored.** An auto-split written silently
becomes indistinguishable from a planner's own figures, which defeats the point of an auditable
allocation table. Same rule the location wizard already follows: propose → preview → apply.

⚠️ **Allocations must reconcile and the UI must say when they don't.** Σ allocated ≤ line qty, with
the remainder shown. Silent over-allocation is a wrong S-curve.

⚠️ **Do NOT add `quantity`/`unit` to `project_schedule`.** That was the alternative in the
vendor-performance note and it is now rejected: it would make a third place quantities live (client
BOQ, allocation, activity) with nothing keeping them in step, and the activity copy is the one
everybody would read. An activity's quantity is **derived** from its allocations — a view or an
RPC, not a column.

### 3.5 What this feeds

- **F2 / F6 (vendor performance):** planned qty per activity per trade against
  `productivity_entries`' actual installed qty → a real productivity rate, and its inverse
  `duration = qty ÷ (rate × crew)` for the schedule builder.
  ⚠️ **BOQ quantity and installed quantity are not the same number and must not be forced to
  agree.** BOQ qty is measured *for payment*; productivity output is measured *for progress*.
  Waste, remeasure, provisional sums and cut allowances separate them legitimately. The variance
  is itself information (over-consumption, or a remeasure claim) — report it, never reconcile it
  away.
- **Cash Flow:** BOQ value is the natural cost-weighted S-curve basis, which
  `cash_flow_settings.scurve_basis = 'cost'` already supports but currently sources from
  `planned_cost`/`bl_cost`.
- **C1 / packages:** a bill or trade sheet is usually how a contract package is scoped — this file
  *is* "Package 2".

---

## 4. The billing sheets — monthly POC and revenue

**These are the point of the workbook, not an afterthought.** Every figure below was verified
against the file; the arithmetic closes exactly.

### 4.1 A billing sheet is the trade BOQ plus a period's progress

Same lines, same order, plus ten columns:

```
... TOTAL AMOUNT | WT %
| Previous Accomplishment       : Rel. %age | %Wt. | Amt. (Php.)
| Accomplishment for this Period: Rel. %age | %Wt. | Amt. (Php.)
| Accomplishment to Date        : Qty | MATERIALS | LABOR | Rel. %age | %Wt. | Amt. (Php.)
```

Worked line (Site Supervision, 22 mos @ PHP 1,220,000 = PHP 26,840,000):

| | Rel. %age | %Wt. | Amt. |
|---|---|---|---|
| Previous | 0.136364 | 0.00261903 | 3,660,000.00 |
| This period | 0.136364 | 0.00261903 | 3,660,000.00 |
| **To date** | **0.272727** | **0.00523807** | **7,320,000.00** |

Every identity holds exactly:

- `WT % = line amount / sheet total` — and **sum of WT % = 1.000000** on all five billing sheets.
- `%Wt. = WT % x Rel. %age`
- `Amt. = line amount x Rel. %age`
- `previous + this period = to date` (9.6718% + 7.5741% = **17.2459%**, exact)
- **Project POC = sum of %Wt.** — a cost-weighted percent complete straight off the BOQ.
- **Revenue to date = sum of Amt. = contract x POC** — verified **PHP 241,004,906.59 at 17.2459%**.
- To-date `MATERIALS + LABOR = Amt.`, so the material/labour split survives into revenue.

### 4.2 Therefore the only stored input is one number per line per period

⚠️ **Store `rel_pct` and derive everything else.** `%Wt.` and `Amt.` are pure functions of the
line's amount, the sheet total and `rel_pct` — persisting them means they silently disagree with
the BOQ the moment a revision changes a quantity. Same "derive, don't persist" rule as
risk-register's rating and productivity-rates' rate.

```
boq_billing_periods (billing_no, period_start, period_end, po_no, contract_total, status)
boq_progress        (period_id, boq_item_id, rel_pct)          <- the ONLY input
```

`previous` need not be stored either: it is the to-date of the prior period. ⚠️ But **each period
must snapshot the BOQ revision it was billed against** — a later remeasure must not retroactively
rewrite a submitted billing.

⚠️ **The billing period is not a calendar month:** *February 26 2026 – March 25 2026*, PO
`4100125091`, *PROGRESS BILLING NO. 3*. Cash Flow and the S-curve are monthly, so the mapping from
billing periods to months must be explicit, not assumed.

### 4.3 ⚠️ WT % is relative to its own SHEET, not the contract

Each sheet states its own *Total Contract/Project Cost* and weights against that. The four Package 2
trade sheets sum to the contract:

| sheet | total | share |
|---|---|---|
| Architectural | 1,015,731,442.96 | 87.90% |
| IFO HL&LL | 63,558,128.47 | 5.50% |
| HS-SP | 57,205,293.93 | 4.95% |
| ACOUSTIC | 19,082,190.24 | 1.65% |
| **total** | **1,155,577,055.60** | |

and that total equals the `Summary` bid **PHP 1,031,765,228.24 x 1.12 = PHP 1,155,577,055.63** —
VAT confirmed, set complete.

⚠️ **So WT % cannot be summed or compared across sheets, and a project POC is not the average of
the four.** It must be re-weighted by each trade's share. A naive average would let ACOUSTIC (1.65%
of the contract) move the project POC as much as Architectural (87.90%).

⚠️ **`BILLING BREAKDOWN ` is a different scope, not the roll-up.** Stated total
**PHP 1,397,462,269.86**, scope *"COMPLETE CIVIL/STRUCTURAL..."*, and different quantities for the
same descriptions — Site Supervision is **22 mos @ PHP 1,220,000** there against **34 mos @
PHP 971,695** on the Architectural sheet. Summing it with the trade sheets double-counts.

### 4.4 This is where the schedule's IBB columns already point

The Project Schedule grid already carries **Planned Value POC / Earned Value POC / Planned IBB /
Actual IBB to date / Earned Value IBB / At Completion IBB / BL Planned IBB** (from the OPC import
work), and Cash Flow's cash-in is *contract IBB x delta S-curve %*. The billing sheet is the
authoritative source for exactly those numbers, which are presently maintained by hand.

⚠️ **Two POC systems will now exist and they must not be silently merged.** The schedule's
duration- or cost-weighted `schedule_scurve_agg` is the *progress* POC; the BOQ billing POC is the
*contractual/revenue* one the client pays against. They legitimately differ. **Reconciling them is
a report, not an override** — and that variance is one of the most useful things this module could
show a PM.

### 4.5 Import traps — all found in this one file

1. ⚠️ **The sheet name has a trailing space** — `'BILLING BREAKDOWN '`. An exact-name lookup throws.
2. ⚠️ **Heading rows can carry a unit and a quantity *and their own WT %***: `DIV 5 | METALS | lot |
   1`. Counting them double-counts the weights — HS-SP then reads **sum of WT % = 2.000000** and a
   contract of **PHP 114,410,587.84** instead of the true **PHP 57,205,293.92**. **The discriminator
   is the `Total of X >>` / `Sub-Total of X >>` marker, never the presence of unit/qty.**
3. ⚠️ **The twins are not reliably the same data.** Architectural (901 lines), HS-SP (71) and IFO
   (187) match their trade sheets line-for-line and to the peso — but **ACOUSTIC's trade sheet is
   entirely unpriced (PHP 0.00) while its billing twin carries PHP 19,082,190.24**, with only 2 of
   48 lines agreeing. Importing trade sheets only would silently lose a whole trade's value.
4. `#REF!` rows appear as real rows (5 in HS-SP billing). Import must survive them.
5. ⚠️ **Reconcile the sum of lines against the sheet's own stated contract total, and refuse on
   mismatch.** Worked example from this analysis: a plausible-looking filter that skipped rows whose
   unit text contained `"unit"` silently dropped **PHP 20,667,260.59** of plant (Tower Crane,
   Elevators, Generator Set, Skidloader — UoM literally `unit`). The sheet was fine; the reader was
   wrong, and only the reconciliation caught it. **This is the single most valuable gate in the
   importer.**

### 4.6 Decision: import both, as lines + progress

The earlier open question ("import the twins, or treat billing as a view?") is answered:
**a billing sheet is not a view of the trade sheet.** It is the same lines plus a period's progress,
and for ACOUSTIC it is the only priced copy.

- The **trade sheet** supplies the lines -> `boq_items` (once per revision).
- Each **billing sheet** supplies a period -> `boq_billing_periods` + `boq_progress`, matched back
  to `boq_items`.
- ⚠️ **Where the two disagree on price, show the disagreement and make the planner choose the
  priced source.** Silently preferring either one would have produced a PHP 19M error here.

---

## 5. B2 — PMI tracking

### 5.1 A filed PMI is a case file, not a form

The sample is **14 pages and five distinct documents**:

| Pages | Document | Author |
|---|---|---|
| 1 | Cost proposal — the priced response, with its build-up | Megawide |
| 2 | The client's **PMI form** — ref, date, scope, transmittals, signature matrix | PH1 World Developers |
| 3–5 | Product photos + design-manager approval | Megawide / supplier |
| 8–11 | Performance testing report (`EPC-ENG-TRN-26553a`) | MCC Engineering |
| 12–14 | Supplier sales contract (Kin Long, `JS20260506-01`) | Vendor |

⚠️ **So a PMI record needs many typed attachments, not one `file_url`.** A single file column
cannot answer "has the cost proposal been submitted?" separately from "is the testing report
attached?" — which is exactly what a QS asks when chasing one.

Needs a **private `contracts-claims` storage bucket** (the 2026-06-18 migration created only
`drawing-register`, `progress-photos`, `material-submittal`), following drawing-register's pattern:
store the object **path**, sign on demand, never store a URL.
⚠️ Its INSERT policy should be **`is_writer()`**, not the older buckets' `is_approved()` — that
legacy rule lets a viewer upload into a register they cannot write a row to, an orphan by
construction. Precedent already set by `mom-attachments` (2026-08-21).

### 5.2 Two reference numbers, both real

- Client's: **`MEL.CON.PMI-029`** — on their form.
- Megawide's: **`MST347. OPS. VO-PMI 29.2 (rev1)`** — project code, department, our own sequence.

⚠️ **Store both, search both.** A single `reference_no` forces a choice, and the number you drop is
the one the other party will cite. That is how a claim becomes unfindable in the meeting where it
matters.

### 5.3 Numbering is hierarchical *and* revisioned *and* spawning

`PMI 29` is the parent instruction (rangehood + in-line fan + cooktop). `PMI 29.2` is one cost
proposal under it (rangehood only). `rev1` is a revision of that proposal. **Three levels**, and a
flat `reference_no` collapses all three into a string nobody can group by.

- `parent_id` self-reference for 29 → 29.2.
- Revisions as their own rows with `supersedes_id`, latest flagged — **never overwritten**. A
  superseded proposal is the evidence for what changed and why.
- ⚠️ The form also says *"Separate PMI for site implementation will be issued upon approval of the
  cost proposal."* — one PMI **spawns** another. That is a third relation, distinct from parent and
  from revision; conflating them loses the chain.

### 5.4 The lifecycle is long and two-sided

Dates on the sample: issued **09-Jan-2025** → received by MCC **08-Feb-2025** → cost proposal
**24-Jun-2026** → testing **25-May-2026**. Roughly **18 months**.

The module's existing four-stage pipeline (*Estimated → Submitted → Evaluated → Client Approved*)
is the **commercial** track and is correct. What it does not carry:

- **Receipt.** The instruction arrives before we estimate anything. Time sitting on an un-responded
  PMI is *our* exposure, and it is invisible today.
- **The internal approval chain within a stage.** Four MCC roles (Prepared / Confirmed /
  Recommending Approval / Approved for Submission — Office Supervisor → MEPF & Finishing Manager →
  Project Manager → COO) and four client roles (Prepared / Checked / Noted / Approved, + D&C Head).
  A proposal three weeks with the COO is not "Submitted" — it is *not submitted at all*.

⚠️ **Aging must be per-stage, derived, never stored** — days since receipt while un-responded, days
since submission while pending, days in internal approval. One aging number over a 16-month case
answers nothing. The existing rule (`daysBetween` in UTC, null when decided, null on a future date,
no negatives) carries over unchanged.

⚠️ **Recovery rate stays over decided records only.** Already load-bearing: the naive denominator
read **0.2%** on the real fixture where the honest figure was **85.0% of 1 decided record**. A
long-lived PMI register makes that worse, not better.

### 5.5 The cost build-up is a contractual formula, not an amount

```
A  Direct cost (material + labour), VAT-ex        8,707,500.00
B  A + (A × 10%)   markup                         9,578,250.00   (markup   870,750.00)
C  B × 20%         "Fix Cost"  — As per Contract  1,915,650.00
D  B + C                                         11,493,900.00
E  D × 12%         VAT                            1,379,268.00
F  D + E           TOTAL                         12,873,168.00
```

⚠️ **The percentages are marked "As per Contract" — per-contract terms, not constants.** Another
client will have a different markup, a different fix-cost basis (or none), a different VAT
treatment (zero-rated, or VAT-inclusive as Cash Flow's `vat_percent` checkbox already handles).
Hard-coding 10 / 20 / 12 produces confidently wrong proposals on the next project.

Store the build-up as an ordered, per-contract **rate card** (`contract_cost_terms`): each step a
label, a basis (which earlier step it multiplies), and a rate. A proposal's total is then derived
from its lines + the card, and the same card prints the sheet.

⚠️ **Store the priced lines, not just the total** — quantity, UoM, vendor, material/labour split.
They answer "what did we price the rangehood at" a year later when the remeasure lands.

### 5.6 The unifying insight: a PMI cost proposal *is* a BOQ

`1,204 units, material rate, labour rate, total` is exactly the shape of §2.5. So the priced lines
of a PMI go into **`boq_items` with a scope tag**, not a parallel table:

- `scope_type = 'main_contract'` → the client BOQ,
- `scope_type = 'change_order'` + `pmi_id` → a variation's priced scope.

This is the **same axis `project_schedule.scope_type` already uses** (2026-08-19), so a variation is
measurable, mappable to class codes, allocatable to activities, and rolls into the S-curve exactly
like contract work — while still reporting separately as where-the-money-came-from. Two parallel
line-item tables would have guaranteed they drift.

⚠️ It also closes a real gap: **variation work currently carries no quantities anywhere**, so a
change order can be scheduled but its productivity can never be measured.

### 5.7 "PMI format varies by client" — the design answer

**Model what is invariant; attach the form; make the variable parts configuration.**

Invariant everywhere: an instruction is *issued*, it *describes scope*, we *respond with a priced
proposal*, it is *adjudicated*, and it may become a *change order* and/or an *EOT*. That is the
record.

Variable, therefore configuration on a **client/contract profile**:
- field **labels** ("PMI" / "Site Instruction" / "Architect's Instruction" / "Variation Order"),
- the **reference-number pattern**,
- the **cost build-up card** (§5.5),
- the **required-attachment checklist** — which of the five document types this client demands
  before a submission counts as complete,
- the **approval roles** on each side.

Plus a `raw jsonb` on the PMI row for genuinely client-specific fields that fit nowhere — the same
escape hatch `activity_codes` / `udf` / `location` already use, and the same rule: it is for fields
nothing queries.

⚠️ **Do not build OCR / auto-parsing of arbitrary client PMI PDFs.** It is the tempting answer to
"the format varies" and it is the wrong one: the sample is a 14-page bundle mixing a spreadsheet
print, a scanned form, photos and a supplier contract, and a mis-parsed amount in a claims register
is worse than no amount — it will be quoted at a meeting. **Type the header fields, attach the
file.** If parsing is ever attempted, restrict it to *our own* cost-proposal sheet, a Megawide
template with a known layout.

---

## 6. Sequencing

```
class_codes ✅ + project_schedule.class_code ✅
        │
        ▼
B1a  boq_revisions + boq_items + boq_import_profiles   (detect → preview → accept → import verbatim)
        │
        ├─► B1d  boq_billing_periods + boq_progress   (rel_pct only; POC + revenue derived)
        │            └─► monthly POC, revenue, and the schedule's IBB columns
        │
        ├─► B1b  boq_class_map        (per-revision, seeded by the suggestion library)
        │            │
        │            ▼
        │       B1c  boq_allocations  (location match → pro-rata → manual; propose then accept)
        │            │
        │            ├─► F2 / F6  planned vs installed qty; rate library → durations
        │            └─► Cash Flow cost-weighted S-curve basis
        │
        ▼
B2a  contracts-claims bucket + typed attachments
B2b  PMI record: dual refs, parent/revision/spawn links, receipt stage, per-stage aging
B2c  contract_cost_terms rate card → priced lines into boq_items (scope_type='change_order')
        │
        └─► variation work becomes measurable → F2/F6 cover change orders too
```

B1a→B1b→B1c is the critical path for the vendor chain. B2 runs in parallel until B2c, which wants
`boq_items` to exist.

---

## 7. Open decisions

1. **Allocation granularity** — `boq_item → activity` (per line) or `class_code → activity` (one
   split serves every line on that code)? **Recommendation: per line**, because the line carries the
   quantity and the money — with bulk tools to apply one split across a whole heading or division.
2. **Does the BOQ define the packages?** A trade sheet usually maps to a contract package (C1), and
   this file *is* "Package 2". Offering *"create packages from BOQ sheets"* is cheap and useful;
   auto-creating them is not.
3. **How far does the suggestion library reach?** Within a project only, within a client, or across
   the portfolio? Cross-portfolio learns fastest and risks applying one client's vocabulary to
   another. **Recommendation:** suggest across the portfolio, but always show the source and never
   auto-accept.
4. **Who owns the mapping?** `class_codes` is admin-owned Finance data, but BOQ mapping is a
   QS/planner act. Suggest planner-owned under the standard project-scoped RLS, rows stamped with
   author + timestamp.
5. ~~**The `(Billing)` twin sheets**~~ **ANSWERED in §4.6** — import both: lines from the trade
   sheet, progress from each billing sheet. They are not views of each other.
6. **Billing period → month mapping** for Cash Flow and the S-curve. Periods run 26th→25th.
   Pro-rata by days, or assign each period to the month holding its end date? Needs a call.
7. **Which POC leads a report?** Billing POC is contractual; schedule POC is progress. They differ
   legitimately — confirm the variance is surfaced, never auto-reconciled (§4.4).
