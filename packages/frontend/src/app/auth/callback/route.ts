import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getRedirectOriginFromRequest,
  getSafePostAuthRedirect,
} from "@/lib/authRedirect";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next");
  const type = requestUrl.searchParams.get("type");
  const flow = requestUrl.searchParams.get("flow");
  const redirectOrigin = getRedirectOriginFromRequest(request.url);

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(
        new URL("/login?error=auth_failed", redirectOrigin),
      );
    }
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.redirect(new URL("/login", redirectOrigin));
  }

  const isRecoveryFlow = flow === "recovery" || type === "recovery";
  const path = isRecoveryFlow
    ? "/reset-password"
    : getSafePostAuthRedirect(next);

  return NextResponse.redirect(new URL(path, redirectOrigin));
}
