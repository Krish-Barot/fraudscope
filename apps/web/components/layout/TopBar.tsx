'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, Clock, User, Search, LogOut } from 'lucide-react';
import clsx from 'clsx';
import { ACCESS_TOKEN_COOKIE } from '../../lib/auth';

function getInitials(email: string): string {
  if (!email) return 'FS';
  const namePart = email.split('@')[0];
  const parts = namePart.split(/[\._\-]/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return namePart.slice(0, 2).toUpperCase();
}

function Breadcrumb() {
  const pathname = usePathname();

  // /dashboard -> ["FraudScope", "Dashboard"]
  // /dashboard/transactions -> ["FraudScope", "Dashboard", "Transactions"]
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

interface TopBarProps {
  userEmail: string;
  userRole: string;
  sidebarWidth?: number;
}

export function TopBar({ userEmail, userRole }: TopBarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const router = useRouter();

  function handleLogout() {
    document.cookie = `${ACCESS_TOKEN_COOKIE}=; max-age=0; path=/`;
    document.cookie = `fraudscope_refresh_token=; max-age=0; path=/`;
    router.push('/login');
  }

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClickOutside() {
      setDropdownOpen(false);
    }
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [dropdownOpen]);

  const initials = getInitials(userEmail);

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

      {/* Right section: Action buttons + User Avatar */}
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

        {/* Avatar button & Dropdown */}
        <div className="relative ml-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setDropdownOpen((prev) => !prev);
            }}
            className="w-[28px] h-[28px] rounded-full bg-[#3882F6] flex items-center justify-center text-[11px] font-bold text-white cursor-pointer select-none"
          >
            {initials}
          </button>

          {dropdownOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-full mt-1.5 w-52 bg-[#131929] border border-[#1E2535] rounded-lg shadow-xl z-50 p-3 space-y-3"
            >
              <div>
                <p className="text-[13px] font-medium text-[#F1F3FA] truncate">
                  {userEmail}
                </p>
                <p className="text-[11px] text-[#8B8FA8] capitalize mt-0.5">
                  Role: {userRole}
                </p>
              </div>
              <div className="pt-2 border-t border-[#1E2535]">
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-[12px] text-[#EF4444] hover:bg-[rgba(239,68,68,0.1)] rounded transition-colors duration-150"
                >
                  <LogOut size={14} />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}