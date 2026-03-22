"use client";

interface ResponseCardProps {
  rank: number;
  text: string;
  tone: string;
  framework: string;
  confidence: number;
  isPrimary?: boolean;
  onCopy: (text: string) => void;
  onRegenerate: () => void;
}

export function ResponseCard({
  rank,
  text,
  tone,
  framework,
  confidence,
  isPrimary = false,
  onCopy,
  onRegenerate,
}: ResponseCardProps) {
  const confidencePct = Math.round(confidence * 100);

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border bg-black p-5 text-white transition ${
        isPrimary ? "border-white" : "border-white/20"
      }`}
    >
      {/* Top row */}
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
          #{rank}
        </span>
        <span className="rounded-full border border-white/20 px-2.5 py-0.5 text-xs text-gray-300">
          {tone}
        </span>
        <span className="text-xs text-gray-400">{confidencePct}%</span>
        {isPrimary && (
          <span className="ml-auto rounded-md bg-white px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-black">
            PRIMARY
          </span>
        )}
      </div>

      {/* Rebuttal text */}
      <p className="flex-1 text-sm leading-7 text-white">{text}</p>

      {/* Framework label */}
      <p className="text-xs text-gray-500">{framework}</p>

      {/* Action buttons */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onCopy(text)}
          className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white hover:text-black"
        >
          Copy
        </button>
        <button
          onClick={onRegenerate}
          className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white hover:text-black"
        >
          Regenerate
        </button>
      </div>
    </div>
  );
}
