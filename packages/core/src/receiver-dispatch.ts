import { getStatusText } from './status-titles.js';
import { ResponseError } from './response-error.js';
import {
    DEFAULT_DENY_STATUS,
    ReceiverDenied,
    flattenReceivers,
    receiverDeny,
    type CompiledReceiver,
    type ReceiverImplementation,
    type Receivers,
} from './receivers.js';

/**
 * What `server.api` stamped on the api.
 */
export interface ReceiversMeta {
    receivers: Receivers;
    implementations: Record<string, ReceiverImplementation>;
    /**
     * Called when a verifier or handler throws something that is not `deny` or
     * `throwError`. The delivery is still refused, so this is how a bug surfaces
     * rather than reading as a rejected vendor.
     */
    onError?: (error: unknown, receiverKey: string) => void;
}

/**
 * One delivery, as each adapter reads it off its own request.
 */
export interface Delivery {
    method: string;
    /**
     * The path as the vendor requested it, including any `basePath`.
     */
    path: string;
    /**
     * Every request header, lowercased.
     */
    headers: Record<string, string>;
    /**
     * The exact bytes that arrived, before anything parsed them.
     */
    body: Uint8Array;
}

/**
 * What the dispatcher answers with.
 */
export interface DeliveryResult {
    status: number;
    body?: unknown;
}

const problem = (status: number, detail: string, extra?: Record<string, unknown>): DeliveryResult => ({
    status,
    body: {
        type: 'about:blank',
        title: getStatusText(status),
        status,
        detail,
        ...extra,
    },
});

/**
 * Verify one delivery, validate its body, and run the receiver's handler.
 *
 * Nothing parses the body until the verifier has accepted it, because a
 * signature covers the exact bytes that arrived.
 */
export const handleReceiverDelivery = async (
    receiverKey: string,
    receiver: CompiledReceiver,
    meta: ReceiversMeta,
    delivery: Delivery,
    jobs?: unknown
): Promise<DeliveryResult> => {
    const implementation = meta.implementations[receiverKey];
    if (!implementation) {
        return problem(500, `Receiver "${receiverKey}" has no implementation.`);
    }

    try {
        await implementation.verify({
            raw: delivery.body,
            text: new TextDecoder().decode(delivery.body),
            headers: delivery.headers,
            method: delivery.method.toUpperCase(),
            path: delivery.path,
            deny: receiverDeny,
        });
    } catch (error) {
        if (error instanceof ReceiverDenied) {
            return problem(error.status, error.detail);
        }
        // Fail closed: a verifier that throws for any other reason still refuses.
        meta.onError?.(error, receiverKey);
        return problem(DEFAULT_DENY_STATUS, 'Unauthorized');
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(new TextDecoder().decode(delivery.body));
    } catch {
        return problem(422, 'Body is not valid JSON');
    }

    const validation = receiver.body.safeParse(parsed);
    if (!validation.success) {
        return problem(422, 'Body does not match the receiver schema', {
            errors: validation.error.issues.map((issue) => ({
                code: issue.code ?? 'custom',
                path: issue.path,
                message: issue.message,
            })),
        });
    }

    try {
        const returned = await implementation.handler({
            body: validation.data,
            headers: delivery.headers,
            throwError: (response) => {
                throw new ResponseError(response as never);
            },
            ...(jobs === undefined
                ? {}
                : {
                      jobs,
                  }),
        } as Parameters<ReceiverImplementation['handler']>[0]);
        if (returned && typeof returned === 'object' && 'status' in returned) {
            return returned as DeliveryResult;
        }
        return {
            status: 200,
        };
    } catch (error) {
        if (error instanceof ResponseError) {
            return {
                status: error.status,
                body: error.body,
            };
        }
        meta.onError?.(error, receiverKey);
        return problem(500, 'Internal Server Error');
    }
};

/**
 * Read one delivery off a web `Request`, which is what every adapter but Express
 * and Fastify already has.
 */
export const deliveryFromRequest = async (request: Request, path: string): Promise<Delivery> => {
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
        headers[name.toLowerCase()] = value;
    });
    return {
        method: request.method,
        path,
        headers,
        body: new Uint8Array(await request.arrayBuffer()),
    };
};

/**
 * Find the receiver serving one path. Used by the adapters that route centrally
 * rather than registering per path.
 */
export const receiverAt = (
    receivers: Receivers,
    method: string,
    path: string
): { receiverKey: string; receiver: CompiledReceiver } | undefined => {
    if (method.toUpperCase() !== 'POST') return undefined;
    return flattenReceivers(receivers).find(({ receiver }) => receiver.path === path);
};

/**
 * Warn when a receiver was declared but never implemented.
 */
export const warnUnimplementedReceivers = (
    receivers: Receivers | undefined,
    implementations: ReceiversMeta['implementations'],
    logger: Pick<Console, 'warn'> = console
): void => {
    if (!receivers) return;
    const missing = flattenReceivers(receivers)
        .filter(({ receiverKey }) => implementations[receiverKey] === undefined)
        .map(({ receiverKey }) => `"${receiverKey}"`);
    if (missing.length === 0) return;
    logger.warn(
        `[ts-kizuna] ${missing.join(', ')} declared as receivers, but no implementation was passed to \`server.api\`. ` +
            'Their deliveries answer 500.'
    );
};
