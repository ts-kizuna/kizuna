import Fastify from 'fastify';
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

        const app = Fastify();
        await api.mount(app);
        await app.ready();

        const response = await app.inject({
            method: 'POST',
            url: '/users',
            payload: {
                email: createdUser.email,
            },
        });
        expect(response.statusCode).toBe(201);

        await expectSignedDelivery(await receiver.delivered, receiver.url);
        await receiver.close();
    });
});
