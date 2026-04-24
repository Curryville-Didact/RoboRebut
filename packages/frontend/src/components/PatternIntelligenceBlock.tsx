"use client";

import type { AssistantMessageIntel } from "@/lib/patternIntel";

function confidenceBadgeClass(level: "high" | "medium" | "low"): string {
  switch (level) {
    case "high":
      return "border-white/15 bg-white/[0.06] text-gray-200";
    case "medium":
      return "border-amber-500/35 bg-amber-500/10 text-amber-100";
    case "low":
      return "border-white/15 bg-white/[0.04] text-gray-300";
    default: {
      const _x: never = level;
      return _x;
    }
  }
}

/** User-facing state — maps from backend confidence tier without implying failure. */
function confidenceLabel(level: "high" | "medium" | "low"): string {
  switch (level) {
    case "high":
      return "Strong signal";
    case "medium":
      return "Refining";
    case "low":
      return "Learning";
    default: {
      const _x: never = level;
      return _x;
    }
  }
}

type Props = {
  intel: AssistantMessageIntel;
};

/**
 * Meta / coaching context — secondary (white/gray). Actionable rebuttal copy lives in the parent card body (emerald).
 */
export function PatternIntelligenceBlock({ intel }: Props) {
  const pi = intel.patternInsights;
  const explanation = intel.explanation?.trim();
  const coachLine = intel.coachInsight?.trim();

  const hasPatternBlock =
    !!pi?.confidenceLevel ||
    (pi?.reason && pi.reason.trim().length > 0) ||
    (explanation && explanation.length > 0) ||
    (pi?.note && pi.note.trim().length > 0) ||
    (pi?.stats &&
      (typeof pi.stats.saveRate === "number" ||
        typeof pi.stats.sampleSize === "number"));

  if (!hasPatternBlock && !coachLine) return null;

  return (
    <div className="mb-3 space-y-2">
      {hasPatternBlock && (
        <div className="rounded-lg border border-white/[0.06] bg-black/[0.08] px-3 py-2.5">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500/90">
            Pattern intelligence
          </p>

          <div className="space-y-2 text-xs leading-relaxed text-gray-400">
            {pi?.confidenceLevel && (
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${confidenceBadgeClass(
                    pi.confidenceLevel
                  )}`}
                >
                  {confidenceLabel(pi.confidenceLevel)}
                </span>
              </div>
            )}

            {pi?.reason && pi.reason.trim().length > 0 && (
              <p>
                <span className="text-gray-500">Why this response: </span>
                {pi.reason.trim()}
              </p>
            )}

            {explanation && explanation.length > 0 && (
              <p>
                <span className="text-gray-500">How it fits: </span>
                {explanation}
              </p>
            )}

            {pi?.note && pi.note.trim().length > 0 && (
              <p>
                <span className="text-gray-500">Note: </span>
                {pi.note.trim()}
              </p>
            )}

            {pi?.stats &&
              (typeof pi.stats.saveRate === "number" ||
                typeof pi.stats.sampleSize === "number") && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-white/[0.05] pt-2 text-[11px] text-gray-400">
                  {typeof pi.stats.saveRate === "number" && (
                    <span>
                      Save rate:{" "}
                      <span className="font-medium text-gray-500">
                        {Math.round(pi.stats.saveRate * 100)}%
                      </span>
                    </span>
                  )}
                  {typeof pi.stats.sampleSize === "number" && (
                    <span>
                      Sample size:{" "}
                      <span className="font-medium text-gray-500">
                        {pi.stats.sampleSize}
                      </span>
                    </span>
                  )}
                </div>
              )}
          </div>
        </div>
      )}

      {coachLine && (
        <div className="rounded-lg border border-white/[0.06] bg-black/[0.06] px-3 py-2">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500/90">
            Coach insight
          </p>
          <p className="text-xs leading-relaxed text-gray-400">{coachLine}</p>
        </div>
      )}
    </div>
  );
}
