# Quandary — backend scaffold

The data model and infrastructure behind the prototype: a Supabase (Postgres +
Auth + Realtime) backend, Web Push notifications, and the PWA plumbing that lets
people add Quandary to their home screen.

> You supply your own keys throughout. Nothing here contains secrets — fill in
> `.env` from `.env.example` and keep the service-role key server-side only.

## What's in here

```
quandary/
├─ supabase/
│  ├─ migrations/0001_init.sql        # full schema: tables, RLS, triggers, QOTD
│  └─ functions/send-push/index.ts    # fans out push when a question is posted
├─ public/
│  ├─ manifest.webmanifest            # makes it installable
│  └─ sw.js                           # service worker: shows pushes, handles taps
├─ src/lib/
│  ├─ supabase.js                     # browser client
│  ├─ api.js                          # data layer (mirrors the prototype actions)
│  └─ push.js                         # subscribe / unsubscribe + SW registration
└─ .env.example
```

## The data model at a glance

`profiles` (1:1 with auth users) → `questions` → `question_options`, `votes`,
`replies`, `clarifications`, `ratings`. Social edges live in `follows` and
`saves`; moderation in `reports` (report-based: a trigger bumps `report_count`
and auto-hides a question past a threshold). Notifications are split in two:
`notification_prefs` + `push_subscriptions` drive **push**, while the
`notifications` table (filled by triggers) drives the in-app **Alerts** feed.

Two design points worth knowing:

- **Anonymous votes are enforced in the database, not just hidden in the UI.**
  Direct reads of `votes` are revoked; clients read the `vote_details` view,
  which nulls `voter_id` whenever the question is anonymous. There's no query a
  user can craft to unmask an anonymous poll.
- **Only the question's author can answer a clarification.** A guard trigger
  blocks anyone else from writing `answer_body` and freezes the asker's original
  text, so the Q&A thread can't be tampered with.

## Setup

1. **Create a Supabase project**, then run the migration:
   ```bash
   supabase link --project-ref YOUR-REF
   supabase db push          # applies supabase/migrations/0001_init.sql
   ```
   Enable email auth (or a provider) in Authentication → Providers.

2. **Generate VAPID keys** for Web Push (one keypair, used in two places):
   ```bash
   npx web-push generate-vapid-keys
   ```
   Put the public key in `VITE_VAPID_PUBLIC_KEY`, and set both on the function:
   ```bash
   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
                        VAPID_SUBJECT=mailto:you@quandary.app
   ```

3. **Deploy the push function** and wire it to new questions:
   ```bash
   supabase functions deploy send-push --no-verify-jwt
   ```
   In Database → Webhooks, add a webhook on `public.questions`, **INSERT**, that
   calls the `send-push` function. Every new question now fans out to the right
   people based on their preferences.

4. **Frontend env:** copy `.env.example` → `.env` and fill in the project URL,
   anon key, and VAPID public key.

5. **Serve the PWA over HTTPS.** Reference the manifest and register the worker
   in your app shell:
   ```html
   <link rel="manifest" href="/manifest.webmanifest" />
   <meta name="theme-color" content="#6C4DFF" />
   ```
   ```js
   import { registerSW } from "./src/lib/push";
   registerSW();
   ```
   Add real PNG icons under `public/icons/` (192, 512, maskable-512, badge-72) —
   the logo pack's app-icon exports drop straight in.

## Wiring the prototype to this

Each in-memory action in the prototype has a one-to-one function in `api.js`:
`vote` → `vote()`, `reply` → `reply()`, `askClarif` → `askClarification()`,
`answerClarif` → `answerClarification()`, `toggleFollow` → `follow()/unfollow()`,
`createQuestion` → `createQuestion()`, and so on. Swap the `setQuestions(...)`
calls for these, load the feed with `listFeed()`, and optionally call
`subscribeToQuestion()` so polls and threads update live while people are looking.

## The iOS caveat (unchanged, and real)

Web Push on iPhone only fires once the user has **added Quandary to their home
screen** (iOS 16.4+). In a normal Safari tab, `enablePush()` no-ops. That's why
onboarding walks people through the install step before offering notifications —
`push.js` exposes `isStandalone()` so you can gate the prompt accordingly.

## Notes / next decisions

- **Hot ranking** is computed client-side in `listFeed()` for now. Once volume
  grows, move it into a SQL view or a periodically-refreshed materialized view.
- **Question of the Day** reads from `daily_question`; schedule a small cron
  (Supabase Scheduled Functions) to pick tomorrow's row however you like —
  highest-rated in 24h, hand-picked, etc.
- At scale, fan-out in `send-push` should move from a synchronous loop to a
  queue. Fine as-is for a soft launch to your dinner crowd.
