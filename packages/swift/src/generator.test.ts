import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import { kizuna, createTags, createModel, createRequestContext, type Contract } from '@ts-kizuna/core';
import { writeKizunaDeprecations } from '../../cli/src/deprecation-parser.js';
import { generateSwiftClient } from './generator.js';
import { contract as deprecatedContract } from '../../cli/src/deprecation.fixture.js';

const { k } = kizuna({
    tags: createTags({
        api: 'API',
    }),
});

const baseConfig = {
    namespaceName: 'TestAPI',
};

describe('Swift generator — z.void()', () => {
    it('emits no body param and Void return for z.void() body and response', () => {
        const contractRoutes = k.routes('api', {
            ping: {
                method: 'POST',
                path: '/ping/:id',
                body: z.void(),
                responses: {
                    204: z.void(),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('func ping(_ params: TestAPIClient.Ping.Params) async throws(TestAPIClient.Ping.Failure)');
        // single path param → a Params struct + group-named `.params(id:)` factory, called as `.params(id: ...)`
        expect(output).toContain('public static func params(id: String) -> Self');
        expect(output).not.toContain('_ body: ');
    });
});

describe('Swift generator — z.union()', () => {
    it('resolves one-or-many union (array | single.transform) to array type', () => {
        const contractRoutes = k.routes('api', {
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

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('ids: [String]');
        expect(output).not.toContain('AnyCodable');
    });

    it('resolves union where all branches have the same type', () => {
        const contractRoutes = k.routes('api', {
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

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('tag: String');
        expect(output).not.toContain('AnyCodable');
    });
});

describe('Swift generator — z.iso.datetime()', () => {
    it('maps z.iso.datetime() to Swift Date, not String', () => {
        const contractRoutes = k.routes('api', {
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

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('let occurredAt: Date');
        expect(output).not.toContain('let occurredAt: String');
    });

    it('maps z.string().datetime() to Swift Date (legacy style)', () => {
        const contractRoutes = k.routes('api', {
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

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('let occurredAt: Date');
        expect(output).not.toContain('let occurredAt: String');
    });

    it('encodes Date with fractional-seconds ISO8601 in the generated client', () => {
        const contractRoutes = k.routes('api', {
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

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('Kizuna.makeJSONEncoder()');
    });
});

describe('Swift generator — z.pipe() and z.string().transform()', () => {
    it('resolves a string→number pipe (transform().pipe(z.number())) to Double', () => {
        const contractRoutes = k.routes('api', {
            search: {
                method: 'GET',
                path: '/search',
                query: z.object({
                    limit: z
                        .string()
                        .transform((value) => Number(value))
                        .pipe(z.number()),
                }),
                responses: {
                    200: z.object({
                        total: z.number(),
                    }),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('limit: Double');
        expect(output).not.toContain('AnyCodable');
    });

    it('resolves z.string().transform() to String (input type)', () => {
        const contractRoutes = k.routes('api', {
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

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('label: String');
        expect(output).not.toContain('AnyCodable');
    });
});

describe('Swift generator — namespace wrapper', () => {
    it('wraps all types in a public enum named after config.name', () => {
        const contractRoutes = k.routes('api', {
            getUser: {
                method: 'GET',
                path: '/users/:id',
                responses: {
                    200: createModel({ title: 'Error', schema: z.object({ id: z.string() }) }),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('public enum TestAPI {');
        expect(output).toContain('    public struct Error:');
        expect(output).toContain('public actor TestAPIClient');
    });

    it('uses Swift.Error and Foundation.Data inside the namespace to avoid shadowing', () => {
        const contractRoutes = k.routes('api', {
            getUser: {
                method: 'GET',
                path: '/users/:id',
                responses: {
                    200: z.object({ id: z.string() }),
                    404: z.object({ message: z.string() }),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
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
        const contractRoutes = k.routes('api', {
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

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('public let `default`: String');
        expect(output).toContain('private enum CodingKeys');
        expect(output).toContain('case `default`');
    });
});

describe('Swift generator — Void error responses', () => {
    it('emits a bare enum case and a direct throw for a Void error status', () => {
        const contractRoutes = k.routes('api', {
            getUser: {
                method: 'GET',
                path: '/users/:id',
                responses: {
                    200: z.object({ name: z.string() }),
                    401: z.void(),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('case unauthorized\n');
        expect(output).not.toContain('case unauthorized(Void)');
        expect(output).toContain('throw TestAPIClient.GetUser.Failure.unauthorized');
        expect(output).not.toContain('decoder.decode(Void.self');
    });

    it('emits a bare enum case and a payload-free return for a Void arm in a multi-status success union', () => {
        const contractRoutes = k.routes('api', {
            getMyWork: {
                method: 'GET',
                path: '/work',
                responses: {
                    200: z.object({ items: z.array(z.string()) }),
                    204: z.void(),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).not.toContain('decoder.decode(Void.self');
        expect(output).toContain('case status204');
        expect(output).not.toContain('case status204(Void)');
        expect(output).toContain('.status204');
        expect(output).not.toContain('.status204(payload)');
    });
});

describe('Swift generator — z.int() maps to Int', () => {
    it('maps z.int() to Swift Int, not Double', () => {
        const contractRoutes = k.routes('api', {
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

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('let count: Int');
        expect(output).toContain('let ratio: Double');
    });
});

describe('Swift generator — doc comments on auto-named types', () => {
    it('emits a /// doc comment for an auto-named struct with a description', () => {
        const contractRoutes = k.routes('api', {
            healthCheck: {
                method: 'GET',
                path: '/health',
                responses: {
                    200: z.object({ ok: z.boolean() }).meta({ description: 'Health check response' }),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('/// Health check response');
    });
});

describe('Swift generator — array type qualification', () => {
    it('array response type is placed inside Result body field with correct syntax', () => {
        const contractRoutes = k.routes('api', {
            listItems: {
                method: 'GET',
                path: '/items',
                responses: {
                    200: z.array(z.object({ id: z.string() })),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        // return type is always Result — the array is the body, not the return type
        expect(output).toContain('-> TestAPIClient.ListItems.Result');
        // body field uses the short operation-local name inside the enum scope
        expect(output).toContain('public let body: [ResponseItem]');
        expect(output).not.toMatch(/public let body: TestAPIClient\.\[/);
    });

    it('array response type in sub-client is placed inside Result body field with correct syntax', () => {
        const contractRoutes = k.routes('api', {
            items: {
                list: {
                    method: 'GET',
                    path: '/items',
                    responses: {
                        200: z.array(z.object({ id: z.string() })),
                    },
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('-> TestAPIClient.ItemsList.Result');
        expect(output).toContain('public let body: [ResponseItem]');
        expect(output).not.toMatch(/public let body: TestAPIClient\.\[/);
    });

    it('qualifies array element types in sub-client method parameters', () => {
        const contractRoutes = k.routes('api', {
            items: {
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
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        // [String] is a primitive array — no namespace needed
        expect(output).toContain('tags: [String]');
        expect(output).not.toContain('TestAPI.[String]');
    });

    it('qualifies array of user-defined types in query params', () => {
        const contractRoutes = k.routes('api', {
            items: {
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
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        // single-field query → a Query struct; the array element is the operation-local enum (short name).
        // The element type must be well-formed `[Enum]` with the bracket outside any qualifier.
        expect(output).toMatch(/public let kinds: \[[A-Za-z]/);
        expect(output).not.toMatch(/TestAPIClient\.\[/);
        expect(output).not.toMatch(/\w\[/); // no `Type[` — bracket never trails the element
    });
});

describe('Swift generator — nested sub-client routing', () => {
    it('emits a Sendable sub-client struct for a grouped router key', () => {
        const contractRoutes = k.routes('api', {
            users: {
                getById: {
                    method: 'GET',
                    path: '/users/:id',
                    responses: {
                        200: z.object({ id: z.string() }),
                    },
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('public struct TestAPIUsersClient: Sendable');
        expect(output).toContain('private let _actor: TestAPIClient');
        expect(output).toContain('public var users: TestAPIUsersClient');
    });

    it('uses the leaf method name for grouped routes, not the full joined name', () => {
        const contractRoutes = k.routes('api', {
            users: {
                getById: {
                    method: 'GET',
                    path: '/users/:id',
                    responses: {
                        200: z.object({ id: z.string() }),
                    },
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('public func getById(_ params: TestAPIClient.UsersGetById.Params)');
        expect(output).not.toContain('public func usersGetById');
    });

    it('uses the full joined name for type naming to avoid collisions across groups', () => {
        const contractRoutes = k.routes('api', {
            users: {
                getById: {
                    method: 'GET',
                    path: '/users/:id',
                    responses: {
                        200: z.object({ id: z.string() }),
                    },
                },
            },
            posts: {
                getById: {
                    method: 'GET',
                    path: '/posts/:id',
                    responses: {
                        200: z.object({ id: z.string() }),
                    },
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('TestAPIClient.UsersGetById.Failure');
        expect(output).toContain('TestAPIClient.PostsGetById.Failure');
    });

    it('injects _kizunaContext() into sub-client methods and accesses actor state', () => {
        const contractRoutes = k.routes('api', {
            health: {
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
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('func _kizunaContext()');
        // GET method (no body) uses _ for the unused encoder slot
        expect(output).toContain(
            'let (baseURL, session, _, decoder, requestMiddleware, responseMiddleware, timeout) = await _actor._kizunaContext()'
        );
        // POST method (has body) uses encoder
        expect(output).toContain(
            'let (baseURL, session, encoder, decoder, requestMiddleware, responseMiddleware, timeout) = await _actor._kizunaContext()'
        );
    });

    it('keeps flat routes directly on the actor when mixed with grouped routes', () => {
        const contractRoutes = k.routes('api', {
            ping: {
                method: 'GET',
                path: '/ping',
                responses: {
                    200: z.object({ ok: z.boolean() }),
                },
            },
            health: {
                check: {
                    method: 'GET',
                    path: '/health',
                    responses: {
                        200: z.object({ ok: z.boolean() }),
                    },
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
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
        const contractRoutes = k.routes('api', {
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

        const contract = k.contract({
            routes: contractRoutes,
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
        const contractRoutes = k.routes('api', {
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

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('let (data, statusCode, httpResponse) = try await Kizuna.send(&request');
        expect(output).toContain('httpResponse?.value(forHTTPHeaderField: "x-request-id")');
        expect(output).toContain('return TestAPIClient.GetUser.Result(body: body, headers: .init(xRequestId: xRequestId))');
    });

    it('routes without responseHeaders emit Result with body only — no headers property', () => {
        const contractRoutes = k.routes('api', {
            ping: {
                method: 'GET',
                path: '/ping',
                responses: {
                    200: z.object({ ok: z.boolean() }),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('public struct Result: Sendable');
        expect(output).toContain('public let body:');
        expect(output).not.toContain('public let headers: Headers');
        expect(output).not.toContain('httpResponse');
        expect(output).toContain('let (data, statusCode, _) = try await Kizuna.send(&request');
        expect(output).toContain('return TestAPIClient.Ping.Result(body: body)');
    });
});

describe('Swift generator — owned type nesting', () => {
    it('nests a string enum inside its owning struct and removes it from top level', () => {
        const contractRoutes = k.routes('api', {
            getVideo: {
                method: 'GET',
                path: '/videos/:id',
                responses: {
                    200: createModel({
                        title: 'Video',
                        schema: z.object({
                            id: z.string(),
                            status: z.enum(['encoding', 'encoded', 'failed']),
                        }),
                    }),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('public struct Video');
        expect(output).toContain('public enum Status: String, Codable, Sendable');
        expect(output).toContain('let status: Status');
        expect(output).not.toContain('public enum VideoStatus');
    });

    it('sanitizes enum values that are not valid Swift identifiers into camelCase case names', () => {
        const contractRoutes = k.routes('api', {
            getFile: {
                method: 'GET',
                path: '/files/:id',
                responses: {
                    200: createModel({
                        title: 'StoredFile',
                        schema: z.object({
                            id: z.string(),
                            contentType: z.enum(['image/jpeg', 'text-plain', 'video.mp4', '3d-model']),
                        }),
                    }),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        // sanitized case name, original value preserved as the rawValue
        expect(output).toContain('case imageJpeg = "image/jpeg"');
        expect(output).toContain('case textPlain = "text-plain"');
        expect(output).toContain('case videoMp4 = "video.mp4"');
        // leading digit gets an underscore prefix
        expect(output).toContain('case _3dModel = "3d-model"');
        // no unsanitized identifier leaks through
        expect(output).not.toContain('case image/jpeg');
        expect(output).not.toContain('case 3d');
    });

    it('leaves enum values that are already valid Swift identifiers untouched, including snake_case', () => {
        const contractRoutes = k.routes('api', {
            getOrder: {
                method: 'GET',
                path: '/orders/:id',
                responses: {
                    200: createModel({
                        title: 'Order',
                        schema: z.object({
                            id: z.string(),
                            status: z.enum(['in_progress', 'awaiting_payment', 'done']),
                        }),
                    }),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        // snake_case values are valid Swift identifiers — kept verbatim, NOT camelCased
        expect(output).toContain('case in_progress = "in_progress"');
        expect(output).toContain('case awaiting_payment = "awaiting_payment"');
        expect(output).toContain('case done = "done"');
        expect(output).not.toContain('case inProgress');
        expect(output).not.toContain('case awaitingPayment');
    });

    it('nests an inline object inside its parent struct', () => {
        const contractRoutes = k.routes('api', {
            getPage: {
                method: 'GET',
                path: '/pages/:id',
                responses: {
                    200: createModel({
                        title: 'Page',
                        schema: z.object({
                            id: z.string(),
                            images: z.object({
                                portrait: z.string(),
                                landscape: z.string().optional(),
                            }),
                        }),
                    }),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('public struct Page');
        expect(output).toContain('public struct Images');
        expect(output).toContain('let images: Images');
        expect(output).not.toContain('public struct PageImages');
    });

    it('does not nest an inline object that has its own meta.id', () => {
        const Image = createModel({
            title: 'Image',
            schema: z.object({
                url: z.string(),
                width: z.number().int(),
            }),
        });
        const contractRoutes = k.routes('api', {
            getPage: {
                method: 'GET',
                path: '/pages/:id',
                responses: {
                    200: createModel({
                        title: 'Page',
                        schema: z.object({
                            id: z.string(),
                            image: Image,
                        }),
                    }),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
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
        const contractRoutes = k.routes('api', {
            getPage: {
                method: 'GET',
                path: '/pages/:id',
                responses: {
                    200: createModel({
                        title: 'Page',
                        schema: z.object({
                            settings: z.object({
                                theme: z.object({
                                    color: z.string(),
                                }),
                            }),
                        }),
                    }),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).not.toContain('public struct PageSettings');
        expect(output).not.toContain('public struct PageSettingsTheme');
        expect(output).toContain('public struct Settings');
        expect(output).toContain('public struct Theme');
    });

    it('keeps sibling anonymous objects apart when one field name is a prefix of another (identical shapes)', () => {
        const contractRoutes = k.routes('api', {
            getOrderItem: {
                method: 'GET',
                path: '/order-items/:id',
                responses: {
                    200: createModel({
                        title: 'FittingProductOrderItem',
                        schema: z.object({
                            type: z.literal('fittingItem'),
                            image: z
                                .object({
                                    id: z.string(),
                                    url: z.string(),
                                })
                                .nullable()
                                .optional(),
                            images: z
                                .array(
                                    z.object({
                                        id: z.string(),
                                        url: z.string(),
                                    })
                                )
                                .optional(),
                        }),
                    }),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        // `ImagesItem` must nest under the parent, not get claimed by `Image` as `sItem`
        expect(output).toContain('public struct Image');
        expect(output).toContain('public struct ImagesItem');
        expect(output).toContain('let images: [ImagesItem]?');
        expect(output).not.toContain('struct sItem');
        expect(output).not.toContain('FittingProductOrderItemImagesItem');
    });
});

describe('Swift generator — @available(*, deprecated)', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kizuna-swift-'));
    const previousCwd = process.cwd();
    const fixturePath = path.resolve(import.meta.dirname, '../../cli/src/deprecation.fixture.ts');

    beforeAll(() => {
        process.chdir(workDir);
    });

    afterAll(() => {
        process.chdir(previousCwd);
    });

    const generate = (routes: Contract['routes']): string => {
        const contract = { routes } as Contract;
        writeKizunaDeprecations([{ contract, contractPath: fixturePath }], path.join(workDir, '.kizuna'));
        return generateSwiftClient(contract, baseConfig);
    };

    it('emits @available(*, deprecated) on a deprecated route method', () => {
        const output = generate({ getUserById: deprecatedContract.routes.getUserById });
        expect(output).toContain('@available(*, deprecated)');
        expect(output).toContain('func getUserById');
    });

    it('does not include message: on a bare @deprecated route', () => {
        const output = generate({ getUserById: deprecatedContract.routes.getUserById });
        expect(output).not.toContain('@available(*, deprecated, message:');
    });

    it('emits @available(*, deprecated, message:) on a deprecated route with a message', () => {
        const output = generate({ oldRoute: deprecatedContract.routes.oldRoute });
        expect(output).toContain('@available(*, deprecated, message: "use newRoute instead")');
        expect(output).toContain('func oldRoute');
    });

    it('emits @available(*, deprecated) on a deprecated field in a response struct', () => {
        const output = generate({ getUser: deprecatedContract.routes.getUser });
        expect(output).toContain('@available(*, deprecated)');
        expect(output).toContain('let email: String');
    });

    it('does not include message: on a bare @deprecated field', () => {
        const output = generate({ getUser: deprecatedContract.routes.getUser });
        expect(output).not.toContain('@available(*, deprecated, message:');
    });

    it('emits @available(*, deprecated, message:) on a deprecated field with a message', () => {
        const output = generate({ getUserByIdV2: deprecatedContract.routes.getUserByIdV2 });
        expect(output).toContain('@available(*, deprecated, message: "use email_address instead")');
        expect(output).toContain('let email: String');
    });
});

describe('Swift generator — HEAD method', () => {
    it('generates Void return type and no body decoding regardless of the response schema', () => {
        const contractRoutes = k.routes('api', {
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

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('func checkUser(_ params: TestAPIClient.CheckUser.Params) async throws(TestAPIClient.CheckUser.Failure)');
        expect(output).not.toContain('Kizuna.decode(');
        expect(output).not.toContain('Result(body:');
    });

    it('generates OPTIONS method with normal body decoding', () => {
        const contractRoutes = k.routes('api', {
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

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('func describeUsers() async throws(TestAPIClient.DescribeUsers.Failure)');
        expect(output).toContain('Kizuna.decode(');
    });
});

describe('Swift generator — automatic validation error', () => {
    it('adds badRequest case for route with body', () => {
        const contractRoutes = k.routes('api', {
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

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('case badRequest(TestAPIClient.ValidationError)');
        expect(output).toContain('struct ValidationError');
        expect(output).toContain('struct ValidationIssue');
    });

    it('does not add validation case for route without body or query', () => {
        const contractRoutes = k.routes('api', {
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

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).not.toContain('ValidationError');
        expect(output).not.toContain('ValidationIssue');
    });

    it('uses validationError case when route also declares 400', () => {
        const contractRoutes = k.routes('api', {
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

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('case badRequest(Response400)');
        expect(output).toContain('case validationError(TestAPIClient.ValidationError)');
    });

    it('groups duplicate status codes into a single switch case', () => {
        const contractRoutes = k.routes('api', {
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

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        const matches = output.match(/case 400:/g);
        expect(matches).toHaveLength(1);
    });

    it('tries each candidate type in a grouped case and throws the typed Failure without swallowing it', () => {
        const contractRoutes = k.routes('api', {
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

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        // The body POST adds an automatic validation 400, so 400 is a grouped case with
        // multiple candidate types. Each is attempted with `try?`; the matching case is
        // thrown outside any catch, so it can never be swallowed by the next attempt.
        expect(output).toMatch(
            /if let payload = try\? decoder\.decode\(TestAPIClient\.CreateUser\.Response400\.self, from: data\) \{\s*\n\s*throw TestAPIClient\.CreateUser\.Failure\.badRequest\(payload\)/
        );
        expect(output).not.toContain('catch let error as TestAPIClient.CreateUser.Failure');
        expect(output).not.toContain('} catch {}');
    });
});

describe('Swift generator — grouped request components (params/body/query/headers)', () => {
    it('emits each group as a distinct positional parameter with a group-named leading-dot factory', () => {
        const contractRoutes = k.routes('api', {
            getUser: {
                method: 'GET',
                path: '/users/:id',
                headers: z.object({ 'x-request-id': z.string() }),
                responses: {
                    200: z.object({ id: z.string() }),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        // distinct positional params (compile-checked required) → call site `.params(id: …), .headers(xRequestId: …)`
        expect(output).toContain('func getUser(_ params: TestAPIClient.GetUser.Params, _ headers: TestAPIClient.GetUser.Headers)');
        // each group has a leading-dot factory named after the group — no `.init` at the call site
        expect(output).toContain('public static func params(id: String) -> Self');
        expect(output).toContain('public static func headers(xRequestId: String) -> Self');
    });

    it('emits a multi-field group factory taking all fields', () => {
        const contractRoutes = k.routes('api', {
            search: {
                method: 'GET',
                path: '/search',
                query: z.object({ q: z.string(), limit: z.int() }),
                responses: {
                    200: z.object({ ok: z.boolean() }),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        // required query (has required fields) → non-defaulted positional param
        expect(output).toContain('func search(_ query: TestAPIClient.Search.Query)');
        expect(output).toContain('public struct Query: Sendable');
        expect(output).toContain('public let q: String');
        expect(output).toContain('public let limit: Int');
        expect(output).toContain('public static func query(');
    });

    it('defaults an all-optional group to .query() so it can be omitted at the call site', () => {
        const contractRoutes = k.routes('api', {
            list: {
                method: 'GET',
                path: '/items',
                query: z.object({ page: z.int().optional(), limit: z.int().optional() }),
                responses: {
                    200: z.object({ ok: z.boolean() }),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        expect(output).toContain('_ query: TestAPIClient.List.Query = .query()');
    });

    it('wraps an object body in a Body group with a .body(...) factory building the Codable payload', () => {
        const contractRoutes = k.routes('api', {
            createUser: {
                method: 'POST',
                path: '/users',
                body: createModel({ title: 'CreateUserInput', schema: z.object({ name: z.string(), email: z.string().optional() }) }),
                responses: {
                    201: z.object({ id: z.string() }),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        // body is a Body group; the factory builds the Codable payload, encoded via body.payload
        expect(output).toContain('func createUser(_ body: TestAPIClient.CreateUser.Body)');
        expect(output).toContain('public static func body(');
        expect(output).toContain('try Kizuna.encodeBody(&request, value: body.payload, using: encoder');
    });

    it('emits a leading-dot static factory per discriminated-union variant (no .init at call site)', () => {
        const contractRoutes = k.routes('api', {
            notify: {
                method: 'POST',
                path: '/notify',
                body: z.discriminatedUnion('channel', [
                    createModel({
                        title: 'EmailEvent',
                        schema: z.object({ channel: z.literal('email'), to: z.string(), subject: z.string() }),
                    }),
                    createModel({ title: 'SmsEvent', schema: z.object({ channel: z.literal('sms'), phone: z.string() }) }),
                ]),
                responses: {
                    202: z.object({ accepted: z.boolean() }),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        // call site: `body: .email(to:, subject:)` — the discriminator literal is injected inside the factory
        expect(output).toContain('public static func email(to: String, subject: String) ->');
        expect(output).toContain('public static func sms(phone: String) ->');
        expect(output).toContain('channel: "email"');
    });
});

describe('Swift generator — positional request groups (required-first, single signature)', () => {
    it('emits one signature with groups in required-first order', () => {
        const contractRoutes = k.routes('api', {
            getUser: {
                method: 'GET',
                path: '/users/:id',
                headers: z.object({ 'x-request-id': z.string() }),
                responses: {
                    200: z.object({ id: z.string() }),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        // exactly one signature — groups must be passed in declared order
        const signatureCount = output.split('func getUser(').length - 1;
        expect(signatureCount).toBe(1);
        expect(output).toContain('func getUser(_ params: TestAPIClient.GetUser.Params, _ headers: TestAPIClient.GetUser.Headers)');
    });

    it('orders required groups before optional ones so optional groups keep trailing defaults', () => {
        const contractRoutes = k.routes('api', {
            list: {
                method: 'GET',
                path: '/users/:id',
                query: z.object({ page: z.int().optional() }),
                responses: {
                    200: z.object({ ok: z.boolean() }),
                },
            },
        });

        const contract = k.contract({
            routes: contractRoutes,
        });
        const output = generateSwiftClient(contract, baseConfig);
        // required params first, optional query trailing with a default so it may be omitted
        expect(output).toContain('func list(_ params: TestAPIClient.List.Params, _ query: TestAPIClient.List.Query = .query())');
        const signatureCount = output.split('func list(').length - 1;
        expect(signatureCount).toBe(1);
    });
});

describe('Swift generator — request context', () => {
    const analytics = createRequestContext({
        headers: z.object({
            'x-session-id': z.string().optional(),
            'x-tenant': z.string(),
        }),
        context: z.object({
            sessionId: z.string().nullable(),
        }),
    });

    const { k: ctxK } = kizuna({
        requestContext: {
            analytics,
        },
    });

    const ctxContract = ctxK.contract({
        routes: {
            users: ctxK.routes({
                listUsers: {
                    method: 'GET',
                    path: '/users',
                    responses: {
                        200: z.object({
                            ok: z.boolean(),
                        }),
                    },
                },
            }),
        },
    });

    it('emits a RequestContext struct and a required init parameter', () => {
        const output = generateSwiftClient(ctxContract, baseConfig);
        expect(output).toContain('public struct RequestContext: Sendable, Equatable');
        expect(output).toContain('requestContext: RequestContext,');
        expect(output).toContain('self.requestContextHeaders = requestContext.headerFields');
        expect(output).toContain('for (name, value) in requestContextHeaders { request.setValue(value, forHTTPHeaderField: name) }');
        expect(output).toContain('fields["x-tenant"] = xTenant');
        expect(output).toContain('if let xSessionId { fields["x-session-id"] = xSessionId }');
    });

    it('emits nothing when the contract declares no request context headers', () => {
        const plainContract = k.contract({
            routes: k.routes('api', {
                ping: {
                    method: 'GET',
                    path: '/ping',
                    responses: {
                        200: z.object({
                            ok: z.boolean(),
                        }),
                    },
                },
            }),
        });
        const output = generateSwiftClient(plainContract, baseConfig);
        expect(output).not.toContain('RequestContext');
        expect(output).not.toContain('requestContextHeaders');
    });
});
