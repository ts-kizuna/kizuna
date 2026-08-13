import clsx from 'clsx';
import type { ReactNode } from 'react';
import styles from './section.module.css';

interface SectionProps {
    id?: string;
    title?: string;
    description?: string;
    className?: string;
    children: ReactNode;
}

export function Section({ id, title, description, className, children }: SectionProps) {
    return (
        <section id={id} className={clsx(styles.section, className)}>
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
