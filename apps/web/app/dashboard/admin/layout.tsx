// apps/web/app/dashboard/admin/layout.tsx
// Admin layout guard — second layer of defense after proxy.ts
// Redirects non-admin users to /dashboard
// This is a Server Component that reads headers set by proxy.ts

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersList = await headers();
  const userRole = headersList.get('x-user-role');

  // If proxy didn't set user headers, or user is not admin, redirect
  // This should rarely trigger since proxy.ts handles it first,
  // but it provides defense-in-depth
  if (userRole !== 'admin') {
    redirect('/dashboard');
  }

  return <>{children}</>;
}
