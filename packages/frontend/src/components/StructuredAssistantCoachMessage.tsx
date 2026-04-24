"use client";

import type { AssistantStructuredReply } from "@/types/assistantStructuredReply";
import type { PreCallDepth } from "@/types/preCallDepth";
import {
  stripCannedPressureCloserDeep,
  stripCannedPressureCloserInstant,
} from "@/lib/precallPresentation";
import { LiveCallCoachMessage } from "./LiveCallCoachMessage";
import {
  BODY_CALLOUT,
  BODY_KEY_LINE,
  BODY_SUPPORT_LINES,
  FORCED_REBUTTAL_LABEL,
} from "./forcedRebuttalBlocks";

const COACH_NOTE =
  "whitespace-pre-wrap text-xs text-gray-400 leading-relaxed";
const PATTERN_BOX =
  "rounded-lg border border-white/[0.06] bg-black/[0.08] px-3 py-2.5 text-xs leading-relaxed text-gray-400";
const FOLLOW_UP_BLOCK =
  "mt-5 border-t border-emerald-500/25 pt-4";

const PREP_BODY =
  "whitespace-pre-wrap text-sm text-gray-300 leading-relaxed";

/** At most one sentence for Instant “Core issue” (diagnostic line only; not a full block). */
function firstSentenceOnly(text: string): string {
  const t = text.trim();
  if (!t) return "";
  const bySentence = t.match(/^(.+?[.!?])(\s|$)/);
  if (bySentence) return bySentence[1].trim();
  const line = t.split(/\n/)[0]?.trim() ?? "";
  if (line.length > 320) return `${line.slice(0, 317)}…`;
  return line;
}

function polishPrecallField(depth: PreCallDepth | undefined, text: string): string {
  const t = text.trim();
  if (!t) return "";
  if (depth === "instant") return stripCannedPressureCloserInstant(t);
  if (depth === "deep") return stripCannedPressureCloserDeep(t);
  return t;
}

