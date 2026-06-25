import { tagRoutes } from './routes.js';
import { assembleContract, type Contract } from './contract.js';
import { type TagSet, type TagOptions } from './tags.js';
import type { Routes } from './types.js';

/**
 * The handle `kizuna` returns. `k.routes` defines route groups; `k.contract`
 * assembles them into the contract.
 */
export interface K<Tags extends Record<string, TagOptions>, Codes extends string> {
    /**
     * Define a group of routes. Pass a tag (one of the keys from `createTags`)
     * to group them in the OpenAPI document, or omit it for an untagged group.
     */
    routes<const T extends Routes<Extract<keyof Tags, string>>>(tag: Extract<keyof Tags, string>, defs: T): T;
    routes<const T extends Routes>(defs: T): T;
    /**
     * Assemble route groups into a contract.
     */
    contract<const R extends Routes<Extract<keyof Tags, string>>>(definition: { routes: R }): Contract<R, Tags, Codes>;
}

/**
 * The typed factory for one API surface. Destructure `k`, then use `k.routes` to
 * define route groups and `k.contract` to assemble them into the contract.
 *
 * @example
 * const { k } = kizuna({
 *     tags,
 *     validation: {
 *         issueCodes: ['invalid_phone_number'],
 *     },
 * });
 */
export const kizuna = <const Tags extends Record<string, TagOptions> = Record<string, never>, const Codes extends string = never>(config?: {
    tags?: TagSet<Tags>;
    validation?: {
        issueCodes?: readonly Codes[];
    };
}): { k: K<Tags, Codes> } => {
    const tagSet: TagSet<Tags> = config?.tags ?? { __brand: 'TagSet', tags: {} as Tags };

    const routes = ((tagOrDefs: string | Routes, defs?: Routes) => {
        if (defs === undefined) {
            return tagRoutes(tagOrDefs as Routes);
        }
        return tagRoutes(tagSet, tagOrDefs as Extract<keyof Tags, string>, defs as Routes<Extract<keyof Tags, string>>);
    }) as K<Tags, Codes>['routes'];

    const k: K<Tags, Codes> = {
        routes,
        contract(definition) {
            return assembleContract({
                routes: definition.routes,
                tags: config?.tags,
                validation: config?.validation,
            }) as Contract<typeof definition.routes, Tags, Codes>;
        },
    };

    return { k };
};
