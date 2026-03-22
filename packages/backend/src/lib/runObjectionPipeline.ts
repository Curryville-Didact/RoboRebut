import type {
  RawInput,
  NormalizedInput,
  ClassificationResult,
  StrategyResult,
  GeneratedResponse,
  EvaluationResult,
  InteractionLog,
  ObjectionType,
} from "../types/pipeline.js";
import { logInteraction, logIfImportant } from "./logger.js";

export async function runObjectionPipeline(input: RawInput) {
  const normalized = normalizeInput(input);
  const classification = classifyInput(normalized);
  const strategy = chooseStrategy(classification);
  const generated = generateResponse(normalized, classification, strategy);
  const evaluation = evaluateResponse(generated, strategy);

  const interaction: InteractionLog = {
    input: normalized.text,
    classification,
    strategy,
    output: generated.reply,
    score: evaluation.score,
    timestamp: Date.now(),
  };

  logInteraction(interaction);
  logIfImportant(interaction);

  return {
    normalized,
    classification,
    strategy,
    generated,
    evaluation,
    interaction,
  };
}

function normalizeInput(input: RawInput): NormalizedInput {
  const text = input.message.trim();
  const lower = text.toLowerCase();

  let sentimentHint: "negative" | "neutral" | "positive" = "neutral";

  if (
    includesAny(lower, [
      "too expensive",
      "expensive",
      "costs too much",
      "cost too much",
      "can't afford",
      "cannot afford",
      "not interested",
      "don't trust",
      "do not trust",
      "sounds risky",
      "bad time",
      "too busy",
      "leave me alone",
      "stop messaging",
      "already using",
      "already have",
      "already solved",
      "we're good",
      "we are good",
      "no need",
      "feel weird",
      "feels off",
      "doesn't feel right",
      "does not feel right",
    ])
  ) {
    sentimentHint = "negative";
  }

  return {
    text,
    metadata: {
      length: text.length,
      hasQuestion: text.includes("?"),
      sentimentHint,
    },
  };
}

function classifyInput(input: NormalizedInput): ClassificationResult {
  const text = input.text.toLowerCase();

  const matchers: Array<{
    type: ObjectionType;
    keywords: string[];
    signals: string[];
    confidence: number;
  }> = [
    {
      type: "price",
      keywords: [
        "too expensive",
        "expensive",
        "costs too much",
        "cost too much",
        "price",
        "pricing",
        "budget",
        "out of budget",
        "can't afford",
        "cannot afford",
        "too much money",
        "more than i want to spend",
      ],
      signals: ["cost language detected", "budget/pricing concern"],
      confidence: 0.93,
    },
    {
      type: "timing",
      keywords: [
        "not right now",
        "bad time",
        "call me later",
        "maybe later",
        "not a good time",
        "i need to think about it",
        "let me think about it",
        "circle back",
        "follow up later",
        "next quarter",
        "next month",
        "next week",
        "too busy",
        "swamped",
      ],
      signals: ["timing delay language detected", "decision deferred"],
      confidence: 0.9,
    },
    {
      type: "authority",
      keywords: [
        "not the decision maker",
        "not the decision-maker",
        "need approval",
        "have to ask my boss",
        "have to ask my manager",
        "need to talk to my partner",
        "need to talk to my wife",
        "need to talk to my husband",
        "owner handles that",
        "my team handles that",
        "not my department",
        "not my call",
        "not up to me",
      ],
      signals: ["authority limitation detected", "external approval required"],
      confidence: 0.94,
    },
    {
      type: "trust",
      keywords: [
        "don't trust",
        "do not trust",
        "sounds like a scam",
        "sounds risky",
        "how do i know",
        "is this legit",
        "is this legitimate",
        "who are you",
        "never heard of you",
        "prove it",
        "show me reviews",
        "show me proof",
        "why should i believe",
        "kinda feel weird",
        "feel weird",
        "this feels weird",
        "something feels off",
        "this feels off",
        "not sure about this",
        "unsure about this",
        "doesn't feel right",
        "does not feel right",
      ],
      signals: ["trust skepticism detected", "credibility challenge"],
      confidence: 0.91,
    },
    {
      type: "confusion",
      keywords: [
        "i don't understand",
        "do not understand",
        "what do you mean",
        "how does this work",
        "i'm confused",
        "confused",
        "unclear",
        "explain that",
        "what is this exactly",
        "can you explain",
        "what does that mean",
      ],
      signals: ["clarity gap detected", "understanding issue"],
      confidence: 0.88,
    },
    {
      type: "competitor",
      keywords: [
        "already using someone",
        "already working with someone",
        "we already have a vendor",
        "we already use",
        "we already work with",
        "happy with our current provider",
        "happy with our current vendor",
        "already have a solution",
        "already doing that",
        "already have someone for that",
      ],
      signals: ["incumbent provider detected", "competitor / existing solution"],
      confidence: 0.92,
    },
    {
      type: "no_need",
      keywords: [
        "don't need it",
        "do not need it",
        "no need",
        "we're good",
        "we are good",
        "already solved",
        "not a priority",
        "doesn't apply to us",
        "not relevant",
        "not necessary",
      ],
      signals: ["no-need language detected", "problem importance denied"],
      confidence: 0.9,
    },
    {
      type: "brush_off",
      keywords: [
        "send me something",
        "send me info",
        "send me information",
        "email me",
        "just send an email",
        "not interested",
        "i'm not interested",
        "take me off your list",
        "stop calling",
        "leave me alone",
        "i'll get back to you",
        "just send details",
      ],
      signals: ["brush-off language detected", "engagement avoidance"],
      confidence: 0.87,
    },
  ];

  for (const matcher of matchers) {
    const matchedKeywords = matcher.keywords.filter((keyword) =>
      text.includes(keyword)
    );

    if (matchedKeywords.length > 0) {
      return {
        type: matcher.type,
        confidence: matcher.confidence,
        signals: [...matcher.signals, `matched: ${matchedKeywords.join(", ")}`],
      };
    }
  }

  if (input.metadata.hasQuestion) {
    return {
      type: "confusion",
      confidence: 0.68,
      signals: ["question detected", "fallback to confusion"],
    };
  }

  return {
    type: "hidden",
    confidence: 0.5,
    signals: ["no explicit objection pattern matched"],
  };
}

