import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Kizuna } from './kizuna.js';
import {
    bindToolRunner,
    createToolRunner,
    modelFacingTools,
    ToolIdentityError,
    ToolInputError,
    ToolRequestContextError,
    ToolOutputError,
} from './tool-runner.js';
import type { ToolHandlers } from './tools.js';

const k = new Kizuna();

const tools = k.tools({
    weather: {
        getForecast: {
            title: 'Weather forecast',
            description: 'Look up the forecast for one city',
            input: z.object({
                city: z.string(),
            }),
            output: z.object({
                tempC: z.number(),
            }),
            annotations: {
                readOnlyHint: true,
            },
        },
    },
    ping: {
        description: 'Answer that the server is up',
    },
});

type Handlers = ToolHandlers<typeof tools>;

const handlers: Handlers = {
    weather: {
        getForecast: ({ input }) => ({
            status: 200,
            body: {
                tempC: input.city === 'Oslo' ? 14 : 20,
            },
        }),
    },
    ping: () => undefined,
};

const runner = () => createToolRunner({ tools }, handlers);

describe('createToolRunner', () => {
    it('runs a tool by its place in the tree', async () => {
        await expect(runner().weather.getForecast.run({ city: 'Oslo' })).resolves.toEqual({
            status: 200,
            body: {
                tempC: 14,
            },
        });
    });

    it('runs a tool that takes no arguments', async () => {
        await expect(runner().ping.run()).resolves.toEqual({
            status: 204,
        });
    });

    it('validates the input before the handler sees it', async () => {
        const seen = vi.fn();
        const strict = createToolRunner(
            { tools },
            {
                weather: {
                    getForecast: (args) => {
                        seen(args);
                        return {
                            status: 200,
                            body: {
                                tempC: 1,
                            },
                        };
                    },
                },
                ping: () => undefined,
            }
        );

        await expect(strict.weather.getForecast.run({ city: 14 } as unknown as { city: string })).rejects.toBeInstanceOf(ToolInputError);
        expect(seen).not.toHaveBeenCalled();
    });

    it('validates what the handler returned', async () => {
        const wrong = createToolRunner(
            { tools },
            {
                weather: {
                    getForecast: (() => ({ tempC: 'warm' })) as unknown as Handlers['weather']['getForecast'],
                },
                ping: () => undefined,
            }
        );

        await expect(wrong.weather.getForecast.run({ city: 'Oslo' })).rejects.toBeInstanceOf(ToolOutputError);
    });

    it('turns throwError into the response it names', async () => {
        const failing = createToolRunner({ tools }, {
            weather: {
                getForecast: ({ throwError }) => throwError({ status: 422, body: { detail: 'No station reports for that city.' } }),
            },
            ping: () => undefined,
        } as Handlers);

        await expect(failing.weather.getForecast.run({ city: 'Nowhere' })).resolves.toEqual({
            status: 422,
            detail: 'No station reports for that city.',
        });
    });

    it('refuses with a status it declared under failures', async () => {
        const declared = k.tools({
            findUser: {
                description: 'Look one user up by id',
                input: z.object({
                    id: z.string(),
                }),
                output: z.object({
                    name: z.string(),
                }),
                failures: [404],
            },
        });

        const missing = createToolRunner(
            { tools: declared },
            {
                findUser: ({ throwError }) =>
                    throwError({
                        status: 404,
                        body: {
                            detail: 'No user with that id.',
                        },
                    }),
            }
        );

        await expect(missing.findUser.run({ id: '9' })).resolves.toEqual({
            status: 404,
            detail: 'No user with that id.',
        });
    });

    it('refuses a status the tool does not declare, naming the ones it does', async () => {
        const wrong = createToolRunner({ tools }, {
            weather: {
                getForecast: ({ throwError }: { throwError: (response: unknown) => never }) =>
                    throwError({
                        status: 404,
                        body: {
                            detail: 'No station there.',
                        },
                    }),
            },
            ping: () => undefined,
        } as unknown as Handlers);

        await expect(wrong.weather.getForecast.run({ city: 'Nowhere' })).rejects.toMatchObject({
            name: 'ToolOutputError',
            issues: [
                expect.objectContaining({
                    path: ['status'],
                    message: expect.stringContaining('200, 422, 500, 503'),
                }),
            ],
        });
    });

    it('rejects a non-error status under failures', () => {
        expect(() =>
            k.tools({
                findUser: {
                    description: 'Look one user up by id',
                    output: z.object({
                        name: z.string(),
                    }),
                    failures: [201],
                },
            })
        ).toThrow(/not a 4xx or 5xx/);
    });

    it('throws when no handler was bound', async () => {
        const bare = createToolRunner({ tools }, { ping: () => undefined } as unknown as Handlers);
        await expect(bare.weather.getForecast.run({ city: 'Oslo' })).rejects.toThrow(/No handler was bound for tool "weather.getForecast"/);
    });
});

