# Module: contracts-claims

## Two columns that existed since August finally have an editor, and the second insert path is gone (2026-09-08b) — fmlozano

Owner: *"Let's do the half-built and consistency gaps first."* Four items off this morning's audit.
Every one of them turned out to be something the **database already supported** and the UI never
reached — which is why they were cheap, and why nobody had noticed they were missing.

### 1 — ⚠️⚠️ `internal_chain` / `client_chain`: two jsonb columns, ZERO reads in `pmi.js`
`2026-08-25-pmi.sql` declared both `jsonb not null default '{}'` with the reason written into the
migration: *"a proposal three weeks with the COO is not 'Submitted' — it is NOT SUBMITTED AT ALL"*.
The roles were configurable per client from day one (`contract_profiles.internal_roles` /
`client_roles`, ordered, comma-separated) and the record had nowhere to say who was holding it.
Grep: the two column names appeared **0 times** in `pmi.js`. So the register could report an
instruction sitting **94 days** and not say **with whom** — the one fact that makes the number
something a PM can act on this afternoon.

Now: an **Approval chain** section in the case file, ours and the client's side by side, each role a
row with *arrived* / *cleared* / days / signed-by. Three derived facts the module never had:

- **the holder** — who has it now, and for how long;
- **`n` of `m` cleared** per side, as a badge;
- **a third clock in the case-file header** — "In stage 40d" beside "With COO — 31d". `agingOf()`
  answers *how long at this stage*; `chainAgingOf()` answers *how long on one desk inside it*. The
  migration required both and only the first existed.

⚠️⚠️ **A ROLE IS RENAMEABLE AND THE CHAIN IS KEYED BY ITS NAME.** Renaming "COO" to "Chief Operating
Officer" in the profile strands every date recorded under the old spelling. It is **not dropped and
not silently re-pointed**: it renders as an **orphan** row, amber, labelled *"not in the profile's
role list — recorded before it was renamed or removed"*, below the configured roles. Re-pointing by
position would be worse than losing it — it would attribute one manager's sign-off to another. A
**case-only** edit (`coo` → `COO`) IS matched, because that is a typo fix rather than a rename, and
writes always use the profile's current spelling.

⚠️ **ORDER COMES FROM THE PROFILE, NEVER FROM THE JSONB'S OWN KEYS.** Object keys enumerate in
insertion order, which is *data-entry* order — record the COO first and the chain would claim the COO
signs first. The approval sequence is configuration, not a side effect of typing. This is the single
assertion the contrast build below breaks hardest.

⚠️ **`complete` is FALSE on a chain with no roles configured, deliberately.** "Nobody has to approve
this" and "everyone has approved it" are opposite facts, and only one of them should keep the
contradiction note quiet.

⚠️ **THE CONTRADICTION IS REPORTED, NEVER CORRECTED.** A record at **Submitted** whose internal chain
is not cleared is exactly the case the migration was written for — and it is just as often a chain
nobody filled in. Only the planner knows which, so the screen states the disagreement and stops.
Auto-advancing the stage from the chain (or refusing the stage) makes the register lie in whichever
case it guessed wrong. Same house rule as the POC variance on the Billing tab.

- ⚠️ **Two roles holding at once is a real state and is not flattened** — sent to two managers, or a
  mistyped date. The holder is the earlier one in profile order; the summary counts both.
- ⚠️ **An em dash, never 0.** A role that has not received it yet has no duration; a `0d` reads as
  "cleared the same day", the opposite claim.
- ⚠️ **An empty husk (`{in:null,out:null}`) is not an orphan**, and a save omits a role with nothing
  recorded rather than storing one. Storing husks would grow a key per role per save, and the orphan
  detection — whose whole job is to notice a key the profile no longer lists — would start reporting
  rows the planner never touched.
- ⚠️ **The chain saves only on its own button**, and says so. The case file rebuilds its `innerHTML`
  after an upload or a priced line, so an unsaved date would go with it.
- ⚠️ **The register's holder line goes in the existing "In stage" cell, not a tenth column.** The
  table is already nine wide, and "with whom" is not a separate fact from "how long in this stage" —
  it is the answer to the question that number provokes.
- ⚠️ The relations section is relabelled **Related instructions**. `chainHTML()` already existed and
  meant parent/supersedes/spawned; two "chains" in one module is vocabulary inherited from the
  migration, so the screen no longer repeats the ambiguous word.

### 2 — ⚠️⚠️ `claim_id` existed since August and NOTHING COULD SET IT
Same shape. `pmi_records.claim_id` references `contracts_claims(id)` `on delete set null` — *"set
when this instruction becomes priced commercial work"*, and the register already drew a **claim**
chip off it. `claim_id` appeared exactly **once** in `pmi.js`: reading that chip. So the badge was
unearnable and the roadmap's *"promoting a PMI to a contracts_claims row in one click"* was, in
practice, a hand-written `UPDATE`.

**Raise claim / CO…** in the case-file footer, beside the other two things a case file can *become*.

- ⚠️ **THE TYPE IS ASKED, NOT DERIVED.** The tempting rule — money means Change Order, days mean EOT
  — is wrong in both directions: a variation routinely carries both, and whether priced work is a
  change order or a **claim** is a judgement about entitlement, not arithmetic on the proposal.
- ⚠️ **IT WRITES THROUGH `persistRecord`, the claims register's own writer**, handed in by module.js.
  That path carries the missing-column degrade (`_dropMissingNull`, eight attempts, `warnDropped`
  naming the right migration per column) on the one table whose schema is **provably incomplete on
  the live database** — 2026-08-27 confirmed `contracts_claims.package_id` absent. A second insert
  here would be a second set of bugs.
- ⚠️⚠️ **THE CLAIM IS ROLLED BACK IF THE LINK FAILS.** It is written first because the instruction
  needs its id, so a failed `claim_id` update leaves a real commercial record with nothing pointing
  at it — indistinguishable from a duplicate filed by hand, and it would be reported to the client
  as a second variation. If the rollback itself fails the toast names the record to remove by hand.
  Exactly the trap the wizard's package rollback was added for after the owner hit it twice.
- ⚠️ **REFUSED IF ALREADY PROMOTED**, naming the existing record. Two claims for one instruction is a
  **double count** in the register the client is billed from, and it looks exactly like two
  legitimate variations.
- **Every prefill is visible, editable, and says where it came from.** `est_amount` ← the cost
  build-up's TOTAL step; `date_filed` ← **received**, not issued, and not today; `status` ← the
  instruction's outcome, which is a straight copy because the migration deliberately reused
  `contracts_claims`' own four-value vocabulary.
- ⚠️ **`sub_amount` is prefilled ONLY when the instruction has a submitted date.** Copying the card
  total in regardless asserts we submitted at that figure — on a proposal still sitting with an
  internal approver.
- ⚠️ **`package_id` is left NULL.** An instruction carries no package, and inheriting the project's
  only one would claim a commercial lot nobody assigned.
- ⚠️ An EOT writes **days**, a change order writes **money** — never both. The register has separate
  columns and a peso figure on a row whose subject is time is just wrong.
- The instruction is **not** closed or altered. It stays the case file, with its documents, its
  priced lines and its approval chain.
- ⚠️ Absent deps (an older `module.js`) mean the control is **not offered** — never a half-working one.

### 3 — ⚠️⚠️ `openNewRev()` wrote NO `document_id`, so every revision it made was an ORPHAN
**And this corrects entry (2026-09-08a), which said the opposite.** That entry claimed *"`openNewRev()`
writes `document_id` from `DOCID`"* — it did not; the insert had no such key. I asserted it from the
function's purpose rather than from its payload, and the payload is four lines long. Read the insert.

`2026-09-07-boq-documents.sql` made the document the owner of a revision series, and `createDraft`
was given `document_id: f.docId || DOCID || null` for exactly that reason — but this dialog kept its
own copy of the pre-migration insert and never gained the column.

⚠️ **The orphan is not invisible, which is what let it survive.** `load()` filters
`!r.document_id || r.document_id === DOCID`, so a null-document revision shows under **every** BOQ on
the project; two BOQs would both list it, `computeProjectTotal` (which requires `is_current &&
document_id`) would count it under **neither**, and nothing would error.

⚠️ **Fixed by DELETING the second insert path, not by adding the column to it.** The rival insert also
lacked the duplicate-label retry `createDraft` grew after the owner hit
`boq_revisions_project_rev_idx` — so this dialog would still have failed outright on a collision the
wizard recovers from. One writer, one set of rules; the toast now reports the label actually used.
The dialog is also honest about what it does: titled *New revision of `<name>`*, pointing at
**Add BOQ…** for a separately named one, since it is the fallback for a page where `wizard.js` failed
to load and cannot ask.

### 4 — an empty BOQ document is reachable, so a refusal I wrote this morning could go
**Also a correction to (2026-09-08a).** That entry's *"the ONLY revision of a BOQ is refused, and this
one is a real gate"* described a guard around a dead end of my own making. The honest fix is to remove
the dead end.

