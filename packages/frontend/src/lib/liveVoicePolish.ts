/**
 * ============================================================================
 * V10 — Stable Live Baseline (Post QA + Distribution Fix)
 * ============================================================================
 * Status: LOCKED
 * Scope: Live-only presentation layer (speakable script text in the UI).
 * Determinism: Required — no randomness; same inputs → same display output.
 *
 * Locked behavior includes:
 * - Collapse handling for backend hesitation calibration templates (display-only).
 * - Fallback distribution: hash-based index for generic alternates (not length-mod).
 * - Narrow, ordered regex for soft lead-in stripping and “What specifically” tighten.
 *
 * QA: Passed. No architectural changes in this layer.
 *
 * DO NOT MODIFY WITHOUT EXPLICIT VERSION BUMP (V11+).
 * Future work must build on top of this baseline, not silently alter V10 semantics.
 * ============================================================================
 *
 * LIVE-only, presentation-layer polish: tighter closer cadence without changing
 * objection family or backend payloads. Deterministic, rule-based, easy to revert.
 *
 * Note: Known “hesitation calibration” collapse lines are emitted by the backend
 * refinement layer; we only diversify *display* here when those exact templates
 * appear, using `situationLabel` already on the Live HUD (no API changes).
 *
 * ---------------------------------------------------------------------------
 * LIVE-ONLY — Instant / Deep must NOT import or reuse this module without
 * explicit product approval. This is not shared “coach copy” infrastructure.
 * ---------------------------------------------------------------------------
 *
 * V11 Phase 1 (Live only, display): Narrow upgrades for REQUEST / HESITATION /
 * BRUSH_OFF alternates, one generic threshold line, and exact legacy phrase pass.
 * V11 Phase 2: COMPARISON / FIT_STYLE / TRUST alternates, one generic slot, legacy pairs.
 * V11 Phase 3: Sequence spacing — one-step lookback; same surface family + approved exact
 * line → deterministic alternate if alternate !== previous (no hash/collapse changes).
 * V11 Phase 4: Final micro-filter — narrow exact/substring rules after Phase 3 (coaching block,
 * weak “has to be true” / break / hesitation / need lines, safe commercial anchor injection).
 * Collapse detection + hash index distribution unchanged from V10.
 */

export type LiveVoicePolishContext = {
  /** From `liveResponseVisibility.situationLabel` — routes display-only alternates. */
  situationLabel?: string | null;
  /** Optional: final polished line from the immediately previous Live message (same thread). */
  previousLiveDisplayLine?: string | null;
};

/**
 * Soft lead-in strip (line-start only, ordered patterns).
 * Why: Removes redundant consultant-style openers so Live reads sharper on-call.
 * Must NOT: Broaden to mid-string matches, or strip em-dash forms (e.g. “Got it—”) — those stay intentional.
 */
function stripLeadingSoftOpenersOnce(line: string): string {
  const patterns: RegExp[] = [
    /^I completely understand where you(?:'|’|')re coming from\.?\s+/i,
    /^I understand what you(?:'|’|')re saying\.?\s+/i,
    /^I hear what you(?:'|’|')re saying\.?\s+/i,
    /^(?:I understand|I hear you|Got it|Fair enough|Totally|Sure|Of course|Honestly|Look)(?:\.|,)\s+/i,
    /^That makes sense(?:\.|,|—|–|-)\s*/i,
  ];
  let t = line;
  for (const re of patterns) {
    const next = t.replace(re, "");
    if (next !== t) return next;
  }
  return t;
}

/**
 * Collapse detection — backend hesitation calibration templates.
 * Problem solved: Same two template strings were repeating across unrelated objections in display.
 * Must NOT: Broaden match conditions (false positives would replace real script lines).
 */
function isCollapsedHesitationTemplate(line: string): boolean {
  const t = line.trim().toLowerCase();
  return (
    t.includes("walk me through the one gap") &&
    (t.startsWith("that usually means") || t.startsWith("that reads as"))
  );
}

/**
 * Display-only alternates when collapse template matches — situationLabel first, else generic set.
 * Deterministic probes; no shared “gap” closer phrasing from the old template cluster.
 */
