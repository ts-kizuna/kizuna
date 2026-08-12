'use client';

import { Search } from 'lucide-react';
import { useSearchContext } from 'fumadocs-ui/contexts/search';
import styles from './search-button.module.css';

export function SearchButton() {
    const { enabled, setOpenSearch } = useSearchContext();

    if (!enabled) return null;

    return (
        <button type="button" className={styles.button} onClick={() => setOpenSearch(true)}>
            <Search className={styles.icon} aria-hidden />
            Search in docs
        </button>
    );
}
