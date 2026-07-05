-- ============================================================================
--  QUANDARY — initial schema
--  Run with the Supabase CLI:  supabase db push
--  (or paste into the SQL editor in the Supabase dashboard)
-- ============================================================================

-- Postgres has gen_random_uuid() built in on Supabase; ensure pgcrypto anyway.
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
--  PROFILES  (1:1 with auth.users)
-- ----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  handle      text unique not null,
  name        text not null,
  color       text not null default '#6C4DFF',
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
--  QUESTIONS
-- ----------------------------------------------------------------------------
create table public.questions (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.profiles (id) on delete cascade,
  flair       text not null,                       -- 'wyr' | 'tot' | 'hot' | ...
  format      text not null check (format in ('poll','free','pollfree')),
  title       text not null check (char_length(title) between 5 and 140),
  body        text not null default '',
  anonymous   boolean not null default false,      -- hide who voted for what
  report_count integer not null default 0,
  hidden      boolean not null default false,      -- auto-set once reports cross threshold
  created_at  timestamptz not null default now()
);
create index on public.questions (created_at desc);
create index on public.questions (flair);
create index on public.questions (author_id);

-- ----------------------------------------------------------------------------
--  POLL OPTIONS
-- ----------------------------------------------------------------------------
create table public.question_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  label       text not null,
  position    integer not null default 0
);
create index on public.question_options (question_id);

-- ----------------------------------------------------------------------------
--  VOTES  (one per voter per question)
-- ----------------------------------------------------------------------------
create table public.votes (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  option_id   uuid not null references public.question_options (id) on delete cascade,
  voter_id    uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (question_id, voter_id)
);
create index on public.votes (question_id);

-- ----------------------------------------------------------------------------
--  REPLIES  (the free-form thread)
-- ----------------------------------------------------------------------------
create table public.replies (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  author_id   uuid not null references public.profiles (id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index on public.replies (question_id, created_at);

-- ----------------------------------------------------------------------------
--  CLARIFICATIONS  (a non-author asks; only the author may answer)
--  The asker-answer relationship lives in one row.
-- ----------------------------------------------------------------------------
create table public.clarifications (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  asker_id    uuid not null references public.profiles (id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 500),
  answer_body text,
  answered_at timestamptz,
  created_at  timestamptz not null default now()
);
create index on public.clarifications (question_id, created_at);

-- ----------------------------------------------------------------------------
--  RATINGS  (1..5 stars, one per rater per question)
-- ----------------------------------------------------------------------------
create table public.ratings (
  question_id uuid not null references public.questions (id) on delete cascade,
  rater_id    uuid not null references public.profiles (id) on delete cascade,
  stars       smallint not null check (stars between 1 and 5),
  created_at  timestamptz not null default now(),
  primary key (question_id, rater_id)
);

-- ----------------------------------------------------------------------------
--  FOLLOWS / SAVES
-- ----------------------------------------------------------------------------
create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create table public.saves (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, question_id)
);

-- ----------------------------------------------------------------------------
--  REPORTS  (report-based moderation)
-- ----------------------------------------------------------------------------
create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason      text,
  created_at  timestamptz not null default now(),
  unique (question_id, reporter_id)
);

-- ----------------------------------------------------------------------------
--  NOTIFICATION PREFERENCES  (powers push targeting)
-- ----------------------------------------------------------------------------
create table public.notification_prefs (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  every_question boolean not null default false,   -- "All, so I don't miss a thing"
  followed_only  boolean not null default true,
  categories     text[] not null default '{}',     -- flair keys to be pinged for
  updated_at     timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
--  PUSH SUBSCRIPTIONS  (Web Push endpoints, one row per device)
-- ----------------------------------------------------------------------------
create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index on public.push_subscriptions (user_id);

-- ----------------------------------------------------------------------------
--  IN-APP NOTIFICATIONS  (the Alerts activity feed)
-- ----------------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,  -- recipient
  actor_id    uuid not null references public.profiles (id) on delete cascade,
  type        text not null check (type in ('vote','reply','clarif','rate','follow')),
  question_id uuid references public.questions (id) on delete cascade,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

-- ----------------------------------------------------------------------------
--  QUESTION OF THE DAY
-- ----------------------------------------------------------------------------
create table public.daily_question (
  for_date    date primary key default current_date,
  question_id uuid not null references public.questions (id) on delete cascade
);

-- ============================================================================
--  VIEWS  — enforce anonymity server-side
--  Direct SELECT on votes is revoked below; clients read this view instead.
--  voter_id is nulled out for anonymous questions, so the "who voted" list is
--  impossible to reconstruct even with a crafted query.
-- ============================================================================
create view public.vote_details
with (security_invoker = true) as
  select v.id, v.question_id, v.option_id, v.created_at,
         case when q.anonymous then null else v.voter_id end as voter_id
  from public.votes v
  join public.questions q on q.id = v.question_id;

-- ============================================================================
--  TRIGGERS & FUNCTIONS
-- ============================================================================

-- New auth user -> create profile + default prefs.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, handle, name)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'handle', split_part(new.email,'@',1)),
          coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)));
  insert into public.notification_prefs (user_id) values (new.id);
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Clarification guard: only the question's author may write an answer, and the
-- asker / body can never be altered after creation.
create or replace function public.guard_clarification_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare q_author uuid;
begin
  select author_id into q_author from public.questions where id = new.question_id;
  if auth.uid() <> q_author then
    raise exception 'Only the question author can answer clarifications';
  end if;
  new.asker_id   := old.asker_id;
  new.body       := old.body;
  new.created_at := old.created_at;
  if new.answer_body is distinct from old.answer_body then
    new.answered_at := now();
  end if;
  return new;
end; $$;

