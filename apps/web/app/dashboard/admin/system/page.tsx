// apps/web/app/dashboard/admin/system/page.tsx
// System Health Dashboard
// Polls /api/v1/health/detailed every 10 seconds
// Listens to Socket.io system:status events for live metrics
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    Server,
    Database,
    Zap,
    Cpu,
    CheckCircle,
    XCircle,
    AlertTriangle,
    RefreshCw,
    Wifi,
    Users,
    Activity,
    Clock,
    ArrowUp,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../../../lib/authContext';
import { useSocket } from '../../../../hooks/useSocket';
import { apiFetch } from '../../../lib/api';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────
interface ServiceStatus {
    name: string;
    status: 'healthy' | 'unhealthy';
    latency_ms: number;
    message: string;
    checked_at: string;
}

interface HealthData {
    status: 'healthy' | 'degraded';
    uptime_seconds: number;
    uptime_human: string;
    timestamp: string;
    services: {
        api: ServiceStatus;
        postgres: ServiceStatus;
        redis: ServiceStatus;
        worker: ServiceStatus;
    };
    metrics: {
        queue_depth: number;
        tx_per_minute: number;
    };
}

interface SocketStatus {
    connected: boolean;
    active_connections: number;
    active_analysts: number;
    timestamp: string;
}

// ─────────────────────────────────────────
// Mini sparkline using SVG
// Shows last N data points as a line
// ─────────────────────────────────────────
function Sparkline({
    data,
    color,
    height = 32,
}: {
    data: number[];
    color: string;
    height?: number;
}) {
    if (data.length < 2) return null;

    const width = 120;
    const max = Math.max(...data, 1);
    const points = data.map((v, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - (v / max) * height;
        return `${x},${y}`;
    }).join(' ');

    return (
        <svg width={width} height={height} className="overflow-visible">
            <polyline
                points={points}
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.8"
            />
            {/* Fill below line */}
            <polyline
                points={`0,${height} ${points} ${width},${height}`}
                fill={color}
                opacity="0.08"
            />
        </svg>
    );
}

