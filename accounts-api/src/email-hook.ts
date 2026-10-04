import { createElement } from 'react';
import { Resend } from 'resend';
import { Webhook } from 'standardwebhooks';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from './env.js';
import { AuthEmail } from './auth-email.js';

const hookSchema = z.object({
  user: z.object({
    email: z.string().email(),
    new_email: z.string().email().optional(),
  }).passthrough(),
  email_data: z.object({
    token: z.string().optional(),
    token_new: z.string().optional(),
    email_action_type: z.string(),
  }).passthrough(),
}).passthrough();

const authActionCopy: Record<string, { title: string; message: string }> = {
  signup: { title: 'Verify your email', message: 'Enter this code in SimSoccer to finish verifying your email address.' },
  email: { title: 'Verify your email', message: 'Enter this code in SimSoccer to continue.' },
  invite: { title: 'You have been invited', message: 'Enter this code in SimSoccer to continue setting up your account.' },
  magiclink: { title: 'Sign in to SimSoccer', message: 'Enter this one-time code to sign in. It can only be used once.' },
  recovery: { title: 'Reset your password', message: 'Enter this code in SimSoccer to choose a new password.' },
  reauthentication: { title: 'Confirm it is you', message: 'Enter this code in SimSoccer to confirm your identity.' },
  email_change: { title: 'Confirm your email change', message: 'Enter this code in SimSoccer to confirm the requested email change.' },
  password_changed_notification: { title: 'Your password changed', message: 'The password for your SimSoccer account was changed. If this was not you, reset your password immediately.' },
  email_changed_notification: { title: 'Your email changed', message: 'The email address for your SimSoccer account was changed. If this was not you, contact support.' },
  phone_changed_notification: { title: 'Your phone number changed', message: 'The phone number for your SimSoccer account was changed.' },
  identity_linked_notification: { title: 'A sign-in method was linked', message: 'A new sign-in method was linked to your SimSoccer account.' },
  identity_unlinked_notification: { title: 'A sign-in method was removed', message: 'A sign-in method was removed from your SimSoccer account.' },
  mfa_factor_enrolled_notification: { title: 'A verification method was added', message: 'A verification method was added to your SimSoccer account.' },
  mfa_factor_unenrolled_notification: { title: 'A verification method was removed', message: 'A verification method was removed from your SimSoccer account.' },
};

function hookSecret(): string {
  const secret = env.SEND_EMAIL_HOOK_SECRET?.replace(/^v1,whsec_/, '');
  if (!secret) throw new Error('Email hook is not configured.');
  return secret;
}

async function sendAuthEmail(input: {
  idempotencyKey: string;
  to: string;
  action: string;
  code?: string;
}): Promise<void> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error('Email delivery is not configured.');
  const copy = authActionCopy[input.action];
  if (!copy) throw new Error('Unsupported authentication email action.');

  const resend = new Resend(env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: [input.to],
    subject: copy.title,
    react: createElement(AuthEmail, {
      title: copy.title,
      preheader: copy.title,
      message: copy.message,
      code: input.code,
    }),
  }, {
    idempotencyKey: input.idempotencyKey.slice(0, 256),
  });
  if (error || !data?.id) throw new Error('Email provider did not accept the authentication message.');
}

export async function handleSupabaseEmailHook(req: Request, res: Response): Promise<void> {
  if (!Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: 'INVALID_HOOK' });
    return;
  }

  let hookId = '';
  try {
    hookId = req.get('webhook-id') ?? '';
    const webhook = new Webhook(hookSecret());
    const event = hookSchema.parse(webhook.verify(req.body, {
      'webhook-id': hookId,
      'webhook-timestamp': req.get('webhook-timestamp') ?? '',
      'webhook-signature': req.get('webhook-signature') ?? '',
    }));
    const action = event.email_data.email_action_type;

    if (action === 'email_change' && event.user.new_email && event.email_data.token_new) {
      await sendAuthEmail({
        idempotencyKey: `supabase-auth/${hookId}/old`,
        to: event.user.email,
        action,
        code: event.email_data.token,
      });
      await sendAuthEmail({
        idempotencyKey: `supabase-auth/${hookId}/new`,
        to: event.user.new_email,
        action,
        code: event.email_data.token_new,
      });
    } else {
      const recipient = action === 'email_change' ? event.user.new_email ?? event.user.email : event.user.email;
      await sendAuthEmail({
        idempotencyKey: `supabase-auth/${hookId}`,
        to: recipient,
        action,
        code: event.email_data.token,
      });
    }

    res.status(200).json({});
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown email-hook failure.';
    const invalidSignature = message.includes('signature') || message.includes('headers') || message.includes('timestamp');
    console.error(`Supabase email hook failed${hookId ? ` id=${hookId}` : ''}: ${invalidSignature ? 'signature verification failed' : 'delivery or payload processing failed'}`);
    res.status(invalidSignature ? 401 : 503).json({ error: invalidSignature ? 'INVALID_HOOK_SIGNATURE' : 'EMAIL_DELIVERY_FAILED' });
  }
}