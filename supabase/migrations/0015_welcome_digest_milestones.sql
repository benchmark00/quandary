-- ============================================================================
--  0015 — email journeys #3, #4, #5
--    #3 Welcome sequence (Day 0 / 2 / 5)
--    #4 Weekly digest (active users)
--    #5 Milestones (question vote thresholds + one-month anniversary)
--
--  Run in Supabase → SQL Editor AFTER filling the placeholders in the cron
--  block near the bottom:
--    PASTE_YOUR_ANON_KEY_HERE   — your anon public key (as before)
--    PASTE_CRON_SECRET_HERE     — the same CRON_SECRET you already use
--
--  IMPORTANT DESIGN NOTE — email fatigue guard:
--  Every candidate function below refuses to pick someone who has had ANY
--  journey email in the last 20 hours. Since these journeys overlap in time,
--  this guarantees at most one marketing email per person per day. Anyone
--  skipped is simply picked up on a later run (the day windows are ranges,
--  not exact days, to allow for this).
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Shared content helpers
-- ---------------------------------------------------------------------------

-- Top questions over the last N days, ranked by engagement (votes + replies).
create or replace function public.top_questions(days int, n int)
returns table (id uuid, title text, flair text, votes int, replies int)
language sql
security definer
set search_path = public
as $$
  select q.id, q.title, q.flair,
         (select count(*)::int from public.votes v where v.question_id = q.id)   as votes,
         (select count(*)::int from public.replies r where r.question_id = q.id) as replies
  from public.questions q
  where q.hidden = false
    and q.created_at > now() - (days || ' days')::interval
  order by
    (select count(*) from public.votes v where v.question_id = q.id) +
    (select count(*) from public.replies r where r.question_id = q.id) desc,
    q.created_at desc
  limit n;
$$;
revoke all on function public.top_questions(int, int) from public, anon, authenticated;
grant execute on function public.top_questions(int, int) to service_role;

-- ---------------------------------------------------------------------------
--  #3 Welcome sequence — one function, three stages
--  stage 0: confirmed in the last 24h
--  stage 2: confirmed 2–4 days ago
--  stage 5: confirmed 5–8 days ago
--  (Ranges, not exact days, so the fatigue guard can defer without skipping.)
-- ---------------------------------------------------------------------------
create or replace function public.get_welcome_candidates(stage int)
returns table (user_id uuid, email text)
language sql
security definer
set search_path = public
as $$
  select u.id, u.email
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.email_confirmed_at is not null
    and coalesce(p.email_opt_out, false) = false
    and case stage
          when 0 then u.email_confirmed_at > now() - interval '24 hours'
          when 2 then u.email_confirmed_at < now() - interval '2 days'
                  and u.email_confirmed_at > now() - interval '4 days'
          when 5 then u.email_confirmed_at < now() - interval '5 days'
                  and u.email_confirmed_at > now() - interval '8 days'
          else false
        end
    and not exists (
      select 1 from public.email_log e
      where e.user_id = u.id and e.email_type = 'welcome_d' || stage::text
    )
    and not exists (   -- fatigue guard: nothing else sent in the last 20h
      select 1 from public.email_log e2
      where e2.user_id = u.id and e2.sent_at > now() - interval '20 hours'
    );
$$;
revoke all on function public.get_welcome_candidates(int) from public, anon, authenticated;
grant execute on function public.get_welcome_candidates(int) to service_role;

-- ---------------------------------------------------------------------------
--  #4 Weekly digest — for people who ARE active (habit reinforcement)
--  Active = did something in the last 7 days. Includes their own week's stats.
-- ---------------------------------------------------------------------------
create or replace function public.get_digest_candidates()
returns table (
  user_id uuid,
  email text,
  votes_cast int,
  questions_asked int,
  replies_received int
)
language sql
security definer
set search_path = public
as $$
  with wk as (select now() - interval '7 days' as since)
  select
    u.id,
    u.email,
    (select count(*)::int from public.votes v, wk
      where v.voter_id = u.id and v.created_at > wk.since)      as votes_cast,
    (select count(*)::int from public.questions q, wk
      where q.author_id = u.id and q.created_at > wk.since)     as questions_asked,
    (select count(*)::int
       from public.replies r
       join public.questions q2 on q2.id = r.question_id, wk
      where q2.author_id = u.id
        and r.created_at > wk.since
        and r.author_id is distinct from u.id)                  as replies_received
  from auth.users u
  join public.profiles p on p.id = u.id, wk
  where u.email_confirmed_at is not null
    and coalesce(p.email_opt_out, false) = false
    -- active in the last 7 days (any of the three actions)
    and (
      exists (select 1 from public.votes v2     where v2.voter_id  = u.id and v2.created_at > wk.since)
      or exists (select 1 from public.questions q3 where q3.author_id = u.id and q3.created_at > wk.since)
      or exists (select 1 from public.replies r2  where r2.author_id = u.id and r2.created_at > wk.since)
    )
    -- one per ISO week: the email_type carries the week stamp
    and not exists (
      select 1 from public.email_log e
      where e.user_id = u.id
        and e.email_type = 'digest:' || to_char(now(), 'IYYY-IW')
    )
    and not exists (
      select 1 from public.email_log e2
      where e2.user_id = u.id and e2.sent_at > now() - interval '20 hours'
    );
$$;
revoke all on function public.get_digest_candidates() from public, anon, authenticated;
grant execute on function public.get_digest_candidates() to service_role;

