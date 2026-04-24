"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { API_URL } from "@/lib/env";
import { RebutBrandLogo } from "@/components/brand/RebutBrandLogo";
import { DashboardEmptyState } from "@/components/dashboard/DashboardEmptyState";
import { SavedResponseCard } from "@/components/dashboard/SavedResponseCard";
import { MSG_SAVED_LOAD, MSG_SESSION } from "@/lib/userFacingErrors";
import { trackEvent } from "@/lib/trackEvent";
import { isFounderEmail } from "@/lib/founder";
import { DEMO_SAVED_RESPONSES } from "@/lib/demoFixtures";
import {
  applySavedResponseFilters,
  defaultSavedResponseFilters,
  deriveFilterOptionSets,
  deriveSavedResponseFilterView,
  type SavedResponseFilterState,
} from "@/lib/savedResponseFilterModel";

interface SavedResponse {
  id: string;
  label: string;
  content: string;
  category: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
}

const SESSION_MAX_ATTEMPTS = 5;
const SESSION_RETRY_DELAY_MS = 200;

async function waitForSessionAccessToken(): Promise<string | null> {
  const supabase = createClient();
  for (let attempt = 1; attempt <= SESSION_MAX_ATTEMPTS; attempt++) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? null;
    if (token) return token;
    if (attempt < SESSION_MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, SESSION_RETRY_DELAY_MS));
    }
  }
  return null;
}

export default function SavedResponsesPage() {
  const mountedRef = useRef(true);

  const [responses, setResponses] = useState<SavedResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [isFounder, setIsFounder] = useState(false);
  const [filters, setFilters] = useState<SavedResponseFilterState>(() =>
    defaultSavedResponseFilters()
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getUser().then((res) => {
      if (!mountedRef.current) return;
      setIsFounder(isFounderEmail(res.data.user?.email ?? ""));
    });
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      setDemoMode(p.get("demo") === "1");
    }
  }, []);

  const loadSavedResponses = useCallback(async () => {
    if (demoMode && isFounder) {
      setResponses(
        DEMO_SAVED_RESPONSES.map((r) => ({
          id: r.id,
          label: r.label,
          content: r.content,
          category: r.category,
          created_at: r.created_at,
          metadata: r.metadata ?? null,
        }))
      );
      setLoading(false);
      setError(null);
      return;
    }
    const token = await waitForSessionAccessToken();
    if (!mountedRef.current) return;
    if (!token) {
      setError(MSG_SESSION);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/saved-responses`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        void res.json().catch(() => null);
        if (mountedRef.current) setError(MSG_SAVED_LOAD);
        return;
      }

      const data = (await res.json()) as SavedResponse[];
      if (mountedRef.current) {
        setError(null);
        setResponses(Array.isArray(data) ? data : []);
      }
    } catch {
      if (mountedRef.current) {
        setError(MSG_SAVED_LOAD);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [demoMode, isFounder]);

  useEffect(() => {
    void loadSavedResponses();
  }, [loadSavedResponses]);

  const filterViews = useMemo(
    () => responses.map((r) => deriveSavedResponseFilterView(r)),
    [responses]
  );

  const filterOptions = useMemo(() => deriveFilterOptionSets(filterViews), [filterViews]);

  const displayedResponses = useMemo(
    () => applySavedResponseFilters(responses, filters),
    [responses, filters]
  );

  const filtersActive =
    filters.textQuery.trim().length > 0 ||
    filters.category !== "" ||
    filters.objectionType !== "" ||
    filters.tone !== "" ||
    filters.strategy !== "" ||
    filters.structuredReply !== "all";

  function clearFilters() {
    setFilters(defaultSavedResponseFilters());
  }

  async function handleDelete(id: string) {
    const token = await waitForSessionAccessToken();
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/api/saved-responses/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok && mountedRef.current) {
        setResponses((prev) => prev.filter((r) => r.id !== id));
      }
    } catch {
      /* ignore — item stays in list */
    }
  }

  async function handleCopy(content: string, id: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(id);
      trackEvent({
        eventName: "saved_response_copied",
        surface: "saved",
        planType: null,
        metadata: { route: "/dashboard/saved" },
      });
      setTimeout(() => {
        if (mountedRef.current) setCopied(null);
      }, 1500);
    } catch {
      /* ignore clipboard errors */
    }
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">Saved Responses</h2>
        <p className="mt-1 text-sm text-gray-500">
          Reusable rebuttals from your strongest coaching turns.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100/90">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : responses.length === 0 ? (
        <DashboardEmptyState
          title="No saved responses yet"
          description="Save your strongest rebuttals here so they’re ready when you need them."
          logo={<RebutBrandLogo variant="pro" className="h-10 w-10 opacity-80" />}
        >
          <Link
            href="/dashboard"
            className="rounded-lg border border-white/20 bg-white/[0.08] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.12]"
          >
            Start a conversation
          </Link>
        </DashboardEmptyState>
      ) : (
        <>
          <div className="rounded-xl border border-white/[0.08] bg-black/25 p-4 space-y-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
              <label className="flex min-w-[180px] flex-1 flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  Search
                </span>
                <input
                  type="search"
                  value={filters.textQuery}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, textQuery: e.target.value }))
                  }
                  placeholder="Search saved text…"
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-gray-600 outline-none ring-emerald-500/30 focus:ring-2"
                />
              </label>

              <label className="flex min-w-[140px] flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  Category
                </span>
                <select
                  value={filters.category}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, category: e.target.value }))
                  }
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none ring-emerald-500/30 focus:ring-2"
                >
                  <option value="">All</option>
                  {filterOptions.categories.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex min-w-[140px] flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  Objection type
                </span>
                <select
                  value={filters.objectionType}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, objectionType: e.target.value }))
                  }
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none ring-emerald-500/30 focus:ring-2"
                >
                  <option value="">All</option>
                  {filterOptions.objectionTypes.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex min-w-[120px] flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  Tone
                </span>
                <select
                  value={filters.tone}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, tone: e.target.value }))
                  }
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none ring-emerald-500/30 focus:ring-2"
                >
                  <option value="">All</option>
                  {filterOptions.tones.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex min-w-[140px] flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  Strategy
                </span>
                <select
                  value={filters.strategy}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, strategy: e.target.value }))
                  }
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none ring-emerald-500/30 focus:ring-2"
                >
                  <option value="">All</option>
                  {filterOptions.strategies.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex min-w-[160px] flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  Structured reply
                </span>
                <select
                  value={filters.structuredReply}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      structuredReply: e.target.value as SavedResponseFilterState["structuredReply"],
                    }))
                  }
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none ring-emerald-500/30 focus:ring-2"
                >
                  <option value="all">All</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>

              <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
                <button
                  type="button"
                  onClick={clearFilters}
                  disabled={!filtersActive}
                  className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-medium text-gray-200 transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear filters
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Showing {displayedResponses.length} of {responses.length}
            </p>
          </div>

          {displayedResponses.length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-gray-400">
              No saved responses match your filters.
            </p>
          ) : (
            <div className="space-y-5">
              {displayedResponses.map((r) => (
                <SavedResponseCard
                  key={r.id}
                  r={r}
                  copiedId={copied}
                  onCopy={handleCopy}
                  onDelete={handleDelete}
                  formatDate={formatDate}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
