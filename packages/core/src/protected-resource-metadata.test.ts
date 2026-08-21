import { describe, expect, it } from 'vitest';
import { bearerChallenge } from './adapter.js';
import { createIdentity } from './identity.js';
import {
    assertCanonicalResourceUri,
    buildProtectedResourceMetadata,
    ProtectedResourceMetadataSchema,
} from './protected-resource-metadata.js';

const user = createIdentity.oauth2({
    issuer: 'https://auth.example.com',
    flows: {
        authorizationCode: {
            authorizationUrl: 'https://auth.example.com/oauth2/authorize',
            tokenUrl: 'https://auth.example.com/oauth2/token',
            scopes: {
                'users:read': 'Read users',
                'users:write': 'Write users',
            },
        },
    },
});

describe('buildProtectedResourceMetadata', () => {
    it('builds the RFC 9728 document from the identity', () => {
        const metadata = buildProtectedResourceMetadata({
            resource: 'https://api.example.com',
            scheme: user,
        });

        expect(metadata).toEqual({
            resource: 'https://api.example.com',
            authorization_servers: ['https://auth.example.com'],
            scopes_supported: ['users:read', 'users:write'],
            bearer_methods_supported: ['header'],
        });
    });

    it('omits scopes_supported when the flows declare none', () => {
        const metadata = buildProtectedResourceMetadata({
            resource: 'https://api.example.com',
            scheme: createIdentity.openIdConnect({
                openIdConnectUrl: 'https://auth.example.com/.well-known/openid-configuration',
            }),
        });

        expect(metadata).not.toHaveProperty('scopes_supported');
        expect(metadata.authorization_servers).toEqual(['https://auth.example.com']);
        expect(metadata.bearer_methods_supported).toEqual(['header']);
    });

    it('throws when the identity names no authorization server', () => {
        expect(() =>
            buildProtectedResourceMetadata({
                resource: 'https://api.example.com',
                scheme: createIdentity.bearer({}),
            })
        ).toThrow('names no authorization server');
    });

    it('parses with its own schema', () => {
        const metadata = buildProtectedResourceMetadata({
            resource: 'https://api.example.com',
            scheme: user,
        });

        expect(ProtectedResourceMetadataSchema.parse(metadata)).toEqual(metadata);
    });
});

describe('assertCanonicalResourceUri', () => {
    it('accepts an absolute URI', () => {
        expect(() => assertCanonicalResourceUri('https://api.example.com')).not.toThrow();
    });

    it('accepts a query component', () => {
        expect(() => assertCanonicalResourceUri('https://api.example.com/v1?tenant=a')).not.toThrow();
    });

    it('rejects a relative URI', () => {
        expect(() => assertCanonicalResourceUri('/v1')).toThrow('not an absolute URI');
    });

    it('rejects a fragment', () => {
        expect(() => assertCanonicalResourceUri('https://api.example.com/v1#section')).toThrow('fragment');
    });
});

describe('bearerChallenge', () => {
    it('formats auth parameters as quoted strings', () => {
        expect(
            bearerChallenge({
                error: 'insufficient_scope',
                scope: 'users:write',
                resource_metadata: 'https://api.example.com/.well-known/oauth-protected-resource',
            })
        ).toBe(
            'Bearer error="insufficient_scope", scope="users:write", resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"'
        );
    });

    it('omits undefined parameters', () => {
        expect(
            bearerChallenge({
                error: undefined,
                scope: 'users:read',
            })
        ).toBe('Bearer scope="users:read"');
    });

    it('is the bare scheme with no parameters', () => {
        expect(bearerChallenge({})).toBe('Bearer');
        expect(
            bearerChallenge({
                scope: undefined,
            })
        ).toBe('Bearer');
    });

    it('escapes quotes and backslashes and drops control characters', () => {
        expect(
            bearerChallenge({
                error_description: 'a "quoted" \\ path\r\nsecond line',
            })
        ).toBe('Bearer error_description="a \\"quoted\\" \\\\ pathsecond line"');
    });
});
