// apps/web/app/dashboard/admin/users/page.tsx
// Team Management 
'use client';

import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import {
  UserPlus,
  Search,
  X,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  Shield,
  User,
  Clock,
  AlertTriangle,
  Eye,
  EyeOff,
  Activity,
  TrendingUp,
  CheckCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../../../lib/authContext';
import { useToast } from '../../../../components/ui/Toast';
import { apiFetch } from '../../../lib/api';

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────
interface AppUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: 'analyst' | 'admin';
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  stats?: {
    alerts_reviewed: number;
    avg_response_time_seconds: number;
    escalation_rate: number;
  };
}

interface InviteFormState {
  email: string;
  first_name: string;
  last_name: string;
  role: 'analyst' | 'admin';
}

// ─────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────
function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatResponseTime(seconds: number): string {
  if (!seconds || seconds === 0) return '—';
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes === 0) return `${secs}s`;
  return `${minutes}m ${secs}s`;
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase();
}

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
  return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ─────────────────────────────────────────
// Role Badge
// ─────────────────────────────────────────
function RoleBadge({ role }: { role: 'analyst' | 'admin' }) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
      role === 'admin'
        ? 'bg-purple-500/15 text-purple-400 border border-purple-500/25'
        : 'bg-blue-500/15 text-blue-400 border border-blue-500/25'
    )}>
      {role === 'admin' ? <Shield size={10} /> : <User size={10} />}
      {role === 'admin' ? 'Admin' : 'Analyst'}
    </span>
  );
}

// ─────────────────────────────────────────
// Status Badge
// ─────────────────────────────────────────
function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
      isActive
        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
        : 'bg-slate-500/15 text-slate-500 border border-slate-600/25'
    )}>
      <span className={clsx(
        'w-1.5 h-1.5 rounded-full',
        isActive ? 'bg-emerald-400' : 'bg-slate-500'
      )} />
      {isActive ? 'Active' : 'Inactive'}
    </span>
  );
}

// ─────────────────────────────────────────
// Avatar
// ─────────────────────────────────────────
function Avatar({ user, size = 'sm' }: { user: AppUser; size?: 'sm' | 'md' | 'lg' }) {
  const colors = [
    'bg-blue-600', 'bg-purple-600', 'bg-emerald-600',
    'bg-orange-600', 'bg-pink-600', 'bg-indigo-600',
  ];
  const colorIndex = user.id.charCodeAt(0) % colors.length;
  const sizeClass = size === 'lg' ? 'w-12 h-12 text-base' : size === 'md' ? 'w-9 h-9 text-sm' : 'w-7 h-7 text-xs';

  return (
    <div className={clsx(
      'rounded-full flex items-center justify-center font-bold text-white shrink-0',
      colors[colorIndex],
      sizeClass
    )}>
      {getInitials(user.first_name, user.last_name)}
    </div>
  );
}

// ─────────────────────────────────────────
// Copy to clipboard button
// ─────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-https
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      onClick={handleCopy}
      className={clsx(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
        copied
          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
          : 'bg-[#0D0F1A] text-[#8B8FA8] border border-[#1E2535] hover:text-[#F1F3FA] hover:border-[#2A3145]'
      )}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

