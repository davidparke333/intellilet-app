-- One transaction saves the property and its client link, or nothing is saved.
create function public.add_property_with_client(p_agency uuid,p_property jsonb,p_mode text,p_client_id uuid default null,p_client jsonb default '{}'::jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare cid uuid; lid uuid; pid uuid;
begin
  if auth.uid() is null or not app.is_staff(p_agency) then raise exception 'Not allowed'; end if;
  if p_mode not in ('existing','new','later') or p_mode is null then raise exception 'Choose Existing client, New client or Add client later'; end if;
  if nullif(trim(p_property->>'address_line1'),'') is null or nullif(trim(p_property->>'postcode'),'') is null then raise exception 'Enter the property address and postcode'; end if;
  perform id from public.agencies where id=p_agency for share;
  if p_mode='existing' then
    select id into lid from public.landlords where id=p_client_id and agency_id=p_agency and archived_at is null for share;
    if lid is null then raise exception 'Select an existing client from this agency'; end if;
  elsif p_mode='new' then
    if nullif(trim(p_client->>'full_name'),'') is null then raise exception 'Enter the new client name'; end if;
    insert into public.contacts(agency_id,full_name,email,phone) values(p_agency,trim(p_client->>'full_name'),nullif(trim(p_client->>'email'),''),nullif(trim(p_client->>'phone'),'')) returning id into cid;
    insert into public.landlords(agency_id,contact_id,registration_number) values(p_agency,cid,nullif(trim(p_client->>'registration_number'),'')) returning id into lid;
  end if;
  insert into public.properties(agency_id,address_line1,address_line2,town,postcode,property_type,bedrooms) values(p_agency,trim(p_property->>'address_line1'),nullif(trim(p_property->>'address_line2'),''),nullif(trim(p_property->>'town'),''),upper(trim(p_property->>'postcode')),coalesce(nullif(p_property->>'property_type',''),'Flat'),nullif(p_property->>'bedrooms','')::smallint) returning id into pid;
  if lid is not null then insert into public.property_owners(agency_id,property_id,landlord_id) values(p_agency,pid,lid); end if;
  return pid;
end $$;
revoke all on function public.add_property_with_client(uuid,jsonb,text,uuid,jsonb) from public,anon;
grant execute on function public.add_property_with_client(uuid,jsonb,text,uuid,jsonb) to authenticated;
