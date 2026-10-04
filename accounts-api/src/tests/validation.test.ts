import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEmail, profileSchema, provisionSchema } from '../validation.js';
import { verifiedIdentity } from '../auth.js';

test('normalizes account email consistently', () => {
  assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com');
});

test('requires explicit terms acceptance and a privacy notice version', () => {
  const valid = {
    firstName: 'Muiz',
    lastName: 'Adesope',
    phone: '+2348012345678',
    termsAccepted: true,
    privacyNoticeVersion: '2026-10-01',
  };
  assert.equal(profileSchema.safeParse(valid).success, true);
  assert.equal(profileSchema.safeParse({ ...valid, termsAccepted: false }).success, false);
  assert.equal(profileSchema.safeParse({ ...valid, privacyNoticeVersion: '' }).success, false);
});

test('allows account provisioning to be retried without a phone number', () => {
  assert.equal(provisionSchema.safeParse({}).success, true);
  assert.equal(provisionSchema.safeParse({ phone: '+2348012345678' }).success, true);
  assert.equal(provisionSchema.safeParse({ role: 'ADMIN' }).success, false);
});

test('only verified Supabase identities are accepted for provisioning', () => {
  const base = { id: 'auth-id', email: 'user@example.com', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '', role: 'authenticated' };
  assert.equal(verifiedIdentity({ ...base, email_confirmed_at: '2026-10-01T00:00:00Z' } as never)?.email, 'user@example.com');
  assert.equal(verifiedIdentity(base as never), null);
});