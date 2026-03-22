"use client";

interface ToneSwitcherProps {
  selectedTone: string;
  onSelect: (tone: string) => void;
  disabled?: boolean;
}

const TONES = [
  "Consultative",
  "Assertive",
  "Friendly",
  "Urgent",
  "Analytical",
];

export function ToneSwitcher({
  selectedTone,
  onSelect,
  disabled = false,
}: ToneSwitcherProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {TONES.map((tone) => {
        const value = tone.toLowerCase();
        const isSelected = selectedTone === value;
        return (
          <button
            key={tone}
            onClick={() => onSelect(value)}
            disabled={disabled}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
              isSelected
                ? "border-white bg-white text-black"
                : "border-white/30 text-white hover:border-white/60"
            } disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {tone}
          </button>
        );
      })}
    </div>
  );
}
