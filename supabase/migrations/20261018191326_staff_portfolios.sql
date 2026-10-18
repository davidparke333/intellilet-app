-- Staff profiles are separate from authentication. Demo profiles have no login.
create table public.staff_profiles (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),
  full_name text not null check (length(trim(full_name)) between 1 and 120),
  user_id uuid references auth.users(id) on delete set null,
  is_demo boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (agency_id, user_id),
  check (not is_demo or user_id is null)
);
create index staff_profiles_agency_idx on public.staff_profiles(agency_id);
create index staff_profiles_user_idx on public.staff_profiles(user_id) where user_id is not null;
alter table public.staff_profiles enable row level security;
grant select, insert, update on public.staff_profiles to authenticated;
revoke all on public.staff_profiles from anon;
create policy staff_profiles_read on public.staff_profiles for select to authenticated using (app.is_staff(agency_id));
create policy staff_profiles_insert on public.staff_profiles for insert to authenticated with check (exists (select 1 from public.memberships m where m.user_id=(select auth.uid()) and m.agency_id=staff_profiles.agency_id and m.active and m.role in ('owner','admin')));
create policy staff_profiles_update on public.staff_profiles for update to authenticated using (exists (select 1 from public.memberships m where m.user_id=(select auth.uid()) and m.agency_id=staff_profiles.agency_id and m.active and m.role in ('owner','admin'))) with check (exists (select 1 from public.memberships m where m.user_id=(select auth.uid()) and m.agency_id=staff_profiles.agency_id and m.active and m.role in ('owner','admin')));
alter table public.properties add column portfolio_staff_id uuid;
alter table public.properties add constraint properties_portfolio_staff_agency_fk foreign key (portfolio_staff_id,agency_id) references public.staff_profiles(id,agency_id);
create index properties_portfolio_idx on public.properties(agency_id,portfolio_staff_id) where archived_at is null;
-- Guard allocations even if a staff client bypasses the application's forms.
create function app.check_portfolio_assignment() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if TG_OP='INSERT' then
    if new.portfolio_staff_id is null then return new; end if;
  elsif new.portfolio_staff_id is not distinct from old.portfolio_staff_id then return new;
  end if;
  if current_user not in ('postgres','service_role') and not exists (select 1 from public.memberships m where m.user_id=auth.uid() and m.agency_id=new.agency_id and m.active and m.role in ('owner','admin')) then
    raise exception 'Only agency managers can change portfolio assignments';
  end if;
  if new.portfolio_staff_id is not null and not exists (select 1 from public.staff_profiles s where s.id=new.portfolio_staff_id and s.agency_id=new.agency_id and s.active) then raise exception 'Choose an active staff profile in this agency'; end if;
  return new;
end $$;
create trigger check_portfolio_assignment before insert or update on public.properties for each row execute function app.check_portfolio_assignment();
