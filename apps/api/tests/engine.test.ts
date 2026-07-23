// apps/api/tests/engine.test.ts
// Unit tests for the rule engine
//
// UNIT vs INTEGRATION:
// These are unit tests — they mock Redis and PostgreSQL.
// We don't need real databases because we're testing the LOGIC of the rules,
// not the connection to external services.
//
// Mock Redis lets us control exactly what INCR returns,
// so we can test "what happens on the 6th transaction" precisely
// without needing to send 6 real transactions.

import { evaluate, parameterSchema } from '../src/engine/rules/velocity';
import { TransactionData, RuleContext } from '../src/engine/rules/types';

// ─────────────────────────────────────────
// Mock Redis client
// We create a minimal mock that only implements the methods
// the velocity rule actually uses: INCR and EXPIRE
// ─────────────────────────────────────────
function createMockRedis(incrReturnValue: number) {
  return {
    // incr() returns the value we control in the test
    // This simulates "this is the Nth transaction for this account"
    incr: jest.fn().mockResolvedValue(incrReturnValue),

    // expire() is called only when count === 1
    // We mock it but usually just verify it was/wasn't called
    expire: jest.fn().mockResolvedValue(1),
  };
}

// Mock DB client — velocity rule doesn't use DB, but context requires it
const mockDb = {} as any;

