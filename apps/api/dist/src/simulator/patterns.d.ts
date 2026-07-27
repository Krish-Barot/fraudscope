export interface TransactionDraft {
    external_id: string;
    account_id: string;
    amount: number;
    currency: string;
    merchant_name: string;
    merchant_category: string;
    country_code: string;
    city?: string;
    ip_address?: string;
    latitude?: number;
    longitude?: number;
    channel: string;
    created_at?: Date;
}
export declare const HIGH_RISK_COUNTRIES: {
    code: string;
    city: string;
    lat: number;
    lng: number;
}[];
export declare function applyHighAmount(tx: TransactionDraft, accountMaxSpend: number): TransactionDraft;
export declare function applyForeignCountry(tx: TransactionDraft): TransactionDraft;
export declare function applyOddHour(tx: TransactionDraft): TransactionDraft;
export declare function applyRoundAmount(tx: TransactionDraft): TransactionDraft;
export declare function applyRapidFire(tx: TransactionDraft, count: number): TransactionDraft[];
export declare function randomInt(min: number, max: number): number;
//# sourceMappingURL=patterns.d.ts.map