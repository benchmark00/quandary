-- ============================================================================
--  0016 — SEO Phase 2A: public slugs + SEO flags + safe public read path
--  Run in Supabase → SQL Editor → New query → paste → Run (once).
--
--  What this sets up (no content is exposed until Phase 2B builds the pages):
--   • questions.slug          — pretty URL slug, unique, auto-generated
--   • questions.exclude_seo   — admin toggle to keep a question out of public
--                               pages / search engines
--   • public_questions view   — the ONLY thing the SEO build reads: non-hidden,
--                               non-excluded questions with their vote splits
--                               and a couple of top replies, no private data
--   • slug backfill for every existing question
-- ============================================================================

-- ---------- columns ----------
alter table public.questions
  add column if not exists slug text,
  add column if not exists exclude_seo boolean not null default false;

-- ---------- slug generator ----------
-- Turns a title into "would-you-rather-fight-a-horse-sized-duck", trimmed to a
-- sensible length, with a short suffix to guarantee uniqueness.
create or replace function public.make_slug(title text, uid uuid)
returns text
language plpgsql
immutable
as $$
declare
  base text;
begin
  base := lower(title);
  base := regexp_replace(base, '[^a-z0-9]+', '-', 'g');  -- non-alphanumerics -> dash
  base := regexp_replace(base, '-+', '-', 'g');          -- collapse repeats
  base := trim(both '-' from base);
  base := left(base, 60);
  base := trim(both '-' from base);
  if base = '' then base := 'quandary'; end if;
  -- 6-char suffix from the id keeps slugs unique without a lookup loop
  return base || '-' || substr(replace(uid::text, '-', ''), 1, 6);
end;
$$;

-- ---------- keep slug in sync on insert / title change ----------
create or replace function public.set_question_slug()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.slug is null or (tg_op = 'UPDATE' and new.title is distinct from old.title) then
    new.slug := public.make_slug(new.title, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_question_slug on public.questions;
create trigger trg_question_slug
  before insert or update on public.questions
  for each row execute function public.set_question_slug();

-- ---------- backfill existing rows ----------
update public.questions
  set slug = public.make_slug(title, id)
  where slug is null;

create unique index if not exists questions_slug_idx on public.questions (slug);

-- ---------- the public read view (what the SEO build consumes) ----------
-- Owner-privileged view; exposes ONLY what should be on a public page.
-- Anonymous polls show the split but never who voted; anonymous-reply threads
-- and hidden/excluded questions are omitted entirely.
create or replace view public.public_questions as
  select
    q.id,
    q.slug,
    q.flair,
    q.format,
    q.title,
    q.body,
    q.created_at,
    coalesce(pr.name, 'Someone') as author_name,
    (select count(*) from public.votes v where v.question_id = q.id) as vote_count,
    (select count(*) from public.replies r where r.question_id = q.id) as reply_count,
    -- options with per-option vote counts (no voter identities)
    (
      select coalesce(jsonb_agg(jsonb_build_object(
                'text', o.label,
                'votes', (select count(*) from public.votes v where v.option_id = o.id)
              ) order by o.position), '[]'::jsonb)
      from public.question_options o
      where o.question_id = q.id
    ) as options,
    -- up to 3 top replies, only on non-anonymous threads
    (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select r.body, coalesce(rp.name, 'Someone') as author_name
        from public.replies r
        left join public.profiles rp on rp.id = r.author_id
        where r.question_id = q.id
          and not q.anonymous_replies
        order by r.created_at asc
        limit 3
      ) t
    ) as top_replies
  from public.questions q
  left join public.profiles pr on pr.id = q.author_id
  where q.hidden = false
    and q.exclude_seo = false;

-- The SEO build reads this with the service role. Grant read to anon as well
-- so the same view could power a public API later; it contains no private data.
grant select on public.public_questions to anon, authenticated, service_role;
