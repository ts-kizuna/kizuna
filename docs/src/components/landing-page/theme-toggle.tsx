'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import styles from './theme-toggle.module.css';

const modes = [
    {
        value: 'light',
        label: 'Light',
        Icon: Sun,
    },
    {
        value: 'dark',
        label: 'Dark',
        Icon: Moon,
    },
];

export function ThemeToggle() {
    const { resolvedTheme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => setMounted(true), []);

    return (
        <div className={styles.switch}>
            {modes.map((mode) => {
                const isActive = mounted && resolvedTheme === mode.value;

                return (
                    <button
                        key={mode.value}
                        type="button"
                        className={isActive ? `${styles.option} ${styles.optionActive}` : styles.option}
                        onClick={() => setTheme(mode.value)}
                        aria-pressed={isActive}
                        aria-label={`${mode.label} theme`}>
                        <mode.Icon className={styles.icon} aria-hidden />
                    </button>
                );
            })}
        </div>
    );
}
