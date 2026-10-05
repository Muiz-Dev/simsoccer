import assert from 'node:assert/strict';
import test from 'node:test';
import { emailSchema, normalizeEmail, passwordSchema, profileSchema } from '../validation.js';

test('normalizes account email consistently', () => {
  assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com');
  assert.equal(emailSchema.parse(' User@Example.COM '), 'user@example.com');
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

test('permits phone to be collected later and validates password length without composition rules', () => {
  const validProfile = {
    firstName: 'Muiz',
    lastName: 'Adesope',
    termsAccepted: true,
    privacyNoticeVersion: '2026-10-01',
  };
  assert.equal(profileSchema.safeParse(validProfile).success, true);
  assert.equal(passwordSchema.safeParse('correct horse battery staple').success, true);
  assert.equal(passwordSchema.safeParse('short').success, false);
});

test('profile inputs do not allow clients to assign account roles', () => {
  assert.equal(profileSchema.safeParse({
    firstName: 'Muiz',
    lastName: 'Adesope',
    phone: '+2348012345678',
    termsAccepted: true,
    privacyNoticeVersion: '2026-10-01',
    role: 'ADMIN',
  }).success, false);
});