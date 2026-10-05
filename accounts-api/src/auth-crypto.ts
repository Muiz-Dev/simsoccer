import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { importJWK, SignJWT, type JWK } from 'jose';
import { env } from './env.js';

const privateJwk = JSON.parse(env.AUTH_PRIVATE_JWK as string) as JWK;
if (
  privateJwk.kty !== 'RSA'
  || typeof privateJwk.kid !== 'string'
  || !privateJwk.kid
  || typeof privateJwk.d !== 'string'
  || typeof privateJwk.n !== 'string'
  || Buffer.from(privateJwk.n, 'base64url').byteLength < 256
) {
  throw new Error('AUTH_PRIVATE_JWK must contain an RSA private key of at least 2048 bits with a key id.');
}

const parsedAdditionalKeys: unknown = env.AUTH_ADDITIONAL_PUBLIC_JWKS
  ? JSON.parse(env.AUTH_ADDITIONAL_PUBLIC_JWKS)
  : [];
if (!Array.isArray(parsedAdditionalKeys)) {
  throw new Error('AUTH_ADDITIONAL_PUBLIC_JWKS must be a JSON array of public RSA signing keys.');
}
const additionalPublicKeys = parsedAdditionalKeys as JWK[];
const additionalKeyIds = new Set<string>();
for (const key of additionalPublicKeys) {
  if (typeof key !== 'object' || key === null) {
    throw new Error('AUTH_ADDITIONAL_PUBLIC_JWKS must contain public RSA signing keys only.');
  }
  const includesPrivateMaterial = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].some((field) => field in key);
  if (
    key.kty !== 'RSA'
    || typeof key.kid !== 'string'
    || !key.kid
    || typeof key.n !== 'string'
    || typeof key.e !== 'string'
    || includesPrivateMaterial
    || key.kid === privateJwk.kid
    || additionalKeyIds.has(key.kid)
  ) {
    throw new Error('AUTH_ADDITIONAL_PUBLIC_JWKS must contain unique, public RSA signing keys only.');
  }
  additionalKeyIds.add(key.kid);
}
const signingKeyPromise = importJWK(privateJwk, 'RS256');

export function digestSecret(value: string): string {
  return createHmac('sha256', env.AUTH_TOKEN_PEPPER as string).update(value).digest('hex');
}

export function createSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function createEmailCode(): string {
  return randomInt(0, 100_000_000).toString().padStart(8, '0');
}

export async function createAccessToken(input: {
  userId: string;
  email: string;
  role: string;
  sessionFamilyId: string;
}): Promise<string> {
  return new SignJWT({ email: input.email, role: input.role, sid: input.sessionFamilyId })
    .setProtectedHeader({ alg: 'RS256', kid: privateJwk.kid, typ: 'JWT' })
    .setIssuer(env.AUTH_ISSUER as string)
    .setAudience('simsoccer-api')
    .setSubject(input.userId)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(await signingKeyPromise);
}

export async function verifyAccessToken(token: string) {
  const { createLocalJWKSet, jwtVerify } = await import('jose');
  const verificationKeys = createLocalJWKSet(publicJwks());
  return jwtVerify(token, verificationKeys, {
    algorithms: ['RS256'],
    issuer: env.AUTH_ISSUER as string,
    audience: 'simsoccer-api',
  });
}

export function publicJwks(): { keys: JWK[] } {
  const {
    d: _d, p: _p, q: _q, dp: _dp, dq: _dq, qi: _qi, oth: _oth,
    key_ops: _keyOps, ...publicKey
  } = privateJwk;
  return {
    keys: [
      { ...publicKey, alg: 'RS256', use: 'sig', key_ops: ['verify'] },
      ...additionalPublicKeys.map((key) => ({ ...key, alg: 'RS256', use: 'sig', key_ops: ['verify'] })),
    ],
  };
}

export function requestContextHash(value: string | undefined): string | null {
  return value ? digestSecret(value.slice(0, 512)) : null;
}