describe('call', () => {
    it('runs the tool a call names and answers the matching result', async () => {
        await expect(
            runner().call({
                id: 'toolu_01',
                name: 'weather.getForecast',
                input: {
                    city: 'Oslo',
                },
            })
        ).resolves.toEqual({
            id: 'toolu_01',
            name: 'weather.getForecast',
            output: {
                status: 200,
                body: {
                    tempC: 14,
                },
            },
        });
    });

    it('answers 204 for a tool reporting nothing', async () => {
        await expect(
            runner().call({
                id: 'toolu_02',
                name: 'ping',
            })
        ).resolves.toEqual({
            id: 'toolu_02',
            name: 'ping',
            output: {
                status: 204,
            },
        });
    });

    it('throws on a call naming a tool the contract does not declare', async () => {
        const stray = { id: 'toolu_03', name: 'weather.getHistory' } as unknown as { id: string; name: 'ping' };
        await expect(runner().call(stray)).rejects.toThrow(/No tool named "weather.getHistory"/);
    });
});

describe('keyOf', () => {
    it('maps a published name back to its dotted key', () => {
        expect(runner().keyOf('weather_get_forecast')).toBe('weather.getForecast');
        expect(runner().keyOf('ping')).toBe('ping');
    });

    it('throws on a name nothing publishes, listing what does', () => {
        expect(() => runner().keyOf('weather_get_history')).toThrow(/weather_get_forecast, ping/);
    });
});

describe('modelFacingTools', () => {
    it('shapes every tool the way MCP declares one', () => {
        const shaped = modelFacingTools(tools);

        expect(shaped.map(({ name }) => name)).toEqual(['weather_get_forecast', 'ping']);
        expect(shaped[0]).toMatchObject({
            title: 'Weather forecast',
            description: 'Look up the forecast for one city',
            annotations: {
                readOnlyHint: true,
            },
        });
        expect(shaped[0]!.inputSchema.required).toEqual(['city']);
    });

    it('shows a model the envelope, whatever the tool answers', () => {
        const shaped = modelFacingTools(tools);
        const forecast = shaped[0]!.outputSchema as { properties: Record<string, unknown>; required: string[] };
        const ping = shaped[1]!.outputSchema as { properties: Record<string, unknown>; required: string[] };

        expect(Object.keys(forecast.properties)).toEqual(['status', 'body', 'detail']);
        expect(forecast.required).toEqual(['status']);

        // A tool reporting nothing has only a status and a reason.
        expect(Object.keys(ping.properties)).toEqual(['status', 'detail']);
    });
});

