/**
 * Phase 4.4 — Strict deterministic proof harness (read-only).
 *
 * Proves that `repetitionPenalty` can change the selected winner when the rule-generated
 * candidate pool contains more than one unique `patternKey` (real inventory, no fabricated pools).
 *
 * Run from repo root or packages/backend:
 *   cd packages/backend && npx tsx scripts/verify-repetition-penalty-winner-flip.ts
 */
import type { DealCoachingPosture } from "../src/services/dealCoachingPosture.js";
import type { ScoredPatternCandidate } from "../src/services/patternPreference.js";
import {
  getObjectionResponsePatternCandidates,
  selectObjectionResponsePattern,
  type ObjectionPatternInput,
} from "../src/services/objectionResponsePattern.js";

const OBJECTION_TYPES = [
  "price_cost_framing",
  "timing_delay",
  "trust_skepticism",
  "need_indifference",
  "payment_fatigue",
  "unknown",
] as const;

const POSTURES: DealCoachingPosture[] = [
  "exploratory",
  "balanced",
  "controlled_assertive",
  "assertive_opportunity",
];

/** Supported deal labels that resolve via production `normalizeDealType` (plus empty → legacy-only path). */
const DEAL_TYPES = ["", "mca", "merchant_services", "business_line_of_credit"] as const;

/** Bounded penalty applied only to the baseline winner’s patternKey inside this harness. */
const PROOF_PENALTY_MAGNITUDE = 100;

function uniquePatternKeys(entries: ReturnType<typeof getObjectionResponsePatternCandidates>): string[] {
  return [...new Set(entries.map((e) => e.candidate.patternKey))];
}

function serializeScored(rows: ScoredPatternCandidate[]): string {
  const normalized = [...rows].map((c) => ({
    patternKey: c.patternKey,
    source: c.source,
    score: c.score,
    reasons: c.reasons,
  }));
  normalized.sort((a, b) => {
    if (a.patternKey !== b.patternKey) return a.patternKey.localeCompare(b.patternKey);
    return a.source.localeCompare(b.source);
  });
  return JSON.stringify(normalized);
}

async function main(): Promise<void> {
  let inspected = 0;
  let maxUnique = 0;
  let bestSummary = "";

  /** First qualifying combination in deterministic scan order (nested loops as declared above). */
  let chosen: ObjectionPatternInput | null = null;

  for (const objectionType of OBJECTION_TYPES) {
    for (const posture of POSTURES) {
      for (const dealType of DEAL_TYPES) {
        inspected++;
        const input: ObjectionPatternInput = {
          objectionType,
          posture,
          dealType,
        };
        const entries = getObjectionResponsePatternCandidates(input);
        const uniq = uniquePatternKeys(entries);
        if (uniq.length > maxUnique) {
          maxUnique = uniq.length;
          bestSummary = `${objectionType} / ${posture} / "${dealType}" → ${uniq.length} unique keys`;
        }
        if (uniq.length >= 2 && !chosen) {
          chosen = input;
        }
      }
    }
  }

  console.log("=== Phase 4.4 repetitionPenalty winner-flip proof ===\n");
  console.log(`Combinations inspected: ${inspected}`);
  console.log(`Max unique patternKey count seen: ${maxUnique}`);
  console.log(`Best observed: ${bestSummary}\n`);

  if (!chosen) {
    console.log(
      "RESULT: No combination in the scanned inventory yields ≥2 unique patternKeys.\n" +
        "Therefore no winner flip via repetitionPenalty is possible under empty stats + no tag bias.\n" +
        "Phase 4.4 flip proof is blocked by candidate pool collapse (rigorous scan complete)."
    );
    return;
  }

  const entries = getObjectionResponsePatternCandidates(chosen);
  const totalCandidates = entries.length;
  const uniqueKeys = uniquePatternKeys(entries);

  console.log("--- Multi-candidate case (real rule inventory) ---");
  console.log(`objectionType: ${chosen.objectionType}`);
  console.log(`posture: ${chosen.posture}`);
  console.log(`dealType (input string): ${JSON.stringify(chosen.dealType)}`);
  console.log(`Total candidate entries (deal_specialized + explicit + default): ${totalCandidates}`);
  console.log(`Unique patternKey count: ${uniqueKeys.length}`);
  console.log(`Unique patternKeys:\n  ${uniqueKeys.join("\n  ")}\n`);

  const baseline = await selectObjectionResponsePattern(chosen, {
    advancedStrategies: true,
    repetitionPenalty: {},
  });

  const baselineWinner = baseline.selected.patternKey;
  console.log("--- Baseline (repetitionPenalty = {}) ---");
  console.log(`Selected patternKey: ${baselineWinner}`);
  console.log(`Selected source: ${baseline.selected.source}`);
  baseline.scoredCandidates.forEach((c, i) => {
    console.log(`  [${i}] score=${c.score} source=${c.source} key=${c.patternKey}`);
    console.log(`      reasons: ${c.reasons.join(" | ")}`);
  });

  const penalized = await selectObjectionResponsePattern(chosen, {
    advancedStrategies: true,
    repetitionPenalty: { [baselineWinner]: PROOF_PENALTY_MAGNITUDE },
  });

  console.log("\n--- Penalized (same inputs; penalty on baseline winner only) ---");
  console.log(`Penalty map: { "${baselineWinner}": ${PROOF_PENALTY_MAGNITUDE} }`);
  console.log(`Selected patternKey: ${penalized.selected.patternKey}`);
  console.log(`Selected source: ${penalized.selected.source}`);
  penalized.scoredCandidates.forEach((c, i) => {
    console.log(`  [${i}] score=${c.score} source=${c.source} key=${c.patternKey}`);
    console.log(`      reasons: ${c.reasons.join(" | ")}`);
  });

  const penalized2 = await selectObjectionResponsePattern(chosen, {
    advancedStrategies: true,
    repetitionPenalty: { [baselineWinner]: PROOF_PENALTY_MAGNITUDE },
  });

  const flip = baselineWinner !== penalized.selected.patternKey;
  const determinism =
    serializeScored(penalized.scoredCandidates) === serializeScored(penalized2.scoredCandidates) &&
    penalized.selected.patternKey === penalized2.selected.patternKey &&
    penalized.selected.source === penalized2.selected.source;

  console.log("\n=== Proof summary ===");
  console.log(`Baseline winner: ${baselineWinner}`);
  console.log(`Penalized winner: ${penalized.selected.patternKey}`);
  console.log(`Winner flipped: ${flip ? "YES" : "NO"}`);
  console.log(`Determinism (two penalized runs identical): ${determinism ? "YES" : "NO"}`);

  if (!flip) {
    console.log(
      "\nNOTE: Penalty did not flip the winner. This can happen if one candidate dominates by\n" +
        "more than PROOF_PENALTY_MAGNITUDE after tie-breakers, or if unique keys exist only across\n" +
        "sources that collapse after scoring. Increase PROOF_PENALTY_MAGNITUDE in this script only\n" +
        "or inspect scores above."
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
