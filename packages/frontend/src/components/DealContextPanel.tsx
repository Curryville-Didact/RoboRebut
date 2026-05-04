"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/env";
import {
  hasDealContextValues,
  isLineOfCreditContext,
  isMerchantServicesContext,
  type DealContext,
  type DealContextLineOfCredit,
  type DealContextMca,
  type DealContextMerchantServices,
} from "@/lib/dealContext";
import { navigateProBillingSameTab } from "@/lib/resolveProBillingDestination";
import { EquipmentLeasingDealFields } from "@/components/deal-context/EquipmentLeasingDealFields";
import type { DealContextEquipmentLeasingUi } from "@/components/deal-context/EquipmentLeasingDealFields";
import { InvoiceFactoringDealFields } from "@/components/deal-context/InvoiceFactoringDealFields";
import type { DealContextInvoiceFactoringUi } from "@/components/deal-context/InvoiceFactoringDealFields";
import { LOCDealFields } from "@/components/deal-context/LOCDealFields";
import { MCADealFields } from "@/components/deal-context/MCADealFields";
import { MerchantServicesDealFields } from "@/components/deal-context/MerchantServicesDealFields";
import { SbaLoanDealFields } from "@/components/deal-context/SbaLoanDealFields";
import type { DealContextSbaLoanUi } from "@/components/deal-context/SbaLoanDealFields";
import { TermLoanDealFields } from "@/components/deal-context/TermLoanDealFields";
import type { DealContextTermLoanUi } from "@/components/deal-context/TermLoanDealFields";

export type DealCategory =
  | "mca"
  | "business_line_of_credit"
  | "term_loan"
  | "sba_loan"
  | "equipment_leasing"
  | "invoice_factoring"
  | "merchant_services";

/** Persisted `deal_context.dealType` (backend vertical router uses `equipment_financing`). */
function categoryToPersistedDealType(cat: DealCategory): string {
  if (cat === "equipment_leasing") return "equipment_financing";
  return cat;
}

function persistedDealTypeToCategory(dt: string): DealCategory | null {
  if (dt === "equipment_financing") return "equipment_leasing";
  const allowed: DealCategory[] = [
    "mca",
    "business_line_of_credit",
    "term_loan",
    "sba_loan",
    "equipment_leasing",
    "invoice_factoring",
    "merchant_services",
  ];
  return (allowed as string[]).includes(dt) ? (dt as DealCategory) : null;
}

function isMcaOnlyContext(value: unknown): boolean {
  if (value == null || typeof value !== "object") return false;
  const t = (value as Record<string, unknown>).dealType;
  return t === "mca" || t === undefined;
}

function isTermLoanContext(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).dealType === "term_loan"
  );
}

function isSbaLoanContext(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).dealType === "sba_loan"
  );
}

function isEquipmentLeasingSavedContext(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).dealType === "equipment_financing"
  );
}

function isInvoiceFactoringContext(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).dealType === "invoice_factoring"
  );
}

const MCA_FIELD_KEYS = new Set<string>([
  "dealType",
  "monthlyRevenue",
  "advanceAmount",
  "paybackAmount",
  "paymentFrequency",
  "termDays",
  "lenderName",
  "factorRate",
]);

const LOC_FIELD_KEYS = new Set<string>([
  "dealType",
  "creditLimit",
  "drawnAmount",
  "interestRate",
  "paymentFrequency",
  "termDays",
  "termMonths",
  "monthlyRevenue",
  "originationFee",
  "maintenanceFee",
  "estimatedPayment",
]);

const MERCHANT_FIELD_KEYS = new Set<string>([
  "dealType",
  "monthlyCardVolume",
  "averageTicket",
  "effectiveRate",
  "proposedRate",
  "perTxnFee",
  "proposedPerTxnFee",
  "monthlyFees",
  "proposedMonthlyFees",
  "chargebackRate",
  "riskLevel",
  "providerName",
  "contractTermMonths",
  "earlyTerminationFee",
]);

