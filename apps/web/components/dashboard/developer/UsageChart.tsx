"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { UsageDataPoint } from "@/lib/dashboard/developer";

interface Props {
  data: UsageDataPoint[];
}

export default function UsageChart({ data }: Props) {
  // Aggregate all endpoints by date for the total line
  const byDate = new Map<string, number>();
  for (const point of data) {
    byDate.set(point.date, (byDate.get(point.date) || 0) + point.total_calls);
  }

  const chartData = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({
      date: new Date(date).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
      }),
      "API Calls": total,
    }));

  if (chartData.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-xs text-slate-400">
        No usage data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
        <defs>
          <linearGradient id="usageGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#0D9488" stopOpacity={0.1} />
            <stop offset="95%" stopColor="#0D9488" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "#94A3B8" }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
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
        <Line
          type="monotone"
          dataKey="API Calls"
          stroke="#0D9488"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: "#0D9488" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
