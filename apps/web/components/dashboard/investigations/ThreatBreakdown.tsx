"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { ThreatBreakdownItem } from "@/lib/dashboard/investigations";

const ENTITY_LABELS: Record<string, string> = {
  url: "URL",
  phone: "Phone",
  email: "Email",
  domain: "Domain",
  ip: "IP",
};

const RISK_COLORS: Record<string, string> = {
  CRITICAL: "#B71C1C",
  HIGH: "#DC2626",
  MEDIUM: "#D97706",
  LOW: "#059669",
};

interface Props {
  data: ThreatBreakdownItem[];
}

export default function ThreatBreakdown({ data }: Props) {
  // Pivot data: group by entity_type, with risk levels as separate fields
  const pivotMap = new Map<
    string,
    { entity_type: string; CRITICAL: number; HIGH: number; MEDIUM: number; LOW: number }
  >();

  for (const item of data) {
    const existing = pivotMap.get(item.entity_type) || {
      entity_type: ENTITY_LABELS[item.entity_type] || item.entity_type,
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
    };
    if (item.risk_level in existing) {
      (existing as unknown as Record<string, number>)[item.risk_level] = item.count;
    }
    pivotMap.set(item.entity_type, existing);
  }

  const chartData = Array.from(pivotMap.values());

  if (chartData.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-xs text-slate-400">
        No threat data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
        <XAxis
          dataKey="entity_type"
          tick={{ fontSize: 11, fill: "#4A5568" }}
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
          wrapperStyle={{ fontSize: "11px" }}
          iconType="circle"
          iconSize={8}
        />
        <Bar dataKey="CRITICAL" stackId="a" fill={RISK_COLORS.CRITICAL} radius={[0, 0, 0, 0]} />
        <Bar dataKey="HIGH" stackId="a" fill={RISK_COLORS.HIGH} radius={[0, 0, 0, 0]} />
        <Bar dataKey="MEDIUM" stackId="a" fill={RISK_COLORS.MEDIUM} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
