/**
 * Build `AssistantStructuredReply` from coach pipeline outputs + final text.
 * Uses the same section/rebuttal heuristics as the legacy frontend parsers (normalization, not LLM).
 */

import type { PatternInsightsPayload } from "./patternInsight.js";
import type {
  AssistantStructuredReply,
  StructuredPatternIntel,
  StructuredRebuttal,
} from "../types/assistantStructuredReply.js";

/** Header-only line: "Rebuttal:" or "**Coach note**" — aligned with frontend parseAssistantCoachSections. */
const SECTION_HEADER_LINE =
  /^\s*(?:\*\*)?\s*(Rebuttal(?:\s*\d+)?|Coach\s*note|Follow[-\s]?up)\s*(?:\*\*)?\s*[:\-]?\s*$/i;

const SECTION_HEADER_INLINE =
  /^\s*(?:\*\*)?\s*(Rebuttal(?:\s*\d+)?|Coach\s*note|Follow[-\s]?up)\s*(?:\*\*)?\s*[:\-]\s*(.*)$/i;

function headerToKind(
  label: string
): "rebuttal" | "coachNote" | "followUp" | null {
  const n = label.trim().toLowerCase();
  if (n.startsWith("rebuttal")) return "rebuttal";
  if (n.replace(/\s+/g, "").includes("coachnote")) return "coachNote";
  if (n.replace(/\s+/g, "").includes("follow")) return "followUp";
  return null;
}

type ParsedCoachSections =
  | { mode: "blob"; text: string }
  | {
      mode: "sections";
      preamble?: string;
      rebuttal?: string;
      coachNote?: string;
      followUp?: string;
    };

function parseCoachSections(raw: string): ParsedCoachSections {
  const trimmed = raw.trim();
  if (!trimmed) return { mode: "blob", text: "" };

  const lines = trimmed.split(/\r?\n/);
  type Bucket = "preamble" | "rebuttal" | "coachNote" | "followUp";
  let current: Bucket = "preamble";
  const preamble: string[] = [];
  const rebuttal: string[] = [];
  const coachNote: string[] = [];
  const followUp: string[] = [];

  const push = (bucket: Bucket, line: string) => {
    switch (bucket) {
      case "preamble":
        preamble.push(line);
        break;
      case "rebuttal":
        rebuttal.push(line);
        break;
      case "coachNote":
        coachNote.push(line);
        break;
      case "followUp":
        followUp.push(line);
        break;
      default: {
        const _x: never = bucket;
        return _x;
      }
    }
  };

  for (const line of lines) {
    const inline = line.match(SECTION_HEADER_INLINE);
    if (inline) {
      const kind = headerToKind(inline[1] ?? "");
      if (kind) {
        current = kind;
        const rest = (inline[2] ?? "").trim();
        if (rest) push(kind, rest);
        continue;
      }
    }

    const headerOnly = line.match(SECTION_HEADER_LINE);
    if (headerOnly) {
      const kind = headerToKind(headerOnly[1] ?? "");
      if (kind) {
        current = kind;
        continue;
      }
    }

    push(current, line);
  }

  const r = rebuttal.join("\n").trim();
  const c = coachNote.join("\n").trim();
  const f = followUp.join("\n").trim();
  const p = preamble.join("\n").trim();

  if (!r && !c && !f) {
    return { mode: "blob", text: trimmed };
  }

  return {
    mode: "sections",
    ...(p ? { preamble: p } : {}),
    ...(r ? { rebuttal: r } : {}),
    ...(c ? { coachNote: c } : {}),
    ...(f ? { followUp: f } : {}),
  };
}

type RebuttalVisualBlock =
  | { type: "pair"; label: string; body: string }
  | { type: "plain"; text: string };

function isRebuttalBlockStartLine(line: string): boolean {
  const t = line.trim();
  if (!t.includes("Rebuttal")) return false;
  return /^\s*(?:\*\*)?\s*Rebuttal/i.test(t);
}

