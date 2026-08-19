import {
    DEFAULT_WEBHOOK_CONCURRENCY,
    DEFAULT_WEBHOOK_SIGNATURE,
    DEFAULT_WEBHOOK_TIMEOUT_MS,
    isCompiledWebhook,
    webhookAt,
    type CompiledWebhook,
    type WebhookAttempt,
    type WebhookErrorHandler,
    type WebhookSender,
    type WebhookSendOptions,
    type Webhooks,
    type WebhooksConfig,
    type WebhookSubscriber,
    type WebhookSubscribers,
} from './webhooks.js';
import { signDelivery } from './webhook-signature.js';
import type { JobTransport } from './job-transport.js';
import { z } from 'zod';

export class WebhookBodyError extends Error {
    readonly webhook: string;
    readonly issues: z.core.$ZodIssue[];

    constructor(webhook: string, issues: z.core.$ZodIssue[]) {
        super(`Body for webhook "${webhook}" failed validation.`);
        this.name = 'WebhookBodyError';
        this.webhook = webhook;
        this.issues = issues;
    }
}

/**
 * The job key a queued webhook delivery travels under. Namespaced so it cannot
 * collide with a job of your own.
 */
export const WEBHOOK_DELIVERY_JOB_KEY = 'kizuna:webhook-delivery';

/**
 * One queued delivery: which event, which endpoint, and the exact body that
 * goes on the wire. The signing secret is looked back up from `subscribers` at
 * delivery time, so it never sits on a queue.
 */
export interface WebhookDeliveryMessage {
    webhook: string;
    url: string;
    body: string;
}

export const WebhookDeliveryMessageSchema = z.object({
    webhook: z.string(),
    url: z.string(),
    body: z.string(),
});

/**
 * A queued delivery kizuna can never run: malformed, naming an unknown event,
 * or addressed to a URL it does not deliver to.
 */
export class WebhookDeliveryMessageError extends Error {
    constructor(detail: string) {
        super(detail);
        this.name = 'WebhookDeliveryMessageError';
    }
}

export interface WebhookSenderOptions {
    subscribers?: WebhookSubscribers;
    config?: WebhooksConfig;
    /**
     * Carries a delivery to whatever posts it. Without one, deliveries are
     * posted from this process.
     */
    transport?: JobTransport;
    onError?: WebhookErrorHandler;
    /**
     * Called once each subscriber is done with, delivered or given up on. Only
     * deliveries posted from this process reach it.
     */
    onDelivery?: (webhook: string, attempt: WebhookAttempt) => void;
    fetch?: typeof globalThis.fetch;
    /**
     * Overrides the contract's `backoffMs`.
     */
    backoffMs?: number;
}

const DEFAULT_BACKOFF_MS = 1000;

const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, ms).unref?.();
    });

class DeliveryFailed extends Error {
    readonly status: number | undefined;

    constructor(url: string, status: number | undefined) {
        super(status === undefined ? `No answer from ${url}.` : `${url} answered ${status}.`);
        this.name = 'DeliveryFailed';
        this.status = status;
    }
}

