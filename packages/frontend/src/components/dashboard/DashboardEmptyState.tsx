import type { ReactNode } from "react";

type DashboardEmptyStateProps = {
  title: string;
  description: string | ReactNode;
  logo?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/**
 * Centered empty state for dashboard surfaces — modest width, subtle lift, no “void”.
 */
export function DashboardEmptyState({
  title,
  description,
  logo,
  children,
  className = "",
}: DashboardEmptyStateProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-white/[0.12] bg-gradient-to-b from-white/[0.05] via-black/30 to-black/60 px-6 py-12 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${className}`}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(16,185,129,0.14), transparent 55%)",
        }}
      />
      <div className="relative mx-auto flex max-w-md flex-col items-center">
        {logo ? (
          <div className="mb-5 flex h-14 w-14 items-center justify-center opacity-[0.92] drop-shadow-[0_0_24px_rgba(16,185,129,0.15)]">
            {logo}
          </div>
        ) : null}
        <h3 className="text-lg font-semibold tracking-tight text-white">{title}</h3>
        <div className="mt-2 text-sm leading-relaxed text-gray-400">{description}</div>
        {children ? <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{children}</div> : null}
      </div>
    </div>
  );
}

type DashboardErrorPanelProps = {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
};

export function DashboardErrorPanel({
  message,
  onRetry,
  retryLabel = "Try again",
}: DashboardErrorPanelProps) {
  return (
    <div className="rounded-2xl border border-amber-500/25 bg-amber-950/20 px-5 py-4 text-center">
      <p className="text-sm text-amber-100/90">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg border border-white/15 bg-white/[0.06] px-4 py-2 text-sm font-medium text-white transition hover:bg-white/[0.1]"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
