export type ToneOption = {
  value: string;
  label: string;
  advanced?: boolean;
  locked?: boolean;
};

export const STANDARD_TONE_OPTIONS: ToneOption[] = [
  { value: "consultative", label: "Consultative" },
  { value: "assertive", label: "Assertive" },
  { value: "friendly", label: "Friendly" },
  { value: "urgent", label: "Urgent" },
  { value: "analytical", label: "Analytical" },
];

export const ADVANCED_TONE_OPTIONS: ToneOption[] = [
  { value: "closer", label: "Closer", advanced: true },
  { value: "pressure", label: "Pressure", advanced: true },
  {
    value: "analytical_breakdown",
    label: "Analytical Breakdown",
    advanced: true,
  },
];

export function getVisibleToneOptions(advancedToneModes: boolean): ToneOption[] {
  return advancedToneModes
    ? [...STANDARD_TONE_OPTIONS, ...ADVANCED_TONE_OPTIONS]
    : [
        ...STANDARD_TONE_OPTIONS,
        ...ADVANCED_TONE_OPTIONS.map((tone) => ({ ...tone, locked: true })),
      ];
}
