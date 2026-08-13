import styles from './adapters.module.css';

const adapters = [
    {
        name: 'Express',
        context: 'req, res',
    },
    {
        name: 'Fastify',
        context: 'request, reply',
    },
    {
        name: 'Hono',
        context: 'c, c.env',
    },
    {
        name: 'Next.js',
        context: 'request',
    },
];

export function Adapters() {
    return (
        <div className={styles.adapters}>
            <div className={styles.grid}>
                {adapters.map((adapter) => (
                    <div key={adapter.name} className={styles.adapter}>
                        <p className={styles.name}>{adapter.name}</p>
                        <p className={styles.context}>{adapter.context}</p>
                    </div>
                ))}
            </div>
            <p className={styles.note}>
                Every handler gets params, query, body, and headers validated the same way, and each adapter hands you its own primitives on
                top. Through Hono the same API runs on Cloudflare Workers, Deno, and Bun.
            </p>
        </div>
    );
}
