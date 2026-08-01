-- ============================================================================
--  0019 — email frequency fix
--
--  Fixes the "same comeback email every day" bug, and makes over-sending
--  structurally impossible rather than relying on application code getting it
--  right.
--
--  Three changes:
--   1. Comeback cooldown goes from 30 days to 60.
--   2. Comeback gains the 20-hour global fatigue guard that journeys 3/4/5
--      already had and it was missing — a second line of defence.
--   3. A database trigger that refuses to record an email that is being sent
--      too soon. Because the edge function now logs BEFORE sending, a refused
--      log means the email is never sent at all. This holds even if the
--      application logic is wrong.
--
--  No placeholders. Safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  1 + 2) Comeback candidates: 60-day cooldown + global fatigue guard
-- ---------------------------------------------------------------------------
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
    -- Cooldown: at most one comeback email per 60 days.
    and not exists (
      select 1 from public.email_log e
      where e.user_id = u.id
        and e.email_type = 'comeback'
        and e.sent_at > now() - interval '60 days'
    )
    -- Global fatigue guard: never two marketing emails within 20 hours.
    and not exists (
      select 1 from public.email_log e2
      where e2.user_id = u.id
        and e2.sent_at > now() - interval '20 hours'
    );
$$;

revoke all on function public.get_comeback_candidates() from public, anon, authenticated;
grant execute on function public.get_comeback_candidates() to service_role;

-- ---------------------------------------------------------------------------
--  3) The hard stop: refuse to log an email that's being sent too soon.
--
--  This is the important one. Every previous safeguard lived in application
--  code or a query that the application had to remember to respect. This lives
--  in the database and cannot be bypassed by a bug upstream.
-- ---------------------------------------------------------------------------
create or replace function public.guard_email_frequency()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  min_gap interval;
  last_sent timestamptz;
begin
  min_gap := case
               when new.email_type = 'comeback'   then interval '60 days'
               when new.email_type = 'activation' then interval '100 years'
               when new.email_type like 'welcome_%' then interval '100 years'
               when new.email_type like 'milestone_%' then interval '100 years'
               else interval '20 hours'
             end;

  select max(sent_at) into last_sent
  from public.email_log
  where user_id = new.user_id and email_type = new.email_type;

  if last_sent is not null and last_sent > now() - min_gap then
    raise exception
      'Refusing to re-send % to % — last sent %, minimum gap is %',
      new.email_type, new.user_id, last_sent, min_gap
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_email_frequency on public.email_log;
create trigger trg_guard_email_frequency
  before insert on public.email_log
  for each row execute function public.guard_email_frequency();

-- ---------------------------------------------------------------------------
--  Helpful index for the lookups above
-- ---------------------------------------------------------------------------
create index if not exists email_log_user_type_sent_idx
  on public.email_log (user_id, email_type, sent_at desc);
