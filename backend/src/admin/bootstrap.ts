import { db, client } from '../db/index';
import { adminCredentials } from '../db/schema/index';
import { hashAdminPin } from './security';
import { getPrimaryAdminCredential } from './security';

function readHiddenInput(prompt: string, digitsOnly = false, maxLength = 32): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Admin bootstrap must be run in an interactive terminal.');
  }

  return new Promise((resolve, reject) => {
    let value = '';
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const finish = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };

    const onData = (input: string) => {
      for (const character of input) {
        if (character === '\u0003') {
          finish(new Error('Admin bootstrap cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u0008' || character === '\u007f') {
          value = value.slice(0, -1);
          continue;
        }
        if ((!digitsOnly || /^\d$/.test(character)) && value.length < maxLength) value += character;
      }
    };

    stdin.on('data', onData);
  });
}

async function bootstrapAdmin(): Promise<void> {
  try {
    const existingCredential = await getPrimaryAdminCredential();
    if (existingCredential) {
      throw new Error('The primary admin credential already exists; bootstrap will not replace it.');
    }

    const confirmation = await readHiddenInput('Type CREATE ADMIN to continue: ', false, 12);
    if (confirmation !== 'CREATE ADMIN') throw new Error('Admin bootstrap cancelled.');

    const pin = await readHiddenInput('Choose a four-digit admin PIN: ', true, 4);
    const confirmationPin = await readHiddenInput('Re-enter the admin PIN: ', true, 4);
    if (!/^\d{4}$/.test(pin) || pin !== confirmationPin) {
      throw new Error('PINs must match and contain exactly four digits.');
    }

    await db.insert(adminCredentials).values({
      id: 'primary',
      pinHash: hashAdminPin(pin),
      failedAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    });
    console.log('Primary admin credential created. Keep ADMIN_PIN_PEPPER available to the API process.');
  } finally {
    await client.end();
  }
}

void bootstrapAdmin().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Admin bootstrap failed.');
  process.exitCode = 1;
});