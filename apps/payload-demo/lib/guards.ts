import { createGuard } from '@ts-kizuna/payload';

export const requireAuth = createGuard(async (req, deny) => {
    if (!req.user) {
        return deny(401, 'Unauthorized');
    }
});
