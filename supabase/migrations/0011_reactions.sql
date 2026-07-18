-- ============================================================================
--  0011 — reactions on replies (❤️ 👎 💯 🔥)
--  Run in Supabase → SQL Editor → New query → paste → Run (once).
--
--  One reaction per person per reply: tapping a different emoji switches it,
--  tapping the same one removes it. Everyone can see the counts; you only
--  ever write your own reaction.
-- ============================================================================

create table if not exists public.reactions (
  reply_id  uuid not null references public.replies (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  emoji     text not null check (emoji in ('heart', 'thumbsdown', 'hundred', 'fire')),
  created_at timestamptz not null default now(),
  primary key (reply_id, user_id)           -- exactly one reaction per person
);
create index if not exists reactions_reply_idx on public.reactions (reply_id);

alter table public.reactions enable row level security;

grant select, insert, update, delete on public.reactions to anon, authenticated;

create policy "reactions readable" on public.reactions for select using (true);
create policy "reactions own write" on public.reactions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Let the live-feed refresh pick up reaction changes too.
do $$ begin
  alter publication supabase_realtime add table public.reactions;
exception when duplicate_object then null; end $$;
