"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { API_URL } from "@/lib/env";
import { DashboardEmptyState, DashboardErrorPanel } from "@/components/dashboard/DashboardEmptyState";
import { MSG_REVIEW_LOAD, MSG_SESSION } from "@/lib/userFacingErrors";
import { isFounderEmail } from "@/lib/founder";
import { trackEvent } from "@/lib/trackEvent";
import { DEMO_CONVERSATIONS, DEMO_THREADS } from "@/lib/demoFixtures";

type ReviewOutcomeTag =
  | "strong"
  | "weak"
  | "repetitive"
  | "missed_context"
  | "missed_family"
  | "not_sure";

type RebuttalReview = {
  id: string;
  rebuttal_event_id: string;
  user_id: string;
  rating: number;
  outcome_tag: string | null;
  disposition?: string | null;
  structured_tags?: string[] | null;
  notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

type RebuttalEventRow = {
  id: string;
  created_at: string;
  conversation_id: string | null;
  source_mode: string;
  source_surface: string | null;
  merchant_message: string | null;
  final_live_script: string | null;
  objection_family: string | null;
  objection_type: string | null;
  tone_mode: string | null;
  rhetorical_type: string | null;
  situation_label: string | null;
  review: RebuttalReview | null;
};

type ListResponse = {
  items: RebuttalEventRow[];
  nextCursor: string | null;
};

const FILTER_SELECT =
  "rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-gray-200";
const CARD =
  "rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:bg-white/[0.05] transition";

const OUTCOME_OPTIONS: { id: ReviewOutcomeTag; label: string }[] = [
  { id: "strong", label: "Strong" },
  { id: "weak", label: "Weak" },
  { id: "repetitive", label: "Repetitive" },
  { id: "missed_context", label: "Missed context" },
  { id: "missed_family", label: "Missed family" },
  { id: "not_sure", label: "Not sure" },
];

const STRUCTURED_TAGS = [
  "wrong_tone",
  "too_long",
  "not_direct_enough",
  "wrong_assumption",
  "missed_context",
  "repetitive",
  "weak_close",
  "good_fit",
  "strong_delivery",
] as const;
type StructuredTag = (typeof STRUCTURED_TAGS)[number];

async function waitForSessionAccessToken(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function formatTs(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

export default function IntelligenceReviewPage() {
  const [items, setItems] = useState<RebuttalEventRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [isFounder, setIsFounder] = useState(false);

  const [sourceMode, setSourceMode] = useState<string>("");
  const [objectionFamily, setObjectionFamily] = useState<string>("");
  const [toneMode, setToneMode] = useState<string>("");
  const [rhetoricalType, setRhetoricalType] = useState<string>("");
  const [reviewStatus, setReviewStatus] = useState<string>("");
  const [reviewDisposition, setReviewDisposition] = useState<string>("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId]
  );

  const [draftRating, setDraftRating] = useState<number>(3);
  const [draftOutcome, setDraftOutcome] = useState<ReviewOutcomeTag>("not_sure");
  const [draftDisposition, setDraftDisposition] = useState<string>(""); // strong|weak|missed|cleared
  const [draftTags, setDraftTags] = useState<StructuredTag[]>([]);
  const [draftNotes, setDraftNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selected) return;
    const r = selected.review;
    setDraftRating(r?.rating ?? 3);
    setDraftOutcome(((r?.outcome_tag as ReviewOutcomeTag) ?? "not_sure") as ReviewOutcomeTag);
    setDraftDisposition((r?.disposition ?? "") as string);
    setDraftTags(
      Array.isArray(r?.structured_tags)
        ? (r!.structured_tags!.filter((t) =>
            STRUCTURED_TAGS.includes(t as StructuredTag)
          ) as StructuredTag[])
        : []
    );
    setDraftNotes(r?.notes ?? "");
  }, [selected]);

  const buildQuery = useCallback(
    (cursor?: string | null) => {
      const params = new URLSearchParams();
      params.set("limit", "50");
      if (cursor) params.set("cursor", cursor);
      if (sourceMode) params.set("source_mode", sourceMode);
      if (objectionFamily) params.set("objection_family", objectionFamily);
      if (toneMode) params.set("tone_mode", toneMode);
      if (rhetoricalType) params.set("rhetorical_type", rhetoricalType);
      if (reviewStatus) params.set("review_status", reviewStatus);
      if (reviewDisposition) params.set("review_disposition", reviewDisposition);
      return params.toString();
    },
    [sourceMode, objectionFamily, toneMode, rhetoricalType, reviewStatus, reviewDisposition]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setSelectedId(null);
    try {
      const token = await waitForSessionAccessToken();
      if (!token) {
        setLoadError(MSG_SESSION);
        return;
      }
      if (demoMode && isFounder) {
        const itemsDemo: RebuttalEventRow[] = Object.entries(DEMO_THREADS).map(([id, msgs], i) => ({
          id: `demo_event_${i}`,
          created_at: msgs[0]?.created_at ?? new Date().toISOString(),
          conversation_id: id,
          source_mode: "live",
          source_surface: "demo",
          merchant_message: msgs.find((m) => m.role === "user")?.content ?? null,
          final_live_script: msgs.find((m) => m.role === "ai")?.content ?? null,
          objection_family: i === 0 ? "cash_flow" : i === 1 ? "stall" : "trust",
          objection_type: i === 0 ? "cash_flow" : i === 1 ? "stall" : "trust",
          tone_mode: i === 2 ? "empathetic" : "direct",
          rhetorical_type: "control_question",
          situation_label: null,
          review:
            i === 0
              ? ({
                  id: "demo_review_1",
                  rebuttal_event_id: `demo_event_${i}`,
                  user_id: "demo",
                  rating: 5,
                  outcome_tag: "strong",
                  disposition: "strong",
                  structured_tags: ["good_fit"],
                  notes: null,
                  reviewed_at: new Date().toISOString(),
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                } as RebuttalReview)
              : null,
        }));
        setItems(itemsDemo);
        setNextCursor(null);
        return;
      }
      const res = await fetch(`${API_URL}/api/rebuttal-events?${buildQuery(null)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as ListResponse & { error?: string };
      if (!res.ok) {
        void body;
        setLoadError(MSG_REVIEW_LOAD);
        return;
      }
      setItems(body.items ?? []);
      setNextCursor(body.nextCursor ?? null);
    } catch {
      setLoadError(MSG_REVIEW_LOAD);
    } finally {
      setLoading(false);
    }
  }, [buildQuery, demoMode, isFounder]);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getUser().then((res) => {
      setIsFounder(isFounderEmail(res.data.user?.email ?? ""));
    });
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      setDemoMode(p.get("demo") === "1");
    }
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const token = await waitForSessionAccessToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/rebuttal-events?${buildQuery(nextCursor)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as ListResponse & { error?: string };
      if (!res.ok) return;
      setItems((prev) => [...prev, ...(body.items ?? [])]);
      setNextCursor(body.nextCursor ?? null);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, buildQuery]);

  const saveReview = useCallback(async () => {
    if (!selected || saving) return;
    setSaving(true);
    setActionError(null);
    try {
      const token = await waitForSessionAccessToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/rebuttal-reviews`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          rebuttal_event_id: selected.id,
          rating: draftRating,
          outcome_tag: draftOutcome,
          disposition: draftDisposition || null,
          structured_tags: draftTags.length ? draftTags : null,
          notes: draftNotes || null,
        }),
      });
      const body = (await res.json()) as { ok?: boolean; review?: RebuttalReview; error?: string };
      if (!res.ok || !body.ok || !body.review) {
        void body;
        setActionError("Couldn’t update review. Try again.");
        return;
      }
      trackEvent({ eventName: "review_submitted", surface: "review", planType: null, metadata: { route: "/dashboard/intelligence/review" } });
      setItems((prev) =>
        prev.map((it) => (it.id === selected.id ? { ...it, review: body.review! } : it))
      );
    } finally {
      setSaving(false);
    }
  }, [selected, saving, draftRating, draftOutcome, draftDisposition, draftTags, draftNotes]);

  const clearReview = useCallback(async () => {
    if (!selected || saving) return;
    setSaving(true);
    setActionError(null);
    try {
      const token = await waitForSessionAccessToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/rebuttal-reviews`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          rebuttal_event_id: selected.id,
          clear: true,
        }),
      });
      const body = (await res.json()) as { ok?: boolean; cleared?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        void body;
        setActionError("Couldn’t update review. Try again.");
        return;
      }
      setItems((prev) =>
        prev.map((it) => (it.id === selected.id ? { ...it, review: null } : it))
      );
    } finally {
      setSaving(false);
    }
  }, [selected, saving]);

  const selectNextUnreviewed = useCallback(() => {
    const idx = items.findIndex((i) => i.id === selectedId);
    const after = idx >= 0 ? items.slice(idx + 1) : items;
    const next = after.find((i) => !i.review) ?? items.find((i) => !i.review) ?? null;
    if (next) setSelectedId(next.id);
  }, [items, selectedId]);

  const applyQuickAction = useCallback(
    (action: "strong" | "weak" | "missed") => {
      if (action === "strong") {
        setDraftDisposition("strong");
        setDraftOutcome("strong");
        setDraftRating(5);
        setDraftTags((prev) => prev.filter((t) => t !== "missed_context" && t !== "weak_close"));
      } else if (action === "weak") {
        setDraftDisposition("weak");
        setDraftOutcome("weak");
        setDraftRating(2);
      } else {
        setDraftDisposition("missed");
        setDraftOutcome("missed_context");
        setDraftRating(2);
        setDraftTags((prev) =>
          prev.includes("missed_context") ? prev : [...prev, "missed_context"]
        );
      }
    },
    []
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!selected) return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase() ?? "";
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "1") {
        applyQuickAction("weak");
        void saveReview().then(() => selectNextUnreviewed());
      }
      if (e.key === "2") {
        applyQuickAction("missed");
        void saveReview().then(() => selectNextUnreviewed());
      }
      if (e.key === "3") {
        applyQuickAction("strong");
        void saveReview().then(() => selectNextUnreviewed());
      }
      if (e.key.toLowerCase() === "n") {
        selectNextUnreviewed();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, applyQuickAction, saveReview, selectNextUnreviewed]);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight text-white">Review</h2>
          <p className="text-sm text-gray-500">
            Review captured Live rebuttals and mark quality. This does not affect Live behavior.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-sm text-gray-400 underline hover:text-white"
        >
          Back to conversations
        </Link>
      </div>

      {!loadError ? (
      <div className="flex flex-wrap gap-2">
        <select className={FILTER_SELECT} value={sourceMode} onChange={(e) => setSourceMode(e.target.value)}>
          <option value="">All modes</option>
          <option value="live">Live</option>
          <option value="precall_instant">Precall instant</option>
          <option value="precall_deep">Precall deep</option>
        </select>
        <input
          className={`${FILTER_SELECT} w-44`}
          placeholder="Family (exact)"
          value={objectionFamily}
          onChange={(e) => setObjectionFamily(e.target.value)}
        />
        <input
          className={`${FILTER_SELECT} w-44`}
          placeholder="Tone (exact)"
          value={toneMode}
          onChange={(e) => setToneMode(e.target.value)}
        />
        <input
          className={`${FILTER_SELECT} w-44`}
          placeholder="Rhetorical (exact)"
          value={rhetoricalType}
          onChange={(e) => setRhetoricalType(e.target.value)}
        />
        <select className={FILTER_SELECT} value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)}>
          <option value="">All</option>
          <option value="reviewed">Reviewed</option>
          <option value="unreviewed">Unreviewed</option>
        </select>
        <select
          className={FILTER_SELECT}
          value={reviewDisposition}
          onChange={(e) => setReviewDisposition(e.target.value)}
        >
          <option value="">All dispositions</option>
          <option value="strong">strong</option>
          <option value="weak">weak</option>
          <option value="missed">missed</option>
        </select>
        <button
          onClick={() => void load()}
          className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-gray-200 hover:bg-white/[0.06]"
        >
          Apply
        </button>
      </div>
      ) : null}

      {loadError ? (
        <DashboardErrorPanel message={loadError} onRetry={() => void load()} retryLabel="Try again" />
      ) : null}

      {actionError ? (
        <div className="rounded-lg border border-amber-500/25 bg-amber-950/20 px-4 py-3 text-sm text-amber-100/90">
          {actionError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]">
        <div className="space-y-3">
          {loading ? (
            <div className="text-sm text-gray-500">Loading…</div>
          ) : loadError ? null : items.length === 0 ? (
            <DashboardEmptyState
              title="No captured rebuttals yet"
              description="Use RoboRebut during a call to start building review data."
            />
          ) : (
            <>
              {items.map((it) => {
                const active = it.id === selectedId;
                return (
                  <button
                    key={it.id}
                    onClick={() => setSelectedId(it.id)}
                    className={`${CARD} text-left ${active ? "border-emerald-500/30 bg-emerald-500/[0.06]" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-gray-500">{formatTs(it.created_at)}</div>
                      <div className="text-[11px] text-gray-500">
                        {it.review ? `Reviewed (${it.review.rating}/5)` : "Unreviewed"}
                      </div>
                    </div>
                    <div className="mt-2 text-sm text-gray-200">
                      {it.merchant_message ?? <span className="text-gray-500">No merchant message</span>}
                    </div>
                    <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2 text-sm text-white">
                      {it.final_live_script ?? <span className="text-gray-500">No final script</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-500">
                      {it.objection_family ? <span>family: {it.objection_family}</span> : null}
                      {it.tone_mode ? <span>tone: {it.tone_mode}</span> : null}
                      {it.rhetorical_type ? <span>shape: {it.rhetorical_type}</span> : null}
                    </div>
                  </button>
                );
              })}
              {nextCursor ? (
                <button
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-gray-200 hover:bg-white/[0.06] disabled:opacity-60"
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              ) : null}
            </>
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-semibold">Review</div>
            {!selected ? (
              <div className="mt-2 text-sm text-gray-500">Select an event to review.</div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="text-xs text-gray-500">{formatTs(selected.created_at)}</div>
                <div className="text-sm text-gray-200">{selected.merchant_message ?? ""}</div>
                <div className="rounded-lg border border-white/10 bg-black/20 p-2 text-sm text-white">
                  {selected.final_live_script ?? ""}
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-500">
                  <div>family: {selected.objection_family ?? "—"}</div>
                  <div>shape: {selected.rhetorical_type ?? "—"}</div>
                  <div>tone: {selected.tone_mode ?? "—"}</div>
                  <div>mode: {selected.source_mode}</div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-gray-400">Quick actions</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        applyQuickAction("strong");
                        void saveReview().then(() => selectNextUnreviewed());
                      }}
                      className="rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-1 text-xs font-medium text-emerald-100 hover:bg-emerald-500/20"
                    >
                      Strong (3)
                    </button>
                    <button
                      onClick={() => {
                        applyQuickAction("missed");
                        void saveReview().then(() => selectNextUnreviewed());
                      }}
                      className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-100 hover:bg-amber-500/15"
                    >
                      Needs work (2)
                    </button>
                    <button
                      onClick={() => {
                        applyQuickAction("weak");
                        void saveReview().then(() => selectNextUnreviewed());
                      }}
                      className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-100 hover:bg-red-500/15"
                    >
                      Weak (1)
                    </button>
                    <button
                      onClick={() => selectNextUnreviewed()}
                      className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-gray-200 hover:bg-white/[0.06]"
                    >
                      Next unreviewed (N)
                    </button>
                    <button
                      onClick={() => void clearReview().then(() => selectNextUnreviewed())}
                      className="rounded-md border border-white/10 bg-transparent px-2 py-1 text-xs text-gray-400 hover:bg-white/[0.04]"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="text-[11px] text-gray-600">
                    Shortcuts: 1=Weak, 2=Needs work, 3=Strong, N=Next
                  </div>
                </div>

                {(draftDisposition === "weak" || draftDisposition === "missed") ? (
                  <div className="space-y-2">
                    <div className="text-xs text-gray-400">Structured tags</div>
                    <div className="flex flex-wrap gap-2">
                      {STRUCTURED_TAGS.map((tag) => {
                        const active = draftTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            onClick={() =>
                              setDraftTags((prev) =>
                                prev.includes(tag)
                                  ? prev.filter((t) => t !== tag)
                                  : [...prev, tag]
                              )
                            }
                            className={`rounded-full border px-2 py-1 text-[11px] ${
                              active
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                                : "border-white/10 bg-white/[0.03] text-gray-300 hover:bg-white/[0.05]"
                            }`}
                          >
                            {tag}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <div className="text-xs text-gray-400">Rating</div>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => setDraftRating(n)}
                        className={`rounded-md border px-2 py-1 text-xs ${
                          draftRating === n
                            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-100"
                            : "border-white/10 bg-white/[0.04] text-gray-200 hover:bg-white/[0.06]"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-gray-400">Outcome tag</div>
                  <select
                    className={`${FILTER_SELECT} w-full`}
                    value={draftOutcome}
                    onChange={(e) => setDraftOutcome(e.target.value as ReviewOutcomeTag)}
                  >
                    {OUTCOME_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-gray-400">Disposition</div>
                  <select
                    className={`${FILTER_SELECT} w-full`}
                    value={draftDisposition}
                    onChange={(e) => setDraftDisposition(e.target.value)}
                  >
                    <option value="">—</option>
                    <option value="strong">strong</option>
                    <option value="weak">weak</option>
                    <option value="missed">missed</option>
                    <option value="cleared">cleared</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-gray-400">Notes</div>
                  <textarea
                    value={draftNotes}
                    onChange={(e) => setDraftNotes(e.target.value)}
                    rows={4}
                    className="w-full rounded-md border border-white/10 bg-black/30 p-2 text-sm text-gray-100 outline-none focus:border-emerald-500/40"
                    placeholder="Optional notes…"
                  />
                </div>

                <button
                  onClick={() => void saveReview()}
                  disabled={saving}
                  className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save review"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

