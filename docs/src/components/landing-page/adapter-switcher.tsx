'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { CodeTabs } from '@/components/code/code-tabs';
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
            <CodeTabs
                tabs={options.map((option) => ({
                    id: option.id,
                    label: option.name,
                }))}
                activeId={activeId}
                onSelect={setActiveId}
                label="Adapters"
            />

            <div className={styles.panel} role="tabpanel" id={`Adapters-panel-${active.id}`} aria-labelledby={`Adapters-tab-${active.id}`}>
                {active.visual}
                <p className={styles.context}>
                    Handlers on {active.name} also receive <code className={styles.code}>{active.context}</code>.
                </p>
            </div>
        </div>
    );
}
