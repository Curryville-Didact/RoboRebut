/**
 * Manual Phase 8 rebuild runner (offline).
 *
 * Requires:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * - USER_ID (target user to rebuild for)
 */

import { createClient } from "@supabase/supabase-js";
import { rebuildOfflineIntelligenceForUser } from "../services/intelligence/offlineIntelligence.js";

async function main(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const userId = process.env.USER_ID;
  if (!supabaseUrl || !supabaseKey || !userId) {
    throw new Error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or USER_ID");
  }
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const result = await rebuildOfflineIntelligenceForUser({ supabase, userId });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((e: unknown) => {
  // eslint-disable-next-line no-console
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