// ─────────────────────────────────────────
// Invite Modal
// ─────────────────────────────────────────
function InviteModal({
  onClose,
  onSuccess,
  getToken,
  addToast,
}: {
  onClose: () => void;
  onSuccess: () => void;
  getToken: () => string | null;
  addToast: (t: { type: 'success' | 'error'; message: string }) => void;
}) {
  const [form, setForm] = useState<InviteFormState>({
    email: '',
    first_name: '',
    last_name: '',
    role: 'analyst',
  });
  const [errors, setErrors] = useState<Partial<InviteFormState>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !tempPassword) onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, tempPassword]);

  function validate(): boolean {
    const newErrors: Partial<InviteFormState> = {};
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      newErrors.email = 'Valid email required';
    }
    if (!form.first_name.trim()) newErrors.first_name = 'Required';
    if (!form.last_name.trim()) newErrors.last_name = 'Required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setIsSubmitting(true);

    const password = generateTempPassword();

    try {
      const token = getToken();
      const res = await apiFetch(
        '/api/v1/auth/register',
        {
          method: 'POST',
          body: JSON.stringify({ ...form, password }),
        },
        token
      );

      if (!res.ok) {
        const data = await res.json();
        if (data.error?.code === 'CONFLICT') {
          setErrors({ email: 'An account with this email already exists' });
        } else {
          addToast({ type: 'error', message: data.error?.message || 'Failed to create user' });
        }
        return;
      }

      // Show temp password — display once, never stored
      setTempPassword(password);
      onSuccess();
    } catch {
      addToast({ type: 'error', message: 'Network error — please try again' });
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleField(key: keyof InviteFormState, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: undefined }));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget && !tempPassword) onClose(); }}
    >
      <div className="w-full max-w-md bg-[#131929] border border-[#1E2535] rounded-2xl shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1E2535]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600/15 rounded-lg flex items-center justify-center">
              <UserPlus size={16} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#F1F3FA]">
                {tempPassword ? 'Account Created' : 'Invite Team Member'}
              </h2>
              <p className="text-xs text-[#4A4F6A]">
                {tempPassword ? 'Share credentials securely' : 'Add a new analyst or admin'}
              </p>
            </div>
          </div>
          {!tempPassword && (
            <button onClick={onClose} className="text-[#4A4F6A] hover:text-[#F1F3FA] transition-colors">
              <X size={18} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          {tempPassword ? (
            // ── Success state: show temp password ──────────────────
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <CheckCircle size={16} className="text-emerald-400 shrink-0" />
                <p className="text-sm text-emerald-400">
                  Account created for <span className="font-medium">{form.email}</span>
                </p>
              </div>

              <div>
                <p className="text-xs text-[#8B8FA8] mb-2 uppercase tracking-wider font-medium">
                  Temporary Password — shown once
                </p>
                <div className="bg-[#0D0F1A] border border-[#1E2535] rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3">
                    <code className={clsx(
                      'text-sm font-mono text-[#F1F3FA] flex-1 break-all',
                      !showPassword && 'blur-sm select-none'
                    )}>
                      {tempPassword}
                    </code>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setShowPassword(p => !p)}
                        className="p-1.5 rounded text-[#4A4F6A] hover:text-[#8B8FA8] transition-colors"
                      >
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                      <CopyButton text={tempPassword} />
                    </div>
                  </div>
                </div>
                <p className="text-xs text-amber-400 mt-2 flex items-start gap-1.5">
                  <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                  Share this password securely. It will not be shown again after you close this dialog.
                </p>
              </div>

              <div className="text-xs text-[#4A4F6A] space-y-1">
                <p><span className="text-[#8B8FA8]">Name:</span> {form.first_name} {form.last_name}</p>
                <p><span className="text-[#8B8FA8]">Role:</span> {form.role}</p>
              </div>
            </div>
          ) : (
            // ── Invite form ─────────────────────────────────────────
            <div className="space-y-4">
              {/* Name row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#8B8FA8] mb-1.5 font-medium">
                    First Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={form.first_name}
                    onChange={e => handleField('first_name', e.target.value)}
                    placeholder="Sarah"
                    className={clsx(
                      'w-full px-3 py-2.5 bg-[#0D0F1A] border rounded-lg text-sm text-[#F1F3FA]',
                      'placeholder-[#4A4F6A] focus:outline-none focus:ring-1 transition-colors',
                      errors.first_name
                        ? 'border-red-700 focus:ring-red-500'
                        : 'border-[#1E2535] focus:border-blue-500 focus:ring-blue-500'
                    )}
                  />
                  {errors.first_name && (
                    <p className="text-xs text-red-400 mt-1">{errors.first_name}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-[#8B8FA8] mb-1.5 font-medium">
                    Last Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={form.last_name}
                    onChange={e => handleField('last_name', e.target.value)}
                    placeholder="Chen"
                    className={clsx(
                      'w-full px-3 py-2.5 bg-[#0D0F1A] border rounded-lg text-sm text-[#F1F3FA]',
                      'placeholder-[#4A4F6A] focus:outline-none focus:ring-1 transition-colors',
                      errors.last_name
                        ? 'border-red-700 focus:ring-red-500'
                        : 'border-[#1E2535] focus:border-blue-500 focus:ring-blue-500'
                    )}
                  />
                  {errors.last_name && (
                    <p className="text-xs text-red-400 mt-1">{errors.last_name}</p>
                  )}
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs text-[#8B8FA8] mb-1.5 font-medium">
                  Email Address <span className="text-red-400">*</span>
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => handleField('email', e.target.value)}
                  placeholder="analyst@fraudscope.dev"
                  className={clsx(
                    'w-full px-3 py-2.5 bg-[#0D0F1A] border rounded-lg text-sm text-[#F1F3FA]',
                    'placeholder-[#4A4F6A] focus:outline-none focus:ring-1 transition-colors',
                    errors.email
                      ? 'border-red-700 focus:ring-red-500'
                      : 'border-[#1E2535] focus:border-blue-500 focus:ring-blue-500'
                  )}
                />
                {errors.email && (
                  <p className="text-xs text-red-400 mt-1">{errors.email}</p>
                )}
              </div>

              {/* Role */}
              <div>
                <label className="block text-xs text-[#8B8FA8] mb-1.5 font-medium">
                  Role
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['analyst', 'admin'] as const).map(role => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => handleField('role', role)}
                      className={clsx(
                        'flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-colors',
                        form.role === role
                          ? role === 'admin'
                            ? 'border-purple-500/50 bg-purple-500/10'
                            : 'border-blue-500/50 bg-blue-500/10'
                          : 'border-[#1E2535] bg-[#0D0F1A] hover:border-[#2A3145]'
                      )}
                    >
                      <div className={clsx(
                        'w-6 h-6 rounded flex items-center justify-center',
                        form.role === role
                          ? role === 'admin' ? 'bg-purple-500/20' : 'bg-blue-500/20'
                          : 'bg-[#1E2535]'
                      )}>
                        {role === 'admin'
                          ? <Shield size={12} className={form.role === role ? 'text-purple-400' : 'text-[#4A4F6A]'} />
                          : <User size={12} className={form.role === role ? 'text-blue-400' : 'text-[#4A4F6A]'} />
                        }
                      </div>
                      <div>
                        <p className={clsx(
                          'text-xs font-medium capitalize',
                          form.role === role
                            ? role === 'admin' ? 'text-purple-400' : 'text-blue-400'
                            : 'text-[#8B8FA8]'
                        )}>
                          {role}
                        </p>
                        <p className="text-xs text-[#4A4F6A] mt-0.5">
                          {role === 'admin' ? 'Full access' : 'Alert review'}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#1E2535]">
          {tempPassword ? (
            <button
              onClick={onClose}
              className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
            >
              Done
            </button>
          ) : (
            <>
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
                Create Account
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// User Edit Panel (right slide-over)
// ─────────────────────────────────────────
function UserEditPanel({
  user,
  onClose,
  onSave,
  getToken,
  addToast,
}: {
  user: AppUser;
  onClose: () => void;
  onSave: () => void;
  getToken: () => string | null;
  addToast: (t: { type: 'success' | 'error'; message: string }) => void;
}) {
  const [firstName, setFirstName] = useState(user.first_name);
  const [lastName, setLastName] = useState(user.last_name);
  const [role, setRole] = useState(user.role);
  const [isActive, setIsActive] = useState(user.is_active);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeactivateWarning, setShowDeactivateWarning] = useState(false);

  const hasChanges =
    role !== user.role ||
    isActive !== user.is_active ||
    firstName.trim() !== user.first_name ||
    lastName.trim() !== user.last_name;

  async function handleSave() {
    if (!firstName.trim() || !lastName.trim()) {
      addToast({ type: 'error', message: 'First and last name are required' });
      return;
    }

    setIsSaving(true);
    try {
      const token = getToken();
      const res = await apiFetch(
        `/api/v1/users/${user.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            role,
            is_active: isActive,
          }),
        },
        token
      );

      if (res.ok) {
        addToast({ type: 'success', message: `${firstName}'s account updated` });
        onSave();
        onClose();
      } else {
        const data = await res.json();
        addToast({ type: 'error', message: data.error?.message || 'Failed to update user' });
      }
    } catch {
      addToast({ type: 'error', message: 'Network error' });
    } finally {
      setIsSaving(false);
    }
  }

  function handleToggleActive() {
    if (isActive && !showDeactivateWarning) {
      // Show warning before deactivating
      setShowDeactivateWarning(true);
      return;
    }
    setIsActive(prev => !prev);
    setShowDeactivateWarning(false);
  }

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const stats = user.stats;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed right-0 top-0 h-full w-full max-w-sm z-50 bg-[#0D0F1A] border-l border-[#1E2535] shadow-2xl flex flex-col">

        {/* Header */}
        <div className="px-5 py-4 border-b border-[#1E2535] shrink-0">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-[#4A4F6A] uppercase tracking-widest font-semibold">
              Team Member
            </p>
            <button onClick={onClose} className="text-[#4A4F6A] hover:text-[#F1F3FA] transition-colors">
              <X size={16} />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <Avatar user={user} size="lg" />
            <div>
              <p className="text-base font-semibold text-[#F1F3FA]">
                {user.first_name} {user.last_name}
              </p>
              <p className="text-xs text-[#8B8FA8] mt-0.5">{user.email}</p>
              <div className="flex items-center gap-2 mt-1.5">
                <RoleBadge role={user.role} />
                <StatusBadge isActive={user.is_active} />
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Activity stats */}
          {stats && (
            <div>
              <p className="text-xs font-semibold text-[#4A4F6A] uppercase tracking-widest mb-3">
                Performance (30 days)
              </p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  {
                    icon: <Activity size={14} className="text-blue-400" />,
                    label: 'Reviewed',
                    value: stats.alerts_reviewed.toString(),
                    sub: 'alerts',
                  },
                  {
                    icon: <Clock size={14} className="text-amber-400" />,
                    label: 'Avg Time',
                    value: formatResponseTime(stats.avg_response_time_seconds),
                    sub: 'response',
                  },
                  {
                    icon: <TrendingUp size={14} className="text-red-400" />,
                    label: 'Escalated',
                    value: `${(stats.escalation_rate * 100).toFixed(0)}%`,
                    sub: 'rate',
                  },
                ].map(stat => (
                  <div key={stat.label} className="bg-[#131929] border border-[#1E2535] rounded-lg p-2.5 text-center">
                    <div className="flex justify-center mb-1">{stat.icon}</div>
                    <p className="text-base font-bold font-mono text-[#F1F3FA] leading-tight">{stat.value}</p>
                    <p className="text-xs text-[#4A4F6A]">{stat.sub}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Account info */}
          <div>
            <p className="text-xs font-semibold text-[#4A4F6A] uppercase tracking-widest mb-2">
              Account Info
            </p>
            <div className="bg-[#131929] border border-[#1E2535] rounded-lg divide-y divide-[#1E2535]">
              {[
                { label: 'Member since', value: new Date(user.created_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) },
                { label: 'Last active', value: formatRelativeTime(user.last_login_at) },
                { label: 'User ID', value: user.id.slice(-8).toUpperCase() },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-xs text-[#4A4F6A]">{label}</span>
                  <span className="text-xs font-mono text-[#8B8FA8]">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Edit Name */}
          <div>
            <p className="text-xs font-semibold text-[#4A4F6A] uppercase tracking-widest mb-2">
              Personal Information
            </p>
            <div className="space-y-2.5">
              <div>
                <label className="block text-xs text-[#8B8FA8] mb-1">First Name</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  className="w-full px-3 py-2 bg-[#131929] border border-[#1E2535] rounded-lg text-xs text-[#F1F3FA] placeholder-[#4A4F6A] focus:outline-none focus:border-blue-500 transition-colors"
                  placeholder="First name"
                />
              </div>
              <div>
                <label className="block text-xs text-[#8B8FA8] mb-1">Last Name</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  className="w-full px-3 py-2 bg-[#131929] border border-[#1E2535] rounded-lg text-xs text-[#F1F3FA] placeholder-[#4A4F6A] focus:outline-none focus:border-blue-500 transition-colors"
                  placeholder="Last name"
                />
              </div>
            </div>
          </div>

          {/* Role change */}
          <div>
            <p className="text-xs font-semibold text-[#4A4F6A] uppercase tracking-widest mb-2">
              Role
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(['analyst', 'admin'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={clsx(
                    'flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left transition-colors',
                    role === r
                      ? r === 'admin'
                        ? 'border-purple-500/50 bg-purple-500/10'
                        : 'border-blue-500/50 bg-blue-500/10'
                      : 'border-[#1E2535] bg-[#131929] hover:border-[#2A3145]'
                  )}
                >
                  {r === 'admin'
                    ? <Shield size={14} className={role === r ? 'text-purple-400' : 'text-[#4A4F6A]'} />
                    : <User size={14} className={role === r ? 'text-blue-400' : 'text-[#4A4F6A]'} />
                  }
                  <div>
                    <p className={clsx(
                      'text-xs font-medium capitalize',
                      role === r
                        ? r === 'admin' ? 'text-purple-400' : 'text-blue-400'
                        : 'text-[#8B8FA8]'
                    )}>
                      {r}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Active / Deactivate */}
          <div>
            <p className="text-xs font-semibold text-[#4A4F6A] uppercase tracking-widest mb-2">
              Account Status
            </p>

            {/* Deactivate warning */}
            {showDeactivateWarning && isActive && (
              <div className="mb-3 p-3 bg-amber-500/8 border border-amber-500/20 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-amber-400">Deactivate account?</p>
                    <p className="text-xs text-[#8B8FA8] mt-1">
                      {user.first_name} will immediately lose dashboard access. Their full audit history, alert actions, and activity logs are permanently preserved — deactivation does not delete any records.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={handleToggleActive}
                    className="flex-1 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors"
                  >
                    Confirm Deactivate
                  </button>
                  <button
                    onClick={() => setShowDeactivateWarning(false)}
                    className="flex-1 py-1.5 text-xs text-[#8B8FA8] border border-[#1E2535] rounded-lg hover:text-[#F1F3FA] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div
              className={clsx(
                'flex items-center justify-between p-3 rounded-lg border',
                isActive
                  ? 'bg-emerald-500/5 border-emerald-500/20'
                  : 'bg-[#131929] border-[#1E2535]'
              )}
            >
              <div>
                <p className={clsx('text-sm font-medium', isActive ? 'text-emerald-400' : 'text-[#8B8FA8]')}>
                  {isActive ? 'Account Active' : 'Account Inactive'}
                </p>
                <p className="text-xs text-[#4A4F6A] mt-0.5">
                  {isActive
                    ? 'Can log in and review alerts'
                    : 'Login disabled — history preserved'}
                </p>
              </div>
              {!showDeactivateWarning && (
                <button
                  onClick={handleToggleActive}
                  className={clsx(
                    'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                    isActive ? 'bg-emerald-500' : 'bg-[#2A3145]'
                  )}
                >
                  <span className={clsx(
                    'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
                    isActive ? 'translate-x-4' : 'translate-x-1'
                  )} />
                </button>
              )}
            </div>

            {!isActive && (
              <p className="text-xs text-[#4A4F6A] mt-2 flex items-center gap-1.5">
                <CheckCircle size={11} className="text-emerald-500" />
                Audit trail fully preserved — deactivation is reversible
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-4 border-t border-[#1E2535] flex items-center gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 text-sm text-[#8B8FA8] border border-[#1E2535] rounded-lg hover:text-[#F1F3FA] hover:border-[#2A3145] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-40"
          >
            {isSaving && (
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            Save Changes
          </button>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────
export default function UsersPage() {
  const { getAccessToken } = useAuth();
  const { addToast } = useToast();

  const [users, setUsers] = useState<AppUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  // ── Fetch users ────────────────────────────────────────────────
  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const token = getAccessToken();
      const res = await apiFetch('/api/v1/users', {}, token);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      } else {
        addToast({ type: 'error', message: 'Failed to load team members' });
      }
    } catch {
      addToast({ type: 'error', message: 'Network error' });
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken, addToast]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // ── Filter + paginate ──────────────────────────────────────────
  const filtered = users.filter(u => {
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return (
      u.email.toLowerCase().includes(q) ||
      u.first_name.toLowerCase().includes(q) ||
      u.last_name.toLowerCase().includes(q) ||
      u.role.includes(q)
    );
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Reset page on search
  useEffect(() => { setCurrentPage(1); }, [searchQuery]);

  // ── Stats ──────────────────────────────────────────────────────
  const activeCount = users.filter(u => u.is_active).length;
  const adminCount = users.filter(u => u.role === 'admin').length;

  return (
    <div className="space-y-4">

      {/* Page header — matches Stitch "Admin Console" style */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-[#4A4F6A] uppercase tracking-widest font-semibold mb-1">
            Admin Console
          </p>
          <h1 className="text-xl font-bold text-[#F1F3FA]">Team Management</h1>
          <p className="text-xs text-[#8B8FA8] mt-1">
            Manage your team members and their access levels.
          </p>
        </div>
        <button
          onClick={() => setShowInviteModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <UserPlus size={14} />
          Invite Analyst
        </button>
      </div>

      {/* Quick stats */}
      {!isLoading && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total Members', value: users.length, color: 'text-[#F1F3FA]' },
            { label: 'Active', value: activeCount, color: 'text-emerald-400' },
            { label: 'Inactive', value: users.length - activeCount, color: 'text-slate-500' },
            { label: 'Admins', value: adminCount, color: 'text-purple-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-[#131929] border border-[#1E2535] rounded-xl px-4 py-3">
              <p className="text-xs text-[#4A4F6A]">{label}</p>
              <p className={clsx('text-2xl font-bold font-mono mt-0.5', color)}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Search + table */}
      <div className="bg-[#131929] border border-[#1E2535] rounded-xl overflow-hidden">

        {/* Table toolbar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#1E2535]">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4A4F6A] pointer-events-none" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search team members..."
              className="pl-8 pr-4 py-1.5 bg-[#0D0F1A] border border-[#1E2535] rounded-lg text-xs text-[#F1F3FA] placeholder-[#4A4F6A] focus:outline-none focus:border-blue-500 w-56"
            />
          </div>
          <p className="text-xs text-[#4A4F6A]">
            {filtered.length} member{filtered.length !== 1 ? 's' : ''}
            {searchQuery && ' found'}
          </p>
        </div>

        {/* Table header */}
        <div
          className="grid text-xs font-semibold text-[#4A4F6A] uppercase tracking-widest border-b border-[#1E2535] px-5 py-2.5"
          style={{ gridTemplateColumns: '2fr 2.5fr 1fr 1fr 1fr 1fr' }}
        >
          <span>Name</span>
          <span>Email</span>
          <span>Role</span>
          <span>Status</span>
          <span>Last Active</span>
          <span>Actions</span>
        </div>

        {/* Table body */}
        {isLoading ? (
          <div className="space-y-px p-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-14 bg-[#0D0F1A] rounded animate-pulse"
                style={{ opacity: 1 - i * 0.15 }}
              />
            ))}
          </div>
        ) : paginated.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <User size={28} className="text-[#1E2535] mb-2" />
            <p className="text-sm text-[#4A4F6A]">
              {searchQuery ? 'No members match your search' : 'No team members yet'}
            </p>
            {!searchQuery && (
              <button
                onClick={() => setShowInviteModal(true)}
                className="mt-3 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                Invite your first analyst →
              </button>
            )}
          </div>
        ) : (
          paginated.map(user => (
            <div
              key={user.id}
              onClick={() => setEditingUser(user)}
              className="grid items-center px-5 py-3 border-b border-[#1E2535] last:border-0 cursor-pointer hover:bg-white/[0.02] transition-colors group"
              style={{ gridTemplateColumns: '2fr 2.5fr 1fr 1fr 1fr 1fr' }}
            >
              {/* Name + avatar */}
              <div className="flex items-center gap-3 min-w-0">
                <Avatar user={user} size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#F1F3FA] truncate group-hover:text-blue-400 transition-colors">
                    {user.first_name} {user.last_name}
                  </p>
                </div>
              </div>

              {/* Email */}
              <p className="text-xs text-[#8B8FA8] font-mono truncate pr-3">{user.email}</p>

              {/* Role */}
              <div><RoleBadge role={user.role} /></div>

              {/* Status */}
              <div><StatusBadge isActive={user.is_active} /></div>

              {/* Last active */}
              <p className="text-xs text-[#4A4F6A]">
                {formatRelativeTime(user.last_login_at)}
              </p>

              {/* Actions — Edit link */}
              <div>
                <span className="text-xs text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  Edit →
                </span>
              </div>
            </div>
          ))
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-[#1E2535]">
            <p className="text-xs text-[#4A4F6A]">
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded text-[#4A4F6A] hover:text-[#F1F3FA] disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={14} />
              </button>

              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => Math.abs(p - currentPage) <= 2)
                .map(page => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={clsx(
                      'w-7 h-7 rounded text-xs font-medium transition-colors',
                      page === currentPage
                        ? 'bg-blue-600 text-white'
                        : 'text-[#8B8FA8] hover:text-[#F1F3FA] hover:bg-white/5'
                    )}
                  >
                    {page}
                  </button>
                ))
              }

              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded text-[#4A4F6A] hover:text-[#F1F3FA] disabled:opacity-30 transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Invite modal */}
      {showInviteModal && (
        <InviteModal
          onClose={() => setShowInviteModal(false)}
          onSuccess={fetchUsers}
          getToken={getAccessToken}
          addToast={addToast}
        />
      )}

      {/* Edit panel */}
      {editingUser && (
        <UserEditPanel
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSave={fetchUsers}
          getToken={getAccessToken}
          addToast={addToast}
        />
      )}
    </div>
  );
}