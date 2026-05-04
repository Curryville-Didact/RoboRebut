"use client";

import { NumericDealField } from "./NumericDealField";

export type DealContextSbaLoanUi = {
  dealType: "sba_loan";
  loanAmount?: number;
  interestRate?: number;
  termMonths?: number;
  monthlyPayment?: number;
  guaranteeFeePct?: number;
};

type Props = {
  ctx: DealContextSbaLoanUi;
  patch: (p: Partial<DealContextSbaLoanUi>) => void;
  disabled?: boolean;
};

export function SbaLoanDealFields({ ctx, patch, disabled = false }: Props) {
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
      <NumericDealField
        label="Guarantee fee (%)"
        value={ctx.guaranteeFeePct}
        kind="percent"
        disabled={disabled}
        onCommit={(v) => patch({ guaranteeFeePct: v })}
      />
    </div>
  );
}
