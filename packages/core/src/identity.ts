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
 * // for Kizuna.identity.apiKey({ name: 'x-workspace-token', in: 'header' }):
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

/**
 * The empty credential a `custom` identity carries. Its guard receives no
 * credential key and reads the credential itself (e.g. `params.token`).
 */
export type NoCredential = Record<never, never>;

/**
 * The status an identity returns when its guard cannot resolve the credential.
 * `401` is the RFC 9110 §15.5.2 answer and the default. `404` is for a credential
 * that is itself the resource identifier, where admitting the credential is
 * unknown would confirm which ones exist.
 *
 * Insufficient access is not in this union: that is the framework's `403`,
 * derived from the route's `accessGate`, and a guard cannot emit it.
 */
export type UnauthenticatedStatus = 401 | 404;

declare const CREDENTIAL: unique symbol;

/**
 * An authenticated caller, defined with the `Kizuna.identity` builders. Extends
 * {@link SecurityScheme} with an optional `access` schema describing the fields
 * the `auth` map may constrain, and carries the credential its authentication
 * method extracts from the request.
 */
export interface Identity<
    ContextSchema extends z.ZodType | undefined = z.ZodType | undefined,
    AccessSchema extends z.ZodType | undefined = z.ZodType | undefined,
    CredentialType extends Credential | NoCredential = Credential,
