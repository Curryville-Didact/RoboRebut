"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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
  const router = useRouter();
  const conversationId = params.conversationId as string;

  const inflightConvRef = useRef<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const isFirstScrollRef = useRef(true);

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [composer, setComposer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<Record<string, "saving" | "saved" | "error">>({});

  // Rename state
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  // Delete state
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // --- Load ---
  useEffect(() => {
    setConversation(null);
    setMessages([]);
    setError(null);
    setPageLoading(true);
    setSaveStatus({});
    setRenaming(false);
    setConfirmDelete(false);
    inflightConvRef.current = null;
    isFirstScrollRef.current = true;

    let cancelled = false;

    async function load() {
      const token = await waitForSessionAccessToken();
      if (cancelled) return;

      if (!token) {
        setError("Could not load your session. Try refreshing.");
        setPageLoading(false);
        return;
      }

      let metaRes: Response;
      try {
        metaRes = await fetch(`${API_URL}/api/conversations/${conversationId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        if (!cancelled) {
          setError("Could not reach the server. Is the backend running?");
          setPageLoading(false);
        }
        return;
      }

      if (cancelled) return;

      if (!metaRes.ok) {
        setError(metaRes.status === 404 ? "Conversation not found." : "Failed to load conversation.");
        setPageLoading(false);
        return;
      }

      const conv = (await metaRes.json()) as Conversation;
      if (cancelled) return;
      setConversation(conv);

      let msgsRes: Response;
      try {
        msgsRes = await fetch(
          `${API_URL}/api/conversations/${conversationId}/messages`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
      } catch {
        if (!cancelled) {
          setError("Loaded conversation but could not fetch messages.");
          setPageLoading(false);
        }
        return;
      }

      if (cancelled) return;

      if (!msgsRes.ok) {
        setError("Failed to load messages.");
        setPageLoading(false);
        return;
      }

      const msgs = (await msgsRes.json()) as MessageRow[];
      if (cancelled) return;
      setMessages(Array.isArray(msgs) ? msgs : []);
      setPageLoading(false);
    }

    void load();
    return () => { cancelled = true; };
  }, [conversationId]);

  // --- Scroll ---
  useEffect(() => {
    if (pageLoading || messages.length === 0) return;
    const behavior: ScrollBehavior = isFirstScrollRef.current ? "instant" : "smooth";
    isFirstScrollRef.current = false;
    threadEndRef.current?.scrollIntoView({ behavior });
  }, [pageLoading, messages.length]);

  // Focus rename input when rename mode opens
  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.select();
    }
  }, [renaming]);

  // --- Send ---
  async function handleSend() {
    const text = composer.trim();
    if (!text || sending) return;

    const sentInConv = conversationId;
    inflightConvRef.current = sentInConv;

    setComposer("");
    setSending(true);
    setError(null);

    try {
      const token = await waitForSessionAccessToken();
      if (!token) {
        if (inflightConvRef.current === sentInConv) {
          setError("Session expired. Please refresh the page.");
          setComposer(text);
        }
        return;
      }

      const res = await fetch(`${API_URL}/api/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ conversation_id: sentInConv, content: text }),
      });

      let body: unknown;
      try { body = await res.json(); } catch { body = null; }

      if (!res.ok) {
        if (inflightConvRef.current === sentInConv) {
          const msg =
            body && typeof body === "object" && "error" in body &&
            typeof (body as { error: unknown }).error === "string"
              ? (body as { error: string }).error
              : "Failed to send message";
          setError(msg);
          setComposer(text);
        }
        return;
      }

      if (inflightConvRef.current !== sentInConv) return;

      const parsed = body as {
        userMessage?: MessageRow;
        assistantMessage?: MessageRow;
        updatedTitle?: string | null;
      };

      if (parsed?.userMessage && parsed?.assistantMessage) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const toAdd = [parsed.userMessage!, parsed.assistantMessage!].filter(
            (m) => !existingIds.has(m.id)
          );
          return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
        });

        // Apply auto-generated title if backend derived one.
        // Only update local state — the DB is already updated.
        if (parsed.updatedTitle) {
          setConversation((prev) =>
            prev ? { ...prev, title: parsed.updatedTitle! } : prev
          );
        }
      } else {
        setError("Unexpected response from server.");
        setComposer(text);
      }
    } catch (e) {
      if (inflightConvRef.current === sentInConv) {
        setError(e instanceof Error ? e.message : "Failed to send message");
        setComposer(text);
      }
    } finally {
      if (inflightConvRef.current === sentInConv) {
        inflightConvRef.current = null;
        setSending(false);
      }
    }
  }

  // --- Rename ---
  function startRename() {
    setRenameValue(conversation?.title ?? "");
    setRenameError(null);
    setRenaming(true);
  }

  function cancelRename() {
    setRenaming(false);
    setRenameError(null);
  }

  async function commitRename() {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError("Title cannot be empty.");
      return;
    }
    if (trimmed === conversation?.title) {
      // No change — just close
      setRenaming(false);
      return;
    }

    const token = await waitForSessionAccessToken();
    if (!token) {
      setRenameError("Session expired. Please refresh.");
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: trimmed }),
      });

      if (!res.ok) {
        setRenameError("Failed to rename. Try again.");
        return;
      }

      const updated = (await res.json()) as Conversation;
      // Update local state immediately. Dashboard will refetch on next visit.
      setConversation(updated);
      setRenaming(false);
      setRenameError(null);
    } catch {
      setRenameError("Failed to rename. Try again.");
    }
  }

  // --- Delete ---
  async function handleDelete() {
    if (!confirmDelete || deleting) return;
    setDeleting(true);

    const token = await waitForSessionAccessToken();
    if (!token) {
      setDeleting(false);
      setConfirmDelete(false);
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/conversations/${conversationId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok || res.status === 204) {
        // Redirect to dashboard — conversation is gone
        router.push("/dashboard");
        return;
      }

      // Failed — reset state, show nothing broken
      setDeleting(false);
      setConfirmDelete(false);
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  // --- Save response ---
  async function handleSaveResponse(msg: MessageRow) {
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

      setSaveStatus((prev) => ({ ...prev, [msg.id]: res.ok ? "saved" : "error" }));
      if (res.ok) {
        setTimeout(() => {
          setSaveStatus((prev) => {
            const next = { ...prev };
            delete next[msg.id];
            return next;
          });
        }, 2000);
      }
    } catch {
      setSaveStatus((prev) => ({ ...prev, [msg.id]: "error" }));
    }
  }

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  // --- Render: loading ---
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

  // --- Render: not found ---
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

  // --- Render: conversation ---
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header row */}
      <div className="mb-4 shrink-0 flex items-start justify-between gap-4">
        <Link href="/dashboard" className="text-sm text-gray-400 underline hover:text-white mt-1">
          ← Back
        </Link>

        {/* Actions */}
        {!confirmDelete && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={startRename}
              className="text-xs text-gray-500 transition hover:text-white"
            >
              Rename
            </button>
            <span className="text-gray-700">·</span>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-gray-500 transition hover:text-red-400"
            >
              Delete
            </button>
          </div>
        )}

        {/* Delete confirmation — inline, no modal */}
        {confirmDelete && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-400 text-xs">Delete this conversation?</span>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="text-xs font-medium text-red-400 transition hover:text-red-300 disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Yes, delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="text-xs text-gray-500 transition hover:text-white disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Title — inline edit */}
      {renaming ? (
        <div className="mb-4 shrink-0 flex items-center gap-2">
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void commitRename(); }
              if (e.key === "Escape") cancelRename();
            }}
            onBlur={() => void commitRename()}
            maxLength={100}
            className="flex-1 rounded-lg border border-white/30 bg-transparent px-3 py-1.5 text-xl font-bold text-white outline-none focus:border-white/60"
          />
          {renameError && (
            <span className="text-xs text-red-400">{renameError}</span>
          )}
        </div>
      ) : (
        <h2
          className="mb-4 shrink-0 text-2xl font-bold cursor-default"
          title="Click Rename to edit"
        >
          {conversation.title}
        </h2>
      )}

      {error && (
        <div className="mb-3 shrink-0 rounded-lg border border-red-500/30 bg-red-950/20 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Thread */}
      <div className="min-h-[240px] flex-1 space-y-3 overflow-y-auto rounded-xl border border-white/10 p-4">
        {messages.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-gray-400">No messages yet.</p>
            <p className="mt-1 text-sm text-gray-500">
              Type a merchant objection below — RoboRebut will coach you on how to handle it.
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

        {sending && (
          <div className="mr-auto max-w-[85%] rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-emerald-500/70">
              <span className="inline-flex gap-1">
                <span className="animate-bounce [animation-delay:0ms]">●</span>
                <span className="animate-bounce [animation-delay:150ms]">●</span>
                <span className="animate-bounce [animation-delay:300ms]">●</span>
              </span>
              <span>RoboRebut is thinking…</span>
            </div>
          </div>
        )}

        <div ref={threadEndRef} />
      </div>

      {/* Composer */}
      <div className="mt-4 shrink-0 space-y-2 border-t border-white/10 pt-4">
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
