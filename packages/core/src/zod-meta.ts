/**
 * Widens Zod's `deprecated` metadata to carry a migration message, mirroring
 * `deprecated` on routes. Zod declares `deprecated?: boolean` to match JSON
 * Schema; generators normalise a string back to `deprecated: true` plus the
 * message where the output format wants a boolean.
 */
declare module 'zod/v4/core' {
    interface GlobalMeta {
        /**
         * Marks the schema deprecated. A string is the migration message,
         * surfaced in generated output.
         */
        deprecated?: boolean | string;
    }
}

export {};
