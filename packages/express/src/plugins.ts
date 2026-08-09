export type { KizunaPlugin } from '@ts-kizuna/core/adapter';

import type { Request, Response, Router as ExpressRouter } from 'express';

type Handler = (req: Request, res: Response) => void;

/**
 * What `mount` needs from an Express app or router. `use` carries the
 * contract's routes; the method registrars are what plugins mount themselves
 * with. Both `express()` and `express.Router()` satisfy it.
 */
export interface App {
    use(router: ExpressRouter): unknown;
    get(path: string, ...handlers: Handler[]): unknown;
    post(path: string, ...handlers: Handler[]): unknown;
    put(path: string, ...handlers: Handler[]): unknown;
    patch(path: string, ...handlers: Handler[]): unknown;
    delete(path: string, ...handlers: Handler[]): unknown;
}
