import { z } from 'zod';
export declare const createTransactionSchema: z.ZodObject<{
    external_id: z.ZodString;
    account_id: z.ZodString;
    amount: z.ZodNumber;
    currency: z.ZodDefault<z.ZodString>;
    merchant_name: z.ZodOptional<z.ZodString>;
    merchant_category: z.ZodOptional<z.ZodString>;
    country_code: z.ZodString;
    city: z.ZodOptional<z.ZodString>;
    ip_address: z.ZodOptional<z.ZodString>;
    latitude: z.ZodOptional<z.ZodNumber>;
    longitude: z.ZodOptional<z.ZodNumber>;
    channel: z.ZodOptional<z.ZodEnum<["online", "pos", "atm", "mobile", "wire"]>>;
}, "strip", z.ZodTypeAny, {
    external_id: string;
    account_id: string;
    amount: number;
    currency: string;
    country_code: string;
    merchant_name?: string | undefined;
    merchant_category?: string | undefined;
    city?: string | undefined;
    ip_address?: string | undefined;
    latitude?: number | undefined;
    longitude?: number | undefined;
    channel?: "online" | "pos" | "atm" | "mobile" | "wire" | undefined;
}, {
    external_id: string;
    account_id: string;
    amount: number;
    country_code: string;
    currency?: string | undefined;
    merchant_name?: string | undefined;
    merchant_category?: string | undefined;
    city?: string | undefined;
    ip_address?: string | undefined;
    latitude?: number | undefined;
    longitude?: number | undefined;
    channel?: "online" | "pos" | "atm" | "mobile" | "wire" | undefined;
}>;
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
//# sourceMappingURL=transaction.schema.d.ts.map