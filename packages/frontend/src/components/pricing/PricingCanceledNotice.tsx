"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Shows when Polar checkout sends the user back with ?checkout=canceled on /pricing.
 * Reads the query via window.location (not useSearchParams) to avoid Next client-boundary issues on /pricing.
 */
export function PricingCanceledNotice() {
  const router = useRouter();
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      setShow(params.get("checkout") === "canceled");
    } catch {
      setShow(false);
    }
  }, []);

  if (!show) return null;

  function dismiss() {
    router.replace("/pricing", { scroll: false });
  }

  return (
    <div className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm text-gray-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <p className="leading-snug">
        Checkout canceled. You can review plans and try again anytime.
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded-md px-2 py-0.5 text-xs text-gray-500 transition hover:bg-white/10 hover:text-gray-300"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
