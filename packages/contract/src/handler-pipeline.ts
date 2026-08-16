import type { z } from 'zod';
import { ROUTES_TAG, HANDLER_CONTEXT_BRAND, type HandlerContextBrand, type RouteDefinition, type Routes, type Method } from './types.js';
import type { ExtractPathParams } from '@ts-kizuna/contract';
import type { ContextOf } from './security-scheme.js';
import type { IdentityAccess } from './identity.js';
import { applyCoercion, coercionPlanFor } from '@ts-kizuna/contract';

type ProblemDetailsEnvelope = { type: string; title: string; status: number; detail: string };

/**
 * Strips the RFC 9457 envelope fields the adapter auto-fills (`type`/`title`/`status`),
 * leaving the author to supply `detail` plus any extension members. `type` stays optional
 * (authors may point it at their own problem-type URI); `title`/`status` are forbidden.
 */
type StripProblemEnvelope<T extends ProblemDetailsEnvelope> = Omit<T, 'type' | 'title' | 'status'> &
    Partial<Pick<T, 'type'>> & { title?: never; status?: never };

/**
 * True when a literal status key is in the 4xx/5xx range. Widened `number` keys (no
 * `const` inference) resolve to `false`, so enforcement only kicks in when the concrete
 * status is known, exactly where the wire output matters.
 */
type IsErrorStatus<Status> = `${Status & number}` extends `4${string}` | `5${string}` ? true : false;

/**
 * Error responses (4xx/5xx) must be RFC 9457 Problem Details, a schema assignable to the
 * envelope. Anything else resolves to `never`, surfacing as a compile error at the handler
 * return / `throwError()` site. Success responses pass through unchanged.
 */
type ApplyErrorEnvelope<Input, Status> =
    IsErrorStatus<Status> extends true ? (Input extends ProblemDetailsEnvelope ? StripProblemEnvelope<Input> : never) : Input;

type HandlerBody<S, Status> = S extends z.ZodType
    ? ApplyErrorEnvelope<z.input<S>, Status>
    : S extends { body: z.ZodType }
      ? ApplyErrorEnvelope<z.input<S['body']>, Status>
      : never;

/**
 * Constrained to `responses` alone so a job, which has no method or path, reuses it.
 */
export type HandlerReturn<R extends Pick<RouteDefinition, 'responses'>> = {
    [Status in keyof R['responses']]: {
        status: Status extends number ? Status : never;
        body: HandlerBody<R['responses'][Status], Status>;
        headers?: Record<string, string>;
    };
}[keyof R['responses']];

export type HandlerArgs<R extends RouteDefinition> = {
    params: R extends { pathParams: z.ZodType } ? z.output<R['pathParams']> : ExtractPathParams<R['path']>;
    query: R extends { query: z.ZodType } ? z.output<R['query']> : undefined;
    body: R extends { body: z.ZodType } ? z.output<R['body']> : undefined;
    headers: R extends { headers: z.ZodType } ? z.output<R['headers']> : Record<string, string | string[] | undefined>;
    /**
     * Throws a typed error response. Takes the same `{ status, body }` shape as a handler return.
     *
     * This function throws internally and never returns.
     */
    throwError: (response: HandlerReturn<R>) => never;
};

export type RouteHandler<R extends RouteDefinition, HandlerContext = unknown> = (
    args: HandlerArgs<R> & HandlerContext & BrandedHandlerContext<R>
) => Promise<HandlerReturn<R>> | HandlerReturn<R>;

export type Router<T extends Routes, HandlerContext = unknown> = {
    [Key in keyof T as Key extends symbol ? never : Key]: T[Key] extends RouteDefinition
        ? RouteHandler<T[Key], HandlerContext>
        : T[Key] extends Routes
          ? Router<T[Key], HandlerContext>
          : never;
};

/**
 * Narrow an identity's access to the constraint a route puts on it. A
 * `{ field: value }` constraint narrows that field to the value (or to the union,
 * for `{ field: [a, b] }`); an oauth2 scope array leaves access unconstrained.
 *
 * @example
 * type Narrowed = NarrowAccess<typeof member, { role: 'owner' }>;
 * // { role: 'owner' }, even though member.access allows 'owner' | 'admin'
 */
