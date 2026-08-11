export interface AdapterFeatureMeta {
    summary: string;
}

export const ADAPTER_FEATURES = {
    'routing.pathParams': {
        summary: 'A path param reaches the handler decoded from the URL.',
    },
    'routing.methodDispatch': {
        summary: 'Methods sharing a path dispatch to their own handler.',
    },
    'routing.methodMismatch': {
        summary: 'A method the contract does not declare on a known path is refused.',
    },
    'routing.notFound': {
        summary: 'An undeclared path is refused.',
    },
    'routing.subRouterComposition': {
        summary: 'Routes composed from a sub-router mount at their declared path.',
    },
    'routing.allMethods': {
        summary: 'Every method the contract can declare registers and dispatches.',
    },
    'routing.headStripsBody': {
        summary: 'A declared HEAD route answers with its status but no body.',
    },
    'routing.optionsAllow': {
        summary: 'A declared OPTIONS route carries an `Allow` header listing every method on the path.',
    },
    'query.defaults': {
        summary: 'A query param the request omits falls back to its schema default.',
    },
    'query.coercion': {
        summary: 'Query strings coerce to the declared types before validation.',
    },
    'body.json': {
        summary: 'A JSON body validates and reaches the handler typed.',
    },
    'body.invalid400': {
        summary: 'A body that fails schema validation is refused.',
    },
    'body.optionalFields': {
        summary: 'An optional body field may be omitted, but is validated when present.',
    },
    'errors.declaredProblemDetails': {
        summary: 'A declared error response is sent as `application/problem+json`.',
    },
    'errors.unsupportedMediaType415': {
        summary: 'A body sent with an undeclared content type is refused before validation.',
    },
    'errors.notAcceptable406': {
        summary: 'A request accepting no type the route can produce is refused.',
    },
    'errors.validationProblemDetails': {
        summary: 'A validation failure carries an `errors` array in the Problem Details body.',
    },
    'errors.validationIssueCodes': {
        summary: 'Each issue crosses the wire as exactly `code`, `path` and `message`.',
    },
    'guards.publicRoute': {
        summary: 'A route the contract marks public runs without credentials.',
    },
    'guards.denied': {
        summary: 'A guarded route without credentials is denied.',
    },
    'guards.context': {
        summary: 'A guard’s returned context reaches the handler as `auth`.',
    },
    'guards.accessGate': {
        summary: 'An access gate refuses a credential that does not satisfy it.',
    },
    'guards.multiIdentity': {
        summary: 'A route requiring two identities merges both contexts, and denies until both are present.',
    },
    'responses.declaredContentType': {
        summary: 'A route declaring a non-JSON content type sends its body raw under it.',
    },
    'responses.binary': {
        summary: 'A binary body is sent as bytes under `application/octet-stream`.',
    },
    'responses.void': {
        summary: 'A void response sends no body and no content type.',
    },
    'responses.validation': {
        summary: 'With `responseValidation` on, a body the contract disallows fails as a 500.',
    },
    'plugins.routesServed': {
        summary: 'A plugin route is served by `api.mount`, in the same pipeline as the contract’s own.',
    },
    'plugins.exportsReachHandlers': {
        summary: 'What a plugin exports reaches every handler under `plugins`.',
    },
    'plugins.contractWinsOverlap': {
        summary: 'A contract route wins a path a plugin route also matches, such as a static path against the plugin’s param.',
    },
    'plugins.rawResponse': {
        summary: 'A plugin route answering with `rawResponse` sends its response untouched by validation or rendering.',
    },
    'plugins.serverRequired': {
        summary: 'A plugin declared on the contract with no server half passed to `server.api` throws, naming the module to import.',
    },
} as const satisfies Record<string, AdapterFeatureMeta>;

export type AdapterFeature = keyof typeof ADAPTER_FEATURES;

export const ADAPTER_NAMES = ['express', 'fastify', 'hono', 'next'] as const;

export type AdapterName = (typeof ADAPTER_NAMES)[number];

export interface AdapterBehaviour {
    /**
     * Only adapters where kizuna does the routing can answer 405; where the framework routes, its own 404 wins before
     * kizuna sees the request.
     */
    methodMismatchStatus: 404 | 405;
}

/**
 * Where the adapters legitimately differ. Everything not named here is identical across all of them.
 */
export const ADAPTER_BEHAVIOUR: Record<AdapterName, AdapterBehaviour> = {
    express: {
        methodMismatchStatus: 404,
    },
    fastify: {
        methodMismatchStatus: 404,
    },
    hono: {
        methodMismatchStatus: 404,
    },
    next: {
        methodMismatchStatus: 405,
    },
};

const featureIds = () => Object.keys(ADAPTER_FEATURES) as AdapterFeature[];

export const featureGroup = (feature: AdapterFeature): string => feature.slice(0, feature.indexOf('.'));

export const featureGroups = (): string[] => [...new Set(featureIds().map(featureGroup))];

export const featuresInGroup = (group: string): AdapterFeature[] => featureIds().filter((feature) => featureGroup(feature) === group);
