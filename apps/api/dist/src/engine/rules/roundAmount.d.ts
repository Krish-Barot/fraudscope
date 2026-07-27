import { z } from 'zod';
import { TransactionData, RuleContext, RuleResult } from './types';
export declare const parameterSchema: z.ZodObject<{
    min_amount: z.ZodNumber;
    tolerance: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    min_amount: number;
    tolerance: number;
}, {
    min_amount: number;
    tolerance?: number | undefined;
}>;
export type RoundAmountParameters = z.infer<typeof parameterSchema>;
export declare function nearestRound(amount: number): number;
export declare function isRoundAmount(amount: number, tolerance: number): boolean;
export declare function getAmountScore(amount: number): number;
export declare function evaluate(transaction: TransactionData, parameters: Record<string, unknown>, _context: RuleContext): Promise<RuleResult>;
//# sourceMappingURL=roundAmount.d.ts.map