create trigger trg_guard_clarification
  before update on public.clarifications
  for each row execute function public.guard_clarification_update();

-- Reports: bump counter, auto-hide past a threshold (tune to taste).
create or replace function public.handle_report()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.questions
     set report_count = report_count + 1,
         hidden = (report_count + 1) >= 5
   where id = new.question_id;
  return new;
end; $$;

create trigger trg_handle_report
  after insert on public.reports
  for each row execute function public.handle_report();

-- In-app notifications for the author when someone engages.
create or replace function public.notify_author()
returns trigger language plpgsql security definer set search_path = public as $$
declare recipient uuid; actor uuid; ntype text; qid uuid;
begin
  if tg_table_name = 'votes' then
    actor := new.voter_id; qid := new.question_id; ntype := 'vote';
    select author_id into recipient from public.questions where id = qid;
  elsif tg_table_name = 'replies' then
    actor := new.author_id; qid := new.question_id; ntype := 'reply';
    select author_id into recipient from public.questions where id = qid;
  elsif tg_table_name = 'clarifications' then
    actor := new.asker_id; qid := new.question_id; ntype := 'clarif';
    select author_id into recipient from public.questions where id = qid;
  elsif tg_table_name = 'ratings' then
    actor := new.rater_id; qid := new.question_id; ntype := 'rate';
    select author_id into recipient from public.questions where id = qid;
  elsif tg_table_name = 'follows' then
    actor := new.follower_id; recipient := new.followee_id; ntype := 'follow';
  end if;

  if recipient is not null and recipient <> actor then
    insert into public.notifications (user_id, actor_id, type, question_id)
    values (recipient, actor, ntype, qid);
  end if;
  return new;
end; $$;

create trigger trg_notify_vote   after insert on public.votes          for each row execute function public.notify_author();
create trigger trg_notify_reply  after insert on public.replies        for each row execute function public.notify_author();
create trigger trg_notify_clarif after insert on public.clarifications  for each row execute function public.notify_author();
create trigger trg_notify_rate   after insert on public.ratings        for each row execute function public.notify_author();
create trigger trg_notify_follow after insert on public.follows        for each row execute function public.notify_author();

-- ============================================================================
--  ROW LEVEL SECURITY
-- ============================================================================
alter table public.profiles            enable row level security;
alter table public.questions           enable row level security;
alter table public.question_options    enable row level security;
alter table public.votes               enable row level security;
alter table public.replies             enable row level security;
alter table public.clarifications      enable row level security;
alter table public.ratings             enable row level security;
alter table public.follows             enable row level security;
alter table public.saves               enable row level security;
alter table public.reports             enable row level security;
alter table public.notification_prefs  enable row level security;
alter table public.push_subscriptions  enable row level security;
alter table public.notifications       enable row level security;
alter table public.daily_question      enable row level security;

-- profiles: world-readable, you edit only yourself
create policy "profiles readable"   on public.profiles for select using (true);
create policy "profiles self insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles self update" on public.profiles for update using (auth.uid() = id);

-- questions: visible unless hidden; author manages own
create policy "questions readable" on public.questions for select using (not hidden or author_id = auth.uid());
create policy "questions insert"   on public.questions for insert with check (auth.uid() = author_id);
create policy "questions update"   on public.questions for update using (auth.uid() = author_id);
create policy "questions delete"   on public.questions for delete using (auth.uid() = author_id);

-- options: readable by all; writable only by the question's author
create policy "options readable" on public.question_options for select using (true);
create policy "options insert" on public.question_options for insert
  with check (exists (select 1 from public.questions q where q.id = question_id and q.author_id = auth.uid()));

-- votes: insert your own; reads happen through vote_details view (select revoked below)
create policy "votes insert" on public.votes for insert with check (auth.uid() = voter_id);

-- replies: readable by all; you author your own
create policy "replies readable" on public.replies for select using (true);
create policy "replies insert"   on public.replies for insert with check (auth.uid() = author_id);

-- clarifications: readable by all; anyone (non-author) may ask; author answers via the guard trigger
create policy "clarif readable" on public.clarifications for select using (true);
create policy "clarif ask" on public.clarifications for insert
  with check (auth.uid() = asker_id
              and auth.uid() <> (select author_id from public.questions where id = question_id));
create policy "clarif answer" on public.clarifications for update
  using (auth.uid() = (select author_id from public.questions where id = question_id));

-- ratings: readable by all; upsert your own
create policy "ratings readable" on public.ratings for select using (true);
create policy "ratings upsert"   on public.ratings for insert with check (auth.uid() = rater_id);
create policy "ratings update"   on public.ratings for update using (auth.uid() = rater_id);

-- follows: readable by all; you control your own edges
create policy "follows readable" on public.follows for select using (true);
create policy "follows insert"   on public.follows for insert with check (auth.uid() = follower_id);
create policy "follows delete"   on public.follows for delete using (auth.uid() = follower_id);

-- saves: private to you
create policy "saves own" on public.saves for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- reports: you file your own; reads reserved for service role / admins
create policy "reports insert" on public.reports for insert with check (auth.uid() = reporter_id);

-- notification_prefs: private to you
create policy "prefs own" on public.notification_prefs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- push_subscriptions: private to you
create policy "push own" on public.push_subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- notifications: you read/update only your own
create policy "notif readable" on public.notifications for select using (auth.uid() = user_id);
create policy "notif update"   on public.notifications for update using (auth.uid() = user_id);

-- daily_question: world-readable
create policy "qotd readable" on public.daily_question for select using (true);

-- Lock down direct vote reads; route through the anonymity-preserving view.
revoke select on public.votes from anon, authenticated;
grant  select on public.vote_details to anon, authenticated;
