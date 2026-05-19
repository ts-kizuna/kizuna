import { expectTypeOf, test } from 'vitest';
import type { ExtractPathParams, HasPathParams } from './path-params.js';

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
