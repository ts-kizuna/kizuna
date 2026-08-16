import { k } from './k';
import { routes } from './routes/index';
import { jobs } from './jobs';
import { auth } from './auth';

export const contract = k.contract({
    routes,
    jobs,
    auth,
});
