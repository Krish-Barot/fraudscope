// apps/web/app/dashboard/alerts/page.tsx
// Alert Queue — matches Stitch design (Investigation / Queue panel)
'use client';

import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  AlertTriangle,
  CheckCircle,
  Search,
  Clock,
  ArrowUpDown,
  X,
  Filter,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../../lib/authContext';
import { useSocket } from '../../../hooks/useSocket';
import { useToast } from '../../../components/ui/Toast';
import { apiFetch } from '../../lib/api';
import {
  getSeverityFromScore,
  SEVERITY_TEXT,
  SEVERITY_BG,
  SEVERITY_HEX,
  type Severity,
} from '../../lib/severity';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────
interface TriggeredRule {
  rule_id?: string;
  name?: string;
  type?: string;
  ruleType?: string;
  ruleName?: string;
  score_contribution: number;
  details?: Record<string, unknown>;
}

interface Alert {
  id: string;
  transaction_id: string;
  risk_score: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'new' | 'reviewing' | 'dismissed' | 'escalated' | 'investigating';
  created_at: string;
  resolved_at?: string;
  assigned_to?: string;
  // Joined transaction data
  transaction?: {
    id: string;
    external_id: string;
    account_id: string;
    amount: number | string;
    currency: string;
    merchant_name?: string;
    country_code: string;
    channel?: string;
    created_at: string;
  };
  // Joined rule data
  triggered_rules?: TriggeredRule[];
}

type ActionType = 'dismiss' | 'investigate' | 'escalate';
type SortOption = 'risk_score:desc' | 'risk_score:asc' | 'created_at:desc' | 'created_at:asc';

// ─────────────────────────────────────────
// Utility: format relative time
// ─────────────────────────────────────────
function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatAmount(amount: number | string, currency: string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: currency || 'CAD',
    minimumFractionDigits: 2,
  }).format(num);
}

