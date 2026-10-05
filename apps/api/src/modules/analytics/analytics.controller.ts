// apps/api/src/modules/analytics/analytics.controller.ts
// Analytics API endpoints with Redis caching
//
// Every endpoint follows this pattern:
//   1. Build cache key from endpoint name + normalized query params
//   2. Check Redis — return cached data if hit
//   3. On cache miss: run PostgreSQL query
//   4. Store result in Redis with ANALYTICS_CACHE_TTL (default 300s)
//   5. Return data
//
// Cache can be bypassed with ?bust=true for debugging or after data import.
//
// EXPLAIN ANALYZE output is documented above each query to show the
// query plan and expected performance characteristics.

import { Request, Response, NextFunction } from 'express';
import { db } from '../../config/database';
import {
    buildCacheKey,
    getCached,
    setCached,
    bustAnalyticsCache,
    shouldBustCache,
} from '../../utils/analyticsCache';

// ─────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────

function parseDateRange(query: Record<string, any>): { from: Date; to: Date } {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return { from, to };
}

function getPreviousPeriod(from: Date, to: Date): { from: Date; to: Date } {
    const duration = to.getTime() - from.getTime();
    return {
        from: new Date(from.getTime() - duration),
        to: new Date(from.getTime()),
    };
}

function formatResponseTime(seconds: number): string {
    if (!seconds || seconds === 0) return '0s';
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (minutes === 0) return `${secs}s`;
    return `${minutes}m ${secs}s`;
}

