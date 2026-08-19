import { z } from 'zod';

export const DEFAULT_WEBHOOK_SIGNATURE = 'rfc9421';

export const DEFAULT_WEBHOOK_TIMEOUT_MS = 5000;

/**
 * How far out of date a received delivery may be before it reads as a replay.
 */
export const DEFAULT_WEBHOOK_TOLERANCE_MS = 300_000;

export const DEFAULT_WEBHOOK_CONCURRENCY = 10;

/**
 * `rfc9421` is HTTP Message Signatures. `hmac-sha256` signs the timestamp and
 * the body.
 */
export type WebhookSignatureScheme = 'rfc9421' | 'hmac-sha256';

/**
 * Settings shared by every webhook, passed to `new Kizuna()` under `webhooks`.
 * The events themselves are declared with `k.webhooks`.
 */
export interface WebhooksConfig {
    /**
     * @default 'rfc9421'
     */
    signature?: WebhookSignatureScheme;
    /**
     * How long a subscriber has to answer.
     *
     * @default 5000
     */
    timeoutMs?: number;
    /**
     * How long to wait before the second attempt, doubling from there.
     *
     * @default 1000
     */
    backoffMs?: number;
    /**
     * The `keyid` an `rfc9421` signature carries, so a subscriber rotating
     * secrets can tell which one signed.
     *
     * @default 'kizuna'
     */
    keyId?: string;
    /**
     * How many subscribers one send delivers to at a time.
     *
     * @default 10
     */
    concurrency?: number;
}

/**
 * An event your API posts out, as authored in `k.webhooks`.
 */
export interface WebhookDefinition {
    /**
     * @default 'POST'
     */
    method?: 'POST' | 'PUT';
    summary?: string;
    description?: string;
    /**
     * How many attempts a failed delivery deserves.
     *
     * @default 1
     */
    retry?: number;
    body: z.ZodType;
}

export interface CompiledWebhook<Definition extends WebhookDefinition = WebhookDefinition> {
    definition: Definition;
    method: 'POST' | 'PUT';
    body: z.ZodType;
}

/**
 * A contract's webhooks. Nestable, like routes, so a large codebase can group
 * them: `webhooks.billing.invoicePaid`.
 */
export interface Webhooks {
    [key: string]: CompiledWebhook | Webhooks;
}

/**
 * The shape `k.webhooks` accepts: events, or groups of them, to any depth.
 */
export interface AuthoredWebhooks {
    [key: string]: WebhookDefinition | AuthoredWebhooks;
}

export type CompiledWebhooks<Definitions extends AuthoredWebhooks> = {
    [Name in keyof Definitions]: Definitions[Name] extends WebhookDefinition
        ? CompiledWebhook<Definitions[Name]>
        : Definitions[Name] extends AuthoredWebhooks
          ? CompiledWebhooks<Definitions[Name]>
          : never;
};

/**
 * One endpoint a delivery goes to, and the secret it is signed with.
 */
export interface WebhookSubscriber {
    url: string;
    secret: string;
}

/**
 * The dotted keys of every event in a tree, e.g.
 * `'invoicePaid' | 'billing.subscriptionCancelled'`.
 */
export type WebhookKeys<Webhooks_ extends Webhooks> = {
    [Name in keyof Webhooks_ & string]: Webhooks_[Name] extends CompiledWebhook
        ? Name
        : Webhooks_[Name] extends Webhooks
          ? `${Name}.${WebhookKeys<Webhooks_[Name]>}`
          : never;
}[keyof Webhooks_ & string];

/**
 * Reads the endpoints subscribed to one event. Runs once per `send`.
 */
export type WebhookSubscribers<Keys extends string = string> = (args: {
    webhook: Keys;
}) => Promise<readonly WebhookSubscriber[]> | readonly WebhookSubscriber[];

export interface WebhookSendOptions {
    /**
     * Deliver to these endpoints instead of asking `subscribers`.
     */
    to?: WebhookSubscriber | readonly WebhookSubscriber[];
}

export type WebhookSendArgs<Webhook extends CompiledWebhook> = [
    message: {
        body: z.input<Webhook['definition']['body']>;
    } & WebhookSendOptions,
];

export interface WebhookFn<Webhook extends CompiledWebhook> {
    /**
     * Post the event to every subscriber. Resolves once the delivery is handed
     * off, so a slow subscriber never holds up the request that sent it.
     */
    send: (...args: WebhookSendArgs<Webhook>) => Promise<void>;
}

/**
 * A contract's webhooks, shaped exactly like the declaration.
 *
 * @example
 * await webhooks.invoicePaid.send({
 *     body: invoice,
 * });
 */
export type WebhookSender<Webhooks_ extends Webhooks> = {
    [Name in keyof Webhooks_]: Webhooks_[Name] extends CompiledWebhook
        ? WebhookFn<Webhooks_[Name]>
        : Webhooks_[Name] extends Webhooks
          ? WebhookSender<Webhooks_[Name]>
          : never;
};

