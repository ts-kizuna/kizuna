import { z } from 'zod';

/**
 * Schema for a raw binary body, a `Uint8Array` (a Node `Buffer` also satisfies it).
 *
 * Use it for binary responses (and binary request bodies). For an uploaded
 * file with a name and MIME type, use `z.file()` instead. Pair it with a
 * `contentType` on the response; it defaults to `application/octet-stream`.
 * The OpenAPI generator emits `type: string, format: binary`; the Swift client
 * decodes it to `Data`.
 *
 * @example
 * ```ts
 * import { BinarySchema } from '@ts-kizuna/core/schemas';
 *
 * downloadReport: {
 *     method: 'GET',
 *     path: '/reports/:id.pdf',
 *     responses: {
 *         200: {
 *             body: BinarySchema,
 *             contentType: 'application/pdf',
 *         },
 *     },
 * }
 * ```
 */
export const BinarySchema = z.instanceof(Uint8Array);
