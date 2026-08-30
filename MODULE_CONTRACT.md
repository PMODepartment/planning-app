# Module Contract — Planners Dashboard

**Read this before writing any code.** Every Phase-1 module is built by a different
developer but must plug into one shared shell. Follow this contract so the
modules consolidate cleanly. The main app owner (Planning team) reviews and
merges your module.

---

## 1. Where your module lives

```
planning-app/
  modules/<your-module-key>/
    index.html        ← entry page (required, name must be index.html)
    module.js         ← your module's logic
    module.css        ← (optional) styles specific to your module
    CLAUDE.md         ← your own change log for this module
```

Your module key (folder name) is fixed — use exactly the one assigned in
`assets/js/config.js → APP_CONFIG.MODULES`:

| Module | key |
|---|---|
| Progress Photos | `progress-photos` |
| Issues, Concerns & Lessons Learned | `issues-lessons` |
| Contracts & Claims Register | `contracts-claims` |
| Risk Register | `risk-register` |
| Stakeholder Map | `stakeholder-map` |
| Drawing Register | `drawing-register` |
| Material Submittal Log | `material-submittal` |

**Do not edit files outside your folder** except `supabase-schema.sql` (only to
add your own table) and `assets/js/config.js` (only to flip your module's
`enabled: true`). If you need a change to a shared file, ask the main app owner.

---

## 2. Stack — no build step

Vanilla **HTML + CSS + JS** only. No React, no bundler, no npm build. Files are
served as-is by GitHub Pages. Use the Supabase UMD CDN bundle (already loaded
by the shell pattern below).

---

## 3. Required boilerplate for your `index.html`

Your page is **one level deeper** than the shell, so shared assets load with a
`../../` prefix. Copy this head/script skeleton exactly:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" type="image/png" href="../../assets/img/favicon.png" />
  <link rel="apple-touch-icon" href="../../assets/img/icon.png?v=20260830b" />
  <script src="../../assets/js/theme.js"></script>   <!-- dark mode; load in <head> -->
  <title>Risk Register · Planners Dashboard</title>
  <link rel="stylesheet" href="../../assets/css/dashboard.css" />
  <link rel="stylesheet" href="module.css" />
</head>
<body>
  <div class="pd-app">
    <!-- Persistent module sidebar (2026-08-30 — every module now carries one,
         a reversal of the earlier "sidebar-less" convention). Copy this block
         VERBATIM from modules/_template/index.html or any enabled module —
         its contents are rendered by UI.renderNav (see the script below), not
         this static markup, so nothing here should reference your module by
         name except the brand caption. -->
    <aside class="pd-sidebar">
      <div class="pd-brand">
        <img class="pd-brand-logo" src="../../assets/img/logo-white.png" alt="Megawide Construction">
        Planners Dashboard<small>Risk Register</small>
      </div>
      <nav id="side-nav"></nav>
      <div class="pd-nav-foot">
        <a class="pd-nav-sibling" href="https://pmodepartment.github.io/engineering-app/" target="_blank" rel="noopener" title="Opens Engineering App in a new tab">
          <span class="pd-navico" data-ico="externalLink"></span><span class="pd-navtxt">Engineering App</span>
        </a>
        <a class="pd-nav-sibling" href="https://pmodepartment.github.io/prc-app/" target="_blank" rel="noopener" title="Opens Procurement App in a new tab">
          <span class="pd-navico" data-ico="externalLink"></span><span class="pd-navtxt">Procurement App</span>
        </a>
      </div>
      <div class="pd-sidebar-foot">Megawide Construction Corporation<br>EPC &middot; PMO &middot; Planning Suite</div>
    </aside>
    <div class="pd-content">
      <!-- ... your topbar + main content, per §"Uniform top bar" below ... -->
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="../../assets/js/config.js"></script>
  <script src="../../assets/js/auth.js"></script>
  <script src="../../assets/js/db.js"></script>
  <script src="../../assets/js/ui.js"></script>
  <script src="module.js"></script>
  <script>
    AppAuth.requireLogin(function (user, profile) {
      UI.renderUserBar(profile);          // top-right user + logout
      UI.initShell();                     // wires the sidebar collapse/drawer toggle
      var pname = sessionStorage.getItem('pd_project_name') || sessionStorage.getItem('pd_project') || '';
      UI.renderNav(document.getElementById('side-nav'), 'project', {
        active: 'risk-register',          // your module's `key` in config.js — highlights this row
        base: '../../', pname: pname, modules: APP_CONFIG.MODULES,
      });
      MyModule.init(user, profile);       // your entry point
    });
  </script>
