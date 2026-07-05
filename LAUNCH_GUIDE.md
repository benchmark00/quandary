# Launch Quandary — the dummy-proof guide

This walks you from a folder of files to **Quandary running on your phone**, then to a **real app with accounts and push notifications** — assuming you've never deployed anything before. Every command is copy-paste. After each step there's a ✅ check so you know it worked before moving on.

---

## First, what "launch" actually means

There are two finish lines. Do them in order:

- **Stage 1 — The experience, live (≈30 min).** Quandary on your phone's home screen with the seeded sample questions, so you and your friends can *feel* it and react. No accounts yet; it resets when closed. **This is the fastest, most satisfying win — start here.**
- **Stage 2 — The real product (a few hours, spread out).** Real sign-ups, saved data, and push notifications, powered by the backend. The last step of Stage 2 (connecting the screens to the database) is genuine development work — I'll be honest about that when we get there.

You can soft-launch to your dinner crowd at the end of Stage 1 and keep building Stage 2 underneath.

---

## Before you start: 4 free accounts + one install

Sign up for these (all have free tiers; no credit card needed to begin):

1. **Supabase** — your database + logins → https://supabase.com
2. **Netlify** — puts your site online → https://netlify.com
3. **GitHub** *(optional but recommended)* — stores your code → https://github.com
4. A **code editor** to open the files: **VS Code** → https://code.visualstudio.com

You'll also need **Node.js**, which runs the project. Install the **LTS** version from https://nodejs.org. To confirm it worked, open your **Terminal** (Mac: press `Cmd+Space`, type "Terminal", Enter. Windows: Start menu → "Command Prompt") and type:

```bash
node -v
```

✅ **Check:** you see a version number like `v20.x.x`. If "command not found", restart your computer after installing Node and try again.

> **The Terminal** is just a place to type commands. When this guide shows a grey box, type (or paste) that line into the Terminal and press Enter. To paste in Terminal: Mac `Cmd+V`, Windows `Ctrl+V` or right-click.

---

# STAGE 1 — Get Quandary live on your phone

### Step 1 — Put the project on your computer

Unzip `quandary-backend.zip`. You'll get a folder called **`quandary`**. Move it somewhere easy, like your Desktop.

In Terminal, navigate into it. Type `cd ` (with a space), then **drag the `quandary` folder onto the Terminal window** — it'll paste the path — then press Enter:

```bash
cd /path/to/quandary
```

✅ **Check:** type `ls` (Mac) or `dir` (Windows) and press Enter. You should see `package.json`, `index.html`, `src`, `public`, and `supabase` listed.

### Step 2 — Install the project's building blocks

```bash
npm install
```

This downloads everything the project needs (React, the Supabase library, etc.). It takes a minute and creates a `node_modules` folder — ignore that folder, it's normal.

✅ **Check:** it finishes with no red `ERR!` lines. A few yellow warnings are fine.

### Step 3 — Run it on your computer

```bash
npm run dev
```

✅ **Check:** you see a line like `Local: http://localhost:5173/`. Hold Cmd/Ctrl and click it, or paste it into your browser. **Quandary opens, starting with the onboarding screen.** Click through it and play with the feed.

> To stop the server later, click the Terminal and press `Ctrl+C`. To start it again, `npm run dev`.

### Step 4 — Add your app icons

Your manifest expects icon files that aren't in the folder yet. From the **Quandary logo pack**, export PNGs and drop them into the `quandary/public/icons/` folder (create the `icons` folder if it's not there) with these exact names:

- `icon-192.png` (192×192)
- `icon-512.png` (512×512)
- `icon-maskable-512.png` (512×512, the version with padding around the Q)
- `badge-72.png` (72×72, simple single-colour Q — used on notifications)

> No icons yet? It'll still work and install — you'll just get a default icon. You can add them anytime.

### Step 5 — Build the final version

Stop the dev server (`Ctrl+C`), then:

```bash
npm run build
```

