import clsx from 'clsx';
import Link from 'next/link';
import { GithubIcon } from './github-icon';
import styles from './hero.module.css';

export function Hero({ className }: { className?: string }) {
    return (
        <section className={clsx(styles.hero, className)}>
            <h1 className={styles.headline}>Build fully typed REST APIs with TypeScript</h1>
            <p className={styles.tagline}>
                Write one contract. Get a fully typed server, an OpenAPI spec, Swift and Kotlin clients, and more.
            </p>
            <div className={styles.actions}>
                <Link href="/docs" className={styles.primary}>
                    Get started
                </Link>
                <a href="https://github.com/ts-kizuna/kizuna" className={styles.secondary} target="_blank" rel="noreferrer">
                    <GithubIcon className={styles.secondaryIcon} />
                    View on GitHub
                </a>
            </div>
        </section>
    );
}