function displayAlternateForHesitationCollapse(
  line: string,
  ctx: LiveVoicePolishContext | undefined
): string {
  const sit = (ctx?.situationLabel ?? "").trim().toUpperCase();
  const bySituation: Record<string, string> = {
    STALL:
      "What's the real timing issue—what has to happen before this is worth doing?",
    HESITATION:
      "What has to change by when for this to be a yes?",
    COMPARISON:
      "What would they have to stop delivering for you to even compare this week?",
    REQUEST:
      "What's the one thing that changes your decision—pricing, terms, or proof?",
    TRUST:
      "What would verify it for you in one step—a reference, a term sheet, or a controlled pilot?",
    PRICE: "Which number are you stuck on—payment, total cost, or payback?",
    BRUSH_OFF: "Is this a hard no, or a no to this structure?",
    FIT_STYLE:
      "If nothing's broken, what metric moves first if you stay put—cash, time, or risk?",
    CREDIT: "What credit outcome are you solving for—approval, cost, or control?",
    TAX: "What tax outcome are you trying to lock in with this structure?",
    GENERAL: "What's the real objection under this—say it direct.",
    REJECTION: "Dead stop—what would change your mind in the next two minutes?",
  };
  if (sit && bySituation[sit]) return bySituation[sit]!;
  /*
   * === GENERIC FALLBACK SELECTION (V10 LOCKED) ===
   * Prior issue: Using `line.length % generic.length` clustered on one bucket because
   * collapse template strings have fixed lengths with the same mod-3 residue — one phrase dominated.
   * Fix: Rolling hash over the full trimmed line → even deterministic spread across generics.
   *
   * Do not revert to length-based selection.
   * Do not introduce randomness.
   * Deterministic distribution is required.
   * ===
   */
  const generic = [
    "Name the one gap that decides this—if it's not that, we move forward.",
    "Name what has to be true before this moves forward.",
    "What has to change by when for this to be a yes?",
  ] as const;
  let h = 0;
  const s = line.trim();
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  /* Hash-based index: preserves determinism and balances generic alternates (see block above). */
  const idx = h % generic.length;
  return generic[idx]!;
}

/** V11 Phase 1: exact full-line upgrades for legacy V10 phrases (non-regex; deterministic). */
const V11_PHASE1_EXACT_LEGACY: ReadonlyArray<readonly [string, string]> = [
  [
    "What do you need first so the next step isn't guesswork?",
    "What's the one thing that changes your decision—pricing, terms, or proof?",
  ],
  [
    "Say the real concern in one sentence—what risk are you actually avoiding?",
    "What has to change by when for this to be a yes?",
  ],
  [
    "What would need to be true for this to earn another look?",
    "Is this a hard no, or a no to this structure?",
  ],
  [
    "Cut to the decision—what's still unresolved?",
    "What has to change by when for this to be a yes?",
  ],
  [
    "Against what you have today—what decision are you actually trying to make?",
    "What would they have to stop delivering for you to even compare this week?",
  ],
  [
    "If everything's working—what outcome are you protecting, exactly?",
    "If nothing's broken, what metric moves first if you stay put—cash, time, or risk?",
  ],
  [
    "Pin it to one thing—is it proof, structure, or timing?",
    "What would verify it for you in one step—a reference, a term sheet, or a controlled pilot?",
  ],
  [
    "What's the real blocker—say it in one sentence.",
    "Name the one gap that decides this—if it's not that, we move forward.",
  ],
];

function applyV11Phase1ExactLegacyUpgrade(line: string): string {
  const t = line.trim();
  for (const [from, to] of V11_PHASE1_EXACT_LEGACY) {
    if (t === from) return to;
  }
  return line;
}

/** Phase 3: local display labels for spacing only — not architecture. */
type Phase3SurfaceFamily =
  | "threshold"
  | "fork"
  | "clarification"
  | "reality_check"
  | "blocker";

/** Exact strings only — must match current V11 display lines character-for-character. */
const PHASE3_FAMILY_BY_LINE: Readonly<Record<string, Phase3SurfaceFamily>> = {
  "What has to change by when for this to be a yes?": "threshold",
  "What date or condition makes this worth revisiting?": "threshold",
  "Is this a hard no, or a no to this structure?": "fork",
  "Are you out on the idea, or just this version of it?": "fork",
  "What's the one thing that changes your decision—pricing, terms, or proof?":
    "clarification",
  "Which one are you judging this on—pricing, terms, or proof?": "clarification",
  "If nothing's broken, what metric moves first if you stay put—cash, time, or risk?":
    "reality_check",
  "If you keep it as-is, what gets hit first—cash, time, or risk?": "reality_check",
  "Name the one gap that decides this—if it's not that, we move forward.":
    "blocker",
  "What's the single gap that decides this?": "blocker",
};

const PHASE3_SPACING_ALTERNATE: Readonly<Record<string, string>> = {
  "What has to change by when for this to be a yes?":
    "What date or condition makes this worth revisiting?",
  "What date or condition makes this worth revisiting?":
    "What has to change by when for this to be a yes?",
  "Is this a hard no, or a no to this structure?":
    "Are you out on the idea, or just this version of it?",
  "Are you out on the idea, or just this version of it?":
    "Is this a hard no, or a no to this structure?",
  "What's the one thing that changes your decision—pricing, terms, or proof?":
    "Which one are you judging this on—pricing, terms, or proof?",
  "Which one are you judging this on—pricing, terms, or proof?":
    "What's the one thing that changes your decision—pricing, terms, or proof?",
  "If nothing's broken, what metric moves first if you stay put—cash, time, or risk?":
    "If you keep it as-is, what gets hit first—cash, time, or risk?",
  "If you keep it as-is, what gets hit first—cash, time, or risk?":
    "If nothing's broken, what metric moves first if you stay put—cash, time, or risk?",
  "Name the one gap that decides this—if it's not that, we move forward.":
    "What's the single gap that decides this?",
  "What's the single gap that decides this?":
    "Name the one gap that decides this—if it's not that, we move forward.",
};

function inferPhase3SurfaceFamily(line: string): Phase3SurfaceFamily | null {
  const t = line.trim();
  return PHASE3_FAMILY_BY_LINE[t] ?? null;
}

