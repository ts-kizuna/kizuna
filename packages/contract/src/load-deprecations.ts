import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DeprecationMap, SerializedDeprecationMap } from '@ts-kizuna/contract';

const deserialize = (data: SerializedDeprecationMap): DeprecationMap => ({
    routes: new Map(Object.entries(data.routes)),
    fields: new Map(Object.entries(data.fields).map(([key, value]) => [key, new Map(Object.entries(value))])),
    schemas: data.schemas ? new Map(Object.entries(data.schemas).map(([key, value]) => [key, new Map(Object.entries(value))])) : undefined,
});

/**
 * Reads the deprecation entry for `fingerprint` from `<dir>/deprecations.json`
 * (default `<cwd>/.kizuna/deprecations.json`). Returns undefined when the file or
 * entry is absent. Kept dependency-free (only `node:fs`/`node:path`) so it never
 * pulls a Node built-in into the client-safe main bundle.
 */
export const loadDeprecations = (fingerprint: string, dir: string = path.join(process.cwd(), '.kizuna')): DeprecationMap | undefined => {
    let raw: string;
    try {
        raw = fs.readFileSync(path.join(dir, 'deprecations.json'), 'utf8');
    } catch {
        return undefined;
    }
    try {
        const entries = JSON.parse(raw) as Record<string, SerializedDeprecationMap>;
        const entry = entries[fingerprint];
        return entry ? deserialize(entry) : undefined;
    } catch {
        return undefined;
    }
};
