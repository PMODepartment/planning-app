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

## Assignment tracker
| Module | key | Developer | GitHub | Status |
|---|---|---|---|---|
| Progress Photos | `progress-photos` | Johanne May Panganiban | yohanmay | Assigned |
| Issues, Concerns & Lessons Learned | `issues-lessons` | Georgette Dela Cruz | gyvmd | Assigned |
| Contracts & Claims Register | `contracts-claims` | Rachelle Ann Lungsod | rachellelungsod | Assigned |
| Risk Register | `risk-register` | — (reference module) | — | Built |
| Stakeholder Map | `stakeholder-map` | Art Lyndon Rovelo | ArtRovelo | Assigned |
| Drawing Register | `drawing-register` | Ethan Patrick Robles | ethanrobles10 | Assigned (extend reference) |
| Material Submittal Log | `material-submittal` | Art Lyndon Rovelo | ArtRovelo | Assigned |
| Project Schedule & Cost Loading | `project-schedule` | _ | _ | Not started (Phase 2) |
| S-Curve | `s-curve` | _ | _ | Not started (Phase 2) |
| Resource Loading | `resource-loading` | _ | _ | Not started (Phase 2) |
| Productivity Rates | `productivity-rates` | _ | _ | Not started (Phase 2) |
| Cash Flow | `cash-flow` | _ | _ | Not started (Phase 2) |
