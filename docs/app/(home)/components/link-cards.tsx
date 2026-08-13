import Link from 'next/link';
import styles from './link-cards.module.css';

const destinations = [
    {
        title: 'Quickstart',
        href: '/docs',
        description: 'Build a working API and a typed client in 8 minutes.',
    },
    {
        title: 'Building an API',
        href: '/docs/building/contract',
        description: 'Contract, router, and mounting, explained in depth.',
    },
    {
        title: 'Adapters',
        href: '/docs/adapters/express',
        description: 'Mount your handlers on Express, Fastify, Hono, or Next.js.',
    },
    {
        title: 'Clients',
        href: '/docs/clients/fetch',
        description: 'The typed fetch client and Swift client generation.',
    },
];

export function LinkCards() {
    return (
        <div className={styles.grid}>
            {destinations.map((destination) => (
                <Link key={destination.title} href={destination.href} className={styles.card}>
                    <h3 className={styles.title}>{destination.title}</h3>
                    <p className={styles.description}>{destination.description}</p>
                </Link>
            ))}
        </div>
    );
}
