"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { isFounderEmail } from "@/lib/founder";

export function MobileSidebar({ userEmail }: { userEmail: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const showFounder = isFounderEmail(userEmail);

  const sidebarInner = (
    <div className="flex h-full w-64 flex-col border-r border-white/10 bg-black p-6">
      <div className="mb-8 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">RoboRebut</h1>
          <p className="mt-1 truncate text-xs text-gray-500">{userEmail}</p>
        </div>
        <button
          type="button"
          onClick={close}
          className="shrink-0 rounded-lg p-2 text-lg leading-none text-gray-400 transition hover:bg-white/10 hover:text-white"
          aria-label="Close menu"
        >
          ✕
        </button>
      </div>

      <nav className="flex-1 space-y-1">
        <Link
          href="/dashboard"
          onClick={close}
          className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
        >
          Conversations
        </Link>
        <Link
          href="/dashboard/calls"
          onClick={close}
          className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
        >
          Calls
        </Link>
        <Link
          href="/dashboard/team"
          onClick={close}
          className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
        >
          Team
        </Link>
        <Link
          href="/dashboard/saved"
          onClick={close}
          className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
        >
          Saved Responses
        </Link>
        <div className="pt-3">
          <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wide text-gray-600">
            Intelligence
          </div>
          <Link
            href="/dashboard/intelligence/analytics"
            onClick={close}
            className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
          >
            Performance
          </Link>
          <Link
            href="/dashboard/intelligence/review"
            onClick={close}
            className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
          >
            Review
          </Link>
          <Link
            href="/dashboard/intelligence"
            onClick={close}
            className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
          >
            Insights
          </Link>
        </div>
        <a
          href="/pricing"
          className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
        >
          Pricing
        </a>
        <div className="pt-3">
          <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wide text-gray-600">
            Settings
          </div>
          <Link
            href="/dashboard/settings/integrations"
            onClick={close}
            className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
          >
            Integrations
          </Link>
        </div>
        {showFounder ? (
          <div className="pt-3">
            <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wide text-gray-600">
              Founder
            </div>
            <Link
              href="/dashboard/analytics"
              onClick={close}
              className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
            >
              Analytics
            </Link>
            <Link
              href="/dashboard/analytics/brokers"
              onClick={close}
              className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
            >
              Broker Analytics
            </Link>
            <Link
              href="/dashboard/founder/support"
              onClick={close}
              className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
            >
              Support Console
            </Link>
            <Link
              href="/dashboard/founder/analytics/patterns"
              onClick={close}
              className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
            >
              Pattern Intelligence
            </Link>
          </div>
        ) : null}
      </nav>

      <form action="/logout" method="POST" className="mt-auto">
        <button
          type="submit"
          className="w-full rounded-lg border border-white/20 px-3 py-2 text-left text-sm text-gray-400 transition hover:border-white/40 hover:text-white"
        >
          Sign out
        </button>
      </form>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed left-4 top-4 z-50 rounded-lg border border-white/15 bg-black/80 px-3 py-2 text-xl leading-none text-white shadow-lg backdrop-blur md:hidden"
        aria-label="Open menu"
      >
        ☰
      </button>

      {open ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close menu"
            onClick={close}
          />
          <div className="absolute inset-y-0 left-0 z-50 flex h-full shadow-2xl">{sidebarInner}</div>
        </div>
      ) : null}
    </>
  );
}
