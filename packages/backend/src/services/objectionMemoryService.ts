import type { ObjectionMemoryRecord } from "../types/objectionMemory.js";

/**
 * OBJECTION MEMORY LAYER V1
 * In-memory store only (no DB). Passive recall for precall prompts only.
 */
const objectionMemoryStore: ObjectionMemoryRecord[] = [];

const MEMORY_PHRASE_FAMILIES: Record<string, string[]> = {
  payment_burden: ["payment", "daily", "weekly", "pull", "draft", "debit"],
  margin_pressure: ["margin", "profit", "net", "gross", "left", "leftover"],
  cashflow_instability: [
    "cashflow",
    "cash",
    "flow",
    "tight",
    "slow",
    "seasonal",
    "volatility",
    "week",
  ],
  competing_offers: [
    "cheaper",
    "better",
    "offer",
    "offers",
    "shopping",
    "rate",
    "elsewhere",
  ],
  hesitation: ["wait", "later", "thinking", "unsure", "not", "sure", "hold", "off"],
  trust_risk: ["trust", "skeptical", "real", "legit", "scam", "credible"],
};

const SIGNAL_WEIGHTS: Record<string, number> = {
  expensive_payment: 1,
  payment_burden: 2,
  margin_pressure: 3,
  cashflow_instability: 3,
  competing_offers: 2,
  hesitation: 1,
  trust_risk: 2,
  // internal: buildSignalKey currently returns "trust"
  trust: 2,
};

function signalWeight(signalKey: string | null | undefined): number {
  if (!signalKey) return 1;
  return SIGNAL_WEIGHTS[signalKey] ?? 1;
}

const CANONICAL_STOP_WORDS = new Set([
  "the",
  "a",
  "is",
  "it",
  "that",
  "this",
  "to",
  "your",
  "you",
  "my",
]);

const CANONICAL_TOKEN_BUCKETS: Record<string, string> = {
  // broad meaning only
  payment: "payment",
  daily: "payment",
  weekly: "payment",
  pull: "payment",
  draft: "payment",
  debit: "payment",

  margin: "margin",
  profit: "margin",
  net: "margin",
  gross: "margin",

  cashflow: "cashflow",
  cash: "cashflow",
  flow: "cashflow",
  tight: "cashflow",
  slow: "cashflow",
  seasonal: "cashflow",
  volatility: "cashflow",
  week: "cashflow",
  weeks: "cashflow",

  cheaper: "competing_offers",
  offer: "competing_offers",
  offers: "competing_offers",
  shopping: "competing_offers",
  rate: "competing_offers",
  elsewhere: "competing_offers",
  better: "competing_offers",

  wait: "hesitation",
  later: "hesitation",
  thinking: "hesitation",
  unsure: "hesitation",
  hold: "hesitation",
  off: "hesitation",
  sure: "hesitation",

  trust: "trust",
  skeptical: "trust",
  legit: "trust",
  scam: "trust",
  credible: "trust",
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

function getMatchedFamilies(text: string): Set<string> {
  const tokens = new Set(tokenize(text));
  const matched = new Set<string>();
  for (const [family, keywords] of Object.entries(MEMORY_PHRASE_FAMILIES)) {
    for (const k of keywords) {
      if (tokens.has(k)) {
        matched.add(family);
        break;
      }
    }
  }
  return matched;
}

function computeKeywordScore(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  let score = 0;
  tokensA.forEach((t) => {
    if (tokensB.has(t)) score += 1;
  });
  return score;
}

function computeFamilyScore(a: string, b: string): number {
  const famA = getMatchedFamilies(a);
  const famB = getMatchedFamilies(b);
  let score = 0;
  famA.forEach((f) => {
    if (famB.has(f)) score += 2;
  });
  return score;
}

function buildCanonicalKey(text: string): string {
  const out = new Set<string>();
  for (const t of tokenize(text)) {
    if (CANONICAL_STOP_WORDS.has(t)) continue;
    const bucket = CANONICAL_TOKEN_BUCKETS[t] ?? null;
    if (bucket) out.add(bucket);
  }
  // broad collapse: prefer a single dominant key when present
  if (out.has("competing_offers")) return "competing_offers";
  if (out.has("trust")) return "trust";
  if (out.has("hesitation")) return "hesitation";
  if (out.has("payment")) return "payment";
  if (out.has("margin")) return "margin";
  if (out.has("cashflow")) return "cashflow";
  return out.size ? Array.from(out).sort().join("_") : "unknown";
}

function buildSignalKey(text: string): string {
  const tokens = new Set(tokenize(text));
  // narrow semantic flavor; deterministic buckets (no embeddings)
  if (getMatchedFamilies(text).has("competing_offers")) return "competing_offers";
  if (getMatchedFamilies(text).has("trust_risk")) return "trust";
  if (getMatchedFamilies(text).has("hesitation")) return "hesitation";
  if (getMatchedFamilies(text).has("cashflow_instability")) return "cashflow_instability";
  if (getMatchedFamilies(text).has("margin_pressure")) return "margin_pressure";

  const hasPayment = getMatchedFamilies(text).has("payment_burden");
  if (hasPayment) {
    if (tokens.has("high") || tokens.has("expensive") || tokens.has("price")) {
      return "expensive_payment";
    }
    return "payment_burden";
  }
  return buildCanonicalKey(text);
}

function hashOpening(text: string): string {
  // Deterministic, cheap, no deps. Not crypto.
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h) ^ text.charCodeAt(i);
  }
  // unsigned 32-bit hex
  return (h >>> 0).toString(16).padStart(8, "0");
}

