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

/** The full `{ status, body }` response union a client method resolves to. */
type ResponseUnion<Method extends AnyClientMethod> = Awaited<ReturnType<Method>>;

/** The route's argument object (e.g. `{ params, body, query }`). */
type RouteArgs<Method extends AnyClientMethod> = Parameters<Method>[0];

/** The 2xx status codes. */
type SuccessStatus = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226;

/** The success (2xx) members of the response union — what `onSuccess` receives. */
type SuccessResponse<Method extends AnyClientMethod> = Extract<ResponseUnion<Method>, { status: SuccessStatus }>;

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

/** The action's input: the route's args, minus injected fields and the client-only `fetchOptions`. */
type ActionInput<Method extends AnyClientMethod, Injected> = Omit<DeepOmitBy<RouteArgs<Method>, Injected>, 'fetchOptions'>;

/**
 * The action — same call and response as the client method, with injected
 * inputs stripped. Args are optional when the route needs none.
 */
type ServerAction<Method extends AnyClientMethod, Injected> =
    {} extends ActionInput<Method, Injected>
        ? (args?: ActionInput<Method, Injected>) => Promise<ResponseUnion<Method>>
        : (args: ActionInput<Method, Injected>) => Promise<ResponseUnion<Method>>;

/** The success hook — kept separate from `inject` so the overloads can constrain `inject` precisely. */
interface SuccessOption<Method extends AnyClientMethod> {
    /**
     * Run after a successful (2xx) response — the place for `revalidatePath`,
     * `revalidateTag`, or `redirect`. Receives the success response. Throwing
     * here (as `redirect` does) propagates.
     */
    onSuccess?: (response: SuccessResponse<Method>) => void | Promise<void>;
}

/**
 * Options for {@link createServerAction}.
 */
export interface ServerActionOptions<Method extends AnyClientMethod = AnyClientMethod> extends SuccessOption<Method> {
    /**
     * Supply server-derived parts of the route's arguments (e.g. an owner id
     * from the session). Typed to a partial of the route's args — completion and
     * typos are checked — and **removed from the action's input type**, so the
     * caller can't pass (or forge) them. May be async.
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
 * Turn a `@ts-kizuna/fetch` client method into a React Server Action.
 *
 * Use it exactly like the client: call it with the route's arguments, get back
 * the same `{ status, body }` response, and narrow on `status`. The action runs
 * server-side and strips the inputs a caller shouldn't supply — anything
 * `inject` fills (e.g. an owner id from the session) is removed from its type.
 *
 * ```ts
 * // app/posts/actions.ts
 * 'use server';
 * import { revalidatePath } from 'next/cache';
 * import { createServerAction } from '@ts-kizuna/next';
 * import { client } from '@/lib/api-client';
 *
 * export const createPost = createServerAction(client.posts.createPost, {
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
 * // caller only knows about `title`; the result is the client's response
 * const result = await createPost({
 *     body: {
 *         title,
 *     },
 * });
 * if (result.status === 201) {
 *     result.body.id;
 * }
 * ```
 */
export function createServerAction<Method extends AnyClientMethod, Injected extends DeepPartial<RouteArgs<Method>>>(
    method: Method,
    options: SuccessOption<Method> & { inject: () => Injected | Promise<Injected> }
): ServerAction<Method, Injected>;
export function createServerAction<Method extends AnyClientMethod>(
    method: Method,
    options?: SuccessOption<Method> & { inject?: undefined }
): ServerAction<Method, {}>;
export function createServerAction(
    method: AnyClientMethod,
    options?: {
        inject?: (...args: never[]) => unknown;
        onSuccess?: (...args: never[]) => unknown;
    }
): (...args: never[]) => Promise<unknown> {
    const { inject, onSuccess } = options ?? {};

    return async (...args: unknown[]): Promise<unknown> => {
        const injected = inject ? await inject() : undefined;
        const callArgs = isPlainObject(injected) ? [deepMerge(isPlainObject(args[0]) ? args[0] : {}, injected)] : args;
        const response = await (method as (...callArgs: never[]) => Promise<ClientResponse>)(...(callArgs as never[]));
        if (isSuccess(response.status) && onSuccess) {
            await onSuccess(response as never);
        }
        return response;
    };
}
