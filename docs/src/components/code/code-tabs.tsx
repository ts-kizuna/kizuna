'use client';

import clsx from 'clsx';
import styles from './code-tabs.module.css';

export interface CodeTab {
    id: string;
    label: string;
}

interface CodeTabsProps {
    tabs: CodeTab[];
    activeId: string;
    onSelect: (id: string) => void;
    label: string;
    className?: string;
}

export function CodeTabs({ tabs, activeId, onSelect, label, className }: CodeTabsProps) {
    return (
        <div className={clsx(styles.tabs, className)} role="tablist" aria-label={label}>
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`${label}-tab-${tab.id}`}
                    aria-selected={tab.id === activeId}
                    aria-controls={`${label}-panel-${tab.id}`}
                    onClick={() => onSelect(tab.id)}
                    className={tab.id === activeId ? `${styles.tab} ${styles.tabActive}` : styles.tab}>
                    {tab.label}
                </button>
            ))}
        </div>
    );
}