> extends SecurityScheme<ContextSchema> {
    /**
     * Schema for the fields the `auth` map may constrain
     * (`{ scheme: { field: value } }`) and that a handler reads under the
     * identity's name. `undefined` when the identity declares no access fields.
     */
    readonly access: AccessSchema;
    /**
     * The status this identity's `unauthenticated(...)` returns. Defaults to `401`.
     */
    readonly onUnauthenticated: UnauthenticatedStatus;
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

const make = <
    ContextSchema extends z.ZodType | undefined,
    AccessSchema extends z.ZodType | undefined,
    CredentialType extends Credential | NoCredential = { bearer: BearerCredential | null },
>(
    openapi: OpenApiSecuritySchemeObject | undefined,
    context: ContextSchema,
    access: AccessSchema,
    scheme: string | undefined,
    onUnauthenticated: UnauthenticatedStatus | undefined
): Identity<ContextSchema, AccessSchema, CredentialType> => ({
    __brand: 'SecurityScheme',
    openapi,
    context,
    access,
    scheme,
    onUnauthenticated: onUnauthenticated ?? 401,
});

export interface BearerConfig<ContextSchema extends z.ZodType | undefined, AccessSchema extends z.ZodType | undefined> {
    context?: ContextSchema;
    access?: AccessSchema;
    bearerFormat?: string;
    description?: string;
    scheme?: string;
    /**
     * The status this identity returns when its guard calls `unauthenticated(...)`.
     * Defaults to `401`.
     */
    onUnauthenticated?: UnauthenticatedStatus;
}

export interface ApiKeyConfig<
    ContextSchema extends z.ZodType | undefined,
    AccessSchema extends z.ZodType | undefined,
    Name extends string,
    In extends 'header' | 'query' | 'cookie',
> {
    name: Name;
    in: In;
    context?: ContextSchema;
    access?: AccessSchema;
    description?: string;
    scheme?: string;
    /**
     * The status this identity returns when its guard calls `unauthenticated(...)`.
     * Defaults to `401`.
     */
    onUnauthenticated?: UnauthenticatedStatus;
}

export interface BasicConfig<ContextSchema extends z.ZodType | undefined, AccessSchema extends z.ZodType | undefined> {
    context?: ContextSchema;
    access?: AccessSchema;
    description?: string;
    scheme?: string;
    /**
     * The status this identity returns when its guard calls `unauthenticated(...)`.
     * Defaults to `401`.
     */
    onUnauthenticated?: UnauthenticatedStatus;
}

export interface OAuth2Config<ContextSchema extends z.ZodType | undefined, AccessSchema extends z.ZodType | undefined> {
    flows: OAuthFlows;
    context?: ContextSchema;
    access?: AccessSchema;
    description?: string;
    scheme?: string;
    /**
     * The status this identity returns when its guard calls `unauthenticated(...)`.
     * Defaults to `401`.
     */
    onUnauthenticated?: UnauthenticatedStatus;
}

export interface OpenIdConnectConfig<ContextSchema extends z.ZodType | undefined, AccessSchema extends z.ZodType | undefined> {
    openIdConnectUrl: string;
    context?: ContextSchema;
    access?: AccessSchema;
    description?: string;
    scheme?: string;
    /**
     * The status this identity returns when its guard calls `unauthenticated(...)`.
     * Defaults to `401`.
     */
    onUnauthenticated?: UnauthenticatedStatus;
}

export interface CustomConfig<ContextSchema extends z.ZodType | undefined, AccessSchema extends z.ZodType | undefined> {
    context?: ContextSchema;
    access?: AccessSchema;
    description?: string;
    scheme?: string;
    /**
     * The status this identity returns when its guard calls `unauthenticated(...)`.
     * Defaults to `401`.
     */
    onUnauthenticated?: UnauthenticatedStatus;
}

/**
 * Builders that define an identity by its authentication mechanism: `bearer`,
 * `apiKey`, `basic`, `oauth2`, `openIdConnect`, and `custom` (a credential no
 * OpenAPI security scheme can express, such as a capability-URL path token).
 * Each takes, optionally, the `context` a passing guard returns and the `access`
 * fields the `auth` map may constrain. Omit `context` for an authentication-only
 * identity — a pure gate whose guard returns nothing on success and contributes
 * no handler args.
 *
 * @example
 * const user = Kizuna.identity.bearer({
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
 * const apiConsumer = Kizuna.identity.apiKey({
 *     name: 'x-api-key',
 *     in: 'header',
 * });
 */
export const createIdentity = {
    bearer: <ContextSchema extends z.ZodType | undefined = undefined, AccessSchema extends z.ZodType | undefined = undefined>(
        config: BearerConfig<ContextSchema, AccessSchema>
    ): Identity<ContextSchema, AccessSchema, { bearer: BearerCredential | null }> =>
        make<ContextSchema, AccessSchema, { bearer: BearerCredential | null }>(
            { type: 'http', scheme: 'bearer', bearerFormat: config.bearerFormat, description: config.description },
            config.context as ContextSchema,
            config.access as AccessSchema,
            config.scheme,
            config.onUnauthenticated
        ),
    apiKey: <
        ContextSchema extends z.ZodType | undefined = undefined,
        AccessSchema extends z.ZodType | undefined = undefined,
        const Name extends string = string,
        const In extends 'header' | 'query' | 'cookie' = 'header' | 'query' | 'cookie',
    >(
        config: ApiKeyConfig<ContextSchema, AccessSchema, Name, In>
    ): Identity<ContextSchema, AccessSchema, { apiKey: ApiKeyCredential<In, Name> | null }> =>
        make<ContextSchema, AccessSchema, { apiKey: ApiKeyCredential<In, Name> | null }>(
            { type: 'apiKey', name: config.name, in: config.in, description: config.description },
            config.context as ContextSchema,
            config.access as AccessSchema,
            config.scheme,
            config.onUnauthenticated
        ),
    basic: <ContextSchema extends z.ZodType | undefined = undefined, AccessSchema extends z.ZodType | undefined = undefined>(
        config: BasicConfig<ContextSchema, AccessSchema>
    ): Identity<ContextSchema, AccessSchema, { basic: BasicCredential | null }> =>
        make<ContextSchema, AccessSchema, { basic: BasicCredential | null }>(
            { type: 'http', scheme: 'basic', description: config.description },
            config.context as ContextSchema,
            config.access as AccessSchema,
            config.scheme,
            config.onUnauthenticated
        ),
    oauth2: <ContextSchema extends z.ZodType | undefined = undefined, AccessSchema extends z.ZodType | undefined = undefined>(
        config: OAuth2Config<ContextSchema, AccessSchema>
    ): Identity<ContextSchema, AccessSchema, { oauth2: BearerCredential | null }> =>
        make<ContextSchema, AccessSchema, { oauth2: BearerCredential | null }>(
            { type: 'oauth2', flows: config.flows, description: config.description },
            config.context as ContextSchema,
            config.access as AccessSchema,
            config.scheme,
            config.onUnauthenticated
        ),
    openIdConnect: <ContextSchema extends z.ZodType | undefined = undefined, AccessSchema extends z.ZodType | undefined = undefined>(
        config: OpenIdConnectConfig<ContextSchema, AccessSchema>
    ): Identity<ContextSchema, AccessSchema, { openIdConnect: BearerCredential | null }> =>
        make<ContextSchema, AccessSchema, { openIdConnect: BearerCredential | null }>(
            { type: 'openIdConnect', openIdConnectUrl: config.openIdConnectUrl, description: config.description },
            config.context as ContextSchema,
            config.access as AccessSchema,
            config.scheme,
            config.onUnauthenticated
        ),
    /**
     * An identity whose credential no OpenAPI scheme can express, such as a
     * capability-URL token in a path segment. The guard reads the credential
     * itself (e.g. `params.token`); the route emits no scheme, only an
     * `x-kizuna-guarded` extension. Use `bearer` for a token or `apiKey` for a
     * header; reach for `custom` only when neither fits.
     *
     * @example
     * const inviteToken = Kizuna.identity.custom({
     *     context: z.object({
     *         inviteId: z.string(),
     *     }),
     * });
     */
    custom: <ContextSchema extends z.ZodType | undefined = undefined, AccessSchema extends z.ZodType | undefined = undefined>(
        config: CustomConfig<ContextSchema, AccessSchema>
    ): Identity<ContextSchema, AccessSchema, NoCredential> =>
        make<ContextSchema, AccessSchema, NoCredential>(
            undefined,
            config.context as ContextSchema,
            config.access as AccessSchema,
            config.scheme,
            config.onUnauthenticated
        ),
};
