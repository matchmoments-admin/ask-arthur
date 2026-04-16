"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { MonthlyTrendPoint } from "@/lib/dashboard/executive";

interface Props {
  data: MonthlyTrendPoint[];
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

export default function TrendChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-xs text-slate-400">
        No trend data available
      </div>
    );
  }

  const chartData = data.map((d) => ({
    month: d.month,
    "Threats Detected": d.threats_detected,
    "Losses Prevented": d.losses_prevented,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -4, bottom: 0 }}>
        <defs>
          <linearGradient id="gradThreats" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#0D9488" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#0D9488" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gradLosses" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#059669" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#059669" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 11, fill: "#4A5568" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          yAxisId="threats"
          tick={{ fontSize: 10, fill: "#94A3B8" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          yAxisId="losses"
          orientation="right"
          tick={{ fontSize: 10, fill: "#94A3B8" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatCurrency}
        />
        <Tooltip
          contentStyle={{
            borderRadius: "8px",
            border: "1px solid #E2E8F0",
            fontSize: "12px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
          }}
          formatter={(value, name) => {
            const v = Number(value);
            if (name === "Losses Prevented") return [formatCurrency(v), name];
            return [v.toLocaleString("en-AU"), name];
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: "11px" }}
          iconType="circle"
          iconSize={8}
        />
        <Area
          yAxisId="threats"
          type="monotone"
          dataKey="Threats Detected"
          stroke="#0D9488"
          strokeWidth={2}
          fill="url(#gradThreats)"
        />
        <Area
          yAxisId="losses"
          type="monotone"
          dataKey="Losses Prevented"
          stroke="#059669"
          strokeWidth={2}
          fill="url(#gradLosses)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
