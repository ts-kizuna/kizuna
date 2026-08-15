'use client';

import clsx from 'clsx';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';
import { completionTransformer, resolveCompletion, type CodeCompletion } from './code-completion';
import styles from './code-window.module.css';

type CodeWindowSize = 'small' | 'medium';

interface CodeWindowProps {
    lang: string;
    code: string;
    title?: string;
    icon?: ReactNode;
    dots?: boolean;
    size?: CodeWindowSize;
    completion?: CodeCompletion;
    options?: ComponentProps<typeof DynamicCodeBlock>['options'];
}

export function CodeWindow({ lang, code, title, icon, dots = false, size = 'medium', completion, options }: CodeWindowProps) {
    const anchor = completion ? resolveCompletion(code, completion) : null;

    const codeOptions = {
        themes: {
            light: 'github-light',
            dark: 'github-dark',
        },
        ...options,
        transformers:
            completion && anchor ? [...(options?.transformers ?? []), completionTransformer(completion, anchor)] : options?.transformers,
    } as CodeWindowProps['options'];

    return (
        <div
            className={clsx(styles.window, size === 'small' && styles.small, anchor && styles.withCompletion)}
            style={
                completion && anchor
                    ? ({
                          '--completion-rows': completion.items.length,
                      } as CSSProperties)
                    : undefined
            }>
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
                    options={codeOptions}
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
