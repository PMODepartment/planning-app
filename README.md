# Planners Dashboard

A consolidated web dashboard for construction Planning Engineers at **Megawide
Construction Corporation**. Replaces and improves the existing Power Apps tool.
Seven independent modules plug into one shared shell (auth, navigation, styles).

> **Developers building a module:** read **[MODULE_CONTRACT.md](MODULE_CONTRACT.md)** first.

## Stack
- Vanilla **HTML / CSS / JS** — no build step
- **Supabase** (PostgreSQL + Auth + Storage)
- **GitHub Pages** hosting (auto-deploys on push)

## Project layout
```
planning-app/
├── index.html              Login
├── register.html           Self-registration (creates pending user)
├── pending.html            Awaiting-approval screen
├── dashboard.html          Module launcher (home)
├── assets/
│   ├── css/dashboard.css   Global styles + design tokens
│   └── js/
│       ├── config.js       Supabase creds + module registry  ← EDIT FIRST
│       ├── auth.js         AppAuth — shared login/roles
│       ├── db.js           PDb (projects/users) + Fmt formatters
│       └── ui.js           UI — toasts, user bar, modal
├── modules/
│   ├── _template/          Copy this to start a module
│   └── <module-key>/       One folder per Phase-1 module
├── supabase-schema.sql     Full DB schema (run in Supabase SQL editor)
├── MODULE_CONTRACT.md      Rules every module developer follows
└── CLAUDE.md               Main-app change log
```

## First-time setup
1. Create a Supabase project; paste its URL + anon key into `assets/js/config.js`.
2. Run `supabase-schema.sql` in the Supabase SQL editor.
3. In Supabase Auth settings, disable email confirmation (users go to `pending`).
4. Open `index.html`, register, then promote yourself to `super_admin` (see the
   bootstrap note at the bottom of `supabase-schema.sql`).

## Phase 1 modules
Progress Photos · Issues/Concerns/Lessons Learned · Contracts & Claims Register ·
Risk Register · Stakeholder Map · Drawing Register · Material Submittal Log

## Phase 2 (planned)
Project Schedule · Cost Loading & S-Curve · Drawing Register Integration ·
Material Submittal Integration · Work Package Integration (links to the
Procurement WPM app).
