/**
 * Build legacy-compatible `messages.content` from structured coach JSON.
 * Used when marker parsing succeeds so the string view matches structured_reply.
 */

import type { AssistantStructuredReply } from "../types/assistantStructuredReply.js";

function humanizeObjectionSlug(slug: string): string {
  return slug.trim().replace(/_/g, " ");
}

/**
 * Produces section-oriented text aligned with `parseAssistantCoachSections` /
 * backend `parseCoachSections` (Rebuttal / Coach note / Follow-up).
 */
export function formatStructuredCoachReplyToContent(
  s: AssistantStructuredReply
): string {
  const preamble: string[] = [];
  const ot = s.objectionType?.trim();
  const tu = s.toneUsed?.trim();
  if (ot) preamble.push(`Objection type: ${humanizeObjectionSlug(ot)}`);
  if (tu) preamble.push(`Tone: ${tu}`);

  if (s.precallArtifact === "v102_instant") {
    const parts: string[] = [];
    const lbl = s.precallObjectionTypeLabel?.trim();
    const mean = s.precallWhatTheyReallyMean?.trim();
    const cr =
      s.callReadyLine?.trim() ||
      s.rebuttals?.[0]?.sayThis?.trim() ||
      s.precallLane1?.trim();
    if (lbl) parts.push("Objection Type", "", lbl);
    if (mean) {
      if (parts.length) parts.push("");
      parts.push("Core issue", "", mean);
    }
    if (cr) {
      if (parts.length) parts.push("");
      parts.push("Call-ready line", "", cr);
    }
    return parts.join("\n").trim();
  }

  if (s.precallArtifact === "v102_standard") {
    const parts: string[] = [];
    const lbl = s.precallObjectionTypeLabel?.trim();
    const mean = s.precallWhatTheyReallyMean?.trim();
    const l1 = s.precallLane1?.trim();
    const l2 = s.precallLane2?.trim();
    const cn = s.coachNote?.trim();
    const fu = s.followUp?.trim();
    const cr = s.callReadyLine?.trim();
    const pp = s.precallPrimaryPersuasionPattern?.trim();
    const p2 = s.lane2PersuasionPattern?.trim();
    if (lbl) parts.push("Objection Type", "", lbl);
    if (pp) {
      if (parts.length) parts.push("");
      parts.push(`Primary Strategy: ${pp}`);
    }
    if (p2) {
      if (parts.length) parts.push("");
      parts.push(`Secondary Strategy: ${p2}`);
    }
    if (mean) {
      if (parts.length) parts.push("");
      parts.push("What They Really Mean", "", mean);
    }
    if (l1) {
      if (parts.length) parts.push("");
      parts.push("Lane 1", "", l1);
    }
    if (l2) {
      if (parts.length) parts.push("");
      parts.push("Lane 2", "", l2);
    }
    if (cr) {
      if (parts.length) parts.push("");
      parts.push("Call-ready line", "", cr);
    }
    if (cn) {
      if (parts.length) parts.push("");
      parts.push("Coach Note", "", cn);
    }
    if (fu) {
      if (parts.length) parts.push("");
      parts.push("Follow-Up Question", "", fu);
    }
    return parts.join("\n").trim();
  }

  if (s.precallArtifact === "v102_number") {
    const parts: string[] = [];
    const m = s.precallMetric?.trim();
    const w = s.precallWhatNumberMeans?.trim();
    const su = s.precallStrategicUse?.trim();
    const mf = s.precallMerchantFacingLine?.trim();
    if (m) parts.push("Metric", "", m);
    if (w) {
      if (parts.length) parts.push("");
      parts.push("What the Number Means", "", w);
    }
    if (su) {
      if (parts.length) parts.push("");
      parts.push("Strategic Use", "", su);
    }
    if (mf) {
      if (parts.length) parts.push("");
      parts.push("Merchant-Facing Line", "", mf);
    }
    return parts.join("\n").trim();
  }

  const mm = s.merchantMeaning?.trim();
  const ph = (s.pressureDiagnosis ?? s.pressureHierarchy)?.trim();
  const rs = s.reframeStrategy?.trim();
  const cr = s.callReadyLine?.trim();
  if (mm || ph || rs || cr) {
    if (mm) preamble.push(`Merchant meaning`, "", mm);
    if (ph) {
      if (preamble.length) preamble.push("");
      preamble.push(`Pressure diagnosis`, "", ph);
    }
    if (rs) {
      if (preamble.length) preamble.push("");
      preamble.push(`Reframe strategy`, "", rs);
    }
    if (cr) {
      if (preamble.length) preamble.push("");
      preamble.push(`Call-ready line`, "", cr);
    }
  }

  const pi = s.patternIntel;
  if (pi) {
    if (pi.status?.trim()) preamble.push(pi.status.trim());
    if (pi.whyThisResponse?.trim()) {
      preamble.push(`Why this response: ${pi.whyThisResponse.trim()}`);
    }
    if (pi.howItFits?.trim()) {
      preamble.push(`How it fits: ${pi.howItFits.trim()}`);
    }
    if (pi.coachInsight?.trim()) {
      preamble.push(`Coach insight: ${pi.coachInsight.trim()}`);
    }
  }

  const rebuttalChunks: string[] = [];
  const rebuttals = s.rebuttals ?? [];
  rebuttals.forEach((r, i) => {
    const n = i + 1;
    const title = (r.title ?? "").trim() || `Rebuttal ${n}`;
    const lines: string[] = [];
    lines.push(`Rebuttal ${n} — ${title}`);
    if ((r.sayThis ?? "").trim()) lines.push(r.sayThis.trim());
    if ((r.support ?? "").trim()) lines.push(r.support!.trim());
    rebuttalChunks.push(lines.join("\n"));
  });

  const parts: string[] = [];
  if (preamble.length) parts.push(preamble.join("\n"));
  if (rebuttalChunks.length) {
    if (parts.length) parts.push("");
    parts.push(rebuttalChunks.join("\n\n"));
  }

  const cn = s.coachNote?.trim();
  if (cn) {
    if (parts.length) parts.push("");
    parts.push("Coach note", "", cn);
  }

  const fu = s.followUp?.trim();
  if (fu) {
    if (parts.length) parts.push("");
    parts.push("Follow-up", "", fu);
  }

  return parts.join("\n").trim();
}
