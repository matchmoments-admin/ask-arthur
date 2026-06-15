"use client";

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";

export interface Slice {
  name: string;
  value: number;
}

// Teal-led palette consistent with the email + brand chrome; "Unknown" greys.
const COLORS = [
  "#0F766E",
  "#1B2A4A",
  "#2563EB",
  "#D97706",
  "#DC2626",
  "#7C3AED",
  "#0891B2",
];
const UNKNOWN_COLOR = "#CBD5E1";

/** Interactive donut for a single dimension (e.g. hosting country). */
export default function ShareCharts({ data }: { data: Slice[] }) {
  if (data.length === 0) return null;
  return (
    <div style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
          >
            {data.map((d, i) => (
              <Cell
                key={d.name}
                fill={d.name === "Unknown" ? UNKNOWN_COLOR : COLORS[i % COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
