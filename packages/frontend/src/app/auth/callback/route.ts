import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  const type = url.searchParams.get("type");
  const flow = url.searchParams.get("flow");

  // If there's no code, just bounce to login (keeps behavior predictable)
  if (!code) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin));
  }

  const isRecoveryFlow = flow === "recovery" || type === "recovery";
  const target = isRecoveryFlow
    ? "/reset-password"
    : next && next.startsWith("/")
      ? next
      : "/dashboard";

  return NextResponse.redirect(new URL(target, url.origin));
}

