// apps/web/app/dashboard/analytics/page.tsx
// Analytics Dashboard -- first half (FS-31)
// Date range controls, 4 metric cards, alert volume area chart, severity donut
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  RefreshCw,
  AlertTriangle,
  Activity,
  Clock,
  Shield,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../../lib/authContext';
import { useSocket } from '../../../hooks/useSocket';
import { apiFetch } from '../../lib/api';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────
interface MetricData {
  value: number;
  formatted: string;
  trend: number;
  previous: string | number | null;
  label: string;
}

interface OverviewData {
  period: { from: string; to: string };
  metrics: {
    transactions: MetricData;
    alerts: MetricData;
    pending: MetricData;
    avg_response_time: MetricData;
  };
}

interface AlertVolumePoint {
  period: string;
  low: number;
  medium: number;
  high: number;
  critical: number;
  total: number;
}

interface AlertVolumeData {
  group_by: 'hour' | 'day';
  data: AlertVolumePoint[];
}

interface SeverityItem {
  severity: string;
  count: number;
  percentage: number;
  color: string;
}

interface SeverityData {
  total: number;
  data: SeverityItem[];
}

type DatePreset = '24h' | '7d' | '30d' | '90d' | 'custom';

// ─────────────────────────────────────────
// Date range helpers
// ─────────────────────────────────────────
function getPresetRange(preset: DatePreset): { from: Date; to: Date } {
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const presetMs: Record<string, number> = {
    '24h': msPerDay,
    '7d': 7 * msPerDay,
    '30d': 30 * msPerDay,
    '90d': 90 * msPerDay,
  };
  return {
    from: new Date(now.getTime() - (presetMs[preset] || 7 * msPerDay)),
    to: now,
  };
}

