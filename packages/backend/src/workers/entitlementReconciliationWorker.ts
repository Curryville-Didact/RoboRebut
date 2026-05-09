import type Bull from "bull";
import { createServiceRoleSupabase } from "../lib/workerSupabase.js";
import { entitlementReconciliationQueue } from "../lib/queues.js";
import { syncPolarEntitlementForUser } from "../services/polarEntitlementSync.js";

const workerLogger = {
  info: (...args: unknown[]) => console.log(...args),
  warn: (...args: unknown[]) => console.warn(...args),
};

entitlementReconciliationQueue.process(async (job: Bull.Job) => {
  const supabase = createServiceRoleSupabase();
  console.log(`[entitlement-worker] starting reconciliation job ${job.id}`);

  try {
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("id, email")
      .neq("plan_type", "free");

    if (error) throw error;

    console.log(
      `[entitlement-worker] reconciling ${profiles?.length ?? 0} profiles`
    );

    const results = await Promise.allSettled(
      (profiles ?? []).map(async (profile: { id: string; email?: string | null }) => {
        try {
          const sync = await syncPolarEntitlementForUser({
            supabase,
            userId: profile.id,
            email: profile.email,
            logger: workerLogger,
          });
          return { userId: profile.id, ok: sync.ok };
        } catch (err) {
          console.warn(`[entitlement-worker] failed for user ${profile.id}:`, err);
          return { userId: profile.id, ok: false };
        }
      })
    );

    const succeeded = results.filter(
      (r) =>
        r.status === "fulfilled" &&
        r.value.ok === true
    ).length;
    const failed = results.length - succeeded;

    console.log(
      `[entitlement-worker] reconciliation complete: ${succeeded} ok, ${failed} failed`
    );
    return { succeeded, failed, total: results.length };
  } catch (err) {
    console.error(`[entitlement-worker] reconciliation job ${job.id} failed:`, err);
    throw err;
  }
});

entitlementReconciliationQueue.on("failed", (job, err: Error) => {
  console.error(
    `[entitlement-worker] job ${job?.id} failed after ${job?.attemptsMade} attempts:`,
    err?.message
  );
});

console.log("[entitlement-worker] ready");
