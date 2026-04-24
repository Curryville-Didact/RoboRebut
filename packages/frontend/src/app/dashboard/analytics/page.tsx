// IMPORTANT:
// Never allow server-component fetches to throw.
// Always return fallback data to prevent dashboard crashes.

import Link from "next/link";
import { API_URL } from "@/lib/env";
import { safeFetchJSON } from "@/lib/safeFetch";
import { createClient } from "@/lib/supabase/server";
import { isFounderEmail } from "@/lib/founder";
import { DashboardEmptyState, DashboardErrorPanel } from "@/components/dashboard/DashboardEmptyState";

type AnalyticsEvent = {
  eventName: string;
  timestamp?: string;
  planType?: string | null;
  triggerType?: string | null;
  tone?: string | null;
  conversationId?: string | null;
  priorityGeneration?: boolean;
  responseVariants?: number | null;
  objectionType?: string | null;
  strategyTag?: string | null;
  surface?: string | null;
  ctaLabel?: string;
  ctaGroup?: string;
  serverTimestamp: string;
};

type AnalyticsSummary = {
  totalEvents: number;
  countsByEventName: Record<string, number>;
  countsByCtaLabel: Record<string, number>;
  countsByCtaGroup: Record<string, number>;
  countsByPlanType: Record<string, number>;
};

/** Pricing surface + sign-in events (filter chips and revenue-intent context). */
const PRICING_SURFACE_EVENTS = [
  "pricing_page_view",
  "pricing_starter_click",
  "pricing_pro_click",
  "pricing_team_demo_click",
  "pricing_signin_click",
] as const;

const UPGRADE_NUDGE_EVENTS = [
  "upgrade_nudge_shown",
  "upgrade_nudge_clicked",
  "upgrade_nudge_dismissed",
] as const;

const ACTIVATION_EVENTS = [
  "response_generated",
  "priority_generation_used",
  "saved_response_created",
  "saved_response_copied",
  "review_submitted",
  "integration_created",
] as const;

