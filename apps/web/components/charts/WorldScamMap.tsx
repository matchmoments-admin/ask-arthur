"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import worldMap from "@svg-maps/world";
import { CHOROPLETH_SCALE } from "@/lib/chart-tokens";

interface SvgMapLocation {
  id: string;
  name: string;
  path: string;
}

interface Props {
  /** country_code (ISO alpha-2 uppercase) → scam count */
  countryData: Record<string, number>;
}

function getScaleIndex(count: number, max: number): number {
  if (count === 0 || max === 0) return 0;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

export default function WorldScamMap({ countryData }: Props) {
  const router = useRouter();
  const [hovered, setHovered] = useState<{ id: string; name: string } | null>(null);

  const maxCount = Math.max(...Object.values(countryData), 0);

  function handleClick(locationId: string) {
    const code = locationId.toUpperCase();
    const hasData = (countryData[code] ?? 0) > 0;

    if (hasData) {
      router.push(`/scam-feed?country=${code}`);
    } else {
      router.push(`/scam-feed?country=${code}&empty=1`);
    }
  }

  return (
    <div>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={worldMap.viewBox}
        className="w-full h-auto"
        role="img"
        aria-label="World map showing scam report distribution by country"
      >
        {(worldMap.locations as SvgMapLocation[]).map((location) => {
          const code = location.id.toUpperCase();
          const count = countryData[code] ?? 0;
          const fill = CHOROPLETH_SCALE[getScaleIndex(count, maxCount)];
          const isHovered = hovered?.id === location.id;

          return (
            <path
              key={location.id}
              d={location.path}
              fill={isHovered ? "#FFB300" : fill}
              stroke="#fff"
              strokeWidth={0.3}
              tabIndex={0}
              role="button"
              aria-label={`Filter scam feed by ${location.name}${count > 0 ? `: ${count.toLocaleString()} reports` : ": no reports yet"}`}
              onMouseEnter={() => setHovered({ id: location.id, name: location.name })}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered({ id: location.id, name: location.name })}
              onBlur={() => setHovered(null)}
              onClick={() => handleClick(location.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleClick(location.id);
                }
              }}
              style={{ transition: "fill 0.15s ease", cursor: "pointer" }}
              className="focus:outline-none focus-visible:[outline:2px_solid_#008A98] focus-visible:[outline-offset:1px]"
            >
              <title>
                {location.name}: {count > 0 ? `${count.toLocaleString()} reports` : "No reports yet"}
              </title>
            </path>
          );
        })}
      </svg>

      {/* Hover info */}
      <div className="h-8 mt-2 text-center">
        {hovered ? (
          <p className="text-sm text-deep-navy font-medium">
            <span className="font-extrabold">{hovered.name}</span>
            {" — "}
            {(countryData[hovered.id.toUpperCase()] ?? 0) > 0
              ? `${(countryData[hovered.id.toUpperCase()] ?? 0).toLocaleString()} reports`
              : "No reports yet"}
            <span className="text-xs text-action-teal ml-2">Click to view</span>
          </p>
        ) : (
          <p className="text-xs text-gov-slate">
            Hover a country to see details — click to view the scam feed
          </p>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-2 mt-2">
        <span className="text-xs text-gov-slate">Fewer</span>
        <div className="flex h-3 rounded overflow-hidden">
          {CHOROPLETH_SCALE.map((color, i) => (
            <div key={i} className="w-6 h-3" style={{ backgroundColor: color }} />
          ))}
        </div>
        <span className="text-xs text-gov-slate">More</span>
      </div>
    </div>
  );
}
