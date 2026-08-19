import express from 'express';
import request from 'supertest';
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

        const app = express();
        app.use(express.json());
        api.mount(app);

        const response = await request(app).post('/users').send({ email: createdUser.email });
        expect(response.status).toBe(201);

        await expectSignedDelivery(await receiver.delivered, receiver.url);
        await receiver.close();
    });
});
