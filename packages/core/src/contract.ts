import type { z } from 'zod';
import type { Routes } from './types.js';
import type { TagSet, TagOptions } from './tags.js';
import type { SecurityScheme } from './security-scheme.js';
import type { RequestContextSchema } from './request-context.js';

/**
 * A kizuna API definition: its routes plus tags, identities, and validation
 * settings. Produced by `k.contract` and consumed by the server adapters,
 * fetch client, OpenAPI generator, and SDK generators.
 */
export interface Contract<
    Routes_ extends Routes = Routes,
    Tags extends Record<string, TagOptions> = Record<string, TagOptions>,
    Codes extends string = string,
    Schemes extends Record<string, SecurityScheme> = Record<string, SecurityScheme>,
    Auth = unknown,
    RequestContext extends Record<string, RequestContextSchema> = Record<string, RequestContextSchema>,
> {
    /**
     * The API's route groups.
     */
    routes: Routes_;
    /**
     * The `auth` map passed to `k.contract`, keyed by route group. Carried on the
     * contract so the adapters can resolve each route's required identities and
     * access constraints into the handler's scheme-keyed context.
     */
    auth?: Auth;
    /**
     * The tag set declared with {@link createTags}. Routes reference its keys; the
     * OpenAPI generator resolves each key to its title and description.
     */
    tags?: TagSet<Tags>;
    /**
     * The identities passed to {@link kizuna}. Routes reference them by name in
     * their `security` field; the OpenAPI generator emits them under
     * `components.securitySchemes`.
     */
    securitySchemes?: Schemes;
    /**
     * The request context schemas passed to {@link kizuna}. Each key names a
     * provider registered on `createApi`; every handler receives its value.
     * Never gates a request and never appears in the OpenAPI document.
     */
    requestContext?: RequestContext;
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
 * Internal helper that builds a {@link Contract} from routes, tags, identities,
 * and issue codes. Called by `k.contract`. Not part of the public surface;
 * author contracts through `kizuna`.
 */
export function assembleContract<
    const Tags extends Record<string, TagOptions> = Record<string, never>,
    const Codes extends string = never,
    const Schemes extends Record<string, SecurityScheme> = Record<string, never>,
    const R extends Routes<Extract<keyof Tags, string>, Extract<keyof Schemes, string>> = Routes<
        Extract<keyof Tags, string>,
        Extract<keyof Schemes, string>
    >,
    const Auth = unknown,
    const RequestContext extends Record<string, RequestContextSchema> = Record<string, never>,
>(config: {
    routes: R;
    auth?: Auth;
    tags?: TagSet<Tags>;
    securitySchemes?: Schemes;
    requestContext?: RequestContext;
    validation?: {
        issueCodes?: readonly Codes[];
    };
}): Contract<R, Tags, Codes, Schemes, Auth, RequestContext> {
    return {
        routes: config.routes,
        auth: config.auth,
        tags: config.tags,
        securitySchemes: config.securitySchemes,
        requestContext: config.requestContext,
        validation: config.validation,
    };
}
