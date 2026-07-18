-- ============================================================================
--  0010 — clarification moderation + profile photos
--  Run in Supabase → SQL Editor → New query → paste → Run (once).
--
--  Part 1: admins can edit, hide/restore, and delete clarifying questions.
--          (The guard trigger that protects clarifications now recognises
--           admins; the question's author is still limited to answering.)
--  Part 2: profile photos — an avatars storage bucket where each user can
--          upload only into their own folder, plus profiles.avatar_url.
-- ============================================================================

-- ---------- Part 1: clarification moderation ----------

alter table public.clarifications
  add column if not exists hidden boolean not null default false;

-- Guard trigger: author may only answer; admins may edit body/answer/hidden.
create or replace function public.guard_clarification_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  q_author uuid;
  admin boolean;
begin
  select author_id into q_author from public.questions where id = new.question_id;
  admin := public.is_admin();

  if auth.uid() <> q_author and not admin then
    raise exception 'Only the question author or an admin can modify clarifications';
  end if;

  -- Immutable for everyone:
  new.asker_id   := old.asker_id;
  new.created_at := old.created_at;

  -- The author (non-admin) can only write the answer:
  if not admin then
    new.body   := old.body;
    new.hidden := old.hidden;
  end if;

  if new.answer_body is distinct from old.answer_body then
    new.answered_at := now();
  end if;
  return new;
end;
$$;

-- Policies: admins can update/delete; hidden clarifications vanish for non-admins.
drop policy if exists "clarif answer" on public.clarifications;
create policy "clarif answer" on public.clarifications for update
  using (auth.uid() = (select author_id from public.questions where id = question_id)
         or public.is_admin());

drop policy if exists "clarif admin delete" on public.clarifications;
create policy "clarif admin delete" on public.clarifications for delete
  using (public.is_admin());

drop policy if exists "clarif readable" on public.clarifications;
create policy "clarif readable" on public.clarifications for select
  using (not hidden or public.is_admin());

-- ---------- Part 2: profile photos ----------

alter table public.profiles
  add column if not exists avatar_url text;

-- Public bucket for avatars (images are world-readable; writes are scoped).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Anyone can view avatars; each user can only write inside their own folder
-- (paths look like: <their-user-id>/avatar.jpg).
drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars own insert" on storage.objects;
create policy "avatars own insert" on storage.objects for insert
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "avatars own update" on storage.objects;
create policy "avatars own update" on storage.objects for update
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "avatars own delete" on storage.objects;
create policy "avatars own delete" on storage.objects for delete
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
