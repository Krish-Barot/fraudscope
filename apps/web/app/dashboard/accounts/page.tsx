// apps/web/app/dashboard/accounts/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { Users, Search, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../../lib/authContext';
import { apiFetch } from '../../lib/api';

export default function AccountsPage() {
  const { accessToken, isLoading: isAuthLoading } = useAuth();
  const [alerts, setAlerts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadAccounts() {
      if (isAuthLoading) return;

      setIsLoading(true);
      try {
        const res = await apiFetch('/api/v1/alerts?limit=50');
        if (res.ok) {
          const data = await res.json();
          setAlerts(data.data || []);
        }
      } catch (err) {
        console.error('Failed to load accounts from alerts:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadAccounts();
  }, [accessToken, isAuthLoading]);

  // Aggregate unique accounts from alerts/transactions
  const accountsMap = new Map<string, { accountId: string; alertCount: number; maxScore: number; lastSeen: string }>();
  alerts.forEach((alert) => {
    const accId = alert.transaction?.account_id || 'ACC-DEFAULT';
    const existing = accountsMap.get(accId) || { accountId: accId, alertCount: 0, maxScore: 0, lastSeen: alert.created_at };
    accountsMap.set(accId, {
      accountId: accId,
      alertCount: existing.alertCount + 1,
      maxScore: Math.max(existing.maxScore, alert.risk_score || 0),
      lastSeen: alert.created_at,
    });
  });

  const accounts = Array.from(accountsMap.values());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-2 border-b border-[#1E2535]">
        <div>
          <h1 className="text-xl font-bold text-[#F1F3FA]">Account Risk Profiles</h1>
          <p className="text-xs text-[#8B8FA8] mt-0.5">
            Monitored accounts and aggregate risk indicators
          </p>
        </div>
      </div>

      <div className="bg-[#0D0F1A] border border-[#1E2535] rounded-xl overflow-hidden">
        <div className="p-4 border-b border-[#1E2535] bg-[#131929] flex items-center justify-between">
          <span className="text-xs font-mono text-[#F1F3FA]">
            Active Accounts Monitored: {accounts.length}
          </span>
        </div>

        {isLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-[#131929] rounded animate-pulse" />
            ))}
          </div>
        ) : accounts.length === 0 ? (
          <div className="p-12 text-center text-xs text-[#4A4F6A]">
            No account risk profiles recorded yet.
          </div>
        ) : (
          <div className="divide-y divide-[#1E2535]">
            {accounts.map((acc) => (
              <div key={acc.accountId} className="p-4 flex items-center justify-between hover:bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[#131929] text-[#3882F6]">
                    <Users size={16} />
                  </div>
                  <div>
                    <span className="font-mono text-sm font-semibold text-[#F1F3FA] block">
                      {acc.accountId}
                    </span>
                    <span className="text-xs text-[#8B8FA8]">
                      Last flag: {new Date(acc.lastSeen).toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <span className="text-xs font-mono text-[#8B8FA8]">
                    {acc.alertCount} alert{acc.alertCount > 1 ? 's' : ''}
                  </span>
                  <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30">
                    Highest Risk: {acc.maxScore}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
