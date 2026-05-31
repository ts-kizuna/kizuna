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

/** The route's argument object (e.g. `{ params, body, query }`). */
type RouteArgs<Method extends AnyClientMethod> = Parameters<Method>[0];

/** Union of the route's success (2xx) bodies — passed to `onSuccess`. */
type SuccessData<Method extends AnyClientMethod> = Extract<ResponseUnion<Method>, { status: SuccessStatus }>['body'];

/** A recursive partial — what `inject` may supply for the route's arguments. */
type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

/**
 * The route's arguments with everything `inject` supplies removed — recursively.
 * A field fully provided by `inject` (a leaf) is dropped; a nested object that
 * `inject` only partly fills keeps its remaining fields.
 */
type DeepOmitBy<T, O> = {
    [K in keyof T as K extends keyof O ? (O[K] extends readonly unknown[] ? never : O[K] extends object ? K : never) : K]: K extends keyof O
        ? DeepOmitBy<T[K], O[K]>
        : T[K];
};

/** The action's own argument list — the route's args minus whatever `inject` fills. */
type ActionArgs<Method extends AnyClientMethod, Injected> = [DeepOmitBy<RouteArgs<Method>, Injected>];

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

type OnError = (error: unknown) => string | Promise<string>;

/**
 * Discriminated result: `{ ok: true, status, data }` on a 2xx response,
 * `{ ok: false, status, error }` otherwise, with `error` typed per the route.
 */
export type ServerActionResult<Method extends AnyClientMethod> =
    | SuccessResult<Extract<ResponseUnion<Method>, { status: SuccessStatus }>>
    | FailureResult<Exclude<ResponseUnion<Method>, { status: SuccessStatus }>>;

/** The success hook, shared by every form of {@link createServerAction}. */
interface SuccessOption<Method extends AnyClientMethod> {
    /**
     * Run after a successful (2xx) response — the place for `revalidatePath`,
     * `revalidateTag`, or `redirect`. Receives the success body. Throwing here
     * (as `redirect` does) propagates.
     */
    onSuccess?: (data: SuccessData<Method>) => void | Promise<void>;
}

/**
 * Options for {@link createServerAction}.
 */
export interface ServerActionOptions<Method extends AnyClientMethod = AnyClientMethod> extends SuccessOption<Method> {
    /**
     * Supply server-derived parts of the route's arguments (e.g. an owner id
     * from the session). Typed to a partial of the route's arguments, so you get
     * completion and typos are rejected. The returned fields are deep-merged into
     * the request and **removed from the action's own argument type** — so the
     * caller can't pass them. May be async.
     *
     * ```ts
     * inject: async () => ({
     *     body: {
     *         authorId: await currentUserId(),
     *     },
     * });
     * ```
     */
    inject?: () => DeepPartial<RouteArgs<Method>> | Promise<DeepPartial<RouteArgs<Method>>>;
    /**
     * Catch a thrown error and resolve to `{ ok: false, status: 0, error }`
     * instead of letting it propagate. HTTP errors are unaffected — they
     * already come back typed. Ignored when `raw` is set.
     */
    onError?: OnError;
    /**
     * Return the raw `{ status, body }` response union instead of the collapsed
     * result.
     */
    raw?: boolean;
}

const isSuccess = (status: number): boolean => status >= 200 && status < 300;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const deepMerge = (base: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {
        ...base,
    };
    for (const key of Object.keys(extra)) {
        const current = result[key];
        const incoming = extra[key];
        result[key] = isPlainObject(current) && isPlainObject(incoming) ? deepMerge(current, incoming) : incoming;
    }
    return result;
};

