import { RootProvider } from 'fumadocs-ui/provider/next';

import { Plus_Jakarta_Sans } from 'next/font/google';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { siteUrl } from '@/lib/site';

import './global.css';

import styles from './layout.module.css';

const plusJakartaSans = Plus_Jakarta_Sans({
    subsets: ['latin'],
    variable: '--font-plus-jakarta',
    display: 'swap',
});

export const metadata: Metadata = {
    metadataBase: new URL(siteUrl),
    title: {
        default: 'ts-kizuna',
        template: '%s | ts-kizuna',
    },
    openGraph: {
        type: 'website',
        siteName: 'ts-kizuna',
        url: '/',
        images: [
            {
                url: '/open-graph.jpg',
                width: 1200,
                height: 630,
                alt: 'ts-kizuna',
            },
        ],
    },
    twitter: {
        card: 'summary_large_image',
        images: ['/open-graph.jpg'],
    },
    icons: [
        {
            rel: 'icon',
            url: '/favicon-dark.png',
            media: '(prefers-color-scheme: light)',
        },
        {
            rel: 'icon',
            url: '/favicon-light.png',
            media: '(prefers-color-scheme: dark)',
        },
    ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en" className={plusJakartaSans.variable} suppressHydrationWarning>
            <body className={styles.body}>
                <RootProvider>{children}</RootProvider>
            </body>
        </html>
    );
}
