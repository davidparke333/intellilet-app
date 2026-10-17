import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Keeps the sign-in fresh on every request and sends signed-out visitors to /login
export async function middleware(request) {
  let response = NextResponse.next({ request });
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });
  const { data: { user } } = await sb.auth.getUser();
  const path = request.nextUrl.pathname;
  const open = path.startsWith('/login') || path.startsWith('/reset');
  if (!user && !open) return NextResponse.redirect(new URL('/login', request.url));
  if (user && !path.startsWith('/auth') && !path.startsWith('/reset')) {
    // staff use the agency screens; landlords, tenants and contractors only ever see their portal
    const { data: ms } = await sb.from('memberships').select('role').eq('user_id', user.id).eq('active', true);
    const staff = (ms || []).some((m) => ['owner', 'admin', 'staff', 'readonly'].includes(m.role));
    const go = (to) => { const r = NextResponse.redirect(new URL(to, request.url)); response.cookies.getAll().forEach((c) => r.cookies.set(c)); return r; };
    if (path.startsWith('/login') || path === '/') { if (!staff) return go('/portal'); if (path.startsWith('/login')) return go('/today'); }
    if (!staff && !path.startsWith('/portal')) return go('/portal');
  }
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)'] };
