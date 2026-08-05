// apps/web/proxy.ts
// Next.js 16 Proxy — edge-compatible auth verification & header injection

import { NextResponse, type NextRequest } from 'next/server';
import { verifyToken, ACCESS_TOKEN_COOKIE } from './lib/auth';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  let payload = token ? await verifyToken(token) : null;

  // In dev environment, provide fallback user headers if no active session
  if (!payload && process.env.NODE_ENV !== 'production') {
    payload = {
      userId: 'dev-user-001',
      email: 'analyst@fraudscope.dev',
      role: 'analyst',
      exp: Math.floor(Date.now() / 1000) + 86400,
      iat: Math.floor(Date.now() / 1000),
    };
  }

  // Redirect to login if unauthenticated on protected routes
  if (pathname.startsWith('/dashboard') && !payload) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Inject user headers into request context for Server Components
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
