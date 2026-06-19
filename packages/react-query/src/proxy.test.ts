import { skipToken } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { createKizunaProxy } from './proxy.js';

/**
 * A stand-in for a `@ts-kizuna/fetch` client: the tree mirrors a contract and
 * each leaf records the args it was called with, then returns a canned
 * `{ status, body, headers }` response.
 */
const createMockClient = () => {
    const calls: Array<{ path: string; args: unknown }> = [];
    const record = (path: string, response: unknown) => async (args: unknown) => {
        calls.push({ path, args });
        return response;
    };
    const client = {
        users: {
            getUser: record('users.getUser', { status: 200, body: { id: '1', name: 'Ada' }, headers: {} }),
            createUser: record('users.createUser', { status: 201, body: { id: 'new' }, headers: {} }),
        },
        health: {
            check: record('health.check', { status: 200, body: { ok: true }, headers: {} }),
        },
    };
    return { client, calls };
};

const makeProxy = () => {
    const { client, calls } = createMockClient();
    // The runtime proxy is contract-agnostic; types are exercised in proxy.test-d.ts.
    const api = createKizunaProxy({ client } as never) as never as {
        users: {
            getUser: {
                queryOptions: (input?: unknown, options?: Record<string, unknown>) => { queryKey: unknown; queryFn: unknown };
                queryKey: (input?: unknown) => unknown;
                queryFilter: (input?: unknown, filters?: Record<string, unknown>) => Record<string, unknown>;
            };
            createUser: {
                mutationOptions: (options?: Record<string, unknown>) => {
                    mutationKey: unknown;
                    mutationFn: (variables: unknown) => Promise<unknown>;
                };
                mutationKey: () => unknown;
            };
            pathKey: () => unknown;
            pathFilter: (filters?: Record<string, unknown>) => Record<string, unknown>;
        };
        health: { check: { queryOptions: (input?: unknown) => { queryKey: unknown; queryFn: unknown } } };
        pathKey: () => unknown;
    };
    return { api, calls };
};

describe('createKizunaProxy', () => {
    it('builds a query key from the proxy path and input', () => {
        const { api } = makeProxy();
        const options = api.users.getUser.queryOptions({ params: { id: '1' } });
        expect(options.queryKey).toEqual([['users', 'getUser'], { input: { params: { id: '1' } }, type: 'query' }]);
    });

    it('omits the input from the key when none is given', () => {
        const { api } = makeProxy();
        const options = api.health.check.queryOptions();
        expect(options.queryKey).toEqual([['health', 'check'], { type: 'query' }]);
    });

    it('queryFn calls the underlying client and returns the full response union', async () => {
        const { api, calls } = makeProxy();
        const options = api.users.getUser.queryOptions({ params: { id: '1' } });
        const result = await (options.queryFn as () => Promise<unknown>)();
        expect(result).toEqual({ status: 200, body: { id: '1', name: 'Ada' }, headers: {} });
        expect(calls).toEqual([{ path: 'users.getUser', args: { params: { id: '1' } } }]);
    });

    it('disables the query with skipToken', () => {
        const { api, calls } = makeProxy();
        const options = api.users.getUser.queryOptions(skipToken);
        expect(options.queryFn).toBe(skipToken);
        expect(options.queryKey).toEqual([['users', 'getUser'], { type: 'query' }]);
        expect(calls).toEqual([]);
    });

    it('merges native options into queryOptions', () => {
        const { api } = makeProxy();
        const options = api.users.getUser.queryOptions({ params: { id: '1' } }, { staleTime: 1000 }) as Record<string, unknown>;
        expect(options.staleTime).toBe(1000);
    });

    it('builds mutation options whose mutationFn forwards variables to the client', async () => {
        const { api, calls } = makeProxy();
        const options = api.users.createUser.mutationOptions();
        expect(options.mutationKey).toEqual([['users', 'createUser']]);
        const result = await options.mutationFn({ body: { name: 'Ada' } });
        expect(result).toEqual({ status: 201, body: { id: 'new' }, headers: {} });
        expect(calls).toEqual([{ path: 'users.createUser', args: { body: { name: 'Ada' } } }]);
    });

    it('exposes fuzzy path keys for whole sub-trees', () => {
        const { api } = makeProxy();
        expect(api.users.pathKey()).toEqual([['users']]);
        expect(api.pathKey()).toEqual([[]]);
    });

    it('builds a query filter that carries the key and merges filter options', () => {
        const { api } = makeProxy();
        const filter = api.users.getUser.queryFilter({ params: { id: '1' } }, { exact: true });
        expect(filter).toEqual({
            queryKey: [['users', 'getUser'], { input: { params: { id: '1' } }, type: 'query' }],
            exact: true,
        });
    });
});
