import crypto from 'node:crypto';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { adminCredentials, adminSessions } from '../db/schema/index';

const DEFAULT_ADMIN_PIN = '1234';
const DEFAULT_ADMIN_PEPPER = 'sim-soccer-local-dev';
const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const DEFAULT_IDLE_TTL_MS = 1000 * 60 * 30;

export function hashAdminPin(pin: string): string {
  const pepper = process.env.ADMIN_PIN_PEPPER || DEFAULT_ADMIN_PEPPER;
  return crypto.createHmac('sha256', pepper).update(pin.trim()).digest('hex');
}

export function verifyAdminPin(pin: string, storedHash: string): boolean {
  const candidateHash = hashAdminPin(pin);
  if (candidateHash.length !== storedHash.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(candidateHash), Buffer.from(storedHash));
  } catch {
    return false;
  }
}

export function createAdminSessionToken(sessionId: string): string {
  const randomBytes = crypto.randomBytes(16).toString('hex');
  return `sim_admin_v1.${sessionId}.${randomBytes}`;
}

export function verifyAdminSessionToken(token: string): { sessionId: string; version: string; random: string } {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'sim_admin_v1') {
    throw new Error('Invalid admin session token');
  }

  return {
    version: 'v1',
    sessionId: parts[1],
    random: parts[2],
  };
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function readAdminSessionTokenFromRequest(req: Request): string | null {
  if (req.cookies?.sim_admin_session && typeof req.cookies.sim_admin_session === 'string') {
    return req.cookies.sim_admin_session;
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.replace(/^Bearer\s+/i, '').trim() || null;
  }

  return null;
}

export async function ensurePrimaryAdminCredential() {
  const [credential] = await db.select().from(adminCredentials).where(eq(adminCredentials.id, 'primary')).limit(1);

  if (credential) {
    return credential;
  }

  const configuredPin = process.env.ADMIN_PIN || DEFAULT_ADMIN_PIN;
  const pinHash = hashAdminPin(configuredPin);

  const [created] = await db.insert(adminCredentials).values({
    id: 'primary',
    pinHash,
    failedAttempts: 0,
    lockedUntil: null,
    updatedAt: new Date(),
  }).returning();

  return created;
}

export function getAdminCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: DEFAULT_SESSION_TTL_MS,
  };
}

export async function resolveAdminSession(token: string | null) {
  if (!token) {
    return null;
  }

  try {
    verifyAdminSessionToken(token);
  } catch {
    return null;
  }

  const tokenHash = hashSessionToken(token);
  const [session] = await db.select().from(adminSessions).where(eq(adminSessions.tokenHash, tokenHash)).limit(1);

  if (!session) {
    return null;
  }

  const now = Date.now();
  if (session.revokedAt || new Date(session.absoluteExpiresAt).getTime() < now || new Date(session.idleExpiresAt).getTime() < now) {
    await db.update(adminSessions)
      .set({ revokedAt: new Date() })
      .where(eq(adminSessions.id, session.id));
    return null;
  }

  await db.update(adminSessions)
    .set({
      lastSeenAt: new Date(),
      idleExpiresAt: new Date(now + DEFAULT_IDLE_TTL_MS),
    })
    .where(eq(adminSessions.id, session.id));

  return {
    ...session,
    idleExpiresAt: new Date(now + DEFAULT_IDLE_TTL_MS),
  };
}

export async function revokeAdminSession(token: string | null) {
  if (!token) {
    return false;
  }

  const tokenHash = hashSessionToken(token);
  const [session] = await db.select().from(adminSessions).where(eq(adminSessions.tokenHash, tokenHash)).limit(1);

  if (!session) {
    return false;
  }

  await db.update(adminSessions)
    .set({ revokedAt: new Date() })
    .where(eq(adminSessions.id, session.id));

  return true;
}
