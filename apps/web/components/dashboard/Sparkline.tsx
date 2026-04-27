interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  smooth?: boolean;
}

export default function Sparkline({
  data,
  width = 90,
  height = 24,
  stroke = "currentColor",
  strokeWidth = 1.4,
  fill = "none",
  smooth = true,
}: SparklineProps) {
  if (!data || data.length === 0) {
    return <span style={{ display: "inline-block", width, height }} />;
  }

  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  const points = data.map((v, i) => [
    i * stepX,
    height - ((v - min) / span) * (height - 2) - 1,
  ] as [number, number]);

  let d = "";
  if (smooth && points.length > 1) {
    d = `M ${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      const cx = (x0 + x1) / 2;
      d += ` Q ${cx} ${y0} ${cx} ${(y0 + y1) / 2} T ${x1} ${y1}`;
    }
  } else {
    d = points
      .map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`))
      .join(" ");
  }

  const fillPath =
    fill !== "none" ? d + ` L ${width} ${height} L 0 ${height} Z` : null;

  return (
    <svg
      width={width}
      height={height}
      style={{ display: "block", overflow: "visible" }}
      aria-hidden
    >
      {fillPath && <path d={fillPath} fill={fill} stroke="none" />}
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
