# Developer Onboarding — copy/paste per developer

Send each developer the message below, filling in their **module** and **key**.

---

> Hi! You're building the **{{MODULE NAME}}** module of the Megawide Planners
> Dashboard. Your module key is **`{{module-key}}`**.
>
> **1. Get the code**
> ```
> git clone https://github.com/PMODepartment/planning-app.git
> cd planning-app
> git config user.name  "Your Name"
> git config user.email "you@megawide.com.ph"
> git checkout -b module/{{module-key}}
> ```
>
> **2. Read these two files first**
> - `MODULE_CONTRACT.md` — what to build and the rules (folder, shared APIs, DB)
> - `CONTRIBUTING.md` — git workflow (branch per module, PR into main)
>
> **3. Start from the template**
> Copy `modules/_template/` into `modules/{{module-key}}/` (it already exists as a
> placeholder — replace its contents). It's a working CRUD example using the
> shared auth, styles, and Supabase patterns.
>
> **4. Rules of thumb**
> - Vanilla HTML/CSS/JS only — no build step, no frameworks.
> - Use the shared `AppAuth`, `PDb`, `Fmt`, `UI` helpers — don't reinvent login,
>   formatting, or toasts.
> - Only edit files inside `modules/{{module-key}}/`. The two exceptions: add your
>   table to `supabase-schema.sql`, and flip your module's `enabled: true` in
>   `assets/js/config.js`.
> - Stamp `created_by` and `project_id` on every row you insert (RLS needs it).
> - Run `Fmt.esc()` on any user text you put into HTML.
>
> **5. To test locally**, run a static server in the repo root, e.g.
> `python -m http.server 8000`, then open `http://localhost:8000` (see
> `CONTRIBUTING.md` §1b). Supabase keys are already in `assets/js/config.js`.
> **Get access:** register on the live site — I'll approve you and assign the
> **`DEMO01`** sandbox project, which has sample data to build against.
>
> **6. When done**, push your branch and open a Pull Request into `main`. I'll
> review and merge. Keep `modules/{{module-key}}/CLAUDE.md` updated.
>
> Questions about anything shared → ask me, don't change shared files yourself.

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
