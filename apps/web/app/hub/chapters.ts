// Chapter shapes for the /hub deck.
//
// `lede` and `colophon` are ReactNode rather than HTML strings so the deck can
// render them without dangerouslySetInnerHTML. React elements cross the RSC
// boundary fine, so page.tsx (server) builds them and Deck.tsx (client)
// renders them.
//
// Every href here is absolute and gets UTM-tagged at render time via
// lib/utm.ts — see linkHref() in page.tsx.

import type { ReactNode } from "react";

export type ChapterKind = "hero" | "cards" | "rows" | "panel" | "links";

interface ChapterBase {
  /** URL hash fragment — /hub#clone-watch deep-links to this chapter. */
  id: string;
  /** Short name shown in the progress chrome. */
  nav: string;
  kind: ChapterKind;
  eyebrow: string;
  title: string;
  lede?: ReactNode;
  kicker?: string;
  cta?: Cta;
}

export interface Cta {
  label: string;
  href: string;
}

export interface HeroChapter extends ChapterBase {
  kind: "hero";
  /** Lines rendered small under the CTA. */
  meta: string[];
}

export interface CardItem {
  title: string;
  meta: string;
  href: string;
}

export interface CardsChapter extends ChapterBase {
  kind: "cards";
  items: CardItem[];
}

export interface RowItem {
  title: string;
  meta: string;
  href: string;
}

export interface RowsChapter extends ChapterBase {
  kind: "rows";
  items: RowItem[];
}

export interface Stat {
  n: string;
  k: string;
  accent?: boolean;
}

export interface PanelChapter extends ChapterBase {
  kind: "panel";
  /**
   * Null when the source RPC failed. The deck then renders the chapter with no
   * stat block at all — never with zeros. See the fallback note in page.tsx.
   */
  stats: Stat[] | null;
  /** e.g. "Last 30 days · aggregate only". Rendered with the stats, not as a footnote. */
  statsWindow?: string;
  note: string;
  featured: {
    kicker: string;
    title: string;
    meta: string;
    href: string;
  } | null;
}

export interface LinkItem {
  name: string;
  desc: string;
  href: string;
}

export interface LinksChapter extends ChapterBase {
  kind: "links";
  items: LinkItem[];
  colophon: ReactNode;
}

export type Chapter =
  | HeroChapter
  | CardsChapter
  | RowsChapter
  | PanelChapter
  | LinksChapter;
