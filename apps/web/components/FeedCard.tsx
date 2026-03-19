"use client";

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
  ExternalLink,
  ArrowUp,
  BadgeCheck,
} from "lucide-react";
import {
  CATEGORY_CONFIG,
  SOURCE_CONFIG,
  COUNTRY_FLAGS,
  getImageUrl,
  relativeTime,
} from "@/lib/feed";
import type { FeedItem } from "@/lib/feed";

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

  const CategoryIcon = categoryConfig
    ? ICON_MAP[categoryConfig.icon] || AlertTriangle
    : AlertTriangle;

  const SourceIcon = ICON_MAP[sourceConfig.icon] || MessageCircle;

  const timeStr = item.source_created_at
    ? relativeTime(item.source_created_at)
    : relativeTime(item.created_at);

  const countryFlag = item.country_code ? COUNTRY_FLAGS[item.country_code] : null;

  return (
    <article className="bg-white border border-border-light rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all overflow-hidden">
      {/* Image or category tile */}
      {imageUrl ? (
        <div className="aspect-video bg-slate-100 overflow-hidden">
          <img
            src={imageUrl}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
      ) : (
        <div
          className="aspect-video flex items-center justify-center"
          style={{ backgroundColor: `${categoryConfig?.color || "#9CA3AF"}15` }}
        >
          <CategoryIcon
            size={48}
            className="opacity-30"
            style={{ color: categoryConfig?.color || "#9CA3AF" }}
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

        {/* Bottom row: badges + link */}
        <div className="flex items-center gap-2 flex-wrap">
          {categoryConfig && (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{
                backgroundColor: `${categoryConfig.color}15`,
                color: categoryConfig.color,
              }}
            >
              {categoryConfig.label}
            </span>
          )}
          {item.impersonated_brand && (
            <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-600">
              {item.impersonated_brand}
            </span>
          )}
          {item.source_url && (
            <a
              href={item.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-xs text-action-teal-text hover:underline flex items-center gap-1"
            >
              View <ExternalLink size={10} />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
