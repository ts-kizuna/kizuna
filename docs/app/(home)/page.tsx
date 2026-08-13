import type { Metadata } from 'next';
import { ContractExplorer } from '@/lib/ContractExplorer';
import { HandlerExplorer } from '@/lib/HandlerExplorer';
import { Adapters } from './components/adapters';
import { Beta } from './components/beta';
import { ClosingCta } from './components/closing-cta';
import { FeatureCards } from './components/feature-cards';
import { Hero } from './components/hero';
import { LinkCards } from './components/link-cards';
import { Section } from './components/section';

export const metadata: Metadata = {
    title: {
        absolute: 'ts-kizuna | Build fully typed REST APIs with TypeScript',
    },
    description:
        'Write one contract. Get a fully typed server, typed auth, scheduled jobs, an OpenAPI spec, Swift and Kotlin clients, an MCP server, and more.',
};

export default function HomePage() {
    return (
        <>
            <Hero />

            <Beta />

            <Section tight>
                <FeatureCards />
            </Section>

            <Section
                title="The idea"
                description="One contract is the source of truth. Your server, your clients, and every generated artifact read from it.">
                <ContractExplorer />
            </Section>

            <Section title="Inside a handler" description="Whatever the contract declares, the handler gets it validated and typed.">
                <HandlerExplorer />
            </Section>

            <Section
                title="Runs anywhere"
                description="The same contract and router move between adapters, and the framework underneath stays available to you.">
                <Adapters />
            </Section>

            <Section title="Start here">
                <LinkCards />
            </Section>

            <Section tight>
                <ClosingCta />
            </Section>
        </>
    );
}
