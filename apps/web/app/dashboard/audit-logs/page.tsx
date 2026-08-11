// apps/web/app/dashboard/audit-logs/page.tsx
'use client';

import { FileCode, Shield } from 'lucide-react';

export default function AuditLogsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-2 border-b border-[#1E2535]">
        <div>
          <h1 className="text-xl font-bold text-[#F1F3FA]">Audit Logs</h1>
          <p className="text-xs text-[#8B8FA8] mt-0.5">
            Immutable security audit trail & analyst actions history
          </p>
        </div>
      </div>

      <div className="p-8 bg-[#0D0F1A] border border-[#1E2535] rounded-xl text-center space-y-3">
        <div className="w-12 h-12 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto">
          <FileCode size={24} />
        </div>
        <h2 className="text-sm font-semibold text-[#F1F3FA]">System Security Audit Trail</h2>
        <p className="text-xs text-[#8B8FA8] max-w-md mx-auto">
          Tracks analyst alert overrides, rule modifications, and authentication attempts. Admin access enforced.
        </p>
      </div>
    </div>
  );
}
