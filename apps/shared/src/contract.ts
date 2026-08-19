import { k } from './k';
import { routes } from './routes/index';
import { jobs } from './jobs';
import { receivers } from './receivers';
import { auth } from './auth';

export const contract = k.contract({
    routes,
    jobs,
    receivers,
    auth,
});
