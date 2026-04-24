import Link from "next/link";
import { API_URL } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { isFounderEmail } from "@/lib/founder";
import { FounderSupportClient } from "./supportClient";

export default async function FounderSupportPage() {
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
            <h1 className="text-2xl font-bold">Founder Support</h1>
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
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Founder Support Console</h1>
          <p className="mt-1 text-sm text-gray-400">
            Inspect plan, entitlements, usage, and mismatch flags for a single account.
          </p>
        </div>
        <Link href="/dashboard" className="text-gray-400 underline hover:text-white">
          Back to conversations
        </Link>
      </div>

      <FounderSupportClient apiBase={API_URL} />
    </div>
  );
}

