// src/services/strategySelector.ts
import type { ClassificationResult } from "./objectionClassifier.js";

type Category = ClassificationResult["category"];

const byCategory: Record<
  Category,
  { strategy: string; rationale: string }
> = {
  price: {
    strategy: "value reframing",
    rationale: "Reframe around long-term value vs. sticker price.",
  },
  trust: {
    strategy: "credibility anchoring",
    rationale: "Address skepticism with proof and social proof.",
  },
  timing: {
    strategy: "urgency alignment",
    rationale: "Align with schedule while noting cost of delay.",
  },
  need: {
    strategy: "needs alignment",
    rationale: "Connect offer to stated outcomes, not extra burden.",
  },
  other: {
    strategy: "general reassurance",
    rationale: "Default neutral reassurance and clarification.",
  },
};

export const strategySelector = {
  select(category: Category): { strategy: string; rationale: string } {
    return byCategory[category] ?? byCategory.other;
  },
};
