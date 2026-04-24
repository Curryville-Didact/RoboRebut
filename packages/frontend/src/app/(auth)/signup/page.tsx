"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getAuthCallbackURL } from "@/lib/authRedirect";

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
      const supabase = createClient();

      const { error: signUpError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password: trimmedPassword,
        options: {
          emailRedirectTo: getAuthCallbackURL(),
        },
      });

      if (signUpError) {
        console.error("Signup error:", signUpError);
        setError(signUpError.message);
        return;
      }

      setDone(true);
    } catch (error) {
      console.error("Signup error:", error);
      const msg =
        error instanceof Error ? error.message : String(error);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black p-6 text-white">
        <div className="w-full max-w-sm space-y-4 rounded-xl border border-white/20 p-8 text-center">
          <h1 className="text-2xl font-bold">Check your email</h1>
          <p className="text-gray-400">
            We sent a confirmation link to <strong className="text-white">{email}</strong>.
            Click it to activate your account.
          </p>
          <a href="/login" className="block text-sm text-white underline">
            Back to sign in
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-black p-6 text-white">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-white/20 p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold">RoboRebut</h1>
          <p className="mt-1 text-sm text-gray-400">Create your account</p>
        </div>

        <form
          onSubmit={handleSubmit}
          autoComplete="off"
          className="space-y-4"
        >
          <div>
            <label className="mb-1 block text-sm text-gray-400" htmlFor="signup-email">
              Email
            </label>
            <input
              id="signup-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full rounded-lg border border-white/20 bg-transparent px-4 py-2.5 text-white outline-none placeholder:text-gray-600 focus:border-white/60"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-400" htmlFor="signup-password">
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
              className="w-full rounded-lg border border-white/20 bg-transparent px-4 py-2.5 text-white outline-none placeholder:text-gray-600 focus:border-white/60"
              placeholder="••••••••"
            />
          </div>

          {error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg border border-white/60 py-2.5 font-semibold transition hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Creating…" : "Create account"}
          </button>
        </form>

        <p className="text-center text-sm text-gray-400">
          Already have an account?{" "}
          <a href="/login" className="text-white underline">
            Sign in
          </a>
        </p>
      </div>
    </main>
  );
}
