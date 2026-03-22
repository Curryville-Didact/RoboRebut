"use client";

import { useState } from "react";
import { API_URL } from "@/lib/env";
import { ResponseCard } from "@/components/ResponseCard";
import { ToneSwitcher } from "@/components/ToneSwitcher";
import { InsightPanel } from "@/components/InsightPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

type RebuttalOption = {
  rank: number;
  text: string;
  tone: string;
  framework: string;
  confidence: number;
};

type FormattedResponse = {
  response: {
    primary: string;
    alternatives: string[];
    tone: string;
    confidence: number;
  };
  delivery: {
    mode: "suggestion" | "assist" | "auto";
    editable: boolean;
  };
  metadata: {
    objection_type: string;
    strategy: string;
    session_id: string;
    raw_input: string;
    intent?: string;
    emotional_tone?: string;
    urgency?: string;
    classification_confidence?: number;
  };
  rebuttals: RebuttalOption[];
};

type StreamEntry = {
  id: string;
  text: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready");
  const [stream, setStream] = useState<StreamEntry[]>([]);

  // Phase 2.3 state
  const [selectedTone, setSelectedTone] = useState("consultative");
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [lastInput, setLastInput] = useState("");
  const [formattedResponse, setFormattedResponse] =
    useState<FormattedResponse | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // ─── Submit objection ───────────────────────────────────────────────────────

  async function sendMessage() {
    const trimmed = input.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setFormattedResponse(null);
    setLastInput(trimmed);
    setStream([{ id: makeId(), text: `sent: ${trimmed}` }]);
    setStatus("Analyzing…");
    setInput("");

    try {
      const res = await fetch(`${API_URL}/api/rebuttal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_input: trimmed,
          category: "other",
          tone_override: selectedTone,
        }),
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        throw new Error(
          `Request failed (${res.status}): ${bodyText || res.statusText}`
        );
      }

      const data = (await res.json()) as FormattedResponse;
      setFormattedResponse(data);
      setSessionId(data.metadata.session_id);
      setStream((prev) => [
        ...prev,
        { id: makeId(), text: `received: ${data.rebuttals.length} ranked rebuttals` },
      ]);
      setStatus("Done");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Request failed";
      setError(message);
      setStatus("Error");
      setStream((prev) => [...prev, { id: makeId(), text: `error: ${message}` }]);
    } finally {
      setLoading(false);
    }
  }

  // ─── Tone change → regenerate ───────────────────────────────────────────────

  async function handleToneSelect(tone: string) {
    setSelectedTone(tone);

    if (!lastInput) return; // nothing submitted yet

    setLoading(true);
    setError(null);
    setStatus(`Regenerating (${tone})…`);

    try {
      const res = await fetch(`${API_URL}/api/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_input: lastInput,
          tone_override: tone,
          session_id: sessionId,
        }),
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        throw new Error(
          `Regenerate failed (${res.status}): ${bodyText || res.statusText}`
        );
      }

      const data = (await res.json()) as FormattedResponse;
      setFormattedResponse(data);
      setStream((prev) => [
        ...prev,
        { id: makeId(), text: `regenerated with tone: ${tone}` },
      ]);
      setStatus("Done");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Regenerate failed";
      setError(message);
      setStatus("Error");
    } finally {
      setLoading(false);
    }
  }

  // ─── Copy helper ────────────────────────────────────────────────────────────

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(text);
    setTimeout(() => setCopied(null), 2000);
  }

  // ─── Keyboard ───────────────────────────────────────────────────────────────

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") sendMessage();
  }

  // ─── Derived ────────────────────────────────────────────────────────────────

  const primaryRebuttal = formattedResponse?.rebuttals.find((r) => r.rank === 1);
  const alternativeRebuttals =
    formattedResponse?.rebuttals.filter((r) => r.rank !== 1) ?? [];

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-8">
        {/* Header */}
        <div className="space-y-1 text-center">
          <h1 className="text-4xl font-bold tracking-tight">RoboRebut</h1>
          <p className="text-sm text-gray-400">{status}</p>
        </div>

        {/* Input */}
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Type an objection — e.g. "This is too expensive"'
            disabled={loading}
            className="flex-1 rounded-lg border border-white/40 bg-transparent px-4 py-3 text-white outline-none placeholder:text-gray-500 disabled:opacity-60"
          />
          <button
            onClick={sendMessage}
            disabled={loading}
            className="rounded-lg border border-white/40 px-5 py-3 font-semibold transition hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "…" : "Send"}
          </button>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {copied && (
          <p className="text-center text-xs text-green-400">Copied to clipboard!</p>
        )}

        {/* Tone Switcher */}
        <div>
          <p className="mb-2 text-xs uppercase tracking-widest text-gray-500">
            Tone
          </p>
          <ToneSwitcher
            selectedTone={selectedTone}
            onSelect={handleToneSelect}
            disabled={loading}
          />
        </div>

        {/* Insight Panel */}
        {formattedResponse && (
          <InsightPanel
            objectionType={formattedResponse.metadata.objection_type}
            strategy={formattedResponse.metadata.strategy}
            confidence={formattedResponse.metadata.classification_confidence}
            deliveryMode={formattedResponse.delivery.mode}
            intent={formattedResponse.metadata.intent}
            emotionalTone={formattedResponse.metadata.emotional_tone}
            urgency={formattedResponse.metadata.urgency}
          />
        )}

        {/* Response Cards */}
        {formattedResponse && (
          <div className="flex flex-col gap-4">
            {/* Primary — full width */}
            {primaryRebuttal && (
              <ResponseCard
                key={`primary-${primaryRebuttal.rank}`}
                rank={primaryRebuttal.rank}
                text={primaryRebuttal.text}
                tone={primaryRebuttal.tone}
                framework={primaryRebuttal.framework}
                confidence={primaryRebuttal.confidence}
                isPrimary
                onCopy={handleCopy}
                onRegenerate={() =>
                  handleToneSelect(selectedTone)
                }
              />
            )}

            {/* Alternatives — 2 column */}
            {alternativeRebuttals.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                {alternativeRebuttals.map((r) => (
                  <ResponseCard
                    key={`alt-${r.rank}`}
                    rank={r.rank}
                    text={r.text}
                    tone={r.tone}
                    framework={r.framework}
                    confidence={r.confidence}
                    onCopy={handleCopy}
                    onRegenerate={() => handleToneSelect(selectedTone)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Debug / stream section */}
        {stream.length > 0 && (
          <section className="rounded-xl border border-white/10 p-4">
            <p className="mb-2 text-xs uppercase tracking-widest text-gray-500">
              Stream Log
            </p>
            <div className="space-y-1">
              {stream.map((entry) => (
                <pre
                  key={entry.id}
                  className="whitespace-pre-wrap break-words font-mono text-xs text-gray-400"
                >
                  {entry.text}
                </pre>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
