import { RootProvider } from 'fumadocs-ui/provider/next';

import { Plus_Jakarta_Sans } from 'next/font/google';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './global.css';

import styles from './layout.module.css';

const plusJakartaSans = Plus_Jakarta_Sans({
    subsets: ['latin'],
    variable: '--font-plus-jakarta',
    display: 'swap',
});

export const metadata: Metadata = {
    metadataBase: new URL('https://ts-kizuna.com'),
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
                url: '/readme-beta.png',
                width: 1024,
                height: 241,
                alt: 'ts-kizuna',
            },
        ],
    },
    twitter: {
        card: 'summary_large_image',
        images: ['/readme-beta.png'],
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
