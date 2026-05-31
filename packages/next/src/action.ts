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

/** Union of the route's success (2xx) bodies — passed to `onSuccess`. */
type SuccessData<Method extends AnyClientMethod> = Extract<ResponseUnion<Method>, { status: SuccessStatus }>['body'];

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

/**
 * Options common to every form of {@link createServerAction}.
 */
interface BaseOptions<Method extends AnyClientMethod> {
    /**
     * Run after a successful (2xx) response — the place for `revalidatePath`,
     * `revalidateTag`, or `redirect`. Receives the success body. Throwing here
     * (as `redirect` does) propagates.
     *
     * ```ts
     * onSuccess: () => {
     *     revalidatePath('/users');
     *     redirect('/users');
     * };
     * ```
     */
    onSuccess?: (data: SuccessData<Method>) => void | Promise<void>;
}

/**
 * Options for {@link createServerAction}.
 */
export interface ServerActionOptions<Method extends AnyClientMethod = AnyClientMethod> extends BaseOptions<Method> {
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
 * // app/users/actions.ts
 * 'use server';
 * import { revalidatePath } from 'next/cache';
 * import { redirect } from 'next/navigation';
 * import { createServerAction } from '@ts-kizuna/next';
 * import { client } from '@/lib/api-client';
 *
 * export const createUser = createServerAction(client.users.createUser, {
 *     onSuccess: () => {
 *         revalidatePath('/users');
 *         redirect('/users');
 *     },
 * });
 * ```
 *
 * Use `onSuccess` to revalidate/redirect, `onError` to turn a thrown error into
 * `{ ok: false, status: 0, error }`, and `raw` for the untouched response union.
 */
export function createServerAction<Method extends AnyClientMethod>(
    method: Method,
    options: BaseOptions<Method> & { raw: true }
): (...args: Parameters<Method>) => Promise<ResponseUnion<Method>>;
export function createServerAction<Method extends AnyClientMethod>(
    method: Method,
    options: BaseOptions<Method> & { raw?: false; onError: OnError }
): (...args: Parameters<Method>) => Promise<ServerActionResult<Method> | ThrownResult>;
export function createServerAction<Method extends AnyClientMethod>(
    method: Method,
    options?: BaseOptions<Method> & { raw?: false; onError?: undefined }
): (...args: Parameters<Method>) => Promise<ServerActionResult<Method>>;
export function createServerAction(
    method: AnyClientMethod,
    options: {
        onSuccess?: (data: unknown) => void | Promise<void>;
        onError?: OnError;
        raw?: boolean;
    } = {}
): (...args: unknown[]) => Promise<unknown> {
    const { onSuccess, onError, raw = false } = options;

    return async (...args: unknown[]): Promise<unknown> => {
        let response: ClientResponse;
        try {
            response = await (method as (...callArgs: never[]) => Promise<ClientResponse>)(...(args as never[]));
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
            await onSuccess(response.body);
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
