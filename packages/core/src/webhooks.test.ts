import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Kizuna } from './kizuna.js';
import { flattenWebhooks, isCompiledWebhook, isWebhookDefinition, webhookAt } from './webhooks.js';

const k = new Kizuna();

const InvoiceSchema = z.object({
    id: z.string(),
    amount: z.int(),
});

describe('k.webhooks', () => {
    it('compiles an event, carrying its body schema', () => {
        const webhooks = k.webhooks({
            invoicePaid: {
                body: InvoiceSchema,
            },
        });
        expect(webhooks.invoicePaid.body).toBe(InvoiceSchema);
        expect(isCompiledWebhook(webhooks.invoicePaid)).toBe(true);
    });

    it('defaults the method to POST', () => {
        const webhooks = k.webhooks({
            invoicePaid: {
                body: InvoiceSchema,
            },
        });
        expect(webhooks.invoicePaid.method).toBe('POST');
    });

    it('keeps a declared method', () => {
        const webhooks = k.webhooks({
            invoicePaid: {
                method: 'PUT',
                body: InvoiceSchema,
            },
        });
        expect(webhooks.invoicePaid.method).toBe('PUT');
    });

    it('preserves nesting', () => {
        const webhooks = k.webhooks({
            billing: {
                invoicePaid: {
                    body: InvoiceSchema,
                },
            },
        });
        expect(isCompiledWebhook(webhooks.billing.invoicePaid)).toBe(true);
    });

    it('rejects a retry count that is not a whole number of attempts', () => {
        expect(() =>
            k.webhooks({
                invoicePaid: {
                    retry: 0,
                    body: InvoiceSchema,
                },
            })
        ).toThrow(/at least 1/);
    });

    it('rejects an event name containing a dot, which would break addressing', () => {
        expect(() =>
            k.webhooks({
                'billing.invoicePaid': {
                    body: InvoiceSchema,
                },
            })
        ).toThrow(/nest it instead/);
    });

    it('rejects a group name containing a dot', () => {
        expect(() =>
            k.webhooks({
                'billing.notifications': {
                    invoicePaid: {
                        body: InvoiceSchema,
                    },
                },
            })
        ).toThrow(/nest it instead/);
    });

    it('rejects a node that is neither an event nor a group', () => {
        expect(() =>
            k.webhooks({
                invoicePaid: 'nope' as any,
            })
        ).toThrow(/is not an object/);
    });
});

describe('isWebhookDefinition', () => {
    it('reads a node carrying only event fields as an event', () => {
        expect(
            isWebhookDefinition({
                retry: 3,
                body: InvoiceSchema,
            })
        ).toBe(true);
    });

    it('reads a group named like an event field as a group', () => {
        expect(
            isWebhookDefinition({
                summary: {
                    body: InvoiceSchema,
                },
            })
        ).toBe(false);
    });

    it('reads a node carrying no body as a group', () => {
        expect(
            isWebhookDefinition({
                summary: 'Sent when an invoice is paid',
            })
        ).toBe(false);
    });
});

describe('flattenWebhooks', () => {
    const webhooks = k.webhooks({
        invoicePaid: {
            body: InvoiceSchema,
        },
        billing: {
            subscriptionCancelled: {
                body: InvoiceSchema,
            },
        },
    });

    it('names every event by its dotted key', () => {
        expect(flattenWebhooks(webhooks).map(({ webhookKey }) => webhookKey)).toEqual(['invoicePaid', 'billing.subscriptionCancelled']);
    });

    it('finds a nested event by its dotted key', () => {
        expect(webhookAt(webhooks, 'billing.subscriptionCancelled')).toBe(webhooks.billing.subscriptionCancelled);
    });

    it('finds nothing for a key naming a group', () => {
        expect(webhookAt(webhooks, 'billing')).toBeUndefined();
    });
});

describe('the contract', () => {
    it('carries the events and the settings passed to new Kizuna()', () => {
        const surface = new Kizuna({
            webhooks: {
                signature: 'hmac-sha256',
            },
        });
        const webhooks = surface.webhooks({
            invoicePaid: {
                body: InvoiceSchema,
            },
        });
        const contract = surface.contract({
            routes: {},
            webhooks,
        });
        expect(contract.webhooks).toBe(webhooks);
        expect(contract.webhooksConfig?.signature).toBe('hmac-sha256');
    });
});