function chooseStrategy(classification: ClassificationResult): StrategyResult {
  switch (classification.type) {
    case "price":
      return {
        approach: "reframe",
        tone: "consultative",
        structure: [
          "acknowledge cost concern",
          "reframe around cost of inaction",
          "ask comparison question",
        ],
      };

    case "timing":
      return {
        approach: "validate_then_shift",
        tone: "friendly",
        structure: [
          "acknowledge timing concern",
          "lower pressure",
          "anchor to a realistic next step",
        ],
      };

    case "authority":
      return {
        approach: "question",
        tone: "consultative",
        structure: [
          "acknowledge role boundary",
          "clarify decision path",
          "identify who else must be involved",
        ],
      };

    case "trust":
      return {
        approach: "clarify",
        tone: "assertive",
        structure: [
          "acknowledge skepticism",
          "surface the real concern",
          "answer with specificity",
        ],
      };

    case "confusion":
      return {
        approach: "clarify",
        tone: "consultative",
        structure: [
          "acknowledge confusion",
          "simplify the explanation",
          "check which part is unclear",
        ],
      };

    case "competitor":
      return {
        approach: "challenge",
        tone: "consultative",
        structure: [
          "acknowledge incumbent solution",
          "test satisfaction level",
          "probe for gaps or tradeoffs",
        ],
      };

    case "no_need":
      return {
        approach: "reframe",
        tone: "consultative",
        structure: [
          "acknowledge current view",
          "question whether the problem is fully solved",
          "surface hidden cost or missed opportunity",
        ],
      };

    case "brush_off":
      return {
        approach: "challenge",
        tone: "friendly",
        structure: [
          "acknowledge resistance",
          "avoid generic follow-up",
          "ask one low-friction qualifying question",
        ],
      };

    case "hidden":
    default:
      return {
        approach: "clarify",
        tone: "consultative",
        structure: [
          "acknowledge resistance",
          "clarify intent",
          "move conversation forward",
        ],
      };
  }
}