</body>
</html>
```

⚠️ If your `module.css` (or an inline `<style>`) still carries a `.pd-content { width:100%; }`
rule from before the sidebar existed, **delete it** — the shared `.pd-content { flex:1;
min-width:0 }` in `dashboard.css` already sizes it correctly next to `.pd-sidebar` in the
`.pd-app` flex row, and a leftover `width:100%` override fights the sidebar for space.

`AppAuth.requireLogin` handles the session check and redirects unauthenticated
users to login automatically — you never roll your own auth.

---

## 4. Shared APIs you must use (don't reinvent)

**Auth — `AppAuth`** (`auth.js`)
- `AppAuth.requireLogin(cb)` / `requireRole(['admin'], cb)` / `requireAdmin(cb)`
- `AppAuth.getSB()` → the Supabase client (use this for your queries)
- `AppAuth.canAccessProject(profile, projectId)`
- `AppAuth.logout()`
- Current user/profile available as `window.__profile`, `window.__role`

**Data — `PDb` + `Fmt`** (`db.js`)
- `PDb.getProjects()`, `PDb.getProject(id)` — the shared project list
- `Fmt.money`, `Fmt.moneyShort`, `Fmt.date`, `Fmt.esc(html)` — use `Fmt.esc`
  on ALL user-supplied text you inject into HTML

**UI — `UI`** (`ui.js`)
- `UI.toast(msg, 'ok'|'error'|'warn')`
- `UI.renderUserBar(profile)`
- `UI.modal(html, opts)`
- `UI.enhanceProjectSelect(selectEl)` — **use this for the project picker.** Populate a
  native `<option>` list as usual, set the current value, then call it once: it upgrades
  the `<select>` into a searchable popover — one level deep, grouped by **Group Head**
  (root: a folder per group head that actually has projects here, plus a "— No group
  head —" bucket; drill into one to pick a project), with a search box that flattens to
  matching projects across every group — while keeping the `<select>` as the source of
  truth, so your existing `onchange` still fires. It builds the list from
  `PDb.getProjects` + `PDb.getGroupHeads`, filtered to the ids in your options (so any
  access filtering you applied is respected). Safe to call again to refresh after
  repopulating.

**Sidebar (required, 2026-08-30).** Every module carries the persistent
`.pd-app > .pd-sidebar + .pd-content` shell — this reverses the earlier
"sidebar-less" convention some older CLAUDE.md entries still describe; if you're
reading one of those, this is the current rule. Copy the `<aside class="pd-sidebar">`
block verbatim from `modules/_template/index.html` (or any enabled module), then
in your `requireLogin` callback call `UI.initShell()` (wires the collapse/drawer
toggle) and `UI.renderNav(document.getElementById('side-nav'), 'project', {active:
'<your-module-key>', base: '../../', pname: <project name>, modules:
APP_CONFIG.MODULES})` — `active` must match your module's `key` in `config.js` so
your row highlights. Don't hand-write the nav's `<a>` links; `UI.renderNav` builds
them from `APP_CONFIG.MODULES` so they stay in sync with what's actually enabled.

**Uniform top bar — a permanent two-row split (required, 2026-08-30).** `.pd-topbar`
is one `<div>`; `ui.js`'s `initModuleTopbar()` splits its children into two ALWAYS-VISIBLE
rows (not just on a phone — a single row was the recurring source of the overlap/collision
bugs this section exists to prevent):
- **Row 1 (`.pd-tb-main`, app-wide identity — same shape on every module):** the
  hamburger (injected automatically), an `<h1 class="X-title">` wrapping just the
  module's brand-red icon in a `<span class="X-title-ico">` (its text label, in a
  sibling `<span class="X-title-txt">`, is hidden by the shared CSS — the current
  screen is named by the tabs in row 2, not repeated as prose above them; still wrap
  the text in that span so the hiding rule applies), the project selector (a `<div
  class="X-projctx">` wrapping your enhanced `<select>` — matched by the CSS via its
  `-projctx` suffix), the theme toggle, `#user-bar`.
