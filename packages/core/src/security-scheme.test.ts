import { describe, expect, it } from 'vitest';
import { authorizationServerIssuer, declaredScopes } from './security-scheme.js';
import { createIdentity } from './identity.js';

describe('authorizationServerIssuer', () => {
    it('reads the issuer an oauth2 identity declares', () => {
        const scheme = createIdentity.oauth2({
            issuer: 'https://auth.example.com',
            flows: {
                authorizationCode: {
                    authorizationUrl: 'https://auth.example.com/oauth2/authorize',
                    tokenUrl: 'https://auth.example.com/oauth2/token',
                    scopes: {},
                },
            },
        });
        expect(authorizationServerIssuer(scheme)).toBe('https://auth.example.com');
    });

    it('derives the issuer from a path-appended openIdConnectUrl', () => {
        const scheme = createIdentity.openIdConnect({
            openIdConnectUrl: 'https://auth.example.com/tenant/.well-known/openid-configuration',
        });
        expect(authorizationServerIssuer(scheme)).toBe('https://auth.example.com/tenant');
    });

    it('derives the issuer from a path-inserted openIdConnectUrl', () => {
        const scheme = createIdentity.openIdConnect({
            openIdConnectUrl: 'https://auth.example.com/.well-known/openid-configuration/tenant',
        });
        expect(authorizationServerIssuer(scheme)).toBe('https://auth.example.com/tenant');
    });

    it('is undefined when nothing declares or reveals an issuer', () => {
        const bearer = createIdentity.bearer({});
        const oauth = createIdentity.oauth2({
            flows: {
                clientCredentials: {
                    tokenUrl: 'https://auth.example.com/oauth2/token',
                    scopes: {},
                },
            },
        });
        expect(authorizationServerIssuer(bearer)).toBeUndefined();
        expect(authorizationServerIssuer(oauth)).toBeUndefined();
        expect(authorizationServerIssuer(undefined)).toBeUndefined();
    });
});

describe('oauth2 issuer validation', () => {
    const flows = {
        clientCredentials: {
            tokenUrl: 'https://auth.example.com/oauth2/token',
            scopes: {},
        },
    };

    it('accepts https and loopback http', () => {
        expect(() =>
            createIdentity.oauth2({
                issuer: 'https://auth.example.com',
                flows,
            })
        ).not.toThrow();
        expect(() =>
            createIdentity.oauth2({
                issuer: 'http://localhost:3000',
                flows,
            })
        ).not.toThrow();
    });

    it('rejects http off loopback, queries, and fragments', () => {
        expect(() =>
            createIdentity.oauth2({
                issuer: 'http://auth.example.com',
                flows,
            })
        ).toThrow('must be https');
        expect(() =>
            createIdentity.oauth2({
                issuer: 'https://auth.example.com?tenant=a',
                flows,
            })
        ).toThrow('query or fragment');
        expect(() =>
            createIdentity.oauth2({
                issuer: 'https://auth.example.com#main',
                flows,
            })
        ).toThrow('query or fragment');
    });
});

describe('declaredScopes', () => {
    it('collects the scopes across an oauth2 identity flows', () => {
        const scheme = createIdentity.oauth2({
            flows: {
                authorizationCode: {
                    authorizationUrl: 'https://auth.example.com/oauth2/authorize',
                    tokenUrl: 'https://auth.example.com/oauth2/token',
                    scopes: {
                        'users:read': 'Read users',
                        'users:write': 'Write users',
                    },
                },
                clientCredentials: {
                    tokenUrl: 'https://auth.example.com/oauth2/token',
                    scopes: {
                        'users:read': 'Read users',
                        'reports:read': 'Read reports',
                    },
                },
            },
        });
        expect(declaredScopes(scheme)?.sort()).toEqual(['reports:read', 'users:read', 'users:write']);
    });

    it('is undefined for schemes without flows', () => {
        expect(declaredScopes(createIdentity.bearer({}))).toBeUndefined();
        expect(declaredScopes(undefined)).toBeUndefined();
    });
});
