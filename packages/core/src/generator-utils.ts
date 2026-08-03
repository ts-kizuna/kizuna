import type { z } from 'zod';
import type { ResponseDefinition, StreamFormat, StreamResponseDefinition } from './types.js';

// Kept out of generator.ts so importing these doesn't pull in its node:fs dependency.

const STREAM_CONTENT_TYPES: Record<StreamFormat, string> = {
    sse: 'text/event-stream',
};

/**
 * True for a {@link StreamResponseDefinition}. A streaming response has no body
 * schema, so callers of {@link resolveResponseBody} must check this first.
 */
export const isStreamResponse = (value: ResponseDefinition | undefined): value is StreamResponseDefinition =>
    !!value && typeof value === 'object' && 'stream' in value && typeof (value as StreamResponseDefinition).stream === 'string';

/**
 * The schema for one event of a streaming response, `undefined` otherwise.
 */
export const resolveResponseEvent = (value: ResponseDefinition | undefined): z.ZodType | undefined =>
    isStreamResponse(value) ? value.event : undefined;

export const streamContentType = (format: StreamFormat): string => STREAM_CONTENT_TYPES[format];

export const resolveResponseBody = (value: ResponseDefinition): z.ZodType => {
    if (isStreamResponse(value)) {
        throw new Error(
            'resolveResponseBody was called with a streaming response, which has no body schema. Check isStreamResponse first and read the event schema with resolveResponseEvent.'
        );
    }
    return value && typeof value === 'object' && 'body' in value ? value.body : (value as z.ZodType);
};

export const resolveResponseHeaders = (value: ResponseDefinition): z.ZodType | undefined =>
    value && typeof value === 'object' && ('body' in value || 'stream' in value) ? value.headers : undefined;

export const resolveResponseContentType = (value: ResponseDefinition | undefined): string | undefined => {
    if (isStreamResponse(value)) return streamContentType(value.stream);
    return value && typeof value === 'object' && 'body' in value ? value.contentType : undefined;
};

export const toPascalCase = (input: string): string => {
    if (!input) return input;
    const cleaned = input.replace(/[^a-zA-Z0-9]+/g, ' ').trim();
    return cleaned
        .split(' ')
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join('');
};

export const toCamelCase = (input: string): string => {
    const pascal = toPascalCase(input);
    if (!pascal) return pascal;
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
};

/**
 * The local name a type gets when nested inside its owning type: the owner's
 * name stripped from the front (`UserAvatar` inside `User` → `Avatar`).
 */
export const shortTypeName = (typeName: string, ownerName: string): string =>
    typeName.startsWith(ownerName) ? typeName.slice(ownerName.length) : typeName;

/**
 * A hint prefix must end on a PascalCase word boundary. Otherwise `Image` claims
 * `ImagesItem` and the nested short name becomes the mid-word slice `sItem`.
 */
export const isHintPrefix = (typeName: string, prefix: string): boolean =>
    typeName.startsWith(prefix) && /[A-Z]/.test(typeName.charAt(prefix.length));

/**
 * The type name local to an operation scope: the operation name stripped from
 * the front (`createUserInput` inside `createUser` → `Input`), or the full name
 * when stripping would leave nothing.
 */
export const localTypeName = (fullName: string, operationName: string): string => {
    const stripped = fullName.slice(operationName.length);
    return stripped || fullName;
};

/**
 * Matches a valid identifier in the generated languages: a letter or `_`,
 * followed by letters, digits, or `_`.
 */
const IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Returns a wire field key as a valid identifier: kept verbatim when already
 * valid, otherwise camelCased from its segments, with a `_` prefix when it
 * starts with a digit.
 */
export const sanitizeFieldName = (key: string): string => {
    if (IDENTIFIER_REGEX.test(key)) return key;
    const segments = key.split(/[^A-Za-z0-9]+/).filter((segment) => segment.length > 0);
    const head = segments[0];
    if (head === undefined) return 'field';
    const headLower = head.charAt(0).toLowerCase() + head.slice(1);
    const camel =
        headLower +
        segments
            .slice(1)
            .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
            .join('');
    return /^[0-9]/.test(camel) ? `_${camel}` : camel;
};

/**
 * Returns the input with every non-identifier character replaced by `_`, with a
 * `_` prefix when it starts with a digit.
 */
export const sanitizeIdentifier = (input: string): string => {
    const cleaned = input.replace(/[^a-zA-Z0-9_]/g, '_');
    return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
};

/**
 * Returns the camelCase name for a known HTTP error status (`404` → `notFound`),
 * or `status<code>` for unknown ones.
 */
export const statusToCamelCase = (status: number): string => {
    const known: Record<number, string> = {
        400: 'badRequest',
        401: 'unauthorized',
        403: 'forbidden',
        404: 'notFound',
        405: 'methodNotAllowed',
        409: 'conflict',
        410: 'gone',
        422: 'unprocessableEntity',
        429: 'tooManyRequests',
        500: 'internalServerError',
        502: 'badGateway',
        503: 'serviceUnavailable',
    };
    return known[status] ?? `status${status}`;
};

/**
 * True for 2xx status codes.
 */
export const isSuccessStatus = (status: number): boolean => status >= 200 && status < 300;

/**
 * Merges per-status response header fields into one list, marking fields that
 * are not present on every status as optional.
 */
export const mergeHeaderFields = <Field extends { name: string; optional: boolean }>(perStatusHeaders: Field[][]): Field[] => {
    const nonEmpty = perStatusHeaders.filter((fields) => fields.length > 0);
    if (nonEmpty.length === 0) return [];
    const first = nonEmpty[0]!;
    return first.map((field) => {
        const universallyPresent = nonEmpty.every((fields) => fields.some((candidate) => candidate.name === field.name));
        return universallyPresent ? field : { ...field, optional: true };
    });
};

/**
 * Whether a media type is JSON-serialized: `application/json` or any
 * structured-suffix `+json` type (e.g. `application/problem+json`). Any other
 * type carries a raw body that is written/read as-is.
 */
export const isJsonMediaType = (contentType: string): boolean => {
    const essence = (contentType.split(';')[0] ?? '').trim().toLowerCase();
    return essence === 'application/json' || essence.endsWith('+json');
};