const TERM_LOAN_FIELD_KEYS = new Set<string>([
  "dealType",
  "loanAmount",
  "interestRate",
  "termMonths",
  "monthlyPayment",
  "paymentFrequency",
]);

const SBA_LOAN_FIELD_KEYS = new Set<string>([
  "dealType",
  "loanAmount",
  "interestRate",
  "termMonths",
  "monthlyPayment",
  "guaranteeFeePct",
]);

const EQUIPMENT_LEASING_FIELD_KEYS = new Set<string>([
  "dealType",
  "equipmentCost",
  "downPayment",
  "monthlyPayment",
  "termMonths",
  "residualValue",
]);

const INVOICE_FACTORING_FIELD_KEYS = new Set<string>([
  "dealType",
  "invoiceAmount",
  "advanceRatePct",
  "factorFeePct",
  "reserveAmount",
  "paymentTermsDays",
]);

const MCA_PAYMENT_FREQ = new Set<string>(["daily", "weekly"]);
const LOC_PAYMENT_FREQ = new Set<string>(["daily", "weekly", "monthly"]);
const TERM_LOAN_PAYMENT_FREQ = new Set<string>(["daily", "weekly", "monthly"]);

function pickWhitelisted(
  src: Record<string, unknown>,
  allowed: Set<string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (!allowed.has(k)) continue;
    if (v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (typeof v === "number" && Number.isNaN(v)) continue;
    out[k] = v;
  }
  return out;
}

function hasPayloadSignals(out: Record<string, unknown>): boolean {
  return Object.entries(out).some(([k, v]) => {
    if (k === "dealType") return false;
    if (k === "paymentFrequency") {
      return typeof v === "string" && v !== "";
    }
    if (typeof v === "string" && v !== "dealType") {
      return v.trim() !== "";
    }
    return typeof v === "number" && Number.isFinite(v);
  });
}

/** Removes empty strings, NaN, and undefined keys; null if no meaningful fields remain. */
export function cleanDealContextPayload(
  draft: DealContext,
  category: DealCategory
): DealContext | null {
  const src = draft as Record<string, unknown>;

  if (category === "merchant_services") {
    const out = pickWhitelisted(src, MERCHANT_FIELD_KEYS);
    out.dealType = "merchant_services";
    if (!hasPayloadSignals(out)) return null;
    return out as DealContext;
  }

  if (category === "business_line_of_credit") {
    const out = pickWhitelisted(src, LOC_FIELD_KEYS);
    out.dealType = "business_line_of_credit";
    const pf = out.paymentFrequency;
    if (typeof pf === "string" && !LOC_PAYMENT_FREQ.has(pf)) {
      delete out.paymentFrequency;
    }
    if (!hasPayloadSignals(out)) return null;
    return out as DealContext;
  }

  if (category === "mca") {
    const out = pickWhitelisted(src, MCA_FIELD_KEYS);
    const pf = out.paymentFrequency;
    if (typeof pf === "string" && !MCA_PAYMENT_FREQ.has(pf)) {
      delete out.paymentFrequency;
    }
    if (!hasPayloadSignals(out)) return null;
    out.dealType = "mca";
    return out as DealContext;
  }

  if (category === "term_loan") {
    const out = pickWhitelisted(src, TERM_LOAN_FIELD_KEYS);
    const pf = out.paymentFrequency;
    if (typeof pf === "string" && !TERM_LOAN_PAYMENT_FREQ.has(pf)) {
      delete out.paymentFrequency;
    }
    if (!hasPayloadSignals(out)) return null;
    out.dealType = "term_loan";
    return out as DealContext;
  }

  if (category === "sba_loan") {
    const out = pickWhitelisted(src, SBA_LOAN_FIELD_KEYS);
    if (!hasPayloadSignals(out)) return null;
    out.dealType = "sba_loan";
    return out as DealContext;
  }

  if (category === "equipment_leasing") {
    const out = pickWhitelisted(src, EQUIPMENT_LEASING_FIELD_KEYS);
    if (!hasPayloadSignals(out)) return null;
    out.dealType = "equipment_financing";
    return out as DealContext;
  }

  if (category === "invoice_factoring") {
    const out = pickWhitelisted(src, INVOICE_FACTORING_FIELD_KEYS);
    if (!hasPayloadSignals(out)) return null;
    out.dealType = "invoice_factoring";
    return out as DealContext;
  }

  return null;
}

