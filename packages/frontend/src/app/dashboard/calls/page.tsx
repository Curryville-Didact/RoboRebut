"use client";

import Link from "next/link";
import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { API_URL } from "@/lib/env";

const ACCEPTED_FORMATS = [".mp3", ".mp4", ".m4a", ".wav", ".webm", ".mpeg", ".mpga"];
const MAX_SIZE_MB = 25;

interface TranscriptionResult {
  ok: boolean;
  transcript: string;
  detectedObjections: string[];
  detectedVertical: string | null;
  error?: string;
}

const OBJECTION_LABELS: Record<string, string> = {
  rate_too_high: "Rate Too High",
  need_to_think: "Need to Think",
  shop_around: "Shopping Around",
  payment_too_high: "Payment Too High",
  not_interested: "Not Interested",
  already_funded: "Already Funded",
  bad_timing: "Bad Timing",
};

const VERTICAL_LABELS: Record<string, string> = {
  mca: "MCA",
  business_line_of_credit: "Line of Credit",
  sba_loan: "SBA Loan",
  equipment_financing: "Equipment Financing",
  invoice_factoring: "Invoice Factoring",
  term_loan: "Term Loan",
  merchant_services: "Merchant Services",
};

type UploadState = "idle" | "uploading" | "done" | "error";

export default function CallsPage() {
  const router = useRouter();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<TranscriptionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);

  const validateFile = (file: File): string | null => {
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED_FORMATS.includes(ext)) {
      return `Unsupported format. Please upload: ${ACCEPTED_FORMATS.join(", ")}`;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return `File too large. Maximum size is ${MAX_SIZE_MB}MB.`;
    }
    return null;
  };

  const handleFile = useCallback((file: File) => {
    const err = validateFile(file);
    if (err) {
      setErrorMsg(err);
      setSelectedFile(null);
      return;
    }
    setErrorMsg(null);
    setSelectedFile(file);
    setResult(null);
    setUploadState("idle");
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploadState("uploading");
    setErrorMsg(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setErrorMsg("Session expired. Please refresh.");
        setUploadState("error");
        return;
      }

      const formData = new FormData();
      formData.append("file", selectedFile, selectedFile.name);

      const res = await fetch(`${API_URL}/api/calls/transcribe`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      });

      let data: Record<string, unknown>;
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        setErrorMsg("Invalid response from server.");
        setUploadState("error");
        return;
      }

      if (!res.ok || data.ok !== true) {
        setErrorMsg(
          typeof data.error === "string"
            ? data.error
            : "Transcription failed. Please try again."
        );
        setUploadState("error");
        return;
      }

      setResult({
        ok: true,
        transcript: String(data.transcript ?? ""),
        detectedObjections: Array.isArray(data.detectedObjections)
          ? (data.detectedObjections as string[])
          : [],
        detectedVertical:
          data.detectedVertical === null || typeof data.detectedVertical === "string"
            ? (data.detectedVertical as string | null)
            : null,
      });
      setUploadState("done");
    } catch {
      setErrorMsg("Network error. Please try again.");
      setUploadState("error");
    }
  };

  const handleContinueToCoach = async () => {
    if (!result?.transcript?.trim()) return;
    setCreatingSession(true);
    setErrorMsg(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setErrorMsg("Session expired. Please refresh.");
        return;
      }

      const token = session.access_token;
      const title =
        result.transcript.trim().slice(0, 48) +
        (result.transcript.trim().length > 48 ? "…" : "");

      const createRes = await fetch(`${API_URL}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: title || "Call transcript",
          deal_context: result.detectedVertical
            ? { dealType: result.detectedVertical }
            : undefined,
        }),
      });

      const created = (await createRes.json()) as { id?: string; error?: string };
      if (!createRes.ok || !created.id) {
        setErrorMsg(created.error ?? "Could not start conversation.");
        return;
      }

      const msgRes = await fetch(`${API_URL}/api/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          conversation_id: created.id,
          content: result.transcript.trim(),
        }),
      });

      if (!msgRes.ok) {
        const errBody = (await msgRes.json().catch(() => null)) as { error?: string } | null;
        setErrorMsg(errBody?.error ?? "Could not send transcript to coach.");
        return;
      }

      router.push(`/dashboard/${created.id}`);
    } catch {
      setErrorMsg("Something went wrong. Please try again.");
    } finally {
      setCreatingSession(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <Link
            href="/dashboard"
            className="mb-2 inline-block text-sm text-gray-400 underline-offset-2 hover:text-white hover:underline"
          >
            ← Back to conversations
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Call transcription</h1>
          <p className="mt-1 max-w-xl text-sm text-gray-400">
            Upload a short recording of a sales call. We transcribe it with Deepgram and surface likely objections and product hints.
          </p>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FORMATS.join(",")}
          className="hidden"
          onChange={handleFileInput}
        />

        <div
          ref={dropRef}
          role="presentation"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
            dragOver ? "border-emerald-500/60 bg-emerald-500/5" : "border-white/15 bg-white/[0.02]"
          }`}
        >
          <p className="text-sm text-gray-300">
            Drag and drop an audio file here, or{" "}
            <button
              type="button"
              className="font-medium text-emerald-400 underline-offset-2 hover:underline"
              onClick={() => fileInputRef.current?.click()}
            >
              browse
            </button>
          </p>
          <p className="mt-2 text-xs text-gray-500">
            {ACCEPTED_FORMATS.join(", ")} · max {MAX_SIZE_MB}MB
          </p>
        </div>

        {selectedFile && (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
            <span className="text-gray-400">Selected:</span>{" "}
            <span className="font-medium text-white">{selectedFile.name}</span>
            <span className="ml-2 text-gray-500">
              ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
            </span>
          </div>
        )}

        {errorMsg && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {errorMsg}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={!selectedFile || uploadState === "uploading"}
            onClick={handleUpload}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {uploadState === "uploading" ? "Transcribing…" : "Transcribe"}
          </button>
          {selectedFile && uploadState !== "uploading" && (
            <button
              type="button"
              className="rounded-lg border border-white/15 px-4 py-2 text-sm text-gray-300 hover:bg-white/5"
              onClick={() => {
                setSelectedFile(null);
                setResult(null);
                setUploadState("idle");
                setErrorMsg(null);
              }}
            >
              Clear
            </button>
          )}
        </div>

        {result && uploadState === "done" && (
          <div className="space-y-4 rounded-xl border border-white/10 bg-black/40 p-5">
            <h2 className="text-lg font-medium text-white">Transcript</h2>
            <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/50 p-4 text-sm leading-relaxed text-gray-200">
              {result.transcript || "(empty)"}
            </div>

            {result.detectedObjections.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Detected objections
                </h3>
                <ul className="flex flex-wrap gap-2">
                  {result.detectedObjections.map((key) => (
                    <li
                      key={key}
                      className="rounded-full bg-white/10 px-3 py-1 text-xs text-gray-200"
                    >
                      {OBJECTION_LABELS[key] ?? key}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.detectedVertical && (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Detected vertical
                </h3>
                <p className="text-sm text-emerald-300">
                  {VERTICAL_LABELS[result.detectedVertical] ?? result.detectedVertical}
                </p>
              </div>
            )}

            <button
              type="button"
              disabled={creatingSession}
              onClick={handleContinueToCoach}
              className="w-full rounded-lg bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-gray-100 disabled:opacity-50"
            >
              {creatingSession ? "Opening coach…" : "Continue to coach"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
