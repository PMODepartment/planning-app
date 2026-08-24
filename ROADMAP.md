# Planners Dashboard — Roadmap (captured 2026-08-19)

Owner's requirement dump of 2026-08-19, broken into scoped work items with the files each
one actually touches. Nothing here is implemented yet — this is the agreed backlog.
Order below is the proposed sequence (shell/navigation first, then per-module features),
not a commitment; the owner picks what ships next.

---

## A. Shell & navigation

### A1. Align UI with the Procurement (PRC) App — same icon/logo sizes ✅ done 2026-08-19
Reconciled to PRC's own values, verified in a browser against the shipped CSS:
- `.pd-brand` is now full-bleed with PRC's `18px 20px 16px`, and `.pd-brand-logo` has **no
  max-width** — the wordmark measures 200px in a 240px sidebar, identical to PRC. The old
  `188px` cap was the whole reason it read smaller.
- Nav rows `9px 12px` / 13px, nav icons **16px** with a 10px gap (`.pd-navico svg` now
  scales the 18px glyph icons.js emits), section labels 9px at a 20px indent, topbar mark 26px.

### A2. Remove project foldering — go straight to projects ✅ done 2026-08-19
**Owner's decision: the group-head data stays, for filtering only.** No migration.
- The left group-head pane and the topbar context chip are gone; `projects.html` opens
  straight onto the project list.
- Group head is now a toolbar `<select>` filter (`#gh-filter`) with counts, plus a gear
  (`#gh-manage`) that edits the selected head — nothing that was reachable in the pane was
  lost. "New Group Head" stays in the **+ Add** menu.
- **Group by** defaults to `None` (was `Group Head`), so the landing view is flat. Grouping
  by group head or status remains available as an opt-in lens.

### A3. Separate Project and Package — Package lives inside Project ⚠️ partly done 2026-08-19
**The entity exists; module adoption does not.**
- `migrations/2026-08-19-packages.sql` (**OWNER MUST RUN**) creates `packages`
  (project_id, code unique-per-project, name, status, dates, contract_amount) with the
  same RLS shape as every project-scoped module table, plus an `updated_at` trigger.
- `PDb.getPackages/createPackage/updatePackage/deletePackage`; the Dashboard manages them
  and selects one into `pd_package` / `pd_package_name` (cleared on any project switch).
- ⚠️ **A package is NOT the Main-Contract/Change-Order split** — that is `scope_type`, an
  activity-level tag from `2026-08-19-schedule-contract-scope.sql`. Orthogonal axes; an
  activity can be "Package 2" *and* "change_order". C1 builds on both, not on one.
- **Still open:** no module table carries `package_id` yet, so selecting a package does not
  filter module data. Adoption is per module — the column and the UI that sets it must land
  together. Contract documented in `MODULE_CONTRACT.md` §6b.

### A4. Project landing page is a **dashboard** ✅ done 2026-08-19
`dashboard.html` is now a real dashboard: project KPIs (status/group head, budget vs estimate,
forecast dates, location), the Packages panel, and the module tiles. The launcher moved to a new
**`modules.html`**, reachable from the sidebar and from a button on the dashboard; module
back-links point at it. `MODULE_V` moved out of `dashboard.html` into the new shared
`assets/js/modules-grid.js` — **bump it there from now on**.

### A5. Dashboard for all modules ✅ done 2026-08-19
Each module publishes its own tile spec as `dash` on its `config.js` entry
(`{table, unit, attention?}`); `PDb.moduleSummary` reads only what the module declared — the
shell never reaches into a module's tables. Tiles show a row count, an optional
"needs attention" figure, and last-updated.
- ⚠️ Counts use a HEAD `count:'exact'` request, **not** `select().length` — PostgREST caps a
  read at 1000 rows, so a big project's schedule would report 1000 activities forever.
- ⚠️ `attention` is declared **only where the schema fixes the vocabulary** (risk_register
  `Open`; issues_lessons `Open`/`On Hold`). Contracts & Claims has a `status` column with no
  fixed vocabulary, so it claims no attention figure — a guessed one reads 0 forever and looks
  like good news. Fixing that is part of B2.
- One module's broken spec (or an unmigrated table) degrades to "Summary unavailable" on that
  tile only.

---

## B. Contracts & Claims (`modules/contracts-claims/`)

### B1. Client BOQ upload → internal class codes → activities
- Upload the client BOQ (xlsx/csv), persist raw line items, then a two-stage mapping UI:
  BOQ item → internal class code → schedule activity. Mappings must be saved, reusable,
  and auditable (who mapped what, when).
- Feeds C1 and the Cash Flow module (BOQ value is the natural S-curve basis).

