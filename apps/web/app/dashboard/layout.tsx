// apps/web/app/dashboard/layout.tsx
// Dashboard shell — sidebar + top bar + main content area
// Server Component — reads user info from request headers set by middleware

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Sidebar } from '../../components/layout/Sidebar';
import { TopBar } from '../../components/layout/TopBar';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read user info from headers set by middleware
  const headersList = await headers();
  const userId = headersList.get('x-user-id');
  const userEmail = headersList.get('x-user-email');
  const userRole = headersList.get('x-user-role') as 'analyst' | 'admin';

  if (!userId || !userEmail || !userRole) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen flex bg-[#0D0F1A]">
      {/* Fixed left sidebar */}
      <Sidebar userRole={userRole} userEmail={userEmail} />

      {/* Main content area — offset by dynamic sidebar width */}
      <div
        className="flex-1 flex flex-col transition-all duration-200"
        style={{ paddingLeft: 'var(--sidebar-width, 190px)' }}
      >
        {/* Fixed top bar */}
        <TopBar userEmail={userEmail} userRole={userRole} />

        {/* Page content — below 48px top bar */}
        <main className="flex-1 mt-[48px] p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}