import Link from 'next/link';
import styles from './beta.module.css';

export function Beta() {
    return (
        <div className={styles.beta}>
            <span className={styles.pill}>Beta</span>
            <p className={styles.body}>Battle-tested in production. The syntax may still change before v2, so pin your version.</p>
            <Link className={styles.link} href="/faq">
                Read the FAQ
            </Link>
        </div>
    );
}
