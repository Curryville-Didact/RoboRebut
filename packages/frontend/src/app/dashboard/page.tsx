"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { API_URL } from "@/lib/env";

interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

/** Bounded wait for browser session after navigation (e.g. post-login). */
const SESSION_MAX_ATTEMPTS = 5;
const SESSION_RETRY_DELAY_MS = 200;

function isValidConversationRecord(v: unknown): v is Conversation {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    o.id.length > 0 &&
    typeof o.title === "string" &&
    typeof o.created_at === "string" &&
    typeof o.updated_at === "string"
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const mountedRef = useRef(true);
  const createInFlightRef = useRef(false);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function waitForSessionAccessToken(): Promise<string | null> {
    const supabase = createClient();
    for (let attempt = 1; attempt <= SESSION_MAX_ATTEMPTS; attempt++) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (token) return token;
      if (attempt < SESSION_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, SESSION_RETRY_DELAY_MS));
      }
    }
    return null;
  }

  const loadConversations = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setError(null);
      setLoading(true);
    }
    try {
      const token = await waitForSessionAccessToken();
      if (!token) {
        setError(
          "Could not load your session yet. Try refreshing the page, or sign out and sign in again."
        );
        return;
      }

      const res = await fetch(`${API_URL}/api/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = (await res.json()) as Conversation[];
        setConversations(Array.isArray(data) ? data : []);
      } else {
        let msg = "Failed to load conversations";
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) msg = body.error;
        } catch {
          /* ignore */
        }
        setError(msg);
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to load conversations"
      );
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  /**
   * Deterministic create flow: one POST, validate body, optimistic list update,
   * navigate by returned id. No loadConversations() after create (avoids races
   * with navigation and duplicate GETs).
   */
  async function handleCreateConversation() {
    if (createInFlightRef.current) return;
    createInFlightRef.current = true;
    if (mountedRef.current) {
      setCreating(true);
      setError(null);
    }

    try {
      const token = await waitForSessionAccessToken();
      if (!token) {
        if (mountedRef.current) {
          setError(
            "Could not load your session yet. Try refreshing the page, or sign out and sign in again."
          );
        }
        return;
      }

      const res = await fetch(`${API_URL}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: "New Conversation" }),
      });

      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = null;
      }

      if (!res.ok) {
        let msg = "Failed to create conversation";
        if (
          body &&
          typeof body === "object" &&
          "error" in body &&
          typeof (body as { error: unknown }).error === "string"
        ) {
          msg = (body as { error: string }).error;
        }
        if (mountedRef.current) setError(msg);
        return;
      }

      if (!isValidConversationRecord(body)) {
        if (mountedRef.current) {
          setError("Invalid response from server: missing conversation id.");
        }
        return;
      }

      const created = body;
      if (mountedRef.current) {
        setConversations((prev) => [created, ...prev]);
        router.push(`/dashboard/${created.id}`);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(
          e instanceof Error ? e.message : "Failed to create conversation"
        );
      }
    } finally {
      createInFlightRef.current = false;
      if (mountedRef.current) {
        setCreating(false);
      }
    }
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Conversations</h2>
        <button
          type="button"
          onClick={() => void handleCreateConversation()}
          disabled={creating}
          className="rounded-lg border border-white/60 px-4 py-2 text-sm font-semibold transition hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
        >
          {creating ? "Creating…" : "+ New Conversation"}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-gray-400">Loading…</p>
      ) : conversations.length === 0 ? (
        <div className="rounded-xl border border-white/10 p-8 text-center">
          <p className="text-gray-400">No conversations yet.</p>
          <p className="mt-1 text-sm text-gray-500">
            Click &quot;New Conversation&quot; to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {conversations.map((conv) => (
            <Link
              key={conv.id}
              href={`/dashboard/${conv.id}`}
              className="block rounded-xl border border-white/10 p-4 transition hover:border-white/30"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">{conv.title}</p>
                <p className="text-xs text-gray-500">
                  {formatDate(conv.updated_at)}
                </p>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Created {formatDate(conv.created_at)}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
