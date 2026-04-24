"use client";

import { useEffect, useState } from "react";
import {
  formatNumberForInput,
  normalizeFactorRateInput,
  normalizeIntegerInput,
  normalizeMoneyInput,
  normalizePercentInput,
} from "@/lib/dealContextNormalize";

export type NumericDealFieldKind = "money" | "percent" | "factor" | "integer";

type Props = {
  label: string;
  value: number | undefined;
  kind: NumericDealFieldKind;
  onCommit: (v: number | undefined) => void;
  className?: string;
  disabled?: boolean;
};

function normalize(kind: NumericDealFieldKind, text: string): number | undefined {
  switch (kind) {
    case "money":
      return normalizeMoneyInput(text);
    case "percent":
      return normalizePercentInput(text);
    case "factor":
      return normalizeFactorRateInput(text);
    case "integer":
      return normalizeIntegerInput(text);
    default:
      return undefined;
  }
}

export function NumericDealField({
  label,
  value,
  kind,
  onCommit,
  className = "",
  disabled = false,
}: Props) {
  const [text, setText] = useState(() => formatNumberForInput(value));

  useEffect(() => {
    setText(formatNumberForInput(value));
  }, [value]);

  return (
    <label className={`block text-xs text-gray-400 ${className}`}>
      {label}
      <input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (disabled) return;
          const parsed = normalize(kind, text);
          onCommit(parsed);
          setText(formatNumberForInput(parsed));
        }}
        className="mt-1 w-full rounded-lg border border-white/20 bg-transparent px-2 py-1.5 text-sm text-white outline-none focus:border-white/50 disabled:cursor-not-allowed disabled:opacity-50"
      />
    </label>
  );
}
