# Developer Onboarding — copy/paste per developer

These developers are **non-coders using Claude Code**. The flow is: accept the
GitHub invite → install GitHub Desktop + Claude Code → clone → let Claude build
their module → save/PR via GitHub Desktop. Full walkthrough is in
**`GETTING_STARTED.md`** (send them there). Below is the short message + the
starter prompt they paste into Claude Code.

---

### Message to send each developer

> Hi {{NAME}}! You're building the **{{MODULE NAME}}** module of the Megawide
> Planners Dashboard. No prior web-dev experience needed — Claude Code does the
> coding.
>
> 1. Accept the GitHub invite I sent (repo `PMODepartment/planning-app`).
> 2. Open the live site `https://pmodepartment.github.io/planning-app/`, click
>    **Request access**, register with your Megawide email, and tell me — I'll
>    approve you and assign the **DEMO01** test project.
> 3. Follow **`GETTING_STARTED.md`** in the repo (install GitHub Desktop +
>    Claude Code, clone, make your branch `module/{{module-key}}`).
> 4. In Claude Code, paste this starter prompt:
>
> ```
> I'm building the "{{module-key}}" module of this project. Read MODULE_CONTRACT.md
> and CONTRIBUTING.md, then build my module inside modules/{{module-key}}/ by
> copying {{REFERENCE}} as the starting point. Use the shared login (AppAuth),
> styling, and database helpers — don't reinvent them. Only change files inside
> my module folder. Then help me test it locally and open a Pull Request.
> ```
>
> Then just describe, in plain English, what your module should do (the fields,
> the columns, how it should behave). Save your work with GitHub Desktop and
> submit a Pull Request when ready — I'll review it. Don't edit shared files;
> ask me if you think you need to.

Fill in `{{REFERENCE}}` with: **`modules/risk-register/`** for plain
list/form modules, or **`modules/drawing-register/`** for modules that upload
files/photos.

---

## Ready-to-send messages (priority modules)

### Georgette — Cash Flow (`module/cash-flow`, gvymd)

> Hi Georgette! You're building the **Cash Flow** module of the Megawide Planners Dashboard. No prior web-dev experience needed — Claude Code does all the coding, you just describe what you want.
>
> **Steps:**
> 1. Accept the GitHub invite to `PMODepartment/planning-app`.
> 2. Open `https://pmodepartment.github.io/planning-app/`, click **Request Access**, register with your Megawide email, and let me know — I'll approve you and assign the DEMO01 test project.
> 3. Follow `GETTING_STARTED.md` in the repo: install **GitHub Desktop** + **Claude Code**, clone the repo, and create branch **`module/cash-flow`**.
> 4. Open the project folder in Claude Code and paste this starter prompt:
>
> ```
> I'm building the "cash-flow" module of this project. Read MODULE_CONTRACT.md and CONTRIBUTING.md first. Then build my module inside modules/cash-flow/ by copying modules/risk-register/ as the starting point. Use the shared login (AppAuth), styling (dashboard.css), and database helpers (PDb, Fmt, UI) — don't reinvent them. Work only inside modules/cash-flow/. When done, help me test it locally and open a Pull Request.
>
> Here is what the Cash Flow module should do:
> - Show a table of cash flow entries per project, grouped by period (month/year).
> - Each entry has: Period (month/year), Category (Inflow or Outflow), Description, Planned Amount (₱), Actual Amount (₱), and Remarks.
> - KPI cards at the top: Total Planned Inflow, Total Actual Inflow, Total Planned Outflow, Total Actual Outflow, and Net Cash Position (Actual Inflow minus Actual Outflow).
> - Filters: by Category (All / Inflow / Outflow) and by Period.
> - Add / Edit / Delete entries via a modal form.
> - All amounts should be formatted as Philippine Peso using Fmt.money.
> - The module is scoped to the currently selected project (pd_project in sessionStorage).
> ```
>
> Save your work regularly in GitHub Desktop and submit a Pull Request when ready. Don't edit shared files — ask me if you're unsure.

---

### Rachelle — Contracts, PMI & Claims Register (`module/contracts-claims`, rachellelungsod)

> Hi Rachelle! You're building the **Contracts, PMI & Claims Register** module of the Megawide Planners Dashboard. No prior web-dev experience needed — Claude Code does all the coding, you just describe what you want.
>
> **Steps:**
> 1. Accept the GitHub invite to `PMODepartment/planning-app`.
> 2. Open `https://pmodepartment.github.io/planning-app/`, click **Request Access**, register with your Megawide email, and let me know — I'll approve you and assign the DEMO01 test project.
> 3. Follow `GETTING_STARTED.md` in the repo: install **GitHub Desktop** + **Claude Code**, clone the repo, and create branch **`module/contracts-claims`**.
> 4. Open the project folder in Claude Code and paste this starter prompt:
>
> ```
> I'm building the "contracts-claims" module of this project. Read MODULE_CONTRACT.md and CONTRIBUTING.md first. Then build my module inside modules/contracts-claims/ by copying modules/risk-register/ as the starting point. Use the shared login (AppAuth), styling (dashboard.css), and database helpers (PDb, Fmt, UI) — don't reinvent them. Work only inside modules/contracts-claims/. When done, help me test it locally and open a Pull Request.
>
> Here is what the Contracts, PMI & Claims Register module should do:
> - Show a register of contracts, PMI entries, and claims per project.
> - Each entry has: Record Type (Contract / PMI / Claim / Change Order), Reference No., Title, Counterparty / Contractor, Description, Contract Amount (₱), Status (Active / Resolved / Pending / Disputed / Closed), Date Filed, Date Resolved, and Remarks.
> - KPI cards at the top: Total Contracts, Total Claims, Open/Pending items, and Total Contract Value (₱).
> - Filters: by Record Type (All / Contract / PMI / Claim / Change Order) and by Status.
> - Add / Edit / Delete entries via a modal form.
> - All amounts formatted as Philippine Peso using Fmt.money.
> - The module is scoped to the currently selected project (pd_project in sessionStorage).
> ```
>
> Save your work regularly in GitHub Desktop and submit a Pull Request when ready. Don't edit shared files — ask me if you're unsure.

---

## Assignment tracker

> **Priority Phase (active):** Cash Flow, Contracts & Claims, Project Schedule.

| Module | key | Developer | GitHub | Status |
|---|---|---|---|---|
| **Cash Flow** | `cash-flow` | **Georgette Dela Cruz** | **gvymd** | **In progress (priority)** |
| **Contracts, PMI & Claims Register** | `contracts-claims` | **Rachelle Ann Lungsod** | **rachellelungsod** | **In progress (priority)** |
| **Project Schedule & Cost Loading** | `project-schedule` | **Loz Lozano** | **fmlozano-pmo / PMODepartment** | **In progress (priority)** |
| Risk Register | `risk-register` | — (reference module) | — | Built |
| Drawing Register | `drawing-register` | Ethan Patrick Robles | ethanrobles10 | Assigned (extend reference) |
| Progress Photos | `progress-photos` | Johanne May Panganiban | yohanmay | Assigned |
| Stakeholder Map | `stakeholder-map` | Art Lyndon Rovelo | ArtRovelo | Assigned |
| Material Submittal Log | `material-submittal` | Art Lyndon Rovelo | ArtRovelo | Assigned |
| Issues, Concerns & Lessons Learned | `issues-lessons` | — | — | Unassigned (reassigned Georgette to Cash Flow) |
| S-Curve | `s-curve` | _ | _ | Not started |
| Resource Loading | `resource-loading` | _ | _ | Not started |
| Productivity Rates | `productivity-rates` | _ | _ | Not started |