function extractOpeningLines(opening: string): string[] {
  return String(opening)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

const MEMORY_PRESSURE_STEMS = [
  "keeps",
  "dragging",
  "hitting",
  "eating",
  "chewing",
  "landing",
  "bleeding",
  "squeezing",
  "costing",
  "pulling",
  "wearing",
  "feeding",
  "chasing",
] as const;

const MEMORY_PAIN_NOUNS = [
  "cash flow",
  "cash",
  "margin",
  "payment",
  "pull",
  "number",
  "hole",
  "gap",
  "week",
  "sticker",
  "price",
  "rate",
] as const;

const MEMORY_STRONG_FORK_VERBS = [
  "fix",
  "lock",
  "handle",
  "solve",
  "stop",
  "clean up",
] as const;

function collectPressureVerbs(records: ObjectionMemoryRecord[]): string[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    const t = (r.generatedOpening ?? "").toLowerCase();
    for (const stem of MEMORY_PRESSURE_STEMS) {
      if (t.includes(stem)) {
        counts.set(stem, (counts.get(stem) ?? 0) + 1);
      }
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k]) => k)
    .slice(0, 6);
}

function collectPainNouns(records: ObjectionMemoryRecord[]): string[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    const t = (r.generatedOpening ?? "").toLowerCase();
    for (const noun of MEMORY_PAIN_NOUNS) {
      if (t.includes(noun)) {
        counts.set(noun, (counts.get(noun) ?? 0) + 1);
      }
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k]) => k)
    .slice(0, 7);
}

function extractAnchorFragments(records: ObjectionMemoryRecord[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    const lines = extractOpeningLines(r.generatedOpening ?? "");
    const line1 = (lines[0] ?? "").trim();
    if (!line1) continue;
    const cleaned = line1
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, " ")
      .replace(/[.?!]+$/g, "")
      .trim();
    const frag = cleaned.length > 64 ? cleaned.slice(0, 64).trim() : cleaned;
    const key = frag.toLowerCase();
    if (!frag || seen.has(key)) continue;
    seen.add(key);
    out.push(frag);
    if (out.length >= 4) break;
  }
  return out;
}

