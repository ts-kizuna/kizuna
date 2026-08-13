import Link from 'next/link';
import { Logo } from '@/app/components/logo';
import { ThemeToggle } from './theme-toggle';
import styles from './site-footer.module.css';

export function SiteFooter() {
    return (
        <footer className={styles.footer}>
            <div className={styles.inner}>
                <Logo className={styles.logo} />

                <ul className={styles.links}>
                    <li>
                        <Link href="/docs" className={styles.link}>
                            Docs
                        </Link>
                    </li>
                    <li>
                        <Link href="/about" className={styles.link}>
                            About
                        </Link>
                    </li>
                    <li>
                        <Link href="/faq" className={styles.link}>
                            FAQ
                        </Link>
                    </li>
                    <li>
                        <a href="https://github.com/ts-kizuna/kizuna" className={styles.link} target="_blank" rel="noreferrer">
                            GitHub
                        </a>
                    </li>
                </ul>

                <div className={styles.end}>
                    <ThemeToggle />
                    <p className={styles.meta}>MIT licensed</p>
                </div>
            </div>
        </footer>
    );
}
