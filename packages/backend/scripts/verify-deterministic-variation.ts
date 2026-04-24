/**
 * Phase 4.5 — Sanity check for deterministic variant index selection (no randomness).
 *
 * Run: cd packages/backend && npx tsx scripts/verify-deterministic-variation.ts
 */
import {
  getDeterministicVariantIndex,
  patternRepeatCountForPatternKey,
} from "../src/services/deterministicVariation.js";

const conversationId = "c0ffee00-0000-4000-8000-00000000ab12";
const patternKey = "price_cost_framing::balanced::mca::structure_clarity::direct_question::moderate";
const callReadySignature = "cafef00dbeef";
const variants = ["Line Alpha", "Line Bravo", "Line Charlie", "Line Delta", "Line Echo"];

function runFiveTurnsSamePattern(): number[] {
  const out: number[] = [];
  for (let repetitionCount = 0; repetitionCount < 5; repetitionCount++) {
    out.push(
      getDeterministicVariantIndex({
        conversationId,
        patternKey,
        callReadySignature,
        repetitionCount,
        variantCount: variants.length,
      })
    );
  }
  return out;
}

console.log("=== Phase 4.5 deterministic variation harness ===\n");
console.log("Turn 1–5 (pattern-local counter 0–4), same conversation + patternKey + callReadySignature:\n");

const seqA = runFiveTurnsSamePattern();
seqA.forEach((idx, i) => {
  console.log(`Turn ${i + 1} → variant index ${idx} → "${variants[idx]}"`);
});

console.log("\nSecond full run (must match first):\n");
const seqB = runFiveTurnsSamePattern();
seqB.forEach((idx, i) => {
  console.log(`Turn ${i + 1} → variant index ${idx} → "${variants[idx]}"`);
});

const identical = seqA.length === seqB.length && seqA.every((v, i) => v === seqB[i]);
console.log(`\nDeterminism: ${identical ? "PASS (both runs identical)" : "FAIL"}`);
const varied = new Set(seqA).size > 1;
console.log(`Across 5 turns (same key): multiple indices used: ${varied ? "yes" : "no"}`);

// --- Pattern-local repetition (PRICE → OTHER objection → PRICE) ---
const pkPrice =
  "price_cost_framing::assertive_opportunity::mca::structure_clarity::direct_question::moderate";
const pkOther =
  "timing_delay::controlled_assertive::generic::urgency_without_panic::commitment_question::high";

type MockPrior = { role: "user" | "ai"; patternKey?: string | null };

console.log("\n--- Pattern-local vs stray global counter (simulated conversation) ---\n");
console.log("Scenario: Turn 1 = PRICE AI, Turn 2 = OTHER AI, Turn 3 = next user message routed to PRICE again.\n");

const priorsBeforeTurn1Price: MockPrior[] = [];
const priorsBeforeTurn2Other: MockPrior[] = [{ role: "ai", patternKey: pkPrice }];
const priorsBeforeTurn3Price: MockPrior[] = [
  { role: "ai", patternKey: pkPrice },
  { role: "ai", patternKey: pkOther },
];

const countTurn1 = patternRepeatCountForPatternKey(priorsBeforeTurn1Price, pkPrice);
const countTurn2Other = patternRepeatCountForPatternKey(priorsBeforeTurn2Other, pkOther);
const countTurn3Price = patternRepeatCountForPatternKey(priorsBeforeTurn3Price, pkPrice);
const globalAiBeforeTurn3 = priorsBeforeTurn3Price.filter((m) => m.role === "ai").length;

console.log(`patternRepeatCount(PRICE) before first PRICE reply: ${countTurn1} (expect 0)`);
console.log(`patternRepeatCount(OTHER) before OTHER reply: ${countTurn2Other} (expect 0)`);
console.log(`patternRepeatCount(PRICE) before third-turn PRICE reply: ${countTurn3Price} (expect 1)`);
console.log(`Naive global prior-AI count before third-turn PRICE: ${globalAiBeforeTurn3} (would be 2)\n`);

const ixTurn1Price = getDeterministicVariantIndex({
  conversationId,
  patternKey: pkPrice,
  callReadySignature,
  repetitionCount: countTurn1,
  variantCount: variants.length,
});

const ixTurn3PricePatternLocal = getDeterministicVariantIndex({
  conversationId,
  patternKey: pkPrice,
  callReadySignature,
  repetitionCount: countTurn3Price,
  variantCount: variants.length,
});

const ixTurn3PriceGlobalWrong = getDeterministicVariantIndex({
  conversationId,
  patternKey: pkPrice,
  callReadySignature,
  repetitionCount: globalAiBeforeTurn3,
  variantCount: variants.length,
});

console.log(`Turn 1 PRICE (patternRepeatCount=${countTurn1}) → variant index ${ixTurn1Price}`);
console.log(`Turn 3 PRICE (pattern-local count=${countTurn3Price}) → variant index ${ixTurn3PricePatternLocal}`);
console.log(
  `Turn 3 PRICE if hash used global AI count (${globalAiBeforeTurn3}) instead → variant index ${ixTurn3PriceGlobalWrong}`
);

const indexForCount1 = getDeterministicVariantIndex({
  conversationId,
  patternKey: pkPrice,
  callReadySignature,
  repetitionCount: 1,
  variantCount: variants.length,
});
const indexForCount2 = getDeterministicVariantIndex({
  conversationId,
  patternKey: pkPrice,
  callReadySignature,
  repetitionCount: 2,
  variantCount: variants.length,
});

console.log(`\nSanity: Turn 3 pattern-local index matches explicit repetitionCount=1: ${ixTurn3PricePatternLocal === indexForCount1}`);
console.log(`Sanity: Wrong-global index matches explicit repetitionCount=2: ${ixTurn3PriceGlobalWrong === indexForCount2}`);
console.log(
  `Stride fix (pattern-local ≠ wrong-global when counts 1 vs 2): ${ixTurn3PricePatternLocal !== ixTurn3PriceGlobalWrong ? "PASS" : "FAIL"}`
);
