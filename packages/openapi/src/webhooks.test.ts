import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Kizuna, type Contract } from '@ts-kizuna/core';
import { renderOpenApi } from './generator.js';

const k = new Kizuna();

const InvoiceSchema = Kizuna.model({
    title: 'Invoice',
    schema: z.object({
        id: z.string(),
        amount: z.int(),
    }),
});

const routes = k.routes({
    listUsers: {
        method: 'GET',
        path: '/users',
        responses: {
            200: z.array(z.string()),
        },
    },
});

const webhooks = k.webhooks({
    invoicePaid: {
        summary: 'Sent when an invoice is paid',
        body: InvoiceSchema,
    },
    billing: {
        subscriptionCancelled: {
            body: InvoiceSchema,
        },
    },
});

const contract = k.contract({
    routes,
    webhooks,
    auth: {
        listUsers: false,
    },
}) as unknown as Contract;

const document = () =>
    renderOpenApi(contract, {
        info: {
            title: 'Test API',
            version: '1.0.0',
        },
    })('json');

describe('webhooks in the OpenAPI document', () => {
    it('emits one entry per event, under its dotted key', () => {
        expect(Object.keys(document().webhooks ?? {})).toEqual(['invoicePaid', 'billing.subscriptionCancelled']);
    });

    it('holds the operation under the method the delivery is sent with', () => {
        expect(Object.keys(document().webhooks?.invoicePaid ?? {})).toEqual(['post']);
    });

    it('carries the event summary', () => {
        expect(document().webhooks?.invoicePaid?.post?.summary).toBe('Sent when an invoice is paid');
    });

    it('references the shared model rather than inlining it', () => {
        expect(document().webhooks?.invoicePaid?.post?.requestBody?.content['application/json']?.schema).toEqual({
            $ref: '#/components/schemas/Invoice',
        });
    });

    it('expects the subscriber to answer 200', () => {
        expect(Object.keys(document().webhooks?.invoicePaid?.post?.responses ?? {})).toEqual(['200']);
    });

    it('leaves the paths alone', () => {
        expect(Object.keys(document().paths)).toEqual(['/users']);
    });

    it('omits the field entirely for a contract declaring no events', () => {
        const bare = k.contract({
            routes,
            auth: {
                listUsers: false,
            },
        }) as unknown as Contract;
        expect(
            renderOpenApi(bare, {
                info: {
                    title: 'Test API',
                    version: '1.0.0',
                },
            })('json').webhooks
        ).toBeUndefined();
    });
});
