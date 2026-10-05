import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthEmail } from '../auth-email.js';

test('renders a centered, white authentication email without card decoration', () => {
  const html = renderToStaticMarkup(
    AuthEmail({
      title: 'Verify your email',
      preheader: 'Your email verification code',
      message: 'Enter the code below to verify the email address on your account.',
      code: '12345678',
      securityNote: "Only enter this code on SimSoccer. We'll never ask you to share it.",
    }),
  );

  assert.match(html, /background-color:#ffffff/);
  assert.match(html, /text-align:center/);
  assert.match(html, /font-size:24px/);
  assert.match(html, /12345678/);
  assert.match(html, /Only enter this code on SimSoccer/);
  assert.doesNotMatch(html, /check your spam or junk folder/i);
  assert.doesNotMatch(html, /#f3f5f1|border-top:|<hr\b/i);
});
