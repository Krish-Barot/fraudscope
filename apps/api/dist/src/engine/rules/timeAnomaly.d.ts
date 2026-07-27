import { z } from "zod";
import { TransactionData, RuleContext, RuleResult } from "./types";
export declare const parameterSchema: z.ZodObject<{
    suspicious_start_hour: z.ZodNumber;
    suspicious_end_hour: z.ZodNumber;
    timezone: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    suspicious_start_hour: number;
    suspicious_end_hour: number;
    timezone: string;
}, {
    suspicious_start_hour: number;
    suspicious_end_hour: number;
    timezone?: string | undefined;
}>;
export type TimeAnomalyParameters = z.infer<typeof parameterSchema>;
export declare function isHourInWindow(hour: number, startHour: number, endHour: number): boolean;
export declare function evaluate(transaction: TransactionData, parameters: Record<string, unknown>, _context: RuleContext): Promise<RuleResult>;
//# sourceMappingURL=timeAnomaly.d.ts.map