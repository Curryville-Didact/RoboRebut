"use client";

import type { CoachReplyMode } from "@/types/coachReplyMode";

const BTN =
  "rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-50";
const INACTIVE = "border border-white/15 bg-white/5 text-gray-400 hover:bg-white/10";
const ACTIVE = "border border-emerald-500/40 bg-emerald-500/15 text-emerald-100";

export function CoachModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: CoachReplyMode;
  onChange: (m: CoachReplyMode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Mode
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          className={`${BTN} ${mode === "precall" ? ACTIVE : INACTIVE}`}
          onClick={() => onChange("precall")}
        >
          Pre-Call Breakdown
        </button>
        <button
          type="button"
          disabled={disabled}
          className={`${BTN} ${mode === "live" ? ACTIVE : INACTIVE}`}
          onClick={() => onChange("live")}
        >
          Live Call
        </button>
      </div>
    </div>
  );
}
