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
- No SDK upgrades and no `package.json` changes.

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
5. Append the customer turn. When `NumMedia > 0`, append the marker
   `[customer sent a photo]` and record the media URL on the session.
6. Call OpenAI `gpt-5.4-mini` with the plumbing system prompt, the history, and one tool
   definition, `confirm_booking`.
7. If the model calls `confirm_booking`, send the owner summary and reply with the model's
   confirmation text. Otherwise reply with the model's text.
8. Persist the assistant turn to the store.
9. Return TwiML `<Message>`.

## Model access

`gpt-5.4-mini` is called over plain `fetch` against the OpenAI HTTP API, not through the
`openai` package. The repo pins `openai@^4.67.3`, which predates the GPT-5 family and sends
`max_tokens` where GPT-5.x requires `max_completion_tokens`. Upgrading the SDK would touch
every existing OpenAI caller, which this work is not permitted to disturb. A direct `fetch`
confines the change to one file.

The API key comes from `OPENAI_KEY`, matching the existing routes.

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
5. Photo — send an image, confirm it is acknowledged and flagged in the owner summary.

## Demo prerequisites

- The owner's number must join the sandbox by texting the join code to +14155238886.
  Without this the summary send fails silently.
- Sandbox sessions expire after 72 hours idle; both handsets must re-join.
- Sandbox `To` is always the shared +14155238886, which is why tenant resolution is absent
  from this design: there is exactly one tenant, defined by `prompt.ts`.
