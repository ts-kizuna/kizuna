import clsx from 'clsx';
import styles from './stat-band.module.css';

export function StatBand({ className }: { className?: string }) {
    return (
        <section className={clsx(styles.band, className)}>
            <h2 className={styles.headline}>
                One contract, <span className={styles.number}>7</span> typed surfaces
            </h2>
            <p className={styles.caption}>
                A server, a REST API, an OpenAPI spec, a TypeScript client, a Swift client, a Kotlin client, and an MCP server. All of it
                reads from the contract you already wrote.
            </p>
        </section>
    );
}