describe('dispatch', () => {
    it('runs a call the model named by its published name', async () => {
        await expect(
            runner().dispatch({
                id: 'call_1',
                name: 'weather_get_forecast',
                input: {
                    city: 'Oslo',
                },
            })
        ).resolves.toEqual({
            ok: true,
            id: 'call_1',
            name: 'weather.getForecast',
            output: {
                status: 200,
                body: {
                    tempC: 14,
                },
            },
        });
    });

    it('runs a call the model named by its dotted key', async () => {
        await expect(
            runner().dispatch({
                id: 'call_1',
                name: 'weather.getForecast',
                input: {
                    city: 'Bergen',
                },
            })
        ).resolves.toEqual({
            ok: true,
            id: 'call_1',
            name: 'weather.getForecast',
            output: {
                status: 200,
                body: {
                    tempC: 20,
                },
            },
        });
    });

    it('answers an unknown name without throwing, and lists what there is', async () => {
        const outcome = await runner().dispatch({
            id: 'call_1',
            name: 'weather_get_forecastt',
        });

        expect(outcome.ok).toBe(false);
        expect(outcome).toMatchObject({
            id: 'call_1',
            name: 'weather_get_forecastt',
        });
        expect(outcome.ok === false && outcome.message).toContain('weather_get_forecast');
    });

    it('names the fields a model got wrong, so it can correct them', async () => {
        const outcome = await runner().dispatch({
            id: 'call_1',
            name: 'weather.getForecast',
            input: {
                city: 42,
            },
        });

        expect(outcome.ok).toBe(false);
        expect(outcome.ok === false && outcome.message).toContain('city:');
    });

    it('carries a handler failure in the envelope, so a model reads the status', async () => {
        const failing = createToolRunner({ tools }, {
            weather: {
                getForecast: ({ throwError }) => throwError({ status: 422, body: { detail: 'Name a city to look the forecast up for.' } }),
            },
            ping: () => undefined,
        } as Handlers);

        const outcome = await failing.dispatch({
            id: 'call_1',
            name: 'weather.getForecast',
            input: {
                city: 'Oslo',
            },
        });

        expect(outcome).toEqual({
            ok: true,
            id: 'call_1',
            name: 'weather.getForecast',
            output: {
                status: 422,
                detail: 'Name a city to look the forecast up for.',
            },
        });
    });

    it('generates an id when the caller has none', async () => {
        const outcome = await runner().dispatch({
            name: 'ping',
        });

        expect(outcome.ok).toBe(true);
        expect(typeof outcome.id).toBe('string');
        expect(outcome.id.length).toBeGreaterThan(0);
    });
});

describe('emit', () => {
    const collect = async (messages: AsyncIterable<unknown>): Promise<unknown[]> => {
        const seen: unknown[] = [];
        for await (const message of messages) seen.push(message);
        return seen;
    };

    it('yields the call, then the result', async () => {
        await expect(
            collect(
                runner().emit({
                    id: 'call_1',
                    name: 'weather.getForecast',
                    input: {
                        city: 'Oslo',
                    },
                })
            )
        ).resolves.toEqual([
            {
                event: 'tool_call',
                data: {
                    id: 'call_1',
                    name: 'weather.getForecast',
                    input: {
                        city: 'Oslo',
                    },
                },
            },
            {
                event: 'tool_result',
                data: {
                    id: 'call_1',
                    name: 'weather.getForecast',
                    output: {
                        status: 200,
                        body: {
                            tempC: 14,
                        },
                    },
                },
            },
        ]);
    });

    it('yields the call, then the error, and never throws', async () => {
        await expect(
            collect(
                runner().emit({
                    id: 'call_1',
                    name: 'nope',
                })
            )
        ).resolves.toMatchObject([
            {
                event: 'tool_call',
                data: {
                    id: 'call_1',
                    name: 'nope',
                },
            },
            {
                event: 'tool_error',
                data: {
                    id: 'call_1',
                    name: 'nope',
                },
            },
        ]);
    });

    it('carries a 204 for a tool that reports nothing', async () => {
        await expect(
            collect(
                runner().emit({
                    id: 'call_1',
                    name: 'ping',
                })
            )
        ).resolves.toEqual([
            {
                event: 'tool_call',
                data: {
                    id: 'call_1',
                    name: 'ping',
                },
            },
            {
                event: 'tool_result',
                data: {
                    id: 'call_1',
                    name: 'ping',
                    output: {
                        status: 204,
                    },
                },
            },
        ]);
    });
});

