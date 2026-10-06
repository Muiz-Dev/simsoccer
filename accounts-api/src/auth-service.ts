import argon2 from 'argon2';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { database } from './database.js';
import { sendAuthCode } from './auth-mailer.js';
import {
  createAccessToken,
  createEmailCode,
  createSecret,
  digestSecret,
  requestContextHash,
} from './auth-crypto.js';

const passwordOptions = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const challengeLifetime = 10 * 60 * 1000;
const sessionLifetime = 30 * 24 * 60 * 60 * 1000;
const passwordWorkLimit = 2;
const passwordWorkQueueLimit = 16;
let passwordWorkActive = 0;
const passwordWorkQueue: Array<() => void> = [];

export class AuthCapacityError extends Error {
  readonly status = 503;
}

async function runPasswordWork<T>(task: () => Promise<T>): Promise<T> {
  if (passwordWorkActive >= passwordWorkLimit) {
    if (passwordWorkQueue.length >= passwordWorkQueueLimit) {
      throw new AuthCapacityError('Authentication work queue is full.');
    }
    await new Promise<void>((resolve) => passwordWorkQueue.push(resolve));
  }
  passwordWorkActive += 1;
  try {
    return await task();
  } finally {
    passwordWorkActive -= 1;
    passwordWorkQueue.shift()?.();
  }
}

export type AuthUser = {
  id: string;
  email: string;
  role: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
};

export type ChallengePurpose = 'verify' | 'login' | 'passwordless' | 'recovery' | 'password_change' | 'password_change_verified';

export type ChallengeResult = { challengeId: string };
export type SessionResult = {
  accessToken: string;
  refreshToken: string;
  deviceToken: string;
  account: {
    id: string;
    email: string;
    role: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    profileComplete: boolean;
    wallet: { balance: string; currency: string } | null;
  };
};

function hashesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function createChallenge(
  email: string,
  purpose: ChallengePurpose,
  userId: string | null,
  sendEmail = true,
): Promise<ChallengeResult> {
  const challengeId = createSecret();
  const code = createEmailCode();
  const challengeHash = digestSecret(challengeId);
  const codeHash = digestSecret(`${challengeId}:${code}`);
  const expiresAt = new Date(Date.now() + challengeLifetime);
  await database.begin(async (tx) => {
    await tx`
      UPDATE auth_challenges
      SET consumed_at = now()
      WHERE lower(email) = ${email} AND purpose = ${purpose} AND consumed_at IS NULL
    `;
    await tx`
      INSERT INTO auth_challenges (challenge_hash, user_id, email, purpose, code_hash, expires_at)
      VALUES (${challengeHash}, ${userId}, ${email}, ${purpose}, ${codeHash}, ${expiresAt})
    `;
    await tx`DELETE FROM auth_challenges WHERE expires_at < now() - interval '1 day'`;
  });
  const emailPurpose = purpose === 'verify' ? 'verify'
    : purpose === 'recovery' ? 'recovery'
      : purpose === 'password_change' ? 'security' : 'signin';
  if (sendEmail) {
    await sendAuthCode({
      to: email,
      code,
      purpose: emailPurpose,
      idempotencyKey: challengeHash,
    });
  }
  return { challengeId };
}

export async function register(email: string, password: string): Promise<ChallengeResult> {
  const passwordHash = await runPasswordWork(() => argon2.hash(password, passwordOptions));
  const user = await database.begin(async (tx) => {
    const [existing] = await tx<{ id: string; role: string; is_email_verified: boolean; account_status: string }[]>`
      SELECT id, role, is_email_verified, account_status FROM users WHERE lower(email) = ${email} LIMIT 1
    `;
    if (existing) {
      if (existing.role === 'USER' && !existing.is_email_verified && existing.account_status === 'ACTIVE') {
        const [updated] = await tx<{ id: string }[]>`
          UPDATE users SET password_hash = COALESCE(password_hash, ${passwordHash}), updated_at = now()
          WHERE id = ${existing.id} RETURNING id
        `;
        return updated;
      }
      return null;
    }
    const [created] = await tx<{ id: string }[]>`
      INSERT INTO users (email, password_hash, role, is_email_verified)
      VALUES (${email}, ${passwordHash}, 'USER', false)
      ON CONFLICT (lower(email)) DO NOTHING
      RETURNING id
    `;
    if (created) return created;
    const [raced] = await tx<{ id: string; role: string; is_email_verified: boolean }[]>`
      SELECT id, role, is_email_verified FROM users WHERE lower(email) = ${email} LIMIT 1
    `;
    return raced && raced.role === 'USER' && !raced.is_email_verified ? raced : null;
  });

  if (!user) return createChallenge(email, 'verify', null, false);
  return createChallenge(email, 'verify', user.id);
}

