import type { z } from 'zod';

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
 * const UserSchema = createModel({
 *     title: 'User',
 *     description: 'A user in the system',
 *     schema: z.object({
 *         id: z.string(),
 *         name: z.string(),
 *     }),
 * });
 * ```
 */
export const createModel = <T extends z.ZodType>(options: ModelOptions<T>): T =>
    options.schema.meta({
        id: options.title,
        description: options.description,
    }) as T;