function dedupeEventNamesPreserveOrder(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** Single ordered list for filter chips (no duplicates, e.g. upgrade_nudge_clicked once). */
const FOUNDER_FILTER_EVENT_NAMES = dedupeEventNamesPreserveOrder([
  ...PRICING_SURFACE_EVENTS,
  ...UPGRADE_NUDGE_EVENTS,
  ...ACTIVATION_EVENTS,
]);

async function loadAnalyticsData(suffix: string): Promise<{
  summary: AnalyticsSummary;
  events: AnalyticsEvent[];
  loadError: string | null;
}> {
  const emptySummary: AnalyticsSummary = {
    totalEvents: 0,
    countsByEventName: {},
    countsByCtaLabel: {},
    countsByCtaGroup: {},
    countsByPlanType: {},
  };

  const eventsUrl = `${API_URL}/api/analytics/events${suffix}${suffix ? "&" : "?"}limit=100`;
  const [summaryResult, eventsResult] = await Promise.all([
    safeFetchJSON<AnalyticsSummary>(
      `${API_URL}/api/analytics/summary${suffix}`,
      emptySummary
    ),
    safeFetchJSON<AnalyticsEvent[]>(eventsUrl, []),
  ]);

  return {
    summary: summaryResult.data,
    events: eventsResult.data,
    loadError: summaryResult.error ?? eventsResult.error,
  };
}

function buildQuery(searchParams: {
  eventName?: string;
  planType?: string;
  ctaGroup?: string;
  internal?: string;
}) {
  const params = new URLSearchParams();
  if (searchParams.eventName) params.set("eventName", searchParams.eventName);
  if (searchParams.planType) params.set("planType", searchParams.planType);
  if (searchParams.ctaGroup) params.set("ctaGroup", searchParams.ctaGroup);
  if (searchParams.internal) params.set("internal", searchParams.internal);
  return params.toString();
}

function FilterLink({
  label,
  href,
  active = false,
}: {
  label: string;
  href: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-md border px-2.5 py-1 text-xs transition ${
        active
          ? "border-white/40 bg-white/10 text-white"
          : "border-white/15 text-gray-400 hover:border-white/30 hover:text-white"
      }`}
    >
      {label}
    </Link>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    eventName?: string;
    planType?: string;
    ctaGroup?: string;
    internal?: string;
  }>;
}) {
  let userEmail = "";
  try {
    const supabase = await createClient();
    const result = await supabase.auth.getUser();
    userEmail = result.data.user?.email ?? "";
  } catch {
    userEmail = "";
  }

  if (!isFounderEmail(userEmail)) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Analytics</h1>
            <p className="mt-1 text-sm text-gray-400">This page is not available.</p>
          </div>
          <Link href="/dashboard" className="text-gray-400 underline hover:text-white">
            Back to conversations
          </Link>
        </div>
      </div>
    );
  }

  const params = (await searchParams) ?? {};
  const query = buildQuery(params);
  const suffix = query ? `?${query}` : "";
  const { summary, events, loadError } = await loadAnalyticsData(suffix);
  const totalSignals =
    Object.values(summary.countsByEventName ?? {}).reduce((a, b) => a + (b ?? 0), 0) ?? 0;
  const hasAnyEvents = (events?.length ?? 0) > 0 || totalSignals > 0;

  function count(name: string): number {
    return summary.countsByEventName?.[name] ?? 0;
  }

  const eventsToShow = events;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Founder Analytics</h1>
          <p className="mt-1 text-sm text-gray-400">
            Revenue intent, product activation, and plan-tagged telemetry (founder-only).
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-sm">
          <Link href="/dashboard" className="text-gray-400 underline hover:text-white">
            Back to conversations
          </Link>
        </div>
      </div>

      {loadError ? (
        <DashboardErrorPanel message="Unable to load founder analytics. Try refreshing." />
      ) : null}

      {!loadError && !hasAnyEvents ? (
        <DashboardEmptyState
          title="No founder analytics yet"
          description="Pricing, upgrade, and usage events will appear here."
        />
      ) : null}

      {hasAnyEvents ? (
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Filters</p>
          <div className="flex flex-wrap gap-2">
            <FilterLink label="All events" href="/dashboard/analytics" active={!params.eventName} />
            {FOUNDER_FILTER_EVENT_NAMES.map((eventName) => (
              <FilterLink
                key={eventName}
                label={eventName}
                href={`/dashboard/analytics?eventName=${encodeURIComponent(eventName)}`}
                active={params.eventName === eventName}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterLink label="All plans" href="/dashboard/analytics" active={!params.planType} />
            {["free", "starter", "pro", "team"].map((planType, index) => (
              <FilterLink
                key={`${planType}-${index}`}
                label={planType}
                href={`/dashboard/analytics?planType=${planType}`}
                active={params.planType === planType}
              />
            ))}
          </div>
        </div>
      ) : null}

      {hasAnyEvents ? (
        <>
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
                Revenue funnel
              </h2>
              <p className="mt-1 max-w-3xl text-xs text-gray-500">
                Named conversion-intent events only: pricing page views and pricing CTAs, plus
                in-app upgrade-nudge clicks. Counts are not inferred from generic plan-tagged
                activity elsewhere in the product.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {[
                ["Pricing views", "pricing_page_view"],
                ["Starter clicks", "pricing_starter_click"],
                ["Pro clicks", "pricing_pro_click"],
                ["Team demo clicks", "pricing_team_demo_click"],
                ["Sign-in clicks", "pricing_signin_click"],
                ["Upgrade clicks", "upgrade_nudge_clicked"],
              ].map(([label, key]) => (
                <div key={key} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{count(key)}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <div>
                <div className="text-sm font-semibold">True plan interest (pricing CTAs)</div>
                <p className="mt-1 text-xs text-gray-500">
                  Counts from pricing_starter_click, pricing_pro_click, and pricing_team_demo_click
                  only—real buyer intent on the pricing page, not total events that carry a plan tag.
                </p>
              </div>
              <div className="space-y-2 text-sm">
                {[
                  ["starter", "pricing_starter_click"],
                  ["pro", "pricing_pro_click"],
                  ["team", "pricing_team_demo_click"],
                ].map(([label, key]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-gray-300">{label}</span>
                    <span className="text-white">{count(key)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <div>
                <div className="text-sm font-semibold">In-app upgrade nudge</div>
                <p className="mt-1 text-xs text-gray-500">
                  Lifecycle for the upgrade prompt in the product (shown, clicked, dismissed).
                </p>
              </div>
              <div className="space-y-2 text-sm">
                {[
                  ["shown", "upgrade_nudge_shown"],
                  ["clicked", "upgrade_nudge_clicked"],
                  ["dismissed", "upgrade_nudge_dismissed"],
                ].map(([label, key]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-gray-300">{label}</span>
                    <span className="text-white">{count(key)}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
            <div>
              <div className="text-sm font-semibold">Activation signals</div>
              <p className="mt-1 text-xs text-gray-500">
                In-app usage and outcomes—not pricing or nudge telemetry.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {[
                ["Responses generated", "response_generated"],
                ["Priority generation used", "priority_generation_used"],
                ["Saved responses created", "saved_response_created"],
                ["Saved responses copied", "saved_response_copied"],
                ["Reviews submitted", "review_submitted"],
                ["Integrations created", "integration_created"],
              ].map(([label, key]) => (
                <div key={key} className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-xs text-gray-500">{label}</div>
                  <div className="mt-1 text-xl font-semibold text-white">{count(key)}</div>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
            Telemetry and support
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-gray-500">
            Aggregated labels and plan tags across all tracked events—useful for debugging and
            support, not a substitute for the revenue funnel or true pricing CTA interest above.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="text-sm font-medium text-white">Clicks by CTA Label</h2>
          <div className="mt-3 space-y-2 text-sm">
            {Object.entries(summary.countsByCtaLabel).length === 0 ? (
              <p className="text-gray-500">No CTA clicks yet.</p>
            ) : (
              Object.entries(summary.countsByCtaLabel)
                .sort((a, b) => b[1] - a[1])
                .map(([label, count], index) => (
                  <div key={`${label}-${index}`} className="flex items-center justify-between gap-3">
                    <span className="text-gray-300">{label}</span>
                    <span className="text-white">{count}</span>
                  </div>
                ))
            )}
          </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="text-sm font-medium text-white">Clicks by CTA Group</h2>
          <div className="mt-3 space-y-2 text-sm">
            {Object.entries(summary.countsByCtaGroup).length === 0 ? (
              <p className="text-gray-500">No grouped CTA events yet.</p>
            ) : (
              Object.entries(summary.countsByCtaGroup)
                .sort((a, b) => b[1] - a[1])
                .map(([group, count], index) => (
                  <div key={`${group}-${index}`} className="flex items-center justify-between gap-3">
                    <span className="text-gray-300">{group}</span>
                    <span className="text-white">{count}</span>
                  </div>
                ))
            )}
          </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="text-sm font-medium text-white">Event volume by plan tag</h2>
          <p className="mt-1 text-xs text-gray-500">
            All events that included a plan tag (any surface)—not buyer intent.
          </p>
          <div className="mt-3 space-y-2 text-sm">
            {Object.entries(summary.countsByPlanType).length === 0 ? (
              <p className="text-gray-500">No plan-tagged events yet.</p>
            ) : (
              Object.entries(summary.countsByPlanType)
                .sort((a, b) => b[1] - a[1])
                .map(([planType, count], index) => (
                  <div key={`${planType}-${index}`} className="flex items-center justify-between gap-3">
                    <span className="text-gray-300">{planType}</span>
                    <span className="text-white">{count}</span>
                  </div>
                ))
            )}
          </div>
          </div>
        </div>
      </section>

      {hasAnyEvents ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
            Recent founder events
          </h2>
          {eventsToShow.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-sm text-gray-400">
              No founder analytics events captured yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="min-w-full divide-y divide-white/10 text-left text-sm">
                <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-2">timestamp</th>
                    <th className="px-3 py-2">event</th>
                    <th className="px-3 py-2">plan</th>
                    <th className="px-3 py-2">surface</th>
                    <th className="px-3 py-2">cta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {eventsToShow.slice(0, 40).map((event, index) => (
                    <tr key={`${event.serverTimestamp}-${index}`} className="align-top">
                      <td className="px-3 py-2 text-gray-400">
                        {new Date(event.serverTimestamp).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-white">{event.eventName}</td>
                      <td className="px-3 py-2 text-gray-300">{event.planType ?? "-"}</td>
                      <td className="px-3 py-2 text-gray-300">{event.surface ?? "-"}</td>
                      <td className="px-3 py-2 text-gray-300">{event.ctaLabel ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
