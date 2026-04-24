import assert from "node:assert/strict";
import { computeHmacSignature } from "./outboundDispatcher.js";

function run(): void {
  const sig1 = computeHmacSignature("secret", "{\"a\":1}");
  const sig2 = computeHmacSignature("secret", "{\"a\":1}");
  const sig3 = computeHmacSignature("secret2", "{\"a\":1}");
  assert.equal(sig1, sig2);
  assert.notEqual(sig1, sig3);
}

run();
// eslint-disable-next-line no-console
console.log("[outboundDispatcher.test] ok");

