// Font scope for /hub. Same pattern as app/investors/layout.tsx: the deck is a
// deliberately off-brand dark surface, so its three typefaces are loaded here
// as CSS variables and consumed only by hub.module.css. Nothing leaks into the
// global Public Sans shell.
//
// JetBrains Mono is already used by /investors — no new font dependency beyond
// Archivo and Instrument Sans.

import localFont from "next/font/local";

const archivo = localFont({
  src: [
    { path: "../fonts/archivo-latin-400-900-normal.woff2", weight: "400 900", style: "normal" },
  ],
  display: "swap",
  variable: "--font-archivo",
});

const instrumentSans = localFont({
  src: [
    { path: "../fonts/instrument-sans-latin-400-600-normal.woff2", weight: "400 600", style: "normal" },
  ],
  display: "swap",
  variable: "--font-instrument-sans",
});

const jetbrainsMono = localFont({
  src: [
    { path: "../fonts/jetbrains-mono-latin-400-700-normal.woff2", weight: "400 700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export default function HubLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${archivo.variable} ${instrumentSans.variable} ${jetbrainsMono.variable}`}
    >
      {children}
    </div>
  );
}
