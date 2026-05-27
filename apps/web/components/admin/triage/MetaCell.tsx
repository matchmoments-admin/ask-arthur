interface MetaCellProps {
  label: string;
  value: string;
  mono?: boolean;
}

export default function MetaCell({ label, value, mono }: MetaCellProps) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span
        className="uppercase"
        style={{
          fontSize: 9.5,
          letterSpacing: "0.08em",
          color: "var(--color-muted-2)",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <span
        className={`truncate ${mono ? "mono" : ""}`}
        style={{
          fontSize: 12.5,
          color: "var(--color-ink-2)",
          fontWeight: 500,
        }}
      >
        {value}
      </span>
    </div>
  );
}
