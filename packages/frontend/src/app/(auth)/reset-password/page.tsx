"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const SESSION_TIMEOUT_MS = 5000;

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let resolved = false;
    const supabase = createClient();

    function resolveValidation(next: { ready: boolean; error: string | null; source: string }) {
      if (cancelled || resolved) return;
      resolved = true;
      console.log("reset validation resolved", next);
      setReady(next.ready);
      setError(next.error);
    }

    async function getSessionSnapshot() {
      const sessionResult = await supabase.auth.getSession();
      const userResult = await supabase.auth.getUser();
      return {
        session: sessionResult.data.session,
        user: userResult.data.user,
        sessionError: sessionResult.error,
        userError: userResult.error,
      };
    }

    const timeoutId = window.setTimeout(() => {
      resolveValidation({
        ready: false,
        error: "Reset link validation timed out. Please request a new one.",
        source: "timeout",
      });
    }, SESSION_TIMEOUT_MS);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("reset auth state change", {
        event,
        hasSession: Boolean(session),
        hasUser: Boolean(session?.user),
      });

      if (session?.user) {
        window.clearTimeout(timeoutId);
        resolveValidation({
          ready: true,
          error: null,
          source: `auth_state:${event}`,
        });
      }
    });

    (async () => {
      try {
        console.log("reset validation start");
        const result = await getSessionSnapshot();
        if (cancelled || resolved) return;

        console.log("reset session snapshot", {
          hasSession: Boolean(result.session),
          hasUser: Boolean(result.user),
          sessionError: result.sessionError?.message ?? null,
          userError: result.userError?.message ?? null,
        });

        window.clearTimeout(timeoutId);

        if (result.sessionError || result.userError) {
          resolveValidation({
            ready: false,
            error: result.sessionError?.message ?? result.userError?.message ?? "Unable to validate reset link.",
            source: "snapshot_error",
          });
          return;
        }

        if (result.session?.user || result.user) {
          resolveValidation({
            ready: true,
            error: null,
            source: "snapshot_success",
          });
          return;
        }

        resolveValidation({
          ready: false,
          error: "Reset link is invalid or expired. Please request a new one.",
          source: "snapshot_missing_session",
        });
      } catch (e) {
        if (cancelled || resolved) return;
        window.clearTimeout(timeoutId);
        resolveValidation({
          ready: false,
          error: e instanceof Error ? e.message : String(e),
          source: "snapshot_exception",
        });
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const nextPassword = password.trim();
    const nextConfirm = confirm.trim();

    if (nextPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (nextPassword !== nextConfirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: nextPassword });
      if (error) {
        setError(error.message);
        return;
      }
      setDone(true);
      // Redirect to sign-in after a short beat
      setTimeout(() => {
        router.push("/login");
        router.refresh();
      }, 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black p-6 text-white">
        <div className="w-full max-w-sm space-y-4 rounded-xl border border-white/20 p-8 text-center">
          <h1 className="text-2xl font-bold">Password updated</h1>
          <p className="text-gray-400">Redirecting you to sign in…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-black p-6 text-white">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-white/20 p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Set a new password</h1>
          <p className="mt-1 text-sm text-gray-400">Choose a strong password.</p>
        </div>

        {!ready ? (
          <div className="space-y-2">
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
            {!error ? <p className="text-sm text-gray-400">Validating reset link…</p> : null}
            <a href="/forgot-password" className="block text-sm text-white underline">
              Request a new link
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-gray-400" htmlFor="new-password">
                New password
              </label>
              <input
                id="new-password"
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

            <div>
              <label className="mb-1 block text-sm text-gray-400" htmlFor="confirm-password">
                Confirm password
              </label>
              <input
                id="confirm-password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={6}
                required
                autoComplete="new-password"
                className="w-full rounded-lg border border-white/20 bg-transparent px-4 py-2.5 text-white outline-none placeholder:text-gray-600 focus:border-white/60"
                placeholder="••••••••"
              />
            </div>

            {error ? <p className="text-sm text-red-400">{error}</p> : null}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg border border-white/60 py-2.5 font-semibold transition hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Saving…" : "Update password"}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-gray-400">
          <a href="/login" className="text-white underline">
            Back to sign in
          </a>
        </p>
      </div>
    </main>
  );
}

