import type { Metadata } from 'next';
import { HandlerExplorer } from '@/components/code/handler-explorer';
import { Adapters } from '@/components/landing-page/adapters';
import { AiEra } from '@/components/landing-page/ai-era';
import { Beta } from '@/components/landing-page/beta';
import { ClosingCta } from '@/components/landing-page/closing-cta';
import { FeatureCards } from '@/components/landing-page/feature-cards';
import { Hero } from '@/components/landing-page/hero';
import { LinkCards } from '@/components/landing-page/link-cards';
import { Section } from '@/components/landing-page/section';
import { SourceOfTruth } from '@/components/landing-page/source-of-truth';
import styles from './page.module.css';

export const metadata: Metadata = {
    title: {
        absolute: 'ts-kizuna | Build fully typed REST APIs with TypeScript',
    },
    description:
        'Write one contract. Get a fully typed server, typed auth, scheduled jobs, an OpenAPI spec, Swift and Kotlin clients, an MCP server, and more.',
};

export default function HomePage() {
    return (
        <div className={styles.page}>
            <Hero className={styles.hero} />

            <Beta className={styles.beta} />

            <Section className={styles.cards}>
                <FeatureCards />
            </Section>

            <div className={styles.sections}>
                <SourceOfTruth />

                <Section title="Inside a handler" description="Whatever the contract declares, the handler gets it validated and typed.">
                    <HandlerExplorer />
                </Section>

                <Section
                    title="Runs anywhere"
                    description="The same contract and router move between adapters, and the framework underneath stays available to you.">
                    <Adapters />
                </Section>

                <AiEra />

                <Section title="Start here">
                    <LinkCards />
                </Section>
            </div>

            <Section className={styles.cta}>
                <ClosingCta />
            </Section>
        </div>
    );
}
