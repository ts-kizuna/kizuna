import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Kizuna } from './kizuna.js';
import {
    createWebhookSender,
    runWebhookDelivery,
    WebhookBodyError,
    WebhookDeliveryMessageError,
    WEBHOOK_DELIVERY_JOB_KEY,
} from './webhook-sender.js';
import { createJobTransport, type JobMessage } from './job-transport.js';
import type { WebhookAttempt } from './webhooks.js';
import { verifyDelivery } from './webhook-signature.js';

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
            retry: 3,
            body: InvoiceSchema,
        },
    },
});

const invoice = {
    id: 'in_1',
    amount: 500,
};

const subscriber = {
    url: 'https://example.com/hooks',
    secret: 'whsec_test',
};

/**
 * A sender whose deliveries can be awaited: `settled` resolves once the expected
 * number of subscribers are done with.
 */
const senderFor = (
    responses: Array<Response | Error>,
    options?: {
        expect?: number;
        subscribers?: readonly { url: string; secret: string }[];
        signature?: 'rfc9421' | 'hmac-sha256';
    }
) => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const attempts: WebhookAttempt[] = [];
    const errors: unknown[] = [];
    let remaining = options?.expect ?? 1;
    let resolveSettled: () => void = () => {};
    const settled = new Promise<void>((resolve) => {
        resolveSettled = resolve;
    });
    let resolveFailed: () => void = () => {};
    const failed = new Promise<void>((resolve) => {
        resolveFailed = resolve;
    });

    let index = 0;
    const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({
            url: String(url),
            headers: (init?.headers ?? {}) as Record<string, string>,
            body: init?.body as string,
        });
        const next = responses[Math.min(index, responses.length - 1)];
        index += 1;
        if (next instanceof Error) throw next;
        return next;
    });

    const sender = createWebhookSender(webhooks, {
        subscribers: () => options?.subscribers ?? [subscriber],
        config: options?.signature ? { signature: options.signature } : undefined,
        backoffMs: 0,
        fetch: fetchStub as unknown as typeof globalThis.fetch,
        onError: (_webhook, error) => {
            errors.push(error);
            resolveFailed();
        },
        onDelivery: (_webhook, attempt) => {
            attempts.push(attempt);
            remaining -= 1;
            if (remaining <= 0) resolveSettled();
        },
    });

    return { sender, calls, attempts, errors, settled, failed, fetchStub };
};

const ok = () => new Response(null, { status: 200 });

describe('send', () => {
    it('posts the validated body to every subscriber', async () => {
        const second = {
            url: 'https://other.example/hooks',
            secret: 'whsec_other',
        };
        const { sender, calls, settled } = senderFor([ok()], {
            expect: 2,
            subscribers: [subscriber, second],
        });

        await sender.invoicePaid.send({ body: invoice });
        await settled;

        expect(calls.map(({ url }) => url).sort()).toEqual([second.url, subscriber.url].sort());
        expect(calls.map(({ body }) => body)).toEqual([JSON.stringify(invoice), JSON.stringify(invoice)]);
    });

    it("signs each delivery with that subscriber's own secret", async () => {
        const { sender, calls, settled } = senderFor([ok()]);

        await sender.invoicePaid.send({ body: invoice });
        await settled;

        const call = calls[0];
        expect(
            await verifyDelivery({
                scheme: 'rfc9421',
                secret: subscriber.secret,
                body: call?.body as string,
                url: subscriber.url,
                method: 'POST',
                headers: call?.headers as Record<string, string>,
            })
        ).toBe(true);
    });

    it('signs with the scheme the contract chose', async () => {
        const { sender, calls, settled } = senderFor([ok()], { signature: 'hmac-sha256' });

        await sender.invoicePaid.send({ body: invoice });
        await settled;

        expect(calls[0]?.headers['webhook-signature']).toMatch(/^v1=/);
    });

    it('sends json', async () => {
        const { sender, calls, settled } = senderFor([ok()]);

        await sender.invoicePaid.send({ body: invoice });
        await settled;

        expect(calls[0]?.headers['content-type']).toBe('application/json');
    });

    it('rejects a body that does not fit the event schema', async () => {
        const { sender } = senderFor([ok()]);

        await expect(
            sender.invoicePaid.send({
                body: { id: 'in_1', amount: 'lots' } as any,
            })
        ).rejects.toThrow(WebhookBodyError);
    });

    it('reaches a nested event by its dotted key', async () => {
        const { sender, calls, settled } = senderFor([ok()]);

        await sender.billing.subscriptionCancelled.send({ body: invoice });
        await settled;

        expect(calls).toHaveLength(1);
    });

    it('delivers to `to` without asking subscribers', async () => {
        const subscribers = vi.fn(() => [subscriber]);
        const target = {
            url: 'https://test.example/hooks',
            secret: 'whsec_target',
        };
        let done: () => void = () => {};
        const settled = new Promise<void>((resolve) => {
            done = resolve;
        });
        const calls: string[] = [];
        const sender = createWebhookSender(webhooks, {
            subscribers,
            backoffMs: 0,
            fetch: vi.fn(async (url: string | URL | Request) => {
                calls.push(String(url));
                return ok();
            }) as unknown as typeof globalThis.fetch,
            onDelivery: () => done(),
        });

        await sender.invoicePaid.send({ body: invoice, to: target });
        await settled;

        expect(subscribers).not.toHaveBeenCalled();
        expect(calls).toEqual([target.url]);
    });

    it('says so when nothing can tell it where to deliver', async () => {
        const sender = createWebhookSender(webhooks, {
            fetch: vi.fn() as unknown as typeof globalThis.fetch,
        });

        await expect(sender.invoicePaid.send({ body: invoice })).rejects.toThrow(/no `subscribers` is registered/);
    });

    it('posts nothing when no one is subscribed', async () => {
        const { sender, fetchStub } = senderFor([ok()], { subscribers: [] });

        await sender.invoicePaid.send({ body: invoice });

        expect(fetchStub).not.toHaveBeenCalled();
    });
});

