import Link from 'next/link';
import { TrendingDown, SlidersHorizontal } from 'lucide-react';
import { AlertVolumeChart } from '../../components/dashboard/AlertVolumeChart';
import { SeverityChart } from '../../components/dashboard/SeverityChart';

const RECENT_ALERTS = [
  { risk: 98, txId: '#TX-94021', amount: '$12,400.00', status: 'Pending', statusColor: '#F59E0B' },
  { risk: 72, txId: '#TX-94019', amount: '$850.25',    status: 'Reviewing', statusColor: '#3882F6' },
  { risk: 92, txId: '#TX-94015', amount: '$3,100.00',  status: 'Pending', statusColor: '#F59E0B' },
];

const FLAGGED_ACCOUNTS = [
  { id: 'ACC-8812-X', alerts: 12, vol: '$45.2k',  bars: ['30%', '50%', '75%', '100%'] },
  { id: 'ACC-4491-Z', alerts: 9,  vol: '$22.1k',  bars: ['60%', '60%', '60%', '60%'] },
  { id: 'ACC-1022-Q', alerts: 7,  vol: '$108.4k', bars: ['100%', '75%', '50%', '30%'] },
];

export default function DashboardPage() {
  return (
    <div className="min-w-[1230px] select-none">
      {/* Section 1 — Metric cards row (4 cards, grid-cols-4, gap-4, mb-6) */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {/* Card 1 — Transactions Today */}
        <div className="bg-[#131929] border border-[#1E2535] rounded-[10px] px-6 py-5 h-[108px] flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold tracking-widest text-[#8B8FA8] uppercase">
              TRANSACTIONS TODAY
            </span>
          </div>
          <div className="flex items-end justify-between mt-1">
            <span className="text-[28px] font-semibold text-[#F1F3FA] font-mono leading-none">
              12,847
            </span>
            {/* Mini bar chart */}
            <div className="flex items-end gap-[3px] h-[24px]">
              {['60%', '40%', '75%', '55%', '85%', '70%'].map((height, i) => (
                <div
                  key={i}
                  className="w-[6px] rounded-[2px]"
                  style={{
                    height,
                    backgroundColor: i % 2 === 0 ? '#3882F6' : '#1E3A5F',
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Card 2 — Alerts Generated */}
        <div className="bg-[#131929] border border-[#1E2535] rounded-[10px] px-6 py-5 h-[108px] flex flex-col justify-between">
          <span className="text-[10px] font-semibold tracking-widest text-[#8B8FA8] uppercase">
            ALERTS GENERATED
          </span>
          <div className="flex items-end justify-between mt-1">
            <span className="text-[28px] font-semibold text-[#F1F3FA] font-mono leading-none">
              23
            </span>
            {/* 6 dots row */}
            <div className="flex items-center gap-[4px] mb-1">
              {['#FF6B6B', '#FF6B6B', '#F59E0B', '#F59E0B', '#3882F6', '#3882F6'].map((color, i) => (
                <span
                  key={i}
                  className="w-[8px] h-[8px] rounded-full"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Card 3 — Pending Review */}
        <div className="bg-[#131929] border border-[#1E2535] border-l-[3px] border-l-[#D16900] rounded-[10px] px-6 py-5 h-[108px] flex flex-col justify-between">
          <span className="text-[10px] font-semibold tracking-widest text-[#D16900] uppercase">
            PENDING REVIEW
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-[28px] font-semibold text-[#D16900] font-mono leading-none">
              8
            </span>
            <span className="text-[11px] text-[#D16900] opacity-80 font-medium">
              Requires immediate analyst action
            </span>
          </div>
        </div>

        {/* Card 4 — Avg Response Time */}
        <div className="bg-[#131929] border border-[#1E2535] rounded-[10px] px-6 py-5 h-[108px] flex flex-col justify-between">
          <span className="text-[10px] font-semibold tracking-widest text-[#8B8FA8] uppercase">
            AVG RESPONSE TIME
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-[28px] font-semibold text-[#F1F3FA] font-mono leading-none">
              4m 32s
            </span>
            <div className="flex items-center gap-1 text-[11px] text-[#22C55E] font-medium">
              <TrendingDown size={12} className="text-[#22C55E]" />
              <span>+12% from avg</span>
            </div>
          </div>
        </div>
      </div>

      {/* Section 2 — Charts row (grid-cols-5, gap-4, mb-6) */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <div className="col-span-3">
          <AlertVolumeChart />
        </div>
        <div className="col-span-2">
          <SeverityChart />
        </div>
      </div>

      {/* Section 3 — Bottom row (grid-cols-2, gap-4) */}
      <div className="grid grid-cols-2 gap-4">
        {/* Left card: Recent Alerts */}
        <div className="bg-[#131929] border border-[#1E2535] rounded-[10px] p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-medium text-[#F1F3FA]">
              Recent Alerts
            </h3>
            <Link
              href="/dashboard/alerts"
              className="text-[12px] text-[#3882F6] hover:underline"
            >
              View All
            </Link>
          </div>

          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#1E2535] text-[11px] font-semibold uppercase text-[#8B8FA8]">
                <th className="pb-2 font-normal">Risk</th>
                <th className="pb-2 font-normal">Tx ID</th>
                <th className="pb-2 font-normal">Amount</th>
                <th className="pb-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {RECENT_ALERTS.map((row, idx) => {
                const isHighRisk = row.risk >= 80;
                const isMedRisk = row.risk >= 60 && row.risk < 80;

                const badgeBg = isHighRisk
                  ? 'rgba(255,107,107,0.15)'
                  : isMedRisk
                  ? 'rgba(245,158,11,0.15)'
                  : 'rgba(56,130,246,0.15)';

                const badgeText = isHighRisk
                  ? '#FF6B6B'
                  : isMedRisk
                  ? '#F59E0B'
                  : '#3882F6';

                return (
                  <tr
                    key={idx}
                    className="h-[40px] border-b border-[#0D0F1A] hover:bg-[rgba(255,255,255,0.02)] transition-colors duration-150"
                  >
                    <td>
                      <span
                        className="inline-flex items-center justify-center w-[28px] h-[20px] rounded text-[12px] font-mono font-medium"
                        style={{ backgroundColor: badgeBg, color: badgeText }}
                      >
                        {row.risk}
                      </span>
                    </td>
                    <td className="text-[13px] font-mono text-[#F1F3FA]">
                      {row.txId}
                    </td>
                    <td className="text-[13px] font-mono text-[#F1F3FA]">
                      {row.amount}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span
                          className="w-[8px] h-[8px] rounded-full shrink-0"
                          style={{ backgroundColor: row.statusColor }}
                        />
                        <span className="text-[13px] text-[#8B8FA8]">
                          {row.status}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Right card: Top Flagged Accounts */}
        <div className="bg-[#131929] border border-[#1E2535] rounded-[10px] p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-medium text-[#F1F3FA]">
              Top Flagged Accounts
            </h3>
            <button
              type="button"
              aria-label="Filter accounts"
              className="text-[#8B8FA8] hover:text-[#F1F3FA] transition-colors duration-150"
            >
              <SlidersHorizontal size={14} />
            </button>
          </div>

          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#1E2535] text-[11px] font-semibold uppercase text-[#8B8FA8]">
                <th className="pb-2 font-normal">Account ID</th>
                <th className="pb-2 font-normal">Alerts</th>
                <th className="pb-2 font-normal">Total Vol.</th>
                <th className="pb-2 font-normal">Trend</th>
              </tr>
            </thead>
            <tbody>
              {FLAGGED_ACCOUNTS.map((row) => (
                <tr
                  key={row.id}
                  className="h-[40px] border-b border-[#0D0F1A] hover:bg-[rgba(255,255,255,0.02)] transition-colors duration-150"
                >
                  <td className="text-[13px] font-mono text-[#F1F3FA]">
                    {row.id}
                  </td>
                  <td className="text-[13px] font-mono text-[#F1F3FA]">
                    {row.alerts}
                  </td>
                  <td className="text-[13px] font-mono text-[#F1F3FA]">
                    {row.vol}
                  </td>
                  <td>
                    {/* Inline mini bar chart showing trend */}
                    <div className="flex items-end gap-[2px] h-[16px]">
                      {row.bars.map((h, i) => (
                        <div
                          key={i}
                          className="w-[4px] rounded-[1px]"
                          style={{
                            height: h,
                            backgroundColor:
                              i === row.bars.length - 1 ? '#60A5FA' : '#3882F6',
                          }}
                        />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}