import { expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { Kizuna } from './kizuna.js';
import type { GateablePermissionName, PermissionAppliesTo } from './permission.js';

const UserSchema = z.object({
    id: z.string(),
    role: z.enum(['owner', 'admin']),
});

const viewInvoices = Kizuna.permission();
const promoteMember = Kizuna.permission({
    appliesTo: UserSchema,
});

const k = new Kizuna({
    permissions: {
        viewInvoices,
        promoteMember,
    },
});

const members = k.routes({
    listMembers: {
        method: 'GET',
        path: '/workspace/members',
        responses: {
            200: z.object({
                ok: z.boolean(),
            }),
        },
    },
});

test('appliesTo carries the record type, and its absence is never', () => {
    expectTypeOf<PermissionAppliesTo<typeof promoteMember>>().toEqualTypeOf<z.output<typeof UserSchema>>();
    expectTypeOf<PermissionAppliesTo<typeof viewInvoices>>().toBeNever();
});

test('only a permission applying to no record can gate a route', () => {
    expectTypeOf<
        GateablePermissionName<{ viewInvoices: typeof viewInvoices; promoteMember: typeof promoteMember }>
    >().toEqualTypeOf<'viewInvoices'>();
});

test('k.permissions returns the map it is given', () => {
    const permissions = k.permissions(
        {
            members,
        },
        {
            members: 'viewInvoices',
        }
    );

    expectTypeOf(permissions).toEqualTypeOf<{ readonly members: 'viewInvoices' }>();
});

test('an undeclared permission is rejected', () => {
    k.permissions(
        {
            members,
        },
        {
            // @ts-expect-error 'archiveMember' is not declared
            members: 'archiveMember',
        }
    );
});

test('a record-scoped permission cannot gate a route', () => {
    k.permissions(
        {
            members,
        },
        {
            // @ts-expect-error 'promoteMember' applies to a record
            members: 'promoteMember',
        }
    );
});

test('a group missing from the map is rejected', () => {
    k.permissions(
        {
            members,
        },
        // @ts-expect-error 'members' is not covered
        {}
    );
});

test('contract requires the map once permissions are declared', () => {
    // @ts-expect-error 'permissions' is required
    k.contract({
        routes: {
            members,
        },
    });
});

test('the contract carries its declarations and its map', () => {
    const contract = k.contract({
        routes: {
            members,
        },
        permissions: {
            members: 'viewInvoices',
        },
    });

    expectTypeOf<NonNullable<typeof contract.declaredPermissions>>().toEqualTypeOf<{
        readonly viewInvoices: typeof viewInvoices;
        readonly promoteMember: typeof promoteMember;
    }>();
    expectTypeOf<NonNullable<typeof contract.permissions>>().toEqualTypeOf<{ readonly members: 'viewInvoices' }>();
});
