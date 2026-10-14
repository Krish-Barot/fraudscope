// apps/web/app/dashboard/page.tsx
// Dashboard Overview — matches Stitch design with real-time Socket.IO updates
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  Clock,
  ShieldAlert,
  TrendingUp,
  ArrowUpRight,
  ChevronRight,
  UserX,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../lib/authContext';
import { useSocket } from '../../hooks/useSocket';
import { apiFetch } from '../lib/api';
import {
  getSeverityFromScore,
  SEVERITY_TEXT,
  SEVERITY_BG,
  type Severity,
} from '../lib/severity';

interface AlertItem {
  id: string;
  transaction_id: string;
  risk_score: number;
  severity: Severity;
  status: string;
  summary: string;
  created_at: string;
  transaction?: {
    account_id?: string;
    amount?: number | string;
    currency?: string;
    merchant_name?: string;
  };
}

interface AlertCounts {
  total?: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  new: number;
  reviewing: number;
  investigating: number;
  dismissed_today?: number;
  escalated_today?: number;
}

interface FlaggedAccount {
  accountId: string;
  count: number;
  maxScore: number;
}

// Initial 24-hour volume baseline
const INITIAL_VOLUME = [12, 24, 18, 45, 30, 80, 55, 65, 40, 50, 75, 35, 60, 85, 45, 55, 70, 40, 30, 50, 65, 75, 90, 60];