function PrecallV102Supplement({
  data,
}: {
  data: AssistantStructuredReply;
}) {
  const depth = data.precallDepth;
  const rows: Array<{ label: string; body: string; keyLine?: boolean }> = [];
  const add = (label: string, body: string | null | undefined, keyLine?: boolean) => {
    const raw = typeof body === "string" ? body.trim() : "";
    const t = raw ? polishPrecallField(depth, raw) : "";
    if (t) rows.push({ label, body: t, keyLine });
  };

  add("Objection Type", data.precallObjectionTypeLabel);
  add("What They Really Mean", data.precallWhatTheyReallyMean);
  add("Lane 1", data.precallLane1, true);
  add("Lane 2", data.precallLane2, true);
  add("Metric", data.precallMetric);
  add("What the Number Means", data.precallWhatNumberMeans);
  add("Strategic Use", data.precallStrategicUse);
  add("Merchant-Facing Line", data.precallMerchantFacingLine, true);

  if (rows.length === 0) return null;

  return (
    <div className="space-y-8">
      {rows.map((r) => (
        <div key={r.label} className="space-y-2">
          <div className={FORCED_REBUTTAL_LABEL}>{r.label}</div>
          <div
            className={
              r.keyLine ? `${BODY_CALLOUT} mt-1` : PREP_BODY
            }
          >
            {r.keyLine ? (
              <div className={BODY_KEY_LINE}>{r.body}</div>
            ) : (
              r.body
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function StructuredAssistantCoachMessage({
  data,
  messageContent = null,
}: {
  data: AssistantStructuredReply;
  /** `messages.content` — used when structured rebuttals omit opening `sayThis`. */
  messageContent?: string | null;
  /** Raw `messages.structured_reply` (optional; ignored at render — use for future diagnostics). */
  structuredReplyRaw?: unknown;
}) {
  if (data.coachReplyMode === "live") {
    return (
      <LiveCallCoachMessage data={data} messageContent={messageContent} />
    );
  }

  const rebuttals = Array.isArray(data.rebuttals) ? data.rebuttals : [];
  const first = rebuttals[0];

  if (data.coachReplyMode === "precall" && data.precallDepth === "instant") {
    const objectionLabel =
      data.precallObjectionTypeLabel?.trim() ||
      data.primaryObjectionType?.trim() ||
      data.objectionType?.trim() ||
      "";
    const coreRaw = data.precallWhatTheyReallyMean?.trim() ?? "";
    const coreIssue = coreRaw
      ? firstSentenceOnly(
          stripCannedPressureCloserInstant(coreRaw)
        )
      : "";
    const callReadyInstant =
      stripCannedPressureCloserInstant(
        first?.sayThis?.trim() ||
          data.callReadyLine?.trim() ||
          data.precallLane1?.trim() ||
          data.precallMerchantFacingLine?.trim() ||
          (typeof messageContent === "string" ? messageContent.trim() : "") ||
          ""
      );

    return (
      <div className="space-y-8">
        {objectionLabel ? (
          <div className="space-y-2">
            <div className={FORCED_REBUTTAL_LABEL}>Objection Type</div>
            <div className={PREP_BODY}>{objectionLabel}</div>
          </div>
        ) : null}
        {coreIssue ? (
          <div className="space-y-2">
            <div className={FORCED_REBUTTAL_LABEL}>Core issue</div>
            <div className={PREP_BODY}>{coreIssue}</div>
          </div>
        ) : null}
        <div className="space-y-3">
          <div className={FORCED_REBUTTAL_LABEL}>Call-ready line</div>
          <div className={BODY_CALLOUT}>
            <div className={BODY_KEY_LINE}>
              {callReadyInstant || "Call-ready line unavailable."}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /** Same persisted field as `pressureDiagnosis`; legacy key only for older rows. */
  const pressurePrep = (data.pressureDiagnosis ?? data.pressureHierarchy ?? "")
    .trim();

  const hasLegacyPrepBlocks = Boolean(
    data.merchantMeaning?.trim() || pressurePrep || data.reframeStrategy?.trim()
  );

  const hasV102PrecallFields = Boolean(
    data.precallObjectionTypeLabel?.trim() ||
      data.precallWhatTheyReallyMean?.trim() ||
      data.precallLane1?.trim() ||
      data.precallLane2?.trim() ||
      data.precallMetric?.trim() ||
      data.precallWhatNumberMeans?.trim() ||
      data.precallStrategicUse?.trim() ||
      data.precallMerchantFacingLine?.trim()
  );

  const hasPrecallPrep = hasLegacyPrepBlocks || hasV102PrecallFields;

  const laneCallReadyFallback =
    data.precallLane1?.trim() ||
    data.precallLane2?.trim() ||
    data.precallMerchantFacingLine?.trim() ||
    "";
  const callReadyFromStructured =
    first?.sayThis?.trim() ||
    data.callReadyLine?.trim() ||
    laneCallReadyFallback ||
    "";
  const callReadyPolished = polishPrecallField(
    data.precallDepth,
    callReadyFromStructured
  );
  const openingTextResolved = hasPrecallPrep
    ? callReadyPolished ||
      (data.precallObjectionTypeLabel?.trim()
        ? `Address: ${data.precallObjectionTypeLabel.trim()} — use the lanes above on the call.`
        : "Use Lane 1 or Lane 2 above as your primary call-ready wording.")
    : callReadyFromStructured
      ? callReadyPolished
      : (typeof messageContent === "string" ? messageContent.trim() : "") ||
        "Opening unavailable.";

  const rest = rebuttals.length > 1 ? rebuttals.slice(1) : [];

  const pi = data.patternIntel;

  const validRest = rest.filter(
    (
      r
    ): r is {
      title: string;
      sayThis: string;
      support?: string | null;
    } =>
      r != null &&
      typeof (r as { title?: unknown }).title === "string" &&
      typeof (r as { sayThis?: unknown }).sayThis === "string"
  );

  return (
    <div className="space-y-8">
      {data.merchantMeaning?.trim() ? (
        <div className="space-y-2">
          <div className={FORCED_REBUTTAL_LABEL}>Merchant meaning</div>
          <div className={PREP_BODY}>{data.merchantMeaning.trim()}</div>
        </div>
      ) : null}
      {pressurePrep ? (
        <div className="space-y-2">
          <div className={FORCED_REBUTTAL_LABEL}>Pressure diagnosis</div>
          <div className={PREP_BODY}>{pressurePrep}</div>
        </div>
      ) : null}
      {data.reframeStrategy?.trim() ? (
        <div className="space-y-2">
          <div className={FORCED_REBUTTAL_LABEL}>Reframe strategy</div>
          <div className={PREP_BODY}>{data.reframeStrategy.trim()}</div>
        </div>
      ) : null}

      {hasV102PrecallFields ? <PrecallV102Supplement data={data} /> : null}

      {/* Call-ready script (precall prep) or legacy opening block */}
      <div className="space-y-3">
        <div className={FORCED_REBUTTAL_LABEL}>
          {hasPrecallPrep
            ? "Call-ready line"
            : first?.title?.trim() || "Opening"}
        </div>
        <div className={BODY_CALLOUT}>
          <div className={BODY_KEY_LINE}>{openingTextResolved}</div>
          {first?.support ? (
            <div className={BODY_SUPPORT_LINES}>{first.support}</div>
          ) : null}
        </div>
      </div>

      {pi &&
        (pi.status ||
          pi.whyThisResponse ||
          pi.howItFits ||
          pi.coachInsight) && (
        <div className={PATTERN_BOX}>
          {pi.status ? (
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-gray-500">
              {pi.status}
            </p>
          ) : null}
          {pi.whyThisResponse ? (
            <p className="mb-2">
              <span className="text-gray-500">Why this response: </span>
              {pi.whyThisResponse}
            </p>
          ) : null}
          {pi.howItFits ? (
            <p className="mb-2">
              <span className="text-gray-500">How it fits: </span>
              {pi.howItFits}
            </p>
          ) : null}
          {pi.coachInsight ? (
            <p className="border-t border-white/[0.05] pt-2 text-gray-400">
              <span className="text-gray-500">Coach insight: </span>
              {pi.coachInsight}
            </p>
          ) : null}
        </div>
      )}

      {validRest.map((r, i) => (
        <div key={i} className="space-y-3">
          <div className={FORCED_REBUTTAL_LABEL}>
            {r.title?.trim() || "Rebuttal"}
          </div>
          <div className={BODY_CALLOUT}>
            <div className={BODY_KEY_LINE}>{r.sayThis}</div>
            {r.support ? (
              <div className={BODY_SUPPORT_LINES}>{r.support}</div>
            ) : null}
          </div>
        </div>
      ))}

      {data.coachNote ? (
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
            Coach note
          </p>
          <p className={COACH_NOTE}>{data.coachNote}</p>
        </div>
      ) : null}

      {data.followUp ? (
        <div className={FOLLOW_UP_BLOCK}>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-400/90">
            Follow-up question
          </p>
          <p className="whitespace-pre-wrap text-base font-semibold leading-relaxed text-emerald-200">
            {data.followUp}
          </p>
        </div>
      ) : null}
    </div>
  );
}
