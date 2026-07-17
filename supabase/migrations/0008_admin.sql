-- ============================================================================
--  0008 — admin controls, phase 1
--  Run in Supabase → SQL Editor → New query → paste → Run (once).
--
--  What this does:
--   • profiles gains an is_admin flag; darrenamurphy is made admin
--   • admins can edit, hide/restore, and delete ANY question
--   • admins can delete any reply
--   • admins can see hidden questions (to review and restore them)
--  All of it is enforced by Row Level Security — the app UI just exposes
--  buttons; a non-admin physically cannot perform these actions.
-- ============================================================================

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

update public.profiles set is_admin = true where handle = 'darrenamurphy';

-- Helper used inside policies (security definer avoids recursive RLS lookups).
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- Questions: admins can read hidden ones, and update/delete anyone's.
drop policy if exists "questions readable" on public.questions;
create policy "questions readable" on public.questions for select
  using (not hidden or author_id = auth.uid() or public.is_admin());

drop policy if exists "questions update" on public.questions;
create policy "questions update" on public.questions for update
  using (auth.uid() = author_id or public.is_admin());

drop policy if exists "questions delete" on public.questions;
create policy "questions delete" on public.questions for delete
  using (auth.uid() = author_id or public.is_admin());

-- Replies: authors and admins can delete.
drop policy if exists "replies delete" on public.replies;
create policy "replies delete" on public.replies for delete
  using (auth.uid() = author_id or public.is_admin());
