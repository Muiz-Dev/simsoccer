import assert from 'node:assert/strict';
import { hashAdminPin, verifyAdminPin, createAdminSessionToken, verifyAdminSessionToken } from '../admin/security';

const pin = '1234';
const hash = hashAdminPin(pin);
assert.notEqual(hash, pin, 'hashed pin should not match plain text');
assert.equal(verifyAdminPin(pin, hash), true, 'verify should accept the original pin');
assert.equal(verifyAdminPin('9999', hash), false, 'verify should reject a mismatched pin');

const token = createAdminSessionToken('primary');
const parsed = verifyAdminSessionToken(token);
assert.equal(parsed.sessionId, 'primary', 'session token should preserve the session id');
assert.equal(parsed.version, 'v1', 'session token should use the expected version');

console.log('admin security checks passed');
