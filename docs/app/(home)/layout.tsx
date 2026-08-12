import type { ReactNode } from 'react';
import { SiteHeader } from './components/site-header';
import { SiteFooter } from './components/site-footer';
import './tokens.css';

export default function HomeLayout({ children }: { children: ReactNode }) {
    return (
        <div className="kz-landing">
            <SiteHeader />
            <main>{children}</main>
            <SiteFooter />
        </div>
    );
}
