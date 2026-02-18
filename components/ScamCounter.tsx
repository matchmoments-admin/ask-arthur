"use client";

import { useEffect, useState, useCallback } from "react";

export default function ScamCounter() {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState(false);

  const fetchCount = useCallback(() => {
    fetch("/api/stats")
      .then((res) => res.json())
      .then((data) => {
        setCount(data.totalChecks);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    fetchCount();

    // Refresh counter after each analysis completes
    const handleCheckComplete = () => fetchCount();
    window.addEventListener("safeverify:check-complete", handleCheckComplete);
    return () =>
      window.removeEventListener("safeverify:check-complete", handleCheckComplete);
  }, [fetchCount]);

  if (count === null && !error) return null;

  return (
    <p className="text-center mt-6">
      <span className="text-deep-navy font-bold text-lg">
        {count !== null ? count.toLocaleString() : "—"}
      </span>{" "}
      <span className="text-gov-slate text-xs font-bold uppercase tracking-widest">
        Verified Checks
      </span>
    </p>
  );
}
