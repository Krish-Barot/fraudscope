import { z } from 'zod';
export declare const RULE_TYPES: readonly ["velocity", "amount_anomaly", "geo_mismatch", "time_anomaly", "round_amount"];
export declare const RULE_SEVERITIES: readonly ["low", "medium", "high", "critical"];
export declare const createRuleSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    type: z.ZodEnum<["velocity", "amount_anomaly", "geo_mismatch", "time_anomaly", "round_amount"]>;
    parameters: z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>;
    severity: z.ZodEnum<["low", "medium", "high", "critical"]>;
    score_weight: z.ZodDefault<z.ZodNumber>;
    is_active: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    type: "velocity" | "amount_anomaly" | "geo_mismatch" | "time_anomaly" | "round_amount";
    name: string;
    parameters: Record<string, unknown>;
    severity: "low" | "medium" | "high" | "critical";
    score_weight: number;
    is_active: boolean;
    description?: string | undefined;
}, {
    type: "velocity" | "amount_anomaly" | "geo_mismatch" | "time_anomaly" | "round_amount";
    name: string;
    parameters: Record<string, unknown>;
    severity: "low" | "medium" | "high" | "critical";
    description?: string | undefined;
    score_weight?: number | undefined;
    is_active?: boolean | undefined;
}>;
export declare const updateRuleSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    type: z.ZodEnum<["velocity", "amount_anomaly", "geo_mismatch", "time_anomaly", "round_amount"]>;
    parameters: z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodUnknown>, Record<string, unknown>, Record<string, unknown>>;
    severity: z.ZodEnum<["low", "medium", "high", "critical"]>;
    score_weight: z.ZodDefault<z.ZodNumber>;
    is_active: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    type: "velocity" | "amount_anomaly" | "geo_mismatch" | "time_anomaly" | "round_amount";
    name: string;
    parameters: Record<string, unknown>;
    severity: "low" | "medium" | "high" | "critical";
    score_weight: number;
    is_active: boolean;
    description?: string | undefined;
}, {
    type: "velocity" | "amount_anomaly" | "geo_mismatch" | "time_anomaly" | "round_amount";
    name: string;
    parameters: Record<string, unknown>;
    severity: "low" | "medium" | "high" | "critical";
    description?: string | undefined;
    score_weight?: number | undefined;
    is_active?: boolean | undefined;
}>;
export declare const toggleRuleSchema: z.ZodObject<{
    is_active: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    is_active: boolean;
}, {
    is_active: boolean;
}>;
export declare const listRulesQuerySchema: z.ZodObject<{
    type: z.ZodOptional<z.ZodEnum<["velocity", "amount_anomaly", "geo_mismatch", "time_anomaly", "round_amount"]>>;
    severity: z.ZodOptional<z.ZodEnum<["low", "medium", "high", "critical"]>>;
    is_active: z.ZodOptional<z.ZodEffects<z.ZodString, boolean, string>>;
}, "strip", z.ZodTypeAny, {
    type?: "velocity" | "amount_anomaly" | "geo_mismatch" | "time_anomaly" | "round_amount" | undefined;
    severity?: "low" | "medium" | "high" | "critical" | undefined;
    is_active?: boolean | undefined;
}, {
    type?: "velocity" | "amount_anomaly" | "geo_mismatch" | "time_anomaly" | "round_amount" | undefined;
    severity?: "low" | "medium" | "high" | "critical" | undefined;
    is_active?: string | undefined;
}>;
export type CreateRuleInput = z.infer<typeof createRuleSchema>;
export type UpdateRuleInput = z.infer<typeof updateRuleSchema>;
export type ToggleRuleInput = z.infer<typeof toggleRuleSchema>;
export type ListRulesQuery = z.infer<typeof listRulesQuerySchema>;
//# sourceMappingURL=rules.schema.d.ts.map