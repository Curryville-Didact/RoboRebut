import { parseStructuredReplySafe } from "@/lib/parseStructuredReply";
import type { AssistantStructuredReply } from "@/types/assistantStructuredReply";

export type SavedBodyBlock =
  | { kind: "primary"; text: string }
  | { kind: "secondary"; title: string; text: string; support?: string | null }
  | { kind: "coach"; text: string }
  | { kind: "followUp"; text: string }
  | { kind: "paragraph"; text: string };

const COLLAPSE_CHARS = 1100;

function paragraphsFromPlain(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  return t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

function buildFromStructured(s: AssistantStructuredReply, fallbackContent: string): SavedBodyBlock[] {
  const blocks: SavedBodyBlock[] = [];

  const lines = s.liveOpeningLines?.filter((x) => typeof x === "string" && x.trim()) ?? [];
  if (lines.length > 0) {
    blocks.push({ kind: "primary", text: lines.join("\n") });
  }

  // Pre-call artifact fields (when present) — render as secondary blocks for Saved Responses.
  if (s.precallWhatTheyReallyMean?.trim()) {
    blocks.push({
      kind: "secondary",
      title: "What they really mean",
      text: s.precallWhatTheyReallyMean.trim(),
    });
  }
  if (s.precallLane1?.trim()) {
    blocks.push({
      kind: "secondary",
      title: "Lane 1",
      text: s.precallLane1.trim(),
    });
  }
  if (s.precallLane2?.trim()) {
    blocks.push({
      kind: "secondary",
      title: "Lane 2",
      text: s.precallLane2.trim(),
    });
  }

  const rebuttals = s.rebuttals ?? [];
  if (rebuttals.length > 0) {
    if (blocks.length === 0) {
      const first = rebuttals[0]!;
      blocks.push({ kind: "primary", text: first.sayThis.trim() });
      for (let i = 1; i < rebuttals.length; i++) {
        const r = rebuttals[i]!;
        blocks.push({
          kind: "secondary",
          title: r.title,
          text: r.sayThis.trim(),
          support: r.support ?? null,
        });
      }
    } else {
      for (const r of rebuttals) {
        blocks.push({
          kind: "secondary",
          title: r.title,
          text: r.sayThis.trim(),
          support: r.support ?? null,
        });
      }
    }
  }

  if (s.coachNote?.trim()) {
    blocks.push({ kind: "coach", text: s.coachNote.trim() });
  }
  if (s.followUp?.trim()) {
    blocks.push({ kind: "followUp", text: s.followUp.trim() });
  }

  if (blocks.length === 0) {
    return paragraphsFromPlain(fallbackContent).map((p) => ({ kind: "paragraph", text: p }));
  }

  return blocks;
}

/**
 * Presentation-only segmentation for saved response cards. Does not mutate stored data.
 */
export function segmentSavedResponseBody(
  content: string,
  metadata: Record<string, unknown> | null | undefined
): { blocks: SavedBodyBlock[]; hadStructured: boolean } {
  const raw = metadata?.structured_reply;
  const parsed = parseStructuredReplySafe(raw);

  const read = (k: string): string | null => {
    const v = metadata?.[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };

  const normalizeForCompare = (value: string | null | undefined): string => {
    if (value == null) return "";
    return String(value).trim().toLowerCase().replace(/\s+/g, " ");
  };

  const resolveCallReadyLine = (
    structured: AssistantStructuredReply | null,
    meta: Record<string, unknown> | null | undefined
  ): string | null => {
    const fromMeta = typeof meta?.callReadyLine === "string" ? meta.callReadyLine : null;
    const m = fromMeta?.trim() ? fromMeta.trim() : null;
    if (m) return m;
    const s = structured?.callReadyLine?.trim();
    return s ? s : null;
  };

  const resolveDedupedCallReadyLine = (
    structured: AssistantStructuredReply | null,
    meta: Record<string, unknown> | null | undefined
  ): string | null => {
    const candidates = [
      typeof meta?.callReadyLine === "string" ? meta.callReadyLine : null,
      structured?.callReadyLine ?? null,
    ]
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter(Boolean);

    const seen = new Set<string>();
    for (const c of candidates) {
      const key = normalizeForCompare(c);
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      return c;
    }
    return null;
  };

  const shouldRenderCallReady = (
    blocks: SavedBodyBlock[],
    callReady: string
  ): boolean => {
    const crKey = normalizeForCompare(callReady);
    if (!crKey) return false;

    // SECTION-AWARE semantic dedupe: if call-ready already exists anywhere in rendered section text,
    // do not render a separate call-ready block.
    const renderedTexts = blocks
      .map((b) =>
        "text" in b && typeof (b as { text?: unknown }).text === "string"
          ? normalizeForCompare((b as { text: string }).text)
          : ""
      )
      .filter(Boolean);
    const existsInSections = renderedTexts.some(
      (t) => t.includes(crKey) || crKey.includes(t)
    );
    if (existsInSections) return false;

    // Never add a call-ready block if it is semantically identical to the saved body content.
    const contentKey = normalizeForCompare(content);
    if (contentKey && contentKey === crKey) return false;

    return true;
  };

  if (parsed) {
    const blocks = buildFromStructured(parsed, content);
    // Collect and dedupe all call-ready candidates up front (semantic compare).
    const callReadyLine = resolveDedupedCallReadyLine(parsed, metadata);
    // Defensive: if a call-ready section was ever inserted earlier, remove it (single-source rule).
    const withoutCallReady = blocks.filter(
      (b) => !(b.kind === "secondary" && b.title === "Call-ready line")
    );
    if (callReadyLine && shouldRenderCallReady(withoutCallReady, callReadyLine)) {
      withoutCallReady.push({
        kind: "secondary",
        title: "Call-ready line",
        text: callReadyLine,
      });
    }
    return { blocks: withoutCallReady, hadStructured: true };
  }
  // Back-compat / partial saves: if structured reply is missing, attempt to render any
  // preserved precall fields stored in metadata.
  const wtrm = read("whatTheyReallyMean");
  const lane1 = read("lane1");
  const lane2 = read("lane2");
  const callReadyLine = resolveDedupedCallReadyLine(null, metadata);
  const coachNote = read("coachNote");
  const followUp = read("followUp");

  const derived: SavedBodyBlock[] = [];
  const primary = content.trim();
  if (primary) derived.push({ kind: "primary", text: primary });
  if (wtrm) derived.push({ kind: "secondary", title: "What they really mean", text: wtrm });
  if (lane1) derived.push({ kind: "secondary", title: "Lane 1", text: lane1 });
  if (lane2) derived.push({ kind: "secondary", title: "Lane 2", text: lane2 });
  if (coachNote) derived.push({ kind: "coach", text: coachNote });
  if (followUp) derived.push({ kind: "followUp", text: followUp });
  // Insert call-ready only once, after other sections are present so section-aware dedupe can see them.
  if (callReadyLine && shouldRenderCallReady(derived, callReadyLine)) {
    // Keep call-ready near the core rebuttal sections (after lanes, before coach/follow-up if present).
    const insertAfterLanes = (() => {
      let idx = derived.findLastIndex(
        (b) => b.kind === "secondary" && (b.title === "Lane 2" || b.title === "Lane 1")
      );
      if (idx < 0) {
        idx = derived.findLastIndex(
          (b) => b.kind === "secondary" && b.title === "What they really mean"
        );
      }
      if (idx < 0) {
        idx = derived.findLastIndex((b) => b.kind === "primary");
      }
      return Math.max(0, idx + 1);
    })();
    derived.splice(insertAfterLanes, 0, {
      kind: "secondary",
      title: "Call-ready line",
      text: callReadyLine,
    });
  }

  if (derived.length > 1) {
    return { blocks: derived, hadStructured: true };
  }
  return {
    blocks: paragraphsFromPlain(content).map((p) => ({ kind: "paragraph", text: p })),
    hadStructured: false,
  };
}

export function shouldCollapseBody(text: string): boolean {
  return text.length > COLLAPSE_CHARS;
}

export function collapseHintChars(): number {
  return COLLAPSE_CHARS;
}
