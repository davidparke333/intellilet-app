import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Supabase client for server pages and actions. It acts as the signed-in user,
// so the database's access rules decide what they can see.
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => { try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch { /* called from a page: middleware refreshes instead */ } }
    }
  });
}

// The signed-in user and their agency membership (or null)
export async function currentMember() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { sb, user: null, member: null };
  const { data: rows } = await sb.from('memberships').select('agency_id, role, contact_id, agencies(name, trading_name)').eq('user_id', user.id).eq('active', true);
  const order = ['owner', 'admin', 'staff', 'readonly', 'landlord', 'tenant', 'contractor'];
  let member = (rows || []).sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role))[0] || null;
  // Staff previewing a portal as a landlord, tenant or contractor (Access, Preview)
  const view = (await cookies()).get('viewas');
  if (view && member && ['owner', 'admin', 'staff'].includes(member.role)) {
    const [role, contact] = view.value.split(':');
    const as = (rows || []).find((r) => r.role === role && r.contact_id === contact);
    if (as) member = { ...as, preview: true };
  }
  return { sb, user, member };
}
export const isStaff = (m) => !!m && ['owner', 'admin', 'staff'].includes(m.role);
