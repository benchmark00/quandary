-- ============================================================================
--  0007 — anonymous replies (enforced in the database, like anonymous votes)
--  Run in Supabase → SQL Editor → New query → paste → Run (once).
--
--  How it works:
--   • questions gains an anonymous_replies flag (set from the Ask screen).
--   • The app reads replies through the reply_details view, which nulls out
--     the author on anonymous threads — so identities can't be queried out.
--   • Direct reads of the replies table are restricted: on anonymous threads
--     you can only see your own rows. (This also keeps live updates working
--     for normal threads.)
-- ============================================================================

alter table public.questions
  add column if not exists anonymous_replies boolean not null default false;

-- Anonymity-preserving read path (owner privileges, bypasses the policy below
-- but never exposes the author on anonymous threads).
create or replace view public.reply_details as
  select r.id, r.question_id, r.body, r.created_at,
         case when q.anonymous_replies then null else r.author_id end as author_id
  from public.replies r
  join public.questions q on q.id = r.question_id;

grant select on public.reply_details to anon, authenticated;

-- Tighten direct table reads: full rows only where the thread isn't anonymous,
-- plus always your own replies.
drop policy if exists "replies readable" on public.replies;
create policy "replies readable" on public.replies for select
  using (
    auth.uid() = author_id
    or not exists (
      select 1 from public.questions q
      where q.id = question_id and q.anonymous_replies
    )
  );
