"use client";

import type {
  DealContextLineOfCredit,
  LineOfCreditPaymentFrequency,
} from "@/lib/dealContext";
import { NumericDealField } from "./NumericDealField";

type Props = {
  ctx: DealContextLineOfCredit;
  patch: (p: Partial<DealContextLineOfCredit>) => void;
  disabled?: boolean;
};

export function LOCDealFields({ ctx, patch, disabled = false }: Props) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <NumericDealField
        label="Drawn amount"
        value={ctx.drawnAmount}
        kind="money"
        disabled={disabled}
        onCommit={(v) => patch({ drawnAmount: v })}
      />
      <NumericDealField
        label="Credit limit"
        value={ctx.creditLimit}
        kind="money"
        disabled={disabled}
        onCommit={(v) => patch({ creditLimit: v })}
      />
      <NumericDealField
        label="Interest rate (%)"
        value={ctx.interestRate}
        kind="percent"
        disabled={disabled}
        onCommit={(v) => patch({ interestRate: v })}
      />
      <NumericDealField
        label="Term (days)"
        value={ctx.termDays}
        kind="integer"
        disabled={disabled}
        onCommit={(v) => patch({ termDays: v })}
      />
      <label className="block text-xs text-gray-400">
        Payment frequency
        <select
          value={ctx.paymentFrequency ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value as LineOfCreditPaymentFrequency | "";
            patch({ paymentFrequency: v === "" ? undefined : v });
          }}
          className="mt-1 w-full rounded-lg border border-white/20 bg-transparent px-2 py-1.5 text-sm text-white outline-none focus:border-white/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">—</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </label>
      <NumericDealField
        label="Estimated payment"
        value={ctx.estimatedPayment}
        kind="money"
        disabled={disabled}
        onCommit={(v) => patch({ estimatedPayment: v })}
      />
      <NumericDealField
        label="Monthly revenue"
        value={ctx.monthlyRevenue}
        kind="money"
        disabled={disabled}
        onCommit={(v) => patch({ monthlyRevenue: v })}
      />
    </div>
  );
}
