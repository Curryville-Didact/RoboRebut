/**
 * LLM Connection Pre-warmer
 *
 * Fires a minimal "wake" request to the LLM endpoint the moment a broker
 * opens a conversation thread. By the time they type their first objection,
 * the TCP connection, TLS handshake, and auth validation are already done.
 *
 * Strategy:
 * - Send a 1-token completion request ("Hi") with max_tokens: 1
 * - Fire and forget — never awaited, never blocks the WS connection
 * - Silently swallows all errors — if prewarm fails, real request still works
 * - Deduplicates per endpoint — one prewarm per endpoint per 30 seconds
 * - Uses the same endpoint resolution logic as callChatCompletions
 */

const PREWARM_COOLDOWN_MS = 30_000; // 30 seconds between prewarms per endpoint
const PREWARM_TIMEOUT_MS = 8_000; // 8 second timeout — just enough to warm the connection

// Track last prewarm time per endpoint to avoid hammering
const lastPrewarmAt = new Map<string, number>();

/**
 * Resolve which LLM endpoint to use — mirrors the logic in coachChatReply.ts.
 * Returns { endpoint, authHeader } or null if no LLM is configured.
 */
function resolveLlmEndpoint(): { endpoint: string; authHeader: string; model: string } | null {
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL?.trim();
  const gatewayKey = process.env.OPENCLAW_API_KEY?.trim();
  const gatewayModel = process.env.OPENCLAW_CHAT_MODEL ?? "openclaw/gtm-offer";

  // Mirror the same priority order as coachChatReply.ts
  if (openaiKey) {
    return {
      endpoint: "https://api.openai.com",
      authHeader: `Bearer ${openaiKey}`,
      model: process.env.COACH_LIVE_MODEL ?? "gpt-4o-mini",
    };
  }

  if (gatewayUrl && gatewayKey) {
    return {
      endpoint: gatewayUrl,
      authHeader: `Bearer ${gatewayKey}`,
      model: gatewayModel,
    };
  }

  return null;
}

/**
 * Fire a minimal 1-token request to warm the LLM connection.
 * Call this when a broker opens a conversation thread.
 * Never await this — it is always fire-and-forget.
 */
export function prewarmLlmConnection(): void {
  // Run async but never block the caller
  void (async () => {
    try {
      const config = resolveLlmEndpoint();
      if (!config) return; // No LLM configured — skip silently

      const { endpoint, authHeader, model } = config;
      const now = Date.now();

      // Deduplicate — skip if we prewarm this endpoint recently
      const lastWarm = lastPrewarmAt.get(endpoint) ?? 0;
      if (now - lastWarm < PREWARM_COOLDOWN_MS) return;

      // Mark prewarm attempt immediately to prevent duplicate concurrent calls
      lastPrewarmAt.set(endpoint, now);

      const res = await fetch(`${endpoint}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 1,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(PREWARM_TIMEOUT_MS),
      });

      // We only care that the connection was established — not the response
      if (!res.ok) {
        // Reset timestamp on failure so next real request doesn't skip prewarm
        lastPrewarmAt.set(endpoint, 0);
      }
    } catch {
      // Silently swallow all errors — prewarm failure never affects real requests
      // Reset so next connection attempt tries again
      try {
        const config = resolveLlmEndpoint();
        if (config) lastPrewarmAt.set(config.endpoint, 0);
      } catch {
        // ignore
      }
    }
  })();
}

/**
 * Clear prewarm cache — useful for testing or after endpoint config changes.
 */
export function clearPrewarmCache(): void {
  lastPrewarmAt.clear();
}
