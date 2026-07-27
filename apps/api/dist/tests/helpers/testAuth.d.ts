import { Knex } from 'knex';
export declare const TEST_ADMIN_ID = "11111111-1111-4111-8111-111111111111";
export declare const TEST_ANALYST_ID = "22222222-2222-4222-8222-222222222222";
export interface TestAuthTokens {
    adminToken: string;
    analystToken: string;
}
export declare function seedTestUsersAndGenerateTokens(db: Knex): Promise<TestAuthTokens>;
//# sourceMappingURL=testAuth.d.ts.map