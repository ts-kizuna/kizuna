import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import toBeAValidOpenAPIDefinition from 'jest-expect-openapi';
import { createContract, createTag, type Contract } from '@ts-kizuna/core';
import { createDeprecationMap, serializeDeprecationMap } from '@ts-kizuna/core/generator';
import { generateOpenApi, type GenerateOpenApiOptions } from './generator.js';
import { contract as deprecatedContract } from '../../core/src/deprecation.fixture.js';

const generateJson = (contract: Contract, options: GenerateOpenApiOptions) => generateOpenApi(contract, options)('json');

expect.extend({
    toBeAValidOpenAPIDefinition,
});

declare module 'vitest' {
    interface Matchers<T = any> {
        toBeAValidOpenAPIDefinition(transformer?: (spec: Record<string, unknown>) => Record<string, unknown>): Promise<T>;
    }
}

const contract = createContract({
    getUser: {
        method: 'GET',
        path: '/users/:id',
        summary: 'Get a user',
        responses: {
            200: z.object({
                id: z.string(),
                name: z.string(),
            }),
            404: z.object({
                message: z.string(),
            }),
        },
    },
    createUser: {
        method: 'POST',
        path: '/users',
        summary: 'Create a user',
        body: z.object({
            name: z.string(),
            email: z.email(),
        }),
        responses: {
            201: z.object({
                id: z.string(),
                name: z.string(),
                email: z.string(),
            }),
        },
    },
    listUsers: {
        method: 'GET',
        path: '/users',
        query: z.object({
            page: z.number().optional(),
            limit: z.number().optional(),
        }),
        responses: {
            200: z.object({
                users: z.array(
                    z.object({
                        id: z.string(),
                    })
                ),
            }),
        },
    },
});

const baseConfig = {
    info: {
        title: 'Test API',
        version: '1.0.0',
    },
};

const UsersTag = createTag({
    title: 'Users',
});

const HealthTag = createTag({
    title: 'Health',
});

const UsersTagWithDescription = createTag({
    title: 'Users',
    description: 'User management endpoints',
});

describe('generateOpenApi', () => {
    const spec = generateJson(contract, baseConfig);

    it('is a valid OpenAPI 3.1 document', async () => {
        await expect(spec).toBeAValidOpenAPIDefinition();
    });

    it('produces OpenAPI 3.1.0 with provided info', () => {
        expect(spec.openapi).toBe('3.1.0');
        expect(spec.info.title).toBe('Test API');
        expect(spec.info.version).toBe('1.0.0');
    });

    it('converts :param paths to {param}', () => {
        expect(spec.paths['/users/{id}']).toBeDefined();
        expect(spec.paths['/users/:id']).toBeUndefined();
    });

    it('emits all routes under their methods', () => {
        expect(spec.paths['/users/{id}']?.get).toBeDefined();
        expect(spec.paths['/users']?.get).toBeDefined();
        expect(spec.paths['/users']?.post).toBeDefined();
    });

    it('includes path parameters', () => {
        const params = spec.paths['/users/{id}']?.get?.parameters;
        const idParam = params?.find((parameter) => parameter.name === 'id');
        expect(idParam?.in).toBe('path');
        expect(idParam?.required).toBe(true);
    });

    it('includes query parameters', () => {
        const params = spec.paths['/users']?.get?.parameters;
        const pageParam = params?.find((parameter) => parameter.name === 'page');
        expect(pageParam?.in).toBe('query');
    });

    it('includes a JSON request body for POST', () => {
        const post = spec.paths['/users']?.post;
        expect(post?.requestBody?.content?.['application/json']?.schema).toBeDefined();
    });

    it('keys responses by status code', () => {
        const get = spec.paths['/users/{id}']?.get;
        expect(get?.responses['200']).toBeDefined();
        expect(get?.responses['404']).toBeDefined();
    });

    it('includes summary from contract', () => {
        expect(spec.paths['/users/{id}']?.get?.summary).toBe('Get a user');
        expect(spec.paths['/users']?.post?.summary).toBe('Create a user');
    });

    it('sets operationId when enabled', () => {
        const withIds = generateJson(contract, { ...baseConfig, setOperationId: true });
        expect(withIds.paths['/users/{id}']?.get?.operationId).toBe('getUser');
        expect(withIds.paths['/users']?.post?.operationId).toBe('createUser');
    });

    it('sets concatenated-path operationId for nested routers', () => {
        const nested = createContract({
            users: createContract({
                getUser: {
                    method: 'GET',
                    path: '/users/:id',
                    responses: {
                        200: z.object({
                            id: z.string(),
                        }),
                    },
                },
            }),
        });

        const withTrue = generateJson(nested, { ...baseConfig, setOperationId: true });
        expect(withTrue.paths['/users/{id}']?.get?.operationId).toBe('getUser');

        const withConcatenated = generateJson(nested, { ...baseConfig, setOperationId: 'concatenated-path' });
        expect(withConcatenated.paths['/users/{id}']?.get?.operationId).toBe('users.getUser');
    });

    it('omits requestBody and response content for z.void()', () => {
        const voidContract = createContract({
            ping: {
                method: 'POST',
                path: '/ping/:id',
                body: z.void(),
                responses: {
                    204: z.void(),
                },
            },
        });
        const doc = generateJson(voidContract, baseConfig);
        const operation = doc.paths['/ping/{id}']?.post;
        expect(operation?.requestBody).toBeUndefined();
        expect(operation?.responses['204']?.content).toBeUndefined();
        expect(operation?.responses['204']?.description).toBe('No Content');
    });

    it('applies operationMapper', () => {
        const tagged = generateJson(contract, {
            ...baseConfig,
            operationMapper: (operation) => ({
                ...operation,
                tags: ['users'],
            }),
        });
        expect(tagged.paths['/users/{id}']?.get?.tags).toEqual(['users']);
    });
});

