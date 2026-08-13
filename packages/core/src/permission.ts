import type { z } from 'zod';

/**
 * Something a caller may be permitted. Defined with `Kizuna.permission` and
 * registered on the `kizuna` factory under `permissions`; the contract's
 * `permissions` map says which routes demand it, and `server.permission`
 * decides whether this caller holds it.
 *
 * A permission is the name, not the decision. It says `viewInvoices` exists; an
 * implementation says whether this caller has it.
 */
export interface Permission<AppliesTo extends z.ZodType | undefined = z.ZodType | undefined> {
    readonly __brand: 'Permission';
    /**
     * Schema for the record this permission is about, when the answer depends on
     * which one. Types the implementation's predicate parameter and the argument
     * of `can`.
     *
     * Its presence is load-bearing. A permission that applies to a record cannot
     * gate a route, because the route has not loaded the record yet, and never
     * reaches the client, because a predicate cannot cross a wire.
     *
     * Nothing parses against it at runtime: the record reaches `can` from the
     * handler that loaded it and goes into the app's own predicate, so there is
     * no trust boundary to check.
     */
    readonly appliesTo: AppliesTo;
    /**
     * Shown beside the permission wherever it is reported.
     */
    readonly description?: string;
}

/**
 * The record type a permission is about, the `z.output` of its `appliesTo`
 * schema, or `never` when it applies to none.
 */
export type PermissionAppliesTo<P> =
    P extends Permission<infer AppliesTo> ? ([AppliesTo] extends [z.ZodType] ? z.output<AppliesTo> : never) : never;

/**
 * The names of the permissions that can gate a route: the ones applying to no
 * particular record, so the question is answerable before a handler runs.
 */
export type GateablePermissionName<Permissions> = [Permissions[keyof Permissions]] extends [never]
    ? never
    : {
          [Name in keyof Permissions & string]: [PermissionAppliesTo<Permissions[Name]>] extends [never] ? Name : never;
      }[keyof Permissions & string];

export interface PermissionConfig<AppliesTo extends z.ZodType | undefined> {
    appliesTo?: AppliesTo;
    description?: string;
}

/**
 * Declare a permission. Omit `appliesTo` for a plain yes or no, which is most of
 * them; pass it when the answer depends on which record is being acted on.
 *
 * Reach for a permission where the auth map cannot answer: a decision that needs
 * a lookup, or that depends on the record. A decision comparing one field of a
 * guard's return against a literal belongs in the auth map's access gate, which
 * costs nothing and narrows the field in the handler.
 *
 * @example
 * const viewInvoices = Kizuna.permission({
 *     description: 'See the workspace invoices',
 * });
 *
 * @example
 * const promoteMember = Kizuna.permission({
 *     appliesTo: UserSchema,
 * });
 */
export interface CreatePermission {
    (config?: { description?: string }): Permission<undefined>;
    <AppliesTo extends z.ZodType>(config: { appliesTo: AppliesTo; description?: string }): Permission<AppliesTo>;
}

export const createPermission: CreatePermission = <AppliesTo extends z.ZodType | undefined = undefined>(
    config?: PermissionConfig<AppliesTo>
): Permission<AppliesTo> => ({
    __brand: 'Permission',
    appliesTo: config?.appliesTo as AppliesTo,
    description: config?.description,
});

/**
 * Type guard for a {@link Permission}.
 */
export const isPermission = (value: unknown): value is Permission =>
    typeof value === 'object' && value !== null && '__brand' in value && (value as Permission).__brand === 'Permission';
