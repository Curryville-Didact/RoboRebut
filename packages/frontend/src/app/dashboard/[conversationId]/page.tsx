"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { API_URL } from "@/lib/env";

interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "user" | "ai";
  content: string;
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

export default function ConversationDetailPage() {
  const params = useParams();
  const conversationId = params.conversationId as string;

  const mountedRef = useRef(true);
  const sendInFlightRef = useRef(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [composer, setComposer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<Record<string, "saving" | "saved" | "error">>({});

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    threadEndRef.current?.scrollIntoView({ behavior });
  }, []);

  // Load meta + messages in one pass. Stop on first failure.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!mountedRef.current) return;
      setError(null);
      setPageLoading(true);

      const token = await waitForSessionAccessToken();
      if (cancelled || !mountedRef.current) return;

      if (!token) {
        setError("Could not load your session. Try refreshing.");
        setPageLoading(false);
        return;
      }

      // 1. Load conversation meta
      let metaRes: Response;
      try {
        metaRes = await fetch(`${API_URL}/api/conversations/${conversationId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        if (mountedRef.current && !cancelled) {
          setError("Could not reach the server. Is the backend running?");
          setPageLoading(false);
        }
        return;
      }

      if (!metaRes.ok) {
        if (mountedRef.current && !cancelled) {
          const msg = metaRes.status === 404
            ? "Conversation not found."
            : "Failed to load conversation.";
          setError(msg);
          setPageLoading(false);
        }
        return;
      }

      const conv = (await metaRes.json()) as Conversation;
      if (cancelled || !mountedRef.current) return;
      setConversation(conv);

      // 2. Load messages — only runs if meta succeeded
      let msgsRes: Response;
      try {
        msgsRes = await fetch(
          `${API_URL}/api/conversations/${conversationId}/messages`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
      } catch {
        if (mountedRef.current && !cancelled) {
          setError("Loaded conversation but could not fetch messages.");
          setPageLoading(false);
        }
        return;
      }

      if (!msgsRes.ok) {
        if (mountedRef.current && !cancelled) {
          setError("Failed to load messages.");
          setPageLoading(false);
        }
        return;
      }

      const msgs = (await msgsRes.json()) as MessageRow[];
      if (cancelled || !mountedRef.current) return;
      setMessages(Array.isArray(msgs) ? msgs : []);
      setPageLoading(false);
    }

    void load();
    return () => { cancelled = true; };
  }, [conversationId]);

  // Scroll to bottom when messages first load, or new ones arrive
  useEffect(() => {
    if (!pageLoading && messages.length > 0) {
      scrollToBottom("instant");
    }
  }, [pageLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (messages.length > 0 && !pageLoading) {
      scrollToBottom();
    }
  }, [messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSend() {
    const text = composer.trim();
    if (!text || sendInFlightRef.current || sending) return;

    sendInFlightRef.current = true;
    // Clear composer immediately — don't make user wait for round-trip
    setComposer("");
    setSending(true);
    setError(null);

    try {
      const token = await waitForSessionAccessToken();
      if (!token) {
        setError("Session expired. Please refresh the page.");
        setComposer(text); // restore text so user doesn't lose it
        return;
      }

      const res = await fetch(`${API_URL}/api/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ conversation_id: conversationId, content: text }),
      });

      let body: unknown;
      try { body = await res.json(); } catch { body = null; }

      if (!res.ok) {
        const msg =
          body &&
          typeof body === "object" &&
          "error" in body &&
          typeof (body as { error: unknown }).error === "string"
            ? (body as { error: string }).error
            : "Failed to send message";
        setError(msg);
        setComposer(text); // restore on failure
        return;
      }

      const parsed = body as { userMessage?: MessageRow; assistantMessage?: MessageRow };
      if (parsed?.userMessage && parsed?.assistantMessage && mountedRef.current) {
        setMessages((prev) => [...prev, parsed.userMessage!, parsed.assistantMessage!]);
      } else if (mountedRef.current) {
        setError("Unexpected response from server.");
        setComposer(text);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "Failed to send message");
        setComposer(text);
      }
    } finally {
      sendInFlightRef.current = false;
      if (mountedRef.current) setSending(false);
    }
  }

  async function handleSaveResponse(msg: MessageRow) {
    if (!mountedRef.current) return;
    setSaveStatus((prev) => ({ ...prev, [msg.id]: "saving" }));

    const token = await waitForSessionAccessToken();
    if (!token) {
      setSaveStatus((prev) => ({ ...prev, [msg.id]: "error" }));
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/saved-responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          label: conversation?.title ?? "Saved response",
          content: msg.content,
          category: "coaching",
        }),
      });

      if (mountedRef.current) {
        setSaveStatus((prev) => ({ ...prev, [msg.id]: res.ok ? "saved" : "error" }));
        if (res.ok) {
          setTimeout(() => {
            if (mountedRef.current) {
              setSaveStatus((prev) => {
                const next = { ...prev };
                delete next[msg.id];
                return next;
              });
            }
          }, 2000);
        }
      }
    } catch {
      if (mountedRef.current) {
        setSaveStatus((prev) => ({ ...prev, [msg.id]: "error" }));
      }
    }
  }

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  if (pageLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-4">
          <Link href="/dashboard" className="text-sm text-gray-400 underline hover:text-white">
            ← Back to conversations
          </Link>
        </div>
        <p className="text-gray-400">Loading…</p>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-4">
          <Link href="/dashboard" className="text-sm text-gray-400 underline hover:text-white">
            ← Back to conversations
          </Link>
        </div>
        <p className="text-sm text-red-400">{error ?? "Conversation not found."}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 shrink-0">
        <Link href="/dashboard" className="text-sm text-gray-400 underline hover:text-white">
          ← Back to conversations
        </Link>
      </div>

      <h2 className="mb-4 shrink-0 text-2xl font-bold">{conversation.title}</h2>

      {error && (
        <p className="mb-3 shrink-0 rounded-lg border border-red-500/30 bg-red-950/20 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {/* Message thread */}
      <div className="min-h-[240px] flex-1 space-y-3 overflow-y-auto rounded-xl border border-white/10 p-4">
        {messages.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-gray-400">No messages yet.</p>
            <p className="mt-1 text-sm text-gray-500">
              Type an objection below — RoboRebut will coach you on how to handle it.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === "user"
                  ? "ml-auto max-w-[85%] rounded-lg border border-white/20 bg-white/5 px-4 py-2"
                  : "mr-auto max-w-[85%] rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-4 py-2"
              }
            >
              <div className="mb-1 flex items-center justify-between gap-2 text-xs text-gray-500">
                <span>{m.role === "user" ? "You" : "RoboRebut"}</span>
                <span>{formatTime(m.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
              {m.role === "ai" && (
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleSaveResponse(m)}
                    disabled={saveStatus[m.id] === "saving"}
                    className="text-xs text-gray-600 transition hover:text-emerald-400 disabled:opacity-50"
                  >
                    {saveStatus[m.id] === "saving"
                      ? "Saving…"
                      : saveStatus[m.id] === "saved"
                        ? "✓ Saved"
                        : saveStatus[m.id] === "error"
                          ? "Save failed"
                          : "Save response"}
                  </button>
                </div>
              )}
            </div>
          ))
        )}
        <div ref={threadEndRef} />
      </div>

      {/* Composer */}
      <div className="mt-4 shrink-0 space-y-2 border-t border-white/10 pt-4">
        {sending && (
          <p className="text-xs text-gray-500">RoboRebut is thinking…</p>
        )}
        <textarea
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Type a merchant objection… (Enter to send, Shift+Enter for new line)"
          rows={3}
          disabled={sending}
          className="w-full resize-y rounded-lg border border-white/20 bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-white/50 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={sending || !composer.trim()}
          className="rounded-lg border border-white/60 px-4 py-2 text-sm font-semibold transition hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
