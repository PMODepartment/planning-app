# Planners Dashboard — Main App Change Log

This file tracks the **main app** (shell) work, maintained by the Planning team
owner. Each module keeps its own `modules/<key>/CLAUDE.md`. One entry per prompt.

## Project summary
Consolidated dashboard for construction Planning Engineers (Megawide). Replaces
an existing Power Apps tool. Seven Phase-1 modules, each built by a separate
developer, plug into one shared shell.

**Architecture decisions (locked 2026-06-18):**
- Stack: vanilla HTML/CSS/JS, no build step, GitHub Pages hosting
- Backend: one shared **new** Supabase project (Postgres + Auth + Storage)
- Integration: shared shell + documented contract (`MODULE_CONTRACT.md`), single repo
- Auth: shared Supabase Auth + roles across all modules
  (`super_admin > admin > planner > user > viewer`)

**Reference:** Procurement WPM app —
`C:\Users\fmlozano\...\Procurement Dashboard\wpm\CLAUDE.md`
(same vanilla + Supabase + GitHub Pages pattern; Phase 2 will integrate with it).

## Key files
| File | Purpose |
|---|---|
| `assets/js/config.js` | Supabase creds + `MODULES` registry (flip `enabled` per module) |
| `assets/js/auth.js` | `AppAuth` — login, roles, `requireLogin/requireRole/requireAdmin` |
| `assets/js/db.js` | `PDb` (projects/users) + `Fmt` formatters |
| `assets/js/ui.js` | `UI` — toasts, user bar, modal |
| `assets/css/dashboard.css` | Global styles + design tokens (`--pd-*`) |
| `supabase-schema.sql` | All shared + module tables, RLS, bootstrap notes |
| `MODULE_CONTRACT.md` | Rules every module developer must follow |

## Roles
| Role | Notes |
|---|---|
| `super_admin` | full control, only role that can set super_admin |
| `admin` | manage users/projects, all modules |
| `planner` | auto-approve writer, all projects |
| `user` | assigned projects only |
| `viewer` | read-only |

`status`: `pending` → `approved`/`rejected`. New sign-ups land in `pending`.

---

## Changelog

### 2026-06-18 — Prompt 1: Foundation scaffold
- Initial project structure, shared shell, and developer contract.
- Added: `index.html` (login), `register.html`, `pending.html`, `dashboard.html`
  (module launcher driven by `APP_CONFIG.MODULES`).
- Added shared JS: `config.js`, `auth.js` (AppAuth), `db.js` (PDb + Fmt),
  `ui.js` (UI). Added global `dashboard.css` with design tokens.
- Added `supabase-schema.sql`: `projects`, `users`, starter table per Phase-1
  module, `is_admin()/is_approved()` helpers, and RLS policies (read-all-approved,
  write-own-or-admin) applied to every module table.
- Added `MODULE_CONTRACT.md` (folder layout, required boilerplate, shared APIs,
  DB rules, git branch-per-module + PR workflow, definition of done).
- Added `modules/_template/` (full working CRUD example) and placeholder
  `index.html` + `CLAUDE.md` for all 7 module folders.
- Added `README.md`, `.gitignore`.
### 2026-06-18 — Prompt 2: Admin screen + multi-dev git workflow
- Added `admin.html`: Users tab (approve/reject, inline role change with
  super_admin guard, per-user project assignment modal) + Projects tab
  (create/edit/archive via modal). Admin-gated by `AppAuth.requireAdmin`.
- Multi-developer collaboration handling:
  - `CONTRIBUTING.md` — per-developer git author identity, branch-per-module,
    rebase-before-PR, PR-into-main workflow. Recommends individual GitHub
    collaborator accounts over a shared login.
  - `.github/CODEOWNERS` — shared files → app owner, module folders → dev
    (placeholders to fill once devs assigned).
  - `.github/pull_request_template.md` — contract checklist.
  - `ONBOARDING.md` — copy/paste per-developer message + assignment tracker.

### 2026-06-18 — Prompt 3: Supabase wiring + Risk Register reference module
- Supabase project connected: URL `https://bgupuqnkqhixpuctyder.supabase.co`
  set in `config.js`. **anon key still pending** (user to paste; service_role
  key they shared was flagged for rotation — must NEVER be in client code).
- Schema already run by user in Supabase SQL editor. GitHub Pages enabled
  (deploy from `main`).
- Built **Risk Register** as the end-to-end reference module
  (`modules/risk-register/`): list view with filters + KPIs, 5×5 risk matrix,
  add/edit modal with app-computed `rating = likelihood × impact`, delete.
  Demonstrates every contract pattern (auth, pd_project, created_by, Fmt.esc).
- Flipped `risk-register` to `enabled: true` in `config.js`.

### 2026-06-18 — Prompt 4: Per-project RLS + Drawing Register reference module
- **anon key** pasted into `config.js` (verified role=anon). App can now reach DB.
- **Per-project access enforced at the DB level:** added `can_access_project()`
  helper; rewrote `projects` + all module-table RLS so admins see everything and
  planner/user/viewer only see projects in their `users.projects` array.
  Migration: `migrations/2026-06-18-project-access-rls.sql` (also folded into
  `supabase-schema.sql`). **User must run this migration in Supabase.**
- Built **Drawing Register** (`modules/drawing-register/`) as the file-upload
  reference module: status/discipline/search filters, revision + status pills,
  add/edit modal with file upload to a **private** Storage bucket, view via
  short-lived signed URL, delete (removes object + row). Enabled in `config.js`.
- Storage setup migration `migrations/2026-06-18-storage-buckets.sql` creates
  private buckets (`drawing-register`, `progress-photos`, `material-submittal`)
  + policies. **User must run this migration too.**

### 2026-06-18 — Prompt 5: Live verification
- GitHub Pages live at `https://pmodepartment.github.io/planning-app/`; login
  page + deployed `config.js` (correct URL + anon key) confirmed serving.
- **Bug found via live REST probe:** all tables returned `42501 permission
  denied` for `anon`/`authenticated` — table GRANTs were missing (separate layer
  from RLS). Fix: `migrations/2026-06-18-grants.sql` (grant DML to authenticated
  + default privileges for future module tables); folded into `supabase-schema.sql`.
  **User must run this migration.**

### 2026-06-18 — Prompt 6: Fix index↔dashboard redirect loop
- Verified data layer live: authed REST queries now return 200 (grants fix
  confirmed), RLS returns [] for unapproved users, anon blocked.
- **Bug:** infinite redirect loop index.html ↔ dashboard.html for users whose
  `auth.users` account has no `users` profile row (the promote UPDATE matched 0
  rows because the row never existed). `requireLogin` sent profile-less sessions
  back to index.html, which bounces sessions to dashboard → loop.
- **Fix (auth.js):** added `ensureProfile()` self-heal — a sessioned user with
  no profile row gets a `pending` row created, then goes to pending.html (never
  back to index.html). Hard stop signs out if profile truly can't be created.

- **Still TODO (next prompts):** run the three migrations in Supabase; create the
  buckets via the migration; branch protection on `main`; live end-to-end test;
  remaining modules (issues-lessons, contracts-claims, stakeholder-map,
  material-submittal, progress-photos) — or hand to developers.
