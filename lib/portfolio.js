import { cookies } from 'next/headers';

// Portfolio selection changes the working view, never the authenticated identity.
export async function portfolioContext(sb, member, user) {
  if (!member || !['owner', 'admin', 'staff'].includes(member.role)) return { profile: null, error: null };
  const previewId = (await cookies()).get('portfolio_preview')?.value;
  const preview = !!previewId && ['owner', 'admin'].includes(member.role);
  let query = sb.from('staff_profiles').select('id, full_name, is_demo').eq('agency_id', member.agency_id).eq('active', true);
  query = preview ? query.eq('id', previewId).eq('is_demo', true) : query.eq('user_id', user.id);
  const { data, error } = await query.maybeSingle();
  return { profile: data ? { ...data, preview } : null, error };
}
export const portfolioScope = (sp, member, profile) => sp.scope === 'all' ? 'all' : sp.scope === 'mine' || profile || member.role === 'staff' ? 'mine' : 'all';
export const EMPTY_PORTFOLIO_ID = '00000000-0000-0000-0000-000000000000';
