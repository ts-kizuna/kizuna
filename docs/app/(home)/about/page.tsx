import type { Metadata } from 'next';
import { About } from '../components/about';
import { Maintainers } from '../components/maintainers';
import { Section } from '../components/section';

export const metadata: Metadata = {
    title: 'About',
    description: 'The idea behind ts-kizuna, and who builds it.',
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
