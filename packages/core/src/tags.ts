export interface TagOptions {
    /**
     * The tag name — used as the OpenAPI tag and shown in rendered API docs.
     */
    title: string;
    /**
     * Optional description shown alongside the tag in the OpenAPI spec.
     */
    description?: string;
    /**
     * Optional external documentation for the tag.
     */
    externalDocs?: {
        url: string;
        description?: string;
    };
}

/**
 * A set of OpenAPI tags created with `Kizuna.tags`. Passed to `Kizuna.init`,
 * where routes reference each tag by its key.
 */
export interface TagSet<T extends Record<string, TagOptions> = Record<string, TagOptions>> {
    readonly __brand: 'TagSet';
    readonly tags: T;
}

/**
 * The union of tag keys declared in a {@link TagSet}, e.g. `'health' | 'users'`.
 */
export type TagKeysOf<Set extends TagSet> = Set extends TagSet<infer T> ? Extract<keyof T, string> : never;

export const isTagSet = (value: unknown): value is TagSet =>
    typeof value === 'object' && value !== null && '__brand' in value && (value as TagSet).__brand === 'TagSet';

/**
 * Define a set of tags. A tag value may be a full {@link TagOptions} object or a
 * string, which is shorthand for `{ title }`. Pass the result to
 * `Kizuna.init({ tags })`.
 *
 * @example
 * const tags = Kizuna.tags({
 *     orders: {
 *         title: 'Orders',
 *         description: 'Create and manage orders',
 *     },
 *     health: 'Health',
 * });
 */
export const createTags = <const T extends Record<string, TagOptions | string>>(tags: T): TagSet<NormalizeTags<T>> => {
    const normalized: Record<string, TagOptions> = {};
    for (const [key, value] of Object.entries(tags)) {
        normalized[key] = typeof value === 'string' ? { title: value } : value;
    }
    return {
        __brand: 'TagSet',
        tags: normalized as NormalizeTags<T>,
    };
};

/**
 * Normalize a `Kizuna.tags` input, where each value is {@link TagOptions}
 * or a title string, into a uniform `Record<string, TagOptions>`.
 */
export type NormalizeTags<T extends Record<string, TagOptions | string>> = {
    [Key in keyof T]: T[Key] extends string ? { title: T[Key] } : T[Key] extends TagOptions ? T[Key] : never;
};
