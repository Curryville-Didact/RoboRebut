import { createClient } from "@/lib/supabase/server";
import { getRedirectOriginFromRequest } from "@/lib/authRedirect";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const redirectOrigin = getRedirectOriginFromRequest(request.url);
  return NextResponse.redirect(new URL("/login", redirectOrigin));
}