type NarrowAccess<Id, Constraint> = Constraint extends readonly unknown[]
    ? IdentityAccess<Id>
    : Constraint extends Record<string, unknown>
      ? Omit<IdentityAccess<Id>, keyof Constraint> & {
            [Field in keyof Constraint & keyof IdentityAccess<Id>]: IdentityAccess<Id>[Field] extends readonly unknown[]
                ? IdentityAccess<Id>[Field]
                : Constraint[Field] extends readonly (infer Value)[]
                  ? Value
                  : Constraint[Field];
        }
      : IdentityAccess<Id>;

/**
 * The object a passing guard returns for an identity: its `context` and `access`
 * fields flattened into one type. Read in a handler under the identity's name and
 * checked against the route's access gate. Flattened (rather than left as an
 * intersection) so it works as a contextual type, letting a guard return literal
 * access values like `role: 'owner'` without an annotation.
 */
export type GuardSuccess<S> = {
    [Field in keyof (ContextOf<S> & IdentityAccess<S>)]: (ContextOf<S> & IdentityAccess<S>)[Field];
};

/**
 * The scheme-keyed security context a single route's handler receives, derived
 * from the auth value the route resolves to: `false` (public) contributes
 * nothing; a scheme name yields that identity's context and full access; a
 * constraint object keys each named identity to its context and narrowed access.
 *
 * @example
 * type Context = ContextFromAuthValue<{ member: { role: 'owner' } }, { member: typeof member }>;
 * // { member: { workspaceUserId: string; role: 'owner' } }
 */
export type ContextFromAuthValue<Value, Identities> = Value extends false
    ? {}
    : Value extends string
      ? Value extends keyof Identities
          ? [keyof (ContextOf<Identities[Value]> & IdentityAccess<Identities[Value]>)] extends [never]
              ? {}
              : { [Name in Value]: ContextOf<Identities[Name]> & IdentityAccess<Identities[Name]> }
          : {}
      : Value extends Record<string, unknown>
        ? {
              [Name in Extract<keyof Value, string> & keyof Identities as [
                  keyof (ContextOf<Identities[Name]> & NarrowAccess<Identities[Name], Value[Name]>),
              ] extends [never]
                  ? never
                  : Name]: ContextOf<Identities[Name]> & NarrowAccess<Identities[Name], Value[Name]>;
          }
        : {};

/**
 * The `auth` argument a secured route's handler receives.
 */
type AuthArg<Value, Identities> =
    ContextFromAuthValue<Value, Identities> extends infer Ctx ? ([keyof Ctx] extends [never] ? {} : { auth: Ctx }) : never;

/**
 * An auth value normalized to its identity-map form: `false` contributes
 * nothing, a scheme name becomes `{ name: true }`, an object stays as is.
 */
type NormalizeAuthValue<Value> = Value extends false ? {} : Value extends string ? { [Name in Value]: true } : Value;

/**
 * An override merged into the `'*'` default: inherits its identities, refines or
 * adds per identity; `false` opts out.
 */
type MergeAuthValues<Default, Override> = Override extends false
    ? false
    : Omit<NormalizeAuthValue<Default>, keyof NormalizeAuthValue<Override>> & NormalizeAuthValue<Override>;

/**
 * The auth value that applies to one route directly within a group's auth entry.
 */
export type RouteAuthValue<GroupAuth, RouteKey extends string> = GroupAuth extends { '*': infer Default }
    ? RouteKey extends keyof GroupAuth
        ? MergeAuthValues<Default, GroupAuth[RouteKey]>
        : Default
    : GroupAuth;

/**
 * The group auth a subgroup resolves to within its parent's cascade: a nested
 * cascade with the parent's `'*'` merged in, a merged AuthValue, or the parent's
 * default when unnamed.
 */
type SubgroupAuth<GroupAuth, GroupKey extends string> = GroupAuth extends { '*': infer Default }
    ? GroupKey extends keyof GroupAuth
        ? GroupAuth[GroupKey] extends { '*': infer NestedDefault }
            ? Omit<GroupAuth[GroupKey], '*'> & { '*': MergeAuthValues<Default, NestedDefault> }
            : MergeAuthValues<Default, GroupAuth[GroupKey]>
        : Default
    : GroupAuth;

/**
 * The `requestContext` argument a handler receives.
 */
export type RequestContextValues<RequestContext> = string extends keyof RequestContext
    ? {}
    : [keyof RequestContext] extends [never]
      ? {}
      : {
            requestContext: {
                [Name in keyof RequestContext]: RequestContext[Name] extends { context: infer Schema extends z.ZodType }
                    ? z.output<Schema>
                    : never;
            };
        };

