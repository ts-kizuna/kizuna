import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADAPTER_BEHAVIOUR, ADAPTER_FEATURES, featureGroups, featuresInGroup, type AdapterFeature, type AdapterName } from './features.js';
import {
    adminToken,
    badgeBytes,
    brokenContract,
    createBrokenRouter,
    createIssueRouter,
    createMethodRouter,
    createResponseShapeRouter,
    createSecuredRouter,
    createSubUserRouter,
    createUserRouter,
    csvBody,
    issueContract,
    methodContract,
    ownerToken,
    responseShapeContract,
    securedContract,
    securedGuards,
    sessionAuthorization,
    subUserContract,
    userContract,
} from './fixtures.js';
import { toMountedApi, type MountedApi, type Transport, type TestResponse } from './transport.js';

/**
 * One adapter, described by its parts. The `never` parameters are what let a contract known only at runtime reach a
 * fully typed builder, so those casts stay here instead of in every adapter's test file.
 */
export interface AdapterUnderTest<Api> {
    name: AdapterName;
    /**
     * @example
     * createServerApi: (contract, options) => createServer(contract).server.api(options)
     */
    createServerApi: (contract: never, options: never) => Api;
    mount: (api: Api, options: { responseValidation?: boolean }) => Transport | Promise<Transport>;
}

interface MountOptions {
    contract: unknown;
    router: unknown;
    responseValidation?: boolean;
    guards?: Record<string, unknown>;
}

