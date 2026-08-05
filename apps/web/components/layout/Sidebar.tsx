'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Search,
  Settings,
  BarChart3,
  HelpCircle,
  User,
  ChevronLeft,
  ChevronRight,
  Shield,
  Crosshair,
} from 'lucide-react';
import clsx from 'clsx';

interface NavSectionItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavSectionItem[] = [
  { label: 'Monitoring',    href: '/dashboard',             icon: Activity },
  { label: 'Investigation', href: '/dashboard/transactions',icon: Search },
  { label: 'Configuration', href: '/dashboard/rules',       icon: Settings, adminOnly: true },
  { label: 'Analytics',     href: '/dashboard/analytics',   icon: BarChart3 },
];

const BOTTOM_ITEMS: NavSectionItem[] = [
  { label: 'Support',      href: '#', icon: HelpCircle },
  { label: 'User Profile', href: '#', icon: User },
];

interface SidebarProps {
  userRole: 'analyst' | 'admin';
  userEmail?: string;
}

export function Sidebar({ userRole }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--sidebar-width',
      collapsed ? '56px' : '190px'
    );
  }, [collapsed]);

  const visibleNavItems = NAV_ITEMS.filter(
    (item) => !item.adminOnly || userRole === 'admin'
  );

  return (
    <aside
      className={clsx(
        'fixed left-0 top-0 h-full bg-[#0A0D16] border-r border-[#1E2535]',
        'flex flex-col transition-all duration-200 z-30 select-none'
      )}
      style={{ width: collapsed ? '56px' : '190px' }}
    >
      {/* Header section (height 56px, border-bottom 1px solid #1E2535) */}
      <div
        className={clsx(
          'h-[56px] border-b border-[#1E2535] flex items-center shrink-0 px-3',
          collapsed ? 'justify-center' : 'gap-2.5'
        )}
      >
        <div className="w-8 h-8 rounded-lg bg-[#3882F6] flex items-center justify-center shrink-0 relative">
          <Shield size={16} className="text-white" />
          <Crosshair size={10} className="text-white absolute" />
        </div>
        {!collapsed && (
          <div className="flex flex-col overflow-hidden">
            <span className="text-[14px] font-bold text-[#F1F3FA] leading-none truncate">
              FraudScope
            </span>
            <span className="text-[10px] text-[#4A4F6A] leading-tight mt-1 truncate">
              Enterprise Guard
            </span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 space-y-1">
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.label}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={clsx(
                'h-[36px] flex items-center gap-3 transition-colors duration-150 relative text-[13px] font-medium',
                collapsed ? 'justify-center px-0' : 'pl-[20px] pr-3',
                isActive
                  ? 'bg-[rgba(56,130,246,0.12)] text-[#3882F6] border-l-[2px] border-l-[#3882F6]'
                  : 'text-[#8B8FA8] hover:bg-[rgba(56,130,246,0.08)] hover:text-[#F1F3FA]'
              )}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Bottom rows (Support & User Profile) */}
      <div className="mt-auto pb-4 shrink-0">
        <div className="mx-3 border-t border-[#1E2535] mb-2" />
        <div className="space-y-1">
          {BOTTOM_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={clsx(
                  'h-[36px] flex items-center gap-3 transition-colors duration-150 text-[13px] font-medium text-[#8B8FA8]',
                  'hover:bg-[rgba(56,130,246,0.08)] hover:text-[#F1F3FA]',
                  collapsed ? 'justify-center px-0' : 'pl-[20px] pr-3'
                )}
              >
                <Icon size={18} className="shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Collapse toggle button */}
      <button
        onClick={() => setCollapsed((prev) => !prev)}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className={clsx(
          'absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10',
          'w-6 h-6 rounded-full bg-[#1E2535] border border-[#1E2535]',
          'flex items-center justify-center text-[#8B8FA8] hover:text-[#F1F3FA]',
          'transition-colors duration-150 cursor-pointer shadow-md'
        )}
      >
        {collapsed ? (
          <ChevronRight size={12} />
        ) : (
          <ChevronLeft size={12} />
        )}
      </button>
    </aside>
  );
}