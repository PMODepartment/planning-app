# Module: contracts-claims

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
