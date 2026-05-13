"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/env";
import { waitForSessionAccessToken } from "@/app/dashboard/[conversationId]/conversationSession";

// ── Static battle card database ─────────────────────────────────────────────
interface StaticCard {
  industry: string;
  keywords: string[];
  emoji: string;
  whatTheyCareAbout: string[];
  topObjections: string[];
  bestOpener: string;
  cashFlowNote: string;
  closingEdge: string;
}

const STATIC_CARDS: StaticCard[] = [
  {
    industry: "Restaurant",
    keywords: ["restaurant", "food", "dining", "cafe", "bar", "pizza"],
    emoji: "🍽️",
    whatTheyCareAbout: [
      "Keeping doors open during slow seasons",
      "Daily cash flow — payroll hits before revenue does",
      "Not being locked into long contracts",
    ],
    topObjections: [
      "I already have a loan with my bank",
      "Your daily payments will hurt my cash flow",
      "I need to think about it",
    ],
    bestOpener:
      "Most restaurant owners I talk to are sitting on $30K–$80K in future revenue they can access today — without touching their bank relationship. Is that something worth a 5-minute conversation?",
    cashFlowNote:
      "Restaurants collect daily but pay weekly/monthly. MCA daily payments align with their actual cash flow better than monthly bank loans.",
    closingEdge:
      "The approval takes 24 hours. You could have capital before your next inventory order.",
  },
  {
    industry: "Auto Repair",
    keywords: ["auto", "mechanic", "repair", "car", "truck", "garage"],
    emoji: "🔧",
    whatTheyCareAbout: [
      "Equipment breakdowns that stop revenue cold",
      "Seasonal slowdowns in winter",
      "Parts inventory — they pay upfront before getting paid",
    ],
    topObjections: [
      "Business is slow right now",
      "I don't want debt",
      "What's the factor rate?",
    ],
    bestOpener:
      "Auto shops lose an average of $8K every time a lift or compressor goes down. Do you have a capital reserve for that, or do you handle it deal by deal?",
    cashFlowNote:
      "Parts are paid upfront; customers pay on pickup. The gap between those two moments is exactly what working capital solves.",
    closingEdge:
      "If a piece of equipment went down tomorrow, would you rather have the capital already in your account or be making calls?",
  },
  {
    industry: "Trucking",
    keywords: ["trucking", "logistics", "freight", "transport", "fleet"],
    emoji: "🚛",
    whatTheyCareAbout: [
      "Fuel costs hitting before loads pay out (net 30–60)",
      "Driver payroll — weekly, no exceptions",
      "Equipment maintenance and DOT compliance costs",
    ],
    topObjections: [
      "I'm waiting on invoices to come in",
      "Fuel costs are already killing me",
      "I can't afford another payment",
    ],
    bestOpener:
      "Trucking operators are sitting on $50K–$200K in unpaid invoices at any given time. Invoice factoring or an MCA lets you access that revenue today instead of net 30. Is that a conversation worth having?",
    cashFlowNote:
      "The net-30/60 invoice gap is the trucking industry's biggest killer. Capital bridges the gap between delivering the load and getting paid for it.",
    closingEdge:
      "Your loads are already done. You've already earned the money. We're just talking about when you access it.",
  },
  {
    industry: "Construction",
    keywords: ["construction", "contractor", "builder", "remodel", "roofing"],
    emoji: "🏗️",
    whatTheyCareAbout: [
      "Material costs up front before draws come in",
      "Slow winter months with year-round overhead",
      "Bonding and insurance renewals",
    ],
    topObjections: [
      "I get paid in draws — I can't handle daily payments",
      "My jobs are seasonal",
      "I already have a line of credit",
    ],
    bestOpener:
      "Most contractors I talk to have $50K–$150K tied up in jobs they've completed but haven't been paid for yet. That's your money — we just help you access it faster.",
    cashFlowNote:
      "Construction is milestone-payment based. Capital between draws is the #1 cash flow pain point for contractors under $5M revenue.",
    closingEdge:
      "What would you do differently on your next project if the material money was already in your account before you broke ground?",
  },
  {
    industry: "Medical",
    keywords: ["medical", "dental", "doctor", "clinic", "healthcare", "practice"],
    emoji: "🏥",
    whatTheyCareAbout: [
      "Insurance reimbursement delays (45–90 days)",
      "Equipment upgrades and technology",
      "Staff expansion without upfront cost",
    ],
    topObjections: [
      "We deal with insurance — cash flow is complicated",
      "I need to run this by my practice manager",
      "Our accountant handles all financing decisions",
    ],
    bestOpener:
      "Medical practices have some of the most predictable revenue streams of any business — insurance pays reliably, just slowly. We can advance against that predictable revenue. Is 90-day insurance lag affecting your expansion plans?",
    cashFlowNote:
      "Insurance reimbursement lag is 45–90 days on average. Revenue is guaranteed but delayed — making medical practices ideal MCA candidates.",
    closingEdge:
      "Your practice is already pre-qualified based on your monthly billing volume. The question is just timing.",
  },
  {
    industry: "Retail",
    keywords: ["retail", "store", "boutique", "shop", "ecommerce", "inventory"],
    emoji: "🛍️",
    whatTheyCareAbout: [
      "Inventory financing — buying before selling",
      "Holiday season cash crunch",
      "Competing with big-box on selection",
    ],
    topObjections: [
      "Sales are down right now",
      "I already have a business credit card",
      "I don't want daily payments",
    ],
    bestOpener:
      "Retail is a buy-low-sell-high game, but you can only win it if you have the capital to buy when prices are right. Are you ever leaving margin on the table because you can't buy inventory in volume?",
    cashFlowNote:
      "Retail has the most predictable use case: buy inventory, sell it at margin. Capital enables volume purchasing that drives profit.",
    closingEdge:
      "What would your margins look like if you could buy your top 3 SKUs at 30% higher volume?",
  },
  {
    industry: "Beauty",
    keywords: ["salon", "beauty", "spa", "nail", "barber", "hair"],
    emoji: "💅",
    whatTheyCareAbout: [
      "Chair rental vs commission structure",
      "Equipment upgrades (lasers, chairs, stations)",
      "Building out a second location",
    ],
    topObjections: [
      "I'm not sure my revenue qualifies",
      "I don't want my stylists to know I took funding",
      "Monthly revenue varies too much",
    ],
    bestOpener:
      "Beauty businesses do most of their revenue in credit card transactions — which makes approval fast and straightforward. Are you in a position where equipment or expansion capital in 48 hours would change what you say yes to?",
    cashFlowNote:
      "Predictable card volume plus short payback windows maps well to working-capital products when inventory or build-out timing matters.",
    closingEdge:
      "If capital were available before your next rent or equipment decision, would you expand chairs or marketing first?",
  },
];

