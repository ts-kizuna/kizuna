import Link from 'next/link';
import Logo from '@/icons/Logo.svg';
import GithubIcon from '@/icons/Github.svg';
import { SearchButton } from './search-button';
import styles from './site-header.module.css';

const navigation = [
    {
        label: 'Docs',
        href: '/docs',
    },
    {
        label: 'About',
        href: '/about',
    },
    {
        label: 'FAQ',
        href: '/faq',
    },
];

export function SiteHeader() {
    return (
        <header className={styles.header}>
            <div className={styles.inner}>
                <div className={styles.left}>
                    <Link href="/" className={styles.logoLink}>
                        <Logo className={styles.logo} />
                    </Link>

                    <nav>
                        <ul className={styles.links}>
                            {navigation.map((item) => (
                                <li key={item.label}>
                                    <Link href={item.href} className={styles.link}>
                                        {item.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </nav>
                </div>

                <div className={styles.right}>
                    <a
                        href="https://github.com/ts-kizuna/kizuna"
                        className={styles.github}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="ts-kizuna on GitHub">
                        <GithubIcon className={styles.githubIcon} />
                    </a>

                    <span className={styles.divider} aria-hidden />

                    <SearchButton />

                    <Link href="/docs" className={styles.cta}>
                        Get started
                    </Link>
                </div>
            </div>
        </header>
    );
}
