// apps/api/src/modules/analytics/analytics.controller.ts
// Analytics endpoints for the dashboard
// All queries are parameterized by date range (from/to)
// Previous period is calculated automatically for trend comparisons

import { Request, Response, NextFunction } from 'express';
import { db } from '../../config/database';

// ─────────────────────────────────────────
// Parse date range from query params
// Returns from/to as Date objects
// Defaults to last 7 days if not specified
// ─────────────────────────────────────────
function parseDateRange(query: Record<string, any>): { from: Date; to: Date } {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return { from, to };
}

// Previous period has the same duration as current, shifted back
function getPreviousPeriod(from: Date, to: Date): { from: Date; to: Date } {
    const duration = to.getTime() - from.getTime();
    return {
        from: new Date(from.getTime() - duration),
        to: new Date(from.getTime()),
    };
}

// ─────────────────────────────────────────
// GET /api/v1/analytics/overview
// 4 metric cards: tx count, alert count, pending, avg response time
// Each includes trend vs previous period
// ─────────────────────────────────────────
export async function getOverview(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { from, to } = parseDateRange(req.query);
        const prev = getPreviousPeriod(from, to);

        // Current period counts
        const [txCount] = await db('transactions')
            .where('created_at', '>=', from)
            .where('created_at', '<=', to)
            .count('id as count');

        const [alertCount] = await db('alerts')
            .where('created_at', '>=', from)
            .where('created_at', '<=', to)
            .count('id as count');

        const [pendingCount] = await db('alerts')
            .whereIn('status', ['new', 'reviewing', 'investigating'])
            .count('id as count');

        // Average response time: time from alert created to first action
        const responseTimeResult = await db('alert_actions')
            .join('alerts', 'alert_actions.alert_id', 'alerts.id')
            .where('alert_actions.created_at', '>=', from)
            .where('alert_actions.created_at', '<=', to)
            .select(
                db.raw("AVG(EXTRACT(EPOCH FROM (alert_actions.created_at - alerts.created_at))) as avg_seconds")
            )
            .first();

        const avgResponseSeconds = responseTimeResult?.avg_seconds
            ? Math.round(parseFloat(responseTimeResult.avg_seconds))
            : 0;

        // Previous period counts for trends
        const [prevTxCount] = await db('transactions')
            .where('created_at', '>=', prev.from)
            .where('created_at', '<=', prev.to)
            .count('id as count');

        const [prevAlertCount] = await db('alerts')
            .where('created_at', '>=', prev.from)
            .where('created_at', '<=', prev.to)
            .count('id as count');

        const prevResponseResult = await db('alert_actions')
            .join('alerts', 'alert_actions.alert_id', 'alerts.id')
            .where('alert_actions.created_at', '>=', prev.from)
            .where('alert_actions.created_at', '<=', prev.to)
            .select(
                db.raw("AVG(EXTRACT(EPOCH FROM (alert_actions.created_at - alerts.created_at))) as avg_seconds")
            )
            .first();

        const prevAvgSeconds = prevResponseResult?.avg_seconds
            ? Math.round(parseFloat(prevResponseResult.avg_seconds))
            : 0;

        // Calculate trend percentages
        function trend(current: number, previous: number): number {
            if (previous === 0) return current > 0 ? 100 : 0;
            return Math.round(((current - previous) / previous) * 100);
        }

        function formatResponseTime(seconds: number): string {
            if (seconds === 0) return '0s';
            const minutes = Math.floor(seconds / 60);
            const secs = seconds % 60;
            if (minutes === 0) return `${secs}s`;
            return `${minutes}m ${secs}s`;
        }

        const currentTx = parseInt(txCount.count as string, 10);
        const currentAlerts = parseInt(alertCount.count as string, 10);
        const currentPending = parseInt(pendingCount.count as string, 10);
        const prevTx = parseInt(prevTxCount.count as string, 10);
        const prevAlerts = parseInt(prevAlertCount.count as string, 10);

        res.status(200).json({
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
                    trend: 0,   // pending is a current snapshot, no trend
                    previous: null,
                    label: 'Pending Review',
                },
                avg_response_time: {
                    value: avgResponseSeconds,
                    formatted: formatResponseTime(avgResponseSeconds),
                    trend: trend(avgResponseSeconds, prevAvgSeconds) * -1, // lower is better
                    previous: formatResponseTime(prevAvgSeconds),
                    label: 'Avg Response Time',
                },
            },
        });
    } catch (error) {
        next(error);
    }
}

