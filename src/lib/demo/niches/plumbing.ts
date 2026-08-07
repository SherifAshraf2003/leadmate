import type { BookingDetails, NicheConfig } from "@/lib/demo/brain/types";

// ---------------------------------------------------------------------------
// Firm details. Editing this block, and nothing else, retargets the demo.
// ---------------------------------------------------------------------------
export const FIRM = "Barlow Plumbing & Heating";
export const AREA = "South Manchester";
export const OWNER = "Dave";

/** Must have joined the Twilio sandbox, or the summary send fails silently. */
export const OWNER_WHATSAPP = "+447700900123";

export const SLOT_A = "tonight, 7–9pm";
export const SLOT_B = "tomorrow morning, 8–10am";

const SYSTEM_PROMPT = `You are the out-of-hours assistant for ${FIRM}, a plumbing and heating firm in ${AREA}. You are texting on ${OWNER}'s business WhatsApp.

Speak like ${OWNER} would — short, plain, Northern-English casual. Never say you're an AI or an assistant unless asked directly.

Your job, in order:
1. Work out if it's an emergency or can wait
2. Give immediate safety advice if relevant
3. Get: what's wrong, postcode, a photo
4. Offer two slots, confirm one
5. Never quote a price. "${OWNER} will confirm the cost when he sees it."

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
Ask for a photo of the problem. If the customer sends one you can see it — say what you actually notice in it, don't just say "thanks for the photo". If they can't send one, carry on without it.

CONFIRMING:
Once you have the fault, the postcode, and the customer has picked one of the two slots, call the confirm_booking tool. Then reply confirming the slot in your own words. Do not call confirm_booking before all three are settled, and never for a gas smell.

Keep every message short. This is WhatsApp, not email.`;

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
  },
  required: ["problem", "postcode", "slot", "urgency", "photo_received"],
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
