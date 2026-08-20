import { z } from 'zod';
import { ProblemDetailsSchema } from './error-response.js';
import type { ResponseDefinition, RouteDefinition } from './types.js';
import type { HandlerReturn } from './handler-pipeline.js';
import type { Jobs, JobsArg } from './jobs.js';

/**
 * What `deny` answers with when given no status.
 */
export const DEFAULT_DENY_STATUS = 401;

/**
 * An incoming webhook, as authored in `k.receiver`.
 */
export interface ReceiverDefinition {
    /**
     * The URL the vendor posts to.
     */
    path: `/${string}`;
    /**
     * Validated after the verifier accepts the delivery.
     */
    body: z.ZodType;
    summary?: string;
    description?: string;
    /**
     * Extra responses beyond the synthesized `200`, `401`, `422`, `500`, `503`.
     */
    responses?: {
        [status: number]: ResponseDefinition;
    };
}

/**
 * A receiver's synthesized responses. These are the retry contract: `503` asks
 * the vendor to come back, `422` tells it not to.
 */
export type ReceiverResponses = {
    200: z.ZodVoid;
    401: typeof ProblemDetailsSchema;
    422: typeof ProblemDetailsSchema;
    500: typeof ProblemDetailsSchema;
    503: typeof ProblemDetailsSchema;
};

/**
 * A receiver after `k.receiver` compiles it: the route it is served on, plus the
 * schema its delivery is validated against once the verifier accepts it.
 *
 * `delivery` is not the route's `body`, because the pipeline would then validate
 * it against bytes the verifier has not seen yet.
 */
export type CompiledReceiver<Definition extends ReceiverDefinition = ReceiverDefinition> = RouteDefinition & {
    method: 'POST';
    rawBody: true;
    responses: ReceiverResponses;
    delivery: Definition['body'];
};

/**
 * A contract's receivers, keyed by vendor.
 */
export interface Receivers {
    [key: string]: CompiledReceiver;
}

/**
 * A receiver map with no receivers in it, for a contract that declares none.
 */
export type NoReceivers = Record<string, never>;

/**
 * Thrown by `deny`, and answered with by the dispatcher.
 */
export class ReceiverDenied extends Error {
    readonly status: number;
    readonly detail: string;

    constructor(status: number, detail: string) {
        super(detail);
        this.name = 'ReceiverDenied';
        this.status = status;
        this.detail = detail;
    }
}

/**
 * Refuses the delivery, so the handler never runs.
 *
 * This function throws internally and never returns, which is what keeps a
 * forgotten `return` from letting a forged delivery through.
 */
export type ReceiverDeny = (status?: number, detail?: string) => never;

export const receiverDeny: ReceiverDeny = (status = DEFAULT_DENY_STATUS, detail = 'Unauthorized') => {
    throw new ReceiverDenied(status, detail);
};

/**
 * What a verifier receives.
 */
export interface ReceiverVerifyArgs {
    /**
     * The exact bytes that arrived, before anything parsed them.
     */
    raw: Uint8Array;
    /**
     * Those bytes as a string, which is what most vendor libraries take.
     */
    text: string;
    /**
     * Every request header, lowercased.
     */
    headers: Record<string, string>;
    /**
     * The request method, uppercased.
     */
    method: string;
    deny: ReceiverDeny;
}

/**
 * Decides whether a delivery is real. Return nothing to accept it, and throw to
 * turn it away.
 */
export type ReceiverVerify = (args: ReceiverVerifyArgs) => void | Promise<void>;

export type ReceiverHandlerReturn = HandlerReturn<{
    responses: ReceiverResponses;
}>;

/**
 * The single object a receiver handler receives.
 */
export interface ReceiverHandlerArgs<Receiver extends CompiledReceiver> {
    /**
     * The validated body.
     */
    body: z.output<Receiver['delivery']>;
    /**
     * Every request header, lowercased, which is where a delivery id lives.
     */
    headers: Record<string, string>;
    /**
     * Throws a typed response. Takes the same `{ status, body }` shape as a
     * handler return.
     *
     * This function throws internally and never returns.
     */
    throwError: (response: ReceiverHandlerReturn) => never;
}