✅ **Check:** a new **`dist`** folder appears. That folder *is* your website.

### Step 6 — Put it online (the easy way)

1. Go to https://app.netlify.com/drop
2. Drag your **`dist`** folder onto the page.
3. Wait ~20 seconds. Netlify gives you a live link like `https://random-name-123.netlify.app`.

✅ **Check:** open that link on your computer — Quandary loads. 🎉 It's on the internet.

> Want a nicer URL and automatic updates when you change code? That's the GitHub + Netlify route in the "Level up" section at the bottom. The drag-and-drop above is perfect for now.

### Step 7 — Add it to your home screen

Open your Netlify link **on your phone**:

- **iPhone (Safari):** tap the **Share** icon → **Add to Home Screen** → **Add**.
- **Android (Chrome):** tap the **⋮** menu → **Install app** (or **Add to Home screen**).

✅ **Check:** the Quandary Q is now an icon on your home screen, and tapping it opens full-screen with no browser bar. **That's a real PWA.**

### 🏁 Stage 1 done

Text your dinner crowd the link, tell them to add it to their home screen, and watch them react to the questions. (Heads up: it's still using sample data and resets on close — that's what Stage 2 fixes.)

---

# STAGE 2 — Turn on the real backend

> Heads-up on order: Stages 2.1–2.3 set up your database, logins, and push **infrastructure**. The app won't actually *use* them until **Stage 2.4 (Connect the app)** — so don't panic if signing up doesn't work right after Step 2.1. That's expected.

## 2.1 — Create your database and run the schema

1. In Supabase, click **New project**. Pick a name and a strong database password (save it somewhere). Choose the region closest to your dinner crowd. Wait ~2 minutes for it to provision.
2. In the left sidebar, open **SQL Editor** → **New query**.
3. Open the file `quandary/supabase/migrations/0001_init.sql` in VS Code, select all (`Cmd/Ctrl+A`), copy, and paste it into the Supabase query box.
4. Click **Run** (bottom right).

✅ **Check:** it says "Success. No rows returned." In the sidebar, open **Table Editor** — you should see `profiles`, `questions`, `votes`, `clarifications`, and the rest. Your whole data model is now live.

## 2.2 — Turn on logins

1. Sidebar → **Authentication** → **Providers**.
2. Make sure **Email** is enabled.
3. For easiest testing, scroll to **Email** settings and **turn off "Confirm email"** for now (so test signups work instantly). Turn it back on before a wider launch.

✅ **Check:** Email shows as enabled.

## 2.3 — Grab your two public keys

1. Sidebar → **Project Settings** (gear icon) → **API**.
2. Copy two things:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (a long string)

> These two are safe to put in your app. **Never** copy the `service_role` key into your app — that one's a master key, kept secret, used only by the push function.

## 2.4 — Connect the app to the backend (the real work)

This is the step where the screens start talking to the database — and it's genuine development, not copy-paste. Here's exactly what it involves so it's not a mystery:

1. **Create a `.env` file** in the `quandary` folder (copy `.env.example` and rename it to `.env`), and fill in:
   ```
   VITE_SUPABASE_URL=your Project URL
   VITE_SUPABASE_ANON_KEY=your anon public key
   ```
2. **Add a login/signup screen** in front of the app (uses `signUp` / `signIn` from `src/lib/api.js`).
3. **Replace the in-memory actions with the real ones.** The app currently keeps everything in React state. `src/lib/api.js` already has a matching function for each action — `vote()`, `reply()`, `askClarification()`, `answerClarification()`, `follow()`, `createQuestion()`, and so on. Wiring is mostly swapping each `setQuestions(...)` call for the matching `api` call, and loading the feed from `listFeed()` instead of the seed data.

