# Twilio WhatsApp Plumbing Intake Brain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone Twilio WhatsApp webhook that runs a five-stage plumbing intake conversation on `gpt-5.4-mini`, reads customer photos, and texts a booking summary to the firm's owner.

**Architecture:** A niche-agnostic "brain" (session store, Twilio media decoding, one LLM turn) under `src/lib/demo/brain/`, plus a single niche file under `src/lib/demo/niches/` holding the firm's details, system prompt, and booking tool schema. A thin Next.js route handler wires them to Twilio. Swapping the niche file is the entire cost of retargeting the demo to another trade. No Supabase, no existing route touched.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, `openai` SDK v7, `twilio` SDK v5, Vitest for unit tests.

## Global Constraints

- Model for the new route: `gpt-5.4-mini`. Never `gpt-4o-mini`.
- New route uses `max_completion_tokens`, never `max_tokens`. GPT-5.x rejects `max_tokens`.
- Do not pass `temperature` to `gpt-5.4-mini`. GPT-5.x reasoning models accept only the default and error on an explicit value.
- Never modify `src/app/api/webhooks/greenApi/route.ts`, `src/app/api/webhooks/whatsapp/route.ts`, `src/lib/services/openai/openai.ts`, or `src/lib/services/leads/extraction.ts` beyond what a dependency bump forces. If the bump forces a change, stop and report instead of refactoring.
- No Supabase client, no `users`/`conversations`/`leads`/`knowledge_base` access anywhere in new code.
- The assistant must never quote a price. Substitute: `[OWNER] will confirm the cost when he sees it.`
- Gas smell must never produce a booking. The fixed number is `0800 111 999`, the National Gas Emergency Service.
- Import alias is `@/*` → `./src/*`.
- Environment variables, all already used elsewhere in the repo: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `OPENAI_KEY`.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/demo/brain/types.ts` | Shared types: `Turn`, `Session`, `NicheConfig`, `BrainResult` |
| `src/lib/demo/brain/state.ts` | In-memory session store keyed by phone, two-hour TTL |
| `src/lib/demo/brain/media.ts` | Twilio media URL → base64 data URL, image gating |
| `src/lib/demo/brain/run.ts` | One LLM turn: history + niche → reply text or booking |
| `src/lib/demo/niches/plumbing.ts` | Firm constants, system prompt, `confirm_booking` schema, owner summary formatter |
| `src/app/api/webhooks/plumbing/route.ts` | HTTP boundary: signature check, form parse, TwiML out, owner send |

This refines the spec's three-file layout. The spec put everything niche-agnostic in the route; splitting `brain/` from `niches/` is what makes "customise to a different niche" a one-file change, which is the stated goal.

Test files sit beside their subjects as `*.test.ts`.

---

### Task 1: Dependency bump and test harness

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a working `npm test` command; `openai@^7` available to later tasks

- [ ] **Step 1: Record the current state of the four existing OpenAI callers**

Run and save the output somewhere you can compare against later:

```bash
npx tsc --noEmit 2>&1 | tee /tmp/tsc-before.txt; echo "exit: $?"
```

Expected: the repo currently compiles. If it already fails, note the existing failures — they are pre-existing and not yours to fix.

- [ ] **Step 2: Bump the OpenAI SDK**

```bash
npm install openai@^7.4.0
```

- [ ] **Step 3: Verify the bump did not break existing callers**

```bash
npx tsc --noEmit 2>&1 | tee /tmp/tsc-after.txt; echo "exit: $?"
```

Expected: identical to `/tmp/tsc-before.txt`.

If new errors appear in `src/app/api/webhooks/greenApi/route.ts`, `src/app/api/webhooks/whatsapp/route.ts`, `src/lib/services/openai/openai.ts`, or `src/lib/services/leads/extraction.ts`: **stop and report to the user.** Do not refactor those files. They are load-bearing for a demo and out of scope.

- [ ] **Step 4: Install Vitest**

The repo currently has no test runner. Add one as a dev dependency only — it has zero runtime impact.

```bash
npm install -D vitest@^3
```

- [ ] **Step 5: Add the test script**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 6: Create the Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 7: Verify the harness runs**

```bash
npm test
```

Expected: exits 0 with "No test files found" or similar. It must not error on config.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: bump openai to v7 and add vitest harness"
```

---

### Task 2: Shared types

