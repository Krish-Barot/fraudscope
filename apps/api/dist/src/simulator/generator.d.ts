import { AccountProfile } from './accounts';
import { TransactionDraft } from './patterns';
export interface GeneratedTransaction {
    drafts: TransactionDraft[];
    type: 'NORMAL' | 'SUSPICIOUS';
    patterns: string[];
}
export declare function generateNormal(account: AccountProfile): GeneratedTransaction;
export declare function generateSuspicious(account: AccountProfile, fraudRatio: number): GeneratedTransaction;
//# sourceMappingURL=generator.d.ts.map