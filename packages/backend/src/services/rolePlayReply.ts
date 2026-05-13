/**
 * rolePlayReply.ts
 * Generates a merchant pushback response for role play mode.
 * The AI plays a skeptical merchant. The rep practices their pitch.
 * Uses OpenAI directly (same pattern as coachChatReply.ts).
 */

export type RolePlayDealType =
  | "mca"
  | "loc"
  | "term_loan"
  | "equipment"
  | "merchant_services"
  | "invoice_factoring";

const DEAL_LABELS: Record<RolePlayDealType, string> = {
  mca: "Merchant Cash Advance",
  loc: "Business Line of Credit",
  term_loan: "Term Loan",
  equipment: "Equipment Leasing",
  merchant_services: "Merchant Services / Payment Processing",
  invoice_factoring: "Invoice Factoring",
};

const DEAL_OBJECTIONS: Record<RolePlayDealType, string[]> = {
  mca: [
    "Your rates are too high. I can get better elsewhere.",
    "I don't want daily payments taking money out of my account.",
    "I already have a cash advance. I don't need another one.",
    "What's the factor rate? That sounds like a lot.",
    "I need to think about it. Call me next week.",
  ],
  loc: [
    "I have a credit card. Why would I need a line of credit?",
    "What happens if I draw down and can't pay it back?",
    "The interest rate seems high compared to my bank.",
    "I don't want to put up collateral.",
    "How is this different from a regular loan?",
  ],
  term_loan: [
    "My bank offered me a better rate.",
    "I don't want a fixed monthly payment.",
    "How long does approval take? I need money now.",
    "What if my revenue drops and I can't make payments?",
    "Why would I use you instead of the SBA?",
  ],
  equipment: [
    "I'd rather just buy the equipment outright.",
    "What happens at the end of the lease?",
    "Can I get out of the lease early if I need to?",
    "The monthly payment doesn't fit my budget right now.",
    "I don't want to be stuck with outdated equipment.",
  ],
  merchant_services: [
    "I'm already with Square. Why would I switch?",
    "Your rates don't look that different from what I have.",
    "I don't want to deal with switching terminals.",
    "What are all the hidden fees?",
    "What's your contract term? I don't want to be locked in.",
  ],
  invoice_factoring: [
    "I don't want my customers to know I'm factoring.",
    "What percentage do you take? That sounds expensive.",
    "What if a customer doesn't pay? Am I on the hook?",
    "I'd rather just wait for my invoices to come in.",
    "How is this different from a regular business loan?",
  ],
};

function buildSystemPrompt(dealType: RolePlayDealType): string {
  const label = DEAL_LABELS[dealType];
  const objections = DEAL_OBJECTIONS[dealType];
  const objectionList = objections.map((o, i) => `${i + 1}. "${o}"`).join("\n");

  return `You are a skeptical business owner being pitched a ${label} by a sales rep.

Your job is to push back, ask hard questions, and act like a real merchant who is:
- Busy and slightly annoyed
- Skeptical of the deal
- Concerned about rates, payments, and getting locked in
- Not easily convinced — make the rep work for it

Rules:
- Stay in character as the merchant at ALL times. Never break character.
- Keep responses SHORT (1-3 sentences max). Real merchants don't monologue.
- Push back on whatever the rep just said. Don't agree easily.
- Use natural, conversational language. Not formal.
- Rotate through different objections naturally — don't repeat the same one twice.
- If the rep gives a genuinely good answer, slightly soften but still find a new concern.
- Never explain that you are an AI or that this is a role play.
- Never give coaching advice or tips to the rep.

Common objections for this deal type:
${objectionList}

Start by reacting to whatever the rep says with a realistic merchant pushback.`;
}

export interface RolePlayInput {
  userMessage: string;
  dealType: RolePlayDealType;
  priorMessages: { role: "user" | "ai"; content: string }[];
  openAiApiKey: string | undefined;
}

export interface RolePlayResult {
  ok: true;
  text: string;
  dealType: RolePlayDealType;
}

export interface RolePlayError {
  ok: false;
  error: string;
}

export async function generateRolePlayReply(
  input: RolePlayInput
): Promise<RolePlayResult | RolePlayError> {
  const { userMessage, dealType, priorMessages, openAiApiKey } = input;

  if (!openAiApiKey) {
    return { ok: false, error: "OpenAI API key not configured" };
  }

  const systemPrompt = buildSystemPrompt(dealType);

  // Build message history (last 10 turns max to keep tokens low)
  const historyMessages = priorMessages.slice(-10).map((m) => ({
    role: m.role === "ai" ? ("assistant" as const) : ("user" as const),
    content: m.content,
  }));

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...historyMessages,
    { role: "user" as const, content: userMessage },
  ];

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 150,
        temperature: 0.85,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: `OpenAI error: ${err}` };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return { ok: false, error: "Empty response from OpenAI" };

    return { ok: true, text, dealType };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
