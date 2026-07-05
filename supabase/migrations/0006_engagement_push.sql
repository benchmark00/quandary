-- ============================================================================
--  0006 — push notifications for engagement (replies, clarifications, answers)
--
--  BEFORE RUNNING: replace  PASTE_YOUR_ANON_KEY_HERE  with your anon public
--  key (same value as VITE_SUPABASE_ANON_KEY in your .env). Keep the word
--  Bearer and the quotes; swap only the placeholder. Then run in SQL Editor.
--
--  Also redeploy the updated send-push function first (it now understands
--  these event types).
-- ============================================================================

-- ============================================================================
--  First-run onboarding: new accounts see the intro once, then never again.
--  Existing accounts are marked as already onboarded so no one gets re-shown.
-- ============================================================================
alter table public.profiles add column if not exists onboarded boolean not null default false;
update public.profiles set onboarded = true;

create or replace function public.notify_push_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url     := 'https://gyotdxrgcqbemefelnga.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer sb_publishable_n3M80jkubv4N6hCZtGKgTg_0S5SV3p9'
               ),
    body    := jsonb_build_object('type', tg_argv[0], 'record', to_jsonb(NEW))
  );
  return NEW;
end;
$$;

-- Someone replied -> ping the question's author
drop trigger if exists trg_push_reply on public.replies;
create trigger trg_push_reply
  after insert on public.replies
  for each row execute function public.notify_push_event('reply');

-- Someone asked for context -> ping the question's author
drop trigger if exists trg_push_clarif on public.clarifications;
create trigger trg_push_clarif
  after insert on public.clarifications
  for each row execute function public.notify_push_event('clarif');

-- The author answered -> ping the person who asked
drop trigger if exists trg_push_clarif_answer on public.clarifications;
create trigger trg_push_clarif_answer
  after update on public.clarifications
  for each row
  when (old.answer_body is null and new.answer_body is not null)
  execute function public.notify_push_event('clarif_answer');
