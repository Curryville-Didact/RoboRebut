"use client";

import { useEffect, useState } from "react";

const KEY = "rr_onboarding_dismissed_v1";

export function OnboardingSteps() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(KEY) === "true");
    } catch {
      setDismissed(false);
    }
  }, []);

  if (dismissed) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 px-5 py-4 text-left">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            First run
          </div>
          <div className="mt-1 text-sm font-semibold text-white">
            Get value in under 60 seconds
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            try {
              window.localStorage.setItem(KEY, "true");
            } catch {
              /* ignore */
            }
            setDismissed(true);
          }}
          className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-gray-200 hover:bg-white/[0.06]"
        >
          Dismiss
        </button>
      </div>

      <ol className="mt-3 space-y-2 text-sm text-gray-300">
        <li>
          <span className="text-gray-500">Step 1:</span> Start a conversation
        </li>
        <li>
          <span className="text-gray-500">Step 2:</span> Paste the objection
        </li>
        <li>
          <span className="text-gray-500">Step 3:</span> Generate the rebuttal
        </li>
        <li>
          <span className="text-gray-500">Step 4:</span> Save the strongest response
        </li>
      </ol>
    </div>
  );
}

