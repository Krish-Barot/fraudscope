// apps/web/proxy.ts
// Next.js 16 Proxy — edge-compatible auth verification & header injection
//
// RESPONSIBILITIES:
// 1. Verify the access token from the browser cookie
// 2. Inject user headers (x-user-id, x-user-email, x-user-role) for Server Components
// 3. Redirect unauthenticated users to /login on protected routes
// 4. Redirect non-admin users away from /dashboard/admin/* routes

import { NextResponse, type NextRequest } from 'next/server';
import { verifyToken, ACCESS_TOKEN_COOKIE } from './lib/auth';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Read and verify the access token from the browser cookie
  // This cookie is set by AuthContext on login/refresh
  const token = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const payload = token ? await verifyToken(token) : null;

  // ── Admin route protection ────────────────────────────────────
  // /dashboard/admin/* requires role = admin
  if (pathname.startsWith('/dashboard/admin')) {
    if (!payload) {
      // Not authenticated — redirect to login
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('from', pathname);
      return NextResponse.redirect(loginUrl);
    }
    if (payload.role !== 'admin') {
      // Authenticated but not admin — redirect to dashboard (not login)
      const dashboardUrl = new URL('/dashboard', request.url);
      return NextResponse.redirect(dashboardUrl);
    }
  }

  // ── General dashboard auth ────────────────────────────────────
  // All /dashboard routes require authentication
  if (pathname.startsWith('/dashboard') && !payload) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ── Inject user headers for Server Components ─────────────────
  const requestHeaders = new Headers(request.headers);
  if (payload) {
    requestHeaders.set('x-user-id', payload.userId);
    requestHeaders.set('x-user-email', payload.email);
    requestHeaders.set('x-user-role', payload.role);
  }

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: ['/dashboard/:path*', '/dashboard'],
};

