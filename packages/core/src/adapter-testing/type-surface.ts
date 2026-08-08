// Not `../handler-pipeline.js`: see the note in `type-fixtures.ts`.
import type { Contract, HandlersFromAuth, RequestContextValues, RouteDefinition, Routes } from '@ts-kizuna/core';
import type { RouteHandler as CoreRouteHandler, Router as CoreRouter } from '@ts-kizuna/core/adapter';

/**
 * The one definition every adapter's own `Router<C>` must resolve to, with its handler context substituted in.
 */
export type ExpectedRouter<C, HandlerContext> =
    C extends Contract<infer R, infer _Tags, infer _Codes, infer Schemes, infer Auth, infer RequestContext>
        ? HandlersFromAuth<R, HandlerContext & RequestContextValues<RequestContext>, Schemes, Auth>
        : C extends Routes
          ? CoreRouter<C, HandlerContext>
          : never;

export type ExpectedRouteHandler<R extends RouteDefinition, HandlerContext> = CoreRouteHandler<R, HandlerContext>;
