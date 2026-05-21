import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createContract } from '@ts-kizuna/core';
import { generateSwiftClient } from './generator.js';
import { contract as deprecatedContract } from '../../core/src/deprecation.fixture.js';

const baseConfig = {
    namespaceName: 'TestAPI',
};

describe('Swift generator — z.void()', () => {
    it('emits no body param and Void return for z.void() body and response', () => {
        const contract = createContract({
            ping: {
                method: 'POST',
                path: '/ping/:id',
                body: z.void(),
                responses: {
                    204: z.void(),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('func ping(id: String) async throws(TestAPIClient.Ping.Failure)');
        expect(output).not.toContain('body: ');
    });
});

describe('Swift generator — z.union()', () => {
    it('resolves one-or-many union (array | single.transform) to array type', () => {
        const contract = createContract({
            getByIds: {
                method: 'GET',
                path: '/items',
                query: z.object({
                    ids: z.union([
                        z.array(z.string().uuid()).min(1).max(20),
                        z
                            .string()
                            .uuid()
                            .transform((id) => [id]),
                    ]),
                }),
                responses: {
                    200: z.object({
                        ok: z.boolean(),
                    }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('ids: [String]');
        expect(output).not.toContain('AnyCodable');
    });

    it('resolves union where all branches have the same type', () => {
        const contract = createContract({
            search: {
                method: 'GET',
                path: '/search',
                query: z.object({
                    tag: z.union([z.string(), z.string()]),
                }),
                responses: {
                    200: z.object({
                        ok: z.boolean(),
                    }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('tag: String');
        expect(output).not.toContain('AnyCodable');
    });
});

describe('Swift generator — z.iso.datetime()', () => {
    it('maps z.iso.datetime() to Swift Date, not String', () => {
        const contract = createContract({
            listEvents: {
                method: 'GET',
                path: '/events',
                responses: {
                    200: z.object({
                        occurredAt: z.iso.datetime(),
                    }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('let occurredAt: Date');
        expect(output).not.toContain('let occurredAt: String');
    });

    it('maps z.string().datetime() to Swift Date (legacy style)', () => {
        const contract = createContract({
            listEvents: {
                method: 'GET',
                path: '/events',
                responses: {
                    200: z.object({
                        occurredAt: z.string().datetime(),
                    }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('let occurredAt: Date');
        expect(output).not.toContain('let occurredAt: String');
    });

    it('encodes Date with fractional-seconds ISO8601 in the generated client', () => {
        const contract = createContract({
            createEvent: {
                method: 'POST',
                path: '/events',
                body: z.object({
                    occurredAt: z.iso.datetime(),
                }),
                responses: {
                    201: z.object({ ok: z.boolean() }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('Kizuna.makeJSONEncoder()');
    });
});

describe('Swift generator — z.pipe() and z.string().transform()', () => {
    it('resolves z.string().pipe(z.coerce.number()) to Double', () => {
        const contract = createContract({
            search: {
                method: 'GET',
                path: '/search',
                query: z.object({
                    limit: z.string().pipe(z.coerce.number()),
                }),
                responses: {
                    200: z.object({
                        total: z.number(),
                    }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('limit: Double');
        expect(output).not.toContain('AnyCodable');
    });

    it('resolves z.string().transform() to String (input type)', () => {
        const contract = createContract({
            list: {
                method: 'GET',
                path: '/list',
                query: z.object({
                    label: z.string().transform((value) => value.trim()),
                }),
                responses: {
                    200: z.object({
                        ok: z.boolean(),
                    }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('label: String');
        expect(output).not.toContain('AnyCodable');
    });
});

describe('Swift generator — namespace wrapper', () => {
    it('wraps all types in a public enum named after config.name', () => {
        const contract = createContract({
            getUser: {
                method: 'GET',
                path: '/users/:id',
                responses: {
                    200: z.object({ id: z.string() }).meta({ id: 'Error' }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('public enum TestAPI {');
        expect(output).toContain('    public struct Error:');
        expect(output).toContain('public actor TestAPIClient');
    });

    it('uses Swift.Error and Foundation.Data inside the namespace to avoid shadowing', () => {
        const contract = createContract({
            getUser: {
                method: 'GET',
                path: '/users/:id',
                responses: {
                    200: z.object({ id: z.string() }),
                    404: z.object({ message: z.string() }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('Swift.Error');
        expect(output).toContain('Foundation.Data');
        expect(output).not.toMatch(/:\s*Error,/);
        expect(output).not.toMatch(/\(Error\)/);
    });
});

describe('Swift generator — keyword property CodingKeys', () => {
    it('emits explicit CodingKeys when a field name is a Swift keyword', () => {
        const contract = createContract({
            createUser: {
                method: 'POST',
                path: '/users',
                body: z.object({
                    default: z.string(),
                    name: z.string(),
                }),
                responses: {
                    200: z.object({ ok: z.boolean() }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('public let `default`: String');
        expect(output).toContain('private enum CodingKeys');
        expect(output).toContain('case `default`');
    });
});

describe('Swift generator — Void error responses', () => {
    it('emits a bare enum case and a direct throw for a Void error status', () => {
        const contract = createContract({
            getUser: {
                method: 'GET',
                path: '/users/:id',
                responses: {
                    200: z.object({ name: z.string() }),
                    401: z.void(),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('case unauthorized\n');
        expect(output).not.toContain('case unauthorized(Void)');
        expect(output).toContain('throw TestAPIClient.GetUser.Failure.unauthorized');
        expect(output).not.toContain('decoder.decode(Void.self');
    });
});

describe('Swift generator — z.int() maps to Int', () => {
    it('maps z.int() to Swift Int, not Double', () => {
        const contract = createContract({
            getStats: {
                method: 'GET',
                path: '/stats',
                responses: {
                    200: z.object({
                        count: z.int(),
                        ratio: z.number(),
                    }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('let count: Int');
        expect(output).toContain('let ratio: Double');
    });
});

describe('Swift generator — doc comments on auto-named types', () => {
    it('emits a /// doc comment for an auto-named struct with a description', () => {
        const contract = createContract({
            healthCheck: {
                method: 'GET',
                path: '/health',
                responses: {
                    200: z.object({ ok: z.boolean() }).meta({ description: 'Health check response' }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('/// Health check response');
    });
});

describe('Swift generator — array type qualification', () => {
    it('array response type is placed inside Result body field with correct syntax', () => {
        const contract = createContract({
            listItems: {
                method: 'GET',
                path: '/items',
                responses: {
                    200: z.array(z.object({ id: z.string() })),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        // return type is always Result — the array is the body, not the return type
        expect(output).toContain('-> TestAPIClient.ListItems.Result');
        // body field uses the short operation-local name inside the enum scope
        expect(output).toContain('public let body: [ResponseItem]');
        expect(output).not.toMatch(/public let body: TestAPIClient\.\[/);
    });

    it('array response type in sub-client is placed inside Result body field with correct syntax', () => {
        const contract = createContract({
            items: createContract({
                list: {
                    method: 'GET',
                    path: '/items',
                    responses: {
                        200: z.array(z.object({ id: z.string() })),
                    },
                },
            }),
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('-> TestAPIClient.ItemsList.Result');
        expect(output).toContain('public let body: [ResponseItem]');
        expect(output).not.toMatch(/public let body: TestAPIClient\.\[/);
    });

    it('qualifies array element types in sub-client method parameters', () => {
        const contract = createContract({
            items: createContract({
                bulkCreate: {
                    method: 'POST',
                    path: '/items',
                    body: z.object({
                        tags: z.array(z.string()),
                    }),
                    responses: {
                        200: z.object({ ok: z.boolean() }),
                    },
                },
            }),
        });
        const output = generateSwiftClient(contract, baseConfig);
        // [String] is a primitive array — no namespace needed
        expect(output).toContain('tags: [String]');
        expect(output).not.toContain('TestAPI.[String]');
    });

    it('qualifies array of user-defined types in query params', () => {
        const contract = createContract({
            items: createContract({
                list: {
                    method: 'GET',
                    path: '/items',
                    query: z.object({
                        kinds: z.array(z.enum(['a', 'b'])),
                    }),
                    responses: {
                        200: z.object({ ok: z.boolean() }),
                    },
                },
            }),
        });
        const output = generateSwiftClient(contract, baseConfig);
        // operation-local enum in query param: bracket before client qualifier
        expect(output).toContain('[TestAPIClient.');
        expect(output).not.toMatch(/TestAPIClient\.\[/);
    });
});

describe('Swift generator — nested sub-client routing', () => {
    it('emits a Sendable sub-client struct for a grouped router key', () => {
        const contract = createContract({
            users: createContract({
                getById: {
                    method: 'GET',
                    path: '/users/:id',
                    responses: {
                        200: z.object({ id: z.string() }),
                    },
                },
            }),
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('public struct TestAPIUsersClient: Sendable');
        expect(output).toContain('private let _actor: TestAPIClient');
        expect(output).toContain('public var users: TestAPIUsersClient');
    });

    it('uses the leaf method name for grouped routes, not the full joined name', () => {
        const contract = createContract({
            users: createContract({
                getById: {
                    method: 'GET',
                    path: '/users/:id',
                    responses: {
                        200: z.object({ id: z.string() }),
                    },
                },
            }),
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('public func getById(id: String)');
        expect(output).not.toContain('public func usersGetById');
    });

    it('uses the full joined name for type naming to avoid collisions across groups', () => {
        const contract = createContract({
            users: createContract({
                getById: {
                    method: 'GET',
                    path: '/users/:id',
                    responses: {
                        200: z.object({ id: z.string() }),
                    },
                },
            }),
            posts: createContract({
                getById: {
                    method: 'GET',
                    path: '/posts/:id',
                    responses: {
                        200: z.object({ id: z.string() }),
                    },
                },
            }),
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('TestAPIClient.UsersGetById.Failure');
        expect(output).toContain('TestAPIClient.PostsGetById.Failure');
    });

    it('injects _kizunaContext() into sub-client methods and accesses actor state', () => {
        const contract = createContract({
            health: createContract({
                check: {
                    method: 'GET',
                    path: '/health',
                    responses: {
                        200: z.object({ ok: z.boolean() }),
                    },
                },
                publish: {
                    method: 'POST',
                    path: '/health/publish',
                    body: z.object({ note: z.string() }),
                    responses: {
                        200: z.object({ ok: z.boolean() }),
                    },
                },
            }),
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('func _kizunaContext()');
        // GET method (no body) uses _ for the unused encoder slot
        expect(output).toContain(
            'let (baseURL, session, _, decoder, requestMiddleware, responseMiddleware) = await _actor._kizunaContext()'
        );
        // POST method (has body) uses encoder
        expect(output).toContain(
            'let (baseURL, session, encoder, decoder, requestMiddleware, responseMiddleware) = await _actor._kizunaContext()'
        );
    });

    it('keeps flat routes directly on the actor when mixed with grouped routes', () => {
        const contract = createContract({
            ping: {
                method: 'GET',
                path: '/ping',
                responses: {
                    200: z.object({ ok: z.boolean() }),
                },
            },
            health: createContract({
                check: {
                    method: 'GET',
                    path: '/health',
                    responses: {
                        200: z.object({ ok: z.boolean() }),
                    },
                },
            }),
        });
        const output = generateSwiftClient(contract, baseConfig);
        // flat route still on actor
        expect(output).toContain('public func ping()');
        // grouped route on sub-client struct
        expect(output).toContain('public struct TestAPIHealthClient: Sendable');
        expect(output).toContain('public func check()');
    });
});

describe('Swift generator — responseHeaders', () => {
    it('emits a Result wrapper struct and changes the return type when response headers are declared', () => {
        const contract = createContract({
            getUser: {
                method: 'GET',
                path: '/users/:id',
                responses: {
                    200: {
                        body: z.object({ id: z.string() }),
                        headers: z.object({
                            'x-request-id': z.string().optional(),
                        }),
                    },
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('public struct Result: Sendable');
        expect(output).toContain('public let body:');
        expect(output).toContain('public let headers: Headers');
        expect(output).toContain('public struct Headers: Sendable');
        expect(output).toContain('public let xRequestId: String?');
        expect(output).toContain('-> TestAPIClient.GetUser.Result');
        expect(output).not.toContain('-> TestAPIClient.GetUser200');
    });

    it('reads the header from HTTPURLResponse and passes it to the Result init', () => {
        const contract = createContract({
            getUser: {
                method: 'GET',
                path: '/users/:id',
                responses: {
                    200: {
                        body: z.object({ id: z.string() }),
                        headers: z.object({
                            'x-request-id': z.string().optional(),
                        }),
                    },
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('let httpResponse = response as? HTTPURLResponse');
        expect(output).toContain('httpResponse?.value(forHTTPHeaderField: "x-request-id")');
        expect(output).toContain('return TestAPIClient.GetUser.Result(body: body, headers: .init(xRequestId: xRequestId))');
    });

    it('routes without responseHeaders emit Result with body only — no headers property', () => {
        const contract = createContract({
            ping: {
                method: 'GET',
                path: '/ping',
                responses: {
                    200: z.object({ ok: z.boolean() }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('public struct Result: Sendable');
        expect(output).toContain('public let body:');
        expect(output).not.toContain('public let headers: Headers');
        expect(output).not.toContain('httpResponse');
        expect(output).toContain('let statusCode = (response as? HTTPURLResponse)?.statusCode ?? -1');
        expect(output).toContain('return TestAPIClient.Ping.Result(body: body)');
    });
});

describe('Swift generator — owned type nesting', () => {
    it('nests a string enum inside its owning struct and removes it from top level', () => {
        const contract = createContract({
            getVideo: {
                method: 'GET',
                path: '/videos/:id',
                responses: {
                    200: z
                        .object({
                            id: z.string(),
                            status: z.enum(['encoding', 'encoded', 'failed']),
                        })
                        .meta({ id: 'Video' }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('public struct Video');
        expect(output).toContain('public enum Status: String, Codable, Sendable');
        expect(output).toContain('let status: Status');
        expect(output).not.toContain('public enum VideoStatus');
    });

    it('nests an inline object inside its parent struct', () => {
        const contract = createContract({
            getPage: {
                method: 'GET',
                path: '/pages/:id',
                responses: {
                    200: z
                        .object({
                            id: z.string(),
                            images: z.object({
                                portrait: z.string(),
                                landscape: z.string().optional(),
                            }),
                        })
                        .meta({ id: 'Page' }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('public struct Page');
        expect(output).toContain('public struct Images');
        expect(output).toContain('let images: Images');
        expect(output).not.toContain('public struct PageImages');
    });

    it('does not nest an inline object that has its own meta.id', () => {
        const Image = z
            .object({
                url: z.string(),
                width: z.number().int(),
            })
            .meta({ id: 'Image' });
        const contract = createContract({
            getPage: {
                method: 'GET',
                path: '/pages/:id',
                responses: {
                    200: z
                        .object({
                            id: z.string(),
                            image: Image,
                        })
                        .meta({ id: 'Page' }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('public struct Page');
        expect(output).toContain('public struct Image');
        expect(output).toContain('let image: Image');
        // Image is top-level, not nested inside Page
        const pageBlock = output.slice(output.indexOf('public struct Page'));
        const imageStructInPage = pageBlock.indexOf('public struct Image');
        const pageBlockEnd = pageBlock.indexOf('\n    }');
        expect(imageStructInPage === -1 || imageStructInPage > pageBlockEnd).toBe(true);
    });

    it('handles deeply nested inline objects', () => {
        const contract = createContract({
            getPage: {
                method: 'GET',
                path: '/pages/:id',
                responses: {
                    200: z
                        .object({
                            settings: z.object({
                                theme: z.object({
                                    color: z.string(),
                                }),
                            }),
                        })
                        .meta({ id: 'Page' }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).not.toContain('public struct PageSettings');
        expect(output).not.toContain('public struct PageSettingsTheme');
        expect(output).toContain('public struct Settings');
        expect(output).toContain('public struct Theme');
    });
});

describe('Swift generator — @available(*, deprecated)', () => {
    const fixturePath = path.resolve(import.meta.dirname, '../../core/src/deprecation.fixture.ts');
    const config = { ...baseConfig, deprecationWarnings: { contractPath: fixturePath } };

    it('emits @available(*, deprecated) on a deprecated route method', () => {
        const output = generateSwiftClient({ getUserById: deprecatedContract.getUserById }, config);
        expect(output).toContain('@available(*, deprecated)');
        expect(output).toContain('func getUserById');
    });

    it('does not include message: on a bare @deprecated route', () => {
        const output = generateSwiftClient({ getUserById: deprecatedContract.getUserById }, config);
        expect(output).not.toContain('@available(*, deprecated, message:');
    });

    it('emits @available(*, deprecated, message:) on a deprecated route with a message', () => {
        const output = generateSwiftClient({ oldRoute: deprecatedContract.oldRoute }, config);
        expect(output).toContain('@available(*, deprecated, message: "use newRoute instead")');
        expect(output).toContain('func oldRoute');
    });

    it('emits @available(*, deprecated) on a deprecated field in a response struct', () => {
        const output = generateSwiftClient({ getUser: deprecatedContract.getUser }, config);
        expect(output).toContain('@available(*, deprecated)');
        expect(output).toContain('let email: String');
    });

    it('does not include message: on a bare @deprecated field', () => {
        const output = generateSwiftClient({ getUser: deprecatedContract.getUser }, config);
        expect(output).not.toContain('@available(*, deprecated, message:');
    });

    it('emits @available(*, deprecated, message:) on a deprecated field with a message', () => {
        const output = generateSwiftClient({ getUserByIdV2: deprecatedContract.getUserByIdV2 }, config);
        expect(output).toContain('@available(*, deprecated, message: "use email_address instead")');
        expect(output).toContain('let email: String');
    });
});

describe('Swift generator — HEAD method', () => {
    it('generates Void return type and no body decoding regardless of the response schema', () => {
        const contract = createContract({
            checkUser: {
                method: 'HEAD',
                path: '/users/:id',
                responses: {
                    200: z.object({
                        id: z.string(),
                        name: z.string(),
                    }),
                    404: z.void(),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('func checkUser(id: String) async throws(TestAPIClient.CheckUser.Failure)');
        expect(output).not.toContain('decoder.decode(');
        expect(output).not.toContain('Result(body:');
    });

    it('generates OPTIONS method with normal body decoding', () => {
        const contract = createContract({
            describeUsers: {
                method: 'OPTIONS',
                path: '/users',
                responses: {
                    200: z.object({
                        allow: z.string(),
                    }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('func describeUsers() async throws(TestAPIClient.DescribeUsers.Failure)');
        expect(output).toContain('decoder.decode(');
    });
});

describe('Swift generator — automatic validation error', () => {
    it('adds badRequest case for route with body', () => {
        const contract = createContract({
            createUser: {
                method: 'POST',
                path: '/users',
                body: z.object({
                    name: z.string(),
                }),
                responses: {
                    201: z.object({
                        id: z.string(),
                    }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('case badRequest(TestAPIClient.ValidationError)');
        expect(output).toContain('struct ValidationError');
        expect(output).toContain('struct ValidationIssue');
    });

    it('does not add validation case for route without body or query', () => {
        const contract = createContract({
            getUser: {
                method: 'GET',
                path: '/users/:id',
                responses: {
                    200: z.object({
                        id: z.string(),
                    }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).not.toContain('ValidationError');
        expect(output).not.toContain('ValidationIssue');
    });

    it('uses validationError case when route also declares 400', () => {
        const contract = createContract({
            createUser: {
                method: 'POST',
                path: '/users',
                body: z.object({
                    name: z.string(),
                }),
                responses: {
                    201: z.object({
                        id: z.string(),
                    }),
                    400: z.object({
                        message: z.string(),
                    }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('case badRequest(Response400)');
        expect(output).toContain('case validationError(TestAPIClient.ValidationError)');
    });

    it('groups duplicate status codes into a single switch case', () => {
        const contract = createContract({
            createUser: {
                method: 'POST',
                path: '/users',
                body: z.object({
                    name: z.string(),
                }),
                responses: {
                    201: z.object({
                        id: z.string(),
                    }),
                    400: z.object({
                        message: z.string(),
                    }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        const matches = output.match(/case 400:/g);
        expect(matches).toHaveLength(1);
    });

    it('re-throws Failure in grouped case to prevent swallowing decoded errors', () => {
        const contract = createContract({
            createUser: {
                method: 'POST',
                path: '/users',
                body: z.object({
                    name: z.string(),
                }),
                responses: {
                    201: z.object({
                        id: z.string(),
                    }),
                    400: z.object({
                        message: z.string(),
                    }),
                },
            },
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('catch let error as TestAPIClient.CreateUser.Failure');
    });
});