describe('Zod meta() in OpenAPI output', () => {
    const Tagged = z
        .object({
            id: z.string().meta({
                description: 'User ID',
                example: 'usr_123',
            }),
            name: z.string().meta({
                description: 'Display name',
            }),
            email: z.email(),
        })
        .meta({
            id: 'TaggedUser',
        });

    const taggedContract = createContract({
        getUser: {
            method: 'GET',
            path: '/users/:id',
            responses: {
                200: Tagged,
            },
        },
    });

    it('is a valid OpenAPI 3.1 document', async () => {
        const spec = generateJson(taggedContract, baseConfig);
        await expect(spec).toBeAValidOpenAPIDefinition();
    });

    it('extracts id-tagged schemas into components.schemas as $refs', () => {
        const spec = generateJson(taggedContract, baseConfig);
        expect(spec.components?.schemas?.TaggedUser).toBeDefined();
        const responseSchema = spec.paths['/users/{id}']?.get?.responses['200']?.content?.['application/json']?.schema;
        expect(responseSchema).toEqual({
            $ref: '#/components/schemas/TaggedUser',
        });
    });

    it('preserves description and example metadata on properties', () => {
        const spec = generateJson(taggedContract, baseConfig);
        const userSchema = spec.components?.schemas?.TaggedUser as Record<string, unknown> | undefined;
        const properties = (userSchema?.properties ?? {}) as Record<string, Record<string, unknown>>;
        expect(properties['id']?.description).toBe('User ID');
        expect(properties['id']?.example).toBe('usr_123');
        expect(properties['name']?.description).toBe('Display name');
    });

    it('applies field-level deprecation from the contract source onto the component schema via $ref resolution', () => {
        const spec = generateJson(deprecatedContract, {
            ...baseConfig,
            deprecationWarnings: {
                contractPath: path.resolve(import.meta.dirname, '../../core/src/deprecation.fixture.ts'),
            },
        });
        const userSchema = spec.components?.schemas?.User as Record<string, unknown> | undefined;
        const properties = (userSchema?.properties ?? {}) as Record<string, Record<string, unknown>>;
        expect(properties['email']?.deprecated).toBe(true);
    });

    it('applies deprecation from a pre-computed DeprecationMap', () => {
        const deprecationMap = createDeprecationMap(
            path.resolve(import.meta.dirname, '../../core/src/deprecation.fixture.ts')
        );
        const spec = generateJson(deprecatedContract, {
            ...baseConfig,
            deprecationWarnings: deprecationMap,
        });
        const userSchema = spec.components?.schemas?.User as Record<string, unknown> | undefined;
        const properties = (userSchema?.properties ?? {}) as Record<string, Record<string, unknown>>;
        expect(properties['email']?.deprecated).toBe(true);

        const operation = spec.paths['/users/by-id/{id}']?.get;
        expect(operation?.deprecated).toBe(true);
    });

    it('applies deprecation from a SerializedDeprecationMap (JSON import)', () => {
        const deprecationMap = createDeprecationMap(
            path.resolve(import.meta.dirname, '../../core/src/deprecation.fixture.ts')
        );
        const serialized = JSON.parse(JSON.stringify(serializeDeprecationMap(deprecationMap)));
        const spec = generateJson(deprecatedContract, {
            ...baseConfig,
            deprecationWarnings: serialized,
        });
        const userSchema = spec.components?.schemas?.User as Record<string, unknown> | undefined;
        const properties = (userSchema?.properties ?? {}) as Record<string, Record<string, unknown>>;
        expect(properties['email']?.deprecated).toBe(true);

        const operation = spec.paths['/users/by-id/{id}']?.get;
        expect(operation?.deprecated).toBe(true);
    });
});

