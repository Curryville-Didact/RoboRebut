import { createClient } from "@/lib/supabase/server";
import { HubSpotIntegrationPanel } from "./HubSpotIntegrationPanel";

export default async function HubSpotIntegrationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="sticky top-0 z-20 -mx-8 border-b border-white/10 bg-black/80 px-8 py-6 backdrop-blur supports-[backdrop-filter]:bg-black/60">
        <h2 className="text-2xl font-bold tracking-tight text-white">
          HubSpot
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Connect your CRM and sync your RoboRebut profile to HubSpot.
        </p>
      </div>

      {!user ? (
        <p className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-gray-400">
          Sign in to manage HubSpot integration.
        </p>
      ) : (
        <HubSpotIntegrationPanel
          userId={user.id}
          email={user.email ?? ""}
        />
      )}
    </div>
  );
}
