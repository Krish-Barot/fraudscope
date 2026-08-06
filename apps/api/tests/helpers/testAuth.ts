// apps/api/tests/helpers/testAuth.ts
// Helper for generating real JWT tokens using UUIDs from the seeded users table

import jwt from 'jsonwebtoken';
import { Knex } from 'knex';
import bcrypt from 'bcrypt';

export interface TestTokens {
  ADMIN_TOKEN: string;
  ANALYST_TOKEN: string;
  adminUser: any;
  analystUser: any;
}

export const SEEDED_ADMIN_ID = '11111111-1111-1111-1111-111111111111';
export const SEEDED_ANALYST_ID = '22222222-2222-2222-2222-222222222222';

export async function ensureSeededUsers(db: Knex): Promise<void> {
  const existingAnalyst = await db('users').where({ email: 'analyst@fraudscope.dev' }).first();
  const existingAdmin = await db('users').where({ email: 'admin@fraudscope.dev' }).first();

  const SALT_ROUNDS = 1; // fast for tests

  if (!existingAnalyst) {
    const analystPasswordHash = await bcrypt.hash('analyst123', SALT_ROUNDS);
    await db('users').insert({
      id: SEEDED_ANALYST_ID,
      email: 'analyst@fraudscope.dev',
      password_hash: analystPasswordHash,
      first_name: 'Sarah',
      last_name: 'Chen',
      role: 'analyst',
      is_active: true,
    });
  }

  if (!existingAdmin) {
    const adminPasswordHash = await bcrypt.hash('admin123', SALT_ROUNDS);
    await db('users').insert({
      id: SEEDED_ADMIN_ID,
      email: 'admin@fraudscope.dev',
      password_hash: adminPasswordHash,
      first_name: 'Marcus',
      last_name: 'Webb',
      role: 'admin',
      is_active: true,
    });
  }
}

export async function getTestTokens(db: Knex): Promise<TestTokens> {
  await ensureSeededUsers(db);

  const admin = await db('users')
    .where({ email: 'admin@fraudscope.dev' })
    .first();

  const analyst = await db('users')
    .where({ email: 'analyst@fraudscope.dev' })
    .first();

  if (!admin || !analyst) {
    throw new Error('Failed to load seeded admin or analyst from users table');
  }

  const secret = process.env.JWT_ACCESS_SECRET || 'dev_access_secret_change_in_production';

  const ADMIN_TOKEN = jwt.sign(
    {
      userId: admin.id,
      email: admin.email,
      role: admin.role,
    },
    secret,
    { expiresIn: '1h' }
  );

  const ANALYST_TOKEN = jwt.sign(
    {
      userId: analyst.id,
      email: analyst.email,
      role: analyst.role,
    },
    secret,
    { expiresIn: '1h' }
  );

  return {
    ADMIN_TOKEN,
    ANALYST_TOKEN,
    adminUser: admin,
    analystUser: analyst,
  };
}
