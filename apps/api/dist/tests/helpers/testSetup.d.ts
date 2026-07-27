import { Knex } from 'knex';
export declare function createTestDb(): Knex;
export declare function runMigrations(db: Knex): Promise<void>;
export declare function clearDatabase(db: Knex): Promise<void>;
export declare function closeConnections(db: Knex): Promise<void>;
//# sourceMappingURL=testSetup.d.ts.map