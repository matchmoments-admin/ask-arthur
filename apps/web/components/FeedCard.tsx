"use client";

import Image from "next/image";
import {
  Fish,
  HeartCrack,
  TrendingUp,
  Monitor,
  Theater,
  ShoppingBag,
  Phone,
  Mail,
  MessageSquare,
  Briefcase,
  Banknote,
  Home,
  ShieldAlert,
  Info,
  AlertTriangle,
  MessageCircle,
  Flag,
  ShieldCheck,
  Shield,
  ArrowUp,
  BadgeCheck,
} from "lucide-react";
import {
  CATEGORY_CONFIG,
  SOURCE_CONFIG,
  COUNTRY_FLAGS,
  getImageUrl,
  getCategoryIllustration,
  relativeTime,
} from "@/lib/feed";
import type { FeedItem } from "@/lib/feed";
import Pill from "./Pill";

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Fish, HeartCrack, TrendingUp, Monitor, Theater, ShoppingBag,
  Phone, Mail, MessageSquare, Briefcase, Banknote, Home,
  ShieldAlert, Info, AlertTriangle, MessageCircle, Flag,
  ShieldCheck, Shield,
};

export default function FeedCard({ item }: { item: FeedItem }) {
  const categoryConfig = item.category ? CATEGORY_CONFIG[item.category] : null;
  const sourceConfig = SOURCE_CONFIG[item.source] || SOURCE_CONFIG.reddit;
  const imageUrl = getImageUrl(item);

  const SourceIcon = ICON_MAP[sourceConfig.icon] || MessageCircle;

  const timeStr = item.source_created_at
    ? relativeTime(item.source_created_at)
    : relativeTime(item.created_at);

  const countryFlag = item.country_code ? COUNTRY_FLAGS[item.country_code] : null;

  const isLinked = item.source_url?.startsWith("https://") ?? false;

  const card = (
    <article className={`bg-white border border-border-light rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all overflow-hidden${isLinked ? " cursor-pointer" : ""}`}>
      {/* Image or category tile */}
      {imageUrl ? (
        <div className="aspect-video bg-slate-100 overflow-hidden relative">
          <Image
            src={imageUrl}
            alt=""
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover"
            loading="lazy"
            unoptimized
          />
        </div>
      ) : (
        <div className="aspect-video bg-[#EFF4F8] overflow-hidden relative" aria-hidden="true">
          <Image
            src={getCategoryIllustration(item.category)}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, 50vw"
            className="object-cover"
          />
        </div>
      )}

      {/* Content */}
      <div className="p-4">
        {/* Metadata row */}
        <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
          <SourceIcon size={12} />
          <span>{sourceConfig.label}</span>
          <span>&middot;</span>
          <span>{timeStr}</span>
          {countryFlag && (
            <>
              <span>&middot;</span>
              <span>{countryFlag}</span>
            </>
          )}
          {item.upvotes > 0 && (
            <>
              <span>&middot;</span>
              <ArrowUp size={12} />
              <span>{item.upvotes}</span>
            </>
          )}
          {item.verified && (
            <BadgeCheck size={14} className="text-action-teal ml-auto" />
          )}
        </div>

        {/* Title */}
        <h3 className="font-semibold text-deep-navy line-clamp-2 text-sm leading-snug mb-1">
          {item.title}
        </h3>

        {/* Description */}
        {item.description && (
          <p className="text-xs text-gov-slate line-clamp-3 mb-3">
            {item.description}
          </p>
        )}

        {/* Bottom row: badges */}
        <div className="flex items-center gap-2 flex-wrap">
          {categoryConfig && (
            <Pill label={categoryConfig.label} color={categoryConfig.color} />
          )}
          {item.impersonated_brand && (
            <Pill label={item.impersonated_brand} />
          )}
        </div>
      </div>
    </article>
  );

  if (isLinked) {
    return (
      <a href={item.source_url!} target="_blank" rel="noopener noreferrer" className="block">
        {card}
      </a>
    );
  }

  return card;
}