/**
 * If previous and current share a Phase3 family and both are approved exact lines,
 * swap current to its deterministic alternate only when that alternate !== previous (anti-echo).
 */
function applyPhase3Spacing(
  current: string,
  previousLine: string | null | undefined
): string {
  const cur = current.trim();
  const prev = previousLine?.trim() ?? "";
  if (!cur || !prev) return current;
  const fc = inferPhase3SurfaceFamily(cur);
  const fp = inferPhase3SurfaceFamily(prev);
  if (fc == null || fp == null || fc !== fp) return current;
  const alt = PHASE3_SPACING_ALTERNATE[cur];
  if (alt == null || alt === cur) return current;
  if (alt === prev) return current;
  return alt;
}

/** V11 Phase 4: one-pass deterministic micro-filter (exact/narrow patterns only). */
function applyV11MicroFilter(line: string): string {
  if (line.includes("\n") || line.includes("\r")) {
    return line
      .split(/\r?\n/)
      .map((row) => applyV11MicroFilter(row))
      .join("\n")
      .trim();
  }

  const raw = line;
  const t = line.trim();
  if (!t) return raw;

  const lower = t.toLowerCase();

  // RULE 1 — block coaching drift (full-line replace; runs before Rule 7 guard).
  const rule1Needles = [
    "surface concern",
    "it's about whether",
    "reflection",
    "becomes drift",
    "alignment",
    "framework",
    "decision process",
  ] as const;
  for (const n of rule1Needles) {
    if (lower.includes(n)) {
      return "Heard—what specifically needs to change for this to be a yes?";
    }
  }

  // RULE 7 — no-op safety (fork / threshold / commercial anchor): skip Rules 2–6.
  const hasFork = /\s+or\s+/i.test(t);
  const hasThreshold =
    lower.includes("by when") ||
    lower.includes("what date") ||
    lower.includes("what number");
  const hasCommercialAnchor =
    lower.includes("price") ||
    lower.includes("payment") ||
    lower.includes("terms") ||
    lower.includes("risk") ||
    lower.includes("cash");
  if (hasFork || hasThreshold || hasCommercialAnchor) {
    return raw;
  }

  // RULE 2 — upgrade generic “what has to be true”
  if (
    t.startsWith("What has to be true") ||
    t.startsWith("Name what has to be true")
  ) {
    const hasPsrs =
      lower.includes("price") ||
      lower.includes("terms") ||
      lower.includes("risk") ||
      lower.includes("structure");
    if (!hasPsrs) {
      return "What has to be true—price, structure, or risk—for this to move forward?";
    }
  }

  // RULE 3 — upgrade “where does it break”
  if (
    lower.includes("where specifically does it break") ||
    lower.includes("where does it break")
  ) {
    const hasCategoryFork =
      lower.includes("payment") ||
      lower.includes("terms") ||
      lower.includes("risk");
    if (!hasCategoryFork) {
      return "Where does it break—payment, terms, or risk?";
    }
  }

  // RULE 4 — hesitation without target
  if (
    lower.includes("think about it") ||
    lower.includes("take time") ||
    lower.includes("circle back")
  ) {
    const hasWhen =
      lower.includes("by when") ||
      lower.includes("date") ||
      lower.includes("condition") ||
      /\bwhen\b/i.test(t);
    if (!hasWhen) {
      return "If you take time, what has to change by when for this to be a yes?";
    }
  }

  // RULE 5 — upgrade generic clarification
  if (
    lower.includes("what do you need first") ||
    lower.includes("what do you need")
  ) {
    return "What's the one thing that changes your decision—pricing, terms, or proof?";
  }

  // RULE 6 — minimal commercial anchor injection (substring only)
  const triggersRule6 =
    lower.includes("outcome") ||
    lower.includes("move forward") ||
    lower.includes("make sense");
  const hasRule6Anchor =
    lower.includes("price") ||
    lower.includes("payment") ||
    lower.includes("terms") ||
    lower.includes("risk") ||
    lower.includes("cash");
  if (triggersRule6 && !hasRule6Anchor && /\bmove forward\b/i.test(t)) {
    return t.replace(/\bmove forward\b/gi, "move forward on price, terms, or risk");
  }

  return raw;
}

function isConstraintStyleLine(line: string): boolean {
  const t = line.trim();
  return (
    t.startsWith("What has to be true") ||
    t.startsWith("What has to change") ||
    t.startsWith("What has to change by when") ||
    t.startsWith("Heard—what specifically needs to change")
  );
}

type ConstraintGateFamily =
  | "price_total_cost"
  | "payment_burden"
  | "trust_control"
  | "comparison_incumbent"
  | "timing_delay"
  | "review_approval";

function normalizeConstraintCueSourceText(sourceText: string): string {
  return sourceText
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"');
}