describe('operation metadata passthrough', () => {
    const annotated = createContract({
        getUser: {
            method: 'GET',
            path: '/users/:id',
            tags: [UsersTag],
            security: [
                {
                    bearerAuth: [],
                },
            ],
            externalDocs: {
                url: 'https://example.com/docs/getUser',
                description: 'Reference docs',
            },
            responses: {
                200: z.object({
                    id: z.string(),
                }),
            },
        },
    });

    it('is a valid OpenAPI 3.1 document', async () => {
        const spec = generateJson(annotated, baseConfig);
        await expect(spec).toBeAValidOpenAPIDefinition();
    });

    it('emits route-level deprecated, tags, security, externalDocs on the operation', () => {
        const spec = generateJson(deprecatedContract, {
            ...baseConfig,
            deprecationWarnings: {
                contractPath: path.resolve(import.meta.dirname, '../../core/src/deprecation.fixture.ts'),
            },
        });
        const operation = spec.paths['/users/by-id/{id}']?.get;
        expect(operation?.deprecated).toBe(true);
        expect(operation?.tags).toEqual(['Users']);
        expect(operation?.security).toEqual([
            {
                bearerAuth: [],
            },
        ]);
        expect(operation?.externalDocs).toEqual({
            url: 'https://example.com/docs/getUser',
            description: 'Reference docs',
        });
    });

    it('emits document-level tags, security, externalDocs from config', () => {
        const spec = generateJson(annotated, {
            ...baseConfig,
            tags: [
                {
                    name: 'users',
                    description: 'User-related operations',
                },
            ],
            security: [
                {
                    bearerAuth: [],
                },
            ],
            externalDocs: {
                url: 'https://example.com/docs',
            },
        });
        expect(spec.tags).toEqual([
            {
                name: 'users',
                description: 'User-related operations',
            },
        ]);
        expect(spec.security).toEqual([
            {
                bearerAuth: [],
            },
        ]);
        expect(spec.externalDocs).toEqual({
            url: 'https://example.com/docs',
        });
    });

    it('lets operationMapper override route-declared tags', () => {
        const spec = generateJson(annotated, {
            ...baseConfig,
            operationMapper: (operation) => ({
                ...operation,
                tags: ['mapped'],
            }),
        });
        expect(spec.paths['/users/{id}']?.get?.tags).toEqual(['mapped']);
    });

    it('explicit route.tags are used when set', () => {
        const nested = createContract({
            users: {
                getUser: {
                    method: 'GET',
                    path: '/users/:id',
                    tags: [HealthTag],
                    responses: {
                        200: z.object({
                            id: z.string(),
                        }),
                    },
                },
            },
        });
        const spec = generateJson(nested, baseConfig);
        expect(spec.paths['/users/{id}']?.get?.tags).toEqual(['Health']);
    });
});

