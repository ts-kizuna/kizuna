import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect } from 'vitest';
import { z } from 'zod';
import { Kizuna } from '../kizuna.js';
import { verifyDelivery } from '../webhook-signature.js';

export const WEBHOOK_SECRET = 'whsec_adapter_test';

export interface ReceivedDelivery {
    headers: Record<string, string | undefined>;
    body: string;
}

/**
 * A real endpoint standing in for a subscriber's, so an adapter's delivery goes
 * over a socket rather than through a stub.
 */
export const startWebhookReceiver = async () => {
    let deliver: (delivery: ReceivedDelivery) => void = () => {};
    const delivered = new Promise<ReceivedDelivery>((resolve) => {
        deliver = resolve;
    });

    const server: Server = createServer((incoming, response) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.on('end', () => {
            response.end();
            deliver({
                headers: incoming.headers as Record<string, string | undefined>,
                body: Buffer.concat(chunks).toString('utf8'),
            });
        });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    return {
        url: `http://127.0.0.1:${port}/hooks`,
        delivered,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
};

const k = new Kizuna();

const UserSchema = z.object({
    id: z.string(),
    email: z.string(),
});

/**
 * The contract every adapter's webhook test mounts: one route whose handler
 * sends one event.
 */
export const webhookContract = k.contract({
    routes: k.routes({
        createUser: {
            method: 'POST',
            path: '/users',
            body: z.object({
                email: z.string(),
            }),
            responses: {
                201: UserSchema,
            },
        },
    }),
    webhooks: k.webhooks({
        userCreated: {
            body: UserSchema,
        },
    }),
    auth: {
        createUser: false,
    },
});

export const createdUser = {
    id: 'u1',
    email: 'a@example.com',
};

export const webhookSubscribers = (url: string) => () => [{ url, secret: WEBHOOK_SECRET }];

/**
 * What every adapter must answer: the event reached the subscriber, carrying the
 * handler's payload, signed with that subscriber's secret.
 */
export const expectSignedDelivery = async (delivery: ReceivedDelivery, url: string): Promise<void> => {
    expect(JSON.parse(delivery.body)).toEqual(createdUser);
    expect(
        await verifyDelivery({
            scheme: 'rfc9421',
            secret: WEBHOOK_SECRET,
            body: delivery.body,
            url,
            method: 'POST',
            headers: delivery.headers,
        })
    ).toBe(true);
};
