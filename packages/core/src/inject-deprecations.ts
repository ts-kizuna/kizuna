import type { DeprecationMap } from './deprecation.js';

/**
 * Flatten a `DeprecationMap` to a `fieldName -> message` map.
 *
 * Field paths are dotted (e.g. `responses.200.email`); we key by the last
 * segment because the emitted `.d.ts` represents fields as zod-type wrappers
 * whose structure does not match the source-derived path dialect. Matching by
 * field name avoids reconciling the two. When a name appears with both an empty
 * and a non-empty message, the non-empty message wins.
 */
export const collectDeprecatedFieldNames = (map: DeprecationMap): Map<string, string> => {
    const names = new Map<string, string>();
    const add = (fieldPath: string, message: string): void => {
        const fieldName = fieldPath.split('.').pop();
        if (fieldName === undefined || fieldName === '') return;
        const existing = names.get(fieldName);
        if (existing === undefined || (existing === '' && message !== '')) {
            names.set(fieldName, message);
        }
    };
    for (const fields of map.fields.values()) {
        for (const [fieldPath, message] of fields) add(fieldPath, message);
    }
    if (map.schemas) {
        for (const fields of map.schemas.values()) {
            for (const [fieldPath, message] of fields) add(fieldPath, message);
        }
    }
    return names;
};