- **Row 2 (`.pd-tb-tools`, module-specific):** your own view tabs (`<div
  class="X-tabs" role="tablist">…</div>`) and your own action buttons (`<div
  class="X-topbar-tools">…</div>`, or an element whose **id** ends `-topbar-tools`) —
  matched by the same suffix convention. `initModuleTopbar()` buckets by class-name
  suffix and element type; it does not need markup nesting, so build the flat list in
  document order shown below and it sorts itself into the right row.
- **No back button.** The browser's own Back covers it — don't add one.

Markup order (flat, all direct children of `.pd-topbar`):
```html
<div class="pd-topbar">
  <h1 class="X-title" style="margin:0;">
    <span class="X-title-ico" data-ico="ICON_NAME" data-ico-size="20"></span>
    <span class="X-title-txt">Module Name</span>
  </h1>
  <div class="X-projctx">
    <select class="pd-select X-project" id="X-project" title="Project"></select>
  </div>
  <div class="X-tabs" role="tablist">
    <button class="X-tab active" data-view="...">First view</button>
    <button class="X-tab" data-view="...">Second view</button>
  </div>
  <div class="X-topbar-tools">
    <button class="pd-btn pd-btn-primary" id="X-add" title="...">+ Add ...</button>
  </div>
  <div id="X-presence" title="People viewing this project"></div>
  <div id="user-bar"></div>
</div>
```
Copy `modules/_template/index.html` for the exact, currently-correct markup.

**Styles** — use the shared classes/tokens in `dashboard.css`: `.pd-card`,
`.pd-btn`, `.pd-btn-primary`, `.pd-input`, `.pd-select`, `.pd-table`,
`.pd-field`, and the CSS variables (`--pd-red`, `--pd-ink`, …). Put anything
truly module-specific in your own `module.css`, prefixed `.<key>-…`. Do **not**
add a `.pd-content { width:100%; }` rule — the shared `.pd-content { flex:1;
min-width:0 }` already sizes it correctly beside `.pd-sidebar`.

**Dark mode is automatic** — `theme.js` (in your `<head>`) handles the toggle
and persistence; the toggle button auto-appears in the top bar. For your module
to adapt correctly, **use the shared tokens** for surfaces/text/borders
(`--pd-bg`, `--pd-card`, `--pd-ink`, `--pd-muted`, `--pd-line`) and **never
hard-code** `#fff`/`#000`/light backgrounds in `module.css`. Semantic data
colors (status greens/ambers/reds) are fine to keep fixed.

**Browser Back should step through your in-page views, not skip past them.** If
your module switches between screens/tabs by flipping a JS variable and
re-rendering (the norm here — most modules have no real page navigation between
views), the browser's native Back button has nothing to step through: it jumps
straight past every view change to whatever page was open before your module.
Use `UI.bindHistoryState({key, get, apply})` (`ui.js`) — call it once per
top-level screen switcher, and call the returned `.push()` once every time your
code changes that screen (after mutating state, before/after re-rendering). See
`UI.bindHistoryState`'s own doc comment in `ui.js`, or copy the wiring from
`modules/risk-register/module.js` (`histView`) or
`modules/issues-lessons/module.js` (`histScreen`). Deep drill-downs (a detail
screen two levels below the top tab) are a reasonable thing to leave for a
follow-up rather than solving in the same pass as the top-level tabs.

---

## 5. Database rules

- Your module owns its own table(s). The Phase-1 starter tables are already in
  `supabase-schema.sql`. To add a column, append an idempotent statement:
  `alter table risk_register add column if not exists xxx text;`
- **Every row must set `created_by = user.id` and `project_id`.** RLS depends on
  `created_by` for update/delete permission.