- The wizard's revision path is now offered on a document with **zero** revisions —
  **First revision of `<name>`**, with copy that does not claim a supersede when there is nothing to
  supersede.
- The `!REVS.length` empty state names the document (*"Main BOQ has no revision yet"*) instead of
  *"No BOQ on this project yet"*, which directly contradicted the picker one line above it.
- The delete refusal is gone; the confirm says the BOQ will be left empty and names both ways out.

⚠️ **`can.rev` was already right and one line silently overruled it.** The step's render gate still
read `if (bdraft || (bdoc && nrev))`, so an empty document rendered **no choices at all** and fell
through to the plain create form — which makes *another* document. Caught in the harness, not by
reading: the two conditions are eight lines apart and each looks correct alone.

⚠️ **The picker's zero-count label was a fifth voice.** `onCount` hard-coded `'Create draft'` when
nothing was ticked — fine while a BOQ run had one ending, wrong the moment there were three: on the
revision path the button said *"Create draft"* under a step promising a revision of a named BOQ. It
now falls back to `boqActionLabel()`. Same button-contradicts-its-own-step defect this wizard was
already fixed for once, reintroduced from the picker side.

### Verified
**40 assertions** executing `chainRows` / `chainSummary` / `chainAgingOf` / `chainConflict` sliced out
of the **shipped `pmi.js`** (loaded whole in a `vm` context, never reimplemented), against the
migration's own example roles — *Office Supervisor, MEPF & Finishing Manager, Project Manager, COO* /
*Prepared, Checked, Noted, Approved*. Twelve groups: profile ordering against deliberately
reverse-inserted keys, the renamed-role orphan, the case-only match, the empty husk, two holders at
once, the Submitted contradiction and its two silent cases, a record with no profile, a null and a
non-object chain, the separate client sequence, and a future arrival date.

**Three contrast builds, to show the suite bites:**

| contrast | result |
|---|---|
| order taken from `Object.keys(ch)` instead of the profile | **7 failures, then a hard `TypeError`** — the orphan row vanishes and `rows[4]` is undefined |
| `complete` without the roles-configured guard | 1 failure — exactly *"complete is FALSE with no roles"* |
| a pending role reporting `0` days instead of `null` | 1 failure — exactly *"days null, not 0"* |

**Rendered in a browser** against the real `module.css`: the two side-by-side ladders, the `3/4
cleared` badge, the three row states, the amber orphan row carrying its dates, and the contradiction
alert reading *"This is at Submitted, but our chain shows 1 of 4 cleared and it is still with COO."*
**The wizard driven through five worlds** — draft+revision, no-draft+revision, empty document, fresh
project, and zero codes ticked — asserting the paths offered, the name field, the rev prefill
(`doc`→00, `rev` with 1 revision→01, empty→00), the three button labels, and that `rev` sends
`createBoqDraft({rev})` with **no `docName`** while `doc` sends one.

⚠️ **Not verified signed-in.** No chain has been written, no claim raised or rolled back, and no
revision created through the repaired fallback against a real project. The rollback ordering and the
`persistRecord` hand-off are structurally verified only — the same standing caveat as the PMI tab's
original build.

- `module.css` / `boq.js` / `wizard.js` / `module.js` / `pmi.js` `?v=20260908b`; `MODULE_V` →
  `20260908b`.
- New: `BOQ.currentDocument()` / `revisionCount()` were added in (a); this adds `PMI.init` deps
  `createClaim` / `deleteClaim` / `claimById` / `gotoClaim`, built in module.js so the claims
  register keeps sole ownership of its table.

### Still open after this
- **Design decision #6** (billing periods 26th→25th against monthly Cash Flow) — still needs the
  owner, still the one open item that changes a reported figure.
- **`trade_map`'s migration has not been run**, so the trade tooltip has still never named a
  procurement trade.
- **`contracts_claims.status` has no fixed vocabulary**, so the module tile still claims no attention
  count.
- The class-code chain's three missing hand-offs (audited in (a), not built).

---

## The Trades step was loading fine — a text-field CSS rule was hiding it (2026-09-08a) — fmlozano

Owner: *"1. The trades in the add BOQ is not loading properly. 2. I have an existing BOQ and I want
to add another BOQ since my first BOQ only covers General Requirement. In the Wizard it says 'Start
a new revision instead' which is misleading with my objective to create a new BOQ. 3. I need a
delete BOQ as well, not just the lines within the BOQ just in case."*

### 1 — ⚠️⚠️ `.ccw-main input` gave every checkbox `width:100%`, and the ladder went off-screen
Nothing was failing to load. All 702 class codes were read, the four panes were built, and the pane
headers even printed their counts (**TRADE 7 · DIVISION 1 · GROUP 17 · ITEM 6**) — the rows were
there with only a checkbox visible, centred, and a horizontal scrollbar under every pane.

`module.css` line 506 said `.ccw-main input, .ccw-main select, .ccw-main textarea { width:100%;
padding:9px 11px; border; background }` — a **text-field** rule, applied to *every* input inside the
wizard's main pane. The Trades step hosts `boq.js`'s four-pane ladder there, so every ladder
checkbox became a text field. **Measured in a browser against the shipped file:**

| | before | after |
|---|---|---|
| ladder checkbox width | **181.75px** (in a 201.75px row) | **13px** |
| `.boq-lad-name` width | 0 | 107px (`"General Requirement"`) |
| pane `scrollWidth` / `clientWidth` | **254 / 202** | 202 / 202 |

The code chip, the item name and the n/total count were pushed clean past the pane, and the tick
glyph rendered centred inside its own stretched box — which is exactly what the owner's screenshot
shows. The name string was in the DOM the whole time.

- ⚠️ **The symptom pointed at the wrong layer.** "Not loading" is the honest reading of that screen:
  containers with counts and no content is what a failed fetch looks like. Two prior entries in this
  file chased real data faults with a similar shape (`PDb.selectAll` on a table with no `id`; the
  cached empty `CODES`), which makes the CSS answer *less* likely to be reached, not more.
- ⚠️ **Fixed by TYPE, not per widget:** `input:not([type="checkbox"]):not([type="radio"])`. A
  `.boq-lad-row input { width:auto }` override would have fixed the ladder and left the trap armed
  for the next control. It also un-stretched the three **radios** the wizard already renders — the
  BOQ build/import pair and the primary-package column were 100%-wide radios, wrong since they were
  written and never noticed because a stretched radio still works.
- ⚠️ Verified in the Browser pane on a harness holding the real `module.css` and the real `ladRow`
  markup, before and after. ⚠️ The pane must be **fronted** to measure: a hidden tab reports
  `clientWidth 0` for everything and serves a stale frame — the artefact already recorded in
  `browser-hidden-tab-artefact`.

### 2 — ⚠️⚠️ "Start a new revision instead" DID NOT START A REVISION
The owner is right about the wording, and the wording was the smaller half. That link set
`st.boqNew = true`, and `finish()` then called `createBoqDraft` **with a `docName`** — which creates
a new `boq_documents` row. So:

- the only route to **another BOQ** was the one labelled as the thing he did not want;
- the label promised a **supersede** that never happened;
- there was **no** route to a genuine new revision of the BOQ on screen at all.

A control that lies about which of two hard-to-unpick things it does is worse than a missing one,
because the planner has no reason to check. Replaced with **three named choices**, each saying what
it does, gated on what exists:

| path | offered when | writes |
|---|---|---|
| **Add trades to rev NN** | a draft is open | nothing — hands off to the class-code picker on that draft |
| **Create another BOQ** | always | `createBoqDraft({docName, rev …})` → new document + its rev 00 |
| **New revision of NAME** | the document holds ≥1 revision | `createBoqDraft({rev …})` → **no docName**, so a revision inside that document |

- ⚠️ `boqPath()` resolves this in **one** place, read by the step's copy, the rail's Trades entry,
  the primary button's label and `finish()` — the four that already disagreed once, when the step
  said *"Add trades to 00"* under a button promising a file picker. The stored choice is
  **re-validated against what exists on every read**: `boqDraft()` answers null until the BOQ
  section has loaded, so a run opened from the top of the page must not be locked to a path that
  turns out not to exist.
- ⚠️ **The name field is asked for only on `doc`,** and `finish()` must not send a `docName` on
  `rev` — that would silently create a second document instead of the revision the step promised,
  i.e. this exact bug reintroduced from the other side. Asserted in the harness (below).
- ⚠️ **A new document's first revision defaults to `00`, not `nextBoqRev()`.** That function reads
  the revisions of the BOQ *on screen*, so a second BOQ was being offered "01" as though it
  continued the first one's series. `2026-09-07-boq-documents.sql` §5 replaced the project-wide
  unique index on `rev_no` with a per-**document** one precisely so both bills can hold a rev 00.