describe('modelFacingTools', () => {
    it('refuses an input schema that does not describe an object', () => {
        const bad = k.tools({
            shout: {
                description: 'Shout a word back',
                input: z.string(),
            },
        });

        expect(() => modelFacingTools(bad)).toThrow(/not an object/);
    });
});

describe('a tool that changes things', () => {
    const secured = new Kizuna({
        identities: {
            member: Kizuna.identity.apiKey({
                name: 'x-workspace-token',
                in: 'header',
                context: z.object({
                    workspaceId: z.string(),
                }),
                roles: Kizuna.roles(['owner', 'admin']),
            }),
        },
    });

    const declared = secured.tools({
        purgeCache: {
            description: 'Drop every cached report. There is no undo.',
            output: z.object({
                dropped: z.int(),
            }),
            annotations: {
                destructiveHint: true,
            },
        },
        countWords: {
            description: 'Count the words in a piece of text',
            input: z.object({
                text: z.string(),
            }),
            output: z.object({
                words: z.int(),
            }),
        },
    });

    const guardedContract = secured.contract({
        routes: secured.routes({
            health: {
                method: 'GET',
                path: '/health',
                responses: {
                    200: z.object({
                        ok: z.boolean(),
                    }),
                },
            },
        }),
        tools: declared,
        toolAccessControl: secured.accessControl.tools(declared, {
            purgeCache: {
                auth: 'member',
                roles: 'owner',
            },
        }),
        accessControl: {
            health: false,
        },
    });

    const guarded = guardedContract.tools!;

    const guardedHandlers = {
        purgeCache: () => ({
            status: 200,
            body: {
                dropped: 12,
            },
        }),
        countWords: ({ input }: { input: { text: string } }) => ({
            status: 200,
            body: {
                words: input.text.split(' ').length,
            },
        }),
    };

    const bound = (auth?: Record<string, unknown>) => {
        const base = createToolRunner({ tools: guarded }, guardedHandlers as never);
        return auth === undefined ? base : bindToolRunner(base, { auth });
    };

    it('refuses to run when nobody has been bound', async () => {
        await expect(
            (bound() as never as typeof declared & { purgeCache: { run: () => Promise<unknown> } }).purgeCache.run()
        ).rejects.toBeInstanceOf(ToolIdentityError);
    });

    it('refuses a caller whose role the tool does not accept', async () => {
        const outcome = await bound({
            member: {
                workspaceId: 'w_1',
                role: 'admin',
            },
        }).dispatch({
            id: 'call_1',
            name: 'purgeCache',
        });

        expect(outcome.ok).toBe(false);
        expect(outcome.ok === false && outcome.message).toContain('owner');
    });

    it('runs for a caller whose role it accepts', async () => {
        await expect(
            bound({
                member: {
                    workspaceId: 'w_1',
                    role: 'owner',
                },
            }).purgeCache.run()
        ).resolves.toEqual({
            status: 200,
            body: {
                dropped: 12,
            },
        });
    });

    it('hands the verified caller to the handler under its own name', async () => {
        const seen: unknown[] = [];
        const runner = bindToolRunner(
            createToolRunner({ tools: guarded }, {
                purgeCache: ({ auth }: { auth: unknown }) => {
                    seen.push(auth);
                    return {
                        status: 200,
                        body: {
                            dropped: 0,
                        },
                    };
                },
                countWords: guardedHandlers.countWords,
            } as never),
            {
                auth: {
                    member: {
                        workspaceId: 'w_1',
                        role: 'owner',
                    },
                },
            }
        );

        await runner.purgeCache.run();

        expect(seen).toEqual([
            {
                member: {
                    workspaceId: 'w_1',
                    role: 'owner',
                },
            },
        ]);
    });

    it('leaves a tool that needs nobody runnable unbound', async () => {
        await expect(
            bound().countWords.run({
                text: 'a b c',
            })
        ).resolves.toEqual({
            status: 200,
            body: {
                words: 3,
            },
        });
    });
});

