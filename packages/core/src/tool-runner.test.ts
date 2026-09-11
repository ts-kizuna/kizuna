import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Kizuna } from './kizuna.js';
import { createToolRunner, publishTools, ToolExecutionError, ToolInputError, ToolOutputError } from './tool-runner.js';
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
            tempC: input.city === 'Oslo' ? 14 : 20,
        }),
    },
    ping: () => undefined,
};

const runner = () => createToolRunner({ tools }, handlers);

describe('createToolRunner', () => {
    it('runs a tool by its place in the tree', async () => {
        await expect(runner().weather.getForecast.run({ city: 'Oslo' })).resolves.toEqual({
            tempC: 14,
        });
    });

    it('runs a tool that takes no arguments', async () => {
        await expect(runner().ping.run()).resolves.toBeUndefined();
    });

    it('validates the input before the handler sees it', async () => {
        const seen = vi.fn();
        const strict = createToolRunner(
            { tools },
            {
                weather: {
                    getForecast: ((args: unknown) => {
                        seen(args);
                        return { tempC: 1 };
                    }) as Handlers['weather']['getForecast'],
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

    it('turns throwError into a ToolExecutionError carrying the message', async () => {
        const failing = createToolRunner(
            { tools },
            {
                weather: {
                    getForecast: ({ throwError }) => throwError('No station reports for that city.'),
                },
                ping: () => undefined,
            }
        );

        await expect(failing.weather.getForecast.run({ city: 'Atlantis' })).rejects.toThrow('No station reports for that city.');
        await expect(failing.weather.getForecast.run({ city: 'Atlantis' })).rejects.toBeInstanceOf(ToolExecutionError);
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
                tempC: 14,
            },
        });
    });

    it('leaves output off a result for a tool reporting nothing', async () => {
        await expect(
            runner().call({
                id: 'toolu_02',
                name: 'ping',
            })
        ).resolves.toEqual({
            id: 'toolu_02',
            name: 'ping',
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

describe('publishTools', () => {
    it('shapes every tool the way MCP declares one', () => {
        expect(publishTools(tools)).toEqual([
            {
                name: 'weather_get_forecast',
                title: 'Weather forecast',
                description: 'Look up the forecast for one city',
                inputSchema: {
                    $schema: 'https://json-schema.org/draft/2020-12/schema',
                    type: 'object',
                    properties: {
                        city: {
                            type: 'string',
                        },
                    },
                    required: ['city'],
                },
                outputSchema: {
                    $schema: 'https://json-schema.org/draft/2020-12/schema',
                    type: 'object',
                    properties: {
                        tempC: {
                            type: 'number',
                        },
                    },
                    required: ['tempC'],
                    additionalProperties: false,
                },
                annotations: {
                    readOnlyHint: true,
                },
            },
            {
                name: 'ping',
                description: 'Answer that the server is up',
                inputSchema: {
                    type: 'object',
                    additionalProperties: false,
                },
            },
        ]);
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
                tempC: 14,
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
                tempC: 20,
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

    it('passes a handler failure through as the sentence the model reads', async () => {
        const failing = createToolRunner({ tools }, {
            weather: {
                getForecast: ({ throwError }) => throwError('Name a city to look the forecast up for.'),
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
            ok: false,
            id: 'call_1',
            name: 'weather.getForecast',
            message: 'Name a city to look the forecast up for.',
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
                        tempC: 14,
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

    it('omits output for a tool that reports nothing', async () => {
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
                },
            },
        ]);
    });
});

describe('publishTools', () => {
    it('refuses an input schema that does not describe an object', () => {
        const bad = k.tools({
            shout: {
                description: 'Shout a word back',
                input: z.string(),
            },
        });

        expect(() => publishTools(bad)).toThrow(/not an object/);
    });
});
