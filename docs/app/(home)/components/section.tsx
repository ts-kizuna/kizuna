import type { ReactNode } from 'react';
import styles from './section.module.css';

interface SectionProps {
    id?: string;
    title?: string;
    description?: string;
    tight?: boolean;
    compact?: boolean;
    children: ReactNode;
}

export function Section({ id, title, description, tight = false, compact = false, children }: SectionProps) {
    return (
        <section id={id} className={[styles.section, tight && styles.tight, compact && styles.compact].filter(Boolean).join(' ')}>
            {title ? (
                <div className={styles.head}>
                    <h2 className={styles.title}>{title}</h2>
                    {description ? <p className={styles.description}>{description}</p> : null}
                </div>
            ) : null}
            {children}
        </section>
    );
}
