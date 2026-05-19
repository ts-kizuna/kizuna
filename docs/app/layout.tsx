import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';
import './global.css';

export const metadata = {
    title: {
        default: 'ts-kizuna',
        template: '%s | ts-kizuna',
    },
    description: 'Build fully typed REST APIs with TypeScript — contract-first, RFC-correct, powered by Zod 4.',
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
        <html lang="en" suppressHydrationWarning>
            <body className="flex flex-col min-h-screen">
                <RootProvider>{children}</RootProvider>
            </body>
        </html>
    );
}
