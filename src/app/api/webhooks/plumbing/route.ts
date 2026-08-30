import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { getSession, saveSession } from "@/lib/demo/brain/state";
import { fetchMediaAsDataUrl, isSupportedImage } from "@/lib/demo/brain/media";
import { runBrainTurn } from "@/lib/demo/brain/run";
import { plumbingNiche } from "@/lib/demo/niches/plumbing";
import type { TurnContent } from "@/lib/demo/brain/types";

/** A photo turn runs ~5s; the platform default of 10s leaves no headroom. */
export const maxDuration = 30;

/**
 * Rebuilds the URL Twilio actually called.
 *
 * `request.url` is the origin's view, which behind a proxy is not what Twilio
 * signed — Vercel terminates TLS and forwards on a different host and scheme.
 * Signing against it rejects every request. The forwarded headers carry the
 * public values.
 */
function publicUrl(request: NextRequest): string {
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");

  if (!host) return request.url;

  return `${proto}://${host}${new URL(request.url).pathname}`;
}

/**
 * Verifies the request genuinely came from Twilio.
 *
 * Skipped outside production: the signed URL must byte-match the URL Twilio
 * called, and an ngrok host that drifts would reject every request mid-demo.
 */
function signatureIsValid(
  request: NextRequest,
  params: Record<string, string>,
  signature: string | null
): boolean {
  if (process.env.NODE_ENV !== "production") return true;

  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;

  const url = publicUrl(request);
  const valid = twilio.validateRequest(token, signature, url, params);

  if (!valid) {
    // Almost always a URL mismatch rather than an attack, and impossible to
    // diagnose without seeing the URL the signature was checked against.
    console.error(`[plumbing] signature check failed against ${url}`);
  }

  return valid;
}

function twiml(text: string): Response {
  const response = new twilio.twiml.MessagingResponse();
  response.message(text);

  return new Response(response.toString(), {
    headers: { "Content-Type": "text/xml" },
  });
}

/** An empty <Response/> tells Twilio to send the sender nothing at all. */
function noReply(): Response {
  return new Response(new twilio.twiml.MessagingResponse().toString(), {
    headers: { "Content-Type": "text/xml" },
  });
}

/**
 * Shows "typing…" on the customer's phone while the brain runs, and marks
 * their message as read. Twilio clears it on reply or after 25s.
 *
 * Deliberately not awaited: the brain call that follows takes seconds, which
 * is more than enough for this POST to land before the function returns. A
 * failure only costs the visual effect, never the reply. Public Beta endpoint,
 * not yet wrapped by the Node SDK, hence raw fetch.
 */
function sendTypingIndicator(messageSid: string | undefined): void {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!messageSid || !sid || !token) return;

  fetch("https://messaging.twilio.com/v3/Indicators/Typing.json", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString(
        "base64"
      )}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel: "whatsapp", messageId: messageSid }),
  })
    .then(async (response) => {
      if (!response.ok) {
        console.error(
          `[plumbing] typing indicator failed: ${response.status} ${await response.text()}`
        );
      }
    })
    .catch((error) => {
      console.error("[plumbing] typing indicator failed:", error);
    });
}

/** Fire-and-forget. A failure here must never cost the customer their reply. */
async function sendOwnerSummary(summary: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;

  if (!sid || !token || !from) {
    console.error("[plumbing] Twilio env missing, owner summary not sent");
    return;
  }

  if (!plumbingNiche.ownerWhatsApp) {
    console.error(
      "[plumbing] OWNER_WHATSAPP is not set, owner summary not sent"
    );
    return;
  }

  try {
    const message = await twilio(sid, token).messages.create({
      from: `whatsapp:${from.replace("whatsapp:", "")}`,
      to: `whatsapp:${plumbingNiche.ownerWhatsApp}`,
      body: summary,
    });

    // "accepted" is not "delivered". WhatsApp rejects freeform messages sent
    // more than 24h after the recipient last messaged in (error 63016), and
    // that rejection lands asynchronously, well after this call returns.
    console.log(
      `[plumbing] owner summary queued: sid=${message.sid} status=${message.status}`
    );
  } catch (error) {
    console.error("[plumbing] owner summary failed:", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const params = Object.fromEntries(new URLSearchParams(rawBody));

    if (
      !signatureIsValid(
        request,
        params,
        request.headers.get("x-twilio-signature")
      )
    ) {
      console.error("[plumbing] rejected: bad Twilio signature");
      return new NextResponse(null, { status: 403 });
    }

    const from = params.From?.replace("whatsapp:", "");
    const body = params.Body ?? "";
    const numMedia = Number(params.NumMedia ?? "0");

    if (!from) {
      return NextResponse.json({ error: "Missing From" }, { status: 400 });
    }

    console.log(`[plumbing] ${from}: ${body.slice(0, 60)} (media: ${numMedia})`);

    // The owner texts the business number to reopen WhatsApp's 24h freeform
    // window so booking summaries can reach them. That message lands here like
    // any other, so without this guard the bot would start triaging the owner
    // as a customer.
    if (plumbingNiche.ownerWhatsApp && from === plumbingNiche.ownerWhatsApp) {
      console.log("[plumbing] owner inbound, 24h window open, not replying");
      return noReply();
    }

    sendTypingIndicator(params.MessageSid);

    const session = await getSession(from);

    // Build this turn's content. Text first so the model reads the caption
    // before the image.
    const content: TurnContent[] = [];
    if (body.trim()) {
      content.push({ type: "text", text: body });
    }

    let photoReceived = session.photoReceived;

    if (numMedia > 0) {
      const mediaUrl = params.MediaUrl0;
      const mediaType = params.MediaContentType0;

      if (mediaUrl && isSupportedImage(mediaType)) {
        const dataUrl = await fetchMediaAsDataUrl(mediaUrl, mediaType);

        if (dataUrl) {
          content.push({ type: "image_url", image_url: { url: dataUrl } });
          photoReceived = true;
        } else {
          content.push({
            type: "text",
            text: "[customer sent a photo but it could not be loaded]",
          });
        }
      } else {
        content.push({
          type: "text",
          text: "[customer sent a non-image attachment]",
        });
      }
    }

    if (content.length === 0) {
      content.push({ type: "text", text: "[empty message]" });
    }

    const history = [...session.history, { role: "user" as const, content }];

    const result = await runBrainTurn(history, plumbingNiche);

    // A silent turn still goes into history as the sentinel, so on the next
    // turn the model can see it already went quiet and stays quiet.
    await saveSession(from, {
      history: [
        ...history,
        {
          role: "assistant",
          content: result.kind === "silent" ? "[no reply]" : result.text,
        },
      ],
      photoReceived,
      updatedAt: session.updatedAt,
    });

    if (result.kind === "silent") {
      console.log("[plumbing] model chose silence, sending nothing");
      return noReply();
    }

    if (result.kind === "booking") {
      await sendOwnerSummary(
        plumbingNiche.formatOwnerSummary(
          { ...result.booking, photo_received: photoReceived },
          from
        )
      );
    }

    return twiml(result.text);
  } catch (error) {
    console.error("[plumbing] webhook error:", error);
    // Answer with TwiML rather than a 500, so Twilio does not retry and
    // deliver the customer a duplicate.
    return twiml("Sorry, something went wrong our end. Text again in a minute.");
  }
}

export async function GET() {
  return NextResponse.json({
    message: "Plumbing intake webhook is working",
    timestamp: new Date().toISOString(),
    status: "ok",
  });
}
