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

/** HubSpot v3: HMAC-SHA256(appSecret, method + url + body + timestamp), digest base64. */
export function verifyHubSpotSignature(
  appSecret: string,
  method: string,
  url: string,
  rawBody: string,
  timestamp: string,
  signature: string
): boolean {
  const source = `${method}${url}${rawBody}${timestamp}`;
  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(source)
    .digest("base64");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}
