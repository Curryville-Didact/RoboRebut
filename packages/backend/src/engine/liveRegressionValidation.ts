import assert from "node:assert/strict";
import { applyLiveResponseRefinement } from "./liveResponseRefinement.js";
import type { AssistantStructuredReply } from "../types/assistantStructuredReply.js";
import type { PatternContext, PersuasionPattern } from "./patternIntelligence.js";
import { nextPatternInSequence } from "./patternIntelligence.js";

type MatrixRow = {
  id: string;
  userMessage: string;
  longUserMessage: string;
  expectedObjectionType?: "TRUST" | "PRICE" | "CREDIT" | "TAX" | "GENERAL";
  expectedGeneralSubtype?: string | null;
};

type Scenario = {
  id: string;
  ctx: PatternContext;
  expectSequenceFrom?: PersuasionPattern;
  useLongInput?: boolean;
};

function mkSr(seed = "Seed"): AssistantStructuredReply {
  return {
    rebuttals: [
      {
        title: "Opening",
        sayThis: seed,
        support: null,
      },
    ],
  };
}

function hasForwardClause(t: string): boolean {
  return /\botherwise\b/i.test(t) || /\bso we can\b/i.test(t) || /\bbefore that\b/i.test(t);
}

type ScoreCard = {
  authority: number; // 1–5
  naturalness: number; // 1–5
  subtypeSpecificity: number; // 1–5
  pressureIntegrity: number; // 1–5
  semanticDuplication: number; // 1–5 (higher = less duplication)
  visibleTemplating: number; // 1–5 (higher = less templating)
  inputAlignment: number; // 1–5
  emotionalCalibration: number; // 1–5
  conversationalRealism: number; // 1–5
};

function clamp1to5(n: number): number {
  return Math.max(1, Math.min(5, n));
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3);
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const uni = A.size + B.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

type InputConcerns = {
  hasPrice: boolean;
  hasTrust: boolean;
  hasCredit: boolean;
  hasTax: boolean;
  hasTimeDelay: boolean;
  hasLowEngagement: boolean;
  hasHesitation: boolean;
  hasEmotionSkeptic: boolean;
  hasContradiction: boolean;
  concernCount: number;
};

function detectInputConcerns(input: string): InputConcerns {
  const t = input.toLowerCase();
  const hasPrice =
    /\b(expensive|rate|factor|too high|costs? too much|price)\b/.test(t);
  const hasTrust =
    /\b(trust|predatory|trap|scam|sounds like|feels like)\b/.test(t);
  const hasCredit = /\b(credit|hard pull|inquiry)\b/.test(t);
  const hasTax = /\b(tax|deductible|accountant)\b/.test(t);
  const hasTimeDelay =
    /\b(wait|later|not now|not right now|think about it)\b/.test(t);

  const hasLowEngagement = /^(maybe|we['’]ll see|idk|i don['’]t know)\b/.test(
    t.trim()
  );
  const hasHesitation = /\b(i don['’]t know|i mean|maybe|we['’]ll see|not sure)\b/.test(
    t
  );
  const hasEmotionSkeptic = /\b(feels like|sounds like|not sure i trust|worried|anxious|skeptical)\b/.test(
    t
  );
  const hasContradiction =
    (/\b(interested|open to it|want to)\b/.test(t) &&
      /\b(but|however|not sure|don['’]t want|can['’]t)\b/.test(t)) ||
    (/\byes\b/.test(t) && /\bno\b/.test(t));

  const concernCount = [hasPrice, hasTrust, hasCredit, hasTax, hasTimeDelay].filter(Boolean)
    .length;

  return {
    hasPrice,
    hasTrust,
    hasCredit,
    hasTax,
    hasTimeDelay,
    hasLowEngagement,
    hasHesitation,
    hasEmotionSkeptic,
    hasContradiction,
    concernCount,
  };
}

