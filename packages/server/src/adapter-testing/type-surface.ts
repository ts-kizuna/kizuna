// Not `../handler-pipeline.js`: see the note in `type-fixtures.ts`.
import type { Contract, RouteDefinition, Routes } from '@ts-kizuna/contract/internal';
import type { HandlersFromAuth, RequestContextValues } from '../adapter.js';
import type { RouteHandler as CoreRouteHandler, Router as CoreRouter } from '../next/server.js';

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
