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
      subject: 'Verify your SimSoccer email',
      title: 'Verify your email',
      preheader: 'Your email verification code',
      message: 'Enter the code below to verify the email address on your account.',
    },
    signin: {
      subject: 'Your SimSoccer sign-in code',
      title: 'Sign in to SimSoccer',
      preheader: 'Your one-time sign-in code',
      message: 'Enter the code below to finish signing in.',
    },
    recovery: {
      subject: 'Reset your SimSoccer password',
      title: 'Reset your password',
      preheader: 'Your password reset code',
      message: 'Enter the code below to choose a new password.',
    },
    security: {
      subject: 'Password change confirmation',
      title: 'Confirm your password change',
      preheader: 'Your password change code',
      message: 'Enter the code below to confirm this password change.',
    },
  }[input.purpose];
  const securityNote = "Only enter this code on SimSoccer. We'll never ask you to share it.";
  const resend = new Resend(env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: [input.to],
    subject: content.subject,
    text: `${content.title}\n\n${content.message}\n\n${input.code}\n\n${securityNote}`,
    react: createElement(AuthEmail, {
      title: content.title,
      preheader: content.preheader,
      message: content.message,
      code: input.code,
      securityNote,
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
    subject: 'A security change to your account',
    text: "The password for your SimSoccer account was changed. If this wasn't you, reset your password immediately.",
    react: createElement(AuthEmail, {
      title: 'Password changed',
      preheader: "If this wasn't you, reset your password now.",
      message: 'The password for your SimSoccer account was changed. If you did not make this change, reset it immediately.',
    }),
  }, { idempotencyKey: `simsoccer-auth/password-change/${idempotencyKey}` });
  if (error || !data?.id) throw new Error('Email provider did not accept the security notice.');
}
