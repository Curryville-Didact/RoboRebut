import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BackendWebSocket } from "@/components/BackendWebSocket";
import { isFounderEmail } from "@/lib/founder";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let userEmail = "";

  try {
    const supabase = await createClient();
    const result = await supabase.auth.getUser();
    userEmail = result.data.user?.email ?? "";
  } catch {
    /* Auth gate is middleware; avoid redirect here so a transient getUser/RSC blip
       does not fail the client flight with "Load failed" then succeed on full load. */
  }

  return (
    <div className="flex min-h-screen bg-black text-white">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-white/10 p-6">
        <div className="mb-8">
          <h1 className="text-xl font-bold">RoboRebut</h1>
          <p className="mt-1 text-xs text-gray-500 truncate">{userEmail}</p>
        </div>

        <nav className="flex-1 space-y-1">
          <Link
            href="/dashboard"
            className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
          >
            Conversations
          </Link>
          <Link
            href="/dashboard/saved"
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
              className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
            >
              Performance
            </Link>
            <Link
              href="/dashboard/intelligence/review"
              className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
            >
              Review
            </Link>
            <Link
              href="/dashboard/intelligence"
              className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
            >
              Insights
            </Link>
          </div>
          {/* Full navigation avoids client transition edge cases when `.next` is mid-compile. */}
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
              className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
            >
              Integrations
            </Link>
          </div>
          {isFounderEmail(userEmail) ? (
            <div className="pt-3">
              <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wide text-gray-600">
                Founder
              </div>
              <Link
                href="/dashboard/analytics"
                className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
              >
                Analytics
              </Link>
              <Link
                href="/dashboard/founder/support"
                className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
              >
                Support Console
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
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-8">{children}</main>

      {/* Backend WS — dashboard only, not auth pages */}
      <BackendWebSocket />
    </div>
  );
}
