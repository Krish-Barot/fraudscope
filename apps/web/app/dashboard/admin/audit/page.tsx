// apps/web/app/dashboard/admin/audit/page.tsx
// System Audit Logs
'use client';

import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Filter,
  Calendar,
  X,
  ExternalLink,
  Clock,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../../../lib/authContext';
import { useToast } from '../../../../components/ui/Toast';
import { apiFetch } from '../../../lib/api';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────
interface AuditLog {
  id: string;
  event_type: string;
  actor_type: 'user' | 'system';
  actor_id: string | null;
  actor: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
  } | null;
  target_type: string | null;
  target_id: string | null;
  payload: Record<string, unknown> | null;
  ip_address: string | null;
  source: string | null;
  created_at: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

type DatePreset = '24h' | '7d' | '30d' | 'all' | 'custom';

// ─────────────────────────────────────────
// Event type → category mapping
// ─────────────────────────────────────────
function getEventCategory(eventType: string): string {
  if (eventType.startsWith('transaction.')) return 'transaction';
  if (eventType.startsWith('alert.'))       return 'alert';
  if (eventType.startsWith('rule.'))        return 'rule';
  if (eventType.startsWith('user.'))        return 'user';
  return 'system';
}

// Category → color config
const CATEGORY_STYLES: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  transaction: {
    bg: 'rgba(56,130,246,0.10)',
    text: '#60a5fa',
    border: 'rgba(56,130,246,0.25)',
    dot: '#3882F6',
  },
  alert: {
    bg: 'rgba(245,158,11,0.10)',
    text: '#fbbf24',
    border: 'rgba(245,158,11,0.25)',
    dot: '#F59E0B',
  },
  rule: {
    bg: 'rgba(167,139,250,0.10)',
    text: '#a78bfa',
    border: 'rgba(167,139,250,0.25)',
    dot: '#A78BFA',
  },
  user: {
    bg: 'rgba(52,211,153,0.10)',
    text: '#34d399',
    border: 'rgba(52,211,153,0.25)',
    dot: '#34D399',
  },
  system: {
    bg: 'rgba(148,163,184,0.10)',
    text: '#94a3b8',
    border: 'rgba(148,163,184,0.20)',
    dot: '#94A3B8',
  },
};

// ─────────────────────────────────────────
// Event type badge
// ─────────────────────────────────────────
function EventTypeBadge({ eventType }: { eventType: string }) {
  const category = getEventCategory(eventType);
  const style = CATEGORY_STYLES[category];

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium font-mono whitespace-nowrap"
      style={{ background: style.bg, color: style.text, border: `1px solid ${style.border}` }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: style.dot }}
      />
      {eventType}
    </span>
  );
}

