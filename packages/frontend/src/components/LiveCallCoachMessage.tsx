"use client";

/**
 * V10 — Stable Live Baseline (Post QA + Distribution Fix) — LOCKED
 *
 * Live script rendering + HUD only. `polishLiveSpeakableScript` from `liveVoicePolish`
 * applies ONLY to speakable lines below — not to `visibilityReason` or chips.
 *
 * Instant / Deep use `StructuredAssistantCoachMessage`; they must NOT import Live polish.
 * Reuse of Live polish elsewhere requires explicit approval (version bump / product sign-off).
 */

import type {
  AssistantStructuredReply,
  LiveActionSignal,
  LiveConfidenceLevel,
  LiveDeliveryRisk,
} from "@/types/assistantStructuredReply";
import { polishLiveSpeakableScript } from "@/lib/liveVoicePolish";
import { BODY_CALLOUT, BODY_KEY_LINE } from "./forcedRebuttalBlocks";

const HUD_WRAP =
  "rounded-md border border-emerald-500/[0.12] bg-emerald-950/[0.18] px-2 py-1.5 sm:px-2.5";
const CHIP =
  "inline-flex max-w-full shrink-0 items-center rounded-md border border-emerald-500/20 bg-emerald-500/[0.12] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-400/85";
const CHIP_SUBTYPE =
  "inline-flex max-w-full shrink-0 items-center rounded-md border border-white/[0.06] bg-black/25 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-gray-500";
const HUD_WHY =
  "mt-1.5 text-[11px] leading-snug text-gray-500 sm:text-xs";

const CHIP_BASE =
  "inline-flex max-w-full shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] uppercase tracking-wide";

function confidenceChipClass(level: LiveConfidenceLevel): string {
  if (level === "HIGH") {
    return `${CHIP_BASE} border border-emerald-400/45 bg-emerald-500/[0.28] font-semibold text-emerald-200`;
  }
  if (level === "LOW") {
    return `${CHIP_BASE} border border-white/[0.08] bg-white/[0.04] font-medium text-gray-500`;
  }
  return `${CHIP_BASE} border border-emerald-500/20 bg-emerald-500/[0.12] font-medium text-emerald-400/80`;
}

function actionChipClass(signal: LiveActionSignal): string {
  if (signal === "PUSH") {
    return `${CHIP_BASE} border border-emerald-500/35 bg-emerald-500/15 font-bold text-emerald-100`;
  }
  if (signal === "ALIGN") {
    return `${CHIP_BASE} border border-white/[0.07] bg-transparent font-normal text-gray-500 opacity-90`;
  }
  return `${CHIP_BASE} border border-gray-500/25 bg-black/20 font-medium text-gray-400`;
}

function deliveryRiskChipClass(_risk: LiveDeliveryRisk): string {
  return `${CHIP_BASE} inline-flex min-h-[1.25rem] items-center justify-center gap-1 border border-white/[0.06] bg-black/15 px-1.5`;
}

/** UI label only — backend still sends SAFE | MODERATE | AGGRESSIVE. */
function deliveryRiskDisplayLabel(risk: LiveDeliveryRisk): string {
  if (risk === "SAFE") return "SAFE";
  if (risk === "MODERATE") return "TONE";
  return "STRONG";
}

function deliveryRiskScreenReaderPhrase(risk: LiveDeliveryRisk): string {
  if (risk === "SAFE") return "safe to say directly";
  if (risk === "MODERATE") return "tone matters";
  return "strong line";
}

function DeliveryRiskIndicator({ risk }: { risk: LiveDeliveryRisk }) {
  const sr = deliveryRiskScreenReaderPhrase(risk);
  const label = deliveryRiskDisplayLabel(risk);
  if (risk === "AGGRESSIVE") {
    return (
      <span className={deliveryRiskChipClass(risk)} title={sr} aria-label={sr}>
        <span className="text-[13px] leading-none text-amber-200/85" aria-hidden>
          {"\u26A0\uFE0E"}
        </span>
        <span className="font-medium text-gray-400" aria-hidden>
          {label}
        </span>
      </span>
    );
  }
  if (risk === "MODERATE") {
    return (
      <span className={deliveryRiskChipClass(risk)} title={sr} aria-label={sr}>
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/75"
          aria-hidden
        />
        <span className="font-medium text-gray-400" aria-hidden>
          {label}
        </span>
      </span>
    );
  }
  return (
    <span className={deliveryRiskChipClass(risk)} title={sr} aria-label={sr}>
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500/55"
        aria-hidden
      />
      <span className="font-medium text-gray-400" aria-hidden>
        {label}
      </span>
    </span>
  );
}

