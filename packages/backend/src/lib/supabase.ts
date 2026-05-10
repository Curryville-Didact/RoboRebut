import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!url || !key) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Supabase client"
  );
}

/** Service-role Supabase client for server-side inserts (same env as workers). */
export const supabase: SupabaseClient = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});
