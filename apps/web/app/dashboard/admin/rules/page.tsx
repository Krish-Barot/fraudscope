// apps/web/app/dashboard/admin/rules/page.tsx
// Detection Rules Manager 
'use client';

import {
    useState,
    useEffect,
    useCallback,
    useRef,
} from 'react';
import {
    Plus,
    ChevronDown,
    ChevronRight,
    Edit2,
    Trash2,
    Shield,
    X,
    AlertTriangle,
    CheckCircle,
    SlidersHorizontal,
    BarChart3,
    Clock,
    Activity,
} from 'lucide-react';
import clsx from 'clsx';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    Cell,
} from 'recharts';
import { useAuth } from '../../../../lib/authContext';
import { useToast } from '../../../../components/ui/Toast';
import { useSocket } from '../../../../hooks/useSocket';
import { apiFetch } from '../../../lib/api';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────
interface Rule {
    id: string;
    name: string;
    description?: string;
    type: RuleType;
    parameters: Record<string, unknown>;
    severity: Severity;
    score_weight: number;
    is_active: boolean;
    created_at: string;
    updated_at?: string;
    hit_count_7d?: number;
    stats?: {
        trigger_count: number;
        false_positive_rate: number;
        avg_score: number;
        last_triggered: string | null;
    };
}

type RuleType = 'velocity' | 'amount_anomaly' | 'geo_mismatch' | 'time_anomaly' | 'round_amount';
type Severity = 'low' | 'medium' | 'high' | 'critical';

// ─────────────────────────────────────────
// Constants
// ─────────────────────────────────────────
const RULE_TYPES: { value: RuleType; label: string; description: string }[] = [
    { value: 'velocity', label: 'Velocity Check', description: 'Flags accounts with too many transactions in a short window' },
    { value: 'amount_anomaly', label: 'Amount Anomaly', description: 'Flags transactions significantly above the account average' },
    { value: 'geo_mismatch', label: 'Geo Mismatch', description: 'Flags transactions from new or high-risk countries' },
    { value: 'time_anomaly', label: 'Time Anomaly', description: 'Flags transactions during suspicious hours' },
    { value: 'round_amount', label: 'Round Amount', description: 'Flags suspiciously round transaction amounts' },
];

const SEVERITIES: { value: Severity; label: string; color: string }[] = [
    { value: 'low', label: 'Low', color: '#60a5fa' },
    { value: 'medium', label: 'Medium', color: '#f59e0b' },
    { value: 'high', label: 'High', color: '#f97316' },
    { value: 'critical', label: 'Critical', color: '#ef4444' },
];

const SEVERITY_COLORS: Record<Severity, string> = {
    low: '#60a5fa',
    medium: '#f59e0b',
    high: '#f97316',
    critical: '#ef4444',
};

const TYPE_COLORS: Record<RuleType, string> = {
    velocity: '#818cf8',
    amount_anomaly: '#34d399',
    geo_mismatch: '#fb923c',
    time_anomaly: '#a78bfa',
    round_amount: '#38bdf8',
};

// ─────────────────────────────────────────
// Parameter field definitions per rule type
// ─────────────────────────────────────────
interface ParameterField {
    key: string;
    label: string;
    type: 'number' | 'boolean' | 'string';
    min?: number;
    max?: number;
    step?: number;
    default: unknown;
    description: string;
}

const PARAMETER_FIELDS: Record<RuleType, ParameterField[]> = {
    velocity: [
        { key: 'max_count', label: 'Max Transaction Count', type: 'number', min: 1, max: 100, default: 5, description: 'Maximum allowed transactions in the window' },
        { key: 'window_minutes', label: 'Window (minutes)', type: 'number', min: 1, max: 1440, default: 10, description: 'Time window to count transactions within' },
    ],
    amount_anomaly: [
        { key: 'multiplier', label: 'Amount Multiplier', type: 'number', min: 1.5, max: 20, step: 0.5, default: 3.0, description: 'Trigger when amount exceeds this multiple of the 30-day average' },
        { key: 'min_amount', label: 'Minimum Amount ($)', type: 'number', min: 0, max: 100000, default: 500, description: 'Only evaluate transactions above this amount' },
    ],
    geo_mismatch: [
        { key: 'lookback_count', label: 'Lookback Count', type: 'number', min: 3, max: 20, default: 5, description: 'Number of recent transactions to check for known countries' },
        { key: 'alert_on_new_country', label: 'Alert on New Country', type: 'boolean', default: true, description: 'Trigger when transaction comes from an unknown country' },
    ],
    time_anomaly: [
        { key: 'suspicious_start_hour', label: 'Suspicious Window Start (hour)', type: 'number', min: 0, max: 23, default: 2, description: 'Start of suspicious time window (24h format)' },
        { key: 'suspicious_end_hour', label: 'Suspicious Window End (hour)', type: 'number', min: 0, max: 23, default: 5, description: 'End of suspicious time window (24h format)' },
        { key: 'timezone', label: 'Timezone', type: 'string', default: 'America/Toronto', description: 'IANA timezone for local time evaluation' },
    ],
    round_amount: [
        { key: 'min_amount', label: 'Minimum Amount ($)', type: 'number', min: 0, max: 100000, default: 1000, description: 'Only evaluate transactions above this amount' },
        { key: 'tolerance', label: 'Tolerance ($)', type: 'number', min: 0, max: 5, default: 0, description: 'Dollar tolerance for near-round amounts' },
    ],
};