// ─────────────────────────────────────────
// Target link — navigates to the relevant page
// ─────────────────────────────────────────
function TargetLink({
  targetType,
  targetId,
}: {
  targetType: string | null;
  targetId: string | null;
}) {
  const router = useRouter();

  if (!targetType || !targetId) {
    return <span className="text-xs text-[#4A4F6A]">—</span>;
  }

  // Map target_type to navigation path
  const getPath = (): string | null => {
    switch (targetType) {
      case 'transaction': return `/dashboard/transactions/${targetId}`;
      case 'alert':       return `/dashboard/alerts`;
      case 'rule':        return `/dashboard/admin/rules`;
      case 'user':        return `/dashboard/admin/users`;
      default:            return null;
    }
  };

  const path = getPath();
  const shortId = targetId.slice(-8).toUpperCase();

  if (!path) {
    return (
      <span className="text-xs font-mono text-[#8B8FA8]">
        {targetType}:{shortId}
      </span>
    );
  }

  return (
    <button
      onClick={e => { e.stopPropagation(); router.push(path); }}
      className="flex items-center gap-1 text-xs font-mono text-blue-400 hover:text-blue-300 transition-colors group"
    >
      <span className="capitalize">{targetType}</span>
      <span className="text-[#4A4F6A]">#{shortId}</span>
      <ExternalLink size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

// ─────────────────────────────────────────
// Shared CSS Grid layout definition
// Guarantees strict vertical alignment across Header and all Rows
// ─────────────────────────────────────────
const AUDIT_GRID_COLUMNS = '175px 185px 185px 170px minmax(280px, 1fr) 85px';

// ─────────────────────────────────────────
// Date range picker
// ─────────────────────────────────────────
function DateRangePicker({
  preset,
  from,
  to,
  onPresetChange,
  onFromChange,
  onToChange,
}: {
  preset: DatePreset;
  from: string;
  to: string;
  onPresetChange: (p: DatePreset) => void;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}) {
  const presets: { value: DatePreset; label: string }[] = [
    { value: '24h', label: '24h' },
    { value: '7d',  label: '7d'  },
    { value: '30d', label: '30d' },
    { value: 'all', label: 'All' },
    { value: 'custom', label: 'Custom' },
  ];


  return (
    <div className="flex items-center gap-1.5">
      <Calendar size={12} className="text-[#4A4F6A] shrink-0" />
      <div className="flex items-center gap-0.5 bg-[#131929] border border-[#1E2535] rounded-lg p-0.5">
        {presets.map(p => (
          <button
            key={p.value}
            onClick={() => onPresetChange(p.value)}
            className={clsx(
              'px-2.5 py-1 rounded text-xs font-medium transition-colors',
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
        <div className="flex items-center gap-1.5">
          <input
            type="datetime-local"
            value={from}
            onChange={e => onFromChange(e.target.value)}
            className="bg-[#131929] border border-[#1E2535] rounded text-xs text-[#8B8FA8] px-2 py-1 focus:outline-none focus:border-blue-500"
          />
          <span className="text-xs text-[#4A4F6A]">to</span>
          <input
            type="datetime-local"
            value={to}
            onChange={e => onToChange(e.target.value)}
            className="bg-[#131929] border border-[#1E2535] rounded text-xs text-[#8B8FA8] px-2 py-1 focus:outline-none focus:border-blue-500"
          />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Severity indicator for alert events
// ─────────────────────────────────────────
function AlertSeverityRow({ eventType }: { eventType: string }) {
  const isEscalated = eventType.includes('escalat');
  const isDismissed = eventType.includes('dismiss');

  if (isEscalated) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-red-500/10 text-red-400 border border-red-500/20">
        ESCALATED
      </span>
    );
  }
  if (isDismissed) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-slate-500/10 text-slate-400 border border-slate-500/20">
        DISMISSED
      </span>
    );
  }
  return null;
}

// ─────────────────────────────────────────
// Debounce hook
// ─────────────────────────────────────────
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ─────────────────────────────────────────
// Build date range from preset
// ─────────────────────────────────────────
function getDateRange(preset: DatePreset, customFrom: string, customTo: string): { from?: string; to?: string } {
  const now = new Date();

  switch (preset) {
    case '24h': return {
      from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    };
    case '7d': return {
      from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
    case '30d': return {
      from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
    case 'all': return {};
    case 'custom': return {
      from: customFrom ? new Date(customFrom).toISOString() : undefined,
      to:   customTo   ? new Date(customTo).toISOString()   : undefined,
    };
    default: return {};
  }
}

// ─────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────
export default function AuditLogPage() {
  const { getAccessToken } = useAuth();
  const { addToast } = useToast();

  // ── Filter state ───────────────────────────────────────────────
  const [searchInput, setSearchInput]       = useState('');
  const [eventTypeFilter, setEventTypeFilter] = useState('');
  const [categoryFilter, setCategoryFilter]  = useState('');
  const [actorFilter, setActorFilter]        = useState('');
  const [datePreset, setDatePreset]          = useState<DatePreset>('24h');
  const [customFrom, setCustomFrom]          = useState('');
  const [customTo, setCustomTo]              = useState('');
  const [page, setPage]                      = useState(1);

  const debouncedSearch = useDebounce(searchInput, 350);

  // ── Data state ─────────────────────────────────────────────────
  const [logs, setLogs]             = useState<AuditLog[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [isLoading, setIsLoading]   = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());

  // Available event types for dropdown (derived from loaded data)
  const [knownEventTypes, setKnownEventTypes] = useState<string[]>([]);

  const toggleExpand = (id: string) => {
    setExpandedLogIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // ── Fetch logs ─────────────────────────────────────────────────
  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const token = getAccessToken();
      const { from, to } = getDateRange(datePreset, customFrom, customTo);

      const params = new URLSearchParams({
        page:  String(page),
        limit: '50',
        ...(debouncedSearch  && { search: debouncedSearch }),
        ...(eventTypeFilter  && { event_type: eventTypeFilter }),
        ...(categoryFilter   && { category: categoryFilter }),
        ...(actorFilter      && { actor_id: actorFilter }),
        ...(from             && { from }),
        ...(to               && { to }),
      });

      const res = await apiFetch(`/api/v1/audit-logs?${params}`, {}, token);

      if (!res.ok) throw new Error('Failed to fetch audit logs');

      const data = await res.json();
      setLogs(data.data || []);
      setPagination(data.pagination);

      // Collect unique event types for filter dropdown
      const types = [...new Set(data.data.map((l: AuditLog) => l.event_type))] as string[];
      setKnownEventTypes(prev => [...new Set([...prev, ...types])].sort());
    } catch {
      addToast({ type: 'error', message: 'Failed to load audit logs' });
    } finally {
      setIsLoading(false);
    }
  }, [
    getAccessToken, addToast, page,
    debouncedSearch, eventTypeFilter, categoryFilter,
    actorFilter, datePreset, customFrom, customTo,
  ]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, eventTypeFilter, categoryFilter, actorFilter, datePreset, customFrom, customTo]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // ── Export CSV ─────────────────────────────────────────────────
  async function handleExport() {
    setIsExporting(true);
    try {
      const token = getAccessToken();
      const { from, to } = getDateRange(datePreset, customFrom, customTo);

      const params = new URLSearchParams({
        ...(debouncedSearch  && { search: debouncedSearch }),
        ...(eventTypeFilter  && { event_type: eventTypeFilter }),
        ...(categoryFilter   && { category: categoryFilter }),
        ...(actorFilter      && { actor_id: actorFilter }),
        ...(from             && { from }),
        ...(to               && { to }),
      });

      const res = await apiFetch(`/api/v1/audit-logs/export?${params}`, {}, token);

      if (!res.ok) throw new Error('Export failed');

      // Trigger file download
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `fraudscope-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      addToast({ type: 'success', message: 'Audit log exported' });
    } catch {
      addToast({ type: 'error', message: 'Export failed — please try again' });
    } finally {
      setIsExporting(false);
    }
  }

  // ── Clear all filters ──────────────────────────────────────────
  function clearFilters() {
    setSearchInput('');
    setEventTypeFilter('');
    setCategoryFilter('');
    setActorFilter('');
    setDatePreset('24h');
    setCustomFrom('');
    setCustomTo('');
  }

  const hasActiveFilters = searchInput || eventTypeFilter || categoryFilter || actorFilter || datePreset !== '24h';

  // ─────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-[#4A4F6A] uppercase tracking-widest font-semibold mb-1">
            Admin Console
          </p>
          <h1 className="text-xl font-bold text-[#F1F3FA]">System Audit Logs</h1>
          <p className="text-xs text-[#8B8FA8] mt-1">
            Immutable record of all system and analyst actions
          </p>
        </div>

        {/* Export button */}
        <button
          onClick={handleExport}
          disabled={isExporting}
          className="flex items-center gap-2 px-4 py-2 bg-[#131929] hover:bg-[#1a2136] border border-[#1E2535] text-sm font-medium text-[#8B8FA8] hover:text-[#F1F3FA] rounded-lg transition-colors disabled:opacity-40"
        >
          {isExporting ? (
            <div className="w-4 h-4 border-2 border-[#8B8FA8] border-t-transparent rounded-full animate-spin" />
          ) : (
            <Download size={14} />
          )}
          Export CSV
        </button>
      </div>

      {/* Legend & Count */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {Object.entries(CATEGORY_STYLES).map(([cat, style]) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(prev => prev === cat ? '' : cat)}
              className={clsx(
                'flex items-center gap-1.5 text-xs transition-opacity',
                categoryFilter && categoryFilter !== cat ? 'opacity-30' : 'opacity-100'
              )}
            >
              <span className="w-2 h-2 rounded-full" style={{ background: style.dot }} />
              <span className="capitalize" style={{ color: style.text }}>{cat}</span>
            </button>
          ))}
          {categoryFilter && (
            <button
              onClick={() => setCategoryFilter('')}
              className="text-xs text-[#4A4F6A] hover:text-[#8B8FA8] flex items-center gap-1"
            >
              <X size={11} /> clear
            </button>
          )}
        </div>

        {pagination && (
          <span className="text-xs text-[#4A4F6A] font-mono">
            {pagination.total.toLocaleString()} total events
          </span>
        )}
      </div>

      {/* Filter bar */}
      <div className="bg-[#131929] border border-[#1E2535] rounded-xl p-3">
        <div className="flex items-center gap-3 flex-wrap">

          {/* Search */}
          <div className="relative flex-1 min-w-48">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4A4F6A] pointer-events-none" />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Search event type, target ID..."
              className="w-full pl-8 pr-4 py-2 bg-[#0D0F1A] border border-[#1E2535] rounded-lg text-xs text-[#F1F3FA] placeholder-[#4A4F6A] focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4A4F6A] hover:text-[#8B8FA8]"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Event type dropdown */}
          <div className="flex items-center gap-1.5">
            <Filter size={12} className="text-[#4A4F6A] shrink-0" />
            <select
              value={eventTypeFilter}
              onChange={e => setEventTypeFilter(e.target.value)}
              className="bg-[#0D0F1A] border border-[#1E2535] rounded-lg text-xs text-[#8B8FA8] px-2.5 py-2 focus:outline-none focus:border-blue-500 min-w-36"
            >
              <option value="">All event types</option>
              {knownEventTypes.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Actor filter */}
          <select
            value={actorFilter}
            onChange={e => setActorFilter(e.target.value)}
            className="bg-[#0D0F1A] border border-[#1E2535] rounded-lg text-xs text-[#8B8FA8] px-2.5 py-2 focus:outline-none focus:border-blue-500"
          >
            <option value="">All actors</option>
            <option value="system">System / Engine</option>
          </select>

          {/* Date range */}
          <DateRangePicker
            preset={datePreset}
            from={customFrom}
            to={customTo}
            onPresetChange={setDatePreset}
            onFromChange={setCustomFrom}
            onToChange={setCustomTo}
          />

          {/* Clear filters */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-[#4A4F6A] hover:text-[#8B8FA8] flex items-center gap-1 transition-colors"
            >
              <X size={11} /> Clear all
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#131929] border border-[#1E2535] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <div style={{ minWidth: '1100px' }}>
            {/* Table header */}
            <div
              className="grid items-center px-5 py-3 border-b border-[#1E2535] bg-[#0D0F1A] text-xs font-semibold text-[#4A4F6A] uppercase tracking-widest"
              style={{ gridTemplateColumns: AUDIT_GRID_COLUMNS }}
            >
              <span>Timestamp</span>
              <span>Event</span>
              <span>Actor</span>
              <span>Target</span>
              <span>Details</span>
              <span className="text-right">Action</span>
            </div>

            {/* Rows */}
            {isLoading ? (
              <div>
                {Array.from({ length: 10 }).map((_, i) => (
                  <div
                    key={i}
                    className="grid items-center px-5 py-4 border-b border-[#1E2535] min-h-[72px] animate-pulse"
                    style={{ gridTemplateColumns: AUDIT_GRID_COLUMNS, opacity: 1 - i * 0.08 }}
                  >
                    <div className="h-4 bg-[#1E2535] rounded w-32" />
                    <div className="h-5 bg-[#1E2535] rounded w-28" />
                    <div className="space-y-1">
                      <div className="h-3.5 bg-[#1E2535] rounded w-24" />
                      <div className="h-3 bg-[#1E2535] rounded w-32" />
                    </div>
                    <div className="h-4 bg-[#1E2535] rounded w-24" />
                    <div className="h-4 bg-[#1E2535] rounded w-48" />
                    <div className="h-6 bg-[#1E2535] rounded w-14 ml-auto" />
                  </div>
                ))}
              </div>
            ) : logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Clock size={28} className="text-[#1E2535] mb-2" />
                <p className="text-sm text-[#4A4F6A]">No audit log entries found</p>
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="mt-2 text-xs text-blue-400 hover:text-blue-300"
                  >
                    Clear filters to see all logs
                  </button>
                )}
              </div>
            ) : (
              <div>
                {logs.map(log => {
                  const isAlertCategory = getEventCategory(log.event_type) === 'alert';
                  const isExpanded = expandedLogIds.has(log.id);
                  const hasPayload = log.payload && Object.keys(log.payload).length > 0;
                  const previewText = hasPayload ? JSON.stringify(log.payload) : '—';
                  const formattedPayload = hasPayload
                    ? JSON.stringify(log.payload, null, 2)
                    : JSON.stringify(
                        {
                          id: log.id,
                          event_type: log.event_type,
                          actor_type: log.actor_type,
                          actor_id: log.actor_id,
                          target_type: log.target_type,
                          target_id: log.target_id,
                          ip_address: log.ip_address,
                          source: log.source,
                          created_at: log.created_at,
                        },
                        null,
                        2
                      );

                  return (
                    <div
                      key={log.id}
                      className={clsx(
                        'grid items-start px-5 py-4 border-b border-[#1E2535] last:border-0',
                        'hover:bg-white/[0.02] transition-colors group min-h-[72px]',
                        isExpanded && 'bg-white/[0.01]'
                      )}
                      style={{ gridTemplateColumns: AUDIT_GRID_COLUMNS }}
                    >
                      {/* 1. Timestamp */}
                      <div className="flex items-center gap-1.5 min-w-0 pt-0.5">
                        <div
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: CATEGORY_STYLES[getEventCategory(log.event_type)].dot }}
                        />
                        <span className="font-mono text-xs text-[#4A4F6A] whitespace-nowrap">
                          {new Date(log.created_at).toISOString().replace('T', ' ').slice(0, 19)}
                        </span>
                      </div>

                      {/* 2. Event type */}
                      <div className="flex items-center gap-1.5 min-w-0 flex-wrap pt-0.5 pr-2">
                        <EventTypeBadge eventType={log.event_type} />
                        {isAlertCategory && (
                          <AlertSeverityRow eventType={log.event_type} />
                        )}
                      </div>

                      {/* 3. Actor */}
                      <div className="min-w-0 pr-3">
                        {log.actor ? (
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-[#F1F3FA] truncate">
                              {log.actor.first_name} {log.actor.last_name}
                            </p>
                            <p className="text-[11px] text-[#4A4F6A] truncate" title={log.actor.email}>
                              {log.actor.email}
                            </p>
                          </div>
                        ) : (
                          <div className="min-w-0">
                            <span className="text-xs font-medium text-[#8B8FA8] flex items-center gap-1.5 truncate">
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-500 shrink-0" />
                              System
                            </span>
                            <p className="text-[11px] text-[#4A4F6A] truncate">Engine</p>
                          </div>
                        )}
                      </div>

                      {/* 4. Target */}
                      <div className="min-w-0 pr-3 pt-0.5">
                        <TargetLink
                          targetType={log.target_type}
                          targetId={log.target_id}
                        />
                      </div>

                      {/* 5. Details */}
                      <div className="min-w-0 pr-4 pt-0.5">
                        <div
                          className="text-xs font-mono text-[#4A4F6A] truncate"
                          title={previewText}
                        >
                          {previewText}
                        </div>
                        {isExpanded && (
                          <div className="mt-2.5">
                            <pre className="text-xs font-mono text-[#8B8FA8] bg-[#0D0F1A] border border-[#1E2535] rounded-lg p-3 overflow-auto max-h-52 whitespace-pre-wrap break-all select-text">
                              {formattedPayload}
                            </pre>
                          </div>
                        )}
                      </div>

                      {/* 6. Action */}
                      <div className="flex justify-end items-center pt-0.5 shrink-0">
                        <button
                          onClick={() => toggleExpand(log.id)}
                          className={clsx(
                            'text-xs flex items-center gap-1 font-medium transition-colors px-2.5 py-1 rounded shrink-0',
                            isExpanded
                              ? 'text-blue-300 bg-blue-500/10 hover:bg-blue-500/20'
                              : 'text-blue-400 hover:text-blue-300 hover:bg-blue-500/10'
                          )}
                          title={isExpanded ? 'Collapse details' : 'View full details'}
                        >
                          {isExpanded ? (
                            <>
                              <ChevronUp size={11} className="shrink-0" />
                              <span>Collapse</span>
                            </>
                          ) : (
                            <>
                              <ChevronDown size={11} className="shrink-0" />
                              <span>View</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Pagination footer */}
        {pagination && pagination.pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-[#1E2535] bg-[#0D0F1A]">
            <p className="text-xs text-[#4A4F6A]">
              Showing {((pagination.page - 1) * pagination.limit) + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total.toLocaleString()}
            </p>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded text-[#4A4F6A] hover:text-[#F1F3FA] disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={14} />
              </button>

              {/* Page numbers — show window around current page */}
              {Array.from({ length: pagination.pages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === pagination.pages || Math.abs(p - page) <= 2)
                .reduce<(number | 'ellipsis')[]>((acc, p, i, arr) => {
                  if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('ellipsis');
                  acc.push(p);
                  return acc;
                }, [])
                .map((item, i) =>
                  item === 'ellipsis' ? (
                    <span key={`e${i}`} className="px-1 text-xs text-[#4A4F6A]">…</span>
                  ) : (
                    <button
                      key={item}
                      onClick={() => setPage(item as number)}
                      className={clsx(
                        'w-7 h-7 rounded text-xs font-medium transition-colors',
                        page === item
                          ? 'bg-blue-600 text-white'
                          : 'text-[#8B8FA8] hover:text-[#F1F3FA] hover:bg-white/5'
                      )}
                    >
                      {item}
                    </button>
                  )
                )
              }

              <button
                onClick={() => setPage(p => Math.min(pagination.pages, p + 1))}
                disabled={page === pagination.pages}
                className="p-1.5 rounded text-[#4A4F6A] hover:text-[#F1F3FA] disabled:opacity-30 transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>

            <p className="text-xs text-[#4A4F6A]">
              Page {pagination.page} of {pagination.pages}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}