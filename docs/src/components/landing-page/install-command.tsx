'use client';

import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import styles from './install-command.module.css';

const command = 'pnpm add @ts-kizuna/core zod';

export function InstallCommand() {
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!copied) return;

        const handle = window.setTimeout(() => setCopied(false), 2000);
        return () => window.clearTimeout(handle);
    }, [copied]);

    async function copyCommand() {
        try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
        } catch {
            setCopied(false);
        }
    }

    return (
        <button
            type="button"
            className={clsx(styles.install, copied && styles.copied)}
            onClick={copyCommand}
            aria-label={copied ? 'Install command copied' : 'Copy install command'}>
            <code className={styles.command}>{command}</code>
            {copied ? <Check className={styles.icon} /> : <Copy className={styles.icon} />}
        </button>
    );
}