/**
 * A receiver's handler. Returning answers `200`.
 */
export type ReceiverHandler<Receiver extends CompiledReceiver = CompiledReceiver, Jobs_ extends Jobs = Jobs> = (
    args: ReceiverHandlerArgs<Receiver> & JobsArg<Jobs_>
) => Promise<ReceiverHandlerReturn | void> | ReceiverHandlerReturn | void;

/**
 * What `server.receiver` takes.
 */
export interface ReceiverImplementation<Receiver extends CompiledReceiver = CompiledReceiver, Jobs_ extends Jobs = Jobs> {
    verify: ReceiverVerify;
    handler: ReceiverHandler<Receiver, Jobs_>;
}

/**
 * The implementations `server.api` takes, one per declared receiver.
 */
export type ReceiverImplementations<Receivers_ extends Receivers, Jobs_ extends Jobs = Jobs> = {
    [Name in keyof Receivers_]: ReceiverImplementation<Receivers_[Name], Jobs_>;
};

const buildResponses = (definition: ReceiverDefinition): Record<number, ResponseDefinition> => ({
    200: z.void(),
    401: ProblemDetailsSchema,
    422: ProblemDetailsSchema,
    500: ProblemDetailsSchema,
    503: ProblemDetailsSchema,
    ...definition.responses,
});

const assertValidReceiver = (definition: ReceiverDefinition): void => {
    if (typeof definition.path !== 'string' || !definition.path.startsWith('/')) {
        throw new Error(`A receiver needs a \`path\` starting with '/', which is the URL you give the vendor.`);
    }
    if (definition.path.includes(':') || definition.path.includes('{')) {
        throw new Error(
            `Receiver path '${definition.path}' declares a parameter. A vendor posts to one fixed URL, so a receiver's path takes none.`
        );
    }
    if (!(definition.body instanceof z.ZodType)) {
        throw new Error(`Receiver '${definition.path}' needs a \`body\` schema every delivery is validated against.`);
    }
};

/**
 * Compile one authored receiver. Called by `k.receiver`.
 */
export const buildReceiver = <const Definition extends ReceiverDefinition>(definition: Definition): CompiledReceiver<Definition> => {
    assertValidReceiver(definition);
    return {
        method: 'POST',
        path: definition.path,
        summary: definition.summary,
        description: definition.description,
        security: [],
        rawBody: true,
        delivery: definition.body,
        responses: buildResponses(definition),
    } as unknown as CompiledReceiver<Definition>;
};

/**
 * Whether a value is a compiled receiver.
 */
export const isCompiledReceiver = (value: unknown): value is CompiledReceiver =>
    !!value && typeof value === 'object' && 'path' in value && 'delivery' in value && 'responses' in value;

/**
 * Every receiver, keyed by name.
 */
export const flattenReceivers = (receivers: Receivers): { receiverKey: string; receiver: CompiledReceiver }[] =>
    Object.entries(receivers).map(([receiverKey, receiver]) => ({
        receiverKey,
        receiver,
    }));

/**
 * Throw when two receivers claim one path, or when a receiver claims a path a
 * route already serves. Receivers and routes share one path space.
 */
export const assertNoReceiverCollision = (receivers: Receivers, routePaths: Map<string, string>): void => {
    const claimed = new Map<string, string>();
    for (const { receiverKey, receiver } of flattenReceivers(receivers)) {
        const byReceiver = claimed.get(receiver.path);
        if (byReceiver !== undefined) {
            throw new Error(
                `Receivers "${byReceiver}" and "${receiverKey}" both declare path '${receiver.path}'. One path serves one receiver.`
            );
        }
        claimed.set(receiver.path, receiverKey);

        const routeKey = routePaths.get(`POST:${receiver.path}`);
        if (routeKey !== undefined) {
            throw new Error(
                `Receiver "${receiverKey}" serves POST ${receiver.path}, which route "${routeKey}" already serves. ` +
                    `Receivers and routes share one path space, so give the receiver a path of its own.`
            );
        }
    }
};