function splitInlineRebuttalHeaderAndBody(
  line: string
): { label: string; body: string } | null {
  if (!line.includes("Rebuttal")) return null;

  const dq = line.indexOf('"');
  if (dq !== -1) {
    const after = line.slice(dq + 1);
    const endq = after.indexOf('"');
    if (endq !== -1) {
      return {
        label: line.slice(0, dq + endq + 2).trim(),
        body: after.slice(endq + 1).trim(),
      };
    }
    return { label: line.slice(0, dq).trim(), body: line.slice(dq + 1).trim() };
  }

  const gt = line.indexOf(">");
  if (gt !== -1) {
    return {
      label: line.slice(0, gt).trim(),
      body: line.slice(gt + 1).trim(),
    };
  }

  const wide = line.search(/\s{3,}/);
  if (wide !== -1 && wide > 0) {
    return {
      label: line.slice(0, wide).trim(),
      body: line.slice(wide).trim(),
    };
  }

  return null;
}

function parseRebuttalVisualBlocks(raw: string): RebuttalVisualBlock[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (!trimmed.includes("\n")) {
    const inline = splitInlineRebuttalHeaderAndBody(trimmed);
    if (inline) {
      return [{ type: "pair", label: inline.label, body: inline.body }];
    }
    if (isRebuttalBlockStartLine(trimmed)) {
      return [{ type: "pair", label: trimmed, body: "" }];
    }
    return [{ type: "plain", text: trimmed }];
  }

  const lines = trimmed.split(/\r?\n/);
  const blocks: RebuttalVisualBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!isRebuttalBlockStartLine(lines[i])) {
      const start = i;
      while (i < lines.length && !isRebuttalBlockStartLine(lines[i])) {
        i++;
      }
      const text = lines.slice(start, i).join("\n").trim();
      if (text) blocks.push({ type: "plain", text });
      continue;
    }

    const headerLine = lines[i];
    i += 1;

    const inline = splitInlineRebuttalHeaderAndBody(headerLine);
    if (inline && inline.body.length > 0) {
      blocks.push({ type: "pair", label: inline.label, body: inline.body });
      continue;
    }

    const label = inline ? inline.label : headerLine.trim();
    const bodyLines: string[] = [];
    while (i < lines.length && !isRebuttalBlockStartLine(lines[i])) {
      bodyLines.push(lines[i]);
      i++;
    }
    const body = bodyLines.join("\n").trim();
    blocks.push({ type: "pair", label, body });
  }

  return blocks;
}

function bodyToSayAndSupport(body: string): {
  sayThis: string;
  support: string | null;
} {
  const t = body.trim();
  if (!t) return { sayThis: "", support: null };
  const lines = t.split(/\r?\n/);
  while (lines.length > 0 && !lines[0].trim()) lines.shift();
  if (lines.length === 0) return { sayThis: "", support: null };
  if (lines.length === 1) {
    return { sayThis: lines[0].trimEnd(), support: null };
  }
  const sayThis = lines[0].trimEnd();
  const support = lines.slice(1).join("\n").trimEnd();
  return { sayThis, support: support.length > 0 ? support : null };
}

function confidenceStatusLabel(level: "high" | "medium" | "low"): string {
  switch (level) {
    case "high":
      return "Strong signal";
    case "medium":
      return "Refining";
    case "low":
      return "Learning";
    default:
      return "Learning";
  }
}

function blocksToRebuttals(blocks: RebuttalVisualBlock[]): StructuredRebuttal[] {
  const out: StructuredRebuttal[] = [];
  for (const b of blocks) {
    if (b.type === "plain") {
      const { sayThis, support } = bodyToSayAndSupport(b.text);
      out.push({
        title: "Opening",
        sayThis,
        support,
      });
      continue;
    }
    const { sayThis, support } = bodyToSayAndSupport(b.body);
    out.push({
      title: b.label.trim() || "Rebuttal",
      sayThis,
      support,
    });
  }
  return out;
}