export async function authenticatePassword(
  email: string,
  password: string,
  deviceToken?: string,
): Promise<{
  challenge: ChallengeResult | null;
  needsVerification: boolean;
  sessionUserId: string | null;
}> {
  const [user] = await database<(AuthUser & { password_hash: string | null; is_email_verified: boolean; account_status: string })[]>`
    SELECT id, email, role, first_name, last_name, phone, password_hash, is_email_verified, account_status
    FROM users WHERE lower(email) = ${email} LIMIT 1
  `;
  const passwordHash = user?.password_hash;
  if (!passwordHash) {
    await runPasswordWork(() => argon2.hash(password, passwordOptions));
    return { challenge: null, needsVerification: false, sessionUserId: null };
  }
  if (!await runPasswordWork(() => argon2.verify(passwordHash, password))) {
    return { challenge: null, needsVerification: false, sessionUserId: null };
  }
  if (user.account_status !== 'ACTIVE') {
    return { challenge: null, needsVerification: false, sessionUserId: null };
  }
  if (!user.is_email_verified) {
    return {
      challenge: await createChallenge(email, 'verify', user.id),
      needsVerification: true,
      sessionUserId: null,
    };
  }

  if (deviceToken) {
    const [recognizedDevice] = await database<{ id: string }[]>`
      SELECT id FROM auth_devices
      WHERE user_id = ${user.id}
        AND device_token_hash = ${digestSecret(deviceToken)}
        AND revoked_at IS NULL
        AND last_seen_at > now() - interval '180 days'
      LIMIT 1
    `;
    if (recognizedDevice) {
      return { challenge: null, needsVerification: false, sessionUserId: user.id };
    }
  }

  return {
    challenge: await createChallenge(email, 'login', user.id),
    needsVerification: false,
    sessionUserId: null,
  };
}

export async function requestPasswordless(email: string): Promise<ChallengeResult> {
  const [user] = await database<{ id: string; is_email_verified: boolean; account_status: string }[]>`
    SELECT id, is_email_verified, account_status FROM users WHERE lower(email) = ${email} LIMIT 1
  `;
  const canSignIn = Boolean(user?.is_email_verified && user.account_status === 'ACTIVE');
  return createChallenge(email, 'passwordless', canSignIn && user ? user.id : null, canSignIn);
}

export async function requestPasswordRecovery(email: string): Promise<ChallengeResult> {
  const [user] = await database<{ id: string; is_email_verified: boolean; account_status: string }[]>`
    SELECT id, is_email_verified, account_status FROM users WHERE lower(email) = ${email} LIMIT 1
  `;
  const canRecover = Boolean(user?.is_email_verified && user.account_status === 'ACTIVE');
  return createChallenge(email, 'recovery', canRecover && user ? user.id : null, canRecover);
}

async function consumeChallenge(challengeId: string, code: string, purposes: ChallengePurpose[]) {
  return database.begin(async (tx) => {
    const [challenge] = await tx<{
      id: string;
      user_id: string | null;
      email: string;
      purpose: ChallengePurpose;
      code_hash: string;
      attempts: number;
      expires_at: Date;
      consumed_at: Date | null;
    }[]>`
      SELECT id, user_id, email, purpose, code_hash, attempts, expires_at, consumed_at
      FROM auth_challenges WHERE challenge_hash = ${digestSecret(challengeId)} FOR UPDATE
    `;
    if (!challenge || !purposes.includes(challenge.purpose) || challenge.consumed_at || challenge.attempts >= 5) {
      return null;
    }
    if (challenge.expires_at.getTime() <= Date.now()) {
      await tx`UPDATE auth_challenges SET consumed_at = now() WHERE id = ${challenge.id}`;
      return null;
    }
    const codeHash = digestSecret(`${challengeId}:${code}`);
    if (!hashesMatch(challenge.code_hash, codeHash)) {
      const attempts = challenge.attempts + 1;
      await tx`
        UPDATE auth_challenges
        SET attempts = ${attempts}, consumed_at = CASE WHEN ${attempts} >= 5 THEN now() ELSE consumed_at END
        WHERE id = ${challenge.id}
      `;
      return null;
    }
    await tx`UPDATE auth_challenges SET consumed_at = now() WHERE id = ${challenge.id}`;
    return challenge;
  });
}

