import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Kizuna } from './kizuna.js';
import { handleReceiverDelivery, receiverAt, warnUnimplementedReceivers, type ReceiversMeta } from './receiver-dispatch.js';

const k = new Kizuna();

const EventSchema = z.object({
    id: z.string(),
    type: z.string(),
});

const stripe = k.receiver({
    path: '/webhooks/stripe',
    body: EventSchema,
});

const receivers = {
    stripe,
};

const delivery = (body: string) => ({
    method: 'POST',
    path: '/webhooks/stripe',
    headers: {
        'x-delivery': 'del_1',
    },
    body: new TextEncoder().encode(body),
});

const metaWith = (
    implementation: Partial<ReceiversMeta['implementations'][string]>,
    onError?: ReceiversMeta['onError']
): ReceiversMeta => ({
    receivers,
    implementations: {
        stripe: {
            verify: implementation.verify ?? (() => undefined),
            handler: implementation.handler ?? vi.fn(),
        },
    },
    onError,
});

const deliver = (meta: ReceiversMeta, body = '{"id":"evt_1","type":"invoice.paid"}', jobs?: unknown) =>
    handleReceiverDelivery('stripe', stripe, meta, delivery(body), jobs);

describe('k.receiver', () => {
    it('compiles a receiver with its path and body', () => {
        expect(stripe.path).toBe('/webhooks/stripe');
        expect(stripe.body).toBe(EventSchema);
    });

    it('rejects a path that does not start with a slash', () => {
        expect(() =>
            k.receiver({
                path: 'webhooks/acme' as `/${string}`,
                body: EventSchema,
            })
        ).toThrow(/needs a `path` starting with/);
    });

    it('rejects a path with a parameter, because a vendor posts to one fixed URL', () => {
        expect(() =>
            k.receiver({
                path: '/webhooks/:vendor',
                body: EventSchema,
            })
        ).toThrow(/declares a parameter/);
    });

    it('rejects a receiver with no body schema', () => {
        expect(() =>
            k.receiver({
                path: '/webhooks/acme',
                body: undefined as unknown as z.ZodType,
            })
        ).toThrow(/needs a `body` schema/);
    });

    it('throws when two receivers claim one path', () => {
        expect(() =>
            k.contract({
                routes: {},
                receivers: {
                    live: stripe,
                    test: k.receiver({
                        path: '/webhooks/stripe',
                        body: EventSchema,
                    }),
                },
            })
        ).toThrow(/both declare path/);
    });

    it('throws when a receiver claims a path a route already serves', () => {
        const hooks = k.routes({
            inbound: {
                method: 'POST',
                path: '/webhooks/stripe',
                responses: {
                    200: z.void(),
                },
            },
        });
        expect(() =>
            k.contract({
                routes: {
                    hooks,
                },
                receivers,
            })
        ).toThrow(/which route "hooks.inbound" already serves/);
    });

    it('leaves a route on another path alone', () => {
        const contract = k.contract({
            routes: {
                events: k.routes({
                    list: {
                        method: 'GET',
                        path: '/events',
                        responses: {
                            200: z.void(),
                        },
                    },
                }),
            },
            receivers,
        });
        expect(contract.receivers?.stripe.path).toBe('/webhooks/stripe');
    });

    it('keeps receivers out of contract.routes, so the client and generators never see them', () => {
        const contract = k.contract({
            routes: {},
            receivers,
        });
        expect(Object.keys(contract.routes)).toEqual([]);
        expect(Object.keys(contract.receivers ?? {})).toEqual(['stripe']);
    });
});

