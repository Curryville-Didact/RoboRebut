/**
 * Client-side filtering + lightweight query ranking for Saved Responses.
 * Does not mutate source records.
 */

import { deriveCategoryFamilyForFilter } from "@/lib/objectionFamilyResolve";
import { formatStrategyLabel } from "@/lib/strategyDisplay";
import { detectStructuredReplyPresence } from "@/lib/structuredReplyPresence";

export type SavedResponseLike = {
  id: string;
  label: string;
  content: string;
  category: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
};

export type SavedResponseFilterableView = {
  id: string;
  label: string;
  queryText: string;
  categoryKey: string | null;
  objectionTypeKey: string | null;
  objectionTypeDisplay: string | null;
  toneKey: string | null;
  toneDisplay: string | null;
  strategyKey: string | null;
  strategyDisplay: string | null;
  hasStructuredReply: boolean;
  created_at: string;
};

export type StructuredReplyPresenceFilter = "all" | "yes" | "no";

export type SavedResponseFilterState = {
  textQuery: string;
  category: string;
  objectionType: string;
  tone: string;
  strategy: string;
  structuredReply: StructuredReplyPresenceFilter;
};

export function normalizeFilterToken(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = String(value).trim().toLowerCase();
  return t === "" ? null : t;
}

/** Collapses spacing/underscore drift for dedupe + select values. */
export function canonicalFilterKey(value: string | null | undefined): string | null {
  const n = normalizeFilterToken(value);
  if (!n) return null;
  return n.replace(/\s+/g, "_").replace(/_+/g, "_");
}

