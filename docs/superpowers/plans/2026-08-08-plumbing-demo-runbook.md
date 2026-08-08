# Plumbing Demo Runbook

How to get the WhatsApp plumbing intake demo running, what breaks it, and how to point it at
a different trade.

## What this is

A standalone WhatsApp intake bot. A customer texts the business number; the bot triages the
fault, gives safety advice, collects a postcode and a photo, offers two slots, and books one.
On booking it texts a job summary to the owner's phone.

It touches no Supabase, no dashboard, no lead records. Restarting the server erases every
conversation. That is intentional: the demo is the deliverable.

## Setup

### 1. Environment

`.env.local` must contain:

```
OPENAI_API_KEY=...          # OPENAI_KEY also works
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=+12182503154
OWNER_WHATSAPP=+44...       # where job summaries go, E.164, no whatsapp: prefix
```

`OWNER_WHATSAPP` is read when the module loads. Changing it needs a server restart, not just
a save.

Supabase variables are not required by this route — `src/middleware.ts` excludes
`/api/webhooks/plumbing` from its matcher.

### 2. Start the server

```bash
npm run dev
```

Next picks the first free port. Check the banner — other projects on this machine have
occupied 3000 and 3001 before.

### 3. Open the tunnel

```bash
ngrok http <port>
```

Copy the `https://` forwarding URL.

### 4. Point Twilio at it

Twilio Console → Phone Numbers → `+12182503154` → Messaging → **"A message comes in"**:

```
https://<subdomain>.ngrok-free.app/api/webhooks/plumbing
```

Method `POST`. Save.

The number is an approved WhatsApp sender, so customers message it directly. There is no
sandbox and no join code.

### 5. Open the owner's 24-hour window

**Do this on the morning of the demo, from the owner's handset.**

Text anything to `+12182503154`. The bot will not reply — inbound from `OWNER_WHATSAPP` is
deliberately ignored — but the message opens WhatsApp's 24-hour freeform window, without
which the job summary is silently rejected. See "What breaks it" below.

## Smoke test before a demo

Takes two minutes. From a handset that is **not** the owner's:

| Send | Expect |
| --- | --- |
| `water through my kitchen ceiling` | Urgent tone, stopcock advice, no light switches, bucket |
| `M20 2RN` | Accepts it, moves on |
| `tonight 7-9pm` | Books, and the owner's phone gets the summary |
| `I can smell gas` (fresh number) | 0800 111 999 script, **no booking, no summary** |
| `how much will it cost?` | Defers to the owner, no figure |
| a photo of a leak | Reply describes what is actually in the picture |

If the gas-smell path books anything, stop and fix it before demoing. That is the one failure
with real-world consequences.

## What breaks it

**The 24-hour window.** WhatsApp only allows freeform messages within 24 hours of the
recipient's last inbound message. If the owner's handset has been silent for a day, the job
summary fails with error 63016 — asynchronously, so the server log still shows the message as
queued and nothing looks wrong until you check the phone. Any message from the owner's
handset resets the clock.

The permanent fix is a registered WhatsApp message template, which carries no window. It
needs WhatsApp approval, typically hours to a day. Unnecessary for a demo.

**The ngrok URL changes** every time the tunnel restarts. Re-paste it into the Twilio console.

**Restarting the server wipes all conversation state.** Mid-demo, a restart means the customer
is talking to a bot with no memory of the last four messages.

**The owner's handset cannot play the customer.** Inbound from `OWNER_WHATSAPP` is dropped
without a reply. Use two phones, or temporarily unset `OWNER_WHATSAPP` when testing intake.

**Conversations expire after two hours** of silence, and start fresh after that.

## Checking what happened

Server log:

```bash
tail -f /tmp/leadmate.log | grep -E "\[plumbing\]|\[brain\]"
```

Useful lines:

- `[plumbing] +44...: <message> (media: N)` — an inbound arrived
- `[plumbing] owner summary queued: sid=... status=queued` — accepted by Twilio, **not**
  proof of delivery
- `[plumbing] OWNER_WHATSAPP is not set` — booking happened, nobody was told
- `[plumbing] owner inbound, 24h window open, not replying` — the owner's window-opener
- `[plumbing] media fetch failed: <status>` — photo did not reach the model

To confirm a summary actually landed, fetch the message by SID:

```bash
node -e '
require("dotenv").config({path:".env.local"});
const c = require("twilio")(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
c.messages("<SID>").fetch().then(m => console.log(m.status, m.errorCode, m.errorMessage));
'
```

`delivered` with a null error code is the only good answer.

## Retargeting to another trade

Copy `src/lib/demo/niches/plumbing.ts`, edit it, and point the route's import at the new file.
Nothing under `src/lib/demo/brain/` needs to change — it has no trade-specific logic.

The niche file holds the firm name, area, owner name, the two slot strings, the system prompt,
the `confirm_booking` schema, and the owner summary format.

Two rules the prompt must keep, whatever the trade:

- **Do not reply in plain text on the booking turn.** Put the customer's confirmation in the
  tool's `confirmation_message` field. GPT-5.x returns empty content when it calls a tool, and
  an earlier wording made it draft the reply twice and skip the tool entirely.
- **No markdown.** WhatsApp renders `**bold**` literally.

## Known rough edges

- The bot can re-ask for information the customer already gave, which reads as not listening.
  A prompt instruction to check the history before asking, and to offer slots immediately when
  the customer sounds impatient, has been drafted but not applied.
- Postcode handling assumes UK format. A non-UK postcode may send it into a loop asking again.
- Only the first attachment on a message is processed, and only images.
- Twilio signature validation is skipped outside production, because the signed URL must match
  the ngrok host exactly and a mismatch would reject every request.