const assertDeliverableUrl = (webhookKey: string, url: string): void => {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`Webhook "${webhookKey}" cannot be delivered to "${url}": it is not an absolute URL.`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Webhook "${webhookKey}" cannot be delivered to "${url}": only http and https URLs are delivered to.`);
    }
};

const report = (onError: WebhookErrorHandler | undefined, webhookKey: string, error: unknown): void => {
    if (onError) {
        onError(webhookKey, error);
        return;
    }
    console.error(`[ts-kizuna] Webhook "${webhookKey}" could not be delivered:`, error);
};

interface DeliverOnceOptions {
    method: 'POST' | 'PUT';
    subscriber: WebhookSubscriber;
    body: string;
    config?: WebhooksConfig;
    fetch?: typeof globalThis.fetch;
}

/**
 * Sign and post one attempt. Signing happens here, per attempt, so a retried
 * delivery carries a fresh timestamp.
 */
const deliverOnce = async (options: DeliverOnceOptions): Promise<WebhookAttempt> => {
    const headers = await signDelivery({
        scheme: options.config?.signature ?? DEFAULT_WEBHOOK_SIGNATURE,
        secret: options.subscriber.secret,
        body: options.body,
        url: options.subscriber.url,
        method: options.method,
        timestamp: Math.floor(Date.now() / 1000),
        keyId: options.config?.keyId,
    });
    const post = options.fetch ?? globalThis.fetch;
    // A redirect would carry the signed request to a URL the signature does not cover.
    const response = await post(options.subscriber.url, {
        method: options.method,
        headers: {
            'content-type': 'application/json',
            ...headers,
        },
        body: options.body,
        redirect: 'error',
        signal: AbortSignal.timeout(options.config?.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return {
        url: options.subscriber.url,
        status: response.status,
        delivered: response.ok,
        gone: response.status === 410,
    };
};

/**
 * What `runWebhookDelivery` needs to sign and post a queued delivery. The
 * `WEBHOOKS_META` an adapter stamps on the api carries this shape.
 */
export interface WebhookDeliverySource {
    webhooks: Webhooks;
    subscribers?: WebhookSubscribers;
    config?: WebhooksConfig;
    onError?: WebhookErrorHandler;
}

/**
 * Run one queued delivery: sign with the subscriber's current secret and post
 * once. Resolves when delivered, gone, or unsubscribed; rejects to ask the
 * transport for another attempt.
 */
export const runWebhookDelivery = async (
    source: WebhookDeliverySource,
    input: unknown,
    fetchImplementation?: typeof globalThis.fetch
): Promise<void> => {
    const parsed = WebhookDeliveryMessageSchema.safeParse(input);
    if (!parsed.success) {
        throw new WebhookDeliveryMessageError('The queued message is not a webhook delivery.');
    }
    const { webhook: webhookKey, url, body } = parsed.data;
    const webhook = webhookAt(source.webhooks, webhookKey);
    if (!webhook) {
        throw new WebhookDeliveryMessageError(`No webhook named "${webhookKey}" on this contract.`);
    }
    try {
        assertDeliverableUrl(webhookKey, url);
    } catch (error) {
        throw new WebhookDeliveryMessageError(error instanceof Error ? error.message : String(error));
    }
    const subscribers = (await source.subscribers?.({ webhook: webhookKey })) ?? [];
    const subscriber = subscribers.find((candidate) => candidate.url === url);
    // Unsubscribed between queueing and delivery: nothing to deliver, no secret to sign with.
    if (!subscriber) return;
    try {
        const result = await deliverOnce({
            method: webhook.method,
            subscriber,
            body,
            config: source.config,
            fetch: fetchImplementation,
        });
        if (result.delivered || result.gone) return;
        throw new DeliveryFailed(url, result.status);
    } catch (error) {
        report(source.onError, webhookKey, error);
        throw error;
    }
};

/**
 * Pair a contract's webhooks with the endpoints subscribed to them, so an event
 * can be posted out from anywhere.
 *
 * Every handler already receives this as `webhooks`, so reach for it directly
 * only outside a request: in a script, a seed, or a test.
 *
 * @example
 * const webhooks = createWebhookSender(contract, {
 *     subscribers: ({ webhook }) => db.subscriptions.findByEvent(webhook),
 * });
 *
 * await webhooks.invoicePaid.send({
 *     body: invoice,
 * });
 */
export const createWebhookSender = <Webhooks_ extends Webhooks>(
    source:
        | Webhooks_
        | {
              webhooks?: Webhooks_;
              webhooksConfig?: WebhooksConfig;
          },
    options?: WebhookSenderOptions
): WebhookSender<Webhooks_> => {
    const fromContract = !!source && 'webhooks' in source;
    const webhooks = ((fromContract ? (source as { webhooks?: Webhooks_ }).webhooks : source) ?? {}) as Webhooks_;
    const config = options?.config ?? (fromContract ? (source as { webhooksConfig?: WebhooksConfig }).webhooksConfig : undefined);
    const backoffMs = options?.backoffMs ?? config?.backoffMs ?? DEFAULT_BACKOFF_MS;

    const webhookFor = (webhookKey: string): CompiledWebhook => {
        const webhook = webhookAt(webhooks, webhookKey);
        if (!webhook) throw new Error(`No webhook named "${webhookKey}" on this contract.`);
        return webhook;
    };

    const validateBody = (webhook: CompiledWebhook, webhookKey: string, body: unknown): unknown => {
        const parsed = webhook.body.safeParse(body);
        if (!parsed.success) throw new WebhookBodyError(webhookKey, parsed.error.issues);
        return parsed.data;
    };

    const deliver = async (webhookKey: string, webhook: CompiledWebhook, subscriber: WebhookSubscriber, body: string): Promise<void> => {
        const attempts = webhook.definition.retry ?? 1;
        let lastError: unknown;
        for (let number = 1; number <= attempts; number += 1) {
            try {
                const result = await deliverOnce({
                    method: webhook.method,
                    subscriber,
                    body,
                    config,
                    fetch: options?.fetch,
                });
                if (result.delivered || result.gone) {
                    options?.onDelivery?.(webhookKey, result);
                    return;
                }
                lastError = new DeliveryFailed(subscriber.url, result.status);
            } catch (error) {
                lastError = error;
            }
            if (number < attempts) await wait(backoffMs * 2 ** (number - 1));
        }
        options?.onDelivery?.(webhookKey, {
            url: subscriber.url,
            status: lastError instanceof DeliveryFailed ? lastError.status : undefined,
            delivered: false,
            gone: false,
        });
        throw lastError;
    };

    const subscribersFor = async (webhookKey: string, message: WebhookSendOptions | undefined): Promise<readonly WebhookSubscriber[]> => {
        if (message?.to) return Array.isArray(message.to) ? message.to : [message.to as WebhookSubscriber];
        if (!options?.subscribers) {
            throw new Error(
                `Webhook "${webhookKey}" was sent with no \`to\`, and no \`subscribers\` is registered. ` +
                    'Pass one to `server.webhooks` so kizuna knows which endpoints subscribed.'
            );
        }
        return options.subscribers({ webhook: webhookKey });
    };

    const send = async (webhookKey: string, message: (WebhookSendOptions & { body?: unknown }) | undefined): Promise<void> => {
        const webhook = webhookFor(webhookKey);
        const payload = validateBody(webhook, webhookKey, message?.body);
        const subscribers = await subscribersFor(webhookKey, message);
        for (const subscriber of subscribers) assertDeliverableUrl(webhookKey, subscriber.url);
        if (subscribers.length === 0) return;
        const body = JSON.stringify(payload);

        // `to` deliveries carry an inline secret, which must never sit on a queue.
        if (options?.transport && !message?.to) {
            for (const subscriber of subscribers) {
                await options.transport.dispatch({
                    job: WEBHOOK_DELIVERY_JOB_KEY,
                    input: {
                        webhook: webhookKey,
                        url: subscriber.url,
                        body,
                    },
                    retry: webhook.definition.retry,
                });
            }
            return;
        }

        // A subscriber mid-backoff holds its slot until it is done with.
        const pending = [...subscribers];
        const limit = Math.min(Math.max(1, config?.concurrency ?? DEFAULT_WEBHOOK_CONCURRENCY), pending.length);
        const drain = async (): Promise<void> => {
            for (let subscriber = pending.shift(); subscriber; subscriber = pending.shift()) {
                await deliver(webhookKey, webhook, subscriber, body).catch((error: unknown) => report(options?.onError, webhookKey, error));
            }
        };
        for (let index = 0; index < limit; index += 1) void drain();
    };

    const buildTree = (nodes: Webhooks, prefix: string): Record<string, unknown> => {
        const result: Record<string, unknown> = {};
        for (const [name, node] of Object.entries(nodes)) {
            const webhookKey = prefix ? `${prefix}.${name}` : name;
            if (isCompiledWebhook(node)) {
                result[name] = {
                    send: (message?: WebhookSendOptions & { body?: unknown }) => send(webhookKey, message),
                };
            } else if (node && typeof node === 'object') {
                result[name] = buildTree(node as Webhooks, webhookKey);
            }
        }
        return result;
    };

    return buildTree(webhooks, '') as WebhookSender<Webhooks_>;
};
