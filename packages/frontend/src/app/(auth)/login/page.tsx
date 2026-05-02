"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getSafePostAuthRedirect } from "@/lib/authRedirect";
import { trackEvent } from "@/lib/trackEvent";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    trackEvent({
      eventName: "login_page_view",
      surface: "auth",
      metadata: { route: "/login", source: "app" },
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        return;
      }

      trackEvent({
        eventName: "login_success",
        surface: "auth",
        metadata: { route: "/login", source: "app" },
      });

      const rawNext = searchParams.get("next") ?? searchParams.get("returnTo");
      router.push(getSafePostAuthRedirect(rawNext));
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-black text-white">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-white/20 p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold">RoboRebut</h1>
          <p className="mt-1 text-sm text-gray-400">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-gray-400">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-white/20 bg-transparent px-4 py-2.5 text-white outline-none placeholder:text-gray-600 focus:border-white/60"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-400">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-white/20 bg-transparent px-4 py-2.5 text-white outline-none placeholder:text-gray-600 focus:border-white/60"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg border border-white/60 py-2.5 font-semibold transition hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <p className="text-center text-sm text-gray-400">
          <a href="/forgot-password" className="text-white underline">
            Forgot your password?
          </a>
        </p>

        <p className="text-center text-sm text-gray-400">
          Don&apos;t have an account?{" "}
          <a href="/signup" className="text-white underline">
            Sign up
          </a>
        </p>
      </div>
    </main>
  );
}

function LoginFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-black text-white">
      <div className="text-sm text-gray-400">Loading…</div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}
