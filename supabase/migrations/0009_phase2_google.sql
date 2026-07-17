-- ============================================================================
--  0009 — Admin phase 2 + Google sign-in support
--  Run in Supabase → SQL Editor → New query → paste → Run (once).
--
--  What this does:
--   • Admins can read the reports table (powers the in-app report queue)
--   • profiles gains needs_handle: true when an account arrived via Google
--     and still needs to pick a username (the app shows a picker until set)
--   • Signup trigger becomes collision-safe: if a handle is taken (or absent,
--     as with Google), it generates a unique temporary one instead of failing
-- ============================================================================

-- Report queue: admins can see who reported what.
drop policy if exists "reports admin read" on public.reports;
create policy "reports admin read" on public.reports for select
  using (public.is_admin());

-- Google arrivals need to pick a username.
alter table public.profiles
  add column if not exists needs_handle boolean not null default false;

-- Collision-safe account creation (works for email signups AND Google).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
  h text;
  tries int := 0;
  chose boolean;
begin
  -- Did the person choose a handle themselves (email signup form)?
  chose := (new.raw_user_meta_data->>'handle') is not null;

  base := lower(regexp_replace(
            coalesce(new.raw_user_meta_data->>'handle', split_part(new.email, '@', 1)),
            '[^a-zA-Z0-9_]', '', 'g'));
  if base is null or length(base) < 3 then base := 'player'; end if;

  h := base;
  while exists (select 1 from public.profiles where handle = h) loop
    tries := tries + 1;
    h := base || floor(random() * 10000)::int::text;
    if tries > 20 then
      h := base || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
    end if;
  end loop;

  insert into public.profiles (id, handle, name, needs_handle)
  values (
    new.id,
    h,
    coalesce(new.raw_user_meta_data->>'name',
             new.raw_user_meta_data->>'full_name',
             split_part(new.email, '@', 1)),
    not chose
  );
  insert into public.notification_prefs (user_id) values (new.id);
  return new;
end;
$$;
