export interface AccountProfile {
    id: string;
    homeCountry: string;
    city: string;
    latitude: number;
    longitude: number;
    currency: string;
    minSpend: number;
    maxSpend: number;
    tier: 'low' | 'medium' | 'high' | 'premium';
}
export declare function generateAccounts(): AccountProfile[];
//# sourceMappingURL=accounts.d.ts.map