"use client";

import { useState } from "react";

type PipelinePayload = {
  normalized?: {
    text?: string;
    metadata?: {
      length?: number;
      hasQuestion?: boolean;
      sentimentHint?: string;
    };
  };
  classification?: {
    type?: string;
    confidence?: number;
    signals?: string[];
  };
  strategy?: {
    approach?: string;
    tone?: string;
    structure?: string[];
  };
  generated?: {
    reply?: string;
    followUps?: string[];
  };
  evaluation?: {
    score?: number;
    criteria?: {
      relevance?: number;
      toneMatch?: number;
      strategyAlignment?: number;
    };
    needsRetry?: boolean;
  };
  interaction?: {
    input?: string;
    output?: string;
    score?: number;
    timestamp?: number;
  };
};

type StreamEntry = {
  id: string;
  text: string;
};

function confidenceLabel(confidence?: number): string {
  if (typeof confidence !== "number") return "Unknown";
  if (confidence >= 0.9) return "High";
  if (confidence >= 0.75) return "Medium";
  return "Low";
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function Home() {
  const [status, setStatus] = useState("Ready");
  const [input, setInput] = useState("");
  const [stream, setStream] = useState<StreamEntry[]>([]);
  const [analysis, setAnalysis] = useState<PipelinePayload | null>(null);
  const [finalReply, setFinalReply] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001";

  type RebuttalApiResponse = {
    objection: string;
    classification: { category: string; confidence: number; signals?: string[] };
    strategy: { strategy: string; rationale: string };
    rebuttal: string;
  };

  async function sendMessage() {
    const trimmed = input.trim();

    if (!trimmed) {
      return;
    }

    setLoading(true);
    setError(null);

    setAnalysis(null);
    setFinalReply("");
    setStream([
      {
        id: makeId(),
        text: `sent: ${trimmed}`,
      },
    ]);
    setStatus("Analyzing...");
    setInput("");

    try {
      const res = await fetch(`${API_URL}/rebuttal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objection: trimmed }),
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        throw new Error(`Request failed (${res.status}): ${bodyText || res.statusText}`);
      }

      const data = (await res.json()) as RebuttalApiResponse;

      setAnalysis({
        classification: {
          type: data.classification.category,
          confidence: data.classification.confidence,
          signals: data.classification.signals ?? [],
        },
        strategy: {
          approach: data.strategy.strategy,
          tone: "—",
          structure: data.strategy.rationale ? [data.strategy.rationale] : [],
        },
        generated: {
          reply: data.rebuttal,
          followUps: [],
        },
        evaluation: {
          score: undefined,
          criteria: {},
          needsRetry: false,
        },
        interaction: {},
      });
      setFinalReply(data.rebuttal);
      setStream((prev) => [
        ...prev,
        { id: makeId(), text: `received: ${data.rebuttal}` },
      ]);
      setStatus("Done");
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Request failed";
      setError(message);
      setStatus("Error");
      setStream((prev) => [
        ...prev,
        { id: makeId(), text: `error: ${message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      sendMessage();
    }
  }

  const objectionType = analysis?.classification?.type ?? "—";
  const confidence = analysis?.classification?.confidence;
  const strategyApproach = analysis?.strategy?.approach ?? "—";
  const strategyTone = analysis?.strategy?.tone ?? "—";
  const reply = finalReply || analysis?.generated?.reply || "—";
  const followUps = analysis?.generated?.followUps ?? [];
  const score = analysis?.evaluation?.score;
  const signals = analysis?.classification?.signals ?? [];
  const structure = analysis?.strategy?.structure ?? [];

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-8">
        <div className="space-y-2 text-center">
          <h1 className="text-4xl font-bold">RoboRebut MVP</h1>
          <p className="text-lg text-gray-300">{status}</p>
        </div>

        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Type an objection, e.g. "This is too expensive"'
            className="flex-1 rounded-lg border border-white/60 bg-transparent px-4 py-3 text-white outline-none placeholder:text-gray-500"
          />
          <button
            onClick={sendMessage}
            disabled={loading}
            className="rounded-lg border border-white/60 px-5 py-3 font-semibold transition hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            Send
          </button>
        </div>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-white/20 p-5">
            <h2 className="mb-4 text-xl font-semibold">Operator View</h2>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-white/10 p-4">
                <p className="mb-1 text-xs uppercase tracking-wide text-gray-400">
                  Objection Type
                </p>
                <p className="text-lg font-semibold">{objectionType}</p>
              </div>

              <div className="rounded-lg border border-white/10 p-4">
                <p className="mb-1 text-xs uppercase tracking-wide text-gray-400">
                  Confidence
                </p>
                <p className="text-lg font-semibold">
                  {typeof confidence === "number"
                    ? `${confidence} (${confidenceLabel(confidence)})`
                    : "—"}
                </p>
              </div>

              <div className="rounded-lg border border-white/10 p-4">
                <p className="mb-1 text-xs uppercase tracking-wide text-gray-400">
                  Strategy
                </p>
                <p className="text-lg font-semibold">{strategyApproach}</p>
              </div>

              <div className="rounded-lg border border-white/10 p-4">
                <p className="mb-1 text-xs uppercase tracking-wide text-gray-400">
                  Tone
                </p>
                <p className="text-lg font-semibold">{strategyTone}</p>
              </div>

              <div className="rounded-lg border border-white/10 p-4 sm:col-span-2">
                <p className="mb-1 text-xs uppercase tracking-wide text-gray-400">
                  Evaluation Score
                </p>
                <p className="text-lg font-semibold">
                  {typeof score === "number" ? score : "—"}
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-lg border border-white/10 p-4">
              <p className="mb-2 text-xs uppercase tracking-wide text-gray-400">
                Final Reply
              </p>
              <p className="whitespace-pre-wrap text-base leading-7">{reply}</p>
            </div>

            <div className="mt-5 rounded-lg border border-white/10 p-4">
              <p className="mb-2 text-xs uppercase tracking-wide text-gray-400">
                Follow-Ups
              </p>
              {followUps.length === 0 ? (
                <p className="text-gray-400">No follow-ups yet.</p>
              ) : (
                <ul className="list-disc space-y-2 pl-5">
                  {followUps.map((item, index) => (
                    <li key={`followup-${index}-${item}`}>{item}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-white/10 p-4">
                <p className="mb-2 text-xs uppercase tracking-wide text-gray-400">
                  Classification Signals
                </p>
                {signals.length === 0 ? (
                  <p className="text-gray-400">No signals yet.</p>
                ) : (
                  <ul className="list-disc space-y-2 pl-5">
                    {signals.map((item, index) => (
                      <li key={`signal-${index}-${item}`}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-lg border border-white/10 p-4">
                <p className="mb-2 text-xs uppercase tracking-wide text-gray-400">
                  Strategy Structure
                </p>
                {structure.length === 0 ? (
                  <p className="text-gray-400">No strategy yet.</p>
                ) : (
                  <ul className="list-disc space-y-2 pl-5">
                    {structure.map((item, index) => (
                      <li key={`structure-${index}-${item}`}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-white/20 p-5">
            <h2 className="mb-4 text-xl font-semibold">Raw Stream</h2>

            {stream.length === 0 ? (
              <p className="text-gray-400">Waiting for messages...</p>
            ) : (
              <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-2">
                {stream.map((entry) => (
                  <pre
                    key={entry.id}
                    className="whitespace-pre-wrap break-words rounded-lg border border-white/10 p-3 font-mono text-sm"
                  >
                    {entry.text}
                  </pre>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="rounded-xl border border-white/20 p-5">
          <h2 className="mb-4 text-xl font-semibold">Raw Analysis Payload</h2>

          {!analysis ? (
            <p className="text-gray-400">No analysis received yet.</p>
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded-lg border border-white/10 p-4 font-mono text-sm">
              {JSON.stringify(analysis, null, 2)}
            </pre>
          )}
        </section>
      </div>
    </main>
  );
}