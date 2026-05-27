interface MethodChipProps {
  /** The signal type (levenshtein / substring / etc). */
  method: string;
}

export default function MethodChip({ method }: MethodChipProps) {
  return (
    <span
      className="inline-block uppercase"
      style={{
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: 10.5,
        letterSpacing: "0.06em",
        fontWeight: 600,
        color: "#1B3257",
        background: "#EEF2F8",
        border: "1px solid #DDE2EA",
      }}
    >
      {method}
    </span>
  );
}
