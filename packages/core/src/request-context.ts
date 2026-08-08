import type { z } from 'zod';

/**
 * A request context declaration from {@link createRequestContext}: the schema
 * of a request-scoped value every handler receives, and optionally the request
 * headers it derives from. Resolved per adapter with
 * `server.requestContext` and wired on `server.api` under
 * `requestContext`.
 */
export interface RequestContextSchema<
    ContextSchema extends z.ZodType = z.ZodType,
    HeadersSchema extends z.ZodType | undefined = z.ZodType | undefined,
> {
    readonly __brand: 'RequestContext';
    /**
     * Schema for the value the resolver returns and handlers receive.
     */
    readonly context: ContextSchema;
    /**
     * Schema for the request headers the value derives from. Clients type
     * against it — `createClient` takes the values once under `requestContext`,
     * and the generated Swift and Kotlin clients take them in their
     * initializers. Routes and the OpenAPI document are untouched.
     */
    readonly headers?: HeadersSchema;
}

interface RequestContextConfig<ContextSchema extends z.ZodType, HeadersSchema extends z.ZodType | undefined> {
    context: ContextSchema;
    headers?: HeadersSchema;
}

/**
 * Declare a request-scoped value — an analytics id, a logger, a tenant. Register
 * it on `kizuna` under `requestContext`; handlers receive it typed under its
 * registered name. It never gates a request.
 *
 * Pass a schema alone for a server-derived value, or `{ context, headers }`
 * when the value comes from request headers — clients are then typed to send
 * them once, on the client initializer.
 *
 * @example
 * export const analytics = createRequestContext({
 *     headers: z.object({
 *         'x-posthog-session-id': z.string().optional(),
 *     }),
 *     context: z.object({
 *         sessionId: z.string().nullable(),
 *     }),
 * });
 */
export function createRequestContext<const ContextSchema extends z.ZodType>(
    context: ContextSchema
): RequestContextSchema<ContextSchema, undefined>;
export function createRequestContext<const ContextSchema extends z.ZodType, const HeadersSchema extends z.ZodType | undefined = undefined>(
    config: RequestContextConfig<ContextSchema, HeadersSchema>
): RequestContextSchema<ContextSchema, HeadersSchema>;
export function createRequestContext(
    schemaOrConfig: z.ZodType | RequestContextConfig<z.ZodType, z.ZodType | undefined>
): RequestContextSchema<z.ZodType, z.ZodType | undefined> {
    const config = 'safeParse' in schemaOrConfig ? undefined : (schemaOrConfig as RequestContextConfig<z.ZodType, z.ZodType | undefined>);
    return {
        __brand: 'RequestContext',
        context: config ? config.context : (schemaOrConfig as z.ZodType),
        headers: config?.headers,
    };
}

/**
 * The header inputs a client sends for a declaration: the `z.input` of its
 * `headers` schema, or nothing when the declaration has none.
 */
export type RequestContextHeaderInputs<Declaration> = Declaration extends { headers?: infer HeadersSchema }
    ? [NonNullable<HeadersSchema>] extends [never]
        ? {}
        : NonNullable<HeadersSchema> extends z.ZodType
          ? z.input<NonNullable<HeadersSchema>>
          : {}
    : {};

/**
 * The header values a resolver reads for a declaration: the `z.output` of its
 * `headers` schema, or the adapter's raw header record when it has none.
 */
export type RequestContextHeaderValues<Declaration> = Declaration extends { headers?: infer HeadersSchema }
    ? [NonNullable<HeadersSchema>] extends [never]
        ? Record<string, string | string[] | undefined>
        : NonNullable<HeadersSchema> extends z.ZodType
          ? z.output<NonNullable<HeadersSchema>>
          : Record<string, string | string[] | undefined>
    : Record<string, string | string[] | undefined>;
