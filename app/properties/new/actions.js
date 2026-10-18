'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { currentMember, isStaff } from '@/lib/supabase/server';
export async function searchClients(value) {
  const { sb, member } = await currentMember();
  if (!isStaff(member)) return { clients: [], error: 'Staff access required' };
  const q = String(value || '').trim().slice(0, 80).replace(/[%_]/g, '');
  let query = sb.from('landlords').select('id, contacts!inner(full_name, email)').eq('agency_id', member.agency_id).is('archived_at', null).order('created_at').limit(20);
  if (q) query = query.ilike('contacts.full_name', '%' + q + '%');
  const { data, error } = await query;
  return { clients: error ? [] : (data || []).map((l) => ({ id: l.id, name: l.contacts.full_name, email: l.contacts.email })), error: error ? 'Could not load clients. Please try again.' : null };
}
export async function addProperty(_prev, fd) {
  const { sb, member } = await currentMember();
  if (!isStaff(member)) redirect('/');
  const g = (key) => String(fd.get(key) || '').trim();
  const fail = (error) => ({ error, values: Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string')) });
  const mode = g('client_mode');
  if (!['existing', 'new', 'later'].includes(mode)) return fail('Choose how to add the client');
  if (mode === 'existing' && !g('client_id')) return fail('Select an existing client from the search results');
  if (mode === 'new' && !g('landlord_name')) return fail('Enter the new client name');
  const bedrooms = g('bedrooms') === '' ? null : Number(g('bedrooms'));
  if (bedrooms !== null && (!Number.isInteger(bedrooms) || bedrooms < 0 || bedrooms > 30)) return fail('Bedrooms must be a whole number between 0 and 30');
  const property = { address_line1: g('address_line1'), address_line2: g('address_line2'), town: g('town'), postcode: g('postcode'), property_type: g('property_type'), bedrooms };
  const client = { full_name: g('landlord_name'), email: g('landlord_email'), phone: g('landlord_phone'), registration_number: g('landlord_reg') };
  const { data, error } = await sb.rpc('add_property_with_client', { p_agency: member.agency_id, p_property: property, p_mode: mode, p_client_id: mode === 'existing' ? g('client_id') : null, p_client: client });
  if (error || !data) return fail(error?.message || 'The property was not saved');
  revalidatePath('/'); revalidatePath('/team'); revalidatePath('/portal');
  redirect('/properties/' + data);
}