### B2. Claims Register with PMI tracking
- Claims register with PMI (Potential/Pending Milestone-Impact) tracking per claim:
  status, entitlement, time impact, cost impact, linkage to the schedule activity and to
  the change order it may become.

---

## C. Project Schedule (`modules/project-schedule/`)

### C1. Separate Contract Packages and Change Orders ✅ done 2026-08-19
**The two axes are now separate columns and separately filterable — that separation *is* C1.**
- `migrations/2026-08-19-schedule-package.sql` (**OWNER MUST RUN**) adds `package_id` to
  `project_schedule` **and** `wbs_nodes` (FK to `packages`, `on delete set null`), plus
  `admin_delete_package()` which refuses while activities/branches are still assigned and says
  how many. `PDb.deletePackage` now calls that RPC.
- The schedule gets a **Package** column (inline-editable, inherited down the WBS like `phase`
  and `scope_type`, "Mixed" roll-up on branches), a **Contract package** filter including
  "— Not assigned —", a **Contract Package** grouping dimension, a field in the activity form,
  and a Package column in the Excel export.
- ⚠️ **`scope_type` (main vs change order) is untouched and stays a separate column.** An
  activity can be Package 2 **and** a change order — a variation raised against the MEPF package
  is exactly that. Deriving either from the other would collapse a real distinction.
- ⚠️ **No default package.** `scopeOf` can honestly fall back to "main contract"; there is no
  equivalent for a package, so unassigned stays unassigned and the "— No package —" bucket is the
  planner's worklist.
- **Not included:** the Schedule Builder push does not set a package (it produces main-contract
  work under no package), and the Dashboard's package rows do not yet show activity counts.

### C2. Change Order activities live inside the schedule, easily filtered ✅ done 2026-08-19
The activities already sat in the same WBS/network (that is what `scope_type` being a tag buys —
logic and float are real). What was missing was seeing and finding them:
- ⚠️ **`.ps-cobar` existed in the CSS and was never emitted** — the Gantt had no change-order
  treatment at all. Now wired, re-cut as a **box-shadow ring** because critical-path (solid red)
  and near-critical (dashed amber) already own `outline` on the same element; a critical change
  order would have had both and one meaning would have vanished. Milestones ring too, and a branch
  whose activities are **all** change orders rings as well (a blended one deliberately does not —
  the Scope column already says "Mixed").
- **A prominent toolbar switch**: Blended / Main / Change orders, each with a live count, sitting
  beside the zoom control instead of three clicks deep in the Filter menu. It hides itself on a
  project with no change orders, and stays in sync with the Filter menu's radios in both directions.
- The bar tooltip now names the change order (with its CO reference) and the package.

### C3. Duration scenarios (rain days), connected to the Calendar ✅ done 2026-08-19
`migrations/2026-08-19-duration-scenarios-and-mom.sql` (**OWNER MUST RUN**). A scenario is a set of
**rules**, not a copy of the durations — a copy is stale the moment anyone edits an activity.
- ⚠️ **Season-aware, because a PH project spans many seasons.** The first cut matched a rule against
  the activity's **start month**, which was wrong twice over: a Feb→Nov activity got no wet-season
  allowance at all, and a Jun–Jul one got it applied to its dry days too. Durations are now split
  **month by month across the span**, and a rule stretches only the months it names.
- ⚠️ **Two mechanisms, not one.** A **rule** makes work slower (×1.25); a **rain day** removes a
  working day outright. They compose, in that order.
- ⚠️ **Rain is per exposure, not per project** — excavation loses half a wet month, interior fit-out
  loses nothing. Profiles are matched by trade, with a no-trade default.
- **Wet/Dry season presets** (Jun–Nov) so months are not retyped on every rule and profile.
- Preview writes nothing; **Apply** is a separate confirmed act and is undoable.
- ⚠️ **First-order by design and stated in the UI:** the month split comes from current dates and the
  preview does not push the change through predecessor logic. It always under-states a slip.

**Working Calendars became a first-class view** (title switcher). The schedule could read and assign
calendars but never create or edit one — the editor lived in Resource & Role Master, which made C3
unusable at the moment a planner needs it. Includes extra non-working days and **bulk-assign a
calendar to a trade**, which is what makes multi-calendar projects practical.

### C4. MOM (minutes of meeting), connected to Issues and Concerns ✅ done 2026-08-19
A new **Minutes of Meeting** view in the schedule's title switcher (tables ship in the same
`2026-08-19-duration-scenarios-and-mom.sql` migration).
- A meeting produces two different things and they are modelled apart: the **record** of what was
  said (`meeting_minutes`, which stays true forever) and **action items** (`mom_items`, each with an
  owner, a due date and a life of its own). Minutes can optionally name the schedule activity
  discussed.
- **Raise as issue** copies an action into the Issues & Concerns register and links the two; the
  register then shows a **From MOM** tag with the meeting it came from.
