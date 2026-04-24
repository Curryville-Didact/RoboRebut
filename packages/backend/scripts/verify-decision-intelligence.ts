/**
 * Phase 4.7 — Verify Decision Intelligence meta is deterministic and observational.
 *
 * Run: cd packages/backend && npx tsx scripts/verify-decision-intelligence.ts
 */
import { buildDecisionIntelligenceMeta } from "../src/services/decisionIntelligence.js";
import { selectObjectionResponsePattern } from "../src/services/objectionResponsePattern.js";

async function main(): Promise<void> {
  // Known multi-candidate combo from Phase 4.6/4.6b.
  const input = {
    objectionType: "price_cost_framing",
    posture: "controlled_assertive",
    dealType: "mca",
  } as const;

  const baseline = await selectObjectionResponsePattern(input as any, {
    advancedStrategies: true,
    repetitionPenalty: {},
  });

  const metaA = buildDecisionIntelligenceMeta({
    selection: baseline,
    antiRepeatApplied: true,
    antiRepeatReason: "test_repeat",
    confidenceSupport: 2,
    dvlApplied: true,
    variantIndex: 1,
  });

  const metaB = buildDecisionIntelligenceMeta({
    selection: baseline,
    antiRepeatApplied: true,
    antiRepeatReason: "test_repeat",
    confidenceSupport: 2,
    dvlApplied: true,
    variantIndex: 1,
  });

  const stable = JSON.stringify(metaA) === JSON.stringify(metaB);

  console.log("=== Phase 4.7 decision intelligence verification ===\n");
  console.log(`Winner patternKey: ${baseline.selected.patternKey}`);
  console.log(`CandidateCount: ${metaA.candidateCount}`);
  console.log(`UniquePatternKeyCount: ${metaA.uniquePatternKeyCount}`);
  console.log(`Runner-up present: ${metaA.runnerUpPatternKey != null}`);
  console.log(`ScoreGap present: ${metaA.scoreGap != null}`);
  console.log(`DecisionReasons: ${metaA.decisionReasons.join(", ")}`);
  console.log(`Determinism (metaA === metaB): ${stable ? "PASS" : "FAIL"}`);

  // Ensure observational: winner unchanged regardless of meta creation.
  const rerun = await selectObjectionResponsePattern(input as any, {
    advancedStrategies: true,
    repetitionPenalty: {},
  });
  console.log(
    `Winner unchanged across selection rerun: ${
      rerun.selected.patternKey === baseline.selected.patternKey ? "PASS" : "FAIL"
    }`
  );
}

main().catch((e) => {
  console.error(e);
});

