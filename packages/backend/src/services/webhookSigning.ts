import crypto from "crypto";

export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function signWebhookPayload(secret: string, rawBody: string): string {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signature: string
): boolean {
  const expected = signWebhookPayload(secret, rawBody);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signature.replace("sha256=", ""), "hex")
    );
  } catch {
    return false;
  }
}
