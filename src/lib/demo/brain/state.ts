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
