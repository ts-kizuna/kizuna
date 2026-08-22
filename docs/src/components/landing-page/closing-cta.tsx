import Link from 'next/link';
import GithubIcon from '@/icons/Github.svg';
import styles from './closing-cta.module.css';

export function ClosingCta() {
    return (
        <div className={styles.closingCta}>
            <p className={styles.ctaTitle}>Ready to build?</p>
            <p className={styles.ctaText}>8 minutes from an empty file to a typed client calling a real endpoint.</p>
            <div className={styles.ctaActions}>
                <Link href="/docs" className={styles.primary}>
                    Get started
                </Link>
                <a href="https://github.com/ts-kizuna/kizuna" className={styles.secondary} target="_blank" rel="noreferrer">
                    <GithubIcon className={styles.secondaryIcon} />
                    Star on GitHub
                </a>
            </div>
        </div>
    );
}
