// apps/web/app/dashboard/transactions/[id]/page.tsx
// Transaction Investigation Detail — enterprise fraud investigation UI
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  Shield,
  MapPin,
  Clock,
  User,
  Wifi,
  Smartphone,
  Globe,
  ExternalLink,
  XCircle,
  CheckCheck,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../../../lib/authContext';
import { apiFetch } from '../../../lib/api';
import {
  getSeverityFromScore,
  SEVERITY_TEXT,
  SEVERITY_BG,
  SEVERITY_HEX,
  type Severity,
} from '../../../lib/severity';
import { countryToFlag } from '../../../lib/countryFlags';

// Dynamic import for Leaflet map — no SSR
const TransactionMap = dynamic(
  () => import('../../../../components/dashboard/TransactionMap'),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-[#0A0D16] rounded-lg flex items-center justify-center">
        <div className="text-xs text-[#6B7094] flex items-center gap-2">
          <div className="w-3 h-3 border border-[#3882F6] border-t-transparent rounded-full animate-spin" />
          Loading map…
        </div>
      </div>
    ),
  }
);

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────
interface Transaction {
  id: string;
  external_id: string;
  account_id: string;
  amount: string | number;
  currency: string;
  merchant_name?: string;
  merchant_category?: string;
  country_code: string;
  city?: string;
  ip_address?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  channel?: string;
  status: 'clean' | 'flagged' | 'blocked';
  created_at: string;
  processed_at?: string;
}

interface TriggeredRule {
  rule_id?: string;
  name?: string;
  ruleName?: string;
  type?: string;
  ruleType?: string;
  score_contribution: number;
  details?: Record<string, unknown>;
}

interface Alert {
  id: string;
  risk_score: number;
  severity: string;
  status: string;
  created_at: string;
  triggered_rules?: TriggeredRule[];
}

interface AlertAction {
  id: string;
  action: string;
  reason: string;
  analyst_id?: string;
  previous_status?: string;
  new_status?: string;
  created_at: string;
}

interface TransactionDetail extends Transaction {
  alerts?: Alert[];
  account_history?: Transaction[];
}

// ─────────────────────────────────────────
// Utility functions & safe parsers
// ─────────────────────────────────────────
function safeNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const num = typeof val === 'number' ? val : Number(val);
  return isNaN(num) ? null : num;
}

function formatCoordinate(val: unknown, digits: number = 4): string | null {
  const num = safeNumber(val);
  return num !== null ? num.toFixed(digits) : null;
}

