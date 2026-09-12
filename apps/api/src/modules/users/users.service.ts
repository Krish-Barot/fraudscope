// apps/api/src/modules/users/users.service.ts
// Business logic for Users API (FS-28)

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { db } from '../../config/database';
import { CreateUserInput, UpdateUserInput } from './users.schema';

const SALT_ROUNDS = 10;

export interface AppUserWithStats {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: 'analyst' | 'admin';
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  stats: {
    alerts_reviewed: number;
    avg_response_time_seconds: number;
    escalation_rate: number;
  };
}

// ─────────────────────────────────────────
// Write audit log for user operations
// ─────────────────────────────────────────
async function writeAuditLog(
  eventType: string,
  targetId: string,
  actorId: string | undefined,
  payload: Record<string, unknown>,
  ipAddress?: string
): Promise<void> {
  await db('audit_logs').insert({
    event_type: eventType,
    actor_id: actorId || null,
    actor_type: actorId ? 'user' : 'system',
    target_type: 'user',
    target_id: targetId,
    payload: JSON.stringify(payload),
    ip_address: ipAddress || null,
    source: 'api',
  });
}

// ─────────────────────────────────────────
// Get all users with analyst review stats
// ─────────────────────────────────────────
export async function getUsers(): Promise<AppUserWithStats[]> {
  const rows = await db('users as u')
    .leftJoin('alert_actions as aa', 'aa.analyst_id', 'u.id')
    .leftJoin('alerts as a', 'a.id', 'aa.alert_id')
    .select(
      'u.id',
      'u.email',
      'u.first_name',
      'u.last_name',
      'u.role',
      'u.is_active',
      'u.last_login_at',
      'u.created_at',
      db.raw('COALESCE(COUNT(DISTINCT aa.alert_id), 0)::int AS alerts_reviewed'),
      db.raw(
        'COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (aa.created_at - a.created_at)))), 0)::int AS avg_response_time_seconds'
      ),
      db.raw(`
        COALESCE(
          ROUND(
            (COUNT(CASE WHEN aa.action = 'escalate' THEN 1 END)::numeric / NULLIF(COUNT(DISTINCT aa.alert_id), 0)),
            2
          )::float,
          0
        ) AS escalation_rate
      `)
    )
    .groupBy(
      'u.id',
      'u.email',
      'u.first_name',
      'u.last_name',
      'u.role',
      'u.is_active',
      'u.last_login_at',
      'u.created_at'
    )
    .orderBy('u.created_at', 'asc');

  return rows.map((row: any) => ({
    id: row.id,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    role: row.role,
    is_active: row.is_active,
    last_login_at: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    created_at: new Date(row.created_at).toISOString(),
    stats: {
      alerts_reviewed: Number(row.alerts_reviewed || 0),
      avg_response_time_seconds: Number(row.avg_response_time_seconds || 0),
      escalation_rate: Number(row.escalation_rate || 0),
    },
  }));
}

// ─────────────────────────────────────────
// Get single user by ID with stats
// ─────────────────────────────────────────
export async function getUserById(id: string): Promise<AppUserWithStats | null> {
  const row = await db('users as u')
    .leftJoin('alert_actions as aa', 'aa.analyst_id', 'u.id')
    .leftJoin('alerts as a', 'a.id', 'aa.alert_id')
    .where('u.id', id)
    .select(
      'u.id',
      'u.email',
      'u.first_name',
      'u.last_name',
      'u.role',
      'u.is_active',
      'u.last_login_at',
      'u.created_at',
      db.raw('COALESCE(COUNT(DISTINCT aa.alert_id), 0)::int AS alerts_reviewed'),
      db.raw(
        'COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (aa.created_at - a.created_at)))), 0)::int AS avg_response_time_seconds'
      ),
      db.raw(`
        COALESCE(
          ROUND(
            (COUNT(CASE WHEN aa.action = 'escalate' THEN 1 END)::numeric / NULLIF(COUNT(DISTINCT aa.alert_id), 0)),
            2
          )::float,
          0
        ) AS escalation_rate
      `)
    )
    .groupBy(
      'u.id',
      'u.email',
      'u.first_name',
      'u.last_name',
      'u.role',
      'u.is_active',
      'u.last_login_at',
      'u.created_at'
    )
    .first();

  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    role: row.role,
    is_active: row.is_active,
    last_login_at: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
    created_at: new Date(row.created_at).toISOString(),
    stats: {
      alerts_reviewed: Number(row.alerts_reviewed || 0),
      avg_response_time_seconds: Number(row.avg_response_time_seconds || 0),
      escalation_rate: Number(row.escalation_rate || 0),
    },
  };
}

// ─────────────────────────────────────────
// Update user role and/or active status
// ─────────────────────────────────────────
export async function updateUser(
  id: string,
  input: UpdateUserInput,
  actorId?: string,
  ipAddress?: string
): Promise<AppUserWithStats> {
  const existing = await db('users').where({ id }).first();
  if (!existing) {
    const err = new Error('User not found') as any;
    err.code = 'NOT_FOUND';
    throw err;
  }

  const updates: Record<string, unknown> = {
    updated_at: db.fn.now(),
  };

  if (input.first_name !== undefined) updates.first_name = input.first_name;
  if (input.last_name !== undefined) updates.last_name = input.last_name;
  if (input.role !== undefined) updates.role = input.role;
  if (input.is_active !== undefined) updates.is_active = input.is_active;

  await db('users').where({ id }).update(updates);

  // Write audit log
  let eventType = 'user.updated';
  if (input.role !== undefined && input.role !== existing.role) {
    eventType = 'user.role_changed';
  } else if (input.is_active !== undefined && input.is_active !== existing.is_active) {
    eventType = input.is_active ? 'user.activated' : 'user.deactivated';
  }

  await writeAuditLog(
    eventType,
    id,
    actorId,
    {
      changes: input,
      previous: {
        first_name: existing.first_name,
        last_name: existing.last_name,
        role: existing.role,
        is_active: existing.is_active,
      },
    },
    ipAddress
  );

  const updated = await getUserById(id);
  return updated!;
}

// ─────────────────────────────────────────
// Create user (POST /api/v1/users)
// ─────────────────────────────────────────
export async function createUser(
  input: CreateUserInput,
  actorId?: string,
  ipAddress?: string
): Promise<{ user: AppUserWithStats; temp_password?: string }> {
  const existing = await db('users').where({ email: input.email }).first();
  if (existing) {
    const err = new Error('Email already registered') as any;
    err.code = 'DUPLICATE_EMAIL';
    throw err;
  }

  const tempPassword =
    input.password ||
    crypto.randomBytes(8).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) + '!1Aa';

  const passwordHash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

  const [inserted] = await db('users')
    .insert({
      email: input.email,
      password_hash: passwordHash,
      first_name: input.first_name,
      last_name: input.last_name,
      role: input.role,
      is_active: true,
    })
    .returning('*');

  await writeAuditLog(
    'user.registered',
    inserted.id,
    actorId,
    {
      email: inserted.email,
      role: inserted.role,
      first_name: inserted.first_name,
      last_name: inserted.last_name,
    },
    ipAddress
  );

  const user = await getUserById(inserted.id);
  return {
    user: user!,
    temp_password: input.password ? undefined : tempPassword,
  };
}
