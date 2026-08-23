import { z } from 'zod';

/**
 * Schema for a URL, a WHATWG `URL` instance.
 *
 * Use it in bodies where handlers and the fetch client should hold a real
 * `URL` object. On the wire it is the absolute URL string (`url.href`); the
 * OpenAPI generator emits `type: string, format: uri`. For a URL-shaped
 * string, use `z.url()`, which validates the format and infers `string`.
 *
 * @example
 * ```ts
 * import { UrlSchema } from '@ts-kizuna/core/schemas';
 *
 * updateUser: {
 *     method: 'PATCH',
 *     path: '/users/:id',
 *     body: z.object({
 *         website: UrlSchema,
 *     }),
 *     responses: {
 *         200: UserSchema,
 *     },
 * }
 * ```
 */
export const UrlSchema = z.instanceof(URL);
