import type { RouteDefinition, Routes } from './types.js';
import type { Router } from './handler-pipeline.js';
import { formatValidationError } from './handler-pipeline.js';
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
 * Namespaced so it cannot collide with a route key of your own.
 */
export const receiverRouteKey = (receiverKey: string): string => `kizuna:receiver:${receiverKey}`;

/**
 * The endpoints receivers are served on, in the {@link Routes} shape the request
 * pipeline takes. `security` is empty because the verifier is the authentication.
 */
export const receiverRoutes = (meta: ReceiversMeta): Routes => {
    const routes: Record<string, RouteDefinition> = {};
    for (const { receiverKey, receiver } of flattenReceivers(meta.receivers)) {
        routes[receiverRouteKey(receiverKey)] = {
            method: 'POST',
            path: receiver.path,
            summary: receiver.definition.summary ?? `Receive a ${receiverKey} delivery`,
            description: receiver.definition.description,
            security: [],
            rawBody: true,
            responses: receiver.responses,
        } as unknown as RouteDefinition;
    }
    return routes as unknown as Routes;
};

/**
 * What the pipeline hands a receiver route's handler.
 */
interface ReceiverRouteArgs {
    body: Uint8Array;
    headers: Record<string, string>;
    path: string;
    jobs?: unknown;
}

/**
 * Verify one delivery, validate its body, and run the receiver's handler.
 *
 * Nothing parses the body until the verifier has accepted it, because a
 * signature covers the exact bytes that arrived.
 */
const runReceiver = async (
    receiverKey: string,
    receiver: CompiledReceiver,
    meta: ReceiversMeta,
    args: ReceiverRouteArgs
): Promise<{ status: number; body?: unknown }> => {
    const implementation = meta.implementations[receiverKey];
    if (!implementation) {
        return {
            status: 500,
            body: {
                detail: `Receiver "${receiverKey}" has no implementation.`,
            },
        };
    }

    try {
        await implementation.verify({
            raw: args.body,
            text: new TextDecoder().decode(args.body),
            headers: args.headers,
            method: 'POST',
            path: args.path,
            deny: receiverDeny,
        });
    } catch (error) {
        if (error instanceof ReceiverDenied) {
            return {
                status: error.status,
                body: {
                    detail: error.detail,
                },
            };
        }
        // Fail closed: a verifier that throws for any other reason still refuses.
        meta.onError?.(error, receiverKey);
        return {
            status: DEFAULT_DENY_STATUS,
            body: {
                detail: 'Unauthorized',
            },
        };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(new TextDecoder().decode(args.body));
    } catch {
        return {
            status: 422,
            body: {
                detail: 'Body is not valid JSON',
            },
        };
    }

    const validation = receiver.body.safeParse(parsed);
    if (!validation.success) {
        const formatted = formatValidationError({
            stage: 'body',
            issues: validation.error.issues,
        });
        return {
            status: 422,
            body: {
                detail: formatted.detail,
                errors: formatted.issues.map((issue) => ({
                    code: issue.code ?? 'custom',
                    path: issue.path,
                    message: issue.message,
                })),
            },
        };
    }

    try {
        const returned = await implementation.handler({
            body: validation.data,
            headers: args.headers,
            throwError: (response) => {
                throw new ResponseError(response as never);
            },
            ...(args.jobs === undefined
                ? {}
                : {
                      jobs: args.jobs,
                  }),
        } as Parameters<ReceiverImplementation['handler']>[0]);
        if (returned && typeof returned === 'object' && 'status' in returned) {
            return returned as { status: number; body?: unknown };
        }
        return {
            status: 200,
        };
    } catch (error) {
        // `throwError`, which the pipeline renders.
        if (error instanceof ResponseError) throw error;
        meta.onError?.(error, receiverKey);
        return {
            status: 500,
            body: {
                detail: 'Internal Server Error',
            },
        };
    }
};

/**
 * Their handlers, in the {@link Router} shape the request pipeline takes.
 */
export const receiverRouter = <HandlerContext>(meta: ReceiversMeta): Router<Routes, HandlerContext> => {
    const router: Record<string, unknown> = {};
    for (const { receiverKey, receiver } of flattenReceivers(meta.receivers)) {
        router[receiverRouteKey(receiverKey)] = (args: ReceiverRouteArgs) => runReceiver(receiverKey, receiver, meta, args);
    }
    return router as unknown as Router<Routes, HandlerContext>;
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
