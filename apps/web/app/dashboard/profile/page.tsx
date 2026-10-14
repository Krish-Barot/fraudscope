// apps/web/app/dashboard/profile/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  User,
  Shield,
  Key,
  Mail,
  Clock,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Eye,
  EyeOff,
  Save,
  Activity,
  Lock,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../../lib/authContext';
import { useToast } from '../../../components/ui/Toast';
import { apiFetch } from '../../lib/api';

interface UserProfile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: 'analyst' | 'admin';
  created_at: string;
  last_login_at: string | null;
}

export default function ProfilePage() {
  const { getAccessToken } = useAuth();
  const { addToast } = useToast();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Profile form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  // Load user profile
  const fetchProfile = useCallback(async () => {
    setIsLoading(true);
    try {
      const token = getAccessToken();
      const res = await apiFetch('/api/v1/auth/me', {}, token);
      if (res.ok) {
        const data = await res.json();
        setProfile(data.user);
        setFirstName(data.user.first_name || '');
        setLastName(data.user.last_name || '');
      } else {
        addToast({ type: 'error', message: 'Failed to load user profile' });
      }
    } catch {
      addToast({ type: 'error', message: 'Network error loading profile' });
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken, addToast]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // Handle profile info update
  async function handleUpdateProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      addToast({ type: 'error', message: 'First name and last name are required' });
      return;
    }

    setIsSavingProfile(true);
    try {
      const token = getAccessToken();
      const res = await apiFetch(
        '/api/v1/auth/me',
        {
          method: 'PATCH',
          body: JSON.stringify({
            first_name: firstName.trim(),
            last_name: lastName.trim(),
          }),
        },
        token
      );

      if (res.ok) {
        const data = await res.json();
        setProfile(data.user);
        addToast({ type: 'success', message: 'Profile updated successfully' });
      } else {
        const data = await res.json();
        addToast({ type: 'error', message: data.error?.message || 'Failed to update profile' });
      }
    } catch {
      addToast({ type: 'error', message: 'Network error updating profile' });
    } finally {
      setIsSavingProfile(false);
    }
  }

  // Handle password change
  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!currentPassword) {
      addToast({ type: 'error', message: 'Please enter your current password' });
      return;
    }
    if (newPassword.length < 8) {
      addToast({ type: 'error', message: 'New password must be at least 8 characters' });
      return;
    }
    if (newPassword !== confirmPassword) {
      addToast({ type: 'error', message: 'New passwords do not match' });
      return;
    }

    setIsUpdatingPassword(true);
    try {
      const token = getAccessToken();
      const res = await apiFetch(
        '/api/v1/auth/me',
        {
          method: 'PATCH',
          body: JSON.stringify({
            current_password: currentPassword,
            new_password: newPassword,
          }),
        },
        token
      );

      if (res.ok) {
        addToast({ type: 'success', message: 'Password changed successfully' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        const data = await res.json();
        addToast({ type: 'error', message: data.error?.message || 'Failed to change password' });
      }
    } catch {
      addToast({ type: 'error', message: 'Network error updating password' });
    } finally {
      setIsUpdatingPassword(false);
    }
  }

  function copyUserId() {
    if (!profile) return;
    navigator.clipboard.writeText(profile.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  }

  const initials = profile
    ? `${profile.first_name[0] || ''}${profile.last_name[0] || ''}`.toUpperCase() || 'U'
    : 'U';

  const hasProfileChanges =
    profile && (firstName.trim() !== profile.first_name || lastName.trim() !== profile.last_name);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto pb-12">
        <div className="h-32 bg-[#131929] border border-[#1E2535] rounded-xl animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 h-96 bg-[#131929] border border-[#1E2535] rounded-xl animate-pulse" />
          <div className="h-96 bg-[#131929] border border-[#1E2535] rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Header Profile Banner */}
      <div className="bg-gradient-to-r from-[#131929] via-[#111726] to-[#0D111D] border border-[#1E2535] rounded-xl p-6 relative overflow-hidden shadow-lg">
        <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 border-2 border-blue-400/30 flex items-center justify-center text-xl font-bold text-white shadow-md shrink-0">
              {initials}
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl font-bold text-[#F1F3FA]">
                  {profile?.first_name} {profile?.last_name}
                </h1>
                <span
                  className={clsx(
                    'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider',
                    profile?.role === 'admin'
                      ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                      : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                  )}
                >
                  <Shield size={11} />
                  {profile?.role}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Active Account
                </span>
              </div>
              <p className="text-xs text-[#8B8FA8] font-mono mt-1">{profile?.email}</p>
            </div>
          </div>

          <div className="flex sm:flex-col items-center sm:items-end gap-2 text-xs text-[#4A4F6A]">
            <div className="flex items-center gap-1.5">
              <Calendar size={13} />
              <span>
                Joined{' '}
                {profile?.created_at
                  ? new Date(profile.created_at).toLocaleDateString('en-CA', {
                      month: 'short',
                      year: 'numeric',
                    })
                  : '—'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock size={13} />
              <span>
                Last active{' '}
                {profile?.last_login_at
                  ? new Date(profile.last_login_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : 'Just now'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column: Editable Forms */}
        <div className="md:col-span-2 space-y-6">
          {/* Personal Information Form */}
          <div className="bg-[#131929] border border-[#1E2535] rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-[#1E2535]">
              <div>
                <h2 className="text-sm font-semibold text-[#F1F3FA] flex items-center gap-2">
                  <User size={16} className="text-blue-400" />
                  Personal Information
                </h2>
                <p className="text-xs text-[#8B8FA8] mt-0.5">
                  Update your personal profile details displayed across the platform
                </p>
              </div>
            </div>

            <form onSubmit={handleUpdateProfile} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#8B8FA8] mb-1.5">
                    First Name
                  </label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full px-3.5 py-2 bg-[#0D0F1A] border border-[#1E2535] rounded-lg text-sm text-[#F1F3FA] placeholder-[#4A4F6A] focus:outline-none focus:border-blue-500 transition-colors"
                    placeholder="First name"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#8B8FA8] mb-1.5">
                    Last Name
                  </label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full px-3.5 py-2 bg-[#0D0F1A] border border-[#1E2535] rounded-lg text-sm text-[#F1F3FA] placeholder-[#4A4F6A] focus:outline-none focus:border-blue-500 transition-colors"
                    placeholder="Last name"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#8B8FA8] mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#4A4F6A]" />
                  <input
                    type="email"
                    value={profile?.email || ''}
                    disabled
                    className="w-full pl-10 pr-4 py-2 bg-[#0A0D16] border border-[#1E2535] rounded-lg text-sm text-[#8B8FA8] font-mono cursor-not-allowed opacity-75"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#4A4F6A] font-medium bg-[#131929] px-2 py-0.5 rounded border border-[#1E2535]">
                    Managed by Admin
                  </span>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={isSavingProfile || !hasProfileChanges}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors"
                >
                  {isSavingProfile ? (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Save size={14} />
                  )}
                  Save Changes
                </button>
              </div>
            </form>
          </div>

          {/* Security & Password Form */}
          <div className="bg-[#131929] border border-[#1E2535] rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-[#1E2535]">
              <div>
                <h2 className="text-sm font-semibold text-[#F1F3FA] flex items-center gap-2">
                  <Key size={16} className="text-amber-400" />
                  Security & Password
                </h2>
                <p className="text-xs text-[#8B8FA8] mt-0.5">
                  Change your password to keep your FraudScope account secure
                </p>
              </div>
            </div>

            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#8B8FA8] mb-1.5">
                  Current Password
                </label>
                <div className="relative">
                  <input
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full px-3.5 pr-10 py-2 bg-[#0D0F1A] border border-[#1E2535] rounded-lg text-sm text-[#F1F3FA] placeholder-[#4A4F6A] focus:outline-none focus:border-blue-500 transition-colors"
                    placeholder="Enter current password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4A4F6A] hover:text-[#F1F3FA] transition-colors"
                  >
                    {showCurrentPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#8B8FA8] mb-1.5">
                    New Password
                  </label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full px-3.5 pr-10 py-2 bg-[#0D0F1A] border border-[#1E2535] rounded-lg text-sm text-[#F1F3FA] placeholder-[#4A4F6A] focus:outline-none focus:border-blue-500 transition-colors"
                      placeholder="Min 8 characters"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4A4F6A] hover:text-[#F1F3FA] transition-colors"
                    >
                      {showNewPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#8B8FA8] mb-1.5">
                    Confirm New Password
                  </label>
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-3.5 py-2 bg-[#0D0F1A] border border-[#1E2535] rounded-lg text-sm text-[#F1F3FA] placeholder-[#4A4F6A] focus:outline-none focus:border-blue-500 transition-colors"
                    placeholder="Repeat new password"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={isUpdatingPassword || !currentPassword || !newPassword}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors"
                >
                  {isUpdatingPassword ? (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Lock size={14} />
                  )}
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Right Column: Account Details & Session Info */}
        <div className="space-y-6">
          {/* Account Metadata Card */}
          <div className="bg-[#131929] border border-[#1E2535] rounded-xl p-5 shadow-sm space-y-4">
            <h3 className="text-xs font-semibold text-[#4A4F6A] uppercase tracking-widest">
              Account Identification
            </h3>

            <div className="space-y-3">
              <div>
                <p className="text-[11px] text-[#4A4F6A] mb-1">Internal User UUID</p>
                <div className="flex items-center justify-between bg-[#0D0F1A] border border-[#1E2535] rounded-lg px-3 py-2">
                  <span className="text-xs font-mono text-[#8B8FA8] truncate mr-2">
                    {profile?.id}
                  </span>
                  <button
                    onClick={copyUserId}
                    className="text-[#4A4F6A] hover:text-[#F1F3FA] transition-colors shrink-0"
                    title="Copy UUID"
                  >
                    {copiedId ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>

              <div className="bg-[#0D0F1A] border border-[#1E2535] rounded-lg divide-y divide-[#1E2535]">
                <div className="flex items-center justify-between px-3 py-2.5 text-xs">
                  <span className="text-[#4A4F6A]">Role Tier</span>
                  <span className="font-medium text-[#F1F3FA] capitalize">{profile?.role}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2.5 text-xs">
                  <span className="text-[#4A4F6A]">Authentication</span>
                  <span className="text-[#8B8FA8]">JWT + Refresh Cookie</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2.5 text-xs">
                  <span className="text-[#4A4F6A]">Session Rotation</span>
                  <span className="text-emerald-400 font-mono">15m Active</span>
                </div>
              </div>
            </div>
          </div>

          {/* Security Best Practices Card */}
          <div className="bg-[#131929] border border-[#1E2535] rounded-xl p-5 shadow-sm">
            <h3 className="text-xs font-semibold text-[#4A4F6A] uppercase tracking-widest mb-3">
              Security Notice
            </h3>
            <div className="space-y-3 text-xs text-[#8B8FA8] leading-relaxed">
              <div className="flex items-start gap-2">
                <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                <p>All sensitive operations and role updates are recorded in the permanent audit trail.</p>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                <p>Passwords are hashed with bcrypt (salt rounds 10) and never stored in plain text.</p>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                <p>Access tokens are strictly held in memory and validated at the edge proxy.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
