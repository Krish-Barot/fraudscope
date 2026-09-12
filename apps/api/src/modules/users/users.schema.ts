// apps/api/src/modules/users/users.schema.ts
// Validation schemas for users endpoints (FS-28)

import { z } from 'zod';

export const updateUserSchema = z
  .object({
    first_name: z.string().min(1, 'first_name cannot be empty').max(100).optional(),
    last_name: z.string().min(1, 'last_name cannot be empty').max(100).optional(),
    role: z
      .enum(['analyst', 'admin'], {
        errorMap: () => ({ message: 'role must be analyst or admin' }),
      })
      .optional(),
    is_active: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.first_name !== undefined ||
      data.last_name !== undefined ||
      data.role !== undefined ||
      data.is_active !== undefined,
    {
      message: 'At least one field must be provided to update',
    }
  );

export const createUserSchema = z.object({
  email: z
    .string({ required_error: 'email is required' })
    .email('Must be a valid email address')
    .toLowerCase(),
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
  password: z.string().min(8).optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
