import { assertCanonicalResourceUri } from '@ts-kizuna/core';
import type { RoutePath } from '@ts-kizuna/core/plugin';

export interface McpOAuthProps {
    /**
     * Canonical URI of the MCP endpoint as clients reach it: absolute, no
     * fragment, ending in the endpoint's `path`. The RFC 9728 `resource`
     * value and the RFC 8707 audience your guard checks tokens against.
     */
    resource: string;

    /**
     * Name of the identity whose guard verifies the token on every request.
     * Its `issuer` and flow scopes become the metadata document.
     */
    scheme: string;
}

export const protectedResourceMetadataPath = (endpointPath: RoutePath): RoutePath => `/.well-known/oauth-protected-resource${endpointPath}`;

/**
 * Absolute URL the metadata route is served at: the resource's origin, any
 * mount prefix the resource path carries, then the well-known path.
 */
export const protectedResourceMetadataUrl = (oauth: McpOAuthProps, endpointPath: RoutePath): string => {
    const resource = new URL(oauth.resource);
    const mountPrefix = resource.pathname.slice(0, resource.pathname.length - endpointPath.length);
    return `${resource.origin}${mountPrefix}${protectedResourceMetadataPath(endpointPath)}`;
};

export const assertCanonicalResource = (oauth: McpOAuthProps, endpointPath: RoutePath): void => {
    assertCanonicalResourceUri(oauth.resource);
    if (!new URL(oauth.resource).pathname.endsWith(endpointPath)) {
        throw new Error(`The oauth resource "${oauth.resource}" does not end with the endpoint path "${endpointPath}".`);
    }
};
