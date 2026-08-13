import type { Metadata } from 'next';
import { Faq } from '../components/faq';
import { Section } from '../components/section';

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
