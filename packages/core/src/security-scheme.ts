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
 * An OpenAPI 3.1.0 Security Scheme Object — the wire definition emitted under
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
 * A security scheme declared with the {@link createIdentity} builders. It carries two
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
     */
    readonly openapi: OpenApiSecuritySchemeObject;
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
     * identity — a pure gate with no data to hand the handler.
     */
    readonly context: ContextSchema;
}

/**
 * The context type a passing guard for scheme `S` provides — the `z.output` of
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
