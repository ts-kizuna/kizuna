import { z } from 'zod';
import { authorizationServerIssuer, declaredScopes, type SecurityScheme } from './security-scheme.js';

/**
 * RFC 9728 Protected Resource Metadata, the document an OAuth 2.0 protected
 * resource serves at `/.well-known/oauth-protected-resource` so clients can
 * discover which authorization servers issue tokens for it.
 */
export const ProtectedResourceMetadataSchema = z.object({
    resource: z.string(),
    authorization_servers: z.array(z.string()),
    scopes_supported: z.array(z.string()).optional(),
    bearer_methods_supported: z.array(z.string()).optional(),
});

export type ProtectedResourceMetadata = z.infer<typeof ProtectedResourceMetadataSchema>;

export interface ProtectedResourceConfig {
    /**
     * Canonical URI of the resource: absolute, no fragment. The RFC 8707
     * audience token verifiers check against.
     */
    resource: string;
    /**
     * The identity whose authorization server and scopes the document
     * advertises.
     */
    scheme: SecurityScheme;
}

/**
 * Build an RFC 9728 Protected Resource Metadata document. The authorization
 * server and scopes come from the identity: `issuer` and the flows' scopes on
 * an `oauth2` identity, the `openIdConnectUrl` on an `openIdConnect` one.
 * Kizuna only reads the `Authorization` header, so `bearer_methods_supported`
 * is always `['header']`.
 */
export const buildProtectedResourceMetadata = (config: ProtectedResourceConfig): ProtectedResourceMetadata => {
    const issuer = authorizationServerIssuer(config.scheme);
    if (issuer === undefined) {
        throw new Error(
            'The identity names no authorization server. Declare it with Kizuna.identity.oauth2 and an issuer, or Kizuna.identity.openIdConnect.'
        );
    }
    const scopes = declaredScopes(config.scheme);
    return {
        resource: config.resource,
        authorization_servers: [issuer],
        ...(scopes !== undefined && scopes.length > 0
            ? {
                  scopes_supported: scopes,
              }
            : {}),
        bearer_methods_supported: ['header'],
    };
};

/**
 * Throw unless `resource` is a canonical resource URI per RFC 8707 section 2:
 * absolute, no fragment. A query component is allowed.
 */
export const assertCanonicalResourceUri = (resource: string): void => {
    let parsed: URL;
    try {
        parsed = new URL(resource);
    } catch {
        throw new Error(`The resource "${resource}" is not an absolute URI. RFC 8707 requires one, e.g. 'https://api.example.com'.`);
    }
    if (parsed.hash !== '') {
        throw new Error(`The resource "${resource}" has a fragment. RFC 8707 forbids fragments in a canonical resource URI.`);
    }
};
