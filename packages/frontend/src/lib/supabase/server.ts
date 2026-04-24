import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  console.log("[SUPABASE_CREATE_CLIENT_START]");
  const cookieStore = await cookies();
  console.log("[SUPABASE_CREATE_CLIENT_AFTER_COOKIES]");

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from Server Component — cookie setting is a no-op
          }
        },
      },
    }
  );
  // Note: createServerClient is sync; getUser/getSession are the async network calls.
}