describe('discriminated unions', () => {
    it('is a valid OpenAPI 3.1 document', async () => {
        const Image = z
            .object({
                type: z.literal('image'),
                src: z.string(),
            })
            .meta({
                id: 'ValidImage',
            });
        const Video = z
            .object({
                type: z.literal('video'),
                url: z.string(),
            })
            .meta({
                id: 'ValidVideo',
            });
        const route = createContract({
            getMedia: {
                method: 'GET',
                path: '/media',
                responses: {
                    200: z.discriminatedUnion('type', [Image, Video]),
                },
            },
        });
        await expect(generateJson(route, baseConfig)).toBeAValidOpenAPIDefinition();
    });

    it('emits oneOf + discriminator with mapping when variants are id-tagged', () => {
        const Image = z
            .object({
                type: z.literal('image'),
                src: z.string(),
            })
            .meta({
                id: 'DiscImage',
            });
        const Video = z
            .object({
                type: z.literal('video'),
                url: z.string(),
            })
            .meta({
                id: 'DiscVideo',
            });
        const route = createContract({
            getMedia: {
                method: 'GET',
                path: '/media',
                responses: {
                    200: z.discriminatedUnion('type', [Image, Video]),
                },
            },
        });
        const spec = generateJson(route, baseConfig);
        const schema = spec.paths['/media']?.get?.responses['200']?.content?.['application/json']?.schema as Record<string, unknown>;
        expect(schema?.oneOf).toEqual([
            {
                $ref: '#/components/schemas/DiscImage',
            },
            {
                $ref: '#/components/schemas/DiscVideo',
            },
        ]);
        expect(schema?.discriminator).toEqual({
            propertyName: 'type',
            mapping: {
                image: '#/components/schemas/DiscImage',
                video: '#/components/schemas/DiscVideo',
            },
        });
    });

    it('emits discriminator without mapping when variants are not id-tagged', () => {
        const route = createContract({
            getMedia: {
                method: 'GET',
                path: '/inline-media',
                responses: {
                    200: z.discriminatedUnion('kind', [
                        z.object({
                            kind: z.literal('a'),
                            value: z.string(),
                        }),
                        z.object({
                            kind: z.literal('b'),
                            value: z.number(),
                        }),
                    ]),
                },
            },
        });
        const spec = generateJson(route, baseConfig);
        const schema = spec.paths['/inline-media']?.get?.responses['200']?.content?.['application/json']?.schema as Record<string, unknown>;
        expect(Array.isArray(schema?.oneOf)).toBe(true);
        expect((schema?.oneOf as unknown[]).length).toBe(2);
        expect(schema?.discriminator).toEqual({
            propertyName: 'kind',
        });
    });

    it('attaches discriminator to a registered union via components.schemas', () => {
        const EmailEvent = z
            .object({
                channel: z.literal('email'),
                to: z.string(),
            })
            .meta({
                id: 'EmailEvent',
            });
        const SmsEvent = z
            .object({
                channel: z.literal('sms'),
                phone: z.string(),
            })
            .meta({
                id: 'SmsEvent',
            });
        const NotificationEvent = z.discriminatedUnion('channel', [EmailEvent, SmsEvent]).meta({
            id: 'NotificationEvent',
        });
        const route = createContract({
            sendNotification: {
                method: 'POST',
                path: '/notifications',
                body: NotificationEvent,
                responses: {
                    202: z.object({
                        accepted: z.boolean(),
                    }),
                },
            },
        });
        const spec = generateJson(route, baseConfig);
        const requestSchema = spec.paths['/notifications']?.post?.requestBody?.content?.['application/json']?.schema;
        expect(requestSchema).toEqual({
            $ref: '#/components/schemas/NotificationEvent',
        });
        const component = spec.components?.schemas?.NotificationEvent as Record<string, unknown> | undefined;
        expect(component?.oneOf).toEqual([
            {
                $ref: '#/components/schemas/EmailEvent',
            },
            {
                $ref: '#/components/schemas/SmsEvent',
            },
        ]);
        expect(component?.discriminator).toEqual({
            propertyName: 'channel',
            mapping: {
                email: '#/components/schemas/EmailEvent',
                sms: '#/components/schemas/SmsEvent',
            },
        });
    });

    it('does not add discriminator to plain z.union', () => {
        const route = createContract({
            getOne: {
                method: 'GET',
                path: '/plain-union',
                responses: {
                    200: z.union([z.string(), z.number()]),
                },
            },
        });
        const spec = generateJson(route, baseConfig);
        const schema = spec.paths['/plain-union']?.get?.responses['200']?.content?.['application/json']?.schema as Record<string, unknown>;
        expect(schema?.discriminator).toBeUndefined();
    });
});

