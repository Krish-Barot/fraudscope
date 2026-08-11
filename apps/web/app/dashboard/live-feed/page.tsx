// apps/web/app/dashboard/live-feed/page.tsx
// Live Transaction Feed — matches Stitch design
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Pause, Radio, Filter } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../../lib/authContext';
import { useSocket } from '../../../hooks/useSocket';
import { apiFetch } from '../../lib/api';
import { countryToFlag } from '../../lib/countryFlags';
import {
  getSeverityFromScore,
  SEVERITY_TEXT,
  SEVERITY_BG,
  SEVERITY_BORDER,
  SEVERITY_HEX,
  type Severity,
} from '../../lib/severity';

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
  country_code: string;
  channel?: string;
  status: 'clean' | 'flagged' | 'blocked';
  created_at: string;
  // Added by real-time event when alert exists
  risk_score?: number;
  severity?: Severity;
}

type FilterMode = 'all' | 'flagged' | 'critical';

// ─────────────────────────────────────────
// Utility: format timestamp as HH:MM:SS
// ─────────────────────────────────────────
function formatTime(isoString: string): string {
  try {
    return new Date(isoString).toLocaleTimeString('en-CA', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '--:--:--';
  }
}

// ─────────────────────────────────────────
// Utility: format amount
// ─────────────────────────────────────────
function formatAmount(amount: string | number, currency: string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: currency || 'CAD',
    minimumFractionDigits: 2,
  }).format(num);
}

