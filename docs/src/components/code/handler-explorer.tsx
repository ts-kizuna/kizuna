'use client';

import clsx from 'clsx';
import { useState } from 'react';
import type { ShikiTransformer } from 'shiki';
import { CodeWindow } from './code-window';
import styles from './handler-explorer.module.css';

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
    token: string;
    type: string;
    note: string;
    code: string;
}

const FEATURES: Feature[] = [
    {
        id: 'params',
        file: 'users.router.ts',
        token: 'params',
        type: `params: {
    workspaceId: string;
    userId: string;
}`,
        note: `Autocomplete knows every param in the path. Change the path and your editor points at every handler to update.`,
        code: `export const users: Router<typeof contract.routes.users> = {
    getUser: async ({ params }) => {
        const user = await db.user.findFirstOrThrow({
            where: {
                id: params.userId,
                workspaceId: params.workspaceId,
            },
        });
        return {
            status: 200,
            body: user,
        };
    },
};`,
    },
    {
        id: 'query',
        file: 'users.router.ts',
        token: 'query',
        type: `query: {
    page: number;
    perPage: number;
    order: 'asc' | 'desc';
    search?: string;
}`,
        note: `Autocomplete over your filters and pagination, already the right types. Nothing to look up, nothing to convert.`,
        code: `export const users: Router<typeof contract.routes.users> = {
    listUsers: async ({ query }) => {
        const users = await db.user.findMany({
            where: {
                name: {
                    contains: query.search,
                },
            },
            skip: (query.page - 1) * query.perPage,
            take: query.perPage,
            orderBy: {
                createdAt: query.order,
            },
        });
        return {
            status: 200,
            body: users,
        };
    },
};`,
    },
    {
        id: 'body',
        file: 'users.router.ts',
        token: 'body',
        type: `body: {
    email: string;
    name: string;
    role: 'member' | 'admin';
    profile?: {
        timezone: string;
    };
}`,
        note: `body is already the shape you declared, so it drops straight into your database call with autocomplete on every field.`,
        code: `export const users: Router<typeof contract.routes.users> = {
    createUser: async ({ body, auth }) => {
        const user = await db.user.create({
            data: {
                email: body.email,
                name: body.name,
                role: body.role,
                timezone: body.profile?.timezone ?? 'UTC',
                invitedById: auth.member.workspaceUserId,
            },
        });
        return {
            status: 201,
            body: user,
        };
    },
};`,
    },
    {
        id: 'headers',
        file: 'users.router.ts',
        token: 'headers',
        type: `headers: {
    'if-match': string;
    'accept-language': 'en' | 'nb';
}`,
        note: `Type headers[' and your editor lists the headers this route declares, spelled the way the spec spells them.`,
        code: `export const users: Router<typeof contract.routes.users> = {
    updateUser: async ({ params, body, headers }) => {
        const updated = await db.user.update({
            where: {
                id: params.userId,
                version: Number(headers['if-match']),
            },
            data: body,
        });
        return {
            status: 200,
            body: updated,
            headers: {
                etag: String(updated.version),
                'content-language': headers['accept-language'],
            },
        };
    },
};`,
    },
    {
        id: 'auth',
        file: 'workspace.router.ts',
        token: 'auth',
        type: `auth: {
    member: {
        workspaceUserId: string;
        role: 'owner';
        permissions: ('billing:read' | 'billing:write' | 'members:manage')[];
    };
}`,
        note: `auth. autocompletes to exactly what this route's caller is allowed to be. No casting, no optional chaining.`,
        code: `export const workspace: Router<typeof contract.routes.workspace> = {
    deleteWorkspace: async ({ params, auth }) => {
        const deleted = await db.workspace.delete({
            where: {
                id: params.workspaceId,
                ownerId: auth.member.workspaceUserId,
            },
        });
        return {
            status: 200,
            body: {
                deletedAt: deleted.deletedAt,
            },
        };
    },
};`,
    },
    {
        id: 'requestContext',
        file: 'users.router.ts',
        token: 'requestContext',
        type: `requestContext: {
    analytics: {
        sessionId: string | null;
        distinctId: string;
    };
}`,
        note: `Available by name in every handler, with autocomplete, without touching a single function signature.`,
        code: `export const users: Router<typeof contract.routes.users> = {
    listUsers: async ({ query, requestContext }) => {
        const { analytics } = requestContext;
        const users = await db.user.findMany({
            take: query.perPage,
        });
        await posthog.capture({
            distinctId: analytics.distinctId,
            event: 'users_listed',
            properties: {
                sessionId: analytics.sessionId,
            },
        });
        return {
            status: 200,
            body: users,
        };
    },
};`,
    },
    {
        id: 'jobs',
        file: 'users.router.ts',
        token: 'jobs',
        type: `jobs: {
    indexUser: {
        run: (input: { userId: string }) => Promise<void>;
        queue: (message: {
            input: { userId: string };
            dedupeKey?: string;
            runAt?: Date;
        }) => Promise<void>;
    };
}`,
        note: `Every job the contract declares, shaped like the declaration. queue answers the request without waiting; run blocks and gives you the result.`,
        code: `export const users: Router<typeof contract.routes.users> = {
    createUser: async ({ body, jobs }) => {
        const user = await db.user.create({
            data: body,
        });
        await jobs.indexUser.queue({
            input: {
                userId: user.id,
            },
        });
        return {
            status: 201,
            body: user,
        };
    },
};`,
    },
    {
        id: 'plugins',
        file: 'users.router.ts',
        token: 'plugins',
        type: `plugins: {
    email: {
        send: (message: {
            to: string;
            template: 'welcome' | 'profile-updated';
        }) => Promise<void>;
    };
}`,
        note: `Whatever your plugins offer, keyed by name. Type plugins. and autocomplete lists them.`,
        code: `export const users: Router<typeof contract.routes.users> = {
    updateUser: async ({ params, body, plugins }) => {
        const user = await db.user.update({
            where: {
                id: params.userId,
            },
            data: body,
        });
        await plugins.email.send({
            to: user.email,
            template: 'profile-updated',
        });
        return {
            status: 200,
            body: user,
        };
    },
};`,
    },
    {
        id: 'throwError',
        file: 'users.router.ts',
        token: 'throwError',
        type: `throwError: (response: {
    status: 404 | 409;
    body: {
        detail: string;
    };
}) => never`,
        note: `The failures this endpoint declares show up in autocomplete as you type.`,
        code: `export const users: Router<typeof contract.routes.users> = {
    deleteUser: async ({ params, auth, throwError }) => {
        if (params.userId === auth.member.workspaceUserId) return throwError({
            status: 409,
            body: {
                detail: 'You cannot remove yourself from the workspace',
            },
        });
        const removed = await db.user.delete({
            where: {
                id: params.userId,
            },
        });
        return {
            status: 200,
            body: {
                removed: removed.id,
            },
        };
    },
};`,
    },
];

