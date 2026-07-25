-- ============================================================================
--  0017 — engagement batch: notification toggles, smarter QOTD, streak stats
--  Run in Supabase → SQL Editor → New query → paste → Run (once). No
--  placeholders this time.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  (3) Reply / clarification notification toggles
--  Default TRUE so existing users keep getting exactly what they get today —
--  nothing changes for anyone until they actively switch one off.
-- ---------------------------------------------------------------------------
alter table public.notification_prefs
  add column if not exists notify_replies boolean not null default true,
  add column if not exists notify_clarifs boolean not null default true;

-- ---------------------------------------------------------------------------
--  (2) Question of the Day — was a random pick; now prefers the best-engaged
--  eligible question (votes + weighted replies), never repeats a past QOTD,
--  and falls back to random once everything's been featured.
-- ---------------------------------------------------------------------------
create or replace function public.get_qotd()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare qid uuid;
begin
  select question_id into qid from daily_question where for_date = current_date;
  if qid is not null then
    return qid;
  end if;

  -- Best pick: not hidden, not already featured before, ranked by engagement
  -- (each reply counts double a vote — a reply is a stronger signal).
  select q.id into qid
  from public.questions q
  where q.hidden = false
    and not exists (select 1 from public.daily_question d where d.question_id = q.id)
  order by
    (select count(*) from public.votes v where v.question_id = q.id)
    + (select count(*) from public.replies r where r.question_id = q.id) * 2 desc,
    q.created_at desc
  limit 1;

  -- Fallback: everything not-hidden has already been featured — pick randomly
  -- so the day always has a hero.
  if qid is null then
    select id into qid from public.questions where hidden = false order by random() limit 1;
  end if;

  if qid is not null then
    insert into public.daily_question (for_date, question_id) values (current_date, qid)
      on conflict (for_date) do nothing;
    select question_id into qid from public.daily_question where for_date = current_date;
  end if;

  return qid;
end;
$$;

-- ---------------------------------------------------------------------------
--  (1) Streak + weekly recap stats for the You tab.
--  "Activity" = voting, asking, or replying. Streak counts consecutive days
--  up to and including today OR yesterday (so it doesn't reset to 0 the
--  moment you wake up before you've done anything today yet).
-- ---------------------------------------------------------------------------
create or replace function public.get_streak_stats(uid uuid)
returns table (
  current_streak int,
  week_votes int,
  week_questions int,
  week_replies int,
  week_total int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  streak int := 0;
  last_active date;
  expected date;
  d date;
begin
  select max(activity_date) into last_active from (
    select date(created_at) as activity_date from public.votes where voter_id = uid
    union all
    select date(created_at) from public.questions where author_id = uid
    union all
    select date(created_at) from public.replies where author_id = uid
  ) t;

  if last_active is not null and last_active >= current_date - 1 then
    expected := last_active;
    for d in
      select distinct activity_date from (
        select date(created_at) as activity_date from public.votes where voter_id = uid
        union
        select date(created_at) from public.questions where author_id = uid
        union
        select date(created_at) from public.replies where author_id = uid
      ) t
      order by activity_date desc
    loop
      if d = expected then
        streak := streak + 1;
        expected := expected - 1;
      else
        exit;
      end if;
    end loop;
  end if;

  return query select
    streak,
    (select count(*)::int from public.votes where voter_id = uid and created_at > now() - interval '7 days'),
    (select count(*)::int from public.questions where author_id = uid and created_at > now() - interval '7 days'),
    (select count(*)::int from public.replies where author_id = uid and created_at > now() - interval '7 days'),
    (select count(*)::int from public.votes where voter_id = uid and created_at > now() - interval '7 days')
      + (select count(*)::int from public.questions where author_id = uid and created_at > now() - interval '7 days')
      + (select count(*)::int from public.replies where author_id = uid and created_at > now() - interval '7 days');
end;
$$;

revoke all on function public.get_streak_stats(uuid) from public, anon;
grant execute on function public.get_streak_stats(uuid) to authenticated;