function extractDecisionForkPatterns(records: ObjectionMemoryRecord[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    const lines = extractOpeningLines(r.generatedOpening ?? "");
    const last = (lines[lines.length - 1] ?? "").trim();
    if (!last) continue;
    const lower = last.toLowerCase();
    if (!/\sor\s/.test(lower)) continue;
    if (!MEMORY_STRONG_FORK_VERBS.some((v) => lower.includes(v))) continue;
    const cleaned = last
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, " ")
      .replace(/[.?!]+$/g, "")
      .trim();
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= 4) break;
  }
  return out;
}

function inferDominantMemoryFrame(records: ObjectionMemoryRecord[]): string {
  const t = records
    .map((r) => `${r.rawUserMessage ?? ""} ${r.generatedOpening ?? ""}`.toLowerCase())
    .join(" ");

  const hasAny = (re: RegExp) => re.test(t);
  const countHits = (re: RegExp) => (t.match(re) ?? []).length;

  const sticker = countHits(/\b(price|sticker|number|high|expensive|rate)\b/g);
  const payDrain = countHits(/\b(daily|weekly|pull|payment|debit|draft)\b/g);
  const margin = countHits(/\b(margin|profit|net|gross|leftover|left)\b/g);
  const shop = countHits(/\b(cheaper|shop|shopping|elsewhere|other offer|better rate)\b/g);

  if (shop >= 2) return "shopping_noise_vs_real_fix";
  if (sticker >= 2 && (margin >= 1 || payDrain >= 1)) return "sticker_vs_unresolved_pain";
  if (payDrain >= 2 || hasAny(/\bkeeps\b.*\b(daily|weekly|pull|payment)\b/)) {
    return "ongoing_cash_drain";
  }
  if (margin >= 2) return "margin_pressure";
  return "direct_pain_to_decision";
}

export function buildMemoryGuidance(records: ObjectionMemoryRecord[]): string {
  if (!records || records.length === 0) return "";

  const anchors = extractAnchorFragments(records);
  const pressure = collectPressureVerbs(records);
  const nouns = collectPainNouns(records);
  const forks = extractDecisionForkPatterns(records);
  const frame = inferDominantMemoryFrame(records);

  const parts: string[] = [];
  parts.push("[MEMORY GUIDANCE]");
  parts.push("- Anchor pattern: blunt line 1 that names the pain directly.");
  if (anchors.length > 0) {
    parts.push(`- Anchor fragments seen: ${anchors.map((a) => `"${a}"`).join(" | ")}.`);
  }
  if (pressure.length > 0) {
    parts.push(`- Pressure language seen: ${pressure.join(" / ")}.`);
  }
  if (nouns.length > 0) {
    parts.push(`- Business nouns seen: ${nouns.join(", ")}.`);
  }
  if (forks.length > 0) {
    parts.push(`- Decision fork shapes seen: ${forks.map((f) => `"${f}"`).join(" | ")}.`);
  }
  parts.push(`- Dominant frame: ${frame}.`);
  parts.push("- Avoid exact reuse: do not copy any recalled line verbatim. Use the pattern, write fresh.");

  return parts.join("\n");
}

export type MemoryPatternProfileV9 = {
  openingStyle:
    | "blunt_pain_name"
    | "sticker_vs_margin"
    | "volatility_anchor"
    | "cheaper_vs_unsolved_hole"
    | "hesitation_vs_continued_drift"
    | "trust_gap_exposure"
    | "fallback";
  pressureCadence:
    | "blunt_then_consequence_then_fork"
    | "pain_then_ongoing_drain_then_decision"
    | "operational_risk_then_repeat_cost_then_action"
    | "short_heavy_short"
    | "fallback";
  dominantFrame:
    | "ongoing_cash_drain"
    | "sticker_vs_unresolved_pain"
    | "payment_burden"
    | "instability_cost"
    | "margin_compression"
    | "shopping_noise_vs_real_solution"
    | "hesitation_cost"
    | "trust_gap"
    | "fallback";
  painNouns: string[];
  pressureVerbs: string[];
  decisionForkShapes: string[];
  anchorFragments: string[];
};

