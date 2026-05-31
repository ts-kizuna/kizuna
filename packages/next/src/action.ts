import { revalidatePath, revalidateTag } from 'next/cache';

/**
 * The shape every `@ts-kizuna/fetch` client method resolves to.
 */
interface ClientResponse {
    status: number;
    body: unknown;
    headers?: unknown;
}

/**
 * Any client method produced by `createClient` — a closure that takes the
 * route's typed arguments and resolves to a `{ status, body }` response.
 */
type AnyClientMethod = (...args: never[]) => Promise<ClientResponse>;

/**
 * The 2xx status codes treated as success. Anything outside this set
 * (≥ 400 at runtime) becomes the failure branch.
 */
type SuccessStatus = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226;

type ResponseUnion<Method extends AnyClientMethod> = Awaited<ReturnType<Method>>;

/**
 * Reshapes each 2xx response member into a success result, preserving its
 * status so `200` and `201` stay distinguishable.
 */
type SuccessResult<Response> = Response extends { status: infer Status; body: infer Body }
    ? { ok: true; status: Status; data: Body }
    : never;

/**
 * Reshapes each non-2xx response member into a failure result. The union stays
 * discriminated by `status`, so narrowing on `result.status` narrows `error` to
 * that route's specific error body (a custom schema or `ValidationError`).
 */
type FailureResult<Response> = Response extends { status: infer Status; body: infer Body }
    ? { ok: false; status: Status; error: Body }
    : never;

/**
 * The result of a thrown error caught by `onError`. `status` is `0` because the
 * request never produced an HTTP response.
 */
type ThrownResult = { ok: false; status: 0; error: string };

/**
 * What to revalidate after a successful action. `paths` are passed to
 * `revalidatePath`; `tags` to `revalidateTag` (with the `'max'`
 * stale-while-revalidate profile).
 */
interface Revalidate {
    paths?: string[];
    tags?: string[];
}

/**
 * Maps a thrown error (e.g. the API is unreachable) to a message.
 */
type OnError = (error: unknown) => string | Promise<string>;

/**
 * Discriminated result: `{ ok: true, status, data }` on a 2xx response,
 * `{ ok: false, status, error }` otherwise, with `error` typed per the route.
 */
export type ServerActionResult<Method extends AnyClientMethod> =
    | SuccessResult<Extract<ResponseUnion<Method>, { status: SuccessStatus }>>
    | FailureResult<Exclude<ResponseUnion<Method>, { status: SuccessStatus }>>;

/**
 * Options for {@link createServerAction}.
 */
export interface ServerActionOptions {
    /**
     * Paths and/or tags to revalidate after the action succeeds.
     */
    revalidate?: Revalidate;
    /**
     * Catch a thrown error and resolve to `{ ok: false, status: 0, error }`
     * instead of letting it propagate. HTTP errors are unaffected — they
     * already come back typed. Ignored when `raw` is set.
     */
    onError?: OnError;
}

type CollapsedAction<Method extends AnyClientMethod> = (...args: Parameters<Method>) => Promise<ServerActionResult<Method>>;

/**
 * Collapsed action whose result also includes the `onError` (thrown) case.
 */
type SafeAction<Method extends AnyClientMethod> = (...args: Parameters<Method>) => Promise<ServerActionResult<Method> | ThrownResult>;

/**
 * A server action that returns the raw `{ status, body }` response union,
 * identical to calling the client method directly.
 */
type RawAction<Method extends AnyClientMethod> = (...args: Parameters<Method>) => Promise<ResponseUnion<Method>>;

const isSuccess = (status: number): boolean => status >= 200 && status < 300;

const runRevalidate = (revalidate: Revalidate | undefined): void => {
    if (!revalidate) {
        return;
    }
    for (const path of revalidate.paths ?? []) {
        revalidatePath(path);
    }
    for (const tag of revalidate.tags ?? []) {
        revalidateTag(tag, 'max');
    }
};

/**
 * Turn a `@ts-kizuna/fetch` client method into a typed React Server Action.
 *
 * A 2xx response resolves to `{ ok: true, status, data }`; any other status to
 * `{ ok: false, status, error }`, where `error` is the contract's typed error
 * body for that status — a custom schema, or `ValidationError` with the failing
 * fields for `400`s. Paths and tags are revalidated on success.
 *
 * ```ts
 * // app/users/actions.ts
 * 'use server';
 * import { createServerAction } from '@ts-kizuna/next';
 * import { client } from '@/lib/api-client';
 *
 * export const createUser = createServerAction(client.createUser, {
 *     revalidate: {
 *         paths: ['/users'],
 *     },
 * });
 * ```
 *
 * ```ts
 * const result = await createUser({ body: { name: 'Ada' } });
 * if (result.ok) {
 *     result.data; // typed from the success body
 * } else if (result.status === 400) {
 *     result.error.errors; // field-level Zod issues
 * }
 * ```
 *
 * `result.status` narrows `error`. `isValidationError` (re-exported from
 * `@ts-kizuna/next`) is only needed when a route declares its own `400` too.
 *
 * By default a thrown error (e.g. the API is unreachable) propagates. Pass
 * `onError` to catch it as `{ ok: false, status: 0, error }`, or `{ raw: true }`
 * for the untouched `{ status, body }` response union.
 */
export function createServerAction<Method extends AnyClientMethod>(
    method: Method,
    options: ServerActionOptions & { raw: true }
): RawAction<Method>;
export function createServerAction<Method extends AnyClientMethod>(
    method: Method,
    options: ServerActionOptions & { raw?: false; onError: OnError }
): SafeAction<Method>;
export function createServerAction<Method extends AnyClientMethod>(
    method: Method,
    options?: ServerActionOptions & { raw?: false }
): CollapsedAction<Method>;
export function createServerAction<Method extends AnyClientMethod>(
    method: Method,
    options: ServerActionOptions & { raw?: boolean } = {}
): RawAction<Method> | CollapsedAction<Method> | SafeAction<Method> {
    const { revalidate, raw = false, onError } = options;

    const action = async (...args: Parameters<Method>): Promise<unknown> => {
        let response: ClientResponse;
        try {
            response = await (method as (...callArgs: Parameters<Method>) => Promise<ClientResponse>)(...args);
        } catch (error) {
            if (raw || !onError) {
                throw error;
            }
            return {
                ok: false,
                status: 0,
                error: await onError(error),
            };
        }

        if (isSuccess(response.status)) {
            runRevalidate(revalidate);
        }

        if (raw) {
            return response;
        }

        if (isSuccess(response.status)) {
            return {
                ok: true,
                status: response.status,
                data: response.body,
            };
        }

        return {
            ok: false,
            status: response.status,
            error: response.body,
        };
    };

    return action as RawAction<Method> | CollapsedAction<Method> | SafeAction<Method>;
}
