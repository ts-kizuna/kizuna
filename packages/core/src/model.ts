import type { z } from 'zod';
import { markModelSchema } from './zod-internals.js';

/**
 * Type-only key under which `Kizuna.model` carries a model's title. Never
 * written at runtime; `Kizuna.Infer` reads it to key a contract's models by
 * name.
 */
export const MODEL_TITLE: unique symbol = Symbol('ts-kizuna.model.title');

/**
 * A schema named by `Kizuna.model`, carrying its title in the type.
 */
export interface ModelTitle<Title extends string> {
    readonly [MODEL_TITLE]: Title;
}

export interface ModelOptions<Title extends string, T extends z.ZodType> {
    /**
     * The name of this schema in the generated OpenAPI spec and client code.
     *
     * Appears as the key in `components/schemas` and as the struct/class name
     * in generated Swift clients.
     */
    title: Title;
    /**
     * Optional description shown in the OpenAPI spec.
     */
    description?: string;
    /**
     * The Zod schema that defines the shape and validation of this model.
     */
    schema: T;
}

/**
 * Name a Zod schema for OpenAPI and code generation.
 *
 * ```ts
 * const UserSchema = Kizuna.model({
 *     title: 'User',
 *     description: 'A user in the system',
 *     schema: z.object({
 *         id: z.string(),
 *         name: z.string(),
 *     }),
 * });
 * ```
 */
export const createModel = <const Title extends string, T extends z.ZodType>(options: ModelOptions<Title, T>): T & ModelTitle<Title> => {
    const model = options.schema.meta({
        id: options.title,
        description: options.description,
    }) as T & ModelTitle<Title>;
    markModelSchema(model);
    return model;
};
