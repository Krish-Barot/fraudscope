'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, Clock, User, Search, LogOut } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../lib/authContext';

function Breadcrumb() {
  const pathname = usePathname();

  const rawSegments = pathname.split('/').filter(Boolean);
  const segments = ['FraudScope', ...rawSegments.map(s => s.charAt(0).toUpperCase() + s.slice(1))];

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
        <div className="absolute right-0 top-full mt-1 w-52 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50">
          <div className="px-4 py-3 border-b border-slate-700">
            <p className="text-sm text-slate-200 font-medium truncate">{email}</p>
            <p className="text-xs text-slate-500 mt-0.5 capitalize">{role}</p>
          </div>
          <div className="p-1">
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md text-slate-400 hover:text-red-400 hover:bg-slate-700 transition-colors"
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
        'flex items-center justify-between px-4 z-20 transition-all duration-200'
      )}
      style={{ left: 'var(--sidebar-width, 190px)' }}
    >
      {/* Left section: Breadcrumb */}
      <Breadcrumb />

      {/* Center section: Search input */}
      <div className="relative w-[280px]">
        <Search
          size={14}
          className="absolute left-[10px] top-1/2 -translate-y-1/2 text-[#4A4F6A] pointer-events-none"
        />
        <input
          type="search"
          placeholder="Search transactions, accounts..."
          className={clsx(
            'w-full h-[32px] pl-[32px] pr-3 bg-[#131929] border border-[#1E2535] rounded-[8px]',
            'text-[13px] text-[#F1F3FA] placeholder-[#4A4F6A]',
            'focus:outline-none focus:border-[#3882F6] transition-colors duration-150'
          )}
        />
      </div>

      {/* Right section: Action buttons + User Menu */}
      <div className="flex items-center gap-1">
        {/* Bell icon button */}
        <button
          type="button"
          aria-label="Notifications"
          className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-[#8B8FA8] hover:bg-[#131929] hover:text-[#F1F3FA] transition-colors duration-150"
        >
          <Bell size={16} />
        </button>

        {/* Clock icon button */}
        <button
          type="button"
          aria-label="Recent activity"
          className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-[#8B8FA8] hover:bg-[#131929] hover:text-[#F1F3FA] transition-colors duration-150"
        >
          <Clock size={16} />
        </button>

        {/* User circle button */}
        <button
          type="button"
          aria-label="User profile icon"
          className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-[#8B8FA8] hover:bg-[#131929] hover:text-[#F1F3FA] transition-colors duration-150"
        >
          <User size={16} />
        </button>

        <UserMenu email={userEmail} role={userRole} />
      </div>
    </header>
  );
}