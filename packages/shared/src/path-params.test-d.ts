import { expectTypeOf, test } from 'vitest';
import type { ExtractPathParams, HasPathParams, PathParamName } from './path-params.js';
import { Kizuna } from '@ts-kizuna/contract';

test('PathParamName matches what parsePath finds at runtime', () => {
    expectTypeOf<PathParamName<'/users/:id'>>().toEqualTypeOf<'id'>();
    expectTypeOf<PathParamName<'/users/:userId/posts/:postId'>>().toEqualTypeOf<'userId' | 'postId'>();
    expectTypeOf<PathParamName<'/users'>>().toEqualTypeOf<never>();
    expectTypeOf<PathParamName<'/users/:id/posts'>>().toEqualTypeOf<'id'>();
});

test('PathParamName stops at the first character the path syntax does not allow', () => {
    expectTypeOf<PathParamName<'/files/:name.json'>>().toEqualTypeOf<'name'>();
    expectTypeOf<PathParamName<'/reports/:year-:month'>>().toEqualTypeOf<'year' | 'month'>();
    expectTypeOf<PathParamName<'/users/:user_id2'>>().toEqualTypeOf<'user_id2'>();
});

test('ExtractPathParams', () => {
    expectTypeOf<ExtractPathParams<'/users/:id'>>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<ExtractPathParams<'/users/:userId/posts/:postId'>>().toEqualTypeOf<{
        userId: string;
        postId: string;
    }>();
    expectTypeOf<ExtractPathParams<'/users'>>().toEqualTypeOf<{}>();
    expectTypeOf<ExtractPathParams<'/org/:orgId/team/:teamId/member/:memberId'>>().toEqualTypeOf<{
        orgId: string;
        teamId: string;
        memberId: string;
    }>();
});

test('HasPathParams', () => {
    expectTypeOf<HasPathParams<'/users/:id'>>().toEqualTypeOf<true>();
    expectTypeOf<HasPathParams<'/users'>>().toEqualTypeOf<false>();
    expectTypeOf<HasPathParams<'/'>>().toEqualTypeOf<false>();
});
