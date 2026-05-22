export interface Tag {
    readonly __brand: 'Tag';
    readonly title: string;
    readonly description?: string;
}

export interface TagOptions {
    /**
     * The tag name — used as the OpenAPI tag and shown in rendered API docs.
     */
    title: string;
    /**
     * Optional description shown alongside the tag in the OpenAPI spec.
     */
    description?: string;
}

export const isTag = (value: unknown): value is Tag =>
    typeof value === 'object' && value !== null && '__brand' in value && (value as Tag).__brand === 'Tag';

/**
 * Create a tag for grouping routes in the OpenAPI spec.
 *
 * ```ts
 * const Users = createTag({
 *     title: 'Users',
 *     description: 'User accounts and profiles',
 * });
 *
 * const usersContract = createContract(Users, {
 *     listUsers: { ... },
 * });
 * ```
 */
export const createTag = (options: TagOptions): Tag => ({
    __brand: 'Tag',
    title: options.title,
    description: options.description,
});
