"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "@/lib/env";
import { waitForSessionAccessToken } from "@/app/dashboard/[conversationId]/conversationSession";

const INDUSTRIES = [
  "Restaurant",
  "Retail",
  "Auto Repair",
  "Construction",
  "Medical / Dental",
  "Trucking / Logistics",
  "Beauty / Salon",
  "Landscaping",
  "Plumbing / HVAC",
  "E-commerce",
  "Gym / Fitness",
  "Hotel / Hospitality",
  "Real Estate",
  "Manufacturing",
  "Other",
];

const DEAL_TYPES = [
  { value: "mca", label: "💸 MCA" },
  { value: "loc", label: "🏦 Line of Credit" },
  { value: "term_loan", label: "📋 Term Loan" },
  { value: "equipment", label: "🚜 Equipment Leasing" },
  { value: "merchant_services", label: "💳 Merchant Services" },
  { value: "invoice_factoring", label: "🧾 Invoice Factoring" },
];

interface BriefData {
  ok: boolean;
  brief: string;
  structuredReply: Record<string, unknown> | null;
  clientContext: {
    businessName: string;
    industry: string;
    monthlyRevenueText?: string;
  };
  dealType: string;
}

export default function PreCallPage() {
  const router = useRouter();

  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [customIndustry, setCustomIndustry] = useState("");
  const [monthlyRevenue, setMonthlyRevenue] = useState("");
  const [dealType, setDealType] = useState("mca");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [creating, setCreating] = useState(false);

  const effectiveIndustry =
    industry === "Other" ? customIndustry : industry;

  const handleGenerate = async () => {
    if (!businessName.trim() || !effectiveIndustry.trim()) return;
    setLoading(true);
    setError(null);
    setBrief(null);
    try {
      const token = await waitForSessionAccessToken();
      if (!token) {
        setError("Session expired. Please refresh.");
        return;
      }
      const res = await fetch(
        `${API_URL}/api/conversations/analytics/precall-brief`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            businessName: businessName.trim(),
            industry: effectiveIndustry.trim(),
            monthlyRevenue: monthlyRevenue.trim() || undefined,
            dealType,
          }),
        }
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setError(err.error ?? "Failed to generate brief");
        return;
      }
      const data = (await res.json()) as BriefData;
      setBrief(data);
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleStartConversation = async () => {
    if (!brief) return;
    setCreating(true);
    try {
      const token = await waitForSessionAccessToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: `${brief.clientContext.businessName} — ${
            DEAL_TYPES.find((d) => d.value === brief.dealType)?.label ??
            brief.dealType
          }`,
          client_context: brief.clientContext,
        }),
      });
      if (!res.ok) return;
      const conv = (await res.json()) as { id: string };
      router.push(`/dashboard/${conv.id}`);
    } catch {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <div className="mx-auto max-w-2xl px-4 py-8">
        {/* Back */}
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="mb-6 flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          ← Back to Dashboard
        </button>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">
            ⚡ Pre-Call Intelligence Brief
          </h1>
          <p className="text-sm text-white/50">
            Enter the merchant's info. Get your brief in seconds before you dial.
          </p>
        </div>

        {/* Form */}
        <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-black/30 p-6 mb-6">
          <div className="space-y-4">
            {/* Business name */}
            <div>
              <label className="text-xs text-white/50 mb-1 block font-medium">
                Business Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. Mike's Auto Repair"
                className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-4 py-3 text-sm text-white placeholder-white/20 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 transition-all"
              />
            </div>

            {/* Industry */}
            <div>
              <label className="text-xs text-white/50 mb-1 block font-medium">
                Industry <span className="text-red-400">*</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {INDUSTRIES.map((ind) => (
                  <button
                    key={ind}
                    type="button"
                    onClick={() => setIndustry(ind)}
                    className={`rounded-xl px-3 py-2 text-xs font-medium text-left transition-all ${
                      industry === ind
                        ? "bg-emerald-600 text-white"
                        : "bg-white/[0.06] text-white/50 hover:bg-white/10 hover:text-white/80"
                    }`}
                  >
                    {ind}
                  </button>
                ))}
              </div>
              {industry === "Other" && (
                <input
                  type="text"
                  value={customIndustry}
                  onChange={(e) => setCustomIndustry(e.target.value)}
                  placeholder="Enter industry..."
                  className="mt-2 w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-4 py-3 text-sm text-white placeholder-white/20 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 transition-all"
                  autoFocus
                />
              )}
            </div>

            {/* Monthly revenue */}
            <div>
              <label className="text-xs text-white/50 mb-1 block font-medium">
                Monthly Revenue{" "}
                <span className="text-white/20">(optional)</span>
              </label>
              <input
                type="text"
                value={monthlyRevenue}
                onChange={(e) => setMonthlyRevenue(e.target.value)}
                placeholder="e.g. $80,000 / month"
                className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-4 py-3 text-sm text-white placeholder-white/20 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 transition-all"
              />
            </div>

            {/* Deal type */}
            <div>
              <label className="text-xs text-white/50 mb-1 block font-medium">
                Deal Type
              </label>
              <div className="grid grid-cols-3 gap-2">
                {DEAL_TYPES.map((dt) => (
                  <button
                    key={dt.value}
                    type="button"
                    onClick={() => setDealType(dt.value)}
                    className={`rounded-xl px-3 py-2 text-xs font-medium text-left transition-all ${
                      dealType === dt.value
                        ? "bg-emerald-600 text-white"
                        : "bg-white/[0.06] text-white/50 hover:bg-white/10 hover:text-white/80"
                    }`}
                  >
                    {dt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Generate button */}
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={
              loading ||
              !businessName.trim() ||
              !effectiveIndustry.trim()
            }
            className="mt-6 w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 text-sm transition-all shadow-[0_0_24px_rgba(16,185,129,0.2)]"
          >
            {loading ? "Generating your brief..." : "⚡ Generate Pre-Call Brief"}
          </button>

          {error && (
            <p className="mt-3 text-xs text-red-400">{error}</p>
          )}
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-black/30 p-6 animate-pulse">
            <div className="h-4 w-48 rounded bg-white/10 mb-4" />
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-16 rounded-xl bg-white/[0.06]" />
              ))}
            </div>
          </div>
        )}

        {/* Brief output */}
        {brief && !loading && (
          <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/[0.04] to-black/30 p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-base">⚡</span>
              <h2 className="text-sm font-semibold text-white/90">
                Pre-Call Brief —{" "}
                <span className="text-emerald-400">
                  {brief.clientContext.businessName}
                </span>
              </h2>
            </div>

            {/* Brief text — render as formatted sections */}
            <div className="prose prose-invert prose-sm max-w-none">
              <div className="text-sm text-white/70 leading-relaxed whitespace-pre-wrap">
                {brief.brief}
              </div>
            </div>

            {/* CTA */}
            <div className="mt-6 pt-4 border-t border-white/[0.06] flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => void handleStartConversation()}
                disabled={creating}
                className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-3 text-sm transition-all"
              >
                {creating
                  ? "Opening conversation..."
                  : "🚀 Start Live Coaching Session"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setBrief(null);
                  setBusinessName("");
                  setIndustry("");
                  setMonthlyRevenue("");
                }}
                className="rounded-xl border border-white/10 text-white/40 hover:text-white/70 py-3 px-4 text-sm transition-all"
              >
                New Brief
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
