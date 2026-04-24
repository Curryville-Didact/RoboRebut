import Link from "next/link";
import { API_URL } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { isFounderEmail } from "@/lib/founder";
import { FounderPatternAnalyticsClient } from "./patternsClient";

export default async function FounderPatternAnalyticsPage() {
  let userEmail = "";
  try {
    const supabase = await createClient();
    const result = await supabase.auth.getUser();
    userEmail = result.data.user?.email ?? "";
  } catch {
    userEmail = "";
  }

  if (!isFounderEmail(userEmail)) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Founder Analytics</h1>
            <p className="mt-1 text-sm text-gray-400">This page is not available.</p>
          </div>
          <Link href="/dashboard" className="text-gray-400 underline hover:text-white">
            Back to conversations
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Pattern Intelligence Analytics</h1>
          <p className="mt-1 text-sm text-gray-400">
            Internal read-only aggregation over recent pattern intelligence events.
          </p>
        </div>
        <Link href="/dashboard" className="text-gray-400 underline hover:text-white">
          Back to conversations
        </Link>
      </div>

      <FounderPatternAnalyticsClient apiBase={API_URL} />
    </div>
  );
}

