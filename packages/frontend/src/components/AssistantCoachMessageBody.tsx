"use client";

import { parseAssistantCoachSections } from "@/lib/parseAssistantCoachSections";
import {
  isCoachNoteLabelLine,
  isFollowUpLabelLine,
  segmentByLabelLines,
  type CoachLineSegment,
} from "@/lib/segmentCoachSectionLines";
import {
  ForcedRebuttalBlocks,
  RebuttalBodyPresentation,
} from "./forcedRebuttalBlocks";

/** Re-export script card tokens (defined in `forcedRebuttalBlocks.tsx`). */
export { BODY_CALLOUT, BODY_KEY_LINE, BODY_SUPPORT_LINES } from "./forcedRebuttalBlocks";

/** Rebuttal + follow-up body — dominant actionable green. */
const PRIMARY =
  "whitespace-pre-wrap text-sm text-emerald-400 font-semibold leading-relaxed";
/** Section labels inside rebuttal / follow-up (not body copy). */
const LABEL_EMERALD =
  "whitespace-pre-wrap text-xs font-semibold uppercase tracking-wide text-emerald-300";
/** Coach note / preamble / meta — fades back; no emerald. */
const COACH_META =
  "whitespace-pre-wrap text-xs text-gray-400 leading-relaxed";
const LABEL_NEUTRAL =
  "whitespace-pre-wrap text-xs uppercase tracking-widest text-gray-500/80 mt-3 first:mt-0";

/** Follow-up / segmented labels — match forced rebuttal scan line. */
const REBUTTAL_LABEL =
  "whitespace-pre-wrap text-sm font-semibold uppercase tracking-wider text-emerald-100 mb-2";
/** “One-liner …” callout in follow-up stream. */
const ONE_LINER_CALLOUT =
  "whitespace-pre-wrap text-sm font-bold uppercase tracking-wide text-white mb-2";

type Props = {
  content: string;
};

function isOneLinerSegment(text: string): boolean {
  return /one-liner/i.test(text);
}

/** Segmented rebuttal or follow-up: structure labels vs dominant script body. */
function RebuttalHierarchySegments({ segments }: { segments: CoachLineSegment[] }) {
  if (segments.length === 0) return null;
  return (
    <div className="space-y-6">
      {segments.map((seg, i) => {
        if (isOneLinerSegment(seg.text)) {
          return (
            <div key={i} className={ONE_LINER_CALLOUT}>
              {seg.text}
            </div>
          );
        }
        if (seg.kind === "label") {
          return (
            <div key={i} className={REBUTTAL_LABEL}>
              {seg.text}
            </div>
          );
        }
        return <RebuttalBodyPresentation key={i} text={seg.text} />;
      })}
    </div>
  );
}

function SegmentedBlock({
  segments,
  labelClassName,
  bodyClassName,
}: {
  segments: CoachLineSegment[];
  labelClassName: string;
  bodyClassName: string;
}) {
  if (segments.length === 0) return null;
  return (
    <div className="space-y-2">
      {segments.map((s, i) =>
        s.kind === "label" ? (
          <p key={i} className={labelClassName}>
            {s.text}
          </p>
        ) : (
          <p key={i} className={bodyClassName}>
            {s.text}
          </p>
        )
      )}
    </div>
  );
}

function BlobBody({ text }: { text: string }) {
  return <ForcedRebuttalBlocks raw={text} />;
}

/**
 * Live thread assistant body: dominant emerald for rebuttal + follow-up; muted gray for coach note + preamble.
 * Section labels (Rebuttal 1, Follow-up, etc.) are styled as small caps, not body copy.
 */
export function AssistantCoachMessageBody({ content }: Props) {
  const parsed = parseAssistantCoachSections(content);

  if (parsed.mode === "blob") {
    return <BlobBody text={parsed.text} />;
  }

  const coachSegments = parsed.coachNote
    ? segmentByLabelLines(parsed.coachNote, isCoachNoteLabelLine)
    : [];
  const followSegments = parsed.followUp
    ? segmentByLabelLines(parsed.followUp, isFollowUpLabelLine)
    : [];

  return (
    <div className="space-y-8">
      {parsed.preamble ? <p className={COACH_META}>{parsed.preamble}</p> : null}

      {parsed.rebuttal ? (
        <ForcedRebuttalBlocks raw={parsed.rebuttal} />
      ) : null}

      {parsed.coachNote ? (
        <SegmentedBlock
          segments={coachSegments}
          labelClassName={LABEL_NEUTRAL}
          bodyClassName={COACH_META}
        />
      ) : null}

      {parsed.followUp ? (
        <div className="mt-2 border-t border-white/10 pt-6">
          <RebuttalHierarchySegments segments={followSegments} />
        </div>
      ) : null}
    </div>
  );
}
