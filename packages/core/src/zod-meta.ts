import type { $output } from 'zod/v4/core';

declare module 'zod/v4/core' {
    interface GlobalMeta {
        /**
         * Deprecates the schema. Pass a message to tell callers what to use
         * instead.
         */
        deprecated?: boolean | string;
        /**
         * An example value, or an array of them. Emitted as JSON Schema
         * `examples`.
         *
         * @example
         * const email = z.email().meta({
         *     example: 'ada@example.com',
         * });
         */
        example?: $output | $output[];
    }
}

export {};
