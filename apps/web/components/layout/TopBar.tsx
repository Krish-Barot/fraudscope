// apps/web/components/layout/TopBar.tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, Clock, User, LogOut } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../lib/authContext';
import { useSocket } from '../../hooks/useSocket';
import { GlobalSearch } from './GlobalSearch';

function WebSocketStatus() {
  const { connected } = useSocket();
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      className="relative flex items-center gap-1.5 cursor-default"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="relative">
        <div className={clsx(
          'w-2 h-2 rounded-full transition-colors duration-300',
          connected ? 'bg-emerald-400' : 'bg-rose-500'
        )} />
        {connected && (
          <div className="absolute inset-0 w-2 h-2 bg-emerald-400 rounded-full animate-ping opacity-75" />
        )}
      </div>

      <span className={clsx(
        'text-xs font-medium transition-colors duration-300',
        connected ? 'text-emerald-400' : 'text-rose-500'
      )}>
        {connected ? 'Live' : 'Offline'}
      </span>

      {showTooltip && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 whitespace-nowrap z-50">
          {connected ? 'Real-time feed active' : 'Connecting to live feed...'}
        </div>
      )}
    </div>
  );
}

function Breadcrumb() {
  const pathname = usePathname();

  const getBreadcrumbs = (): string[] => {
    if (pathname === '/dashboard') {
      return ['FraudScope', 'Dashboard'];
    }
    if (pathname.startsWith('/dashboard/profile')) {
      return ['FraudScope', 'User Profile'];
    }
    if (pathname.startsWith('/dashboard/live-feed')) {
      return ['FraudScope', 'Monitoring', 'Live Feed'];
    }
    if (pathname.startsWith('/dashboard/alerts')) {
      return ['FraudScope', 'Monitoring', 'Alerts'];
    }
    if (pathname.startsWith('/dashboard/transactions')) {
      const parts = ['FraudScope', 'Investigation', 'Transactions'];
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length > 2) {
        parts.push(segments[2]);
      }
      return parts;
    }
    if (pathname.startsWith('/dashboard/accounts')) {
      return ['FraudScope', 'Investigation', 'Accounts'];
    }
    if (pathname.startsWith('/dashboard/admin/rules')) {
      return ['FraudScope', 'Configuration', 'Rules'];
    }
    if (pathname.startsWith('/dashboard/admin/users')) {
      return ['FraudScope', 'Configuration', 'Users'];
    }
    if (pathname.startsWith('/dashboard/admin/audit')) {
      return ['FraudScope', 'Configuration', 'Audit Logs'];
    }
    if (pathname.startsWith('/dashboard/analytics')) {
      return ['FraudScope', 'Analytics'];
    }

    // Default fallback
    const rawSegments = pathname.split('/').filter(Boolean);
    return ['FraudScope', ...rawSegments.map(s => s.charAt(0).toUpperCase() + s.slice(1))];
  };

  const segments = getBreadcrumbs();

  return (
    <div className="flex items-center gap-1.5 text-[13px]">
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        return (
          <span key={index} className="flex items-center gap-1.5">
            {index > 0 && <span className="text-[#4A4F6A]">/</span>}
            <span
              className={clsx(
                isLast ? 'text-[#F1F3FA] font-medium' : 'text-[#8B8FA8]'
              )}
            >
              {segment}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function UserMenu({ email, role }: { email: string; role: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { logout } = useAuth();

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  useEffect(() => {
    if (!open) return;
    function handleClick() { setOpen(false); }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [open]);

  const initials = email
    .split('@')[0]
    .split(/[._-]/)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase() || '')
    .join('');

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(prev => !prev); }}
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
      >
        <div className="w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white">
          {initials || 'U'}
        </div>
        <span className="hidden sm:block text-sm max-w-28 truncate">{email}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-[#131929] border border-[#1E2535] rounded-lg shadow-xl z-50">
          <div className="px-4 py-3 border-b border-[#1E2535]">
            <p className="text-sm text-slate-200 font-medium truncate">{email}</p>
            <p className="text-xs text-slate-500 mt-0.5 capitalize">{role}</p>
          </div>
          <div className="p-1">
            <Link
              href="/dashboard/profile"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <User size={14} className="text-blue-400" />
              User Profile
            </Link>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface TopBarProps {
  userEmail: string;
  userRole: string;
  sidebarWidth?: number;
}

export function TopBar({ userEmail, userRole }: TopBarProps) {
  return (
    <header
      className={clsx(
        'fixed top-0 right-0 h-[48px] bg-[#0D0F1A] border-b border-[#1E2535]',
        'flex items-center justify-between px-4 z-40 transition-all duration-200'
      )}
      style={{ left: 'var(--sidebar-width, 240px)' }}
    >
      {/* Left section: Breadcrumb */}
      <Breadcrumb />

      {/* Center section: Global Search input */}
      <GlobalSearch />

      {/* Right section: Action buttons + WebSocketStatus + User Menu */}
      <div className="flex items-center gap-3">
        <WebSocketStatus />

        {/* Bell icon button */}
        <button
          type="button"
          aria-label="Notifications"
          className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-[#8B8FA8] hover:bg-[#131929] hover:text-[#F1F3FA] transition-colors duration-150 cursor-pointer"
        >
          <Bell size={16} />
        </button>

        {/* Clock icon button */}
        <button
          type="button"
          aria-label="Recent activity"
          className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-[#8B8FA8] hover:bg-[#131929] hover:text-[#F1F3FA] transition-colors duration-150 cursor-pointer"
        >
          <Clock size={16} />
        </button>

        {/* User profile link button */}
        <Link
          href="/dashboard/profile"
          aria-label="User profile"
          className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-[#8B8FA8] hover:bg-[#131929] hover:text-[#F1F3FA] transition-colors duration-150 cursor-pointer"
        >
          <User size={16} />
        </Link>

        <UserMenu email={userEmail} role={userRole} />
      </div>
    </header>
  );
}