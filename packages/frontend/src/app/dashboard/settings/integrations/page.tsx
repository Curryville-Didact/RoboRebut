"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { API_URL } from "@/lib/env";
import { DashboardEmptyState, DashboardErrorPanel } from "@/components/dashboard/DashboardEmptyState";
import { MSG_INTEGRATIONS_LOAD, MSG_SESSION } from "@/lib/userFacingErrors";
import { trackEvent } from "@/lib/trackEvent";

type ProviderType =
  | "generic_webhook"
  | "hubspot"
  | "salesforce"
  | "ghl"
  | "zoho"
  | "velocify";

type AuthType = "none" | "bearer" | "header";

type IntegrationEndpoint = {
  id: string;
  created_at: string;
  updated_at: string;
  is_enabled: boolean;
  provider_type: ProviderType;
  endpoint_url: string;
  auth_type: AuthType;
  auth_config: Record<string, unknown> | null;
  event_types: string[];
  metadata: Record<string, unknown> | null;
};

type DeliveryLog = {
  id: string;
  created_at: string;
  event_type: string;
  delivery_status: string;
  http_status: number | null;
  duration_ms: number | null;
  error_message: string | null;
  retryable: boolean;
};

async function waitForSessionAccessToken(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function fmtTs(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

const INPUT =
  "w-full rounded-md border border-white/10 bg-black/30 px-2 py-2 text-sm text-gray-100 outline-none focus:border-emerald-500/40";
const SELECT =
  "rounded-md border border-white/10 bg-black/30 px-2 py-2 text-sm text-gray-100";

const CRM_SOURCES = [
  { key: "gohighlevel", label: "GoHighLevel" },
  { key: "hubspot", label: "HubSpot" },
  { key: "salesforce", label: "Salesforce" },
  { key: "zoho", label: "Zoho CRM" },
  { key: "velocify", label: "Velocify" },
  { key: "generic_webhook", label: "Generic / Other" },
] as const;

export default function IntegrationsSettingsPage() {
  const [items, setItems] = useState<IntegrationEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [provider, setProvider] = useState<ProviderType>("generic_webhook");
  const [url, setUrl] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [authType, setAuthType] = useState<AuthType>("none");
  const [bearerToken, setBearerToken] = useState("");
  const [headerName, setHeaderName] = useState("");
  const [headerValue, setHeaderValue] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [eventTypes, setEventTypes] = useState<{ rebuttal: boolean; review: boolean }>({
    rebuttal: true,
    review: true,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId]
  );
  const [logs, setLogs] = useState<DeliveryLog[] | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [webhookUserId, setWebhookUserId] = useState<string | null>(null);

  const BACKEND_URL =
    process.env.NEXT_PUBLIC_API_URL ??
    (typeof window !== "undefined" ? window.location.origin : "");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await waitForSessionAccessToken();
      if (!token) {
        setError(MSG_SESSION);
        return;
      }
      const res = await fetch(`${API_URL}/api/integrations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as { items?: IntegrationEndpoint[] };
      if (!res.ok) {
        void body;
        setError(MSG_INTEGRATIONS_LOAD);
        return;
      }
      setItems((body.items ?? []) as IntegrationEndpoint[]);
    } catch {
      setError(MSG_INTEGRATIONS_LOAD);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Get userId for inbound webhook URLs
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        setWebhookUserId(data.user?.id ?? null);
      });
  }, [load]);

  const create = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const token = await waitForSessionAccessToken();
      if (!token) return;
      const auth_config =
        authType === "bearer"
          ? { token: bearerToken }
          : authType === "header"
            ? { headerName, headerValue }
            : null;
      const event_types = [
        ...(eventTypes.rebuttal ? ["rebuttal.generated"] : []),
        ...(eventTypes.review ? ["review.submitted"] : []),
      ];
      const res = await fetch(`${API_URL}/api/integrations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          provider_type: provider,
          endpoint_url: url,
          is_enabled: enabled,
          auth_type: authType,
          auth_config,
          signing_secret: signingSecret || null,
          event_types,
        }),
      });
      const body = (await res.json()) as { ok?: boolean };
      if (!res.ok || !body.ok) {
        setError("Couldn’t create integration. Check the URL and try again.");
        return;
      }
      trackEvent({
        eventName: "integration_created",
        surface: "integrations",
        planType: null,
        metadata: { route: "/dashboard/settings/integrations" },
      });
      setUrl("");
      setBearerToken("");
      setHeaderName("");
      setHeaderValue("");
      setSigningSecret("");
      await load();
    } finally {
      setCreating(false);
    }
  }, [
    creating,
    provider,
    url,
    enabled,
    authType,
    bearerToken,
    headerName,
    headerValue,
    signingSecret,
    eventTypes,
    load,
  ]);

  const patch = useCallback(
    async (id: string, patchBody: Record<string, unknown>) => {
      const token = await waitForSessionAccessToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/integrations/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(patchBody),
      });
      const body = (await res.json()) as { ok?: boolean };
      if (!res.ok || !body.ok) {
        void body;
        setError("Couldn’t update integration. Try again.");
        return;
      }
      await load();
    },
    [load]
  );

  const testSend = useCallback(async (id: string) => {
    setError(null);
    const token = await waitForSessionAccessToken();
    if (!token) return;
    const res = await fetch(`${API_URL}/api/integrations/${id}/test`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
      const body = (await res.json()) as { ok?: boolean };
      if (!res.ok || !body.ok) {
        void body;
        setError("Test delivery didn’t complete. Verify the endpoint and try again.");
        return;
      }
    await loadLogs(id);
  }, []);

  const loadLogs = useCallback(async (id: string) => {
    setLoadingLogs(true);
    try {
      const token = await waitForSessionAccessToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/integrations/${id}/logs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as any;
      if (!res.ok || !body.ok) {
        setLogs(null);
        return;
      }
      setLogs((body.items ?? []) as DeliveryLog[]);
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadLogs(selectedId);
  }, [selectedId, loadLogs]);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* ── Inbound webhook URLs ── */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
        <div className="text-sm font-semibold">Your inbound webhook URLs</div>
        <p className="text-xs text-gray-500">
          Paste one of these URLs into your CRM so RoboRebut automatically transcribes every
          recorded call and opens a coaching session.
        </p>
        {!webhookUserId ? (
          <div className="text-xs text-gray-500">Loading…</div>
        ) : (
          <div className="space-y-2">
            {CRM_SOURCES.map(({ key, label }) => {
              const url = `${BACKEND_URL}/api/calls/webhook/${key}?userId=${webhookUserId}`;
              return (
                <div key={key} className="space-y-1">
                  <div className="text-xs text-gray-400">{label}</div>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={url}
                      className="flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-gray-200 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(url)}
                      className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-gray-300 hover:bg-white/[0.08]"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight text-white">Integrations</h2>
          <p className="text-sm text-gray-500">
            CRM-agnostic webhooks. Best-effort delivery; failures never block core flows.
          </p>
        </div>
        <Link href="/dashboard" className="text-sm text-gray-400 underline hover:text-white">
          Back to conversations
        </Link>
      </div>

      {error ? (
        <DashboardErrorPanel message={error} onRetry={() => void load()} retryLabel="Refresh" />
      ) : null}

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
        <div className="text-sm font-semibold">Add integration</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <div className="text-xs text-gray-500">Provider</div>
            <select className={SELECT} value={provider} onChange={(e) => setProvider(e.target.value as ProviderType)}>
              <option value="generic_webhook">Generic Webhook</option>
              <option value="ghl">GoHighLevel</option>
              <option value="hubspot">HubSpot</option>
              <option value="salesforce">Salesforce</option>
              <option value="zoho">Zoho</option>
              <option value="velocify">Velocify</option>
            </select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-gray-500">Endpoint URL</div>
            <input className={INPUT} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-gray-500">Auth type</div>
            <select className={SELECT} value={authType} onChange={(e) => setAuthType(e.target.value as AuthType)}>
              <option value="none">None</option>
              <option value="bearer">Bearer</option>
              <option value="header">Header</option>
            </select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-gray-500">Signing secret (HMAC)</div>
            <input className={INPUT} value={signingSecret} onChange={(e) => setSigningSecret(e.target.value)} placeholder="optional" />
          </div>
        </div>

        {authType === "bearer" ? (
          <div className="space-y-1">
            <div className="text-xs text-gray-500">Bearer token</div>
            <input className={INPUT} value={bearerToken} onChange={(e) => setBearerToken(e.target.value)} placeholder="token" />
          </div>
        ) : null}
        {authType === "header" ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <div className="text-xs text-gray-500">Header name</div>
              <input className={INPUT} value={headerName} onChange={(e) => setHeaderName(e.target.value)} placeholder="X-Api-Key" />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-500">Header value</div>
              <input className={INPUT} value={headerValue} onChange={(e) => setHeaderValue(e.target.value)} placeholder="value" />
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-4 text-sm text-gray-200">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={eventTypes.rebuttal} onChange={(e) => setEventTypes((p) => ({ ...p, rebuttal: e.target.checked }))} />
            rebuttal.generated
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={eventTypes.review} onChange={(e) => setEventTypes((p) => ({ ...p, review: e.target.checked }))} />
            review.submitted
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            enabled
          </label>
        </div>

        <button
          onClick={() => void create()}
          disabled={creating}
          className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-60"
        >
          {creating ? "Creating…" : "Create integration"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]">
        <div className="space-y-3">
          {loading ? (
            <div className="text-sm text-gray-500">Loading…</div>
          ) : error ? null : items.length === 0 ? (
            <DashboardEmptyState
              title="No integrations configured yet"
              description="Add an endpoint below when you’re ready to send events to your stack."
            />
          ) : (
            items.map((it) => (
              <button
                key={it.id}
                onClick={() => setSelectedId(it.id)}
                className={`w-full text-left rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:bg-white/[0.05] transition ${
                  it.id === selectedId ? "border-emerald-500/30 bg-emerald-500/[0.06]" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-gray-200">
                    {it.provider_type} · {it.is_enabled ? "enabled" : "disabled"}
                  </div>
                  <div className="text-xs text-gray-500">{fmtTs(it.created_at)}</div>
                </div>
                <div className="mt-2 text-xs text-gray-500 break-all">{it.endpoint_url}</div>
                <div className="mt-2 text-[11px] text-gray-500">
                  events: {(it.event_types ?? []).join(", ")}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-semibold">Selected</div>
            {!selected ? (
              <div className="mt-2 text-sm text-gray-500">Select an integration.</div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="text-xs text-gray-500 break-all">{selected.endpoint_url}</div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void patch(selected.id, { is_enabled: !selected.is_enabled })}
                    className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-gray-200 hover:bg-white/[0.06]"
                  >
                    {selected.is_enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => void testSend(selected.id)}
                    className="rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-1 text-xs font-medium text-emerald-100 hover:bg-emerald-500/20"
                  >
                    Test delivery
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-semibold">Recent deliveries</div>
            {!selected ? (
              <div className="mt-2 text-sm text-gray-500">Select an integration.</div>
            ) : loadingLogs ? (
              <div className="mt-2 text-sm text-gray-500">Loading…</div>
            ) : logs && logs.length > 0 ? (
              <div className="mt-3 space-y-2">
                {logs.slice(0, 12).map((l) => (
                  <div key={l.id} className="rounded-lg border border-white/10 bg-black/20 p-2">
                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <div>{l.event_type}</div>
                      <div>{fmtTs(l.created_at)}</div>
                    </div>
                    <div className="mt-1 text-xs text-gray-300">
                      {l.delivery_status}
                      {l.http_status != null ? ` · HTTP ${l.http_status}` : ""}
                      {l.duration_ms != null ? ` · ${l.duration_ms}ms` : ""}
                      {l.retryable ? " · retryable" : ""}
                    </div>
                    {l.error_message ? (
                      <div className="mt-1 text-[11px] text-red-200/80">
                        {l.error_message}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-sm text-gray-500">No deliveries yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

