'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import styles from './scroll-rail.module.css';

export interface ScrollRailItem {
    id: string;
    icon: ReactNode;
    label: string;
    title: string;
    description: string;
    visual: ReactNode;
}

/**
 * A column of text blocks that scrolls past a visual pinned beside it. The
 * block crossing the middle of the viewport marks itself on the rail and
 * decides which visual is shown.
 */
export function ScrollRail({ items }: { items: ScrollRailItem[] }) {
    const [activeIndex, setActiveIndex] = useState(0);
    const blocks = useRef<(HTMLDivElement | null)[]>([]);

    useEffect(() => {
        let frame = 0;

        const update = () => {
            frame = 0;
            const middle = window.innerHeight / 2;
            let nearestIndex = 0;
            let nearestDistance = Infinity;

            blocks.current.forEach((block, index) => {
                if (!block) return;
                const box = block.getBoundingClientRect();
                const distance = Math.abs(box.top + box.height / 2 - middle);
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestIndex = index;
                }
            });

            setActiveIndex(nearestIndex);
        };

        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(update);
        };

        update();
        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);

        return () => {
            if (frame) cancelAnimationFrame(frame);
            window.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
        };
    }, [items.length]);

    return (
        <div className={styles.rail}>
            <div className={styles.track}>
                {items.map((item, index) => (
                    <div
                        key={item.id}
                        ref={(element) => {
                            blocks.current[index] = element;
                        }}
                        className={index === activeIndex ? `${styles.block} ${styles.blockActive}` : styles.block}>
                        <p className={styles.label}>
                            <span className={styles.labelIcon}>{item.icon}</span>
                            {item.label}
                        </p>
                        <h3 className={styles.title}>{item.title}</h3>
                        <p className={styles.description}>{item.description}</p>
                        <div className={styles.inlineVisual}>{item.visual}</div>
                    </div>
                ))}
            </div>

            <div className={styles.stage}>
                <div className={styles.stack}>
                    {items.map((item, index) => (
                        <div
                            key={item.id}
                            className={index === activeIndex ? `${styles.frame} ${styles.frameActive}` : styles.frame}
                            aria-hidden={index !== activeIndex}>
                            {item.visual}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
