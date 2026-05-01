import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRedirectOriginFromRequest } from "@/lib/authRedirect";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  const type = url.searchParams.get("type");
  const flow = url.searchParams.get("flow");
  const redirectOrigin = getRedirectOriginFromRequest(request.url);

  // If there's no code, just bounce to login (keeps behavior predictable)
  if (!code) {
    return NextResponse.redirect(new URL("/login", redirectOrigin));
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, redirectOrigin),
    );
  }

  const isRecoveryFlow = flow === "recovery" || type === "recovery";
  const safeNext =
    next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  const target = isRecoveryFlow ? "/reset-password" : safeNext ?? "/dashboard";

  return NextResponse.redirect(new URL(target, redirectOrigin));
}