This is the one part I'd recommend not doing solo if code isn't your thing. **Two good options:** hand this file list to any React developer (it's a well-defined day or two of work), **or come back to me and I'll wire it screen by screen with you.** Everything it needs already exists in the scaffold.

---

# STAGE 3 — Push notifications (optional for first launch)

You can launch without this and add it later. When you're ready:

### 3.1 — Generate your push keys

In Terminal, inside the `quandary` folder:

```bash
npx web-push generate-vapid-keys
```

✅ **Check:** it prints a **Public Key** and a **Private Key**. Copy both somewhere safe.

### 3.2 — Install the Supabase command-line tool

```bash
npm install -g supabase
supabase login
```

`supabase login` opens your browser to confirm. Then link your project (find your "ref" in your Supabase project URL):

```bash
supabase link --project-ref YOUR-PROJECT-REF
```

### 3.3 — Give the push function its secrets

```bash
supabase secrets set VAPID_PUBLIC_KEY=your-public-key VAPID_PRIVATE_KEY=your-private-key VAPID_SUBJECT=mailto:you@youremail.com
```

### 3.4 — Deploy the push function

```bash
supabase functions deploy send-push --no-verify-jwt
```

✅ **Check:** it reports the function deployed. You'll also see it under **Edge Functions** in the dashboard.

### 3.5 — Tell it to fire on new questions

1. Dashboard → **Database** → **Webhooks** → **Create a new hook**.
2. Table: **questions**. Events: **Insert**.
3. Type: **Supabase Edge Functions** → choose **send-push**.
4. Save.

### 3.6 — Add the public key to your app

In your `.env`, add:
```
VITE_VAPID_PUBLIC_KEY=your-public-key
```
Rebuild (`npm run build`) and redeploy. Push subscriptions get saved when someone enables notifications (wired up as part of Stage 2.4 using `enablePush()` in `src/lib/push.js`).

> **iPhone reality:** push only works after someone has **added Quandary to their home screen** — never in a plain Safari tab. That's why onboarding walks people through installing first.

---

## Launching to your circle — a few tips

- **Start small on purpose.** Share the link with 10–15 friends first. The app is built public, so it scales up later, but a small group makes the early conversations great.
- **Moderation is report-based.** The flag on each question feeds the `reports` table; a question auto-hides once it crosses the threshold (currently 5 reports — change the `5` in the schema's report trigger to taste).
- **Seed the fun.** Post 5–10 of your best dinner-party questions yourself before inviting people, so the feed isn't empty on day one.
- **Turn email confirmation back on** (Stage 2.2) before going wider.

---

## Troubleshooting

- **`command not found: node` / `npm`** — Node didn't install or needs a restart. Reinstall the LTS from nodejs.org, restart, retry `node -v`.
- **`npm install` fails with permission errors** — try again; on Mac avoid using `sudo`. If it persists, close and reopen Terminal.
- **Blank white screen after deploying** — usually a missing `.env` value once you're on Stage 2. Check the browser's Console (right-click → Inspect → Console) for the red error.
- **"Add to Home Screen" missing on iPhone** — you must be in **Safari** (not Chrome) on iOS, and on the live Netlify link (not localhost).
- **Push never arrives** — confirm the home-screen install, that the webhook is firing (Webhooks → Logs), and that the person's notification prefs actually match the question.

---

## Cheat sheet

```bash
cd /path/to/quandary     # go into the project
npm install              # one-time: install dependencies
npm run dev              # run locally while developing
npm run build            # build the final site (creates dist/)
```

Then drag `dist/` to https://app.netlify.com/drop to publish.

---

## Level up later (when you want it)

- **Auto-deploys:** push your code to a **GitHub** repo, then in Netlify "Add new site → Import from Git". Every change you push goes live automatically — no more drag-and-drop.
- **Custom domain:** buy something like `quandary.app` and point it at Netlify in the domain settings.
- **Nicer feed ranking & Question of the Day:** the "Hot" sort and daily pick are noted as next steps in `README.md`.

You've got this. Stage 1 alone is a real, installable app — get that on your phone today and the rest can follow at your pace.
