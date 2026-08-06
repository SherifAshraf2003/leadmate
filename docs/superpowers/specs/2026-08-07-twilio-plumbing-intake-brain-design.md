# Twilio WhatsApp Plumbing Intake Brain — Design

**Date:** 2026-08-07
**Status:** Approved, pending implementation plan

## Purpose

Extract the Twilio-to-LLM conversational core from the existing app into a standalone,
niche-customisable "brain". The first niche is an out-of-hours plumbing intake flow, used
for a live demo over the Twilio WhatsApp sandbox.

The existing GreenAPI transport and the existing Supabase-backed webhook stay untouched.
This work adds a parallel route; it removes nothing.

## Non-goals

- No change to `src/app/api/webhooks/greenApi/route.ts`.
- No change to `src/app/api/webhooks/whatsapp/route.ts`.
- No Supabase reads or writes: no `users`, `conversations`, `leads`, or `knowledge_base`.
- No dashboard integration, no lead extraction, no usage metering.
- No behavioural change to any existing OpenAI caller. The `openai` SDK is upgraded, but the
  four existing call sites keep their current models and parameters.

## Architecture

Three new files:

| File | Responsibility |
| --- | --- |
| `src/app/api/webhooks/plumbing/route.ts` | HTTP boundary: Twilio signature check, form parsing, TwiML response |
| `src/lib/demo/plumbing/prompt.ts` | Niche configuration: firm details, system prompt, slot strings, owner number |
| `src/lib/demo/plumbing/state.ts` | In-memory conversation store keyed by customer phone |

Swapping `prompt.ts` for another niche's file is the intended reuse path. The route and the
state store contain no plumbing-specific logic.

## Request flow

1. Twilio POSTs `application/x-www-form-urlencoded` to `/api/webhooks/plumbing`.
2. Validate `X-Twilio-Signature` against `TWILIO_AUTH_TOKEN`. Skipped when
   `NODE_ENV !== "production"`, because the ngrok host must match the signed URL exactly and
   a mismatch would reject every request during the demo.
3. Read `From`, `Body`, `NumMedia`, `MediaUrl0`.
4. Load conversation history for `From` from the in-memory store.
5. Append the customer turn. When `NumMedia > 0`, fetch and inline the image (see Media
   handling below).
6. Call OpenAI `gpt-5.4-mini` with the plumbing system prompt, the history, and one tool
   definition, `confirm_booking`.
7. If the model calls `confirm_booking`, send the owner summary and reply with the model's
   confirmation text. Otherwise reply with the model's text.
8. Persist the assistant turn to the store.
9. Return TwiML `<Message>`.

## Model access

The official `openai` package is upgraded from the pinned `^4.67.3` to `^7.4.0`. The pinned
version predates the GPT-5 family and sends `max_tokens`, which GPT-5.x rejects in favour of
`max_completion_tokens`.

Four existing call sites import the SDK:

- `src/app/api/webhooks/greenApi/route.ts`
- `src/app/api/webhooks/whatsapp/route.ts`
- `src/lib/services/openai/openai.ts`
- `src/lib/services/leads/extraction.ts`

All four use only `chat.completions.create` or `embeddings.create`, whose signatures are
stable across the v4 to v7 range, and all four stay on `gpt-4o-mini` with `max_tokens`
unchanged. The upgrade is therefore expected to be a no-op for them, but this is an
assumption to verify, not to trust: the implementation must run `tsc --noEmit` after the bump
and confirm all four files compile before any further work. If the upgrade breaks a caller,
stop and report rather than refactoring existing routes.

The new route uses `max_completion_tokens`, as required by GPT-5.x.

The API key comes from `OPENAI_KEY`, matching the existing routes.

## Media handling

WhatsApp inbound supports JPG, JPEG, PNG, audio, and PDF, up to 16MB per message. Twilio
exposes each attachment as `MediaUrl{n}` with a matching `MediaContentType{n}`, and retains
the media for 13 months.

`gpt-5.4-mini` accepts image input, so the photo is read rather than merely acknowledged.
This matters for the intake: the model can judge a ceiling stain's severity or read a boiler
pressure gauge directly off the picture.

Handling, for the first attachment only:

1. If `MediaContentType0` is not an image type, ignore the attachment and append the marker
   `[customer sent a non-image attachment]`.
2. Otherwise fetch `MediaUrl0` with an `Authorization: Basic` header built from
   `TWILIO_ACCOUNT_SID:TWILIO_AUTH_TOKEN`. Media URLs are unauthenticated by default, and
   Basic Auth is an opt-in account setting, so the header is sent unconditionally: harmless
   when the setting is off, required when it is on.
