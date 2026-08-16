import type { KizunaPathKey, KizunaQueryKey, KizunaQueryKeyType } from './types.js';

// TanStack supplies a fresh AbortSignal per attempt, so hashing `fetchOptions`
// would make every call a cache miss.
const withoutFetchOptions = (input: unknown): unknown => {
    if (typeof input !== 'object' || input === null) {
        return input;
    }

    const { fetchOptions: _fetchOptions, ...rest } = input as Record<string, unknown>;
    return Object.keys(rest).length === 0 ? undefined : rest;
};

export const buildQueryKey = (segments: readonly string[], input: unknown, type: KizunaQueryKeyType): KizunaQueryKey => {
    const hashable = withoutFetchOptions(input);
    return hashable === undefined ? [segments, { type }] : [segments, { input: hashable, type }];
};

export const buildPathKey = (segments: readonly string[]): KizunaPathKey => [segments];