describe('request body content types', () => {
    it('is a valid OpenAPI 3.1 document', async () => {
        const route = createContract({
            uploadAvatar: {
                method: 'POST',
                path: '/avatar',
                contentType: 'multipart/form-data',
                body: z.object({
                    file: z.instanceof(File),
                    name: z.string(),
                }),
                responses: {
                    200: z.object({
                        ok: z.boolean(),
                    }),
                },
            },
            postForm: {
                method: 'POST',
                path: '/form',
                contentType: 'application/x-www-form-urlencoded',
                body: z.object({
                    name: z.string(),
                }),
                responses: {
                    200: z.object({
                        ok: z.boolean(),
                    }),
                },
            },
            postUser: {
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
        await expect(generateJson(route, baseConfig)).toBeAValidOpenAPIDefinition();
    });

    it('emits multipart/form-data when contentType is set, with format: binary for File fields', () => {
        const route = createContract({
            uploadAvatar: {
                method: 'POST',
                path: '/avatar',
                contentType: 'multipart/form-data',
                body: z.object({
                    file: z.instanceof(File),
                    name: z.string(),
                }),
                responses: {
                    200: z.object({
                        ok: z.boolean(),
                    }),
                },
            },
        });
        const spec = generateJson(route, baseConfig);
        const body = spec.paths['/avatar']?.post?.requestBody;
        expect(body?.content?.['multipart/form-data']).toBeDefined();
        expect(body?.content?.['application/json']).toBeUndefined();
        const schema = body?.content?.['multipart/form-data']?.schema as Record<string, unknown>;
        const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
        expect(properties['file']).toEqual({
            type: 'string',
            format: 'binary',
        });
        expect(properties['name']).toEqual({
            type: 'string',
        });
    });

    it('emits application/x-www-form-urlencoded when contentType is set', () => {
        const route = createContract({
            postForm: {
                method: 'POST',
                path: '/form',
                contentType: 'application/x-www-form-urlencoded',
                body: z.object({
                    name: z.string(),
                }),
                responses: {
                    200: z.object({
                        ok: z.boolean(),
                    }),
                },
            },
        });
        const spec = generateJson(route, baseConfig);
        const body = spec.paths['/form']?.post?.requestBody;
        expect(body?.content?.['application/x-www-form-urlencoded']).toBeDefined();
        expect(body?.content?.['application/json']).toBeUndefined();
    });

    it('defaults to application/json when contentType is not set', () => {
        const route = createContract({
            postUser: {
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
        const spec = generateJson(route, baseConfig);
        expect(spec.paths['/users']?.post?.requestBody?.content?.['application/json']).toBeDefined();
    });
});

describe('transform field handling', () => {
    it('uses input schema for request body transform fields', () => {
        const contract = createContract({
            createUser: {
                method: 'POST',
                path: '/users',
                body: z.object({
                    name: z.string().transform((value) => value.trim()),
                    age: z.number().optional(),
                }),
                responses: {
                    201: z.object({
                        id: z.string(),
                    }),
                },
            },
        });
        const spec = generateJson(contract, baseConfig);
        const properties = spec.paths['/users']?.post?.requestBody?.content?.['application/json']?.schema?.properties as
            | Record<string, unknown>
            | undefined;
        expect(properties?.['name']).toEqual({
            type: 'string',
        });
        expect(properties?.['age']).toEqual({
            type: 'number',
        });
    });

    it('uses input schema for transform fields in union query params', () => {
        const contract = createContract({
            getItems: {
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
                        items: z.array(z.string()),
                    }),
                },
            },
        });
        const spec = generateJson(contract, baseConfig);
        const schema = spec.paths['/items']?.get?.parameters?.find((parameter) => parameter.name === 'ids')?.schema as
            | Record<string, unknown>
            | undefined;
        const branches = schema?.anyOf as Array<Record<string, unknown>> | undefined;
        expect(branches?.[1]).toMatchObject({
            type: 'string',
            format: 'uuid',
        });
    });
});

describe('complex transform edge cases', () => {
    it('handles transforms across nested objects, arrays, records, tuples, unions, nullable, and intersections without producing {}', () => {
        const insane = createContract({
            users: {
                create: {
                    method: 'POST',
                    path: '/users',
                    body: z.object({
                        name: z.string(),
                        username: z.string().transform((value) => value.toLowerCase()),
                        bio: z
                            .string()
                            .transform((value) => value.trim())
                            .nullable(),
                        tags: z.array(z.string().transform((value) => value.trim())),
                        coords: z.tuple([z.number(), z.number(), z.string().transform(Number)]),
                        metadata: z.record(
                            z.string(),
                            z.string().transform((value) => value.trim())
                        ),
                        identifier: z.union([z.string().uuid(), z.string().transform((value) => value.toLowerCase())]),
                        address: z.object({
                            street: z.string().transform((value) => value.trim()),
                            city: z.string(),
                            zip: z.string().transform((value) => value.replace(/\s/g, '')),
                        }),
                        extra: z.intersection(
                            z.object({
                                score: z.number(),
                            }),
                            z.object({
                                label: z.string().transform((value) => value.trim()),
                            })
                        ),
                    }),
                    responses: {
                        201: z.object({
                            id: z.string().uuid(),
                        }),
                        400: z.object({
                            message: z.string(),
                        }),
                    },
                },
                list: {
                    method: 'GET',
                    path: '/users',
                    query: z.object({
                        page: z.string().transform(Number),
                        perPage: z.string().transform(Number).optional(),
                        filter: z
                            .union([
                                z.literal('active'),
                                z
                                    .string()
                                    .min(1)
                                    .transform((value) => value.trim()),
                            ])
                            .optional(),
                    }),
                    responses: {
                        200: z.object({
                            items: z.array(
                                z.object({
                                    id: z.string(),
                                    name: z.string(),
                                })
                            ),
                            total: z.number(),
                        }),
                    },
                },
            },
        });

        const spec = generateJson(insane, baseConfig);
        const json = JSON.stringify(spec);

        expect(json).not.toMatch(/"items":\{\}/);
        expect(json).not.toMatch(/"additionalProperties":\{\}/);
        expect(json).not.toMatch(/"prefixItems":\[\{\}/);

        const createBody = spec.paths['/users']?.post?.requestBody?.content?.['application/json']?.schema;
        const bodyProps = createBody?.properties as Record<string, unknown>;

        expect(bodyProps?.['username']).toEqual({ type: 'string' });
        expect((bodyProps?.['bio'] as Record<string, unknown>)?.['anyOf']).toMatchObject([{ type: 'string' }, { type: 'null' }]);
        expect(bodyProps?.['tags']).toMatchObject({ type: 'array', items: { type: 'string' } });
        expect((bodyProps?.['metadata'] as Record<string, unknown>)?.['additionalProperties']).toEqual({ type: 'string' });
        expect((bodyProps?.['coords'] as Record<string, unknown>)?.['prefixItems']).toMatchObject([
            { type: 'number' },
            { type: 'number' },
            { type: 'string' },
        ]);

        const addressProps = (bodyProps?.['address'] as Record<string, unknown>)?.['properties'] as Record<string, unknown>;
        expect(addressProps?.['street']).toEqual({ type: 'string' });
        expect(addressProps?.['zip']).toEqual({ type: 'string' });

        const extraAllOf = (bodyProps?.['extra'] as Record<string, unknown>)?.['allOf'] as Array<Record<string, unknown>>;
        const extraSecondProps = extraAllOf?.[1]?.['properties'] as Record<string, unknown>;
        expect(extraSecondProps?.['label']).toEqual({ type: 'string' });
    });
});

describe('response headers', () => {
    it('emits OpenAPI headers object on the response when headers are declared', () => {
        const contract = createContract({
            getUser: {
                method: 'GET',
                path: '/users/:id',
                responses: {
                    200: {
                        body: z.object({ id: z.string() }),
                        headers: z.object({ 'x-request-id': z.string().optional() }),
                    },
                    404: z.object({ message: z.string() }),
                },
            },
        });
        const spec = generateJson(contract, {
            info: {
                title: 'Test',
                version: '1',
            },
        });
        const response200 = spec.paths['/users/{id}']?.get?.responses?.['200'] as unknown as Record<string, unknown>;
        const response404 = spec.paths['/users/{id}']?.get?.responses?.['404'] as unknown as Record<string, unknown>;

        expect(response200?.['headers']).toEqual({
            'x-request-id': {
                schema: {
                    type: 'string',
                },
                required: false,
            },
        });
        expect(response404?.['headers']).toBeUndefined();
    });
});

describe('contract-level tag grouping', () => {
    it('applies tag from createContract to all routes in that group', () => {
        const usersContract = createContract(UsersTag, {
            listUsers: {
                method: 'GET',
                path: '/users',
                responses: {
                    200: z.object({ users: z.array(z.string()) }),
                },
            },
            createUser: {
                method: 'POST',
                path: '/users',
                body: z.object({ name: z.string() }),
                responses: {
                    201: z.object({ id: z.string() }),
                },
            },
        });
        const contract = createContract({ users: usersContract });
        const spec = generateJson(contract, baseConfig);
        expect(spec.paths['/users']?.get?.tags).toEqual(['Users']);
        expect(spec.paths['/users']?.post?.tags).toEqual(['Users']);
    });

    it('route-level tags merge with contract tag', () => {
        const usersContract = createContract(UsersTag, {
            listUsers: {
                method: 'GET',
                path: '/users',
                tags: [HealthTag],
                responses: {
                    200: z.object({ users: z.array(z.string()) }),
                },
            },
        });
        const contract = createContract({ users: usersContract });
        const spec = generateJson(contract, baseConfig);
        expect(spec.paths['/users']?.get?.tags).toEqual(['Users', 'Health']);
    });

    it('accumulates tags from nested tagged contracts', () => {
        const healthContract = createContract(HealthTag, {
            deleteUser: {
                method: 'DELETE',
                path: '/users/:id',
                responses: {
                    200: z.object({ success: z.boolean() }),
                },
            },
        });
        const usersContract = createContract(UsersTag, {
            health: healthContract,
        });
        const contract = createContract({ users: usersContract });
        const spec = generateJson(contract, baseConfig);
        expect(spec.paths['/users/{id}']?.delete?.tags).toEqual(['Users', 'Health']);
    });

    it('derives tags from contract keys when no CONTRACT_TAG is set', () => {
        const untaggedUsers = createContract({
            listUsers: {
                method: 'GET',
                path: '/users',
                responses: {
                    200: z.object({ ok: z.boolean() }),
                },
            },
        });
        const contract = createContract({ users: untaggedUsers });
        const spec = generateJson(contract, baseConfig);
        expect(spec.paths['/users']?.get?.tags).toEqual(['users']);
    });

    it('does not derive tags from contract keys when setTagsFromContractKeys is false', () => {
        const untaggedUsers = createContract({
            listUsers: {
                method: 'GET',
                path: '/users',
                responses: {
                    200: z.object({ ok: z.boolean() }),
                },
            },
        });
        const contract = createContract({ users: untaggedUsers });
        const spec = generateJson(contract, { ...baseConfig, setTagsFromContractKeys: false });
        expect(spec.paths['/users']?.get?.tags).toBeUndefined();
    });

    it('collects tag descriptions from contract into document tags', () => {
        const usersContract = createContract(UsersTagWithDescription, {
            listUsers: {
                method: 'GET',
                path: '/users',
                responses: {
                    200: z.object({
                        ok: z.boolean(),
                    }),
                },
            },
        });
        const contract = createContract({
            users: usersContract,
        });
        const spec = generateJson(contract, baseConfig);
        expect(spec.tags).toEqual([
            {
                name: 'Users',
                description: 'User management endpoints',
            },
        ]);
    });

    it('explicit CONTRACT_TAG takes precedence over key-derived tag', () => {
        const taggedUsers = createContract(UsersTag, {
            listUsers: {
                method: 'GET',
                path: '/users',
                responses: {
                    200: z.object({ ok: z.boolean() }),
                },
            },
        });
        const contract = createContract({ users: taggedUsers });
        const spec = generateJson(contract, baseConfig);
        expect(spec.paths['/users']?.get?.tags).toEqual(['Users']);
    });

    it('untagged sub-group inside tagged contract inherits the outer tag', () => {
        const usersContract = createContract(UsersTag, {
            nested: {
                listUsers: {
                    method: 'GET',
                    path: '/users',
                    responses: {
                        200: z.object({ users: z.array(z.string()) }),
                    },
                },
            },
        });
        const contract = createContract({ users: usersContract });
        const spec = generateJson(contract, baseConfig);
        expect(spec.paths['/users']?.get?.tags).toEqual(['Users']);
    });
});

describe('OpenAPI generator — HEAD method', () => {
    it('omits response content for HEAD routes', () => {
        const contract = createContract({
            checkUser: {
                method: 'HEAD',
                path: '/users/:id',
                responses: {
                    200: z.object({
                        id: z.string(),
                    }),
                    404: z.void(),
                },
            },
        });
        const spec = generateJson(contract, baseConfig);
        const headOp = spec.paths['/users/{id}']?.head;
        expect(headOp).toBeDefined();
        expect(headOp?.responses?.['200']?.content).toBeUndefined();
        expect(headOp?.responses?.['404']?.content).toBeUndefined();
    });

    it('OPTIONS routes emit response content normally', () => {
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
        const spec = generateJson(contract, baseConfig);
        const optionsOp = spec.paths['/users']?.options;
        expect(optionsOp).toBeDefined();
        expect(optionsOp?.responses?.['200']?.content).toBeDefined();
    });
});

describe('automatic validation error response', () => {
    const spec = generateJson(contract, baseConfig);

    it('adds 400 validation error to routes with body', () => {
        const response = spec.paths['/users']?.post?.responses?.['400'];
        expect(response).toBeDefined();
        expect(response?.description).toBe('Validation Error');
        const schema = response?.content?.['application/json']?.schema as Record<string, unknown> | undefined;
        expect(schema?.required).toContain('message');
        expect(schema?.required).toContain('issues');
        const properties = schema?.properties as Record<string, Record<string, unknown>> | undefined;
        expect(properties?.issues?.type).toBe('array');
    });

    it('adds 400 validation error to routes with query', () => {
        const response = spec.paths['/users']?.get?.responses?.['400'];
        expect(response).toBeDefined();
        expect(response?.description).toBe('Validation Error');
    });

    it('does not add 400 to routes without body or query', () => {
        const response = spec.paths['/users/{id}']?.get?.responses?.['400'];
        expect(response).toBeUndefined();
    });

    it('merges with a user-declared 400 using oneOf', () => {
        const contractWith400 = createContract({
            createItem: {
                method: 'POST',
                path: '/items',
                body: z.object({ name: z.string() }),
                responses: {
                    201: z.object({ id: z.string() }),
                    400: z.object({ error: z.string() }),
                },
            },
        });
        const spec = generateJson(contractWith400, baseConfig);
        const response = spec.paths['/items']?.post?.responses?.['400'];
        const schema = response?.content?.['application/json']?.schema as Record<string, unknown> | undefined;
        const oneOf = schema?.oneOf as Array<Record<string, unknown>> | undefined;
        expect(oneOf).toHaveLength(2);
        expect(oneOf?.[1]?.required).toContain('issues');
    });
});
