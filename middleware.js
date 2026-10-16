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
  if (user && path.startsWith('/login')) return NextResponse.redirect(new URL('/', request.url));
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)'] };