function metaTrimString(meta: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!meta) return null;
  const v = meta[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function joinQueryParts(parts: Array<string | null | undefined>): string {
  return parts
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .join("\n")
    .trim();
}

export function deriveSavedResponseQueryText(row: SavedResponseLike): string {
  const meta = row.metadata ?? null;
  return joinQueryParts([
    row.label,
    row.content,
    metaTrimString(meta, "merchantObjection"),
    metaTrimString(meta, "objectionPreview"),
    metaTrimString(meta, "whatTheyReallyMean"),
    metaTrimString(meta, "followUp"),
    metaTrimString(meta, "coachNote"),
  ]);
}

export function formatCanonicalFilterDisplay(key: string): string {
  const words = key.replace(/_/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return key;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export type FilterOptionKind = "category" | "objectionType" | "tone" | "strategy";

function looksLikeSlug(value: string): boolean {
  return /[_-]/.test(value) || value.toLowerCase() === value;
}

/** One centralized formatter for filter option labels. */
export function formatFilterDisplayLabel(kind: FilterOptionKind, raw: string, key: string): string {
  const r = raw.trim();
  if (!r) return formatCanonicalFilterDisplay(key);

  if (kind === "category" || kind === "objectionType") {
    return formatCanonicalFilterDisplay(key);
  }

  if (kind === "tone") {
    // toneLabel is already human (e.g. "Calm"); tone may be sluggy.
    return looksLikeSlug(r) ? formatCanonicalFilterDisplay(canonicalFilterKey(r) ?? key) : r;
  }

  // strategy: prefer stored human label, else title-case the canonical key.
  return looksLikeSlug(r) ? formatCanonicalFilterDisplay(canonicalFilterKey(r) ?? key) : r;
}

function deriveToneForFilter(meta: Record<string, unknown> | null | undefined): string | null {
  const toneLabel = metaTrimString(meta, "toneLabel");
  const tone = metaTrimString(meta, "tone");
  return toneLabel ?? tone ?? null;
}

function isNoiseStrategy(raw: string | null | undefined): boolean {
  const t = normalizeFilterToken(raw);
  if (!t) return true;
  if (t === "unknown") return true;
  return false;
}

export function deriveStrategyForFilter(meta: Record<string, unknown> | null | undefined): string | null {
  const label = metaTrimString(meta, "strategyLabel");
  if (label && !isNoiseStrategy(label)) return label.trim();

  const raw = metaTrimString(meta, "strategyRaw");
  const fromRaw = formatStrategyLabel(raw);
  if (fromRaw && !isNoiseStrategy(fromRaw)) return fromRaw;

  const legacy = metaTrimString(meta, "strategyUsed");
  const fromLegacy = formatStrategyLabel(legacy);
  if (fromLegacy && !isNoiseStrategy(fromLegacy)) return fromLegacy;
  if (legacy && !isNoiseStrategy(legacy)) return legacy.trim();

  return null;
}

export function deriveSavedResponseFilterView(row: SavedResponseLike): SavedResponseFilterableView {
  const meta = row.metadata ?? null;

  const family = deriveCategoryFamilyForFilter(row.category, meta);
  const objectionRaw = metaTrimString(meta, "objectionType");

  const toneDisp = deriveToneForFilter(meta);
  const stratDisp = deriveStrategyForFilter(meta);

  const hasStructuredReply = detectStructuredReplyPresence(meta, row.content);

  return {
    id: row.id,
    label: row.label,
    queryText: deriveSavedResponseQueryText(row),
    categoryKey: canonicalFilterKey(family),
    objectionTypeKey: canonicalFilterKey(objectionRaw),
    objectionTypeDisplay: objectionRaw,
    toneKey: canonicalFilterKey(toneDisp),
    toneDisplay: toneDisp,
    strategyKey: canonicalFilterKey(stratDisp),
    strategyDisplay: stratDisp,
    hasStructuredReply,
    created_at: row.created_at,
  };
}

const WEIGHT_LABEL = 3;
const WEIGHT_PREVIEW = 3;
const WEIGHT_CONTENT = 2;
const WEIGHT_SECONDARY_FIELD = 1;

export function computeSavedResponseQueryScore(row: SavedResponseLike, queryRaw: string): number {
  const q = queryRaw.trim().toLowerCase();
  if (!q) return 0;

  let score = 0;
  const meta = row.metadata ?? null;

  if (row.label?.toLowerCase().includes(q)) score += WEIGHT_LABEL;

  const previewHay = joinQueryParts([
    metaTrimString(meta, "merchantObjection"),
    metaTrimString(meta, "objectionPreview"),
  ]).toLowerCase();
  if (previewHay.includes(q)) score += WEIGHT_PREVIEW;

  if (row.content?.toLowerCase().includes(q)) score += WEIGHT_CONTENT;

  for (const k of ["whatTheyReallyMean", "coachNote", "followUp"] as const) {
    const field = metaTrimString(meta, k)?.toLowerCase() ?? "";
    if (field.includes(q)) score += WEIGHT_SECONDARY_FIELD;
  }

  return score;
}

export type FilterOption = { value: string; label: string };

function putOption(map: Map<string, string>, key: string | null, label: string | null): void {
  if (!key || !label?.trim()) return;
  if (map.has(key)) return;
  map.set(key, label.trim());
}

export function deriveFilterOptionSets(views: SavedResponseFilterableView[]): {
  categories: FilterOption[];
  objectionTypes: FilterOption[];
  tones: FilterOption[];
  strategies: FilterOption[];
} {
  const catMap = new Map<string, string>();
  const objMap = new Map<string, string>();
  const toneMap = new Map<string, string>();
  const stratMap = new Map<string, string>();

  for (const v of views) {
    if (v.categoryKey) {
      putOption(
        catMap,
        v.categoryKey,
        formatFilterDisplayLabel("category", v.categoryKey, v.categoryKey)
      );
    }
    if (v.objectionTypeKey) {
      const raw = v.objectionTypeDisplay ?? v.objectionTypeKey;
      putOption(
        objMap,
        v.objectionTypeKey,
        formatFilterDisplayLabel("objectionType", raw, v.objectionTypeKey)
      );
    }
    if (v.toneKey && v.toneDisplay) {
      putOption(
        toneMap,
        v.toneKey,
        formatFilterDisplayLabel("tone", v.toneDisplay, v.toneKey)
      );
    }
    if (v.strategyKey && v.strategyDisplay) {
      putOption(
        stratMap,
        v.strategyKey,
        formatFilterDisplayLabel("strategy", v.strategyDisplay, v.strategyKey)
      );
    }
  }

  const toSorted = (m: Map<string, string>): FilterOption[] =>
    [...m.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

  return {
    categories: toSorted(catMap),
    objectionTypes: toSorted(objMap),
    tones: toSorted(toneMap),
    strategies: toSorted(stratMap),
  };
}

export function matchesStructuralFilters(
  view: SavedResponseFilterableView,
  filters: SavedResponseFilterState
): boolean {
  const catSel = filters.category.trim();
  if (catSel !== "" && view.categoryKey !== catSel) return false;

  const objSel = filters.objectionType.trim();
  if (objSel !== "" && view.objectionTypeKey !== objSel) return false;

  const toneSel = filters.tone.trim();
  if (toneSel !== "" && view.toneKey !== toneSel) return false;

  const stratSel = filters.strategy.trim();
  if (stratSel !== "" && view.strategyKey !== stratSel) return false;

  if (filters.structuredReply === "yes" && !view.hasStructuredReply) return false;
  if (filters.structuredReply === "no" && view.hasStructuredReply) return false;

  return true;
}

export function applySavedResponseFilters(
  rows: SavedResponseLike[],
  filters: SavedResponseFilterState
): SavedResponseLike[] {
  const q = filters.textQuery.trim();
  const qLower = q.toLowerCase();

  let out = rows.filter((row) => {
    const view = deriveSavedResponseFilterView(row);
    if (!matchesStructuralFilters(view, filters)) return false;
    if (qLower.length === 0) return true;
    return computeSavedResponseQueryScore(row, filters.textQuery) > 0;
  });

  if (qLower.length > 0) {
    out = [...out].sort((a, b) => {
      const sa = computeSavedResponseQueryScore(a, filters.textQuery);
      const sb = computeSavedResponseQueryScore(b, filters.textQuery);
      if (sb !== sa) return sb - sa;
      const ta = Date.parse(String(a.created_at ?? ""));
      const tb = Date.parse(String(b.created_at ?? ""));
      const na = Number.isFinite(ta) ? ta : 0;
      const nb = Number.isFinite(tb) ? tb : 0;
      if (nb !== na) return nb - na;
      // Final deterministic tie-breaker.
      const ida = String(a.id ?? "");
      const idb = String(b.id ?? "");
      return ida.localeCompare(idb);
    });
  }

  return out;
}

export function defaultSavedResponseFilters(): SavedResponseFilterState {
  return {
    textQuery: "",
    category: "",
    objectionType: "",
    tone: "",
    strategy: "",
    structuredReply: "all",
  };
}
