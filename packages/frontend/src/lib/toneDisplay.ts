import { ADVANCED_TONE_OPTIONS, STANDARD_TONE_OPTIONS } from "@/lib/toneOptions";

const ALL = [...STANDARD_TONE_OPTIONS, ...ADVANCED_TONE_OPTIONS];

/** User-facing label for a stored tone value (e.g. assistant `tone_used`). */
export function formatToneLabel(value: string | null | undefined): string {
  if (value == null || value === "") return "Default";
  const found = ALL.find((t) => t.value === value);
  return found?.label ?? value;
}
