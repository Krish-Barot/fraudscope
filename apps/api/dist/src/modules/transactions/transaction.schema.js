"use strict";
// apps/api/src/modules/transactions/transaction.schema.ts
// Zod schemas define the exact shape of valid request data
// If the request doesn't match the schema, Zod throws a detailed error
// before the data ever touches your database
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTransactionSchema = void 0;
const zod_1 = require("zod");
// ISO 3166-1 alpha-2 country codes — 2 uppercase letters
// Examples: CA, US, GB, NG, AU
const countryCodeRegex = /^[A-Z]{2}$/;
// Basic IP address validation (IPv4 and IPv6)
const ipAddressRegex = /^(\d{1,3}\.){3}\d{1,3}$|^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
exports.createTransactionSchema = zod_1.z.object({
    // external_id: the ID from the source payment system
    // We store it so we never process the same transaction twice
    external_id: zod_1.z
        .string()
        .min(1, 'external_id is required')
        .max(100, 'external_id must be 100 characters or less'),
    account_id: zod_1.z
        .string()
        .min(1, 'account_id is required')
        .max(50, 'account_id must be 50 characters or less'),
    // coerce converts string "123.45" to number 123.45
    // Payment systems sometimes send amounts as strings
    amount: zod_1.z
        .number()
        .positive('Amount must be a positive number')
        .max(999999999999999, 'Amount exceeds maximum'),
    // Optional with default — if not provided, assume CAD
    currency: zod_1.z
        .string()
        .length(3, 'Currency must be a 3-character ISO code')
        .toUpperCase()
        .default('CAD'),
    merchant_name: zod_1.z
        .string()
        .max(255)
        .optional(),
    merchant_category: zod_1.z
        .string()
        .max(100)
        .optional(),
    country_code: zod_1.z
        .string()
        .regex(countryCodeRegex, 'country_code must be a 2-letter ISO 3166-1 alpha-2 code'),
    city: zod_1.z
        .string()
        .max(100)
        .optional(),
    ip_address: zod_1.z
        .string()
        .regex(ipAddressRegex, 'Invalid IP address format')
        .optional(),
    latitude: zod_1.z
        .number()
        .min(-90)
        .max(90)
        .optional(),
    longitude: zod_1.z
        .number()
        .min(-180)
        .max(180)
        .optional(),
    channel: zod_1.z
        .enum(['online', 'pos', 'atm', 'mobile', 'wire'])
        .optional(),
});
//# sourceMappingURL=transaction.schema.js.map