/** Phase 6.2 — shared deterministic cue lists (family inference + injection triggers stay aligned). */
const PH62_TRUST_CUES = [
  "what i'm signing",
  "what im signing",
  "structured right",
  "who's real",
  "whos real",
  "don't want surprises",
  "dont want surprises",
  "bad deal",
  "headache",
  "trap",
  "locked into",
  "can't control",
  "cant control",
  "in writing",
  "fully understand",
  "understand what i'm signing",
  "understand what im signing",
  "how do i know",
  "last time",
  "didn't go how i expected",
  "didnt go how i expected",
  "hidden",
  "surprises",
] as const;

const PH62_TRUST_LEGITIMACY_CUES = [
  "trap",
  "bad deal",
  "headache",
  "hidden",
  "surprises",
  "don't want surprises",
  "dont want surprises",
  "how do i know",
  "who's real",
  "whos real",
  "structured right",
  "can't control",
  "cant control",
  "locked into",
  "in writing",
  "what i'm signing",
  "what im signing",
  "understand what i'm signing",
  "understand what im signing",
  "didn't go how i expected",
  "didnt go how i expected",
] as const;

const PH62_PAYMENT_STRAIN_CUES = [
  "daily pull",
  "daily payment",
  "daily debit",
  "every single day",
  "squeezed",
  "cash flow",
  "payroll",
  "week to week",
  "week-to-week",
  "weekly cash flow",
  "daily hit",
  "heavy",
  "hits every friday",
  "manage jobs week to week",
  "payment is too expensive",
] as const;

const PH62_PAYMENT_CUES = [
  ...PH62_PAYMENT_STRAIN_CUES,
  "debit",
  "burden",
] as const;

const PH62_PRICE_CUES = [
  "payback",
  "total back",
  "too much back",
  "steep for",
  "too expensive",
  "price has to change",
  "cost more than",
  "costs more than",
  "too high for the amount",
  "amount i'm getting",
  "amount im getting",
  "over 70000",
  "70,000",
  "70000",
  "85k",
  "expensive for what it is",
  "price",
  "cost",
] as const;

const PH62_REVIEW_CUES = [
  "run this by my partner",
  "partner",
  "my partner",
  "my guy",
  "run it by",
  "review it",
  "send it to me",
  "look everything over",
  "let me review it",
  "need to look it over",
  "before i commit",
  "before i move on anything",
] as const;

const PH62_COMPARISON_CUES = [
  "current lender",
  "my current lender",
  "current provider",
  "my guy might",
  "someone better",
  "do something better",
  "usually work with",
  "go through",
  "someone i usually work with",
  "usual lender",
  "usual guy",
  "my guy",
  "check with him first",
  "already have someone",
] as const;

const PH62_TIMING_CUES = [
  "not right now",
  "next month",
  "next couple weeks",
  "after i get paid",
  "money coming in",
  "same-day decisions",
  "don't make same-day decisions",
  "dont make same-day decisions",
  "let me think on it",
  "let me think about it",
  "see how this plays out",
  "circle back",
  "not today",
  "think about it",
  "not rush",
  "later",
  "receivables",
  "wait",
  "not now",
] as const;

function inferConstraintGateFamilyFromSourceText(
  sourceText: string,
  situationLabel: string | null | undefined
): ConstraintGateFamily | null {
  const src = normalizeConstraintCueSourceText(sourceText);
  const sit = (situationLabel ?? "").trim().toUpperCase();

  // Narrow cue checks (deterministic; no fuzzy scoring).
  const hasAny = (needles: readonly string[]) => needles.some((n) => src.includes(n));

  const trustMatch = sit === "TRUST" || hasAny(PH62_TRUST_CUES);
  const paymentMatch = hasAny(PH62_PAYMENT_CUES);
  const paymentStrainMatch = hasAny(PH62_PAYMENT_STRAIN_CUES);
  const priceMatch = sit === "PRICE" || hasAny(PH62_PRICE_CUES);
  const reviewMatch = hasAny(PH62_REVIEW_CUES);
  const comparisonMatch = sit === "COMPARISON" || hasAny(PH62_COMPARISON_CUES);
  const timingMatch =
    sit === "STALL" || sit === "HESITATION" || hasAny(PH62_TIMING_CUES);

  // Priority order + tie-breaks (Phase 6.2 — family capture correction):
  // 1 trust, 2 payment burden, 3 price, 4 review, 5 comparison, 6 timing.

  if (trustMatch) {
    if (comparisonMatch && !hasAny(PH62_TRUST_LEGITIMACY_CUES))
      return "comparison_incumbent";
    return "trust_control";
  }

  if (paymentMatch) {
    if (priceMatch && paymentStrainMatch) return "payment_burden";
    if (priceMatch && !paymentStrainMatch) return "price_total_cost";
    return "payment_burden";
  }

  if (priceMatch) return "price_total_cost";
  if (reviewMatch) return "review_approval";
  if (comparisonMatch) return "comparison_incumbent";
  if (timingMatch) return "timing_delay";

  return null;
}

function objectionIsExplicitlyConditional(sourceText: string): boolean {
  const s = sourceText.trim().toLowerCase();
  return (
    s.includes("if ") ||
    s.includes("unless") ||
    s.includes("depends") ||
    s.includes("as long as") ||
    s.includes("provided") ||
    s.includes("would need") ||
    s.includes("need it to") ||
    s.includes("needs to") ||
    s.includes("has to")
  );
}

