// apps/api/src/modules/auth/auth.schema.ts
// Validation schemas for auth endpoints

import { z } from 'zod';

export const loginSchema = z.object({
  email: z
    .string({ required_error: 'email is required' })
    .email('Must be a valid email address')
    .toLowerCase(),

  password: z
    .string({ required_error: 'password is required' })
    .min(1, 'password is required'),
});

export const registerSchema = z.object({
  email: z
    .string({ required_error: 'email is required' })
    .email('Must be a valid email address')
    .toLowerCase(),

  password: z
    .string({ required_error: 'password is required' })
    .min(8, 'password must be at least 8 characters'),

  first_name: z
    .string({ required_error: 'first_name is required' })
    .min(1, 'first_name is required')
    .max(100),

  last_name: z
    .string({ required_error: 'last_name is required' })
    .min(1, 'last_name is required')
    .max(100),

  role: z
    .enum(['analyst', 'admin'], {
      errorMap: () => ({ message: 'role must be analyst or admin' }),
    })
    .default('analyst'),
});

export const refreshSchema = z.object({
  // refresh_token comes from httpOnly cookie, not body
  // This schema is for the cookie value itself
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;