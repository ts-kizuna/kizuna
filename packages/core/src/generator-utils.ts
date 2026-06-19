import type { z } from 'zod';
import type { ResponseDefinition } from './types.js';

// Kept out of generator.ts so importing these doesn't pull in its node:fs dependency.

export const resolveResponseBody = (value: ResponseDefinition): z.ZodType =>
    value && typeof value === 'object' && 'body' in value ? value.body : (value as z.ZodType);

export const resolveResponseHeaders = (value: ResponseDefinition): z.ZodType | undefined =>
    value && typeof value === 'object' && 'body' in value ? value.headers : undefined;

export const resolveResponseContentType = (value: ResponseDefinition | undefined): string | undefined =>
    value && typeof value === 'object' && 'body' in value ? value.contentType : undefined;

/**
 * Whether a media type is JSON-serialized: `application/json` or any
 * structured-suffix `+json` type (e.g. `application/problem+json`). Any other
 * type carries a raw body that is written/read as-is.
 */
export const isJsonMediaType = (contentType: string): boolean => {
    const essence = (contentType.split(';')[0] ?? '').trim().toLowerCase();
    return essence === 'application/json' || essence.endsWith('+json');
};
