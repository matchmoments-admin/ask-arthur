interface DataPoint {
  date: string;
  total: number;
  high_risk: number;
}

interface SafeTrendProps {
  data: DataPoint[];
  primary?: string;
  accent?: string;
  height?: number;
}

export default function SafeTrend({
  data,
  primary = "#0a1628",
  accent = "#3B82F6",
  height = 240,
}: SafeTrendProps) {
  if (!data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-[12px] text-slate-400"
        style={{ height }}
      >
        No check data yet
      </div>
    );
  }

  const W = 760;
  const H = height;
  const pad = { l: 40, r: 16, t: 16, b: 28 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const max = Math.max(...data.map((d) => d.total), 1);
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;
  const yScale = (v: number) => pad.t + innerH - (v / max) * innerH;

  const linePath = (key: "total" | "high_risk") => {
    let d = "";
    data.forEach((row, i) => {
      const x = pad.l + i * stepX;
      const y = yScale(row[key]);
      if (i === 0) {
        d = `M ${x} ${y}`;
      } else {
        const prev = data[i - 1];
        const px = pad.l + (i - 1) * stepX;
        const py = yScale(prev[key]);
        const cx = (px + x) / 2;
        d += ` Q ${cx} ${py} ${cx} ${(py + y) / 2} T ${x} ${y}`;
      }
    });
    return d;
  };

  const areaPath = (key: "total" | "high_risk") =>
    linePath(key) +
    ` L ${pad.l + (data.length - 1) * stepX} ${pad.t + innerH} L ${pad.l} ${pad.t + innerH} Z`;

  const xTicks = (data.length >= 5
    ? [
        0,
        Math.round(data.length / 4),
        Math.round(data.length / 2),
        Math.round((3 * data.length) / 4),
        data.length - 1,
      ]
    : data.map((_, i) => i)
  ).map((i) => {
    const d = new Date(data[i].date);
    return {
      x: pad.l + i * stepX,
      label: d.toLocaleDateString("en-AU", { day: "numeric", month: "short" }),
    };
  });

  const yTicks = [0, max / 4, max / 2, (max / 4) * 3, max].map((v) => ({
    y: yScale(v),
    label: Math.round(v).toString(),
  }));

  const last = data[data.length - 1];
  const lastX = pad.l + (data.length - 1) * stepX;

  return (
    <svg
      width="100%"
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ display: "block" }}
      aria-hidden
    >
      <defs>
        <linearGradient id="safe-trend-area-total" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={primary} stopOpacity="0.18" />
          <stop offset="100%" stopColor={primary} stopOpacity="0" />
        </linearGradient>
      </defs>

      {yTicks.map((t, i) => (
        <g key={`y-${i}`}>
          <line
            x1={pad.l}
            x2={W - pad.r}
            y1={t.y}
            y2={t.y}
            stroke="#eef0f3"
            strokeDasharray={i === yTicks.length - 1 ? "" : "3 3"}
          />
          <text
            x={pad.l - 8}
            y={t.y + 3}
            fontSize="10"
            fill="#94a3b8"
            textAnchor="end"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            {t.label}
          </text>
        </g>
      ))}

      {xTicks.map((t, i) => (
        <text
          key={`x-${i}`}
          x={t.x}
          y={H - 8}
          fontSize="10"
          fill="#94a3b8"
          textAnchor="middle"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        >
          {t.label}
        </text>
      ))}

      <path d={areaPath("total")} fill="url(#safe-trend-area-total)" />
      <path
        d={linePath("total")}
        fill="none"
        stroke={primary}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={linePath("high_risk")}
        fill="none"
        stroke={accent}
        strokeWidth="1.6"
        strokeDasharray="3 3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <circle
        cx={lastX}
        cy={yScale(last.total)}
        r="3.5"
        fill={primary}
        stroke="#fff"
        strokeWidth="2"
      />
      <circle
        cx={lastX}
        cy={yScale(last.high_risk)}
        r="3"
        fill={accent}
        stroke="#fff"
        strokeWidth="2"
      />
    </svg>
  );
}
