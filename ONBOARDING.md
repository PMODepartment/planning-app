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
> I'm building the "cash-flow" module of this project. Read MODULE_CONTRACT.md and CONTRIBUTING.md first. Then build my module inside modules/cash-flow/ by copying modules/risk-register/ as the starting point. Use the shared login (AppAuth), styling (dashboard.css), and database helpers (PDb, Fm