export interface WebhookAttempt {
    url: string;
    status: number | undefined;
    delivered: boolean;
    /**
     * The subscriber answered `410 Gone`, so nothing is retried.
     */
    gone: boolean;
}

/**
 * Called when a delivery fails: once, when the in-process loop gives up, or on
 * each failed attempt when deliveries ride a transport. Without one, the
 * failure is logged.
 */
export type WebhookErrorHandler = (webhook: string, error: unknown) => void;

/**
 * The `webhooks` argument every handler receives. Absent when the contract
 * declares no events.
 */
export type WebhooksArg<Webhooks_ extends Webhooks> = string extends keyof Webhooks_
    ? {}
    : {
          webhooks: WebhookSender<Webhooks_>;
      };

export type NoWebhooks = Record<string, never>;

const WEBHOOK_FIELDS = ['method', 'summary', 'description', 'retry', 'body'] as const;

/**
 * Types are checked as well as names, so a group named `summary` still reads as
 * a group.
 */
const isWebhookField = (name: string, value: unknown): boolean => {
    switch (name) {
        case 'method':
            return value === 'POST' || value === 'PUT';
        case 'summary':
        case 'description':
            return typeof value === 'string';
        case 'retry':
            return typeof value === 'number';
        case 'body':
            return value instanceof z.ZodType;
        default:
            return false;
    }
};

/**
 * An event is the node carrying a `body`. Everything else in the tree is a group.
 */
export const isWebhookDefinition = (value: unknown): value is WebhookDefinition => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const candidate = value as { body?: unknown };
    if (!(candidate.body instanceof z.ZodType)) return false;
    return Object.entries(value).every(([name, field]) => isWebhookField(name, field));
};

export const isCompiledWebhook = (value: unknown): value is CompiledWebhook => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return !!candidate.definition && typeof candidate.method === 'string';
};

const assertValidWebhook = (name: string, definition: WebhookDefinition): void => {
    if (definition.retry !== undefined && (!Number.isInteger(definition.retry) || definition.retry < 1)) {
        throw new Error(
            `Webhook "${name}" has \`retry: ${String(definition.retry)}\`, which must be a whole number of attempts, at least 1.`
        );
    }
};

/**
 * Compile authored definitions into {@link Webhooks}, preserving nesting. Backs
 * `k.webhooks`.
 */
export const buildWebhooks = (definitions: AuthoredWebhooks): Webhooks => {
    const walk = (nodes: AuthoredWebhooks, prefix: string): Webhooks => {
        const webhooks: Webhooks = {};
        for (const [name, node] of Object.entries(nodes)) {
            const webhookKey = prefix ? `${prefix}.${name}` : name;
            if (name.includes('.')) {
                throw new Error(`Webhook "${webhookKey}" has a dot in its name. Dots separate groups, so nest it instead.`);
            }
            if (isWebhookDefinition(node)) {
                assertValidWebhook(webhookKey, node);
                webhooks[name] = {
                    definition: node,
                    method: node.method ?? 'POST',
                    body: node.body,
                } as unknown as CompiledWebhook;
                continue;
            }
            if (!node || typeof node !== 'object' || Array.isArray(node)) {
                throw new Error(
                    `Webhook "${webhookKey}" is not an object. An event declares ${WEBHOOK_FIELDS.join(', ')}; a group declares more events.`
                );
            }
            webhooks[name] = walk(node as AuthoredWebhooks, webhookKey);
        }
        return webhooks;
    };

    return walk(definitions, '');
};

export interface FlattenedWebhook {
    /**
     * Dotted path to the event, e.g. `billing.invoicePaid`. It is how every other
     * part of the system names a webhook.
     */
    webhookKey: string;
    webhook: CompiledWebhook;
}

export const flattenWebhooks = (webhooks: Webhooks, prefix = ''): FlattenedWebhook[] => {
    const collected: FlattenedWebhook[] = [];
    for (const [name, node] of Object.entries(webhooks)) {
        const webhookKey = prefix ? `${prefix}.${name}` : name;
        if (isCompiledWebhook(node)) {
            collected.push({ webhookKey, webhook: node });
        } else if (node && typeof node === 'object') {
            collected.push(...flattenWebhooks(node as Webhooks, webhookKey));
        }
    }
    return collected;
};

export const webhookAt = (webhooks: Webhooks, webhookKey: string): CompiledWebhook | undefined => {
    let current: Webhooks | CompiledWebhook | undefined = webhooks;
    for (const segment of webhookKey.split('.')) {
        if (!current || typeof current !== 'object' || isCompiledWebhook(current)) return undefined;
        current = (current as Webhooks)[segment];
    }
    return isCompiledWebhook(current) ? current : undefined;
};
