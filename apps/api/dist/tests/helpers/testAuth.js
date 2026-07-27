"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEST_ANALYST_ID = exports.TEST_ADMIN_ID = void 0;
exports.seedTestUsersAndGenerateTokens = seedTestUsersAndGenerateTokens;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
exports.TEST_ADMIN_ID = '11111111-1111-4111-8111-111111111111';
exports.TEST_ANALYST_ID = '22222222-2222-4222-8222-222222222222';
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev_access_secret_change_in_production';
async function seedTestUsersAndGenerateTokens(db) {
    await db('users').insert([
        {
            id: exports.TEST_ANALYST_ID,
            email: 'analyst@fraudscope.dev',
            password_hash: 'test_hash',
            first_name: 'Test',
            last_name: 'Analyst',
            role: 'analyst',
            is_active: true,
        },
        {
            id: exports.TEST_ADMIN_ID,
            email: 'admin@fraudscope.dev',
            password_hash: 'test_hash',
            first_name: 'Test',
            last_name: 'Admin',
            role: 'admin',
            is_active: true,
        },
    ]);
    const admin = await db('users')
        .where({ email: 'admin@fraudscope.dev' })
        .first();
    const analyst = await db('users')
        .where({ email: 'analyst@fraudscope.dev' })
        .first();
    if (!admin || !analyst) {
        throw new Error('Failed to seed test auth users');
    }
    return {
        adminToken: jsonwebtoken_1.default.sign({
            userId: admin.id,
            email: admin.email,
            role: admin.role,
        }, JWT_ACCESS_SECRET, { expiresIn: '1h' }),
        analystToken: jsonwebtoken_1.default.sign({
            userId: analyst.id,
            email: analyst.email,
            role: analyst.role,
        }, JWT_ACCESS_SECRET, { expiresIn: '1h' }),
    };
}
//# sourceMappingURL=testAuth.js.map