"use client";

import { NumericDealField } from "./NumericDealField";

/** Persisted as `dealType: "equipment_financing"` */
export type DealContextEquipmentLeasingUi = {
  dealType: "equipment_financing";
  equipmentCost?: number;
  downPayment?: number;
  monthlyPayment?: number;
  termMonths?: number;
  residualValue?: number;
};

type Props = {
  ctx: DealContextEquipmentLeasingUi;
  patch: (p: Partial<DealContextEquipmentLeasingUi>) => void;
  disabled?: boolean;
};

export function EquipmentLeasingDealFields({
  ctx,
  patch,
  disabled = false,
}: Props) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <NumericDealField
        label="Equipment cost"
        value={ctx.equipmentCost}
        kind="money"
        disabled={disabled}
        onCommit={(v) => patch({ equipmentCost: v })}
      />
      <NumericDealField
        label="Down payment"
        value={ctx.downPayment}
        kind="money"
        disabled={disabled}
        onCommit={(v) => patch({ downPayment: v })}
      />
      <NumericDealField
        label="Monthly payment"
        value={ctx.monthlyPayment}
        kind="money"
        disabled={disabled}
        onCommit={(v) => patch({ monthlyPayment: v })}
      />
      <NumericDealField
        label="Term (months)"
        value={ctx.termMonths}
        kind="integer"
        disabled={disabled}
        onCommit={(v) => patch({ termMonths: v })}
      />
      <NumericDealField
        label="Residual value"
        value={ctx.residualValue}
        kind="money"
        disabled={disabled}
        onCommit={(v) => patch({ residualValue: v })}
      />
    </div>
  );
}
