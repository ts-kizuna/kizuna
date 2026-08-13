import { k } from './k.js';
import { routes } from './routes/index.js';
import { jobs } from './jobs.js';
import { access } from './access.js';

export const contract = k.contract({
    routes,
    jobs,
    access,
});
