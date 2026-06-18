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
// ============================================================================

window.APP_CONFIG = {
  // ---- Supabase ----
  SUPABASE_URL: 'https://bgupuqnkqhixpuctyder.supabase.co',
  // Settings → API → Project API keys → "anon" "public". This key is SAFE to
  // expose (RLS protects the data). NEVER put the service_role key here.
  SUPABASE_ANON_KEY: 'YOUR-PUBLIC-ANON-KEY',              // TODO: paste anon key

  // ---- App ----
  APP_NAME: 'Planners Dashboard',
  ORG: 'Megawide Construction Corporation',

  // ---- Phase 1 modules (the module launcher reads this list) ----
  // `key`   — folder name under /modules and DB table prefix
  // `path`  — entry page each developer must provide
  // `icon`  — emoji/placeholder until proper icons are added
  // `enabled` — flip to true as each module is delivered
  MODULES: [
    { key: 'progress-photos',   name: 'Progress Photos',                       path: 'modules/progress-photos/index.html',   icon: '📷', enabled: false },
    { key: 'issues-lessons',    name: 'Issues, Concerns & Lessons Learned',    path: 'modules/issues-lessons/index.html',    icon: '📝', enabled: false },
    { key: 'contracts-claims',  name: 'Contracts & Claims Register',           path: 'modules/contracts-claims/index.html',  icon: '📑', enabled: false },
    { key: 'risk-register',     name: 'Risk Register',                         path: 'modules/risk-register/index.html',     icon: '⚠️', enabled: true },
    { key: 'stakeholder-map',   name: 'Stakeholder Map',                       path: 'modules/stakeholder-map/index.html',   icon: '🧭', enabled: false },
    { key: 'drawing-register',  name: 'Drawing Register',                      path: 'modules/drawing-register/index.html',  icon: '📐', enabled: false },
    { key: 'material-submittal',name: 'Material Submittal Log',                path: 'modules/material-submittal/index.html',icon: '🧱', enabled: false },
  ],
};
