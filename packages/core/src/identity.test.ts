import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { isSecurityScheme, type ContextOf } from './security-scheme.js';
import { Kizuna } from './namespace.js';

const context = z.object({
    userId: z.string(),
});

describe('identity builders', () => {
    it('bearer produces an http bearer scheme object', () => {
        const user = Kizuna.identity.bearer({
            context,
            bearerFormat: 'JWT',
            description: 'Session token',
        });
        expect(user.openapi).toEqual({
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Session token',
        });
        expect(user.context).toBe(context);
        expect(user.access).toBeUndefined();
    });

    it('apiKey produces an apiKey scheme object with name and location', () => {
        const member = Kizuna.identity.apiKey({
            name: 'x-workspace-token',
            in: 'header',
            context,
        });
        expect(member.openapi).toEqual({
            type: 'apiKey',
            name: 'x-workspace-token',
            in: 'header',
            description: undefined,
        });
    });

    it('basic produces an http basic scheme object', () => {
        const admin = Kizuna.identity.basic({
            context,
        });
        expect(admin.openapi).toEqual({
            type: 'http',
            scheme: 'basic',
            description: undefined,
        });
    });

    it('oauth2 carries its flows', () => {
        const flows = {
            authorizationCode: {
                authorizationUrl: 'https://auth.example.com/authorize',
                tokenUrl: 'https://auth.example.com/token',
                scopes: {
                    'read:users': 'Read users',
                },
            },
        };
        const oauthUser = Kizuna.identity.oauth2({
            flows,
            context,
        });
        expect(oauthUser.openapi).toEqual({
            type: 'oauth2',
            flows,
            description: undefined,
        });
    });

    it('openIdConnect carries its discovery url', () => {
        const oidcUser = Kizuna.identity.openIdConnect({
            openIdConnectUrl: 'https://auth.example.com/.well-known/openid-configuration',
            context,
        });
        expect(oidcUser.openapi).toEqual({
            type: 'openIdConnect',
            openIdConnectUrl: 'https://auth.example.com/.well-known/openid-configuration',
            description: undefined,
        });
    });

    it('custom carries no OpenAPI scheme', () => {
        const inviteToken = Kizuna.identity.custom({
            context: z.object({
                inviteId: z.string(),
            }),
        });
        expect(inviteToken.openapi).toBeUndefined();
        expect(inviteToken.context).toBeDefined();
        expect(isSecurityScheme(inviteToken)).toBe(true);
    });

    it('carries the access schema when declared', () => {
        const access = z.object({
            role: z.enum(['owner', 'admin']),
        });
        const member = Kizuna.identity.bearer({
            context,
            access,
        });
        expect(member.access).toBe(access);
    });

    it('builds an authentication-only identity with no context', () => {
        const apiConsumer = Kizuna.identity.apiKey({
            name: 'x-api-key',
            in: 'header',
        });
        expect(apiConsumer.openapi).toEqual({
            type: 'apiKey',
            name: 'x-api-key',
            in: 'header',
            description: undefined,
        });
        expect(apiConsumer.context).toBeUndefined();
        expect(apiConsumer.access).toBeUndefined();
        // A context-less identity contributes nothing (`{}`) to the handler args.
        expectTypeOf<ContextOf<typeof apiConsumer>>().toEqualTypeOf<{}>();
    });

    it('a bearer identity may omit its context', () => {
        const gate = Kizuna.identity.bearer({});
        expect(gate.context).toBeUndefined();
        expectTypeOf<ContextOf<typeof gate>>().toEqualTypeOf<{}>();
    });
});

describe('isSecurityScheme', () => {
    it('recognizes identities as security schemes', () => {
        const user = Kizuna.identity.bearer({
            context,
        });
        expect(isSecurityScheme(user)).toBe(true);
    });

    it('rejects plain objects', () => {
        expect(isSecurityScheme({})).toBe(false);
        expect(isSecurityScheme(null)).toBe(false);
        expect(isSecurityScheme('bearer')).toBe(false);
    });
});
