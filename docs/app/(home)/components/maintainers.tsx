import { MapPin } from 'lucide-react';
import { GithubIcon } from './github-icon';
import styles from './maintainers.module.css';

interface Maintainer {
    name: string;
    title: string;
    role: string;
    country: string;
    github: string;
}

const maintainers: Maintainer[] = [
    {
        name: 'Sondre Ørland',
        title: 'Creator',
        role: 'Full-stack developer & UX/UI-designer',
        country: 'Norway',
        github: 'sondreorland',
    },
];

export function Maintainers() {
    return (
        <ul className={styles.list}>
            {maintainers.map((maintainer) => (
                <li key={maintainer.name} className={styles.person}>
                    <div className={styles.identity}>
                        <img
                            className={styles.avatar}
                            src={`https://github.com/${maintainer.github}.png?size=160`}
                            alt=""
                            width={56}
                            height={56}
                            loading="lazy"
                            decoding="async"
                        />
                        <div className={styles.identityText}>
                            <p className={styles.name}>{maintainer.name}</p>
                            <a className={styles.handle} href={`https://github.com/${maintainer.github}`} target="_blank" rel="noreferrer">
                                <GithubIcon className={styles.githubIcon} />
                                <span className={styles.handleText}>{maintainer.github}</span>
                            </a>
                        </div>
                    </div>
                    <p className={styles.role}>{maintainer.role}</p>
                    <div className={styles.meta}>
                        <span className={styles.title}>{maintainer.title}</span>
                        <span className={styles.divider} aria-hidden />
                        <span className={styles.country}>
                            <MapPin className={styles.countryIcon} aria-hidden />
                            {maintainer.country}
                        </span>
                    </div>
                </li>
            ))}
        </ul>
    );
}
