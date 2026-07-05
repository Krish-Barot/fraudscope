// apps/api/src/modules/transactions/transaction.schema.ts
// Zod schemas define the exact shape of valid request data
// If the request doesn't match the schema, Zod throws a detailed error
// before the data ever touches your database

import { z } from 'zod';

// ISO 3166-1 alpha-2 country codes — 2 uppercase letters
// Examples: CA, US, GB, NG, AU
const countryCodeRegex = /^[A-Z]{2}$/;

// Basic IP address validation (IPv4 and IPv6)
const ipAddressRegex =
  /^(\d{1,3}\.){3}\d{1,3}$|^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

export const createTransactionSchema = z.object({
  // external_id: the ID from the source payment system
  // We store it so we never process the same transaction twice
  external_id: z
    .string()
    .min(1, 'external_id is required')
    .max(100, 'external_id must be 100 characters or less'),

  account_id: z
    .string()
    .min(1, 'account_id is required')
    .max(50, 'account_id must be 50 characters or less'),

  // coerce converts string "123.45" to number 123.45
  // Payment systems sometimes send amounts as strings
  amount: z
    .number()
    .positive('Amount must be a positive number')
    .max(999999999999999, 'Amount exceeds maximum'),

  // Optional with default — if not provided, assume CAD
  currency: z
    .string()
    .length(3, 'Currency must be a 3-character ISO code')
    .toUpperCase()
    .default('CAD'),

  merchant_name: z
    .string()
    .max(255)
    .optional(),

  merchant_category: z
    .string()
    .max(100)
    .optional(),

  country_code: z
    .string()
    .regex(countryCodeRegex, 'country_code must be a 2-letter ISO 3166-1 alpha-2 code'),

  city: z
    .string()
    .max(100)
    .optional(),

  ip_address: z
    .string()
    .regex(ipAddressRegex, 'Invalid IP address format')
    .optional(),

  latitude: z
    .number()
    .min(-90)
    .max(90)
    .optional(),

  longitude: z
    .number()
    .min(-180)
    .max(180)
    .optional(),

  channel: z
    .enum(['online', 'pos', 'atm', 'mobile', 'wire'])
    .optional(),
});

// TypeScript type inferred from the schema
// Use this type anywhere you work with validated transaction data
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;