describe('retrying', () => {
    it("tries again up to the event's retry count", async () => {
        const { sender, calls, settled } = senderFor([new Response(null, { status: 500 })]);

        await sender.billing.subscriptionCancelled.send({ body: invoice });
        await settled;

        expect(calls).toHaveLength(3);
    });

    it('tries once for an event declaring no retry', async () => {
        const { sender, calls, settled } = senderFor([new Response(null, { status: 500 })]);

        await sender.invoicePaid.send({ body: invoice });
        await settled;

        expect(calls).toHaveLength(1);
    });

    it('stops as soon as one attempt lands', async () => {
        const { sender, calls, settled } = senderFor([new Response(null, { status: 500 }), ok()]);

        await sender.billing.subscriptionCancelled.send({ body: invoice });
        await settled;

        expect(calls).toHaveLength(2);
    });

    it('stops on 410 Gone and says the endpoint is gone', async () => {
        const { sender, calls, attempts, settled } = senderFor([new Response(null, { status: 410 })]);

        await sender.billing.subscriptionCancelled.send({ body: invoice });
        await settled;

        expect(calls).toHaveLength(1);
        expect(attempts[0]?.gone).toBe(true);
    });

    it('retries a subscriber that never answered', async () => {
        const { sender, calls, settled } = senderFor([new Error('socket hang up')]);

        await sender.billing.subscriptionCancelled.send({ body: invoice });
        await settled;

        expect(calls).toHaveLength(3);
    });

    it('reports the failure once it gives up', async () => {
        const { sender, errors, failed } = senderFor([new Response(null, { status: 500 })]);

        await sender.invoicePaid.send({ body: invoice });
        await failed;

        expect(errors).toHaveLength(1);
        expect(String(errors[0])).toContain('answered 500');
    });
});

