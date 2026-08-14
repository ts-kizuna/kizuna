import type { Metadata } from 'next';
import { ContractSource, ContractSurfaces } from '@/components/code/contract-explorer';
import { HandlerExplorer } from '@/components/code/handler-explorer';
import { Adapters } from '@/components/landing-page/adapters';
import { Beta } from '@/components/landing-page/beta';
import { ClosingCta } from '@/components/landing-page/closing-cta';
import { FeatureCards } from '@/components/landing-page/feature-cards';
import { Hero } from '@/components/landing-page/hero';
import { LinkCards } from '@/components/landing-page/link-cards';
import { Section } from '@/components/landing-page/section';
import { StatBand } from '@/components/landing-page/stat-band';
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
            <div className={styles.top}>
                <Hero className={styles.hero} />
                <Beta />
            </div>

            <div className={styles.sections}>
                <Section
                    layout="split"
                    title="One contract is the source of truth"
                    description="Declare your routes, their schemas, and their statuses once. Everything else is read from it.">
                    <ContractSource />
                </Section>

                <StatBand />

                <ContractSurfaces />

                <Section title="Inside a handler" description="Whatever the contract declares, the handler gets it validated and typed.">
                    <HandlerExplorer />
                </Section>

                <Section
                    title="Runs anywhere"
                    description="The same contract and router move between adapters. Mounting is the only line that changes.">
                    <Adapters />
                </Section>

                <Section
                    title="Everything in the box"
                    description="Each piece is its own package. Install the ones you use, and every one of them reads the same contract.">
                    <FeatureCards />
                </Section>

                <Section title="Start here">
                    <LinkCards />
                </Section>
            </div>

            <ClosingCta className={styles.cta} />
        </div>
    );
}
