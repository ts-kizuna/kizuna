import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import { kizuna, createModel, type Contract } from '@ts-kizuna/core';
import { writeKizunaDeprecations } from '../../cli/src/deprecation-parser.js';
import { generateKotlinClient } from './generator.js';
import { contract as deprecatedContract } from '../../cli/src/deprecation.fixture.js';

const { k } = kizuna();

const baseConfig = {
    namespaceName: 'TestAPI',
};

describe('Kotlin generator — z.void()', () => {
    it('emits no body param and Response return for z.void() body and response', () => {
        const contract = k.contract({
            routes: {
                ping: {
                    method: 'POST',
                    path: '/ping/:id',
                    body: z.void(),
                    responses: {
                        204: z.void(),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('suspend fun ping(build: TestAPIClient.Ping.Scope.() -> TestAPIClient.Ping.Args)');
        expect(output).not.toContain('class Body');
        // Void success returns Unit — no Response wrapper is emitted.
        expect(output).not.toContain(': TestAPIClient.Ping.Response');
        expect(output).toContain('sealed class Failure');
    });
});

describe('Kotlin generator — z.union()', () => {
    it('resolves one-or-many union (array | single.transform) to list type', () => {
        const contract = k.contract({
            routes: {
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
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('ids: List<String>');
        expect(output).not.toContain('JsonElement');
    });

    it('resolves union where all branches have the same type', () => {
        const contract = k.contract({
            routes: {
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
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('tag: String');
        expect(output).not.toContain('JsonElement');
    });
});

describe('Kotlin generator — z.iso.datetime()', () => {
    it('maps z.iso.datetime() to Kotlin Instant, not String', () => {
        const contract = k.contract({
            routes: {
                listEvents: {
                    method: 'GET',
                    path: '/events',
                    responses: {
                        200: z.object({
                            occurredAt: z.iso.datetime(),
                        }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('val occurredAt: Instant');
        expect(output).not.toContain('val occurredAt: String');
    });

    it('maps z.string().datetime() to Kotlin Instant (legacy style)', () => {
        const contract = k.contract({
            routes: {
                listEvents: {
                    method: 'GET',
                    path: '/events',
                    responses: {
                        200: z.object({
                            occurredAt: z.string().datetime(),
                        }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('val occurredAt: Instant');
        expect(output).not.toContain('val occurredAt: String');
    });
});

describe('Kotlin generator — z.pipe() and z.string().transform()', () => {
    it('resolves z.string().pipe(z.coerce.number()) to Double', () => {
        const contract = k.contract({
            routes: {
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
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('limit: Double');
        expect(output).not.toContain('JsonElement');
    });

    it('resolves z.string().transform() to String (input type)', () => {
        const contract = k.contract({
            routes: {
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
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('label: String');
        expect(output).not.toContain('JsonElement');
    });
});

describe('Kotlin generator — namespace wrapper', () => {
    it('wraps all types in an object named after config.namespaceName', () => {
        const contract = k.contract({
            routes: {
                getUser: {
                    method: 'GET',
                    path: '/users/:id',
                    responses: {
                        200: createModel({ title: 'Error', schema: z.object({ id: z.string() }) }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('object TestAPI {');
        expect(output).toContain('data class Error(');
        expect(output).toContain('class TestAPIClient');
    });
});

describe('Kotlin generator — keyword property @SerialName', () => {
    it('emits @SerialName when a field name is a Kotlin keyword', () => {
        const contract = k.contract({
            routes: {
                createUser: {
                    method: 'POST',
                    path: '/users',
                    body: z.object({
                        when: z.string(),
                        name: z.string(),
                    }),
                    responses: {
                        200: z.object({ ok: z.boolean() }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('val `when`: String');
        expect(output).toContain('@SerialName');
    });
});

describe('Kotlin generator — Unit error responses', () => {
    it('emits data object for Unit error status in sealed Failure', () => {
        const contract = k.contract({
            routes: {
                getUser: {
                    method: 'GET',
                    path: '/users/:id',
                    responses: {
                        200: z.object({ name: z.string() }),
                        401: z.void(),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('data object Unauthorized : Failure()');
        expect(output).toContain('throw TestAPIClient.GetUser.Failure.Unauthorized');
    });
});

describe('Kotlin generator — z.int() maps to Int', () => {
    it('maps z.int() to Kotlin Int, not Double', () => {
        const contract = k.contract({
            routes: {
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
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('val count: Int');
        expect(output).toContain('val ratio: Double');
    });
});

describe('Kotlin generator — doc comments on auto-named types', () => {
    it('emits a KDoc comment for an auto-named data class with a description', () => {
        const contract = k.contract({
            routes: {
                healthCheck: {
                    method: 'GET',
                    path: '/health',
                    responses: {
                        200: z.object({ ok: z.boolean() }).meta({ description: 'Health check response' }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('/** Health check response */');
    });
});

describe('Kotlin generator — array type qualification', () => {
    it('array response type is placed inside Ok body field', () => {
        const contract = k.contract({
            routes: {
                listItems: {
                    method: 'GET',
                    path: '/items',
                    responses: {
                        200: z.array(z.object({ id: z.string() })),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain(': TestAPIClient.ListItems.Response');
        expect(output).toContain('data class Response(val body: List<ResponseBodyItem>)');
    });

    it('array response type in sub-client uses Ok body field', () => {
        const contract = k.contract({
            routes: {
                items: {
                    list: {
                        method: 'GET',
                        path: '/items',
                        responses: {
                            200: z.array(z.object({ id: z.string() })),
                        },
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain(': TestAPIClient.ItemsList.Response');
        expect(output).toContain('data class Response(val body: List<ResponseBodyItem>)');
    });

    it('qualifies array element types in sub-client method parameters', () => {
        const contract = k.contract({
            routes: {
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
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('tags: List<String>');
        expect(output).not.toContain('TestAPI.List<String>');
    });

    it('qualifies array of user-defined types in query params', () => {
        const contract = k.contract({
            routes: {
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
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        // Within the operation object, the enum element resolves to its local name — a List of the
        // user-defined type, never the built-in List mis-qualified with the client namespace.
        expect(output).toContain('val kinds: List<QueryKindsItem>');
        expect(output).not.toContain('TestAPIClient.List<');
    });
});

describe('Kotlin generator — nested sub-client routing', () => {
    it('emits a sub-client class for a grouped router key', () => {
        const contract = k.contract({
            routes: {
                users: {
                    getById: {
                        method: 'GET',
                        path: '/users/:id',
                        responses: {
                            200: z.object({ id: z.string() }),
                        },
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('class TestAPIUsersClient');
        expect(output).toContain('val users = TestAPIUsersClient(');
    });

    it('uses the leaf method name for grouped routes, not the full joined name', () => {
        const contract = k.contract({
            routes: {
                users: {
                    getById: {
                        method: 'GET',
                        path: '/users/:id',
                        responses: {
                            200: z.object({ id: z.string() }),
                        },
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('suspend fun getById(build: TestAPIClient.UsersGetById.Scope.() -> TestAPIClient.UsersGetById.Args)');
        expect(output).not.toContain('suspend fun usersGetById');
    });

    it('uses the full joined name for type naming to avoid collisions across groups', () => {
        const contract = k.contract({
            routes: {
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
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('TestAPIClient.UsersGetById.Response');
        expect(output).toContain('TestAPIClient.PostsGetById.Response');
    });

    it('keeps flat routes directly on the client when mixed with grouped routes', () => {
        const contract = k.contract({
            routes: {
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
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('suspend fun ping()');
        expect(output).toContain('class TestAPIHealthClient');
        expect(output).toContain('suspend fun check()');
    });
});

describe('Kotlin generator — responseHeaders', () => {
    it('emits Ok with body and headers when response headers are declared', () => {
        const contract = k.contract({
            routes: {
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
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('data class Response(');
        expect(output).toContain('val body:');
        expect(output).toContain('val headers: Headers');
        expect(output).toContain('data class Headers(');
        expect(output).toContain('val xRequestId: String?');
    });

    it('reads the header from response and passes it to Ok constructor', () => {
        const contract = k.contract({
            routes: {
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
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('httpResponse.header("x-request-id")');
    });

    it('routes without responseHeaders emit Response with body only', () => {
        const contract = k.contract({
            routes: {
                ping: {
                    method: 'GET',
                    path: '/ping',
                    responses: {
                        200: z.object({ ok: z.boolean() }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('data class Response(val body:');
        expect(output).not.toContain('val headers: Headers');
    });
});

describe('Kotlin generator — owned type nesting', () => {
    it('nests an enum class inside its owning data class and removes it from top level', () => {
        const contract = k.contract({
            routes: {
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
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('data class Video(');
        expect(output).toContain('enum class Status');
        expect(output).toContain('val status: Status');
        expect(output).not.toContain('enum class VideoStatus');
    });

    it('nests an inline object inside its parent data class', () => {
        const contract = k.contract({
            routes: {
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
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('data class Page(');
        expect(output).toContain('data class Images(');
        expect(output).toContain('val images: Images');
        expect(output).not.toContain('data class PageImages');
    });

    it('does not nest an inline object that has its own meta.id', () => {
        const Image = createModel({
            title: 'Image',
            schema: z.object({
                url: z.string(),
                width: z.number().int(),
            }),
        });
        const contract = k.contract({
            routes: {
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
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('data class Page(');
        expect(output).toContain('data class Image(');
        expect(output).toContain('val image: Image');
        const pageSection = output.slice(output.indexOf('data class Page('));
        const pageEnd = pageSection.indexOf('\n\n');
        const imageInPage = pageSection.indexOf('data class Image(');
        expect(imageInPage === -1 || imageInPage > pageEnd).toBe(true);
    });

    it('handles deeply nested inline objects', () => {
        const contract = k.contract({
            routes: {
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
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).not.toContain('data class PageSettings');
        expect(output).not.toContain('data class PageSettingsTheme');
        expect(output).toContain('data class Settings(');
        expect(output).toContain('data class Theme(');
    });

    it('keeps sibling anonymous objects apart when one field name is a prefix of another (identical shapes)', () => {
        const contract = k.contract({
            routes: {
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
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        // `ImagesItem` must nest under the parent, not get claimed by `Image` as `sItem`
        expect(output).toContain('data class Image(');
        expect(output).toContain('data class ImagesItem(');
        expect(output).toContain('val images: List<ImagesItem>?');
        expect(output).not.toContain('data class sItem');
        expect(output).not.toContain('FittingProductOrderItemImagesItem');
    });
});

describe('Kotlin generator — @Deprecated', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kizuna-kotlin-'));
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
        return generateKotlinClient(contract, baseConfig);
    };

    it('emits @Deprecated on a deprecated route method', () => {
        const output = generate({ getUserById: deprecatedContract.routes.getUserById });
        expect(output).toContain('@Deprecated');
        expect(output).toContain('fun getUserById');
    });

    it('does not include a custom message on a bare @deprecated route', () => {
        const output = generate({ getUserById: deprecatedContract.routes.getUserById });
        expect(output).toContain('@Deprecated("Deprecated")');
    });

    it('emits @Deprecated with message on a deprecated route with a message', () => {
        const output = generate({ oldRoute: deprecatedContract.routes.oldRoute });
        expect(output).toContain('@Deprecated("use newRoute instead")');
        expect(output).toContain('fun oldRoute');
    });

    it('emits @Deprecated on a deprecated field in a response data class', () => {
        const output = generate({ getUser: deprecatedContract.routes.getUser });
        expect(output).toContain('@Deprecated');
        expect(output).toContain('val email: String');
    });

    it('emits @Deprecated with message on a deprecated field with a message', () => {
        const output = generate({ getUserByIdV2: deprecatedContract.routes.getUserByIdV2 });
        expect(output).toContain('@Deprecated("use email_address instead")');
        expect(output).toContain('val email: String');
    });
});

describe('Kotlin generator — HEAD method', () => {
    it('returns Unit on success and throws a void NotFound for HEAD', () => {
        const contract = k.contract({
            routes: {
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
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('suspend fun checkUser(build: TestAPIClient.CheckUser.Scope.() -> TestAPIClient.CheckUser.Args)');
        expect(output).not.toContain(': TestAPIClient.CheckUser.Response');
        expect(output).toContain('data object NotFound : Failure()');
    });

    it('generates OPTIONS method with normal body decoding', () => {
        const contract = k.contract({
            routes: {
                describeUsers: {
                    method: 'OPTIONS',
                    path: '/users',
                    responses: {
                        200: z.object({
                            allow: z.string(),
                        }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('suspend fun describeUsers()');
        expect(output).toContain('decodeFromString');
    });
});

describe('Kotlin generator — automatic validation error', () => {
    it('adds BadRequest variant in sealed Failure for route with body', () => {
        const contract = k.contract({
            routes: {
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
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('data class BadRequest(val body: TestAPIClient.ValidationError) : Failure()');
        expect(output).toContain('data class ValidationError(');
        expect(output).toContain('data class ValidationIssue(');
    });

    it('does not add validation case for route without body or query', () => {
        const contract = k.contract({
            routes: {
                getUser: {
                    method: 'GET',
                    path: '/users/:id',
                    responses: {
                        200: z.object({
                            id: z.string(),
                        }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).not.toContain('ValidationError');
        expect(output).not.toContain('ValidationIssue');
    });

    it('uses ValidationError variant when route also declares 400', () => {
        const contract = k.contract({
            routes: {
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
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('data class BadRequest(val body: Response400) : Failure()');
        expect(output).toContain('data class ValidationError(val body: TestAPIClient.ValidationError) : Failure()');
    });

    it('groups duplicate status codes into a single when branch', () => {
        const contract = k.contract({
            routes: {
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
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        const matches = output.match(/400 -> \{/g);
        expect(matches).toHaveLength(1);
    });
});

describe('Kotlin generator — @SerialName for wire names', () => {
    it('emits @SerialName when property name is sanitized from a hyphenated wire name', () => {
        const contract = k.contract({
            routes: {
                getUser: {
                    method: 'GET',
                    path: '/users/:id',
                    responses: {
                        200: z.object({
                            'first-name': z.string(),
                            'last-name': z.string(),
                        }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('@SerialName("first-name")');
        expect(output).toContain('val firstName: String');
        expect(output).toContain('@SerialName("last-name")');
        expect(output).toContain('val lastName: String');
    });

    it('preserves snake_case field names as valid Kotlin identifiers', () => {
        const contract = k.contract({
            routes: {
                getUser: {
                    method: 'GET',
                    path: '/users/:id',
                    responses: {
                        200: z.object({
                            first_name: z.string(),
                            last_name: z.string(),
                        }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('val first_name: String');
        expect(output).toContain('val last_name: String');
        expect(output).not.toContain('@SerialName');
    });
});

describe('Kotlin generator — z.bigint() maps to Long', () => {
    it('maps z.bigint() to Kotlin Long', () => {
        const contract = k.contract({
            routes: {
                getStats: {
                    method: 'GET',
                    path: '/stats',
                    responses: {
                        200: z.object({
                            totalBytes: z.bigint(),
                        }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('val totalBytes: Long');
    });
});

describe('Kotlin generator — discriminated union', () => {
    it('emits a sealed interface with @JsonClassDiscriminator for discriminated unions', () => {
        const contract = k.contract({
            routes: {
                send: {
                    method: 'POST',
                    path: '/send',
                    body: z.discriminatedUnion('channel', [
                        z.object({
                            channel: z.literal('email'),
                            to: z.string(),
                        }),
                        z.object({
                            channel: z.literal('sms'),
                            phone: z.string(),
                        }),
                    ]),
                    responses: {
                        200: z.object({ ok: z.boolean() }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('@JsonClassDiscriminator("channel")');
        expect(output).toContain('sealed interface Input');
        expect(output).toContain('@SerialName("email")');
        expect(output).toContain('@SerialName("sms")');
    });
});

describe('Kotlin generator — imports', () => {
    it('includes required imports in the generated file', () => {
        const contract = k.contract({
            routes: {
                ping: {
                    method: 'GET',
                    path: '/ping',
                    responses: {
                        200: z.object({ ok: z.boolean() }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('import kotlinx.serialization.*');
        expect(output).toContain('import kotlinx.serialization.json.*');
        expect(output).toContain('import kotlinx.datetime.Instant');
        expect(output).toContain('import okhttp3.*');
    });
});

describe('Kotlin generator — throw-on-error model', () => {
    it('returns a Response wrapper and a sealed Failure for single-success routes', () => {
        const contract = k.contract({
            routes: {
                getUser: {
                    method: 'GET',
                    path: '/users/:id',
                    responses: {
                        200: z.object({ name: z.string() }),
                        404: z.object({ detail: z.string() }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain(
            'suspend fun getUser(build: TestAPIClient.GetUser.Scope.() -> TestAPIClient.GetUser.Args): TestAPIClient.GetUser.Response'
        );
        expect(output).toContain('data class Response(val body:');
        expect(output).toContain('sealed class Failure(message: String? = null) : Exception(message)');
        expect(output).toContain('data class NotFound(val body:');
        expect(output).toContain('data class Unexpected(val statusCode: Int, val data: ByteArray) : Failure');
        expect(output).toContain('@Throws(TestAPIClient.GetUser.Failure::class)');
        // No sealed Response / Ok / getOrThrow in the throw model.
        expect(output).not.toContain('sealed interface Response');
        expect(output).not.toContain('getOrThrow');
    });

    it('wraps multi-status success in a sealed Success carried by Response.body', () => {
        const contract = k.contract({
            routes: {
                archive: {
                    method: 'POST',
                    path: '/archive/:id',
                    responses: {
                        200: z.object({ alreadyArchived: z.boolean() }),
                        201: z.object({ archivedAt: z.string() }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('sealed interface Success');
        expect(output).toContain('data class Status200(val body:');
        expect(output).toContain('data class Status201(val body:');
        expect(output).toContain('data class Response(val body: Success)');
    });

    it('throws the typed Failure for error statuses and returns Response on success', () => {
        const contract = k.contract({
            routes: {
                getUser: {
                    method: 'GET',
                    path: '/users/:id',
                    responses: {
                        200: z.object({ name: z.string() }),
                        404: z.object({ detail: z.string() }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('throw TestAPIClient.GetUser.Failure.NotFound(body = payload)');
        expect(output).toContain('return@use TestAPIClient.GetUser.Response(body = payload)');
        expect(output).toContain('throw TestAPIClient.GetUser.Failure.Unexpected(statusCode = statusCode, data = data)');
    });
});

describe('Kotlin generator — inline response body name', () => {
    it('names the inline 200 body ResponseBody, distinct from the Response wrapper', () => {
        const contract = k.contract({
            routes: {
                listUsers: {
                    method: 'GET',
                    path: '/users',
                    responses: {
                        200: z.object({
                            users: z.array(z.string()),
                            total: z.number(),
                        }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('data class ResponseBody(');
        expect(output).toContain('data class Response(val body: ResponseBody)');
    });
});

describe('Kotlin generator — enum query wire value', () => {
    it('carries the @SerialName as wireValue rather than guessing from the constant name', () => {
        const contract = k.contract({
            routes: {
                listEvents: {
                    method: 'GET',
                    path: '/events',
                    query: z.object({
                        kind: z.enum(['userCreated', 'user.deleted']).optional(),
                    }),
                    responses: {
                        200: z.object({ ok: z.boolean() }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('enum class QueryKind(override val wireValue: String) : KizunaQueryValue');
        expect(output).toContain('@SerialName("userCreated") USERCREATED("userCreated")');
        expect(output).toContain('@SerialName("user.deleted") USER_DELETED("user.deleted")');
        expect(output).toContain('interface KizunaQueryValue');
        expect(output).toContain('is KizunaQueryValue -> listOf(value.wireValue)');
        // The old behaviour lowercased the constant name and dropped @SerialName.
        expect(output).not.toContain('value.name.lowercase()');
    });
});

describe('Kotlin generator — package declaration', () => {
    it('emits a package declaration when packageName is set', () => {
        const contract = k.contract({
            routes: {
                ping: {
                    method: 'GET',
                    path: '/ping',
                    responses: {
                        200: z.object({ ok: z.boolean() }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, {
            namespaceName: 'TestAPI',
            packageName: 'com.example.api',
        });
        expect(output.split('\n').slice(0, 4)).toContain('package com.example.api');
    });

    it('omits the package declaration when packageName is absent', () => {
        const contract = k.contract({
            routes: {
                ping: {
                    method: 'GET',
                    path: '/ping',
                    responses: {
                        200: z.object({ ok: z.boolean() }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).not.toContain('package ');
    });
});

describe('Kotlin generator — bodyless POST/PUT/PATCH', () => {
    it('sends an empty body so OkHttp does not reject a null body', () => {
        const contract = k.contract({
            routes: {
                ping: {
                    method: 'POST',
                    path: '/ping/:id',
                    responses: {
                        204: z.void(),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('.method("POST", ByteArray(0).toRequestBody(null))');
        expect(output).not.toContain('.method("POST", null)');
    });

    it('keeps a null body for bodyless GET', () => {
        const contract = k.contract({
            routes: {
                check: {
                    method: 'GET',
                    path: '/check',
                    responses: {
                        200: z.object({ ok: z.boolean() }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('.method("GET", null)');
    });
});

describe('Kotlin generator — grouped request components (params/body/query/headers)', () => {
    it('emits each group as a builder class and a builder-lambda method parameter', () => {
        const contract = k.contract({
            routes: {
                getUser: {
                    method: 'GET',
                    path: '/users/:id',
                    headers: z.object({ 'x-request-id': z.string() }),
                    responses: {
                        200: z.object({ id: z.string() }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('suspend fun getUser(build: TestAPIClient.GetUser.Scope.() -> TestAPIClient.GetUser.Args');
        expect(output).toContain('data class Params(val id: String)');
        expect(output).toContain('data class Headers(val xRequestId: String)');
        // the scope factory chains required channels; the request code reads fields off the built args
        expect(output).toContain('fun params(id: String): AfterParams = AfterParams(params = Params(id = id))');
        expect(output).toContain(
            'fun headers(xRequestId: String): AfterHeaders = AfterHeaders(params = params, headers = Headers(xRequestId = xRequestId))'
        );
        expect(output).toContain('val params = args.params');
        expect(output).toContain('Kizuna.encodePathSegment(params.id)');
    });

    it('emits a multi-field Query builder with all fields', () => {
        const contract = k.contract({
            routes: {
                search: {
                    method: 'GET',
                    path: '/search',
                    query: z.object({ q: z.string(), limit: z.int() }),
                    responses: {
                        200: z.object({ ok: z.boolean() }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        // required query (has required fields) → non-defaulted lambda parameter
        expect(output).toContain('suspend fun search(build: TestAPIClient.Search.Scope.() -> TestAPIClient.Search.Args)');
        expect(output).toContain('data class Query(');
        expect(output).toContain('val q: String,');
        expect(output).toContain('val limit: Int');
    });

    it('defaults an all-optional group to {} so it can be omitted at the call site', () => {
        const contract = k.contract({
            routes: {
                list: {
                    method: 'GET',
                    path: '/items',
                    query: z.object({ page: z.int().optional(), limit: z.int().optional() }),
                    responses: {
                        200: z.object({ ok: z.boolean() }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('build: TestAPIClient.List.Scope.() -> TestAPIClient.List.Args = { query() }');
    });

    it('wraps an object body in a Body builder exposing its fields, built into the payload for encoding', () => {
        const contract = k.contract({
            routes: {
                createUser: {
                    method: 'POST',
                    path: '/users',
                    body: createModel({
                        title: 'CreateUserInput',
                        schema: z.object({ name: z.string(), email: z.string().optional() }),
                    }),
                    responses: {
                        201: z.object({ id: z.string() }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('suspend fun createUser(build: TestAPIClient.CreateUser.Scope.() -> TestAPIClient.CreateUser.Args)');
        expect(output).toContain('data class Body(');
        expect(output).toContain('val name: String,');
        // the flattened body fields build the payload — required `name` non-null, optional `email` nullable
        expect(output).toContain('val payload = TestAPIClient.CreateUser.Input(name = body.name, email = body.email)');
        expect(output).toContain('json.encodeToString(payload)');
    });

    it('wraps a struct body in a Body builder carrying the payload directly', () => {
        const contract = k.contract({
            routes: {
                send: {
                    method: 'POST',
                    path: '/send',
                    body: createModel({
                        title: 'BigInput',
                        schema: z.object({
                            a: z.string(),
                            b: z.string(),
                            c: z.string(),
                            d: z.string(),
                            e: z.string(),
                            f: z.string(),
                            g: z.string(),
                        }),
                    }),
                    responses: {
                        200: z.object({ ok: z.boolean() }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        // >6 fields → the body is kept as a struct payload rather than flattened
        expect(output).toContain('data class Body(val payload: TestAPI.BigInput)');
        expect(output).toContain('json.encodeToString(body.payload)');
    });

    it('orders required groups before optional ones so optional groups keep trailing defaults', () => {
        const contract = k.contract({
            routes: {
                list: {
                    method: 'GET',
                    path: '/users/:id',
                    query: z.object({ page: z.int().optional() }),
                    responses: {
                        200: z.object({ ok: z.boolean() }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        expect(output).toContain('suspend fun list(build: TestAPIClient.List.Scope.() -> TestAPIClient.List.Args)');
        // the optional query is only reachable after the required params step
        expect(output).not.toContain('fun query(page: Int? = null): AfterQuery = AfterQuery(params = null');
        expect(output).toContain('fun query(page: Int? = null): AfterQuery = AfterQuery(params = params, query = Query(page = page))');
        const signatureCount = output.split('suspend fun list(').length - 1;
        expect(signatureCount).toBe(1);
    });

    it('sanitizes enum values that are not valid Kotlin identifiers (leading digit, dashes)', () => {
        const contract = k.contract({
            routes: {
                listAssets: {
                    method: 'GET',
                    path: '/assets',
                    query: z.object({ kind: z.enum(['3d-model', 'image']) }),
                    responses: {
                        200: z.object({ ok: z.boolean() }),
                    },
                },
            },
        });
        const output = generateKotlinClient(contract, baseConfig);
        // dashes → underscores, leading digit → `_` prefix; the original value is kept as the wireValue
        expect(output).toContain('@SerialName("3d-model") _3D_MODEL("3d-model")');
        expect(output).not.toContain(' 3D_MODEL(');
    });
});
