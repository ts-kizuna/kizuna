import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import toBeAValidOpenAPIDefinition from 'jest-expect-openapi';
import { kizuna, createTags, type Contract } from '@ts-kizuna/core';
import { contractFingerprint } from '@ts-kizuna/core/generator';
import { writeKizunaDeprecations } from '../../cli/src/deprecation-parser.js';
import { generateOpenApi, type GenerateOpenApiOptions } from './generator.js';
import { contract as deprecatedContract } from '../../cli/src/deprecation.fixture.js';

const { k } = kizuna({
    tags: createTags({
        api: 'API',
    }),
});

const generateJson = (contract: Contract, options: GenerateOpenApiOptions) => generateOpenApi(contract, options)('json');

expect.extend({
    toBeAValidOpenAPIDefinition,
});

declare module 'vitest' {
    interface Matchers<T = any> {
        toBeAValidOpenAPIDefinition(transformer?: (spec: Record<string, unknown>) => Record<string, unknown>): Promise<T>;
    }
}

const contractRoutes = k.routes('api', {
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

const contract = k.contract({
    routes: contractRoutes,
});

const baseConfig = {
    info: {
        title: 'Test API',
        version: '1.0.0',
    },
};

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
        const nestedRoutes = k.routes('api', {
            users: {
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

        const nested = k.contract({
            routes: nestedRoutes,
        });

        const withTrue = generateJson(nested, { ...baseConfig, setOperationId: true });
        expect(withTrue.paths['/users/{id}']?.get?.operationId).toBe('getUser');

        const withConcatenated = generateJson(nested, { ...baseConfig, setOperationId: 'concatenated-path' });
        expect(withConcatenated.paths['/users/{id}']?.get?.operationId).toBe('users.getUser');
    });

    it('omits requestBody and response content for z.void()', () => {
        const voidContractRoutes = k.routes('api', {
            ping: {
                method: 'POST',
                path: '/ping/:id',
                body: z.void(),
                responses: {
                    204: z.void(),
                },
            },
        });

        const voidContract = k.contract({
            routes: voidContractRoutes,
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

    const taggedContractRoutes = k.routes('api', {
        getUser: {
            method: 'GET',
            path: '/users/:id',
            responses: {
                200: Tagged,
            },
        },
    });

    const taggedContract = k.contract({
        routes: taggedContractRoutes,
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
});

describe('operation metadata passthrough', () => {
    const annotatedRoutes = k.routes('api', {
        getUser: {
            method: 'GET',
            path: '/users/:id',
            tags: ['api'],
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

    const annotated = k.contract({
        routes: annotatedRoutes,
    });

    it('is a valid OpenAPI 3.1 document', async () => {
        const spec = generateJson(annotated, baseConfig);
        await expect(spec).toBeAValidOpenAPIDefinition();
    });

    it('emits route-level tags, security, externalDocs on the operation', () => {
        const spec = generateJson(deprecatedContract, baseConfig);
        const operation = spec.paths['/users/by-id/{id}']?.get;
        expect(operation?.tags).toEqual(['API', 'Users']);
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
            {
                name: 'API',
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

    it('merges route-level tags with the group tag', () => {
        const { k } = kizuna({
            tags: createTags({
                users: {
                    title: 'Users',
                },
                health: {
                    title: 'Health',
                },
            }),
        });
        const usersRoutes = k.routes('users', {
            getUser: {
                method: 'GET',
                path: '/users/:id',
                tags: ['health'],
                responses: {
                    200: z.object({
                        id: z.string(),
                    }),
                },
            },
        });
        const contract = k.contract({
            routes: usersRoutes,
        });
        const spec = generateJson(contract, baseConfig);
        expect(spec.paths['/users/{id}']?.get?.tags).toEqual(['Users', 'Health']);
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
        const routeRoutes = k.routes('api', {
            getMedia: {
                method: 'GET',
                path: '/media',
                responses: {
                    200: z.discriminatedUnion('type', [Image, Video]),
                },
            },
        });

        const route = k.contract({
            routes: routeRoutes,
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
        const routeRoutes = k.routes('api', {
            getMedia: {
                method: 'GET',
                path: '/media',
                responses: {
                    200: z.discriminatedUnion('type', [Image, Video]),
                },
            },
        });

        const route = k.contract({
            routes: routeRoutes,
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
        const routeRoutes = k.routes('api', {
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

        const route = k.contract({
            routes: routeRoutes,
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
        const routeRoutes = k.routes('api', {
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

        const route = k.contract({
            routes: routeRoutes,
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
        const routeRoutes = k.routes('api', {
            getOne: {
                method: 'GET',
                path: '/plain-union',
                responses: {
                    200: z.union([z.string(), z.number()]),
                },
            },
        });

        const route = k.contract({
            routes: routeRoutes,
        });
        const spec = generateJson(route, baseConfig);
        const schema = spec.paths['/plain-union']?.get?.responses['200']?.content?.['application/json']?.schema as Record<string, unknown>;
        expect(schema?.discriminator).toBeUndefined();
    });
});

describe('request body content types', () => {
    it('is a valid OpenAPI 3.1 document', async () => {
        const routeRoutes = k.routes('api', {
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

        const route = k.contract({
            routes: routeRoutes,
        });
        await expect(generateJson(route, baseConfig)).toBeAValidOpenAPIDefinition();
    });

    it('emits multipart/form-data when contentType is set, with format: binary for File fields', () => {
        const routeRoutes = k.routes('api', {
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

        const route = k.contract({
            routes: routeRoutes,
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
        const routeRoutes = k.routes('api', {
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

        const route = k.contract({
            routes: routeRoutes,
        });
        const spec = generateJson(route, baseConfig);
        const body = spec.paths['/form']?.post?.requestBody;
        expect(body?.content?.['application/x-www-form-urlencoded']).toBeDefined();
        expect(body?.content?.['application/json']).toBeUndefined();
    });

    it('defaults to application/json when contentType is not set', () => {
        const routeRoutes = k.routes('api', {
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

        const route = k.contract({
            routes: routeRoutes,
        });
        const spec = generateJson(route, baseConfig);
        expect(spec.paths['/users']?.post?.requestBody?.content?.['application/json']).toBeDefined();
    });
});

describe('transform field handling', () => {
    it('uses input schema for request body transform fields', () => {
        const contractRoutes = k.routes('api', {
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

        const contract = k.contract({
            routes: contractRoutes,
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
        const contractRoutes = k.routes('api', {
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

        const contract = k.contract({
            routes: contractRoutes,
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
        const insaneRoutes = k.routes('api', {
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

        const insane = k.contract({
            routes: insaneRoutes,
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
        const contractRoutes = k.routes('api', {
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

        const contract = k.contract({
            routes: contractRoutes,
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
    it('applies the group tag to all routes in that group', () => {
        const { k } = kizuna({
            tags: createTags({
                users: {
                    title: 'Users',
                },
            }),
        });
        const usersRoutes = k.routes('users', {
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
        const contract = k.contract({
            routes: usersRoutes,
        });
        const spec = generateJson(contract, baseConfig);
        expect(spec.paths['/users']?.get?.tags).toEqual(['Users']);
        expect(spec.paths['/users']?.post?.tags).toEqual(['Users']);
    });

    it('accumulates tags from nested tagged groups', () => {
        const { k } = kizuna({
            tags: createTags({
                users: {
                    title: 'Users',
                },
                health: {
                    title: 'Health',
                },
            }),
        });
        const healthRoutes = k.routes('health', {
            deleteUser: {
                method: 'DELETE',
                path: '/users/:id',
                responses: {
                    200: z.object({ success: z.boolean() }),
                },
            },
        });
        const usersRoutes = k.routes('users', {
            health: healthRoutes,
        });
        const contract = k.contract({
            routes: usersRoutes,
        });
        const spec = generateJson(contract, baseConfig);
        expect(spec.paths['/users/{id}']?.delete?.tags).toEqual(['Users', 'Health']);
    });

    it('collects tag descriptions into the document tags', () => {
        const { k } = kizuna({
            tags: createTags({
                users: {
                    title: 'Users',
                    description: 'User management endpoints',
                },
            }),
        });
        const usersRoutes = k.routes('users', {
            listUsers: {
                method: 'GET',
                path: '/users',
                responses: {
                    200: z.object({ ok: z.boolean() }),
                },
            },
        });
        const contract = k.contract({
            routes: usersRoutes,
        });
        const spec = generateJson(contract, baseConfig);
        expect(spec.tags).toEqual([
            {
                name: 'Users',
                description: 'User management endpoints',
            },
        ]);
    });

    it('an untagged sub-group inside a tagged group inherits the outer tag', () => {
        const { k } = kizuna({
            tags: createTags({
                users: {
                    title: 'Users',
                },
            }),
        });
        const usersRoutes = k.routes('users', {
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
        const contract = k.contract({
            routes: usersRoutes,
        });
        const spec = generateJson(contract, baseConfig);
        expect(spec.paths['/users']?.get?.tags).toEqual(['Users']);
    });
});

describe('OpenAPI generator — HEAD method', () => {
    it('omits response content for HEAD routes', () => {
        const contractRoutes = k.routes('api', {
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

        const contract = k.contract({
            routes: contractRoutes,
        });
        const spec = generateJson(contract, baseConfig);
        const headOp = spec.paths['/users/{id}']?.head;
        expect(headOp).toBeDefined();
        expect(headOp?.responses?.['200']?.content).toBeUndefined();
        expect(headOp?.responses?.['404']?.content).toBeUndefined();
    });

    it('OPTIONS routes emit response content normally', () => {
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
        expect(response?.description).toBe('Bad Request');
        const schema = response?.content?.['application/problem+json']?.schema as Record<string, unknown> | undefined;
        expect(schema?.required).toContain('detail');
        expect(schema?.required).toContain('errors');
        const properties = schema?.properties as Record<string, Record<string, unknown>> | undefined;
        expect(properties?.errors?.type).toBe('array');
    });

    it('adds 400 validation error to routes with query', () => {
        const response = spec.paths['/users']?.get?.responses?.['400'];
        expect(response).toBeDefined();
        expect(response?.description).toBe('Bad Request');
    });

    it('does not add 400 to routes without body or query', () => {
        const response = spec.paths['/users/{id}']?.get?.responses?.['400'];
        expect(response).toBeUndefined();
    });

    it('merges with a user-declared 400 using oneOf', () => {
        const contractWith400Routes = k.routes('api', {
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

        const contractWith400 = k.contract({
            routes: contractWith400Routes,
        });
        const spec = generateJson(contractWith400, baseConfig);
        const response = spec.paths['/items']?.post?.responses?.['400'];
        const schema = response?.content?.['application/problem+json']?.schema as Record<string, unknown> | undefined;
        const oneOf = schema?.oneOf as Array<Record<string, unknown>> | undefined;
        expect(oneOf).toHaveLength(2);
        expect(oneOf?.[1]?.required).toContain('errors');
    });
});

describe('deprecation on a component reached via the schemas map', () => {
    const UserSchema = z
        .object({
            id: z.string(),
            email: z.string(),
        })
        .meta({ id: 'User' });
    const AccountSchema = z
        .object({
            owner: z.object({
                user: UserSchema,
            }),
        })
        .meta({ id: 'Account' });
    const contractWithRefRoutes = k.routes('api', {
        getAccount: {
            method: 'GET',
            path: '/account',
            responses: {
                200: AccountSchema,
            },
        },
    });

    const contractWithRef = k.contract({
        routes: contractWithRefRoutes,
    });

    it('deprecates a field on a component only reachable through the schemas map', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kizuna-openapi-ref-'));
        fs.mkdirSync(path.join(dir, '.kizuna'), { recursive: true });
        fs.writeFileSync(
            path.join(dir, '.kizuna', 'deprecations.json'),
            JSON.stringify({
                [contractFingerprint(contractWithRef)]: {
                    routes: {},
                    fields: {},
                    schemas: { User: { email: 'use `email_address`' } },
                },
            })
        );
        const previousCwd = process.cwd();
        process.chdir(dir);
        try {
            const spec = generateJson(contractWithRef, baseConfig);
            const userSchema = spec.components?.schemas?.User as Record<string, Record<string, Record<string, unknown>>> | undefined;
            expect(userSchema?.properties?.['email']?.deprecated).toBe(true);
        } finally {
            process.chdir(previousCwd);
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('deprecation from .kizuna', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kizuna-openapi-'));
    const previousCwd = process.cwd();

    beforeAll(() => {
        writeKizunaDeprecations(
            [{ contract: deprecatedContract, contractPath: path.resolve(import.meta.dirname, '../../cli/src/deprecation.fixture.ts') }],
            path.join(workDir, '.kizuna')
        );
        process.chdir(workDir);
    });

    afterAll(() => {
        process.chdir(previousCwd);
    });

    it('marks a deprecated field on its component schema', () => {
        const spec = generateJson(deprecatedContract, baseConfig);
        const userSchema = spec.components?.schemas?.User as Record<string, unknown> | undefined;
        const properties = (userSchema?.properties ?? {}) as Record<string, Record<string, unknown>>;
        expect(properties['email']?.deprecated).toBe(true);
    });

    it('marks a deprecated route operation', () => {
        const spec = generateJson(deprecatedContract, baseConfig);
        expect(spec.paths['/users/by-id/{id}']?.get?.deprecated).toBe(true);
    });
});

describe('error response media type (RFC 9457)', () => {
    const contractWithErrorsRoutes = k.routes('api', {
        getUser: {
            method: 'GET',
            path: '/users/{id}',
            params: z.object({ id: z.string() }),
            responses: {
                200: z.object({ id: z.string() }),
                404: z.object({
                    type: z.string(),
                    title: z.string(),
                    status: z.number().int(),
                    detail: z.string(),
                }),
                500: z.object({
                    type: z.string(),
                    title: z.string(),
                    status: z.number().int(),
                    detail: z.string(),
                }),
            },
        },
    });

    const contractWithErrors = k.contract({
        routes: contractWithErrorsRoutes,
    });
    const spec = generateJson(contractWithErrors, baseConfig);
    const responses = spec.paths['/users/{id}']?.get?.responses;

    it('keeps success responses on application/json', () => {
        expect(responses?.['200']?.content?.['application/json']).toBeDefined();
        expect(responses?.['200']?.content?.['application/problem+json']).toBeUndefined();
    });

    it('emits 4xx responses as application/problem+json', () => {
        expect(responses?.['404']?.content?.['application/problem+json']?.schema).toBeDefined();
        expect(responses?.['404']?.content?.['application/json']).toBeUndefined();
    });

    it('emits 5xx responses as application/problem+json', () => {
        expect(responses?.['500']?.content?.['application/problem+json']?.schema).toBeDefined();
        expect(responses?.['500']?.content?.['application/json']).toBeUndefined();
    });

    it('still applies field-level deprecation to an error response under application/problem+json', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kizuna-openapi-err-'));
        fs.mkdirSync(path.join(dir, '.kizuna'), { recursive: true });
        fs.writeFileSync(
            path.join(dir, '.kizuna', 'deprecations.json'),
            JSON.stringify({
                [contractFingerprint(contractWithErrors)]: {
                    routes: {},
                    fields: { getUser: { 'responses.404.detail': '' } },
                },
            })
        );
        const previousCwd = process.cwd();
        process.chdir(dir);
        try {
            const deprecatedSpec = generateJson(contractWithErrors, baseConfig);
            const errorSchema = deprecatedSpec.paths['/users/{id}']?.get?.responses?.['404']?.content?.['application/problem+json']
                ?.schema as Record<string, Record<string, Record<string, unknown>>> | undefined;
            expect(errorSchema?.properties?.['detail']?.deprecated).toBe(true);
        } finally {
            process.chdir(previousCwd);
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('declared response contentType', () => {
    const contractWithContentTypeRoutes = k.routes('api', {
        exportUsers: {
            method: 'GET',
            path: '/users/export',
            responses: {
                200: {
                    body: z.string(),
                    contentType: 'text/csv',
                },
            },
        },
        getUser: {
            method: 'GET',
            path: '/users/{id}',
            params: z.object({ id: z.string() }),
            responses: {
                200: {
                    body: z.object({ id: z.string() }),
                },
            },
        },
    });

    const contractWithContentType = k.contract({
        routes: contractWithContentTypeRoutes,
    });
    const spec = generateJson(contractWithContentType, baseConfig);

    it('uses the declared media type for the response', () => {
        const response = spec.paths['/users/export']?.get?.responses?.['200'];
        expect(response?.content?.['text/csv']?.schema).toBeDefined();
        expect(response?.content?.['application/json']).toBeUndefined();
    });

    it('defaults to application/json when contentType is omitted on the object form', () => {
        const response = spec.paths['/users/{id}']?.get?.responses?.['200'];
        expect(response?.content?.['application/json']?.schema).toBeDefined();
    });
});

describe('binary response bodies', () => {
    const binaryContractRoutes = k.routes('api', {
        downloadBadge: {
            method: 'GET',
            path: '/badge',
            responses: {
                200: {
                    body: z.instanceof(Uint8Array),
                    contentType: 'application/pdf',
                },
            },
        },
    });

    const binaryContract = k.contract({
        routes: binaryContractRoutes,
    });
    const spec = generateJson(binaryContract, baseConfig);

    it('emits type: string, format: binary under the declared media type', () => {
        const schema = spec.paths['/badge']?.get?.responses?.['200']?.content?.['application/pdf']?.schema as
            | Record<string, unknown>
            | undefined;
        expect(schema).toEqual({ type: 'string', format: 'binary' });
    });
});
