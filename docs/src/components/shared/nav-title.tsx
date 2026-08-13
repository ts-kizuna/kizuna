import clsx from 'clsx';
import styles from './nav-title.module.css';

export function NavTitle() {
    return (
        <>
            <img src="/favicon-dark.png" alt="" className={clsx(styles.icon, styles.light)} />
            <img src="/favicon-light.png" alt="" className={clsx(styles.icon, styles.dark)} />
            ts-kizuna
        </>
    );
}