- ⚠️ **The prefill re-derives when the path changes, unless the planner typed one.** Caught in the
  harness: `doc` → `rev` left the field reading 00, because `captureBoq()` had already stored the
  other path's prefill and `st.boqRev || default` cannot tell a stored prefill from a typed answer.
  Not corruption — `createDraft` retries a duplicate and steps the label — but the planner would be
  told 00 and get 01. `boqRevTyped` is the distinction, set by the field's own `oninput` and never
  by a repaint.
- The button now names the object: **Add trades** / **Create BOQ** / **Create revision**.

### 3 — the last BOQ is deletable, and a draft REVISION is deletable
Yesterday's trash control existed but refused on `DOCS.length < 2`, so on a project with exactly one
BOQ — most of them, and the case a wrong first attempt happens in — it refused every time. From
where the owner stood it did not exist.

- ⚠️ **The "last document" refusal protected nothing.** Its stated reason was that removing the only
  document *"orphans the next revision and leaves the picker empty"* — but `boq_revisions` **cascades
  from** `boq_documents`, so there is no next revision to orphan, and an empty picker is a state
  `render()` already answers on purpose (*"No BOQ on this project yet"* + Add BOQ). Every project
  starts there. Removed; the confirm now says the project will be left with **no BOQ at all and a
  contract value reading zero**, because that is a materially different outcome from "one of several
  is going" and the trash icon cannot say which case you are in.
- **A draft revision now has its own trash**, beside the revision picker. Three granularities, three
  different jobs: the lines (*Delete selected*), one revision, the whole BOQ.
- ⚠️ **Rendered only on a DRAFT.** An issued revision is the tendered document and this module's
  invariant is supersede-never-edit-away; a control that appeared over it would have to refuse on
  click, and a button whose only behaviour is to refuse teaches the planner the module is arbitrary.
- ⚠️ **The ONLY revision of a BOQ is refused, and this one is a real gate.** No path in this module
  adds a revision to a document that has none — `openNewRev()` writes `document_id` from `DOCID`,
  but the wizard's revision path is offered only when the document already holds one — so a document
  emptied this way would be a shell nothing could fill. The message names the control that does
  work: the trash beside the BOQ name, which since today deletes the last BOQ too.
- Unchanged and still doing the real work: an **issued** revision is never deletable, and
  `boq_billing_periods` references `boq_revisions` **without** cascade so Postgres refuses outright
  — that foreign-key error is translated, not shown raw.

### 4 — ⚠️⚠️ The class-code bridge runs ONE WAY, and the owner's process needs the other two
Owner: *"Let's check how the defined class codes should connect with the activities defined in the
schedule … In terms of process, high level BOQ will be the basis -> detailed schedule will be
developed -> detailed BOQ will be based on the detailed schedule."*

That process has three hand-offs. **Only the middle one is built, and it only works after the
schedule already exists.** Measured, not assumed: `grep -c 'boq_' modules/project-schedule/index.html`
returns **0** — the schedule reads no `boq_*` table at all, so every link below lives on the
Contracts side and writes *into* the schedule.

| Hand-off | What the process needs | State |
|---|---|---|
| high-level BOQ → **detailed schedule** | the BOQ's codes seed the activities | ❌ **nothing** |
| schedule ↔ BOQ **tagging** | activities carry `class_code` | ✅ `boq_tag_activities`, propose→preview→apply, per code |
| detailed schedule → **detailed BOQ** | the tagged activities seed the BOQ lines | ❌ **nothing** — `addAuthoredLines(codes)` reads the class-code **library**, never the schedule |
| BOQ money → **activity cost** | the priced line loads the activity | ❌ **nothing** — Cost Loading keys on the activity NAME |

⚠️ **The tagger closes the wrong end for this process.** `boq_tag_activities` matches a code against
activities that **already exist** and writes `project_schedule.class_code`; `matchAct` scores on
`desc_l3` / `desc_l2` word overlap against `activity_name`, floor 0.8 for a pre-tick. Excellent when
the schedule was imported from P6 and the BOQ arrives after. In the owner's order the schedule does
**not** exist yet at step 1, and at step 3 the codes are already on the activities — so the tagger
has nothing to propose in either direction, and the planner re-types the connection twice.

⚠️⚠️ **Cost Loading is the reason a code cannot carry money today, and it is a NAME-keyed screen.**
Confirmed at `modules/project-schedule/index.html:33201` — `buildGroups()` groups by `nameOf(r)`
(the activity name, or a work-naming WBS ancestor) and reads `cfg.groups[name].total`, which is
**typed by hand**. So a BOQ line priced at X under `03101` and forty activities tagged `03101` sit
in the same database, both carrying the same code, and the money is re-keyed between them by a human.
The class code is a **tag for grouping and reporting; it is not a cost carrier.** (Recorded in the
2026-09-07i entry; re-verified here, unchanged.)

⚠️ **The trap to design around before building any of this is DOUBLE COUNTING.** One BOQ line
allocated across forty activities must contribute its amount **once**. `boq_allocations` already
carries the split (and, since 2026-09-07h, a `qty = 0` link that means *matched, not yet
quantified*), so the money belongs on the **allocation**, never on the tag. Summing
`boq_items.amount` over "every activity whose `class_code` matches" would multiply the contract by
the number of activities sharing a code — silently, and in the direction that looks like good news.

**The three things that would make the process one continuous chain, cheapest first:**
1. **Seed the schedule from the high-level BOQ.** The Trades step's own ladder selection is already
   a list of codes with `desc_l2` / `desc_l3` — the same strings the Schedule Builder needs for
   activity names. A "from the BOQ's class codes" source in the builder turns step 1 → step 2 into
   propose → preview → apply instead of re-typing 122 headings. Uses only what both sides already
   store; needs no migration.
2. **Seed the detailed BOQ from the tagged schedule.** The inverse of `addAuthoredLines`: one line
   per activity (or per code × location, reusing the existing location matcher), with
   `boq_class_map` written from `project_schedule.class_code` and `boq_allocations` written from the
   activity it came from — so the detailed BOQ is **born matched**, and the Match-to-schedule
   worklist starts empty instead of at 122.
3. **Then, and only then, make the code carry money:** offer *"total from the BOQ"* in Cost Loading
   beside the leaf name and the WBS ancestor, summing over **allocations**. Third because (2) is
   what makes the allocations exist to sum; done first it would sum a table nobody has filled.

⚠️ None of the three is built here — this entry records the audit, not the feature. What *is*
already true and worth saying to a planner: the codes do connect the activities, in one direction,
after the schedule exists.

### 5 — what is still missing for the module to be holistic
Read off this file and `ROADMAP.md` §B rather than invented. Ordered by what blocks a real month-end.

**Blocking a live project**
- ⚠️ **Design decision #6 is still OPEN and needs the owner** (ROADMAP §B, unresolved since
  2026-08-25): billing periods run **26th → 25th** while Cash Flow and the S-curve are monthly.
  Pro-rata across the two months, or assign the period to the month holding its end date? Both are
  defensible and they give **different monthly revenue** — so the Cash Flow mirror is reading a
  figure whose definition has not been agreed.
- **No billing on a hand-built BOQ until it is issued**, which is correct (the database enforces it)
  but means the whole authored path has never been through a period end to end.
- **The `status` column on `contracts_claims` has no fixed vocabulary**, so the module tile claims
  no attention figure (ROADMAP §A: "a guessed one reads 0 forever and looks like good news").

**Half-built, columns exist and the editor does not**
- **The PMI approval chain** — roles are captured per profile and stored as jsonb; there is no
  per-record editor to tick off "Recommending Approval". Per-stage aging surfaces the exposure the
  chain would explain, which is why this was deferred rather than dropped.
- **Promoting a PMI to a `contracts_claims` claim is manual** — `claim_id` is stored but set by hand.
- **`trade_map` is unread in anger.** The migration has not been run, so no row has been read and
  the tooltip has never named a procurement trade. It also fires **only on a hand-built bill**: on
  an import the chip is the client's own sheet name (`'BILLING BREAKDOWN '`, trailing space and all).

**Consistency gaps that will bite**
- ⚠️ **`openNewRev()` still writes `document_id` from `DOCID`, and it is the FALLBACK path** used
  only if `wizard.js` fails to load. It is the one create-surface that does not go through the
  wizard, which is exactly the shape of drift this module has already paid for twice (two create
  dialogs, two import doors).
- **A BOQ document with no revision is unreachable.** No path adds a revision to an empty document,
  which is why deleting the only revision is refused above. Either the wizard's `rev` path should
  offer *"create the first revision of NAME"* when the document is empty, or the empty state should
  not be creatable at all.
- **Two POC systems exist and must stay two** (ROADMAP §B1d): the schedule's `schedule_scurve_agg`
  and the BOQ billing POC. The Billing tab shows Contractual · Progress · Variance side by side —
  the variance is a report and must never auto-reconcile.

