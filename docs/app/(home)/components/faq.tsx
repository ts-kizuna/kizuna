import type { ReactNode } from 'react';
import Link from 'next/link';
import { CodeWindow } from '@/lib/CodeWindow';
import { TsLogo } from '@/lib/brand-icons';
import styles from './faq.module.css';

const TRPC_EXAMPLE = `import { KizunaClient } from '@ts-kizuna/fetch';
import { contract } from '@shared/contract';

const client = new KizunaClient(contract, {
    baseUrl: 'https://api.example.com',
});

const result = await client.users.getUser({
    params: {
        id: '1',
    },
});`;

interface Question {
    question: string;
    answer: ReactNode;
}

export const questions: Question[] = [
    {
        question: 'Why ts-kizuna?',
        answer: (
            <>
                <p className={styles.body}>One contract, a fully typed stack.</p>
                <p className={styles.body}>
                    Describe your API once. ts-kizuna infers a typed server and a client you call like a function straight from the
                    contract, and generates OpenAPI docs, native Swift and Kotlin clients, and an MCP server from the same definition. No
                    copying types between repos, no docs to keep up to date by hand.
                </p>
                <p className={styles.body}>
                    Change the API and your editor shows you everything that breaks, right then. Deprecate a field and every caller sees it
                    before it&rsquo;s gone. Frontend, backend, and mobile stay in step because they all come from one source, so the bug
                    where a client quietly drifts from the server just stops happening.
                </p>
                <p className={styles.body}>
                    And it&rsquo;s real HTTP underneath: proper REST routes, correct status codes, RFC 9457 errors.
                </p>
                <p className={styles.body}>
                    The goal is simple: define your API once, and keep every client in sync with it. More on the{' '}
                    <Link className={styles.link} href="/about">
                        about page
                    </Link>
                    .
                </p>
            </>
        ),
    },
    {
        question: 'Is it ready to use?',
        answer: (
            <>
                <p className={styles.body}>
                    It runs in production in our own apps, so it&rsquo;s battle-tested. The way you define and call your API is still
                    settling, so ts-kizuna is in beta and moving toward a stable v2. Pin a version for production and follow the{' '}
                    <a className={styles.link} href="https://github.com/ts-kizuna/kizuna/releases" target="_blank" rel="noreferrer">
                        release notes
                    </a>{' '}
                    when you upgrade.
                </p>
                <p className={styles.body}>
                    <strong className={styles.strong}>Why is it already 1.0 if it&rsquo;s in beta?</strong> ts-kizuna began as an internal
                    tool. We built it for our own apps and shipped it for a long time before we open-sourced it, so by the time it became
                    public it had already been through many versions. We kept that history rather than resetting the number, which is why a
                    beta carries a 1.x version. The label is about the API surface still settling, not about stability.
                </p>
            </>
        ),
    },
    {
        question: "What's on the roadmap?",
        answer: (
            <>
                <p className={styles.body}>We&rsquo;re just getting started. Here&rsquo;s where ts-kizuna is headed:</p>
                <ul className={styles.bullets}>
                    <li>A stable v2 syntax, with the way you define and call your API locked in</li>
                    <li>SSE and streaming responses</li>
                    <li>A TanStack Query client, built from the same contract</li>
                    <li>Whatever the future brings</li>
                </ul>
            </>
        ),
    },
    {
        question: 'Why Zod only?',
        answer: (
            <p className={styles.body}>
                ts-kizuna won&rsquo;t support Standard Schema or other validators. It leans on Zod features directly for its inference and
                coercion, and committing to one validator is what keeps the types this precise.
            </p>
        ),
    },
    {
        question: 'Can I use my API from non-TypeScript clients?',
        answer: (
            <p className={styles.body}>
                Yes. ts-kizuna describes a real REST API, so anything that speaks HTTP can call it. The same contract also generates an
                OpenAPI document, native Swift and Kotlin clients, and an MCP server.
            </p>
        ),
    },
    {
        question: 'Coming from ts-rest?',
        answer: (
            <p className={styles.body}>
                ts-kizuna is inspired by{' '}
                <a className={styles.link} href="https://ts-rest.com" target="_blank" rel="noreferrer">
                    ts-rest
                </a>{' '}
                and keeps the public API familiar. The{' '}
                <Link className={styles.link} href="/docs/migration/from-ts-rest">
                    migration guide
                </Link>{' '}
                maps each API to its ts-kizuna equivalent.
            </p>
        ),
    },
    {
        question: 'Why not just use tRPC?',
        answer: (
            <>
                <p className={styles.body}>
                    <a className={styles.link} href="https://trpc.io" target="_blank" rel="noreferrer">
                        tRPC
                    </a>{' '}
                    is a great choice for a pure TypeScript stack, and you don&rsquo;t give up the RPC-like client by choosing ts-kizuna.
                    You still call your endpoints like functions and get fully typed results back:
                </p>
                <div className={styles.code}>
                    <CodeWindow
                        lang="ts"
                        code={TRPC_EXAMPLE}
                        title="src/api-client.ts"
                        icon={<TsLogo className={styles.fileIcon} />}
                        dots
                    />
                </div>
                <p className={styles.body}>
                    The difference is that ts-kizuna is the better fit when your API also has consumers outside that client, like another
                    language, a public integration, or anything reading the OpenAPI spec.
                </p>
                <p className={styles.body}>
                    With ts-kizuna, you also get native Swift and Kotlin clients from that same contract, so your iOS and Android apps are
                    typed against the API too.
                </p>
            </>
        ),
    },
    {
        question: 'How can I help?',
        answer: (
            <>
                <p className={styles.body}>
                    We&rsquo;d love your help. Bug reports, small reproductions, and doc fixes are always welcome, and an issue or a PR for
                    any of those is a great place to start.
                </p>
                <p className={styles.body}>
                    Everything we merge into the core is something we commit to maintaining for the long haul, so we don&rsquo;t take
                    additions lightly. We keep it small and stick to the packages we actually use, which is why new first-party adapters and
                    clients won&rsquo;t be merged. The better news: the adapter and client APIs are public, so you can build exactly what
                    you need (see the{' '}
                    <Link className={styles.link} href="/docs/extend/create-adapter">
                        extend guide
                    </Link>
                    ).
                </p>
                <p className={styles.body}>
                    For anything beyond a bug fix or docs, like a new feature or an API change,{' '}
                    <a className={styles.link} href="https://github.com/ts-kizuna/kizuna/issues/new" target="_blank" rel="noreferrer">
                        open an issue
                    </a>{' '}
                    first so we can check it fits before you build it.
                </p>
            </>
        ),
    },
    {
        question: 'Do you offer support?',
        answer: (
            <p className={styles.body}>
                ts-kizuna is open source and provided as-is. The docs are thorough and the source is open, so most answers are within reach.
                For anything else, open an issue on{' '}
                <a className={styles.link} href="https://github.com/ts-kizuna/kizuna/issues" target="_blank" rel="noreferrer">
                    GitHub
                </a>
                . For production, pin a version so you control when anything changes.
            </p>
        ),
    },
    {
        question: 'Why is it called ts-kizuna?',
        answer: (
            <p className={styles.body}>
                絆 (kizuna) is Japanese for a deep, enduring bond, which is what one contract gives everything built on top of it. More on
                the{' '}
                <Link className={styles.link} href="/about">
                    about page
                </Link>
                .
            </p>
        ),
    },
];

export function Faq() {
    return (
        <div className={styles.faq}>
            {questions.map((entry) => (
                <section key={entry.question} className={styles.entry}>
                    <h2 className={styles.heading}>{entry.question}</h2>
                    {entry.answer}
                </section>
            ))}
        </div>
    );
}
