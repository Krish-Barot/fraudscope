"use strict";
// apps/api/tests/transactions.test.ts
// Integration tests for the transactions API
//
// These tests make real HTTP requests and hit a real database.
// Each test gets a clean database state (tables truncated in beforeEach).
//
// Test numbering matches the FS-07 ticket requirements:
// 1. Ingest valid tx -> 202
// 2. Ingest missing account_id -> 400
// 3. Ingest invalid country_code -> 400
// 4. Duplicate external_id -> 409
// 5. No API key -> 401
// 6. List with no filters -> 200 + pagination
// 7. List with status=flagged -> only flagged
// 8. Get by valid ID -> 200 + account_history
// 9. Get non-existent -> 404
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const testSetup_1 = require("./helpers/testSetup");
const testAuth_1 = require("./helpers/testAuth");
const testApp_1 = require("./helpers/testApp");
// ─────────────────────────────────────────
// Setup
// ─────────────────────────────────────────
const app = (0, testApp_1.createTestApp)();
let db;
// Valid API key — must match API_KEY env var
// In tests this is set via the test environment
const VALID_API_KEY = process.env.API_KEY || 'dev_api_key_fraudscope';
// A valid JWT token for analyst endpoints (GET requests)
// Generated with the same secret as the app uses
// We'll generate this dynamically in beforeAll
let ANALYST_TOKEN;
beforeAll(async () => {
    // Set TEST_DATABASE_URL so the app's database module picks it up
    process.env.NODE_ENV = 'test';
    db = (0, testSetup_1.createTestDb)();
    await (0, testSetup_1.runMigrations)(db);
    const tokens = await (0, testAuth_1.seedTestUsersAndGenerateTokens)(db);
    ANALYST_TOKEN = tokens.analystToken;
    console.log('✅ Test setup complete');
});
beforeEach(async () => {
    // Clear all data before each test
    // This ensures test 4 (duplicate external_id) doesn't fail
    // because test 1 already inserted the same ID
    await (0, testSetup_1.clearDatabase)(db);
});
afterAll(async () => {
    await (0, testSetup_1.closeConnections)(db);
});
// ─────────────────────────────────────────
// Helper: build a valid transaction payload
// Using a function means each test gets a fresh object
// and can override specific fields without affecting others
// ─────────────────────────────────────────
function validTransactionPayload(overrides = {}) {
    return {
        external_id: `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        account_id: 'ACC-0001',
        amount: 150.00,
        currency: 'CAD',
        merchant_name: 'Tim Hortons',
        country_code: 'CA',
        channel: 'pos',
        ...overrides, // caller can override any field
    };
}
// ─────────────────────────────────────────
// POST /api/v1/transactions tests
// ─────────────────────────────────────────
describe('POST /api/v1/transactions', () => {
    // Test 1 — happy path
    test('1. returns 202 and queued:true for a valid transaction', async () => {
        const payload = validTransactionPayload();
        const response = await (0, supertest_1.default)(app)
            .post('/api/v1/transactions')
            .set('x-api-key', VALID_API_KEY)
            .set('Content-Type', 'application/json')
            .send(payload);
        // Check status code
        expect(response.status).toBe(202);
        // Check response shape
        expect(response.body.queued).toBe(true);
        expect(response.body.transaction).toBeDefined();
        // Check the transaction data matches what we sent
        expect(response.body.transaction.external_id).toBe(payload.external_id);
        expect(response.body.transaction.account_id).toBe(payload.account_id);
        expect(parseFloat(response.body.transaction.amount)).toBe(payload.amount);
        expect(response.body.transaction.status).toBe('clean');
        // Check the transaction was actually saved to the database
        // If the API returned 202 but didn't save, this would fail
        const saved = await db('transactions')
            .where({ external_id: payload.external_id })
            .first();
        expect(saved).toBeDefined();
        expect(saved.account_id).toBe('ACC-0001');
    });
    // Test 2 — missing required field
    test('2. returns 400 when account_id is missing', async () => {
        const payload = validTransactionPayload();
        // Remove account_id — it's required by the Zod schema
        // TypeScript wouldn't let us do this with a typed variable,
        // so we use delete on the cast object
        const { account_id, ...payloadWithoutAccountId } = payload;
        const response = await (0, supertest_1.default)(app)
            .post('/api/v1/transactions')
            .set('x-api-key', VALID_API_KEY)
            .send(payloadWithoutAccountId);
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
        // The error details should mention which field failed
        expect(response.body.error.details).toBeDefined();
        const failedField = response.body.error.details.find((d) => d.field === 'account_id');
        expect(failedField).toBeDefined();
    });
    // Test 3 — invalid field value
    test('3. returns 400 when country_code is not a valid ISO code', async () => {
        const payload = validTransactionPayload({
            country_code: 'INVALID', // must be 2 uppercase letters
        });
        const response = await (0, supertest_1.default)(app)
            .post('/api/v1/transactions')
            .set('x-api-key', VALID_API_KEY)
            .send(payload);
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
        // Check the specific field that failed
        const failedField = response.body.error.details.find((d) => d.field === 'country_code');
        expect(failedField).toBeDefined();
        expect(failedField.message).toContain('ISO');
    });
    // Test 4 — duplicate detection
    test('4. returns 409 when external_id already exists', async () => {
        const payload = validTransactionPayload({
            external_id: 'FIXED-ID-FOR-DUPLICATE-TEST',
        });
        // First request — should succeed
        const firstResponse = await (0, supertest_1.default)(app)
            .post('/api/v1/transactions')
            .set('x-api-key', VALID_API_KEY)
            .send(payload);
        expect(firstResponse.status).toBe(202);
        // Second request with SAME external_id — should conflict
        const secondResponse = await (0, supertest_1.default)(app)
            .post('/api/v1/transactions')
            .set('x-api-key', VALID_API_KEY)
            .send(payload);
        expect(secondResponse.status).toBe(409);
        expect(secondResponse.body.error.code).toBe('CONFLICT');
        expect(secondResponse.body.error.message).toContain('FIXED-ID-FOR-DUPLICATE-TEST');
    });
    // Test 5 — missing authentication
    test('5. returns 401 when x-api-key header is missing', async () => {
        const payload = validTransactionPayload();
        // No .set('x-api-key', ...) — deliberately omitting auth
        const response = await (0, supertest_1.default)(app)
            .post('/api/v1/transactions')
            .send(payload);
        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe('UNAUTHORIZED');
        expect(response.body.error.message).toContain('x-api-key');
    });
    // Bonus test — wrong API key should also be 401
    test('5b. returns 401 when x-api-key is wrong', async () => {
        const payload = validTransactionPayload();
        const response = await (0, supertest_1.default)(app)
            .post('/api/v1/transactions')
            .set('x-api-key', 'completely-wrong-key')
            .send(payload);
        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe('UNAUTHORIZED');
    });
});
// ─────────────────────────────────────────
// GET /api/v1/transactions tests
// ─────────────────────────────────────────
describe('GET /api/v1/transactions', () => {
    // Helper: insert transactions directly into the test DB
    // This is faster than making HTTP requests for setup data
    // and doesn't depend on the POST endpoint being correct
    async function insertTransaction(overrides = {}) {
        const [tx] = await db('transactions').insert({
            external_id: `SEED-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            account_id: 'ACC-0001',
            amount: 100.00,
            currency: 'CAD',
            country_code: 'CA',
            status: 'clean',
            ...overrides,
        }).returning('*');
        return tx;
    }
    // Test 6 — basic list with pagination
    test('6. returns 200 with data array and pagination object when no filters applied', async () => {
        // Insert 5 known transactions so we have something to list
        await insertTransaction({ account_id: 'ACC-0001' });
        await insertTransaction({ account_id: 'ACC-0002' });
        await insertTransaction({ account_id: 'ACC-0003' });
        await insertTransaction({ account_id: 'ACC-0004' });
        await insertTransaction({ account_id: 'ACC-0005' });
        const response = await (0, supertest_1.default)(app)
            .get('/api/v1/transactions')
            .set('Authorization', `Bearer ${ANALYST_TOKEN}`);
        expect(response.status).toBe(200);
        // Response must have both data and pagination
        expect(response.body.data).toBeDefined();
        expect(Array.isArray(response.body.data)).toBe(true);
        expect(response.body.data.length).toBe(5);
        // Pagination object must have all 4 fields
        expect(response.body.pagination).toBeDefined();
        expect(response.body.pagination.page).toBe(1);
        expect(response.body.pagination.limit).toBe(25);
        expect(response.body.pagination.total).toBe(5);
        expect(response.body.pagination.pages).toBe(1); // ceil(5/25) = 1
    });
    // Test pagination math with limit
    test('6b. pagination calculates pages correctly', async () => {
        // Insert 10 transactions
        for (let i = 0; i < 10; i++) {
            await insertTransaction({ account_id: `ACC-00${String(i).padStart(2, '0')}` });
        }
        // Request with limit=3 — should give pages=4 (ceil(10/3))
        const response = await (0, supertest_1.default)(app)
            .get('/api/v1/transactions?limit=3&page=1')
            .set('Authorization', `Bearer ${ANALYST_TOKEN}`);
        expect(response.status).toBe(200);
        expect(response.body.data.length).toBe(3);
        expect(response.body.pagination.total).toBe(10);
        expect(response.body.pagination.pages).toBe(4); // ceil(10/3) = 4
        expect(response.body.pagination.limit).toBe(3);
    });
    // Test 7 — filtering by status
    test('7. returns only flagged transactions when status=flagged filter is applied', async () => {
        // Insert a mix: 3 clean, 2 flagged
        await insertTransaction({ status: 'clean' });
        await insertTransaction({ status: 'clean' });
        await insertTransaction({ status: 'clean' });
        await insertTransaction({ status: 'flagged' });
        await insertTransaction({ status: 'flagged' });
        const response = await (0, supertest_1.default)(app)
            .get('/api/v1/transactions?status=flagged')
            .set('Authorization', `Bearer ${ANALYST_TOKEN}`);
        expect(response.status).toBe(200);
        // Only the 2 flagged ones should appear
        expect(response.body.data.length).toBe(2);
        expect(response.body.pagination.total).toBe(2);
        // Every returned transaction must have status=flagged
        // This verifies the filter actually works, not just that count is right
        response.body.data.forEach((tx) => {
            expect(tx.status).toBe('flagged');
        });
    });
    // GET without auth should fail
    test('7b. returns 401 when Authorization header is missing', async () => {
        const response = await (0, supertest_1.default)(app)
            .get('/api/v1/transactions');
        // No Authorization header
        expect(response.status).toBe(401);
    });
});
// ─────────────────────────────────────────
// GET /api/v1/transactions/:id tests
// ─────────────────────────────────────────
describe('GET /api/v1/transactions/:id', () => {
    async function insertTransaction(overrides = {}) {
        const [tx] = await db('transactions').insert({
            external_id: `SEED-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            account_id: 'ACC-0001',
            amount: 100.00,
            currency: 'CAD',
            country_code: 'CA',
            status: 'clean',
            ...overrides,
        }).returning('*');
        return tx;
    }
    // Test 8 — get by valid ID with enriched response
    test('8. returns 200 with transaction, alerts array, and account_history for valid ID', async () => {
        // Insert the target transaction
        const target = await insertTransaction({
            account_id: 'ACC-TEST-01',
            amount: 250.00,
        });
        // Insert 3 more transactions for the same account
        // These should appear in account_history
        await insertTransaction({ account_id: 'ACC-TEST-01', amount: 50.00 });
        await insertTransaction({ account_id: 'ACC-TEST-01', amount: 75.00 });
        await insertTransaction({ account_id: 'ACC-TEST-01', amount: 30.00 });
        // Insert 2 transactions for a DIFFERENT account
        // These should NOT appear in account_history
        await insertTransaction({ account_id: 'ACC-OTHER', amount: 999.00 });
        await insertTransaction({ account_id: 'ACC-OTHER', amount: 888.00 });
        const response = await (0, supertest_1.default)(app)
            .get(`/api/v1/transactions/${target.id}`)
            .set('Authorization', `Bearer ${ANALYST_TOKEN}`);
        expect(response.status).toBe(200);
        // Check the transaction itself
        expect(response.body.id).toBe(target.id);
        expect(response.body.account_id).toBe('ACC-TEST-01');
        expect(parseFloat(response.body.amount)).toBe(250.00);
        // Alerts array must exist (empty since no rule engine has run)
        expect(response.body.alerts).toBeDefined();
        expect(Array.isArray(response.body.alerts)).toBe(true);
        expect(response.body.alerts.length).toBe(0);
        // Account history must exist and only contain the same account's transactions
        expect(response.body.account_history).toBeDefined();
        expect(Array.isArray(response.body.account_history)).toBe(true);
        // 3 other transactions for ACC-TEST-01 (the target itself is excluded)
        expect(response.body.account_history.length).toBe(3);
        // All history items must belong to the same account
        response.body.account_history.forEach((tx) => {
            expect(tx.account_id).toBe('ACC-TEST-01');
        });
        // The target transaction itself should NOT appear in account_history
        const targetInHistory = response.body.account_history.find((tx) => tx.id === target.id);
        expect(targetInHistory).toBeUndefined();
    });
    // Test 8b — account history capped at 10
    test('8b. account_history returns maximum 10 transactions', async () => {
        // Insert 15 transactions for the same account
        for (let i = 0; i < 15; i++) {
            await insertTransaction({
                account_id: 'ACC-HISTORY-TEST',
                amount: (i + 1) * 10,
            });
        }
        // Get the first one (any will do)
        const all = await db('transactions')
            .where({ account_id: 'ACC-HISTORY-TEST' })
            .orderBy('created_at', 'asc')
            .limit(1);
        const response = await (0, supertest_1.default)(app)
            .get(`/api/v1/transactions/${all[0].id}`)
            .set('Authorization', `Bearer ${ANALYST_TOKEN}`);
        expect(response.status).toBe(200);
        // Even with 15 transactions in the account, history should cap at 10
        // (the target is excluded, 14 remain, but we return max 10)
        expect(response.body.account_history.length).toBeLessThanOrEqual(10);
    });
    // Test 9 — not found
    test('9. returns 404 for a transaction ID that does not exist', async () => {
        // This UUID is valid format but doesn't exist in the database
        const nonExistentId = '00000000-0000-0000-0000-000000000000';
        const response = await (0, supertest_1.default)(app)
            .get(`/api/v1/transactions/${nonExistentId}`)
            .set('Authorization', `Bearer ${ANALYST_TOKEN}`);
        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('NOT_FOUND');
        expect(response.body.error.message).toContain(nonExistentId);
    });
});
//# sourceMappingURL=transactions.test.js.map