"use client";

import { useEffect, useState } from "react";

export default function ScamCounter() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((res) => res.json())
      .then((data) => setCount(data.totalChecks))
      .catch(() => {});
  }, []);

  if (count === null || count === 0) return null;

  return (
    <p className="text-center mt-6">
      <span className="text-deep-navy font-bold text-lg">{count.toLocaleString()}</span>{" "}
      <span className="text-gov-slate text-xs font-bold uppercase tracking-widest">Verified Checks</span>
    </p>
  );
}
