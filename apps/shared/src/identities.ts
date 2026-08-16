import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/contract';

/**
 * A signed-in user, authenticated by a bearer session token. Guards resolve the
 * token to the context handlers read under `user`.
 */
export const user = Kizuna.identity.bearer({
    context: z.object({
        userId: z.string(),
    }),
});

/**
 * A workspace membership, authenticated by the `x-workspace-token` header. The
 * `access` schema declares the fields the contract's auth map may constrain per
 * route (e.g. owner-only routes).
 */
export const member = Kizuna.identity.apiKey({
    name: 'x-workspace-token',
    in: 'header',
    context: z.object({
        workspaceUserId: z.string(),
    }),
    access: z.object({
        role: z.enum(['owner', 'admin']),
    }),
});

/**
 * An invite capability URL (`/invites/:token`) whose path token is the credential.
 * No OpenAPI scheme can express a path segment, so it uses `custom`.
 */
export const inviteToken = Kizuna.identity.custom({
    context: z.object({
        inviteId: z.string(),
        email: z.email(),
    }),
});

/**
 * The platform scheduler, authenticated by the shared secret it sends. Every job
 * requires it; no route does.
 */
export const scheduler = Kizuna.identity.bearer({
    context: z.object({
        invokedAt: z.string(),
    }),
});
