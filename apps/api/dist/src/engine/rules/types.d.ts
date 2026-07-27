import { z } from "zod";
import Redis from "ioredis";
import { Knex } from "knex";
export interface TransactionData {
    id: string;
    external_id: string;
    account_id: string;
    amount: number;
    currency: string;
    country_code: string;
    channel: string;
    created_at: string;
    merchant_name?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
    ip_address?: string;
}
export interface RuleContext {
    redis: Redis;
    db: Knex;
    severity: "low" | "medium" | "high" | "critical";
}
export interface RuleResult {
    triggered: boolean;
    score: number;
    details: Record<string, unknown>;
}
export interface RuleEvaluator {
    parameterSchema: z.ZodObject<any>;
    evaluate: (transaction: TransactionData, parameters: Record<string, unknown>, context: RuleContext) => Promise<RuleResult>;
}
export interface DbRule {
    id: string;
    name: string;
    type: string;
    parameters: Record<string, unknown>;
    severity: "low" | "medium" | "high" | "critical";
    score_weight: number;
    is_active: boolean;
}
export declare function severityToScore(severity: string): number;
//# sourceMappingURL=types.d.ts.map