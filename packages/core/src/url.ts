import { z } from 'zod';

/**
 * Schema for a URL, a WHATWG `URL` instance.
 *
 * Use it in bodies where a field is a URL rather than free-form text. On the
 * wire it is the absolute URL string (`url.href`); handlers and the fetch
 * client see a real `URL`. The OpenAPI generator emits `type: string,
 * format: uri`.
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
