import { TransactionData } from "./rules/types";
export declare function invalidateRuleCache(): void;
export declare function scoreToSeverity(score: number): string | null;
export interface TriggeredRule {
    ruleId: string;
    ruleName: string;
    ruleType: string;
    scoreContribution: number;
    details: Record<string, unknown>;
}
export interface ScorerResult {
    score: number;
    severity: string | null;
    triggeredRules: TriggeredRule[];
}
export declare function evaluate(transaction: TransactionData): Promise<ScorerResult>;
export interface ProcessResult {
    score: number;
    severity: string | null;
    alertId: string | null;
    triggeredRules: TriggeredRule[];
}
export declare function evaluateAndProcess(transaction: TransactionData): Promise<ProcessResult>;
//# sourceMappingURL=scorer.d.ts.map