**Not built, deliberately — recorded so nobody rebuilds the argument**
- No OCR of client PMI PDFs. A mis-parsed amount in a claims register gets quoted at a meeting.
- No UI path that edits an issued `boq_items` line's description, unit, qty or amount. A remeasure
  is a new revision; every claim argument turns on exactly what was tendered.
- No `project_schedule.quantity` column. An activity's quantity is **derived** through the
  `boq_activity_quantity` view, or quantities live in three places and drift.


### Verified
Driven in the Browser pane against the **real `wizard.js`** with a stubbed dependency object, all
four `finish()` endings asserted on the payload rather than the toast:

| run | button | call |
|---|---|---|
| `add` | Add trades | `addBoqTrades()`, nothing written |
| `doc` + name | Create with 12 lines | `createBoqDraft({docName:"Structural Works BOQ", rev:"00"})` then `addBoqLines(2)` |
| `rev` | Create with 12 lines | `createBoqDraft({rev:"01"})` — **no docName** |
| `doc`, no name | Create with 12 lines | **refused**, zero calls |

Plus the two degenerate worlds: a **fresh project** (no draft, no document) shows no path radios and
falls back to the original build/import + name step; a document whose revisions are all **issued**
offers `doc` and `rev` but not `add`. And the prefill: `doc`→00, `rev`→01, a typed `R2` survives a
path switch.

⚠️ **Not verified signed-in.** The stubs stand in for `boq.js`, so no document, revision or line has
been written or deleted through these paths against a real project. The delete gates are argued from
the migrations' own cascade declarations, not observed refusing.

- `module.css` / `boq.js` / `wizard.js` / `module.js` `?v=20260908a`; `MODULE_V` → `20260908a`.
- New exports so the wizard can NAME what it is about to do rather than describe it in the abstract:
  `BOQ.currentDocument()`, `BOQ.revisionCount()`, surfaced as `D.boqDoc()` / `D.boqRevCount()`.

### ⚠️ `boq.js` is LF; `wizard.js` and `module.css` are CRLF
Third recorded instance in this module (`module.js` has 14 CRLF among 1,098 LF; `packages.js` is
wholly CRLF). A patch script that assumes one of them silently matches **zero** occurrences — which
looks exactly like "the anchor text moved". Detect per file: `CRLF = '\r\n' in s`.

---

## A BOQ can be deleted, and a trade now names who buys it (2026-09-07i) - fmlozano

Owner: *"Let's add the option to delete BOQ first. Let's do the proper mapping if you think that would
help us in the finance and procurement connectivity."*

### Delete a BOQ - and the four things it refuses
A trash control sits beside the rename pencil in the BOQ picker. The chain under it is total:
`boq_items` and `boq_class_map` cascade from `boq_revisions`, which cascades from `boq_documents`.
So the value of this control is almost entirely in what it will not do.

1. ⚠️ **An ISSUED revision is never deletable.** `2026-08-24-boq.sql` makes `boq_items`
   append-and-supersede because it is the client's tendered document and every claim argument turns
   on exactly what was tendered. A delete that ignored that would undo the module's central invariant
   in one click. Drafts only; the message says supersede instead.
2. ⚠️ **A billing period blocks it in the DATABASE.** `boq_billing_periods` references
   `boq_revisions` **without** cascade, so Postgres refuses outright. The foreign-key error is
   translated - *"has billing periods recorded against it"* - rather than shown raw.
3. ⚠️ **The LAST document is not deletable.** Every revision hangs off a document; removing the only
   one orphans the next revision and leaves the picker empty. Rename it, or add another first.
4. **The confirm names counts** - revisions, and lines on the open one. *"Delete this BOQ?"* hides
   how much is going.

### The mapping: Finance's SEVEN cost classes against Procurement's TEN letting trades
**Run `migrations/2026-09-07-trade-map.sql`.** Hovering a trade chip now names the procurement trades
that class is let under: *General Requirement -> Let under: General Requirements*, *MEPF Works -> Let
under: Mechanical Works, Electrical and Auxiliary Works, Plumbing Works, Fire Protection Works*.

⚠️⚠️ **THIS TRANSLATES; IT DOES NOT MERGE, AND AN EARLIER READING OF MINE WAS WRONG.** I reported that
the two vocabularies *"join to nothing, silently"* and recommended rewriting one to match the other.
There is no join to break. `PRC_TRADE_ORDER` in the schedule module is a **display sort order** whose
own comment says an unlisted trade *"is NOT dropped"*, and `project_schedule` has **no trade column**
at all - verified, 0 occurrences. Nothing was ever joining.

