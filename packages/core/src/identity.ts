import type { z } from 'zod';
import type { SecurityScheme, OpenApiSecuritySchemeObject, OAuthFlows } from './security-scheme.js';

/**
 * The token a `bearer`, `oauth2`, or `openIdConnect` method extracts from the
 * `Authorization` header.
 */
export interface BearerCredential {
    token: string;
}

/**
 * The username and password a `basic` method decodes from the
 * `Authorization: Basic <base64>` header.
 */
export interface BasicCredential {
    username: string;
    password: string;
}

/**
 * The value an `apiKey` method reads from the header, query parameter, or cookie
 * the identity named, with `in`/`name` echoing where it came from.
 *
 * @example
 * // for createIdentity.apiKey({ name: 'x-workspace-token', in: 'header' }):
 * // { in: 'header'; name: 'x-workspace-token'; value: string }
 */
export interface ApiKeyCredential<In extends 'header' | 'query' | 'cookie' = 'header' | 'query' | 'cookie', Name extends string = string> {
    in: In;
    name: Name;
    value: string;
}

/**
 * The credential a guard receives, keyed by the identity's authentication method.
 * A guard destructures the one key its identity declares — `{ bearer }`,
 * `{ apiKey }`, `{ basic }`, `{ oauth2 }`, or `{ openIdConnect }`. The value is
 * `null` when the request carried no such credential.
 */
export type Credential =
    | { bearer: BearerCredential | null }
    | { oauth2: BearerCredential | null }
    | { openIdConnect: BearerCredential | null }
    | { basic: BasicCredential | null }
    | { apiKey: ApiKeyCredential | null };

declare const CREDENTIAL: unique symbol;

/**
 * An authenticated caller, defined with the {@link createIdentity} builders. Extends
 * {@link SecurityScheme} with an optional `access` schema describing the fields
 * the `auth` map may constrain, and carries the credential its authentication
 * method extracts from the request.
 */
export interface Identity<
    ContextSchema extends z.ZodType | undefined = z.ZodType | undefined,
    AccessSchema extends z.ZodType | undefined = z.ZodType | undefined,
    CredentialType extends Credential = Credential,
    HeadersSchema extends z.ZodType | undefined = z.ZodType | undefined,
> extends SecurityScheme<ContextSchema> {
    /**
     * Schema for the fields the `auth` map may constrain
     * (`{ scheme: { field: value } }`) and that a handler reads under the
     * identity's name. `undefined` when the identity declares no access fields.
     */
    readonly access: AccessSchema;
    /**
     * Schema for the auxiliary auth headers passed into the guard, typed.
     * `undefined` when the identity declares none.
     */
    readonly headers: HeadersSchema;
    /**
     * Phantom marker carrying the {@link Credential} the method extracts. Never
     * present at runtime.
     */
    readonly [CREDENTIAL]?: CredentialType;
}

/**
 * The {@link Credential} an identity's authentication method extracts and passes
 * to its guard — a single discriminated member, e.g. `{ apiKey: { in; name;
 * value } | null }` for an `apiKey` identity.
 */
export type CredentialOf<Id> = Id extends Identity<z.ZodType | undefined, z.ZodType | undefined, infer Extracted> ? Extracted : Credential;

/**
 * The access type an identity exposes: the `z.output` of its `access` schema,
 * or `never` when it declares none.
 */
export type AccessOf<Id> =
    Id extends Identity<z.ZodType | undefined, infer AccessSchema>
        ? AccessSchema extends z.ZodType
            ? z.output<AccessSchema>
            : never
        : never;

/**
 * An identity's access type, or `{}` when it declares none — used where access is
 * intersected with context (in a guard's return and the handler's scheme-keyed
 * args) so a missing access schema never collapses the result to `never`.
 */
export type IdentityAccess<Id> = [AccessOf<Id>] extends [never] ? {} : AccessOf<Id>;

/**
 * The auxiliary auth headers an identity's guard receives: the `z.output` of its
 * `headers` schema, or `{}` when it declares none.
 */
export type HeadersOf<Id> =
    Id extends Identity<z.ZodType | undefined, z.ZodType | undefined, Credential, infer HeadersSchema>
        ? HeadersSchema extends z.ZodType
            ? z.output<HeadersSchema>
            : {}
        : {};

const make = <
    ContextSchema extends z.ZodType | undefined,
    AccessSchema extends z.ZodType | undefined,
    CredentialType extends Credential = { bearer: BearerCredential | null },
    HeadersSchema extends z.ZodType | undefined = undefined,
>(
    openapi: OpenApiSecuritySchemeObject,
    context: ContextSchema,
    access: AccessSchema,
    scheme: string | undefined,
    headers: HeadersSchema
): Identity<ContextSchema, AccessSchema, CredentialType, HeadersSchema> => ({
    __brand: 'SecurityScheme',
    openapi,
    context,
    access,
    scheme,
    headers,
});

interface BearerConfig<
    ContextSchema extends z.ZodType | undefined,
    AccessSchema extends z.ZodType | undefined,
    HeadersSchema extends z.ZodType | undefined,
> {
    context?: ContextSchema;
    access?: AccessSchema;
    headers?: HeadersSchema;
    bearerFormat?: string;
    description?: string;
    scheme?: string;
}

interface ApiKeyConfig<
    ContextSchema extends z.ZodType | undefined,
    AccessSchema extends z.ZodType | undefined,
    HeadersSchema extends z.ZodType | undefined,
    Name extends string,
    In extends 'header' | 'query' | 'cookie',
> {
    name: Name;
    in: In;
    context?: ContextSchema;
    access?: AccessSchema;
    headers?: HeadersSchema;
    description?: string;
    scheme?: string;
}

