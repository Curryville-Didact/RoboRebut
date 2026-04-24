/**
 * Phase 8 refinement — Static variant inventory registry snapshot.
 *
 * Builds a baseline of known variants from the current code inventory (Phase 6.3 sets)
 * so offline intelligence can detect unused/missing coverage.
 *
 * IMPORTANT: This is offline-only and must never run on the Live request path.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

type RegistryRow = {
  objection_type: string | null;
  rhetorical_type: string | null;
  strategy_tag: string | null;
  variant_key: string;
  variant_text_sample: string;
  source_family: string;
  source_module: string;
  metadata: Record<string, unknown> | null;
};

function stableVariantKey(text: string): string {
  const s = text.trim();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `v_${h.toString(16)}`;
}

function rhetoricalTypeByIndex(i: number): "diagnostic" | "reframe" | "threshold" {
  if (i === 0) return "diagnostic";
  if (i === 1) return "reframe";
  return "threshold";
}

export function extractPhase63FamilyVariantArraysFromSource(source: string): Record<string, string[]> {
  const families = [
    "PRICE",
    "PAYMENT",
    "TRUST",
    "COMPARISON",
    "REVIEW",
    "TIMING",
  ] as const;
  const out: Record<string, string[]> = {};
  for (const fam of families) {
    const re = new RegExp(
      `const\\s+PH63_${fam}_VARIANTS\\s*=\\s*\\[(.*?)\\]\\s*as\\s+const;`,
      "s"
    );
    const m = source.match(re);
    if (!m) continue;
    const body = m[1] ?? "";
    const strings: string[] = [];
    const strRe = /"([^"]*)"/g;
    let sm: RegExpExecArray | null;
    while ((sm = strRe.exec(body)) !== null) {
      strings.push(sm[1] ?? "");
    }
    out[fam] = strings;
  }
  return out;
}

function mapFamilyKeyToObjectionType(fam: string): string {
  // Keep naming aligned with existing Phase 6 family labels.
  if (fam === "PRICE") return "price_total_cost";
  if (fam === "PAYMENT") return "payment_burden";
  if (fam === "TRUST") return "trust_control";
  if (fam === "COMPARISON") return "comparison_incumbent";
  if (fam === "REVIEW") return "review_approval";
  return "timing_delay";
}

export async function buildVariantInventoryRegistrySnapshot(input: {
  userId: string;
  runId: string;
  sourceModuleLabel?: string;
}): Promise<RegistryRow[]> {
  const sourceModuleLabel = input.sourceModuleLabel ?? "frontend/liveVoicePolish.ts:PH63";

  // Resolve the frontend Live polish file without importing it (avoids coupling/runtime effects).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const liveVoicePolishPath = path.resolve(
    here,
    "../../../../frontend/src/lib/liveVoicePolish.ts"
  );
  const source = await readFile(liveVoicePolishPath, "utf8");
  const arrays = extractPhase63FamilyVariantArraysFromSource(source);

  const rows: RegistryRow[] = [];
  for (const [fam, variants] of Object.entries(arrays)) {
    const objection_type = mapFamilyKeyToObjectionType(fam);
    variants.forEach((text, idx) => {
      const t = text.trim();
      if (!t) return;
      rows.push({
        objection_type,
        rhetorical_type: rhetoricalTypeByIndex(idx),
        strategy_tag: null,
        variant_key: stableVariantKey(t),
        variant_text_sample: t,
        source_family: objection_type,
        source_module: sourceModuleLabel,
        metadata: null,
      });
    });
  }
  return rows;
}

export async function persistVariantInventoryRegistrySnapshot(input: {
  supabase: SupabaseClient;
  userId: string;
  runId: string;
}): Promise<{ registryVariantsLoaded: number }> {
  const rows = await buildVariantInventoryRegistrySnapshot({
    userId: input.userId,
    runId: input.runId,
  });
  if (rows.length === 0) return { registryVariantsLoaded: 0 };

  const payload = rows.map((r) => ({
    run_id: input.runId,
    user_id: input.userId,
    objection_type: r.objection_type,
    rhetorical_type: r.rhetorical_type,
    strategy_tag: r.strategy_tag,
    variant_key: r.variant_key,
    variant_text_sample: r.variant_text_sample,
    source_family: r.source_family,
    source_module: r.source_module,
    metadata: r.metadata,
  }));

  const { error } = await input.supabase
    .from("variant_inventory_registry_snapshots")
    .insert(payload);
  if (error) throw new Error(error.message);
  return { registryVariantsLoaded: rows.length };
}

