export type TextContent = { type: "text"; text: string };

export type ImageContent = {
  type: "image_url";
  image_url: { url: string };
};

export type TurnContent = TextContent | ImageContent;

export type Turn = {
  role: "user" | "assistant";
  content: string | TurnContent[];
};

export type Session = {
  history: Turn[];
  photoReceived: boolean;
  updatedAt: number;
};

export type BookingDetails = {
  problem: string;
  postcode: string;
  slot: string;
  urgency: "emergency" | "routine";
  photo_received: boolean;
  /**
   * The customer-facing confirmation, written by the model in the niche's
   * voice. Carried as a tool argument because models routinely return an
   * empty `content` when they also call a tool, which would otherwise leave
   * the most important message in the flow as canned text.
   */
  confirmation_message: string;
};

/**
 * Everything that makes the brain specific to one trade. Swap this object to
 * retarget the demo; nothing under brain/ should need to change.
 */
export type NicheConfig = {
  /** OpenAI tool name the model calls to confirm a booking. */
  bookingToolName: string;
  /** System prompt, fully rendered with firm details substituted. */
  systemPrompt: string;
  /** JSON schema for the booking tool's arguments. */
  bookingToolSchema: Record<string, unknown>;
  /** WhatsApp number the booking summary goes to, E.164 with no prefix. */
  ownerWhatsApp: string;
  /** Renders a booking into the message the owner receives. */
  formatOwnerSummary: (booking: BookingDetails, customerPhone: string) => string;
};

export type BrainResult =
  | { kind: "reply"; text: string }
  | { kind: "booking"; text: string; booking: BookingDetails }
  /** The model chose to send nothing (dismissed off-topic chat). */
  | { kind: "silent" };
