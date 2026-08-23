import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { Kizuna } from './kizuna.js';
import type { InferModels } from './infer.js';

const k = new Kizuna();

const UserSchema = Kizuna.model({
    title: 'User',
    schema: z.object({
        id: z.string(),
        name: z.string(),
    }),
});

const CreateUserSchema = Kizuna.model({
    title: 'CreateUserInput',
    schema: z.object({
        name: z.string(),
    }),
});

test('a contract publishes its models under their titles', () => {
    const contract = k.contract({
        routes: k.routes({
            users: {
                getUser: {
                    method: 'GET',
                    path: '/users/:id',
                    responses: {
                        200: UserSchema,
                    },
                },
                createUser: {
                    method: 'POST',
                    path: '/users',
                    body: CreateUserSchema,
                    responses: {
                        201: UserSchema,
                    },
                },
            },
        }),
    });

    expectTypeOf<keyof InferModels<typeof contract>>().toEqualTypeOf<'User' | 'CreateUserInput'>();
    expectTypeOf<InferModels<typeof contract>['User']>().toEqualTypeOf<{
        id: string;
        name: string;
    }>();
});

test('a model wrapped in an array, an optional, or a union still publishes', () => {
    const EventKind = Kizuna.model({
        title: 'EventKind',
        schema: z.enum(['login', 'logout']),
    });
    const ErrorSchema = Kizuna.model({
        title: 'NotFound',
        schema: z.object({
            detail: z.string(),
        }),
    });

    const contract = k.contract({
        routes: k.routes({
            events: {
                listEvents: {
                    method: 'GET',
                    path: '/events',
                    query: z.object({
                        kind: EventKind.optional(),
                    }),
                    responses: {
                        200: z.array(UserSchema),
                        404: z.union([ErrorSchema, z.null()]),
                    },
                },
            },
        }),
    });

    expectTypeOf<keyof InferModels<typeof contract>>().toEqualTypeOf<'EventKind' | 'User' | 'NotFound'>();
    expectTypeOf<InferModels<typeof contract>['EventKind']>().toEqualTypeOf<'login' | 'logout'>();
});

test('a model nested inside another model publishes on its own', () => {
    const AvatarSchema = Kizuna.model({
        title: 'Avatar',
        schema: z.object({
            url: z.string(),
        }),
    });
    const ProfileSchema = Kizuna.model({
        title: 'Profile',
        schema: z.object({
            avatar: AvatarSchema.nullable(),
        }),
    });

    const contract = k.contract({
        routes: k.routes({
            profiles: {
                getProfile: {
                    method: 'GET',
                    path: '/profile',
                    responses: {
                        200: ProfileSchema,
                    },
                },
            },
        }),
    });

    expectTypeOf<keyof InferModels<typeof contract>>().toEqualTypeOf<'Profile' | 'Avatar'>();
});

test('the object response form publishes its body and header models', () => {
    const HeadersSchema = Kizuna.model({
        title: 'RateLimitHeaders',
        schema: z.object({
            'x-rate-limit': z.string(),
        }),
    });

    const contract = k.contract({
        routes: k.routes({
            users: {
                createUser: {
                    method: 'POST',
                    path: '/users',
                    responses: {
                        201: {
                            body: UserSchema,
                            headers: HeadersSchema,
                        },
                    },
                },
            },
        }),
    });

    expectTypeOf<keyof InferModels<typeof contract>>().toEqualTypeOf<'User' | 'RateLimitHeaders'>();
});

test('a job publishes the models on its input and its responses', () => {
    const ReportSchema = Kizuna.model({
        title: 'Report',
        schema: z.object({
            rows: z.number(),
        }),
    });

    const contract = k.contract({
        routes: k.routes({
            users: {
                listUsers: {
                    method: 'GET',
                    path: '/users',
                    responses: {
                        200: z.array(UserSchema),
                    },
                },
            },
        }),
        jobs: k.jobs({
            buildReport: {
                input: CreateUserSchema,
                result: ReportSchema,
                handler: () => ({
                    rows: 1,
                }),
            },
        }),
    });

    expectTypeOf<keyof InferModels<typeof contract>>().toEqualTypeOf<'User' | 'CreateUserInput' | 'Report' | 'ProblemDetails'>();
});

test('a contract with no models publishes nothing', () => {
    const contract = k.contract({
        routes: k.routes({
            health: {
                check: {
                    method: 'GET',
                    path: '/health',
                    responses: {
                        200: z.object({
                            status: z.string(),
                        }),
                    },
                },
            },
        }),
    });

    expectTypeOf<keyof InferModels<typeof contract>>().toEqualTypeOf<never>();
});
