/**
 * Manual verification for objection multi-tag classifier (run: node --import tsx scripts/verify-objection-tags.ts).
 */
import { resolvePrimaryAndSecondaryObjections } from "../src/services/objectionMultiTagClassification.js";

const baselineSamples: {
  label: string;
  text: string;
  expectPrimary: string;
  mustInclude: string[];
}[] = [
  {
    label: "A",
    text: "This payment is too high",
    expectPrimary: "price_cost_framing",
    mustInclude: ["price_cost_framing", "payment_affordability"],
  },
  {
    label: "B",
    text: "My margins are thin and this weekly payment comes out of profit",
    expectPrimary: "margin_profitability",
    mustInclude: [
      "margin_profitability",
      "payment_affordability",
      "cash_flow_pressure",
    ],
  },
  {
    label: "C",
    text: "I got burned by one of these before",
    expectPrimary: "past_bad_experience",
    mustInclude: ["past_bad_experience", "trust_risk"],
  },
  {
    label: "D",
    text: "I need to wait a few weeks",
    expectPrimary: "timing_delay",
    mustInclude: ["timing_delay", "decision_avoidance"],
  },
  {
    label: "E",
    text:
      "Brokers take forever to pay me so the weekly debit doesn't line up",
    expectPrimary: "receivables_lag",
    mustInclude: [
      "receivables_lag",
      "structure_mismatch",
      "cash_flow_pressure",
    ],
  },
];

/** Uneven sales / daily pull / slow days — expect payment + cash_flow + structure; not spurious decision_avoidance. */
const restaurantCadenceSamples: {
  label: string;
  text: string;
  expectPrimary: string;
  mustInclude: string[];
  mustNotInclude?: string[];
}[] = [
  {
    label: "R1",
    text: "$700 coming out every single day? that's aggressive restaurants don't have consistent days like that",
    expectPrimary: "structure_mismatch",
    mustInclude: [
      "payment_affordability",
      "cash_flow_pressure",
      "structure_mismatch",
    ],
    mustNotInclude: ["decision_avoidance"],
  },
  {
    label: "R2",
    text: "My slow days can't handle that kind of pull",
    expectPrimary: "payment_affordability",
    mustInclude: [
      "payment_affordability",
      "cash_flow_pressure",
      "structure_mismatch",
    ],
    mustNotInclude: ["decision_avoidance"],
  },
  {
    label: "R3",
    text: "Some days are dead, I can't have the same amount coming out",
    expectPrimary: "structure_mismatch",
    mustInclude: [
      "payment_affordability",
      "cash_flow_pressure",
      "structure_mismatch",
    ],
    mustNotInclude: ["decision_avoidance"],
  },
  {
    label: "R4",
    text: "Restaurants don't have consistent days like that",
    expectPrimary: "structure_mismatch",
    mustInclude: [
      "payment_affordability",
      "cash_flow_pressure",
      "structure_mismatch",
    ],
    mustNotInclude: ["decision_avoidance"],
  },
  {
    label: "R5",
    text: "What happens on Monday and Tuesday when we're slow?",
    expectPrimary: "structure_mismatch",
    mustInclude: [
      "payment_affordability",
      "cash_flow_pressure",
      "structure_mismatch",
    ],
    mustNotInclude: ["decision_avoidance"],
  },
  {
    label: "R6",
    text: "The weekly debit is $500 but brokers pay me later than that hits",
    expectPrimary: "receivables_lag",
    mustInclude: ["receivables_lag", "payment_affordability"],
    mustNotInclude: ["decision_avoidance"],
  },
];

function topTagsSummary(
  rows: { tag: string; score: number }[],
  n: number
): string {
  return rows
    .slice(0, n)
    .map((o) => `${o.tag}:${o.score}`)
    .join(", ");
}

function main() {
  console.log("=== Baseline regression ===\n");
  for (const s of baselineSamples) {
    const r = resolvePrimaryAndSecondaryObjections({
      userMessage: s.text,
      legacyNormalizedCategory: "unknown",
    });
    const okPrimary = r.primaryObjectionType === s.expectPrimary;
    const okTags = s.mustInclude.every((t) =>
      r.objectionTags.some((o) => o.tag === t)
    );
    console.log(
      `[${s.label}] primary=${r.primaryObjectionType} (expect ${s.expectPrimary}) ${okPrimary ? "OK" : "FAIL"}`
    );
    console.log(`    top tags: ${topTagsSummary(r.objectionTags, 6)}`);
    console.log(`    tags check: ${okTags ? "OK" : "FAIL"}`);
  }

  console.log("\n=== Restaurant / uneven-sales cadence family ===\n");
  for (const s of restaurantCadenceSamples) {
    const r = resolvePrimaryAndSecondaryObjections({
      userMessage: s.text,
      legacyNormalizedCategory: "unknown",
    });
    const okPrimary = r.primaryObjectionType === s.expectPrimary;
    const okTags = s.mustInclude.every((t) =>
      r.objectionTags.some((o) => o.tag === t)
    );
    const okNeg =
      s.mustNotInclude == null ||
      s.mustNotInclude.every(
        (t) => !r.objectionTags.some((o) => o.tag === t)
      );
    console.log(`[${s.label}] ${s.text.slice(0, 72)}${s.text.length > 72 ? "…" : ""}`);
    console.log(
      `    primary=${r.primaryObjectionType} (expect ${s.expectPrimary}) ${okPrimary ? "OK" : "FAIL"}`
    );
    console.log(`    top tags: ${topTagsSummary(r.objectionTags, 6)}`);
    console.log(
      `    include check: ${okTags ? "OK" : "FAIL"}  |  no false deferral: ${okNeg ? "OK" : "FAIL"}`
    );
  }
}

main();
