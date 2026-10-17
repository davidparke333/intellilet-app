'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
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
