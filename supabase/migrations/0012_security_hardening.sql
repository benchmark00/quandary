-- ============================================================================
--  0012 — security hardening
--  Run in Supabase → SQL Editor AFTER filling in the two placeholders below.
--
--  Replace:
--    PASTE_YOUR_ANON_KEY_HERE     — your anon public key (as in 0004/0006)
--    PASTE_YOUR_PUSH_SECRET_HERE  — the random string you set as PUSH_SECRET
--                                    on the send-push function
--  (Both appear once, inside the push-trigger functions near the bottom.)
-- ============================================================================

-- ---------- CRITICAL-1: block self-promotion to admin ----------
-- profiles stays self-updatable, but is_admin can only change if the caller is
-- ALREADY an admin. Non-admins' attempts are silently reverted.
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Only a normal signed-in user is restricted. auth.uid() IS NULL means the
  -- call came from the dashboard / service role (already fully trusted), so
  -- you can still promote admins from the SQL editor.
  if new.is_admin is distinct from old.is_admin
     and auth.uid() is not null and not public.is_admin() then
    new.is_admin := old.is_admin;
  end if;
  new.id := old.id;              -- identity is immutable
  return new;
end; $$;

drop trigger if exists trg_guard_profile on public.profiles;
create trigger trg_guard_profile
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------- HIGH-2: authors can't un-hide / reset their own moderation ----------
-- Moderation + identity columns are admin-only. The 5-report auto-hide still
-- works because handle_report() runs as SECURITY DEFINER (bypasses this guard).
create or replace function public.guard_question_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  allowed boolean;
begin
  -- Allowed to touch moderation columns if: an admin, OR a dashboard/service
  -- call (auth.uid() null), OR the auto-report trigger (which sets this flag).
  allowed := public.is_admin()
             or auth.uid() is null
             or current_setting('quandary.mod', true) = '1';
  if not allowed then
    new.hidden       := old.hidden;
    new.report_count := old.report_count;
    new.author_id    := old.author_id;
    new.created_at   := old.created_at;
    new.flair        := old.flair;
    new.format       := old.format;
  end if;
  return new;
end; $$;

drop trigger if exists trg_guard_question on public.questions;
create trigger trg_guard_question
  before update on public.questions
  for each row execute function public.guard_question_update();

-- Redefine the auto-report handler to flag its own moderation update so the
-- guard above lets the 5-report auto-hide through. (Same logic as before,
-- plus the flag.) If your handle_report differs, keep your body and just add
-- the set_config line before the UPDATE.
create or replace function public.handle_report()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cnt int;
begin
  perform set_config('quandary.mod', '1', true);   -- authorize the update below
  select count(*) into cnt from public.reports where question_id = new.question_id;
  update public.questions
    set report_count = cnt,
        hidden = (cnt >= 5) or hidden
    where id = new.question_id;
  return new;
end; $$;

drop trigger if exists trg_handle_report on public.reports;
create trigger trg_handle_report
  after insert on public.reports
  for each row execute function public.handle_report();

-- ---------- MEDIUM-4: rate limits on content creation ----------
create or replace function public.rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  recent int;
  lim int := tg_argv[0]::int;
  col text := tg_argv[1];
begin
  execute format(
    'select count(*) from public.%I where %I = $1 and created_at > now() - interval ''1 hour''',
    tg_table_name, col
  ) into recent using auth.uid();
  if recent >= lim then
    raise exception 'Slow down a little — you have hit the hourly limit. Try again shortly.'
      using hint = 'rate_limited';
  end if;
  return new;
end; $$;

drop trigger if exists trg_rl_questions on public.questions;
create trigger trg_rl_questions before insert on public.questions
  for each row execute function public.rate_limit('10', 'author_id');

drop trigger if exists trg_rl_replies on public.replies;
create trigger trg_rl_replies before insert on public.replies
  for each row execute function public.rate_limit('60', 'author_id');

drop trigger if exists trg_rl_clarifs on public.clarifications;
create trigger trg_rl_clarifs before insert on public.clarifications
  for each row execute function public.rate_limit('30', 'asker_id');

-- ---------- MEDIUM-5: lock down the avatars bucket ----------
update storage.buckets
  set file_size_limit = 2097152,          -- 2 MB
      allowed_mime_types = array['image/jpeg','image/png','image/webp']
  where id = 'avatars';

-- ---------- MEDIUM-6: hidden questions hide their replies & votes ----------
create or replace view public.reply_details as
  select r.id, r.question_id, r.body, r.created_at,
         case when q.anonymous_replies then null else r.author_id end as author_id
  from public.replies r
  join public.questions q on q.id = r.question_id
  where not q.hidden or public.is_admin();
grant select on public.reply_details to anon, authenticated;

create or replace view public.vote_details as
  select v.id, v.question_id, v.option_id, v.created_at,
         case when q.anonymous then null else v.voter_id end as voter_id
  from public.votes v
  join public.questions q on q.id = v.question_id
  where not q.hidden or public.is_admin();
grant select on public.vote_details to anon, authenticated;

-- ---------- HIGH-3: push triggers now send the shared secret ----------
-- New-question fan-out
create or replace function public.notify_new_question()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url     := 'https://gyotdxrgcqbemefelnga.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer sb_publishable_n3M80jkubv4N6hCZtGKgTg_0S5SV3p9',
                 'x-push-secret', '8e84d84ec81436d099ebbb6f9c154a1d0eda882c8a41a44c'
               ),
    body    := jsonb_build_object('record', to_jsonb(NEW))
  );
  return NEW;
end; $$;

-- Engagement events (reply / clarif / clarif_answer)
create or replace function public.notify_push_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url     := 'https://gyotdxrgcqbemefelnga.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer sb_publishable_n3M80jkubv4N6hCZtGKgTg_0S5SV3p9',
                 'x-push-secret', '8e84d84ec81436d099ebbb6f9c154a1d0eda882c8a41a44c'
               ),
    body    := jsonb_build_object('type', tg_argv[0], 'record', to_jsonb(NEW))
  );
  return NEW;
end; $$;