async function loadUser(userId: string): Promise<AuthUser | null> {
  const [user] = await database<AuthUser[]>`
    SELECT id, email, role, first_name, last_name, phone
    FROM users WHERE id = ${userId} AND is_email_verified = true AND account_status = 'ACTIVE' LIMIT 1
  `;
  return user ?? null;
}

function makeAccount(user: AuthUser, wallet: { balance: string; currency: string } | null) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    firstName: user.first_name,
    lastName: user.last_name,
    phone: user.phone,
    profileComplete: Boolean(user.first_name && user.last_name),
    wallet,
  };
}

export async function createSession(
  userId: string,
  deviceCookie: string | undefined,
  userAgent: string | undefined,
  ip: string | undefined,
): Promise<SessionResult> {
  const user = await loadUser(userId);
  if (!user) throw new Error('Verified account no longer exists.');
  const familyId = randomUUID();
  const refreshToken = createSecret();
  const deviceToken = deviceCookie || createSecret();
  const refreshExpiresAt = new Date(Date.now() + sessionLifetime);
  const deviceHash = digestSecret(deviceToken);

  const wallet = await database.begin(async (tx) => {
    const [activeUser] = await tx<{ id: string }[]>`
      SELECT id FROM users
      WHERE id = ${userId} AND is_email_verified = true AND account_status = 'ACTIVE'
      FOR UPDATE
    `;
    if (!activeUser) throw new Error('Account is unavailable for sign-in.');
    await tx`DELETE FROM auth_sessions WHERE expires_at < now() - interval '30 days'`;
    await tx`DELETE FROM auth_devices WHERE revoked_at < now() - interval '30 days' OR last_seen_at < now() - interval '180 days'`;
    await tx`
      INSERT INTO wallets (user_id, currency) VALUES (${userId}, 'VIRTUAL')
      ON CONFLICT (user_id) DO NOTHING
    `;
    const [device] = await tx<{ id: string }[]>`
      INSERT INTO auth_devices (user_id, device_token_hash)
      VALUES (${userId}, ${deviceHash})
      ON CONFLICT (user_id, device_token_hash) DO UPDATE SET last_seen_at = now(), revoked_at = NULL
      RETURNING id
    `;
    await tx`
      INSERT INTO auth_sessions (user_id, family_id, device_id, refresh_token_hash, expires_at, user_agent_hash, ip_hash)
      VALUES (
        ${userId}, ${familyId}, ${device.id}, ${digestSecret(refreshToken)}, ${refreshExpiresAt},
        ${requestContextHash(userAgent)}, ${requestContextHash(ip)}
      )
    `;
    const [currentWallet] = await tx<{ balance: string; currency: string }[]>`
      SELECT balance::text, currency FROM wallets WHERE user_id = ${userId}
    `;
    return currentWallet ?? null;
  });

  const accessToken = await createAccessToken({
    userId,
    email: user.email,
    role: user.role,
    sessionFamilyId: familyId,
  });
  return { accessToken, refreshToken, deviceToken, account: makeAccount(user, wallet) };
}

export async function verifyEmailChallenge(challengeId: string, code: string) {
  const challenge = await consumeChallenge(challengeId, code, ['verify', 'login', 'passwordless']);
  if (!challenge?.user_id) return null;
  if (challenge.purpose === 'verify') {
    await database`
      UPDATE users SET is_email_verified = true, updated_at = now()
      WHERE id = ${challenge.user_id} AND account_status = 'ACTIVE'
    `;
  }
  const user = await loadUser(challenge.user_id);
  return user ? { user, purpose: challenge.purpose } : null;
}