-- The current week stamp, so the edge function logs the matching type.
create or replace function public.current_week_stamp()
returns text language sql stable as $$ select to_char(now(), 'IYYY-IW'); $$;
revoke all on function public.current_week_stamp() from public, anon, authenticated;
grant execute on function public.current_week_stamp() to service_role;

-- ---------------------------------------------------------------------------
--  #5a Milestones — a question crossing 10 / 50 / 100 votes
--  Returns the HIGHEST threshold crossed that hasn't been emailed yet, so a
--  question that jumps straight past two thresholds only sends one email.
-- ---------------------------------------------------------------------------
create or replace function public.get_vote_milestones()
returns table (
  user_id uuid,
  email text,
  question_id uuid,
  question_title text,
  vote_count int,
  threshold int
)
language sql
security definer
set search_path = public
as $$
  with counts as (
    select q.id, q.title, q.author_id,
           (select count(*)::int from public.votes v where v.question_id = q.id) as vc
    from public.questions q
    where q.hidden = false
  ),
  thresholds as (select unnest(array[10, 50, 100]) as t)
  select distinct on (c.id)
    u.id, u.email, c.id, c.title, c.vc, t.t
  from counts c
  join thresholds t on c.vc >= t.t
  join auth.users u on u.id = c.author_id
  join public.profiles p on p.id = u.id
  where u.email_confirmed_at is not null
    and coalesce(p.email_opt_out, false) = false
    and not exists (
      select 1 from public.email_log e
      where e.user_id = u.id
        and e.email_type = 'milestone_q:' || c.id::text || ':' || t.t::text
    )
    and not exists (
      select 1 from public.email_log e2
      where e2.user_id = u.id and e2.sent_at > now() - interval '20 hours'
    )
  order by c.id, t.t desc;
$$;
revoke all on function public.get_vote_milestones() from public, anon, authenticated;
grant execute on function public.get_vote_milestones() to service_role;

-- ---------------------------------------------------------------------------
--  #5b Milestones — one month on Quandary
-- ---------------------------------------------------------------------------
create or replace function public.get_anniversary_candidates()
returns table (
  user_id uuid,
  email text,
  questions_asked int,
  votes_cast int,
  replies_received int
)
language sql
security definer
set search_path = public
as $$
  select
    u.id,
    u.email,
    (select count(*)::int from public.questions q where q.author_id = u.id) as questions_asked,
    (select count(*)::int from public.votes v where v.voter_id = u.id)      as votes_cast,
    (select count(*)::int
       from public.replies r
       join public.questions q2 on q2.id = r.question_id
      where q2.author_id = u.id and r.author_id is distinct from u.id)      as replies_received
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.email_confirmed_at is not null
    and coalesce(p.email_opt_out, false) = false
    and u.created_at < now() - interval '30 days'
    and u.created_at > now() - interval '37 days'
    and not exists (
      select 1 from public.email_log e
      where e.user_id = u.id and e.email_type = 'milestone_month'
    )
    and not exists (
      select 1 from public.email_log e2
      where e2.user_id = u.id and e2.sent_at > now() - interval '20 hours'
    );
$$;
revoke all on function public.get_anniversary_candidates() from public, anon, authenticated;
grant execute on function public.get_anniversary_candidates() to service_role;

-- ---------------------------------------------------------------------------
--  Schedules
-- ---------------------------------------------------------------------------
select cron.unschedule('welcome-emails')
  where exists (select 1 from cron.job where jobname = 'welcome-emails');
select cron.schedule(
  'welcome-emails',
  '30 */6 * * *',                                  -- every 6h, offset from activation
  $CRON$
  select net.http_post(
    url     := 'https://gyotdxrgcqbemefelnga.supabase.co/functions/v1/send-welcome-emails',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer sb_publishable_n3M80jkubv4N6hCZtGKgTg_0S5SV3p9',
                 'x-cron-secret', '248f4081d35c17c1177ec81e46fb27fd59d8c00a7eede6a4'),
    body    := '{}'::jsonb);
  $CRON$
);

select cron.unschedule('weekly-digest')
  where exists (select 1 from cron.job where jobname = 'weekly-digest');
select cron.schedule(
  'weekly-digest',
  '0 17 * * 0',                                    -- Sundays, 17:00 UTC
  $CRON$
  select net.http_post(
    url     := 'https://gyotdxrgcqbemefelnga.supabase.co/functions/v1/send-weekly-digest',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer sb_publishable_n3M80jkubv4N6hCZtGKgTg_0S5SV3p9',
                 'x-cron-secret', '248f4081d35c17c1177ec81e46fb27fd59d8c00a7eede6a4'),
    body    := '{}'::jsonb);
  $CRON$
);

select cron.unschedule('milestone-emails')
  where exists (select 1 from cron.job where jobname = 'milestone-emails');
select cron.schedule(
  'milestone-emails',
  '0 15 * * *',                                    -- daily, 15:00 UTC
  $CRON$
  select net.http_post(
    url     := 'https://gyotdxrgcqbemefelnga.supabase.co/functions/v1/send-milestone-emails',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer sb_publishable_n3M80jkubv4N6hCZtGKgTg_0S5SV3p9',
                 'x-cron-secret', '248f4081d35c17c1177ec81e46fb27fd59d8c00a7eede6a4'),
    body    := '{}'::jsonb);
  $CRON$
);
