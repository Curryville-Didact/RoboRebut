"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Diagnostic: log any unhandled errors on this page so we can trace the source
  useEffect(() => {
    function handleError(event: ErrorEvent) {
      console.error("[signup] unhandled error:", event.message, event.filename, event.lineno);
    }
    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      console.error("[signup] unhandled promise rejection:", event.reason);
    }
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();
    if (!trimmedEmail || !trimmedPassword) {
      console.warn("[signup] handleSubmit blocked — empty fields");
      return;
    }

    console.log("[signup] handleSubmit fired by user");
    setLoading(true);
    setError(null);

    try {
      // Disable all background auth activity — this page only needs signUp(),
      // not session detection, token refresh, or URL parsing.
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          auth: {
            autoRefreshToken: false,
            detectSessionInUrl: false,
            persistSession: false,
          },
        }
      );

      const { error: signUpError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password: trimmedPassword,
      });

      if (signUpError) {
        console.error("[signup] signUp error:", signUpError);
        setError(signUpError.message);
        return;
      }

      setDone(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      console.error("[signup] caught unexpected error:", err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-lg border p-6 text-center">
          <h1 className="mb-2 text-2xl font-semibold">Check your email</h1>
          <p>We sent a confirmation link to {email}.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        autoComplete="off"
        className="w-full max-w-sm space-y-4 rounded-lg border p-6"
      >
        <h1 className="text-2xl font-semibold">Sign up</h1>

        <div>
          <label className="mb-1 block text-sm" htmlFor="signup-email">
            Email
          </label>
          <input
            id="signup-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="w-full rounded border px-3 py-2"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm" htmlFor="signup-password">
            Password
          </label>
          <input
            id="signup-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
            autoComplete="new-password"
            className="w-full rounded border px-3 py-2"
            placeholder="At least 6 characters"
          />
        </div>

        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-black px-4 py-2 text-white disabled:opacity-60"
        >
          {loading ? "Creating..." : "Create account"}
        </button>
      </form>
    </main>
  );
}
