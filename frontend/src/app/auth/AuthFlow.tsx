"use client";

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SportsSoccerIcon from '@mui/icons-material/SportsSoccer';
import { getAccessToken, requestAuth, setAccessToken, type AuthResponse } from '@/lib/auth-client';
import styles from './AuthFlow.module.css';

type Stage = 'signin' | 'signup' | 'signup-code' | 'signin-code' | 'forgot' | 'recovery' | 'profile';
type Account = NonNullable<AuthResponse['account']>;

const PRIVACY_NOTICE_VERSION = '2026-10-05';

function getReturnPath(): string {
  const next = new URLSearchParams(window.location.search).get('next');
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/account';
}

function maskEmail(value: string): string {
  const [localPart, domain] = value.trim().split('@');
  if (!localPart || !domain) return 'your email';
  return `${localPart[0]}${'•'.repeat(Math.max(3, Math.min(localPart.length - 1, 8)))}@${domain}`;
}

async function readAccountResponse(response: Response): Promise<{ account: Account }> {
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.account) {
    throw new Error(result?.message ?? 'Account services are temporarily unavailable. Try again.');
  }
  return result as { account: Account };
}

export default function AuthFlow() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('signin');
  const [emailEntryStage, setEmailEntryStage] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [challengePurpose, setChallengePurpose] = useState('');
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
    setChallengeId('');
    setStage(next);
  }

  async function continueWithSession(accessToken: string, account?: Account) {
    setAccessToken(accessToken);
    let currentAccount = account;
    if (!currentAccount) {
      const response = await fetch('/api/auth/account/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      currentAccount = (await readAccountResponse(response)).account;
    }
    if (currentAccount.profileComplete) {
      router.push(getReturnPath());
      return;
    }
    setStage('profile');
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    setBusy(true);
    try {
      const result = await requestAuth('signin', { email: email.trim(), password });
      if (!result.challengeId || !result.purpose) throw new Error('Sign-in could not be started. Try again.');
      setChallengeId(result.challengeId);
      setChallengePurpose(result.purpose);
      setEmailEntryStage('signin');
      setStage(result.purpose === 'verify' ? 'signup-code' : 'signin-code');
      setNotice('If this address can receive a code, a message is on its way.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in is temporarily unavailable. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    setBusy(true);
    try {
      const result = await requestAuth('signup', { email: email.trim(), password });
      if (!result.challengeId) throw new Error('Sign-up could not be started. Try again.');
      setChallengeId(result.challengeId);
      setChallengePurpose('verify');
      setEmailEntryStage('signup');
      setStage('signup-code');
      setNotice('If this address can be registered, a verification code is on its way.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-up is temporarily unavailable. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordlessRequest() {
    clearFeedback();
    if (!email.trim()) {
      setError('Enter your email address first.');
      return;
    }
    setBusy(true);
    try {
      const result = await requestAuth('passwordless', { email: email.trim() });
      if (!result.challengeId) throw new Error('A sign-in code could not be requested. Try again.');
      setChallengeId(result.challengeId);
      setChallengePurpose('passwordless');
      setEmailEntryStage('signin');
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
      const result = await requestAuth('password-reset/request', { email: email.trim() });
      if (!result.challengeId) throw new Error('Password recovery could not be started. Try again.');
      setChallengeId(result.challengeId);
      setChallengePurpose('recovery');
      setStage('recovery');
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
      const result = await requestAuth('verify', { challengeId, code });
      if (!result.accessToken) throw new Error('The code could not be verified. Request a new one.');
      await continueWithSession(result.accessToken, result.account);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The code could not be verified. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    if (!/^\d{8}$/.test(code)) {
      setError('Enter the eight-digit code from the email.');
      return;
    }
    setBusy(true);
    try {
      const result = await requestAuth('password-reset/complete', { challengeId, code, password: newPassword });
      setStage('signin');
      setNotice(result.notificationSent === false
        ? 'Password updated, but the security email could not be sent. Sign in with your new password.'
        : 'Password updated. Sign in with your new password.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The password could not be reset. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    setBusy(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Your session expired. Sign in to continue.');
      const response = await fetch('/api/auth/account/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          firstName,
          lastName,
          phone,
          termsAccepted,
          privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
        }),
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
      const result = stage === 'recovery'
        ? await requestAuth('password-reset/request', { email: email.trim() })
        : challengePurpose === 'verify'
          ? await requestAuth('signup', { email: email.trim(), password })
          : await requestAuth('passwordless', { email: email.trim() });
      if (!result.challengeId) throw new Error('A new code could not be sent. Wait a moment and try again.');
      setChallengeId(result.challengeId);
      setNotice('If this address can receive a code, a new message is on its way.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'A new code could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  const codeStage = stage === 'signup-code' || stage === 'signin-code';
  const title = stage === 'signup' ? 'Create your account'
    : stage === 'signup-code' ? 'Verify your email'
      : stage === 'signin-code' ? 'Enter your sign-in code'
        : stage === 'forgot' ? 'Reset your password'
          : stage === 'recovery' ? 'Choose a new password'
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
        <div className={`${styles.intro} ${stage === 'signin' ? styles.signInIntro : ''}`}>
          <h1 id="auth-title">{title}</h1>
          {stage === 'signup' ? <p className={styles.introText}>Create your account.</p>
            : codeStage || stage === 'recovery' ? <p className={styles.introText}>Code sent to {maskEmail(email)}.</p>
              : null}
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
            <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <div className={styles.inlineLinks}><button type="button" onClick={() => moveTo('forgot')}>Forgot password?</button></div>
            <button className={styles.primary} type="submit" disabled={busy}>{busy ? <span className={styles.spinner} aria-hidden="true" /> : null}{busy ? 'Sending code' : 'Continue'}</button>
            <button className={styles.textAction} type="button" disabled={busy} onClick={() => void handlePasswordlessRequest()}>Email me a sign-in code</button>
          </form>
        ) : null}

        {stage === 'signup' ? (
          <form className={styles.form} onSubmit={(event) => void handleSignUp(event)}>
            <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>Password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
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
            <button className={styles.primary} type="submit" disabled={busy || !challengeId || !/^\d{8}$/.test(code)}>{busy ? <span className={styles.spinner} aria-hidden="true" /> : null}{busy ? 'Checking code' : 'Verify code'}</button>
            <button className={styles.textAction} type="button" disabled={busy} onClick={() => void resendCode()}>Send a new code</button>
            <button className={styles.backAction} type="button" onClick={() => moveTo(emailEntryStage)}>Use a different email</button>
          </form>
        ) : null}

        {stage === 'forgot' ? (
          <form className={styles.form} onSubmit={(event) => void handleForgotPassword(event)}>
            <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <button className={styles.primary} type="submit" disabled={busy}>{busy ? 'Sending code' : 'Send recovery code'}</button>
            <button className={styles.backAction} type="button" onClick={() => moveTo('signin')}>Back to sign in</button>
          </form>
        ) : null}

        {stage === 'recovery' ? (
          <form className={styles.form} onSubmit={(event) => void handlePasswordRecovery(event)}>
            <label className={styles.codeField}>Verification code
              <input
                aria-label="Eight-digit password recovery code"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
                required
              />
            </label>
            <label>New password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
            <button className={styles.primary} type="submit" disabled={busy || !challengeId || !/^\d{8}$/.test(code)}>{busy ? 'Saving password' : 'Save new password'}</button>
            <button className={styles.textAction} type="button" disabled={busy} onClick={() => void resendCode()}>Send a new code</button>
          </form>
        ) : null}

        {stage === 'profile' ? (
          <form className={styles.form} onSubmit={(event) => void handleProfile(event)}>
            <div className={styles.nameFields}>
              <label>First name<input autoComplete="given-name" required maxLength={80} value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
              <label>Last name<input autoComplete="family-name" required maxLength={80} value={lastName} onChange={(event) => setLastName(event.target.value)} /></label>
            </div>
            <label>Phone number (optional)<input type="tel" autoComplete="tel" maxLength={24} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            <label className={styles.consent}>
              <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} />
              <span>I agree to the <Link href="/terms" target="_blank">Terms</Link> and acknowledge the <Link href="/privacy" target="_blank">Privacy Notice</Link>.</span>
            </label>
            <button
              className={styles.primary}
              type="submit"
              aria-label={busy ? 'Completing profile' : 'Complete'}
              disabled={busy || !termsAccepted}
            >
              {busy ? <span className={styles.spinner} aria-hidden="true" /> : null}
              Complete
            </button>
          </form>
        ) : null}

        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
        <footer className={styles.footer}>SimSoccer accounts use play-money credits only.</footer>
      </section>
    </main>
  );
}
