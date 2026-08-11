// apps/web/components/layout/GlobalSearch.tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Loader2, Receipt, Users, AlertCircle, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../lib/authContext';
import { apiFetch } from '../../app/lib/api';

interface TxResult {
  id: string;
  external_id: string;
  account_id: string;
  amount: number | string;
  currency: string;
  merchant_name?: string;
  status: string;
  created_at: string;
}

interface AccountResult {
  account_id: string;
  transaction_count: number;
  alert_count: number;
}

interface SearchResults {
  transactions: TxResult[];
  accounts: AccountResult[];
}

export function GlobalSearch() {
  const router = useRouter();
  const { getAccessToken } = useAuth();

  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const [results, setResults] = useState<SearchResults>({ transactions: [], accounts: [] });
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Flattened items list for keyboard navigation
  const flattenedItems = [
    ...results.transactions.map((tx) => ({ type: 'tx' as const, data: tx })),
    ...results.accounts.map((acc) => ({ type: 'account' as const, data: acc })),
  ];

  // ── Debounced Search API Fetch ────────────────────────────────────
  const executeSearch = useCallback(async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setResults({ transactions: [], accounts: [] });
      setIsLoading(false);
      setError(false);
      return;
    }

    setIsLoading(true);
    setError(false);

    try {
      const res = await apiFetch(`/api/v1/transactions/search?q=${encodeURIComponent(trimmed)}`);
      if (res.ok) {
        const data = await res.json();
        setResults({
          transactions: data.transactions || [],
          accounts: data.accounts || [],
        });
        setSelectedIndex(-1);
      } else {
        setError(true);
      }
    } catch (err) {
      console.error('Global search failed:', err);
      setError(true);
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setIsOpen(true);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!val.trim()) {
      setResults({ transactions: [], accounts: [] });
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    debounceTimerRef.current = setTimeout(() => {
      executeSearch(val);
    }, 250);
  };

  // ── Outside click & Escape handler ─────────────────────────────────
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── Select and Navigate ────────────────────────────────────────────
  const handleSelectItem = (item: { type: 'tx' | 'account'; data: any }) => {
    setIsOpen(false);
    setQuery('');
    if (item.type === 'tx') {
      router.push(`/dashboard/transactions/${item.data.id}`);
    } else {
      router.push(`/dashboard/accounts`);
    }
  };

  // ── Keyboard Navigation Handler ──────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
      return;
    }

    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setIsOpen(true);
      return;
    }

    if (flattenedItems.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < flattenedItems.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : flattenedItems.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < flattenedItems.length) {
        handleSelectItem(flattenedItems[selectedIndex]);
      } else if (flattenedItems.length > 0) {
        handleSelectItem(flattenedItems[0]);
      }
    }
  };

  const hasResults = results.transactions.length > 0 || results.accounts.length > 0;
  const isTyping = query.trim().length > 0;

  return (
    <div ref={containerRef} className="relative w-[280px] sm:w-[320px]">
      {/* Search Input */}
      <div className="relative">
        <Search
          size={14}
          className="absolute left-[10px] top-1/2 -translate-y-1/2 text-[#4A4F6A] pointer-events-none"
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search transactions, accounts..."
          className={clsx(
            'w-full h-[32px] pl-[32px] pr-8 bg-[#131929] border border-[#1E2535] rounded-[8px]',
            'text-[13px] text-[#F1F3FA] placeholder-[#4A4F6A]',
            'focus:outline-none focus:border-[#3882F6] transition-colors duration-150'
          )}
        />
        {isLoading && (
          <Loader2
            size={14}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#3882F6] animate-spin"
          />
        )}
      </div>

      {/* Search Results Popover */}
      {isOpen && isTyping && (
        <div className="absolute left-0 top-full mt-1.5 w-[360px] max-h-[380px] bg-[#0D0F1A] border border-[#1E2535] rounded-xl shadow-2xl z-50 overflow-y-auto">
          {isLoading && !hasResults ? (
            <div className="p-4 flex items-center justify-center gap-2 text-xs text-[#8B8FA8] font-mono">
              <Loader2 size={14} className="animate-spin text-[#3882F6]" />
              Searching...
            </div>
          ) : error ? (
            <div className="p-4 text-center text-xs text-rose-400 flex items-center justify-center gap-1.5 font-mono">
              <AlertCircle size={14} />
              Unable to search right now.
            </div>
          ) : !hasResults ? (
            <div className="p-6 text-center text-xs text-[#4A4F6A] font-mono">
              No transactions or accounts found.
            </div>
          ) : (
            <div className="py-2 divide-y divide-[#1E2535]">
              {/* Transactions Section */}
              {results.transactions.length > 0 && (
                <div className="py-1">
                  <div className="px-3 py-1 text-[10px] font-bold text-[#4A4F6A] tracking-wider uppercase font-mono">
                    TRANSACTIONS
                  </div>
                  {results.transactions.map((tx, idx) => {
                    const isSelected = selectedIndex === idx;
                    return (
                      <button
                        key={tx.id}
                        onClick={() => handleSelectItem({ type: 'tx', data: tx })}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={clsx(
                          'w-full px-3 py-2 text-left flex items-center justify-between text-xs transition-colors',
                          isSelected ? 'bg-[#3882F6]/15 text-[#F1F3FA]' : 'hover:bg-white/[0.03] text-[#8B8FA8]'
                        )}
                      >
                        <div className="flex items-center gap-2.5 overflow-hidden">
                          <Receipt size={14} className="text-[#3882F6] shrink-0" />
                          <div className="truncate">
                            <span className="font-mono font-medium text-[#F1F3FA] block truncate">
                              {tx.external_id || tx.id}
                            </span>
                            <span className="text-[11px] font-mono text-[#8B8FA8] block truncate">
                              {tx.account_id} {tx.merchant_name ? `• ${tx.merchant_name}` : ''}
                            </span>
                          </div>
                        </div>

                        <div className="text-right shrink-0 pl-2">
                          <span className="font-mono font-bold text-[#F1F3FA] block">
                            ${parseFloat(tx.amount as any).toFixed(2)} {tx.currency}
                          </span>
                          <span
                            className={clsx(
                              'text-[10px] font-mono uppercase font-bold',
                              tx.status === 'clean' ? 'text-emerald-400' : 'text-rose-400'
                            )}
                          >
                            {tx.status}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Accounts Section */}
              {results.accounts.length > 0 && (
                <div className="py-1">
                  <div className="px-3 py-1 text-[10px] font-bold text-[#4A4F6A] tracking-wider uppercase font-mono">
                    ACCOUNTS
                  </div>
                  {results.accounts.map((acc, idx) => {
                    const globalIdx = results.transactions.length + idx;
                    const isSelected = selectedIndex === globalIdx;
                    return (
                      <button
                        key={acc.account_id}
                        onClick={() => handleSelectItem({ type: 'account', data: acc })}
                        onMouseEnter={() => setSelectedIndex(globalIdx)}
                        className={clsx(
                          'w-full px-3 py-2 text-left flex items-center justify-between text-xs transition-colors',
                          isSelected ? 'bg-[#3882F6]/15 text-[#F1F3FA]' : 'hover:bg-white/[0.03] text-[#8B8FA8]'
                        )}
                      >
                        <div className="flex items-center gap-2.5">
                          <Users size={14} className="text-indigo-400 shrink-0" />
                          <span className="font-mono font-medium text-[#F1F3FA]">
                            {acc.account_id}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-mono text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                            {acc.alert_count} alert{acc.alert_count !== 1 ? 's' : ''}
                          </span>
                          <ChevronRight size={12} className="text-[#4A4F6A]" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
