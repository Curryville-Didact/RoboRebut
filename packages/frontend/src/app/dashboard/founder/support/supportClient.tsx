"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type SupportResponse = {
  identity?: {
    userId: string;
    email: string | null;
    createdAt: string | null;
    profilePlanType: string | null;
  };
  billing?: {
    resolvedPlanTier: string;
    polarCustomerId: string | null;
    paidStateSummary: string;
    lastSyncSummary: string | null;
  };
  entitlements?: Record<string, unknown>;
  usage?: Record<string, unknown>;
  diagnostics?: {
    mismatchFlags?: string[];
    notes?: string[];
    recentSignals?: Record<string, unknown> | null;
  };
  supportSummary?: Record<string, unknown>;
  error?: unknown;
};

function StatusPill({
  tone,
  children,
}: {
  tone: "gray" | "green" | "amber" | "red";
  children: React.ReactNode;
}) {
  const cls =
    tone === "green"
      ? "border-emerald-500/35 bg-emerald-950/25 text-emerald-100"
      : tone === "amber"
        ? "border-amber-500/35 bg-amber-950/20 text-amber-100"
        : tone === "red"
          ? "border-red-500/35 bg-red-950/25 text-red-100"
          : "border-white/10 bg-white/[0.03] text-gray-300";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${cls}`}
    >
      {children}
    </span>
  );
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

export function FounderSupportClient({ apiBase }: { apiBase: string }) {
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SupportResponse | null>(null);

  const healthTone = useMemo(() => {
    const flags = data?.diagnostics?.mismatchFlags ?? [];
    const health = (data?.supportSummary as any)?.accountHealth as
      | string
      | undefined;
    if (health === "mismatch" || flags.length > 0) return "red" as const;
    if (health === "warning") return "amber" as const;
    if (health === "healthy") return "green" as const;
    return "gray" as const;
  }, [data]);

  async function inspect() {
    setLoading(true);
    setError(null);
    setNotFound(false);
    setData(null);

    try {
      const token =
        (await createClient().auth.getSession()).data.session?.access_token ??
        null;
      if (!token) {
        setError("No session token available.");
        return;
      }

      const params = new URLSearchParams();
      if (email.trim()) params.set("email", email.trim());
      if (userId.trim()) params.set("userId", userId.trim());
      const url = `${apiBase}/api/founder/support/account?${params.toString()}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 404) {
        setNotFound(true);
        return;
      }

      const json = (await res.json()) as SupportResponse;
      if (!res.ok) {
        setError((json as any)?.error?.message ?? `Request failed (${res.status}).`);
        setData(json);
        return;
      }

      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Section title="Lookup">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-gray-400">
              Email
            </label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="mt-1 w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white/40"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400">
              User ID
            </label>
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="uuid"
              className="mt-1 w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white/40"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void inspect()}
            disabled={loading || (!email.trim() && !userId.trim())}
            className="inline-flex rounded-lg border border-emerald-500/40 bg-emerald-600/15 px-4 py-2 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-600/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Inspecting…" : "Inspect account"}
          </button>
          {data?.supportSummary ? (
            <StatusPill tone={healthTone}>
              {(data.supportSummary as any)?.accountHealth ?? "unknown"}
            </StatusPill>
          ) : null}
          {notFound ? (
            <span className="text-sm text-amber-200">Not found.</span>
          ) : null}
          {error ? <span className="text-sm text-red-300">{error}</span> : null}
        </div>
      </Section>

      {data?.supportSummary ? (
        <Section title="Support Summary">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={healthTone}>
              {(data.supportSummary as any)?.headline ?? "—"}
            </StatusPill>
            {data?.billing?.resolvedPlanTier ? (
              <StatusPill tone="gray">plan: {data.billing.resolvedPlanTier}</StatusPill>
            ) : null}
            {typeof (data.usage as any)?.blocked === "boolean" ? (
              <StatusPill tone={(data.usage as any).blocked ? "red" : "green"}>
                {(data.usage as any).blocked ? "blocked" : "not blocked"}
              </StatusPill>
            ) : null}
          </div>
          <pre className="mt-3 overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-gray-200">
            {JSON.stringify(data.supportSummary, null, 2)}
          </pre>
        </Section>
      ) : null}

      {data?.identity ? (
        <Section title="Identity">
          <pre className="overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-gray-200">
            {JSON.stringify(data.identity, null, 2)}
          </pre>
        </Section>
      ) : null}

      {data?.billing ? (
        <Section title="Billing Truth">
          <pre className="overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-gray-200">
            {JSON.stringify(data.billing, null, 2)}
          </pre>
        </Section>
      ) : null}

      {data?.entitlements ? (
        <Section title="Entitlements">
          <pre className="overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-gray-200">
            {JSON.stringify(data.entitlements, null, 2)}
          </pre>
        </Section>
      ) : null}

      {data?.usage ? (
        <Section title="Usage">
          <pre className="overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-gray-200">
            {JSON.stringify(data.usage, null, 2)}
          </pre>
        </Section>
      ) : null}

      {data?.diagnostics ? (
        <Section title="Diagnostics">
          <div className="flex flex-wrap gap-2">
            {(data.diagnostics.mismatchFlags ?? []).map((f) => (
              <StatusPill key={f} tone="red">
                {f}
              </StatusPill>
            ))}
          </div>
          <pre className="mt-3 overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-gray-200">
            {JSON.stringify(data.diagnostics, null, 2)}
          </pre>
        </Section>
      ) : null}

      {data ? (
        <Section title="Raw Response">
          <pre className="overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-gray-200">
            {JSON.stringify(data, null, 2)}
          </pre>
        </Section>
      ) : null}
    </div>
  );
}

