-- ============================================================================
-- Migration: projects.program — an explicit PARENT PROJECT override
--
-- Run this whole file in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- WHY
--   Owner, 2026-08-27: "AVR101 and AVR101 are treated separately. LCR352 and
--   LCR102 are treated the same way. Let's do a global approach for this in the
--   planning-app first."
--
--   Megawide buys one development as several PROJECTS, each with its own code
--   (AVR101 + AVR102 = Avesta Residences). Procurement and Engineering hold them
--   the same way, so the codes are the shared key across all three apps. The app
--   groups them by the leading letters of the project id, which every code in
--   this portfolio already follows — so the rollup works with NO data entry.
--
--   This column exists only for the cases the convention cannot express:
--     · two unrelated developments that happen to share a prefix;
--     · one development split across prefixes after a rebrand or a re-coding.
--
-- ⚠️ NULL IS THE NORMAL STATE AND NOTHING IS BACK-FILLED. A blank `program`
--    means "use the code prefix", which is the right answer for almost every
--    project. Back-filling it with the prefix would turn a convention that
--    self-corrects when a project is re-coded into ~20 stored strings that go
--    stale silently — and would make a genuine override indistinguishable from
--    a value the migration wrote.
--
-- ⚠️ IT IS A ROLLUP, NOT A HIERARCHY. There is deliberately NO parent_id and no
--    `programs` table. A project is never a child row of another project: the
--    apps map one Planners project to one downstream project each, and a real
--    parent-child link would invite the AVR101 › {AVR101, AVR102} nesting this
--    whole change exists to remove. Grouping happens at read time.
--
-- ⚠️ NO FOREIGN KEY AND NO LOOKUP TABLE, deliberately unlike `group_heads`.
--    A group head is an assignment that drives access and reporting, so a typo
--    there fragments something load-bearing. A parent project is a display
--    grouping over ids that already agree; a lookup table would be a second
--    place to maintain the same fact, and the prefix would still be the real key.
-- ============================================================================

alter table projects add column if not exists program text;

comment on column projects.program is
  'Optional parent-project override. Blank (the normal case) means the app '
  'groups this project by the leading letters of its id (AVR101 -> AVR). Set it '
  'only when the code prefix is wrong: two developments sharing a prefix, or one '
  'development split across prefixes. Grouping is a reporting rollup only — the '
  'projects stay separate rows, which is what keeps the 1:1 mapping to the '
  'Procurement and Engineering apps intact.';

-- Case-insensitive, so 'AVR' and 'avr' group together rather than forming two
-- parents that look identical on screen.
create index if not exists projects_program_idx on projects (upper(program));

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
-- No policy change. `projects` already carries per-command policies
-- (projects_read / _ins / _upd / _del, see 2026-07-16-consolidated.sql) and a
-- new column inherits them. ⚠️ Do NOT add a policy here: the 2026-07-16 fix
-- exists because a `for all` policy on this table silently granted every planner
-- read access to every project, and re-introducing one would reopen that.
