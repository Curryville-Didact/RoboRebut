"use client";

interface InsightPanelProps {
  objectionType: string;
  strategy: string;
  confidence?: number;
  deliveryMode: string;
  intent?: string;
  emotionalTone?: string;
  urgency?: string;
}

function InsightCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 p-4">
      <p className="mb-1 text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-sm font-semibold text-white">{value || "—"}</p>
    </div>
  );
}

export function InsightPanel({
  objectionType,
  strategy,
  confidence,
  deliveryMode,
  intent,
  emotionalTone,
  urgency,
}: InsightPanelProps) {
  const confidenceDisplay =
    typeof confidence === "number"
      ? `${Math.round(confidence * 100)}%`
      : undefined;

  return (
    <section className="rounded-xl border border-white/20 p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-400">
        Analysis Insights
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <InsightCard label="Objection Type" value={objectionType} />
        <InsightCard label="Strategy" value={strategy} />
        {confidenceDisplay && (
          <InsightCard label="Confidence" value={confidenceDisplay} />
        )}
        <InsightCard label="Delivery Mode" value={deliveryMode} />
        {intent && <InsightCard label="Intent" value={intent} />}
        {emotionalTone && (
          <InsightCard label="Emotional Tone" value={emotionalTone} />
        )}
        {urgency && <InsightCard label="Urgency" value={urgency} />}
      </div>
    </section>
  );
}
