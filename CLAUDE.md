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

- **Still TODO (next prompts):** real Supabase project + creds in `config.js`;
  GitHub Pages deployment + branch protection on `main`; shared project-picker
  component; first real module build.
