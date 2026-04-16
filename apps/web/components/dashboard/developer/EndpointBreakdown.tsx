"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { EndpointStat } from "@/lib/dashboard/developer";

interface Props {
  data: EndpointStat[];
}

const BAR_COLORS = ["#0D9488", "#0F766E", "#14B8A6", "#2DD4BF", "#5EEAD4"];

export default function EndpointBreakdown({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-xs text-slate-400">
        No endpoint data available
      </div>
    );
  }

  const chartData = data.map((ep) => ({
    endpoint: ep.endpoint,
    calls: ep.total_calls,
    latency: ep.avg_latency_ms,
    errors: ep.error_count,
  }));

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 4, left: 8, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 10, fill: "#94A3B8" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="endpoint"
            tick={{ fontSize: 11, fill: "#4A5568" }}
            tickLine={false}
            axisLine={false}
            width={110}
          />
          <Tooltip
            contentStyle={{
              borderRadius: "8px",
              border: "1px solid #E2E8F0",
              fontSize: "12px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
            }}
            formatter={(value, name) => {
              if (name === "calls") return [Number(value).toLocaleString("en-AU"), "Calls"];
              return [String(value), String(name)];
            }}
          />
          <Bar dataKey="calls" radius={[0, 4, 4, 0]} barSize={20}>
            {chartData.map((_, index) => (
              <Cell key={index} fill={BAR_COLORS[index % BAR_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Stats table below the chart */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border-light">
              <th className="text-left py-2 px-2 font-medium uppercase tracking-wider text-slate-500">
                Endpoint
              </th>
              <th className="text-right py-2 px-2 font-medium uppercase tracking-wider text-slate-500">
                Calls
              </th>
              <th className="text-right py-2 px-2 font-medium uppercase tracking-wider text-slate-500">
                Avg Latency
              </th>
              <th className="text-right py-2 px-2 font-medium uppercase tracking-wider text-slate-500">
                Errors
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((ep) => (
              <tr
                key={ep.endpoint}
                className="border-b border-border-light/50 hover:bg-slate-50/50"
              >
                <td className="py-2 px-2 font-mono text-deep-navy">{ep.endpoint}</td>
                <td className="py-2 px-2 text-right text-slate-600" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {ep.total_calls.toLocaleString("en-AU")}
                </td>
                <td className="py-2 px-2 text-right text-slate-600" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {ep.avg_latency_ms}ms
                </td>
                <td className="py-2 px-2 text-right">
                  <span
                    className={
                      ep.error_count > 0
                        ? "text-red-600 font-medium"
                        : "text-slate-400"
                    }
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {ep.error_count}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
