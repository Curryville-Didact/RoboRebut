"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type LookupUser = {
  id: string;
  email: string | null;
  plan_type: string | null;
  usage_count: number | null;
  role: string | null;
};

type FeatureFlagRow = {
  key: string;
  enabled: boolean;
  description: string;
};

async function bearer(): Promise<string | null> {
  const {
    data: { session },
  } = await createClient().auth.getSession();
  return session?.access_token ?? null;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function AdminOpsPanels({ apiBase }: { apiBase: string }) {
  const [lookupEmail, setLookupEmail] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [users, setUsers] = useState<LookupUser[]>([]);

  const [flags, setFlags] = useState<FeatureFlagRow[]>([]);
  const [flagsErr, setFlagsErr] = useState<string | null>(null);
  const [flagsBusy, setFlagsBusy] = useState(false);

  const [stats, setStats] = useState<{
    totalUsers: number;
    totalConversations: number;
    proUsers: number;
    timestamp?: string;
  } | null>(null);
  const [statsErr, setStatsErr] = useState<string | null>(null);
  const [statsBusy, setStatsBusy] = useState(false);

  const [openUsageFor, setOpenUsageFor] = useState<string | null>(null);
  const [usageCountInput, setUsageCountInput] = useState("");
  const [planTypeInput, setPlanTypeInput] = useState("free");

  const [openRoleFor, setOpenRoleFor] = useState<string | null>(null);
  const [roleInput, setRoleInput] = useState("USER");

  const authFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await bearer();
      if (!token) throw new Error("No session token.");
      return fetch(`${apiBase}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...(init?.headers ?? {}),
        },
      });
    },
    [apiBase]
  );

  const loadFlags = useCallback(async () => {
    setFlagsBusy(true);
    setFlagsErr(null);
    try {
      const res = await authFetch("/api/admin/flags");
      const json = (await res.json()) as { flags?: FeatureFlagRow[] };
      if (!res.ok) {
        setFlagsErr(
          (json as { error?: string }).error ??
            `Failed to load flags (${res.status}).`
        );
        return;
      }
      setFlags(json.flags ?? []);
    } catch (e) {
      setFlagsErr(e instanceof Error ? e.message : "Failed to load flags.");
    } finally {
      setFlagsBusy(false);
    }
  }, [authFetch]);

  const loadStats = useCallback(async () => {
    setStatsBusy(true);
    setStatsErr(null);
    try {
      const res = await authFetch("/api/admin/stats");
      const json = (await res.json()) as {
        totalUsers?: number;
        totalConversations?: number;
        proUsers?: number;
        timestamp?: string;
        error?: string;
      };
      if (!res.ok) {
        setStatsErr(json.error ?? `Failed (${res.status}).`);
        return;
      }
      setStats({
        totalUsers: json.totalUsers ?? 0,
        totalConversations: json.totalConversations ?? 0,
        proUsers: json.proUsers ?? 0,
        timestamp: json.timestamp,
      });
    } catch (e) {
      setStatsErr(e instanceof Error ? e.message : "Failed to load stats.");
    } finally {
      setStatsBusy(false);
    }
  }, [authFetch]);

  useEffect(() => {
    void loadFlags();
    void loadStats();
  }, [loadFlags, loadStats]);

  async function runLookup() {
    const q = lookupEmail.trim();
    if (!q) return;
    setLookupBusy(true);
    setLookupErr(null);
    try {
      const res = await authFetch(
        `/api/admin/users/lookup?email=${encodeURIComponent(q)}`
      );
      const json = (await res.json()) as {
        users?: LookupUser[];
        error?: string;
      };
      if (!res.ok) {
        setLookupErr(json.error ?? `Lookup failed (${res.status}).`);
        setUsers([]);
        return;
      }
      setUsers(json.users ?? []);
    } catch (e) {
      setLookupErr(e instanceof Error ? e.message : "Lookup failed.");
      setUsers([]);
    } finally {
      setLookupBusy(false);
    }
  }

  async function submitUsageOverride(userId: string) {
    const usage =
      usageCountInput.trim() === "" ? undefined : Number(usageCountInput);
    if (
      usage !== undefined &&
      (!Number.isFinite(usage) || !Number.isInteger(usage))
    ) {
      setLookupErr("Usage count must be an integer.");
      return;
    }
    const body: { usageCount?: number; planType?: string } = {};
    if (usage !== undefined) body.usageCount = usage;
    if (planTypeInput.trim()) body.planType = planTypeInput.trim();
    setLookupErr(null);
    try {
      const res = await authFetch(
        `/api/admin/users/${encodeURIComponent(userId)}/usage-override`,
        { method: "POST", body: JSON.stringify(body) }
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setLookupErr(json.error ?? `Update failed (${res.status}).`);
        return;
      }
      setOpenUsageFor(null);
      await runLookup();
    } catch (e) {
      setLookupErr(e instanceof Error ? e.message : "Update failed.");
    }
  }

  async function submitRole(userId: string) {
    setLookupErr(null);
    try {
      const res = await authFetch(
        `/api/admin/users/${encodeURIComponent(userId)}/role`,
        { method: "POST", body: JSON.stringify({ role: roleInput }) }
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setLookupErr(json.error ?? `Role update failed (${res.status}).`);
        return;
      }
      setOpenRoleFor(null);
      await runLookup();
    } catch (e) {
      setLookupErr(e instanceof Error ? e.message : "Role update failed.");
    }
  }

  async function toggleFlag(row: FeatureFlagRow, next: boolean) {
    const prev = flags.map((f) =>
      f.key === row.key ? { ...f, enabled: next } : f
    );
    setFlags(prev);
    try {
      const res = await authFetch(
        `/api/admin/flags/${encodeURIComponent(row.key)}`,
        { method: "PATCH", body: JSON.stringify({ enabled: next }) }
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setFlags((fs) =>
        fs.map((f) => (f.key === row.key ? { ...f, enabled: row.enabled } : f))
      );
      setFlagsErr(e instanceof Error ? e.message : "Toggle failed.");
    }
  }

  return (
    <div className="space-y-4">
      <Section title="User lookup (support)">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <label className="block text-xs font-medium text-gray-400">
              Search by email
            </label>
            <input
              value={lookupEmail}
              onChange={(e) => setLookupEmail(e.target.value)}
              placeholder="partial email ok"
              className="mt-1 w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white/40"
            />
          </div>
          <button
            type="button"
            onClick={() => void runLookup()}
            disabled={lookupBusy || !lookupEmail.trim()}
            className="min-h-[44px] rounded-lg border border-emerald-500/40 bg-emerald-600/15 px-4 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-600/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {lookupBusy ? "Searching…" : "Search"}
          </button>
        </div>
        {lookupErr ? (
          <p className="mt-2 text-sm text-red-300">{lookupErr}</p>
        ) : null}

        {users.length > 0 ? (
          <div className="mt-4 overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full min-w-[640px] text-left text-xs text-gray-200">
              <thead className="border-b border-white/10 bg-black/40 text-[11px] uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Plan</th>
                  <th className="px-3 py-2">Usage</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Id</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-white/5 align-top">
                    <td className="px-3 py-2">{u.email ?? "—"}</td>
                    <td className="px-3 py-2">{u.plan_type ?? "—"}</td>
                    <td className="px-3 py-2">{u.usage_count ?? "—"}</td>
                    <td className="px-3 py-2">{u.role ?? "—"}</td>
                    <td className="max-w-[120px] truncate px-3 py-2 font-mono text-[10px] text-gray-500">
                      {u.id}
                    </td>
                    <td className="space-y-2 px-3 py-2">
                      <button
                        type="button"
                        className="min-h-[44px] w-full rounded-lg border border-white/15 bg-white/[0.06] px-3 text-xs font-medium text-gray-200 hover:bg-white/[0.1]"
                        onClick={() => {
                          setOpenUsageFor((id) => (id === u.id ? null : u.id));
                          setUsageCountInput(
                            u.usage_count != null ? String(u.usage_count) : ""
                          );
                          setPlanTypeInput(u.plan_type ?? "free");
                          setOpenRoleFor(null);
                        }}
                      >
                        Override usage
                      </button>
                      <button
                        type="button"
                        className="min-h-[44px] w-full rounded-lg border border-white/15 bg-white/[0.06] px-3 text-xs font-medium text-gray-200 hover:bg-white/[0.1]"
                        onClick={() => {
                          setOpenRoleFor((id) => (id === u.id ? null : u.id));
                          setRoleInput(u.role ?? "USER");
                          setOpenUsageFor(null);
                        }}
                      >
                        Change role
                      </button>

                      {openUsageFor === u.id ? (
                        <div className="rounded-lg border border-white/10 bg-black/40 p-3 space-y-2">
                          <input
                            type="number"
                            placeholder="New usage count"
                            value={usageCountInput}
                            onChange={(e) => setUsageCountInput(e.target.value)}
                            className="w-full rounded-md border border-white/15 bg-transparent px-2 py-2 text-xs text-white"
                          />
                          <select
                            value={planTypeInput}
                            onChange={(e) => setPlanTypeInput(e.target.value)}
                            className="w-full rounded-md border border-white/15 bg-black/50 px-2 py-2 text-xs text-white"
                          >
                            <option value="free">free</option>
                            <option value="starter">starter</option>
                            <option value="pro">pro</option>
                          </select>
                          <button
                            type="button"
                            className="min-h-[44px] w-full rounded-lg border border-emerald-500/40 bg-emerald-600/15 px-3 text-xs font-semibold text-emerald-50 hover:bg-emerald-600/25"
                            onClick={() => void submitUsageOverride(u.id)}
                          >
                            Submit override
                          </button>
                        </div>
                      ) : null}

                      {openRoleFor === u.id ? (
                        <div className="rounded-lg border border-white/10 bg-black/40 p-3 space-y-2">
                          <select
                            value={roleInput}
                            onChange={(e) => setRoleInput(e.target.value)}
                            className="w-full rounded-md border border-white/15 bg-black/50 px-2 py-2 text-xs text-white"
                          >
                            <option value="USER">USER</option>
                            <option value="ADMIN">ADMIN</option>
                            <option value="FOUNDER">FOUNDER</option>
                          </select>
                          <button
                            type="button"
                            className="min-h-[44px] w-full rounded-lg border border-emerald-500/40 bg-emerald-600/15 px-3 text-xs font-semibold text-emerald-50 hover:bg-emerald-600/25"
                            onClick={() => void submitRole(u.id)}
                          >
                            Submit role
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>

      <Section title="Feature flags">
        {flagsErr ? (
          <p className="mb-2 text-sm text-red-300">{flagsErr}</p>
        ) : null}
        {flagsBusy && flags.length === 0 ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : null}
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full min-w-[520px] text-left text-xs text-gray-200">
            <thead className="border-b border-white/10 bg-black/40 text-[11px] uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Key</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr
                  key={f.key}
                  className={`border-b border-white/5 ${
                    f.key === "maintenance_mode" && f.enabled ? "ring-1 ring-inset ring-red-500/50" : ""
                  }`}
                >
                  <td className="px-3 py-2 font-mono text-[11px]">{f.key}</td>
                  <td className="px-3 py-2 text-gray-400">{f.description}</td>
                  <td className="px-3 py-2">
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={f.enabled}
                        onChange={(e) => void toggleFlag(f, e.target.checked)}
                        className="h-4 w-4 accent-emerald-500"
                      />
                      <span className="text-gray-400">{f.enabled ? "On" : "Off"}</span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="System stats">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadStats()}
            disabled={statsBusy}
            className="min-h-[44px] rounded-lg border border-white/15 bg-white/[0.06] px-4 text-sm font-medium text-gray-200 hover:bg-white/[0.1] disabled:opacity-50"
          >
            {statsBusy ? "Refreshing…" : "Refresh"}
          </button>
          {stats?.timestamp ? (
            <span className="text-xs text-gray-500">{stats.timestamp}</span>
          ) : null}
        </div>
        {statsErr ? (
          <p className="mt-2 text-sm text-red-300">{statsErr}</p>
        ) : null}
        {stats ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              { label: "Total users", v: stats.totalUsers },
              { label: "Total conversations", v: stats.totalConversations },
              { label: "Pro users", v: stats.proUsers },
            ].map((c) => (
              <div
                key={c.label}
                className="rounded-lg border border-white/10 bg-black/40 px-4 py-4 text-center"
              >
                <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  {c.label}
                </div>
                <div className="mt-1 text-2xl font-semibold text-white">{c.v}</div>
              </div>
            ))}
          </div>
        ) : null}
      </Section>
    </div>
  );
}