export default function DashboardOverviewPage() {
  const { accessToken, isLoading: isAuthLoading } = useAuth();
  const { connected, on, off, emit } = useSocket();

  const [isLoading, setIsLoading] = useState(true);
  const [recentAlerts, setRecentAlerts] = useState<AlertItem[]>([]);
  const [totalTransactions, setTotalTransactions] = useState<number | null>(null);
  const [topAccounts, setTopAccounts] = useState<FlaggedAccount[]>([]);
  const [volumeBuckets, setVolumeBuckets] = useState<number[]>(INITIAL_VOLUME);
  const [alertCounts, setAlertCounts] = useState<AlertCounts>({
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    new: 0,
    reviewing: 0,
    investigating: 0,
  });

  const processedAlertIdsRef = useRef<Set<string>>(new Set());

  // ── Initial API Load ──────────────────────────────────────────────
  const loadDashboardData = useCallback(async () => {
    if (isAuthLoading) return;

    setIsLoading(true);
    try {
      // 1. Fetch alert counts
      const countsRes = await apiFetch('/api/v1/alerts/counts');
      if (countsRes.ok) {
        const countsData = await countsRes.json();
        setAlertCounts({
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          new: 0,
          reviewing: 0,
          investigating: 0,
          total: 0,
          ...countsData,
        });
      }

      // 2. Fetch recent alerts (top 5 sorted by created_at)
      const alertsRes = await apiFetch('/api/v1/alerts?limit=10&sort=created_at:desc');
      if (alertsRes.ok) {
        const alertsData = await alertsRes.json();
        const alertList: AlertItem[] = alertsData.data || [];
        setRecentAlerts(alertList.slice(0, 5));

        if (alertsData.pagination?.total !== undefined) {
          setAlertCounts(prev => ({ ...prev, total: alertsData.pagination.total }));
        }

        // Derive top flagged accounts from initial alerts
        const map = new Map<string, { accountId: string; count: number; maxScore: number }>();
        alertList.forEach((alert) => {
          const accId = alert.transaction?.account_id || 'ACC-UNKNOWN';
          const existing = map.get(accId) || { accountId: accId, count: 0, maxScore: 0 };
          map.set(accId, {
            accountId: accId,
            count: existing.count + 1,
            maxScore: Math.max(existing.maxScore, alert.risk_score || 0),
          });
        });

        const derivedAccounts = Array.from(map.values())
          .sort((a, b) => b.maxScore - a.maxScore)
          .slice(0, 4);
        setTopAccounts(derivedAccounts);
      }

      // 3. Fetch transaction count
      const txRes = await apiFetch('/api/v1/transactions?limit=1');
      if (txRes.ok) {
        const txData = await txRes.json();
        if (txData.pagination?.total !== undefined) {
          setTotalTransactions(txData.pagination.total);
        }
      }
    } catch (err) {
      console.error('Failed to fetch dashboard overview data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthLoading]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData, accessToken, isAuthLoading]);

  // ── Real-Time Socket.IO Handlers ───────────────────────────────────
  const handleNewTx = useCallback((_txData: any) => {
    // 1. Increment Transactions Today
    setTotalTransactions(prev => (prev !== null ? prev + 1 : 1));

    // 2. Increment volume in current hour bucket
    setVolumeBuckets(prev => {
      const updated = [...prev];
      updated[23] = (updated[23] || 0) + 1;
      return updated;
    });
  }, []);

  const handleNewAlert = useCallback((alertData: any) => {
    if (!alertData || !alertData.id) return;

    // Deduplicate alert processing
    if (processedAlertIdsRef.current.has(alertData.id)) {
      return;
    }
    processedAlertIdsRef.current.add(alertData.id);

    const sev = (alertData.severity || getSeverityFromScore(alertData.risk_score)) as Severity;
    const status = alertData.status || 'new';

    // 1. Update Alert Counts safely
    setAlertCounts(prev => {
      const copy: any = { ...prev };
      ['critical', 'high', 'medium', 'low', 'new', 'reviewing', 'investigating', 'total'].forEach(k => {
        if (copy[k] === undefined) copy[k] = 0;
      });

      copy.total = (copy.total || 0) + 1;
      if (['critical', 'high', 'medium', 'low'].includes(sev)) {
        copy[sev] = (copy[sev] || 0) + 1;
      }
      if (['new', 'reviewing', 'investigating'].includes(status)) {
        copy[status] = (copy[status] || 0) + 1;
      }
      return copy;
    });

    // 2. Prepend to Recent Alerts (max 5 items, prevent duplicate IDs)
    const newAlert: AlertItem = {
      id: alertData.id,
      transaction_id: alertData.transaction_id,
      risk_score: alertData.risk_score,
      severity: sev,
      status: status,
      summary: alertData.summary || `High Risk Alert (${alertData.risk_score} score)`,
      created_at: alertData.created_at || new Date().toISOString(),
      transaction: alertData.transaction ? {
        account_id: alertData.transaction.account_id,
        amount: alertData.transaction.amount,
        currency: alertData.transaction.currency,
        merchant_name: alertData.transaction.merchant_name,
      } : undefined,
    };

    setRecentAlerts(prev => {
      const filtered = prev.filter(a => a.id !== newAlert.id);
      return [newAlert, ...filtered].slice(0, 5);
    });

    // 3. Update Top Flagged Accounts
    const accId = alertData.transaction?.account_id;
    if (accId) {
      setTopAccounts(prev => {
        const idx = prev.findIndex(a => a.accountId === accId);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = {
            ...copy[idx],
            count: copy[idx].count + 1,
            maxScore: Math.max(copy[idx].maxScore, alertData.risk_score || 0),
          };
          return copy.sort((a, b) => b.maxScore - a.maxScore).slice(0, 4);
        } else {
          const copy = [
            ...prev,
            { accountId: accId, count: 1, maxScore: alertData.risk_score || 0 },
          ];
          return copy.sort((a, b) => b.maxScore - a.maxScore).slice(0, 4);
        }
      });
    }

    // 4. Increment volume in current hour bucket
    setVolumeBuckets(prev => {
      const updated = [...prev];
      updated[23] = (updated[23] || 0) + 1;
      return updated;
    });
  }, []);

  const handleAlertUpdated = useCallback((updateData: any) => {
    if (!updateData?.alert_id) return;
    const { alert_id, new_status } = updateData;

    // Update status in recent alerts list
    setRecentAlerts(prev =>
      prev.map(alert =>
        alert.id === alert_id ? { ...alert, status: new_status } : alert
      )
    );

    // Refresh counts from backend to keep status counts perfectly accurate
    apiFetch('/api/v1/alerts/counts').then(res => {
      if (res.ok) res.json().then(data => setAlertCounts(data));
    });
  }, []);

  // ── Subscribe to Socket Rooms ──────────────────────────────────────
  useEffect(() => {
    if (!connected) return;

    emit('subscribe', { channels: ['tx:live', 'alerts'] });
    on('tx:new', handleNewTx);
    on('alert:new', handleNewAlert);
    on('alert:updated', handleAlertUpdated);

    return () => {
      off('tx:new', handleNewTx);
      off('alert:new', handleNewAlert);
      off('alert:updated', handleAlertUpdated);
    };
  }, [connected, emit, on, off, handleNewTx, handleNewAlert, handleAlertUpdated]);

  const pendingReviewCount = (alertCounts.new || 0) + (alertCounts.reviewing || 0) + (alertCounts.investigating || 0);

  // Compute scale for 24h chart
  const maxBucketVal = Math.max(1, ...volumeBuckets);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[#1E2535]">
        <div>
          <h1 className="text-xl font-bold text-[#F1F3FA]">Dashboard Overview</h1>
          <p className="text-xs text-[#8B8FA8] mt-0.5">
            Real-time fraud surveillance, key risk indicators & system metrics
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-[#8B8FA8] bg-[#131929] px-3 py-1.5 rounded-lg border border-[#1E2535] self-start sm:self-auto">
          <div className={clsx("w-2 h-2 rounded-full", connected ? "bg-emerald-400 animate-pulse" : "bg-rose-500")} />
          {connected ? 'Surveillance Active • 24h Window' : 'Surveillance Offline'}
        </div>
      </div>

      {/* ── Top 4 Metric Cards ───────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Transactions Today */}
        <div className="p-4 bg-[#0D0F1A] border border-[#1E2535] rounded-xl flex flex-col justify-between hover:border-[#3882F6]/40 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#8B8FA8] uppercase tracking-wider">
              Transactions Today
            </span>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
              <Activity size={18} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold font-mono text-[#F1F3FA]">
              {isLoading ? (
                <div className="h-8 w-24 bg-[#131929] rounded animate-pulse" />
              ) : totalTransactions !== null ? (
                totalTransactions.toLocaleString()
              ) : (
                '—'
              )}
            </div>
            <p className="text-[11px] text-emerald-400 flex items-center gap-1 mt-1 font-mono">
              <TrendingUp size={12} /> Live stream active
            </p>
          </div>
        </div>

        {/* Alerts Generated */}
        <div className="p-4 bg-[#0D0F1A] border border-[#1E2535] rounded-xl flex flex-col justify-between hover:border-[#3882F6]/40 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#8B8FA8] uppercase tracking-wider">
              Alerts Generated
            </span>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
              <AlertTriangle size={18} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold font-mono text-[#F1F3FA]">
              {isLoading ? (
                <div className="h-8 w-24 bg-[#131929] rounded animate-pulse" />
              ) : (
                (alertCounts.total ?? (recentAlerts.length || 0)).toLocaleString()
              )}
            </div>
            <p className="text-[11px] text-[#8B8FA8] mt-1">
              Total system triggers
            </p>
          </div>
        </div>

        {/* Pending Review */}
        <div className="p-4 bg-[#0D0F1A] border border-[#1E2535] rounded-xl flex flex-col justify-between hover:border-[#3882F6]/40 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#8B8FA8] uppercase tracking-wider">
              Pending Review
            </span>
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
              <ShieldAlert size={18} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold font-mono text-[#F1F3FA]">
              {isLoading ? (
                <div className="h-8 w-24 bg-[#131929] rounded animate-pulse" />
              ) : (
                pendingReviewCount
              )}
            </div>
            <p className="text-[11px] text-rose-400 mt-1 font-mono">
              Action required
            </p>
          </div>
        </div>

        {/* Avg Response Time */}
        <div className="p-4 bg-[#0D0F1A] border border-[#1E2535] rounded-xl flex flex-col justify-between hover:border-[#3882F6]/40 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#8B8FA8] uppercase tracking-wider">
              Avg Response Time
            </span>
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
              <Clock size={18} />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold font-mono text-[#F1F3FA]">N/A</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400 border border-slate-700">
                API Pending
              </span>
            </div>
            <p className="text-[11px] text-[#4A4F6A] mt-1">
              Backend metrics collector pending
            </p>
          </div>
        </div>
      </div>

      {/* ── 24h Volume & Severity Breakdown ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Alert Volume 24h Visual Trend */}
        <div className="lg:col-span-2 p-5 bg-[#0D0F1A] border border-[#1E2535] rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-[#F1F3FA]">Alert Volume (24h)</h2>
              <p className="text-xs text-[#8B8FA8]">Transaction fraud detection activity timeline</p>
            </div>
            <span className="text-xs font-mono text-[#3882F6] bg-[#3882F6]/10 px-2.5 py-1 rounded border border-[#3882F6]/20 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#3882F6] animate-ping" />
              Live Stream
            </span>
          </div>

          {/* Bar Chart */}
          <div className="h-44 flex items-end justify-between gap-1.5 pt-6 pb-2 px-2 border-b border-[#1E2535]">
            {volumeBuckets.map((val, i) => {
              const pct = Math.max(8, Math.round((val / maxBucketVal) * 100));
              const isCurrent = i === 23;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative h-full justify-end">
                  <div 
                    className={clsx(
                      "w-full rounded-t transition-all duration-300 group-hover:brightness-125",
                      isCurrent ? "bg-[#3882F6]" : "bg-[#1E2535]"
                    )}
                    style={{ height: `${pct}%` }}
                  />
                </div>
              );
            })}
          </div>

          <div className="flex justify-between items-center text-[10px] font-mono text-[#4A4F6A] mt-2">
            <span>24h ago</span>
            <span>18h ago</span>
            <span>12h ago</span>
            <span>6h ago</span>
            <span className="text-[#3882F6] font-bold">Now</span>
          </div>
        </div>

        {/* Severity Breakdown */}
        <div className="p-5 bg-[#0D0F1A] border border-[#1E2535] rounded-xl flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[#F1F3FA]">Severity Breakdown</h2>
            <p className="text-xs text-[#8B8FA8] mb-4">Distribution of triggered security alerts</p>

            <div className="space-y-3">
              {([
                { label: 'Critical', count: alertCounts.critical || 0, color: 'bg-rose-500', text: 'text-rose-400' },
                { label: 'High',     count: alertCounts.high || 0,     color: 'bg-amber-500', text: 'text-amber-400' },
                { label: 'Medium',   count: alertCounts.medium || 0,   color: 'bg-yellow-500', text: 'text-yellow-400' },
                { label: 'Low',      count: alertCounts.low || 0,      color: 'bg-blue-500',  text: 'text-blue-400' },
              ]).map((item) => {
                const max = Math.max(1, alertCounts.critical + alertCounts.high + alertCounts.medium + alertCounts.low);
                const pct = Math.round((item.count / max) * 100) || 0;
                return (
                  <div key={item.label} className="space-y-1">
                    <div className="flex justify-between text-xs font-mono">
                      <span className={item.text}>{item.label}</span>
                      <span className="text-[#F1F3FA] font-bold">{item.count}</span>
                    </div>
                    <div className="h-2 w-full bg-[#131929] rounded-full overflow-hidden border border-[#1E2535]">
                      <div
                        className={clsx('h-full rounded-full transition-all duration-500', item.color)}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#1E2535] flex items-center justify-between text-xs text-[#8B8FA8]">
            <span>Active Queue</span>
            <Link href="/dashboard/alerts" className="text-[#3882F6] hover:underline flex items-center gap-1">
              Manage Queue <ChevronRight size={12} />
            </Link>
          </div>
        </div>
      </div>

      {/* ── Recent Alerts & Top Flagged Accounts ──────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Alerts List */}
        <div className="lg:col-span-2 p-5 bg-[#0D0F1A] border border-[#1E2535] rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-[#F1F3FA]">Recent Triggered Alerts</h2>
              <p className="text-xs text-[#8B8FA8]">Latest suspicious activities requiring action</p>
            </div>
            <Link
              href="/dashboard/alerts"
              className="text-xs font-medium text-[#3882F6] hover:underline flex items-center gap-1"
            >
              View All Alerts <ArrowUpRight size={14} />
            </Link>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-12 bg-[#131929] rounded animate-pulse" />
              ))}
            </div>
          ) : recentAlerts.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#4A4F6A]">
              No recent alerts recorded in the system.
            </div>
          ) : (
            <div className="space-y-2">
              {recentAlerts.map((alert) => {
                const sev = alert.severity || getSeverityFromScore(alert.risk_score);
                return (
                  <Link
                    key={alert.id}
                    href="/dashboard/alerts"
                    className="flex items-center justify-between p-3 rounded-lg bg-[#131929] border border-[#1E2535] hover:border-[#3882F6]/40 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={clsx(
                          'px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase shrink-0',
                          SEVERITY_BG[sev],
                          SEVERITY_TEXT[sev]
                        )}
                      >
                        {sev}
                      </span>
                      <div>
                        <div className="text-xs font-medium text-[#F1F3FA] line-clamp-1">
                          {alert.summary || `High Risk Alert (${alert.risk_score} score)`}
                        </div>
                        <div className="text-[11px] font-mono text-[#8B8FA8]">
                          {alert.transaction?.account_id || 'Account: N/A'} • {new Date(alert.created_at).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0 pl-2">
                      <span className="text-xs font-mono font-bold text-[#F1F3FA]">
                        {alert.risk_score} <span className="text-[10px] font-normal text-[#4A4F6A]">Score</span>
                      </span>
                      <span className="block text-[10px] font-mono capitalize text-[#8B8FA8]">
                        {alert.status}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Top Flagged Accounts */}
        <div className="p-5 bg-[#0D0F1A] border border-[#1E2535] rounded-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-[#F1F3FA]">Top Flagged Accounts</h2>
                <p className="text-xs text-[#8B8FA8]">Accounts with elevated risk factors</p>
              </div>
              <UserX size={16} className="text-[#8B8FA8]" />
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-10 bg-[#131929] rounded animate-pulse" />
                ))}
              </div>
            ) : topAccounts.length === 0 ? (
              <div className="py-12 text-center text-xs text-[#4A4F6A]">
                No account flags reported.
              </div>
            ) : (
              <div className="space-y-2.5">
                {topAccounts.map((acc) => (
                  <div
                    key={acc.accountId}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-[#131929] border border-[#1E2535]"
                  >
                    <div>
                      <span className="font-mono text-xs text-[#F1F3FA] block font-semibold">
                        {acc.accountId}
                      </span>
                      <span className="text-[10px] text-[#8B8FA8]">
                        {acc.count} alert{acc.count > 1 ? 's' : ''} triggered
                      </span>
                    </div>
                    <span className="text-xs font-mono font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                      Risk {acc.maxScore}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-[#1E2535]">
            <Link
              href="/dashboard/accounts"
              className="text-xs text-[#3882F6] hover:underline flex items-center justify-between"
            >
              <span>View All Account Profiles</span>
              <ChevronRight size={14} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}