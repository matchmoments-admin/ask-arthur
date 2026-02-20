"use client";

import dynamic from "next/dynamic";
import { DoughnutSkeleton, MapSkeleton } from "./ChartSkeletons";

const VerdictDoughnut = dynamic(() => import("./VerdictDoughnut"), {
  ssr: false,
  loading: () => <DoughnutSkeleton />,
});

const AustraliaMap = dynamic(() => import("./AustraliaMap"), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

interface Props {
  safeCount: number;
  suspiciousCount: number;
  highRiskCount: number;
  stateData: Record<string, number>;
}

export default function ChartsSection({
  safeCount,
  suspiciousCount,
  highRiskCount,
  stateData,
}: Props) {
  return (
    <div className="grid gap-10 sm:grid-cols-2">
      <div>
        <h3 className="text-deep-navy font-semibold text-sm mb-4 text-center">
          Verdict Breakdown
        </h3>
        <VerdictDoughnut
          safeCount={safeCount}
          suspiciousCount={suspiciousCount}
          highRiskCount={highRiskCount}
        />
      </div>
      <div>
        <h3 className="text-deep-navy font-semibold text-sm mb-4 text-center">
          Checks by State
        </h3>
        <AustraliaMap stateData={stateData} />
      </div>
    </div>
  );
}
