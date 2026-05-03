const SUPPORTED_FORMATS = ["mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm"];
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB Whisper limit

export interface TranscriptionResult {
  transcript: string;
  detectedObjections: string[];
  detectedVertical: string | null;
  durationEstimate: string | null;
}

export async function transcribeCallAudio(
  audioBuffer: Buffer,
  filename: string,
  mimeType: string
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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured.");

  const form = new FormData();
  const blob = new Blob([audioBuffer], { type: mimeType });
  form.append("file", blob, filename);
  form.append("model", "whisper-1");
  form.append("response_format", "text");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper API error ${res.status}: ${err}`);
  }

  const transcript = (await res.text()).trim();
  const detectedObjections = extractObjectionsFromTranscript(transcript);
  const detectedVertical = detectVerticalFromTranscript(transcript);

  return { transcript, detectedObjections, detectedVertical, durationEstimate: null };
}

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

function detectVerticalFromTranscript(transcript: string): string | null {
  const verticalPatterns: Record<string, RegExp[]> = {
    mca: [/merchant cash advance/i, /MCA/i, /factor rate/i, /retrieval rate/i],
    business_line_of_credit: [/line of credit/i, /LOC/i, /revolving/i, /draw/i],
    sba_loan: [/SBA/i, /small business administration/i, /SBA loan/i],
    equipment_financing: [/equipment/i, /machinery/i, /vehicle/i, /truck/i],
    invoice_factoring: [/invoice/i, /factoring/i, /receivables/i, /accounts receivable/i],
    term_loan: [/term loan/i, /fixed payment/i, /installment/i],
    merchant_services: [/processing/i, /credit card processing/i, /merchant services/i, /interchange/i],
  };

  for (const [vertical, patterns] of Object.entries(verticalPatterns)) {
    if (patterns.some((p) => p.test(transcript))) {
      return vertical;
    }
  }
  return null;
}