- ⚠️ **One-way on purpose.** After raising, the register is authoritative for how the issue is
  chased and the minute keeps saying what the meeting said. Two-way sync would give two screens a
  claim on one status.
- ⚠️ Raising is **idempotent**, an empty action is refused, and a failed link never leaves an action
  falsely marked "Raised".
- ⚠️ Deleting an action or the whole minutes **never deletes issues already raised** — said out loud
  in both confirmations, because the opposite is a reasonable thing to assume.

---

## D. Issues & Lessons Learned (`modules/issues-lessons/`)

### D1. Departments can also raise issues ✅ done 2026-08-19
`migrations/2026-08-19-department-issues.sql` (**OWNER MUST RUN**).
- ⚠️ **The audit found the opposite of what the requirement assumed.** The DATABASE already let a
  `user` insert (`is_writer()` = approved and not a viewer); the block was the **UI**, which gated
  every write on planner+. But the same generic policy also let any approved non-viewer **edit or
  delete anyone else's** issue — which nobody intended, and which stops being theoretical the moment
  the UI opens up.
- So the migration **widens nothing at the DB and tightens the write side**: insert = any approved
  non-viewer, stamped as themselves; update = planner on anything, everyone else **only their own**;
  delete = **planner only** (a department must not be able to make a problem it raised disappear —
  closing it is a status, and the record is the point of a register).
- `users.department` added and set in Admin; it **defaults a new issue's department**, so it is not
  retyped — and mistyped — per issue, which would silently split the register's own filter.
- The UI mirrors the RLS exactly (per-row edit button, steward-only delete, `openForm` refusing a
  row the DB would refuse) — where the two disagree the user gets a silent failure.
- ⚠️ Rows with no `created_by` (imported or predating the stamp) are **planner-only**: there is no way
  to know whose they were, and guessing would hand someone rights over a record they never touched.

### D2. Minutes of Meeting — PDF export ✅ done 2026-08-21 (commit `fff2d0e`)
Reproduces `PMODepartment/mom-app`'s `downloadPDF()` field for field via the same html2pdf.js
0.10.1. Offered to read-only viewers too, since exporting is a read. See
`modules/issues-lessons/CLAUDE.md` for the field mapping.
- ⚠️ **Independently re-verified 2026-08-21**: the MOM test suite (sliced from the shipped
  `module.js`, 121 checks) was pointed at this implementation — library-not-loaded and
  no-selection guards, exactly one render at A4/portrait, filename sanitisation across
  punctuation and blank titles, the register-status rule, escaping, and DOM cleanup + button
  re-enable on **both** the success and the thrown-mid-render path. All green.
- ⚠️ Still **not verified signed-in** — no one has opened a generated PDF. The render call
  arguments and the DOM lifecycle are what is proven, not the visual output.

