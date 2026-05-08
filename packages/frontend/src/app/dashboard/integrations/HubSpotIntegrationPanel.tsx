"use client";

import { useState } from "react";
import { syncHubSpotContactAction } from "./actions";

export type HubSpotIntegrationPanelProps = {
  userId: string;
  email: string;
};

export function HubSpotIntegrationPanel({
  userId,
  email,
}: HubSpotIntegrationPanelProps) {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const canSync = email.trim().length > 0;

  async function handleSync() {
    setLoading(true);
    setFeedback(null);
    try {
      const result = await syncHubSpotContactAction({
        userId,
        email: email.trim(),
        name: email.trim(),
      });
      if (!result.ok) {
        setFeedback({ kind: "error", text: result.error });
        return;
      }
      setConnected(true);
      setFeedback({
        kind: "success",
        text: "Your contact was synced to HubSpot.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-xl border border-white/[0.08] bg-black/70 p-6 backdrop-blur supports-[backdrop-filter]:bg-black/50">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
        Connect HubSpot
      </h3>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-orange-500 text-xl font-bold text-white shadow-lg shadow-orange-900/30"
            aria-hidden
          >
            H
          </div>
          <div className="min-w-0 space-y-2">
            <p className="text-base font-medium text-white">HubSpot CRM</p>
            <p className="text-sm text-gray-500">
              Sync your profile as a HubSpot contact for CRM workflows.
            </p>
            <div className="flex items-center gap-2 text-sm">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  connected ? "bg-emerald-500" : "bg-gray-600"
                }`}
                aria-hidden
              />
              <span className={connected ? "text-emerald-400/90" : "text-gray-500"}>
                {connected ? "Connected" : "Not connected"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          <button
            type="button"
            disabled={!canSync || loading}
            onClick={() => void handleSync()}
            className="rounded-lg border border-white/20 bg-white/[0.08] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Syncing…" : "Sync My Contact"}
          </button>
          {!canSync ? (
            <p className="max-w-xs text-xs text-amber-400/90 sm:text-right">
              Add an email to your account to sync with HubSpot.
            </p>
          ) : null}
        </div>
      </div>
      {feedback ? (
        <p
          className={
            feedback.kind === "success"
              ? "mt-4 text-sm text-emerald-400/90"
              : "mt-4 text-sm text-red-300/90"
          }
          role="status"
        >
          {feedback.text}
        </p>
      ) : null}
    </section>
  );
}