**Files:**
- Create: `src/lib/demo/brain/types.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `TextContent`, `ImageContent`, `TurnContent`, `Turn`, `Session`, `BookingDetails`, `NicheConfig`, `BrainResult` — every later task imports from here

There is no test for this task; it declares types only and is verified by `tsc`.

- [ ] **Step 1: Write the types file**

Create `src/lib/demo/brain/types.ts`:

```ts
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
  | { kind: "booking"; text: string; booking: BookingDetails };
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/demo/brain/types.ts
git commit -m "feat: add shared types for the demo brain"
```

---

### Task 3: Session store

**Files:**
- Create: `src/lib/demo/brain/state.ts`
- Test: `src/lib/demo/brain/state.test.ts`

**Interfaces:**
- Consumes: `Session`, `Turn` from `@/lib/demo/brain/types`
- Produces:
  - `SESSION_TTL_MS: number`
  - `getSession(phone: string, now?: number): Session`
  - `saveSession(phone: string, session: Session, now?: number): void`
  - `clearAllSessions(): void`

The `now` parameter exists so tests can advance time without faking timers. Production callers omit it.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/demo/brain/state.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  getSession,
  saveSession,
  clearAllSessions,
  SESSION_TTL_MS,
} from "./state";

describe("session store", () => {
  beforeEach(() => {
    clearAllSessions();
  });

  it("returns an empty session for an unknown phone", () => {
    const session = getSession("+447700900000");
    expect(session.history).toEqual([]);
    expect(session.photoReceived).toBe(false);
  });

  it("round-trips a saved session", () => {
    saveSession("+447700900000", {
      history: [{ role: "user", content: "tap is leaking" }],
      photoReceived: true,
      updatedAt: 0,
    });

    const session = getSession("+447700900000");
    expect(session.history).toHaveLength(1);
    expect(session.photoReceived).toBe(true);
  });

  it("keeps sessions for different phones separate", () => {
    saveSession("+447700900001", {
      history: [{ role: "user", content: "one" }],
      photoReceived: false,
      updatedAt: 0,
    });

    expect(getSession("+447700900002").history).toEqual([]);
  });

  it("expires a session older than the TTL", () => {
    saveSession(
      "+447700900000",
      { history: [{ role: "user", content: "old" }], photoReceived: true, updatedAt: 0 },
      0
    );

    const session = getSession("+447700900000", SESSION_TTL_MS + 1);
    expect(session.history).toEqual([]);
    expect(session.photoReceived).toBe(false);
  });

  it("keeps a session that is younger than the TTL", () => {
    saveSession(
      "+447700900000",
      { history: [{ role: "user", content: "recent" }], photoReceived: false, updatedAt: 0 },
      0
    );

    const session = getSession("+447700900000", SESSION_TTL_MS - 1);
    expect(session.history).toHaveLength(1);
  });

  it("stamps updatedAt on save", () => {
    saveSession(
      "+447700900000",
      { history: [], photoReceived: false, updatedAt: 0 },
      12345
    );

    expect(getSession("+447700900000", 12345).updatedAt).toBe(12345);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- src/lib/demo/brain/state.test.ts
```

Expected: FAIL — cannot resolve `./state`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/demo/brain/state.ts`:

```ts
import type { Session } from "@/lib/demo/brain/types";

/** Two hours. Long enough for a demo conversation, short enough to self-clean. */
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Module-level store. Survives across requests under `next dev`, dies on
 * restart, and is per-instance on serverless. That is correct for an
 * ngrok-tunnelled demo. Swap the three functions below for Upstash Redis
 * (already a dependency) if this ever needs to outlive a deploy.
 */
const sessions = new Map<string, Session>();

function emptySession(now: number): Session {
  return { history: [], photoReceived: false, updatedAt: now };
}

export function getSession(phone: string, now: number = Date.now()): Session {
  const existing = sessions.get(phone);

  if (!existing) {
    return emptySession(now);
  }

  if (now - existing.updatedAt > SESSION_TTL_MS) {
    sessions.delete(phone);
    return emptySession(now);
  }

  return existing;
}

export function saveSession(
  phone: string,
  session: Session,
  now: number = Date.now()
): void {
  sessions.set(phone, { ...session, updatedAt: now });
}

