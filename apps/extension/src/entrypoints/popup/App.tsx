import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { BottomNav, type NavTab } from "@/components/BottomNav";
import { ProtectTab } from "@/components/ProtectTab";
import { CheckTab } from "@/components/CheckTab";
import { ExtensionSecurityTab } from "@/components/ExtensionSecurityTab";
import { MarketTab } from "@/components/MarketTab";
import { MoreTab } from "@/components/MoreTab";

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>("protect");

  return (
    <div className="w-[380px] h-[540px] flex flex-col bg-background animate-slide-up">
      {/* Compact header */}
      <header className="bg-header-bg px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <img src="/icon/48.png" alt="" className="h-6 w-6" />
          <span className="text-[15px] font-semibold text-white">Ask Arthur</span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="https://askarthur.au"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/60 hover:text-white transition-colors duration-150 p-1"
          >
            <ExternalLink size={16} />
          </a>
        </div>
      </header>

      {/* Scrollable content */}
      <main className="flex-1 overflow-y-auto">
        {activeTab === "protect" && <ProtectTab />}
        {activeTab === "check" && <CheckTab />}
        {activeTab === "scan" && <ExtensionSecurityTab />}
        {activeTab === "market" && <MarketTab />}
        {activeTab === "more" && <MoreTab />}
      </main>

      {/* Bottom navigation */}
      <BottomNav active={activeTab} onChange={setActiveTab} />
    </div>
  );
}
