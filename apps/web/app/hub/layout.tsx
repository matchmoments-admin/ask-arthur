// Font scope for /hub. Same pattern as app/investors/layout.tsx: the deck is a
// deliberately off-brand dark surface, so its three typefaces are loaded here
// as CSS variables and consumed only by hub.module.css. Nothing leaks into the
// global Public Sans shell.
//
// JetBrains Mono is already used by /investors — no new font dependency beyond
// Archivo and Instrument Sans.

import { Archivo, Instrument_Sans, JetBrains_Mono } from "next/font/google";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-archivo",
});

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-instrument-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
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
