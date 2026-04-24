"use client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-6">
        <h2 className="text-xl font-semibold text-white">
          Dashboard temporarily unavailable
        </h2>
        <p className="mt-2 text-sm text-gray-300">
          A route-level error interrupted this dashboard view. Core data and auth were
          left untouched; you can retry safely.
        </p>
        <p className="mt-2 text-xs text-red-300/80">
          {error.message || "Unexpected dashboard error"}
        </p>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white transition hover:bg-white hover:text-black"
          >
            Retry
          </button>
          <a
            href="/dashboard"
            className="rounded-lg border border-white/20 px-4 py-2 text-sm text-gray-300 transition hover:border-white/40 hover:text-white"
          >
            Back to Conversations
          </a>
        </div>
      </div>
    </div>
  );
}
