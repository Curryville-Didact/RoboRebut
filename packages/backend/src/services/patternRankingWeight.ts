/**
 * Phase 4.4 — Pattern intelligence ranking boost (additive only, production coach path).
 */

export type PatternPerformanceStats = {
  generatedCount?: number;
  savedCount?: number;
  saveRate?: number;
};

export function additionalPatternRankingBoost(
  stats?: PatternPerformanceStats
): number {
  if (!stats) return 0;

  const { generatedCount = 0, saveRate = 0 } = stats;

  // Only apply boost when statistically meaningful
  if (generatedCount < 5) return 0;
  if (saveRate < 0.5) return 0;

  return Math.min(12, Math.floor(saveRate * 12));
}
