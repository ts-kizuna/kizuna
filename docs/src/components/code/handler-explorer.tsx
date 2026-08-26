'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { CodeWindow } from './code-window';
import styles from './handler-explorer.module.css';
import type { CodeCompletion } from './code-completion';

function TsLogo({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="#3178c6" className={className}>
            <path d="M1.125 0C.502 0 0 .502 0 1.125v21.75C0 23.498.502 24 1.125 24h21.75c.623 0 1.125-.502 1.125-1.125V1.125C24 .502 23.498 0 22.875 0zm17.363 9.75c.612 0 1.154.037 1.627.111a6.38 6.38 0 0 1 1.306.34v2.458a3.95 3.95 0 0 0-.643-.361 5.093 5.093 0 0 0-.717-.26 5.453 5.453 0 0 0-1.426-.2c-.3 0-.573.028-.819.086a2.1 2.1 0 0 0-.623.242c-.17.104-.3.229-.393.374a.888.888 0 0 0-.14.49c0 .196.053.373.156.529.104.156.252.304.443.444s.423.276.696.41c.273.135.582.274.926.416.47.197.892.407 1.266.628.374.222.695.473.963.753.268.279.472.598.614.957.142.359.214.776.214 1.253 0 .657-.125 1.21-.373 1.656a3.033 3.033 0 0 1-1.012 1.085 4.38 4.38 0 0 1-1.487.596c-.566.12-1.163.18-1.79.18a9.916 9.916 0 0 1-1.84-.164 5.544 5.544 0 0 1-1.512-.493v-2.63a5.033 5.033 0 0 0 3.237 1.2c.333 0 .624-.03.872-.09.249-.06.456-.144.623-.25.166-.108.29-.234.373-.38a1.023 1.023 0 0 0-.074-1.089 2.12 2.12 0 0 0-.537-.5 5.597 5.597 0 0 0-.807-.444 27.72 27.72 0 0 0-1.007-.436c-.918-.383-1.602-.852-2.053-1.405-.45-.553-.676-1.222-.676-2.005 0-.614.123-1.141.369-1.582.246-.441.58-.804 1.004-1.089a4.494 4.494 0 0 1 1.47-.629 7.536 7.536 0 0 1 1.77-.201zm-15.113.188h9.563v2.166H9.506v9.646H6.789v-9.646H3.375z" />
        </svg>
    );
}

interface Feature {
    id: string;
    file: string;
    note: string;
    code: string;
    completion?: CodeCompletion;
}

