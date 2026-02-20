"use client";

import { useState } from "react";
import australiaMap from "@svg-maps/australia";
import { CHOROPLETH_SCALE, CODE_TO_PREFIX } from "@/lib/chart-tokens";

interface Props {
  stateData: Record<string, number>; // e.g. { NSW: 142, VIC: 98 }
}

// State code labels for display
const STATE_LABELS: Record<string, string> = {
  NSW: "New South Wales",
  VIC: "Victoria",
  QLD: "Queensland",
  SA: "South Australia",
  WA: "Western Australia",
  TAS: "Tasmania",
  NT: "Northern Territory",
  ACT: "Australian Capital Territory",
};

function getScaleIndex(count: number, max: number): number {
  if (count === 0) return 0;
  if (max === 0) return 0;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function getStateCodeForLocation(locationId: string): string | null {
  for (const [code, prefix] of Object.entries(CODE_TO_PREFIX)) {
    if (locationId === prefix || locationId.startsWith(prefix + "-")) {
      return code;
    }
  }
  return null;
}

export default function AustraliaMap({ stateData }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  const maxCount = Math.max(...Object.values(stateData), 0);
  const totalChecks = Object.values(stateData).reduce((a, b) => a + b, 0);

  if (totalChecks === 0) {
    return (
      <p className="text-gov-slate text-sm text-center py-8">No data yet.</p>
    );
  }

  return (
    <div>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={australiaMap.viewBox}
        className="w-full h-auto"
        role="img"
        aria-label="Map of Australia showing scam check distribution by state"
      >
        {australiaMap.locations.map((location) => {
          const stateCode = getStateCodeForLocation(location.id);
          const count = stateCode ? stateData[stateCode] ?? 0 : 0;
          const fill =
            CHOROPLETH_SCALE[getScaleIndex(count, maxCount)];

          return (
            <path
              key={location.id}
              d={location.path}
              fill={
                hovered && hovered === stateCode
                  ? "#FFB300"
                  : fill
              }
              stroke="#fff"
              strokeWidth={0.5}
              onMouseEnter={() =>
                stateCode && setHovered(stateCode)
              }
              onMouseLeave={() => setHovered(null)}
              style={{ transition: "fill 0.15s ease" }}
            >
              <title>
                {stateCode
                  ? `${STATE_LABELS[stateCode] ?? stateCode}: ${count.toLocaleString()} checks`
                  : location.name}
              </title>
            </path>
          );
        })}
      </svg>

      {/* Hover info */}
      <div className="h-6 mt-2 text-center">
        {hovered ? (
          <p className="text-sm text-deep-navy font-medium">
            {STATE_LABELS[hovered] ?? hovered}:{" "}
            {(stateData[hovered] ?? 0).toLocaleString()} checks
          </p>
        ) : (
          <p className="text-xs text-gov-slate">
            Hover over a state to see details
          </p>
        )}
      </div>

      {/* Gradient legend */}
      <div className="flex items-center justify-center gap-2 mt-2">
        <span className="text-xs text-gov-slate">Fewer</span>
        <div className="flex h-3 rounded overflow-hidden">
          {CHOROPLETH_SCALE.map((color, i) => (
            <div
              key={i}
              className="w-6 h-3"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        <span className="text-xs text-gov-slate">More</span>
      </div>
    </div>
  );
}
