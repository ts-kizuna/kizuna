import type { Routes } from './types.js';
import type { TagSet, TagOptions } from './tags.js';

/**
 * A kizuna API definition: its routes plus tags and validation settings.
 * Produced by `k.contract` and consumed by the server adapters, fetch client,
 * OpenAPI generator, and SDK generators.
 */
export interface Contract<
    Routes_ extends Routes = Routes,
    Tags extends Record<string, TagOptions> = Record<string, TagOptions>,
    Codes extends string = string,
> {
    /**
     * The API's route groups.
     */
    routes: Routes_;
    /**
     * The tag set declared with {@link createTags}. Routes reference its keys; the
     * OpenAPI generator resolves each key to its title and description.
     */
    tags?: TagSet<Tags>;
    /**
     * Validation behavior for the API.
     */
    validation?: {
        /**
         * Custom validation issue codes this API's handlers may emit.
         */
        issueCodes?: readonly Codes[];
    };
}

/**
 * Internal helper that builds a {@link Contract} from routes, tags, and issue
 * codes. Called by `k.contract`. Not part of the public surface; author
 * contracts through `kizuna`.
 */
export function assembleContract<
    const Tags extends Record<string, TagOptions> = Record<string, never>,
    const Codes extends string = never,
    const R extends Routes<Extract<keyof Tags, string>> = Routes<Extract<keyof Tags, string>>,
>(config: {
    routes: R;
    tags?: TagSet<Tags>;
    validation?: {
        issueCodes?: readonly Codes[];
    };
}): Contract<R, Tags, Codes> {
    return {
        routes: config.routes,
        tags: config.tags,
        validation: config.validation,
    };
}
