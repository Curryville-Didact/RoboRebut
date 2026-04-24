"use client";

import type { DealContextMerchantServices } from "@/lib/dealContext";
import { NumericDealField } from "./NumericDealField";

type Props = {
  ctx: DealContextMerchantServices;
  patch: (p: Partial<DealContextMerchantServices>) => void;
  disabled?: boolean;
};

/**
 * Canonical keys match backend JSONB: monthlyCardVolume, proposedRate, etc.
 * Labels follow product language (processing volume, processor rate).
 */
export function MerchantServicesDealFields({
  ctx,
  patch,
  disabled = false,
}: Props) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <NumericDealField
        label="Monthly processing volume"
        value={ctx.monthlyCardVolume}
        kind="money"
        disabled={disabled}
        onCommit={(v) => patch({ monthlyCardVolume: v })}
      />
      <NumericDealField
        label="Average ticket"
        value={ctx.averageTicket}
        kind="money"
        disabled={disabled}
        onCommit={(v) => patch({ averageTicket: v })}
      />
      <NumericDealField
        label="Effective rate (%)"
        value={ctx.effectiveRate}
        kind="percent"
        disabled={disabled}
        onCommit={(v) => patch({ effectiveRate: v })}
      />
      <NumericDealField
        label="Processor rate (%)"
        value={ctx.proposedRate}
        kind="percent"
        disabled={disabled}
        onCommit={(v) => patch({ proposedRate: v })}
      />
      <NumericDealField
        label="Estimated monthly fees"
        value={ctx.monthlyFees}
        kind="money"
        disabled={disabled}
        onCommit={(v) => patch({ monthlyFees: v })}
      />
      <NumericDealField
        label="Contract term (months)"
        value={ctx.contractTermMonths}
        kind="integer"
        disabled={disabled}
        onCommit={(v) => patch({ contractTermMonths: v })}
      />
      <NumericDealField
        label="Early termination fee"
        value={ctx.earlyTerminationFee}
        kind="money"
        disabled={disabled}
        onCommit={(v) => patch({ earlyTerminationFee: v })}
      />
    </div>
  );
}
