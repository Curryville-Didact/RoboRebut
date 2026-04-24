/**
 * Presentation-only: split section text into label rows vs body paragraphs.
 * Does not change parseAssistantCoachSections — used after a section string is known.
 */

export type CoachLineSegment = { kind: "label" | "body"; text: string };

/** Line is only a rebuttal header (e.g. "Rebuttal 1:", "Rebuttal 2 —"). */
export function isRebuttalLabelLine(line: string): boolean {
  const t = line.trim();
  return /^\s*(?:\*\*)?\s*Rebuttal(?:\s*\d+)?\s*(?:\*\*)?\s*[:\-—–]?\s*$/i.test(t);
}

/** Line is only a follow-up header. */
export function isFollowUpLabelLine(line: string): boolean {
  const t = line.trim();
  return (
    /^\s*(?:\*\*)?\s*Follow[-\s]?up(?:\s*[Qq]uestion)?\s*(?:\*\*)?\s*[:\-—–]?\s*$/i.test(
      t
    ) || /^\s*(?:\*\*)?\s*Follow[-\s]?Up\s*[Qq]uestion\s*(?:\*\*)?\s*[:\-—–]?\s*$/i.test(t)
  );
}

/** Line is only a coach-note header. */
export function isCoachNoteLabelLine(line: string): boolean {
  const t = line.trim();
  return /^\s*(?:\*\*)?\s*Coach\s*note\s*(?:\*\*)?\s*[:\-—–]?\s*$/i.test(t);
}

function flushBody(buf: string[], out: CoachLineSegment[]) {
  if (buf.length === 0) return;
  const text = buf.join("\n").trimEnd();
  buf.length = 0;
  if (text) out.push({ kind: "body", text });
}

/**
 * Split a section block into alternating label / body segments by scanning line-by-line.
 */
export function segmentByLabelLines(
  text: string,
  isLabelLine: (line: string) => boolean
): CoachLineSegment[] {
  const lines = text.split(/\r?\n/);
  const out: CoachLineSegment[] = [];
  const buf: string[] = [];

  for (const line of lines) {
    if (isLabelLine(line)) {
      flushBody(buf, out);
      out.push({ kind: "label", text: line.trim() });
    } else {
      buf.push(line);
    }
  }
  flushBody(buf, out);
  return out;
}
