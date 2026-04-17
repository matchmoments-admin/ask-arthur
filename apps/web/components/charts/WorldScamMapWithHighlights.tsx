import Link from "next/link";
import WorldScamMap from "./WorldScamMap";
import { COUNTRY_FLAGS, COUNTRY_NAMES } from "@/lib/feed";

interface Props {
  /** country_code (ISO alpha-2 uppercase) → scam count */
  countryData: Record<string, number>;
}

export default function WorldScamMapWithHighlights({ countryData }: Props) {
  const topCountries = Object.entries(countryData)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return (
    <div className="grid md:grid-cols-[1fr_200px] gap-8 items-start">
      <div className="min-w-0">
        <WorldScamMap countryData={countryData} />
      </div>

      {topCountries.length > 0 && (
        <aside aria-labelledby="top-countries-heading" className="w-full">
          <h3
            id="top-countries-heading"
            className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-4"
          >
            Top this month
          </h3>
          <ul className="space-y-2">
            {topCountries.map(([code, count]) => (
              <li key={code}>
                <Link
                  href={`/scam-feed?country=${code}`}
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span aria-hidden>{COUNTRY_FLAGS[code] ?? ""}</span>
                    <span className="text-sm font-medium text-deep-navy truncate">
                      {COUNTRY_NAMES[code] ?? code}
                    </span>
                  </span>
                  <span className="text-sm text-gov-slate tabular-nums shrink-0 ml-2">
                    {count.toLocaleString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-slate-400">
            Counts reflect the last 30 days.
          </p>
        </aside>
      )}
    </div>
  );
}
