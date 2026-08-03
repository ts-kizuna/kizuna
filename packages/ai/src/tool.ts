import type { z } from 'zod';
import type { ToolDeclaration, ToolExposure } from './types.js';

export interface ToolOptions<Name extends string, Input extends z.ZodType, Output extends z.ZodType, Exposure extends ToolExposure> {
    /**
     * The name the model calls the tool by. Models pick tools by name and
     * description, so name it for the action it performs.
     */
    name: Name;
    /**
     * Prefix for this tool's event models in the generated OpenAPI spec and
     * native clients. Defaults to `name` in PascalCase, so `lookup_order`
     * becomes `LookupOrderCall`, `LookupOrderResult` and `LookupOrderError`.
     */
    title?: string;
    /**
     * What the tool does. The model reads this to decide when to call it, so say
     * when it applies, not only what it returns.
     */
    description: string;
    /**
     * Schema for the arguments the model supplies. Arguments are validated
     * against it before the implementation runs, so a model that passes
     * nonsense gets a correctable error instead of reaching your code.
     */
    input: Input;
    /**
     * Schema for what the implementation returns.
     */
    output: Output;
    /**
     * How much of this tool's activity reaches the client. Set once here rather
     * than per route, so the same tool cannot describe itself two ways.
     *
     * @default 'full'
     */
    expose?: Exposure;
}

const pascalCase = (value: string): string =>
    value
        .split(/[^a-zA-Z0-9]+/)
        .filter((part) => part.length > 0)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join('');

/**
 * Declare a tool the model may call from a streaming response.
 *
 * A declaration is contract data: a name, prose, and two schemas. The
 * implementation is supplied server-side where the handler produces its stream,
 * so declaring a tool adds nothing to a client bundle and one tool can be shared
 * by several routes.
 *
 * ```ts
 * const ListEventsTool = createTool({
 *     name: 'list_events',
 *     description: 'List events between two dates. Use it whenever the answer depends on the schedule.',
 *     input: z.object({
 *         from: z.string(),
 *         to: z.string(),
 *     }),
 *     output: z.array(EventSchema),
 * });
 * ```
 */
export const createTool = <Name extends string, Input extends z.ZodType, Output extends z.ZodType, Exposure extends ToolExposure = 'full'>(
    options: ToolOptions<Name, Input, Output, Exposure>
): ToolDeclaration<Name, Input, Output, Exposure> => ({
    name: options.name,
    title: options.title ?? pascalCase(options.name),
    description: options.description,
    input: options.input,
    output: options.output,
    expose: options.expose ?? ('full' as Exposure),
});

export interface ToolContext {
    /**
     * Aborts when the client disconnects. Pass it to downstream work so a tool
     * stops with the request that asked for it.
     */
    signal: AbortSignal;
}

/**
 * What a tool actually does, given its parsed `input`.
 */
export type ToolRun<Declaration extends ToolDeclaration> = (
    input: z.output<Declaration['input']>,
    context: ToolContext
) => z.input<Declaration['output']> | Promise<z.input<Declaration['output']>>;

/**
 * A declared tool paired with its server-side implementation.
 */
export interface ToolImplementation<Declaration extends ToolDeclaration = ToolDeclaration> {
    declaration: Declaration;
    run: ToolRun<Declaration>;
}

/**
 * Give a declared tool its implementation.
 *
 * Keep these next to the code they call rather than in the contract: the
 * declaration is client-safe, an implementation reaches for a database or a
 * service. One implemented tool is a value like any other, so several routes can
 * share it.
 *
 * Independent of how the reply reaches the client. A route that streams and a
 * route that returns a single body implement their tools the same way.
 *
 * ```ts
 * export const lookupOrder = implementTool(LookupOrderTool, async ({ orderId }, { signal }) => {
 *     const order = await db.orders.findById(orderId, { signal });
 *     if (!order) throw new Error(`No order exists with id ${orderId}.`);
 *     return order;
 * });
 * ```
 */
export const implementTool = <const Declaration extends ToolDeclaration>(
    declaration: Declaration,
    run: ToolRun<Declaration>
): ToolImplementation<Declaration> => ({
    declaration,
    run,
});

/**
 * The tool declarations of anything carrying a `tools` list, such as a response
 * built by `agentStream`.
 */
export type ToolsOf<Source> = Source extends {
    tools: infer Tools extends readonly ToolDeclaration[];
}
    ? Tools
    : never;