function formatAxisLabel(period: string, groupBy: 'hour' | 'day'): string {
  const d = new Date(period);
  if (groupBy === 'hour') {
    return d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

// ─────────────────────────────────────────
// Trend indicator component
// ─────────────────────────────────────────
function TrendIndicator({
  trend,
  invertColor = false,
}: {
  trend: number;
  invertColor?: boolean;
}) {
  if (trend === 0) {
    return (
      <span className="flex items-center gap-1 text-xs text-[#4A4F6A]">
        <Minus size={11} />
        <span>No change</span>
      </span>
    );
  }

  // For response time: lower is better (invertColor=true)
  const isPositive = invertColor ? trend < 0 : trend > 0;

  return (
    <span className={clsx(
      'flex items-center gap-1 text-xs font-medium',
      isPositive ? 'text-emerald-400' : 'text-red-400'
    )}>
      {trend > 0
        ? <TrendingUp size={11} />
        : <TrendingDown size={11} />
      }
      <span>{Math.abs(trend)}% vs prev period</span>
    </span>
  );
}

// ─────────────────────────────────────────
// Metric card
// ─────────────────────────────────────────
function MetricCard({
  metric,
  icon,
  isLoading,
  highlight,
}: {
  metric?: MetricData;
  icon: React.ReactNode;
  isLoading: boolean;
  highlight?: boolean;
}) {
  if (isLoading || !metric) {
    return (
      <div className="bg-[#131929] border border-[#1E2535] rounded-xl p-5 animate-pulse">
        <div className="h-4 w-28 bg-[#1E2535] rounded mb-3" />
        <div className="h-9 w-20 bg-[#1E2535] rounded mb-3" />
        <div className="h-3 w-36 bg-[#1E2535] rounded" />
      </div>
    );
  }

  const isResponseTime = metric.label === 'Avg Response Time';

  return (
    <div className={clsx(
      'bg-[#131929] border rounded-xl p-5',
      highlight
        ? 'border-l-[3px] border-[#1E2535] border-l-amber-500'
        : 'border-[#1E2535]'
    )}>
      {/* Label row */}
      <div className="flex items-center justify-between mb-3">
        <p className={clsx(
          'text-xs uppercase tracking-widest font-semibold',
          highlight ? 'text-amber-500' : 'text-[#4A4F6A]'
        )}>
          {metric.label}
        </p>
        <div className={clsx(
          'w-7 h-7 rounded-lg flex items-center justify-center',
          highlight ? 'bg-amber-500/10' : 'bg-white/5'
        )}>
          <div className={highlight ? 'text-amber-500' : 'text-[#8B8FA8]'}>
            {icon}
          </div>
        </div>
      </div>

      {/* Value */}
      <p className={clsx(
        'text-3xl font-bold font-mono leading-none mb-3',
        highlight ? 'text-amber-400' : 'text-[#F1F3FA]'
      )}>
        {metric.formatted}
      </p>

      {/* Trend */}
      <TrendIndicator trend={metric.trend} invertColor={isResponseTime} />

      {/* Previous period */}
      {metric.previous !== null && metric.previous !== 0 && (
        <p className="text-xs text-[#4A4F6A] mt-1.5">
          Prev: {metric.previous}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Custom tooltip for AreaChart
// ─────────────────────────────────────────
function AreaTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-[#0D0F1A] border border-[#1E2535] rounded-xl p-3 shadow-xl">
      <p className="text-xs text-[#8B8FA8] font-mono mb-2">{label}</p>
      {[...payload].reverse().map((entry: any) => (
        <div key={entry.dataKey} className="flex items-center gap-2 text-xs py-0.5">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: entry.color }}
          />
          <span className="text-[#8B8FA8] capitalize w-16">{entry.dataKey}</span>
          <span className="font-mono font-bold text-[#F1F3FA]">{entry.value}</span>
        </div>
      ))}
      <div className="border-t border-[#1E2535] mt-2 pt-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[#4A4F6A] w-16">Total</span>
          <span className="font-mono font-bold text-[#F1F3FA]">
            {payload.reduce((s: number, e: any) => s + (e.value || 0), 0)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Custom tooltip for donut chart
// ─────────────────────────────────────────
function DonutTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const { name, value, payload: p } = payload[0];

  return (
    <div className="bg-[#0D0F1A] border border-[#1E2535] rounded-xl p-3 shadow-xl">
      <div className="flex items-center gap-2 text-xs">
        <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
        <span className="capitalize text-[#8B8FA8]">{name}</span>
      </div>
      <p className="font-mono font-bold text-[#F1F3FA] text-base mt-1">{value}</p>
      <p className="text-xs text-[#4A4F6A]">{p.percentage}% of total</p>
    </div>
  );
}

// ─────────────────────────────────────────
// Custom donut center label
// ─────────────────────────────────────────
function DonutCenterLabel({ viewBox, total }: { viewBox?: any; total: number }) {
  const { cx, cy } = viewBox || { cx: 0, cy: 0 };
  return (
    <g>
      <text
        x={cx}
        y={cy - 6}
        textAnchor="middle"
        dominantBaseline="middle"
        className="font-mono"
        fill="#F1F3FA"
        fontSize="22"
        fontWeight="700"
      >
        {total}
      </text>
      <text
        x={cx}
        y={cy + 14}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#4A4F6A"
        fontSize="10"
        fontWeight="500"
      >
        TOTAL
      </text>
    </g>
  );
}

// ─────────────────────────────────────────
// Date range controls
// ─────────────────────────────────────────
function DateRangeControls({
  preset,
  customFrom,
  customTo,
  onPresetChange,
  onCustomFromChange,
  onCustomToChange,
}: {
  preset: DatePreset;
  customFrom: string;
  customTo: string;
  onPresetChange: (p: DatePreset) => void;
  onCustomFromChange: (v: string) => void;
  onCustomToChange: (v: string) => void;
}) {
  const presets: { value: DatePreset; label: string }[] = [
    { value: '24h', label: '24h' },
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
    { value: '90d', label: '90d' },
    { value: 'custom', label: 'Custom' },
  ];

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1 bg-[#131929] border border-[#1E2535] rounded-lg p-0.5">
        {presets.map(p => (
          <button
            key={p.value}
            onClick={() => onPresetChange(p.value)}
            className={clsx(
              'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              preset === p.value
                ? 'bg-blue-600 text-white'
                : 'text-[#8B8FA8] hover:text-[#F1F3FA]'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div className="flex items-center gap-2">
          <Calendar size={12} className="text-[#4A4F6A]" />
          <input
            type="date"
            value={customFrom}
            onChange={e => onCustomFromChange(e.target.value)}
            className="bg-[#131929] border border-[#1E2535] rounded-lg text-xs text-[#8B8FA8] px-2.5 py-1.5 focus:outline-none focus:border-blue-500"
          />
          <span className="text-xs text-[#4A4F6A]">to</span>
          <input
            type="date"
            value={customTo}
            onChange={e => onCustomToChange(e.target.value)}
            className="bg-[#131929] border border-[#1E2535] rounded-lg text-xs text-[#8B8FA8] px-2.5 py-1.5 focus:outline-none focus:border-blue-500"
          />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────
export default function AnalyticsPage() {
  const { getAccessToken } = useAuth();
  const { connected, on, off, emit } = useSocket();

  // ── Date range state ───────────────────────────────────────────
  const [preset, setPreset] = useState<DatePreset>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // ── Data state ─────────────────────────────────────────────────
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [alertVolume, setAlertVolume] = useState<AlertVolumeData | null>(null);
  const [severityData, setSeverityData] = useState<SeverityData | null>(null);
  const [isLoadingOverview, setIsLoadingOverview] = useState(true);
  const [isLoadingVolume, setIsLoadingVolume] = useState(true);
  const [isLoadingSeverity, setIsLoadingSeverity] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [volumeError, setVolumeError] = useState<string | null>(null);
  const [severityError, setSeverityError] = useState<string | null>(null);

  // ── Build query params from current date range ─────────────────
  function buildParams(): string {
    if (preset === 'custom') {
      const params = new URLSearchParams();
      if (customFrom) params.set('from', new Date(customFrom + 'T00:00:00').toISOString());
      if (customTo) params.set('to', new Date(customTo + 'T23:59:59.999').toISOString());
      return params.toString();
    }
    const { from, to } = getPresetRange(preset);
    return new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    }).toString();
  }

  // ── Fetch all analytics data ───────────────────────────────────
  const fetchAll = useCallback(async (silent = false) => {
    const token = getAccessToken();
    const params = buildParams();

    if (!silent) {
      setIsRefreshing(true);
      setIsLoadingOverview(true);
      setIsLoadingVolume(true);
      setIsLoadingSeverity(true);
    } else {
      setIsRefreshing(true);
    }

    setOverviewError(null);
    setVolumeError(null);
    setSeverityError(null);

    // Run all 3 fetches in parallel
    await Promise.allSettled([
      apiFetch(`/api/v1/analytics/overview?${params}`, {}, token)
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await r.json();
          setOverview(data);
        })
        .catch(err => {
          console.error('Failed to fetch overview analytics:', err);
          setOverviewError(err.message || 'Failed to load');
        })
        .finally(() => {
          if (!silent) setIsLoadingOverview(false);
        }),

      apiFetch(`/api/v1/analytics/alert-volume?${params}`, {}, token)
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = (await r.json()) as { group_by: 'hour' | 'day'; data: AlertVolumePoint[] };
          const normalized: AlertVolumeData = {
            group_by: data.group_by,
            data: (data.data || []).map((p: AlertVolumePoint) => ({
              period: String(p.period),
              low: Number(p.low) || 0,
              medium: Number(p.medium) || 0,
              high: Number(p.high) || 0,
              critical: Number(p.critical) || 0,
              total: Number(p.total) || 0,
            })),
          };
          setAlertVolume(normalized);
        })
        .catch(err => {
          console.error('Failed to fetch alert volume:', err);
          setVolumeError(err.message || 'Failed to load');
        })
        .finally(() => {
          if (!silent) setIsLoadingVolume(false);
        }),

      apiFetch(`/api/v1/analytics/severity?${params}`, {}, token)
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = (await r.json()) as { total: number; data: SeverityItem[] };
          const normalized: SeverityData = {
            total: Number(data.total) || 0,
            data: (data.data || []).map((item: SeverityItem) => ({
              severity: String(item.severity),
              count: Number(item.count) || 0,
              percentage: Number(item.percentage) || 0,
              color: String(item.color || ''),
            })),
          };
          setSeverityData(normalized);
        })
        .catch(err => {
          console.error('Failed to fetch severity breakdown:', err);
          setSeverityError(err.message || 'Failed to load');
        })
        .finally(() => {
          if (!silent) setIsLoadingSeverity(false);
        }),
    ]);

    setIsRefreshing(false);
  }, [getAccessToken, preset, customFrom, customTo]);

  // Keep ref to latest fetchAll for event handlers
  const fetchAllRef = useRef<((silent?: boolean) => Promise<void>) | null>(null);
  useEffect(() => {
    fetchAllRef.current = fetchAll;
  }, [fetchAll]);

  // Fetch when date range changes
  useEffect(() => {
    if (preset === 'custom' && (!customFrom || !customTo)) return;
    fetchAll();
  }, [fetchAll]);

  // ── Coalesced real-time refresh ────────────────────────────────
  const lastTriggerRef = useRef<number>(0);
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const triggerRealtimeRefresh = useCallback(() => {
    const now = Date.now();
    if (!refreshTimeoutRef.current) {
      const elapsed = now - lastTriggerRef.current;
      const delay = elapsed >= 800 ? 150 : Math.max(150, 800 - elapsed);

      refreshTimeoutRef.current = setTimeout(() => {
        refreshTimeoutRef.current = null;
        lastTriggerRef.current = Date.now();
        fetchAllRef.current?.(true);
      }, delay);
    }
  }, []);

  // ── Subscribe to WebSocket events for real-time updates ────────
  useEffect(() => {
    if (!connected) return;

    emit('subscribe', { channels: ['alerts'] });

    const handleAlertEvent = () => {
      triggerRealtimeRefresh();
    };

    on('alert:new', handleAlertEvent);
    on('alert:updated', handleAlertEvent);

    return () => {
      off('alert:new', handleAlertEvent);
      off('alert:updated', handleAlertEvent);
      emit('unsubscribe', { channels: ['alerts'] });
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [connected, emit, on, off, triggerRealtimeRefresh]);

  // ── Derived: X-axis tick interval to avoid overcrowding ────────
  const tickInterval = alertVolume ? Math.max(1, Math.floor(alertVolume.data.length / 8)) : 1;

  // ─────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#F1F3FA]">Fraud Analytics Platform</h1>
          <p className="text-xs text-[#8B8FA8] mt-1">
            Transaction and alert trends across your detection pipeline
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Live status indicator */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#131929] border border-[#1E2535] rounded-lg">
            <span className="relative flex h-2 w-2">
              {connected && (
                <span className="absolute inline-flex h-full w-full rounded-full opacity-75 bg-emerald-400 animate-ping" />
              )}
              <span className={clsx(
                'relative inline-flex rounded-full h-2 w-2',
                connected ? 'bg-emerald-400' : 'bg-red-400'
              )} />
            </span>
            <span className="text-xs text-[#8B8FA8]">
              {connected ? 'Live' : 'Offline'}
            </span>
          </div>

          {/* Date range controls */}
          <DateRangeControls
            preset={preset}
            customFrom={customFrom}
            customTo={customTo}
            onPresetChange={setPreset}
            onCustomFromChange={setCustomFrom}
            onCustomToChange={setCustomTo}
          />

          {/* Refresh button */}
          <button
            onClick={() => fetchAll()}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#131929] border border-[#1E2535] rounded-lg text-xs text-[#8B8FA8] hover:text-[#F1F3FA] transition-colors disabled:opacity-40"
          >
            <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* 4 Metric Cards */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard
          metric={overview?.metrics.transactions}
          icon={<Activity size={14} />}
          isLoading={isLoadingOverview}
        />
        <MetricCard
          metric={overview?.metrics.alerts}
          icon={<Shield size={14} />}
          isLoading={isLoadingOverview}
        />
        <MetricCard
          metric={overview?.metrics.pending}
          icon={<AlertTriangle size={14} />}
          isLoading={isLoadingOverview}
          highlight={true}
        />
        <MetricCard
          metric={overview?.metrics.avg_response_time}
          icon={<Clock size={14} />}
          isLoading={isLoadingOverview}
        />
      </div>

      {/* Charts row: Area chart (60%) + Donut (40%) */}
      <div className="grid grid-cols-5 gap-4">

        {/* Alert Volume Over Time -- AreaChart */}
        <div className="col-span-3 bg-[#131929] border border-[#1E2535] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-semibold text-[#F1F3FA]">Alert Volume Over Time</p>
              <p className="text-xs text-[#4A4F6A] mt-0.5">
                Stacked by severity -- {alertVolume?.group_by === 'hour' ? 'hourly' : 'daily'} intervals
              </p>
            </div>
            {/* Legend */}
            <div className="flex items-center gap-3">
              {[
                { label: 'Critical', color: '#ef4444' },
                { label: 'High', color: '#f97316' },
                { label: 'Medium', color: '#f59e0b' },
                { label: 'Low', color: '#60a5fa' },
              ].map(({ label, color }) => (
                <div key={label} className="flex items-center gap-1.5 text-xs text-[#8B8FA8]">
                  <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                  {label}
                </div>
              ))}
            </div>
          </div>

          {isLoadingVolume ? (
            <div className="h-52 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : volumeError ? (
            <div className="h-52 flex flex-col items-center justify-center text-center">
              <AlertTriangle size={28} className="text-red-400 mb-2" />
              <p className="text-xs text-red-400">Failed to load alert volume data</p>
              <button
                onClick={() => fetchAll()}
                className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline"
              >
                Retry
              </button>
            </div>
          ) : !alertVolume || alertVolume.data.length === 0 || alertVolume.data.every(d => d.total === 0) ? (
            <div className="h-52 flex flex-col items-center justify-center text-center">
              <Activity size={28} className="text-[#1E2535] mb-2" />
              <p className="text-xs text-[#4A4F6A]">No alert data for this period</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart
                data={alertVolume.data}
                margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
              >
                <defs>
                  {[
                    { key: 'critical', color: '#ef4444' },
                    { key: 'high', color: '#f97316' },
                    { key: 'medium', color: '#f59e0b' },
                    { key: 'low', color: '#60a5fa' },
                  ].map(({ key, color }) => (
                    <linearGradient key={key} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={color} stopOpacity={0.0} />
                    </linearGradient>
                  ))}
                </defs>

                <CartesianGrid strokeDasharray="3 3" stroke="#1E2535" vertical={false} />

                <XAxis
                  dataKey="period"
                  tick={{ fontSize: 10, fill: '#4A4F6A' }}
                  tickFormatter={v => formatAxisLabel(v, alertVolume.group_by)}
                  axisLine={false}
                  tickLine={false}
                  interval={tickInterval}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#4A4F6A' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip content={<AreaTooltip />} />

                {/* Stacked areas -- low on bottom, critical on top */}
                <Area
                  type="monotone"
                  dataKey="low"
                  stackId="1"
                  stroke="#60a5fa"
                  strokeWidth={1.5}
                  fill="url(#grad-low)"
                  animationDuration={300}
                />
                <Area
                  type="monotone"
                  dataKey="medium"
                  stackId="1"
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  fill="url(#grad-medium)"
                  animationDuration={300}
                />
                <Area
                  type="monotone"
                  dataKey="high"
                  stackId="1"
                  stroke="#f97316"
                  strokeWidth={1.5}
                  fill="url(#grad-high)"
                  animationDuration={300}
                />
                <Area
                  type="monotone"
                  dataKey="critical"
                  stackId="1"
                  stroke="#ef4444"
                  strokeWidth={1.5}
                  fill="url(#grad-critical)"
                  animationDuration={300}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Severity Breakdown -- Donut chart */}
        <div className="col-span-2 bg-[#131929] border border-[#1E2535] rounded-xl p-5">
          <div className="mb-4">
            <p className="text-sm font-semibold text-[#F1F3FA]">Severity Breakdown</p>
            <p className="text-xs text-[#4A4F6A] mt-0.5">
              Alert distribution by severity level
            </p>
          </div>

          {isLoadingSeverity ? (
            <div className="h-52 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : severityError ? (
            <div className="h-52 flex flex-col items-center justify-center text-center">
              <AlertTriangle size={28} className="text-red-400 mb-2" />
              <p className="text-xs text-red-400">Failed to load severity breakdown</p>
              <button
                onClick={() => fetchAll()}
                className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline"
              >
                Retry
              </button>
            </div>
          ) : !severityData || severityData.total === 0 ? (
            <div className="h-52 flex flex-col items-center justify-center text-center">
              <Shield size={28} className="text-[#1E2535] mb-2" />
              <p className="text-xs text-[#4A4F6A]">No alerts in this period</p>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              {/* Donut */}
              <div className="shrink-0">
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie
                      data={severityData.data}
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={72}
                      paddingAngle={2}
                      dataKey="count"
                      nameKey="severity"
                      strokeWidth={0}
                      animationDuration={300}
                    >
                      {severityData.data.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<DonutTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Legend with counts */}
              <div className="flex-1 space-y-2.5">
                {severityData.data.map(item => (
                  <div key={item.severity} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-sm"
                        style={{ background: item.color }}
                      />
                      <span className="text-xs text-[#8B8FA8] capitalize">{item.severity}</span>
                    </div>
                    <div className="flex items-center gap-2 text-right">
                      <span className="text-xs font-bold font-mono text-[#F1F3FA]">{item.count}</span>
                      <span className="text-xs text-[#4A4F6A] w-8">{item.percentage}%</span>
                    </div>
                  </div>
                ))}

                <div className="pt-2 border-t border-[#1E2535] flex items-center justify-between">
                  <span className="text-xs text-[#4A4F6A]">Total</span>
                  <span className="text-sm font-bold font-mono text-[#F1F3FA]">
                    {severityData.total}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Period label */}
      {overview && (
        <p className="text-xs text-[#4A4F6A] text-right">
          Period: {new Date(overview.period.from).toLocaleDateString('en-CA')} --
          {new Date(overview.period.to).toLocaleDateString('en-CA')}
        </p>
      )}
    </div>
  );
}