# Contributing — Planners Dashboard

Multiple developers build modules into **one** shared repo. This page is the
git workflow. For *what* to build, see **[MODULE_CONTRACT.md](MODULE_CONTRACT.md)**.

---

## 1. Identify yourself (do this once, in the repo folder)

Even if everyone pushes from the same GitHub login, set a **distinct git author
identity** on each developer's machine so commits are attributable:

```bash
git config user.name  "Juan Dela Cruz"
git config user.email "jdelacruz@megawide.com.ph"
```

> Preferred: each developer uses their **own** free GitHub account and is added
> as a **collaborator** on `PMODepartment/planning-app` (Settings → Collaborators).
> That gives real per-person history and review. The shared-login fallback works
> too, but set the author identity above so blame/history stays meaningful.

---

## 1b. Run it locally

No build step. Serve the repo root with any static server and open it:

```bash
# Python (any OS)
python -m http.server 8000
#   then open http://localhost:8000

# or Node
npx serve .
```

- Supabase URL + anon key are already in `assets/js/config.js` — no env setup.
- **Log in:** register on the **live** site, ask the app owner to approve you and
  assign the **`DEMO01`** sandbox project. Then sign in locally with that account.
  (Auth/data go to the shared Supabase, so local and live use the same login.)
- Select **`DEMO01`** in your module's project picker — it has sample data.
- Open your module at `http://localhost:8000/modules/<your-key>/`.

> Open the page via the server URL, not by double-clicking the file
> (`file://`), or the Supabase calls and relative paths won't work.

## 2. One branch per module — never commit to `main`

```bash
git checkout main
git pull
git checkout -b module/risk-register      # use YOUR assigned module key
```

Branch names are fixed: `module/<your-module-key>` (see MODULE_CONTRACT.md §1).

## 3. Commit scope

- Touch **only** your `modules/<key>/` folder.
- Allowed shared edits: flip your `enabled` flag in `assets/js/config.js`, add
  *your* table to `supabase-schema.sql`. Anything else → ask the app owner.
- Prefix messages with your key: `risk-register: add edit modal`.

## 4. Stay current & avoid conflicts

```bash
git fetch origin
git rebase origin/main      # before opening a PR, pull main's changes in
```

Because each developer stays inside their own folder, conflicts should only ever
happen in the two shared files above — keep those edits minimal.

## 5. Open a Pull Request into `main`

- Push your branch: `git push -u origin module/<key>`
- Open a PR. The app owner (Planning team) reviews and merges.
- Keep `modules/<key>/CLAUDE.md` updated in the same PR.

## 6. CODEOWNERS

`.github/CODEOWNERS` routes review of shared files to the app owner and module
folders to their developer. Update it when developers are assigned.

---

### Quick reference
| Do | Don't |
|---|---|
| Work on `module/<key>` | Commit to `main` |
| Edit only your module folder | Touch other modules / shared JS |
| Rebase on `main` before PR | Force-push shared branches |
| Set your git author identity | Leave commits as the shared login |
