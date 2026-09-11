import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { Kizuna } from './kizuna.js';
import type { StreamBody, StreamMessageOf } from './stream.js';
import { readToolCalls } from './tool-records.js';
import { createToolRunner } from './tool-runner.js';
import type { ToolHandlers } from './tools.js';

const k = new Kizuna();

const tools = k.tools({
    weather: {
        getForecast: {
            description: 'Look up the forecast for one city',
            input: z.object({
                city: z.string(),
            }),
            output: z.object({
                tempC: z.number(),
            }),
        },
    },
    ping: {
        description: 'Answer that the server is up',
    },
});

const routes = k.routes({
    reply: {
        method: 'POST',
        path: '/assistant/reply',
        body: z.object({
            prompt: z.string(),
        }),
        responses: {
            200: {
                stream: {
                    delta: z.object({
                        text: z.string(),
                    }),
                },
                tools,
            },
        },
    },
});

const contract = k.contract({
    routes: {
        assistant: routes,
    },
    tools,
});

describe('tool events on a stream', () => {
    it('narrows a tool call to the named tool', () => {
        type Body = StreamBody<typeof contract.routes.assistant.reply, 200>;

        const body: Body = async function* () {
            yield {
                event: 'tool_call',
                data: {
                    id: 'call_1',
                    name: 'weather.getForecast',
                    input: {
                        city: 'Oslo',
                    },
                },
            };
            yield {
                event: 'tool_result',
                data: {
                    id: 'call_1',
                    name: 'weather.getForecast',
                    output: {
                        tempC: 14,
                    },
                },
            };
            yield {
                event: 'tool_error',
                data: {
                    id: 'call_1',
                    name: 'ping',
                    message: 'the clock is unset',
                },
            };
        };

        expectTypeOf(body).toBeFunction();
    });

    it('refuses an input that is not the named tool own', () => {
        type Body = StreamBody<typeof contract.routes.assistant.reply, 200>;

        // @ts-expect-error `region` is not a field of this tool's input
        const body: Body = async function* () {
            yield {
                event: 'tool_call',
                data: {
                    id: 'call_1',
                    name: 'weather.getForecast',
                    input: {
                        region: 'Oslo',
                    },
                },
            };
        };

        expectTypeOf<typeof body>().toEqualTypeOf<Body>();
    });

    it('gives a tool with no input no input field', () => {
        type Body = StreamBody<typeof contract.routes.assistant.reply, 200>;

        const body: Body = async function* () {
            yield {
                event: 'tool_call',
                data: {
                    id: 'call_1',
                    name: 'ping',
                },
            };
        };

        expectTypeOf(body).toBeFunction();
    });
});

describe('tool runner', () => {
    it('types run against the declared input and output', async () => {
        const runner = createToolRunner(contract, {
            weather: {
                getForecast: ({ input }) => {
                    expectTypeOf(input).toEqualTypeOf<{ city: string }>();
                    return {
                        tempC: 14,
                    };
                },
            },
            ping: ({ input }) => {
                expectTypeOf(input).toEqualTypeOf<undefined>();
            },
        });

        expectTypeOf(runner.weather.getForecast.run).parameter(0).toEqualTypeOf<{ city: string }>();
        expectTypeOf(await runner.weather.getForecast.run({ city: 'Oslo' })).toEqualTypeOf<{ tempC: number }>();
        expectTypeOf(await runner.ping.run()).toEqualTypeOf<void>();
    });

    it('narrows call to the result of the tool it names', async () => {
        const runner = createToolRunner(contract, {
            weather: {
                getForecast: () => ({
                    tempC: 14,
                }),
            },
            ping: () => undefined,
        });

        const result = await runner.call({
            id: 'call_1',
            name: 'weather.getForecast',
            input: {
                city: 'Oslo',
            },
        });

        expectTypeOf(result).toEqualTypeOf<{ id: string; name: 'weather.getForecast'; output: { tempC: number } }>();
    });
});

describe('readToolCalls', () => {
    it('narrows input and output to the tool that produced them', () => {
        type Message = StreamMessageOf<(typeof contract.routes.assistant.reply)['responses'][200]>;

        const tracked = readToolCalls([] as Message[]);

        for (const call of tracked) {
            expectTypeOf(call.id).toEqualTypeOf<string>();
            expectTypeOf(call.state).toEqualTypeOf<'running' | 'done' | 'failed'>();

            if (call.name === 'weather.getForecast') {
                expectTypeOf(call.input).toEqualTypeOf<{ city: string }>();
                expectTypeOf(call.output).toEqualTypeOf<{ tempC: number } | undefined>();
            }

            if (call.name === 'ping') {
                expectTypeOf(call.input).toEqualTypeOf<undefined>();
            }
        }
    });

    it('narrows the name to the declared tools', () => {
        type Message = StreamMessageOf<(typeof contract.routes.assistant.reply)['responses'][200]>;

        const tracked = readToolCalls([] as Message[]);
        expectTypeOf(tracked[0]!.name).toEqualTypeOf<'weather.getForecast' | 'ping'>();
    });
});

describe('a tool carries no authorization of its own', () => {
    const routes = k.routes({
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

    const declared = k.tools(({ fromRoute }) => ({
        find: fromRoute(routes.users.getUser),
        countWords: {
            description: 'Count the words in a piece of text',
            input: z.object({
                text: z.string(),
            }),
            output: z.object({
                words: z.int(),
            }),
        },
    }));

    it('gives a handler its input and throwError, and nothing else', () => {
        const handlers: ToolHandlers<typeof declared> = {
            countWords: (args) => {
                expectTypeOf<keyof typeof args>().toEqualTypeOf<'input' | 'throwError'>();
                return {
                    words: args.input.text.split(' ').length,
                };
            },
        };
        expectTypeOf(handlers).not.toBeNever();
    });

    it('asks for no handler for a tool that runs a route', () => {
        expectTypeOf<keyof ToolHandlers<typeof declared>>().toEqualTypeOf<'countWords'>();
    });
});

describe('routes that cannot be tools', () => {
    const streamRoutes = k.routes({
        reply: {
            method: 'POST',
            path: '/reply',
            body: z.object({
                prompt: z.string(),
            }),
            responses: {
                200: {
                    stream: {
                        delta: z.object({
                            text: z.string(),
                        }),
                    },
                },
            },
        },
        upload: {
            method: 'POST',
            path: '/upload',
            contentType: 'multipart/form-data',
            body: z.object({
                file: z.string(),
            }),
            responses: {
                200: z.object({
                    size: z.int(),
                }),
            },
        },
        ping: {
            method: 'GET',
            path: '/ping',
            responses: {
                200: z.object({
                    ok: z.boolean(),
                }),
            },
        },
    });

    it('refuses a streamed route where it is named', () => {
        // @ts-expect-error a stream has no single value to answer with
        k.tools.fromRoute(streamRoutes.reply);
    });

    it('refuses a route that reads a form body', () => {
        // @ts-expect-error a tool sends JSON, so there is nowhere to put a form
        k.tools.fromRoute(streamRoutes.upload);
    });

    it('takes an ordinary JSON route', () => {
        expectTypeOf(k.tools.fromRoute(streamRoutes.ping)).not.toBeNever();
    });
});