function buildPatternIntel(input: {
  patternInsights?: PatternInsightsPayload | null;
  explanation?: string | null;
  coachInsightLine?: string | null;
}): StructuredPatternIntel | null {
  const pi = input.patternInsights;
  const exp = input.explanation?.trim() ?? null;
  const coach = input.coachInsightLine?.trim() ?? null;
  const why = pi?.reason?.trim() ?? null;

  if (!pi && !exp && !coach) return null;

  return {
    status: pi != null ? confidenceStatusLabel(pi.confidenceLevel) : null,
    whyThisResponse: why,
    howItFits: exp,
    coachInsight: coach,
  };
}

/**
 * Produce a JSON-safe structured reply for persistence. Never throws — returns minimal safe object on empty text.
 */
export function buildAssistantStructuredReply(input: {
  text: string;
  objectionType?: string | null;
  toneUsed?: string | null;
  patternInsights?: PatternInsightsPayload | null;
  explanation?: string | null;
  coachInsightLine?: string | null;
}): AssistantStructuredReply {
  const text = input.text?.trim() ?? "";
  const base: AssistantStructuredReply = {
    objectionType: input.objectionType?.trim() ?? null,
    toneUsed: input.toneUsed?.trim() ?? null,
    patternIntel: buildPatternIntel({
      patternInsights: input.patternInsights ?? null,
      explanation: input.explanation ?? null,
      coachInsightLine: input.coachInsightLine ?? null,
    }),
    coachNote: null,
    followUp: null,
    rebuttals: [],
  };

  if (!text) {
    return sanitizeAssistantStructuredReply(base);
  }

  const sections = parseCoachSections(text);
  if (sections.mode === "blob") {
    const blocks = parseRebuttalVisualBlocks(sections.text);
    base.rebuttals = blocksToRebuttals(blocks);
    if (base.rebuttals.length === 0) {
      base.rebuttals = [
        { title: "Response", sayThis: sections.text, support: null },
      ];
    }
    return sanitizeAssistantStructuredReply(base);
  }

  base.coachNote = sections.coachNote?.trim() ?? null;
  base.followUp = sections.followUp?.trim() ?? null;

  const rebuttalParts: StructuredRebuttal[] = [];
  if (sections.preamble?.trim()) {
    const { sayThis, support } = bodyToSayAndSupport(sections.preamble);
    rebuttalParts.push({
      title: "Opening",
      sayThis,
      support,
    });
  }

  if (sections.rebuttal?.trim()) {
    const blocks = parseRebuttalVisualBlocks(sections.rebuttal);
    rebuttalParts.push(...blocksToRebuttals(blocks));
  }

  if (rebuttalParts.length > 0) {
    base.rebuttals = rebuttalParts;
  } else {
    base.rebuttals = [{ title: "Response", sayThis: text, support: null }];
  }

  return sanitizeAssistantStructuredReply(base);
}

/** Drop undefined; ensure JSON-serializable plain values only. */
export function sanitizeAssistantStructuredReply(
  r: AssistantStructuredReply
): AssistantStructuredReply {
  try {
    const json = JSON.parse(JSON.stringify(r)) as AssistantStructuredReply;
    return json;
  } catch {
    return {
      objectionType: r.objectionType ?? null,
      primaryObjectionType: r.primaryObjectionType ?? null,
      objectionTags: Array.isArray(r.objectionTags) ? r.objectionTags : [],
      objectionTagReasons: Array.isArray(r.objectionTagReasons)
        ? r.objectionTagReasons
        : undefined,
      toneUsed: r.toneUsed ?? null,
      coachNote: r.coachNote ?? null,
      followUp: r.followUp ?? null,
      rebuttals: Array.isArray(r.rebuttals) ? r.rebuttals : [],
    };
  }
}
