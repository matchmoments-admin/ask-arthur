import { requireAuth } from "@/lib/auth";
import { Bell, Webhook, Shield } from "lucide-react";

export default async function SettingsPage() {
  await requireAuth();

  return (
    <div className="p-6 max-w-[1200px]">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-deep-navy">Settings</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Webhook configuration, notifications, and preferences.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 max-w-3xl">
        {[
          { icon: Webhook, title: "Webhooks", desc: "Configure real-time threat alerts to your endpoint", status: "Coming soon" },
          { icon: Bell, title: "Notifications", desc: "Email alerts for high-risk entity detections", status: "Coming soon" },
          { icon: Shield, title: "Security", desc: "API key rotation, IP allowlisting", status: "Coming soon" },
        ].map((item) => (
          <div key={item.title} className="rounded-lg border border-slate-200/60 bg-white p-5">
            <item.icon size={20} className="text-slate-300 mb-3" />
            <h3 className="text-sm font-medium text-deep-navy">{item.title}</h3>
            <p className="text-xs text-slate-400 mt-1">{item.desc}</p>
            <span className="inline-block mt-3 text-[10px] font-medium uppercase tracking-wider text-slate-400 bg-slate-50 px-2 py-1 rounded">
              {item.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
