import { Redis } from "@upstash/redis";
import type { Session } from "@/lib/demo/brain/types";

/** Two hours. Long enough for a demo conversation, short enough to self-clean. */
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;

const KEY_PREFIX = "demo:brain:session:";

/**
 * Upstash is used when configured, because a module-level Map is per-instance
 * and serverless spreads a single conversation across instances — the bot would
 * forget its own history at random. Falls back to memory so local development
 * works without Redis credentials.
 */
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

const memorySessions = new Map<string, Session>();

function emptySession(now: number): Session {
  return { history: [], photoReceived: false, updatedAt: now };
}

export function isDurable(): boolean {
  return redis !== null;
}

export async function getSession(
  phone: string,
  now: number = Date.now()
): Promise<Session> {
  if (redis) {
    try {
      // Upstash deserialises JSON values for us, so this is already an object.
      const stored = await redis.get<Session>(`${KEY_PREFIX}${phone}`);
      return stored ?? emptySession(now);
    } catch (error) {
      // A Redis outage must not cost the customer a reply; they simply get a
      // conversation with no memory of earlier turns.
      console.error("[brain] session read failed:", error);
      return emptySession(now);
    }
  }

  const existing = memorySessions.get(phone);

  if (!existing) {
    return emptySession(now);
  }

  if (now - existing.updatedAt > SESSION_TTL_MS) {
    memorySessions.delete(phone);
    return emptySession(now);
  }

  return existing;
}

export async function saveSession(
  phone: string,
  session: Session,
  now: number = Date.now()
): Promise<void> {
  const stamped: Session = { ...session, updatedAt: now };

  if (redis) {
    try {
      // Redis expiry replaces the manual TTL sweep the memory path needs.
      await redis.set(`${KEY_PREFIX}${phone}`, stamped, {
        ex: SESSION_TTL_SECONDS,
      });
    } catch (error) {
      console.error("[brain] session write failed:", error);
    }
    return;
  }

  memorySessions.set(phone, stamped);
}

export function clearAllSessions(): void {
  memorySessions.clear();
}