export function clearAllSessions(): void {
  sessions.clear();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- src/lib/demo/brain/state.test.ts
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/demo/brain/state.ts src/lib/demo/brain/state.test.ts
git commit -m "feat: add in-memory session store for the demo brain"
```

---

### Task 4: Twilio media decoding

**Files:**
- Create: `src/lib/demo/brain/media.ts`
- Test: `src/lib/demo/brain/media.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `SUPPORTED_IMAGE_TYPES: readonly string[]`
  - `isSupportedImage(contentType: string | null | undefined): boolean`
  - `fetchMediaAsDataUrl(url: string, contentType: string): Promise<string | null>`

`fetchMediaAsDataUrl` returns `null` on any failure. The caller degrades to a text marker; a media problem must never cost the customer a reply.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/demo/brain/media.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { isSupportedImage, fetchMediaAsDataUrl } from "./media";

describe("isSupportedImage", () => {
  it("accepts the WhatsApp image types", () => {
    expect(isSupportedImage("image/jpeg")).toBe(true);
    expect(isSupportedImage("image/jpg")).toBe(true);
    expect(isSupportedImage("image/png")).toBe(true);
  });

  it("ignores parameters on the content type", () => {
    expect(isSupportedImage("image/jpeg; charset=binary")).toBe(true);
  });

  it("is case insensitive", () => {
    expect(isSupportedImage("IMAGE/PNG")).toBe(true);
  });

  it("rejects non-images WhatsApp can also send", () => {
    expect(isSupportedImage("application/pdf")).toBe(false);
    expect(isSupportedImage("audio/ogg")).toBe(false);
  });

  it("rejects missing content types", () => {
    expect(isSupportedImage(null)).toBe(false);
    expect(isSupportedImage(undefined)).toBe(false);
    expect(isSupportedImage("")).toBe(false);
  });
});

describe("fetchMediaAsDataUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns a base64 data URL on success", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("hello").buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMediaAsDataUrl("https://api.twilio.com/m/1", "image/png");

    expect(result).toBe(`data:image/png;base64,${Buffer.from("hello").toString("base64")}`);
  });

  it("sends Twilio basic auth", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchMediaAsDataUrl("https://api.twilio.com/m/1", "image/png");

    const expected = `Basic ${Buffer.from("AC123:tok").toString("base64")}`;
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(expected);
  });

  it("strips content type parameters from the data URL", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      })
    );

    const result = await fetchMediaAsDataUrl(
      "https://api.twilio.com/m/1",
      "image/jpeg; charset=binary"
    );

    expect(result?.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("returns null on a non-ok response", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    expect(await fetchMediaAsDataUrl("https://api.twilio.com/m/1", "image/png")).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    expect(await fetchMediaAsDataUrl("https://api.twilio.com/m/1", "image/png")).toBeNull();
  });

  it("returns null when Twilio credentials are missing", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchMediaAsDataUrl("https://api.twilio.com/m/1", "image/png")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- src/lib/demo/brain/media.test.ts
```

Expected: FAIL — cannot resolve `./media`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/demo/brain/media.ts`:

```ts
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
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- src/lib/demo/brain/media.test.ts
```

Expected: 12 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/demo/brain/media.ts src/lib/demo/brain/media.test.ts
git commit -m "feat: decode inbound Twilio media into base64 data URLs"
```

---

### Task 5: The plumbing niche

**Files:**
- Create: `src/lib/demo/niches/plumbing.ts`
- Test: `src/lib/demo/niches/plumbing.test.ts`

**Interfaces:**
- Consumes: `NicheConfig`, `BookingDetails` from `@/lib/demo/brain/types`
- Produces:
  - `FIRM`, `AREA`, `OWNER`, `OWNER_WHATSAPP`, `SLOT_A`, `SLOT_B` — string constants
  - `plumbingNiche: NicheConfig`

`SLOT_A` and `SLOT_B` carry the placeholder values below. The user will replace them with real windows before the demo; they are a one-line edit and are deliberately not parameterised.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/demo/niches/plumbing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { plumbingNiche, OWNER, SLOT_A, SLOT_B } from "./plumbing";

describe("plumbing system prompt", () => {
  const prompt = plumbingNiche.systemPrompt;

  it("substitutes every placeholder", () => {
    expect(prompt).not.toMatch(/\[FIRM\]|\[AREA\]|\[OWNER\]/);
  });

  it("carries the gas emergency number", () => {
    expect(prompt).toContain("0800 111 999");
  });

  it("forbids booking on a gas smell", () => {
    expect(prompt.toLowerCase()).toContain("gas smell");
    expect(prompt).toMatch(/do not (call|use) confirm_booking/i);
  });

  it("forbids quoting a price", () => {
    expect(prompt).toContain(`${OWNER} will confirm the cost when he sees it.`);
  });

  it("offers both configured slots", () => {
    expect(prompt).toContain(SLOT_A);
    expect(prompt).toContain(SLOT_B);
  });

  it("lists the safety advice for each fault", () => {
    expect(prompt).toContain("stopcock");
    expect(prompt).toContain("boiler pressure gauge");
    expect(prompt).toContain("stop flushing");
  });

  it("lists the emergency triggers", () => {
    for (const trigger of ["burst pipe", "flooding", "leaking gas appliance"]) {
      expect(prompt.toLowerCase()).toContain(trigger);
    }
  });
});

describe("booking tool schema", () => {
  it("is named confirm_booking", () => {
    expect(plumbingNiche.bookingToolName).toBe("confirm_booking");
  });

  it("requires every intake field", () => {
    const schema = plumbingNiche.bookingToolSchema as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required.sort()).toEqual(
      ["photo_received", "postcode", "problem", "slot", "urgency"].sort()
    );
    expect(Object.keys(schema.properties).sort()).toEqual(schema.required.sort());
  });
});

describe("owner summary", () => {
  it("includes every booking field and the customer number", () => {
    const summary = plumbingNiche.formatOwnerSummary(
      {
        problem: "water through the kitchen ceiling",
        postcode: "M1 4AA",
        slot: SLOT_A,
        urgency: "emergency",
        photo_received: true,
      },
      "+447700900000"
    );

    expect(summary).toContain("water through the kitchen ceiling");
    expect(summary).toContain("M1 4AA");
    expect(summary).toContain(SLOT_A);
    expect(summary).toContain("+447700900000");
    expect(summary.toUpperCase()).toContain("EMERGENCY");
    expect(summary.toLowerCase()).toContain("photo");
  });

  it("marks a routine job without shouting emergency", () => {
    const summary = plumbingNiche.formatOwnerSummary(
      {
        problem: "dripping tap",
        postcode: "M1 4AA",
        slot: SLOT_B,
        urgency: "routine",
        photo_received: false,
      },
      "+447700900000"
    );

    expect(summary.toUpperCase()).not.toContain("EMERGENCY");
    expect(summary.toLowerCase()).toContain("routine");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- src/lib/demo/niches/plumbing.test.ts
```

Expected: FAIL — cannot resolve `./plumbing`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/demo/niches/plumbing.ts`:

```ts
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
      description: "emergency if it matches the emergency list, otherwise routine",
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- src/lib/demo/niches/plumbing.test.ts
```

Expected: 11 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/demo/niches/plumbing.ts src/lib/demo/niches/plumbing.test.ts
git commit -m "feat: add plumbing intake niche with prompt and booking tool"
```

---

### Task 6: The brain turn

**Files:**
- Create: `src/lib/demo/brain/run.ts`
- Test: `src/lib/demo/brain/run.test.ts`

**Interfaces:**
- Consumes: `Turn`, `NicheConfig`, `BrainResult`, `BookingDetails` from `@/lib/demo/brain/types`
- Produces:
  - `BRAIN_MODEL: "gpt-5.4-mini"`
  - `runBrainTurn(history: Turn[], niche: NicheConfig): Promise<BrainResult>`

On any OpenAI failure, `runBrainTurn` returns a `reply` with a plain apology rather than throwing. The customer always gets an answer.

Note for the implementer: in `openai` v7, `message.tool_calls` entries are a union of function and custom calls. You must narrow on `toolCall.type === "function"` before reading `toolCall.function`. The v4 code elsewhere in this repo does not do this and will not compile if copied.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/demo/brain/run.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NicheConfig } from "@/lib/demo/brain/types";

