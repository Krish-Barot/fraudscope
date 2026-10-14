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
  BarChart, Bar
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
  Users,
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

interface RuleEffectivenessItem {
  id: string;
  name: string;
  type: string;
  severity: string;
  is_active: boolean;
  trigger_count: number;
  true_positives: number;
  false_positives: number;
  tp_rate: number;
  fp_rate: number;
  avg_contribution: number;
  trend: number;
  prev_count: number;
}

interface ResolutionPoint {
  period: string;
  dismiss: number;
  escalate: number;
  investigate: number;
  total: number;
}

interface ResolutionSummary {
  total_resolved: number;
  resolution_rate: number;
  total_dismissed: number;
  total_escalated: number;
  total_investigated: number;
  avg_time_dismiss: string;
  avg_time_escalate: string;
  avg_time_investigate: string;
}

interface ResolutionData {
  group_by: 'hour' | 'day';
  data: ResolutionPoint[];
  summary: ResolutionSummary;
}

interface AnalystPerformanceItem {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  total_reviewed: number;
  dismissed: number;
  escalated: number;
  investigated: number;
  avg_response_seconds: number;
  avg_response_formatted: string;
  escalation_rate: number;
  fp_rate: number;
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
// Rule type badge (reuse style from rules manager)
// ─────────────────────────────────────────
const RULE_TYPE_COLORS: Record<string, string> = {
  velocity: '#818cf8',
  amount_anomaly: '#34d399',
  geo_mismatch: '#fb923c',
  time_anomaly: '#a78bfa',
  round_amount: '#38bdf8',
};

function RuleTypeBadge({ type }: { type: string }) {
  const color = RULE_TYPE_COLORS[type] || '#8B8FA8';
  const label = type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium"
      style={{ background: `${color}15`, color, border: `1px solid ${color}25` }}
    >
      {label}
    </span>
  );
}

