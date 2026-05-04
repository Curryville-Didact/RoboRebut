// IMPORTANT:
// Never allow server-component fetches to throw.
// Always return fallback data to prevent dashboard crashes.

import Link from "next/link";
import { API_URL } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { isFounderEmail } from "@/lib/founder";
import { DashboardEmptyState, DashboardErrorPanel } from "@/components/dashboard/DashboardEmptyState";
import { FounderOperationsSnapshot } from "@/components/dashboard/FounderOperationsSnapshot";

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
  metadata?: Record<string, unknown>;
  serverTimestamp: string;
};

function readMetadataString(
  metadata: Record<string, unknown> | undefined,
  keys: string[]
): string | null {
  if (!metadata) return null;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function safeRate(n: number, d: number): number | null {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return null;
  return n / d;
}

function formatPercent(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return "\u2014";
  const pct = Math.max(0, Math.min(1, rate)) * 100;
  const digits = pct >= 10 ? 0 : 1;
  return `${pct.toFixed(digits)}%`;
}

function countByKey(
  events: AnalyticsEvent[],
  getKey: (e: AnalyticsEvent) => string | null
): Array<{ key: string; count: number }> {
  const m = new Map<string, number>();
  for (const e of events) {
    const k = getKey(e);
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

type HighIntentFlag = {
  userEmail: string | null;
  userId: string | null;
  signal: string;
  evidenceCount: number;
  actionLabel: string;
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
  "signup_page_view",
  "login_page_view",
  "account_created",
  "login_success",
  "dashboard_view",
  "first_conversation_created",
  "first_objection_submitted",
  "first_response_generated",
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

async function loadAnalyticsData(
  suffix: string,
  token?: string
): Promise<{
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

  const fetchOne = async <T,>(
    url: string,
    fallback: T
  ): Promise<{ data: T; error: string | null }> => {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        ...(token
          ? { headers: { Authorization: `Bearer ${token}` } }
          : {}),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = (await res.json()) as T;
      return { data, error: null };
    } catch (err) {
      return {
        data: fallback,
        error:
          err instanceof Error ? err.message : "Data temporarily unavailable",
      };
    }
  };

  const [summaryResult, eventsResult] = await Promise.all([
    fetchOne(`${API_URL}/api/analytics/summary${suffix}`, emptySummary),
    fetchOne(eventsUrl, []),
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

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const analyticsAccessToken = session?.access_token;

  const params = (await searchParams) ?? {};
  const query = buildQuery(params);
  const suffix = query ? `?${query}` : "";
  const { summary, events, loadError } = await loadAnalyticsData(
    suffix,
    analyticsAccessToken
  );
  const totalSignals =
    Object.values(summary.countsByEventName ?? {}).reduce((a, b) => a + (b ?? 0), 0) ?? 0;
  const hasAnyEvents = (events?.length ?? 0) > 0 || totalSignals > 0;

  function count(name: string): number {
    return summary.countsByEventName?.[name] ?? 0;
  }

  const eventsToShow = events;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="sticky top-0 z-20 -mx-8 border-b border-white/10 bg-black/80 px-8 py-6 backdrop-blur supports-[backdrop-filter]:bg-black/60">
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

      <FounderOperationsSnapshot apiBase={API_URL} />

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

          <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
            <div>
              <div className="text-sm font-semibold">Activation funnel</div>
              <p className="mt-1 text-xs text-gray-500">
                Explicit funnel events only. Drop-off from previous step. No inference from generic plan tags.
              </p>
            </div>
            {(() => {
              const rows: Array<{ label: string; key: string; count: number; prev: number | null }> = [
                { label: "Signup page views", key: "signup_page_view", count: count("signup_page_view"), prev: null },
                { label: "Accounts created", key: "account_created", count: count("account_created"), prev: count("signup_page_view") },
                { label: "Login successes", key: "login_success", count: count("login_success"), prev: count("account_created") },
                { label: "Dashboard views", key: "dashboard_view", count: count("dashboard_view"), prev: count("login_success") },
                { label: "First conversations", key: "first_conversation_created", count: count("first_conversation_created"), prev: count("dashboard_view") },
                { label: "First objections submitted", key: "first_objection_submitted", count: count("first_objection_submitted"), prev: count("first_conversation_created") },
                { label: "First responses generated", key: "first_response_generated", count: count("first_response_generated"), prev: count("first_objection_submitted") },
              ];

              return (
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="min-w-full divide-y divide-white/10 text-left text-sm">
                    <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-3 py-2">step</th>
                        <th className="px-3 py-2">count</th>
                        <th className="px-3 py-2">conversion</th>
                        <th className="px-3 py-2">drop-off</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {rows.map((r) => {
                        const conv = r.prev == null ? null : safeRate(r.count, r.prev);
                        const drop = r.prev == null ? null : safeRate(Math.max(0, r.prev - r.count), r.prev);
                        return (
                          <tr key={r.key} className="align-top">
                            <td className="px-3 py-2 text-white">{r.label}</td>
                            <td className="px-3 py-2 text-gray-300">{r.count.toLocaleString()}</td>
                            <td className="px-3 py-2 text-gray-300">{formatPercent(conv)}</td>
                            <td className="px-3 py-2 text-gray-300">{formatPercent(drop)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
                Monetization Intelligence
              </h2>
              <p className="mt-1 max-w-3xl text-xs text-gray-500">
                Conversion metrics. Explicit funnel events only. Drop-off from previous step. No inference from generic plan tags.
              </p>
            </div>

            {(() => {
              const pricingViews = count("pricing_page_view");
              const starterClicks = count("pricing_starter_click");
              const proClicks = count("pricing_pro_click");
              const teamDemoClicks = count("pricing_team_demo_click");
              const signinClicks = count("pricing_signin_click");
              const pricingClicksTotal = starterClicks + proClicks + teamDemoClicks;

              const upgradeNudgeShown = count("upgrade_nudge_shown");
              const upgradeNudgeClicked = count("upgrade_nudge_clicked");
              const upgradeNudgeDismissed = count("upgrade_nudge_dismissed");

              const pricingViewToClickRate = safeRate(pricingClicksTotal, pricingViews);
              const clickToSigninRate = safeRate(signinClicks, pricingClicksTotal);
              const upgradeNudgeClickRate = safeRate(upgradeNudgeClicked, upgradeNudgeShown);
              const upgradeNudgeDismissRate = safeRate(upgradeNudgeDismissed, upgradeNudgeShown);

              const dropoffRows: Array<{
                label: string;
                count: number;
                prev: number | null;
              }> = [
                { label: "Pricing Page View", count: pricingViews, prev: null },
                { label: "Plan CTA Click", count: pricingClicksTotal, prev: pricingViews },
                { label: "Sign-in Click", count: signinClicks, prev: pricingClicksTotal },
                { label: "Upgrade Nudge Shown", count: upgradeNudgeShown, prev: signinClicks },
                { label: "Upgrade Nudge Clicked", count: upgradeNudgeClicked, prev: upgradeNudgeShown },
              ];

              const planRows = [
                { label: "Starter", event: "pricing_starter_click", count: starterClicks },
                { label: "Pro", event: "pricing_pro_click", count: proClicks },
                { label: "Team", event: "pricing_team_demo_click", count: teamDemoClicks },
              ];

              const revenueIntentEvents = eventsToShow.filter((e) =>
                [
                  "pricing_page_view",
                  "pricing_starter_click",
                  "pricing_pro_click",
                  "pricing_team_demo_click",
                  "pricing_signin_click",
                  "upgrade_nudge_shown",
                  "upgrade_nudge_clicked",
                  "upgrade_nudge_dismissed",
                ].includes(e.eventName)
              );

              const surfaces = countByKey(revenueIntentEvents, (e) =>
                typeof e.surface === "string" && e.surface.trim() ? e.surface.trim() : null
              ).slice(0, 10);

              const ctaLabels = countByKey(revenueIntentEvents, (e) =>
                typeof e.ctaLabel === "string" && e.ctaLabel.trim() ? e.ctaLabel.trim() : null
              ).slice(0, 10);

              const perUser = new Map<
                string,
                {
                  userEmail: string | null;
                  userId: string | null;
                  proClicks: number;
                  starterClicks: number;
                  teamClicks: number;
                  nudgeShown: number;
                  nudgeClicked: number;
                }
              >();

              for (const ev of revenueIntentEvents) {
                const userEmail = readMetadataString(ev.metadata, ["userEmail", "email"]);
                const userId = readMetadataString(ev.metadata, ["userId", "user_id"]);
                const key = userId ? `id:${userId}` : userEmail ? `email:${userEmail}` : "";
                if (!key) continue;
                const rec =
                  perUser.get(key) ?? {
                    userEmail: userEmail ?? null,
                    userId: userId ?? null,
                    proClicks: 0,
                    starterClicks: 0,
                    teamClicks: 0,
                    nudgeShown: 0,
                    nudgeClicked: 0,
                  };
                if (!rec.userEmail && userEmail) rec.userEmail = userEmail;
                if (!rec.userId && userId) rec.userId = userId;
                if (ev.eventName === "pricing_pro_click") rec.proClicks += 1;
                if (ev.eventName === "pricing_starter_click") rec.starterClicks += 1;
                if (ev.eventName === "pricing_team_demo_click") rec.teamClicks += 1;
                if (ev.eventName === "upgrade_nudge_shown") rec.nudgeShown += 1;
                if (ev.eventName === "upgrade_nudge_clicked") rec.nudgeClicked += 1;
                perUser.set(key, rec);
              }

              const flags: HighIntentFlag[] = [];
              for (const rec of perUser.values()) {
                // No "upgrade completed" event exists in this telemetry set; interpret as "no known upgrade event in this window".
                if (rec.proClicks >= 2) {
                  flags.push({
                    userEmail: rec.userEmail,
                    userId: rec.userId,
                    signal: "2+ pro clicks (no known upgrade event)",
                    evidenceCount: rec.proClicks,
                    actionLabel: "Review in Support Console",
                  });
                }
                if (rec.starterClicks >= 2) {
                  flags.push({
                    userEmail: rec.userEmail,
                    userId: rec.userId,
                    signal: "2+ starter clicks (no known upgrade event)",
                    evidenceCount: rec.starterClicks,
                    actionLabel: "Review in Support Console",
                  });
                }
                if (rec.teamClicks >= 1) {
                  flags.push({
                    userEmail: rec.userEmail,
                    userId: rec.userId,
                    signal: "1+ team demo click",
                    evidenceCount: rec.teamClicks,
                    actionLabel: "Review in Support Console",
                  });
                }
                if (rec.nudgeShown >= 3 && rec.nudgeClicked === 0) {
                  flags.push({
                    userEmail: rec.userEmail,
                    userId: rec.userId,
                    signal: "3+ upgrade nudge shown and 0 clicked",
                    evidenceCount: rec.nudgeShown,
                    actionLabel: "Review in Support Console",
                  });
                }
              }

              flags.sort(
                (a, b) =>
                  b.evidenceCount - a.evidenceCount ||
                  a.signal.localeCompare(b.signal)
              );

              return (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {[
                      ["pricingViews", pricingViews],
                      ["pricingClicksTotal", pricingClicksTotal],
                      ["pricingViewToClickRate", formatPercent(pricingViewToClickRate)],
                      ["starterClicks", starterClicks],
                      ["proClicks", proClicks],
                      ["teamDemoClicks", teamDemoClicks],
                      ["signinClicks", signinClicks],
                      ["clickToSigninRate", formatPercent(clickToSigninRate)],
                      ["upgradeNudgeShown", upgradeNudgeShown],
                      ["upgradeNudgeClicked", upgradeNudgeClicked],
                      ["upgradeNudgeDismissed", upgradeNudgeDismissed],
                      ["upgradeNudgeClickRate", formatPercent(upgradeNudgeClickRate)],
                      ["upgradeNudgeDismissRate", formatPercent(upgradeNudgeDismissRate)],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                      >
                        <p className="text-xs text-gray-500">{label}</p>
                        <p className="mt-2 text-2xl font-semibold text-white">
                          {typeof value === "number"
                            ? value.toLocaleString()
                            : String(value)}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
                      <div>
                        <div className="text-sm font-semibold">Funnel drop-off table</div>
                        <p className="mt-1 text-xs text-gray-500">
                          Drop-off from previous step. Explicit funnel events only.
                        </p>
                      </div>
                      <div className="overflow-x-auto rounded-xl border border-white/10">
                        <table className="min-w-full divide-y divide-white/10 text-left text-sm">
                          <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-gray-500">
                            <tr>
                              <th className="px-3 py-2">step</th>
                              <th className="px-3 py-2">count</th>
                              <th className="px-3 py-2">conversion</th>
                              <th className="px-3 py-2">drop-off</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/10">
                            {dropoffRows.map((r) => {
                              const conv = r.prev == null ? null : safeRate(r.count, r.prev);
                              const drop =
                                r.prev == null
                                  ? null
                                  : safeRate(Math.max(0, r.prev - r.count), r.prev);
                              return (
                                <tr key={r.label} className="align-top">
                                  <td className="px-3 py-2 text-white">{r.label}</td>
                                  <td className="px-3 py-2 text-gray-300">
                                    {r.count.toLocaleString()}
                                  </td>
                                  <td className="px-3 py-2 text-gray-300">{formatPercent(conv)}</td>
                                  <td className="px-3 py-2 text-gray-300">{formatPercent(drop)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
                      <div>
                        <div className="text-sm font-semibold">Plan CTA conversion breakdown</div>
                        <p className="mt-1 text-xs text-gray-500">
                          Share of total plan CTA clicks (Starter/Pro/Team).
                        </p>
                      </div>
                      <div className="overflow-x-auto rounded-xl border border-white/10">
                        <table className="min-w-full divide-y divide-white/10 text-left text-sm">
                          <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-gray-500">
                            <tr>
                              <th className="px-3 py-2">plan</th>
                              <th className="px-3 py-2">clicks</th>
                              <th className="px-3 py-2">share</th>
                              <th className="px-3 py-2">source</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/10">
                            {planRows.map((r) => (
                              <tr key={r.event} className="align-top">
                                <td className="px-3 py-2 text-white">{r.label}</td>
                                <td className="px-3 py-2 text-gray-300">
                                  {r.count.toLocaleString()}
                                </td>
                                <td className="px-3 py-2 text-gray-300">
                                  {formatPercent(safeRate(r.count, pricingClicksTotal))}
                                </td>
                                <td className="px-3 py-2 text-gray-300">{r.event}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
                      <div>
                        <div className="text-sm font-semibold">Attribution signals</div>
                        <p className="mt-1 text-xs text-gray-500">
                          Attribution is based only on explicit event names and available metadata. No inference from generic plan tags.
                        </p>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                            Counts by surface (recent window)
                          </div>
                          <div className="mt-2 space-y-1 text-sm">
                            {surfaces.length === 0 ? (
                              <p className="text-gray-500">—</p>
                            ) : (
                              surfaces.map((r) => (
                                <div
                                  key={r.key}
                                  className="flex items-center justify-between gap-3"
                                >
                                  <span className="text-gray-300">{r.key}</span>
                                  <span className="text-white">{r.count}</span>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                            Counts by CTA label (recent window)
                          </div>
                          <div className="mt-2 space-y-1 text-sm">
                            {ctaLabels.length === 0 ? (
                              <p className="text-gray-500">—</p>
                            ) : (
                              ctaLabels.map((r) => (
                                <div
                                  key={r.key}
                                  className="flex items-center justify-between gap-3"
                                >
                                  <span className="text-gray-300">{r.key}</span>
                                  <span className="text-white">{r.count}</span>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
                      <div>
                        <div className="text-sm font-semibold">High-intent flags</div>
                        <p className="mt-1 text-xs text-gray-500">
                          High-intent flags are heuristic and based on available metadata.
                        </p>
                      </div>
                      {flags.length === 0 ? (
                        <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-gray-400">
                          No high-intent flags in the current event window (or identifiers missing).
                        </div>
                      ) : (
                        <div className="overflow-x-auto rounded-xl border border-white/10">
                          <table className="min-w-full divide-y divide-white/10 text-left text-sm">
                            <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-gray-500">
                              <tr>
                                <th className="px-3 py-2">email</th>
                                <th className="px-3 py-2">user</th>
                                <th className="px-3 py-2">signal</th>
                                <th className="px-3 py-2">evidence</th>
                                <th className="px-3 py-2">action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/10">
                              {flags.slice(0, 20).map((f, idx) => (
                                <tr
                                  key={`${f.signal}-${f.userId ?? f.userEmail ?? idx}`}
                                  className="align-top"
                                >
                                  <td className="px-3 py-2 text-gray-300">
                                    {f.userEmail ? (
                                      <Link
                                        href={`/dashboard/founder/support?email=${encodeURIComponent(
                                          f.userEmail
                                        )}`}
                                        className="underline hover:text-white"
                                      >
                                        {f.userEmail}
                                      </Link>
                                    ) : (
                                      "-"
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-gray-300">
                                    {f.userId ? (
                                      <Link
                                        href={`/dashboard/founder/support?userId=${encodeURIComponent(
                                          f.userId
                                        )}`}
                                        className="underline hover:text-white"
                                      >
                                        {f.userId}
                                      </Link>
                                    ) : (
                                      "-"
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-white">{f.signal}</td>
                                  <td className="px-3 py-2 text-gray-300">{f.evidenceCount}</td>
                                  <td className="px-3 py-2 text-gray-300">{f.actionLabel}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
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
                    <th className="px-3 py-2">email</th>
                    <th className="px-3 py-2">user</th>
                    <th className="px-3 py-2">surface</th>
                    <th className="px-3 py-2">cta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {eventsToShow.slice(0, 40).map((event, index) => {
                    const userEmail = readMetadataString(event.metadata, [
                      "userEmail",
                      "email",
                    ]);
                    const userId = readMetadataString(event.metadata, [
                      "userId",
                      "user_id",
                    ]);
                    return (
                      <tr key={`${event.serverTimestamp}-${index}`} className="align-top">
                        <td className="px-3 py-2 text-gray-400">
                          {new Date(event.serverTimestamp).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-white">{event.eventName}</td>
                        <td className="px-3 py-2 text-gray-300">{event.planType ?? "-"}</td>
                        <td className="px-3 py-2 text-gray-300">
                          {userEmail ? (
                            <Link
                              href={`/dashboard/founder/support?email=${encodeURIComponent(userEmail)}`}
                              className="underline hover:text-white"
                            >
                              {userEmail}
                            </Link>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-300">
                          {userId ? (
                            <Link
                              href={`/dashboard/founder/support?userId=${encodeURIComponent(userId)}`}
                              className="underline hover:text-white"
                            >
                              {userId}
                            </Link>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-300">{event.surface ?? "-"}</td>
                        <td className="px-3 py-2 text-gray-300">{event.ctaLabel ?? "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
