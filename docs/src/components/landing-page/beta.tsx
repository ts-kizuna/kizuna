import clsx from 'clsx';
import Link from 'next/link';
import styles from './beta.module.css';

export function Beta({ className }: { className?: string }) {
    return (
        <div className={clsx(styles.beta, className)}>
            <span className={styles.pill}>Beta</span>
            <p className={styles.body}>
                <span className={styles.bodyLong}>
                    Battle-tested in production. The syntax may still change before v2, so pin your version.
                </span>
                <span className={styles.bodyShort}>Battle-tested in prod.</span>
            </p>
            <Link className={styles.link} href="/faq">
                Read the FAQ
            </Link>
        </div>
    );
}
