"use client";

import { useState, useEffect } from "react";
import { Users, Plus, Mail, Shield } from "lucide-react";

interface FamilyGroup {
  id: string;
  name: string;
  family_members: Array<{
    id: string;
    email: string;
    role: string;
    joined_at: string | null;
  }>;
}

export default function FamilyPage() {
  const [groups, setGroups] = useState<FamilyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  useEffect(() => {
    fetchGroups();
  }, []);

  async function fetchGroups() {
    try {
      const res = await fetch("/api/family");
      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups);
      }
    } catch {
      // Handle error silently
    } finally {
      setLoading(false);
    }
  }

  async function createGroup() {
    if (!groupName.trim()) return;
    const res = await fetch("/api/family", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: groupName }),
    });
    if (res.ok) {
      setGroupName("");
      setShowCreate(false);
      fetchGroups();
    }
  }

  async function inviteMember() {
    if (!inviteEmail.trim() || !selectedGroup) return;
    const res = await fetch("/api/family/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: selectedGroup, email: inviteEmail }),
    });
    if (res.ok) {
      setInviteEmail("");
      fetchGroups();
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin h-8 w-8 border-2 border-deep-navy border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Shield className="text-deep-navy" size={28} />
          <h1 className="text-2xl font-bold text-deep-navy">Family Protection</h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-deep-navy text-white rounded-xl font-medium text-sm hover:bg-navy transition-colors"
        >
          <Plus size={16} />
          New Group
        </button>
      </div>

      {showCreate && (
        <div className="bg-white rounded-xl card-shadow p-6 mb-6">
          <h2 className="font-semibold text-deep-navy mb-4">Create Family Group</h2>
          <div className="flex gap-3">
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Family group name"
              className="flex-1 rounded-xl border border-border-default bg-surface px-4 py-2.5 text-sm"
              onKeyDown={(e) => e.key === "Enter" && createGroup()}
            />
            <button
              onClick={createGroup}
              disabled={!groupName.trim()}
              className="px-6 py-2.5 bg-deep-navy text-white rounded-xl font-medium text-sm disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="text-center py-16 text-gov-slate">
          <Users size={48} className="mx-auto mb-4 text-slate-300" />
          <p className="text-lg font-medium mb-2">No family groups yet</p>
          <p className="text-sm">Create a group to protect your family from scams together.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.id} className="bg-white rounded-xl card-shadow overflow-hidden">
              <div className="bg-deep-navy px-6 py-4">
                <h2 className="text-white font-semibold">{group.name}</h2>
                <p className="text-slate-300 text-sm">
                  {group.family_members.length} member{group.family_members.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="p-6">
                <ul className="space-y-3 mb-4">
                  {group.family_members.map((member) => (
                    <li key={member.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-surface rounded-full flex items-center justify-center text-sm font-medium text-deep-navy">
                          {member.email[0]?.toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm text-deep-navy">{member.email}</p>
                          <p className="text-xs text-slate-400">{member.role}</p>
                        </div>
                      </div>
                      {!member.joined_at && (
                        <span className="text-xs text-amber-500 bg-amber-50 px-2 py-1 rounded-full">
                          Pending
                        </span>
                      )}
                    </li>
                  ))}
                </ul>

                <div className="border-t border-border-default pt-4">
                  <div className="flex gap-3">
                    <input
                      type="email"
                      value={selectedGroup === group.id ? inviteEmail : ""}
                      onChange={(e) => {
                        setSelectedGroup(group.id);
                        setInviteEmail(e.target.value);
                      }}
                      onFocus={() => setSelectedGroup(group.id)}
                      placeholder="Email to invite"
                      className="flex-1 rounded-lg border border-border-default bg-surface px-3 py-2 text-sm"
                    />
                    <button
                      onClick={inviteMember}
                      disabled={!inviteEmail.trim() || selectedGroup !== group.id}
                      className="flex items-center gap-1.5 px-4 py-2 bg-action-teal text-deep-navy rounded-lg font-medium text-sm disabled:opacity-50"
                    >
                      <Mail size={14} />
                      Invite
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
