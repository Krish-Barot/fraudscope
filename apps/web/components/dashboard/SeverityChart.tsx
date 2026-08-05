'use client';

import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface SeverityItem {
  name: string;
  value: number;
  countText: string;
  color: string;
}

const data: SeverityItem[] = [
  { name: 'Critical', value: 25, countText: '25% (6)', color: '#FF6B6B' },
  { name: 'High',     value: 35, countText: '35% (8)', color: '#F59E0B' },
  { name: 'Medium',   value: 40, countText: '40% (9)', color: '#3882F6' },
];

export function SeverityChart() {
  return (
    <div className="bg-[#131929] border border-[#1E2535] rounded-[10px] p-[20px_24px] flex flex-col justify-between">
      {/* Title */}
      <h3 className="text-[14px] font-medium text-[#F1F3FA] mb-2">
        Severity Breakdown
      </h3>

      {/* Chart & Legend layout */}
      <div className="flex items-center justify-between h-[160px]">
        {/* Donut Chart container with absolute centered label */}
        <div className="relative w-[160px] h-[160px] flex items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={80}
                paddingAngle={2}
                dataKey="value"
                startAngle={90}
                endAngle={-270}
                stroke="none"
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>

          {/* Center text overlay */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
            <span className="text-[20px] font-bold text-[#F1F3FA] font-mono leading-none">
              100%
            </span>
            <span className="text-[11px] text-[#8B8FA8] mt-0.5">
              Coverage
            </span>
          </div>
        </div>

        {/* Legend vertical list to the right */}
        <div className="flex flex-col gap-2 shrink-0">
          {data.map((item) => (
            <div key={item.name} className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-[2px] shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-[12px] text-[#8B8FA8] w-[50px]">
                {item.name}
              </span>
              <span className="text-[12px] font-mono text-[#F1F3FA]">
                {item.countText}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