export async function refreshSession(
  refreshToken: string,
  userAgent: string | undefined,
  ip: string | undefined,
) {
  const nextToken = createSecret();
  const result = await database.begin(async (tx) => {
    const [current] = await tx<{
      id: string;
      user_id: string;
      family_id: string;
      device_id: string | null;
      expires_at: Date;
      consumed_at: Date | null;
      revoked_at: Date | null;
    }[]>`
      SELECT id, user_id, family_id, device_id, expires_at, consumed_at, revoked_at
      FROM auth_sessions WHERE refresh_token_hash = ${digestSecret(refreshToken)} FOR UPDATE
    `;
    if (!current) return { status: 'invalid' as const };
    if (current.consumed_at) {
      await tx`UPDATE auth_sessions SET revoked_at = now() WHERE family_id = ${current.family_id}`;
      return { status: 'reused' as const, familyId: current.family_id };
    }
    if (current.revoked_at || current.expires_at.getTime() <= Date.now()) {
      return { status: 'invalid' as const };
    }
    const [user] = await tx<(AuthUser & { is_email_verified: boolean; account_status: string })[]>`
      SELECT id, email, role, first_name, last_name, phone, is_email_verified, account_status
      FROM users WHERE id = ${current.user_id} LIMIT 1
    `;
    if (!user?.is_email_verified || user.account_status !== 'ACTIVE') return { status: 'invalid' as const };
    await tx`UPDATE auth_sessions SET consumed_at = now(), last_used_at = now() WHERE id = ${current.id}`;
    await tx`
      INSERT INTO auth_sessions (user_id, family_id, device_id, refresh_token_hash, expires_at, user_agent_hash, ip_hash)
      VALUES (
        ${current.user_id}, ${current.family_id}, ${current.device_id}, ${digestSecret(nextToken)}, ${current.expires_at},
        ${requestContextHash(userAgent)}, ${requestContextHash(ip)}
      )
    `;
    if (current.device_id) {
      await tx`
        UPDATE auth_devices SET last_seen_at = now()
        WHERE id = ${current.device_id} AND revoked_at IS NULL
      `;
    }
    const [wallet] = await tx<{ balance: string; currency: string }[]>`
      SELECT balance::text, currency FROM wallets WHERE user_id = ${current.user_id}
    `;
    return {
      status: 'ok' as const,
      user,
      familyId: current.family_id,
      wallet: wallet ?? null,
    };
  });

  if (result.status !== 'ok') return result;
  return {
    status: result.status,
    refreshToken: nextToken,
    accessToken: await createAccessToken({
      userId: result.user.id,
      email: result.user.email,
      role: result.user.role,
      sessionFamilyId: result.familyId,
    }),
    account: makeAccount(result.user, result.wallet),
  };
}

export async function revokeRefreshSession(refreshToken: string): Promise<void> {
  await database`
    UPDATE auth_sessions SET revoked_at = now()
    WHERE family_id IN (
      SELECT family_id FROM auth_sessions WHERE refresh_token_hash = ${digestSecret(refreshToken)}
    )
  `;
}

export async function listActiveSessions(userId: string, currentFamilyId: string) {
  return database<{
    familyId: string;
    createdAt: Date;
    lastUsedAt: Date;
    current: boolean;
    deviceRecognized: boolean;
  }[]>`
    SELECT family_id AS "familyId",
           min(created_at) AS "createdAt",
           max(last_used_at) AS "lastUsedAt",
           bool_or(family_id = ${currentFamilyId}) AS current,
           bool_and(device_id IS NOT NULL) AS "deviceRecognized"
    FROM auth_sessions
    WHERE user_id = ${userId} AND revoked_at IS NULL AND expires_at > now()
    GROUP BY family_id
    ORDER BY max(last_used_at) DESC
  `;
}

export async function revokeSessionFamily(userId: string, familyId: string): Promise<void> {
  await database`
    UPDATE auth_sessions SET revoked_at = now()
    WHERE user_id = ${userId} AND family_id = ${familyId} AND revoked_at IS NULL
  `;
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await database.begin(async (tx) => {
    await tx`
      UPDATE auth_sessions SET revoked_at = now()
      WHERE user_id = ${userId} AND revoked_at IS NULL
    `;
    await tx`
      UPDATE auth_devices SET revoked_at = now()
      WHERE user_id = ${userId} AND revoked_at IS NULL
    `;
  });
}

