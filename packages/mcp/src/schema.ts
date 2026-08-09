import { z } from 'zod';
import { parsePath } from '@ts-kizuna/core/adapter';
import { isVoidSchema, jsDocText, readDef, readDefType, readObjectShape, type JsDocEntry } from '@ts-kizuna/core/generator';
import type { RouteDefinition } from '@ts-kizuna/core';

export interface ToolInputSchema {
    shape: Record<string, z.ZodType> | undefined;
    hasParams: boolean;
    hasQuery: boolean;
    hasBody: boolean;
}

/**
 * Wrapper types a field path passes straight through: `z.array(User)` documents
 * `items.email`, not `items.element.email`. Keyed by the def property holding the
 * wrapped schema, so the wrapper can be rebuilt around a documented inner type.
 */
const WRAPPER_KEYS: Record<string, 'element' | 'innerType'> = {
    array: 'element',
    optional: 'innerType',
    nullable: 'innerType',
    default: 'innerType',
    prefault: 'innerType',
    readonly: 'innerType',
    nonoptional: 'innerType',
    catch: 'innerType',
};

/**
 * Rebuilds `schema` with one def property replaced, re-registering the metadata
 * from the original: the registry is keyed by instance, and a clone is a new one.
 */
const cloneWith = (schema: z.ZodType, changes: Record<string, unknown>): z.ZodType => {
    const clone = schema.clone({ ...(readDef(schema) as Record<string, unknown>), ...changes } as never) as z.ZodType;
    const meta = schema.meta();
    return meta ? (clone.meta(meta) as z.ZodType) : clone;
};

const describe = (schema: z.ZodType, entry: JsDocEntry | undefined): z.ZodType => {
    if (!entry) return schema;
    const text = jsDocText(entry);
    const described = text === undefined ? schema : (schema.describe(text) as z.ZodType);
    return entry.examples ? (described.meta({ ...described.meta(), examples: entry.examples }) as z.ZodType) : described;
};

/**
 * Returns `schema` with each documented field carrying its JSDoc as a Zod
 * description, so it reaches the JSON Schema an assistant reads. Clones, never
 * mutates: the contract's own schemas are left untouched.
 */
export const withFieldJsDoc = (schema: z.ZodType, fieldJsDoc: ReadonlyMap<string, JsDocEntry>, prefix: string): z.ZodType => {
    const wrapperKey = WRAPPER_KEYS[readDefType(schema) ?? ''];
    if (wrapperKey) {
        const def = readDef(schema) as Record<string, unknown> | undefined;
        const inner = def?.[wrapperKey] as z.ZodType | undefined;
        if (!inner) return schema;
        const next = withFieldJsDoc(inner, fieldJsDoc, prefix);
        return next === inner ? schema : cloneWith(schema, { [wrapperKey]: next });
    }

    const shape = readObjectShape(schema) as Record<string, z.ZodType> | undefined;
    if (!shape) return schema;

    let changed = false;
    const nextShape: Record<string, z.ZodType> = {};
    for (const [key, value] of Object.entries(shape)) {
        const fieldPath = prefix === '' ? key : `${prefix}.${key}`;
        const next = describe(withFieldJsDoc(value, fieldJsDoc, fieldPath), fieldJsDoc.get(fieldPath));
        if (next !== value) changed = true;
        nextShape[key] = next;
    }
    return changed ? cloneWith(schema, { shape: nextShape }) : schema;
};

export const buildToolInputSchema = (route: RouteDefinition, fieldJsDoc?: ReadonlyMap<string, JsDocEntry>): ToolInputSchema => {
    const shape: Record<string, z.ZodType> = {};
    let hasParams = false;
    let hasQuery = false;
    let hasBody = false;

    const document = (schema: z.ZodType, prefix: string): z.ZodType =>
        fieldJsDoc && fieldJsDoc.size > 0 ? withFieldJsDoc(schema, fieldJsDoc, prefix) : schema;

    const paramNames = parsePath(route.path).paramNames;
    if (paramNames.length > 0) {
        hasParams = true;
        const paramShape: Record<string, z.ZodType> = {};
        const explicitShape = (route.pathParams ? readObjectShape(route.pathParams) : undefined) as Record<string, z.ZodType> | undefined;
        for (const name of paramNames) {
            paramShape[name] = describe(explicitShape?.[name] ?? z.string(), fieldJsDoc?.get(`pathParams.${name}`));
        }
        shape['params'] = z.object(paramShape);
    }

    if (route.query) {
        hasQuery = true;
        shape['query'] = document(route.query, 'query');
    }

    if (route.body && !isVoidSchema(route.body)) {
        hasBody = true;
        shape['body'] = document(route.body, 'body');
    }

    if (Object.keys(shape).length === 0) {
        return {
            shape: undefined,
            hasParams,
            hasQuery,
            hasBody,
        };
    }

    return {
        shape,
        hasParams,
        hasQuery,
        hasBody,
    };
};
