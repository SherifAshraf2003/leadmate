import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import type {
  BookingDetails,
  BrainResult,
  NicheConfig,
  Turn,
} from "@/lib/demo/brain/types";

/** GPT-5.x. Accepts image input, which the intake flow depends on. */
export const BRAIN_MODEL = "gpt-5.4-mini" as const;

const MAX_COMPLETION_TOKENS = 500;

const FALLBACK_REPLY =
  "Sorry, having a bit of trouble here. Give us a minute and text again.";

const FALLBACK_BOOKING_REPLY = "That's booked in. See you then.";

/**
 * The existing routes read OPENAI_KEY; .env.local currently uses the SDK's own
 * OPENAI_API_KEY. Accept either so the demo does not depend on which one a
 * given machine happens to have set.
 */
const openai = new OpenAI({
  apiKey: (process.env.OPENAI_KEY ?? process.env.OPENAI_API_KEY) as string,
});

/**
 * Assistant turns are always plain strings; only user turns carry image parts.
 * Splitting them here keeps OpenAI's message union satisfied without a cast.
 */
function toMessage(turn: Turn): ChatCompletionMessageParam {
  if (turn.role === "assistant") {
    return {
      role: "assistant",
      content: typeof turn.content === "string" ? turn.content : "",
    };
  }

  return { role: "user", content: turn.content };
}

/**
 * Runs one turn. Never throws: a failed turn degrades to a plain apology so
 * the customer always receives a message.
 */
export async function runBrainTurn(
  history: Turn[],
  niche: NicheConfig
): Promise<BrainResult> {
  try {
    const completion = await openai.chat.completions.create({
      model: BRAIN_MODEL,
      messages: [
        { role: "system", content: niche.systemPrompt },
        ...history.map(toMessage),
      ],
      tools: [
        {
          type: "function",
          function: {
            name: niche.bookingToolName,
            description:
              "Confirm the job once the fault, the postcode, and an agreed slot are all settled.",
            parameters: niche.bookingToolSchema,
          },
        },
      ],
      max_completion_tokens: MAX_COMPLETION_TOKENS,
    });

    const message = completion.choices[0]?.message;
    const text = message?.content ?? "";

    const booking = extractBooking(message?.tool_calls, niche.bookingToolName);

    if (booking) {
      return {
        kind: "booking",
        text: text || FALLBACK_BOOKING_REPLY,
        booking,
      };
    }

    return { kind: "reply", text: text || FALLBACK_REPLY };
  } catch (error) {
    console.error("[brain] turn failed:", error);
    return { kind: "reply", text: FALLBACK_REPLY };
  }
}

/**
 * openai v7 types tool_calls as a union of function and custom calls, so the
 * `type` narrowing below is required, not defensive noise.
 */
function extractBooking(
  toolCalls: ChatCompletionMessageToolCall[] | undefined,
  expectedName: string
): BookingDetails | null {
  const call = toolCalls?.find(
    (candidate) =>
      candidate.type === "function" && candidate.function.name === expectedName
  );

  if (!call || call.type !== "function") return null;

  try {
    return JSON.parse(call.function.arguments) as BookingDetails;
  } catch (error) {
    console.error("[brain] could not parse booking arguments:", error);
    return null;
  }
}