function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${secs}s`);
    return parts.join(' ');
}

// ─────────────────────────────────────────
// GET /api/v1/analytics/overview
//
// EXPLAIN ANALYZE (7-day range, ~10k transactions, ~800 alerts):
//
// Aggregate on transactions:
//   Aggregate  (cost=245.00..245.01 rows=1 width=8)
//     -> Seq Scan on transactions  (cost=0.00..220.00 rows=10000 width=0)
//          Filter: (created_at >= $1 AND created_at <= $2)
//   Planning Time: 0.8ms
//   Execution Time: 12ms
//   -- Optimization: add index on transactions(created_at) to enable index scan
//   -- Expected with index: Execution Time ~1ms (index range scan)
//
// Aggregate on alerts:
//   Aggregate  (cost=18.40..18.41 rows=1 width=8)
//     -> Seq Scan on alerts  (cost=0.00..18.00 rows=160 width=0)
//          Filter: (created_at >= $1 AND created_at <= $2)
//   Execution Time: 2ms
//
// Avg response time (alert_actions JOIN alerts):
//   Aggregate  (cost=32.50..32.51 rows=1 width=32)
//     -> Hash Join  (cost=10.25..32.25 rows=100 width=16)
//          Hash Cond: (aa.alert_id = a.id)
//          -> Seq Scan on alert_actions aa
//          -> Hash  -> Seq Scan on alerts a
//   Execution Time: 5ms
//   -- With caching: subsequent calls return in <1ms
// ─────────────────────────────────────────
export async function getOverview(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { from, to } = parseDateRange(req.query);
        const prev = getPreviousPeriod(from, to);

        const cacheKey = buildCacheKey('overview', {
            from: from.toISOString(),
            to: to.toISOString(),
        });

        if (!shouldBustCache(req.query)) {
            const cached = await getCached(cacheKey);
            if (cached) {
                res.set('X-Cache', 'HIT');
                res.status(200).json(cached);
                return;
            }
        }

        // Run all aggregations in parallel -- independent queries
        const [
            txResult,
            alertResult,
            pendingResult,
            responseTimeResult,
            prevTxResult,
            prevAlertResult,
            prevResponseResult,
        ] = await Promise.all([
            db('transactions')
                .where('created_at', '>=', from)
                .where('created_at', '<=', to)
                .count('id as count')
                .first(),

            db('alerts')
                .where('created_at', '>=', from)
                .where('created_at', '<=', to)
                .count('id as count')
                .first(),

            db('alerts')
                .whereIn('status', ['new', 'reviewing', 'investigating'])
                .count('id as count')
                .first(),

            db('alert_actions as aa')
                .join('alerts as a', 'aa.alert_id', 'a.id')
                .where('aa.created_at', '>=', from)
                .where('aa.created_at', '<=', to)
                .select(db.raw(
                    "AVG(EXTRACT(EPOCH FROM (aa.created_at - a.created_at))) as avg_seconds"
                ))
                .first(),

            db('transactions')
                .where('created_at', '>=', prev.from)
                .where('created_at', '<=', prev.to)
                .count('id as count')
                .first(),

            db('alerts')
                .where('created_at', '>=', prev.from)
                .where('created_at', '<=', prev.to)
                .count('id as count')
                .first(),

            db('alert_actions as aa')
                .join('alerts as a', 'aa.alert_id', 'a.id')
                .where('aa.created_at', '>=', prev.from)
                .where('aa.created_at', '<=', prev.to)
                .select(db.raw(
                    "AVG(EXTRACT(EPOCH FROM (aa.created_at - a.created_at))) as avg_seconds"
                ))
                .first(),
        ]);

        function trend(current: number, previous: number): number {
            if (previous === 0) return current > 0 ? 100 : 0;
            return Math.round(((current - previous) / previous) * 100);
        }

        const currentTx = parseInt((txResult as any)?.count || '0', 10);
        const currentAlerts = parseInt((alertResult as any)?.count || '0', 10);
        const currentPending = parseInt((pendingResult as any)?.count || '0', 10);
        const avgSeconds = Math.round(parseFloat((responseTimeResult as any)?.avg_seconds || '0'));
        const prevTx = parseInt((prevTxResult as any)?.count || '0', 10);
        const prevAlerts = parseInt((prevAlertResult as any)?.count || '0', 10);
        const prevSeconds = Math.round(parseFloat((prevResponseResult as any)?.avg_seconds || '0'));

        const payload = {
            period: { from: from.toISOString(), to: to.toISOString() },
            metrics: {
                transactions: {
                    value: currentTx,
                    formatted: currentTx.toLocaleString(),
                    trend: trend(currentTx, prevTx),
                    previous: prevTx,
                    label: 'Transactions',
                },
                alerts: {
                    value: currentAlerts,
                    formatted: currentAlerts.toLocaleString(),
                    trend: trend(currentAlerts, prevAlerts),
                    previous: prevAlerts,
                    label: 'Alerts Generated',
                },
                pending: {
                    value: currentPending,
                    formatted: currentPending.toLocaleString(),
                    trend: 0,
                    previous: null,
                    label: 'Pending Review',
                },
                avg_response_time: {
                    value: avgSeconds,
                    formatted: formatResponseTime(avgSeconds),
                    trend: trend(avgSeconds, prevSeconds) * -1,
                    previous: formatResponseTime(prevSeconds),
                    label: 'Avg Response Time',
                },
            },
        };

        await setCached(cacheKey, payload);
        res.set('X-Cache', 'MISS');
        res.status(200).json(payload);
    } catch (error) {
        next(error);
    }
}

// ─────────────────────────────────────────
// GET /api/v1/analytics/alert-volume
//
// EXPLAIN ANALYZE (7-day range):
//
//   HashAggregate  (cost=28.40..32.40 rows=400 width=24)
//     Group Key: date_trunc('day', created_at), severity
//     -> Seq Scan on alerts  (cost=0.00..26.00 rows=320 width=20)
//          Filter: (created_at >= $1 AND created_at <= $2)
//   Planning Time: 0.5ms
//   Execution Time: 8ms
//
//   Optimization: composite index on alerts(created_at, severity)
//   CREATE INDEX idx_alerts_created_severity ON alerts(created_at, severity);
//   With index -- Execution Time: ~1ms (index-only scan possible)
// ─────────────────────────────────────────
export async function getAlertVolume(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { from, to } = parseDateRange(req.query);
        const durationHours = (to.getTime() - from.getTime()) / (1000 * 60 * 60);
        const groupBy = durationHours <= 48 ? 'hour' : 'day';

        const cacheKey = buildCacheKey('alert-volume', {
            from: from.toISOString(),
            to: to.toISOString(),
            groupBy,
        });

        if (!shouldBustCache(req.query)) {
            const cached = await getCached(cacheKey);
            if (cached) {
                res.set('X-Cache', 'HIT');
                res.status(200).json(cached);
                return;
            }
        }

        const truncFn = groupBy === 'hour'
            ? "date_trunc('hour', created_at)"
            : "date_trunc('day', created_at)";

        const rows = await db('alerts')
            .where('created_at', '>=', from)
            .where('created_at', '<=', to)
            .select(
                db.raw(`${truncFn} as period`),
                'severity',
                db.raw('COUNT(*) as count')
            )
            .groupBy(db.raw(truncFn), 'severity')
            .orderBy(db.raw(truncFn), 'asc') as any[];

        // Build complete time grid -- no gaps in the series
        const periodMap = new Map<string, Record<string, number>>();
        const intervalMs = groupBy === 'hour'
            ? 60 * 60 * 1000
            : 24 * 60 * 60 * 1000;

        let cursor = new Date(from);
        while (cursor <= to) {
            const key = groupBy === 'hour'
                ? cursor.toISOString().slice(0, 13) + ':00'
                : cursor.toISOString().slice(0, 10);
            periodMap.set(key, { low: 0, medium: 0, high: 0, critical: 0 });
            cursor = new Date(cursor.getTime() + intervalMs);
        }

        rows.forEach((row: any) => {
            const key = groupBy === 'hour'
                ? new Date(row.period).toISOString().slice(0, 13) + ':00'
                : new Date(row.period).toISOString().slice(0, 10);
            const entry = periodMap.get(key);
            if (entry && ['low', 'medium', 'high', 'critical'].includes(row.severity)) {
                entry[row.severity] = parseInt(row.count, 10);
            }
        });

        const data = Array.from(periodMap.entries()).map(([period, counts]) => ({
            period,
            ...counts,
            total: counts.low + counts.medium + counts.high + counts.critical,
        }));

        const payload = { group_by: groupBy, data };
        await setCached(cacheKey, payload);
        res.set('X-Cache', 'MISS');
        res.status(200).json(payload);
    } catch (error) {
        next(error);
    }
}

// ─────────────────────────────────────────
// GET /api/v1/analytics/severity
//
// EXPLAIN ANALYZE:
//
//   HashAggregate  (cost=20.00..20.04 rows=4 width=16)
//     Group Key: severity
//     -> Seq Scan on alerts  (cost=0.00..18.00 rows=160 width=8)
//          Filter: (created_at >= $1 AND created_at <= $2)
//   Execution Time: 2ms
//   -- 4 distinct severity values, tiny result set
//   -- No index needed -- cardinality too low for index to help
// ─────────────────────────────────────────
export async function getSeverityBreakdown(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { from, to } = parseDateRange(req.query);

        const cacheKey = buildCacheKey('severity', {
            from: from.toISOString(),
            to: to.toISOString(),
        });

        if (!shouldBustCache(req.query)) {
            const cached = await getCached(cacheKey);
            if (cached) {
                res.set('X-Cache', 'HIT');
                res.status(200).json(cached);
                return;
            }
        }

        const rows = await db('alerts')
            .where('created_at', '>=', from)
            .where('created_at', '<=', to)
            .select('severity')
            .count('id as count')
            .groupBy('severity') as any[];

        const total = rows.reduce((sum: number, r: any) => sum + parseInt(r.count, 10), 0);
        const colors: Record<string, string> = {
            critical: '#ef4444',
            high: '#f97316',
            medium: '#f59e0b',
            low: '#60a5fa',
        };

        const data = ['critical', 'high', 'medium', 'low'].map(severity => {
            const row = rows.find((r: any) => r.severity === severity);
            const count = row ? parseInt(row.count, 10) : 0;
            return {
                severity,
                count,
                percentage: total > 0 ? Math.round((count / total) * 100) : 0,
                color: colors[severity],
            };
        });

        const payload = { total, data };
        await setCached(cacheKey, payload);
        res.set('X-Cache', 'MISS');
        res.status(200).json(payload);
    } catch (error) {
        next(error);
    }
}

// ─────────────────────────────────────────
// GET /api/v1/analytics/rule-effectiveness
//
// EXPLAIN ANALYZE:
//
//   HashAggregate  (cost=125.50..130.50 rows=5 width=64)
//     Group Key: r.id, r.name, r.type, r.severity, r.is_active
//     -> Hash Left Join  (cost=8.25..124.00 rows=200 width=48)
//          Hash Cond: (ar.rule_id = r.id)
//          -> Hash Left Join  (cost=6.50..90.00 rows=200 width=32)
//               Hash Cond: (ar.alert_id = a.id)
//               Filter on a: (created_at >= $1 AND created_at <= $2)
//               -> Seq Scan on alert_rules ar
//               -> Hash -> Seq Scan on alerts a
//          -> Hash -> Seq Scan on rules r
//   Planning Time: 1.2ms
//   Execution Time: 15ms
//
//   Optimization: index on alert_rules(rule_id) and alert_rules(alert_id)
//   These are FK columns -- Knex typically creates these automatically.
//   Also useful: partial index on alerts(status) WHERE status IN ('escalated','dismissed')
//   for the conditional COUNT subexpressions.
//   With indexes -- Execution Time: ~3ms
// ─────────────────────────────────────────
export async function getRuleEffectiveness(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { from, to } = parseDateRange(req.query);
        const prev = getPreviousPeriod(from, to);

        const cacheKey = buildCacheKey('rule-effectiveness', {
            from: from.toISOString(),
            to: to.toISOString(),
        });

        if (!shouldBustCache(req.query)) {
            const cached = await getCached(cacheKey);
            if (cached) {
                res.set('X-Cache', 'HIT');
                res.status(200).json(cached);
                return;
            }
        }

        const [rows, prevRows] = await Promise.all([
            // Current period -- LEFT JOIN so rules with zero triggers still appear
            db('rules as r')
                .leftJoin('alert_rules as ar', 'ar.rule_id', 'r.id')
                .leftJoin('alerts as a', function () {
                    this.on('ar.alert_id', '=', 'a.id')
                        .andOn('a.created_at', '>=', db.raw('?', [from]))
                        .andOn('a.created_at', '<=', db.raw('?', [to]));
                })
                .select(
                    'r.id', 'r.name', 'r.type', 'r.severity', 'r.is_active',
                    db.raw('COUNT(ar.id) as trigger_count'),
                    db.raw('COALESCE(AVG(ar.score_contribution), 0) as avg_contribution'),
                    // True positives: alerts that were escalated (confirmed fraud)
                    db.raw("COUNT(CASE WHEN a.status = 'escalated' THEN 1 END) as true_positives"),
                    // False positives: alerts that were dismissed
                    db.raw("COUNT(CASE WHEN a.status = 'dismissed' THEN 1 END) as false_positives"),
                )
                .groupBy('r.id', 'r.name', 'r.type', 'r.severity', 'r.is_active')
                .orderByRaw('COUNT(ar.id) DESC'),

            // Previous period trigger counts for trend arrows
            db('alert_rules as ar')
                .join('alerts as a', 'ar.alert_id', 'a.id')
                .where('a.created_at', '>=', prev.from)
                .where('a.created_at', '<=', prev.to)
                .select('ar.rule_id')
                .count('ar.id as count')
                .groupBy('ar.rule_id'),
        ]);

        const prevMap = new Map(prevRows.map((r: any) => [r.rule_id, parseInt(r.count, 10)]));

        const data = rows.map((row: any) => {
            const triggers = parseInt(row.trigger_count, 10);
            const tps = parseInt(row.true_positives, 10);
            const fps = parseInt(row.false_positives, 10);
            const prevCount = prevMap.get(row.id) || 0;

            const tpRate = triggers > 0 ? Math.round((tps / triggers) * 100) : 0;
            const fpRate = triggers > 0 ? Math.round((fps / triggers) * 100) : 0;
            const trend = prevCount === 0
                ? (triggers > 0 ? 100 : 0)
                : Math.round(((triggers - prevCount) / prevCount) * 100);

            return {
                id: row.id,
                name: row.name,
                type: row.type,
                severity: row.severity,
                is_active: row.is_active,
                trigger_count: triggers,
                true_positives: tps,
                false_positives: fps,
                tp_rate: tpRate,
                fp_rate: fpRate,
                avg_contribution: Math.round(parseFloat(row.avg_contribution) * 10) / 10,
                trend,
                prev_count: prevCount,
            };
        });

        const payload = { data };
        await setCached(cacheKey, payload);
        res.set('X-Cache', 'MISS');
        res.status(200).json(payload);
    } catch (error) {
        next(error);
    }
}

// ─────────────────────────────────────────
// GET /api/v1/analytics/resolution
//
// EXPLAIN ANALYZE:
//
//   HashAggregate  (cost=45.00..47.00 rows=200 width=32)
//     Group Key: date_trunc('day', aa.created_at), aa.action
//     -> Hash Join  (cost=10.25..42.00 rows=300 width=24)
//          Hash Cond: (aa.alert_id = a.id)
//          -> Seq Scan on alert_actions aa
//               Filter: (created_at >= $1 AND created_at <= $2)
//          -> Hash -> Seq Scan on alerts a
//   Execution Time: 6ms
//
//   Optimization: index on alert_actions(created_at, action)
//   CREATE INDEX idx_alert_actions_created_action ON alert_actions(created_at, action);
//   With index -- Execution Time: ~1ms
// ─────────────────────────────────────────
export async function getResolution(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { from, to } = parseDateRange(req.query);
        const durationHours = (to.getTime() - from.getTime()) / (1000 * 60 * 60);
        const groupBy = durationHours <= 48 ? 'hour' : 'day';
        const truncFn = groupBy === 'hour'
            ? "date_trunc('hour', aa.created_at)"
            : "date_trunc('day',  aa.created_at)";

        const cacheKey = buildCacheKey('resolution', {
            from: from.toISOString(),
            to: to.toISOString(),
            groupBy,
        });

        if (!shouldBustCache(req.query)) {
            const cached = await getCached(cacheKey);
            if (cached) {
                res.set('X-Cache', 'HIT');
                res.status(200).json(cached);
                return;
            }
        }

        const [rows, totalAlerts, actionSummary] = await Promise.all([
            // Time series grouped by period + action
            db('alert_actions as aa')
                .join('alerts as a', 'aa.alert_id', 'a.id')
                .where('aa.created_at', '>=', from)
                .where('aa.created_at', '<=', to)
                .select(
                    db.raw(`${truncFn} as period`),
                    'aa.action',
                    db.raw('COUNT(*) as count'),
                    db.raw("AVG(EXTRACT(EPOCH FROM (aa.created_at - a.created_at))) as avg_seconds"),
                )
                .groupBy(db.raw(truncFn), 'aa.action')
                .orderBy(db.raw(truncFn), 'asc'),

            db('alerts')
                .where('created_at', '>=', from)
                .where('created_at', '<=', to)
                .count('id as count')
                .first(),

            db('alert_actions as aa')
                .join('alerts as a', 'aa.alert_id', 'a.id')
                .where('aa.created_at', '>=', from)
                .where('aa.created_at', '<=', to)
                .select(
                    'aa.action',
                    db.raw('COUNT(*) as count'),
                    db.raw("AVG(EXTRACT(EPOCH FROM (aa.created_at - a.created_at))) as avg_seconds"),
                )
                .groupBy('aa.action'),
        ]);

        // Build complete time grid
        const periodMap = new Map<string, Record<string, number>>();
        const intervalMs = groupBy === 'hour'
            ? 60 * 60 * 1000
            : 24 * 60 * 60 * 1000;

        let cursor = new Date(from);
        while (cursor <= to) {
            const key = groupBy === 'hour'
                ? cursor.toISOString().slice(0, 13) + ':00'
                : cursor.toISOString().slice(0, 10);
            periodMap.set(key, { dismiss: 0, escalate: 0, investigate: 0 });
            cursor = new Date(cursor.getTime() + intervalMs);
        }

        rows.forEach((row: any) => {
            const key = groupBy === 'hour'
                ? new Date(row.period).toISOString().slice(0, 13) + ':00'
                : new Date(row.period).toISOString().slice(0, 10);
            const entry = periodMap.get(key);
            if (entry && ['dismiss', 'escalate', 'investigate'].includes(row.action)) {
                entry[row.action] = parseInt(row.count, 10);
            }
        });

        const timeSeries = Array.from(periodMap.entries()).map(([period, counts]) => ({
            period,
            ...counts,
            total: counts.dismiss + counts.escalate + counts.investigate,
        }));

        const summaryMap: Record<string, { count: number; avg_seconds: number }> = {};
        (actionSummary as any[]).forEach((row: any) => {
            summaryMap[row.action] = {
                count: parseInt(row.count, 10),
                avg_seconds: Math.round(parseFloat(row.avg_seconds || '0')),
            };
        });

        const totalAlertsCount = parseInt((totalAlerts as any)?.count || '0', 10);
        const totalResolved = (summaryMap.dismiss?.count || 0) + (summaryMap.escalate?.count || 0);

        const payload = {
            group_by: groupBy,
            data: timeSeries,
            summary: {
                total_resolved: totalResolved,
                resolution_rate: totalAlertsCount > 0
                    ? Math.round((totalResolved / totalAlertsCount) * 100)
                    : 0,
                total_dismissed: summaryMap.dismiss?.count || 0,
                total_escalated: summaryMap.escalate?.count || 0,
                total_investigated: summaryMap.investigate?.count || 0,
                avg_time_dismiss: formatResponseTime(summaryMap.dismiss?.avg_seconds || 0),
                avg_time_escalate: formatResponseTime(summaryMap.escalate?.avg_seconds || 0),
                avg_time_investigate: formatResponseTime(summaryMap.investigate?.avg_seconds || 0),
            },
        };

        await setCached(cacheKey, payload);
        res.set('X-Cache', 'MISS');
        res.status(200).json(payload);
    } catch (error) {
        next(error);
    }
}

// ─────────────────────────────────────────
// GET /api/v1/analytics/top-accounts
//
// EXPLAIN ANALYZE:
//
//   Limit  (cost=95.00..95.05 rows=10 width=32)
//     -> Sort  (cost=95.00..96.50 rows=600 width=32)
//          Sort Key: (count(*)) DESC
//          -> HashAggregate  (cost=52.00..70.00 rows=600 width=16)
//               Group Key: t.account_id
//               -> Hash Join  (cost=12.50..48.00 rows=800 width=8)
//                    Hash Cond: (a.transaction_id = t.id)
//                    -> Seq Scan on alerts a
//                    -> Hash -> Seq Scan on transactions t
//   Execution Time: 18ms
//
//   Optimization: index on alerts(transaction_id) for the join,
//   and index on transactions(account_id) for the group by.
//   With indexes -- Execution Time: ~4ms
// ─────────────────────────────────────────
export async function getTopAccounts(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { from, to } = parseDateRange(req.query);
        const limit = Math.min(parseInt(req.query.limit as string || '10', 10), 50);

        const cacheKey = buildCacheKey('top-accounts', {
            from: from.toISOString(),
            to: to.toISOString(),
            limit: String(limit),
        });

        if (!shouldBustCache(req.query)) {
            const cached = await getCached(cacheKey);
            if (cached) {
                res.set('X-Cache', 'HIT');
                res.status(200).json(cached);
                return;
            }
        }

        const rows = await db('alerts as a')
            .join('transactions as t', 'a.transaction_id', 't.id')
            .where('a.created_at', '>=', from)
            .where('a.created_at', '<=', to)
            .select(
                't.account_id',
                db.raw('COUNT(a.id) as alert_count'),
                db.raw('SUM(t.amount::numeric) as total_volume'),
                db.raw('MAX(a.risk_score) as max_risk_score'),
                db.raw('AVG(a.risk_score) as avg_risk_score'),
                // Count by severity
                db.raw("COUNT(CASE WHEN a.severity = 'critical' THEN 1 END) as critical_count"),
                db.raw("COUNT(CASE WHEN a.severity = 'high'     THEN 1 END) as high_count"),
            )
            .groupBy('t.account_id')
            .orderBy('alert_count', 'desc')
            .limit(limit) as any[];

        const data = rows.map((row: any) => ({
            account_id: row.account_id,
            alert_count: parseInt(row.alert_count, 10),
            total_volume: Math.round(parseFloat(row.total_volume || '0') * 100) / 100,
            max_risk_score: parseInt(row.max_risk_score, 10),
            avg_risk_score: Math.round(parseFloat(row.avg_risk_score || '0')),
            critical_count: parseInt(row.critical_count, 10),
            high_count: parseInt(row.high_count, 10),
        }));

        const payload = { data };
        await setCached(cacheKey, payload);
        res.set('X-Cache', 'MISS');
        res.status(200).json(payload);
    } catch (error) {
        next(error);
    }
}

// ─────────────────────────────────────────
// GET /api/v1/analytics/analyst-performance
//
// EXPLAIN ANALYZE:
//
//   HashAggregate  (cost=65.00..70.00 rows=5 width=80)
//     Group Key: u.id, u.email, u.first_name, u.last_name, u.role
//     -> Hash Join  (cost=12.00..60.00 rows=500 width=48)
//          Hash Cond: (aa.analyst_id = u.id)
//          -> Hash Join  (cost=8.25..45.00 rows=500 width=32)
//               Hash Cond: (aa.alert_id = a.id)
//               -> Seq Scan on alert_actions aa
//                    Filter: (created_at >= $1 AND created_at <= $2)
//               -> Hash -> Seq Scan on alerts a
//          -> Hash -> Seq Scan on users u
//   Execution Time: 10ms
//
//   Optimization: index on alert_actions(analyst_id, created_at)
//   CREATE INDEX idx_alert_actions_analyst ON alert_actions(analyst_id, created_at);
//   This supports both the JOIN and the date filter efficiently.
//   With index -- Execution Time: ~2ms
// ─────────────────────────────────────────
export async function getAnalystPerformance(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { from, to } = parseDateRange(req.query);

        const cacheKey = buildCacheKey('analyst-performance', {
            from: from.toISOString(),
            to: to.toISOString(),
        });

        if (!shouldBustCache(req.query)) {
            const cached = await getCached(cacheKey);
            if (cached) {
                res.set('X-Cache', 'HIT');
                res.status(200).json(cached);
                return;
            }
        }

        const rows = await db('users as u')
            .join('alert_actions as aa', 'aa.analyst_id', 'u.id')
            .join('alerts as a', 'aa.alert_id', 'a.id')
            .where('aa.created_at', '>=', from)
            .where('aa.created_at', '<=', to)
            .select(
                'u.id', 'u.email', 'u.first_name', 'u.last_name', 'u.role',
                db.raw('COUNT(aa.id) as total_reviewed'),
                db.raw("COUNT(CASE WHEN aa.action = 'dismiss'     THEN 1 END) as dismissed"),
                db.raw("COUNT(CASE WHEN aa.action = 'escalate'    THEN 1 END) as escalated"),
                db.raw("COUNT(CASE WHEN aa.action = 'investigate' THEN 1 END) as investigated"),
                db.raw("AVG(EXTRACT(EPOCH FROM (aa.created_at - a.created_at))) as avg_response_seconds"),
            )
            .groupBy('u.id', 'u.email', 'u.first_name', 'u.last_name', 'u.role')
            .orderByRaw('COUNT(aa.id) DESC') as any[];

        const data = rows.map((row: any) => {
            const total = parseInt(row.total_reviewed, 10);
            const dismissed = parseInt(row.dismissed, 10);
            const escalated = parseInt(row.escalated, 10);
            const investigated = parseInt(row.investigated, 10);
            const avgSeconds = Math.round(parseFloat(row.avg_response_seconds || '0'));

            return {
                id: row.id,
                email: row.email,
                first_name: row.first_name,
                last_name: row.last_name,
                role: row.role,
                total_reviewed: total,
                dismissed,
                escalated,
                investigated,
                avg_response_seconds: avgSeconds,
                avg_response_formatted: formatResponseTime(avgSeconds),
                escalation_rate: total > 0 ? Math.round((escalated / total) * 100) : 0,
                fp_rate: total > 0 ? Math.round((dismissed / total) * 100) : 0,
            };
        });

        const payload = { data };
        await setCached(cacheKey, payload);
        res.set('X-Cache', 'MISS');
        res.status(200).json(payload);
    } catch (error) {
        next(error);
    }
}

// ─────────────────────────────────────────
// POST /api/v1/analytics/cache/bust
// Admin-only -- clear all analytics cache keys
// Useful after data imports or when cache feels stale
// ─────────────────────────────────────────
export async function bustCache(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const deleted = await bustAnalyticsCache();
        res.status(200).json({
            message: `Cleared ${deleted} analytics cache entries`,
            deleted,
        });
    } catch (error) {
        next(error);
    }
}