"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export default function DashboardPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001";

  async function getAuthToken(): Promise<string | null> {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function fetchConversations() {
    const token = await getAuthToken();
    if (!token) return;

    const res = await fetch(`${API_URL}/api/conversations`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      const data = await res.json() as Conversation[];
      setConversations(data);
    } else {
      setError("Failed to load conversations");
    }
    setLoading(false);
  }

  async function createConversation() {
    setCreating(true);
    const token = await getAuthToken();
    if (!token) return;

    const res = await fetch(`${API_URL}/api/conversations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title: "New Conversation" }),
    });

    if (res.ok) {
      await fetchConversations();
    } else {
      setError("Failed to create conversation");
    }
    setCreating(false);
  }

  useEffect(() => {
    void fetchConversations();
  }, []);

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
          onClick={createConversation}
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
          <p className="mt-1 text-sm text-gray-500">Click &quot;New Conversation&quot; to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className="rounded-xl border border-white/10 p-4 transition hover:border-white/30"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">{conv.title}</p>
                <p className="text-xs text-gray-500">{formatDate(conv.updated_at)}</p>
              </div>
              <p className="mt-1 text-xs text-gray-500">Created {formatDate(conv.created_at)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
