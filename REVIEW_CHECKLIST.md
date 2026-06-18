# PR Review Checklist — Module PRs

Use this when reviewing a developer's module pull request into `main`. Most
items mirror `MODULE_CONTRACT.md`. Reject/request-changes if a ❗ item fails.

## Scope & structure
- [ ] ❗ Only files under `modules/<their-key>/` changed — plus, at most, **their
      own** table in `supabase-schema.sql` and **their own** `enabled: true` flip
      in `assets/js/config.js`. No edits to `assets/**`, other modules, or the
      shell HTML.
- [ ] Entry page is `modules/<key>/index.html`; logic in `module.js`; styles in
      `module.css` (classes prefixed `.<key>-`).

## Shared APIs (no reinvention)
- [ ] ❗ Uses `AppAuth.requireLogin` (no custom auth/session handling).
- [ ] Uses `PDb.getProjects()` for the project list; `UI.toast`/`UI.modal`;
      `Fmt.*` for formatting.
- [ ] Includes the standard `<head>` (favicon, `theme.js`) and sidebar brand.

## Data & security
- [ ] ❗ Every insert stamps `created_by = profile.id` **and** `project_id`.
- [ ] ❗ All queries scoped with `.eq('project_id', pid)`; project comes from the
      shared `pd_project` sessionStorage key.
- [ ] ❗ `Fmt.esc()` (or equivalent escaping) on **all** user-supplied text
      injected into HTML — no raw template interpolation of DB values.
- [ ] New columns added via `alter table ... add column if not exists` (idempotent);
      no destructive schema changes; no querying other modules' tables.
- [ ] File uploads (if any) go to the module's **private** Storage bucket; only
      the path is stored; viewing uses `createSignedUrl`.

## UX & theming
- [ ] Works in **dark mode** — uses tokens (`--pd-bg/-card/-ink/-line/-muted`),
      no hard-coded `#fff`/`#000` backgrounds in `module.css`.
- [ ] Responsive (sidebar collapses, content reflows on mobile).
- [ ] Full CRUD as appropriate: add / edit / view / list / delete.

## Hygiene
- [ ] `modules/<key>/CLAUDE.md` updated (what was built, columns/buckets added).
- [ ] No secrets committed (only the public anon key belongs in `config.js`).
- [ ] No `console.log` spam / commented-out dead code.

## Quick local check
Pull the branch, run a static server, sign in, select `DEMO01`, exercise the
module's CRUD, then toggle dark mode and narrow the window to confirm both.
