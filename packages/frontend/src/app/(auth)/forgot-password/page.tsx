"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getAuthCallbackURL } from "@/lib/authRedirect";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    console.log("submit fired");
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      const response = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: getAuthCallbackURL({ flow: "recovery" }),
      });
      console.log(response);
      const { error } = response;

      if (error) {
        setError(error.message);
        return;
      }

      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
            If an account exists for <strong className="text-white">{email}</strong>, we sent a password
            reset link.
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
          <h1 className="text-2xl font-bold">Reset your password</h1>
          <p className="mt-1 text-sm text-gray-400">We’ll email you a reset link.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-gray-400" htmlFor="forgot-email">
              Email
            </label>
            <input
              id="forgot-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full rounded-lg border border-white/20 bg-transparent px-4 py-2.5 text-white outline-none placeholder:text-gray-600 focus:border-white/60"
              placeholder="you@example.com"
            />
          </div>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg border border-white/60 py-2.5 font-semibold transition hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Sending…" : "Send password recovery"}
          </button>
        </form>

        <p className="text-center text-sm text-gray-400">
          Remembered it?{" "}
          <a href="/login" className="text-white underline">
            Sign in
          </a>
        </p>
      </div>
    </main>
  );
}

