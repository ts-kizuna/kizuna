import type { z } from 'zod';

/**
 * An OAuth 2.0 flow object, as defined by OpenAPI 3.1.0.
 */
export interface OAuthFlow {
    authorizationUrl?: string;
    tokenUrl?: string;
    refreshUrl?: string;
    scopes: Record<string, string>;
}

/**
 * The OAuth 2.0 flows an `oauth2` scheme supports.
 */
export interface OAuthFlows {
    implicit?: OAuthFlow;
    password?: OAuthFlow;
    clientCredentials?: OAuthFlow;
    authorizationCode?: OAuthFlow;
}

/**
 * An OpenAPI 3.1.0 Security Scheme Object, the wire definition emitted under
 * `components.securitySchemes`. One of the four standard scheme types.
 */
export type OpenApiSecuritySchemeObject =
    | {
          type: 'http';
          scheme: 'bearer' | 'basic' | (string & {});
          bearerFormat?: string;
          description?: string;
      }
    | {
          type: 'apiKey';
          name: string;
          in: 'header' | 'query' | 'cookie';
          description?: string;
      }
    | {
          type: 'oauth2';
          flows: OAuthFlows;
          description?: string;
      }
    | {
          type: 'openIdConnect';
          openIdConnectUrl: string;
          description?: string;
      };

/**
 * A security scheme declared with the `Kizuna.identity` builders. It carries two
 * things:
 *
 * - the OpenAPI definition (`type`, `scheme`, …), emitted under
 *   `components.securitySchemes`, and
 * - a `context` schema describing what a passing guard provides to the handler.
 *
 * Register schemes on the `kizuna` factory under `identities`; the contract's
 * `auth` map then references them by name, and handlers of secured routes
 * receive the scheme's context (`z.output` of `context`) in their args.
 */
export interface SecurityScheme<ContextSchema extends z.ZodType | undefined = z.ZodType | undefined> {
    readonly __brand: 'SecurityScheme';
    /**
     * The OpenAPI Security Scheme Object emitted under `components.securitySchemes`.
     * `undefined` for a `custom` identity, which emits no scheme (only an
     * `x-kizuna-guarded` extension).
     */
    readonly openapi?: OpenApiSecuritySchemeObject;
    /**
     * The name this identity is emitted under in `components.securitySchemes`.
     * Identities sharing a credential (one bearer token, several policies) set
     * the same name and emit a single scheme. Defaults to the identity's
     * registered name.
     */
    readonly scheme?: string;
    /**
     * Schema for the context a passing guard provides to the handler. Use a
     * `z.union(...)` when one scheme resolves to multiple identities (e.g. a
     * staff user or a service client). `undefined` for an authentication-only
     * identity, a pure gate with no data to hand the handler.
     */
    readonly context: ContextSchema;
    /**
     * Issuer identifier of the authorization server that mints this scheme's
     * tokens (RFC 8414). Consumers that advertise the authorization server,
     * such as RFC 9728 metadata, read it via `authorizationServerIssuer`,
     * which derives it from `openIdConnectUrl` for `openIdConnect` identities.
     */
    readonly issuer?: string;
}

/**
 * The context type a passing guard for scheme `S` provides, the `z.output` of
 * the scheme's `context` schema, or `{}` (contributing nothing) when the scheme
 * declares no context.
 */
export type ContextOf<S> =
    S extends SecurityScheme<infer ContextSchema> ? (ContextSchema extends z.ZodType ? z.output<ContextSchema> : {}) : never;

/**
 * Type guard for a {@link SecurityScheme}.
 */
export const isSecurityScheme = (value: unknown): value is SecurityScheme =>
    typeof value === 'object' && value !== null && '__brand' in value && (value as SecurityScheme).__brand === 'SecurityScheme';

/**
 * Issuer identifier of the authorization server behind a scheme: the declared
 * `issuer`, or for an `openIdConnect` identity the `openIdConnectUrl` with its
 * `/.well-known/openid-configuration` segment removed (both RFC 8414 forms).
 */
export const authorizationServerIssuer = (scheme: SecurityScheme | undefined): string | undefined => {
    if (scheme?.issuer !== undefined) return scheme.issuer;
    const openapi = scheme?.openapi;
    if (openapi?.type !== 'openIdConnect') return undefined;
    const issuer = openapi.openIdConnectUrl.replace('/.well-known/openid-configuration', '');
    return issuer === openapi.openIdConnectUrl ? undefined : issuer;
};

/**
 * The scopes an `oauth2` scheme's flows declare, for consumers that advertise
 * them (e.g. RFC 9728 `scopes_supported`). `undefined` for other scheme types.
 */
export const declaredScopes = (scheme: SecurityScheme | undefined): string[] | undefined => {
    const openapi = scheme?.openapi;
    if (openapi?.type !== 'oauth2') return undefined;
    const names = new Set<string>();
    for (const flow of Object.values(openapi.flows)) {
        for (const name of Object.keys(flow.scopes)) names.add(name);
    }
    return [...names];
};
