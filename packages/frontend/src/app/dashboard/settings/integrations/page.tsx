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

type CrmType = "hubspot" | "gohighlevel" | "salesforce" | "zoho" | "velocify";

type CrmConnection = {
  id: string;
  crm_type: CrmType;
  is_active: boolean;
  created_at: string;
};

type CrmOption = {
  crm_type: CrmType;
  name: string;
  logoUrl: string;
};

const CRM_OPTIONS: CrmOption[] = [
  {
    crm_type: "hubspot",
    name: "HubSpot",
    logoUrl: "https://www.hubspot.com/hubfs/assets/hubspot.com/buzz/HubSpotOpenGraph.png",
  },
  {
    crm_type: "gohighlevel",
    name: "GoHighLevel",
    logoUrl: "https://marketplace.gohighlevel.com/assets/images/logo.png",
  },
  {
    crm_type: "salesforce",
    name: "Salesforce",
    logoUrl: "https://www.salesforce.com/news/wp-content/uploads/sites/3/2021/05/Salesforce-logo.png",
  },
  {
    crm_type: "zoho",
    name: "Zoho",
    logoUrl: "https://www.zoho.com/branding/images/zoho-logo-512px.png",
  },
  {
    crm_type: "velocify",
    name: "Velocify",
    logoUrl: "https://www.velocify.com/wp-content/uploads/2014/09/velocify-logo.png",
  },
];

function backendBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  return raw ? raw.replace(/\/$/, "") : API_URL;
}

async function authedJsonFetch<T>(
  inputUrl: string,
  init: RequestInit
): Promise<{ data: T | null; error: string | null }> {
  try {
    const token = await waitForSessionAccessToken();
    if (!token) return { data: null, error: MSG_SESSION };
    const res = await fetch(inputUrl, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
        ...(init.body != null ? { "Content-Type": "application/json" } : {}),
      },
    });
    const body = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      const msg =
        body && typeof body === "object"
          ? body?.error?.message ?? body?.error ?? body?.message
          : null;
      return { data: null, error: typeof msg === "string" && msg ? msg : `Request failed: ${res.status}` };
    }
    return { data: (body ?? null) as T, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "Request failed" };
  }
}

