"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { formatToneLabel } from "@/lib/toneDisplay";
import { formatStrategyLabel } from "@/lib/strategyDisplay";
import {
  collapseHintChars,
  segmentSavedResponseBody,
  shouldCollapseBody,
  type SavedBodyBlock,
} from "@/lib/segmentSavedResponse";

type SavedResponse = {
  id: string;
  label: string;
  content: string;
  category: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
};

function metaString(meta: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!meta) return null;
  const v = meta[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[11px] text-gray-400">
      {children}
    </span>
  );
}

function BodyBlocks({
  blocks,
  fullText,
}: {
  blocks: SavedBodyBlock[];
  fullText: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const flat = useMemo(() => {
    if (blocks.length > 0) return blocks;
    return [{ kind: "paragraph" as const, text: fullText }];
  }, [blocks, fullText]);

  const joined = useMemo(
    () =>
      flat
        .map((b) => {
          if (b.kind === "secondary") return `${b.title}\n${b.text}`;
          return b.text;
        })
        .join("\n\n"),
    [flat]
  );

  const needsCollapse = shouldCollapseBody(joined) || shouldCollapseBody(fullText);
  const limit = collapseHintChars();

  if (!needsCollapse || expanded) {
    return (
      <div className="space-y-4">
        {flat.map((b, i) => {
          if (b.kind === "primary") {
            return (
              <div key={`p-${i}`}>
                <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-400/80">
                  Primary rebuttal
                </p>
                <p className="mt-1.5 text-base leading-relaxed text-white">{b.text}</p>
              </div>
            );
          }
          if (b.kind === "secondary") {
            return (
              <div key={`s-${i}`} className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                <p className="text-[11px] font-medium text-gray-500">{b.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-gray-200">{b.text}</p>
                {b.support ? (
                  <p className="mt-2 text-xs leading-relaxed text-gray-500">{b.support}</p>
                ) : null}
              </div>
            );
          }
          if (b.kind === "coach") {
            return (
              <div
                key={`c-${i}`}
                className="rounded-lg border border-white/[0.06] bg-black/35 p-3 text-sm leading-relaxed text-gray-400"
              >
                <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  Coach note
                </span>
                <p className="mt-1">{b.text}</p>
              </div>
            );
          }
          if (b.kind === "followUp") {
            return (
              <div key={`f-${i}`} className="border-t border-white/[0.06] pt-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  Follow-up
                </p>
                <p className="mt-1 text-sm text-gray-300">{b.text}</p>
              </div>
            );
          }
          return (
            <p key={`g-${i}`} className="text-sm leading-relaxed text-gray-100 whitespace-pre-wrap">
              {b.text}
            </p>
          );
        })}
        {needsCollapse ? (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-xs font-medium text-emerald-400/90 underline-offset-2 hover:underline"
          >
            Show less
          </button>
        ) : null}
      </div>
    );
  }

  const preview = joined.length > limit ? `${joined.slice(0, limit).trim()}…` : joined;

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-gray-100 whitespace-pre-wrap">{preview}</p>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-xs font-medium text-emerald-400/90 underline-offset-2 hover:underline"
      >
        Show more
      </button>
    </div>
  );
}

export function SavedResponseCard({
  r,
  copiedId,
  onCopy,
  onDelete,
  formatDate,
}: {
  r: SavedResponse;
  copiedId: string | null;
  onCopy: (content: string, id: string) => void;
  onDelete: (id: string) => void;
  formatDate: (iso: string) => string;
}) {
  const meta = r.metadata ?? null;
  const toneRaw = metaString(meta, "tone");
  const objectionPreview = metaString(meta, "objectionPreview");
  const objectionType = metaString(meta, "objectionType");
  const patternKey = metaString(meta, "patternKey");
  const strategyLabel = metaString(meta, "strategyLabel");
  const strategyRaw = metaString(meta, "strategyRaw");
  const strategyUsedLegacy = metaString(meta, "strategyUsed");
  const strategyUsed =
    strategyLabel ??
    formatStrategyLabel(strategyRaw) ??
    formatStrategyLabel(strategyUsedLegacy) ??
    strategyUsedLegacy;
  const { blocks, hadStructured } = useMemo(
    () => segmentSavedResponseBody(r.content, r.metadata ?? undefined),
    [r.content, r.metadata]
  );

  const categoryLabel = r.category ? r.category.replace(/_/g, " ") : null;
  const objectionTypeLabel = objectionType ? objectionType.replace(/_/g, " ") : null;

  return (
    <article className="overflow-hidden rounded-2xl border border-white/[0.12] bg-gradient-to-b from-white/[0.04] to-black/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <div className="border-b border-white/[0.06] px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-white">{r.label}</h3>
            <p className="mt-1 text-xs text-gray-500">{formatDate(r.created_at)}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => void onCopy(r.content, r.id)}
              className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-gray-100 transition hover:bg-white/[0.1]"
            >
              {copiedId === r.id ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={() => void onDelete(r.id)}
              className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200/90 transition hover:bg-red-500/15"
            >
              Delete
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {categoryLabel ? <Pill>Objection · {categoryLabel}</Pill> : null}
          {objectionTypeLabel ? <Pill>Category · {objectionTypeLabel}</Pill> : null}
          {toneRaw ? <Pill>Tone · {formatToneLabel(toneRaw)}</Pill> : null}
          {patternKey ? (
            <Pill>
              <span className="truncate" title={patternKey}>
                Pattern · {patternKey.length > 42 ? `${patternKey.slice(0, 40)}…` : patternKey}
              </span>
            </Pill>
          ) : null}
          {strategyUsed ? (
            <Pill>
              <span className="truncate" title={strategyUsed}>
                Strategy · {strategyUsed}
              </span>
            </Pill>
          ) : null}
          {hadStructured ? <Pill>Structured reply</Pill> : null}
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        {objectionPreview ? (
          <div className="relative rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] pl-4 pr-3 py-3">
            <div className="absolute left-0 top-0 h-full w-1 rounded-l-lg bg-emerald-500/50" />
            <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-400/85">
              Merchant objection
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-emerald-50/95">{objectionPreview}</p>
          </div>
        ) : null}

        <div className="max-w-2xl">
          <BodyBlocks blocks={blocks} fullText={r.content} />
        </div>
      </div>
    </article>
  );
}
