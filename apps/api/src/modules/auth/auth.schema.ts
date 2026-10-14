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

export const updateProfileSchema = z
  .object({
    first_name: z.string().min(1, 'first_name cannot be empty').max(100).optional(),
    last_name: z.string().min(1, 'last_name cannot be empty').max(100).optional(),
    current_password: z.string().optional(),
    new_password: z.string().min(8, 'new_password must be at least 8 characters').optional(),
  })
  .refine(
    (data) => {
      if (data.new_password && !data.current_password) return false;
      return true;
    },
    {
      message: 'current_password is required when setting a new_password',
      path: ['current_password'],
    }
  )
  .refine(
    (data) =>
      data.first_name !== undefined ||
      data.last_name !== undefined ||
      data.new_password !== undefined,
    {
      message: 'At least one field must be provided to update',
    }
  );

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;