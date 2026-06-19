import type { z } from 'zod';
import { tagRoutes } from './routes.js';
import { assembleContract, type Contract } from './contract.js';
import { type TagSet, type TagOptions } from './tags.js';
import type { ErrorMode } from './handler-pipeline.js';
import { type Routes, PROBLEM_DETAILS_META } from './types.js';

/**
 * The handle `kizuna` returns. `k.routes` defines route groups; `k.contract`
 * assembles them into the contract.
 */
export interface K<
    Tags extends Record<string, TagOptions>,
    Codes extends string,
    Mode extends ErrorMode = 'problem-details',
    GuardError extends z.ZodType | undefined = undefined,
> {
    /**
     * Define a group of routes. Pass a tag (one of the keys from `createTags`)
     * to group them in the OpenAPI document, or omit it for an untagged group.
     */
    routes<const T extends Routes<Extract<keyof Tags, string>>>(tag: Extract<keyof Tags, string>, defs: T): T;
    routes<const T extends Routes>(defs: T): T;
    /**
     * Assemble route groups into a contract.
     */
    contract<const R extends Routes<Extract<keyof Tags, string>>>(definition: { routes: R }): Contract<R, Tags, Codes, Mode, GuardError>;
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
 *
 * @example
 * // Opt out of RFC 9457 Problem Details and define your own error shapes.
 * const { k } = kizuna({
 *     problemDetails: false,
 *     guardErrorSchema: ApiErrorSchema,
 * });
 */
export const kizuna = <
    const Tags extends Record<string, TagOptions> = Record<string, never>,
    const Codes extends string = never,
    const ProblemDetails extends boolean = true,
    const GuardError extends z.ZodType | undefined = undefined,
>(config?: {
    tags?: TagSet<Tags>;
    validation?: {
        issueCodes?: readonly Codes[];
    };
    /**
     * Whether error (4xx/5xx) responses use RFC 9457 Problem Details. Default `true`.
     *
     * Set to `false` to define your own error shapes: handler-authored error bodies
     * (handler returns, `error()`, and guard `deny`) are sent as the literal declared
     * schema. Framework-internal errors (routing, validation, 500) still use Problem
     * Details — reshape those with an adapter `formatError`.
     */
    problemDetails?: ProblemDetails;
    /**
     * The shared schema for guard denials. Pass it to `createGuard(contract, fn)`
     * to type the `deny(status, body)` body. Most useful alongside
     * `problemDetails: false`.
     */
    guardErrorSchema?: GuardError;
}): { k: K<Tags, Codes, ProblemDetails extends false ? 'custom' : 'problem-details', GuardError> } => {
    const tagSet: TagSet<Tags> = config?.tags ?? { __brand: 'TagSet', tags: {} as Tags };

    type Mode = ProblemDetails extends false ? 'custom' : 'problem-details';

    const routes = ((tagOrDefs: string | Routes, defs?: Routes) => {
        if (defs === undefined) {
            return tagRoutes(tagOrDefs as Routes);
        }
        return tagRoutes(tagSet, tagOrDefs as Extract<keyof Tags, string>, defs as Routes<Extract<keyof Tags, string>>);
    }) as K<Tags, Codes, Mode, GuardError>['routes'];

    const k: K<Tags, Codes, Mode, GuardError> = {
        routes,
        contract(definition) {
            if (config?.problemDetails === false) {
                (definition.routes as { [PROBLEM_DETAILS_META]?: boolean })[PROBLEM_DETAILS_META] = false;
            }
            return assembleContract({
                routes: definition.routes,
                tags: config?.tags,
                validation: config?.validation,
                guardErrorSchema: config?.guardErrorSchema,
            }) as Contract<typeof definition.routes, Tags, Codes, Mode, GuardError>;
        },
    };

    return { k };
};
