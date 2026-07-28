-- ============================================================================
--  0018 — content seeding pipeline
--
--  Gives you a reusable "question bank": a staging table you can bulk-load
--  with pre-written questions, plus a publisher that turns them into real
--  questions either immediately (initial fill) or on a slow drip (so the feed
--  keeps getting fresh content without you doing anything).
--
--  Nothing publishes automatically until you run Part B / schedule the cron in
--  the guide — loading the bank is completely safe on its own.
--
--  Placeholder in the cron block at the bottom only:
--    PASTE_SEED_AUTHOR_UUID   — the profile id that should appear as the
--                               author of seeded questions
-- ============================================================================

-- ---------- the bank ----------
create table if not exists public.seed_questions (
  id            bigint generated always as identity primary key,
  flair         text not null,
  format        text not null default 'pollfree',   -- poll | free | pollfree
  title         text not null,
  body          text default '',
  options       jsonb not null default '[]'::jsonb, -- array of option labels
  sort_order    int  not null default 0,
  status        text not null default 'pending',    -- pending | published
  published_at  timestamptz,
  question_id   uuid references public.questions (id) on delete set null,
  created_at    timestamptz not null default now()
);

-- Service/dashboard only — this is your private content pipeline, never
-- exposed to the app or to anonymous visitors.
alter table public.seed_questions enable row level security;

create index if not exists seed_questions_pending_idx
  on public.seed_questions (status, sort_order, id);

-- Stops the same question being loaded into the bank twice if you re-run a
-- batch file by accident.
create unique index if not exists seed_questions_title_idx
  on public.seed_questions (lower(title));

-- ---------- the publisher ----------
--  n            how many pending questions to publish this run
--  author       profile id to post them as
--  spread_days  0 = post them all with "now" timestamps.
--               >0 = spread the timestamps backwards over that many days, so
--               an initial fill looks like a feed that grew naturally instead
--               of 20 questions posted in the same second. (Your call — see
--               the note in the guide.)
create or replace function public.publish_seed_questions(
  n int,
  author uuid,
  spread_days int default 0
)
returns table (published int, remaining int)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec        record;
  new_id     uuid;
  opt        jsonb;
  idx        int;
  made       int := 0;
  stamp      timestamptz;
begin
  if author is null then
    raise exception 'publish_seed_questions: author cannot be null';
  end if;
  if not exists (select 1 from public.profiles where id = author) then
    raise exception 'publish_seed_questions: no profile with id %', author;
  end if;

  for rec in
    select * from public.seed_questions
    where status = 'pending'
    order by sort_order, id
    limit greatest(n, 0)
  loop
    -- Timestamp: either now, or a point spread back over spread_days.
    if spread_days > 0 then
      stamp := now()
             - (random() * spread_days || ' days')::interval
             - (random() * 12 || ' hours')::interval;
    else
      stamp := now();
    end if;

    insert into public.questions
      (author_id, flair, format, title, body, anonymous, anonymous_replies, created_at)
    values
      (author, rec.flair, rec.format, rec.title, coalesce(rec.body, ''), false, false, stamp)
    returning id into new_id;

    -- Options (poll / pollfree). `question_options` stores the wording in
    -- `label` — not `text`.
    idx := 0;
    for opt in select * from jsonb_array_elements(rec.options)
    loop
      insert into public.question_options (question_id, label, "position")
      values (new_id, opt #>> '{}', idx);
      idx := idx + 1;
    end loop;

    update public.seed_questions
      set status = 'published', published_at = now(), question_id = new_id
      where id = rec.id;

    made := made + 1;
  end loop;

  return query
    select made,
           (select count(*)::int from public.seed_questions where status = 'pending');
end;
$$;

revoke all on function public.publish_seed_questions(int, uuid, int) from public, anon, authenticated;
grant execute on function public.publish_seed_questions(int, uuid, int) to service_role;

-- ---------- handy view: what's left in the bank ----------
create or replace view public.seed_status as
  select status, count(*) as questions
  from public.seed_questions
  group by status;

-- Supabase grants API roles access to new objects in `public` by default.
-- seed_questions itself is protected by RLS (enabled, no policies = no rows),
-- but a view bypasses that, so revoke it explicitly. This pipeline is yours
-- alone — it should never be reachable from the app or the public API.
revoke all on public.seed_status from anon, authenticated;
revoke all on public.seed_questions from anon, authenticated;

-- ---------- the daily drip (edit the placeholder, then run) ----------
-- Publishes 2 questions a day at 14:00 UTC. Once the bank runs dry it simply
-- does nothing, harmlessly, until you load another batch.
select cron.unschedule('seed-drip')
  where exists (select 1 from cron.job where jobname = 'seed-drip');

select cron.schedule(
  'seed-drip',
  '0 14 * * *',
  $CRON$
  select public.publish_seed_questions(2, 'PASTE_SEED_AUTHOR_UUID'::uuid, 0);
  $CRON$
);
