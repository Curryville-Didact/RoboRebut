"use client";

import type { LineOfCreditPaymentFrequency } from "@/lib/dealContext";
import { NumericDealField } from "./NumericDealField";

export type DealContextTermLoanUi = {
  dealType: "term_loan";
  loanAmount?: number;
  interestRate?: number;
  termMonths?: number;
  monthlyPayment?: number;
  paymentFrequency?: LineOfCreditPaymentFrequency;
};

type Props = {
  ctx: DealContextTermLoanUi;
  patch: (p: Partial<DealContextTermLoanUi>) => void;
  disabled?: boolean;
};

export function TermLoanDealFields({ ctx, patch, disabled = false }: Props) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <NumericDealField
        label="Loan amount"
        value={ctx.loanAmount}
        kind="money"
        disabled={disabled}
        onCommit={(v) => patch({ loanAmount: v })}
      />
      <NumericDealField
        label="Interest rate (%)"
        value={ctx.interestRate}
        kind="percent"
        disabled={disabled}
        onCommit={(v) => patch({ interestRate: v })}
      />
      <NumericDealField
        label="Term (months)"
        value={ctx.termMonths}
        kind="integer"
        disabled={disabled}
        onCommit={(v) => patch({ termMonths: v })}
      />
      <NumericDealField
        label="Monthly payment"
        value={ctx.monthlyPayment}
        kind="money"
        disabled={disabled}
        onCommit={(v) => patch({ monthlyPayment: v })}
      />
      <label className="block text-xs text-gray-400 sm:col-span-2">
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
    </div>
  );
}
