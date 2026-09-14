import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildTools, flattenTools, isCompiledTool, isToolDefinition, toolAt } from './tools.js';

const weatherTools = () =>
    buildTools({
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

describe('isToolDefinition', () => {
    it('reads a node carrying a description as a tool', () => {
        expect(isToolDefinition({ description: 'Does a thing' })).toBe(true);
    });

    it('reads a node without a description as a group', () => {
        expect(isToolDefinition({ getForecast: { description: 'Does a thing' } })).toBe(false);
    });

    it('reads a group named like a tool field as a group', () => {
        expect(isToolDefinition({ title: { description: 'Does a thing' } })).toBe(false);
    });

    it('refuses an array', () => {
        expect(isToolDefinition([])).toBe(false);
    });
});

describe('buildTools', () => {
    it('compiles a nested tree, preserving its shape', () => {
        const tools = weatherTools();
        expect(isCompiledTool(tools['ping'])).toBe(true);
        expect(isCompiledTool(tools['weather'])).toBe(false);
        expect(flattenTools(tools).map(({ toolKey }) => toolKey)).toEqual(['weather.getForecast', 'ping']);
    });

    it('carries the input and output schemas onto the compiled tool', () => {
        const tool = toolAt(weatherTools(), 'weather.getForecast')!;
        expect(tool.input).toBeInstanceOf(z.ZodType);
        expect(tool.output).toBeInstanceOf(z.ZodType);
    });

    it('leaves input undefined for a tool taking none', () => {
        const tool = toolAt(weatherTools(), 'ping')!;
        expect(tool.input).toBeUndefined();
    });

    it('synthesizes the responses a tool answers with', () => {
        const tool = toolAt(weatherTools(), 'ping')!;
        expect(Object.keys(tool.responses).map(Number)).toEqual([204, 422, 500, 503]);
    });

    it('leaves identity for the auth map to write', () => {
        const tools = buildTools({
            ping: {
                description: 'Answer that the server is up',
            },
        });
        expect(toolAt(tools, 'ping')!.identity).toBeUndefined();
    });

    it('throws on an empty description', () => {
        expect(() =>
            buildTools({
                ping: {
                    description: '   ',
                },
            })
        ).toThrow(/Tool "ping" has an empty `description`/);
    });

    it('throws when a top-level name would shadow the runner', () => {
        expect(() =>
            buildTools({
                call: {
                    description: 'Place a call',
                },
            })
        ).toThrow(/Tool "call" cannot sit at the top level/);
    });

    it('takes a runner name nested in a group', () => {
        const tools = buildTools({
            phone: {
                call: {
                    description: 'Place a call',
                },
            },
        });
        expect(toolAt(tools, 'phone.call')).toBeDefined();
    });

    it('throws when a node is neither a tool nor a group', () => {
        expect(() =>
            buildTools({
                ping: 'not a tool' as unknown as { description: string },
            })
        ).toThrow(/Tool "ping" is not an object/);
    });
});

describe('toolAt', () => {
    it('resolves a dotted key', () => {
        expect(toolAt(weatherTools(), 'weather.getForecast')).toBeDefined();
    });

    it('answers undefined for a key naming a group', () => {
        expect(toolAt(weatherTools(), 'weather')).toBeUndefined();
    });

    it('answers undefined for a key naming nothing', () => {
        expect(toolAt(weatherTools(), 'weather.getHistory')).toBeUndefined();
    });
});