What exists is two legitimate classifications of the same work: `class_codes.trade` is how Finance
classifies **cost**; `work_packages.trade` (WPM's `XL_TRADES`) is how Procurement **lets** it. MEPF is
one cost class bought as four subcontracts, which the owner's own billing proves - *"PROGRESS BILLING
NO. 1 MEPF PO"* and *"NO.7 STRUCTURAL PO"* are separate POs. Forcing either list to impersonate the
other destroys a real distinction.

- ⚠️ **A TABLE, not a constant.** Finance revises this chart without a deploy, and both apps can read
  a table; neither can read the other's JavaScript.
- ⚠️ **"Others" is deliberately UNMAPPED** - Finance's catch-all of 94 codes, not a trade. A line
  under it resolves to no procurement trade and says so, which is the honest answer and visible
  rather than silently wrong.
- ⚠️ **The tooltip fires only on a hand-built bill**, where the chip IS a Finance trade. On an import
  the chip is the client's own sheet name (`'BILLING BREAKDOWN '`, trailing space and all), so a
  lookup would miss every time and report a mapping gap that is really a name the mapping was never
  asked about.
- ⚠️ **A plain select, NOT `PDb.selectAll`.** selectAll pages with `.order(key).gt(key, last)` and
  needs a **unique** key; `trade_map`'s primary key is the PAIR, so "MEPF Works" appears four times
  and a page boundary inside that group would silently drop the rest of it. Nine rows, one request.
- Missing table -> empty map -> the chips carry no counterpart. Same tolerance as every other schema
  addition in this file.

### ⚠️ Class codes DO connect the activities - and the costing does not read them
Owner: *"You can also check that we have class codes to connect the activities to the costing."*
Audited end to end. Three of the four links exist; the fourth does not.

| Link | State |
|---|---|
| The chart | ✅ `class_codes`, **702 rows / 698 active** after the dedupe, each now carrying a `trade` |
| Activity -> code | ✅ `project_schedule.class_code` - grid cell, row editor, importer, groupable at L1/L2/L3, and bulk-written from the BOQ by `boq_tag_activities` |
| BOQ line -> code | ✅ `boq_class_map`, per revision |
| BOQ line -> activity | ✅ `boq_allocations`, and `boq_activity_quantity` derives the activity's quantity |
| **BOQ money -> activity cost** | ❌ **nothing** |

⚠️⚠️ **`modules/project-schedule/index.html` reads NO `boq_*` table - zero occurrences.** Cost Loading
keys its cost lines on the activity **NAME** (`cfg.groups[name]`), and step 2's total is **typed by
hand**. So a BOQ line priced at X under 03101 and forty activities tagged 03101 sit in the same
database, both carrying the same code, and the planner re-types the money between them. The class
code is a **tag for grouping and reporting**, and it is not yet a **cost carrier**.

That is a feature, not a fix, and it is not built here: it would let Cost Loading offer *"total from
the BOQ"* as a basis beside the leaf name and the WBS ancestor, summing `boq_items.amount` over the
lines whose `boq_class_map` code matches the activities in the group. ⚠️ The trap to design around
first is **double counting** - one BOQ line allocated across forty activities must contribute its
amount once, so the sum belongs on the allocation, not on the tag.

- `boq.js?v=20260907zb`, `module.css?v=20260907q`; `MODULE_V` -> `20260907zf`.
- ⚠️ **Not verified signed-in.** The migration has not been run, so no `trade_map` row has been read
  and no BOQ has been deleted through this control.

---

## Match to schedule: a line can be linked before it is measured or priced (2026-09-07h) - jasantos2

Owner: *"if it is matching to schedule, users are able to link despite the qts or amount not being
assigned"*.

Matching and measuring are two different jobs and they do not happen at the same time. Saying **which
activities a BOQ line covers** is a scope decision, knowable off the drawings long before anyone has
measured the line — it is the thing a QS does first. The tab required the quantity anyway, so the
choice was to wait, or to type a placeholder figure; and a placeholder quantity is indistinguishable
from a measured one the moment it is stored.

### Three gates, and the middle one was losing data
1. **The worklist could not list the line.** `qtyLine()` requires `line_kind === 'measured' && qty
   != null`, and `allocHTML` filtered on it — so a lump-sum line, a provisional line, or a measured
   line awaiting its figure never appeared. Now filtered on `linkLine()`: any **measured**,
   **lump_sum** or **provisional** line. ⚠️ Headings stay out (layout) and so do **excluded** lines —
   an exclusion is a positive statement that the work is somebody else's scope.
2. ⚠️⚠️ **Apply silently discarded the link.** `prop.parts.filter(p => p.activity_id && Number(p.qty))`
   dropped every zero-quantity part, so a link recorded before measurement **vanished on Apply, with
   a success toast**. A part now needs only an activity. This was the half that lost work.
3. **The proposal was empty.** `proposeSplit` returned `{parts: []}` when `qty` was 0, so the planner
   faced a blank dialog and an 800-entry select. The candidates **are** the proposal when only the
   split is unknown, so they come back at qty 0 and the link is one press of Apply. `method` stays
   `null` — labelling it `prorata` would claim an arithmetic that did not happen.

### `qty = 0` means matched, not yet quantified — and it needs no migration
`boq_allocations.qty` is already `numeric not null default 0`, and every reader **sums** qty, so a 0
contributes nothing to any derived activity quantity. When the figure arrives, the same dialog spreads
it across the links that are already there.

- The blocking **"No line carries a quantity yet"** stage is gone; it is now a per-line fact, not a
  wall in front of the whole worklist. The `nomeasured`/`noqty` pair collapses into one `nolines`
  stage that names all three linkable kinds.
- ⚠️ **Over-allocation is only tested where a quantity exists.** `> 0 + 1e-6` would have flagged every
  link on every un-measured line the moment the tab started listing them.
- ⚠️ A qty-less row shows **em dashes, not zeros**: "0 allocated, 0 remaining" reads as a *finished*
  line, the opposite of what it is. Its allocated cell reads **linked** once it is. The button says
  **Link…** rather than **Allocate…**, and the dialog is titled *Link to activities*.
- ⚠️ An unmeasured line does **not** report "reconciles exactly" — 0 of 0 satisfies the arithmetic and
  says the opposite of the truth. It states what it is: a link, and what happens when the figure lands.
- KPI: *Measured lines* → **Lines to match**, with how many of them carry a quantity to spread.

### Verified
**24 assertions** (of 251 across six suites, all passing), executing `linkLine` / `hasQty` / `qtyLine`
sliced out of the shipped file across seven line shapes, with **HEAD executed as the control** and
shown to reject the qty-less measured line, the lump-sum line and the provisional line outright. The
three gates are each asserted against HEAD's own text. `qtyLine` is byte-identical — it still means
"spreadable", and nothing that relies on that meaning moved.
⚠️ **Not verified signed-in** — the anon key has no grants, so no allocation was written. The
predicates and the proposal ran; the dialog has not been applied against a real project.

`boq.js?v=20260907w`.


## The draft table now looks fillable, and headings collapse (2026-09-07g) - fmlozano

Owner: *"the table is not apparent to be filled out and needs UI restructuring"* and *"we should
also have the collapsible option for the header rows"*.

### The cells were invisible, not missing
Measured on OPW101 draft: **701 priceable rows x 5 numeric fields = 3,505 inputs**, every one

    background: rgba(0, 0, 0, 0);  border: 1px solid rgba(0, 0, 0, 0);  placeholder: ""

- a transparent box with a transparent border and no hint, on a dark table. The inputs were all
there and wired; nothing on screen said so. Invisible-until-hover suits an **issued** bill, which is
read constantly and written never (the trigger refuses it), and is exactly wrong for the one screen
whose whole purpose is data entry. `.boq-fillable` is added to the table **only on a draft**, giving
the cells a resting tint and border, and empty cells now carry a shape-of-the-value placeholder
(`0.00`, `0`, `unit`) shown muted so they never read as a real zero.

### 924 rows under 223 headings is not a list, it is a haystack
Headings collapse. The parent/child span is derived from **`depth`, not `parent_id`**, so it stays
correct against what is actually on screen after a filter has removed rows from the middle of a
branch. A caret appears **only where a heading owns rows**, because a toggle that visibly does
nothing reads as broken; a collapsed heading shows its hidden count. Collapse all / Expand all sit
in the filter bar, and only when the bill has headings at all.

⚠️ Collapse state is **in memory and deliberately not persisted**. It describes how you are
reading the bill right now, not anything about the bill — stored, it would be shared, and one
planner collapsing a trade would hide it from everyone. `reset()` clears it, so changing revision or
project starts expanded.

- `boq.js` / `module.css` `?v=20260907f`; `MODULE_V` → `20260907i`.

### ⚠️ How this entry got mangled the first time
It was written through a **bash double-quoted string**, so every `` `backtick span` `` was treated as
a command substitution and **deleted, silently** — `.boq-fillable`, `depth`, `parent_id` and the
version line all vanished, leaving grammatical sentences with holes in them. The prose survived,
which is what makes it dangerous: it reads as finished text. Write log entries from a **file**, never
an inline shell string. Same family as the escaping traps in `python-inline-write-truncates`.

---

## The class-code error was never the migration — PDb.selectAll assumed an `id` column (2026-09-07e) — fmlozano

⚠️⚠️ **`PDb.selectAll` paginates with `.order('id').gt('id', last)`, and `class_codes` has no
`id`** — its primary key IS the padded Finance `code`. So every read of the chart threw
**`column class_codes.id does not exist`**, the caller's `catch (e) { CODES = []; }` swallowed it,
and the screen said *"the chart is empty — run migrations/2026-08-21-class-codes.sql"*. The owner
ran that migration, correctly, more than once, and it could never have helped.

**Measured live before changing anything:** `select count(*) from class_codes` through the page's
own signed-in client returned **702 rows, all `active: true`**. The data and RLS were fine the
whole time. It was the `codesErr` added hours earlier in (c) that finally printed the real
message — the diagnostic paid for itself the first time it ran.

**Fixed in `db.js`:** `selectAll(table, apply, cols, key)`, `key` defaulting to `'id'` so every
existing caller is behaviourally identical. The cursor must still be unique and non-null — a
primary key; `sort_order`/`period`/`taken_at` remain unusable. `boq.js` now pages on `code` and
re-sorts by `sort_order` in memory, because selectAll orders by its cursor and the migration is
explicit that the template order is Finance's own reading sequence.

⚠️ `db.js` is SHARED — `?v=` bumped across **all 23 HTML files** in one pass; a partial bump
leaves pages disagreeing about which copy they hold.

### The inline BOQ never loaded in a background tab
The IntersectionObserver from (c) never fired: it delivers during the rendering steps, and **a
hidden tab does not run them**. Measured — the section sat at `top: 587` in a 948px viewport, well
inside the 500px margin, with `visibilityState: 'hidden'`, and stayed on *"Loading the BOQ…"*.
Now the rect is checked at mount and loaded immediately if it is already near the viewport; the
observer only covers genuine scrolling. This also survives the hidden-tab geometry artefact, where
every rect reads 0 and therefore trips the test and loads eagerly — loading early is harmless,
never loading is not.

- `db.js?v=20260907a` (23 files), `boq.js`/`module.js?v=20260907e`, `MODULE_V` → `20260907f`.

---

## A hand-built draft shows two tabs, not four (2026-09-07d) — fmlozano

Owner: *"the BOQ is complicated to use and difficult to manage when it's really simple: you just
have a BOQ and a class code library and you just have to match it with the activities in the
schedule."* That is an accurate description of the manual job — and measured against it, **half
the screen had no part in it**.

| Tab | Job on a hand-built draft |
|---|---|
| BOQ Items → **Lines** | the work |
| Class Codes | ❌ **nothing** |
| Allocations → **Match to schedule** | the work |
| Billing / POC | ❌ **nothing yet** |

⚠️ **Class Codes maps a CLIENT'S DESCRIPTIONS onto codes** — proposals, confidence, a suggestion
library. On an authored line **the code came first** and the description was written from it, so
there is nothing to infer. This is precisely why `2026-09-07-boq-manual.sql` added a fourth source
value, `authored`, rather than reusing `hand_picked`: the mapping is a *fact*, not a judgement.
Showing a judgement UI over facts invites re-deciding what was never in doubt — and
`boq_class_suggestions` **learns** from that tab, so it would have started proposing its own output
back to itself.

⚠️ **Billing / POC cannot act before the revision is issued** — a draft never bills, and the
database enforces it. It was four screens of accrual vocabulary offering a *New billing period*
button on a document that cannot be billed.

**Gated on `origin='manual' AND status='draft'`,** so an import is untouched and all four tabs
return the moment the revision is issued. Nothing is removed from the product; it is deferred
until it means something. `sub` falls back to `items` when the visible set shrinks, so a tab that
disappears cannot leave a blank body with nothing lit.

### The empty draft now says what to do
It read **"No lines match these filters"** on a BOQ that had just been created and had no lines to
filter — technically true, useless, and the first thing you saw after choosing to build by hand.
Now it distinguishes *nothing yet* (three numbered steps: add lines from class codes → fill
quantity and rates → match to schedule, then issue) from *nothing matching* (clear the filters).

- Also tidied a duplicated `if (!host) return;` left by the `mountTo()` edit in (c).
- `boq.js?v=20260907d`; `MODULE_V` → `20260907e`.

---

## Manual BOQ becomes the primary path, and it moves into the Contract tab (2026-09-07c) — fmlozano

Four owner items in one pass, plus the bug that was blocking all of them.

### ⚠️⚠️ The blocker: an empty result was cached forever
*"I've run the migration for the class codes already. But the error statement is still the same."*
It had run — 702 rows, `Success. No rows returned`. The app could not see them:

```js
async function ensureCodes() {
  if (CODES) return CODES;        // ⚠️ an empty array is TRUTHY in JavaScript
  ...
  catch (e) { CODES = []; }
}
```

Opening the BOQ **before** the migration cached `CODES = []`, and because `[]` is truthy every
later call returned it **without ever querying again**. Only a reload could clear it. The worst
shape of failure: the fix is applied, the app keeps reporting the old problem, and the migration
looks broken. ⚠️ Ruled out first, in order: `active` is `not null default true` so the omitted
column was not it; `grant select` and `class_codes_read` both exist so it was not RLS.

**Fixed:** `if (CODES && CODES.length)` — an empty result is no longer a cache, so it re-queries
while empty and caches normally the moment a row returns. `codesErr` is now kept so an **empty
chart** (run the migration) can be told apart from a **refused read** (`is_approved()` false →
zero rows, no error). Those need opposite actions and previously read identically.

### Manual is the priority, import is the convenience
*"Let's make sure that the manual add of BOQ is a priority and the import feature is only a
convenience."* This reverses that morning's weighting, which argued import is faster when a file
exists. True, but it ranked the paths by the speed of the happy case rather than by which one
always works — a workbook arrives late, in an unknown shape, or never. Build is now `pd-btn-primary`
and sits rightmost in both the toolbar and the empty state; import is the plain button.

### "Why does it say Rev no.?"
Because `boq_revisions.rev_no` is `text not null` and was designed for **the client's own label**
off an imported workbook (`05`, `rev.05`, `R2`) — import thinking leaking into the manual path. A
BOQ you author has no client label to copy, so the dialog demanded an invented identifier before
you could start. Now **prefilled** with the next free number and editable; the column stays NOT
NULL and imports still carry whatever the client called it.

### The BOQ moved into the Contract tab
*"Can't the BOQ page be relocated in the contracts page?"* Chosen over a fourth top-level tab.
`boq.js` wrote straight into `#cc-view`; it now renders through `hostEl()` with `mountTo()`, and
`packages.js` emits a **Bill of quantities** section below Contract lots. `openSub('boq')` no
longer opens an overlay — it switches to the tab and scrolls, so the wizard hand-off still works
with only one BOQ surface in existence.

⚠️ **It loads on scroll, not on tab open.** The BOQ is six round-trips; inline would have charged
every Contract-tab visit for a screen most sessions never read. An IntersectionObserver defers it,
and `_boqFor` re-paints rather than re-fetches when a package edit re-runs the render.

### ⚠️ `module.js` has MIXED line endings — 14 CRLF among 1,098 LF
The `CCPackages.show(...)` call is one of the CRLF lines while its neighbours are LF, so a
normalised anchor counted 0. Anchors there must be **byte-exact**; the edit asserts the CRLF count
is still 14 afterwards so it cannot silently normalise the file. (`packages.js` is wholly CRLF,
`boq.js` wholly LF — three files, three conventions, in one module.)

- `boq.js` / `packages.js` / `module.js` → `?v=20260907c`; `MODULE_V` → `20260907d`.

---

## The BOQ had no way in — a handler bound to an element nobody rendered (2026-09-07b) — fmlozano

Owner: *"Where can i access the BOQ from here?"* — asked from the Contract tab, and the honest
answer was **you cannot**.

### What was actually wrong
`packages.js` has been binding `#pk-boq` to `onSub('boq')` for as long as the BOQ screen has
existed — a correct handler, on an id that **no markup anywhere ever carried**. Three routes
checked, all closed:

| Route | Result |
|---|---|
| The `.cc-tab` strip | hard-coded to `contract` / `claims` / `eot` in `index.html` — no BOQ tab |
| `#pk-boq` in the Contract tab | wired at `packages.js:352`, **never rendered** |
| URL hash `cc_view={"v":"boq"}` | `switchTab()` sets `sub = null`, so it lands back on the register |

⚠️ So the only way to reach the bill of quantities was **`+ Add` → the contract wizard → its BOQ
step**. A planner who wanted to *read* the BOQ had to begin creating a contract to get to it, and
on a project whose contract was already recorded there was **no route at all**. This is why the
manual builder shipped that morning looked absent: it was reachable only through the one door that
assumes you are importing.

### The fix
Render the button the handler was always waiting for, in the **Contract records** card head.

- **Not gated on `canWrite`.** The BOQ is the client's contract document and a viewer may read it;
  `boq.js` already withholds the import and authoring controls on its own, so gating the way *in*
  would have hidden the document rather than protected it.
- **Built before the `!CONTRACTS.length` early return**, so it is reachable on a project with no
  contract row yet — which is exactly when a planner is building a BOQ by hand.
- It sits with Contract records, not Contract lots: a BOQ is raised against the contract.

### ⚠️ `packages.js` is CRLF while most of this repo is LF
An anchor written with `\n` counted **0 matches** and read as "the code moved". It had not — every
one of the file's 531 line endings is CRLF. `file` reported it correctly and a `grep -c $'\r'`
check did **not** (it returned 0). Trust a python `repr()` of the bytes over either. Translate both
the anchor and the replacement to the file's own ending, or a `\n` replacement silently leaves
mixed endings behind.

- Owner confirmed `migrations/2026-09-07-boq-manual.sql` is **run**.
- `packages.js?v=20260907b`; `MODULE_V` → `20260907c`.

---

## Contract tab reordered, procurement-style tables, and a manual BOQ built from the class-code library (2026-09-07) — fmlozano

**Run `migrations/2026-09-07-boq-manual.sql`.** Owner, three items: *"Let's just make the page cleaner.
Let's just move the packages section at the bottom. And it should be like a table. The UI right now
looks garbage. There is a new package and +Add button which are the same let's consolidate."* /
*"Let's improve the table for the contract records. We can use the table UI available in the
Procurement Dashboard."* / *"Let's enable the users to manually add a BOQ, this would be based on the
class code library and from the class code library the planner would be able to tag it to the
activities in the schedule module. Let's think of a better way to do this (bulk connect, per trade
etc.). If we make the manual add of BOQ perfect, it would enable us to better execute/implement the
import feature."* Then, mid-build: *"Let's reduce the length of the tooltips as well, with this kind
of length it will only add more confusion to the planner."*

