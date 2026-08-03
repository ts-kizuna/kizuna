import type { z } from 'zod';

/**
 * How much of a tool's activity reaches the client.
 *
 * `'full'` sends the arguments on `tool_call` and the result on `tool_result`,
 * `'name-only'` sends both events without those payloads, and `'none'` runs the
 * tool with no events at all.
 */
export type ToolExposure = 'full' | 'name-only' | 'none';

/**
 * A tool the model may call. Build one with `createTool`.
 *
 * A declaration is contract data: a name, prose, and two schemas. It holds no
 * implementation, so it stays client-safe and one declaration can serve several
 * routes.
 */
export interface ToolDeclaration<
    Name extends string = string,
    Input extends z.ZodType = z.ZodType,
    Output extends z.ZodType = z.ZodType,
    Exposure extends ToolExposure = ToolExposure,
> {
    /**
     * The name the model calls the tool by.
     */
    name: Name;
    /**
     * Prefix for this tool's event models in the generated OpenAPI spec and
     * native clients, so `LookupOrder` yields `LookupOrderCall`,
     * `LookupOrderResult` and `LookupOrderError`.
     */
    title: string;
    /**
     * What the tool does, read by the model to decide when to call it. Be
     * prescriptive about when it applies, not just what it returns.
     */
    description: string;
    /**
     * Schema for the arguments the model supplies. Also validates those
     * arguments before the implementation runs.
     */
    input: Input;
    /**
     * Schema for what the implementation returns. Under `'full'` exposure it is
     * also the payload of the `tool_result` event.
     */
    output: Output;
    expose: Exposure;
}