/**
 * Turn a `@ts-kizuna/fetch` client method into a typed React Server Action.
 *
 * The action takes the route's arguments and resolves to a discriminated
 * result: `{ ok: true, status, data }` on a 2xx response, `{ ok: false, status,
 * error }` on any other status — where `error` is the contract's typed error
 * body, including `ValidationError` (with the failing fields) for `400`s.
 * `result.status` narrows `error`; `isValidationError` (re-exported from
 * `@ts-kizuna/next`) is only needed when a route declares its own `400` too.
 *
 * ```ts
 * // app/posts/actions.ts
 * 'use server';
 * import { revalidatePath } from 'next/cache';
 * import { createServerAction } from '@ts-kizuna/next';
 * import { client } from '@/lib/api-client';
 *
 * export const createPost = createServerAction(client.posts.createPost, {
 *     // `authorId` comes from the session and is dropped from the caller's type
 *     inject: async () => ({
 *         body: {
 *             authorId: await currentUserId(),
 *         },
 *     }),
 *     onSuccess: () => {
 *         revalidatePath('/posts');
 *     },
 * });
 *
 * // caller only knows about `title`
 * await createPost({
 *     body: {
 *         title,
 *     },
 * });
 * ```
 *
 * Use `inject` to fill server-derived fields, `onSuccess` to revalidate/redirect,
 * `onError` to turn a thrown error into `{ ok: false, status: 0, error }`, and
 * `raw` for the untouched `{ status, body }` response union.
 */
export function createServerAction<Method extends AnyClientMethod>(
    method: Method,
    options: SuccessOption<Method> & { inject?: undefined; raw: true }
): (...args: Parameters<Method>) => Promise<ResponseUnion<Method>>;
export function createServerAction<Method extends AnyClientMethod>(
    method: Method,
    options: SuccessOption<Method> & { inject?: undefined; raw?: false; onError: OnError }
): (...args: Parameters<Method>) => Promise<ServerActionResult<Method> | ThrownResult>;
export function createServerAction<Method extends AnyClientMethod>(
    method: Method,
    options?: SuccessOption<Method> & { inject?: undefined; raw?: false; onError?: undefined }
): (...args: Parameters<Method>) => Promise<ServerActionResult<Method>>;
export function createServerAction<Method extends AnyClientMethod, Injected extends DeepPartial<RouteArgs<Method>>>(
    method: Method,
    options: SuccessOption<Method> & { inject: () => Injected | Promise<Injected>; raw: true }
): (...args: ActionArgs<Method, Injected>) => Promise<ResponseUnion<Method>>;
export function createServerAction<Method extends AnyClientMethod, Injected extends DeepPartial<RouteArgs<Method>>>(
    method: Method,
    options: SuccessOption<Method> & { inject: () => Injected | Promise<Injected>; raw?: false; onError: OnError }
): (...args: ActionArgs<Method, Injected>) => Promise<ServerActionResult<Method> | ThrownResult>;
export function createServerAction<Method extends AnyClientMethod, Injected extends DeepPartial<RouteArgs<Method>>>(
    method: Method,
    options: SuccessOption<Method> & { inject: () => Injected | Promise<Injected>; raw?: false; onError?: undefined }
): (...args: ActionArgs<Method, Injected>) => Promise<ServerActionResult<Method>>;
export function createServerAction(method: AnyClientMethod, options?: any): (...args: never[]) => Promise<unknown> {
    const {
        inject,
        onSuccess,
        onError,
        raw = false,
    } = (options ?? {}) as {
        inject?: () => unknown | Promise<unknown>;
        onSuccess?: (data: unknown) => void | Promise<void>;
        onError?: OnError;
        raw?: boolean;
    };

    return async (...args: unknown[]): Promise<unknown> => {
        let response: ClientResponse;
        try {
            const injected = inject ? await inject() : undefined;
            const callArgs = isPlainObject(injected) ? [deepMerge(isPlainObject(args[0]) ? args[0] : {}, injected)] : args;
            response = await (method as (...callArgs: never[]) => Promise<ClientResponse>)(...(callArgs as never[]));
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

        if (isSuccess(response.status) && onSuccess) {
            await onSuccess(response.body as never);
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
}
