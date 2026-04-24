import {
  DEFAULT_PRECALL_WHAT_THEY_REALLY_MEAN_INSIGHT,
  patternDescriptions,
  type RebuttalPattern,
} from "./patterns.js";

/**
 * Appended to the PRE-CALL system prompt (STANDARD contract) so each lane follows a distinct strategy.
 */
export function buildPrecallPatternDriverBlock(
  patterns: RebuttalPattern[],
  userInput: string
): string {
  const lane1Pattern = patterns[0] ?? "REFRAME_VALUE";
  const lane2Pattern = patterns[1] ?? "FUTURE_PAIN";

  const objection = userInput.replace(/\s+/g, " ").trim().slice(0, 2000);

  const identity = `PATTERN LANGUAGE IDENTITIES (STRICT)\n\nREFRAME_VALUE:\n- Compare headline price to business impact / outcome.\n- Avoid: \"if you keep waiting\", \"either/or\" framing.\n- Lens: value vs headline price.\n\nFUTURE_PAIN:\n- Allowed: compounding, worsening over time.\n- Must emphasize deterioration, not generic waiting pressure.\n\nOPPORTUNITY_COST:\n- Focus: missed revenue, missed timing, delayed growth, lost upside.\n- Avoid repeating \"same squeeze\" / generic cash-flow squeeze.\n\nCONTROL_CHOICE:\n- Ownership language allowed.\n- Avoid: \"you can either\".\n- Prefer: \"the decision is whether\", \"this comes down to whether\", \"control stays with you when\".\n\nMINIMIZE_RISK:\n- Focus: downside control, uncertainty reduction.\n- Do not sound soft/reassuring.\n- Prefer: \"the safer move is\", \"the real risk is\".\n\nSTATUS_QUO_ATTACK:\n- Attack the current condition directly.\n- Prefer: \"the problem is already here\", \"the status quo is what's costing you\".\n- Avoid future-tense genericity.\n\nSOFT BANS / REPETITION PENALTIES (do not use):\n- \"same pressure\", \"same squeeze\", \"you can either\", \"it keeps dragging\"\n- \"if you keep waiting\" more than once in the whole response\n- \"cash flow issues\" repeated verbatim across both lanes\n- \"bottom line\" overuse\n`;

  return `PATTERN INTELLIGENCE — LANES (MANDATORY FOR [LANE_1] AND [LANE_2])

You are generating HIGH-CONVERTING broker prep. Each lane must follow a DIFFERENT persuasion pattern — not two rewrites of the same pressure.

[${identity}]

[WHAT_THEY_REALLY_MEAN] — Use this exact diagnostic (minor punctuation only):
${DEFAULT_PRECALL_WHAT_THEY_REALLY_MEAN_INSIGHT}

Lane 1 — pattern: ${lane1Pattern}
Meaning: ${patternDescriptions[lane1Pattern]}

Lane 1 generation brief (merchant-facing script tone for [LANE_1] only):
You are generating a HIGH-CONVERTING sales rebuttal.

Pattern: ${lane1Pattern}
Meaning: ${patternDescriptions[lane1Pattern]}

Constraints:
- Direct, natural spoken language
- No generic phrases
- No repetition from Lane 2
- Must feel like a real closer said it live

Objection:
"${objection}"

Lane 2 — pattern: ${lane2Pattern}
Meaning: ${patternDescriptions[lane2Pattern]}

Lane 2 generation brief (merchant-facing script tone for [LANE_2] only):
You are generating a DIFFERENT strategic rebuttal.

Pattern: ${lane2Pattern}
Meaning: ${patternDescriptions[lane2Pattern]}

Constraints:
- Must use a DIFFERENT persuasion angle than Lane 1
- No structural similarity
- No reused phrasing
- Must feel distinct and intentional

Objection:
"${objection}"

Return the full STANDARD marker contract; [LANE_1] and [LANE_2] must clearly embody their respective patterns and stay materially different.`;
}
