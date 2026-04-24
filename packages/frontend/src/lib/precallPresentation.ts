/**
 * Presentation-only helpers: Instant vs Deep voice (no API / schema changes).
 * Strips a shared canned closer so Instant reads tighter and Deep avoids robotic echo.
 */

/** Matches trailing "— if nothing changes, the pressure stays exactly where it is." (common shared closer). */
const CANNED_PRESSURE_CLOSER_END =
  /(?:\s*[—–-])?\s*if nothing changes, the pressure stays exactly where it is\.?\s*$/i;

/** Instant: tactical — remove repeated canned tail (loop in case of duplicate append). */
export function stripCannedPressureCloserInstant(text: string): string {
  if (!text?.trim()) return text;
  let t = text.trim();
  let prev = "";
  while (t !== prev) {
    prev = t;
    t = t.replace(CANNED_PRESSURE_CLOSER_END, "").trim();
  }
  return t;
}

/** Deep: strategic — strip at most one trailing echo; keeps richer mid-sentence framing. */
export function stripCannedPressureCloserDeep(text: string): string {
  if (!text?.trim()) return text;
  return text.trim().replace(CANNED_PRESSURE_CLOSER_END, "").trim();
}
