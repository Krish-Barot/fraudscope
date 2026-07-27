"use strict";
// apps/api/tests/alerts.test.ts
// Integration tests for alert generation
// These test the full flow: transaction flagged → alert created in DB
//
// Unlike the engine unit tests (which mock Redis and DB),
// these are true integration tests against a real test database.
// They verify that the PostgreSQL transaction atomicity works correctly.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const testSetup_1 = require("./helpers/testSetup");
// We test generateAlert indirectly through evaluateAndProcess
// by controlling what the rules return via seeded data
const scorer_1 = require("../src/engine/scorer");
let db;
beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    db = (0, testSetup_1.createTestDb)();
    await (0, testSetup_1.runMigrations)(db);
});
beforeEach(async () => {
    await (0, testSetup_1.clearDatabase)(db);
});
afterAll(async () => {
    await (0, testSetup_1.closeConnections)(db);
});
// ─────────────────────────────────────────
// scoreToSeverity tests (pure function)
// ─────────────────────────────────────────
describe('scoreToSeverity', () => {
    test('returns null for score below 20', () => {
        expect((0, scorer_1.scoreToSeverity)(0)).toBeNull();
        expect((0, scorer_1.scoreToSeverity)(19)).toBeNull();
    });
    test('returns low for score 20-39', () => {
        expect((0, scorer_1.scoreToSeverity)(20)).toBe('low');
        expect((0, scorer_1.scoreToSeverity)(39)).toBe('low');
    });
    test('returns medium for score 40-59', () => {
        expect((0, scorer_1.scoreToSeverity)(40)).toBe('medium');
        expect((0, scorer_1.scoreToSeverity)(59)).toBe('medium');
    });
    test('returns high for score 60-79', () => {
        expect((0, scorer_1.scoreToSeverity)(60)).toBe('high');
        expect((0, scorer_1.scoreToSeverity)(79)).toBe('high');
    });
    test('returns critical for score 80-100', () => {
        expect((0, scorer_1.scoreToSeverity)(80)).toBe('critical');
        expect((0, scorer_1.scoreToSeverity)(100)).toBe('critical');
    });
});
// ─────────────────────────────────────────
// evaluate() pure function tests
// Uses real test DB with seeded rules
// ─────────────────────────────────────────
describe('evaluate — pure scoring', () => {
    test('returns score 0 when no active rules exist', async () => {
        // No rules seeded — empty rules table
        const transaction = {
            id: 'test-id',
            external_id: 'TEST-001',
            account_id: 'ACC-001',
            amount: 5000,
            currency: 'CAD',
            country_code: 'CA',
            channel: 'online',
            created_at: new Date().toISOString(),
        };
        const result = await (0, scorer_1.evaluate)(transaction);
        expect(result.score).toBe(0);
        expect(result.severity).toBeNull();
        expect(result.triggeredRules).toHaveLength(0);
    });
    test('returns score 0 when rules exist but none trigger', async () => {
        // Seed a round_amount rule with high min_amount
        // Transaction amount of $50 won't trigger it
        await db('rules').insert({
            name: 'High Round Amount',
            type: 'round_amount',
            parameters: JSON.stringify({ min_amount: 10000, tolerance: 0 }),
            severity: 'high',
            score_weight: 25,
            is_active: true,
        });
        // Force cache refresh
        const { invalidateRuleCache } = await Promise.resolve().then(() => __importStar(require('../src/engine/scorer')));
        invalidateRuleCache();
        const transaction = {
            id: 'test-id-2',
            external_id: 'TEST-002',
            account_id: 'ACC-002',
            amount: 50, // way below min_amount of 10000
            currency: 'CAD',
            country_code: 'CA',
            channel: 'pos',
            created_at: new Date().toISOString(),
        };
        const result = await (0, scorer_1.evaluate)(transaction);
        expect(result.score).toBe(0);
        expect(result.triggeredRules).toHaveLength(0);
    });
    test('round_amount rule triggers and contributes to score', async () => {
        await db('rules').insert({
            name: 'Round Amount Test',
            type: 'round_amount',
            parameters: JSON.stringify({ min_amount: 1000, tolerance: 0 }),
            severity: 'high',
            score_weight: 25,
            is_active: true,
        });
        const { invalidateRuleCache } = await Promise.resolve().then(() => __importStar(require('../src/engine/scorer')));
        invalidateRuleCache();
        const transaction = {
            id: 'test-id-3',
            external_id: 'TEST-003',
            account_id: 'ACC-003',
            amount: 5000, // exact multiple of 100, above min_amount
            currency: 'CAD',
            country_code: 'CA',
            channel: 'online',
            created_at: new Date().toISOString(),
        };
        const result = await (0, scorer_1.evaluate)(transaction);
        expect(result.score).toBeGreaterThan(0);
        expect(result.triggeredRules).toHaveLength(1);
        expect(result.triggeredRules[0].ruleType).toBe('round_amount');
    });
    test('composite score is capped at 100', async () => {
        // Insert multiple rules that would each contribute high scores
        await db('rules').insert([
            {
                name: 'Round Amount High',
                type: 'round_amount',
                parameters: JSON.stringify({ min_amount: 1000, tolerance: 0 }),
                severity: 'critical',
                score_weight: 40,
                is_active: true,
            },
            {
                name: 'Round Amount High 2',
                type: 'round_amount',
                parameters: JSON.stringify({ min_amount: 1000, tolerance: 0 }),
                severity: 'critical',
                score_weight: 40,
                is_active: true,
            },
            {
                name: 'Round Amount High 3',
                type: 'round_amount',
                parameters: JSON.stringify({ min_amount: 1000, tolerance: 0 }),
                severity: 'critical',
                score_weight: 40,
                is_active: true,
            },
        ]);
        const { invalidateRuleCache } = await Promise.resolve().then(() => __importStar(require('../src/engine/scorer')));
        invalidateRuleCache();
        const transaction = {
            id: 'test-id-cap',
            external_id: 'TEST-CAP',
            account_id: 'ACC-CAP',
            amount: 10000,
            currency: 'CAD',
            country_code: 'CA',
            channel: 'online',
            created_at: new Date().toISOString(),
        };
        const result = await (0, scorer_1.evaluate)(transaction);
        // Score must never exceed 100
        expect(result.score).toBeLessThanOrEqual(100);
    });
});
// ─────────────────────────────────────────
// evaluateAndProcess — DB write tests
// ─────────────────────────────────────────
describe('evaluateAndProcess — alert generation', () => {
    async function seedRoundAmountRule(minAmount = 1000) {
        await db('rules').insert({
            name: 'Round Amount',
            type: 'round_amount',
            parameters: JSON.stringify({ min_amount: minAmount, tolerance: 0 }),
            severity: 'high',
            score_weight: 25,
            is_active: true,
        });
        const { invalidateRuleCache } = await Promise.resolve().then(() => __importStar(require('../src/engine/scorer')));
        invalidateRuleCache();
    }
    async function seedTransaction(amount, status = 'clean') {
        const [tx] = await db('transactions').insert({
            external_id: `TEST-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            account_id: 'ACC-0001',
            amount,
            currency: 'CAD',
            country_code: 'CA',
            status,
        }).returning('*');
        return tx;
    }
    test('creates alert when score >= 20', async () => {
        await seedRoundAmountRule();
        const tx = await seedTransaction(5000); // triggers round_amount
        const result = await (0, scorer_1.evaluateAndProcess)({
            id: tx.id,
            external_id: tx.external_id,
            account_id: tx.account_id,
            amount: parseFloat(tx.amount),
            currency: tx.currency,
            country_code: tx.country_code,
            channel: tx.channel || 'online',
            created_at: tx.created_at.toISOString(),
        });
        expect(result.alertId).not.toBeNull();
        expect(result.score).toBeGreaterThanOrEqual(20);
        // Verify alert was written to DB
        const alert = await db('alerts').where({ id: result.alertId }).first();
        expect(alert).toBeDefined();
        expect(alert.risk_score).toBe(result.score);
        expect(alert.status).toBe('new');
    });
    test('updates transaction status to flagged when alert is created', async () => {
        await seedRoundAmountRule();
        const tx = await seedTransaction(5000);
        await (0, scorer_1.evaluateAndProcess)({
            id: tx.id,
            external_id: tx.external_id,
            account_id: tx.account_id,
            amount: parseFloat(tx.amount),
            currency: tx.currency,
            country_code: tx.country_code,
            channel: 'online',
            created_at: new Date().toISOString(),
        });
        const updated = await db('transactions').where({ id: tx.id }).first();
        expect(updated.status).toBe('flagged');
        expect(updated.processed_at).not.toBeNull();
    });
    test('inserts alert_rules rows for each triggered rule', async () => {
        await seedRoundAmountRule();
        const tx = await seedTransaction(5000);
        const result = await (0, scorer_1.evaluateAndProcess)({
            id: tx.id,
            external_id: tx.external_id,
            account_id: tx.account_id,
            amount: parseFloat(tx.amount),
            currency: tx.currency,
            country_code: tx.country_code,
            channel: 'online',
            created_at: new Date().toISOString(),
        });
        const alertRules = await db('alert_rules')
            .where({ alert_id: result.alertId });
        expect(alertRules.length).toBeGreaterThan(0);
        expect(alertRules[0].score_contribution).toBeGreaterThan(0);
        // details should be valid JSON with rule_type
        const details = typeof alertRules[0].details === 'string'
            ? JSON.parse(alertRules[0].details)
            : alertRules[0].details;
        expect(details.rule_type).toBe('round_amount');
    });
    test('writes audit_log entry with event alert.generated', async () => {
        await seedRoundAmountRule();
        const tx = await seedTransaction(5000);
        await (0, scorer_1.evaluateAndProcess)({
            id: tx.id,
            external_id: tx.external_id,
            account_id: tx.account_id,
            amount: parseFloat(tx.amount),
            currency: tx.currency,
            country_code: tx.country_code,
            channel: 'online',
            created_at: new Date().toISOString(),
        });
        const auditLog = await db('audit_logs')
            .where({
            event_type: 'alert.generated',
            target_id: tx.id,
        })
            .first();
        expect(auditLog).toBeDefined();
        expect(auditLog.actor_type).toBe('system');
        expect(auditLog.source).toBe('engine');
    });
    test('does NOT create alert when score < 20', async () => {
        // Rule with very high min_amount — will not trigger for $50 transaction
        await seedRoundAmountRule(100000);
        const tx = await seedTransaction(50);
        const result = await (0, scorer_1.evaluateAndProcess)({
            id: tx.id,
            external_id: tx.external_id,
            account_id: tx.account_id,
            amount: parseFloat(tx.amount),
            currency: tx.currency,
            country_code: tx.country_code,
            channel: 'pos',
            created_at: new Date().toISOString(),
        });
        expect(result.alertId).toBeNull();
        expect(result.score).toBe(0);
        // No alert in DB
        const alerts = await db('alerts').where({ transaction_id: tx.id });
        expect(alerts).toHaveLength(0);
    });
    test('marks transaction processed_at when clean', async () => {
        await seedRoundAmountRule(100000); // won't trigger for $50
        const tx = await seedTransaction(50);
        await (0, scorer_1.evaluateAndProcess)({
            id: tx.id,
            external_id: tx.external_id,
            account_id: tx.account_id,
            amount: parseFloat(tx.amount),
            currency: tx.currency,
            country_code: tx.country_code,
            channel: 'pos',
            created_at: new Date().toISOString(),
        });
        const updated = await db('transactions').where({ id: tx.id }).first();
        // Status stays clean
        expect(updated.status).toBe('clean');
        // But processed_at is set (so we know it was evaluated)
        expect(updated.processed_at).not.toBeNull();
    });
    test('alert and alert_rules are consistent — no partial writes', async () => {
        await seedRoundAmountRule();
        const tx = await seedTransaction(5000);
        const result = await (0, scorer_1.evaluateAndProcess)({
            id: tx.id,
            external_id: tx.external_id,
            account_id: tx.account_id,
            amount: parseFloat(tx.amount),
            currency: tx.currency,
            country_code: tx.country_code,
            channel: 'online',
            created_at: new Date().toISOString(),
        });
        // If an alert was created, alert_rules must also exist
        if (result.alertId) {
            const alertRules = await db('alert_rules')
                .where({ alert_id: result.alertId });
            expect(alertRules.length).toBeGreaterThan(0);
            // And the audit log must exist
            const auditLog = await db('audit_logs')
                .where({ event_type: 'alert.generated', target_id: tx.id })
                .first();
            expect(auditLog).toBeDefined();
        }
    });
});
//# sourceMappingURL=alerts.test.js.map