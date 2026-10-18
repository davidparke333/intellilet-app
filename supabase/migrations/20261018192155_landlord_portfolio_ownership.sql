-- A landlord owns the allocation; properties follow that allocation.
alter table public.landlords add column portfolio_staff_id uuid;
alter table public.landlords add constraint landlords_portfolio_staff_agency_fk foreign key(portfolio_staff_id,agency_id) references public.staff_profiles(id,agency_id);
create index landlords_portfolio_staff_idx on public.landlords(agency_id,portfolio_staff_id);
create or replace function app.check_portfolio_assignment() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if TG_OP='INSERT' then
    if new.portfolio_staff_id is null then return new; end if;
  elsif new.portfolio_staff_id is not distinct from old.portfolio_staff_id then return new;
  end if;
  if pg_trigger_depth()=1 and current_user not in ('postgres','service_role') and not exists(select 1 from public.memberships m where m.user_id=auth.uid() and m.agency_id=new.agency_id and m.active and m.role in ('owner','admin')) then raise exception 'Only agency managers can change portfolio assignments'; end if;
  if new.portfolio_staff_id is not null and not exists(select 1 from public.staff_profiles s where s.id=new.portfolio_staff_id and s.agency_id=new.agency_id and s.active) then raise exception 'Choose an active staff profile in this agency'; end if;
  return new;
end $$;
create trigger check_landlord_assignment before insert or update on public.landlords for each row execute function app.check_portfolio_assignment();
create function app.check_property_landlord_manager() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.property_owners o join public.landlords l on l.id=o.landlord_id where o.property_id=new.id and l.portfolio_staff_id is distinct from new.portfolio_staff_id) then raise exception 'Assign the whole landlord portfolio from Team, not an individual property'; end if;
  return new;
end $$;
-- Installed after the initial allocations have been regrouped below.
create function app.sync_landlord_properties() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  update public.properties p set portfolio_staff_id=l.portfolio_staff_id from public.property_owners o join public.landlords l on l.id=o.landlord_id join changed_landlords n on n.id=l.id where p.id=o.property_id and p.portfolio_staff_id is distinct from l.portfolio_staff_id;
  return null;
end $$;
create trigger sync_landlord_properties after update on public.landlords referencing new table as changed_landlords for each statement execute function app.sync_landlord_properties();
create function app.sync_owner_portfolio() returns trigger language plpgsql security invoker set search_path='' as $$
declare pid uuid; sid uuid;
begin
  if TG_OP='DELETE' then pid=old.property_id; else pid=new.property_id; end if;
  select l.portfolio_staff_id into sid from public.property_owners o join public.landlords l on l.id=o.landlord_id where o.property_id=pid limit 1;
  update public.properties set portfolio_staff_id=sid where id=pid;
  if TG_OP='UPDATE' and old.property_id<>new.property_id then
    select l.portfolio_staff_id into sid from public.property_owners o join public.landlords l on l.id=o.landlord_id where o.property_id=old.property_id limit 1;
    update public.properties set portfolio_staff_id=sid where id=old.property_id;
  end if;
  return null;
end $$;
create trigger sync_owner_portfolio after insert or update or delete on public.property_owners for each row execute function app.sync_owner_portfolio();
create function public.assign_landlord_portfolio(p_landlord uuid,p_staff uuid) returns integer language plpgsql security invoker set search_path='' as $$
declare ag uuid; affected integer;
begin
  select agency_id into ag from public.landlords where id=p_landlord;
  if ag is null or auth.uid() is null or not exists(select 1 from public.memberships m where m.user_id=auth.uid() and m.agency_id=ag and m.active and m.role in ('owner','admin')) then raise exception 'Only agency managers can allocate landlord portfolios'; end if;
  -- Serialize assignments within an agency. Shared ownership groups move together.
  perform id from public.agencies where id=ag for update;
  if p_staff is not null and not exists(select 1 from public.staff_profiles s where s.id=p_staff and s.agency_id=ag and s.active) then raise exception 'Choose an active staff profile in this agency'; end if;
  with recursive connected(id) as (
    select p_landlord
    union
    select o2.landlord_id from connected c join public.property_owners o1 on o1.landlord_id=c.id join public.property_owners o2 on o2.property_id=o1.property_id join public.landlords l on l.id=o2.landlord_id where l.agency_id=ag
  ) update public.landlords set portfolio_staff_id=p_staff where agency_id=ag and id in(select id from connected);
  get diagnostics affected=row_count;
  return affected;
end $$;
revoke all on function public.assign_landlord_portfolio(uuid,uuid) from public,anon;
grant execute on function public.assign_landlord_portfolio(uuid,uuid) to authenticated;
-- Consolidate existing assignments before enforcing the new invariant.
update public.landlords l set portfolio_staff_id=(select p.portfolio_staff_id from public.property_owners o join public.properties p on p.id=o.property_id where o.landlord_id=l.id and p.portfolio_staff_id is not null group by p.portfolio_staff_id order by count(*) desc,p.portfolio_staff_id limit 1);
create trigger check_property_landlord_manager before insert or update on public.properties for each row execute function app.check_property_landlord_manager();
