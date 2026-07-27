"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.connectDatabase = connectDatabase;
// apps/api/src/config/database.ts
// This file creates the Knex instance that the rest of the app uses
// to run queries. Import 'db' from here whenever you need to query.
const knex_1 = __importDefault(require("knex"));
const path_1 = __importDefault(require("path"));
// Use TEST_DATABASE_URL when running tests
// This is set automatically by Jest via the test environment
const connectionString = process.env.NODE_ENV === 'test'
    ? (process.env.TEST_DATABASE_URL || 'postgresql://fraudscope:fraudscope123@localhost:5433/fraudscope_test')
    : (process.env.DATABASE_URL || 'postgresql://fraudscope:fraudscope123@localhost:5432/fraudscope');
exports.db = (0, knex_1.default)({
    client: 'pg',
    connection: connectionString,
    migrations: {
        directory: path_1.default.resolve(__dirname, '../../migrations'),
        loadExtensions: ['.ts'],
    },
});
async function connectDatabase() {
    try {
        await exports.db.raw('SELECT 1');
        console.log('✅ Database connected');
    }
    catch (error) {
        console.error('❌ Database connection failed:', error);
        process.exit(1);
    }
}
//# sourceMappingURL=database.js.map