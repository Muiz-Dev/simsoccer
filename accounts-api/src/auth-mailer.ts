import { createElement } from 'react';
import { Resend } from 'resend';
import { AuthEmail } from './auth-email.js';
import { env } from './env.js';

export async function sendAuthCode(input: {
  to: string;
  code: string;
  purpose: 'verify' | 'signin' | 'recovery' | 'security';
  idempotencyKey: string;
}): Promise<void> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Error('Authentication email delivery is not configured.');
  }
  const content = {
    verify: {
      title: 'Verify your email',
      message: 'Enter this code in SimSoccer to verify your email address.',
    },
    signin: {
      title: 'Finish signing in',
      message: 'Enter this code in SimSoccer to finish signing in. It can only be used once.',
    },
    recovery: {
      title: 'Reset your password',
      message: 'Enter this code in SimSoccer to reset your password.',
    },
    security: {
      title: 'Confirm your password change',
      message: 'Enter this code in SimSoccer to confirm your password change. It can only be used once.',
    },
  }[input.purpose];
  const resend = new Resend(env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: [input.to],
    subject: content.title,
    react: createElement(AuthEmail, {
      title: content.title,
      preheader: content.title,
      message: content.message,
      code: input.code,
    }),
  }, { idempotencyKey: `simsoccer-auth/${input.idempotencyKey}` });
  if (error || !data?.id) throw new Error('Email provider did not accept the authentication message.');
}

export async function sendPasswordChangedNotice(to: string, idempotencyKey: string): Promise<void> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Error('Authentication email delivery is not configured.');
  }
  const resend = new Resend(env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: [to],
    subject: 'Your SimSoccer password changed',
    react: createElement(AuthEmail, {
      title: 'Your password changed',
      preheader: 'Your SimSoccer password changed',
      message: 'The password for your SimSoccer account was changed. If you did not make this change, reset your password and contact support.',
    }),
  }, { idempotencyKey: `simsoccer-auth/password-change/${idempotencyKey}` });
  if (error || !data?.id) throw new Error('Email provider did not accept the security notice.');
}
