import type { z } from 'zod';
import { markModelSchema } from '@ts-kizuna/shared';

export interface ModelOptions<T extends z.ZodType> {
    /**
     * The name of this schema in the generated OpenAPI spec and client code.
     *
     * Appears as the key in `components/schemas` and as the struct/class name
     * in generated Swift clients.
     */
    title: string;
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
export const createModel = <T extends z.ZodType>(options: ModelOptions<T>): T => {
    const model = options.schema.meta({
        id: options.title,
        description: options.description,
    }) as T;
    markModelSchema(model);
    return model;
};
