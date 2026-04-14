import { Shield, Search, ScanLine, Store, MoreHorizontal } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavTab = "protect" | "check" | "scan" | "market" | "more";

interface BottomNavProps {
  active: NavTab;
  onChange: (tab: NavTab) => void;
}

interface TabDef {
  id: NavTab;
  label: string;
  icon: LucideIcon;
}

const TABS: TabDef[] = [
  { id: "protect", label: "Protect", icon: Shield },
  { id: "check", label: "Check", icon: Search },
  { id: "scan", label: "Scan", icon: ScanLine },
  { id: "market", label: "Market", icon: Store },
  { id: "more", label: "More", icon: MoreHorizontal },
];

export function BottomNav({ active, onChange }: BottomNavProps) {
  return (
    <nav className="shrink-0 border-t border-border bg-background">
      <div className="flex h-[52px]">
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[44px] transition-colors duration-150 relative ${
                isActive ? "text-accent" : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-b-full bg-accent" />
              )}
              <tab.icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="text-[10px] font-medium leading-none">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
