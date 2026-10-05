import assert from 'node:assert/strict';
import { createTicketAccessCode, hashTicketAccessCode, isTicketAccessCode } from '../betting/ticket-access';

const firstCode = createTicketAccessCode();
const secondCode = createTicketAccessCode();

assert.equal(firstCode.length, 24);
assert.equal(isTicketAccessCode(firstCode), true);
assert.notEqual(firstCode, secondCode);
assert.equal(hashTicketAccessCode(firstCode), hashTicketAccessCode(firstCode));
assert.notEqual(hashTicketAccessCode(firstCode), firstCode);
assert.equal(isTicketAccessCode(`${firstCode}x`), false);
assert.equal(isTicketAccessCode('not-a-ticket-code'), false);

console.log('ticket access code checks passed');
