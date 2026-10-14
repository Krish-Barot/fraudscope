// apps/web/app/dashboard/transactions/page.tsx
// Transactions Listing Page — matches Stitch design
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Filter, RefreshCw, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../../lib/authContext';
import { apiFetch } from '../../lib/api';
import { countryToFlag } from '../../lib/countryFlags';

interface Transaction {
  id: string;
  external_id: string;
  account_id: string;
  amount: string | number;
  currency: string;
  merchant_name?: string;
  country_code: string;
  channel?: string;
  status: 'clean' | 'flagged' | 'blocked';
  created_at: string;
}

export default function TransactionsListingPage() {
  const router = useRouter();
  const { getAccessToken } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const fetchTransactions = async () => {
    setIsLoading(true);
    try {
      const token = getAccessToken();
      let url = `/api/v1/transactions?page=${page}&limit=25&sort=created_at:desc`;
      if (statusFilter !== 'all') {
        url += `&status=${statusFilter}`;
      }
      if (searchQuery.trim()) {
        url += `&account_id=${encodeURIComponent(searchQuery.trim())}`;
      }

      const res = await apiFetch(url, {}, token);
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.data || []);
        if (data.pagination) {
          setTotalPages(data.pagination.pages || 1);
        }
      }
    } catch (err) {
      console.error('Failed to fetch transactions list:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, [page, statusFilter, getAccessToken]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[#1E2535]">
        <div>
          <h1 className="text-xl font-bold text-[#F1F3FA]">Transactions</h1>
          <p className="text-xs text-[#8B8FA8] mt-0.5">
            Surveillance history and detailed transaction ledger
          </p>
        </div>

        {/* Refresh button */}
        <button
          onClick={fetchTransactions}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#131929] border border-[#1E2535] text-xs font-medium text-[#8B8FA8] hover:text-[#F1F3FA] transition-colors self-start sm:self-auto"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Control Bar: Filters & Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-3 bg-[#0D0F1A] border border-[#1E2535] rounded-xl">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {['all', 'clean', 'flagged', 'blocked'].map((status) => (
            <button
              key={status}
              onClick={() => {
                setStatusFilter(status);
                setPage(1);
              }}
              className={clsx(
                'px-3 py-1 rounded-lg text-xs font-mono font-medium uppercase transition-colors',
                statusFilter === status
                  ? 'bg-[#3882F6] text-white'
                  : 'bg-[#131929] text-[#8B8FA8] hover:text-[#F1F3FA] border border-[#1E2535]'
              )}
            >
              {status}
            </button>
          ))}
        </div>

        {/* Search by account ID */}
        <div className="relative w-full sm:w-[280px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4A4F6A]" />
          <input
            type="text"
            placeholder="Filter by Account ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setPage(1);
                fetchTransactions();
              }
            }}
            className="w-full h-8 pl-8 pr-3 bg-[#131929] border border-[#1E2535] rounded-lg text-xs text-[#F1F3FA] placeholder-[#4A4F6A] focus:outline-none focus:border-[#3882F6]"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#0D0F1A] border border-[#1E2535] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-[#131929] border-b border-[#1E2535]">
              <tr>
                <th className="py-3 px-4 text-xs font-mono font-semibold text-[#4A4F6A] tracking-wider">TIME</th>
                <th className="py-3 px-4 text-xs font-mono font-semibold text-[#4A4F6A] tracking-wider">TRANSACTION ID</th>
                <th className="py-3 px-4 text-xs font-mono font-semibold text-[#4A4F6A] tracking-wider">ACCOUNT</th>
                <th className="py-3 px-4 text-xs font-mono font-semibold text-[#4A4F6A] tracking-wider text-right">AMOUNT</th>
                <th className="py-3 px-4 text-xs font-mono font-semibold text-[#4A4F6A] tracking-wider">MERCHANT</th>
                <th className="py-3 px-4 text-xs font-mono font-semibold text-[#4A4F6A] tracking-wider">COUNTRY</th>
                <th className="py-3 px-4 text-xs font-mono font-semibold text-[#4A4F6A] tracking-wider">STATUS</th>
                <th className="py-3 px-4 text-xs font-mono font-semibold text-[#4A4F6A] tracking-wider text-right">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1E2535]">
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={8} className="py-3 px-4">
                      <div className="h-6 bg-[#131929] rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-xs text-[#4A4F6A]">
                    No transactions matching criteria.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    onClick={() => router.push(`/dashboard/transactions/${tx.id}`)}
                    className="hover:bg-white/[0.02] cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 text-xs font-mono text-[#8B8FA8]">
                      {new Date(tx.created_at).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-[#F1F3FA] font-medium">
                      {tx.external_id || tx.id}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-[#8B8FA8]">
                      {tx.account_id}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-[#F1F3FA] text-right font-medium">
                      {tx.amount} {tx.currency}
                    </td>
                    <td className="py-3 px-4 text-xs text-[#8B8FA8] truncate max-w-[140px]">
                      {tx.merchant_name || '—'}
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-[#8B8FA8]">
                      {countryToFlag(tx.country_code)} {tx.country_code}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <span
                        className={clsx(
                          'px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase',
                          tx.status === 'clean'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-rose-500/10 text-rose-400'
                        )}
                      >
                        {tx.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/dashboard/transactions/${tx.id}`);
                        }}
                        className="p-1 text-[#8B8FA8] hover:text-[#3882F6] transition-colors"
                      >
                        <ExternalLink size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#1E2535] bg-[#0D0F1A]">
          <span className="text-xs text-[#4A4F6A] font-mono">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded bg-[#131929] border border-[#1E2535] text-[#8B8FA8] hover:text-[#F1F3FA] disabled:opacity-40"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded bg-[#131929] border border-[#1E2535] text-[#8B8FA8] hover:text-[#F1F3FA] disabled:opacity-40"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}