'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { currentMember } from '@/lib/supabase/server';
const back = (text, error = false) => redirect('/team?' + (error ? 'error=' : 'saved=') + encodeURIComponent(text));
async function manager() {
  const ctx = await currentMember();
  if (!ctx.member || !['owner', 'admin'].includes(ctx.member.role)) redirect('/today');
  return ctx;
}
export async function previewPortfolio(id) {
  const { sb, member } = await manager();
  const { data, error } = await sb.from('staff_profiles').select('id').eq('id', id).eq('agency_id', member.agency_id).eq('active', true).eq('is_demo', true).maybeSingle();
  if (error || !data) back('Test staff profile unavailable', true);
  const jar = await cookies();
  jar.delete('viewas');
  jar.set('portfolio_preview', data.id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 14400 });
  redirect('/today');
}
export async function endPortfolioPreview() {
  (await cookies()).delete('portfolio_preview');
  redirect('/access');
}
export async function assignProperty(fd) {
  const { sb, member } = await manager();
  const propertyId = String(fd.get('property_id') || ''), staffId = String(fd.get('staff_id') || '');
  if (staffId) {
    const { data, error } = await sb.from('staff_profiles').select('id').eq('id', staffId).eq('agency_id', member.agency_id).eq('active', true).maybeSingle();
    if (error || !data) back('Choose an active member of this agency', true);
  }
  const { data, error } = await sb.from('properties').update({ portfolio_staff_id: staffId || null }).eq('id', propertyId).eq('agency_id', member.agency_id).is('archived_at', null).select('id').maybeSingle();
  if (error || !data) back('Assignment was not saved' + (error ? ': ' + error.message : ''), true);
  revalidatePath('/'); revalidatePath('/today'); revalidatePath('/team'); revalidatePath('/access');
  back('Portfolio assignment saved');
}