function applyV11ConstraintGateAndRebalance(
  finalLine: string,
  sourceText: string,
  ctx: LiveVoicePolishContext | undefined
): string {
  if (!isConstraintStyleLine(finalLine)) return finalLine;
  if (objectionIsExplicitlyConditional(sourceText)) return finalLine;

  const family = inferConstraintGateFamilyFromSourceText(
    sourceText,
    ctx?.situationLabel ?? null
  );
  if (family == null) return finalLine;

  if (family === "price_total_cost") {
    return "What part is off—the total payback, the daily hit, or the structure around it?";
  }
  if (family === "payment_burden") {
    return "Is it the daily hit itself, or what it does to payroll and week-to-week cash flow?";
  }
  if (family === "trust_control") {
    return "What specifically has to be clear in writing for this to feel controlled?";
  }
  if (family === "comparison_incumbent") {
    return "What would they have to beat or change for you to move this away from them?";
  }
  if (family === "timing_delay") {
    return "What changes by when that would make this worth doing?";
  }
  return "What are they going to focus on first—the payback, the daily hit, or the terms?";
}

function shouldInjectDominantStrategy(
  sourceText: string,
  family: ConstraintGateFamily
): boolean {
  const s = normalizeConstraintCueSourceText(sourceText);
  const hasAny = (needles: readonly string[]) => needles.some((n) => s.includes(n));

  if (family === "price_total_cost") {
    return hasAny(PH62_PRICE_CUES);
  }
  if (family === "payment_burden") {
    return hasAny(PH62_PAYMENT_CUES);
  }
  if (family === "trust_control") {
    return hasAny(PH62_TRUST_CUES);
  }
  if (family === "comparison_incumbent") {
    return hasAny(PH62_COMPARISON_CUES);
  }
  if (family === "timing_delay") {
    return hasAny(PH62_TIMING_CUES);
  }
  return hasAny(PH62_REVIEW_CUES);
}

function injectDominantStrategy(
  sourceText: string,
  family: ConstraintGateFamily,
  currentLine: string
): string {
  const cur = currentLine.trim();
  if (!cur) return currentLine;

  function isUpgradeableGenericLine(line: string): boolean {
    const t = line.trim().toLowerCase();
    if (!t) return false;

    // Hard exclusions: do NOT treat already-strong commercial/contextual lines as upgradeable.
    const strongNeedles = [
      "in writing",
      "payroll",
      "weekly cash flow",
      "total payback",
      "daily burden",
      "cost, speed, or flexibility",
      "what changes by when that turns this from",
      "what are they going to zero in on first",
      "what has to be spelled out in writing",
      "what would they have to lose on",
      "is the daily hit itself too heavy",
      "the total payback earns its place",
    ] as const;
    for (const n of strongNeedles) {
      if (t.includes(n)) return false;
    }

    // Narrow generic-opening / diagnostic shapes only (lowercase trimmed prefix checks).
    return (
      t.startsWith("what part") ||
      t.startsWith("what specifically") ||
      t.startsWith("what has to") ||
      t.startsWith("makes sense—what") ||
      t.startsWith("heard—what") ||
      t.startsWith("what would need")
    );
  }

  // Protection rule: only upgrade the known "safe rebalanced" questions (or constraint-style lines).
  // Never overwrite stronger custom lines.
  const allowedSafeLines = [
    "What part is off—the total payback, the daily hit, or the structure around it?",
    "Is it the daily hit itself, or what it does to payroll and week-to-week cash flow?",
    "What specifically has to be clear in writing for this to feel controlled?",
    "What would they have to beat or change for you to move this away from them?",
    "What changes by when that would make this worth doing?",
    "What are they going to focus on first—the payback, the daily hit, or the terms?",
  ] as const;
  const isAllowedBaseline =
    allowedSafeLines.includes(cur as (typeof allowedSafeLines)[number]) ||
    isConstraintStyleLine(cur) ||
    isUpgradeableGenericLine(cur);
  if (!isAllowedBaseline) return currentLine;

  // Do not inject on explicitly conditional objections (constraint is correct).
  if (objectionIsExplicitlyConditional(sourceText)) return currentLine;

  if (!shouldInjectDominantStrategy(sourceText, family)) return currentLine;

  if (family === "price_total_cost") {
    return "The issue isn’t whether it costs money—it’s whether the total payback earns its place. Is the real problem the total back, the daily burden, or both?";
  }
  if (family === "payment_burden") {
    return "Then let’s call it what it is—is the daily hit itself too heavy, or does it only break when it collides with payroll and weekly cash flow?";
  }
  if (family === "trust_control") {
    return "Then control is the issue, not interest alone. What has to be spelled out in writing so this feels controlled before you sign anything?";
  }
  if (family === "comparison_incumbent") {
    return "Fair—then this only moves if there’s a real difference. What would they have to lose on—cost, speed, or flexibility—for you to move this off your current guy?";
  }
  if (family === "timing_delay") {
    return "Then timing is the variable. What changes by when that turns this from ‘wait’ into ‘do it now’?";
  }
  return "Good—so let’s not make review a stall. What are they going to zero in on first—the payback, the daily hit, or the terms?";
}

