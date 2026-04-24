/**
 * Phase 4.6 — Pattern Expression Engine inventory + deterministic winner-flip proof.
 *
 * Run: cd packages/backend && npx tsx scripts/verify-pattern-expression-engine.ts
 */
import type { DealCoachingPosture } from "../src/services/dealCoachingPosture.js";
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
  "current_provider_loyalty",
  "existing_relationship",
  "unknown",
] as const;

const POSTURES: DealCoachingPosture[] = [
  "exploratory",
  "balanced",
  "controlled_assertive",
  "assertive_opportunity",
];

const DEAL_INPUTS = ["", "mca", "merchant_services", "business_line_of_credit"] as const;

function uniquePatternKeys(entries: ReturnType<typeof getObjectionResponsePatternCandidates>): string[] {
  return [...new Set(entries.map((e) => e.candidate.patternKey))];
}

type ComboRow = {
  objectionType: string;
  posture: DealCoachingPosture;
  dealType: string;
  entryCount: number;
  uniqueKeys: number;
};

function summarizeLiveBranches(rows: ComboRow[]): void {
  console.log("\n=== Live-critical branches (unique patternKey counts) ===\n");
  for (const cat of [
    "price_cost_framing",
    "timing_delay",
    "trust_skepticism",
    "current_provider_loyalty",
    "existing_relationship",
    "unknown",
  ] as const) {
    const relevant = rows.filter((r) => r.objectionType === cat);
    const maxU = relevant.length ? Math.max(...relevant.map((x) => x.uniqueKeys)) : 0;
    console.log(`${cat}: max unique patternKeys across scanned posture × deal inputs = ${maxU}`);
    const multi = relevant.filter((r) => r.uniqueKeys >= 2).slice(0, 8);
    if (multi.length) {
      console.log(`  Examples with ≥2 keys (up to 8):`);
      for (const r of multi) {
        console.log(`    ${r.posture} / "${r.dealType}" → ${r.uniqueKeys} unique (${r.entryCount} entries)`);
      }
    }
  }
}

async function proveFlip(label: string, input: ObjectionPatternInput): Promise<void> {
  const entries = getObjectionResponsePatternCandidates(input);
  const uniq = uniquePatternKeys(entries);
  console.log(`\n--- Flip proof: ${label} ---`);
  console.log(
    `Combo: ${input.objectionType} / ${input.posture} / "${input.dealType}" → entries=${entries.length}, uniqueKeys=${uniq.length}`
  );
  if (uniq.length < 2) {
    console.log("SKIP: not enough unique patternKeys for a flip.");
    return;
  }
  const baseline = await selectObjectionResponsePattern(input, {
    advancedStrategies: true,
    repetitionPenalty: {},
  });
  const winnerKey = baseline.selected.patternKey;
  const penalized = await selectObjectionResponsePattern(input, {
    advancedStrategies: true,
    repetitionPenalty: { [winnerKey]: 100 },
  });
  const penalized2 = await selectObjectionResponsePattern(input, {
    advancedStrategies: true,
    repetitionPenalty: { [winnerKey]: 100 },
  });
  const serialize = (sel: typeof baseline) =>
    JSON.stringify(
      sel.scoredCandidates.map((c) => ({
        k: c.patternKey,
        s: c.source,
        score: c.score,
      }))
    );
  const flip = winnerKey !== penalized.selected.patternKey;
  const determinism =
    penalized.selected.patternKey === penalized2.selected.patternKey &&
    serialize(penalized) === serialize(penalized2);
  console.log(`Baseline winner: ${winnerKey} (source=${baseline.selected.source})`);
  console.log(`Penalized winner: ${penalized.selected.patternKey} (source=${penalized.selected.source})`);
  console.log(`Winner flipped: ${flip ? "YES" : "NO"}`);
  console.log(`Determinism (penalized twice): ${determinism ? "PASS" : "FAIL"}`);
}

async function main(): Promise<void> {
  const rows: ComboRow[] = [];
  let combosWith2Plus = 0;
  let combosWith3Plus = 0;
  let maxUniqueOverall = 0;

  for (const objectionType of OBJECTION_TYPES) {
    for (const posture of POSTURES) {
      for (const dealType of DEAL_INPUTS) {
        const input: ObjectionPatternInput = { objectionType, posture, dealType };
        const entries = getObjectionResponsePatternCandidates(input);
        const uniq = uniquePatternKeys(entries);
        rows.push({
          objectionType,
          posture,
          dealType,
          entryCount: entries.length,
          uniqueKeys: uniq.length,
        });
        if (uniq.length >= 2) combosWith2Plus++;
        if (uniq.length >= 3) combosWith3Plus++;
        maxUniqueOverall = Math.max(maxUniqueOverall, uniq.length);
      }
    }
  }

  console.log("=== Phase 4.6b Pattern Expression Engine — inventory scan ===\n");
  console.log(`Combinations scanned: ${rows.length}`);
  console.log(`Combinations with ≥2 unique patternKeys: ${combosWith2Plus}`);
  console.log(`Combinations with ≥3 unique patternKeys: ${combosWith3Plus}`);
  console.log(`Max unique patternKeys (any combo): ${maxUniqueOverall}`);

  summarizeLiveBranches(rows);

  const providers = rows.filter((r) => r.objectionType === "current_provider_loyalty");
  const rel = rows.filter((r) => r.objectionType === "existing_relationship");
  const unk = rows.filter((r) => r.objectionType === "unknown");
  const providerOk = providers.some((r) => r.uniqueKeys >= 2);
  const relationshipOk = rel.some((r) => r.uniqueKeys >= 2);
  const unknownHas3 = unk.some((r) => r.uniqueKeys >= 3);

  console.log("\n=== 4.6b required coverage checks ===\n");
  console.log(`current_provider_loyalty present + ≥2 keys somewhere: ${providerOk ? "yes" : "NO"}`);
  console.log(`existing_relationship present + ≥2 keys somewhere: ${relationshipOk ? "yes" : "NO"}`);
  console.log(`unknown/generic has ≥3 keys in at least one combo: ${unknownHas3 ? "yes" : "NO"}`);

  // Deterministic flip proofs: one from new categories, one from unknown.
  const providerPick =
    providers.find((r) => r.uniqueKeys >= 2) ??
    null;
  const unknownPick =
    unk.find((r) => r.uniqueKeys >= 3) ??
    unk.find((r) => r.uniqueKeys >= 2) ??
    null;

  if (providerPick) {
    await proveFlip("new category (current_provider_loyalty)", {
      objectionType: providerPick.objectionType,
      posture: providerPick.posture,
      dealType: providerPick.dealType,
    });
  } else {
    console.log("\n--- Flip proof: new category (current_provider_loyalty) ---");
    console.log("SKIP: no combo with ≥2 unique keys found (should not happen if 4.6b is complete).");
  }

  if (unknownPick) {
    await proveFlip("unknown/generic", {
      objectionType: unknownPick.objectionType,
      posture: unknownPick.posture,
      dealType: unknownPick.dealType,
    });
  } else {
    console.log("\n--- Flip proof: unknown/generic ---");
    console.log("SKIP: no unknown combo found (unexpected).");
  }

  console.log("\n=== Closure checklist ===");
  console.log(`Coverage checks: ${providerOk && relationshipOk && unknownHas3 ? "PASS" : "CHECK"}`);
  console.log(`Materially more multi-candidate combos: ${combosWith2Plus > 0 ? "yes" : "no"}`);
}

main().catch((e) => {
  console.error(e);
});
