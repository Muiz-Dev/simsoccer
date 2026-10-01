import crypto from 'node:crypto';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { env } from '../config/env';
import { db } from '../db/index';
import { adminCredentials, adminSessions } from '../db/schema/index';

const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const DEFAULT_IDLE_TTL_MS = 1000 * 60 * 30;

export function hashAdminPin(pin: string, pepper = env.ADMIN_PIN_PEPPER): string {
  if (!pepper || pepper.length < 32) {
    throw new Error('ADMIN_PIN_PEPPER must be configured with at least 32 characters.');
  }

  return crypto.createHmac('sha256', pepper).update(pin.trim()).digest('hex');
}

export function verifyAdminPin(pin: string, storedHash: string, pepper = env.ADMIN_PIN_PEPPER): boolean {
  const candidateHash = hashAdminPin(pin, pepper);
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

export async function getPrimaryAdminCredential() {
  const [credential] = await db.select().from(adminCredentials).where(eq(adminCredentials.id, 'primary')).limit(1);
  return credential ?? null;
}

export function getAdminCookieOptions() {
  return {
    httpOnly: true,
    sameSite: env.NODE_ENV === 'production' ? 'none' as const : 'lax' as const,
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