// ─────────────────────────────────────────
// GET /api/v1/analytics/alert-volume
// Time series data for the AreaChart
// Groups alerts by day/hour depending on range length
// Returns stacked by severity
// ─────────────────────────────────────────
export async function getAlertVolume(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { from, to } = parseDateRange(req.query);
        const durationHours = (to.getTime() - from.getTime()) / (1000 * 60 * 60);

        // Group by hour for < 48h, by day otherwise
        const groupBy = durationHours <= 48 ? 'hour' : 'day';
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
            .groupByRaw(`${truncFn}, severity`)
            .orderByRaw(`${truncFn} asc`) as any[];

        // Build a complete time series with all severities per period
        // This ensures Recharts gets a complete dataset with no gaps
        const periodMap = new Map<string, Record<string, number>>();

        // Generate all expected period keys ensuring boundaries are covered
        const intervalMs = groupBy === 'hour'
            ? 60 * 60 * 1000
            : 24 * 60 * 60 * 1000;

        let cursor = new Date(from);
        if (groupBy === 'day') {
            cursor.setUTCHours(0, 0, 0, 0);
        } else {
            cursor.setUTCMinutes(0, 0, 0);
        }

        const endBoundary = new Date(to);
        if (groupBy === 'day') {
            endBoundary.setUTCHours(23, 59, 59, 999);
        }

        while (cursor <= endBoundary) {
            const key = groupBy === 'hour'
                ? cursor.toISOString().slice(0, 13) + ':00'
                : cursor.toISOString().slice(0, 10);

            if (!periodMap.has(key)) {
                periodMap.set(key, { low: 0, medium: 0, high: 0, critical: 0 });
            }
            cursor = new Date(cursor.getTime() + intervalMs);
        }

        // Fill in actual counts
        rows.forEach(row => {
            const key = groupBy === 'hour'
                ? new Date(row.period).toISOString().slice(0, 13) + ':00'
                : new Date(row.period).toISOString().slice(0, 10);

            let entry = periodMap.get(key);
            if (!entry) {
                entry = { low: 0, medium: 0, high: 0, critical: 0 };
                periodMap.set(key, entry);
            }
            if (row.severity && entry[row.severity] !== undefined) {
                entry[row.severity] = parseInt(String(row.count), 10) || 0;
            }
        });

        // Convert to array for Recharts sorted by period
        const data = Array.from(periodMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([period, counts]) => ({
                period,
                low: Number(counts.low) || 0,
                medium: Number(counts.medium) || 0,
                high: Number(counts.high) || 0,
                critical: Number(counts.critical) || 0,
                total: (Number(counts.low) || 0) + (Number(counts.medium) || 0) + (Number(counts.high) || 0) + (Number(counts.critical) || 0),
            }));

        res.status(200).json({
            group_by: groupBy,
            data,
        });
    } catch (error) {
        next(error);
    }
}

// ─────────────────────────────────────────
// GET /api/v1/analytics/severity
// Severity breakdown counts for the donut chart
// ─────────────────────────────────────────
export async function getSeverityBreakdown(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { from, to } = parseDateRange(req.query);

        const rows = await db('alerts')
            .where('created_at', '>=', from)
            .where('created_at', '<=', to)
            .select('severity')
            .count('id as count')
            .groupBy('severity') as any[];

        const total = rows.reduce((sum, r) => sum + parseInt(r.count, 10), 0);

        const severityOrder = ['critical', 'high', 'medium', 'low'];
        const colors: Record<string, string> = {
            critical: '#ef4444',
            high: '#f97316',
            medium: '#f59e0b',
            low: '#60a5fa',
        };

        const data = severityOrder.map(severity => {
            const row = rows.find(r => r.severity === severity);
            const count = row ? parseInt(row.count, 10) : 0;
            return {
                severity,
                count,
                percentage: total > 0 ? Math.round((count / total) * 100) : 0,
                color: colors[severity],
            };
        });

        res.status(200).json({
            total,
            data,
        });
    } catch (error) {
        next(error);
    }
}