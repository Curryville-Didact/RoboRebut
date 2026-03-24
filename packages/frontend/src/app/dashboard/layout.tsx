import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackendWebSocket } from "@/components/BackendWebSocket";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen bg-black text-white">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-white/10 p-6">
        <div className="mb-8">
          <h1 className="text-xl font-bold">RoboRebut</h1>
          <p className="mt-1 text-xs text-gray-500 truncate">{user.email}</p>
        </div>

        <nav className="flex-1 space-y-1">
          <a
            href="/dashboard"
            className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
          >
            Conversations
          </a>
          <a
            href="/dashboard/saved"
            className="block rounded-lg px-3 py-2 text-sm text-gray-300 transition hover:bg-white/10 hover:text-white"
          >
            Saved Responses
          </a>
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
