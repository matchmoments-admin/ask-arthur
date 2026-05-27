"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, ChevronLeft, ChevronRight, Settings } from "lucide-react";
import { ADMIN_NAV_SECTIONS, type AdminNavItem } from "@/lib/admin/nav";

interface SideTrayProps {
  /** Mobile drawer open/closed. */
  open: boolean;
  /** Close handler (mobile drawer). */
  onClose: () => void;
  /** Desktop rail collapsed (icon-only) vs expanded. */
  collapsed: boolean;
  /** Toggle desktop collapsed state. */
  onToggleCollapsed: () => void;
}

function BrandMark({ small }: { small?: boolean }) {
  return (
    <span
      aria-hidden
      className="grid place-items-center text-white shrink-0 serif"
      style={{
        width: small ? 28 : 30,
        height: small ? 28 : 30,
        borderRadius: 8,
        background: "linear-gradient(135deg,#0B1F3A,#1E8C86)",
        fontWeight: 700,
        fontSize: 14,
      }}
    >
      A
    </span>
  );
}

function NavList({
  pathname,
  collapsed,
  onNavigate,
}: {
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 overflow-y-auto px-2 pb-4 pt-2">
      {ADMIN_NAV_SECTIONS.map((section) => (
        <div key={section.label} className="mt-3 first:mt-0">
          {collapsed ? (
            <div className="px-2 py-1.5">
              <div className="h-px bg-[var(--color-line-soft)]" />
            </div>
          ) : (
            <div className="px-2.5 pb-1.5 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted-2)]">
              {section.label}
            </div>
          )}
          {section.items.map((item) => (
            <NavLink
              key={item.id}
              item={item}
              pathname={pathname}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

function NavLink({
  item,
  pathname,
  collapsed,
  onNavigate,
}: {
  item: AdminNavItem;
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const active =
    item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={collapsed ? item.name : undefined}
      className="flex items-center gap-2.5 rounded-[10px] transition-colors"
      style={{
        padding: collapsed ? "10px" : "10px 10px",
        justifyContent: collapsed ? "center" : "flex-start",
        background: active ? "var(--color-teal-soft)" : "transparent",
        color: active ? "var(--color-ink)" : "var(--color-ink-2)",
        fontWeight: active ? 600 : 500,
        fontSize: 14.5,
      }}
    >
      <span
        className="grid place-items-center shrink-0"
        style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          background: active ? "#fff" : "var(--color-surface-2)",
          border: `1px solid ${active ? "var(--color-line)" : "var(--color-line-soft)"}`,
          color: active ? "var(--color-teal)" : "var(--color-ink-2)",
        }}
      >
        <Icon size={15} strokeWidth={1.75} />
      </span>
      {!collapsed && <span className="flex-1 truncate">{item.name}</span>}
    </Link>
  );
}

function TrayFooter({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className="flex items-center gap-2.5"
      style={{
        padding: 12,
        borderTop: "1px solid var(--color-line-soft)",
        background: "var(--color-surface-2)",
        justifyContent: collapsed ? "center" : "flex-start",
      }}
    >
      <div
        className="grid place-items-center text-white font-semibold shrink-0"
        style={{
          width: 36,
          height: 36,
          borderRadius: 999,
          background: "linear-gradient(135deg,#0B1F3A,#1B3257)",
          fontSize: 13,
        }}
      >
        AA
      </div>
      {!collapsed && (
        <>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-[var(--color-ink)] truncate">
              Admin console
            </div>
            <div className="text-[11.5px] text-[var(--color-muted)]">
              Trust &amp; Safety · prod
            </div>
          </div>
          <button
            type="button"
            aria-label="Settings"
            className="grid place-items-center"
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              border: "1px solid var(--color-line)",
              background: "#fff",
              padding: 0,
            }}
          >
            <Settings size={15} strokeWidth={1.75} className="text-[var(--color-ink-2)]" />
          </button>
        </>
      )}
    </div>
  );
}

export default function SideTray({
  open,
  onClose,
  collapsed,
  onToggleCollapsed,
}: SideTrayProps) {
  const pathname = usePathname();

  // Body-scroll lock while mobile drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Close drawer on route change
  useEffect(() => {
    if (open) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const railWidth = collapsed ? 72 : 268;

  return (
    <>
      {/* Desktop permanent rail (>= lg) */}
      <aside
        className="hidden lg:flex flex-col min-h-screen shrink-0 sticky top-0 self-start"
        style={{
          width: railWidth,
          height: "100vh",
          background: "#fff",
          borderRight: "1px solid var(--color-line)",
          transition: "width 200ms ease",
        }}
      >
        <div
          className="flex items-center"
          style={{
            padding: collapsed ? "16px 12px" : "18px 14px",
            justifyContent: collapsed ? "center" : "space-between",
            borderBottom: "1px solid var(--color-line-soft)",
          }}
        >
          {collapsed ? (
            <BrandMark small />
          ) : (
            <Link href="/admin" className="flex items-center gap-2.5 min-w-0">
              <BrandMark />
              <span className="flex flex-col leading-tight min-w-0">
                <span className="serif text-[16px] text-[var(--color-ink)]">Ask Arthur</span>
                <span className="text-[11px] text-[var(--color-muted)] truncate">
                  Admin console · prod
                </span>
              </span>
            </Link>
          )}
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="grid place-items-center shrink-0"
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              border: "1px solid var(--color-line)",
              background: "#fff",
              marginLeft: collapsed ? 0 : 8,
              marginTop: collapsed ? 12 : 0,
              padding: 0,
            }}
          >
            {collapsed ? (
              <ChevronRight size={14} className="text-[var(--color-ink-2)]" />
            ) : (
              <ChevronLeft size={14} className="text-[var(--color-ink-2)]" />
            )}
          </button>
        </div>

        <NavList pathname={pathname} collapsed={collapsed} />
        <TrayFooter collapsed={collapsed} />
      </aside>

      {/* Mobile scrim */}
      <div
        onClick={onClose}
        aria-hidden
        className="lg:hidden fixed inset-0 z-40"
        style={{
          background: "rgba(11,31,58,0.45)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 200ms ease",
        }}
      />

      {/* Mobile slide-out drawer */}
      <aside
        className="lg:hidden fixed top-0 bottom-0 left-0 z-50 flex flex-col"
        style={{
          width: 308,
          maxWidth: "86%",
          background: "#fff",
          boxShadow: "0 20px 60px rgba(11,31,58,0.25)",
          transform: open ? "translateX(0)" : "translateX(-105%)",
          transition: "transform 260ms cubic-bezier(.2,.8,.2,1)",
        }}
      >
        <div
          className="flex items-center justify-between"
          style={{
            padding: "60px 18px 14px",
            borderBottom: "1px solid var(--color-line-soft)",
          }}
        >
          <Link href="/admin" className="flex items-center gap-2.5" onClick={onClose}>
            <BrandMark />
            <span className="flex flex-col leading-tight">
              <span className="serif text-[16px] text-[var(--color-ink)]">Ask Arthur</span>
              <span className="text-[11px] text-[var(--color-muted)]">
                Admin console · prod
              </span>
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="grid place-items-center"
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              border: "1px solid var(--color-line)",
              background: "#fff",
              padding: 0,
            }}
          >
            <X size={16} className="text-[var(--color-ink)]" />
          </button>
        </div>

        <NavList pathname={pathname} collapsed={false} onNavigate={onClose} />
        <TrayFooter collapsed={false} />
      </aside>
    </>
  );
}
