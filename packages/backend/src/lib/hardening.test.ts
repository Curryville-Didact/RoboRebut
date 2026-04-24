import assert from "node:assert/strict";
import { requireOneOf, asStringArray, asIntInRange } from "./validation.js";

function run(): void {
  assert.equal(requireOneOf(" strong ", ["strong", "weak"] as const), "strong");
  assert.equal(requireOneOf("nope", ["strong", "weak"] as const), null);

  assert.deepEqual(asStringArray([" a ", "b"], 10, 10), ["a", "b"]);
  assert.equal(asStringArray(["a", 2] as any, 10, 10), null);

  assert.equal(asIntInRange("5", 1, 5), 5);
  assert.equal(asIntInRange(6, 1, 5), null);
}

run();
// eslint-disable-next-line no-console
console.log("[hardening.test] ok");