### 1 + 2 — the Contract tab: records first, lots last, both as real tables

⚠️ **Three separate faults, and they compounded.**
1. **The page led with its rarest case.** Packages came first, and on the ordinary single-lot project
   that first screen was a 48px-padded card headlining *"No packages"* followed by three paragraphs
   explaining why that is fine. The actual subject of the tab — ₱3.67B of contract — sat below the
   fold and rendered as a `<table>` **with no `<thead>` at all**: a bold reference, a wrapped
   description, a name and an amount, with nothing saying which was which. The prose exists for a
   real reason (it stops planners inventing packages — see the 2026-08-27 entries) but it had been
   left in the position of a headline, so every project opened on a disclaimer.
2. **Two primary buttons for one job.** `New package` sat top-left in brand red beside `Share with
   Procurement & Engineering`, while the topbar carried `+ Add` — also red, also "add something
   here". Consolidated to **one primary per screen**: `+ Add` (the topbar wizard) stays the single
   primary, and the package action moved **inside the packages card**, scoped to the table it acts
   on. ⚠️ It opens the **compact form**, which is what `wizard.js`'s own note says should happen
   (*"the Contract tab's 'New package' button now opens the compact form"*) — it was still calling
   `onNew('Package')`, i.e. the wizard, whose type step deliberately no longer offers a Package card.
   The two had drifted apart.
3. **Neither table had a header strip**, so nothing on the page said what it was.

Both tables now use a new **`.cc-dt*` layer ported from the Procurement Dashboard's `.data-table`**:
a titled card header carrying the row count and that table's own actions, sortable columns, and a
footer for the note that used to be a headline.
- ⚠️ **A LAYER OVER `.cc-table`, NOT A SECOND TABLE CLASS.** Divergent table styles is exactly what
  the 2026-07-17 UI-uniformity pass keeps having to rework, so this adds only the four things WPM has
  and this module did not — header strip, sortable headers, group rows, footer — and inherits sticky
  head, hover and right-alignment from `.cc-table`.
