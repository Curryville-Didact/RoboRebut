"use client";

/** Intro / plain block before a numbered rebuttal — readable but secondary to labels. */
const REBUTTAL_PLAIN =
  "whitespace-pre-wrap text-base font-medium text-emerald-400/85 leading-loose mt-2 first:mt-0";
/** “One-liner …” callout — stands with labels. */
const ONE_LINER_CALLOUT =
  "whitespace-pre-wrap text-sm font-bold uppercase tracking-wide text-white mb-3";

/** Rebuttal 1 / 2 — small; must not compete with script. */
export const FORCED_REBUTTAL_LABEL =
  "whitespace-pre-wrap text-xs uppercase tracking-widest text-emerald-400/70 mb-2";

/** Tool card shell for script — separated from surrounding UI. */
export const BODY_CALLOUT =
  "rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 shadow-md";

/** Read-this-out-loud line — dominant on the call. */
export const BODY_KEY_LINE =
  "whitespace-pre-wrap text-xl font-semibold text-emerald-100 leading-relaxed tracking-normal mb-2";

/** Supporting context — secondary to key line. */
export const BODY_SUPPORT_LINES =
  "whitespace-pre-wrap text-sm text-emerald-400/60 leading-relaxed mt-2 border-t border-emerald-500/20 pt-2";

type RebuttalVisualBlock =
  | { type: "pair"; label: string; body: string }
  | { type: "plain"; text: string };

function isOneLinerSegment(text: string): boolean {
  return /one-liner/i.test(text);
}

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

/** Split body on newlines for display only — first line = key script, rest = support. */
export function RebuttalBodyPresentation({ text }: { text: string }) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lines = trimmed.split(/\r?\n/);
  while (lines.length > 0 && !lines[0].trim()) lines.shift();
  if (lines.length === 0) return null;

  if (lines.length === 1) {
    return (
      <div className={BODY_CALLOUT}>
        <div className={BODY_KEY_LINE}>{lines[0].trimEnd()}</div>
      </div>
    );
  }

  const first = lines[0].trimEnd();
  const restJoined = lines.slice(1).join("\n").trimEnd();
  return (
    <div className={BODY_CALLOUT}>
      <div className={BODY_KEY_LINE}>{first}</div>
      {restJoined ? (
        <div className={BODY_SUPPORT_LINES}>{restJoined}</div>
      ) : null}
    </div>
  );
}

/**
 * Renders rebuttal section with label/body split (presentation-only).
 * Named function export only (no default) for correct webpack / ESM interop.
 */
export function ForcedRebuttalBlocks({ raw }: { raw: string }) {
  const blocks = parseRebuttalVisualBlocks(raw);
  if (blocks.length === 0) return null;

  return (
    <div className="space-y-8">
      {blocks.map((b, i) => {
        if (b.type === "plain") {
          return (
            <div key={i} className={REBUTTAL_PLAIN}>
              {b.text}
            </div>
          );
        }

        const labelIsOneLiner = isOneLinerSegment(b.label);
        return (
          <div key={i}>
            <div
              className={
                labelIsOneLiner ? ONE_LINER_CALLOUT : FORCED_REBUTTAL_LABEL
              }
            >
              {b.label}
            </div>
            {b.body ? <RebuttalBodyPresentation text={b.body} /> : null}
          </div>
        );
      })}
    </div>
  );
}
