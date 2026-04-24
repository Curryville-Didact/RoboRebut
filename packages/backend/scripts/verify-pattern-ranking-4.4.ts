/**
 * Phase 4.4 — Demonstrate objection-driven pattern ranking bias (before vs after sort).
 * Run: node --import tsx scripts/verify-pattern-ranking-4.4.ts
 */
import type { ScoredPatternCandidate } from "../src/services/patternPreference.js";
import {
  applyObjectionTagBias,
  computeObjectionBiasStyleBuckets,
  prepareObjectionBiasContext,
  trustBundleRefStructAndRisk,
  type ObjectionTagBiasInput,
  type ObjectionTagScore,
} from "../src/services/objectionTagPatternBias.js";

function cand(
  id: string,
  rebuttalStyle: string,
  followUpStyle = "diagnostic_question"
): ScoredPatternCandidate {
  return {
    patternKey: id,
    source: "explicit",
    score: 100,
    reasons: ["base:100"],
    rebuttalStyle,
    coachNoteStyle: "closer_guidance",
    followUpStyle,
  };
}

/** Build scored tags from [tag, score][] for readability */
function st(rows: [string, number][]): ObjectionTagScore[] {
  return rows.map(([tag, score]) => ({ tag, score }));
}

function sortByScore(rows: ScoredPatternCandidate[]): ScoredPatternCandidate[] {
  return [...rows].sort((a, b) => b.score - a.score);
}

function orderKeys(rows: ScoredPatternCandidate[]): string {
  return sortByScore(rows)
    .map((r) => `${r.patternKey}(${r.score.toFixed(2)})`)
    .join(" > ");
}

type Case = {
  name: string;
  primaryObjectionType: string | null;
  objectionTags: ObjectionTagScore[];
  candidates: ScoredPatternCandidate[];
};

const cases: Case[] = [
  {
    name: "Cash-flow + payment primary (restaurant cadence family)",
    primaryObjectionType: "cash_flow_pressure",
    objectionTags: st([
      ["cash_flow_pressure", 5],
      ["payment_affordability", 4],
      ["structure_mismatch", 3],
    ]),
    candidates: [
      cand("p1", "risk_reduction"),
      cand("p2", "operational_use_case"),
      cand("p3", "daily_burden_reframe"),
      cand("p4", "structure_clarity"),
      cand("p5", "urgency_without_panic"),
    ],
  },
  {
    name: "Trust + past harm (primary trust_risk)",
    primaryObjectionType: "trust_risk",
    objectionTags: st([
      ["trust_risk", 5],
      ["past_bad_experience", 4],
    ]),
    candidates: [
      cand("t1", "urgency_without_panic"),
      cand("t2", "risk_reduction"),
      cand("t3", "structure_clarity"),
      cand("t4", "operational_use_case"),
    ],
  },
  {
    name: "Timing + decision avoidance",
    primaryObjectionType: "timing_delay",
    objectionTags: st([
      ["timing_delay", 4],
      ["decision_avoidance", 3],
    ]),
    candidates: [
      cand("d1", "structure_clarity"),
      cand("d2", "urgency_without_panic", "commitment_question"),
      cand("d3", "cost_of_delay_redirect"),
      cand("d4", "daily_burden_reframe"),
    ],
  },
  {
    name: "Payment + structure mismatch (primary structure_mismatch)",
    primaryObjectionType: "structure_mismatch",
    objectionTags: st([
      ["payment_affordability", 5],
      ["structure_mismatch", 4],
    ]),
    candidates: [
      cand("s1", "risk_reduction"),
      cand("s2", "structure_clarity"),
      cand("s3", "daily_burden_reframe"),
      cand("s4", "qualification_pressure"),
    ],
  },
  {
    name: "Margin profitability primary",
    primaryObjectionType: "margin_profitability",
    objectionTags: st([["margin_profitability", 5]]),
    candidates: [
      cand("m1", "daily_burden_reframe"),
      cand("m2", "qualification_pressure"),
      cand("m3", "operational_use_case"),
      cand("m4", "cost_of_delay_redirect"),
    ],
  },
  {
    name: "No objection signal (bias skipped — order unchanged)",
    primaryObjectionType: null,
    objectionTags: [],
    candidates: [
      cand("n1", "structure_clarity"),
      cand("n2", "risk_reduction"),
      cand("n3", "operational_use_case"),
    ],
  },
  {
    name: "A) Heavy multi-tag overlap (3+ tags) — spread across styles, no single-style domination",
    primaryObjectionType: "cash_flow_pressure",
    objectionTags: st([
      ["cash_flow_pressure", 6],
      ["payment_affordability", 5],
      ["structure_mismatch", 4],
      ["timing_delay", 3],
      ["margin_profitability", 2],
    ]),
    candidates: [
      cand("a1", "operational_use_case"),
      cand("a2", "qualification_pressure"),
      cand("a3", "daily_burden_reframe"),
      cand("a4", "structure_clarity"),
      cand("a5", "urgency_without_panic"),
      cand("a6", "cost_of_delay_redirect"),
    ],
  },
  {
    name: "B) High trust_risk — qualification_pressure suppressed vs trust-safety styles",
    primaryObjectionType: "trust_risk",
    objectionTags: st([
      ["trust_risk", 8],
      ["confusion_clarity", 3],
    ]),
    candidates: [
      cand("b1", "qualification_pressure"),
      cand("b2", "structure_clarity"),
      cand("b3", "risk_reduction"),
      cand("b4", "urgency_without_panic"),
    ],
  },
];

