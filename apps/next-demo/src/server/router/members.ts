import { randomUUID } from 'node:crypto';
import { db } from '@ts-kizuna-demo/shared';
import type { Router } from '@ts-kizuna/next';
import type { contract } from '@ts-kizuna-demo/shared';

export const members: Router<typeof contract.routes.workspace.members> = {
    listMembers: async ({ auth }) => {
        const allMembers = await db.users.findMany();
        return {
            status: 200,
            body: {
                members: allMembers.filter((candidate) => candidate.id !== auth.user.userId),
            },
        };
    },
    inviteMember: async ({ body, auth }) => {
        const existingMember = await db.users.findByEmail(body.email);
        if (existingMember) {
            return {
                status: 409,
                body: {
                    detail: `${body.email} is already a member (invite attempted by ${auth.member.role}).`,
                },
            };
        }
        const invited = await db.users.create({
            id: randomUUID(),
            name: body.email.split('@')[0] ?? body.email,
            email: body.email,
        });
        return {
            status: 201,
            body: invited,
        };
    },
};
