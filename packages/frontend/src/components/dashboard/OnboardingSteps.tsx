"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const KEY = "rr_onboarding_dismissed_v1";

export type OnboardingStepsProps = {
  /** Caller indicates whether the user has completed the discovery-call upload path (e.g. `conversations.length > 0`). */
  hasUploadedCall: boolean;
};

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <polyline
        points="5.5 10.25 8.75 13.5 14.75 6.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StepBadge({
  stepNumber,
  completed,
  active,
}: {
  stepNumber: number;
  completed: boolean;
  active: boolean;
}) {
  if (completed) {
    return (
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/45"
        aria-hidden
      >
        <CheckIcon className="h-4 w-4" />
      </div>
    );
  }

  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums transition ${
        active
          ? "bg-emerald-500/15 text-emerald-200 ring-2 ring-emerald-500/55 shadow-[0_0_20px_rgba(16,185,129,0.12)]"
          : "bg-white/[0.06] text-gray-500 ring-1 ring-white/10"
      }`}
      aria-hidden
    >
      {stepNumber}
    </div>
  );
}

export function OnboardingSteps({ hasUploadedCall }: OnboardingStepsProps) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(KEY) === "true");
    } catch {
      setDismissed(false);
    }
  }, []);

  if (dismissed) return null;

  const step1Done = hasUploadedCall;
  const step2Done = hasUploadedCall;
  const step3Done = hasUploadedCall;

  const step1Active = !hasUploadedCall;
  const step2Active = false;
  const step3Active = false;

  return (
    <div className="rounded-xl border border-white/10 bg-black/40 px-5 py-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Getting started
          </div>
          <div className="mt-1 text-sm font-semibold text-white">Your onboarding checklist</div>
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
          className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-gray-200 transition hover:bg-white/[0.06]"
        >
          Dismiss
        </button>
      </div>

      <div className="relative mt-5 space-y-0">
        {/* Vertical connector between badges */}
        <div
          className="pointer-events-none absolute left-[17px] top-9 bottom-9 w-px bg-gradient-to-b from-white/15 via-white/10 to-transparent"
          aria-hidden
        />

        <div className="relative space-y-4">
          {/* Step 1 */}
          <div
            className={`relative flex gap-4 rounded-lg border px-3 py-3 transition ${
              step1Active && !step1Done
                ? "border-emerald-500/35 bg-emerald-500/[0.06]"
                : "border-white/[0.08] bg-white/[0.02]"
            }`}
          >
            <StepBadge stepNumber={1} completed={step1Done} active={step1Active && !step1Done} />
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="text-sm font-semibold text-white">Upload your first discovery call</div>
              <p className="mt-1 text-sm leading-relaxed text-gray-400">
                Record your prospect intro call and let RoboRebut extract their profile automatically.
              </p>
              <div className="mt-2">
                <Link
                  href="/dashboard/calls"
                  className="inline-flex items-center text-sm font-medium text-emerald-400/95 underline-offset-2 transition hover:text-emerald-300 hover:underline"
                >
                  Go to Calls →
                </Link>
              </div>
            </div>
          </div>

          {/* Step 2 */}
          <div
            className={`relative flex gap-4 rounded-lg border px-3 py-3 transition ${
              step2Active && !step2Done
                ? "border-emerald-500/35 bg-emerald-500/[0.06]"
                : "border-white/[0.08] bg-white/[0.02]"
            }`}
          >
            <StepBadge stepNumber={2} completed={step2Done} active={step2Active && !step2Done} />
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="text-sm font-semibold text-white">Review your client profile</div>
              <p className="mt-1 text-sm leading-relaxed text-gray-400">
                Check that pain points, objections, and deal type were detected correctly. Edit if
                needed.
              </p>
              <div className="mt-2">
                <span className="text-sm text-gray-500">Done after Step 1</span>
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div
            className={`relative flex gap-4 rounded-lg border px-3 py-3 transition ${
              step3Active && !step3Done
                ? "border-emerald-500/35 bg-emerald-500/[0.06]"
                : "border-white/[0.08] bg-white/[0.02]"
            }`}
          >
            <StepBadge stepNumber={3} completed={step3Done} active={step3Active && !step3Done} />
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="text-sm font-semibold text-white">Run your first live coaching session</div>
              <p className="mt-1 text-sm leading-relaxed text-gray-400">
                When you&apos;re on the phone with the client, type their objection and get a
                real-time rebuttal.
              </p>
              <div className="mt-2">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center text-sm font-medium text-emerald-400/95 underline-offset-2 transition hover:text-emerald-300 hover:underline"
                >
                  Start a session →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