describe('riding a transport', () => {
    const queueing = () => {
        const messages: JobMessage[] = [];
        return {
            messages,
            transport: createJobTransport({
                name: 'queueing',
                dispatch: (message) => {
                    messages.push(message);
                },
            }),
        };
    };

    it('queues one delivery per subscriber instead of posting, and never the secret', async () => {
        const queue = queueing();
        const fetchStub = vi.fn();
        const second = {
            url: 'https://other.example/hooks',
            secret: 'whsec_other',
        };
        const sender = createWebhookSender(webhooks, {
            subscribers: () => [subscriber, second],
            transport: queue.transport,
            fetch: fetchStub as unknown as typeof globalThis.fetch,
        });

        await sender.invoicePaid.send({ body: invoice });

        expect(fetchStub).not.toHaveBeenCalled();
        expect(queue.messages).toEqual([
            {
                job: WEBHOOK_DELIVERY_JOB_KEY,
                input: {
                    webhook: 'invoicePaid',
                    url: subscriber.url,
                    body: JSON.stringify(invoice),
                },
                retry: undefined,
            },
            {
                job: WEBHOOK_DELIVERY_JOB_KEY,
                input: {
                    webhook: 'invoicePaid',
                    url: second.url,
                    body: JSON.stringify(invoice),
                },
                retry: undefined,
            },
        ]);
    });

    it("hands the event's retry count to the transport", async () => {
        const queue = queueing();
        const sender = createWebhookSender(webhooks, {
            subscribers: () => [subscriber],
            transport: queue.transport,
            fetch: vi.fn() as unknown as typeof globalThis.fetch,
        });

        await sender.billing.subscriptionCancelled.send({ body: invoice });

        expect(queue.messages[0]?.retry).toBe(3);
    });

    it('posts `to` deliveries from this process, keeping the inline secret off the queue', async () => {
        const queue = queueing();
        let done: () => void = () => {};
        const settled = new Promise<void>((resolve) => {
            done = resolve;
        });
        const fetchStub = vi.fn(async () => ok());
        const sender = createWebhookSender(webhooks, {
            subscribers: () => [subscriber],
            transport: queue.transport,
            fetch: fetchStub as unknown as typeof globalThis.fetch,
            onDelivery: () => done(),
        });

        await sender.invoicePaid.send({
            body: invoice,
            to: {
                url: 'https://test.example/hooks',
                secret: 'whsec_target',
            },
        });
        await settled;

        expect(queue.messages).toHaveLength(0);
        expect(fetchStub).toHaveBeenCalledOnce();
    });
});

describe('runWebhookDelivery', () => {
    const message = (url = subscriber.url) => ({
        webhook: 'invoicePaid',
        url,
        body: JSON.stringify(invoice),
    });

    const recording = (response: () => Response | Error = ok) => {
        const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
        const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
            calls.push({
                url: String(url),
                headers: (init?.headers ?? {}) as Record<string, string>,
                body: init?.body as string,
            });
            const next = response();
            if (next instanceof Error) throw next;
            return next;
        });
        return { calls, fetchStub: fetchStub as unknown as typeof globalThis.fetch };
    };

    it("signs with the subscriber's current secret and posts once", async () => {
        const { calls, fetchStub } = recording();

        await runWebhookDelivery(
            {
                webhooks,
                subscribers: () => [subscriber],
            },
            message(),
            fetchStub
        );

        expect(calls).toHaveLength(1);
        expect(
            await verifyDelivery({
                scheme: 'rfc9421',
                secret: subscriber.secret,
                body: calls[0]?.body as string,
                url: subscriber.url,
                method: 'POST',
                headers: calls[0]?.headers as Record<string, string>,
            })
        ).toBe(true);
    });

    it('resolves on 410 Gone', async () => {
        const { fetchStub } = recording(() => new Response(null, { status: 410 }));

        await expect(
            runWebhookDelivery(
                {
                    webhooks,
                    subscribers: () => [subscriber],
                },
                message(),
                fetchStub
            )
        ).resolves.toBeUndefined();
    });

    it('rejects a failed attempt and reports it, so the transport retries', async () => {
        const { fetchStub } = recording(() => new Response(null, { status: 500 }));
        const errors: unknown[] = [];

        await expect(
            runWebhookDelivery(
                {
                    webhooks,
                    subscribers: () => [subscriber],
                    onError: (_webhook, error) => {
                        errors.push(error);
                    },
                },
                message(),
                fetchStub
            )
        ).rejects.toThrow(/answered 500/);
        expect(errors).toHaveLength(1);
    });

    it('resolves without posting when the URL is no longer subscribed', async () => {
        const { calls, fetchStub } = recording();

        await runWebhookDelivery(
            {
                webhooks,
                subscribers: () => [],
            },
            message(),
            fetchStub
        );

        expect(calls).toHaveLength(0);
    });

    it('rejects a message that is not a delivery, permanently', async () => {
        await expect(
            runWebhookDelivery(
                {
                    webhooks,
                },
                {
                    nonsense: true,
                }
            )
        ).rejects.toThrow(WebhookDeliveryMessageError);
    });

    it('rejects a delivery naming an unknown event, permanently', async () => {
        await expect(
            runWebhookDelivery(
                {
                    webhooks,
                    subscribers: () => [subscriber],
                },
                {
                    ...message(),
                    webhook: 'renamedSinceThisWasQueued',
                }
            )
        ).rejects.toThrow(WebhookDeliveryMessageError);
    });

    it('rejects a URL it does not deliver to, permanently', async () => {
        await expect(
            runWebhookDelivery(
                {
                    webhooks,
                    subscribers: () => [subscriber],
                },
                message('ftp://example.com/hooks')
            )
        ).rejects.toThrow(WebhookDeliveryMessageError);
    });
});

