import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '../auth/AuthFlow.module.css';

export const metadata: Metadata = { title: 'Privacy | SimSoccer' };

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}><Link href="/" className={styles.brand}>SimSoccer</Link><Link className={styles.backLink} href="/auth">Back to account</Link></header>
      <article className={styles.shell}>
        <div className={styles.intro}><p className={styles.eyebrow}>Privacy notice · 2026-10-01</p><h1>Your account data</h1>
          <p className={styles.introText}>We use account details to provide sign-in, protect accounts, maintain your play-money wallet, and show your betting activity.</p></div>
        <div className={styles.form}>
          <section><h2>Email, phone, and profile</h2><p className={styles.privacyNote}>Supabase Auth handles credentials and verification. SimSoccer stores your verified account identifier, email, phone, first and last name, and account activity needed to operate your profile and wallet.</p></section>
          <section><h2>Security signals</h2><p className={styles.privacyNote}>Our services and infrastructure may process request IP addresses and browser user-agent headers for rate limiting, abuse prevention, and security. We do not use these details for covert location profiling or browser fingerprinting.</p></section>
          <section><h2>Cookies and retention</h2><p className={styles.privacyNote}>Authentication cookies are necessary to keep your session secure. Account, wallet, and bet records are retained while needed to operate the service and meet applicable obligations. Exact retention periods and contact procedures must be finalized before public launch.</p></section>
          <p className={styles.privacyNote}>This notice is an implementation draft, not legal advice. A data controller contact, retention schedule, lawful-basis assessment, and jurisdiction-specific review are still required before launch.</p>
        </div>
      </article>
    </main>
  );
}