describe('handleReceiverDelivery', () => {
    it('runs the handler on an accepted delivery and answers 200', async () => {
        const handler = vi.fn();
        const result = await deliver(
            metaWith({
                handler,
            })
        );
        expect(result).toEqual({
            status: 200,
        });
        expect(handler.mock.calls[0]![0]).toMatchObject({
            body: {
                id: 'evt_1',
                type: 'invoice.paid',
            },
        });
    });

    it('hands the verifier the bytes, the text, and the request line', async () => {
        const verify = vi.fn();
        await deliver(
            metaWith({
                verify,
            })
        );
        expect(verify.mock.calls[0]![0]).toMatchObject({
            text: '{"id":"evt_1","type":"invoice.paid"}',
            method: 'POST',
            path: '/webhooks/stripe',
        });
        expect((verify.mock.calls[0]![0] as { raw: Uint8Array }).raw).toBeInstanceOf(Uint8Array);
    });

    it('never runs the handler when the verifier denies', async () => {
        const handler = vi.fn();
        const result = await deliver(
            metaWith({
                verify: ({ deny }) => deny(),
                handler,
            })
        );
        expect(result.status).toBe(401);
        expect(handler).not.toHaveBeenCalled();
    });

    it('answers the status deny was given', async () => {
        const result = await deliver(
            metaWith({
                verify: ({ deny }) => deny(200, 'Ignored'),
            })
        );
        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({
            detail: 'Ignored',
        });
    });

    it('denies when a verifier throws for any other reason, and reports it', async () => {
        const onError = vi.fn();
        const handler = vi.fn();
        const result = await deliver(
            metaWith(
                {
                    verify: () => {
                        throw new Error('missing env var');
                    },
                    handler,
                },
                onError
            )
        );
        expect(result.status).toBe(401);
        expect(handler).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(expect.any(Error), 'stripe');
    });

    it('awaits an async verifier', async () => {
        const handler = vi.fn();
        const result = await deliver(
            metaWith({
                verify: async ({ deny }) => {
                    await Promise.resolve();
                    deny();
                },
                handler,
            })
        );
        expect(result.status).toBe(401);
        expect(handler).not.toHaveBeenCalled();
    });

    it('verifies before parsing, so an unverified body is never read', async () => {
        const verify = vi.fn(({ deny }: { deny: () => never }) => deny());
        const result = await deliver(
            metaWith({
                verify,
            }),
            'not json'
        );
        expect(result.status).toBe(401);
        expect(verify).toHaveBeenCalledTimes(1);
    });

    it('answers 422 for a body that is not JSON', async () => {
        const result = await deliver(metaWith({}), 'not json');
        expect(result.status).toBe(422);
        expect(result.body).toMatchObject({
            detail: 'Body is not valid JSON',
        });
    });

    it('answers 422 for a body that does not fit the schema', async () => {
        const handler = vi.fn();
        const result = await deliver(
            metaWith({
                handler,
            }),
            '{"id":"evt_1"}'
        );
        expect(result.status).toBe(422);
        expect(handler).not.toHaveBeenCalled();
    });

    it('carries a throwError response back to the vendor', async () => {
        const result = await deliver(
            metaWith({
                handler: ({ throwError }) =>
                    throwError({
                        status: 503,
                        body: {
                            detail: 'Not yet',
                        },
                    }),
            })
        );
        expect(result).toEqual({
            status: 503,
            body: {
                detail: 'Not yet',
            },
        });
    });

    it('answers 500 when a handler throws something else, so the vendor retries', async () => {
        const onError = vi.fn();
        const result = await deliver(
            metaWith(
                {
                    handler: () => {
                        throw new Error('database down');
                    },
                },
                onError
            )
        );
        expect(result.status).toBe(500);
        expect(onError).toHaveBeenCalledWith(expect.any(Error), 'stripe');
    });

    it('hands the handler every header, which is where a delivery id lives', async () => {
        const handler = vi.fn();
        await deliver(
            metaWith({
                handler,
            })
        );
        expect((handler.mock.calls[0]![0] as { headers: Record<string, string> }).headers['x-delivery']).toBe('del_1');
    });

    it('passes the job runner through when the contract declares jobs', async () => {
        const handler = vi.fn();
        const jobs = {
            reconcileInvoice: {
                queue: vi.fn(),
            },
        };
        await deliver(
            metaWith({
                handler,
            }),
            '{"id":"evt_1","type":"invoice.paid"}',
            jobs
        );
        expect((handler.mock.calls[0]![0] as { jobs: unknown }).jobs).toBe(jobs);
    });

    it('answers 500 when a declared receiver has no implementation', async () => {
        const result = await handleReceiverDelivery(
            'stripe',
            stripe,
            {
                receivers,
                implementations: {},
            },
            delivery('{"id":"evt_1","type":"invoice.paid"}')
        );
        expect(result.status).toBe(500);
    });
});

describe('receiverAt', () => {
    it('finds the receiver serving a path', () => {
        expect(receiverAt(receivers, 'POST', '/webhooks/stripe')?.receiverKey).toBe('stripe');
    });

    it('ignores another path', () => {
        expect(receiverAt(receivers, 'POST', '/webhooks/other')).toBeUndefined();
    });

    it('ignores another method, because a receiver only ever answers POST', () => {
        expect(receiverAt(receivers, 'GET', '/webhooks/stripe')).toBeUndefined();
    });
});

describe('warnUnimplementedReceivers', () => {
    it('warns about a receiver with no implementation', () => {
        const logger = {
            warn: vi.fn(),
        };
        warnUnimplementedReceivers(receivers, {}, logger);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('"stripe"'));
    });

    it('says nothing when every receiver has one', () => {
        const logger = {
            warn: vi.fn(),
        };
        warnUnimplementedReceivers(
            receivers,
            {
                stripe: {
                    verify: () => undefined,
                    handler: vi.fn(),
                },
            },
            logger
        );
        expect(logger.warn).not.toHaveBeenCalled();
    });
});