- ⚠️ **PORTED TO `--pd-*` TOKENS, NEVER WPM'S LITERALS.** `wpm/assets/css/dashboard.css` hard-codes
  `#EE3124` / `#f0f0f0` / `#fff` and then re-states every one under `body.dark-mode`. Copying the
  literals would have given this module a table that is correct in light mode and unreadable in dark
  — the failure this file's own header warns about.
- ⚠️ **EVERY contract record is listed, not just the unlinked ones.** The old `orphanHTML` showed only
  contracts with no `package_id` — so on a project that DID have packages, a properly linked contract
  appeared nowhere on the table, only as a one-line summary inside its package's row. The register's
  own subject was reachable only as a subtitle of something else. Where a contract belongs to a lot,
  **the lot is a column**.
- ⚠️ **`Fmt.money` in a cell, `Fmt.moneyShort` only in the header strip.** The old records list used
  moneyShort for the amount itself, so the only place this screen showed the contract value, it showed
  it rounded to three significant figures (`₱3.67B`). A contract amount gets typed into a claim, and a
  column of right-aligned abbreviations cannot be compared or checked.
- ⚠️ **A contract outside every lot gets `whole project`, not a warning pill** — the 2026-08-27 finding
  stands: it is only a gap when the project has lots at all, and even then everything downstream still
  reads it at project level.

**Two real defects the render harness caught, neither visible from reading:**
- ⚠️ **`th()` was called without its sort state on three of nine columns**, throwing `Cannot read
  properties of undefined (reading 'key')` and rendering the whole tab blank. It now **throws
  explicitly** rather than defaulting to `csort`: defaulting would have made the packages table's
  headers silently drive the *contracts* table's order — every header still clickable, every click
  reordering the wrong table.
- ⚠️ **`esc(value || '<span class="cc-mut">—</span>')` escaped its own placeholder markup**, so the
  Counterparty cell rendered the literal string `<span class="cc-mut">—</span>`. `esc()` must wrap only
  the untrusted value.
- ⚠️ **Blanks sorted FIRST on descending.** The null test was inside `cmp` and multiplied by
  `st.dir`, so sorting contract amount descending put the lots with no amount above ₱3.2B. The test is
  now outside the direction multiplier. Measured: `asc [412.5M, 3.2B, —]`, `desc [3.2B, 412.5M, —]`.
  Ascending looked perfect throughout, which is why reading it would not have found this.

### 3 — the manual BOQ: the import chain, inverted

**The invariant this had to respect.** `2026-08-24-boq.sql` states it plainly: `boq_items` is
**append-and-supersede, never edited in place**, because it is the client's document and every claim
argument turns on exactly what was tendered. A manual builder needs editable lines, and the lazy
reading of that need is *"so allow edits"* — which would silently make the client's tendered BOQ
editable too.

⚠️ **The distinction that resolves it is whose document it is YET.** A revision being authored is
nobody's evidence; a revision that has been ISSUED is the record. So:
- `status='draft'` — lines freely editable and deletable, never billed against;
- `status='issued'` — the 2026-08-24 rule applies in full, **enforced by a trigger** rather than by
  every future UI remembering to.

⚠️ **Both new columns default to the pre-existing behaviour** (`'issued'` / `'import'`), so no row
changes meaning when the migration runs. A default of `'draft'` would have retroactively un-issued
every BOQ in the database and unlocked 1,215 client lines per project.

**Why this makes the importer better, which is what the owner is after.** The importer's hard problem
is that it must INFER structure — where the header row is, which lines are headings, what a code might
be. Authoring produces the same tables with all of that KNOWN, so a manual BOQ is a correctness oracle:
the shape the importer is trying to reconstruct, in a form where every field is certain.

**Division → sheet, group → heading, item → leaf.** Not arbitrary: `sheetTotals` and every WT % are
computed **per sheet**, so making the division the sheet puts the trade-share weighting on the right
axis for free. A single flat sheet would make one project-wide WT % denominator and quietly break the
billing arithmetic this module already verified against the real sheets.

- ⚠️ **`source='authored'`, a fourth value, not a reuse of `hand_picked`.** The three existing values
  all describe reverse-engineering a code from a description someone else wrote. An authored line is
  the opposite direction — the code came first — so the mapping is a fact, not a judgement. And
  `boq_class_suggestions` **learns from these rows**: feeding it "a human decided this description
  means this code" when the description was generated FROM the code is how a suggestion library starts
  confidently proposing its own output back to itself.
- ⚠️ **Headings carry no amount.** An imported heading holds the client's own printed subtotal (which
  is evidence, and reconciled against); an authored one would hold OUR sum of its own children — a
  second source of truth that goes stale the first time a child's quantity changes.
- ⚠️ **`'measured'` with a NULL quantity, not `'lump_sum'`.** The line kind states whether the work is
  measurable, and a concrete item is; the quantity is simply not typed yet. Defaulting to lump_sum to
  "match the empty qty" would put every authored line outside the quantity roll-up, i.e. outside the
  activity-quantity view this whole chain exists to feed.
- ⚠️ **The derivation rule is the OPPOSITE of the importer's, deliberately.** For an imported line
  `qty × displayed rate` is wrong (measured ₱8.60 out on a two-line sheet) because the client's rate is
  a rounded display. For a line WE author the rate is the exact input, so the amount IS computed and
  flagged `derived_amount = true` — precisely what that column was added for. An amount typed by hand
  wins and stops the derivation (`derived_amount = false`), because a lump-sum line has an amount and
  no rate at all; clearing it hands the line back to the rates. **Verified through all six states.**
- ⚠️ **The reconciliation gate runs on the way OUT.** The importer's most valuable check happens at
  import; a hand build has no equivalent moment, so `issueRev()` refuses a draft whose lines do not
  reconcile with the stated contract total, at the same absolute-and-small ₱1 / 0.01% tolerance.
- ⚠️ **A draft may not be `is_current`**, enforced by its own trigger — `is_current` is what the
  contract value, the POC and the monthly revenue read, and a half-built draft sitting there would put
  a partial contract sum into a billing conversation.
- ⚠️ **The importer now creates its revision as a DRAFT and issues it at the end.** Two reasons, the
  second better than the first: the parent_id second pass UPDATEs rows the trigger would refuse, and a
  half-finished import is now visibly a draft rather than an `is_current` revision carrying a partial
  contract sum.
- ⚠️ **PMI proposal revisions are EXEMPT from the lock, and the exemption is load-bearing** —
  `pmi.js`'s `removeLine()` DELETEs a priced line, and add/remove on a cost proposal is normal editing
  right up until submission. What preserves a superseded proposal is `pmi_records.supersedes_id`, not
  row immutability. Read honestly: this leaves a *submitted* proposal's lines as editable as they are
  today — the status quo, not an improvement. ⚠️ The test goes through `to_jsonb`, not `r.pmi_id`,
  because `2026-08-25-pmi.sql` may not have been run on a given deployment and a direct reference to a
  missing column would make the whole file un-runnable.

**The tree picker (the "per trade" ask).** A checkbox on every level of division › group › item, with
search, per-division and per-group select-all, and an indeterminate box over a partial selection. A
QS builds a BOQ a trade at a time, so ticking a division takes everything visible under it in one
action — a 40-line concrete package is one click plus a review, not forty searches. The existing
`pickCode` picker stays for what it is good at: mapping ONE imported line.
- ⚠️ **Searching auto-expands** — a hit inside a collapsed division is a hit nobody can see.
- ⚠️ **A defect the harness caught: an orphan heading.** The first cut emitted the group heading and
  then filtered its items, so re-picking a division whose items were already present wrote a heading
  with **nothing under it**. Measured: re-picking all of Concrete Works with 03101/03102/03201 already
  on the revision wrote heading `03200` as an orphan. The leaves are now decided first and the heading
  only if any survive; the toast counts sheets actually written to, not sheets picked.

**Inline editing, and a silent-data-loss defect it exposed.**
⚠️ **Numeric cells are `type="text"`, not `type="number"`, and this is the opposite of the obvious
choice.** With `type="number"`, anything the browser cannot parse makes `input.value` read back as the
**empty string** — so `1,000`, the way every planner writes a thousand, arrived as `""` and **silently
cleared the quantity**. No error, no rejection, just a figure gone from a BOQ. As text, `numOf` does
the parsing and already strips thousands separators, ₱/$/€/£ and parenthesised negatives, because the
importer needed exactly that. **Measured after the fix:** `1,000` → 1000, `₱1,200.50` → 1200.5,
`(500)` → −500, `abc` → refused with a toast and no write, cleared → derivation resumes.

**Bulk connect: class code → schedule activities.**
⚠️ **The gap this closes.** `candidatesFor()` offers only activities that ALREADY carry the line's
class code, and `proposeSplit` returns nothing when there are none — correct behaviour, but on a
freshly authored BOQ that is EVERY line, because nobody has tagged the schedule. The allocator was
unreachable by design for exactly the workflow it exists to serve.