interface BasicConfig<
    ContextSchema extends z.ZodType | undefined,
    AccessSchema extends z.ZodType | undefined,
    HeadersSchema extends z.ZodType | undefined,
> {
    context?: ContextSchema;
    access?: AccessSchema;
    headers?: HeadersSchema;
    description?: string;
    scheme?: string;
}

interface OAuth2Config<
    ContextSchema extends z.ZodType | undefined,
    AccessSchema extends z.ZodType | undefined,
    HeadersSchema extends z.ZodType | undefined,
> {
    flows: OAuthFlows;
    context?: ContextSchema;
    access?: AccessSchema;
    headers?: HeadersSchema;
    description?: string;
    scheme?: string;
}

interface OpenIdConnectConfig<
    ContextSchema extends z.ZodType | undefined,
    AccessSchema extends z.ZodType | undefined,
    HeadersSchema extends z.ZodType | undefined,
> {
    openIdConnectUrl: string;
    context?: ContextSchema;
    access?: AccessSchema;
    headers?: HeadersSchema;
    description?: string;
    scheme?: string;
}

/**
 * Builders that define an identity by its authentication mechanism: `bearer`,
 * `apiKey`, `basic`, `oauth2`, and `openIdConnect`. Each takes, optionally, the
 * `context` a passing guard returns and the `access` fields the `auth` map may
 * constrain. Omit `context` for an authentication-only identity — a pure gate
 * whose guard returns nothing on success and contributes no handler args.
 *
 * @example
 * const user = createIdentity.bearer({
 *     context: z.object({
 *         id: z.string().uuid(),
 *     }),
 *     access: z.object({
 *         role: z.enum(['owner', 'admin']),
 *     }),
 * });
 *
 * @example
 * // Authentication-only — no context, no handler args:
 * const apiConsumer = createIdentity.apiKey({
 *     name: 'x-api-key',
 *     in: 'header',
 * });
 */
export const createIdentity = {
    bearer: <
        ContextSchema extends z.ZodType | undefined = undefined,
        AccessSchema extends z.ZodType | undefined = undefined,
        HeadersSchema extends z.ZodType | undefined = undefined,
    >(
        config: BearerConfig<ContextSchema, AccessSchema, HeadersSchema>
    ): Identity<ContextSchema, AccessSchema, { bearer: BearerCredential | null }, HeadersSchema> =>
        make<ContextSchema, AccessSchema, { bearer: BearerCredential | null }, HeadersSchema>(
            { type: 'http', scheme: 'bearer', bearerFormat: config.bearerFormat, description: config.description },
            config.context as ContextSchema,
            config.access as AccessSchema,
            config.scheme,
            config.headers as HeadersSchema
        ),
    apiKey: <
        ContextSchema extends z.ZodType | undefined = undefined,
        AccessSchema extends z.ZodType | undefined = undefined,
        HeadersSchema extends z.ZodType | undefined = undefined,
        const Name extends string = string,
        const In extends 'header' | 'query' | 'cookie' = 'header' | 'query' | 'cookie',
    >(
        config: ApiKeyConfig<ContextSchema, AccessSchema, HeadersSchema, Name, In>
    ): Identity<ContextSchema, AccessSchema, { apiKey: ApiKeyCredential<In, Name> | null }, HeadersSchema> =>
        make<ContextSchema, AccessSchema, { apiKey: ApiKeyCredential<In, Name> | null }, HeadersSchema>(
            { type: 'apiKey', name: config.name, in: config.in, description: config.description },
            config.context as ContextSchema,
            config.access as AccessSchema,
            config.scheme,
            config.headers as HeadersSchema
        ),
    basic: <
        ContextSchema extends z.ZodType | undefined = undefined,
        AccessSchema extends z.ZodType | undefined = undefined,
        HeadersSchema extends z.ZodType | undefined = undefined,
    >(
        config: BasicConfig<ContextSchema, AccessSchema, HeadersSchema>
    ): Identity<ContextSchema, AccessSchema, { basic: BasicCredential | null }, HeadersSchema> =>
        make<ContextSchema, AccessSchema, { basic: BasicCredential | null }, HeadersSchema>(
            { type: 'http', scheme: 'basic', description: config.description },
            config.context as ContextSchema,
            config.access as AccessSchema,
            config.scheme,
            config.headers as HeadersSchema
        ),
    oauth2: <
        ContextSchema extends z.ZodType | undefined = undefined,
        AccessSchema extends z.ZodType | undefined = undefined,
        HeadersSchema extends z.ZodType | undefined = undefined,
    >(
        config: OAuth2Config<ContextSchema, AccessSchema, HeadersSchema>
    ): Identity<ContextSchema, AccessSchema, { oauth2: BearerCredential | null }, HeadersSchema> =>
        make<ContextSchema, AccessSchema, { oauth2: BearerCredential | null }, HeadersSchema>(
            { type: 'oauth2', flows: config.flows, description: config.description },
            config.context as ContextSchema,
            config.access as AccessSchema,
            config.scheme,
            config.headers as HeadersSchema
        ),
    openIdConnect: <
        ContextSchema extends z.ZodType | undefined = undefined,
        AccessSchema extends z.ZodType | undefined = undefined,
        HeadersSchema extends z.ZodType | undefined = undefined,
    >(
        config: OpenIdConnectConfig<ContextSchema, AccessSchema, HeadersSchema>
    ): Identity<ContextSchema, AccessSchema, { openIdConnect: BearerCredential | null }, HeadersSchema> =>
        make<ContextSchema, AccessSchema, { openIdConnect: BearerCredential | null }, HeadersSchema>(
            { type: 'openIdConnect', openIdConnectUrl: config.openIdConnectUrl, description: config.description },
            config.context as ContextSchema,
            config.access as AccessSchema,
            config.scheme,
            config.headers as HeadersSchema
        ),
};
