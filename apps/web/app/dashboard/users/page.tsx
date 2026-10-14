// apps/web/app/dashboard/users/page.tsx
'use client';

import { UserCheck, Shield } from 'lucide-react';

export default function UsersPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-2 border-b border-[#1E2535]">
        <div>
          <h1 className="text-xl font-bold text-[#F1F3FA]">User Management</h1>
          <p className="text-xs text-[#8B8FA8] mt-0.5">
            Admin portal for analyst credentials and system RBAC privileges
          </p>
        </div>
      </div>

      <div className="p-8 bg-[#0D0F1A] border border-[#1E2535] rounded-xl text-center space-y-3">
        <div className="w-12 h-12 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center mx-auto">
          <UserCheck size={24} />
        </div>
        <h2 className="text-sm font-semibold text-[#F1F3FA]">Analyst & Admin Management</h2>
        <p className="text-xs text-[#8B8FA8] max-w-md mx-auto">
          Configure security team roles, access keys, and operational permissions. Admin authentication required.
        </p>
      </div>
    </div>
  );
}
