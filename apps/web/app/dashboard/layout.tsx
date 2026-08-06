// apps/web/app/dashboard/layout.tsx
// Dashboard shell — sidebar + top bar + main content area
// Server Component — reads user info from request headers set by middleware

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Sidebar } from '../../components/layout/Sidebar';
import { TopBar } from '../../components/layout/TopBar';
import { SocketProvider } from '../../components/providers/SocketProvider';

const SIDEBAR_EXPANDED = 'var(--sidebar-width, 190px)';

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
    <div className="h-full flex">
      <Sidebar userRole={userRole} userEmail={userEmail} />
      <div className="flex-1 flex flex-col transition-all duration-200" style={{ paddingLeft: SIDEBAR_EXPANDED }}>
        <TopBar userEmail={userEmail} userRole={userRole} />
        <main className="flex-1 mt-14 p-6 overflow-auto">
          <SocketProvider>
            {children}
          </SocketProvider>
        </main>
      </div>
    </div>
  );
}