function inferCategory(ctx: DealContext | null): DealCategory {
  if (!ctx) return "mca";
  const dt = (ctx as Record<string, unknown>).dealType;
  if (typeof dt === "string") {
    const mapped = persistedDealTypeToCategory(dt);
    if (mapped) return mapped;
  }
  if (isMerchantServicesContext(ctx)) return "merchant_services";
  if (isLineOfCreditContext(ctx)) return "business_line_of_credit";
  return "mca";
}

function defaultContextForCategory(cat: DealCategory): DealContext {
  switch (cat) {
    case "merchant_services":
      return { dealType: "merchant_services" };
    case "business_line_of_credit":
      return { dealType: "business_line_of_credit" };
    default:
      return { dealType: categoryToPersistedDealType(cat) } as DealContext;
  }
}

export type DealContextPanelProps = {
  conversationId: string;
  /** Persisted deal_context from server (drives Add vs Edit label). */
  savedDealContext: DealContext | null;
  getAccessToken: () => Promise<string | null>;
  onDealContextSaved: (deal_context: DealContext | null) => void;
  /** Pro entitlement — must match backend `structuredDealContext` (UI hint only; API enforces). */
  structuredDealContextEnabled: boolean;
  /** Polar Pro checkout with return URL (shown when structured deal context is locked). */
  proUpgradeHref: string;
};

