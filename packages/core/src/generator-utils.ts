import type { z } from 'zod';
import type { ResponseDefinition } from './types.js';

// Kept out of generator.ts so importing these doesn't pull in its node:fs dependency.

export const resolveResponseBody = (value: ResponseDefinition): z.ZodType =>
    value && typeof value === 'object' && 'body' in value ? value.body : (value as z.ZodType);

export const resolveResponseHeaders = (value: ResponseDefinition): z.ZodType | undefined =>
    value && typeof value === 'object' && 'body' in value ? value.headers : undefined;

export const resolveResponseContentType = (value: ResponseDefinition | undefined): string | undefined =>
    value && typeof value === 'object' && 'body' in value ? value.contentType : undefined;

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
 * Whether a media type is JSON-serialized: `application/json` or any
 * structured-suffix `+json` type (e.g. `application/problem+json`). Any other
 * type carries a raw body that is written/read as-is.
 */
export const isJsonMediaType = (contentType: string): boolean => {
    const essence = (contentType.split(';')[0] ?? '').trim().toLowerCase();
    return essence === 'application/json' || essence.endsWith('+json');
};