interface BattleApiRow {
  objection_type: string;
  count: number;
}

interface BattleApiResponse {
  ok: boolean;
  industry: string;
  dataConversationCount: number;
  realObjections: BattleApiRow[];
}

function findStaticCard(industryNorm: string): StaticCard | null {
  const s = industryNorm.toLowerCase().trim();
  if (!s) return null;
  for (const card of STATIC_CARDS) {
    if (card.keywords.some((k) => s.includes(k))) return card;
  }
  return STATIC_CARDS.find((c) => c.industry.toLowerCase() === s) ?? null;
}

export default function BattleCardPanel({
  industry,
  conversationId,
}: {
  industry: string;
  conversationId: string;
}) {
  const [apiData, setApiData] = useState<BattleApiResponse | null>(null);

  const staticCard = findStaticCard(industry);

  useEffect(() => {
    const q = industry.trim();
    if (!q) return;
    void (async () => {
      try {
        const token = await waitForSessionAccessToken();
        if (!token) return;
        const res = await fetch(
          `${API_URL}/api/conversations/analytics/battle-card?industry=${encodeURIComponent(q)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) return;
        const json = (await res.json()) as BattleApiResponse;
        setApiData(json);
      } catch {
        // silent
      }
    })();
  }, [industry, conversationId]);

  if (!staticCard) return null;

  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-b from-cyan-500/[0.06] to-black/30 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xl" aria-hidden>
          {staticCard.emoji}
        </span>
        <h3 className="text-sm font-semibold text-white/90">
          Battle card — {staticCard.industry}
        </h3>
      </div>

      <div className="mb-3 space-y-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-white/40">
          What they care about
        </p>
        <ul className="list-inside list-disc space-y-1 text-xs text-white/65">
          {staticCard.whatTheyCareAbout.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="mb-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-white/40 mb-1">
          Likely objections
        </p>
        <ul className="space-y-1">
          {staticCard.topObjections.map((o) => (
            <li
              key={o}
              className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-xs text-white/70"
            >
              {o}
            </li>
          ))}
        </ul>
        {apiData && apiData.realObjections.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] text-white/35 mb-1">
              Live signals ({apiData.dataConversationCount} convos in dataset)
            </p>
            <ul className="space-y-1">
              {apiData.realObjections.map((r) => (
                <li
                  key={r.objection_type}
                  className="flex justify-between gap-2 rounded-lg border border-emerald-500/15 bg-emerald-500/5 px-2 py-1 text-[11px] text-emerald-100/80"
                >
                  <span className="truncate">{r.objection_type}</span>
                  <span className="shrink-0 text-emerald-300/90">{r.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mb-3 rounded-xl border border-white/[0.08] bg-white/[0.04] p-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-white/40 mb-1">
          Best opener
        </p>
        <p className="text-xs leading-relaxed text-white/75">{staticCard.bestOpener}</p>
      </div>

      <div className="mb-2 rounded-xl border border-amber-500/15 bg-amber-500/5 p-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-amber-200/50 mb-1">
          Cash flow angle
        </p>
        <p className="text-xs leading-relaxed text-amber-100/75">{staticCard.cashFlowNote}</p>
      </div>

      <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-violet-200/50 mb-1">
          Closing edge
        </p>
        <p className="text-xs leading-relaxed text-violet-100/80">{staticCard.closingEdge}</p>
      </div>
    </div>
  );
}