// ─────────────────────────────────────────
// Sortable column header
// ─────────────────────────────────────────
function SortHeader({
  label,
  field,
  current,
  direction,
  onClick,
}: {
  label: string;
  field: string;
  current: string;
  direction: 'asc' | 'desc';
  onClick: (f: string) => void;
}) {
  const isActive = current === field;
  return (
    <button
      onClick={() => onClick(field)}
      className={clsx(
        'flex items-center gap-1 text-xs font-semibold uppercase tracking-widest transition-colors',
        isActive ? 'text-blue-400' : 'text-[#4A4F6A] hover:text-[#8B8FA8]'
      )}
    >
      {label}
      <span className="text-xs">
        {isActive ? (direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
      </span>
    </button>
  );
}

// ─────────────────────────────────────────
// FP rate color
// ─────────────────────────────────────────
function fpRateColor(rate: number): string {
  if (rate >= 50) return '#ef4444';
  if (rate >= 25) return '#f59e0b';
  return '#34d399';
}

// ─────────────────────────────────────────
// Analyst avatar
// ─────────────────────────────────────────
function AnalystAvatar({ firstName, lastName, id }: {
  firstName: string;
  lastName: string;
  id: string;
}) {
  const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f97316', '#ec4899', '#6366f1'];
  const color = colors[id.charCodeAt(0) % colors.length];
  return (
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
      style={{ background: color }}
    >
      {(firstName[0] || '').toUpperCase()}{(lastName[0] || '').toUpperCase()}
    </div>
  );
}

// ─────────────────────────────────────────
// Section 1 -- Rule Effectiveness
// ─────────────────────────────────────────
function RuleEffectivenessSection({
  data,
  isLoading,
  error,
  onRetry,
}: {
  data: RuleEffectivenessItem[] | null;
  isLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  const [sortField, setSortField] = useState<string>('trigger_count');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [highlighted, setHighlighted] = useState<string | null>(null);

  function handleSort(field: string) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  }

  const sorted = data ? [...data].sort((a, b) => {
    const av = (a as any)[sortField] ?? 0;
    const bv = (b as any)[sortField] ?? 0;
    return sortDir === 'asc' ? av - bv : bv - av;
  }) : [];

  // Bar chart data -- top 8 rules by trigger count
  const barData = data
    ? [...data].sort((a, b) => b.trigger_count - a.trigger_count).slice(0, 8)
    : [];

  return (
    <div className="bg-[#131929] border border-[#1E2535] rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-[#1E2535]">
        <p className="text-sm font-semibold text-[#F1F3FA]">Rule Effectiveness</p>
        <p className="text-xs text-[#4A4F6A] mt-0.5">
          Trigger rates and accuracy per detection rule
        </p>
      </div>

      {isLoading ? (
        <div className="h-48 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="h-48 flex flex-col items-center justify-center text-center">
          <AlertTriangle size={28} className="text-red-400 mb-2" />
          <p className="text-xs text-red-400">Unable to load data</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline"
            >
              Retry
            </button>
          )}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="h-48 flex flex-col items-center justify-center">
          <Shield size={28} className="text-[#1E2535] mb-2" />
          <p className="text-xs text-[#4A4F6A]">No rule trigger data for this period</p>
        </div>
      ) : (
        <>
          {/* Horizontal bar chart */}
          <div className="px-5 pt-4 pb-2">
            <p className="text-xs text-[#4A4F6A] uppercase tracking-widest mb-3">
              Top Rules by Trigger Count
            </p>
            <div className="space-y-2">
              {barData.map(rule => {
                const maxCount = barData[0]?.trigger_count || 1;
                const barWidth = Math.max((rule.trigger_count / maxCount) * 100, 2);
                const isHl = highlighted === rule.id;

                return (
                  <div
                    key={rule.id}
                    onClick={() => setHighlighted(prev => prev === rule.id ? null : rule.id)}
                    className={clsx(
                      'flex items-center gap-3 cursor-pointer rounded-lg px-2 py-1.5 transition-colors',
                      isHl ? 'bg-white/5' : 'hover:bg-white/[0.02]'
                    )}
                  >
                    <p className="text-xs text-[#8B8FA8] w-36 truncate shrink-0">{rule.name}</p>
                    <div className="flex-1 h-2 bg-[#1E2535] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${barWidth}%`,
                          background: fpRateColor(rule.fp_rate),
                        }}
                      />
                    </div>
                    <span className="text-xs font-mono text-[#F1F3FA] w-8 text-right shrink-0">
                      {rule.trigger_count}
                    </span>
                    <span
                      className="text-xs w-14 text-right shrink-0"
                      style={{ color: fpRateColor(rule.fp_rate) }}
                    >
                      {rule.fp_rate}% FP
                    </span>
                  </div>
                );
              })}
            </div>
            {/* FP rate color legend */}
            <div className="flex items-center gap-4 mt-3 pb-2">
              <p className="text-xs text-[#4A4F6A]">Bar color by FP rate:</p>
              {[
                { label: 'Low (<25%)', color: '#34d399' },
                { label: 'Med (25-50%)', color: '#f59e0b' },
                { label: 'High (>50%)', color: '#ef4444' },
              ].map(({ label, color }) => (
                <div key={label} className="flex items-center gap-1.5 text-xs text-[#8B8FA8]">
                  <span className="w-2 h-2 rounded-sm" style={{ background: color }} />
                  {label}
                </div>
              ))}
            </div>
          </div>

          {/* Sortable table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-t border-[#1E2535]">
                  {[
                    { label: 'Rule Name', field: 'name' },
                    { label: 'Type', field: 'type' },
                    { label: 'Triggers', field: 'trigger_count' },
                    { label: 'TP Rate', field: 'tp_rate' },
                    { label: 'FP Rate', field: 'fp_rate' },
                    { label: 'Avg Score', field: 'avg_contribution' },
                    { label: 'Trend', field: 'trend' },
                  ].map(col => (
                    <th key={col.field} className="px-4 py-2.5 text-left">
                      <SortHeader
                        label={col.label}
                        field={col.field}
                        current={sortField}
                        direction={sortDir}
                        onClick={handleSort}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(rule => {
                  const isHl = highlighted === rule.id;
                  return (
                    <tr
                      key={rule.id}
                      onClick={() => setHighlighted(p => p === rule.id ? null : rule.id)}
                      className={clsx(
                        'border-t border-[#1E2535] cursor-pointer transition-colors',
                        isHl ? 'bg-blue-500/5' : 'hover:bg-white/[0.02]',
                        !rule.is_active && 'opacity-40'
                      )}
                    >
                      <td className="px-4 py-2.5">
                        <p className="text-xs font-medium text-[#F1F3FA] truncate max-w-36">
                          {rule.name}
                        </p>
                      </td>
                      <td className="px-4 py-2.5">
                        <RuleTypeBadge type={rule.type} />
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-mono text-[#F1F3FA]">
                          {rule.trigger_count}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-mono text-emerald-400">
                          {rule.tp_rate}%
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-12 h-1.5 bg-[#1E2535] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${rule.fp_rate}%`,
                                background: fpRateColor(rule.fp_rate),
                              }}
                            />
                          </div>
                          <span
                            className="text-xs font-mono"
                            style={{ color: fpRateColor(rule.fp_rate) }}
                          >
                            {rule.fp_rate}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-mono text-[#8B8FA8]">
                          +{rule.avg_contribution}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={clsx(
                          'text-xs font-mono font-medium',
                          rule.trend > 0 ? 'text-red-400' :
                            rule.trend < 0 ? 'text-emerald-400' :
                              'text-[#4A4F6A]'
                        )}>
                          {rule.trend > 0 ? '+' : ''}{rule.trend}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Section 2 -- Alert Resolution Chart
// ─────────────────────────────────────────
function ResolutionSection({
  resolutionData,
  isLoading,
  groupBy,
  error,
  onRetry,
}: {
  resolutionData: ResolutionData | null;
  isLoading: boolean;
  groupBy: 'hour' | 'day';
  error?: string | null;
  onRetry?: () => void;
}) {
  const tickInterval = resolutionData
    ? Math.max(1, Math.floor(resolutionData.data.length / 8))
    : 1;

  const RESOLUTION_COLORS = {
    dismiss: '#64748b',
    investigate: '#a78bfa',
    escalate: '#ef4444',
  };

  return (
    <div className="bg-[#131929] border border-[#1E2535] rounded-xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-[#F1F3FA]">Alert Resolution</p>
          <p className="text-xs text-[#4A4F6A] mt-0.5">
            How alerts are being closed over time
          </p>
        </div>
        {/* Legend */}
        <div className="flex items-center gap-3">
          {[
            { key: 'dismiss', label: 'Dismissed', color: RESOLUTION_COLORS.dismiss },
            { key: 'investigate', label: 'Investigated', color: RESOLUTION_COLORS.investigate },
            { key: 'escalate', label: 'Escalated', color: RESOLUTION_COLORS.escalate },
          ].map(({ key, label, color }) => (
            <div key={key} className="flex items-center gap-1.5 text-xs text-[#8B8FA8]">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
              {label}
            </div>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="h-44 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="h-44 flex flex-col items-center justify-center text-center">
          <AlertTriangle size={28} className="text-red-400 mb-2" />
          <p className="text-xs text-red-400">Unable to load data</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline"
            >
              Retry
            </button>
          )}
        </div>
      ) : !resolutionData || resolutionData.data.every(d => d.total === 0) ? (
        <div className="h-44 flex flex-col items-center justify-center">
          <Activity size={28} className="text-[#1E2535] mb-2" />
          <p className="text-xs text-[#4A4F6A]">No resolution data for this period</p>
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart
              data={resolutionData.data}
              margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
              barSize={groupBy === 'hour' ? 8 : 16}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#1E2535" vertical={false} />
              <XAxis
                dataKey="period"
                tick={{ fontSize: 10, fill: '#4A4F6A' }}
                tickFormatter={v => formatAxisLabel(v, groupBy)}
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
              <Tooltip
                contentStyle={{
                  background: '#0D0F1A',
                  border: '1px solid #1E2535',
                  borderRadius: 12,
                  fontSize: 11,
                  color: '#F1F3FA',
                }}
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              />
              <Bar dataKey="dismiss" stackId="a" fill={RESOLUTION_COLORS.dismiss} radius={[0, 0, 0, 0]} />
              <Bar dataKey="investigate" stackId="a" fill={RESOLUTION_COLORS.investigate} radius={[0, 0, 0, 0]} />
              <Bar dataKey="escalate" stackId="a" fill={RESOLUTION_COLORS.escalate} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          {/* Summary stats */}
          {resolutionData.summary && (
            <div className="grid grid-cols-4 gap-3 mt-4 pt-4 border-t border-[#1E2535]">
              {[
                {
                  label: 'Total Resolved',
                  value: resolutionData.summary.total_resolved.toString(),
                  color: 'text-[#F1F3FA]',
                },
                {
                  label: 'Resolution Rate',
                  value: `${resolutionData.summary.resolution_rate}%`,
                  color: resolutionData.summary.resolution_rate >= 70 ? 'text-emerald-400' : 'text-amber-400',
                },
                {
                  label: 'Avg Time to Dismiss',
                  value: resolutionData.summary.avg_time_dismiss,
                  color: 'text-[#8B8FA8]',
                },
                {
                  label: 'Avg Time to Escalate',
                  value: resolutionData.summary.avg_time_escalate,
                  color: 'text-[#8B8FA8]',
                },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <p className="text-xs text-[#4A4F6A]">{label}</p>
                  <p className={clsx('text-lg font-bold font-mono mt-0.5', color)}>{value}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Section 3 -- Analyst Performance Table
// ─────────────────────────────────────────
function AnalystPerformanceSection({
  data,
  isLoading,
  error,
  onRetry,
}: {
  data: AnalystPerformanceItem[] | null;
  isLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  const [sortField, setSortField] = useState<string>('total_reviewed');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function handleSort(field: string) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  }

  const sorted = data ? [...data].sort((a, b) => {
    const av = (a as any)[sortField] ?? 0;
    const bv = (b as any)[sortField] ?? 0;
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === 'asc' ? av - bv : bv - av;
  }) : [];

  function escalationColor(rate: number): string {
    if (rate >= 50) return '#ef4444';
    if (rate >= 20) return '#f59e0b';
    return '#34d399';
  }

  return (
    <div className="bg-[#131929] border border-[#1E2535] rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-[#1E2535]">
        <p className="text-sm font-semibold text-[#F1F3FA]">Analyst Performance</p>
        <p className="text-xs text-[#4A4F6A] mt-0.5">
          Per-analyst alert review activity for the selected period
        </p>
      </div>

      {isLoading ? (
        <div className="h-40 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="h-40 flex flex-col items-center justify-center text-center">
          <AlertTriangle size={28} className="text-red-400 mb-2" />
          <p className="text-xs text-red-400">Unable to load data</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline"
            >
              Retry
            </button>
          )}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="h-40 flex flex-col items-center justify-center">
          <Users size={28} className="text-[#1E2535] mb-2" />
          <p className="text-xs text-[#4A4F6A]">No analyst activity in this period</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1E2535]">
                <th className="px-5 py-2.5 text-left w-44">
                  <SortHeader label="Analyst" field="last_name" current={sortField} direction={sortDir} onClick={handleSort} />
                </th>
                <th className="px-4 py-2.5 text-left">
                  <SortHeader label="Reviewed" field="total_reviewed" current={sortField} direction={sortDir} onClick={handleSort} />
                </th>
                <th className="px-4 py-2.5 text-left">
                  <SortHeader label="Dismissed" field="dismissed" current={sortField} direction={sortDir} onClick={handleSort} />
                </th>
                <th className="px-4 py-2.5 text-left">
                  <SortHeader label="Escalated" field="escalated" current={sortField} direction={sortDir} onClick={handleSort} />
                </th>
                <th className="px-4 py-2.5 text-left">
                  <SortHeader label="Investigated" field="investigated" current={sortField} direction={sortDir} onClick={handleSort} />
                </th>
                <th className="px-4 py-2.5 text-left">
                  <SortHeader label="Avg Time" field="avg_response_seconds" current={sortField} direction={sortDir} onClick={handleSort} />
                </th>
                <th className="px-4 py-2.5 text-left">
                  <SortHeader label="Escalation Rate" field="escalation_rate" current={sortField} direction={sortDir} onClick={handleSort} />
                </th>
                <th className="px-4 py-2.5 text-left">
                  <SortHeader label="FP Rate" field="fp_rate" current={sortField} direction={sortDir} onClick={handleSort} />
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(analyst => (
                <tr
                  key={analyst.id}
                  className="border-b border-[#1E2535] last:border-0 hover:bg-white/[0.02] transition-colors"
                >
                  {/* Name */}
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <AnalystAvatar
                        firstName={analyst.first_name}
                        lastName={analyst.last_name}
                        id={analyst.id}
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[#F1F3FA] truncate">
                          {analyst.first_name} {analyst.last_name}
                        </p>
                        <p className="text-xs text-[#4A4F6A] truncate">{analyst.email}</p>
                      </div>
                    </div>
                  </td>

                  {/* Reviewed */}
                  <td className="px-4 py-3">
                    <span className="text-sm font-bold font-mono text-[#F1F3FA]">
                      {analyst.total_reviewed}
                    </span>
                  </td>

                  {/* Dismissed */}
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono text-[#8B8FA8]">{analyst.dismissed}</span>
                  </td>

                  {/* Escalated */}
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono text-red-400">{analyst.escalated}</span>
                  </td>

                  {/* Investigated */}
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono text-purple-400">{analyst.investigated}</span>
                  </td>

                  {/* Avg response time */}
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono text-[#8B8FA8]">
                      {analyst.avg_response_formatted}
                    </span>
                  </td>

                  {/* Escalation rate bar */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-[#1E2535] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${analyst.escalation_rate}%`,
                            background: escalationColor(analyst.escalation_rate),
                          }}
                        />
                      </div>
                      <span
                        className="text-xs font-mono font-medium"
                        style={{ color: escalationColor(analyst.escalation_rate) }}
                      >
                        {analyst.escalation_rate}%
                      </span>
                    </div>
                  </td>

                  {/* FP rate */}
                  <td className="px-4 py-3">
                    <span
                      className="text-xs font-mono"
                      style={{ color: fpRateColor(analyst.fp_rate) }}
                    >
                      {analyst.fp_rate}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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

  // Add inside AnalyticsPage, after existing state:
  const [ruleEffectiveness, setRuleEffectiveness] = useState<RuleEffectivenessItem[] | null>(null);
  const [resolutionData, setResolutionData] = useState<ResolutionData | null>(null);
  const [analystPerformance, setAnalystPerformance] = useState<AnalystPerformanceItem[] | null>(null);
  const [isLoadingRules, setIsLoadingRules] = useState(true);
  const [isLoadingResolution, setIsLoadingResolution] = useState(true);
  const [isLoadingAnalysts, setIsLoadingAnalysts] = useState(true);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [analystsError, setAnalystsError] = useState<string | null>(null);

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
      setIsLoadingRules(true);
      setIsLoadingResolution(true);
      setIsLoadingAnalysts(true);
    } else {
      setIsRefreshing(true);
    }

    setOverviewError(null);
    setVolumeError(null);
    setSeverityError(null);
    setRulesError(null);
    setResolutionError(null);
    setAnalystsError(null);

    // Run all fetches in parallel
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

      apiFetch(`/api/v1/analytics/rule-effectiveness?${params}`, {}, token)
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await r.json();
          setRuleEffectiveness(data?.data || []);
        })
        .catch(err => {
          console.error('Failed to fetch rule effectiveness:', err);
          setRulesError(err.message || 'Failed to load');
        })
        .finally(() => {
          if (!silent) setIsLoadingRules(false);
        }),

      apiFetch(`/api/v1/analytics/resolution?${params}`, {}, token)
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await r.json();
          setResolutionData(data);
        })
        .catch(err => {
          console.error('Failed to fetch resolution analytics:', err);
          setResolutionError(err.message || 'Failed to load');
        })
        .finally(() => {
          if (!silent) setIsLoadingResolution(false);
        }),

      apiFetch(`/api/v1/analytics/analyst-performance?${params}`, {}, token)
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await r.json();
          setAnalystPerformance(data?.data || []);
        })
        .catch(err => {
          console.error('Failed to fetch analyst performance:', err);
          setAnalystsError(err.message || 'Failed to load');
        })
        .finally(() => {
          if (!silent) setIsLoadingAnalysts(false);
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

    emit('subscribe', { channels: ['alerts', 'rules'] });

    const handleRealtimeEvent = () => {
      triggerRealtimeRefresh();
    };

    on('alert:new', handleRealtimeEvent);
    on('alert:updated', handleRealtimeEvent);
    on('rule:updated', handleRealtimeEvent);

    return () => {
      off('alert:new', handleRealtimeEvent);
      off('alert:updated', handleRealtimeEvent);
      off('rule:updated', handleRealtimeEvent);
      emit('unsubscribe', { channels: ['alerts', 'rules'] });
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

      <RuleEffectivenessSection
        data={ruleEffectiveness}
        isLoading={isLoadingRules}
        error={rulesError}
        onRetry={() => fetchAll()}
      />

      <div className="grid grid-cols-2 gap-4">
        <ResolutionSection
          resolutionData={resolutionData}
          isLoading={isLoadingResolution}
          groupBy={resolutionData?.group_by || (preset === '24h' ? 'hour' : 'day')}
          error={resolutionError}
          onRetry={() => fetchAll()}
        />
        <AnalystPerformanceSection
          data={analystPerformance}
          isLoading={isLoadingAnalysts}
          error={analystsError}
          onRetry={() => fetchAll()}
        />
      </div>
    </div>
  );
}