export const testAdapterFeatures = <Api>(adapter: AdapterUnderTest<Api>): void => {
    const behaviour = ADAPTER_BEHAVIOUR[adapter.name];

    const mount = async (options: MountOptions): Promise<MountedApi> => {
        const api = adapter.createServerApi(
            options.contract as never,
            {
                router: options.router,
                guards: options.guards,
            } as never
        );
        const transport = await adapter.mount(api, {
            responseValidation: options.responseValidation,
        });
        return toMountedApi(transport);
    };

    const using = async <T>(options: MountOptions, use: (mounted: MountedApi) => Promise<T>): Promise<T> => {
        const mounted = await mount(options);
        try {
            return await use(mounted);
        } finally {
            await mounted.close?.();
        }
    };

    const usingSecured = <T>(use: (mounted: MountedApi) => Promise<T>) =>
        using(
            {
                contract: securedContract,
                router: createSecuredRouter(),
                guards: securedGuards,
            },
            use
        );

    const usingMethods = <T>(use: (mounted: MountedApi) => Promise<T>) =>
        using(
            {
                contract: methodContract,
                router: createMethodRouter(),
            },
            use
        );

    const usingShapes = <T>(use: (mounted: MountedApi) => Promise<T>) =>
        using(
            {
                contract: responseShapeContract,
                router: createResponseShapeRouter(),
            },
            use
        );

    const postProfile = (body: unknown) =>
        using(
            {
                contract: issueContract,
                router: createIssueRouter(),
            },
            (issues) =>
                issues.request({
                    method: 'POST',
                    path: '/profiles',
                    body,
                })
        );

    const issueCodes = (response: TestResponse) =>
        ((response.body as { errors?: Array<{ code: string }> }).errors ?? []).map((issue) => issue.code);

    let api: MountedApi;

    beforeEach(async () => {
        api = await mount({
            contract: userContract,
            router: createUserRouter(),
        });
    });

    afterEach(async () => {
        await api.close?.();
    });

    const createAda = () =>
        api.request({
            method: 'POST',
            path: '/users',
            body: {
                name: 'Ada',
                email: 'ada@example.com',
            },
        });

    const tests: Record<AdapterFeature, () => Promise<void>> = {
        'routing.pathParams': async () => {
            await createAda();
            const response = await api.request({
                method: 'GET',
                path: '/users/1',
            });
            expect(response.status).toBe(200);
            expect(response.body).toEqual({
                id: '1',
                name: 'Ada',
            });
        },

        'routing.methodDispatch': async () => {
            await createAda();
            const deleted = await api.request({
                method: 'DELETE',
                path: '/users/1',
            });
            expect(deleted.status).toBe(200);
            expect(deleted.body).toEqual({
                success: true,
            });

            const response = await api.request({
                method: 'GET',
                path: '/users/1',
            });
            expect(response.status).toBe(404);
        },

        'routing.methodMismatch': async () => {
            const response = await api.request({
                method: 'PUT',
                path: '/users/1',
                body: {
                    name: 'Ada',
                },
            });
            expect(response.status).toBe(behaviour.methodMismatchStatus);
        },

        'routing.notFound': async () => {
            const response = await api.request({
                method: 'GET',
                path: '/not-a-declared-route',
            });
            expect(response.status).toBe(404);
        },

        'routing.subRouterComposition': async () => {
            await using(
                {
                    contract: subUserContract,
                    router: createSubUserRouter(),
                },
                async (composed) => {
                    const response = await composed.request({
                        method: 'GET',
                        path: '/sub-users/42',
                    });
                    expect(response.status).toBe(200);
                    expect(response.body).toEqual({
                        id: '42',
                    });
                }
            );
        },

        'routing.allMethods': async () => {
            await usingMethods(async (methods) => {
                for (const [method, path] of [
                    ['GET', '/items/1'],
                    ['POST', '/items'],
                    ['PUT', '/items/1'],
                    ['PATCH', '/items/1'],
                    ['DELETE', '/items/1'],
                    ['OPTIONS', '/items/1'],
                ] as const) {
                    const response = await methods.request({
                        method,
                        path,
                    });
                    expect(response.status, `${method} ${path}`).toBe(200);
                    expect(response.body, `${method} ${path}`).toEqual({
                        method,
                    });
                }
            });
        },

        'routing.headStripsBody': async () => {
            await usingMethods(async (methods) => {
                const response = await methods.request({
                    method: 'HEAD',
                    path: '/items/1',
                });
                expect(response.status).toBe(200);
                expect(response.text).toBe('');
            });
        },

        'routing.optionsAllow': async () => {
            await usingMethods(async (methods) => {
                const response = await methods.request({
                    method: 'OPTIONS',
                    path: '/items/1',
                });
                expect(response.status).toBe(200);
                const allow = response.headers.get('allow') ?? '';
                for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
                    expect(allow, `Allow: ${allow}`).toContain(method);
                }
            });
        },

        'query.defaults': async () => {
            const response = await api.request({
                method: 'GET',
                path: '/users',
            });
            expect(response.status).toBe(200);
            expect(response.body).toEqual({
                users: [],
                total: 0,
            });
        },

        'query.coercion': async () => {
            await createAda();
            await api.request({
                method: 'POST',
                path: '/users',
                body: {
                    name: 'Grace',
                    email: 'grace@example.com',
                },
            });
            const response = await api.request({
                method: 'GET',
                path: '/users?page=2&limit=1',
            });
            expect(response.status).toBe(200);
            expect(response.body).toEqual({
                users: [
                    {
                        id: '2',
                        name: 'Grace',
                    },
                ],
                total: 2,
            });
        },

        'body.json': async () => {
            const response = await createAda();
            expect(response.status).toBe(201);
            expect(response.body).toEqual({
                id: '1',
                name: 'Ada',
                email: 'ada@example.com',
            });
        },

        'body.invalid400': async () => {
            const response = await api.request({
                method: 'POST',
                path: '/users',
                body: {
                    name: '',
                    email: 'not-an-email',
                },
            });
            expect(response.status).toBe(400);
        },

        'body.optionalFields': async () => {
            const required = {
                name: 'Ada',
                age: 36,
                tags: ['a'],
                slug: 'ada',
            };

            const withoutOptional = await postProfile(required);
            expect(withoutOptional.status).toBe(201);

            const withOptional = await postProfile({
                ...required,
                nickname: 'Addy',
            });
            expect(withOptional.status).toBe(201);

            const wrongType = await postProfile({
                ...required,
                nickname: 123,
            });
            expect(wrongType.status).toBe(400);
        },

        'errors.declaredProblemDetails': async () => {
            const response = await api.request({
                method: 'GET',
                path: '/users/missing',
            });
            expect(response.status).toBe(404);
            expect(response.headers.get('content-type')).toContain('application/problem+json');
            expect(response.body).toMatchObject({
                status: 404,
                detail: 'Not found',
            });
        },

        'errors.unsupportedMediaType415': async () => {
            const response = await api.request({
                method: 'POST',
                path: '/users',
                body: '<user />',
                headers: {
                    'content-type': 'application/xml',
                },
            });
            expect(response.status).toBe(415);
        },

        'errors.notAcceptable406': async () => {
            const response = await api.request({
                method: 'GET',
                path: '/users',
                headers: {
                    accept: 'text/html',
                },
            });
            expect(response.status).toBe(406);
        },

        'errors.validationProblemDetails': async () => {
            await usingShapes(async (shapes) => {
                const response = await shapes.request({
                    method: 'POST',
                    path: '/validated',
                    body: {
                        name: '',
                    },
                });
                expect(response.status).toBe(400);
                expect(response.headers.get('content-type')).toContain('application/problem+json');
                const problem = response.body as { detail?: string; errors?: unknown };
                expect(problem.detail).toBeDefined();
                expect(Array.isArray(problem.errors)).toBe(true);
            });
        },

        'errors.validationIssueCodes': async () => {
            const valid = {
                name: 'Ada',
                age: 36,
                tags: ['a'],
                slug: 'ada',
            };

            const missing = await postProfile({
                age: 36,
                tags: [],
                slug: 'ada',
            });
            expect(missing.status).toBe(400);
            expect(issueCodes(missing)).toContain('invalid_type');

            const tooSmall = await postProfile({
                ...valid,
                name: '',
            });
            expect(issueCodes(tooSmall)).toContain('too_small');

            const tooBig = await postProfile({
                ...valid,
                age: 999,
            });
            expect(issueCodes(tooBig)).toContain('too_big');

            const tooManyTags = await postProfile({
                ...valid,
                tags: ['a', 'b', 'c'],
            });
            expect(issueCodes(tooManyTags)).toContain('too_big');

            const fieldRefine = await postProfile({
                ...valid,
                slug: 'has space',
            });
            expect(issueCodes(fieldRefine)).toContain('custom');

            const topLevelRefine = await postProfile({
                ...valid,
                name: 'same',
                slug: 'same',
            });
            expect(issueCodes(topLevelRefine)).toContain('custom');

            const shape = await postProfile({
                ...valid,
                name: '',
            });
            for (const issue of (shape.body as { errors: Array<Record<string, unknown>> }).errors) {
                expect(Object.keys(issue).sort()).toEqual(['code', 'message', 'path']);
            }
        },

        'guards.publicRoute': async () => {
            await usingSecured(async (secured) => {
                const response = await secured.request({
                    method: 'GET',
                    path: '/public',
                });
                expect(response.status).toBe(200);
                expect(response.body).toEqual({
                    ok: true,
                });
            });
        },

        'guards.denied': async () => {
            await usingSecured(async (secured) => {
                const response = await secured.request({
                    method: 'GET',
                    path: '/who-am-i',
                });
                expect(response.status).toBe(401);
            });
        },

        'guards.context': async () => {
            await usingSecured(async (secured) => {
                const response = await secured.request({
                    method: 'GET',
                    path: '/who-am-i',
                    headers: {
                        authorization: sessionAuthorization,
                    },
                });
                expect(response.status).toBe(200);
                expect(response.body).toEqual({
                    userId: '1',
                });
            });
        },

        'guards.accessGate': async () => {
            await usingSecured(async (secured) => {
                const rejected = await secured.request({
                    method: 'GET',
                    path: '/owner-only',
                    headers: {
                        'x-workspace-token': adminToken,
                    },
                });
                expect(rejected.status).toBe(403);

                const allowed = await secured.request({
                    method: 'GET',
                    path: '/owner-only',
                    headers: {
                        'x-workspace-token': ownerToken,
                    },
                });
                expect(allowed.status).toBe(200);
            });
        },

        'guards.multiIdentity': async () => {
            await usingSecured(async (secured) => {
                const partial = await secured.request({
                    method: 'GET',
                    path: '/both',
                    headers: {
                        authorization: sessionAuthorization,
                    },
                });
                expect(partial.status).toBe(403);

                const complete = await secured.request({
                    method: 'GET',
                    path: '/both',
                    headers: {
                        authorization: sessionAuthorization,
                        'x-workspace-token': ownerToken,
                    },
                });
                expect(complete.status).toBe(200);
                expect(complete.body).toEqual({
                    userId: '1',
                    workspaceUserId: '1',
                });
            });
        },

        'responses.declaredContentType': async () => {
            await usingShapes(async (shapes) => {
                const response = await shapes.request({
                    method: 'GET',
                    path: '/items.csv',
                });
                expect(response.status).toBe(200);
                expect(response.headers.get('content-type')).toContain('text/csv');
                expect(response.text).toBe(csvBody);
            });
        },

        'responses.binary': async () => {
            await usingShapes(async (shapes) => {
                const response = await shapes.request({
                    method: 'GET',
                    path: '/badge',
                });
                expect(response.status).toBe(200);
                expect(response.headers.get('content-type')).toContain('application/octet-stream');
                expect(response.text.length).toBe(badgeBytes.length);
            });
        },

        'responses.void': async () => {
            await usingShapes(async (shapes) => {
                const response = await shapes.request({
                    method: 'DELETE',
                    path: '/items/1',
                });
                expect(response.status).toBe(204);
                expect(response.headers.get('content-type')).toBeNull();
                expect(response.text).toBe('');
            });
        },

        'responses.validation': async () => {
            await using(
                {
                    contract: brokenContract,
                    router: createBrokenRouter(),
                    responseValidation: true,
                },
                async (broken) => {
                    const response = await broken.request({
                        method: 'GET',
                        path: '/broken',
                    });
                    expect(response.status).toBe(500);
                }
            );
        },
    };

    describe(adapter.name, () => {
        for (const group of featureGroups()) {
            describe(group, () => {
                for (const name of featuresInGroup(group)) {
                    it(`${name} — ${ADAPTER_FEATURES[name].summary}`, tests[name]);
                }
            });
        }

        it('covers every adapter feature', () => {
            expect(Object.keys(tests).sort()).toEqual(Object.keys(ADAPTER_FEATURES).sort());
        });
    });
};
