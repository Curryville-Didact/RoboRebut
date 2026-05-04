import type { SupabaseClient } from "@supabase/supabase-js";

type CallTranscriptRow = {
  text: string | null;
  deal_type: string | null;
  vertical: string | null;
  conversation_id: string | null;
};

const PAGE_SIZE = 500;
const UPSERT_BATCH = 250;

function nv(v: string | null | undefined): string {
  return v == null ? "" : String(v).trim();
}

function groupKey(dealType: string | null | undefined, vertical: string | null | undefined): string {
  return `${nv(dealType)}\x1f${nv(vertical)}`;
}

function parseGroupKey(gk: string): { deal_type: string; vertical: string } {
  const idx = gk.indexOf("\x1f");
  if (idx < 0) return { deal_type: "", vertical: "" };
  return { deal_type: gk.slice(0, idx), vertical: gk.slice(idx + 1) };
}

/** Split on ". ", "? ", and "! " applied sequentially (per spec). */
function splitIntoSentences(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, "\n");
  let segments = [normalized];
  for (const sep of [". ", "? ", "! "] as const) {
    segments = segments.flatMap((seg) => seg.split(sep));
  }
  return segments.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Lowercase, trim, collapse whitespace; strip punctuation except apostrophes. */
function normalizeSentence(sentence: string): string {
  let t = sentence.toLowerCase().trim();
  t = t.replace(/[^\p{L}\p{N}\s']/gu, "");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

/**
 * Scans `call_transcripts`, aggregates recurring phrases per deal_type + vertical,
 * and upserts into `phrase_patterns`.
 */
export async function runPhrasePatternAgent(supabase: SupabaseClient): Promise<void> {
  const groups = new Map<
    string,
    Map<string, { occurrences: number; conversationIds: Set<string> }>
  >();

  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("call_transcripts")
      .select("text,deal_type,vertical,conversation_id")
      .order("timestamp", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    const rows = (data ?? []) as CallTranscriptRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const text = typeof row.text === "string" ? row.text.trim() : "";
      if (!text) continue;

      const gk = groupKey(row.deal_type, row.vertical);
      let phraseMap = groups.get(gk);
      if (!phraseMap) {
        phraseMap = new Map();
        groups.set(gk, phraseMap);
      }

      const convId =
        typeof row.conversation_id === "string" && row.conversation_id.trim()
          ? row.conversation_id.trim()
          : "";

      for (const sentence of splitIntoSentences(text)) {
        const phrase = normalizeSentence(sentence);
        if (!phrase) continue;

        let agg = phraseMap.get(phrase);
        if (!agg) {
          agg = { occurrences: 0, conversationIds: new Set<string>() };
          phraseMap.set(phrase, agg);
        }
        agg.occurrences += 1;
        if (convId) agg.conversationIds.add(convId);
      }
    }

    offset += rows.length;
    if (rows.length < PAGE_SIZE) break;
  }

  const now = new Date().toISOString();
  const upsertRows: Array<{
    phrase: string;
    deal_type: string;
    vertical: string;
    occurrences: number;
    conversation_count: number;
    last_seen_at: string;
  }> = [];

  for (const [gk, phraseMap] of groups) {
    const { deal_type, vertical } = parseGroupKey(gk);

    for (const [phrase, agg] of phraseMap) {
      const len = phrase.length;
      if (len < 10 || len > 120) continue;
      if (agg.conversationIds.size < 2) continue;

      upsertRows.push({
        phrase,
        deal_type,
        vertical,
        occurrences: agg.occurrences,
        conversation_count: agg.conversationIds.size,
        last_seen_at: now,
      });
    }
  }

  let upserted = 0;
  for (let i = 0; i < upsertRows.length; i += UPSERT_BATCH) {
    const chunk = upsertRows.slice(i, i + UPSERT_BATCH);
    const { error } = await supabase.from("phrase_patterns").upsert(chunk, {
      onConflict: "phrase,deal_type,vertical",
    });
    if (error) throw error;
    upserted += chunk.length;
  }

  console.log(`[PHRASE_PATTERN_AGENT] upserted ${upserted} phrase_patterns rows`);
}