function CrmConnectionsPanel() {
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<CrmConnection[]>([]);
  const [apiKeys, setApiKeys] = useState<Record<CrmType, string>>({
    hubspot: "",
    gohighlevel: "",
    salesforce: "",
    zoho: "",
    velocify: "",
  });
  const [messages, setMessages] = useState<Record<CrmType, { ok: boolean; text: string } | null>>({
    hubspot: null,
    gohighlevel: null,
    salesforce: null,
    zoho: null,
    velocify: null,
  });
  const [busy, setBusy] = useState<Record<CrmType, boolean>>({
    hubspot: false,
    gohighlevel: false,
    salesforce: false,
    zoho: false,
    velocify: false,
  });

  const base = backendBaseUrl();

  const connectedByType = useMemo(() => {
    const map = new Map<CrmType, CrmConnection>();
    connections.forEach((c) => map.set(c.crm_type, c));
    return map;
  }, [connections]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await authedJsonFetch<{ ok: boolean; items: CrmConnection[] }>(
      `${base}/api/crm/connections`,
      { method: "GET" }
    );
    if (error) {
      // show a global-ish message per CRM so user sees something
      setMessages((prev) => {
        const next = { ...prev };
        CRM_OPTIONS.forEach((o) => {
          next[o.crm_type] = { ok: false, text: error };
        });
        return next;
      });
      setConnections([]);
    } else {
      setConnections(Array.isArray(data?.items) ? data!.items : []);
    }
    setLoading(false);
  }, [base]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function connect(crm_type: CrmType) {
    const api_key = (apiKeys[crm_type] ?? "").trim();
    if (!api_key) {
      setMessages((p) => ({ ...p, [crm_type]: { ok: false, text: "API key is required" } }));
      return;
    }
    setBusy((p) => ({ ...p, [crm_type]: true }));
    setMessages((p) => ({ ...p, [crm_type]: null }));

    const { error } = await authedJsonFetch<{ ok: boolean }>(`${base}/api/crm/connections`, {
      method: "POST",
      body: JSON.stringify({ crm_type, api_key }),
    });

    if (error) {
      setMessages((p) => ({ ...p, [crm_type]: { ok: false, text: error } }));
      setBusy((p) => ({ ...p, [crm_type]: false }));
      return;
    }

    setMessages((p) => ({ ...p, [crm_type]: { ok: true, text: "Connected" } }));
    await refresh();
    setBusy((p) => ({ ...p, [crm_type]: false }));
  }

  async function disconnect(crm_type: CrmType) {
    setBusy((p) => ({ ...p, [crm_type]: true }));
    setMessages((p) => ({ ...p, [crm_type]: null }));

    const { error } = await authedJsonFetch<{ ok: boolean }>(
      `${base}/api/crm/connections/${crm_type}`,
      { method: "DELETE" }
    );

    if (error) {
      setMessages((p) => ({ ...p, [crm_type]: { ok: false, text: error } }));
      setBusy((p) => ({ ...p, [crm_type]: false }));
      return;
    }

    setMessages((p) => ({ ...p, [crm_type]: { ok: true, text: "Disconnected" } }));
    await refresh();
    setBusy((p) => ({ ...p, [crm_type]: false }));
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
      <div className="space-y-1">
        <div className="text-sm font-semibold">Connect Your CRM</div>
        <p className="text-xs text-gray-500">
          Connect a CRM to enable sync and integrations.
        </p>
      </div>

      {loading ? <div className="text-sm text-gray-500">Loading…</div> : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {CRM_OPTIONS.map((crm) => {
          const connected = connectedByType.get(crm.crm_type) != null;
          const msg = messages[crm.crm_type];
          const isBusy = busy[crm.crm_type];

          return (
            <div
              key={crm.crm_type}
              className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <img
                    src={crm.logoUrl}
                    alt={`${crm.name} logo`}
                    className="w-8 h-8 object-contain rounded"
                  />
                  <div className="space-y-1">
                    <div className="text-sm text-gray-200">{crm.name}</div>
                    <div className="flex items-center gap-2 text-xs">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-gray-600"}`}
                        aria-hidden
                      />
                      <span className={connected ? "text-emerald-400/90" : "text-gray-500"}>
                        {connected ? "Connected" : "Not connected"}
                      </span>
                    </div>
                  </div>
                </div>

                {connected ? (
                  <div className="text-xs font-medium text-emerald-400/90">Connected ✓</div>
                ) : null}
              </div>

              {!connected ? (
                <div className="space-y-2">
                  <input
                    value={apiKeys[crm.crm_type]}
                    onChange={(e) =>
                      setApiKeys((p) => ({ ...p, [crm.crm_type]: e.target.value }))
                    }
                    placeholder="API key"
                    className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-2 text-sm text-gray-100 outline-none focus:border-emerald-500/40"
                  />
                  <button
                    type="button"
                    onClick={() => void connect(crm.crm_type)}
                    disabled={isBusy}
                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-60"
                  >
                    {isBusy ? "Connecting…" : "Connect"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void disconnect(crm.crm_type)}
                  disabled={isBusy}
                  className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-sm font-medium text-gray-200 transition hover:bg-white/[0.1] disabled:opacity-60"
                >
                  {isBusy ? "Disconnecting…" : "Disconnect"}
                </button>
              )}

              {msg ? (
                <div className={msg.ok ? "text-xs text-emerald-400/90" : "text-xs text-red-300/90"}>
                  {msg.text}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
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
  const [userEmail, setUserEmail] = useState<string>("");

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
        setUserEmail(data.user?.email ?? "");
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

      <CrmConnectionsPanel />
    </div>
  );
}