function inferDominantFrameV9(records: ObjectionMemoryRecord[]): MemoryPatternProfileV9["dominantFrame"] {
  const frame = inferDominantMemoryFrame(records);
  switch (frame) {
    case "ongoing_cash_drain":
      return "ongoing_cash_drain";
    case "sticker_vs_unresolved_pain":
      return "sticker_vs_unresolved_pain";
    case "shopping_noise_vs_real_fix":
      return "shopping_noise_vs_real_solution";
    case "margin_pressure":
      return "margin_compression";
    default:
      return "fallback";
  }
}

function inferOpeningStyleV9(input: {
  frame: MemoryPatternProfileV9["dominantFrame"];
  records: ObjectionMemoryRecord[];
}): MemoryPatternProfileV9["openingStyle"] {
  const t = input.records
    .map((r) => `${r.rawUserMessage ?? ""} ${r.generatedOpening ?? ""}`.toLowerCase())
    .join(" ");
  if (/\b(cheaper|elsewhere|shop|shopping|other offer|better rate)\b/.test(t)) {
    return "cheaper_vs_unsolved_hole";
  }
  if (/\b(trust|legit|scam|credible|skeptic)\b/.test(t)) {
    return "trust_gap_exposure";
  }
  if (/\b(wait|later|hold off|thinking)\b/.test(t)) {
    return "hesitation_vs_continued_drift";
  }
  if (/\b(slow|seasonal|volatility|volatile|weeks?)\b/.test(t)) {
    return "volatility_anchor";
  }
  if (input.frame === "sticker_vs_unresolved_pain") return "sticker_vs_margin";
  return "blunt_pain_name";
}

function inferPressureCadenceV9(records: ObjectionMemoryRecord[]): MemoryPatternProfileV9["pressureCadence"] {
  const lines = records.flatMap((r) => extractOpeningLines(r.generatedOpening ?? ""));
  const hasThreeLine = records.some((r) => extractOpeningLines(r.generatedOpening ?? "").length === 3);
  const hasKeeps = lines.some((l) => /\bkeeps\b/i.test(l));
  const hasFork = lines.some((l) => /\sor\s/i.test(l));
  const hasOperational = lines.some((l) =>
    /\b(pipeline|payroll|volume|weeks?|float|cash flow|cashflow)\b/i.test(l)
  );
  if (hasThreeLine && hasKeeps && hasFork) return "pain_then_ongoing_drain_then_decision";
  if (hasOperational && hasKeeps && hasFork) return "operational_risk_then_repeat_cost_then_action";
  if (hasFork) return "blunt_then_consequence_then_fork";
  return "fallback";
}

export function buildMemoryPatternProfile(records: ObjectionMemoryRecord[]): MemoryPatternProfileV9 | null {
  if (!records || records.length === 0) return null;
  const painNouns = collectPainNouns(records);
  const pressureVerbs = collectPressureVerbs(records);
  const decisionForkShapes = extractDecisionForkPatterns(records).slice(0, 5);
  const anchorFragments = extractAnchorFragments(records).slice(0, 5);
  const dominantFrame = inferDominantFrameV9(records);
  const openingStyle = inferOpeningStyleV9({ frame: dominantFrame, records });
  const pressureCadence = inferPressureCadenceV9(records);
  return {
    openingStyle,
    pressureCadence,
    dominantFrame,
    painNouns,
    pressureVerbs,
    decisionForkShapes,
    anchorFragments,
  };
}