export function DealContextPanel({
  conversationId,
  savedDealContext,
  getAccessToken,
  onDealContextSaved,
  structuredDealContextEnabled,
  proUpgradeHref,
}: DealContextPanelProps) {
  /** All gated UI derives from `structuredDealContextEnabled` only (passed from parent). */
  const dealContextLocked = !structuredDealContextEnabled;
  const [open, setOpen] = useState(false);
  const [dealContext, setDealContext] = useState<DealContext | null>(
    savedDealContext
  );
  const [category, setCategory] = useState<DealCategory>(() =>
    inferCategory(savedDealContext)
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setDealContext(savedDealContext);
    setCategory(inferCategory(savedDealContext));
  }, [conversationId, savedDealContext]);

  useEffect(() => {
    if (structuredDealContextEnabled) setSaveError(null);
  }, [structuredDealContextEnabled]);

  useEffect(() => {
    if (open && dealContext === null) {
      setDealContext(defaultContextForCategory(category));
    }
  }, [open, dealContext, category]);

  const toggleOpen = () => setOpen((o) => !o);

  const setCategoryAndContext = (nextCat: DealCategory) => {
    setCategory(nextCat);
    setDealContext(defaultContextForCategory(nextCat));
  };

  const patchMca = (patch: Partial<DealContextMca>) => {
    setDealContext((prev) => {
      const base =
        prev && isMcaOnlyContext(prev)
          ? { ...(prev as unknown as DealContextMca) }
          : (defaultContextForCategory("mca") as unknown as DealContextMca);
      return { ...base, ...patch, dealType: "mca" } as unknown as DealContext;
    });
  };

  const patchTermLoan = (patch: Partial<DealContextTermLoanUi>) => {
    setDealContext((prev) => {
      const base =
        prev && isTermLoanContext(prev)
          ? { ...(prev as unknown as DealContextTermLoanUi) }
          : (defaultContextForCategory("term_loan") as unknown as DealContextTermLoanUi);
      return { ...base, ...patch, dealType: "term_loan" } as unknown as DealContext;
    });
  };

  const patchSbaLoan = (patch: Partial<DealContextSbaLoanUi>) => {
    setDealContext((prev) => {
      const base =
        prev && isSbaLoanContext(prev)
          ? { ...(prev as unknown as DealContextSbaLoanUi) }
          : (defaultContextForCategory("sba_loan") as unknown as DealContextSbaLoanUi);
      return { ...base, ...patch, dealType: "sba_loan" } as unknown as DealContext;
    });
  };

  const patchEquipmentLeasing = (patch: Partial<DealContextEquipmentLeasingUi>) => {
    setDealContext((prev) => {
      const base =
        prev && isEquipmentLeasingSavedContext(prev)
          ? { ...(prev as unknown as DealContextEquipmentLeasingUi) }
          : (defaultContextForCategory(
              "equipment_leasing"
            ) as unknown as DealContextEquipmentLeasingUi);
      return {
        ...base,
        ...patch,
        dealType: "equipment_financing",
      } as unknown as DealContext;
    });
  };

  const patchInvoiceFactoring = (patch: Partial<DealContextInvoiceFactoringUi>) => {
    setDealContext((prev) => {
      const base =
        prev && isInvoiceFactoringContext(prev)
          ? { ...(prev as unknown as DealContextInvoiceFactoringUi) }
          : (defaultContextForCategory(
              "invoice_factoring"
            ) as unknown as DealContextInvoiceFactoringUi);
      return { ...base, ...patch, dealType: "invoice_factoring" } as unknown as DealContext;
    });
  };

  const patchLoc = (patch: Partial<DealContextLineOfCredit>) => {
    setDealContext((prev) => {
      const base =
        prev && isLineOfCreditContext(prev)
          ? { ...prev }
          : (defaultContextForCategory(
              "business_line_of_credit"
            ) as DealContextLineOfCredit);
      return {
        ...base,
        ...patch,
        dealType: "business_line_of_credit",
      } as DealContext;
    });
  };

  const patchMs = (patch: Partial<DealContextMerchantServices>) => {
    setDealContext((prev) => {
      const base =
        prev && isMerchantServicesContext(prev)
          ? { ...prev }
          : (defaultContextForCategory(
              "merchant_services"
            ) as DealContextMerchantServices);
      return {
        ...base,
        ...patch,
        dealType: "merchant_services",
      } as DealContext;
    });
  };

  async function handleSave() {
    setSaveError(null);
    if (dealContextLocked) {
      setSaveError("Saving Deal Structure requires a Pro plan.");
      return;
    }
    const draft = dealContext ?? defaultContextForCategory(category);
    const cleaned = cleanDealContextPayload(draft, category);

    const token = await getAccessToken();
    if (!token) {
      setSaveError("Session expired. Refresh the page.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ deal_context: cleaned }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        deal_context?: DealContext | null;
      };

      if (!res.ok) {
        setSaveError(
          typeof payload.error === "string"
            ? payload.error
            : "Could not save Deal Structure."
        );
        return;
      }

      const next = payload.deal_context ?? null;
      onDealContextSaved(next);
      setDealContext(next);
      setCategory(inferCategory(next));
    } catch {
      setSaveError("Could not save Deal Structure.");
    } finally {
      setSaving(false);
    }
  }

  const toggleLabel = hasDealContextValues(savedDealContext)
    ? "Edit Deal Structure"
    : "Add Deal Structure";

  const mcaView: DealContextMca | null =
    category === "mca" && dealContext && isMcaOnlyContext(dealContext)
      ? (dealContext as unknown as DealContextMca)
      : null;
  const termLoanView: DealContextTermLoanUi | null =
    category === "term_loan" && dealContext && isTermLoanContext(dealContext)
      ? (dealContext as unknown as DealContextTermLoanUi)
      : null;
  const sbaLoanView: DealContextSbaLoanUi | null =
    category === "sba_loan" && dealContext && isSbaLoanContext(dealContext)
      ? (dealContext as unknown as DealContextSbaLoanUi)
      : null;
  const equipmentLeasingView: DealContextEquipmentLeasingUi | null =
    category === "equipment_leasing" &&
    dealContext &&
    isEquipmentLeasingSavedContext(dealContext)
      ? (dealContext as unknown as DealContextEquipmentLeasingUi)
      : null;
  const invoiceFactoringView: DealContextInvoiceFactoringUi | null =
    category === "invoice_factoring" &&
    dealContext &&
    isInvoiceFactoringContext(dealContext)
      ? (dealContext as unknown as DealContextInvoiceFactoringUi)
      : null;
  const locView =
    category === "business_line_of_credit" &&
    dealContext &&
    isLineOfCreditContext(dealContext)
      ? dealContext
      : null;
  const msView =
    category === "merchant_services" &&
    dealContext &&
    isMerchantServicesContext(dealContext)
      ? dealContext
      : null;

  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={toggleOpen}
        className="text-xs text-gray-500 transition hover:text-white"
      >
        {toggleLabel}
        <span className="ml-1 text-gray-600">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          {dealContextLocked && (
            <div className="rounded-lg border border-amber-500/35 bg-amber-950/20 px-3 py-2 text-xs text-amber-100">
              <p className="font-medium text-amber-50">
                Saving Deal Structure is a Pro feature.
              </p>
              <p className="mt-1 text-amber-100/90">
                Live coaching will not use saved deal structure until you upgrade.
              </p>
              <a
                href={proUpgradeHref}
                className="mt-2 inline-block font-medium text-amber-200 underline hover:text-white"
                onClick={(e) => {
                  e.preventDefault();
                  void navigateProBillingSameTab({
                    getAccessToken,
                    checkoutFallbackUrl: proUpgradeHref,
                    portalReturnUrl:
                      typeof window !== "undefined" ? window.location.href : proUpgradeHref,
                  });
                }}
              >
                Upgrade to Pro
              </a>
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold text-white">Deal Structure</h3>
            <p className="mt-1 text-xs text-gray-500">
              Offer, terms, cadence, and payment burden.
            </p>
          </div>
          <label className="block text-xs text-gray-400">
            Deal type
            <select
              value={category}
              disabled={dealContextLocked}
              onChange={(e) =>
                setCategoryAndContext(e.target.value as DealCategory)
              }
              className="mt-1 w-full rounded-lg border border-white/20 bg-transparent px-2 py-1.5 text-sm text-white outline-none focus:border-white/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="mca">MCA (Cash Advance)</option>
              <option value="business_line_of_credit">Business line of credit</option>
              <option value="term_loan">Term Loan</option>
              <option value="sba_loan">SBA Loan</option>
              <option value="equipment_leasing">Equipment Leasing</option>
              <option value="invoice_factoring">Invoice Factoring</option>
              <option value="merchant_services">Merchant services</option>
            </select>
          </label>

          {category === "mca" && mcaView && (
            <MCADealFields
              ctx={mcaView}
              patch={patchMca}
              disabled={dealContextLocked}
            />
          )}

          {category === "term_loan" && termLoanView && (
            <TermLoanDealFields
              ctx={termLoanView}
              patch={patchTermLoan}
              disabled={dealContextLocked}
            />
          )}

          {category === "sba_loan" && sbaLoanView && (
            <SbaLoanDealFields
              ctx={sbaLoanView}
              patch={patchSbaLoan}
              disabled={dealContextLocked}
            />
          )}

          {category === "equipment_leasing" && equipmentLeasingView && (
            <EquipmentLeasingDealFields
              ctx={equipmentLeasingView}
              patch={patchEquipmentLeasing}
              disabled={dealContextLocked}
            />
          )}

          {category === "invoice_factoring" && invoiceFactoringView && (
            <InvoiceFactoringDealFields
              ctx={invoiceFactoringView}
              patch={patchInvoiceFactoring}
              disabled={dealContextLocked}
            />
          )}

          {category === "business_line_of_credit" && locView && (
            <LOCDealFields
              ctx={locView}
              patch={patchLoc}
              disabled={dealContextLocked}
            />
          )}

          {category === "merchant_services" && msView && (
            <MerchantServicesDealFields
              ctx={msView}
              patch={patchMs}
              disabled={dealContextLocked}
            />
          )}

          {saveError && (
            <p className="text-xs text-red-400">{saveError}</p>
          )}

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || dealContextLocked}
            className="rounded-lg border border-white/40 px-3 py-1.5 text-xs font-medium transition hover:bg-white hover:text-black disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Deal Structure"}
          </button>
        </div>
      )}
    </div>
  );
}