3. Encode the bytes as a base64 `data:` URL and attach it to the turn as an `image_url`
   content block. Inlining is necessary because a pre-signed or authenticated Twilio URL is
   not fetchable by OpenAI.
4. Record that a photo was received on the session, for `confirm_booking`.

Only the first attachment is processed, and only images. Fetch failures degrade to the
`[customer sent a photo]` text marker rather than failing the reply, so a media problem never
costs the customer a response.

Whether the sandbox passes inbound media through is verified in testing step 5 before the
demo, not assumed.

## Intake flow

Five stages, driven by the system prompt rather than a coded state machine:

1. Triage — emergency or can it wait
2. Immediate safety advice where relevant
3. Collect the fault, the postcode, and a photo
4. Offer two slots
5. Confirm one

A hard-coded state machine is rejected because customers routinely answer two questions in
one message, which would desynchronise a rigid stage counter.

### Emergency classification

Treated as emergency, booked same evening: burst pipe, water through a ceiling, flooding, no
heat with an infant or elderly occupant, leaking gas appliance.

### Gas smell

Never booked. The prompt forbids calling `confirm_booking` in this case, so no owner summary
fires. Fixed reply directing the customer to leave the property, avoid switches, and call the
National Gas Emergency Service on 0800 111 999.

### Safety advice by fault

- Ceiling leak — stopcock, usually under the kitchen sink; avoid light switches in that room;
  bucket underneath
- Burst pipe — stopcock off, run cold taps to drain the system
- Blocked toilet — stop flushing or it will overflow
- No hot water — check the boiler pressure gauge and report the number

### Pricing

Never quoted, under any circumstances. The prompt substitutes
"[OWNER] will confirm the cost when he sees it."

### Voice

Short, plain, Northern-English casual, as the owner would text. The assistant does not
volunteer that it is an AI, but answers honestly if asked directly.

## Booking confirmation

`confirm_booking` is the only deterministic edge in the flow. Its arguments:

| Field | Type | Notes |
| --- | --- | --- |
| `problem` | string | The fault in the customer's words |
| `postcode` | string | |
| `slot` | string | One of the two configured slot strings |
| `urgency` | `"emergency"` \| `"routine"` | |
| `photo_received` | boolean | |

On a tool call the route sends a WhatsApp summary to the hard-coded owner number via the
Twilio REST API. This send is fire-and-forget: a failure is logged and swallowed, never
thrown, so a problem reaching the owner cannot prevent the customer receiving their
confirmation.

## Conversation state

A module-level `Map<phone, { history, mediaUrls, updatedAt }>` with a two-hour TTL, swept
lazily on read.

This survives across requests under `next dev` and is lost on restart, which is correct for
an ngrok-tunnelled demo. Upstash Redis is already a dependency and can replace the store
behind the same two functions if the demo later needs to survive deploys.

## Configuration

Placeholders live as constants at the top of `prompt.ts`: `FIRM`, `AREA`, `OWNER`,
`OWNER_WHATSAPP`, and the two slot strings.

Slot strings default to "tonight, 7–9pm" and "tomorrow morning, 8–10am" until real values are
supplied.

Environment variables, all of which the repo already uses: `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `OPENAI_KEY`.

## Error handling

- OpenAI call fails — reply with a plain apology and ask the customer to text again. Never
  surface an error to the customer as a stack trace.
- Owner summary fails — logged, swallowed.
- Signature invalid in production — 403, no body.
- Any unhandled throw — TwiML apology, matching the existing webhook's behaviour, so Twilio
  never sees a 500 and never retries into a duplicate reply.

## Testing

Manual, over the sandbox, since the deliverable is a demo:

1. `next dev`, ngrok tunnel to port 3000, sandbox inbound webhook set to the tunnel URL.
2. Routine fault — confirm the flow reaches two slots and a confirmation, and that the owner
   summary arrives.
3. Gas smell — confirm the 0800 111 999 refusal and that no owner summary is sent.
4. Price question — confirm no figure is given.
5. Photo — send an image of a leak, confirm the sandbox delivers the media, that the model's
   reply demonstrates it actually read the image rather than merely acknowledging it, and
   that `photo_received` is set in the owner summary.
6. Non-image attachment — send a PDF, confirm the flow continues without error.

Ahead of all of the above, run `tsc --noEmit` after the SDK bump and confirm the four
existing OpenAI call sites still compile.

## Demo prerequisites

- The owner's number must join the sandbox by texting the join code to +14155238886.
  Without this the summary send fails silently.
- Sandbox sessions expire after 72 hours idle; both handsets must re-join.
- Sandbox `To` is always the shared +14155238886, which is why tenant resolution is absent
  from this design: there is exactly one tenant, defined by `prompt.ts`.