export function buildPatternDrivenMemoryGuidance(
  records: ObjectionMemoryRecord[]
): string {
  const profile = buildMemoryPatternProfile(records);
  if (!profile) return "";

  const lines: string[] = [];
  lines.push("[MEMORY PATTERN PROFILE]");
  lines.push(`- Opening style to prefer: ${profile.openingStyle}`);
  lines.push(`- Pressure cadence to prefer: ${profile.pressureCadence}`);
  lines.push(`- Dominant frame: ${profile.dominantFrame}`);
  if (profile.painNouns.length > 0) {
    lines.push(`- Pain nouns seen: ${profile.painNouns.join(", ")}`);
  }
  if (profile.pressureVerbs.length > 0) {
    lines.push(`- Pressure verbs seen: ${profile.pressureVerbs.join(" / ")}`);
  }
  if (profile.decisionForkShapes.length > 0) {
    lines.push(
      `- Decision fork shapes seen: ${profile.decisionForkShapes
        .map((s) => `"${s}"`)
        .join(" | ")}`
    );
  }
  if (profile.anchorFragments.length > 0) {
    lines.push(
      `- Anchor fragments seen: ${profile.anchorFragments
        .map((s) => `"${s}"`)
        .join(" | ")}`
    );
  }
  lines.push("- Use the learned pattern, but do NOT copy any recalled line verbatim.");
  lines.push("- Write fresh language in the same structural family.");
  lines.push("- Prefer the memory-backed framing when it fits the current objection.");

  return lines.join("\n");
}

export function saveObjectionMemory(record: ObjectionMemoryRecord) {
  const canonicalKey = buildCanonicalKey(record.rawUserMessage);
  const signalKey = buildSignalKey(record.rawUserMessage);
  const existing = objectionMemoryStore.find(
    (r) =>
      r.canonicalKey === canonicalKey &&
      r.objectionAssertionFamily === record.objectionAssertionFamily
  );
  if (existing) {
    existing.usageCount += 1;
    existing.lastUsedAt = new Date().toISOString();
    if (!existing.signalKey) {
      existing.signalKey = signalKey;
    }
    return;
  }

  const usageCount = Number.isFinite(record.usageCount) ? record.usageCount : 0;
  const lastUsedAt = record.lastUsedAt;
  const variationHash = hashOpening(record.generatedOpening);

  objectionMemoryStore.push({
    ...record,
    canonicalKey,
    signalKey,
    variationHash,
    usageCount,
    lastUsedAt,
  });
}

export function markObjectionMemoryUsed(id: string) {
  const record = objectionMemoryStore.find((r) => r.id === id);
  if (!record) return;
  record.usageCount += 1;
  record.lastUsedAt = new Date().toISOString();
}

