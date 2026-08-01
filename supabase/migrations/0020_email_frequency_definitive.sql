-- ============================================================================
--  0020 — definitive email frequency rules
--
--  Replaces the partial guard from 0019. That version had a real gap: it only
--  named some email types explicitly, and anything unmatched fell through to a
--  20-hour rule — which for a daily cron job means "may send again tomorrow".
--
--  This version:
--   • Defines the rule for EVERY email type in one visible table.
--   • Defaults unknown types to "once ever" instead of 20 hours, so a future
--     journey cannot spam anyone just because someone forgot to add a rule.
--   • Adds a hard database uniqueness constraint for once-ever emails, so even
--     a broken trigger cannot allow a duplicate.
--
--  Safe to re-run. No placeholders.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  1) Clean up any duplicate rows first, so the unique index below can build.
--     Keeps the earliest send of each once-ever email and drops the rest.
-- ---------------------------------------------------------------------------
delete from public.email_log a
using public.email_log b
where a.user_id = b.user_id
  and a.email_type = b.email_type
  and a.sent_at > b.sent_at
  and a.email_type <> 'comeback'
  and a.email_type not like 'digest:%';

-- ---------------------------------------------------------------------------
--  2) Hard constraint: once-ever emails can only ever have one row per person.
--     'comeback' (repeatable every 60 days) and weekly 'digest:YYYY-WW'
--     (already unique per week by name) are excluded.
-- ---------------------------------------------------------------------------
drop index if exists email_log_once_idx;
create unique index if not exists email_log_once_ever_idx
  on public.email_log (user_id, email_type)
  where email_type <> 'comeback' and email_type not like 'digest:%';

-- ---------------------------------------------------------------------------
--  3) The frequency rule for every email type, in one place.
-- ---------------------------------------------------------------------------
create or replace function public.email_min_gap(etype text)
returns interval
language sql
immutable
as $$
  select case
    -- Repeatable, on a long cooldown
    when etype = 'comeback'          then interval '60 days'
    -- Weekly, but the type string already contains the week (digest:2026-31),
    -- so this only stops an accidental double-send inside the same week.
    when etype like 'digest:%'       then interval '20 hours'
    -- Once ever
    when etype = 'activation'        then interval '100 years'
    when etype like 'welcome_%'      then interval '100 years'
    when etype = 'milestone_month'   then interval '100 years'
    when etype like 'milestone_q:%'  then interval '100 years'
    -- Anything not listed above is treated as once ever. A future journey that
    -- forgets to add a rule here will under-send, never over-send.
    else interval '100 years'
  end;
$$;

-- ---------------------------------------------------------------------------
--  4) The guard trigger, now using that table.
-- ---------------------------------------------------------------------------
create or replace function public.guard_email_frequency()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  min_gap   interval := public.email_min_gap(new.email_type);
  last_sent timestamptz;
  fatigue   timestamptz;
begin
  -- (a) Per-type frequency rule.
  select max(sent_at) into last_sent
  from public.email_log
  where user_id = new.user_id and email_type = new.email_type;

  if last_sent is not null and last_sent > now() - min_gap then
    raise exception
      'Refusing % for %: last sent %, minimum gap %',
      new.email_type, new.user_id, last_sent, min_gap
      using errcode = 'check_violation';
  end if;

  -- (b) Global fatigue guard: never two marketing emails within 20 hours,
  --     whatever their types. This is the backstop that means a mistake in a
  --     single journey can still only ever cost someone one extra email.
  select max(sent_at) into fatigue
  from public.email_log
  where user_id = new.user_id;

  if fatigue is not null and fatigue > now() - interval '20 hours' then
    raise exception
      'Refusing % for %: another email was sent at % (20h fatigue guard)',
      new.email_type, new.user_id, fatigue
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
--  5) Anniversary candidates: tighten the window.
--     It previously matched anyone whose account was 30–37 days old, so a
--     failure to record the send meant up to 7 daily emails. Now it is a
--     single day, which caps the damage of any future fault at one email.
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
    and u.created_at > now() - interval '31 days'
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

create index if not exists email_log_user_sent_idx
  on public.email_log (user_id, sent_at desc);
