import { flattenRoutes } from './handler-pipeline.js';
import type { Contract } from './contract.js';

/**
 * Documentation authored as JSDoc on a route or a schema field, parsed out of the
 * contract source by `kizuna jsdoc`. Only tagged content is read: untagged prose
 * stays a note to whoever reads the code.
 */
export interface JsDocEntry {
    /**
     * The text after `@summary`. The short form, for an OpenAPI operation.
     */
    summary?: string;
    /**
     * The text after `@description`.
     */
    description?: string;
    /**
     * One value per `@example` tag, in source order. Each is the parsed JSON value
     * when the tag body parses as JSON, and the raw text otherwise.
     */
    examples?: unknown[];
    /**
     * The text after `@deprecated`, or an empty string for a bare tag. Absent when
     * the route or field is not deprecated.
     */
    deprecated?: string;
}

/**
 * Route and field documentation, keyed by route key and field path.
 */
export type JsDocMap = {
    routes: Map<string, JsDocEntry>;
    fields: Map<string, Map<string, JsDocEntry>>;
    /**
     * Field docs keyed by schema `meta.id`, for named schemas reachable only
     * through generic wrappers where a route-level field path can't be computed.
     */
    schemas?: Map<string, Map<string, JsDocEntry>>;
};

/**
 * Plain-object form of {@link JsDocMap}, stored in `.kizuna/jsdoc.json`.
 */
export type SerializedJsDocMap = {
    routes: Record<string, JsDocEntry>;
    fields: Record<string, Record<string, JsDocEntry>>;
    schemas?: Record<string, Record<string, JsDocEntry>>;
};

const toRecord = (map: Map<string, JsDocEntry>): Record<string, JsDocEntry> => Object.fromEntries(map);

const toNestedRecord = (map: Map<string, Map<string, JsDocEntry>>): Record<string, Record<string, JsDocEntry>> =>
    Object.fromEntries(Array.from(map, ([key, value]) => [key, toRecord(value)]));

const toMap = (record: Record<string, JsDocEntry>): Map<string, JsDocEntry> => new Map(Object.entries(record));

const toNestedMap = (record: Record<string, Record<string, JsDocEntry>>): Map<string, Map<string, JsDocEntry>> =>
    new Map(Object.entries(record).map(([key, value]) => [key, toMap(value)]));

export const serializeJsDocMap = (map: JsDocMap): SerializedJsDocMap => ({
    routes: toRecord(map.routes),
    fields: toNestedRecord(map.fields),
    schemas: map.schemas ? toNestedRecord(map.schemas) : undefined,
});

export const deserializeJsDocMap = (data: SerializedJsDocMap): JsDocMap => ({
    routes: toMap(data.routes),
    fields: toNestedMap(data.fields),
    schemas: data.schemas ? toNestedMap(data.schemas) : undefined,
});

/**
 * The summary and description as one block, for consumers with a single
 * documentation slot (schema field descriptions, Swift and Kotlin doc comments).
 */
export const jsDocText = (entry: JsDocEntry | undefined): string | undefined => {
    if (!entry) return undefined;
    const parts = [entry.summary, entry.description].filter((part): part is string => part !== undefined && part !== '');
    return parts.length > 0 ? parts.join('\n\n') : undefined;
};

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
 * of `.kizuna/jsdoc.json` belongs to a contract, so each contract reads only its
 * own documentation even when two share a route key.
 */
export const contractFingerprint = (contract: Contract): string =>
    hash(
        flattenRoutes(contract.routes)
            .map((route) => route.routeKey)
            .sort()
            .join('\n')
    );
