import clsx from 'clsx';
import { CodeWindow } from './code-window';
import styles from './handler-explorer.module.css';
import type { CodeCompletion } from './code-completion';

interface Moment {
    id: string;
    title: string;
    text: string;
    code: string;
    completion?: CodeCompletion;
    hover?: string;
}

const MOMENTS: Moment[] = [
    {
        id: 'inputs',
        title: 'Inputs arrive typed',
        text: 'params, query, body, and headers are validated against the contract before your handler runs.',
        code: `listUsers: async ({ query }) => {
    const users = await db.users.findMany({
        where: {
            name: {
                contains: query.`,
        completion: {
            after: 'query.',
            items: ['search', 'page', 'perPage', 'order'],
            selected: 'search',
        },
    },
    {
        id: 'auth',
        title: 'The caller, proven',
        text: 'auth is exactly what this route allows its caller to be. No casting, no optional chaining.',
        code: `deleteWorkspace: async ({ params, auth }) => {
    const deleted = await db.workspaces.delete({
        where: {
            id: params.workspaceId,
            ownerId: auth.member.workspaceUserId,
        },
    });`,
        hover: `auth: {
    member: {
        workspaceUserId: string;
        role: 'owner';
    };
}`,
    },
    {
        id: 'failures',
        title: 'Failures from the contract',
        text: 'throwError only accepts the failures this route declares, and they show up as you type.',
        code: `getUser: async ({ params, throwError }) => {
    const user = await db.users.findById(params.id);

    if (!user) throwError({
        status:`,
        completion: {
            after: 'status:',
            items: ['404', '409'],
            selected: '404',
        },
    },
    {
        id: 'declared',
        title: 'Everything declared, one property away',
        text: 'Jobs, plugins, and request context reach every handler by name, shaped like their declaration.',
        code: `createUser: async ({ body, jobs }) => {
    const user = await db.users.create({
        data: body,
    });

    await jobs.`,
        completion: {
            after: 'jobs.',
            items: ['indexUser', 'sendWelcomeEmail'],
            selected: 'indexUser',
        },
    },
];

export function HandlerExplorer({ className }: { className?: string }) {
    return (
        <div className={clsx('not-prose', styles.grid, className)}>
            {MOMENTS.map((moment) => (
                <article key={moment.id} className={styles.panel}>
                    <div className={styles.visual}>
                        <div className={styles.crop}>
                            <div className={styles.zoom}>
                                <CodeWindow lang="ts" code={moment.code} completion={moment.completion} />
                            </div>
                        </div>
                        {moment.hover ? (
                            <div className={styles.hoverCard}>
                                <CodeWindow lang="ts" code={moment.hover} />
                            </div>
                        ) : null}
                    </div>
                    <h3 className={styles.title}>{moment.title}</h3>
                    <p className={styles.text}>{moment.text}</p>
                </article>
            ))}
        </div>
    );
}
