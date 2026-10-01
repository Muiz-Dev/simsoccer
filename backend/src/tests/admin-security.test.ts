import assert from 'node:assert/strict';
import { hashAdminPin, verifyAdminPin, createAdminSessionToken, verifyAdminSessionToken } from '../admin/security';

const pin = '1234';
const pepper = 'test-only-admin-pin-pepper-with-sufficient-length';
const hash = hashAdminPin(pin, pepper);
assert.notEqual(hash, pin, 'hashed pin should not match plain text');
assert.equal(verifyAdminPin(pin, hash, pepper), true, 'verify should accept the original pin');
assert.equal(verifyAdminPin('9999', hash, pepper), false, 'verify should reject a mismatched pin');
assert.throws(() => hashAdminPin(pin, 'short'), /at least 32 characters/, 'PIN hashing should require a strong pepper');

const token = createAdminSessionToken('primary');
const parsed = verifyAdminSessionToken(token);
assert.equal(parsed.sessionId, 'primary', 'session token should preserve the session id');
assert.equal(parsed.version, 'v1', 'session token should use the expected version');

console.log('admin security checks passed');