function outputMentionsConcern(sayThis: string, concern: keyof Pick<InputConcerns, "hasPrice" | "hasTrust" | "hasCredit" | "hasTax" | "hasTimeDelay">): boolean {
  const t = sayThis.toLowerCase();
  switch (concern) {
    case "hasPrice":
      return /\b(number|price|cost|rate|headline)\b/.test(t);
    case "hasTrust":
      return /\b(trust|predatory|trap|risk|protect)\b/.test(t);
    case "hasCredit":
      return /\b(credit|inquiry|hard pull)\b/.test(t);
    case "hasTax":
      return /\b(tax|accountant|deductible)\b/.test(t);
    case "hasTimeDelay":
      return /\b(wait|later|delay|pause)\b/.test(t);
    default: {
      const _exhaustive: never = concern;
      return _exhaustive;
    }
  }
}

function scoreOutput(args: {
  sayThis: string;
  input: string;
  expectedObjectionType: MatrixRow["expectedObjectionType"];
  expectedGeneralSubtype?: string | null;
  debug: any;
}): ScoreCard {
  const t = args.sayThis.trim();
  const dbg = args.debug ?? {};
  const concerns = detectInputConcerns(args.input);

  // Authority: directives + decisiveness, penalize hedging.
  let authority = 3;
  if (/\bhere'?s what we do next\b/i.test(t) || /\bwe need\b/i.test(t) || /\bthe decision is whether\b/i.test(t))
    authority++;
  if (/\bmaybe\b|\bkind of\b|\bsort of\b|\bi guess\b/i.test(t)) authority--;

  // Naturalness: penalize repeated openers, stacked em dashes, awkward merges.
  let naturalness = 4;
  const dashCount = (t.match(/—/g)?.length ?? 0);
  if (dashCount >= 4) naturalness--;
  if (/\botherwise\b/i.test(t) && (t.match(/\botherwise\b/gi)?.length ?? 0) >= 2) naturalness--;
  if (/\.\s*\./.test(t) || /[!?]{2,}/.test(t)) naturalness--;

  // Subtype specificity: require subtype marker for GENERAL subtypes.
  let subtypeSpecificity = args.expectedObjectionType === "GENERAL" ? 3 : 4;
  if (args.expectedObjectionType === "GENERAL") {
    if (dbg.openerApplied) subtypeSpecificity++;
    if (args.expectedGeneralSubtype && typeof dbg.liveGeneralSubtype === "string") subtypeSpecificity++;
  }

  // Pressure integrity: must include at least one forward-driving clause.
  let pressureIntegrity = hasForwardClause(t) ? 5 : 2;
  if ((t.match(/\botherwise\b/gi)?.length ?? 0) >= 2) pressureIntegrity--;

  // Semantic duplication: compare opener sentence with next sentence (if available).
  let semanticDuplication = 5;
  const sents = t.split(/[.?!]/).map((x) => x.trim()).filter(Boolean);
  if (sents.length >= 2) {
    const sim = jaccard(tokenize(sents[0]!), tokenize(sents[1]!));
    if (sim > 0.35) semanticDuplication -= 2;
    else if (sim > 0.22) semanticDuplication -= 1;
  }

  // Visible templating: brackets/tokens, repeated formulaic phrases.
  let visibleTemplating = 5;
  if (/[\[\]{}<>]/.test(t)) visibleTemplating = 1;
  if (/\bwhat matters is\b/i.test(t) && /\bthe decision is whether\b/i.test(t)) visibleTemplating--;

  // Input alignment: reward covering multiple concerns when present.
  let inputAlignment = 3;
  const mentionCount = [
    concerns.hasPrice && outputMentionsConcern(t, "hasPrice"),
    concerns.hasTrust && outputMentionsConcern(t, "hasTrust"),
    concerns.hasCredit && outputMentionsConcern(t, "hasCredit"),
    concerns.hasTax && outputMentionsConcern(t, "hasTax"),
    concerns.hasTimeDelay && outputMentionsConcern(t, "hasTimeDelay"),
  ].filter(Boolean).length;
  if (concerns.concernCount <= 1) {
    inputAlignment = mentionCount >= 1 ? 5 : 3;
  } else {
    // Multi-objection: expect at least 2 concerns acknowledged.
    inputAlignment = mentionCount >= 2 ? 5 : mentionCount === 1 ? 3 : 2;
  }

  // Emotional calibration: reward acknowledgment when emotional/skeptical input is present.
  let emotionalCalibration = 4;
  const hasAck =
    /\b(i get|fair to|makes sense|not irrational|i hear you)\b/i.test(t);
  if (concerns.hasEmotionSkeptic || concerns.hasHesitation) {
    emotionalCalibration = hasAck ? 5 : 3;
  } else {
    emotionalCalibration = hasAck ? 4 : 4;
  }

  // Conversational realism: penalize overly scripted stacked frames.
  let conversationalRealism = 4;
  const frameCount =
    (t.match(/\bwhat matters is\b/gi)?.length ?? 0) +
    (t.match(/\bthe decision is whether\b/gi)?.length ?? 0);
  if (frameCount >= 2) conversationalRealism--;
  if ((t.match(/\bhere's what we do next\b/gi)?.length ?? 0) >= 2) conversationalRealism--;
  if (t.length > 420) conversationalRealism--;

  return {
    authority: clamp1to5(authority),
    naturalness: clamp1to5(naturalness),
    subtypeSpecificity: clamp1to5(subtypeSpecificity),
    pressureIntegrity: clamp1to5(pressureIntegrity),
    semanticDuplication: clamp1to5(semanticDuplication),
    visibleTemplating: clamp1to5(visibleTemplating),
    inputAlignment: clamp1to5(inputAlignment),
    emotionalCalibration: clamp1to5(emotionalCalibration),
    conversationalRealism: clamp1to5(conversationalRealism),
  };
}

function auditText(id: string, text: string): string[] {
  const issues: string[] = [];
  const t = text.trim();
  if (!t) issues.push("empty_output");
  if (!/[.!?]$/.test(t)) issues.push("missing_terminal_punct");
  if (/\bhere's what we do next\b/i.test(t) && /\bhere's what we do next\b/i.test(t.slice(t.toLowerCase().indexOf("here's what we do next") + 1))) {
    issues.push("repeated_control_lead");
  }
  const otherwiseCount = (t.match(/\botherwise\b/gi)?.length ?? 0);
  if (otherwiseCount >= 2) issues.push("otherwise_overuse");
  if (t.includes("— otherwise.") || t.includes("— so we can.") || t.includes("— before that.")) {
    issues.push("bare_clause_merge_artifact");
  }
  if (/\bit's not\b/i.test(t) && /\bit's not\b/i.test(t.replace(/\bit's not\b/i, ""))) {
    issues.push("repeated_reframe_lead");
  }
  // Visible templating: bracket tokens etc.
  if (/[\[\]{}<>]/.test(t)) issues.push("visible_templating_token");
  // Compression artifact: repeated periods or double punctuation.
  if (/\.\s*\./.test(t) || /[!?]{2,}/.test(t)) issues.push("punctuation_artifact");
  if (issues.length) return issues.map((x) => `${id}:${x}`);
  return [];
}

const MATRIX: MatrixRow[] = [
  {
    id: "PRICE.default",
    userMessage: "This is too expensive. The rate is too high.",
    longUserMessage:
      "This is too expensive. The rate is too high. I'm trying to be responsible here. I need to understand why the structure makes sense and what changes if we move now versus later. Also, I'm comparing this to what my bank quoted last year and I'm not sure how to think about it.",
    expectedObjectionType: "PRICE",
  },
  {
    id: "TRUST.predatory",
    userMessage: "This feels predatory. Can I trust this?",
    longUserMessage:
      "This feels predatory. Can I trust this? I've heard horror stories about getting trapped and the terms not matching what was said on the call. I'm not accusing you personally, I just want to know what protects me when things get tight.",
    expectedObjectionType: "TRUST",
  },
  {
    id: "CREDIT.inquiry",
    userMessage: "Will this hurt my credit? Is it a hard pull inquiry?",
    longUserMessage:
      "Will this hurt my credit? Is it a hard pull inquiry? I don't want a bunch of inquiries stacking up. If I explore options and decide not to move forward, I need to know what hits my credit and when.",
    expectedObjectionType: "CREDIT",
  },
  {
    id: "TAX.deductible",
    userMessage: "Is this tax deductible? My accountant will ask.",
    longUserMessage:
      "Is this tax deductible? My accountant will ask. I'm not trying to play games; I just need to know how this gets treated and what matters most so I can make a clean decision without surprises later.",
    expectedObjectionType: "TAX",
  },
  // GENERAL subtypes
  {
    id: "GENERAL.CONTROL_ACCESS",
    userMessage: "I don't like giving you access to my bank account via Plaid.",
    longUserMessage:
      "I don't like giving you access to my bank account via Plaid. I'm not comfortable with anyone logging in or seeing everything. If this requires access, I want to understand exactly what you can see, what you can't, and how it's controlled before I even consider moving forward.",
    expectedObjectionType: "GENERAL",
    expectedGeneralSubtype: "CONTROL_ACCESS",
  },
  {
    id: "GENERAL.COMMITMENT_LOCKIN",
    userMessage: "I don't want to get locked in or stuck if revenue shifts.",
    longUserMessage:
      "I don't want to get locked in or stuck if revenue shifts. My revenue is seasonal and I need flexibility. If there's no real off-ramp or adjustment path, I won't touch it even if the headline looks good.",
    expectedObjectionType: "GENERAL",
    expectedGeneralSubtype: "COMMITMENT_LOCKIN",
  },
  {
    id: "GENERAL.TERMS_EXIT",
    userMessage: "What happens if I pay it off early? What's the prepayment exit fee?",
    longUserMessage:
      "What happens if I pay it off early? What's the prepayment exit fee? I'm not signing anything where I can't clearly see the payoff path or what it costs to restructure if things change. I need the exit mechanics in plain English.",
    expectedObjectionType: "GENERAL",
    expectedGeneralSubtype: "TERMS_EXIT",
  },
  {
    id: "GENERAL.FUTURE_EXPANSION",
    userMessage: "We're planning to expand and hire. I don't want this to cap growth.",
    longUserMessage:
      "We're planning to expand and hire. I don't want this to cap growth. If this makes it harder to hire, buy inventory, or push marketing when momentum is there, then it's the wrong tool. I need terms that ride with the plan, not fight it.",
    expectedObjectionType: "GENERAL",
    expectedGeneralSubtype: "FUTURE_EXPANSION",
  },
  {
    id: "GENERAL.PRESSURE_BURDEN",
    userMessage: "This adds pressure. I can't take on more burden week to week.",
    longUserMessage:
      "This adds pressure. I can't take on more burden week to week. My week is already tight with payroll and vendors. If the cadence stacks stress instead of relieving it, I'd rather not do anything.",
    expectedObjectionType: "GENERAL",
    expectedGeneralSubtype: "PRESSURE_BURDEN",
  },
  {
    id: "GENERAL.BROKER_TRUST_INTENT",
    userMessage: "You're just trying to sell me something for commission.",
    longUserMessage:
      "You're just trying to sell me something for commission. I don't want hype. I want the straight mechanics: what it costs, what happens when revenue dips, and what the real levers are. If it only works when everything goes perfect, I'm out.",
    expectedObjectionType: "GENERAL",
    expectedGeneralSubtype: "BROKER_TRUST_INTENT",
  },
  {
    id: "GENERAL.TIME_DELAY",
    userMessage: "I want to wait a bit and think about it later.",
    longUserMessage:
      "I want to wait a bit and think about it later. I'm not saying no, I just don't want to rush. But if waiting doesn't actually improve the structure or the terms, then I'm just delaying a decision. Tell me what would need to change for waiting to make sense.",
    expectedObjectionType: "GENERAL",
    expectedGeneralSubtype: "TIME_DELAY",
  },
  {
    id: "GENERAL.STRUCTURE_STRATEGY",
    userMessage: "This feels like a short-term fix that doesn't solve the underlying issue.",
    longUserMessage:
      "This feels like a short-term fix that doesn't solve the underlying issue. I'm not interested in kicking the can and paying for it twice. If this doesn't materially change the outcome, I'd rather redesign the plan than sign a patch.",
    expectedObjectionType: "GENERAL",
    expectedGeneralSubtype: "STRUCTURE_STRATEGY",
  },
  {
    id: "GENERAL.STATUS_QUO",
    userMessage: "We're stable and doing fine. I don't think we need this.",
    longUserMessage:
      "We're stable and doing fine. I don't think we need this. I'm open to it if it clearly makes us stronger, but I'm not adding complexity for marginal upside. Convince me the structure improves runway or flexibility in a measurable way.",
    expectedObjectionType: "GENERAL",
    expectedGeneralSubtype: "STATUS_QUO",
  },
  {
    id: "GENERAL.PAYMENT_CADENCE",
    userMessage: "Daily withdrawals hit my account too frequently. The cadence worries me.",
    longUserMessage:
      "Daily withdrawals hit my account too frequently. The cadence worries me. Deposits don't line up daily, and I don't want to constantly manage timing. If the schedule can't match the way cash comes in, it's a no. This is about cadence and withdrawals.",
    expectedObjectionType: "GENERAL",
    expectedGeneralSubtype: "PAYMENT_CADENCE",
  },
  {
    id: "GENERAL.THINK_ABOUT_IT",
    userMessage: "I need to think about it. I want to sleep on it.",
    longUserMessage:
      "I need to think about it. I want to sleep on it. I'm not trying to dodge you; I just need clarity on the downside and what the decision really hinges on. If you can tell me what has to be true for this to be a yes, I can make a clean call.",
    expectedObjectionType: "GENERAL",
    expectedGeneralSubtype: "THINK_ABOUT_IT",
  },
  {
    id: "GENERAL.SEND_ME_SOMETHING",
    userMessage: "Send me something in writing. Email me the paperwork.",
    longUserMessage:
      "Send me something in writing. Email me the paperwork. But don't just send a pile— I need the one page that answers the sticking point: what happens if revenue dips and what flexibility I actually have. If it's fuzzy, put it in writing first.",
    expectedObjectionType: "GENERAL",
    expectedGeneralSubtype: "SEND_ME_SOMETHING",
  },
  {
    id: "GENERAL.TALK_TO_PARTNER",
    userMessage: "I need to talk to my partner about this first.",
    longUserMessage:
      "I need to talk to my partner about this first. We need to agree on the standard: what downside we accept, what upside we require, and what would be a dealbreaker. If you can give me plain language I can repeat, that will help.",
    expectedObjectionType: "GENERAL",
    expectedGeneralSubtype: "TALK_TO_PARTNER",
  },
  {
    id: "GENERAL.NO_BRUSH",
    userMessage: "No. Not interested. Pass.",
    longUserMessage:
      "No. Not interested. Pass. I'm not trying to be difficult—this just feels like the wrong shape. If there's a completely different structure that would actually fit, say what lever changes it; otherwise I'm done.",
    expectedObjectionType: "GENERAL",
    expectedGeneralSubtype: "NO_BRUSH",
  },

  // --- Adversarial input classes (no expectation on routing/subtype; we flag oversimplification/tone/scriptedness) ---
  {
    id: "ADV.messy_multi_objection.price+trust+hesitation",
    userMessage:
      "I mean it's kind of expensive and I don't know, it feels like a trap.",
    longUserMessage:
      "I mean it's kind of expensive and I don't know, it feels like a trap — and also I'm not sure I want a hard pull on my credit for something that might not even fit. I'm interested, but this all sounds like it could go sideways.",
  },
  {
    id: "ADV.emotional_skeptic.trust_tone",
    userMessage: "This sounds like a trap. I'm not sure I trust it.",
    longUserMessage:
      "This sounds like a trap. I'm not sure I trust it. I've heard too many stories, and I don't want to be the next one. If this is legitimate, explain what protects me and what the real levers are.",
  },
  {
    id: "ADV.contradictory.interest+resistance",
    userMessage: "I'm interested, but I don't want to get locked in and I'm not sure about the rate.",
    longUserMessage:
      "I'm interested, but I don't want to get locked in and I'm not sure about the rate. I want flexibility if revenue shifts, and I also don't want to overpay for something that doesn't materially improve my position.",
  },
  {
    id: "ADV.low_engagement.maybe",
    userMessage: "maybe",
    longUserMessage:
      "maybe — I don't know, we'll see. I'm just not sure about any of this right now.",
  },
];

const SCENARIOS: Scenario[] = [
  { id: "no_prior", ctx: { lastPatternUsed: null } },
  { id: "lastPatternUsed_REFRAME", ctx: { lastPatternUsed: "REFRAME" } },
  { id: "lastPatternUsed_CONDITION", ctx: { lastPatternUsed: "CONDITION" }, expectSequenceFrom: "CONDITION" },
  { id: "long_input_stress", ctx: { lastPatternUsed: null }, useLongInput: true },
];

export async function runLiveRegressionValidation(): Promise<void> {
  const defectsByBucket: Record<string, string[]> = {
    "pattern collision drift": [],
    "opener/variant semantic duplication": [],
    "sequence visibility": [],
    "sentence compression artifacts": [],
    "subtype convergence": [],
    "visible templating": [],
  };

  for (const row of MATRIX) {
    for (const s of SCENARIOS) {
      const sr = mkSr("Seed.");
      let debug: any = null;
      const out = applyLiveResponseRefinement(
        sr,
        s.useLongInput ? row.longUserMessage : row.userMessage,
        s.ctx,
        (m) => {
          debug = m;
        }
      );
      const sayThis = out.rebuttals?.[0]?.sayThis?.trim() ?? "";

      // Basic invariants
      assert.equal(typeof sayThis, "string");
      assert.ok(sayThis.length > 0, `${row.id}/${s.id}: empty sayThis`);
      const auditIssues = auditText(`${row.id}/${s.id}`, sayThis);
      for (const issue of auditIssues) {
        if (issue.endsWith(":punctuation_artifact") || issue.endsWith(":missing_terminal_punct")) {
          defectsByBucket["sentence compression artifacts"].push(issue);
        } else if (issue.endsWith(":visible_templating_token")) {
          defectsByBucket["visible templating"].push(issue);
        } else if (issue.endsWith(":otherwise_overuse") || issue.endsWith(":bare_clause_merge_artifact")) {
          defectsByBucket["sentence compression artifacts"].push(issue);
        } else if (issue.endsWith(":missing_forward_clause") || issue.endsWith(":repeated_control_lead")) {
          defectsByBucket["pattern collision drift"].push(issue);
        } else if (issue.endsWith(":repeated_reframe_lead")) {
          defectsByBucket["opener/variant semantic duplication"].push(issue);
        } else {
          defectsByBucket["pattern collision drift"].push(issue);
        }
      }

      // Debug payload must be present for all non-empty inputs.
      assert.ok(debug, `${row.id}/${s.id}: missing debug meta`);
      if (row.expectedObjectionType) {
        assert.equal(
          debug.objectionType,
          row.expectedObjectionType,
          `${row.id}/${s.id}: objectionType mismatch`
        );
      }

      if (row.expectedObjectionType === "GENERAL" && row.expectedGeneralSubtype) {
        assert.equal(
          debug.liveGeneralSubtype,
          row.expectedGeneralSubtype,
          `${row.id}/${s.id}: general subtype mismatch`
        );
        assert.equal(debug.openerApplied, true, `${row.id}/${s.id}: opener not applied`);
      }

      assert.equal(
        debug.enforceDecisionPressureApplied != null,
        true,
        `${row.id}/${s.id}: missing pressure flag`
      );
      assert.equal(
        debug.enforcePatternToneApplied != null,
        true,
        `${row.id}/${s.id}: missing tone flag`
      );
      // Fingerprint v2: forward-pressure language may be removed by fingerprint/closer normalization.

      // Sequencing expectation: only assert for GENERAL subtype rows (where 4-pattern pools exist).
      if (row.expectedObjectionType === "GENERAL" && row.expectedGeneralSubtype && s.expectSequenceFrom) {
        const expectedNext = nextPatternInSequence(s.expectSequenceFrom);
        if (debug.selectedPattern !== expectedNext) {
          defectsByBucket["sequence visibility"].push(
            `${row.id}/${s.id}: expected sequence ${s.expectSequenceFrom}→${expectedNext} but got ${debug.selectedPattern}`
          );
        }
      }

      const score = scoreOutput({
        sayThis,
        input: s.useLongInput ? row.longUserMessage : row.userMessage,
        expectedObjectionType: row.expectedObjectionType,
        expectedGeneralSubtype: row.expectedGeneralSubtype,
        debug,
      });

      // Detect opener/variant duplication via similarity of first two sentences
      const sents = sayThis.split(/[.?!]/).map((x) => x.trim()).filter(Boolean);
      if (row.expectedObjectionType === "GENERAL" && row.expectedGeneralSubtype && sents.length >= 2) {
        const sim = jaccard(tokenize(sents[0]!), tokenize(sents[1]!));
        if (sim > 0.35) {
          defectsByBucket["opener/variant semantic duplication"].push(
            `${row.id}/${s.id}: opener/next sentence similarity ${sim.toFixed(2)}`
          );
        }
      }

      // Subtype convergence heuristic: GENERAL subtype output missing subtype markers
      if (row.expectedObjectionType === "GENERAL" && row.expectedGeneralSubtype) {
        if (!debug.openerApplied) {
          defectsByBucket["subtype convergence"].push(`${row.id}/${s.id}: opener not applied`);
        }
      }

      // Adversarial defect flags: oversimplification + tone mismatch + scriptedness.
      const concerns = detectInputConcerns(s.useLongInput ? row.longUserMessage : row.userMessage);
      if (!row.expectedObjectionType && concerns.concernCount >= 2) {
        // If input contains multiple concerns, flag when output only mentions <=1 concern markers.
        const mentionCount = [
          concerns.hasPrice && outputMentionsConcern(sayThis, "hasPrice"),
          concerns.hasTrust && outputMentionsConcern(sayThis, "hasTrust"),
          concerns.hasCredit && outputMentionsConcern(sayThis, "hasCredit"),
          concerns.hasTax && outputMentionsConcern(sayThis, "hasTax"),
          concerns.hasTimeDelay && outputMentionsConcern(sayThis, "hasTimeDelay"),
        ].filter(Boolean).length;
        if (mentionCount <= 1) {
          defectsByBucket["pattern collision drift"].push(
            `${row.id}/${s.id}: multi-objection oversimplification (mentions ${mentionCount}/${concerns.concernCount})`
          );
        }
      }
      if (!row.expectedObjectionType && concerns.hasEmotionSkeptic) {
        const hasAck =
          /\b(i get|fair to|makes sense|not irrational|i hear you)\b/i.test(sayThis);
        if (!hasAck) {
          defectsByBucket["pattern collision drift"].push(
            `${row.id}/${s.id}: tone mismatch (skeptical input, no acknowledgment)`
          );
        }
      }
      if (!row.expectedObjectionType && score.conversationalRealism <= 2) {
        defectsByBucket["sentence compression artifacts"].push(
          `${row.id}/${s.id}: scriptedness risk (conversationalRealism=${score.conversationalRealism})`
        );
      }

      // Print debug row (JSON) for manual inspection/audit.
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            id: `${row.id}/${s.id}`,
            userMessage: s.useLongInput ? row.longUserMessage : row.userMessage,
            objectionType: debug.objectionType ?? null,
            liveGeneralSubtype: debug.liveGeneralSubtype ?? null,
            selectedPrimaryPattern: debug.selectedPattern ?? null,
            openerApplied: debug.openerApplied ?? null,
            enforcePatternToneApplied: debug.enforcePatternToneApplied ?? null,
            enforceDecisionPressureApplied: debug.enforceDecisionPressureApplied ?? null,
            finalSayThis: debug.finalSayThis ?? sayThis,
            scores: score,
          },
          null,
          2
        )
      );
    }
  }

  const bucketsWithIssues = Object.entries(defectsByBucket).filter(([, v]) => v.length > 0);
  if (bucketsWithIssues.length) {
    const lines: string[] = [];
    for (const [bucket, issues] of bucketsWithIssues) {
      const uniq = [...new Set(issues)];
      lines.push(`${bucket}:`);
      for (const u of uniq) lines.push(`- ${u}`);
    }
    throw new Error(`LIVE audit defects:\\n${lines.join("\\n")}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLiveRegressionValidation().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}