### D3. What mom-app has that this screen doesn't (comparison, not a commitment)
Cloned and read `PMODepartment/mom-app` (a single-file PWA on its own Supabase project, no
relation to this app's schema). The real gaps, roughly in the order they'd likely matter:

1. **Draft → Distributed workflow.** A meeting starts editable; a "Distribute" action locks its
   items against further edit/delete and is the moment lower-permission users can see it at all —
   a genuine publish/finalize gate, reversible back to draft. Our minutes stay editable
   indefinitely by their author or a planner, and read access is already project-wide rather than
   gated on distribution. **This is the biggest single difference**, and it is what makes minutes
   a *record* rather than a live document.
2. **Carry-forward.** Creating a meeting can pull every Open/On-Hold item from a prior meeting of
   the same project in as fresh rows (preserving no./category/responsible/target date) — the
   standard "review last meeting's open items" opening move. We have no equivalent; every meeting
   starts empty.
3. **Item Category + Type.** Each action carries a taxonomy (Commercial/Contracts, Engineering,
   Procurement, Risk, Quality, …) and a Type (Issue / FYI / Report) separating actionable items
   from purely informational ones. `mom_items` has neither — every row is implicitly "an action",
   which is why the PDF export has to synthesise both columns.
4. **Attachments per action item.** File/photo upload straight onto the item (Supabase Storage).
   We have none, and a raised issue in our register carries no attachment either.
5. **SBU org layer above Project**, with a scoped "SBU Admin" role. Out of scope: this app already
   has Group Head + `is_planner`/`is_writer` covering the same need differently. Adopting SBUs
   would be a second parallel org model, not a small addition.
6. **Self-service password reset** (security question) and signup with no admin approval — new
   accounts land as `viewer` and an admin grants more. Ours requires admin approval to activate an
   account at all. A deliberate difference in this app's access model, not an oversight.

**What we have that mom-app doesn't**, so none of this reads as "catch up on everything":
attendees, an activity link into the real schedule (searched server-side rather than a
40k-option `<datalist>`), a one-way raise into a genuine Issues & Concerns register with
idempotency and rollback guarantees, and per-minute ownership permissions (D1's model) instead of
four flat roles.

⚠️ **A bug in mom-app worth NOT copying:** its item-Category options differ between the filter
dropdown and the add-item dropdown (`Finance` exists in one and not the other) — two
hand-maintained lists that have drifted. If items 3 is ever built here, the vocabulary belongs in
one place.

⚠️ **Nothing in D3 is scheduled.** Items 1–4 are genuine gaps worth doing if the owner wants them;
5–6 are different design choices. Listed so the comparison is complete, not as a queue.

## E. Cross-app mirrors

### E1. Procurement in the Project Schedule ✅ done 2026-08-19
`Procurement → <Trade> → <Work package>` inside the schedule's WBS, sourced from the Procurement
(WPM) app. Activity ID = the WP number, name = its description, dates from the WP's award/target
milestones.
- ⚠️ **The `Procurement` skeleton node has existed since 2026-08-03** with
  `source_kind: 'procurement'` and a comment saying it "rolls up the WPM mirror" — and **nothing ever
  populated it**. Exactly the empty-promise state Design Development was in before its writer was
  built. This is that writer; **no migration needed**.
- ⚠️ Reads the `wpm_work_packages` **mirror**, never the WPM app directly — its anon key is public,
  so a browser read would expose every work package's cost. The `sync-wpm` Edge Function does the
  server-side copy. Same rule Cash Flow follows.
- Idempotent (re-sync patches in place), read-only in the grid, and an empty or failed read leaves
  the branch untouched rather than wiping it.
- **Not included:** budgets/awarded cost are deliberately not surfaced on the schedule rows — Cash
  Flow is where procurement money is reported.

### E2. Activity → work-package link, and need-by back to Procurement ✅ done 2026-08-20
`project_schedule.work_package` now holds a WPM `wp_no`, picked from the `wpm_work_packages` mirror
instead of hand-typed. Need-by (earliest start among a package's linked activities) is compared
against WPM's **Target Installation** and pushed back into the Procurement app.
- **No Planners migration** — the existing column was repurposed, so grouping / filter / search /
  Global Change keep working on the same field.
- ⚠️ **Requires `wpm/MIGRATION_planners_need_by.sql` in the WPM project** + deploying
  `supabase/functions/push-need-by` (it reuses `sync-wpm`'s secrets). Both surfaces state what to run
  until then.
- ⚠️ **The write-back does NOT touch `work_packages.target_installation`** — that field is
  procurement-owned. The schedule proposes into a separate table; the buyer adopts it in their own
  form. Anything else silently overwrites another team's authoritative dates.
- **Not included:** budgets stay out of the schedule (Cash Flow reports procurement money, per E1).

---

## F. Vendor performance — schedule x procurement x vendor (planned 2026-08-24)

Full design note: **`docs/vendor-performance-chain.md`**. The chain
schedule -> package -> procurement -> vendor is four-fifths built (A3, C1, E1, E2 + WPM's
vendor management); the missing link is that **the Planners app has no vendor entity** --
`wpm_work_packages` mirrors budgets, dates and status but not `vendor_id`/`awarded_vendor_ids`,
and `productivity_activities.subcontractor` is free text that joins to nothing.

- **F1. Vendor identity** -- extend `sync-wpm` to mirror vendor ids + a `wpm_vendors` table
  (names/trades only, no rates or contacts); add `productivity_activities.vendor_id`.
  Enabling step for everything below.
- **F2. Productivity activity -> work package** -- planned vs. actual quantity per trade per
  month. Blocked on where planned quantity lives (schedule column vs. B1 BOQ).
- **F3. Vendor S-curve** -- `schedule_scurve_agg_vendor()`: the existing
  `schedule_scurve_agg_multi` body with the leaf set filtered by awarded vendor. No new maths.
- **F4. Monthly accomplishment + on-track/problem flags** -- SPI-style ratio, slip days and a
  3-month trend, derived not stored, thresholds from `schedule_thresholds`.
- **F5. Vendor scorecard** -- per vendor across projects, incl. need-by adherence.
- **F6. Basis of internal schedules** -- rate library from `productivity_entries` ->
  `duration = qty / (rate x crew)` in the schedule builder; feeds C3 duration scenarios.

## Cross-cutting notes
- A3 (Project/Package) blocks C1; B1 feeds B2, C2 and Cash Flow — sequence accordingly.
- Every schema item needs a numbered file in `migrations/` plus an RLS check.
- Per-prompt workflow (CLAUDE.md log + commit + push, `MODULE_V` / `?v=` bumps) applies to
  all of the above.