/** Compact operator-facing token for the first chip (no raw enum dumps). */
function situationChipLabel(situationLabel: string): string {
  if (situationLabel === "FIT_STYLE") return "FIT";
  return situationLabel;
}

function subtypeChipText(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  return t.replace(/_/g, " ");
}

/**
 * Pattern chip: show for lane-driven responses (e.g. PRICE + tactical angle).
 * Hidden for phase-6 intents and family rows where the situation chip is enough (matches operator HUD spec).
 */
function showPatternChip(vis: NonNullable<AssistantStructuredReply["liveResponseVisibility"]>): boolean {
  const sit = vis.situationLabel;
  if (
    sit === "REQUEST" ||
    sit === "STALL" ||
    sit === "COMPARISON" ||
    sit === "TRUST" ||
    sit === "BRUSH_OFF" ||
    sit === "FIT_STYLE"
  ) {
    return false;
  }
  return Boolean(vis.selectedPrimaryPattern);
}

/** Subtype chip only when it adds information beyond situation + pattern. */
function showSubtypeChip(vis: NonNullable<AssistantStructuredReply["liveResponseVisibility"]>): boolean {
  if (!vis.subtypeLabel?.trim()) return false;
  const s = vis.subtypeLabel.trim();
  const sit = vis.situationLabel;
  if (sit === "PRICE" && /^PRICE_/i.test(s)) return false;
  if (sit === "TRUST" && s === "TYPED_TRUST") return false;
  if (sit === "BRUSH_OFF" && s === "NO_BRUSH") return false;
  if (sit === "REQUEST" && s === "SEND_ME_SOMETHING") return false;
  if (sit === "STALL" && s === "TALK_TO_PARTNER") return false;
  return true;
}

/**
 * LIVE mode only: script lines the broker says on the call — no coach / training chrome.
 */
export function LiveCallCoachMessage({
  data,
  messageContent = null,
  previousLiveDisplayLine = null,
}: {
  data: AssistantStructuredReply;
  messageContent?: string | null;
  /** Optional: prior message’s final polished Live line — enables V11 Phase 3 spacing across turns. */
  previousLiveDisplayLine?: string | null;
}) {
  const vis = data.liveResponseVisibility;
  const rawScript =
    data.liveOpeningLines && data.liveOpeningLines.length > 0
      ? data.liveOpeningLines.join("\n")
      : String(
          data.rebuttals?.[0]?.sayThis ?? messageContent ?? ""
        );
  /* V10: Live-only polish — pass-through for script text only; HUD strings untouched. */
  const lines = polishLiveSpeakableScript(rawScript, {
    situationLabel: vis?.situationLabel ?? null,
    previousLiveDisplayLine,
  })
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const confidenceLevel: LiveConfidenceLevel = vis?.confidenceLevel ?? "MEDIUM";
  const actionSignal: LiveActionSignal = vis?.actionSignal ?? "PROBE";
  const deliveryRisk: LiveDeliveryRisk = vis?.deliveryRisk ?? "MODERATE";

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/90">
        Live script
      </p>
      {vis ? (
        <div className={HUD_WRAP}>
          <div className="flex flex-wrap items-center gap-1">
            <span className={CHIP} title="Situation">
              {situationChipLabel(vis.situationLabel)}
            </span>
            {showPatternChip(vis) && vis.selectedPrimaryPattern ? (
              <span className={CHIP} title="Pattern">
                {vis.selectedPrimaryPattern}
              </span>
            ) : null}
            <span
              className={confidenceChipClass(confidenceLevel)}
              title="Confidence"
            >
              {confidenceLevel}
            </span>
            <span className={actionChipClass(actionSignal)} title="Action">
              {actionSignal}
            </span>
            <DeliveryRiskIndicator risk={deliveryRisk} />
            {showSubtypeChip(vis) ? (
              <span className={CHIP_SUBTYPE} title="Detail">
                {subtypeChipText(vis.subtypeLabel!)}
              </span>
            ) : null}
          </div>
          <p className={HUD_WHY}>{vis.visibilityReason}</p>
        </div>
      ) : null}
      <div className={BODY_CALLOUT}>
        <div className="space-y-2">
          {lines.length > 0 ? (
            lines.map((line, i) => (
              <div key={i} className={BODY_KEY_LINE}>
                {line}
              </div>
            ))
          ) : (
            <div className={BODY_KEY_LINE}>Script unavailable.</div>
          )}
        </div>
      </div>
    </div>
  );
}