// ─────────────────────────────────────────
// Service status card
// ─────────────────────────────────────────
function ServiceCard({
    service,
    icon,
    isLoading,
}: {
    service?: ServiceStatus;
    icon: React.ReactNode;
    isLoading: boolean;
}) {
    if (isLoading || !service) {
        return (
            <div className="bg-[#131929] border border-[#1E2535] rounded-xl p-5 animate-pulse">
                <div className="h-5 w-32 bg-[#1E2535] rounded mb-3" />
                <div className="h-8 w-16 bg-[#1E2535] rounded mb-2" />
                <div className="h-3 w-full bg-[#1E2535] rounded" />
            </div>
        );
    }

    const isHealthy = service.status === 'healthy';

    return (
        <div className={clsx(
            'bg-[#131929] border rounded-xl p-5 transition-all duration-300',
            isHealthy ? 'border-[#1E2535]' : 'border-red-500/40 shadow-red-500/10 shadow-lg'
        )}>
            {/* Header row */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                    <div className={clsx(
                        'w-8 h-8 rounded-lg flex items-center justify-center',
                        isHealthy ? 'bg-emerald-500/10' : 'bg-red-500/10'
                    )}>
                        <div className={isHealthy ? 'text-emerald-400' : 'text-red-400'}>
                            {icon}
                        </div>
                    </div>
                    <p className="text-sm font-semibold text-[#F1F3FA]">{service.name}</p>
                </div>

                {/* Status indicator */}
                {isHealthy ? (
                    <div className="flex items-center gap-1.5">
                        <div className="relative">
                            <div className="w-2 h-2 rounded-full bg-emerald-400" />
                            <div className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-400 animate-ping opacity-60" />
                        </div>
                        <span className="text-xs font-medium text-emerald-400">Healthy</span>
                    </div>
                ) : (
                    <div className="flex items-center gap-1.5">
                        <XCircle size={14} className="text-red-400" />
                        <span className="text-xs font-medium text-red-400">Unhealthy</span>
                    </div>
                )}
            </div>

            {/* Latency */}
            {service.latency_ms >= 0 && (
                <div className="mb-3">
                    <p className="text-xs text-[#4A4F6A] mb-0.5">Response time</p>
                    <p className={clsx(
                        'text-2xl font-bold font-mono',
                        service.latency_ms < 10 ? 'text-emerald-400' :
                            service.latency_ms < 50 ? 'text-[#F1F3FA]' :
                                service.latency_ms < 200 ? 'text-amber-400' : 'text-red-400'
                    )}>
                        {service.latency_ms}
                        <span className="text-sm font-normal text-[#4A4F6A] ml-1">ms</span>
                    </p>
                </div>
            )}

            {/* Message */}
            <p className="text-xs text-[#8B8FA8] leading-relaxed">{service.message}</p>

            {/* Last checked */}
            <p className="text-xs text-[#4A4F6A] mt-2 flex items-center gap-1">
                <Clock size={10} />
                {new Date(service.checked_at).toLocaleTimeString('en-CA', { hour12: false })}
            </p>
        </div>
    );
}

// ─────────────────────────────────────────
// Live metric card (from Socket.io)
// ─────────────────────────────────────────
function MetricCard({
    label,
    value,
    unit,
    icon,
    color,
    history,
    isLive,
}: {
    label: string;
    value: number | string;
    unit?: string;
    icon: React.ReactNode;
    color: string;
    history: number[];
    isLive: boolean;
}) {
    return (
        <div className="bg-[#131929] border border-[#1E2535] rounded-xl p-4">
            <div className="flex items-start justify-between mb-3">
                <div>
                    <p className="text-xs text-[#4A4F6A] uppercase tracking-wider mb-1">{label}</p>
                    <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-bold font-mono" style={{ color }}>
                            {value}
                        </span>
                        {unit && (
                            <span className="text-xs text-[#4A4F6A]">{unit}</span>
                        )}
                    </div>
                </div>
                <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: `${color}15` }}
                >
                    <div style={{ color }}>{icon}</div>
                </div>
            </div>

            {/* Sparkline */}
            {history.length >= 2 && (
                <div className="mt-2">
                    <Sparkline data={history} color={color} />
                </div>
            )}

            {/* Live indicator */}
            {isLive && (
                <div className="flex items-center gap-1 mt-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs text-[#4A4F6A]">Live</span>
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────
// Uptime display
// ─────────────────────────────────────────
function UptimeDisplay({ uptimeSeconds }: { uptimeSeconds: number }) {
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const secs = uptimeSeconds % 60;

    const segments = [
        { label: 'Days', value: days },
        { label: 'Hours', value: hours },
        { label: 'Min', value: minutes },
        { label: 'Sec', value: secs },
    ];

    return (
        <div className="flex items-center gap-4">
            {segments.map(({ label, value }) => (
                <div key={label} className="text-center">
                    <p className="text-2xl font-bold font-mono text-[#F1F3FA]">
                        {String(value).padStart(2, '0')}
                    </p>
                    <p className="text-xs text-[#4A4F6A] mt-0.5">{label}</p>
                </div>
            ))}
        </div>
    );
}

// ─────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────
export default function SystemHealthPage() {
    const { getAccessToken } = useAuth();
    const { connected, on, off } = useSocket();

    const [health, setHealth] = useState<HealthData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [socketStatus, setSocketStatus] = useState<SocketStatus | null>(null);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [isStale, setIsStale] = useState(false);

    // Local uptime ticker — ticks every second between API polls
    const [localUptimeSeconds, setLocalUptimeSeconds] = useState<number | null>(null);

    // History arrays for sparklines
    const [queueHistory, setQueueHistory] = useState<number[]>([]);
    const [connectionHistory, setConnectionHistory] = useState<number[]>([]);
    const [analystHistory, setAnalystHistory] = useState<number[]>([]);
    const [txRateHistory, setTxRateHistory] = useState<number[]>([]);

    // Polling interval ref
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // ── Fetch health ───────────────────────────────────────────────
    const fetchHealth = useCallback(async (silent = false) => {
        if (!silent) setIsRefreshing(true);

        try {
            const token = getAccessToken();

            // Add a fetch timeout — don't wait forever
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const res = await apiFetch(
                '/api/v1/health/detailed',
                { signal: controller.signal },
                token
            );
            clearTimeout(timeout);

            if (res.ok || res.status === 503) {
                // 503 is a valid response — service is degraded but API is responding
                const data: HealthData = await res.json();
                setHealth(data);
                setLastUpdated(new Date());
                setFetchError(null);
                setIsStale(false);

                // Update sparkline history (keep last 20 points)
                setQueueHistory(prev => [...prev.slice(-19), data.metrics.queue_depth]);
                setTxRateHistory(prev => [...prev.slice(-19), data.metrics.tx_per_minute]);
            } else {
                setFetchError(`API returned ${res.status}`);
                setIsStale(true);
                // Keep existing health data so page doesn't go blank
            }
        } catch (err: any) {
            if (err.name === 'AbortError') {
                setFetchError('Health check timed out after 5s');
            } else {
                setFetchError(err.message || 'Failed to reach health endpoint');
            }
            setIsStale(true);
            // Keep existing health data — page stays showing last known state
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, [getAccessToken]);

    // Initial fetch
    useEffect(() => {
        fetchHealth(false);
    }, [fetchHealth]);

    // Poll every 10 seconds
    useEffect(() => {
        pollRef.current = setInterval(() => fetchHealth(true), 10000);
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [fetchHealth]);

    // Sync local uptime counter from API response
    useEffect(() => {
        if (health?.uptime_seconds !== undefined) {
            setLocalUptimeSeconds(health.uptime_seconds);
        }
    }, [health?.uptime_seconds]);

    // Tick uptime every second between API polls
    useEffect(() => {
        if (localUptimeSeconds === null) return;
        const timer = setInterval(() => {
            setLocalUptimeSeconds(prev => prev !== null ? prev + 1 : null);
        }, 1000);
        return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [localUptimeSeconds !== null]);

    // ── Socket: system:status events ──────────────────────────────
    const handleSystemStatus = useCallback((data: SocketStatus) => {
        setSocketStatus(data);
        setConnectionHistory(prev => [...prev.slice(-19), data.active_connections]);
        setAnalystHistory(prev => [...prev.slice(-19), data.active_analysts]);
    }, []);

    useEffect(() => {
        if (!connected) return;
        on('system:status', handleSystemStatus);
        return () => off('system:status', handleSystemStatus);
    }, [connected, on, off, handleSystemStatus]);

    // ── Derived state ──────────────────────────────────────────────
    const isDegraded = health?.status === 'degraded';
    const unhealthyServices = health
        ? Object.entries(health.services).filter(([, s]) => s.status === 'unhealthy')
        : [];

    // ─────────────────────────────────────────
    // Render
    // ─────────────────────────────────────────
    return (
        <div className="space-y-4">

            {/* Degraded banner */}
            {/* Stale data warning — shown when API can't be reached */}
            {isStale && fetchError && (
                <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-500/10 border border-amber-500/25 rounded-xl">
                    <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                    <p className="text-xs text-amber-400">
                        Showing last known state — health endpoint unreachable: {fetchError}
                    </p>
                    <button
                        onClick={() => fetchHealth(false)}
                        className="ml-auto text-xs text-amber-400 hover:text-amber-300 underline"
                    >
                        Retry now
                    </button>
                </div>
            )}

            {isDegraded && (
                <div className="flex items-center gap-3 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                    <AlertTriangle size={18} className="text-red-400 shrink-0" />
                    <div>
                        <p className="text-sm font-semibold text-red-400">System Degraded</p>
                        <p className="text-xs text-red-400/70 mt-0.5">
                            {unhealthyServices.map(([key]) => key).join(', ')} {unhealthyServices.length === 1 ? 'is' : 'are'} reporting issues.
                            Check service cards below for details.
                        </p>
                    </div>
                </div>
            )}

            {/* Page header */}
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-xs text-[#4A4F6A] uppercase tracking-widest font-semibold mb-1">
                        Admin Console
                    </p>
                    <h1 className="text-xl font-bold text-[#F1F3FA]">System Health</h1>
                    <p className="text-xs text-[#8B8FA8] mt-1">
                        Service status and real-time performance metrics
                    </p>
                </div>

                {/* Manual refresh + last updated */}
                <div className="flex items-center gap-3">
                    {lastUpdated && (
                        <p className="text-xs text-[#4A4F6A]">
                            Updated {lastUpdated.toLocaleTimeString('en-CA', { hour12: false })}
                        </p>
                    )}
                    <button
                        onClick={() => fetchHealth(false)}
                        disabled={isRefreshing}
                        className="flex items-center gap-2 px-3 py-1.5 bg-[#131929] border border-[#1E2535] rounded-lg text-xs text-[#8B8FA8] hover:text-[#F1F3FA] transition-colors disabled:opacity-40"
                    >
                        <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* Uptime + overall status */}
            <div className="bg-[#131929] border border-[#1E2535] rounded-xl px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className={clsx(
                        'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium',
                        isDegraded
                            ? 'bg-red-500/10 border border-red-500/25 text-red-400'
                            : 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400'
                    )}>
                        {isDegraded
                            ? <XCircle size={14} />
                            : <CheckCircle size={14} />
                        }
                        {isDegraded ? 'System Degraded' : 'All Systems Operational'}
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-[#4A4F6A]">
                        <ArrowUp size={12} className="text-emerald-400" />
                        <span>Uptime:</span>
                    </div>
                    {health ? (
                        <UptimeDisplay uptimeSeconds={localUptimeSeconds ?? health.uptime_seconds} />
                    ) : (
                        <div className="h-8 w-48 bg-[#1E2535] rounded animate-pulse" />
                    )}
                </div>

                {/* Auto-refresh indicator */}
                <div className="flex items-center gap-1.5 text-xs text-[#4A4F6A]">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                    Auto-refreshes every 10s
                </div>
            </div>

            {/* Service cards */}
            <div>
                <p className="text-xs font-semibold text-[#4A4F6A] uppercase tracking-widest mb-3">
                    Service Status
                </p>
                <div className="grid grid-cols-4 gap-4">
                    <ServiceCard
                        service={health?.services.api}
                        icon={<Server size={16} />}
                        isLoading={isLoading}
                    />
                    <ServiceCard
                        service={health?.services.postgres}
                        icon={<Database size={16} />}
                        isLoading={isLoading}
                    />
                    <ServiceCard
                        service={health?.services.redis}
                        icon={<Zap size={16} />}
                        isLoading={isLoading}
                    />
                    <ServiceCard
                        service={health?.services.worker}
                        icon={<Cpu size={16} />}
                        isLoading={isLoading}
                    />
                </div>
            </div>

            {/* Live metrics */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold text-[#4A4F6A] uppercase tracking-widest">
                        Live Metrics
                    </p>
                    <div className="flex items-center gap-1.5 text-xs text-[#4A4F6A]">
                        <Wifi size={12} className={connected ? 'text-emerald-400' : 'text-[#4A4F6A]'} />
                        {connected ? 'Socket connected' : 'Socket disconnected'}
                    </div>
                </div>

                <div className="grid grid-cols-4 gap-4">
                    {/* Queue depth */}
                    <MetricCard
                        label="Stream Queue Depth"
                        value={health?.metrics.queue_depth ?? '—'}
                        unit="pending"
                        icon={<Activity size={16} />}
                        color="#3882F6"
                        history={queueHistory}
                        isLive={false}
                    />

                    {/* TX per minute */}
                    <MetricCard
                        label="Transactions / Min"
                        value={health?.metrics.tx_per_minute ?? '—'}
                        unit="tx/min"
                        icon={<ArrowUp size={16} />}
                        color="#34d399"
                        history={txRateHistory}
                        isLive={false}
                    />

                    {/* Active connections */}
                    <MetricCard
                        label="WebSocket Connections"
                        value={socketStatus?.active_connections ?? '—'}
                        unit="clients"
                        icon={<Wifi size={16} />}
                        color="#a78bfa"
                        history={connectionHistory}
                        isLive={connected}
                    />

                    {/* Active analysts */}
                    <MetricCard
                        label="Active Analysts"
                        value={socketStatus?.active_analysts ?? '—'}
                        unit="online"
                        icon={<Users size={16} />}
                        color="#f59e0b"
                        history={analystHistory}
                        isLive={connected}
                    />
                </div>
            </div>

            {/* Service detail table */}
            <div className="bg-[#131929] border border-[#1E2535] rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-[#1E2535]">
                    <p className="text-xs font-semibold text-[#8B8FA8] uppercase tracking-widest">
                        Service Detail
                    </p>
                </div>
                <div>
                    {isLoading ? (
                        Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="h-12 border-b border-[#1E2535] last:border-0 animate-pulse bg-[#0D0F1A] mx-1 rounded my-0.5" />
                        ))
                    ) : health ? (
                        Object.entries(health.services).map(([key, service]) => (
                            <div
                                key={key}
                                className="flex items-center justify-between px-5 py-3 border-b border-[#1E2535] last:border-0"
                            >
                                <div className="flex items-center gap-3">
                                    <div className={clsx(
                                        'w-2 h-2 rounded-full',
                                        service.status === 'healthy' ? 'bg-emerald-400' : 'bg-red-400'
                                    )} />
                                    <p className="text-sm text-[#F1F3FA] font-medium w-32">{service.name}</p>
                                    <p className="text-xs text-[#8B8FA8]">{service.message}</p>
                                </div>
                                <div className="flex items-center gap-6 text-xs text-[#4A4F6A]">
                                    {service.latency_ms >= 0 && (
                                        <span className="font-mono">
                                            {service.latency_ms}ms
                                        </span>
                                    )}
                                    <span>{new Date(service.checked_at).toLocaleTimeString('en-CA', { hour12: false })}</span>
                                    <span className={clsx(
                                        'font-medium uppercase tracking-wide',
                                        service.status === 'healthy' ? 'text-emerald-400' : 'text-red-400'
                                    )}>
                                        {service.status}
                                    </span>
                                </div>
                            </div>
                        ))
                    ) : null}
                </div>
            </div>
        </div>
    );
}