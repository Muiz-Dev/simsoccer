"use client";

import { useEffect, useState, type FormEvent } from "react";
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

export default function AccountSettingsPage() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [profile, setProfile] = useState({ firstName: "", lastName: "", phone: "" });

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

  async function requestCode() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const token = await restoreAccessToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const result = await requestAuth("password/change/request", {}, token);
      if (!result.challengeId) throw new Error("A confirmation code could not be sent. Try again.");
      setChallengeId(result.challengeId);
      setCode("");
      setNewPassword("");
      setNotice("Check your email for a confirmation code.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "A confirmation code could not be sent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const token = await restoreAccessToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const result = await requestAuth("password/change/verify", { challengeId, code, newPassword }, token);
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
      setNotice(result.notificationSent === false
        ? "Password changed. Other sessions were signed out, but the security email could not be sent."
        : "Password changed. Other sessions were signed out.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your password could not be changed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeSession(familyId: string) {
    setBusy(true);
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
      setBusy(false);
    }
  }

  async function signOutEverywhere() {
    setBusy(true);
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
      setBusy(false);
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
                <p>{account.email}</p>
              </div>
              <form className={styles.settingsForm} onSubmit={(event) => void saveProfile(event)}>
                <label>First name<input autoComplete="given-name" required maxLength={80} value={profile.firstName} onChange={(event) => setProfile({ ...profile, firstName: event.target.value })} /></label>
                <label>Last name<input autoComplete="family-name" required maxLength={80} value={profile.lastName} onChange={(event) => setProfile({ ...profile, lastName: event.target.value })} /></label>
                <label>Phone number<input autoComplete="tel" maxLength={24} value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} /></label>
                <button type="submit" disabled={busy}>{busy ? <span className={styles.buttonSpinner} aria-label="Saving" /> : "Save details"}</button>
              </form>
            </section>

            <section className={styles.settingsSection} aria-labelledby="password-title">
              <div className={styles.sectionHeading}>
                <h2 id="password-title">Password</h2>
                <p>We’ll email you a code before you can change it.</p>
              </div>
              {!challengeId ? (
                <button className={styles.primaryButton} type="button" onClick={() => void requestCode()} disabled={busy}>
                  {busy ? <span className={styles.buttonSpinner} aria-label="Sending code" /> : "Send confirmation code"}
                </button>
              ) : (
                <form className={styles.settingsForm} onSubmit={(event) => void changePassword(event)}>
                  <label>Email code<input inputMode="numeric" autoComplete="one-time-code" required minLength={8} maxLength={8} pattern="[0-9]{8}" value={code} onChange={(event) => setCode(event.target.value)} /></label>
                  <label>New password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
                  <div className={styles.formActions}>
                    <button type="submit" disabled={busy}>{busy ? <span className={styles.buttonSpinner} aria-label="Updating password" /> : "Change password"}</button>
                    <button className={styles.textButton} type="button" onClick={() => void requestCode()} disabled={busy}>Send another code</button>
                    <button className={styles.textButton} type="button" onClick={() => { setChallengeId(""); setCode(""); }} disabled={busy}>Cancel</button>
                  </div>
                </form>
              )}
            </section>

            <section className={styles.settingsSection} aria-labelledby="sessions-title">
              <div className={styles.sectionHeading}>
                <h2 id="sessions-title">Signed-in sessions</h2>
                <p>Sign out any session you don’t recognize.</p>
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
      </section>
    </main>
  );
}
