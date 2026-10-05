import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '../auth/AuthFlow.module.css';

export const metadata: Metadata = { title: 'Privacy | SimSoccer' };

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}><Link href="/" className={styles.brand}>SimSoccer</Link><Link className={styles.backLink} href="/auth">Back to account</Link></header>
      <article className={styles.shell}>
        <div className={styles.intro}><p className={styles.eyebrow}>Privacy notice · 2026-10-05</p><h1>Your account data</h1>
          <p className={styles.introText}>We use account details to provide sign-in, protect accounts, maintain your play-money wallet, and show your betting activity.</p></div>
        <div className={styles.form}>
          <section><h2>Email and profile</h2><p className={styles.privacyNote}>SimSoccer stores your email address, a password hash, email-verification and recovery records, and any name or optional phone number you provide. Account, wallet, and play-money betting records are used to provide the service. Passwords are not stored as readable text.</p></section>
          <section><h2>Account security</h2><p className={styles.privacyNote}>A random first-party device cookie helps recognize a browser but is not used as proof of identity. We store keyed hashes of this cookie, the request IP address, and browser user-agent with session records; we do not use canvas, fonts, hardware IDs, or cross-site browser fingerprinting. Hosting and network providers may process IP addresses in their operational logs.</p></section>
          <section><h2>Cookies and retention</h2><p className={styles.privacyNote}>An HttpOnly session cookie is necessary to keep sign-in credentials out of browser storage. A daily cleanup removes verification challenges after they have expired for one day, refresh-session records 30 days after expiry, and device records after 180 days without activity. Account, wallet, and bet records may be retained longer where needed to operate the service or meet legal obligations.</p></section>
          <section><h2>Service providers</h2><p className={styles.privacyNote}>We use infrastructure and email-delivery providers to host the service, store account data, and send security codes. They process information only as needed to provide their services under their own terms and privacy notices.</p></section>
          <p className={styles.privacyNote}>This notice is an implementation draft, not legal advice. A data-controller contact, lawful-basis assessment, jurisdiction-specific review, and process for privacy requests are still required before public launch.</p>
        </div>
      </article>
    </main>
  );
}