"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import { requestAuth, restoreAccessToken, setAccessToken } from "@/lib/auth-client";
import styles from "../page.module.css";

type Account = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
};
type AccountSession = {
  familyId: string;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
  deviceRecognized: boolean;
};
type LastPaymentWallet = {
  address: string;
  network: string;
  connectedAt: string;
};
type PasswordStep = "request" | "code" | "password";

const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export default function AccountSettingsPage() {
  const router = useRouter();
  const passwordDialogRef = useRef<HTMLDialogElement>(null);
  const actionInFlight = useRef(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [lastPaymentWallet, setLastPaymentWallet] = useState<LastPaymentWallet | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletError, setWalletError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordStep, setPasswordStep] = useState<PasswordStep>("request");
  const [modalError, setModalError] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [profile, setProfile] = useState({ firstName: "", lastName: "", phone: "" });
  const [resendSeconds, setResendSeconds] = useState(0);
  const resendCountdown = `${Math.floor(resendSeconds / 60)}:${String(resendSeconds % 60).padStart(2, "0")}`;

  function beginAction() {
    if (actionInFlight.current) return false;
    actionInFlight.current = true;
    setBusy(true);
    return true;
  }

  function endAction() {
    actionInFlight.current = false;
    setBusy(false);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const token = await restoreAccessToken();
        if (!token) {
          router.replace("/auth?next=/account/settings");
          return;
        }
        const headers = { Authorization: `Bearer ${token}` };
        const [accountResponse, sessionsResponse] = await Promise.all([
          fetch("/api/auth/account/me", { headers, cache: "no-store" }),
          fetch("/api/auth/sessions", { headers, cache: "no-store" }),
        ]);
        const [accountPayload, sessionsPayload] = await Promise.all([
          accountResponse.json().catch(() => null),
          sessionsResponse.json().catch(() => null),
        ]);
        if (!accountResponse.ok || !accountPayload?.account) {
          throw new Error(accountPayload?.message ?? "Your account details could not be loaded. Try again.");
        }
        if (!sessionsResponse.ok || !Array.isArray(sessionsPayload?.sessions)) {
          throw new Error(sessionsPayload?.message ?? "Your signed-in sessions could not be loaded. Try again.");
        }
        if (!active) return;
        const loaded = accountPayload.account as Account;
        setAccount(loaded);
        setProfile({
          firstName: loaded.firstName ?? "",
          lastName: loaded.lastName ?? "",
          phone: loaded.phone ?? "",
        });
        setSessions(sessionsPayload.sessions as AccountSession[]);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Your settings could not be loaded. Try again.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const token = await restoreAccessToken();
        if (!token) return;
        if (!apiUrl) throw new Error("Wallet details are temporarily unavailable.");
        const response = await fetch(`${apiUrl}/api/wallet/solana/wallet`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload || (payload.wallet !== null && (
          typeof payload.wallet?.address !== "string"
          || typeof payload.wallet?.network !== "string"
          || typeof payload.wallet?.connectedAt !== "string"
        ))) {
          throw new Error(payload?.message ?? "Wallet details are temporarily unavailable.");
        }
        if (active) setLastPaymentWallet(payload.wallet as LastPaymentWallet | null);
      } catch (cause) {
        if (active) setWalletError(cause instanceof Error ? cause.message : "Wallet details are temporarily unavailable.");
      } finally {
        if (active) setWalletLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const dialog = passwordDialogRef.current;
    if (!dialog) return;
    if (passwordModalOpen && !dialog.open) dialog.showModal();
    if (!passwordModalOpen && dialog.open) dialog.close();
  }, [passwordModalOpen]);

  useEffect(() => {
    if (!resendSeconds) return;
    const timer = window.setTimeout(() => setResendSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const token = await restoreAccessToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const response = await fetch("/api/auth/account/profile/details", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.message ?? "Your details could not be saved. Try again.");
      setAccount(result.account as Account);
      setNotice("Profile updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your details could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function continueToPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!beginAction()) return;
    setModalError("");
    try {
      const token = await restoreAccessToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const result = await requestAuth("password/change/confirm", { challengeId, code }, token);
      if (!result.challengeId) throw new Error("The code could not be verified. Request a new one.");
      setChallengeId(result.challengeId);
      setPasswordStep("password");
    } catch (cause) {
      setModalError(cause instanceof Error ? cause.message : "The code could not be verified. Try again.");
    } finally {
      endAction();
    }
  }

  async function requestCode() {
    if (!beginAction()) return;
    setModalError("");
    try {
      const token = await restoreAccessToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const result = await requestAuth("password/change/request", {}, token);
      if (!result.challengeId) throw new Error("A confirmation code could not be sent. Try again.");
      setChallengeId(result.challengeId);
      setCode("");
      setNewPassword("");
      setPasswordStep("code");
      setResendSeconds(3 * 60);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "A confirmation code could not be sent. Try again.";
      setModalError(message);
      if (/wait.*minutes|rate limit/i.test(message)) setResendSeconds(3 * 60);
    } finally {
      endAction();
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!beginAction()) return;
    setModalError("");
    try {
      const token = await restoreAccessToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const result = await requestAuth("password/change/verify", { challengeId, newPassword }, token);
      if (!result.accessToken) throw new Error("Your password could not be updated. Try again.");
      const sessionResponse = await fetch("/api/auth/sessions", {
        headers: { Authorization: `Bearer ${result.accessToken}` },
        cache: "no-store",
      });
      const sessionPayload = await sessionResponse.json().catch(() => null);
      if (!sessionResponse.ok || !Array.isArray(sessionPayload?.sessions)) {
        throw new Error("Your password was updated, but your sessions could not be refreshed. Reload this page.");
      }
      setSessions(sessionPayload.sessions as AccountSession[]);
      setAccessToken(result.accessToken);
      setChallengeId("");
      setCode("");
      setNewPassword("");
      setPasswordStep("request");
      setPasswordModalOpen(false);
      setNotice(result.notificationSent === false
        ? "Password changed. Other sessions were signed out, but the security email could not be sent."
        : "Password changed. Other sessions were signed out.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Your password could not be changed. Try again.";
      setModalError(message);
      if (/expired/i.test(message)) setPasswordStep("request");
    } finally {
      endAction();
    }
  }

  async function revokeSession(familyId: string) {
    if (!beginAction()) return;
    setError("");
    setNotice("");
    try {
      const token = await restoreAccessToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      await requestAuth("sessions/revoke", { familyId }, token);
      setSessions((current) => current.filter((session) => session.familyId !== familyId));
      setNotice("Session signed out.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That session could not be signed out. Try again.");
    } finally {
      endAction();
    }
  }

  async function signOutEverywhere() {
    if (!beginAction()) return;
    setError("");
    try {
      const token = await restoreAccessToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      await requestAuth("logout-all", {}, token);
      setAccessToken(null);
      router.replace("/auth");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your sessions could not be closed. Try again.");
    } finally {
      endAction();
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}><SportsSoccerIcon aria-hidden="true" /><span>SimSoccer</span></Link>
        <Link className={styles.backLink} href="/account"><ArrowBackIcon fontSize="small" /> Account</Link>
      </header>
      <section className={styles.content} aria-labelledby="settings-title">
        <div className={styles.heading}>
          <div><p>Account</p><h1 id="settings-title">Settings</h1></div>
        </div>
        {loading ? <div className={styles.overviewSkeleton} role="status" aria-label="Loading settings"><span /><span /><span /></div> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
        {!loading && account ? (
          <div className={styles.settingsSections}>
            <section className={styles.settingsSection} aria-labelledby="profile-title">
              <div className={styles.sectionHeading}>
                <h2 id="profile-title">Profile details</h2>
              </div>
              <form className={styles.settingsForm} onSubmit={(event) => void saveProfile(event)}>
                <label>First name<input autoComplete="given-name" value={account.firstName ?? ""} disabled /></label>
                <label>Last name<input autoComplete="family-name" value={account.lastName ?? ""} disabled /></label>
                <label>Email<input autoComplete="email" value={account.email} disabled /></label>
                <label>Phone number<input autoComplete="tel" value={account.phone ?? ""} disabled /></label>
                <div className={styles.phoneVerification}>
                  <span>Phone number not verified</span>
                  <button type="button" disabled>Verify phone number (coming soon)</button>
                </div>
                <button type="submit" disabled>Save details</button>
              </form>
            </section>

            <section className={styles.settingsSection} aria-labelledby="payment-wallet-title">
              <div className={styles.sectionHeading}>
                <h2 id="payment-wallet-title">Last used wallet</h2>
              </div>
              {walletLoading ? <p className={styles.paymentWalletMessage} role="status">Loading…</p> : null}
              {walletError ? <p className={styles.paymentWalletError} role="alert">{walletError}</p> : null}
              {!walletLoading && !walletError && lastPaymentWallet ? (
                <div className={styles.paymentWalletDetails}>
                  <code>{lastPaymentWallet.address}</code>
                  <span>Solana {lastPaymentWallet.network}</span>
                  <small>Last used {new Date(lastPaymentWallet.connectedAt).toLocaleString()}</small>
                </div>
              ) : null}
              {!walletLoading && !walletError && !lastPaymentWallet ? (
                <p className={styles.paymentWalletMessage}>No wallet used for a credit purchase yet.</p>
              ) : null}
            </section>

            <section className={styles.settingsSection} aria-labelledby="password-title">
              <div className={styles.sectionHeading}>
                <h2 id="password-title">Password</h2>
                <p>Confirm your email before choosing a new password.</p>
              </div>
              <button className={styles.primaryButton} type="button" onClick={() => { setModalError(""); setPasswordModalOpen(true); }} disabled={busy}>
                Change password
              </button>
            </section>

            <section className={styles.settingsSection} aria-labelledby="sessions-title">
              <div className={styles.sectionHeading}>
                <h2 id="sessions-title">Signed-in sessions</h2>
              </div>
              <button className={styles.primaryButton} type="button" onClick={() => void signOutEverywhere()} disabled={busy}>Sign out everywhere</button>
              {sessions.length ? (
                <ul className={styles.sessionList}>
                  {sessions.map((session) => (
                    <li key={session.familyId}>
                      <div>
                        <strong>{session.current ? "This session" : session.deviceRecognized ? "Recognized session" : "Other session"}</strong>
                        <span>Last active {new Date(session.lastUsedAt).toLocaleString()}</span>
                      </div>
                      {!session.current ? <button type="button" onClick={() => void revokeSession(session.familyId)} disabled={busy}>Sign out</button> : null}
                    </li>
                  ))}
                </ul>
              ) : <p className={styles.emptyState}>No active sessions found.</p>}
            </section>
          </div>
        ) : null}
        <dialog
          ref={passwordDialogRef}
          className={styles.passwordDialog}
          aria-labelledby="password-dialog-title"
          onClose={() => setPasswordModalOpen(false)}
          onCancel={() => setPasswordModalOpen(false)}
        >
          <div className={styles.passwordDialogHeader}>
            <h2 id="password-dialog-title">
              {passwordStep === "request" ? "Confirm your email" : passwordStep === "code" ? "Enter your code" : "Choose a new password"}
            </h2>
            <button type="button" className={styles.dialogClose} onClick={() => setPasswordModalOpen(false)} aria-label="Close password change">×</button>
          </div>
          {modalError ? <p className={styles.error} role="alert">{modalError}</p> : null}
          {passwordStep === "request" ? (
            <div className={styles.dialogContent}>
              <p>We’ll send an eight-digit confirmation code to <strong>{account?.email}</strong>.</p>
              <button className={styles.primaryButton} type="button" onClick={() => void requestCode()} disabled={busy || resendSeconds > 0}>
                {busy ? <span className={styles.buttonSpinner} aria-label="Sending code" /> : "Send verification code"}
              </button>
              {resendSeconds > 0 ? <p className={styles.dialogAvailability} role="status">Available in {resendCountdown}</p> : null}
            </div>
          ) : null}
          {passwordStep === "code" ? (
            <form className={styles.settingsForm} onSubmit={continueToPassword}>
              <p className={styles.dialogCopy}>Enter the code sent to {account?.email}. We’ll verify it before asking you to choose a new password.</p>
              <label>Email code<input inputMode="numeric" autoComplete="one-time-code" required minLength={8} maxLength={8} pattern="[0-9]{8}" value={code} onChange={(event) => setCode(event.target.value)} /></label>
              <div className={styles.formActions}>
                <button type="submit" disabled={busy || !/^\d{8}$/.test(code)}>Continue</button>
                <button className={styles.textButton} type="button" onClick={() => setPasswordModalOpen(false)} disabled={busy}>Cancel</button>
              </div>
              <div className={styles.resendAction}>
                <button className={styles.textButton} type="button" onClick={() => void requestCode()} disabled={busy || resendSeconds > 0}>Request a new code</button>
                {resendSeconds > 0 ? <span aria-live="polite">Available in {resendCountdown}</span> : null}
              </div>
            </form>
          ) : null}
          {passwordStep === "password" ? (
            <form className={styles.settingsForm} onSubmit={(event) => void changePassword(event)}>
              <p className={styles.dialogCopy}>Choose a password with at least 12 characters.</p>
              <label>New password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
              <div className={styles.formActions}>
                <button type="submit" disabled={busy || newPassword.length < 12}>
                  {busy ? <span className={styles.buttonSpinner} aria-label="Updating password" /> : "Update password"}
                </button>
                <button className={styles.textButton} type="button" onClick={() => { setModalError(""); setPasswordStep("code"); }} disabled={busy}>Back</button>
              </div>
            </form>
          ) : null}
        </dialog>
      </section>
    </main>
  );
}