const createMock = vi.fn();

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

const { runBrainTurn, BRAIN_MODEL } = await import("./run");

const niche: NicheConfig = {
  bookingToolName: "confirm_booking",
  systemPrompt: "SYSTEM",
  bookingToolSchema: { type: "object", properties: {}, required: [] },
  ownerWhatsApp: "+447700900123",
  formatOwnerSummary: () => "summary",
};

describe("runBrainTurn", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("returns the model's text as a reply", async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: "Right, turn the stopcock off.", tool_calls: [] } }],
    });

    const result = await runBrainTurn([{ role: "user", content: "pipe burst" }], niche);

    expect(result).toEqual({ kind: "reply", text: "Right, turn the stopcock off." });
  });

  it("sends the system prompt and history in order", async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: "ok", tool_calls: [] } }],
    });

    await runBrainTurn(
      [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
      ],
      niche
    );

    const messages = createMock.mock.calls[0][0].messages;
    expect(messages[0]).toEqual({ role: "system", content: "SYSTEM" });
    expect(messages[1].content).toBe("first");
    expect(messages[2].content).toBe("second");
  });

  it("uses gpt-5.4-mini with max_completion_tokens and no temperature", async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: "ok", tool_calls: [] } }],
    });

    await runBrainTurn([{ role: "user", content: "hi" }], niche);

    const args = createMock.mock.calls[0][0];
    expect(args.model).toBe("gpt-5.4-mini");
    expect(BRAIN_MODEL).toBe("gpt-5.4-mini");
    expect(args.max_completion_tokens).toBeGreaterThan(0);
    expect(args).not.toHaveProperty("max_tokens");
    expect(args).not.toHaveProperty("temperature");
  });

  it("returns a booking when the model calls the tool", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: "Booked you in for tonight.",
            tool_calls: [
              {
                type: "function",
                function: {
                  name: "confirm_booking",
                  arguments: JSON.stringify({
                    problem: "burst pipe",
                    postcode: "M1 4AA",
                    slot: "tonight, 7–9pm",
                    urgency: "emergency",
                    photo_received: true,
                  }),
                },
              },
            ],
          },
        },
      ],
    });

    const result = await runBrainTurn([{ role: "user", content: "yes tonight" }], niche);

    expect(result.kind).toBe("booking");
    if (result.kind !== "booking") throw new Error("expected a booking");
    expect(result.booking.postcode).toBe("M1 4AA");
    expect(result.text).toBe("Booked you in for tonight.");
  });

  it("supplies fallback text when a booking call carries no message", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                type: "function",
                function: {
                  name: "confirm_booking",
                  arguments: JSON.stringify({
                    problem: "dripping tap",
                    postcode: "M1 4AA",
                    slot: "tomorrow morning, 8–10am",
                    urgency: "routine",
                    photo_received: false,
                  }),
                },
              },
            ],
          },
        },
      ],
    });

    const result = await runBrainTurn([{ role: "user", content: "tomorrow" }], niche);

    expect(result.kind).toBe("booking");
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("ignores a tool call with unparseable arguments", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: "All booked.",
            tool_calls: [
              { type: "function", function: { name: "confirm_booking", arguments: "{not json" } },
            ],
          },
        },
      ],
    });

    const result = await runBrainTurn([{ role: "user", content: "yes" }], niche);

    expect(result).toEqual({ kind: "reply", text: "All booked." });
  });

  it("ignores a tool call with the wrong name", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: "Hmm.",
            tool_calls: [
              { type: "function", function: { name: "something_else", arguments: "{}" } },
            ],
          },
        },
      ],
    });

    const result = await runBrainTurn([{ role: "user", content: "yes" }], niche);

    expect(result).toEqual({ kind: "reply", text: "Hmm." });
  });

  it("returns an apology when the API throws", async () => {
    createMock.mockRejectedValue(new Error("429 rate limited"));

    const result = await runBrainTurn([{ role: "user", content: "hi" }], niche);

    expect(result.kind).toBe("reply");
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("returns an apology when the model returns nothing", async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: null, tool_calls: [] } }] });

    const result = await runBrainTurn([{ role: "user", content: "hi" }], niche);

    expect(result.kind).toBe("reply");
    expect(result.text.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- src/lib/demo/brain/run.test.ts
```

Expected: FAIL — cannot resolve `./run`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/demo/brain/run.ts`:

```ts
import OpenAI from "openai";
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

const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY as string });

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
        ...history,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any,
      tools: [
        {
          type: "function",
          function: {
            name: niche.bookingToolName,
            description:
              "Confirm the job once the fault, the postcode, and an agreed slot are all settled.",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            parameters: niche.bookingToolSchema as any,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolCalls: any[] | undefined,
  expectedName: string
): BookingDetails | null {
  const call = toolCalls?.find(
    (candidate) =>
      candidate?.type === "function" &&
      candidate?.function?.name === expectedName
  );

  if (!call) return null;

  try {
    return JSON.parse(call.function.arguments) as BookingDetails;
  } catch (error) {
    console.error("[brain] could not parse booking arguments:", error);
    return null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- src/lib/demo/brain/run.test.ts
```

Expected: 9 passing.

- [ ] **Step 5: Verify types and lint**

```bash
npx tsc --noEmit && npx eslint src/lib/demo
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/demo/brain/run.ts src/lib/demo/brain/run.test.ts
git commit -m "feat: add niche-agnostic brain turn on gpt-5.4-mini"
```

---

### Task 7: The webhook route

**Files:**
- Create: `src/app/api/webhooks/plumbing/route.ts`

**Interfaces:**
- Consumes: `getSession`/`saveSession` from `@/lib/demo/brain/state`, `isSupportedImage`/`fetchMediaAsDataUrl` from `@/lib/demo/brain/media`, `runBrainTurn` from `@/lib/demo/brain/run`, `plumbingNiche` from `@/lib/demo/niches/plumbing`, types from `@/lib/demo/brain/types`
- Produces: `POST` and `GET` handlers at `/api/webhooks/plumbing`

This task has no unit test. It is an HTTP boundary whose behaviour is verified end-to-end in Task 8 — every piece of logic worth asserting on already lives in a tested module.

- [ ] **Step 1: Write the route**

Create `src/app/api/webhooks/plumbing/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { getSession, saveSession } from "@/lib/demo/brain/state";
import { fetchMediaAsDataUrl, isSupportedImage } from "@/lib/demo/brain/media";
import { runBrainTurn } from "@/lib/demo/brain/run";
import { plumbingNiche } from "@/lib/demo/niches/plumbing";
import type { TurnContent } from "@/lib/demo/brain/types";

/**
 * Verifies the request genuinely came from Twilio.
 *
 * Skipped outside production: the signed URL must byte-match the URL Twilio
 * called, and an ngrok host that drifts would reject every request mid-demo.
 */
function signatureIsValid(
  url: string,
  params: Record<string, string>,
  signature: string | null
): boolean {
  if (process.env.NODE_ENV !== "production") return true;

  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;

  return twilio.validateRequest(token, signature, url, params);
}

function twiml(text: string): Response {
  const response = new twilio.twiml.MessagingResponse();
  response.message(text);

  return new Response(response.toString(), {
    headers: { "Content-Type": "text/xml" },
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

  try {
    await twilio(sid, token).messages.create({
      from: `whatsapp:${from.replace("whatsapp:", "")}`,
      to: `whatsapp:${plumbingNiche.ownerWhatsApp}`,
      body: summary,
    });
    console.log("[plumbing] owner summary sent");
  } catch (error) {
    // Most likely cause: the owner's number has not joined the sandbox.
    console.error("[plumbing] owner summary failed:", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const params = Object.fromEntries(new URLSearchParams(rawBody));

    if (
      !signatureIsValid(
        request.url,
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

    const session = getSession(from);

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

    saveSession(from, {
      history: [...history, { role: "assistant", content: result.text }],
      photoReceived,
      updatedAt: session.updatedAt,
    });

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
```

- [ ] **Step 2: Verify types, lint, and the full test suite**

```bash
npx tsc --noEmit && npx eslint src/lib/demo src/app/api/webhooks/plumbing && npm test
```

Expected: all clean, all tests passing.

- [ ] **Step 3: Verify the route builds and answers**

```bash
npm run dev
```

In a second shell:

```bash
curl -s http://localhost:3000/api/webhooks/plumbing
```

Expected: `{"message":"Plumbing intake webhook is working",...}`

- [ ] **Step 4: Verify a simulated inbound message end to end**

With `npm run dev` still running:

```bash
curl -s -X POST http://localhost:3000/api/webhooks/plumbing \
  -d "From=whatsapp:%2B447700900000" \
  -d "Body=there%27s water coming through my kitchen ceiling" \
  -d "NumMedia=0"
```

Expected: a TwiML `<Response><Message>…</Message></Response>` whose text mentions the stopcock and treats this as urgent. This is a real OpenAI call, so `OPENAI_KEY` must be set in `.env.local`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks/plumbing/route.ts
git commit -m "feat: add Twilio WhatsApp plumbing intake webhook"
```

---

### Task 8: Sandbox verification

**Files:**
- Create: `docs/superpowers/plans/2026-08-07-plumbing-demo-runbook.md`

**Interfaces:**
- Consumes: the deployed route from Task 7
- Produces: a runbook the user follows on demo day

No code. This task confirms the thing actually works over real WhatsApp and writes down how to repeat it.

- [ ] **Step 1: Confirm the prerequisites with the user before testing**

Ask the user to confirm all three. Do not proceed until they have:

1. Their own handset has joined the Twilio sandbox — text the join code to `+14155238886`.
2. **The owner number in `src/lib/demo/niches/plumbing.ts` has also joined the sandbox.** Without this the summary send fails silently and the demo looks broken at its most important moment. Update `OWNER_WHATSAPP` to a number that has actually joined.
3. `SLOT_A` and `SLOT_B` hold the real windows they want to offer, not the placeholders.

- [ ] **Step 2: Expose the local server**

```bash
npm run dev
```

In a second shell:

```bash
ngrok http 3000
```

Note the `https://` forwarding URL.

- [ ] **Step 3: Point the sandbox at it**

In the Twilio console, under Messaging → Try it out → Send a WhatsApp message → Sandbox settings, set **"When a message comes in"** to:

```
https://<your-ngrok-subdomain>.ngrok-free.app/api/webhooks/plumbing
```

Method: `POST`. Save.

- [ ] **Step 4: Test the routine path**

From the joined handset, send: `my kitchen tap won't stop dripping`

Verify, in order:
- A reply arrives that reads as a plain-spoken tradesperson, not a chatbot.
- It asks for the postcode and a photo.
- After supplying both, it offers exactly `SLOT_A` and `SLOT_B` and no others.
- Picking one produces a confirmation.
- The owner's handset receives the summary, with the correct postcode and slot.

- [ ] **Step 5: Test the gas smell path**

Start a fresh conversation — restart `npm run dev` to clear the in-memory store — and send: `I can smell gas in the kitchen`

Verify:
- The reply tells them to leave the property, not touch switches, and ring `0800 111 999`.
- **No booking is offered and no owner summary arrives.** Check the owner's handset to confirm.

- [ ] **Step 6: Test the price refusal**

Send: `how much will it cost?`

Verify: no figure, no range, no "around". The reply defers to the owner.

- [ ] **Step 7: Test the photo path**

Send a photo of a leak, stain, or boiler pressure gauge.

Verify: the reply refers to something actually visible in the image. A generic "thanks for the photo" means the image is not reaching the model — check the dev server log for `[plumbing] media fetch failed` and confirm `NumMedia` arrived as `1`.

- [ ] **Step 8: Test a non-image attachment**

Send a PDF.

Verify: the conversation continues without an error and without the model pretending to have seen a picture.

- [ ] **Step 9: Write the runbook**

Create `docs/superpowers/plans/2026-08-07-plumbing-demo-runbook.md` recording: the ngrok start command, the exact sandbox setting to change, the join-code requirement for both handsets, the 72-hour sandbox expiry, the fact that restarting the dev server wipes conversation state, and which file to edit to retarget the niche.

- [ ] **Step 10: Commit**

```bash
git add docs/superpowers/plans/2026-08-07-plumbing-demo-runbook.md
git commit -m "docs: add plumbing demo runbook"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: architecture → File Structure; request flow → Tasks 6 and 7; model access and the SDK bump → Task 1 and Task 6; media handling → Task 4 plus the route's media block in Task 7; the five intake stages, emergency list, gas smell, safety advice, pricing, and voice → Task 5's prompt, asserted in Task 5's tests; booking confirmation and the owner summary → Tasks 5, 6, and 7; conversation state → Task 3; configuration → Task 5's constants; error handling → the fallbacks in Tasks 4, 6, and 7; testing and demo prerequisites → Task 8.

Two deliberate departures from the spec, both recorded above: the three-file layout became six, split along the brain/niche boundary that the "customise to different niches" goal requires; and Vitest was added, since the repo had no test runner and the spec's manual-only testing left the prompt rules unasserted.

**Type consistency.** `Turn`, `Session`, `BookingDetails`, `NicheConfig`, and `BrainResult` are defined once in Task 2 and imported everywhere. `bookingToolName` is `"confirm_booking"` in the niche, the prompt, and the tests. `SLOT_A`/`SLOT_B` appear in the prompt, the tool schema's `enum`, and the tests from a single definition. `photo_received` is snake_case throughout, matching the JSON schema the model fills in; `photoReceived` is camelCase on `Session`, which is TypeScript-side state. The route reconciles them at the one point they meet, overriding the model's `photo_received` with the session's observed value.
