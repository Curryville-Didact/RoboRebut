import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Root route — server-side auth gate.
 * Authenticated  → /dashboard
 * Unauthenticated → /signup
 */
export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  } else {
    redirect("/signup");
  }
}
