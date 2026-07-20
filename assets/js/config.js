// ============================================================================
// Planners Dashboard — Global Config
// ----------------------------------------------------------------------------
// Single source of truth for Supabase credentials and app-wide constants.
// Every page and every module loads THIS file first (before auth.js / db.js).
//
// SETUP: create a new Supabase project at https://supabase.com, then paste the
// Project URL and the public "anon" API key below (Settings → API).
// The anon key is safe to expose in client-side code — row-level security (RLS)
// in Supabase is what actually protects the data.
// =================================================================h===========

window.APP_CONFIG = {
  // ---- Supabase ----
  SUPABASE_URL: 'https://bgupuqnkqhixpuctyder.supabase.co',
  // Settings → API → API Keys → "publishable" key (sb_publishable_…). This key is
  // SAFE to expose (RLS protects the data). NEVER put the secret/service_role key here.
  // Replaced the legacy HS256 "anon" JWT on 2026-07-11 (that JWT can be revoked once
  // this publishable key is confirmed live in production).
  SUPABASE_ANON_KEY: 'sb_publishable_5NTpDRZcROZYrV-tZ5wXLg_f88eqUzs',

  // ---- App ----
  APP_NAME: 'Planners Dashboard',
  ORG: 'Megawide Construction Corporation',

  // ---- Phase 1 modules (the module launcher reads this list) ----
  // `key`   — folder name under /modules and DB table prefix
  // `path`  — entry page each developer must provide
  // `icon`  — emoji/placeholder until proper icons are added
  // `enabled` — flip to true as each module is delivered
  // NOTE: Portfolio Overview is intentionally NOT a per-project module — it's a
  // cross-project view reached from the Projects selector (projects.html), so the
  // module grid never implies it belongs to the currently-open project.
  MODULES: [
    { key: 'progress-photos',   name: 'Progress Photos',                       path: 'modules/progress-photos/index.html',   icon: 'camera',     enabled: true },
    { key: 'issues-lessons',    name: 'Issues, Concerns & Lessons Learned',    path: 'modules/issues-lessons/index.html',    icon: 'clipboard',  enabled: true },
    { key: 'contracts-claims',  name: 'Contracts & Claims Register',           path: 'modules/contracts-claims/index.html',  icon: 'contract',   enabled: true },
    { key: 'risk-register',     name: 'Risk Register',                         path: 'modules/risk-register/index.html',     icon: 'risk',       enabled: true },
    { key: 'stakeholder-map',   name: 'Stakeholder Map',                       path: 'modules/stakeholder-map/index.html',   icon: 'compass',    enabled: false },
    { key: 'drawing-register',  name: 'Drawing Register',                      path: 'modules/drawing-register/index.html',  icon: 'ruler',      enabled: true },
    { key: 'material-submittal',name: 'Material Submittal Log',                path: 'modules/material-submittal/index.html',icon: 'box',        enabled: true },
    // ---- Phase 2 ----
    { key: 'project-schedule',  name: 'Project Schedule & Cost Loading',       path: 'modules/project-schedule/index.html', icon: 'calendar',    enabled: true },
    { key: 's-curve',           name: 'S-Curve',                               path: 'modules/s-curve/index.html',           icon: 'trendingUp', enabled: true },
    { key: 'resource-loading',  name: 'Resource & Role Master',                path: 'modules/resource-loading/index.html',  icon: 'users',      enabled: true },
    { key: 'productivity-rates',name: 'Productivity Rates',                    path: 'modules/productivity-rates/index.html',icon: 'barChart',   enabled: false },
    { key: 'cash-flow',         name: 'Cash Flow',                             path: 'modules/cash-flow/index.html',         icon: 'cash',       enabled: true },
  ],
};
