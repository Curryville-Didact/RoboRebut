import { DefaultDeepgramClient } from "@deepgram/sdk";

const SUPPORTED_FORMATS = ["mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm"];
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

const VERTICALS = [
  "mca",
  "business_line_of_credit",
  "sba_loan",
  "term_loan",
  "equipment_financing",
  "invoice_factoring",
  "merchant_services",
  "general",
] as const;
type Vertical = (typeof VERTICALS)[number];
const VERTICAL_SET = new Set<string>(VERTICALS);

export interface TranscriptionResult {
  transcript: string;
  detectedObjections: string[];
  detectedVertical: string | null;
  durationEstimate: string | null;
}

export async function transcribeCallAudio(
  audioBuffer: Buffer,
  filename: string,
  _mimeType: string
): Promise<TranscriptionResult> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!SUPPORTED_FORMATS.includes(ext)) {
    throw new Error(
      `Unsupported audio format: .${ext}. Supported: ${SUPPORTED_FORMATS.join(", ")}`
    );
  }
  if (audioBuffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error("Audio file exceeds 25MB limit.");
  }

  const deepgramKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!deepgramKey) throw new Error("DEEPGRAM_API_KEY not configured.");

  const dg = new DefaultDeepgramClient({ apiKey: deepgramKey });

  const dgRes = await dg.listen.v1.media.transcribeFile(audioBuffer, {
    model: "nova-2",
    diarize: true,
    punctuate: true,
    utterances: true,
  });

  const transcript = formatDeepgramTranscript(dgRes);
  const detectedObjections = extractObjectionsFromTranscript(transcript);

  let detectedVertical: string | null = null;
  try {
    const classified = await classifyVerticalWithOpenAI(transcript);
    detectedVertical = classified;
  } catch (err) {
    console.error("[callTranscription] vertical classification failed; using regex fallback", err);
    detectedVertical = detectVerticalFromTranscript(transcript) ?? "general";
  }

  return { transcript, detectedObjections, detectedVertical, durationEstimate: null };
}

function formatDeepgramTranscript(dgRes: unknown): string {
  const obj = dgRes as Record<string, unknown>;
  const results = obj.results as Record<string, unknown> | undefined;
  if (!results || typeof results !== "object") return "";

  const utterances = results.utterances as unknown;
  try {
    if (Array.isArray(utterances) && utterances.length > 0) {
      const lines: string[] = [];
      for (const u of utterances) {
        if (!u || typeof u !== "object") continue;
        const speaker = (u as Record<string, unknown>).speaker;
        const text = (u as Record<string, unknown>).transcript;
        if (typeof text !== "string" || text.trim() === "") continue;
        const sp =
          typeof speaker === "number" || typeof speaker === "string"
            ? String(speaker)
            : "unknown";
        lines.push(`[Speaker ${sp}]: ${text.trim()}`);
      }
      if (lines.length > 0) return lines.join("\n");
    }
  } catch {
    // fall through to flat transcript
  }

  const channels = results.channels as unknown;
  if (Array.isArray(channels) && channels.length > 0) {
    const ch0 = channels[0] as Record<string, unknown> | undefined;
    const alts = ch0?.alternatives as unknown;
    if (Array.isArray(alts) && alts.length > 0) {
      const alt0 = alts[0] as Record<string, unknown> | undefined;
      const flat = alt0?.transcript;
      if (typeof flat === "string") return flat.trim();
    }
  }

  return "";
}

async function classifyVerticalWithOpenAI(transcript: string): Promise<Vertical> {
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openaiKey) throw new Error("OPENAI_API_KEY not configured.");

  const systemPrompt =
    "You are a financial product classifier. Analyze this sales call transcript and \n" +
    "   identify the financial product being discussed. Respond with exactly one word from \n" +
    "   this list: mca, business_line_of_credit, sba_loan, term_loan, equipment_financing, \n" +
    "   invoice_factoring, merchant_services, general. No explanation, just the single word.";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: transcript },
      ],
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI chat completions error ${res.status}: ${errText}`);
  }

  const data = (await res.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const raw = data.choices?.[0]?.message?.content;
  const word = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!VERTICAL_SET.has(word)) return "general";
  return word as Vertical;
}

// Keep extractObjectionsFromTranscript exactly as it is today, no changes
function extractObjectionsFromTranscript(transcript: string): string[] {
  const objectionPatterns: Record<string, RegExp[]> = {
    rate_too_high: [/rate is too high/i, /factor rate/i, /too expensive/i, /cost too much/i],
    need_to_think: [/need to think/i, /think about it/i, /let me think/i, /not sure yet/i],
    shop_around: [/shop around/i, /other offers/i, /comparing/i, /looking at others/i],
    payment_too_high: [/payment too high/i, /can't afford/i, /too much per/i, /daily payment/i],
    not_interested: [/not interested/i, /don't need/i, /don't want/i, /no thanks/i],
    already_funded: [/already have/i, /already funded/i, /just got funded/i],
    bad_timing: [/bad timing/i, /not right now/i, /call me back/i, /maybe later/i],
  };

  const detected: string[] = [];
  for (const [objection, patterns] of Object.entries(objectionPatterns)) {
    if (patterns.some((p) => p.test(transcript))) {
      detected.push(objection);
    }
  }
  return detected;
}

// Regex fallback (kept intentionally for resilience when LLM classifier is unavailable)
function detectVerticalFromTranscript(transcript: string): string | null {
  const verticalPatterns: Record<string, RegExp[]> = {
    mca: [
      /merchant cash advance/i,
      /MCA/i,
      /factor rate/i,
      /retrieval rate/i,
      /payback/i,
      /holdback/i,
      /daily payment/i,
      /weekly payment/i,
      /advance/i,
      /funded/i,
    ],
    business_line_of_credit: [/line of credit/i, /LOC/i, /revolving/i, /draw/i],
    sba_loan: [/SBA/i, /small business administration/i, /SBA loan/i],
    equipment_financing: [/equipment/i, /machinery/i, /vehicle/i, /truck/i],
    invoice_factoring: [/invoice/i, /factoring/i, /receivables/i, /accounts receivable/i],
    term_loan: [/term loan/i, /fixed payment/i, /installment/i],
    merchant_services: [
      /processing/i,
      /credit card processing/i,
      /merchant services/i,
      /interchange/i,
    ],
  };

  for (const [vertical, patterns] of Object.entries(verticalPatterns)) {
    if (patterns.some((p) => p.test(transcript))) {
      return vertical;
    }
  }
  return null;
}
