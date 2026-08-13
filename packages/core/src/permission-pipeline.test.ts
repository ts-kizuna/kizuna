import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAdapter, renderJsonResult, type AdapterRequest, type AdapterResult, type PermissionMap } from './adapter.js';
import { Kizuna } from './kizuna.js';

const UserSchema = z.object({
    id: z.string(),
});

const viewInvoices = Kizuna.permission();
const exportLedger = Kizuna.permission();
const promoteMember = Kizuna.permission({
    appliesTo: UserSchema,
});

const k = new Kizuna({
    permissions: {
        viewInvoices,
        exportLedger,
        promoteMember,
    },
});

const routeDefinition = (path: `/${string}`) => ({
    method: 'GET' as const,
    path,
    responses: {
        200: z.object({
            ok: z.boolean(),
        }),
    },
});

const makeContract = () =>
    k.contract({
        routes: {
            items: k.routes({
                open: routeDefinition('/open'),
                gated: routeDefinition('/gated'),
                both: routeDefinition('/both'),
                either: routeDefinition('/either'),
            }),
        },
        permissions: {
            items: {
                '*': false,
                gated: 'viewInvoices',
                both: ['viewInvoices', 'exportLedger'],
                either: {
                    oneOf: ['viewInvoices', 'exportLedger'],
                },
            },
        },
    });

const makeRequest = (path: string): AdapterRequest<null> => ({
    request: null,
    method: 'GET',
    resolution: {
        kind: 'core-match',
        path,
    },
    query: {},
    headers: {},
    readBody: () => undefined,
});

const makeAdapter = () => {
    const results: AdapterResult[] = [];
    const adapter = createAdapter<null, void, Record<string, never>>({
        buildHandlerContext: () => ({}),
        respond: (result) => {
            results.push(result);
        },
    });
    return { adapter, results };
};

const okHandler = () => ({
    status: 200 as const,
    body: {
        ok: true,
    },
});

type Can = Record<string, (record?: unknown) => Promise<boolean>>;

const routerWith = (handler: unknown) =>
    ({
        items: {
            open: handler,
            gated: handler,
            both: handler,
            either: handler,
        },
    }) as never;

const run = async (path: string, permissions: PermissionMap<Record<string, never>>, handler: unknown = okHandler) => {
    const contract = makeContract();
    const { adapter, results } = makeAdapter();
    await adapter.handle({
        routes: contract.routes,
        router: routerWith(handler),
        request: makeRequest(path),
        responseContext: {},
        permissions,
        schemes: {},
    });
    return results[0]!;
};

const allow: PermissionMap<Record<string, never>> = {
    viewInvoices: () => true,
    exportLedger: () => true,
    promoteMember: () => (user: never) => (user as { id: string }).id === 'usr_9',
};

const deny: PermissionMap<Record<string, never>> = {
    viewInvoices: () => false,
    exportLedger: () => false,
    promoteMember: () => () => false,
};

describe('the permission stage', () => {
    it('leaves a route demanding nothing alone', async () => {
        expect((await run('/open', deny)).kind).toBe('success');
    });

    it('passes a route whose permission the caller holds', async () => {
        expect((await run('/gated', allow)).kind).toBe('success');
    });

    it('denies with 403 problem details when the caller does not', async () => {
        const result = await run('/gated', deny);
        expect(result).toEqual({
            kind: 'permission-denied',
            detail: 'Forbidden: viewInvoices is not permitted on this route.',
        });

        const rendered = renderJsonResult({
            kind: 'permission-denied',
            detail: 'Forbidden: viewInvoices is not permitted on this route.',
        });
        expect(rendered.status).toBe(403);
        expect(rendered.headers['content-type']).toBe('application/problem+json');
        expect(rendered.body).toEqual({
            type: 'about:blank',
            title: 'Forbidden',
            status: 403,
            detail: 'Forbidden: viewInvoices is not permitted on this route.',
        });
    });

    it('requires every permission in an `all` list', async () => {
        expect((await run('/both', allow)).kind).toBe('success');

        const result = await run('/both', {
            ...allow,
            exportLedger: () => false,
        });
        expect(result).toEqual({
            kind: 'permission-denied',
            detail: 'Forbidden: viewInvoices, exportLedger is not permitted on this route.',
        });
    });

    it('accepts any one permission in a `oneOf` list', async () => {
        expect(
            (
                await run('/either', {
                    ...allow,
                    exportLedger: () => false,
                })
            ).kind
        ).toBe('success');
    });

    it('denies a `oneOf` list only when every one fails', async () => {
        expect(await run('/either', deny)).toEqual({
            kind: 'permission-denied',
            detail: 'Forbidden: none of viewInvoices, exportLedger is permitted on this route.',
        });
    });
});

describe('laziness', () => {
    it('resolves a permission once per request even when asked twice', async () => {
        const implementation = vi.fn(() => true);

        await run('/open', { ...allow, viewInvoices: implementation }, async ({ can }: { can: Can }) => {
            await can.viewInvoices!();
            await can.viewInvoices!();
            return okHandler();
        });

        expect(implementation).toHaveBeenCalledTimes(1);
    });

    it('never resolves a permission the request does not ask about', async () => {
        const implementation = vi.fn(() => true);

        await run('/gated', { ...allow, exportLedger: implementation });

        expect(implementation).not.toHaveBeenCalled();
    });
});

describe('can in a handler', () => {
    it('answers about the record it is given', async () => {
        const seen: boolean[] = [];

        const result = await run('/open', allow, async ({ can }: { can: Can }) => {
            seen.push(await can.promoteMember!({ id: 'usr_9' }));
            seen.push(await can.promoteMember!({ id: 'usr_44' }));
            return okHandler();
        });

        expect(result.kind).toBe('success');
        expect(seen).toEqual([true, false]);
    });

    it('awaits an async predicate', async () => {
        const seen: boolean[] = [];

        await run(
            '/open',
            {
                ...allow,
                promoteMember: () => async (user: never) => Promise.resolve((user as { id: string }).id === 'usr_9'),
            },
            async ({ can }: { can: Can }) => {
                seen.push(await can.promoteMember!({ id: 'usr_9' }));
                return okHandler();
            }
        );

        expect(seen).toEqual([true]);
    });
});

describe('misconfiguration', () => {
    it('is a handler error when a required permission has no implementation', async () => {
        const result = await run('/gated', {});
        expect(result.kind).toBe('handler-error');
        expect((result as { error: Error }).error.message).toBe(
            'No implementation registered for permission "viewInvoices" required by route "items.gated".'
        );
    });

    it('is a handler error when a record-scoped permission is asked without its record', async () => {
        const result = await run('/open', allow, async ({ can }: { can: Can }) => {
            await can.promoteMember!();
            return okHandler();
        });
        expect(result.kind).toBe('handler-error');
        expect((result as { error: Error }).error.message).toContain('resolved to a predicate, so it needs the record');
    });
});
