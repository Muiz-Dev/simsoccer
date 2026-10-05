import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateJwk = { ...privateKey.export({ format: 'jwk' }), kid: 'test-signing-key' };
process.env.AUTH_PRIVATE_JWK = JSON.stringify(privateJwk);
process.env.AUTH_ISSUER = 'https://auth.test.example';
process.env.AUTH_TOKEN_PEPPER = 'test-only-auth-token-pepper-value-0001';
process.env.NODE_ENV = 'test';

const { createAccessToken, createEmailCode, digestSecret, publicJwks, verifyAccessToken } = await import('../auth-crypto.js');

test('email codes are eight digits including leading zeroes', () => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    assert.match(createEmailCode(), /^\d{8}$/);
  }
});

test('challenge and device secrets are HMACed consistently', () => {
  assert.equal(digestSecret('same-value'), digestSecret('same-value'));
  assert.notEqual(digestSecret('same-value'), digestSecret('different-value'));
});

test('access tokens use the configured issuer, audience, subject and short expiry', async () => {
  const token = await createAccessToken({
    userId: '00000000-0000-4000-8000-000000000001',
    email: 'user@example.com',
    role: 'USER',
    sessionFamilyId: '00000000-0000-4000-8000-000000000002',
  });
  const { payload, protectedHeader } = await verifyAccessToken(token);
  assert.equal(protectedHeader.alg, 'RS256');
  assert.equal(protectedHeader.kid, 'test-signing-key');
  assert.equal(payload.iss, 'https://auth.test.example');
  assert.equal(payload.aud, 'simsoccer-api');
  assert.equal(payload.sub, '00000000-0000-4000-8000-000000000001');
  assert.equal(payload.role, 'USER');
  assert.ok(typeof payload.exp === 'number' && payload.exp > Math.floor(Date.now() / 1000));
});

test('JWKS exposes only public signing-key material', () => {
  const { keys } = publicJwks();
  assert.equal(keys.length, 1);
  assert.equal(keys[0].kid, 'test-signing-key');
  assert.equal(keys[0].alg, 'RS256');
  assert.equal('d' in keys[0], false);
});