// ─────────────────────────────────────────
// Risk Score Circle component
// Large colored circle showing numeric risk score
// ─────────────────────────────────────────
function RiskScoreCircle({ score, severity }: {
  score: number;
  severity: Severity;
}) {
  const color = SEVERITY_HEX[severity];

  return (
    <div
      className="relative flex items-center justify-center shrink-0"
      style={{ width: 56, height: 56 }}
    >
      {/* SVG ring */}
      <svg width="56" height="56" className="absolute inset-0 -rotate-90">
        {/* Background ring */}
        <circle
          cx="28" cy="28" r="24"
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="4"
        />
        {/* Score arc */}
        <circle
          cx="28" cy="28" r="24"
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * 150.8} 150.8`}
          style={{ transition: 'stroke-dasharray 0.5s ease' }}
        />
      </svg>

      {/* Score number */}
      <span
        className="relative font-mono font-bold text-sm leading-none"
        style={{ color }}
      >
        {score}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────
// Rule Pill component
// ─────────────────────────────────────────
function RulePill({ rule }: { rule: TriggeredRule }) {
  const label = rule.ruleName || rule.name || rule.ruleType || rule.type || 'rule';
  const formattedLabel = label
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-[#1E2535] text-[#8B8FA8] border border-[#2A3145]">
      {formattedLabel}
      {rule.score_contribution > 0 && (
        <span className="text-[#4A4F6A]">+{rule.score_contribution}</span>
      )}
    </span>
  );
}

// ─────────────────────────────────────────
// Status Badge for alerts
// ─────────────────────────────────────────
function AlertStatusBadge({ status }: { status: Alert['status'] }) {
  const styles: Record<Alert['status'], string> = {
    new: 'bg-blue-400/10 text-blue-400',
    reviewing: 'bg-amber-400/10 text-amber-400',
    investigating: 'bg-purple-400/10 text-purple-400',
    dismissed: 'bg-slate-400/10 text-slate-500',
    escalated: 'bg-red-400/10 text-red-400',
  };

  return (
    <span className={clsx(
      'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize',
      styles[status]
    )}>
      {status}
    </span>
  );
}

// ─────────────────────────────────────────
// Action Modal component
// ─────────────────────────────────────────
interface ActionModalProps {
  alertId: string;
  action: ActionType;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

function ActionModal({
  alertId,
  action,
  onConfirm,
  onCancel,
  isSubmitting,
}: ActionModalProps) {
  const [reason, setReason] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const isValid = reason.trim().length >= 10;

  const actionConfig: Record<ActionType, {
    title: string;
    description: string;
    buttonLabel: string;
    buttonClass: string;
    icon: React.ReactNode;
  }> = {
    dismiss: {
      title: 'Dismiss Alert',
      description: 'Mark this alert as a false positive. Provide a reason for dismissal.',
      buttonLabel: 'Dismiss Alert',
      buttonClass: 'bg-slate-600 hover:bg-slate-500 text-white',
      icon: <CheckCircle size={16} className="text-slate-400" />,
    },
    investigate: {
      title: 'Mark for Investigation',
      description: 'Flag this alert for further investigation. It will remain in the queue.',
      buttonLabel: 'Start Investigation',
      buttonClass: 'bg-purple-600 hover:bg-purple-500 text-white',
      icon: <Search size={16} className="text-purple-400" />,
    },
    escalate: {
      title: 'Escalate Alert',
      description: 'Escalate this as confirmed fraud. This will trigger immediate review.',
      buttonLabel: 'Escalate',
      buttonClass: 'bg-red-600 hover:bg-red-500 text-white',
      icon: <AlertTriangle size={16} className="text-red-400" />,
    },
  };

  const config = actionConfig[action];

  // Handle Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-full max-w-md bg-[#131929] border border-[#1E2535] rounded-2xl shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1E2535]">
          <div className="flex items-center gap-2">
            {config.icon}
            <h2 className="text-base font-semibold text-[#F1F3FA]">
              {config.title}
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="text-[#4A4F6A] hover:text-[#F1F3FA] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          <p className="text-sm text-[#8B8FA8]">{config.description}</p>

          <div>
            <label className="block text-xs font-medium text-[#8B8FA8] mb-1.5 uppercase tracking-wider">
              Reason <span className="text-[#4A4F6A]">(minimum 10 characters)</span>
            </label>
            <textarea
              ref={inputRef}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Describe your reasoning..."
              rows={4}
              className={clsx(
                'w-full px-3 py-2.5 bg-[#0D0F1A] border rounded-lg text-sm',
                'text-[#F1F3FA] placeholder-[#4A4F6A] resize-none',
                'focus:outline-none focus:ring-1 transition-colors',
                isValid
                  ? 'border-[#1E2535] focus:border-blue-500 focus:ring-blue-500'
                  : reason.length > 0
                    ? 'border-red-800 focus:border-red-500 focus:ring-red-500'
                    : 'border-[#1E2535] focus:border-blue-500 focus:ring-blue-500'
              )}
            />
            <div className="flex justify-between mt-1">
              <span className={clsx(
                'text-xs',
                isValid ? 'text-emerald-400' : 'text-[#4A4F6A]'
              )}>
                {reason.trim().length}/10 minimum
              </span>
              {!isValid && reason.length > 0 && (
                <span className="text-xs text-red-400">
                  {10 - reason.trim().length} more characters needed
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#1E2535]">
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm text-[#8B8FA8] hover:text-[#F1F3FA] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => isValid && onConfirm(reason.trim())}
            disabled={!isValid || isSubmitting}
            className={clsx(
              'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              config.buttonClass,
              'flex items-center gap-2'
            )}
          >
            {isSubmitting && (
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {config.buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Alert Card component
// ─────────────────────────────────────────
interface AlertCardProps {
  alert: Alert;
  onAction: (alertId: string, action: ActionType) => void;
  isActing: boolean;
}

function AlertCard({ alert, onAction, isActing }: AlertCardProps) {
  const router = useRouter();
  const severity = getSeverityFromScore(alert.risk_score) as Severity;
  const tx = alert.transaction;
  const borderColor = SEVERITY_HEX[severity];

  const isTerminal = ['dismissed', 'escalated'].includes(alert.status);

  return (
    <div
      className={clsx(
        'bg-[#131929] border border-[#1E2535] rounded-xl overflow-hidden',
        'transition-all duration-150',
        isTerminal && 'opacity-60',
      )}
      style={{
        boxShadow: `inset 3px 0 0 ${borderColor}`,
      }}
    >
      <div className="p-4">
        <div className="flex items-start gap-4">

          {/* Risk score circle */}
          <RiskScoreCircle score={alert.risk_score} severity={severity} />

          {/* Main content */}
          <div className="flex-1 min-w-0">

            {/* Top row: TX ID + status + time */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <button
                onClick={() => tx && router.push(`/dashboard/transactions/${alert.transaction_id}`)}
                className="font-mono text-sm font-semibold text-[#F1F3FA] hover:text-blue-400 transition-colors"
              >
                {tx?.external_id
                  ? `#${tx.external_id.slice(-8).toUpperCase()}`
                  : `#${alert.transaction_id.slice(-8).toUpperCase()}`
                }
              </button>

              <AlertStatusBadge status={alert.status} />

              <span className="text-xs text-[#4A4F6A] flex items-center gap-1 ml-auto">
                <Clock size={11} />
                {formatRelativeTime(alert.created_at)}
              </span>
            </div>

            {/* Transaction details grid */}
            {tx && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                {[
                  { label: 'ACCOUNT', value: tx.account_id },
                  { label: 'AMOUNT', value: formatAmount(tx.amount, tx.currency) },
                  { label: 'MERCHANT', value: tx.merchant_name || '—' },
                  { label: 'COUNTRY', value: tx.country_code },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs text-[#4A4F6A] uppercase tracking-wider mb-0.5">
                      {label}
                    </p>
                    <p className="text-xs font-mono text-[#F1F3FA] truncate" title={value}>
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Triggered rule pills */}
            {alert.triggered_rules && alert.triggered_rules.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {alert.triggered_rules.map((rule, i) => (
                  <RulePill key={i} rule={rule} />
                ))}
              </div>
            )}

            {/* Action buttons */}
            {!isTerminal && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onAction(alert.id, 'dismiss')}
                  disabled={isActing}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium',
                    'border border-[#2A3145] text-[#8B8FA8]',
                    'hover:border-slate-500 hover:text-[#F1F3FA]',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                    'transition-colors duration-150'
                  )}
                >
                  <CheckCircle size={12} />
                  Dismiss
                </button>

                <button
                  onClick={() => onAction(alert.id, 'investigate')}
                  disabled={isActing}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium',
                    'border border-purple-800/50 text-purple-400',
                    'hover:border-purple-600 hover:bg-purple-500/10',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                    'transition-colors duration-150'
                  )}
                >
                  <Search size={12} />
                  Investigate
                </button>

                <button
                  onClick={() => onAction(alert.id, 'escalate')}
                  disabled={isActing}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium',
                    'border border-red-800/50 text-red-400',
                    'hover:border-red-600 hover:bg-red-500/10',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                    'transition-colors duration-150'
                  )}
                >
                  <AlertTriangle size={12} />
                  Escalate
                </button>
              </div>
            )}

            {/* Terminal state message */}
            {isTerminal && (
              <p className="text-xs text-[#4A4F6A] italic">
                {alert.status === 'dismissed' ? '✓ Dismissed as false positive' : '⚑ Escalated for review'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Summary Bar component
// Shows total count + breakdown by severity
// ─────────────────────────────────────────
function SummaryBar({ alerts }: { alerts: Alert[] }) {
  const counts = {
    total: alerts.length,
    critical: alerts.filter(a => a.severity === 'critical').length,
    high: alerts.filter(a => a.severity === 'high').length,
    medium: alerts.filter(a => a.severity === 'medium').length,
    low: alerts.filter(a => a.severity === 'low').length,
  };

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <span className="text-sm font-semibold text-[#F1F3FA]">
        {counts.total} alert{counts.total !== 1 ? 's' : ''}
      </span>

      <div className="flex items-center gap-3">
        {[
          { label: 'critical', count: counts.critical, color: 'text-red-400' },
          { label: 'high', count: counts.high, color: 'text-orange-400' },
          { label: 'medium', count: counts.medium, color: 'text-amber-400' },
          { label: 'low', count: counts.low, color: 'text-blue-400' },
        ].filter(s => s.count > 0).map(({ label, count, color }) => (
          <span key={label} className="flex items-center gap-1 text-sm">
            <span className={clsx('font-bold font-mono', color)}>{count}</span>
            <span className="text-[#4A4F6A] capitalize">{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────
export default function AlertsPage() {
  const { getAccessToken } = useAuth();
  const { connected, on, off } = useSocket();
  const { addToast } = useToast();

  // ── State ──────────────────────────────────────────────────────
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [severityFilter, setSeverityFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [sortBy, setSortBy] = useState<SortOption>('risk_score:desc');

  // Action modal state
  const [activeModal, setActiveModal] = useState<{
    alertId: string;
    action: ActionType;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actingAlertId, setActingAlertId] = useState<string | null>(null);

  // ── Fetch alerts ───────────────────────────────────────────────
  const fetchAlerts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const token = getAccessToken();

      // Build query params
      const statusParam = statusFilter === 'active'
        ? 'new,reviewing,investigating'
        : statusFilter === 'resolved'
          ? 'dismissed,escalated'
          : 'new,reviewing,investigating,dismissed,escalated';

      const res = await apiFetch(
        `/api/v1/alerts?status=${statusParam}&sort=${sortBy}&limit=50`,
        {},
        token
      );

      if (!res.ok) throw new Error('Failed to fetch alerts');

      const data = await res.json();
      setAlerts(data.data || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken, statusFilter, sortBy]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  // ── Socket: new alert ──────────────────────────────────────────
  const handleAlertNew = useCallback((alertData: any) => {
    const newAlert: Alert = {
      id: alertData.id,
      transaction_id: alertData.transaction_id,
      risk_score: alertData.risk_score,
      severity: alertData.severity,
      status: 'new',
      created_at: alertData.created_at || new Date().toISOString(),
      transaction: alertData.transaction,
      triggered_rules: alertData.triggered_rules,
    };

    setError(null);
    setAlerts(prev => {
      // Don't add duplicate
      if (prev.some(a => a.id === newAlert.id)) return prev;
      return [newAlert, ...prev];
    });

    addToast({
      type: 'info',
      message: `New ${alertData.severity} alert — ${alertData.transaction?.account_id || 'unknown account'}`,
      duration: 5000,
    });
  }, [addToast]);

  // ── Socket: alert updated by another analyst ───────────────────
  const handleAlertUpdated = useCallback((updateData: any) => {
    const alertId = updateData.alert_id || updateData.alertId;
    const newStatus = updateData.new_status || updateData.status;
    const { analyst, action } = updateData;

    if (!alertId || !newStatus) return;

    setError(null);
    setAlerts(prev =>
      prev.map(alert =>
        alert.id === alertId
          ? { ...alert, status: newStatus }
          : alert
      )
    );

    // Notify current analyst
    if (analyst) {
      const actionLabel = action === 'dismiss' ? 'dismissed'
        : action === 'escalate' ? 'escalated'
          : action === 'investigate' ? 'is investigating'
            : 'updated';

      addToast({
        type: 'info',
        message: `${analyst} ${actionLabel} alert #${alertId.slice(-6).toUpperCase()}`,
        duration: 4000,
      });
    }
  }, [addToast]);

  // ── Subscribe to socket events ─────────────────────────────────
  useEffect(() => {
    if (!connected) return;
    on('alert:new', handleAlertNew);
    on('alert:updated', handleAlertUpdated);
    return () => {
      off('alert:new', handleAlertNew);
      off('alert:updated', handleAlertUpdated);
    };
  }, [connected, on, off, handleAlertNew, handleAlertUpdated]);

  // ── Handle action button click ─────────────────────────────────
  function handleAction(alertId: string, action: ActionType) {
    setActiveModal({ alertId, action });
  }

  // ── Handle modal confirm ───────────────────────────────────────
  async function handleConfirm(reason: string) {
    if (!activeModal) return;
    const { alertId, action } = activeModal;

    setIsSubmitting(true);
    setActingAlertId(alertId);

    // Optimistic update — immediately reflect the change
    const newStatus = action === 'dismiss' ? 'dismissed'
      : action === 'escalate' ? 'escalated'
        : 'investigating';

    setAlerts(prev =>
      prev.map(a => a.id === alertId ? { ...a, status: newStatus as Alert['status'] } : a)
    );

    setActiveModal(null);

    try {
      const token = getAccessToken();
      const res = await apiFetch(
        `/api/v1/alerts/${alertId}/actions`,
        {
          method: 'POST',
          body: JSON.stringify({ action, reason }),
        },
        token
      );

      if (!res.ok) {
        // Revert optimistic update on failure
        const data = await res.json();
        throw new Error(data.error?.message || 'Action failed');
      }

      addToast({
        type: 'success',
        message: `Alert ${action === 'dismiss' ? 'dismissed' : action === 'escalate' ? 'escalated' : 'flagged for investigation'}`,
      });
    } catch (err) {
      // Revert on error
      setAlerts(prev =>
        prev.map(a => a.id === alertId ? { ...a, status: 'new' } : a)
      );
      addToast({
        type: 'error',
        message: (err as Error).message || 'Action failed. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
      setActingAlertId(null);
    }
  }

  // ── Filter and sort alerts for display ────────────────────────
  const displayAlerts = alerts.filter(alert => {
    if (severityFilter.size > 0 && !severityFilter.has(alert.severity)) {
      return false;
    }
    return true;
  });

  // ─────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────
  return (
    <div className="flex flex-col h-full -m-6">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="px-6 py-4 border-b border-[#1E2535] bg-[#0D0F1A] shrink-0">

        {/* Title row */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-base font-semibold text-[#F1F3FA]">Alert Queue</h1>
            <p className="text-xs text-[#4A4F6A] mt-0.5">
              {connected ? '● Live' : '○ Offline'} — updates in real time
            </p>
          </div>

          {/* Refresh button */}
          <button
            onClick={fetchAlerts}
            disabled={isLoading}
            className="text-xs text-[#8B8FA8] hover:text-[#F1F3FA] transition-colors disabled:opacity-40"
          >
            ↻ Refresh
          </button>
        </div>

        {/* Summary bar */}
        {!isLoading && <SummaryBar alerts={displayAlerts} />}
      </div>

      {/* ── Filter bar ──────────────────────────────────────────── */}
      <div className="px-6 py-2.5 border-b border-[#1E2535] bg-[#0A0D16] shrink-0">
        <div className="flex items-center gap-4 flex-wrap">

          {/* Severity checkboxes */}
          <div className="flex items-center gap-1">
            <Filter size={12} className="text-[#4A4F6A] mr-1" />
            {(['critical', 'high', 'medium', 'low'] as const).map(sev => {
              const colors: Record<string, string> = {
                critical: 'border-red-500 text-red-400',
                high: 'border-orange-500 text-orange-400',
                medium: 'border-amber-500 text-amber-400',
                low: 'border-blue-500 text-blue-400',
              };
              const isActive = severityFilter.has(sev);

              return (
                <button
                  key={sev}
                  onClick={() => {
                    setSeverityFilter(prev => {
                      const next = new Set(prev);
                      if (next.has(sev)) next.delete(sev);
                      else next.add(sev);
                      return next;
                    });
                  }}
                  className={clsx(
                    'px-2 py-0.5 rounded text-xs font-medium border capitalize transition-colors',
                    isActive
                      ? colors[sev] + ' bg-opacity-10'
                      : 'border-[#1E2535] text-[#4A4F6A] hover:border-[#2A3145] hover:text-[#8B8FA8]'
                  )}
                >
                  {sev}
                </button>
              );
            })}
            {severityFilter.size > 0 && (
              <button
                onClick={() => setSeverityFilter(new Set())}
                className="text-xs text-[#4A4F6A] hover:text-[#8B8FA8] ml-1"
              >
                ✕ clear
              </button>
            )}
          </div>

          {/* Status dropdown */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-[#4A4F6A]">Status:</label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="bg-[#131929] border border-[#1E2535] rounded text-xs text-[#8B8FA8] px-2 py-1 focus:outline-none focus:border-blue-500"
            >
              <option value="active">Active (new, reviewing)</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </select>
          </div>

          {/* Sort dropdown */}
          <div className="flex items-center gap-1.5 ml-auto">
            <ArrowUpDown size={11} className="text-[#4A4F6A]" />
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortOption)}
              className="bg-[#131929] border border-[#1E2535] rounded text-xs text-[#8B8FA8] px-2 py-1 focus:outline-none focus:border-blue-500"
            >
              <option value="risk_score:desc">Risk Score (High → Low)</option>
              <option value="risk_score:asc">Risk Score (Low → High)</option>
              <option value="created_at:desc">Newest First</option>
              <option value="created_at:asc">Oldest First</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Alert list ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {isLoading ? (
          // Loading skeleton
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-32 bg-[#131929] rounded-xl animate-pulse border border-[#1E2535]"
                style={{ opacity: 1 - i * 0.1 }}
              />
            ))}
          </div>
        ) : error ? (
          // Error state
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <AlertTriangle size={32} className="text-red-400 mb-3" />
            <p className="text-sm text-[#8B8FA8] mb-2">Failed to load alerts</p>
            <p className="text-xs text-[#4A4F6A] mb-4">{error}</p>
            <button
              onClick={fetchAlerts}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : displayAlerts.length === 0 ? (
          // Empty state
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <CheckCircle size={32} className="text-emerald-400 mb-3" />
            <p className="text-sm font-medium text-[#F1F3FA] mb-1">All clear</p>
            <p className="text-xs text-[#4A4F6A]">
              {severityFilter.size > 0
                ? 'No alerts match the selected filters'
                : 'No pending alerts in the queue'
              }
            </p>
          </div>
        ) : (
          // Alert cards
          <div className="space-y-3">
            {displayAlerts.map(alert => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onAction={handleAction}
                isActing={actingAlertId === alert.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <div className="shrink-0 px-6 py-2 border-t border-[#1E2535] bg-[#0D0F1A]">
        <span className="text-xs text-[#4A4F6A] font-mono">
          {displayAlerts.length} alert{displayAlerts.length !== 1 ? 's' : ''} displayed
          {severityFilter.size > 0 && ` (${severityFilter.size} severity filter${severityFilter.size > 1 ? 's' : ''} active)`}
        </span>
      </div>

      {/* ── Action Modal ─────────────────────────────────────────── */}
      {activeModal && (
        <ActionModal
          alertId={activeModal.alertId}
          action={activeModal.action}
          onConfirm={handleConfirm}
          onCancel={() => setActiveModal(null)}
          isSubmitting={isSubmitting}
        />
      )}
    </div>
  );
}