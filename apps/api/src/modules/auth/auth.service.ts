// apps/api/src/modules/auth/auth.service.ts
// Authentication business logic
//
// TOKEN STRATEGY:
// Access token  — signed with JWT_ACCESS_SECRET, expires 15min
//                 payload: { userId, email, role }
// Refresh token — signed with JWT_REFRESH_SECRET, expires 7d
//                 payload: { userId } only — minimal data
//                 sent as httpOnly cookie, never exposed to JS
//
// BCRYPT TIMING ATTACK PREVENTION:
// We always call bcrypt.compare() even when user doesn't exist.
// This ensures login always takes ~same time whether user exists or not.
// Without this, an attacker could enumerate valid emails by measuring
// response time (missing user = fast, wrong password = slow bcrypt).

import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { db } from '../../config/database';
import { LoginInput, RegisterInput, UpdateProfileInput } from './auth.schema';

// ─────────────────────────────────────────
// Token generation helpers
// ─────────────────────────────────────────

const DUMMY_HASH = '$2b$10$abcdefghijklmnopqrstuuVGdcLdxPCDmNGJHmQUYwJRJz7v7KFbS';
// Used in timing attack prevention — see note above

export function generateAccessToken(payload: {
  userId: string;
  email: string;
  role: string;
}): string {
  const secret = process.env.JWT_ACCESS_SECRET!;
  const expiry = process.env.JWT_ACCESS_EXPIRY || '15m';

  return jwt.sign(payload, secret, { expiresIn: expiry } as jwt.SignOptions);
}

export function generateRefreshToken(userId: string): string {
  const secret = process.env.JWT_REFRESH_SECRET!;
  const expiry = process.env.JWT_REFRESH_EXPIRY || '7d';

  return jwt.sign({ userId }, secret, { expiresIn: expiry } as jwt.SignOptions);
}

export function verifyRefreshToken(
  token: string
): { userId: string } | null {
  try {
    const secret = process.env.JWT_REFRESH_SECRET!;
    return jwt.verify(token, secret) as { userId: string };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────
// Write to audit_logs
// ─────────────────────────────────────────
async function writeAuditLog(
  eventType: string,
  actorId: string | null,
  payload: Record<string, unknown>,
  ipAddress?: string
): Promise<void> {
  await db('audit_logs').insert({
    event_type: eventType,
    actor_id: actorId,
    actor_type: actorId ? 'user' : 'system',
    payload: JSON.stringify(payload),
    ip_address: ipAddress || null,
    source: 'api',
  });
}

// ─────────────────────────────────────────
// Register a new user (admin only)
// ─────────────────────────────────────────
export async function register(
  input: RegisterInput,
  actorId: string,
  ipAddress?: string
) {
  // Check for duplicate email
  const existing = await db('users').where({ email: input.email }).first();
  if (existing) {
    const error = new Error('Email already registered') as any;
    error.code = 'DUPLICATE_EMAIL';
    throw error;
  }

  const SALT_ROUNDS = 10;
  const password_hash = await bcrypt.hash(input.password, SALT_ROUNDS);

  const [user] = await db('users').insert({
    email: input.email,
    password_hash,
    first_name: input.first_name,
    last_name: input.last_name,
    role: input.role,
    is_active: true,
  }).returning(['id', 'email', 'first_name', 'last_name', 'role', 'created_at']);

  await writeAuditLog('user.registered', actorId, {
    new_user_id: user.id,
    new_user_email: user.email,
    new_user_role: user.role,
  }, ipAddress);

  return user;
}

// ─────────────────────────────────────────
// Login — verify credentials, issue tokens
// ─────────────────────────────────────────
export async function login(
  input: LoginInput,
  ipAddress?: string
): Promise<{
  user: Record<string, unknown>;
  accessToken: string;
  refreshToken: string;
} | null> {
  // Always fetch user to prevent timing attacks
  const user = await db('users')
    .where({ email: input.email, is_active: true })
    .first();

  // Compare against dummy hash if user not found
  // This ensures consistent response time whether user exists or not
  const hashToCompare = user?.password_hash || DUMMY_HASH;
  const passwordMatch = await bcrypt.compare(input.password, hashToCompare);

  // Return null for both "user not found" and "wrong password"
  // Never tell the client WHICH one failed — that's an enumeration risk
  if (!user || !passwordMatch) {
    return null;
  }

  // Update last login timestamp
  await db('users')
    .where({ id: user.id })
    .update({ last_login_at: db.fn.now() });

  // Generate tokens
  const accessToken = generateAccessToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });
  const refreshToken = generateRefreshToken(user.id);

  await writeAuditLog('user.login', user.id, {
    email: user.email,
  }, ipAddress);

  return {
    user: {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role,
    },
    accessToken,
    refreshToken,
  };
}

// ─────────────────────────────────────────
// Refresh — issue new access token from refresh token
// ─────────────────────────────────────────
export async function refresh(
  refreshToken: string
): Promise<{ accessToken: string; user: Record<string, unknown> } | null> {
  const payload = verifyRefreshToken(refreshToken);
  if (!payload) return null;

  const user = await db('users')
    .where({ id: payload.userId, is_active: true })
    .first();

  if (!user) return null;

  const accessToken = generateAccessToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  return {
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role,
    },
  };
}

// ─────────────────────────────────────────
// Logout — write audit log
// ─────────────────────────────────────────
export async function logout(
  userId: string,
  ipAddress?: string
): Promise<void> {
  await writeAuditLog('user.logout', userId, { userId }, ipAddress);
}

// ─────────────────────────────────────────
// Get current user
// ─────────────────────────────────────────
export async function getCurrentUser(userId: string) {
  const user = await db('users')
    .where({ id: userId })
    .select('id', 'email', 'first_name', 'last_name', 'role', 'created_at', 'last_login_at')
    .first();

  return user || null;
}

// ─────────────────────────────────────────
// Update current user profile and/or password
// ─────────────────────────────────────────
export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
  ipAddress?: string
) {
  const user = await db('users').where({ id: userId }).first();
  if (!user) {
    const err = new Error('User not found') as any;
    err.code = 'NOT_FOUND';
    throw err;
  }

  const updates: Record<string, unknown> = {
    updated_at: db.fn.now(),
  };

  if (input.first_name !== undefined) updates.first_name = input.first_name;
  if (input.last_name !== undefined) updates.last_name = input.last_name;

  if (input.new_password) {
    const isMatch = await bcrypt.compare(input.current_password || '', user.password_hash);
    if (!isMatch) {
      const err = new Error('Current password is incorrect') as any;
      err.code = 'INVALID_PASSWORD';
      throw err;
    }
    const hash = await bcrypt.hash(input.new_password, 10);
    updates.password_hash = hash;
  }

  await db('users').where({ id: userId }).update(updates);

  if (input.new_password) {
    await writeAuditLog('user.password_changed', userId, { userId }, ipAddress);
  }

  if (input.first_name !== undefined || input.last_name !== undefined) {
    await writeAuditLog(
      'user.profile_updated',
      userId,
      {
        changes: {
          first_name: input.first_name,
          last_name: input.last_name,
        },
        previous: {
          first_name: user.first_name,
          last_name: user.last_name,
        },
      },
      ipAddress
    );
  }

  const updatedUser = await getCurrentUser(userId);
  return updatedUser!;
}