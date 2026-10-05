import { createHash, randomBytes } from 'node:crypto';

const TICKET_CODE_BYTES = 18;
const TICKET_CODE_PATTERN = /^[A-Za-z0-9_-]{24}$/;

export function createTicketAccessCode() {
  return randomBytes(TICKET_CODE_BYTES).toString('base64url');
}

export function isTicketAccessCode(value: string) {
  return TICKET_CODE_PATTERN.test(value);
}

export function hashTicketAccessCode(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
