/**
 * Zod types `deprecated` as a boolean to match JSON Schema. Widened here so a
 * schema deprecation can carry a message, the same shape routes use. Outputs
 * that need a boolean emit `deprecated: true`.
 */
declare module 'zod/v4/core' {
    interface GlobalMeta {
        /**
         * Deprecates the schema. Pass a message to tell callers what to use
         * instead.
         */
        deprecated?: boolean | string;
    }
}

export {};
