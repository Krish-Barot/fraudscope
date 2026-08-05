'use client';

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  Tooltip,
} from 'recharts';

interface DataPoint {
  time: string;
  critical: number;
  high: number;
}

const data: DataPoint[] = [
  { time: '00:00', critical: 4, high: 12 },
  { time: '01:00', critical: 3, high: 10 },
  { time: '02:00', critical: 2, high: 8 },
  { time: '03:00', critical: 1, high: 6 },
  { time: '04:00', critical: 2, high: 9 },
  { time: '05:00', critical: 5, high: 14 },
  { time: '06:00', critical: 8, high: 18 },
  { time: '07:00', critical: 12, high: 24 },
  { time: '08:00', critical: 15, high: 30 },
  { time: '09:00', critical: 18, high: 35 },
  { time: '10:00', critical: 14, high: 28 },
  { time: '11:00', critical: 10, high: 22 },
  { time: '12:00', critical: 16, high: 32 },
  { time: '13:00', critical: 22, high: 40 },
  { time: '14:00', critical: 19, high: 36 },
  { time: '15:00', critical: 13, high: 26 },
  { time: '16:00', critical: 17, high: 31 },
  { time: '17:00', critical: 20, high: 38 },
  { time: '18:00', critical: 15, high: 29 },
  { time: 'Now', critical: 11, high: 24 },
];

function CustomTooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#131929] border border-[#1E2535] p-2 rounded text-xs shadow-lg space-y-1">
        <p className="font-semibold text-[#F1F3FA] mb-1">{label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: entry.stroke }}
            />
            <span className="text-[#8B8FA8] capitalize">{entry.name}:</span>
            <span className="font-mono text-[#F1F3FA]">{entry.value}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
}

export function AlertVolumeChart() {
  return (
    <div className="bg-[#131929] border border-[#1E2535] rounded-[10px] p-[20px_24px] flex flex-col justify-between">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-medium text-[#F1F3FA]">
          Alert Volume (24h)
        </h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#FF6B6B]" />
            <span className="text-[12px] text-[#8B8FA8]">Critical</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#3882F6]" />
            <span className="text-[12px] text-[#8B8FA8]">High</span>
          </div>
        </div>
      </div>

      {/* Chart container */}
      <div className="h-[160px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 5, right: 0, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="criticalGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FF6B6B" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#FF6B6B" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="highGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3882F6" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#3882F6" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              ticks={['00:00', '06:00', '12:00', '18:00', 'Now']}
              stroke="transparent"
              tick={{ fill: '#4A4F6A', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="critical"
              name="Critical"
              stroke="#FF6B6B"
              fill="url(#criticalGradient)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="high"
              name="High"
              stroke="#3882F6"
              fill="url(#highGradient)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
