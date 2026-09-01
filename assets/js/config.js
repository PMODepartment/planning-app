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
  // ⚠️ `dash` is the Project Dashboard tile spec (A5). A module without one
  // still gets a tile — it just shows no figures, which is honest. The shell
  // reads ONLY what is declared here; it never reaches into a module's tables
  // on its own. See MODULE_CONTRACT.md.
  //   table      — the module's main project-scoped table
  //   unit       — what one row IS ("risks", "activities"), for the tile caption
  //   attention  — OPTIONAL {column, values, label}. Declare it only where the
  //                vocabulary is known from the schema; a guessed one reads 0
  //                forever and looks like good news.
  MODULES: [
    { key: 'progress-photos',   name: 'Progress Photos',                       path: 'modules/progress-photos/index.html',   icon: 'camera',     enabled: true, dash: { table: 'progress_photos', unit: 'photos',
      // ⚠️ The bucket is named HERE, by the module that owns it. The shell signs whatever bucket it
      // is told about and knows nothing about where progress photos live.
      recent: { orderBy: 'taken_at', limit: 6, columns: ['title', 'works', 'taken_at', 'location'],
                bucket: 'progress-photos', pathCol: 'photo_url', ttl: 3600 } } },
    // ⚠️ Minutes of Meeting and Issues & Concerns are now TWO SEPARATE MODULES
    // (owner's explicit call) — they used to be screens in one combined module.
    // Lessons Learned stayed with the register (a lesson is captured FROM an
    // issue far more often than from a meeting). The link between the two is
    // kept as light cross-module reads, not a shared editor — see each
    // module's own CLAUDE.md.
    { key: 'minutes-of-meeting', name: 'Minutes of Meeting',                   path: 'modules/minutes-of-meeting/index.html', icon: 'calendar',  enabled: true, dash: { table: 'meeting_minutes', unit: 'meetings', attention: { column: 'is_distributed', values: [false], label: 'draft' },
      recent: { orderBy: 'meeting_date', limit: 4, columns: ['title', 'meeting_date', 'venue', 'meeting_group', 'is_distributed'] },
      // The action items, so the dashboard can show what the LATEST meeting actually decided
      // rather than only how many meetings there have been.
      sub: { table: 'mom_items', columns: ['mom_id', 'item_no', 'action_item', 'description', 'owner', 'due_date', 'status', 'type'] },
      metrics: [
        { key: 'draft',    agg: 'countWhere', column: 'is_distributed', values: [false] },
        { key: 'latest',   agg: 'max', column: 'meeting_date' },
        { key: 'earliest', agg: 'min', column: 'meeting_date' },
        // Recurring series: a minute created off a schedule carries the schedule's id.
        { key: 'series',   agg: 'countWhere', column: 'schedule_id' }
      ] } },
    { key: 'issues-lessons',    name: 'Issues, Concerns & Lessons Learned',    path: 'modules/issues-lessons/index.html',    icon: 'clipboard',  enabled: true, dash: { table: 'issues_lessons', unit: 'entries', attention: { column: 'status', values: ['Open', 'On Hold'], label: 'open' },
      recent: { orderBy: 'date_raised', limit: 4, columns: ['title', 'date_raised', 'status', 'severity', 'department'] },
      // ⚠️ A separate OPEN list rather than filtering `recent` in the panel: `recent` is capped at
      // the 4 newest entries, so on a register whose latest rows are all closed the panel would
      // have shown "nothing open" while the register carried a dozen open items.
      lists: [
        { key: 'open', orderBy: 'date_raised', dir: 'asc', limit: 5,
          columns: ['title', 'date_raised', 'status', 'severity', 'department', 'champion'],
          where: [{ column: 'status', values: ['Open', 'On Hold'] }] }
      ],
      metrics: [
        { key: 'open',     agg: 'countWhere', column: 'status', values: ['Open', 'On Hold'] },
        { key: 'onHold',   agg: 'countWhere', column: 'status', values: ['On Hold'] },
        { key: 'closed',   agg: 'countWhere', column: 'status', values: ['Closed'] },
        { key: 'latest',   agg: 'max', column: 'date_raised' },
        // ⚠️ Severity is counted only for rows that are still OPEN. A register's worth of CLOSED
        // criticals is history, not a call to action, and adding them would make a well-run
        // project look like a burning one.
        { key: 'critical', agg: 'countWhere', column: 'severity', values: ['Critical'],
          where: [{ column: 'status', values: ['Open', 'On Hold'] }] },
        { key: 'high',     agg: 'countWhere', column: 'severity', values: ['High'],
          where: [{ column: 'status', values: ['Open', 'On Hold'] }] }
      ] } },
    { key: 'contracts-claims',  name: 'Contracts & Claims Register',           path: 'modules/contracts-claims/index.html',  icon: 'contract',   enabled: true, dash: { table: 'contracts_claims', unit: 'records',
      metrics: [
        { key: 'records', agg: 'countWhere', column: 'id' },
        // The flow the dashboard draws: original contract value, then change orders by state, then
        // the revised total. record_type is a fixed vocabulary in this schema (Contract | Claim |
        // Change Order), which is what makes these safe to declare.
        { key: 'contractAmt', agg: 'sumWhere', column: 'amount', where: [{ column: 'record_type', values: ['Contract'] }] },
        { key: 'coApprovedAmt', agg: 'sumWhere', column: 'amount',
          where: [{ column: 'record_type', values: ['Change Order'] }, { column: 'status', values: ['Approved'] }] },
        { key: 'coApprovedN', agg: 'countWhere', column: 'id',
          where: [{ column: 'record_type', values: ['Change Order'] }, { column: 'status', values: ['Approved'] }] },
        // ⚠️ "Pending" is everything that is a change order and NOT approved. Listing the pending
        // words instead would silently drop any status nobody thought of.
        { key: 'coOtherAmt', agg: 'sumWhere', column: 'amount', where: [{ column: 'record_type', values: ['Change Order'] }] },
        { key: 'coAllN', agg: 'countWhere', column: 'id', where: [{ column: 'record_type', values: ['Change Order'] }] },
        { key: 'claimN', agg: 'countWhere', column: 'id', where: [{ column: 'record_type', values: ['Claim'] }] },
        // ⚠️ The figure the dashboard's attention count uses. A record COUNT cannot answer "what is
        // outstanding": an unresolved claim is one with no date_resolved.
        { key: 'claimOpen', agg: 'countWhere', column: 'id',
          where: [{ column: 'record_type', values: ['Claim'] }, { column: 'date_resolved', absent: true }] }
      ] } },
    { key: 'risk-register',     name: 'Risk Register',                         path: 'modules/risk-register/index.html',     icon: 'risk',       enabled: true, dash: { table: 'risk_register', unit: 'risks', attention: { column: 'status', values: ['Open'], label: 'open' },
      metrics: [
        { key: 'open', agg: 'countWhere', column: 'status', values: ['Open'] },
        // likelihood and impact are 1..5 in this schema, so the high/low split is 3.
        { key: 'matrix', agg: 'matrix2', x: 'impact', y: 'likelihood', split: 3,
          where: [{ column: 'status', values: ['Open'] }] }
      ] } },
    { key: 'stakeholder-map',   name: 'Stakeholder Map',                       path: 'modules/stakeholder-map/index.html',   icon: 'compass',    enabled: true, dash: { table: 'stakeholder_map', unit: 'stakeholders',
      // ⚠️ influence and interest are 1..4 here (and stored as TEXT), so the split is 3, not the
      // risk register's midpoint. Declaring it per module is why one engine can serve both.
      metrics: [ { key: 'matrix', agg: 'matrix2', x: 'interest', y: 'influence', split: 3 } ] } },
    // ⚠️ RETIRED — these two moved to the ENGINEERING APP, which is now the single
    // source for both registers. The modules and their tables are still here, and the
    // rows in them are the pre-cutover originals: readable, but STALE the moment
    // anyone edits the real register next door. Turning them off is what stops two
    // registers drifting apart while both look authoritative.
    //
    // The Project Schedule's Design Development branch no longer reads these tables
    // either — it reads the `eng_design_progress` mirror (Edge Function `sync-eng`).
    //
    // ⚠️ Dropping `drawing_register` / `material_submittal` here is a SEPARATE,
    // deliberate step, not part of this change: verify the mirror end-to-end first,
    // and confirm nothing in the local tables was left behind by the cutover. A
    // disabled module is reversible; a dropped table is not.
    { key: 'drawing-register',  name: 'Drawing Register',                      path: 'modules/drawing-register/index.html',  icon: 'ruler',      enabled: false, retiredTo: 'the Engineering App', externalUrl: 'https://pmodepartment.github.io/engineering-app/' },
    { key: 'material-submittal',name: 'Material Submittal Log',                path: 'modules/material-submittal/index.html',icon: 'box',        enabled: false, retiredTo: 'the Engineering App', externalUrl: 'https://pmodepartment.github.io/engineering-app/' },
    // ---- Phase 2 ----
    { key: 'project-schedule',  name: 'Project Schedule & Cost Loading',       path: 'modules/project-schedule/index.html', icon: 'calendar',    enabled: true, dash: { table: 'project_schedule', unit: 'activities',
      // ⚠️ WBS Summary rows are roll-up headings, not work. Counting them would inflate every figure
      // on the card (a 500-activity project reads as 800) and drag the weighted % toward whatever
      // the branches happen to store.
      exclude: { column: 'activity_type', values: ['WBS Summary'] },
      // ⚠️ Declares that this module publishes an S-CURVE, computed by assets/js/scurve.js —
      // the same engine the S-Curve module itself uses, so the dashboard panel and the module
      // cannot disagree about one project's curve. Duration basis, matching the module's own
      // default: a project with no cost loading must not silently open on a money curve built
      // from a handful of priced activities.
      curve: { basis: 'dur' },
      // Approaching deadlines. ⚠️ `from: -30` deliberately reaches into the PAST: an activity that
      // was due last week and is still not finished is the most urgent thing on this list, and a
      // window that started at today would hide exactly those. Milestones and tasks both qualify —
      // a slipped milestone is the one a planner most needs to see.
      // ⚠️ `percent_complete` is filtered as well as `status`, and it has to be: the two are set
      // independently, so an activity finished on site and ticked to 100% but never moved off
      // 'In Progress' would otherwise headline this panel as overdue. Unfinished means BOTH.
      lists: [
        { key: 'dueSoon', orderBy: 'end_date', dir: 'asc', limit: 8,
          columns: ['activity_id', 'activity_name', 'end_date', 'percent_complete', 'status', 'work_type', 'activity_type'],
          where: [
            { column: 'status', notValues: ['Completed'] },
            { column: 'percent_complete', below: 100 },
            { column: 'end_date', withinDays: { from: -30, to: 30 } }
          ] },
        // ⚠️ The same rows, past-due only. It exists for its COUNT: the panel shows at most 8 rows
        // and must not report "1 overdue" by counting the 8 it happens to be showing.
        { key: 'overdue', orderBy: 'end_date', dir: 'asc', limit: 1,
          columns: ['activity_id', 'end_date'],
          where: [
            { column: 'status', notValues: ['Completed'] },
            { column: 'percent_complete', below: 100 },
            { column: 'end_date', withinDays: { from: -30, to: -1 } }
          ] }
      ],
      metrics: [
        { key: 'start',   agg: 'min',  column: 'start_date' },
        { key: 'finish',  agg: 'max',  column: 'end_date' },
        // Duration-weighted, matching the roll-ups inside the module — a plain average would let a
        // one-day activity count as much as a six-month one.
        { key: 'poc',     agg: 'wavg', column: 'percent_complete', weight: 'duration_days' },
        { key: 'budget',  agg: 'sum',  column: 'planned_cost' },
        { key: 'actual',  agg: 'sum',  column: 'actual_cost' },
        { key: 'baselined', agg: 'countWhere', column: 'bl_finish' },
        { key: 'done',    agg: 'countWhere', column: 'status', values: ['Completed'] },
        { key: 'active',  agg: 'countWhere', column: 'status', values: ['In Progress'] },
        // EVM. CPI = EV / AC, both real columns. SPI = EV / planned value, and the planned value is
        // "where the baseline says the money should be by today" — expressed generically as a
        // time-elapsed % between the two BASELINE date columns, weighted by planned cost.
        // ⚠️ Rows with no baseline are excluded from 'pv' (the elapsed shape skips them), so SPI is
        // reported only when there is a baseline to measure against — the same rule the module
        // applies to its own Planned Value % column.
        // ⚠️ sumEarned, not sum: a stored earned_value wins, and an activity that has none earns
        // planned_cost x percent_complete. A plain sum reported null on every cost-loaded project
        // that had not ALSO been hand-valued, which made the dashboard's EVM panel read as "not
        // loaded" while the schedule grid showed money on every line.
        { key: 'ev', agg: 'sumEarned', column: 'earned_value', amount: 'planned_cost', pct: 'percent_complete' },
        { key: 'pv', agg: 'elapsed', from: 'bl_start', to: 'bl_finish', weight: 'planned_cost' },
        // ⚠️ The SAME elapsed shape, weighted by DURATION rather than cost. This exists so the
        // dashboard's "Planned POC" and "Actual POC" cards are measured the same way: `poc` is a
        // duration-weighted % complete, so comparing it against the COST-weighted `pv` would put
        // two different bases side by side and invite a reader to subtract one from the other.
        // `pv` stays cost-weighted because SPI is a money ratio and EVM defines it that way.
        { key: 'pvDur', agg: 'elapsed', from: 'bl_start', to: 'bl_finish', weight: 'duration_days' },
        // The programme view: one bar per trade, its span, its weighted % and how many are done.
        { key: 'program', agg: 'groupSpan', group: 'work_type', from: 'start_date', to: 'end_date',
          pct: 'percent_complete', weight: 'duration_days', doneCol: 'status', doneValues: ['Completed'] }
      ] } },
    { key: 's-curve',           name: 'S-Curve',                               path: 'modules/s-curve/index.html',           icon: 'trendingUp', enabled: true, dash: { table: 's_curve', unit: 'points' } },
    // ⚠️ NO dash.metrics on s-curve, deliberately. A `series` metric over the `s_curve` TABLE was
    // added here on 2026-09-01 and removed the same day: the S-Curve module derives its curve from
    // `project_schedule` (which is the correct design — the curve IS the schedule, re-cut by
    // month), and NOTHING writes the `s_curve` table. The metric therefore read an empty table and
    // the dashboard card said "No curve published" on every project, forever. The dashboard's own
    // S-curve must be derived the same way the module derives it, from the schedule.
    { key: 'resource-loading',  name: 'Resource & Role Master',                path: 'modules/resource-loading/index.html',  icon: 'users',      enabled: true, dash: { table: 'resources', unit: 'resources' } },
    { key: 'equipment-loading', name: 'Equipment Loading',                      path: 'modules/equipment-loading/index.html', icon: 'box',        enabled: true, dash: { table: 'equipment_items', unit: 'equipment' } },
    // ⚠️ No `attention` key. The obvious one would be "positions short this month", but that is
    // a comparison between two columns of manpower_loading, not a status value on this table —
    // the tile reader can only count rows matching fixed values, so a guessed rule would read 0
    // forever and look like good news. The Portfolio tab is where the shortfall is answered.
    { key: 'manpower-loading', name: 'Manpower Loading',                        path: 'modules/manpower-loading/index.html', icon: 'users',      enabled: true, dash: { table: 'manpower_positions', unit: 'positions' } },
    { key: 'productivity-rates',name: 'Productivity Rates',                    path: 'modules/productivity-rates/index.html',icon: 'barChart',   enabled: true, dash: { table: 'productivity_entries', unit: 'entries' } },
    { key: 'cash-flow',         name: 'Cash Flow',                             path: 'modules/cash-flow/index.html',         icon: 'cash',       enabled: true, dash: { table: 'cash_flow_rollup', unit: 'periods' } },
  ],
};
