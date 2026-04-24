"use client";

import type { DealContextMca, PaymentFrequency } from "@/lib/dealContext";
import { NumericDealField } from "./NumericDealField";

type Props = {
  ctx: DealContextMca;
  patch: (p: Partial<DealContextMca>) => void;
  disabled?: boolean;
};

export function MCADealFields({ ctx, patch, disabled = false }: Props) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <NumericDealField
        label="Monthly revenue"
        value={ctx.monthlyRevenue}
        kind="money"
        disabled={disabled}
        onCommit={(v) => patch({ monthlyRevenue: v })}
      />
      <NumericDealField
        label="Advance amount"
        value={ctx.advanceAmount}
        kind="money"
        disabled={disabled}
        onCommit={(v) => patch({ advanceAmount: v })}
      />
      <NumericDealField
        label="Payback amount"
        value={ctx.paybackAmount}
        kind="money"
        disabled={disabled}
        onCommit={(v) => patch({ paybackAmount: v })}
      />
      <NumericDealField
        label="Factor rate"
        value={ctx.factorRate}
        kind="factor"
        disabled={disabled}
        onCommit={(v) => patch({ factorRate: v })}
      />
      <NumericDealField
        label="Term (days)"
        value={ctx.termDays}
        kind="integer"
        disabled={disabled}
        onCommit={(v) => patch({ termDays: v })}
      />
      <label className="block text-xs text-gray-400 sm:col-span-2">
        Payment frequency
        <select
          value={ctx.paymentFrequency ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value as PaymentFrequency | "";
            patch({ paymentFrequency: v === "" ? undefined : v });
          }}
          className="mt-1 w-full rounded-lg border border-white/20 bg-transparent px-2 py-1.5 text-sm text-white outline-none focus:border-white/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">—</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      <p className="text-[11px] leading-snug text-gray-500 sm:col-span-2">
        MCA: daily means business days only (Mon–Fri). Weekly means one weekly
        draft.
      </p>
    </div>
  );
}
