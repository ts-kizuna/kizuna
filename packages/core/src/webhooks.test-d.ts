import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { Kizuna } from './kizuna.js';
import type { WebhookKeys, WebhookSender, WebhookSubscribers } from './webhooks.js';

const InvoiceSchema = z.object({
    id: z.string(),
    amount: z.int(),
});

const k = new Kizuna();

const webhooks = k.webhooks({
    invoicePaid: {
        body: InvoiceSchema,
    },
    billing: {
        subscriptionCancelled: {
            body: z.object({
                subscriptionId: z.string(),
            }),
        },
    },
});

type Sender = WebhookSender<typeof webhooks>;

test('send takes the body the event declared', () => {
    expectTypeOf<Parameters<Sender['invoicePaid']['send']>[0]['body']>().toEqualTypeOf<{
        id: string;
        amount: number;
    }>();
});

test('the sender mirrors the declared nesting', () => {
    expectTypeOf<Parameters<Sender['billing']['subscriptionCancelled']['send']>[0]['body']>().toEqualTypeOf<{
        subscriptionId: string;
    }>();
});

test('send resolves once the delivery is handed off', () => {
    expectTypeOf<ReturnType<Sender['invoicePaid']['send']>>().toEqualTypeOf<Promise<void>>();
});

test('WebhookKeys names every event by its dotted key', () => {
    expectTypeOf<WebhookKeys<typeof webhooks>>().toEqualTypeOf<'invoicePaid' | 'billing.subscriptionCancelled'>();
});

test('subscribers receives one of the contract own event keys', () => {
    const subscribers: WebhookSubscribers<WebhookKeys<typeof webhooks>> = ({ webhook }) => {
        expectTypeOf(webhook).toEqualTypeOf<'invoicePaid' | 'billing.subscriptionCancelled'>();
        return [];
    };
    expectTypeOf(subscribers).toBeFunction();
});

const contract = k.contract({
    routes: {
        health: {
            method: 'GET',
            path: '/health',
            responses: {
                200: z.object({
                    ok: z.boolean(),
                }),
            },
        },
    },
    webhooks,
});

test('the contract carries the events it was given', () => {
    expectTypeOf(contract.webhooks).toEqualTypeOf<typeof webhooks | undefined>();
});
