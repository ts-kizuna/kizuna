'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import styles from './adapter-switcher.module.css';

export interface AdapterOption {
    id: string;
    name: string;
    context: string;
    visual: ReactNode;
}

export function AdapterSwitcher({ options }: { options: AdapterOption[] }) {
    const [activeId, setActiveId] = useState(options[0].id);
    const active = options.find((option) => option.id === activeId) ?? options[0];

    return (
        <div className={styles.switcher}>
            <div className={styles.segmented} role="tablist" aria-label="Adapters">
                {options.map((option) => (
                    <button
                        key={option.id}
                        type="button"
                        role="tab"
                        id={`adapter-tab-${option.id}`}
                        aria-selected={option.id === activeId}
                        aria-controls={`adapter-panel-${option.id}`}
                        className={option.id === activeId ? `${styles.option} ${styles.optionActive}` : styles.option}
                        onClick={() => setActiveId(option.id)}>
                        {option.name}
                    </button>
                ))}
            </div>

            <div className={styles.panel} role="tabpanel" id={`adapter-panel-${active.id}`} aria-labelledby={`adapter-tab-${active.id}`}>
                {active.visual}
                <p className={styles.context}>
                    Handlers on {active.name} also receive <code className={styles.code}>{active.context}</code>, so the framework
                    underneath stays available to you.
                </p>
            </div>
        </div>
    );
}
