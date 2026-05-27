"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import TopBar from "./TopBar";
import SideTray from "./SideTray";
import { findActiveNavItem } from "@/lib/admin/nav";

const COLLAPSED_STORAGE_KEY = "aa_admin_nav_collapsed";

interface AdminShellProps {
  children: React.ReactNode;
}

/**
 * Owns the admin chrome state (mobile drawer open + desktop rail
 * collapsed). Renders the new TopBar (mobile only) and SideTray (rail on
 * desktop, drawer on mobile) around the page children.
 *
 * The desktop collapsed state persists in localStorage so the choice
 * survives reload — `aa_admin_nav_collapsed`.
 */
export default function AdminShell({ children }: AdminShellProps) {
  const pathname = usePathname();
  const [trayOpen, setTrayOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Hydrate collapsed state from localStorage on mount
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (stored === "1") setCollapsed(true);
    } catch {
      // localStorage unavailable — fall back to expanded default
    }
  }, []);

  const onToggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  };

  const activeItem = findActiveNavItem(pathname);
  const pageTitle = activeItem?.name ?? "Admin";

  return (
    <div
      className="font-geist min-h-screen flex"
      style={{ background: "var(--color-admin-bg)" }}
    >
      <SideTray
        open={trayOpen}
        onClose={() => setTrayOpen(false)}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar title={pageTitle} onMenu={() => setTrayOpen(true)} />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