function generateResponse(
  input: NormalizedInput,
  classification: ClassificationResult,
  _strategy: StrategyResult
): GeneratedResponse {
  const original = input.text;

  switch (classification.type) {
    case "price":
      return {
        reply:
          `That’s fair — price deserves scrutiny. ` +
          `But most people do not lose money on price alone; they lose money on the problem staying unresolved. ` +
          `What are you comparing this against right now, and what is that costing you today?`,
        followUps: [
          "What budget range were you expecting?",
          "Is the real concern the upfront number, or whether the value is there?",
        ],
      };

    case "timing":
      return {
        reply:
          `Understood — timing matters. ` +
          `I’m not trying to force this at the wrong moment. ` +
          `What would make this conversation more relevant: later this week, next month, or after a specific milestone?`,
        followUps: [
          "What timing would actually be realistic for you?",
          "Is the issue bandwidth, priority, or urgency?",
        ],
      };

    case "authority":
      return {
        reply:
          `That makes sense. ` +
          `If you’re not the final decision-maker, the fastest way to keep this productive is to understand how decisions like this actually get made on your side. ` +
          `Who besides you would need to weigh in?`,
        followUps: [
          "What does the approval process usually look like?",
          "Would it make sense to include the real decision-maker in the next conversation?",
        ],
      };

    case "trust":
      return {
        reply:
          `Fair enough — skepticism is reasonable. ` +
          `Usually the fastest way to clear that up is not to stay broad, but to get specific. ` +
          `What exactly feels uncertain, off, or risky to you right now?`,
        followUps: [
          "Is your concern credibility, results, or how the process works?",
          "What proof would you need to feel comfortable evaluating this seriously?",
        ],
      };

    case "confusion":
      return {
        reply:
          `No problem — let’s simplify it. ` +
          `At a basic level, this is meant to make objection handling more structured, more consistent, and easier to act on. ` +
          `Which part feels most unclear right now?`,
        followUps: [
          "Do you want the short version or the step-by-step version?",
          "Is the confusion about the offer, the process, or the end result?",
        ],
      };

    case "competitor":
      return {
        reply:
          `That’s useful to know. ` +
          `Staying with an existing provider can make sense if they’re genuinely delivering what you need. ` +
          `The real question is whether you’re satisfied, or just settled. ` +
          `What, if anything, do you wish your current solution handled better?`,
        followUps: [
          "What do you like most about your current provider?",
          "If you changed anything about your current setup, what would it be?",
        ],
      };

    case "no_need":
      return {
        reply:
          `That may be true — but usually when someone says they don’t need something, it means the problem feels small, already handled, or not urgent enough. ` +
          `Which of those is actually true in your case?`,
        followUps: [
          "Are you saying the problem doesn’t exist, or that it’s already solved well enough?",
          "What would have to change for this to become worth attention?",
        ],
      };

    case "brush_off":
      return {
        reply:
          `I can send information, but I don’t want to send something generic that gets ignored five minutes later. ` +
          `Before I do that, what is the one thing you would need to see to decide whether this is even worth your attention?`,
        followUps: [
          "What would make an email actually useful to you?",
          "Is this a real maybe, or just not a fit right now?",
        ],
      };

    case "hidden":
    default:
      return {
        reply:
          `I understand your concern. ` +
          `Let’s clarify what’s behind "${original}" so I can respond more precisely.`,
        followUps: ["Can you tell me what specifically is holding you back?"],
      };
  }
}

function evaluateResponse(
  generated: GeneratedResponse,
  strategy: StrategyResult
): EvaluationResult {
  let relevance = 76;
  let toneMatch = 76;
  let strategyAlignment = 76;

  if (generated.reply.length > 80) {
    relevance += 4;
  }

  if (
    strategy.tone === "consultative" ||
    strategy.tone === "friendly" ||
    strategy.tone === "assertive"
  ) {
    toneMatch += 4;
  }

  if (strategy.structure.length >= 3) {
    strategyAlignment += 4;
  }

  if (generated.followUps.length >= 2) {
    relevance += 2;
    strategyAlignment += 2;
  }

  const score = Math.min(
    100,
    Math.round((relevance + toneMatch + strategyAlignment) / 3)
  );

  return {
    score,
    criteria: {
      relevance,
      toneMatch,
      strategyAlignment,
    },
    needsRetry: score < 72,
  };
}

function includesAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}