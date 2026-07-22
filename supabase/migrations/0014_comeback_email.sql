-- ============================================================================
--  0014 — email journey #2: the comeback email
--  Run in Supabase → SQL Editor AFTER filling the placeholders near the bottom.
--
--  Placeholders (cron block only):
--    PASTE_YOUR_ANON_KEY_HERE   — your anon public key (as before)
--    PASTE_CRON_SECRET_HERE     — the same CRON_SECRET you already set
--
--  What this does:
--   • Lets email_log hold repeat sends (comeback can fire again months later,
--     unlike the one-shot activation email)
--   • get_comeback_candidates() — people who WERE active, then went quiet for
--     7+ days, plus whether anyone replied to their questions while away
--   • recent_questions() — the "here's what you've missed" content
--   • a daily pg_cron job that pokes the send-comeback-emails function
-- ============================================================================

-- ---------- allow repeat sends per email type ----------
-- (activation stays strictly one-per-person via the partial index below)
alter table public.email_log drop constraint if exists email_log_pkey;
alter table public.email_log
  add column if not exists id bigint generated always as identity;

do $$ begin
  alter table public.email_log add primary key (id);
exception when invalid_table_definition then null; end $$;

create unique index if not exists email_log_once_idx
  on public.email_log (user_id, email_type)
  where email_type in ('activation');

create index if not exists email_log_lookup_idx
  on public.email_log (user_id, email_type, sent_at desc);

-- ---------- who deserves a comeback nudge ----------
-- Was genuinely active at some point, last did ANYTHING 7–45 days ago
-- (we don't chase people who left months ago), hasn't had this email in 30
-- days, confirmed their address, and hasn't opted out.
create or replace function public.get_comeback_candidates()
returns table (
  user_id uuid,
  email text,
  last_active timestamptz,
  replies_while_away int,
  reply_question_title text
)
language sql
security definer
set search_path = public
as $$
  with activity as (
    select p.id as uid,
           greatest(
             coalesce((select max(created_at) from public.questions where author_id = p.id), 'epoch'::timestamptz),
             coalesce((select max(created_at) from public.votes     where voter_id  = p.id), 'epoch'::timestamptz),
             coalesce((select max(created_at) from public.replies   where author_id = p.id), 'epoch'::timestamptz)
           ) as last_act
    from public.profiles p
  )
  select
    u.id,
    u.email,
    a.last_act,
    (select count(*)::int
       from public.replies r
       join public.questions q on q.id = r.question_id
      where q.author_id = u.id
        and r.created_at > a.last_act
        and r.author_id is distinct from u.id) as replies_while_away,
    (select q.title
       from public.replies r
       join public.questions q on q.id = r.question_id
      where q.author_id = u.id
        and r.created_at > a.last_act
        and r.author_id is distinct from u.id
      order by r.created_at desc
      limit 1) as reply_question_title
  from auth.users u
  join public.profiles p on p.id = u.id
  join activity a on a.uid = u.id
  where u.email_confirmed_at is not null
    and coalesce(p.email_opt_out, false) = false
    and a.last_act < now() - interval '7 days'
    and a.last_act > now() - interval '45 days'
    and not exists (
      select 1 from public.email_log e
      where e.user_id = u.id
        and e.email_type = 'comeback'
        and e.sent_at > now() - interval '30 days'
    );
$$;

revoke all on function public.get_comeback_candidates() from public, anon, authenticated;
grant execute on function public.get_comeback_candidates() to service_role;

-- ---------- content for the "what you've missed" section ----------
create or replace function public.recent_questions(n int)
returns table (id uuid, title text, flair text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select id, title, flair, created_at
  from public.questions
  where hidden = false
  order by created_at desc
  limit n;
$$;

revoke all on function public.recent_questions(int) from public, anon, authenticated;
grant execute on function public.recent_questions(int) to service_role;

-- ---------- schedule: once a day ----------
select cron.unschedule('comeback-emails')
  where exists (select 1 from cron.job where jobname = 'comeback-emails');

select cron.schedule(
  'comeback-emails',
  '0 16 * * *',
  $CRON$
  select net.http_post(
    url     := 'https://gyotdxrgcqbemefelnga.supabase.co/functions/v1/send-comeback-emails',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer PASTE_YOUR_ANON_KEY_HERE',
                 'x-cron-secret', 'PASTE_CRON_SECRET_HERE'
               ),
    body    := '{}'::jsonb
  );
  $CRON$
);
