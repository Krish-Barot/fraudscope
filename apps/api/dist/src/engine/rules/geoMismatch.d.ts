import { z } from 'zod';
import { TransactionData, RuleContext, RuleResult } from './types';
export declare const parameterSchema: z.ZodObject<{
    lookback_count: z.ZodNumber;
    alert_on_new_country: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    lookback_count: number;
    alert_on_new_country: boolean;
}, {
    lookback_count: number;
    alert_on_new_country: boolean;
}>;
export type GeoMismatchParameters = z.infer<typeof parameterSchema>;
export declare function evaluate(transaction: TransactionData, parameters: Record<string, unknown>, context: RuleContext): Promise<RuleResult>;
//# sourceMappingURL=geoMismatch.d.ts.map