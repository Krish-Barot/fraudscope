// apps/web/lib/auth.ts
// Auth utilities for the Next.js frontend
//
// Two separate JWT operations:
// 1. Edge-compatible verification (middleware.ts) — uses jose
// 2. Client-side token reading (components) — reads from cookie
//
// WHY JOSE NOT JSONWEBTOKEN:
// Next.js middleware runs on the Edge Runtime, a lightweight V8 environment
// that doesn't have access to Node.js built-in modules (crypto, fs, etc.).
// jsonwebtoken uses Node.js crypto — it crashes on Edge.
// jose is a pure JavaScript JWT library that works everywhere.

import { jwtVerify } from 'jose';

export interface JwtPayload {
  userId: string;
  email: string;
  role: 'analyst' | 'admin';
  exp: number;
  iat: number;
}

// Used by middleware.ts (Edge Runtime)
export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const secret = new TextEncoder().encode(
      process.env.JWT_ACCESS_SECRET || 'dev_access_secret_change_in_production'
    );

    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}

// Decode JWT payload WITHOUT verifying signature
// Safe to use client-side since middleware already verified on the server
// We just need the payload (userId, email, role) for UI rendering
export function decodeToken(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Base64url decode the payload (middle part)
    const payload = parts[1];
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
    const decoded = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));

    return JSON.parse(decoded) as JwtPayload;
  } catch {
    return null;
  }
}

// Cookie name constants — used in multiple places
// Single source of truth prevents typos
export const ACCESS_TOKEN_COOKIE = 'fraudscope_access_token';
export const REFRESH_TOKEN_COOKIE = 'fraudscope_refresh_token';