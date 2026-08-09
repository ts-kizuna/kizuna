import * as fs from 'node:fs';
import * as path from 'node:path';
import type { JsDocMap, SerializedJsDocMap, JsDocEntry } from './jsdoc.js';

const toMap = (record: Record<string, JsDocEntry>): Map<string, JsDocEntry> => new Map(Object.entries(record));

const toNestedMap = (record: Record<string, Record<string, JsDocEntry>>): Map<string, Map<string, JsDocEntry>> =>
    new Map(Object.entries(record).map(([key, value]) => [key, toMap(value)]));

const deserialize = (data: SerializedJsDocMap): JsDocMap => ({
    routes: toMap(data.routes),
    fields: toNestedMap(data.fields),
    schemas: data.schemas ? toNestedMap(data.schemas) : undefined,
});

/**
 * Reads the documentation entry for `fingerprint` from `<dir>/jsdoc.json`
 * (default `<cwd>/.kizuna/jsdoc.json`). Returns undefined when the file or entry
 * is absent. Kept dependency-free (only `node:fs`/`node:path`) so it never pulls
 * a Node built-in into the client-safe main bundle.
 */
export const loadJsDoc = (fingerprint: string, dir: string = path.join(process.cwd(), '.kizuna')): JsDocMap | undefined => {
    let raw: string;
    try {
        raw = fs.readFileSync(path.join(dir, 'jsdoc.json'), 'utf8');
    } catch {
        return undefined;
    }
    try {
        const entries = JSON.parse(raw) as Record<string, SerializedJsDocMap>;
        const entry = entries[fingerprint];
        return entry ? deserialize(entry) : undefined;
    } catch {
        return undefined;
    }
};
