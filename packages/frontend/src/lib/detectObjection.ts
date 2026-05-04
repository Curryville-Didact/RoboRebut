export type ObjectionMatch = {
  detected: true;
  category: string;
  label: string;
  emoji: string;
  originalText: string;
};

type Category = {
  category: string;
  label: string;
  emoji: string;
  phrases: string[];
};

const CATEGORIES: Category[] = [
  {
    category: "price",
    label: "Price",
    emoji: "💰",
    phrases: [
      "too expensive",
      "can't afford",
      "costs too much",
      "too much money",
      "payments too high",
      "daily payment",
      "weekly payment",
      "factor rate",
      "too high",
      "not worth it",
      "price is",
      "rate is",
      "fees are",
      "charge too",
      "paying too much",
      "can't do the payment",
      "that's a lot",
      "seems like a lot",
    ],
  },
  {
    category: "timing",
    label: "Timing",
    emoji: "⏰",
    phrases: [
      "not right now",
      "bad timing",
      "wrong time",
      "come back later",
      "call me back",
      "next month",
      "next quarter",
      "after the holidays",
      "wait and see",
      "need more time",
      "not ready",
      "too soon",
      "give me some time",
      "let me think",
      "think about it",
      "need to think",
    ],
  },
  {
    category: "competition",
    label: "Competition",
    emoji: "⚔️",
    phrases: [
      "already have",
      "working with someone",
      "another company",
      "different lender",
      "got a better offer",
      "someone else",
      "competitor",
      "using another",
      "have a broker",
      "talking to others",
      "shopping around",
      "other options",
    ],
  },
  {
    category: "risk",
    label: "Risk",
    emoji: "⚠️",
    phrases: [
      "too risky",
      "scared",
      "nervous about",
      "worried about",
      "what if",
      "can't guarantee",
      "not sure",
      "uncertain",
      "afraid",
      "concerned about",
      "what happens if",
      "daily withdrawals",
      "pulling from my account",
      "automatic payments",
    ],
  },
  {
    category: "authority",
    label: "Authority",
    emoji: "👤",
    phrases: [
      "need to ask",
      "talk to my partner",
      "ask my spouse",
      "check with",
      "run it by",
      "need approval",
      "board has to",
      "not my decision",
      "have to consult",
      "need sign off",
      "talk to my accountant",
      "ask my lawyer",
    ],
  },
  {
    category: "stalling",
    label: "Stalling",
    emoji: "🕐",
    phrases: [
      "send me something",
      "send info",
      "send it over",
      "email me",
      "just send",
      "let me review",
      "look it over",
      "read through it",
      "not on the phone",
      "in writing",
      "documentation first",
      "paperwork first",
    ],
  },
  {
    category: "relationship",
    label: "Relationship",
    emoji: "🤝",
    phrases: [
      "don't know you",
      "just met",
      "never heard of",
      "how do i know",
      "trust you",
      "legitimate",
      "is this real",
      "scam",
      "too good to be true",
      "verify",
      "check you out",
      "look you up",
    ],
  },
];

export function detectObjection(text: string): ObjectionMatch | null {
  const originalText = text ?? "";
  const hay = originalText.trim().toLowerCase();
  if (!hay) return null;

  for (const cat of CATEGORIES) {
    for (const phrase of cat.phrases) {
      if (hay.includes(phrase.toLowerCase())) {
        return {
          detected: true,
          category: cat.category,
          label: cat.label,
          emoji: cat.emoji,
          originalText,
        };
      }
    }
  }
  return null;
}