// ─────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────
function formatTypeLabel(type: RuleType): string {
    return RULE_TYPES.find(t => t.value === type)?.label || type;
}

function truncateParams(params: Record<string, unknown>): string {
    const str = JSON.stringify(params);
    return str.length > 60 ? str.slice(0, 57) + '...' : str;
}

function formatRelativeTime(iso: string | null): string {
    if (!iso) return 'Never';
    const diff = Date.now() - new Date(iso).getTime();
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(hours / 24);
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}

// ─────────────────────────────────────────
// Type Badge
// ─────────────────────────────────────────
function TypeBadge({ type }: { type: RuleType }) {
    const color = TYPE_COLORS[type];
    return (
        <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap"
            style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}
        >
            {formatTypeLabel(type)}
        </span>
    );
}

// ─────────────────────────────────────────
// Severity Badge
// ─────────────────────────────────────────
function SeverityBadge({ severity }: { severity: Severity }) {
    const color = SEVERITY_COLORS[severity];
    return (
        <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide whitespace-nowrap"
            style={{ background: `${color}15`, color, border: `1px solid ${color}30` }}
        >
            {severity}
        </span>
    );
}

// ─────────────────────────────────────────
// Active Toggle
// ─────────────────────────────────────────
function ActiveToggle({
    ruleId,
    isActive,
    onToggle,
}: {
    ruleId: string;
    isActive: boolean;
    onToggle: (id: string, value: boolean) => void;
}) {
    return (
        <button
            type="button"
            onClick={e => { e.stopPropagation(); onToggle(ruleId, !isActive); }}
            className={clsx(
                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 cursor-pointer focus:outline-none shrink-0',
                isActive ? 'bg-blue-600' : 'bg-[#2A3145]'
            )}
            title={isActive ? 'Deactivate rule' : 'Activate rule'}
        >
            <span
                className={clsx(
                    'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200',
                    isActive ? 'translate-x-4' : 'translate-x-1'
                )}
            />
        </button>
    );
}

