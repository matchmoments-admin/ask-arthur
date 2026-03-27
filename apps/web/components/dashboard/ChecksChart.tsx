"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface DataPoint {
  date: string;
  total: number;
  high_risk: number;
}

export default function ChecksChart({ data }: { data: DataPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-xs text-slate-400">
        No check data yet
      </div>
    );
  }

  const chartData = data.map((d) => ({
    date: new Date(d.date).toLocaleDateString("en-AU", { day: "numeric", month: "short" }),
    Total: d.total,
    "High Risk": d.high_risk,
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
        <defs>
          <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#001F3F" stopOpacity={0.12} />
            <stop offset="95%" stopColor="#001F3F" stopOpacity={0.01} />
          </linearGradient>
          <linearGradient id="gradHR" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#D32F2F" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#D32F2F" stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "#94A3B8" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "#94A3B8" }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{
            borderRadius: "8px",
            border: "1px solid #E2E8F0",
            fontSize: "12px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
          }}
        />
        <Area
          type="monotone"
          dataKey="Total"
          stroke="#001F3F"
          strokeWidth={1.5}
          fill="url(#gradTotal)"
        />
        <Area
          type="monotone"
          dataKey="High Risk"
          stroke="#D32F2F"
          strokeWidth={1.5}
          fill="url(#gradHR)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
