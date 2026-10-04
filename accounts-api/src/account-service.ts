import { database } from './database.js';
import type { ProfileInput } from './validation.js';
import { normalizeEmail } from './validation.js';
import type { VerifiedIdentity } from './auth.js';

export class AccountConflictError extends Error {}

export async function provisionAccount(identity: VerifiedIdentity, phone = '') {
  const email = normalizeEmail(identity.email);

  return database.begin(async (tx) => {
    const [bySubject] = await tx<{
      id: string;
      email: string;
      role: string;
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
    }[]>`
      SELECT id, email, role, first_name, last_name, phone
      FROM users
      WHERE auth_subject = ${identity.id}
      FOR UPDATE
    `;

    let account = bySubject;
    if (account && account.email.toLowerCase() !== email) {
      const [emailOwner] = await tx<{ id: string }[]>`
        SELECT id FROM users WHERE lower(email) = ${email} AND id <> ${account.id} LIMIT 1
      `;
      if (emailOwner) throw new AccountConflictError('This email is linked to another account.');
      await tx`UPDATE users SET email = ${email}, updated_at = now() WHERE id = ${account.id}`;
      account.email = email;
    }

    if (!account) {
      const [byEmail] = await tx<{
        id: string;
        auth_subject: string | null;
        role: string;
        first_name: string | null;
        last_name: string | null;
        phone: string | null;
      }[]>`
        SELECT id, auth_subject, role, first_name, last_name, phone
        FROM users
        WHERE lower(email) = ${email}
        FOR UPDATE
      `;

      if (byEmail) {
        if (byEmail.auth_subject || byEmail.role !== 'USER') {
          throw new AccountConflictError('This email needs account support before it can be linked.');
        }
        const [linked] = await tx<{
          id: string;
          email: string;
          role: string;
          first_name: string | null;
          last_name: string | null;
          phone: string | null;
        }[]>`
          UPDATE users
          SET auth_subject = ${identity.id}, updated_at = now()
          WHERE id = ${byEmail.id}
          RETURNING id, email, role, first_name, last_name, phone
        `;
        account = linked;
      } else {
        const [created] = await tx<{
          id: string;
          email: string;
          role: string;
          first_name: string | null;
          last_name: string | null;
          phone: string | null;
        }[]>`
          INSERT INTO users (auth_subject, email, role, phone)
          VALUES (${identity.id}, ${email}, 'USER', ${phone || null})
          RETURNING id, email, role, first_name, last_name, phone
        `;
        account = created;
      }
    }

    if (phone && !account.phone) {
      await tx`UPDATE users SET phone = ${phone}, updated_at = now() WHERE id = ${account.id}`;
      account.phone = phone;
    }

    await tx`
      INSERT INTO wallets (user_id, currency)
      VALUES (${account.id}, 'VIRTUAL')
      ON CONFLICT (user_id) DO NOTHING
    `;

    const [wallet] = await tx<{ balance: string; currency: string }[]>`
      SELECT balance::text, currency FROM wallets WHERE user_id = ${account.id}
    `;

    return {
      id: account.id,
      email: account.email,
      role: account.role,
      firstName: account.first_name,
      lastName: account.last_name,
      phone: account.phone,
      profileComplete: Boolean(account.first_name && account.last_name),
      wallet: wallet ? { balance: wallet.balance, currency: wallet.currency } : null,
    };
  });
}

export async function getAccountBySubject(authSubject: string) {
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
    FROM users u
    LEFT JOIN wallets w ON w.user_id = u.id
    WHERE u.auth_subject = ${authSubject}
    LIMIT 1
  `;
  if (!account) return null;
  return {
    id: account.id,
    email: account.email,
    role: account.role,
    firstName: account.first_name,
    lastName: account.last_name,
    phone: account.phone,
    profileComplete: Boolean(account.first_name && account.last_name),
    wallet: account.balance === null ? null : { balance: account.balance, currency: account.currency },
  };
}

export async function updateAccountProfile(authSubject: string, profile: ProfileInput) {
  const [account] = await database<{ id: string }[]>`
    UPDATE users
    SET first_name = ${profile.firstName},
        last_name = ${profile.lastName},
        phone = ${profile.phone},
        privacy_notice_version = ${profile.privacyNoticeVersion},
        terms_accepted_at = now(),
        updated_at = now()
    WHERE auth_subject = ${authSubject}
    RETURNING id
  `;
  if (!account) return null;
  return getAccountBySubject(authSubject);
}