import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import {
    createdUser,
    expectSignedDelivery,
    startWebhookReceiver,
    webhookContract,
    webhookSubscribers,
} from '../../core/src/adapter-testing/webhooks.js';
import { KizunaServer } from './server.js';

describe('sending a webhook from a mounted handler', () => {
    it('reaches the subscriber, signed, without holding up the response', async () => {
        const receiver = await startWebhookReceiver();
        const server = new KizunaServer(webhookContract);

        const api = server.api({
            router: server.router({
                createUser: async ({ webhooks }) => {
                    await webhooks.userCreated.send({ body: createdUser });
                    return {
                        status: 201,
                        body: createdUser,
                    };
                },
            }),
            webhooks: server.webhooks({
                subscribers: webhookSubscribers(receiver.url),
            }),
        });

        const { POST } = api.mount({
            basePath: '/api',
        });

        const response = await POST(
            new NextRequest('http://localhost:3000/api/users', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: JSON.stringify({
                    email: createdUser.email,
                }),
            })
        );
        expect(response.status).toBe(201);

        await expectSignedDelivery(await receiver.delivered, receiver.url);
        await receiver.close();
    });
});
