import { z } from 'zod';
import { Kizuna } from '@ts-kizuna/core';

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
 *
 * An unresolvable token answers 404 rather than 401. The token is the resource
 * identifier here, so a 401 would confirm that the URL names a real invite and
 * turn the endpoint into an enumeration oracle. This is a deliberate override of
 * the RFC 9110 default, declared here rather than chosen inside the guard.
 */
export const inviteToken = Kizuna.identity.custom({
    context: z.object({
        inviteId: z.string(),
        email: z.email(),
    }),
    onUnauthenticated: 404,
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
