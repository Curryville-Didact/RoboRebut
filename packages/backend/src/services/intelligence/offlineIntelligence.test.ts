import assert from "node:assert/strict";
import { aggregateOfflineIntelligence } from "./offlineIntelligence.js";

function run(): void {
  // Complete data: 2 events same group, one strong review, one weak.
  const rows = aggregateOfflineIntelligence({
    events: [
      {
        id: "e1",
        objection_type: "price",
        strategy_tag: null,
        rhetorical_type: "threshold",
        selected_variant_text: "Line A",
        final_live_script: "Line A",
      },
      {
        id: "e2",
        objection_type: "price",
        strategy_tag: null,
        rhetorical_type: "threshold",
        selected_variant_text: "Line A",
        final_live_script: "Line A",
      },
    ],
    reviews: [
      { rebuttal_event_id: "e1", rating: 5, outcome_tag: "strong" },
      { rebuttal_event_id: "e2", rating: 1, outcome_tag: "weak" },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.usage_count, 2);
  assert.equal(rows[0]!.avg_rating, 3);
  assert.equal(rows[0]!.positive_outcome_count, 1);
  assert.equal(rows[0]!.negative_outcome_count, 1);
  assert.equal(rows[0]!.success_rate, 0.5);

  // Missing reviews: should be stable and not crash.
  const rows2 = aggregateOfflineIntelligence({
    events: [
      {
        id: "e3",
        objection_type: "trust",
        strategy_tag: null,
        rhetorical_type: "diagnostic",
        selected_variant_text: null,
        final_live_script: "Line B",
      },
    ],
    reviews: [],
  });
  assert.equal(rows2.length, 1);
  assert.equal(rows2[0]!.avg_rating, null);
  assert.equal(rows2[0]!.success_rate, null);

  // Deterministic classification rules (underutilized) — allowed under min sample threshold.
  const rows3 = aggregateOfflineIntelligence({
    events: [
      {
        id: "e4",
        objection_type: "timing",
        strategy_tag: "p1",
        rhetorical_type: "reframe",
        selected_variant_text: "Line C",
        final_live_script: "Line C",
      },
    ],
    reviews: [{ rebuttal_event_id: "e4", rating: 5, outcome_tag: "strong" }],
  });
  assert.equal(rows3.length, 1);
  assert.equal(rows3[0]!.recommendation_type, "underutilized");

  // Strategy tag splits groups deterministically.
  const rows4 = aggregateOfflineIntelligence({
    events: [
      {
        id: "e5",
        objection_type: "price",
        strategy_tag: "a",
        rhetorical_type: "threshold",
        selected_variant_text: "Same line",
        final_live_script: "Same line",
      },
      {
        id: "e6",
        objection_type: "price",
        strategy_tag: "b",
        rhetorical_type: "threshold",
        selected_variant_text: "Same line",
        final_live_script: "Same line",
      },
    ],
    reviews: [],
  });
  assert.equal(rows4.length, 2);

  // under_review_flag should only fire on real conflict.
  const rows5 = aggregateOfflineIntelligence({
    events: [
      {
        id: "e7",
        objection_type: "trust",
        strategy_tag: null,
        rhetorical_type: "diagnostic",
        selected_variant_text: "Line D",
        final_live_script: "Line D",
      },
      {
        id: "e8",
        objection_type: "trust",
        strategy_tag: null,
        rhetorical_type: "diagnostic",
        selected_variant_text: "Line D",
        final_live_script: "Line D",
      },
    ],
    reviews: [
      { rebuttal_event_id: "e7", rating: 5, outcome_tag: "strong" },
      { rebuttal_event_id: "e8", rating: 1, outcome_tag: "weak" },
    ],
  });
  assert.equal(rows5.length, 1);
  assert.equal(rows5[0]!.under_review_flag, true);
}

run();
// eslint-disable-next-line no-console
console.log("[offlineIntelligence.test] ok");