describe('delivery hardening', () => {
    it('never follows a redirect', async () => {
        const inits: RequestInit[] = [];
        let done: () => void = () => {};
        const settled = new Promise<void>((resolve) => {
            done = resolve;
        });
        const sender = createWebhookSender(webhooks, {
            subscribers: () => [subscriber],
            fetch: vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
                inits.push(init ?? {});
                return ok();
            }) as unknown as typeof globalThis.fetch,
            onDelivery: () => done(),
        });

        await sender.invoicePaid.send({ body: invoice });
        await settled;

        expect(inits[0]?.redirect).toBe('error');
    });

    it('refuses a subscriber URL that is not http or https', async () => {
        const sender = createWebhookSender(webhooks, {
            subscribers: () => [
                {
                    url: 'ftp://example.com/hooks',
                    secret: 'whsec_test',
                },
            ],
            fetch: vi.fn() as unknown as typeof globalThis.fetch,
        });

        await expect(sender.invoicePaid.send({ body: invoice })).rejects.toThrow(/only http and https/);
    });

    it('refuses a `to` URL that is not absolute', async () => {
        const sender = createWebhookSender(webhooks, {
            fetch: vi.fn() as unknown as typeof globalThis.fetch,
        });

        await expect(
            sender.invoicePaid.send({
                body: invoice,
                to: {
                    url: '/hooks',
                    secret: 'whsec_test',
                },
            })
        ).rejects.toThrow(/not an absolute URL/);
    });

    it('delivers to at most `concurrency` subscribers at a time', async () => {
        const subscribers = Array.from({ length: 5 }, (_, index) => ({
            url: `https://example.com/hooks/${index}`,
            secret: 'whsec_test',
        }));
        let inFlight = 0;
        let peak = 0;
        let finished = 0;
        let done: () => void = () => {};
        const settled = new Promise<void>((resolve) => {
            done = resolve;
        });
        const fetchStub = vi.fn(async () => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlight -= 1;
            finished += 1;
            if (finished === subscribers.length) done();
            return ok();
        });
        const sender = createWebhookSender(webhooks, {
            subscribers: () => subscribers,
            config: {
                concurrency: 2,
            },
            fetch: fetchStub as unknown as typeof globalThis.fetch,
        });

        await sender.invoicePaid.send({ body: invoice });
        await settled;

        expect(fetchStub).toHaveBeenCalledTimes(5);
        expect(peak).toBeLessThanOrEqual(2);
    });
});

describe('createWebhookSender from a contract', () => {
    it('reads the events and the signature scheme off it', async () => {
        const surface = new Kizuna({
            webhooks: {
                signature: 'hmac-sha256',
            },
        });
        const contract = surface.contract({
            routes: {},
            webhooks: surface.webhooks({
                invoicePaid: {
                    body: InvoiceSchema,
                },
            }),
        });
        const calls: Array<Record<string, string>> = [];
        let done: () => void = () => {};
        const settled = new Promise<void>((resolve) => {
            done = resolve;
        });
        const sender = createWebhookSender(contract, {
            subscribers: () => [subscriber],
            backoffMs: 0,
            fetch: vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
                calls.push((init?.headers ?? {}) as Record<string, string>);
                return ok();
            }) as unknown as typeof globalThis.fetch,
            onDelivery: () => done(),
        });

        await sender.invoicePaid.send({ body: invoice });
        await settled;

        expect(calls[0]?.['webhook-signature']).toMatch(/^v1=/);
    });
});