export function findSimilarObjections(input: {
  normalizedObjectionType: string;
  objectionAssertionFamily: string;
  userMessage: string;
}): ObjectionMemoryRecord[] {
  const { normalizedObjectionType, objectionAssertionFamily, userMessage } = input;
  const userText = userMessage;
  const ranked = objectionMemoryStore
    .filter(
      (r) =>
        r.normalizedObjectionType === normalizedObjectionType ||
        r.objectionAssertionFamily === objectionAssertionFamily
    )
    .map((record) => ({
      record,
      relevanceScore:
        computeKeywordScore(userText, record.rawUserMessage) +
        computeFamilyScore(userText, record.rawUserMessage),
    }))
    .sort((a, b) => {
      // 1. relevanceScore DESC
      if (b.relevanceScore !== a.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      // 2. usageCount DESC
      if (b.record.usageCount !== a.record.usageCount) {
        return b.record.usageCount - a.record.usageCount;
      }
      // 3. lastUsedAt DESC
      if (b.record.lastUsedAt && a.record.lastUsedAt) {
        return (
          new Date(b.record.lastUsedAt).getTime() -
          new Date(a.record.lastUsedAt).getTime()
        );
      }
      // 4. createdAt DESC
      return (
        new Date(b.record.createdAt).getTime() -
        new Date(a.record.createdAt).getTime()
      );
    })
    .map((x) => x.record);

  // Diversity: avoid returning near-duplicates (same canonicalKey).
  const seen = new Set<string>();
  const unique: ObjectionMemoryRecord[] = [];
  for (const r of ranked) {
    if (!r.canonicalKey) {
      unique.push(r);
      continue;
    }
    if (seen.has(r.canonicalKey)) continue;
    seen.add(r.canonicalKey);
    unique.push(r);
  }

  // Fill top 3 preferring signalKey diversity when options exist.
  // V7: weights only break ties inside the same sorted priority bucket (no global re-ranking).
  const picked: ObjectionMemoryRecord[] = [];
  const seenSignals = new Set<string>();
  const signalCounts = new Map<string, number>();
  const remaining = [...unique];
  while (picked.length < 3 && remaining.length > 0) {
    if (picked.length === 0) {
      const first = remaining.shift()!;
      picked.push(first);
      if (first.signalKey) {
        seenSignals.add(first.signalKey);
        signalCounts.set(first.signalKey, (signalCounts.get(first.signalKey) ?? 0) + 1);
      }
      continue;
    }
    // V7.1: unseen signals are NOT always better — weak unseen should not override strong seen.
    // We do NOT change the global ranking. We only choose between (a) best unseen-signal option
    // and (b) the next in-order option whose signalKey is already seen.
    const unseen = remaining
      .map((r, i) => ({ r, i }))
      .filter((x) => x.r.signalKey && !seenSignals.has(x.r.signalKey));
    const bestUnseen =
      unseen.length > 0
        ? unseen.sort((a, b) => {
            const dw = signalWeight(b.r.signalKey) - signalWeight(a.r.signalKey);
            return dw !== 0 ? dw : a.i - b.i;
          })[0]!
        : null;

    const nextSeenIdx = remaining.findIndex(
      (r) => r.signalKey && seenSignals.has(r.signalKey)
    );
    const nextSeen =
      nextSeenIdx >= 0 ? { r: remaining[nextSeenIdx]!, i: nextSeenIdx } : null;

    let pickIndex: number;
    if (bestUnseen && nextSeen) {
      const wu = signalWeight(bestUnseen.r.signalKey);
      const ws = signalWeight(nextSeen.r.signalKey);
      pickIndex = wu >= ws ? bestUnseen.i : nextSeen.i;
    } else if (bestUnseen) {
      pickIndex = bestUnseen.i;
    } else {
      // If we have no unseen signals left, keep existing order.
      pickIndex = 0;
    }

    let next = remaining.splice(pickIndex, 1)[0]!;

    // V7.2: signal saturation guard — avoid 3-of-the-same signalKey when alternatives exist.
    const sig = next.signalKey ?? "";
    const sigCount = sig ? (signalCounts.get(sig) ?? 0) : 0;
    if (sig && sigCount >= 2 && remaining.length > 0) {
      const wNext = signalWeight(sig);
      // Look ahead for an alternative with a different signalKey and non-extreme weight drop.
      // Deterministic: only consider the next few in-order candidates (keeps relevance "close").
      const LOOKAHEAD = 6;
      let altIndex = -1;
      for (let i = 0; i < Math.min(LOOKAHEAD, remaining.length); i++) {
        const r = remaining[i]!;
        const rSig = r.signalKey ?? "";
        if (!rSig) continue;
        if (rSig === sig) continue;
        const rCount = signalCounts.get(rSig) ?? 0;
        if (rCount >= 2) continue;
        const wAlt = signalWeight(rSig);
        // Allow swap when weight difference is not extreme.
        if (wAlt >= wNext - 1) {
          altIndex = i;
          break;
        }
      }
      if (altIndex >= 0) {
        // put saturated pick back at front, take alternative instead
        remaining.unshift(next);
        next = remaining.splice(altIndex + 1, 1)[0]!;
      }
    }
    picked.push(next);
    if (next.signalKey) {
      seenSignals.add(next.signalKey);
      signalCounts.set(next.signalKey, (signalCounts.get(next.signalKey) ?? 0) + 1);
    }
  }
  return picked;
}

