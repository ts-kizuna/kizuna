import clsx from 'clsx';
import type { ReactNode } from 'react';
import styles from './section.module.css';

interface SectionProps {
    id?: string;
    title?: string;
    description?: string;
    /**
     * `split` puts the heading beside the content on wide screens, stacked
     * everywhere else.
     */
    layout?: 'stacked' | 'split';
    className?: string;
    children: ReactNode;
}

export function Section({ id, title, description, layout = 'stacked', className, children }: SectionProps) {
    return (
        <section id={id} className={clsx(styles.section, layout === 'split' && styles.split, className)}>
            {title ? (
                <div className={styles.head}>
                    <h2 className={styles.title}>{title}</h2>
                    {description ? <p className={styles.description}>{description}</p> : null}
                </div>
            ) : null}
            <div className={styles.body}>{children}</div>
        </section>
    );
}
