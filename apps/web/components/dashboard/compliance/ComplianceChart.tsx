"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { ComplianceDataPoint } from "@/lib/dashboard/compliance";

export default function ComplianceChart({
  data,
}: {
  data: ComplianceDataPoint[];
}) {
  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-xs text-slate-400">
        No compliance activity data yet
      </div>
    );
  }

  const chartData = data.map((d) => ({
    date: new Date(d.date).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
    }),
    "Threats Detected": d.threats_detected,
    "API Calls": d.api_calls,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart
        data={chartData}
        margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
      >
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
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
        />
        <Line
          type="monotone"
          dataKey="Threats Detected"
          stroke="#0D9488"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: "#0D9488" }}
        />
        <Line
          type="monotone"
          dataKey="API Calls"
          stroke="#1B2A4A"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: "#1B2A4A" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
