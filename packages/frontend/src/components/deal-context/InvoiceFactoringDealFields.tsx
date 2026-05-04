"use client";

import { NumericDealField } from "./NumericDealField";

export type DealContextInvoiceFactoringUi = {
  dealType: "invoice_factoring";
  invoiceAmount?: number;
  advanceRatePct?: number;
  factorFeePct?: number;
  reserveAmount?: number;
  paymentTermsDays?: number;
};

type Props = {
  ctx: DealContextInvoiceFactoringUi;
  patch: (p: Partial<DealContextInvoiceFactoringUi>) => void;
  disabled?: boolean;
};

export function InvoiceFactoringDealFields({
  ctx,
  patch,
  disabled = false,
}: Props) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <NumericDealField
        label="Invoice amount"
        value={ctx.invoiceAmount}
        kind="money"
        disabled={disabled}
        onCommit={(v) => patch({ invoiceAmount: v })}
      />
      <NumericDealField
        label="Advance rate (%)"
        value={ctx.advanceRatePct}
        kind="percent"
        disabled={disabled}
        onCommit={(v) => patch({ advanceRatePct: v })}
      />
      <NumericDealField
        label="Factor fee (%)"
        value={ctx.factorFeePct}
        kind="percent"
        disabled={disabled}
        onCommit={(v) => patch({ factorFeePct: v })}
      />
      <NumericDealField
        label="Reserve amount"
        value={ctx.reserveAmount}
        kind="money"
        disabled={disabled}
        onCommit={(v) => patch({ reserveAmount: v })}
      />
      <NumericDealField
        label="Payment terms (days)"
        value={ctx.paymentTermsDays}
        kind="integer"
        disabled={disabled}
        onCommit={(v) => patch({ paymentTermsDays: v })}
      />
    </div>
  );
}
