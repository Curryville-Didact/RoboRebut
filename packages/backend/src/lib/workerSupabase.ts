import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Service-role client for Bull workers (same pattern as `supabaseAuth` plugin). */
export function createServiceRoleSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for queue workers"
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