function applyV11DominantStrategyInjection(
  currentLine: string,
  sourceText: string,
  ctx: LiveVoicePolishContext | undefined
): string {
  const family = inferConstraintGateFamilyFromSourceText(
    sourceText,
    ctx?.situationLabel ?? null
  );
  if (family == null) return currentLine;
  return injectDominantStrategy(sourceText, family, currentLine);
}

/** Phase 6.3 — controlled deterministic family variation (no randomness; Live-only). */
function normalizeFamilyVariationEchoKey(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'");
}

function isUpgradeableGenericLineForFamilyVariation(line: string): boolean {
  const t = line.trim().toLowerCase();
  if (!t) return false;

  const strongNeedles = [
    "in writing",
    "payroll",
    "weekly cash flow",
    "total payback",
    "daily burden",
    "cost, speed, or flexibility",
    "what changes by when that turns this from",
    "what are they going to zero in on first",
    "what has to be spelled out in writing",
    "what would they have to lose on",
    "is the daily hit itself too heavy",
    "the total payback earns its place",
  ] as const;
  for (const n of strongNeedles) {
    if (t.includes(n)) return false;
  }

  return (
    t.startsWith("what part") ||
    t.startsWith("what specifically") ||
    t.startsWith("what has to") ||
    t.startsWith("makes sense—what") ||
    t.startsWith("heard—what") ||
    t.startsWith("what would need")
  );
}

const PH63_SAFE_REBALANCED_LINES = [
  "What part is off—the total payback, the daily hit, or the structure around it?",
  "Is it the daily hit itself, or what it does to payroll and week-to-week cash flow?",
  "What specifically has to be clear in writing for this to feel controlled?",
  "What would they have to beat or change for you to move this away from them?",
  "What changes by when that would make this worth doing?",
  "What are they going to focus on first—the payback, the daily hit, or the terms?",
] as const;

const PH63_DOMINANT_PRIMARY_LINES = [
  "The issue isn’t whether it costs money—it’s whether the total payback earns its place. Is the real problem the total back, the daily burden, or both?",
  "Then let’s call it what it is—is the daily hit itself too heavy, or does it only break when it collides with payroll and weekly cash flow?",
  "Then control is the issue, not interest alone. What has to be spelled out in writing so this feels controlled before you sign anything?",
  "Fair—then this only moves if there’s a real difference. What would they have to lose on—cost, speed, or flexibility—for you to move this off your current guy?",
  "Then timing is the variable. What changes by when that turns this from ‘wait’ into ‘do it now’?",
  "Good—so let’s not make review a stall. What are they going to zero in on first—the payback, the daily hit, or the terms?",
] as const;

const PH63_PRICE_VARIANTS = [
  "Is the issue the total payback itself, or how much room it leaves you after the pull?",
  "Then let’s call it what it is—the number only works if the total back earns its place in your cash flow.",
  "What has to change on total cost or structure for this to be worth doing?",
] as const;

const PH63_PAYMENT_VARIANTS = [
  "Does it break on the daily hit itself, or on what it does to week-to-week cash flow?",
  "Then the issue isn’t the quote—it’s whether the pull schedule fits the way your cash actually lands.",
  "What would have to change in the payment shape for this to work?",
] as const;

const PH63_TRUST_VARIANTS = [
  "What part feels exposed—the structure, the language, or what happens if business slows?",
  "Then trust isn’t the real ask—control is. You need to know how this behaves when things don’t go perfectly.",
  "What has to be spelled out clearly for this to feel controlled?",
] as const;

const PH63_COMPARISON_VARIANTS = [
  "What are they still doing better right now—cost, speed, or flexibility?",
  "Fair enough—this only moves if there’s a real difference, not just another offer on paper.",
  "What would they have to stop doing well for you to seriously move this away from them?",
] as const;

const PH63_REVIEW_VARIANTS = [
  "What are they actually going to zero in on first—the payback, the daily hit, or the terms?",
  "Good—then let’s keep review from turning into drift and get clear on the one thing they’ll judge first.",
  "What has to be answered in that review for this to come back as a yes?",
] as const;

const PH63_TIMING_VARIANTS = [
  "What changes between now and then that would make this easier to do?",
  "Then timing is only real if something concrete shifts—not just if more time passes.",
  "What has to happen by when for this to be worth revisiting?",
] as const;

/** Phase 6.4 — rhetorical type for Phase 6.3 approved family variants only (not safe/dominant baselines). */
type Phase63RhetoricalVariantType = "diagnostic" | "reframe" | "threshold";

const PH63_APPROVED_VARIANT_TO_RHETORICAL_TYPE: Readonly<
  Record<string, Phase63RhetoricalVariantType>
