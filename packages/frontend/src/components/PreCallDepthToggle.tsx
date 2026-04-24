"use client";

import type { PreCallDepth } from "@/types/preCallDepth";

const BTN =
  "rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-50";
const INACTIVE = "border border-white/15 bg-white/5 text-gray-400 hover:bg-white/10";
const ACTIVE = "border border-sky-500/40 bg-sky-500/15 text-sky-100";

export function PreCallDepthToggle({
  depth,
  onChange,
  disabled,
}: {
  depth: PreCallDepth;
  onChange: (d: PreCallDepth) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Pre-call depth
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          className={`${BTN} ${depth === "instant" ? ACTIVE : INACTIVE}`}
          onClick={() => onChange("instant")}
        >
          Instant
        </button>
        <button
          type="button"
          disabled={disabled}
          className={`${BTN} ${depth === "deep" ? ACTIVE : INACTIVE}`}
          onClick={() => onChange("deep")}
        >
          Deep
        </button>
      </div>
      <p className="text-[11px] leading-snug text-gray-600">
        Instant: faster, tighter prep. Deep: full breakdown (unchanged).
      </p>
    </div>
  );
}