// ─────────────────────────────────────────
// 7-day spark bar chart (inline in expanded row)
// ─────────────────────────────────────────
function TriggerSparkChart({ hitCount }: { hitCount: number }) {
    // Generate synthetic daily data from the 7-day total
    // In production this would come from a detailed analytics endpoint
    const avgPerDay = hitCount / 7;
    const data = Array.from({ length: 7 }, (_, i) => {
        const dayLabel = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i];
        const variance = (Math.random() - 0.5) * avgPerDay * 0.8;
        return {
            day: dayLabel,
            count: Math.max(0, Math.round(avgPerDay + variance)),
        };
    });

    return (
        <div style={{ height: 80 }}>
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 4, right: 4, left: -30, bottom: 0 }}>
                    <XAxis
                        dataKey="day"
                        tick={{ fontSize: 10, fill: '#4A4F6A' }}
                        axisLine={false}
                        tickLine={false}
                    />
                    <YAxis
                        tick={{ fontSize: 10, fill: '#4A4F6A' }}
                        axisLine={false}
                        tickLine={false}
                    />
                    <Tooltip
                        contentStyle={{
                            background: '#131929',
                            border: '1px solid #1E2535',
                            borderRadius: 8,
                            fontSize: 11,
                            color: '#F1F3FA',
                        }}
                        cursor={{ fill: 'rgba(56,130,246,0.1)' }}
                    />
                    <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                        {data.map((_, i) => (
                            <Cell
                                key={i}
                                fill={i === data.length - 1 ? '#3882F6' : '#1E3A5F'}
                            />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

// ─────────────────────────────────────────
// Delete confirmation modal
// ─────────────────────────────────────────
function DeleteModal({
    rule,
    alertCount,
    onConfirm,
    onCancel,
    isDeleting,
}: {
    rule: Rule;
    alertCount: number;
    onConfirm: () => void;
    onCancel: () => void;
    isDeleting: boolean;
}) {
    const canDelete = alertCount < 10;

    useEffect(() => {
        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onCancel();
        }
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [onCancel]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
        >
            <div className="w-full max-w-md bg-[#131929] border border-[#1E2535] rounded-2xl shadow-2xl">
                <div className="flex items-center gap-3 px-6 py-4 border-b border-[#1E2535]">
                    <div className="w-8 h-8 bg-red-500/15 rounded-lg flex items-center justify-center">
                        <Trash2 size={16} className="text-red-400" />
                    </div>
                    <h2 className="text-base font-semibold text-[#F1F3FA]">Delete Rule</h2>
                    <button onClick={onCancel} className="ml-auto text-[#4A4F6A] hover:text-[#F1F3FA]">
                        <X size={18} />
                    </button>
                </div>

                <div className="px-6 py-4 space-y-3">
                    <p className="text-sm text-[#8B8FA8]">
                        You are about to delete <span className="text-[#F1F3FA] font-medium">"{rule.name}"</span>.
                    </p>

                    {/* Alert count warning */}
                    <div className={clsx(
                        'flex items-start gap-3 p-3 rounded-lg border',
                        canDelete
                            ? 'bg-amber-500/8 border-amber-500/20'
                            : 'bg-red-500/8 border-red-500/20'
                    )}>
                        <AlertTriangle
                            size={16}
                            className={clsx('shrink-0 mt-0.5', canDelete ? 'text-amber-400' : 'text-red-400')}
                        />
                        <div>
                            <p className={clsx('text-sm font-medium', canDelete ? 'text-amber-400' : 'text-red-400')}>
                                {alertCount === 0
                                    ? 'No associated alerts'
                                    : `${alertCount} alert${alertCount !== 1 ? 's' : ''} generated by this rule`
                                }
                            </p>
                            {!canDelete && (
                                <p className="text-xs text-[#8B8FA8] mt-1">
                                    Rules with 10 or more alerts cannot be deleted. Deactivate it instead to stop future triggering.
                                </p>
                            )}
                            {canDelete && alertCount > 0 && (
                                <p className="text-xs text-[#8B8FA8] mt-1">
                                    Deleting this rule will not affect existing alerts but will stop future detection.
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#1E2535]">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-sm text-[#8B8FA8] hover:text-[#F1F3FA] transition-colors"
                    >
                        Cancel
                    </button>
                    {canDelete ? (
                        <button
                            onClick={onConfirm}
                            disabled={isDeleting}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors disabled:opacity-40"
                        >
                            {isDeleting && (
                                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            )}
                            Delete Rule
                        </button>
                    ) : (
                        <button
                            onClick={onCancel}
                            className="px-4 py-2 text-sm font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors"
                        >
                            Deactivate Instead
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────
// Parameter fields component (dynamic by rule type)
// ─────────────────────────────────────────
function ParameterFields({
    type,
    values,
    onChange,
}: {
    type: RuleType;
    values: Record<string, unknown>;
    onChange: (key: string, value: unknown) => void;
}) {
    const fields = PARAMETER_FIELDS[type] || [];

    return (
        <div className="space-y-3">
            {fields.map(field => (
                <div key={field.key}>
                    <label className="block text-xs font-medium text-[#8B8FA8] mb-1">
                        {field.label}
                    </label>
                    {field.type === 'boolean' ? (
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => onChange(field.key, !values[field.key])}
                                className={clsx(
                                    'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                                    values[field.key] ? 'bg-blue-600' : 'bg-[#2A3145]'
                                )}
                            >
                                <span className={clsx(
                                    'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
                                    values[field.key] ? 'translate-x-4' : 'translate-x-1'
                                )} />
                            </button>
                            <span className="text-xs text-[#8B8FA8]">{field.description}</span>
                        </div>
                    ) : (
                        <>
                            <input
                                type={field.type === 'number' ? 'number' : 'text'}
                                value={String(values[field.key] ?? field.default)}
                                onChange={e => onChange(
                                    field.key,
                                    field.type === 'number' ? Number(e.target.value) : e.target.value
                                )}
                                min={field.min}
                                max={field.max}
                                step={field.step || 1}
                                className="w-full px-3 py-2 bg-[#0D0F1A] border border-[#1E2535] rounded-lg text-sm text-[#F1F3FA] focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                            />
                            <p className="text-xs text-[#4A4F6A] mt-1">{field.description}</p>
                        </>
                    )}
                </div>
            ))}
        </div>
    );
}

// ─────────────────────────────────────────
// Create / Edit Slide-Over Panel
// ─────────────────────────────────────────
interface SlideOverProps {
    rule?: Rule | null;
    onClose: () => void;
    onSave: () => void;
    getToken: () => string | null;
    addToast: (t: { type: 'success' | 'error'; message: string }) => void;
}

function RuleSlideOver({ rule, onClose, onSave, getToken, addToast }: SlideOverProps) {
    const isEditing = !!rule;

    const [name, setName] = useState(rule?.name || '');
    const [description, setDescription] = useState(rule?.description || '');
    const [type, setType] = useState<RuleType>(rule?.type || 'velocity');
    const [severity, setSeverity] = useState<Severity>(rule?.severity || 'medium');
    const [scoreWeight, setScoreWeight] = useState(rule?.score_weight || 20);
    const [isActive, setIsActive] = useState(rule?.is_active ?? true);
    const [parameters, setParameters] = useState<Record<string, unknown>>(
        rule?.parameters || Object.fromEntries(
            PARAMETER_FIELDS['velocity'].map(f => [f.key, f.default])
        )
    );
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    // Reset parameters when type changes
    function handleTypeChange(newType: RuleType) {
        setType(newType);
        setParameters(
            Object.fromEntries(PARAMETER_FIELDS[newType].map(f => [f.key, f.default]))
        );
    }

    function handleParamChange(key: string, value: unknown) {
        setParameters(prev => ({ ...prev, [key]: value }));
    }

    function validate(): boolean {
        const newErrors: Record<string, string> = {};
        if (!name.trim()) newErrors.name = 'Name is required';
        if (name.trim().length > 100) newErrors.name = 'Name must be 100 characters or less';
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    }

    async function handleSubmit() {
        if (!validate()) return;
        setIsSubmitting(true);

        const payload = { name: name.trim(), description: description.trim() || undefined, type, severity, score_weight: scoreWeight, is_active: isActive, parameters };

        try {
            const token = getToken();
            const res = await apiFetch(
                isEditing ? `/api/v1/rules/${rule.id}` : '/api/v1/rules',
                { method: isEditing ? 'PUT' : 'POST', body: JSON.stringify(payload) },
                token
            );

            if (!res.ok) {
                const data = await res.json();
                const msg = data.error?.details?.[0]?.message || data.error?.message || 'Failed to save rule';
                addToast({ type: 'error', message: msg });
                return;
            }

            addToast({
                type: 'success',
                message: isEditing ? `Rule "${name}" updated` : `Rule "${name}" created and active`,
            });
            onSave();
            onClose();
        } catch {
            addToast({ type: 'error', message: 'Network error — please try again' });
        } finally {
            setIsSubmitting(false);
        }
    }

    // Close on Escape
    useEffect(() => {
        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose();
        }
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [onClose]);

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Panel */}
            <div className="fixed right-0 top-0 h-full w-full max-w-md z-50 bg-[#0D0F1A] border-l border-[#1E2535] shadow-2xl flex flex-col">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[#1E2535] shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-600/15 rounded-lg flex items-center justify-center">
                            <Shield size={16} className="text-blue-400" />
                        </div>
                        <div>
                            <h2 className="text-base font-semibold text-[#F1F3FA]">
                                {isEditing ? 'Edit Rule' : 'Create Detection Rule'}
                            </h2>
                            <p className="text-xs text-[#4A4F6A]">
                                {isEditing ? rule.name : 'Configure a new fraud detection rule'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-[#4A4F6A] hover:text-[#F1F3FA] transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Form */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

                    {/* Name */}
                    <div>
                        <label className="block text-xs font-medium text-[#8B8FA8] mb-1.5 uppercase tracking-wider">
                            Rule Name <span className="text-red-400">*</span>
                        </label>
                        <input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="e.g. High Velocity Check"
                            className={clsx(
                                'w-full px-3 py-2.5 bg-[#131929] border rounded-lg text-sm text-[#F1F3FA]',
                                'placeholder-[#4A4F6A] focus:outline-none focus:ring-1 transition-colors',
                                errors.name
                                    ? 'border-red-700 focus:border-red-500 focus:ring-red-500'
                                    : 'border-[#1E2535] focus:border-blue-500 focus:ring-blue-500'
                            )}
                        />
                        {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name}</p>}
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-xs font-medium text-[#8B8FA8] mb-1.5 uppercase tracking-wider">
                            Description <span className="text-[#4A4F6A]">(optional)</span>
                        </label>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Explain what this rule detects..."
                            rows={2}
                            className="w-full px-3 py-2.5 bg-[#131929] border border-[#1E2535] rounded-lg text-sm text-[#F1F3FA] placeholder-[#4A4F6A] resize-none focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                        />
                    </div>

                    {/* Rule Type */}
                    <div>
                        <label className="block text-xs font-medium text-[#8B8FA8] mb-1.5 uppercase tracking-wider">
                            Rule Type
                        </label>
                        <div className="space-y-1.5">
                            {RULE_TYPES.map(t => (
                                <button
                                    key={t.value}
                                    type="button"
                                    onClick={() => handleTypeChange(t.value)}
                                    className={clsx(
                                        'w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors',
                                        type === t.value
                                            ? 'border-blue-500 bg-blue-500/10'
                                            : 'border-[#1E2535] bg-[#131929] hover:border-[#2A3145]'
                                    )}
                                >
                                    <div
                                        className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                                        style={{ background: TYPE_COLORS[t.value] }}
                                    />
                                    <div>
                                        <p className={clsx(
                                            'text-xs font-medium',
                                            type === t.value ? 'text-blue-400' : 'text-[#F1F3FA]'
                                        )}>
                                            {t.label}
                                        </p>
                                        <p className="text-xs text-[#4A4F6A] mt-0.5">{t.description}</p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Parameters (dynamic) */}
                    <div>
                        <label className="block text-xs font-medium text-[#8B8FA8] mb-2 uppercase tracking-wider">
                            Parameters
                        </label>
                        <div className="bg-[#131929] border border-[#1E2535] rounded-lg p-3">
                            <ParameterFields
                                type={type}
                                values={parameters}
                                onChange={handleParamChange}
                            />
                        </div>
                    </div>

                    {/* Severity */}
                    <div>
                        <label className="block text-xs font-medium text-[#8B8FA8] mb-1.5 uppercase tracking-wider">
                            Severity
                        </label>
                        <div className="grid grid-cols-4 gap-1.5">
                            {SEVERITIES.map(s => (
                                <button
                                    key={s.value}
                                    type="button"
                                    onClick={() => setSeverity(s.value)}
                                    className={clsx(
                                        'py-1.5 rounded-lg text-xs font-bold uppercase border transition-colors',
                                        severity === s.value
                                            ? 'text-white'
                                            : 'border-[#1E2535] text-[#4A4F6A] hover:border-[#2A3145]'
                                    )}
                                    style={severity === s.value ? {
                                        background: `${s.color}20`,
                                        borderColor: `${s.color}50`,
                                        color: s.color,
                                    } : {}}
                                >
                                    {s.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Score Weight Slider */}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-medium text-[#8B8FA8] uppercase tracking-wider">
                                Score Weight
                            </label>
                            <span className="text-sm font-bold font-mono text-[#F1F3FA]">{scoreWeight}</span>
                        </div>
                        <input
                            type="range"
                            min={5}
                            max={40}
                            step={5}
                            value={scoreWeight}
                            onChange={e => setScoreWeight(Number(e.target.value))}
                            className="w-full h-1.5 bg-[#1E2535] rounded-full appearance-none cursor-pointer accent-blue-500"
                        />
                        <div className="flex justify-between text-xs text-[#4A4F6A] mt-1">
                            <span>5 (low)</span>
                            <span>20 (medium)</span>
                            <span>40 (high)</span>
                        </div>
                        <p className="text-xs text-[#4A4F6A] mt-1">
                            How much this rule contributes to the composite risk score (max 100)
                        </p>
                    </div>

                    {/* Active toggle */}
                    <div className="flex items-center justify-between py-2 border-t border-[#1E2535]">
                        <div>
                            <p className="text-sm text-[#F1F3FA] font-medium">Active</p>
                            <p className="text-xs text-[#4A4F6A]">Rule will evaluate all incoming transactions</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsActive(prev => !prev)}
                            className={clsx(
                                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                                isActive ? 'bg-blue-600' : 'bg-[#2A3145]'
                            )}
                        >
                            <span className={clsx(
                                'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                                isActive ? 'translate-x-6' : 'translate-x-1'
                            )} />
                        </button>
                    </div>
                </div>

                {/* Footer */}
                <div className="shrink-0 px-6 py-4 border-t border-[#1E2535] flex items-center justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-[#8B8FA8] hover:text-[#F1F3FA] transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting}
                        className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-40"
                    >
                        {isSubmitting && (
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        )}
                        {isEditing ? 'Save Changes' : 'Create Rule'}
                    </button>
                </div>
            </div>
        </>
    );
}

// ─────────────────────────────────────────
// Expanded Row Detail
// ─────────────────────────────────────────
function ExpandedRuleDetail({ rule }: { rule: Rule }) {
    return (
        <div className="bg-[#0A0D16] border-t border-[#1E2535] px-6 py-4">
            <div className="grid grid-cols-2 gap-6">

                {/* Left: full parameters */}
                <div>
                    <p className="text-xs font-semibold text-[#4A4F6A] uppercase tracking-widest mb-3">
                        Full Parameters
                    </p>
                    <div className="space-y-2">
                        {Object.entries(rule.parameters).map(([key, value]) => (
                            <div key={key} className="flex items-center justify-between py-1.5 border-b border-[#1E2535] last:border-0">
                                <span className="text-xs text-[#8B8FA8] font-mono">
                                    {key.replace(/_/g, ' ')}
                                </span>
                                <span className="text-xs font-mono font-medium text-[#F1F3FA]">
                                    {String(value)}
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* Stats */}
                    {rule.stats && (
                        <div className="mt-4 grid grid-cols-3 gap-3">
                            {[
                                { label: 'Total Triggers', value: rule.stats.trigger_count },
                                { label: 'False Positive', value: `${(rule.stats.false_positive_rate * 100).toFixed(0)}%` },
                                { label: 'Avg Score', value: rule.stats.avg_score?.toFixed(1) || '—' },
                            ].map(({ label, value }) => (
                                <div key={label} className="bg-[#131929] border border-[#1E2535] rounded-lg p-2.5 text-center">
                                    <p className="text-xs text-[#4A4F6A]">{label}</p>
                                    <p className="text-sm font-bold font-mono text-[#F1F3FA] mt-0.5">{value}</p>
                                </div>
                            ))}
                        </div>
                    )}

                    {rule.stats?.last_triggered && (
                        <p className="text-xs text-[#4A4F6A] mt-3 flex items-center gap-1">
                            <Clock size={10} />
                            Last triggered: {formatRelativeTime(rule.stats.last_triggered)}
                        </p>
                    )}
                </div>

                {/* Right: 7-day bar chart */}
                <div>
                    <p className="text-xs font-semibold text-[#4A4F6A] uppercase tracking-widest mb-3">
                        7-Day Trigger History
                    </p>
                    <TriggerSparkChart hitCount={rule.hit_count_7d || 0} />
                    <p className="text-xs text-[#4A4F6A] text-center mt-1">
                        {rule.hit_count_7d || 0} triggers in the last 7 days
                    </p>

                    {/* Description */}
                    {rule.description && (
                        <div className="mt-4 p-3 bg-[#131929] border border-[#1E2535] rounded-lg">
                            <p className="text-xs text-[#8B8FA8] leading-relaxed">{rule.description}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────
// Stats Bar
// ─────────────────────────────────────────
function StatsBar({ rules }: { rules: Rule[] }) {
    const activeCount = rules.filter(r => r.is_active).length;
    const totalWeight = rules.reduce((sum, r) => sum + r.score_weight, 0);
    const highSeverityCount = rules.filter(r => ['high', 'critical'].includes(r.severity)).length;
    const lastUpdated = rules.reduce((latest, r) => {
        const d = new Date(r.updated_at || r.created_at);
        return d > latest ? d : latest;
    }, new Date(0));

    return (
        <div className="grid grid-cols-4 gap-4 mb-6">
            {[
                {
                    icon: <Shield size={18} className="text-blue-400" />,
                    label: 'Active Rules',
                    value: `${activeCount}`,
                    sub: `of ${rules.length} total`,
                    color: 'blue',
                },
                {
                    icon: <BarChart3 size={18} className="text-emerald-400" />,
                    label: 'Total Site Score',
                    value: `${Math.min(totalWeight, 100)}`,
                    sub: 'max composite',
                    color: 'emerald',
                },
                {
                    icon: <AlertTriangle size={18} className="text-orange-400" />,
                    label: 'New Severity',
                    value: `Med-High`,
                    sub: `${highSeverityCount} high+ rules`,
                    color: 'orange',
                },
                {
                    icon: <Clock size={18} className="text-purple-400" />,
                    label: 'Last Deployment',
                    value: formatRelativeTime(lastUpdated.toISOString()),
                    sub: 'rule change',
                    color: 'purple',
                },
            ].map(stat => (
                <div
                    key={stat.label}
                    className="bg-[#131929] border border-[#1E2535] rounded-xl p-4 flex items-start gap-3"
                >
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center bg-${stat.color}-500/10 shrink-0`}>
                        {stat.icon}
                    </div>
                    <div>
                        <p className="text-xs text-[#4A4F6A] uppercase tracking-wider">{stat.label}</p>
                        <p className="text-lg font-bold font-mono text-[#F1F3FA] mt-0.5">{stat.value}</p>
                        <p className="text-xs text-[#4A4F6A]">{stat.sub}</p>
                    </div>
                </div>
            ))}
        </div>
    );
}

// ─────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────
export default function RulesManagerPage() {
    const { getAccessToken } = useAuth();
    const { addToast } = useToast();
    const { connected, on, off, emit } = useSocket();

    const [rules, setRules] = useState<Rule[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [slideOver, setSlideOver] = useState<{ open: boolean; rule?: Rule | null }>({ open: false });
    const [deleteModal, setDeleteModal] = useState<{ rule: Rule; alertCount: number } | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [togglingId, setTogglingId] = useState<string | null>(null);

    // Coordination refs for debouncing, in-flight tracking, and race condition prevention
    const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);
    const inFlightRef = useRef(false);
    const pendingRefreshRef = useRef(false);
    const fetchIdRef = useRef(0);

    // ── Fetch rules (authoritative backend query) ──────────────────
    const fetchRules = useCallback(async (isInitial = false) => {
        if (isInitial) {
            setIsLoading(true);
        }

        if (inFlightRef.current) {
            pendingRefreshRef.current = true;
            return;
        }

        inFlightRef.current = true;
        const currentFetchId = ++fetchIdRef.current;

        try {
            const token = getAccessToken();
            const res = await apiFetch('/api/v1/rules', {}, token);
            if (res.ok && currentFetchId === fetchIdRef.current) {
                const data = await res.json();
                setRules(data.data || []);
            }
        } catch {
            if (isInitial) {
                addToast({ type: 'error', message: 'Failed to load rules' });
            }
        } finally {
            if (isInitial) {
                setIsLoading(false);
            }
            inFlightRef.current = false;
            if (pendingRefreshRef.current) {
                pendingRefreshRef.current = false;
                fetchRules(false);
            }
        }
    }, [getAccessToken, addToast]);

    // Initial load
    useEffect(() => {
        fetchRules(true);
    }, [fetchRules]);

    // ── Debounced / Coalesced Real-Time Refresh ────────────────────
    const triggerRealtimeRefresh = useCallback(() => {
        if (refreshTimerRef.current) {
            clearTimeout(refreshTimerRef.current);
        }
        // 300ms debounce: groups fast-firing transactions/alerts into a single authoritative refresh
        refreshTimerRef.current = setTimeout(() => {
            fetchRules(false);
        }, 300);
    }, [fetchRules]);

    // ── Real-Time WebSocket Subscriptions ──────────────────────────
    useEffect(() => {
        if (!connected) return;

        // Join rooms for alerts (new alerts/status changes) and rules (crud/toggle)
        emit('subscribe', { channels: ['alerts', 'rules'] });

        const handleAlertEvent = () => {
            // New alert or status change affects hit_count_7d and stats
            triggerRealtimeRefresh();
        };

        const handleRuleEvent = () => {
            // Rule created, updated, toggled, or deleted
            triggerRealtimeRefresh();
        };

        on('alert:new', handleAlertEvent);
        on('alert:updated', handleAlertEvent);
        on('rule:updated', handleRuleEvent);

        // Fetch once on connect/reconnect to capture any changes while disconnected
        fetchRules(false);

        return () => {
            if (refreshTimerRef.current) {
                clearTimeout(refreshTimerRef.current);
            }
            off('alert:new', handleAlertEvent);
            off('alert:updated', handleAlertEvent);
            off('rule:updated', handleRuleEvent);
            emit('unsubscribe', { channels: ['alerts', 'rules'] });
        };
    }, [connected, emit, on, off, triggerRealtimeRefresh, fetchRules]);

    // ── Toggle active ──────────────────────────────────────────────
    async function handleToggle(ruleId: string, newValue: boolean) {
        setTogglingId(ruleId);
        // Optimistic update
        setRules(prev => prev.map(r => r.id === ruleId ? { ...r, is_active: newValue } : r));

        try {
            const token = getAccessToken();
            const res = await apiFetch(
                `/api/v1/rules/${ruleId}/toggle`,
                { method: 'PATCH', body: JSON.stringify({ is_active: newValue }) },
                token
            );

            if (!res.ok) {
                // Revert
                setRules(prev => prev.map(r => r.id === ruleId ? { ...r, is_active: !newValue } : r));
                addToast({ type: 'error', message: 'Failed to toggle rule' });
            } else {
                addToast({
                    type: 'success',
                    message: `Rule ${newValue ? 'activated' : 'deactivated'}`,
                });
            }
        } catch {
            setRules(prev => prev.map(r => r.id === ruleId ? { ...r, is_active: !newValue } : r));
            addToast({ type: 'error', message: 'Network error' });
        } finally {
            setTogglingId(null);
        }
    }

    // ── Delete ─────────────────────────────────────────────────────
    async function handleDeleteClick(rule: Rule) {
        // Fetch rule stats to get alert count
        try {
            const token = getAccessToken();
            const res = await apiFetch(`/api/v1/rules/${rule.id}`, {}, token);
            if (res.ok) {
                const data = await res.json();
                const alertCount = data.rule?.stats?.trigger_count || 0;
                setDeleteModal({ rule, alertCount });
            }
        } catch {
            setDeleteModal({ rule, alertCount: 0 });
        }
    }

    async function handleDeleteConfirm() {
        if (!deleteModal) return;
        setIsDeleting(true);

        try {
            const token = getAccessToken();
            const res = await apiFetch(
                `/api/v1/rules/${deleteModal.rule.id}`,
                { method: 'DELETE' },
                token
            );

            if (res.status === 409) {
                addToast({ type: 'error', message: 'Cannot delete — rule has 10 or more alerts. Deactivate it instead.' });
                return;
            }

            if (res.ok) {
                addToast({ type: 'success', message: `Rule "${deleteModal.rule.name}" deleted` });
                setRules(prev => prev.filter(r => r.id !== deleteModal.rule.id));
                setDeleteModal(null);
            } else {
                addToast({ type: 'error', message: 'Failed to delete rule' });
            }
        } catch {
            addToast({ type: 'error', message: 'Network error' });
        } finally {
            setIsDeleting(false);
        }
    }

    // ─────────────────────────────────────────
    // Render
    // ─────────────────────────────────────────
    return (
        <div className="space-y-4">

            {/* Page header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-base font-semibold text-[#F1F3FA]">Detection Rules Manager</h1>
                    <p className="text-xs text-[#4A4F6A] mt-0.5">
                        Configure and manage fraud detection rules
                    </p>
                </div>
                <button
                    onClick={() => setSlideOver({ open: true, rule: null })}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
                >
                    <Plus size={14} />
                    Create Rule
                </button>
            </div>

            {/* Stats bar */}
            {!isLoading && rules.length > 0 && <StatsBar rules={rules} />}

            {/* Rules table */}
            <div className="bg-[#131929] border border-[#1E2535] rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-[#1E2535]">
                    <p className="text-xs font-semibold text-[#8B8FA8] uppercase tracking-widest">
                        Detection Rules Library
                    </p>
                    <div className="flex items-center gap-2 text-xs text-[#4A4F6A]">
                        <Activity size={12} />
                        Showing {rules.length} rule{rules.length !== 1 ? 's' : ''}
                    </div>
                </div>

                {/* Table scroll container for responsive protection */}
                <div className="overflow-x-auto">
                    <div className="min-w-[1060px]">
                        {/* Table header */}
                        <div
                            className="grid items-center text-xs font-semibold text-[#4A4F6A] uppercase tracking-widest border-b border-[#1E2535] px-5 py-3 bg-[#0D0F1A]/40"
                            style={{ gridTemplateColumns: 'minmax(280px, 2.2fr) 140px 115px minmax(220px, 1.8fr) 160px 80px 80px' }}
                        >
                            <div className="flex items-center gap-2.5">
                                <span className="w-4 shrink-0" aria-hidden="true" />
                                <span>Rule Name</span>
                            </div>
                            <div className="flex items-center">
                                <span>Type</span>
                            </div>
                            <div className="flex items-center">
                                <span>Severity</span>
                            </div>
                            <div className="flex items-center pr-4">
                                <span>Parameters</span>
                            </div>
                            <div className="flex items-center">
                                <span>Hit Rate (7d)</span>
                            </div>
                            <div className="flex items-center justify-center">
                                <span>Active</span>
                            </div>
                            <div className="flex items-center justify-center">
                                <span>Actions</span>
                            </div>
                        </div>

                        {/* Table body */}
                        {isLoading ? (
                            <div className="space-y-px p-2">
                                {Array.from({ length: 5 }).map((_, i) => (
                                    <div
                                        key={i}
                                        className="h-14 bg-[#0D0F1A] animate-pulse rounded"
                                        style={{ opacity: 1 - i * 0.15 }}
                                    />
                                ))}
                            </div>
                        ) : rules.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-center">
                                <Shield size={28} className="text-[#1E2535] mb-2" />
                                <p className="text-sm text-[#4A4F6A]">No detection rules configured</p>
                                <button
                                    onClick={() => setSlideOver({ open: true, rule: null })}
                                    className="mt-3 text-xs text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                                >
                                    Create your first rule →
                                </button>
                            </div>
                        ) : (
                            rules.map(rule => {
                                const isExpanded = expandedId === rule.id;
                                const hitRate = rule.hit_count_7d || 0;

                                return (
                                    <div key={rule.id}>
                                        {/* Rule row */}
                                        <div
                                            onClick={() => setExpandedId(isExpanded ? null : rule.id)}
                                            className={clsx(
                                                'grid items-center px-5 py-3.5 min-h-[60px] border-b border-[#1E2535] cursor-pointer',
                                                'hover:bg-white/[0.02] transition-colors group',
                                                isExpanded && 'bg-white/[0.02]',
                                                !rule.is_active && 'opacity-60'
                                            )}
                                            style={{ gridTemplateColumns: 'minmax(280px, 2.2fr) 140px 115px minmax(220px, 1.8fr) 160px 80px 80px' }}
                                        >
                                            {/* Name + expand icon */}
                                            <div className="flex items-center gap-2.5 min-w-0 pr-4">
                                                <div className="w-4 flex items-center justify-center shrink-0">
                                                    {isExpanded ? (
                                                        <ChevronDown size={14} className="text-blue-400" />
                                                    ) : (
                                                        <ChevronRight size={14} className="text-[#4A4F6A] group-hover:text-[#8B8FA8] transition-colors" />
                                                    )}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm font-medium text-[#F1F3FA] truncate leading-tight">{rule.name}</p>
                                                    {rule.description ? (
                                                        <p className="text-xs text-[#4A4F6A] truncate leading-tight mt-0.5" title={rule.description}>
                                                            {rule.description}
                                                        </p>
                                                    ) : (
                                                        <p className="text-xs text-[#4A4F6A]/40 italic truncate leading-tight mt-0.5">
                                                            No description
                                                        </p>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Type */}
                                            <div className="flex items-center min-w-0">
                                                <TypeBadge type={rule.type} />
                                            </div>

                                            {/* Severity */}
                                            <div className="flex items-center min-w-0">
                                                <SeverityBadge severity={rule.severity} />
                                            </div>

                                            {/* Parameters preview */}
                                            <div className="min-w-0 overflow-hidden flex items-center pr-4">
                                                <code
                                                    className="block text-xs font-mono text-[#4A4F6A] truncate hover:text-[#8B8FA8] transition-colors"
                                                    title={JSON.stringify(rule.parameters)}
                                                >
                                                    {JSON.stringify(rule.parameters)}
                                                </code>
                                            </div>

                                            {/* Hit rate */}
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <div className="w-20 h-1.5 bg-[#1E2535] rounded-full overflow-hidden shrink-0">
                                                    <div
                                                        className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                                        style={{ width: `${Math.min((hitRate / 50) * 100, 100)}%` }}
                                                    />
                                                </div>
                                                <span className="text-xs font-mono text-[#8B8FA8] shrink-0 w-7 text-right">
                                                    {hitRate}
                                                </span>
                                            </div>

                                            {/* Active toggle */}
                                            <div className="flex items-center justify-center" onClick={e => e.stopPropagation()}>
                                                <ActiveToggle
                                                    ruleId={rule.id}
                                                    isActive={rule.is_active}
                                                    onToggle={handleToggle}
                                                />
                                            </div>

                                            {/* Actions */}
                                            <div
                                                className="flex items-center justify-center gap-1.5"
                                                onClick={e => e.stopPropagation()}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => setSlideOver({ open: true, rule })}
                                                    className="p-1.5 rounded-lg text-[#4A4F6A] hover:text-blue-400 hover:bg-blue-500/10 transition-colors cursor-pointer"
                                                    title="Edit rule"
                                                >
                                                    <Edit2 size={13} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteClick(rule)}
                                                    className="p-1.5 rounded-lg text-[#4A4F6A] hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                                                    title="Delete rule"
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Expanded detail */}
                                        {isExpanded && <ExpandedRuleDetail rule={rule} />}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>

            {/* Recent deployments section */}
            <div className="bg-[#131929] border border-[#1E2535] rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-[#1E2535]">
                    <p className="text-xs font-semibold text-[#8B8FA8] uppercase tracking-widest">
                        Recent Deployments
                    </p>
                    <button className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
                        View full history
                    </button>
                </div>
                <div className="divide-y divide-[#1E2535]">
                    {rules.slice(0, 3).map(rule => (
                        <div key={rule.id} className="flex items-start gap-3 px-5 py-3">
                            <div className={clsx(
                                'w-1.5 h-1.5 rounded-full mt-1.5 shrink-0',
                                rule.is_active ? 'bg-emerald-400' : 'bg-[#4A4F6A]'
                            )} />
                            <div className="flex-1 min-w-0">
                                <p className="text-xs text-[#F1F3FA] font-medium truncate">{rule.name}</p>
                                <p className="text-xs text-[#4A4F6A] mt-0.5">
                                    {rule.is_active ? 'Active' : 'Inactive'} · {formatTypeLabel(rule.type)} · weight {rule.score_weight}
                                </p>
                            </div>
                            <span className="text-xs text-[#4A4F6A] shrink-0">
                                {formatRelativeTime(rule.updated_at || rule.created_at)}
                            </span>
                        </div>
                    ))}
                    {rules.length === 0 && (
                        <p className="px-5 py-4 text-xs text-[#4A4F6A]">No recent rule changes</p>
                    )}
                </div>
            </div>

            {/* Slide-over panel */}
            {slideOver.open && (
                <RuleSlideOver
                    rule={slideOver.rule}
                    onClose={() => setSlideOver({ open: false })}
                    onSave={fetchRules}
                    getToken={getAccessToken}
                    addToast={addToast}
                />
            )}

            {/* Delete modal */}
            {deleteModal && (
                <DeleteModal
                    rule={deleteModal.rule}
                    alertCount={deleteModal.alertCount}
                    onConfirm={handleDeleteConfirm}
                    onCancel={() => setDeleteModal(null)}
                    isDeleting={isDeleting}
                />
            )}
        </div>
    );
}