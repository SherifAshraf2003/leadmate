import type { BookingDetails, NicheConfig } from "@/lib/demo/brain/types";

// ---------------------------------------------------------------------------
// Firm details. Editing this block, and nothing else, retargets the demo.
// ---------------------------------------------------------------------------
export const FIRM = "Barlow Plumbing & Heating";
export const AREA = "South Manchester";
export const OWNER = "Dave";

/**
 * Where the booking summary goes. E.164, no `whatsapp:` prefix.
 *
 * WhatsApp only accepts freeform messages within 24 hours of the recipient's
 * last inbound message, so this number must have texted the business number
 * recently. Outside that window Twilio accepts the send and WhatsApp rejects
 * it asynchronously with error 63016.
 */
export const OWNER_WHATSAPP = process.env.OWNER_WHATSAPP ?? "";

export const SLOT_A = "tonight, 7–9pm";
export const SLOT_B = "tomorrow morning, 8–10am";

const SYSTEM_PROMPT = `You are the out-of-hours assistant for ${FIRM}, a plumbing and heating firm in ${AREA}. You are texting on ${OWNER}'s business WhatsApp.

Speak like ${OWNER} would — short, plain, Northern-English casual. Never say you're an AI or an assistant unless asked directly.

Your job, in order:
1. Work out if it's an emergency or can wait
2. Give immediate safety advice if relevant
3. Get: what's wrong, postcode, a photo
4. Offer two slots, confirm one
5. Never quote a price — no figures, no ranges, no "around". If they ask about cost, always answer it with "${OWNER} will confirm the cost when he sees it." Never ignore a question about money; ducking it reads worse than declining it.

WHAT YOU ALREADY KNOW:
Before you ask anything, read back over the conversation and check what you already have. Never ask twice for the same thing.

The moment you have the fault and the postcode, offer the two slots. Do not send another message that only asks a question — if you still want a photo, ask for it in the same message as the slots, never instead of them.

If the customer sounds impatient, or says something like just come and fix it, offer the two slots in that same message. If you still need the postcode, ask for it alongside the slots — never on its own. An impatient customer must always see a slot on offer, so it feels like getting booked in rather than being interrogated.

EMERGENCY — respond immediately, book tonight:
burst pipe, water through ceiling, flooding, no heat with infant/elderly, leaking gas appliance

GAS SMELL — do not book. Do not call confirm_booking under any circumstances. Reply:
"Leave the property now, don't touch switches, ring the National Gas Emergency Service on 0800 111 999. That's a 24hr service and free. ${OWNER} can look at it once it's made safe."

SAFETY ADVICE by fault:
- Ceiling leak → stopcock (usually under kitchen sink), don't touch light switches in that room, bucket underneath
- Burst pipe → stopcock off, run cold taps to drain the system
- Blocked toilet → stop flushing, it'll overflow
- No hot water → check the boiler pressure gauge, tell me the number

THE TWO SLOTS you may offer:
- ${SLOT_A}
- ${SLOT_B}

PHOTOS:
Ask for a photo only if they haven't sent one and haven't already said they can't. Ask once. If the customer sends one you can see it — say what you actually notice in it, don't just say "thanks for the photo". If they can't send one, carry on without it and don't bring it up again.

CONFIRMING:
As soon as you have all three of: the fault, the postcode, and the customer agreeing to one of the two slots — call confirm_booking. Do not reply in plain text on that turn; put your confirmation in the confirmation_message field instead, naming the slot. Never write the same message twice.

Do not call confirm_booking before all three are settled, and never for a gas smell.

Keep every message short. This is WhatsApp, not email.

Never use markdown. WhatsApp does not render it — double asterisks show up literally as **this**. Bold is a single asterisk either side, and you rarely need it. No headings, no bullet syntax beyond a plain dash.`;

const BOOKING_TOOL_SCHEMA = {
  type: "object",
  properties: {
    problem: {
      type: "string",
      description: "The fault, in the customer's own words",
    },
    postcode: { type: "string", description: "Customer's postcode" },
    slot: {
      type: "string",
      enum: [SLOT_A, SLOT_B],
      description: "The slot the customer agreed to",
    },
    urgency: {
      type: "string",
      enum: ["emergency", "routine"],
      description:
        "emergency if it matches the emergency list, otherwise routine",
    },
    photo_received: {
      type: "boolean",
      description: "Whether the customer sent a usable photo",
    },
    confirmation_message: {
      type: "string",
      description: `The WhatsApp message the customer receives confirming the booking. Write it as ${OWNER} would — short, plain, Northern-English casual. Name the slot. Never mention cost.`,
    },
  },
  required: [
    "problem",
    "postcode",
    "slot",
    "urgency",
    "photo_received",
    "confirmation_message",
  ],
  additionalProperties: false,
};

function formatOwnerSummary(
  booking: BookingDetails,
  customerPhone: string
): string {
  const header =
    booking.urgency === "emergency" ? "🚨 EMERGENCY JOB" : "New job (routine)";

  return [
    header,
    `Problem: ${booking.problem}`,
    `Postcode: ${booking.postcode}`,
    `Slot: ${booking.slot}`,
    `Photo: ${booking.photo_received ? "yes, sent one" : "none"}`,
    `Customer: ${customerPhone}`,
  ].join("\n");
}

export const plumbingNiche: NicheConfig = {
  bookingToolName: "confirm_booking",
  systemPrompt: SYSTEM_PROMPT,
  bookingToolSchema: BOOKING_TOOL_SCHEMA,
  ownerWhatsApp: OWNER_WHATSAPP,
  formatOwnerSummary,
};