export async function completePasswordRecovery(challengeId: string, code: string, password: string): Promise<string | null> {
  const challenge = await consumeChallenge(challengeId, code, ['recovery']);
  if (!challenge?.user_id) return null;
  const passwordHash = await runPasswordWork(() => argon2.hash(password, passwordOptions));
  return database.begin(async (tx) => {
    const [updatedUser] = await tx<{ id: string }[]>`
      UPDATE users SET password_hash = ${passwordHash}, updated_at = now()
      WHERE id = ${challenge.user_id} AND is_email_verified = true AND account_status = 'ACTIVE'
      RETURNING id
    `;
    if (!updatedUser) return null;
    await tx`
      UPDATE auth_sessions SET revoked_at = now()
      WHERE user_id = ${challenge.user_id} AND revoked_at IS NULL
    `;
    await tx`
      UPDATE auth_devices SET revoked_at = now()
      WHERE user_id = ${challenge.user_id} AND revoked_at IS NULL
    `;
    return challenge.email;
  });
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<string | null> {
  return database.begin(async (tx) => {
    const [user] = await tx<{ password_hash: string | null; email: string; account_status: string }[]>`
      SELECT password_hash, email, account_status FROM users WHERE id = ${userId} AND is_email_verified = true FOR UPDATE
    `;
    const passwordHash = user?.password_hash;
    if (!passwordHash
      || user.account_status !== 'ACTIVE'
      || !await runPasswordWork(() => argon2.verify(passwordHash, currentPassword))) {
      return null;
    }
    const newHash = await runPasswordWork(() => argon2.hash(newPassword, passwordOptions));
    await tx`
      UPDATE users SET password_hash = ${newHash}, updated_at = now()
      WHERE id = ${userId} AND account_status = 'ACTIVE'
    `;
    await tx`
      UPDATE auth_sessions SET revoked_at = now()
      WHERE user_id = ${userId} AND revoked_at IS NULL
    `;
    await tx`
      UPDATE auth_devices SET revoked_at = now()
      WHERE user_id = ${userId} AND revoked_at IS NULL
    `;
    return user.email;
  });
}

export async function requestPasswordChange(userId: string): Promise<ChallengeResult | null> {
  const [user] = await database<{ email: string }[]>`
    SELECT email FROM users WHERE id = ${userId} AND is_email_verified = true AND account_status = 'ACTIVE' LIMIT 1
  `;
  if (!user) return null;
  return createChallenge(user.email, 'password_change', userId);
}

export async function verifyPasswordChangeCode(
  userId: string,
  challengeId: string,
  code: string,
): Promise<string | null> {
  const verifiedChallengeId = createSecret();
  return database.begin(async (tx) => {
    const [challenge] = await tx<{
      id: string;
      user_id: string | null;
      email: string;
      code_hash: string;
      attempts: number;
      expires_at: Date;
      consumed_at: Date | null;
    }[]>`
      SELECT id, user_id, email, code_hash, attempts, expires_at, consumed_at
      FROM auth_challenges
      WHERE challenge_hash = ${digestSecret(challengeId)} AND purpose = 'password_change'
      FOR UPDATE
    `;
    if (!challenge
      || challenge.user_id !== userId
      || challenge.consumed_at
      || challenge.attempts >= 5
      || challenge.expires_at.getTime() <= Date.now()) {
      return null;
    }

    if (!hashesMatch(challenge.code_hash, digestSecret(`${challengeId}:${code}`))) {
      const attempts = challenge.attempts + 1;
      await tx`
        UPDATE auth_challenges
        SET attempts = ${attempts}, consumed_at = CASE WHEN ${attempts} >= 5 THEN now() ELSE consumed_at END
        WHERE id = ${challenge.id}
      `;
      return null;
    }

    await tx`UPDATE auth_challenges SET consumed_at = now() WHERE id = ${challenge.id}`;
    await tx`
      INSERT INTO auth_challenges (challenge_hash, user_id, email, purpose, code_hash, expires_at)
      VALUES (
        ${digestSecret(verifiedChallengeId)}, ${userId}, ${challenge.email}, 'password_change_verified',
        ${digestSecret(verifiedChallengeId)}, ${new Date(Date.now() + challengeLifetime)}
      )
    `;
    return verifiedChallengeId;
  });
}

export async function completePasswordChange(
  userId: string,
  verifiedChallengeId: string,
  newPassword: string,
): Promise<string | null> {
  const passwordHash = await runPasswordWork(() => argon2.hash(newPassword, passwordOptions));
  return database.begin(async (tx) => {
    const [user] = await tx<{ email: string }[]>`
      SELECT email FROM users WHERE id = ${userId} AND is_email_verified = true AND account_status = 'ACTIVE' FOR UPDATE
    `;
    if (!user) return null;

    const [challenge] = await tx<{
      id: string;
      user_id: string | null;
      expires_at: Date;
      consumed_at: Date | null;
    }[]>`
      SELECT id, user_id, expires_at, consumed_at
      FROM auth_challenges
      WHERE challenge_hash = ${digestSecret(verifiedChallengeId)} AND purpose = 'password_change_verified'
      FOR UPDATE
    `;
    if (!challenge
      || challenge.user_id !== userId
      || challenge.consumed_at
      || challenge.expires_at.getTime() <= Date.now()) {
      return null;
    }

    await tx`UPDATE auth_challenges SET consumed_at = now() WHERE id = ${challenge.id}`;
    await tx`
      UPDATE users SET password_hash = ${passwordHash}, updated_at = now()
      WHERE id = ${userId}
    `;
    await tx`
      UPDATE auth_sessions SET revoked_at = now()
      WHERE user_id = ${userId} AND revoked_at IS NULL
    `;
    await tx`
      UPDATE auth_devices SET revoked_at = now()
      WHERE user_id = ${userId} AND revoked_at IS NULL
    `;
    return user.email;
  });
}

export async function getAccount(userId: string) {
  const [account] = await database<{
    id: string;
    email: string;
    role: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    balance: string | null;
    currency: string | null;
  }[]>`
    SELECT u.id, u.email, u.role, u.first_name, u.last_name, u.phone,
           w.balance::text, w.currency
    FROM users u LEFT JOIN wallets w ON w.user_id = u.id
    WHERE u.id = ${userId} AND u.is_email_verified = true LIMIT 1
  `;
  if (!account) return null;
  return makeAccount(account, account.balance === null ? null : {
    balance: account.balance,
    currency: account.currency ?? 'VIRTUAL',
  });
}

export async function updateAccountProfile(userId: string, profile: {
  firstName: string;
  lastName: string;
  phone?: string;
  termsAccepted: true;
  privacyNoticeVersion: string;
}) {
  const [updated] = await database<{ id: string }[]>`
    UPDATE users
    SET first_name = ${profile.firstName},
        last_name = ${profile.lastName},
        phone = ${profile.phone || null},
        privacy_notice_version = ${profile.privacyNoticeVersion},
        terms_accepted_at = now(),
        updated_at = now()
    WHERE id = ${userId} AND is_email_verified = true AND account_status = 'ACTIVE'
    RETURNING id
  `;
  return updated ? getAccount(userId) : null;
}

export async function updateProfileDetails(userId: string, profile: {
  firstName: string;
  lastName: string;
  phone?: string;
}) {
  const [updated] = await database<{ id: string }[]>`
    UPDATE users
    SET first_name = ${profile.firstName},
        last_name = ${profile.lastName},
        phone = ${profile.phone || null},
        updated_at = now()
    WHERE id = ${userId} AND is_email_verified = true AND account_status = 'ACTIVE'
    RETURNING id
  `;
  return updated ? getAccount(userId) : null;
}

export async function cleanupExpiredAuthData(): Promise<void> {
  await database`DELETE FROM auth_challenges WHERE expires_at < now() - interval '1 day'`;
  await database`DELETE FROM auth_sessions WHERE expires_at < now() - interval '30 days'`;
  await database`
    DELETE FROM auth_devices
    WHERE revoked_at < now() - interval '30 days'
       OR last_seen_at < now() - interval '180 days'
  `;
}
