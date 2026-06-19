# Getting Started (for first-time developers)

Welcome! You don't need prior web-development experience. You'll use **Claude
Code** to build your assigned module, and **GitHub Desktop** to save your work.
This guide walks you through everything once.

> You are building **one module**. Everything you need is already in this
> project — you won't be sent any files. Your guardrails are `MODULE_CONTRACT.md`
> (the rules) and two finished example modules you can copy.

---

## Step 1 — Accept your invitations
- **GitHub:** you'll get an email inviting you to the `PMODepartment/planning-app`
  repository. Click **Accept**.
- **The app:** open the live site (link below), click **Request access**, and
  register with your Megawide email. Tell the project owner — they'll approve you
  and give you the **DEMO01** sandbox project to test with.
  - Live site: `https://pmodepartment.github.io/planning-app/`

## Step 2 — Install two tools
1. **GitHub Desktop** — https://desktop.github.com/  (sign in with your GitHub account)
2. **Claude Code** — follow Anthropic's installer, then sign in with your Claude account.

## Step 3 — Get the project onto your computer
In **GitHub Desktop**: `File → Clone repository → PMODepartment/planning-app →
Clone`. Remember the folder it saves to.

## Step 4 — Make your own branch (so you never touch the main copy)
In **GitHub Desktop**: `Current Branch → New Branch`. Name it exactly
**`module/<your-key>`** (your key is in the message the owner sent you, e.g.
`module/progress-photos`). Click **Publish branch**.

## Step 5 — Open the project in Claude Code and let it build
Open the cloned folder in **Claude Code**, then paste the starter prompt the
owner gave you (it names your module). In short, it tells Claude:

> Read `MODULE_CONTRACT.md` and `CONTRIBUTING.md`, then build the `<your-key>`
> module by copying the suggested reference module. Work only inside
> `modules/<your-key>/`. Use the shared login, styling, and database helpers.

Claude will read the rules and the example, then write your module. Talk to it
in plain English about what your module should do (fields, columns, behavior).

## Step 6 — Test it
Ask Claude Code: **"run the app locally so I can see my module."** It will start
a local server and give you a link like `http://localhost:8000`. Open it, sign
in with your account, pick the **DEMO01** project, and try your module.
(Open it via the `http://localhost…` link, not by double-clicking a file.)

## Step 7 — Save your work
In **GitHub Desktop**: type a short **Summary** of what changed → **Commit to
module/<your-key>** → **Push origin**. Do this whenever you finish a chunk.

## Step 8 — Submit for review
In **GitHub Desktop**, click **Preview Pull Request → Create Pull Request**
(it opens your browser). Write a sentence about what you built and submit. The
project owner reviews it and merges. If they request changes, repeat Steps 5–8.

---

## Golden rules
- **Only change files inside your `modules/<your-key>/` folder.** Don't edit the
  shared `assets/` files or other people's modules. (Two tiny exceptions are in
  `MODULE_CONTRACT.md` — Claude knows them.)
- **Never commit to `main`** — always your `module/<your-key>` branch.
- When unsure, ask Claude Code, or ask the project owner. Don't edit shared files.

## If something breaks
- Press **F12** in the browser → **Console** tab → copy any red text and paste it
  to Claude Code; it can usually fix it.
- Sign-in not working? Make sure the owner has **approved** you and assigned
  **DEMO01**.
