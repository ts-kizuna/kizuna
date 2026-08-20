import type { Method } from '@ts-kizuna/core';

/**
 * Safe per RFC 9110: they request no change to the server's state.
 */
const SAFE_METHODS: ReadonlySet<Method> = new Set<Method>(['GET', 'HEAD', 'OPTIONS']);

/**
 * Idempotent per RFC 9110: repeating one has the same effect as making it once.
 * Every safe method is idempotent.
 */
const IDEMPOTENT_METHODS: ReadonlySet<Method> = new Set<Method>(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

export const isSafeMethod = (method: Method): boolean => SAFE_METHODS.has(method);

export const isIdempotentMethod = (method: Method): boolean => IDEMPOTENT_METHODS.has(method);
