"use client";

import { useState } from "react";
import { UserPlus, Mail, Clock } from "lucide-react";
import type { OrgMemberInfo } from "@/lib/org";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  compliance_officer: "Compliance Officer",
  fraud_analyst: "Fraud Analyst",
  developer: "Developer",
  viewer: "Viewer",
};

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-deep-navy text-white",
  admin: "bg-trust-teal text-white",
  compliance_officer: "bg-blue-100 text-blue-800",
  fraud_analyst: "bg-amber-100 text-amber-800",
  developer: "bg-purple-100 text-purple-800",
  viewer: "bg-slate-100 text-slate-600",
};

interface Invitation {
  id: number;
  email: string;
  role: string;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
}

interface TeamManagementProps {
  members: OrgMemberInfo[];
  invitations: Invitation[];
  canManage: boolean;
  currentUserId: string;
  orgName: string;
}

export default function TeamManagement({
  members,
  invitations,
  canManage,
  currentUserId,
  orgName: _orgName,
}: TeamManagementProps) {
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [inviting, setInviting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteMessage(null);

    try {
      const res = await fetch("/api/org/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });

      const data = await res.json();

      if (!res.ok) {
        setInviteMessage({ type: "error", text: data.error ?? "Failed to send invitation" });
        return;
      }

      setInviteMessage({ type: "success", text: data.message });
      setInviteEmail("");
      setShowInvite(false);
    } catch {
      setInviteMessage({ type: "error", text: "Something went wrong" });
    } finally {
      setInviting(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Members */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-deep-navy">
            Members ({members.length})
          </h2>
          {canManage && (
            <button
              onClick={() => setShowInvite(!showInvite)}
              className="flex items-center gap-2 bg-trust-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-trust-teal/90 transition-colors"
            >
              <UserPlus size={16} />
              Invite Member
            </button>
          )}
        </div>

        {/* Invite form */}
        {showInvite && (
          <form
            onSubmit={handleInvite}
            className="bg-slate-50 border border-border-light rounded-xl p-4 mb-4 flex flex-col sm:flex-row gap-3"
          >
            <input
              type="email"
              placeholder="Email address"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              className="flex-1 px-3 py-2 rounded-lg border border-border-light text-sm focus:outline-none focus:ring-2 focus:ring-trust-teal/20 focus:border-trust-teal"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="px-3 py-2 rounded-lg border border-border-light text-sm bg-white focus:outline-none focus:ring-2 focus:ring-trust-teal/20"
            >
              <option value="admin">Admin</option>
              <option value="compliance_officer">Compliance Officer</option>
              <option value="fraud_analyst">Fraud Analyst</option>
              <option value="developer">Developer</option>
              <option value="viewer">Viewer</option>
            </select>
            <button
              type="submit"
              disabled={inviting}
              className="bg-trust-teal text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-trust-teal/90 transition-colors disabled:opacity-50"
            >
              {inviting ? "Sending..." : "Send Invite"}
            </button>
          </form>
        )}

        {inviteMessage && (
          <div
            className={`mb-4 p-3 rounded-lg text-sm ${
              inviteMessage.type === "success"
                ? "bg-green-50 text-safe-green border border-green-200"
                : "bg-red-50 text-danger-red border border-red-200"
            }`}
          >
            {inviteMessage.text}
          </div>
        )}

        {/* Member list */}
        <div className="bg-white border border-border-light rounded-xl overflow-hidden">
          <div className="divide-y divide-border-light">
            {members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-gov-slate">
                      {(member.display_name ?? member.email ?? "?")[0]?.toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-deep-navy truncate">
                      {member.display_name ?? member.email ?? "Unknown"}
                      {member.user_id === currentUserId && (
                        <span className="text-xs text-gov-slate ml-1">(you)</span>
                      )}
                    </p>
                    {member.email && (
                      <p className="text-xs text-gov-slate truncate">{member.email}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                      ROLE_COLORS[member.role] ?? "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {ROLE_LABELS[member.role] ?? member.role}
                  </span>
                  {member.status !== "active" && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-amber-100 text-amber-700">
                      {member.status}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-deep-navy mb-4">
            Pending Invitations ({invitations.length})
          </h2>
          <div className="bg-white border border-border-light rounded-xl overflow-hidden">
            <div className="divide-y divide-border-light">
              {invitations.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
                      <Mail size={14} className="text-alert-amber" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-deep-navy">
                        {invite.email}
                      </p>
                      <p className="text-xs text-gov-slate flex items-center gap-1">
                        <Clock size={10} />
                        Expires {new Date(invite.expires_at).toLocaleDateString("en-AU")}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                      ROLE_COLORS[invite.role] ?? "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {ROLE_LABELS[invite.role] ?? invite.role}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
