export type DemoConversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export const DEMO_CONVERSATIONS: DemoConversation[] = [
  {
    id: "demo_todd_construction",
    title: "Todd Construction — Working capital",
    created_at: "2026-04-01T12:00:00.000Z",
    updated_at: "2026-04-12T16:18:00.000Z",
  },
  {
    id: "demo_martin_trucking",
    title: "Martin Trucking — Equipment repair cashflow",
    created_at: "2026-04-03T15:20:00.000Z",
    updated_at: "2026-04-13T14:41:00.000Z",
  },
  {
    id: "demo_dave_restaurant_mca",
    title: "Dave’s Restaurant — MCA renewal pushback",
    created_at: "2026-04-06T10:10:00.000Z",
    updated_at: "2026-04-14T11:05:00.000Z",
  },
];

export type DemoSavedResponse = {
  id: string;
  label: string;
  content: string;
  category: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
};

export const DEMO_SAVED_RESPONSES: DemoSavedResponse[] = [
  {
    id: "demo_sr_1",
    label: "Todd Construction — Payment feels heavy",
    category: "price",
    created_at: "2026-04-10T17:10:00.000Z",
    metadata: {
      tone: "direct",
      objectionPreview: "I just can’t take on another payment right now. It feels too heavy.",
      objectionType: "cash_flow",
      patternKey: "REFRAME/terms_control",
      strategyUsed: "reframe_to_terms",
      structured_reply: {
        coachReplyMode: "live",
        liveOpeningLines: [
          "Totally fair — the question isn’t “is there a payment,” it’s whether the payment is lighter than the problem it’s solving.",
          "What’s heavier right now: the daily hit, or staying tight on cash with no move?",
        ],
        rebuttals: [
          { title: "Reframe", sayThis: "If the structure keeps cash moving and revenue stable, the payment should feel like leverage, not drag." },
          { title: "Control", sayThis: "If we can tighten the daily so it matches your slow days, does that fix the concern?" },
        ],
        coachNote: "Anchor to cash control, not “cost.”",
        followUp: "What daily number feels safe on your slowest week?",
      },
    },
    content:
      "Totally fair — the question isn’t “is there a payment,” it’s whether the payment is lighter than the problem it’s solving.\n\nIf the structure keeps cash moving and revenue stable, the payment should feel like leverage, not drag. What’s heavier right now: the daily hit, or staying tight on cash with no move?\n\nFollow-up: What daily number feels safe on your slowest week?",
  },
  {
    id: "demo_sr_2",
    label: "Martin Trucking — Need to think about it",
    category: "stall",
    created_at: "2026-04-11T13:40:00.000Z",
    metadata: {
      tone: "calm",
      objectionPreview: "I need to think about it.",
      objectionType: "stall",
      patternKey: "CONTROL/decision_path",
      strategyUsed: "decision_question",
    },
    content:
      "Of course — when you say “think about it,” is it the price, the terms, or trust in the outcome?\n\nIf we solve that one thing right now, are you comfortable moving forward today?",
  },
  {
    id: "demo_sr_3",
    label: "Dave’s Restaurant — Bad experience last time",
    category: "trust",
    created_at: "2026-04-12T09:05:00.000Z",
    metadata: {
      tone: "empathetic",
      objectionPreview: "Last time was a nightmare. Hidden stuff popped up and it hurt us.",
      objectionType: "trust",
      patternKey: "ALIGN/proof",
      strategyUsed: "risk_reversal",
    },
    content:
      "That’s exactly what we avoid — no surprises, no moving targets.\n\nBefore we talk numbers, what went wrong last time: the total payback, the daily pull, or the “extras” that showed up after?\n\nIf we lock the terms in writing and you can see the exact cost and daily upfront, does that remove the risk for you?",
  },
  {
    id: "demo_sr_4",
    label: "General — Comparing offers",
    category: "comparison",
    created_at: "2026-04-13T18:22:00.000Z",
    metadata: {
      tone: "direct",
      objectionPreview: "We’re comparing a couple offers.",
      objectionType: "comparison",
      patternKey: "CONTROL/criteria",
      strategyUsed: "criteria_lock",
    },
    content:
      "Perfect — what’s the decision criteria that actually wins for you: lowest total, lowest daily, speed, or flexibility?\n\nIf we can win on the one that matters, is there any reason you wouldn’t move today?",
  },
];

export type DemoMessage = { role: "user" | "ai"; content: string; created_at: string };

export const DEMO_THREADS: Record<string, DemoMessage[]> = {
  demo_todd_construction: [
    {
      role: "user",
      content: "The payment feels too heavy right now. I can’t take on another bill.",
      created_at: "2026-04-12T16:17:00.000Z",
    },
    {
      role: "ai",
      content:
        "Totally fair — the question isn’t “is there a payment,” it’s whether the payment is lighter than the problem it’s solving.\n\nIf the structure keeps cash moving and revenue stable, the payment should feel like leverage, not drag. What’s heavier right now: the daily hit, or staying tight on cash with no move?",
      created_at: "2026-04-12T16:17:10.000Z",
    },
  ],
  demo_martin_trucking: [
    {
      role: "user",
      content: "I need to think about it.",
      created_at: "2026-04-13T14:40:00.000Z",
    },
    {
      role: "ai",
      content:
        "Of course — when you say “think about it,” is it the price, the terms, or trust in the outcome?\n\nIf we solve that one thing right now, are you comfortable moving forward today?",
      created_at: "2026-04-13T14:40:08.000Z",
    },
  ],
  demo_dave_restaurant_mca: [
    {
      role: "user",
      content: "Last time was a nightmare. Hidden stuff popped up and it hurt us.",
      created_at: "2026-04-14T11:04:10.000Z",
    },
    {
      role: "ai",
      content:
        "That’s exactly what we avoid — no surprises, no moving targets.\n\nBefore we talk numbers, what went wrong last time: the total payback, the daily pull, or the “extras” that showed up after?\n\nIf we lock the terms in writing and you can see the exact cost and daily upfront, does that remove the risk for you?",
      created_at: "2026-04-14T11:04:25.000Z",
    },
  ],
};