/**
 * The identity names an {@link AuthValue} requires: a name, the keys of a
 * constraint object, or none for `false`.
 */
type AuthValueIdentityNames<Value> = Value extends false ? never : Value extends string ? Value : Extract<keyof Value, string>;

type GroupGuardedParamNames<G extends Routes, GroupAuthValue, Name extends string> = {
    [Key in keyof G & string]: G[Key] extends RouteDefinition
        ? Name extends AuthValueIdentityNames<RouteAuthValue<GroupAuthValue, Key>>
            ? keyof ExtractPathParams<G[Key]['path']> & string
            : never
        : G[Key] extends Routes
          ? GroupGuardedParamNames<G[Key], SubgroupAuth<GroupAuthValue, Key>, Name>
          : never;
}[keyof G & string];

/**
 * The path param names of every route the identity `Name` secures, per the
 * contract's auth map.
 */
export type GuardedParamNames<R extends Routes, Auth, Name extends string> = {
    [Group in keyof R & string]: R[Group] extends RouteDefinition
        ? Name extends AuthValueIdentityNames<RouteAuthValue<Group extends keyof Auth ? Auth[Group] : false, Group>>
            ? keyof ExtractPathParams<R[Group]['path']> & string
            : never
        : R[Group] extends Routes
          ? GroupGuardedParamNames<R[Group], Group extends keyof Auth ? Auth[Group] : false, Name>
          : never;
}[keyof R & string];

/**
 * The `params` a guard for identity `Name` receives: the param names of the
 * routes it secures, each optional since the guard runs across all of them.
 * Falls back to `Record<string, string>` when no params are derivable.
 */
export type GuardParams<R extends Routes, Auth, Name extends string> = [GuardedParamNames<R, Auth, Name>] extends [never]
    ? Record<string, string>
    : { [Param in GuardedParamNames<R, Auth, Name>]?: string };

type GroupHandlers<G extends Routes, HandlerContext, Identities, GroupAuth> = {
    [Key in keyof G as Key extends symbol ? never : Key]: G[Key] extends RouteDefinition
        ? RouteHandlerFromContext<G[Key], HandlerContext, AuthArg<RouteAuthValue<GroupAuth, Key & string>, Identities>>
        : G[Key] extends Routes
          ? GroupHandlers<G[Key], HandlerContext, Identities, SubgroupAuth<GroupAuth, Key & string>>
          : never;
};

type RouteHandlerFromContext<R extends RouteDefinition, HandlerContext, SecurityContext> = (
    args: HandlerArgs<R> & HandlerContext & SecurityContext
) => Promise<HandlerReturn<R>> | HandlerReturn<R>;

/**
 * The handler tree for a contract: every route group, each route typed with its
 * inputs, the adapter's handler context, and the scheme-keyed security context
 * its entry in the `auth` map resolves to. Identities and access fields a route
 * requires appear in the handler args under `auth`, keyed by each identity's name.
 */
export type HandlersFromAuth<R extends Routes, HandlerContext, Identities, Auth> = {
    [Group in keyof R as Group extends symbol ? never : Group]: R[Group] extends RouteDefinition
        ? RouteHandlerFromContext<
              R[Group],
              HandlerContext,
              AuthArg<RouteAuthValue<Group extends keyof Auth ? Auth[Group] : false, Group & string>, Identities>
          >
        : R[Group] extends Routes
          ? GroupHandlers<R[Group], HandlerContext, Identities, Group extends keyof Auth ? Auth[Group] : false>
          : never;
};

/**
 * A route's brand, skipped when the resolved context is empty.
 */
type RouteContextBrand<Context> = [keyof Context] extends [never] ? unknown : HandlerContextBrand<Context>;

type GroupHandlerContextOverlay<G extends Routes, Identities, GroupAuth, ContractContext> = {
    [Key in keyof G]: G[Key] extends RouteDefinition
        ? RouteContextBrand<AuthArg<RouteAuthValue<GroupAuth, Key & string>, Identities> & ContractContext>
        : G[Key] extends Routes
          ? GroupHandlerContextOverlay<G[Key], Identities, SubgroupAuth<GroupAuth, Key & string>, ContractContext>
          : unknown;
};

