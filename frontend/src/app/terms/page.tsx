import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '../auth/AuthFlow.module.css';

export const metadata: Metadata = { title: 'Terms | SimSoccer' };

export default function TermsPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}><Link href="/" className={styles.brand}>SimSoccer</Link><Link className={styles.backLink} href="/auth">Back to account</Link></header>
      <article className={styles.shell}>
        <div className={styles.intro}><p className={styles.eyebrow}>Account terms</p><h1>Play-money service</h1>
          <p className={styles.introText}>SimSoccer betting uses virtual credits only. Credits cannot be purchased, withdrawn, transferred for value, or exchanged for money. This is not a real-money gambling service.</p></div>
        <p className={styles.privacyNote}>Use the service lawfully and keep your sign-in details private. We may suspend access to protect accounts, service integrity, or the virtual world. These terms are a launch draft and require review for the jurisdictions where the service will be offered.</p>
      </article>
    </main>
  );
}