import { flattenRoutes } from './handler-pipeline.js';
import type { Contract } from './contract.js';
import type { Routes } from './types.js';

/**
 * Deprecated routes and fields, keyed by route key and field path. Values are the
 * text after `@deprecated` (empty string for a bare tag).
 */
export type DeprecationMap = {
    routes: Map<string, string>;
    fields: Map<string, Map<string, string>>;
    /**
     * Deprecated fields keyed by schema `meta.id`, for named schemas reachable only
     * through generic wrappers where a route-level field path can't be computed.
     */
    schemas?: Map<string, Map<string, string>>;
};

/**
 * Plain-object form of {@link DeprecationMap}, stored in `.kizuna/deprecations.json`.
 */
export type SerializedDeprecationMap = {
    routes: Record<string, string>;
    fields: Record<string, Record<string, string>>;
    schemas?: Record<string, Record<string, string>>;
};

export const serializeDeprecationMap = (map: DeprecationMap): SerializedDeprecationMap => ({
    routes: Object.fromEntries(map.routes),
    fields: Object.fromEntries(Array.from(map.fields, ([key, value]) => [key, Object.fromEntries(value)])),
    schemas: map.schemas ? Object.fromEntries(Array.from(map.schemas, ([key, value]) => [key, Object.fromEntries(value)])) : undefined,
});

export const deserializeDeprecationMap = (data: SerializedDeprecationMap): DeprecationMap => ({
    routes: new Map(Object.entries(data.routes)),
    fields: new Map(Object.entries(data.fields).map(([key, value]) => [key, new Map(Object.entries(value))])),
    schemas: data.schemas ? new Map(Object.entries(data.schemas).map(([key, value]) => [key, new Map(Object.entries(value))])) : undefined,
});

const hash = (input: string): string => {
    let value = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
        value ^= input.charCodeAt(index);
        value = Math.imul(value, 0x01000193);
    }
    return (value >>> 0).toString(16).padStart(8, '0');
};

/**
 * A stable id for a contract derived from its route keys. Identifies which entry
 * of `.kizuna/deprecations.json` belongs to a contract, so each contract reads
 * only its own deprecations even when two share a route key.
 */
export const contractFingerprint = (contract: Contract): string =>
    hash(
        flattenRoutes(contract.routes)
            .map((route) => route.routeKey)
            .sort()
            .join('\n')
    );
