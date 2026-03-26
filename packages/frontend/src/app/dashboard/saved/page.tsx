"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { API_URL } from "@/lib/env";

interface SavedResponse {
  id: string;
  label: string;
  content: string;
  category: string | null;
  created_at: string;
}

const SESSION_MAX_ATTEMPTS = 5;
const SESSION_RETRY_DELAY_MS = 200;

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

export default function SavedResponsesPage() {
  const mountedRef = useRef(true);

  const [responses, setResponses] = useState<SavedResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadSavedResponses = useCallback(async () => {
    const token = await waitForSessionAccessToken();
    if (!mountedRef.current) return;
    if (!token) {
      setError("Could not load your session.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/saved-responses`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        let msg = "Failed to load saved responses";
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) msg = body.error;
        } catch {
          /* ignore */
        }
        if (mountedRef.current) setError(msg);
        return;
      }

      const data = (await res.json()) as SavedResponse[];
      if (mountedRef.current) {
        setResponses(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "Failed to load saved responses");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSavedResponses();
  }, [loadSavedResponses]);

  async function handleDelete(id: string) {
    const token = await waitForSessionAccessToken();
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/api/saved-responses/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok && mountedRef.current) {
        setResponses((prev) => prev.filter((r) => r.id !== id));
      }
    } catch {
      /* ignore — item stays in list */
    }
  }

  async function handleCopy(content: string, id: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(id);
      setTimeout(() => {
        if (mountedRef.current) setCopied(null);
      }, 1500);
    } catch {
      /* ignore clipboard errors */
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
        <h2 className="text-2xl font-bold">Saved Responses</h2>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-gray-400">Loading…</p>
      ) : responses.length === 0 ? (
        <div className="rounded-xl border border-white/10 p-8 text-center">
          <p className="text-gray-400">No saved responses yet.</p>
          <p className="mt-1 text-sm text-gray-500">
            Save responses from your conversations to reuse them here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {responses.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-white/10 p-4 space-y-2"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium truncate">{r.label}</p>
                  {r.category && (
                    <p className="text-xs text-gray-500 mt-0.5">{r.category}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopy(r.content, r.id)}
                    className="rounded border border-white/20 px-2 py-1 text-xs transition hover:border-white/50 hover:text-white text-gray-400"
                  >
                    {copied === r.id ? "Copied!" : "Copy"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(r.id)}
                    className="rounded border border-red-500/30 px-2 py-1 text-xs text-red-400 transition hover:border-red-400 hover:text-red-300"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
                {r.content}
              </p>
              <p className="text-xs text-gray-600">{formatDate(r.created_at)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