describe('emit ordering', () => {
    it('yields the call before the work finishes', async () => {
        const slow = k.tools({
            wait: {
                description: 'Takes a moment',
                output: z.object({
                    done: z.boolean(),
                }),
            },
        });

        const slowRunner = createToolRunner({ tools: slow }, {
            wait: async () => {
                await new Promise((resolve) => setTimeout(resolve, 50));
                return {
                    status: 200,
                    body: {
                        done: true,
                    },
                };
            },
        } as never);

        const seen: Array<{ event: string; elapsed: number }> = [];
        const started = Date.now();
        for await (const message of slowRunner.emit({ id: 'call_1', name: 'wait' })) {
            seen.push({
                event: message.event,
                elapsed: Date.now() - started,
            });
        }

        expect(seen.map(({ event }) => event)).toEqual(['tool_call', 'tool_result']);
        expect(seen[0]!.elapsed).toBeLessThan(40);
        expect(seen[1]!.elapsed).toBeGreaterThanOrEqual(40);
    });

    it('yields the call for an unknown name before answering the error', async () => {
        const seen: string[] = [];
        for await (const message of runner().emit({ id: 'call_1', name: 'nope' })) {
            seen.push(message.event);
        }

        expect(seen).toEqual(['tool_call', 'tool_error']);
    });
});

describe('request context', () => {
    const traced = new Kizuna({
        requestContext: {
            analytics: Kizuna.requestContext({
                context: z.object({
                    traceId: z.string(),
                }),
            }),
        },
    });

    const tracedTools = traced.tools({
        record: {
            description: 'Record an event against the caller trace',
            output: z.object({
                traceId: z.string(),
            }),
        },
    });

    const tracedRunner = () =>
        createToolRunner({ tools: tracedTools }, {
            record: ({ requestContext }: { requestContext: { analytics: { traceId: string } } }) => ({
                status: 200,
                body: {
                    traceId: requestContext.analytics.traceId,
                },
            }),
        } as never);

    it('hands a handler what the request already resolved', async () => {
        const bound = bindToolRunner(tracedRunner(), {
            requestContext: {
                analytics: {
                    traceId: 'trace_7',
                },
            },
        });

        await expect(bound.record.run()).resolves.toEqual({
            status: 200,
            body: {
                traceId: 'trace_7',
            },
        });
    });

    it('names the failure when a contract declares providers and nothing bound them', async () => {
        const unbound = createToolRunner(
            { tools: tracedTools },
            {
                record: ({ requestContext }: { requestContext: { analytics: { traceId: string } } }) => ({
                    status: 200,
                    body: {
                        traceId: requestContext.analytics.traceId,
                    },
                }),
            } as never,
            undefined,
            undefined,
            ['analytics']
        );

        await expect(unbound.record.run()).rejects.toBeInstanceOf(ToolRequestContextError);
        await expect(unbound.record.run()).rejects.toThrow(/pass `\{ requestContext: \{ analytics \} \}`/);
    });

    it('binds alongside an identity rather than instead of one', async () => {
        const seen: unknown[] = [];
        const bound = bindToolRunner(
            createToolRunner({ tools: tracedTools }, {
                record: (args: unknown) => {
                    seen.push(args);
                    return {
                        status: 200,
                        body: {
                            traceId: 'seen',
                        },
                    };
                },
            } as never),
            {
                requestContext: {
                    analytics: {
                        traceId: 'trace_7',
                    },
                },
            }
        );

        await bound.record.run();

        expect(Object.keys(seen[0] as object).sort()).toEqual(['input', 'requestContext', 'throwError']);
    });
});
