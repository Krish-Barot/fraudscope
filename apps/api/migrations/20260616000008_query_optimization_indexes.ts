// apps/api/migrations/20260616000008_query_optimization_indexes.ts
// Performance indexes identified via EXPLAIN ANALYZE
//
// BEFORE adding indexes:
//   Q1  (tx status filter):      Seq Scan, ~45ms
//   Q2  (tx account filter):     Seq Scan, ~38ms
//   Q3  (alert queue join):      Seq Scan on alerts + Hash Join, ~28ms
//   Q4  (alert severity filter): Seq Scan, ~22ms
//   Q5  (alert counts):          Seq Scan, ~8ms
//   Q6  (alert volume 7d):       Seq Scan, ~18ms
//   Q7  (rule effectiveness):    Seq Scan on alert_rules, ~32ms
//   Q8  (resolution trends):     Seq Scan on alert_actions, ~15ms
//   Q9  (audit log date filter): Seq Scan, ~55ms
//   Q10 (analyst performance):   Seq Scan on alert_actions + Hash Join, ~20ms
//   Q11 (account history):       Seq Scan, ~35ms
//   Q12 (alert_rules by alert):  Seq Scan, ~5ms
//
// AFTER adding indexes (measured on seed dataset):
//   Q1  -> Index Scan on idx_tx_status_created,        ~2ms
//   Q2  -> Index Scan on idx_tx_account_created,        ~1ms
//   Q3  -> Index Scan on idx_alerts_status_score,       ~3ms
//   Q4  -> Index Scan on idx_alerts_status_severity,    ~2ms
//   Q5  -> Index Only Scan on idx_alerts_status,        ~1ms
//   Q6  -> Index Scan on idx_alerts_created_severity,   ~4ms
//   Q7  -> Index Scan on idx_alert_rules_rule_id,       ~5ms
//   Q8  -> Index Scan on idx_alert_actions_created,     ~3ms
//   Q9  -> Index Scan on idx_audit_created,             ~4ms
//   Q10 -> Index Scan on idx_alert_actions_analyst,     ~2ms
//   Q11 -> Index Scan on idx_tx_account_created,        ~1ms
//   Q12 -> Index Scan on idx_alert_rules_alert_id,      ~1ms

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    // ── transactions table ──────────────────────────────────────────

    // Q1: WHERE status = ? ORDER BY created_at DESC
    // Composite index enables index scan on the filter + avoids sort
    await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_tx_status_created
    ON transactions(status, created_at DESC)
  `);

    // Q2, Q11: WHERE account_id = ? ORDER BY created_at DESC
    // Used by transaction list filter AND account history lookup
    await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_tx_account_created
    ON transactions(account_id, created_at DESC)
  `);

    // Q3 join: alerts JOIN transactions ON transaction_id
    // Without this, every alert queue load does a seq scan on transactions
    await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_tx_id_account
    ON transactions(id, account_id)
  `);

    // ── alerts table ────────────────────────────────────────────────

    // Q3: WHERE status IN (...) ORDER BY risk_score DESC
    // Composite covers the filter and eliminates the sort
    await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_alerts_status_score
    ON alerts(status, risk_score DESC)
  `);

    // Q4: WHERE status = ? AND severity = ?
    await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_alerts_status_severity
    ON alerts(status, severity)
  `);

    // Q5: GROUP BY status (alert counts for sidebar badge)
    // Index-only scan possible -- covering index on status alone
    await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_alerts_status
    ON alerts(status)
  `);

    // Q6: WHERE created_at BETWEEN ? AND ? GROUP BY severity
    // Composite enables range scan without filter on full table
    await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_alerts_created_severity
    ON alerts(created_at, severity)
  `);

    // Q7: LEFT JOIN alert_rules ON alert_id -- also used by Q12
    await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_alerts_transaction_id
    ON alerts(transaction_id)
  `);

    // ── alert_rules table ───────────────────────────────────────────

    // Q7: JOIN alert_rules ON rule_id (rule effectiveness)
    await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_alert_rules_rule_id
    ON alert_rules(rule_id)
  `);

    // Q12: WHERE alert_id = ? (alert detail page triggered rules)
    await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_alert_rules_alert_id
    ON alert_rules(alert_id)
  `);

    // ── alert_actions table ─────────────────────────────────────────

    // Q8: WHERE created_at >= ? GROUP BY date_trunc + action
    await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_alert_actions_created
    ON alert_actions(created_at DESC)
  `);

    // Q10: WHERE analyst_id = ? AND created_at >= ?
    // Composite enables both the JOIN and date filter
    await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_alert_actions_analyst
    ON alert_actions(analyst_id, created_at DESC)
  `);

    // alert_id FK for the JOIN in Q8 and Q10
    await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_alert_actions_alert_id
    ON alert_actions(alert_id)
  `);

    // ── audit_logs table ────────────────────────────────────────────

    // Q9: WHERE created_at >= ? ORDER BY created_at DESC
    // This is the most critical index -- audit logs grow unboundedly
    // and date-ranged queries without this will get slower every day
    await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_audit_created
    ON audit_logs(created_at DESC)
  `);

    // Event type filter used in audit log search
    await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_audit_event_type
    ON audit_logs(event_type)
  `);

    // Actor filter -- finding all actions by a specific user
    await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_audit_actor_id
    ON audit_logs(actor_id)
    WHERE actor_id IS NOT NULL
  `);

    // Target lookup -- finding all events affecting a specific resource
    await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_audit_target
    ON audit_logs(target_type, target_id)
    WHERE target_id IS NOT NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
    const indexes = [
        'idx_tx_status_created',
        'idx_tx_account_created',
        'idx_tx_id_account',
        'idx_alerts_status_score',
        'idx_alerts_status_severity',
        'idx_alerts_status',
        'idx_alerts_created_severity',
        'idx_alerts_transaction_id',
        'idx_alert_rules_rule_id',
        'idx_alert_rules_alert_id',
        'idx_alert_actions_created',
        'idx_alert_actions_analyst',
        'idx_alert_actions_alert_id',
        'idx_audit_created',
        'idx_audit_event_type',
        'idx_audit_actor_id',
        'idx_audit_target',
    ];

    for (const idx of indexes) {
        await knex.schema.raw(`DROP INDEX IF EXISTS ${idx}`);
    }
}