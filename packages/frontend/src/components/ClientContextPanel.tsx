"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/env";
import {
  cleanClientContextPayload,
  EMPTY_CLIENT_CONTEXT,
  mergeSavedClientContext,
  type ClientContext,
} from "@/lib/clientContext";

export type ClientContextPanelProps = {
  conversationId: string;
  savedClientContext: ClientContext | null;
  getAccessToken: () => Promise<string | null>;
  onClientContextSaved: (client_context: ClientContext | null) => void;
};

const labelClass = "block text-xs font-medium text-gray-400";
const inputClass =
  "mt-1 w-full rounded-lg border border-white/20 bg-transparent px-2 py-1.5 text-sm text-white outline-none placeholder:text-gray-600 focus:border-white/50";
const textareaClass =
  "mt-1 w-full min-h-[64px] rounded-lg border border-white/20 bg-transparent px-2 py-1.5 text-sm text-white outline-none placeholder:text-gray-600 focus:border-white/50";

export function ClientContextPanel({
  conversationId,
  savedClientContext,
  getAccessToken,
  onClientContextSaved,
}: ClientContextPanelProps) {
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState<ClientContext>(() =>
    mergeSavedClientContext(savedClientContext)
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setCtx(mergeSavedClientContext(savedClientContext));
  }, [conversationId, savedClientContext]);

  const hasAny =
    savedClientContext != null &&
    cleanClientContextPayload(mergeSavedClientContext(savedClientContext)) !=
      null;

  async function handleSave() {
    setSaveError(null);
    const cleaned = cleanClientContextPayload(ctx);
    const token = await getAccessToken();
    if (!token) {
      setSaveError("Session expired. Refresh the page.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ client_context: cleaned }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        client_context?: ClientContext | null;
      };
      if (!res.ok) {
        setSaveError(
          typeof payload.error === "string"
            ? payload.error
            : "Could not save client context."
        );
        return;
      }
      const next = payload.client_context ?? null;
      onClientContextSaved(next);
      setCtx(mergeSavedClientContext(next));
    } catch {
      setSaveError("Could not save client context.");
    } finally {
      setSaving(false);
    }
  }

  const patch = (partial: Partial<ClientContext>) => {
    setCtx((prev) => ({ ...prev, ...partial }));
  };

  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-gray-500 transition hover:text-white"
      >
        {hasAny ? "Edit Client Context" : "Add Client Context"}
        <span className="ml-1 text-gray-600">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Client Context</h3>
            <p className="mt-1 text-xs text-gray-500">
              Business, decision context, pain points, and account notes.
            </p>
          </div>

          <label className={labelClass}>
            Business name
            <input
              type="text"
              value={ctx.businessName ?? ""}
              onChange={(e) => patch({ businessName: e.target.value })}
              className={inputClass}
              placeholder="e.g. Dave’s Restaurant"
              autoComplete="off"
            />
          </label>

          <label className={labelClass}>
            Industry
            <input
              type="text"
              value={ctx.industry ?? ""}
              onChange={(e) => patch({ industry: e.target.value })}
              className={inputClass}
              placeholder="Restaurant, trucking, retail…"
              autoComplete="off"
            />
          </label>

          <label className={labelClass}>
            Current provider
            <input
              type="text"
              value={ctx.currentProvider ?? ""}
              onChange={(e) => patch({ currentProvider: e.target.value })}
              className={inputClass}
              placeholder="Lender, bank, processor…"
              autoComplete="off"
            />
          </label>

          <label className={labelClass}>
            Monthly revenue (plain text)
            <input
              type="text"
              value={ctx.monthlyRevenueText ?? ""}
              onChange={(e) => patch({ monthlyRevenueText: e.target.value })}
              className={inputClass}
              placeholder="As the merchant described it"
              autoComplete="off"
            />
          </label>

          <label className={labelClass}>
            Pain points
            <textarea
              value={ctx.painPoints ?? ""}
              onChange={(e) => patch({ painPoints: e.target.value })}
              className={textareaClass}
              placeholder="Operational or cash-flow pressure"
              rows={2}
            />
          </label>

          <label className={labelClass}>
            Decision-maker
            <input
              type="text"
              value={ctx.decisionMaker ?? ""}
              onChange={(e) => patch({ decisionMaker: e.target.value })}
              className={inputClass}
              placeholder="Owner, CFO, office manager…"
              autoComplete="off"
            />
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-300">
            <input
              type="checkbox"
              checked={ctx.partnerInvolved === true}
              onChange={(e) => patch({ partnerInvolved: e.target.checked })}
              className="rounded border-white/30 bg-transparent"
            />
            Partner / co-owner involved in the decision
          </label>

          <label className={labelClass}>
            Urgency / timeline
            <input
              type="text"
              value={ctx.urgencyTimeline ?? ""}
              onChange={(e) => patch({ urgencyTimeline: e.target.value })}
              className={inputClass}
              placeholder="Now, this week, this month…"
              autoComplete="off"
            />
          </label>

          <label className={labelClass}>
            Trust / skepticism flags
            <textarea
              value={ctx.trustFlags ?? ""}
              onChange={(e) => patch({ trustFlags: e.target.value })}
              className={textareaClass}
              placeholder="Prior bad experience, fear of trap, competitor loyalty…"
              rows={2}
            />
          </label>

          <label className={labelClass}>
            Stated objections
            <textarea
              value={ctx.statedObjections ?? ""}
              onChange={(e) => patch({ statedObjections: e.target.value })}
              className={textareaClass}
              placeholder="Objections already surfaced"
              rows={2}
            />
          </label>

          <label className={labelClass}>
            Notes
            <textarea
              value={ctx.notes ?? ""}
              onChange={(e) => patch({ notes: e.target.value })}
              className={textareaClass}
              placeholder="Freeform account notes"
              rows={2}
            />
          </label>

          {saveError && <p className="text-xs text-red-400">{saveError}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-lg border border-white/40 px-3 py-1.5 text-xs font-medium transition hover:bg-white hover:text-black disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save Client Context"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCtx({ ...EMPTY_CLIENT_CONTEXT });
                setSaveError(null);
              }}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-gray-400 transition hover:border-white/30 hover:text-white"
            >
              Clear form
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
