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
> `python -m http.server 8000`, then open `http://localhost:8000`.
> (Ask me for the Supabase URL + anon key to put in `assets/js/config.js`, or
> I'll provide a shared dev config.)
>
> **6. When done**, push your branch and open a Pull Request into `main`. I'll
> review and merge. Keep `modules/{{module-key}}/CLAUDE.md` updated.
>
> Questions about anything shared → ask me, don't change shared files yourself.

---

## Assignment tracker
| Module | key | Developer | GitHub | Status |
|---|---|---|---|---|
| Progress Photos | `progress-photos` | _ | _ | Not started |
| Issues, Concerns & Lessons Learned | `issues-lessons` | _ | _ | Not started |
| Contracts & Claims Register | `contracts-claims` | _ | _ | Not started |
| Risk Register | `risk-register` | _ | _ | Not started |
| Stakeholder Map | `stakeholder-map` | _ | _ | Not started |
| Drawing Register | `drawing-register` | _ | _ | Not started |
| Material Submittal Log | `material-submittal` | _ | _ | Not started |
