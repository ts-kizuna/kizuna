import type { ReactNode } from 'react';
import Link from 'next/link';
import { CodeWindow } from '@/components/code/code-window';
import type { CodeCompletion } from '@/components/code/code-completion';
import TsLogo from '@/icons/TypeScript.svg';
import styles from './faq.module.css';

const TRPC_EXAMPLE = `import { KizunaClient } from '@ts-kizuna/fetch';
import { contract } from '@shared/contract';

const client = new KizunaClient(contract, {
    baseUrl: 'https://api.example.com',
});

const result = await client.users.`;

const TRPC_COMPLETION: CodeCompletion = {
    after: 'client.users.',
    items: ['getUser', 'listUsers', 'createUser'],
};

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
                    before it&rsquo;s gone. Frontend, backend, and mobile all come from one source, so a client cannot quietly drift from
                    the server.
                </p>
                <p className={styles.body}>
                    And it&rsquo;s real HTTP underneath: proper REST routes, correct status codes, RFC 9457 errors. More on the{' '}
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
                    It runs in production in our own apps. What is still settling is the way you define and call your API, which is why
                    ts-kizuna is in beta and moving toward a stable v2. Pin a version for production and follow the{' '}
                    <a className={styles.link} href="https://github.com/ts-kizuna/kizuna/releases" target="_blank" rel="noreferrer">
                        release notes
                    </a>{' '}
                    when you upgrade.
                </p>
                <p className={styles.body}>
                    <strong className={styles.strong}>Why is it already 1.0 if it&rsquo;s in beta?</strong> We used it internally for a
                    while before open-sourcing it, and we kept the version history rather than resetting the number. The beta label is about
                    the API surface, not about stability.
                </p>
                <p className={styles.body}>
                    Read that number as 0.x. While ts-kizuna is in beta a minor version can carry a breaking change, and every release names
                    them under <strong className={styles.strong}>&#9888; BREAKING CHANGES</strong>.
                </p>
                <p className={styles.body}>
                    The docs mark the newest surfaces with a <strong className={styles.strong}>Beta</strong> badge. Those are the most
                    likely to change before v2.
                </p>
            </>
        ),
    },
    {
        question: "What's on the roadmap?",
        answer: (
            <>
                <p className={styles.body}>Where ts-kizuna is headed:</p>
                <ul className={styles.bullets}>
                    <li>A stable v2 syntax, with the way you define and call your API locked in</li>
                    <li>SSE and streaming responses</li>
                    <li>Webhooks, declared in the contract like routes</li>
                    <li>OpenAPI 3.2.0 output</li>
                    <li>A TanStack Start adapter</li>
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
                    is a great choice for a pure TypeScript stack, and ts-kizuna does not ask you to give up the RPC-like client. You still
                    call your endpoints like functions and get fully typed results back:
                </p>
                <div className={styles.code}>
                    <CodeWindow
                        lang="ts"
                        code={TRPC_EXAMPLE}
                        title="src/api-client.ts"
                        icon={<TsLogo className={styles.fileIcon} />}
                        completion={TRPC_COMPLETION}
                        dots
                    />
                </div>
                <p className={styles.body}>
                    ts-kizuna fits better when your API has consumers outside that client: another language, a public integration, or
                    anything reading the OpenAPI spec. The same contract also generates native Swift and Kotlin clients, so your iOS and
                    Android apps are typed against the API too.
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
                    Anything we merge into the core, we maintain, so we keep it to the packages we actually use. Whether an adapter or
                    client goes first-party comes down to adoption, not age: if a framework picks up real usage, we will very likely add it.
                    What we will not take on is a framework a handful of people use. The adapter, plugin, client, and generator APIs are all
                    public, so you can build and publish exactly what you need today: see the{' '}
                    <Link className={styles.link} href="/docs/extend/create-adapter">
                        extend guides
                    </Link>
                    .
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
            <>
                <p className={styles.body}>
                    ts-kizuna is open source and provided as-is. Most answers are in the docs or the source. For anything else, open an
                    issue on{' '}
                    <a className={styles.link} href="https://github.com/ts-kizuna/kizuna/issues" target="_blank" rel="noreferrer">
                        GitHub
                    </a>
                    .
                </p>
                <p className={styles.body}>
                    It is actively maintained alongside the products we ship on it, so issues get read. One with a small reproduction is the
                    quickest to act on.
                </p>
            </>
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
