/**
 * Conversation-level account intelligence (`client_context` JSONB) — mirror backend `ClientContext`.
 */

export type ClientContext = {
  businessName?: string;
  industry?: string;
  currentProvider?: string;
  monthlyRevenueText?: string;
  painPoints?: string;
  decisionMaker?: string;
  partnerInvolved?: boolean;
  urgencyTimeline?: string;
  trustFlags?: string;
  statedObjections?: string;
  notes?: string;
};

export const EMPTY_CLIENT_CONTEXT: ClientContext = {
  businessName: "",
  industry: "",
  currentProvider: "",
  monthlyRevenueText: "",
  painPoints: "",
  decisionMaker: "",
  partnerInvolved: false,
  urgencyTimeline: "",
  trustFlags: "",
  statedObjections: "",
  notes: "",
};

/** Strip empties; return null if nothing meaningful remains (clears JSONB). */
export function cleanClientContextPayload(
  draft: ClientContext
): ClientContext | null {
  const businessName = draft.businessName?.trim() ?? "";
  const industry = draft.industry?.trim() ?? "";
  const currentProvider = draft.currentProvider?.trim() ?? "";
  const monthlyRevenueText = draft.monthlyRevenueText?.trim() ?? "";
  const painPoints = draft.painPoints?.trim() ?? "";
  const decisionMaker = draft.decisionMaker?.trim() ?? "";
  const urgencyTimeline = draft.urgencyTimeline?.trim() ?? "";
  const trustFlags = draft.trustFlags?.trim() ?? "";
  const statedObjections = draft.statedObjections?.trim() ?? "";
  const notes = draft.notes?.trim() ?? "";
  const partnerInvolved = Boolean(draft.partnerInvolved);

  const hasText =
    businessName ||
    industry ||
    currentProvider ||
    monthlyRevenueText ||
    painPoints ||
    decisionMaker ||
    urgencyTimeline ||
    trustFlags ||
    statedObjections ||
    notes;

  if (!hasText && !partnerInvolved) return null;

  const out: ClientContext = {};
  if (businessName) out.businessName = businessName;
  if (industry) out.industry = industry;
  if (currentProvider) out.currentProvider = currentProvider;
  if (monthlyRevenueText) out.monthlyRevenueText = monthlyRevenueText;
  if (painPoints) out.painPoints = painPoints;
  if (decisionMaker) out.decisionMaker = decisionMaker;
  if (urgencyTimeline) out.urgencyTimeline = urgencyTimeline;
  if (trustFlags) out.trustFlags = trustFlags;
  if (statedObjections) out.statedObjections = statedObjections;
  if (notes) out.notes = notes;
  if (partnerInvolved) out.partnerInvolved = true;

  return out;
}

export function mergeSavedClientContext(
  raw: unknown
): ClientContext {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...EMPTY_CLIENT_CONTEXT };
  }
  const o = raw as Record<string, unknown>;
  return {
    ...EMPTY_CLIENT_CONTEXT,
    businessName: typeof o.businessName === "string" ? o.businessName : "",
    industry: typeof o.industry === "string" ? o.industry : "",
    currentProvider:
      typeof o.currentProvider === "string" ? o.currentProvider : "",
    monthlyRevenueText:
      typeof o.monthlyRevenueText === "string" ? o.monthlyRevenueText : "",
    painPoints: typeof o.painPoints === "string" ? o.painPoints : "",
    decisionMaker: typeof o.decisionMaker === "string" ? o.decisionMaker : "",
    partnerInvolved: o.partnerInvolved === true,
    urgencyTimeline:
      typeof o.urgencyTimeline === "string" ? o.urgencyTimeline : "",
    trustFlags: typeof o.trustFlags === "string" ? o.trustFlags : "",
    statedObjections:
      typeof o.statedObjections === "string" ? o.statedObjections : "",
    notes: typeof o.notes === "string" ? o.notes : "",
  };
}
