"use client";

import { useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import TopBar from "./TopBar";
import SideTray from "./SideTray";
import { findActiveNavItem } from "@/lib/admin/nav";

const COLLAPSED_STORAGE_KEY = "aa_admin_nav_collapsed";
const COLLAPSED_EVENT = "aa-admin-nav-collapsed";

// External store wrapper for the collapsed flag. Using
// useSyncExternalStore keeps the localStorage hydration out of an
// effect — the React 19 ESLint rule `react-hooks/set-state-in-effect`
// blocks the simpler `setState in useEffect` pattern. Cross-tab
// changes piggyback on the native `storage` event; same-tab changes
// fire a custom `aa-admin-nav-collapsed` event because `storage`
// doesn't notify the origin tab.

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  window.addEventListener(COLLAPSED_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(COLLAPSED_EVENT, callback);
  };
}

function getSnapshot(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function getServerSnapshot(): boolean {
  return false;
}

function writeCollapsed(next: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? "1" : "0");
  } catch {
    // localStorage unavailable — UI state still flips via the event
  }
  window.dispatchEvent(new Event(COLLAPSED_EVENT));
}

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
  const collapsed = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const onToggleCollapsed = () => {
    writeCollapsed(!collapsed);
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
