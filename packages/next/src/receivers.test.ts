import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Kizuna } from '@ts-kizuna/core';
import { KizunaServer } from './index.js';

const SECRET = 'whsec_test_secret';

const k = new Kizuna();

const routes = k.routes({
    listUsers: {
        method: 'GET',
        path: '/users',
        responses: {
            200: z.array(z.string()),
        },
    },
});

const stripe = k.receiver({
    path: '/webhooks/stripe',
    body: z.object({
        id: z.string(),
        type: z.string(),
    }),
});

const quiet = k.receiver({
    path: '/webhooks/quiet',
    body: z.object({
        action: z.string(),
    }),
});

const contract = k.contract({
    routes: {
        users: routes,
    },
    receivers: {
        stripe,
        quiet,
    },
});

const server = new KizunaServer(contract);

const router = server.router({
    users: {
        listUsers: () => ({
            status: 200,
            body: ['ada'],
        }),
    },
});

const digest = (body: string, secret = SECRET): string => createHmac('sha256', secret).update(body).digest('hex');

const verifyStripe = server.receiver.verify('stripe', ({ raw, headers, deny }) => {
    const expected = digest(new TextDecoder().decode(raw));
    const sent = headers['x-signature'] ?? '';
    if (sent.length !== expected.length || !timingSafeEqual(Buffer.from(sent), Buffer.from(expected))) {
        deny();
    }
});

const EVENT = JSON.stringify({
    id: 'evt_1',
    type: 'invoice.paid',
});

const buildHandlers = (handler = vi.fn(), options?: { basePath?: string }) => {
    const api = server.api({
        router,
        receivers: {
            stripe: {
                verify: verifyStripe,
                handler: handler as never,
            },
            quiet: {
                verify: ({ deny }) => deny(200, 'Ignored'),
                handler: vi.fn() as never,
            },
        },
    });
    return {
        handlers: api.mount(options),
        handler,
    };
};

const post = (url: string, body: string, signature?: string) =>
    new NextRequest(url, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(signature === undefined
                ? {}
                : {
                      'x-signature': signature,
                  }),
        },
        body,
    });

/**
 * The shared catalogue covers every receiver behaviour. Next's own is routing:
 * kizuna matches the path, so `basePath` has to be stripped first.
 */
describe('receivers on next', () => {
    it('resolves a receiver path under basePath', async () => {
        const { handlers, handler } = buildHandlers(vi.fn(), {
            basePath: '/api',
        });
        const response = await handlers.POST!(post('http://localhost/api/webhooks/stripe', EVENT, digest(EVENT)));
        expect(response.status).toBe(200);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('still answers on the bare path, the way a route mounted at a basePath does', async () => {
        const { handlers, handler } = buildHandlers(vi.fn(), {
            basePath: '/api',
        });
        const response = await handlers.POST!(post('http://localhost/webhooks/stripe', EVENT, digest(EVENT)));
        expect(response.status).toBe(200);
        expect(handler).toHaveBeenCalledTimes(1);
    });
});
