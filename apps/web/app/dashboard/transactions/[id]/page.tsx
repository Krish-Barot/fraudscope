// apps/web/app/dashboard/transactions/[id]/page.tsx
'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Shield, AlertTriangle, User, Calendar, MapPin, Building } from 'lucide-react';
import { useAuth } from '../../../../lib/authContext';
import { apiFetch } from '../../../lib/api';
import { countryToFlag } from '../../../lib/countryFlags';
import { getSeverityFromScore, SEVERITY_BG, SEVERITY_TEXT } from '../../../lib/severity';

export default function TransactionDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { getAccessToken } = useAuth();
  const [transaction, setTransaction] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchTx() {
      const token = getAccessToken();
      const res = await apiFetch(`/api/v1/transactions/${id}`, {}, token);
      if (res.ok) {
        const data = await res.json();
        setTransaction(data);
      }
      setIsLoading(false);
    }
    if (id) fetchTx();
  }, [id, getAccessToken]);

  return (
    <div className="space-y-6">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-sm text-[#8B8FA8] hover:text-[#F1F3FA] transition-colors"
      >
        <ArrowLeft size={14} />
        Back
      </button>

      {isLoading ? (
        <div className="p-8 space-y-4 bg-[#0D0F1A] border border-[#1E2535] rounded-xl animate-pulse">
          <div className="h-6 w-48 bg-[#131929] rounded" />
          <div className="h-4 w-96 bg-[#131929] rounded" />
          <div className="h-24 w-full bg-[#131929] rounded" />
        </div>
      ) : !transaction ? (
        <div className="p-8 text-center text-[#8B8FA8] bg-[#0D0F1A] border border-[#1E2535] rounded-xl">
          Transaction not found
        </div>
      ) : (
        <div className="bg-[#0D0F1A] border border-[#1E2535] rounded-xl p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#1E2535] pb-4">
            <div>
              <span className="text-xs font-mono text-[#8B8FA8] uppercase tracking-wider block">
                Transaction ID
              </span>
              <h1 className="text-xl font-bold font-mono text-[#F1F3FA]">
                {transaction.external_id || transaction.id}
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold font-mono text-[#F1F3FA]">
                {transaction.amount} {transaction.currency}
              </span>
              <span
                className={`px-2.5 py-1 rounded text-xs font-mono font-bold uppercase ${
                  transaction.status === 'flagged' || transaction.status === 'blocked'
                    ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                }`}
              >
                {transaction.status}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-3 bg-[#131929] rounded-lg border border-[#1E2535]">
              <span className="text-[11px] text-[#4A4F6A] block uppercase font-mono">Account ID</span>
              <span className="text-xs font-mono text-[#F1F3FA] mt-1 block">{transaction.account_id}</span>
            </div>
            <div className="p-3 bg-[#131929] rounded-lg border border-[#1E2535]">
              <span className="text-[11px] text-[#4A4F6A] block uppercase font-mono">Merchant</span>
              <span className="text-xs text-[#F1F3FA] mt-1 block truncate">{transaction.merchant_name || '—'}</span>
            </div>
            <div className="p-3 bg-[#131929] rounded-lg border border-[#1E2535]">
              <span className="text-[11px] text-[#4A4F6A] block uppercase font-mono">Location</span>
              <span className="text-xs text-[#F1F3FA] mt-1 block">
                {countryToFlag(transaction.country_code)} {transaction.country_code}
              </span>
            </div>
            <div className="p-3 bg-[#131929] rounded-lg border border-[#1E2535]">
              <span className="text-[11px] text-[#4A4F6A] block uppercase font-mono">Timestamp</span>
              <span className="text-xs font-mono text-[#F1F3FA] mt-1 block">
                {new Date(transaction.created_at).toLocaleString()}
              </span>
            </div>
          </div>

          {/* Account History */}
          {transaction.account_history?.length > 0 && (
            <div className="pt-4 border-t border-[#1E2535]">
              <h3 className="text-xs font-mono text-[#4A4F6A] uppercase tracking-wider mb-3">
                Recent Account Activity ({transaction.account_history.length} transactions)
              </h3>
              <div className="space-y-1">
                {transaction.account_history.map((tx: any) => (
                  <div key={tx.id} className="flex items-center justify-between py-2 px-3 rounded bg-[#131929] text-xs font-mono">
                    <span className="text-[#8B8FA8]">{new Date(tx.created_at).toLocaleDateString()}</span>
                    <span className="text-[#F1F3FA] truncate max-w-[150px]">{tx.merchant_name || '—'}</span>
                    <span className="text-[#F1F3FA]">{tx.amount} {tx.currency}</span>
                    <span className={tx.status === 'flagged' ? 'text-rose-400' : 'text-emerald-400'}>
                      {tx.status.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