- Don't query other modules' tables directly in Phase 1. Cross-module data
  comes later (Phase 2 integrations) through the main app owner.
- File uploads → Supabase **Storage** bucket named after your module key
  (`progress-photos`, `drawing-register`, etc.). Store the path in your table's
  `*_url` column.

---

## 6. Project context

The selected project id is shared via `sessionStorage` key **`pd_project`**.
Read it on load; if empty, show a project picker using `PDb.getProjects()` and
write the chosen id back to `pd_project`. Always scope your queries with
`.eq('project_id', pid)`.

### 6b. Packages (Project → Package)

A **package** is a contract package/lot inside a project (`packages` table, see
`migrations/2026-08-19-packages.sql`). The shell exposes the selected one as
**`pd_package`** (+ `pd_package_name`) alongside `pd_project`.

- ⚠️ **A package is NOT the Main-Contract vs Change-Order split.** That is
  `scope_type`, a tag on the schedule activity itself, so a change order can sit
  inside the construction sequence where the work is. The two axes are orthogonal
  — an activity can be "Package 2" *and* "change_order".
- **Read `pd_package` as an optional narrowing, never as a requirement.** It is
  empty whenever the planner has not picked one, and most projects have no
  packages at all. `project_id` remains the scope every module must handle.
- Adopting `package_id` on your own table is a deliberate, per-module step: add
  the column *and* the UI that sets it in the same change, or you create rows
  belonging to no package that vanish from any package-filtered view.
- **Adopted so far** (2026-08-25): `project_schedule` + `wbs_nodes` (C1),
  `contracts_claims` (a claim is raised against a package) and `boq_items`
  (a BOQ trade sheet usually IS a lot — the BOQ tab *proposes* a package per
  sheet and never auto-creates one).
- ⚠️ **Deliberately NOT adopted**, and each for a reason worth keeping:
  `risk_register` / `issues_lessons` (raised about the project; a package would
  invent precision nobody has), `productivity_activities` (it already carries
  `work_package`, a WPM `wp_no` — a *different* axis, and two package-shaped
  columns on one table is how a report joins the wrong one), the `cash_flow_*`
  tables (`cash_flow_trade_packages` is already that module's own split), and
  the retired `drawing_register` / `material_submittal`.

### 6c. Publishing a dashboard tile

The project Dashboard (`dashboard.html`) shows one tile per module. It reads
**only** what your module declares as `dash` on its `config.js` entry — the shell
never reaches into your tables on its own:

```js
{ key: 'risk-register', …, dash: {
    table: 'risk_register',        // your main project-scoped table
    unit: 'risks',                 // what ONE ROW is, for the caption
    // OPTIONAL — declare only if the status vocabulary is actually fixed.
    // A guessed one reads 0 forever and looks like good news.
    attention: { column: 'status', values: ['Open'], label: 'open' },
  } }
```

Optional keys: `projectCol` (default `project_id`), `updatedCol` (default
`updated_at`; pass `null` to skip the "last updated" line). No `dash` is fine —
the tile then says no summary is published, which is honest.

---

## 7. Git workflow

- One shared GitHub repo, multiple developers. **Work on a branch named
  `module/<your-key>`**, never commit straight to `main`.
- Commit per logical change with a clear message prefixed by your module key,
  e.g. `risk-register: add edit modal`.
- Open a Pull Request into `main`; the main app owner reviews and merges.
- Keep your module's `CLAUDE.md` updated each PR.

---

## 8. Definition of done (Phase 1)

- [ ] Full CRUD: add, edit, view, list, delete records (per module needs)
- [ ] Project-scoped (uses `pd_project`)
- [ ] Uses shared auth, styles, `Fmt.esc` on all injected user text
- [ ] Works on desktop and mobile (the shared CSS is responsive)
- [ ] Table/columns added to `supabase-schema.sql` (idempotent)
- [ ] `enabled: true` flipped in `config.js` and module `CLAUDE.md` updated
- [ ] PR opened into `main`

Questions about shared code or the contract → main app owner (Planning team).