function formatAmount(amount: string | number, currency: string): string {
  const num = safeNumber(amount) ?? 0;
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: currency || 'CAD',
    minimumFractionDigits: 2,
  }).format(num);
}

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatRelativeTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ─────────────────────────────────────────
// Shared DataRow component
// ─────────────────────────────────────────
function DataRow({ label, value, valueClass, extra, clickable, onClick }: {
  label: string;
  value: string;
  valueClass?: string;
  extra?: React.ReactNode;
  clickable?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={clsx(
        'py-2.5 px-4 border-b border-[#1A2030] last:border-0 transition-colors duration-150',
        clickable && 'cursor-pointer hover:bg-[#1A2236]'
      )}
      onClick={onClick}
    >
      <p className="text-[10px] text-[#7A7F98] uppercase tracking-[0.1em] font-medium mb-0.5">{label}</p>
      <div className="flex items-center gap-2">
        <p className={clsx(
          'text-[13px] font-mono break-all leading-snug',
          valueClass || 'text-[#D1D5E4]',
          clickable && 'text-blue-400 hover:text-blue-300'
        )}>
          {value}
        </p>
        {extra}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Left Column — Transaction Info
// ─────────────────────────────────────────
function TransactionInfoPanel({
  tx,
  topAlert,
}: {
  tx: TransactionDetail;
  topAlert?: Alert;
}) {
  const router = useRouter();
  const severity = topAlert
    ? (getSeverityFromScore(topAlert.risk_score) as Severity)
    : 'clean';
  const isFlagged = tx.status === 'flagged' || tx.status === 'blocked';

  // Detect VPN based on IP (simplified — real implementation would use IP intelligence)
  const isVpn = tx.ip_address && (
    tx.ip_address.startsWith('185.') ||
    tx.ip_address.startsWith('104.') ||
    tx.ip_address.startsWith('45.')
  );

  const latStr = formatCoordinate(tx.latitude, 4);
  const lngStr = formatCoordinate(tx.longitude, 4);
  const coordsValue = latStr && lngStr ? `${latStr}, ${lngStr}` : 'N/A';

  return (
    <div
      className="bg-[#111827] border border-[#1E2535] rounded-xl overflow-hidden h-fit"
      style={{ boxShadow: isFlagged ? `inset 3px 0 0 ${SEVERITY_HEX[severity]}` : undefined }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#1A2030] bg-[#0C1221]">
        <p className="text-[10px] text-[#7A7F98] uppercase tracking-[0.1em] font-medium mb-1.5">
          Core Transaction Data
        </p>
        <div className="flex items-start justify-between gap-2">
          <p className="font-mono text-[15px] font-bold text-[#E5E7EB] leading-tight">
            {tx.external_id.length > 20
              ? `${tx.external_id.slice(0, 8)}…${tx.external_id.slice(-8)}`
              : tx.external_id
            }
          </p>
          {isFlagged && topAlert && (
            <span className={clsx(
              'shrink-0 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border',
              SEVERITY_TEXT[severity],
              SEVERITY_BG[severity],
            )}
              style={{ borderColor: `${SEVERITY_HEX[severity]}30` }}
            >
              Flagged · {severity.toUpperCase()}
            </span>
          )}
        </div>
        <p className="text-[11px] text-[#8B8FA8] mt-1.5 flex items-center gap-1">
          <Clock size={10} />
          {formatDateTime(tx.created_at)} UTC
        </p>
      </div>

      {/* Amount — large display */}
      <div className="px-4 py-4 border-b border-[#1A2030]">
        <p className="text-[10px] text-[#7A7F98] uppercase tracking-[0.1em] font-medium mb-1">Amount</p>
        <p className={clsx(
          'text-[26px] font-bold font-mono leading-none tracking-tight',
          isFlagged ? SEVERITY_TEXT[severity] : 'text-[#E5E7EB]'
        )}>
          {formatAmount(tx.amount, tx.currency)}
        </p>
      </div>

      {/* Details */}
      <div>
        <DataRow label="Merchant" value={tx.merchant_name || '—'} />
        <DataRow
          label="Account ID"
          value={tx.account_id}
          clickable
          onClick={() => router.push(`/dashboard/accounts?q=${tx.account_id}`)}
        />
        <DataRow
          label="IP Address"
          value={tx.ip_address || '—'}
          extra={isVpn ? (
            <span className="text-[10px] text-red-400 font-bold flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/20">
              <Wifi size={9} />
              VPN
            </span>
          ) : undefined}
        />
        <DataRow
          label="Country"
          value={`${countryToFlag(tx.country_code)} ${tx.country_code}`}
        />
        {tx.city && <DataRow label="City" value={tx.city} />}
        <DataRow label="Coordinates" value={coordsValue} />
        <DataRow label="Channel" value={(tx.channel || '—').toUpperCase()} />
        <DataRow label="Category" value={tx.merchant_category || '—'} />
        <DataRow
          label="Status"
          value={tx.status.toUpperCase()}
          valueClass={isFlagged ? SEVERITY_TEXT[severity] : 'text-emerald-400'}
        />
        {tx.processed_at && (
          <DataRow
            label="Processed"
            value={formatRelativeTime(tx.processed_at)}
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Center — Map Section
// ─────────────────────────────────────────
function MapSection({
  tx,
  accountHistory,
  hasGeoMismatch,
}: {
  tx: TransactionDetail;
  accountHistory: Transaction[];
  hasGeoMismatch: boolean;
}) {
  const lat = safeNumber(tx.latitude);
  const lng = safeNumber(tx.longitude);
  const hasCoords = lat !== null && lng !== null;

  // Build map markers — always use 'current' type for the active
  // transaction. The marker system uses a consistent red/coral
  // circle regardless of anomaly status. Anomaly is communicated
  // in the header badge, not the marker shape.
  const markers: Array<{
    lat: number;
    lng: number;
    type: 'current' | 'previous' | 'warning';
    label: string;
  }> = [];

  if (hasCoords) {
    // Previous transaction locations
    if (hasGeoMismatch) {
      accountHistory.forEach(t => {
        const prevLat = safeNumber(t.latitude);
        const prevLng = safeNumber(t.longitude);
        if (prevLat !== null && prevLng !== null && t.id !== tx.id) {
          markers.push({
            lat: prevLat,
            lng: prevLng,
            type: 'previous' as const,
            label: `${t.merchant_name || 'Previous'} — ${t.country_code}`,
          });
        }
      });
    }

    // Current transaction — always 'current' type, never 'warning'
    markers.push({
      lat: lat!,
      lng: lng!,
      type: 'current' as const,
      label: `${tx.merchant_name || 'Transaction'} — ${tx.country_code}\n${formatAmount(tx.amount, tx.currency)}`,
    });
  }

  return (
    <div className="bg-[#111827] border border-[#1E2535] rounded-xl overflow-hidden" style={{ position: 'relative', zIndex: 0 }}>
      {/* Map header */}
      <div className="px-4 py-2.5 border-b border-[#1A2030] flex items-center justify-between bg-[#0C1221]">
        <div className="flex items-center gap-2">
          <MapPin size={12} className={hasGeoMismatch ? 'text-orange-400' : 'text-[#6B7094]'} />
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9CA0B8]">
            {hasGeoMismatch ? 'Geospatial Anomaly Detected' : 'Transaction Location'}
          </p>
        </div>
        {hasGeoMismatch && (
          <span className="text-[10px] text-orange-400 font-bold flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-500/10 border border-orange-500/20">
            <AlertTriangle size={9} />
            Anomaly
          </span>
        )}
      </div>

      {/* Map */}
      <div className="h-56 relative" style={{ zIndex: 0 }}>
        {hasCoords ? (
          <TransactionMap
            markers={markers}
            center={[lat!, lng!]}
            zoom={hasGeoMismatch ? 3 : 8}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center bg-[#0A0D16]">
            <Globe size={24} className="text-[#1E2535] mb-2" />
            <p className="text-xs text-[#6B7094]">No location data available</p>
          </div>
        )}
      </div>

      {/* Map legend */}
      {hasCoords && hasGeoMismatch && (
        <div className="px-4 py-2 border-t border-[#1A2030] flex items-center gap-5 bg-[#0C1221]">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 border border-red-300" />
            <span className="text-[11px] text-[#9CA0B8]">Current transaction</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#6B8DB5', border: '1.5px solid #93B4D4' }} />
            <span className="text-[11px] text-[#9CA0B8]">Previous locations</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Center — Account Timeline
// ─────────────────────────────────────────
function AccountTimeline({
  history,
  currentTxId,
}: {
  history: Transaction[];
  currentTxId: string;
}) {
  const router = useRouter();

  return (
    <div className="bg-[#111827] border border-[#1E2535] rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#1A2030] flex items-center justify-between bg-[#0C1221]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9CA0B8]">
          Account Timeline (Last 10 Transactions)
        </p>
        <span className="text-[10px] text-[#6B7094] font-medium">Sorted by Date</span>
      </div>

      <div className="overflow-auto max-h-72">
        <table className="w-full">
          <thead className="sticky top-0 bg-[#0C1221] z-[1]">
            <tr>
              {['Date / Time', 'Entity', 'Amount', 'Status'].map(h => (
                <th
                  key={h}
                  className="py-2 px-3 text-left text-[10px] font-semibold text-[#6B7094] uppercase tracking-[0.08em] first:pl-4"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-xs text-[#6B7094]">
                  No account history available.
                </td>
              </tr>
            ) : (
              history.map(tx => {
                const isCurrent = tx.id === currentTxId;
                const isFlagged = tx.status === 'flagged' || tx.status === 'blocked';
                const createdDate = new Date(tx.created_at);
                const isValidDate = !isNaN(createdDate.getTime());

                return (
                  <tr
                    key={tx.id}
                    onClick={() => {
                      if (!isCurrent) router.push(`/dashboard/transactions/${tx.id}`);
                    }}
                    className={clsx(
                      'border-b border-[#1A2030]/60 last:border-0 transition-all duration-150',
                      isCurrent
                        ? 'bg-red-500/[0.06] border-l-2 border-l-red-500'
                        : 'hover:bg-[#1A2236] cursor-pointer border-l-2 border-l-transparent'
                    )}
                  >
                    <td className="py-2 pl-4 pr-3 whitespace-nowrap">
                      <span className="font-mono text-[11px] text-[#9CA0B8]">
                        {isValidDate ? (
                          <>
                            {createdDate.toLocaleDateString('en-CA', {
                              month: 'short',
                              day: 'numeric',
                            })}
                            {' '}
                            {createdDate.toLocaleTimeString('en-CA', {
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            })}
                          </>
                        ) : (
                          '—'
                        )}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <span className="text-[11px] text-[#9CA0B8] truncate block max-w-28">
                        {tx.merchant_name || '—'}
                      </span>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className={clsx(
                        'font-mono text-[11px]',
                        isFlagged ? 'text-red-400' : 'text-[#D1D5E4]'
                      )}>
                        {formatAmount(tx.amount, tx.currency)}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      {isCurrent ? (
                        <span className="text-[10px] font-bold text-red-400 font-mono px-1.5 py-0.5 rounded bg-red-500/10">
                          Current
                        </span>
                      ) : isFlagged ? (
                        <span className="text-[10px] font-bold text-red-400 px-1.5 py-0.5 rounded bg-red-500/10">Flagged</span>
                      ) : (
                        <span className="text-[10px] font-medium text-emerald-400 px-1.5 py-0.5 rounded bg-emerald-500/10">Clean</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Right — Risk Score Gauge
// ─────────────────────────────────────────
function RiskScoreGauge({
  score,
  severity,
}: {
  score: number;
  severity: Severity;
}) {
  const numScore = safeNumber(score) ?? 0;
  const color = SEVERITY_HEX[severity];
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const arc = (numScore / 100) * circumference;

  return (
    <div className="flex flex-col items-center py-5">
      <div className="relative" style={{ width: 110, height: 110 }}>
        <svg width="110" height="110" className="-rotate-90">
          {/* Background ring */}
          <circle
            cx="55" cy="55" r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.04)"
            strokeWidth="7"
          />
          {/* Score arc */}
          <circle
            cx="55" cy="55" r={radius}
            fill="none"
            stroke={color}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${arc} ${circumference}`}
            style={{
              transition: 'stroke-dasharray 0.8s ease',
              filter: `drop-shadow(0 0 6px ${color}40)`,
            }}
          />
        </svg>
        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="text-3xl font-bold font-mono leading-none"
            style={{ color }}
          >
            {numScore}
          </span>
          <span className="text-[9px] text-[#6B7094] mt-0.5 uppercase tracking-wider">/100</span>
        </div>
      </div>
      <span
        className="text-[10px] font-bold uppercase tracking-[0.15em] mt-2"
        style={{ color }}
      >
        {severity} Risk
      </span>
    </div>
  );
}

// ─────────────────────────────────────────
// Right — Triggered Rule Card
// ─────────────────────────────────────────
function TriggeredRuleCard({ rule }: { rule: TriggeredRule }) {
  const name = rule.ruleName || rule.name || rule.ruleType || rule.type || 'Unknown Rule';
  const formattedName = name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const score = safeNumber(rule.score_contribution) ?? 0;

  // Color tier based on contribution
  let color = '#60a5fa'; // blue
  let bgColor = 'rgba(96,165,250,0.06)';
  let borderColor = 'rgba(96,165,250,0.18)';
  if (score >= 30) { color = '#ef4444'; bgColor = 'rgba(239,68,68,0.06)'; borderColor = 'rgba(239,68,68,0.18)'; }
  else if (score >= 20) { color = '#f97316'; bgColor = 'rgba(249,115,22,0.06)'; borderColor = 'rgba(249,115,22,0.18)'; }
  else if (score >= 15) { color = '#f59e0b'; bgColor = 'rgba(245,158,11,0.06)'; borderColor = 'rgba(245,158,11,0.18)'; }

  // Get human-readable description from rule details
  const details = rule.details as any;
  let description = '';
  if (details?.message) {
    description = details.message;
  } else if (details?.rule_type === 'velocity') {
    description = `${details.current_count} transactions in ${details.window_minutes} min (threshold: ${details.threshold})`;
  } else if (details?.rule_type === 'amount_anomaly') {
    description = `$${details.transaction_amount} is ${details.ratio}x the 30-day average of $${details.account_avg}`;
  } else if (details?.rule_type === 'geo_mismatch') {
    description = `Transaction from ${details.current_country} — account history: ${(details.known_countries || []).join(', ')}`;
  } else if (details?.rule_type === 'time_anomaly') {
    description = `Transaction at ${details.transaction_local_time} (${details.timezone})`;
  } else if (details?.rule_type === 'round_amount') {
    description = `Suspicious round amount $${details.amount} (nearest round: $${details.nearest_round})`;
  }

  return (
    <div
      className="rounded-lg p-3 border transition-colors duration-150 hover:brightness-110"
      style={{ background: bgColor, borderColor }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] font-bold leading-tight" style={{ color }}>
          {formattedName}
        </span>
        <span
          className="text-[11px] font-bold font-mono px-1.5 py-0.5 rounded shrink-0 ml-2"
          style={{ color, background: `${bgColor}`, border: `1px solid ${borderColor}` }}
        >
          +{score}
        </span>
      </div>
      {description && (
        <p className="text-[11px] text-[#8B8FA8] leading-relaxed line-clamp-2">
          {description}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Right — Alert Actions History
// ─────────────────────────────────────────
function ActionHistory({ actions }: { actions: AlertAction[] }) {
  if (actions.length === 0) {
    return (
      <div className="flex flex-col items-center py-4">
        <Clock size={16} className="text-[#2A3148] mb-2" />
        <p className="text-[11px] text-[#7A7F98] font-medium">No analyst actions yet</p>
        <p className="text-[10px] text-[#5A5F7A] mt-0.5">Waiting for analyst decision.</p>
      </div>
    );
  }

  const actionLabel: Record<string, { label: string; color: string }> = {
    dismiss:     { label: 'Dismissed',            color: '#8B95A5' },
    escalate:    { label: 'Escalated',             color: '#ef4444' },
    investigate: { label: 'Under Investigation',   color: '#a78bfa' },
    reassign:    { label: 'Reassigned',            color: '#60a5fa' },
    comment:     { label: 'Comment',               color: '#9CA0B8' },
  };

  return (
    <div className="space-y-2.5">
      {actions.map((action, idx) => {
        const config = actionLabel[action.action] || { label: action.action, color: '#9CA0B8' };
        const isLast = idx === actions.length - 1;
        return (
          <div key={action.id} className="flex gap-2.5 text-[11px]">
            <div className="flex flex-col items-center">
              <div
                className="w-2 h-2 rounded-full shrink-0 mt-1"
                style={{ background: config.color }}
              />
              {!isLast && <div className="w-px flex-1 bg-[#1E2535] mt-1" />}
            </div>
            <div className="pb-1">
              <span style={{ color: config.color }} className="font-semibold">
                {config.label}
              </span>
              <span className="text-[#7A7F98] ml-1.5">
                {formatRelativeTime(action.created_at)}
              </span>
              {action.reason && (
                <p className="text-[#7A7F98] mt-0.5 italic">&quot;{action.reason}&quot;</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────
// Right column — Risk Analysis Panel
// ─────────────────────────────────────────
function RiskAnalysisPanel({
  alert,
  actions,
}: {
  alert?: Alert;
  actions: AlertAction[];
}) {
  if (!alert) {
    return (
      <div className="bg-[#111827] border border-[#1E2535] rounded-xl p-5">
        <p className="text-[10px] text-[#7A7F98] uppercase tracking-[0.1em] font-semibold mb-4">
          Risk Score Analysis
        </p>
        <div className="flex flex-col items-center py-6">
          <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-3">
            <CheckCircle size={28} className="text-emerald-400" />
          </div>
          <p className="text-sm font-semibold text-[#E5E7EB]">Clean Transaction</p>
          <p className="text-[11px] text-[#7A7F98] mt-1">No fraud rules triggered.</p>
        </div>
      </div>
    );
  }

  const severity = getSeverityFromScore(alert.risk_score) as Severity;

  return (
    <div className="bg-[#111827] border border-[#1E2535] rounded-xl overflow-hidden">
      {/* Section header */}
      <div className="px-4 py-2.5 border-b border-[#1A2030] bg-[#0C1221]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9CA0B8]">
          Risk Score Analysis
        </p>
      </div>

      {/* Score gauge */}
      <RiskScoreGauge score={alert.risk_score} severity={severity} />

      {/* Explanation */}
      <div className="px-4 pb-4">
        <p className="text-[11px] text-[#8B8FA8] text-center leading-relaxed">
          This transaction exceeded the fraud threshold of 20/100 and
          {alert.risk_score >= 80
            ? ' requires immediate manual verification.'
            : alert.risk_score >= 60
            ? ' requires analyst review.'
            : ' has been flagged for monitoring.'}
        </p>
      </div>

      {/* Triggered rules */}
      {alert.triggered_rules && alert.triggered_rules.length > 0 && (
        <div className="px-4 pb-4">
          <p className="text-[10px] text-[#7A7F98] uppercase tracking-[0.1em] font-semibold mb-2">
            Triggered Rules ({alert.triggered_rules.length})
          </p>
          <div className="space-y-2">
            {alert.triggered_rules.map((rule, i) => (
              <TriggeredRuleCard key={i} rule={rule} />
            ))}
          </div>
        </div>
      )}

      {/* Action history */}
      <div className="px-4 pb-4 border-t border-[#1A2030] pt-3">
        <p className="text-[10px] text-[#7A7F98] uppercase tracking-[0.1em] font-semibold mb-2">
          Action History
        </p>
        <ActionHistory actions={actions} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────
export default function TransactionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { getAccessToken } = useAuth();

  const [transaction, setTransaction] = useState<TransactionDetail | null>(null);
  const [alertActions, setAlertActions] = useState<AlertAction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch transaction + related data
  const fetchTransaction = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);

    try {
      const token = getAccessToken();
      const res = await apiFetch(`/api/v1/transactions/${id}`, {}, token);

      if (!res.ok) {
        if (res.status === 404) throw new Error('Transaction not found');
        throw new Error('Failed to load transaction');
      }

      const data = await res.json();
      setTransaction(data);

      // Fetch alert actions if an alert exists
      if (data.alerts?.[0]?.id) {
        const alertRes = await apiFetch(
          `/api/v1/alerts/${data.alerts[0].id}`,
          {},
          token
        );
        if (alertRes.ok) {
          const alertData = await alertRes.json();
          setAlertActions(alertData.alert?.actions || []);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [id, getAccessToken]);

  useEffect(() => {
    fetchTransaction();
  }, [fetchTransaction]);

  // Determine if a geographic mismatch was triggered
  const topAlert = transaction?.alerts?.[0];
  const hasGeoMismatch = topAlert?.triggered_rules?.some(
    r => (r.ruleType || r.type || r.name || r.ruleName || '')
      .toLowerCase()
      .includes('geo')
  ) || false;

  // ── Loading state ──────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col h-full -m-6">
        {/* Header skeleton */}
        <div className="px-6 py-4 border-b border-[#1E2535] bg-[#0A0D16] shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-3 w-12 bg-[#131929] rounded animate-pulse" />
            <div className="w-px h-4 bg-[#1E2535]" />
            <div className="h-3 w-48 bg-[#131929] rounded animate-pulse" />
          </div>
        </div>
        <div className="flex-1 p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="bg-[#111827] rounded-xl border border-[#1E2535] animate-pulse"
              style={{ height: 420, opacity: 1 - i * 0.15 }}
            />
          ))}
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────
  if (error || !transaction) {
    return (
      <div className="flex flex-col items-center justify-center h-full -m-6">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
          <AlertTriangle size={28} className="text-red-400" />
        </div>
        <p className="text-sm text-[#C8CBD9] mb-1 font-medium">{error || 'Transaction not found'}</p>
        <p className="text-xs text-[#6B7094] mb-4">Unable to load transaction details.</p>
        <button
          onClick={() => router.push('/dashboard/alerts')}
          className="px-5 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-500 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0D16]"
        >
          Back to Alert Queue
        </button>
      </div>
    );
  }

  const isFlagged = transaction.status === 'flagged' || transaction.status === 'blocked';
  const severity = topAlert
    ? (getSeverityFromScore(topAlert.risk_score) as Severity)
    : 'clean';

  return (
    <div className="flex flex-col h-full -m-6">

      {/* ── Page Header ───────────────────────────────────────── */}
      <div className="px-5 py-3 border-b border-[#1E2535] bg-[#0A0D16] shrink-0">
        <div className="flex items-center justify-between">

          {/* Left: back + breadcrumb */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => router.push('/dashboard/alerts')}
              className="flex items-center gap-1.5 text-xs text-[#8B8FA8] hover:text-[#E5E7EB] transition-colors duration-150 cursor-pointer shrink-0 py-1 px-1.5 -ml-1.5 rounded hover:bg-white/[0.04]"
            >
              <ArrowLeft size={13} />
              Back
            </button>
            <div className="w-px h-5 bg-[#1E2535] shrink-0" />
            <nav className="flex items-center gap-1 text-[11px] min-w-0">
              <span className="text-[#6B7094] shrink-0">FraudScope</span>
              <span className="text-[#2A3148] shrink-0">/</span>
              <span className="text-[#6B7094] shrink-0">Investigation</span>
              <span className="text-[#2A3148] shrink-0">/</span>
              <span className="text-[#6B7094] shrink-0">Transactions</span>
              <span className="text-[#2A3148] shrink-0">/</span>
              <span className="text-[#D1D5E4] font-semibold font-mono truncate">
                {transaction.external_id.length > 24
                  ? `${transaction.external_id.slice(0, 10)}…${transaction.external_id.slice(-10)}`
                  : transaction.external_id}
              </span>
            </nav>
          </div>

          {/* Right: status + action buttons */}
          <div className="flex items-center gap-2.5 shrink-0 ml-4">
            {isFlagged && topAlert && (
              <>
                <span className="text-[10px] text-[#6B7094] font-mono">
                  Alert {topAlert.id?.slice(-8).toUpperCase()}
                </span>
                <div className="w-px h-5 bg-[#1E2535]" />
                <button
                  onClick={() => router.push('/dashboard/alerts')}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] font-bold border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/10 hover:border-red-500/50 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0A0D16]"
                >
                  <XCircle size={12} />
                  Reject
                </button>
                <button
                  onClick={() => router.push('/dashboard/alerts')}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0A0D16]"
                >
                  <CheckCheck size={12} />
                  Approve &amp; Close
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Three-Column Investigation Layout ─────────────────── */}
      <div className="flex-1 overflow-auto p-4">
        <div
          className="grid gap-4 h-full"
          style={{ gridTemplateColumns: '1fr 1.1fr 1fr' }}
        >

          {/* ── Column 1: Transaction Info ─────────────────────── */}
          <div className="space-y-4 overflow-auto min-w-0">
            <TransactionInfoPanel tx={transaction} topAlert={topAlert} />
          </div>

          {/* ── Column 2: Map + Timeline ───────────────────────── */}
          <div className="space-y-4 overflow-auto min-w-0">
            <MapSection
              tx={transaction}
              accountHistory={transaction.account_history || []}
              hasGeoMismatch={hasGeoMismatch}
            />
            <AccountTimeline
              history={transaction.account_history || []}
              currentTxId={transaction.id}
            />
          </div>

          {/* ── Column 3: Risk Analysis ────────────────────────── */}
          <div className="overflow-auto min-w-0">
            <RiskAnalysisPanel
              alert={topAlert}
              actions={alertActions}
            />
          </div>
        </div>
      </div>
    </div>
  );
}