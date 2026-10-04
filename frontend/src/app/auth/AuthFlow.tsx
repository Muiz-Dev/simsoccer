"use client";

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SportsSoccerIcon from '@mui/icons-material/SportsSoccer';
import { type Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import styles from './AuthFlow.module.css';

type Stage = 'signin' | 'signup' | 'signup-code' | 'signin-code' | 'forgot' | 'recovery-code' | 'new-password' | 'profile';
type AccountResponse = {
  account: {
    firstName: string | null;
    lastName: string | null;
    profileComplete: boolean;
  };
};

const API_URL = (process.env.NEXT_PUBLIC_ACCOUNTS_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
const PRIVACY_NOTICE_VERSION = '2026-10-01';

function getReturnPath(): string {
  const next = new URLSearchParams(window.location.search).get('next');
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/account';
}

async function readAccountResponse(response: Response): Promise<AccountResponse> {
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.account) {
    throw new Error(result?.message ?? 'Account services are temporarily unavailable. Try again.');
  }
  return result as AccountResponse;
}

export default function AuthFlow() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function clearFeedback() {
    setError('');
    setNotice('');
  }

  function moveTo(next: Stage) {
    clearFeedback();
    setCode('');
    setStage(next);
  }

  async function provisionAndContinue(session: Session, phoneValue = phone) {
    if (!API_URL) throw new Error('Account services are not configured. Try again later.');
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    };
    const currentResponse = await fetch(`${API_URL}/api/account/me`, { headers, cache: 'no-store' });
    let account: AccountResponse['account'];

    if (currentResponse.status === 404) {
      const provisionResponse = await fetch(`${API_URL}/api/account/provision`, {
        method: 'POST',
        headers,
        body: JSON.stringify(phoneValue ? { phone: phoneValue } : {}),
      });
      account = (await readAccountResponse(provisionResponse)).account;
    } else {
      account = (await readAccountResponse(currentResponse)).account;
    }

    if (account.profileComplete) {
      router.push(getReturnPath());
      return;
    }

    setStage('profile');
    setNotice('Your email is verified. Finish your profile to continue.');
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    setBusy(true);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError?.code === 'email_not_confirmed') {
        const resend = await supabase.auth.resend({ type: 'signup', email: email.trim() });
        if (resend.error) throw new Error('Email or password is incorrect. Try again or reset your password.');
        setStage('signup-code');
        setNotice('If this address can be verified, a new code is on its way.');
        return;
      }
      if (authError || !data.session) throw new Error('Email or password is incorrect. Try again or reset your password.');
      await provisionAndContinue(data.session, data.user.user_metadata?.phone ?? phone);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign in is temporarily unavailable. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    setBusy(true);
    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { phone }, emailRedirectTo: `${window.location.origin}/auth` },
      });
      if (authError) throw new Error('We could not start sign-up. Check the details or try signing in.');
      setStage('signup-code');
      setNotice('If this address can be registered, a verification code is on its way.');
      if (data.session) await provisionAndContinue(data.session, phone);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-up is temporarily unavailable. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordlessRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    setBusy(true);
    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false },
      });
      if (authError) throw new Error('We could not send a sign-in code. Try again shortly.');
      setStage('signin-code');
      setNotice('If this address has an account, a sign-in code is on its way.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'A sign-in code could not be sent. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    setBusy(true);
    try {
      const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth`,
      });
      if (authError) throw new Error('We could not start password recovery. Try again shortly.');
      setStage('recovery-code');
      setNotice('If this address has an account, a recovery code is on its way.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Password recovery is temporarily unavailable.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCodeVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    if (!/^\d{8}$/.test(code)) {
      setError('Enter the eight-digit code from the email.');
      return;
    }
    setBusy(true);
    try {
      const type = stage === 'signup-code' ? 'signup' : stage === 'recovery-code' ? 'recovery' : 'email';
      const { data, error: authError } = await supabase.auth.verifyOtp({ email: email.trim(), token: code, type });
      if (authError || !data.session) throw new Error('That code is invalid or expired. Request a new one.');
      if (stage === 'recovery-code') {
        setStage('new-password');
        setNotice('Choose a new password for your account.');
      } else {
        await provisionAndContinue(data.session, phone);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The code could not be verified. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleNewPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    setBusy(true);
    try {
      const { error: authError } = await supabase.auth.updateUser({ password: newPassword });
      if (authError) throw new Error('The new password could not be saved. Try again.');
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('Your recovery session expired. Request a new code.');
      await provisionAndContinue(data.session, phone);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Password update is temporarily unavailable.');
    } finally {
      setBusy(false);
    }
  }

  async function handleProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('Your session expired. Sign in to continue.');
      const response = await fetch(`${API_URL}/api/account/profile`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({ firstName, lastName, phone, termsAccepted, privacyNoticeVersion: PRIVACY_NOTICE_VERSION }),
      });
      await readAccountResponse(response);
      router.push(getReturnPath());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your profile could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    clearFeedback();
    setBusy(true);
    try {
      const result = stage === 'recovery-code'
        ? await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth` })
        : stage === 'signup-code'
          ? await supabase.auth.resend({ type: 'signup', email: email.trim() })
          : await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } });
      if (result.error) throw new Error('A new code could not be sent. Wait a moment and try again.');
      setNotice('If the account can receive a code, a new message is on its way.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'A new code could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  const codeStage = stage === 'signup-code' || stage === 'signin-code' || stage === 'recovery-code';
  const title = stage === 'signup' ? 'Create your account'
    : stage === 'signup-code' ? 'Verify your email'
      : stage === 'signin-code' ? 'Enter your sign-in code'
        : stage === 'forgot' ? 'Reset your password'
          : stage === 'recovery-code' ? 'Verify your email'
            : stage === 'new-password' ? 'Choose a new password'
              : stage === 'profile' ? 'Complete your profile'
                : 'Sign in';

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="SimSoccer home">
          <SportsSoccerIcon aria-hidden="true" />
          <span>SimSoccer</span>
        </Link>
        <Link className={styles.backLink} href="/betting"><ArrowBackIcon fontSize="small" /> Betting desk</Link>
      </header>

      <section className={styles.shell} aria-labelledby="auth-title">
        <div className={styles.intro}>
          <p className={styles.eyebrow}>Your SimSoccer account</p>
          <h1 id="auth-title">{title}</h1>
          <p className={styles.introText}>
            {stage === 'signup' ? 'Create an account to keep your play-money wallet and tickets together.'
              : stage === 'profile' ? 'One last step before you return to the desk.'
                : codeStage ? `Enter the code sent to ${email || 'your email address'}.`
                  : 'Sign in to manage your account and place play-money bets.'}
          </p>
        </div>

        {stage === 'signin' || stage === 'signup' ? (
          <div className={styles.modeSwitch} role="tablist" aria-label="Account action">
            <button type="button" role="tab" aria-selected={stage === 'signin'} onClick={() => moveTo('signin')}>Sign in</button>
            <button type="button" role="tab" aria-selected={stage === 'signup'} onClick={() => moveTo('signup')}>Create account</button>
          </div>
        ) : null}

        {stage === 'signin' ? (
          <form className={styles.form} onSubmit={(event) => void handleSignIn(event)}>
            <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>Password<input type="password" autoComplete="current-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <div className={styles.inlineLinks}><button type="button" onClick={() => moveTo('forgot')}>Forgot password?</button></div>
            <button className={styles.primary} type="submit" disabled={busy}>{busy ? <span className={styles.spinner} aria-hidden="true" /> : null}{busy ? 'Signing in' : 'Continue'}</button>
            <button className={styles.textAction} type="button" disabled={busy} onClick={() => void handlePasswordlessRequest(new Event('submit') as unknown as FormEvent<HTMLFormElement>)}>Email me a sign-in code</button>
          </form>
        ) : null}

        {stage === 'signup' ? (
          <form className={styles.form} onSubmit={(event) => void handleSignUp(event)}>
            <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>Phone number<input type="tel" autoComplete="tel" required minLength={7} maxLength={24} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            <label>Password<input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <p className={styles.privacyNote}>We use your email to secure your account. Your phone number is stored with your profile.</p>
            <button className={styles.primary} type="submit" disabled={busy}>{busy ? <span className={styles.spinner} aria-hidden="true" /> : null}{busy ? 'Sending code' : 'Continue'}</button>
          </form>
        ) : null}

        {codeStage ? (
          <form className={styles.form} onSubmit={(event) => void handleCodeVerification(event)}>
            <label className={styles.codeField}>
              Verification code
              <input
                aria-label="Eight-digit email verification code"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
                required
              />
            </label>
            <button className={styles.primary} type="submit" disabled={busy || !/^\d{8}$/.test(code)}>{busy ? <span className={styles.spinner} aria-hidden="true" /> : null}{busy ? 'Checking code' : 'Verify code'}</button>
            <button className={styles.textAction} type="button" disabled={busy} onClick={() => void resendCode()}>Send a new code</button>
            <button className={styles.backAction} type="button" onClick={() => moveTo(stage === 'signup-code' ? 'signup' : stage === 'recovery-code' ? 'forgot' : 'signin')}>Use a different email</button>
          </form>
        ) : null}

        {stage === 'forgot' ? (
          <form className={styles.form} onSubmit={(event) => void handleForgotPassword(event)}>
            <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <button className={styles.primary} type="submit" disabled={busy}>{busy ? 'Sending code' : 'Send recovery code'}</button>
            <button className={styles.backAction} type="button" onClick={() => moveTo('signin')}>Back to sign in</button>
          </form>
        ) : null}

        {stage === 'new-password' ? (
          <form className={styles.form} onSubmit={(event) => void handleNewPassword(event)}>
            <label>New password<input type="password" autoComplete="new-password" required minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
            <button className={styles.primary} type="submit" disabled={busy}>{busy ? 'Saving password' : 'Save new password'}</button>
          </form>
        ) : null}

        {stage === 'profile' ? (
          <form className={styles.form} onSubmit={(event) => void handleProfile(event)}>
            <div className={styles.nameFields}>
              <label>First name<input autoComplete="given-name" required maxLength={80} value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
              <label>Last name<input autoComplete="family-name" required maxLength={80} value={lastName} onChange={(event) => setLastName(event.target.value)} /></label>
            </div>
            <label>Phone number<input type="tel" autoComplete="tel" required minLength={7} maxLength={24} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            <label className={styles.consent}>
              <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} />
              <span>I agree to the <Link href="/terms" target="_blank">Terms</Link> and acknowledge the <Link href="/privacy" target="_blank">Privacy Notice</Link>.</span>
            </label>
            <button className={styles.primary} type="submit" disabled={busy || !termsAccepted}>{busy ? 'Saving profile' : 'Finish setup'}</button>
          </form>
        ) : null}

        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
        <footer className={styles.footer}>SimSoccer accounts use play-money credits only.</footer>
      </section>
    </main>
  );
}