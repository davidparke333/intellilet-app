'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { currentMember, isStaff } from '@/lib/supabase/server';

async function staffOnly() { const ctx = await currentMember(); if (!isStaff(ctx.member)) redirect('/'); return ctx; }
const back = (msg, err) => { revalidatePath('/access'); redirect('/access?' + (err ? 'error=' : 'saved=') + encodeURIComponent(msg)); };

export async function grantAccess(contactId, role) {
  const { sb } = await staffOnly();
  const { data: c } = await sb.from('contacts').select('full_name, email').eq('id', contactId).single();
  if (!c || !c.email) back('Add an email address for ' + (c ? c.full_name : 'this person') + ' first', true);
  const { error } = await sb.rpc('grant_portal', { p_email: c.email, p_role: role, p_contact: contactId });
  if (error) back(error.message, true);
  back(c.full_name + ' can now sign in to the ' + role + ' portal with ' + c.email);
}
export async function revokeAccess(contactId, role) {
  const { sb } = await staffOnly();
  const { error } = await sb.from('memberships').update({ active: false }).eq('contact_id', contactId).eq('role', role);
  if (error) back(error.message, true);
  back('Access removed');
}

// See the portal exactly as this person does, then come back
export async function previewAs(contactId, role) {
  const { sb } = await staffOnly();
  const { error } = await sb.rpc('preview_as', { p_contact: contactId, p_role: role });
  if (error) back(/preview_as/.test(error.message) ? 'The database needs update 011 first (see the instructions from Claude)' : error.message, true);
  (await cookies()).delete('portfolio_preview');
  (await cookies()).set('viewas', role + ':' + contactId, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 4 });
  redirect('/portal');
}
export async function exitPreview() {
  (await cookies()).delete('viewas');
  redirect('/access');
}
