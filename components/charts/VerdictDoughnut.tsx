"use client";

import { PieChart } from "react-minimal-pie-chart";
import { VERDICT_COLORS } from "@/lib/chart-tokens";

interface Props {
  safeCount: number;
  suspiciousCount: number;
  highRiskCount: number;
}

export default function VerdictDoughnut({
  safeCount,
  suspiciousCount,
  highRiskCount,
}: Props) {
  const total = safeCount + suspiciousCount + highRiskCount;

  if (total === 0) {
    return (
      <p className="text-gov-slate text-sm text-center py-8">No data yet.</p>
    );
  }

  const data = [
    { title: "Safe", value: safeCount, color: VERDICT_COLORS.safe },
    {
      title: "Suspicious",
      value: suspiciousCount,
      color: VERDICT_COLORS.suspicious,
    },
    { title: "High Risk", value: highRiskCount, color: VERDICT_COLORS.danger },
  ].filter((d) => d.value > 0);

  return (
    <div className="max-w-[240px] mx-auto">
      <PieChart
        data={data}
        lineWidth={35}
        paddingAngle={2}
        startAngle={-90}
        animate
        label={({ dataEntry }) =>
          dataEntry.percentage >= 5
            ? `${Math.round(dataEntry.percentage)}%`
            : ""
        }
        labelStyle={{
          fontSize: "8px",
          fontWeight: 600,
          fill: "#fff",
        }}
        labelPosition={82}
      />

      {/* Legend */}
      <div className="flex justify-center gap-4 mt-4 flex-wrap">
        {data.map((d) => (
          <div key={d.title} className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded-full"
              style={{ backgroundColor: d.color }}
            />
            <span className="text-gov-slate text-xs">{d.title}</span>
          </div>
        ))}
      </div>

      {/* Accessible data table */}
      <details className="mt-4">
        <summary className="text-xs text-gov-slate cursor-pointer hover:underline">
          View data table
        </summary>
        <table className="w-full text-xs text-gov-slate mt-2 border-collapse">
          <thead>
            <tr>
              <th className="text-left pb-1 border-b border-gray-200">
                Verdict
              </th>
              <th className="text-right pb-1 border-b border-gray-200">
                Count
              </th>
              <th className="text-right pb-1 border-b border-gray-200">%</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.title}>
                <td className="py-1">{d.title}</td>
                <td className="text-right py-1">
                  {d.value.toLocaleString()}
                </td>
                <td className="text-right py-1">
                  {Math.round((d.value / total) * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
