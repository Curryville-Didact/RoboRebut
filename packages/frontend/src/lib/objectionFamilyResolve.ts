/**
 * Minimal objection label → high-level family mapping for Saved Responses STORE contract.
 * Does not replace the classifier; only normalizes persisted category vs objectionType.
 */

import type { AssistantStructuredReply } from "@/types/assistantStructuredReply";

/** Known high-level buckets (slug form). Identity entries map to themselves. */
const LABEL_SLUG_TO_FAMILY: Record<string, string> = {
  // Cash / affordability
  affordability: "cash_flow",
  cash_flow: "cash_flow",
  cashflow: "cash_flow",
  payment: "cash_flow",
  // Cost / value framing
  price: "cost_value",
  cost: "cost_value",
  cost_value: "cost_value",
  costvalue: "cost_value",
  price_cost_framing: "cost_value",
  // Timing / stall (keep `stall` as stable bucket — matches demo fixtures)
  stall: "stall",
  timing: "timing",
  think: "timing",
  // Trust / risk
  trust: "trust",
  trust_risk: "trust",
  risk: "trust",
  // Loyalty / relationship
  loyalty: "loyalty",
  loyalty_existing_relationship: "loyalty",
  existing_relationship: "loyalty",
  // Explicit common families (demo + product)
  comparison: "comparison",
  coaching: "coaching",
  unknown: "",
};

/** After map lookup, empty string means explicitly unclassified — treat as null. */
const CANONICAL_FAMILIES = new Set([
  "cash_flow",
  "cost_value",
  "timing",
  "trust",
  "loyalty",
  "comparison",
  "coaching",
  "stall",
]);

export function toObjectionSlug(input: string | null | undefined): string | null {
  if (input == null) return null;
  const t = String(input).trim().toLowerCase().replace(/\s+/g, "_").replace(/_+/g, "_");
  return t === "" ? null : t;
}

function mapSlugToFamily(slug: string | null): string | null {
  if (!slug) return null;
  if (slug === "unknown") return null;
  const mapped = LABEL_SLUG_TO_FAMILY[slug];
  if (mapped === "") return null;
  if (mapped) return mapped;
  if (CANONICAL_FAMILIES.has(slug)) return slug;
  return null;
}

type MessageLike = { objection_type?: string | null };

/**
 * STORE-stage resolution:
 * - category (family bucket): map from specific label slug, else classifier primary, else null
 * - objectionType (specific): prefer human precall label, else structured objection string, else legacy column
 */
export function resolveSavedResponseObjectionSemantics(
  parsed: AssistantStructuredReply | null,
  msg: MessageLike
): { categoryFamily: string | null; objectionTypeSpecific: string | null } {
  const precallLabel = parsed?.precallObjectionTypeLabel?.trim() || null;
  const structuredObj = parsed?.objectionType?.trim() || null;
  const structuredPrimary = parsed?.primaryObjectionType?.trim() || null;
  const legObj = msg.objection_type?.trim() || null;

  const objectionTypeSpecific =
    precallLabel ?? structuredObj ?? legObj ?? null;

  const slugFromSpecific = toObjectionSlug(objectionTypeSpecific);
  const slugFromPrimary = toObjectionSlug(structuredPrimary);
  const slugFromLeg = toObjectionSlug(legObj);

  const familyFromSpecific = mapSlugToFamily(slugFromSpecific);
  const familyFromPrimary = mapSlugToFamily(slugFromPrimary);
  const familyFromLeg = mapSlugToFamily(slugFromLeg);

  const primarySlug = toObjectionSlug(structuredPrimary);
  const categoryFamily =
    familyFromSpecific ??
    familyFromPrimary ??
    familyFromLeg ??
    (primarySlug && CANONICAL_FAMILIES.has(primarySlug) ? primarySlug : null);

  return {
    categoryFamily,
    objectionTypeSpecific,
  };
}

/**
 * READ-side: derive stable family for filtering when legacy rows mixed category/objection semantics.
 */
export function deriveCategoryFamilyForFilter(
  topCategory: string | null | undefined,
  meta: Record<string, unknown> | null | undefined
): string | null {
  const top = toObjectionSlug(topCategory ?? null);
  const metaCat = toObjectionSlug(
    typeof meta?.category === "string" ? meta.category : null
  );
  const objType = typeof meta?.objectionType === "string" ? meta.objectionType : null;
  const slugObj = toObjectionSlug(objType);

  const fromTop = mapSlugToFamily(top) ?? (top && CANONICAL_FAMILIES.has(top) ? top : null);
  const fromMetaCat = mapSlugToFamily(metaCat) ?? (metaCat && CANONICAL_FAMILIES.has(metaCat) ? metaCat : null);
  const fromObj = mapSlugToFamily(slugObj);

  return fromTop ?? fromMetaCat ?? fromObj ?? null;
}
