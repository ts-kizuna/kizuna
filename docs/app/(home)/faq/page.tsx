import type { Metadata } from 'next';
import { Faq } from '@/components/landing-page/faq';
import { Section } from '@/components/landing-page/section';

export const metadata: Metadata = {
    title: 'FAQ',
    description: 'Answers to common questions about ts-kizuna.',
};

export default function FaqPage() {
    return (
        <Section title="FAQ">
            <Faq />
        </Section>
    );
}
