import Link from 'next/link';
import { Logo } from '@/components/shared/logo';
import { GithubIcon } from './github-icon';
import { NpmIcon } from './npm-icon';
import { ThemeToggle } from './theme-toggle';
import styles from './site-footer.module.css';

interface FooterLink {
    label: string;
    href: string;
}

interface FooterColumn {
    title: string;
    links: FooterLink[];
}

const columns: FooterColumn[] = [
    {
        title: 'Get started',
        links: [
            {
                label: 'Quickstart',
                href: '/docs',
            },
            {
                label: 'Introduction',
                href: '/docs/introduction',
            },
            {
                label: 'Project structure',
                href: '/docs/project-structure',
            },
            {
                label: 'Migration',
                href: '/docs/migration',
            },
        ],
    },
    {
        title: 'Building an API',
        links: [
            {
                label: 'Contract',
                href: '/docs/building/contract',
            },
            {
                label: 'Router',
                href: '/docs/building/router',
            },
            {
                label: 'Mounting',
                href: '/docs/building/mounting',
            },
            {
                label: 'Auth',
                href: '/docs/auth',
            },
            {
                label: 'Jobs',
                href: '/docs/jobs',
            },
        ],
    },
    {
        title: 'Adapters',
        links: [
            {
                label: 'Express',
                href: '/docs/adapters/express',
            },
            {
                label: 'Fastify',
                href: '/docs/adapters/fastify',
            },
            {
                label: 'Hono',
                href: '/docs/adapters/hono',
            },
            {
                label: 'Next.js',
                href: '/docs/adapters/next',
            },
        ],
    },
    {
        title: 'Clients',
        links: [
            {
                label: 'Fetch client',
                href: '/docs/clients/fetch',
            },
            {
                label: 'Swift',
                href: '/docs/clients/swift',
            },
            {
                label: 'Kotlin',
                href: '/docs/clients/kotlin',
            },
        ],
    },
    {
        title: 'Plugins',
        links: [
            {
                label: 'Overview',
                href: '/docs/plugins',
            },
            {
                label: 'OpenAPI',
                href: '/docs/openapi',
            },
            {
                label: 'MCP',
                href: '/docs/mcp',
            },
            {
                label: 'Write your own',
                href: '/docs/extend/create-plugin',
            },
        ],
    },
    {
        title: 'ts-kizuna',
        links: [
            {
                label: 'About',
                href: '/about',
            },
            {
                label: 'FAQ',
                href: '/faq',
            },
            {
                label: 'Reference',
                href: '/docs/reference',
            },
            {
                label: 'Breaking changes',
                href: '/docs/breaking-changes',
            },
        ],
    },
];

export function SiteFooter() {
    return (
        <footer className={styles.footer}>
            <div className={styles.inner}>
                <nav className={styles.columns} aria-label="Footer">
                    {columns.map((column) => (
                        <div key={column.title}>
                            <h2 className={styles.columnTitle}>{column.title}</h2>
                            <ul className={styles.list}>
                                {column.links.map((link) => (
                                    <li key={link.label}>
                                        <Link href={link.href} className={styles.link}>
                                            {link.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </nav>

                <div className={styles.bottom}>
                    <Link href="/" className={styles.logoLink} aria-label="ts-kizuna">
                        <Logo className={styles.logo} />
                    </Link>

                    <div className={styles.end}>
                        <a
                            href="https://github.com/ts-kizuna/kizuna"
                            className={styles.social}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="ts-kizuna on GitHub">
                            <GithubIcon className={styles.socialIcon} />
                        </a>
                        <a
                            href="https://www.npmjs.com/package/@ts-kizuna/core"
                            className={styles.social}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="ts-kizuna on npm">
                            <NpmIcon className={styles.npmIcon} />
                        </a>
                        <p className={styles.meta}>MIT licensed</p>
                        <ThemeToggle />
                    </div>
                </div>
            </div>
        </footer>
    );
}