> = {
  [PH63_PRICE_VARIANTS[0]]: "diagnostic",
  [PH63_PRICE_VARIANTS[1]]: "reframe",
  [PH63_PRICE_VARIANTS[2]]: "threshold",
  [PH63_PAYMENT_VARIANTS[0]]: "diagnostic",
  [PH63_PAYMENT_VARIANTS[1]]: "reframe",
  [PH63_PAYMENT_VARIANTS[2]]: "threshold",
  [PH63_TRUST_VARIANTS[0]]: "diagnostic",
  [PH63_TRUST_VARIANTS[1]]: "reframe",
  [PH63_TRUST_VARIANTS[2]]: "threshold",
  [PH63_COMPARISON_VARIANTS[0]]: "diagnostic",
  [PH63_COMPARISON_VARIANTS[1]]: "reframe",
  [PH63_COMPARISON_VARIANTS[2]]: "threshold",
  [PH63_REVIEW_VARIANTS[0]]: "diagnostic",
  [PH63_REVIEW_VARIANTS[1]]: "reframe",
  [PH63_REVIEW_VARIANTS[2]]: "threshold",
  [PH63_TIMING_VARIANTS[0]]: "diagnostic",
  [PH63_TIMING_VARIANTS[1]]: "reframe",
  [PH63_TIMING_VARIANTS[2]]: "threshold",
};

function inferFamilyFromApprovedVariant(line: string): ConstraintGateFamily | null {
  const t = line.trim();
  if (!t) return null;
  if ((PH63_PRICE_VARIANTS as readonly string[]).includes(t)) return "price_total_cost";
  if ((PH63_PAYMENT_VARIANTS as readonly string[]).includes(t)) return "payment_burden";
  if ((PH63_TRUST_VARIANTS as readonly string[]).includes(t)) return "trust_control";
  if ((PH63_COMPARISON_VARIANTS as readonly string[]).includes(t))
    return "comparison_incumbent";
  if ((PH63_REVIEW_VARIANTS as readonly string[]).includes(t)) return "review_approval";
  if ((PH63_TIMING_VARIANTS as readonly string[]).includes(t)) return "timing_delay";
  return null;
}

function inferRhetoricalTypeFromApprovedVariant(
  line: string
): Phase63RhetoricalVariantType | null {
  const t = line.trim();
  const ty = PH63_APPROVED_VARIANT_TO_RHETORICAL_TYPE[t];
  return ty ?? null;
}

const PH63_ALL_APPROVED_VARIANT_STRINGS: ReadonlySet<string> = new Set([
  ...PH63_SAFE_REBALANCED_LINES,
  ...PH63_DOMINANT_PRIMARY_LINES,
  ...PH63_PRICE_VARIANTS,
  ...PH63_PAYMENT_VARIANTS,
  ...PH63_TRUST_VARIANTS,
  ...PH63_COMPARISON_VARIANTS,
  ...PH63_REVIEW_VARIANTS,
  ...PH63_TIMING_VARIANTS,
]);

function isStrongCustomContextualLineForFamilyVariation(line: string): boolean {
  const t = line.trim().toLowerCase();
  if (!t) return false;
  if (PH63_ALL_APPROVED_VARIANT_STRINGS.has(line.trim())) return false;

  const needles = [
    "payroll",
    "weekly cash flow",
    "in writing",
    "total payback",
    "daily burden",
    "cost, speed, or flexibility",
    "what changes by when that turns this from",
    "what are they going to zero in on first",
    "what has to be spelled out in writing",
    "what would they have to lose on",
    "is the daily hit itself too heavy",
    "the total payback earns its place",
    "partner-specific",
    "downside",
    "what they are going to focus on",
  ] as const;
  return needles.some((n) => t.includes(n));
}

function isEligibleForFamilyVariation(currentLine: string): boolean {
  const cur = currentLine.trim();
  if (!cur) return false;
  if (PH63_SAFE_REBALANCED_LINES.includes(cur as (typeof PH63_SAFE_REBALANCED_LINES)[number]))
    return true;
  if (PH63_DOMINANT_PRIMARY_LINES.includes(cur as (typeof PH63_DOMINANT_PRIMARY_LINES)[number]))
    return true;
  if (isConstraintStyleLine(cur)) return true;
  return isUpgradeableGenericLineForFamilyVariation(cur);
}

function getFamilyVariationSet(
  family: ConstraintGateFamily
): readonly string[] | null {
  if (family === "price_total_cost") return PH63_PRICE_VARIANTS;
  if (family === "payment_burden") return PH63_PAYMENT_VARIANTS;
  if (family === "trust_control") return PH63_TRUST_VARIANTS;
  if (family === "comparison_incumbent") return PH63_COMPARISON_VARIANTS;
  if (family === "review_approval") return PH63_REVIEW_VARIANTS;
  if (family === "timing_delay") return PH63_TIMING_VARIANTS;
  return null;
}

function getApprovedVariantTypeForFamilyLine(
  family: ConstraintGateFamily,
  line: string
): Phase63RhetoricalVariantType | null {
  const vars = getFamilyVariationSet(family);
  if (vars == null) return null;
  const t = line.trim();
  if (!(vars as readonly string[]).includes(t)) return null;
  return inferRhetoricalTypeFromApprovedVariant(t);
}

function stableDeterministicPickIndex(seed: string, modulo: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return modulo === 0 ? 0 : h % modulo;
}

