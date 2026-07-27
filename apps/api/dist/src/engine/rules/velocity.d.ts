import { z } from 'zod';
import { TransactionData, RuleContext, RuleResult } from './types';
export declare const parameterSchema: z.ZodObject<{
    max_count: z.ZodNumber;
    window_minutes: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    max_count: number;
    window_minutes: number;
}, {
    max_count: number;
    window_minutes: number;
}>;
export type VelocityParameters = z.infer<typeof parameterSchema>;
export declare function evaluate(transaction: TransactionData, parameters: Record<string, unknown>, context: RuleContext): Promise<RuleResult>;
//# sourceMappingURL=velocity.d.ts.map