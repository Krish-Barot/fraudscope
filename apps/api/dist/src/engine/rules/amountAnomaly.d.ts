import { z } from "zod";
import { TransactionData, RuleContext, RuleResult } from "./types";
export declare const parameterSchema: z.ZodObject<{
    multiplier: z.ZodNumber;
    min_amount: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    min_amount: number;
    multiplier: number;
}, {
    min_amount: number;
    multiplier: number;
}>;
export type AmountAnomalyParameters = z.infer<typeof parameterSchema>;
export declare function evaluate(transaction: TransactionData, parameters: Record<string, unknown>, context: RuleContext): Promise<RuleResult>;
//# sourceMappingURL=amountAnomaly.d.ts.map