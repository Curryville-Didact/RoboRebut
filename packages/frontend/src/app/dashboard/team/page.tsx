"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { API_URL } from "@/lib/env";

type Member = {
  id: string;
  user_id: string | null;
  role: string;
  invited_email: string | null;
  accepted_at: string | null;
  created_at: string;
};

type Workspace = {
  id: string;
  name: string;
  owner_id: string;
  plan_type: string;
  created_at: string;
  updated_at?: string;
};

/** Matches `conversations` rows from GET /api/workspaces/:id/conversations */
type TeamConversation = {
  id: string;
  title: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  deal_context?: unknown;
  client_context?: unknown;
};

async function getToken(): Promise<string | null> {
  const { data } = await createClient().auth.getSession();
  return data.session?.access_token ?? null;
}

function apiErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error?: { message?: string } }).error;
    if (err?.message) return err.message;
  }
  if (body && typeof body === "object" && "message" in body) {
    const m = (body as { message?: string }).message;
    if (typeof m === "string" && m) return m;
  }
  return fallback;
}

function fmtTs(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

const INPUT =
  "w-full rounded-md border border-white/10 bg-black/30 px-2 py-2 text-sm text-gray-100 outline-none focus:border-emerald-500/40";

export default function TeamDashboardPage() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [conversations, setConversations] = useState<TeamConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [wsName, setWsName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError("Not signed in");
        return;
      }

      const {
        data: { user },
      } = await createClient().auth.getUser();
      setCurrentUserId(user?.id ?? null);

      const res = await fetch(`${API_URL}/api/workspaces/mine`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as {
        ok?: boolean;
        item?: Workspace | null;
        members?: Member[];
      };
      if (!res.ok) {
        setError(apiErrorMessage(body, "Failed to load workspace"));
        return;
      }
      setWorkspace(body.item ?? null);
      setMembers(body.members ?? []);

      if (body.item) {
        const convRes = await fetch(
          `${API_URL}/api/workspaces/${body.item.id}/conversations`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const convBody = (await convRes.json()) as { items?: TeamConversation[]; error?: { message?: string } };
        if (convRes.ok) {
          setConversations(Array.isArray(convBody.items) ? convBody.items : []);
        } else {
          setConversations([]);
        }
      } else {
        setConversations([]);
      }
    } catch {
      setError("Failed to load workspace");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const createWorkspace = useCallback(async () => {
    if (creating || !wsName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/workspaces`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: wsName.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setCreateError(apiErrorMessage(body, "Failed to create workspace"));
        return;
      }
      setWsName("");
      await loadWorkspace();
    } catch {
      setCreateError("Failed to create workspace");
    } finally {
      setCreating(false);
    }
  }, [creating, wsName, loadWorkspace]);

  const invite = useCallback(async () => {
    if (inviting || !inviteEmail.trim() || !workspace) return;
    setInviting(true);
    setInviteError(null);
    setInviteSuccess(false);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/workspaces/${workspace.id}/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setInviteError(apiErrorMessage(body, "Failed to invite"));
        return;
      }
      setInviteSuccess(true);
      setInviteEmail("");
      await loadWorkspace();
    } catch {
      setInviteError("Failed to invite member");
    } finally {
      setInviting(false);
    }
  }, [inviting, inviteEmail, workspace, loadWorkspace]);

  const removeMember = useCallback(
    async (memberId: string) => {
      if (!workspace) return;
      const token = await getToken();
      if (!token) return;
      const res = await fetch(
        `${API_URL}/api/workspaces/${workspace.id}/members/${memberId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(apiErrorMessage(body, "Could not remove member"));
        return;
      }
      await loadWorkspace();
    },
    [workspace, loadWorkspace]
  );

  const isOwner = workspace != null && currentUserId === workspace.owner_id;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">Team workspace</h1>
          <p className="text-sm text-gray-500">
            Shared conversations for your team plan. Invite brokers by email.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-sm text-gray-400 underline-offset-2 hover:text-white hover:underline"
        >
          ← Back to conversations
        </Link>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : !workspace ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 space-y-4">
          <div className="text-sm font-semibold text-white">Create your workspace</div>
          <p className="text-xs text-gray-500">
            Team workspaces require a <span className="text-gray-400">team</span> plan. Enter a
            name and create once — you can invite members after.
          </p>
          <input
            className={INPUT}
            value={wsName}
            onChange={(e) => setWsName(e.target.value)}
            placeholder="Workspace name"
          />
          {createError ? (
            <div className="text-xs text-red-300">{createError}</div>
          ) : null}
          <button
            type="button"
            disabled={creating || !wsName.trim()}
            onClick={() => void createWorkspace()}
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create workspace"}
          </button>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
            <div className="text-xs uppercase tracking-wide text-gray-600">Workspace</div>
            <div className="text-lg font-semibold text-white">{workspace.name}</div>
            <div className="text-xs text-gray-500">
              Plan: {workspace.plan_type} · Created {fmtTs(workspace.created_at)}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
              <div className="text-sm font-semibold text-white">Members</div>
              <ul className="space-y-2">
                {members.map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
                  >
                    <div>
                      <span className="text-gray-200">
                        {m.invited_email ?? m.user_id ?? "Pending"}
                      </span>
                      {m.user_id === currentUserId ? (
                        <span className="ml-2 text-xs text-emerald-400">(you)</span>
                      ) : null}
                      <span className="ml-2 text-xs text-gray-500">
                        {m.role}
                        {m.accepted_at ? "" : " · pending"}
                      </span>
                    </div>
                    {isOwner && m.role !== "owner" ? (
                      <button
                        type="button"
                        onClick={() => void removeMember(m.id)}
                        className="rounded-md border border-white/15 px-2 py-1 text-xs text-gray-300 hover:bg-white/10"
                      >
                        Remove
                      </button>
                    ) : null}
                    {!isOwner && m.user_id === currentUserId && m.role !== "owner" ? (
                      <button
                        type="button"
                        onClick={() => void removeMember(m.id)}
                        className="rounded-md border border-white/15 px-2 py-1 text-xs text-gray-300 hover:bg-white/10"
                      >
                        Leave
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>

              {isOwner ? (
                <div className="space-y-2 border-t border-white/10 pt-4">
                  <div className="text-xs text-gray-500">Invite by email</div>
                  <input
                    className={INPUT}
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                  />
                  {inviteError ? (
                    <div className="text-xs text-red-300">{inviteError}</div>
                  ) : null}
                  {inviteSuccess ? (
                    <div className="text-xs text-emerald-400">Invitation sent.</div>
                  ) : null}
                  <button
                    type="button"
                    disabled={inviting || !inviteEmail.trim()}
                    onClick={() => void invite()}
                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    {inviting ? "Inviting…" : "Invite member"}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-gray-500 border-t border-white/10 pt-4">
                  Only the workspace owner can invite new members.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <div className="text-sm font-semibold text-white">Team conversations</div>
              {conversations.length === 0 ? (
                <p className="text-sm text-gray-500">No conversations yet.</p>
              ) : (
                <ul className="space-y-2">
                  {conversations.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/dashboard/${c.id}`}
                        className="block rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm transition hover:bg-white/[0.06]"
                      >
                        <div className="font-medium text-gray-100">{c.title}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          Updated {fmtTs(c.updated_at ?? c.created_at)}
                          {c.user_id !== currentUserId ? (
                            <span className="ml-2 text-gray-600">· teammate</span>
                          ) : null}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
