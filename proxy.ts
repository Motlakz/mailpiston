import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next 16 renamed `middleware.ts` to `proxy.ts`. It runs on the Node.js runtime
 * and must not export a `runtime` config.
 *
 * This is an *optimistic* check only: it looks for the presence of a session
 * cookie so an anonymous visitor is redirected to sign-in without a round trip
 * to the database. It is not authorisation. Every dashboard page still calls
 * `requireOperatorPage()` and every route still calls `requireOperator()`,
 * which is where the allow-list is actually enforced.
 */
const SESSION_COOKIES = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
];

export function proxy(request: NextRequest) {
  const hasSessionCookie = SESSION_COOKIES.some((name) =>
    request.cookies.has(name),
  );

  if (hasSessionCookie) return NextResponse.next();

  const signIn = new URL('/sign-in', request.url);
  signIn.searchParams.set('next', request.nextUrl.pathname);

  return NextResponse.redirect(signIn);
}

export const config = {
  /**
   * Dashboard pages only. API routes are excluded on purpose: they authenticate
   * with an API key and must return a structured 401, not an HTML redirect.
   */
  matcher: [
    '/overview/:path*',
    '/inbox/:path*',
    '/sent/:path*',
    '/threads/:path*',
    '/logs/:path*',
    '/domains/:path*',
    '/addresses/:path*',
    '/endpoints/:path*',
    '/api-keys/:path*',
    '/settings/:path*',
  ],
};
