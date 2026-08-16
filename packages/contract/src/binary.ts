import { z } from 'zod';

/**
 * Schema for a raw binary body, a `Uint8Array` (a Node `Buffer` also satisfies it).
 *
 * Use it for binary responses (and binary request bodies). Pair it with a
 * `contentType` on the response; it defaults to `application/octet-stream`.
 * The OpenAPI generator emits `type: string, format: binary`; the Swift client
 * decodes it to `Data`.
 *
 * @example
 * ```ts
 * import { BinarySchema } from '@ts-kizuna/contract/schemas';
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

/**
 * Schema for an uploaded file, a web `File` (bytes plus `name` and `type`).
 *
 * Use it for `multipart/form-data` request fields, where the filename and media
 * type matter. For a plain blob of bytes with no metadata, use {@link BinarySchema}.
 *
 * @example
 * ```ts
 * import { FileSchema } from '@ts-kizuna/contract/schemas';
 *
 * uploadAvatar: {
 *     method: 'POST',
 *     path: '/avatar',
 *     contentType: 'multipart/form-data',
 *     body: z.object({
 *         file: FileSchema,
 *         userId: z.string(),
 *     }),
 *     responses: {
 *         200: z.object({ size: z.number() }),
 *     },
 * }
 * ```
 */
export const FileSchema = z.instanceof(File);
