/**
 * coachChatReply.ts — AI coaching reply for conversation threads.
 *
 * Priority:
 *   1. OpenClaw Gateway (OPENCLAW_GATEWAY_URL + OPENCLAW_GATEWAY_TOKEN) — preferred
 *   2. OpenAI direct (OPENAI_API_KEY) — fallback
 *   3. Placeholder string — safe fallback when neither is configured
 *
 * The gateway exposes an OpenAI-compatible /v1/chat/completions endpoint.
 * Model: OPENCLAW_CHAT_MODEL env var, or "openclaw/gtm-offer" by default.
 */

export type ThreadMessage = { role: "user" | "ai"; content: string };

const SYSTEM_PROMPT = `You are RoboRebut, a focused sales-call coach helping MCA brokers handle objections live.

When the user sends a merchant objection or describes a situation:
- Identify the objection type (price, timing, authority, trust, competitor, no_need, brush_off, or hidden)
- Give 1-2 direct, battle-tested rebuttals they can say right now
- Keep responses under 200 words
- Write like a coach talking to a broker, not a textbook
- Be specific and actionable — no generic platitudes

When the user asks a general coaching question, answer it directly and practically.`;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function callChatCompletions(
  endpoint: string,
  authHeader: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number
): Promise<string> {
  const res = await fetch(`${endpoint}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.65,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty model response");
  return text;
}

export async function generateCoachReply(input: {
  conversationTitle: string;
  priorMessages: ThreadMessage[];
  userMessage: string;
}): Promise<string> {
  const prior: ChatMessage[] = input.priorMessages.map((m) => ({
    role: m.role === "ai" ? ("assistant" as const) : ("user" as const),
    content: m.content,
  }));

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...prior,
    { role: "user", content: input.userMessage },
  ];

  // --- Path 1: OpenClaw Gateway ---
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL?.trim();
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();

  if (gatewayUrl && gatewayToken) {
    const model =
      process.env.OPENCLAW_CHAT_MODEL?.trim() ?? "openclaw/gtm-offer";
    try {
      return await callChatCompletions(
        gatewayUrl,
        `Bearer ${gatewayToken}`,
        model,
        messages,
        900
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[coachChatReply] OpenClaw gateway failed (${msg}), trying OpenAI fallback`);
    }
  }

  // --- Path 2: OpenAI direct ---
  const openaiKey = process.env.OPENAI_API_KEY?.trim();

  if (openaiKey) {
    const model = process.env.OPENAI_CHAT_MODEL?.trim() ?? "gpt-4o-mini";
    try {
      return await callChatCompletions(
        "https://api.openai.com",
        `Bearer ${openaiKey}`,
        model,
        messages,
        900
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `AI reply could not be generated (${msg}). Your message was saved — try again.`;
    }
  }

  // --- Path 3: Not configured ---
  return "AI coaching is not yet configured. Ask Leonard to set OPENCLAW_GATEWAY_TOKEN in the backend environment.";
}
