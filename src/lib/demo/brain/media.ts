/** The image types WhatsApp accepts inbound. */
export const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
] as const;

/** Drops any `; charset=...` parameter and lowercases. */
function baseContentType(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}

export function isSupportedImage(
  contentType: string | null | undefined
): boolean {
  if (!contentType) return false;
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(
    baseContentType(contentType)
  );
}

/**
 * Fetches a Twilio media URL and inlines it as a base64 data URL.
 *
 * Inlining is not optional: OpenAI cannot fetch a Twilio media URL itself.
 * The basic auth header is sent unconditionally because "protect media access"
 * is an opt-in per-account Twilio setting — the header is ignored when the
 * setting is off and required when it is on.
 *
 * Returns null on any failure so the caller can degrade to a text marker.
 */
export async function fetchMediaAsDataUrl(
  url: string,
  contentType: string
): Promise<string | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !token) {
    console.error("[plumbing] Twilio credentials missing, skipping media fetch");
    return null;
  }

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString(
          "base64"
        )}`,
      },
    });

    if (!response.ok) {
      console.error("[plumbing] media fetch failed:", response.status);
      return null;
    }

    const base64 = Buffer.from(await response.arrayBuffer()).toString("base64");
    return `data:${baseContentType(contentType)};base64,${base64}`;
  } catch (error) {
    console.error("[plumbing] media fetch threw:", error);
    return null;
  }
}