⚠️ **It writes through a `security definer` RPC, not a plain UPDATE, and the row count is checked.**
The policy is `project_schedule_upd: is_writer() and can_access_project(project_id) and (created_by =
auth.uid() or is_admin())` — so a planner who did not import the schedule cannot update its rows, and
**PostgREST answers an RLS-filtered UPDATE with 200 and zero rows.** A "Tagged 40 activities" toast
over a table that changed nothing is the same silent-success failure `2026-09-02-wbs-link-batched.sql`
documents, where 16,393 of 16,485 activities kept a NULL and the screen looked perfect. Verified live
against the stub: the shortfall reports **as an error** — *"Only 1 of 2 tagged"*.
- ⚠️ **The function writes ONE column.** Definer rights over `project_schedule` are a large privilege;
  it may set `class_code` and nothing else, so it cannot become a back door onto dates or progress.
- ⚠️ **It never silently retags.** An activity carrying a different non-null code is skipped unless
  `p_overwrite` — a class code drives the cost roll-up, so quietly moving forty activities from one
  Finance code to another is a reconciliation nobody would know to look for. Overwrite un-disables the
  row but **does not tick it**.
- ⚠️ **WBS summary rows are never tagged** — a code on a summary row would be counted beside its own
  children by anything rolling up by code.
- ⚠️ **Keyed on `activity_id`, not the row uuid** — a schedule import reinserts every row, so a uuid
  captured on screen minutes ago may be gone while the activity it named is still there.
- ⚠️ **Chunked at 200 ids.** A `text[]` travels in the POST body so it escapes the `in.()` URL cap, but
  a project holds 16k activities and one array that size is the 8s statement timeout waiting to happen.
- **Every proposal names its reason** (`names the item 95%`, `trade matches group`, `2 of 3 item
  words`) and only ≥80% is pre-ticked. A bare highlight is unauditable — the planner cannot tell "all
  the words matched" from "the trade field agreed", and those deserve different amounts of trust.
- **Bulk mode** runs the matcher across every code on the BOQ at once with a preview table
  (code · item · BOQ lines · would tag · how). ⚠️ It takes **untagged activities only** — one already
  carrying this code needs nothing, one carrying another must not move in bulk.

### Tooltips shortened (owner, mid-build)
Every `cc-hint`, alert and toast in the new code was cut to one or two clauses — *"An empty draft: add
lines, price them, then issue. A draft never bills."*, *"Division → sheet, group → heading, item →
line."*, *"Does not reconcile. Lines sum to X against the stated Y — off by Z."* ⚠️ The `⚠️` blocks in
the source are **developer comments and stay** — they are not on screen, and they are what stops the
next reader "simplifying" a decision back into a defect.

### Verified
- **Both modals widened, and it is not cosmetic.** `.pd-modal` is `max-width: 520px`; measured at
  1440px, the tagger's two-pane grid left the activity list **~200px wide** with every row wrapping
  onto three lines behind two nested scrollbars. `.boq-wide` 1040px / `.boq-widish` 760px, the same
  widening `.ccw` takes.
- **Driven end to end in a render harness** carrying the real `dashboard.css` + `module.css` and the
  shipped `packages.js` / `boq.js`, with a recording fake of both data layers: the class-code tree
  (division select-all → 4 items, indeterminate parent), `addAuthoredLines` writing 3 headings + 4
  leaves at depth 0/1 with `origin:'manual'` and 4 `boq_class_map` rows at `source:'authored'`
  **including the padded `015051` un-de-zeroed**, all six derivation states, heading-conversion
  clearing every figure, the tagger's pre-tick/disable/overwrite matrix, the RPC args, the shortfall
  toast, bulk mode's preview, the reconciliation gate blocking `issueRev` and the passing case writing
  `is_current=false` for the project then `{status:'issued', is_current:true}` in **one** update (the
  order the draft-not-current trigger requires).
- **Issued vs draft measured both ways:** issued → 0 editable cells, 0 selects, 0 delete buttons, no
  banner, headers read `Material`/`Labour`; draft → 19 cells, 4 deletes, headers read `Mat. rate`/`Lab.
  rate`, and the heading row carries **only** its description input.
- **Both themes at 1440px and no page horizontal scroll at 375px.**
- **Audits:** every new class resolves to a CSS rule (the `k-heading` / `k-draft` / `.boq-imp` class of
  finding this file records); `module.js` / `wizard.js` / `pmi.js` **0 functions lost**;
  `packages.js` −2 (`orphanHTML` → `contractsHTML`, `subLine` unused after the restructure — both
  deliberate, not a region-replace accident); all files parse; CSS braces 378/378; **0 NUL bytes**;
  migration code-only parens 31/31, `$$` paired, both triggers preceded by a drop.

⚠️ **NOT verified signed in, and the migration has not been run.** No authored line has reached
PostgREST, `boq_tag_activities` has never executed, and the trigger's refusal has only been reasoned
about — the migration's own verify block at the foot is how to confirm it bites. Until it runs, `status`
reads absent → every revision behaves as issued → **the builder is simply not offered** and the module
works exactly as it did before.

⚠️ **Five pre-existing undefined pill classes found by the audit and NOT fixed here** (out of scope):
`boq-clm` (boq.js), `ec-basis` / `ec-in` / `ec-rm` / `ec-tot` (pmi.js). Same class as the earlier pill
audit — they fall back to the base style silently.

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

### 2026-08-27 (3) — Audit: a contract IS a package until a project is subdivided

Owner: *"Please audit the contract/CO/EOT wizard — some wizards require the package to be defined,
wherein a contract in itself is a package; in this case it's just 1 package for the whole project. I see
that contract and package are case to case the same definition and different."*

**Audited all four record types across both entry points (wizard + `openForm`). One was broken.**

| Path | Verdict |
|---|---|
| `openForm`, CO / Claim / EOT | ✅ Clean — defaults to "— none —", disables the select when the project has no packages, never blocks |
| `openForm`, Contract | ✅ Fixed earlier today (None / Define / Link, None default and saveable) |
| Wizard, Contract / Package | ✅ Fixed earlier today |
| **Wizard, CO / Claim / EOT / BOQ** | ❌ **A whole step with nothing to do** |

⚠️ **THE FINDING.** The package step was `when: always`. Raising a Change Order, Claim or EOT on a
project with no packages opened a full step — numbered in the rail, counted in "step 2 of 5" — whose
entire content was a **⚠️ notice** headlined *"This project has no contract packages yet"*, telling the
planner to record a Contract first because *"it defines the package"*. Nothing on it was actionable, the
warning triangle asserted a defect where there was none, and the instruction repeated the claim already
disproved this morning. **That is the "some wizards require the package to be defined" being reported.**

- **The step is now SKIPPED when there is nothing to choose** — `when()` is true for Contract and Package
  (where *none / define / link* is chosen) and otherwise only when the project actually has packages.
  ⚠️ The rail, the step numbering and the Back/Next arithmetic all follow automatically, because
  `when()` is the single source for all three — the original design decision that made this a one-line
  fix instead of a three-place one.
- **The step is named for what it does.** "Package · Define or link the contract lot" for a Contract;
  **"Scope · Optional — narrow this to one package"** for a CO/Claim/EOT. `label`/`sub` may now be
  functions, resolved through one `txt()` helper so the rail and the two headings cannot disagree.
- **The empty option is an answer, not a blank:** *"— the whole project (OPW101) —"*, and the Review row
  reads *"the whole project (OPW101)"* rather than an em-dash. ⚠️ A blank against "Raised against" reads
  as something forgotten; this reads as what was chosen, and it is the usual choice.
- **The `!pk.length` branch is kept as a fallback** (reachable by jumping back via the rail after the last
  package is deleted in another tab) and now states the normal case instead of warning.
- ⚠️ **A `packages()` call that throws degrades to "no packages" and skips the step** — before the
  packages table exists, the wizard still works rather than dying on step 2.

**The model, now stated once in the STEPS table so every step can lean on it:** a PROJECT code already
names one contract lot; a CONTRACT record is the commercial document for it; a PACKAGE is an *optional
subdivision below* the project. **1 project = 1 contract = 1 implicit package is the normal case**, and
the word "package" should not appear until a second one exists.

**Verified 31/31 in Node against the shipped `STEPS` table** (extracted from the file, not re-typed):
CO/Claim/EOT/BOQ drop to 4/4/4/3 steps with no packages and regain the step when one exists; Contract and
Package always keep it; every live step of every type resolves a non-empty label and sub; every sequence
starts at Record and ends at Review; a throwing package list skips rather than crashes.
Suite total today: **94** (31 steps + 28 wizard/guard + 23 portfolio + 12 orphan rendering).

⚠️ **Not clicked through signed in.**
