import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/landing-page/site-header';
import { SiteFooter } from '@/components/landing-page/site-footer';
import '../tokens.css';

export default function HomeLayout({ children }: { children: ReactNode }) {
    return (
        <div className="kizuna-landing-page">
            <SiteHeader />
            <main>{children}</main>
            <SiteFooter />
        </div>
    );
}
