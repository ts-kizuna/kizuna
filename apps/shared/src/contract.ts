import { k } from './k.js';
import { routes } from './routes/index.js';
import { jobs } from './jobs.js';
import { auth } from './auth.js';

export const contract = k.contract({
    routes,
    jobs,
    auth,
});