/**
 * A contract's routes, each branded with what the contract adds to a handler's
 * args: `auth`, `requestContext`, plugins, and jobs. Read back by
 * {@link RouteHandler}.
 */
export type RoutesWithHandlerContext<R extends Routes, Identities, Auth, RequestContext, ContractContext = unknown> = R & {
    [Group in keyof R]: R[Group] extends RouteDefinition
        ? RouteContextBrand<
              AuthArg<RouteAuthValue<Group extends keyof Auth ? Auth[Group] : false, Group & string>, Identities> &
                  RequestContextValues<RequestContext> &
                  ContractContext
          >
        : R[Group] extends Routes
          ? GroupHandlerContextOverlay<
                R[Group],
                Identities,
                Group extends keyof Auth ? Auth[Group] : false,
                RequestContextValues<RequestContext> & ContractContext
            >
          : unknown;
};

export type BrandedHandlerContext<R> = typeof HANDLER_CONTEXT_BRAND extends keyof R ? NonNullable<R[typeof HANDLER_CONTEXT_BRAND]> : {};

export const isRouteDefinition = (value: unknown): value is RouteDefinition => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.method === 'string' && typeof candidate.path === 'string' && !!candidate.responses;
};

export interface FlattenedRoute {
    routeKey: string;
    route: RouteDefinition;
    routeTags: string[];
}

export const flattenRoutes = (routes: Routes, prefix?: string, inheritedTags: string[] = []): FlattenedRoute[] => {
    const ownTag = (routes as Record<typeof ROUTES_TAG, string | undefined>)[ROUTES_TAG];
    const activeTags = ownTag ? [...inheritedTags, ownTag] : inheritedTags;
    const collected: FlattenedRoute[] = [];
    for (const [key, value] of Object.entries(routes)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (isRouteDefinition(value)) {
            collected.push({
                routeKey: fullKey,
                route: value,
                routeTags: activeTags,
            });
        } else if (value && typeof value === 'object') {
            collected.push(...flattenRoutes(value as Routes, fullKey, activeTags));
        }
    }
    return collected;
};

export interface RawInputs {
    params: unknown;
    query: unknown;
    body: unknown;
    headers: unknown;
}

export type ValidationStage = 'params' | 'query' | 'headers' | 'body';

export interface ValidationFailure {
    stage: ValidationStage;
    issues: z.core.$ZodIssue[];
}

const STAGE_MESSAGES: Record<ValidationStage, string> = {
    params: 'Invalid path parameters',
    query: 'Invalid query parameters',
    headers: 'Invalid headers',
    body: 'Invalid request body',
};

export const formatValidationError = (failure: ValidationFailure): { detail: string; issues: z.core.$ZodIssue[] } => ({
    detail: STAGE_MESSAGES[failure.stage],
    issues: failure.issues,
});

export const validateRequest = (
    route: RouteDefinition,
    raw: RawInputs
): { ok: true; parsed: RawInputs } | { ok: false; error: ValidationFailure } => {
    const order: ReadonlyArray<{ stage: ValidationStage; schema: z.ZodType | undefined; input: unknown; coerced: boolean }> = [
        {
            stage: 'params',
            schema: route.pathParams,
            input: raw.params,
            coerced: true,
        },
        {
            stage: 'query',
            schema: route.query,
            input: raw.query,
            coerced: true,
        },
        {
            stage: 'headers',
            schema: route.headers,
            input: raw.headers,
            coerced: true,
        },
        {
            stage: 'body',
            schema: route.body,
            input: raw.body,
            coerced: false,
        },
    ];

    const parsed: RawInputs = {
        params: raw.params,
        query: raw.query,
        headers: raw.headers,
        body: raw.body,
    };

    for (const step of order) {
        if (!step.schema) continue;
        const input = step.coerced ? applyCoercion(step.input, coercionPlanFor(step.schema)) : step.input;
        const result = step.schema.safeParse(input);
        if (!result.success) {
            return {
                ok: false,
                error: {
                    stage: step.stage,
                    issues: result.error.issues,
                },
            };
        }
        parsed[step.stage] = result.data;
    }

    return {
        ok: true,
        parsed,
    };
};

export const allowedMethodsForPath = (routes: Routes, path: string): Method[] => {
    const methods = new Set<Method>();
    for (const { route } of flattenRoutes(routes)) {
        if (route.path === path) methods.add(route.method);
    }
    return Array.from(methods);
};
