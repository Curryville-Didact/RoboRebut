/**
 * Pre-call generation depth (only applies when coach mode is `precall`).
 * Live mode ignores this field entirely.
 */

export type PreCallDepth = "instant" | "deep";

/** Alias for request-contract naming (`precall_depth`). */
export type PrecallDepth = PreCallDepth;

/** Legacy clients omit this field — preserve full pre-call behavior. */
export function parsePreCallDepth(raw: unknown): PreCallDepth {
  if (raw === "instant" || raw === "deep") return raw;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "instant" || s === "fast" || s === "quick") return "instant";
    if (s === "deep" || s === "full") return "deep";
  }
  return "deep";
}

/**
 * Resolve depth for POST bodies. Prefer `precall_depth`, then legacy `pre_call_depth`.
 * Call only when `coach_reply_mode === "precall"`; for `live`, do not use.
 */
export function resolvePrecallDepthFromBody(
  precall_depth: unknown,
  pre_call_depth_legacy: unknown
): PreCallDepth {
  return parsePreCallDepth(precall_depth ?? pre_call_depth_legacy ?? "deep");
}