// ─────────────────────────────────────────
// Utility: truncate transaction ID for display
// e.g. "SIM-1234567890-abc12345" → "SIM-...abc12345"
// ─────────────────────────────────────────
function truncateTxId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 6)}...${id.slice(-8)}`;
}

// ─────────────────────────────────────────
// Status Badge component
// ─────────────────────────────────────────
function StatusBadge({ status, riskScore }: {
  status: Transaction['status'];
  riskScore?: number;
}) {
  if (status === 'clean' || !riskScore) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium font-mono bg-emerald-400/10 text-emerald-400">
        CLEAN
      </span>
    );
  }

  const severity = getSeverityFromScore(riskScore);

  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium font-mono',
      SEVERITY_BG[severity],
      SEVERITY_TEXT[severity]
    )}>
      {severity.toUpperCase()} {riskScore}
    </span>
  );
}

// ─────────────────────────────────────────
// Transaction Row component
// ─────────────────────────────────────────
function TransactionRow({
  tx,
  isNew,
  onClick,
}: {
  tx: Transaction;
  isNew: boolean;
  onClick: () => void;
}) {
  const isFlagged = tx.status === 'flagged' || tx.status === 'blocked';
  const severity = tx.risk_score
    ? getSeverityFromScore(tx.risk_score)
    : tx.status === 'flagged' ? 'medium' : 'clean';

  const borderColor = isFlagged ? SEVERITY_HEX[severity] : 'transparent';
  const amount = typeof tx.amount === 'string' ? parseFloat(tx.amount) : tx.amount;

  return (
    <tr
      onClick={onClick}
      className={clsx(
        'group border-b border-[#1E2535] cursor-pointer transition-colors duration-150',
        'hover:bg-white/[0.03]',
        isNew && 'animate-fadeIn'
      )}
      style={{
        boxShadow: isFlagged ? `inset 3px 0 0 ${borderColor}` : undefined,
      }}
    >
      {/* Timestamp */}
      <td className="py-2 pl-4 pr-3 whitespace-nowrap">
        <span className="font-mono text-xs text-[#8B8FA8]">
          {formatTime(tx.created_at)}
        </span>
      </td>

      {/* Transaction ID */}
      <td className="py-2 px-3 whitespace-nowrap">
        <span className="font-mono text-xs text-[#F1F3FA] group-hover:text-blue-400 transition-colors">
          {truncateTxId(tx.external_id)}
        </span>
      </td>

      {/* Account ID */}
      <td className="py-2 px-3 whitespace-nowrap">
        <span className="font-mono text-xs text-[#8B8FA8]">
          {tx.account_id}
        </span>
      </td>

      {/* Amount */}
      <td className="py-2 px-3 whitespace-nowrap text-right">
        <span className={clsx(
          'font-mono text-xs font-medium',
          isFlagged ? SEVERITY_TEXT[severity] : 'text-[#F1F3FA]'
        )}>
          {formatAmount(amount, tx.currency)}
        </span>
      </td>

      {/* Merchant */}
      <td className="py-2 px-3">
        <span className="text-xs text-[#8B8FA8] truncate block max-w-[120px]">
          {tx.merchant_name || '—'}
        </span>
      </td>

      {/* Country */}
      <td className="py-2 px-3 whitespace-nowrap">
        <span className="text-sm" title={tx.country_code}>
          {countryToFlag(tx.country_code)}
        </span>
        <span className="ml-1 text-xs text-[#4A4F6A] font-mono">
          {tx.country_code}
        </span>
      </td>

      {/* Status */}
      <td className="py-2 pl-3 pr-4 whitespace-nowrap">
        <StatusBadge status={tx.status} riskScore={tx.risk_score} />
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────
// Main Page Component
// ─────────────────────────────────────────
export default function LiveFeedPage() {
  const router = useRouter();
  const { getAccessToken } = useAuth();
  const { connected, on, off, emit } = useSocket();

  // ── State ──────────────────────────────────────────────────────
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [newCountWhilePaused, setNewCountWhilePaused] = useState(0);

  // Track which rows are "new" for the fade-in animation
  const [newTxIds, setNewTxIds] = useState<Set<string>>(new Set());

  // Buffer for transactions received while paused
  const pauseBufferRef = useRef<Transaction[]>([]);

  // ── Fetch initial transactions ─────────────────────────────────
  useEffect(() => {
    async function fetchInitial() {
      setIsLoading(true);
      try {
        const token = getAccessToken();
        const res = await apiFetch(
          '/api/v1/transactions?limit=50&sort=created_at:desc',
          {},
          token
        );

        if (res.ok) {
          const data = await res.json();
          setTransactions(data.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch initial transactions:', err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchInitial();
  }, [getAccessToken]);

  // ── Handle incoming transactions ───────────────────────────────
  const handleNewTransaction = useCallback((txData: any) => {
    const newTx: Transaction = {
      id: txData.id,
      external_id: txData.id,
      account_id: txData.account_id,
      amount: txData.amount,
      currency: txData.currency,
      merchant_name: txData.merchant_name,
      country_code: txData.country_code,
      channel: txData.channel,
      status: txData.status || 'clean',
      created_at: txData.created_at || new Date().toISOString(),
      risk_score: txData.risk_score,
    };

    if (isPaused) {
      pauseBufferRef.current = [newTx, ...pauseBufferRef.current].slice(0, 200);
      setNewCountWhilePaused(prev => prev + 1);
      return;
    }

    setTransactions(prev => {
      const updated = [newTx, ...prev].slice(0, 200);
      return updated;
    });

    setNewTxIds(prev => new Set([...prev, newTx.id]));
    setTimeout(() => {
      setNewTxIds(prev => {
        const next = new Set(prev);
        next.delete(newTx.id);
        return next;
      });
    }, 1500);
  }, [isPaused]);

  // ── Handle alert updates ───────────────────────────────────────
  const handleAlertNew = useCallback((alertData: any) => {
    setTransactions(prev =>
      prev.map(tx =>
        tx.id === alertData.transaction_id
          ? {
              ...tx,
              status: 'flagged' as const,
              risk_score: alertData.risk_score,
              severity: alertData.severity as Severity,
            }
          : tx
      )
    );
  }, []);

  // ── Subscribe to Socket.io events ──────────────────────────────
  useEffect(() => {
    if (!connected) return;

    emit('subscribe', { channels: ['tx:live', 'alerts'] });
    on('tx:new', handleNewTransaction);
    on('alert:new', handleAlertNew);

    return () => {
      off('tx:new', handleNewTransaction);
      off('alert:new', handleAlertNew);
    };
  }, [connected, on, off, emit, handleNewTransaction, handleAlertNew]);

  // ── Pause / Play ───────────────────────────────────────────────
  function handlePauseToggle() {
    if (isPaused) {
      if (pauseBufferRef.current.length > 0) {
        setTransactions(prev => {
          const combined = [...pauseBufferRef.current, ...prev].slice(0, 200);
          pauseBufferRef.current = [];
          return combined;
        });
      }
      setNewCountWhilePaused(0);
      setIsPaused(false);
    } else {
      setIsPaused(true);
    }
  }

  // ── Filter transactions for display ───────────────────────────
  const filteredTransactions = transactions.filter(tx => {
    if (filterMode === 'all') return true;
    if (filterMode === 'flagged') return tx.status === 'flagged' || tx.status === 'blocked';
    if (filterMode === 'critical') {
      return tx.risk_score !== undefined && getSeverityFromScore(tx.risk_score) === 'critical';
    }
    return true;
  });

  const flaggedCount = transactions.filter(
    tx => tx.status === 'flagged' || tx.status === 'blocked'
  ).length;

  const criticalCount = transactions.filter(
    tx => tx.risk_score !== undefined && getSeverityFromScore(tx.risk_score) === 'critical'
  ).length;

  return (
    <div className="flex flex-col h-full -m-6">
      {/* Top Control Bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[#1E2535] bg-[#0D0F1A] shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-[#F1F3FA]">
            Live Transaction Feed
          </h1>
          <div className="flex items-center gap-1.5">
            <div className={clsx(
              'w-1.5 h-1.5 rounded-full',
              connected && !isPaused ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
            )} />
            <span className="text-xs text-[#8B8FA8] font-mono">
              {isPaused
                ? `PAUSED — ${newCountWhilePaused} new`
                : connected ? 'LIVE' : 'OFFLINE'
              }
            </span>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 bg-[#131929] rounded-lg p-1 border border-[#1E2535]">
          {([ 
            { mode: 'all' as FilterMode,      label: 'ALL',      count: transactions.length },
            { mode: 'flagged' as FilterMode,  label: 'FLAGGED',  count: flaggedCount },
            { mode: 'critical' as FilterMode, label: 'CRITICAL', count: criticalCount },
          ]).map(({ mode, label, count }) => (
            <button
              key={mode}
              onClick={() => setFilterMode(mode)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium font-mono transition-colors',
                filterMode === mode
                  ? 'bg-[#3882F6] text-white'
                  : 'text-[#8B8FA8] hover:text-[#F1F3FA] hover:bg-white/5'
              )}
            >
              {label}
              <span className={clsx(
                'text-xs rounded px-1',
                filterMode === mode
                  ? 'bg-white/20 text-white'
                  : 'bg-[#1E2535] text-[#4A4F6A]'
              )}>
                {count}
              </span>
            </button>
          ))}
        </div>

        {/* Pause/Play button */}
        <div className="flex items-center gap-2">
          {isPaused && newCountWhilePaused > 0 && (
            <span className="text-xs text-amber-400 font-mono animate-pulse">
              +{newCountWhilePaused} waiting
            </span>
          )}
          <button
            onClick={handlePauseToggle}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border',
              isPaused
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                : 'bg-[#131929] border-[#1E2535] text-[#8B8FA8] hover:text-[#F1F3FA] hover:bg-white/5'
            )}
          >
            {isPaused
              ? <><Play size={12} /> Resume</>
              : <><Pause size={12} /> Pause</>
            }
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 15 }).map((_, i) => (
              <div
                key={i}
                className="h-9 bg-[#131929] rounded animate-pulse"
                style={{ opacity: 1 - i * 0.05 }}
              />
            ))}
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-[#0D0F1A] border-b border-[#1E2535]">
              <tr>
                {[
                  { label: 'TIME',        className: 'pl-4 pr-3 w-24' },
                  { label: 'TX ID',       className: 'px-3 w-40' },
                  { label: 'ACCOUNT',     className: 'px-3 w-32' },
                  { label: 'AMOUNT',      className: 'px-3 w-28 text-right' },
                  { label: 'MERCHANT',    className: 'px-3' },
                  { label: 'COUNTRY',     className: 'px-3 w-24' },
                  { label: 'STATUS',      className: 'pl-3 pr-4 w-32' },
                ].map(col => (
                  <th
                    key={col.label}
                    className={clsx(
                      'py-2.5 text-left text-xs font-semibold text-[#4A4F6A] tracking-widest',
                      col.className
                    )}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-16 text-[#4A4F6A] text-sm">
                    {filterMode === 'all'
                      ? 'Waiting for transactions...'
                      : `No ${filterMode} transactions`
                    }
                  </td>
                </tr>
              ) : (
                filteredTransactions.map(tx => (
                  <TransactionRow
                    key={tx.id}
                    tx={tx}
                    isNew={newTxIds.has(tx.id)}
                    onClick={() => router.push(`/dashboard/transactions/${tx.id}`)}
                  />
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer status bar */}
      <div className="shrink-0 px-6 py-2 border-t border-[#1E2535] bg-[#0D0F1A] flex items-center justify-between">
        <span className="text-xs text-[#4A4F6A] font-mono">
          Showing {filteredTransactions.length} of {transactions.length} transactions
          {filterMode !== 'all' && ` (${filterMode} filter active)`}
        </span>
        <span className="text-xs text-[#4A4F6A] font-mono">
          Cap: {transactions.length}/200
        </span>
      </div>
    </div>
  );
}
