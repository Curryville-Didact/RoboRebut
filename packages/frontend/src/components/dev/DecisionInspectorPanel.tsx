"use client";

import { useEffect, useMemo, useState } from "react";

export type DecisionIntelligenceMeta = {
  selectedPatternKey: string | null;
  selectedSource: string | null;
  selectedScore: number | null;
  runnerUpPatternKey: string | null;
  runnerUpSource: string | null;
  runnerUpScore: number | null;
  scoreGap: number | null;
  candidateCount: number;
  uniquePatternKeyCount: number;
  decisionReasons: string[];
  antiRepeatApplied: boolean;
  antiRepeatReason: string | null;
  confidenceSupport: number | null;
  dvlApplied: boolean;
  variantIndex: number | null;
};

export function isInspectorEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem("rr_debug_inspector") === "true";
}

export function DecisionInspectorPanel({
  decision,
  scoredCandidates,
}: {
  decision: DecisionIntelligenceMeta | null | undefined;
  scoredCandidates?: Array<{
    patternKey: string;
    score: number;
    source?: string;
    reasons?: string[];
  }>;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as any).toggleInspector = () => {
      const curr = window.localStorage.getItem("rr_debug_inspector") === "true";
      window.localStorage.setItem("rr_debug_inspector", (!curr).toString());
      window.location.reload();
    };
  }, []);

  if (!decision) return null;

  const top = useMemo(
    () => scoredCandidates?.slice(0, 3) ?? [],
    [scoredCandidates]
  );

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-semibold text-gray-400 transition hover:text-gray-200"
      >
        Inspect Decision
      </button>

      {!open ? null : (
        <div className="mt-3 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="text-xs uppercase text-neutral-400">Winner summary</div>
              <div className="space-y-1">
                <div className="font-mono text-xs text-green-400">
                  {decision.selectedPatternKey ?? "null"}
                </div>
                <div className="text-xs text-neutral-300">
                  source:{" "}
                  <span className="font-mono text-xs text-green-400">
                    {decision.selectedSource ?? "null"}
                  </span>
                  {" · "}
                  score:{" "}
                  <span className="font-mono text-xs text-green-400">
                    {decision.selectedScore ?? "null"}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs uppercase text-neutral-400">
                Competition snapshot
              </div>
              <div className="space-y-1 text-xs text-neutral-300">
                <div>
                  runner-up:{" "}
                  <span className="font-mono text-xs text-yellow-400">
                    {decision.runnerUpPatternKey ?? "null"}
                  </span>
                </div>
                <div>
                  runner-up score:{" "}
                  <span className="font-mono text-xs text-yellow-400">
                    {decision.runnerUpScore ?? "null"}
                  </span>
                  {" · "}
                  gap:{" "}
                  <span className="font-mono text-xs text-yellow-400">
                    {decision.scoreGap ?? "null"}
                  </span>
                </div>
                <div>
                  candidates:{" "}
                  <span className="font-mono text-xs text-green-400">
                    {decision.candidateCount}
                  </span>
                  {" · "}
                  unique keys:{" "}
                  <span className="font-mono text-xs text-green-400">
                    {decision.uniquePatternKeyCount}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs uppercase text-neutral-400">Decision reasons</div>
              <div className="flex flex-wrap gap-2">
                {(decision.decisionReasons ?? []).map((r) => (
                  <span
                    key={r}
                    className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-200"
                  >
                    {r}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs uppercase text-neutral-400">Flags</div>
              <div className="space-y-1 text-xs text-neutral-300">
                <div>
                  antiRepeatApplied:{" "}
                  <span className="font-mono text-xs text-green-400">
                    {String(decision.antiRepeatApplied)}
                  </span>
                </div>
                <div>
                  antiRepeatReason:{" "}
                  <span className="font-mono text-xs text-green-400">
                    {decision.antiRepeatReason ?? "null"}
                  </span>
                </div>
                <div>
                  confidenceSupport:{" "}
                  <span className="font-mono text-xs text-green-400">
                    {decision.confidenceSupport ?? "null"}
                  </span>
                </div>
                <div>
                  dvlApplied:{" "}
                  <span className="font-mono text-xs text-green-400">
                    {String(decision.dvlApplied)}
                  </span>
                </div>
                <div>
                  variantIndex:{" "}
                  <span className="font-mono text-xs text-green-400">
                    {decision.variantIndex ?? "null"}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs uppercase text-neutral-400">Top candidates</div>
              {top.length === 0 ? (
                <div className="text-xs text-neutral-500">(none)</div>
              ) : (
                <div className="space-y-2">
                  {top.map((c) => (
                    <div key={`${c.patternKey}|${c.source ?? ""}`} className="space-y-1">
                      <div className="font-mono text-xs text-green-400">
                        {c.patternKey}
                      </div>
                      <div className="text-xs text-neutral-300">
                        score:{" "}
                        <span className="font-mono text-xs text-green-400">
                          {c.score}
                        </span>
                        {" · "}
                        source:{" "}
                        <span className="font-mono text-xs text-green-400">
                          {c.source ?? "unknown"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

