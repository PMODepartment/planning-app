# Setup & Deployment Checklist — Planners Dashboard

One-time setup for the owner. Most is already done for the current project
(`bgupuqnkqhixpuctyder`); this is the authoritative reference and the recipe for
rebuilding from scratch.

## 1. Supabase — database
- [ ] Create a Supabase project (or use the existing one).
- [ ] Paste the **Project URL** + **anon/public** key into
      `assets/js/config.js`. **Never** use the `service_role` key in this app.
- [ ] In the SQL editor, run **[`supabase-setup.sql`](supabase-setup.sql)** in
      full (one paste — tables, grants, RLS, storage buckets, demo project +
      sample data, and the bootstrap admin promotion). It is idempotent.

## 2. Supabase — Auth settings (Dashboard → Authentication)
- [ ] **Providers → Email → "Confirm email": OFF.** New users then land in
      `pending` for admin approval (no email round-trip). If left ON, sign-ups
      can't proceed until they click a confirmation email.
- [ ] **URL Configuration:**
      - **Site URL** → `https://pmodepartment.github.io/planning-app/`
      - **Redirect URLs** → add `https://pmodepartment.github.io/planning-app/index.html`
        (required for the **Forgot password** reset link to return to the app).
- [ ] *(Optional, for rollout)* Add **custom SMTP** (Resend/Brevo). The free tier
      limits auth emails to ~3/hour, which throttles password resets at scale.
- [ ] *(Optional)* Add an **UptimeRobot** ping every 3–4 days — free Supabase
      projects pause after 7 days idle (5–30s cold start on next hit).

## 3. Bootstrap your admin account
- [ ] Open the live site → **Request access** → register with your company email.
- [ ] The bootstrap statement at the bottom of `supabase-setup.sql` promotes
      `fmlozano@megawide.com.ph` to `super_admin/approved`. If you used a
      different email, edit that statement and re-run it.
- [ ] Sign in → you should land on the **Project Management Portal** dashboard.

## 4. GitHub
- [ ] **Pages:** Settings → Pages → deploy from `main` (done — serves at
      `https://pmodepartment.github.io/planning-app/`).
- [ ] **Branch protection on `main`** (done): PR required, 1 approval, Code Owner
      review, no force-push/delete, admin bypass on.
- [ ] **CODEOWNERS:** edit `.github/CODEOWNERS`, replacing the `@PMODepartment`
      placeholders with each developer's GitHub username once assigned.

## 5. Onboard each developer
- [ ] Add them as a **collaborator** (Settings → Collaborators → **Write**).
- [ ] They **self-register** on the live site.
- [ ] You **approve** them in **Admin → Users** and **assign the `DEMO01`
      project** (and/or real projects). Non-admins only see assigned projects.
- [ ] Send them their assignment from **[`ONBOARDING.md`](ONBOARDING.md)**.

## Verifying it works (data layer)
A logged-in user's queries should return `200` (not `42501 permission denied`).
If you see `42501`, the GRANTs didn't apply — re-run the grants section of
`supabase-setup.sql`. If you see **`54001 stack depth limit exceeded`** on
tables that contain rows, the RLS helper functions need `SECURITY DEFINER` —
run `migrations/2026-06-18-fix-rls-recursion.sql` (already folded into the
current `supabase-setup.sql`). If login loops between sign-in and the dashboard, the
user has no `users` profile row — the app now self-heals this to `pending`, and
the bootstrap statement creates the owner's row.

## Run order if rebuilding piecemeal (instead of supabase-setup.sql)
`supabase-schema.sql` → `migrations/2026-06-18-project-access-rls.sql` →
`migrations/2026-06-18-grants.sql` → `migrations/2026-06-18-storage-buckets.sql`
→ `migrations/2026-06-18-phase2-modules.sql`. The consolidated
`supabase-setup.sql` already includes all of these.