function selectDeterministicFamilyVariant(
  variants: readonly string[],
  seed: string,
  previousLine: string | null | undefined,
  family: ConstraintGateFamily
): string | null {
  if (variants.length === 0) return null;
  const prevKey = previousLine ? normalizeFamilyVariationEchoKey(previousLine) : "";
  const start = stableDeterministicPickIndex(seed, variants.length);

  if (!prevKey) {
    return variants[start] ?? null;
  }

  const prevTrim = previousLine!.trim();
  const prevType = getApprovedVariantTypeForFamilyLine(family, prevTrim);
  const rotationEligible =
    inferFamilyFromApprovedVariant(prevTrim) === family && prevType !== null;

  const antiEchoOk = (cand: string) =>
    normalizeFamilyVariationEchoKey(cand) !== prevKey;

  /* Phase 6.4 — prefer a different rhetorical type when previous line is an approved variant in the same family. */
  if (rotationEligible) {
    for (let k = 0; k < variants.length; k++) {
      const cand = variants[(start + k) % variants.length]!;
      if (!antiEchoOk(cand)) continue;
      const candType = inferRhetoricalTypeFromApprovedVariant(cand);
      if (candType !== null && prevType !== null && candType !== prevType)
        return cand;
    }
  }

  for (let k = 0; k < variants.length; k++) {
    const cand = variants[(start + k) % variants.length]!;
    if (antiEchoOk(cand)) return cand;
  }
  return null;
}

function applyControlledFamilyVariation(
  currentLine: string,
  sourceText: string,
  ctx: LiveVoicePolishContext | undefined,
  previousLiveLineInScript: string | null | undefined
): string {
  if (!isEligibleForFamilyVariation(currentLine)) return currentLine;
  if (isStrongCustomContextualLineForFamilyVariation(currentLine)) return currentLine;

  const curTrim = currentLine.trim();
  if (
    objectionIsExplicitlyConditional(sourceText) &&
    isConstraintStyleLine(curTrim)
  ) {
    return currentLine;
  }

  const family = inferConstraintGateFamilyFromSourceText(
    sourceText,
    ctx?.situationLabel ?? null
  );
  if (family == null) return currentLine;

  const variants = getFamilyVariationSet(family);
  if (variants == null) return currentLine;

  const seed = `${normalizeConstraintCueSourceText(sourceText)}|${normalizeFamilyVariationEchoKey(currentLine)}`;
  const prevEcho =
    previousLiveLineInScript?.trim() ??
    ctx?.previousLiveDisplayLine?.trim() ??
    null;
  const picked = selectDeterministicFamilyVariant(variants, seed, prevEcho, family);
  if (picked == null) return currentLine;
  return picked;
}

function applyV11ControlledFamilyVariationScript(
  joined: string,
  sourceText: string,
  ctx: LiveVoicePolishContext | undefined
): string {
  if (joined.includes("\n") || joined.includes("\r")) {
    let prevInScript: string | null = ctx?.previousLiveDisplayLine?.trim() ?? null;
    return joined
      .split(/\r?\n/)
      .map((row) => {
        const next = applyControlledFamilyVariation(row, sourceText, ctx, prevInScript);
        const t = next.trim();
        if (t) prevInScript = t;
        return next;
      })
      .join("\n")
      .trim();
  }
  return applyControlledFamilyVariation(
    joined,
    sourceText,
    ctx,
    ctx?.previousLiveDisplayLine ?? null
  );
}

function polishLiveLine(
  line: string,
  ctx: LiveVoicePolishContext | undefined
): string {
  let t = line.trim();
  if (!t) return t;
  let prev = "";
  for (let i = 0; i < 4 && t !== prev; i++) {
    prev = t;
    const stripped = stripLeadingSoftOpenersOnce(t);
    t = stripped.trim();
  }
  t = t.replace(
    /^What specifically (feels|is|bothers|worries|gives)\b/i,
    "What $1"
  );
  t = t.replace(/\s{2,}/g, " ").trim();

  if (isCollapsedHesitationTemplate(t)) {
    t = displayAlternateForHesitationCollapse(t, ctx);
  }
  t = applyV11Phase1ExactLegacyUpgrade(t);
  return t;
}

/**
 * Speakable Live script only — do not pass HUD copy, labels, or metadata through this.
 * Entry point for Live script polish (V10 baseline + V11 Phase 1–4); Instant/Deep must not call this.
 */
export function polishLiveSpeakableScript(
  text: string,
  ctx?: LiveVoicePolishContext
): string {
  const raw = text.trim();
  if (!raw) return text;
  let prevDisplay: string | null = ctx?.previousLiveDisplayLine?.trim() ?? null;
  const segments = raw.split(/\r?\n/);
  const out: string[] = [];
  for (const segment of segments) {
    let line = polishLiveLine(segment, ctx);
    line = applyPhase3Spacing(line, prevDisplay);
    const trimmedP3 = line.trim();
    if (trimmedP3) prevDisplay = trimmedP3;
    out.push(line);
  }
  const finalLine = applyV11MicroFilter(out.join("\n").trim());
  const rebalanced = applyV11ConstraintGateAndRebalance(finalLine, text, ctx);
  const dominant = applyV11DominantStrategyInjection(rebalanced, text, ctx);
  return applyV11ControlledFamilyVariationScript(dominant, text, ctx);
}
