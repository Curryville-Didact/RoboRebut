import assert from "node:assert/strict";
import { extractPhase63FamilyVariantArraysFromSource } from "./variantInventoryRegistry.js";

function run(): void {
  const src = `
const PH63_PRICE_VARIANTS = [
  "A",
  "B",
  "C",
] as const;

const PH63_TIMING_VARIANTS = [
  "T1",
  "T2",
  "T3",
] as const;
`;

  const got = extractPhase63FamilyVariantArraysFromSource(src);
  assert.deepEqual(got.PRICE, ["A", "B", "C"]);
  assert.deepEqual(got.TIMING, ["T1", "T2", "T3"]);
}

run();
// eslint-disable-next-line no-console
console.log("[variantInventoryRegistry.test] ok");

