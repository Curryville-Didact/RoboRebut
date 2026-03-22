// src/services/objectionClassifier.ts

/** Legacy union kept for callers that still narrow to v1 buckets. */
export type ClassificationCategory =
  | "price"
  | "trust"
  | "timing"
  | "need"
  | "other";

/** Includes `category` for existing callers; `type` matches the required contract shape. */
export interface ClassificationResult {
  type: string;
  category: string;
  confidence: number;
  signals: string[];
}

type DetectedCategory =
  | "price"
  | "trust"
  | "timing"
  | "hesitation"
  | "competitor"
  | "authority"
  | "need"
  | "other";

type Rule = { pattern: RegExp; signal: string };

const RULES: Record<Exclude<DetectedCategory, "other">, Rule[]> = {
  price: [
    { pattern: /expensive/i, signal: "expensive" },
    { pattern: /cost/i, signal: "cost" },
    { pattern: /price/i, signal: "price" },
    { pattern: /too much/i, signal: "too much" },
    { pattern: /afford/i, signal: "afford" },
    { pattern: /budget/i, signal: "budget" },
  ],
  trust: [
    { pattern: /how do i know/i, signal: "how do I know" },
    { pattern: /does it work/i, signal: "does it work" },
    { pattern: /prove/i, signal: "prove" },
    { pattern: /guarantee/i, signal: "guarantee" },
    { pattern: /not sure i (can )?trust/i, signal: "trust" },
    { pattern: /don'?t trust/i, signal: "don't trust" },
    { pattern: /skeptical/i, signal: "skeptical" },
    { pattern: /scam/i, signal: "scam" },
    { pattern: /legit/i, signal: "legit" },
    { pattern: /risky/i, signal: "risky" },
  ],
  timing: [
    { pattern: /isn['’]t the right time/i, signal: "isn't the right time" },
    { pattern: /not the right time/i, signal: "not the right time" },
    { pattern: /wrong time/i, signal: "wrong time" },
    { pattern: /bad time/i, signal: "bad time" },
    { pattern: /maybe later/i, signal: "maybe later" },
    { pattern: /\blater\b/i, signal: "later" },
    { pattern: /circle back/i, signal: "circle back" },
    { pattern: /reach out later/i, signal: "reach out later" },
    { pattern: /not now/i, signal: "not now" },
    { pattern: /come back later/i, signal: "come back later" },
    { pattern: /too busy/i, signal: "too busy" },
    { pattern: /schedule/i, signal: "schedule" },
    { pattern: /timing/i, signal: "timing" },
    { pattern: /follow up/i, signal: "follow up" },
    { pattern: /next quarter/i, signal: "next quarter" },
  ],
  hesitation: [
    { pattern: /need to think/i, signal: "think about it" },
    { pattern: /think about it/i, signal: "think about it" },
    { pattern: /let me think/i, signal: "let me think" },
    { pattern: /not ready/i, signal: "not ready" },
    { pattern: /sleep on it/i, signal: "sleep on it" },
    { pattern: /get back to you/i, signal: "get back to you" },
    { pattern: /need more time/i, signal: "need more time" },
    { pattern: /on the fence/i, signal: "on the fence" },
    { pattern: /not sure yet/i, signal: "not sure yet" },
  ],
  competitor: [
    { pattern: /already (working with|using)/i, signal: "already working with someone" },
    { pattern: /we have a vendor/i, signal: "have a vendor" },
    { pattern: /happy with (our |what )?current/i, signal: "happy with current" },
    { pattern: /locked in with/i, signal: "locked in" },
    { pattern: /under contract with/i, signal: "under contract" },
    { pattern: /competitor/i, signal: "competitor" },
    { pattern: /another (company|provider)/i, signal: "another provider" },
    { pattern: /staying with/i, signal: "staying with" },
  ],
  authority: [
    { pattern: /need to check with/i, signal: "check with" },
    { pattern: /talk to my (boss|partner|spouse|wife|husband)/i, signal: "talk to decision-maker" },
    { pattern: /partner needs? to/i, signal: "partner" },
    { pattern: /not my decision/i, signal: "not my decision" },
    { pattern: /run it by/i, signal: "run it by" },
    { pattern: /get approval/i, signal: "approval" },
    { pattern: /committee/i, signal: "committee" },
    { pattern: /board/i, signal: "board" },
  ],
  need: [
    { pattern: /don'?t need/i, signal: "don't need" },
    { pattern: /not necessary/i, signal: "not necessary" },
    { pattern: /already have/i, signal: "already have" },
    { pattern: /no use/i, signal: "no use" },
    { pattern: /why would/i, signal: "why would" },
  ],
};

/** When two categories have the same match count, prefer the first listed (more specific / new types before generic). */
const TIE_BREAK_ORDER: DetectedCategory[] = [
  "competitor",
  "authority",
  "hesitation",
  "trust",
  "price",
  "timing",
  "need",
  "other",
];

function confidenceFromMatchCount(count: number): number {
  if (count <= 0) return 0.4;
  if (count === 1) return 0.6;
  return 0.8;
}

export const objectionClassifier = {
  async classify(text: string): Promise<ClassificationResult> {
    const normalized = text.trim().toLowerCase();

    type Cat = Exclude<DetectedCategory, "other">;
    const cats: Cat[] = [
      "price",
      "trust",
      "timing",
      "hesitation",
      "competitor",
      "authority",
      "need",
    ];

    let bestCategory: DetectedCategory = "other";
    let bestSignals: string[] = [];
    let bestCount = 0;

    for (const c of cats) {
      let matchCount = 0;
      const matchedSignals: string[] = [];
      const seen = new Set<string>();

      for (const { pattern, signal } of RULES[c]) {
        pattern.lastIndex = 0;

        if (pattern.test(normalized) && !seen.has(signal)) {
          matchCount++;
          seen.add(signal);
          matchedSignals.push(signal);
        }
      }

      if (matchCount > bestCount) {
        bestCount = matchCount;
        bestCategory = c;
        bestSignals = matchedSignals;
      } else if (matchCount === bestCount && matchCount > 0) {
        const prevRank = TIE_BREAK_ORDER.indexOf(bestCategory);
        const nextRank = TIE_BREAK_ORDER.indexOf(c);
        if (nextRank !== -1 && (prevRank === -1 || nextRank < prevRank)) {
          bestCategory = c;
          bestSignals = matchedSignals;
        }
      }
    }

    const confidence = confidenceFromMatchCount(bestCount);

    return {
      type: bestCategory,
      category: bestCategory,
      confidence,
      signals: bestSignals,
    };
  },
};
