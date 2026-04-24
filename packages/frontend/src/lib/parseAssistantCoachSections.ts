/**
 * Presentation-only: split assistant coaching text into labeled sections when headers match
 * common RoboRebut output shapes (Rebuttal / Coach note / Follow-up).
 * If no headers match, callers should render a single block.
 */

export type ParsedCoachSections =
  | { mode: "blob"; text: string }
  | {
      mode: "sections";
      /** Lines before the first recognized section (e.g. opener). */
      preamble?: string;
      rebuttal?: string;
      coachNote?: string;
      followUp?: string;
    };

/** Header-only line: "Rebuttal:" or "**Coach note**" */
const SECTION_HEADER_LINE =
  /^\s*(?:\*\*)?\s*(Rebuttal(?:\s*\d+)?|Coach\s*note|Follow[-\s]?up)\s*(?:\*\*)?\s*[:\-]?\s*$/i;

/** Same line carries first sentence: "Rebuttal: Say this..." */
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

export function parseAssistantCoachSections(raw: string): ParsedCoachSections {
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