function tokenTransformer(feature: Feature): ShikiTransformer {
    const lines = feature.code.split('\n');
    const lineIndex = lines.findIndex((line) => line.includes(`{ ${feature.token}`) || line.includes(`, ${feature.token}`));

    return {
        name: 'kizuna-type-token',
        line(node, lineNumber) {
            if (lineNumber - 1 !== lineIndex) return;
            for (const child of node.children) {
                if (child.type !== 'element') continue;
                const [text] = child.children;
                if (text?.type === 'text' && text.value.trim() === feature.token) {
                    child.properties.className = ['kizuna-type-token'];
                    return;
                }
            }
        },
    };
}

const TRANSFORMERS = new Map(FEATURES.map((feature) => [feature.id, tokenTransformer(feature)]));

export function HandlerExplorer({ className }: { className?: string }) {
    const [active, setActive] = useState(FEATURES[0].id);
    const feature = FEATURES.find((candidate) => candidate.id === active) ?? FEATURES[0];

    return (
        <div className={clsx('not-prose kizuna-handler', styles.root, className)}>
            <div className={styles.tabs}>
                {FEATURES.map((candidate) => (
                    <button
                        key={candidate.id}
                        type="button"
                        aria-pressed={active === candidate.id}
                        onClick={() => setActive(candidate.id)}
                        className={active === candidate.id ? `${styles.tab} ${styles.tabActive}` : styles.tab}>
                        {candidate.id}
                    </button>
                ))}
            </div>

            <div className={styles.card}>
                <CodeWindow
                    lang="ts"
                    code={feature.code}
                    dots
                    title={feature.file}
                    icon={<TsLogo key="ts" className={styles.brandIcon} />}
                    options={{
                        themes: {
                            light: 'github-light',
                            dark: 'github-dark',
                        },
                        transformers: [TRANSFORMERS.get(feature.id)!],
                    }}
                />

                <div className={styles.types}>
                    <CodeWindow
                        lang="ts"
                        code={feature.type}
                        size="small"
                        options={{
                            themes: {
                                light: 'github-light',
                                dark: 'github-dark',
                            },
                        }}
                    />
                </div>

                <p className={styles.note}>{feature.note}</p>
            </div>
        </div>
    );
}
