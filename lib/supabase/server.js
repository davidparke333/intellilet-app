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
  const { data: rows } = await sb.from('memberships').select('agency_id, role, agencies(name, trading_name)').eq('user_id', user.id).eq('active', true);
  const order = ['owner', 'admin', 'staff', 'readonly', 'landlord', 'tenant', 'contractor'];
  const member = (rows || []).sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role))[0] || null;
  return { sb, user, member };
}
export const isStaff = (m) => !!m && ['owner', 'admin', 'staff'].includes(m.role);
