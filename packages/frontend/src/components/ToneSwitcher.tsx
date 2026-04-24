"use client";

import { UpgradeNudge } from "@/components/UpgradeNudge";
import type { ToneOption } from "@/lib/toneOptions";
import { getProCheckoutHref } from "@/lib/checkoutLinks";
import { usePathname, useSearchParams } from "next/navigation";

interface ToneSwitcherProps {
  selectedTone: string;
  onSelect: (tone: string) => void;
  disabled?: boolean;
  tones: ToneOption[];
  showLockedToneNudge?: boolean;
  onLockedToneClick?: (tone: string) => void;
  onDismissLockedToneNudge?: () => void;
  onLockedToneCtaClick?: () => void;
}

export function ToneSwitcher({
  selectedTone,
  onSelect,
  disabled = false,
  tones,
  showLockedToneNudge = false,
  onLockedToneClick,
  onDismissLockedToneNudge,
  onLockedToneCtaClick,
}: ToneSwitcherProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnTo = `${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ""}`;
  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.debug("[checkout] ToneSwitcher pro href", {
      returnTo,
      href: getProCheckoutHref(returnTo),
    });
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {tones.map((tone) => {
          const value = tone.value;
          const isSelected = selectedTone === value;
          return (
            <button
              key={tone.value}
              type="button"
              onClick={() => {
                if (disabled) return;
                if (tone.locked) {
                  onLockedToneClick?.(value);
                  return;
                }
                onSelect(value);
              }}
              disabled={disabled}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                isSelected
                  ? "border-white bg-white text-black"
                  : tone.locked
                    ? "border-emerald-500/30 text-emerald-200/80 hover:border-emerald-400/60"
                    : "border-white/30 text-white hover:border-white/60"
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {tone.label}
              {tone.locked ? " Pro" : ""}
            </button>
          );
        })}
      </div>

      <UpgradeNudge
        visible={showLockedToneNudge}
        title="Unlock Advanced Tone Control"
        body="Use Closer, Pressure, and Analytical modes to control conversations in real time."
        ctaLabel="Use Closer Mode"
        href={getProCheckoutHref(returnTo)}
        onDismiss={onDismissLockedToneNudge}
        onClick={onLockedToneCtaClick}
      />
    </div>
  );
}
