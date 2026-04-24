import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Root route — server-side auth gate.
 * Authenticated  → /dashboard
 * Unauthenticated → /signup
 */
export default async function RootPage() {
  console.log("[ROOT_PAGE_START]");

  // Local dev only: skip Supabase auth on `/` to confirm render path (set ROBREBUT_SKIP_ROOT_AUTH=1).
  if (
    process.env.NODE_ENV === "development" &&
    process.env.ROBREBUT_SKIP_ROOT_AUTH === "1"
  ) {
    console.log(
      "[ROOT_PAGE_AUTH_BYPASS] ROBREBUT_SKIP_ROOT_AUTH=1 → redirect /dashboard"
    );
    redirect("/dashboard");
  }

  console.log("[AUTH_CHECK_START]");
  const supabase = await createClient();
  console.log("[AUTH_CHECK_AFTER_CREATE_CLIENT]");

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  console.log("[AUTH_CHECK_DONE]", {
    hasUser: Boolean(user),
    errorMessage: error?.message ?? null,
  });

  if (error || !user) {
    redirect("/signup");
  }

  redirect("/dashboard");
}