const KEY_STRUCT = "rebuttal:structure_clarity";
const KEY_RISK = "rebuttal:risk_reduction";
const KEY_QUAL = "rebuttal:qualification_pressure";
const KEY_COD = "rebuttal:cost_of_delay_redirect";

function runExplicitChecks() {
  console.log("\n=== Explicit Phase 4.4 precision checks ===\n");

  // A) trust_risk + past_bad_experience — bucket subordination of qualification_pressure
  const inputA: ObjectionTagBiasInput = {
    primaryObjectionType: "trust_risk",
    objectionTags: st([
      ["confusion_clarity", 8],
      ["trust_risk", 7],
      ["past_bad_experience", 6],
    ]),
  };
  const ctxA = prepareObjectionBiasContext(inputA);
  const refsA = trustBundleRefStructAndRisk(ctxA.sortedTags, ctxA.primaryNorm);
  console.log("A) trust_risk + past_bad_experience + confusion (top-2 trust-sensitive)");
  console.log(
    `   tag-bundle ref: structure_clarity=${refsA.refStruct.toFixed(2)}, risk_reduction=${refsA.refRisk.toFixed(2)}`
  );
  const qual = computeObjectionBiasStyleBuckets(
    cand("qonly", "qualification_pressure"),
    ctxA.sortedTags,
    ctxA.primaryNorm,
    ctxA.presentTags
  );
  const str = computeObjectionBiasStyleBuckets(
    cand("stronly", "structure_clarity"),
    ctxA.sortedTags,
    ctxA.primaryNorm,
    ctxA.presentTags
  );
  const risk = computeObjectionBiasStyleBuckets(
    cand("riskonly", "risk_reduction"),
    ctxA.sortedTags,
    ctxA.primaryNorm,
    ctxA.presentTags
  );
  console.log(
    `   structure_clarity bucket (candidate): ${(str.buckets[KEY_STRUCT] ?? 0).toFixed(2)}`
  );
  console.log(
    `   risk_reduction bucket:     ${(risk.buckets[KEY_RISK] ?? 0).toFixed(2)}`
  );
  console.log(
    `   qualification_pressure:    ${(qual.buckets[KEY_QUAL] ?? 0).toFixed(2)} (must be ≤ 35% of clarity and ≤ 35% of risk when both >0)`
  );
  const qv = qual.buckets[KEY_QUAL] ?? 0;
  const capExpected =
    refsA.refStruct > 0 && refsA.refRisk > 0
      ? Math.min(0.35 * refsA.refStruct, 0.35 * refsA.refRisk)
      : refsA.refStruct > 0
        ? 0.35 * refsA.refStruct
        : refsA.refRisk > 0
          ? 0.35 * refsA.refRisk
          : Infinity;
  const okA = qv <= capExpected + 1e-6;
  console.log(
    `   expected qual cap (35%·min refs): ${capExpected === Infinity ? "n/a" : capExpected.toFixed(2)}`
  );
  console.log(`   check: ${okA ? "OK" : "FAIL"} (qual subordinate to trust-safe refs)\n`);

  // B) cash_flow + margin — COD floor on cost_of_delay_redirect candidate
  const inputB: ObjectionTagBiasInput = {
    primaryObjectionType: "margin_profitability",
    objectionTags: st([
      ["margin_profitability", 5],
      ["cash_flow_pressure", 5],
    ]),
  };
  const ctxB = prepareObjectionBiasContext(inputB);
  const cod = computeObjectionBiasStyleBuckets(
    cand("codonly", "cost_of_delay_redirect"),
    ctxB.sortedTags,
    ctxB.primaryNorm,
    ctxB.presentTags
  );
  const codVal = cod.buckets[KEY_COD] ?? 0;
  console.log("B) margin_profitability + cash_flow_pressure (top-2 commercial)");
  console.log(`   cost_of_delay_redirect bucket: ${codVal.toFixed(2)} (floor 2.5, cap ${6})`);
  console.log(`   check: ${codVal >= 2.5 - 1e-6 ? "OK" : "FAIL"}\n`);

  // C) Mixed: trust + confusion — qualification candidate uses final buckets only (suppression + clamp)
  const inputC: ObjectionTagBiasInput = {
    primaryObjectionType: "trust_risk",
    objectionTags: st([
      ["trust_risk", 6],
      ["confusion_clarity", 5],
    ]),
  };
  const ctxC = prepareObjectionBiasContext(inputC);
  const rawQualOnly = computeObjectionBiasStyleBuckets(
    cand("mixQ", "qualification_pressure"),
    ctxC.sortedTags,
    ctxC.primaryNorm,
    ctxC.presentTags
  );
  const structOnly = computeObjectionBiasStyleBuckets(
    cand("mixS", "structure_clarity"),
    ctxC.sortedTags,
    ctxC.primaryNorm,
    ctxC.presentTags
  );
  const afterApply = applyObjectionTagBias({
    scoredCandidates: [
      cand("mixQ", "qualification_pressure"),
      cand("mixS", "structure_clarity"),
    ],
    primaryObjectionType: inputC.primaryObjectionType,
    objectionTags: inputC.objectionTags,
  });
  const mixQ = afterApply.find((c) => c.patternKey === "mixQ")!;
  const mixS = afterApply.find((c) => c.patternKey === "mixS")!;
  console.log("C) trust_risk + confusion_clarity — final candidate score = f(adjusted buckets only)");
  console.log(
    `   qual candidate bonus:      ${(mixQ.score - 100).toFixed(2)} (from reasons: adjusted pipeline)`
  );
  console.log(
    `   structure candidate bonus: ${(mixS.score - 100).toFixed(2)}`
  );
  console.log(
    `   inline compute qual bonus: ${rawQualOnly.bonus.toFixed(2)} (must match mixQ bias)`
  );
  const okC = Math.abs(mixQ.score - 100 - rawQualOnly.bonus) < 1e-6;
  console.log(
    `   check: ${okC ? "OK" : "FAIL"} (applyObjectionTagBias score delta === computeObjectionBiasStyleBuckets.bonus)`
  );
  console.log(
    `   structure > qual: ${(structOnly.bonus > rawQualOnly.bonus) ? "OK" : "FAIL"} (trust-safety leads)\n`
  );
}

