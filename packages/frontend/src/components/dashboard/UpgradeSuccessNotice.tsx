"use client";

import { useLayoutEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const STORAGE_STARTER = "roborebut_upgrade_seen_starter_success";
const STORAGE_PRO = "roborebut_upgrade_seen_pro_success";

/**
 * After Polar success_url to /conversations?upgrade=starter_success|pro_success (rewritten to dashboard).
 * Dedupes repeat views of the same success URL in one browser session (sessionStorage).
 */
export function UpgradeSuccessNotice() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const upgrade = searchParams.get("upgrade");
  const line =
    upgrade === "starter_success"
      ? "Starter plan activated."
      : upgrade === "pro_success"
        ? "Pro plan activated."
        : null;

  const [gate, setGate] = useState<"pending" | "show" | "hide">("pending");

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;

    if (!line) {
      setGate("hide");
      return;
    }

    const key =
      upgrade === "starter_success"
        ? STORAGE_STARTER
        : upgrade === "pro_success"
          ? STORAGE_PRO
          : null;

    if (!key) {
      setGate("hide");
      return;
    }

    if (sessionStorage.getItem(key) === "1") {
      router.replace(pathname || "/dashboard", { scroll: false });
      setGate("hide");
      return;
    }

    sessionStorage.setItem(key, "1");
    setGate("show");
  }, [line, pathname, router, upgrade]);

  useLayoutEffect(() => {
    if (gate !== "show" || !line) return;
    const id = window.setTimeout(() => {
      router.replace(pathname || "/dashboard", { scroll: false });
    }, 8000);
    return () => window.clearTimeout(id);
  }, [gate, line, pathname, router]);

  if (gate === "pending" || gate === "hide") return null;

  function dismiss() {
    router.replace(pathname || "/dashboard", { scroll: false });
  }

  return (
    <div className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-emerald-500/25 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-50/95">
      <p className="leading-snug">{line}</p>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded-md px-2 py-0.5 text-xs text-emerald-200/70 transition hover:bg-white/10 hover:text-emerald-50"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
