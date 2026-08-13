import type { Metadata } from 'next';
import { About } from '@/components/landing-page/about';
import { Maintainers } from '@/components/landing-page/maintainers';
import { Section } from '@/components/landing-page/section';

export const metadata: Metadata = {
    title: 'About',
    description: 'The idea behind ts-kizuna.',
    robots: {
        index: false,
        follow: false,
    },
};

export default function AboutPage() {
    return (
        <>
            <Section title="About">
                <About />
                <Maintainers />
            </Section>
        </>
    );
}
