import type { ComponentProps, ReactNode } from 'react';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';
import styles from './code-window.module.css';

type CodeWindowSize = 'small' | 'medium';

interface CodeWindowProps {
    lang: string;
    code: string;
    title?: string;
    icon?: ReactNode;
    dots?: boolean;
    size?: CodeWindowSize;
    options?: ComponentProps<typeof DynamicCodeBlock>['options'];
}

export function CodeWindow({ lang, code, title, icon, dots = false, size = 'medium', options }: CodeWindowProps) {
    return (
        <div className={size === 'small' ? `${styles.window} ${styles.small}` : styles.window}>
            {dots ? (
                <div className={styles.dots}>
                    <span className={styles.dot} />
                    <span className={styles.dot} />
                    <span className={styles.dot} />
                </div>
            ) : null}
            <div className={styles.code}>
                <DynamicCodeBlock
                    lang={lang}
                    code={code}
                    options={options}
                    codeblock={
                        title
                            ? {
                                  title,
                                  icon,
                              }
                            : undefined
                    }
                />
            </div>
        </div>
    );
}