const FEATURES: Feature[] = [
    {
        id: 'params',
        file: 'reports.router.ts',
        note: 'Typed from the path string itself. Rename a param and every handler that reads it fails to compile.',
        code: `getReport: async ({ params }) => {
    const report = await db.reports.findFirst({
        where: {
            month: params.month,
            year: params.`,
        completion: {
            after: 'params.',
            items: ['year', 'month', 'day'],
            selected: 'year',
        },
    },
    {
        id: 'query',
        file: 'users.router.ts',
        note: 'Numbers arrive as numbers and enums as enums, so you never reach for z.coerce.',
        code: `listUsers: async ({ query }) => {
    const users = await db.users.findMany({
        take: query.perPage,
        orderBy: {
            createdAt: query.`,
        completion: {
            after: 'query.',
            items: ['perPage', 'order', 'search'],
            selected: 'order',
        },
    },
    {
        id: 'body',
        file: 'users.router.ts',
        note: 'Validated against your schema before the handler runs, so invalid requests never reach your code.',
        code: `createUser: async ({ body }) => {
    const user = await db.users.create({
        data: {
            name: body.name,
            role: 'member',
            email: body.`,
        completion: {
            after: 'body.',
            items: ['name', 'email'],
            selected: 'email',
        },
    },
    {
        id: 'headers',
        file: 'users.router.ts',
        note: 'Declared headers become literal keys, spelled exactly the way the spec spells them.',
        code: `updateUser: async ({ params, body, headers }) => {
    const updated = await db.users.update({
        data: body,
        where: {
            id: params.userId,
            version: Number(headers['`,
        completion: {
            after: "headers['",
            items: ["'if-match'", "'accept-language'"],
            selected: "'if-match'",
        },
    },
    {
        id: 'auth',
        file: 'users.router.ts',
        note: 'The guard has already verified the caller, so the handler receives a plain typed value.',
        code: `getMe: async ({ auth }) => {
    const user = await db.users.findById(auth.member.workspaceUserId);

    return {
        status: 200,
        body: {
            name: user.name,
            email: user.email,
        },
    };
},`,
    },
    {
        id: 'requestContext',
        file: 'users.router.ts',
        note: 'Declared once, resolved per request, available in every handler without touching a signature.',
        code: `createInvite: async ({ requestContext }) => {
    await posthog.capture({
        distinctId: requestContext.analytics.distinctId,
        event: 'invite_sent',
        properties: {
            $session_id: requestContext.analytics.`,
        completion: {
            after: 'analytics.',
            items: ['distinctId', 'sessionId'],
            selected: 'sessionId',
        },
    },
    {
        id: 'jobs',
        file: 'users.router.ts',
        note: 'Every job the contract declares. Queue it and answer now, or run it and wait for the result.',
        code: `createUser: async ({ body, jobs }) => {
    await db.users.create({
        data: body,
    });

    await jobs.updateSearchIndex.`,
        completion: {
            after: 'updateSearchIndex.',
            items: ['queue', 'run'],
            selected: 'queue',
        },
    },
    {
        id: 'plugins',
        file: 'users.router.ts',
        note: 'Plugins ride on the contract, so their features arrive typed under their own names.',
        code: `updateUser: async ({ params, body, plugins }) => {
    const user = await db.users.update(params.userId, body);

    await plugins.email.send({
        to: user.email,
        template: '`,
        completion: {
            after: "template: '",
            items: ["'welcome'", "'profile-updated'", "'password-reset'"],
            selected: "'profile-updated'",
        },
    },
    {
        id: 'throwError',
        file: 'users.router.ts',
        note: 'Failure responses live in the contract, so a handler can only throw what its route declares.',
        code: `deleteUser: async ({ params, throwError }) => {
    const user = await db.users.findById(params.userId);
    if (!user) throwError({
        status: 404,
        body: {
            detail: 'No user with that id',
        },
    });

    await db.users.delete(user.id);`,
    },
];

export function HandlerExplorer({ className }: { className?: string }) {
    const [active, setActive] = useState(FEATURES[0].id);
    const feature = FEATURES.find((candidate) => candidate.id === active) ?? FEATURES[0];

    return (
        <section className={clsx('not-prose', styles.root, className)}>
            <div className={styles.copy}>
                <h2 className={styles.title}>Inside a handler</h2>
                <p className={styles.description}>Whatever the contract declares, the handler gets it validated and typed.</p>
                <div className={styles.tokens}>
                    {FEATURES.map((candidate) => (
                        <button
                            key={candidate.id}
                            type="button"
                            aria-pressed={candidate.id === active}
                            onClick={() => setActive(candidate.id)}
                            className={candidate.id === active ? clsx(styles.token, styles.tokenActive) : styles.token}>
                            {candidate.id}
                        </button>
                    ))}
                </div>
                <p className={styles.note}>{feature.note}</p>
            </div>

            <div className={styles.scene}>
                {FEATURES.map((candidate) => (
                    <div
                        key={candidate.id}
                        aria-hidden={candidate.id !== active}
                        className={candidate.id === active ? styles.sceneItem : clsx(styles.sceneItem, styles.sceneItemHidden)}>
                        <CodeWindow
                            lang="ts"
                            code={candidate.code}
                            dots
                            title={candidate.file}
                            icon={<TsLogo className={styles.brandIcon} />}
                            completion={candidate.completion}
                        />
                    </div>
                ))}
            </div>
        </section>
    );
}