function main() {
  console.log("Phase 4.4 — Pattern ranking (scored tags + diminishing + style cap + suppression)\n");
  for (const c of cases) {
    const before = c.candidates.map((x) => ({ ...x, reasons: [...x.reasons] }));
    const after = applyObjectionTagBias({
      scoredCandidates: before,
      primaryObjectionType: c.primaryObjectionType,
      objectionTags: c.objectionTags,
    });
    const tagStr =
      c.objectionTags.length > 0
        ? c.objectionTags.map((t) => `${t.tag}:${t.score}`).join(", ")
        : "(none)";
    console.log(`--- ${c.name}`);
    console.log(`    primary=${c.primaryObjectionType ?? "null"} tags=[${tagStr}]`);
    console.log(`    BEFORE: ${orderKeys(before)}`);
    console.log(`    AFTER:  ${orderKeys(after)}`);
    if (c.name.startsWith("A)")) {
      const scores = sortByScore(after).map((r) => r.score - 100);
      const spread = Math.max(...scores) - Math.min(...scores.filter((s) => s > 0));
      console.log(`    (bias spread hint: top vs non-top gap ~${spread.toFixed(2)} — capped per-style + global max)`);
    }
    if (c.name.startsWith("B)")) {
      const q = after.find((x) => x.patternKey === "b1");
      const cl = after.find((x) => x.patternKey === "b2");
      if (q && cl) {
        console.log(
          `    b1 qualification_pressure bonus vs b2 structure_clarity: ${(q.score - 100).toFixed(2)} vs ${(cl.score - 100).toFixed(2)}`
        );
      }
    }
    console.log("");
  }

  runExplicitChecks();
}

main();
