/**
 * Phase 4.9 — Verify analytics intelligence summary is stable and null-safe.
 *
 * Run: cd packages/backend && npx tsx scripts/verify-analytics-intelligence.ts
 */
import dotenv from "dotenv";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { buildAnalyticsIntelligenceSummary } from "../src/services/analyticsIntelligence.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    console.log("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY; skipping.");
    return;
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const a = await buildAnalyticsIntelligenceSummary(supabase, { limit: 250, conversationId: null });
  const b = await buildAnalyticsIntelligenceSummary(supabase, { limit: 250, conversationId: null });
  const stable = JSON.stringify(a) === JSON.stringify(b);

  console.log("=== Phase 4.9 analytics intelligence verification ===\n");
  console.log(`intelRows: ${a.window.intelRows}`);
  console.log(`topPatternKeys: ${a.selection.topPatternKeys.length}`);
  console.log(`singleCandidateRate: ${a.selection.singleCandidateRate ?? "null"}`);
  console.log(`multiCandidateRate: ${a.selection.multiCandidateRate ?? "null"}`);
  console.log(`avgCandidateCount: ${a.selection.avgCandidateCount ?? "null"}`);
  console.log(`avgUniquePatternKeyCount: ${a.selection.avgUniquePatternKeyCount ?? "null"}`);
  console.log(`avgScoreGap: ${a.selection.avgScoreGap ?? "null"}`);
  console.log(`antiRepeat.appliedRate: ${a.antiRepeat.appliedRate ?? "null"}`);
  console.log(`dvl.appliedRate: ${a.dvl.appliedRate ?? "null"}`);
  console.log(`confidence.avg: ${a.confidence.avg ?? "null"}`);
  console.log(`saves.saveRate: ${a.saves.saveRate ?? "null"}`);
  console.log(`health.missingDecisionMetaRate: ${a.health.missingDecisionMetaRate}`);
  console.log(`branches_with_avgUnique: ${a.branches.filter((b) => b.avgUniquePatternKeyCount != null).length}`);
  console.log(`determinism: ${stable ? "PASS" : "FAIL"}`);
}

main().catch((e) => {
  console.error(e);
});

