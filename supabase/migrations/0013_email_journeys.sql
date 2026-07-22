-- ============================================================================
--  0013 — email journeys: infrastructure + activation nudge
--  Run in Supabase → SQL Editor AFTER filling the placeholders near the bottom.
--
--  Placeholders (cron schedule block only):
--    PASTE_YOUR_ANON_KEY_HERE   — your anon public key (as before)
--    PASTE_CRON_SECRET_HERE     — the CRON_SECRET you set on the function
--
--  This sets up:
--   • email_log         — records which journey emails each user has had
--                         (prevents duplicates; foundation for all journeys)
--   • profiles.email_opt_out — the unsubscribe flag
--   • get_activation_candidates() — new signups gone quiet, not yet emailed
--   • a pg_cron job that pokes the send-activation-emails function every 6h
-- ============================================================================

-- Who has received which journey email (one row per user per email type).
create table if not exists public.email_log (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  email_type text not null,
  sent_at    timestamptz not null default now(),
  primary key (user_id, email_type)
);
alter table public.email_log enable row level security;   -- service role only

-- Unsubscribe flag.
alter table public.profiles
  add column if not exists email_opt_out boolean not null default false;

-- Candidates for the activation nudge: confirmed email, signed up 24–72h ago,
-- not opted out, never emailed this type, and no questions AND no votes yet.
create or replace function public.get_activation_candidates()
returns table (user_id uuid, email text)
language sql
security definer
set search_path = public
as $$
  select u.id, u.email
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.email_confirmed_at is not null
    and u.created_at < now() - interval '24 hours'
    and u.created_at > now() - interval '72 hours'
    and coalesce(p.email_opt_out, false) = false
    and not exists (select 1 from public.email_log e
                    where e.user_id = u.id and e.email_type = 'activation')
    and not exists (select 1 from public.questions q where q.author_id = u.id)
    and not exists (select 1 from public.votes v where v.voter_id = u.id);
$$;

-- Only the server (service role) may run this — it exposes email addresses.
revoke all on function public.get_activation_candidates() from public, anon, authenticated;
grant execute on function public.get_activation_candidates() to service_role;

-- A couple of sample questions to feature in the email (server-side helper).
create or replace function public.sample_questions(n int)
returns table (id uuid, title text, flair text)
language sql
security definer
set search_path = public
as $$
  select id, title, flair from public.questions
  where hidden = false order by random() limit n;
$$;
revoke all on function public.sample_questions(int) from public, anon, authenticated;
grant execute on function public.sample_questions(int) to service_role;

-- ---------- schedule: poke the function every 6 hours ----------
create extension if not exists pg_cron;

-- Remove any previous version of this job, then (re)create it.
select cron.unschedule('activation-emails')
  where exists (select 1 from cron.job where jobname = 'activation-emails');

select cron.schedule(
  'activation-emails',
  '0 */6 * * *',
  $CRON$
  select net.http_post(
    url     := 'https://gyotdxrgcqbemefelnga.supabase.co/functions/v1/send-activation-emails',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer PASTE_YOUR_ANON_KEY_HERE',
                 'x-cron-secret', 'PASTE_CRON_SECRET_HERE'
               ),
    body    := '{}'::jsonb
  );
  $CRON$
);
