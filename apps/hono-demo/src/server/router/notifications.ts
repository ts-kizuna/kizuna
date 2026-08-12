import type { Router } from '@ts-kizuna/hono';
import type { contract } from '@ts-kizuna-demo/shared';

export const notifications: Router<typeof contract>['notifications'] = {
    listEvents: ({ query, requestContext }) => {
        return {
            status: 200,
            body: {
                events: [
                    {
                        id: 'evt_1',
                        kind: 'login',
                        occurredAt: '2026-04-01T10:00:00.000Z',
                        userId: '1',
                    },
                ],
                echo: {
                    since: query.since ? query.since.toISOString() : null,
                    kind: query.kind ?? null,
                    ids: query.ids ?? null,
                    label: query.label ?? null,
                    tagIds: query.tagIds ?? null,
                    sessionId: requestContext.analytics.sessionId,
                },
            },
        };
    },
    sendNotification: () => {
        return {
            status: 202,
            body: {
                accepted: true,
            },
        };
    },
    validateConfig: () => ({
        status: 200,
        body: {
            status: 'ok',
        },
    }),
    webhook: () => ({
        status: 200,
        body: {
            received: true,
        },
    }),
};
