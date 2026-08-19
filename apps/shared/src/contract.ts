import { k } from './k';
import { routes } from './routes/index';
import { jobs } from './jobs';
import { webhooks } from './webhooks';
import { auth } from './auth';

export const contract = k.contract({
    routes,
    jobs,
    webhooks,
    auth,
});