// Standard transaction used in all tests
// Only account_id matters for the velocity rule
function makeTransaction(overrides: Partial<TransactionData> = {}): TransactionData {
  return {
    id: 'test-tx-id',
    external_id: 'TEST-001',
    account_id: 'ACC-TEST-01',
    amount: 150.00,
    currency: 'CAD',
    country_code: 'CA',
    channel: 'pos',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// Standard parameters — max 5 transactions per 10 minutes
const defaultParams = {
  max_count: 5,
  window_minutes: 10,
};

// Standard context
function makeContext(redisIncrValue: number): RuleContext {
  return {
    redis: createMockRedis(redisIncrValue) as any,
    db: mockDb,
    severity: 'high', // score should be 25 for high severity
  };
}

// ─────────────────────────────────────────
// Parameter schema tests
// ─────────────────────────────────────────
describe('velocity rule — parameterSchema', () => {
  test('accepts valid parameters', () => {
    expect(() => parameterSchema.parse({ max_count: 5, window_minutes: 10 }))
      .not.toThrow();
  });

  test('rejects max_count below 1', () => {
    expect(() => parameterSchema.parse({ max_count: 0, window_minutes: 10 }))
      .toThrow();
  });

  test('rejects max_count above 100', () => {
    expect(() => parameterSchema.parse({ max_count: 101, window_minutes: 10 }))
      .toThrow();
  });

  test('rejects window_minutes below 1', () => {
    expect(() => parameterSchema.parse({ max_count: 5, window_minutes: 0 }))
      .toThrow();
  });

  test('rejects window_minutes above 1440', () => {
    expect(() => parameterSchema.parse({ max_count: 5, window_minutes: 1441 }))
      .toThrow();
  });

  test('rejects non-integer max_count', () => {
    expect(() => parameterSchema.parse({ max_count: 5.5, window_minutes: 10 }))
      .toThrow();
  });
});

// ─────────────────────────────────────────
// Core trigger logic — the two tests specified in FS-11
// ─────────────────────────────────────────
describe('velocity rule — trigger logic', () => {

  // FS-11 required test: triggers on 6th transaction when max_count is 5
  test('triggers on the 6th transaction when max_count is 5', async () => {
    // Simulate Redis returning count=6 (this is the 6th transaction)
    const context = makeContext(6);
    const transaction = makeTransaction();

    const result = await evaluate(transaction, defaultParams, context);

    expect(result.triggered).toBe(true);
    expect(result.score).toBe(25); // high severity = 25 points
    expect(result.details.current_count).toBe(6);
    expect(result.details.threshold).toBe(5);
    expect(result.details.message).toBe(
      '6 transactions in 10 min — threshold is 5'
    );
  });

  // FS-11 required test: does NOT trigger on 5th transaction when max_count is 5
  test('does NOT trigger on the 5th transaction when max_count is 5', async () => {
    // Simulate Redis returning count=5 (exactly at the limit, not over)
    const context = makeContext(5);
    const transaction = makeTransaction();

    const result = await evaluate(transaction, defaultParams, context);

    expect(result.triggered).toBe(false);
    expect(result.score).toBe(0);
    expect(result.details.current_count).toBe(5);
    expect(result.details.message).toBeNull();
  });

  test('does NOT trigger on the 1st transaction', async () => {
    const context = makeContext(1);
    const result = await evaluate(makeTransaction(), defaultParams, context);

    expect(result.triggered).toBe(false);
    expect(result.score).toBe(0);
  });

  test('triggers on the 2nd transaction when max_count is 1', async () => {
    const context = makeContext(2);
    const result = await evaluate(
      makeTransaction(),
      { max_count: 1, window_minutes: 10 },
      context
    );

    expect(result.triggered).toBe(true);
    expect(result.score).toBe(25);
  });
});

// ─────────────────────────────────────────
// Score based on severity
// ─────────────────────────────────────────
describe('velocity rule — severity scoring', () => {

  async function getScore(severity: 'low' | 'medium' | 'high' | 'critical') {
    const context: RuleContext = {
      redis: createMockRedis(6) as any, // count=6, triggers when max=5
      db: mockDb,
      severity,
    };
    const result = await evaluate(makeTransaction(), defaultParams, context);
    return result.score;
  }

  test('returns score 25 for high severity rule', async () => {
    expect(await getScore('high')).toBe(25);
  });

  test('returns score 20 for medium severity rule', async () => {
    expect(await getScore('medium')).toBe(20);
  });

  test('returns score 15 for low severity rule', async () => {
    expect(await getScore('low')).toBe(15);
  });

  test('returns score 30 for critical severity rule', async () => {
    expect(await getScore('critical')).toBe(30);
  });

  test('returns score 0 when rule does not trigger regardless of severity', async () => {
    const context: RuleContext = {
      redis: createMockRedis(3) as any, // count=3, does not trigger when max=5
      db: mockDb,
      severity: 'critical',
    };
    const result = await evaluate(makeTransaction(), defaultParams, context);
    expect(result.score).toBe(0);
  });
});

// ─────────────────────────────────────────
// Redis interaction behaviour
// ─────────────────────────────────────────
describe('velocity rule — Redis behaviour', () => {

  test('calls INCR with the correct key format', async () => {
    const context = makeContext(1);
    const transaction = makeTransaction({ account_id: 'ACC-0042' });

    await evaluate(transaction, defaultParams, context);

    // Verify the Redis key includes the account ID
    expect(context.redis.incr).toHaveBeenCalledWith('velocity:ACC-0042');
  });

  test('sets EXPIRE with correct TTL on first increment (count === 1)', async () => {
    const context = makeContext(1); // first transaction for this account
    await evaluate(makeTransaction(), defaultParams, context);

    // TTL should be window_minutes * 60 seconds
    expect(context.redis.expire).toHaveBeenCalledWith(
      'velocity:ACC-TEST-01',
      10 * 60  // 10 minutes = 600 seconds
    );
  });

  test('does NOT call EXPIRE when count > 1', async () => {
    // count=3 means this is not the first transaction — don't reset TTL
    const context = makeContext(3);
    await evaluate(makeTransaction(), defaultParams, context);

    expect(context.redis.expire).not.toHaveBeenCalled();
  });

  test('uses different Redis keys for different accounts', async () => {
    const context1 = makeContext(1);
    const context2 = makeContext(1);

    await evaluate(makeTransaction({ account_id: 'ACC-0001' }), defaultParams, context1);
    await evaluate(makeTransaction({ account_id: 'ACC-0002' }), defaultParams, context2);

    expect(context1.redis.incr).toHaveBeenCalledWith('velocity:ACC-0001');
    expect(context2.redis.incr).toHaveBeenCalledWith('velocity:ACC-0002');
  });
});

// ─────────────────────────────────────────
// Details object structure
// ─────────────────────────────────────────
describe('velocity rule — details object', () => {

  test('includes all required fields when triggered', async () => {
    const context = makeContext(6);
    const result = await evaluate(makeTransaction(), defaultParams, context);

    expect(result.details).toMatchObject({
      rule_type: 'velocity',
      current_count: 6,
      threshold: 5,
      window_minutes: 10,
      message: expect.stringContaining('6 transactions'),
    });
  });

  test('includes all required fields when not triggered', async () => {
    const context = makeContext(3);
    const result = await evaluate(makeTransaction(), defaultParams, context);

    expect(result.details).toMatchObject({
      rule_type: 'velocity',
      current_count: 3,
      threshold: 5,
      window_minutes: 10,
      message: null,
    });
  });

  test('message includes the count, window, and threshold', async () => {
    const context = makeContext(8);
    const result = await evaluate(
      makeTransaction(),
      { max_count: 5, window_minutes: 15 },
      context
    );

    expect(result.details.message).toBe(
      '8 transactions in 15 min — threshold is 5'
    );
  });
});

// ─────────────────────────────────────────
// Amount Anomaly Rule Tests
// ─────────────────────────────────────────

import {
  evaluate as evaluateAmountAnomaly,
  parameterSchema as amountAnomalySchema,
} from '../src/engine/rules/amountAnomaly';

// ─────────────────────────────────────────
// Mock helpers for amount anomaly
// ─────────────────────────────────────────

function createMockRedisForAmountAnomaly(cachedAverage: string | null) {
  return {
    // get() returns the cached average or null (cache miss)
    get: jest.fn().mockResolvedValue(cachedAverage),
    // set() stores the computed average — we verify it's called on cache miss
    set: jest.fn().mockResolvedValue('OK'),
  };
}

function createMockDb(averageAmount: number | null) {
  // Mocks the knex query chain: db('transactions').where(...).avg(...).first()
  // Each chained method returns an object with the next method
  const queryBuilder = {
    where: jest.fn().mockReturnThis(),
    whereNot: jest.fn().mockReturnThis(),
    avg: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue(
      averageAmount !== null ? { avg: averageAmount.toString() } : { avg: null }
    ),
  };

  // db('transactions') returns the query builder
  const mockDb = jest.fn().mockReturnValue(queryBuilder);
  // Also expose the queryBuilder so tests can inspect calls
  (mockDb as any)._queryBuilder = queryBuilder;
  (mockDb as any).raw = jest.fn().mockReturnValue('NOW() - INTERVAL \'30 days\'');

  return mockDb;
}

function makeAmountAnomalyContext(
  cachedAverage: string | null,
  dbAverage: number | null,
  severity: 'low' | 'medium' | 'high' | 'critical' = 'high'
): RuleContext {
  return {
    redis: createMockRedisForAmountAnomaly(cachedAverage) as any,
    db: createMockDb(dbAverage) as any,
    severity,
  };
}

function makeAmountAnomalyTransaction(amount: number): TransactionData {
  return {
    id: 'test-tx-id',
    external_id: 'TEST-AMOUNT-001',
    account_id: 'ACC-AMOUNT-01',
    amount,
    currency: 'CAD',
    country_code: 'CA',
    channel: 'online',
    created_at: new Date().toISOString(),
  };
}

const defaultAmountParams = {
  multiplier: 3.0,
  min_amount: 100,
};

// ─────────────────────────────────────────
// Parameter schema
// ─────────────────────────────────────────
describe('amount_anomaly rule — parameterSchema', () => {
  test('accepts valid parameters', () => {
    expect(() =>
      amountAnomalySchema.parse({ multiplier: 3.0, min_amount: 500 })
    ).not.toThrow();
  });

  test('rejects multiplier below 1.5', () => {
    expect(() =>
      amountAnomalySchema.parse({ multiplier: 1.4, min_amount: 500 })
    ).toThrow();
  });

  test('rejects multiplier above 20', () => {
    expect(() =>
      amountAnomalySchema.parse({ multiplier: 21, min_amount: 500 })
    ).toThrow();
  });

  test('rejects negative min_amount', () => {
    expect(() =>
      amountAnomalySchema.parse({ multiplier: 3.0, min_amount: -1 })
    ).toThrow();
  });
});

// ─────────────────────────────────────────
// Core trigger logic — FS-12 required tests
// ─────────────────────────────────────────
describe('amount_anomaly rule — trigger logic', () => {

  // FS-12 required test: triggers at 4x average
  test('triggers when amount is 4x the 30-day average', async () => {
    // Account average: $100. Amount: $400 (4x). Multiplier: 3x threshold.
    // $400 > ($100 * 3.0 = $300) AND $400 > min_amount($100) → triggers
    const context = makeAmountAnomalyContext(null, 100); // cache miss, DB returns $100 avg
    const transaction = makeAmountAnomalyTransaction(400);

    const result = await evaluateAmountAnomaly(
      transaction,
      defaultAmountParams,
      context
    );

    expect(result.triggered).toBe(true);
    expect(result.score).toBe(25); // high severity
    expect(result.details.account_avg).toBe(100);
    expect(result.details.threshold_amount).toBe(300);
    expect(result.details.ratio).toBe(4);
    expect(result.details.message).toContain('4.0x');
  });

  // FS-12 required test: does not trigger below threshold
  test('does NOT trigger when amount is below the threshold', async () => {
    // Account average: $100. Amount: $250. Threshold: $300 (3x).
    // $250 < $300 → does not trigger
    const context = makeAmountAnomalyContext(null, 100);
    const transaction = makeAmountAnomalyTransaction(250);

    const result = await evaluateAmountAnomaly(
      transaction,
      defaultAmountParams,
      context
    );

    expect(result.triggered).toBe(false);
    expect(result.score).toBe(0);
    expect(result.details.message).toBeNull();
  });

  // Edge case: exactly at the threshold — should NOT trigger (amount must be GREATER than)
  test('does NOT trigger when amount exactly equals the threshold', async () => {
    // avg=$100, multiplier=3.0, threshold=$300, amount=$300 → NOT triggered (not >)
    const context = makeAmountAnomalyContext(null, 100);
    const transaction = makeAmountAnomalyTransaction(300);

    const result = await evaluateAmountAnomaly(
      transaction,
      defaultAmountParams,
      context
    );

    expect(result.triggered).toBe(false);
    expect(result.score).toBe(0);
  });

  // Just over threshold — should trigger
  test('triggers when amount is just above the threshold', async () => {
    // avg=$100, threshold=$300, amount=$300.01 → triggers
    const context = makeAmountAnomalyContext(null, 100);
    const transaction = makeAmountAnomalyTransaction(300.01);

    const result = await evaluateAmountAnomaly(
      transaction,
      defaultAmountParams,
      context
    );

    expect(result.triggered).toBe(true);
  });

  // Skip when below min_amount
  test('skips rule when transaction is below min_amount', async () => {
    // Amount $50 is below min_amount of $100 — skip entirely
    const context = makeAmountAnomalyContext(null, 20); // avg $20
    const transaction = makeAmountAnomalyTransaction(50);

    const result = await evaluateAmountAnomaly(
      transaction,
      defaultAmountParams, // min_amount: 100
      context
    );

    expect(result.triggered).toBe(false);
    expect(result.score).toBe(0);
    expect(result.details.skipped).toBe('below_min_amount');
  });

  // Skip when no account history
  test('skips rule when account has no 30-day history', async () => {
    // Cache miss AND database returns null average (new account)
    const context = makeAmountAnomalyContext(null, null);
    const transaction = makeAmountAnomalyTransaction(500);

    const result = await evaluateAmountAnomaly(
      transaction,
      defaultAmountParams,
      context
    );

    expect(result.triggered).toBe(false);
    expect(result.score).toBe(0);
    expect(result.details.skipped).toBe('no_account_history');
  });
});

// ─────────────────────────────────────────
// Cache behaviour
// ─────────────────────────────────────────
describe('amount_anomaly rule — cache behaviour', () => {

  test('uses cached average when Redis cache is populated (cache HIT)', async () => {
    // Redis returns cached average of $100
    const context = makeAmountAnomalyContext('100', null);
    const transaction = makeAmountAnomalyTransaction(400);

    const result = await evaluateAmountAnomaly(
      transaction,
      defaultAmountParams,
      context
    );

    // Should trigger based on cached average ($100), not DB
    expect(result.triggered).toBe(true);
    expect(result.details.cache_hit).toBe(true);

    // DB should NOT have been queried — cache was sufficient
    const db = context.db as any;
    expect(db).not.toHaveBeenCalled();
  });

  test('queries PostgreSQL on cache MISS and stores result in Redis', async () => {
    // Cache miss (null), DB returns $100 average
    const context = makeAmountAnomalyContext(null, 100);
    const transaction = makeAmountAnomalyTransaction(400);

    await evaluateAmountAnomaly(transaction, defaultAmountParams, context);

    // DB should have been queried
    expect(context.db).toHaveBeenCalledWith('transactions');

    // Redis set() should have been called to cache the result
    expect(context.redis.set).toHaveBeenCalledWith(
      `avg:${transaction.account_id}`,
      '100',
      'EX',
      3600  // 1 hour TTL
    );
  });

  test('does NOT call Redis set() on cache HIT', async () => {
    // Average already cached — no need to write to Redis again
    const context = makeAmountAnomalyContext('100', null);
    const transaction = makeAmountAnomalyTransaction(400);

    await evaluateAmountAnomaly(transaction, defaultAmountParams, context);

    expect(context.redis.set).not.toHaveBeenCalled();
  });

  test('uses correct Redis cache key format', async () => {
    const context = makeAmountAnomalyContext(null, 100);
    const transaction = makeAmountAnomalyTransaction(400);
    transaction.account_id = 'ACC-0099';

    await evaluateAmountAnomaly(transaction, defaultAmountParams, context);

    expect(context.redis.get).toHaveBeenCalledWith('avg:ACC-0099');
  });
});

// ─────────────────────────────────────────
// Severity scoring
// ─────────────────────────────────────────
describe('amount_anomaly rule — severity scoring', () => {

  async function getScore(
    severity: 'low' | 'medium' | 'high' | 'critical'
  ): Promise<number> {
    const context = makeAmountAnomalyContext(null, 100, severity);
    // $400 triggers at 4x average of $100 with multiplier 3.0
    const result = await evaluateAmountAnomaly(
      makeAmountAnomalyTransaction(400),
      defaultAmountParams,
      context
    );
    return result.score;
  }

  test('returns 30 for critical severity', async () => {
    expect(await getScore('critical')).toBe(30);
  });

  test('returns 25 for high severity', async () => {
    expect(await getScore('high')).toBe(25);
  });

  test('returns 20 for medium severity', async () => {
    expect(await getScore('medium')).toBe(20);
  });

  test('returns 15 for low severity', async () => {
    expect(await getScore('low')).toBe(15);
  });
});

// ─────────────────────────────────────────
// Details object
// ─────────────────────────────────────────
describe('amount_anomaly rule — details object', () => {

  test('includes all required fields when triggered', async () => {
    const context = makeAmountAnomalyContext(null, 100);
    const result = await evaluateAmountAnomaly(
      makeAmountAnomalyTransaction(400),
      defaultAmountParams,
      context
    );

    expect(result.details).toMatchObject({
      rule_type: 'amount_anomaly',
      transaction_amount: 400,
      account_avg: 100,
      multiplier: 3.0,
      threshold_amount: 300,
      ratio: 4,
      message: expect.stringContaining('4.0x'),
    });
  });

  test('includes all required fields when not triggered', async () => {
    const context = makeAmountAnomalyContext(null, 100);
    const result = await evaluateAmountAnomaly(
      makeAmountAnomalyTransaction(200), // below threshold of $300
      defaultAmountParams,
      context
    );

    expect(result.details).toMatchObject({
      rule_type: 'amount_anomaly',
      transaction_amount: 200,
      account_avg: 100,
      threshold_amount: 300,
      message: null,
    });
  });

  test('message contains amount, ratio, average, and threshold', async () => {
    const context = makeAmountAnomalyContext('50', null);
    const result = await evaluateAmountAnomaly(
      makeAmountAnomalyTransaction(200), // 4x the $50 average
      defaultAmountParams,
      context
    );

    expect(result.details.message).toContain('$200');
    expect(result.details.message).toContain('4.0x');
    expect(result.details.message).toContain('$50.00');
    expect(result.details.message).toContain('$150.00'); // threshold = 50 * 3
  });
});