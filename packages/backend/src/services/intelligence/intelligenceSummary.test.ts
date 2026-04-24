import assert from "node:assert/strict";
import { buildInsightsFromRows } from "./intelligenceSummary.js";

function run(): void {
  const insights = buildInsightsFromRows({
    runId: "r1",
    runMeta: { windowDays: 30, minSampleThreshold: 5 },
    snapshots: [
      {
        objection_type: "trust",
        strategy_tag: "s1",
        rhetorical_type: "diagnostic",
        variant_key: "v1",
        usage_count: 20,
        avg_rating: 4.6,
        success_rate: 0.8,
      },
      {
        objection_type: "price",
        strategy_tag: "s2",
        rhetorical_type: "threshold",
        variant_key: "v2",
        usage_count: 20,
        avg_rating: 2.2,
        success_rate: 0.2,
      },
    ],
    registry: [
      { objection_type: "timing_delay", rhetorical_type: "diagnostic", variant_key: "vx" },
    ],
    reviews: [
      { disposition: "weak", structured_tags: ["too_long", "repetitive"] },
      { disposition: "weak", structured_tags: ["repetitive"] },
      { disposition: "strong", structured_tags: ["strong_delivery"] },
    ],
  });

  assert.equal(insights.metadata.run_id, "r1");
  assert.equal(insights.topPerformers[0]!.objection_type, "trust");
  assert.equal(insights.weakZones[0]!.objection_type, "price");
  assert.equal(insights.reviewBreakdown.dispositionCounts.weak, 2);
  assert.equal(insights.reviewBreakdown.tagCounts.repetitive, 2);
  assert.equal(insights.operatorInsights.topFailurePattern.includes("repetitive"), true);
}

run();
// eslint-disable-next-line no-console
console.log("[intelligenceSummary.test] ok");

